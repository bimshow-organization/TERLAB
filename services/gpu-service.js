// TERLAB · services/gpu-service.js
// Géoportail Urbanisme — zonage PLU vectoriel officiel
// API GPU gratuite, CORS OK
// ════════════════════════════════════════════════════════════════════

const GpuService = {

  API_BASE: 'https://www.geoportail-urbanisme.gouv.fr/api',
  APICARTO: 'https://apicarto.ign.fr/api/gpu',

  // Récupère les documents PLU disponibles pour une commune
  async fetchDocuments(codeInsee) {
    try {
      const res = await fetch(`${this.API_BASE}/document?nom=${codeInsee}`,
        { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn(`[GPU] fetchDocuments ${codeInsee} failed:`, e.message);
      return null;
    }
  },

  // Récupère les zones PLU via APICarto (plus fiable que WFS GPU direct)
  async fetchZonePLU(codeInsee, lat, lng, radius_m = 500) {
    const d = radius_m / 111000;
    const geom = JSON.stringify({
      type: 'Point',
      coordinates: [lng, lat]
    });

    try {
      const res = await fetch(
        `${this.APICARTO}/zone-urba?geom=${encodeURIComponent(geom)}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn('[GPU] fetchZonePLU failed — fallback règlement JSON', e.message);
      return null;
    }
  },

  // Récupère les prescriptions surfaciques (EBC, espaces remarquables…)
  async fetchPrescriptionsSurf(lat, lng) {
    const geom = JSON.stringify({ type: 'Point', coordinates: [lng, lat] });
    try {
      const res = await fetch(
        `${this.APICARTO}/prescription-surf?geom=${encodeURIComponent(geom)}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  },

  // Extraire la zone PLU d'un point depuis le GeoJSON
  findZoneAtPoint(zonesGeojson, lat, lng) {
    if (!zonesGeojson?.features) return null;
    const pt = [lng, lat];
    if (window.turf) {
      const point = window.turf.point(pt);
      for (const f of zonesGeojson.features) {
        try {
          if (window.turf.booleanPointInPolygon(point, f)) {
            return f.properties;
          }
        } catch {}
      }
    }
    return null;
  }
};

export default GpuService;

// ════════════════════════════════════════════════════════════════════
