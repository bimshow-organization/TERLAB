// ═══════════════════════════════════════════════════════════════════════════
// SQUELETTE DROIT PONDÉRÉ — chemin A (événementiel)
//
// Port de `app/features/designer/straight-skeleton.ts` (BAM, 566 l.),
// généralisé aux POIDS PAR ARÊTE.
//
// @coords  Entrée : polygone CCW en mètres, Pt2 = [x, z].
//          Sortie : nodes[].t = HAUTEUR EN MÈTRES au-dessus de l'égout.
//          Inverse : lift(skel, baseY) → [x, baseY + t, z].
//
// ── LA GÉNÉRALISATION ──────────────────────────────────────────────────────
// L'original résout, pour chaque sommet, la vélocité V telle que
//        V·n₁ = 1   et   V·n₂ = 1
// ce qui impose la même vitesse de recul à toutes les arêtes.
// On résout désormais
//        V·n₁ = s₁  et   V·n₂ = s₂
// dont la solution de Cramer est
//        Vx = (s₁·n2z − s₂·n1z) / det
//        Vz = (n1x·s₂ − n2x·s₁) / det        det = n1x·n2z − n1z·n2x
// (s₁ = s₂ = 1 redonne exactement l'expression d'origine, cf. test de
//  non-régression `poids unitaires ≡ original`).
//
// ── CORRECTION APPORTÉE AU PASSAGE ─────────────────────────────────────────
// `edgeT2` de l'original calcule son terme constant avec les `posT` inversés :
//     rx = w.pos - v.pos − v.posT·u + w.posT·w        (original)
//     rx = w.pos - v.pos − w.posT·w + v.posT·u        (correct)
// Les deux coïncident tant que posT = 0, donc au PREMIER tour seulement. Dès
// le second événement le t calculé est faux, la vérification de coïncidence à
// 1e-4 le rejette, et l'événement est SILENCIEUSEMENT MANQUÉ (→ Infinity).
// C'est très probablement l'origine du « split events fiables seulement sur
// certaines formes » et du besoin de l'ENDGAME multi-boucles.
// Réécrit ici par points-base, comme `splitT2` le faisait déjà correctement.
//
// Porté depuis bimshow-vision (POC ciriani-santillana, module
// `weighted-skeleton`).
// ═══════════════════════════════════════════════════════════════════════════

import { ensureCCW, EPS } from './geom2d.js';

/**
 * Vélocité pondérée d'un sommet, à partir des DIRECTIONS de ses deux arêtes.
 *
 * On raisonne sur les directions et non sur les points : une arête du front
 * d'onde TRANSLATE, elle ne tourne jamais — sa direction est un invariant de
 * l'arête d'emprise. Les redériver des positions courantes est équivalent mais
 * fragile, et surtout impossible pour une arête de LONGUEUR NULLE, ce dont S2 a
 * besoin (retour vertical inséré à un sommet plat).
 *
 * @param uL direction unitaire de l'arête à gauche du sommet
 * @param uR direction unitaire de l'arête à droite
 * @param sL, sR poids de ces deux arêtes
 */
export function weightedVelocity(uL, uR, sL, sR) {
  const n1x = -uL[1], n1z = uL[0], n2x = -uR[1], n2z = uR[0];   // normales intérieures (CCW)
  const det = n1x * n2z - n1z * n2x;
  const cross = uL[0] * uR[1] - uL[1] * uR[0];      // > 0 sortant · < 0 rentrant

  if (Math.abs(det) < 1e-9) {
    // Arêtes colinéaires. Poids égaux : système indéterminé (le sommet aurait dû
    // être supprimé par la validation) — garde-fou. Poids différents : le cas est
    // désormais traité EN AMONT par insertion d'un retour vertical (S2), donc on
    // ne devrait plus jamais l'atteindre ici.
    if (Math.abs(sL - sR) < 1e-9) return { vel: [n1x * sL, n1z * sL], reflex: false, flat: 'equal' };
    // Poids différents. DEUX situations très différentes se cachaient derrière
    // le même `vel = [0,0]`, et l'une d'elles gelait le front d'onde en silence :
    //
    //   · arêtes PARALLÈLES de même sens (uL = uR) — le sommet plat à 180° de
    //     l'emprise. Traité en amont par le retour vertical de S2 : on ne
    //     devrait plus l'atteindre ici.
    //   · arêtes ANTI-PARALLÈLES (uL = −uR) — deux fronts qui se font face et
    //     se rejoignent. Cela n'existe pas dans l'emprise de départ ; cela
    //     APPARAÎT en cours de propagation, dès qu'une arête intermédiaire
    //     s'effondre. Le sommet entre eux est à l'infini, sa vitesse n'a pas de
    //     sens, et le figer à zéro condamnait la boucle à ne plus jamais
    //     résoudre — c'est la cause mesurée de 67 % du régime limite de S1.
    const meme = uL[0] * uR[0] + uL[1] * uR[1] > 0;
    return { vel: [0, 0], reflex: false, degenere: true,
             flat: meme ? 'parallele' : 'antiparallele' };
  }
  return {
    vel: [(sL * n2z - sR * n1z) / det, (n1x * sR - n2x * sL) / det],
    reflex: cross < -1e-9,
    flat: null,
  };
}

/** Direction unitaire de l'arête i, ou null si elle est dégénérée. */
export function edgeDirs(poly) {
  const n = poly.length;
  return poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    return l < 1e-12 ? null : [dx / l, dz / l];
  });
}

const at = (v, t) => [v.pos[0] + (t - v.posT) * v.vel[0], v.pos[1] + (t - v.posT) * v.vel[1]];
const base = (v) => [v.pos[0] - v.posT * v.vel[0], v.pos[1] - v.posT * v.vel[1]];

/**
 * Temps de l'edge event entre v et v.next, ou Infinity.
 *
 * ⚠ La borne est `now`, le temps courant du front d'onde — PAS `v.posT`.
 * Avec `t > max(v.posT, w.posT)` (l'original), un événement qui tombe
 * EXACTEMENT au temps de création d'un des deux sommets est rejeté. C'est
 * précisément ce qui arrive dès qu'un split event laisse une boucle déjà
 * dégénérée : les deux sommets sont coïncidents à l'instant même, l'événement
 * est refusé, et la boucle part chercher un événement bien plus tard —
 * en dehors de l'emprise. (Vu sur l'emprise en U : nœud fantôme à (8, 8),
 * qui est dans le vide du U, et Σ aires = 124 m² pour une emprise de 112 m².)
 */
function edgeTime(v, now, dir) {
  const w = v.next;
  if (!w) return Infinity;
  // Une arête DÉJÀ de longueur nulle ne peut pas s'effondrer : soit elle
  // s'allonge (retour vertical de S2, qui naît nul et croît), soit elle est
  // stationnaire. Sans cette garde, la seule vérification de coïncidence
  // prendrait sa naissance pour un effondrement immédiat.
  // Le test ne s'applique QU'AUX arêtes actuellement nulles : sur une arête de
  // longueur positive, la coïncidence à l'instant t suffit, et exiger dL < 0
  // rejetterait les effondrements simultanés légitimes (emprises en U, croix).
  if (dir) {
    const now0 = Math.max(v.posT, w.posT);
    const pv0 = at(v, now0), pw0 = at(w, now0);
    const L0 = (pw0[0] - pv0[0]) * dir[0] + (pw0[1] - pv0[1]) * dir[1];
    if (Math.abs(L0) < 1e-7) {
      const dL = (w.vel[0] - v.vel[0]) * dir[0] + (w.vel[1] - v.vel[1]) * dir[1];
      if (dL > -1e-12) return Infinity;
    }
  }
  const ax = v.vel[0] - w.vel[0], az = v.vel[1] - w.vel[1];
  const den = ax * ax + az * az;
  if (den < 1e-12) return Infinity;                 // vitesses égales : ne se rejoignent jamais
  const V0 = base(v), W0 = base(w);
  const rx = W0[0] - V0[0], rz = W0[1] - V0[1];
  const t = (ax * rx + az * rz) / den;
  if (t < now - 1e-9) return Infinity;              // événement déjà passé
  const pv = at(v, t), pw = at(w, t);
  if (Math.hypot(pv[0] - pw[0], pv[1] - pw[1]) > 1e-6) return Infinity;   // pas de vraie coïncidence
  return t;
}

/**
 * Point où les plans des arêtes `pans` se coupent : (x, z, t).
 *
 * Plan de l'arête i : t = ((P − A_i)·n_i)/s_i, soit a_i·x + b_i·z − t + c_i = 0.
 * Trois arêtes suffisent ; au-delà on résout aux moindres carrés puis on VÉRIFIE
 * que tous les plans passent bien par le point trouvé. Sans cette vérification
 * on rendrait un point plausible pour une configuration qui n'en a pas.
 */
function intersecterPlans(pans, pts, DIR, W, tol = 1e-6) {
  const eq = [];
  for (const i of pans) {
    const A = pts[i], u = DIR[i];
    if (!u || !(W[i] > 1e-12)) continue;
    const n = [-u[1], u[0]], k = 1 / W[i];
    eq.push([n[0] * k, n[1] * k, -1, -(A[0] * n[0] + A[1] * n[1]) * k]);
  }
  if (eq.length < 3) return null;
  const AtA = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], AtY = [0, 0, 0];
  for (const e of eq) {
    const y = -e[3];
    for (let i = 0; i < 3; i++) { AtY[i] += e[i] * y; for (let j = 0; j < 3; j++) AtA[i][j] += e[i] * e[j]; }
  }
  const sol = resoudre3(AtA, AtY);
  if (!sol) return null;
  // vérification : le point doit ANNULER chaque équation, pas seulement les
  // minimiser. Une boucle de fronts parallèles a un « meilleur » point qui ne
  // vérifie aucun plan — c'est exactement le cas qu'il faut refuser.
  for (const e of eq) {
    if (Math.abs(e[0] * sol[0] + e[1] * sol[1] + e[2] * sol[2] + e[3]) > tol) return null;
  }
  return sol;
}

/** Pivot de Gauss 3×3. null si singulier. */
function resoudre3(A, y) {
  const M = A.map((r, i) => [...r, y[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-9) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

/** Taille de la boucle de front d'onde contenant v (bornée par `guard`). */
function loopSize(v, guard) {
  let u = v.next, k = 1;
  while (u && u !== v && k <= guard) { k++; u = u.next; }
  return u === v ? k : Infinity;
}

/** a appartient-il à la MÊME boucle de front d'onde que v ? */
function sameLoop(v, a, guard) {
  let u = v.next, k = 0;
  while (u && k++ < guard) {
    if (u === a) return true;
    if (u === v) return false;
    u = u.next;
  }
  return false;
}

/**
 * Plus petit split event d'un sommet rentrant v contre une arête (a → a.next).
 *
 * Trois gardes, dont DEUX qui manquaient à l'original :
 *  (1) arêtes adjacentes à v exclues                       — présente
 *  (2) l'arête doit être dans la MÊME boucle de front       — MANQUANTE
 *      Après un premier split, les boucles bornent des régions disjointes ;
 *      un sommet d'une boucle « percutant » une arête d'une autre est un
 *      événement fantôme. C'est ce qui faisait exploser les plans à plusieurs
 *      rentrants (emprise en croix : Σ aires = 92 m² pour 80 m²).
 *  (3) v doit ARRIVER sur l'arête, pas s'en éloigner        — MANQUANTE
 *      (le commentaire existait dans l'original, le test non).
 *      distance(t) = n·(v(t) − A) − s·t ⇒ décroissante ⟺ n·v.vel < s.
 */
function splitEvent(v, live, now) {
  if (!v.reflex) return null;
  let best = null;
  const V0 = base(v);
  const guard = live.length + 2;
  for (const a of live) {
    if (!a.alive || !a.next) continue;
    if (a === v || a === v.prev) continue;          // (1)
    // (1bis) Quand l'arête voisine de v est de LONGUEUR NULLE — c'est le retour
    //   vertical inséré par S2 — le sommet suivant est confondu avec v, et
    //   l'arête d'AU-DELÀ le touche donc par une extrémité. Le split se
    //   déclencherait à t = 0 sur un contact structurel, jamais sur une
    //   collision. On exclut les arêtes secondes voisines dans ce seul cas.
    if (v.prev && a.next === v.prev
        && Math.hypot(v.pos[0] - v.prev.pos[0], v.pos[1] - v.prev.pos[1]) < 1e-7) continue;
    if (v.next && a === v.next
        && Math.hypot(v.pos[0] - v.next.pos[0], v.pos[1] - v.next.pos[1]) < 1e-7) continue;
    if (!sameLoop(v, a, guard)) continue;           // (2)
    const b = a.next;

    {                                               // (3)
      const ax = b.pos[0] - a.pos[0], az = b.pos[1] - a.pos[1];
      const l = Math.hypot(ax, az);
      if (l > 1e-12) {
        const nx = -az / l, nz = ax / l;            // normale intérieure (CCW)
        const sEdge = nx * a.vel[0] + nz * a.vel[1];
        if (nx * v.vel[0] + nz * v.vel[1] >= sEdge - 1e-12) continue;
      }
    }
    const A0 = base(a), B0 = base(b);
    const P0x = B0[0] - A0[0], P0z = B0[1] - A0[1];
    const Pdx = b.vel[0] - a.vel[0], Pdz = b.vel[1] - a.vel[1];
    const Q0x = V0[0] - A0[0], Q0z = V0[1] - A0[1];
    const Qdx = v.vel[0] - a.vel[0], Qdz = v.vel[1] - a.vel[1];
    // cross(P(t), Q(t)) = c0 + c1·t + c2·t²
    const c2 = Pdx * Qdz - Pdz * Qdx;
    const c1 = P0x * Qdz - P0z * Qdx + Pdx * Q0z - Pdz * Q0x;
    const c0 = P0x * Q0z - P0z * Q0x;
    const roots = [];
    if (Math.abs(c2) < 1e-12) {
      if (Math.abs(c1) > 1e-12) roots.push(-c0 / c1);
    } else {
      const disc = c1 * c1 - 4 * c2 * c0;
      if (disc >= 0) { const s = Math.sqrt(disc); roots.push((-c1 + s) / (2 * c2), (-c1 - s) / (2 * c2)); }
    }
    for (const t of roots) {
      if (t < now - 1e-9) continue;
      const pv = at(v, t), pa = at(a, t), pb = at(b, t);
      const ex = pb[0] - pa[0], ez = pb[1] - pa[1], el2 = ex * ex + ez * ez;
      if (el2 < 1e-9) continue;
      const s = ((pv[0] - pa[0]) * ex + (pv[1] - pa[1]) * ez) / el2;
      if (s < -0.04 || s > 1.04) continue;           // tolère le vertex event en bout d'arête
      if (!best || t < best.t) best = { t, edgeL: a, point: pv };
    }
  }
  return best;
}

/**
 * Squelette droit pondéré.
 * @param {Array<[number,number]>} polygon  emprise CCW en mètres
 * @param {Array<number>} weights           s_i par arête (arête i = sommet i → i+1)
 * @returns {{ nodes, edges, eaves, events, weights, poly }}
 *          nodes[].t = hauteur (m) · edges[].kind = 'ridge'|'hip'|'valley' (provisoire,
 *          reclassé exactement par classifyEdges() de audit.mjs)
 */
export function weightedSkeleton(polygon, weights, dirsIn = null) {
  if (polygon.length < 3) throw new Error('Polygone : au moins 3 sommets requis');
  if (weights.length !== polygon.length) throw new Error('Un poids par arête requis');

  // Si des directions explicites sont fournies, l'emprise est déjà canonique
  // (elle vient de la validation puis de l'insertion des retours verticaux) :
  // la réorienter casserait l'indexation.
  const pts = dirsIn ? polygon : ensureCCW(polygon);
  const n0 = pts.length;
  const W = (!dirsIn && pts !== polygon && pts[0] !== polygon[0])
    ? Array.from({ length: n0 }, (_, i) => weights[(n0 - 2 - i + n0) % n0])
    : [...weights];
  const DIR = dirsIn ? dirsIn.map((d, i) => d ?? edgeDirs(pts)[i]) : edgeDirs(pts);
  for (let i = 0; i < n0; i++) {
    if (!DIR[i]) throw new Error(`Arête ${i} de longueur nulle sans direction explicite`);
  }

  const nodes = [];
  const eaves = [];
  const edges = [];
  const events = [];

  for (let i = 0; i < n0; i++) nodes.push({ id: i, x: pts[i][0], z: pts[i][1], t: 0, boundary: true });
  for (let i = 0; i < n0; i++) eaves.push({ a: i, b: (i + 1) % n0, kind: 'eave', edge: i });

  // Sommet i : entre l'arête (i-1) à sa gauche et l'arête i à sa droite.
  const all = [];
  for (let i = 0; i < n0; i++) {
    const eL = (i - 1 + n0) % n0, eR = i;
    const r = weightedVelocity(DIR[eL], DIR[eR], W[eL], W[eR]);
    all.push({ id: i, pos: pts[i], vel: r.vel, posT: 0, prev: null, next: null,
               alive: true, reflex: r.reflex, flat: r.flat, eL, eR });
  }
  for (let i = 0; i < n0; i++) { all[i].prev = all[(i - 1 + n0) % n0]; all[i].next = all[(i + 1) % n0]; }

  const degeneres = [];
  const recompute = (v, t) => {
    const r = weightedVelocity(DIR[v.eL], DIR[v.eR], W[v.eL], W[v.eR]);
    v.vel = r.vel; v.reflex = r.reflex; v.flat = r.flat; v.degenere = !!r.degenere;
    v.pos = at(v, t); v.posT = t;
    if (r.degenere) degeneres.push({ t, eL: v.eL, eR: v.eR, type: r.flat });
  };

  const MAX = n0 * 12;
  let iter = 0;
  let truncated = false;
  let now = 0;                       // temps courant du front d'onde

  while (iter < MAX) {
    iter++;
    const live = all.filter((v) => v.alive);
    const guardL = live.length + 2;
    // Une boucle déjà réduite à ≤ 2 sommets est TERMINÉE : elle se referme en
    // faîtage dans l'endgame. Continuer à y chercher des edge events revient à
    // fusionner un sommet avec lui-même — le chaînage part en anneau mort et la
    // boucle d'événements tourne jusqu'à la troncature. (Vu sur une emprise à
    // encoche étroite, à 45° : 96 itérations, toutes au même point (3,5 · 3,5).)
    const actifs = live.filter((v) => loopSize(v, guardL) >= 3);
    if (actifs.length === 0) break;

    let bestT = Infinity, bestKind = 'edge', bestV = null, bestSplit = null;
    for (const v of actifs) {
      if (!v.next || v.next === v) continue;
      const te = edgeTime(v, now, DIR[v.eR]);
      if (te < bestT - 1e-12) { bestT = te; bestKind = 'edge'; bestV = v; bestSplit = null; }
      if (v.reflex) {
        const sp = splitEvent(v, actifs, now);
        // PRIORITÉ AUX SPLITS À ÉGALITÉ DE TEMPS.
        // Un split et un edge event peuvent tomber exactement au même instant
        // (emprise en L : l'aile courte se referme pendant que le sommet
        // rentrant percute le côté long). Traiter l'edge event d'abord détruit
        // le contexte dont le split a besoin : il ne se redéclenche jamais et
        // le front part en vrille (nœud à +5,95 m au lieu de +2,45 m). Le split
        // scinde le front — il doit être joué en premier.
        const gagne = sp && (sp.t < bestT - 1e-12
          || (bestKind === 'edge' && Math.abs(sp.t - bestT) <= 1e-9));
        if (gagne) { bestT = sp.t; bestKind = 'split'; bestV = v; bestSplit = sp; }
      }
    }
    if (!bestV || !isFinite(bestT)) break;
    now = Math.max(now, bestT);

    if (bestKind === 'edge') {
      const v = bestV, w = v.next;
      if (!w) break;
      const p = at(v, bestT), apex = nodes.length;
      nodes.push({ id: apex, x: p[0], z: p[1], t: bestT, boundary: false });
      events.push({ kind: 'edge', t: bestT, edgeConsumed: v.eR, at: [p[0], p[1]] });
      // arête v→apex sépare les pans (v.eL | v.eR) ; w→apex sépare (w.eL | w.eR)
      edges.push({ a: v.id, b: apex, kind: v.reflex ? 'valley' : 'hip', pans: [v.eL, v.eR] });
      edges.push({ a: w.id, b: apex, kind: w.reflex ? 'valley' : 'hip', pans: [w.eL, w.eR] });
      v.alive = false; w.alive = false;
      const prev = v.prev, next = w.next;
      if (!prev || !next) break;
      const nv = { id: apex, pos: p, vel: [0, 0], posT: bestT, prev, next,
                   alive: true, reflex: false, flat: null, eL: v.eL, eR: w.eR };
      prev.next = nv; next.prev = nv; all.push(nv); recompute(nv, bestT);
    } else if (bestSplit) {
      const v = bestV, a = bestSplit.edgeL, b = a.next;
      const p = bestSplit.point, apex = nodes.length;
      nodes.push({ id: apex, x: p[0], z: p[1], t: bestT, boundary: false });
      events.push({ kind: 'split', t: bestT, vertex: v.id, hitEdge: a.eR, at: [p[0], p[1]] });
      edges.push({ a: v.id, b: apex, kind: 'valley', pans: [v.eL, v.eR] });
      v.alive = false;
      const v1 = { id: apex, pos: p, vel: [0, 0], posT: bestT, prev: v.prev, next: b,
                   alive: true, reflex: false, flat: null, eL: v.eL, eR: a.eR };
      const v2id = nodes.length;
      nodes.push({ id: v2id, x: p[0], z: p[1], t: bestT, boundary: false });
      const v2 = { id: v2id, pos: p, vel: [0, 0], posT: bestT, prev: a, next: v.next,
                   alive: true, reflex: false, flat: null, eL: a.eR, eR: v.eR };
      if (v.prev) v.prev.next = v1;
      b.prev = v1; a.next = v2;
      if (v.next) v.next.prev = v2;
      all.push(v1, v2); recompute(v1, bestT); recompute(v2, bestT);
    }
  }
  if (iter >= MAX) truncated = true;

  // ── ENDGAME : fermeture de chaque boucle restante ─────────────────────────
  const bouclesFermees = [];
  const nonResolu = [];
  const seen = new Set();
  for (const start of all) {
    if (!start.alive || seen.has(start)) continue;
    const loop = [];
    let v = start, guard = 0;
    while (v && v.alive && !seen.has(v) && guard++ < all.length + 2) { seen.add(v); loop.push(v); v = v.next; }
    if (loop.length === 2) {
      // le front dégénéré en « 2-gone » : les deux pans encore vivants sont
      // les arêtes droites des deux sommets restants.
      edges.push({ a: loop[0].id, b: loop[1].id, kind: 'ridge', pans: [loop[0].eR, loop[1].eR] });
    } else if (loop.length >= 3) {
      // UNE BOUCLE DE TROIS FRONTS OU PLUS N'EST PAS UN BARYCENTRE.
      // L'ancienne fermeture prenait la moyenne des positions et le temps
      // maximal — c'est-à-dire qu'elle INVENTAIT une altitude. Mesuré sur
      // 8 000 emprises : chacune de ces fermetures tombait dans une toiture en
      // échec, et l'audit C8 signalait le nœud sans jamais dire pourquoi.
      //
      // Si les plans des arêtes de la boucle se coupent réellement en un point,
      // ce point EST le sommet cherché : on le résout exactement. Sinon on ne
      // pose aucun nœud et on nomme la boucle comme non résolue — l'appelant
      // saura qu'il manque un événement, pas qu'un nœud est mal placé.
      const pans = [...new Set(loop.map((u) => u.eR))].filter((i) => W[i] > 1e-12);
      const apexExact = pans.length >= 3 ? intersecterPlans(pans, pts, DIR, W) : null;
      const tMin = Math.max(...loop.map((u) => u.posT));
      const valide = apexExact && apexExact[2] >= tMin - 1e-6 && isFinite(apexExact[2]);
      if (valide) {
        const cid = nodes.length;
        nodes.push({ id: cid, x: apexExact[0], z: apexExact[1], t: apexExact[2], boundary: false, endgame: loop.length });
        // On garde ce qu'aurait donné l'ANCIENNE fermeture, pour pouvoir
        // chiffrer ce qu'on a évité plutôt que de l'affirmer.
        bouclesFermees.push({ taille: loop.length, node: cid, pans, exact: true,
          barycentre: [loop.reduce((t, u) => t + u.pos[0], 0) / loop.length,
                       loop.reduce((t, u) => t + u.pos[1], 0) / loop.length,
                       Math.max(...loop.map((u) => u.posT))] });
        for (const u of loop) edges.push({ a: u.id, b: cid, kind: u.reflex ? 'valley' : 'hip', pans: [u.eL, u.eR] });
      } else {
        const dirsPans = pans.map((i) => DIR[i]);
        let toutesParalleles = true;
        for (let x = 0; x < dirsPans.length && toutesParalleles; x++) {
          for (let y = x + 1; y < dirsPans.length; y++) {
            const c = dirsPans[x][0] * dirsPans[y][0] + dirsPans[x][1] * dirsPans[y][1];
            if (Math.abs(Math.abs(c) - 1) > 1e-6) { toutesParalleles = false; break; }
          }
        }
        nonResolu.push({
          taille: loop.length, pans, tMin,
          cause: toutesParalleles ? 'fronts_paralleles' : 'fronts_mixtes',
          msg: toutesParalleles
            ? `boucle de ${loop.length} front(s) mutuellement parallèles (arêtes ${pans.join(', ')}) : `
              + 'leurs plans ne se coupent en aucun point — la fermeture est une SUITE de crêtes horizontales, '
              + 'pas un sommet. L\'événement de crête entre fronts parallèles n\'est pas implémenté.'
            : `boucle de ${loop.length} front(s) (arêtes ${pans.join(', ')}) dont les plans ne se coupent pas `
              + 'en un point unique : il manque un événement avant la fermeture.',
        });
        bouclesFermees.push({ taille: loop.length, node: null, pans, exact: false });
      }
    }
  }

  return { nodes, edges, eaves, events, weights: W, dirs: DIR, poly: pts, truncated, iterations: iter,
           bouclesFermees, nonResolu, degeneres };
}

/**
 * Élévation 3D. t EST la hauteur — plus de tan().
 * @returns Array<[x, y, z]> indexé comme skel.nodes
 */
export function lift(skel, baseY = 0) {
  return skel.nodes.map((n) => [n.x, baseY + n.t, n.z]);
}
