// ═══════════════════════════════════════════════════════════════════════════
// PANS, CLASSIFICATION DES ARÊTES, ET AUDIT DU SQUELETTE
//
// Trois choses :
//  1. `buildPanels`      — reconstruit le polygone de chaque pan depuis la
//                          topologie du squelette (chemin A).
//  2. `classifyEdges`    — reclasse chaque arête du squelette de façon EXACTE
//                          (faîtage / arêtier / noue / rive), par sondage du
//                          champ de hauteur de part et d'autre. Remplace
//                          l'heuristique `dot < −0,95` de l'original, qui est
//                          fausse dès que les pentes diffèrent.
//  3. `auditSkeleton`    — les 6 critères d'auto-validation, dont le test de
//                          PARTITION (Σ aires projetées = aire de l'emprise),
//                          qui attrape à lui seul l'essentiel des
//                          dégénérescences.
//
// Plus `lowerEnvelope` : ORACLE INDÉPENDANT pour les emprises convexes.
// Le champ de hauteur y est calculé analytiquement, sans aucun événement :
//        h(P) = min over {i : s_i > 0} de  (n_i · (P − A_i)) / s_i
// et les pans par découpe de demi-plans. Deux calculs indépendants qui
// doivent coïncider : c'est le harnais de test le plus solide qu'on puisse
// se donner sur cette brique.
//
// Porté depuis bimshow-vision (POC ciriani-santillana, module `audit`).
// ═══════════════════════════════════════════════════════════════════════════

import { signedArea, area, innerNormal, pointInPoly, clipHalfPlane, dedupe, bbox, centroid } from './geom2d.js';

// ── Plans support ──────────────────────────────────────────────────────────

/** Le plan porté par l'arête i. s = 0 ⇒ plan VERTICAL (pignon), pas de pan. */
export function planesOf(poly, weights) {
  const n = poly.length;
  return poly.map((A, i) => {
    const B = poly[(i + 1) % n];
    const nrm = innerNormal(A, B);
    const s = weights[i];
    return {
      edge: i, A, B, n: nrm, s,
      vertical: s === 0,
      /** hauteur du plan au point P (m). NaN si vertical. */
      h: s === 0
        ? () => NaN
        : (P) => (nrm[0] * (P[0] - A[0]) + nrm[1] * (P[1] - A[1])) / s,
      /** gradient horizontal de la hauteur (direction de plus grande pente) */
      grad: s === 0 ? [0, 0] : [nrm[0] / s, nrm[1] / s],
    };
  });
}

// ── 1 · Pans depuis la topologie ───────────────────────────────────────────

/** Soude les nœuds coïncidents (les split events en créent deux au même point). */
export function weldNodes(skel, tol = 1e-7) {
  const map = new Array(skel.nodes.length);
  const reps = [];
  for (let i = 0; i < skel.nodes.length; i++) {
    const n = skel.nodes[i];
    let found = -1;
    for (const r of reps) {
      const m = skel.nodes[r];
      if (Math.hypot(m.x - n.x, m.z - n.z) <= tol && Math.abs(m.t - n.t) <= tol) { found = r; break; }
    }
    if (found >= 0) map[i] = found; else { map[i] = i; reps.push(i); }
  }
  return map;
}

/**
 * Polygone de chaque pan. Un pan par arête de l'emprise (invariant du
 * squelette droit) ; un pan de pignon a une aire projetée nulle.
 */
export function buildPanels(skel) {
  const weld = weldNodes(skel);
  const N = skel.poly.length;
  const panels = [];

  for (let i = 0; i < N; i++) {
    const segs = [];
    const ev = skel.eaves[i];
    segs.push([weld[ev.a], weld[ev.b]]);
    for (const e of skel.edges) {
      if (!e.pans || !e.pans.includes(i)) continue;
      const a = weld[e.a], b = weld[e.b];
      if (a !== b) segs.push([a, b]);
    }
    // dédoublonne les segments identiques
    const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const uniq = new Map();
    for (const [a, b] of segs) if (a !== b) uniq.set(key(a, b), [a, b]);
    const list = [...uniq.values()];

    const adj = new Map();
    for (const [a, b] of list) {
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b); adj.get(b).push(a);
    }

    let ring = null, malformed = null;
    const degs = [...adj.values()].map((v) => v.length);
    if (list.length < 3 || degs.some((d) => d !== 2)) {
      malformed = { nSegs: list.length, degres: degs };
    } else {
      ring = [];
      const start = weld[ev.a];
      let prev = -1, cur = start, guard = 0;
      do {
        ring.push(cur);
        const nb = adj.get(cur);
        const nxt = nb[0] !== prev ? nb[0] : nb[1];
        prev = cur; cur = nxt;
      } while (cur !== start && guard++ < list.length + 4);
      if (cur !== start) { malformed = { code: 'CYCLE_OUVERT' }; ring = null; }
    }

    const pts = ring ? dedupe(ring.map((id) => [skel.nodes[id].x, skel.nodes[id].z])) : [];
    const a2 = pts.length >= 3 ? signedArea(pts) : 0;
    panels.push({
      edge: i,
      kind: skel.weights[i] === 0 ? 'pignon' : 'pan',
      pente: skel.weights[i] === 0 ? 90 : Math.atan(1 / skel.weights[i]) * 180 / Math.PI,
      nodeIds: ring, poly: pts,
      aireProjetee: Math.abs(a2),
      aireRampante: skel.weights[i] === 0 ? 0
        : Math.abs(a2) * Math.hypot(1, 1 / skel.weights[i]),   // /cos θ
      malformed,
    });
  }
  return panels;
}

// ── 2 · Classification exacte des arêtes ───────────────────────────────────

/**
 * Reclasse chaque arête du squelette par sondage du champ de hauteur.
 *   faitage : l'arête est un MAXIMUM local en travers  (les 2 pans descendent)
 *   noue    : l'arête est un MINIMUM local en travers  (les 2 pans montent)
 *   aretier : traversée monotone
 *   rive    : l'un des deux pans est un pignon (plan vertical)
 */
/** Écart maximal à l'anti-parallélisme sous lequel deux égouts « se font face ». */
export const SEUIL_EN_FACE_DEG = 30;
const COS_SEUIL_EN_FACE = Math.cos(SEUIL_EN_FACE_DEG * Math.PI / 180);

/**
 * Nature de chaque type d'arête, et l'ouvrage qui va avec. C'est cette table
 * qui justifie de distinguer un faîtage rampant d'un arêtier : ce ne sont pas
 * les mêmes pièces, ni le même métré.
 */
export const EDGE_KINDS = {
  egout:           { famille: 'bas',   ouvrage: 'gouttière / bandeau' },
  arase_pignon:    { famille: 'bas',   ouvrage: 'arase de mur' },
  rive:            { famille: 'bord',  ouvrage: 'rive rampante (planche de rive)' },
  rive_haute:      { famille: 'bord',  ouvrage: 'rive haute' },
  faitage:         { famille: 'crete', ouvrage: 'faîtière + closoir' },
  faitage_rampant: { famille: 'crete', ouvrage: 'faîtière + closoir — posée en rampant' },
  aretier:         { famille: 'crete', ouvrage: 'capot d\'arêtier + closoir' },
  cheneau:         { famille: 'creux', ouvrage: 'chéneau (avec évacuation)' },
  cheneau_rampant: { famille: 'creux', ouvrage: 'chéneau en pente' },
  noue:            { famille: 'creux', ouvrage: 'noue métal ou tuiles à noue' },
};

export function classifyEdges(skel, panels, planes) {
  const out = [];
  for (const e of skel.edges) {
    const A = skel.nodes[e.a], B = skel.nodes[e.b];
    const ex = B.x - A.x, ez = B.z - A.z;
    const L = Math.hypot(ex, ez);
    const [i, j] = e.pans ?? [null, null];
    const rec = { ...e, longueur: L, pans: [i, j] };

    // Arête de longueur nulle : artefact d'effondrement d'un pignon. On la
    // marque et l'appelant la filtre — jamais de pièce de bois de longueur 0.
    if (L < 1e-7) { rec.kind = 'degenere'; rec.classified = false; out.push(rec); continue; }
    if (i == null || j == null || i === j) { rec.kind = e.kind; rec.classified = false; out.push(rec); continue; }

    const dt = Math.abs(B.t - A.t);
    const horizontale = dt <= Math.max(1e-6, L * 1e-4);

    const pi = planes[i], pj = planes[j];
    if (pi.vertical || pj.vertical) {
      // un pan contre un plan vertical : rive rampante, ou rive haute si horizontale
      rec.kind = horizontale ? 'rive_haute' : 'rive';
      rec.horizontale = horizontale; rec.classified = true; out.push(rec); continue;
    }

    const M = [(A.x + B.x) / 2, (A.z + B.z) / 2];
    const p = [-ez / L, ex / L];                       // perpendiculaire unitaire
    const eps = Math.max(1e-4, L * 1e-3);
    const Pplus = [M[0] + p[0] * eps, M[1] + p[1] * eps];

    // de quel côté est le pan i ?
    let sigmaI = 0;
    if (panels[i].poly.length >= 3) sigmaI = pointInPoly(Pplus, panels[i].poly) ? +1 : -1;
    if (sigmaI === 0 && panels[j].poly.length >= 3) sigmaI = pointInPoly(Pplus, panels[j].poly) ? -1 : +1;
    if (sigmaI === 0) sigmaI = +1;

    // variation de hauteur en entrant dans chaque pan
    const dI = sigmaI * (pi.grad[0] * p[0] + pi.grad[1] * p[1]);
    const dJ = -sigmaI * (pj.grad[0] * p[0] + pj.grad[1] * p[1]);

    // ── CE QUI SÉPARE UN FAÎTAGE D'UN ARÊTIER ──────────────────────────────
    // Ce n'est PAS l'horizontalité, et ce n'est pas la convexité.
    //
    // Deux pans dont les égouts sont (quasi) ANTI-PARALLÈLES se font face :
    // leur ligne de crête est un FAÎTAGE, et elle n'est horizontale que si les
    // égouts sont exactement parallèles. Dès qu'un mur est évasé — un cas
    // banal, et de surcroît l'échappatoire à la dégénérescence de fronts
    // parallèles de S10 — le faîtage devient RAMPANT. Il reste un faîtage :
    // il prend une faîtière, pas un capot d'arêtier, et le métré doit le
    // compter dans la bonne ligne.
    //
    // Deux pans dont les égouts se coupent en un coin donnent un ARÊTIER
    // (crête) ou une NOUE (creux), inclinés par nature.
    //
    // Le seuil est un choix de VOCABULAIRE, pas de géométrie : il n'existe pas
    // d'angle où un faîtage devient physiquement un arêtier. On le pose à 30°
    // d'écart à l'anti-parallélisme, on l'expose (`seuilEnFace`) et on rend
    // l'angle mesuré sur chaque arête (`angleEgouts`) pour que rien ne soit caché.
    const uI = skel.dirs[i], uJ = skel.dirs[j];
    let enFace = false, angleEgouts = null;
    if (uI && uJ) {
      const c = uI[0] * uJ[0] + uI[1] * uJ[1];
      angleEgouts = Math.acos(Math.min(1, Math.max(-1, c))) * 180 / Math.PI;
      enFace = c <= -COS_SEUIL_EN_FACE;                 // égouts à moins de 30° de l'anti-parallèle
    }

    const TOL = 1e-9;
    if (dI < -TOL && dJ < -TOL) {
      rec.kind = enFace ? (horizontale ? 'faitage' : 'faitage_rampant') : 'aretier';
    } else if (dI > TOL && dJ > TOL) {
      rec.kind = enFace ? (horizontale ? 'cheneau' : 'cheneau_rampant') : 'noue';
    } else rec.kind = 'aretier';
    rec.famille = (dI < -TOL && dJ < -TOL) ? 'crete' : (dI > TOL && dJ > TOL) ? 'creux' : 'crete';
    rec.enFace = enFace;
    rec.angleEgouts = angleEgouts;
    rec.horizontale = horizontale;
    rec.classified = true;
    rec.variation = { versI: dI, versJ: dJ };
    rec.diedre = dihedral(pi, pj);   // pour closoir, capot d'arêtier, noue métal
    out.push(rec);
  }
  return out;
}

/** Angle dièdre (degrés) entre les deux plans de toiture. 180° = coplanaire. */
function dihedral(pi, pj) {
  // normale 3D du plan de hauteur h = (n·(P−A))/s  →  z = ax+bz+c  →  normale (−a, 1, −b) normalisée
  const N = (p) => {
    const a = p.grad[0], b = p.grad[1];
    const l = Math.hypot(a, 1, b);
    return [-a / l, 1 / l, -b / l];
  };
  const u = N(pi), v = N(pj);
  const d = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]));
  return 180 - Math.acos(d) * 180 / Math.PI;
}

// ── 3 · Oracle indépendant : enveloppe inférieure (emprises CONVEXES) ──────

/** L'emprise est-elle convexe ? (tous les angles intérieurs ≤ 180°) */
export function isConvex(poly, tol = 1e-9) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n], b = poly[i], c = poly[(i + 1) % n];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -tol) return false;
  }
  return true;
}

/**
 * Pans par découpe de demi-plans + champ de hauteur analytique.
 * VALIDE UNIQUEMENT SI L'EMPRISE EST CONVEXE (sinon min-de-plans ≠ toiture).
 */
export function lowerEnvelope(poly, weights) {
  if (!isConvex(poly)) throw new Error('lowerEnvelope : emprise non convexe — oracle non applicable');
  const planes = planesOf(poly, weights);
  const actifs = planes.filter((p) => !p.vertical);
  if (actifs.length === 0) throw new Error('lowerEnvelope : aucun pan');

  const panels = planes.map((pi) => {
    if (pi.vertical) return { edge: pi.edge, kind: 'pignon', poly: [], aireProjetee: 0 };
    let region = poly.map((p) => [p[0], p[1]]);
    for (const pj of actifs) {
      if (pj.edge === pi.edge) continue;
      // h_i ≤ h_j  ⟺  P·(n_i/s_i − n_j/s_j) + (−n_i·A_i/s_i + n_j·A_j/s_j) ≤ 0
      const nx = pi.n[0] / pi.s - pj.n[0] / pj.s;
      const nz = pi.n[1] / pi.s - pj.n[1] / pj.s;
      const c = -(pi.n[0] * pi.A[0] + pi.n[1] * pi.A[1]) / pi.s
              + (pj.n[0] * pj.A[0] + pj.n[1] * pj.A[1]) / pj.s;
      region = clipHalfPlane(region, nx, nz, c);
      if (region.length === 0) break;
    }
    const pts = dedupe(region);
    return { edge: pi.edge, kind: 'pan', poly: pts, aireProjetee: pts.length >= 3 ? area(pts) : 0 };
  });

  const heightAt = (P) => {
    let h = Infinity;
    for (const p of actifs) h = Math.min(h, p.h(P));
    return h;
  };
  return { planes, panels, heightAt, faite: Math.max(...poly.map(() => 0), ...panels.flatMap((p) => p.poly.map(heightAt))) };
}

// ── 4 · Audit ──────────────────────────────────────────────────────────────

/**
 * Les 6 critères d'auto-validation de sortie, version pondérée.
 * @returns { ok, checks: [{ id, ok, detail }] }
 */
export function auditSkeleton(skel, panels, opts = {}) {
  const checks = [];
  const poly = skel.poly, W = skel.weights;
  const nPans = W.filter((s) => s > 0).length;
  const aireEmprise = area(poly);
  const tolAire = opts.tolAire ?? Math.max(1e-4, aireEmprise * 1e-6);

  // C1 — un pan par arête à poids non nul
  const bons = panels.filter((p) => p.kind === 'pan' && !p.malformed && p.aireProjetee > 1e-9);
  checks.push({
    id: 'C1_UN_PAN_PAR_ARETE', ok: bons.length === nPans,
    detail: `${bons.length} pan(s) reconstruit(s) pour ${nPans} arête(s) à poids non nul`,
  });

  // C2 — pans de pignon d'aire projetée nulle
  const pignonsSales = panels.filter((p) => p.kind === 'pignon' && p.aireProjetee > 1e-6);
  checks.push({
    id: 'C2_PIGNONS_PLATS', ok: pignonsSales.length === 0,
    detail: pignonsSales.length ? `pignons d'aire non nulle : ${pignonsSales.map((p) => p.edge)}` : 'ok',
  });

  // C3 — PARTITION : Σ aires projetées = aire de l'emprise
  const somme = panels.reduce((s, p) => s + p.aireProjetee, 0);
  const ecart = Math.abs(somme - aireEmprise);
  checks.push({
    id: 'C3_PARTITION', ok: ecart <= tolAire,
    detail: `Σ aires projetées = ${somme.toFixed(6)} m² · emprise = ${aireEmprise.toFixed(6)} m² · écart = ${ecart.toExponential(2)} m²`,
  });

  // C4 — autant de noues que de sommets rentrants ACTIFS (deux arêtes à poids non nul)
  const n = poly.length;
  let reflexActifs = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n], b = poly[i], c = poly[(i + 1) % n];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cr < -1e-9 && W[(i - 1 + n) % n] > 0 && W[i] > 0) reflexActifs++;
  }
  const noues = (opts.edges ?? skel.edges).filter((e) => e.kind === 'noue' || e.kind === 'valley').length;
  checks.push({
    id: 'C4_NOUES', ok: noues >= reflexActifs,
    detail: `${noues} noue(s) pour ${reflexActifs} sommet(s) rentrant(s) actif(s)`,
  });

  // C5 — hauteur bornée : t ≤ max_i (diagonale / s_i)
  const bb = bbox(poly);
  const sMin = Math.min(...W.filter((s) => s > 0));
  const tMax = Math.max(...skel.nodes.map((nd) => nd.t));
  const borne = bb.diag / sMin;
  checks.push({
    id: 'C5_HAUTEUR_BORNEE', ok: tMax <= borne + 1e-6,
    detail: `t max = ${tMax.toFixed(4)} m · borne = ${borne.toFixed(4)} m`,
  });

  // C6 — aucun nœud frontière orphelin
  const relies = new Set();
  for (const e of skel.edges) { relies.add(e.a); relies.add(e.b); }
  const orphelins = [];
  for (let i = 0; i < poly.length; i++) if (!relies.has(i)) orphelins.push(i);
  checks.push({
    id: 'C6_PAS_D_ORPHELIN', ok: orphelins.length === 0,
    detail: orphelins.length ? `nœuds frontière orphelins : ${orphelins}` : 'ok',
  });

  // C7 — la boucle d'événements n'a pas été tronquée
  checks.push({
    id: 'C7_CONVERGENCE', ok: !skel.truncated,
    detail: `${skel.iterations} itération(s)${skel.truncated ? ' — TRONQUÉ' : ''}`,
  });

  // C8 — COHÉRENCE PAN / PLAN : chaque nœud d'un pan est SUR le plan de ce pan.
  //   C'est le critère qui attrape ce que la partition laisse passer : un nœud
  //   à la mauvaise altitude (ordre de traitement des événements simultanés)
  //   partitionne toujours correctement en projection, mais flotte au-dessus
  //   ou sous son plan. Sans C8, un faîte à +5,95 m au lieu de +2,45 m passe.
  const planes = opts.planes ?? planesOf(poly, W);
  let pireEcart = 0, coupable = null;
  for (const p of panels) {
    if (p.kind !== 'pan' || !p.nodeIds) continue;
    const pl = planes[p.edge];
    if (pl.vertical) continue;
    for (const id of p.nodeIds) {
      const nd = skel.nodes[id];
      const d = Math.abs(pl.h([nd.x, nd.z]) - nd.t);
      if (d > pireEcart) { pireEcart = d; coupable = { pan: p.edge, node: id, t: nd.t, hPlan: pl.h([nd.x, nd.z]) }; }
    }
  }
  const tolPlan = opts.tolPlan ?? 1e-6;
  checks.push({
    id: 'C8_NOEUDS_SUR_PLAN', ok: pireEcart <= tolPlan,
    detail: pireEcart <= tolPlan ? `écart max ${pireEcart.toExponential(2)} m`
      : `nœud ${coupable.node} du pan e${coupable.pan} : t = ${coupable.t.toFixed(4)} m mais le plan donne ${coupable.hPlan.toFixed(4)} m`,
  });

  // ── C9 · LE MOTEUR DIT CE QU'IL N'A PAS SU FAIRE ────────────────────────
  // Avant, une boucle de front d'onde que rien ne résolvait était fermée par le
  // barycentre de ses sommets, à l'altitude la plus tardive. C'était une
  // invention : C8 signalait ensuite un nœud hors plan, sans jamais dire d'où
  // il venait. Le moteur ne pose plus ce nœud ; il nomme la boucle, ses arêtes
  // et la raison. C1 et C3 restent rouges — les pans sont bel et bien
  // incomplets — mais c'est C9 qu'il faut lire en premier.
  const nr = skel.nonResolu ?? [];
  checks.push({
    id: 'C9_BOUCLES_RESOLUES', ok: nr.length === 0,
    detail: nr.length === 0
      ? `${(skel.bouclesFermees ?? []).length} fermeture(s) de boucle, toutes exactes`
      : nr.map((b) => b.msg).join(' · '),
    cause: nr.length ? nr[0].cause : undefined,
    // Remède MESURÉ, pas suggéré : la dégénérescence est de mesure nulle.
    // Évaser un mur de 0,05° (12 mm sur 13,6 m) la fait disparaître, parce que
    // la crête cesse d'être horizontale et que les trois plans se coupent alors
    // en un point. Égaliser deux pentes opposées marche aussi, sans toucher à
    // l'emprise. Les deux sont vérifiés par les tests S12-F et S12-G.
    fixLabel: nr.length
      ? 'évaser un des murs opposés d\'une fraction de degré (0,05° suffit), '
        + 'ou égaliser les pentes de deux fronts opposés'
      : undefined,
  });

  return { ok: checks.every((c) => c.ok), checks, aireEmprise, sommeAires: somme, tMax,
           nonResolu: nr };
}
