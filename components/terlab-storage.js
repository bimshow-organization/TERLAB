// TERLAB · terlab-storage.js · Gestionnaire multi-sessions · ENSA La Réunion
// Inspiré de GIEP carte-storage.js — localStorage multi-terrains
// Chaque session = un projet terrain indépendant avec son propre UUID

const STORAGE_KEY   = 'terlab_sessions';
const MAX_SESSIONS  = 8;

const TerlabStorage = {

  // ── LISTER ────────────────────────────────────────────────
  listSessions() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const sessions = JSON.parse(raw);
      if (!Array.isArray(sessions)) return [];
      return sessions
        .filter(s => s && s.id)
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    } catch {
      return [];
    }
  },

  // ── CRÉER ─────────────────────────────────────────────────
  createSession({ etudiant = '', annee = 'M1', groupe = '' } = {}) {
    const id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `tl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const sess = {
      id,
      schemaVersion: '1.0',
      etudiant,
      annee,
      groupe,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completion: 0,
      demo: null,
      terrain: {},
      phases: {},
      exports: { pdfUrl: null, dxfUrl: null, glbUrl: null, qrCode: null }
    };

    this._save(sess);
    return sess;
  },

  // ── CHARGER ───────────────────────────────────────────────
  getSession(id) {
    return this.listSessions().find(s => s.id === id) ?? null;
  },

  loadSession(id) {
    const sess = this.getSession(id);
    if (!sess) return null;

    // Initialiser le SessionManager avec ces données
    if (window.SessionManager?._loadFromObject) {
      window.SessionManager._loadFromObject(sess);
    }
    return sess;
  },

  // ── METTRE À JOUR ─────────────────────────────────────────
  updateSession(sess) {
    if (!sess?.id) return;
    sess.updatedAt = new Date().toISOString();
    this._save(sess);
  },

  // ── SUPPRIMER ─────────────────────────────────────────────
  deleteSession(id) {
    const sessions = this.listSessions().filter(s => s.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  },

  // ── AUTO-SAVE ─────────────────────────────────────────────
  // Écoute terlab:session-changed et persiste la session courante
  attachAutoSave() {
    window.addEventListener('terlab:session-changed', () => {
      const current = window.SessionManager?._data;
      if (!current?.sessionId) return;
      // Enrichir avec métadonnées TerlabStorage
      const existing = this.getSession(current.sessionId);
      const merged = {
        ...current,
        id: current.sessionId,
        etudiant: existing?.etudiant ?? current.etudiant ?? '',
        annee: existing?.annee ?? current.annee ?? '',
        groupe: existing?.groupe ?? current.groupe ?? '',
        updatedAt: new Date().toISOString(),
        completion: this._computeCompletion(current)
      };
      this._save(merged);
    });
  },

  // ── EXPORT .terlab ────────────────────────────────────────
  export(id) {
    const sess = this.getSession(id);
    if (!sess) return;
    const blob = new Blob([JSON.stringify(sess, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const date = new Date().toLocaleDateString('fr-FR').replace(/\//g, '-');
    const name = sess.etudiant || 'session';
    a.download = `TERLAB_${name}_${date}.terlab`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  // ── IMPORT .terlab ────────────────────────────────────────
  import(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const sess = JSON.parse(e.target.result);
          // Nouveau ID pour éviter les collisions
          sess.id = typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `tl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          sess.updatedAt = new Date().toISOString();
          this._save(sess);
          resolve(sess);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  },

  // ── INTERNAL ──────────────────────────────────────────────
  _save(sess) {
    try {
      const sessions = this.listSessions().filter(s => s.id !== sess.id);
      sessions.unshift(sess);
      // Limiter le nombre de sessions
      if (sessions.length > MAX_SESSIONS) sessions.length = MAX_SESSIONS;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch (e) {
      console.warn('[TerlabStorage] Erreur sauvegarde:', e.message);
    }
  },

  _computeCompletion(sessionData) {
    const total = 14;
    const done = Object.values(sessionData.phases ?? {}).filter(p => p?.completed).length;
    return Math.round(done / total * 100);
  }
};

export default TerlabStorage;
