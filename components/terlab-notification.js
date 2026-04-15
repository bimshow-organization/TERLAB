// TERLAB · terlab-notification.js · Hub de notifications hierarchisees
// ENSA La Reunion · Sprint 1 Procedure pedagogique P00-P13
//
// Quatre niveaux :
//   BLOQUANT      -> popup modal, bouton "J'ai compris", bloque la progression
//   CRITIQUE      -> bandeau persistant en haut de phase, reductible
//   AVERTISSEMENT -> toast dismissable (5s)
//   INFO          -> toast court (3s) ou tooltip
//
// API :
//   TerlabNotification.notify({ severity, rule, message, phase, docRef, onAck })
//   TerlabNotification.dismiss(id)
//   TerlabNotification.clearPhase(phaseId)
//
// Chaque notification emise est journalisee (id lu) via DecisionJournal si dispo.

const SEVERITY = {
  BLOQUANT:       'bloquant',
  CRITIQUE:       'critique',
  AVERTISSEMENT:  'avertissement',
  INFO:           'info',
};

const TerlabNotification = {
  _active: new Map(),    // id -> { el, severity, phase }
  _bannerRoot: null,
  _modalRoot: null,
  _seq: 0,

  init() {
    if (!document.getElementById('toast-container')) {
      const c = document.createElement('div');
      c.id = 'toast-container';
      c.className = 'toast-container';
      document.body.appendChild(c);
    }
    this._ensureBannerRoot();
    this._ensureModalRoot();
  },

  _ensureBannerRoot() {
    let r = document.getElementById('terlab-banner-root');
    if (!r) {
      r = document.createElement('div');
      r.id = 'terlab-banner-root';
      r.className = 'terlab-banner-root';
      document.body.appendChild(r);
    }
    this._bannerRoot = r;
  },

  _ensureModalRoot() {
    let r = document.getElementById('terlab-modal-root');
    if (!r) {
      r = document.createElement('div');
      r.id = 'terlab-modal-root';
      r.className = 'terlab-modal-root';
      document.body.appendChild(r);
    }
    this._modalRoot = r;
  },

  // message : string, docRef : { label, url } | null, phase : '07' | null
  notify({ severity = SEVERITY.INFO, rule = '', message = '', phase = null, docRef = null, onAck = null, duration = null } = {}) {
    this.init();
    const id = `n${++this._seq}`;
    let el = null;

    switch (severity) {
      case SEVERITY.BLOQUANT:      el = this._renderModal(id, { rule, message, docRef, onAck }); break;
      case SEVERITY.CRITIQUE:      el = this._renderBanner(id, { rule, message, docRef }); break;
      case SEVERITY.AVERTISSEMENT: el = this._renderToast(id, { message, docRef }, 'warning', duration ?? 5000); break;
      case SEVERITY.INFO:
      default:                     el = this._renderToast(id, { message, docRef }, 'info', duration ?? 3000); break;
    }
    this._active.set(id, { el, severity, phase, rule });
    this._logRead(id, { phase, rule, severity });
    return id;
  },

  dismiss(id) {
    const entry = this._active.get(id);
    if (!entry) return;
    if (entry.el?.parentNode) entry.el.parentNode.removeChild(entry.el);
    this._active.delete(id);
  },

  clearPhase(phaseId) {
    for (const [id, e] of this._active) {
      if (e.phase === phaseId) this.dismiss(id);
    }
  },

  // ── RENDERERS ─────────────────────────────────────────────────

  _renderToast(id, { message, docRef }, cssType, duration) {
    const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${cssType}`;
    t.dataset.notifId = id;
    t.innerHTML = `<span>${this._safe(message)}</span>${this._refHTML(docRef)}`;
    container.appendChild(t);
    setTimeout(() => {
      t.classList.add('fade-out');
      t.addEventListener('animationend', () => { t.remove(); this._active.delete(id); }, { once: true });
    }, duration);
    return t;
  },

  _renderBanner(id, { rule, message, docRef }) {
    const b = document.createElement('div');
    b.className = 'terlab-banner terlab-banner-critique';
    b.dataset.notifId = id;
    b.innerHTML = `
      <div class="terlab-banner-body">
        <span class="terlab-banner-icon">!</span>
        <div class="terlab-banner-text">
          ${rule ? `<strong>${this._safe(rule)}</strong> ` : ''}
          <span>${this._safe(message)}</span>
          ${this._refHTML(docRef)}
        </div>
        <button class="terlab-banner-close" aria-label="Reduire">&times;</button>
      </div>`;
    b.querySelector('.terlab-banner-close').addEventListener('click', () => this.dismiss(id));
    this._bannerRoot.appendChild(b);
    return b;
  },

  _renderModal(id, { rule, message, docRef, onAck }) {
    const m = document.createElement('div');
    m.className = 'terlab-modal terlab-modal-bloquant';
    m.dataset.notifId = id;
    m.innerHTML = `
      <div class="terlab-modal-backdrop"></div>
      <div class="terlab-modal-card" role="alertdialog" aria-modal="true">
        <div class="terlab-modal-header">${rule ? this._safe(rule) : 'Alerte bloquante'}</div>
        <div class="terlab-modal-body">
          <p>${this._safe(message)}</p>
          ${this._refHTML(docRef)}
        </div>
        <div class="terlab-modal-actions">
          <button class="terlab-modal-ack">J'ai compris</button>
        </div>
      </div>`;
    m.querySelector('.terlab-modal-ack').addEventListener('click', () => {
      this.dismiss(id);
      if (typeof onAck === 'function') onAck();
    });
    this._modalRoot.appendChild(m);
    return m;
  },

  _refHTML(docRef) {
    if (!docRef?.label) return '';
    const href = docRef.url ? ` href="${this._safe(docRef.url)}" target="_blank" rel="noopener"` : '';
    return ` <a class="terlab-notif-ref"${href}>&#128206; ${this._safe(docRef.label)}</a>`;
  },

  _safe(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  },

  _logRead(id, meta) {
    const J = window.TERLAB?.DecisionJournal || window.DecisionJournal;
    if (J && typeof J.logNotificationRead === 'function') {
      try { J.logNotificationRead({ id, ...meta }); } catch {}
    }
  },

  SEVERITY,
};

export default TerlabNotification;
export { SEVERITY };
