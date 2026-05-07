/**
 * TERLAB . vehicles-3d.js
 * Rendu vehicules detectes par YOLOv8-OBB (DOTAv1) sur ortho IGN HD.
 * Pre-process Python : sota/extract_ortho_vehicles.py
 * Sortie : sota/procedural/vehicles_{slug}.json
 *
 * Rendu V1 : BoxGeometry per vehicule, MeshLambertMaterial color sample
 * ortho. Position via lat/lng -> local + lookup MNT alt. Rotation Y selon
 * heading_deg.
 *
 * V2 (futur) : swap BoxGeometry -> glTF leger via setVehicleAssets({
 *   small: {url, scale, yawOffset}, large: {...}
 * }) sans changer signature.
 */

import * as THREE from 'three';

// Dimensions par defaut si la detection est aberrante (filtree).
const VEHICLE_DIMS = {
  'small-vehicle': { length: 4.5, width: 1.8, height: 1.5 },
  'large-vehicle': { length: 8.0, width: 2.5, height: 2.8 },
};


export async function loadVehiclesData(slug) {
  try {
    const r = await fetch(`../../sota/procedural/vehicles_${slug}.json`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}


/**
 * Build group de vehicules pour 1 zone.
 *
 * @param {Object} args
 * @param {Array}  args.vehicles    data.vehicles (depuis loadVehiclesData)
 * @param {Number} args.lat         centre zone
 * @param {Number} args.lng
 * @param {Number} args.sideM
 * @param {Object} args.mntInfo
 * @param {Function} args.lookupAltAt
 * @returns {THREE.Group}
 */
export function buildVehiclesGroup({
  vehicles, lat, lng, sideM, mntInfo, lookupAltAt,
}) {
  if (!vehicles || vehicles.length === 0) return null;
  const m_per_deg_lat = 111320.0;
  const m_per_deg_lng = 103900.0 * Math.cos(lat * Math.PI / 180);
  const half = sideM / 2;
  const mntMin = mntInfo?.mntMin ?? 0;

  const group = new THREE.Group();
  group.name = 'vehicles';
  let nSmall = 0, nLarge = 0;

  for (const v of vehicles) {
    const dx = (v.lng - lng) * m_per_deg_lng;
    const dy = (v.lat - lat) * m_per_deg_lat;
    if (Math.abs(dx) > half || Math.abs(dy) > half) continue;

    const def = VEHICLE_DIMS[v.type] || VEHICLE_DIMS['small-vehicle'];
    // Trust detected dims si plausibles, sinon fallback table
    const length = (v.length_m > 2 && v.length_m < 16) ? v.length_m : def.length;
    const width  = (v.width_m  > 1 && v.width_m  < 4)  ? v.width_m  : def.width;
    const height = def.height;

    const altIgn = mntInfo ? lookupAltAt(mntInfo, dx, -dy) : 0;
    // Box pivot au centre par defaut -> +height/2 pour poser les pneus au sol
    const yLocal = Math.max(0, altIgn - mntMin) + height / 2;

    const geom = new THREE.BoxGeometry(length, height, width);
    const mat = new THREE.MeshLambertMaterial({
      color: v.color_hex || '#888888',
      side: THREE.FrontSide,
      transparent: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(dx, yLocal, -dy);
    // heading_deg = compass (0=nord, 90=est) ; Three.js Y rotation positive = CCW vu d'en haut
    // Y-up scene : rotation Y depuis "voiture pointant +X (est)" pour aller compass=heading
    //   compass 0 (nord) -> rotation Y = +PI/2  (de +X vers -Z)
    //   compass 90 (est) -> rotation Y = 0
    //   formule : rotY = (90 - heading) * PI / 180
    mesh.rotation.y = (90 - v.heading_deg) * Math.PI / 180;
    group.add(mesh);
    if (v.type === 'large-vehicle') nLarge++;
    else nSmall++;
  }

  group.userData = { n_vehicles: nSmall + nLarge, n_small: nSmall, n_large: nLarge };
  return group;
}


export function disposeVehiclesGroup(group) {
  if (!group) return;
  group.traverse(c => {
    c.geometry?.dispose?.();
    c.material?.dispose?.();
  });
}
