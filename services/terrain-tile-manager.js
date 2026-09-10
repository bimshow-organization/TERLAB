// ═══════════════════════════════════════════════════════════════════════
// TERLAB · services/terrain-tile-manager.js
// Streaming des tiles terrain pilote par la camera.
//
// - update() est appele sur EVENEMENT camera (change d'OrbitControls…),
//   PAS a chaque frame : un plancher de mouvement (10 m / zoom ×1.2)
//   court-circuite les recalculs inutiles.
// - Le palier LOD vient de BiomeLOD.pickLod (hysteresis HYST_UP/HYST_DOWN
//   existante — PAS reimplementee), mappe sur LOD_PIXEL_SIZES [1,2,4,8] m/px.
// - Remplacement progressif : file priorisee par distance croissante, max 2
//   fetches concurrents, AbortController par tile. L'ancien LOD reste affiche
//   jusqu'a ce que le nouveau soit pret (swap atomique), puis disposeTile.
// - Budget memoire : max N tiles residentes (defaut 25), eviction LRU des
//   plus lointaines.
// - CustomEvents `terlab:tile-loaded` / `terlab:tile-evicted` (traçabilite).
//
// @coords
//   project:   TERLAB
//   plan:      XZ (Three.js Y-up — repere de scene de services/terrain-tiles.js)
//   yAxis:     up
//   anchor:    origin UTM40S {E0, N0, alt0} unique, partage avec terrain-tiles
//   units:     meters
//   bearing:   none
//   north:     -Z
//   pairsWith: services/terrain-tiles.js
//   roundtrip: E = x + E0 ; N = N0 − z (aucune conversion propre a ce fichier)
//
// ECHELLE DE SCENE (`unitsPerMeter`) : les meshes de tiles restent TOUJOURS
// construits en metres (terrain-tiles ne connait que les metres). Quand la
// scene d'accueil n'est pas metrique (P05 : unites = metres × Buildings3DViewer._sf),
// on passe `unitsPerMeter` a init() : le GROUPE porte l'echelle
// (group.scale = unitsPerMeter), et toute position camera/target recue en
// unites-scene est ramenee en METRES avant tout calcul de distance / LOD /
// selection de tile. Les seuils MOVE_THRESHOLD_M / ZOOM_RATIO sont donc
// toujours exprimes en metres reels, quel que soit le facteur d'echelle.
// ═══════════════════════════════════════════════════════════════════════

import TerrainTiles, {
  tileForUTM, tileKey, tilesInRadius, tileCenterLocal, sortTilesByDistance,
  LOD_GEOMETRIC_ERRORS, LOD_PIXEL_SIZES,
} from './terrain-tiles.js';
import { focalPixels, pickLod } from '../utils/biome-lod.js';

const MAX_CONCURRENT = 2;        // fetches WMS simultanes
const MOVE_THRESHOLD_M = 10;     // plancher de deplacement camera
const ZOOM_RATIO = 1.2;          // plancher de zoom (ratio de distance au sol)
const FAIL_COOLDOWN_MS = 30000;  // pas de re-tentative d'une tile en echec avant 30 s

const TerrainTileManager = {

  _scene: null,
  _camera: null,
  _origin: null,          // {E0, N0, alt0}
  _radiusTiles: 2,
  _budget: 25,
  _tolerance: 3,          // px d'erreur ecran toleres (pickLod)
  _viewportHeight: 900,
  _ortho: false,
  _unitsPerMeter: 1,      // unites de scene par metre (1 = scene metrique)

  group: null,            // THREE.Group parent des tiles

  _resident: new Map(),   // "tx:ty" → { mesh, lod, tx, ty, lastUsed, distance }
  _loading: new Map(),    // "tx:ty" → { lod, ctrl }
  _queue: [],             // jobs {tx, ty, lod, distance} tries par distance
  _active: 0,
  _failedAt: new Map(),   // "tx:ty:lod" → timestamp du dernier echec
  _lastCamPos: null,
  _lastGroundDist: null,
  _gen: 0,                // generation de selection — invalide les jobs perimes

  /**
   * @param {Object} o
   * @param {THREE.Scene}  o.scene        Scene d'accueil (le group y est ajoute)
   * @param {THREE.Camera} o.camera       Camera perspective active
   * @param {Object}       o.origin       {E0, N0, alt0} UTM40S — MEME origine que le reste de la scene
   * @param {number}      [o.radiusTiles=2]      Rayon Chebyshev autour du point regarde
   * @param {number}      [o.budget=25]          Tiles residentes max (LRU)
   * @param {number}      [o.tolerance=3]        Erreur ecran toleree (px)
   * @param {number}      [o.viewportHeight]     Hauteur du viewport en px (focale ecran)
   * @param {boolean}     [o.ortho=false]        Drapage orthophoto IGN par tile
   * @param {number}      [o.unitsPerMeter=1]    Unites de scene par metre (scene non metrique)
   */
  async init({ scene, camera, origin, radiusTiles = 2, budget = 25, tolerance = 3, viewportHeight, ortho = false, unitsPerMeter = 1 } = {}) {
    if (!scene || !camera) throw new Error('[TileManager] init : scene et camera requis');
    TerrainTiles.init({ origin });
    const THREE = await TerrainTiles._three();

    this._scene = scene;
    this._camera = camera;
    this._origin = TerrainTiles._origin;
    this._radiusTiles = radiusTiles;
    this._budget = Math.max(1, budget);
    this._tolerance = tolerance;
    this._ortho = ortho;
    this._unitsPerMeter = (isFinite(unitsPerMeter) && unitsPerMeter > 0) ? unitsPerMeter : 1;
    this._viewportHeight = viewportHeight
      ?? (typeof window !== 'undefined' ? window.innerHeight : 900);

    this.group = new THREE.Group();
    this.group.name = 'TerrainTilesGroup';
    // Les meshes restent en metres : c'est le groupe qui porte l'echelle de scene.
    this.group.scale.setScalar(this._unitsPerMeter);
    scene.add(this.group);

    this.update({ force: true });
    return this;
  },

  // ── Point regarde : projection du centre d'orbite au sol ─────────────
  // Si l'appelant a des OrbitControls, il peut passer `target` a update().
  // Retourne des METRES (position camera divisee par unitsPerMeter) : la
  // direction de visee, elle, est unitaire donc insensible a l'echelle.
  _groundTarget() {
    const cam = this._camera;
    const u = this._unitsPerMeter || 1;
    const px = cam.position.x / u, py = cam.position.y / u, pz = cam.position.z / u;
    // Direction de visee monde
    const e = cam.matrixWorld.elements;
    const dx = -e[8], dy = -e[9], dz = -e[10];
    if (dy < -1e-4) {
      const t = -py / dy;                       // intersection avec le plan y=0
      return { x: px + dx * t, y: 0, z: pz + dz * t };
    }
    return { x: px, y: 0, z: pz };              // camera horizontale : sous elle
  },

  /**
   * A appeler sur evenement camera (controls 'change', fin de zoom…).
   * Seuil de deplacement : > MOVE_THRESHOLD_M ou zoom ×ZOOM_RATIO, sinon no-op.
   * @param {Object} [o]
   * @param {{x,y,z}} [o.target]  Centre d'orbite (OrbitControls.target) si connu
   * @param {boolean} [o.force]   Ignore le plancher de mouvement
   */
  update({ target, force = false } = {}) {
    if (!this._camera || !this.group) return;
    const cam = this._camera;
    cam.updateMatrixWorld?.();

    // ── unites de scene → METRES avant tout calcul (distance / LOD / tiles) ──
    const u = this._unitsPerMeter || 1;
    const gt = target
      ? { x: target.x / u, y: (target.y ?? 0) / u, z: target.z / u }
      : this._groundTarget();
    const camLocal = { x: cam.position.x / u, y: cam.position.y / u, z: cam.position.z / u };
    const groundDist = Math.max(1, Math.hypot(camLocal.x - gt.x, camLocal.y - gt.y, camLocal.z - gt.z));

    // ── Plancher de mouvement : pas de recalcul pour un tremblement ──
    if (!force && this._lastCamPos) {
      const moved = Math.hypot(
        camLocal.x - this._lastCamPos.x,
        camLocal.y - this._lastCamPos.y,
        camLocal.z - this._lastCamPos.z,
      );
      const ratio = Math.max(groundDist, this._lastGroundDist) / Math.min(groundDist, this._lastGroundDist);
      if (moved < MOVE_THRESHOLD_M && ratio < ZOOM_RATIO) return;
    }
    this._lastCamPos = camLocal;
    this._lastGroundDist = groundDist;
    this._gen++;

    // ── Selection : tiles autour du point regarde, LOD par pickLod ──
    const { E0, N0 } = this._origin;
    const { tx: ctx, ty: cty } = tileForUTM(E0 + gt.x, N0 - gt.z);   // inverse du mapping @coords
    const fovRad = (cam.fov ?? 50) * Math.PI / 180;
    const focal = focalPixels(this._viewportHeight, fovRad);

    const candidates = sortTilesByDistance(
      tilesInRadius(ctx, cty, this._radiusTiles), camLocal, this._origin, gt.y,
    );

    const desired = new Map();   // "tx:ty" → {tx, ty, lod, distance}
    const now = Date.now();
    for (const t of candidates) {
      const k = `${t.tx}:${t.ty}`;
      const current = this._resident.get(k)?.lod;   // hysteresis : palier courant
      const lod = pickLod(LOD_GEOMETRIC_ERRORS, t.distance, focal, this._tolerance, current);
      desired.set(k, { tx: t.tx, ty: t.ty, lod, distance: t.distance });
    }

    // ── Annulation des chargements sortis du champ ou de LOD perime ──
    for (const [k, job] of this._loading) {
      const want = desired.get(k);
      if (!want || want.lod !== job.lod) {
        job.ctrl.abort();
        this._loading.delete(k);
      }
    }

    // ── File de chargement priorisee par distance croissante ──
    this._queue = [];
    for (const want of desired.values()) {
      const k = `${want.tx}:${want.ty}`;
      const res = this._resident.get(k);
      if (res) { res.lastUsed = now; res.distance = want.distance; }
      if (res?.lod === want.lod) continue;                        // deja au bon palier
      if (this._loading.get(k)?.lod === want.lod) continue;       // deja en route
      const failTs = this._failedAt.get(tileKey(want.tx, want.ty, want.lod));
      if (failTs && now - failTs < FAIL_COOLDOWN_MS) continue;    // cooldown apres echec
      this._queue.push(want);
    }
    this._queue.sort((a, b) => a.distance - b.distance);
    this._desired = desired;

    this._pump();
    this._evict();
  },

  // ── Pompe : max MAX_CONCURRENT fetches, une tile a la fois par slot ──
  _pump() {
    while (this._active < MAX_CONCURRENT && this._queue.length) {
      const job = this._queue.shift();
      const k = `${job.tx}:${job.ty}`;
      if (this._loading.has(k)) continue;
      if (this._resident.get(k)?.lod === job.lod) continue;
      this._active++;
      const ctrl = new AbortController();
      this._loading.set(k, { lod: job.lod, ctrl });
      this._loadOne(job, k, ctrl)
        .catch(() => {})    // erreurs deja traitees dans _loadOne
        .finally(() => {
          this._active--;
          if (this._loading.get(k)?.ctrl === ctrl) this._loading.delete(k);
          this._pump();
          this._evict();
        });
    }
  },

  async _loadOne(job, k, ctrl) {
    const { tx, ty, lod } = job;
    try {
      const { demData, meta } = await TerrainTiles.fetchTile(tx, ty, lod, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      const mesh = await TerrainTiles.buildTileMesh(demData, lod, this._origin);
      if (this._ortho) {
        try {
          await TerrainTiles.applyOrtho(mesh, { signal: ctrl.signal });
        } catch (err) {
          if (err?.name === 'AbortError') throw err;
          console.warn(`[TileManager] ortho ${k} echec (vertex-colors conserves):`, err?.message ?? err);
        }
      }
      if (ctrl.signal.aborted) { TerrainTiles.disposeTile(mesh); return; }

      // ── Swap atomique : la nouvelle tile entre, PUIS l'ancienne sort ──
      this.group.add(mesh);
      const old = this._resident.get(k);
      if (old) {
        this.group.remove(old.mesh);
        TerrainTiles.disposeTile(old.mesh);
      }
      this._resident.set(k, { mesh, lod, tx, ty, lastUsed: Date.now(), distance: job.distance });
      this._emit('terlab:tile-loaded', {
        tx, ty, lod, pixelSizeM: LOD_PIXEL_SIZES[lod],
        fromCache: meta.fromCache, replacedLod: old?.lod ?? null,
        resident: this._resident.size,
      });
    } catch (err) {
      if (err?.name === 'AbortError') return;   // tile sortie du champ : silence
      this._failedAt.set(tileKey(tx, ty, lod), Date.now());
      console.warn(`[TileManager] tile ${tx}:${ty} lod ${lod} echec:`, err?.message ?? err);
    }
  },

  // ── Eviction LRU des plus lointaines au-dela du budget ──────────────
  _evict() {
    if (this._resident.size <= this._budget) return;
    const victims = [...this._resident.entries()]
      .filter(([k]) => !this._desired?.has(k))           // jamais une tile encore voulue
      .sort((a, b) => (b[1].distance ?? 0) - (a[1].distance ?? 0)
                   || (a[1].lastUsed ?? 0) - (b[1].lastUsed ?? 0));
    for (const [k, res] of victims) {
      if (this._resident.size <= this._budget) break;
      this.group.remove(res.mesh);
      TerrainTiles.disposeTile(res.mesh);
      this._resident.delete(k);
      this._emit('terlab:tile-evicted', {
        tx: res.tx, ty: res.ty, lod: res.lod, resident: this._resident.size,
      });
    }
  },

  _emit(name, detail) {
    if (typeof document === 'undefined') return;
    document.dispatchEvent(new CustomEvent(name, { detail }));
  },

  /** Nombre de tiles residentes / en cours (debug, HUD). */
  stats() {
    const byLod = {};
    for (const r of this._resident.values()) byLod[r.lod] = (byLod[r.lod] ?? 0) + 1;
    return { resident: this._resident.size, loading: this._loading.size, queued: this._queue.length, byLod };
  },

  /** Teardown complet : aborts, disposes, retrait du group. */
  dispose() {
    for (const job of this._loading.values()) job.ctrl.abort();
    this._loading.clear();
    this._queue = [];
    for (const res of this._resident.values()) {
      this.group?.remove(res.mesh);
      TerrainTiles.disposeTile(res.mesh);
    }
    this._resident.clear();
    this._failedAt.clear();
    if (this.group && this._scene) this._scene.remove(this.group);
    this.group = null;
    this._lastCamPos = null;
    this._lastGroundDist = null;
    this._unitsPerMeter = 1;
  },
};

export default TerrainTileManager;
