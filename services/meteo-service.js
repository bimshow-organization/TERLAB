// TERLAB · services/meteo-service.js
// Météo-France données stations Réunion
// API Hub : https://portail-api.meteofrance.fr
// Fallback : données climatologiques normales 1991–2020 (statiques)
// ════════════════════════════════════════════════════════════════════

const MeteoService = {

  // API Key Météo-France (portail-api.meteofrance.fr — gratuit)
  // ⚠️ STUB — Remplacer par la vraie clé après inscription
  API_KEY: 'METEO_FRANCE_API_KEY',

  // Stations Réunion avec normales climatologiques 1991–2020
  STATIONS: {
    'saint-denis-gillot': {
      id: '97408001', label: 'Saint-Denis — Gillot',
      lat: -20.887, lng: 55.526, alt: 12,
      normales: { pluvio:800, tmoy:25.2, tmin:20.4, tmax:30.1, vent:18, hygro:76, amp:9.7 }
    },
    'saint-pierre': {
      id: '97416001', label: 'Saint-Pierre',
      lat: -21.321, lng: 55.484, alt: 75,
      normales: { pluvio:600, tmoy:25.0, tmin:19.3, tmax:30.7, vent:20, hygro:74, amp:11.4 }
    },
    'le-port': {
      id: '97420001', label: 'Le Port — Réunion',
      lat: -20.935, lng: 55.294, alt: 10,
      normales: { pluvio:540, tmoy:25.6, tmin:21.1, tmax:30.1, vent:22, hygro:72, amp:9.0 }
    },
    'sainte-rose': {
      id: '97409001', label: 'Sainte-Rose',
      lat: -21.128, lng: 55.793, alt: 20,
      normales: { pluvio:3850, tmoy:23.8, tmin:18.2, tmax:29.4, vent:15, hygro:85, amp:11.2 }
    },
    'saint-benoit': {
      id: '97403001', label: 'Saint-Benoît',
      lat: -21.029, lng: 55.714, alt: 22,
      normales: { pluvio:2500, tmoy:23.1, tmin:18.0, tmax:28.2, vent:14, hygro:82, amp:10.2 }
    },
    'plaine-cafres': {
      id: '97436001', label: 'Plaine des Cafres',
      lat: -21.234, lng: 55.561, alt: 1620,
      normales: { pluvio:2400, tmoy:14.2, tmin:3.4, tmax:22.1, vent:30, hygro:89, amp:18.7 }
    },
    'cilaos': {
      id: '97415001', label: 'Cilaos',
      lat: -21.138, lng: 55.475, alt: 1210,
      normales: { pluvio:1810, tmoy:17.8, tmin:7.8, tmax:24.6, vent:12, hygro:79, amp:16.8 }
    },
    'maido': {
      id: '97440001', label: 'Maido',
      lat: -21.073, lng: 55.381, alt: 2205,
      normales: { pluvio:3220, tmoy:10.8, tmin:1.6, tmax:19.8, vent:35, hygro:92, amp:18.2 }
    },
    'saint-louis': {
      id: '97414001', label: 'Saint-Louis',
      lat: -21.279, lng: 55.426, alt: 54,
      normales: { pluvio:650, tmoy:24.4, tmin:18.8, tmax:30.0, vent:16, hygro:75, amp:11.2 }
    },
    'saint-leu': {
      id: '97416002', label: 'Saint-Leu',
      lat: -21.148, lng: 55.282, alt: 20,
      normales: { pluvio:570, tmoy:25.3, tmin:19.9, tmax:30.7, vent:21, hygro:73, amp:10.8 }
    }
  },

  // ─── Trouver la station la plus proche ─────────────────────────
  findNearest(lat, lng) {
    let nearest = null, minDist = Infinity;
    for (const [key, station] of Object.entries(this.STATIONS)) {
      const dist = Math.hypot(lat - station.lat, lng - station.lng);
      if (dist < minDist) { minDist = dist; nearest = { key, ...station }; }
    }
    return nearest;
  },

  // ─── Requête API Météo-France Hub ───────────────────────────────
  async fetchObservations(stationId) {
    if (this.API_KEY === 'METEO_FRANCE_API_KEY') {
      return null; // Clé non configurée
    }
    try {
      const url = `https://public-api.meteofrance.fr/public/DPClim/v1/commande-station/mensuelle`
        + `?id-station=${stationId}&date-deb-periode=2023-01&date-fin-periode=2023-12&format=json`;
      const resp = await fetch(url, {
        headers: { apikey: this.API_KEY },
        signal: AbortSignal.timeout(8000)
      });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      return await resp.json();
    } catch (e) {
      console.warn('[Météo] API Hub failed:', e.message);
      return null;
    }
  },

  // ─── Données complètes avec fallback normales 91-2020 ───────────
  async getData(stationKey) {
    const station = this.STATIONS[stationKey];
    if (!station) return null;

    // Tenter l'API Hub
    const liveData = await this.fetchObservations(station.id);

    // Fallback normales climatologiques
    const normales  = station.normales;
    const source    = liveData ? 'api_meteofrance' : 'normales_1991_2020';

    return {
      station:   stationKey,
      label:     station.label,
      lat:       station.lat,
      lng:       station.lng,
      altitude:  station.alt,
      source,
      note:      source === 'normales_1991_2020'
        ? '⚠️ Normales 1991–2020 (API Hub non configurée)'
        : 'Données API Météo-France Hub',
      ...normales,
      // Dériver des indicateurs supplémentaires
      zone_pluvio:   this._classifyPluvio(station.lat, station.lng),
      risque_cyclone:'Oui — île entière (saison nov–avr)',
      gel_possible:  normales.tmin < 4,
      canicule_risk: normales.tmax > 32,
      ensoleillement: normales.pluvio < 800 ? 'Fort (sous le vent)' : 'Modéré à fort'
    };
  },

  // ─── Classification pluviométrique ──────────────────────────────
  _classifyPluvio(lat, lng) {
    if (lng > 55.65) return 'Côte au vent (E) — fortes pluies';
    if (lng < 55.35) return 'Sous le vent (O) — faibles pluies';
    if (lat < -21.1) return 'Hauts du sud — précipitations variables';
    return 'Mi-pentes — précipitations modérées';
  },

  // ─── Icône météo synthétique ────────────────────────────────────
  getIcon(data) {
    if (!data) return '🌡';
    if (data.pluvio > 3000) return '🌧';
    if (data.pluvio > 1500) return '⛅';
    if (data.tmax > 30)    return '☀';
    if (data.tmin < 5)     return '🥶';
    return '🌤';
  }
};

export default MeteoService;

// ════════════════════════════════════════════════════════════════════
