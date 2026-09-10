// ═══════════════════════════════════════════════════════════════════════════
// S2 — LIMITE DE PAN : le sommet à 180° entre deux poids différents
//
// LE PROBLÈME
// ───────────
// Deux arêtes colinéaires portent la même droite d'égout mais des poids
// différents. Le système du sommet devient
//        V·n = s₁   ET   V·n = s₂        (n₁ = n₂ = n)
// — INCONSISTANT. Aucune vélocité ne convient. L'original renvoyait la normale
// à vitesse 1 ; le résultat est faux dès que s ≠ 1, et il crée deux pans
// coplanaires séparés par une fausse arête d'angle dièdre nul.
//
// LA RÉSOLUTION
// ─────────────
// Le front d'onde se DÉCHIRE au sommet : la ligne de gauche avance à s₁, celle
// de droite à s₂, elles restent parallèles et s'écartent de |s₁ − s₂|·t. Il faut
// une arête pour combler l'écart, et cette arête est le PLAN VERTICAL qui passe
// par le sommet, perpendiculaire à la droite d'égout.
//
// On insère donc au sommet une arête de LONGUEUR NULLE, de POIDS 0 (plan
// vertical), dirigée selon la normale intérieure de la paire colinéaire. Le
// moteur fait le reste, sans aucun cas particulier :
//
//    sommet A entre e_gauche (s₁) et e_retour (0)  →  V·n_g = s₁, V·n_r = 0
//    sommet B entre e_retour (0) et e_droite (s₂)  →  V·n_r = 0, V·n_d = s₂
//
// Sur un mur sud (u = +x, n = +z) avec s₁ = 0 (pignon) et s₂ = cot θ :
//    A reste fixe, B glisse vers le nord à cot θ  →  l'arête de retour croît
//    exactement comme la rive rampante du pignon. C'est le résultat attendu.
//
// CE QUE ÇA PRODUIT
// ─────────────────
// Une RIVE VERTICALE : le geste d'édition « partir d'un rectangle, insérer un
// sommet au milieu d'un côté, donner deux modes différents aux deux moitiés ».
// Cela donne `deux_pans_decale` et le pignon partiel. (Correction d'une
// imprécision de la spécification S1 : la demi-croupe et la croupe hollandaise
// ne viennent PAS de là — elles demandent un poids variable dans le TEMPS,
// c'est le mécanisme M2, prévu en S6.)
//
// Porté depuis bimshow-vision (POC ciriani-santillana, module `breaks`).
// ═══════════════════════════════════════════════════════════════════════════

import { interiorAngle } from './geom2d.js';
import { edgeDirs } from './weighted-skeleton.js';

export const BREAK_TOL = {
  /** écart à 180° sous lequel deux arêtes sont dites colinéaires (rad) */
  flat: 0.5 * Math.PI / 180,
  /** écart relatif de poids sous lequel deux poids sont dits égaux */
  weight: 1e-6,
};

/**
 * Détecte les sommets à 180° dont les deux arêtes portent des poids différents,
 * et insère à chacun une arête de retour verticale (longueur nulle, poids 0).
 *
 * @param {Array<[number,number]>} poly  emprise CCW, déjà validée
 * @param {Array<number>} weights        un poids par arête
 * @returns {{ poly, weights, dirs, breaks, inserted }}
 *          `dirs[i]` porte la direction explicite de chaque arête (obligatoire
 *          pour les arêtes de longueur nulle) · `breaks` décrit ce qui a été
 *          inséré, pour le rapport et pour l'UI.
 */
export function insertVerticalBreaks(poly, weights, origin = null, tol = BREAK_TOL) {
  const P = poly.map((p) => [p[0], p[1]]);
  const W = [...weights];
  const O = origin ? [...origin] : poly.map((_, i) => i);
  const D = edgeDirs(P);
  const breaks = [];
  const warnings = [];
  // demi-profondeur de l'emprise : échelle à laquelle le front d'onde se referme
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const q of P) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
  const demiProfondeur = Math.min(x1 - x0, z1 - z0) / 2;

  // On parcourt à l'envers : insérer décale les indices supérieurs.
  for (let i = P.length - 1; i >= 0; i--) {
    const n = P.length;
    const iL = (i - 1 + n) % n, iR = i;
    const uL = D[iL], uR = D[iR];
    if (!uL || !uR) continue;
    const ang = interiorAngle(P[iL], P[i], P[(i + 1) % n]);
    if (Math.abs(ang - Math.PI) > tol.flat) continue;
    const sL = W[iL], sR = W[iR];
    const rel = Math.abs(sL - sR) / Math.max(1, Math.abs(sL), Math.abs(sR));
    if (rel < tol.weight) continue;                   // poids égaux → rien à faire

    // Direction du retour vertical.
    //   Le face verticale relie les deux fronts d'onde, qui avancent à des
    //   vitesses différentes. Elle doit CROÎTRE, donc pointer du front LENT
    //   vers le front RAPIDE : normale intérieure si la moitié de gauche est
    //   la plus lente, normale extérieure sinon. À défaut, l'arête naît de
    //   longueur nulle et s'effondre immédiatement (événement à t = 0).
    const nInt = [-uL[1], uL[0]];
    const dir = sL < sR ? nInt : [-nInt[0], -nInt[1]];
    // longueurs des deux moitiés — À MESURER AVANT la duplication du sommet
    const lg = Math.hypot(P[i][0] - P[iL][0], P[i][1] - P[iL][1]);
    const ld = Math.hypot(P[(i + 1) % n][0] - P[i][0], P[(i + 1) % n][1] - P[i][1]);
    const court = Math.min(lg, ld);

    // duplication du sommet : … P[iL] →(sL)→ P[i] →(0)→ P[i]' →(sR)→ P[i+1] …
    P.splice(i + 1, 0, [P[i][0], P[i][1]]);
    W.splice(i, 0, 0);
    D.splice(i, 0, dir);
    O.splice(i, 0, null);                            // arête insérée : sans origine
    // MESURE (balayage de 792 coupes) : la construction est exacte à 98 % dès
    // que la moitié la plus courte atteint la demi-profondeur de l'emprise, et
    // à 100 % au-delà de 1,5×. En deçà, le petit pan est absorbé avant que le
    // front d'onde ne se referme et la géométrie dégénère — l'audit le refuse,
    // mais autant le dire à l'utilisateur au moment du tracé.
    if (court < demiProfondeur) {
      warnings.push({ code: 'RETOUR_TROP_PRES_D_UN_ANGLE', at: i,
        msg: `Limite de pan au sommet ${i} : la moitié la plus courte mesure ${court.toFixed(2)} m `
           + `pour une demi-profondeur d'emprise de ${demiProfondeur.toFixed(2)} m. `
           + `En deçà de 1,0× la construction dégénère une fois sur deux — déplacer la coupe.`,
        court, demiProfondeur, ratio: court / demiProfondeur });
    }
    breaks.push({
      at: i, edge: i,                                 // index de l'arête de retour
      point: [P[i][0], P[i][1]],
      dir, sGauche: sL, sDroite: sR,
      pentes: [pente(sL), pente(sR)],
    });
  }

  return { poly: P, weights: W, dirs: D, origin: O, breaks: breaks.reverse(), inserted: breaks.length, warnings };
}

const pente = (s) => (s === 0 ? 90 : Math.atan(1 / s) * 180 / Math.PI);

/**
 * Hauteur atteinte par chaque retour vertical, une fois le squelette calculé :
 * c'est l'altitude du sommet mobile de l'arête de retour au moment où il est
 * consommé. Donne la cote de la rive verticale, à coter sur les plans.
 */
export function heightsOfBreaks(skel, breaks) {
  return breaks.map((b) => {
    let h = 0;
    for (const nd of skel.nodes) {
      if (Math.hypot(nd.x - b.point[0], nd.z - b.point[1]) > 1e-6) {
        // On suit la DROITE portant le retour. Les deux sommets s'éloignent du
        // même côté (celui du front rapide), qui n'est pas forcément le sens de
        // `dir` : celui-ci est orienté pour que l'arête croisse, pas pour
        // indiquer où elle va. On ne teste donc que l'écart à la droite.
        const dx = nd.x - b.point[0], dz = nd.z - b.point[1];
        const along = dx * b.dir[0] + dz * b.dir[1];
        const off = Math.hypot(dx - along * b.dir[0], dz - along * b.dir[1]);
        if (off > 1e-6) continue;
      }
      h = Math.max(h, nd.t);
    }
    return { ...b, hauteur: h };
  });
}
