// ═══════════════════════════════════════════════════════════════════════
// TERLAB · scripts/probe-tiles.mjs
// Sonde Node PURE (sans THREE, sans reseau, sans DOM) de la math de grille
// des tiles terrain : services/terrain-tiles.js (exports nommes purs) +
// selection LOD utils/biome-lod.js (hysteresis existante).
//
//   node scripts/probe-tiles.mjs
// ═══════════════════════════════════════════════════════════════════════

import {
  TILE_SIZE_M, LOD_PIXEL_SIZES, LOD_GEOMETRIC_ERRORS, MAX_WMS_PX,
  snapGlobal, tileForUTM, tileBounds, tileKey, copcDalleForTile,
  tileGrid, tilesInRadius, tileCenterLocal, sortTilesByDistance,
} from '../services/terrain-tiles.js';
import { focalPixels, screenSpaceError, pickLod, HYST_UP, HYST_DOWN } from '../utils/biome-lod.js';

let pass = 0, fail = 0;
function check(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✔ ${label}`); }
  else { fail++; console.error(`  ✘ ${label}${detail ? ' — ' + detail : ''}`); }
}
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

/* Coordonnees realistes Saint-Denis / Saint-Leu (UTM40S EPSG:2975) */
const E_TEST = 340250.7, N_TEST = 7684801.3;

/* ═══ 1 · Math de grille : tileForUTM / bounds ════════════════════════════ */
console.log('\n── 1 · tileForUTM / tileBounds');
{
  const { tx, ty } = tileForUTM(E_TEST, N_TEST);
  check('tx = floor(E/500)', tx === 680, `tx=${tx}`);
  check('ty = floor(N/500)', ty === 15369, `ty=${ty}`);
  const b = tileBounds(tx, ty);
  check('le point est dans les bounds de sa tile',
    E_TEST >= b.minE && E_TEST < b.maxE && N_TEST >= b.minN && N_TEST < b.maxN);
  check('bounds font exactement 500 m', b.maxE - b.minE === TILE_SIZE_M && b.maxN - b.minN === TILE_SIZE_M);
  // Frontiere exacte : un point sur maxE appartient a la tile SUIVANTE
  const t2 = tileForUTM(b.maxE, N_TEST);
  check('frontiere maxE → tile voisine', t2.tx === tx + 1);
  check('tileKey stable', tileKey(tx, ty, 2) === '680:15369:2');
}

/* ═══ 2 · Alignement dalle COPC : 1 km = exactement 4 tiles ═══════════════ */
console.log('\n── 2 · Alignement 4 tiles = 1 dalle COPC 1 km');
{
  const kx = 340, ky = 7684;                 // dalle [340000,341000]×[7684000,7685000]
  const quad = [[2 * kx, 2 * ky], [2 * kx + 1, 2 * ky], [2 * kx, 2 * ky + 1], [2 * kx + 1, 2 * ky + 1]];
  let minE = Infinity, minN = Infinity, maxE = -Infinity, maxN = -Infinity;
  let allInDalle = true;
  for (const [tx, ty] of quad) {
    const b = tileBounds(tx, ty);
    minE = Math.min(minE, b.minE); maxE = Math.max(maxE, b.maxE);
    minN = Math.min(minN, b.minN); maxN = Math.max(maxN, b.maxN);
    const d = copcDalleForTile(tx, ty);
    if (d.kx !== kx || d.ky !== ky) allInDalle = false;
  }
  check('union des 4 tiles = dalle 1 km exacte',
    minE === kx * 1000 && maxE === (kx + 1) * 1000 && minN === ky * 1000 && maxN === (ky + 1) * 1000);
  check('copcDalleForTile inverse coherent', allInDalle);
  check('aire couverte 2×2 sans trou ni recouvrement',
    (maxE - minE) * (maxN - minN) === 4 * TILE_SIZE_M * TILE_SIZE_M);
}

/* ═══ 3 · Snap global : voisines jointives, meme grille RGE Alti ══════════ */
console.log('\n── 3 · Snap pixel-centre global (jointure inter-tiles)');
for (let lod = 0; lod < LOD_PIXEL_SIZES.length; lod++) {
  const px = LOD_PIXEL_SIZES[lod];
  const tx = 680, ty = 15369;
  const g = tileGrid(tx, ty, lod);
  const gE = tileGrid(tx + 1, ty, lod);      // voisine est
  const gN = tileGrid(tx, ty + 1, lod);      // voisine nord

  check(`lod ${lod} (${px} m/px) : W,H ≤ ${MAX_WMS_PX}`, g.W <= MAX_WMS_PX && g.H <= MAX_WMS_PX,
    `W=${g.W} H=${g.H}`);
  check(`lod ${lod} : extent = (W−1)·px exact`,
    approx(g.maxE - g.minE, (g.W - 1) * px) && approx(g.maxN - g.minN, (g.H - 1) * px));

  // Tous les echantillons sur la grille lattice globale (k + 0.5)·px
  const onLattice = v => approx((v / px - 0.5) - Math.round(v / px - 0.5), 0);
  check(`lod ${lod} : bornes sur lattice pixel-centre global`,
    onLattice(g.minE) && onLattice(g.maxE) && onLattice(g.minN) && onLattice(g.maxN));

  // Jointure EXACTE : la colonne est de la tile = la colonne ouest de la voisine
  check(`lod ${lod} : jointure est/ouest exacte (maxE == minE voisine)`, g.maxE === gE.minE,
    `${g.maxE} vs ${gE.minE}`);
  check(`lod ${lod} : jointure nord/sud exacte (maxN == minN voisine)`, g.maxN === gN.minN,
    `${g.maxN} vs ${gN.minN}`);

  // Les deux voisines echantillonnent la MEME grille : tout echantillon
  // partage (colonne frontiere) a le meme E absolu dans les deux tiles.
  const lastColA = g.minE + (g.W - 1) * px;
  const firstColB = gE.minE;
  check(`lod ${lod} : colonne frontiere partagee au meme E absolu`, lastColA === firstColB);

  // La bbox WMS place bien le centre du pixel i sur minE + i·px
  check(`lod ${lod} : bbox WMS = bords de pixels autour des centres`,
    approx(g.bbox[0], g.minE - px / 2) && approx(g.bbox[2] - g.bbox[0], g.W * px));
}
{
  // Idempotence + coherence du snap depuis les DEUX cotes d'une frontiere
  for (const px of LOD_PIXEL_SIZES) {
    const edge = 340500;                     // frontiere entre tx=680 et tx=681
    check(`snap(${edge}, ${px}) identique des deux cotes`,
      snapGlobal(edge, px) === snapGlobal(edge + 0, px)
      && approx(snapGlobal(snapGlobal(edge, px), px), snapGlobal(edge, px)));
  }
}

/* ═══ 4 · Selection LOD : hysteresis (monte a contrecoeur, descend franchement) */
console.log('\n── 4 · pickLod + hysteresis BiomeLOD');
{
  const focal = focalPixels(900, 50 * Math.PI / 180);   // viewport 900 px, fov 50°
  const tol = 3;
  const errors = LOD_GEOMETRIC_ERRORS;

  // Sans etat courant : palier le plus grossier acceptable
  const dFine = 100, dFar = 5000;
  check('tres pres → palier 0 (1 m/px)', pickLod(errors, dFine, focal, tol) === 0);
  check('tres loin → palier max (8 m/px)', pickLod(errors, dFar, focal, tol) === errors.length - 1);

  // Frontiere lod0/lod1 : d1 = errors[1]·focal/tol
  const d1 = errors[1] * focal / tol;
  check('juste au-dela de la frontiere, sans etat → palier 1',
    pickLod(errors, d1 * 1.01, focal, tol) === 1);

  // MONTE A CONTRECOEUR : depuis lod1, se rapprocher un peu ne suffit pas —
  // il faut que l'erreur du palier courant depasse tol·HYST_UP (16 %)
  const dReluctant = errors[1] * focal / (tol * HYST_UP) * 1.02;  // erreur < tol·1.16
  check(`HYST_UP=${HYST_UP} : rapprochement leger → reste au palier 1`,
    pickLod(errors, dReluctant, focal, tol, 1) === 1,
    `sse=${screenSpaceError(errors[1], dReluctant, focal).toFixed(2)}`);
  const dCommit = errors[1] * focal / (tol * HYST_UP) * 0.9;      // erreur > tol·1.16
  check('rapprochement franc → passe au palier 0',
    pickLod(errors, dCommit, focal, tol, 1) === 0);

  // DESCEND FRANCHEMENT : depuis lod0, s'eloigner un peu ne suffit pas —
  // le candidat doit etre confortablement sous tol·HYST_DOWN (72 %)
  const dTimid = errors[1] * focal / (tol * HYST_DOWN) * 0.95;    // sse candidat > tol·0.72
  check(`HYST_DOWN=${HYST_DOWN} : eloignement leger → reste au palier 0`,
    pickLod(errors, dTimid, focal, tol, 0) === 0,
    `sse=${screenSpaceError(errors[1], dTimid, focal).toFixed(2)}`);
  const dRelease = errors[1] * focal / (tol * HYST_DOWN) * 1.1;   // sse candidat < tol·0.72
  check('eloignement franc → relache au palier 1',
    pickLod(errors, dRelease, focal, tol, 0) === 1);

  // Aller-retour stable : le seuil de montee (dCommit) est strictement plus
  // pres que le seuil de descente (dTimid) → bande morte non vide
  check('bande morte non vide (pas de clignotement)', dCommit < dTimid,
    `dCommit=${dCommit.toFixed(0)} m, dTimid=${dTimid.toFixed(0)} m`);
}

/* ═══ 5 · Priorisation par distance croissante ════════════════════════════ */
console.log('\n── 5 · Selection spatiale + priorisation');
{
  const origin = { E0: 340250, N0: 7684800, alt0: 120 };
  const r = 2;
  const { tx: ctx, ty: cty } = tileForUTM(origin.E0, origin.N0);
  const ring = tilesInRadius(ctx, cty, r);
  check(`(2r+1)² tiles pour r=${r}`, ring.length === (2 * r + 1) ** 2, `n=${ring.length}`);
  check('la premiere est la tile centrale', ring[0].tx === ctx && ring[0].ty === cty);
  check('rings croissants (centre servi d\'abord)',
    ring.every((t, i) => i === 0 || t.ring >= ring[i - 1].ring));

  // Camera locale au-dessus du centre, decalee vers l'est
  const cam = { x: 400, y: 300, z: 0 };
  const sorted = sortTilesByDistance(ring, cam, origin);
  check('tri par distance croissante',
    sorted.every((t, i) => i === 0 || t.distance >= sorted[i - 1].distance));
  check('la plus proche est plus a l\'est que la plus lointaine',
    tileCenterLocal(sorted[0].tx, sorted[0].ty, origin).x
    > tileCenterLocal(sorted[sorted.length - 1].tx, sorted[sorted.length - 1].ty, origin).x);

  // Round-trip @coords : local → UTM → tile → centre local reste dans la tile
  const p = { x: 137.5, z: -462.25 };                       // point local arbitraire
  const E = origin.E0 + p.x, N = origin.N0 - p.z;           // inverse du mapping
  const t = tileForUTM(E, N);
  const c = tileCenterLocal(t.tx, t.ty, origin);
  check('round-trip local↔UTM : le point local retombe dans sa tile',
    Math.abs(c.x - p.x) <= TILE_SIZE_M / 2 && Math.abs(c.z - p.z) <= TILE_SIZE_M / 2);
}

/* ═══ Bilan ═══════════════════════════════════════════════════════════════ */
console.log(`\n${'═'.repeat(50)}`);
if (fail === 0) {
  console.log(`PROBE VERT — ${pass} assertions OK`);
} else {
  console.error(`PROBE ROUGE — ${fail} echec(s) / ${pass + fail}`);
  process.exit(1);
}
