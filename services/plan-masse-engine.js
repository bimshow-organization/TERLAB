// terlab/services/plan-masse-engine.js
// PlanMasseEngine — Moteur de calcul plan masse v5
// Calculs purs (zéro DOM) : métriques, conformité 7 points, capacité, subdivision, parking
// Porté depuis terlab-plan-editor-v5.html
// ENSA La Réunion · MGA Architecture

import { getZoneRTAA } from './reunion-constants.js';
import TopoCaseService from './topo-case-service.js';

// ── CONSTANTES ───────────────────────────────────────────────────────────────
const SNAP_M   = 0.5;
const MIN_W    = 4;     // largeur min bâtiment (m)
const MIN_L    = 5;     // profondeur min bâtiment (m)
const H_NIV    = 3.0;   // hauteur par niveau (m)
const NV_LBL   = ['', 'R+0', 'R+1', 'R+2', 'R+3', 'R+4'];
// Surface moyenne pondérée logement (T1 17.5% × 31m², T2 27.5% × 49m², T3 32.5% × 68m², T4+ 22.5% × 87m²)
const SP_MOY   = 0.175 * 31 + 0.275 * 49 + 0.325 * 68 + 0.225 * 87; // ≈ 60.58 m²

// ── GEOMETRIE ────────────────────────────────────────────────────────────────

function lineIsect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d1x = x2 - x1, d1y = y2 - y1, d2x = x4 - x3, d2y = y4 - y3;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return null;
  const t = ((x3 - x1) * d2y - (y3 - y1) * d2x) / cross;
  return [x1 + t * d1x, y1 + t * d1y];
}

function insetPoly(poly, reculPerEdge) {
  const n = poly.length;
  const iedges = [];
  for (let i = 0; i < n; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
    const d = reculPerEdge[i], dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 0.01) { iedges.push([x1, y1, x2, y2]); continue; }
    const nx = -dy / len, ny = dx / len;
    iedges.push([x1 + nx * d, y1 + ny * d, x2 + nx * d, y2 + ny * d]);
  }
  return iedges.map((_, i) => {
    const [x1, y1, x2, y2] = iedges[i];
    const [x3, y3, x4, y4] = iedges[(i + 1) % iedges.length];
    return lineIsect(x1, y1, x2, y2, x3, y3, x4, y4) || [(x2 + x3) / 2, (y2 + y3) / 2];
  });
}

function ptInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polyAABB(poly) {
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  return {
    x: Math.min(...xs), y: Math.min(...ys),
    x1: Math.max(...xs), y1: Math.max(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

function polyArea(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

// ── ENGINE ───────────────────────────────────────────────────────────────────

const PlanMasseEngine = {

  // Constantes exportées
  SNAP_M, MIN_W, MIN_L, H_NIV, NV_LBL, SP_MOY,

  // ── Snap 0.5m ──────────────────────────────────────────────
  snap(v) { return Math.round(v / SNAP_M) * SNAP_M; },

  // ── Polygone constructible (enveloppe) ─────────────────────
  computeEnvPoly(terrain) {
    const r = terrain.reculs;
    return insetPoly(terrain.poly, terrain.edgeTypes.map(type => r[type] ?? r.lat ?? 0));
  },

  computeEnv(terrain) {
    const poly = this.computeEnvPoly(terrain);
    const bb = polyAABB(poly);
    return { ...bb, poly };
  },

  // ── Contraindre bâtiment dans enveloppe ────────────────────
  clampBat(bat, env) {
    bat.w = Math.max(MIN_W, Math.min(bat.w, env.w));
    bat.l = Math.max(MIN_L, Math.min(bat.l, env.h));
    bat.x = Math.max(env.x, Math.min(env.x + env.w - bat.w, bat.x));
    bat.y = Math.max(env.y, Math.min(env.y + env.h - bat.l, bat.y));
  },

  // ── Bâtiment dans enveloppe ? ──────────────────────────────
  batInEnv(bat, envPoly) {
    return [[bat.x, bat.y], [bat.x + bat.w, bat.y], [bat.x + bat.w, bat.y + bat.l], [bat.x, bat.y + bat.l]]
      .every(([px, py]) => ptInPoly(px, py, envPoly));
  },

  // ── Niveaux max PLU ────────────────────────────────────────
  nvMaxPLU(plu) {
    return Math.max(1, Math.floor((plu.heMax ?? 9) / H_NIV));
  },

  // ── METRIQUES PRINCIPALES ──────────────────────────────────
  // state = { bat, prog, parkSide, terrain, scenario }
  metrics(state) {
    const { bat, prog, parkSide, terrain, scenario } = state;
    const plu = terrain.plu;
    const sc = scenario ?? { eff: 0.82, aide: 0.60, nv: 3, color: '#2563EB' };
    const env = this.computeEnv(terrain);
    const nvEffMax = this.nvMaxPLU(plu);
    const nvEff = Math.min(prog.nvMax ?? 2, nvEffMax);

    // Emprise + SP
    const emprise = bat.w * bat.l;
    const empPct = terrain.area > 0 ? emprise / terrain.area * 100 : 0;
    let spBase = emprise;
    if (prog.parkMode === 'rdc') spBase *= 0.75;
    const spTot = spBase * (sc.eff ?? 0.82) * nvEff;

    // Logements
    const nbLgts = prog.type === 'maison' ? 1 : Math.floor(spTot / SP_MOY);
    const nbAide = prog.type === 'maison' ? 0 : Math.round(nbLgts * (sc.aide ?? 0.6));
    const nbLibre = nbLgts - nbAide;

    // Parking
    const parkRequired = prog.type === 'maison' ? 2 : (nbLibre * 2 + nbAide + Math.ceil(nbLgts / 5));
    let parkExt = 0, parkSS = 0, empPark = 0;
    if (prog.parkMode === 'ss') {
      parkSS = parkRequired;
    } else if (prog.parkMode === 'rdc') {
      parkExt = Math.floor(emprise * 0.25 / 25);
      const overflow = Math.max(0, parkRequired - parkExt);
      if (prog.parkSS) parkSS = overflow;
    } else { // ext
      parkExt = parkRequired;
      empPark = parkExt * 25;
      if (prog.parkSS) { parkExt = 0; parkSS = parkRequired; empPark = 0; }
    }

    // Perméabilité & densité
    const impermeab = emprise + empPark;
    const permPct = Math.max(0, (1 - impermeab / terrain.area) * 100);
    const dens = nbLgts / (terrain.area / 10000);

    // RTAA largeur
    const rtaaZone = plu.rtaaZone ?? parseInt(getZoneRTAA(terrain.altitude ?? 100));
    const rtaaW = rtaaZone === 1 ? 10 : 12;

    // Conformité enveloppe
    const inEnv = this.batInEnv(bat, env.poly);

    // Multi-bâtiment
    const gapMin = Math.max(plu.interBatMin ?? 4, nvEff * H_NIV / 2);
    const nbBlocs = (prog.type === 'collectif' && (prog.maxUnits ?? 0) > 0 && nbLgts > prog.maxUnits)
      ? Math.ceil(nbLgts / Math.max(1, prog.maxUnits)) : 1;

    // ── 7 CHECKS CONFORMITE ──────────────────────────────────
    const checks = [
      { lbl: 'Enveloppe',     ok: inEnv,               proj: inEnv ? 'oui' : 'NON',             rule: 'requis',                              unit: '' },
      { lbl: 'Larg. RTAA',    ok: bat.w <= rtaaW,       proj: bat.w.toFixed(1),                   rule: `≤${rtaaW}`,                           unit: 'm' },
      { lbl: 'Prof. N-S',     ok: bat.l <= (prog.profMax ?? 25), proj: bat.l.toFixed(1),           rule: `≤${prog.profMax ?? 25}`,              unit: 'm' },
      { lbl: 'Niv. PLU',      ok: nvEff <= nvEffMax,    proj: NV_LBL[nvEff] || nvEff,             rule: `≤${NV_LBL[nvEffMax] || nvEffMax} (${plu.heMax}m)`, unit: '' },
      { lbl: 'Emprise',       ok: empPct <= (plu.emprMax ?? 60), proj: empPct.toFixed(1),          rule: `≤${plu.emprMax ?? 60}`,               unit: '%' },
      { lbl: 'Perméabilité',  ok: permPct >= (plu.permMin ?? 25), proj: permPct.toFixed(1),        rule: `≥${plu.permMin ?? 25}`,               unit: '%' },
      { lbl: 'Densité SCoT',  ok: dens >= 30,           proj: dens.toFixed(0),                    rule: '≥30',                                 unit: 'l/ha' },
    ];
    if (nbBlocs > 1) {
      checks.push({ lbl: 'Dist. inter-bat', ok: true, proj: `${gapMin.toFixed(1)}m`, rule: `≥${gapMin.toFixed(1)}`, unit: 'm' });
    }

    // ── CHECKS TOPOGRAPHIQUES ────────────────────────────────
    const topoCase = state?.proposal?.topoCase ?? state?.topoCase
      ?? TopoCaseService.getCase(state?.terrain?.pente_moy_pct ?? null);

    if (topoCase && !topoCase.unknown) {
      if (bat.l > topoCase.profMax) {
        checks.push({
          lbl: 'Prof. topo', ok: false,
          proj: bat.l.toFixed(1), rule: `≤${topoCase.profMax}`,
          unit: 'm', severity: 'warning',
          detail: `Sur ${topoCase.label}, profondeur max recommandée = ${topoCase.profMax}m`,
          conseil: 'C' + ({ flat: 17, gentle: 18, medium: 19, steep: 20, extreme: 21 }[topoCase.id] ?? 17),
        });
      }
      if (topoCase.bureauStructure) {
        checks.push({
          lbl: 'Bureau structure', ok: null,
          proj: 'requis', rule: 'pilotis >8m',
          unit: '', severity: 'info',
          detail: 'Pente extrême : note de calcul structure obligatoire avant permis.',
          conseil: 'D29',
        });
      }
      if (topoCase.pompesRelev) {
        checks.push({
          lbl: 'Pompes relevage', ok: null,
          proj: 'probable', rule: 'R-1+',
          unit: '', severity: 'info',
          detail: 'Niveaux enterrés sous cote réseau — prévoir pompe de relevage (3 000–4 500€/niv).',
          conseil: 'F41',
        });
      }
    }

    const allOk = checks.every(c => c.ok !== false);

    // Capacité max théorique
    const maxEmprise = terrain.area * (plu.emprMax ?? 60) / 100;
    const maxSP = maxEmprise * (sc.eff ?? 0.82) * nvEffMax;
    const maxLgts = prog.type === 'maison' ? 1 : Math.floor(maxSP / SP_MOY);

    // GIEP pré-dim
    const Q = 0.9 * (80 / 3600) * impermeab;
    const vGiep = Q * 600;
    const sNoue = vGiep / 0.30;

    // Surface perméable végétalisée (si stats BPF disponibles)
    const bpfStats = state.bpfStats ?? null;
    const permVeg = bpfStats?.permVegetaliseeM2 ?? (permPct * terrain.area / 100 * 0.6);
    const giepIntegre = permVeg >= sNoue;

    // Vérifications PLU plantations (si stats BPF disponibles)
    const plantChecks = bpfStats
      ? this._checkPlantations(state, terrain.area, nbLgts, bpfStats)
      : [];

    return {
      // Scénario
      sc, nvEff, nvEffMax, rtaaW,
      // Surfaces
      emprise, empPct, spTot, impermeab,
      // Logements
      nbLgts, nbAide, nbLibre, maxLgts,
      // Parking
      parkExt, parkSS, parkRequired, empPark,
      // Ratios
      permPct, dens,
      // Conformité
      inEnv, checks, allOk,
      // Subdivision
      nbBlocs, gapMin,
      // GIEP
      Q, vGiep, sNoue,
      giep: { Q, sNoue, permVeg, integre: giepIntegre },
      // PLU Plantations
      plantChecks,
    };
  },

  // ── SUBDIVISION MULTI-BATIMENT ─────────────────────────────
  getBlocRects(bat, metrics) {
    const nb = metrics.nbBlocs;
    if (nb <= 1) return [bat];
    const gap = metrics.gapMin;
    const totalGap = (nb - 1) * gap;
    // Essayer split horizontal (E-O)
    const bw = (bat.w - totalGap) / nb;
    if (bw >= MIN_W) {
      return Array.from({ length: nb }, (_, i) => ({
        x: bat.x + i * (bw + gap), y: bat.y, w: bw, l: bat.l,
      }));
    }
    // Essayer split vertical (N-S)
    const bh = (bat.l - totalGap) / nb;
    if (bh >= MIN_L) {
      return Array.from({ length: nb }, (_, i) => ({
        x: bat.x, y: bat.y + i * (bh + gap), w: bat.w, l: bh,
      }));
    }
    return [bat]; // fallback
  },

  // ── PARKING RECTANGLE ──────────────────────────────────────
  getParkRect(bat, metrics, parkSide, terrain) {
    if (metrics.parkRequired === 0 || metrics.empPark === 0) return null;
    const env = this.computeEnv(terrain);
    const GAP = 1.0, totalArea = metrics.parkRequired * 25;
    let pw, ph, x, y;

    if (parkSide === 'est') {
      const avail = env.x1 - (bat.x + bat.w) - GAP;
      pw = Math.max(5, Math.min(14, avail)); ph = Math.min(env.h, Math.max(5, totalArea / pw));
      x = Math.min(bat.x + bat.w + GAP, env.x1 - pw); y = Math.max(env.y, Math.min(bat.y, env.y1 - ph));
    } else if (parkSide === 'ouest') {
      const avail = bat.x - env.x - GAP;
      pw = Math.max(5, Math.min(14, avail)); ph = Math.min(env.h, Math.max(5, totalArea / pw));
      x = Math.max(env.x, bat.x - pw - GAP); y = Math.max(env.y, Math.min(bat.y, env.y1 - ph));
    } else if (parkSide === 'nord') {
      const avail = env.y1 - (bat.y + bat.l) - GAP;
      ph = Math.max(5, Math.min(14, avail)); pw = Math.min(env.w, Math.max(5, totalArea / ph));
      x = Math.max(env.x, Math.min(bat.x, env.x1 - pw)); y = Math.min(bat.y + bat.l + GAP, env.y1 - ph);
    } else { // sud
      const avail = bat.y - env.y - GAP;
      ph = Math.max(5, Math.min(14, avail)); pw = Math.min(env.w, Math.max(5, totalArea / ph));
      x = Math.max(env.x, Math.min(bat.x, env.x1 - pw)); y = Math.max(env.y, bat.y - ph - GAP);
    }

    const niveaux = Math.max(1, Math.ceil(totalArea / (pw * ph)));
    return { x, y, w: Math.max(3, pw), h: Math.max(3, ph), niveaux };
  },

  // ── TERRAIN FROM SESSION ───────────────────────────────────
  // Convertit la session TERLAB en struct terrain pour l'engine
  terrainFromSession(session) {
    const terrain = session?.terrain ?? {};
    const p4 = session?.phases?.[4]?.data ?? {};
    const pluCfg = session?.pluConfig ?? {};

    // Parcelle locale [{x,y}] → [[x,y]] pour l'engine
    // On attend que EsquisseCanvas fournisse parcelLocal + edgeTypes
    const parcelLocal = session._parcelLocal ?? [];
    const edgeTypes = session._edgeTypes ?? [];

    // Aire
    let area = 0;
    if (parcelLocal.length >= 3) {
      let s = 0;
      for (let i = 0, n = parcelLocal.length; i < n; i++) {
        const j = (i + 1) % n;
        s += parcelLocal[i].x * parcelLocal[j].y - parcelLocal[j].x * parcelLocal[i].y;
      }
      area = Math.abs(s) / 2;
    }
    area = area || parseFloat(terrain.contenance_m2 ?? 500);

    // Convertir [{x,y}] → [[x,y]]
    const poly = parcelLocal.map(p => [p.x, p.y]);

    // Reculs
    const reculs = {
      voie: parseFloat(p4.recul_voie_m ?? p4.recul_avant_m ?? pluCfg?.reculs?.voie ?? 3) || 3,
      fond: parseFloat(p4.recul_fond_m ?? pluCfg?.reculs?.fond ?? 3) || 3,
      lat:  parseFloat(p4.recul_lat_m ?? pluCfg?.reculs?.lat ?? 0) || 0,
    };

    // PLU
    const alt = parseFloat(terrain.altitude_ngr ?? 100);
    const rtaaZone = parseInt(getZoneRTAA(alt));
    const plu = {
      emprMax:     parseFloat(p4.ces_max ?? pluCfg?.plu?.emprMax ?? 60) * (p4.ces_max && p4.ces_max <= 1 ? 100 : 1),
      permMin:     parseFloat(pluCfg?.plu?.permMin ?? p4.permeabilite_min_pct ?? 25),
      heMax:       parseFloat(p4.hauteur_egout_m ?? p4.hauteur_max_m ?? pluCfg?.plu?.heMax ?? 9),
      rtaaZone,
      zone:        p4.zone_plu ?? pluCfg?.meta?.zone ?? 'U',
      interBatMin: parseFloat(pluCfg?.plu?.interBatMin ?? 4),
    };

    // Normaliser emprMax (si c'est 0.7 au lieu de 70)
    if (plu.emprMax > 0 && plu.emprMax <= 1) plu.emprMax *= 100;

    return { poly, edgeTypes, reculs, area, plu, altitude: alt };
  },

  // ── VERIFICATION PLU PLANTATIONS ────────────────────────────
  _checkPlantations(state, parcelArea, nLgts, bpfStats) {
    const plu = state.terrain?.plu ?? {};
    const pc = plu.plantations_communes ?? state.session?.pluConfig?.plantations_communes ?? {};
    const checks = [];

    // Ratio arbres / surface
    const ratioArbresSol = parseInt(pc.ratio_espaces_libres?.match?.(/(\d+)/)?.[1] ?? 100);
    const minArbres = Math.ceil(parcelArea / ratioArbresSol);

    // Ratio arbres+arbustes / logements collectifs
    const minArbresLgts = pc.ratio_collectif
      ? Math.ceil(nLgts / 4)
      : 0;

    const minArbresTotal = Math.max(minArbres, minArbresLgts);
    const actualArbres = bpfStats?.arbres ?? 0;

    checks.push({
      label: 'Arbres min. PLU',
      ok: actualArbres >= minArbresTotal,
      val: actualArbres,
      rule: `≥ ${minArbresTotal}`,
      unit: 'arbres',
    });

    // Aires de jeux
    const ajLgt = parseFloat(pc.aires_jeux_m2_par_logement_collectif ?? 0);
    if (ajLgt > 0 && nLgts > 0) {
      const minAJ = ajLgt * nLgts;
      const actualAJ = bpfStats?.airesJeuxM2 ?? 0;
      checks.push({
        label: 'Aires de jeux',
        ok: actualAJ >= minAJ,
        val: actualAJ.toFixed(0),
        rule: `≥ ${minAJ.toFixed(0)}`,
        unit: 'm²',
      });
    }

    // 3 strates végétales
    if (pc.minimum_3_strates) {
      const strates = bpfStats?.strates ?? [];
      checks.push({
        label: '3 strates végétales',
        ok: strates.length >= 3,
        val: strates.join(', ') || '—',
        rule: 'arbo + arbu + herbacé',
        unit: '',
      });
    }

    return checks;
  },

  // ── Utilitaires exportés ───────────────────────────────────
  polyArea,
  polyAABB,
  ptInPoly,
  insetPoly,
};

export default PlanMasseEngine;
