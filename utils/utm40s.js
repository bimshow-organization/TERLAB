// TERLAB · utils/utm40s.js
// Conversion WGS84 ↔ UTM zone 40 Sud (EPSG:2975) — La Réunion
// Porté depuis GIEP terrain-extractor.js LaReunionCoordinateConverter
// Implémentation pure JS (pas de dépendance proj4)
// ENSA La Réunion · MGA Architecture
// ════════════════════════════════════════════════════════════════════

// UTM Zone 40 South constants
const K0     = 0.9996;           // Scale factor at central meridian
const CM     = 57;               // Central meridian (zone 40 = 57°E)
const FE     = 500000;           // False easting (m)
const FN     = 10000000;         // False northing for southern hemisphere
const A      = 6378137;          // WGS84 semi-major axis (m)
const F      = 1 / 298.257223563;// WGS84 flattening
const E2     = 2 * F - F * F;    // First eccentricity squared
const E4     = E2 * E2;
const E6     = E4 * E2;
const EP2    = E2 / (1 - E2);   // Second eccentricity squared
const M0_RAD = 0;               // Reference latitude (equator)

const UTM40S = {

  /**
   * WGS84 (lng, lat) → UTM40S (easting, northing) in meters.
   * @param {number} lng - Longitude in degrees
   * @param {number} lat - Latitude in degrees
   * @returns {{ x: number, y: number }}
   */
  toUTM(lng, lat) {
    const latR = lat * Math.PI / 180;
    const lngR = lng * Math.PI / 180;
    const cmR  = CM * Math.PI / 180;

    const N = A / Math.sqrt(1 - E2 * Math.sin(latR) ** 2);
    const T = Math.tan(latR) ** 2;
    const C = EP2 * Math.cos(latR) ** 2;
    const Ap = (lngR - cmR) * Math.cos(latR);

    const M = A * (
      (1 - E2 / 4 - 3 * E4 / 64 - 5 * E6 / 256) * latR
      - (3 * E2 / 8 + 3 * E4 / 32 + 45 * E6 / 1024) * Math.sin(2 * latR)
      + (15 * E4 / 256 + 45 * E6 / 1024) * Math.sin(4 * latR)
      - (35 * E6 / 3072) * Math.sin(6 * latR)
    );

    const x = FE + K0 * N * (
      Ap + (1 - T + C) * Ap ** 3 / 6
      + (5 - 18 * T + T ** 2 + 72 * C - 58 * EP2) * Ap ** 5 / 120
    );

    const y = FN + K0 * (M + N * Math.tan(latR) * (
      Ap ** 2 / 2
      + (5 - T + 9 * C + 4 * C ** 2) * Ap ** 4 / 24
      + (61 - 58 * T + T ** 2 + 600 * C - 330 * EP2) * Ap ** 6 / 720
    ));

    return { x, y };
  },

  /**
   * UTM40S (easting, northing) → WGS84 (lng, lat).
   * @param {number} x - Easting in meters
   * @param {number} y - Northing in meters
   * @returns {{ lng: number, lat: number }}
   */
  toWGS84(x, y) {
    const xAdj = x - FE;
    const yAdj = y - FN;

    const M = yAdj / K0;
    const mu = M / (A * (1 - E2 / 4 - 3 * E4 / 64 - 5 * E6 / 256));

    const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
    const phi1 = mu
      + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
      + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
      + (151 * e1 ** 3 / 96) * Math.sin(6 * mu);

    const N1 = A / Math.sqrt(1 - E2 * Math.sin(phi1) ** 2);
    const T1 = Math.tan(phi1) ** 2;
    const C1 = EP2 * Math.cos(phi1) ** 2;
    const R1 = A * (1 - E2) / (1 - E2 * Math.sin(phi1) ** 2) ** 1.5;
    const D  = xAdj / (N1 * K0);

    const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (
      D ** 2 / 2
      - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * EP2) * D ** 4 / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * EP2 - 3 * C1 ** 2) * D ** 6 / 720
    );

    const lng = (CM * Math.PI / 180) + (
      D - (1 + 2 * T1 + C1) * D ** 3 / 6
      + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * EP2 + 24 * T1 ** 2) * D ** 5 / 120
    ) / Math.cos(phi1);

    return {
      lng: lng * 180 / Math.PI,
      lat: lat * 180 / Math.PI,
    };
  },

  /**
   * Convertit un anneau de coordonnées WGS84 en UTM40S.
   * @param {Array<[number, number]>} ring - [[lng, lat], ...]
   * @returns {Array<{x: number, y: number, lng: number, lat: number}>}
   */
  ringToUTM(ring) {
    return ring.map(([lng, lat]) => {
      const { x, y } = this.toUTM(lng, lat);
      return { x, y, lng, lat };
    });
  },

  /**
   * Distance en mètres entre deux points WGS84 via UTM40S.
   * Plus précis que l'approximation cos(lat) pour La Réunion.
   * @param {number} lng1
   * @param {number} lat1
   * @param {number} lng2
   * @param {number} lat2
   * @returns {number} distance en mètres
   */
  distance(lng1, lat1, lng2, lat2) {
    const a = this.toUTM(lng1, lat1);
    const b = this.toUTM(lng2, lat2);
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  },

  /**
   * Surface d'un polygone WGS84 via UTM40S (Shoelace en mètres).
   * @param {Array<[number, number]>} ring - [[lng, lat], ...] fermé
   * @returns {number} surface en m² (absolue)
   */
  area(ring) {
    const utm = this.ringToUTM(ring);
    let sum = 0;
    for (let i = 0; i < utm.length - 1; i++) {
      sum += utm[i].x * utm[i + 1].y - utm[i + 1].x * utm[i].y;
    }
    return Math.abs(sum / 2);
  },

  /**
   * Bbox UTM40S depuis un anneau WGS84.
   * @param {Array<[number, number]>} ring
   * @param {number} margin - marge en mètres
   * @returns {{ minX, maxX, minY, maxY, width, height }}
   */
  bboxUTM(ring, margin = 0) {
    const pts = this.ringToUTM(ring);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return {
      minX: minX - margin, maxX: maxX + margin,
      minY: minY - margin, maxY: maxY + margin,
      width:  maxX - minX + 2 * margin,
      height: maxY - minY + 2 * margin,
    };
  },
};

export default UTM40S;
