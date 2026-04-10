// TERLAB · cbs-calculator-service.js · Coefficient de Biotope par Surface (CBS)
// Indicateur écologique universel — légal Saint-Pierre Ua/AUa, pédagogique partout
// Source : Article Ua5 Éco-PLU Saint-Pierre + méthodologie biotope Berlin/Hambourg
// ENSA La Réunion · MGA Architecture

/**
 * Coefficients de valeur écologique par type de surface.
 * Basés sur l'article Ua5 du PLU Saint-Pierre :
 *   - 0.0 : surface imperméable (bâti, voirie béton, parking enrobé)
 *   - 0.5 : surface semi-perméable (dalles gazon, gravier stabilisé, pavés joints engazonnés)
 *   - 0.7 : espace planté sur dalle isolée du sol (plus de 80cm de substrat)
 *   - 0.7 : toiture végétalisée (extensive 8-12cm ou intensive)
 *   - 1.0 : espace planté de pleine terre (continuité avec sol naturel)
 */
export const CBS_COEFFS = Object.freeze({
  impermeable:        0.0,
  semi_permeable:     0.5,
  dalle_plantee:      0.7,
  toiture_vegetalisee: 0.7,
  pleine_terre:       1.0,
});

/** Libellés affichage */
export const CBS_LABELS = Object.freeze({
  impermeable:         'Surface imperméable',
  semi_permeable:      'Surface semi-perméable',
  dalle_plantee:       'Espace planté sur dalle',
  toiture_vegetalisee: 'Toiture végétalisée',
  pleine_terre:        'Espace planté pleine terre',
});

/** Couleurs cohérentes avec le code TERLAB */
export const CBS_COLORS = Object.freeze({
  impermeable:         '#6b7280',
  semi_permeable:      '#a3a3a3',
  dalle_plantee:       '#84cc16',
  toiture_vegetalisee: '#16a34a',
  pleine_terre:        '#22c55e',
});

/**
 * Exigences réglementaires connues par commune/zone.
 * Légales uniquement à Saint-Pierre (Éco-PLU article Ua5/AUa5).
 * Ailleurs : utilisé comme indicateur pédagogique sans valeur réglementaire.
 *
 * Structure : { code_insee → { zone → { cbs_min_pct, pleine_terre_min_pct, source } } }
 */
export const CBS_EXIGENCES = Object.freeze({
  // Saint-Pierre : Éco-PLU 2024, articles Ua5 / AUa5
  '97416': {
    Ua:  { cbs_min_pct: 30, pleine_terre_min_pct: 20, source: 'Éco-PLU Saint-Pierre Ua5' },
    AUa: { cbs_min_pct: 30, pleine_terre_min_pct: 20, source: 'Éco-PLU Saint-Pierre AUa5' },
  },
});

/** Seuils pédagogiques (hors valeur réglementaire) */
export const CBS_BENCHMARKS = Object.freeze({
  faible:  { max: 0.20, label: 'Faible',     color: '#ef4444' },
  moyen:   { max: 0.40, label: 'Moyen',      color: '#f59e0b' },
  bon:     { max: 0.60, label: 'Bon',        color: '#84cc16' },
  excellent: { max: 1.0, label: 'Excellent', color: '#16a34a' },
});

const CBSCalculator = {

  /**
   * Calcule le CBS d'un projet à partir de surfaces.
   * @param {Object} surfaces — { impermeable_m2, semi_permeable_m2, dalle_plantee_m2, toiture_vegetalisee_m2, pleine_terre_m2 }
   * @param {number} surfaceParcelle_m2 — surface totale unité foncière (B)
   * @returns {Object} { cbs, cbs_pct, surface_eco_m2, breakdown[], pleine_terre_pct }
   */
  compute(surfaces = {}, surfaceParcelle_m2) {
    const B = parseFloat(surfaceParcelle_m2) || 0;
    if (B <= 0) {
      return {
        cbs: 0, cbs_pct: 0, surface_eco_m2: 0, surface_parcelle_m2: 0,
        pleine_terre_pct: 0, breakdown: [], valid: false,
      };
    }

    const items = [
      { key: 'impermeable',         coeff: CBS_COEFFS.impermeable,        s: parseFloat(surfaces.impermeable_m2) || 0 },
      { key: 'semi_permeable',      coeff: CBS_COEFFS.semi_permeable,     s: parseFloat(surfaces.semi_permeable_m2) || 0 },
      { key: 'dalle_plantee',       coeff: CBS_COEFFS.dalle_plantee,      s: parseFloat(surfaces.dalle_plantee_m2) || 0 },
      { key: 'toiture_vegetalisee', coeff: CBS_COEFFS.toiture_vegetalisee, s: parseFloat(surfaces.toiture_vegetalisee_m2) || 0 },
      { key: 'pleine_terre',        coeff: CBS_COEFFS.pleine_terre,       s: parseFloat(surfaces.pleine_terre_m2) || 0 },
    ];

    const breakdown = items.map(it => ({
      key:        it.key,
      label:      CBS_LABELS[it.key],
      color:      CBS_COLORS[it.key],
      coeff:      it.coeff,
      surface_m2: it.s,
      pct_parcelle: B > 0 ? (it.s / B) * 100 : 0,
      surface_eco_m2: it.s * it.coeff,
      pct_eco: B > 0 ? (it.s * it.coeff / B) * 100 : 0,
    }));

    const surfaceEco = breakdown.reduce((sum, it) => sum + it.surface_eco_m2, 0);
    const cbs = surfaceEco / B;
    const pleineTerrePct = B > 0
      ? (breakdown.find(b => b.key === 'pleine_terre').surface_m2 / B) * 100
      : 0;

    return {
      cbs,
      cbs_pct: cbs * 100,
      surface_eco_m2: surfaceEco,
      surface_parcelle_m2: B,
      pleine_terre_pct: pleineTerrePct,
      breakdown,
      valid: true,
    };
  },

  /**
   * Valide un CBS contre les exigences réglementaires d'une commune/zone.
   * @param {number} cbs — CBS calculé (0..1)
   * @param {number} pleineTerrePct — % pleine terre (0..100)
   * @param {string} codeInsee
   * @param {string} zonePlu
   * @returns {Object} { reglementaire, conforme_cbs, conforme_pleine_terre, exigence, gap_cbs_pct, gap_pt_pct }
   */
  validate(cbs, pleineTerrePct, codeInsee, zonePlu) {
    const exigence = CBS_EXIGENCES[codeInsee]?.[zonePlu] ?? null;
    if (!exigence) {
      return {
        reglementaire: false,
        conforme_cbs: null,
        conforme_pleine_terre: null,
        exigence: null,
        gap_cbs_pct: null,
        gap_pt_pct: null,
        note: 'CBS non réglementé pour cette commune/zone — indicateur pédagogique seulement',
      };
    }
    const cbsPct = cbs * 100;
    return {
      reglementaire: true,
      conforme_cbs:          cbsPct >= exigence.cbs_min_pct,
      conforme_pleine_terre: pleineTerrePct >= exigence.pleine_terre_min_pct,
      exigence,
      gap_cbs_pct: cbsPct - exigence.cbs_min_pct,
      gap_pt_pct:  pleineTerrePct - exigence.pleine_terre_min_pct,
    };
  },

  /** Catégorise un score CBS selon les benchmarks pédagogiques */
  categorize(cbs) {
    for (const [key, b] of Object.entries(CBS_BENCHMARKS)) {
      if (cbs <= b.max) return { key, ...b };
    }
    return { key: 'excellent', ...CBS_BENCHMARKS.excellent };
  },

  /**
   * Récupère l'exigence CBS pour une commune/zone, en lisant d'abord
   * les données PLU enrichies (block cbs dans plu-rules-reunion.json),
   * puis en fallback la table CBS_EXIGENCES locale.
   * @param {Object} pluCfg — config PLU résolue par PLUP07Adapter (cfg.plu)
   * @returns {Object|null} { cbs_min_pct, pleine_terre_min_pct, source } ou null
   */
  getExigenceFromPlu(pluCfg) {
    if (!pluCfg) return null;
    // 1. Données enrichies depuis l'adapter
    if (pluCfg.cbs && (pluCfg.cbs.cbs_min_pct != null || pluCfg.cbs.gt250m2_cbs_min_pct != null)) {
      return {
        cbs_min_pct: pluCfg.cbs.cbs_min_pct ?? pluCfg.cbs.gt250m2_cbs_min_pct,
        pleine_terre_min_pct: pluCfg.cbs.pleine_terre_min_pct ?? pluCfg.cbs.gt250m2_pleine_terre_min_pct ?? null,
        source: pluCfg.cbs.source ?? 'PLU communal',
        reglementaire: true,
      };
    }
    return null;
  },

  /**
   * Calcule le CBS depuis la session TERLAB (terrain + phases 7/8).
   * Heuristique : déduit les surfaces depuis l'emprise gabarit (P07),
   * les mesures GIEP (P08) et le % perméable PLU (P04).
   * @param {Object} sessionData
   * @returns {Object|null} résultat compute() + validation
   */
  computeFromSession(sessionData) {
    const terrain = sessionData?.terrain ?? {};
    const p4 = sessionData?.phases?.[4]?.data ?? {};
    const p7 = sessionData?.phases?.[7]?.data ?? {};
    const p8 = sessionData?.phases?.[8]?.data ?? {};

    const surfaceParcelle = parseFloat(terrain.contenance_m2) || 0;
    if (surfaceParcelle <= 0) return null;

    // Emprise bâtie depuis le gabarit P07
    const empriseBati = parseFloat(p7.gabarit_l_m ?? 0) * parseFloat(p7.gabarit_w_m ?? 0);

    // Voirie / accès : approximation 5% parcelle (override possible via p7.voirie_m2)
    const voirie = parseFloat(p7.voirie_m2) || surfaceParcelle * 0.05;

    // Mesures GIEP cochées en P08 (toiture verte / pavé drainant)
    const mesures = p8.giep_mesures ?? [];
    const hasToitureVerte = mesures.includes('toiture_verte');
    const hasPaveDrainant = mesures.includes('pave_drainant');

    // Surfaces dérivées
    const toitureVeg     = hasToitureVerte ? empriseBati * 0.7 : 0;        // 70% de l'emprise en toiture verte
    const toitureClassic = empriseBati - toitureVeg;                        // reste = imperméable bâti
    const semiPerm       = hasPaveDrainant ? voirie * 0.4 : 0;              // 40% voirie en perméable
    const voirieDure     = voirie - semiPerm;
    const dallePlantee   = parseFloat(p8.dalle_plantee_m2) || 0;
    const reste = Math.max(0, surfaceParcelle - empriseBati - voirie - dallePlantee);
    const pleineTerre = reste; // espaces verts résiduels

    const surfaces = {
      impermeable_m2:        toitureClassic + voirieDure,
      semi_permeable_m2:     semiPerm,
      dalle_plantee_m2:      dallePlantee,
      toiture_vegetalisee_m2: toitureVeg,
      pleine_terre_m2:       pleineTerre,
    };

    const result = this.compute(surfaces, surfaceParcelle);

    // Récupérer exigence depuis PLU enrichi (P04) si dispo, sinon table locale
    const codeInsee = terrain.code_insee;
    const zonePlu = p4.zone_plu ?? terrain.zone_plu;
    const pluCbs = (p4.plu_cbs ?? terrain.plu_cbs) || null;

    let exigence = null;
    if (pluCbs?.cbs_min_pct != null) {
      exigence = {
        cbs_min_pct: pluCbs.cbs_min_pct,
        pleine_terre_min_pct: pluCbs.pleine_terre_min_pct ?? null,
        source: pluCbs.source ?? `PLU ${codeInsee} zone ${zonePlu}`,
        reglementaire: true,
      };
    } else {
      const ex = CBS_EXIGENCES[codeInsee]?.[zonePlu];
      if (ex) exigence = { ...ex, reglementaire: true };
    }

    const validation = exigence
      ? {
          reglementaire: true,
          conforme_cbs: result.cbs_pct >= exigence.cbs_min_pct,
          conforme_pleine_terre: exigence.pleine_terre_min_pct == null
            ? null
            : result.pleine_terre_pct >= exigence.pleine_terre_min_pct,
          exigence,
          gap_cbs_pct: result.cbs_pct - exigence.cbs_min_pct,
          gap_pt_pct:  exigence.pleine_terre_min_pct == null
            ? null
            : result.pleine_terre_pct - exigence.pleine_terre_min_pct,
        }
      : { reglementaire: false, exigence: null,
          note: 'Indicateur pédagogique — CBS non réglementé pour cette zone' };

    const benchmark = this.categorize(result.cbs);

    return { ...result, validation, benchmark, codeInsee, zonePlu };
  },
};

export default CBSCalculator;

// Expose pour compatibilité non-module TERLAB
if (typeof window !== 'undefined') {
  window.CBSCalculator = CBSCalculator;
  window.CBS_COEFFS = CBS_COEFFS;
  window.CBS_LABELS = CBS_LABELS;
  window.CBS_EXIGENCES = CBS_EXIGENCES;
}
