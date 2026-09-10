// ═══════════════════════════════════════════════════════════════════════════
// GÉOMÉTRIE 2D — primitives pures pour le noyau toiture
//
// @coords  Plan horizontal du bâtiment. Repère MÈTRES, main droite.
//          Pt2 = [x, z] où x = est, z = nord.  (le monde 3D est [x, y, z]
//          avec y = altitude ; la conversion se fait dans lift().)
//          Orientation canonique des emprises : CCW (aire signée > 0).
//          Inverse de ensureCCW : reverse() — involutif.
//
// Aucune dépendance. Testable en Node sans navigateur.
//
// Porté depuis bimshow-vision (POC ciriani-santillana, module `geom2d`) —
// transformation unique : IIFE-registry `__mods` → module ES.
// ═══════════════════════════════════════════════════════════════════════════

export const EPS = 1e-9;
export const EPS_POS = 1e-7;   // tolérance de position, en mètres (0,1 µm)

/** Aire signée (shoelace). > 0 = CCW. Unité : m². */
export function signedArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    a += p[0] * q[1] - p[1] * q[0];
  }
  return a / 2;
}

/** Aire absolue. */
export const area = (poly) => Math.abs(signedArea(poly));

/** Retourne le polygone orienté CCW (copie). */
export function ensureCCW(poly) {
  return signedArea(poly) < 0 ? [...poly].reverse() : [...poly];
}

/** Périmètre. */
export function perimeter(poly) {
  let p = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    p += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return p;
}

/** Normale INTÉRIEURE unitaire de l'arête a→b, pour un polygone CCW. */
export function innerNormal(a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  return [-dz / l, dx / l];
}

/** Direction unitaire de l'arête a→b. */
export function edgeDir(a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

/**
 * Angle INTÉRIEUR au sommet cur, en radians, pour un polygone CCW.
 * ]0, π[   = sortant (convexe)
 *  ≈ π     = plat (180°)
 * ]π, 2π[  = rentrant (réflexe)
 */
export function interiorAngle(prev, cur, next) {
  const u1 = edgeDir(prev, cur), u2 = edgeDir(cur, next);
  const cross = u1[0] * u2[1] - u1[1] * u2[0];
  const dot = u1[0] * u2[0] + u1[1] * u2[1];
  return Math.PI - Math.atan2(cross, dot);
}

/** Point dans polygone (ray casting, pair-impair). */
export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) &&
        p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Intersection de segments ouverts (bornes strictes). null si pas de croisement franc. */
export function segIntersect(a, b, c, d) {
  const r0 = b[0] - a[0], r1 = b[1] - a[1];
  const s0 = d[0] - c[0], s1 = d[1] - c[1];
  const den = r0 * s1 - r1 * s0;
  if (Math.abs(den) < EPS) return null;
  const t = ((c[0] - a[0]) * s1 - (c[1] - a[1]) * s0) / den;
  const u = ((c[0] - a[0]) * r1 - (c[1] - a[1]) * r0) / den;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return [a[0] + t * r0, a[1] + t * r1];
}

/** Le polygone se recoupe-t-il ? O(n²) sur les paires non adjacentes. */
export function hasSelfIntersect(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
    }
  }
  return false;
}

/**
 * Découpe d'un polygone (éventuellement concave) par un DEMI-PLAN.
 * Le demi-plan est { P : nx·Px + nz·Pz + c <= 0 }.
 * Sutherland-Hodgman : valide ici car la région de coupe est convexe.
 * Retourne [] si tout est rejeté.
 */
export function clipHalfPlane(poly, nx, nz, c, eps = 1e-12) {
  if (poly.length === 0) return [];
  const f = (p) => nx * p[0] + nz * p[1] + c;
  const out = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const cur = poly[i], prv = poly[(i - 1 + n) % n];
    const fc = f(cur), fp = f(prv);
    const inC = fc <= eps, inP = fp <= eps;
    if (inC !== inP) {
      const t = fp / (fp - fc);
      out.push([prv[0] + t * (cur[0] - prv[0]), prv[1] + t * (cur[1] - prv[1])]);
    }
    if (inC) out.push(cur);
  }
  return out;
}

/** Supprime les sommets dupliqués consécutifs (et le bouclage). */
export function dedupe(poly, tol = 1e-9) {
  const out = [];
  for (const p of poly) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > tol) out.push(p);
  }
  while (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol) out.pop(); else break;
  }
  return out;
}

/** Boîte englobante axis-aligned. */
export function bbox(poly) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of poly) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1];
  }
  return { x0, z0, x1, z1, w: x1 - x0, d: z1 - z0, diag: Math.hypot(x1 - x0, z1 - z0) };
}

/** Centroïde d'aire (pas la moyenne des sommets). */
export function centroid(poly) {
  let cx = 0, cz = 0, a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f; cx += (p[0] + q[0]) * f; cz += (p[1] + q[1]) * f;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-12) {
    let sx = 0, sz = 0;
    for (const p of poly) { sx += p[0]; sz += p[1]; }
    return [sx / poly.length, sz / poly.length];
  }
  return [cx / (6 * a), cz / (6 * a)];
}
