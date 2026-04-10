// TERLAB · services/cadastre-context-service.js
// Contexte cadastral d'une parcelle cible : parcelles voisines via WFS BBOX
// IGN Géoplateforme — CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle
// API gratuite, CORS OK, GeoJSON direct
// ════════════════════════════════════════════════════════════════════
//
// Usage :
//   const ctx = await CadastreContextService.fetchNeighbors(lat, lng, 150);
//   ctx.features → GeoJSON FeatureCollection (parcelles voisines + cible)
//
// Le service complète BdTopoService (bâti + voirie) avec les parcelles
// voisines, ce qui permet à site-plan-renderer.js de produire un plan
// d'état des lieux équivalent à un extrait cadastral DGFiP.
// ════════════════════════════════════════════════════════════════════

const CadastreContextService = {

  WFS_BASE: 'https://data.geopf.fr/wfs',
  TYPENAME: 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle',

  // Cache mémoire : key = `${lat.toFixed(5)}|${lng.toFixed(5)}|${radius}`
  _cache: new Map(),
  _MAX_CACHE: 32,

  /**
   * Récupère les parcelles dans un rayon autour d'un point WGS84.
   * @param {number} lat
   * @param {number} lng
   * @param {number} radius_m  rayon en mètres (défaut 150m)
   * @returns {Promise<Object|null>} GeoJSON FeatureCollection ou null
   */
  async fetchNeighbors(lat, lng, radius_m = 150) {
    const key = `${lat.toFixed(5)}|${lng.toFixed(5)}|${radius_m}`;
    if (this._cache.has(key)) return this._cache.get(key);

    // BBOX : conversion m → degrés (approx, suffisant pour < 1km)
    const dLat = radius_m / 111000;
    const dLng = radius_m / (111000 * Math.cos(lat * Math.PI / 180));
    const bbox = `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat},EPSG:4326`;

    const params = new URLSearchParams({
      SERVICE:      'WFS',
      VERSION:      '2.0.0',
      REQUEST:      'GetFeature',
      TYPENAMES:    this.TYPENAME,
      OUTPUTFORMAT: 'application/json',
      COUNT:        '300',
      BBOX:         bbox,
    });

    try {
      const res = await fetch(`${this.WFS_BASE}?${params}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const geojson = await res.json();
      geojson.features = (geojson.features || []).filter(f => f.geometry);
      this._setCache(key, geojson);
      return geojson;
    } catch (e) {
      console.warn('[CadastreContext] fetchNeighbors failed:', e.message);
      return null;
    }
  },

  /**
   * Identifie la parcelle "cible" dans une FeatureCollection à partir
   * d'une géométrie de référence (intersection / contenance du centroïde).
   * Marque la feature trouvée avec properties.__target = true.
   *
   * @param {Object} geojson  FeatureCollection retournée par fetchNeighbors
   * @param {Object} targetGeom  Polygon GeoJSON de la parcelle cible
   * @returns {Object} le même geojson, enrichi
   */
  markTarget(geojson, targetGeom) {
    if (!geojson?.features?.length || !targetGeom) return geojson;
    const cTarget = this._centroid(targetGeom);
    if (!cTarget) return geojson;

    let bestIdx = -1;
    let bestDist = Infinity;
    geojson.features.forEach((f, i) => {
      f.properties = f.properties || {};
      f.properties.__target = false;
      const c = this._centroid(f.geometry);
      if (!c) return;
      const d = (c[0] - cTarget[0]) ** 2 + (c[1] - cTarget[1]) ** 2;
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });

    if (bestIdx >= 0) {
      geojson.features[bestIdx].properties.__target = true;
    }
    return geojson;
  },

  /**
   * Calcule le rayon WFS recommandé en fonction de l'échelle d'impression.
   * Garantit qu'on charge ce qui sera réellement visible sur la planche.
   * @param {number} scale   ex 500 pour 1/500
   * @param {string} format  'A4' | 'A3'
   */
  recommendedRadius(scale, format = 'A4') {
    // Diagonale utile (mm) approximative selon format
    const diagMm = format === 'A3' ? 460 : 320;
    // diagMm × scale / 1000 = mètres réels couverts par la planche
    const radius = (diagMm * scale) / 2000; // /2 (rayon) + /1000 (mm→m)
    // Bornes de sécurité
    return Math.max(30, Math.min(800, Math.round(radius)));
  },

  // ── Internals ────────────────────────────────────────────────────

  _centroid(geom) {
    if (!geom) return null;
    let ring = null;
    if (geom.type === 'Polygon')      ring = geom.coordinates[0];
    else if (geom.type === 'MultiPolygon') ring = geom.coordinates[0]?.[0];
    if (!ring?.length) return null;
    let sx = 0, sy = 0, n = 0;
    for (const [x, y] of ring) {
      if (Number.isFinite(x) && Number.isFinite(y)) { sx += x; sy += y; n++; }
    }
    return n ? [sx / n, sy / n] : null;
  },

  _setCache(key, value) {
    if (this._cache.size >= this._MAX_CACHE) {
      // Drop oldest
      const firstKey = this._cache.keys().next().value;
      this._cache.delete(firstKey);
    }
    this._cache.set(key, value);
  },
};

if (typeof window !== 'undefined') {
  window.CadastreContextService = CadastreContextService;
}

export default CadastreContextService;
