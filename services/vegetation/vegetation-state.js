'use strict';
/**
 * TERLAB × BPF — VegetationState service
 * État végétation + sync Firebase RTDB + mirror SessionManager
 * Path RTDB : terlab/sessions/{sessionId}/vegetation
 * Miroir local : SessionManager._data.phases.p06.vegetation
 *
 * Port adapté de terlab-vegetation/services/vegetation-state.service.ts.
 * Utilise window.TERLAB_DB / TERLAB_FB_REF / TERLAB_FB_SET / TERLAB_FB_GET
 * et charge dynamiquement onValue/update/remove depuis le même CDN que index.html.
 */

import VegetationDetection from './vegetation-detection.js';
import VegetationSpecies from './vegetation-species.js';

const STATE_VERSION = 2;
const DEBOUNCE_WRITE_MS = 500;

let _fbOnValue = null;
let _fbUpdate  = null;
let _fbRemove  = null;
async function _loadFirebaseExtras() {
  if (_fbOnValue) return;
  try {
    const mod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
    _fbOnValue = mod.onValue;
    _fbUpdate  = mod.update;
    _fbRemove  = mod.remove;
  } catch (e) {
    console.warn('[VegState] Firebase extras non chargés:', e);
  }
}

const VegetationState = {

  _state: null,
  _sessionId: '',
  _unsubscribe: null,
  _listeners: new Set(),
  _writeTimer: null,

  async init(sessionId) {
    this._sessionId = sessionId || 'demo';
    await _loadFirebaseExtras();
    const saved = await this._loadFromFirebase(this._sessionId);
    if (saved) {
      this._state = saved;
      this._broadcast();
    } else {
      const local = this._loadFromSession();
      if (local) { this._state = local; this._broadcast(); }
    }
    this._subscribeFirebase(this._sessionId);
    return this._state;
  },

  async applyDetectionResult(state) {
    this._state = { ...state, updatedAt: new Date().toISOString() };
    this._persist();
    this._broadcast();
  },

  async setFeatureStatus(featureId, status, justification) {
    if (!this._state) return;
    const feat = this._state.features.find(f => f.id === featureId);
    if (!feat) return;
    feat.status = status;
    if (status === 'existing_cut')  feat.cutJustification = justification;
    if (status === 'new_validated') feat.newJustification = justification;
    this._refreshStats();
    this._persist();
    this._broadcast();
  },

  async setFeatureSpecies(featureId, speciesKey) {
    if (!this._state) return;
    const feat = this._state.features.find(f => f.id === featureId);
    if (!feat) return;
    feat.speciesKey = speciesKey;
    feat.speciesConfidence = 1; // choix utilisateur
    this._refreshStats();
    this._persist();
    this._broadcast();
  },

  async addNewTree(position, speciesKey, canopyRadius) {
    if (!this._state) throw new Error('VegetationState not initialised');
    const sp = VegetationSpecies.get(speciesKey);
    const id = `new_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const [refLng, refLat] = this._state.parcelleCentroid;
    const LNG_M = 111320 * Math.cos(refLat * Math.PI / 180);
    const LAT_M = 111320;

    const feat = {
      id, position,
      positionLocal: {
        x: (position[0] - refLng) * LNG_M,
        y: -(position[1] - refLat) * LAT_M,
      },
      canopyRadiusMeasured: canopyRadius || (sp ? sp.canopyRadius_m : 3),
      heightMeasured: sp ? sp.matureHeight_m : undefined,
      status: 'new_proposed',
      speciesKey,
      speciesCandidates: sp ? [{
        speciesKey: sp.key, commonName: sp.commonName, scientificName: sp.scientificName,
        color2D: sp.color2D, canopyRadius: sp.canopyRadius_m, score: 1,
        distanceFoundation: sp.distanceFoundation_m, isSafe: true,
      }] : [],
      source: 'manual',
      timestamp: new Date().toISOString(),
    };

    this._state.features.push(feat);
    this._refreshStats();
    this._persist();
    this._broadcast();
    return feat;
  },

  async removeNewTree(featureId) {
    if (!this._state) return;
    const idx = this._state.features.findIndex(
      f => f.id === featureId && f.status && f.status.startsWith('new')
    );
    if (idx < 0) return;
    this._state.features.splice(idx, 1);
    this._refreshStats();
    this._persist();
    this._broadcast();
  },

  getState() { return this._state; },
  getFeatures() { return this._state ? this._state.features.slice() : []; },

  subscribe(cb) {
    this._listeners.add(cb);
    if (this._state) cb(this._state);
    return () => this._listeners.delete(cb);
  },

  _broadcast() {
    if (!this._state) return;
    this._listeners.forEach(cb => { try { cb(this._state); } catch {} });
    window.dispatchEvent(new CustomEvent('terlab-veg-state', { detail: this._state }));
  },

  _refreshStats() {
    if (!this._state) return;
    this._state.stats = VegetationDetection.computeStats(
      this._state.features, this._bboxFromState(this._state)
    );
    this._state.updatedAt = new Date().toISOString();
  },

  _persist() {
    // Mirror SessionManager immédiatement (offline-first)
    this._mirrorSession();
    // Debounce Firebase
    if (this._writeTimer) clearTimeout(this._writeTimer);
    this._writeTimer = setTimeout(() => this._saveToFirebase(), DEBOUNCE_WRITE_MS);
  },

  _mirrorSession() {
    const sm = window.SessionManager;
    if (!sm || !sm._data) return;
    sm._data.phases = sm._data.phases || {};
    sm._data.phases.p06 = sm._data.phases.p06 || {};
    sm._data.phases.p06.vegetation = this._state;
    if (typeof sm.markDirty === 'function') sm.markDirty();
    else sm._dirty = true;
  },

  _loadFromSession() {
    const sm = window.SessionManager;
    const v = sm && sm._data && sm._data.phases && sm._data.phases.p06
      && sm._data.phases.p06.vegetation;
    return v || null;
  },

  async _loadFromFirebase(sessionId) {
    const db = window.TERLAB_DB;
    const refFn = window.TERLAB_FB_REF;
    const getFn = window.TERLAB_FB_GET;
    if (!db || !refFn || !getFn) return null;
    try {
      const r = refFn(db, this._rtdbPath(sessionId));
      const snap = await getFn(r);
      const data = snap && typeof snap.val === 'function' ? snap.val() : null;
      return data && data.version === STATE_VERSION ? data : null;
    } catch (e) {
      console.warn('[VegState] load error:', e);
      return null;
    }
  },

  async _saveToFirebase() {
    if (!this._state) return;
    const db = window.TERLAB_DB;
    const refFn = window.TERLAB_FB_REF;
    const setFn = window.TERLAB_FB_SET;
    if (!db || !refFn || !setFn) return;
    try {
      const r = refFn(db, this._rtdbPath(this._sessionId));
      await setFn(r, { ...this._state, version: STATE_VERSION });
    } catch (e) {
      console.warn('[VegState] save error:', e);
    }
  },

  _subscribeFirebase(sessionId) {
    const db = window.TERLAB_DB;
    const refFn = window.TERLAB_FB_REF;
    if (!db || !refFn || !_fbOnValue) return;
    try {
      const r = refFn(db, this._rtdbPath(sessionId));
      this._unsubscribe = _fbOnValue(r, snap => {
        const data = snap && typeof snap.val === 'function' ? snap.val() : null;
        if (!data || data.version !== STATE_VERSION) return;
        if (this._state && data.updatedAt === this._state.updatedAt) return;
        this._state = data;
        this._mirrorSession();
        this._broadcast();
      });
    } catch (e) {
      console.warn('[VegState] subscribe error:', e);
    }
  },

  _rtdbPath(sessionId) {
    const uid = window.TERLAB_UID;
    return uid
      ? `terlab/users/${uid}/terlabProjects/${sessionId}/vegetation`
      : `terlab/sessions/${sessionId}/vegetation`;
  },

  _bboxFromState(state) {
    if (!state.features.length) {
      const [lng, lat] = state.parcelleCentroid;
      const pad = 0.001;
      return [lng - pad, lat - pad, lng + pad, lat + pad];
    }
    const lngs = state.features.map(f => f.position[0]);
    const lats = state.features.map(f => f.position[1]);
    const pad = 0.0005;
    return [Math.min(...lngs) - pad, Math.min(...lats) - pad,
            Math.max(...lngs) + pad, Math.max(...lats) + pad];
  },

  dispose() {
    if (typeof this._unsubscribe === 'function') this._unsubscribe();
    this._unsubscribe = null;
    this._listeners.clear();
    if (this._writeTimer) clearTimeout(this._writeTimer);
  },
};

export default VegetationState;

if (typeof window !== 'undefined') {
  window.VegetationState = VegetationState;
}
