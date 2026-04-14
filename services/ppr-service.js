// TERLAB · services/ppr-service.js
// Acces aux donnees PPR (Plans de Prevention des Risques) Reunion
// ════════════════════════════════════════════════════════════════════
// Pipeline en cascade :
//   1. Georisques HTTPS (PRIMAIRE)  — api georisques.gouv.fr, fonctionne partout
//      Donne : liste des risques presents/absents au point + niveau commune
//      Limite : pas de zonage PPR fin (R1/R2/B1/B2), pas de tuiles WMS
//
//   2. PEIGEO WMS HTTP (FALLBACK en HTTP local uniquement)
//      Donne : zonage detaille + tuiles carto pour overlay Mapbox
//      Limite : bloque par Mixed Content Policy en HTTPS prod
//
// Contract de retour de queryPoint(lat, lng) :
//   { source, features, count, risques?, error? }
// ════════════════════════════════════════════════════════════════════

import { resilientJSON } from '../utils/resilient-fetch.js';

const _isHttpsContext = (typeof window !== 'undefined')
  && window.location?.protocol === 'https:';

const PEIGEO_WMS_URL = 'http://peigeo.re:8080/geoserver/peigeo/wms';

const PPRService = {

  // ── Config PEIGEO (overlay + GetFeatureInfo) ─────────────────────
  // WMS_URL conserve pour les consommateurs qui testent sa presence.
  // En HTTPS, on passe sur Georisques uniquement -> WMS_URL reste null.
  WMS_URL: _isHttpsContext ? null : PEIGEO_WMS_URL,

  // ── Etat du service ──────────────────────────────────────────────
  // `disabled` = plus d'overlay carto possible (pas d'alternative HTTPS
  // avec zonage PPR). Les consommateurs qui affichent un tuilage raster
  // testent ce flag. La methode queryPoint reste, elle, toujours active
  // grace a Georisques.
  disabled: _isHttpsContext,
  disabledReason: _isHttpsContext
    ? 'Overlay WMS PEIGEO indisponible en HTTPS — donnees Georisques utilisees'
    : null,

  // ─── Query point : Georisques PRIMAIRE, PEIGEO FALLBACK ──────────
  async queryPoint(lat, lng) {
    // 1. Georisques HTTPS (toujours tente — marche partout)
    const gr = await this._queryGeorisques(lat, lng);
    if (gr && gr.features.length) {
      return gr;
    }

    // 2. PEIGEO WMS (seulement en HTTP local)
    if (!_isHttpsContext) {
      const pg = await this._queryPeigeo(lat, lng);
      if (pg && pg.features.length) {
        return pg;
      }
    }

    // 3. Rien trouve
    return {
      source: gr?.source ?? 'none',
      features: [],
      count: 0,
      risques: gr?.risques ?? null,
      error: gr?.error ?? 'aucune donnee risque disponible',
    };
  },

  // ─── Georisques HTTPS — PRIMAIRE ─────────────────────────────────
  // API : https://georisques.gouv.fr/doc-api
  // Endpoint : resultats_rapport_risque?latlon=LNG,LAT&rayon=100
  async _queryGeorisques(lat, lng) {
    try {
      const url = `https://georisques.gouv.fr/api/v1/resultats_rapport_risque?latlon=${lng},${lat}&rayon=100`;
      const data = await resilientJSON(url, { timeoutMs: 6000, retries: 1 });
      if (!data?.risquesNaturels) {
        return { source: 'georisques', features: [], count: 0 };
      }

      const risques = data.risquesNaturels;
      // Convertir les risques presents en "features" compatibles avec les consommateurs
      const features = [];
      for (const [key, info] of Object.entries(risques)) {
        if (!info?.present) continue;
        features.push({
          type: 'Feature',
          properties: {
            source: 'georisques',
            risque_type: key,
            libelle: info.libelle,
            statut_commune: info.libelleStatutCommune,
            statut_adresse: info.libelleStatutAdresse,
            // Zonage fin non disponible via Georisques
            zone_reg: null,
            TYPE_ZONE: null,
          },
        });
      }

      return {
        source: 'georisques',
        features,
        count: features.length,
        risques, // objet brut pour usages avances
        rapport_url: data.url,
        adresse: data.adresse,
        commune: data.commune,
      };
    } catch (e) {
      console.warn('[PPR] Georisques API failed:', e.message);
      return { source: 'georisques_error', features: [], count: 0, error: e.message };
    }
  },

  // ─── PEIGEO WMS — FALLBACK (HTTP local uniquement) ───────────────
  async _queryPeigeo(lat, lng) {
    if (_isHttpsContext) return null;

    // Conversion EPSG:4326 → EPSG:3857
    const x = lng * 20037508.34 / 180;
    const latRad = lat * Math.PI / 180;
    const y = Math.log(Math.tan(Math.PI / 4 + latRad / 2)) / Math.PI * 20037508.34;
    const delta = 500;
    const bbox = `${x - delta},${y - delta},${x + delta},${y + delta}`;
    const url = `${PEIGEO_WMS_URL}?`
      + `SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo`
      + `&LAYERS=ppr_approuve&QUERY_LAYERS=ppr_approuve`
      + `&INFO_FORMAT=application/json`
      + `&WIDTH=256&HEIGHT=256&X=128&Y=128`
      + `&SRS=EPSG:3857&BBOX=${bbox}`;

    try {
      const data = await resilientJSON(url, { timeoutMs: 8000, retries: 2 });
      return {
        source: 'peigeo_wms',
        features: (data.features ?? []).map(f => ({
          ...f,
          properties: { ...(f.properties ?? {}), source: 'peigeo' },
        })),
        count: data.features?.length ?? 0,
      };
    } catch (e) {
      console.warn('[PPR] PEIGEO WMS failed:', e.message);
      return null;
    }
  },

  // ─── Overlay tuiles WMS ──────────────────────────────────────────
  // Retourne null en HTTPS (pas d'alternative IGN pour PPR Reunion).
  // En HTTP local, utilise PEIGEO.
  getPPRSourceConfig() {
    if (_isHttpsContext) return null;
    return {
      type: 'raster',
      tiles: [
        `${PEIGEO_WMS_URL}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap`
        + `&LAYERS=ppr_approuve&FORMAT=image/png&TRANSPARENT=true`
        + `&SRS=EPSG:3857&WIDTH=256&HEIGHT=256`
        + `&BBOX={bbox-epsg-3857}`
      ],
      tileSize: 256,
      attribution: '© AGORAH PEIGEO — PPR La Réunion'
    };
  },

  getPLUSourceConfig() {
    if (_isHttpsContext) return null;
    return {
      type: 'raster',
      tiles: [
        `${PEIGEO_WMS_URL}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap`
        + `&LAYERS=pos_plu_simp&FORMAT=image/png&TRANSPARENT=true`
        + `&SRS=EPSG:3857&WIDTH=256&HEIGHT=256`
        + `&BBOX={bbox-epsg-3857}`
      ],
      tileSize: 256,
      attribution: '© AGORAH PEIGEO — PLU La Réunion'
    };
  },

  getCommunesSourceConfig() {
    if (_isHttpsContext) return null;
    return {
      type: 'raster',
      tiles: [
        `${PEIGEO_WMS_URL}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap`
        + `&LAYERS=communes&FORMAT=image/png&TRANSPARENT=true`
        + `&SRS=EPSG:3857&WIDTH=256&HEIGHT=256`
        + `&BBOX={bbox-epsg-3857}`
      ],
      tileSize: 256,
      attribution: '© AGORAH PEIGEO'
    };
  },

  // ─── Helper : resume textuel des risques pour affichage UI ───────
  // Utilisable comme fallback visuel quand l'overlay PPR n'est pas dispo.
  async summarizeRisksAtPoint(lat, lng) {
    const res = await this._queryGeorisques(lat, lng);
    if (!res?.risques) return null;
    const active = Object.entries(res.risques)
      .filter(([, v]) => v?.present)
      .map(([key, v]) => ({
        key,
        libelle: v.libelle,
        niveau: v.libelleStatutCommune ?? v.libelleStatutAdresse ?? 'Risque connu',
      }));
    return {
      count: active.length,
      risques: active,
      rapport_url: res.rapport_url,
      adresse: res.adresse?.libelle,
      commune: res.commune?.libelle,
    };
  },
};

export default PPRService;
