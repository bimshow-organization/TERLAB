/**
 * wind-data-service.js — TERLAB · ENSA La Réunion
 * Service de données vent :
 *   1. Lookup station la plus proche dans wind-stations-reunion.json (pre-calculé)
 *   2. Fallback Open-Meteo ERA5 (API publique, zéro auth) si station trop lointaine
 *
 * RÈGLES :
 * - Vanilla JS ES2022+, aucune dépendance externe
 * - Utiliser window.turfjs (partagé depuis BIMSHOW) ou import CDN Turf si absent
 * - Pas de token côté client — Open-Meteo est gratuit sans auth
 * - Tout résultat API est mis en cache sessionStorage (clé "wind_cache_[lat]_[lon]")
 */

import { aggregateToWindRose } from './wind-rose.js';

// Chemin JSON résolu relativement au module (robuste quel que soit le baseURI de la page).
// Override possible via window.TERLAB_WIND_STATIONS_URL (tests headless, configs alternatives).
const STATIONS_URL = (typeof window !== 'undefined' && window.TERLAB_WIND_STATIONS_URL)
  || new URL('../data/wind-stations-reunion.json', import.meta.url).href;
const ERA5_BASE     = 'https://archive-api.open-meteo.com/v1/archive';
const MAX_DIST_KM   = 8;      // Distance max pour utiliser une station pré-calculée
const ERA5_YEARS    = 5;      // Années d'historique ERA5
const CACHE_PREFIX  = 'terlab_wind_';

let _stationsCache = null;    // Cache mémoire du JSON stations

// ── Fonctions utilitaires ────────────────────────────────────────────────────

/** Distance Haversine entre deux points lat/lon en km */
function haversine(lat1, lon1, lat2, lon2) {
  const R   = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a   = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Clé de cache sessionStorage */
function cacheKey(lat, lon) {
  return `${CACHE_PREFIX}${lat.toFixed(3)}_${lon.toFixed(3)}`;
}

// ── Chargement du JSON stations ──────────────────────────────────────────────

async function loadStations() {
  if (_stationsCache) return _stationsCache;
  try {
    const res  = await fetch(STATIONS_URL);
    const data = await res.json();
    _stationsCache = data;
    return data;
  } catch (err) {
    console.warn('[wind-data-service] Impossible de charger wind-stations-reunion.json :', err);
    return null;
  }
}

// ── Lookup station la plus proche ─────────────────────────────────────────────

/**
 * Trouve la station la plus proche d'un point (lat, lon).
 * Retourne null si toutes les stations sont à plus de MAX_DIST_KM.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<object|null>}
 */
export async function findNearestStation(lat, lon) {
  const data = await loadStations();
  if (!data?.stations?.length) return null;

  let best     = null;
  let bestDist = Infinity;

  data.stations.forEach(station => {
    const dist = haversine(lat, lon, station.lat, station.lon);
    if (dist < bestDist) { bestDist = dist; best = station; }
  });

  if (bestDist > MAX_DIST_KM) {
    console.info(`[wind-data-service] Station la plus proche (${best?.name}) à ${bestDist.toFixed(1)} km — fallback ERA5`);
    return null;
  }

  console.info(`[wind-data-service] Station trouvée : ${best.name} (${bestDist.toFixed(1)} km)`);
  return best;
}

// ── Fallback Open-Meteo ERA5 ────────────────────────────────────────────────

/**
 * Récupère l'historique vent ERA5 via Open-Meteo et calcule la rose 16 secteurs.
 * API publique, zéro authentification, résolution ~9km.
 * @param {number} lat
 * @param {number} lon
 * @param {number} years  Nombre d'années d'historique (défaut 5)
 * @returns {Promise<{freqs16, calmPct, dominantDir, source, period}>}
 */
export async function fetchWindRoseFromERA5(lat, lon, years = ERA5_YEARS) {
  const endDate   = new Date();
  endDate.setMonth(endDate.getMonth() - 1);          // Dernier mois complet
  const startDate = new Date(endDate);
  startDate.setFullYear(endDate.getFullYear() - years);

  const fmt = d => d.toISOString().slice(0, 10);
  const url = `${ERA5_BASE}?latitude=${lat}&longitude=${lon}`
    + `&start_date=${fmt(startDate)}&end_date=${fmt(endDate)}`
    + `&hourly=wind_speed_10m,wind_direction_10m`
    + `&wind_speed_unit=ms&timezone=Indian%2FReunion`;

  const res  = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ERA5 HTTP ${res.status}`);
  const data = await res.json();

  const { freqs16, calmPct, dominantDir } = aggregateToWindRose(
    data.hourly.wind_direction_10m,
    data.hourly.wind_speed_10m,
    1.0   // calme < 1 m/s
  );

  const meanSpeed = +(data.hourly.wind_speed_10m
    .filter(v => v != null)
    .reduce((a, b) => a + b, 0) / data.hourly.wind_speed_10m.filter(v => v != null).length
  ).toFixed(1);

  return {
    freqs16,
    calmPct,
    dominantDir,
    meanSpeed,
    source: 'ERA5-Open-Meteo',
    period: `${fmt(startDate)} / ${fmt(endDate)}`,
    stationName: `ERA5 (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`,
  };
}

// ── Point d'entrée principal ────────────────────────────────────────────────

/**
 * Retourne les données vent pour un point géographique.
 * Stratégie : station pré-calculée (si < MAX_DIST_KM) → ERA5 fallback.
 * Résultat mis en cache sessionStorage.
 *
 * @param {number} lat  Latitude (négatif = sud)
 * @param {number} lon  Longitude
 * @returns {Promise<WindRoseData>}
 *
 * @typedef {object} WindRoseData
 * @property {number[]} freqs16      16 fréquences % (N→NNO clockwise)
 * @property {number}   calmPct      % de calmes
 * @property {string}   dominantDir  Direction dominante (ex: "E")
 * @property {number}   [meanSpeed]  Vitesse moyenne m/s
 * @property {string}   source       "MF-precomputed" | "ERA5-Open-Meteo"
 * @property {string}   [stationName]
 * @property {string}   [period]
 * @property {number}   [distKm]     Distance à la station (si source MF)
 */
export async function getWindRoseData(lat, lon) {
  // 1. Cache sessionStorage
  const key    = cacheKey(lat, lon);
  const cached = sessionStorage.getItem(key);
  if (cached) {
    try { return JSON.parse(cached); } catch {}
  }

  let result;

  // 2. Essai station pré-calculée
  const station = await findNearestStation(lat, lon);
  if (station) {
    result = {
      freqs16:     station.wind_freqs_16,
      calmPct:     station.calm_pct,
      dominantDir: station.dominant_dir,
      meanSpeed:   station.mean_speed_ms,
      source:      'MF-precomputed',
      stationName: station.name,
      period:      '2014-2024',
      distKm:      +haversine(lat, lon, station.lat, station.lon).toFixed(1),
    };
  } else {
    // 3. Fallback ERA5
    try {
      result = await fetchWindRoseFromERA5(lat, lon);
    } catch (err) {
      console.error('[wind-data-service] ERA5 fallback échoué :', err);
      // 4. Ultime fallback : données indicatives zone Est
      result = {
        freqs16:     [3,4,12,20,24,14,8,4,2,2,1,1,1,2,3,3],
        calmPct:     7,
        dominantDir: 'E',
        meanSpeed:   5.5,
        source:      'fallback-indicatif',
        stationName: 'Données indicatives La Réunion',
        period:      '—',
      };
    }
  }

  // Mise en cache (TTL via expiry dans l'objet)
  result._cached_at = Date.now();
  try { sessionStorage.setItem(key, JSON.stringify(result)); } catch {}

  return result;
}

/**
 * Liste toutes les stations disponibles dans le JSON.
 * Utile pour afficher un sélecteur dans l'UI.
 * @returns {Promise<Array<{id,name,commune,zone,lat,lon,alt}>>}
 */
export async function listStations() {
  const data = await loadStations();
  if (!data?.stations) return [];
  return data.stations.map(({ id, name, commune, zone, lat, lon, alt }) =>
    ({ id, name, commune, zone, lat, lon, alt })
  );
}
