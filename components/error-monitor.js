// TERLAB · error-monitor.js — télémétrie d'erreurs bêta + rapport feedback
// Consomme la file window.__terlabErrors (capture inline précoce dans le
// <head> d'index.html, avant le chargement des modules ES), déduplique, et
// pousse vers RTDB terlab/beta-errors/{sessionId}/{key}. Tolère
// TERLAB_DB === null (mode local) : les erreurs restent en buffer pour le
// rapport « Signaler un problème ».

const MAX_SENT_PER_SESSION = 15;   // anti-spam RTDB
const FLUSH_INTERVAL_MS    = 10_000;
const FEEDBACK_EMAIL       = 'mathiasgiraud@gmail.com';

const ErrorMonitor = {

  _sent:   0,
  _seen:   new Set(),
  _buffer: [],        // erreurs conservées pour le rapport feedback
  _timer:  null,

  init() {
    window.__terlabErrors = window.__terlabErrors ?? [];
    this._timer = setInterval(() => this._flush(), FLUSH_INTERVAL_MS);
    window.addEventListener('beforeunload', () => this._flush());
    this._flush(); // erreurs capturées pendant le boot
  },

  _flush() {
    const queue = window.__terlabErrors;
    if (!queue?.length) return;
    const db = window.TERLAB_DB;

    for (const err of queue.splice(0)) {
      const key = `${err.message}|${err.source ?? ''}|${err.line ?? ''}`;
      if (this._seen.has(key)) continue;
      this._seen.add(key);

      this._buffer.push(err);
      if (this._buffer.length > 30) this._buffer.shift();

      if (db && window.TERLAB_FB_REF && window.TERLAB_FB_SET
          && this._sent < MAX_SENT_PER_SESSION) {
        this._sent++;
        const sid = window.SessionManager?._sessionId ?? 'unknown';
        const id  = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
        try {
          const ref = window.TERLAB_FB_REF(db, `terlab/beta-errors/${sid}/${id}`);
          window.TERLAB_FB_SET(ref, {
            message: String(err.message ?? '').slice(0, 500),
            stack:   String(err.stack ?? '').slice(0, 1500),
            source:  err.source ?? null,
            line:    err.line ?? null,
            type:    err.type ?? 'error',
            phase:   location.hash || null,
            ua:      navigator.userAgent,
            uid:     window.TERLAB_UID ?? null,
            ts:      err.ts ?? new Date().toISOString(),
          }).catch(() => { /* offline / rules : silencieux */ });
        } catch { /* refs indisponibles : silencieux */ }
      }
    }
  },

  // ── Rapport « Signaler un problème » ────────────────────────────
  buildReport() {
    const sm = window.SessionManager;
    const lines = [
      '--- Contexte TERLAB (genere automatiquement) ---',
      `Projet   : ${sm?.getDisplayName?.() ?? '?'} (${sm?._sessionId ?? '?'})`,
      `Phase    : ${location.hash || '(aucune)'}`,
      `Compte   : ${window.TERLAB_USER_EMAIL ?? 'anonyme'}`,
      `Ecran    : ${window.innerWidth}x${window.innerHeight}`,
      `Naviga.  : ${navigator.userAgent}`,
      '',
    ];
    if (this._buffer.length) {
      lines.push(`--- ${this._buffer.length} erreur(s) recente(s) ---`);
      this._buffer.slice(-5).forEach(e =>
        lines.push(`[${e.ts ?? ''}] ${String(e.message ?? '').slice(0, 200)}`));
    } else {
      lines.push('(Aucune erreur JS capturee)');
    }
    lines.push('', '--- Decrivez le probleme ci-dessous ---', '');
    return lines.join('\n');
  },

  openFeedback() {
    const subject = encodeURIComponent(
      `[TERLAB beta] Probleme — ${window.SessionManager?.getDisplayName?.() ?? 'session'}`);
    const body = encodeURIComponent(this.buildReport()).slice(0, 1800);
    window.location.href = `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;
  },
};

export default ErrorMonitor;
