// TERLAB · services/biodiversite-service.js
// ZNIEFF, Parc National, Natura 2000 — La Réunion
// Données statiques pré-téléchargées depuis INPN / data.gouv.fr
// + fallback WFS Carmen si les fichiers statiques sont absents
// ════════════════════════════════════════════════════════════════════

const BiodiversiteService = {

  _znieff1: null,
  _znieff2: null,
  _parcNat: null,
  _loaded:  false,

  async init() {
    if (this._loaded) return;

    const loads = [
      fetch('data/geojson/znieff1-reunion.geojson')
        .then(r => r.ok ? r.json() : null)
        .then(d => { this._znieff1 = d; })
        .catch(() => {}),
      fetch('data/geojson/znieff2-reunion.geojson')
        .then(r => r.ok ? r.json() : null)
        .then(d => { this._znieff2 = d; })
        .catch(() => {}),
      fetch('data/geojson/parc-national-reunion.geojson')
        .then(r => r.ok ? r.json() : null)
        .then(d => { this._parcNat = d; })
        .catch(() => {}),
    ];
    await Promise.allSettled(loads);
    this._loaded = true;

    console.log('[Biodiversite] chargé:', {
      znieff1: this._znieff1?.features?.length ?? 0,
      znieff2: this._znieff2?.features?.length ?? 0,
      parcNat: this._parcNat?.features?.length ?? 0
    });
  },

  // Vérifie si un point est dans une ZNIEFF ou le Parc National
  // @returns {{ inZnieff1, inZnieff2, inParcNat, zones: [] }}
  checkPoint(lat, lng) {
    const result = { inZnieff1: false, inZnieff2: false, inParcNat: false, zones: [] };
    if (!window.turf) return result;

    const point = window.turf.point([lng, lat]);

    const check = (geojson, type) => {
      if (!geojson?.features) return;
      for (const f of geojson.features) {
        try {
          if (window.turf.booleanPointInPolygon(point, f)) {
            if (type === 'znieff1') result.inZnieff1 = true;
            if (type === 'znieff2') result.inZnieff2 = true;
            if (type === 'parc')    result.inParcNat  = true;
            result.zones.push({
              type,
              nom:  f.properties?.nom || f.properties?.NOM_SITE || '—',
              code: f.properties?.id_mnhn || '—'
            });
          }
        } catch {}
      }
    };

    check(this._znieff1, 'znieff1');
    check(this._znieff2, 'znieff2');
    check(this._parcNat, 'parc');
    return result;
  },

  getZnieff1GeoJson() { return this._znieff1; },
  getZnieff2GeoJson() { return this._znieff2; },
  getParcNatGeoJson() { return this._parcNat; }
};

export default BiodiversiteService;

// ════════════════════════════════════════════════════════════════════
