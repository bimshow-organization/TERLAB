// TERLAB · terlab-score-service.js · Score global par phase · ENSA La Réunion
// Calcule un score 0–100 basé sur la complétion pondérée des 14 phases

const TerlabScoreService = {

  // Poids par phase (total = 100)
  POIDS: {
    0:  15,  // Identification — fondamentale
    1:  10,  // Topographie
    2:   8,  // Géologie
    3:  10,  // Risques
    4:   8,  // PLU
    5:   5,  // Voisinage
    6:   5,  // Biodiversité
    7:  12,  // Esquisse — clé de voûte
    8:   8,  // Chantier
    9:   5,  // Carbone
    10:  5,  // Entretien
    11:  5,  // Fin de vie
    12:  4,  // Synthèse
    13:  0,  // World (bonus, pas comptabilisé)
  },

  // Critères minimum par phase pour être "complète"
  CRITERES: {
    0:  ['lat', 'lng', 'parcelle_geojson', 'commune', 'contenance_m2'],
    1:  ['pente_moy_pct', 'zone_climatique', 'zone_rtaa'],
    2:  ['type_geologique'],
    3:  ['ppr_zone'],
    4:  ['plu_zone'],
    5:  ['exposition_solaire'],
    6:  ['obia_surfaces'],
    7:  ['gabarit_l_m', 'gabarit_w_m', 'gabarit_h_m'],
    8:  ['acces_pompiers_states', 'giep_mesures'],
    9:  ['materiaux_selectionnes'],
    10: ['surface_plancher_m2'],
    11: ['esquisse_svg'],
    12: ['rapport_genere'],
    13: [],
  },

  /**
   * Calcule le score global TERLAB
   * @param {object} sessionData — SessionManager._data
   * @returns {{ total: number, max: number, details: object }}
   */
  compute(sessionData) {
    if (!sessionData) return { total: 0, max: 100, details: {} };

    let scoreTotal = 0;
    const details = {};

    for (const [phaseStr, poids] of Object.entries(this.POIDS)) {
      const phaseId = parseInt(phaseStr);
      const criteres = this.CRITERES[phaseId] ?? [];

      // Phase 0 : données dans terrain, autres phases : dans phases[id].data
      const data = phaseId === 0
        ? sessionData.terrain
        : sessionData.phases?.[phaseId]?.data;

      if (!criteres.length) {
        details[phaseId] = { pct: 0, score: 0, max: poids };
        continue;
      }

      const remplis = criteres.filter(k => {
        const val = data?.[k];
        return val !== null && val !== undefined && val !== '';
      }).length;

      const pct = remplis / criteres.length;
      const score = Math.round(pct * poids);
      scoreTotal += score;

      details[phaseId] = {
        pct: Math.round(pct * 100),
        score,
        max: poids,
        filled: remplis,
        total: criteres.length
      };
    }

    return { total: scoreTotal, max: 100, details };
  },

  /**
   * Retourne la couleur CSS appropriée pour un score donné
   */
  getColor(score) {
    if (score < 30) return 'var(--danger)';
    if (score < 60) return 'var(--warning)';
    return 'var(--success)';
  },

  /**
   * Résumé textuel du score
   */
  getLabel(score) {
    if (score < 20) return 'Démarrage';
    if (score < 40) return 'En cours';
    if (score < 60) return 'Avancé';
    if (score < 80) return 'Bien avancé';
    return 'Quasi complet';
  }
};

export default TerlabScoreService;
