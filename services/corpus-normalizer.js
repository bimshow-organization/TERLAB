// TERLAB · services/corpus-normalizer.js
// Normalisation et groupement des cas corpus pour comparaison équitable
// ENSA La Réunion · MGA Architecture 2026
// Vanilla JS ES2022+

import FH from './footprint-helpers.js';

// ─── Règles de comparabilité ──────────────────────────────────────────────────
//
// Un cas est comparable à un autre seulement si les conditions d'implantation
// sont similaires, sinon la comparaison de l'IoU n'a aucun sens.
//
// Dimensions comparables  :
//   - Surface parcelle : ±40% (ou même bucket)
//   - CES max PLU      : ±15 points
//   - Hauteur max PLU  : ±3m
//   - Zone PLU         : identique (UA vs UA, UB vs UB)
//   - Pente topo       : même case (flat/gentle/medium/steep/extreme)
//
// Dimensions NON comparables directement :
//   - Forme de parcelle (un trapèze vs un rectangle → résultats très différents)
//   - Mitoyen (avec vs sans → emprise très différente)
//   → on les garde comme sous-groupes distincts

const BUCKETS_SURFACE = [
  { id: 'XS', label: '<300 m²',     min: 0,    max: 300   },
  { id: 'S',  label: '300–600 m²',  min: 300,  max: 600   },
  { id: 'M',  label: '600–1200 m²', min: 600,  max: 1200  },
  { id: 'L',  label: '1200–3000 m²',min: 1200, max: 3000  },
  { id: 'XL', label: '>3000 m²',    min: 3000, max: Infinity },
];

const BUCKETS_CES = [
  { id: 'libre',  label: '<40%',   min: 0,  max: 40 },
  { id: 'moyen',  label: '40–65%', min: 40, max: 65 },
  { id: 'dense',  label: '>65%',   min: 65, max: 100 },
];

const BUCKETS_SHAPE = [
  { id: 'carre',    label: 'Carré (L/l<1.5)',      min: 1.0, max: 1.5 },
  { id: 'allonge',  label: 'Allongé (1.5–2.5)',    min: 1.5, max: 2.5 },
  { id: 'etroit',   label: 'Étroit (2.5–4)',        min: 2.5, max: 4.0 },
  { id: 'filiforme',label: 'Filiforme (>4)',         min: 4.0, max: Infinity },
];

const CorpusNormalizer = {

  // ── Calculer les comparable_filters pour un cas ──────────────────────────────
  computeFilters(cas) {
    const surface    = cas.parcelle?.surface_m2 ?? 0;
    const plu        = cas.plu ?? {};
    const topo       = cas.parcelle?.topographie ?? {};
    const parcelLoc  = cas.parcelle?.geojson_local ?? [];
    const parcelXY   = parcelLoc.map(p => ({ x: p.x, y: p.y }));

    // OBB pour shape_ratio
    const obb = parcelXY.length >= 3 ? FH.obb(parcelXY) : { w: 1, l: 1 };
    const shapeRatio = obb.l > 0 && obb.w > 0
      ? Math.max(obb.w, obb.l) / Math.min(obb.w, obb.l)
      : 1;

    const cesMax = plu.ces_max_pct ?? 60;

    return {
      bucket_surface:        this._bucket(surface, BUCKETS_SURFACE),
      bucket_pente:          topo.topo_case_id ?? 'flat',
      bucket_shape:          this._bucket(shapeRatio, BUCKETS_SHAPE),
      bucket_ces:            this._bucket(cesMax, BUCKETS_CES),
      groupe_plu:            this._normalizePLUZone(plu.zone),
      has_mitoyen:           !!(plu.mitoyen_g || plu.mitoyen_d || plu.mitoyen_lateral),
      has_slope_constraint:  ['medium','steep','extreme'].includes(topo.topo_case_id),
      hauteur_bucket:        this._hauteurBucket(plu.hauteur_faitage_max_m),
    };
  },

  // ── Grouper le corpus en groupes comparables ─────────────────────────────────
  group(corpus) {
    const groups = {};
    for (const cas of corpus) {
      if (!cas.comparable_filters) cas.comparable_filters = this.computeFilters(cas);
      const f = cas.comparable_filters;
      const key = [
        f.groupe_plu,
        f.bucket_surface,
        f.bucket_pente,
        f.has_mitoyen ? 'mit' : 'noMit',
      ].join('|');
      if (!groups[key]) groups[key] = { key, label: this._groupLabel(f, key), cases: [] };
      groups[key].cases.push(cas);
    }
    return Object.values(groups)
      .sort((a, b) => b.cases.length - a.cases.length);
  },

  // ── Filtrer les outliers (exclure les cas mal annotés ou non conformes PLU) ──
  filterOutliers(corpus, { minCES = 0.05, maxCES = 1.05, minSurface = 100 } = {}) {
    const original = corpus.length;
    const filtered = corpus.filter(cas => {
      const m  = cas.metriques_reelles;
      const p  = cas.parcelle;
      const b  = cas.bat_reel;
      const ok = [];

      // Surface minimale
      ok.push((p?.surface_m2 ?? 0) >= minSurface);
      // CES réel plausible
      ok.push(!m?.ces_reel || (m.ces_reel >= minCES && m.ces_reel <= maxCES));
      // Au moins 1 bloc réel
      ok.push((b?.blocs?.length ?? 0) > 0);
      // Statut valide
      ok.push(cas.meta?.statut !== 'exclure');
      // Parcelle locale non vide
      ok.push((cas.parcelle?.geojson_local?.length ?? 0) >= 3);

      return ok.every(Boolean);
    });

    console.info(`[CorpusNormalizer] Filtrage: ${original} → ${filtered.length} cas (${original - filtered.length} exclus)`);
    return filtered;
  },

  // ── Enrichissement : recalculer toutes les métriques manquantes ──────────────
  enrich(corpus) {
    for (const cas of corpus) {
      // comparable_filters
      if (!cas.comparable_filters) {
        cas.comparable_filters = this.computeFilters(cas);
      }
      // metriques_reelles si absentes
      if (!cas.metriques_reelles || !cas.metriques_reelles.ces_reel) {
        const parcelXY = (cas.parcelle?.geojson_local ?? []).map(p => ({ x: p.x, y: p.y }));
        const parcelArea = FH.area(parcelXY);
        const emprise = (cas.bat_reel?.blocs ?? []).reduce((s, b) => {
          const poly = (b.polygon_local ?? []).map(p => ({ x: p.x, y: p.y }));
          return s + FH.area(poly);
        }, 0);
        cas.metriques_reelles = cas.metriques_reelles ?? {};
        cas.metriques_reelles.ces_reel = parcelArea > 0 ? Math.round(emprise / parcelArea * 1000) / 1000 : null;
        cas.metriques_reelles.surface_emprise_m2 = Math.round(emprise);
      }
      // Strategy guess depuis OBB bloc vs OBB parcelle si manquante
      if (!cas.bat_reel?.strategy_guess || cas.bat_reel.strategy_guess === 'inconnu') {
        cas.bat_reel.strategy_guess = this._guessStrategyFromGeom(cas);
      }
    }
    return corpus;
  },

  // ── Filtrage pour une comparaison stricte ─────────────────────────────────────
  findComparables(ref, corpus, opts = {}) {
    const {
      strictZone  = true,
      strictPente = true,
      surfaceSlack = 1,      // ±1 bucket
      cesSlackPct  = 15,
      hauteurSlackM = 2,
    } = opts;

    const rf = ref.comparable_filters ?? this.computeFilters(ref);

    return corpus.filter(cas => {
      if (cas.id === ref.id) return false;
      const f  = cas.comparable_filters ?? this.computeFilters(cas);
      const p1 = ref.plu ?? {}, p2 = cas.plu ?? {};

      // Zone PLU
      if (strictZone && rf.groupe_plu !== f.groupe_plu) return false;
      // Pente
      if (strictPente && rf.bucket_pente !== f.bucket_pente) return false;
      // Mitoyen
      if (rf.has_mitoyen !== f.has_mitoyen) return false;
      // Surface ±1 bucket
      const SURF_IDS = BUCKETS_SURFACE.map(b => b.id);
      const i1 = SURF_IDS.indexOf(rf.bucket_surface);
      const i2 = SURF_IDS.indexOf(f.bucket_surface);
      if (Math.abs(i1 - i2) > surfaceSlack) return false;
      // CES max ±15 pts
      const ces1 = p1.ces_max_pct ?? 60, ces2 = p2.ces_max_pct ?? 60;
      if (Math.abs(ces1 - ces2) > cesSlackPct) return false;
      // Hauteur ±2m
      const h1 = p1.hauteur_faitage_max_m ?? 9, h2 = p2.hauteur_faitage_max_m ?? 9;
      if (Math.abs(h1 - h2) > hauteurSlackM) return false;

      return true;
    });
  },

  // ── Statistiques par groupe ───────────────────────────────────────────────────
  groupStats(group) {
    const cases  = group.cases;
    const n      = cases.length;
    const withE  = cases.filter(c => c.engine_results?.best_match).length;

    const ious   = cases.map(c => c.engine_results?.best_match?.iou ?? null).filter(v => v != null);
    const combis = cases.map(c => c.engine_results?.best_match?.combined_score ?? null).filter(v => v != null);
    const avg    = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

    const strats = {};
    for (const c of cases) {
      const s = c.engine_results?.best_match?.strategy ?? c.bat_reel?.strategy_guess ?? 'inconnu';
      strats[s] = (strats[s] || 0) + 1;
    }
    const dominant = Object.entries(strats).sort((a, b) => b[1] - a[1])[0]?.[0];

    return {
      key:       group.key,
      label:     group.label,
      n,
      n_with_engine: withE,
      mean_iou:      avg(ious) !== null ? Math.round(avg(ious) * 1000) / 1000 : null,
      mean_combined: avg(combis) !== null ? Math.round(avg(combis) * 1000) / 1000 : null,
      dominant_strategy: dominant,
      strategy_distribution: strats,
    };
  },

  // ── Internes ─────────────────────────────────────────────────────────────────

  _bucket(val, buckets) {
    const b = buckets.find(bk => val >= bk.min && val < bk.max);
    return b?.id ?? buckets[buckets.length - 1]?.id ?? 'unknown';
  },

  _normalizePLUZone(zone) {
    if (!zone) return 'UA';
    const z = zone.toUpperCase().trim();
    if (z.startsWith('UA')) return 'UA';
    if (z.startsWith('UB')) return 'UB';
    if (z.startsWith('UC')) return 'UC';
    if (z.startsWith('UG') || z.startsWith('UG')) return 'Ug';
    if (z.startsWith('AU')) return 'AU';
    if (z.startsWith('N'))  return 'N';
    if (z.startsWith('A'))  return 'A';
    return z.substring(0, 2);
  },

  _hauteurBucket(h) {
    if (!h) return 'standard_9m';
    if (h <= 7)  return 'bas_<=7m';
    if (h <= 10) return 'standard_9m';
    if (h <= 15) return 'moyen_12m';
    return 'eleve_>15m';
  },

  _groupLabel(f, key) {
    const surf = BUCKETS_SURFACE.find(b => b.id === f.bucket_surface?.split('_')[0])?.label ?? f.bucket_surface;
    return `Zone ${f.groupe_plu} · ${surf} · ${f.bucket_pente} · ${f.has_mitoyen ? 'mitoyen' : 'recul std'}`;
  },

  _guessStrategyFromGeom(cas) {
    const blocs = cas.bat_reel?.blocs ?? [];
    if (!blocs.length) return 'inconnu';
    if (blocs.length >= 3) return 'multi';
    const parcelXY = (cas.parcelle?.geojson_local ?? []).map(p => ({ x: p.x, y: p.y }));
    const mainBloc = blocs[0];
    const bPoly = (mainBloc.polygon_local ?? []).map(p => ({ x: p.x, y: p.y }));
    if (!parcelXY.length || !bPoly.length) return 'inconnu';

    // Comparer theta OBB bâtiment vs theta OBB parcelle
    const obbParcel = FH.obb(parcelXY);
    const obbBat    = FH.obb(bPoly);
    const tP = obbParcel.theta * 180 / Math.PI;
    const tB = obbBat.theta    * 180 / Math.PI;
    let delta = Math.abs(tP - tB) % 180;
    if (delta > 90) delta = 180 - delta;

    if (delta < 15) return 'rect';                 // aligné sur OBB parcelle
    if (delta >= 30 && delta <= 60) return 'alize'; // ~45°
    if (blocs.length === 2) return 'lshape';
    return 'oblique';
  },

  // ── Buckets publics (pour le viewer) ────────────────────────────────────────
  BUCKETS_SURFACE,
  BUCKETS_CES,
  BUCKETS_SHAPE,
};

export default CorpusNormalizer;
