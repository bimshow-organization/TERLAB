/**
 * TERLAB . ign-contours.js
 * Couche courbes de niveau depuis MNT IGN RGE ALTI.
 * Port direct du systeme web-app/BIMSHOW :
 *   - fetch batch IGN RGE ALTI (POST pipe-separated lon/lat)
 *   - grille N x N d'altitudes
 *   - marching squares avec case table (16 cas) + interpolation lineaire
 *   - 2 LineSegments fusionnees (minor + major) = 2 draw calls
 *
 * Geofencing : etendu pour inclure La Reunion (-21.5..-20.8 / 55.0..56.0)
 *
 * Usage :
 *   const group = await buildIgnContours({lat, lng, sideM, intervalM=5, gridN=33})
 *   group : THREE.Group(LineSegments minor + LineSegments major)
 */

import * as THREE from 'three';

const IGN_ALTI_URL = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
const IGN_RESOURCE = 'ign_rge_alti_wld';

// Bounds incluant La Reunion (974) en plus de la metropole
const FRANCE_BOUNDS = [
  { latMin: 41.3,  latMax: 51.1,  lngMin: -5.2, lngMax: 9.6 },   // metropole
  { latMin: -21.5, latMax: -20.8, lngMin: 55.0, lngMax: 56.0 },  // La Reunion
];

function inFrance(lat, lng) {
  return FRANCE_BOUNDS.some(b => lat >= b.latMin && lat <= b.latMax
                                  && lng >= b.lngMin && lng <= b.lngMax);
}


// ─────────────────────────────────────────────────────────────────────────
// 1. Fetch IGN batch (POST pipe-separated)
// ─────────────────────────────────────────────────────────────────────────

async function fetchIgnBatch(points) {
  // GET avec pipe-separated (POST renvoie 500 sur l'API IGN actuelle).
  // Limite URL ~32 KB -> max ~250 points par requete.
  const lon = points.map(p => p.lng.toFixed(5)).join('|');
  const lat = points.map(p => p.lat.toFixed(5)).join('|');
  const url = (`${IGN_ALTI_URL}?lon=${lon}&lat=${lat}`
               + `&resource=${IGN_RESOURCE}&zonly=true`);
  const resp = await fetch(url, { method: 'GET' });
  if (!resp.ok) throw new Error(`IGN HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.elevations && Array.isArray(data.elevations)) {
    return data.elevations.map(v => typeof v === 'number' ? v : parseFloat(v));
  }
  if (Array.isArray(data)) return data;
  throw new Error('Format reponse IGN inconnu');
}


export async function fetchGridElevations({ lat, lng, sideM, gridN = 33 }) {
  if (!inFrance(lat, lng)) {
    throw new Error(`Hors couverture IGN : ${lat},${lng}`);
  }
  const m_per_deg_lat = 111320.0;
  const m_per_deg_lng = 103900.0 * Math.cos(lat * Math.PI / 180);
  const dLat = (sideM / 2) / m_per_deg_lat;
  const dLng = (sideM / 2) / m_per_deg_lng;
  const points = [];
  // Convention : grid[row][col] = altitude au point (lat_row, lng_col)
  // row 0 = sud (lat min) → row N-1 = nord. col 0 = ouest, col N-1 = est.
  for (let r = 0; r < gridN; r++) {
    const f_r = r / (gridN - 1);
    const lat_r = (lat - dLat) + f_r * (2 * dLat);
    for (let c = 0; c < gridN; c++) {
      const f_c = c / (gridN - 1);
      const lng_c = (lng - dLng) + f_c * (2 * dLng);
      points.push({ lng: lng_c, lat: lat_r, row: r, col: c });
    }
  }

  // Batch by 200 (limite URL GET ~32KB sur le serveur IGN)
  const elevs = new Array(points.length);
  const batchSize = 200;
  for (let i = 0; i < points.length; i += batchSize) {
    const slice = points.slice(i, i + batchSize);
    const result = await fetchIgnBatch(slice);
    for (let j = 0; j < slice.length; j++) {
      elevs[i + j] = result[j];
    }
  }
  // Reshape en grille [row][col]
  const grid = [];
  for (let r = 0; r < gridN; r++) {
    const row = new Array(gridN);
    for (let c = 0; c < gridN; c++) row[c] = elevs[r * gridN + c];
    grid.push(row);
  }
  return grid;
}


// ─────────────────────────────────────────────────────────────────────────
// 2. Marching squares (16-case table + linear interpolation)
// ─────────────────────────────────────────────────────────────────────────

function marchingSquares(grid, level, sideM) {
  const rows = grid.length;
  const cols = grid[0].length;
  const cellW = sideM / (cols - 1);
  const cellH = sideM / (rows - 1);
  const half = sideM / 2;
  const segments = [];

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      // Convention : row=0 sud, col=0 ouest. Three.js Y-up, on map :
      // x = (c * cellW) - half  (ouest -> est)
      // z = -((r * cellH) - half) (sud -> nord, mais Z vers nord = -Y_world)
      //   En Y-up world, z = -lat_local; lat augmente vers le nord donc
      //   -lat_local diminue. On met z_north = -((sideM/2) - r*cellH)
      const x0 = c * cellW - half;
      const x1 = x0 + cellW;
      const z0 = -((rows - 1 - r) * cellH - half);
      const z1 = z0 - cellH;  // nord -> z plus negatif

      const h00 = grid[r][c];
      const h10 = grid[r][c + 1];
      const h01 = grid[r + 1][c];
      const h11 = grid[r + 1][c + 1];

      let ci = 0;
      if (h00 >= level) ci |= 1;
      if (h10 >= level) ci |= 2;
      if (h11 >= level) ci |= 4;
      if (h01 >= level) ci |= 8;

      if (ci === 0 || ci === 15) continue;

      // Edges :
      // bottom : entre (x0, z0) et (x1, z0) [r,r+1 fixed at row r]
      // wait, with my mapping : row r is south, row r+1 is more north.
      // Using h00/h10 (row r) and h01/h11 (row r+1):
      const lerpEdge = (a, b) => (level - a) / (b - a);
      const bottom = () => [x0 + lerpEdge(h00, h10) * cellW, z0];        // h00->h10 (row r)
      const top    = () => [x0 + lerpEdge(h01, h11) * cellW, z1];        // h01->h11 (row r+1)
      const left   = () => [x0, z0 + lerpEdge(h00, h01) * (z1 - z0)];    // h00->h01
      const right  = () => [x1, z0 + lerpEdge(h10, h11) * (z1 - z0)];    // h10->h11

      const seg = (a, b) => segments.push({ start: a, end: b });

      switch (ci) {
        case 1:  case 14: seg(bottom(), left());  break;
        case 2:  case 13: seg(bottom(), right()); break;
        case 3:  case 12: seg(left(),   right()); break;
        case 4:  case 11: seg(right(),  top());   break;
        case 5: seg(bottom(), left());  seg(right(), top()); break;
        case 6:  case 9:  seg(bottom(), top());   break;
        case 7:  case 8:  seg(left(),   top());   break;
        case 10: seg(bottom(), right()); seg(left(), top()); break;
      }
    }
  }
  return segments;
}


// ─────────────────────────────────────────────────────────────────────────
// 3. Build THREE.Group(minor + major LineSegments)
// ─────────────────────────────────────────────────────────────────────────

export async function buildIgnContours({
  lat, lng, sideM, gridN = 65, intervalM = 5, majorEvery = 5,
  yRef = 0,           // soustraire du level pour aligner avec splat (ex z_min_zone)
  minorColor = 0xb89870, majorColor = 0xfff0d0,
  minorOpacity = 0.7, majorOpacity = 1.0,
} = {}) {
  const grid = await fetchGridElevations({ lat, lng, sideM, gridN });

  // min/max
  let minH = Infinity, maxH = -Infinity;
  for (const row of grid) for (const v of row) {
    if (v < minH) minH = v;
    if (v > maxH) maxH = v;
  }

  // Levels
  const levels = [];
  const startLevel = Math.ceil(minH / intervalM) * intervalM;
  for (let h = startLevel; h <= maxH; h += intervalM) levels.push(h);

  const minorPos = [];
  const majorPos = [];
  const majorIntervalAbs = intervalM * majorEvery;

  for (const level of levels) {
    const segs = marchingSquares(grid, level, sideM);
    if (segs.length === 0) continue;
    const isMajor = Math.abs(level % majorIntervalAbs) < 0.01;
    const bucket = isMajor ? majorPos : minorPos;
    const yLocal = level - yRef + 0.1;  // anti z-fighting
    for (const s of segs) {
      bucket.push(s.start[0], yLocal, s.start[1]);
      bucket.push(s.end[0],   yLocal, s.end[1]);
    }
  }

  const group = new THREE.Group();
  group.name = 'ign-contours';

  if (minorPos.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(minorPos, 3));
    const mat = new THREE.LineBasicMaterial({
      color: minorColor, transparent: true, opacity: minorOpacity,
      depthTest: false, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.renderOrder = 998;
    lines.frustumCulled = false;
    lines.name = 'contours-minor';
    group.add(lines);
  }
  if (majorPos.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(majorPos, 3));
    const mat = new THREE.LineBasicMaterial({
      color: majorColor, transparent: true, opacity: majorOpacity,
      depthTest: false, depthWrite: false, linewidth: 2,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.renderOrder = 999;
    lines.frustumCulled = false;
    lines.name = 'contours-major';
    group.add(lines);
  }
  group.renderOrder = 999;

  group.userData = {
    altMin: minH, altMax: maxH,
    nLevels: levels.length, intervalM, majorEvery,
    yRef,
  };
  return group;
}
