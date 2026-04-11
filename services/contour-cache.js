// terlab/services/contour-cache.js · Cache mémoire des courbes de niveau par parcelle
// Permet à plusieurs services (plan masse, GIEP, esquisse) de partager le résultat
// d'un seul appel ContourService.fromBIL(...) pour la même parcelle.
// ENSA La Réunion · MGA Architecture 2026

const ContourCache = {
  // Map<key, {lines, interval, minAlt, maxAlt, clng, clat, ts}>
  _cache: new Map(),
  // Map<key, Promise> — déduplication des chargements concurrents
  _pending: new Map(),

  /**
   * Calcule une clé stable depuis la bbox de la parcelle (arrondi 5 décimales).
   * Format parcelGeo : Array<[lng, lat]>
   */
  _key(parcelGeo) {
    if (!parcelGeo?.length) return null;
    let mnLng = Infinity, mxLng = -Infinity, mnLat = Infinity, mxLat = -Infinity;
    for (const [lng, lat] of parcelGeo) {
      if (lng < mnLng) mnLng = lng; if (lng > mxLng) mxLng = lng;
      if (lat < mnLat) mnLat = lat; if (lat > mxLat) mxLat = lat;
    }
    return `${mnLng.toFixed(5)},${mnLat.toFixed(5)}|${mxLng.toFixed(5)},${mxLat.toFixed(5)}`;
  },

  /**
   * Lit le cache sans déclencher de chargement. Renvoie null si absent.
   */
  getCached(parcelGeo) {
    const k = this._key(parcelGeo);
    if (!k) return null;
    return this._cache.get(k) ?? null;
  },

  /**
   * Charge les contours via window.ContourService.fromBIL(...) si non cachés,
   * sinon retourne le cache. Mémoïsation par bbox.
   * @param {Array<[lng,lat]>} parcelGeo
   * @param {Object} [opts] — { pixelSizeM=1.0, maxDim=220, padM=8 }
   * @returns {Promise<{lines, interval, minAlt, maxAlt, clng, clat}|null>}
   */
  async loadOrGet(parcelGeo, opts = {}) {
    const k = this._key(parcelGeo);
    if (!k) return null;
    if (this._cache.has(k)) return this._cache.get(k);
    if (this._pending.has(k)) return this._pending.get(k);

    if (typeof window === 'undefined' || !window.ContourService || !window.BILTerrain) {
      return null;
    }

    const { pixelSizeM = 1.0, maxDim = 220, padM = 8 } = opts;
    let mnLng = Infinity, mxLng = -Infinity, mnLat = Infinity, mxLat = -Infinity;
    for (const [lng, lat] of parcelGeo) {
      if (lng < mnLng) mnLng = lng; if (lng > mxLng) mxLng = lng;
      if (lat < mnLat) mnLat = lat; if (lat > mxLat) mxLat = lat;
    }
    const lat0 = (mnLat + mxLat) / 2;
    const dLat = padM / 111320;
    const dLng = padM / (111320 * Math.cos(lat0 * Math.PI / 180));

    const promise = (async () => {
      try {
        const data = await window.ContourService.fromBIL(
          { west: mnLng - dLng, east: mxLng + dLng, south: mnLat - dLat, north: mxLat + dLat },
          { pixelSizeM, maxDim }
        );
        if (!data) return null;
        // Centroid arithmétique de la parcelle (cohérent avec esquisse-canvas._geoToLocal)
        let clng = 0, clat = 0;
        for (const [lng, lat] of parcelGeo) { clng += lng; clat += lat; }
        clng /= parcelGeo.length; clat /= parcelGeo.length;
        const cached = { ...data, clng, clat, ts: Date.now() };
        this._cache.set(k, cached);
        return cached;
      } catch (e) {
        console.warn('[ContourCache] load failed:', e?.message ?? e);
        return null;
      } finally {
        this._pending.delete(k);
      }
    })();

    this._pending.set(k, promise);
    return promise;
  },

  /**
   * Projette des coords WGS84 vers le repère local utilisé par esquisse-canvas
   * (centroid arithmétique de la parcelle, Y inversé SVG-style).
   * @param {Array<[lng,lat]>} coords
   * @param {number} clng
   * @param {number} clat
   * @returns {Array<{x,y}>}
   */
  geoToLocal(coords, clng, clat) {
    const LNG = 111320 * Math.cos(clat * Math.PI / 180);
    const LAT = 111320;
    return coords.map(([lng, lat]) => ({
      x: (lng - clng) * LNG,
      y: -(lat - clat) * LAT,
    }));
  },

  /**
   * Extrait le ring extérieur (Array<[lng,lat]>) depuis un terrain TERLAB :
   *   terrain.parcelle_geojson  (Polygon | MultiPolygon)  ← canonique
   *   terrain.parcelGeo                                   ← déjà extrait
   * Supprime le point de fermeture GeoJSON si présent.
   */
  parcelGeoFromTerrain(terrain) {
    if (!terrain) return null;
    if (Array.isArray(terrain.parcelGeo) && terrain.parcelGeo.length >= 3) {
      return this._stripClose(terrain.parcelGeo);
    }
    const geom = terrain.parcelle_geojson ?? terrain.geojson ?? null;
    if (!geom) return null;
    let ring = null;
    if (geom.type === 'Polygon')           ring = geom.coordinates?.[0];
    else if (geom.type === 'MultiPolygon') ring = geom.coordinates?.[0]?.[0];
    else if (geom.type === 'Feature')      return this.parcelGeoFromTerrain({ parcelle_geojson: geom.geometry });
    if (!ring || ring.length < 3) return null;
    return this._stripClose(ring);
  },

  _stripClose(ring) {
    if (ring.length >= 2) {
      const first = ring[0], last = ring[ring.length - 1];
      if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
    }
    return ring;
  },

  clear() {
    this._cache.clear();
    this._pending.clear();
  },
};

export default ContourCache;
