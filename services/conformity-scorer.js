// TERLAB · services/conformity-scorer.js
// Score de conformité : solution AutoPlanEngine vs bâtiment réel
// ENSA La Réunion · MGA Architecture 2026
// Métriques : IoU, orientation, CES, dimensions, position
// Vanilla JS ES2022+ · Aucune dépendance externe

import FH from './footprint-helpers.js';

// Poids du score composite (somme = 1.0)
const WEIGHTS = {
  iou:          0.40,   // recouvrement géométrique — plus important
  orientation:  0.20,   // alignement angulaire
  ces:          0.15,   // emprise au sol relative
  profondeur:   0.12,   // profondeur bâtiment
  largeur:      0.08,   // largeur bâtiment
  position_y:   0.05,   // position longitudinale (voie→fond)
};

const ConformityScorer = {

  // ── Score principal : une solution vs le bâtiment réel ──────────────────────
  //
  // sol     : { blocs: [{polygon, theta, w, l}], surface, niveaux, ... }
  //           OU { polygon: [...], theta, w, l }   (un seul bloc)
  // realBat : { blocs: [{polygon_local, obb_theta_deg, ...}], ... }
  // parcelXY: [{x,y}] local mètres
  //
  score(sol, realBat, parcelXY) {
    const solBlocs  = this._normalizeSolBlocs(sol);
    const realBlocs = this._normalizeRealBlocs(realBat);
    if (!solBlocs.length || !realBlocs.length) {
      return { combined_score: 0, iou: 0, delta_orientation_deg: 180, delta_ces: 1, error: 'empty_blocs' };
    }

    // 1. IoU multi-blocs : meilleure correspondance entre tous les blocs sol et réels
    const { iou, iou_any, iou_global } = this._iouMultiBloc(solBlocs, realBlocs, parcelXY);

    // 2. Orientation — min différence angulaire (mod 90° pour symétrie rectangle)
    const deltaOrient = this._deltaOrientation(solBlocs, realBlocs);

    // 3. CES — FH.totalArea attend des objets {polygon}, pas des polygones bruts
    const solArea   = FH.totalArea(solBlocs);
    const realArea  = FH.totalArea(realBlocs);
    const parcelArea = FH.area(parcelXY);
    const cesSol    = parcelArea > 0 ? solArea  / parcelArea : 0;
    const cesReal   = parcelArea > 0 ? realArea / parcelArea : 0;
    const deltaCES  = Math.abs(cesSol - cesReal);

    // 4. Dimensions du bloc principal
    const mainSol  = solBlocs.sort((a, b) => FH.area(b.polygon) - FH.area(a.polygon))[0];
    const mainReal = realBlocs.sort((a, b) => FH.area(b.polygon) - FH.area(a.polygon))[0];
    const solDims  = this._dims(mainSol);
    const realDims = this._dims(mainReal);
    const deltaProfM  = Math.abs(solDims.profondeur - realDims.profondeur);
    const deltaLargM  = Math.abs(solDims.largeur    - realDims.largeur);

    // 5. Position Y (distance voie→fond relative)
    const deltaPosY = this._deltaPositionY(mainSol, mainReal, parcelXY);

    // 6. Scores individuels 0→1
    const s_iou     = iou;
    const s_orient  = Math.max(0, 1 - deltaOrient / 45);   // 45° → score 0
    const s_ces     = Math.max(0, 1 - deltaCES   / 0.25);  // 0.25 → score 0
    const s_prof    = Math.max(0, 1 - deltaProfM / 8);     // 8m → score 0
    const s_larg    = Math.max(0, 1 - deltaLargM / 8);
    const s_posy    = Math.max(0, 1 - deltaPosY  / 0.3);   // 30% de profondeur → score 0

    // 7. Score composite pondéré
    const combined = (
      s_iou     * WEIGHTS.iou         +
      s_orient  * WEIGHTS.orientation +
      s_ces     * WEIGHTS.ces         +
      s_prof    * WEIGHTS.profondeur  +
      s_larg    * WEIGHTS.largeur     +
      s_posy    * WEIGHTS.position_y
    );

    return {
      combined_score:       Math.round(combined * 1000) / 1000,
      iou,
      iou_any,
      iou_global,
      delta_orientation_deg: Math.round(deltaOrient * 10) / 10,
      delta_ces:            Math.round(deltaCES * 1000) / 1000,
      delta_profondeur_m:   Math.round(deltaProfM * 10) / 10,
      delta_largeur_m:      Math.round(deltaLargM * 10) / 10,
      delta_position_y:     Math.round(deltaPosY * 100) / 100,
      sub_scores: { s_iou, s_orient, s_ces, s_prof, s_larg, s_posy },
      sol_dims:  solDims,
      real_dims: realDims,
      n_blocs_sol:  solBlocs.length,
      n_blocs_real: realBlocs.length,
    };
  },

  // ── Scorer toutes les variantes Pareto d'un cas ───────────────────────────
  scoreAll(engineSolutions, realBat, parcelXY) {
    return engineSolutions
      .map(sol => ({ ...sol, conformity: this.score(sol, realBat, parcelXY) }))
      .sort((a, b) => b.conformity.combined_score - a.conformity.combined_score);
  },

  // ── Résumé du best match ─────────────────────────────────────────────────────
  bestMatch(scoredSolutions) {
    if (!scoredSolutions?.length) return null;
    const best = scoredSolutions[0];
    return {
      family:          best.family ?? best.familyKey ?? '?',
      strategy:        best.strategy ?? best.blocs?.[0]?.strategy ?? '?',
      combined_score:  best.conformity.combined_score,
      iou:             best.conformity.iou,
      label:           best.label ?? '?',
    };
  },

  // ── Analyse corpus : distribution des stratégies gagnantes ──────────────────
  analyzeCorpus(cases) {
    // cases = [{id, engine_results: {solutions: [scored]}, bat_reel, ...}]
    const stats = {
      n_total:        cases.length,
      n_avec_engine:  0,
      strategy_wins:  {},     // { rect: 12, oblique: 8, ... }
      avg_iou:        [],
      avg_combined:   [],
      iou_buckets:    { excellent: 0, bon: 0, moyen: 0, faible: 0 },
      correlations:   {
        pente_vs_strategy:  {},
        shape_ratio_vs_iou: [],
        ces_delta:          [],
      },
    };

    for (const cas of cases) {
      const sols = cas.engine_results?.solutions;
      if (!sols?.length) continue;
      stats.n_avec_engine++;

      const best = sols[0];   // supposés triés par conformity.combined_score
      const conform = best?.conformity;
      if (!conform) continue;

      // Stratégie gagnante
      const strat = best.strategy || 'inconnu';
      stats.strategy_wins[strat] = (stats.strategy_wins[strat] || 0) + 1;

      // IoU
      stats.avg_iou.push(conform.iou);
      stats.avg_combined.push(conform.combined_score);

      // Bucket IoU
      if (conform.iou >= 0.7) stats.iou_buckets.excellent++;
      else if (conform.iou >= 0.5) stats.iou_buckets.bon++;
      else if (conform.iou >= 0.3) stats.iou_buckets.moyen++;
      else stats.iou_buckets.faible++;

      // Corrélations
      const pente = cas.parcelle?.topographie?.topo_case_id || 'flat';
      if (!stats.correlations.pente_vs_strategy[pente]) stats.correlations.pente_vs_strategy[pente] = {};
      const pw = stats.correlations.pente_vs_strategy[pente];
      pw[strat] = (pw[strat] || 0) + 1;

      stats.correlations.shape_ratio_vs_iou.push({
        shape_ratio: cas.parcelle?.shape_ratio,
        iou: conform.iou,
        strategy: strat,
      });

      stats.correlations.ces_delta.push(conform.delta_ces);
    }

    // Moyennes
    const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
    stats.mean_iou      = Math.round(avg(stats.avg_iou) * 1000) / 1000;
    stats.mean_combined = Math.round(avg(stats.avg_combined) * 1000) / 1000;
    stats.mean_ces_delta = Math.round(avg(stats.correlations.ces_delta) * 1000) / 1000;

    // Stratégie dominante globale
    stats.dominant_strategy = Object.entries(stats.strategy_wins)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || '?';

    return stats;
  },

  // ── Filtrage comparabilité : ne comparer que les cas similaires ─────────────
  //
  // Pour un cas de référence, trouver les cas corpus comparables selon :
  //   - zone PLU identique
  //   - bucket surface proche (±1 bucket)
  //   - bucket pente identique
  //   - même présence mitoyen
  //
  findComparables(refCase, corpus, { strict = false } = {}) {
    return corpus.filter(cas => {
      if (cas.id === refCase.id) return false;
      const f1 = refCase.comparable_filters;
      const f2 = cas.comparable_filters;
      if (!f1 || !f2) return false;

      // Zone PLU : obligatoire
      if (f1.groupe_plu !== f2.groupe_plu) return false;

      // Pente : obligatoire
      if (f1.bucket_pente !== f2.bucket_pente) return false;

      if (strict) {
        // Surface identique ± 0 bucket
        if (f1.bucket_surface !== f2.bucket_surface) return false;
        // Shape ratio proche
        if (f1.bucket_shape !== f2.bucket_shape) return false;
        // CES max similaire
        const ces1 = refCase.plu?.ces_max_pct || 60;
        const ces2 = cas.plu?.ces_max_pct || 60;
        if (Math.abs(ces1 - ces2) > 15) return false;
      } else {
        // Surface ±1 bucket
        const BUCKETS = ['XS_<300','S_300-600','M_600-1200','L_1200-3000','XL_>3000'];
        const i1 = BUCKETS.indexOf(f1.bucket_surface);
        const i2 = BUCKETS.indexOf(f2.bucket_surface);
        if (Math.abs(i1 - i2) > 1) return false;
      }

      return true;
    });
  },

  // ── Calibration des poids depuis un corpus annoté ───────────────────────────
  // Retourne les poids optimisés pour maximiser la corrélation
  // avec la stratégie devinée manuellement (strategy_guess)
  calibrateWeights(corpus) {
    // Simple search : évaluer si le best match correspond à strategy_guess
    const annotated = corpus.filter(c =>
      c.bat_reel?.strategy_guess && c.bat_reel.strategy_guess !== 'inconnu' &&
      c.engine_results?.solutions?.length
    );
    if (annotated.length < 5) return { error: 'Trop peu de cas annotés (min 5)' };

    const currentAccuracy = annotated.reduce((n, cas) => {
      const best = cas.engine_results.solutions[0];
      return n + (best?.strategy === cas.bat_reel.strategy_guess ? 1 : 0);
    }, 0) / annotated.length;

    return {
      n_annotated:       annotated.length,
      current_accuracy:  Math.round(currentAccuracy * 100) + '%',
      current_weights:   WEIGHTS,
      note:              'Calibration avancée : implémenter gradient descent sur WEIGHTS',
    };
  },

  // ── Internes ─────────────────────────────────────────────────────────────────

  _normalizeSolBlocs(sol) {
    if (!sol) return [];
    // AutoPlanEngine retourne soit sol.blocs soit sol.polygon (rétrocompat)
    if (sol.blocs?.length) {
      return sol.blocs
        .filter(b => b.polygon?.length >= 3)
        .map(b => ({ polygon: b.polygon.map(p => FH.toXY(p)), theta: b.theta ?? 0 }));
    }
    if (sol.polygon?.length >= 3) {
      return [{ polygon: sol.polygon.map(p => FH.toXY(p)), theta: sol.theta ?? 0 }];
    }
    return [];
  },

  _normalizeRealBlocs(realBat) {
    if (!realBat?.blocs?.length) return [];
    return realBat.blocs
      .filter(b => b.polygon_local?.length >= 3)
      .map(b => ({
        polygon: b.polygon_local.map(p => FH.toXY(p)),
        theta:   b.obb_theta_deg != null ? b.obb_theta_deg * Math.PI / 180 : 0,
      }));
  },

  _iouMultiBloc(solBlocs, realBlocs, parcelXY) {
    // IoU global : union totale des blocs sol vs union totale des blocs réels
    // Approx via grille raster (résolution 0.5m)
    const allPts = [...solBlocs.flatMap(b => b.polygon), ...realBlocs.flatMap(b => b.polygon)];
    const xs = allPts.map(p => p.x), ys = allPts.map(p => p.y);
    const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1;
    const y0 = Math.min(...ys) - 1, y1 = Math.max(...ys) + 1;
    const res = 0.5;
    const W = Math.ceil((x1 - x0) / res), H = Math.ceil((y1 - y0) / res);
    let inter = 0, union = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const p = { x: x0 + (i + 0.5) * res, y: y0 + (j + 0.5) * res };
      const inSol  = solBlocs.some(b => FH.pointInPoly(p.x, p.y, b.polygon));
      const inReal = realBlocs.some(b => FH.pointInPoly(p.x, p.y, b.polygon));
      if (inSol && inReal) inter++;
      if (inSol || inReal) union++;
    }
    const iou_global = union > 0 ? inter / union : 0;

    // IoU any : best pair matching sol_i ↔ real_j
    let iou_any = 0;
    for (const sb of solBlocs) {
      for (const rb of realBlocs) {
        const pairIoU = this._iouPair(sb.polygon, rb.polygon, res);
        if (pairIoU > iou_any) iou_any = pairIoU;
      }
    }

    return {
      iou:       iou_global,
      iou_any,
      iou_global,
    };
  },

  _iouPair(polyA, polyB, res = 0.5) {
    const allPts = [...polyA, ...polyB];
    const xs = allPts.map(p => p.x), ys = allPts.map(p => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const W = Math.max(1, Math.ceil((x1 - x0) / res));
    const H = Math.max(1, Math.ceil((y1 - y0) / res));
    let inter = 0, union = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const p = { x: x0 + (i + 0.5) * res, y: y0 + (j + 0.5) * res };
      const inA = FH.pointInPoly(p.x, p.y, polyA);
      const inB = FH.pointInPoly(p.x, p.y, polyB);
      if (inA && inB) inter++;
      if (inA || inB) union++;
    }
    return union > 0 ? inter / union : 0;
  },

  _deltaOrientation(solBlocs, realBlocs) {
    const thetaSol  = solBlocs[0].theta  * 180 / Math.PI;
    const thetaReal = realBlocs[0].theta * 180 / Math.PI;
    // Symétrie rectangulaire : équivalence modulo 90°
    let delta = Math.abs(thetaSol - thetaReal) % 180;
    if (delta > 90) delta = 180 - delta;
    return delta;
  },

  _dims(bloc) {
    if (!bloc?.polygon?.length) return { profondeur: 0, largeur: 0 };
    const obb = FH.obb(bloc.polygon);
    return {
      profondeur: Math.max(obb.w, obb.l),
      largeur:    Math.min(obb.w, obb.l),
    };
  },

  _deltaPositionY(mainSol, mainReal, parcelXY) {
    if (!mainSol?.polygon || !mainReal?.polygon || !parcelXY?.length) return 0;
    const parcelYs = parcelXY.map(p => p.y);
    const parcelH  = Math.max(...parcelYs) - Math.min(...parcelYs);
    if (parcelH < 1) return 0;
    // Centre Y de chaque bloc normalisé sur la profondeur parcelle
    const ySol  = mainSol.polygon.reduce((s, p) => s + p.y, 0) / mainSol.polygon.length;
    const yReal = mainReal.polygon.reduce((s, p) => s + p.y, 0) / mainReal.polygon.length;
    return Math.abs(ySol - yReal) / parcelH;
  },
};

export default ConformityScorer;
