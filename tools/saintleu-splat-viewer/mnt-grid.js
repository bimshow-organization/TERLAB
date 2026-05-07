/**
 * TERLAB . mnt-grid.js
 * Source de verite altimetrique pour le viewer SOTA :
 *   - fetch grille MNT IGN RGE ALTI 65x65 par zone (1m precision)
 *   - cache par zoneSlug -> reutilisable par toutes les couches
 *   - lookup bilineaire Y(x_local, z_local) pour reprojeter routes, bati,
 *     clotures, arbres, et overlays WMS sur le terrain reel
 *
 * Reutilise fetchGridElevations de ign-contours.js (meme API).
 */

import * as THREE from 'three';
import { fetchGridElevations } from './ign-contours.js';

const _cache = new Map();  // zoneSlug -> {grid, mntMin, mntMax, sideM, gridN}


export async function getMntGrid({ slug, lat, lng, sideM, gridN = 65 }) {
  if (_cache.has(slug)) return _cache.get(slug);
  console.log(`[mnt] fetch IGN RGE ALTI ${gridN}x${gridN} ${slug}...`);
  const grid = await fetchGridElevations({ lat, lng, sideM, gridN });
  let mntMin = Infinity, mntMax = -Infinity;
  for (const row of grid) for (const v of row) {
    if (v < mntMin) mntMin = v;
    if (v > mntMax) mntMax = v;
  }
  const obj = { grid, mntMin, mntMax, sideM, gridN, lat, lng };
  _cache.set(slug, obj);
  console.log(`[mnt] ${slug} : ${mntMin.toFixed(1)}-${mntMax.toFixed(1)}m, range=${(mntMax-mntMin).toFixed(1)}m`);
  return obj;
}


/**
 * Lookup bilineaire Y depuis (x_local, z_local) en metres
 * (origine = centre de la zone, axes Y-up world : x=ouest->est, z=nord->sud).
 *
 * grid[row][col] : row=0 sud (z=+halfM), row=N-1 nord (z=-halfM)
 *                  col=0 ouest (x=-halfM), col=N-1 est (x=+halfM)
 *
 * Retourne altitude IGN absolue (m). Pour Y local au splat,
 * soustraire mntMin.
 */
export function lookupAltAt(mntInfo, x_local, z_local) {
  const { grid, sideM, gridN } = mntInfo;
  const half = sideM / 2;
  // Convert to grid indices (continuous)
  const fc = (x_local + half) / sideM * (gridN - 1);
  const fr = (half - z_local) / sideM * (gridN - 1); // z<0 nord -> row haute (gridN-1)
  // Wait: row=0 sud (latMin), and our z=+half est sud (-(lat-latC) avec lat<latC).
  // Let me re-derive : lat sud = latMin = lat - dLat, donc lat - latC = -dLat -> z_local = -((-dLat) * m_per_deg) = +dLat * 111320 = +half. OK z=+half = sud.
  // row 0 = sud = z=+half. row gridN-1 = nord = z=-half.
  // f_r = 0 quand z = +half, f_r = gridN-1 quand z = -half.
  // f_r = (gridN-1) * (half - z) / sideM = (half - z) / sideM * (gridN-1). OK c'est ce que j'ai.
  const c0 = Math.max(0, Math.min(gridN - 1, Math.floor(fc)));
  const r0 = Math.max(0, Math.min(gridN - 1, Math.floor(fr)));
  const c1 = Math.min(gridN - 1, c0 + 1);
  const r1 = Math.min(gridN - 1, r0 + 1);
  const tx = fc - c0;
  const ty = fr - r0;
  const z00 = grid[r0][c0], z10 = grid[r0][c1];
  const z01 = grid[r1][c0], z11 = grid[r1][c1];
  const z0 = z00 * (1 - tx) + z10 * tx;
  const z1 = z01 * (1 - tx) + z11 * tx;
  return z0 * (1 - ty) + z1 * ty;
}


/**
 * Construit un PlaneGeometry subdivise (gridN-1 segments) reprojete
 * en 3D selon le MNT, avec UVs etalees [0..1]^2 pour textures.
 * yRef : soustrait pour rendre la grille en local au splat (mntMin typique).
 */
export function buildTerrainGeometry(mntInfo, yRef = null) {
  const { grid, sideM, gridN, mntMin } = mntInfo;
  const yr = (yRef === null) ? mntMin : yRef;
  const segs = gridN - 1;
  const geom = new THREE.PlaneGeometry(sideM, sideM, segs, segs);
  // PlaneGeometry est dans XY (normale Z+), centre. On rotate -PI/2 sur X
  // pour avoir XZ (normale Y+, sol). Apres rotateX, l'axe Y de la plane
  // (qui etait haut->bas en XY) devient axe -Z (sud->nord -> nord->sud).
  geom.rotateX(-Math.PI / 2);
  const positions = geom.attributes.position;
  // Apres rotateX(-PI/2):
  // - vertex (i, j) dans la grille de PlaneGeometry est aligne :
  //   - x = (j/segs - 0.5) * sideM   (col)
  //   - z = (i/segs - 0.5) * sideM   (row, mais quel sens?)
  // PlaneGeometry construit ses vertices ligne par ligne, avec Y descendant.
  // Apres rotateX(-PI/2), Y descendant devient Z descendant.
  // Donc vertex (row=0, col=*) : y_planar = +half -> apres rotate, z = -half (nord).
  // vertex (row=segs, col=*) : y_planar = -half -> z = +half (sud).
  // Donc grid mapping :
  //   plane_row 0 (haut Y) -> z_world = -half (nord)
  //   plane_row segs       -> z_world = +half (sud)
  // Notre mnt grid : row 0 = sud (z=+half), row gridN-1 = nord (z=-half).
  // Donc plane_row 0 correspond a mnt grid row gridN-1.
  // Inversion : mntRow = (segs - planeRow)
  for (let pr = 0; pr <= segs; pr++) {
    for (let pc = 0; pc <= segs; pc++) {
      const idx = pr * (segs + 1) + pc;
      const mntRow = segs - pr;
      const mntCol = pc;
      const altAbs = grid[mntRow][mntCol];
      positions.setY(idx, altAbs - yr);
    }
  }
  positions.needsUpdate = true;
  geom.computeVertexNormals();
  return geom;
}
