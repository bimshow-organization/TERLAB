// TERLAB · services/terrain-mesh-builder.js
// Maillage terrain TIN adaptatif depuis LiDAR HD + breaklines cadastre/BD TOPO
// Delaunay non-contraint (delaunator CDN) + post-insertion breaklines
// Layers couleur : classification LiDAR, pente, ortho UV, OBIA, geologie BRGM
// ENSA La Reunion · MGA Architecture
// ════════════════════════════════════════════════════════════════════

const DELAUNATOR_CDN = 'https://cdn.jsdelivr.net/npm/delaunator@5.0.1/+esm';

const TMB_CFG = {
  MAX_POINTS:        80000,   // seuil decimation points LiDAR
  MIN_POINTS:        100,     // minimum pour un TIN viable
  BREAKLINE_DENSITY: 2.0,     // metres entre points interpoles sur breaklines
  M_PER_DEG_LAT:     111320,
  M_PER_DEG_LNG:     103900,  // ~La Reunion lat -21
  NODATA_Z:          -9999,
};

// ── Palettes couleur pour les layers ─────────────────────────────
const PALETTES = {
  classification: {
    2: [0.72, 0.53, 0.04],  // sol — brun
    3: [0.56, 0.93, 0.56],  // veg basse — vert clair
    4: [0.20, 0.80, 0.20],  // veg moyenne — vert
    5: [0.00, 0.39, 0.00],  // veg haute — vert fonce
    6: [1.00, 0.27, 0.27],  // batiments — rouge
    9: [0.27, 0.53, 1.00],  // eau — bleu
    0: [0.60, 0.60, 0.60],  // non classe — gris
  },
  slope: [
    { max: 5,  color: [0.30, 0.69, 0.31] },  // vert — plat
    { max: 10, color: [0.55, 0.76, 0.29] },  // vert-jaune
    { max: 15, color: [1.00, 0.92, 0.23] },  // jaune
    { max: 25, color: [1.00, 0.60, 0.00] },  // orange
    { max: 40, color: [0.96, 0.26, 0.21] },  // rouge
    { max: 999, color: [0.62, 0.16, 0.16] }, // brun fonce
  ],
  altitude: {
    // divergent bleu-blanc-rouge, normalise min/max
    interpolate(t) {
      if (t < 0.5) {
        const s = t * 2;
        return [0.13 + s * 0.87, 0.40 + s * 0.60, 0.67 + s * 0.33];
      }
      const s = (t - 0.5) * 2;
      return [1.0, 1.0 - s * 0.46, 1.0 - s * 0.83];
    }
  },
};

const TerrainMeshBuilder = {

  _delaunator: null,
  _lastMesh: null,      // { mesh, metadata } du dernier build
  _lastBreaklines: null,

  // ══════════════════════════════════════════════════════════════════
  // API PRINCIPALE — Construire le mesh TIN depuis les points LiDAR
  // ══════════════════════════════════════════════════════════════════

  /**
   * @param {Array} points    — tableau de points LiDAR [lng, lat, z, ..., classification]
   * @param {Object} opts
   *   .parcelleGeojson   — GeoJSON parcelle (pour bbox + breaklines cadastre)
   *   .breaklines        — { cadastre, coursEau, batiments, routes } (GeoJSON FeatureCollections)
   *   .colorLayer        — 'classification' | 'slope' | 'altitude' | 'obia' | 'geologie' | 'ortho'
   *   .groundOnly        — true = filtrer classe 2 uniquement (defaut: true)
   *   .maxPoints         — seuil decimation
   *   .verticalExag      — exageration verticale (defaut: 1.0)
   *   .onProgress        — callback(phase, pct, msg)
   * @returns {Object} { mesh: THREE.Mesh, metadata }
   */
  async build(points, opts = {}) {
    const THREE = window.THREE ?? await import('https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.module.js');
    await this._ensureDelaunator();

    const onProgress = opts.onProgress ?? (() => {});
    const groundOnly = opts.groundOnly !== false;
    const maxPoints = opts.maxPoints ?? TMB_CFG.MAX_POINTS;
    const colorLayer = opts.colorLayer ?? 'classification';
    const verticalExag = opts.verticalExag ?? 1.0;

    onProgress('filter', 5, 'Filtrage des points sol...');

    // 1. Filtrer et preparer les points
    let pts = groundOnly
      ? points.filter(p => p.length < 7 || p[6] === 2)
      : [...points];

    if (pts.length < TMB_CFG.MIN_POINTS) {
      throw new Error(`Pas assez de points sol (${pts.length} < ${TMB_CFG.MIN_POINTS})`);
    }

    // 2. Decimer si necessaire (random sampling uniforme)
    if (pts.length > maxPoints) {
      onProgress('decimate', 10, `Decimation ${pts.length.toLocaleString()} → ${maxPoints.toLocaleString()} pts...`);
      pts = this._decimate(pts, maxPoints);
    }

    // 3. Injecter les breaklines (points interpoles le long des aretes)
    onProgress('breaklines', 20, 'Injection des breaklines...');
    const breaklinePts = await this._collectBreaklines(opts, pts);
    const allPts = pts.concat(breaklinePts);

    // 4. Convertir en coordonnees metriques locales
    onProgress('project', 30, 'Projection locale...');
    const projected = this._projectToLocal(allPts);
    const { coords2d, zValues, classValues, originLng, originLat } = projected;

    // 5. Triangulation Delaunay
    onProgress('delaunay', 40, `Delaunay sur ${coords2d.length / 2} points...`);
    const Delaunator = this._delaunator;
    const delaunay = new Delaunator(coords2d);
    const triangles = delaunay.triangles;

    // 6. Construire la geometrie Three.js
    onProgress('geometry', 60, 'Construction du mesh Three.js...');
    const nVerts = coords2d.length / 2;
    const nTris = triangles.length / 3;

    const positions = new Float32Array(nVerts * 3);
    const uvs = new Float32Array(nVerts * 2);
    const colors = new Float32Array(nVerts * 3);
    const normals = new Float32Array(nVerts * 3);

    // Bornes pour UV + altitude palette
    let xMin = Infinity, xMax = -Infinity;
    let yMin = Infinity, yMax = -Infinity;
    let zMin = Infinity, zMax = -Infinity;

    for (let i = 0; i < nVerts; i++) {
      const x = coords2d[i * 2];
      const y = coords2d[i * 2 + 1];
      const z = zValues[i];
      if (x < xMin) xMin = x; if (x > xMax) xMax = x;
      if (y < yMin) yMin = y; if (y > yMax) yMax = y;
      if (z < zMin) zMin = z; if (z > zMax) zMax = z;
    }

    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;
    const zRange = zMax - zMin || 1;

    // Remplir positions + UV
    for (let i = 0; i < nVerts; i++) {
      const x = coords2d[i * 2];
      const y = coords2d[i * 2 + 1];
      const z = zValues[i] * verticalExag;
      positions[i * 3]     = x - (xMin + xMax) / 2;  // centrer
      positions[i * 3 + 1] = z - zMin * verticalExag; // Z up (Three.js Y)
      positions[i * 3 + 2] = -(y - (yMin + yMax) / 2); // Y forward → Z back
      uvs[i * 2]     = (x - xMin) / xRange;
      uvs[i * 2 + 1] = (y - yMin) / yRange;
    }

    // 7. Couleurs par vertex
    onProgress('colors', 70, `Calcul couleurs (${colorLayer})...`);
    this._computeVertexColors(colors, {
      layer: colorLayer,
      nVerts, coords2d, zValues, classValues,
      zMin, zMax, zRange,
      positions, triangles,
    });

    // 8. Index buffer
    const indices = new Uint32Array(triangles.length);
    for (let i = 0; i < triangles.length; i++) indices[i] = triangles[i];

    // 9. Assembler la geometrie
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));
    geom.computeVertexNormals();
    geom.computeBoundingBox();

    // 10. Materiau avec vertex colors
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: false,
      roughness: 0.85,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = 'TerrainTIN';
    mesh.castShadow = false;
    mesh.receiveShadow = true;

    // Metadata
    const metadata = {
      type: 'terrain-tin',
      nVertices: nVerts,
      nTriangles: nTris,
      nBreaklinePoints: breaklinePts.length,
      bounds: { xMin, xMax, yMin, yMax, zMin, zMax },
      origin: { lng: originLng, lat: originLat },
      colorLayer,
      groundOnly,
      sourcePointCount: points.length,
      buildDate: new Date().toISOString(),
    };

    mesh.userData = metadata;
    this._lastMesh = { mesh, metadata, projected, triangles: delaunay };
    this._lastBreaklines = breaklinePts;

    onProgress('done', 100, `TIN termine — ${nVerts} sommets, ${nTris} triangles`);
    return { mesh, metadata };
  },

  // ══════════════════════════════════════════════════════════════════
  // CHANGER LA COUCHE COULEUR (sans recalculer le mesh)
  // ══════════════════════════════════════════════════════════════════

  async setColorLayer(layer, extraData) {
    if (!this._lastMesh) throw new Error('Aucun mesh TIN — lancez build() d\'abord');
    const { mesh, projected, metadata } = this._lastMesh;
    const { coords2d, zValues, classValues } = projected;
    const geom = mesh.geometry;
    const nVerts = metadata.nVertices;

    const colors = new Float32Array(nVerts * 3);
    const positions = geom.getAttribute('position').array;
    const triangles = geom.index.array;

    this._computeVertexColors(colors, {
      layer,
      nVerts, coords2d, zValues, classValues,
      zMin: metadata.bounds.zMin,
      zMax: metadata.bounds.zMax,
      zRange: (metadata.bounds.zMax - metadata.bounds.zMin) || 1,
      positions, triangles,
      extraData,
    });

    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.attributes.color.needsUpdate = true;
    metadata.colorLayer = layer;

    return mesh;
  },

  // ══════════════════════════════════════════════════════════════════
  // APPLIQUER UNE TEXTURE ORTHO UV (remplace vertex colors)
  // ══════════════════════════════════════════════════════════════════

  async applyOrthoTexture(wgsBounds) {
    if (!this._lastMesh) throw new Error('Aucun mesh TIN');
    const THREE = window.THREE;
    const mesh = this._lastMesh.mesh;

    // Charger l'ortho IGN WMS
    const W = 1024, H = 1024;
    const params = new URLSearchParams({
      SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap',
      LAYERS: 'ORTHOIMAGERY.ORTHOPHOTOS', STYLES: '',
      CRS: 'EPSG:4326',
      BBOX: `${wgsBounds.south},${wgsBounds.west},${wgsBounds.north},${wgsBounds.east}`,
      WIDTH: String(W), HEIGHT: String(H),
      FORMAT: 'image/jpeg',
    });

    const url = `https://data.geopf.fr/wms-r?${params}`;
    const texture = await new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous');
      loader.load(url, resolve, undefined, reject);
    });

    texture.flipY = true;
    texture.colorSpace = THREE.SRGBColorSpace;

    mesh.material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    mesh.material.needsUpdate = true;
    this._lastMesh.metadata.colorLayer = 'ortho';

    return mesh;
  },

  // ══════════════════════════════════════════════════════════════════
  // COLLECTE DES BREAKLINES depuis les services existants
  // ══════════════════════════════════════════════════════════════════

  async _collectBreaklines(opts, lidarPts) {
    const breaklinePts = [];
    const bl = opts.breaklines ?? {};
    const density = TMB_CFG.BREAKLINE_DENSITY;

    // Interpoler Z depuis les points LiDAR les plus proches (nearest-neighbor)
    const nnLookup = this._buildNNLookup(lidarPts);

    // ── Cadastre (polygones parcellaires) ──────────────────────────
    if (bl.cadastre?.features) {
      for (const feature of bl.cadastre.features) {
        const rings = this._extractRings(feature.geometry);
        for (const ring of rings) {
          const interpolated = this._interpolateRing(ring, density);
          for (const [lng, lat] of interpolated) {
            const z = nnLookup(lng, lat);
            if (z !== TMB_CFG.NODATA_Z) {
              breaklinePts.push([lng, lat, z, 0, 0, 0, 2]); // fake class 2
            }
          }
        }
      }
    }

    // ── Cours d'eau / ravines (LineStrings) ────────────────────────
    if (bl.coursEau?.features) {
      for (const feature of bl.coursEau.features) {
        const lines = this._extractLines(feature.geometry);
        for (const line of lines) {
          const interpolated = this._interpolateLine(line, density);
          for (const [lng, lat] of interpolated) {
            const z = nnLookup(lng, lat);
            if (z !== TMB_CFG.NODATA_Z) {
              breaklinePts.push([lng, lat, z, 0, 0, 0, 9]); // class 9 eau
            }
          }
        }
      }
    }

    // ── Batiments (polygones — points de contour) ────────────────
    if (bl.batiments?.features) {
      for (const feature of bl.batiments.features) {
        const rings = this._extractRings(feature.geometry);
        for (const ring of rings) {
          const interpolated = this._interpolateRing(ring, density);
          for (const [lng, lat] of interpolated) {
            const z = nnLookup(lng, lat);
            if (z !== TMB_CFG.NODATA_Z) {
              breaklinePts.push([lng, lat, z, 0, 0, 0, 6]); // class 6 batiment
            }
          }
        }
      }
    }

    // ── Routes (LineStrings) ──────────────────────────────────────
    if (bl.routes?.features) {
      for (const feature of bl.routes.features) {
        const lines = this._extractLines(feature.geometry);
        for (const line of lines) {
          const interpolated = this._interpolateLine(line, density);
          for (const [lng, lat] of interpolated) {
            const z = nnLookup(lng, lat);
            if (z !== TMB_CFG.NODATA_Z) {
              breaklinePts.push([lng, lat, z, 0, 0, 0, 2]); // class 2 sol
            }
          }
        }
      }
    }

    console.log(`[TerrainMesh] ${breaklinePts.length} breakline points injected `
      + `(cadastre: ${bl.cadastre?.features?.length ?? 0}, `
      + `cours_eau: ${bl.coursEau?.features?.length ?? 0}, `
      + `batiments: ${bl.batiments?.features?.length ?? 0}, `
      + `routes: ${bl.routes?.features?.length ?? 0})`);

    return breaklinePts;
  },

  // ══════════════════════════════════════════════════════════════════
  // CALCUL DES COULEURS PAR VERTEX
  // ══════════════════════════════════════════════════════════════════

  _computeVertexColors(colors, ctx) {
    const { layer, nVerts, zValues, classValues, zMin, zRange, positions, triangles } = ctx;

    if (layer === 'classification') {
      const pal = PALETTES.classification;
      for (let i = 0; i < nVerts; i++) {
        const cls = classValues[i] ?? 0;
        const c = pal[cls] ?? pal[0];
        colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
      }
    }

    else if (layer === 'altitude') {
      for (let i = 0; i < nVerts; i++) {
        const t = zRange > 0 ? (zValues[i] - zMin) / zRange : 0.5;
        const c = PALETTES.altitude.interpolate(Math.max(0, Math.min(1, t)));
        colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
      }
    }

    else if (layer === 'slope') {
      // Calculer la pente par vertex (gradient depuis les triangles voisins)
      const slopes = this._computeVertexSlopes(positions, triangles, nVerts);
      const pal = PALETTES.slope;
      for (let i = 0; i < nVerts; i++) {
        const s = slopes[i]; // pente en %
        let c = pal[pal.length - 1].color;
        for (const band of pal) {
          if (s <= band.max) { c = band.color; break; }
        }
        colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
      }
    }

    else if (layer === 'obia' && ctx.extraData?.obiaGrid) {
      // OBIA couleurs projetees depuis la grille satellite
      const grid = ctx.extraData.obiaGrid;
      const obiaColors = {
        pctTresBoise:     [0.12, 0.39, 0.12],
        pctBoise:         [0.24, 0.63, 0.24],
        pctSavane:        [0.71, 0.63, 0.24],
        pctCanne:         [0.47, 0.78, 0.31],
        pctAride:         [0.63, 0.47, 0.31],
        pctConstructions: [0.39, 0.39, 0.47],
      };
      for (let i = 0; i < nVerts; i++) {
        const cls = grid[i] ?? 'pctAride';
        const c = obiaColors[cls] ?? [0.5, 0.5, 0.5];
        colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
      }
    }

    else if (layer === 'geologie' && ctx.extraData?.geoGrid) {
      // Geologie BRGM couleurs par vertex
      const grid = ctx.extraData.geoGrid;
      for (let i = 0; i < nVerts; i++) {
        const c = grid[i] ?? [0.5, 0.5, 0.5];
        colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
      }
    }

    else {
      // Fallback : altitude
      for (let i = 0; i < nVerts; i++) {
        const t = zRange > 0 ? (zValues[i] - zMin) / zRange : 0.5;
        const c = PALETTES.altitude.interpolate(Math.max(0, Math.min(1, t)));
        colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
      }
    }
  },

  // ── Pente par vertex (degre d'inclinaison des triangles adjacents) ──
  _computeVertexSlopes(positions, triangles, nVerts) {
    const slopes = new Float32Array(nVerts);
    const counts = new Uint16Array(nVerts);

    for (let t = 0; t < triangles.length; t += 3) {
      const i0 = triangles[t], i1 = triangles[t + 1], i2 = triangles[t + 2];

      // Vecteurs arete
      const ax = positions[i1 * 3] - positions[i0 * 3];
      const ay = positions[i1 * 3 + 1] - positions[i0 * 3 + 1];
      const az = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
      const bx = positions[i2 * 3] - positions[i0 * 3];
      const by = positions[i2 * 3 + 1] - positions[i0 * 3 + 1];
      const bz = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];

      // Normale = a x b
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len < 1e-10) continue;

      // Pente = angle entre normale et verticale (Y up dans Three.js)
      const cosAngle = Math.abs(ny / len);
      const slopePct = cosAngle > 0.999 ? 0 : Math.tan(Math.acos(cosAngle)) * 100;

      slopes[i0] += slopePct; counts[i0]++;
      slopes[i1] += slopePct; counts[i1]++;
      slopes[i2] += slopePct; counts[i2]++;
    }

    for (let i = 0; i < nVerts; i++) {
      slopes[i] = counts[i] > 0 ? slopes[i] / counts[i] : 0;
    }
    return slopes;
  },

  // ══════════════════════════════════════════════════════════════════
  // HELPERS GEOMETRIQUES
  // ══════════════════════════════════════════════════════════════════

  // Projection WGS84 → coordonnees metriques locales
  _projectToLocal(points) {
    let sumLng = 0, sumLat = 0;
    for (const p of points) { sumLng += p[0]; sumLat += p[1]; }
    const originLng = sumLng / points.length;
    const originLat = sumLat / points.length;

    const coords2d = new Float64Array(points.length * 2);
    const zValues = new Float32Array(points.length);
    const classValues = new Uint8Array(points.length);

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      coords2d[i * 2]     = (p[0] - originLng) * TMB_CFG.M_PER_DEG_LNG;
      coords2d[i * 2 + 1] = (p[1] - originLat) * TMB_CFG.M_PER_DEG_LAT;
      zValues[i] = p[2];
      classValues[i] = p.length >= 7 ? p[6] : 2;
    }

    return { coords2d, zValues, classValues, originLng, originLat };
  },

  // Decimation aleatoire preservant la distribution spatiale
  _decimate(pts, target) {
    if (pts.length <= target) return pts;
    // Conserver tous les points extremes (bbox corners)
    const result = [];
    const step = pts.length / target;
    // Stratified random : garder 1 point tous les `step`
    for (let i = 0; i < pts.length && result.length < target; i += step) {
      const idx = Math.min(Math.floor(i + Math.random() * step), pts.length - 1);
      result.push(pts[idx]);
    }
    return result;
  },

  // Nearest-neighbor lookup pour interpoler Z depuis le nuage LiDAR
  _buildNNLookup(lidarPts) {
    // Grille spatiale pour accelerer la recherche
    const cellSize = 0.0001; // ~11m
    const grid = new Map();

    for (const p of lidarPts) {
      const cls = p.length >= 7 ? p[6] : 0;
      if (cls !== 2) continue; // sol uniquement
      const key = `${Math.floor(p[0] / cellSize)}|${Math.floor(p[1] / cellSize)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(p);
    }

    return (lng, lat) => {
      const cx = Math.floor(lng / cellSize);
      const cy = Math.floor(lat / cellSize);
      let bestDist = Infinity, bestZ = TMB_CFG.NODATA_Z;

      // Chercher dans les 9 cellules voisines
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const cell = grid.get(`${cx + dx}|${cy + dy}`);
          if (!cell) continue;
          for (const p of cell) {
            const d = (p[0] - lng) ** 2 + (p[1] - lat) ** 2;
            if (d < bestDist) { bestDist = d; bestZ = p[2]; }
          }
        }
      }
      return bestZ;
    };
  },

  // Extraire les anneaux (rings) d'une geometrie Polygon/MultiPolygon
  _extractRings(geom) {
    if (!geom) return [];
    if (geom.type === 'Polygon') return geom.coordinates;
    if (geom.type === 'MultiPolygon') return geom.coordinates.flat();
    return [];
  },

  // Extraire les lignes d'une geometrie LineString/MultiLineString
  _extractLines(geom) {
    if (!geom) return [];
    if (geom.type === 'LineString') return [geom.coordinates];
    if (geom.type === 'MultiLineString') return geom.coordinates;
    return [];
  },

  // Interpoler des points le long d'un ring (polygone ferme)
  _interpolateRing(ring, densityM) {
    const result = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const pts = this._interpolateSegment(ring[i], ring[i + 1], densityM);
      result.push(...pts);
    }
    return result;
  },

  // Interpoler des points le long d'une ligne
  _interpolateLine(line, densityM) {
    const result = [];
    for (let i = 0; i < line.length - 1; i++) {
      const pts = this._interpolateSegment(line[i], line[i + 1], densityM);
      result.push(...pts);
    }
    return result;
  },

  // Interpoler un segment [A, B] avec un point tous les `densityM` metres
  _interpolateSegment(a, b, densityM) {
    const dx = (b[0] - a[0]) * TMB_CFG.M_PER_DEG_LNG;
    const dy = (b[1] - a[1]) * TMB_CFG.M_PER_DEG_LAT;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const nSteps = Math.max(1, Math.ceil(dist / densityM));
    const pts = [];
    for (let s = 0; s <= nSteps; s++) {
      const t = s / nSteps;
      pts.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
      ]);
    }
    return pts;
  },

  // ── Charger delaunator depuis CDN ──────────────────────────────
  async _ensureDelaunator() {
    if (this._delaunator) return;
    try {
      const mod = await import(DELAUNATOR_CDN);
      this._delaunator = mod.default ?? mod.Delaunator;
      console.log('[TerrainMesh] Delaunator loaded from CDN');
    } catch (err) {
      throw new Error(`Impossible de charger Delaunator: ${err.message}`);
    }
  },

  // ── Getter du dernier mesh ─────────────────────────────────────
  getLastMesh()     { return this._lastMesh; },
  getLastMetadata() { return this._lastMesh?.metadata ?? null; },
};

export default TerrainMeshBuilder;
