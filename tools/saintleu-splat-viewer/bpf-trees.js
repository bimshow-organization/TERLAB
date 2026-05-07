/**
 * TERLAB . bpf-trees.js
 * Port en ES module du systeme low-poly arbres BIMSHOW Plant Factory
 * (c:/GITHUB/bimshow-plant-factory/docs/vegetation_generator.html).
 *
 * 3 niveaux LOD : 0=full (8 segs cylinder + 3 crossed planes leaves)
 *                 1=medium (5 segs + 2 planes)
 *                 2=billboard (1 plane uniquement)
 *
 * Pour le viewer Saint-Leu : on utilise LOD 1 par defaut (~30 tris/arbre,
 * marche bien pour ~200 arbres-heros). LOD 0 reserve a une vue tres rapprochee.
 *
 * Export :
 *   buildHeroTreesGroup({trees, lat, lng, sideM, mntInfo, lookupAltAt, hMin})
 *   -> THREE.Group(trunks InstancedMesh + leaves InstancedMesh)
 */

import * as THREE from 'three';

const TREE_REF_TRUNK_H = 2.8;  // BPF default trunk height
const TREE_REF_TOTAL_H = 2.8 + 4.5;  // trunk + leaves


// ─────────────────────────────────────────────────────────────────────────
// 1. Textures procedurales (port BPF)
// ─────────────────────────────────────────────────────────────────────────

let _texLeafCache = null;
let _texBarkCache = null;

export function texTreeLeaf() {
  if (_texLeafCache) return _texLeafCache;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  let s = 42;
  const rng = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < 90; i++) {
    const x = rng() * 256 * 0.82 + 256 * 0.09;
    const y = rng() * 256 * 0.82 + 256 * 0.09;
    const r = rng() * 16 + 5;
    const g = Math.round(rng() * 55 + 65);
    ctx.fillStyle = `rgba(28,${g},16,${rng() * 0.35 + 0.5})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  _texLeafCache = tex;
  return tex;
}

export function texBark() {
  if (_texBarkCache) return _texBarkCache;
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2e1a0c'; ctx.fillRect(0, 0, 128, 256);
  let s = 77;
  const rng = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < 22; i++) {
    const x = rng() * 128;
    const v = Math.round(rng() * 28 + 18);
    ctx.strokeStyle = `rgba(${v + 35},${v + 12},${v},${rng() * 0.5 + 0.2})`;
    ctx.lineWidth = rng() * 2.5 + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + rng() * 8 - 4, 256 * .33,
                      x + rng() * 8 - 4, 256 * .67,
                      x + rng() * 6 - 3, 256);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  _texBarkCache = tex;
  return tex;
}


// ─────────────────────────────────────────────────────────────────────────
// 2. Geometrie low-poly (port BPF)
// ─────────────────────────────────────────────────────────────────────────

export function buildCrossedPlanes(numPlanes, bladeW, bladeH) {
  const geom = new THREE.BufferGeometry();
  const vCount = numPlanes * 4;
  const iCount = numPlanes * 6;
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const uvs = new Float32Array(vCount * 2);
  const idx = new Uint16Array(iCount);
  const hw = bladeW / 2;

  for (let p = 0; p < numPlanes; p++) {
    const angle = (p / numPlanes) * Math.PI;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const vb = p * 4;
    const ib = p * 6;
    pos.set([-hw * c, 0,      -hw * s], (vb + 0) * 3);
    pos.set([ hw * c, 0,       hw * s], (vb + 1) * 3);
    pos.set([ hw * c, bladeH,  hw * s], (vb + 2) * 3);
    pos.set([-hw * c, bladeH, -hw * s], (vb + 3) * 3);
    for (let v = 0; v < 4; v++) {
      nrm.set([-s, 0, c], (vb + v) * 3);
    }
    uvs.set([0, 0,  1, 0,  1, 1,  0, 1], vb * 2);
    idx.set([vb, vb + 1, vb + 2,  vb, vb + 2, vb + 3], ib);
  }
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('normal',   new THREE.BufferAttribute(nrm, 3));
  geom.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(new THREE.BufferAttribute(idx, 1));
  geom.computeBoundingBox();
  return geom;
}

export function buildTreeGeometry(lodLevel = 1) {
  const segs = [8, 5, 3][lodLevel];
  const trunkGeom = new THREE.CylinderGeometry(0.07, 0.20, TREE_REF_TRUNK_H, segs, 1);
  trunkGeom.translate(0, TREE_REF_TRUNK_H / 2, 0);  // pivot a y=0
  const leafPlanes = [3, 2, 1][lodLevel];
  const leafGeom = buildCrossedPlanes(leafPlanes, 4.0, 4.5);
  leafGeom.translate(0, TREE_REF_TRUNK_H, 0);
  return { trunkGeom, leafGeom };
}


// ─────────────────────────────────────────────────────────────────────────
// 3. Groupe d'arbres-heros (InstancedMesh perf-friendly)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Construit 2 InstancedMesh (trunks + leaves) pour les "arbres-heros"
 * (h >= hMin) dans la zone visible. Position depuis lookupAltAt(MNT IGN),
 * scale uniforme h / treeRefH (l'arbre de reference fait ~7.3m).
 *
 * @param {Object} args
 * @param {Array}  args.trees    lidarTrees.trees (array)
 * @param {Number} args.lat      latitude centre zone
 * @param {Number} args.lng      longitude centre zone
 * @param {Number} args.sideM    cote zone metres
 * @param {Object} args.mntInfo  grille MNT IGN (de mnt-grid.js)
 * @param {Function} args.lookupAltAt  helper depuis mnt-grid.js
 * @param {Number} args.hMin     hauteur min arbre-heros (default 10m)
 * @returns {THREE.Group}
 */
export function buildHeroTreesGroup({
  trees, lat, lng, sideM, mntInfo, lookupAltAt, hMin = 10, lodLevel = 1,
}) {
  const m_per_deg_lat = 111320.0;
  const m_per_deg_lng = 103900.0 * Math.cos(lat * Math.PI / 180);
  const half = sideM / 2;

  // Collect heroes in zone
  const heroes = [];
  for (const t of trees) {
    if (t.h < hMin) continue;
    const dx = (t.lng - lng) * m_per_deg_lng;
    const dy = (t.lat - lat) * m_per_deg_lat;
    if (Math.abs(dx) > half || Math.abs(dy) > half) continue;
    heroes.push({ tree: t, dx, dy });
  }
  if (heroes.length === 0) return null;

  const { trunkGeom, leafGeom } = buildTreeGeometry(lodLevel);
  const leafTex = texTreeLeaf();
  const barkTex = texBark();

  const trunkMat = new THREE.MeshLambertMaterial({
    map: barkTex, color: 0xffffff,
    transparent: false, side: THREE.FrontSide,
  });
  const leafMat = new THREE.MeshLambertMaterial({
    map: leafTex, color: 0xffffff,
    transparent: true, alphaTest: 0.4,
    side: THREE.DoubleSide, depthWrite: true,
  });

  const trunks = new THREE.InstancedMesh(trunkGeom, trunkMat, heroes.length);
  const leaves = new THREE.InstancedMesh(leafGeom, leafMat, heroes.length);
  trunks.frustumCulled = false;
  leaves.frustumCulled = false;

  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const mntMin = mntInfo?.mntMin ?? 0;

  let i = 0;
  for (const { tree, dx, dy } of heroes) {
    const altIgn = mntInfo ? lookupAltAt(mntInfo, dx, -dy) : tree.alt;
    const yLocal = Math.max(0, altIgn - mntMin);
    const scale = tree.h / TREE_REF_TOTAL_H;
    pos.set(dx, yLocal, -dy);
    sc.set(scale, scale, scale);
    // Petite rotation aleatoire deterministe par arbre (varier les feuilles)
    const yaw = ((tree.lat * 1e5 + tree.lng * 1e3) % (Math.PI * 2));
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    m.compose(pos, quat, sc);
    trunks.setMatrixAt(i, m);
    leaves.setMatrixAt(i, m);
    i++;
  }
  trunks.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'bpf-hero-trees';
  group.add(trunks);
  group.add(leaves);
  group.userData = { n_trees: heroes.length, hMin, lodLevel };
  return group;
}


export function disposeHeroTreesGroup(group) {
  if (!group) return;
  group.traverse(c => {
    if (c.geometry?.dispose) c.geometry.dispose();
    if (c.material?.dispose) c.material.dispose();
  });
}
