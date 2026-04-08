// TERLAB · components/buildings-3d-viewer.js
// Viewer Three.js pour le contexte bâti (Phase 5 — Voisinage)
// Convertit le GeoJSON bâtiments OSM en scène 3D avec parcelle
// Intègre LiDAR IGN : terrain relief, vraies hauteurs bâtiments, arbres
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

  // Couleurs par source de hauteur
  _HEIGHT_SOURCE_COLORS: {
    lidar:      null,      // utiliser BUILDING_COLORS normal
    osm:        0xb8a080,  // légèrement orangé
    'osm-floors': 0xb0a888,
    default:    0x888070,  // gris = valeur par défaut
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
  _terrainMesh: null,
  _treesGroup: null,
  _lidarCtx: null,
  _gridHelper: null,

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

    // Ground grid (fallback si pas de terrain LiDAR)
    this._makeGrid();

    // Build parcelle + bâtiments + LiDAR
    await this._buildScene();

    // Center camera
    this._centerCamera();

    // Animation loop
    this._startLoop();

    // Resize
    new ResizeObserver(() => this._updateSize()).observe(canvas.parentElement);

    this._inited = true;
    const src = this._lidarCtx ? 'LiDAR IGN' : 'OSM';
    window.TerlabToast?.show(`Vue 3D bâtiments chargée — hauteurs : ${src}`, 'success', 2000);
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
    this._gridHelper = new THREE.GridHelper(200, 40, 0x1a2a3a, 0x0f1a24);
    this._gridHelper.position.y = -0.01;
    this._scene.add(this._gridHelper);
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

    // 2. Fetch bâtiments OSM
    let buildingsGJ = null;
    const BuildingsService = window.BuildingsService;
    if (BuildingsService) {
      try {
        buildingsGJ = await BuildingsService.fetchBuildings(lat, lng, 250);
      } catch (e) {
        console.warn('[Buildings3D] Fetch bâtiments failed:', e.message);
      }
    }

    // 3. Intégration LiDAR (terrain + hauteurs + arbres)
    await this._integrateLidar(LAT_SCALE, LNG_SCALE, buildingsGJ);

    // 4. Bâtiments (après LiDAR pour avoir les hauteurs)
    if (buildingsGJ) {
      this._buildBuildingsFromGeoJSON(buildingsGJ, LAT_SCALE, LNG_SCALE);
    }
  },

  // ─── LIDAR INTEGRATION ────────────────────────────────────────
  async _integrateLidar(LAT_SCALE, LNG_SCALE, buildingsGJ) {
    const LCS = window.LidarContextService;
    const LS  = window.LidarService;
    if (!LCS || !LS) return;

    // Vérifier le cache
    let rawPoints = LS.getRawPoints();
    let classes   = LS.getRawPointsClasses() ?? '';

    // On a besoin des classes 2,5,6 au minimum
    const needsFetch = !rawPoints?.length || !classes.includes('6');

    if (needsFetch) {
      // Vérifier si le LiDAR était disponible en P01
      const SM = window.SessionManager;
      const p1data = SM?.getPhase?.(1)?.data;
      if (!p1data?.lidar_available) return; // Pas de LiDAR → garder le comportement actuel

      const terrain = this._session?.terrain;
      if (!terrain?.parcelle_geojson) return;

      try {
        console.info('[Buildings3D] Fetch LiDAR on-demand (classes 2,3,4,5,6,9)…');
        const result = await LS.getPointsForParcel(
          terrain.parcelle_geojson, 50,
          { classes: '2,3,4,5,6,9', maxPoints: 300000 }
        );
        if (!result?.points?.length) return;
        rawPoints = result.points;
        LS.setRawPoints(rawPoints, '2,3,4,5,6,9');
      } catch (e) {
        console.warn('[Buildings3D] LiDAR fetch failed:', e.message);
        return; // Fallback gracieux → comportement actuel
      }
    }

    // Traiter les points
    const terrain = this._session?.terrain;
    const ctx = LCS.process(rawPoints, terrain?.parcelle_geojson, buildingsGJ);
    if (!ctx?.mnt || ctx.mnt.cols === 0) return;

    this._lidarCtx = ctx;

    // Terrain relief (remplace la grille plate)
    if (ctx.terrainData) {
      this._buildTerrainMesh(ctx, LAT_SCALE, LNG_SCALE);
    }

    // Arbres
    if (ctx.trees?.length) {
      this._buildTrees(ctx);
    }
  },

  // ─── TERRAIN MESH (LiDAR) ────────────────────────────────────
  _buildTerrainMesh(ctx) {
    const { terrainData, groundZ } = ctx;
    const { positions, indices, cols, rows, minAlt, maxAlt } = terrainData;
    const sf = this._sf;
    const ve = this.VERTICAL_EXAG;
    const altRange = Math.max(maxAlt - minAlt, 0.1);

    // Vertices : convertir en espace Three.js (centré, scalé)
    const verts  = new Float32Array(positions.length);
    const colors = new Float32Array(positions.length);

    for (let i = 0; i < positions.length; i += 3) {
      const x   = positions[i];
      const alt = positions[i + 1];
      const z   = positions[i + 2];

      verts[i]     =  x * sf;
      verts[i + 1] = (alt - groundZ) * sf * ve;
      verts[i + 2] = -z * sf; // inversion Z (Three.js convention)

      // Gradient couleur altitude : vert sombre (bas) → vert clair (haut)
      const t = (alt - minAlt) / altRange;
      colors[i]     = 0.18 + t * 0.25; // R
      colors[i + 1] = 0.35 + t * 0.20; // G
      colors[i + 2] = 0.12 + t * 0.08; // B
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.9, metalness: 0,
      side: THREE.DoubleSide,
    });

    this._terrainMesh = new THREE.Mesh(geo, mat);
    this._terrainMesh.receiveShadow = true;
    this._terrainMesh.name = 'terrain-lidar';
    this._scene.add(this._terrainMesh);

    // Masquer la grille plate
    if (this._gridHelper) this._gridHelper.visible = false;

    console.info(`[Buildings3D] Terrain LiDAR : ${cols}×${rows} vertices, dénivelé ${altRange.toFixed(1)}m`);
  },

  // ─── ARBRES (LiDAR) ──────────────────────────────────────────
  _buildTrees(ctx) {
    const { trees, groundZ, mnt } = ctx;
    const sf = this._sf;
    const ve = this.VERTICAL_EXAG;
    const LCS = window.LidarContextService;

    this._treesGroup = new THREE.Group();
    this._treesGroup.name = 'trees-lidar';

    for (const tree of trees) {
      const x = tree.x * sf;
      const z = -tree.z * sf; // inversion Z
      const h = tree.height * sf * ve;
      const r = tree.radiusM * sf;

      // Altitude sol sous l'arbre
      const groundY = (tree.groundAlt - groundZ) * sf * ve;

      // Tronc
      const trunkH = h * 0.4;
      const trunkGeo = new THREE.CylinderGeometry(r * 0.08, r * 0.12, trunkH, 6);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.9 });
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(x, groundY + trunkH / 2, z);
      trunk.castShadow = true;
      this._treesGroup.add(trunk);

      // Couronne (IcosahedronGeometry — léger, compatible r182)
      const canopyGeo = new THREE.IcosahedronGeometry(r, 1);
      canopyGeo.scale(1, (h * 0.6) / (r * 2), 1); // aplatir verticalement
      const canopyMat = new THREE.MeshStandardMaterial({
        color: 0x2d6b1e, roughness: 0.85, transparent: true, opacity: 0.85,
      });
      const canopy = new THREE.Mesh(canopyGeo, canopyMat);
      canopy.position.set(x, groundY + trunkH + (h * 0.6) / 2, z);
      canopy.castShadow = true;
      this._treesGroup.add(canopy);
    }

    this._scene.add(this._treesGroup);
    console.info(`[Buildings3D] ${trees.length} arbres LiDAR ajoutés`);
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
    const sf = this._sf;
    const ve = this.VERTICAL_EXAG;
    const hasLidar = !!this._lidarCtx;
    const groundZ = this._lidarCtx?.groundZ ?? 0;

    for (let fi = 0; fi < geojson.features.length; fi++) {
      const feature = geojson.features[fi];
      const props = feature.properties;
      const coords = feature.geometry?.coordinates?.[0];
      if (!coords || coords.length < 4) continue;

      // ── Résolution hauteur (priorité LiDAR > OSM > défaut) ────
      const lidarH = this._lidarCtx?.buildingHeights?.get(fi);
      let height, heightSource;

      if (lidarH?.height != null && lidarH.height > 0.5) {
        height       = lidarH.height;
        heightSource = 'lidar';
      } else if (props.height && parseFloat(props.height) > 0) {
        height       = parseFloat(props.height);
        heightSource = 'osm';
      } else if (props.floors && parseInt(props.floors) > 0) {
        height       = parseInt(props.floors) * 3.0;
        heightSource = 'osm-floors';
      } else {
        height       = 4.5; // case créole typique Réunion
        heightSource = 'default';
      }

      height = Math.max(2, Math.min(50, height));
      const scaledHeight = height * sf * ve;

      // Couleur selon source
      const bType = props.type ?? 'yes';
      const typeColor = this.BUILDING_COLORS[bType] ?? this.BUILDING_COLORS._default;
      const srcColor  = this._HEIGHT_SOURCE_COLORS[heightSource];
      const color = srcColor ?? typeColor;

      // Convert to local coords
      const pts = coords.map(c => ({
        x: (c[0] - this._center[0]) * LNG_SCALE * sf,
        z: (c[1] - this._center[1]) * LAT_SCALE * sf,
      }));

      // Create extruded shape
      const shape = new THREE.Shape();
      shape.moveTo(pts[0].x, pts[0].z);
      for (let i = 1; i < pts.length - 1; i++) {
        shape.lineTo(pts[i].x, pts[i].z);
      }
      shape.closePath();

      const extrudeSettings = { depth: scaledHeight, bevelEnabled: false };
      const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      const mat = new THREE.MeshStandardMaterial({
        color, roughness: 0.75, metalness: 0.05,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;

      // Poser le bâtiment sur le terrain LiDAR
      let groundY = 0;
      if (lidarH?.groundAlt != null) {
        groundY = (lidarH.groundAlt - groundZ) * sf * ve;
      } else if (hasLidar) {
        // Pas de hauteur LiDAR pour ce bâtiment, mais terrain dispo → échantillonner
        const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
        const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;
        const localX = (cx - this._center[0]) * LNG_SCALE;
        const localZ = (cy - this._center[1]) * LAT_SCALE;
        const LCS = window.LidarContextService;
        if (LCS && this._lidarCtx?.mnt) {
          const alt = LCS.sampleMNT(this._lidarCtx.mnt, localX, localZ);
          groundY = (alt - groundZ) * sf * ve;
        }
      }
      mesh.position.y = groundY;

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
        height,
        heightSource,
        lidarPoints: lidarH?.pointCount ?? 0,
        floors: props.floors,
        dist_m: props.dist_m,
        name: props.name,
      };

      this._buildingsGroup.add(mesh);
    }

    this._scene.add(this._buildingsGroup);

    // Stats
    let lidarCount = 0, osmCount = 0, defaultCount = 0;
    for (const mesh of this._buildingsGroup.children) {
      if (!mesh.isMesh) continue;
      const src = mesh.userData?.heightSource;
      if (src === 'lidar') lidarCount++;
      else if (src === 'osm' || src === 'osm-floors') osmCount++;
      else defaultCount++;
    }
    console.info(`[Buildings3D] ${geojson.features.length} bâtiments : ${lidarCount} LiDAR · ${osmCount} OSM · ${defaultCount} défaut`);
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
      for (const mesh of meshes) {
        const bType = mesh.userData.type ?? 'yes';
        const color = this.BUILDING_COLORS[bType] ?? this.BUILDING_COLORS._default;
        mesh.material.color.setHex(color);
      }
      return;
    }

    if (mode === 'height-source') {
      // Couleur par source de hauteur (lidar = vert, osm = orange, défaut = gris)
      for (const mesh of meshes) {
        const src = mesh.userData?.heightSource;
        if (src === 'lidar')   mesh.material.color.setHex(0x27ae60);
        else if (src === 'osm' || src === 'osm-floors') mesh.material.color.setHex(0xe67e22);
        else                   mesh.material.color.setHex(0x888070);
      }
      return;
    }

    if (mode === 'distance') {
      const distances = meshes.map(m => m.userData.dist_m ?? 0);
      const maxDist = Math.max(...distances, 1);
      for (const mesh of meshes) {
        const d = mesh.userData.dist_m ?? 0;
        const t = Math.min(d / maxDist, 1);
        mesh.material.color.setHSL(0.33 - t * 0.33, 0.7, 0.45 + t * 0.15);
      }
      return;
    }

    if (mode === 'surface') {
      const areas = meshes.map(m => {
        const geo = m.geometry;
        if (!geo) return 0;
        geo.computeBoundingBox();
        const sz = geo.boundingBox.getSize(new THREE.Vector3());
        return sz.x * sz.y;
      });
      const maxArea = Math.max(...areas, 1);
      for (let i = 0; i < meshes.length; i++) {
        const t = Math.min(areas[i] / maxArea, 1);
        meshes[i].material.color.setHSL(0.55 - t * 0.55, 0.65, 0.45 + t * 0.1);
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
    if (this._parcelMesh)    group.add(this._parcelMesh.clone());
    if (this._buildingsGroup) group.add(this._buildingsGroup.clone());
    if (this._terrainMesh)   group.add(this._terrainMesh.clone());
    if (this._treesGroup)    group.add(this._treesGroup.clone());

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

    // Nettoyer terrain + arbres LiDAR
    if (this._terrainMesh) {
      this._terrainMesh.geometry?.dispose();
      this._terrainMesh.material?.dispose();
    }
    if (this._treesGroup) {
      this._treesGroup.traverse(obj => {
        obj.geometry?.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
      });
    }

    this._scene?.traverse(obj => {
      obj.geometry?.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });

    this._terrainMesh = null;
    this._treesGroup = null;
    this._lidarCtx = null;
    this._inited = false;
  },
};

export default Buildings3DViewer;
