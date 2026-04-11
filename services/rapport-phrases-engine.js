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

  return {
    ...pluCtx,
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
  };
}

export default { loadPhrases, pickShort, pickAll, buildPluContext, buildFullContext, derivePluType };
