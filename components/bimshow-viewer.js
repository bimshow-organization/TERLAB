// TERLAB · bimshow-viewer.js · Mini-viewer 3D intégré · v1.0
// ════════════════════════════════════════════════════════════════
// Renderer Three.js embarqué — remplace la popup BIMSHOW.
// Modes : 3D · TOP · FACADE (N/E/S/W) · CLIP · SUN (héliodon)
// Prêt à céder la place au vrai BIMSHOW quand les origins s'alignent.
// ════════════════════════════════════════════════════════════════

import * as THREE from 'three';
import { OrbitControls }    from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader }       from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter }     from 'three/addons/exporters/GLTFExporter.js';
import { EffectComposer }   from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }       from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass }  from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }       from 'three/addons/postprocessing/OutputPass.js';

// ── CONSTANTES ──────────────────────────────────────────────────
const DEG  = Math.PI / 180;
const PI   = Math.PI;
const PI2  = Math.PI * 2;

const IVORY   = 0xf5f0e8;
const HORIZON = 0xe8e0d4;
const GROUND  = 0xeae4da;
const GOLD    = 0xf59e0b;
const EDGE_EMISSIVE = new THREE.Color(0xf59e0b).multiplyScalar(0.35);

const BLOOM_STRENGTH  = 0.55;
const BLOOM_RADIUS    = 0.4;
const BLOOM_THRESHOLD = 0.82;

const SHADOW_SIZE = 2048;

const SUN_ARCS = {
  summer:  { day: 172, color: 0xe74c3c, label: '21 juin' },
  equinox: { day: 80,  color: 0x2ecc71, label: '21 mars' },
  winter:  { day: 355, color: 0x3498db, label: '21 déc.' },
};

const FACADE_DIRS = [
  { label: 'Nord', angle: 0 },
  { label: 'Est',  angle: 90 },
  { label: 'Sud',  angle: 180 },
  { label: 'Ouest',angle: 270 },
];

// ════════════════════════════════════════════════════════════════
// VIEWER
// ════════════════════════════════════════════════════════════════

const Terlab3DViewer = {

  // ── STATE ────────────────────────────────────────────────────
  _inited: false,
  _container: null,
  _renderer: null,
  _scene: null,
  _perspCam: null,
  _orthoCam: null,
  _controls: null,
  _composer: null,
  _bloomPass: null,
  _clock: new THREE.Clock(),
  _animId: 0,
  _model: null,
  _modelBox: new THREE.Box3(),
  _modelSize: new THREE.Vector3(),
  _modelCenter: new THREE.Vector3(),

  // mode state
  _mode: '3D',           // '3D' | 'TOP' | 'FACADE'
  _facadeIdx: 0,
  _clipEnabled: false,
  _clipPlane: null,
  _clipHeight: 0.5,      // 0→1 normalized

  // sun / héliodon
  _sunVisible: false,
  _sunGroup: null,
  _sunSphere: null,
  _sunHelper: null,
  _sunArcs: [],
  _sunAnalemmas: [],
  _sunRadius: 20,
  _dirLight: null,
  _ambLight: null,

  // player
  _playing: false,
  _sunProgress: 0.5,     // 0→1  (sunrise → sunset)
  _playerSpeed: 15,      // seconds per full day

  // sun drag
  _draggingSun: false,
  _raycaster: new THREE.Raycaster(),
  _pointer: new THREE.Vector2(),

  // terrain data (from SessionManager)
  _lat: -21.1,
  _lng: 55.5,
  _dayOfYear: 80,        // default: equinox

  // ══════════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════════

  init(containerId = 'terlab-3d-panel') {
    if (this._inited) return;
    this._container = document.getElementById(containerId);
    if (!this._container) return console.warn('[3DViewer] Container not found:', containerId);

    // Read terrain
    const terrain = window.SessionManager?.getTerrain?.() ?? {};
    if (terrain.lat) this._lat = parseFloat(terrain.lat);
    if (terrain.lng) this._lng = parseFloat(terrain.lng);

    this._buildToolbar();
    this._initRenderer();
    this._initScene();
    this._initCameras();
    this._initControls();
    this._initLighting();
    this._initClipping();
    this._initBloom();
    this._initEvents();

    this._inited = true;
    this._animate();
    console.info('[3DViewer] Initialisé');
  },

  dispose() {
    cancelAnimationFrame(this._animId);
    this._renderer?.dispose();
    this._composer?.dispose?.();
    this._inited = false;
  },

  // ══════════════════════════════════════════════════════════════
  // RENDERER
  // ══════════════════════════════════════════════════════════════

  _initRenderer() {
    const canvas = this._container.querySelector('.tv-canvas');
    this._renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.15;
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._renderer.localClippingEnabled = true;
  },

  // ══════════════════════════════════════════════════════════════
  // SCENE — fond ivoire, horizon léger
  // ══════════════════════════════════════════════════════════════

  _initScene() {
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(IVORY);

    // fog doux pour horizon
    this._scene.fog = new THREE.Fog(HORIZON, 60, 200);

    // ground plane
    const groundGeo = new THREE.PlaneGeometry(400, 400);
    const groundMat = new THREE.MeshStandardMaterial({
      color: GROUND,
      roughness: 0.95,
      metalness: 0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this._scene.add(ground);

    // grille fine
    const grid = new THREE.GridHelper(100, 50, 0xd0c8b8, 0xe0d8ca);
    grid.position.y = 0;
    grid.material.transparent = true;
    grid.material.opacity = 0.4;
    grid.name = 'grid';
    this._scene.add(grid);
  },

  // ══════════════════════════════════════════════════════════════
  // CAMERAS
  // ══════════════════════════════════════════════════════════════

  _initCameras() {
    const w = this._container.clientWidth;
    const h = this._container.clientHeight;
    const aspect = w / h;

    // perspective
    this._perspCam = new THREE.PerspectiveCamera(55, aspect, 0.1, 500);
    this._perspCam.position.set(15, 12, 15);
    this._perspCam.lookAt(0, 2, 0);

    // orthographic (will be sized on model load)
    const d = 20;
    this._orthoCam = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 0.1, 500);
    this._orthoCam.position.set(0, 50, 0);
    this._orthoCam.lookAt(0, 0, 0);
  },

  get _camera() {
    return this._mode === '3D' ? this._perspCam : this._orthoCam;
  },

  // ══════════════════════════════════════════════════════════════
  // CONTROLS
  // ══════════════════════════════════════════════════════════════

  _initControls() {
    const canvas = this._renderer.domElement;
    this._controls = new OrbitControls(this._perspCam, canvas);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.08;
    this._controls.screenSpacePanning = true;
    this._controls.target.set(0, 2, 0);
    this._controls.minPolarAngle = 0.01;
    this._controls.maxPolarAngle = PI - 0.01;
    this._controls.update();
  },

  _updateControlsForMode() {
    const c = this._controls;
    if (this._mode === '3D') {
      c.object = this._perspCam;
      c.enableRotate = true;
      c.enablePan = true;
      c.enableZoom = true;
    } else {
      c.object = this._orthoCam;
      c.enableRotate = false;
      c.enablePan = true;
      c.enableZoom = true;
    }
    c.update();
  },

  // ══════════════════════════════════════════════════════════════
  // LIGHTING — directional (sun-synced) + ambient
  // ══════════════════════════════════════════════════════════════

  _initLighting() {
    // ambient
    this._ambLight = new THREE.AmbientLight(0xffffff, 0.45);
    this._scene.add(this._ambLight);

    // hemisphere — ciel/sol subtil
    const hemi = new THREE.HemisphereLight(0xe8e0d4, 0xb8a88a, 0.35);
    this._scene.add(hemi);

    // directional (sun)
    this._dirLight = new THREE.DirectionalLight(0xfff5e6, 2.8);
    this._dirLight.position.set(10, 20, 8);
    this._dirLight.castShadow = true;
    this._dirLight.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
    this._dirLight.shadow.camera.near = 0.5;
    this._dirLight.shadow.camera.far = 150;
    this._dirLight.shadow.camera.left = -30;
    this._dirLight.shadow.camera.right = 30;
    this._dirLight.shadow.camera.top = 30;
    this._dirLight.shadow.camera.bottom = -30;
    this._dirLight.shadow.bias = -0.0003;
    this._dirLight.shadow.normalBias = 0.02;
    this._scene.add(this._dirLight);
    this._scene.add(this._dirLight.target);

    // initial sun position
    this._applySunFromProgress(this._sunProgress);
  },

  // ══════════════════════════════════════════════════════════════
  // CLIPPING — 1 plan horizontal
  // ══════════════════════════════════════════════════════════════

  _initClipping() {
    this._clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
  },

  _setClipHeight(normalized) {
    this._clipHeight = normalized;
    if (!this._model) return;
    const h = this._modelSize.y * normalized + this._modelBox.min.y;
    this._clipPlane.constant = h;
  },

  _toggleClip(force) {
    this._clipEnabled = force !== undefined ? force : !this._clipEnabled;
    this._renderer.clippingPlanes = this._clipEnabled ? [this._clipPlane] : [];
    this._updateToolbarState();
  },

  // ══════════════════════════════════════════════════════════════
  // BLOOM
  // ══════════════════════════════════════════════════════════════

  _initBloom() {
    const canvas = this._renderer.domElement;
    const size = new THREE.Vector2(canvas.clientWidth, canvas.clientHeight);

    this._composer = new EffectComposer(this._renderer);
    this._composer.addPass(new RenderPass(this._scene, this._perspCam));

    this._bloomPass = new UnrealBloomPass(size, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    this._composer.addPass(this._bloomPass);
    this._composer.addPass(new OutputPass());
  },

  _updateComposerCamera() {
    const passes = this._composer.passes;
    if (passes[0]) passes[0].camera = this._camera;
  },

  // ══════════════════════════════════════════════════════════════
  // GLB LOADER
  // ══════════════════════════════════════════════════════════════

  loadGLB(glbBase64) {
    try {
      const binary = atob(glbBase64);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
      this._loadBuffer(bytes.buffer);
    } catch (e) {
      console.error('[3DViewer] GLB decode failed:', e);
    }
  },

  _loadBuffer(buffer) {
    const loader = new GLTFLoader();
    loader.parse(buffer, '', (gltf) => {
      // remove previous
      if (this._model) this._scene.remove(this._model);

      const model = gltf.scene;
      model.name = 'terlab-model';

      // shadows + emissive edge glow
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          // emissive glow on edges for bloom
          if (child.material) {
            const m = child.material.clone();
            m.emissive = EDGE_EMISSIVE;
            m.emissiveIntensity = 0.3;
            m.roughness = Math.max(m.roughness, 0.5);
            m.clippingPlanes = this._clipEnabled ? [this._clipPlane] : [];
            m.clipShadows = true;
            child.material = m;
          }
        }
      });

      // center + measure
      this._modelBox.setFromObject(model);
      this._modelBox.getCenter(this._modelCenter);
      this._modelBox.getSize(this._modelSize);
      model.position.sub(this._modelCenter);
      model.position.y += this._modelSize.y / 2;
      this._modelCenter.set(0, this._modelSize.y / 2, 0);

      this._scene.add(model);
      this._model = model;

      // fit cameras
      this._fitPerspective();
      this._fitOrthoTop();

      // update sun radius
      this._sunRadius = Math.max(this._modelSize.x, this._modelSize.z) * 2.5;
      if (this._sunVisible) this._rebuildHeliodon();

      // clip plane default at mid-height
      this._setClipHeight(0.5);

      // update shadow frustum to model
      const maxDim = Math.max(this._modelSize.x, this._modelSize.y, this._modelSize.z);
      const pad = maxDim * 1.5;
      this._dirLight.shadow.camera.left = -pad;
      this._dirLight.shadow.camera.right = pad;
      this._dirLight.shadow.camera.top = pad;
      this._dirLight.shadow.camera.bottom = -pad;
      this._dirLight.shadow.camera.far = pad * 4;
      this._dirLight.shadow.camera.updateProjectionMatrix();

      console.info(`[3DViewer] Model loaded: ${this._modelSize.x.toFixed(1)}×${this._modelSize.y.toFixed(1)}×${this._modelSize.z.toFixed(1)} m`);
    }, (err) => {
      console.error('[3DViewer] GLB parse error:', err);
    });
  },

  _fitPerspective() {
    const maxDim = Math.max(this._modelSize.x, this._modelSize.y, this._modelSize.z);
    const dist = maxDim * 2;
    this._perspCam.position.set(dist * 0.8, dist * 0.65, dist * 0.8);
    this._controls.target.copy(this._modelCenter);
    this._controls.update();
  },

  _fitOrthoTop() {
    const aspect = this._container.clientWidth / this._container.clientHeight;
    const pad = Math.max(this._modelSize.x, this._modelSize.z) * 0.8;
    this._orthoCam.left = -pad * aspect;
    this._orthoCam.right = pad * aspect;
    this._orthoCam.top = pad;
    this._orthoCam.bottom = -pad;
    this._orthoCam.updateProjectionMatrix();
  },

  // ══════════════════════════════════════════════════════════════
  // MODES — 3D / TOP / FACADE
  // ══════════════════════════════════════════════════════════════

  setMode(mode) {
    this._mode = mode;
    const c = this._modelCenter;

    if (mode === '3D') {
      this._fitPerspective();
      this._scene.fog = new THREE.Fog(HORIZON, 60, 200);
    }
    else if (mode === 'TOP') {
      this._fitOrthoTop();
      const alt = Math.max(this._modelSize.y * 3, 30);
      this._orthoCam.position.set(c.x, alt, c.z);
      this._orthoCam.up.set(0, 0, -1);
      this._orthoCam.lookAt(c.x, 0, c.z);
      this._orthoCam.updateProjectionMatrix();
      this._controls.target.set(c.x, 0, c.z);
      this._scene.fog = null;
    }
    else if (mode === 'FACADE') {
      this._applyFacade(this._facadeIdx);
      this._scene.fog = null;
    }

    this._updateControlsForMode();
    this._updateComposerCamera();
    this._updateToolbarState();
  },

  cycleFacade(delta) {
    this._facadeIdx = (this._facadeIdx + delta + 4) % 4;
    this._applyFacade(this._facadeIdx);
    this._updateToolbarState();
  },

  _applyFacade(idx) {
    const dir = FACADE_DIRS[idx];
    const c = this._modelCenter;
    const dist = Math.max(this._modelSize.x, this._modelSize.z) * 2;
    const rad = dir.angle * DEG;

    const aspect = this._container.clientWidth / this._container.clientHeight;
    const padV = this._modelSize.y * 0.8;
    const padH = Math.max(this._modelSize.x, this._modelSize.z) * 0.8;
    this._orthoCam.left = -padH * aspect;
    this._orthoCam.right = padH * aspect;
    this._orthoCam.top = padV;
    this._orthoCam.bottom = -padV;

    this._orthoCam.position.set(
      c.x + Math.sin(rad) * dist,
      c.y,
      c.z + Math.cos(rad) * dist
    );
    this._orthoCam.up.set(0, 1, 0);
    this._orthoCam.lookAt(c);
    this._orthoCam.updateProjectionMatrix();
    this._controls.target.copy(c);
    this._controls.update();
  },

  // ══════════════════════════════════════════════════════════════
  // HÉLIODON 3D
  // ══════════════════════════════════════════════════════════════

  toggleSun(force) {
    this._sunVisible = force !== undefined ? force : !this._sunVisible;
    if (this._sunVisible) {
      this._rebuildHeliodon();
    } else {
      this._removeHeliodon();
      this._stopPlayer();
    }
    this._updateToolbarState();
  },

  _removeHeliodon() {
    if (this._sunGroup) {
      this._scene.remove(this._sunGroup);
      this._sunGroup = null;
      this._sunSphere = null;
      this._sunHelper = null;
    }
  },

  _rebuildHeliodon() {
    this._removeHeliodon();
    const r = this._sunRadius;
    const group = new THREE.Group();
    group.name = 'heliodon';
    group.renderOrder = 999;
    group.position.copy(this._modelCenter);
    group.position.y = 0;

    // ── Sun sphere ──────────────────────────────────────────
    const sphereGeo = new THREE.SphereGeometry(r * 0.03, 16, 16);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, depthTest: false });
    this._sunSphere = new THREE.Mesh(sphereGeo, sphereMat);
    this._sunSphere.renderOrder = 1000;
    this._sunSphere.name = 'sunSphere';
    group.add(this._sunSphere);

    // ── Sun helper line ─────────────────────────────────────
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0,0,0], 3));
    const lineMat = new THREE.LineBasicMaterial({ color: 0xff8c00, depthTest: false, transparent: true, opacity: 0.6 });
    this._sunHelper = new THREE.Line(lineGeo, lineMat);
    this._sunHelper.renderOrder = 999;
    group.add(this._sunHelper);

    // ── Solstice / equinox arcs ─────────────────────────────
    for (const [key, arc] of Object.entries(SUN_ARCS)) {
      const line = this._buildArc(arc.day, r, arc.color);
      if (line) group.add(line);
    }

    // ── Analemmas (7h → 17h, 11 courbes) ────────────────────
    for (let h = 7; h <= 17; h++) {
      const line = this._buildAnalemma(h, r);
      if (line) group.add(line);
    }

    this._sunGroup = group;
    this._scene.add(group);

    // position initiale
    this._applySunFromProgress(this._sunProgress);
  },

  _buildArc(dayOfYear, radius, color) {
    const verts = [];
    for (let hour = 4; hour <= 20; hour += 0.25) {
      const sun = this._calcSunPos(hour, dayOfYear);
      if (!sun.aboveHorizon) continue;
      const p = this._azElToVec3(sun.azimuth, sun.altitude, radius);
      verts.push(p.x, p.y, p.z);
    }
    if (verts.length < 6) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.LineDashedMaterial({
      color, dashSize: 0.8, gapSize: 0.3,
      depthTest: false, transparent: true, opacity: 0.75,
    });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    line.renderOrder = 999;
    return line;
  },

  _buildAnalemma(hour, radius) {
    const verts = [];
    for (let d = 1; d <= 365; d += 3) {
      const sun = this._calcSunPos(hour, d);
      if (!sun.aboveHorizon) continue;
      const p = this._azElToVec3(sun.azimuth, sun.altitude, radius);
      verts.push(p.x, p.y, p.z);
    }
    if (verts.length < 6) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.LineDashedMaterial({
      color: 0xf5d060, dashSize: 0.4, gapSize: 0.2,
      depthTest: false, transparent: true, opacity: 0.35,
    });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    line.renderOrder = 999;
    return line;
  },

  // ── Solar calculations (réutilise SunCalcService) ─────────
  _calcSunPos(hour, dayOfYear) {
    const svc = window.SunCalcService;
    if (svc) return svc.getPosition(hour, dayOfYear, this._lat);

    // fallback inline
    const latR = this._lat * DEG;
    const decl = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * DEG);
    const declR = decl * DEG;
    const ha = (hour - 12) * 15 * DEG;
    const sinAlt = Math.sin(latR) * Math.sin(declR) + Math.cos(latR) * Math.cos(declR) * Math.cos(ha);
    const altitude = Math.asin(sinAlt) / DEG;
    const cosAzi = (Math.sin(declR) - Math.sin(latR) * sinAlt) / (Math.cos(latR) * Math.cos(Math.max(0, altitude) * DEG));
    let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAzi))) / DEG;
    if (hour > 12) azimuth = 360 - azimuth;
    return { altitude: Math.max(0, altitude), azimuth, aboveHorizon: altitude > 0 };
  },

  _getDaylight(dayOfYear) {
    const svc = window.SunCalcService;
    if (svc) return svc.getDaylight(dayOfYear, this._lat);
    // fallback
    const latR = this._lat * DEG;
    const decl = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * DEG);
    const cos = -Math.tan(latR) * Math.tan(decl * DEG);
    if (cos < -1) return { sunrise: 0, sunset: 24 };
    if (cos > 1) return { sunrise: 12, sunset: 12 };
    const ha = Math.acos(cos) / DEG / 15;
    return { sunrise: 12 - ha, sunset: 12 + ha };
  },

  _azElToVec3(azimuthDeg, elevationDeg, radius) {
    // Y-up convention: azimuth 0=North(+Z), clockwise
    const az = azimuthDeg * DEG;
    const el = elevationDeg * DEG;
    return new THREE.Vector3(
      -Math.sin(az) * Math.cos(el) * radius,
       Math.sin(el) * radius,
       Math.cos(az) * Math.cos(el) * radius,
    );
  },

  // ── Sun position update (progress 0→1 = sunrise→sunset) ──

  _applySunFromProgress(progress) {
    const dl = this._getDaylight(this._dayOfYear);
    const hour = dl.sunrise + (dl.sunset - dl.sunrise) * Math.max(0, Math.min(1, progress));
    const sun = this._calcSunPos(hour, this._dayOfYear);

    // light direction
    const dir = this._azElToVec3(sun.azimuth, sun.altitude, 1).normalize();
    const lightDist = 50;
    this._dirLight.position.set(dir.x * lightDist, dir.y * lightDist, dir.z * lightDist);
    this._dirLight.target.position.copy(this._modelCenter);

    // intensity by elevation
    const elNorm = sun.altitude / 65;
    this._dirLight.intensity = 0.4 + elNorm * 2.8;
    this._dirLight.castShadow = sun.altitude > 3;
    this._ambLight.intensity = 0.3 + elNorm * 0.25;

    // warm color near horizon
    const warmth = 1 - Math.min(1, sun.altitude / 30);
    this._dirLight.color.setRGB(1, 0.96 - warmth * 0.08, 0.9 - warmth * 0.2);

    // sun sphere
    if (this._sunSphere && this._sunGroup) {
      const pos = this._azElToVec3(sun.azimuth, sun.altitude, this._sunRadius);
      this._sunSphere.position.copy(pos);

      // helper line
      const attr = this._sunHelper.geometry.attributes.position;
      attr.setXYZ(0, 0, 0, 0);
      attr.setXYZ(1, pos.x, pos.y, pos.z);
      attr.needsUpdate = true;
    }

    // toolbar label
    const hh = String(Math.floor(hour)).padStart(2, '0');
    const mm = String(Math.floor((hour % 1) * 60)).padStart(2, '0');
    const lbl = this._container?.querySelector('.tv-sun-time');
    if (lbl) lbl.textContent = `${hh}:${mm}`;
  },

  // ── Sun drag ──────────────────────────────────────────────

  _onPointerDown(e) {
    if (!this._sunVisible || !this._sunSphere) return;
    const rect = this._renderer.domElement.getBoundingClientRect();
    this._pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._pointer, this._camera);
    const hits = this._raycaster.intersectObject(this._sunSphere, false);
    if (hits.length > 0) {
      this._draggingSun = true;
      this._controls.enabled = false;
      e.preventDefault();
    }
  },

  _onPointerMove(e) {
    if (!this._draggingSun) return;
    const rect = this._renderer.domElement.getBoundingClientRect();
    this._pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._pointer, this._camera);

    // intersect with celestial sphere
    const origin = this._raycaster.ray.origin;
    const dir = this._raycaster.ray.direction;
    const center = this._sunGroup.position;
    const r = this._sunRadius;

    const oc = origin.clone().sub(center);
    const a = dir.dot(dir);
    const b = 2 * oc.dot(dir);
    const c = oc.dot(oc) - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return;

    const t = (-b - Math.sqrt(disc)) / (2 * a);
    const hitPt = origin.clone().add(dir.clone().multiplyScalar(t)).sub(center);

    // to azimuth / elevation (Y-up)
    const elevation = Math.asin(Math.max(0, hitPt.y / r)) / DEG;
    if (elevation < 1) return; // don't go below horizon

    let azimuth = Math.atan2(-hitPt.x, hitPt.z) / DEG;
    if (azimuth < 0) azimuth += 360;

    // reverse-map to progress
    const dl = this._getDaylight(this._dayOfYear);
    // approximate: find hour that gives this azimuth/elevation
    const sun = { azimuth, altitude: elevation, aboveHorizon: true };
    // update directly
    const pos = this._azElToVec3(azimuth, elevation, this._sunRadius);
    this._sunSphere.position.copy(pos);

    const attr = this._sunHelper.geometry.attributes.position;
    attr.setXYZ(1, pos.x, pos.y, pos.z);
    attr.needsUpdate = true;

    // update light
    const dirV = this._azElToVec3(azimuth, elevation, 1).normalize();
    this._dirLight.position.set(dirV.x * 50, dirV.y * 50, dirV.z * 50);
    this._dirLight.target.position.copy(this._modelCenter);
    const elNorm = elevation / 65;
    this._dirLight.intensity = 0.4 + elNorm * 2.8;
    this._dirLight.castShadow = elevation > 3;

    // update slider progress (approximate)
    // binary search for matching hour
    let bestP = 0.5;
    let bestErr = 999;
    for (let p = 0; p <= 1; p += 0.02) {
      const h = dl.sunrise + (dl.sunset - dl.sunrise) * p;
      const s = this._calcSunPos(h, this._dayOfYear);
      const err = Math.abs(s.azimuth - azimuth) + Math.abs(s.altitude - elevation);
      if (err < bestErr) { bestErr = err; bestP = p; }
    }
    this._sunProgress = bestP;
    const slider = this._container?.querySelector('.tv-sun-slider');
    if (slider) slider.value = bestP * 100;

    const hour = dl.sunrise + (dl.sunset - dl.sunrise) * bestP;
    const hh = String(Math.floor(hour)).padStart(2, '0');
    const mm = String(Math.floor((hour % 1) * 60)).padStart(2, '0');
    const lbl = this._container?.querySelector('.tv-sun-time');
    if (lbl) lbl.textContent = `${hh}:${mm}`;
  },

  _onPointerUp() {
    if (this._draggingSun) {
      this._draggingSun = false;
      this._controls.enabled = true;
    }
  },

  // ── Player ────────────────────────────────────────────────

  togglePlayer() {
    this._playing ? this._stopPlayer() : this._startPlayer();
    this._updateToolbarState();
  },

  _startPlayer() {
    this._playing = true;
    this._clock.getDelta(); // reset
  },

  _stopPlayer() {
    this._playing = false;
  },

  _tickPlayer() {
    if (!this._playing) return;
    const dt = this._clock.getDelta();
    this._sunProgress += dt / this._playerSpeed;
    if (this._sunProgress > 1) this._sunProgress = 0;
    this._applySunFromProgress(this._sunProgress);

    const slider = this._container?.querySelector('.tv-sun-slider');
    if (slider) slider.value = this._sunProgress * 100;
  },

  // ══════════════════════════════════════════════════════════════
  // SNAPSHOT
  // ══════════════════════════════════════════════════════════════

  takeSnapshot() {
    // force render
    this._render();
    const dataUrl = this._renderer.domElement.toDataURL('image/png');
    window.SessionManager?.savePhase?.(7, { bimshowSnapshot: dataUrl });
    window.TerlabToast?.show('Snapshot 3D enregistré', 'success', 2000);
    return dataUrl;
  },

  // ══════════════════════════════════════════════════════════════
  // RENDER LOOP
  // ══════════════════════════════════════════════════════════════

  _animate() {
    this._animId = requestAnimationFrame(() => this._animate());
    this._controls.update();
    this._tickPlayer();
    this._render();
  },

  _render() {
    this._updateComposerCamera();
    this._composer.render();
  },

  // ══════════════════════════════════════════════════════════════
  // RESIZE
  // ══════════════════════════════════════════════════════════════

  _onResize() {
    const w = this._container.clientWidth;
    const h = this._container.clientHeight;
    if (w === 0 || h === 0) return;
    const aspect = w / h;

    this._renderer.setSize(w, h);
    this._composer.setSize(w, h);

    this._perspCam.aspect = aspect;
    this._perspCam.updateProjectionMatrix();

    if (this._mode !== '3D') {
      this._fitOrthoTop();
    }
  },

  // ══════════════════════════════════════════════════════════════
  // EVENTS
  // ══════════════════════════════════════════════════════════════

  _initEvents() {
    const canvas = this._renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    canvas.addEventListener('pointerup',   ()  => this._onPointerUp());

    // resize observer
    if (window.ResizeObserver) {
      new ResizeObserver(() => this._onResize()).observe(this._container);
    } else {
      window.addEventListener('resize', () => this._onResize());
    }
  },

  // ══════════════════════════════════════════════════════════════
  // TOOLBAR — injected HTML
  // ══════════════════════════════════════════════════════════════

  _buildToolbar() {
    this._container.innerHTML = `
      <canvas class="tv-canvas"></canvas>
      <div class="tv-toolbar">
        <div class="tv-group tv-modes">
          <button class="tv-btn tv-active" data-mode="3D" title="Vue perspective">3D</button>
          <button class="tv-btn" data-mode="TOP" title="Vue de dessus">TOP</button>
          <div class="tv-facade-group">
            <button class="tv-btn tv-facade-prev" title="Façade précédente">◄</button>
            <button class="tv-btn" data-mode="FACADE" title="Élévation">
              <span class="tv-facade-label">Nord</span>
            </button>
            <button class="tv-btn tv-facade-next" title="Façade suivante">►</button>
          </div>
        </div>
        <div class="tv-sep"></div>
        <div class="tv-group">
          <button class="tv-btn tv-clip-btn" title="Plan de coupe">CLIP</button>
          <input type="range" class="tv-clip-slider" min="0" max="100" value="50" title="Hauteur coupe"/>
        </div>
        <div class="tv-sep"></div>
        <div class="tv-group tv-sun-group">
          <button class="tv-btn tv-sun-btn" title="Héliodon solaire">☀</button>
          <button class="tv-btn tv-play-btn" title="Jouer course solaire">▶</button>
          <input type="range" class="tv-sun-slider" min="0" max="100" value="50" title="Heure solaire"/>
          <span class="tv-sun-time">12:00</span>
        </div>
        <div class="tv-sep"></div>
        <button class="tv-btn tv-snap-btn" title="Snapshot">📷</button>
      </div>
    `;

    // ── Wire events ──
    const q = (s) => this._container.querySelector(s);
    const qa = (s) => this._container.querySelectorAll(s);

    // modes
    qa('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
    });
    q('.tv-facade-prev')?.addEventListener('click', () => {
      this.setMode('FACADE');
      this.cycleFacade(-1);
    });
    q('.tv-facade-next')?.addEventListener('click', () => {
      this.setMode('FACADE');
      this.cycleFacade(1);
    });

    // clip
    q('.tv-clip-btn')?.addEventListener('click', () => this._toggleClip());
    q('.tv-clip-slider')?.addEventListener('input', (e) => {
      this._setClipHeight(e.target.value / 100);
    });

    // sun
    q('.tv-sun-btn')?.addEventListener('click', () => this.toggleSun());
    q('.tv-play-btn')?.addEventListener('click', () => this.togglePlayer());
    q('.tv-sun-slider')?.addEventListener('input', (e) => {
      this._sunProgress = e.target.value / 100;
      this._applySunFromProgress(this._sunProgress);
    });

    // snapshot
    q('.tv-snap-btn')?.addEventListener('click', () => this.takeSnapshot());

    this._updateToolbarState();
  },

  _updateToolbarState() {
    const q = (s) => this._container?.querySelector(s);
    const qa = (s) => this._container?.querySelectorAll(s);

    // modes
    qa?.('[data-mode]')?.forEach(btn => {
      btn.classList.toggle('tv-active', btn.dataset.mode === this._mode);
    });

    // facade label
    const fl = q('.tv-facade-label');
    if (fl) fl.textContent = FACADE_DIRS[this._facadeIdx].label;

    // clip
    q('.tv-clip-btn')?.classList.toggle('tv-active', this._clipEnabled);
    q('.tv-clip-slider').style.display = this._clipEnabled ? '' : 'none';

    // sun
    q('.tv-sun-btn')?.classList.toggle('tv-active', this._sunVisible);
    q('.tv-play-btn').style.display = this._sunVisible ? '' : 'none';
    q('.tv-sun-slider').style.display = this._sunVisible ? '' : 'none';
    q('.tv-sun-time').style.display = this._sunVisible ? '' : 'none';
    const playBtn = q('.tv-play-btn');
    if (playBtn) playBtn.textContent = this._playing ? '⏸' : '▶';
  },
};

export default Terlab3DViewer;
