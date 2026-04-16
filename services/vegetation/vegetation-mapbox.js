'use strict';
/**
 * TERLAB × BPF — VegetationMapbox service
 * Overlay végétation sur Mapbox : symboles BPF top-view + cercles couronne
 *  + overlay ✕ abattus + halo verts nouveaux + popup espèces.
 * Port Vanilla JS de terlab-vegetation/services/vegetation-mapbox.service.ts
 *
 * Dépend : window.TopViewSymbols (generateForDNA), window.VegetationSpecies, window.mapboxgl
 */

import VegetationSpecies from './vegetation-species.js';
import VegetationState from './vegetation-state.js';

const SYMBOL_SIZE       = 128;
const LAYER_ID_SYMBOLS  = 'veg-symbols';
const LAYER_ID_RADII    = 'veg-radii';
const LAYER_ID_CUT      = 'veg-cut-overlay';
const LAYER_ID_NEW      = 'veg-new-glow';
const LAYER_ID_LABELS   = 'veg-labels';
const SOURCE_ID         = 'vegetation';

const VegetationMapbox = {

  _map: null,
  _loadedImages: new Set(),
  _vegState: null,
  _clickHandler: null,

  async init(map, state) {
    if (!map) return;
    state = state || { features: [] };
    if (!Array.isArray(state.features)) state.features = [];
    this._map = map;
    this._vegState = state;

    if (!map.isStyleLoaded()) await new Promise(r => map.once('load', r));

    const keys = Array.from(new Set(state.features.map(f => f.speciesKey).filter(Boolean)));
    await Promise.all(keys.map(k => this._registerSpeciesImage(k)));
    await this._registerSpeciesImage('unknown');

    const geojson = this._stateToCOF(state);
    const src = map.getSource(SOURCE_ID);
    if (src) src.setData(geojson);
    else map.addSource(SOURCE_ID, { type: 'geojson', data: geojson });

    this._addLayers();
  },

  async update(state) {
    if (!this._map) return;
    state = state || { features: [] };
    if (!Array.isArray(state.features)) state.features = [];
    this._vegState = state;

    const newKeys = state.features
      .map(f => f.speciesKey)
      .filter(k => !!k && !this._loadedImages.has(k));
    await Promise.all(newKeys.map(k => this._registerSpeciesImage(k)));

    const src = this._map.getSource(SOURCE_ID);
    if (src) src.setData(this._stateToCOF(state));
  },

  remove() {
    const map = this._map;
    this._map = null;
    this._vegState = null;
    this._loadedImages.clear();
    if (!map) return;
    try {
      [LAYER_ID_NEW, LAYER_ID_CUT, LAYER_ID_RADII, LAYER_ID_SYMBOLS, LAYER_ID_LABELS].forEach(id => {
        if (map.getLayer && map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource && map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    } catch {}
  },

  _stateToCOF(state) {
    return {
      type: 'FeatureCollection',
      features: state.features.map(f => {
        const sp = f.speciesKey ? VegetationSpecies.get(f.speciesKey) : null;
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: f.position },
          properties: {
            id:           f.id,
            status:       f.status,
            speciesKey:   f.speciesKey || 'unknown',
            commonName:   sp ? sp.commonName : '?',
            scientific:   sp ? sp.scientificName : '',
            color2D:      sp ? sp.color2D : '#4a7a30',
            canopyRadius: f.canopyRadiusMeasured,
            height:       f.heightMeasured || 0,
            cutJustif:    f.cutJustification || '',
            confidence:   Math.round((f.speciesConfidence || 0) * 100),
          },
        };
      }),
    };
  },

  async _registerSpeciesImage(speciesKey) {
    if (this._loadedImages.has(speciesKey)) return;
    const imageId = `bpf_${speciesKey}`;
    const sp = VegetationSpecies.get(speciesKey);
    const color = sp ? sp.color2D : '#4a7a30';

    let svgStr;
    try {
      if (window.TopViewSymbols && window.TopViewSymbols.generateForDNA && sp) {
        svgStr = window.TopViewSymbols.generateForDNA({
          speciesKey, isPalm: sp.isPalm,
          crownShape: sp.crownShape, growthForm: sp.growthForm,
          category: sp.category, color2D: color,
        });
      } else {
        svgStr = this._fallbackSVG(color);
      }
    } catch { svgStr = this._fallbackSVG(color); }

    const imageData = await this._svgToImageData(svgStr, SYMBOL_SIZE);
    if (this._map.hasImage(imageId)) this._map.removeImage(imageId);
    this._map.addImage(imageId, imageData, { sdf: false });
    this._loadedImages.add(speciesKey);
  },

  _svgToImageData(svgStr, size) {
    return new Promise(resolve => {
      const img = new Image();
      const blob = new Blob([svgStr], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(data);
      };
      img.onerror = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.beginPath();
        ctx.arc(size/2, size/2, size/2 - 2, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(74,122,48,0.5)';
        ctx.fill();
        resolve(ctx.getImageData(0, 0, size, size));
      };
      img.src = url;
    });
  },

  _fallbackSVG(color) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="90" fill="${color}44" stroke="${color}" stroke-width="2"/>
      <circle cx="100" cy="100" r="4" fill="${color}"/>
    </svg>`;
  },

  _addLayers() {
    const map = this._map;

    if (!map.getLayer(LAYER_ID_RADII)) {
      map.addLayer({
        id: LAYER_ID_RADII, type: 'circle', source: SOURCE_ID,
        paint: {
          'circle-radius': [
            'interpolate', ['exponential', 2], ['zoom'],
            14, ['max', 6, ['*', ['get', 'canopyRadius'], 0.22]],
            18, ['max', 6, ['*', ['get', 'canopyRadius'], 3.6]],
          ],
          'circle-color': [
            'case',
            ['==', ['get', 'status'], 'existing_cut'],  'rgba(224,80,48,0.18)',
            ['==', ['get', 'status'], 'new_proposed'],  'rgba(76,168,112,0.15)',
            ['==', ['get', 'status'], 'new_validated'], 'rgba(76,168,112,0.22)',
            'rgba(74,122,48,0.12)',
          ],
          'circle-stroke-color': [
            'case',
            ['==', ['get', 'status'], 'existing_cut'],  'rgba(224,80,48,0.55)',
            ['==', ['get', 'status'], 'new_proposed'],  'rgba(76,168,112,0.55)',
            ['==', ['get', 'status'], 'new_validated'], 'rgba(76,168,112,0.80)',
            ['get', 'color2D'],
          ],
          'circle-stroke-width': [
            'case',
            ['in', ['get', 'status'], ['literal', ['new_proposed', 'new_validated']]], 2,
            1,
          ],
          'circle-opacity': [
            'case', ['==', ['get', 'status'], 'existing_cut'], 0.5, 1,
          ],
          'circle-pitch-alignment': 'map',
        },
      });
    }

    if (!map.getLayer(LAYER_ID_SYMBOLS)) {
      map.addLayer({
        id: LAYER_ID_SYMBOLS, type: 'symbol', source: SOURCE_ID,
        layout: {
          'icon-image': ['concat', 'bpf_', ['get', 'speciesKey']],
          'icon-size': [
            'interpolate', ['exponential', 2], ['zoom'],
            14, ['max', 0.12, ['*', ['get', 'canopyRadius'], 0.0039]],
            19, ['max', 0.12, ['*', ['get', 'canopyRadius'], 0.125]],
          ],
          'icon-allow-overlap': true,
          'icon-anchor': 'center',
          'icon-pitch-alignment': 'map',
          'icon-rotation-alignment': 'map',
        },
        paint: {
          'icon-opacity': [
            'case', ['==', ['get', 'status'], 'existing_cut'], 0.30, 1.0,
          ],
        },
      });
    }

    if (!map.getLayer(LAYER_ID_CUT)) {
      map.addLayer({
        id: LAYER_ID_CUT, type: 'symbol', source: SOURCE_ID,
        filter: ['==', ['get', 'status'], 'existing_cut'],
        layout: {
          'text-field': '✕',
          'text-size': 22,
          'text-allow-overlap': true,
          'text-anchor': 'center',
        },
        paint: {
          'text-color': '#e05030',
          'text-halo-color': 'rgba(0,0,0,0.5)',
          'text-halo-width': 1.5,
          'text-opacity': 0.9,
        },
      });
    }

    if (!map.getLayer(LAYER_ID_NEW)) {
      map.addLayer({
        id: LAYER_ID_NEW, type: 'circle', source: SOURCE_ID,
        filter: ['in', ['get', 'status'], ['literal', ['new_proposed', 'new_validated']]],
        paint: {
          'circle-radius': [
            'interpolate', ['exponential', 2], ['zoom'],
            14, ['max', 6, ['*', ['get', 'canopyRadius'], 0.22]],
            18, ['max', 6, ['*', ['get', 'canopyRadius'], 3.6]],
          ],
          'circle-color': 'transparent',
          'circle-stroke-color': 'rgba(76,168,112,0.9)',
          'circle-stroke-width': 2.5,
          'circle-pitch-alignment': 'map',
        },
      });
    }

    if (!map.getLayer(LAYER_ID_LABELS)) {
      map.addLayer({
        id: LAYER_ID_LABELS, type: 'symbol', source: SOURCE_ID, minzoom: 18,
        filter: ['in', ['get', 'status'], ['literal', ['existing_cut', 'new_proposed', 'new_validated']]],
        layout: {
          'text-field': [
            'concat',
            ['get', 'commonName'],
            '\n',
            ['concat', 'Ø', ['to-string', ['round', ['*', ['get', 'canopyRadius'], 2]]], 'm'],
          ],
          'text-size': 10,
          'text-anchor': 'top',
          'text-offset': [0, 1.2],
          'text-allow-overlap': false,
          'text-optional': true,
        },
        paint: {
          'text-color': [
            'case',
            ['==', ['get', 'status'], 'existing_cut'], '#e05030',
            ['in', ['get', 'status'], ['literal', ['new_proposed','new_validated']]], '#4ca870',
            '#c9a84c',
          ],
          'text-halo-color': 'rgba(14,12,8,0.75)',
          'text-halo-width': 1.2,
        },
      });
    }

    this._addInteractivity();
  },

  _addInteractivity() {
    const map = this._map;
    map.on('mouseenter', LAYER_ID_SYMBOLS, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', LAYER_ID_SYMBOLS, () => { map.getCanvas().style.cursor = ''; });

    if (this._clickHandler) map.off('click', LAYER_ID_SYMBOLS, this._clickHandler);
    this._clickHandler = (e) => {
      const feat = e.features && e.features[0];
      if (!feat) return;
      this._openPopup(e.lngLat, feat.properties);
    };
    map.on('click', LAYER_ID_SYMBOLS, this._clickHandler);
  },

  _openPopup(lngLat, props) {
    if (!window.mapboxgl) return;
    const sp = VegetationSpecies.get(props.speciesKey);
    const candidatesHtml = this._candidatesHtml(props.id);

    const html = `
      <div class="terlab-veg-popup-body">
        <div class="vp-title">${props.commonName}</div>
        <div class="vp-sci">${sp ? sp.scientificName : ''}</div>
        <div class="vp-tags">
          <span class="vp-tag">Ø ${(props.canopyRadius * 2).toFixed(1)}m</span>
          <span class="vp-tag">H ${(props.height || 0).toFixed(1)}m</span>
          ${props.confidence ? `<span class="vp-tag vp-tag-ok">conf ${props.confidence}%</span>` : ''}
          ${sp && sp.origin === 'endemic' ? '<span class="vp-tag vp-tag-warn">endémique</span>' : ''}
          ${sp && sp.origin === 'invasive' ? '<span class="vp-tag vp-tag-err">invasif</span>' : ''}
        </div>
        ${candidatesHtml}
        <div class="vp-btns">
          <button data-act="keep" data-id="${props.id}">Conserver</button>
          <button data-act="cut"  data-id="${props.id}">✕ Abattre</button>
          <button data-act="new"  data-id="${props.id}">+ Nouveau</button>
        </div>
        ${sp && sp.note ? `<div class="vp-note">${sp.note}</div>` : ''}
      </div>`;

    const popup = new window.mapboxgl.Popup({ className: 'terlab-veg-popup', offset: 12 })
      .setLngLat(lngLat).setHTML(html).addTo(this._map);

    const root = popup.getElement();
    root.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const act = btn.getAttribute('data-act');
        if (act === 'keep') await VegetationState.setFeatureStatus(id, 'existing_keep');
        else if (act === 'cut') {
          const reason = prompt('Motif abattage (obligatoire):');
          if (reason) await VegetationState.setFeatureStatus(id, 'existing_cut', reason);
        } else if (act === 'new') {
          await VegetationState.setFeatureStatus(id, 'new_validated', 'Plantation proposée');
        }
        const st = VegetationState.getState();
        if (st) this.update(st);
        popup.remove();
      });
    });
    root.querySelectorAll('button[data-sp]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await VegetationState.setFeatureSpecies(props.id, btn.getAttribute('data-sp'));
        const st = VegetationState.getState();
        if (st) this.update(st);
        popup.remove();
      });
    });
  },

  _candidatesHtml(featureId) {
    const st = VegetationState.getState();
    if (!st) return '';
    const feat = st.features.find(f => f.id === featureId);
    if (!feat || !feat.speciesCandidates || feat.speciesCandidates.length < 2) return '';
    const rows = feat.speciesCandidates.slice(0, 3).map(c =>
      `<button class="vp-cand" data-sp="${c.speciesKey}">
         <span class="vp-cand-color" style="background:${c.color2D}"></span>
         ${c.commonName} <em>${Math.round(c.score * 100)}%</em>
       </button>`).join('');
    return `<div class="vp-cand-list">${rows}</div>`;
  },
};

export default VegetationMapbox;

if (typeof window !== 'undefined') {
  window.VegetationMapbox = VegetationMapbox;
}
