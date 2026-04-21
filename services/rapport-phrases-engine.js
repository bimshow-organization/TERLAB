// TERLAB · rapport-phrases-engine.js · v1.0
// ════════════════════════════════════════════════════════════════════════════
// Picker + interpolator pour data/rapport-phrases.json
// Évalue les `cond` de chaque entrée et renvoie une phrase contextualisée.
//
// API :
//   await loadPhrases()                             → charge & cache le JSON
//   pickShort(dict, section, key, ctx)              → 1 phrase courte (sync)
//   pickAll(dict, section, key, ctx, { mode })      → toutes les phrases retenues
//   buildPluContext(terrain, p4)                    → ctx prêt pour section "plu"
//
// Format des conditions supportées :
//   { always: true }                  → toujours match
//   { missing: "var_name" }           → ctx[var] est null/empty
//   { var_lt: 5 }                     → ctx[var] < 5
//   { var_lte: 5 }                    → ctx[var] <= 5
//   { var_gt: 5 }                     → ctx[var] > 5
//   { var_gte: 5 }                    → ctx[var] >= 5
//   { var_in: [...] }                 → ctx[var] ∈ array
//   { var: value }                    → ctx[var] === value
// ════════════════════════════════════════════════════════════════════════════

let _cache = null;

/** Charge data/rapport-phrases.json (cached). */
export async function loadPhrases() {
  if (_cache) return _cache;
  try {
    const res = await fetch(new URL('../data/rapport-phrases.json', import.meta.url));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _cache = await res.json();
  } catch (e) {
    console.warn('[rapport-phrases] chargement impossible:', e.message);
    _cache = {};
  }
  return _cache;
}

function _isMissing(v) {
  return v == null || v === '' || v === '—';
}

function _evalCond(cond, ctx) {
  if (!cond || typeof cond !== 'object') return false;
  for (const [key, expected] of Object.entries(cond)) {
    if (key === 'always') {
      if (!expected) return false;
      continue;
    }
    if (key === 'missing') {
      if (!_isMissing(ctx[expected])) return false;
      continue;
    }
    const m = key.match(/^(.+)_(lt|lte|gt|gte|in)$/);
    if (m) {
      const [, varName, op] = m;
      const v = ctx[varName];
      if (v == null) return false;
      if (op === 'in') {
        if (!Array.isArray(expected) || !expected.includes(v)) return false;
        continue;
      }
      const num = Number(v);
      if (Number.isNaN(num)) return false;
      const ref = Number(expected);
      if (op === 'lt'  && !(num <  ref)) return false;
      if (op === 'lte' && !(num <= ref)) return false;
      if (op === 'gt'  && !(num >  ref)) return false;
      if (op === 'gte' && !(num >= ref)) return false;
      continue;
    }
    // Égalité simple
    if (ctx[key] !== expected) return false;
  }
  return true;
}

function _interpolate(text, ctx) {
  return text.replace(/\{([a-z_0-9]+)\}/gi, (_, k) => {
    const v = ctx[k];
    return v == null || v === '' ? '…' : String(v);
  });
}

/** Renvoie la 1re phrase courte qui match (champ `short` sinon `text`). */
export function pickShort(dict, section, key, ctx) {
  const entries = dict?.[section]?.[key];
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    if (_evalCond(entry.cond, ctx)) {
      const text = entry.short ?? entry.text ?? '';
      if (!text) continue;
      return _interpolate(text, ctx);
    }
  }
  return null;
}

/** Renvoie toutes les phrases qui matchent. mode = 'short' | 'long'. */
export function pickAll(dict, section, key, ctx, { mode = 'short' } = {}) {
  const entries = dict?.[section]?.[key];
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const entry of entries) {
    if (_evalCond(entry.cond, ctx)) {
      const text = mode === 'short' ? (entry.short ?? entry.text ?? '') : (entry.text ?? '');
      if (text) out.push(_interpolate(text, ctx));
    }
  }
  return out;
}

/** Dérive le type PLU (U/AU/A/N) depuis un code zone (UA, UB, AUs, …). */
export function derivePluType(zonePlu) {
  if (!zonePlu) return null;
  const z = String(zonePlu).trim().toUpperCase();
  if (/^AU/.test(z)) return 'AU';
  if (/^U/.test(z))  return 'U';
  if (/^N/.test(z))  return 'N';
  if (/^A/.test(z))  return 'A';
  return null;
}

/** Construit le contexte d'évaluation pour la section "plu". */
export function buildPluContext(terrain = {}, p4 = {}) {
  const zonePlu = terrain.zone_plu ?? p4.zone_plu ?? null;
  const surface = terrain.contenance_m2 ?? terrain.surface_m2 ?? null;
  const reculVoie = p4.recul_voie_principale_m ?? null;
  const reculLat  = p4.recul_limite_sep_m ?? null;
  const reculFond = p4.recul_fond_m ?? null;
  // Beaucoup de PLU réunionnais ne distinguent pas fond / latéral :
  // si fond absent, ou si fond == latéral, on considère la règle indifférenciée.
  const reculFondUndiff = (reculFond == null)
    || (reculLat != null && Number(reculFond) === Number(reculLat));
  return {
    commune: terrain.commune ?? null,
    surface_m2: surface,
    surface_ha: surface ? (surface / 10000).toFixed(2) : null,
    pente_pct: terrain.pente_moy_pct ?? null,
    altitude: terrain.altitude_ngr ?? null,
    zone_plu: zonePlu,
    zone_plu_type: derivePluType(zonePlu),
    hauteur_max_m: p4.hauteur_max_m ?? null,
    emprise_sol_max_pct: p4.emprise_sol_max_pct ?? null,
    recul_voie_m: reculVoie,
    recul_lat_m: reculLat,
    recul_fond_m: reculFond,
    recul_fond_undiff: reculFondUndiff,
    permeable_min_pct: p4.permeable_min_pct ?? null,
  };
}

/**
 * Construit un contexte complet couvrant toutes les sections du JSON :
 * geologie, risques_extra, reseaux, esquisse, plan_masse, giep, chantier,
 * sdis, bioclimatique_extra, en plus des champs de buildPluContext.
 *
 * @param {object} terrain    - terrain enrichi (session.getTerrain ou enrichResult.terrain)
 * @param {object} phases     - { 3: p3data, 4: p4data, 5: p5data, 6: p6data, 7: p7data, 8: p8data }
 * @param {object} extras     - { proposal, giepResult, windMeta, rainfallMeta }
 */
export function buildFullContext(terrain = {}, phases = {}, extras = {}) {
  const p3 = phases[3] ?? {};
  const p4 = phases[4] ?? {};
  const p6 = phases[6] ?? {};
  const p7 = phases[7] ?? {};
  const p8 = phases[8] ?? {};
  const proposal = extras.proposal ?? {};
  const giepResult = extras.giepResult ?? null;
  const windMeta = extras.windMeta ?? {};
  const rainfallMeta = extras.rainfallMeta ?? {};

  // Base PLU + identification
  const pluCtx = buildPluContext(terrain, p4);

  // Bati / metrics depuis proposal (auto-plan)
  const bat = proposal.bat ?? {};
  const metrics = proposal.metrics ?? {};

  // SDIS — etats par critere
  const sdisStates = p8.acces_pompiers_states ?? {};
  const sdisVals = Object.values(sdisStates);
  const sdis_all_ok = sdisVals.length > 0 && sdisVals.every(v => v === 'ok');
  const sdis_warn = sdisVals.some(v => v === 'warn');
  const sdis_err  = sdisVals.some(v => v === 'err');

  // ── PLU conformité (section plu_synthese) ──────────────────────────
  const recul_voie_projet_m = proposal.recul_voie_m ?? p7.recul_voie_m ?? null;
  const recul_lat_projet_m  = proposal.recul_lat_m  ?? p7.recul_lat_m  ?? null;
  const recul_fond_projet_m = proposal.recul_fond_m ?? p7.recul_fond_m ?? null;
  const hauteur_projet_m    = bat.h ?? p7.gabarit_h_m ?? null;

  const _numOk = (v) => v != null && !Number.isNaN(Number(v));

  const recul_voie_conforme = (_numOk(recul_voie_projet_m) && _numOk(pluCtx.recul_voie_m))
    ? Number(recul_voie_projet_m) >= Number(pluCtx.recul_voie_m) : null;
  const recul_lat_conforme  = (_numOk(recul_lat_projet_m)  && _numOk(pluCtx.recul_lat_m))
    ? Number(recul_lat_projet_m)  >= Number(pluCtx.recul_lat_m)  : null;
  const recul_fond_conforme = (_numOk(recul_fond_projet_m) && _numOk(pluCtx.recul_fond_m))
    ? Number(recul_fond_projet_m) >= Number(pluCtx.recul_fond_m) : null;
  const hauteur_conforme    = (_numOk(hauteur_projet_m)    && _numOk(pluCtx.hauteur_max_m))
    ? Number(hauteur_projet_m)    <= Number(pluCtx.hauteur_max_m) : null;
  const ces_conforme        = (_numOk(metrics.ces_pct)     && _numOk(pluCtx.emprise_sol_max_pct))
    ? Number(metrics.ces_pct)     <= Number(pluCtx.emprise_sol_max_pct) : null;
  const permeable_conforme  = (_numOk(metrics.permeable_pct) && _numOk(pluCtx.permeable_min_pct))
    ? Number(metrics.permeable_pct) >= Number(pluCtx.permeable_min_pct) : null;

  const statio_places_projet  = proposal.statio_places ?? p7.statio_places ?? null;
  const statio_places_requises = p4.statio_places_requises ?? null;
  const statio_conforme = (_numOk(statio_places_projet) && _numOk(statio_places_requises))
    ? Number(statio_places_projet) >= Number(statio_places_requises) : null;
  const statio_deficit = (_numOk(statio_places_projet) && _numOk(statio_places_requises))
    ? Math.max(0, Number(statio_places_requises) - Number(statio_places_projet)) : null;

  const ces_marge_pct = (_numOk(metrics.ces_pct) && _numOk(pluCtx.emprise_sol_max_pct))
    ? Math.max(0, Number(pluCtx.emprise_sol_max_pct) - Number(metrics.ces_pct)).toFixed(0) : null;

  // Compteur de non-conformités (only count checks that could be evaluated)
  const checks = [recul_voie_conforme, recul_lat_conforme, recul_fond_conforme,
                  hauteur_conforme, ces_conforme, permeable_conforme, statio_conforme];
  const plu_non_conformites = checks.filter(c => c === false).length;
  const plu_all_conforme = checks.some(c => c != null) && checks.every(c => c !== false);

  return {
    ...pluCtx,
    // PLU conformité
    recul_voie_projet_m, recul_lat_projet_m, recul_fond_projet_m,
    hauteur_projet_m,
    recul_voie_conforme, recul_lat_conforme, recul_fond_conforme,
    hauteur_conforme, ces_conforme, permeable_conforme,
    statio_places_projet, statio_places_requises, statio_conforme, statio_deficit,
    ces_marge_pct, plu_non_conformites, plu_all_conforme,
    plu_date_approbation: p4.plu_date_approbation ?? terrain.plu_date_approbation ?? null,
    plu_en_revision: p4.plu_en_revision ?? terrain.plu_en_revision ?? false,
    vegetation_plu_conforme: (_numOk(metrics.arbres_count) && metrics.arbres_count > 0) ? true : null,
    programme: proposal.programme ?? p7.programme ?? null,
    // Identification
    section: terrain.section ?? null,
    parcelle: terrain.parcelle ?? null,
    adresse: terrain.adresse ?? null,
    // Topographie
    exposition: terrain.exposition ?? terrain.orientation_terrain ?? terrain.orientation ?? null,
    has_ravine: terrain.distance_ravine_m != null && Number(terrain.distance_ravine_m) < 200,
    nom_ravine: terrain.nom_ravine ?? 'ravine voisine',
    // Geologie
    geologie_type: terrain.geologie_type ?? null,
    remblai: terrain.remblai ?? null,
    geotech: terrain.geotech ?? null,
    // Risques
    zone_pprn: p3.zone_pprn ?? terrain.zone_pprn ?? null,
    cote_reference_ngr: p3.cote_reference_ngr ?? null,
    zone_rtaa_vent: p3.zone_rtaa_vent ?? null,
    hydrant_present: p3.hydrant_present ?? null,
    // Reseaux
    eau_potable: terrain.eau_potable ?? null,
    assainissement: terrain.assainissement ?? null,
    anc_filiere: terrain.anc_filiere ?? null,
    electricite: terrain.electricite ?? null,
    fibre: terrain.fibre ?? null,
    icpe: terrain.icpe ?? null,
    parc_situation: p6.parc_situation ?? null,
    // Esquisse
    surface_plancher_m2: p7.surface_plancher_m2 ?? null,
    niveaux: p7.niveaux ?? bat.niveaux ?? null,
    gabarit_l_m: p7.gabarit_l_m ?? bat.l ?? null,
    gabarit_w_m: p7.gabarit_w_m ?? bat.w ?? null,
    gabarit_h_m: p7.gabarit_h_m ?? bat.h ?? null,
    // Plan masse
    ces_pct: metrics.ces_pct ?? null,
    permeable_pct: metrics.permeable_pct ?? null,
    arbres_count: metrics.arbres_count ?? null,
    // GIEP
    giep_score: giepResult?.score ?? null,
    giep_reduction_pct: giepResult?.reduction_pct ?? null,
    giep_deficit: giepResult?.infiltration?.deficit ?? null,
    // Chantier
    saison_demarrage: p8.saison_demarrage ?? null,
    gestion_eaux_chantier: p8.gestion_eaux_chantier ?? null,
    // SDIS
    sdis_all_ok,
    sdis_warn,
    sdis_err,
    sdis_largeur: sdisStates.largeur ?? null,
    sdis_hydrant: sdisStates.hydrant ?? null,
    sdis_portance: sdisStates.portance ?? null,
    // Bioclim
    dir_dominante: windMeta.dominantDir?.[0] ?? null, // E/O/N/S (premiere lettre)
    mean_speed: windMeta.meanSpeed ?? null,
    annual_mm: rainfallMeta.annual ?? null,
    // PC4 notice — état initial & insertion
    has_constructions_existantes: !!(terrain.constructions_existantes_desc),
    constructions_existantes_desc: terrain.constructions_existantes_desc ?? null,
    has_constructions_a_demolir: !!(terrain.constructions_a_demolir_desc),
    constructions_a_demolir_desc: terrain.constructions_a_demolir_desc ?? null,
    quartier_type: terrain.quartier_type ?? p7.quartier_type ?? null,
    vegetation_existante: terrain.vegetation_existante ?? null,
    arbres_existants_desc: terrain.arbres_existants_desc ?? null,
    arbres_conserves_count: terrain.arbres_conserves_count ?? null,
    has_vue_mer: terrain.has_vue_mer ?? false,
    has_vue_montagne: terrain.has_vue_montagne ?? false,
    // PC4 notice — matériaux & couleurs
    materiaux_structure: proposal.materiaux_structure ?? p7.materiaux_structure ?? null,
    materiaux_toiture: proposal.materiaux_toiture ?? p7.materiaux_toiture ?? null,
    couleur_facade: proposal.couleur_facade ?? p7.couleur_facade ?? null,
    cloture_type: proposal.cloture_type ?? p7.cloture_type ?? null,
    cloture_h_m: proposal.cloture_h_m ?? p7.cloture_h_m ?? null,
    soutenement_h_m: proposal.soutenement_h_m ?? p7.soutenement_h_m ?? null,
    // PC4 notice — accès
    acces_type: terrain.acces_type ?? null,
    voie_largeur_m: terrain.voie_largeur_m ?? null,
    portail_largeur_m: proposal.portail_largeur_m ?? p7.portail_largeur_m ?? null,
    acces_public_direction: proposal.acces_public_direction ?? null,
    acces_public_largeur_m: proposal.acces_public_largeur_m ?? null,
    statio_pmr: proposal.statio_pmr ?? p7.statio_pmr ?? null,
  };
}

export default { loadPhrases, pickShort, pickAll, buildPluContext, buildFullContext, derivePluType };
