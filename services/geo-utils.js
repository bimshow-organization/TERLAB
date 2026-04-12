// terlab/services/geo-utils.js · Utilitaires géométrie polygonale partagés
// ENSA La Réunion · MGA Architecture 2026
// Vanilla JS ES2022+, aucune dépendance externe
//
// Module léger : centralise les helpers géom utilisés par EsquisseCanvas,
// EnvelopeGenerator, GabaritEngine et AutoPlanStrategies. Format unique
// {x,y} (objets), pas [x,y] (arrays). Pour le format array, voir
// TerrainP07Adapter (qui a sa propre famille de helpers, indépendante).
//
// /**
//  * @coords
//  *   project:   TERLAB
//  *   plan:      XY
//  *   yAxis:     down (espace SVG/canvas) — fonctions agnostiques au signe
//  *   anchor:    local(0,0)
//  *   units:     meters
//  *   bearing:   none
//  *   north:     none
//  *   pairsWith: services/terrain-p07-adapter.js (équivalent format array)
//  *   roundtrip: removeAcuteSpikes(removeAcuteSpikes(p)) === removeAcuteSpikes(p)
//  */
//
// Convention orientation : `signedArea` retourne > 0 pour CCW (math standard,
// Y-up). En espace SVG Y-down, un polygone "visuellement CCW" donne signedArea
// < 0. Les fonctions qui s'en soucient (removeAcuteSpikes, expandFaceMitoyenne)
// déduisent le sens en interne et fonctionnent dans les deux conventions.

const GeoUtils = {

  // ── Aire signée (Shoelace) ────────────────────────────────────────
  // > 0 = CCW math standard / < 0 = CW math (= CCW visuel en Y-down SVG)
  signedArea(pts) {
    let a = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return a / 2;
  },

  polyArea(pts) {
    return Math.abs(this.signedArea(pts));
  },

  // ── Convexité ──────────────────────────────────────────────────────
  isConvex(pts) {
    const n = pts.length;
    if (n < 4) return true;
    let sign = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n], c = pts[(i + 2) % n];
      const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cr) < 1e-6) continue;
      const s = cr > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  },

  // ── Point dans polygone (Ray casting) ─────────────────────────────
  pointInPoly(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      if (((yi > p.y) !== (yj > p.y)) &&
          (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  },

  // ── Intersection de deux droites (forme paramétrique) ─────────────
  // Robuste : midpoint fallback si parallèles
  lineIsect(p1, p2, p3, p4) {
    const a = p2.x - p1.x, b = p2.y - p1.y;
    const c = p4.x - p3.x, d = p4.y - p3.y;
    const e = a * d - b * c;
    if (Math.abs(e) < 1e-9) return { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
    const t = ((p3.x - p1.x) * d - (p3.y - p1.y) * c) / e;
    return { x: p1.x + t * a, y: p1.y + t * b };
  },

  // ── Clipping Sutherland-Hodgman (clipper CONVEXE requis) ─────────
  // Fonctionne en CCW comme en CW. Le clipper est ré-ordonné en CCW math
  // si nécessaire avant la boucle.
  clipSH(subj, clip) {
    if (!subj || subj.length < 3 || !clip || clip.length < 3) return [];
    const sa = this.signedArea(clip);
    const cc = sa < 0 ? [...clip].reverse() : clip;
    const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    let out = [...subj];
    for (let i = 0; i < cc.length && out.length >= 2; i++) {
      const inp = out;
      out = [];
      const a = cc[i], b = cc[(i + 1) % cc.length];
      for (let j = 0; j < inp.length; j++) {
        const p = inp[j], q = inp[(j + 1) % inp.length];
        const pIn = cross(a, b, p) >= 0;
        const qIn = cross(a, b, q) >= 0;
        if (pIn) {
          out.push(p);
          if (!qIn) out.push(this.lineIsect(a, b, p, q));
        } else if (qIn) {
          out.push(this.lineIsect(a, b, p, q));
        }
      }
    }
    return out.length >= 3 ? out : [];
  },

  // ── Suppression des éperons aigus (angle intérieur < seuil) ───────
  // RÈGLE PLU : aucun angle de la zone constructible ne peut être < 90°.
  // Résulte du croisement de deux bandes de recul à un angle de limite oblique.
  // Appliqué APRÈS un offset polygonal et APRÈS expandFaceMitoyenne.
  // Itératif — converge en général en 1-2 passes.
  //
  // Note: complémentaire au "spike guard" classique (dist > k*diag) qui catche
  // les divergences de droites parallèles. Ici on catche les sommets convexes
  // valides mais trop pointus (typiquement R / sin(θ/2) avec θ < 90°).
  removeAcuteSpikes(poly, minAngleDeg = 90) {
    if (!poly || poly.length < 3) return poly;
    const thresh = Math.cos(minAngleDeg * Math.PI / 180); // cos(90°) = 0
    let pts = poly.map(p => ({ x: p.x, y: p.y }));
    let changed = true;
    let safety = pts.length * 3;
    while (changed && safety-- > 0 && pts.length >= 4) {
      changed = false;
      const sa = this.signedArea(pts);
      const ccw = sa > 0;
      const keep = [];
      for (let i = 0; i < pts.length; i++) {
        const pp = pts[(i - 1 + pts.length) % pts.length];
        const p  = pts[i];
        const pn = pts[(i + 1) % pts.length];
        const v1x = pp.x - p.x, v1y = pp.y - p.y;
        const v2x = pn.x - p.x, v2y = pn.y - p.y;
        const len1 = Math.hypot(v1x, v1y);
        const len2 = Math.hypot(v2x, v2y);
        if (len1 < 0.5 || len2 < 0.5) { keep.push(p); continue; }
        const dot   = (v1x * v2x + v1y * v2y) / (len1 * len2);
        const cross = v1x * v2y - v1y * v2x;
        // Edges réels : a=p-pp, b=pn-p. v1=-a, v2=b → cross(v1,v2) = -cross(a,b).
        // Pour CCW math, sommet convexe ⇔ cross(a,b)>0 ⇔ cross(v1,v2)<0.
        // Pour CW (= CCW visuel en Y-down), c'est l'inverse.
        const isConvex = ccw ? cross < 0 : cross > 0;
        // dot > cos(90°)=0 ⇔ angle intérieur < 90° (éperon aigu)
        if (isConvex && dot > thresh + 1e-4) {
          changed = true; // Éperon : supprimer ce sommet
        } else {
          keep.push(p);
        }
      }
      if (changed) pts = keep;
    }
    return pts.length >= 3 ? pts : poly;
  },

  // ── Expansion face mitoyenne → snap flush sur limite oblique ──────
  // Règle binaire PLU : MITOYEN = mur collé sur la limite séparative.
  // Pour chaque arête mitoyenne (recul[i] === 0, type === 'lateral') :
  //   1. Identifier les sommets du bâtiment les plus proches de la limite
  //   2. Les pousser au-delà (EXPAND large) vers l'extérieur
  //   3. Le clip ultérieur sur la zone constructible → la face = limite exacte
  // Fonctionne même si la limite est oblique (trapèze, biais, bec).
  //
  // @param {Array<{x,y}>|Array<Array<{x,y}>>} bat — polygone bâtiment ou liste
  // @param {Array<{x,y}>} parc                    — polygone parcelle
  // @param {number[]}    edgeReculs               — recul m par arête parcelle
  // @param {string[]}    edgeTypes                — type par arête parcelle
  // @returns {Array<{x,y}>|Array<Array<{x,y}>>} bâtiment(s) avec faces étendues
  // ── Arc interpolation aux coins de la zone constructible ──────────
  // Post-processeur Minkowski : remplace les coins vifs de zonePoly
  // (issus du clipping demi-plan Sutherland-Hodgman) par des arcs
  // circulaires quand deux aretes adjacentes de la parcelle ont un recul > 0.
  //
  // @param {Array<{x,y}>} zonePoly  — zone constructible (resultat de insetPoly)
  // @param {Array<{x,y}>} parcPoly  — polygone parcelle (meme orientation)
  // @param {number[]}     reculs    — recul par arete parcelle (arete i = parcPoly[i]->parcPoly[i+1])
  // @param {number}       [nSegments=6] — nombre de segments par arc
  // @returns {Array<{x,y}>} zone modifiee avec arcs aux coins
  arcInterpolateCorners(zonePoly, parcPoly, reculs, nSegments = 6) {
    if (!zonePoly || zonePoly.length < 3 || !parcPoly || parcPoly.length < 3) return zonePoly;
    const nParc = parcPoly.length;
    const sa = this.signedArea(parcPoly);
    // cw = +1 si parcelle CW math (sa < 0), -1 si CCW math (sa > 0)
    // Utilise pour calculer la normale interieure coherente
    const cw = sa > 0 ? 1 : -1;

    // Normales interieures de chaque arete parcelle
    const normals = [];
    for (let i = 0; i < nParc; i++) {
      const j = (i + 1) % nParc;
      const dx = parcPoly[j].x - parcPoly[i].x;
      const dy = parcPoly[j].y - parcPoly[i].y;
      const len = Math.hypot(dx, dy);
      if (len < 0.1) { normals.push(null); continue; }
      normals.push({ nx: cw * (-dy / len), ny: cw * (dx / len) });
    }

    // Pour chaque sommet de zonePoly, verifier s'il correspond a un coin parcelle
    // ou deux aretes a recul > 0 se rencontrent. On matche par proximite
    // au sommet parcelle decale par les deux normales.
    const EPS_MATCH = 0.15; // tolerance metres pour matcher un coin

    const result = [];
    for (let zi = 0; zi < zonePoly.length; zi++) {
      const zv = zonePoly[zi];

      // Chercher si ce sommet correspond a un coin parcelle avec 2 reculs > 0
      let matched = false;
      for (let k = 0; k < nParc; k++) {
        const iPrev = (k - 1 + nParc) % nParc;
        const iNext = k;
        const rPrev = reculs[iPrev] || 0;
        const rNext = reculs[iNext] || 0;
        if (rPrev <= 0 || rNext <= 0) continue;

        const nP = normals[iPrev];
        const nN = normals[iNext];
        if (!nP || !nN) continue;

        // Le coin sharp attendu = intersection des deux droites offset
        const V = parcPoly[k];
        // Point sur la droite offset prev : V + nP * rPrev, direction arete prev
        const prevStart = parcPoly[iPrev];
        const op1 = { x: prevStart.x + nP.nx * rPrev, y: prevStart.y + nP.ny * rPrev };
        const op2 = { x: V.x + nP.nx * rPrev, y: V.y + nP.ny * rPrev };
        // Point sur la droite offset next : V + nN * rNext, direction arete next
        const nextEnd = parcPoly[(k + 1) % nParc];
        const op3 = { x: V.x + nN.nx * rNext, y: V.y + nN.ny * rNext };
        const op4 = { x: nextEnd.x + nN.nx * rNext, y: nextEnd.y + nN.ny * rNext };
        const isect = this.lineIsect(op1, op2, op3, op4);

        const dist = Math.hypot(zv.x - isect.x, zv.y - isect.y);
        if (dist > EPS_MATCH) continue;

        // Match ! Remplacer par arc
        matched = true;
        const angStart = Math.atan2(nP.ny, nP.nx);
        const angEnd   = Math.atan2(nN.ny, nN.nx);

        // Sweep direction basee sur le winding du polygone
        let delta = angEnd - angStart;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta <= -Math.PI) delta += 2 * Math.PI;
        if (sa < 0 && delta > 0) delta -= 2 * Math.PI;
        if (sa > 0 && delta < 0) delta += 2 * Math.PI;

        for (let s = 0; s <= nSegments; s++) {
          const t = s / nSegments;
          const a = angStart + delta * t;
          const R = (1 - t) * rPrev + t * rNext;
          result.push({ x: V.x + R * Math.cos(a), y: V.y + R * Math.sin(a) });
        }
        break;
      }

      if (!matched) {
        result.push({ x: zv.x, y: zv.y });
      }
    }

    return result.length >= 3 ? result : zonePoly;
  },

  // ── Inlet notch on mitoyen boundary ────────────────────────────────
  // Builds a 4-vertex rectangular notch polygon perpendicular to a parcel
  // edge at the inlet position. The notch represents the setback (encoche)
  // on a mitoyen boundary: mitoyen1 → inlet → mitoyen2.
  //
  // @param {Array<{x,y}>} parcPoly    — parcel polygon ({x,y} format)
  // @param {number}       edgeIdx     — index of the mitoyen edge in parcPoly
  // @param {Object}       inletData   — { lmit1, linlet, prof, lmit2 }
  // @param {number}       signedAreaVal — signed area of parcPoly (for winding detection)
  // @returns {{ notch: [{x,y}...], cx, cy } | null}
  buildInletNotch(parcPoly, edgeIdx, inletData, signedAreaVal) {
    if (!parcPoly || parcPoly.length < 3) return null;
    const n = parcPoly.length;
    const i = edgeIdx;
    const j = (i + 1) % n;
    const p1 = parcPoly[i], p2 = parcPoly[j];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const edgeLen = Math.hypot(dx, dy);
    if (edgeLen < 1) return null;

    // Unit tangent (along edge) and inward normal
    const tx = dx / edgeLen, ty = dy / edgeLen;
    const cw = signedAreaVal > 0 ? 1 : -1;
    const nx = cw * (-dy / edgeLen), ny = cw * (dx / edgeLen);

    const { lmit1, linlet, prof } = inletData;
    if (!linlet || linlet <= 0 || !prof || prof <= 0) return null;

    // Verify the profile fits on the edge
    const totalM = (lmit1 || 0) + linlet + (inletData.lmit2 || 0);
    if (totalM > edgeLen + 0.5) return null;

    // Coordinates are in meters (no SC conversion needed)
    const startM = (lmit1 || 0);
    const endM = startM + linlet;
    const profM = prof;

    // 4 corners of the notch rectangle perpendicular to the edge, towards interior
    const c1 = { x: p1.x + tx * startM,            y: p1.y + ty * startM };
    const c2 = { x: p1.x + tx * endM,              y: p1.y + ty * endM };
    const c3 = { x: p1.x + tx * endM + nx * profM, y: p1.y + ty * endM + ny * profM };
    const c4 = { x: p1.x + tx * startM + nx * profM, y: p1.y + ty * startM + ny * profM };

    const notch = [c1, c2, c3, c4];
    const cx = (c1.x + c2.x + c3.x + c4.x) / 4;
    const cy = (c1.y + c2.y + c3.y + c4.y) / 4;

    return { notch, cx, cy };
  },

  // ── Subtract convex notch from zone (complement Sutherland-Hodgman) ──
  // Subtracts a convex polygon (notch) from a zone polygon.
  // Uses Sutherland-Hodgman with the notch edges in CW order: SH keeps
  // points on the LEFT of each clip edge. With CW winding, LEFT = exterior
  // of the notch. Sequential clipping by all notch edges produces the zone
  // minus the notch interior, correctly routing along the notch boundary
  // where it intersects the zone. The parcel-boundary edge of the notch
  // (c1→c2 on the limit separative) is a no-op since the zone is already
  // on the exterior side.
  //
  // @param {Array<{x,y}>} zonePoly  — zone constructible
  // @param {Array<{x,y}>} notchPoly — convex notch polygon (4 vertices)
  // @returns {Array<{x,y}>} zone with notch subtracted
  subtractNotchFromZone(zonePoly, notchPoly) {
    if (!zonePoly || zonePoly.length < 3 || !notchPoly || notchPoly.length < 3) return zonePoly;

    const notchSA = this.signedArea(notchPoly);
    // Ensure notch is CW for exterior clipping
    const notchCW = notchSA > 0 ? [...notchPoly].reverse() : [...notchPoly];

    // Sutherland-Hodgman with CW clipper (keeps exterior of notch)
    const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const isect = (a, b, p, q) => {
      const a1 = b.x - a.x, b1 = b.y - a.y;
      const a2 = q.x - p.x, b2 = q.y - p.y;
      const denom = a1 * b2 - b1 * a2;
      if (Math.abs(denom) < 1e-12) return { x: (b.x + p.x) / 2, y: (b.y + p.y) / 2 };
      const t = ((p.x - a.x) * b2 - (p.y - a.y) * a2) / denom;
      return { x: a.x + t * a1, y: a.y + t * b1 };
    };

    let out = [...zonePoly];
    const nc = notchCW.length;
    for (let i = 0; i < nc && out.length >= 3; i++) {
      const a = notchCW[i], b = notchCW[(i + 1) % nc];
      const inp = out;
      out = [];
      for (let j = 0; j < inp.length; j++) {
        const p = inp[j], q = inp[(j + 1) % inp.length];
        // cross >= 0 means point is on the left side of edge a→b
        // For CW clipper, left = exterior of the original polygon
        const pIn = cross(a, b, p) >= -1e-10;
        const qIn = cross(a, b, q) >= -1e-10;
        if (pIn) {
          out.push(p);
          if (!qIn) out.push(isect(a, b, p, q));
        } else if (qIn) {
          out.push(isect(a, b, p, q));
        }
      }
    }

    // Guard: if clipping emptied the polygon (notch covers whole zone), return original
    if (out.length < 3) return zonePoly;

    // Remove near-duplicate vertices (from intersection points coinciding with zone vertices)
    const EPS = 0.01;
    const deduped = [out[0]];
    for (let i = 1; i < out.length; i++) {
      const prev = deduped[deduped.length - 1];
      if (Math.hypot(out[i].x - prev.x, out[i].y - prev.y) > EPS) {
        deduped.push(out[i]);
      }
    }
    // Check last vs first
    if (deduped.length > 1) {
      const f = deduped[0], l = deduped[deduped.length - 1];
      if (Math.hypot(f.x - l.x, f.y - l.y) < EPS) deduped.pop();
    }

    return deduped.length >= 3 ? deduped : zonePoly;
  },

  expandFaceMitoyenne(bat, parc, edgeReculs, edgeTypes) {
    if (!bat || !parc || parc.length < 3) return bat;
    const isMulti = Array.isArray(bat[0]);
    const inputs  = isMulti ? bat : [bat];

    const n = parc.length;
    const hasMit = edgeReculs.some((r, i) => r === 0 && edgeTypes[i] === 'lateral');
    if (!hasMit) return bat;

    let result = inputs.map(poly => poly ? poly.map(p => ({ x: p.x, y: p.y })) : null);

    const sa = this.signedArea(parc);
    const cw = sa > 0 ? 1 : -1; // sens du polygone parcelle

    for (let i = 0; i < n; i++) {
      if (edgeReculs[i] !== 0 || edgeTypes[i] !== 'lateral') continue;
      const p1 = parc[i], p2 = parc[(i + 1) % n];
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      // Normale intérieure (vers l'intérieur de la parcelle)
      const inx = cw * (-dy / len), iny = cw * (dx / len);
      const outx = -inx, outy = -iny;
      const EXPAND = 500; // assez large pour traverser n'importe quel bâtiment

      result = result.map(poly => {
        if (!poly || poly.length < 3) return poly;
        // Distance signée de chaque sommet à la limite (positif = côté intérieur)
        const dists = poly.map(p => (p.x - p1.x) * inx + (p.y - p1.y) * iny);
        const minDist = Math.min(...dists);
        return poly.map((p, k) => {
          // Sommets les plus proches de la limite (tolérance 5cm) → expandés
          if (dists[k] <= minDist + 0.05) {
            return { x: p.x + outx * EXPAND, y: p.y + outy * EXPAND };
          }
          return p;
        });
      });
    }

    return isMulti ? result.filter(p => p && p.length >= 3) : result[0];
  },

};

export { GeoUtils };
export default GeoUtils;

// Expose pour compatibilité non-module TERLAB
if (typeof window !== 'undefined') window.GeoUtils = GeoUtils;
