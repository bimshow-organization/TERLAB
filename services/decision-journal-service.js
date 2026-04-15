// TERLAB · decision-journal-service.js · Trace pedagogique des decisions etudiant
// ENSA La Reunion · Sprint 1 Procedure pedagogique P00-P13
//
// Enregistre :
//   - VALIDATION   : l'etudiant confirme une etape (avec ou sans motif)
//   - CHOIX        : l'etudiant choisit parmi des options (motif obligatoire)
//   - SAISIE       : l'etudiant saisit une valeur manuelle
//   - NOTIF_LUE    : l'etudiant a vu une notification hierarchisee
//
// Persistance : SessionManager.phases[phaseId].decisions[]
// Lecture : getAll() pour le journal PDF (P12 · bloc C).

const TYPES = {
  VALIDATION: 'validation',
  CHOIX:      'choix',
  SAISIE:     'saisie',
  NOTIF_LUE:  'notif_lue',
};

const DecisionJournal = {

  // { phase, etape, type, valeur, motif, auto, notif_id }
  log(entry) {
    const S = window.SessionManager || window.TERLAB?.Session;
    if (!S) { console.warn('[DecisionJournal] SessionManager indisponible'); return null; }

    const phaseId = this._normPhase(entry.phase);
    if (phaseId == null) return null;

    if (entry.type === TYPES.CHOIX && !entry.auto && !entry.motif) {
      console.warn('[DecisionJournal] CHOIX sans motif (phase', phaseId, 'etape', entry.etape, ')');
    }

    const record = {
      phase:     phaseId,
      etape:     entry.etape ?? null,
      type:      entry.type || TYPES.SAISIE,
      valeur:    entry.valeur ?? null,
      motif:     entry.motif ?? null,
      auto:      !!entry.auto,
      timestamp: new Date().toISOString(),
    };
    if (entry.notif_id) record.notif_id = entry.notif_id;

    const path = `phases.${phaseId}.decisions`;
    const list = S.getField(path) || [];
    list.push(record);
    S.setField(path, list);

    window.dispatchEvent(new CustomEvent('terlab:decision-logged', { detail: record }));
    return record;
  },

  logValidation({ phase, etape, valeur = true, motif = null, auto = false }) {
    return this.log({ phase, etape, type: TYPES.VALIDATION, valeur, motif, auto });
  },

  logChoix({ phase, etape, valeur, motif, auto = false }) {
    return this.log({ phase, etape, type: TYPES.CHOIX, valeur, motif, auto });
  },

  logSaisie({ phase, etape, valeur }) {
    return this.log({ phase, etape, type: TYPES.SAISIE, valeur, auto: false });
  },

  logNotificationRead({ id, phase, rule, severity }) {
    if (phase == null) return null;
    return this.log({
      phase,
      etape:  rule || null,
      type:   TYPES.NOTIF_LUE,
      valeur: { id, severity },
      auto:   true,
    });
  },

  getPhase(phaseId) {
    const S = window.SessionManager || window.TERLAB?.Session;
    const id = this._normPhase(phaseId);
    if (!S || id == null) return [];
    return S.getField(`phases.${id}.decisions`) || [];
  },

  getAll() {
    const S = window.SessionManager || window.TERLAB?.Session;
    if (!S) return [];
    const phases = S.getField('phases') || {};
    const all = [];
    for (const [pid, p] of Object.entries(phases)) {
      for (const d of (p?.decisions || [])) all.push({ ...d, phase: Number(pid) });
    }
    return all.sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1));
  },

  _normPhase(p) {
    if (p == null) return null;
    if (typeof p === 'number') return p;
    const m = String(p).match(/\d+/);
    return m ? Number(m[0]) : null;
  },

  TYPES,
};

export default DecisionJournal;
export { TYPES };
