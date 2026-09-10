// TERLAB · components/buildings-3d-viewer.js
// Viewer Three.js pour le contexte bâti (Phase 5 — Voisinage)
// Convertit le GeoJSON bâtiments OSM en scène 3D avec parcelle
// Intègre LiDAR IGN : terrain relief, vraies hauteurs bâtiments, arbres
// Export GLB intégré

import * as THREE from 'three';
import { OrbitControls }  from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter }   from 'three/addons/exporters/GLTFExporter.js';
import { getDeviceCaps }  from '../utils/device-caps.js';
import ImpostorLoader     from '../services/impostor-loader.js';
import { buildImpostorMaterial, updateImpostorCamera } from '../services/vegetation/impostor-billboard.js';
import { applyContactAO, applyGroundTint, makePointIndex } from '../services/vegetation/ground-effects.js';

const DEG = Math.PI / 180;

// Publier window.THREE si absent (namespace ESM gelé → clone obligatoire).
// Nécessaire pour ImpostorLoader.getTexture et les services défensifs
// quand P05 est la première scène 3D ouverte de la session.
if (typeof window !== 'undefined' && !window.THREE) {
  window.THREE = Object.assign({}, THREE);
  window.THREE.OrbitControls = OrbitControls;
}

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
  _grassMesh: null,      // InstancedMesh strate herbacée (touffes dans la parcelle)
  _plants: [],           // plantes {x, ySud, canopyRadius…} — partagées AO/herbe
  _lidarCtx: null,
  _gridHelper: null,
  _vegetationMats: [],   // ShaderMaterial[] impostors — uniform camera par rendu
  _vegSource: null,      // 'P06' | 'LiDAR' (affiché dans le toast)
  _needsRender: true,    // rendu à la demande (batterie mobile)

  // ─── INIT ─────────────────────────────────────────────────────
  async init(canvasId, sessionData) {
    if (this._inited) return;
    this._session = sessionData;

    const canvas = document.getElementById(canvasId);
    if (!canvas) return console.error('[Buildings3D] Canvas introuvable:', canvasId);
    this._canvas = canvas;

    // Renderer
    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, getDeviceCaps().pixelRatioCap));
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
    const veg = this._vegSource ? ` · végétation : ${this._vegSource}` : '';
    window.TerlabToast?.show(`Vue 3D bâtiments chargée — hauteurs : ${src}${veg}`, 'success', 2500);
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

    // 5. Végétation (P06 validée si présente, sinon arbres LiDAR)
    //    → pose aussi l'AO de contact + la teinte d'humus sur le terrain LiDAR
    await this._buildVegetation();

    // 6. Strate herbacée (indépendante de la présence d'arbres)
    await this._buildGrass();
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
      // Le flag lidar_available n'existe que si l'étudiant a fait P01 avant
      // le voisinage : en son absence, on interroge directement la couverture
      // LiDAR HD (HEAD sur une dalle témoin) plutôt que de renoncer.
      const SM = window.SessionManager;
      const p1data = SM?.getPhase?.(1)?.data;
      if (!p1data?.lidar_available) {
        const avail = await LS.isAvailable?.().catch(() => false);
        if (!avail) return; // Vraiment pas de LiDAR → comportement actuel
      }

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
    // Arbres : construits par _buildVegetation() (étape 5 de _buildScene)
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

  // ─── VÉGÉTATION ──────────────────────────────────────────────
  // Source prioritaire : végétation P06 (lecture SEULE — P05 n'écrit jamais
  // dans VegetationState, la validation reste le geste de l'étudiant en P06).
  // Sinon : arbres LiDAR détectés par LidarContextService (classes 4/5).
  // Rendu : impostors octahedral par espèce (InstancedMesh) ; les espèces
  // sans atlas retombent sur les primitives tronc+couronne — rien ne
  // disparaît silencieusement.
  // @coords espace unifié : x = EST (m), ySud = SUD (m) ; scène : x=x·sf,
  // z=ySud·sf (ctx.trees.z est un northing → ySud = -z).

  _speciesFromTree(t) {
    // Heuristique cohérente avec terrain-3d-viewer._detectAndPlaceTrees
    const SPECIES = ['palm_coconut', 'mango', 'flamboyant', 'tamarind',
                     'pandanus', 'terminalia_catappa', 'latania', 'plumeria'];
    const h = t.height ?? 0;
    if (h > 10) return 'flamboyant';
    if (h > 6)  return 'palm_coconut';
    if (h > 4)  return 'tamarind';
    return SPECIES[Math.floor(Math.abs(Math.sin(t.x * 100)) * SPECIES.length)];
  },

  _sampleGroundY(x, ySud, groundAltHint) {
    const sf = this._sf, ve = this.VERTICAL_EXAG;
    const ctx = this._lidarCtx;
    if (groundAltHint != null && ctx) return (groundAltHint - ctx.groundZ) * sf * ve;
    const LCS = window.LidarContextService;
    if (ctx?.mnt && LCS) {
      // Piège documenté (earthworks-service.js:11) : sampleMNT attend un
      // northing local → flip Y obligatoire (ySud = -z_nord)
      const alt = LCS.sampleMNT(ctx.mnt, x, -ySud);
      if (Number.isFinite(alt)) return (alt - ctx.groundZ) * sf * ve;
    }
    return 0;
  },

  async _buildVegetation() {
    const ctx = this._lidarCtx;
    let plants = [];

    // 1. Végétation P06 si l'étudiant l'a déjà générée/validée
    const feats = this._session?.phases?.p06?.vegetation?.features;
    if (feats?.length) {
      this._vegSource = 'P06';
      plants = feats
        .filter(f => f.status !== 'existing_cut')
        .map(f => ({
          x: f.positionLocal?.x ?? 0,
          ySud: f.positionLocal?.y ?? 0,
          speciesKey: f.speciesKey ?? 'palm_coconut',
          canopyRadius: f.canopyRadiusMeasured ?? 3,
          height: f.heightMeasured,
          groundAlt: null,
        }));
    } else if (ctx?.trees?.length) {
      // 2. Sinon : arbres LiDAR bruts (visualisation éphémère, rien n'est persisté)
      this._vegSource = 'LiDAR';
      plants = ctx.trees.map(t => ({
        x: t.x,
        ySud: -t.z,
        speciesKey: this._speciesFromTree(t),
        canopyRadius: Math.max(1.5, Math.min(5, t.radiusM ?? (t.height ?? 6) * 0.35)),
        height: t.height,
        groundAlt: t.groundAlt,
      }));
    }
    // Mémorisé même vide : _buildGrass() s'en sert pour dégager le pied des
    // sujets, et il tourne que la végétation ait été construite ou non.
    this._plants = plants;
    if (!plants.length) return;

    const sf = this._sf, ve = this.VERTICAL_EXAG;
    this._treesGroup = new THREE.Group();
    this._treesGroup.name = 'vegetation';
    this._vegetationMats = [];

    // Regrouper par espèce (1 InstancedMesh par espèce avec atlas)
    const bySpecies = {};
    for (const p of plants) (bySpecies[p.speciesKey] ??= []).push(p);

    let impostorCount = 0, primitiveCount = 0;
    for (const [speciesKey, list] of Object.entries(bySpecies)) {
      let tex = null;
      try { tex = await ImpostorLoader.getTexture(speciesKey); } catch { /* offline → fallback */ }

      if (tex) {
        const mat = buildImpostorMaterial(THREE, tex);
        this._vegetationMats.push(mat);
        const geo = new THREE.PlaneGeometry(1, 1);
        geo.translate(0, 0.5, 0); // origine au pied
        const inst = new THREE.InstancedMesh(geo, mat, list.length);
        inst.name = `veg-${speciesKey}`;
        inst.frustumCulled = false; // billboard : déplacement en vertex shader

        const tmpMat = new THREE.Matrix4();
        const tmpQuat = new THREE.Quaternion();
        const tmpScale = new THREE.Vector3();
        const tmpPos = new THREE.Vector3();
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          const wx = p.x * sf;
          const wz = p.ySud * sf;
          const wy = this._sampleGroundY(p.x, p.ySud, p.groundAlt);
          const radM = p.canopyRadius ?? 2;
          const sw = radM * 2 * sf;
          const sh = ((p.height && p.height > 1) ? p.height : radM * 2.2) * sf * ve;
          tmpPos.set(wx, wy, wz);
          tmpScale.set(sw, sh, 1);
          tmpQuat.set(0, 0, 0, 1);
          tmpMat.compose(tmpPos, tmpQuat, tmpScale);
          inst.setMatrixAt(i, tmpMat);
        }
        inst.instanceMatrix.needsUpdate = true;
        this._treesGroup.add(inst);
        impostorCount += list.length;
      } else {
        // Fallback primitives : espèce sans atlas → tronc + couronne
        for (const p of list) {
          this._buildTreePrimitive(p, sf, ve);
          primitiveCount++;
        }
      }
    }

    this._scene.add(this._treesGroup);
    this._applyGroundEffects(plants);
    this._needsRender = true;
    console.info(`[Buildings3D] Végétation (${this._vegSource}) : ${impostorCount} impostors + ${primitiveCount} primitives, ${Object.keys(bySpecies).length} espèces`);
  },

  // ─── EFFETS DE SOL (AO de contact + humus) ───────────────────
  // « Une plante sans ombre au pied flotte au-dessus du sol » : on assombrit
  // et on teinte les vertex colors du terrain LiDAR sous chaque canopée.
  // Sans terrain LiDAR (grille plate / parcelle ShapeGeometry sans attribut
  // color) : retour silencieux, la scène reste celle d'avant.
  //
  // @coords conversion plante → sommets du terrain — UN SEUL flip.
  //   Terrain (_buildTerrainMesh) : verts.x =  x_est   · sf
  //                                 verts.z = -z_nord  · sf
  //   Plantes  (_buildVegetation) : x = x_est, ySud = -z_nord  (le flip est
  //   posé là, une fois, à la lecture de ctx.trees.z)
  //   ⇒ scène.z d'une plante = ySud · sf  = (-z_nord) · sf  = verts.z ✔
  //   Exemple chiffré, sf = 1 (parcelle de 50 m) : un arbre à 12 m au NORD du
  //   centre a z_nord = +12 → ySud = −12 → scène z = −12 ; le sommet de
  //   terrain au même endroit a positions.z = +12 → verts.z = −12 · 1 = −12.
  //   Identiques : aucun second flip à appliquer ici (skill coord-systems).
  _applyGroundEffects(plants) {
    const geo = this._terrainMesh?.geometry;
    if (!geo?.attributes?.color || !plants?.length) return;

    const sf = this._sf;
    const toLocal = (p) => ({
      x: p.x * sf,
      z: p.ySud * sf,                                   // pas de signe ici : cf. @coords
      radius: Math.max(0.4, p.canopyRadius ?? 2) * sf,
    });

    try {
      /* Ordre volontaire : teinte PUIS AO. L'inverse ré-éclaircirait les
         sommets assombris (mixer vers l'humus tire une couleur sombre vers une
         valeur fixe) — l'occlusion doit avoir le dernier mot. */
      const tinted = applyGroundTint({ geometry: geo, plants, toLocal });
      const shaded = applyContactAO({ geometry: geo, plants, toLocal });
      this._needsRender = true;
      console.info(`[Buildings3D] Effets de sol : AO de contact ${shaded} sommets · humus ${tinted} sommets (${plants.length} sujets)`);
    } catch (e) {
      console.warn('[Buildings3D] Effets de sol ignorés :', e.message);
    }
  },

  // ─── STRATE HERBACÉE ─────────────────────────────────────────
  // Touffes instanciées (3 quads croisés, species-geometry) semées DANS LA
  // PARCELLE uniquement, hors d'un disque de 1 m au pied de chaque sujet.
  // RNG déterministe seedé par la bbox parcelle : même rendu au rechargement.
  async _buildGrass() {
    const geom = this._session?.terrain?.parcelle_geojson;
    if (!geom || !this._center) return;

    const ring = geom.type === 'Polygon'
      ? geom.coordinates?.[0]
      : geom.coordinates?.[0]?.[0];
    if (!ring || ring.length < 3) return;

    // @coords WGS84 → mètres locaux { x = EST, ySud = SUD }. Le northing
    // (lat − lat0)·LAT_SCALE est nié UNE fois ici, exactement comme
    // _buildVegetation nie ctx.trees.z : même repère, un seul flip.
    const lat = this._center[1];
    const LAT_SCALE = 111320, LNG_SCALE = 111320 * Math.cos(lat * DEG);
    const poly = ring.map(c => [
      (c[0] - this._center[0]) * LNG_SCALE,
      -((c[1] - this._center[1]) * LAT_SCALE),
    ]);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [px, py] of poly) {
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
    if (!(maxX > minX) || !(maxY > minY)) return;

    // Géométrie de touffe : hauteur unitaire, mise à l'échelle par instance.
    // Import dynamique : species-geometry tire THREE + un JSON — s'il échoue
    // (offline, CDN coupé), on saute l'herbe sans casser la vue 3D.
    let tuftGeo = null;
    try {
      const SG = await import('../services/vegetation/species-geometry.js');
      await SG.initSpeciesGeometry();
      tuftGeo = SG.buildGrassTuftGeometry(1);
      /* buildGrassTuftGeometry ne pose PAS de normales (position/uv/ah seuls) :
         sans elles, MeshStandardMaterial reçoit normal = (0,0,0) et rend noir. */
      if (!tuftGeo.attributes.normal) tuftGeo.computeVertexNormals();
    } catch (e) {
      console.warn('[Buildings3D] Strate herbacée ignorée (species-geometry indisponible) :', e?.message ?? e);
      return;
    }

    const caps = getDeviceCaps();
    const budget = caps.lowSpec ? 120 : 400;

    // RNG déterministe seedé par la bbox parcelle (cm) — pas Math.random :
    // le tapis d'herbe doit être identique d'un rechargement à l'autre.
    const seed = this._hash32([minX, minY, maxX, maxY].map(v => Math.round(v * 100)));
    const rng = this._mulberry32(seed);

    // Index des sujets : exclusion d'un disque de 1 m au pied (une touffe ne
    // pousse pas dans un tronc). Maille = rayon d'exclusion → 3×3 exhaustif.
    const EXCLUDE_M = 1.0;
    const plantIdx = makePointIndex(
      (this._plants ?? []).map(p => ({ x: p.x, z: p.ySud })), EXCLUDE_M);

    const sf = this._sf, ve = this.VERTICAL_EXAG;
    const spots = [];
    const maxTries = budget * 25;
    for (let t = 0; t < maxTries && spots.length < budget; t++) {
      const x = minX + rng() * (maxX - minX);
      const y = minY + rng() * (maxY - minY);
      if (!this._pointInPolygon(x, y, poly)) continue;
      let blocked = false;
      plantIdx.forEachNear(x, y, (p) => {
        if (blocked) return;
        const dx = x - p.x, dz = y - p.z;
        if (dx * dx + dz * dz < EXCLUDE_M * EXCLUDE_M) blocked = true;
      });
      if (blocked) continue;
      spots.push([x, y]);
    }
    if (!spots.length) { tuftGeo.dispose(); return; }

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,            // blanc : la teinte vient de instanceColor
      roughness: 0.95, metalness: 0,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(tuftGeo, mat, spots.length);
    mesh.name = 'strate-herbacee';
    mesh.castShadow = false;      // 400 touffes dans la shadow map = inutile et cher
    mesh.receiveShadow = false;

    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const col = new THREE.Color();
    for (let i = 0; i < spots.length; i++) {
      const [x, ySud] = spots[i];
      const h = 0.25 + rng() * 0.20;                    // 0,25 → 0,45 m
      const s = h * sf;
      pos.set(x * sf, this._sampleGroundY(x, ySud), ySud * sf);
      e.set(0, rng() * Math.PI * 2, 0);
      q.setFromEuler(e);
      scl.set(s, s * ve, s);
      m4.compose(pos, q, scl);
      mesh.setMatrixAt(i, m4);
      // Verts variés : hue 0,22–0,32 (jaune-vert → vert franc), valeur basse
      col.setHSL(0.22 + rng() * 0.10, 0.32 + rng() * 0.26, 0.24 + rng() * 0.16);
      mesh.setColorAt(i, col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this._scene.add(mesh);
    this._grassMesh = mesh;
    this._needsRender = true;
    console.info(`[Buildings3D] Strate herbacée : ${spots.length}/${budget} touffes${caps.lowSpec ? ' (budget réduit — terminal faible)' : ''}`);
  },

  /** Ray casting — polygone en paires [x, ySud] (le flip ne change rien à
      l'appartenance : c'est un miroir appliqué au point ET au contour). */
  _pointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) {
        inside = !inside;
      }
    }
    return inside;
  },

  /** Hash 32 bits d'une liste d'entiers (seed RNG stable). */
  _hash32(nums) {
    let h = 2166136261 >>> 0;
    for (const n of nums) {
      h = Math.imul(h ^ ((n | 0) & 0xffff), 16777619);
      h = Math.imul(h ^ (((n | 0) >> 16) & 0xffff), 16777619);
    }
    return h >>> 0;
  },

  /** mulberry32 — même générateur que species-geometry (déterministe). */
  _mulberry32(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  _buildTreePrimitive(p, sf, ve) {
    const x = p.x * sf;
    const z = p.ySud * sf;
    const h = ((p.height && p.height > 1) ? p.height : (p.canopyRadius ?? 2) * 2.2) * sf * ve;
    const r = (p.canopyRadius ?? 2) * sf;
    const groundY = this._sampleGroundY(p.x, p.ySud, p.groundAlt);

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
    this._needsRender = true;

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
    this._needsRender = true;
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
  // Rendu à la demande : on ne rend que si la caméra a bougé (event 'change'
  // d'OrbitControls, déclenché aussi pendant le damping) ou si _needsRender
  // a été levé (scène modifiée, resize). Économie batterie mobile.
  _startLoop() {
    this._needsRender = true;
    this._controls?.addEventListener('change', () => { this._needsRender = true; });
    const loop = () => {
      this._animId = requestAnimationFrame(loop);
      this._controls?.update();
      if (!this._needsRender) return;
      this._needsRender = false;
      updateImpostorCamera(this._vegetationMats, this._cam);
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
      this._needsRender = true;
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
    // Strate herbacée : InstancedMesh → dispose() libère aussi instanceMatrix
    if (this._grassMesh) {
      this._grassMesh.dispose?.();
      this._grassMesh.geometry?.dispose();
      this._grassMesh.material?.dispose();
      this._scene?.remove(this._grassMesh);
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
    this._grassMesh = null;
    this._plants = [];
    this._lidarCtx = null;
    this._vegetationMats = [];
    this._vegSource = null;
    this._inited = false;
  },
};

export default Buildings3DViewer;
