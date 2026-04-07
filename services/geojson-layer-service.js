// TERLAB · services/geojson-layer-service.js
// Registre central des couches GeoJSON custom (GPU + import + dessin)
// CRUD, persistence localStorage, export SVG
// ════════════════════════════════════════════════════════════════════

import CoordConverter from '../utils/coord-converter.js';
import GPUFetcher     from './gpu-fetcher.js';

const STORAGE_KEY = 'terlab-geojson-layers';

let _uid = 0;
function uid() { return `gjl_${Date.now()}_${++_uid}`; }

const GeoJsonLayerService = {

  _layers: new Map(),   // id → LayerDef
  _order: [],           // ids triés par z-order
  _listeners: [],       // callbacks onChange

  // ═══════════════════════════════════════════════════════════════
  // MODÈLE
  // ═══════════════════════════════════════════════════════════════
  // LayerDef = {
  //   id, name, type: 'gpu'|'import'|'project',
  //   visible: true, color: '#e74c3c', opacity: 0.8,
  //   fillOpacity: 0.2, lineWidth: 2,
  //   geojson: FeatureCollection, bbox: [w,s,e,n]
  // }

  // ═══════════════════════════════════════════════════════════════
  // NIVEAU 1 — GPU (Géoportail de l'Urbanisme)
  // ═══════════════════════════════════════════════════════════════
  async fetchGPULayers(lat, lng) {
    const results = await GPUFetcher.fetchAll(lat, lng);
    const added = [];
    for (const r of results) {
      const id = this.addLayer({
        name:        r.name,
        type:        'gpu',
        color:       r.color,
        fillOpacity: r.fillOpacity ?? 0.15,
        lineWidth:   2,
        geojson:     r.geojson,
      });
      added.push(id);
    }
    return added;
  },

  async fetchGPULayersByPolygon(polygonGeojson) {
    const results = await GPUFetcher.fetchAllByPolygon(polygonGeojson);
    const added = [];
    for (const r of results) {
      const id = this.addLayer({
        name:        r.name,
        type:        'gpu',
        color:       r.color,
        fillOpacity: r.fillOpacity ?? 0.15,
        lineWidth:   2,
        geojson:     r.geojson,
      });
      added.push(id);
    }
    return added;
  },

  // ═══════════════════════════════════════════════════════════════
  // NIVEAU 2 — IMPORT (fichier ou URL)
  // ═══════════════════════════════════════════════════════════════
  async addFromFile(file) {
    const text = await file.text();
    const geojson = this._parseGeoJSON(text);
    if (!geojson) throw new Error('Format GeoJSON invalide');
    return this.addLayer({
      name:    file.name.replace(/\.(geo)?json$/i, ''),
      type:    'import',
      color:   this._randomColor(),
      geojson,
    });
  },

  async addFromURL(url) {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const geojson = this._parseGeoJSON(await resp.text());
    if (!geojson) throw new Error('Format GeoJSON invalide');
    const name = url.split('/').pop()?.replace(/\.(geo)?json$/i, '') || 'URL layer';
    return this.addLayer({ name, type: 'import', color: this._randomColor(), geojson });
  },

  // Import depuis un SVG (path d="..." → GeoJSON)
  addFromSVG(svgPathD, type = 'Polygon', name = 'SVG import') {
    const geometry = CoordConverter.svgPathToGeometry(svgPathD, type);
    if (!geometry) throw new Error('SVG path invalide');
    const geojson = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry, properties: {} }]
    };
    return this.addLayer({ name, type: 'import', color: this._randomColor(), geojson });
  },

  // ═══════════════════════════════════════════════════════════════
  // NIVEAU 3 — DESSIN PROJET (depuis MapboxDraw)
  // ═══════════════════════════════════════════════════════════════
  addFromDraw(feature, name) {
    const geomType = feature.geometry?.type ?? '';
    const autoName = name || `Élément ${geomType} #${this._layers.size + 1}`;
    const geojson = {
      type: 'FeatureCollection',
      features: [feature]
    };
    return this.addLayer({
      name:    autoName,
      type:    'project',
      color:   this._randomColor(),
      geojson,
    });
  },

  // Ajouter une feature à une couche projet existante
  appendFeature(layerId, feature) {
    const layer = this._layers.get(layerId);
    if (!layer) return;
    layer.geojson.features.push(feature);
    layer.bbox = CoordConverter.computeBBox(layer.geojson);
    this._notify('update', layerId);
    this.persist();
  },

  // ═══════════════════════════════════════════════════════════════
  // CRUD
  // ═══════════════════════════════════════════════════════════════
  addLayer(def) {
    const id = def.id || uid();
    const layer = {
      id,
      name:        def.name ?? 'Sans nom',
      type:        def.type ?? 'import',
      visible:     def.visible !== false,
      color:       def.color ?? '#9a7820',
      opacity:     def.opacity ?? 0.8,
      fillOpacity: def.fillOpacity ?? 0.2,
      lineWidth:   def.lineWidth ?? 2,
      geojson:     def.geojson ?? { type: 'FeatureCollection', features: [] },
      bbox:        def.bbox ?? null,
    };
    layer.bbox = layer.bbox || CoordConverter.computeBBox(layer.geojson);
    this._layers.set(id, layer);
    this._order.push(id);
    this._notify('add', id);
    this.persist();
    return id;
  },

  removeLayer(id) {
    this._layers.delete(id);
    this._order = this._order.filter(x => x !== id);
    this._notify('remove', id);
    this.persist();
  },

  removeAllByType(type) {
    const toRemove = [...this._layers.values()].filter(l => l.type === type).map(l => l.id);
    toRemove.forEach(id => this.removeLayer(id));
  },

  updateStyle(id, props) {
    const layer = this._layers.get(id);
    if (!layer) return;
    Object.assign(layer, props);
    this._notify('style', id);
    this.persist();
  },

  toggleVisibility(id) {
    const layer = this._layers.get(id);
    if (!layer) return;
    layer.visible = !layer.visible;
    this._notify('visibility', id);
    this.persist();
  },

  setAllVisible(visible) {
    for (const layer of this._layers.values()) {
      layer.visible = visible;
    }
    this._notify('visibility-all', null);
    this.persist();
  },

  reorder(ids) {
    this._order = ids.filter(id => this._layers.has(id));
    this._notify('reorder', null);
    this.persist();
  },

  getLayer(id) { return this._layers.get(id) ?? null; },

  getLayers() {
    return this._order
      .filter(id => this._layers.has(id))
      .map(id => this._layers.get(id));
  },

  getVisibleLayers() {
    return this.getLayers().filter(l => l.visible);
  },

  // ═══════════════════════════════════════════════════════════════
  // SVG EXPORT
  // ═══════════════════════════════════════════════════════════════
  toSVG(id, options = {}) {
    const layer = this._layers.get(id);
    if (!layer) return '';
    return CoordConverter.featureCollectionToSVG(layer.geojson, {
      strokeColor: layer.color,
      fillColor:   layer.color,
      strokeWidth: layer.lineWidth,
      fillOpacity: layer.fillOpacity,
      ...options,
    });
  },

  toSVGAll(options = {}) {
    const visible = this.getVisibleLayers();
    if (!visible.length) return '';

    // Merge toutes les features visibles
    const merged = {
      type: 'FeatureCollection',
      features: visible.flatMap(l =>
        (l.geojson.features ?? []).map(f => ({
          ...f,
          properties: { ...f.properties, color: l.color, strokeColor: l.color }
        }))
      )
    };
    return CoordConverter.featureCollectionToSVG(merged, options);
  },

  // Crée un élément SVG DOM (pour ExportEngine._svgToDataURL)
  toSVGElement(options = {}) {
    const svgStr = this.toSVGAll(options);
    if (!svgStr) return null;
    const div = document.createElement('div');
    div.innerHTML = svgStr;
    return div.firstElementChild;
  },

  // ═══════════════════════════════════════════════════════════════
  // PERSISTENCE (localStorage)
  // ═══════════════════════════════════════════════════════════════
  persist() {
    try {
      const data = {
        order: this._order,
        layers: Object.fromEntries(
          [...this._layers.entries()].map(([id, l]) => [id, {
            ...l,
            // Ne pas persister les couches GPU (re-fetchées à chaque session)
            geojson: l.type === 'gpu' ? null : l.geojson,
          }])
        )
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[GeoJsonLayerService] Persist failed:', e.message);
    }
  },

  restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      this._order = [];
      this._layers.clear();

      for (const id of (data.order ?? [])) {
        const l = data.layers?.[id];
        if (!l) continue;
        // Ignorer les couches GPU sans données (seront re-fetchées)
        if (l.type === 'gpu' && !l.geojson) continue;
        if (l.geojson) {
          this._layers.set(id, l);
          this._order.push(id);
        }
      }
      this._notify('restore', null);
    } catch (e) {
      console.warn('[GeoJsonLayerService] Restore failed:', e.message);
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════════════════
  onChange(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(x => x !== fn); };
  },

  _notify(action, id) {
    const layer = id ? this._layers.get(id) : null;
    for (const fn of this._listeners) {
      try { fn(action, id, layer); } catch (e) { console.warn('[GeoJsonLayerService] listener error:', e); }
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════
  _parseGeoJSON(text) {
    try {
      const data = JSON.parse(text);
      // Si c'est une Feature unique → wrapper
      if (data.type === 'Feature') {
        return { type: 'FeatureCollection', features: [data] };
      }
      // Si c'est une Geometry directe → wrapper
      if (data.type && data.coordinates) {
        return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: data, properties: {} }] };
      }
      // FeatureCollection
      if (data.type === 'FeatureCollection') return data;
      return null;
    } catch { return null; }
  },

  _randomColor() {
    const palette = [
      '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
      '#1abc9c', '#e67e22', '#34495e', '#e91e63', '#00bcd4'
    ];
    return palette[this._layers.size % palette.length];
  },
};

export default GeoJsonLayerService;
