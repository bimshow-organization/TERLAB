// TERLAB · terlab-storage.js · Gestionnaire multi-sessions · ENSA La Réunion
// Inspiré de GIEP carte-storage.js — localStorage multi-terrains
// Chaque session = un projet terrain indépendant avec son propre UUID

import { slimSession, isQuotaError } from '../utils/session-slim.js';

const STORAGE_KEY   = 'terlab_sessions';
const MAX_SESSIONS  = 15;

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

    // Initialiser le SessionManager avec ces données.
    // Échec = échec : retourner sess sans avoir chargé ferait croire à
    // l'appelant que la session est active, et la 1re sauvegarde de phase
    // écraserait le travail par une fiche vierge (bug « Continuer »).
    if (!window.SessionManager?._loadFromObject) {
      console.error('[TerlabStorage] SessionManager indisponible — chargement annulé');
      return null;
    }
    window.SessionManager._loadFromObject(sess);
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

  // ── CLOUD (user-scoped) ───────────────────────────────────
  // Lit l'index /users/{uid}/terlabProjects et fusionne avec les sessions locales
  // (cloud prioritaire sur id identique). Retourne [] si pas de Firebase/auth.
  async listCloudSessions() {
    const db  = window.TERLAB_DB;
    const uid = window.TERLAB_UID;
    const auth = window.TERLAB_AUTH;
    const isBimshowUser = !!(uid && auth?.currentUser && !auth.currentUser.isAnonymous);
    if (!db || !isBimshowUser) return [];
    try {
      const idxRef = window.TERLAB_FB_REF(db, `users/${uid}/terlabProjects`);
      const snap   = await window.TERLAB_FB_GET(idxRef);
      if (!snap.exists()) return [];
      const obj = snap.val() || {};
      return Object.values(obj)
        .filter(s => s && s.id)
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    } catch (e) {
      console.warn('[TerlabStorage] listCloudSessions failed:', e.message);
      return [];
    }
  },

  async loadCloudSession(id) {
    if (!window.SessionManager) return null;
    return window.SessionManager.restoreFromFirebase(id);
  },

  async deleteCloudSession(id) {
    const db  = window.TERLAB_DB;
    const uid = window.TERLAB_UID;
    if (!db || !uid || !id) return;
    try {
      const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
      await remove(ref(db, `users/${uid}/terlabProjects/${id}`));
      await remove(ref(db, `terlab/projects/${id}`));
    } catch (e) {
      console.warn('[TerlabStorage] deleteCloudSession failed:', e.message);
    }
  },

  // ── INTERNAL ──────────────────────────────────────────────
  _save(sess) {
    // Cette cle porte jusqu'a MAX_SESSIONS projets : les blobs lourds
    // (snapshots carte, PNG bimshow, GLB base64) y sont TOUJOURS purges,
    // sinon un seul GLB sature le quota et plus aucun projet n'est persiste.
    const slim = slimSession(sess);
    const sessions = this.listSessions().filter(s => s.id !== slim.id);
    sessions.unshift(slim);
    // Limiter le nombre de sessions
    if (sessions.length > MAX_SESSIONS) sessions.length = MAX_SESSIONS;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
      return true;
    } catch (e) {
      // Quota atteint malgre la purge : sacrifier les projets les plus
      // anciens plutot que de perdre le projet courant (place en tete).
      if (isQuotaError(e)) {
        for (let keep = sessions.length - 1; keep >= 1; keep--) {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, keep)));
            console.warn(`[TerlabStorage] Quota atteint — ${sessions.length - keep} projet(s) ancien(s) retire(s) du cache local`);
            this._warnQuota(sessions.length - keep);
            return true;
          } catch { /* encore trop gros : continuer a reduire */ }
        }
      }
      console.error('[TerlabStorage] Erreur sauvegarde:', e.message);
      this._warnQuota(0);
      return false;
    }
  },

  // Alerte visible (throttle 2 min) : l'etudiant doit savoir que la
  // sauvegarde locale ne passe plus et exporter son .terlab.
  _quotaWarnedAt: 0,
  _warnQuota(removedCount) {
    if (Date.now() - this._quotaWarnedAt < 120_000) return;
    this._quotaWarnedAt = Date.now();
    const rule = removedCount > 0
      ? `Stockage local sature — ${removedCount} projet(s) ancien(s) retire(s) de la liste locale. `
        + 'Exportez vos sessions (.terlab) par securite. La sync cloud reste active.'
      : 'Stockage local sature — la liste des projets ne peut plus etre mise a jour. '
        + 'Exportez votre session (.terlab) par securite. La sync cloud reste active.';
    if (window.TerlabNotification?.notify) {
      window.TerlabNotification.notify({ severity: 'CRITIQUE', rule, phase: 'session' });
    } else {
      window.TerlabToast?.show(rule, 'error', 8000);
    }
  },

  _computeCompletion(sessionData) {
    const total = 14;
    const done = Object.values(sessionData.phases ?? {}).filter(p => p?.completed).length;
    return Math.round(done / total * 100);
  }
};

export default TerlabStorage;
