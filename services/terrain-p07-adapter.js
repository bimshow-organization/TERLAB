/**
 * TerrainP07Adapter — GeoJSON parcelle WGS84 → polygone métrique local éditeur p07
 * TERLAB Phase 7 — ENSA La Réunion — MGA Architecture 2026
 * Vanilla JS ES2022+, aucune dépendance externe
 *
 * Constantes géodésiques identiques BIMSHOW.
 */

const M_LAT = 111_132.954;                          // m/deg (constant)
function M_LON(lat) { return M_LAT * Math.cos(lat * Math.PI / 180); }

export class TerrainP07Adapter {

  /**
   * Convertit GeoJSON parcelle → polygone métrique local pour l'éditeur.
   *
   * @param {GeoJSON.Feature} geojsonFeature  — Polygon ou MultiPolygon WGS84
   * @param {number}          lat0            — latitude origine (centroïde)
   * @param {number}          lng0            — longitude origine
   * @param {number}          bearingVoie     — azimut voie principale (degrés, 0=nord)
   *
   * @returns {{ poly: number[][], edgeTypes: string[], origin: {lat, lng}, bearing: number, area: number }}
   */
  transform(geojsonFeature, lat0, lng0, bearingVoie = 0) {

    // 1. Extraire les coordonnées du premier anneau extérieur, sans doublon de fermeture
    const coords = this._extractRing(geojsonFeature);
    const ring = coords.length > 1 &&
      coords[0][0] === coords[coords.length - 1][0] &&
      coords[0][1] === coords[coords.length - 1][1]
      ? coords.slice(0, -1)
      : coords;

    // 2. Convertir WGS84 → deltas métriques depuis (lat0, lng0)
    const mlon = M_LON(lat0);
    const metriques = ring.map(([lng, lat]) => [
      (lng - lng0) * mlon,    // X = est
      (lat - lat0) * M_LAT,   // Y = nord
    ]);

    // 3. Rotation inverse de l'azimut voie → axe local X = direction voie
    const theta = -(bearingVoie * Math.PI / 180);
    const rotated = metriques.map(([x, y]) => [
      x * Math.cos(theta) - y * Math.sin(theta),
      x * Math.sin(theta) + y * Math.cos(theta),
    ]);

    // 4. Translater pour que le point SW soit à (0, 0)
    const xs = rotated.map(p => p[0]);
    const ys = rotated.map(p => p[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const poly = rotated.map(([x, y]) => [
      parseFloat((x - minX).toFixed(3)),
      parseFloat((y - minY).toFixed(3)),
    ]);

    // 5. Assurer le sens CCW (Y-haut) pour insetPoly()
    const area = this._signedArea(poly);
    const polyCCW = area < 0 ? [...poly].reverse() : poly;

    // 6. Déduire edgeTypes depuis la géométrie
    const edgeTypes = this._inferEdgeTypes(polyCCW);

    return {
      poly:      polyCCW,
      edgeTypes,
      area:      Math.abs(area),
      origin:    { lat: lat0, lng: lng0 },
      bearing:   bearingVoie,
    };
  }

  /**
   * Identifie l'arête 'voie' : la plus proche du sud (y_min moyen).
   * Les arêtes adjacentes = 'lat', l'opposée = 'fond'.
   */
  _inferEdgeTypes(poly) {
    const n = poly.length;
    if (n < 3) return Array(n).fill('lat');

    // Calculer midpoint Y de chaque arête
    const edgeMids = Array.from({ length: n }, (_, i) => {
      const [, y1] = poly[i], [, y2] = poly[(i + 1) % n];
      return { i, midY: (y1 + y2) / 2 };
    });

    // Arête voie = midY le plus bas (le plus au sud après rotation)
    const voieIdx = edgeMids.reduce((a, b) => b.midY < a.midY ? b : a).i;
    // Arête fond = midY le plus haut (le plus au nord)
    const fondIdx = edgeMids.reduce((a, b) => b.midY > a.midY ? b : a).i;

    return Array.from({ length: n }, (_, i) => {
      if (i === voieIdx) return 'voie';
      if (i === fondIdx) return 'fond';
      return 'lat';
    });
  }

  /** Aire signée (positive = CCW en Y-haut) */
  _signedArea(poly) {
    let s = 0;
    for (let i = 0, n = poly.length; i < n; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
      s += x1 * y2 - x2 * y1;
    }
    return s / 2;
  }

  /** Extrait l'anneau extérieur d'un GeoJSON Polygon ou MultiPolygon */
  _extractRing(feature) {
    const geom = feature.geometry ?? feature;
    if (geom.type === 'Polygon')      return geom.coordinates[0];
    if (geom.type === 'MultiPolygon') return geom.coordinates[0][0];
    throw new Error(`Geometry type non supporté : ${geom.type}`);
  }
}

export default TerrainP07Adapter;

// Expose pour compatibilité non-module TERLAB
if (typeof window !== 'undefined') window.TerrainP07Adapter = TerrainP07Adapter;
