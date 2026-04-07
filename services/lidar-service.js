// TERLAB · lidar-service.js · Interface avec Lidar-fetcher (serveur Python local)
// Données LiDAR HD IGN via COPC streaming — précision ±0.15m
// ENSA La Réunion · MGA Architecture

const LIDAR_CFG = {
  SERVER_URL: 'http://localhost:8000',
  TIMEOUT_MS: 30000,
  AVAILABILITY_CACHE_MS: 30000,
  DEFAULT_MARGIN_M: 50,
  DEFAULT_MAX_POINTS: 200000,
  // 1° lat ≈ 111 320 m · 1° lng ≈ 103 900 m à La Réunion (lat ≈ -21°)
  M_PER_DEG_LAT: 111320,
  M_PER_DEG_LNG: 103900,
};

const LidarService = {

  _availableCache: null,
  _availableCacheTs: 0,

  // ── Vérifier si le serveur LiDAR local est accessible ───────────
  async isAvailable() {
    const now = Date.now();
    if (this._availableCache !== null && now - this._availableCacheTs < LIDAR_CFG.AVAILABILITY_CACHE_MS) {
      return this._availableCache;
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(`${LIDAR_CFG.SERVER_URL}/api/files`, { signal: ctrl.signal });
      clearTimeout(timer);
      this._availableCache = res.ok;
    } catch {
      this._availableCache = false;
    }
    this._availableCacheTs = now;
    return this._availableCache;
  },

  // ── Récupérer les points LiDAR pour une bbox parcelle + marge ───
  async getPointsForParcel(parcelleGeojson, marginMeters = LIDAR_CFG.DEFAULT_MARGIN_M, options = {}) {
    const bbox = this._bboxFromGeojson(parcelleGeojson, marginMeters);
    if (!bbox) throw new Error('Impossible de calculer la bbox depuis le GeoJSON');

    const classes = options.classes ?? '2';
    const maxPoints = options.maxPoints ?? LIDAR_CFG.DEFAULT_MAX_POINTS;

    const url = `${LIDAR_CFG.SERVER_URL}/api/points-bbox`
      + `?minLng=${bbox.minLng}&minLat=${bbox.minLat}`
      + `&maxLng=${bbox.maxLng}&maxLat=${bbox.maxLat}`
      + `&maxPoints=${maxPoints}&classes=${classes}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LIDAR_CFG.TIMEOUT_MS);

    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`Serveur LiDAR HTTP ${res.status}`);
    const data = await res.json();

    return {
      points: data.points ?? [],
      bounds: data.bounds ?? bbox,
      count: data.count ?? data.points?.length ?? 0,
      source: data.source ?? 'unknown',
      tile_count: data.tile_count ?? 0,
    };
  },

  // ── Analyse terrain (pente, exposition, altitudes) depuis points sol ──
  analyzeTerrain(points, parcelleGeojson) {
    const groundPts = this._filterPointsInPolygon(points, parcelleGeojson);
    if (groundPts.length < 3) {
      return { error: 'Pas assez de points sol dans la parcelle', count: groundPts.length };
    }

    // Altitudes
    const alts = groundPts.map(p => p[2]);
    const altMin = Math.min(...alts);
    const altMax = Math.max(...alts);
    const denivele = altMax - altMin;

    // Plan de régression par moindres carrés : z = a*x + b*y + c
    // x = lng en mètres, y = lat en mètres (relatif au centroïde)
    const cx = groundPts.reduce((s, p) => s + p[0], 0) / groundPts.length;
    const cy = groundPts.reduce((s, p) => s + p[1], 0) / groundPts.length;

    let sxx = 0, sxy = 0, sxz = 0, syy = 0, syz = 0;
    for (const p of groundPts) {
      const x = (p[0] - cx) * LIDAR_CFG.M_PER_DEG_LNG;
      const y = (p[1] - cy) * LIDAR_CFG.M_PER_DEG_LAT;
      const z = p[2];
      sxx += x * x; sxy += x * y; sxz += x * z;
      syy += y * y; syz += y * z;
    }

    const det = sxx * syy - sxy * sxy;
    let slopeX = 0, slopeY = 0;
    if (Math.abs(det) > 1e-10) {
      slopeX = (syy * sxz - sxy * syz) / det; // dz/dx
      slopeY = (sxx * syz - sxy * sxz) / det; // dz/dy
    }

    const slopePct = Math.sqrt(slopeX * slopeX + slopeY * slopeY) * 100;

    // Exposition : direction de descente maximale (opposée au gradient)
    const angle = Math.atan2(-slopeY, -slopeX) * 180 / Math.PI; // angle en degrés, 0 = Est
    const expositions = ['E', 'NE', 'N', 'NO', 'O', 'SO', 'S', 'SE'];
    const idx = Math.round(((angle + 360) % 360) / 45) % 8;

    return {
      alt_min: Math.round(altMin * 10) / 10,
      alt_max: Math.round(altMax * 10) / 10,
      pente_moy_pct: Math.round(slopePct * 10) / 10,
      denivele_m: Math.round(denivele * 10) / 10,
      exposition: expositions[idx],
      point_count: groundPts.length,
      source: 'lidar_hd',
    };
  },

  // ── Profil altimétrique HD depuis les points LiDAR ────────────────
  getProfileFromPoints(points, startLngLat, endLngLat, corridorWidth = 5) {
    // Vecteur du profil
    const dx = (endLngLat[0] - startLngLat[0]) * LIDAR_CFG.M_PER_DEG_LNG;
    const dy = (endLngLat[1] - startLngLat[1]) * LIDAR_CFG.M_PER_DEG_LAT;
    const totalDist = Math.sqrt(dx * dx + dy * dy);
    if (totalDist < 1) return [];

    // Vecteur unitaire du profil et normal
    const ux = dx / totalDist, uy = dy / totalDist;

    // Projeter chaque point sol sur l'axe du profil
    const projected = [];
    for (const p of points) {
      if (p.length >= 7 && p[6] !== 2) continue; // ne garder que le sol
      const px = (p[0] - startLngLat[0]) * LIDAR_CFG.M_PER_DEG_LNG;
      const py = (p[1] - startLngLat[1]) * LIDAR_CFG.M_PER_DEG_LAT;

      // Distance perpendiculaire au corridor
      const perpDist = Math.abs(-uy * px + ux * py);
      if (perpDist > corridorWidth) continue;

      // Distance le long de l'axe
      const alongDist = ux * px + uy * py;
      if (alongDist < -1 || alongDist > totalDist + 1) continue;

      projected.push({ distance_m: alongDist, altitude_m: p[2] });
    }

    if (projected.length === 0) return [];

    // Trier par distance et moyenner par tranches de 1m
    projected.sort((a, b) => a.distance_m - b.distance_m);

    const step = Math.max(1, Math.round(totalDist / 200));
    const profile = [];
    for (let d = 0; d <= totalDist; d += step) {
      const nearby = projected.filter(p => Math.abs(p.distance_m - d) <= step / 2);
      if (nearby.length === 0) continue;
      const avgAlt = nearby.reduce((s, p) => s + p.altitude_m, 0) / nearby.length;
      profile.push({
        distance_m: Math.round(d),
        altitude_m: Math.round(avgAlt * 100) / 100,
      });
    }

    return profile;
  },

  // ── Helpers internes ────────────────────────────────────────────

  _bboxFromGeojson(geojson, marginMeters) {
    const coords = this._flatCoords(geojson);
    if (!coords.length) return null;

    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;
    for (const [lng, lat] of coords) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }

    const mLat = marginMeters / LIDAR_CFG.M_PER_DEG_LAT;
    const mLng = marginMeters / LIDAR_CFG.M_PER_DEG_LNG;

    return {
      minLng: minLng - mLng,
      maxLng: maxLng + mLng,
      minLat: minLat - mLat,
      maxLat: maxLat + mLat,
    };
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

  // Point-in-polygon (ray casting) pour filtrer les points dans la parcelle
  _filterPointsInPolygon(points, geojson) {
    const ring = this._getOuterRing(geojson);
    if (!ring) return points; // pas de polygone → on garde tout

    return points.filter(p => this._pointInRing(p[0], p[1], ring));
  },

  _getOuterRing(geojson) {
    if (!geojson) return null;
    if (geojson.type === 'Feature') return this._getOuterRing(geojson.geometry);
    if (geojson.type === 'Polygon') return geojson.coordinates[0];
    if (geojson.type === 'MultiPolygon') return geojson.coordinates[0][0];
    return null;
  },

  _pointInRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  },
};

export default LidarService;
