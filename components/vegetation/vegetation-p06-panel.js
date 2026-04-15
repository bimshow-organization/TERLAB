'use strict';
/**
 * TERLAB × BPF — P06 BIO Vegetation panel
 * Port adapté de terlab-vegetation/phases/p06-bio-patch.ts
 *
 * Monte un panneau à droite dans phases/p06-biodiversite.html :
 *   - détection OBIA/LiDAR
 *   - placement manuel (+ clic carte)
 *   - bilan canopée/espèces
 *   - export GeoJSON
 *
 * Dépendances globales :
 *   window.TerlabMap (MapViewer) · window.SessionManager · window.ThemeSwitcher
 *   window.VegetationDetection · window.VegetationMapbox · window.VegetationState
 *   window.VegetationSpecies · window.VegetationExport · window.TopViewSymbols
 *
 * Pattern TERLAB : exposition globale window.VegetationP06Panel.
 * Bridge BIMSHOW : hors scope (reporté).
 */

import VegetationDetection from '../../services/vegetation/vegetation-detection.js';
import VegetationMapbox    from '../../services/vegetation/vegetation-mapbox.js';
import VegetationState     from '../../services/vegetation/vegetation-state.js';
import VegetationSpecies   from '../../services/vegetation/vegetation-species.js';
import VegetationExport    from '../../services/vegetation/vegetation-export.js';

const PANEL_ID = 'veg-phase06-panel';

const VegetationP06Panel = {

  _map: null,
  _sessionId: '',
  _panel: null,
  _state: null,
  _addMode: false,
  _unsubState: null,

  async init(sessionId, map) {
    if (this._panel) this.dispose();
    this._sessionId = sessionId || 'demo';
    this._map = map;
    await VegetationSpecies.load();
    this._createPanel();

    const saved = await VegetationState.init(this._sessionId);
    if (saved) {
      this._state = saved;
      await VegetationMapbox.init(map, saved);
      this._updatePanelStats(saved);
    }

    this._unsubState = VegetationState.subscribe(state => {
      this._state = state;
      this._updatePanelStats(state);
      if (state.features.length) VegetationMapbox.update(state);
    });

    this._setupMapClick();
    console.info('[P06 Veg] panel initialisé · session:', this._sessionId);
  },

  async runDetection(source) {
    if (!this._map) return;
    source = source || 'obia';
    this._setLoading(true, `Détection ${source}…`);
    try {
      const bounds = this._map.getBounds();
      const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
      const center = this._map.getCenter();
      const centroid = [center.lng, center.lat];

      const session = window.SessionManager && window.SessionManager._data;
      const terrain = (session && session.terrain) || {};
      const altitude = terrain.altitude || terrain.altitudeNGR || 120;
      const biome = terrain.biome || 'tropical-reunion';

      const ndviEl = document.getElementById('veg-ndvi');
      const ndvi = ndviEl ? parseFloat(ndviEl.value) : 0.28;

      const state = await VegetationDetection.detect(
        bbox, centroid, altitude, biome, this._sessionId,
        { source, ndviThreshold: ndvi, clusterEpsilon_m: 1.5 }
      );
      await VegetationState.applyDetectionResult(state);
      await VegetationMapbox.init(this._map, state);
      this._showNotif(`${state.features.length} arbres détectés`);
    } catch (e) {
      console.error('[P06 Veg] detect error', e);
      this._showError('Erreur détection : ' + e.message);
    } finally {
      this._setLoading(false);
    }
  },

  exportGeoJSON() {
    if (!this._state) return;
    VegetationExport.downloadGeoJSON(this._state, `vegetation_${this._sessionId.slice(0,8)}.geojson`);
  },

  async _setupMapClick() {
    const toggleBtn = document.getElementById('veg-btn-add');
    if (!toggleBtn) return;

    toggleBtn.addEventListener('click', () => {
      this._addMode = !this._addMode;
      toggleBtn.textContent = this._addMode ? '✕ Annuler placement' : '+ Placer arbre';
      toggleBtn.classList.toggle('is-active', this._addMode);
      this._map.getCanvas().style.cursor = this._addMode ? 'crosshair' : '';
    });

    this._map.on('click', async (e) => {
      if (!this._addMode) return;
      if (!this._state) {
        // Initialiser un état vide si aucune détection préalable
        const center = this._map.getCenter();
        await VegetationState.applyDetectionResult({
          sessionId: this._sessionId,
          parcelleCentroid: [center.lng, center.lat],
          parcellePolygon: [], altitude: 120, biome: 'tropical-reunion',
          features: [],
          stats: VegetationDetection.computeStats([], [
            center.lng - 0.001, center.lat - 0.001,
            center.lng + 0.001, center.lat + 0.001,
          ]),
          detectionConfig: { source: 'manual' },
          updatedAt: new Date().toISOString(),
        });
      }
      const sel = document.getElementById('veg-species-select');
      const key = (sel && sel.value) || 'mango';
      const sp = VegetationSpecies.get(key);
      const feat = await VegetationState.addNewTree(
        [e.lngLat.lng, e.lngLat.lat], key, sp ? sp.canopyRadius_m : 3
      );
      // Forcer un premier rendu Mapbox si couches absentes
      const st = VegetationState.getState();
      if (st) await VegetationMapbox.init(this._map, st);
      this._showNotif(`+ ${sp ? sp.commonName : key} placé`);
      // Désactive le mode placement après 1 clic
      this._addMode = false;
      this._map.getCanvas().style.cursor = '';
      const btn = document.getElementById('veg-btn-add');
      if (btn) { btn.textContent = '+ Placer arbre'; btn.classList.remove('is-active'); }
    });
  },

  _createPanel() {
    const mapEl = this._map.getContainer();
    const host = (mapEl && mapEl.parentElement) || document.body;
    const panel = document.createElement('div');
    panel.className = 'veg-panel';
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="veg-panel-hd">
        <span>🌿 Végétation · P06</span>
        <span class="veg-badge" id="veg-badge">0 arbres</span>
      </div>
      <div class="veg-panel-body">
        <div>
          <div class="veg-label">Source détection</div>
          <select id="veg-source-select" class="veg-select">
            <option value="obia">OBIA (Ortho IGN)</option>
            <option value="lidar">LiDAR CHM (COPC)</option>
            <option value="manual">Manuel uniquement</option>
          </select>
        </div>
        <div>
          <div class="veg-label">Seuil NDVI visible <span id="veg-ndvi-display">0.28</span></div>
          <input type="range" id="veg-ndvi" min="0.1" max="0.5" step="0.02" value="0.28" style="width:100%">
        </div>
        <button class="veg-btn" id="veg-btn-detect">⟳ Lancer détection</button>
        <hr class="veg-sep">
        <div>
          <div class="veg-label">Espèce à planter</div>
          <select id="veg-species-select" class="veg-select"></select>
        </div>
        <button id="veg-btn-add" class="veg-btn veg-btn--success">+ Placer arbre</button>
        <hr class="veg-sep">
        <div id="veg-stats-panel">
          <div class="veg-stat-row"><span>Détectés</span><span class="veg-stat-val" id="vs-total">0</span></div>
          <div class="veg-stat-row"><span>Conservés</span><span class="veg-stat-val" id="vs-keep">0</span></div>
          <div class="veg-stat-row veg-stat-row--danger"><span>À abattre</span><span class="veg-stat-val" id="vs-cut">0</span></div>
          <div class="veg-stat-row veg-stat-row--success"><span>Nouveaux</span><span class="veg-stat-val" id="vs-new">0</span></div>
          <div class="veg-stat-row"><span>Canopée Δ</span><span class="veg-stat-val" id="vs-canopy">—</span></div>
          <div class="veg-stat-row"><span>Endémiques</span><span class="veg-stat-val" id="vs-endemic">0</span></div>
        </div>
        <hr class="veg-sep">
        <button class="veg-btn" id="veg-btn-export">↓ Export GeoJSON</button>
        <div id="veg-loader" class="veg-loader" style="display:none">
          <div class="veg-spinner"></div><span id="veg-loader-msg">Chargement…</span>
        </div>
        <div id="veg-notif" class="veg-notif" style="display:none"></div>
        <div id="veg-error" class="veg-warn" style="display:none"></div>
      </div>
    `;
    host.style.position = host.style.position || 'relative';
    host.appendChild(panel);
    this._panel = panel;

    // Peupler le select espèces (filtrer pour arbres/arbustes plantables)
    const allSpecies = VegetationSpecies.all()
      .filter(sp => sp.canopyRadius_m >= 0.8 && sp.origin !== 'invasive')
      .sort((a, b) => a.commonName.localeCompare(b.commonName, 'fr'));
    const select = document.getElementById('veg-species-select');
    if (select) {
      select.innerHTML = allSpecies.map(sp =>
        `<option value="${sp.key}">${sp.commonName} (Ø${(sp.canopyRadius_m*2).toFixed(1)}m)</option>`
      ).join('');
    }

    document.getElementById('veg-ndvi').addEventListener('input', (e) => {
      const d = document.getElementById('veg-ndvi-display');
      if (d) d.textContent = e.target.value;
    });
    document.getElementById('veg-btn-detect').addEventListener('click', () => {
      const src = document.getElementById('veg-source-select').value;
      this.runDetection(src);
    });
    document.getElementById('veg-btn-export').addEventListener('click', () => this.exportGeoJSON());
  },

  _updatePanelStats(state) {
    const s = state.stats || {};
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(val);
    };
    set('veg-badge', `${state.features.length} arbres`);
    set('vs-total', state.features.length);
    set('vs-keep',  s.totalKeep  || 0);
    set('vs-cut',   s.totalCut   || 0);
    set('vs-new',   s.totalNew   || 0);
    set('vs-endemic', s.endemicCountAfter || 0);
    const dpct = s.canopyCoverDelta_pct;
    set('vs-canopy', dpct == null ? '—' : `${dpct > 0 ? '+' : ''}${dpct}%`);

    const errEl = document.getElementById('veg-error');
    if (errEl) {
      if (s.warnings && s.warnings.length) {
        errEl.style.display = 'block';
        errEl.innerHTML = s.warnings.map(w => `⚠ ${w.message}`).join('<br>');
      } else errEl.style.display = 'none';
    }
  },

  _setLoading(on, msg = 'Chargement…') {
    const el = document.getElementById('veg-loader');
    const msgEl = document.getElementById('veg-loader-msg');
    if (el) el.style.display = on ? 'flex' : 'none';
    if (msgEl) msgEl.textContent = msg;
  },

  _showError(msg) {
    const el = document.getElementById('veg-error');
    if (el) { el.style.display = 'block'; el.textContent = msg; }
  },

  _showNotif(msg) {
    const el = document.getElementById('veg-notif');
    if (!el) return;
    el.style.display = 'block';
    el.textContent = msg;
    setTimeout(() => { el.style.display = 'none'; }, 3000);
  },

  dispose() {
    try { VegetationMapbox.remove(); } catch {}
    if (typeof this._unsubState === 'function') this._unsubState();
    this._unsubState = null;
    if (this._panel) this._panel.remove();
    this._panel = null;
  },
};

export default VegetationP06Panel;

if (typeof window !== 'undefined') {
  window.VegetationP06Panel = VegetationP06Panel;
}
