// TERLAB · services/edf-service.js
// Open Data EDF Réunion — postes sources, réseau, installations PV
// ⚠️ STUB — API OpenDataSoft EDF a migré (HTTP 410 depuis avril 2026)
//    Le portail opendata-reunion.edf.fr fonctionne mais l'API REST
//    programmatique n'est plus accessible. Données statiques en fallback.
// ════════════════════════════════════════════════════════════════════

const EdfService = {

  // Données statiques postes sources Réunion (sources : EDF SEI 2024)
  POSTES_SOURCES: [
    { nom: 'Le Port',           tension_kv: '63/20', lat: -20.934, lng: 55.286 },
    { nom: 'La Possession',     tension_kv: '63/20', lat: -20.927, lng: 55.328 },
    { nom: 'Saint-Denis',       tension_kv: '63/20', lat: -20.882, lng: 55.454 },
    { nom: 'Sainte-Marie',      tension_kv: '63/20', lat: -20.893, lng: 55.528 },
    { nom: 'Sainte-Suzanne',    tension_kv: '63/20', lat: -20.911, lng: 55.596 },
    { nom: 'Saint-André',       tension_kv: '63/20', lat: -20.958, lng: 55.657 },
    { nom: 'Saint-Benoît',      tension_kv: '63/20', lat: -21.041, lng: 55.714 },
    { nom: 'Sainte-Rose',       tension_kv: '63/20', lat: -21.116, lng: 55.775 },
    { nom: 'Saint-Pierre',      tension_kv: '63/20', lat: -21.338, lng: 55.469 },
    { nom: 'Saint-Louis',       tension_kv: '63/20', lat: -21.268, lng: 55.413 },
    { nom: 'Le Tampon',         tension_kv: '63/20', lat: -21.268, lng: 55.518 },
    { nom: 'Saint-Leu',         tension_kv: '63/20', lat: -21.171, lng: 55.287 },
    { nom: 'Saint-Paul',        tension_kv: '63/20', lat: -21.004, lng: 55.270 },
    { nom: 'Rivière des Galets',tension_kv: '63/20', lat: -20.960, lng: 55.300 },
  ],

  // Mix électrique Réunion 2024 (source : bilan EDF SEI)
  MIX_ELECTRIQUE: {
    annee: 2024,
    total_gwh: 3100,
    repartition: {
      charbon:      30.2,
      fioul:        24.8,
      bagasse:      9.5,
      hydraulique:  14.2,
      photovoltaique: 13.8,
      eolien:       2.1,
      biomasse:     3.4,
      biogas:       2.0
    },
    facteur_emission_kg_co2_kwh: 0.73,
    source: 'Bilan EDF SEI 2024 — données statiques'
  },

  // Postes sources → GeoJSON
  getPostesSourcesGeoJson() {
    return {
      type: 'FeatureCollection',
      features: this.POSTES_SOURCES.map(p => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { nom: p.nom, tension_kv: p.tension_kv }
      }))
    };
  },

  // Trouver le poste source le plus proche d'un point
  findNearestPoste(lat, lng) {
    let nearest = null, minDist = Infinity;
    for (const p of this.POSTES_SOURCES) {
      const dist = Math.hypot(p.lat - lat, p.lng - lng);
      if (dist < minDist) { minDist = dist; nearest = p; }
    }
    return nearest ? {
      nom:        nearest.nom,
      tension:    nearest.tension_kv,
      distance_m: Math.round(minDist * 111000),
      coords:     [nearest.lng, nearest.lat]
    } : null;
  },

  // Mix électrique pour calcul ACV (P09)
  getMixElectrique() {
    return this.MIX_ELECTRIQUE;
  },

  // Facteur d'émission pour calcul carbone
  getFacteurEmission() {
    return this.MIX_ELECTRIQUE.facteur_emission_kg_co2_kwh;
  }
};

export default EdfService;

// ════════════════════════════════════════════════════════════════════
