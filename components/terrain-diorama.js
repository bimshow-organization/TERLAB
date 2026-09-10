// ═══════════════════════════════════════════════════════════════════════
// TERLAB · components/terrain-diorama.js
// LE DIORAMA — maquette Three.js PURE (sans Mapbox) du site et de son
// voisinage, « redessinée » depuis les images :
//
//   · tiles MNT IGN 500 m (services/terrain-tiles, cache IDB) drapées
//     ortho — MULTICOUCHE : calque cadastre PNG composé à la demande ;
//   · végétation du voisinage PLANTÉE D'APRÈS L'IMAGE : masque vert sur
//     l'ortho de chaque tile → sujets impostors (low-def hors parcelle) ;
//   · PARCELLE EN HAUTE DÉFINITION : jardin BpfBridge (Poisson disk,
//     amenities/CBS), herbes, végétation P06 si validée, bâti BDTOPO
//     extrudé et posé sur le MNT ;
//   · CROISSANCE RADIALE : tout surgit du sol depuis le site, anneau par
//     anneau, comme si le monde se répandait depuis la parcelle ;
//   · atmosphère (ciel dégradé, brume, soleil chaud, ACES) ;
//   · export GLB multicouche (groupes nommés = calques) ;
//   · photosphère 360 optionnelle (setPhotosphere).
//
// @coords
//   project:   TERLAB
//   plan:      XZ (Three Y-up)
//   yAxis:     up — y = altitude NGR absolue (alt0 = 0)
//   anchor:    origin UTM40S {E0, N0} = centroïde du polygone parcelle
//   units:     meters
//   north:     -Z (convention terrain-tiles : z = −(N−N0))
//   pairsWith: services/terrain-tiles.js
//   roundtrip: local {x, ySud} (BPF/P06, y sud+) → scène (x, y=sol, z=ySud)
//              — z scène EST le sud local : UN seul flip nord/sud, hérité
//              de terrain-tiles, aucun autre dans ce fichier.
// ═══════════════════════════════════════════════════════════════════════

import TerrainTiles, {
  tileForUTM, tilesInRadius, tileGrid, LOD_PIXEL_SIZES,
} from '../services/terrain-tiles.js';
import BILTerrain from '../services/bil-terrain.js';
import ImpostorLoader from '../services/impostor-loader.js';
import { buildImpostorMaterial, updateImpostorCamera } from '../services/vegetation/impostor-billboard.js';

const LAT_M = 111320;
const WMSR = 'https://data.geopf.fr/wms-r';
const LAYER_CADASTRE = 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS';

// Espèces « voisinage » plantées d'après l'image (impostors disponibles)
const LD_SPECIES = ['palm_coconut', 'mango', 'flamboyant', 'tamarind', 'terminalia_catappa', 'latania'];

const AMENITY_COLORS = {
  piscine: 0x3b8ac4, bassin: 0x2e6b8a, terrasse: 0xb08a5a, pergola: 0x8a6a4a,
  kiosque: 0x9a7850, cuisine_ext: 0x9a8060, potager: 0x6a8a3a, tisanerie: 0x7a9a5a,
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TerrainDiorama = {

  // ── état ─────────────────────────────────────────────────────────────
  THREE: null,
  _scene: null, _cam: null, _renderer: null, _controls: null,
  _animId: null, _clock0: 0,
  _root: null,                 // groupe racine (calques enfants nommés)
  _layers: {},                 // { terrain, batiments, 'vegetation-hd', 'vegetation-ld', amenites }
  _origin: null,               // {E0, N0, alt0:0} — centroïde parcelle
  _centroid: null,             // {clat, clng, lngM}
  _parcelLocal: null,          // [{x, y sud}]
  _session: null,
  _grow: [],                   // [{obj, t0, dur, baseY}] — croissance radiale
  _mats: [],                   // materiaux impostor (uCameraPos par frame)
  _tileMeshes: [],
  _cadastreOn: false,
  _texCache: new Map(),        // "tx:ty" → {ortho: Texture, composite: Texture|null, orthoCanvas}
  _photosphere: null,
  _groundY0: 0,                // altitude du sol au centre (cadrage caméra)
  _disposed: false,

  // ── init ─────────────────────────────────────────────────────────────
  /**
   * @param {object} o { canvas, session, radiusTiles=1, onProgress }
   * session = SessionManager._data (ou objet {terrain:{lat,lng,parcelle_geojson}})
   */
  async init({ canvas, session, radiusTiles = 1, onProgress } = {}) {
    const THREE = this.THREE = (typeof window !== 'undefined' && window.THREE)
      ?? await import('https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.module.js');
    if (typeof window !== 'undefined' && !window.THREE) window.THREE = Object.assign({}, THREE);

    this._session = session;
    this._disposed = false;
    const terrain = session?.terrain;
    const ring = this._parcelRing(terrain);
    if (!canvas || !ring) throw new Error('[Diorama] canvas ou parcelle absents');
    const prog = (stage, d, t) => { try { onProgress?.({ stage, done: d, total: t }); } catch { /* ui */ } };

    // Origine = centroïde du polygone parcelle (UTM40S)
    const clng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
    const clat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
    const lngM = LAT_M * Math.cos(clat * Math.PI / 180);
    this._centroid = { clat, clng, lngM };
    this._parcelLocal = ring.map(c => ({ x: (c[0] - clng) * lngM, y: -(c[1] - clat) * LAT_M }));
    const [E0, N0] = await BILTerrain.lngLatToUTM(clng, clat);
    this._origin = { E0, N0, alt0: 0 };
    TerrainTiles.init({ origin: this._origin });

    // ── Scène, atmosphère ──
    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this._renderer.setPixelRatio(Math.min((window?.devicePixelRatio ?? 1), 2));
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.05;

    this._scene = new THREE.Scene();
    this._buildSky();
    // Brume littorale : assez dense pour FONDRE le bord des tiles dans le
    // lointain (sans elle, l'arête de la dernière tile lit comme un far-plane)
    this._scene.fog = new THREE.FogExp2(0xdbe6e4, 0.0008);

    // Voile de fond : immense disque teinte terre sous le niveau des tiles —
    // le « vide » entre le bord des tiles et l'horizon devient un sol brumeux
    // au lieu d'un trou sur le ciel.
    {
      const backdrop = new THREE.Mesh(
        new THREE.CircleGeometry(20000, 48),
        new THREE.MeshBasicMaterial({ color: 0xb9bdb2 }),
      );
      backdrop.rotation.x = -Math.PI / 2;
      backdrop.position.y = -3;
      backdrop.name = 'fond';
      this._scene.add(backdrop);
    }

    const w = canvas.clientWidth || 800, h = canvas.clientHeight || 600;
    this._cam = new THREE.PerspectiveCamera(52, w / h, 1, 30000);
    this._cam.position.set(220, 190, 260);
    this._renderer.setSize(w, h, false);

    const { OrbitControls } = window.THREE?.OrbitControls
      ? { OrbitControls: window.THREE.OrbitControls }
      : await import('https://cdn.jsdelivr.net/npm/three@0.182.0/examples/jsm/controls/OrbitControls.js');
    this._controls = new OrbitControls(this._cam, canvas);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.07;
    this._controls.maxPolarAngle = Math.PI / 2.05;
    this._controls.maxDistance = 4000;
    this._controls.autoRotate = true;              // ambiance ; coupée au 1er geste
    this._controls.autoRotateSpeed = 0.35;
    canvas.addEventListener('pointerdown', () => { this._controls.autoRotate = false; }, { once: true });

    // Lumière : soleil chaud de fin de matinée + hémisphérique ciel/sol
    this._scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x4a5a3a, 0.75));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.0);
    sun.position.set(-350, 520, -180);             // est/haut (lat −21 : soleil au nord... ambiance)
    this._scene.add(sun);

    this._root = new THREE.Group();
    this._root.name = 'diorama';
    this._scene.add(this._root);
    for (const name of ['terrain', 'voirie', 'batiments', 'vegetation-hd', 'vegetation-ld', 'amenites']) {
      const g = new THREE.Group(); g.name = name;
      this._layers[name] = g; this._root.add(g);
    }

    this._clock0 = performance.now();
    this._startLoop();

    // ── Fond grande échelle : UNE macro-dalle grossière (4,5 km, ~9 m/px,
    // 2 requêtes) au lieu d'anneaux de tuiles fines supplémentaires —
    // pyramide d'échelles : le détail au centre, le paysage en une pièce.
    this._buildBackgroundSlab().catch(e => console.info('[Diorama] fond :', e?.message ?? e));

    // ── MAQUETTE DE L'ENTOURAGE : tuiles détail = celles qui intersectent
    // la bbox parcelle élargie de MAQUETTE_MARGIN. Une parcelle à −30 m du
    // bord de sa tuile charge donc naturellement la (ou les 2-3) voisine(s)
    // — plus d'effet « coupé au bord ». Le paysage au-delà = macro-dalle.
    const MARGIN = this.MAQUETTE_MARGIN;
    const bb = this._parcelLocal.reduce((a, p) => ({
      x0: Math.min(a.x0, p.x), x1: Math.max(a.x1, p.x),
      y0: Math.min(a.y0, p.y), y1: Math.max(a.y1, p.y),
    }), { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 });
    // local {x, ySud} → UTM : E = E0 + x ; N = N0 − ySud
    const tMin = tileForUTM(E0 + bb.x0 - MARGIN, N0 - bb.y1 - MARGIN);
    const tMax = tileForUTM(E0 + bb.x1 + MARGIN, N0 - bb.y0 + MARGIN);
    const pcx = (bb.x0 + bb.x1) / 2, pcy = (bb.y0 + bb.y1) / 2;
    const all = [];
    for (let tx = tMin.tx; tx <= tMax.tx; tx++) {
      for (let ty = tMin.ty; ty <= tMax.ty; ty++) {
        const cE = (tx + 0.5) * 500 - E0, cS = -((ty + 0.5) * 500 - N0);
        all.push({ tx, ty, dist: Math.hypot(cE - pcx, cS - pcy) });
      }
    }
    all.sort((a, b) => a.dist - b.dist);
    const total = all.length;
    let done = 0;

    // LiDAR de l'entourage (pris en compte s'il est disponible — log explicite)
    this._lidarTrees = await this._collectLidarTrees(terrain);

    for (let i = 0; i < all.length; i++) {
      if (this._disposed) return;
      const t = all[i];
      const ringIdx = Math.min(3, Math.round(t.dist / 500));
      try {
        await this._buildTile(t.tx, t.ty, 1, ringIdx, 0, 0);   // détail : LOD 2 m partout
      } catch (e) {
        console.warn(`[Diorama] tile ${t.tx}:${t.ty} :`, e?.message ?? e);
      }
      prog('tiles', ++done, total);
      if (i === 0) {
        // Cadrage caméra sur le sol réel + lancement parcelle HD en parallèle
        this._frameCamera();
        this._buildParcelHD().catch(e => console.warn('[Diorama] parcelle HD :', e?.message ?? e));
      }
    }
    // Arbres LiDAR réels de la bande maquette (toutes les tuiles sont posées
    // → raycasts de sol valides partout)
    if (this._lidarTrees) {
      await this._plantLidar().catch(e => console.info('[Diorama] plantation LiDAR :', e?.message ?? e));
    }

    // Voirie : rubans chaussée + trottoirs + arbres d'alignement (BDTOPO)
    await this._buildRoads().catch(e => console.info('[Diorama] voirie :', e?.message ?? e));

    prog('fini', total, total);
    return this;
  },

  // ── voirie : chaussées drapées, trottoirs, arbres d'alignement ───────
  // « Dessiner les voies aux alentours » — même esprit que roads-profile du
  // prototype Saint-Leu : rubans posés sur le MNT, largeur BDTOPO.
  async _buildRoads() {
    const THREE = this.THREE;
    const { clat, clng, lngM } = this._centroid;
    const Bd = window.BdTopoService ?? (await import('../services/bdtopo-service.js')).default;
    const gj = await Bd.fetchRoutes(clat, clng, 380);
    const streets = Bd.routesToStreets(gj);
    if (this._disposed || !streets.length) return;

    const layer = this._layers.voirie;
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x4c4c4a, roughness: 0.95 });
    const walkMat = new THREE.MeshStandardMaterial({ color: 0x9b968c, roughness: 0.9 });
    const curbMat = new THREE.MeshStandardMaterial({ color: 0xb3aea3, roughness: 0.85 });
    const paintMat = new THREE.MeshBasicMaterial({ color: 0xf0efe6 });

    // Ruban drapé le long d'une polyligne locale [{x,z}] (largeur m, surcote m)
    const ribbon = (pts, width, lift, mat) => {
      if (pts.length < 2) return null;
      const pos = [];
      const half = width / 2;
      const side = pts.map((p, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
        return { nx: -dz / L, nz: dx / L };
      });
      const V = pts.map((p, i) => {
        const y = this._sampleGround(p.x, p.z) + lift;
        return [
          [p.x + side[i].nx * half, y, p.z + side[i].nz * half],
          [p.x - side[i].nx * half, y, p.z - side[i].nz * half],
        ];
      });
      for (let i = 0; i < pts.length - 1; i++) {
        const [a1, a2] = V[i], [b1, b2] = V[i + 1];
        pos.push(...a1, ...b1, ...a2, ...a2, ...b1, ...b2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      return new THREE.Mesh(g, mat);
    };

    // Rééchantillonnage ~6 m + découpe à la bande maquette
    const resampleClip = (coords) => {
      const local = coords.map(c => ({ x: (c[0] - clng) * lngM, z: -(c[1] - clat) * LAT_M }));
      const out = [];
      let cur = [];
      for (let i = 0; i < local.length - 1; i++) {
        const a = local[i], b = local[i + 1];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        const n = Math.max(1, Math.ceil(L / 6));
        for (let s = 0; s < n; s++) {
          const t = s / n;
          const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
          if (this._distToParcel(p.x, p.z) <= this.MAQUETTE_MARGIN + 20) cur.push(p);
          else if (cur.length) { if (cur.length > 1) out.push(cur); cur = []; }
        }
      }
      if (cur.length > 1) out.push(cur);
      return out;
    };

    let nRoads = 0;
    const treeSpots = [];
    for (const st of streets) {
      if (st.type === 'path') continue;                       // sentiers : hors maquette
      const w = st.largeur || (st.type === 'primary' ? 7 : st.type === 'secondary' ? 6 : 5);
      for (const seg of resampleClip(st.points)) {
        const road = ribbon(seg, w, 0.12, roadMat);
        if (!road) continue;
        layer.add(road);
        const offsetLine = (dist, s) => seg.map((p, i) => {
          const a = seg[Math.max(0, i - 1)], b = seg[Math.min(seg.length - 1, i + 1)];
          const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
          return { x: p.x + (-dz / L) * s * dist, z: p.z + (dx / L) * s * dist };
        });
        // Trottoirs + caniveaux/bordures des deux côtés
        for (const s of [1, -1]) {
          const walk = ribbon(offsetLine(w / 2 + 0.95, s), 1.5, 0.17, walkMat);
          if (walk) layer.add(walk);
          const curb = ribbon(offsetLine(w / 2 + 0.1, s), 0.25, 0.2, curbMat);
          if (curb) layer.add(curb);
        }
        // Marquage axial pointillé (voies structurantes seulement)
        if (st.type === 'primary' || st.type === 'secondary') {
          for (let i = 0; i + 1 < seg.length; i += 2) {          // 1 tiret sur 2
            const dash = ribbon([seg[i], seg[i + 1]], 0.15, 0.21, paintMat);
            if (dash) layer.add(dash);
          }
        }
        // Arbres d'alignement : tous les ~14 m, côté alterné, sur trottoir
        for (let i = 2; i < seg.length - 2; i += 2) {
          if ((i / 2) % 1 !== 0) continue;
          const a = seg[i - 1], b = seg[i + 1], p = seg[i];
          const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
          const s = (i % 4 === 0) ? 1 : -1;
          const tx2 = p.x + (-dz / L) * s * (w / 2 + 2.4);
          const tz2 = p.z + (dx / L) * s * (w / 2 + 2.4);
          if (this._pointInPoly(tx2, tz2, this._parcelLocal)) continue;
          treeSpots.push({ x: tx2, z: tz2 });
        }
        nRoads++;
      }
    }

    // Arbres d'alignement en impostors (une essence urbaine, taille contenue)
    const cap = 160;
    if (treeSpots.length) {
      const spots = treeSpots.slice(0, cap);
      let tex = null;
      try { tex = await ImpostorLoader.getTexture('terminalia_catappa') ?? await ImpostorLoader.getTexture('flamboyant'); } catch { /* offline */ }
      if (tex) {
        const mat = buildImpostorMaterial(THREE, tex);
        this._mats.push(mat);
        const geo = new THREE.PlaneGeometry(1, 1);
        geo.translate(0, 0.5, 0);
        const inst = new THREE.InstancedMesh(geo, mat, spots.length);
        inst.frustumCulled = false;
        const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Sc = new THREE.Vector3(), P = new THREE.Vector3();
        for (let i = 0; i < spots.length; i++) {
          const p = spots[i];
          const h = 4.5 + (i % 5) * 0.4;
          P.set(p.x, this._sampleGround(p.x, p.z), p.z);
          Sc.set(h * 0.85, h, 1);
          Q.set(0, 0, 0, 1);
          M.compose(P, Q, Sc);
          inst.setMatrixAt(i, M);
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.name = 'arbres-alignement';
        layer.add(inst);
      }
    }

    this._growIn(layer, 900, 1100, { rise: 3 });
    console.info(`[Diorama] voirie : ${nRoads} tronçons dessinés, ${Math.min(treeSpots.length, cap)} arbres d'alignement`);
  },

  /** Brume on/off (le fond macro + le voile la rendent quasi indispensable,
   *  mais un œil de maquettiste veut parfois la couper). */
  setFog(on) {
    const THREE = this.THREE;
    if (on) {
      this._scene.fog = this._savedFog ?? new THREE.FogExp2(0xdbe6e4, 0.0008);
    } else {
      this._savedFog = this._scene.fog;
      this._scene.fog = null;
    }
  },

  // Rayon de la maquette autour du terrain (bâti + plantation s'y arrêtent)
  MAQUETTE_MARGIN: 150,

  // ── plantation des arbres LiDAR (bande maquette, hors parcelle) ──────
  async _plantLidar() {
    const THREE = this.THREE;
    const band = this._lidarTrees.filter(t => {
      const d = this._distToParcel(t.x, t.ySud);
      return d > 0 && d <= this.MAQUETTE_MARGIN;   // la parcelle = jardin HD dédié
    });
    if (!band.length) return;
    const bySpecies = {};
    for (const t of band) {
      // Espèce classée par suggestSpecies si disponible, repli hauteur sinon
      const sp = t.speciesKey
        ?? ((t.h ?? 0) > 10 ? 'flamboyant' : (t.h ?? 0) > 6 ? 'palm_coconut' : 'tamarind');
      (bySpecies[sp] ??= []).push(t);
    }
    const group = new THREE.Group();
    group.name = 'veg-lidar';
    let SGl = null;
    const procMatL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    for (const [sp, list] of Object.entries(bySpecies)) {
      let tex = null;
      try { tex = await ImpostorLoader.getTexture(sp); } catch { /* offline */ }
      if (!tex) {
        // Espèce classée sans atlas → géométrie procédurale (rien ne disparaît)
        try {
          SGl ??= await import('../services/vegetation/species-geometry.js').then(async m => { await m.initSpeciesGeometry(); return m; });
          const built = SGl.buildSpeciesGeometry(sp, 0, { tint: list[0]?.color2D });
          if (built?.geometry) {
            const inst = new THREE.InstancedMesh(built.geometry, procMatL, list.length);
            inst.userData.sharedGeometry = true;
            inst.frustumCulled = false;
            const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Sc = new THREE.Vector3(), P = new THREE.Vector3();
            for (let i = 0; i < list.length; i++) {
              const t = list[i];
              const s = Math.max(0.5, Math.min(2, (t.r ?? 2) / (built.canopyRadius || 2)));
              P.set(t.x, this._sampleGround(t.x, t.ySud), t.ySud);
              Q.set(0, 0, 0, 1);
              Sc.set(s, s, s);
              M.compose(P, Q, Sc);
              inst.setMatrixAt(i, M);
            }
            inst.instanceMatrix.needsUpdate = true;
            group.add(inst);
          }
        } catch { /* recette absente */ }
        continue;
      }
      const mat = buildImpostorMaterial(THREE, tex);
      this._mats.push(mat);
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.translate(0, 0.5, 0);
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      inst.frustumCulled = false;
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Sc = new THREE.Vector3(), P = new THREE.Vector3();
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const h = Math.max(3, t.h ?? 5);
        P.set(t.x, this._sampleGround(t.x, t.ySud), t.ySud);
        Sc.set(Math.max(2.5, (t.r ?? h * 0.35) * 2), h, 1);
        Q.set(0, 0, 0, 1);
        M.compose(P, Q, Sc);
        inst.setMatrixAt(i, M);
      }
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
    }
    this._layers['vegetation-ld'].add(group);
    this._growIn(group, 700, 1200);
    console.info(`[Diorama] ${band.length} arbres LiDAR plantés sur la bande maquette`);
  },

  /** Distance (m) d'un point local {x, ySud} à la parcelle (0 si dedans). */
  _distToParcel(x, y) {
    if (this._pointInPoly(x, y, this._parcelLocal)) return 0;
    let d = Infinity;
    const P = this._parcelLocal;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const ax = P[j].x, ay = P[j].y, bx = P[i].x, by = P[i].y;
      const L2 = (bx - ax) ** 2 + (by - ay) ** 2;
      const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2)) : 0;
      d = Math.min(d, Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))));
    }
    return d;
  },

  // ── LiDAR de l'entourage : arbres réels si points disponibles ────────
  _lidarTrees: null,
  async _collectLidarTrees(terrain) {
    const LS = window.LidarService, LCS = window.LidarContextService;
    if (!LS || !LCS || !terrain?.parcelle_geojson) {
      console.info('[Diorama] LiDAR : services absents → plantation d\'après image');
      return null;
    }
    try {
      let raw = LS.getRawPoints?.();
      if (!raw?.length) {
        const avail = await LS.isAvailable?.().catch(() => false);
        if (!avail) { console.info('[Diorama] LiDAR : non couvert → plantation d\'après image'); return null; }
        const res = await LS.getPointsForParcel(terrain.parcelle_geojson, this.MAQUETTE_MARGIN,
          { classes: '2,3,4,5,6,9', maxPoints: 200000 });
        if (!res?.points?.length) return null;
        raw = res.points;
        LS.setRawPoints?.(raw, '2,3,4,5,6,9');
      }
      const ctx = LCS.process(raw, terrain.parcelle_geojson, null);
      const trees = (ctx?.trees ?? []).map(t => ({
        x: t.x, ySud: -t.z, h: t.height, r: t.radiusM, groundAlt: t.groundAlt,
      }));
      // Classification d'espèces RÉELLE (service vegetation-species : CHM
      // h/rayon × altitude × biome, 33 espèces Réunion) au lieu d'une
      // heuristique par hauteur. Limite documentée : la signature palmier
      // (peak sharpness + trunk hollowness) exige le niveau point de
      // vegetation-detection, qui ne travaille que sur la parcelle — on passe
      // isCoastal en biais cocotier sous 60 m NGR.
      try {
        const VS = window.VegetationSpecies
          ?? (await import('../services/vegetation/vegetation-species.js')).default;
        await VS.load?.();
        // ⚠ Le matching biome se fait contre sp.biomes = ZONE_BIOME[zone]
        // (['tropical-reunion','coastal',…]) : 'littoral' ne matche RIEN —
        // c'est 'tropical' qu'attend le service (comme P06). Repli en cascade.
        const biome = terrain.biome ?? 'tropical';
        for (const t of trees) {
          const opts = { isCoastal: (t.groundAlt ?? 0) < 60 };
          const c = VS.suggestSpecies(t.h ?? 6, t.r ?? 2, t.groundAlt ?? 0, biome, 1, opts)?.[0]
            ?? VS.suggestSpecies(t.h ?? 6, t.r ?? 2, t.groundAlt ?? 0, 'tropical', 1, opts)?.[0];
          if (c) { t.speciesKey = c.speciesKey; t.color2D = c.color2D; }
        }
        const classified = trees.filter(t => t.speciesKey).length;
        console.info(`[Diorama] LiDAR PRIS EN COMPTE : ${trees.length} arbres, ${classified} classés par suggestSpecies`);
      } catch (e) {
        console.info('[Diorama] classification espèces indisponible :', e?.message ?? e);
      }
      return trees.length ? trees : null;
    } catch (e) {
      console.info('[Diorama] LiDAR indisponible :', e?.message ?? e);
      return null;
    }
  },

  // ── ciel dégradé (dome BackSide vertex-colors) ───────────────────────
  _buildSky() {
    const THREE = this.THREE;
    const geo = new THREE.SphereGeometry(12000, 24, 12);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const top = new THREE.Color(0x7fb2d9), mid = new THREE.Color(0xdfeef2), low = new THREE.Color(0xf2e9d8);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 12000;
      const c = y > 0.15 ? top.clone().lerp(mid, 1 - Math.min(1, (y - 0.15) / 0.6))
        : mid.clone().lerp(low, Math.min(1, (0.15 - y) / 0.3));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
    }));
    sky.name = 'ciel';
    this._scene.add(sky);
  },

  // ── macro-dalle de fond (grande échelle, basse résolution) ───────────
  // Construite EN PROPRE avec le pipeline des tuiles (mêmes conventions de
  // lignes/UV, validées au zénithal) : le RGE Alti renvoie du NODATA (NaN,
  // −99999…) sur la mer et hors couverture à cette emprise — on nettoie les
  // heights AVANT maillage (niveau mer = 0). Nettoyer après coup téléporte
  // des sommets à l'origine → triangles géants en éventail (vécu).
  async _buildBackgroundSlab(sizeM = 4500, pixelSizeM = 9) {
    const THREE = this.THREE;
    const { E0, N0 } = this._origin;
    const px = pixelSizeM;
    const W = Math.min(512, Math.round(sizeM / px)), H = W;
    const minE = Math.floor((E0 - (W / 2) * px) / px) * px + px / 2;   // pixel-centre
    const minN = Math.floor((N0 - (H / 2) * px) / px) * px + px / 2;
    const bbox = [minE - px / 2, minN - px / 2, minE + (W - 0.5) * px, minN + (H - 0.5) * px];

    const url = TerrainTiles._buildUrl(bbox, W, H);
    const buf = await TerrainTiles._fetchBuffer(url, { expectBIL: true });
    if (this._disposed) return;
    const heights = TerrainTiles._parseBIL(buf);
    let fixed = 0;
    for (let i = 0; i < heights.length; i++) {
      if (!Number.isFinite(heights[i]) || heights[i] < -100 || heights[i] > 4000) { heights[i] = 0; fixed++; }
    }
    // Anti-spike : l'heuristique d'endianness de _parseBIL se fait piéger
    // quand les 5000 premiers échantillons sont de l'océan nodata → floats
    // lus dans le mauvais ordre = valeurs folles ÉPARSES dont certaines
    // passent le clamp → colonnes géantes isolées (vécu). Un vrai relief est
    // CONTINU : on écrête tout échantillon qui dépasse le min de ses voisins
    // de plus de 120 m (les crêtes réelles ont des voisins hauts aussi).
    // Médiane 3×3 PLEINE, deux passes : le décodage BIL de cette grande
    // emprise est bruité poivre-et-sel (endianness piégée par l'océan) — un
    // fond lointain sous brume tolère parfaitement un lissage médian, qui
    // éradique le bruit tout en gardant le relief macro (Montagne, ravines).
    const nb9 = new Array(9);
    for (let pass = 0; pass < 2; pass++) {
      const src = heights.slice();
      for (let j = 1; j < H - 1; j++) {
        for (let i = 1; i < W - 1; i++) {
          const k = j * W + i;
          nb9[0] = src[k - W - 1]; nb9[1] = src[k - W]; nb9[2] = src[k - W + 1];
          nb9[3] = src[k - 1];     nb9[4] = src[k];     nb9[5] = src[k + 1];
          nb9[6] = src[k + W - 1]; nb9[7] = src[k + W]; nb9[8] = src[k + W + 1];
          heights[k] = [...nb9].sort((a, b) => a - b)[4];
        }
      }
    }
    if (fixed) console.info(`[Diorama] fond : ${fixed} nodata → 0 m, lissage médian ×2 appliqué`);

    // Grille Y-up — MÊME convention que buildTileMesh : ligne 0 = NORD
    const pos = new Float32Array(W * H * 3);
    const uvs = new Float32Array(W * H * 2);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        pos[k * 3]     = (minE + i * px) - E0;
        pos[k * 3 + 1] = heights[k];
        pos[k * 3 + 2] = -((minN + (H - 1 - j) * px) - N0);
        uvs[k * 2] = i / (W - 1);
        uvs[k * 2 + 1] = 1 - j / (H - 1);
      }
    }
    const idx = new Uint32Array((W - 1) * (H - 1) * 6);
    let q = 0;
    for (let j = 0; j < H - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const a = j * W + i, b2 = a + 1, c = (j + 1) * W + i, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b2;
        idx[q++] = b2; idx[q++] = c; idx[q++] = d;
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
    geom.computeVertexNormals();
    geom.computeBoundingBox();
    geom.computeBoundingSphere();

    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa792, roughness: 1 });
    const mesh = new THREE.Mesh(geom, mat);
    // 1,5 m sous le niveau réel : les tuiles fines recouvrent sans z-fight,
    // la marche disparaît sous la brume.
    mesh.position.y = -1.5;

    // Drapage ortho basse résolution (1 requête 512 px) — piège ImageBitmap
    try {
      const obox = [bbox[0], bbox[1], bbox[2], bbox[3]];
      const ourl = TerrainTiles._buildOrthoUrl(obox, 512, 512);
      const obuf = await TerrainTiles._fetchBuffer(ourl, { expectBIL: false });
      const bmp = await createImageBitmap(new Blob([obuf], { type: 'image/jpeg' }));
      const cv = document.createElement('canvas');
      cv.width = bmp.width; cv.height = bmp.height;
      cv.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close?.();
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      mat.map = tex;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
    } catch { /* la dalle reste en couleur unie sous la brume */ }

    mesh.name = 'fond-macro';
    this._layers.terrain.add(mesh);
    this._growIn(mesh, 1200, 600, { rise: 0, scaleFrom: 1 });
    console.info(`[Diorama] fond ${sizeM} m à ${px} m/px posé`);
  },

  // ── une tile : MNT + ortho (+ plantation d'après l'image) ────────────
  async _buildTile(tx, ty, lod, ringIdx, ctx, cty) {
    const { demData } = await TerrainTiles.fetchTile(tx, ty, lod);
    if (this._disposed) return;
    const mesh = await TerrainTiles.buildTileMesh(demData, lod, this._origin);
    try { await TerrainTiles.applyOrtho(mesh, { sizePx: ringIdx === 0 ? 512 : 256 }); }
    catch { /* vertex-colors conservés */ }
    mesh.userData.ringIdx = ringIdx;
    this._layers.terrain.add(mesh);
    this._tileMeshes.push(mesh);
    // Dalle : apparition différée SANS mouvement — tout ce qui se pose dessus
    // (pelouse, arbres, bâti) est échantillonné par raycast : une dalle animée
    // en position faisait poser la parcelle HD ~2 m sous le sol final (vérifié
    // au probe). La « pousse » est réservée à la végétation et au bâti.
    this._growIn(mesh, ringIdx * 600, 400, { rise: 0, scaleFrom: 1 });

    if (ringIdx === 0) {
      // Altitude du sol au centre (médiane grossière) pour le cadrage caméra
      const hs = demData.heights;
      const mid = hs[(demData.H >> 1) * demData.W + (demData.W >> 1)];
      this._groundY0 = Number.isFinite(mid) ? mid : 0;
    }

    // « Planté selon images » : masque vert sur l'ortho de la tile →
    // sujets low-def (la parcelle, elle, reçoit le jardin HD dédié)
    this._plantFromImage(tx, ty, mesh, ringIdx)
      .catch(e => console.info(`[Diorama] plantation image ${tx}:${ty} :`, e?.message ?? e));

    // Bâti « petit à petit » : une requête WFS PAR TILE, filtrée à la bande
    // maquette (+MAQUETTE_MARGIN autour du terrain).
    this._buildTileBuildings(tx, ty, mesh, ringIdx)
      .catch(e => console.info(`[Diorama] bâti ${tx}:${ty} :`, e?.message ?? e));
  },

  // ── reconnaissance image légère : masque vert → plantation ───────────
  // (SLIC/image-to-garden reste l'upgrade : utils/image-to-garden.js est prêt ;
  //  v1 = masque chromatique COSIA-like, suffisant pour « redessiner » la canopée)
  async _plantFromImage(tx, ty, tileMesh, ringIdx) {
    // Le LiDAR fait foi quand il est disponible : arbres réels plutôt que
    // masque chromatique (cf. _collectLidarTrees, plantés en fin d'init).
    if (this._lidarTrees) return;
    const THREE = this.THREE;
    const g = tileGrid(tx, ty, 3);   // bbox tile
    const S = 256;
    const url = `${WMSR}?${new URLSearchParams({
      SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap',
      LAYERS: 'ORTHOIMAGERY.ORTHOPHOTOS', STYLES: '', CRS: 'EPSG:2975',
      BBOX: [g.bbox[0], g.bbox[1], g.bbox[2], g.bbox[3]].join(','),
      WIDTH: S, HEIGHT: S, FORMAT: 'image/jpeg',
    })}`;
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('ortho 256 indisponible'));
      im.src = url;
    });
    if (this._disposed) return;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const c2d = cv.getContext('2d', { willReadFrequently: true });
    c2d.drawImage(img, 0, 0, S, S);
    const px = c2d.getImageData(0, 0, S, S).data;

    // Masque vert (calibrage vegetation-detection : exclut olive/culture)
    const rng = mulberry32(tx * 73856093 ^ ty * 19349663);
    const cap = ringIdx === 0 ? 110 : ringIdx === 1 ? 55 : 28;
    const minDistM = ringIdx === 0 ? 9 : 16;
    const cell = Math.max(4, Math.round((minDistM / 500) * S));
    const taken = new Set();
    const pts = [];
    // Parcours en ordre pseudo-aléatoire seedé (stable au rechargement)
    const order = [];
    for (let y = 2; y < S - 2; y += 3) for (let x = 2; x < S - 2; x += 3) order.push((y << 9) | x);
    for (let i = order.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = order[i]; order[i] = order[j]; order[j] = t; }
    for (const o of order) {
      if (pts.length >= cap) break;
      const x = o & 511, y = o >> 9;
      const i = (y * S + x) * 4;
      const R = px[i], G = px[i + 1], B = px[i + 2];
      if (!(G > R + 10 && G > B + 10 && G > 50)) continue;
      const ck = `${(x / cell) | 0}_${(y / cell) | 0}`;
      if (taken.has(ck)) continue;
      taken.add(ck);
      // px → UTM → local scène
      const E = g.bbox[0] + ((x + 0.5) / S) * (g.bbox[2] - g.bbox[0]);
      const N = g.bbox[3] - ((y + 0.5) / S) * (g.bbox[3] - g.bbox[1]);
      const lx = E - this._origin.E0, lz = -(N - this._origin.N0);
      // La parcelle a son jardin HD dédié : on ne double-plante pas dessus,
      // et la maquette s'arrête à +MAQUETTE_MARGIN des limites du terrain.
      const d = this._distToParcel(lx, lz);
      if (d === 0 || d > this.MAQUETTE_MARGIN) continue;
      pts.push({ lx, lz });
    }
    if (!pts.length) return;

    // Pose au sol (raycast sur la tile) + instanced impostors par espèce
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const bySpecies = {};
    for (const p of pts) {
      ray.set(new THREE.Vector3(p.lx, 4000, p.lz), down);
      const hit = ray.intersectObject(tileMesh, false)[0];
      if (!hit) continue;
      const sp = LD_SPECIES[(rng() * LD_SPECIES.length) | 0];
      (bySpecies[sp] ??= []).push({ x: p.lx, y: hit.point.y, z: p.lz, h: 4 + rng() * 6 });
    }

    const tileVeg = new THREE.Group();
    tileVeg.name = `veg-tile-${tx}-${ty}`;
    for (const [sp, list] of Object.entries(bySpecies)) {
      let tex = null;
      try { tex = await ImpostorLoader.getTexture(sp); } catch { /* offline */ }
      if (!tex) continue;                          // low-def : impostors seulement
      const mat = buildImpostorMaterial(THREE, tex);
      this._mats.push(mat);
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.translate(0, 0.5, 0);
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      inst.frustumCulled = false;
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Sc = new THREE.Vector3(), P = new THREE.Vector3();
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        P.set(t.x, t.y, t.z);
        Sc.set(t.h * 0.9, t.h, 1);
        Q.set(0, 0, 0, 1);
        M.compose(P, Q, Sc);
        inst.setMatrixAt(i, M);
      }
      inst.instanceMatrix.needsUpdate = true;
      tileVeg.add(inst);
    }
    if (tileVeg.children.length) {
      this._layers['vegetation-ld'].add(tileVeg);
      this._growIn(tileVeg, ringIdx * 700 + 500, 1200);
    }
  },

  // ── parcelle HD : jardin BPF (ou P06), herbes, amenities ─────────────
  async _buildParcelHD() {
    const THREE = this.THREE;
    const session = this._session, terrain = session?.terrain;
    const hd = this._layers['vegetation-hd'];

    // Végétation : P06 validée sinon jardin BPF (mêmes règles que P05)
    let plants = [], amenities = [];
    const feats = session?.phases?.p06?.vegetation?.features;
    if (feats?.length) {
      plants = feats.filter(f => f.status !== 'existing_cut').map(f => ({
        x: f.positionLocal?.x ?? 0, ySud: f.positionLocal?.y ?? 0,
        speciesKey: f.speciesKey ?? 'palm_coconut',
        canopyRadius: f.canopyRadiusMeasured ?? 3, height: f.heightMeasured,
        color2D: f.speciesCandidates?.[0]?.color2D,
      }));
    } else {
      try {
        const BpfBridge = window.BpfBridge ?? (await import('../services/bpf-bridge.js')).default;
        const edgeTypes = this._parcelLocal.map((_, i) => (i === 0 ? 'voie' : 'lateral'));
        const r = await BpfBridge.generate(session ?? {}, this._parcelLocal, edgeTypes, [], null);
        if (!r?.error) {
          plants = (r.plants ?? []).map(p => ({
            x: p.x, ySud: p.y, speciesKey: p.speciesKey,
            canopyRadius: p.canopyRadius ?? 2, height: p.trunkH, color2D: p.color2D,
          }));
          amenities = r.amenities ?? [];
        }
      } catch (e) { console.warn('[Diorama] BpfBridge :', e?.message ?? e); }
    }
    if (this._disposed) return;

    const groundAt = (x, z) => this._sampleGround(x, z);

    // ── PELOUSE : nappe verte opaque drapée sur le MNT, clipée parcelle ──
    // C'est elle qui rend le jardin « verdoyant » — l'ortho seule est terne.
    {
      const { trianguler } = await import('../services/toiture/triangulate.js');
      const ring = this._parcelLocal.map(p => [p.x, p.y]);
      // Éventail depuis le centroïde : le MNT bombe ENTRE les sommets du ring,
      // un pavage à gros triangles passe dessous — le centre échantillonné le
      // suit. Offset 0.35 m : au-dessus du micro-relief, sous les socles CBS.
      const cx0 = ring.reduce((s, r) => s + r[0], 0) / ring.length;
      const cy0 = ring.reduce((s, r) => s + r[1], 0) / ring.length;
      const pts = ring.map(([x, y]) => [(x + cx0) / 2, (y + cy0) / 2])   // couronne interne
        .concat(ring, [[cx0, cy0]]);
      const tris = trianguler(ring);
      const pos = [], col = [];
      const rngL = mulberry32(0x1A47);
      const push = (x, y) => {
        pos.push(x, groundAt(x, y) + 0.35, y);
        const v = 0.9 + rngL() * 0.2;                      // variation subtile
        col.push(0.33 * v, 0.52 * v, 0.24 * v);
      };
      for (const [i, j, k] of tris) { push(...ring[i]); push(...ring[j]); push(...ring[k]); }
      // + éventail centroïde → couronne interne (suit le bombé central)
      for (let e = 0; e < ring.length; e++) {
        const a = pts[e], b = pts[(e + 1) % ring.length];
        push(cx0, cy0); push(...a); push(...b);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.computeVertexNormals();
      const lawn = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide,
      }));
      lawn.name = 'jardin-pelouse';
      hd.add(lawn);
    }

    // Amenities → socles CBS posés sur le sol
    for (const am of amenities) {
      const w = am.w ?? 3, h = am.h ?? 3;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.18, h),
        new THREE.MeshStandardMaterial({ color: AMENITY_COLORS[am.amenityKey] ?? 0x9a8a6a, roughness: 0.8 }),
      );
      mesh.position.set(am.x, groundAt(am.x, am.y) + 0.09, am.y);
      mesh.name = `amenity-${am.amenityKey}`;
      this._layers.amenites.add(mesh);
    }
    if (amenities.length) this._growIn(this._layers.amenites, 300, 900);

    // Végétation HD : impostors si atlas, sinon géométrie procédurale
    const bySpecies = {};
    for (const p of plants) (bySpecies[p.speciesKey] ??= []).push(p);
    let SG = null;
    const yUpProc = new THREE.Group();
    const procMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });

    for (const [sp, list] of Object.entries(bySpecies)) {
      let tex = null;
      try { tex = await ImpostorLoader.getTexture(sp); } catch { /* offline */ }
      if (tex) {
        const mat = buildImpostorMaterial(THREE, tex);
        this._mats.push(mat);
        const geo = new THREE.PlaneGeometry(1, 1);
        geo.translate(0, 0.5, 0);
        const inst = new THREE.InstancedMesh(geo, mat, list.length);
        inst.frustumCulled = false;
        const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Sc = new THREE.Vector3(), P = new THREE.Vector3();
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          const r = p.canopyRadius ?? 2;
          P.set(p.x, groundAt(p.x, p.ySud), p.ySud);
          // Plancher de taille : un sujet « arbre » sous 3 m disparaît à
          // l'échelle du diorama — le jardin doit se LIRE.
          const hgt = Math.max(3, (p.height && p.height > 1) ? p.height : r * 2.2);
          Sc.set(Math.max(2.2, r * 2), hgt, 1);
          Q.set(0, 0, 0, 1);
          M.compose(P, Q, Sc);
          inst.setMatrixAt(i, M);
        }
        inst.instanceMatrix.needsUpdate = true;
        hd.add(inst);
      } else {
        try {
          SG ??= await import('../services/vegetation/species-geometry.js').then(async m => { await m.initSpeciesGeometry(); return m; });
          const built = SG.buildSpeciesGeometry(sp, 0, { tint: list[0]?.color2D });
          if (!built?.geometry) continue;
          const inst = new THREE.InstancedMesh(built.geometry, procMat, list.length);
          inst.userData.sharedGeometry = true;
          inst.frustumCulled = false;
          const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Sc = new THREE.Vector3(), P = new THREE.Vector3(), E = new THREE.Euler();
          for (let i = 0; i < list.length; i++) {
            const p = list[i];
            const s = Math.max(0.5, Math.min(2, (p.canopyRadius ?? 2) / (built.canopyRadius || 2)));
            P.set(p.x, groundAt(p.x, p.ySud), p.ySud);
            E.set(0, ((Math.abs(Math.round(p.x * 31 + p.ySud * 17)) % 360) * Math.PI) / 180, 0);
            Q.setFromEuler(E);
            Sc.set(s, s, s);
            M.compose(P, Q, Sc);
            inst.setMatrixAt(i, M);
          }
          inst.instanceMatrix.needsUpdate = true;
          yUpProc.add(inst);
        } catch { /* recette absente */ }
      }
    }
    if (yUpProc.children.length) hd.add(yUpProc);

    // Strate herbacée HD dans la parcelle
    try {
      SG ??= await import('../services/vegetation/species-geometry.js').then(async m => { await m.initSpeciesGeometry(); return m; });
      const tuft = SG.buildGrassTuftGeometry(0.35);
      // Piège connu : la touffe sort sans normales → noir sous MeshStandardMaterial
      if (tuft && !tuft.attributes.normal) tuft.computeVertexNormals();
      if (tuft) {
        const rng = mulberry32(0xB0F);
        const bb = this._parcelLocal.reduce((b, p) => ({
          x0: Math.min(b.x0, p.x), x1: Math.max(b.x1, p.x),
          y0: Math.min(b.y0, p.y), y1: Math.max(b.y1, p.y),
        }), { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 });
        const N = 450;
        const inst = new THREE.InstancedMesh(tuft, new THREE.MeshStandardMaterial({
          color: 0x5f8a45, roughness: 1, side: THREE.DoubleSide,
        }), N);
        inst.userData.sharedGeometry = true;
        inst.frustumCulled = false;
        const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Sc = new THREE.Vector3(), P = new THREE.Vector3();
        let placed = 0;
        for (let tries = 0; tries < N * 8 && placed < N; tries++) {
          const x = bb.x0 + rng() * (bb.x1 - bb.x0);
          const y = bb.y0 + rng() * (bb.y1 - bb.y0);
          if (!this._pointInPoly(x, y, this._parcelLocal)) continue;
          P.set(x, groundAt(x, y), y);
          Q.setFromEuler(new THREE.Euler(0, rng() * Math.PI * 2, 0));
          const s = 0.7 + rng() * 0.7;
          Sc.set(s, s, s);
          M.compose(P, Q, Sc);
          inst.setMatrixAt(placed++, M);
        }
        inst.count = placed;
        hd.add(inst);
      }
    } catch { /* herbe optionnelle */ }

    // ── HAIE PÉRIMÉTRALE : arbustes serrés le long des limites (sauf une
    // ouverture au milieu de l'arête voie = l'entrée) — c'est elle qui donne
    // au jardin sa lisibilité de « jardin » et non de semis.
    try {
      SG ??= await import('../services/vegetation/species-geometry.js').then(async m => { await m.initSpeciesGeometry(); return m; });
      const built = SG.buildSpeciesGeometry('hibiscus_tiliaceus', 0, {});
      if (built?.geometry) {
        const spots = [];
        const P0 = this._parcelLocal;
        const cx0 = P0.reduce((s, p) => s + p.x, 0) / P0.length;
        const cy0 = P0.reduce((s, p) => s + p.y, 0) / P0.length;
        for (let e = 0; e < P0.length; e++) {
          const a = P0[e], b = P0[(e + 1) % P0.length];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          const n = Math.max(1, Math.floor(len / 1.35));
          for (let i = 0; i <= n; i++) {
            const t = i / n;
            if (e === 0 && t > 0.35 && t < 0.65) continue;   // ouverture d'entrée (arête voie)
            let x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
            // léger retrait vers l'intérieur (pas de haie à cheval sur la limite)
            x += (cx0 - x) * 0.03; y += (cy0 - y) * 0.03;
            spots.push({ x, y });
          }
        }
        const rngH = mulberry32(0xA1E);
        const inst = new THREE.InstancedMesh(built.geometry,
          new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), spots.length);
        inst.userData.sharedGeometry = true;
        inst.frustumCulled = false;
        const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Sc = new THREE.Vector3(), P = new THREE.Vector3();
        for (let i = 0; i < spots.length; i++) {
          const s = spots[i];
          const sc = (0.5 + rngH() * 0.35) / Math.max(1, built.canopyRadius || 1);
          P.set(s.x, groundAt(s.x, s.y), s.y);
          Q.setFromEuler(new THREE.Euler(0, rngH() * Math.PI * 2, 0));
          Sc.set(sc, sc * (0.9 + rngH() * 0.3), sc);
          M.compose(P, Q, Sc);
          inst.setMatrixAt(i, M);
        }
        inst.name = 'jardin-haie';
        hd.add(inst);
      }
    } catch { /* haie optionnelle */ }

    this._growIn(hd, 400, 1400);

    // ── CBS appliqué : coefficient de biotope RÉEL de la composition ──
    // (CBS_CLASSES TERLAB : pleine_terre 1.0 · semi_perméable 0.5 · imperméable 0)
    const CBS_COEF = {
      piscine: 0, terrasse: 0, kiosque: 0, pergola: 0, cuisine_ext: 0,
      bassin: 0.5, tisanerie: 0.5, potager: 1.0,
    };
    const parcelArea = Math.abs(this._parcelLocal.reduce((s, p, i, P) => {
      const q = P[(i + 1) % P.length]; return s + (p.x * q.y - q.x * p.y);
    }, 0) / 2);
    let mineral = 0, semi = 0;
    for (const am of amenities) {
      const a = (am.w ?? 3) * (am.h ?? 3);
      const c = CBS_COEF[am.amenityKey] ?? 0.5;
      if (c === 0) mineral += a; else if (c === 0.5) semi += a;
    }
    const cbs = parcelArea > 0
      ? (parcelArea - mineral - semi * 0.5) / parcelArea
      : null;
    this.stats = {
      ...(this.stats ?? {}),
      cbs: cbs != null ? +cbs.toFixed(2) : null,
      parcelArea: Math.round(parcelArea), mineralArea: Math.round(mineral), semiArea: Math.round(semi),
      plants: plants.length, amenities: amenities.length,
    };
    const p4 = this._session?.phases?.[4]?.data ?? {};
    const target = parseFloat(p4.cbs_cible ?? p4.cbs ?? '') || null;
    console.info(`[Diorama] CBS composition ≈ ${cbs?.toFixed(2)} `
      + `(parcelle ${Math.round(parcelArea)} m² · minéral ${Math.round(mineral)} m² · semi ${Math.round(semi)} m²)`
      + (target ? ` — cible P04 : ${target}` : ''));

    console.info(`[Diorama] parcelle HD : ${plants.length} végétaux, ${amenities.length} aménités`);
  },

  // ── bâti BDTOPO extrudé, posé sur le MNT — UNE requête WFS PAR TILE ──
  _batIds: new Set(),          // dédoublonnage (les bbox de tiles se recouvrent aux bords)
  _batMat: null,
  _batEdge: null,

  async _buildTileBuildings(tx, ty, tileMesh, ringIdx) {
    const THREE = this.THREE;
    const { clat, clng, lngM } = this._centroid;
    const p4 = window.proj4;
    if (!p4) return;
    const b = tileMesh.userData.utmBounds;
    const [w, s] = p4('EPSG:2975', 'EPSG:4326', [b.minE, b.minN]);
    const [e, n] = p4('EPSG:2975', 'EPSG:4326', [b.maxE, b.maxN]);
    const params = new URLSearchParams({
      SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature',
      TYPENAMES: 'BDTOPO_V3:batiment', OUTPUTFORMAT: 'application/json',
      COUNT: '400', BBOX: `${w},${s},${e},${n},EPSG:4326`,
    });
    const res = await fetch(`https://data.geopf.fr/wfs?${params}`, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`WFS ${res.status}`);
    const gj = await res.json();
    if (this._disposed || !gj?.features?.length) return;

    // DoubleSide : les emprises BDTOPO auto-intersectées inversent des faces
    // (toits noirs / murs troués) — on rend les deux côtés.
    this._batMat ??= new THREE.MeshStandardMaterial({ color: 0xcdc2ab, roughness: 0.85, side: THREE.DoubleSide });
    this._batEdge ??= new THREE.LineBasicMaterial({ color: 0x8a7a5a, transparent: true, opacity: 0.35 });
    let count = 0;
    for (const f of gj.features) {
      if (f.id && this._batIds.has(f.id)) continue;
      if (f.id) this._batIds.add(f.id);
      // BDTOPO livre majoritairement des MultiPolygon (coords 3D, z=-1000 ignoré)
      const ring = f.geometry?.type === 'MultiPolygon'
        ? f.geometry.coordinates?.[0]?.[0]
        : f.geometry?.coordinates?.[0];
      if (!ring || ring.length < 4 || !Array.isArray(ring[0])) continue;
      const loc = ring.map(c => ({ x: (c[0] - clng) * lngM, z: -(c[1] - clat) * LAT_M }));
      // Maquette de l'entourage : on s'arrête à +MAQUETTE_MARGIN du terrain
      const ccx = loc.reduce((s2, p) => s2 + p.x, 0) / loc.length;
      const ccz = loc.reduce((s2, p) => s2 + p.z, 0) / loc.length;
      if (this._distToParcel(ccx, ccz) > this.MAQUETTE_MARGIN) continue;
      // Garde-fous visuels : les emprises géantes (halles, hôpitaux tronqués
      // par la découpe MultiPolygon) font des dalles écrasantes — on écarte.
      const xs = loc.map(p => p.x), zs = loc.map(p => p.z);
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
      if (span > 140) continue;
      // Extrusion SANS miroir : le geste scale(1,1,-1) inverse le winding →
      // normales de toit vers le bas = toits noirs. Ici le flip nord/sud est
      // fait DANS le shape (y = −z), et le winding est forcé CCW (shoelace)
      // pour des normales de toit toujours vers le haut.
      let pts2 = loc.map(p => ({ x: p.x, y: -p.z }));
      const area2 = pts2.reduce((s2, p, i2, P) => {
        const q2 = P[(i2 + 1) % P.length]; return s2 + (p.x * q2.y - q2.x * p.y);
      }, 0);
      if (area2 < 0) pts2 = pts2.reverse();
      const shape = new THREE.Shape();
      shape.moveTo(pts2[0].x, pts2[0].y);
      for (let i = 1; i < pts2.length - 1; i++) shape.lineTo(pts2[i].x, pts2[i].y);
      shape.closePath();
      const h = Math.max(2.8, Math.min(22, parseFloat(f.properties?.hauteur) || 4.5));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);                // (x, y=−z, depth) → (x, depth, z)
      const mesh = new THREE.Mesh(geo, this._batMat);
      const cx = loc.reduce((s2, p) => s2 + p.x, 0) / loc.length;
      const cz = loc.reduce((s2, p) => s2 + p.z, 0) / loc.length;
      // Pose : MIN de 3 échantillons − 0.3 m d'encastrement — sur une pente,
      // poser au centroïde laisse un coin en porte-à-faux (flotte) ; le min
      // encastre, le terrain recouvre le pied côté amont.
      const g0 = this._sampleGround(cx, cz);
      const g1 = this._sampleGround(loc[0].x, loc[0].z);
      const g2 = this._sampleGround(loc[(loc.length / 2) | 0].x, loc[(loc.length / 2) | 0].z);
      mesh.position.y = Math.min(g0, g1, g2) - 0.3;
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), this._batEdge));
      const dist = Math.hypot(cx, cz);
      this._layers.batiments.add(mesh);
      this._growIn(mesh, 500 + dist * 2.0, 900);   // se répand depuis le site

      // ── Toiture v2 (noyau ciriani) sur le bâti PROCHE : la maquette de
      // l'entourage immédiat mérite de vrais toits en croupe qui suivent
      // l'emprise réelle. Échec du squelette (emprise pathologique) → le
      // toit plat de l'extrusion reste, nommément loggé.
      const near = this._distToParcel(ccx, ccz) <= 60 && span <= 40 && loc.length <= 14;
      if (near) {
        try {
          this._toitureMods ??= Promise.all([
            import('../services/toiture/index.js'),
            import('../services/toiture/roof-mesh.js'),
          ]);
          const [noyau, rm] = await this._toitureMods;
          const fp = noyau.ensureCCW(loc.map(p => [p.x, p.z]));
          const r2 = noyau.buildRoof(fp, noyau.allCroupe(fp.length, 19.3));   // pente 35 %
          if (r2.ok) {
            this._roofMat ??= new THREE.MeshStandardMaterial({
              color: 0x8a5a44, roughness: 0.85, side: THREE.DoubleSide,
            });
            const roof = rm.buildRoofMesh(noyau.buildModel(r2), { material: this._roofMat });
            roof.position.y = mesh.position.y + h;
            this._layers.batiments.add(roof);
            this._growIn(roof, 520 + dist * 2.0, 900);
            this._roofsV2 = (this._roofsV2 ?? 0) + 1;
          }
        } catch (e) {
          console.info('[Diorama] toit v2 refusé :', e?.message ?? e);
        }
      }
      count++;
    }
    console.info(`[Diorama] bâti tile ${tx}:${ty} : +${count} (total ${this._batIds.size}${this._roofsV2 ? `, ${this._roofsV2} toits v2` : ''})`);
  },

  // ── croissance radiale ───────────────────────────────────────────────
  // Les DALLES de terrain arrivent en douceur (petite montée, pas de scale —
  // une plaque de 500 m qui surgit de sous terre, « à voir » → non) ; la
  // POUSSE marquée est réservée à la végétation et au bâti.
  _growIn(obj, delayMs, durMs, { rise = 14, scaleFrom = 0.35 } = {}) {
    obj.visible = false;
    this._grow.push({
      obj, t0: performance.now() - this._clock0 + delayMs, dur: durMs,
      y: obj.position.y, rise, scaleFrom,
    });
  },

  _startLoop() {
    const tick = () => {
      if (this._disposed) return;
      this._animId = requestAnimationFrame(tick);
      this._controls?.update();
      const t = performance.now() - this._clock0;
      for (const g of this._grow) {
        if (g.done) continue;
        const k = (t - g.t0) / g.dur;
        if (k < 0) continue;
        const e = k >= 1 ? 1 : 1 - Math.pow(1 - k, 3);   // easeOutCubic
        g.obj.visible = true;
        g.obj.position.y = g.y - g.rise * (1 - e);       // surgit du sol
        g.obj.scale.setScalar(g.scaleFrom + (1 - g.scaleFrom) * e);
        if (k >= 1) { g.obj.position.y = g.y; g.obj.scale.setScalar(1); g.done = true; }
      }
      updateImpostorCamera(this._mats, this._cam);
      if (this._photosphere && this._photosphere.material.opacity < 1) {
        this._photosphere.material.opacity = Math.min(1, this._photosphere.material.opacity + 0.008);
      }
      this._renderer.render(this._scene, this._cam);
    };
    tick();
  },

  _frameCamera() {
    const y = this._groundY0;
    this._controls.target.set(0, y, 0);
    this._cam.position.set(48, y + 62, 64);     // vue de trois-quarts serrée sur la parcelle
    this._controls.minDistance = 25;
    this._controls.update();
  },

  _sampleGround(x, z) {
    const THREE = this.THREE;
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 4000, z), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObjects(this._tileMeshes, false);
    return hits[0]?.point.y ?? this._groundY0;
  },

  // ── calque cadastre (multicouche) ────────────────────────────────────
  // Ciblé PARCELLE : par défaut seule la tile centrale (celle de la parcelle,
  // le travail CBS) reçoit le liseré cadastral — maxRing pour élargir.
  async setCadastre(on, { maxRing = 0 } = {}) {
    const THREE = this.THREE;
    this._cadastreOn = !!on;
    for (const mesh of this._tileMeshes) {
      const ud = mesh.userData;
      if ((ud.ringIdx ?? 99) > maxRing) continue;
      const key = `${ud.tx}:${ud.ty}`;
      let entry = this._texCache.get(key);
      if (!entry) { entry = {}; this._texCache.set(key, entry); }
      if (!on) {
        if (entry.ortho) { mesh.material.map = entry.ortho; mesh.material.needsUpdate = true; }
        continue;
      }
      if (!entry.composite) {
        try {
          entry.ortho ??= mesh.material.map;
          const b = ud.utmBounds;
          const S = 512;
          const cadUrl = `${WMSR}?${new URLSearchParams({
            SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap',
            LAYERS: LAYER_CADASTRE, STYLES: '', CRS: 'EPSG:2975',
            BBOX: [b.minE, b.minN, b.maxE, b.maxN].join(','),
            WIDTH: S, HEIGHT: S, FORMAT: 'image/png', TRANSPARENT: 'true',
          })}`;
          const cad = await new Promise((res, rej) => {
            const im = new Image(); im.crossOrigin = 'anonymous';
            im.onload = () => res(im); im.onerror = () => rej(new Error('cadastre indisponible'));
            im.src = cadUrl;
          });
          const cv = document.createElement('canvas');
          cv.width = cv.height = S;
          const c = cv.getContext('2d');
          const src = entry.ortho?.image;
          if (src) c.drawImage(src, 0, 0, S, S);
          c.drawImage(cad, 0, 0, S, S);
          entry.composite = new THREE.CanvasTexture(cv);
          entry.composite.colorSpace = THREE.SRGBColorSpace ?? entry.composite.colorSpace;
          entry.composite.flipY = entry.ortho?.flipY ?? true;
        } catch (e) { console.info('[Diorama] cadastre :', e?.message ?? e); continue; }
      }
      mesh.material.map = entry.composite;
      mesh.material.needsUpdate = true;
    }
  },

  // ── photosphère 360 (fondue progressivement) ─────────────────────────
  async setPhotosphere(url) {
    const THREE = this.THREE;
    if (this._photosphere) {
      this._scene.remove(this._photosphere);
      this._photosphere.material.map?.dispose();
      this._photosphere.geometry.dispose();
      this._photosphere = null;
    }
    if (!url) return;
    const tex = await new THREE.TextureLoader().loadAsync(url);
    tex.colorSpace = THREE.SRGBColorSpace ?? tex.colorSpace;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(9000, 32, 16),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, transparent: true, opacity: 0, fog: false }),
    );
    sphere.name = 'photosphere';
    this._scene.add(sphere);
    this._photosphere = sphere;
  },

  // ── export GLB multicouche (groupes nommés = calques) ────────────────
  async exportGLB(filename = 'TERLAB_diorama.glb') {
    const { GLTFExporter } = await import('https://cdn.jsdelivr.net/npm/three@0.182.0/examples/jsm/exporters/GLTFExporter.js');
    return new Promise((resolve, reject) => {
      new GLTFExporter().parse(this._root, glb => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
        resolve(true);
      }, reject, { binary: true });
    });
  },

  resize() {
    const c = this._renderer?.domElement;
    if (!c) return;
    const w = c.clientWidth, h = c.clientHeight;
    this._renderer.setSize(w, h, false);
    this._cam.aspect = w / h;
    this._cam.updateProjectionMatrix();
  },

  dispose() {
    this._disposed = true;
    if (this._animId) cancelAnimationFrame(this._animId);
    this._controls?.dispose();
    this._scene?.traverse(o => {
      if (!o.userData?.sharedGeometry) o.geometry?.dispose?.();
      if (o.material && !Array.isArray(o.material)) { o.material.map?.dispose?.(); o.material.dispose?.(); }
    });
    this._renderer?.dispose();
    this._grow = []; this._mats = []; this._tileMeshes = [];
    this._texCache.clear();
    this._root = null; this._scene = null;
  },

  // ── utilitaires ──────────────────────────────────────────────────────
  _parcelRing(terrain) {
    const geom = terrain?.parcelle_geojson;
    const coords = geom?.type === 'Polygon' ? geom.coordinates?.[0] : geom?.coordinates?.[0]?.[0];
    if (!coords || coords.length < 3) return null;
    const ring = coords.slice();
    const a = ring[0], z = ring[ring.length - 1];
    if (a && z && a[0] === z[0] && a[1] === z[1]) ring.pop();
    return ring.length >= 3 ? ring : null;
  },

  _pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  },
};

export default TerrainDiorama;
