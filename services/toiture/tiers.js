// ═══════════════════════════════════════════════════════════════════════════
// S6 — POIDS VARIABLE DANS LE TEMPS : le mécanisme M2
//
// Une arête dont la pente CHANGE à une altitude donnée. Un seul mécanisme,
// cinq typologies du registre :
//
//   mansard_2pans / mansard_4pans   brisis raide en bas, terrasson doux en haut
//   demi_croupe (jerkinhead)        pignon en bas, croupe en haut
//   croupe_hollandaise              croupe en bas, pignon en haut
//   pagode                          plusieurs paliers de pente croissante
//
// ── POURQUOI EN ÉTAGES, ET NON DANS LA BOUCLE D'ÉVÉNEMENTS ─────────────────
// On pourrait ajouter un troisième type d'événement (« palier ») qui change
// W[i] en cours de propagation. Mais l'arête engendrerait alors DEUX facettes
// pour un seul index de pan, et tout l'invariant « un pan par arête » — dont
// dépendent l'identité stable (S3) et l'audit C1 — s'effondrerait.
//
// À la place : on découpe en ÉTAGES. Chaque étage est un anneau entre l'emprise
// courante et son offset à la hauteur du palier, et l'étage suivant repart de
// cet offset avec les nouvelles pentes. Le moteur S1 est réutilisé tel quel
// pour le dernier étage, et chaque facette reste un pan à part entière.
//
// L'offset est le MITRE exact : chaque arête recule de s_i·h le long de sa
// normale intérieure, et les droites décalées consécutives se réintersectent.
// C'est la position du front d'onde à la hauteur h, par définition.
//
// @coords  mètres · Pt2 = [x, z] · h = hauteur au-dessus de l'égout
//
// Porté depuis bimshow-vision (POC ciriani-santillana, module `tiers`).
// ═══════════════════════════════════════════════════════════════════════════

import { buildRoof } from './build-roof.js';
import { cotDeg } from './edge-modes.js';
import { signedArea, area, hasSelfIntersect, edgeDir, pointInPoly } from './geom2d.js';

const DEG = Math.PI / 180;

/**
 * Polygone du front d'onde à la hauteur h (offset mitré pondéré).
 * @returns {{ ok, poly, degenerees, msg }}
 */
export function offsetPolygon(poly, weights, h) {
  const n = poly.length;
  const dirs = poly.map((a, i) => edgeDir(a, poly[(i + 1) % n]));
  // droite décalée de l'arête i : point A_i' et direction u_i
  const A = poly.map((P, i) => {
    const u = dirs[i], nx = -u[1], nz = u[0];        // normale intérieure (CCW)
    const d = weights[i] * h;
    return [P[0] + nx * d, P[1] + nz * d];
  });
  const out = [];
  const degenerees = [];
  for (let j = 0; j < n; j++) {
    const iL = (j - 1 + n) % n, iR = j;
    const p = interDroites(A[iL], dirs[iL], A[iR], dirs[iR]);
    if (!p) {
      // arêtes colinéaires : même droite décalée si les poids sont égaux
      if (Math.abs(weights[iL] - weights[iR]) < 1e-9) { out.push(A[iR]); continue; }
      degenerees.push(j);
      out.push(A[iR]);
      continue;
    }
    out.push(p);
  }
  if (degenerees.length) {
    return { ok: false, poly: out, degenerees,
      msg: `Sommet(s) ${degenerees.join(', ')} à 180° entre deux poids différents : `
         + `un étage ne peut pas commencer sur une limite de pan (traiter la coupe dans l'étage du dessus).` };
  }
  // Le front d'onde doit RÉTRÉCIR et rester DEDANS. Un offset mitré poussé
  // trop loin se retourne, puis se retourne encore : à h = 10 m sur un
  // rectangle 12×8, l'aire signée redevient positive (340 m² pour 96 m²
  // d'emprise) et les seuls tests d'aire et d'auto-intersection le laissent
  // passer. Il faut vérifier l'inclusion.
  const A0 = area(poly), A1 = area(out);
  if (signedArea(out) <= 0 || A1 >= A0 - 1e-9) {
    return { ok: false, poly: out, degenerees,
      msg: `Le front d'onde ne rétrécit plus à ${h.toFixed(2)} m (${A1.toFixed(2)} m² pour ${A0.toFixed(2)} m² d'emprise) — palier trop haut.` };
  }
  if (hasSelfIntersect(out)) {
    return { ok: false, poly: out, degenerees, msg: `Le front d'onde se recoupe à ${h.toFixed(2)} m — palier trop haut pour cette emprise.` };
  }
  const dehors = out.filter((q) => !pointInPoly(q, poly) && distBord(q, poly) > 1e-6);
  if (dehors.length) {
    return { ok: false, poly: out, degenerees,
      msg: `Le front d'onde sort de l'emprise à ${h.toFixed(2)} m (${dehors.length} sommet(s)) — palier trop haut.` };
  }
  if (A1 < Math.max(0.25, A0 * 0.01)) {
    return { ok: false, poly: out, degenerees,
      msg: `Il ne resterait que ${A1.toFixed(2)} m² au-dessus de ${h.toFixed(2)} m — palier trop proche du faîte.` };
  }
  return { ok: true, poly: out, degenerees: [], msg: null };
}

function distBord(p, poly) {
  let d = Infinity;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    let t = l2 < 1e-18 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2;
    t = Math.max(0, Math.min(1, t));
    d = Math.min(d, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz)));
  }
  return d;
}

function interDroites(P, u, Q, v) {
  const den = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((Q[0] - P[0]) * v[1] - (Q[1] - P[1]) * v[0]) / den;
  return [P[0] + u[0] * t, P[1] + u[1] * t];
}

// ── Presets M2 ─────────────────────────────────────────────────────────────

const p = (pente) => (pente >= 90 ? { mode: 'pignon' } : { mode: 'croupe', pente });

/** Comble à la Mansart : brisis raide puis terrasson doux, sur les côtés choisis. */
export function mansard({ n, brisis = 70, terrasson = 30, hBrisis = 2.0, pignons = [] }) {
  const set = new Set(pignons);
  return {
    paliers: [hBrisis],
    etages: [
      Array.from({ length: n }, (_, i) => (set.has(i) ? p(90) : p(brisis))),
      Array.from({ length: n }, (_, i) => (set.has(i) ? p(90) : p(terrasson))),
    ],
  };
}

/** Demi-croupe (croupette / jerkinhead) : pignon en bas, croupe au-dessus. */
export function demiCroupe({ n, pente = 40, hPignon = 1.2, cotes = [] }) {
  const set = new Set(cotes);
  return {
    paliers: [hPignon],
    etages: [
      Array.from({ length: n }, (_, i) => (set.has(i) ? p(90) : p(pente))),
      Array.from({ length: n }, () => p(pente)),
    ],
  };
}

/** Croupe hollandaise : croupe en bas, pignon écrêté au-dessus. */
export function croupeHollandaise({ n, pente = 40, hCroupe = 2.2, cotes = [] }) {
  const set = new Set(cotes);
  return {
    paliers: [hCroupe],
    etages: [
      Array.from({ length: n }, () => p(pente)),
      Array.from({ length: n }, (_, i) => (set.has(i) ? p(90) : p(pente))),
    ],
  };
}

/** Pagode : pentes décroissantes par paliers (toit retroussé). */
export function pagode({ n, pentes = [55, 42, 30], hauteurs = [1.0, 2.0] }) {
  return {
    paliers: hauteurs,
    etages: pentes.map((pe) => Array.from({ length: n }, () => p(pe))),
  };
}

// ── Construction étagée ────────────────────────────────────────────────────

/**
 * @param footprint  emprise CCW en mètres
 * @param plan       { paliers: [h1, h2, …], etages: [specs0, specs1, …] }
 *                   `etages` compte un élément de plus que `paliers`.
 * @returns { ok, etages, sommet, audit }
 *   etages[k] = { h0, h1, poly, polyHaut, facettes[], roof? }
 *   Le dernier étage porte un `roof` complet (résultat de buildRoof).
 */
export function buildTieredRoof(footprint, plan, opts = {}) {
  const baseY = opts.baseY ?? 0;
  const limits = opts.limits;
  const { paliers, etages: specsParEtage } = plan;
  if (specsParEtage.length !== paliers.length + 1) {
    throw new Error(`buildTieredRoof : ${specsParEtage.length} étages pour ${paliers.length} palier(s) — il en faut un de plus`);
  }
  for (let k = 1; k < paliers.length; k++) {
    if (!(paliers[k] > paliers[k - 1])) throw new Error('buildTieredRoof : les paliers doivent être strictement croissants');
  }

  const etages = [];
  const erreurs = [];
  let poly = footprint.map((q) => [q[0], q[1]]);
  if (signedArea(poly) < 0) poly = [...poly].reverse();
  let h0 = 0;

  for (let k = 0; k < paliers.length; k++) {
    const specs = specsParEtage[k];
    const w = specs.map((s) => (s.mode === 'pignon' ? 0 : cotDeg(s.pente)));
    const dh = paliers[k] - h0;
    const off = offsetPolygon(poly, w, dh);
    if (!off.ok) { erreurs.push({ etage: k, msg: off.msg }); break; }

    // facettes de l'anneau : un trapèze par arête, entre l'emprise et son offset
    const n = poly.length;
    const facettes = [];
    for (let i = 0; i < n; i++) {
      const quad = [poly[i], poly[(i + 1) % n], off.poly[(i + 1) % n], off.poly[i]];
      const a = area(quad);
      const pente = specs[i].mode === 'pignon' ? 90 : specs[i].pente;
      facettes.push({
        edge: i, sourceEdge: i, kind: specs[i].mode === 'pignon' ? 'pignon' : 'pan',
        pente, contour: quad,
        aireProjetee: specs[i].mode === 'pignon' ? 0 : a,
        aireRampante: specs[i].mode === 'pignon' ? 0 : a / Math.cos(pente * DEG),
        h0: baseY + h0, h1: baseY + paliers[k],
      });
    }
    etages.push({
      index: k, h0: baseY + h0, h1: baseY + paliers[k],
      poly, polyHaut: off.poly, facettes,
      brisis: off.poly.map((q, i) => ({ p1: [q[0], baseY + paliers[k], q[1]],
        p2: [off.poly[(i + 1) % n][0], baseY + paliers[k], off.poly[(i + 1) % n][1]],
        longueur: Math.hypot(off.poly[(i + 1) % n][0] - q[0], off.poly[(i + 1) % n][1] - q[1]) })),
      specs,
    });
    poly = off.poly;
    h0 = paliers[k];
  }

  // dernier étage : le moteur S1 tel quel
  let roof = null;
  if (!erreurs.length) {
    roof = buildRoof(poly, specsParEtage[specsParEtage.length - 1], { baseY: baseY + h0, limits });
    etages.push({
      index: etages.length, h0: baseY + h0, h1: null,
      poly, polyHaut: null,
      facettes: (roof.panels ?? []).map((q) => ({ ...q, contour: q.poly, h0: baseY + h0 })),
      brisis: [], roof, specs: specsParEtage[specsParEtage.length - 1],
    });
  }

  const audit = auditTiers(footprint, etages, roof, erreurs, baseY);
  return { ok: audit.ok, etages, roof, erreurs, sommet: roof?.audit ? baseY + h0 + roof.audit.tMax : null, audit };
}

function auditTiers(footprint, etages, roof, erreurs, baseY) {
  const checks = [];
  checks.push({ id: 'M1_ETAGES_CONSTRUITS', ok: erreurs.length === 0,
    detail: erreurs.length ? erreurs.map((e) => `étage ${e.etage} : ${e.msg}`).join(' · ') : `${etages.length} étage(s)` });

  // M2 — PARTITION GLOBALE : Σ aires projetées de toutes les facettes = emprise
  const somme = etages.reduce((s, e) => s + e.facettes.reduce((t, f) => t + (f.aireProjetee ?? 0), 0), 0);
  const A = area(footprint);
  checks.push({ id: 'M2_PARTITION_GLOBALE', ok: Math.abs(somme - A) <= Math.max(1e-4, A * 1e-6),
    detail: `Σ aires projetées = ${somme.toFixed(4)} m² · emprise = ${A.toFixed(4)} m²` });

  // M3 — le dernier étage passe son propre audit S1
  checks.push({ id: 'M3_SOMMET_VALIDE', ok: !!roof?.ok,
    // `buildRoof` rend `audit: null` quand c'est la VALIDATION qui a échoué —
    // il n'y a alors aucun audit à lire. Défaut latent de S6, mis au jour par
    // une emprise de lucarne de 2 × 2 m (sous l'aire minimale par défaut).
    detail: !roof ? 'non construit'
      : roof.ok ? 'ok'
      : roof.audit ? roof.audit.checks.filter((c) => !c.ok).map((c) => c.id).join(', ')
      : `validation : ${(roof.validation?.errors ?? []).map((e) => e.code).join(', ') || 'refusée'}` });

  // M4 — continuité : le polygone haut d'un étage est le polygone bas du suivant
  let discontinu = 0;
  for (let k = 0; k + 1 < etages.length; k++) {
    const a = etages[k].polyHaut, b = etages[k + 1].poly;
    if (!a || !b || a.length !== b.length) { discontinu++; continue; }
    for (let i = 0; i < a.length; i++) if (Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]) > 1e-9) discontinu++;
  }
  checks.push({ id: 'M4_CONTINUITE', ok: discontinu === 0,
    detail: discontinu ? `${discontinu} discordance(s) entre étages` : 'ok' });

  // M5 — chaque brisis est horizontal et fermé
  const brisis = etages.flatMap((e) => e.brisis);
  checks.push({ id: 'M5_BRISIS_FERMES', ok: brisis.every((b) => Math.abs(b.p1[1] - b.p2[1]) < 1e-9),
    detail: `${brisis.length} segment(s) de brisis · ${brisis.reduce((s, b) => s + b.longueur, 0).toFixed(2)} ml` });

  return { ok: checks.every((c) => c.ok), checks, aireEmprise: A, sommeAires: somme };
}

/** Résumé lisible. */
export function describeTiers(r) {
  const L = [];
  for (const e of r.etages) {
    const pans = e.facettes.filter((f) => (f.aireProjetee ?? 0) > 1e-9);
    const h = e.h1 === null ? `${e.h0.toFixed(2)} m → sommet` : `${e.h0.toFixed(2)} → ${e.h1.toFixed(2)} m`;
    L.push(`étage ${e.index} · ${h} · ${pans.length} pan(s) · ${pans.reduce((s, f) => s + f.aireProjetee, 0).toFixed(2)} m² projeté`
      + (e.brisis.length ? ` · brisis ${e.brisis.reduce((s, b) => s + b.longueur, 0).toFixed(2)} ml` : ''));
    for (const f of pans) L.push(`        pan e${f.edge} — ${f.pente.toFixed(0)}° — ${f.aireProjetee.toFixed(2)} m²`);
  }
  if (r.sommet !== null) L.push(`sommet ${r.sommet.toFixed(3)} m`);
  for (const c of r.audit.checks) L.push(`  ${c.ok ? '✓' : '✗'} ${c.id.padEnd(22)} ${c.detail}`);
  return L.join('\n');
}
