// TERLAB · services/slopes-service.js
// Port de giep-3d-slopes.js GIEP — classification pentes RTAA DOM

const SlopesService = {

  // Seuils RTAA DOM 2016
  CATEGORIES: [
    { max:  2, color: 0x2dc89a, hex: '#2dc89a', label: 'Faible < 2%',   rtaa: 'Aucune contrainte' },
    { max:  5, color: 0x00d4ff, hex: '#00d4ff', label: 'Modérée 2–5%',  rtaa: 'Charpente adaptée' },
    { max: 15, color: 0xf59e0b, hex: '#f59e0b', label: 'Forte 5–15%',   rtaa: 'Fondations spéciales' },
    { max: Infinity, color: 0xef4444, hex: '#ef4444', label: 'Très forte >15%', rtaa: 'G1 OBLIGATOIRE' },
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
};

export default SlopesService;
