// ═══════════════════════════════════════════════════════════════════════════
// S7 — DÉBORDS
//
// ── CE QU'IL NE FAUT PAS FAIRE ─────────────────────────────────────────────
// La tentation est d'agrandir l'emprise et de relancer le squelette. C'est
// faux : le squelette droit doit courir sur l'emprise STRUCTURELLE (les murs,
// les sablières). Agrandir l'emprise déplace les arêtiers, allonge le faîtage
// et change la topologie — on ne construirait plus la même toiture.
//
// Un débord ne change pas la toiture. Il PROLONGE chaque pan dans son propre
// plan, au-delà de sa ligne d'égout ou de sa ligne de rive.
//
// ── LA CONSTRUCTION EXACTE ─────────────────────────────────────────────────
// Le contour d'un pan est fait de deux natures d'arêtes :
//   · celles qui reposent sur une arête d'EMPRISE (égout, ou arase de pignon) ;
//   · celles qui sont des arêtes de SQUELETTE (faîtage, arêtier, noue).
// Prolonger le pan, c'est déplacer vers l'extérieur les droites porteuses de la
// PREMIÈRE nature, de leur débord propre, et laisser les autres où elles sont.
// Les sommets se recalculent par intersection des droites consécutives — un
// onglet exact. Les arêtiers s'allongent tout seuls jusqu'au coin, sans qu'on
// ait à les traiter : ce sont les droites de squelette, elles n'ont pas bougé.
//
// ── LES DEUX DÉBORDS SONT LE MÊME OBJET ────────────────────────────────────
// Le débord d'ÉGOUT (arête à poids non nul) fait descendre la nappe : le pan
// gagne d·tanθ en altitude négative, et d/cosθ en rampant.
// Le débord de RIVE (arête de pignon, poids nul) élargit latéralement les pans
// voisins, sans changer d'altitude.
// Dans les deux cas c'est la même opération : la droite d'emprise recule de d.
// Pas deux codes, pas deux vocabulaires — un seul.
//
// ── LA NAPPE ───────────────────────────────────────────────────────────────
// Sur un vrai chantier la ligne de gouttière est de niveau. Cela ne veut PAS
// dire « même débord partout » : à altitude d'égout constante, un pan doux
// déborde davantage qu'un pan raide. `debordsNappe(drop)` donne d_i = drop·cotθ_i
// et rend les égouts rigoureusement coplanaires. C'est le mode recommandé ;
// le mode libre reste possible et l'audit rapporte alors les altitudes.
//
// @coords  plan = [x, z] · pan = [u, v] (vraie grandeur de rampant)
//
// Porté depuis bimshow-vision (POC ciriani-santillana, module `overhang`).
// ═══════════════════════════════════════════════════════════════════════════

import { ensureCCW, area, signedArea, hasSelfIntersect, pointInPoly, innerNormal } from './geom2d.js';

const DEG = Math.PI / 180;
const TOL = 1e-7;

/** Borne de porte-à-faux admissible pour une queue de chevron sans about. */
export const DEBORD_LIMITES = {
  /** fraction de la portée rampante du pan au-delà de laquelle on alerte */
  fractionPortee: 1 / 3,
  /** débord absolu au-delà duquel on alerte quoi qu'il arrive (m) */
  absolu: 1.20,
};

// ── Spécification ──────────────────────────────────────────────────────────

/**
 * Débords d'une NAPPE de niveau : tous les égouts à la même altitude.
 * @param model  modèle S3
 * @param drop   descente de l'égout sous l'arase des murs (m, > 0)
 * @returns {{ [sourceEdge]: number }} débord horizontal par spec utilisateur
 */
export function debordsNappe(model, drop, opts = {}) {
  const out = {};
  const rive = opts.rive ?? drop;                 // le débord de rive n'a pas de pente
  for (const p of model.pans) {
    if (p.sourceEdge === null || p.sourceEdge === undefined) continue;
    out[p.sourceEdge] = p.kind === 'pan' ? drop * p.poids : rive;
  }
  return out;
}

// ── Géométrie de droites ───────────────────────────────────────────────────

const norm = (d) => { const l = Math.hypot(d[0], d[1]) || 1; return [d[0] / l, d[1] / l]; };

/** Intersection de deux droites (point, direction). null si quasi parallèles. */
function interDroites(L1, L2) {
  const det = L1.d[0] * -L2.d[1] - L1.d[1] * -L2.d[0];
  if (Math.abs(det) < 1e-12) return null;
  const bx = L2.p[0] - L1.p[0], bz = L2.p[1] - L1.p[1];
  const t = (bx * -L2.d[1] - bz * -L2.d[0]) / det;
  return [L1.p[0] + t * L1.d[0], L1.p[1] + t * L1.d[1]];
}

/** Le segment [a,b] repose-t-il sur la droite de l'arête d'emprise j ? */
function surAreteEmprise(a, b, P0, dir, tol) {
  const n = [-dir[1], dir[0]];
  const da = (a[0] - P0[0]) * n[0] + (a[1] - P0[1]) * n[1];
  const db = (b[0] - P0[0]) * n[0] + (b[1] - P0[1]) * n[1];
  if (Math.abs(da) > tol || Math.abs(db) > tol) return false;
  // et il doit être orienté comme elle (pas une arête de squelette fortuite)
  const e = norm([b[0] - a[0], b[1] - a[1]]);
  return Math.abs(e[0] * dir[0] + e[1] * dir[1]) > 0.999;
}

// ── Le cœur ────────────────────────────────────────────────────────────────

/**
 * Prolonge le contour d'un pan selon les débords des arêtes d'emprise.
 *
 * @param contour   contour du pan en plan, [[x,z], …]
 * @param emprise   emprise structurelle (poly interne du squelette)
 * @param debords   débord par arête d'emprise INTERNE, tableau de longueur n
 * @returns {{ poly, deplacees, ok, msg }}
 */
export function offsetPanContour(contour, emprise, debords, tol = 1e-6) {
  if (!contour || contour.length < 3) return { poly: [], deplacees: [], ok: false, msg: 'contour vide' };
  const C = ensureCCW(contour.map((p) => [p[0], p[1]]));
  const n = C.length, m = emprise.length;

  // droite porteuse de chaque arête du contour, décalée si elle est sur l'emprise
  const lignes = [], deplacees = [];
  for (let k = 0; k < n; k++) {
    const a = C[k], b = C[(k + 1) % n];
    const d = norm([b[0] - a[0], b[1] - a[1]]);
    let ligne = { p: a, d }, source = null;
    for (let j = 0; j < m; j++) {
      const A = emprise[j], B = emprise[(j + 1) % m];
      if (Math.hypot(B[0] - A[0], B[1] - A[1]) < 1e-9) continue;   // retour vertical
      const dj = norm([B[0] - A[0], B[1] - A[1]]);
      if (!surAreteEmprise(a, b, A, dj, tol)) continue;
      const dj_ = debords[j] ?? 0;
      source = j;
      if (dj_ > 0) {
        const nInt = innerNormal(A, B);                             // vers l'intérieur (emprise CCW)
        ligne = { p: [A[0] - nInt[0] * dj_, A[1] - nInt[1] * dj_], d: dj };
        deplacees.push({ contourEdge: k, empriseEdge: j, debord: dj_ });
      }
      break;
    }
    lignes.push({ ...ligne, source });
  }

  // sommets = intersections consécutives ; repli sur translation si parallèles
  const poly = [];
  for (let k = 0; k < n; k++) {
    const Lp = lignes[(k - 1 + n) % n], Lk = lignes[k];
    const P = interDroites(Lp, Lk);
    if (P) poly.push(P);
    else {
      // droites parallèles (deux arêtes colinéaires de débords égaux) : le
      // sommet se translate simplement sur la nouvelle droite.
      const q = C[k], nn = [-Lk.d[1], Lk.d[0]];
      const dist = (q[0] - Lk.p[0]) * nn[0] + (q[1] - Lk.p[1]) * nn[1];
      poly.push([q[0] - nn[0] * dist, q[1] - nn[1] * dist]);
    }
  }

  if (hasSelfIntersect(poly)) {
    return { poly, deplacees, ok: false, msg: 'le contour prolongé se recoupe — débord trop grand pour ce pan' };
  }
  if (signedArea(poly) <= 0) {
    return { poly, deplacees, ok: false, msg: 'le contour prolongé s\'est retourné' };
  }
  if (area(poly) + 1e-9 < area(C)) {
    return { poly, deplacees, ok: false, msg: 'le contour prolongé est plus petit que le pan' };
  }
  return { poly, deplacees, ok: true, msg: null };
}

/**
 * Applique les débords à tout un modèle.
 *
 * @param r      résultat de `buildRoof`
 * @param model  modèle S3 correspondant
 * @param spec   { parSource: {sourceEdge: débord}, defaut?, mode? } ou un nombre
 * @returns objet débord, avec un audit
 */
export function buildOverhang(r, model, specIn = {}) {
  const spec = specIn ?? {};
  const sk = r.skeleton;
  const emprise = sk.poly;
  const origin = sk.origin ?? emprise.map((_, i) => i);
  const nE = emprise.length;

  // PRÉCÉDENCE, du plus fort au plus faible. Un nombre passé ici est un ordre
  // explicite : il écrase le débord porté par les specs d'arête, sinon on ne
  // pourrait jamais forcer 0 m alors que `normalizeEdgeSpecs` met 0,40 m par
  // défaut — et on croirait avoir demandé une chose en en obtenant une autre.
  const force = typeof spec === 'number' ? spec : undefined;
  const parSource = typeof spec === 'number' ? null : (spec.parSource ?? spec.debords ?? {});
  const defaut = spec?.defaut;

  const debords = new Array(nE).fill(0);
  for (let i = 0; i < nE; i++) {
    const se = origin[i];
    if (se === null || se === undefined) continue;              // retour vertical : pas d'égout
    const v = force !== undefined ? force
      : (parSource && parSource[se] !== undefined) ? parSource[se]
      : defaut !== undefined ? defaut
      : (r.specs?.[se]?.debord ?? 0);
    debords[i] = Math.max(0, +v || 0);
  }

  const pans = [], erreurs = [], warnings = [];
  for (const pan of model.pans) {
    if (pan.kind !== 'pan' || pan.aireProjetee <= 1e-9) continue;
    const res = offsetPanContour(pan.contour, emprise, debords);
    const dEgout = debords[pan.index] ?? 0;
    const tanT = Math.tan(pan.pente * DEG);

    if (!res.ok) {
      erreurs.push({ code: 'DEBORD_IMPOSSIBLE', panId: pan.id, sourceEdge: pan.sourceEdge, msg: res.msg });
      pans.push({ id: pan.id, sourceEdge: pan.sourceEdge, ok: false, msg: res.msg,
        debordEgout: dEgout, contour: pan.contour, contourUV: pan.contourUV,
        aireProjetee: pan.aireProjetee, aireRampante: pan.aireRampante,
        supplementProjete: 0, supplementRampant: 0 });
      continue;
    }

    const contourUV = res.poly.map(pan.toLocal);
    const aireProj = area(res.poly);
    const aireRamp = area(contourUV);
    // portée rampante du pan mesurée dans son repère (v de l'égout au faîte)
    const vs = pan.contourUV.map((q) => q[1]);
    const portee = Math.max(...vs) - Math.min(...vs);
    const queue = dEgout / Math.cos(pan.pente * DEG);          // longueur de queue en rampant

    if (dEgout > 0 && (queue > portee * DEBORD_LIMITES.fractionPortee || dEgout > DEBORD_LIMITES.absolu)) {
      warnings.push({ code: 'PORTE_A_FAUX_EXCESSIF', panId: pan.id, sourceEdge: pan.sourceEdge,
        msg: `queue de ${queue.toFixed(2)} m rampant pour une portée de ${portee.toFixed(2)} m `
           + `(limite ${(portee * DEBORD_LIMITES.fractionPortee).toFixed(2)} m) — il faut un about ou un coyau` });
    }

    pans.push({
      id: pan.id, index: pan.index, sourceEdge: pan.sourceEdge, ok: true, msg: null,
      pente: pan.pente,
      debordEgout: dEgout,
      debordsRive: res.deplacees.filter((x) => x.empriseEdge !== pan.index)
        .map((x) => ({ empriseEdge: x.empriseEdge, sourceEdge: origin[x.empriseEdge], debord: x.debord })),
      contour: res.poly, contourUV,
      contourStructure: pan.contour, contourUVStructure: pan.contourUV,
      aireProjetee: aireProj, aireRampante: aireRamp,
      supplementProjete: aireProj - pan.aireProjetee,
      supplementRampant: aireRamp - pan.aireRampante,
      // l'égout descend de d·tanθ ; la rive reste à l'altitude du plan
      egoutY: -dEgout * tanT,
      queue, portee,
      vEgout: -queue,                                          // abscisse v de l'égout prolongé
    });
  }

  const audit = auditOverhang(model, pans, debords, erreurs, warnings, spec);
  return {
    ok: audit.ok, mode: typeof spec === "number" ? "uniforme" : (spec.mode ?? "libre"),
    debords, parPan: Object.fromEntries(pans.map((p) => [p.id, p])), pans,
    erreurs, warnings, audit,
    stats: {
      supplementProjete: pans.reduce((s, p) => s + p.supplementProjete, 0),
      supplementRampant: pans.reduce((s, p) => s + p.supplementRampant, 0),
      aireRampanteTotale: pans.reduce((s, p) => s + p.aireRampante, 0),
      mlEgout: pans.reduce((s, p) => s + longueurSur(p.contour, p.contourUV, 'bas'), 0),
      // dédoublonnage à 1e-6 (deux pans de même pente doivent compter pour UNE
      // altitude), mais on rend la valeur EXACTE, pas la valeur arrondie.
      altitudesEgout: [...new Map(pans.filter((p) => p.ok && p.debordEgout > 0)
        .map((p) => [p.egoutY.toFixed(6), p.egoutY])).values()],
    },
  };
}

/** Longueur du bord bas (v minimal) d'un contour en (u,v) — la ligne d'égout. */
function longueurSur(contour, uv, quoi = 'bas') {
  if (!uv || uv.length < 3) return 0;
  const vmin = Math.min(...uv.map((q) => q[1]));
  let L = 0;
  for (let i = 0, n = uv.length; i < n; i++) {
    const a = uv[i], b = uv[(i + 1) % n];
    if (Math.abs(a[1] - vmin) < 1e-6 && Math.abs(b[1] - vmin) < 1e-6) {
      L += Math.hypot(contour[(i + 1) % n][0] - contour[i][0], contour[(i + 1) % n][1] - contour[i][1]);
    }
  }
  return L;
}

// ── Audit ──────────────────────────────────────────────────────────────────

export function auditOverhang(model, pans, debords, erreurs, warnings, spec) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok, detail });

  add('D1_PANS_PROLONGES', erreurs.length === 0,
    erreurs.length === 0 ? `${pans.length} pan(s) prolongé(s)` : erreurs.map((e) => `${e.panId} : ${e.msg}`).join(' · '));

  // D2 · chaque contour prolongé est simple
  const pasSimples = pans.filter((p) => p.ok && hasSelfIntersect(p.contour));
  add('D2_CONTOURS_SIMPLES', pasSimples.length === 0,
    pasSimples.length === 0 ? 'aucun contour ne se recoupe' : pasSimples.map((p) => p.id).join(', '));

  // D3 · le pan d'origine est INCLUS dans son prolongement
  const dehors = [];
  for (const p of pans) {
    if (!p.ok) continue;
    for (const q of p.contourStructure) {
      if (!dansOuSur(q, p.contour, 1e-6)) { dehors.push(`${p.id}@${q.map((x) => x.toFixed(2))}`); break; }
    }
  }
  add('D3_INCLUSION', dehors.length === 0,
    dehors.length === 0 ? 'chaque pan structurel est contenu dans son prolongement' : dehors.join(', '));

  // D4 · les prolongements ne se recouvrent pas deux à deux
  const collisions = [];
  for (let i = 0; i < pans.length; i++) {
    for (let j = i + 1; j < pans.length; j++) {
      if (!pans[i].ok || !pans[j].ok) continue;
      if (recouvrement(pans[i].contour, pans[j].contour) > 1e-6) collisions.push(`${pans[i].id}×${pans[j].id}`);
    }
  }
  add('D4_SANS_RECOUVREMENT', collisions.length === 0,
    collisions.length === 0 ? 'les nappes prolongées ne se chevauchent pas'
      : `nappes qui se chevauchent : ${collisions.join(', ')} — débord trop grand dans un angle rentrant`);

  // D5 · la nappe est de niveau si on l'a demandée
  // `egoutY` n'existe pas sur un pan que le prolongement a refusé : D1 l'a déjà
  // dit, D5 n'a pas à planter par-dessus.
  const alts = [...new Set(pans.filter((p) => p.ok && p.debordEgout > 1e-9)
    .map((p) => +p.egoutY.toFixed(6)))];
  const veutNappe = typeof spec === 'object' && spec.mode === 'nappe';
  add('D5_NAPPE', !veutNappe || alts.length <= 1,
    alts.length === 0 ? 'aucun débord d\'égout'
      : alts.length === 1 ? `égouts coplanaires à ${alts[0].toFixed(3)} m`
      : `${alts.length} altitudes d'égout : ${alts.map((a) => a.toFixed(3)).join(', ')}${veutNappe ? ' — mode nappe demandé' : ' (mode libre)'}`);

  // D6 · porte-à-faux
  // Un message par pan devient illisible dès qu'il y en a huit — et c'est
  // toujours le MÊME message. On regroupe par texte et on nomme les pans.
  const paf = warnings.filter((w) => w.code === 'PORTE_A_FAUX_EXCESSIF');
  const groupes = new Map();
  for (const w of paf) (groupes.get(w.msg) ?? groupes.set(w.msg, []).get(w.msg)).push(w.panId);
  add('D6_PORTE_A_FAUX', paf.length === 0,
    paf.length === 0 ? 'tous les porte-à-faux sont admissibles'
      : [...groupes].map(([msg, ids]) =>
          `${ids.length === 1 ? ids[0] : `${ids.length} pans (${ids.join(', ')})`} : ${msg}`).join(' · '));

  // D7 · le supplément de surface est cohérent avec les débords demandés
  const supp = pans.reduce((s, p) => s + p.supplementRampant, 0);
  const dmax = Math.max(0, ...debords);
  const perim = pans.reduce((s, p) => s + (p.contourUVStructure ?? []).reduce((t, q, k, A) =>
    t + Math.hypot(A[(k + 1) % A.length][0] - q[0], A[(k + 1) % A.length][1] - q[1]), 0), 0);
  const borne = perim * dmax * 1.6 + 1e-6;
  add('D7_SUPPLEMENT_BORNE', supp >= -1e-9 && supp <= borne,
    `+${supp.toFixed(2)} m² rampant (borne ${borne.toFixed(2)} m²)`);

  const ok = checks.every((c) => c.ok);
  return { ok, checks, erreurs, warnings };
}

/**
 * Point intérieur OU sur le bord, à tolérance. `pointInPoly` seul ne suffit
 * pas : quand un débord vaut zéro, les sommets structurels tombent exactement
 * sur le bord du prolongement, où le test de parité n'est pas défini.
 */
function dansOuSur(q, poly, tol) {
  if (pointInPoly(q, poly)) return true;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    if (l2 < 1e-18) continue;
    let t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / l2;
    t = Math.max(0, Math.min(1, t));
    if (Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dz)) <= tol) return true;
  }
  return false;
}

/** Aire de recouvrement approchée de deux polygones, par bandes verticales. */
function recouvrement(A, B) {
  const xs = [...new Set([...A, ...B].map((p) => p[0]))].sort((a, b) => a - b);
  let S = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const x = (xs[i] + xs[i + 1]) / 2, w = xs[i + 1] - xs[i];
    if (w < 1e-12) continue;
    const a = spans(A, x), b = spans(B, x);
    for (const sa of a) for (const sb of b) {
      const lo = Math.max(sa[0], sb[0]), hi = Math.min(sa[1], sb[1]);
      if (hi - lo > 1e-9) S += (hi - lo) * w;
    }
  }
  return S;
}

function spans(poly, x) {
  const ys = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    if ((a[0] - x) * (b[0] - x) >= 0) continue;
    ys.push(a[1] + (x - a[0]) / (b[0] - a[0]) * (b[1] - a[1]));
  }
  ys.sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i + 1 < ys.length; i += 2) out.push([ys[i], ys[i + 1]]);
  return out;
}

// ── Application au modèle ──────────────────────────────────────────────────

/**
 * Renvoie une COPIE du modèle dont les pans portent leur contour prolongé.
 * On ne modifie pas le modèle d'origine : le contour structurel reste la
 * référence des pièces porteuses (pannes, fermes), le contour prolongé sert
 * aux pièces de rampant (chevrons, liteaux, couverture).
 */
export function appliquerDebords(model, ov) {
  const pans = model.pans.map((p) => {
    const o = ov.parPan[p.id];
    if (!o || !o.ok) return p;
    return { ...p,
      contourDebord: o.contour, contourUVDebord: o.contourUV,
      aireProjeteeDebord: o.aireProjetee, aireRampanteDebord: o.aireRampante,
      debordEgout: o.debordEgout, queue: o.queue, vEgout: o.vEgout, egoutY: o.egoutY,
      toLocal: p.toLocal, toWorld: p.toWorld, heightAt: p.heightAt };
  });
  const byId = { ...model.byId, pans: Object.fromEntries(pans.map((p) => [p.id, p])) };
  return { ...model, pans, byId, debords: ov,
    stats: { ...model.stats,
      aireRampanteDebord: ov.stats.aireRampanteTotale,
      supplementRampant: ov.stats.supplementRampant } };
}

/** Résumé lisible. */
export function describeOverhang(ov) {
  const L = [`débords · mode ${ov.mode} · ${ov.pans.length} pan(s)`];
  for (const p of ov.pans) {
    if (!p.ok) { L.push(`   ✗ ${p.id} — ${p.msg}`); continue; }
    L.push(`   ${p.id} (spec e${p.sourceEdge}) égout ${p.debordEgout.toFixed(2)} m `
      + `→ queue ${p.queue.toFixed(2)} m rampant, égout à ${p.egoutY.toFixed(3)} m `
      + `· +${p.supplementRampant.toFixed(2)} m²`
      + (p.debordsRive.length ? ` · rive ${p.debordsRive.map((x) => `e${x.sourceEdge}:${x.debord.toFixed(2)}`).join(' ')}` : ''));
  }
  L.push(`   total +${ov.stats.supplementRampant.toFixed(2)} m² rampant · ${ov.stats.mlEgout.toFixed(2)} ml d'égout`);
  for (const c of ov.audit.checks) L.push(`  ${c.ok ? '✓' : '✗'} ${c.id.padEnd(22)} ${c.detail}`);
  return L.join('\n');
}
