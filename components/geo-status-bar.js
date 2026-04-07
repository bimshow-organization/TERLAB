// TERLAB · components/geo-status-bar.js
// Barre de statut géographique pour canvases Mapbox GL & Three.js
// Affiche : Échelle | Barre graphique | SRS (dropdown) | Coordonnées XY curseur
// Projection locale : RGR92 / UTM zone 40S (EPSG:2975) · ENSA La Réunion

const GeoStatusBar = {

  // ─── CONFIG ───────────────────────────────────────────────────
  SRS_OPTIONS: [
    { id: 'utm40s', label: 'RGR92 / UTM zone 40S', epsg: 2975 },
    { id: 'wgs84', label: 'WGS 84',                epsg: 4326 },
    { id: 'rgr92', label: 'RGR92 géographique',    epsg: 4971 },
  ],

  SCALE_PRESETS: [
    500, 1000, 2000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000
  ],

  // UTM zone 40S constants (central meridian 57°E)
  UTM40S_CM:         57,
  UTM40S_K0:         0.9996,
  UTM40S_FALSE_E:    500000,
  UTM40S_FALSE_N:    10000000,   // hémisphère sud

  // ─── STATE ────────────────────────────────────────────────────
  _bars:       [],   // instances actives [{el, source, cleanup}]
  _currentSRS: 'utm40s',

  // ─── PUBLIC API ───────────────────────────────────────────────

  /**
   * Attache une barre de statut sous un conteneur canvas (Mapbox ou Three.js).
   * @param {Object} opts
   * @param {HTMLElement} opts.container  — le wrapper parent (.map-wrap, .t3d-wrap)
   * @param {'mapbox'|'three'} opts.source
   * @param {mapboxgl.Map} [opts.map]     — instance Mapbox (si source=mapbox)
   * @param {Object} [opts.viewer]        — instance Terrain3D (si source=three)
   * @returns {HTMLElement} la barre créée
   */
  attach({ container, source, map, viewer }) {
    if (!container) return null;

    // Éviter les doublons
    const existing = container.querySelector('.geo-status-bar');
    if (existing) existing.remove();

    const bar = this._createDOM();
    container.style.position = 'relative';
    container.appendChild(bar);

    const instance = { el: bar, source, cleanup: null };

    if (source === 'mapbox' && map) {
      instance.cleanup = this._bindMapbox(bar, map);
    } else if (source === 'three' && viewer) {
      instance.cleanup = this._bindThree(bar, viewer);
    }

    this._bars.push(instance);
    return bar;
  },

  /**
   * Détache toutes les barres actives.
   */
  detachAll() {
    this._bars.forEach(b => {
      if (b.cleanup) b.cleanup();
      b.el.remove();
    });
    this._bars = [];
  },

  /**
   * Détache la barre d'un conteneur spécifique.
   */
  detach(container) {
    const idx = this._bars.findIndex(b => b.el.parentElement === container);
    if (idx < 0) return;
    const b = this._bars[idx];
    if (b.cleanup) b.cleanup();
    b.el.remove();
    this._bars.splice(idx, 1);
  },

  // ─── DOM ──────────────────────────────────────────────────────

  _createDOM() {
    const bar = document.createElement('div');
    bar.className = 'geo-status-bar';
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-label', 'Coordonnées géographiques');

    bar.innerHTML = `
      <div class="gsb-group gsb-scale">
        <span class="gsb-label">Echelle :</span>
        <select class="gsb-select gsb-scale-select" aria-label="Échelle cartographique">
          ${this.SCALE_PRESETS.map(s =>
            `<option value="${s}"${s === 500000 ? ' selected' : ''}>1 / ${s.toLocaleString('fr-FR')}</option>`
          ).join('')}
        </select>
        <div class="gsb-scalebar" aria-hidden="true">
          <div class="gsb-scalebar-fill"></div>
        </div>
      </div>
      <div class="gsb-sep" aria-hidden="true"></div>
      <div class="gsb-group gsb-srs">
        <span class="gsb-label">SRS :</span>
        <select class="gsb-select gsb-srs-select" aria-label="Système de référence spatiale">
          ${this.SRS_OPTIONS.map(s =>
            `<option value="${s.id}"${s.id === this._currentSRS ? ' selected' : ''}>${s.label}</option>`
          ).join('')}
        </select>
      </div>
      <div class="gsb-sep" aria-hidden="true"></div>
      <div class="gsb-group gsb-coords">
        <span class="gsb-coord-x">X : —</span>
        <span class="gsb-coord-y">Y : —</span>
      </div>
    `;

    // SRS change handler
    const srsSelect = bar.querySelector('.gsb-srs-select');
    srsSelect.addEventListener('change', (e) => {
      this._currentSRS = e.target.value;
      // Synchroniser tous les selects SRS
      this._bars.forEach(b => {
        const sel = b.el.querySelector('.gsb-srs-select');
        if (sel && sel !== e.target) sel.value = this._currentSRS;
      });
    });

    return bar;
  },

  // ─── MAPBOX BINDING ───────────────────────────────────────────

  _bindMapbox(bar, map) {
    const coordX = bar.querySelector('.gsb-coord-x');
    const coordY = bar.querySelector('.gsb-coord-y');
    const scaleSelect = bar.querySelector('.gsb-scale-select');
    const scaleFill = bar.querySelector('.gsb-scalebar-fill');

    const onMove = (e) => {
      const { lng, lat } = e.lngLat;
      this._updateCoords(coordX, coordY, lng, lat);
    };

    const onZoom = () => {
      const zoom = map.getZoom();
      const lat = map.getCenter().lat;
      const scale = this._zoomToScale(zoom, lat);
      this._updateScale(scaleSelect, scaleFill, scale);
    };

    map.on('mousemove', onMove);
    map.on('zoom', onZoom);
    map.once('load', onZoom);

    // Init scale
    if (map.loaded()) onZoom();

    return () => {
      map.off('mousemove', onMove);
      map.off('zoom', onZoom);
    };
  },

  // ─── THREE.JS BINDING ────────────────────────────────────────

  _bindThree(bar, viewer) {
    const coordX = bar.querySelector('.gsb-coord-x');
    const coordY = bar.querySelector('.gsb-coord-y');
    const canvas = viewer._canvas;
    if (!canvas) return null;

    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      // Raycasting vers le terrain
      const geo = this._raycastToGeo(mx, my, viewer);
      if (geo) {
        this._updateCoords(coordX, coordY, geo.lng, geo.lat);
      }
    };

    canvas.addEventListener('mousemove', onMove);

    return () => {
      canvas.removeEventListener('mousemove', onMove);
    };
  },

  /**
   * Raycasting Three.js → coordonnées géographiques.
   * Convertit la position 3D en lng/lat en utilisant les métadonnées du terrain.
   */
  _raycastToGeo(mx, my, viewer) {
    const THREE = window.THREE;
    if (!THREE || !viewer._scene || !viewer._cam) return null;

    const raycaster = new THREE.Raycaster();
    raycaster.set(viewer._cam.position.clone(), new THREE.Vector3());
    raycaster.setFromCamera(new THREE.Vector2(mx, my), viewer._cam);

    // Chercher l'intersection avec le groupe terrain
    const targets = viewer._terrainGroup
      ? viewer._terrainGroup.children
      : viewer._scene.children;

    const hits = raycaster.intersectObjects(targets, true);
    if (!hits.length) return null;

    const pt = hits[0].point;

    // Convertir position Three.js → lng/lat
    // Le terrain 3D est centré sur _terrainCenter {lng, lat} et mis à l'échelle par _terrainSF
    const terrain = viewer._parcelData;
    if (!terrain || !terrain.lng || !terrain.lat) return null;

    const sf = viewer._terrainSF || viewer.SCALE_FACTOR || 40;
    const center = viewer._terrainCenter || { x: 0, z: 0 };

    // Approximation locale : 1° lat ≈ 111320m, 1° lng ≈ 111320m * cos(lat)
    const latRad = terrain.lat * Math.PI / 180;
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos(latRad);

    // L'échelle terrain : sf unités Three = taille réelle parcelle
    // On a besoin de la taille réelle pour la conversion
    const realSize = terrain.contenance_m2
      ? Math.sqrt(terrain.contenance_m2)
      : 100;  // estimation par défaut

    const metersPerUnit = realSize / sf;
    const dx = (pt.x - center.x) * metersPerUnit;
    const dz = (pt.z - (center.z || 0)) * metersPerUnit;

    const lng = terrain.lng + dx / mPerDegLng;
    const lat = terrain.lat - dz / mPerDegLat;  // Z inversé en Three.js

    return { lng, lat };
  },

  // ─── COORDINATE CONVERSION ────────────────────────────────────

  /**
   * WGS84 (lng, lat) → RGR92 / UTM zone 40S (E, N)
   * Formules UTM directes (Karney simplifiées).
   */
  _wgs84ToUTM40S(lng, lat) {
    const deg2rad = Math.PI / 180;
    const a = 6378137;               // semi-major axis GRS80
    const f = 1 / 298.257222101;     // flattening GRS80
    const e2 = 2 * f - f * f;
    const e = Math.sqrt(e2);
    const ep2 = e2 / (1 - e2);

    const phi = lat * deg2rad;
    const lambda = lng * deg2rad;
    const lambda0 = this.UTM40S_CM * deg2rad;
    const k0 = this.UTM40S_K0;

    const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    const T = Math.tan(phi) ** 2;
    const C = ep2 * Math.cos(phi) ** 2;
    const A = (lambda - lambda0) * Math.cos(phi);

    // Méridien arc
    const e4 = e2 * e2;
    const e6 = e4 * e2;
    const M = a * (
      (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
      - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
      + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
      - (35 * e6 / 3072) * Math.sin(6 * phi)
    );

    const A2 = A * A;
    const A4 = A2 * A2;

    const x = k0 * N * (
      A + (1 - T + C) * A2 * A / 6
      + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A4 * A / 120
    );

    const y = k0 * (
      M + N * Math.tan(phi) * (
        A2 / 2
        + (5 - T + 9 * C + 4 * C * C) * A4 / 24
        + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A4 * A2 / 720
      )
    );

    return {
      E: x + this.UTM40S_FALSE_E,
      N: y + this.UTM40S_FALSE_N
    };
  },

  // ─── UPDATE HELPERS ───────────────────────────────────────────

  _updateCoords(elX, elY, lng, lat) {
    switch (this._currentSRS) {
      case 'utm40s': {
        const { E, N } = this._wgs84ToUTM40S(lng, lat);
        elX.textContent = `X : ${E.toFixed(2)}`;
        elY.textContent = `Y : ${N.toFixed(2)}`;
        break;
      }
      case 'wgs84': {
        elX.textContent = `Lng : ${lng.toFixed(6)}°`;
        elY.textContent = `Lat : ${lat.toFixed(6)}°`;
        break;
      }
      case 'rgr92': {
        // RGR92 géographique ≈ WGS84 pour La Réunion (écart < 1m)
        elX.textContent = `Lng : ${lng.toFixed(6)}°`;
        elY.textContent = `Lat : ${lat.toFixed(6)}°`;
        break;
      }
    }
  },

  _updateScale(select, fill, mapScale) {
    // Trouver le preset le plus proche
    let best = this.SCALE_PRESETS[0];
    let bestDiff = Infinity;
    for (const s of this.SCALE_PRESETS) {
      const diff = Math.abs(s - mapScale);
      if (diff < bestDiff) { bestDiff = diff; best = s; }
    }
    select.value = best;

    // Barre graphique : ratio inversé (plus zoomé = plus rempli)
    const maxScale = this.SCALE_PRESETS[this.SCALE_PRESETS.length - 1];
    const minScale = this.SCALE_PRESETS[0];
    const pct = 1 - (Math.log(best) - Math.log(minScale)) / (Math.log(maxScale) - Math.log(minScale));
    fill.style.width = `${Math.max(5, pct * 100)}%`;
  },

  /**
   * Zoom Mapbox → échelle cartographique approximative.
   * Formule standard : scale = C * cos(lat) / 2^zoom / tileSize
   */
  _zoomToScale(zoom, lat) {
    const C = 40075016.686;  // circumférence équatoriale (m)
    const tileSize = 512;
    const dpi = 96;
    const inchPerMeter = 39.3701;
    const metersPerPixel = C * Math.cos(lat * Math.PI / 180) / (tileSize * Math.pow(2, zoom));
    return metersPerPixel * dpi * inchPerMeter;
  },
};

export default GeoStatusBar;
