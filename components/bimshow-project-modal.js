// TERLAB · bimshow-project-modal.js · Browse & import BIMSHOW projects · v1.0
// ════════════════════════════════════════════════════════════════════════════
// Standalone modal that lists user's BIMSHOW projects with thumbnails,
// lets them pick one, downloads the GLB, and calls back with the result.
//
// Usage:
//   import BimshowProjectModal from './bimshow-project-modal.js';
//   const result = await BimshowProjectModal.open();
//   // result = { buffer: ArrayBuffer, siteData, project } or null
// ════════════════════════════════════════════════════════════════════════════

import BimshowProjectBrowser from '../services/bimshow-project-browser.js';

// ── Inject CSS once ─────────────────────────────────────────────
(function injectStyles() {
  if (document.getElementById('bpb-styles')) return;
  const s = document.createElement('style');
  s.id = 'bpb-styles';
  s.textContent = `
    .bpb-overlay {
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,.6);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Inconsolata', 'Source Serif 4', sans-serif;
    }
    .bpb-modal {
      background: var(--card, #f7f4ee); color: var(--text, #1a1a18);
      border: 1px solid var(--border, #d8d0c0);
      border-radius: 12px; width: 90vw; max-width: 720px; max-height: 80vh;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,.25);
    }
    [data-theme="dark"] .bpb-modal {
      background: var(--card, #1e1e1c); color: var(--text, #e8e0d4);
      border-color: var(--border, #3a3830);
      box-shadow: 0 20px 60px rgba(0,0,0,.5);
    }
    .bpb-header {
      display: flex; align-items: center; gap: 12px;
      padding: 14px 18px; border-bottom: 1px solid var(--border, #d8d0c0);
    }
    .bpb-title { margin: 0; font-size: 14px; font-weight: 700; flex: 1; }
    .bpb-user { font-size: 10px; color: var(--muted, #998); }
    .bpb-close {
      background: none; border: none; color: var(--text, #1a1a18);
      font-size: 22px; cursor: pointer; line-height: 1; padding: 0 4px;
    }
    .bpb-close:hover { color: var(--accent, #f59e0b); }

    .bpb-status {
      display: flex; flex-direction: column; align-items: center;
      gap: 12px; padding: 48px 24px; font-size: 12px; color: var(--muted, #998);
    }
    .bpb-spinner {
      width: 24px; height: 24px;
      border: 3px solid var(--border, #d8d0c0);
      border-top-color: var(--accent, #f59e0b);
      border-radius: 50%; animation: bpb-spin .8s linear infinite;
    }
    @keyframes bpb-spin { to { transform: rotate(360deg); } }

    .bpb-progress-bar {
      width: 260px; height: 5px; background: var(--border, #d8d0c0);
      border-radius: 3px; overflow: hidden;
    }
    .bpb-progress-fill {
      height: 100%; background: var(--accent, #f59e0b);
      border-radius: 3px; transition: width .2s;
    }
    .bpb-dl-pct { font-family: 'Inconsolata', monospace; font-size: 11px; }
    .bpb-dl-label { font-size: 11px; }

    .bpb-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 10px; padding: 14px 18px; overflow-y: auto;
    }
    .bpb-card {
      background: var(--raised, #ede8dc); border: 1px solid var(--border, #d8d0c0);
      border-radius: 8px; cursor: pointer; overflow: hidden;
      transition: border-color .2s, transform .15s;
    }
    [data-theme="dark"] .bpb-card { background: var(--raised, #2a2a26); }
    .bpb-card:hover {
      border-color: var(--accent, #f59e0b);
      transform: translateY(-2px);
    }
    .bpb-card.bpb-no-model { opacity: .4; cursor: not-allowed; }
    .bpb-thumb {
      width: 100%; aspect-ratio: 16/10; background: var(--bg2, #ddd8cc);
      display: flex; align-items: center; justify-content: center;
      overflow: hidden; position: relative;
    }
    [data-theme="dark"] .bpb-thumb { background: var(--bg2, #161614); }
    .bpb-thumb-placeholder { font-size: 26px; opacity: .25; }
    .bpb-thumb-img {
      position: absolute; inset: 0; width: 100%; height: 100%;
      object-fit: cover;
    }
    .bpb-info { padding: 7px 9px; }
    .bpb-name {
      display: block; font-size: 10px; font-weight: 600;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .bpb-date { display: block; font-size: 8.5px; color: var(--muted, #998); margin-top: 2px; }
    .bpb-badge-glb {
      display: inline-block; margin-top: 3px; padding: 1px 5px;
      font-size: 7.5px; font-weight: 700; border-radius: 3px;
      background: var(--accent, #f59e0b); color: #000;
    }
  `;
  document.head.appendChild(s);
})();

// ═══════════════════════════════════════════════════════════════
// MODAL CONTROLLER
// ═══════════════════════════════════════════════════════════════

const BimshowProjectModal = {

  _el: null,
  _resolve: null,  // promise resolve for open()

  /**
   * Open the project browser modal.
   * Returns a Promise that resolves with { buffer, siteData, project } or null if cancelled.
   */
  open() {
    return new Promise((resolve) => {
      this._resolve = resolve;
      this._run();
    });
  },

  async _run() {
    if (!BimshowProjectBrowser.isLoggedIn) {
      window.TerlabToast?.show('Connectez-vous avec votre compte BIMSHOW pour importer un projet', 'warning');
      this._finish(null);
      return;
    }

    this._show('loading');

    const projects = await BimshowProjectBrowser.listProjects();
    if (!projects.length) {
      this._show('empty');
      return;
    }

    this._show('grid', projects);

    // Lazy-load thumbnails
    for (const p of projects) {
      const thumb = await BimshowProjectBrowser.loadThumbnail(p);
      const img = this._el?.querySelector(`[data-pid="${p.id}"] .bpb-thumb-img`);
      if (img && thumb) {
        img.src = thumb;
        img.style.display = '';
        const ph = img.parentElement.querySelector('.bpb-thumb-placeholder');
        if (ph) ph.style.display = 'none';
      }
    }
  },

  _show(state, projects) {
    this._el?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'bpb-overlay';
    overlay.innerHTML = this._html(state, projects);

    // Close on backdrop
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this._close();
    });
    // Close button
    overlay.querySelector('.bpb-close')?.addEventListener('click', () => this._close());
    // Escape key
    const onKey = (e) => { if (e.key === 'Escape') { this._close(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);

    // Card clicks
    overlay.querySelectorAll('.bpb-card:not(.bpb-no-model)').forEach(card => {
      card.addEventListener('click', () => this._onSelect(card.dataset.pid));
    });

    document.body.appendChild(overlay);
    this._el = overlay;
  },

  _close() {
    this._el?.remove();
    this._el = null;
    this._finish(null);
  },

  _finish(result) {
    if (this._resolve) {
      this._resolve(result);
      this._resolve = null;
    }
  },

  _html(state, projects) {
    const email = BimshowProjectBrowser.userEmail || '';
    const header = `
      <div class="bpb-header">
        <h2 class="bpb-title">Projets BIMSHOW</h2>
        <span class="bpb-user">${email}</span>
        <button class="bpb-close" title="Fermer">&times;</button>
      </div>`;

    if (state === 'loading') {
      return `<div class="bpb-modal">${header}
        <div class="bpb-status"><div class="bpb-spinner"></div><span>Chargement des projets...</span></div>
      </div>`;
    }
    if (state === 'empty') {
      return `<div class="bpb-modal">${header}
        <div class="bpb-status"><span>Aucun projet trouv&eacute; sur ce compte.</span></div>
      </div>`;
    }
    if (state === 'downloading') {
      return `<div class="bpb-modal">${header}
        <div class="bpb-status">
          <div class="bpb-spinner"></div>
          <span class="bpb-dl-label">T&eacute;l&eacute;chargement du mod&egrave;le...</span>
          <div class="bpb-progress-bar"><div class="bpb-progress-fill" style="width:0%"></div></div>
          <span class="bpb-dl-pct">0%</span>
        </div>
      </div>`;
    }

    // Grid
    const cards = (projects || []).map(p => {
      const date = p.dateCreated ? new Date(p.dateCreated).toLocaleDateString('fr-FR') : '';
      const hasModel = p.modelFormat === 'glb' || p.modelFormat === 'v2';
      const badge = hasModel ? '<span class="bpb-badge-glb">GLB</span>' : '';
      return `
        <div class="bpb-card ${hasModel ? '' : 'bpb-no-model'}" data-pid="${p.id}" title="${p.name || 'Sans nom'}">
          <div class="bpb-thumb">
            <div class="bpb-thumb-placeholder">&#127959;</div>
            <img class="bpb-thumb-img" style="display:none" alt="" />
          </div>
          <div class="bpb-info">
            <span class="bpb-name">${p.name || 'Sans nom'}</span>
            <span class="bpb-date">${date}</span>
            ${badge}
          </div>
        </div>`;
    }).join('');

    return `<div class="bpb-modal">${header}<div class="bpb-grid">${cards}</div></div>`;
  },

  async _onSelect(pid) {
    const project = BimshowProjectBrowser._projects.find(p => p.id === pid);
    if (!project) return;

    this._show('downloading');

    const result = await BimshowProjectBrowser.downloadGLB(pid, (pct) => {
      const fill = this._el?.querySelector('.bpb-progress-fill');
      const lbl  = this._el?.querySelector('.bpb-dl-pct');
      if (fill) fill.style.width = `${pct}%`;
      if (lbl)  lbl.textContent = `${pct}%`;
    });

    this._el?.remove();
    this._el = null;

    if (!result) {
      window.TerlabToast?.show('Erreur de t\u00e9l\u00e9chargement du mod\u00e8le', 'error');
      this._finish(null);
      return;
    }

    window.TerlabToast?.show(
      `Projet "${project.name}" import\u00e9 (${(result.size / 1024 / 1024).toFixed(1)} MB)`,
      'success', 4000
    );

    this._finish({ buffer: result.buffer, siteData: result.siteData, project });
  },
};

export default BimshowProjectModal;
