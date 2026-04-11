// TERLAB · services/isochrone-service.js
// IGN Géoplateforme — Isochrones piéton + voiture (resource bdtopo-valhalla)
// API gratuite, CORS OK, GeoJSON Polygon direct
// Doc : https://geoservices.ign.fr/documentation/services/api-et-services-ogc/itineraires
// ════════════════════════════════════════════════════════════════════

const IsochroneService = {

  ENDPOINT: 'https://data.geopf.fr/navigation/isochrone',
  RESOURCE: 'bdtopo-valhalla',

  // Vitesse piéton par défaut (Réunion = relief, 4 km/h plus honnête que 5)
  // Valhalla utilise ~5 km/h en interne → on compense en gonflant costValue
  WALK_KMH:        4,
  WALK_KMH_NATIVE: 5,

  // Cache mémoire { "lat|lng|profile|sec" → GeoJSON }
  cache: new Map(),

  /**
   * Récupère un polygone isochrone IGN.
   * @param {number} lat       latitude WGS84
   * @param {number} lng       longitude WGS84
   * @param {'pedestrian'|'car'} profile
   * @param {number} costSec   budget temps en secondes (défaut 900 = 15 min)
   * @returns {Promise<Object|null>} GeoJSON Feature Polygon, ou null si échec
   */
  async fetch(lat, lng, profile = 'pedestrian', costSec = 900) {
    const key = `${lat.toFixed(5)}|${lng.toFixed(5)}|${profile}|${costSec}`;
    if (this.cache.has(key)) return this.cache.get(key);

    // Compensation vitesse piéton (4 km/h vs 5 km/h Valhalla)
    let effectiveCost = costSec;
    if (profile === 'pedestrian') {
      effectiveCost = Math.round(costSec * (this.WALK_KMH / this.WALK_KMH_NATIVE));
    }

    const params = new URLSearchParams({
      point:          `${lng},${lat}`,   // ⚠ ordre lng,lat côté IGN
      resource:       this.RESOURCE,
      costType:       'time',
      costValue:      String(effectiveCost),
      profile:        profile,
      direction:      'departure',
      geometryFormat: 'geojson',
      crs:            'EPSG:4326'
    });

    try {
      const res = await fetch(`${this.ENDPOINT}?${params}`, {
        signal: AbortSignal.timeout(12000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data?.geometry) throw new Error('no geometry');

      const feature = {
        type: 'Feature',
        geometry: data.geometry,
        properties: {
          profile,
          costSec,
          effectiveCostSec: effectiveCost,
          walkKmh: profile === 'pedestrian' ? this.WALK_KMH : null,
          source:  'ign-bdtopo-valhalla'
        }
      };
      this.cache.set(key, feature);
      return feature;
    } catch (e) {
      console.warn(`[Isochrone] ${profile} failed:`, e.message);
      return null;
    }
  },

  /**
   * Récupère les 2 isochrones (pied + voiture) en parallèle.
   * @returns {Promise<{pedestrian:Object|null, car:Object|null}>}
   */
  async fetchBoth(lat, lng, costSec = 900) {
    const [pedestrian, car] = await Promise.all([
      this.fetch(lat, lng, 'pedestrian', costSec),
      this.fetch(lat, lng, 'car',        costSec)
    ]);
    return { pedestrian, car };
  },

  /**
   * Aire en km² d'un Feature Polygon isochrone (via Turf si dispo).
   * @returns {number|null}
   */
  areaKm2(feature) {
    if (!feature?.geometry || !window.turf) return null;
    try { return window.turf.area(feature) / 1e6; }
    catch { return null; }
  },

  /**
   * Vide le cache (utile en dev).
   */
  clearCache() { this.cache.clear(); }
};

export default IsochroneService;
