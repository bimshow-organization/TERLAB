// terlab/services/fallback-house-generator.js
// FallbackHouseGenerator — Maison standard de secours
// ENSA La Réunion · MGA Architecture 2026
//
// Filet de sécurité quand toutes les stratégies Pareto échouent (zone vide,
// parcelle dégénérée, contraintes incompatibles). Garantit une emprise
// non vide via dégradation 8×12m → 6×9m → 5×7m → 4×5m → hullFromZone.
//
// Sera remplacé/complété ultérieurement par un appel houseg-speech
// (cf. project_bimshow_ecosystem). En attendant, retour cohérent avec la
// forme produite par auto-plan-engine._generatePareto pour interopérabilité.
//
// API contractuelle minimale (interface BuildingGenerator) :
//   generate({ env, edgeTypes, parcelPoly, plu, prog, pir, parcelArea, bearing })
//     → { family, familyKey, label, blocs[], niveaux, hauteur, surface, ... }

import FH from './footprint-helpers.js';
import APS from './auto-plan-strategies.js';

const H_NIV = 3.0;
const SP_RATIO = 0.82;            // SP / emprise (ratio standard logement)
const SP_MOY = 60.58;             // m² moyen / logement (pondéré T1-T4)

// Cascade de tailles testées (largeur × profondeur en m)
const SIZE_CASCADE = [
  { w: 8,  l: 12, label: '8×12 R+1' },
  { w: 7,  l: 10, label: '7×10 R+1' },
  { w: 6,  l: 9,  label: '6×9 R+1'  },
  { w: 5,  l: 7,  label: '5×7 R+1'  },
  { w: 4,  l: 5,  label: '4×5 R+0'  }, // dernier recours, R+0 forcé
];

const FallbackHouseGenerator = {

  /**
   * Génère une maison standard dans l'enveloppe constructible.
   * @param {Object} ctx
   * @param {Array}  ctx.env         — polygone enveloppe constructible (zone après recul) [{x,y},...]
   * @param {Array}  [ctx.edgeTypes] — types d'arêtes parcelle ('voie'|'fond'|'lat')
   * @param {Array}  [ctx.parcelPoly]— polygone parcelle d'origine [{x,y},...]
   * @param {Object} ctx.plu         — règles PLU { heMax, emprMax, recul_voie, ... }
   * @param {Object} [ctx.prog]      — programme { type, nvMax, profMax }
   * @param {Object} [ctx.pir]       — pôle d'inaccessibilité { x, y }
   * @param {number} [ctx.parcelArea]— surface parcelle (m²)
   * @param {number} [ctx.bearing]   — bearing voie (deg)
   * @returns {Object|null}          — solution compatible auto-plan-engine, ou null si vraiment rien
   */
  generate(ctx) {
    const { env, edgeTypes, parcelPoly, plu, prog, pir, parcelArea, bearing } = ctx;
    if (!env || env.length < 3) {
      console.warn('[FallbackHouse] enveloppe vide, impossible de générer');
      return null;
    }

    const nvMax = Math.max(1, Math.min(parseInt(prog?.nvMax ?? plu?.niveaux ?? 2), 3));
    const heMax = parseFloat(plu?.heMax ?? 9);
    const emprMaxPct = parseFloat(plu?.emprMax ?? 50);
    const envArea = FH.area(env);
    const maxEmprise = envArea * emprMaxPct / 100;

    // Cascade : essayer chaque taille jusqu'à trouver une solution non vide
    let blocs = null;
    let usedSize = null;
    let usedNv = nvMax;

    for (const size of SIZE_CASCADE) {
      // Skip tailles incompatibles avec emprise max PLU
      if (size.w * size.l > maxEmprise * 1.1) continue;

      // Forcer R+0 sur la dernière taille de secours
      const nvCandidate = size === SIZE_CASCADE[SIZE_CASCADE.length - 1] ? 1 : nvMax;

      const candidate = this._tryPlace(env, size.w, size.l, edgeTypes, parcelPoly, pir, bearing);
      if (candidate && candidate.length && FH.totalArea(candidate) >= 12) {
        blocs = candidate;
        usedSize = size;
        usedNv = nvCandidate;
        break;
      }
    }

    // Dernier recours absolu : épouser la zone (hullFromZone) avec area cap
    let strategy = 'fallback-rect';
    if (!blocs || !blocs.length) {
      const target = Math.min(maxEmprise, envArea * 0.5);
      const hull = FH.hullFromZone(env, 0.5, target);
      if (hull && hull.length >= 3 && FH.area(hull) >= 12) {
        const aabb = FH.aabb(hull);
        blocs = [{
          polygon: hull,
          theta: 0,
          w: Math.min(aabb.w, aabb.l),
          l: Math.max(aabb.w, aabb.l),
          strategy: 'fallback-hull',
          areaM2: FH.area(hull),
        }];
        usedSize = { label: `hull ${Math.round(FH.area(hull))}m²` };
        usedNv = 1; // hull = R+0 conservateur
        strategy = 'fallback-hull';
      }
    }

    if (!blocs || !blocs.length) {
      console.warn('[FallbackHouse] toutes les cascades ont échoué, parcelle inexploitable');
      return null;
    }

    // Tagger niveaux
    blocs = APS.applyLevels(blocs, usedNv, H_NIV);

    // Calcul des métriques (mêmes formules que _generatePareto pour cohérence)
    const emprise = FH.totalArea(blocs);
    const sp = emprise * SP_RATIO * usedNv;
    const he = usedNv * H_NIV;
    const empPct = parcelArea > 0 ? (emprise / parcelArea * 100) : 0;
    const permPct = Math.max(0, 100 - empPct);
    const nLgts = prog?.type === 'maison'
      ? 1
      : Math.max(1, Math.floor(sp / SP_MOY));

    // Score conservateur (toujours sous le score Pareto pour rester en bas du tri)
    const confScore = (empPct <= emprMaxPct + 1 && he <= heMax) ? 1 : 0.5;
    const score = 0.1 * confScore; // intentionnellement bas

    const aabb = FH.aabbOfBlocs(blocs);
    const bat = { x: aabb.x, y: aabb.y, w: aabb.w, l: aabb.l };

    return {
      // ── Identité famille ──
      family: 'F0',
      familyKey: 'fallback',
      label: `Maison standard · ${usedSize?.label ?? 'recours'}`,
      color: '#94A3B8',          // gris ardoise — visuellement neutre
      strategy,
      source: 'fallback',         // marqueur clé pour l'UI

      // ── Modèle v2 multi-blocs ──
      blocs,
      nbBlocs: blocs.length,
      gapMin: null,

      // ── Compat legacy ──
      bat,
      polygon: blocs[0]?.polygon ?? null,

      // ── Métriques ──
      niveaux: usedNv,
      hauteur: he,
      surface: emprise,
      spTot: sp,
      nLgts,
      empPct,
      permPct,
      score,
      bearing: bearing ?? 0,
      scoreData: { densScore: 0, permScore: permPct / 100, confScore, costScore: 1 },

      // Marqueur pédagogique pour l'UI
      warnings: [
        'Gabarit générique de secours — à affiner via stratégies dédiées ou import HouseG.',
      ],
    };
  },

  /**
   * Essaie de placer un rectangle wTarget × lTarget dans l'enveloppe.
   * Privilégie l'orientation voie si edgeTypes connu (roadAligned),
   * sinon retombe sur rect AABB centré PIR.
   * @returns {Array|null} blocs[] ou null
   */
  _tryPlace(env, wTarget, lTarget, edgeTypes, parcelPoly, pir, bearing) {
    // 1. Tentative roadAligned si voie connue
    if (edgeTypes && parcelPoly && (edgeTypes.indexOf('voie') >= 0)) {
      try {
        const blocs = APS.roadAligned(env, parcelPoly, edgeTypes, wTarget, lTarget);
        if (blocs && blocs.length && FH.totalArea(blocs) >= wTarget * lTarget * 0.5) {
          return blocs.map(b => ({ ...b, strategy: 'fallback-rect' }));
        }
      } catch (e) { /* continue avec rect */ }
    }

    // 2. Tentative rect classique centré PIR
    try {
      const blocs = APS.rect(env, wTarget, lTarget, pir, bearing);
      if (blocs && blocs.length && FH.totalArea(blocs) >= wTarget * lTarget * 0.4) {
        return blocs.map(b => ({ ...b, strategy: 'fallback-rect' }));
      }
    } catch (e) { /* fall through */ }

    return null;
  },

  /**
   * Helper : décide si une liste de solutions Pareto a besoin du fallback.
   * @param {Array} solutions
   * @returns {boolean}
   */
  shouldInject(solutions) {
    if (!solutions || solutions.length === 0) return true;
    // Ignorer les solutions X0 (zone N/A, PPRN rouge) — ce sont des messages, pas des échecs
    const real = solutions.filter(s => s.family !== 'X0');
    if (real.length === 0) return true;
    // Toutes les solutions ont des blocs vides ?
    const allEmpty = real.every(s => !s.blocs || s.blocs.length === 0);
    return allEmpty;
  },
};

export default FallbackHouseGenerator;

if (typeof window !== 'undefined') window.FallbackHouseGenerator = FallbackHouseGenerator;
