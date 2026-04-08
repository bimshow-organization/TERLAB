// TERLAB · services/ppr-service.js
// Couches PPR et PLU via WMS GeoServer AGORAH/PEIGEO (peigeo.re)
// Pas de clé API requise — service public
// ════════════════════════════════════════════════════════════════════

import { resilientJSON } from '../utils/resilient-fetch.js';

const PPRService = {

  WMS_URL: 'http://peigeo.re:8080/geoserver/peigeo/wms',

  // ─── GetFeatureInfo — zone PPR à un point lat/lng ─────────────
  async queryPoint(lat, lng) {
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
  getPPRSourceConfig() {
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
