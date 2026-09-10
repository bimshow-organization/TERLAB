// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION D'ENTRÉE — la barrière avant l'algorithme
//
// Le squelette droit pondéré est robuste sur une géométrie propre et diverge
// silencieusement sur une géométrie sale. Les 9 contrôles ci-dessous sont la
// seule chose qui sépare « éditeur » de « démo ».
//
// Règle absolue du projet : AUCUNE correction silencieuse. Tout ce qui est
// modifié ou rejeté est rapporté dans `errors` / `warnings` / `repairs`.
//
// Porté depuis bimshow-vision (POC ciriani-santillana, module `validate`).
// ═══════════════════════════════════════════════════════════════════════════

import { ensureCCW, signedArea, hasSelfIntersect, interiorAngle, bbox, area } from './geom2d.js';

export const LIMITS = {
  /** 1 · longueur d'arête minimale (m) — en deçà : fusion des deux sommets */
  minEdgeLen: 0.01,
  /** 2 · distance minimale entre sommets NON adjacents (m) — auto-contact */
  minVertexGap: 0.02,
  /** 5 · écart à 180° sous lequel un sommet est dit colinéaire (rad) */
  flatTol: 0.5 * Math.PI / 180,
  /** 5bis · écart relatif de poids sous lequel deux poids sont dits égaux */
  weightTol: 1e-6,
  /** 6 · angle intérieur mini avant avertissement (rad) — arêtier quasi tangent */
  minInteriorAngle: 15 * Math.PI / 180,
  /**
   * 6bis · angle intérieur sous lequel l'emprise est REFUSÉE (rad).
   *
   * L'avertissement de 15° dit que l'arêtier sera difficile ; il ne dit pas
   * que le calcul va mal tourner. Or sous quelques degrés il tourne mal :
   * deux arêtes presque confondues engendrent des événements de squelette
   * séparés par des microns, la pointe part à l'infini à la vitesse
   * 1/sin(α/2) — ×23 à 5°, ×115 à 1° — et les jonctions de murs sortent en
   * lames de rasoir indébitables.
   *
   * On ne le « corrige » pas : un sommet déplacé dans le dos de l'utilisateur
   * est pire qu'un refus. On refuse, en nommant le sommet et sa mesure.
   * Réglable : 5° est le plancher pour une esquisse, 15° pour un projet.
   */
  rejectInteriorAngle: 5 * Math.PI / 180,
  /** 7 · angle rentrant : avertissement / rejet (rad).
   *  La vitesse du sommet diverge en 1/sin(α/2) : ×1,41 à 270° (coude en L,
   *  parfaitement sain), ×2,9 à 320°, ×11,5 à 350°. Les seuils sont posés là
   *  où la vitesse devient réellement problématique, pas sur le coude en L. */
  reflexWarn: 320 * Math.PI / 180,
  reflexReject: 350 * Math.PI / 180,
  /** aire minimale de l'emprise (m²) */
  minArea: 1.0,
};

/**
 * @param {Array<[number,number]>} poly   emprise, en mètres
 * @param {Array<number>} weights         un poids par arête (arête i = sommet i → i+1)
 * @returns {{ ok, errors, warnings, repairs, poly, weights, stats }}
 *          poly/weights sont la version NETTOYÉE (à utiliser en aval).
 */
export function validateFootprint(poly, weights, limits = LIMITS) {
  const errors = [];
  const warnings = [];
  const repairs = [];

  if (!Array.isArray(poly) || poly.length < 3) {
    return { ok: false, errors: [{ code: 'POLY_TROP_COURT', msg: 'Emprise : au moins 3 sommets requis.' }],
             warnings, repairs, poly, weights, stats: null };
  }
  if (!Array.isArray(weights) || weights.length !== poly.length) {
    return { ok: false, errors: [{ code: 'POIDS_INCOHERENTS', msg: `Il faut exactement un poids par arête (${poly.length} attendus, ${weights?.length} reçus).` }],
             warnings, repairs, poly, weights, stats: null };
  }

  // ── Orientation : canonique CCW. L'arête i doit suivre le sommet i.
  let P = poly.map((p) => [p[0], p[1]]);
  let W = [...weights];
  let O = poly.map((_, i) => i);            // arête → indice de la spec d'origine
  if (signedArea(P) < 0) {
    // reverse des sommets : l'arête i (i→i+1) devient l'arête (n-2-i)
    const n = P.length;
    P = [...P].reverse();
    W = Array.from({ length: n }, (_, i) => weights[(n - 2 - i + n) % n]);
    O = Array.from({ length: n }, (_, i) => (n - 2 - i + n) % n);
    repairs.push({ code: 'REORIENTE_CCW', msg: 'Emprise réorientée en sens trigonométrique (poids réindexés).' });
  }

  // ── 1 · arêtes de longueur nulle → fusion
  {
    let changed = true, guard = 0;
    while (changed && guard++ < P.length + 4) {
      changed = false;
      for (let i = 0; i < P.length && P.length > 3; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < limits.minEdgeLen) {
          const j = (i + 1) % P.length;
          repairs.push({ code: 'ARETE_NULLE', at: i,
            msg: `Arête ${i} de longueur < ${limits.minEdgeLen * 1000} mm : sommets fusionnés.` });
          P.splice(j, 1); W.splice(i, 1); O.splice(i, 1);
          changed = true; break;
        }
      }
    }
  }

  const n = P.length;
  if (n < 3) errors.push({ code: 'DEGENERE', msg: 'Après nettoyage, moins de 3 sommets subsistent.' });

  // ── 2 · sommets coïncidents non adjacents → auto-contact
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const d = Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]);
      if (d < limits.minVertexGap) {
        errors.push({ code: 'AUTO_CONTACT', at: [i, j],
          msg: `Sommets ${i} et ${j} distants de ${(d * 1000).toFixed(0)} mm : l'emprise se touche elle-même.` });
      }
    }
  }

  // ── 3 · auto-intersection → rejet bloquant
  if (hasSelfIntersect(P)) {
    errors.push({ code: 'AUTO_INTERSECTION', msg: "L'emprise se recoupe. Aucune toiture n'est définissable." });
  }

  // ── 5 · sommets colinéaires
  //   poids égaux    → suppression du sommet (fusion des 2 arêtes)
  //   poids différents → LIMITE DE PAN : rive verticale — non traité en S1.
  const flat180 = [];
  {
    let i = 0, guard = 0;
    while (i < P.length && guard++ < P.length * 3) {
      const m = P.length;
      if (m <= 3) break;
      const prev = P[(i - 1 + m) % m], cur = P[i], next = P[(i + 1) % m];
      const ang = interiorAngle(prev, cur, next);
      if (Math.abs(ang - Math.PI) < limits.flatTol) {
        const sL = W[(i - 1 + m) % m], sR = W[i];
        const rel = Math.abs(sL - sR) / Math.max(1, Math.abs(sL), Math.abs(sR));
        if (rel < limits.weightTol) {
          repairs.push({ code: 'SOMMET_PLAT_SUPPRIME', at: i,
            msg: `Sommet ${i} à 180° entre deux arêtes de même poids : supprimé (arêtes fusionnées).` });
          P.splice(i, 1); W.splice((i - 1 + m) % m, 1); O.splice((i - 1 + m) % m, 1);
          continue;   // ne pas incrémenter, la liste a bougé
        }
        flat180.push({ at: i, sL, sR });
      }
      i++;
    }
  }
  for (const f of flat180) {
    repairs.push({ code: 'LIMITE_DE_PAN', at: f.at,
      msg: `Sommet ${f.at} à 180° entre deux poids différents (${f.sL.toFixed(3)} / ${f.sR.toFixed(3)}) : `
         + `limite de pan — un retour vertical y sera inséré (S2).` });
  }

  const m = P.length;

  // ── 6/7 · angles intérieurs
  let nReflex = 0, nReflexActifs = 0;
  for (let i = 0; i < m; i++) {
    const prev = P[(i - 1 + m) % m], cur = P[i], next = P[(i + 1) % m];
    const ang = interiorAngle(prev, cur, next);
    const deg = (ang * 180) / Math.PI;
    const sL = W[(i - 1 + m) % m], sR = W[i];

    if (ang < 1e-6 || ang > 2 * Math.PI - 1e-6) {
      errors.push({ code: 'ANGLE_DEGENERE', at: i, msg: `Sommet ${i} : angle intérieur ${deg.toFixed(1)}° — pointe ou repli dégénéré.` });
      continue;
    }
    // LE REFUS D'ABORD, L'AVERTISSEMENT ENSUITE — un sommet ne doit pas être
    // à la fois refusé et « seulement signalé ». Le seuil de refus est
    // toujours plus serré que celui d'avertissement (contrôlé plus bas).
    if (ang < limits.rejectInteriorAngle) {
      errors.push({ code: 'ANGLE_TROP_FERME', at: i,
        msg: `Sommet ${i} : angle de murs ${deg.toFixed(1)}° < `
          + `${((limits.rejectInteriorAngle * 180) / Math.PI).toFixed(1)}° — pointe trop aiguë. `
          + `La vitesse du sommet y vaut ×${(1 / Math.sin(ang / 2)).toFixed(0)} : `
          + 'la jonction de murs sortirait en lame de rasoir.' });
    } else if (ang < limits.minInteriorAngle) {
      warnings.push({ code: 'ANGLE_TRES_FERME', at: i,
        msg: `Sommet ${i} : angle intérieur ${deg.toFixed(1)}° — l'arêtier sera quasi tangent, pièces difficiles à réaliser.` });
    }
    if (ang > Math.PI + limits.flatTol) {
      nReflex++;
      // un rentrant n'engendre une noue que si SES DEUX arêtes portent un pan
      if (sL > 0 && sR > 0) nReflexActifs++;
      if (ang >= limits.reflexReject) {
        errors.push({ code: 'RENTRANT_EXCESSIF', at: i,
          msg: `Sommet ${i} : angle rentrant ${deg.toFixed(1)}° ≥ ${(limits.reflexReject * 180 / Math.PI).toFixed(0)}°. `
             + `La vitesse du sommet diverge en 1/sin(α/2) — géométrie rejetée.` });
      } else if (ang >= limits.reflexWarn) {
        warnings.push({ code: 'RENTRANT_AIGU', at: i,
          msg: `Sommet ${i} : angle rentrant ${deg.toFixed(1)}° — noue très ouverte, vitesse de sommet élevée (×${(1 / Math.sin(ang / 2)).toFixed(1)}).` });
      }
    }
  }

  // ── 8 · au moins une arête doit porter un pan
  const nPans = W.filter((s) => s > 0 && isFinite(s)).length;
  if (nPans === 0) {
    errors.push({ code: 'AUCUN_PAN', msg: 'Toutes les arêtes sont en pignon (poids nul) : aucun pan de toiture.' });
  }
  for (const s of W) {
    if (!isFinite(s)) errors.push({ code: 'POIDS_INFINI', msg: 'Poids infini (pente nulle) : utiliser le mode terrasse, pas le squelette.' });
    if (s < 0) errors.push({ code: 'POIDS_NEGATIF', msg: 'Poids négatif : le sens de montée inversé est le mécanisme M3, pas un poids.' });
  }

  // ── 9 · deux arêtes pignon adjacentes ET parallèles → sommet immobile jamais consommé
  for (let i = 0; i < m; i++) {
    const sL = W[(i - 1 + m) % m], sR = W[i];
    if (sL === 0 && sR === 0) {
      const ang = interiorAngle(P[(i - 1 + m) % m], P[i], P[(i + 1) % m]);
      if (Math.abs(ang - Math.PI) < limits.flatTol) {
        errors.push({ code: 'SOMMET_IMMOBILE', at: i,
          msg: `Sommet ${i} entre deux pignons colinéaires : vitesse nulle, jamais consommé par un événement.` });
      } else {
        warnings.push({ code: 'ANGLE_DE_PIGNONS', at: i,
          msg: `Sommet ${i} entre deux pignons : arête verticale d'angle de murs (pas de pièce de charpente).` });
      }
    }
  }

  // ── aire
  const A = area(P);
  if (A < limits.minArea) {
    errors.push({ code: 'AIRE_INSUFFISANTE', msg: `Aire de l'emprise ${A.toFixed(2)} m² < ${limits.minArea} m².` });
  }

  const bb = bbox(P);
  return {
    ok: errors.length === 0,
    errors, warnings, repairs,
    poly: P, weights: W, origin: O, limitesDePan: flat180,
    stats: { n: m, aire: A, perimetre: bb.diag, bbox: bb, nPans, nReflex, nReflexActifs },
  };
}

// ═══ L'ANGLE DE MURS — CE QU'ON MESURE AVANT DE POSER LE POINT ═════════════
//
// `validate` juge une emprise FERMÉE. Pendant qu'on trace, l'emprise n'est pas
// fermée : il n'y a pas encore d'intérieur, donc pas d'angle intérieur. Ce qui
// est déjà défini, en revanche, c'est l'ANGLE ENTRE DEUX MURS — non signé,
// dans [0°, 180°]. C'est cet angle-là qu'un charpentier lit sur un plan, et
// c'est lui qui décide si la jonction est réalisable.
//
// La mesure non signée attrape les deux dégénérescences d'un seul coup : la
// pointe sortante (angle intérieur 3°) et le repli rentrant (angle intérieur
// 357°) sont la MÊME lame de rasoir, vue des deux côtés. Un contrôle sur
// l'angle intérieur seul en manquerait une sur deux.

/** Angle entre les murs BA et BC, en degrés, dans [0, 180]. */
export function angleMurs(A, B, C) {
  const u = [A[0] - B[0], A[1] - B[1]];
  const v = [C[0] - B[0], C[1] - B[1]];
  const lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
  if (lu < 1e-12 || lv < 1e-12) return 0;
  const cos = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Les angles de murs d'une polyligne.
 * @param poly    [[x, z], …]
 * @param ferme   true = polygone (on mesure aussi les deux sommets de couture)
 * @returns [{ i, angle, a, b }] — `a`/`b` sont les longueurs des deux murs
 */
export function anglesMurs(poly, ferme = true) {
  const n = poly.length;
  const out = [];
  if (n < 3) return out;
  const debut = ferme ? 0 : 1;
  const fin = ferme ? n : n - 1;
  for (let i = debut; i < fin; i++) {
    const A = poly[(i - 1 + n) % n], B = poly[i], C = poly[(i + 1) % n];
    out.push({ i, angle: angleMurs(A, B, C),
      a: Math.hypot(B[0] - A[0], B[1] - A[1]),
      b: Math.hypot(C[0] - B[0], C[1] - B[1]) });
  }
  return out;
}

/**
 * LA QUESTION QUE POSE L'INTERFACE AVANT D'ÉCRIRE UN POINT : « si je pose P
 * ici, est-ce que je crée une pointe impossible ? »
 *
 * Poser P crée UN angle quand la polyligne reste ouverte (au dernier sommet
 * déjà posé) et TROIS quand elle se ferme (le dernier, le nouveau, et le
 * premier). On les rend tous, avec le fautif nommé — jamais un simple `false`,
 * qui laisserait l'utilisateur deviner lequel des trois pose problème.
 *
 * @returns { ok, mini, fautif: {i, angle}|null, angles: [{i, angle}] }
 */
export function poserSommet(poly, P, opts = {}) {
  const mini = opts.mini ?? (LIMITS.rejectInteriorAngle * 180) / Math.PI;
  const ferme = !!opts.ferme;
  const pts = ferme ? poly.slice() : poly.concat([P]);
  const angles = anglesMurs(pts, ferme).filter((x) => {
    if (ferme) return true;
    // en cours de tracé, seuls les angles NOUVELLEMENT définis sont en jeu :
    // les précédents ont déjà été acceptés, les redire serait du bruit.
    return x.i === pts.length - 2;
  });
  let fautif = null;
  for (const x of angles) if (x.angle < mini && (!fautif || x.angle < fautif.angle)) fautif = x;
  return { ok: !fautif, mini, fautif, angles };
}
