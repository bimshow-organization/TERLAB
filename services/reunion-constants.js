// TERLAB · reunion-constants.js · Données et constantes spécifiques à La Réunion
// Sources : DEAL Réunion 2012/2016, BRGM, Météo-France, RTAA DOM 2016, GIEP-LA-REUNION config.js
// ENSA La Réunion · MGA Architecture · Saint-Leu 97436

// ── Zones climatiques GIEP (source config.js GIEP + DEAL Réunion) ──────────
export const ZONES_CLIMATIQUES = {
  littoral_ouest_sec: {
    nom: 'Littoral Ouest sec',
    k: 10,               // coefficient perméabilité sol mm/h
    i10: 220, i20: 260,  // intensités projet mm/h (1h)
    i10_deal: 200, i20_deal: 240, // intensités DEAL 2012
    qref: 15,            // débit de référence L/s/ha
    meteo_max: 375,      // intensité max événements extrêmes mm/h
    pluvio_annuelle_mm: 600,
    vent_dominant: 'Alizé modéré O-SO',
    cyclone_exposition: 'modérée',
  },
  littoral_sud_ouest: {
    nom: 'Littoral Sud-Ouest',
    k: 12,
    i10: 220, i20: 260,
    i10_deal: 190, i20_deal: 230,
    qref: 20,
    meteo_max: 425,
    pluvio_annuelle_mm: 800,
    vent_dominant: 'Alizé modéré SO',
    cyclone_exposition: 'modérée',
  },
  littoral_nord_est: {
    nom: 'Littoral Nord-Est (côte au vent)',
    k: 15,
    i10: 240, i20: 280,
    i10_deal: 220, i20_deal: 260,
    qref: 30,
    meteo_max: 550,
    pluvio_annuelle_mm: 2000,
    vent_dominant: 'Alizé E-NE',
    cyclone_exposition: 'forte',
  },
  mipentes: {
    nom: 'Mi-pentes (400–800m)',
    k: 15,
    i10: 240, i20: 280,
    i10_deal: 210, i20_deal: 250,
    qref: 50,
    meteo_max: 700,
    pluvio_annuelle_mm: 1800,
    vent_dominant: 'Variable selon versant',
    cyclone_exposition: 'modérée',
  },
  hauts_cirques: {
    nom: 'Hauts et Cirques (>800m)',
    k: 20,
    i10: 260, i20: 300,
    i10_deal: 240, i20_deal: 280,
    qref: 100,
    meteo_max: 1000,
    pluvio_annuelle_mm: 3000,
    vent_dominant: 'Variable fort',
    cyclone_exposition: 'faible (mais effets locaux)',
    gel_possible: true,
  },
};

// ── Coefficients de ruissellement (source simulateur.js GIEP L.99–116) ──────
export const COEFFS_INITIAL = {
  tresBoise:     0.15,  // Forêt dense endémique, tamarin, bois de couleur
  boise:         0.25,  // Forêt secondaire, plantation, vergers
  savane:        0.35,  // Savane herbacée, Vétiver, graminées
  canne:         0.45,  // Canne à sucre (culture principale de l'île)
  aride:         0.60,  // Sol nu, lavaka, friches sèches sous le vent
  constructions: 0.85,  // Bâti, routes bitumées, parkings
};

export const COEFFS_PROJET = {
  toitureVersant:     0.95,  // Toiture traditionnelle (tuile, tôle)
  toitureVegetalisee: 0.30,  // Toiture végétalisée (RTAA préconisée)
  voirie:             0.90,  // Voirie imperméable
  semiPerm:           0.50,  // Pavés drainants, graviers
  espacesVerts:       0.20,  // Pelouse, jardins, parterres
};

// ── Presets densité (source simulateur.js GIEP L.91–97) ─────────────────────
export const DENSITY_PRESETS = {
  friche:       { pctTresBoise: 0, pctBoise: 10, pctSavane: 90, pctCanne: 0, pctAride: 0, pctConstructions: 0 },
  jardin:       { pctTresBoise: 0, pctBoise: 60, pctSavane: 30, pctCanne: 0, pctAride: 0, pctConstructions: 10 },
  lotissement:  { pctTresBoise: 0, pctBoise: 25, pctSavane: 50, pctCanne: 0, pctAride: 0, pctConstructions: 25 },
  dense:        { pctTresBoise: 0, pctBoise: 25, pctSavane: 35, pctCanne: 0, pctAride: 0, pctConstructions: 40 },
  tres_dense:   { pctTresBoise: 0, pctBoise: 15, pctSavane: 25, pctCanne: 0, pctAride: 0, pctConstructions: 60 },
};

// ── Géologie volcanique (source BRGM + calibration GIEP carte-infos.js) ─────
export const GEOLOGICAL_COLOR_MAP = {
  '#f5a623': { name: 'Basalte hawaiite ancien (Bouclier Piton des Neiges)',
               type: 'basalte_ancien', permeability: 'moyenne',
               coefficient_k: 5, age: '> 500 000 ans',
               geotech: 'G1 recommandée si très altéré' },
  '#7ed321': { name: 'Coulées récentes Piton des Neiges',
               type: 'basalte_recent', permeability: 'bonne',
               coefficient_k: 15, age: '100-500 000 ans',
               geotech: 'Fondations superficielles généralement possibles' },
  '#e8004d': { name: 'Coulées Piton de la Fournaise récentes',
               type: 'basalte_recent', permeability: 'très bonne',
               coefficient_k: 25, age: '< 5 000 ans',
               geotech: 'Excellente portance — attention aux tunnels de lave' },
  '#f8e71c': { name: 'Trachytes / Phonolites Piton des Neiges',
               type: 'trachyte', permeability: 'faible',
               coefficient_k: 2, age: '1-2 Ma',
               geotech: "G1 recommandée — risque d'altération argileuse" },
  '#4a90e2': { name: 'Alluvions / Dépôts de ravines',
               type: 'alluvions', permeability: 'variable',
               coefficient_k: 10, age: 'Holocène',
               geotech: 'G1 OBLIGATOIRE — compressibles, tassements' },
  '#8b572a': { name: 'Remblai anthropique',
               type: 'remblai', permeability: 'faible',
               coefficient_k: 1, age: 'Récent',
               geotech: 'G1 OBLIGATOIRE — tassements différentiels' },
  '#417505': { name: 'Scories et projections volcaniques',
               type: 'scories', permeability: 'très bonne',
               coefficient_k: 30, age: 'Variable',
               geotech: 'Attention aux poches et tunnels' },
  '#9b9b9b': { name: 'Formations superficielles altérées',
               type: 'alteration', permeability: 'faible à moyenne',
               coefficient_k: 3, age: 'Pléistocène',
               geotech: 'Argilisation possible — G1 recommandée' },
};

// ── RTAA DOM 2016 — Obligations techniques Réunion ──────────────────────────
export const RTAA_DOM_2016 = {
  zone1: {
    label: 'Zone 1 — Littoral < 400m',
    porosite_sejour: 22,
    porosite_chambres: 18,
    brasseurs_plafond: true,
    ecs_solaire_min: 50,
    protection_pluie: 'forte',
    isolation_requis: false,
    note: 'Priorité à la ventilation naturelle traversante',
  },
  zone2: {
    label: 'Zone 2 — Mi-pentes 400-800m',
    porosite_sejour: 18,
    porosite_chambres: 15,
    brasseurs_plafond: true,
    ecs_solaire_min: 50,
    protection_pluie: 'forte',
    isolation_requis: false,
    note: 'Transition thermique — nuits fraîches possibles',
  },
  zone3: {
    label: 'Zone 3 — Hauts > 800m',
    porosite_sejour: 15,
    porosite_chambres: 12,
    brasseurs_plafond: false,
    ecs_solaire_min: 50,
    protection_pluie: 'très forte',
    isolation_requis: true,
    gel_possible: true,
    note: 'Inversion de priorité : isolation > ventilation',
  },
  commun: {
    interdits: [
      'Fenêtres horizontales en toiture (sauf Velux protégés)',
      'Matériaux non résistants cyclones (bois non traité exposé)',
      'Installations ECS sans ballon tampon en zone cyclonique',
    ],
    seisme_zone: 2,
    chainages: 'H+V obligatoires en maçonnerie',
    sdis: { voie_min_m: 3.0, hauteur_libre_m: 3.5, portance_t: 13, hydrant_max_m: 150 },
  },
};

// ── Intercommunalités La Réunion ────────────────────────────────────────────
export const INTERCO_MAP = {
  '97411': 'CINOR',  '97423': 'CINOR',  '97418': 'CINOR',  '97440': 'CINOR',  '97432': 'CINOR',
  '97408': 'CIREST', '97403': 'CIREST', '97402': 'CIREST', '97427': 'CIREST',
  '97416': 'CASUD',  '97425': 'CASUD',  '97413': 'CASUD',  '97422': 'CASUD',  '97419': 'CASUD',
  '97420': 'TCO',    '97415': 'TCO',    '97424': 'TCO',    '97417': 'TCO',    '97436': 'TCO',
};

// ── Communes La Réunion ─────────────────────────────────────────────────────
export const COMMUNES_REUNION = {
  '97411': 'Saint-Denis',     '97423': 'Sainte-Marie',    '97418': 'Sainte-Suzanne',
  '97440': 'Bras-Panon',     '97432': 'Saint-André',     '97408': 'Saint-Benoît',
  '97403': 'Salazie',        '97402': 'Sainte-Rose',     '97427': 'Saint-Philippe',
  '97416': 'Saint-Pierre',   '97425': 'Petite-Île',      '97413': 'Saint-Joseph',
  '97422': 'Entre-Deux',     '97419': 'Le Tampon',       '97420': 'Étang-Salé',
  '97415': 'Saint-Louis',    '97424': 'Cilaos',          '97417': 'Saint-Leu',
  '97436': 'Trois-Bassins',  '97421': 'Saint-Paul',      '97414': 'La Possession',
  '97410': 'Le Port',
};

// ── Fonctions utilitaires Réunion ───────────────────────────────────────────

// Pente estimée par altitude (source carte-infos.js GIEP)
export function estimerPenteParAltitude(altitude_ngr) {
  const alt = parseFloat(altitude_ngr ?? 0);
  if (alt < 100)  return 1.5;   // Littoral : plat à légèrement pentu
  if (alt < 400)  return 3.0;   // Mi-pentes basses
  if (alt < 800)  return 5.5;   // Mi-pentes moyennes
  if (alt < 1200) return 9.0;   // Hauts
  return 14.0;                   // Cirques et sommets
}

// Zone climatique auto (source config.js GIEP L.276–298)
export function deduireZoneClimatique(altitude_ngr, lat, lng) {
  const alt = parseFloat(altitude_ngr ?? 0);
  const la  = parseFloat(lat ?? -21.1);
  const lo  = parseFloat(lng ?? 55.5);

  if (alt > 1000) return 'hauts_cirques';
  if (alt > 500)  return 'mipentes';

  if (lo < 55.45) {
    return la > -21.1 ? 'littoral_nord_est' : 'littoral_ouest_sec';
  }
  return la < -21.2 ? 'littoral_sud_ouest' : 'littoral_nord_est';
}

// Zone RTAA DOM 2016 depuis altitude (Art. 1)
export function getZoneRTAA(altitude_ngr) {
  const alt = parseFloat(altitude_ngr ?? 0);
  if (alt < 400) return '1';
  if (alt < 800) return '2';
  return '3';
}

// ── Classification OBIA pixels Réunion (source obia-lite.js GIEP) ───────────

export function rgbToHsv(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case rn: h = ((gn - bn) / d) % 6; break;
      case gn: h = (bn - rn) / d + 2;   break;
      case bn: h = (rn - gn) / d + 4;   break;
    }
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function classifyPixelReunion(r, g, b) {
  const { h, s, v } = rgbToHsv(r, g, b);

  if (s < 0.06 && v > 0.25 && v < 0.95)               return null;                // Labels/texte
  if (h >= 180 && h <= 250 && s > 0.25)                return null;                // Eau (mer/lagon)
  if (s < 0.18 && v > 0.55)                            return 'pctConstructions';  // Béton/tôle
  if (r > 180 && g > 160 && b > 150)                   return 'pctConstructions';  // Béton clair
  if (h >= 75 && h <= 140 && s > 0.45 && v > 0.55)     return 'pctCanne';          // Canne verte
  if (h >= 70 && h <= 160 && s > 0.35 && v < 0.38)     return 'pctTresBoise';      // Forêt dense
  if (h >= 70 && h <= 160 && s > 0.25)                 return 'pctBoise';          // Végétation
  if (h >= 20 && h <= 65  && s > 0.25 && v > 0.45)     return 'pctSavane';         // Savane
  const estBrun = (h >= 10 && h <= 40 && s < 0.35 && v > 0.55);
  if (estBrun || (r > 160 && g > 130 && b < 120))      return 'pctAride';          // Sol nu
  return 'pctSavane'; // Fourre-tout végétation claire
}
