'use strict';
/**
 * TERLAB × BPF — VegetationDetection service
 * OBIA (ortho IGN WMS) + LiDAR CHM (COPC) + merge + suggestSpecies
 * Port Vanilla JS de terlab-vegetation/services/vegetation-detection.service.ts
 */

import VegetationSpecies from './vegetation-species.js';

const IGN_WMS         = 'https://data.geopf.fr/wms-r/wms';
const IGN_ORTHO_LAYER = 'HR.ORTHOIMAGERY.ORTHOPHOTOS';
const IGN_COSIA_LAYER = 'IGNF_COSIA_2021-2023';
const DEFAULT_CONFIG = {
  source:           'obia',
  ndviThreshold:    0.28,
  minBlobArea_m2:   4,         // rejet buissons < ~1.1m rayon
  maxBlobArea_m2:   300,
  lidarMinHeight_m: 3.0,       // rejet arbustes < 3m de haut
  clusterEpsilon_m: 3.0,       // merge detections < 3m = meme arbre
  gridRes_m:        1.0,       // CHM grid 1m (smooth, evite faux peaks par branche)
  peakNeighborhood: 2,         // local-max sur fenetre 5x5 (au lieu 3x3)
};

function wgs84ToLocal(lng, lat, refLng, refLat) {
  const LNG_M = 111320 * Math.cos(refLat * Math.PI / 180);
  const LAT_M = 111320;
  return { x: (lng - refLng) * LNG_M, y: -(lat - refLat) * LAT_M };
}
function localToWgs84(x, y, refLng, refLat) {
  const LNG_M = 111320 * Math.cos(refLat * Math.PI / 180);
  const LAT_M = 111320;
  return [refLng + x / LNG_M, refLat - y / LAT_M];
}

// Point-in-polygon ray casting (lng/lat en WGS84, polygon = [[lng,lat], ...])
function pointInPolygon(lng, lat, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Extrait le premier ring du parcelle_geojson (Polygon ou MultiPolygon)
function extractParcelRing(geojson) {
  const g = geojson?.geometry || geojson;
  if (!g?.coordinates) return null;
  if (g.type === 'Polygon')       return g.coordinates[0];
  if (g.type === 'MultiPolygon')  return g.coordinates[0]?.[0];
  return null;
}

const VegetationDetection = {

  async detect(bbox, centroid, altitude, biome, sessionId, config = {}) {
    await VegetationSpecies.load();
    const cfg = Object.assign({}, DEFAULT_CONFIG, config);
    const [refLng, refLat] = centroid;

    let features = [];
    if (cfg.source === 'cosia' || cfg.source === 'obia' || cfg.source === 'manual') {
      features = await this._detectCOSIA(bbox, centroid, cfg);
    }
    if (cfg.source === 'lidar') {
      features = await this._detectLiDAR(bbox, centroid, cfg, sessionId);
    }

    // Clip a la parcelle (le user ne veut que son terrain, pas le voisinage)
    const terrain = window.SessionManager?._data?.terrain || window.SessionManager?.getTerrain?.();
    const parcelRing = extractParcelRing(terrain?.parcelle_geojson);
    if (parcelRing && parcelRing.length >= 3) {
      const before = features.length;
      features = features.filter(f => pointInPolygon(f.position[0], f.position[1], parcelRing));
      console.info(`[VegDetect] clip parcelle : ${features.length}/${before} arbres conserves`);
    }

    features = this._clusterDeduplicate(features, cfg.clusterEpsilon_m);

    const isCoastal = typeof altitude === 'number' && altitude < 100;
    features = features.map(f => {
      const candidates = VegetationSpecies.suggestSpecies(
        f.heightMeasured != null ? f.heightMeasured : 10,
        f.canopyRadiusMeasured, altitude, biome, 3,
        { palmLikelihood: f.palmLikelihood || 0, isCoastal }
      );
      return {
        ...f,
        positionLocal: wgs84ToLocal(f.position[0], f.position[1], refLng, refLat),
        speciesCandidates: candidates,
        speciesKey: candidates[0] ? candidates[0].speciesKey : undefined,
        speciesConfidence: candidates[0] ? candidates[0].score : undefined,
      };
    });

    return {
      sessionId,
      parcelleCentroid: centroid,
      parcellePolygon: [],
      altitude, biome, features,
      stats: this._computeStats(features, bbox),
      detectionConfig: cfg,
      updatedAt: new Date().toISOString(),
    };
  },

  async _detectCOSIA(bbox, centroid, cfg) {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const [, refLat] = centroid;
    const IMG_SIZE = 1024;

    const wmsUrl = `${IGN_WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap`
      + `&LAYERS=${IGN_COSIA_LAYER}&CRS=EPSG:4326`
      + `&BBOX=${minLat},${minLng},${maxLat},${maxLng}`
      + `&WIDTH=${IMG_SIZE}&HEIGHT=${IMG_SIZE}&FORMAT=image/png&STYLES=`;

    let imgData;
    try { imgData = await this._fetchImageData(wmsUrl, IMG_SIZE, IMG_SIZE); }
    catch (e) {
      console.warn('[VegDetect] COSIA WMS failed, fallback OBIA ortho:', e);
      return this._detectOBIA(bbox, centroid, cfg);
    }

    const mask = this._cosiaVegetationMask(imgData);
    const blobs = this._labelBlobs(mask, IMG_SIZE, IMG_SIZE);
    if (blobs.length === 0) {
      console.warn('[VegDetect] COSIA mask vide, fallback OBIA ortho');
      return this._detectOBIA(bbox, centroid, cfg);
    }

    const features = [];
    const pxToM = (maxLng - minLng) * 111320 * Math.cos(refLat * Math.PI / 180) / IMG_SIZE;
    for (const blob of blobs) {
      const area_m2 = blob.pixelCount * pxToM * pxToM;
      if (area_m2 < cfg.minBlobArea_m2 || area_m2 > cfg.maxBlobArea_m2) continue;

      const lng = minLng + (blob.cx / IMG_SIZE) * (maxLng - minLng);
      const lat = maxLat - (blob.cy / IMG_SIZE) * (maxLat - minLat);
      const canopyRadius = Math.sqrt(area_m2 / Math.PI);

      features.push({
        id: `cosia_${Math.random().toString(36).slice(2)}`,
        position: [lng, lat],
        canopyRadiusMeasured: Math.round(canopyRadius * 10) / 10,
        canopyArea: Math.round(area_m2),
        status: 'existing_keep',
        source: 'cosia',
        timestamp: new Date().toISOString(),
      });
    }
    return features;
  },

  // Masque vegetation depuis raster COSIA IGN (IA-segmente).
  // Classes vegetation = Conifères / Feuillus / Broussailles (tons verts dominants).
  // Exclut classes non-vert : cultures (jaune), vignes (magenta), sol (tan), eau (bleu), bati (rouge).
  _cosiaVegetationMask(imgData) {
    const { data, width, height } = imgData;
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const R = data[i*4], G = data[i*4+1], B = data[i*4+2], A = data[i*4+3];
      if (A < 128) continue;
      const greenDom = G > R + 10 && G > B + 10 && G > 50;
      const notOliveCrop = !(R > 150 && G > 150 && B < 120 && Math.abs(R - G) < 40);
      mask[i] = (greenDom && notOliveCrop) ? 1 : 0;
    }
    return mask;
  },

  async _detectOBIA(bbox, centroid, cfg) {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const [, refLat] = centroid;
    const IMG_SIZE = 512;

    const wmsUrl = `${IGN_WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap`
      + `&LAYERS=${IGN_ORTHO_LAYER}&CRS=EPSG:4326`
      + `&BBOX=${minLat},${minLng},${maxLat},${maxLng}`
      + `&WIDTH=${IMG_SIZE}&HEIGHT=${IMG_SIZE}&FORMAT=image/png&STYLES=`;

    let imgData;
    try { imgData = await this._fetchImageData(wmsUrl, IMG_SIZE, IMG_SIZE); }
    catch (e) {
      console.warn('[VegDetect] OBIA WMS failed, demo fallback:', e);
      return this._demoFeatures(centroid);
    }

    const mask = this._computeVegetationMask(imgData, cfg.ndviThreshold);
    const blobs = this._labelBlobs(mask, IMG_SIZE, IMG_SIZE);

    const features = [];
    const pxToM = (maxLng - minLng) * 111320 * Math.cos(refLat * Math.PI / 180) / IMG_SIZE;
    for (const blob of blobs) {
      const area_m2 = blob.pixelCount * pxToM * pxToM;
      if (area_m2 < cfg.minBlobArea_m2 || area_m2 > cfg.maxBlobArea_m2) continue;

      const lng = minLng + (blob.cx / IMG_SIZE) * (maxLng - minLng);
      const lat = maxLat - (blob.cy / IMG_SIZE) * (maxLat - minLat);
      const canopyRadius = Math.sqrt(area_m2 / Math.PI);

      features.push({
        id: `obia_${Math.random().toString(36).slice(2)}`,
        position: [lng, lat],
        canopyRadiusMeasured: Math.round(canopyRadius * 10) / 10,
        canopyArea: Math.round(area_m2),
        status: 'existing_keep',
        source: 'obia',
        timestamp: new Date().toISOString(),
      });
    }
    return features;
  },

  async _detectLiDAR(bbox, centroid, cfg, sessionId) {
    const [refLng, refLat] = centroid;
    const GRID_RES = cfg.gridRes_m || 1.0;
    const PEAK_NBR = cfg.peakNeighborhood || 2;

    // Priorite : points deja charges par P01 dans LidarCache (arrays [lng,lat,z,r,g,b,cls])
    // Fallback : COPCReader (si dispo), sinon COSIA WMS
    let pts = null;
    let groundZ = null; // altitude sol (min Z classe 2) pour normaliser CHM
    const cache = window.LidarCache;
    const terrain = window.SessionManager?._data?.terrain || window.SessionManager?.getTerrain?.();
    if (cache && terrain?.parcelle_geojson && sessionId) {
      try {
        const rec = await cache.getPoints({
          sessionId,
          geojson: terrain.parcelle_geojson,
          classes: '2,3,4,5,6,9',
        });
        if (rec?.points?.length) {
          const groundPts = rec.points.filter(p => p[6] === 2);
          if (groundPts.length) {
            let sum = 0; for (const p of groundPts) sum += p[2];
            groundZ = sum / groundPts.length;
          }
          // Classes LiDAR 4+5 + filtre RGB : rejette toits/murs mis-classifies
          // (si couleur satellite pas verte, c'est pas de la vegetation)
          pts = rec.points
            .filter(p => p[6] === 4 || p[6] === 5)
            .map(p => ({ lng: p[0], lat: p[1], z: p[2], r: p[3], g: p[4], b: p[5] }))
            .filter(p => {
              // RGB LiDAR peut etre en [0..255] ou [0..1] normalise selon colorisation
              const scale = (p.r > 1 || p.g > 1 || p.b > 1) ? 1 : 255;
              const R = p.r * scale, G = p.g * scale, B = p.b * scale;
              // Accepter si vert dominant OU si pas de couleur (RGB=0 = pas colorise, on garde)
              const hasColor = (R + G + B) > 10;
              if (!hasColor) return true;
              return G > R - 5 && G > B - 5 && G > 30;
            });
          console.info(`[VegDetect] LidarCache : ${pts.length} pts vegetation verts (classes 4,5) · sol moy ${groundZ?.toFixed(1)}m`);
        }
      } catch (e) { console.warn('[VegDetect] LidarCache lookup failed:', e); }
    }

    if (!pts || !pts.length) {
      const COPCReader = window.COPCReader;
      if (COPCReader) {
        try { pts = await COPCReader.readBBox(bbox, { classification: [4, 5] }); }
        catch (e) { console.warn('[VegDetect] COPCReader failed:', e); }
      }
    }

    if (!pts || !pts.length) {
      console.warn('[VegDetect] Aucun point LiDAR vegetation, fallback COSIA');
      return this._detectCOSIA(bbox, centroid, cfg);
    }

    // Normaliser Z en height-above-ground (CHM) si on a le sol
    if (groundZ == null) {
      let minZ = Infinity;
      for (const p of pts) if (p.z < minZ) minZ = p.z;
      groundZ = minZ;
    }
    for (const p of pts) p.z = Math.max(0, p.z - groundZ);

    const gridW = 80, gridH = 80;
    const chm = new Float32Array(gridW * gridH);
    const LNG_M = 111320 * Math.cos(refLat * Math.PI / 180);
    const LAT_M = 111320;
    // Pre-convertir en coords locales (metres) pour reuse dans _trunkHollowness
    for (const pt of pts) {
      pt.lx = (pt.lng - refLng) * LNG_M;
      pt.ly = -(pt.lat - refLat) * LAT_M;
      const gi = Math.floor(pt.lx / GRID_RES + gridW / 2);
      const gj = Math.floor(pt.ly / GRID_RES + gridH / 2);
      if (gi < 0 || gi >= gridW || gj < 0 || gj >= gridH) continue;
      const idx = gj * gridW + gi;
      if (pt.z > chm[idx]) chm[idx] = pt.z;
    }

    const features = [];
    const visited = new Uint8Array(gridW * gridH);
    for (let j = PEAK_NBR; j < gridH - PEAK_NBR; j++) {
      for (let i = PEAK_NBR; i < gridW - PEAK_NBR; i++) {
        const idx = j * gridW + i;
        const h = chm[idx];
        if (h < cfg.lidarMinHeight_m || visited[idx]) continue;

        // Local-max sur voisinage (2*PEAK_NBR+1) x (...) — peak dominant
        let isMax = true;
        for (let dj = -PEAK_NBR; dj <= PEAK_NBR && isMax; dj++) {
          for (let di = -PEAK_NBR; di <= PEAK_NBR && isMax; di++) {
            if (di === 0 && dj === 0) continue;
            if (chm[(j + dj) * gridW + (i + di)] > h) isMax = false;
          }
        }
        if (!isMax) continue;

        let r = 1;
        while (r < 15) {
          let minH = Infinity;
          for (let dj = -r; dj <= r; dj++) {
            for (let di = -r; di <= r; di++) {
              if (Math.round(Math.sqrt(di*di+dj*dj)) !== r) continue;
              const ni = i+di, nj = j+dj;
              if (ni<0||ni>=gridW||nj<0||nj>=gridH) continue;
              minH = Math.min(minH, chm[nj*gridW+ni]);
            }
          }
          if (minH < h * 0.45) break;
          r++;
        }
        for (let dj = -r; dj <= r; dj++) {
          for (let di = -r; di <= r; di++) {
            const ni = i+di, nj = j+dj;
            if (ni>=0&&ni<gridW&&nj>=0&&nj<gridH) visited[nj*gridW+ni] = 1;
          }
        }

        const lx = (i - gridW/2) * GRID_RES;
        const ly = (j - gridH/2) * GRID_RES;
        const [lng, lat] = localToWgs84(lx, ly, refLng, refLat);
        const canopyRadius = Math.max(1, (r - 1) * GRID_RES);

        // Signature palmier : peak aigu + sous-canopee vide
        // 1. Peak sharpness : chute d'altitude rapide (a 2m du peak, le CHM descend ≥55%)
        const sharpness = this._peakSharpness(chm, gridW, gridH, i, j, h);
        // 2. Trunk hollowness : fraction de points LiDAR entre 1m et 0.6*h dans rayon canopy
        const hollow = this._trunkHollowness(pts, lx, ly, canopyRadius, h);
        // Combiner : les palmiers ont sharpness > 0.55 ET hollow > 0.7
        const palmLikelihood = Math.max(0, Math.min(1,
          (sharpness - 0.4) * 1.2 + (hollow - 0.5) * 1.0
        ));

        features.push({
          id: `lidar_${Math.random().toString(36).slice(2)}`,
          position: [lng, lat],
          canopyRadiusMeasured: Math.round(canopyRadius * 10) / 10,
          heightMeasured: Math.round(h * 10) / 10,
          canopyArea: Math.round(Math.PI * canopyRadius * canopyRadius),
          status: 'existing_keep',
          source: 'lidar',
          palmLikelihood: Math.round(palmLikelihood * 100) / 100,
          sharpness: Math.round(sharpness * 100) / 100,
          hollow: Math.round(hollow * 100) / 100,
          timestamp: new Date().toISOString(),
        });
      }
    }
    const palmCount = features.filter(f => f.palmLikelihood > 0.5).length;
    if (palmCount) console.info(`[VegDetect] Signature palmier detectee : ${palmCount}/${features.length} arbres`);
    return features;
  },

  // Mesure la nettete du peak : a 2m du sommet, a quel point le CHM descend ?
  // Retourne 0 (canopee plate = feuillus etendu) a 1 (peak ponctuel = palmier)
  _peakSharpness(chm, gridW, gridH, i, j, peakH) {
    if (peakH < 1) return 0;
    const ring = 2; // 2 cellules = ~2m avec GRID_RES 1.0
    let sum = 0, count = 0;
    for (let dj = -ring; dj <= ring; dj++) {
      for (let di = -ring; di <= ring; di++) {
        const d = Math.round(Math.sqrt(di*di + dj*dj));
        if (d !== ring) continue;
        const ni = i+di, nj = j+dj;
        if (ni<0||ni>=gridW||nj<0||nj>=gridH) continue;
        sum += chm[nj*gridW+ni]; count++;
      }
    }
    if (!count) return 0;
    const avgRing = sum / count;
    // Sharpness = 1 - (avg ring / peak). Palmier ~0.6-0.8, feuillus dense ~0.1-0.3.
    return Math.max(0, 1 - avgRing / peakH);
  },

  // Mesure si le tronc est creux : peu de points LiDAR dans la tranche 1m < z < 0.6*h
  // Retourne 0 (sous-canopee pleine = feuillus) a 1 (tronc vide = palmier)
  // pts[] doivent avoir {lx, ly, z} en coords locales metres (height-above-ground)
  _trunkHollowness(pts, localX, localY, radiusM, peakH) {
    if (peakH < 5 || !pts?.length) return 0;
    const r2 = radiusM * radiusM * 1.5; // zone elargie pour capturer les fronds
    const zTrunkMax = peakH * 0.6;
    let canopyPts = 0, trunkPts = 0;
    for (const p of pts) {
      if (p.lx == null) continue;
      const dx = p.lx - localX;
      const dy = p.ly - localY;
      if (dx*dx + dy*dy > r2) continue;
      if (p.z >= peakH * 0.75) canopyPts++;
      else if (p.z > 1 && p.z <= zTrunkMax) trunkPts++;
    }
    if (canopyPts + trunkPts < 5) return 0;
    return canopyPts / (canopyPts + trunkPts * 3);
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

  _computeVegetationMask(imgData, threshold) {
    const { data, width, height } = imgData;
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const R = data[i*4], G = data[i*4+1], B = data[i*4+2];
      const ndvi_vis = (G - R) / (G + R + 1);
      mask[i] = (ndvi_vis > threshold && G > 60 && G > B) ? 1 : 0;
    }
    return mask;
  },

  _labelBlobs(mask, w, h) {
    const labels = new Int32Array(w * h).fill(-1);
    const blobs = [];
    let nextLabel = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (!mask[idx] || labels[idx] >= 0) continue;
        const label = nextLabel++;
        const queue = [idx];
        let sumX = 0, sumY = 0, count = 0;
        labels[idx] = label;
        while (queue.length) {
          const cur = queue.pop();
          const cy = Math.floor(cur / w), cx = cur % w;
          sumX += cx; sumY += cy; count++;
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = cx+dx, ny = cy+dy;
            if (nx<0||nx>=w||ny<0||ny>=h) continue;
            const nIdx = ny*w+nx;
            if (mask[nIdx] && labels[nIdx] < 0) {
              labels[nIdx] = label;
              queue.push(nIdx);
            }
          }
        }
        if (count >= 4) blobs.push({ cx: sumX/count, cy: sumY/count, pixelCount: count });
      }
    }
    return blobs;
  },

  _clusterDeduplicate(features, epsilonM) {
    const result = [];
    const used = new Set();
    const LNG_M = 111320;
    for (let i = 0; i < features.length; i++) {
      if (used.has(i)) continue;
      used.add(i);
      const [lng0, lat0] = features[i].position;
      let rSum = features[i].canopyRadiusMeasured;
      let hSum = features[i].heightMeasured || 0;
      let n = 1;
      for (let j = i+1; j < features.length; j++) {
        if (used.has(j)) continue;
        const [lng1, lat1] = features[j].position;
        const dx = (lng1-lng0)*LNG_M, dy = (lat1-lat0)*LNG_M;
        if (Math.hypot(dx,dy) < epsilonM) {
          used.add(j);
          rSum += features[j].canopyRadiusMeasured;
          hSum += features[j].heightMeasured || 0;
          n++;
        }
      }
      result.push({
        ...features[i],
        canopyRadiusMeasured: Math.round(rSum/n*10)/10,
        heightMeasured: n > 1 ? Math.round(hSum/n*10)/10 : features[i].heightMeasured,
      });
    }
    return result;
  },

  _demoFeatures(centroid) {
    const [refLng, refLat] = centroid;
    const LNG_M = 111320 * Math.cos(refLat * Math.PI / 180);
    const LAT_M = 111320;
    const demoTrees = [
      { dx: -8, dy: 6, r: 4.2, h: 14 },   { dx: 5, dy: -10, r: 2.8, h: 9 },
      { dx: 12, dy: 3, r: 6.5, h: 12 },   { dx: -3, dy: -7, r: 1.8, h: 7 },
      { dx: 8, dy: 12, r: 3.5, h: 11 },   { dx: -14, dy: 1, r: 5.0, h: 16 },
      { dx: 2, dy: 15, r: 2.2, h: 8 },
    ];
    return demoTrees.map(t => ({
      id: `demo_${Math.random().toString(36).slice(2)}`,
      position: [refLng + t.dx / LNG_M, refLat - t.dy / LAT_M],
      canopyRadiusMeasured: t.r,
      heightMeasured: t.h,
      canopyArea: Math.round(Math.PI * t.r * t.r),
      status: 'existing_keep',
      source: 'obia',
      timestamp: new Date().toISOString(),
    }));
  },

  computeStats(features, bbox) { return this._computeStats(features, bbox); },

  _computeStats(features, bbox) {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const LNG_M = 111320 * Math.cos(minLat * Math.PI / 180);
    const parcelArea_m2 = (maxLng-minLng)*LNG_M * (maxLat-minLat)*111320;

    const existing = features.filter(f => f.status && f.status.startsWith('existing'));
    const keep     = features.filter(f => f.status === 'existing_keep');
    const cut      = features.filter(f => f.status === 'existing_cut');
    const newTrees = features.filter(f => f.status && f.status.startsWith('new'));

    const canopyArea = arr => arr.reduce((s, f) => s + Math.PI * f.canopyRadiusMeasured ** 2, 0);
    const speciesBefore = new Set(existing.map(f => f.speciesKey).filter(Boolean));
    const speciesAfter  = new Set([...keep, ...newTrees].map(f => f.speciesKey).filter(Boolean));
    const endemicAfter  = [...speciesAfter].filter(k => {
      const sp = VegetationSpecies.get(k);
      return sp && (sp.origin === 'endemic' || sp.origin === 'indigenous');
    });

    const coverBefore = canopyArea(existing);
    const coverAfter  = canopyArea([...keep, ...newTrees]);

    const warnings = [];
    for (const f of features) {
      if (!f.speciesKey) continue;
      const sp = VegetationSpecies.get(f.speciesKey);
      if (!sp) continue;
      if (f.status === 'existing_cut' && (sp.origin === 'endemic' || sp.origin === 'indigenous')) {
        warnings.push({
          type: 'protected_species_cut', featureId: f.id, severity: 'error',
          message: `${sp.commonName} protégée — abattage nécessite dérogation`,
        });
      }
      if (sp.origin === 'invasive' && f.status && f.status.startsWith('new')) {
        warnings.push({
          type: 'invasive_species', featureId: f.id, severity: 'warning',
          message: `${sp.commonName} est listée invasive — éviter plantation`,
        });
      }
    }

    return {
      totalExisting: existing.length, totalKeep: keep.length,
      totalCut: cut.length, totalNew: newTrees.length,
      canopyCoverBefore_m2: Math.round(coverBefore),
      canopyCoverAfter_m2:  Math.round(coverAfter),
      canopyCoverDelta_pct: Math.round((coverAfter - coverBefore) / Math.max(1, coverBefore) * 100),
      permeabilityBefore_pct: Math.round(coverBefore / Math.max(1, parcelArea_m2) * 100),
      permeabilityAfter_pct:  Math.round(coverAfter  / Math.max(1, parcelArea_m2) * 100),
      permeabilityPLU_min_pct: 25,
      speciesCountBefore: speciesBefore.size,
      speciesCountAfter:  speciesAfter.size,
      endemicCountAfter:  endemicAfter.length,
      warnings,
    };
  },
};

export default VegetationDetection;
export { wgs84ToLocal, localToWgs84 };

if (typeof window !== 'undefined') {
  window.VegetationDetection = VegetationDetection;
}
