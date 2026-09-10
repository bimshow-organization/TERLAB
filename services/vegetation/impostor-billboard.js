// ═══════════════════════════════════════════════════════════════════════
// TERLAB · services/vegetation/impostor-billboard.js
// Materiau billboard impostor octahedral partage (P05 voisinage, P07 site).
// Atlas webp 2048x1024 : 4 colonnes x 2 lignes, 8 vues a 45 deg
// (fournis par BPF via ImpostorLoader, mappes dans bpf-species-reunion.json).
//
// Shader identique a celui valide dans components/terrain-3d-viewer.js
// (_buildImpostorMaterial) — extrait ici pour reutilisation sans dupliquer.
// L'appelant DOIT rafraichir uniforms.uCameraPos a chaque rendu :
//   updateImpostorCamera(mats, camera)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Construit le ShaderMaterial billboard pour un atlas impostor.
 * @param {object} THREE  namespace Three.js (window.THREE ?? import)
 * @param {THREE.Texture} atlasTex
 */
export function buildImpostorMaterial(THREE, atlasTex) {
  atlasTex.minFilter = THREE.LinearFilter;
  atlasTex.magFilter = THREE.LinearFilter;
  atlasTex.generateMipmaps = false;
  atlasTex.wrapS = atlasTex.wrapT = THREE.ClampToEdgeWrapping;

  return new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: atlasTex },
      uCameraPos: { value: new THREE.Vector3() },
      uAlphaTest: { value: 0.3 },
    },
    vertexShader: `
      uniform vec3 uCameraPos;
      varying vec2 vUv;

      void main() {
        // Position d'instance (origine billboard en 0,0,0 local avant scale)
        vec4 instOrigin = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 worldPos = (modelMatrix * instOrigin).xyz;

        // Azimut camera -> slot atlas (8 vues)
        vec2 toCam = uCameraPos.xz - worldPos.xz;
        float angle = atan(toCam.x, toCam.y);
        float slot = mod(floor((angle / 6.2831853) * 8.0 + 8.5), 8.0);
        float col = mod(slot, 4.0);
        float row = floor(slot / 4.0);

        // Atlas 4 colonnes x 2 lignes, row 0 en haut (V=0.5..1.0)
        vUv = vec2((uv.x + col) / 4.0, (uv.y + 1.0 - row) / 2.0);

        // Billboard : right = cross(up, toCam), up = (0,1,0)
        vec3 toCam3 = normalize(uCameraPos - worldPos);
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam3));

        // Extraire scale de instanceMatrix
        float sW = length(vec3(instanceMatrix[0].x, instanceMatrix[0].y, instanceMatrix[0].z));
        float sH = length(vec3(instanceMatrix[1].x, instanceMatrix[1].y, instanceMatrix[1].z));

        // position.xy dans [-0.5, 0.5] (PlaneGeometry), apres translate(0,0.5,0) : x in [-0.5,0.5], y in [0,1]
        vec3 displaced = right * position.x * sW + vec3(0.0, 1.0, 0.0) * position.y * sH;

        gl_Position = projectionMatrix * viewMatrix * vec4(worldPos + displaced, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uAtlas;
      uniform float uAlphaTest;
      varying vec2 vUv;

      void main() {
        vec4 c = texture2D(uAtlas, vUv);
        if (c.a < uAlphaTest) discard;
        gl_FragColor = c;
        // Texture SRGB decodee en lineaire par le GPU → re-encodage de sortie
        // obligatoire (sinon silhouettes sombres), + tonemapping si actif
        // (no-op quand renderer.toneMapping = NoToneMapping, cas P05).
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
}

/** Rafraichit l'uniform camera de tous les materiaux impostor (a chaque rendu). */
export function updateImpostorCamera(mats, camera) {
  if (!mats?.length || !camera) return;
  for (const m of mats) m.uniforms?.uCameraPos?.value?.copy(camera.position);
}

/**
 * Variante Z-UP du materiau billboard — pour la scene du MapboxThreeBridge
 * (X = est, Y = nord, Z = altitude). Meme atlas 4x2, meme logique de slot ;
 * seuls changent l'axe vertical (Z) et le plan horizontal (XY).
 * `angle = atan(toCam.x, -toCam.y)` : -Y (sud) joue le role du Z-sud de la
 * variante Y-up — les slots d'atlas restent identiques visuellement.
 * uCameraPos est en COORDONNEES SCENE du bridge (metres locaux) — a calculer
 * cote appelant depuis map.getFreeCameraOptions() (la camera du bridge n'a
 * pas de position, tout vit dans projectionMatrix).
 */
export function buildImpostorMaterialZUp(THREE, atlasTex) {
  atlasTex.minFilter = THREE.LinearFilter;
  atlasTex.magFilter = THREE.LinearFilter;
  atlasTex.generateMipmaps = false;
  atlasTex.wrapS = atlasTex.wrapT = THREE.ClampToEdgeWrapping;

  return new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: atlasTex },
      uCameraPos: { value: new THREE.Vector3() },
      uAlphaTest: { value: 0.3 },
    },
    vertexShader: `
      uniform vec3 uCameraPos;
      varying vec2 vUv;
      varying float vFade;

      void main() {
        vec4 instOrigin = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 worldPos = (modelMatrix * instOrigin).xyz;

        // Azimut camera dans le plan horizontal XY (Z-up)
        vec2 toCam = uCameraPos.xy - worldPos.xy;
        float angle = atan(toCam.x, -toCam.y);
        float slot = mod(floor((angle / 6.2831853) * 8.0 + 8.5), 8.0);
        float col = mod(slot, 4.0);
        float row = floor(slot / 4.0);
        vUv = vec2((uv.x + col) / 4.0, (uv.y + 1.0 - row) / 2.0);

        // Fondu zénithal (l'atlas n'a AUCUNE vue de dessus : 8 vues à 25°
        // d'élévation). Vu du ciel le billboard devient une lame — on le fond
        // entre 45° et ~74° d'élévation caméra, le quad horizontal de canopée
        // prend le relais (valeurs de prod web-app : smoothstep(0.78, 1.3)).
        vec3 toCamRaw = uCameraPos - worldPos;
        float elev = atan(toCamRaw.z, length(toCamRaw.xy));
        vFade = 1.0 - smoothstep(0.78, 1.3, elev);

        // Billboard vertical : up = +Z, right = cross(up, toCam)
        vec3 toCam3 = normalize(toCamRaw);
        vec3 right = normalize(cross(vec3(0.0, 0.0, 1.0), toCam3));

        float sW = length(vec3(instanceMatrix[0].x, instanceMatrix[0].y, instanceMatrix[0].z));
        float sH = length(vec3(instanceMatrix[1].x, instanceMatrix[1].y, instanceMatrix[1].z));

        // PlaneGeometry translate(0, 0.5, 0) : position.y in [0,1] = vertical
        vec3 displaced = right * position.x * sW + vec3(0.0, 0.0, 1.0) * position.y * sH;

        gl_Position = projectionMatrix * viewMatrix * vec4(worldPos + displaced, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uAtlas;
      uniform float uAlphaTest;
      varying vec2 vUv;
      varying float vFade;

      void main() {
        vec4 c = texture2D(uAtlas, vUv);
        float a = c.a * vFade;
        if (a < uAlphaTest) discard;
        gl_FragColor = vec4(c.rgb, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
}
