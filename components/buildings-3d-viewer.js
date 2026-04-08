// TERLAB · components/buildings-3d-viewer.js
// Viewer Three.js pour le contexte bâti (Phase 5 — Voisinage)
// Convertit le GeoJSON bâtiments OSM en scène 3D avec parcelle
// Export GLB intégré

import * as THREE from 'three';
import { OrbitControls }  from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter }   from 'three/addons/exporters/GLTFExporter.js';

const DEG = Math.PI / 180;

const Buildings3DViewer = {

  // ─── CONFIG ───────────────────────────────────────────────────
  SCALE_FACTOR: 50,
  VERTICAL_EXAG: 1.0,
  BG_COLOR: 0x080e18,

  BUILDING_COLORS: {
    house:       0xc4b396,
    residential: 0xc4b396,
    apartments:  0xb8a888,
    commercial:  0xbfaf96,
    industrial:  0xa89880,
    school:      0xb0a490,
    church:      0xb5a898,
    garage:      0xc8bca8,
    shed:        0xccc0a8,
    yes:         0xc4b396,
    _default:    0xc4b396,
  },

  // ─── STATE ────────────────────────────────────────────────────
  _inited: false,
  _scene: null,
  _cam: null,
  _renderer: null,
  _controls: null,
  _canvas: null,
  _animId: null,
  _buildingsGroup: null,
  _parcelMesh: null,
  _center: null,
  _sf: 1,
  _session: null,

  // ─── INIT ─────────────────────────────────────────────────────
  async init(canvasId, sessionData) {
    if (this._inited) return;
    this._session = sessionData;

    const canvas = document.getElementById(canvasId);
    if (!canvas) return console.error('[Buildings3D] Canvas introuvable:', canvasId);
    this._canvas = canvas;

    // Renderer
    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._renderer.setClearColor(this.BG_COLOR, 1);
    this._updateSize();

    // Scene
    this._scene = new THREE.Scene();
    this._scene.fog = new THREE.Fog(this.BG_COLOR, 150, 350);

    // Camera
    const w = canvas.clientWidth, h = canvas.clientHeight;
    this._cam = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000);
    this._cam.position.set(50, 40, 60);

    // Lights
    this._setupLights();

    // Controls
    this._controls = new OrbitControls(this._cam, canvas);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.08;
    this._controls.maxPolarAngle = Math.PI / 2.05;
    this._controls.minDistance = 5;
    this._controls.maxDistance = 250;

    // Ground grid
    this._makeGrid();

    // Build parcelle + bâtiments
    await this._buildScene();

    // Center camera
    this._centerCamera();

    // Animation loop
    this._startLoop();

    // Resize
    new ResizeObserver(() => this._updateSize()).observe(canvas.parentElement);

    this._inited = true;
    window.TerlabToast?.show('Vue 3D bâtiments chargée', 'success', 1500);
  },

  // ─── LIGHTS ───────────────────────────────────────────────────
  _setupLights() {
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    this._scene.add(new THREE.HemisphereLight(0x87ceeb, 0x362a14, 0.5));

    const sun = new THREE.DirectionalLight(0xfff5e0, 1.2);
    sun.position.set(40, 60, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    this._scene.add(sun);
  },

  // ─── GRID ─────────────────────────────────────────────────────
  _makeGrid() {
    const grid = new THREE.GridHelper(200, 40, 0x1a2a3a, 0x0f1a24);
    grid.position.y = -0.01;
    this._scene.add(grid);
  },

  // ─── BUILD SCENE ──────────────────────────────────────────────
  async _buildScene() {
    const terrain = this._session?.terrain;
    if (!terrain?.lat || !terrain?.lng) {
      this._buildDemoScene();
      return;
    }

    const lat = parseFloat(terrain.lat);
    const lng = parseFloat(terrain.lng);
    this._center = [lng, lat];

    const LAT_SCALE = 111320;
    const LNG_SCALE = 111320 * Math.cos(lat * DEG);

    // 1. Parcelle
    this._buildParcel(terrain, LAT_SCALE, LNG_SCALE);

    // 2. Bâtiments OSM
    const BuildingsService = window.BuildingsService;
    if (BuildingsService) {
      try {
        const geojson = await BuildingsService.fetchBuildings(lat, lng, 250);
        this._buildBuildingsFromGeoJSON(geojson, LAT_SCALE, LNG_SCALE);
      } catch (e) {
        console.warn('[Buildings3D] Fetch bâtiments failed:', e.message);
      }
    }
  },

  // ─── PARCELLE ─────────────────────────────────────────────────
  _buildParcel(terrain, LAT_SCALE, LNG_SCALE) {
    const geom = terrain.parcelle_geojson;
    if (!geom) return;

    const coords = geom.type === 'Polygon'
      ? geom.coordinates[0]
      : geom.coordinates?.[0]?.[0];
    if (!coords || coords.length < 3) return;

    // Convert to local coords
    const pts = coords.map(c => ({
      x: (c[0] - this._center[0]) * LNG_SCALE,
      z: (c[1] - this._center[1]) * LAT_SCALE,
    }));

    // Compute scale factor from bounding box
    const xs = pts.map(p => p.x), zs = pts.map(p => p.z);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanZ = Math.max(...zs) - Math.min(...zs);
    const maxSpan = Math.max(spanX, spanZ, 50); // min 50m for context
    this._sf = this.SCALE_FACTOR / maxSpan;

    // Draw parcel as flat green surface
    const shape = new THREE.Shape();
    shape.moveTo(pts[0].x * this._sf, pts[0].z * this._sf);
    pts.slice(1).forEach(p => shape.lineTo(p.x * this._sf, p.z * this._sf));
    shape.closePath();

    const geo = new THREE.ShapeGeometry(shape);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4a7c3f, roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
      transparent: true, opacity: 0.7,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.05;
    mesh.receiveShadow = true;
    mesh.name = 'parcelle';
    this._scene.add(mesh);
    this._parcelMesh = mesh;

    // Contour parcelle (cyan)
    const linePts = pts.map(p => new THREE.Vector3(p.x * this._sf, 0.15, -p.z * this._sf));
    linePts.push(linePts[0].clone());
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(linePts),
      new THREE.LineBasicMaterial({ color: 0x00d4ff, linewidth: 2, transparent: true, opacity: 0.9 })
    );
    line.name = 'parcelle-outline';
    this._scene.add(line);

    // Label "PARCELLE"
    this._makeLabel('PARCELLE', 0, 0.5, 0, 0x00d4ff);
  },

  // ─── BÂTIMENTS ────────────────────────────────────────────────
  _buildBuildingsFromGeoJSON(geojson, LAT_SCALE, LNG_SCALE) {
    if (!geojson?.features?.length) return;

    this._buildingsGroup = new THREE.Group();
    this._buildingsGroup.name = 'buildings';

    const edgeMat = new THREE.LineBasicMaterial({ color: 0x9a7820, transparent: true, opacity: 0.4 });

    for (const feature of geojson.features) {
      const props = feature.properties;
      const coords = feature.geometry?.coordinates?.[0];
      if (!coords || coords.length < 4) continue;

      const height = (props.height ?? 5) * this._sf * this.VERTICAL_EXAG;
      const bType = props.type ?? 'yes';
      const color = this.BUILDING_COLORS[bType] ?? this.BUILDING_COLORS._default;

      // Convert to local coords
      const pts = coords.map(c => ({
        x: (c[0] - this._center[0]) * LNG_SCALE * this._sf,
        z: (c[1] - this._center[1]) * LAT_SCALE * this._sf,
      }));

      // Create extruded shape
      const shape = new THREE.Shape();
      shape.moveTo(pts[0].x, pts[0].z);
      for (let i = 1; i < pts.length - 1; i++) {
        shape.lineTo(pts[i].x, pts[i].z);
      }
      shape.closePath();

      const extrudeSettings = { depth: height, bevelEnabled: false };
      const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      const mat = new THREE.MeshStandardMaterial({
        color, roughness: 0.75, metalness: 0.05,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `building-${props.osm_id ?? 'proc'}`;

      // Wireframe edges
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, 20),
        edgeMat
      );
      mesh.add(edges);

      // Store metadata for raycasting / popups
      mesh.userData = {
        type: bType,
        label: props.label,
        height: props.height,
        floors: props.floors,
        dist_m: props.dist_m,
        name: props.name,
      };

      this._buildingsGroup.add(mesh);
    }

    this._scene.add(this._buildingsGroup);
    console.info(`[Buildings3D] ${geojson.features.length} bâtiments chargés`);
  },

  // ─── DEMO SCENE ───────────────────────────────────────────────
  _buildDemoScene() {
    this._sf = 1;
    this._buildingsGroup = new THREE.Group();

    const mat = new THREE.MeshStandardMaterial({ color: 0xc4b396, roughness: 0.75 });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x9a7820, transparent: true, opacity: 0.3 });

    for (let i = 0; i < 12; i++) {
      const w = 3 + Math.random() * 6;
      const d = 3 + Math.random() * 6;
      const h = 3 + Math.random() * 12;
      const geo = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.position.set(
        (Math.random() - 0.5) * 60,
        h / 2,
        (Math.random() - 0.5) * 60
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), edgeMat));
      this._buildingsGroup.add(mesh);
    }

    // Parcelle démo
    const parcelGeo = new THREE.PlaneGeometry(15, 15);
    const parcelMat = new THREE.MeshStandardMaterial({
      color: 0x4a7c3f, roughness: 0.85, side: THREE.DoubleSide,
      transparent: true, opacity: 0.7,
    });
    const parcel = new THREE.Mesh(parcelGeo, parcelMat);
    parcel.rotation.x = -Math.PI / 2;
    parcel.position.y = 0.05;
    parcel.receiveShadow = true;
    this._scene.add(parcel);

    this._scene.add(this._buildingsGroup);
    this._makeLabel('PARCELLE', 0, 0.5, 0, 0x00d4ff);
  },

  // ─── LABEL SPRITE ─────────────────────────────────────────────
  _makeLabel(text, x, y, z, color = 0xffffff) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 24px monospace';
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.textAlign = 'center';
    ctx.fillText(text, 128, 40);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y, z);
    sprite.scale.set(8, 2, 1);
    this._scene.add(sprite);
  },

  // ─── COLOR MODES ──────────────────────────────────────────────
  applyColorMode(mode) {
    if (!this._buildingsGroup) return;

    const meshes = this._buildingsGroup.children.filter(c => c.isMesh);
    if (!meshes.length) return;

    if (mode === 'type') {
      // Restore original type-based colors
      for (const mesh of meshes) {
        const bType = mesh.userData.type ?? 'yes';
        const color = this.BUILDING_COLORS[bType] ?? this.BUILDING_COLORS._default;
        mesh.material.color.setHex(color);
      }
      return;
    }

    if (mode === 'distance') {
      // Color by distance to parcel center (stored in userData.dist_m)
      const distances = meshes.map(m => m.userData.dist_m ?? 0);
      const maxDist = Math.max(...distances, 1);
      for (const mesh of meshes) {
        const d = mesh.userData.dist_m ?? 0;
        const t = Math.min(d / maxDist, 1); // 0 = close, 1 = far
        mesh.material.color.setHSL(0.33 - t * 0.33, 0.7, 0.45 + t * 0.15);
        // green (close) → yellow → red (far)
      }
      return;
    }

    if (mode === 'surface') {
      // Color by footprint area — estimate from bounding box of the extruded geometry
      const areas = meshes.map(m => {
        const geo = m.geometry;
        if (!geo) return 0;
        geo.computeBoundingBox();
        const sz = geo.boundingBox.getSize(new THREE.Vector3());
        // For extruded shapes rotated -PI/2 on X, footprint is in XY plane of the geometry
        return sz.x * sz.y;
      });
      const maxArea = Math.max(...areas, 1);
      for (let i = 0; i < meshes.length; i++) {
        const t = Math.min(areas[i] / maxArea, 1); // 0 = small, 1 = large
        meshes[i].material.color.setHSL(0.55 - t * 0.55, 0.65, 0.45 + t * 0.1);
        // blue (small) → green → red (large)
      }
      return;
    }
  },

  // ─── CAMERA ───────────────────────────────────────────────────
  _centerCamera() {
    const box = new THREE.Box3().setFromObject(this._scene);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 1.5;

    this._cam.position.set(center.x + dist * 0.6, dist * 0.5, center.z + dist * 0.6);
    this._controls.target.copy(center);
    this._controls.update();
  },

  // ─── VIEW MODES ───────────────────────────────────────────────
  setView(mode) {
    const box = new THREE.Box3().setFromObject(this._scene);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const d = Math.max(size.x, size.z) * 1.2;

    switch (mode) {
      case 'top':
        this._cam.position.set(center.x, d, center.z);
        break;
      case 'north':
        this._cam.position.set(center.x, d * 0.3, center.z + d);
        break;
      case 'east':
        this._cam.position.set(center.x + d, d * 0.3, center.z);
        break;
      case 'orbit':
      default:
        this._cam.position.set(center.x + d * 0.6, d * 0.5, center.z + d * 0.6);
        break;
    }
    this._controls.target.copy(center);
    this._controls.update();
  },

  // ─── EXPORT GLB ───────────────────────────────────────────────
  async exportGLB() {
    const group = new THREE.Group();
    if (this._parcelMesh) group.add(this._parcelMesh.clone());
    if (this._buildingsGroup) group.add(this._buildingsGroup.clone());

    if (group.children.length === 0) {
      window.TerlabToast?.show('Rien à exporter', 'warning');
      return;
    }

    try {
      const exporter = new GLTFExporter();
      const ref = this._session?.terrain?.parcelle ?? 'voisinage';
      exporter.parse(group, glb => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
        a.download = `TERLAB_voisinage_${ref}.glb`;
        a.click();
        URL.revokeObjectURL(a.href);
        window.TerlabToast?.show('GLB voisinage exporté', 'success', 2000);
      }, e => {
        console.error('[Buildings3D] Export error:', e);
        window.TerlabToast?.show('Erreur export GLB', 'error');
      }, { binary: true });
    } catch (e) {
      console.error('[Buildings3D] GLTFExporter error:', e);
      window.TerlabToast?.show('Export GLB non disponible', 'warning');
    }
  },

  // ─── RENDER LOOP ──────────────────────────────────────────────
  _startLoop() {
    const loop = () => {
      this._animId = requestAnimationFrame(loop);
      this._controls?.update();
      this._renderer.render(this._scene, this._cam);
    };
    loop();
  },

  _updateSize() {
    const c = this._canvas;
    if (!c) return;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w || c.height !== h) {
      this._renderer.setSize(w, h, false);
      if (this._cam) { this._cam.aspect = w / h; this._cam.updateProjectionMatrix(); }
    }
  },

  // ─── DISPOSE ──────────────────────────────────────────────────
  dispose() {
    if (this._animId) cancelAnimationFrame(this._animId);
    this._renderer?.dispose();
    this._controls?.dispose();
    this._scene?.traverse(obj => {
      obj.geometry?.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
    this._inited = false;
  },
};

export default Buildings3DViewer;
