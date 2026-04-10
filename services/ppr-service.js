// TERLAB · services/ppr-service.js
// Couches PPR et PLU via WMS GeoServer AGORAH/PEIGEO (peigeo.re)
// Pas de clé API requise — service public
// ════════════════════════════════════════════════════════════════════
// PEIGEO GeoServer n'expose que HTTP (port 8080, pas de TLS). En contexte
// HTTPS (prod bimshow.io), Mixed Content Policy bloque toutes les requêtes.
// Le service se désactive donc automatiquement et retourne des fallbacks
// vides — les consommateurs (map-viewer, ppr-sampling-service) gèrent
// déjà ce cas via bannière "PEIGEO indisponible".
// ════════════════════════════════════════════════════════════════════

import { resilientJSON } from '../utils/resilient-fetch.js';

const _isHttpsContext = (typeof window !== 'undefined')
  && window.location?.protocol === 'https:';

const PPRService = {

  WMS_URL: _isHttpsContext ? null : 'http://peigeo.re:8080/geoserver/peigeo/wms',
  disabled: _isHttpsContext,
  disabledReason: _isHttpsContext ? 'PEIGEO HTTP bloqué en contexte HTTPS (Mixed Content)' : null,

  // ─── GetFeatureInfo — zone PPR à un point lat/lng ─────────────
  async queryPoint(lat, lng) {
    if (this.disabled) {
      return { source: 'disabled', features: [], count: 0, error: this.disabledReason };
    }

    // Conversion EPSG:4326 → EPSG:3857
    const x = lng * 20037508.34 / 180;
    const latRad = lat * Math.PI / 180;
    const y = Math.log(Math.tan(Math.PI / 4 + latRad / 2)) / Math.PI * 20037508.34;

    const delta = 500; // buffer ~500m
    const bbox  = `${x - delta},${y - delta},${x + delta},${y + delta}`;

    const url = `${this.WMS_URL}?`
      + `SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo`
      + `&LAYERS=ppr_approuve&QUERY_LAYERS=ppr_approuve`
      + `&INFO_FORMAT=application/json`
      + `&WIDTH=256&HEIGHT=256&X=128&Y=128`
      + `&SRS=EPSG:3857&BBOX=${bbox}`;

    try {
      const data = await resilientJSON(url, { timeoutMs: 8000, retries: 2 });
      return {
        source: 'peigeo_wms',
        features: data.features ?? [],
        count: data.features?.length ?? 0
      };
    } catch (e) {
      console.warn('[PPR] PEIGEO WMS failed:', e.message);
      return { source: 'fallback', features: [], count: 0, error: e.message };
    }
  },

  // ─── Config source tuiles WMS pour Mapbox — PPR approuvés ─────
  // Retourne null si PEIGEO désactivé : map-viewer skip alors la couche.
  getPPRSourceConfig() {
    if (this.disabled) return null;
    return {
      type: 'raster',
      tiles: [
        `${this.WMS_URL}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap`
        + `&LAYERS=ppr_approuve&FORMAT=image/png&TRANSPARENT=true`
        + `&SRS=EPSG:3857&WIDTH=256&HEIGHT=256`
        + `&BBOX={bbox-epsg-3857}`
      ],
      tileSize: 256,
      attribution: '© AGORAH PEIGEO — PPR La Réunion'
    };
  },

  // ─── Config source tuiles WMS pour Mapbox — PLU simplifié ─────
  getPLUSourceConfig() {
    if (this.disabled) return null;
    return {
      type: 'raster',
      tiles: [
        `${this.WMS_URL}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap`
        + `&LAYERS=pos_plu_simp&FORMAT=image/png&TRANSPARENT=true`
        + `&SRS=EPSG:3857&WIDTH=256&HEIGHT=256`
        + `&BBOX={bbox-epsg-3857}`
      ],
      tileSize: 256,
      attribution: '© AGORAH PEIGEO — PLU La Réunion'
    };
  },

  // ─── Config source tuiles WMS pour Mapbox — Communes ──────────
  getCommunesSourceConfig() {
    if (this.disabled) return null;
    return {
      type: 'raster',
      tiles: [
        `${this.WMS_URL}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap`
        + `&LAYERS=communes&FORMAT=image/png&TRANSPARENT=true`
        + `&SRS=EPSG:3857&WIDTH=256&HEIGHT=256`
        + `&BBOX={bbox-epsg-3857}`
      ],
      tileSize: 256,
      attribution: '© AGORAH PEIGEO'
    };
  }
};

export default PPRService;
