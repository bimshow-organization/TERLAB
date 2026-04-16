// terlab/components/metaforme-engine.js
// MetaformeEngine — Couche édition géométrique 2D extraite de terlab_metaforme_v3.html
// Porte : drag/split/arcs/béziers/typologies mitoyennes/trous — sans 3D, voxel, section, house-speech
// ENSA La Réunion · MGA Architecture 2026
// Vanilla JS ES2022+
//
// Phase 1 (ce fichier) : state + geom core + edit actions + shared walls + snap
// Phase 1b (à venir) : render SVG + event binding (pointer/wheel/keyboard)
//
// Le moteur est pure état + API. Les consommateurs (EsquisseCanvas, P11, Gabarit)
// binent leurs handlers et leur render en appelant les actions du moteur.

// ═════════════════════════════════════════════════════════════════
// CONSTANTES
// ═════════════════════════════════════════════════════════════════
const NS = 'http://www.w3.org/2000/svg';
const DEFAULT_GRID   = 5;     // px par mètre (5 = échelle Métaforme standard)
const DEFAULT_OFFSET = 8;     // px → 2m inlet réglementaire (= 2 × GRID sur échelle=4, ou fixe)
const FUSE_DIST      = 3;     // px, fusion de vertices quasi-confondus avant offset
const COINCIDE_THRESH = 6;    // px ~1.2m, seuil findCoincidentVertices
const SHARED_THRESH  = 6;     // px ~1.2m, détection paroi partagée
const SNAP_INTER     = 12;    // px, snap inter-polys pendant drag
const HOVER_VERT_R   = 10;    // px, rayon hit vertex
const HOVER_EDGE_PERP = 9;    // px, tolérance perpendiculaire arête
const MIN_AREA_DEGEN = 6;     // px², aire minimale pour ne pas être dégénéré

// ═════════════════════════════════════════════════════════════════
// HELPERS MATH — pure, stateless
// ═════════════════════════════════════════════════════════════════
const hypot = (a, b, c, d) => Math.hypot(c - a, d - b);
const angle = (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1);
const lerp  = (a, b, t) => a + (b - a) * t;

// Aire non signée (positive)
export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return Math.abs(a) / 2;
}

// Aire signée (positive si CW en SVG Y-down, négative si CCW)
export function polyAreaSigned(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return a / 2;
}

export function polyPerim(pts) {
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    p += hypot(pts[i][0], pts[i][1], pts[j][0], pts[j][1]);
  }
  return p;
}

// Winding CW en SVG Y-down : sum((x2-x1)*(y2+y1)) > 0 (équivalent polyAreaSigned(pts) > 0)
export function isClockwise(pts) {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    sum += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  }
  return sum > 0;
}

// Force CW (reverse si polygone en CCW)
export function ensureCW(verts) {
  if (verts.length < 3) return verts;
  if (!isClockwise(verts)) verts.reverse();
  return verts;
}

// cross < 0 = CONCAVE en SVG Y-down CW (fix du bug v3 §3.5 skill v2.1)
export function isConcave(pts, i) {
  const n = pts.length;
  const [px, py] = pts[(i - 1 + n) % n];
  const [cx, cy] = pts[i];
  const [nx, ny] = pts[(i + 1) % n];
  return (cx - px) * (ny - cy) - (cy - py) * (nx - cx) < 0;
}

// Intersection booléenne 2 segments (ouverts)
export function segIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1x = bx - ax, d1y = by - ay, d2x = dx - cx, d2y = dy - cy;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 0.001) return false;
  const t = ((cx - ax) * d2y - (cy - ay) * d2x) / den;
  const u = ((cx - ax) * d1y - (cy - ay) * d1x) / den;
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
}

// Point d'intersection 2 segments (ou null)
export function segIntersectPt(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1x = bx - ax, d1y = by - ay, d2x = dx - cx, d2y = dy - cy;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 0.0001) return null;
  const t = ((cx - ax) * d2y - (cy - ay) * d2x) / den;
  const u = ((cx - ax) * d1y - (cy - ay) * d1x) / den;
  if (t < 0.001 || t > 0.999 || u < 0.001 || u > 0.999) return null;
  return [ax + t * d1x, ay + t * d1y];
}

// Teste si le polygone se croise lui-même (paires d'arêtes non-adjacentes)
export function hasSelfIntersect(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    for (let k = i + 2; k < n; k++) {
      if (k === n - 1 && i === 0) continue;
      const l = (k + 1) % n;
      if (segIntersect(pts[i][0], pts[i][1], pts[j][0], pts[j][1],
                       pts[k][0], pts[k][1], pts[l][0], pts[l][1])) return true;
    }
  }
  return false;
}

// Point dans polygone (ray-cast horizontal)
export function ptInPoly(px, py, poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

// Distance point→segment
export function distPtSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  if (l2 < 1e-10) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// ═════════════════════════════════════════════════════════════════
// OFFSET / INLET
// ═════════════════════════════════════════════════════════════════

// Offset miter simple (pour test d'aire)
export function computeOffset(pts, d) {
  const n = pts.length;
  const norms = [];
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    norms.push(len < 0.001 ? [0, 0] : [-dy / len, dx / len]);
  }
  return pts.map((_, i) => {
    const j = (i + 1) % n;
    const n1 = norms[i], n2 = norms[j];
    const [ox1, oy1] = [pts[i][0] + d * n1[0], pts[i][1] + d * n1[1]];
    const [ox2, oy2] = [pts[j][0] + d * n1[0], pts[j][1] + d * n1[1]];
    const [ox3, oy3] = [pts[j][0] + d * n2[0], pts[j][1] + d * n2[1]];
    const [ox4, oy4] = [pts[(j + 1) % n][0] + d * n2[0], pts[(j + 1) % n][1] + d * n2[1]];
    const dx1 = ox2 - ox1, dy1 = oy2 - oy1, dx2 = ox4 - ox3, dy2 = oy4 - oy3;
    const den = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(den) < 0.001) return [ox2, oy2];
    const t = ((ox3 - ox1) * dy2 - (oy3 - oy1) * dx2) / den;
    return [+(ox1 + t * dx1).toFixed(1), +(oy1 + t * dy1).toFixed(1)];
  });
}

// Offset avec round join aux concaves, miter aux convexes, bevel si miter > d*4
// Retourne un SVG path string (M … L … Z) ou '' si dégénéré.
// 4 passes : join computation → raw polyline → self-intersect removal → SVG build.
export function computeOffsetRoundPath(pts, d, arcSteps = 8) {
  const n = pts.length;
  if (n < 3) return '';
  const norms = pts.map((_, i) => {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    return len < 0.001 ? [0, 0] : [-dy / len, dx / len];
  });

  const corners = pts.map((_, i) => {
    const prev = (i - 1 + n) % n;
    const [vx, vy] = pts[i];
    const ni = norms[prev], no = norms[i];
    const pinX = vx + d * ni[0], pinY = vy + d * ni[1];
    const poutX = vx + d * no[0], poutY = vy + d * no[1];
    const eInX = pts[i][0] - pts[prev][0], eInY = pts[i][1] - pts[prev][1];
    const eOutX = pts[(i + 1) % n][0] - pts[i][0], eOutY = pts[(i + 1) % n][1] - pts[i][1];
    const cross = eInX * eOutY - eInY * eOutX;
    if (Math.abs(cross) < 0.5) return { type: 'straight', pin: [pinX, pinY], exit: [poutX, poutY] };
    if (cross > 0) {
      // CONVEXE : miter
      const den = cross;
      if (Math.abs(den) < 0.001) return { type: 'straight', pin: [pinX, pinY], exit: [poutX, poutY] };
      const t = ((poutX - pinX) * eOutY - (poutY - pinY) * eOutX) / den;
      const mx = pinX + t * eInX, my = pinY + t * eInY;
      if (Math.hypot(mx - vx, my - vy) < d * 4) return { type: 'convex', exit: [mx, my] };
      return { type: 'bevel', pin: [pinX, pinY], exit: [poutX, poutY] };
    }
    // CONCAVE : arc
    const a0 = Math.atan2(pinY - vy, pinX - vx);
    const a1 = Math.atan2(poutY - vy, poutX - vx);
    let da = a1 - a0;
    while (da >  Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const arcPts = [];
    for (let s = 0; s <= arcSteps; s++) {
      const a = a0 + da * s / arcSteps;
      arcPts.push([vx + d * Math.cos(a), vy + d * Math.sin(a)]);
    }
    return { type: 'concave', pin: [pinX, pinY], arcPts, exit: [poutX, poutY] };
  });

  const rawPts = [corners[0].exit];
  for (let i = 1; i < n; i++) {
    const c = corners[i];
    if (c.type === 'convex') rawPts.push(c.exit);
    else if (c.type === 'concave') { rawPts.push(c.pin); c.arcPts.slice(1).forEach(p => rawPts.push(p)); }
    else { if (c.pin) rawPts.push(c.pin); rawPts.push(c.exit); }
  }
  const c0 = corners[0];
  if (c0.type === 'concave') { rawPts.push(c0.pin); c0.arcPts.slice(1, -1).forEach(p => rawPts.push(p)); }
  else if (c0.type === 'bevel') rawPts.push(c0.pin);

  const cleaned = _removeOffsetSelfIntersections(rawPts);
  if (!cleaned.length) return '';
  const fmt = ([x, y]) => x.toFixed(2) + ',' + y.toFixed(2);
  return 'M ' + fmt(cleaned[0]) + ' ' + cleaned.slice(1).map(p => 'L ' + fmt(p)).join(' ') + ' Z';
}

// Court-circuit des boucles d'auto-intersection (angles aigus convexes)
export function _removeOffsetSelfIntersections(pts) {
  let p = pts.slice();
  const MAX = pts.length * 2;
  for (let iter = 0; iter < MAX; iter++) {
    const m = p.length;
    if (m < 4) break;
    let found = false;
    outer:
    for (let i = 0; i < m - 1; i++) {
      for (let j = m - 2; j > i + 1; j--) {
        if (i === 0 && j === m - 2) continue;
        const P = segIntersectPt(
          p[i][0], p[i][1], p[i + 1][0], p[i + 1][1],
          p[j][0], p[j][1], p[j + 1][0], p[j + 1][1]);
        if (P) {
          p = [...p.slice(0, i + 1), P, ...p.slice(j + 1)];
          found = true; break outer;
        }
      }
    }
    if (!found) break;
  }
  return p;
}

// ═════════════════════════════════════════════════════════════════
// ARCS + BÉZIERS — support edges non droites
// ═════════════════════════════════════════════════════════════════

// arcH = hauteur signée perpendiculaire du milieu de corde au sommet de l'arc
// positif = bombe à droite de direction start→end (SVG Y-down)
export function arcSVGCmd(sx, sy, ex, ey, arcH) {
  if (Math.abs(arcH) < 0.5) return `L ${ex.toFixed(1)},${ey.toFixed(1)}`;
  const d = Math.hypot(ex - sx, ey - sy);
  if (d < 0.1) return `L ${ex.toFixed(1)},${ey.toFixed(1)}`;
  const r = (d * d + 4 * arcH * arcH) / (8 * Math.abs(arcH));
  const largeArc = Math.abs(2 * arcH) > d ? 1 : 0;
  const sweep = arcH > 0 ? 1 : 0;
  return `A ${r.toFixed(1)} ${r.toFixed(1)} 0 ${largeArc} ${sweep} ${ex.toFixed(1)},${ey.toFixed(1)}`;
}

export function arcPeakPos(sx, sy, ex, ey, arcH) {
  const mx = (sx + ex) / 2, my = (sy + ey) / 2;
  const dx = ex - sx, dy = ey - sy, len = Math.hypot(dx, dy);
  if (len < 0.1) return [mx, my];
  const px = -dy / len, py = dx / len;
  return [mx + px * arcH, my + py * arcH];
}

export function arcHFromPeak(sx, sy, ex, ey, px, py) {
  const mx = (sx + ex) / 2, my = (sy + ey) / 2;
  const dx = ex - sx, dy = ey - sy, len = Math.hypot(dx, dy);
  if (len < 0.1) return 0;
  const npx = -dy / len, npy = dx / len;
  return (px - mx) * npx + (py - my) * npy;
}

// Points de contrôle Bézier par défaut (tiers de la corde)
export function defaultCP(sx, sy, ex, ey) {
  const t = 1 / 3, u = 2 / 3;
  return [[lerp(sx, ex, t), lerp(sy, ey, t)], [lerp(sx, ex, u), lerp(sy, ey, u)]];
}

// Polyline circulaire depuis start/end/arcH (paramétrisation atan2, pas bezier approx)
export function arcPolyline(sx, sy, ex, ey, arcH, steps = 20) {
  if (Math.abs(arcH) < 0.5) return [[sx, sy], [ex, ey]];
  const dx = ex - sx, dy = ey - sy, chord = Math.hypot(dx, dy);
  if (chord < 0.1) return [[sx, sy]];
  const nx = -dy / chord, ny = dx / chord;
  const r = (chord * chord + 4 * arcH * arcH) / (8 * Math.abs(arcH));
  const mx = (sx + ex) / 2, my = (sy + ey) / 2;
  const s = Math.sign(arcH);
  const cenX = mx - s * (r - Math.abs(arcH)) * nx;
  const cenY = my - s * (r - Math.abs(arcH)) * ny;
  const a0 = Math.atan2(sy - cenY, sx - cenX);
  const a1 = Math.atan2(ey - cenY, ex - cenX);
  const aPeak = Math.atan2(my + arcH * ny - cenY, mx + arcH * nx - cenX);
  const norm2 = x => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const daNorm = norm2(a1 - a0);
  const peakOff = norm2(aPeak - a0);
  const da = peakOff <= daNorm + 0.001 ? daNorm : daNorm - 2 * Math.PI;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, a = a0 + da * t;
    pts.push([cenX + r * Math.cos(a), cenY + r * Math.sin(a)]);
  }
  return pts;
}

// Construit un SVG path depuis (verts, edges) — gère types 'line' / 'arc' / 'bezier'
export function buildPath(verts, edges) {
  if (!verts.length) return '';
  const n = verts.length;
  let d = `M ${verts[0][0].toFixed(1)},${verts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [sx, sy] = verts[i], [ex, ey] = verts[j];
    const edge = edges[i] || {};
    if (edge.type === 'arc' && Math.abs(edge.arcH || 0) > 0.5) {
      d += ' ' + arcSVGCmd(sx, sy, ex, ey, edge.arcH || 0);
    } else if (edge.type === 'bezier' && edge.cp1 && edge.cp2) {
      const [c1x, c1y] = edge.cp1, [c2x, c2y] = edge.cp2;
      d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
    } else {
      d += ` L ${ex.toFixed(1)},${ey.toFixed(1)}`;
    }
  }
  return d + ' Z';
}

// Discrétise (verts, edges) en polyline [[x,y]...] (pour offset + area)
// Fusionne les vertices trop proches avant (< FUSE_DIST) pour éviter la dégénérescence
export function pathToPolyline(verts, edges, steps = 20) {
  const n = verts.length;
  const fv = [], fe = [];
  for (let i = 0; i < n; i++) {
    if (!fv.length) { fv.push(verts[i]); fe.push(edges[i] || {}); continue; }
    const [lx, ly] = fv[fv.length - 1];
    if (Math.hypot(verts[i][0] - lx, verts[i][1] - ly) >= FUSE_DIST) {
      fv.push(verts[i]); fe.push(edges[i] || {});
    }
  }
  while (fv.length >= 2 && Math.hypot(fv[fv.length - 1][0] - fv[0][0], fv[fv.length - 1][1] - fv[0][1]) < FUSE_DIST) {
    fv.pop(); fe.pop();
  }
  if (fv.length < 3) return [];

  const pts = [];
  const fn = fv.length;
  for (let i = 0; i < fn; i++) {
    const j = (i + 1) % fn;
    const [sx, sy] = fv[i], [ex, ey] = fv[j];
    const edge = fe[i] || {};
    if (edge.type === 'arc' && Math.abs(edge.arcH || 0) > 0.5) {
      const seg = arcPolyline(sx, sy, ex, ey, edge.arcH, steps);
      seg.slice(0, -1).forEach(p => pts.push(p));
    } else if (edge.type === 'bezier' && edge.cp1 && edge.cp2) {
      const [c1x, c1y] = edge.cp1, [c2x, c2y] = edge.cp2;
      for (let s = 0; s < steps; s++) {
        const t = s / steps, u = 1 - t;
        pts.push([u * u * u * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
                  u * u * u * sy + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey]);
      }
    } else {
      pts.push([sx, sy]);
    }
  }
  return pts;
}

// ═════════════════════════════════════════════════════════════════
// CROSSING / SPLIT — détection et décomposition
// ═════════════════════════════════════════════════════════════════

// 1er crossing d'arêtes non-adjacentes (ou null)
export function findFirstIntersection(verts) {
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    for (let k = i + 2; k < n; k++) {
      if (k === n - 1 && i === 0) continue;
      const l = (k + 1) % n;
      const P = segIntersectPt(verts[i][0], verts[i][1], verts[j][0], verts[j][1],
                               verts[k][0], verts[k][1], verts[l][0], verts[l][1]);
      if (P) return { i, j: k, P };
    }
  }
  return null;
}

// Vertices quasi-coïncidents non-adjacents (seuil COINCIDE_THRESH)
export function findCoincidentVertices(verts, thresh = COINCIDE_THRESH) {
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (j === n - 1 && i === 0) continue;
      if (Math.hypot(verts[i][0] - verts[j][0], verts[i][1] - verts[j][1]) < thresh)
        return { i, j, P: [...verts[i]] };
    }
  }
  return null;
}

// Scinde le polygone au point P entre arêtes [i,i+1] et [j,j+1]
// Retourne [{verts, edges}, {verts, edges}] — 2 parts (potentiellement dégénérées)
export function splitPolygon(verts, edges, i, j, P) {
  const n = verts.length;
  const iN = (i + 1) % n, jN = (j + 1) % n;
  const vertsA = [P];
  for (let k = iN;; k = (k + 1) % n) { vertsA.push([...verts[k]]); if (k === j) break; }
  const edgesA = [{ type: 'line' }];
  for (let k = iN; k !== j; k = (k + 1) % n) edgesA.push({ ...(edges[k] || {}) });
  edgesA.push({ type: 'line' });

  const vertsB = [P];
  for (let k = jN;; k = (k + 1) % n) { vertsB.push([...verts[k]]); if (k === i) break; }
  const edgesB = [{ type: 'line' }];
  for (let k = jN; k !== i; k = (k + 1) % n) edgesB.push({ ...(edges[k] || {}) });
  edgesB.push({ type: 'line' });

  return [{ verts: vertsA, edges: edgesA }, { verts: vertsB, edges: edgesB }];
}

// Polygone dégénéré (ligne / point / aire < minArea)
export function isDegenerate(verts, minArea = MIN_AREA_DEGEN) {
  if (!verts || verts.length < 3) return true;
  return polyArea(verts) < minArea;
}

// ═════════════════════════════════════════════════════════════════
// SHARED WALLS — détection mitoyennetés inter-polygones
// ═════════════════════════════════════════════════════════════════

export function sharedEdgeSeg([ax, ay], [bx, by], [cx, cy], [dx, dy], thresh = SHARED_THRESH) {
  const d1x = bx - ax, d1y = by - ay, len1 = Math.hypot(d1x, d1y);
  const d2x = dx - cx, d2y = dy - cy, len2 = Math.hypot(d2x, d2y);
  if (len1 < 0.5 || len2 < 0.5) return null;
  const ux = d1x / len1, uy = d1y / len1;
  const cross = Math.abs(ux * (dy - cy) / len2 - uy * (dx - cx) / len2);
  if (cross > 0.15) return null;
  const dist = Math.abs((cx - ax) * (-uy) + (cy - ay) * ux);
  if (dist > thresh) return null;
  const pA = 0, pB = len1;
  const pC = (cx - ax) * ux + (cy - ay) * uy, pD = (dx - ax) * ux + (dy - ay) * uy;
  const oS = Math.max(pA, Math.min(pC, pD)), oE = Math.min(pB, Math.max(pC, pD));
  if (oE - oS < 2) return null;
  return { x1: ax + ux * oS, y1: ay + uy * oS, x2: ax + ux * oE, y2: ay + uy * oE };
}

export function detectSharedWalls(polys) {
  const walls = [];
  for (let pi = 0; pi < polys.length; pi++) {
    const { verts: va } = polys[pi];
    for (let pj = pi + 1; pj < polys.length; pj++) {
      const { verts: vb } = polys[pj];
      for (let i = 0; i < va.length; i++) {
        const j = (i + 1) % va.length;
        for (let k = 0; k < vb.length; k++) {
          const l = (k + 1) % vb.length;
          const w = sharedEdgeSeg(va[i], va[j], vb[k], vb[l]);
          if (w) walls.push({ ...w, polyI: pi, polyJ: pj, edgeI: i, edgeJ: k });
        }
      }
    }
  }
  return walls;
}

// ═════════════════════════════════════════════════════════════════
// ENGINE INSTANCE
// ═════════════════════════════════════════════════════════════════

export function createEngine(opts = {}) {
  const GRID   = opts.GRID   ?? DEFAULT_GRID;
  const OFFSET = opts.OFFSET ?? DEFAULT_OFFSET;

  const state = {
    polys: opts.initialPolys ?? [],   // [{ verts, edges, holeOf?, typology? }]
    activePolyIdx: 0,
    snapGrid: true,
    strategy: opts.initialStrategy ?? 'rect',
    showOffset: true,

    // drag / hover / interaction
    drag: null,          // { type, idx, prevX?, prevY?, cp?, cx?, cy?, startAngle?, startVerts?, startEdges? }
    _crossing: null,     // { i, j, P } pendant drag
    _hoverVertex: null,
    _hoverEdge: null,
    _hoverPos: null,
    _shiftHeld: false,
    _snapTarget: null,

    // viewport
    svgPan: { x: 0, y: 0 },
    svgZoom: 1,

    // view/interaction metadata
    selectedV: null,
    selectedE: null,
  };

  const ap = () => state.polys[state.activePolyIdx];

  // ── Helpers ──────────────────────────────────────────────────
  const snapPoint = (x, y) => state.snapGrid
    ? [Math.round(x / GRID) * GRID, Math.round(y / GRID) * GRID]
    : [x, y];

  // ── Edit actions ─────────────────────────────────────────────

  function doSplit({ i, j, P }) {
    const poly = ap();
    if (!poly || poly.verts.length < 4) return;
    const parts = splitPolygon(poly.verts, poly.edges, i, j, P);
    const valid = parts.filter(pt => !isDegenerate(pt.verts));
    if (valid.length === 0) {
      if (state.polys.length > 1) {
        state.polys.splice(state.activePolyIdx, 1);
        state.activePolyIdx = Math.min(state.activePolyIdx, state.polys.length - 1);
      }
      state.selectedV = null; state.selectedE = null;
      return;
    }
    if (valid.length === 1) {
      state.polys.splice(state.activePolyIdx, 1, valid[0]);
      state.selectedV = null; state.selectedE = null;
      return;
    }
    const newPolys = [...state.polys];
    newPolys.splice(state.activePolyIdx, 1, ...valid);
    state.polys = newPolys;
    state.selectedV = null; state.selectedE = null;
  }

  function doInsertVertex(polyIdx, edgeIdx, ix, iy) {
    const poly = state.polys[polyIdx];
    if (!poly) return;
    const origEdge = { ...(poly.edges[edgeIdx] || {}) };
    let edgeA = { ...origEdge }, edgeB = { ...origEdge };
    if (origEdge.type === 'arc' && origEdge.arcH) {
      edgeA.arcH = (origEdge.arcH || 0) * 0.5;
      edgeB.arcH = (origEdge.arcH || 0) * 0.5;
    }
    if (origEdge.type === 'bezier') {
      edgeA = { type: 'line' }; edgeB = { type: 'line' };
    }
    poly.verts.splice(edgeIdx + 1, 0, [ix, iy]);
    poly.edges.splice(edgeIdx, 1, edgeA, edgeB);
    state.selectedV = edgeIdx + 1; state.selectedE = null;
    state._hoverEdge = null; state._hoverPos = null; state._hoverVertex = null;
  }

  function doDeleteVertex(polyIdx, vertIdx) {
    const poly = state.polys[polyIdx];
    if (!poly) return;
    const n = poly.verts.length;
    if (n <= 3) {
      if (state.polys.length > 1) {
        state.polys.splice(polyIdx, 1);
        state.activePolyIdx = Math.min(state.activePolyIdx, state.polys.length - 1);
      }
    } else {
      poly.verts.splice(vertIdx, 1);
      poly.edges.splice(vertIdx, 1);
    }
    state.selectedV = null; state._hoverVertex = null; state._hoverEdge = null;
  }

  function purgeDegenerate() {
    const kept = state.polys.filter(p => !isDegenerate(p.verts));
    if (kept.length === state.polys.length) return false;
    state.polys = kept;
    state.activePolyIdx = Math.min(state.activePolyIdx, Math.max(0, kept.length - 1));
    return true;
  }

  // Recalcule holeOf pour chaque polygone (trou si contenu dans un parent)
  function updateHoleRelationships() {
    state.polys.forEach((poly, i) => {
      if (poly.verts.length < 3) { poly.holeOf = null; return; }
      // centre du polygone
      const cx = poly.verts.reduce((s, v) => s + v[0], 0) / poly.verts.length;
      const cy = poly.verts.reduce((s, v) => s + v[1], 0) / poly.verts.length;
      let parent = null;
      state.polys.forEach((other, j) => {
        if (i === j) return;
        if (polyArea(other.verts) <= polyArea(poly.verts)) return;
        if (ptInPoly(cx, cy, other.verts)) parent = j;
      });
      poly.holeOf = parent;
    });
  }

  // Hover detection : vertex > arête (radius 10 / perp 9)
  function detectHover(mx, my, shiftHeld) {
    const poly = ap();
    if (!poly) return { changed: false };
    const { verts } = poly;
    const n = verts.length;
    let foundEdge = null, foundVertex = null, hoverPos = null;
    let minVDist = HOVER_VERT_R;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(verts[i][0] - mx, verts[i][1] - my);
      if (d < minVDist) { minVDist = d; foundVertex = i; }
    }
    if (foundVertex === null) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const [x1, y1] = verts[i], [x2, y2] = verts[j];
        const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
        if (len < 0.1) continue;
        const vx = dx / len, vy = dy / len;
        const pmx = mx - x1, pmy = my - y1;
        const proj = pmx * vx + pmy * vy;
        const perp = Math.abs(pmx * (-vy) + pmy * vx);
        if (proj >= 0 && proj <= len && perp <= HOVER_EDGE_PERP) {
          foundEdge = i;
          const clamp = Math.max(0, Math.min(len, proj));
          hoverPos = { x: x1 + vx * clamp, y: y1 + vy * clamp };
          break;
        }
      }
    }
    const changed = foundEdge !== state._hoverEdge
      || foundVertex !== state._hoverVertex
      || state._shiftHeld !== shiftHeld
      || (hoverPos?.x !== state._hoverPos?.x);
    state._hoverEdge = foundEdge;
    state._hoverVertex = foundVertex;
    state._hoverPos = hoverPos;
    state._shiftHeld = !!shiftHeld;
    return { changed, foundVertex, foundEdge, hoverPos };
  }

  // Snap inter-polygones : cherche vertex ou projection sur arête d'autres polys (< SNAP_INTER)
  function snapToOtherPolys(x, y) {
    let bestDist = SNAP_INTER, sx = x, sy = y, type = null;
    state.polys.forEach((poly, pi) => {
      if (pi === state.activePolyIdx) return;
      const { verts: vb } = poly;
      for (const [vx, vy] of vb) {
        const d = Math.hypot(x - vx, y - vy);
        if (d < bestDist) { bestDist = d; sx = vx; sy = vy; type = 'vtx'; }
      }
      for (let i = 0; i < vb.length; i++) {
        const j = (i + 1) % vb.length;
        const [ex, ey] = vb[i], [fx, fy] = vb[j];
        const dx = fx - ex, dy = fy - ey, len = Math.hypot(dx, dy);
        if (len < 0.1) continue;
        const nx = dx / len, ny = dy / len;
        const proj = (x - ex) * nx + (y - ey) * ny;
        if (proj < 0 || proj > len) continue;
        const px = ex + nx * proj, py = ey + ny * proj;
        const d = Math.hypot(x - px, y - py);
        if (d < bestDist) { bestDist = d; sx = px; sy = py; type = 'edge'; }
      }
    });
    return { x: sx, y: sy, type, dist: bestDist };
  }

  // Refresh typology (§12 skill v2.1) — auto détecte isolée / collée / bande
  function refreshTypology() {
    const walls = detectSharedWalls(state.polys);
    // Graphe d'adjacence poly → Set(polys voisins)
    const adj = new Map();
    state.polys.forEach((_, i) => adj.set(i, new Set()));
    for (const w of walls) {
      adj.get(w.polyI).add(w.polyJ);
      adj.get(w.polyJ).add(w.polyI);
    }
    state.polys.forEach((p, i) => {
      const deg = adj.get(i).size;
      if (deg === 0) p.typology = 'isolee';
      else if (deg === 1) p.typology = 'collee';
      else p.typology = 'bande';  // ≥ 2 voisins = chaîne
    });
    return walls;
  }

  // ── Pipeline obligatoire après mutation (§10 skill v2.1) ─────
  function afterMutation() {
    for (const p of state.polys) ensureCW(p.verts);
    purgeDegenerate();
    updateHoleRelationships();
    refreshTypology();
  }

  return {
    // state (reactive via mutation — consommateur re-render)
    state,
    ap,
    GRID, OFFSET,

    // constants
    HOVER_VERT_R, HOVER_EDGE_PERP, SNAP_INTER, COINCIDE_THRESH,

    // helpers
    snapPoint,
    buildPath,
    pathToPolyline,
    computeOffsetRoundPath,
    computeOffset,
    arcSVGCmd, arcPeakPos, arcHFromPeak, arcPolyline, defaultCP,
    polyArea, polyAreaSigned, polyPerim, isClockwise, ensureCW, isConcave,
    hasSelfIntersect, ptInPoly, distPtSeg,
    segIntersect, segIntersectPt,
    findFirstIntersection, findCoincidentVertices,
    splitPolygon, isDegenerate,
    sharedEdgeSeg, detectSharedWalls,

    // actions
    doSplit,
    doInsertVertex,
    doDeleteVertex,
    purgeDegenerate,
    updateHoleRelationships,
    detectHover,
    snapToOtherPolys,
    refreshTypology,
    afterMutation,

    // setters basiques
    setActive(idx) { state.activePolyIdx = Math.max(0, Math.min(state.polys.length - 1, idx)); },
    setSnapGrid(on) { state.snapGrid = !!on; },
    setShowOffset(on) { state.showOffset = !!on; },
    addPoly(poly) {
      state.polys.push({
        verts: poly.verts ?? [],
        edges: poly.edges ?? poly.verts?.map(() => ({})) ?? [],
        holeOf: poly.holeOf ?? null,
        typology: poly.typology ?? 'isolee',
      });
      state.activePolyIdx = state.polys.length - 1;
    },
    clear() { state.polys = []; state.activePolyIdx = 0; },

    // export GeoJSON-like pour persistance session
    exportPolys() {
      return state.polys.map(p => ({
        verts: p.verts.map(v => [...v]),
        edges: p.edges.map(e => ({ ...e })),
        holeOf: p.holeOf ?? null,
        typology: p.typology ?? 'isolee',
      }));
    },
    importPolys(polys) {
      state.polys = polys.map(p => ({
        verts: p.verts.map(v => [...v]),
        edges: (p.edges || p.verts.map(() => ({}))).map(e => ({ ...e })),
        holeOf: p.holeOf ?? null,
        typology: p.typology ?? 'isolee',
      }));
      state.activePolyIdx = 0;
      afterMutation();
    },
  };
}

// Export namespace par défaut pour consommateurs qui préfèrent une seule import
export default {
  createEngine,
  // helpers stateless
  polyArea, polyAreaSigned, polyPerim, isClockwise, ensureCW, isConcave,
  hasSelfIntersect, ptInPoly, distPtSeg, segIntersect, segIntersectPt,
  computeOffset, computeOffsetRoundPath, _removeOffsetSelfIntersections,
  arcSVGCmd, arcPeakPos, arcHFromPeak, arcPolyline, defaultCP,
  buildPath, pathToPolyline,
  findFirstIntersection, findCoincidentVertices, splitPolygon, isDegenerate,
  sharedEdgeSeg, detectSharedWalls,
};
