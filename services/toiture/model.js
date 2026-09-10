// ═══════════════════════════════════════════════════════════════════════════
// S3 — LE MODÈLE : NŒUDS, ARÊTES ET PANS DE PREMIÈRE CLASSE
//
// Le squelette est un résultat de calcul. Le MODÈLE est ce sur quoi on édite,
// on compte, on dessine et on pose des pièces. Trois tables, des identités
// stables, et un repère local par pan.
//
// ── L'IDENTITÉ DES PANS EST GRATUITE ───────────────────────────────────────
// Invariant du squelette droit : chaque arête d'emprise engendre exactement un
// pan. Donc `pan.id = arête.id`. Une recette de pan (couverture, entraxe,
// sections) survit à toute édition qui ne détruit pas son arête d'égout —
// aucune réconciliation à écrire. C'est déjà le premier critère d'audit (C1).
//
// `pan.sourceEdge` remonte à l'indice de la SPEC UTILISATEUR : la validation
// peut supprimer des sommets plats et S2 peut insérer des retours verticaux,
// donc l'indice interne bouge. `sourceEdge` ne bouge pas.
//
// ── LE REPÈRE LOCAL, ET POURQUOI IL DÉBLOQUE S4 ────────────────────────────
//        u  le long de l'égout           (horizontal)
//        v  ligne de plus grande pente   (montante, EN VRAIE GRANDEUR)
//        n  normale du plan              (sortante)
//
// Tout se peuple dans (u, v) : chevrons le long de v à entraxe sur u, pannes le
// long de u espacées sur v, couverture en rangs à pureau. Et l'EMPANNON n'est
// pas une pièce à part : c'est un chevron dont la découpe contre le contour du
// pan le raccourcit. Il faut donc que le contour soit disponible en (u, v),
// en vraie grandeur de rampant — c'est exactement ce que fournit `contourUV`.
//
// @coords  monde = [x, y, z] avec y = altitude · plan = [x, z] · pan = [u, v]
//          toWorld(toLocal(P)) ≡ P pour tout P du plan du pan (testé).
//
// Porté depuis bimshow-vision (POC ciriani-santillana, module `model`), plus
// `roofYUnder` (module envelope du POC) — voir en bas de fichier.
// ═══════════════════════════════════════════════════════════════════════════

import { signedArea, area, pointInPoly } from './geom2d.js';
import { weldNodes } from './audit.js';
import { panFrame } from './pan-frame.js';

const DEG = Math.PI / 180;

/**
 * Construit le modèle éditable depuis un résultat de `buildRoof`.
 * @returns {{ nodes, edges, pans, byId, stats }}
 */
export function buildModel(r, opts = {}) {
  if (!r || !r.skeleton) throw new Error('buildModel : résultat de buildRoof requis');
  const baseY = opts.baseY ?? 0;
  const sk = r.skeleton;
  const N = sk.poly.length;
  const origin = sk.origin ?? sk.poly.map((_, i) => i);

  // ── NŒUDS ────────────────────────────────────────────────────────────────
  // Un split event crée DEUX nœuds au même point (un par boucle). Le squelette
  // en a besoin ; le modèle, non : un sommet de charpente est un sommet. On
  // soude, et toutes les arêtes sont réindexées sur les représentants — sans
  // quoi le contour d'un pan ne se referme pas par identité de nœud.
  const weld = weldNodes(sk);
  const nid = (i) => `n${weld[i]}`;
  const nodes = sk.nodes
    .filter((n, i) => weld[i] === i)
    .map((n) => ({
      id: `n${n.id}`, index: n.id,
      xz: [n.x, n.z], y: baseY + n.t, t: n.t,
      boundary: n.boundary,
    }));

  // ── PANS ─────────────────────────────────────────────────────────────────
  const pans = [];
  for (let i = 0; i < N; i++) {
    const p = r.panels[i];
    const s = sk.weights[i];
    const A = sk.poly[i];
    const u = sk.dirs[i];
    const vertical = s === 0;
    const theta = vertical ? 90 : Math.atan(1 / s) / DEG;

    // Le repère d'un pan est défini UNE FOIS, dans `pan-frame.mjs`. La facette
    // d'un étage (S6) le construit avec la même fonction : c'est ce qui permet
    // à `populatePan` de peupler l'une comme l'autre sans une seule branche.
    const F = panFrame(A, u, theta, baseY);
    const { toLocal, toWorld, heightAt } = F;

    const contourUV = (p?.poly ?? []).map(toLocal);
    const aireUV = contourUV.length >= 3 ? area(contourUV) : 0;

    pans.push({
      id: `p${i}`, index: i,
      sourceEdge: origin[i],                          // ← identité STABLE côté utilisateur
      kind: vertical ? (origin[i] === null ? 'retour_vertical' : 'pignon') : 'pan',
      pente: theta, poids: s,
      origine: F.origine, origine3: F.origine3,
      repere: F.repere,
      contour: p?.poly ?? [],                         // plan horizontal
      contourUV,                                      // repère du pan, vraie grandeur
      aireProjetee: p?.aireProjetee ?? 0,
      aireRampante: aireUV,                           // = aireProjetee / cos θ (vérifié)
      contourEdges: [],                               // rempli plus bas
      toLocal, toWorld, heightAt,
    });
  }

  // ── ARÊTES ───────────────────────────────────────────────────────────────
  const edges = [];
  // 1. les égouts (arêtes d'emprise à poids non nul)
  for (let i = 0; i < N; i++) {
    const a = sk.poly[i], b = sk.poly[(i + 1) % N];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-9) continue;                           // retour vertical : pas d'égout
    edges.push({
      id: `E${edges.length}`, kind: sk.weights[i] === 0 ? 'arase_pignon' : 'egout',
      a: nid(i), b: nid((i + 1) % N),
      p1: [a[0], baseY, a[1]], p2: [b[0], baseY, b[1]],
      longueur: L, longueurVraie: L, denivele: 0, horizontale: true,
      pans: [`p${i}`], sourceEdge: origin[i], diedre: null,
      debord: r.specs?.[origin[i]]?.debord ?? 0,
    });
  }
  // 2. les arêtes de squelette, déjà classées par `classifyEdges`
  const vues = new Set();
  for (const e of r.edges) {
    if (e.kind === 'degenere') continue;
    if (weld[e.a] === weld[e.b]) continue;            // arête écrasée par la soudure
    const cle = [weld[e.a], weld[e.b]].sort((x, y) => x - y).join('|') + '|' + e.kind;
    if (vues.has(cle)) continue;                      // doublon après soudure
    vues.add(cle);
    const na = sk.nodes[e.a], nb = sk.nodes[e.b];
    const dz = Math.abs(nb.t - na.t);
    edges.push({
      id: `E${edges.length}`, kind: e.kind,
      a: nid(e.a), b: nid(e.b),
      p1: [na.x, baseY + na.t, na.z], p2: [nb.x, baseY + nb.t, nb.z],
      longueur: e.longueur,                           // projetée en plan
      longueurVraie: Math.hypot(e.longueur, dz),      // vraie longueur 3D
      denivele: nb.t - na.t, horizontale: !!e.horizontale,
      famille: e.famille ?? null, enFace: !!e.enFace, angleEgouts: e.angleEgouts ?? null,
      pans: (e.pans ?? []).filter((x) => x != null).map((x) => `p${x}`),
      sourceEdge: null, diedre: e.diedre ?? null,
    });
  }

  // rattachement inverse : chaque pan connaît ses arêtes de contour
  const byId = { nodes: {}, edges: {}, pans: {} };
  for (const n of nodes) byId.nodes[n.id] = n;
  for (const p of pans) byId.pans[p.id] = p;
  for (const e of edges) {
    byId.edges[e.id] = e;
    for (const pid of e.pans) byId.pans[pid]?.contourEdges.push(e.id);
  }

  const parKind = edges.reduce((m, e) => ((m[e.kind] = (m[e.kind] ?? 0) + 1), m), {});
  const actifs = pans.filter((p) => p.kind === 'pan');
  return {
    nodes, edges, pans, byId,
    stats: {
      nPans: actifs.length,
      aireProjetee: actifs.reduce((s, p) => s + p.aireProjetee, 0),
      aireRampante: actifs.reduce((s, p) => s + p.aireRampante, 0),
      lineaire: parKind,
      mlParKind: edges.reduce((m, e) => ((m[e.kind] = (m[e.kind] ?? 0) + e.longueurVraie), m), {}),
      faite: Math.max(...nodes.map((n) => n.y)),
    },
  };
}

/** Résumé lisible du modèle. */
export function describeModel(m) {
  const L = [];
  L.push(`${m.pans.length} pan(s) dont ${m.stats.nPans} incliné(s) · ${m.nodes.length} nœuds · ${m.edges.length} arêtes`);
  L.push(`aire  ${m.stats.aireProjetee.toFixed(2)} m² projeté · ${m.stats.aireRampante.toFixed(2)} m² rampant · faîte ${m.stats.faite.toFixed(3)} m`);
  L.push('linéaire par type :');
  for (const [k, v] of Object.entries(m.stats.mlParKind).sort((a, b) => b[1] - a[1])) {
    L.push(`   ${k.padEnd(14)} ${m.stats.lineaire[k]}×  ${v.toFixed(2)} ml`);
  }
  for (const p of m.pans.filter((x) => x.kind === 'pan')) {
    const bb = p.contourUV.reduce((s, q) => ({ u0: Math.min(s.u0, q[0]), u1: Math.max(s.u1, q[0]), v0: Math.min(s.v0, q[1]), v1: Math.max(s.v1, q[1]) }),
      { u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity });
    L.push(`   ${p.id} (spec e${p.sourceEdge}) pente ${p.pente.toFixed(1)}° — repère local ${(bb.u1 - bb.u0).toFixed(2)} × ${(bb.v1 - bb.v0).toFixed(2)} m de rampant`);
  }
  return L.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// roofYUnder — porté du module envelope du POC (hors des 12 modules du noyau).
//
// Surface du toit au point (x, z) du plan horizontal.
//
// L'ancienne définition — le MIN DES PLANS — n'est juste que sur une emprise
// CONVEXE. Dès qu'il y a un sommet rentrant (maison en L), le plan d'un pan
// lointain, prolongé, passe sous la vraie surface et le minimum ment : les
// bardages des façades du retour se faisaient recouper en escalier sous un
// plan qui n'est pas au-dessus d'eux.
//
// On demande donc d'abord au PAN QUI COUVRE réellement le point — contour de
// débord compris, c'est lui qui borne l'ouvrage. Le min des plans ne reste
// utilisé qu'à l'extérieur de la toiture, où il n'y a plus de pan à consulter
// et où il donne la bonne asymptote.
//
// ADAPTATION DE PORTAGE (seule différence avec la source) : `env` est ici
// { solve: { pans }, planes?, y0? } — `solve` peut être directement un modèle
// S3 (éventuellement passé par appliquerDebords), `planes` est facultatif
// ([{ origin: [x,y,z], normal: [nx,ny,nz] }]) car TERLAB n'a pas la couche
// envelope du POC ; sans lui l'asymptote extérieure retombe sur `env.y0 ?? 0`.
// ═══════════════════════════════════════════════════════════════════════════

export function roofYUnder(env, x, z) {
  const S = env.solve;
  if (S && S.pans && S.pans.length) {
    let h = Infinity;
    for (const pan of S.pans) {
      if (pan.kind !== 'pan') continue;
      const c = pan.contourDebord ?? pan.contour;
      if (!c || c.length < 3) continue;
      if (!pointInPoly([x, z], c)) continue;
      const y = pan.heightAt([x, z]);
      if (isFinite(y)) h = Math.min(h, y);
    }
    if (isFinite(h)) return h;
    // ── LE BORD N'EST PAS LE DEHORS ──────────────────────────────────────
    // `pointInPoly` n'est pas défini SUR la frontière (pas de tolérance, par
    // choix du noyau). Une pièce dont un coin de boîte tombe exactement sur
    // une arête d'emprise — la sablière d'un retour de L s'arrête pile au
    // sommet rentrant — n'était donc couverte par aucun pan, et retombait sur
    // le min des plans. Or ce min est FAUX sur une emprise non convexe : c'est
    // tout l'objet du paragraphe ci-dessus. Le scan annonçait ainsi
    // 2,654 m de perçage sur `TOIT-sabliere-F4` d'une maison en L — un
    // artefact de frontière, pas une pièce qui sort.
    //
    // On regarde donc le pan le plus PROCHE, à 10 cm près. Au-delà, on est
    // vraiment dehors et l'asymptote reprend ses droits.
    let dBest = Infinity, yBest = null;
    for (const pan of S.pans) {
      if (pan.kind !== 'pan') continue;
      const c = pan.contourDebord ?? pan.contour;
      if (!c || c.length < 3) continue;
      let d = Infinity;
      for (let i = 0, n = c.length; i < n; i++) {
        d = Math.min(d, distPointSegment([x, z], c[i], c[(i + 1) % n]));
      }
      if (d < dBest) { dBest = d; yBest = pan.heightAt([x, z]); }
    }
    if (dBest <= 0.10 && yBest !== null && isFinite(yBest)) return yBest;
  }
  let y = Infinity;
  for (const pl of env.planes ?? []) {
    const [ox, oy, oz] = pl.origin, [nx, ny, nz] = pl.normal;
    if (Math.abs(ny) < 1e-9) continue;       // plan vertical : pas de hauteur
    y = Math.min(y, oy - (nx * (x - ox) + nz * (z - oz)) / ny);
  }
  return isFinite(y) ? y : (env.y0 ?? 0);
}

/** Distance d'un point au segment AB, en plan. */
export function distPointSegment(P, A, B) {
  const dx = B[0] - A[0], dz = B[1] - A[1];
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-18) return Math.hypot(P[0] - A[0], P[1] - A[1]);
  let t = ((P[0] - A[0]) * dx + (P[1] - A[1]) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(P[0] - (A[0] + t * dx), P[1] - (A[1] + t * dz));
}
