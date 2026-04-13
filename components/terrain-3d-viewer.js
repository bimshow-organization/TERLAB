// TERLAB · components/terrain-3d-viewer.js
// Viewer 3D terrain + gabarit + pentes + ensoleillement
// Sources : TerrainViz_Gamer_v4 · bimshow-shadow-study · GIEP giep-3d-slopes
// v2 : BIL 1m mesh + orthophoto IGN + modes couleur + export GLB

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import SlopesService from '../services/slopes-service.js';
import SunCalcService from '../services/sun-calc-service.js';
import GeoStatusBar from './geo-status-bar.js';
import GLBExporter from '../utils/glb-exporter.js';
import ContourService from '../services/contour-service.js';
import BILTerrain from '../services/bil-terrain.js';

// Exposer THREE globalement pour compatibilité scripts inline
if (typeof window !== 'undefined' && !window.THREE) {
  window.THREE = Object.assign({}, THREE);
  window.THREE.OrbitControls = OrbitControls;
}

const Terrain3D = {

  // ─── CONFIG ───────────────────────────────────────────────────
  MAPBOX_TOKEN: null,     // Injecté depuis SessionManager ou config TERLAB
  SCALE_FACTOR: 40,       // Taille max de la scène Three.js (unités)
  EXTRUDE_DEPTH: 4,       // Hauteur de base du terrain (visuellement)
  BG_EXPANSION: 5,        // Facteur d'expansion du wireframe background
  VERTICAL_EXAG: 0.4,     // Exagération verticale de la topographie

  // ─── STATE ────────────────────────────────────────────────────
  _scene:        null,
  _cam:          null,
  _renderer:     null,
  _controls:     null,
  _canvas:       null,
  _animId:       null,
  _terrainGroup: null,
  _gabaritMesh:  null,
  _bgWire:       null,
  _slopeArrows:  null,
  _shadowHelper: null,
  _sunLight:     null,
  _cornerAlts:   [],
  _parcelData:   null,
  _session:      null,
  _dimLabels:    [],
  _contourGroup: null,
  _showContours: true,
  _mode:         'orbit',      // 'orbit' | 'top' | 'front'
  _showSun:      false,
  _showSlopes:   true,
  _showDims:     true,
  _sunHour:      12,
  _sunDay:       172,          // 21 juin
  _terrainSF:    null,
  _scaledPts:    null,
  _terrainCenter: null,
  _topMesh:      null,
  _textureMode:  'ortho',     // 'ortho' | 'elevation' | 'slope' | 'satellite'
  _textures:     {},           // cache { ortho, elevation, slope, satellite }
  _bilMeta:      null,         // { heights, W, H, minAlt, maxAlt } pour coloration vertex
  _orthoLoaded:  false,
  _vegetationGroup: null,      // THREE.Group contenant InstancedMesh par espece
  _vegetationMats:  [],        // ShaderMaterial[] pour update uniform camera par frame

  // ─── INIT ─────────────────────────────────────────────────────
  async init(canvasId, sessionData) {
    this._session = sessionData;
    this._parcelData = sessionData?.terrain;
    this.MAPBOX_TOKEN = window.TERLAB_CONFIG?.mapboxToken ?? '';

    const canvas = document.getElementById(canvasId);
    if (!canvas) return console.error('[Terrain3D] Canvas introuvable:', canvasId);
    this._canvas = canvas;

    // Attendre Three.js
    if (!THREE) return console.error('[Terrain3D] Three.js non chargé');

    // Renderer
    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.1;
    this._renderer.setClearColor(0x080e18, 1);
    this._updateSize();

    // Scène
    this._scene = new THREE.Scene();
    this._scene.fog = new THREE.Fog(0x080e18, 80, 400);

    // Caméra
    const w = canvas.clientWidth, h = canvas.clientHeight;
    this._cam = new THREE.PerspectiveCamera(55, w / h, 0.1, 1000);
    this._cam.position.set(40, 35, 50);

    // Lumières
    this._setupLights();

    // OrbitControls
    this._controls = new OrbitControls(this._cam, canvas);
    if (this._controls) {
      this._controls.enableDamping = true;
      this._controls.dampingFactor = 0.08;
      this._controls.maxPolarAngle = Math.PI / 2.05;
      this._controls.minDistance  = 5;
      this._controls.maxDistance  = 200;
    }

    // Grid de fond (background simple)
    this._makeBgGrid();

    // Construire le terrain depuis la session
    await this._buildTerrain();

    // Courbes de niveau 3D (BIL)
    this._buildContours();

    // Gabarit depuis Phase 7
    this._buildGabarit();

    // Flèches pentes
    if (this._showSlopes) this._buildSlopeArrows();

    // Soleil init
    this._updateSun();

    // Centrer caméra
    this._centerCamera();

    // Loop de rendu
    this._startLoop();

    // Resize observer
    new ResizeObserver(() => this._updateSize()).observe(canvas.parentElement);

    // Barre de statut géographique
    const wrap = canvas.closest('.t3d-wrap') || canvas.parentElement;
    if (wrap) {
      GeoStatusBar.attach({ container: wrap, source: 'three', viewer: this });
    }

    window.TerlabToast?.show('Vue 3D chargée', 'success', 1500);
  },

  // ─── LUMIÈRES — setup BIMSHOW-quality ──────────────────────────
  // Source : web-app LightShadowsBimshow.js + shadow-config.ts
  _setupLights() {
    const scene = this._scene;

    // Ambiance réduite pour laisser les ombres respirer
    scene.add(new THREE.AmbientLight(0x8899aa, 0.35));

    // Lumière hémisphérique (ciel bleu + sol vert)
    const hemi = new THREE.HemisphereLight(0x99bbdd, 0x334422, 0.45);
    scene.add(hemi);

    // Lumière directionnelle principale (soleil)
    this._sunLight = new THREE.DirectionalLight(0xfff5e0, 1.4);
    this._sunLight.position.set(30, 60, 20);
    this._sunLight.castShadow = true;
    // Shadow map haute qualité — source shadow-config.ts "high"
    this._sunLight.shadow.mapSize.set(2048, 2048);
    this._sunLight.shadow.camera.near = 0.5;
    this._sunLight.shadow.camera.far  = 400;
    this._sunLight.shadow.camera.left = -80;
    this._sunLight.shadow.camera.right = 80;
    this._sunLight.shadow.camera.top  = 80;
    this._sunLight.shadow.camera.bottom = -80;
    // Anti shadow-acne — source LightShadowsBimshow.js
    this._sunLight.shadow.bias       = -0.001;
    this._sunLight.shadow.normalBias =  1.0;
    scene.add(this._sunLight);
    scene.add(this._sunLight.target);

    // Lumière de contraste arrière (fill light)
    const contrast = new THREE.DirectionalLight(0xaabbcc, 0.3);
    contrast.position.set(-20, 15, -30);
    scene.add(contrast);
  },

  // ─── BACKGROUND WIREFRAME SIMPLE ──────────────────────────────
  _makeBgGrid() {
    const size  = this.SCALE_FACTOR * this.BG_EXPANSION;
    const div   = 48;

    // Grille principale (wireframe)
    const geo = new THREE.PlaneGeometry(size, size, div, div);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x1a2e1a,
      wireframe: true,
      transparent: true,
      opacity: 0.3,
    });
    this._bgWire = new THREE.Mesh(geo, mat);
    this._bgWire.rotation.x = -Math.PI / 2;
    this._bgWire.position.y = -0.2;
    this._bgWire.name = 'bg-grid';
    this._scene.add(this._bgWire);

    // Grille fine supplémentaire (subdivisions)
    const geo2 = new THREE.PlaneGeometry(size, size, div * 3, div * 3);
    const mat2 = new THREE.MeshBasicMaterial({
      color: 0x112211,
      wireframe: true,
      transparent: true,
      opacity: 0.12,
    });
    const bgFine = new THREE.Mesh(geo2, mat2);
    bgFine.rotation.x = -Math.PI / 2;
    bgFine.position.y = -0.15;
    bgFine.name = 'bg-grid-fine';
    this._scene.add(bgFine);

    // Axes cardinaux (N/S/E/O) — simples lignes colorées au sol
    const addAxis = (x1, z1, x2, z2, color) => {
      const pts = [
        new THREE.Vector3(x1, 0, z1),
        new THREE.Vector3(x2, 0, z2),
      ];
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 })
      );
      line.name = 'bg-axis';
      this._scene.add(line);
    };
    const hs = size / 2;
    addAxis(0, -hs, 0, hs, 0x00d4ff);  // N-S (cyan)
    addAxis(-hs, 0, hs, 0, 0x00d4ff);  // E-O (cyan)
  },

  // ─── TERRAIN BIL HAUTE RÉSOLUTION ─────────────────────────────
  async _buildTerrain() {
    const t = this._parcelData;
    if (!t?.parcelle_geojson) {
      this._buildDemoTerrain();
      return;
    }

    // Nettoyer si existant
    this._disposeGroup(this._terrainGroup);

    const geom   = t.parcelle_geojson;
    const coords = geom.type === 'Polygon'
      ? geom.coordinates[0]
      : geom.coordinates[0][0];

    const center = [
      coords.reduce((s, c) => s + c[0], 0) / coords.length,
      coords.reduce((s, c) => s + c[1], 0) / coords.length,
    ];
    const LAT_SCALE = 111320;
    const LNG_SCALE = 111320 * Math.cos(center[1] * Math.PI / 180);

    // BBox WGS84 avec marge ~50m
    const lngs = coords.map(c => c[0]), lats = coords.map(c => c[1]);
    const margin = 0.0005; // ~55m
    const wgsBounds = {
      west:  Math.min(...lngs) - margin,
      east:  Math.max(...lngs) + margin,
      south: Math.min(...lats) - margin,
      north: Math.max(...lats) + margin,
    };

    // Coordonnées locales du parcelle pour l'outline
    const localPts = coords.map(c => ({
      x: (c[0] - center[0]) * LNG_SCALE,
      z: (c[1] - center[1]) * LAT_SCALE,
      lng: c[0], lat: c[1],
    }));
    const xs  = localPts.map(p => p.x);
    const zs  = localPts.map(p => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);

    this._terrainGroup = new THREE.Group();
    this._terrainCenter = center;

    // ── Mesh BIL haute résolution (1m IGN) ────────────────────────
    // BIL mesh coords : x=easting, y=northing, z=altitude (centré sur UTM)
    // Three.js : x=east, y=up, z=south → rotation -90° autour de X
    let topMesh;
    try {
      topMesh = await BILTerrain.buildMesh(wgsBounds, {
        pixelSizeM: 1.0,
        maxDim: 256,
        verticalExaggeration: 1.0,
      });

      // Rotation XY-plane → XZ-plane (Y-up)
      topMesh.rotation.x = -Math.PI / 2;

      // Dimensions dans le plan horizontal (avant rotation)
      const bb = topMesh.geometry.boundingBox;
      const meshW = bb.max.x - bb.min.x;   // easting span
      const meshH = bb.max.y - bb.min.y;   // northing span
      const meshSpan = Math.max(meshW, meshH);
      const sf = this.SCALE_FACTOR / meshSpan;

      // Scale : X et Y (horiz) uniformes, Z (BIL altitude) exagéré
      // Après rotation -90°X : BIL-z (alt) → Three-y, BIL-y (north) → Three-(-z)
      // VEXAG sur scale.z car c'est BIL-z (altitude) qui, après rotation, devient world Y
      topMesh.scale.set(sf, sf, sf * this.VERTICAL_EXAG);
      this._terrainSF = sf;

      // Positionner le mesh pour que le point le plus bas = EXTRUDE_DEPTH
      // World Y du vertex le plus bas = bb.min.z * scale.z = bb.min.z * sf * VEXAG
      const altMin = bb.min.z * sf * this.VERTICAL_EXAG;
      topMesh.position.y = this.EXTRUDE_DEPTH - altMin;

      const ud = topMesh.userData;
      this._bilMeta = ud;

      // Calculer les scaledPts de la parcelle pour outline et slopes
      // World Y = (alt - altMin_raw) * sf * VEXAG + EXTRUDE_DEPTH
      const altRange = bb.max.z - bb.min.z;  // dénivelé en m
      const altMidOffset = altRange / 2 * sf * this.VERTICAL_EXAG;
      const scaledPts = localPts.map(p => {
        const sx = (p.x - (minX + maxX) / 2) / meshSpan * this.SCALE_FACTOR;
        const sz = (p.z - (minZ + maxZ) / 2) / meshSpan * this.SCALE_FACTOR;
        return { x: sx, z: sz, y: altMidOffset + this.EXTRUDE_DEPTH, lng: p.lng, lat: p.lat };
      });
      this._scaledPts = scaledPts;

      console.log(`[Terrain3D] BIL mesh OK — ${meshW.toFixed(0)}×${meshH.toFixed(0)}m, pixel ${ud.pixelSizeM}m`);
    } catch (err) {
      console.warn('[Terrain3D] BIL indisponible, fallback ShapeGeometry:', err.message);
      topMesh = this._buildFallbackTerrain(coords, center, LAT_SCALE, LNG_SCALE, localPts, minX, maxX, minZ, maxZ);
    }

    topMesh.castShadow    = true;
    topMesh.receiveShadow = true;
    topMesh.name = 'terrain-top';
    this._terrainGroup.add(topMesh);
    this._topMesh = topMesh;

    // ── Base extrudée (sol opaque sous le mesh) ──────────────────
    const bb2 = new THREE.Box3().setFromObject(topMesh);
    const baseGeo = new THREE.PlaneGeometry(
      bb2.max.x - bb2.min.x, bb2.max.z - bb2.min.z
    );
    const baseMesh = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({
      color: 0x1a2e1a, roughness: 1.0,
    }));
    baseMesh.rotation.x = -Math.PI / 2;
    baseMesh.position.set(
      (bb2.min.x + bb2.max.x) / 2,
      0.05,
      (bb2.min.z + bb2.max.z) / 2
    );
    baseMesh.name = 'terrain-bottom';
    this._terrainGroup.add(baseMesh);

    this._scene.add(this._terrainGroup);

    // ── Contour parcelle (lines) ──────────────────────────────────
    if (this._scaledPts?.length > 2) {
      const lineMat = new THREE.LineBasicMaterial({ color: 0x00d4ff, linewidth: 2, transparent: true, opacity: 0.8 });
      const lineTop = this._scaledPts.map(p => new THREE.Vector3(p.x, p.y + 0.3, -p.z));
      lineTop.push(lineTop[0].clone());
      const lineObj = new THREE.Line(new THREE.BufferGeometry().setFromPoints(lineTop), lineMat);
      lineObj.name = 'terrain-outline';
      this._terrainGroup.add(lineObj);
    }

    // ── Texture : orthophoto IGN par défaut ───────────────────────
    await this._loadOrthoIGN(topMesh, wgsBounds);

    // ── Générer les textures alternatives en cache ────────────────
    this._buildElevationColors(topMesh);
    this._buildSlopeColors(topMesh);

    // ── Labels altitudes aux coins ────────────────────────────────
    if (this._scaledPts?.length >= 3) {
      const altBase = parseFloat(t.altitude_ngr ?? 100);
      const denivelé = parseFloat(t.denivelé_m ?? 2);
      const cornerAlts = coords.map((_, i) =>
        altBase + (i % 2 === 0 ? 0 : denivelé * (i / coords.length))
      );
      this._cornerAlts = cornerAlts;
      this._makeAltLabels(this._scaledPts, cornerAlts);
      this._makeDims(this._scaledPts, localPts, this._terrainSF ?? 1);
    }
  },

  // ─── FALLBACK ShapeGeometry (si BIL échoue) ───────────────────
  _buildFallbackTerrain(coords, center, LAT_SCALE, LNG_SCALE, localPts, minX, maxX, minZ, maxZ) {
    const altBase  = parseFloat(this._parcelData.altitude_ngr ?? 100);
    const denivelé = parseFloat(this._parcelData.denivelé_m ?? 2);
    const cornerAlts = coords.map((_, i) =>
      altBase + (i % 2 === 0 ? 0 : denivelé * (i / coords.length))
    );
    this._cornerAlts = cornerAlts;
    const sf = this.SCALE_FACTOR / Math.max(maxX - minX, maxZ - minZ);
    this._terrainSF = sf;

    const scaledPts = localPts.map((p, i) => ({
      x: p.x * sf, z: p.z * sf,
      y: (cornerAlts[i] - Math.min(...cornerAlts)) * sf * this.VERTICAL_EXAG + this.EXTRUDE_DEPTH,
      lng: p.lng, lat: p.lat,
    }));
    this._scaledPts = scaledPts;

    const shape = new THREE.Shape();
    shape.moveTo(scaledPts[0].x, scaledPts[0].z);
    scaledPts.slice(1).forEach(p => shape.lineTo(p.x, p.z));
    shape.closePath();

    const topGeo = new THREE.ShapeGeometry(shape, 8);
    const pos = topGeo.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const px = pos[i], pz = pos[i + 1];
      let wSum = 0, altW = 0;
      scaledPts.forEach(sp => {
        const d = Math.hypot(px - sp.x, pz - sp.z);
        const w = 1 / (d + 0.01);
        altW += sp.y * w; wSum += w;
      });
      pos[i + 2] = altW / wSum;
    }
    topGeo.attributes.position.needsUpdate = true;
    topGeo.computeVertexNormals();

    const mesh = new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({
      color: 0x4a7c3f, roughness: 0.85, side: THREE.FrontSide,
    }));
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  },

  // ─── TERRAIN DE DÉMONSTRATION ─────────────────────────────────
  _buildDemoTerrain() {
    const w = 20, d = 14, h = this.EXTRUDE_DEPTH;

    const verts = new Float32Array([
      -w, h + 2,  d,  // NW haut
       w, h + 2,  d,  // NE haut
      -w, h,     -d,  // SW bas
       w, h,     -d,  // SE bas
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setIndex([0,2,1, 1,2,3]);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0x3a6e2f, roughness: 0.9, side: THREE.DoubleSide,
    }));
    mesh.receiveShadow = mesh.castShadow = true;
    mesh.name = 'terrain-demo';
    this._scene.add(mesh);
    this._topMesh  = mesh;

    // Outline demo
    const pts = [
      new THREE.Vector3(-w, h + 2.1, d),
      new THREE.Vector3( w, h + 2.1, d),
      new THREE.Vector3( w, h + 0.1, -d),
      new THREE.Vector3(-w, h + 0.1, -d),
      new THREE.Vector3(-w, h + 2.1, d),
    ];
    this._scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x00d4ff, opacity: 0.7, transparent: true })
    ));

    // Stocker pour slopes
    this._scaledPts = [
      { x: -w, z: d,  y: h + 2 },
      { x:  w, z: d,  y: h + 2 },
      { x:  w, z: -d, y: h },
      { x: -w, z: -d, y: h },
    ];
  },

  // ─── ORTHOPHOTO IGN (WMS EPSG:3857) ────────────────────────────
  async _loadOrthoIGN(mesh, wgsBounds) {
    try {
      await BILTerrain._ensureProj4();
      // Convertir WGS84 → Web Mercator (3857) pour le WMS
      if (!proj4.defs['EPSG:3857'])
        proj4.defs('EPSG:3857', '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +no_defs');

      const sw3857 = proj4('EPSG:4326', 'EPSG:3857', [wgsBounds.west, wgsBounds.south]);
      const ne3857 = proj4('EPSG:4326', 'EPSG:3857', [wgsBounds.east, wgsBounds.north]);
      const bbox = `${sw3857[0]},${sw3857[1]},${ne3857[0]},${ne3857[1]}`;

      // Résolution ~0.5m/pixel, cap à 2048px
      const spanX = ne3857[0] - sw3857[0];
      const spanY = ne3857[1] - sw3857[1];
      const maxPx = 2048;
      const pxSize = 0.5;
      let W = Math.min(maxPx, Math.ceil(spanX / pxSize));
      let H = Math.min(maxPx, Math.ceil(spanY / pxSize));

      const params = new URLSearchParams({
        SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap',
        LAYERS: 'ORTHOIMAGERY.ORTHOPHOTOS',
        STYLES: '', CRS: 'EPSG:3857',
        BBOX: bbox, WIDTH: String(W), HEIGHT: String(H),
        FORMAT: 'image/jpeg',
      });
      const url = `https://data.geopf.fr/wms-r?${params.toString()}`;

      const tex = await new Promise((resolve, reject) => {
        const loader = new THREE.TextureLoader();
        loader.crossOrigin = 'anonymous';
        loader.load(url, t => {
          t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
          t.minFilter = THREE.LinearMipmapLinearFilter;
          t.magFilter = THREE.LinearFilter;
          t.anisotropy = 4;
          resolve(t);
        }, undefined, reject);
      });

      this._textures.ortho = tex;
      mesh.material.map = tex;
      mesh.material.color.set(0xffffff);
      mesh.material.needsUpdate = true;
      this._orthoLoaded = true;
      this._textureMode = 'ortho';
      console.log(`[Terrain3D] Orthophoto IGN ${W}×${H}px chargée`);
    } catch (err) {
      console.warn('[Terrain3D] Orthophoto IGN indisponible:', err.message);
      // Fallback Mapbox satellite
      if (this.MAPBOX_TOKEN && this._parcelData?.lng) {
        await this._loadSatFallback(mesh);
      } else {
        mesh.material.map = this._makeTerrainTexture();
        mesh.material.needsUpdate = true;
      }
    }
  },

  // ─── FALLBACK SATELLITE MAPBOX ────────────────────────────────
  async _loadSatFallback(mesh) {
    const t = this._parcelData;
    const bb = new THREE.Box3().setFromObject(mesh);
    const sf = this._terrainSF ?? 1;
    const spanM = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / sf;
    const mg = 0.15;
    const halfDeg = spanM / 111320 / 2 * (1 + mg);
    const w = t.lng - halfDeg, e = t.lng + halfDeg;
    const s = t.lat - halfDeg, n = t.lat + halfDeg;
    const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/[${w.toFixed(6)},${s.toFixed(6)},${e.toFixed(6)},${n.toFixed(6)}]/640x640@2x?access_token=${this.MAPBOX_TOKEN}`;
    return new Promise(resolve => {
      new THREE.TextureLoader().load(url, tex => {
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearFilter;
        this._textures.satellite = tex;
        mesh.material.map = tex;
        mesh.material.color.set(0xffffff);
        mesh.material.needsUpdate = true;
        this._textureMode = 'satellite';
        resolve();
      }, undefined, () => {
        mesh.material.map = this._makeTerrainTexture();
        mesh.material.needsUpdate = true;
        resolve();
      });
    });
  },

  _makeTerrainTexture() {
    const cv  = document.createElement('canvas');
    cv.width  = cv.height = 256;
    const ctx = cv.getContext('2d');
    const grd = ctx.createLinearGradient(0, 0, 256, 256);
    grd.addColorStop(0, '#3a6e2f');
    grd.addColorStop(1, '#1e4015');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(cv);
  },

  // ─── COLORATION PAR ALTITUDE ──────────────────────────────────
  _buildElevationColors(mesh) {
    const pos = mesh.geometry.attributes.position;
    if (!pos) return;
    const count = pos.count;
    const colors = new Float32Array(count * 3);

    // Trouver min/max Z (altitude)
    let zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i < count; i++) {
      const z = pos.getZ(i);
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
    const range = zMax - zMin || 1;

    // Palette : bleu-vert → vert → jaune → orange → rouge
    const palette = [
      [0.12, 0.56, 0.60],  // 0.0 — bleu-vert
      [0.22, 0.62, 0.30],  // 0.25 — vert
      [0.55, 0.75, 0.20],  // 0.5 — vert-jaune
      [0.90, 0.70, 0.15],  // 0.75 — orange
      [0.85, 0.25, 0.15],  // 1.0 — rouge
    ];
    const lerpColor = (t) => {
      const idx = Math.min(t * (palette.length - 1), palette.length - 1.001);
      const lo = Math.floor(idx), hi = lo + 1;
      const f = idx - lo;
      return palette[lo].map((v, i) => v + (palette[hi][i] - v) * f);
    };

    for (let i = 0; i < count; i++) {
      const t = (pos.getZ(i) - zMin) / range;
      const [r, g, b] = lerpColor(t);
      colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
    }

    this._textures._elevColors = colors;
  },

  // ─── COLORATION PAR PENTE ─────────────────────────────────────
  _buildSlopeColors(mesh) {
    const geom = mesh.geometry;
    if (!geom.attributes.normal) geom.computeVertexNormals();
    const norm = geom.attributes.normal;
    const count = norm.count;
    const colors = new Float32Array(count * 3);

    // Classification 5 classes GIEP (SlopesService) : pente en % → couleur
    // Les normales sont dans l'espace BIL (pré-scale). Avec scale.z = sf*VEXAG,
    // la pente réelle = tan(angle_exag) / VEXAG. On corrige ici.
    const vexag = this.VERTICAL_EXAG || 0.4;
    for (let i = 0; i < count; i++) {
      // BIL mesh : Z = altitude, normal.z = composante verticale
      const nz = Math.abs(norm.getZ(i));
      // Pente géométrique brute (sans scale)
      const slopePctRaw = nz > 0.999 ? 0 : Math.tan(Math.acos(Math.min(nz, 1))) * 100;
      // Les normales du BIL ne sont pas affectées par le scale Three.js
      // donc slopePctRaw = pente réelle (1:1). Pas besoin de corriger par VEXAG ici.
      const slopePct = slopePctRaw;

      const cat = SlopesService.classify(slopePct);
      const hex = cat.color;
      const r = ((hex >> 16) & 0xff) / 255;
      const g = ((hex >> 8) & 0xff) / 255;
      const b = (hex & 0xff) / 255;

      colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
    }

    this._textures._slopeColors = colors;
  },

  // ─── SWITCH MODE TEXTURE ──────────────────────────────────────
  setTextureMode(mode) {
    if (!this._topMesh) return;
    const mesh = this._topMesh;
    const mat = mesh.material;
    this._textureMode = mode;

    if (mode === 'ortho' && this._textures.ortho) {
      mat.map = this._textures.ortho;
      mat.vertexColors = false;
      mat.color.set(0xffffff);
      mesh.geometry.deleteAttribute('color');
    } else if (mode === 'satellite' && this._textures.satellite) {
      mat.map = this._textures.satellite;
      mat.vertexColors = false;
      mat.color.set(0xffffff);
      mesh.geometry.deleteAttribute('color');
    } else if (mode === 'elevation' && this._textures._elevColors) {
      mat.map = null;
      mat.vertexColors = true;
      mat.color.set(0xffffff);
      mesh.geometry.setAttribute('color',
        new THREE.BufferAttribute(this._textures._elevColors, 3));
    } else if (mode === 'slope' && this._textures._slopeColors) {
      mat.map = null;
      mat.vertexColors = true;
      mat.color.set(0xffffff);
      mesh.geometry.setAttribute('color',
        new THREE.BufferAttribute(this._textures._slopeColors, 3));
    } else {
      // Fallback vert
      mat.map = null;
      mat.vertexColors = false;
      mat.color.set(0x4a7c3f);
    }
    mat.needsUpdate = true;
  },

  // ─── GABARIT EXTRUDÉ ──────────────────────────────────────────
  _buildGabarit() {
    const p7 = this._session?.phases?.[7]?.data ?? {};
    const L  = parseFloat(p7.gabarit_l_m ?? 10);
    const W  = parseFloat(p7.gabarit_w_m ?? 8);
    const H  = parseFloat(p7.gabarit_h_m ?? 6);

    if (this._gabaritMesh) {
      this._scene.remove(this._gabaritMesh);
      this._gabaritMesh.geometry.dispose();
    }

    const sf   = this._terrainSF ?? 1;
    const scL  = L * sf;
    const scW  = W * sf;
    const scH  = H * sf * 0.3;   // Exagération verticale cohérente

    // Position sur le terrain (centre + hauteur terrain)
    const terrainY = this.EXTRUDE_DEPTH + 0.5;
    const geo      = new THREE.BoxGeometry(scL, scH, scW);
    const mat      = new THREE.MeshStandardMaterial({
      color: 0x00d4ff, roughness: 0.6, metalness: 0.1,
      transparent: true, opacity: 0.55,
      side: THREE.DoubleSide,
    });
    this._gabaritMesh = new THREE.Mesh(geo, mat);
    this._gabaritMesh.position.set(0, terrainY + scH / 2, 0);
    this._gabaritMesh.castShadow    = true;
    this._gabaritMesh.receiveShadow = true;
    this._gabaritMesh.name = 'gabarit';

    // Wireframe du gabarit
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x00d4ff, opacity: 0.9, transparent: true })
    );
    this._gabaritMesh.add(wire);
    this._scene.add(this._gabaritMesh);

    // Label dimensions au-dessus
    this._makeGabaritLabel(scL, scH, scW, L, W, H);
  },

  _makeGabaritLabel(scL, scH, scW, L, W, H) {
    const cv  = document.createElement('canvas');
    cv.width  = 256; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(0,10,20,0.85)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = '#9a7820';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 254, 62);
    ctx.fillStyle = '#9a7820';
    ctx.font = 'bold 18px Inconsolata, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${L}m \u00d7 ${W}m \u00d7 H${H}m`, 128, 32);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(cv), depthTest: false,
    }));
    sp.position.set(0, this.EXTRUDE_DEPTH + scH + 3, 0);
    sp.scale.set(14, 4, 1);
    sp.name = 'gabarit-label';
    this._scene.add(sp);
  },

  // ─── COURBES DE NIVEAU 3D ──────────────────────────────────────
  async _buildContours() {
    const t = this._parcelData;
    if (!t?.parcelle_geojson) return;

    // Nettoyer si existant
    if (this._contourGroup) {
      this._contourGroup.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
      this._scene.remove(this._contourGroup);
      this._contourGroup = null;
    }

    const geom = t.parcelle_geojson;
    const coords = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
    const lngs = coords.map(c => c[0]), lats = coords.map(c => c[1]);
    const margin = 0.001; // ~100m de marge
    const wgsBounds = {
      west:  Math.min(...lngs) - margin,
      east:  Math.max(...lngs) + margin,
      south: Math.min(...lats) - margin,
      north: Math.max(...lats) + margin,
    };

    try {
      const contourData = await ContourService.fromBIL(wgsBounds, { pixelSizeM: 2, maxDim: 200 });
      if (!contourData.lines.length) return;

      // On a besoin des coordonnées UTM centrées comme le mesh BIL
      await window.BILTerrain._ensureProj4();
      const sw = proj4('EPSG:4326', 'EPSG:2975', [wgsBounds.west, wgsBounds.south]);
      const ne = proj4('EPSG:4326', 'EPSG:2975', [wgsBounds.east, wgsBounds.north]);
      const cX = (sw[0] + ne[0]) / 2, cY = (sw[1] + ne[1]) / 2;
      const utmBounds = { minX: sw[0], minY: sw[1], maxX: ne[0], maxY: ne[1], cX, cY };

      this._contourGroup = ContourService.toThreeGroup(contourData, utmBounds, {
        scaleZ: 1.0,
        labels: true,
      });
      this._contourGroup.visible = this._showContours;
      this._scene.add(this._contourGroup);
      console.log(`[Terrain3D] ${contourData.lines.length} courbes de niveau (interval ${contourData.interval}m)`);
    } catch (err) {
      console.warn('[Terrain3D] Courbes de niveau indisponibles:', err.message);
    }
  },

  // ─── FLÈCHES DE PENTE ─────────────────────────────────────────
  _buildSlopeArrows() {
    if (this._slopeArrows) {
      this._slopeArrows.forEach(a => this._scene.remove(a));
    }
    this._slopeArrows = [];

    const pts = this._scaledPts;
    if (!pts || pts.length < 3) return;

    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];

      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dy = (b.y ?? this.EXTRUDE_DEPTH) - (a.y ?? this.EXTRUDE_DEPTH);
      const horiz = Math.hypot(dx, dz);
      if (horiz < 0.5) continue;

      // dy et horiz sont dans l'espace world (scaledPts), VEXAG déjà inclus dans dy
      // pente réelle = (dy / VEXAG) / horiz * 100
      const pctPente = Math.abs(dy / horiz) * 100 / this.VERTICAL_EXAG;

      // Classification 5 classes GIEP (SlopesService)
      const cat   = SlopesService.classify(pctPente);
      const color = cat.color;

      // Midpoint
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      const my = ((a.y ?? this.EXTRUDE_DEPTH) + (b.y ?? this.EXTRUDE_DEPTH)) / 2 + 1;

      // Flèche = cone + tige
      const arrowLen = Math.min(horiz * 0.6, 8);
      const angle    = Math.atan2(dz, dx);

      const shaftGeo  = new THREE.CylinderGeometry(0.12, 0.12, arrowLen * 0.7, 6);
      const coneGeo   = new THREE.ConeGeometry(0.35, arrowLen * 0.3, 6);
      const mat       = new THREE.MeshBasicMaterial({ color });

      const arrow = new THREE.Group();
      const shaft = new THREE.Mesh(shaftGeo, mat);
      shaft.rotation.z = -Math.PI / 2;
      shaft.position.x = arrowLen * 0.35;
      arrow.add(shaft);

      const cone = new THREE.Mesh(coneGeo, mat);
      cone.rotation.z = -Math.PI / 2;
      cone.position.x = arrowLen * 0.85;
      arrow.add(cone);

      arrow.position.set(mx, my, -mz);
      arrow.rotation.y = -angle;
      arrow.name = 'slope-arrow';
      this._scene.add(arrow);
      this._slopeArrows.push(arrow);

      // Label pente — pill avec classification 5 classes
      const lv = document.createElement('canvas');
      lv.width = 200; lv.height = 64;
      const lx = lv.getContext('2d');
      const hexColor = '#' + color.toString(16).padStart(6, '0');
      // Fond pill arrondi
      lx.fillStyle = 'rgba(0,0,0,0.75)';
      lx.beginPath();
      lx.roundRect(4, 4, 192, 56, 12);
      lx.fill();
      // Barre couleur latérale
      lx.fillStyle = hexColor;
      lx.fillRect(4, 4, 6, 56);
      // Texte pente
      lx.fillStyle = hexColor;
      lx.font = 'bold 22px Inconsolata, monospace';
      lx.textAlign = 'center';
      lx.textBaseline = 'top';
      lx.fillText(pctPente.toFixed(1) + '%', 104, 8);
      // Classification label
      lx.fillStyle = 'rgba(255,255,255,0.7)';
      lx.font = '13px Inter, sans-serif';
      lx.fillText(cat.label, 104, 36);

      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(lv), depthTest: false, transparent: true, opacity: 0.92,
      }));
      sp.position.set(mx, my + 2, -mz);
      sp.scale.set(8, 3, 1);
      sp.name = 'slope-label';
      this._scene.add(sp);
      this._slopeArrows.push(sp);
    }
  },

  // ─── LABELS ALTITUDES ─────────────────────────────────────────
  _makeAltLabels(scaledPts, alts) {
    this._dimLabels.forEach(l => this._scene.remove(l));
    this._dimLabels = [];

    const n = Math.min(scaledPts.length, 4);
    for (let i = 0; i < n; i++) {
      const p   = scaledPts[i];
      const alt = alts[i] ?? '\u2014';
      const cv  = document.createElement('canvas');
      cv.width  = 180; cv.height = 72;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = 'rgba(8,10,18,0.90)';
      ctx.fillRect(0, 0, 180, 72);
      ctx.strokeStyle = '#9a7820';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(1.5, 1.5, 177, 69);
      ctx.fillStyle = '#9a7820';
      ctx.font = 'bold 22px Inconsolata, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(parseFloat(alt).toFixed(1) + ' m', 90, 36);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(cv), depthTest: false,
      }));
      sp.position.set(p.x, (p.y ?? this.EXTRUDE_DEPTH) + 5, -(p.z ?? 0));
      sp.scale.set(9, 4, 1);
      sp.name = 'alt-label';
      this._scene.add(sp);
      this._dimLabels.push(sp);
    }
  },

  // ─── COTATIONS ────────────────────────────────────────────────
  _makeDims(scaledPts, localPts, sf) {
    const xs  = scaledPts.map(p => p.x);
    const zs  = scaledPts.map(p => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const realW = (maxX - minX) / sf;
    const realD = (maxZ - minZ) / sf;
    const h = this.EXTRUDE_DEPTH + 4;

    const dimMat = new THREE.LineDashedMaterial({ color: 0x6a8aaa, dashSize: 0.8, gapSize: 0.4, opacity: 0.7, transparent: true });

    // Largeur (X)
    const lW = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(minX, h, -(minZ - 4)),
      new THREE.Vector3(maxX, h, -(minZ - 4)),
    ]), dimMat);
    lW.computeLineDistances();
    lW.name = 'dim';
    this._scene.add(lW);
    this._dimLabels.push(lW);

    // Profondeur (Z)
    const lD = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(maxX + 4, h, -minZ),
      new THREE.Vector3(maxX + 4, h, -maxZ),
    ]), dimMat);
    lD.computeLineDistances();
    lD.name = 'dim';
    this._scene.add(lD);
    this._dimLabels.push(lD);

    // Labels
    const addLabel = (text, x, y, z) => {
      const cv  = document.createElement('canvas');
      cv.width  = 160; cv.height = 56;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = 'rgba(8,10,18,0.85)';
      ctx.fillRect(0, 0, 160, 56);
      ctx.fillStyle = '#6b5c3e';
      ctx.font = '16px Inconsolata, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 80, 28);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true, opacity: 0.85,
      }));
      sp.position.set(x, y, z);
      sp.scale.set(8, 3, 1);
      sp.name = 'dim-label';
      this._scene.add(sp);
      this._dimLabels.push(sp);
    };

    addLabel(realW.toFixed(1) + ' m', (minX + maxX) / 2, h, -(minZ - 6));
    addLabel(realD.toFixed(1) + ' m', maxX + 7, h, -(minZ + maxZ) / 2);
  },

  // ─── SOLEIL 3D ────────────────────────────────────────────────
  _updateSun() {
    if (!this._sunLight) return;
    const sun = SunCalcService.getPosition(this._sunHour, this._sunDay, -21.1);
    const r   = this._heliodonRadius ?? 80;
    const alt = sun.altitude * Math.PI / 180;
    const azi = (sun.azimuth + 180) * Math.PI / 180;  // + 180 car hémisphère sud

    const sx = r * Math.cos(alt) * Math.sin(azi);
    const sy = r * Math.sin(alt);
    const sz = r * Math.cos(alt) * Math.cos(azi);

    this._sunLight.position.set(sx, sy, sz);
    this._sunLight.target.position.set(0, this.EXTRUDE_DEPTH, 0);
    this._sunLight.intensity = Math.max(0.1, sun.altitude / 90) * 1.6;

    // Couleur du soleil selon heure (chaud le matin/soir, blanc à midi)
    const t = Math.abs(this._sunHour - 12) / 6;
    this._sunLight.color.setRGB(1, 1 - t * 0.24, 1 - t * 0.47);

    // Mettre à jour sphère soleil si hélidon actif
    if (this._sunSphere) {
      this._sunSphere.position.set(sx, sy, sz);
      this._sunHelper?.position.set(sx, 0, sz); // projection au sol
    }
  },

  // ─── HÉLIDON 3D — Parcours solaire La Réunion ─────────────────
  // Source : web-app SunPathBimshow.js (porté vanilla Three.js)
  // Arcs solstice été (rouge), hiver (bleu), équinoxe (vert) + sphère soleil
  _heliodonVisible: false,

  toggleHeliodon(on) {
    this._heliodonVisible = on ?? !this._heliodonVisible;
    if (this._heliodonVisible && !this._heliodonGroup) {
      this._buildHeliodon();
    }
    if (this._heliodonGroup) {
      this._heliodonGroup.visible = this._heliodonVisible;
    }
  },

  _buildHeliodon() {
    // Rayon du dôme = 1.4× bbox terrain (source SunPathBimshow.js L.42)
    const target = this._terrainGroup ?? this._topMesh;
    let radius = 60;
    if (target) {
      const sz = new THREE.Box3().setFromObject(target).getSize(new THREE.Vector3());
      radius = Math.max(sz.x, sz.y, sz.z) * 1.4;
    }
    this._heliodonRadius = radius;
    this._heliodonGroup = new THREE.Group();
    this._heliodonGroup.name = 'heliodon';

    // Dates clés : solstice été (172), hiver (355), équinoxe (80)
    const arcs = [
      { day: 172, color: 0xff4444, label: 'Solstice été (21 juin)' },
      { day:  80, color: 0x44ff44, label: 'Équinoxe (21 mars)' },
      { day: 355, color: 0x4488ff, label: 'Solstice hiver (21 déc.)' },
    ];

    for (const arc of arcs) {
      const pts = [];
      // Tracer la course du soleil heure par heure
      for (let h = 5; h <= 19; h += 0.25) {
        const sun = SunCalcService.getPosition(h, arc.day, -21.1);
        if (sun.altitude <= 0) continue;
        const alt = sun.altitude * Math.PI / 180;
        const azi = (sun.azimuth + 180) * Math.PI / 180;
        pts.push(new THREE.Vector3(
          radius * Math.cos(alt) * Math.sin(azi),
          radius * Math.sin(alt),
          radius * Math.cos(alt) * Math.cos(azi),
        ));
      }
      if (pts.length < 2) continue;

      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geom, new THREE.LineBasicMaterial({
        color: arc.color, linewidth: 2, transparent: true, opacity: 0.7,
      }));
      line.name = `sun-arc-${arc.day}`;
      this._heliodonGroup.add(line);

      // Label au zénith de l'arc
      const midPt = pts[Math.floor(pts.length / 2)];
      const lbl = this._makeTextSprite(arc.label, arc.color, 0.6);
      lbl.position.copy(midPt).multiplyScalar(1.08);
      this._heliodonGroup.add(lbl);
    }

    // Marqueurs horaires sur l'arc d'équinoxe
    for (let h = 6; h <= 18; h++) {
      const sun = SunCalcService.getPosition(h, 80, -21.1);
      if (sun.altitude <= 0) continue;
      const alt = sun.altitude * Math.PI / 180;
      const azi = (sun.azimuth + 180) * Math.PI / 180;
      const pt = new THREE.Vector3(
        radius * Math.cos(alt) * Math.sin(azi),
        radius * Math.sin(alt),
        radius * Math.cos(alt) * Math.cos(azi),
      );
      // Petit point
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 0.008, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      );
      dot.position.copy(pt);
      this._heliodonGroup.add(dot);
      // Label heure
      const hl = this._makeTextSprite(`${h}h`, 0xffffff, 0.4);
      hl.position.copy(pt).multiplyScalar(1.06);
      this._heliodonGroup.add(hl);
    }

    // Sphère soleil (position courante)
    this._sunSphere = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.03, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffdd00 }),
    );
    this._sunSphere.name = 'sun-sphere';
    this._heliodonGroup.add(this._sunSphere);

    // Projection au sol (helper vertical)
    const helperGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0),
    ]);
    this._sunHelper = new THREE.Line(helperGeo, new THREE.LineBasicMaterial({
      color: 0xffdd00, transparent: true, opacity: 0.3,
    }));
    this._sunHelper.name = 'sun-helper';
    this._heliodonGroup.add(this._sunHelper);

    // Cercle horizon (anneau au sol)
    const horizPts = [];
    for (let a = 0; a <= Math.PI * 2; a += 0.05) {
      horizPts.push(new THREE.Vector3(
        radius * Math.cos(a), 0, radius * Math.sin(a),
      ));
    }
    const horizLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(horizPts),
      new THREE.LineBasicMaterial({ color: 0x666666, transparent: true, opacity: 0.25 }),
    );
    horizLine.name = 'horizon-ring';
    this._heliodonGroup.add(horizLine);

    // Cardinalités (N, S, E, O)
    const cards = [
      { lbl: 'N', a: Math.PI },
      { lbl: 'S', a: 0 },
      { lbl: 'E', a: Math.PI / 2 },
      { lbl: 'O', a: -Math.PI / 2 },
    ];
    for (const cd of cards) {
      const sp = this._makeTextSprite(cd.lbl, 0xaaaaaa, 0.5);
      sp.position.set(
        (radius + 3) * Math.sin(cd.a), 1, (radius + 3) * Math.cos(cd.a),
      );
      this._heliodonGroup.add(sp);
    }

    this._scene.add(this._heliodonGroup);
    this._updateSun(); // positionner la sphère soleil
  },

  _makeTextSprite(text, color, scale) {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 48;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath(); ctx.roundRect(2, 2, 124, 44, 8); ctx.fill();
    ctx.fillStyle = '#' + (color & 0xffffff).toString(16).padStart(6, '0');
    ctx.font = 'bold 18px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 24);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true,
    }));
    sp.scale.set(8 * scale, 3 * scale, 1);
    return sp;
  },

  // ─── CENTRER CAMÉRA — fitToView exact basé sur FOV ────────────
  // Source : web-app smart-photo-utils.ts computeFitDistance
  _centerCamera() {
    const target = this._terrainGroup ?? this._topMesh;
    if (!target || !this._controls) return;

    const box  = new THREE.Box3().setFromObject(target);
    const c    = box.getCenter(new THREE.Vector3());
    const sz   = box.getSize(new THREE.Vector3());

    // Distance optimale pour remplir ~80% du viewport
    const fovRad = this._cam.fov * Math.PI / 180;
    const aspect = this._cam.aspect || 1;
    const margin = 0.80;
    const dVert  = (sz.y * margin) / (2 * Math.tan(fovRad / 2));
    const dHoriz = (Math.max(sz.x, sz.z) * margin) / (2 * Math.tan(fovRad / 2) * aspect);
    const dist   = Math.max(dVert, dHoriz, 10);

    // Vue 3/4 — léger décalage pour montrer le relief
    const dir = new THREE.Vector3(0.6, 0.5, 0.7).normalize();
    this._controls.target.copy(c);
    this._cam.position.copy(c).addScaledVector(dir, dist);
    this._cam.lookAt(c);
    this._controls.update();

    // Ajuster frustum ombres à la taille du terrain
    this._fitShadowFrustum(box);
  },

  // ─── AJUSTER FRUSTUM OMBRES AU TERRAIN ──────────────────────
  _fitShadowFrustum(box) {
    if (!this._sunLight?.shadow) return;
    const sz   = box.getSize(new THREE.Vector3());
    const half = Math.max(sz.x, sz.y, sz.z) * 0.8;
    const cam  = this._sunLight.shadow.camera;
    cam.left   = -half;
    cam.right  =  half;
    cam.top    =  half;
    cam.bottom = -half;
    cam.far    = half * 4;
    cam.updateProjectionMatrix();
  },

  // ─── LOOP DE RENDU ────────────────────────────────────────────
  _startLoop() {
    const render = () => {
      this._animId = requestAnimationFrame(render);
      this._controls?.update();
      // Update uniforms billboards vegetation
      if (this._vegetationMats.length && this._cam) {
        for (const m of this._vegetationMats) {
          m.uniforms.uCameraPos.value.copy(this._cam.position);
        }
      }
      this._renderer.render(this._scene, this._cam);
    };
    render();
  },

  // ─── CONTRÔLES PUBLICS ────────────────────────────────────────
  setView(mode) {
    this._mode = mode;
    const ctrl  = this._controls;
    if (!ctrl || !this._cam) return;
    const t = ctrl.target.clone();
    const d = 60;
    if (mode === 'top')   this._cam.position.set(t.x, t.y + d, t.z);
    if (mode === 'front') this._cam.position.set(t.x, t.y + 20, t.z + d);
    if (mode === 'orbit') this._cam.position.set(t.x + d * 0.7, t.y + d * 0.5, t.z + d * 0.7);
    this._cam.lookAt(t);
    ctrl.update();
  },

  toggleSlopes(on) {
    this._showSlopes = on ?? !this._showSlopes;
    this._slopeArrows?.forEach(a => { a.visible = this._showSlopes; });
  },

  toggleContours(on) {
    this._showContours = on ?? !this._showContours;
    if (this._contourGroup) this._contourGroup.visible = this._showContours;
  },

  toggleDims(on) {
    this._showDims = on ?? !this._showDims;
    this._dimLabels.forEach(l => { l.visible = this._showDims; });
  },

  setSunHour(h) {
    this._sunHour = parseFloat(h);
    this._updateSun();
  },

  setSunDay(d) {
    this._sunDay = parseInt(d);
    this._updateSun();
  },

  updateGabarit() {
    this._buildGabarit();
  },

  // ─── INJECTER UN MESH TIN TERRAIN (depuis TerrainMeshBuilder) ──
  addTerrainTIN(mesh) {
    if (!this._scene) { console.warn('[Terrain3D] Scene non initialisee'); return; }

    // Supprimer l'ancien TIN s'il existe
    const old = this._scene.getObjectByName('TerrainTIN');
    if (old) { this._scene.remove(old); old.geometry?.dispose(); old.material?.dispose(); }

    // Adapter l'echelle au SCALE_FACTOR de la scene
    if (mesh.geometry?.boundingBox) {
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      const maxSpan = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) || 1;
      const s = (this.SCALE_FACTOR * 0.8) / maxSpan;
      mesh.scale.set(s, s * (this.VERTICAL_EXAG ?? 0.4), s);
      mesh.position.set(0, 0, 0);
    }

    mesh.name = 'TerrainTIN';
    this._scene.add(mesh);
    console.log('[Terrain3D] TIN mesh ajoute a la scene');
  },

  // ─── EXPORT GLB ────────────────────────────────────────────────
  async exportGLB() {
    // Exporter terrain + gabarit dans un groupe temporaire
    const group = new THREE.Group();
    if (this._terrainGroup) group.add(this._terrainGroup.clone());
    if (this._gabaritMesh)  group.add(this._gabaritMesh.clone());
    if (this._contourGroup) group.add(this._contourGroup.clone());

    if (group.children.length === 0)
      return window.TerlabToast?.show('Pas de terrain \u00e0 exporter', 'warning');

    try {
      const ref = this._session?.terrain?.parcelle ?? 'terrain';
      const commune = this._session?.terrain?.commune ?? '';
      const name = `TERLAB_${commune}_${ref}`.replace(/\s+/g, '_');
      await GLBExporter.download(group, name);
    } catch (e) {
      console.error('[Terrain3D] Export GLB:', e);
      window.TerlabToast?.show('Export GLB non disponible', 'warning');
    }
  },

  getTextureMode() { return this._textureMode; },

  // ─── CAPTURE SCREENSHOT ───────────────────────────────────────
  capture(opts = {}) {
    if (!this._renderer) return null;
    // Recadrer avant capture pour éviter le terrain minuscule dans le PDF
    if (opts.reframe !== false) this._centerCamera();
    // Forcer un rendu frais
    this._renderer.render(this._scene, this._cam);
    return this._renderer.domElement.toDataURL('image/jpeg', 0.92);
  },

  // ─── DESTROY ─────────────────────────────────────────────────
  destroy() {
    cancelAnimationFrame(this._animId);
    this._renderer?.dispose();
    this._renderer = null;
    this._scene    = null;
  },

  // ─── UTILS ───────────────────────────────────────────────────
  _updateSize() {
    if (!this._renderer || !this._canvas) return;
    const p = this._canvas.parentElement;
    if (!p) return;
    const w = p.clientWidth, h = p.clientHeight;
    this._renderer.setSize(w, h);
    if (this._cam) {
      this._cam.aspect = w / h;
      this._cam.updateProjectionMatrix();
    }
  },

  _disposeGroup(g) {
    if (!g) return;
    g.traverse(o => {
      o.geometry?.dispose();
      if (Array.isArray(o.material)) o.material.forEach(m => m?.dispose());
      else o.material?.dispose();
    });
    this._scene?.remove(g);
  },

  // ─── VEGETATION : IMPOSTORS OCTAHEDRAL ─────────────────────────
  // Atlases webp 2048x1024 (4 colonnes x 2 lignes, 8 vues a 45 deg)
  // Fournis par BPF via ImpostorLoader, mappes dans bpf-species-reunion.json

  async setVegetation(plants) {
    if (!this._scene) return;

    // Nettoyage precedent
    if (this._vegetationGroup) {
      this._disposeGroup(this._vegetationGroup);
      this._vegetationGroup = null;
    }
    this._vegetationMats = [];

    if (!plants?.length) return;
    if (!window.ImpostorLoader) { console.warn('[Terrain3D] ImpostorLoader indisponible'); return; }

    const group = new THREE.Group();
    group.name = 'vegetation';
    this._vegetationGroup = group;
    this._scene.add(group);

    const sf = this._terrainSF ?? 1;

    // Regrouper par speciesKey (1 InstancedMesh par espece)
    const bySpecies = {};
    for (const p of plants) (bySpecies[p.speciesKey] ??= []).push(p);

    for (const [speciesKey, list] of Object.entries(bySpecies)) {
      const tex = await window.ImpostorLoader.getTexture(speciesKey);
      if (!tex) continue; // Espece sans impostor : on skip (fallback SVG 2D seulement)

      const mat = this._buildImpostorMaterial(tex);
      this._vegetationMats.push(mat);

      const geo = new THREE.PlaneGeometry(1, 1);
      geo.translate(0, 0.5, 0); // Origine en bas du quad (trunk base)

      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      inst.name = `veg-${speciesKey}`;
      inst.frustumCulled = false; // Billboard face toujours camera

      const tmpMat = new THREE.Matrix4();
      const tmpQuat = new THREE.Quaternion();
      const tmpScale = new THREE.Vector3();
      const tmpPos = new THREE.Vector3();

      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        // Conversion local parcelle (m) -> world scene (Three units)
        // BpfBridge : x = east, y = south (Y inverted for SVG). Three: x = east, z = south.
        const wx = p.x * sf;
        const wz = p.y * sf;
        const wy = this._sampleTerrainY(wx, wz);

        // Taille : canopyRadius m * 2 = largeur, hauteur ~ 2.2 x canopyRadius pour l'aspect arbre
        const radM = p.canopyRadius ?? 2;
        const sw = radM * 2 * sf;
        const sh = radM * 2.2 * sf;

        tmpPos.set(wx, wy, wz);
        tmpScale.set(sw, sh, 1);
        tmpQuat.set(0, 0, 0, 1);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        inst.setMatrixAt(i, tmpMat);
      }
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
    }

    console.log(`[Terrain3D] Vegetation : ${plants.length} plantes, ${Object.keys(bySpecies).length} especes`);
  },

  _buildImpostorMaterial(atlasTex) {
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

          // Atlas 4 colonnes x 2 lignes, row 0 en haut de l'image
          vUv = vec2((uv.x + col) / 4.0, (1.0 - uv.y + row) / 2.0);

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
        }
      `,
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
  },

  _sampleTerrainY(x, z) {
    // Raycast vertical sur topMesh / terrainTIN pour trouver l'altitude du sol
    const base = this.EXTRUDE_DEPTH + 0.5;
    if (!this._scene) return base;
    const meshes = [];
    this._scene.traverse(o => {
      if (o.isMesh && (o.name === 'TerrainTIN' || o === this._topMesh)) meshes.push(o);
    });
    if (!meshes.length) return base;
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 500, z), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObjects(meshes, false);
    if (hits.length) return hits[0].point.y;
    return base;
  },

  toggleVegetation(on) {
    if (!this._vegetationGroup) return;
    this._vegetationGroup.visible = on ?? !this._vegetationGroup.visible;
  },
};

export default Terrain3D;
