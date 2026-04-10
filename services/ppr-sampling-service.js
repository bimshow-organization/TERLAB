// TERLAB · services/ppr-sampling-service.js
// Multi-point PPR zone detection on parcel — offscreen WMS image sampling
// Détecte les zones PPRN (R1/R2/B1/B2/J/W) couvrant la parcelle
// via une image WMS dédiée (PPR seul, fond transparent) sur canvas offscreen
// ════════════════════════════════════════════════════════════════════

import PPRService from './ppr-service.js';

const PPRSamplingService = {

  // ── Couleurs PPRN attendues sur la couche WMS PEIGEO ──────────
  // Calibrées sur ppr_approuve (AGORAH) — rouge/bleu/jaune
  ZONE_COLOR_MAP: {
    R1: { r: 230, g: 50,  b: 50,  label: 'Rouge fort — INCONSTRUCTIBLE',       color: '#ef4444', inconstructible: true  },
    R2: { r: 240, g: 100, b: 100, label: 'Rouge modéré — INCONSTRUCTIBLE',     color: '#f87171', inconstructible: true  },
    B1: { r: 50,  g: 100, b: 230, label: 'Bleu fort — conditions strictes',    color: '#3b82f6', inconstructible: false },
    B2: { r: 90,  g: 150, b: 250, label: 'Bleu modéré — conditions',           color: '#60a5fa', inconstructible: false },
    J:  { r: 240, g: 190, b: 40,  label: 'Jaune — vigilance',                  color: '#fbbf24', inconstructible: false },
  },

  // Taille de l'image WMS dédiée pour l'échantillonnage
  _WMS_IMG_SIZE: 512,

  // ── METHODE PRINCIPALE ─────────────────────────────────────────
  // parcelGeo : [[lng,lat], ...] — sommets parcelle WGS84
  // map       : mapboxgl.Map instance (utilisé uniquement en dernier recours)
  // Returns   : { zones: { R1?: {pts, area_pct}, ... }, grid: [{lng,lat,zone}], dominant }
  async sampleParcel(parcelGeo, map) {
    if (!parcelGeo?.length || parcelGeo.length < 3) {
      return { zones: {}, grid: [], dominant: 'W', hasInconstructible: false };
    }

    // PEIGEO indisponible (HTTPS context) → pas de sampling possible.
    if (PPRService.disabled) {
      return { zones: {}, grid: [], dominant: 'W', hasInconstructible: false, disabled: true };
    }

    // 1. Calculer la bbox et la grille d'échantillonnage
    const bbox = this._bbox(parcelGeo);
    const gridPoints = this._buildGrid(parcelGeo, bbox, 3); // pas de 3m

    if (!gridPoints.length) {
      return { zones: {}, grid: [], dominant: 'W', hasInconstructible: false };
    }

    const sampledGrid = gridPoints.map(pt => ({ ...pt, zone: null }));

    // 2. Méthode primaire : image WMS offscreen (PPR seul, fond transparent)
    //    Une seule requête HTTP → canvas offscreen → sampling fiable
    const offscreenOk = await this._sampleFromWMSImage(sampledGrid, bbox);

    // 3. Fallback : WMS GetFeatureInfo sur quelques sondes si l'image a échoué
    if (!offscreenOk) {
      const wmsProbes = this._selectWMSProbes(gridPoints, 8);
      for (const probe of wmsProbes) {
        try {
          const result = await PPRService.queryPoint(probe.lat, probe.lng);
          if (result.features?.length) {
            const props = result.features[0].properties ?? {};
            const z = this._parseWMSZone(props);
            if (z) {
              const match = sampledGrid.find(p => p.lng === probe.lng && p.lat === probe.lat);
              if (match) { match.zone = z; match.source = 'wms'; }
              this._propagateZone(sampledGrid, probe, z, 0.00005);
            }
          }
        } catch { /* WMS indisponible */ }
      }
    }

    // 4. Agréger par zone
    const zones = {};
    let totalClassified = 0;
    for (const pt of sampledGrid) {
      if (!pt.zone) continue;
      totalClassified++;
      if (!zones[pt.zone]) zones[pt.zone] = { pts: [], count: 0 };
      zones[pt.zone].pts.push(pt);
      zones[pt.zone].count++;
    }

    // Calculer % de couverture
    for (const [z, data] of Object.entries(zones)) {
      data.area_pct = totalClassified > 0
        ? Math.round(data.count / totalClassified * 100)
        : 0;
      data.color = this.ZONE_COLOR_MAP[z]?.color ?? '#e2e8f0';
      data.inconstructible = this.ZONE_COLOR_MAP[z]?.inconstructible ?? false;
      data.label = this.ZONE_COLOR_MAP[z]?.label ?? `Zone ${z}`;
    }

    // Zone dominante
    let dominant = 'W';
    let maxCount = 0;
    for (const [z, data] of Object.entries(zones)) {
      if (data.count > maxCount) { maxCount = data.count; dominant = z; }
    }

    const hasInconstructible = Object.values(zones).some(z => z.inconstructible);

    return { zones, grid: sampledGrid, dominant, hasInconstructible, totalPoints: sampledGrid.length };
  },

  // ── IMAGE WMS OFFSCREEN ────────────────────────────────────────
  // Fetch une image GetMap PPR-only pour la bbox, dessine sur canvas
  // offscreen, puis sample chaque point de la grille sur cette image isolée.
  // Retourne true si succès, false si échec (CORS, réseau, etc.)
  async _sampleFromWMSImage(sampledGrid, bbox) {
    const SIZE = this._WMS_IMG_SIZE;

    // Convertir bbox WGS84 → EPSG:3857
    const toMerc = (lng, lat) => {
      const mx = lng * 20037508.34 / 180;
      const latR = lat * Math.PI / 180;
      const my = Math.log(Math.tan(Math.PI / 4 + latR / 2)) / Math.PI * 20037508.34;
      return [mx, my];
    };

    // Marge 20% autour de la parcelle pour capter les zones en bordure
    const margin = 0.2;
    const dLng = (bbox.maxLng - bbox.minLng) * margin;
    const dLat = (bbox.maxLat - bbox.minLat) * margin;
    const [mxMin, myMin] = toMerc(bbox.minLng - dLng, bbox.minLat - dLat);
    const [mxMax, myMax] = toMerc(bbox.maxLng + dLng, bbox.maxLat + dLat);

    const wmsUrl = `${PPRService.WMS_URL}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap`
      + `&LAYERS=ppr_approuve&FORMAT=image/png&TRANSPARENT=true`
      + `&SRS=EPSG:3857&WIDTH=${SIZE}&HEIGHT=${SIZE}`
      + `&BBOX=${mxMin},${myMin},${mxMax},${myMax}`;

    try {
      // Charger l'image
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload  = () => resolve(image);
        image.onerror = () => reject(new Error('Image load failed'));
        image.src = wmsUrl;
      });

      // Dessiner sur canvas offscreen
      const cv  = document.createElement('canvas');
      cv.width  = SIZE;
      cv.height = SIZE;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const imageData = ctx.getImageData(0, 0, SIZE, SIZE);
      const pixels = imageData.data; // RGBA flat array

      // Mapper chaque point de la grille vers un pixel de l'image
      for (const pt of sampledGrid) {
        const [mx, my] = toMerc(pt.lng, pt.lat);

        // Coordonnées pixel dans l'image (0..SIZE-1)
        const px = Math.floor((mx - mxMin) / (mxMax - mxMin) * (SIZE - 1));
        // WMS image: Y=0 est en haut (nord), Y inversé par rapport à Mercator
        const py = Math.floor((myMax - my) / (myMax - myMin) * (SIZE - 1));

        if (px < 0 || px >= SIZE || py < 0 || py >= SIZE) continue;

        const idx = (py * SIZE + px) * 4;
        const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2], a = pixels[idx + 3];

        // Pixel transparent = pas de zone PPR ici
        if (a < 50) continue;

        const zone = this._classifyColor(r, g, b);
        if (zone) {
          pt.zone = zone;
          pt.source = 'wms-image';
        }
      }

      return true;
    } catch (e) {
      console.warn('[PPRSampling] Image WMS offscreen failed:', e.message);
      return false;
    }
  },

  // ── GRILLE D'ÉCHANTILLONNAGE ───────────────────────────────────
  // Crée une grille régulière à l'intérieur du polygone parcelle
  _buildGrid(parcelGeo, bbox, stepMeters) {
    const LAT_M = 111132.954;
    const LNG_M = LAT_M * Math.cos(((bbox.minLat + bbox.maxLat) / 2) * Math.PI / 180);

    const stepLng = stepMeters / LNG_M;
    const stepLat = stepMeters / LAT_M;

    const points = [];
    for (let lat = bbox.minLat; lat <= bbox.maxLat; lat += stepLat) {
      for (let lng = bbox.minLng; lng <= bbox.maxLng; lng += stepLng) {
        if (this._pointInPolygon(lng, lat, parcelGeo)) {
          points.push({ lng, lat });
        }
      }
    }
    return points;
  },

  _bbox(parcelGeo) {
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lng, lat] of parcelGeo) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    return { minLng, maxLng, minLat, maxLat };
  },

  // Ray casting point-in-polygon
  _pointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  },

  // Classifier une couleur RGB vers une zone PPRN
  _classifyColor(r, g, b) {
    let best = null;
    let bestDist = Infinity;

    for (const [zone, ref] of Object.entries(this.ZONE_COLOR_MAP)) {
      const d = Math.sqrt((r - ref.r) ** 2 + (g - ref.g) ** 2 + (b - ref.b) ** 2);
      if (d < bestDist) { bestDist = d; best = zone; }
    }

    // Seuil : si la couleur est trop éloignée, c'est du fond de carte
    if (bestDist > 100) return null;
    return best;
  },

  _parseWMSZone(props) {
    const raw = (props.zone ?? props.alea ?? props.ZONE ?? props.zonage ?? '').toUpperCase();
    if (raw.includes('R1') || raw.includes('ROUGE FORT'))  return 'R1';
    if (raw.includes('R2') || raw.includes('ROUGE'))       return 'R2';
    if (raw.includes('B1') || raw.includes('BLEU FORT'))   return 'B1';
    if (raw.includes('B2') || raw.includes('BLEU'))        return 'B2';
    if (raw.includes('J')  || raw.includes('JAUNE'))       return 'J';
    return null;
  },

  // Propager une zone aux points non classifiés proches
  _propagateZone(grid, source, zone, radius) {
    for (const pt of grid) {
      if (pt.zone) continue;
      const d = Math.hypot(pt.lng - source.lng, pt.lat - source.lat);
      if (d < radius) { pt.zone = zone; pt.source = 'propagated'; }
    }
  },

  // Sélectionner des points WMS stratégiques : centroïde + répartition spatiale
  _selectWMSProbes(gridPoints, maxProbes) {
    if (gridPoints.length <= maxProbes) return gridPoints;
    const cx = gridPoints.reduce((s, p) => s + p.lng, 0) / gridPoints.length;
    const cy = gridPoints.reduce((s, p) => s + p.lat, 0) / gridPoints.length;
    const sorted = [...gridPoints].sort((a, b) =>
      Math.hypot(a.lng - cx, a.lat - cy) - Math.hypot(b.lng - cx, b.lat - cy)
    );
    const probes = [sorted[0]];
    const step = Math.floor(sorted.length / (maxProbes - 1));
    for (let i = step; probes.length < maxProbes && i < sorted.length; i += step) {
      probes.push(sorted[i]);
    }
    return probes;
  },

  // ── CONVERSION VERS POLYGONES LOCAUX ───────────────────────────
  toLocalPolygons(samplingResult, parcelGeo) {
    if (!samplingResult?.grid?.length) return {};

    const centroid = this._centroidGeo(parcelGeo);
    const LNG_M = 111320 * Math.cos(centroid[1] * Math.PI / 180);
    const LAT_M = 111320;

    const result = {};
    for (const [zone, data] of Object.entries(samplingResult.zones)) {
      if (!data.pts?.length || data.pts.length < 3) continue;
      const localPts = data.pts.map(p => ({
        x:  (p.lng - centroid[0]) * LNG_M,
        y: -(p.lat - centroid[1]) * LAT_M,
      }));
      const hull = this._convexHull(localPts);
      if (hull.length >= 3) {
        result[zone] = {
          polygon: hull,
          color: data.color,
          inconstructible: data.inconstructible,
          area_pct: data.area_pct,
          label: data.label,
        };
      }
    }
    return result;
  },

  // Convertir en polygones WGS84 (pour Mapbox overlay)
  toGeoPolygons(samplingResult, parcelGeo) {
    if (!samplingResult?.grid?.length) return {};

    const result = {};
    for (const [zone, data] of Object.entries(samplingResult.zones)) {
      if (!data.pts?.length || data.pts.length < 3) continue;
      const geoPts = data.pts.map(p => [p.lng, p.lat]);
      const hull = this._convexHullGeo(geoPts);
      if (hull.length >= 3) {
        result[zone] = {
          polygon: hull,
          color: data.color,
          inconstructible: data.inconstructible,
          area_pct: data.area_pct,
        };
      }
    }
    return result;
  },

  // ── CONVEX HULL (Andrew's monotone chain) ──────────────────────
  _convexHull(pts) {
    if (pts.length < 3) return pts;
    const sorted = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

    const lower = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  },

  _convexHullGeo(pts) {
    if (pts.length < 3) return pts;
    const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  },

  _centroidGeo(coords) {
    const n = coords.length;
    return [
      coords.reduce((s, c) => s + c[0], 0) / n,
      coords.reduce((s, c) => s + c[1], 0) / n,
    ];
  },
};

export default PPRSamplingService;
