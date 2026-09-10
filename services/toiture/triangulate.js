// ═══════════════════════════════════════════════════════════════════════════
// TRIANGULATION — découpage en oreilles, autonome (aucune dépendance)
//
// Porté depuis bimshow-vision (POC ciriani-santillana, utilitaires globaux
// `aire2` / `dansTriangle` / `trianguler`). `buildPrism`, qui dépend de
// Three.js, est porté séparément dans roof-mesh.js — le noyau reste pur.
//
// @coords  polygone 2D quelconque, Pt2 = [a, b] (plan [x, z] ou pan [u, v]).
// ═══════════════════════════════════════════════════════════════════════════

/** Aire signée doublée-moins-la-moitié (shoelace / 2). > 0 = CCW. */
export function aire2(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function dansTriangle(p, a, b, c) {
  const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
  const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
  const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
  const neg = (d1 < -1e-12) || (d2 < -1e-12) || (d3 < -1e-12);
  const pos = (d1 > 1e-12) || (d2 > 1e-12) || (d3 > 1e-12);
  return !(neg && pos);
}

/** Découpage en oreilles. Rend des triplets d'INDICES, orientés CCW. */
export function trianguler(poly) {
  const n = poly.length;
  if (n < 3) return [];
  let idx = poly.map((_, i) => i);
  if (aire2(poly) < 0) idx.reverse();
  const out = [];
  let garde = 0;
  while (idx.length > 3 && garde++ < 3 * n + 10) {
    let coupe = false;
    for (let i = 0; i < idx.length; i++) {
      const m = idx.length;
      const ia = idx[(i - 1 + m) % m], ib = idx[i], ic = idx[(i + 1) % m];
      const a = poly[ia], b = poly[ib], c = poly[ic];
      if (aire2([a, b, c]) <= 1e-12) continue;          // sommet rentrant ou plat
      let libre = true;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (dansTriangle(poly[j], a, b, c)) { libre = false; break; }
      }
      if (!libre) continue;
      out.push([ia, ib, ic]);
      idx.splice(i, 1);
      coupe = true;
      break;
    }
    if (!coupe) break;                                   // polygone dégénéré : on s'arrête
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}
