/**
 * GabaritEngine — Orchestrateur gabarit PLU 2D/3D
 * TERLAB Phase 7 — ENSA La Réunion
 *
 * ParcelSet : gestion multi-parcelles (1–5), union convexe, métriques
 * ConstraintSolver : zones constructibles / non-constructibles depuis règles PLU
 */

// ─── Geometry helpers ───────────────────────────────────────────────

function shoelaceArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const { x: x1, y: y1 } = poly[i];
    const { x: x2, y: y2 } = poly[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function centroid(poly) {
  const n = poly.length;
  return {
    x: poly.reduce((s, p) => s + p.x, 0) / n,
    y: poly.reduce((s, p) => s + p.y, 0) / n,
  };
}

function perimeter(poly) {
  let p = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}

function bbox(poly) {
  return {
    minX: Math.min(...poly.map(p => p.x)),
    maxX: Math.max(...poly.map(p => p.x)),
    minY: Math.min(...poly.map(p => p.y)),
    maxY: Math.max(...poly.map(p => p.y)),
  };
}

/** Gift-wrapping (Jarvis march) for convex hull */
function convexHull(points) {
  if (points.length < 3) return [...points];
  let start = points.reduce((best, p) => p.x < best.x || (p.x === best.x && p.y < best.y) ? p : best, points[0]);
  const hull = [];
  let current = start;
  do {
    hull.push(current);
    let next = points[0];
    for (let i = 1; i < points.length; i++) {
      const cross = (next.x - current.x) * (points[i].y - current.y)
                  - (next.y - current.y) * (points[i].x - current.x);
      if (next === current || cross < 0 ||
          (cross === 0 && dist2(current, points[i]) > dist2(current, next))) {
        next = points[i];
      }
    }
    current = next;
  } while (current !== start && hull.length < points.length + 1);
  return hull;
}

function dist2(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/**
 * Inset (shrink) a convex polygon by distance d on each edge.
 * distances can be:
 *  - a number (uniform inset)
 *  - an object { nord, sud, est, ouest } for directional insets
 *  - an array of per-edge distances
 */
function insetPolygon(poly, distances) {
  const n = poly.length;
  if (n < 3) return null;

  // Compute per-edge inset distance
  const edgeDistances = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    let d;
    if (typeof distances === 'number') {
      d = distances;
    } else if (Array.isArray(distances)) {
      d = distances[i] ?? 0;
    } else {
      // Directional: determine edge direction
      const dx = b.x - a.x, dy = b.y - a.y;
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      // Classify edge by outward normal direction
      // Normal points to the left of the edge direction (for CW polygon)
      const normalAngle = angle - 90;
      const na = ((normalAngle % 360) + 360) % 360;
      if (na >= 315 || na < 45) d = distances.est ?? distances.default ?? 0;       // normal points east
      else if (na >= 45 && na < 135) d = distances.sud ?? distances.default ?? 0;   // normal points south
      else if (na >= 135 && na < 225) d = distances.ouest ?? distances.default ?? 0; // normal points west
      else d = distances.nord ?? distances.default ?? 0; // normal points north
    }
    edgeDistances.push(d);
  }

  // For each edge, compute offset line
  const offsetLines = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    // Inward normal (for CCW polygon)
    const nx = -dy / len, ny = dx / len;
    // Check winding — if polygon is CW, flip normal
    const winding = polygonWinding(poly);
    const sign = winding < 0 ? -1 : 1;
    const d = edgeDistances[i];
    offsetLines.push({
      px: a.x + sign * nx * d,
      py: a.y + sign * ny * d,
      dx: dx,
      dy: dy,
    });
  }

  // Intersect consecutive offset lines
  const result = [];
  for (let i = 0; i < offsetLines.length; i++) {
    const l1 = offsetLines[i];
    const l2 = offsetLines[(i + 1) % offsetLines.length];
    const pt = lineLineIntersection(l1, l2);
    if (pt) result.push(pt);
  }

  if (result.length < 3) return null;
  // Check for degenerate (self-intersecting) result
  if (shoelaceArea(result) < 0.01) return null;
  return result;
}

function polygonWinding(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    sum += (b.x - a.x) * (b.y + a.y);
  }
  return sum; // > 0 = CW, < 0 = CCW
}

function lineLineIntersection(l1, l2) {
  const det = l1.dx * l2.dy - l1.dy * l2.dx;
  if (Math.abs(det) < 1e-12) return null;
  const dpx = l2.px - l1.px, dpy = l2.py - l1.py;
  const t = (dpx * l2.dy - dpy * l2.dx) / det;
  return { x: l1.px + t * l1.dx, y: l1.py + t * l1.dy };
}

// ─── ParcelSet ──────────────────────────────────────────────────────

export class ParcelSet {
  constructor() {
    this.parcels = [];
    this.zone = null;
    this.rules = null;
    this.unionPolygon = [];
  }

  addParcel(polygon) {
    if (this.parcels.length >= 5) throw new Error('Max 5 parcelles');
    this.parcels.push({
      id: crypto.randomUUID(),
      polygon: polygon.map(p => ({ x: p.x, y: p.y })),
      locked: false,
      sourceIGN: false,
    });
    this._recomputeUnion();
  }

  removeParcel(id) {
    this.parcels = this.parcels.filter(p => p.id !== id);
    this._recomputeUnion();
  }

  _recomputeUnion() {
    if (this.parcels.length === 0) {
      this.unionPolygon = [];
      return;
    }
    if (this.parcels.length === 1) {
      this.unionPolygon = [...this.parcels[0].polygon];
      return;
    }
    const allPoints = this.parcels.flatMap(p => p.polygon);
    this.unionPolygon = convexHull(allPoints);
  }

  get totalArea() {
    return this.parcels.reduce((s, p) => s + shoelaceArea(p.polygon), 0);
  }

  get perimeter() {
    return perimeter(this.unionPolygon);
  }

  get boundingBox() {
    if (this.unionPolygon.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    return bbox(this.unionPolygon);
  }
}

// ─── ConstraintSolver ───────────────────────────────────────────────

export class ConstraintSolver {
  solve(parcelSet, rules, context) {
    const poly = parcelSet.unionPolygon;
    if (!poly || poly.length < 3) return null;

    const voieSides = Array.isArray(context.hasVoie) ? context.hasVoie : [context.hasVoie].filter(Boolean);
    const userReculs = context.userReculs ?? {};

    // Compute per-edge inset distances based on context
    const bb = bbox(poly);
    const cx = (bb.minX + bb.maxX) / 2;
    const cy = (bb.minY + bb.maxY) / 2;

    const rVoie = userReculs.voie ?? rules.recul_voie_m;
    const rLat = userReculs.lat ?? rules.recul_sep_lat_m;
    const rFond = userReculs.fond ?? rules.recul_sep_fond_m;

    // Build directional inset map
    const insetMap = { nord: rLat, sud: rLat, est: rLat, ouest: rLat, default: rLat };
    // Voie sides get voie recul
    voieSides.forEach(side => {
      const s = side.toLowerCase();
      if (s in insetMap) insetMap[s] = rVoie;
    });
    // Fond = opposite of voie
    const fondSides = { nord: 'sud', sud: 'nord', est: 'ouest', ouest: 'est' };
    voieSides.forEach(side => {
      const opp = fondSides[side.toLowerCase()];
      if (opp && !voieSides.includes(opp)) insetMap[opp] = rFond;
    });

    // Non-constructible zones
    const zones_non_constructibles = [];

    // Bande voie
    voieSides.forEach(side => {
      const zone = this._makeBande(poly, side, rVoie);
      if (zone) zones_non_constructibles.push({
        polygon: zone,
        label: `Recul voie ${rVoie}m`,
        type: 'voie',
        side,
      });
    });

    // Bandes latérales
    const lateralSides = ['nord', 'sud', 'est', 'ouest'].filter(s =>
      !voieSides.includes(s) && !Object.values(fondSides).filter((v, i) =>
        voieSides.includes(Object.keys(fondSides)[i]) && v === s).length
    );
    // Actually simpler: sides that are neither voie nor fond
    const fondSideList = voieSides.map(s => fondSides[s.toLowerCase()]).filter(Boolean);
    const latSides = ['nord', 'sud', 'est', 'ouest'].filter(s =>
      !voieSides.includes(s) && !fondSideList.includes(s)
    );

    latSides.forEach(side => {
      const zone = this._makeBande(poly, side, rLat);
      if (zone) zones_non_constructibles.push({
        polygon: zone,
        label: `Recul lat. ${rLat}m`,
        type: 'lateral',
        side,
      });
    });

    // Bande fond
    fondSideList.forEach(side => {
      const zone = this._makeBande(poly, side, rFond);
      if (zone) zones_non_constructibles.push({
        polygon: zone,
        label: `Recul fond ${rFond}m`,
        type: 'fond',
        side,
      });
    });

    // Zone constructible = inset polygon
    const emprise_constructible = insetPolygon(poly, insetMap) ?? [];

    // Zones mitoyen zone N
    let zones_mitoyen_n = null;
    if (context.hasZoneN && rules.mitoyen_zone_n_bande_m) {
      zones_mitoyen_n = [];
      fondSideList.forEach(side => {
        const zone = this._makeBande(poly, side, rules.mitoyen_zone_n_bande_m);
        if (zone) zones_mitoyen_n.push({
          polygon: zone,
          label: `Mitoyen N — ${rules.mitoyen_zone_n_hauteur_limite}`,
          type: 'mitoyen_n',
          side,
          hauteur_limite: rules.mitoyen_zone_n_hauteur_limite,
        });
      });
    }

    const empriseArea = emprise_constructible.length >= 3 ? shoelaceArea(emprise_constructible) : 0;
    const totalArea = parcelSet.totalArea;
    const nonConstArea = totalArea - empriseArea;

    return {
      zones_non_constructibles,
      emprise_constructible,
      zones_mitoyen_n,
      volumes: {
        he: rules.he_max_m,
        hf: rules.hf_max_m,
        he_bande_voie: rules.he_bande_voie_m,
        hf_bande_voie: rules.hf_bande_voie_m,
        bande_voie_profondeur: rules.bande_voie_profondeur_m,
      },
      zone_permeable: {
        pct: rules.permeable_min_pct,
        surface_m2: totalArea * rules.permeable_min_pct / 100,
      },
      metrics: {
        surface_parcelle_m2: totalArea,
        surface_constructible_m2: empriseArea,
        surface_non_constructible_m2: nonConstArea,
        ratio_constructible_pct: totalArea > 0 ? (empriseArea / totalArea * 100) : 0,
        surface_permeable_min_m2: totalArea * rules.permeable_min_pct / 100,
        hauteur_egout_max: rules.he_max_m,
        hauteur_faitage_max: rules.hf_max_m,
      },
    };
  }

  /**
   * Create a bande (strip) polygon on one side of the bounding box
   * side: 'nord'|'sud'|'est'|'ouest'
   * d: distance in meters
   */
  _makeBande(poly, side, d) {
    if (d <= 0) return null;
    const b = bbox(poly);
    switch (side) {
      case 'nord':
        return [
          { x: b.minX, y: b.minY },
          { x: b.maxX, y: b.minY },
          { x: b.maxX, y: b.minY + d },
          { x: b.minX, y: b.minY + d },
        ];
      case 'sud':
        return [
          { x: b.minX, y: b.maxY - d },
          { x: b.maxX, y: b.maxY - d },
          { x: b.maxX, y: b.maxY },
          { x: b.minX, y: b.maxY },
        ];
      case 'ouest':
        return [
          { x: b.minX, y: b.minY },
          { x: b.minX + d, y: b.minY },
          { x: b.minX + d, y: b.maxY },
          { x: b.minX, y: b.maxY },
        ];
      case 'est':
        return [
          { x: b.maxX - d, y: b.minY },
          { x: b.maxX, y: b.minY },
          { x: b.maxX, y: b.maxY },
          { x: b.maxX - d, y: b.maxY },
        ];
      default:
        return null;
    }
  }
}

// ─── GabaritEngine (orchestrateur) ──────────────────────────────────

export class GabaritEngine {
  constructor() {
    this.parcelSet = new ParcelSet();
    this.solver = new ConstraintSolver();
    this.rules = null;
    this.currentZone = null;
  }

  async loadRules(url = '../data/plu-rules.json') {
    const resp = await fetch(url);
    this.rules = await resp.json();
    return this.rules;
  }

  setZone(zoneKey) {
    this.currentZone = zoneKey;
    this.parcelSet.zone = zoneKey;
    this.parcelSet.rules = this.rules?.zones?.[zoneKey] ?? null;
  }

  solve(parcelSet, zoneRules, context) {
    return this.solver.solve(parcelSet ?? this.parcelSet, zoneRules, context);
  }

  getZoneRules(zoneKey) {
    return this.rules?.zones?.[zoneKey ?? this.currentZone] ?? null;
  }

  getZoneList() {
    if (!this.rules?.zones) return [];
    return Object.entries(this.rules.zones).map(([key, z]) => ({
      key,
      label: `${key} — ${z.label}`,
    }));
  }
}

// Expose for non-module usage
if (typeof window !== 'undefined') {
  window.GabaritEngine = GabaritEngine;
  window.ParcelSet = ParcelSet;
  window.ConstraintSolver = ConstraintSolver;
}

export default GabaritEngine;
