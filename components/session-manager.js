// TERLAB · session-manager.js · Persistence session · ENSA La Réunion v1.0
// UUID anonyme + localStorage offline-first + Firebase RTDB sync

const SCHEMA_VERSION = '1.1';
const UUID_KEY       = 'terlab_session_uuid';
const DATA_KEY       = 'terlab_session_data';
const SYNC_INTERVAL  = 60_000; // 60s

const SessionManager = {

  _data:       null,
  _sessionId:  null,
  _syncTimer:  null,
  _dirty:      false,

  // ── INIT ──────────────────────────────────────────────────────
  init() {
    this._sessionId = this._getOrCreateUUID();
    this._data      = this._loadLocal();

    // Sync Firebase en arrière-plan
    this._startSyncLoop();

    console.info(`[Session] ID: ${this._sessionId}`);
    return this._sessionId;
  },

  // ── UUID ANONYME ──────────────────────────────────────────────
  _getOrCreateUUID() {
    let id = localStorage.getItem(UUID_KEY);
    if (!id) {
      id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `tl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
      localStorage.setItem(UUID_KEY, id);
    }
    return id;
  },

  // ── DONNÉES PAR DÉFAUT ────────────────────────────────────────
  //
  // Schéma session (champs documentés mais non initialisés — saisis par les phases) :
  //
  //   terrain.azimut_pente_deg : number  — direction aval de la pente (compass,
  //     0=N, 90=E, sens horaire). Lu par TopoCaseService.getProgConstraints
  //     puis par AutoPlanStrategies.isohypses pour aligner le bâtiment ⊥ aux
  //     courbes de niveau. Renseigné en phase 1 (Topographie) à côté de
  //     terrain.pente_moy_pct. Si absent, la stratégie Isohypses est désactivée.
  //
  //   phases.7.data.mitoyen_g : boolean  — règle binaire latérale gauche
  //   phases.7.data.mitoyen_d : boolean  — règle binaire latérale droite
  //     Indépendants : G mitoyen + D recul standard est valide. Lus par
  //     EnvelopeGenerator (PLU.mitoyen_g/d), AutoPlanEngine (mitOpts pour
  //     TerrainP07Adapter.adaptiveInset) et expandFaceMitoyenne (snap flush
  //     sur limite séparative oblique). L'ancien flag combiné mitoyen_lateral
  //     reste lu pour compat ; il active les deux côtés simultanément.
  //
  //   phases.7.data.inlets : Array<Object>|undefined — encoches sur limites mitoyennes
  //     Profil segmente sur une arete mitoyenne : mitoyen1 -> inlet (retrait) -> mitoyen2.
  //     Chaque entree :
  //       { side: 'g'|'d', lmit1: number, linlet: number, prof: number,
  //         lmit2: number, active: boolean }
  //       - side    : cote lateral ('g' = gauche, 'd' = droite)
  //       - lmit1   : longueur segment mitoyen avant l'encoche (m)
  //       - linlet  : longueur de l'encoche le long de l'arete (m)
  //       - prof    : profondeur de l'encoche perpendiculairement a l'arete (m)
  //       - lmit2   : longueur segment mitoyen apres l'encoche (m)
  //       - active  : flag activation (false = ignore)
  //     Backwards compatible : si absent ou vide, comportement = mitoyen binaire actuel.
  //     Lu par AutoPlanEngine -> TerrainP07Adapter.applyInletNotches.
  //
  _defaultData() {
    return {
      schemaVersion: SCHEMA_VERSION,
      sessionId:     this._sessionId,
      createdAt:     new Date().toISOString(),
      lastUpdated:   new Date().toISOString(),
      demo:          null,
      terrain:       { north_angle_deg: 0 },
      batiment:      { enveloppe: null, rtaa: null, programme: null },
      phases:        {},
      exports:       { pdfUrl: null, dxfUrl: null, glbUrl: null, qrCode: null }
    };
  },

  // ── LOCAL STORAGE ─────────────────────────────────────────────
  _loadLocal() {
    try {
      const raw = localStorage.getItem(DATA_KEY);
      if (!raw) return this._defaultData();
      const data = JSON.parse(raw);
      // Migration si schema change
      if (data.schemaVersion !== SCHEMA_VERSION) {
        console.warn('[Session] Migration schema', data.schemaVersion, '→', SCHEMA_VERSION);
        // Migration 1.0 → 1.1 : ajouter north_angle_deg + batiment
        if (!data.terrain) data.terrain = {};
        if (data.terrain.north_angle_deg === undefined) data.terrain.north_angle_deg = 0;
        if (!data.batiment) data.batiment = { enveloppe: null, rtaa: null, programme: null };
        data.schemaVersion = SCHEMA_VERSION;
        return { ...this._defaultData(), ...data };
      }
      return data;
    } catch {
      return this._defaultData();
    }
  },

  _saveLocal() {
    try {
      this._data.lastUpdated = new Date().toISOString();
      localStorage.setItem(DATA_KEY, JSON.stringify(this._data));
      this._dirty = true;
    } catch (e) {
      console.warn('[Session] localStorage plein:', e.message);
    }
  },

  // ── FIREBASE SYNC ─────────────────────────────────────────────
  async syncFirebase() {
    if (!this._dirty) return;
    if (!window.TERLAB_DB) return; // Firebase non disponible (stub config)

    try {
      // Exclure les snapshots carte (trop lourds pour Firebase)
      const data = JSON.parse(JSON.stringify(this._data));
      if (data.terrain) {
        Object.keys(data.terrain).forEach(k => { if (k.startsWith('snap_')) delete data.terrain[k]; });
      }
      const dbRef = window.TERLAB_FB_REF(window.TERLAB_DB, `sessions/${this._sessionId}`);
      await window.TERLAB_FB_SET(dbRef, data);
      this._dirty = false;
      console.info('[Session] Synced Firebase');
    } catch (e) {
      console.warn('[Session] Firebase sync failed (offline ?):', e.message);
    }
  },

  _startSyncLoop() {
    this._syncTimer = setInterval(() => this.syncFirebase(), SYNC_INTERVAL);
  },

  // ── DOT-NOTATION ACCESS (inspiré GIEPProjectData) ──────────────
  // Permet d'accéder/muter n'importe quel champ via un chemin :
  //   SessionManager.getField('terrain.altitude_ngr')
  //   SessionManager.setField('phases.7.data.gabarit_l_m', 12)

  getField(path) {
    if (!path || !this._data) return undefined;
    return path.split('.').reduce((obj, key) => obj?.[key], this._data);
  },

  setField(path, value) {
    if (!path || !this._data) return;
    const keys = path.split('.');
    let obj = this._data;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (obj[k] == null || typeof obj[k] !== 'object') obj[k] = {};
      obj = obj[k];
    }
    obj[keys[keys.length - 1]] = value;
    this._saveLocal();
    this._notifyChange('field', { path, value });
  },

  // ── TERRAIN ───────────────────────────────────────────────────
  getTerrain() { return this._data?.terrain ?? {}; },

  saveTerrain(fields) {
    if (!this._data) this._data = this._defaultData();
    if (!this._data.terrain) this._data.terrain = {};
    this._data.terrain = { ...this._data.terrain, ...fields };
    this._saveLocal();
    this._notifyChange('terrain', fields);
  },

  // ── PHASES ────────────────────────────────────────────────────
  getPhase(id) {
    return this._data?.phases?.[id] ?? null;
  },

  savePhase(id, data, validations, completed = false) {
    if (!this._data) this._data = {};
    if (!this._data.phases) this._data.phases = {};
    // Merge data si phase existante (évite d'écraser les champs précédents)
    const existing = this._data.phases[id];
    const prevValidations = existing?.validations;
    this._data.phases[id] = {
      completed,
      validations: validations ?? existing?.validations ?? [],
      data: existing?.data ? { ...existing.data, ...data } : data,
      savedAt: new Date().toISOString()
    };
    this._saveLocal();
    this._notifyChange('phase', { id, data, completed });
    // Event validation séparé si les validations ont changé
    if (validations && JSON.stringify(validations) !== JSON.stringify(prevValidations)) {
      this._notifyChange('validation', { id, validations, completed });
    }
  },

  getPhaseProgress() {
    const progress = {};
    for (const [id, phase] of Object.entries(this._data.phases ?? {})) {
      progress[id] = phase.completed;
    }
    return progress;
  },

  getCompletionPct() {
    const total    = 14; // phases 0-13
    const done     = Object.values(this._data.phases ?? {}).filter(p => p.completed).length;
    return Math.round(done / total * 100);
  },

  // ── DEMO ──────────────────────────────────────────────────────
  loadDemo(demoData) {
    const terrain = { ...(demoData.terrain ?? {}) };

    // Convertir geometrie_approx → parcelle_geojson pour affichage carte
    if (terrain.geometrie_approx && !terrain.parcelle_geojson) {
      terrain.parcelle_geojson = {
        type: 'Polygon',
        coordinates: [terrain.geometrie_approx]
      };
    }

    this._data = {
      ...this._defaultData(),
      demo:    demoData.id,
      terrain,
      phases:  this._buildPhasesFromDemo(demoData)
    };
    this._saveLocal();
  },

  _buildPhasesFromDemo(demoData) {
    const phases = {};
    const progress = demoData.phase_progress_demo ?? [];

    // Index des clés suffixées dans demos.json (p07_esquisse, p01_topographie, …)
    const demoKeys = Object.keys(demoData);

    for (const id of progress) {
      const prefix = `p${String(id).padStart(2, '0')}`;
      // Chercher clé exacte (p07) ou suffixée (p07_esquisse)
      const matchedKey = demoKeys.find(k => k === prefix || k.startsWith(prefix + '_'));
      const data = matchedKey ? demoData[matchedKey] : {};
      phases[id] = {
        completed:   true,
        validations: Array(5).fill(true),
        data,
        savedAt: new Date().toISOString()
      };
    }
    return phases;
  },

  // ── EXPORTS ───────────────────────────────────────────────────
  saveExport(type, url) {
    if (!this._data.exports) this._data.exports = {};
    this._data.exports[`${type}Url`] = url;
    this._data.exports[`${type}GeneratedAt`] = new Date().toISOString();
    this._saveLocal();
  },

  // ── QR CODE ───────────────────────────────────────────────────
  getQRUrl() {
    return `https://bimshow.io/terlab/#session/${this._sessionId}`;
  },

  // ── BATIMENT / RTAA ────────────────────────────────────────────
  getBatiment() { return this._data?.batiment ?? {}; },

  getRTAAReport() { return this._data?.batiment?.rtaa ?? null; },

  saveRTAAReport(report) {
    if (!this._data.batiment) this._data.batiment = {};
    this._data.batiment.rtaa = report;
    this._saveLocal();
    this._notifyChange('rtaa');
  },

  saveEnvelope(enveloppe) {
    if (!this._data.batiment) this._data.batiment = {};
    this._data.batiment.enveloppe = enveloppe;
    this._saveLocal();
    this._notifyChange('enveloppe');
  },

  // ── RESET ─────────────────────────────────────────────────────
  reset(keepTerrain = false) {
    const terrain = keepTerrain ? this._data.terrain : {};
    this._data = { ...this._defaultData(), terrain };
    this._saveLocal();
    console.info('[Session] Reset');
    this._notifyChange('reset');
  },

  // ── EXPORT JSON COMPLET ───────────────────────────────────────
  exportJSON() {
    return JSON.stringify(this._data, null, 2);
  },

  // ── NOTIFICATIONS INTERNES ────────────────────────────────────
  // Émet le catch-all terlab:session-changed + un event granulaire typé.
  // Les phases écoutent le granulaire, TerlabStorage écoute le catch-all.
  _notifyChange(type, payload) {
    // Catch-all (rétrocompatible)
    window.dispatchEvent(new CustomEvent('terlab:session-changed', {
      detail: { type, payload }
    }));
    // Events granulaires
    const eventMap = {
      terrain:    'terlab:terrain-updated',
      phase:      'terlab:phase-updated',
      validation: 'terlab:validation-changed',
      enveloppe:  'terlab:enveloppe-updated',
      rtaa:       'terlab:rtaa-updated',
      field:      'terlab:field-updated',
      reset:      'terlab:session-reset',
      loaded:     'terlab:session-loaded',
    };
    const eventName = eventMap[type];
    if (eventName) {
      window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
    }
  },

  // ── LOAD FROM OBJECT (TerlabStorage multi-sessions) ────────────
  _loadFromObject(obj) {
    if (!obj) return;
    this._sessionId = obj.id ?? obj.sessionId ?? this._getOrCreateUUID();
    this._data = {
      ...this._defaultData(),
      ...obj,
      sessionId: this._sessionId
    };
    localStorage.setItem(UUID_KEY, this._sessionId);
    this._saveLocal();
    this._notifyChange('loaded');
    console.info(`[Session] Loaded from object: ${this._sessionId}`);
  },

  // ── RESTORE DEPUIS QR ─────────────────────────────────────────
  async restoreFromFirebase(sessionId) {
    if (!window.TERLAB_DB) return null;
    try {
      const dbRef = window.TERLAB_FB_REF(window.TERLAB_DB, `sessions/${sessionId}`);
      const snap  = await window.TERLAB_FB_GET(dbRef);
      if (!snap.exists()) return null;
      const data = snap.val();
      this._data = data;
      this._sessionId = sessionId;
      localStorage.setItem(UUID_KEY, sessionId);
      this._saveLocal();
      return data;
    } catch (e) {
      console.warn('[Session] Restore Firebase failed:', e.message);
      return null;
    }
  }
};

export default SessionManager;
