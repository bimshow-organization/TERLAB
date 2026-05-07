/**
 * TERLAB . trees-v3-mesh.js
 * V3 arbres : mesh ConvexHull 3D des points splat cls 5 par arbre,
 * avec couleur per-vertex sample ortho HD. Pre-compute Python dans
 * sota/procedural/lidar_trees_v3_mesh_{slug}.json.
 *
 * Avantages vs V2 ellipsoid :
 *   - silhouette fidele a la couronne (pas une sphere scalee)
 *   - couleur per-vertex -> variations naturelles
 *   - ombrage Lambert sur silhouette vraie
 *
 * Rendu : 1 BufferGeometry per arbre avec vertex colors + Lambert.
 * ~50-100 triangles par arbre, ~250 arbres -> 15-25k tris par zone.
 */

import * as THREE from 'three';


export async function loadTreesV3Mesh(slug) {
  try {
    const r = await fetch(`../../sota/procedural/lidar_trees_v3_mesh_${slug}.json`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}


/**
 * Build group of canopy meshes for 1 zone.
 *
 * @param {Object} args
 * @param {Array}  args.trees       data v3.trees (depuis loadTreesV3Mesh)
 * @param {Number} args.lat         centre zone
 * @param {Number} args.lng
 * @param {Number} args.sideM
 * @param {Object} args.mntInfo     grille MNT IGN
 * @param {Function} args.lookupAltAt
 * @param {Number} args.hMin        filtre h minimum (default 5m)
 * @returns {THREE.Group}
 */
export function buildTreesV3MeshGroup({
  trees, lat, lng, sideM, mntInfo, lookupAltAt, hMin = 5,
}) {
  if (!trees || trees.length === 0) return null;
  const m_per_deg_lat = 111320.0;
  const m_per_deg_lng = 103900.0 * Math.cos(lat * Math.PI / 180);
  const half = sideM / 2;
  const mntMin = mntInfo?.mntMin ?? 0;

  const group = new THREE.Group();
  group.name = 'trees-v3-mesh';
  let n = 0;
  let nTris = 0;

  for (const t of trees) {
    if (t.h < hMin) continue;
    if (!t.vertices || !t.faces || t.vertices.length < 4) continue;
    const dxZone = (t.lng - lng) * m_per_deg_lng;
    const dyZone = (t.lat - lat) * m_per_deg_lat;
    if (Math.abs(dxZone) > half || Math.abs(dyZone) > half) continue;

    const altIgn = mntInfo ? lookupAltAt(mntInfo, dxZone, -dyZone) : t.alt;
    // Centre de la cime en monde local Y-up :
    //   x = dxZone, y = (altIgn - mntMin) + h*0.55, z = -dyZone
    // Vertices V3 sont en local relatif au centre cime : (dx_local, dy_local, dz_local)
    //   ou dx_local = east relatif, dy_local = north relatif, dz_local = vertical relatif a cime_z
    const cimeY = (altIgn - mntMin) + t.h * 0.55;

    const positions = new Float32Array(t.vertices.length * 3);
    const colors    = new Float32Array(t.vertices.length * 3);
    for (let i = 0; i < t.vertices.length; i++) {
      const v = t.vertices[i];
      // Map local Python (east, north, up_relative) -> Three.js Y-up world :
      //   x_world = dxZone + v[0]
      //   y_world = cimeY + v[2]
      //   z_world = -(dyZone + v[1])    (Three.js Z opposite to north)
      positions[i*3]     = dxZone + v[0];
      positions[i*3 + 1] = cimeY + v[2];
      positions[i*3 + 2] = -(dyZone + v[1]);
      const c = new THREE.Color(t.vertex_colors[i] || '#3F7A4D');
      colors[i*3]     = c.r;
      colors[i*3 + 1] = c.g;
      colors[i*3 + 2] = c.b;
    }
    const indices = new Uint32Array(t.faces.length * 3);
    for (let i = 0; i < t.faces.length; i++) {
      const f = t.faces[i];
      indices[i*3]     = f[0];
      indices[i*3 + 1] = f[1];
      indices[i*3 + 2] = f[2];
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));
    geom.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,  // canopee = surface fermee mais ConvexHull peut etre orientation mixte
      flatShading: false,
      transparent: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    group.add(mesh);
    n++;
    nTris += t.faces.length;
  }

  group.userData = { n_trees: n, n_tris: nTris };
  return group;
}


export function disposeTreesV3MeshGroup(group) {
  if (!group) return;
  group.traverse(c => {
    c.geometry?.dispose?.();
    c.material?.dispose?.();
  });
}
