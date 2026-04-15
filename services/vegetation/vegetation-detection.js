'use strict';
/**
 * TERLAB × BPF — VegetationDetection service
 * OBIA (ortho IGN WMS) + LiDAR CHM (COPC) + merge + suggestSpecies
 * Port Vanilla JS de terlab-vegetation/services/vegetation-detection.service.ts
 */

import VegetationSpecies from './vegetation-species.js';

const IGN_ORTHO_WMS   = 'https://data.geopf.fr/wms-r/wms';
const IGN_ORTHO_LAYER = 'HR.ORTHOIMAGERY.ORTHOPHOTOS';
const DEFAULT_CONFIG = {
  source:           'obia',
  ndviThreshold:    0.28,
  minBlobArea_m2:   2,
  maxBlobArea_m2:   300,
  lidarMinHeight_m: 2.0,
  clusterEpsilon_m: 1.5,
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

const VegetationDetection = {

  async detect(bbox, centroid, altitude, biome, sessionId, config = {}) {
    await VegetationSpecies.load();
    const cfg = Object.assign({}, DEFAULT_CONFIG, config);
    const [refLng, refLat] = centroid;

    let features = [];
    if (cfg.source === 'obia' || cfg.source === 'manual') {
      features = await this._detectOBIA(bbox, centroid, cfg);
    }
    if (cfg.source === 'lidar') {
      features = await this._detectLiDAR(bbox, centroid, cfg);
    }

    features = this._clusterDeduplicate(features, cfg.clusterEpsilon_m);

    features = features.map(f => {
      const candidates = VegetationSpecies.suggestSpecies(
        f.heightMeasured != null ? f.heightMeasured : 10,
        f.canopyRadiusMeasured, altitude, biome
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

  async _detectOBIA(bbox, centroid, cfg) {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const [, refLat] = centroid;
    const IMG_SIZE = 512;

    const wmsUrl = `${IGN_ORTHO_WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap`
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

  async _detectLiDAR(bbox, centroid, cfg) {
    const COPCReader = window.COPCReader;
    if (!COPCReader) {
      console.warn('[VegDetect] COPCReader absent, fallback OBIA');
      return this._detectOBIA(bbox, centroid, cfg);
    }
    const [refLng, refLat] = centroid;
    const GRID_RES = 0.5;
    const pts = await COPCReader.readBBox(bbox, { classification: [4, 5] });
    if (!pts || !pts.length) return this._demoFeatures(centroid);

    const gridW = 80, gridH = 80;
    const chm = new Float32Array(gridW * gridH);
    const LNG_M = 111320 * Math.cos(refLat * Math.PI / 180);
    const LAT_M = 111320;
    for (const pt of pts) {
      const lx = (pt.lng - refLng) * LNG_M;
      const ly = -(pt.lat - refLat) * LAT_M;
      const gi = Math.floor(lx / GRID_RES + gridW / 2);
      const gj = Math.floor(ly / GRID_RES + gridH / 2);
      if (gi < 0 || gi >= gridW || gj < 0 || gj >= gridH) continue;
      const idx = gj * gridW + gi;
      if (pt.z > chm[idx]) chm[idx] = pt.z;
    }

    const features = [];
    const visited = new Uint8Array(gridW * gridH);
    for (let j = 1; j < gridH - 1; j++) {
      for (let i = 1; i < gridW - 1; i++) {
        const idx = j * gridW + i;
        const h = chm[idx];
        if (h < cfg.lidarMinHeight_m || visited[idx]) continue;

        let isMax = true;
        for (let dj = -1; dj <= 1 && isMax; dj++) {
          for (let di = -1; di <= 1 && isMax; di++) {
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

        features.push({
          id: `lidar_${Math.random().toString(36).slice(2)}`,
          position: [lng, lat],
          canopyRadiusMeasured: Math.round(canopyRadius * 10) / 10,
          heightMeasured: Math.round(h * 10) / 10,
          canopyArea: Math.round(Math.PI * canopyRadius * canopyRadius),
          status: 'existing_keep',
          source: 'lidar',
          timestamp: new Date().toISOString(),
        });
      }
    }
    return features;
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
