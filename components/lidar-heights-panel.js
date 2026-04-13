// TERLAB · components/lidar-heights-panel.js · ENSA La Reunion · MGA Architecture
// Panel UI flottant — LiDAR Heights (hauteurs OSM via LiDAR HD IGN)
// Thème TERLAB (tokens.css). Mount via LidarHeightsPanel.mount(container, map).

import { LidarHeights } from '../services/lidar-heights-service.js';

const CSS = `
.lh-panel {
  position: fixed;
  top: calc(var(--topbar-h, 48px) + 8px);
  right: 0;
  width: 340px;
  height: calc(100vh - var(--topbar-h, 48px) - 16px);
  background: var(--bg1);
  border-left: 1px solid var(--border2);
  border-top-left-radius: var(--r-md);
  border-bottom-left-radius: var(--r-md);
  color: var(--text1);
  font-family: var(--fS);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  z-index: var(--z-panel, 20);
  box-shadow: -4px 0 24px rgba(0,0,0,0.4);
  transform: translateX(100%);
  transition: transform 0.3s var(--ease);
}
.lh-panel.open { transform: translateX(0); }

.lh-toggle {
  position: fixed;
  top: calc(var(--topbar-h, 48px) + 80px);
  right: 0;
  width: 32px; height: 84px;
  background: var(--bg2);
  border: 1px solid var(--border2);
  border-right: none;
  border-radius: var(--r-sm) 0 0 var(--r-sm);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  z-index: calc(var(--z-panel, 20) + 1);
  writing-mode: vertical-lr;
  font-family: var(--fT);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.5px;
  color: var(--acc);
  text-transform: uppercase;
  transition: background 0.2s var(--ease);
}
.lh-toggle:hover { background: var(--bg3); }
.lh-toggle.open { right: 340px; }

.lh-header {
  padding: 14px 16px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 10px;
}
.lh-header-icon { font-size: 18px; }
.lh-header h3 {
  margin: 0; font-size: 13px; font-weight: 700;
  color: var(--acc); font-family: var(--fS);
  letter-spacing: 0.3px;
}
.lh-header small { color: var(--text2); font-size: 10px; font-family: var(--fT); }

.lh-body { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }

.lh-section-label {
  font-size: 10px; color: var(--text2);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-family: var(--fT);
}

.lh-modes { display: flex; gap: 6px; }
.lh-mode-btn {
  flex: 1; padding: 8px 4px;
  background: var(--bg);
  border: 1px solid var(--border2);
  border-radius: var(--r-sm);
  color: var(--text2);
  cursor: pointer;
  font-size: 12px; font-weight: 600; text-align: center;
  font-family: var(--fS);
  transition: all 0.15s var(--ease);
}
.lh-mode-btn:hover { border-color: var(--accB); color: var(--text1); }
.lh-mode-btn.active {
  background: var(--accD); border-color: var(--acc); color: var(--acc);
}

.lh-zone-row { display: flex; gap: 6px; align-items: center; }
.lh-select {
  flex: 1; padding: 7px 10px;
  background: var(--bg); border: 1px solid var(--border2);
  border-radius: var(--r-sm); color: var(--text1);
  font-size: 12px; font-family: var(--fS);
  appearance: none;
}
.lh-btn {
  padding: 7px 14px;
  background: var(--acc); border: none;
  border-radius: var(--r-sm);
  color: var(--bg);
  font-size: 12px; font-weight: 700; cursor: pointer;
  font-family: var(--fS);
  transition: background 0.15s var(--ease);
  white-space: nowrap;
}
.lh-btn:hover { background: var(--acc2); }
.lh-btn:disabled { background: var(--bg3); color: var(--text3); cursor: not-allowed; }
.lh-btn.danger { background: var(--red); color: #fff; }
.lh-btn.danger:hover { background: #dc2626; }
.lh-btn.success { background: var(--grn); color: var(--bg); }

.lh-progress-wrap {
  background: var(--bg); border: 1px solid var(--border);
  border-radius: var(--r-md); padding: 12px; display: none;
}
.lh-progress-wrap.visible { display: block; }
.lh-progress-bar-bg {
  height: 5px; background: var(--bg3); border-radius: 3px; margin: 8px 0;
}
.lh-progress-bar {
  height: 100%; background: var(--acc); border-radius: 3px;
  transition: width 0.3s var(--ease); width: 0%;
}
.lh-progress-label { font-size: 11px; color: var(--text2); font-family: var(--fT); }

.lh-stats {
  background: var(--bg); border: 1px solid var(--border);
  border-radius: var(--r-md); padding: 12px; display: none;
}
.lh-stats.visible { display: block; }
.lh-stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
.lh-stat-card {
  background: var(--bg2); border-radius: var(--r-sm); padding: 10px;
  text-align: center;
}
.lh-stat-value {
  font-size: 20px; font-weight: 800; color: var(--acc);
  display: block; font-family: var(--fT);
}
.lh-stat-value.green  { color: var(--grn); }
.lh-stat-value.orange { color: var(--yel); }
.lh-stat-value.red    { color: var(--red); }
.lh-stat-label {
  font-size: 9px; color: var(--text2); margin-top: 3px;
  text-transform: uppercase; letter-spacing: 0.5px;
  font-family: var(--fT);
}

.lh-legend { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 10px; }
.lh-legend-item { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--text2); }
.lh-legend-dot { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }

.lh-detail {
  background: var(--bg); border: 1px solid var(--border);
  border-radius: var(--r-md); padding: 12px; display: none;
}
.lh-detail.visible { display: block; }
.lh-detail h4 { margin: 0 0 10px; font-size: 12px; color: var(--acc); font-family: var(--fS); }
.lh-detail-row {
  display: flex; justify-content: space-between;
  padding: 5px 0; border-bottom: 1px solid var(--border);
}
.lh-detail-key { color: var(--text2); font-size: 11px; }
.lh-detail-val { color: var(--text1); font-weight: 600; font-size: 12px; font-family: var(--fT); }
.lh-detail-actions { display: flex; gap: 6px; margin-top: 10px; }
.lh-input-height {
  flex: 1; padding: 6px 10px;
  background: var(--bg2); border: 1px solid var(--border2);
  border-radius: var(--r-sm); color: var(--text1); font-size: 12px;
  font-family: var(--fT);
}
.lh-badge {
  display: inline-block; padding: 2px 8px;
  border-radius: var(--r-xs); font-size: 10px; font-weight: 700;
  text-transform: uppercase; font-family: var(--fT);
}
.lh-badge.ok      { background: rgba(52,211,153,0.15); color: var(--grn); }
.lh-badge.warn    { background: rgba(251,191,36,0.15); color: var(--yel); }
.lh-badge.error   { background: rgba(239,68,68,0.15); color: var(--red); }
.lh-badge.pending { background: var(--bg3); color: var(--text2); }

.lh-import-zone {
  border: 2px dashed var(--border2); border-radius: var(--r-md);
  padding: 20px; text-align: center; cursor: pointer;
  transition: border-color 0.2s var(--ease); display: none;
}
.lh-import-zone.visible { display: block; }
.lh-import-zone:hover { border-color: var(--acc); }
.lh-import-zone small { color: var(--text2); font-size: 10px; }

.lh-exports { display: flex; gap: 6px; flex-wrap: wrap; }
.lh-export-btn {
  flex: 1; padding: 8px 6px;
  background: var(--bg); border: 1px solid var(--border2);
  border-radius: var(--r-sm); color: var(--text2);
  font-size: 10px; font-weight: 600; cursor: pointer;
  text-align: center; transition: all 0.15s var(--ease);
  font-family: var(--fS);
}
.lh-export-btn:hover { border-color: var(--acc); color: var(--acc); }

.lh-body::-webkit-scrollbar { width: 4px; }
.lh-body::-webkit-scrollbar-track { background: var(--bg); }
.lh-body::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

.lh-sep { border: none; border-top: 1px solid var(--border); margin: 0; }

.lh-hint {
  margin-top: 6px; font-size: 10px; color: var(--text3);
  line-height: 1.4; font-family: var(--fT);
}
`;

const COMMUNES = {
  'Saint-Leu':      [55.24, -21.22, 55.36, -21.12],
  'Saint-Denis':    [55.41, -20.96, 55.56, -20.84],
  'Saint-Pierre':   [55.45, -21.37, 55.55, -21.28],
  'Saint-Paul':     [55.22, -21.09, 55.37, -20.96],
  'Le Tampon':      [55.49, -21.32, 55.60, -21.20],
  'Le Port':        [55.27, -20.96, 55.38, -20.88],
  'La Possession':  [55.31, -20.96, 55.40, -20.88],
  'Sainte-Marie':   [55.51, -20.93, 55.63, -20.83],
  'Saint-Benoit':   [55.68, -21.08, 55.80, -20.98],
  'Cilaos':         [55.46, -21.16, 55.56, -21.06],
  'Saint-Joseph':   [55.56, -21.40, 55.67, -21.30],
};

let _cssInjected = false;
let _mountedContainer = null;

export const LidarHeightsPanel = {

  mount(container, map) {
    if (!_cssInjected) {
      const style = document.createElement('style');
      style.id = 'lh-panel-styles';
      style.textContent = CSS;
      document.head.appendChild(style);
      _cssInjected = true;
    }

    container.innerHTML = _buildHTML();
    _mountedContainer = container;

    const panel  = container.querySelector('.lh-panel');
    const toggle = container.querySelector('.lh-toggle');

    toggle.addEventListener('click', () => {
      const open = panel.classList.toggle('open');
      toggle.classList.toggle('open', open);
    });

    LidarHeights.init(map, {
      onProgress: (stats) => _updateStats(container, stats),
    });

    LidarHeights.onBuildingClick = (osmId, h, feat) => {
      _showDetail(container, osmId, h, feat);
    };

    _bindModeButtons(container, map);
    _bindExports(container);
  },

  /** Re-bind LidarHeights to a new map instance (e.g. when switching phases) */
  rebind(map) {
    LidarHeights.init(map, {
      onProgress: (stats) => _mountedContainer && _updateStats(_mountedContainer, stats),
    });
  },
};

export default LidarHeightsPanel;

function _buildHTML() {
  const communeOptions = Object.keys(COMMUNES)
    .map(c => `<option value="${c}">${c}</option>`)
    .join('');

  return `
    <button class="lh-toggle">LiDAR H</button>

    <div class="lh-panel">
      <div class="lh-header">
        <span class="lh-header-icon">🏗️</span>
        <div>
          <h3>Hauteurs LiDAR HD</h3>
          <small>IGN open data · La Reunion</small>
        </div>
      </div>

      <div class="lh-body">

        <div>
          <div class="lh-section-label">Mode d'analyse</div>
          <div class="lh-modes">
            <button class="lh-mode-btn active" data-mode="live">
              Live WCS<br><small style="font-weight:400;opacity:0.7">fetch IGN</small>
            </button>
            <button class="lh-mode-btn" data-mode="import">
              Import JSON<br><small style="font-weight:400;opacity:0.7">resultats Python</small>
            </button>
          </div>
        </div>

        <hr class="lh-sep">

        <div class="lh-live-controls">
          <div class="lh-section-label">Zone</div>
          <div class="lh-zone-row">
            <select class="lh-select" id="lh-commune-select">
              <option value="">— Vue courante —</option>
              ${communeOptions}
            </select>
            <button class="lh-btn" id="lh-analyze-btn">Analyser</button>
          </div>
          <div class="lh-hint">
            ~5–30s selon densite. Requetes WCS IGN individuelles par batiment.
          </div>
        </div>

        <div class="lh-import-zone" id="lh-import-zone">
          <div style="font-size:22px;margin-bottom:6px;">📂</div>
          <div style="font-weight:600;margin-bottom:4px;">Glisser un fichier JSON</div>
          <small>Sortie reunion_osm_heights.py<br>ou export session precedente</small>
          <br><br>
          <button class="lh-btn" id="lh-import-file-btn">Parcourir...</button>
          <input type="file" id="lh-file-input" accept=".json,.geojson" style="display:none">
        </div>

        <hr class="lh-sep">

        <div class="lh-progress-wrap" id="lh-progress-wrap">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:11px;font-weight:600;color:var(--acc);">Analyse en cours...</span>
            <button class="lh-btn danger" id="lh-abort-btn" style="padding:3px 10px;font-size:10px;">Stop</button>
          </div>
          <div class="lh-progress-bar-bg">
            <div class="lh-progress-bar" id="lh-progress-bar"></div>
          </div>
          <div class="lh-progress-label" id="lh-progress-label">0 / 0 batiments</div>
        </div>

        <div class="lh-stats" id="lh-stats">
          <div class="lh-section-label">Resultats</div>
          <div class="lh-stats-grid">
            <div class="lh-stat-card">
              <span class="lh-stat-value" id="stat-total">0</span>
              <div class="lh-stat-label">Batiments OSM</div>
            </div>
            <div class="lh-stat-card">
              <span class="lh-stat-value green" id="stat-ready">0</span>
              <div class="lh-stat-label">Prets a tagger</div>
            </div>
            <div class="lh-stat-card">
              <span class="lh-stat-value orange" id="stat-veg">0</span>
              <div class="lh-stat-label">Vegetation suspecte</div>
            </div>
            <div class="lh-stat-card">
              <span class="lh-stat-value" id="stat-avg">—</span>
              <div class="lh-stat-label">Hauteur moy.</div>
            </div>
          </div>
          <div class="lh-legend">
            <div class="lh-legend-item"><div class="lh-legend-dot" style="background:#2ecc71"></div>0–6m</div>
            <div class="lh-legend-item"><div class="lh-legend-dot" style="background:#f9ca24"></div>6–12m</div>
            <div class="lh-legend-item"><div class="lh-legend-dot" style="background:#f0932b"></div>12–20m</div>
            <div class="lh-legend-item"><div class="lh-legend-dot" style="background:#eb4d4b"></div>&gt;20m</div>
            <div class="lh-legend-item"><div class="lh-legend-dot" style="background:#ff9f43"></div>vegetation</div>
            <div class="lh-legend-item"><div class="lh-legend-dot" style="background:#aaaaaa"></div>en attente</div>
          </div>
        </div>

        <div class="lh-detail" id="lh-detail">
          <h4 id="lh-detail-title">Batiment selectionne</h4>
          <div id="lh-detail-rows"></div>
          <div class="lh-detail-actions">
            <input class="lh-input-height" type="number" id="lh-height-input" placeholder="Hauteur manuelle (m)" step="0.5" min="0" max="60">
            <button class="lh-btn" id="lh-override-btn">Forcer</button>
          </div>
          <div style="display:flex;gap:6px;margin-top:6px;">
            <button class="lh-btn success" id="lh-validate-btn" style="flex:1">✓ Valider</button>
            <button class="lh-btn danger" id="lh-reject-btn" style="flex:1">✕ Rejeter</button>
          </div>
        </div>

        <hr class="lh-sep">

        <div>
          <div class="lh-section-label">Exports</div>
          <div class="lh-exports">
            <button class="lh-export-btn" id="lh-export-csv">CSV<br><small style="opacity:0.7">audit</small></button>
            <button class="lh-export-btn" id="lh-export-osm">OSM XML<br><small style="opacity:0.7">JOSM</small></button>
            <button class="lh-export-btn" id="lh-export-json">JSON<br><small style="opacity:0.7">session</small></button>
          </div>
          <div class="lh-hint">
            Le fichier OSM XML doit etre valide dans JOSM avant upload.
          </div>
        </div>

      </div>
    </div>
  `;
}

function _bindModeButtons(container, map) {
  const modeBtns = container.querySelectorAll('.lh-mode-btn');
  const liveCtrl  = container.querySelector('.lh-live-controls');
  const importZone = container.querySelector('#lh-import-zone');

  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      liveCtrl.style.display  = mode === 'live'   ? 'block' : 'none';
      importZone.classList.toggle('visible', mode === 'import');
    });
  });

  container.querySelector('#lh-analyze-btn').addEventListener('click', async () => {
    const select = container.querySelector('#lh-commune-select');
    let bbox;
    if (select.value && COMMUNES[select.value]) {
      bbox = COMMUNES[select.value];
    } else {
      const b = map.getBounds();
      bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    }
    container.querySelector('#lh-progress-wrap').classList.add('visible');
    container.querySelector('#lh-stats').classList.add('visible');
    await LidarHeights.analyzeBbox(bbox);
  });

  container.querySelector('#lh-abort-btn').addEventListener('click', () => {
    LidarHeights.abort();
    container.querySelector('#lh-progress-wrap').classList.remove('visible');
  });

  container.querySelector('#lh-import-file-btn').addEventListener('click', () => {
    container.querySelector('#lh-file-input').click();
  });

  container.querySelector('#lh-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    LidarHeights.loadJSON(JSON.parse(text));
    container.querySelector('#lh-stats').classList.add('visible');
  });

  const importZoneEl = container.querySelector('#lh-import-zone');
  importZoneEl.addEventListener('dragover', e => { e.preventDefault(); importZoneEl.style.borderColor = 'var(--acc)'; });
  importZoneEl.addEventListener('dragleave', () => { importZoneEl.style.borderColor = ''; });
  importZoneEl.addEventListener('drop', async e => {
    e.preventDefault();
    importZoneEl.style.borderColor = '';
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const text = await file.text();
    LidarHeights.loadJSON(JSON.parse(text));
    container.querySelector('#lh-stats').classList.add('visible');
  });
}

function _updateStats(container, stats) {
  container.querySelector('#stat-total').textContent = stats.total;
  container.querySelector('#stat-ready').textContent = stats.ready;
  container.querySelector('#stat-veg').textContent   = stats.veg;
  container.querySelector('#stat-avg').textContent   = stats.avgHeight ? `${stats.avgHeight}m` : '—';

  const pct = stats.total > 0 ? (stats.done / stats.total) * 100 : 0;
  container.querySelector('#lh-progress-bar').style.width = `${pct}%`;
  container.querySelector('#lh-progress-label').textContent =
    `${stats.done} / ${stats.total} batiments — ${stats.pending} en attente`;

  if (stats.pending === 0 && stats.done > 0) {
    container.querySelector('#lh-progress-wrap').classList.remove('visible');
  }
}

function _showDetail(container, osmId, h, feat) {
  const panel = container.querySelector('#lh-detail');
  panel.classList.add('visible');

  const statusBadge = _badge(h);
  const height = h?.height_override ?? h?.height_p95;

  container.querySelector('#lh-detail-title').innerHTML =
    `Batiment OSM <code style="font-size:11px">${osmId}</code>`;

  const rows = [
    ['Hauteur P95',   height != null ? `${height} m` : '—'],
    ['Mediane P50',   h?.height_p50 != null ? `${h.height_p50} m` : '—'],
    ['Couverture',    h?.coverage != null ? `${Math.round(h.coverage * 100)}%` : '—'],
    ['Pixels valides', h?.pixel_count ?? '—'],
    ['Vegetation ?',  h?.veg_suspect ? '⚠ Oui' : 'Non'],
    ['Statut',        statusBadge],
  ];

  container.querySelector('#lh-detail-rows').innerHTML = rows.map(([k, v]) => `
    <div class="lh-detail-row">
      <span class="lh-detail-key">${k}</span>
      <span class="lh-detail-val">${v}</span>
    </div>
  `).join('');

  if (height != null) {
    container.querySelector('#lh-height-input').value = height;
  }

  container.querySelector('#lh-override-btn').onclick = () => {
    const val = parseFloat(container.querySelector('#lh-height-input').value);
    if (!isNaN(val)) LidarHeights.overrideHeight(osmId, val);
  };
  container.querySelector('#lh-validate-btn').onclick = () => LidarHeights.validateBuilding(osmId, true);
  container.querySelector('#lh-reject-btn').onclick   = () => LidarHeights.validateBuilding(osmId, false);
}

function _badge(h) {
  if (!h) return `<span class="lh-badge pending">—</span>`;
  if (h.tag_ready && h.validated)  return `<span class="lh-badge ok">Valide</span>`;
  if (h.tag_ready)                 return `<span class="lh-badge ok">Pret</span>`;
  if (h.veg_suspect)               return `<span class="lh-badge warn">Vegetation</span>`;
  if (h.status === 'error')        return `<span class="lh-badge error">Erreur</span>`;
  return `<span class="lh-badge error">${h.reject_reason ?? 'Rejete'}</span>`;
}

function _bindExports(container) {
  container.querySelector('#lh-export-csv').addEventListener('click', () => {
    _download('lidar_heights.csv', LidarHeights.exportCSV(), 'text/csv');
  });
  container.querySelector('#lh-export-osm').addEventListener('click', () => {
    _download('josm_import.osm', LidarHeights.exportOSM(), 'application/xml');
  });
  container.querySelector('#lh-export-json').addEventListener('click', () => {
    _download('lidar_heights.json', LidarHeights.exportJSON(), 'application/json');
  });
}

function _download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
