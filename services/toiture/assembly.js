// ═══════════════════════════════════════════════════════════════════════════
// AGRÉGAT DE TOITURES — une toiture est un ENSEMBLE de toitures raccordées
//
// POURQUOI C'EST UNE COUCHE À PART, ET NON UN PARAMÉTRAGE DU MOTEUR S1
// ────────────────────────────────────────────────────────────────────────
// Deux 4-pans accolés avec chéneau intermédiaire ne sont PAS le squelette de
// la réunion des deux emprises. L'union de deux rectangles jointifs est un
// rectangle, dont le squelette droit donne UN faîtage — pas deux toitures et
// une noue centrale. Le chéneau est une ligne INTÉRIEURE à l'emprise, et le
// squelette droit d'un polygone simple n'a jamais d'égout intérieur : tous ses
// égouts sont sur le bord. Aucun jeu de poids ne peut le produire.
//
// L'agrégat est donc un niveau au-dessus :
//     unités  →  chacune passe par le moteur S1 (ou le mode terrasse)
//     jonctions  →  résolues APRÈS, sur les segments d'emprise partagés
//
// C'est aussi ce qui débloque, sans écrire de générateur :
//   · toiture_papillon / noue_centrale   (2 monopentes + chéneau axial)
//   · toitures_etagees                   (2 unités à baseY différents + solin)
//   · creole_varangue                    (corps + auvent à pente cassée)
//   · dents_de_scie / shed               (N monopentes + N−1 chéneaux)
//   · « rassemblées par un toit terrasse » (N unités pente + 1 unité terrasse)
//
// @coords  Mètres. Pt2 = [x, z] en plan · baseY = altitude d'arase (m).
//
// Porté depuis bimshow-vision (POC ciriani-santillana, module `assembly`) —
// dépendance du moteur `agregat` de shapes.js.
// ═══════════════════════════════════════════════════════════════════════════

import { buildRoof } from './build-roof.js';
import { area, ensureCCW, pointInPoly, segIntersect } from './geom2d.js';

export const TOL = {
  /** distance max entre deux droites pour les dire colinéaires (m) */
  colin: 0.02,
  /** sinus de l'angle max entre deux arêtes pour les dire parallèles */
  parallel: 0.02,
  /** recouvrement projeté minimal pour retenir un segment partagé (m) */
  overlap: 0.10,
  /** écart d'altitude sous lequel deux égouts sont dits « de même niveau » (m) */
  niveau: 0.02,
};

// ── Unité TERRASSE ─────────────────────────────────────────────────────────

/**
 * Toit-terrasse : un seul plan à faible pente vers un point bas, acrotère
 * périmétrique. Ne passe PAS par le squelette (s = cot θ → ∞ pour θ → 0).
 * C'est le mécanisme M4 de la déduplication du registre.
 */
export function buildTerrasse(footprint, opts = {}) {
  const poly = ensureCCW(footprint);
  const baseY = opts.baseY ?? 0;
  const pct = opts.pentePct ?? 2;                       // 1 à 3 % (DTU 43.x)
  const hAcro = opts.acrotere ?? 0.35;
  let d = opts.versDrain ?? [0, -1];
  const dl = Math.hypot(d[0], d[1]) || 1;
  d = [d[0] / dl, d[1] / dl];

  const proj = poly.map((p) => p[0] * d[0] + p[1] * d[1]);
  const pMin = Math.min(...proj), pMax = Math.max(...proj);
  const h = (P) => baseY + (pct / 100) * (pMax - (P[0] * d[0] + P[1] * d[1]));

  const A = area(poly);
  const n = poly.length;
  const edges = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    edges.push({ edge: i, kind: 'acrotere', a, b, longueur: Math.hypot(b[0] - a[0], b[1] - a[1]), hAcrotere: hAcro });
  }
  return {
    ok: true, kind: 'terrasse', poly, baseY,
    heightAt: h,
    pentePct: pct, versDrain: d, acrotere: hAcro,
    panels: [{ edge: 0, kind: 'terrasse', poly, aireProjetee: A, aireRampante: A / Math.cos(Math.atan(pct / 100)), pente: Math.atan(pct / 100) * 180 / Math.PI }],
    edges,
    hautBas: { haut: baseY + (pct / 100) * (pMax - pMin), bas: baseY },
    audit: { ok: true, checks: [{ id: 'T1_PENTE_DTU', ok: pct >= 1 && pct <= 5, detail: `pente ${pct} % (DTU 43.x : 1 à 3 % en inaccessible)` }],
             aireEmprise: A, sommeAires: A, tMax: (pct / 100) * (pMax - pMin) },
  };
}

// ── Géométrie de raccord ───────────────────────────────────────────────────

/** Segment de recouvrement entre deux arêtes colinéaires. null sinon. */
export function sharedSegment(a1, a2, b1, b2, tol = TOL) {
  const ux = a2[0] - a1[0], uz = a2[1] - a1[1];
  const vx = b2[0] - b1[0], vz = b2[1] - b1[1];
  const lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
  if (lu < 1e-9 || lv < 1e-9) return null;
  const ex = ux / lu, ez = uz / lu;
  // parallélisme
  if (Math.abs(ex * (vz / lv) - ez * (vx / lv)) > tol.parallel) return null;
  // distance entre droites : projection de (b1 − a1) sur la normale de a
  const nx = -ez, nz = ex;
  const dist = Math.abs((b1[0] - a1[0]) * nx + (b1[1] - a1[1]) * nz);
  if (dist > tol.colin) return null;
  // recouvrement des projections sur l'axe de a
  const t = (P) => (P[0] - a1[0]) * ex + (P[1] - a1[1]) * ez;
  const t0 = 0, t1 = lu;
  const s0 = Math.min(t(b1), t(b2)), s1 = Math.max(t(b1), t(b2));
  const lo = Math.max(t0, s0), hi = Math.min(t1, s1);
  if (hi - lo < tol.overlap) return null;
  return {
    p1: [a1[0] + ex * lo, a1[1] + ez * lo],
    p2: [a1[0] + ex * hi, a1[1] + ez * hi],
    longueur: hi - lo, dist,
  };
}

/** Distance d'un point au bord du polygone. */
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

/** Point STRICTEMENT intérieur (le bord ne compte pas). */
const strictementDedans = (p, poly, tol) => pointInPoly(p, poly) && distBord(p, poly) > tol;

/**
 * Les deux emprises ont-elles des INTÉRIEURS sécants ?
 *
 * Test EXACT par décomposition en bandes verticales. Les tests naïfs échouent
 * sur deux cas courants en agrégat :
 *   · deux unités jointives partagent une arête — ce n'est PAS un recouvrement,
 *     et `segIntersect` (bornes strictes) l'ignore correctement ;
 *   · deux unités qui se recouvrent EN BANDE (12×8 et 8×20 se chevauchant sur
 *     x ∈ [8,12]) n'ont aucun sommet strictement intérieur à l'autre et aucun
 *     croisement d'arêtes franc — le recouvrement passait inaperçu.
 *
 * Entre deux abscisses critiques consécutives, la coupe de chaque polygone est
 * une réunion d'intervalles qui varie linéairement : la tester au milieu de la
 * bande est donc exact.
 */
export function polysOverlap(A, B, tol = 1e-7) {
  const xs = new Set();
  for (const p of A) xs.add(p[0]);
  for (const p of B) xs.add(p[0]);
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < B.length; j++) {
      const P = segIntersect(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length]);
      if (P) xs.add(P[0]);
    }
  }
  const X = [...xs].sort((a, b) => a - b);
  for (let k = 0; k + 1 < X.length; k++) {
    const xm = (X[k] + X[k + 1]) / 2;
    if (X[k + 1] - X[k] < tol) continue;
    const ia = spansAt(A, xm), ib = spansAt(B, xm);
    for (const [a0, a1] of ia) {
      for (const [b0, b1] of ib) {
        if (Math.min(a1, b1) - Math.max(a0, b0) > tol) return true;
      }
    }
  }
  return false;
}

/** Intervalles [z0,z1] du polygone sur la verticale x = xm. */
function spansAt(poly, xm) {
  const zs = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    if ((a[0] - xm) * (b[0] - xm) < 0) zs.push(a[1] + ((xm - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
  }
  zs.sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i + 1 < zs.length; i += 2) out.push([zs[i], zs[i + 1]]);
  return out;
}

// ── Classification des jonctions ───────────────────────────────────────────

export const JUNCTIONS = {
  cheneau:          'Chéneau — deux égouts se font face au même niveau',
  cheneau_denivele: 'Chéneau dénivelé — égouts à des niveaux différents',
  solin:            'Solin — un pan bute contre un pignon ou un mur plus haut',
  egout_sur_terrasse: 'Égout déversant sur toiture-terrasse',
  releve_acrotere:  'Relevé d’étanchéité contre acrotère',
  acrotere_mitoyen: 'Acrotère mitoyen entre deux terrasses',
  mur_mitoyen:      'Mur mitoyen — deux pignons dos à dos, aucune pièce de couverture',
  egout_noye:       'DÉFAUT — égout noyé : le pan déverse SOUS le niveau de la terrasse voisine',
};

/**
 * Altitudes de la toiture le long de l'arête `i` : { bas, haut }.
 * Pour une arête en CROUPE, bas = haut = l'égout.
 * Pour une arête en PIGNON, la toiture MONTE au-dessus de l'arête jusqu'au
 * rampant : `haut` est alors l'altitude maximale du squelette sur cette ligne.
 * C'est cette valeur qui distingue un mur mitoyen d'un solin.
 */
function niveauxBord(u, i) {
  if (u.kind === 'terrasse') {
    const a = u.poly[i], b = u.poly[(i + 1) % u.poly.length];
    const h = (u.heightAt(a) + u.heightAt(b)) / 2;
    return { bas: h, haut: h };
  }
  const bas = u.baseY;
  const sk = u.built.skeleton;
  if (!sk || sk.weights[i] > 0) return { bas, haut: bas };
  const a = u.poly[i], b = u.poly[(i + 1) % u.poly.length];
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  let haut = bas;
  for (const n of sk.nodes) {
    let t = l2 < 1e-18 ? 0 : ((n.x - a[0]) * dx + (n.z - a[1]) * dz) / l2;
    if (t < -1e-6 || t > 1 + 1e-6) continue;
    t = Math.max(0, Math.min(1, t));
    if (Math.hypot(n.x - (a[0] + t * dx), n.z - (a[1] + t * dz)) > 1e-6) continue;
    haut = Math.max(haut, bas + n.t);
  }
  return { bas, haut };
}
const niveauBord = (u, i) => niveauxBord(u, i).bas;

function modeArete(u, i) {
  if (u.kind === 'terrasse') return 'acrotere';
  return u.built.skeleton.weights[i] === 0 ? 'pignon' : 'croupe';
}

function classer(uA, ia, uB, ib) {
  const mA = modeArete(uA, ia), mB = modeArete(uB, ib);
  const nA = niveauxBord(uA, ia), nB = niveauxBord(uB, ib);
  const hA = nA.bas, hB = nB.bas;
  const dh = hA - hB;

  if (mA === 'acrotere' && mB === 'acrotere') return { kind: 'acrotere_mitoyen', dh };
  if (mA === 'acrotere' || mB === 'acrotere') {
    const pente = mA === 'acrotere' ? mB : mA;
    const hPente = mA === 'acrotere' ? hB : hA;
    const hTerr = mA === 'acrotere' ? hA : hB;
    if (pente === 'pignon') return { kind: 'releve_acrotere', dh, hPente, hTerr };
    // un pan qui bute sur une terrasse doit déverser DESSUS, jamais dessous.
    if (hPente >= hTerr - TOL.niveau) return { kind: 'egout_sur_terrasse', dh, hPente, hTerr };
    return { kind: 'egout_noye', dh, hPente, hTerr };
  }
  if (mA === 'pignon' && mB === 'pignon') {
    // deux plans verticaux dos à dos : mur mitoyen s'ils montent à la même
    // altitude, SOLIN si l'un domine l'autre (toitures étagées, appentis adossé).
    const dHaut = nA.haut - nB.haut;
    return Math.abs(dHaut) > 0.10
      ? { kind: 'solin', dh: dHaut, hHautA: nA.haut, hHautB: nB.haut }
      : { kind: 'mur_mitoyen', dh: dHaut };
  }
  if (mA === 'pignon' || mB === 'pignon') {
    // Un pan qui vient mourir au PIED d'une face verticale porte aussi un
    // chéneau : c'est la jonction des dents de scie et des toitures étagées.
    // La jonction est composite — on la nomme par sa pièce principale (solin)
    // et on signale le chéneau qui l'accompagne.
    const cotePan = mA === 'croupe' ? nA : nB;
    const coteMur = mA === 'croupe' ? nB : nA;
    const avecCheneau = cotePan.bas <= coteMur.haut - 0.10;
    return { kind: 'solin', dh, avecCheneau, hEgout: cotePan.bas, hMur: coteMur.haut };
  }
  // deux égouts face à face
  return { kind: Math.abs(dh) <= TOL.niveau ? 'cheneau' : 'cheneau_denivele', dh };
}

// ── Construction de l'agrégat ──────────────────────────────────────────────

/**
 * @param {{units: Array}} assembly
 *   unité en pente   : { id, kind:'pente', footprint, edges, baseY, debordAuxJonctions? }
 *   unité terrasse   : { id, kind:'terrasse', footprint, baseY, pentePct?, versDrain?, acrotere? }
 * @returns {{ ok, units, junctions, audit }}
 */
export function buildAssembly(assembly, opts = {}) {
  const tol = { ...TOL, ...(opts.tol ?? {}) };
  const units = [];

  for (const u of assembly.units) {
    if (u.kind === 'terrasse') {
      const t = buildTerrasse(u.footprint, u);
      units.push({ ...t, id: u.id, spec: u });
    } else {
      const built = buildRoof(u.footprint, u.edges, { baseY: u.baseY ?? 0 });
      units.push({
        id: u.id, kind: 'pente', spec: u, built,
        ok: built.ok, poly: built.validation.ok ? built.skeleton.poly : u.footprint,
        baseY: u.baseY ?? 0,
        panels: built.panels ?? [], edges: built.edges ?? [], audit: built.audit,
        heightAt: null,
      });
    }
  }

  // ── jonctions : segments d'emprise partagés entre deux unités
  const junctions = [];
  for (let A = 0; A < units.length; A++) {
    for (let B = A + 1; B < units.length; B++) {
      const uA = units[A], uB = units[B];
      const pa = uA.poly, pb = uB.poly;
      for (let ia = 0; ia < pa.length; ia++) {
        for (let ib = 0; ib < pb.length; ib++) {
          const seg = sharedSegment(pa[ia], pa[(ia + 1) % pa.length], pb[ib], pb[(ib + 1) % pb.length], tol);
          if (!seg) continue;
          const cl = classer(uA, ia, uB, ib);
          if (cl.hPente !== undefined) { /* niveaux conservés pour le diagnostic */ }
          junctions.push({
            a: { unit: uA.id, edge: ia, mode: modeArete(uA, ia), niveau: niveauBord(uA, ia) },
            b: { unit: uB.id, edge: ib, mode: modeArete(uB, ib), niveau: niveauBord(uB, ib) },
            kind: cl.kind, denivele: cl.dh,
            hPente: cl.hPente, hTerr: cl.hTerr, hHautA: cl.hHautA, hHautB: cl.hHautB,
            avecCheneau: cl.avecCheneau ?? false, hEgout: cl.hEgout, hMur: cl.hMur,
            p1: seg.p1, p2: seg.p2, longueur: seg.longueur,
            label: JUNCTIONS[cl.kind],
          });
        }
      }
    }
  }

  const audit = auditAssembly(units, junctions, assembly, tol);
  return { ok: audit.ok && units.every((u) => u.ok), units, junctions, audit };
}

// ── Audit de l'agrégat ─────────────────────────────────────────────────────

export function auditAssembly(units, junctions, assembly, tol = TOL) {
  const checks = [];

  // A1 — les emprises ne se recouvrent pas
  const chevauchements = [];
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      if (polysOverlap(units[i].poly, units[j].poly)) chevauchements.push([units[i].id, units[j].id]);
    }
  }
  checks.push({
    id: 'A1_PAS_DE_RECOUVREMENT', ok: chevauchements.length === 0,
    detail: chevauchements.length ? `emprises sécantes : ${chevauchements.map((c) => c.join('×')).join(', ')}` : 'ok',
  });

  // A2 — chaque unité passe son propre audit
  const ko = units.filter((u) => !u.ok).map((u) => u.id);
  checks.push({ id: 'A2_UNITES_VALIDES', ok: ko.length === 0, detail: ko.length ? `unités en échec : ${ko.join(', ')}` : `${units.length} unité(s)` });

  // A3 — toute unité est raccordée à au moins une autre (agrégat connexe)
  if (units.length > 1) {
    const adj = new Map(units.map((u) => [u.id, new Set()]));
    for (const j of junctions) { adj.get(j.a.unit)?.add(j.b.unit); adj.get(j.b.unit)?.add(j.a.unit); }
    const vus = new Set([units[0].id]); const pile = [units[0].id];
    while (pile.length) { const c = pile.pop(); for (const v of adj.get(c) ?? []) if (!vus.has(v)) { vus.add(v); pile.push(v); } }
    const isoles = units.filter((u) => !vus.has(u.id)).map((u) => u.id);
    checks.push({ id: 'A3_AGREGAT_CONNEXE', ok: isoles.length === 0,
      detail: isoles.length ? `unités non raccordées : ${isoles.join(', ')}` : `${junctions.length} jonction(s)` });
  }

  // A4 — un chéneau doit avoir une pente d'écoulement ET une sortie déclarée
  const chen = junctions.filter((j) => j.kind === 'cheneau' || j.kind === 'cheneau_denivele' || j.avecCheneau);
  const sansSortie = chen.filter((j) => !(assembly.evacuations ?? []).some(
    (e) => Math.hypot(e[0] - j.p1[0], e[1] - j.p1[1]) < 1.5 || Math.hypot(e[0] - j.p2[0], e[1] - j.p2[1]) < 1.5));
  checks.push({
    id: 'A4_CHENEAUX_EVACUES', ok: chen.length === 0 || sansSortie.length === 0,
    detail: chen.length === 0 ? 'aucun chéneau'
      : sansSortie.length ? `${sansSortie.length}/${chen.length} chéneau(x) sans évacuation déclarée à moins de 1,5 m d'une extrémité`
      : `${chen.length} chéneau(x), tous évacués`,
  });

  // A5 — RÈGLE MÉTIER : pas de débord de toiture au droit d'un chéneau.
  //   Deux égouts qui se font face à 0 m ne peuvent pas déborder l'un vers
  //   l'autre : les deux couvertures se percuteraient au-dessus du chéneau.
  const debords = [];
  for (const j of chen) {
    for (const side of ['a', 'b']) {
      const u = units.find((x) => x.id === j[side].unit);
      const d = u?.spec?.edges?.[j[side].edge]?.debord;
      if (d !== undefined && d > 0.02) debords.push(`${j[side].unit}·e${j[side].edge} (${d} m)`);
    }
  }
  checks.push({
    id: 'A5_PAS_DE_DEBORD_SUR_CHENEAU', ok: debords.length === 0,
    detail: debords.length ? `débord non nul au droit d'un chéneau : ${debords.join(', ')}` : 'ok',
    fixLabel: debords.length ? 'mettre le débord à 0 au droit du chéneau' : undefined,
  });

  // A6 — un chéneau dénivelé de plus de 5 cm n'est pas un chéneau : c'est un solin
  const mauvais = junctions.filter((j) => j.kind === 'cheneau_denivele' && Math.abs(j.denivele) > 0.05);
  checks.push({
    id: 'A6_CHENEAU_DE_NIVEAU', ok: mauvais.length === 0,
    detail: mauvais.length ? mauvais.map((j) => `${j.a.unit}×${j.b.unit} : dénivelé ${(j.denivele * 100).toFixed(0)} cm`).join(' · ') : 'ok',
  });

  // A7 — aucun égout noyé sous une terrasse voisine
  const noyes = junctions.filter((j) => j.kind === 'egout_noye');
  checks.push({
    id: 'A7_PAS_D_EGOUT_NOYE', ok: noyes.length === 0,
    detail: noyes.length
      ? noyes.map((j) => `${j.a.unit}×${j.b.unit} : égout à ${j.hPente?.toFixed(2)} m sous une terrasse à ${j.hTerr?.toFixed(2)} m`).join(' · ')
      : 'ok',
    fixLabel: noyes.length ? "remonter l'arase du pan ou abaisser la terrasse" : undefined,
  });

  const aireTotale = units.reduce((s, u) => s + area(u.poly), 0);
  return {
    ok: checks.every((c) => c.ok), checks,
    aireTotale,
    parType: junctions.reduce((m, j) => ((m[j.kind] = (m[j.kind] ?? 0) + 1), m), {}),
  };
}

/** Résumé lisible. */
export function describeAssembly(r) {
  const L = [];
  L.push(`${r.units.length} unité(s) · aire totale ${r.audit.aireTotale.toFixed(2)} m²`);
  for (const u of r.units) {
    if (u.kind === 'terrasse') {
      L.push(`  · ${u.id} — terrasse ${area(u.poly).toFixed(1)} m², pente ${u.pentePct} %, acrotère ${(u.acrotere * 100).toFixed(0)} cm, arase ${u.baseY.toFixed(2)} m`);
    } else {
      const pans = u.panels.filter((p) => p.kind === 'pan' && p.aireProjetee > 1e-9).length;
      L.push(`  · ${u.id} — ${pans} pan(s), faîte +${u.audit ? u.audit.tMax.toFixed(2) : '?'} m sur arase ${u.baseY.toFixed(2)} m ${u.ok ? '' : '  ✗ ÉCHEC'}`);
    }
  }
  L.push(`jonctions : ${Object.entries(r.audit.parType).map(([k, v]) => `${v} ${k}`).join(' · ') || 'aucune'}`);
  for (const j of r.junctions) {
    L.push(`  · ${j.kind.padEnd(19)} ${j.a.unit}·e${j.a.edge} ↔ ${j.b.unit}·e${j.b.edge}  L=${j.longueur.toFixed(2)} m  Δh=${(j.denivele * 100).toFixed(0)} cm`);
  }
  for (const c of r.audit.checks) L.push(`  ${c.ok ? '✓' : '✗'} ${c.id.padEnd(30)} ${c.detail}`);
  return L.join('\n');
}
