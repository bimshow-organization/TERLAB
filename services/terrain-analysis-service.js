// TERLAB · terrain-analysis-service.js · Analyse automatique du terrain
// Données calibrées Réunion — sources : carte-infos.js GIEP + config.js GIEP
// ENSA La Réunion · MGA Architecture

import {
  ZONES_CLIMATIQUES, RTAA_DOM_2016, INTERCO_MAP,
  deduireZoneClimatique, getZoneRTAA, estimerPenteParAltitude
} from './reunion-constants.js';

const TerrainAnalysis = {

  // ── Zone climatique (extrait config.js GIEP L.276) ───────────────
  deduireZoneClimatique,

  // ── Zone RTAA DOM 2016 ────────────────────────────────────────────
  getZoneRTAA,

  // ── Intercommunalité depuis INSEE ─────────────────────────────────
  getInterco(insee) {
    return INTERCO_MAP[insee] ?? 'Non déterminé';
  },

  // ── Pente depuis géométrie parcelle + API IGN altimétrie ──────────
  // Source : carte-infos.js GIEP calculateSlopeFromGeometry
  async calculateSlopeFromParcelle(parcelleGeoJSON, altitude_ngr) {
    try {
      const bbox = this._getBbox(parcelleGeoJSON);
      if (!bbox) return { slope: estimerPenteParAltitude(altitude_ngr), method: 'altitude_fallback' };

      const corners = [
        { lng: bbox[0], lat: bbox[1] }, // SW
        { lng: bbox[2], lat: bbox[1] }, // SE
        { lng: bbox[2], lat: bbox[3] }, // NE
        { lng: bbox[0], lat: bbox[3] }, // NW
        { lng: (bbox[0] + bbox[2]) / 2, lat: (bbox[1] + bbox[3]) / 2 }, // centre
      ];

      // API IGN altimétrie batch
      const lons = corners.map(c => c.lng).join('|');
      const lats = corners.map(c => c.lat).join('|');

      const res = await fetch('https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json', {
        method: 'POST',
        headers: { 'accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lon: lons, lat: lats,
          resource: 'ign_rge_alti_wld', delimiter: '|',
          indent: 'false', measures: 'false', zonly: 'true'
        })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const elevations = data?.elevations?.map(e => e.z) ?? [];

      if (elevations.length < 4) throw new Error('Pas assez de points');

      // Calculer la pente max entre les coins
      const validElevations = elevations.filter(z => z !== -99999 && z != null);
      if (validElevations.length < 2) throw new Error('Altitudes invalides');

      const minZ = Math.min(...validElevations);
      const maxZ = Math.max(...validElevations);
      const dz = maxZ - minZ;

      // Distance diagonale en mètres (approximation)
      const dLng = (bbox[2] - bbox[0]) * 111000 * Math.cos((bbox[1] + bbox[3]) / 2 * Math.PI / 180);
      const dLat = (bbox[3] - bbox[1]) * 111000;
      const diag = Math.sqrt(dLng * dLng + dLat * dLat);

      const slope = diag > 0 ? (dz / diag) * 100 : 0;

      // Déduire l'exposition depuis les altitudes des coins
      const exposition = this._deduireExposition(elevations, corners);

      return {
        slope: Math.round(slope * 10) / 10,
        method: 'ign_alti',
        altitudes: validElevations,
        exposition,
        denivelé_m: dz,
      };
    } catch (err) {
      console.warn('[TerrainAnalysis] Fallback altitude pour pente:', err.message);
      return { slope: estimerPenteParAltitude(altitude_ngr), method: 'altitude_fallback' };
    }
  },

  // ── Analyse complète automatique ──────────────────────────────────
  async autoAnalyze(parcelleFeature, terrain) {
    const lat  = parseFloat(terrain.lat ?? -21.1);
    const lng  = parseFloat(terrain.lng ?? 55.5);
    const alt  = parseFloat(terrain.altitude_ngr ?? terrain.altitude ?? 0);
    const geom = parcelleFeature?.geometry;

    const zone_climatique = deduireZoneClimatique(alt, lat, lng);
    const zone_rtaa       = getZoneRTAA(alt);
    const pente           = geom
      ? await this.calculateSlopeFromParcelle(geom, alt)
      : { slope: estimerPenteParAltitude(alt), method: 'altitude_fallback' };

    const zoneConfig = ZONES_CLIMATIQUES[zone_climatique];
    const rtaaConfig = RTAA_DOM_2016[`zone${zone_rtaa}`];

    // Altitudes min/max depuis les points IGN interrogés
    const alts = pente.altitudes?.filter(z => z !== -99999 && z != null) ?? [];
    const altMin = alts.length ? Math.round(Math.min(...alts)) : null;
    const altMax = alts.length ? Math.round(Math.max(...alts)) : null;

    return {
      zone_climatique,
      zone_climatique_nom: zoneConfig?.nom ?? zone_climatique,
      zone_rtaa,
      zone_rtaa_label: rtaaConfig?.label ?? `Zone ${zone_rtaa}`,
      pente_moy_pct:   pente.slope,
      pente_method:    pente.method,
      orientation:     pente.exposition ?? terrain.orientation_terrain ?? null,
      orientation_terrain: pente.exposition ?? terrain.orientation_terrain ?? null,
      alt_min_dem:     altMin,
      alt_max_dem:     altMax,
      denivele:        pente.denivelé_m != null ? Math.round(pente.denivelé_m) : null,
      denivele_m:      pente.denivelé_m ?? null,
      pluvio_T10:      zoneConfig?.i10 ?? 220,
      pluvio_T10_deal: zoneConfig?.i10_deal ?? 200,
      pluvio_T20:      zoneConfig?.i20 ?? 260,
      qref:            zoneConfig?.qref ?? 15,
      k_sol:           zoneConfig?.k ?? 10,
      ecs_solaire_min: rtaaConfig?.ecs_solaire_min ?? 50,
      brasseurs_plafond: rtaaConfig?.brasseurs_plafond ?? true,
      isolation_requis:  rtaaConfig?.isolation_requis ?? false,
      gel_possible:      alt > 1500,
      interco:           terrain.code_insee ? this.getInterco(terrain.code_insee) : null,
    };
  },

  // ── Helpers internes ──────────────────────────────────────────────

  _getBbox(geojson) {
    const coords = this._flatCoords(geojson);
    if (!coords.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of coords) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return [minX, minY, maxX, maxY];
  },

  _flatCoords(geojson) {
    if (!geojson) return [];
    const type = geojson.type;
    if (type === 'Feature') return this._flatCoords(geojson.geometry);
    if (type === 'Point') return [geojson.coordinates];
    if (type === 'Polygon') return geojson.coordinates.flat();
    if (type === 'MultiPolygon') return geojson.coordinates.flat(2);
    return [];
  },

  _deduireExposition(elevations, corners) {
    if (elevations.length < 4) return null;
    const [sw, se, ne, nw] = elevations;
    if ([sw, se, ne, nw].some(z => z === -99999 || z == null)) return null;

    const dNS = ((sw + se) / 2) - ((nw + ne) / 2); // positif = monte vers le sud
    const dEO = ((sw + nw) / 2) - ((se + ne) / 2); // positif = monte vers l'ouest

    const angle = Math.atan2(dNS, dEO) * 180 / Math.PI;
    // Convertir en exposition (direction de descente = opposée à la montée)
    const expositions = ['E', 'NE', 'N', 'NO', 'O', 'SO', 'S', 'SE'];
    const idx = Math.round(((angle + 180) % 360) / 45) % 8;
    return expositions[idx];
  },
};

export default TerrainAnalysis;
