/**
 * TERLAB . trees-v2-splat.js
 * V2 arbres : enveloppe ellipsoid PCA-fit depuis points splat cls 5
 * + couleur RGB sample ortho HD a la cime. Pre-compute Python dans
 * sota/procedural/lidar_trees_v2_{slug}.json.
 *
 * Rendu : 1 mesh sphere unitaire transforme par scale anisotrope (axes_m)
 * + rotation yaw + lumiere ambiante/directionnelle. Couleur per-instance
 * via attribute ou multi-material (on prend ici 1 mesh par arbre, simple
 * et flexible — ~150 arbres/zone -> OK perf).
 */

import * as THREE from 'three';

// Geometrie de base : 1 sphere unitaire (radius=1) avec subdivision
// faible pour low-poly. Reuse par tous les arbres de la zone.
let _sharedSphereGeom = null;
function getSphereGeom() {
  if (_sharedSphereGeom) return _sharedSphereGeom;
  _sharedSphereGeom = new THREE.SphereGeometry(1.0, 8, 6);
  return _sharedSphereGeom;
}

// Tronc : cylindre court tronc-rugueux (a peine visible sur les arbres
// dans Saint-Leu, mais donne un peu de masse au pied).
let _sharedTrunkGeom = null;
function getTrunkGeom() {
  if (_sharedTrunkGeom) return _sharedTrunkGeom;
  _sharedTrunkGeom = new THREE.CylinderGeometry(0.15, 0.25, 1.0, 6, 1);
  _sharedTrunkGeom.translate(0, 0.5, 0);
  return _sharedTrunkGeom;
}


/**
 * Charge le JSON v2 pour une zone (par slug). Retourne {n_trees, trees}
 * ou null si non disponible.
 */
export async function loadTreesV2(slug) {
  try {
    const r = await fetch(`../../sota/procedural/lidar_trees_v2_${slug}.json`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}


/**
 * Construit un Group(canopies + trunks) pour 1 zone, depuis le data v2.
 *
 * @param {Object} args
 * @param {Array}  args.trees       data v2.trees (depuis loadTreesV2)
 * @param {Number} args.lat         centre zone
 * @param {Number} args.lng
 * @param {Number} args.sideM
 * @param {Object} args.mntInfo     grille MNT IGN (depuis mnt-grid)
 * @param {Function} args.lookupAltAt
 * @param {Number} args.hMin        filtre h minimum (default 5m)
 * @returns {THREE.Group}
 */
export function buildTreesV2Group({
  trees, lat, lng, sideM, mntInfo, lookupAltAt, hMin = 5,
}) {
  if (!trees || trees.length === 0) return null;
  const m_per_deg_lat = 111320.0;
  const m_per_deg_lng = 103900.0 * Math.cos(lat * Math.PI / 180);
  const half = sideM / 2;
  const mntMin = mntInfo?.mntMin ?? 0;

  const group = new THREE.Group();
  group.name = 'trees-v2-splat';

  // Trunks couleur unique (cylindre brun-marron pour tous les arbres)
  const trunkMat = new THREE.MeshLambertMaterial({
    color: 0x4a3520,
    transparent: false,
    side: THREE.FrontSide,
  });

  const sphereGeom = getSphereGeom();
  const trunkGeom = getTrunkGeom();
  let n = 0;

  for (const t of trees) {
    if (t.h < hMin) continue;
    const dx = (t.lng - lng) * m_per_deg_lng;
    const dy = (t.lat - lat) * m_per_deg_lat;
    if (Math.abs(dx) > half || Math.abs(dy) > half) continue;
    if (!t.axes_m || t.axes_m.length !== 3) continue;

    const altIgn = mntInfo ? lookupAltAt(mntInfo, dx, -dy) : t.alt;
    const yLocal = Math.max(0, altIgn - mntMin);

    // Demi-axes ellipsoid (rx, ry, rz). On les remappe :
    //   axes_m[0] = principal direction horizontale (yaw)
    //   axes_m[1] = perpendiculaire horizontal
    //   axes_m[2] = vertical
    // PCA returns 3 axes orthos en monde (x,y,z) avec x=est,y=nord,z=up.
    // Pour Three.js Y-up, mappage : (eigvec_xy_principal, eigvec_xy_perp, eigvec_z) ->
    // mais on simplifie : scale ellipsoid vers les 3 axes orthonormaux apres
    // rotation yaw autour de Y. Pour avoir vertical correct, on place axes_m[2]
    // sur Y, et rx/ry sur XZ avec rotation yaw.
    const [rx, ry, rz] = t.axes_m;
    const trunkH = t.h * 0.30;  // tronc 30% de la hauteur visible
    const canopyCenterY = yLocal + trunkH + rz;  // base canopy = yLocal + trunkH

    // Ellipsoid canopy
    const canopyMat = new THREE.MeshLambertMaterial({
      color: t.color_hex || '#3F7A4D',
      transparent: false,
      side: THREE.FrontSide,
    });
    const canopy = new THREE.Mesh(sphereGeom, canopyMat);
    canopy.position.set(dx, canopyCenterY, -dy);
    // Scale anisotrope : ellipsoid principal axe X, perpendiculaire Z, vertical Y
    canopy.scale.set(rx, rz, ry);
    canopy.rotation.y = -t.yaw_deg * Math.PI / 180;
    group.add(canopy);

    // Trunk visible
    const trunk = new THREE.Mesh(trunkGeom, trunkMat);
    trunk.position.set(dx, yLocal, -dy);
    trunk.scale.set(1, trunkH, 1);
    group.add(trunk);

    n++;
  }

  group.userData = { n_trees: n };
  return group;
}


export function disposeTreesV2Group(group) {
  if (!group) return;
  group.traverse(c => {
    // ne pas dispose la geometry partagee (sphere/trunk),
    // mais bien les materials (1 par arbre pour la couleur)
    if (c.material?.dispose) c.material.dispose();
  });
}
