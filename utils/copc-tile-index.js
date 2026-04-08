// TERLAB · utils/copc-tile-index.js
// Index des tuiles COPC LiDAR HD IGN pour La Réunion
// Port JS de lidar-fetcher/tile_index.py
// ENSA La Réunion · MGA Architecture

import UTM40S from './utm40s.js';

// ── Configuration IGN LiDAR HD Réunion ─────────────────────────────────
const IGN_BASE_URL = 'https://data.geopf.fr/telechargement/download/LiDARHD-NUALID';
const IGN_FOLDER   = 'NUALHD_1-0__LAZ_RGR92UTM40S_REU_2025-06-18';
const TILE_SIZE_M  = 1000;

const REUNION_BOUNDS = {
  minLng: 55.2, maxLng: 55.9,
  minLat: -21.4, maxLat: -20.85,
};

// ── URL d'une tuile COPC ───────────────────────────────────────────────
function buildTileUrl(xKm, yKm) {
  const x = String(xKm).padStart(4, '0');
  const y = String(yKm).padStart(4, '0');
  return `${IGN_BASE_URL}/${IGN_FOLDER}/LHD_REU_${x}_${y}_PTS_RGR92UTM40S_REUN89.copc.laz`;
}

// ── Tuiles couvrant une bbox WGS84 ────────────────────────────────────
function tilesForBboxWgs84(minLng, minLat, maxLng, maxLat) {
  // Vérifier que la bbox touche La Réunion
  if (maxLng < REUNION_BOUNDS.minLng || minLng > REUNION_BOUNDS.maxLng ||
      maxLat < REUNION_BOUNDS.minLat || minLat > REUNION_BOUNDS.maxLat) {
    console.warn('[TileIndex] BBox hors Réunion');
    return [];
  }

  // Convertir les coins en UTM40S
  let { x: minX, y: minY } = UTM40S.toUTM(minLng, minLat);
  let { x: maxX, y: maxY } = UTM40S.toUTM(maxLng, maxLat);

  // Assurer le bon ordre
  if (minX > maxX) [minX, maxX] = [maxX, minX];
  if (minY > maxY) [minY, maxY] = [maxY, minY];

  // Convention IGN : floor pour X, ceil pour Y
  // Dalle Y=7658 couvre northing [7657000, 7658000]
  const xStart = Math.floor(minX / TILE_SIZE_M);
  const xEnd   = Math.floor(maxX / TILE_SIZE_M);
  const yStart = Math.ceil(minY / TILE_SIZE_M);
  const yEnd   = Math.ceil(maxY / TILE_SIZE_M);

  const tiles = [];
  for (let dx = xStart; dx <= xEnd; dx++) {
    for (let dy = yStart; dy <= yEnd; dy++) {
      tiles.push({
        tileId: `LHD_REU_${String(dx).padStart(4, '0')}_${String(dy).padStart(4, '0')}`,
        xKm: dx,
        yKm: dy,
        minE: dx * TILE_SIZE_M,
        maxE: dx * TILE_SIZE_M + TILE_SIZE_M,
        minN: (dy - 1) * TILE_SIZE_M,
        maxN: dy * TILE_SIZE_M,
        url: buildTileUrl(dx, dy),
      });
    }
  }

  console.log(`[TileIndex] ${minLng.toFixed(4)},${minLat.toFixed(4)} → ${maxLng.toFixed(4)},${maxLat.toFixed(4)} => ${tiles.length} tuile(s)`);
  return tiles;
}

// ── Bbox UTM depuis bbox WGS84 ────────────────────────────────────────
function bboxWgs84ToUtm(minLng, minLat, maxLng, maxLat) {
  let { x: minX, y: minY } = UTM40S.toUTM(minLng, minLat);
  let { x: maxX, y: maxY } = UTM40S.toUTM(maxLng, maxLat);
  if (minX > maxX) [minX, maxX] = [maxX, minX];
  if (minY > maxY) [minY, maxY] = [maxY, minY];
  return { minX, minY, maxX, maxY };
}

export { tilesForBboxWgs84, bboxWgs84ToUtm, buildTileUrl, REUNION_BOUNDS, TILE_SIZE_M };
export default { tilesForBboxWgs84, bboxWgs84ToUtm, buildTileUrl, REUNION_BOUNDS, TILE_SIZE_M };
