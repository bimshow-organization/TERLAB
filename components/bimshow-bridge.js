// TERLAB · bimshow-bridge.js · Communication postMessage BIMSHOW · v1.1
// ════════════════════════════════════════════════════════════════════════════
// Connexion bidirectionnelle :
//   1. TERLAB en iframe dans BIMSHOW → window.parent
//   2. TERLAB ouvert depuis BIMSHOW  → window.opener
//   3. TERLAB standalone → window.open() vers BIMSHOW (nouveau)
// ════════════════════════════════════════════════════════════════════════════

const BIMSHOW_ORIGIN  = 'https://bimshow.io';
const BIMSHOW_VIEWER  = 'https://bimshow.io/viewer';
const SNAPSHOT_TIMEOUT = 8000;

const BIMSHOWBridge = {
  _pending:  {},
  _counter:  0,
  _target:   null,   // Fenêtre cible (parent, opener, ou popup)
  _ready:    false,   // BIMSHOW a envoyé BIMSHOW_READY

  // ── DÉTECTION DE LA CIBLE BIMSHOW ─────────────────────────────
  _resolveTarget() {
    // Déjà une popup ouverte et vivante ?
    if (this._target && !this._target.closed) return this._target;
    // En iframe : parent est BIMSHOW
    if (window.parent !== window) return window.parent;
    // Ouvert depuis BIMSHOW : opener
    if (window.opener && !window.opener.closed) return window.opener;
    return null;
  },

  get connected() {
    const t = this._resolveTarget();
    return !!(t && this._ready);
  },

  // ── ENVOYER UN MESSAGE VERS BIMSHOW ───────────────────────────
  send(type, payload) {
    const target = this._resolveTarget();
    if (!target) {
      console.warn('[BIMSHOW Bridge] Aucune fenêtre BIMSHOW — appelez connect() d\'abord');
      window.TerlabToast?.show('BIMSHOW non connecté — cliquez BIMSHOW → pour connecter', 'warning');
      return false;
    }

    const msg = { source: 'TERLAB', type, payload, ts: Date.now() };
    try {
      target.postMessage(msg, BIMSHOW_ORIGIN);
      console.info(`[BIMSHOW Bridge] Envoyé: ${type}`);
      return true;
    } catch (e) {
      console.warn('[BIMSHOW Bridge] postMessage failed:', e.message);
      return false;
    }
  },

  // ── OUVRIR BIMSHOW EN POPUP DEPUIS STANDALONE ─────────────────
  connect() {
    // Déjà connecté ?
    const existing = this._resolveTarget();
    if (existing && this._ready) {
      window.TerlabToast?.show('BIMSHOW déjà connecté', 'success', 2000);
      return Promise.resolve(true);
    }

    // Ouvrir popup BIMSHOW viewer
    const session = window.SessionManager;
    const sid     = session?._sessionId ?? '';
    const url     = `${BIMSHOW_VIEWER}?terlab_session=${sid}&source=terlab_standalone`;

    const popup = window.open(url, 'bimshow_viewer',
      'width=1200,height=800,menubar=no,toolbar=no,location=no,status=no');

    if (!popup) {
      window.TerlabToast?.show('Popup bloquée — autorisez les popups pour bimshow.io', 'error');
      return Promise.resolve(false);
    }

    this._target = popup;
    this._ready  = false;

    // Mettre à jour le bouton toolbar
    this._updateToolbarState('connecting');

    // Attendre BIMSHOW_READY (max 15s)
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        if (!this._ready) {
          this._updateToolbarState('disconnected');
          window.TerlabToast?.show('BIMSHOW n\'a pas répondu — vérifiez la connexion', 'warning');
          resolve(false);
        }
      }, 15000);

      // Le handleMessage résoudra via _onReady
      this._onReadyCallback = () => {
        clearTimeout(timeout);
        resolve(true);
      };
    });
  },

  // ── ATTENDRE UN SNAPSHOT BIMSHOW ──────────────────────────────
  waitForSnapshot(timeout = SNAPSHOT_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const id = ++this._counter;
      const timer = setTimeout(() => {
        delete this._pending[id];
        reject(new Error('Timeout snapshot BIMSHOW'));
      }, timeout);

      this._pending[id] = { resolve, timer };
    });
  },

  // ── HANDLER MESSAGE ENTRANT ───────────────────────────────────
  handleMessage(event) {
    if (event.origin !== BIMSHOW_ORIGIN) return;
    const { type, payload } = event.data ?? {};

    if (type === 'BIMSHOW_READY') {
      this._ready = true;
      this._updateToolbarState('connected');
      console.info('[BIMSHOW Bridge] BIMSHOW connecté');
      window.TerlabToast?.show('BIMSHOW connecté', 'success', 2000);
      if (this._onReadyCallback) {
        this._onReadyCallback();
        this._onReadyCallback = null;
      }
    }

    if (type === 'BIMSHOW_SNAPSHOT') {
      const firstPending = Object.values(this._pending)[0];
      if (firstPending) {
        clearTimeout(firstPending.timer);
        firstPending.resolve(payload);
        const key = Object.keys(this._pending)[0];
        delete this._pending[key];
      }

      if (payload?.imageDataUrl) {
        window.SessionManager?.savePhase?.(7, { bimshowSnapshot: payload.imageDataUrl });
      }

      console.info('[BIMSHOW Bridge] Snapshot reçu');
    }
  },

  // ── OUVRIR BIMSHOW VIEWER (bouton BIMSHOW →) ─────────────────
  async openViewer() {
    const session = window.SessionManager;
    const p7      = session?.getPhase?.(7)?.data ?? {};

    // Si pas encore connecté → connect d'abord
    if (!this._resolveTarget() || !this._ready) {
      const ok = await this.connect();
      if (!ok) return;
    }

    // Si un GLB existe, l'envoyer
    if (p7.glb_base64) {
      const terrain = session?.getTerrain?.() ?? {};
      this.send('TERLAB_BIMSHOW_LOAD', {
        glb:          p7.glb_base64,
        sessionId:    session?._sessionId ?? '—',
        phase:        7,
        cameraPreset: 'aerial_southwest',
        terrain:      { lat: terrain.lat, lng: terrain.lng, commune: terrain.commune }
      });
    } else {
      window.TerlabToast?.show('Générez le modèle 3D en Phase 7 puis renvoyez', 'info');
    }
  },

  // ── ÉTAT BOUTON TOOLBAR ───────────────────────────────────────
  _updateToolbarState(state) {
    const btn = document.getElementById('btn-bimshow');
    if (!btn) return;
    btn.classList.remove('bimshow-connected', 'bimshow-connecting', 'bimshow-disconnected');
    switch (state) {
      case 'connected':
        btn.classList.add('bimshow-connected');
        btn.title = 'BIMSHOW connecté — cliquez pour envoyer le modèle';
        break;
      case 'connecting':
        btn.classList.add('bimshow-connecting');
        btn.title = 'Connexion à BIMSHOW en cours…';
        break;
      default:
        btn.classList.add('bimshow-disconnected');
        btn.title = 'Cliquez pour ouvrir BIMSHOW';
    }
  },

  // ── VÉRIFIER SI LA POPUP EST TOUJOURS OUVERTE ─────────────────
  checkAlive() {
    if (this._target && this._target.closed) {
      this._target = null;
      this._ready  = false;
      this._updateToolbarState('disconnected');
      console.info('[BIMSHOW Bridge] Fenêtre BIMSHOW fermée');
    }
  }
};

// Vérifier périodiquement si la popup est toujours vivante
setInterval(() => BIMSHOWBridge.checkAlive(), 3000);

export default BIMSHOWBridge;

// ════════════════════════════════════════════════════════════════════════════
