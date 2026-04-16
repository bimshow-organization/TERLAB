'use strict';
/**
 * TERLAB · ParkingDetection service
 * Detection des surfaces impermeables au sol (parking, terrasses, allees carrossables).
 *
 * Pipeline fusion :
 *   1. COSIA IGN WMS (segmentation IA) → masque pixels gris pave
 *   2. Blob-labeling avec pixels conservés
 *   3. PCA → bounding box oriente (OBB) par blob
 *   4. Validation LiDAR : rejet si beaucoup de points classe 6 (toit) → vraie au sol
 *   5. Filtre forme : aspect ratio < 3 (pas d'allee etroite), area > 15 m²
 *
 * Retourne Array<{ polygon: [[lng,lat]...], area_m2, aspectRatio, groundRatio }>
 */

const IGN_WMS   = 'https://data.geopf.fr/wms-r/wms';
const COSIA_LAY = 'IGNF_COSIA_2021-2023';

const ParkingDetection = {

  async detect(bbox, centroid, sessionId, cfg = {}) {
    const opts = Object.assign({
      imgSize: 1024,
      minArea_m2: 15,
      maxAspectRatio: 3.5,
      maxBuildingFraction: 0.25,
    }, cfg);

    const [minLng, minLat, maxLng, maxLat] = bbox;
    const [, refLat] = centroid;
    const IMG = opts.imgSize;

    // 1. Fetch COSIA raster
    const url = `${IGN_WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap`
      + `&LAYERS=${COSIA_LAY}&CRS=EPSG:4326`
      + `&BBOX=${minLat},${minLng},${maxLat},${maxLng}`
      + `&WIDTH=${IMG}&HEIGHT=${IMG}&FORMAT=image/png&STYLES=`;
    let imgData;
    try { imgData = await this._fetchImageData(url, IMG, IMG); }
    catch (e) { console.warn('[ParkingDetect] COSIA fetch failed:', e); return []; }

    // 2. Masque pixels gris paves (COSIA class "zones pavees")
    const mask = this._pavedMask(imgData);

    // 3. Blob-labeling avec pixels conserves
    const blobs = this._labelBlobsWithPixels(mask, IMG, IMG);
    if (!blobs.length) return [];

    // 4. Echelle pixel → metres
    const pxToM = (maxLng - minLng) * 111320 * Math.cos(refLat * Math.PI / 180) / IMG;

    // 5. LidarCache pour validation (points classes 2 sol + 6 bati)
    const lidarPts = await this._loadLidarPts(sessionId);

    const results = [];
    for (const blob of blobs) {
      const area_m2 = blob.pixelCount * pxToM * pxToM;
      if (area_m2 < opts.minArea_m2) continue;

      // OBB via PCA
      const obb = this._orientedBox(blob.pixels);
      if (!obb) continue;
      const aspectRatio = Math.max(obb.lengthA, obb.lengthB) / Math.max(1, Math.min(obb.lengthA, obb.lengthB));
      if (aspectRatio > opts.maxAspectRatio) continue;

      // Convertir OBB pixels → WGS84 polygon
      const polygon = obb.corners.map(([px, py]) => {
        const lng = minLng + (px / IMG) * (maxLng - minLng);
        const lat = maxLat - (py / IMG) * (maxLat - minLat);
        return [lng, lat];
      });

      // Validation LiDAR : rejeter si majoritairement pts classe 6 (toit mal classifie COSIA)
      let groundRatio = 1;
      if (lidarPts?.length) {
        let ground = 0, building = 0;
        for (const p of lidarPts) {
          if (!this._pointInPolygon(p[0], p[1], polygon)) continue;
          if (p[6] === 2) ground++;
          else if (p[6] === 6) building++;
        }
        const total = ground + building;
        if (total >= 3) {
          groundRatio = ground / total;
          if (groundRatio < (1 - opts.maxBuildingFraction)) continue; // majoritairement toit → rejet
        }
      }

      results.push({
        polygon,
        area_m2: Math.round(area_m2),
        aspectRatio: Math.round(aspectRatio * 10) / 10,
        groundRatio: Math.round(groundRatio * 100) / 100,
      });
    }

    console.info(`[ParkingDetect] ${results.length} zones detectees · total ${results.reduce((s,r)=>s+r.area_m2,0)} m²`);
    return results;
  },

  _pavedMask(imgData) {
    const { data, width, height } = imgData;
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i++) {
      const R = data[i*4], G = data[i*4+1], B = data[i*4+2], A = data[i*4+3];
      if (A < 128) continue;
      // Gris neutre : R≈G≈B avec valeur 80-180 (COSIA class "pave" ~#767676)
      const spread = Math.max(R, G, B) - Math.min(R, G, B);
      const mid    = (R + G + B) / 3;
      mask[i] = (spread < 25 && mid >= 70 && mid <= 185) ? 1 : 0;
    }
    return mask;
  },

  _labelBlobsWithPixels(mask, w, h) {
    const labels = new Int32Array(w * h).fill(-1);
    const blobs = [];
    let next = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (!mask[idx] || labels[idx] >= 0) continue;
        const label = next++;
        const queue = [[x, y]];
        const pixels = [];
        labels[idx] = label;
        while (queue.length) {
          const [cx, cy] = queue.pop();
          pixels.push([cx, cy]);
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = cx+dx, ny = cy+dy;
            if (nx<0||nx>=w||ny<0||ny>=h) continue;
            const n = ny*w+nx;
            if (mask[n] && labels[n] < 0) {
              labels[n] = label;
              queue.push([nx, ny]);
            }
          }
        }
        if (pixels.length >= 30) blobs.push({ pixels, pixelCount: pixels.length });
      }
    }
    return blobs;
  },

  // Oriented bounding box via PCA sur les pixels du blob
  _orientedBox(pixels) {
    if (pixels.length < 4) return null;
    let sumX = 0, sumY = 0;
    for (const [x, y] of pixels) { sumX += x; sumY += y; }
    const cx = sumX / pixels.length, cy = sumY / pixels.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const [x, y] of pixels) {
      const dx = x - cx, dy = y - cy;
      sxx += dx*dx; sxy += dx*dy; syy += dy*dy;
    }
    const n = pixels.length;
    sxx /= n; sxy /= n; syy /= n;
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const cos = Math.cos(theta), sin = Math.sin(theta);
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const [x, y] of pixels) {
      const a =  (x - cx) * cos + (y - cy) * sin;
      const b = -(x - cx) * sin + (y - cy) * cos;
      if (a < minA) minA = a; if (a > maxA) maxA = a;
      if (b < minB) minB = b; if (b > maxB) maxB = b;
    }
    const toXY = (a, b) => [
      cx + a * cos - b * sin,
      cy + a * sin + b * cos,
    ];
    return {
      corners: [toXY(minA, minB), toXY(maxA, minB), toXY(maxA, maxB), toXY(minA, maxB)],
      lengthA: maxA - minA,
      lengthB: maxB - minB,
    };
  },

  async _loadLidarPts(sessionId) {
    const cache = window.LidarCache;
    const terrain = window.SessionManager?._data?.terrain || window.SessionManager?.getTerrain?.();
    if (!cache || !terrain?.parcelle_geojson || !sessionId) return null;
    try {
      const rec = await cache.getPoints({
        sessionId, geojson: terrain.parcelle_geojson, classes: '2,3,4,5,6,9',
      });
      return rec?.points ?? null;
    } catch { return null; }
  },

  _pointInPolygon(lng, lat, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const hit = ((yi > lat) !== (yj > lat))
        && (lng < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi);
      if (hit) inside = !inside;
    }
    return inside;
  },

  _fetchImageData(url, w, h) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        try { resolve(ctx.getImageData(0, 0, w, h)); }
        catch (e) { reject(e); }
      };
      img.onerror = reject;
      img.src = url;
    });
  },

  // Helper rendu Mapbox : pousser un GeoJSON polygones gris translucides
  renderOnMap(map, detections) {
    const SOURCE = 'parking-detected';
    const LAYER_FILL = 'parking-fill';
    const LAYER_STROKE = 'parking-stroke';

    const fc = {
      type: 'FeatureCollection',
      features: detections.map((d, i) => ({
        type: 'Feature',
        id: i,
        geometry: { type: 'Polygon', coordinates: [[...d.polygon, d.polygon[0]]] },
        properties: { area_m2: d.area_m2, aspectRatio: d.aspectRatio, groundRatio: d.groundRatio },
      })),
    };

    const src = map.getSource(SOURCE);
    if (src) src.setData(fc);
    else map.addSource(SOURCE, { type: 'geojson', data: fc });

    if (!map.getLayer(LAYER_FILL)) {
      map.addLayer({
        id: LAYER_FILL, type: 'fill', source: SOURCE,
        paint: {
          'fill-color': '#4a4a4a',
          'fill-opacity': 0.45,
        },
      });
    }
    if (!map.getLayer(LAYER_STROKE)) {
      map.addLayer({
        id: LAYER_STROKE, type: 'line', source: SOURCE,
        paint: {
          'line-color': '#2a2a2a',
          'line-width': 1.5,
          'line-dasharray': [2, 2],
        },
      });
    }
  },

  removeFromMap(map) {
    ['parking-stroke', 'parking-fill'].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource('parking-detected')) map.removeSource('parking-detected');
  },
};

if (typeof window !== 'undefined') window.ParkingDetection = ParkingDetection;
export default ParkingDetection;
