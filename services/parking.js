/**
 * TERLAB · parking.js
 * Resolution parking + placement geometrique.
 * Aucune mutation d'etat — fonctions pures.
 *
 * layoutPockets : parking en POCHES desservies (NF P 91-120) — bataille
 * 2,30 × 5,00 m autour d'une allee de 5,00 m, desserte tracee depuis la voie
 * (bateau + bande oblique 5,00 m double sens, a defaut 2,80 m sens unique),
 * complement SS pointille sous les lames + rampe. Porte du POC
 * docs/etude-capacite-v2.html le 2026-07-11.
 */

import CAP from './capacite-polygone.js';

const PK_M2 = 25; // m2 par place de parking (2.5 × 5m + circ)

/**
 * Resout le mode parking optimal selon le budget et le choix utilisateur.
 * @param {Object} params
 * @param {number} params.nbLgts - nombre de logements
 * @param {number} params.emprise - emprise au sol du batiment (m2)
 * @param {number} params.budgetPerm - budget impermeable total (m2)
 * @param {string} params.userChoice - 'auto' | 'ext' | 'rdc' | 'ss'
 * @returns {Object} { mode, pkExt, pkRdc, pkSS, pkTotal, empPark, warning? }
 */
export function resolveParking({ nbLgts, emprise, budgetPerm, userChoice = 'auto' }) {
  const pkTotal = nbLgts * 2; // 2 places par logement
  const pkExtM2 = pkTotal * PK_M2;

  if (userChoice === 'ss') {
    return { mode: 'ss', pkExt: 0, pkRdc: 0, pkSS: pkTotal, pkTotal, empPark: 0 };
  }

  if (userChoice === 'rdc') {
    const rdcCap = Math.floor(emprise * 0.80 / PK_M2);
    const surplus = Math.max(0, pkTotal - rdcCap);
    return { mode: 'rdc', pkExt: 0, pkRdc: Math.min(rdcCap, pkTotal), pkSS: surplus, pkTotal, empPark: 0 };
  }

  if (userChoice === 'ext') {
    if (emprise + pkExtM2 <= budgetPerm) {
      return { mode: 'ext', pkExt: pkTotal, pkRdc: 0, pkSS: 0, pkTotal, empPark: pkExtM2 };
    }
    // Ext ne passe pas → warning
    const maxPkExt = Math.max(0, Math.floor((budgetPerm - emprise) / PK_M2));
    const surplus = pkTotal - maxPkExt;
    return {
      mode: 'ext', pkExt: maxPkExt, pkRdc: 0, pkSS: surplus, pkTotal,
      empPark: maxPkExt * PK_M2,
      warning: `PK ext partiel : ${maxPkExt}/${pkTotal} places (budget perm. depasse) — ${surplus} en SS`,
    };
  }

  // Auto : ext si possible, sinon rdc, sinon ss
  if (emprise + pkExtM2 <= budgetPerm) {
    return { mode: 'ext', pkExt: pkTotal, pkRdc: 0, pkSS: 0, pkTotal, empPark: pkExtM2 };
  }
  const rdcCap = Math.floor(emprise * 0.80 / PK_M2);
  if (rdcCap >= pkTotal) {
    return { mode: 'rdc', pkExt: 0, pkRdc: pkTotal, pkSS: 0, pkTotal, empPark: 0 };
  }
  return { mode: 'ss', pkExt: 0, pkRdc: 0, pkSS: pkTotal, pkTotal, empPark: 0 };
}

/**
 * Place le parking exterieur geometriquement cote voie.
 * Retourne un polygone [[x,y],...] representant la zone parking.
 *
 * @param {Array} parcelPoly - polygone parcelle [[x,y],...]
 * @param {Array<string>} edgeTypes - type par arete ['voie','lat','fond',...]
 * @param {number} pkExtM2 - surface parking ext requise (m2)
 * @param {Array} blocPolys - polygones des batiments [{polygon:[{x,y}]},...]
 * @returns {{ polygon: Array<[number,number]>, label: string } | null}
 */
export function placeParkingExt(parcelPoly, edgeTypes, pkExtM2, blocPolys = []) {
  if (pkExtM2 <= 0 || !parcelPoly?.length) return null;

  // Trouver l'arete voie la plus longue
  const n = parcelPoly.length;
  let bestIdx = -1, bestLen = 0;
  for (let i = 0; i < n; i++) {
    if (edgeTypes[i] !== 'voie') continue;
    const [x1, y1] = parcelPoly[i], [x2, y2] = parcelPoly[(i + 1) % n];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len > bestLen) { bestLen = len; bestIdx = i; }
  }

  if (bestIdx < 0) return null;

  const [ax, ay] = parcelPoly[bestIdx];
  const [bx, by] = parcelPoly[(bestIdx + 1) % n];
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;

  // Normale inward (parcelle supposée CCW ; sinon le clip caller corrige)
  const nx = -dy / len, ny = dx / len;

  // Dimensions parking : profondeur 5m standard, longueur = pkExtM2 / 5
  const profondeur = 5;
  const longueur = Math.min(len * 0.9, pkExtM2 / profondeur);

  const margin = 1;
  const ux = dx / len, uy = dy / len;

  // Rectangle centre sur la fraction f de l'arete voie
  const mkRect = (f) => {
    const cx = ax + dx * f, cy = ay + dy * f;
    return [
      [cx - ux * longueur / 2 + nx * margin,               cy - uy * longueur / 2 + ny * margin],
      [cx + ux * longueur / 2 + nx * margin,               cy + uy * longueur / 2 + ny * margin],
      [cx + ux * longueur / 2 + nx * (margin + profondeur), cy + uy * longueur / 2 + ny * (margin + profondeur)],
      [cx - ux * longueur / 2 + nx * (margin + profondeur), cy - uy * longueur / 2 + ny * (margin + profondeur)],
    ];
  };

  // Glisser le long de la voie jusqu'a une position SANS batiment dessous —
  // blocPolys etait recu mais jamais utilise : le parking chevauchait les blocs.
  const blocs = (blocPolys ?? [])
    .map(bl => (bl.polygon ?? bl ?? []).map(p => [p.x ?? p[0], p.y ?? p[1]]))
    .filter(p => p.length >= 3);
  const fMin = Math.min(0.5, longueur / (2 * len) + 0.02);
  const clamp = f => Math.max(fMin, Math.min(1 - fMin, f));
  // Aucune position libre (parking long / bloc central) → celle qui chevauche
  // le moins.
  let polygon = null, bestOverlap = Infinity;
  for (const f of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]) {
    const rect = mkRect(clamp(f));
    const overlap = blocs.reduce((s, bp) => s + _overlapArea(bp, rect), 0);
    if (overlap <= 1) { polygon = rect; break; }
    if (overlap < bestOverlap) { bestOverlap = overlap; polygon = rect; }
  }

  const places = Math.floor(pkExtM2 / PK_M2);
  return {
    polygon,
    label: `${places} PK ext`,
    profondeur,
    longueur,
  };
}

/** Aire d'intersection bloc ∩ rect en m² (SH, clip = rect convexe) */
function _overlapArea(subject, rectClip) {
  let out = subject.map(p => [...p]);
  const m = rectClip.length;
  // orientation du rect pour que "interieur" = cross >= 0
  let sa = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    sa += rectClip[i][0] * rectClip[j][1] - rectClip[j][0] * rectClip[i][1];
  }
  const clip = sa < 0 ? [...rectClip].reverse() : rectClip;
  for (let i = 0; i < m && out.length; i++) {
    const [ax, ay] = clip[i], [bx, by] = clip[(i + 1) % m];
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k++) {
      const [px, py] = input[k], [qx, qy] = input[(k + 1) % input.length];
      const dp = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
      const dq = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
      if (dp >= 0) {
        out.push([px, py]);
        if (dq < 0) { const t = dp / (dp - dq); out.push([px + t * (qx - px), py + t * (qy - py)]); }
      } else if (dq >= 0) {
        const t = dp / (dp - dq);
        out.push([px + t * (qx - px), py + t * (qy - py)]);
      }
    }
  }
  if (out.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < out.length; i++) {
    const j = (i + 1) % out.length;
    a += out[i][0] * out[j][1] - out[j][0] * out[i][1];
  }
  return Math.abs(a) / 2;
}

/** Point dans polygone (ray casting) */
function _ptInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Parking en poches desservies (NF P 91-120).
 * @param {Object} o
 * @param {Array} o.parcelPoly   — [[x,y]...] parcelle locale
 * @param {string[]} o.edgeTypes — types par arete ('voie'|'lat'|'fond')
 * @param {Object} o.reculs      — { voie, lat, fond } (info, non bloquant)
 * @param {number} o.nPlaces     — places requises
 * @param {Array} o.buildings    — [{ footprint:[[x,y]...], axis?, normalSign?, kind? }]
 * @param {number} [o.prof=10.5] — profondeur des lames (rangee SS sous lame)
 * @returns {{ stalls, aisles, lanes, under, underLanes, ramp, access,
 *             placed, senUnique?, rampShort?, _trace }}
 */
export function layoutPockets(o) {
  const { parcelPoly, edgeTypes, nPlaces, buildings } = o;
  const prof = o.prof ?? 10.5;
  const out = { stalls: [], aisles: [], lanes: [], under: [], underLanes: [], ramp: null, access: null, placed: 0, _trace: [] };
  const n = parcelPoly.length;
  const fps = buildings.map(b => b.footprint);
  const inP = (x, y) => _ptInPoly(x, y, parcelPoly);
  // arete voie la plus longue
  let bi = -1, bl = 0;
  for (let i = 0; i < n; i++) {
    if (edgeTypes[i] !== 'voie') continue;
    const [x1, y1] = parcelPoly[i], [x2, y2] = parcelPoly[(i + 1) % n];
    const l = Math.hypot(x2 - x1, y2 - y1);
    if (l > bl) { bl = l; bi = i; }
  }
  if (bi < 0 || bl < 8) return out;
  const [ax, ay] = parcelPoly[bi], [bx, by] = parcelPoly[(bi + 1) % n];
  const ux = (bx - ax) / bl, uy = (by - ay) / bl;
  let nx = -uy, ny = ux;
  if (!inP((ax + bx) / 2 + nx * 2, (ay + by) / 2 + ny * 2)) { nx = -nx; ny = -ny; }
  const P = (c, d) => [ax + ux * c + nx * d, ay + uy * c + ny * d];
  const quadCD = (c0, c1, d0, d1) => [P(c0, d0), P(c1, d0), P(c1, d1), P(c0, d1)];
  // NF P 91-120 tab.2 : bataille 90° = 2,30 × 5,00, voie de desserte 5,00 ;
  // §5.1.2 : circulation ≥ 2,80 sens unique / 5,00 double sens.
  const M = 0.5, AISLE = 5.0, SD = 5.0, SW = 2.3;
  const thickSeg = (p, q, w) => {
    const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
    const hx = -dy / l * w / 2, hy = dx / l * w / 2;
    return [[p[0] - hx, p[1] - hy], [q[0] - hx, q[1] - hy], [q[0] + hx, q[1] + hy], [p[0] + hx, p[1] + hy]];
  };
  let maxD = 0;
  for (const [px, py] of parcelPoly) maxD = Math.max(maxD, (px - ax) * nx + (py - ay) * ny);

  // ── Poche exterieure : allee [d, d+5], bataille des deux cotes, desserte
  // obligatoire (bateau + oblique) ──
  let best = null;
  for (let d = M; d + AISLE + SD <= maxD - 0.5 && (!best || best.eff < nPlaces); d += 1.5) {
    const rows = [{ d0: d + AISLE, d1: d + AISLE + SD }];
    if (d - SD >= 0.4) rows.push({ d0: d - SD, d1: d });
    const direct = d <= M + 0.1;
    const stalls = [];
    let fC = null, lC = null;
    for (let c = 1.2; c + SW <= bl - 1 && stalls.length < nPlaces + 3; c += SW) {
      for (const r of rows) {
        if (stalls.length >= nPlaces + 3) break;
        const s = quadCD(c, c + SW, r.d0, r.d1);
        if (s.every(([px, py]) => inP(px, py)) && fps.every(f => CAP._lameSpacingOK(s, f, 0.4))) {
          stalls.push(s);
          if (fC === null) fC = c;
          lC = c + SW;
        }
      }
    }
    if (!stalls.length) { out._trace.push(`d=${d.toFixed(1)}: 0 place`); continue; }
    let corridor = 'direct', removedIdx = [];
    if (!direct) {
      corridor = null;
      const a0 = Math.max(0.3, fC - 2.5), a1 = Math.min(bl - 0.3, lC + 1);
      const targets = [];
      for (let c2 = a0 + 1.2; c2 <= a1 - 1.2; c2 += 4) targets.push(P(c2, d + AISLE / 2));
      if (!targets.length) targets.push(P((a0 + a1) / 2, d + AISLE / 2));
      let bestCorr = null;
      for (const w of [5.0, 2.8]) {
        for (let c = 1.0; c + w <= bl - 0.5; c += 3) {
          const stub = quadCD(c, c + w, 0.15, w / 2 + 0.8);
          const start = P(c + w / 2, w / 2 + 0.6);
          for (const tgt of targets) {
            const q = thickSeg(start, tgt, w);
            if (!q.every(([px, py]) => inP(px, py)) || !stub.every(([px, py]) => inP(px, py))) continue;
            if (!fps.every(f => CAP._lameSpacingOK(q, f, 0.3) && CAP._lameSpacingOK(stub, f, 0.25))) continue;
            const hit = [];
            stalls.forEach((s, i) => { if (!CAP._lameSpacingOK(s, q, 0.05) || !CAP._lameSpacingOK(s, stub, 0.05)) hit.push(i); });
            const len = Math.hypot(tgt[0] - start[0], tgt[1] - start[1]);
            const cost = hit.length * 100 + len;
            if (!bestCorr || cost < bestCorr.cost) bestCorr = { quad: q, stub, start, tgt, w, hit, cost, accessPt: P(c + w / 2, 0.1) };
          }
        }
        if (bestCorr) break;
      }
      if (!bestCorr) { out._trace.push(`d=${d.toFixed(1)}: ${stalls.length} pl, 0 desserte`); continue; }
      corridor = bestCorr;
      removedIdx = bestCorr.hit;
    }
    const kept = stalls.filter((_, i) => !removedIdx.includes(i)).slice(0, nPlaces);
    if (!kept.length) continue;
    if (!best || kept.length > best.eff) best = { d, stalls: kept, fC, lC, corridor, eff: kept.length };
  }
  if (best) {
    out.stalls = best.stalls;
    const a0 = Math.max(0.3, best.fC - 2.5), a1 = Math.min(bl - 0.3, best.lC + 1);
    out.aisles.push(quadCD(a0, a1, best.d, best.d + AISLE));
    out.lanes.push([P(a0 + 0.5, best.d + AISLE / 2), P(a1 - 0.8, best.d + AISLE / 2)]);
    if (best.corridor !== 'direct') {
      const { quad, stub, start, tgt, w, accessPt } = best.corridor;
      out.aisles.push(stub, quad);
      out.lanes.push([accessPt, start, tgt]);
      out.access = accessPt;
      if (w < 5) out.senUnique = true;
    } else {
      out.access = P(a0 + 2.2, 0.1);
    }
  } else {
    out.access = P(bl / 2, 0.1);
  }
  out.placed = out.stalls.length;

  // ── Complement SOUS batiment (lames) : allee + bataille pointillees ──
  let missing = nPlaces - out.placed;
  if (missing > 0) {
    for (const b of buildings) {
      if (missing <= 0) break;
      if (!b.axis || b.axis.length < 2) continue;
      const ns = b.normalSign ?? 1;
      const lane = [];
      for (let i = 0; i < b.axis.length - 1 && missing > 0; i++) {
        const [x1, y1] = b.axis[i], [x2, y2] = b.axis[i + 1];
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < 3) continue;
        const tux = (x2 - x1) / len, tuy = (y2 - y1) / len;
        const tnx = -tuy * ns, tny = tux * ns;
        if (!lane.length) lane.push([x1 + tnx * 2.8, y1 + tny * 2.8]);
        lane.push([x2 + tnx * 2.8, y2 + tny * 2.8]);
        for (let c = 1.5; c + SW <= len - 0.5 && missing > 0; c += SW) {
          const q = [
            [x1 + tux * c + tnx * (prof - 5.3), y1 + tuy * c + tny * (prof - 5.3)],
            [x1 + tux * (c + SW) + tnx * (prof - 5.3), y1 + tuy * (c + SW) + tny * (prof - 5.3)],
            [x1 + tux * (c + SW) + tnx * (prof - 0.3), y1 + tuy * (c + SW) + tny * (prof - 0.3)],
            [x1 + tux * c + tnx * (prof - 0.3), y1 + tuy * c + tny * (prof - 0.3)],
          ];
          const cx = q.reduce((s2, p) => s2 + p[0], 0) / 4, cy = q.reduce((s2, p) => s2 + p[1], 0) / 4;
          if (!_ptInPoly(cx, cy, b.footprint)) continue;
          out.under.push(q);
          missing--;
        }
      }
      if (lane.length >= 2) out.underLanes.push(lane);
    }
    // rampe SS : 15 m vises (pente ≤ 18 %), sinon 8 m + rampShort
    if (out.under.length) {
      const dRef = (best?.d ?? M) + 0.6;
      const c0 = Math.max(0.5, (best?.fC ?? 3) - 2.2);
      const cands = [
        { q: quadCD(c0, c0 + 15, dRef, dRef + 3.5), short: false },
        { q: quadCD(1, 16, M + 0.4, M + 3.9), short: false },
        { q: quadCD(c0, c0 + 8, dRef, dRef + 3.5), short: true },
        { q: quadCD(1, 9, M + 0.4, M + 3.9), short: true },
      ];
      for (const cand of cands) {
        if (cand.q.every(([px, py]) => inP(px, py)) && fps.every(f => CAP._lameSpacingOK(cand.q, f, 0.2))) {
          out.ramp = cand.q;
          out.rampShort = cand.short;
          break;
        }
      }
    }
  }
  return out;
}

const Parking = { resolveParking, placeParkingExt, layoutPockets, PK_M2 };
if (typeof window !== 'undefined') window.Parking = Parking;
export default Parking;
