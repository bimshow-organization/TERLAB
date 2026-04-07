// terlab/services/pareto-scorer.js
// Score multi-objectifs des propositions d'enveloppes
// Inspiré : HOUSEG ParetoOptimizationService + HOUSEG-SPEECH scoring-engine.js

import ViewDetector from './view-detector.js';
import RTAAChecker  from './rtaa-checker.js';
import Orientation  from '../utils/orientation.js';

const ParetoScorer = {

  // Poids des 5 objectifs (total = 1)
  WEIGHTS: {
    orientation:  0.25,  // Score orientation solaire (hémisphère sud)
    vue:          0.20,  // Vue mer ou montagne (méthode ViewDetector)
    plu:          0.20,  // Conformité PLU (reculs, CES, hauteur)
    garden:       0.10,  // Compatibilité jardin BPF
    rtaa:         0.25,  // Score RTAA (conformité protection solaire)
  },

  /**
   * Scorer une proposition d'enveloppe
   * @param {{ family, polygon, surface }} proposal
   * @param {object} session - SessionManager data
   */
  async score(proposal, session) {
    const terrain = session?.terrain ?? {};
    const p4 = session?.phases?.[4]?.data ?? {};

    const lat = parseFloat(terrain.lat ?? -21.1);
    const lng = parseFloat(terrain.lng ?? 55.45);
    const altNGR = parseFloat(terrain.altitude_ngr ?? 100);
    const zone_rtaa = terrain.zone_rtaa ?? '1';

    const view = ViewDetector.detect(lat, lng, altNGR);
    const zone = RTAAChecker.getZone(altNGR);

    return {
      orientationScore: this._scoreOrientation(proposal.polygon, zone_rtaa),
      vueScore:         this._scoreVue(lat, lng, altNGR, p4),
      pluScore:         this._scorePLU(proposal.polygon, proposal.surface, p4, terrain),
      gardenScore:      this._scoreGarden(proposal.family, terrain),
      rtaaScore:        await this._scoreRTAA(proposal.polygon, zone),

      // Métadonnées
      hauteur_egout:  parseFloat(p4.hauteur_egout_m ?? 6),
      hauteur_faitage: parseFloat(p4.hauteur_faitage_m ?? 8),
      viewDirection:  view?.viewDirection ?? 0,
      viewType:       view?.viewType ?? null,
    };
  },

  // Score orientation solaire (hémisphère SUD — source : HOUSEG-SPEECH constraints.master.json)
  // Orientations préférées : Nord (soleil principal), NE, NO
  // La façade principale du bâtiment doit regarder au NORD à La Réunion
  _scoreOrientation(polygon, zone_rtaa) {
    if (!polygon || polygon.length < 3) return 0.5;
    // Calculer l'orientation de la façade la plus longue
    let maxLen = 0, mainAzimuth = 0;
    for (let i = 0; i < polygon.length; i++) {
      const j = (i + 1) % polygon.length;
      const dx = polygon[j].x - polygon[i].x;
      const dy = polygon[j].y - polygon[i].y;
      const len = Math.hypot(dx, dy);
      if (len > maxLen) {
        maxLen = len;
        mainAzimuth = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      }
    }
    // La façade regarde à mainAzimuth + 90° (perpendiculaire)
    const facadeAzimuth = (mainAzimuth + 90) % 360;

    // Score selon orientation (HOUSEG-SPEECH : N=1.0, NE=0.9, NO=0.85, E=0.6, O=0.5, S=0.1)
    const SCORES = {
      N:  { min: 315, max: 45,  score: 1.0 },
      NE: { min: 22,  max: 67,  score: 0.9 },
      NO: { min: 292, max: 337, score: 0.85 },
      E:  { min: 67,  max: 112, score: 0.6 },
      O:  { min: 247, max: 292, score: 0.5 },
      SE: { min: 112, max: 157, score: 0.4 },
      SO: { min: 202, max: 247, score: 0.3 },
      S:  { min: 157, max: 202, score: 0.1 },
    };
    for (const [dir, { min, max, score }] of Object.entries(SCORES)) {
      if (min > max) { // Nord (traverse 0°)
        if (facadeAzimuth >= min || facadeAzimuth <= max) return score;
      } else {
        if (facadeAzimuth >= min && facadeAzimuth <= max) return score;
      }
    }
    return 0.4;
  },

  // Score vue mer/montagne
  _scoreVue(lat, lng, altNGR, p4) {
    const buildingH = parseFloat(p4.hauteur_egout_m ?? 6);
    const view = ViewDetector.detect(lat, lng, altNGR, buildingH);
    return view.vueScore;
  },

  // Score conformité PLU
  _scorePLU(polygon, surface, p4, terrain) {
    let score = 1.0;
    const contenance = parseFloat(terrain.contenance_m2 ?? 300);

    // CES : coefficient emprise au sol
    const cesMax = parseFloat(p4.ces_max ?? 0.5);
    const ces    = surface / contenance;
    if (ces > cesMax) score -= 0.4;
    else if (ces > cesMax * 0.85) score -= 0.1;

    // COS : coefficient occupation sol
    const cosMax  = parseFloat(p4.cos_max ?? 1.0);
    const niveaux = parseFloat(p4.nb_niveaux ?? 1);
    const cos = (surface * niveaux) / contenance;
    if (cos > cosMax) score -= 0.3;

    // Perméabilité minimale
    const permMin = parseFloat(p4.permeabilite_min_pct ?? 20);
    const permActuelle = (1 - ces) * 100;
    if (permActuelle < permMin) score -= 0.2;

    return Math.max(0, score);
  },

  // Score jardin BPF (compatibilité avec presets de jardin par zone)
  _scoreGarden(family, terrain) {
    const alt  = parseFloat(terrain.altitude_ngr ?? 100);

    // Score selon compatibilité famille + zone
    const COMPAT = {
      'CREOLE':                { littoral: 1.0, mipentes: 0.9, hauts: 0.7 },
      'RECTANGULAIRE_SIMPLE':  { littoral: 0.8, mipentes: 0.8, hauts: 0.8 },
      'EN_L':                  { littoral: 0.7, mipentes: 0.9, hauts: 0.8 },
      'PATIO':                 { littoral: 0.9, mipentes: 0.8, hauts: 0.5 },
      'EN_U':                  { littoral: 0.7, mipentes: 0.7, hauts: 0.6 },
      'RECTANGULAIRE_ALLONGE': { littoral: 0.8, mipentes: 0.8, hauts: 0.9 },
    };
    const key = Object.keys(COMPAT).find(k => family.includes(k.replace('_', ' ').toLowerCase().split(' ')[0]));
    const zoneSimple = alt < 400 ? 'littoral' : alt < 800 ? 'mipentes' : 'hauts';
    return COMPAT[key]?.[zoneSimple] ?? 0.6;
  },

  // Score RTAA proxy (rapide, sans génération de rooms)
  async _scoreRTAA(polygon, zone) {
    try {
      return await RTAAChecker.quickScoreFromPolygon(polygon, zone);
    } catch {
      return 0.5;
    }
  },

  // Score agrégé Pareto (somme pondérée)
  aggregate(scoreData) {
    return Object.entries(this.WEIGHTS).reduce((sum, [key, w]) => {
      const scoreKey = `${key}Score`;
      return sum + w * (scoreData[scoreKey] ?? 0);
    }, 0);
  },
};

export default ParetoScorer;
