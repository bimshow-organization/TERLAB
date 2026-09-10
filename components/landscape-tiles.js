// ═══════════════════════════════════════════════════════════════════════
// TERLAB · components/landscape-tiles.js
// « Grand paysage » : attache non intrusive du terrain IGN streame par tiles
// (services/terrain-tile-manager.js) a une scene Three.js existante — en
// P05 celle de components/buildings-3d-viewer.js, dont ce fichier ne modifie
// AUCUNE ligne : il ne recoit que des references (scene, camera, controls, sf).
//
// @coords
//   project:   TERLAB
//   plan:      XZ (Three.js Y-up)
//   yAxis:     up
//   anchor:    centroid(lng,lat) → origine UTM40S {E0, N0, alt0 = groundAlt}
//   units:     METRES cote tiles ; la scene hote peut etre a une autre echelle
//              (P05 : unites = metres × Buildings3DViewer._sf) — c'est le
//              GROUPE du manager qui porte l'echelle (group.scale = sf),
//              les meshes de tiles restent metriques.
//   bearing:   none
//   north:     -Z
//   pairsWith: services/terrain-tiles.js · services/terrain-tile-manager.js
//   roundtrip: E = x/sf + E0 ; N = N0 − z/sf ; alt = y/(sf·ve) + groundAlt
//
// Un SEUL y-flip dans toute la chaine : il est deja fait dans terrain-tiles
// (z = −(N − N0)). Ici : aucune rotation, aucun flip supplementaire — juste
// une homothetie. Cote hote, buildings-3d-viewer utilise la meme convention
// (x = ΔE·sf, z = −ΔN·sf, y = (alt − groundZ)·sf·ve), d'ou l'alignement.
//
// ALIGNEMENT VERTICAL : alt0 = groundAlt (le groundZ du contexte LiDAR de
// P05) ⇒ les deux terrains partagent leur zero d'altitude. L'exageration
// verticale de l'hote est reportee sur group.scale.y (= sf · ve) pour rester
// exact meme si ve ≠ 1 ; en P05 VERTICAL_EXAG = 1.0 donc scale uniforme.
// Reserve : avec ve ≠ 1 les distances LOD du manager ignorent l'exageration
// (elles sont calculees en metres reels) — effet negligeable sur le palier.
//
// PROJECTION : le viewer P05 place ses objets en equirectangulaire locale
// (Δlng · 111320·cos φ, Δlat · 111320) alors que les tiles sont en UTM40S.
// L'ecart (facteur d'echelle UTM ≈ 0.9996 + convergence des meridiens) reste
// sous le metre a 1 km du centroide : invisible a l'echelle du grand paysage.
// ═══════════════════════════════════════════════════════════════════════

import TerrainTileManager from '../services/terrain-tile-manager.js';
import TerrainTiles, { TILE_SIZE_M } from '../services/terrain-tiles.js';
import BILTerrain from '../services/bil-terrain.js';

const LandscapeTiles = {

  _active: false,
  _mgr: null,
  _controls: null,
  _camera: null,
  _scene: null,
  _onRender: null,
  _onControlsChange: null,
  _onTileEvent: null,
  _saved: null,          // etat camera/fog/controls a restaurer
  _usedOrtho: false,     // drapage ortho actif → cache texture a purger

  /** Groupe Three des tiles (null si inactif) — expose pour le cadrage hote. */
  get group() { return this._mgr?.group ?? null; },

  /** Scene hote a laquelle l'instance est attachee (null si inactif). */
  get hostScene() { return this._scene; },

  /** true si le grand paysage est attache. */
  get active() { return this._active; },

  /**
   * Attache le terrain streame a la scene hote.
   *
   * @param {Object} o
   * @param {THREE.Scene}  o.scene           Scene hote
   * @param {THREE.Camera} o.camera          Camera perspective hote
   * @param {Object}      [o.controls]       OrbitControls hote (event 'change')
   * @param {number}      [o.sf=1]           Unites de scene par metre (Buildings3DViewer._sf)
   * @param {number}      [o.verticalExag=1] Exageration verticale de l'hote
   * @param {number[]}     o.centroid        [lng, lat] du site (origine de scene)
   * @param {number}      [o.groundAlt=0]    Altitude NGR du zero de scene (LiDAR groundZ)
   * @param {number}      [o.radiusTiles=2]  Rayon Chebyshev en tiles de 500 m
   * @param {boolean}     [o.ortho=false]    Drapage orthophoto IGN
   * @param {number}      [o.tolerance=6]    Erreur ecran toleree (px) — 6 = contexte
   *                                         d'arriere-plan, evite un LOD 0 partout
   * @param {number}      [o.budget=20]      Tiles residentes max (eviction LRU)
   * @param {Function}    [o.onRender]       Appele apres chaque tile chargee/evincee
   * @param {number}      [o.viewportHeight] Hauteur du viewport px (defaut window.innerHeight)
   * @returns {Promise<boolean>} false en cas d'echec (proj4/reseau) — jamais de throw
   */
  async enable({
    scene, camera, controls, sf = 1, verticalExag = 1, centroid,
    groundAlt = 0, radiusTiles = 2, ortho = false, onRender, viewportHeight,
    tolerance = 6, budget = 20,
  } = {}) {
    if (this._active) return true;
    if (!scene || !camera) {
      console.warn('[LandscapeTiles] scene et camera requis');
      return false;
    }
    const lng = Number(centroid?.[0]), lat = Number(centroid?.[1]);
    if (!isFinite(lng) || !isFinite(lat)) {
      console.warn('[LandscapeTiles] centroid [lng, lat] invalide :', centroid);
      return false;
    }
    const upm = (isFinite(sf) && sf > 0) ? sf : 1;
    const ve  = (isFinite(verticalExag) && verticalExag > 0) ? verticalExag : 1;

    try {
      // ── Origine UTM40S partagee : proj4 charge paresseusement par BILTerrain ──
      const [E0, N0] = await BILTerrain.lngLatToUTM(lng, lat);
      if (!isFinite(E0) || !isFinite(N0)) throw new Error('projection UTM40S invalide');
      const alt0 = isFinite(groundAlt) ? groundAlt : 0;

      await TerrainTileManager.init({
        scene, camera,
        origin: { E0, N0, alt0 },
        radiusTiles, ortho, tolerance, budget,
        unitsPerMeter: upm,
        viewportHeight: viewportHeight
          ?? (typeof window !== 'undefined' ? window.innerHeight : 900),
      });
      this._mgr = TerrainTileManager;
      this._usedOrtho = !!ortho;

      // Exageration verticale de l'hote (uniquement si ≠ 1 — sinon scale uniforme)
      if (ve !== 1 && this._mgr.group) this._mgr.group.scale.y = upm * ve;

      this._scene = scene;
      this._camera = camera;
      this._controls = controls ?? null;
      this._onRender = typeof onRender === 'function' ? onRender : null;

      // ── Portee visuelle : la scene hote est cadree sur la parcelle (fog et
      //    far plane serres). On les elargit le temps du grand paysage, et on
      //    memorise l'etat pour le restituer a l'identique dans disable().
      const reachU = (radiusTiles + 0.5) * TILE_SIZE_M * upm;   // unites de scene
      this._saved = {
        far: camera.far,
        fog: scene.fog ? { near: scene.fog.near, far: scene.fog.far } : null,
        maxDistance: controls?.maxDistance ?? null,
      };
      if (isFinite(camera.far)) {
        camera.far = Math.max(camera.far, reachU * 3);
        camera.updateProjectionMatrix?.();
      }
      if (scene.fog && isFinite(scene.fog.near)) {
        scene.fog.near = Math.max(scene.fog.near, reachU * 0.25);
        scene.fog.far  = Math.max(scene.fog.far,  reachU * 0.95);
      }
      if (controls && isFinite(controls.maxDistance)) {
        controls.maxDistance = Math.max(controls.maxDistance, reachU * 1.5);
      }

      // ── Branchements ──────────────────────────────────────────────
      // Le manager convertit lui-meme unites-scene → metres (unitsPerMeter),
      // on lui passe donc le target d'OrbitControls tel quel.
      if (controls?.addEventListener) {
        this._onControlsChange = () => {
          try { this._mgr?.update({ target: controls.target }); }
          catch (err) { console.warn('[LandscapeTiles] update echec:', err?.message ?? err); }
        };
        controls.addEventListener('change', this._onControlsChange);
      }
      if (typeof document !== 'undefined') {
        this._onTileEvent = () => { try { this._onRender?.(); } catch { /* rendu hote */ } };
        document.addEventListener('terlab:tile-loaded', this._onTileEvent);
        document.addEventListener('terlab:tile-evicted', this._onTileEvent);
      }

      this._active = true;
      this._mgr.update({ target: controls?.target, force: true });
      this._onRender?.();
      console.info(`[LandscapeTiles] actif — origine UTM40S ${E0.toFixed(0)}/${N0.toFixed(0)}`
        + ` · alt0 ${alt0.toFixed(1)} m · ${upm.toFixed(4)} unite/m · rayon ${radiusTiles} tiles`);
      return true;

    } catch (err) {
      console.warn('[LandscapeTiles] activation impossible :', err?.message ?? err);
      try { this._teardown(); } catch { /* best effort */ }
      return false;
    }
  },

  /** Detache et libere tout (meshes, textures, listeners) + restaure l'hote. */
  disable() {
    if (!this._active && !this._mgr) return;
    const cb = this._onRender;
    this._teardown();
    try { cb?.(); } catch { /* rendu hote */ }
  },

  // ── Teardown commun (echec d'activation ou disable explicite) ────────
  _teardown() {
    if (this._controls && this._onControlsChange) {
      this._controls.removeEventListener?.('change', this._onControlsChange);
    }
    if (typeof document !== 'undefined' && this._onTileEvent) {
      document.removeEventListener('terlab:tile-loaded', this._onTileEvent);
      document.removeEventListener('terlab:tile-evicted', this._onTileEvent);
    }
    this._onControlsChange = null;
    this._onTileEvent = null;

    try { TerrainTileManager.dispose(); } catch (err) {
      console.warn('[LandscapeTiles] dispose manager:', err?.message ?? err);
    }
    // Les textures ortho vivent dans un cache partage hors des meshes.
    if (this._usedOrtho) {
      try { TerrainTiles.clearOrthoCache?.(); } catch { /* best effort */ }
      this._usedOrtho = false;
    }

    // Restauration de l'etat visuel de l'hote
    const s = this._saved;
    if (s) {
      if (this._camera && isFinite(s.far)) {
        this._camera.far = s.far;
        this._camera.updateProjectionMatrix?.();
      }
      if (this._scene?.fog && s.fog) {
        this._scene.fog.near = s.fog.near;
        this._scene.fog.far  = s.fog.far;
      }
      if (this._controls && s.maxDistance != null) this._controls.maxDistance = s.maxDistance;
    }
    this._saved = null;

    this._mgr = null;
    this._scene = null;
    this._camera = null;
    this._controls = null;
    this._onRender = null;
    this._active = false;
  },

  /** Stats du manager (HUD / debug). */
  stats() { return this._mgr?.stats?.() ?? null; },
};

export default LandscapeTiles;
