/**
 * TERLAB · geom-inlet.js
 * Geometrie de l'inlet (enveloppe constructible) avec :
 *   - offset par normale d'arete (reculs variables voie/lat/fond/mitoyen)
 *   - arcs ronds aux sommets concaves (jonction voie 6m × laterale 4m)
 *   - bevel/miter aux sommets convexes
 *   - clean auto-intersections
 *   - fitToInlet : projection d'un bloc sur l'inlet
 *
 * Porte depuis metaforme-engine.js computeOffsetRoundPath, adapte pour
 * des reculs par arete (au lieu d'un offset uniforme).
 */

// ── Intersection segment-segment (param t ∈ [0,1]) ────────────────
function segIntersectPt(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d1x = x2 - x1, d1y = y2 - y1;
  const d2x = x4 - x3, d2y = y4 - y3;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return null;
  const t = ((x3 - x1) * d2y - (y3 - y1) * d2x) / cross;
  const u = ((x3 - x1) * d1y - (y3 - y1) * d1x) / cross;
  if (t < 1e-6 || t > 1 - 1e-6 || u < 1e-6 || u > 1 - 1e-6) return null;
  return [x1 + t * d1x, y1 + t * d1y];
}

// ── Clean auto-intersections (boucles) ────────────────────────────
// Scanne TOUTES les paires de segments du ring, fermeture comprise — une
// boucle parasite peut chevaucher la fermeture (ex. bevel d'une pointe aiguë
// en fin de tableau, jamais coupé par l'ancien scan borné à m-2).
// À chaque croisement, deux polygones candidats : section médiane coupée ou
// conservée — on garde celui de plus grande aire (la boucle parasite est la
// petite ; l'ancien code jetait systématiquement la section médiane, quitte à
// jeter le corps principal).
function removeOffsetSelfIntersections(pts) {
  let p = pts.slice();
  const MAX = pts.length * 2;
  for (let iter = 0; iter < MAX; iter++) {
    const m = p.length;
    if (m < 4) break;
    let found = false;
    outer:
    for (let i = 0; i < m; i++) {
      for (let j = i + 2; j < m; j++) {
        if (i === 0 && j === m - 1) continue; // adjacents via la fermeture
        const P = segIntersectPt(
          p[i][0], p[i][1], p[(i + 1) % m][0], p[(i + 1) % m][1],
          p[j][0], p[j][1], p[(j + 1) % m][0], p[(j + 1) % m][1]);
        if (P) {
          const candA = [...p.slice(0, i + 1), P, ...p.slice(j + 1)];
          const candB = [P, ...p.slice(i + 1, j + 1)];
          p = Math.abs(signedArea(candA)) >= Math.abs(signedArea(candB)) ? candA : candB;
          found = true; break outer;
        }
      }
    }
    if (!found) break;
  }
  return p;
}

// ── Aire signee ────────────────────────────────────────────────────
function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return a / 2;
}

/**
 * Calcule l'inlet (enveloppe constructible) avec reculs variables par arete,
 * arcs ronds aux coins concaves, miter/bevel aux convexes.
 *
 * @param {Array<[number,number]>} poly - sommets de la parcelle [[x,y], ...]
 * @param {Array<number>} reculs - recul (m) par arete [r0, r1, r2, ...]
 * @param {Object} opts
 * @param {number} opts.arcSteps - nombre de points par arc (defaut 8)
 * @param {number} opts.maxMiterRatio - ratio miter max vs recul (defaut 4)
 * @returns {Array<[number,number]>} polyline inlet fermee
 */
export function inletPolyline(poly, reculs, opts = {}) {
  const n = poly.length;
  if (n < 3) return [];
  const arcSteps = opts.arcSteps ?? 8;
  const maxMiterRatio = opts.maxMiterRatio ?? 4;

  // 1. Normales inward par arete
  // Convention PMC : coordonnees metres locaux, polygone peut etre CW ou CCW.
  // On utilise la meme convention que _insetPoly legacy : normale = (-dy, dx)/len
  // qui pointe vers l'interieur pour un polygone CCW (Y-up).
  // Si le polygone est CW, on inverse le signe.
  const sa = signedArea(poly);
  // sa > 0 = CCW (Y-up standard) → normales (-dy, dx) pointent inward → sign = 1
  // sa < 0 = CW → normales (-dy, dx) pointent outward → sign = -1
  const sign = sa >= 0 ? 1 : -1;

  const norms = [];
  for (let i = 0; i < n; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 1e-9) {
      norms.push([0, 0]);
    } else {
      norms.push([sign * (-dy / len), sign * (dx / len)]);
    }
  }

  // 2. Pour chaque sommet, calculer les 2 points d'entree/sortie (offsets differents)
  const corners = [];
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const [vx, vy] = poly[i];
    const dIn = reculs[prev] ?? 0;  // recul de l'arete entrante
    const dOut = reculs[i] ?? 0;     // recul de l'arete sortante

    // Point offset sur l'arete entrante (fin de l'arete prev)
    const pinX = vx + dIn * norms[prev][0], pinY = vy + dIn * norms[prev][1];
    // Point offset sur l'arete sortante (debut de l'arete i)
    const poutX = vx + dOut * norms[i][0], poutY = vy + dOut * norms[i][1];

    // Direction des aretes au sommet
    const eInX = poly[i][0] - poly[prev][0], eInY = poly[i][1] - poly[prev][1];
    const eOutX = poly[(i + 1) % n][0] - poly[i][0], eOutY = poly[(i + 1) % n][1] - poly[i][1];
    const cross = eInX * eOutY - eInY * eOutX;

    if (Math.abs(cross) < 0.5) {
      // Quasi-collineaire
      corners.push({ type: 'straight', pin: [pinX, pinY], exit: [poutX, poutY] });
    } else if (cross * sign > 0) {
      // CONVEXE (le coin pointe vers l'exterieur) → miter ou bevel
      const den = eInX * eOutY - eInY * eOutX;
      if (Math.abs(den) < 0.001) {
        corners.push({ type: 'straight', pin: [pinX, pinY], exit: [poutX, poutY] });
      } else {
        const t = ((poutX - pinX) * eOutY - (poutY - pinY) * eOutX) / den;
        const mx = pinX + t * eInX, my = pinY + t * eInY;
        const dMax = Math.max(dIn, dOut, 1);
        const miterDist = Math.hypot(mx - vx, my - vy);
        // Cap miter : max 2× le recul ET max 8m absolu (evite les triangles sur aretes courtes)
        if (miterDist < dMax * Math.min(maxMiterRatio, 2) && miterDist < 8) {
          corners.push({ type: 'convex', exit: [mx, my] });
        } else {
          // Miter trop long → bevel
          corners.push({ type: 'bevel', pin: [pinX, pinY], exit: [poutX, poutY] });
        }
      }
    } else {
      // CONCAVE (le coin pointe vers l'interieur) → arc rond
      const dArc = Math.max(dIn, dOut);
      if (dArc < 0.01) {
        // Recul nul (mitoyen) → pas d'arc
        corners.push({ type: 'straight', pin: [pinX, pinY], exit: [poutX, poutY] });
      } else {
        const a0 = Math.atan2(pinY - vy, pinX - vx);
        const a1 = Math.atan2(poutY - vy, poutX - vx);
        let da = a1 - a0;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        const arcPts = [];
        for (let s = 0; s <= arcSteps; s++) {
          const a = a0 + da * s / arcSteps;
          arcPts.push([vx + dArc * Math.cos(a), vy + dArc * Math.sin(a)]);
        }
        corners.push({ type: 'concave', pin: [pinX, pinY], arcPts, exit: [poutX, poutY] });
      }
    }
  }

  // 3. Assembler la polyline
  const rawPts = [corners[0].exit ?? corners[0].pin];
  for (let i = 1; i < n; i++) {
    const c = corners[i];
    if (c.type === 'convex') {
      rawPts.push(c.exit);
    } else if (c.type === 'concave') {
      rawPts.push(c.pin);
      c.arcPts.slice(1).forEach(p => rawPts.push(p));
    } else {
      if (c.pin) rawPts.push(c.pin);
      rawPts.push(c.exit);
    }
  }
  // Fermer avec le corner 0
  const c0 = corners[0];
  if (c0.type === 'concave') {
    rawPts.push(c0.pin);
    c0.arcPts.slice(1, -1).forEach(p => rawPts.push(p));
  } else if (c0.type === 'bevel') {
    rawPts.push(c0.pin);
  }

  // 4. Clean auto-intersections
  const cleaned = removeOffsetSelfIntersections(rawPts);
  if (cleaned.length < 3) return [];

  // 5. Verifier orientation (doit etre meme sens que l'original)
  const inletArea = signedArea(cleaned);
  if ((sa < 0 && inletArea > 0) || (sa > 0 && inletArea < 0)) {
    cleaned.reverse();
  }

  return cleaned;
}

/**
 * Projette un bloc (polygone) dans l'inlet par clipping + snap.
 * Les sommets proches de l'inlet (< epsTouch) sont projetes sur le bord.
 *
 * @param {Array<{x,y}>} blocPoly - sommets du bloc
 * @param {Array<[number,number]>} inlet - polyline inlet
 * @param {Object} opts
 * @param {number} opts.epsTouch - seuil de snap (m), defaut 0.5
 * @returns {{ verts: Array<{x,y}>, touchedEdges: Array, clipped: boolean }}
 */
export function fitToInlet(blocPoly, inlet, opts = {}) {
  const epsTouch = opts.epsTouch ?? 0.5;
  const inletXY = inlet.map(p => ({ x: p[0], y: p[1] }));
  const FH = typeof window !== 'undefined' ? window.FootprintHelpers : null;

  if (!FH?.clipPolygon) {
    return { verts: blocPoly, touchedEdges: [], clipped: false };
  }

  // 1. Clipper contre l'inlet
  const clipped = FH.clipPolygon(blocPoly, inletXY);
  if (!clipped || clipped.length < 3) {
    return { verts: blocPoly, touchedEdges: [], clipped: false };
  }

  // 2. Snap : pour chaque sommet du clip, si proche du bord inlet → projeter
  const touchedEdges = [];
  const verts = clipped.map(v => {
    let minDist = Infinity;
    let bestProj = null;
    let bestEdgeIdx = -1;

    for (let i = 0; i < inlet.length; i++) {
      const j = (i + 1) % inlet.length;
      const [ax, ay] = inlet[i], [bx, by] = inlet[j];
      const proj = projectOnSegment(v.x, v.y, ax, ay, bx, by);
      if (proj.dist < minDist) {
        minDist = proj.dist;
        bestProj = proj;
        bestEdgeIdx = i;
      }
    }

    if (minDist < epsTouch && bestProj) {
      touchedEdges.push({ vertIdx: clipped.indexOf(v), inletEdgeIdx: bestEdgeIdx });
      return { x: bestProj.x, y: bestProj.y };
    }
    return v;
  });

  return { verts, touchedEdges, clipped: true };
}

/**
 * Projection orthogonale d'un point sur un segment.
 */
function projectOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return { x: ax, y: ay, dist: Math.hypot(px - ax, py - ay), t: 0 };
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx, projY = ay + t * dy;
  return { x: projX, y: projY, dist: Math.hypot(px - projX, py - projY), t };
}

/**
 * Biseau a un sommet convexe : remplace une arete traversante par 2 aretes biseautees.
 *
 * @param {[number,number]} edgeStart
 * @param {[number,number]} edgeEnd
 * @param {[number,number]} cornerPt
 * @param {number} bevelLen - longueur du biseau (m)
 * @returns {Array<[number,number]>} 2 points a inserer
 */
export function bevelAtConvexCorner(edgeStart, edgeEnd, cornerPt, bevelLen = 1.0) {
  const dx1 = cornerPt[0] - edgeStart[0], dy1 = cornerPt[1] - edgeStart[1];
  const len1 = Math.hypot(dx1, dy1);
  const dx2 = edgeEnd[0] - cornerPt[0], dy2 = edgeEnd[1] - cornerPt[1];
  const len2 = Math.hypot(dx2, dy2);

  const bl = Math.min(bevelLen, len1 * 0.4, len2 * 0.4);

  const p1 = [
    cornerPt[0] - (dx1 / len1) * bl,
    cornerPt[1] - (dy1 / len1) * bl,
  ];
  const p2 = [
    cornerPt[0] + (dx2 / len2) * bl,
    cornerPt[1] + (dy2 / len2) * bl,
  ];

  return [p1, p2];
}

// ── Export ─────────────────────────────────────────────────────────

const GeomInlet = { inletPolyline, fitToInlet, bevelAtConvexCorner, removeOffsetSelfIntersections, signedArea };

if (typeof window !== 'undefined') window.GeomInlet = GeomInlet;
export default GeomInlet;
