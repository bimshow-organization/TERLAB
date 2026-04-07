// TERLAB · demo-loader.js · Chargeur scénarios démo · ENSA La Réunion v1.0

import SessionManager from './session-manager.js';

const DemoLoader = {
  _cache: {},

  async load(demoId) {
    try {
      // Cache en mémoire
      if (!this._cache[demoId]) {
        const resp = await fetch('data/demos.json');
        if (!resp.ok) throw new Error('demos.json introuvable');
        const all = await resp.json();
        for (const d of all.demos) this._cache[d.id] = d;
      }

      const demoKey  = `demo-${demoId}`;
      const demoData = this._cache[demoKey];
      if (!demoData) throw new Error(`Démo "${demoId}" introuvable`);

      // Charger dans la session
      SessionManager.loadDemo(demoData);

      console.info(`[Demo] Chargé: ${demoId} — ${demoData.label}`);
      return demoData;
    } catch (e) {
      console.error('[Demo] Erreur:', e.message);
      window.TerlabToast?.show(`Erreur démo : ${e.message}`, 'error');
      return null;
    }
  }
};

export default DemoLoader;
