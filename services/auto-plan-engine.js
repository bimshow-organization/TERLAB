// terlab/services/auto-plan-engine.js · Placement automatique Pareto A1-C2 · v1.2
// ENSA La Réunion · MGA Architecture 2026
// Vanilla JS ES2022+, aucune dépendance externe
// Génère 4-6 variantes Pareto pour étude de capacité constructible
// v1.1 : intégration SdisChecker après chaque solution Pareto
// v1.2 : intégration TopoCaseService — profMax et parkMode contraints par pente

import TopoCaseService from './topo-case-service.js';

const H_NIV  = 3.0;   // hauteur par niveau (m)
const SP_MOY = 0.175 * 31 + 0.275 * 49 + 0.325 * 68 + 0.225 * 87; // ≈ 60.58 m²

const AutoPlanEngine = {

  /**
   * Génère des solutions auto-plan depuis la session
   * @param {Object} session    — SessionManager.getSession()
   * @param {Object} prog       — { type, nvMax, profMax, parkMode, parkSS, maxUnits }
   * @param {Object} [existing] — résultat ExistingBuildings.analyse()
   * @returns {Promise<Solution[]>}
   */
  async generate(session, prog, existing = null) {
    const TA = window.TerrainP07Adapter;
    if (!TA) { console.warn('[AutoPlan] TerrainP07Adapter non disponible'); return []; }

    // 0. Contraintes topographiques
    const topoConstraints = TopoCaseService.getProgConstraints(
      session?.terrain?.pente_moy_pct, prog
    );
    const progTopo = {
      ...prog,
      profMax:  topoConstraints.profMax,
      parkMode: topoConstraints.parkMode,
      parkSS:   topoConstraints.parkSS,
      _topoConstraints: topoConstraints,
    };

    // 1. Géométrie parcelle
    const geojson = session?.terrain?.parcelle_geojson ?? session?.geojson;
    if (!geojson) { console.warn('[AutoPlan] Pas de GeoJSON parcelle'); return []; }

    const bearingSession = parseFloat(session?.terrain?.bearing_voie_deg ?? 0);
    const adapted = TA.process(geojson, { bearing: bearingSession });
    if (!adapted.valid) {
      console.warn('[AutoPlan] Parcelle invalide :', adapted.errors);
      return [];
    }

    const poly = adapted.poly;
    const area = adapted.area;
    const edgeTypes = TA.inferEdgeTypes(poly, session);

    // 2. PLU depuis session
    const plu = this._loadPLU(session);

    // 3. Zone N/A → early exit
    const zone = plu.zone;
    if (zone === 'N' || zone === 'A') {
      console.warn(`[AutoPlan] Zone ${zone} — non constructible`);
      return [{
        family: 'X0', familyKey: 'non_constructible',
        message: `Zone ${zone} — aucune construction possible`,
        polygon: [], bat: null, metrics: null, score: 0,
      }];
    }

    // 4. PPRN → ajuster empMax
    const pprn = session?.phases?.[3]?.data?.zone_pprn;
    if (pprn === 'rouge') {
      console.warn('[AutoPlan] PPRN rouge — emprise 0');
      return [{
        family: 'X0', familyKey: 'pprn_rouge',
        message: 'PPRN rouge — construction interdite',
        polygon: [], bat: null, metrics: null, score: 0,
      }];
    }
    if (pprn === 'orange') {
      plu.emprMax = Math.min(plu.emprMax, 20);
    }

    // 5. Inset adaptatif
    const reculsTyped = {
      voie: plu.recul_voie,
      lat:  plu.recul_lat,
      fond: plu.recul_fond,
    };
    const insetResult = TA.adaptiveInset(poly, reculsTyped, edgeTypes);
    if (insetResult.collapsed) {
      console.warn('[AutoPlan] Enveloppe effondrée même après adaptation');
      return [];
    }
    const env = insetResult.env;

    // 6. Bearing
    const bearing = this._resolveBearing(session, poly, edgeTypes);

    // 7. Mode bâtiments existants
    const envEff = existing
      ? this._applyExistingMode(env, existing, existing.mode ?? 'demolition')
      : env;

    // 8. PIR sur zone effective
    const [px, py] = TA.poleOfInaccessibility(envEff, 1.5);

    // 9. Générer variantes Pareto (prog surchargé par contraintes topo)
    const solutions = this._generatePareto(envEff, progTopo, plu, bearing, px, py, area, existing);

    // 10. Attacher les vérifications SDIS à chaque solution
    const Sdis = window.SdisChecker;
    if (Sdis) {
      for (const sol of solutions) {
        const sMetrics = {
          nvEff: sol.niveaux,
          type:  progTopo.type ?? 'collectif',
          nbLgts: sol.nLgts,
          emprise: sol.surface,
          nbBlocs: sol.nbBlocs ?? 1,
          gapMin:  sol.gapMin ?? null,
        };
        const distFacadeVoie = this._computeDistFacadeVoie(sol, edgeTypes, poly);
        sol.sdis = Sdis.run(session, sMetrics, {
          distFacadeVoie,
          distInterBat: sMetrics.nbBlocs > 1 ? sMetrics.gapMin : null,
          facadeLong:   sol.bat?.w ?? null,
        });
      }
    }

    // 11. Injecter le cas topo dans chaque solution
    for (const sol of solutions) {
      sol.topoCase = topoConstraints.topoCase;
      sol.topoConstraints = topoConstraints;
    }

    // 12. Trier par score Pareto
    solutions.sort((a, b) => b.score - a.score);

    return solutions;
  },

  /**
   * Calcule la distance entre la façade voie du bâtiment et l'arête voie
   * @returns {number|null} distance en mètres
   */
  _computeDistFacadeVoie(solution, edgeTypes, poly) {
    const TA = window.TerrainP07Adapter;
    if (!TA || !solution.bat || !edgeTypes?.length || !poly?.length) return null;

    const voieIdx = edgeTypes.indexOf('voie');
    if (voieIdx < 0) return null;

    const n = poly.length;
    const p1 = poly[voieIdx];
    const p2 = poly[(voieIdx + 1) % n];

    // Centre de la face voie du bâtiment (côté sud = y min)
    const bat = solution.bat;
    const bx = bat.x + bat.w / 2;
    const by = bat.y; // face voie = côté bas (y min après rotation)

    return TA.distPtSeg(bx, by, p1[0], p1[1], p2[0], p2[1]);
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Méthodes internes
  // ═══════════════════════════════════════════════════════════════════════════

  /** Charge les règles PLU depuis la session + TERLAB_PLU_CONFIG */
  _loadPLU(session) {
    const p4      = session?.phases?.[4]?.data ?? {};
    const terrain = session?.terrain ?? {};
    const pluCfg  = session?.pluConfig ?? {};
    const realPlu = (typeof window !== 'undefined' ? window.TERLAB_PLU_CONFIG?.plu : null) ?? {};

    let heMax = parseFloat(realPlu.heMax ?? p4.hauteur_max_m ?? p4.hauteur_egout_m ?? 9) || 9;

    // Bonification hauteur logement social (+50% si programme aidé)
    const prog = session?.phases?.[7]?.data?.programme ?? session?.programme;
    if (realPlu.bonus_logement_social && (prog === 'social' || prog === 'aide')) {
      heMax = heMax * 1.5;
      console.info('[AutoPlan] Bonification logement social : heMax ×1.5 →', heMax, 'm');
    }

    // Cap absolu PLU (certaines zones ont un max absolu toutes toitures confondues)
    if (realPlu.hauteur_absolue_max_m) {
      heMax = Math.min(heMax, realPlu.hauteur_absolue_max_m);
    }

    // Alignement voie → recul voie = 0
    let reculVoie = parseFloat(p4.recul_voie_principale_m ?? p4.recul_voie_m ?? p4.recul_avant_m ?? 3) || 3;
    if (realPlu.voie_alignement === true) {
      reculVoie = 0;
    }

    return {
      zone:        p4.zone_plu ?? pluCfg?.meta?.zone ?? terrain.zone_plu ?? 'U',
      recul_voie:  reculVoie,
      recul_fond:  parseFloat(p4.recul_fond_m ?? 3) || 3,
      recul_lat:   parseFloat(p4.recul_limite_sep_m ?? p4.recul_lat_m ?? 0) || 0,
      heMax,
      emprMax:     this._parseEmprMax(p4, pluCfg),
      permMin:     parseFloat(realPlu.permMin ?? pluCfg?.plu?.permMin ?? p4.permeabilite_min_pct ?? 25),
      rtaaZone:    parseInt(p4.rtaaZone ?? realPlu.rtaaZone ?? 1),
      // COS — limite SP totale
      cos:         realPlu.cos ?? null,
      // Limite longueur en limite séparative
      sep_lat_longueur_max_m: realPlu.sep_lat_longueur_max_m ?? null,
    };
  },

  _parseEmprMax(p4, pluCfg) {
    let v = parseFloat(p4.emprise_sol_max_pct ?? p4.ces_max ?? pluCfg?.plu?.emprMax ?? 60);
    if (v > 0 && v <= 1) v *= 100;
    return v;
  },

  /**
   * Résout le bearing du bâtiment :
   * 1. session.terrain.bearing_voie_deg si présent
   * 2. Bearing de l'arête 'voie' détectée
   * 3. PCA du polygone
   */
  _resolveBearing(session, poly, edgeTypes) {
    const TA = window.TerrainP07Adapter;

    // 1. Session
    const sb = parseFloat(session?.terrain?.bearing_voie_deg);
    if (!isNaN(sb) && sb !== 0) return sb;

    // 2. Arête voie
    const voieIdx = edgeTypes.indexOf('voie');
    if (voieIdx >= 0 && poly.length > voieIdx + 1) {
      const [x1, y1] = poly[voieIdx];
      const [x2, y2] = poly[(voieIdx + 1) % poly.length];
      const angle = Math.atan2(x2 - x1, y2 - y1) * 180 / Math.PI;
      return (angle + 360) % 360;
    }

    // 3. PCA
    return TA?.inferBearingFromPCA(poly) ?? 0;
  },

  /**
   * Mode bâtiments existants :
   * 'demolition'   → enveloppe complète
   * 'conservation' → zone libre = env - footprints existants
   * 'extension'    → bat collé au bâtiment existant
   */
  _applyExistingMode(env, existing, mode) {
    if (!existing || mode === 'demolition') return env;

    // Conservation : simplification par AABB exclusion
    // On garde l'enveloppe telle quelle mais le PIR sera calculé en excluant les footprints
    // Cette logique est gérée au niveau du placement PIR
    return env;
  },

  /**
   * Optimise un bâtiment unique centré sur PIR
   * @returns {{ x, y, w, l, nv }} bat maximisant nLgts dans les contraintes
   */
  _optimizeBat(env, prog, plu, bearing, px, py) {
    const TA = window.TerrainP07Adapter;
    const envArea = TA.polyArea(env);
    const maxEmprise = envArea * plu.emprMax / 100;

    // Limites
    const nvMax = Math.min(prog.nvMax ?? 3, Math.floor(plu.heMax / H_NIV));
    const rtaaW = plu.rtaaZone === 1 ? 10 : 12;
    const profMax = prog.profMax ?? 15;

    // Largeur max (contrainte RTAA + emprise)
    const wMax = Math.min(rtaaW, maxEmprise / Math.max(5, profMax));
    const lMax = Math.min(profMax, maxEmprise / Math.max(4, wMax));

    // Optimiser pour maximiser SP
    let bestW = 8, bestL = 10, bestNv = nvMax, bestScore = 0;

    for (let w = 6; w <= wMax; w += 0.5) {
      for (let l = 8; l <= lMax; l += 0.5) {
        const emprise = w * l;
        if (emprise > maxEmprise) continue;
        const sp = emprise * 0.82 * nvMax;
        const nLgts = prog.type === 'maison' ? 1 : Math.floor(sp / SP_MOY);
        if (nLgts > bestScore) {
          bestW = w; bestL = l; bestNv = nvMax; bestScore = nLgts;
        }
      }
    }

    return {
      x: px - bestW / 2,
      y: py - bestL / 2,
      w: bestW,
      l: bestL,
      nv: bestNv,
    };
  },

  /**
   * Génère les variantes Pareto A1-C2
   */
  _generatePareto(env, prog, plu, bearing, px, py, parcelArea, existing) {
    const TA = window.TerrainP07Adapter;
    const envArea = TA.polyArea(env);
    const nvMax = Math.min(prog.nvMax ?? 4, Math.floor(plu.heMax / H_NIV));
    const rtaaW = plu.rtaaZone === 1 ? 10 : 12;
    const profMax = prog.profMax ?? 15;
    const solutions = [];

    const families = [
      // A1 = max densité (heMax PLU, emprise max)
      { key: 'A1', label: 'Max densité', nv: nvMax, emprPct: plu.emprMax, color: '#EF4444' },
      // A2 = max densité multi-blocs
      { key: 'A2', label: 'Multi-blocs densité', nv: nvMax, emprPct: plu.emprMax, multiBloc: true, color: '#F97316' },
      // B1 = équilibre densité/perméabilité (3 niveaux, emprise 50%)
      { key: 'B1', label: 'Équilibre', nv: Math.min(3, nvMax), emprPct: Math.min(50, plu.emprMax), color: '#3B82F6' },
      // B2 = perméabilité prioritaire (2 niveaux, emprise 40%)
      { key: 'B2', label: 'Perméabilité', nv: Math.min(2, nvMax), emprPct: Math.min(40, plu.emprMax), color: '#22C55E' },
      // C1 = maison ou R+1 aidés, max jardins
      { key: 'C1', label: 'Habitat aidé', nv: Math.min(2, nvMax), emprPct: Math.min(35, plu.emprMax), color: '#A855F7' },
      // C2 = min emprise, max végétation
      { key: 'C2', label: 'Min emprise', nv: nvMax, emprPct: Math.min(25, plu.emprMax), color: '#14B8A6' },
    ];

    // COS : limite SP totale si défini dans le PLU
    const cosMaxSP = (plu.cos && parcelArea > 0) ? plu.cos * parcelArea : Infinity;

    for (const fam of families) {
      const maxEmprise = envArea * fam.emprPct / 100;
      let maxW = Math.min(rtaaW, maxEmprise > 0 ? maxEmprise / 5 : 8);
      const maxL = Math.min(profMax, maxEmprise > 0 ? maxEmprise / Math.max(4, maxW) : 10);

      // Limite longueur en limite séparative (PLU art. 7)
      if (plu.sep_lat_longueur_max_m) {
        maxW = Math.min(maxW, plu.sep_lat_longueur_max_m);
      }

      if (maxW < 4 || maxL < 5) continue;

      // Dimensionner bâtiment
      const w = Math.min(maxW, rtaaW);
      const l = Math.min(maxL, profMax);
      const emprise = w * l;
      if (emprise > maxEmprise) continue;

      let nv = fam.nv;
      const he = nv * H_NIV;
      let sp = emprise * 0.82 * nv;

      // Vérifier COS : réduire niveaux si SP dépasse le COS max
      if (sp > cosMaxSP) {
        nv = Math.max(1, Math.floor(cosMaxSP / (emprise * 0.82)));
        sp = emprise * 0.82 * nv;
      }

      const nLgts = prog.type === 'maison' ? 1 : Math.floor(sp / SP_MOY);
      const empPct = parcelArea > 0 ? (emprise / parcelArea * 100) : 0;
      const permPct = Math.max(0, 100 - empPct);

      // Score Pareto : densité × perméabilité × conformité
      const densScore = nLgts / Math.max(1, parcelArea / 10000);
      const permScore = permPct / 100;
      const cosOk = sp <= cosMaxSP;
      const confScore = (empPct <= plu.emprMax && he <= plu.heMax && cosOk) ? 1 : 0.5;
      const score = densScore * permScore * confScore;

      // Construire le polygone bâtiment (rectangle orienté)
      const bat = {
        x: px - w / 2,
        y: py - l / 2,
        w, l,
      };

      const polygon = [
        { x: bat.x, y: bat.y },
        { x: bat.x + w, y: bat.y },
        { x: bat.x + w, y: bat.y + l },
        { x: bat.x, y: bat.y + l },
      ];

      solutions.push({
        family: fam.key,
        familyKey: fam.key.toLowerCase(),
        label: fam.label,
        color: fam.color,
        bat,
        polygon,
        niveaux: nv,
        hauteur: he,
        surface: emprise,
        spTot: sp,
        nLgts,
        empPct,
        permPct,
        score,
        bearing,
        scoreData: { densScore, permScore, confScore },
      });
    }

    return solutions;
  },
};

export { AutoPlanEngine };
export default AutoPlanEngine;

// Expose pour compatibilité non-module TERLAB
if (typeof window !== 'undefined') window.AutoPlanEngine = AutoPlanEngine;
