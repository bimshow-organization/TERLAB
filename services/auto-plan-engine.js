// terlab/services/auto-plan-engine.js · Placement automatique Pareto A1-C2 · v2.0
// ENSA La Réunion · MGA Architecture 2026
// Vanilla JS ES2022+, aucune dépendance externe
// Génère 4-6 variantes Pareto pour étude de capacité constructible
// v1.1 : intégration SdisChecker après chaque solution Pareto
// v1.2 : intégration TopoCaseService — profMax et parkMode contraints par pente
// v2.0 : MULTI-STRATÉGIES — chaque famille utilise sa propre stratégie d'implantation
//        (rect / oblique / zone / multi-blocs). Les bâtiments sont tournés à l'axe
//        principal de la parcelle, peuvent suivre les arêtes obliques, et plusieurs
//        blocs peuvent être générés sur les parcelles longues et étroites.
//        Sortie : solution.blocs[] (chaque bloc a polygon + theta + niveaux).
//        solution.bat est dérivé pour rétrocompatibilité.

import TopoCaseService    from './topo-case-service.js';
import FH                 from './footprint-helpers.js';
import AutoPlanStrategies from './auto-plan-strategies.js';

const H_NIV  = 3.0;   // hauteur par niveau (m)
const MIN_W  = 4;     // largeur min bâtiment (m)
const MIN_L  = 5;     // profondeur min bâtiment (m)
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

    // 0. Contraintes topographiques (incluant azimut pente pour Isohypses)
    const topoConstraints = TopoCaseService.getProgConstraints(
      session?.terrain?.pente_moy_pct,
      prog,
      session?.terrain?.azimut_pente_deg,
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

    // 5. Inset adaptatif (avec règle binaire mitoyen G/D)
    const reculsTyped = {
      voie: plu.recul_voie,
      lat:  plu.recul_lat,
      fond: plu.recul_fond,
    };
    const p7 = session?.phases?.[7]?.data ?? {};
    const mitOpts = {
      mitoyen_g: !!(p7.mitoyen_g || p7.mitoyen_lateral || p7.implantation_limite_sep === true),
      mitoyen_d: !!(p7.mitoyen_d || p7.mitoyen_lateral || p7.implantation_limite_sep === true),
    };
    const insetResult = TA.adaptiveInset(poly, reculsTyped, edgeTypes, mitOpts);
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
    const solutions = this._generatePareto(
      envEff, progTopo, plu, bearing, px, py, area, existing, poly, edgeTypes,
    );

    // 10. Attacher les vérifications SDIS à chaque solution
    const Sdis = window.SdisChecker;
    if (Sdis) {
      for (const sol of solutions) {
        const sMetrics = {
          nvEff: sol.niveaux,
          type:  progTopo.type ?? 'collectif',
          nbLgts: sol.nLgts,
          emprise: sol.surface,
          nbBlocs: sol.blocs?.length ?? 1,
          gapMin:  sol.gapMin ?? null,
        };
        const distFacadeVoie = this._computeDistFacadeVoie(sol, edgeTypes, poly);
        // facadeLong : longueur de la plus grande façade (n'importe quel bloc)
        let facadeLong = null;
        for (const b of (sol.blocs ?? [])) {
          const lens = FH.edgeLengths(b.polygon ?? []);
          const maxLen = lens.length ? Math.max(...lens) : 0;
          if (maxLen > (facadeLong ?? 0)) facadeLong = maxLen;
        }
        sol.sdis = Sdis.run(session, sMetrics, {
          distFacadeVoie,
          distInterBat: sMetrics.nbBlocs > 1 ? sMetrics.gapMin : null,
          facadeLong,
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
   * Calcule la distance minimale entre l'union des blocs et l'arête voie.
   * Pour les solutions multi-blocs, retourne la plus petite distance bloc/voie.
   * @returns {number|null} distance en mètres
   */
  _computeDistFacadeVoie(solution, edgeTypes, poly) {
    if (!solution?.blocs?.length || !edgeTypes?.length || !poly?.length) return null;

    const voieIdx = edgeTypes.indexOf('voie');
    if (voieIdx < 0) return null;

    const n = poly.length;
    const a = poly[voieIdx];
    const b = poly[(voieIdx + 1) % n];
    const ax = a[0] ?? a.x, ay = a[1] ?? a.y;
    const bx = b[0] ?? b.x, by = b[1] ?? b.y;

    let dMin = Infinity;
    for (const bloc of solution.blocs) {
      for (const p of (bloc.polygon ?? [])) {
        const q = FH.toXY(p);
        const d = FH.distPointSeg(q.x, q.y, ax, ay, bx, by);
        if (d < dMin) dMin = d;
      }
    }
    return Number.isFinite(dMin) ? dMin : null;
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

    // AVAP proximité patrimoniale : He cappée par bâtiment de référence voisin +1 niveau
    const avap = (typeof window !== 'undefined' ? window.TERLAB_PLU_CONFIG?.avap : null) ?? null;
    if (avap?.proximite) {
      const hRef = parseFloat(p4.avap_h_reference_m ?? 0);
      if (hRef > 0) {
        heMax = Math.min(heMax, hRef + 3);
        console.info('[AutoPlan] AVAP proximité : He cappée à', heMax, 'm (référence', hRef, 'm + 1 niveau)');
      }
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
   * Génère les variantes Pareto A1-C2 avec stratégies d'implantation distinctes.
   *
   * Chaque famille utilise une stratégie qui détermine la FORME et l'ORIENTATION
   * du ou des bâtiments :
   *
   *   A1 — rect      : rectangle max densité aligné sur l'axe principal de la zone
   *   A2 — multi     : multi-blocs en bande (parcelles longues/étroites)
   *   B1 — oblique   : rectangle aligné sur l'arête dominante non-voirie
   *   B2 — rect      : rectangle perméabilité, plus petit, centré
   *   C1 — oblique   : habitat aidé aligné sur la rue, R+1
   *   C2 — zone      : épouse la zone constructible, min emprise
   *
   * Auto-sélection : si la parcelle est très longue et étroite (ratio > 2.8),
   * A2 (multi-blocs) devient prioritaire et A1 bascule aussi en multi.
   */
  _generatePareto(env, prog, plu, bearing, px, py, parcelArea, existing, parcelPoly, edgeTypes) {
    const TA = window.TerrainP07Adapter;
    const envArea = TA.polyArea(env);
    const nvMax = Math.min(prog.nvMax ?? 4, Math.floor(plu.heMax / H_NIV));
    const rtaaW = plu.rtaaZone === 1 ? 10 : 12;
    const profMax = prog.profMax ?? 15;
    const solutions = [];

    // Le PIR (px, py) — pour rect centré
    const pir = { x: px, y: py };

    // Détection parcelle longue/étroite : déclenche le mode multi-blocs prioritaire
    const longNarrow = AutoPlanStrategies.isLongAndNarrow(env, 2.8);

    // Inter-bat min : max(PLU, H/2 SDIS) — calculé par famille pour H réel
    const interBatPLU = parseFloat(plu.interBatMin ?? 4);

    // Détection pente exploitable pour Isohypses : pente moyenne ≥ 5%
    // ET azimut_pente_deg renseigné dans la session.
    const azimutPente = prog._topoConstraints?.azimut_deg;
    const tcSlope = prog._topoConstraints?.topoCase;
    const slopeId = tcSlope?.id ?? 'flat';
    const useIsohypses = Number.isFinite(azimutPente) && slopeId !== 'flat';

    const families = [
      // A1 = max densité — rect orienté PCA, sauf si parcelle longue → multi
      {
        key: 'A1', label: longNarrow ? 'Max densité multi' : 'Max densité',
        nv: nvMax, emprPct: plu.emprMax,
        strategy: longNarrow ? 'multi' : 'rect',
        color: '#EF4444',
      },
      // A2 = multi-blocs systématique (peigne)
      {
        key: 'A2', label: 'Multi-blocs',
        nv: nvMax, emprPct: plu.emprMax,
        strategy: 'multi',
        color: '#F97316',
      },
      // B1 = équilibre — oblique aligné sur arête dominante
      {
        key: 'B1', label: 'Équilibre oblique',
        nv: Math.min(3, nvMax), emprPct: Math.min(50, plu.emprMax),
        strategy: 'oblique',
        color: '#3B82F6',
      },
      // B2 = perméabilité — rect compact
      {
        key: 'B2', label: 'Perméabilité',
        nv: Math.min(2, nvMax), emprPct: Math.min(40, plu.emprMax),
        strategy: 'rect',
        color: '#22C55E',
      },
      // C1 = habitat aidé — oblique sur axe principal, R+1
      {
        key: 'C1', label: 'Habitat aidé',
        nv: Math.min(2, nvMax), emprPct: Math.min(35, plu.emprMax),
        strategy: 'oblique',
        color: '#A855F7',
      },
      // C2 = épouse la zone — min emprise
      {
        key: 'C2', label: 'Épouse la zone',
        nv: nvMax, emprPct: Math.min(25, plu.emprMax),
        strategy: 'zone',
        color: '#14B8A6',
      },
    ];

    // D1 = Isohypses — bâtiment ⊥ à la pente, profMax topo respecté.
    // Ajouté seulement si la pente est meaningful (≥5%) ET l'azimut connu.
    if (useIsohypses) {
      families.push({
        key: 'D1', label: `Isohypses (${tcSlope.label})`,
        nv: Math.min(2, nvMax), emprPct: Math.min(35, plu.emprMax),
        strategy: 'isohypses',
        color: '#0EA5E9',
      });
    }

    // COS : limite SP totale si défini dans le PLU
    const cosMaxSP = (plu.cos && parcelArea > 0) ? plu.cos * parcelArea : Infinity;

    for (const fam of families) {
      const maxEmprise = envArea * fam.emprPct / 100;
      if (maxEmprise < MIN_W * MIN_L) continue;

      // Largeur cible (perp axe) — limitée par RTAA et limite séparative PLU
      let wTarget = rtaaW;
      if (plu.sep_lat_longueur_max_m) {
        wTarget = Math.min(wTarget, plu.sep_lat_longueur_max_m);
      }
      // Profondeur (longueur) cible — limitée par profMax topo et par maxEmprise
      let lTarget = profMax;
      // Adapter aux dimensions de l'OBB de la zone (pas plus grand que la zone)
      const obb = FH.obb(env.map(p => FH.toXY(p)));
      wTarget = Math.min(wTarget, obb.w * 0.92);
      lTarget = Math.min(lTarget, obb.l * 0.92);

      // Si la parcelle est large et peu profonde, on swap (le bâtiment devient large)
      if (obb.l < lTarget * 0.7 && obb.w > wTarget) {
        [wTarget, lTarget] = [lTarget, wTarget];
      }

      // Garde-fous taille minimale
      if (wTarget < MIN_W * 0.9 || lTarget < MIN_L * 0.9) continue;

      // ── Application de la stratégie ────────────────────────────
      let blocs = [];
      const heLevel = fam.nv * H_NIV;
      const gapMin = Math.max(interBatPLU, heLevel / 2);

      if (fam.strategy === 'rect') {
        blocs = AutoPlanStrategies.rect(env, wTarget, lTarget, pir);
      } else if (fam.strategy === 'oblique') {
        blocs = AutoPlanStrategies.oblique(env, parcelPoly, edgeTypes, wTarget, lTarget);
        // Fallback : si oblique échoue, basculer sur rect
        if (!blocs.length) {
          blocs = AutoPlanStrategies.rect(env, wTarget, lTarget, pir);
        }
      } else if (fam.strategy === 'zone') {
        blocs = AutoPlanStrategies.zone(env, 0.5, maxEmprise);
        // Fallback : si la zone est trop grande pour la cible C2 → rect
        if (!blocs.length) {
          blocs = AutoPlanStrategies.rect(env, wTarget * 0.85, lTarget * 0.85, pir);
        }
      } else if (fam.strategy === 'multi') {
        blocs = AutoPlanStrategies.multiRect(env, wTarget, lTarget, gapMin, 4);
        // Fallback si multi échoue → rect simple
        if (!blocs.length) {
          blocs = AutoPlanStrategies.rect(env, wTarget, lTarget, pir);
        }
      } else if (fam.strategy === 'isohypses') {
        // Bâtiment ⊥ à la pente — profMax topo strict.
        // L'espace local TerrainP07Adapter est X-est, Y-nord (ySouth=false par défaut).
        blocs = AutoPlanStrategies.isohypses(
          env, wTarget, lTarget, pir, azimutPente, prog.profMax,
        );
        // Fallback : si isohypses échoue (ex. zone trop fine), basculer sur rect
        if (!blocs.length) {
          blocs = AutoPlanStrategies.rect(env, wTarget, lTarget, pir);
        }
      }

      if (!blocs.length) continue;

      // Surface emprise totale (somme des aires des blocs après clip)
      let emprise = FH.totalArea(blocs);
      if (emprise < MIN_W * MIN_L) continue;
      // Cap à maxEmprise (peut arriver pour la stratégie zone)
      if (emprise > maxEmprise * 1.05) {
        // Réduire proportionnellement les blocs (raccourcir l le long de l'axe)
        // → on signale juste empOver pour le scoring, on ne re-clippe pas
      }

      let nv = fam.nv;
      let sp = emprise * 0.82 * nv;

      // COS : réduire niveaux si SP dépasse cosMaxSP
      if (sp > cosMaxSP && cosMaxSP > 0) {
        nv = Math.max(1, Math.floor(cosMaxSP / (emprise * 0.82)));
        sp = emprise * 0.82 * nv;
      }
      const he = nv * H_NIV;

      // Tagger niveaux/hauteur sur tous les blocs
      blocs = AutoPlanStrategies.applyLevels(blocs, nv);

      const nLgts = prog.type === 'maison'
        ? Math.max(1, blocs.length)  // 1 maison par bloc (cas peu fréquent)
        : Math.floor(sp / SP_MOY);
      const empPct = parcelArea > 0 ? (emprise / parcelArea * 100) : 0;
      const permPct = Math.max(0, 100 - empPct);

      // Score Pareto : densité × perméabilité × conformité
      const densScore = nLgts / Math.max(1, parcelArea / 10000);
      const permScore = permPct / 100;
      const cosOk = sp <= cosMaxSP;
      const confScore = (empPct <= plu.emprMax + 1 && he <= plu.heMax && cosOk) ? 1 : 0.5;
      const score = densScore * permScore * confScore;

      // Dérivée legacy : bat = AABB de l'union des blocs, polygon = bloc primaire
      const aabb = FH.aabbOfBlocs(blocs);
      const bat = { x: aabb.x, y: aabb.y, w: aabb.w, l: aabb.l };

      solutions.push({
        family: fam.key,
        familyKey: fam.key.toLowerCase(),
        label: fam.label,
        color: fam.color,
        strategy: fam.strategy,

        // ── Modèle v2 : multi-blocs ──
        blocs,
        nbBlocs: blocs.length,
        gapMin: blocs.length > 1 ? gapMin : null,

        // ── Compat legacy ──
        bat,
        polygon: blocs[0]?.polygon ?? null,

        // Métriques
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
