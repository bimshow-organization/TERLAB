// terlab/services/roof-builder.js
// Generateur de toitures procedurales LOD2 pour batiments TERLAB
// Porte de houseg-speech/render3d/house-mesh-builder.js (vanilla JS, MIT-compat)
// 5 types : flat, shed, gable, hip, pyramid
// API : RoofBuilder.buildRoof(spec) -> THREE.Group avec enfants nommes pour pedagogie

import * as THREE from 'three';

// ─── Constantes ──────────────────────────────────────────────────────────
const DEFAULT_PENTE_PCT = {
  flat:    0.02,
  shed:    0.25,
  gable:   0.35,
  hip:     0.30,
  pyramid: 0.35,
};

const DEFAULT_DEBORD = {
  flat:    0.30,
  shed:    0.40,
  gable:   0.60,
  hip:     0.60,
  pyramid: 0.50,
};

const DEFAULT_COLOR = {
  flat:    0x888880,
  shed:    0xa07060,
  gable:   0x8a4a2a,
  hip:     0x7a4530,
  pyramid: 0x6a4030,
};

// ─── Helpers ─────────────────────────────────────────────────────────────

function _createMaterial(color, roughness = 0.85, metalness = 0.05) {
  return new THREE.MeshStandardMaterial({
    color, roughness, metalness, side: THREE.DoubleSide,
  });
}

/**
 * Cree une face quad (4 sommets) sous forme de 2 triangles BufferGeometry.
 * Conserve un userData pour pedagogie (face nommee, normale moyenne).
 */
function _makeQuadFace(pts4, mat, faceName) {
  const [A, B, C, D] = pts4.map(p => new THREE.Vector3(p[0], p[1], p[2]));
  const geo = new THREE.BufferGeometry();
  const verts = new Float32Array([
    A.x, A.y, A.z,  B.x, B.y, B.z,  C.x, C.y, C.z,
    A.x, A.y, A.z,  C.x, C.y, C.z,  D.x, D.y, D.z,
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = faceName;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Stocke la normale moyenne pour le toggle "exploser la toiture"
  const n = new THREE.Vector3();
  const a = new THREE.Vector3().subVectors(B, A);
  const b = new THREE.Vector3().subVectors(D, A);
  n.crossVectors(a, b).normalize();
  mesh.userData = { roofFace: faceName, normalAvg: n.toArray() };
  return mesh;
}

/**
 * Cree une face triangle (3 sommets).
 */
function _makeTriFace(pts3, mat, faceName) {
  const geo = new THREE.BufferGeometry();
  const verts = new Float32Array(pts3.flat());
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = faceName;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const A = new THREE.Vector3(...pts3[0]);
  const B = new THREE.Vector3(...pts3[1]);
  const C = new THREE.Vector3(...pts3[2]);
  const n = new THREE.Vector3().crossVectors(
    new THREE.Vector3().subVectors(B, A),
    new THREE.Vector3().subVectors(C, A)
  ).normalize();
  mesh.userData = { roofFace: faceName, normalAvg: n.toArray() };
  return mesh;
}

// ─── Generators par type ─────────────────────────────────────────────────

/**
 * Toit plat avec acrotere optionnel.
 * Origine : centre du footprint, baseY = 0 (bas du toit).
 */
function _buildFlat(W, D, debord, baseY, color, opts = {}) {
  const group = new THREE.Group();
  const mat = _createMaterial(color);
  const ep = 0.10;
  const acrotereH = opts.acrotereH ?? 0.30;

  // Dalle
  const slabGeo = new THREE.BoxGeometry(W + debord * 2, ep, D + debord * 2);
  const slab = new THREE.Mesh(slabGeo, mat);
  slab.name = 'slab';
  slab.position.set(0, baseY + ep / 2, 0);
  slab.castShadow = true;
  slab.receiveShadow = true;
  slab.userData = { roofFace: 'slab', normalAvg: [0, 1, 0] };
  group.add(slab);

  // Acrotere (4 cotes)
  if (acrotereH > 0) {
    const matAcr = _createMaterial(0xCCBBAA, 0.85, 0.05);
    const eAcr = 0.10;
    const sides = [
      [0, -(D / 2 + debord), W + debord * 2, eAcr],
      [0,  (D / 2 + debord), W + debord * 2, eAcr],
      [-(W / 2 + debord), 0, eAcr, D + debord * 2],
      [ (W / 2 + debord), 0, eAcr, D + debord * 2],
    ];
    for (let i = 0; i < sides.length; i++) {
      const [ex, ez, ew, ed] = sides[i];
      const g = new THREE.BoxGeometry(ew, acrotereH, ed);
      const m = new THREE.Mesh(g, matAcr);
      m.position.set(ex, baseY + ep + acrotereH / 2, ez);
      m.name = `acrotere_${i}`;
      m.castShadow = true;
      m.userData = { roofFace: 'acrotere', normalAvg: [0, 1, 0] };
      group.add(m);
    }
  }
  return group;
}

/**
 * Toit mono-pente. Le cote "haut" est determine par orientation.
 */
function _buildShed(W, D, debord, pentePct, orientation, baseY, color) {
  const group = new THREE.Group();
  const mat = _createMaterial(color);
  const [span, depth] = orientation === 'NS' ? [D, W] : [W, D];
  const halfSpan = span / 2 + debord;
  const halfDepth = depth / 2 + debord;
  const H = (span + 2 * debord) * pentePct;

  // Quad incline : 2 sommets bas (cote bas) + 2 sommets hauts (cote haut)
  let pts;
  if (orientation === 'NS') {
    pts = [
      [-halfDepth, baseY,         -halfSpan],
      [ halfDepth, baseY,         -halfSpan],
      [ halfDepth, baseY + H,      halfSpan],
      [-halfDepth, baseY + H,      halfSpan],
    ];
  } else {
    pts = [
      [-halfSpan, baseY,         -halfDepth],
      [-halfSpan, baseY,          halfDepth],
      [ halfSpan, baseY + H,      halfDepth],
      [ halfSpan, baseY + H,     -halfDepth],
    ];
  }
  group.add(_makeQuadFace(pts, mat, 'slope_main'));
  return group;
}

/**
 * Toit 2 versants (gable). Le faitage est sur l'axe defini par orientation.
 */
function _buildGable(W, D, debord, pentePct, orientation, baseY, color) {
  const group = new THREE.Group();
  const mat = _createMaterial(color);
  const [span, depth] = orientation === 'NS' ? [D, W] : [W, D];
  const halfSpan = span / 2 + debord;
  const halfDepth = depth / 2 + debord;
  const H = halfSpan * pentePct;

  // 2 versants symetriques + 2 pignons triangulaires
  let slopeL, slopeR, gableA, gableB;
  if (orientation === 'NS') {
    // faitage sur axe N-S (= z), versants regardent vers est/ouest (= +/-x)
    slopeL = [
      [-halfDepth, baseY,      -halfSpan],
      [-halfDepth, baseY,       halfSpan],
      [ 0,         baseY + H,   halfSpan],
      [ 0,         baseY + H,  -halfSpan],
    ];
    slopeR = [
      [ 0,         baseY + H,  -halfSpan],
      [ 0,         baseY + H,   halfSpan],
      [ halfDepth, baseY,       halfSpan],
      [ halfDepth, baseY,      -halfSpan],
    ];
    gableA = [
      [-halfDepth, baseY,     -halfSpan],
      [ halfDepth, baseY,     -halfSpan],
      [ 0,         baseY + H, -halfSpan],
    ];
    gableB = [
      [ halfDepth, baseY,      halfSpan],
      [-halfDepth, baseY,      halfSpan],
      [ 0,         baseY + H,  halfSpan],
    ];
  } else {
    // faitage sur axe E-O (= x), versants regardent vers nord/sud (= +/-z)
    slopeL = [
      [-halfSpan, baseY,     -halfDepth],
      [ halfSpan, baseY,     -halfDepth],
      [ halfSpan, baseY + H,  0],
      [-halfSpan, baseY + H,  0],
    ];
    slopeR = [
      [-halfSpan, baseY + H,  0],
      [ halfSpan, baseY + H,  0],
      [ halfSpan, baseY,      halfDepth],
      [-halfSpan, baseY,      halfDepth],
    ];
    gableA = [
      [-halfSpan, baseY,     -halfDepth],
      [-halfSpan, baseY,      halfDepth],
      [-halfSpan, baseY + H,  0],
    ];
    gableB = [
      [ halfSpan, baseY,      halfDepth],
      [ halfSpan, baseY,     -halfDepth],
      [ halfSpan, baseY + H,  0],
    ];
  }

  group.add(_makeQuadFace(slopeL, mat, 'slope_L'));
  group.add(_makeQuadFace(slopeR, mat, 'slope_R'));
  group.add(_makeTriFace(gableA, mat, 'gable_A'));
  group.add(_makeTriFace(gableB, mat, 'gable_B'));
  return group;
}

/**
 * Toit 4 versants (hip / croupe complete).
 * Faitage centre raccourci dans la direction longue.
 */
function _buildHip(W, D, debord, pentePct, baseY, color) {
  const group = new THREE.Group();
  const mat = _createMaterial(color);
  const isWide = W >= D;
  const span = Math.min(W, D) + 2 * debord;
  const long = Math.max(W, D) + 2 * debord;
  const halfSpan = span / 2;
  const H = halfSpan * pentePct;
  const faitageLen = Math.max(long - span, 0.5);
  const halfFaitage = faitageLen / 2;

  // 4 coins du footprint (avec debord), Y=baseY
  const cornersBase = [
    [-W / 2 - debord, baseY, -D / 2 - debord], // 0 SW
    [ W / 2 + debord, baseY, -D / 2 - debord], // 1 SE
    [ W / 2 + debord, baseY,  D / 2 + debord], // 2 NE
    [-W / 2 - debord, baseY,  D / 2 + debord], // 3 NW
  ];
  // 2 extremites du faitage dans le repere XZ
  const ridgePts = isWide
    ? [[-halfFaitage, baseY + H, 0], [halfFaitage, baseY + H, 0]]
    : [[0, baseY + H, -halfFaitage], [0, baseY + H,  halfFaitage]];

  // Chaque coin associe a une extremite du faitage selon la geometrie
  const ridgeAssign = isWide
    ? [0, 1, 1, 0]   // SW, SE, NE, NW -> ridge ends
    : [0, 0, 1, 1];

  // 4 versants : 2 trapezes (long) + 2 triangles (court)
  const faceNames = ['slope_S', 'slope_E', 'slope_N', 'slope_W'];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const r1 = ridgePts[ridgeAssign[i]];
    const r2 = ridgePts[ridgeAssign[j]];
    if (r1 === r2) {
      // Triangle (les 2 coins partagent la meme extremite de faitage)
      group.add(_makeTriFace([cornersBase[i], cornersBase[j], r1], mat, faceNames[i]));
    } else {
      // Trapeze
      group.add(_makeQuadFace([cornersBase[i], cornersBase[j], r2, r1], mat, faceNames[i]));
    }
  }
  return group;
}

/**
 * Toit pyramidal : 4 triangles convergent au centre.
 */
function _buildPyramid(W, D, debord, pentePct, baseY, color) {
  const group = new THREE.Group();
  const mat = _createMaterial(color);
  const halfDiag = Math.max(W, D) / 2 + debord;
  const H = halfDiag * pentePct;
  const apex = [0, baseY + H, 0];

  const corners = [
    [-W / 2 - debord, baseY, -D / 2 - debord],
    [ W / 2 + debord, baseY, -D / 2 - debord],
    [ W / 2 + debord, baseY,  D / 2 + debord],
    [-W / 2 - debord, baseY,  D / 2 + debord],
  ];
  const faceNames = ['slope_S', 'slope_E', 'slope_N', 'slope_W'];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    group.add(_makeTriFace([corners[i], corners[j], apex], mat, faceNames[i]));
  }
  return group;
}

// ─── API publique ────────────────────────────────────────────────────────

const RoofBuilder = {

  /**
   * Construit un toit a partir d'une RoofSpec.
   * @param {Object} spec
   * @param {string} spec.type - 'flat'|'shed'|'gable'|'hip'|'pyramid'
   * @param {number} spec.W - largeur footprint (m)
   * @param {number} spec.D - profondeur footprint (m)
   * @param {number} [spec.pentePct] - pente (defaut selon type)
   * @param {number} [spec.debord] - debord (defaut selon type)
   * @param {string} [spec.orientation] - 'EO' (defaut) ou 'NS' pour shed/gable
   * @param {number} [spec.baseY] - hauteur de la sabliere (defaut 0)
   * @param {number} [spec.color] - couleur hex (defaut selon type)
   * @returns {THREE.Group} Group contenant les faces nommees + userData
   */
  buildRoof(spec) {
    const type = spec.type ?? 'flat';
    const W = spec.W ?? 10;
    const D = spec.D ?? 8;
    const pentePct = spec.pentePct ?? DEFAULT_PENTE_PCT[type] ?? 0.30;
    const debord = spec.debord ?? DEFAULT_DEBORD[type] ?? 0.50;
    const orientation = spec.orientation ?? 'EO';
    const baseY = spec.baseY ?? 0;
    const color = spec.color ?? DEFAULT_COLOR[type] ?? 0x8a4a2a;

    let group;
    switch (type) {
      case 'flat':
        group = _buildFlat(W, D, debord, baseY, color, { acrotereH: spec.acrotereH });
        break;
      case 'shed':
        group = _buildShed(W, D, debord, pentePct, orientation, baseY, color);
        break;
      case 'gable':
        group = _buildGable(W, D, debord, pentePct, orientation, baseY, color);
        break;
      case 'hip':
        group = _buildHip(W, D, debord, pentePct, baseY, color);
        break;
      case 'pyramid':
        group = _buildPyramid(W, D, debord, pentePct, baseY, color);
        break;
      default:
        console.warn('[RoofBuilder] type inconnu:', type, '- fallback flat');
        group = _buildFlat(W, D, debord, baseY, color);
    }

    group.name = `roof_${type}`;
    group.userData = { roofType: type, W, D, pentePct, debord, orientation, baseY };
    return group;
  },

  /**
   * Toggle "exploser la toiture" : translate chaque face le long de sa normale.
   * @param {THREE.Group} roofGroup
   * @param {number} amount - 0 = position normale, 1 = explose
   */
  setExplode(roofGroup, amount) {
    const k = Math.max(0, Math.min(1, amount));
    roofGroup.traverse(o => {
      if (o.isMesh && o.userData?.normalAvg) {
        const n = o.userData.normalAvg;
        const dist = (o.userData.explodeDist ?? 1.5) * k;
        if (!o.userData.basePos) {
          o.userData.basePos = o.position.toArray();
        }
        const [bx, by, bz] = o.userData.basePos;
        o.position.set(bx + n[0] * dist, by + n[1] * dist, bz + n[2] * dist);
      }
    });
  },

  /**
   * Liste les types de toiture disponibles avec leurs labels.
   */
  listTypes() {
    return [
      { key: 'flat',    label: 'Toit plat' },
      { key: 'shed',    label: 'Mono-pente' },
      { key: 'gable',   label: 'Deux pans' },
      { key: 'hip',     label: 'Quatre pans' },
      { key: 'pyramid', label: 'Pyramidal' },
    ];
  },
};

export default RoofBuilder;
