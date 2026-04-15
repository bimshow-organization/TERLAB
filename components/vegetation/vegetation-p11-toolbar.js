'use strict';
/**
 * TERLAB × BPF — P11 ESQ Vegetation toolbar
 * Port adapté de terlab-vegetation/phases/p11-vegetation-patch.ts
 *
 * S'intègre dans EsquisseCanvas (phases/p11-esquisse.html) : charge l'état
 * VegetationState depuis Firebase/SessionManager, projette les features en
 * coords SVG via EsquisseCanvas._project(), rend le calque différentiel
 * keep/cut/new avec symboles BPF et toolbar (toggles + exports).
 *
 * Dépendances globales : EsquisseCanvas · SessionManager · ThemeSwitcher
 *                        VegetationState · VegetationSVGPlan · VegetationExport
 */

import VegetationState   from '../../services/vegetation/vegetation-state.js';
import VegetationSVGPlan from '../../services/vegetation/vegetation-svg-plan.js';
import VegetationExport  from '../../services/vegetation/vegetation-export.js';
import VegetationSpecies from '../../services/vegetation/vegetation-species.js';

const TOOLBAR_ID = 'veg-p11-toolbar';

const VegetationP11Toolbar = {

  _state: null,
  _sessionId: '',
  _canvas: null,      // EsquisseCanvas instance
  _vegLayer: null,    // <g> SVG
  _unsubState: null,
  _planConfig: {
    showLabels: true,
    showDistanceRings: false,
    showStatsPanel: true,
    showLegend: true,
  },
  _themeListener: null,

  async init(sessionId, canvas) {
    if (this._canvas) this.dispose();
    this._sessionId = sessionId || 'demo';
    this._canvas = canvas || window.EsquisseCanvas;
    if (!this._canvas || !this._canvas._svg) {
      console.warn('[P11 Veg] EsquisseCanvas non prêt');
      return;
    }
    await VegetationSpecies.load();

    const saved = await VegetationState.init(this._sessionId);
    if (saved) {
      this._state = saved;
      this._render();
    } else {
      this._injectEmptyNotice();
    }

    this._injectToolbar();

    this._unsubState = VegetationState.subscribe(state => {
      this._state = state;
      this._render();
    });

    this._themeListener = () => { if (this._state) this._render(); };
    window.addEventListener('terlab-theme-change', this._themeListener);
    window.addEventListener('terlab-plan-resize', this._themeListener);
  },

  _render() {
    if (!this._canvas || !this._canvas._svg || !this._state) return;
    const svg = this._canvas._svg;

    const { scale, originX, originY, theme } = this._planConfig_runtime();

    // Préparer une copie des features avec positionLocal en pixel SVG relatifs
    // au couple (originX, originY) et scale px/m. Pour respecter la convention
    // de VegetationSVGPlan (y = originY - y_m * scale), on calcule les deltas
    // en m dans le repère local SVG puis on laisse le service faire le render.
    const featuresProjected = this._state.features.map(f => {
      const ptPx = this._canvas._project(f.position);
      // Convertir (ptPx) → coord m dans le repère service (originX + x*scale, originY - y*scale)
      const xm = (ptPx.x - originX) / scale;
      const ym = (originY - ptPx.y) / scale;
      return { ...f, positionLocal: { x: xm, y: ym } };
    });
    const stateProjected = { ...this._state, features: featuresProjected };

    const svgFrag = VegetationSVGPlan.render(stateProjected, {
      scale, originX, originY, theme,
      showLabels:        this._planConfig.showLabels,
      showDistanceRings: this._planConfig.showDistanceRings,
      showLegend:        this._planConfig.showLegend,
      showStatsPanel:    this._planConfig.showStatsPanel,
    });

    // Remplacer l'ancien calque
    if (this._vegLayer && this._vegLayer.parentNode) this._vegLayer.remove();
    const doc = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${svgFrag}</svg>`,
      'image/svg+xml'
    );
    const g = doc.querySelector('g#vegetation-layer');
    if (!g) return;
    const imported = svg.ownerDocument.importNode(g, true);
    svg.appendChild(imported);
    this._vegLayer = imported;
  },

  _planConfig_runtime() {
    // scale : distance en px pour 1 m est calculée en projetant centroid et
    // centroid + 1m à l'est. Robuste pour Mapbox GL comme pour fallback local.
    let centroid = this._state.parcelleCentroid;
    if (!centroid && this._canvas._parcelGeo && this._canvas._parcelGeo.length) {
      const mean = this._canvas._parcelGeo.reduce(
        (a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]
      );
      centroid = [mean[0] / this._canvas._parcelGeo.length, mean[1] / this._canvas._parcelGeo.length];
    }
    if (!centroid) centroid = [55.5364, -21.1151]; // fallback Réunion

    const center = this._canvas._project(centroid);
    const LNG_M  = 111320 * Math.cos(centroid[1] * Math.PI / 180);
    const east   = this._canvas._project([centroid[0] + 1 / LNG_M, centroid[1]]);
    const scale  = Math.max(2, Math.hypot(east.x - center.x, east.y - center.y));

    const theme = (window.ThemeSwitcher && window.ThemeSwitcher.current)
      ? window.ThemeSwitcher.current() : 'dark';
    const normalizedTheme = ['dark','ivory','earth'].includes(theme) ? theme : 'dark';

    return { scale, originX: center.x, originY: center.y, theme: normalizedTheme };
  },

  _injectToolbar() {
    const existing = document.getElementById(TOOLBAR_ID);
    if (existing) existing.remove();

    const bar = document.createElement('div');
    bar.id = TOOLBAR_ID;
    bar.className = 'veg-toolbar';
    bar.innerHTML = `
      <span class="veg-toolbar-title">🌿 P11 · Végétation</span>
      <span class="veg-toolbar-sep"></span>
      <label class="veg-toolbar-check">
        <input type="checkbox" id="veg-show-labels" checked> Labels
      </label>
      <label class="veg-toolbar-check">
        <input type="checkbox" id="veg-show-dist"> Dist. fond.
      </label>
      <label class="veg-toolbar-check">
        <input type="checkbox" id="veg-show-stats" checked> Stats
      </label>
      <label class="veg-toolbar-check">
        <input type="checkbox" id="veg-show-layer" checked> Calque
      </label>
      <span class="veg-toolbar-sep"></span>
      <button class="veg-btn-sm" id="veg-p11-table">↓ Tableau plantation</button>
      <button class="veg-btn-sm" id="veg-p11-geojson">↓ GeoJSON</button>
    `;
    document.body.appendChild(bar);

    const bindCheck = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => {
        this._planConfig[key] = el.checked;
        if (this._state) this._render();
      });
    };
    bindCheck('veg-show-labels', 'showLabels');
    bindCheck('veg-show-dist',   'showDistanceRings');
    bindCheck('veg-show-stats',  'showStatsPanel');

    const layerEl = document.getElementById('veg-show-layer');
    if (layerEl) layerEl.addEventListener('change', () => {
      if (this._vegLayer) this._vegLayer.style.display = layerEl.checked ? '' : 'none';
    });

    document.getElementById('veg-p11-table').addEventListener('click', () => this.exportPlantingTable());
    document.getElementById('veg-p11-geojson').addEventListener('click', () => this.exportGeoJSON());
  },

  _injectEmptyNotice() {
    const existing = document.getElementById('veg-p11-empty');
    if (existing) return;
    const notice = document.createElement('div');
    notice.id = 'veg-p11-empty';
    notice.className = 'veg-empty-notice';
    notice.textContent = '🌿 Aucune végétation détectée — compléter P06 BIO d\'abord.';
    document.body.appendChild(notice);
    setTimeout(() => notice.remove(), 6000);
  },

  exportPlantingTable() {
    if (!this._state) return;
    const project = (window.SessionManager && window.SessionManager._data
      && window.SessionManager._data.terrain && window.SessionManager._data.terrain.projectName)
      || 'Projet TERLAB';
    VegetationExport.downloadPlantingTable(this._state, project);
  },

  exportGeoJSON() {
    if (!this._state) return;
    VegetationExport.downloadGeoJSON(this._state);
  },

  dispose() {
    if (this._vegLayer && this._vegLayer.parentNode) this._vegLayer.remove();
    if (typeof this._unsubState === 'function') this._unsubState();
    if (this._themeListener) {
      window.removeEventListener('terlab-theme-change', this._themeListener);
      window.removeEventListener('terlab-plan-resize', this._themeListener);
    }
    const bar = document.getElementById(TOOLBAR_ID);
    if (bar) bar.remove();
    this._vegLayer = null;
    this._canvas = null;
    this._state = null;
  },
};

export default VegetationP11Toolbar;

if (typeof window !== 'undefined') {
  window.VegetationP11Toolbar = VegetationP11Toolbar;
}
