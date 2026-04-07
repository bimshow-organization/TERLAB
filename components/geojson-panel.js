// TERLAB · components/geojson-panel.js
// Panel UI pour gestion des couches GeoJSON (GPU + import + dessin)
// Vanilla JS — compatible avec le design system TERLAB
// ════════════════════════════════════════════════════════════════════

import GeoJsonLayerService from '../services/geojson-layer-service.js';
import MapViewer           from './map-viewer.js';

const GeoJsonPanel = {

  _container: null,
  _listEl:    null,
  _unsub:     null,
  _drawMode:  null,

  // ── INIT ──────────────────────────────────────────────────────
  init(containerEl) {
    if (!containerEl) return;
    this._container = containerEl;
    this._render();

    // Écouter les changements du service
    this._unsub = GeoJsonLayerService.onChange((action, id) => {
      this._refreshList();
      // Sync avec MapViewer
      if (action === 'add' && id) {
        const layer = GeoJsonLayerService.getLayer(id);
        if (layer) MapViewer.addCustomLayer(layer);
      }
      if (action === 'remove' && id) {
        MapViewer.removeCustomLayer(id);
      }
      if (action === 'style' && id) {
        const layer = GeoJsonLayerService.getLayer(id);
        if (layer) MapViewer.updateCustomLayerStyle(id, layer);
      }
      if (action === 'visibility' && id) {
        const layer = GeoJsonLayerService.getLayer(id);
        if (layer) MapViewer.toggleCustomLayerVisibility(id, layer.visible);
      }
      if (action === 'visibility-all') {
        GeoJsonLayerService.getLayers().forEach(l =>
          MapViewer.toggleCustomLayerVisibility(l.id, l.visible)
        );
      }
      if (action === 'restore') {
        GeoJsonLayerService.getLayers().forEach(l =>
          MapViewer.addCustomLayer(l)
        );
      }
    });

    // Écouter les features dessinées
    window.addEventListener('terlab:feature-drawn', (e) => {
      const feature = e.detail;
      if (feature) {
        GeoJsonLayerService.addFromDraw(feature);
        this._setDrawMode(null);
      }
    });
  },

  destroy() {
    if (this._unsub) this._unsub();
    if (this._container) this._container.innerHTML = '';
  },

  // ── RENDER PRINCIPAL ──────────────────────────────────────────
  _render() {
    const c = this._container;
    c.innerHTML = '';
    c.className = 'gjp-panel';

    // Header
    const header = _el('div', 'gjp-header');
    header.innerHTML = `<span class="gjp-title">Couches GeoJSON</span>`;
    c.appendChild(header);

    // Toolbar — GPU
    const gpuBar = _el('div', 'gjp-toolbar');
    gpuBar.appendChild(this._btn('GPU auto', 'download', () => this._fetchGPU()));
    c.appendChild(gpuBar);

    // Toolbar — Import
    const importBar = _el('div', 'gjp-toolbar');
    const fileInput = _el('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,.geojson,application/geo+json';
    fileInput.style.display = 'none';
    fileInput.onchange = () => { this._importFile(fileInput); fileInput.value = ''; };
    importBar.appendChild(fileInput);
    importBar.appendChild(this._btn('Fichier', 'file', () => fileInput.click()));
    importBar.appendChild(this._btn('URL', 'link', () => this._promptURL()));
    importBar.appendChild(this._btn('SVG', 'vector', () => this._promptSVG()));
    c.appendChild(importBar);

    // Toolbar — Dessin
    const drawBar = _el('div', 'gjp-toolbar gjp-draw-bar');
    drawBar.appendChild(this._drawBtn('Point', 'draw_point', '●'));
    drawBar.appendChild(this._drawBtn('Ligne', 'draw_line_string', '─'));
    drawBar.appendChild(this._drawBtn('Polygone', 'draw_polygon', '▢'));
    c.appendChild(drawBar);

    // Liste des couches
    this._listEl = _el('div', 'gjp-list');
    c.appendChild(this._listEl);

    // Actions globales
    const footer = _el('div', 'gjp-footer');
    footer.appendChild(this._btn('Tout afficher', 'eye', () => GeoJsonLayerService.setAllVisible(true)));
    footer.appendChild(this._btn('Tout masquer', 'eye-off', () => GeoJsonLayerService.setAllVisible(false)));
    footer.appendChild(this._btn('Export SVG', 'export', () => this._exportSVG()));
    c.appendChild(footer);

    this._refreshList();
  },

  // ── REFRESH LISTE ─────────────────────────────────────────────
  _refreshList() {
    if (!this._listEl) return;
    this._listEl.innerHTML = '';
    const layers = GeoJsonLayerService.getLayers();

    if (!layers.length) {
      const empty = _el('div', 'gjp-empty');
      empty.textContent = 'Aucune couche — utilisez les boutons ci-dessus';
      this._listEl.appendChild(empty);
      return;
    }

    for (const layer of layers) {
      this._listEl.appendChild(this._renderLayerItem(layer));
    }
  },

  // ── RENDER LAYER ITEM ─────────────────────────────────────────
  _renderLayerItem(layer) {
    const item = _el('div', `gjp-item ${layer.visible ? '' : 'gjp-hidden'}`);
    item.dataset.id = layer.id;

    // Barre couleur
    const colorDot = _el('span', 'gjp-color-dot');
    colorDot.style.background = layer.color;
    colorDot.title = 'Changer la couleur';
    colorDot.onclick = () => this._pickColor(layer.id, colorDot);

    // Type badge
    const badge = _el('span', `gjp-badge gjp-badge-${layer.type}`);
    badge.textContent = layer.type === 'gpu' ? 'GPU' : layer.type === 'project' ? 'PRJ' : 'IMP';

    // Nom
    const name = _el('span', 'gjp-name');
    name.textContent = layer.name;
    name.title = layer.name;

    // Feature count
    const count = _el('span', 'gjp-count');
    const n = layer.geojson?.features?.length ?? 0;
    count.textContent = `${n}`;

    // Boutons
    const actions = _el('span', 'gjp-actions');

    // Visibility
    const visBtn = _el('button', 'gjp-btn-icon');
    visBtn.innerHTML = layer.visible ? '👁' : '👁‍🗨';
    visBtn.title = layer.visible ? 'Masquer' : 'Afficher';
    visBtn.onclick = () => GeoJsonLayerService.toggleVisibility(layer.id);

    // Zoom to
    const zoomBtn = _el('button', 'gjp-btn-icon');
    zoomBtn.innerHTML = '⊕';
    zoomBtn.title = 'Centrer sur la couche';
    zoomBtn.onclick = () => MapViewer.fitToCustomLayer(layer.bbox);

    // Delete
    const delBtn = _el('button', 'gjp-btn-icon gjp-btn-del');
    delBtn.innerHTML = '✕';
    delBtn.title = 'Supprimer';
    delBtn.onclick = () => GeoJsonLayerService.removeLayer(layer.id);

    actions.append(visBtn, zoomBtn, delBtn);

    // Expandable style controls
    const expand = _el('div', 'gjp-expand');
    expand.style.display = 'none';

    // Opacity slider
    const opRow = _el('div', 'gjp-slider-row');
    opRow.innerHTML = `<label>Opacité</label>`;
    const opSlider = _el('input');
    opSlider.type = 'range'; opSlider.min = '0'; opSlider.max = '100';
    opSlider.value = String((layer.fillOpacity ?? 0.2) * 100);
    opSlider.oninput = () => {
      GeoJsonLayerService.updateStyle(layer.id, { fillOpacity: opSlider.value / 100 });
    };
    opRow.appendChild(opSlider);
    expand.appendChild(opRow);

    // Line width slider
    const lwRow = _el('div', 'gjp-slider-row');
    lwRow.innerHTML = `<label>Épaisseur</label>`;
    const lwSlider = _el('input');
    lwSlider.type = 'range'; lwSlider.min = '1'; lwSlider.max = '8';
    lwSlider.value = String(layer.lineWidth ?? 2);
    lwSlider.oninput = () => {
      GeoJsonLayerService.updateStyle(layer.id, { lineWidth: Number(lwSlider.value) });
    };
    lwRow.appendChild(lwSlider);
    expand.appendChild(lwRow);

    // Toggle expand on name click
    name.onclick = () => {
      expand.style.display = expand.style.display === 'none' ? 'block' : 'none';
    };

    item.append(colorDot, badge, name, count, actions);
    item.appendChild(expand);
    return item;
  },

  // ── ACTIONS ───────────────────────────────────────────────────
  async _fetchGPU() {
    const terrain = window.SessionManager?.getTerrain?.() ?? {};
    const lat = terrain.lat ?? terrain.latitude;
    const lng = terrain.lng ?? terrain.longitude;
    if (!lat || !lng) {
      window.TerlabToast?.show('Sélectionnez d\'abord une parcelle', 'warning');
      return;
    }
    window.TerlabToast?.show('Chargement couches GPU...', 'info', 3000);
    try {
      // Supprimer les anciennes couches GPU
      GeoJsonLayerService.removeAllByType('gpu');
      const parcelle = terrain.parcelle_geojson;
      if (parcelle) {
        await GeoJsonLayerService.fetchGPULayersByPolygon(parcelle);
      } else {
        await GeoJsonLayerService.fetchGPULayers(lat, lng);
      }
      window.TerlabToast?.show(`${GeoJsonLayerService.getLayers().filter(l => l.type === 'gpu').length} couches GPU chargées`, 'success');
    } catch (e) {
      window.TerlabToast?.show('Erreur GPU: ' + e.message, 'error');
    }
  },

  async _importFile(input) {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await GeoJsonLayerService.addFromFile(file);
      window.TerlabToast?.show(`Couche "${file.name}" importée`, 'success');
    } catch (e) {
      window.TerlabToast?.show('Erreur import: ' + e.message, 'error');
    }
  },

  _promptURL() {
    const url = prompt('URL du fichier GeoJSON :');
    if (!url) return;
    GeoJsonLayerService.addFromURL(url)
      .then(() => window.TerlabToast?.show('Couche URL importée', 'success'))
      .catch(e => window.TerlabToast?.show('Erreur URL: ' + e.message, 'error'));
  },

  _promptSVG() {
    const pathD = prompt('Collez le path SVG (d="M... L... Z") :');
    if (!pathD) return;
    const type = prompt('Type de géométrie : Polygon, LineString, ou Point', 'Polygon');
    try {
      GeoJsonLayerService.addFromSVG(pathD, type || 'Polygon');
      window.TerlabToast?.show('SVG converti en GeoJSON', 'success');
    } catch (e) {
      window.TerlabToast?.show('Erreur SVG: ' + e.message, 'error');
    }
  },

  _pickColor(id, dotEl) {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = GeoJsonLayerService.getLayer(id)?.color ?? '#9a7820';
    input.onchange = () => {
      GeoJsonLayerService.updateStyle(id, { color: input.value });
      dotEl.style.background = input.value;
    };
    input.click();
  },

  _drawBtn(label, mode, icon) {
    const btn = _el('button', 'gjp-draw-btn');
    btn.innerHTML = `<span class="gjp-draw-icon">${icon}</span> ${label}`;
    btn.onclick = () => this._setDrawMode(mode);
    btn.dataset.mode = mode;
    return btn;
  },

  _setDrawMode(mode) {
    this._drawMode = mode;
    // Toggle active class
    this._container.querySelectorAll('.gjp-draw-btn').forEach(b => {
      b.classList.toggle('gjp-draw-active', b.dataset.mode === mode);
    });
    if (mode) {
      MapViewer.enableProjectDraw(mode);
      window.TerlabToast?.show(`Mode dessin : ${mode.replace('draw_', '')}. Cliquez sur la carte.`, 'info', 3000);
    } else {
      MapViewer.disableProjectDraw();
    }
  },

  _exportSVG() {
    const svg = GeoJsonLayerService.toSVGAll();
    if (!svg) {
      window.TerlabToast?.show('Aucune couche visible à exporter', 'warning');
      return;
    }
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'terlab-layers.svg';
    a.click();
    URL.revokeObjectURL(url);
    window.TerlabToast?.show('SVG exporté', 'success');
  },

  // ── HELPERS UI ────────────────────────────────────────────────
  _btn(label, icon, onclick) {
    const btn = _el('button', 'gjp-btn');
    btn.textContent = label;
    btn.onclick = onclick;
    return btn;
  },
};

function _el(tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

export default GeoJsonPanel;
