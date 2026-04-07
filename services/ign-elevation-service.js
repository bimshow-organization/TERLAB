// TERLAB · ign-elevation-service.js · API IGN altimétrie batch
// Porté depuis terrain-extractor.js GIEP (L.347–466)
// Sans proj4/UTM40S — juste l'API altimétrie WGS84
// ENSA La Réunion · MGA Architecture

const IGN_BATCH = {
  MAX_POINTS: 5000,
  BATCH_SIZE: 50,       // Points par requête (TERLAB = usage léger)
  CONCURRENCY: 2,
  RETRY_MAX: 3,
  RETRY_BASE_DELAY_MS: 500,
};

const API_URL = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';

const IGNElevationService = {

  // ── Récupérer altitudes pour un tableau de points [{ lng, lat }] ──
  async getElevations(points) {
    if (!Array.isArray(points) || points.length === 0) return [];

    const B = IGN_BATCH.BATCH_SIZE;
    const chunks = [];
    for (let i = 0; i < points.length; i += B) {
      chunks.push(points.slice(i, i + B));
    }

    const results = new Array(points.length);

    const runChunk = async (chunk, chunkIndex) => {
      const lons = chunk.map(p => p.lng);
      const lats = chunk.map(p => p.lat);
      const data = await this._requestWithRetry(lons, lats);

      const elevations = data?.elevations?.map(e => e.z) ?? [];

      for (let i = 0; i < chunk.length; i++) {
        const z = elevations[i];
        results[chunkIndex * B + i] = {
          lng: chunk[i].lng,
          lat: chunk[i].lat,
          altitude: (z === -99999 || z == null) ? null : z,
        };
      }
    };

    // Exécution avec concurrence limitée
    let next = 0;
    const spawn = async () => {
      while (next < chunks.length) {
        const idx = next++;
        await runChunk(chunks[idx], idx);
        if (next < chunks.length) {
          await new Promise(r => setTimeout(r, 220)); // throttle ~5 req/s
        }
      }
    };

    const starters = Math.min(IGN_BATCH.CONCURRENCY, chunks.length);
    const promises = [];
    for (let k = 0; k < starters; k++) promises.push(spawn());
    await Promise.all(promises);

    return results;
  },

  // ── Profil altimétrique entre 2 points ────────────────────────────
  async getProfile(startLng, startLat, endLng, endLat, nPoints = 20) {
    const points = Array.from({ length: nPoints }, (_, i) => ({
      lng: startLng + (endLng - startLng) * (i / (nPoints - 1)),
      lat: startLat + (endLat - startLat) * (i / (nPoints - 1)),
    }));

    const elevations = await this.getElevations(points);

    const dLng = (endLng - startLng) * 111000 * Math.cos((startLat + endLat) / 2 * Math.PI / 180);
    const dLat = (endLat - startLat) * 111000;
    const totalDist = Math.sqrt(dLng * dLng + dLat * dLat);

    return elevations.map((e, i) => ({
      distance_m: Math.round(i * totalDist / (nPoints - 1)),
      altitude_m: e.altitude,
      lng: e.lng,
      lat: e.lat,
    }));
  },

  // ── Profil automatique sur la parcelle (N-S par défaut) ───────────
  async getParcelProfile(terrain, nPoints = 15) {
    if (!terrain?.lat || !terrain?.lng) return null;
    const lat = parseFloat(terrain.lat);
    const lng = parseFloat(terrain.lng);
    const d = 0.003; // environ 330m
    return this.getProfile(lng, lat - d, lng, lat + d, nPoints);
  },

  // ── Requête POST IGN batch (source terrain-extractor.js GIEP L.430) ─
  async _requestBatch(lonsArray, latsArray) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lon: lonsArray.join('|'),
        lat: latsArray.join('|'),
        resource: 'ign_rge_alti_wld',
        delimiter: '|',
        indent: 'false',
        measures: 'false',
        zonly: 'false',
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  // ── Retry avec backoff exponentiel (source GIEP L.452–466) ────────
  async _requestWithRetry(lons, lats) {
    let attempt = 0;
    while (true) {
      try {
        return await this._requestBatch(lons, lats);
      } catch (e) {
        attempt++;
        const retriable = /HTTP (429|5\d{2})/.test(String(e));
        if (!retriable || attempt > IGN_BATCH.RETRY_MAX) throw e;
        const delay = IGN_BATCH.RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`[IGN] Retry #${attempt} dans ${delay}ms…`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  },
};

export default IGNElevationService;
