// TERLAB · services/lidar-context-service.js
// Traitement LiDAR IGN RGE ALTI → hauteurs bâtiments + terrain + végétation
// Points format : [lng, lat, alt, r?, g?, b?, class?]
// Classes ASPRS : 2=sol · 3=vég basse · 4=vég moy · 5=vég haute · 6=bâtiment · 9=eau
// ENSA La Réunion · MGA Architecture

const GROUND_CLASS    = 2;
const BUILDING_CLASS  = 6;
const TREE_CLASSES    = [3, 4, 5];

const DEFAULTS = {
  gridRes:          2.0,   // résolution grille MNT (mètres)
  minBatPoints:     3,     // points min pour valider une hauteur bâtiment
  treeMinHeight:    2.5,   // m — hauteur min pour compter un arbre
  treeMinPoints:    5,     // points min par cluster arbre
  treeCellSize:     5,     // m — taille cellule clustering arbres
  batCellSize:      5,     // m — taille cellule hash spatial bâtiments
  maxTerrainRes:    200,   // max cols/rows pour le maillage Three.js
  heightPercentile: 0.90,  // P90 pour le faîtage (évite antennes)
};

const M_PER_DEG_LAT = 111320;

const LidarContextService = {

  /**
   * Point d'entrée principal
   * @param {Array}  points          — [[lng,lat,alt,r,g,b,class], ...]
   * @param {Object} parcelGeojson   — GeoJSON Polygon/Feature parcelle
   * @param {Object} buildingsGJ     — GeoJSON FeatureCollection bâtiments OSM (optionnel)
   * @param {Object} options         — { gridRes, margin }
   * @returns {{ mnt, buildingHeights, trees, groundZ }}
   */
  process(points, parcelGeojson, buildingsGJ = null, options = {}) {
    if (!points?.length) return this._empty();

    const cfg = { ...DEFAULTS, ...options };

    // Centroïde parcelle = origine du repère local
    const center = this._centroid(parcelGeojson);
    if (!center) return this._empty();

    const latRad   = center.lat * Math.PI / 180;
    const LAT_SCALE = M_PER_DEG_LAT;
    const LNG_SCALE = M_PER_DEG_LAT * Math.cos(latRad);

    // Séparer par classe
    const groundPts   = [];
    const buildingPts = [];
    const treePts     = [];

    for (const p of points) {
      const cls = p.length >= 7 ? p[6] : GROUND_CLASS;
      if (cls === GROUND_CLASS)         groundPts.push(p);
      else if (cls === BUILDING_CLASS)  buildingPts.push(p);
      else if (TREE_CLASSES.includes(cls)) treePts.push(p);
    }

    // Convertir en mètres locaux (centré centroïde)
    const toLocal = (lng, lat) => ({
      x: (lng - center.lng) * LNG_SCALE,
      z: (lat - center.lat) * LAT_SCALE,
    });

    // 1. Grille MNT depuis les points sol
    const mnt = this._buildMNTGrid(groundPts, center, LNG_SCALE, LAT_SCALE, cfg);

    // 2. Altitude sol minimale (référence Y=0 Three.js)
    const groundZ = mnt.minAlt;

    // 3. Hauteurs bâtiments via nDSM
    let buildingHeights = new Map();
    if (buildingsGJ?.features?.length && buildingPts.length > 0) {
      buildingHeights = this._computeBuildingHeights(
        buildingPts, buildingsGJ.features, mnt, center, LNG_SCALE, LAT_SCALE, cfg
      );
    }

    // 4. Clustering arbres
    const trees = this._clusterTrees(treePts, mnt, center, LNG_SCALE, LAT_SCALE, cfg);

    // 5. Données maillage terrain pour Three.js
    const terrainData = mnt.cols >= 3 && mnt.rows >= 3
      ? this._buildTerrainData(mnt, cfg)
      : null;

    const result = { mnt, buildingHeights, trees, groundZ, terrainData };

    console.info(
      `[LidarContext] MNT ${mnt.cols}×${mnt.rows} · ` +
      `${buildingHeights.size} bâtiments LiDAR · ${trees.length} arbres · ` +
      `sol ${groundPts.length} pts · bâti ${buildingPts.length} pts · vég ${treePts.length} pts`
    );

    return result;
  },

  // ══════════════════════════════════════════════════════════════════════
  //  GRILLE MNT
  // ══════════════════════════════════════════════════════════════════════

  _buildMNTGrid(groundPts, center, LNG_SCALE, LAT_SCALE, cfg) {
    if (groundPts.length < 10) {
      return { grid: new Float32Array(0), cols: 0, rows: 0, cellSize: cfg.gridRes,
               originX: 0, originZ: 0, minAlt: 0, maxAlt: 0 };
    }

    const res = cfg.gridRes;

    // Bornes en mètres locaux
    let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    for (const p of groundPts) {
      const x = (p[0] - center.lng) * LNG_SCALE;
      const z = (p[1] - center.lat) * LAT_SCALE;
      if (x < xMin) xMin = x; if (x > xMax) xMax = x;
      if (z < zMin) zMin = z; if (z > zMax) zMax = z;
    }

    const cols = Math.ceil((xMax - xMin) / res) + 1;
    const rows = Math.ceil((zMax - zMin) / res) + 1;

    // Accumuler altitudes par cellule (somme + count pour moyenne)
    const grid   = new Float32Array(cols * rows).fill(NaN);
    const counts = new Uint16Array(cols * rows);

    for (const p of groundPts) {
      const gx = Math.floor(((p[0] - center.lng) * LNG_SCALE - xMin) / res);
      const gz = Math.floor(((p[1] - center.lat) * LAT_SCALE - zMin) / res);
      if (gx < 0 || gx >= cols || gz < 0 || gz >= rows) continue;
      const idx = gz * cols + gx;
      if (isNaN(grid[idx])) {
        grid[idx] = p[2];
        counts[idx] = 1;
      } else {
        grid[idx] = (grid[idx] * counts[idx] + p[2]) / (counts[idx] + 1);
        counts[idx]++;
      }
    }

    // Remplissage des gaps par BFS (O(n) garanti)
    this._fillMNTGapsBFS(grid, cols, rows);

    // Min/max altitude (boucle manuelle — pas de spread sur 40k+ cellules)
    let minAlt = Infinity, maxAlt = -Infinity;
    for (let i = 0; i < grid.length; i++) {
      if (!isNaN(grid[i])) {
        if (grid[i] < minAlt) minAlt = grid[i];
        if (grid[i] > maxAlt) maxAlt = grid[i];
      }
    }
    if (!isFinite(minAlt)) { minAlt = 0; maxAlt = 0; }

    return { grid, cols, rows, cellSize: res, originX: xMin, originZ: zMin, minAlt, maxAlt };
  },

  // Remplissage des cellules vides par propagation BFS 4-voisins
  _fillMNTGapsBFS(grid, cols, rows) {
    const queue = [];

    // Initialiser la queue avec les cellules vides ayant un voisin rempli
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (!isNaN(grid[idx])) continue;
        // Vérifier si au moins un voisin est rempli
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !isNaN(grid[nr * cols + nc])) {
            queue.push(idx);
            break;
          }
        }
      }
    }

    // Propager
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      if (!isNaN(grid[idx])) continue; // déjà rempli par un passage précédent

      const r = Math.floor(idx / cols), c = idx % cols;
      let sum = 0, cnt = 0;
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          const ni = nr * cols + nc;
          if (!isNaN(grid[ni])) { sum += grid[ni]; cnt++; }
        }
      }
      if (cnt > 0) {
        grid[idx] = sum / cnt;
        // Enqueue les voisins vides
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
            const ni = nr * cols + nc;
            if (isNaN(grid[ni])) queue.push(ni);
          }
        }
      }
    }

    // Fallback : NaN restants → minAlt ou 0
    let fallback = Infinity;
    for (let i = 0; i < grid.length; i++) {
      if (!isNaN(grid[i]) && grid[i] < fallback) fallback = grid[i];
    }
    if (!isFinite(fallback)) fallback = 0;
    for (let i = 0; i < grid.length; i++) {
      if (isNaN(grid[i])) grid[i] = fallback;
    }
  },

  // Interpolation bilinéaire dans la grille MNT (coordonnées locales mètres)
  sampleMNT(mnt, localX, localZ) {
    const { grid, cols, rows, cellSize, originX, originZ } = mnt;
    if (cols === 0 || rows === 0) return 0;

    const gx = (localX - originX) / cellSize;
    const gz = (localZ - originZ) / cellSize;
    const c = Math.max(0, Math.min(cols - 2, Math.floor(gx)));
    const r = Math.max(0, Math.min(rows - 2, Math.floor(gz)));
    const tx = gx - c, tz = gz - r;

    const v00 = grid[r * cols + c];
    const v10 = grid[r * cols + c + 1];
    const v01 = grid[(r + 1) * cols + c];
    const v11 = grid[(r + 1) * cols + c + 1];

    return v00 * (1 - tx) * (1 - tz) + v10 * tx * (1 - tz) +
           v01 * (1 - tx) * tz       + v11 * tx * tz;
  },

  // ══════════════════════════════════════════════════════════════════════
  //  HAUTEURS BÂTIMENTS
  // ══════════════════════════════════════════════════════════════════════

  _computeBuildingHeights(buildingPts, features, mnt, center, LNG_SCALE, LAT_SCALE, cfg) {
    const result = new Map();
    const cellSize = cfg.batCellSize;

    // Index spatial : hash grid sur les points classe 6 (mètres locaux)
    const spatialHash = new Map();
    for (const p of buildingPts) {
      const x = (p[0] - center.lng) * LNG_SCALE;
      const z = (p[1] - center.lat) * LAT_SCALE;
      const key = `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
      if (!spatialHash.has(key)) spatialHash.set(key, []);
      spatialHash.get(key).push({ x, z, alt: p[2] });
    }

    for (let fi = 0; fi < features.length; fi++) {
      const coords = features[fi].geometry?.coordinates?.[0];
      if (!coords || coords.length < 4) continue;

      // Convertir polygone en local
      const localRing = coords.map(c => ({
        x: (c[0] - center.lng) * LNG_SCALE,
        z: (c[1] - center.lat) * LAT_SCALE,
      }));

      // Centroïde du footprint
      const cx = localRing.reduce((s, p) => s + p.x, 0) / localRing.length;
      const cz = localRing.reduce((s, p) => s + p.z, 0) / localRing.length;

      // AABB du footprint
      let fxMin = Infinity, fxMax = -Infinity, fzMin = Infinity, fzMax = -Infinity;
      for (const p of localRing) {
        if (p.x < fxMin) fxMin = p.x; if (p.x > fxMax) fxMax = p.x;
        if (p.z < fzMin) fzMin = p.z; if (p.z > fzMax) fzMax = p.z;
      }

      // Collecter les points LiDAR dans les cellules hash qui chevauchent l'AABB
      const alts = [];
      const cxMin = Math.floor(fxMin / cellSize) - 1;
      const cxMax = Math.floor(fxMax / cellSize) + 1;
      const czMin = Math.floor(fzMin / cellSize) - 1;
      const czMax = Math.floor(fzMax / cellSize) + 1;

      for (let hx = cxMin; hx <= cxMax; hx++) {
        for (let hz = czMin; hz <= czMax; hz++) {
          const bucket = spatialHash.get(`${hx},${hz}`);
          if (!bucket) continue;
          for (const pt of bucket) {
            if (this._ptInPoly2D(pt.x, pt.z, localRing)) {
              alts.push(pt.alt);
            }
          }
        }
      }

      if (alts.length < cfg.minBatPoints) continue;

      // P90 pour le faîtage (tri partiel)
      alts.sort((a, b) => a - b);
      const p90Idx = Math.floor(alts.length * cfg.heightPercentile);
      const roofAlt = alts[Math.min(p90Idx, alts.length - 1)];

      // Altitude sol sous le bâtiment
      const groundAlt = this.sampleMNT(mnt, cx, cz);

      // Hauteur nette
      const height = Math.max(0, roofAlt - groundAlt);

      if (height > 0.5) {
        result.set(fi, {
          height,
          groundAlt,
          roofAlt,
          pointCount: alts.length,
          source: 'lidar',
        });
      }
    }

    return result;
  },

  // ══════════════════════════════════════════════════════════════════════
  //  CLUSTERING ARBRES
  // ══════════════════════════════════════════════════════════════════════

  _clusterTrees(treePts, mnt, center, LNG_SCALE, LAT_SCALE, cfg) {
    if (!treePts.length || mnt.cols === 0) return [];

    const cellSize = cfg.treeCellSize;
    const clusters = new Map(); // clé grille → { sumX, sumZ, maxAlt, count }

    for (const p of treePts) {
      const x = (p[0] - center.lng) * LNG_SCALE;
      const z = (p[1] - center.lat) * LAT_SCALE;
      const key = `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;

      if (!clusters.has(key)) {
        clusters.set(key, { sumX: 0, sumZ: 0, maxAlt: -Infinity, count: 0, alts: [] });
      }
      const c = clusters.get(key);
      c.sumX += x;
      c.sumZ += z;
      if (p[2] > c.maxAlt) c.maxAlt = p[2];
      c.count++;
      c.alts.push({ x, z });
    }

    const trees = [];

    for (const c of clusters.values()) {
      if (c.count < cfg.treeMinPoints) continue;

      const cx = c.sumX / c.count;
      const cz = c.sumZ / c.count;
      const groundAlt = this.sampleMNT(mnt, cx, cz);
      const height = Math.max(0, c.maxAlt - groundAlt);

      if (height < cfg.treeMinHeight) continue;

      // Rayon estimé depuis l'écart-type des positions
      let varX = 0, varZ = 0;
      for (const p of c.alts) {
        varX += (p.x - cx) ** 2;
        varZ += (p.z - cz) ** 2;
      }
      const stdDev = Math.sqrt((varX + varZ) / (2 * c.count));
      const radiusM = Math.max(1, Math.min(6, stdDev * 1.2 + 0.5));

      trees.push({ x: cx, z: cz, height, radiusM, groundAlt });
    }

    return trees;
  },

  // ══════════════════════════════════════════════════════════════════════
  //  MAILLAGE TERRAIN (données pour THREE.BufferGeometry)
  // ══════════════════════════════════════════════════════════════════════

  _buildTerrainData(mnt, cfg) {
    const { grid, cols, rows, cellSize, originX, originZ, minAlt, maxAlt } = mnt;
    const maxRes = cfg.maxTerrainRes;

    // Sous-échantillonner si nécessaire
    const step = Math.max(1, Math.ceil(Math.max(cols, rows) / maxRes));
    const sCols = Math.ceil(cols / step);
    const sRows = Math.ceil(rows / step);
    const sCell = cellSize * step;

    // Vertices (x, y=alt, z) — centré sur l'origine locale (centroïde parcelle)
    const positions = new Float32Array(sCols * sRows * 3);
    let vi = 0;
    for (let r = 0; r < sRows; r++) {
      for (let c = 0; c < sCols; c++) {
        const origC = Math.min(c * step, cols - 1);
        const origR = Math.min(r * step, rows - 1);
        const alt = grid[origR * cols + origC];

        positions[vi++] = originX + c * sCell;  // x (mètres locaux)
        positions[vi++] = alt;                   // y (altitude absolue)
        positions[vi++] = originZ + r * sCell;   // z (mètres locaux)
      }
    }

    // Indices triangles
    const indices = [];
    for (let r = 0; r < sRows - 1; r++) {
      for (let c = 0; c < sCols - 1; c++) {
        const a = r * sCols + c;
        const b = a + 1;
        const d = a + sCols;
        const e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }

    return {
      positions,
      indices: new Uint32Array(indices),
      cols: sCols,
      rows: sRows,
      cellSize: sCell,
      originX,
      originZ,
      minAlt,
      maxAlt,
    };
  },

  // ══════════════════════════════════════════════════════════════════════
  //  UTILITAIRES
  // ══════════════════════════════════════════════════════════════════════

  _empty() {
    return { mnt: { grid: new Float32Array(0), cols: 0, rows: 0, cellSize: 2, originX: 0, originZ: 0, minAlt: 0, maxAlt: 0 },
             buildingHeights: new Map(), trees: [], groundZ: 0, terrainData: null };
  },

  _centroid(geojson) {
    if (!geojson) return null;
    const coords = this._outerRing(geojson);
    if (!coords?.length) return null;
    const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    return { lng, lat };
  },

  _outerRing(gj) {
    if (!gj) return null;
    if (gj.type === 'Feature') return this._outerRing(gj.geometry);
    if (gj.type === 'Polygon') return gj.coordinates[0];
    if (gj.type === 'MultiPolygon') return gj.coordinates[0][0];
    return null;
  },

  // Point-in-polygon 2D (ray casting) — coords locales {x, z}
  _ptInPoly2D(px, pz, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i].x, zi = ring[i].z;
      const xj = ring[j].x, zj = ring[j].z;
      if ((zi > pz) !== (zj > pz) && px < (xj - xi) * (pz - zi) / (zj - zi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  },
};

export { LidarContextService };
export default LidarContextService;

if (typeof window !== 'undefined') window.LidarContextService = LidarContextService;
