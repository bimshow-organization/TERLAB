// TERLAB · services/gpu-fetcher.js
// Fetch parallèle de toutes les couches GPU (Géoportail de l'Urbanisme)
// via API Carto IGN — gratuite, sans clé API
// Complète plu-service.js avec les endpoints non encore exploités
// ════════════════════════════════════════════════════════════════════

import resilientFetch from '../utils/resilient-fetch.js';

const GPUFetcher = {

  BASE: 'https://apicarto.ign.fr/api/gpu',
  TIMEOUT: 10000,

  // Définition des couches GPU disponibles
  ENDPOINTS: [
    { name: 'Zonage PLU',             path: 'zone-urba',        color: '#3b82f6', fillOpacity: 0.15 },
    { name: 'Prescriptions surf.',    path: 'prescription-surf', color: '#f59e0b', fillOpacity: 0.20 },
    { name: 'Prescriptions lin.',     path: 'prescription-lin',  color: '#ef4444', fillOpacity: 0 },
    { name: 'Prescriptions ponct.',   path: 'prescription-pct',  color: '#ec4899', fillOpacity: 0 },
    { name: 'Informations surf.',     path: 'info-surf',         color: '#8b5cf6', fillOpacity: 0.12 },
    { name: 'Informations lin.',      path: 'info-lin',          color: '#6366f1', fillOpacity: 0 },
    { name: 'Informations ponct.',    path: 'info-pct',          color: '#a855f7', fillOpacity: 0 },
    { name: 'Servitudes (assiettes)', path: 'assiette-sup-s',    color: '#14b8a6', fillOpacity: 0.18 },
  ],

  // ── FETCH ALL ─────────────────────────────────────────────────
  // Retourne un tableau de { name, path, color, fillOpacity, geojson }
  // pour chaque endpoint qui a des features
  async fetchAll(lat, lng) {
    const geom = encodeURIComponent(JSON.stringify({
      type: 'Point', coordinates: [lng, lat]
    }));

    const results = await Promise.allSettled(
      this.ENDPOINTS.map(ep =>
        resilientFetch(`${this.BASE}/${ep.path}?geom=${geom}`, {
          timeoutMs: this.TIMEOUT, retries: 1,
        })
        .then(r => r.json())
        .then(data => ({ ...ep, geojson: data }))
      )
    );

    return results
      .filter(r => r.status === 'fulfilled' && r.value.geojson?.features?.length)
      .map(r => r.value);
  },

  // ── FETCH SINGLE ──────────────────────────────────────────────
  // Fetch un endpoint spécifique par path
  async fetchOne(path, lat, lng) {
    const geom = encodeURIComponent(JSON.stringify({
      type: 'Point', coordinates: [lng, lat]
    }));

    const resp = await resilientFetch(`${this.BASE}/${path}?geom=${geom}`, {
      timeoutMs: this.TIMEOUT, retries: 1,
    });
    return resp.json();
  },

  // ── FETCH BY POLYGON ──────────────────────────────────────────
  // Même chose mais avec une géométrie polygonale (parcelle)
  async fetchAllByPolygon(polygonGeojson) {
    const geom = encodeURIComponent(JSON.stringify(polygonGeojson));

    const results = await Promise.allSettled(
      this.ENDPOINTS.map(ep =>
        resilientFetch(`${this.BASE}/${ep.path}?geom=${geom}`, {
          timeoutMs: this.TIMEOUT, retries: 1,
        })
        .then(r => r.json())
        .then(data => ({ ...ep, geojson: data }))
      )
    );

    return results
      .filter(r => r.status === 'fulfilled' && r.value.geojson?.features?.length)
      .map(r => r.value);
  },

  // ── FEATURE-INFO (GPU direct) ─────────────────────────────────
  // Un seul appel = toutes les couches DU au point
  async featureInfoDU(lat, lng) {
    try {
      const resp = await fetch(
        `https://www.geoportail-urbanisme.gouv.fr/api/feature-info/du?lon=${lng}&lat=${lat}`,
        { signal: AbortSignal.timeout(this.TIMEOUT) }
      );
      if (!resp.ok) return null;
      return resp.json();
    } catch { return null; }
  },
};

export default GPUFetcher;
