// TERLAB · services/slopes-service.js
// Port de giep-3d-slopes.js GIEP — classification pentes RTAA DOM + GIEP EP
// v2 : 5 classes (ajout STAGNATION), couleurs GIEP, flow lines

const SlopesService = {

  // 5 classes — fusion RTAA DOM 2016 + GIEP-LA-REUNION giep-3d-slopes.js
  CATEGORIES: [
    { max: 0.5,      color: 0xdc2626, hex: '#dc2626', label: 'Stagnation < 0.5%', rtaa: 'Drainage obligatoire',   giep: 'Risque EP — eau stagnante' },
    { max:  2,       color: 0xf59e0b, hex: '#f59e0b', label: 'Faible 0.5–2%',     rtaa: 'Aucune contrainte',      giep: 'Infiltration lente' },
    { max:  5,       color: 0x22c55e, hex: '#22c55e', label: 'Optimale 2–5%',      rtaa: 'Charpente adaptée',      giep: 'Écoulement naturel idéal' },
    { max: 15,       color: 0xf59e0b, hex: '#f59e0b', label: 'Forte 5–15%',        rtaa: 'Fondations spéciales',   giep: 'Noues avec redents' },
    { max: Infinity, color: 0xef4444, hex: '#ef4444', label: 'Très forte >15%',    rtaa: 'G1 OBLIGATOIRE',         giep: 'Terrassement majeur' },
  ],

  classify(pctPente) {
    return this.CATEGORIES.find(c => Math.abs(pctPente) <= c.max) ?? this.CATEGORIES[3];
  },

  getExpositionLabel(angleDeg) {
    const a = ((angleDeg % 360) + 360) % 360;
    if (a < 22.5 || a >= 337.5) return 'N';
    if (a < 67.5)  return 'NE';
    if (a < 112.5) return 'E';
    if (a < 157.5) return 'SE';
    if (a < 202.5) return 'S';
    if (a < 247.5) return 'SO';
    if (a < 292.5) return 'O';
    return 'NO';
  },

  // Calculer pente et exposition depuis les points IGN
  computeFromGeoJSON(geojson, altitudes) {
    if (!geojson || !altitudes || altitudes.length < 2) return null;
    const coords = geojson.type === 'Polygon'
      ? geojson.coordinates[0]
      : geojson.coordinates[0][0];

    const LAT   = 111320;
    const LNG   = LAT * Math.cos(-21.1 * Math.PI / 180);

    let maxSlope = 0, maxAngle = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const dx   = (coords[i+1][0] - coords[i][0]) * LNG;
      const dz   = (coords[i+1][1] - coords[i][1]) * LAT;
      const dy   = (altitudes[i+1] ?? 0) - (altitudes[i] ?? 0);
      const horiz = Math.hypot(dx, dz);
      if (horiz < 0.1) continue;
      const slope = Math.abs(dy / horiz) * 100;
      if (slope > maxSlope) {
        maxSlope = slope;
        maxAngle = Math.atan2(dz, dx) * 180 / Math.PI;
      }
    }

    return {
      pct:        maxSlope,
      angle:      maxAngle,
      exposition: this.getExpositionLabel(maxAngle + 90),
      categorie:  this.classify(maxSlope),
    };
  },

  // ── Flow lines — chemins d'écoulement depuis points hauts ────────
  // Source : giep-3d-slopes.js L.300+ (adapté 2D SVG)
  // Retourne un tableau de polylines [{x,y}] représentant les chemins d'eau
  computeFlowLines(poly, pente_pct, exposition, steps = 12) {
    if (!poly || poly.length < 3 || !pente_pct || !exposition) return [];

    const bb = this._polyBBox(poly);
    const angle = {
      N: 270, NE: 315, E: 0, SE: 45, S: 90, SO: 135, O: 180, NO: 225,
    }[exposition] ?? 90;
    const rad = (angle * Math.PI) / 180;
    const dx = Math.cos(rad), dy = Math.sin(rad);

    // Points de départ : côté amont (opposé à la pente)
    const perpRad = rad + Math.PI / 2;
    const perpDx = Math.cos(perpRad), perpDy = Math.sin(perpRad);
    const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;

    // Reculer au bord amont
    const diag = Math.max(bb.w, bb.h);
    const startCx = cx - dx * diag * 0.4;
    const startCy = cy - dy * diag * 0.4;

    // 3 lignes d'écoulement (centre + 2 latérales)
    const offsets = [-0.25, 0, 0.25];
    const lines = [];

    for (const off of offsets) {
      const sx = startCx + perpDx * diag * off;
      const sy = startCy + perpDy * diag * off;

      // Vérifier que le point de départ est dans le polygone
      if (!this._ptInPoly(sx, sy, poly)) continue;

      const pts = [{ x: sx, y: sy }];
      const stepLen = diag / steps;
      let px = sx, py = sy;

      for (let i = 0; i < steps; i++) {
        px += dx * stepLen;
        py += dy * stepLen;
        if (!this._ptInPoly(px, py, poly)) break;
        pts.push({ x: px, y: py });
      }
      if (pts.length >= 2) lines.push(pts);
    }
    return lines;
  },

  _polyBBox(pts) {
    const xs = pts.map(p => Array.isArray(p) ? p[0] : p.x);
    const ys = pts.map(p => Array.isArray(p) ? p[1] : p.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  },

  _ptInPoly(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = Array.isArray(poly[i]) ? poly[i][0] : poly[i].x;
      const yi = Array.isArray(poly[i]) ? poly[i][1] : poly[i].y;
      const xj = Array.isArray(poly[j]) ? poly[j][0] : poly[j].x;
      const yj = Array.isArray(poly[j]) ? poly[j][1] : poly[j].y;
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  },
};

export default SlopesService;
