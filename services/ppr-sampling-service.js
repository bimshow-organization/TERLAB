// TERLAB · services/ppr-sampling-service.js
// Multi-point PPR zone detection on parcel — pixel sampling + WMS fallback
// Détecte les zones PPRN (R1/R2/B1/B2/J/W) couvrant la parcelle
// et retourne des polygones locaux pour overlay SVG esquisse
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

  // ── METHODE PRINCIPALE ─────────────────────────────────────────
  // parcelGeo : [[lng,lat], ...] — sommets parcelle WGS84
  // map       : mapboxgl.Map instance (pour pixel sampling)
  // Returns   : { zones: { R1?: {pts, area_pct}, ... }, grid: [{lng,lat,zone}], dominant }
  async sampleParcel(parcelGeo, map) {
    if (!parcelGeo?.length || parcelGeo.length < 3) {
      return { zones: {}, grid: [], dominant: 'W', hasInconstructible: false };
    }

    // 1. Calculer la bbox et la grille d'échantillonnage
    const bbox = this._bbox(parcelGeo);
    const gridPoints = this._buildGrid(parcelGeo, bbox, 3); // pas de 3m

    if (!gridPoints.length) {
      return { zones: {}, grid: [], dominant: 'W', hasInconstructible: false };
    }

    // 2. Échantillonner chaque point
    const sampledGrid = [];
    for (const pt of gridPoints) {
      const zone = this._samplePoint(pt.lng, pt.lat, map);
      sampledGrid.push({ ...pt, zone });
    }

    // 3. Si pixel sampling insuffisant (trop de null), fallback WMS sur quelques points
    const nullCount = sampledGrid.filter(p => !p.zone).length;
    if (nullCount > sampledGrid.length * 0.5) {
      await this._wmsFallback(sampledGrid);
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

  // ── PIXEL SAMPLING (WebGL) ─────────────────────────────────────
  // Lit la couleur du pixel sous le point sur le layer PPR raster
  _samplePoint(lng, lat, map) {
    if (!map?.loaded()) return null;
    try {
      const point = map.project([lng, lat]);
      const gl = map.getCanvas().getContext('webgl2') || map.getCanvas().getContext('webgl');
      if (!gl) return null;

      const pixels = new Uint8Array(4);
      const dpr = window.devicePixelRatio || 1;
      const canvasH = map.getCanvas().height;
      const x = Math.floor(point.x * dpr);
      const y = Math.floor(canvasH - point.y * dpr);

      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (pixels[3] < 50) return null; // transparent = pas de couche PPR

      return this._classifyColor(pixels[0], pixels[1], pixels[2]);
    } catch {
      return null;
    }
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

  // ── WMS FALLBACK ───────────────────────────────────────────────
  // Interroge PEIGEO WMS sur un sous-ensemble de points non classifiés
  async _wmsFallback(grid) {
    const unclassified = grid.filter(p => !p.zone);
    // Limiter à 5 requêtes WMS pour ne pas surcharger le serveur
    const sample = unclassified.length > 5
      ? this._evenSample(unclassified, 5)
      : unclassified;

    for (const pt of sample) {
      try {
        const result = await PPRService.queryPoint(pt.lat, pt.lng);
        if (result.features?.length) {
          const props = result.features[0].properties ?? {};
          const z = this._parseWMSZone(props);
          if (z) {
            pt.zone = z;
            pt.source = 'wms';
            // Propager aux points voisins non classifiés (rayon ~5m)
            this._propagateZone(grid, pt, z, 0.00005);
          }
        }
      } catch { /* silently skip */ }
    }
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

  _evenSample(arr, n) {
    const step = Math.floor(arr.length / n);
    return Array.from({ length: n }, (_, i) => arr[i * step]);
  },

  // ── CONVERSION VERS POLYGONES LOCAUX ───────────────────────────
  // Transforme la grille de points classifiés en polygones approximatifs
  // par zone, en coordonnées locales (mètres) pour l'esquisse SVG
  // Retourne { zone: [[{x,y},...]], ... } — convex hulls par zone
  toLocalPolygons(samplingResult, parcelGeo) {
    if (!samplingResult?.grid?.length) return {};

    const centroid = this._centroidGeo(parcelGeo);
    const LNG_M = 111320 * Math.cos(centroid[1] * Math.PI / 180);
    const LAT_M = 111320;

    const result = {};
    for (const [zone, data] of Object.entries(samplingResult.zones)) {
      if (!data.pts?.length || data.pts.length < 3) continue;
      // Convertir en local
      const localPts = data.pts.map(p => ({
        x:  (p.lng - centroid[0]) * LNG_M,
        y: -(p.lat - centroid[1]) * LAT_M,
      }));
      // Convex hull
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
