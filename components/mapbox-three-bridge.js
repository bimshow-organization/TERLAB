/**
 * MapboxThreeBridge — pont de calage Three.js ↔ Mapbox GL (port vanilla du
 * pattern de production BIMSHOW web-app : mapbox.component.ts, updateTransform
 * + custom layer render).
 *
 * Architecture : le custom layer Mapbox ne dessine RIEN dans le contexte GL de
 * la carte. Il sert d'HORLOGE (cadence de rendu) et de SOURCE DE MATRICE
 * (l'argument `matrix` de render(gl, matrix)). Le rendu Three vit dans un
 * canvas séparé, transparent, superposé au canvas Mapbox (pas de contexte GL
 * partagé → pas de conflits d'état GL, pas de resetState).
 *
 * @coords
 *   project:   TERLAB
 *   plan:      XY (scène locale : X = est, Y = nord, Z = altitude → Z-up)
 *   yAxis:     up (Y scène pointe le NORD ; le Y mercator Mapbox est SUD-positif,
 *              le flip vit UNIQUEMENT dans scale(s, -s, s) — jamais ailleurs)
 *   anchor:    geodetic(lng,lat) — origine (0,0,0) de la scène posée sur le globe
 *   units:     meters (scène) → unités mercator via meterInMercatorCoordinateUnits()
 *   bearing:   semantic (rotateDeg tourne le MODÈLE autour de son centre ;
 *              découplé du bearing visuel de la carte Mapbox)
 *   north:     rotation Z trigonométrique (anti-horaire vue du ciel, 0° = axes alignés)
 *   pairsWith: custom layer Mapbox (matrice mercator→clip fournie par render(gl, matrix))
 *   roundtrip: scripts/probe-bridge-math.mjs — invariance du centre sous rotation
 *              (sandwich off⁻¹·euler·off) + flip Y appliqué exactement une fois
 *              (det de la partie linéaire = -s³)
 *
 * NB convention : la matrice `l` envoie (x,y,z) scène → (est, sud, haut) mercator
 * via (s·x, -s·y, s·z). La scène est donc Z-up (comme les IFC BIMSHOW). Pour du
 * contenu Three « classique » Y-up, appliquer rotateX(-π/2)+scale(1,1,-1) sur la
 * géométrie (double-flip atomique, cf. skill coord-systems) — pas dans ce pont.
 *
 * Usage :
 *   const bridge = await MapboxThreeBridge.create({ map, origin:{lng,lat}, elevation:0, rotateDeg:0 });
 *   bridge.scene.add(mesh);                      // mètres locaux, Z-up
 *   bridge.setModelCenter(bboxCenter);           // PIÈGE 3 : rien ne s'affiche avant
 */

const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.module.js';

let _instanceCount = 0;

/**
 * Compose la matrice « locale » l (scène mètres → mercator), à multiplier à
 * droite de la matrice mercator→clip de Mapbox : projectionMatrix = m · l.
 *
 * Fonction PURE (exportée pour le probe scripts/probe-bridge-math.mjs).
 *
 * @param {object} THREE  namespace Three (ou mock : Matrix4, Vector3, Euler)
 * @param {object} t      { translateX, translateY, translateZ, scale, rotateZ,
 *                          center: {x,y} (centre de rotation, en mètres scène) }
 * @returns {THREE.Matrix4}
 */
export function composeLayerMatrix(THREE, t) {
  // Rotation sémantique du modèle (Z scène = axe vertical).
  const euler = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(0, 0, t.rotateZ || 0, 'XYZ')
  );

  // PIÈGE 2 : sandwich off⁻¹ · euler · off. Sans lui, la rotation se fait
  // autour de l'origine de la scène et le modèle ORBITE autour de (0,0) au
  // lieu de pivoter sur lui-même. Le sandwich ramène le centre du modèle sur
  // l'origine, tourne, puis le repousse : le centre est invariant.
  const off = new THREE.Matrix4().makeTranslation(-t.center.x, -t.center.y, 0);
  const offInv = off.clone().invert();

  return new THREE.Matrix4()
    .makeTranslation(t.translateX, t.translateY, t.translateZ)
    // PIÈGE 1 : le -s sur Y est l'UNIQUE flip de la chaîne. Le Y mercator est
    // sud-positif, le Y scène nord-positif. Ce -scale va PAR PAIRE avec le
    // `merc.y - offsetY*meter` de _updateTransform : toucher l'un sans l'autre
    // = modèle en miroir ou offset inversé.
    .scale(new THREE.Vector3(t.scale, -t.scale, t.scale))
    .multiply(offInv)
    .multiply(euler)
    .multiply(off);
}

export class MapboxThreeBridge {
  /**
   * @param {object}      opts
   * @param {mapboxgl.Map} opts.map        carte Mapbox GL existante
   * @param {object}      opts.origin      { lng, lat } origine GPS de la scène
   * @param {number}      [opts.elevation] altitude (m) du z=0 scène — utilisée
   *                                       seulement si le terrain DEM est actif
   * @param {number}      [opts.rotateDeg] rotation sémantique du modèle (°, anti-horaire)
   */
  static async create({ map, origin, elevation = 0, rotateDeg = 0 } = {}) {
    if (!map || typeof map.addLayer !== 'function') {
      throw new Error('[MapboxThreeBridge] `map` doit être une instance mapboxgl.Map');
    }
    // Guard : lat/lng invalides → on refuse de construire un transform NaN
    // (un NaN dans la projectionMatrix rend la scène invisible sans erreur).
    if (!origin || !Number.isFinite(Number(origin.lng)) || !Number.isFinite(Number(origin.lat))) {
      throw new Error('[MapboxThreeBridge] origin.lng / origin.lat invalides (NaN)');
    }
    if (typeof mapboxgl === 'undefined') {
      throw new Error('[MapboxThreeBridge] mapboxgl global absent (TERLAB charge Mapbox GL v3.7 en <script>)');
    }
    // Three.js partagé BIMSHOW : jamais de double bundle (cf. CLAUDE.md).
    const THREE = (typeof window !== 'undefined' && window.THREE)
      ? window.THREE
      : await import(THREE_CDN);

    return new MapboxThreeBridge(THREE, { map, origin, elevation, rotateDeg });
  }

  /** Ne pas appeler directement — passer par MapboxThreeBridge.create(). */
  constructor(THREE, { map, origin, elevation, rotateDeg }) {
    this.THREE = THREE;
    this.map = map;

    this._origin = { lng: Number(origin.lng), lat: Number(origin.lat) };
    this._elevation = Number(elevation) || 0;
    this._rotateDeg = Number(rotateDeg) || 0;
    this._offset = { x: 0, y: 0, z: 0 };     // offsets mètres locaux (est / nord / haut)
    this._center = null;                     // PIÈGE 3 : null tant que la bbox est inconnue
    this._transform = {};                    // rempli par _updateTransform()
    this._lastMapboxMatrix = null;           // dernière matrice mercator→clip (pour captureComposite)
    this._disposed = false;
    this._layerId = `terlab-three-bridge-${++_instanceCount}`;

    // ── Renderer : canvas transparent superposé au canvas Mapbox ──────────
    // (port de #rendererContainer en position:absolute de mapbox.component.scss)
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,                 // fond transparent → la carte reste visible dessous
      preserveDrawingBuffer: true, // requis pour drawImage() dans captureComposite()
    });
    this.renderer.setPixelRatio((typeof window !== 'undefined' && window.devicePixelRatio) || 1);

    const container = map.getContainer();
    const canvas = this.renderer.domElement;
    canvas.className = 'terlab-three-bridge-canvas';
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';  // la carte garde pan/zoom/click
    container.appendChild(canvas);
    this._resizeRenderer();

    // ── Scène (mètres locaux, Z-up — voir header @coords) ─────────────────
    this.scene = new THREE.Scene();
    // Caméra pilotée uniquement via projectionMatrix (on ne touche à RIEN d'autre).
    this.camera = new THREE.Camera();

    // Lumières par défaut : la scène est visible sans setup côté appelant.
    // Repère Z-up → le ciel de l'hémisphérique vient de +Z.
    const hemi = new THREE.HemisphereLight(0xffffff, 0x556644, 0.9);
    hemi.position.set(0, 0, 1);
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(120, 80, 200); // est/nord/haut — soleil de matinée générique
    this.scene.add(hemi, dir);

    // ── Custom layer Mapbox : horloge + source de matrice ─────────────────
    this._layer = {
      id: this._layerId,
      type: 'custom',
      renderingMode: '3d',
      onAdd: () => { /* rien : le contexte GL de la carte n'est pas utilisé */ },
      render: (_gl, matrix) => this._onMapRender(matrix),
    };
    // ⚠ PIÈGE (vérifié au débug headless) : isStyleLoaded() est transitoirement
    // faux même sur une carte chargée (ajout de couches en cours), et 'load'
    // ne tire qu'UNE fois dans la vie de la carte — s'y raccrocher après coup
    // = layer jamais ajouté, scène jamais rendue, sans aucune erreur.
    // Stratégie : tenter tout de suite (try/catch), repli sur 'idle' qui
    // retire à CHAQUE stabilisation de la carte.
    const addNow = () => {
      if (this._disposed || map.getLayer(this._layerId)) return true;
      try {
        map.addLayer(this._layer);
        map.triggerRepaint();   // premier rendu sans attendre une interaction
        return true;
      } catch (_) { return false; }
    };
    if (!addNow()) map.once('idle', addNow);
    // setStyle() efface les custom layers → on se ré-ajoute.
    this._onStyleLoad = () => {
      if (this._disposed) return;
      if (!map.getLayer(this._layerId)) map.addLayer(this._layer);
      this._updateTransform();
    };
    map.on('style.load', this._onStyleLoad);

    // ── PIÈGE 5 : resize ──────────────────────────────────────────────────
    // Sur redimensionnement du conteneur : map.resize() D'ABORD, puis
    // recalcul du transform en DOUBLE requestAnimationFrame — Mapbox met à
    // jour sa projection de façon asynchrone, un seul rAF recalcule trop tôt
    // et le modèle « saute » d'une frame.
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        if (this._disposed) return;
        this.map.resize();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (this._disposed) return;
          this._resizeRenderer();
          this._updateTransform();
        }));
      });
      this._resizeObserver.observe(container);
    }

    this._updateTransform();
  }

  // ── API publique ─────────────────────────────────────────────────────────

  /** Déplace l'origine GPS de la scène (et/ou son altitude de référence). */
  setOrigin({ lng, lat, elevation } = {}) {
    // Guard NaN : on ignore une saisie invalide plutôt que de casser le rendu.
    if (lng !== undefined || lat !== undefined) {
      const L = Number(lng), A = Number(lat);
      if (!Number.isFinite(L) || !Number.isFinite(A)) {
        console.warn('[MapboxThreeBridge] setOrigin ignoré : lng/lat NaN', { lng, lat });
        return;
      }
      this._origin = { lng: L, lat: A };
    }
    if (elevation !== undefined && Number.isFinite(Number(elevation))) {
      this._elevation = Number(elevation);
    }
    this._updateTransform();
  }

  /** Rotation sémantique du modèle (degrés, anti-horaire vue du ciel). */
  setRotation(deg) {
    if (!Number.isFinite(Number(deg))) return;
    this._rotateDeg = Number(deg);
    this._updateTransform();
  }

  /** Offsets en mètres locaux (est / nord / haut) autour de l'origine. */
  setOffset(x = 0, y = 0, z = 0) {
    this._offset = { x: Number(x) || 0, y: Number(y) || 0, z: Number(z) || 0 };
    this._updateTransform();
  }

  /**
   * Centre de rotation du modèle (typiquement le centre de sa bbox), en
   * mètres scène. `null` = bbox pas encore connue.
   *
   * PIÈGE 3 : le transform doit être (re)calculé APRÈS que la bbox du modèle
   * est connue. Un premier rendu avec center=(0,0,0) « par défaut » se calque
   * sur une matrice fausse et le modèle saute au premier pan. Tant que
   * center === null, _onMapRender() abandonne proprement (rien n'est dessiné).
   *
   * @param {THREE.Vector3|{x:number,y:number,z:number}|null} v
   */
  setModelCenter(v) {
    if (v == null) {
      this._center = null;
    } else if (Number.isFinite(v.x) && Number.isFinite(v.y)) {
      this._center = { x: v.x, y: v.y, z: Number.isFinite(v.z) ? v.z : 0 };
    } else {
      console.warn('[MapboxThreeBridge] setModelCenter ignoré : centre invalide', v);
      return;
    }
    this._updateTransform();
  }

  /**
   * Snapshot composite carte + scène Three (pour les planches PDF).
   * ⚠ Le canvas Mapbox n'est lisible que si la carte a été créée avec
   * `preserveDrawingBuffer: true` (sinon la couche carte sort noire/vide —
   * cf. skill mapbox-gotchas). Le canvas Three du bridge, lui, l'est toujours.
   * @returns {HTMLCanvasElement}
   */
  captureComposite() {
    const mapCanvas = this.map.getCanvas();
    const out = document.createElement('canvas');
    out.width = mapCanvas.width;
    out.height = mapCanvas.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(mapCanvas, 0, 0, out.width, out.height);
    // Re-rendu Three avec la dernière matrice connue → framebuffer frais
    // (preserveDrawingBuffer garantit qu'il reste lisible après le rendu).
    if (this._lastMapboxMatrix && this._center) {
      this._renderThree(this._lastMapboxMatrix);
    }
    ctx.drawImage(this.renderer.domElement, 0, 0, out.width, out.height);
    return out;
  }

  /** Détache tout : custom layer, listeners, observer, canvas, renderer. */
  dispose() {
    this._disposed = true;
    this._resizeObserver?.disconnect();
    this.map.off('style.load', this._onStyleLoad);
    try {
      if (this.map.getLayer(this._layerId)) this.map.removeLayer(this._layerId);
    } catch (_) { /* style déjà détruit */ }
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ── Interne ──────────────────────────────────────────────────────────────

  _resizeRenderer() {
    const container = this.map.getContainer();
    // false = ne pas écraser le style CSS (le canvas reste en inset:0 / 100%).
    this.renderer.setSize(container.clientWidth, container.clientHeight, false);
  }

  /**
   * Recalcule le transform scène→mercator (port fidèle de updateTransform,
   * mapbox.component.ts:833-911). Appelé à chaque changement d'origine,
   * rotation, offset, centre, resize ou style — PAS à chaque frame.
   */
  _updateTransform() {
    const { lng, lat } = this._origin;
    // Guard : ne jamais composer un transform avec des coordonnées invalides.
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

    const merc = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], 0);
    const meter = merc.meterInMercatorCoordinateUnits();
    const t = this._transform;

    t.translateX = merc.x + this._offset.x * meter;
    // PIÈGE 1 : le MOINS (offsetY nord-positif → mercator sud-positif) va par
    // paire avec le scale(s, -s, s) de composeLayerMatrix. Ne jamais « corriger »
    // l'un des deux isolément.
    t.translateY = merc.y - this._offset.y * meter;
    // PIÈGE 4 : l'altitude bascule selon l'état du terrain DEM Mapbox.
    //   - terrain actif  → la carte dessine le sol à son altitude réelle :
    //     on élève la scène de `elevation` pour la poser dessus ;
    //   - terrain coupé  → la carte est plate à z=0 : élever la scène la
    //     ferait flotter. On précalcule les deux et _onMapRender choisit à
    //     chaque frame (le toggle DEM peut arriver n'importe quand).
    t.translateZTerrain = (this._elevation + this._offset.z) * meter;
    t.translateZFlat = (0 + this._offset.z) * meter;
    t.scale = meter;
    t.rotateZ = (Math.PI * this._rotateDeg) / 180;

    this.map.triggerRepaint();
  }

  /** Callback render du custom layer : horloge + matrice. */
  _onMapRender(matrix) {
    if (this._disposed) return;
    // PIÈGE 3 : pas de bbox connue → pas de rendu (sinon calage faux figé).
    if (!this._center) return;
    // Transform pas encore calculé (style en cours de chargement).
    if (this._transform.scale == null) return;

    this._lastMapboxMatrix = Array.from(matrix);
    this._renderThree(matrix);

    // ⚠ PERF : PAS de triggerRepaint() inconditionnel ici — il créerait une
    // boucle de repaint infinie (GPU à 100 % sur une scène statique, mesuré
    // sur P05). La carte se repeint d'elle-même à chaque interaction
    // (pan/zoom/pitch), ce qui suffit pour une scène calée statique.
    // Une scène ANIMÉE peut opter pour l'horloge continue :
    //   bridge.continuousRepaint = true;
    if (this.continuousRepaint) this.map.triggerRepaint();
  }

  _renderThree(matrix) {
    const THREE = this.THREE;
    const t = this._transform;

    // Hook par frame (facultatif) : l'appelant peut y rafraîchir des uniforms
    // dépendant de la caméra (billboards impostor…). La caméra du bridge n'a
    // PAS de position exploitable (tout vit dans projectionMatrix) — utiliser
    // map.getFreeCameraOptions() côté appelant.
    this.onBeforeRender?.(this);

    // PIÈGE 4 (suite) : choix frame-accurate de l'altitude selon le DEM.
    t.translateZ = this.map.getTerrain() ? t.translateZTerrain : t.translateZFlat;

    // m = matrice mercator→clip fournie par Mapbox pour CETTE frame.
    const m = new THREE.Matrix4().fromArray(matrix);
    const l = composeLayerMatrix(THREE, {
      translateX: t.translateX,
      translateY: t.translateY,
      translateZ: t.translateZ,
      scale: t.scale,
      rotateZ: t.rotateZ,
      center: this._center,
    });

    // On ne touche QUE projectionMatrix : la caméra reste à l'identité, toute
    // la vue (position, perspective, calage géo) vit dans m·l.
    this.camera.projectionMatrix = m.multiply(l);
    this.renderer.render(this.scene, this.camera);
  }
}

export default MapboxThreeBridge;
