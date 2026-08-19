// TERLAB · session-manager.js · Persistence session · ENSA La Réunion v1.0
// UUID anonyme + localStorage offline-first + Firebase RTDB sync

const SCHEMA_VERSION = '1.1';
const UUID_KEY       = 'terlab_session_uuid';
const DATA_KEY       = 'terlab_session_data';
const SYNC_INTERVAL  = 60_000; // 60s

const SessionManager = {

  _data:             null,
  _sessionId:        null,
  _syncTimer:        null,
  _dirty:            false,
  _lastThumbAt:      0,
  _lastCloudUpdated: null,   // lastUpdated de la derniere version cloud vue (garde anti-ecrasement)
  _quotaWarnedAt:    0,      // throttle de l'alerte quota localStorage
  _conflictWarnedAt: 0,      // throttle de l'alerte conflit multi-appareils

  // ── INIT ──────────────────────────────────────────────────────
  init() {
    this._sessionId = this._getOrCreateUUID();
    this._data      = this._loadLocal();

    // Sync Firebase en arrière-plan
    this._startSyncLoop();

    // Multi-onglets : avertir si un autre onglet du même navigateur écrit
    // la même session (l'event storage ne se déclenche que dans les AUTRES onglets)
    window.addEventListener('storage', (e) => {
      if (e.key !== DATA_KEY || !e.newValue) return;
      try {
        const other = JSON.parse(e.newValue);
        if (other.sessionId !== this._sessionId) return;
        if (other.lastUpdated === this._data?.lastUpdated) return;
        this._warnConflict(
          'Cette session est modifiee dans un autre onglet. '
          + 'Evitez de travailler dans deux onglets a la fois — rechargez celui-ci pour recuperer les changements.');
      } catch { /* payload illisible : ignorer */ }
    });

    console.info(`[Session] ID: ${this._sessionId}`);
    return this._sessionId;
  },

  // Avertissement conflit (throttle 2 min, partagé onglets/appareils)
  _warnConflict(message) {
    if (Date.now() - this._conflictWarnedAt < 120_000) return;
    this._conflictWarnedAt = Date.now();
    if (window.TerlabNotification?.notify) {
      window.TerlabNotification.notify({ severity: 'AVERTISSEMENT', rule: message, phase: 'session' });
    } else {
      window.TerlabToast?.show(message, 'warning', 8000);
    }
    console.warn('[Session] Conflit:', message);
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
    // Jamais de session orpheline : un sessionId null bloquait l'auto-save
    // TerlabStorage (garde !current?.sessionId) sans aucun message.
    if (!this._sessionId) this._sessionId = this._getOrCreateUUID();
    return {
      schemaVersion: SCHEMA_VERSION,
      sessionId:     this._sessionId,
      name:          null,
      createdAt:     new Date().toISOString(),
      lastUpdated:   new Date().toISOString(),
      demo:          null,
      terrain:       { north_angle_deg: 0 },
      batiment:      { enveloppe: null, rtaa: null, programme: null },
      phases:        {},
      exports:       { pdfUrl: null, dxfUrl: null, glbUrl: null, qrCode: null, thumbnailUrl: null }
    };
  },

  // Titre effectif : name custom si defini, sinon commune + parcelle, sinon id court
  getDisplayName() {
    if (this._data?.name) return this._data.name;
    const t = this._data?.terrain ?? {};
    const ref = [t.section, t.parcelle].filter(Boolean).join('');
    if (t.commune && ref) return `${t.commune} ${ref}`;
    if (ref) return ref;
    if (t.commune) return t.commune;
    return `Projet ${(this._sessionId || '').slice(-6)}`;
  },

  setName(name) {
    if (!this._data) this._data = this._defaultData();
    this._data.name = (name && String(name).trim()) || null;
    this._saveLocal();
    this._notifyChange('name', { name: this._data.name });
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

  // preserveTimestamp : garder le lastUpdated d'origine (chargement d'une
  // session existante — l'estampiller a `now` neutraliserait la garde
  // anti-ecrasement de syncFirebase).
  _saveLocal(preserveTimestamp = false) {
    if (!preserveTimestamp) this._data.lastUpdated = new Date().toISOString();
    // _dirty AVANT setItem : si le quota localStorage saute, la sync cloud
    // doit quand meme partir au prochain tick (sinon perte totale silencieuse)
    this._dirty = true;
    try {
      // Les snapshots carte (snap_*, JPEG base64 ~60-100 Ko chacun) restent
      // en memoire dans _data (exports PDF) mais ne sont PAS persistes en
      // localStorage : ils saturaient le quota de 5 Mo. Regeneres au idle carte.
      const slim = { ...this._data };
      if (slim.terrain) {
        slim.terrain = { ...slim.terrain };
        Object.keys(slim.terrain).forEach(k => {
          if (k.startsWith('snap_')) delete slim.terrain[k];
        });
      }
      localStorage.setItem(DATA_KEY, JSON.stringify(slim));
    } catch (e) {
      console.warn('[Session] localStorage plein:', e.message);
      // Alerte visible (throttle 2 min) : l'etudiant doit savoir que la
      // sauvegarde locale ne passe plus et exporter son .terlab
      if (Date.now() - this._quotaWarnedAt > 120_000) {
        this._quotaWarnedAt = Date.now();
        if (window.TerlabNotification?.notify) {
          window.TerlabNotification.notify({
            severity: 'CRITIQUE',
            rule: 'Stockage local sature — la sauvegarde hors-ligne ne fonctionne plus. '
                + 'Exportez votre session (.terlab) par securite. La sync cloud reste active.',
            phase: 'session',
          });
        } else {
          window.TerlabToast?.show(
            'Stockage local sature — exportez votre session (.terlab)', 'error', 8000);
        }
      }
    }
  },

  // ── FIREBASE SYNC ─────────────────────────────────────────────
  // Route selon l'etat d'auth :
  //   - user BIMSHOW connecte (non anonyme) → /terlab/projects/{sid}
  //     + index /users/{uid}/terlabProjects/{sid} = {name, updatedAt, thumbnailUrl, completion}
  //   - sinon (anonyme ou non connecte)     → /sessions/{sid} (compat QR restore)
  async syncFirebase() {
    if (!this._dirty) return;
    if (!window.TERLAB_DB) return;

    try {
      const data = JSON.parse(JSON.stringify(this._data));
      if (data.terrain) {
        Object.keys(data.terrain).forEach(k => { if (k.startsWith('snap_')) delete data.terrain[k]; });
      }

      const uid   = window.TERLAB_UID;
      const auth  = window.TERLAB_AUTH;
      const user  = auth?.currentUser;
      const isBimshowUser = !!(uid && user && !user.isAnonymous);

      if (isBimshowUser) {
        data.ownerUid = uid;

        // Garde anti-écrasement : le SET est un remplacement complet. Si un
        // AUTRE appareil (téléphone/desktop) a poussé une version plus récente
        // que notre état local, on n'écrase pas — on avertit. Une édition
        // locale ultérieure rendra notre lastUpdated plus récent → le push
        // repartira (last-write-wins par timestamp de contenu, pas par horloge
        // de SET). L'onglet idle qui n'édite rien ne clobber donc plus jamais.
        try {
          const luRef  = window.TERLAB_FB_REF(window.TERLAB_DB, `terlab/projects/${this._sessionId}/lastUpdated`);
          const luSnap = await window.TERLAB_FB_GET(luRef);
          const remoteLu = luSnap.exists() ? luSnap.val() : null;
          if (remoteLu && remoteLu !== this._lastCloudUpdated
              && new Date(remoteLu) > new Date(data.lastUpdated)) {
            this._warnConflict(
              'Ce projet a ete modifie sur un autre appareil apres votre derniere synchronisation. '
              + 'Rechargez le projet pour recuperer ces changements (vos modifications locales non envoyees seraient perdues), '
              + 'ou continuez a editer ici pour que cette version reprenne la main.');
            return; // _dirty reste true : nouvelle tentative au prochain tick
          }
        } catch { /* lecture lastUpdated impossible (offline ?) : SET normal */ }

        const projRef = window.TERLAB_FB_REF(window.TERLAB_DB, `terlab/projects/${this._sessionId}`);
        await window.TERLAB_FB_SET(projRef, data);
        this._lastCloudUpdated = data.lastUpdated;

        const idxRef = window.TERLAB_FB_REF(
          window.TERLAB_DB,
          `users/${uid}/terlabProjects/${this._sessionId}`
        );
        await window.TERLAB_FB_SET(idxRef, {
          id:           this._sessionId,
          name:         this.getDisplayName(),
          updatedAt:    data.lastUpdated,
          createdAt:    data.createdAt,
          completion:   this.getCompletionPct(),
          thumbnailUrl: data.exports?.thumbnailUrl ?? null,
          demo:         data.demo ?? null
        });
      } else {
        const dbRef = window.TERLAB_FB_REF(window.TERLAB_DB, `sessions/${this._sessionId}`);
        await window.TERLAB_FB_SET(dbRef, data);
      }

      this._dirty = false;
      console.info('[Session] Synced Firebase', isBimshowUser ? '(user-scoped)' : '(anonymous)');

      // Thumbnail auto (throttle 5 min)
      if (isBimshowUser && window.TerlabUploadService) {
        const THUMB_TTL = 5 * 60_000;
        const hasThumb  = !!data.exports?.thumbnailUrl;
        const stale     = Date.now() - this._lastThumbAt > THUMB_TTL;
        if (!hasThumb || stale) {
          this._lastThumbAt = Date.now();
          window.TerlabUploadService.captureAndUploadThumbnail().catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[Session] Firebase sync failed (offline ?):', e.message);
    }
  },

  // Appele par le bootstrap auth (index.html) quand l'utilisateur se connecte.
  // Force une sync cloud pour migrer la session anonyme en projet rattache au user.
  async onUserLogin(uid) {
    if (!uid || !this._data) return;
    this._dirty = true;
    await this.syncFirebase();
    this._notifyChange('migrated', { uid, sessionId: this._sessionId });
    console.info('[Session] Migree vers user', uid.slice(-8));
  },

  _startSyncLoop() {
    // Idempotent : un init() rejoué ne doit pas laisser un timer orphelin
    // qui synchroniserait l'ancienne session en parallele de la nouvelle.
    if (this._syncTimer) clearInterval(this._syncTimer);
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

  // completed omis (undefined) = conserver l'etat existant. Un simple
  // enregistrement de champ ne doit JAMAIS devalider une phase deja validee :
  // l'ancien defaut `false` remettait la phase a zero a chaque saisie depuis
  // la trentaine d'appelants qui ne passent pas l'argument (« la progression
  // n'est pas prise en compte » — bêta test). Passer explicitement true/false
  // reste prioritaire (cf. index.js validation bloquante).
  savePhase(id, data, validations, completed) {
    if (!this._data) this._data = this._defaultData();
    if (!this._data.phases) this._data.phases = {};
    // Merge data si phase existante (évite d'écraser les champs précédents)
    const existing = this._data.phases[id];
    const prevValidations = existing?.validations;
    const isCompleted = completed ?? existing?.completed ?? false;
    this._data.phases[id] = {
      completed: isCompleted,
      validations: validations ?? existing?.validations ?? [],
      data: existing?.data ? { ...existing.data, ...data } : data,
      savedAt: new Date().toISOString()
    };
    this._saveLocal();
    this._notifyChange('phase', { id, data, completed: isCompleted });
    // Event validation séparé si les validations ont changé
    if (validations && JSON.stringify(validations) !== JSON.stringify(prevValidations)) {
      this._notifyChange('validation', { id, validations, completed: isCompleted });
    }
  },

  // ── CHAINE DE BLOCAGE P00 -> P03 ──────────────────────────────
  // Verifie qu'une phase cible est atteignable : toutes les phases bloquantes
  // anterieures doivent avoir leurs validations `bloquant:true` cochees.
  // Retourne { allowed, blockedBy, missing[] }.
  canAdvance(targetPhaseId) {
    const meta = window.TERLAB_META || window.PHASES_META;
    const blocking = meta?.phases_bloquantes ?? [0, 1, 2, 3];
    for (const pid of blocking) {
      if (pid >= targetPhaseId) break;
      const phaseMeta = meta?.phases?.find(p => p.id === pid);
      const blockingVals = (phaseMeta?.validations ?? []).filter(v => v.bloquant);
      if (!blockingVals.length) continue;
      const sess = this.getPhase(pid);
      const vals = sess?.validations ?? [];
      const missingIds = blockingVals
        .map((v, idx) => {
          const phaseVals = phaseMeta.validations;
          const absoluteIdx = phaseVals.indexOf(v);
          return vals[absoluteIdx] ? null : v.id;
        })
        .filter(Boolean);
      if (missingIds.length) {
        return { allowed: false, blockedBy: pid, missing: missingIds, title: phaseMeta.title };
      }
    }
    return { allowed: true };
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
    // Migration cumulative : les enregistrements TerlabStorage portent encore
    // schemaVersion 1.0, ne pas faire redescendre la session en arriere.
    // Tester obj (et non _data) : le spread de _defaultData() a deja pose 1.1.
    if (obj.schemaVersion !== SCHEMA_VERSION) {
      if (!this._data.terrain) this._data.terrain = {};
      if (this._data.terrain.north_angle_deg === undefined) this._data.terrain.north_angle_deg = 0;
      if (!this._data.batiment) this._data.batiment = { enveloppe: null, rtaa: null, programme: null };
      this._data.schemaVersion = SCHEMA_VERSION;
    }
    localStorage.setItem(UUID_KEY, this._sessionId);
    // Conserver le lastUpdated d'origine : l'estampiller a `now` neutralisait
    // la garde anti-ecrasement de syncFirebase (une version cloud plus
    // recente aurait ete ecrasee au premier tick).
    const originalLu = obj.lastUpdated ?? null;
    this._saveLocal(Boolean(originalLu));
    if (originalLu) {
      this._lastCloudUpdated = originalLu;
      this._dirty = false; // fraichement charge : rien a re-pousser
    }
    this._notifyChange('loaded');
    console.info(`[Session] Loaded from object: ${this._sessionId}`);
  },

  // ── RESTORE DEPUIS QR / CLOUD ──────────────────────────────────
  // Essaye d'abord /terlab/projects/{id} (user-scoped), fallback /sessions/{id}.
  async restoreFromFirebase(sessionId) {
    if (!window.TERLAB_DB) return null;
    try {
      let dbRef = window.TERLAB_FB_REF(window.TERLAB_DB, `terlab/projects/${sessionId}`);
      let snap  = await window.TERLAB_FB_GET(dbRef);
      if (!snap.exists()) {
        dbRef = window.TERLAB_FB_REF(window.TERLAB_DB, `sessions/${sessionId}`);
        snap  = await window.TERLAB_FB_GET(dbRef);
      }
      if (!snap.exists()) return null;
      const data = snap.val();
      this._data = data;
      this._sessionId = sessionId;
      this._lastCloudUpdated = data.lastUpdated ?? null;
      localStorage.setItem(UUID_KEY, sessionId);
      // preserveTimestamp : reestampiller a `now` neutraliserait la garde
      // anti-ecrasement de syncFirebase (meme raison que _loadFromObject).
      this._saveLocal(Boolean(data.lastUpdated));
      this._dirty = false; // fraichement charge du cloud : rien a re-pousser
      return data;
    } catch (e) {
      console.warn('[Session] Restore Firebase failed:', e.message);
      return null;
    }
  }
};

export default SessionManager;
