// ═══════════════════════════════════════════════════════════════════════════
// ROOF-MESH — rendu Three.js des pans du noyau toiture
//
// SEUL fichier du dossier qui touche Three.js : le noyau (index.js) reste en
// JS pur, testable en Node. Convention TERLAB : Three.js partagé via
// `window.THREE ?? import(...)` (jamais de double bundle — importmap épinglé
// three@0.182.0 dans index.html).
//
// @coords  Le noyau travaille en plan [x, z] + y = altitude via toWorld() :
//          le monde est DÉJÀ Y-up — aucune rotation supplémentaire.
//          Chaque pan est triangulé dans son repère (u, v) en vraie grandeur
//          (contourUVDebord ?? contourUV), puis remonté par pan.toWorld.
// ═══════════════════════════════════════════════════════════════════════════

import { trianguler, aire2 } from './triangulate.js';

const THREE = (typeof window !== 'undefined' ? window.THREE : undefined)
  ?? await import('https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.module.js');

/** Maillage d'un prisme : polygone (x, y) local extrudé de ±ep/2 selon z.
 *  (Porté verbatim du POC — utilitaire général, ici parce qu'il crée une
 *  BufferGeometry, donc hors du noyau pur.) */
export function buildPrism(poly, ep) {
  const h = ep / 2, n = poly.length;
  const tris = trianguler(poly);
  const pos = [], nor = [];
  const pousse = (p, q, r, N) => {
    pos.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
    for (let k = 0; k < 3; k++) nor.push(N[0], N[1], N[2]);
  };
  for (const [i, j, k] of tris) {
    const A = poly[i], B = poly[j], C = poly[k];
    pousse([A[0], A[1], h], [B[0], B[1], h], [C[0], C[1], h], [0, 0, 1]);
    pousse([C[0], C[1], -h], [B[0], B[1], -h], [A[0], A[1], -h], [0, 0, -1]);
  }
  const sens = aire2(poly) >= 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const A = poly[i], B = poly[(i + 1) % n];
    const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy);
    if (L < 1e-9) continue;
    const N = [sens * dy / L, -sens * dx / L, 0];
    pousse([A[0], A[1], -h], [B[0], B[1], -h], [B[0], B[1], h], N);
    pousse([A[0], A[1], -h], [B[0], B[1], h], [A[0], A[1], h], N);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/** Géométrie d'UN pan : triangulation du contour (u, v) remontée en monde. */
function panGeometry(pan) {
  // Contour préféré : le débord s'il existe (c'est lui qui borne l'ouvrage),
  // sinon le contour structurel. On triangule en (u, v) — vraie grandeur, où
  // le découpage en oreilles est bien posé — puis on remonte par toWorld.
  const uv = pan.contourUVDebord
    ?? (pan.contourDebord ? pan.contourDebord.map(pan.toLocal) : pan.contourUV);
  if (!uv || uv.length < 3) return null;
  const tris = trianguler(uv);
  if (!tris.length) return null;

  const world = uv.map(pan.toWorld);
  const n = pan.repere.n;                       // normale sortante du plan du pan
  const pos = [], nor = [];
  for (const [i, j, k] of tris) {
    let A = world[i], B = world[j], C = world[k];
    // Orientation : la normale géométrique du triangle doit suivre la normale
    // sortante du pan (face visible du dessus). trianguler rend du CCW en
    // (u, v), mais le repère (u, v, n) peut être indirect — on constate, on
    // n'affirme pas (même leçon que PRISM dans le POC).
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
    const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    if (gx * n[0] + gy * n[1] + gz * n[2] < 0) { const t = B; B = C; C = t; }
    pos.push(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]);
    for (let q = 0; q < 3; q++) nor.push(n[0], n[1], n[2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/**
 * Construit un THREE.Group nommé `roof` : un mesh par pan du modèle S3
 * (éventuellement passé par appliquerDebords pour porter contourDebord).
 *
 * @param model  modèle de buildModel() (ou copie d'appliquerDebords)
 * @param opts   { material }  matériau partagé (sinon MeshStandardMaterial)
 * @returns THREE.Group — mesh.userData = { panId, kind, pente }
 */
export function buildRoofMesh(model, opts = {}) {
  const group = new THREE.Group();
  group.name = 'roof';
  const material = opts.material ?? new THREE.MeshStandardMaterial({
    color: 0x8a5a44, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide,
  });

  for (const pan of model.pans) {
    // Un pignon / retour vertical n'a pas de nappe de couverture : aire
    // projetée nulle, contour dégénéré — pas de mesh.
    if (pan.kind !== 'pan') continue;
    const g = panGeometry(pan);
    if (!g) continue;
    const mesh = new THREE.Mesh(g, material);
    mesh.name = `pan-${pan.id}`;
    mesh.userData = { panId: pan.id, kind: pan.kind, pente: pan.pente };
    group.add(mesh);
  }
  return group;
}
