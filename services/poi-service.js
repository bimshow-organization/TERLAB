// TERLAB · services/poi-service.js
// Overpass API (OSM) — Points d'intérêt pour analyse "ville du 1/4 heure"
// Catégories Moreno : approvisionner / soigner / apprendre / s'épanouir / travailler
// API gratuite, CORS OK
// ════════════════════════════════════════════════════════════════════

const PoiService = {

  // Mirrors Overpass — basculement automatique en cas de saturation
  ENDPOINTS: [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
  ],

  // Catégories Moreno → tags OSM
  // (l'« habiter » est implicite — la parcelle elle-même)
  CATEGORIES: {
    approvisionner: {
      label: 'S\'approvisionner',
      icon:  '🛒',
      filters: [
        ['shop', '~', 'supermarket|convenience|bakery|butcher|greengrocer|grocery|general|marketplace|farm']
      ]
    },
    soigner: {
      label: 'Se soigner',
      icon:  '⚕️',
      filters: [
        ['amenity', '~', 'pharmacy|hospital|clinic|doctors|dentist']
      ]
    },
    apprendre: {
      label: 'Apprendre',
      icon:  '🎓',
      filters: [
        ['amenity', '~', 'school|kindergarten|college|university|library']
      ]
    },
    epanouir: {
      label: 'S\'épanouir',
      icon:  '🌳',
      filters: [
        ['leisure', '~', 'park|playground|sports_centre|fitness_centre|garden|pitch'],
        ['amenity', '~', 'theatre|cinema|community_centre|arts_centre|place_of_worship']
      ]
    },
    travailler: {
      label: 'Travailler',
      icon:  '💼',
      filters: [
        ['office', '~', '.*'],
        ['amenity', '~', 'coworking_space']
      ]
    }
  },

  // Cache mémoire { "south,west,north,east" → POI[] }
  cache: new Map(),

  /**
   * Construit la requête Overpass QL pour une bbox donnée.
   * @param {[number,number,number,number]} bbox  [south, west, north, east] (lat,lng)
   */
  _buildQuery(bbox) {
    const [s, w, n, e] = bbox;
    const bb = `${s},${w},${n},${e}`;
    // Une seule requête combinée — node + way (centre) pour parcs/équipements
    return `[out:json][timeout:25];
(
  node["shop"~"supermarket|convenience|bakery|butcher|greengrocer|grocery|general|marketplace|farm"](${bb});
  node["amenity"~"pharmacy|hospital|clinic|doctors|dentist|school|kindergarten|college|university|library|theatre|cinema|community_centre|arts_centre|place_of_worship|coworking_space"](${bb});
  node["leisure"~"park|playground|sports_centre|fitness_centre|garden|pitch"](${bb});
  node["office"](${bb});
  way["leisure"~"park|sports_centre|garden|pitch|playground"](${bb});
  way["amenity"~"school|hospital|university|college|kindergarten"](${bb});
);
out center 500;`;
  },

  /**
   * Récupère tous les POI dans une bbox via Overpass.
   * @param {[number,number,number,number]} bbox  [south, west, north, east]
   * @returns {Promise<Array>} POI normalisés [{id, category, name, lat, lng, tags}]
   */
  async fetchInBbox(bbox) {
    const key = bbox.map(v => v.toFixed(4)).join(',');
    if (this.cache.has(key)) return this.cache.get(key);

    const query = this._buildQuery(bbox);
    const body  = 'data=' + encodeURIComponent(query);

    // Tente chaque mirror jusqu'à succès
    for (const endpoint of this.ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(25000)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Vérif content-type : si HTML/XML, c'est une page d'erreur Overpass
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('json')) throw new Error('non-JSON response (server busy)');
        const data = await res.json();
        const pois = (data.elements ?? [])
          .map(el => this._normalize(el))
          .filter(Boolean);
        this.cache.set(key, pois);
        return pois;
      } catch (e) {
        console.warn(`[POI] Overpass ${endpoint} failed:`, e.message);
        // continue avec le prochain mirror
      }
    }
    return [];
  },

  /**
   * Normalise un élément Overpass en POI {id, category, name, lat, lng, tags}.
   */
  _normalize(el) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) return null;
    const tags = el.tags ?? {};
    const category = this._classify(tags);
    if (!category) return null;
    return {
      id: `${el.type}/${el.id}`,
      category,
      name: tags.name ?? tags['name:fr'] ?? '(sans nom)',
      lat,
      lng,
      tags
    };
  },

  /**
   * Détermine la catégorie Moreno d'un POI à partir de ses tags OSM.
   */
  _classify(tags) {
    if (tags.shop) return 'approvisionner';
    if (tags.amenity) {
      if (/pharmacy|hospital|clinic|doctors|dentist/.test(tags.amenity)) return 'soigner';
      if (/school|kindergarten|college|university|library/.test(tags.amenity)) return 'apprendre';
      if (/theatre|cinema|community_centre|arts_centre|place_of_worship/.test(tags.amenity)) return 'epanouir';
      if (tags.amenity === 'coworking_space') return 'travailler';
    }
    if (tags.leisure) return 'epanouir';
    if (tags.office)  return 'travailler';
    return null;
  },

  /**
   * Filtre les POI qui tombent dans un polygone (Turf point-in-polygon).
   * @param {Array} pois
   * @param {Object} polygonFeature  GeoJSON Feature Polygon
   * @returns {Array}
   */
  filterInPolygon(pois, polygonFeature) {
    if (!pois?.length || !polygonFeature?.geometry || !window.turf) return [];
    return pois.filter(p => {
      try {
        return window.turf.booleanPointInPolygon(
          window.turf.point([p.lng, p.lat]),
          polygonFeature
        );
      } catch { return false; }
    });
  },

  /**
   * Compte les POI par catégorie Moreno.
   * @returns {{approvisionner:number, soigner:number, apprendre:number, epanouir:number, travailler:number}}
   */
  countByCategory(pois) {
    const counts = {
      approvisionner: 0, soigner: 0, apprendre: 0, epanouir: 0, travailler: 0
    };
    for (const p of (pois ?? [])) {
      if (counts[p.category] != null) counts[p.category]++;
    }
    return counts;
  },

  /**
   * Score "ville du 1/4 heure" : nombre de catégories Moreno avec ≥1 POI.
   * @returns {{score:number, total:number, hits:Object}}
   */
  scoreMoreno(pois) {
    const counts = this.countByCategory(pois);
    const hits   = {};
    let score    = 0;
    for (const k of Object.keys(counts)) {
      const ok = counts[k] > 0;
      hits[k] = ok;
      if (ok) score++;
    }
    return { score, total: Object.keys(counts).length, hits, counts };
  },

  /**
   * Calcule la bbox englobante d'un Feature Polygon (lat,lng).
   * Retourne [south, west, north, east].
   */
  bboxOfFeature(feature) {
    if (!feature?.geometry || !window.turf) return null;
    const bb = window.turf.bbox(feature); // [minX, minY, maxX, maxY] = [west, south, east, north]
    return [bb[1], bb[0], bb[3], bb[2]];  // → [south, west, north, east]
  },

  clearCache() { this.cache.clear(); }
};

export default PoiService;
