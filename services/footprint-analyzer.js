// terlab/services/footprint-analyzer.js
// Analyse morphologique de footprints polygonaux pour generation toitures LOD2.
// Pas de dependance externe. Complete services/footprint-helpers.js.

const FootprintAnalyzer = {

  /**
   * Aire d'un polygone (shoelace, signe).
   */
  signedArea(poly) {
    let s = 0;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      s += (a.x * b.y - b.x * a.y);
    }
    return s / 2;
  },

  area(poly) { return Math.abs(this.signedArea(poly)); },

  /**
   * Centroide d'un polygone.
   */
  centroid(poly) {
    const n = poly.length;
    if (n === 0) return { x: 0, y: 0 };
    if (n === 1) return { ...poly[0] };
    let cx = 0, cy = 0, a2 = 0;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const cross = a.x * b.y - b.x * a.y;
      cx += (a.x + b.x) * cross;
      cy += (a.y + b.y) * cross;
      a2 += cross;
    }
    a2 *= 3; // = 6 * signedArea
    if (Math.abs(a2) < 1e-9) {
      // fallback : moyenne arithmetique
      return {
        x: poly.reduce((s, p) => s + p.x, 0) / n,
        y: poly.reduce((s, p) => s + p.y, 0) / n,
      };
    }
    return { x: cx / a2, y: cy / a2 };
  },

  /**
   * Arete la plus longue. Retourne {i, j, length, azimuth} ou j = (i+1) % n.
   * azimuth en radians (0 = +X, sens trigo).
   */
  longestEdge(poly) {
    const n = poly.length;
    let best = { i: 0, j: 1, length: 0, azimuth: 0 };
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y;
      const l = Math.hypot(dx, dy);
      if (l > best.length) {
        best = { i, j: (i + 1) % n, length: l, azimuth: Math.atan2(dy, dx) };
      }
    }
    return best;
  },

  /**
   * Oriented Bounding Box (rotating calipers simplifie).
   * Iteration sur les angles candidats = orientation des aretes.
   * Retourne {center: {x,y}, axes: [ux, uy], size: {long, span}, angle, area}.
   * - axes[0] = vecteur unitaire de l'axe long
   * - axes[1] = vecteur unitaire de l'axe court
   * - size.long >= size.span
   * - angle = atan2(axes[0].y, axes[0].x) en radians
   */
  fitOBB(poly) {
    const n = poly.length;
    if (n < 3) return null;
    let best = null;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y;
      const l = Math.hypot(dx, dy);
      if (l < 1e-6) continue;
      const ux = dx / l, uy = dy / l;
      // Projection des points sur (ux, uy) et (-uy, ux)
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      for (const p of poly) {
        const u = p.x * ux + p.y * uy;
        const v = -p.x * uy + p.y * ux;
        if (u < minU) minU = u; if (u > maxU) maxU = u;
        if (v < minV) minV = v; if (v > maxV) maxV = v;
      }
      const w = maxU - minU, h = maxV - minV;
      const area = w * h;
      if (!best || area < best.area) {
        const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
        const cx = cu * ux - cv * uy;
        const cy = cu * uy + cv * ux;
        // long = max, span = min
        const isWide = w >= h;
        const long = isWide ? w : h;
        const span = isWide ? h : w;
        const longAxis = isWide ? [ux, uy] : [-uy, ux];
        const spanAxis = isWide ? [-uy, ux] : [ux, uy];
        best = {
          area,
          center: { x: cx, y: cy },
          axes: [longAxis, spanAxis],
          size: { long, span },
          angle: Math.atan2(longAxis[1], longAxis[0]),
        };
      }
    }
    return best;
  },

  /**
   * Test de quasi-rectangularite : aire polygone / aire OBB > tolerance.
   * Defaut tolerance = 0.92.
   */
  isNearRectangular(poly, tolerance = 0.92) {
    const obb = this.fitOBB(poly);
    if (!obb) return false;
    const aPoly = this.area(poly);
    const aObb = obb.area;
    if (aObb < 1e-6) return false;
    return (aPoly / aObb) >= tolerance;
  },

  /**
   * Decomposition greedy d'un footprint en rectangles axes-OBB.
   * Strategie simple (suffisante pour LOD2 pedagogique) :
   *   1. Si quasi-rectangle -> retourne un seul rectangle (l'OBB).
   *   2. Sinon, decomposition rectiligne en grille axe-OBB :
   *      projeter tous les sommets sur les axes OBB,
   *      generer une grille de cellules,
   *      retenir les cellules dont le centre est dans le polygone.
   *      Fusionner les cellules contigues en rectangles maximaux (greedy).
   *
   * Retourne un tableau de rectangles : [{ center, axes, size, polygon }, ...]
   * - polygon = 4 sommets dans l'ordre CCW dans le repere monde
   */
  decomposeToRectangles(poly, opts = {}) {
    const tol = opts.tolerance ?? 0.92;
    const obb = this.fitOBB(poly);
    if (!obb) return [];

    if (this.isNearRectangular(poly, tol)) {
      return [this._obbToRect(obb)];
    }

    // Discretiser le polygone dans le repere OBB
    const [ux, uy] = obb.axes[0];
    const vx = -uy, vy = ux;
    const localPts = poly.map(p => {
      const dx = p.x - obb.center.x, dy = p.y - obb.center.y;
      return { u: dx * ux + dy * uy, v: dx * vx + dy * vy };
    });

    // Limites + sommets pour grille
    const us = [...new Set(localPts.map(p => Math.round(p.u * 100) / 100))].sort((a, b) => a - b);
    const vs = [...new Set(localPts.map(p => Math.round(p.v * 100) / 100))].sort((a, b) => a - b);

    // Construire grille de cellules
    const cells = [];
    for (let i = 0; i < us.length - 1; i++) {
      for (let j = 0; j < vs.length - 1; j++) {
        const u0 = us[i], u1 = us[i + 1];
        const v0 = vs[j], v1 = vs[j + 1];
        const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
        // Centre de cellule -> repere monde -> test inclusion polygone
        const wx = obb.center.x + cu * ux + cv * vx;
        const wy = obb.center.y + cu * uy + cv * vy;
        if (this.pointInPolygon({ x: wx, y: wy }, poly)) {
          cells.push({ i, j, u0, u1, v0, v1 });
        }
      }
    }

    // Fusion greedy de cellules contigues en rectangles maximaux (lignes)
    const used = new Set();
    const rects = [];
    cells.sort((a, b) => a.i - b.i || a.j - b.j);
    for (const cell of cells) {
      const key = `${cell.i}_${cell.j}`;
      if (used.has(key)) continue;
      // Etendre vers la droite (i+) tant que cellule libre
      let ej = cell.j;
      while (true) {
        const nextKey = `${cell.i}_${ej + 1}`;
        const found = cells.find(c => c.i === cell.i && c.j === ej + 1);
        if (!found || used.has(nextKey)) break;
        ej++;
      }
      // Etendre vers le bas (i+) tant que toutes les cellules sont libres
      let ei = cell.i;
      while (true) {
        let canExtend = true;
        for (let jj = cell.j; jj <= ej; jj++) {
          const nextKey = `${ei + 1}_${jj}`;
          const found = cells.find(c => c.i === ei + 1 && c.j === jj);
          if (!found || used.has(nextKey)) { canExtend = false; break; }
        }
        if (!canExtend) break;
        ei++;
      }
      // Marquer les cellules utilisees
      for (let ii = cell.i; ii <= ei; ii++) {
        for (let jj = cell.j; jj <= ej; jj++) {
          used.add(`${ii}_${jj}`);
        }
      }
      // Generer le rectangle
      const u0 = cell.u0, u1 = cells.find(c => c.i === cell.i && c.j === ej)?.u1 ?? cell.u1;
      const v0 = cell.v0, v1 = cells.find(c => c.i === ei && c.j === cell.j)?.v1 ?? cell.v1;
      // Wait: i indexe vs (vertical), j indexe us (horizontal)?
      // Reprenons : on a iteree i sur us (long axis). Donc u0/u1 dependent de i.
      // Pour rester simple, calculer depuis indices : u0=us[cell.i], u1=us[ei+1], v0=vs[cell.j], v1=vs[ej+1].
      const ru0 = us[cell.i], ru1 = us[ei + 1];
      const rv0 = vs[cell.j], rv1 = vs[ej + 1];
      const rcu = (ru0 + ru1) / 2, rcv = (rv0 + rv1) / 2;
      const w = ru1 - ru0, h = rv1 - rv0;
      const cx = obb.center.x + rcu * ux + rcv * vx;
      const cy = obb.center.y + rcu * uy + rcv * vy;
      const isWide = w >= h;
      const long = isWide ? w : h;
      const span = isWide ? h : w;
      const longAxis = isWide ? [ux, uy] : [vx, vy];
      const spanAxis = isWide ? [vx, vy] : [ux, uy];
      const rect = {
        center: { x: cx, y: cy },
        axes: [longAxis, spanAxis],
        size: { long, span },
        angle: Math.atan2(longAxis[1], longAxis[0]),
        polygon: this._rectCornersToPoly(cx, cy, longAxis, spanAxis, long, span),
      };
      rects.push(rect);
    }
    return rects;
  },

  /**
   * Test inclusion point/polygone (ray casting horizontal).
   */
  pointInPolygon(pt, poly) {
    const n = poly.length;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
                       (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi + 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  },

  // ─── Helpers internes ──────────────────────────────────────────────

  _obbToRect(obb) {
    const { center, axes, size } = obb;
    return {
      center: { ...center },
      axes: [[...axes[0]], [...axes[1]]],
      size: { ...size },
      angle: obb.angle,
      polygon: this._rectCornersToPoly(center.x, center.y, axes[0], axes[1], size.long, size.span),
    };
  },

  _rectCornersToPoly(cx, cy, longAxis, spanAxis, long, span) {
    const hl = long / 2, hs = span / 2;
    const [lx, ly] = longAxis, [sx, sy] = spanAxis;
    return [
      { x: cx - hl * lx - hs * sx, y: cy - hl * ly - hs * sy },
      { x: cx + hl * lx - hs * sx, y: cy + hl * ly - hs * sy },
      { x: cx + hl * lx + hs * sx, y: cy + hl * ly + hs * sy },
      { x: cx - hl * lx + hs * sx, y: cy - hl * ly + hs * sy },
    ];
  },
};

export default FootprintAnalyzer;
