// TERLAB · services/scot-service.js
// Données SCoT intercommunales — armature urbaine, densités, logement
// Source : DOO (Document d'Orientations et d'Objectifs)
// ════════════════════════════════════════════════════════════════════

const SCOTService = {

  // ─── Mapping commune → intercommunalité ─────────────────────────
  COMMUNE_INTERCO: {
    // TCO — Territoire de la Côte Ouest
    '97407': 'TCO', '97406': 'TCO', '97415': 'TCO', '97423': 'TCO', '97416': 'TCO',
    // CINOR — Nord
    '97411': 'CINOR', '97418': 'CINOR', '97420': 'CINOR',
    // CIREST — Est
    '97402': 'CIREST', '97410': 'CIREST', '97419': 'CIREST', '97421': 'CIREST',
    '97405': 'CIREST', '97408': 'CIREST',
    // CASUD — Sud
    '97412': 'CASUD', '97403': 'CASUD', '97409': 'CASUD', '97413': 'CASUD',
    // CIVIS — Grand Sud
    '97414': 'CIVIS', '97422': 'CIVIS', '97404': 'CIVIS', '97401': 'CIVIS', '97424': 'CIVIS',
  },

  // Noms lisibles
  INTERCO_NOMS: {
    TCO:   'Territoire de la Côte Ouest',
    CINOR: 'Communauté Intercommunale du Nord',
    CIREST:'Communauté Intercommunale Réunion Est',
    CASUD: 'Communauté d\'Agglomération du Sud',
    CIVIS: 'Communauté Intercommunale des Villes Solidaires',
  },

  // ─── Cache des fichiers JSON chargés ────────────────────────────
  _cache: new Map(),

  /**
   * Charge les règles SCOT pour une intercommunalité.
   * @param {string} interco — 'TCO', 'CINOR', etc.
   * @returns {object|null}
   */
  async loadRules(interco) {
    if (this._cache.has(interco)) return this._cache.get(interco);

    const slug = interco.toLowerCase();
    const url = `../data/scot-rules-${slug}.json`;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) return null;
      const data = await resp.json();
      this._cache.set(interco, data);
      return data;
    } catch (e) {
      console.warn(`[SCOT] Fichier ${url} non trouvé:`, e.message);
      return null;
    }
  },

  /**
   * Identifie l'intercommunalité à partir du code INSEE.
   * @param {string} insee — ex: '97415'
   * @returns {string|null}
   */
  getInterco(insee) {
    return this.COMMUNE_INTERCO[insee] ?? null;
  },

  // ─── Requête principale ─────────────────────────────────────────

  /**
   * Analyse SCOT complète pour un terrain.
   * @param {object} params
   * @param {string} params.insee — code INSEE commune
   * @param {string} params.commune — nom commune
   * @param {string} [params.quartier] — nom quartier/lieu-dit (optionnel)
   * @param {number} [params.surface_m2] — surface terrain (pour calcul capacité)
   * @returns {object} résultat SCOT
   */
  async analyze({ insee, commune, quartier, surface_m2 }) {
    const interco = this.getInterco(insee);
    if (!interco) {
      return {
        source: 'scot-service',
        status: 'hors_reunion',
        message: `Code INSEE ${insee} non reconnu à La Réunion`,
      };
    }

    const rules = await this.loadRules(interco);
    if (!rules) {
      return {
        source: 'scot-service',
        status: 'non_disponible',
        interco,
        interco_nom: this.INTERCO_NOMS[interco] ?? interco,
        message: `SCoT ${interco} non encore intégré dans TERLAB`,
      };
    }

    // Trouver le rang dans l'armature urbaine
    const rang = this._findRang(rules, commune, quartier);

    // Densité applicable
    const densite = this._getDensite(rules, rang);

    // Capacité d'accueil estimée
    const capacite = surface_m2 ? this._estimerCapacite(densite, surface_m2) : null;

    // Logement
    const logement = rules.logement ?? null;

    return {
      source: 'scot-service',
      status: 'ok',
      interco,
      interco_nom: this.INTERCO_NOMS[interco] ?? interco,
      scot_nom: rules.scot ?? `SCoT ${interco}`,
      approbation: rules.approbation,
      modification: rules.modification_simplifiee_1 ?? null,
      revision_prescrite: rules.revision_prescrite ?? null,
      rang,
      densite,
      capacite,
      logement: logement ? {
        pct_aides: logement.pct_logements_aides_dans_production,
        production_annuelle_aides: logement.production_annuelle_logements_aides,
        orientations_resume: logement.orientations?.slice(0, 3) ?? [],
      } : null,
      environnement_resume: this._resumeEnvironnement(rules),
    };
  },

  // ─── Recherche du rang dans l'armature ──────────────────────────

  /**
   * Trouve le rang d'armature urbaine pour une commune/quartier.
   * Recherche par nom de place urbaine (matching souple).
   */
  _findRang(rules, commune, quartier) {
    const armature = rules.armature_urbaine?.niveaux;
    if (!armature) return null;

    const communeNorm = this._normalize(commune);
    const quartierNorm = quartier ? this._normalize(quartier) : null;

    // Chercher d'abord par quartier (plus précis)
    if (quartierNorm) {
      for (const [rangKey, niveau] of Object.entries(armature)) {
        const places = niveau.places_urbaines ?? [];
        for (const place of places) {
          const placeNorm = this._normalize(place.nom);
          if (placeNorm.includes(quartierNorm) || quartierNorm.includes(placeNorm)) {
            return this._buildRangResult(rangKey, niveau, place);
          }
        }
      }
    }

    // Sinon par commune (prendre le rang le plus élevé trouvé)
    let bestRang = null;
    for (const [rangKey, niveau] of Object.entries(armature)) {
      const places = niveau.places_urbaines ?? [];
      for (const place of places) {
        const placeCommune = this._normalize(place.commune);
        if (placeCommune === communeNorm) {
          if (!bestRang || this._rangOrder(rangKey) < this._rangOrder(bestRang.rang_key)) {
            bestRang = this._buildRangResult(rangKey, niveau, place);
          }
        }
      }
    }

    return bestRang;
  },

  _buildRangResult(rangKey, niveau, place) {
    const num = parseInt(rangKey.replace('rang_', ''));
    return {
      rang_key: rangKey,
      rang_num: num,
      label: niveau.label,
      place_urbaine: place.nom,
      commune: place.commune,
    };
  },

  _rangOrder(rangKey) {
    return parseInt(rangKey.replace('rang_', '')) || 99;
  },

  _normalize(str) {
    return (str ?? '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[-']/g, ' ')
      .trim();
  },

  // ─── Densité applicable ─────────────────────────────────────────

  _getDensite(rules, rang) {
    if (!rang) return { densite_min_lgts_ha: null, source: 'rang non identifié' };

    const densiteRules = rules.densite?.regles ?? [];
    const rangNum = rang.rang_num;

    for (const r of densiteRules) {
      if (r.rang.includes(rangNum)) {
        return {
          densite_min_lgts_ha: r.densite_min_lgts_ha,
          densite_max_lgts_ha: r.densite_max_lgts_ha ?? null,
          label: r.label,
          source: `DOO O8 — rang ${rangNum}`,
          note: rules.densite?.note ?? null,
          calcul_densite: rules.densite?.calcul_densite ?? null,
          zatt_500m: rules.densite?.zatt_500m ?? null,
        };
      }
    }

    return { densite_min_lgts_ha: null, source: 'pas de règle trouvée' };
  },

  // ─── Capacité d'accueil estimée ─────────────────────────────────

  /**
   * Estime le nombre minimum de logements attendu par le SCOT.
   * @param {object} densite — résultat de _getDensite
   * @param {number} surface_m2 — surface du terrain
   */
  _estimerCapacite(densite, surface_m2) {
    const dMin = densite.densite_min_lgts_ha;
    if (!dMin || !surface_m2) return null;

    const ha = surface_m2 / 10000;
    return {
      surface_ha: Math.round(ha * 100) / 100,
      logements_min_scot: Math.ceil(ha * dMin),
      logements_max_scot: densite.densite_max_lgts_ha
        ? Math.ceil(ha * densite.densite_max_lgts_ha)
        : null,
      densite_min_lgts_ha: dMin,
    };
  },

  // ─── Vérification conformité ────────────────────────────────────

  /**
   * Vérifie si un projet respecte les prescriptions SCOT.
   * @param {object} params
   * @param {string} params.insee
   * @param {string} params.commune
   * @param {string} [params.quartier]
   * @param {number} params.surface_m2 — surface opération
   * @param {number} params.nb_logements — nombre de logements projetés
   * @param {number} [params.nb_logements_aides] — nombre logements aidés
   * @returns {object} diagnostic conformité
   */
  async verifierConformite({ insee, commune, quartier, surface_m2, nb_logements, nb_logements_aides }) {
    const analyse = await this.analyze({ insee, commune, quartier, surface_m2 });
    if (analyse.status !== 'ok') return { conforme: null, analyse, alertes: [] };

    const alertes = [];
    const ha = surface_m2 / 10000;
    const densiteProjet = nb_logements / ha;

    // 1. Vérification densité
    const dMin = analyse.densite?.densite_min_lgts_ha;
    if (dMin && densiteProjet < dMin) {
      alertes.push({
        type: 'densite_insuffisante',
        severity: 'error',
        message: `Densité projet ${Math.round(densiteProjet)} lgts/ha < minimum SCOT ${dMin} lgts/ha (${analyse.rang?.label})`,
        valeur_projet: Math.round(densiteProjet),
        valeur_scot: dMin,
      });
    } else if (dMin) {
      alertes.push({
        type: 'densite_conforme',
        severity: 'ok',
        message: `Densité projet ${Math.round(densiteProjet)} lgts/ha ≥ minimum SCOT ${dMin} lgts/ha`,
        valeur_projet: Math.round(densiteProjet),
        valeur_scot: dMin,
      });
    }

    // 2. Vérification % logements aidés
    const pctAide = analyse.logement?.pct_aides;
    if (pctAide && nb_logements_aides != null) {
      const pctProjet = Math.round((nb_logements_aides / nb_logements) * 100);
      if (pctProjet < pctAide) {
        alertes.push({
          type: 'logement_aide_insuffisant',
          severity: 'warning',
          message: `${pctProjet}% logements aidés < objectif SCOT ${pctAide}%`,
          valeur_projet: pctProjet,
          valeur_scot: pctAide,
        });
      } else {
        alertes.push({
          type: 'logement_aide_conforme',
          severity: 'ok',
          message: `${pctProjet}% logements aidés ≥ objectif SCOT ${pctAide}%`,
          valeur_projet: pctProjet,
          valeur_scot: pctAide,
        });
      }
    }

    const conforme = alertes.every(a => a.severity !== 'error');

    return { conforme, analyse, alertes, densiteProjet: Math.round(densiteProjet) };
  },

  // ─── Résumé environnement ───────────────────────────────────────

  _resumeEnvironnement(rules) {
    const env = rules.environnement;
    if (!env) return null;
    return {
      bande_ravine_m: env.continuite_ecologique?.bande_ravine_enherbee_m ?? null,
      infiltration_source: env.risques?.infiltration_a_la_source ?? false,
      impermeabilisation_minimisee: env.risques?.impermeabilisation_minimisee ?? false,
      assainissement: env.eau?.assainissement_rang_1_2_3 ?? null,
    };
  },

  // ─── Utilitaire : liste des interco disponibles ─────────────────

  async listAvailable() {
    const intercos = [...new Set(Object.values(this.COMMUNE_INTERCO))];
    const result = [];
    for (const interco of intercos) {
      const rules = await this.loadRules(interco);
      result.push({
        interco,
        nom: this.INTERCO_NOMS[interco] ?? interco,
        disponible: !!rules,
        communes: Object.entries(this.COMMUNE_INTERCO)
          .filter(([, v]) => v === interco)
          .map(([k]) => k),
      });
    }
    return result;
  },
};

export default SCOTService;
