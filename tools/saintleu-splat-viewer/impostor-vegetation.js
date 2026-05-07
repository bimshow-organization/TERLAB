/**
 * TERLAB . impostor-vegetation.js
 * Octahedral 8-view billboard impostors pour vegetation procedural.
 * Port ES module du systeme web-app/BIMSHOW
 * (src/app/threejs/vegetation-impostor-material.ts).
 *
 * Y-up world (notre viewer Saint-Leu utilise y=altitude depuis lidar_to_splat).
 * Atlas WebP 2048x1024 = 4 cols x 2 rows x 8 slots, vues azimut 0-315.
 *
 * Espèces dispo : palm_coconut, mango, flamboyant.
 */

import * as THREE from 'three';

export const ATLAS_CATALOG = [
  { id: 'palm_coconut', label: 'Cocotier',  side: 'assets/impostors/impostor_palm_coconut.webp', top: 'assets/impostors/top/palm_coconut.webp' },
  { id: 'mango',        label: 'Manguier',  side: 'assets/impostors/impostor_mango.webp',        top: 'assets/impostors/top/mango.webp' },
  { id: 'flamboyant',   label: 'Flamboyant',side: 'assets/impostors/impostor_flamboyant.webp',   top: 'assets/impostors/top/flamboyant.webp' },
];

const OCTA_VERTEX = /* glsl */ `
  uniform float uNumViews;
  uniform float uAtlasCols;
  uniform float uAtlasRows;
  varying vec2 vUv;
  varying float vDepthOffset;
  varying float vZenithFade;
  const float TWO_PI = 6.28318530718;

  int selectSlot(vec3 toCamera) {
    float azimuth = atan(toCamera.z, toCamera.x);
    if (azimuth < 0.0) azimuth += TWO_PI;
    float slotF = azimuth / TWO_PI * uNumViews;
    return int(mod(floor(slotF + 0.5), uNumViews));
  }
  vec2 atlasUV(int slot, vec2 localUV) {
    float col = float(slot) - floor(float(slot) / uAtlasCols) * uAtlasCols;
    float row = floor(float(slot) / uAtlasCols);
    return vec2((col + localUV.x) / uAtlasCols, (row + localUV.y) / uAtlasRows);
  }
  void main() {
    vec4 worldPos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float scaleX = length(instanceMatrix[0].xyz);
    float scaleY = length(instanceMatrix[1].xyz);
    vec3 toCamera = cameraPosition - worldPos.xyz;
    int slot = selectSlot(toCamera);
    vUv = atlasUV(slot, uv);
    vDepthOffset = float(slot) / uNumViews;
    float horizLen = length(toCamera.xz);
    float elev = atan(abs(toCamera.y), max(horizLen, 0.0001));
    vZenithFade = 1.0 - smoothstep(0.78, 1.3, elev);
    vec2 toCam2D = normalize(toCamera.xz);
    vec2 right2D = vec2(-toCam2D.y, toCam2D.x);
    vec3 localPos = position;
    vec3 bPos = worldPos.xyz
      + vec3(right2D.x, 0.0, right2D.y) * localPos.x * scaleX
      + vec3(0.0, 1.0, 0.0)             * localPos.y * scaleY;
    gl_Position = projectionMatrix * viewMatrix * vec4(bPos, 1.0);
  }
`;

const OCTA_FRAGMENT = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uAlphaTest;
  uniform float uAtlasCols;
  uniform float uAtlasRows;
  uniform float uParallaxScale;
  varying vec2 vUv;
  varying float vDepthOffset;
  varying float vZenithFade;

  vec2 parallaxUV(vec2 uv, float depthOff) {
    if (uParallaxScale < 0.001) return uv;
    float parallax = sin(depthOff * 3.14159) * uParallaxScale;
    return uv + vec2(parallax * 0.5, 0.0);
  }
  void main() {
    vec2 correctedUV = parallaxUV(vUv, vDepthOffset);
    float slotW = 1.0 / uAtlasCols;
    float slotH = 1.0 / uAtlasRows;
    float colIdx = floor(vUv.x / slotW);
    float rowIdx = floor(vUv.y / slotH);
    vec2 slotMin = vec2(colIdx * slotW + 0.001, rowIdx * slotH + 0.001);
    vec2 slotMax = vec2(slotMin.x + slotW - 0.002, slotMin.y + slotH - 0.002);
    correctedUV = clamp(correctedUV, slotMin, slotMax);
    vec4 texel = texture2D(uAtlas, correctedUV);
    float finalAlpha = texel.a * vZenithFade;
    if (finalAlpha < uAlphaTest) discard;
    gl_FragColor = vec4(pow(texel.rgb, vec3(0.95)), finalAlpha);
  }
`;

const TOP_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying float vZenithBlend;
  void main() {
    vec4 worldPos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float scaleX = length(instanceMatrix[0].xyz);
    float scaleY = length(instanceMatrix[1].xyz);
    float scaleZ = length(instanceMatrix[2].xyz);
    vec3 localPos = position;
    vec3 wPos = worldPos.xyz
      + vec3(localPos.x * scaleX, scaleY * 0.95, localPos.y * scaleZ);
    vec3 toCamera = cameraPosition - worldPos.xyz;
    float horizLen = length(toCamera.xz);
    float elev = atan(abs(toCamera.y), max(horizLen, 0.0001));
    vZenithBlend = smoothstep(0.78, 1.3, elev);
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * vec4(wPos, 1.0);
  }
`;

const TOP_FRAGMENT = /* glsl */ `
  uniform sampler2D uTopTex;
  uniform float uAlphaTest;
  varying vec2 vUv;
  varying float vZenithBlend;
  void main() {
    if (vZenithBlend < 0.001) discard;
    vec4 texel = texture2D(uTopTex, vUv);
    float finalAlpha = texel.a * vZenithBlend;
    if (finalAlpha < uAlphaTest) discard;
    gl_FragColor = vec4(pow(texel.rgb, vec3(0.95)), finalAlpha);
  }
`;

const _loader = new THREE.TextureLoader();

async function loadTexture(url) {
  return new Promise((resolve, reject) => {
    _loader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      resolve(tex);
    }, undefined, reject);
  });
}

export async function loadImpostorAtlas(speciesId) {
  const a = ATLAS_CATALOG.find(x => x.id === speciesId);
  if (!a) throw new Error(`Unknown species: ${speciesId}`);
  const [side, top] = await Promise.all([loadTexture(a.side), loadTexture(a.top)]);
  return { id: a.id, label: a.label, side, top };
}

export function makeOctahedralMaterial(atlas, opts = {}) {
  const { alphaTest = 0.4, parallaxScale = 0.015 } = opts;
  return new THREE.ShaderMaterial({
    vertexShader: OCTA_VERTEX,
    fragmentShader: OCTA_FRAGMENT,
    uniforms: {
      uAtlas:         { value: atlas.side },
      uAlphaTest:     { value: alphaTest },
      uNumViews:      { value: 8 },
      uAtlasCols:     { value: 4 },
      uAtlasRows:     { value: 2 },
      uParallaxScale: { value: parallaxScale },
    },
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
}

export function makeTopMaterial(atlas, opts = {}) {
  const { alphaTest = 0.3 } = opts;
  return new THREE.ShaderMaterial({
    vertexShader: TOP_VERTEX,
    fragmentShader: TOP_FRAGMENT,
    uniforms: {
      uTopTex:    { value: atlas.top },
      uAlphaTest: { value: alphaTest },
    },
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
}

/**
 * Construit 2 InstancedMesh (side + top) pour une foret procedurale.
 * @param atlas resultat de loadImpostorAtlas
 * @param positions Array<[x,y,z,scale]> positions monde + echelle (m)
 * @returns {sideMesh, topMesh}
 */
export function buildForestInstanced(atlas, positions) {
  const sideGeom = new THREE.PlaneGeometry(1, 1, 1, 1);
  sideGeom.translate(0, 0.5, 0); // pivot at bottom for side billboard
  const topGeom = new THREE.PlaneGeometry(1, 1, 1, 1);
  topGeom.rotateX(-Math.PI / 2);

  const sideMat = makeOctahedralMaterial(atlas);
  const topMat = makeTopMaterial(atlas);
  const n = positions.length;

  const sideMesh = new THREE.InstancedMesh(sideGeom, sideMat, n);
  const topMesh = new THREE.InstancedMesh(topGeom, topMat, n);
  sideMesh.frustumCulled = false;
  topMesh.frustumCulled = false;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const [x, y, z, sc] = positions[i];
    p.set(x, y, z);
    s.set(sc, sc, sc);
    m.compose(p, q, s);
    sideMesh.setMatrixAt(i, m);
    topMesh.setMatrixAt(i, m);
  }
  sideMesh.instanceMatrix.needsUpdate = true;
  topMesh.instanceMatrix.needsUpdate = true;
  return { sideMesh, topMesh };
}

/**
 * Generateur procedural deterministe : pour une bbox + densite + seed,
 * produit N positions [x, y, z, scale] aleatoires uniformes.
 */
export function generateForestPositions({
  bbox,           // {x_min, x_max, z_min, z_max} (Y-up : x/z = horizontal)
  yGround,        // y altitude du sol (peut etre fonction (x, z) -> y)
  densityPerHa,   // arbres / hectare
  hMean,          // hauteur moyenne arbre (m)
  hVar = 0.3,     // variance hauteur (ratio)
  seed = 1,
}) {
  const widthM = bbox.x_max - bbox.x_min;
  const depthM = bbox.z_max - bbox.z_min;
  const areaHa = (widthM * depthM) / 10000;
  const n = Math.max(1, Math.round(densityPerHa * areaHa));

  let s = seed;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

  const positions = [];
  for (let i = 0; i < n; i++) {
    const x = bbox.x_min + rand() * widthM;
    const z = bbox.z_min + rand() * depthM;
    const y = (typeof yGround === 'function') ? yGround(x, z) : yGround;
    const sc = hMean * (1 - hVar + 2 * hVar * rand());
    positions.push([x, y, z, sc]);
  }
  return positions;
}
