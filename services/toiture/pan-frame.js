// ═══════════════════════════════════════════════════════════════════════════
// LE REPÈRE D'UN PAN — une seule définition, partagée
//
// Un pan est un plan incliné qui s'appuie sur une arête horizontale. Il n'y a
// aucune raison que le pan d'un squelette (S3) et la facette d'un étage (S6)
// aient deux constructions de repère différentes : ce sont le même objet
// géométrique, et le peuplement (S4) doit pouvoir les traiter sans savoir d'où
// ils viennent.
//
//        u  le long de l'arête d'appui       (horizontal)
//        v  ligne de plus grande pente       (montante, EN VRAIE GRANDEUR)
//        n  normale du plan                  (sortante)
//
// `toWorld(toLocal(P)) ≡ P` pour tout P du plan du pan.
//
// @coords  monde = [x, y, z] avec y = altitude · plan = [x, z] · pan = [u, v]
//
// Porté depuis bimshow-vision (POC ciriani-santillana, module `pan-frame`).
// ═══════════════════════════════════════════════════════════════════════════

const DEG = Math.PI / 180;

const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * Repère local d'un pan appuyé sur l'arête (A, direction u), de pente θ,
 * dont l'arête d'appui est à l'altitude `baseY`.
 *
 * @param A      [x, z] · origine de l'arête d'appui
 * @param u      [ux, uz] unitaire · direction de l'arête (l'intérieur est à gauche)
 * @param pente  degrés · 90 = plan vertical (pignon)
 * @param baseY  altitude de l'arête d'appui
 */
export function panFrame(A, u, pente, baseY = 0) {
  const vertical = Math.abs(pente - 90) < 1e-9;
  const nInt = [-u[1], u[0]];                       // normale intérieure (CCW)
  const cos = Math.cos(pente * DEG), sin = Math.sin(pente * DEG);
  const tan = vertical ? Infinity : Math.tan(pente * DEG);

  const u3 = [u[0], 0, u[1]];
  const v3 = vertical ? [0, 1, 0] : [nInt[0] * cos, sin, nInt[1] * cos];
  const n3 = cross3(v3, u3);                        // sortante (vers le ciel)
  const A3 = [A[0], baseY, A[1]];

  /** plan ou monde → (u, v). v est une VRAIE longueur de rampant. */
  const toLocal = (P) => {
    const px = P[0], pz = P.length === 3 ? P[2] : P[1];
    const dx = px - A[0], dz = pz - A[1];
    const uu = dx * u[0] + dz * u[1];
    const d = dx * nInt[0] + dz * nInt[1];          // distance horizontale à l'appui
    return [uu, vertical ? (P.length === 3 ? P[1] - baseY : 0) : d / cos];
  };
  /** (u, v) → monde 3D, sur le plan du pan. */
  const toWorld = (uv) => [
    A3[0] + u3[0] * uv[0] + v3[0] * uv[1],
    A3[1] + u3[1] * uv[0] + v3[1] * uv[1],
    A3[2] + u3[2] * uv[0] + v3[2] * uv[1],
  ];
  /** altitude du plan au-dessus d'un point du plan horizontal */
  const heightAt = (P2) => (vertical ? NaN
    : baseY + ((P2[0] - A[0]) * nInt[0] + (P2[1] - A[1]) * nInt[1]) * tan);

  return { vertical, nInt, repere: { u: u3, v: v3, n: n3 }, origine: A, origine3: A3,
           baseY, pente, toLocal, toWorld, heightAt };
}

/**
 * Décalage à appliquer à la trame d'un pan pour que ses rangs s'alignent sur
 * ceux d'un autre pan PARALLÈLE — le cas d'un brisis et de son terrasson.
 *
 * Sur une toiture mansardée, les chevrons du brisis et ceux du terrasson se
 * rejoignent sur la panne de brisis : ils doivent tomber les uns en face des
 * autres. Les deux pans ont la même direction d'arête mais des origines
 * différentes (l'une est l'offset de l'autre), donc leurs abscisses u sont
 * décalées d'une constante — qu'on calcule ici plutôt que d'espérer.
 *
 * @returns le décalage `offset` à passer à la couche, ou 0 si les pans ne sont
 *          pas parallèles (auquel cas aucun alignement n'a de sens).
 */
export function alignerTrame(panRef, pan, pas) {
  const uR = panRef.repere.u, uP = pan.repere.u;
  const colin = uR[0] * uP[0] + uR[2] * uP[2];
  if (Math.abs(Math.abs(colin) - 1) > 1e-6 || !(pas > 0)) return 0;
  // abscisse, dans la trame de `pan`, de l'origine de `panRef`
  const dU = pan.toLocal(panRef.origine)[0];
  // le rang r de `panRef` tombe en u = r·pas + dU dans `pan` : il suffit donc
  // de décaler la trame de `pan` de dU modulo le pas.
  const d = dU % pas;
  return d < 0 ? d + pas : d;
}
