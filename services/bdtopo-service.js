// TERLAB · services/bdtopo-service.js
// IGN BD TOPO — Bâtiments 3D + Cours d'eau (ravines) via WFS Géoplateforme
// API gratuite, CORS OK, GeoJSON direct
// ════════════════════════════════════════════════════════════════════

const BdTopoService = {

  WFS_BASE: 'https://data.geopf.fr/wfs',

  // Récupère les bâtiments dans un rayon autour du point
  // @param {number} lat  latitude WGS84
  // @param {number} lng  longitude WGS84
  // @param {number} radius_m  rayon en mètres (défaut 300m)
  // @returns {Object|null} GeoJSON FeatureCollection
  async fetchBatiments(lat, lng, radius_m = 300) {
    const d = radius_m / 111000;
    const bbox = `${lng - d},${lat - d},${lng + d},${lat + d},EPSG:4326`;

    const params = new URLSearchParams({
      SERVICE:      'WFS',
      VERSION:      '2.0.0',
      REQUEST:      'GetFeature',
      TYPENAMES:    'BDTOPO_V3:batiment',
      OUTPUTFORMAT: 'application/json',
      COUNT:        '200',
      BBOX:         bbox
    });

    try {
      const res = await fetch(`${this.WFS_BASE}?${params}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const geojson = await res.json();
      geojson.features = (geojson.features || []).filter(f => f.geometry);
      return geojson;
    } catch (e) {
      console.warn('[BdTopo] fetchBatiments failed:', e.message);
      return null;
    }
  },

  // Récupère les cours d'eau (ravines) nommés
  async fetchCoursEau(lat, lng, radius_m = 1000) {
    const d = radius_m / 111000;
    const bbox = `${lng - d},${lat - d},${lng + d},${lat + d},EPSG:4326`;

    const params = new URLSearchParams({
      SERVICE:      'WFS',
      VERSION:      '2.0.0',
      REQUEST:      'GetFeature',
      TYPENAMES:    'BDTOPO_V3:cours_d_eau',
      OUTPUTFORMAT: 'application/json',
      COUNT:        '50',
      BBOX:         bbox
    });

    try {
      const res = await fetch(`${this.WFS_BASE}?${params}`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn('[BdTopo] fetchCoursEau failed:', e.message);
      return null;
    }
  },

  // Extrait le nom de la ravine la plus proche
  findNearestRavine(coursEauGeoJson, lat, lng) {
    if (!coursEauGeoJson?.features?.length) return null;
    const named = coursEauGeoJson.features
      .filter(f => f.properties?.nom && f.properties.nom !== 'Inconnu');
    return named[0]?.properties?.nom ?? null;
  },

  // Calculer les hauteurs voisines depuis BD TOPO
  // BD TOPO attribut : hauteur (en mètres)
  computeNeighborHeights(batimentsGeojson) {
    if (!batimentsGeojson?.features) return { min: null, max: null, avg: null, count: 0 };
    const heights = batimentsGeojson.features
      .map(f => f.properties?.hauteur)
      .filter(h => h && h > 0);
    if (!heights.length) return { min: null, max: null, avg: null, count: 0 };
    return {
      min:   Math.min(...heights),
      max:   Math.max(...heights),
      avg:   Math.round(heights.reduce((a, b) => a + b, 0) / heights.length),
      count: heights.length
    };
  }
};

export default BdTopoService;

// ════════════════════════════════════════════════════════════════════
