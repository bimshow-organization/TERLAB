// TERLAB · services/corpus-runner.js
// Lance AutoPlanEngine sur chaque cas du corpus, stocke les scores de conformité
// Sert à calibrer les stratégies et valider le modèle engine
// ENSA La Réunion · MGA Architecture 2026
// Vanilla JS ES2022+ — dépend de AutoPlanEngine, ConformityScorer, Firebase RTDB

import ConformityScorer from './conformity-scorer.js';

// Chemin Firebase où stocker le corpus
const FB_PATH_CORPUS  = 'terlab/corpus/cases';
const FB_PATH_STATS   = 'terlab/corpus/stats';
const ENGINE_VERSION  = '2.0.0';

const CorpusRunner = {

  // ── Construire une session minimale depuis un cas corpus ─────────────────────
  _buildSession(cas) {
    const plu = cas.plu || {};
    return {
      terrain: {
        parcelle_geojson:   cas.parcelle?.geojson_wgs84 || null,
        pente_moy_pct:      cas.parcelle?.topographie?.pente_moy_pct ?? 0,
        azimut_pente_deg:   cas.parcelle?.topographie?.azimut_pente_deg ?? 0,
        altitude_ngr:       cas.parcelle?.topographie?.altitude_ngr_m ?? 0,
        bearing_voie_deg:   cas.parcelle?.bearing_voie_deg ?? 0,
        zone_plu:           plu.zone ?? 'UA',
        rtaaZone:           plu.rtaa_zone ?? 1,
      },
      phases: {
        4: {
          data: {
            zone_plu:                 plu.zone ?? 'UA',
            recul_voie_principale_m:  plu.recul_voie_m ?? 3,
            recul_fond_m:             plu.recul_fond_m ?? 3,
            recul_limite_sep_m:       plu.recul_lat_m  ?? 3,
            hauteur_egout_m:          plu.hauteur_egout_max_m  ?? 9,
            hauteur_faitage_m:        plu.hauteur_faitage_max_m ?? 11,
            emprise_sol_max_pct:      plu.ces_max_pct ?? 60,
            niveaux_max:              (cas.bat_reel?.niveaux ?? 3) + 1,
            rtaaZone:                 plu.rtaa_zone ?? 1,
          },
        },
        7: {
          data: {
            mitoyen_g:   plu.mitoyen_g ?? false,
            mitoyen_d:   plu.mitoyen_d ?? false,
            inlets:      [],
          },
        },
      },
    };
  },

  // ── Construire un prog depuis un cas corpus ──────────────────────────────────
  _buildProg(cas) {
    const bat = cas.bat_reel;
    const typeMap = {
      maison_individuelle: 'maison',
      bande:               'bande',
      collectif_petit:     'collectif',
      collectif_moyen:     'collectif',
      collectif_grand:     'collectif',
      mixte:               'collectif',
    };
    return {
      type:     typeMap[bat?.type_programme] ?? 'collectif',
      nvMax:    (bat?.niveaux ?? 2) + 1,   // +1 marge exploration
      profMax:  15,
      parkMode: 'ext',
      parkSS:   bat?.parking_ss ?? false,
    };
  },

  // ── Runner d'un cas unique ────────────────────────────────────────────────────
  async runCase(cas, { onProgress } = {}) {
    const TA = window.TerrainP07Adapter;
    const APE = window.AutoPlanEngine;
    if (!TA || !APE) throw new Error('TerrainP07Adapter ou AutoPlanEngine non disponible');

    const parcelXY = cas.parcelle?.geojson_local?.map(p => ({ x: p.x, y: p.y })) ?? [];
    if (parcelXY.length < 3) throw new Error(`Parcelle invalide (${parcelXY.length} pts)`);

    const session = this._buildSession(cas);
    const prog    = this._buildProg(cas);

    onProgress?.({ status: 'engine_run', id: cas.id });

    // Adapter pour TerrainP07Adapter : passer la géométrie locale directement
    // AutoPlanEngine utilise session.terrain.parcelle_geojson; si absent on passe parcelXY
    const bearing = cas.parcelle?.bearing_voie_deg ?? 0;
    let adapted;
    try {
      adapted = parcelXY.length >= 3
        ? { valid: true, poly: parcelXY, area: window.FH?.area(parcelXY) ?? 0 }
        : TA.process(session.terrain.parcelle_geojson, { bearing });
    } catch (e) {
      adapted = { valid: false, errors: [e.message] };
    }
    if (!adapted.valid) throw new Error('Adaptation géométrie échouée');

    // Edge types depuis le cas ou inférence
    const edgeTypes = cas.parcelle?.edge_types ?? TA.inferEdgeTypes(parcelXY, session);

    // Génération Pareto
    const solutions = await APE.generate(session, prog);

    // Scoring conformité
    onProgress?.({ status: 'scoring', id: cas.id, n_sol: solutions.length });
    const scored = ConformityScorer.scoreAll(solutions, cas.bat_reel, parcelXY);
    const best   = ConformityScorer.bestMatch(scored);

    const result = {
      timestamp:       new Date().toISOString(),
      engine_version:  ENGINE_VERSION,
      solutions:       scored.map(s => ({
        family:    s.family ?? s.familyKey ?? '?',
        label:     s.label ?? '?',
        strategy:  s.blocs?.[0]?.strategy ?? s.strategy ?? '?',
        score:     s.score,
        niveaux:   s.niveaux,
        surface:   s.surface,
        conformity: s.conformity,
      })),
      best_match:  best,
      n_solutions: solutions.length,
    };

    return result;
  },

  // ── Runner batch sur tout le corpus ──────────────────────────────────────────
  async runCorpus(cases, {
    onProgress, onError,
    saveToFirebase = true,
    delayMs = 500,
    filterStatut = ['valide', 'a_verifier'],
  } = {}) {
    const eligible = cases.filter(c => filterStatut.includes(c.meta?.statut));
    const results  = [];

    for (let i = 0; i < eligible.length; i++) {
      const cas = eligible[i];
      onProgress?.({ i, total: eligible.length, id: cas.id, status: 'start' });
      try {
        const engineResults = await this.runCase(cas, {
          onProgress: d => onProgress?.({ ...d, i, total: eligible.length }),
        });
        cas.engine_results = engineResults;
        results.push({ ok: true, id: cas.id, best: engineResults.best_match });
        onProgress?.({ i, total: eligible.length, id: cas.id, status: 'done',
          combined_score: engineResults.best_match?.combined_score });

        if (saveToFirebase) {
          await this._saveToFirebase(cas);
        }
      } catch (err) {
        onError?.({ i, id: cas.id, err });
        results.push({ ok: false, id: cas.id, err: err.message });
      }
      if (i < eligible.length - 1 && delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    // Statistiques globales
    const stats = ConformityScorer.analyzeCorpus(eligible);
    if (saveToFirebase) await this._saveStatsToFirebase(stats);

    return { results, stats };
  },

  // ── Firebase : sauvegarde un cas mis à jour ───────────────────────────────────
  async _saveToFirebase(cas) {
    const db = window.firebaseDb ?? window.TERLAB?.db;
    if (!db) { console.warn('[CorpusRunner] Firebase non disponible'); return; }
    try {
      const ref = db.ref(`${FB_PATH_CORPUS}/${cas.id}`);
      await ref.set(cas);
    } catch (e) {
      console.error('[CorpusRunner] Erreur Firebase:', e);
    }
  },

  async _saveStatsToFirebase(stats) {
    const db = window.firebaseDb ?? window.TERLAB?.db;
    if (!db) return;
    try {
      await db.ref(FB_PATH_STATS).set({ ...stats, updated_at: new Date().toISOString() });
    } catch (e) {
      console.error('[CorpusRunner] Stats Firebase:', e);
    }
  },

  // ── Chargement du corpus depuis Firebase ────────────────────────────────────
  async loadFromFirebase(filterFn = null) {
    const db = window.firebaseDb ?? window.TERLAB?.db;
    if (!db) throw new Error('Firebase non disponible');
    const snap = await db.ref(FB_PATH_CORPUS).once('value');
    const raw  = snap.val() ?? {};
    const cases = Object.values(raw);
    return filterFn ? cases.filter(filterFn) : cases;
  },

  async loadStats() {
    const db = window.firebaseDb ?? window.TERLAB?.db;
    if (!db) return null;
    const snap = await db.ref(FB_PATH_STATS).once('value');
    return snap.val();
  },

  // ── Export CSV des résultats pour analyse externe ───────────────────────────
  exportCSV(cases) {
    const header = [
      'id','commune','annee','zone_plu','surface_m2','shape_ratio','pente_case',
      'ces_max','ces_reel','bat_type','bat_niveaux','bat_strategy_guess',
      'engine_best_strategy','engine_best_iou','engine_best_combined','engine_n_sol',
    ].join(',');

    const rows = cases.map(c => [
      c.id,
      c.meta?.commune ?? '',
      c.meta?.annee_construction ?? '',
      c.plu?.zone ?? '',
      c.parcelle?.surface_m2 ?? '',
      c.parcelle?.shape_ratio ?? '',
      c.parcelle?.topographie?.topo_case_id ?? '',
      c.plu?.ces_max_pct ?? '',
      c.metriques_reelles?.ces_reel ?? '',
      c.bat_reel?.type_programme ?? '',
      c.bat_reel?.niveaux ?? '',
      c.bat_reel?.strategy_guess ?? '',
      c.engine_results?.best_match?.strategy ?? '',
      c.engine_results?.best_match?.iou ?? '',
      c.engine_results?.best_match?.combined_score ?? '',
      c.engine_results?.n_solutions ?? '',
    ].join(','));

    return [header, ...rows].join('\n');
  },

  // ── Rapport Markdown du corpus ──────────────────────────────────────────────
  reportMarkdown(stats, cases) {
    const n = cases.length;
    const withEngine = cases.filter(c => c.engine_results?.best_match).length;
    const pctGood = stats.iou_buckets
      ? Math.round((stats.iou_buckets.excellent + stats.iou_buckets.bon) / Math.max(1, withEngine) * 100)
      : '?';

    const stratWins = Object.entries(stats.strategy_wins ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([s, n2]) => `| ${s} | ${n2} | ${Math.round(n2 / withEngine * 100)}% |`)
      .join('\n');

    return `# TERLAB Corpus — Rapport de Calibration
**${new Date().toLocaleDateString('fr-FR')} · ${n} cas · ${withEngine} évalués**

## Métriques globales
| Métrique | Valeur |
|---|---|
| IoU moyen | ${stats.mean_iou ?? '?'} |
| Score composite moyen | ${stats.mean_combined ?? '?'} |
| Delta CES moyen | ${stats.mean_ces_delta ?? '?'} |
| Cas bien modélisés (IoU≥0.5) | ${pctGood}% |

## Distribution IoU
- ✅ Excellent (≥0.7) : ${stats.iou_buckets?.excellent ?? '?'} cas
- ✅ Bon (0.5–0.7) : ${stats.iou_buckets?.bon ?? '?'} cas
- ⚠️ Moyen (0.3–0.5) : ${stats.iou_buckets?.moyen ?? '?'} cas
- ❌ Faible (<0.3) : ${stats.iou_buckets?.faible ?? '?'} cas

## Stratégies gagnantes
| Stratégie | Cas | % |
|---|---|---|
${stratWins}

## Stratégie dominante : **${stats.dominant_strategy ?? '?'}**
`;
  },
};

export default CorpusRunner;
