/**
 * TERLAB · building-reconstruction.js
 * Reconstruction bâtiments depuis LiDAR aérien class=6
 *
 * Pipeline : Roof points → Delaunay 2.5D → Angle tension → Force lines
 *          → Continuous segments → Vertical projection → Footprint polygon
 *          → Cardinal snap → Extrusion 3D
 *
 * Algorithmes adaptés de glbtobim.html (BIMSHOW//SCAN→BIM v6.2)
 * - createAngleDetectionMesh()     → _computeAngleTension()
 * - extractForceLinesFromHeatmap() → _extractForceLines()
 * - extractContinuousSegments()    → _chainSegments()
 * - getWallDirection()             → _snapToCardinal()
 * - detectFloorLevels()            → _detectLevels()
 */

const DELAUNATOR_CDN = 'https://cdn.jsdelivr.net/npm/delaunator@5.0.1/+esm';
let _delaunator = null;

const BuildingReconstruction = {

  getDelaunator() { return _delaunator; },

  async _ensureDelaunator() {
    if (_delaunator) return _delaunator;
    if (window.Delaunator) { _delaunator = window.Delaunator; return _delaunator; }
    // Shared with TerrainMeshBuilder if already loaded
    const tmb = window.TerrainMeshBuilder;
    if (tmb?._delaunator) { _delaunator = tmb._delaunator; return _delaunator; }
    const mod = await import(DELAUNATOR_CDN);
    _delaunator = mod.default ?? mod.Delaunator;
    console.log('[BuildReco] Delaunator loaded from CDN');
    return _delaunator;
  },

  // ── PIPELINE PRINCIPAL ──────────────────────────────────────────
  /**
   * @param {Array<{x,y,z}>} points  Points class=6 en mètres locaux (x=east, y=alt, z=south)
   * @param {Function} groundAltFn   (x, z) → altitude sol en mètres
   * @param {Object} opts            Paramètres
   * @returns {{ roofGeo, tensions, forceEdges, segments, buildings }}
   */
  async reconstruct(points, groundAltFn, opts = {}) {
    const tensionThres = opts.tensionThres ?? 30;
    const minSegLen    = opts.minSegLen    ?? 1.5;
    const simplifyTol  = opts.simplifyTol  ?? 0.4;
    const minBuildArea = opts.minBuildArea  ?? 8;

    if (!points?.length || points.length < 10) return null;

    // Decimate if too many points (Delaunay O(n log n) — cap at 5000)
    let pts = points;
    if (pts.length > 5000) {
      const step = Math.ceil(pts.length / 5000);
      pts = pts.filter((_, i) => i % step === 0);
      console.log(`[BuildReco] Décimation ${points.length} → ${pts.length} pts`);
    }

    console.log(`[BuildReco] Reconstruction depuis ${pts.length} points class=6`);

    // Ensure Delaunator is available
    await this._ensureDelaunator();

    // B0 — Cluster points into separate buildings BEFORE Delaunay
    const clusters = this._clusterPoints(pts, 3.0); // 3m gap = separate buildings
    console.log(`[BuildReco] ${clusters.length} clusters de bâtiments détectés`);

    const buildings = [];
    let allForceEdges = [];

    for (const cluster of clusters) {
      if (cluster.length < 8) continue;

      // B1 — Mesh Delaunay 2.5D per cluster
      const { positions, indices } = this._delaunayRoof(cluster);

      // B2 — Tension angulaire
      const tensions = this._computeAngleTension(positions, indices);

      // B3 — Force lines + chaînage
      const forceEdges = this._extractForceLines(positions, indices, tensions, tensionThres);
      const segments = this._chainSegments(forceEdges, positions, minSegLen);

      // Collect force edges for debug rendering (shift indices)
      const offset = allForceEdges.length ? allForceEdges._posOffset ?? 0 : 0;
      allForceEdges.push({ edges: forceEdges, positions });

      // B4 — Footprint : OBB rectangle orienté → fallback polylignes concaves
      const pts2d = cluster.map(p => ({ x: p.x, y: p.z }));
      const hull = this._convexHull2D(pts2d);
      if (hull.length < 3) continue;

      const obbPoly = this._obbFootprint(hull);
      const obbArea = this._polygonArea(obbPoly);
      const hullArea = this._polygonArea(hull);
      if (obbArea < minBuildArea) continue;

      // Fit score : hull area / OBB area — rectangle parfait → ~1.0
      const fitScore = hullArea / (obbArea || 1);

      let polygon, footprintType;
      if (fitScore > 0.78) {
        // Forme suffisamment rectangulaire → OBB propre
        polygon = obbPoly;
        footprintType = 'obb';
      } else {
        // Forme complexe (L/T/U) → boundary polygon concave depuis Delaunay
        const boundary = this._boundaryPolygon(positions, indices, simplifyTol);
        if (boundary && boundary.length >= 3) {
          polygon = boundary;
          footprintType = 'concave';
        } else {
          // Ultime fallback : convex hull simplifié
          polygon = this._simplifyPolygon(hull, simplifyTol);
          footprintType = 'hull';
        }
      }

      if (polygon.length < 3) continue;
      const area = this._polygonArea(polygon);
      if (area < minBuildArea) continue;

      console.log(`[BuildReco] Footprint ${footprintType} — fit=${fitScore.toFixed(2)} area=${area.toFixed(1)}m²`);

      // Roof altitude = P90
      const alts = cluster.map(p => p.y).sort((a, b) => a - b);
      const roofZ = alts[Math.floor(alts.length * 0.9)];
      const groundZ = groundAltFn ? groundAltFn(0, 0) : alts[0] - 3;

      // B5 — Direction depuis OBB (continue, pas 8-azimuts)
      const obb = this._obbFlat(hull.map(p => [p.x, p.y]));
      const direction = obb ? ((Math.atan2(obb.ux, obb.uz) * 180 / Math.PI) % 360 + 360) % 360 : 0;

      buildings.push({
        footprint: polygon,
        footprintType,
        fitScore,
        roofAltitude: roofZ,
        groundAltitude: groundZ,
        height: Math.max(2, roofZ - groundZ),
        direction,
        area,
        levels: [],
        // Keep Delaunay mesh as real roof geometry
        roofPositions: positions,
        roofIndices: indices,
      });
    }

    // B6 — Multi-niveaux global
    const levels = this._detectLevels(pts);

    console.log(`[BuildReco] ${buildings.length} bâtiments reconstruits`);
    return { buildings, levels, allForceEdges };
  },

  // ── B1 : DELAUNAY 2.5D ──────────────────────────────────────────
  _delaunayRoof(points) {
    const n = points.length;
    const coords2d = new Float64Array(n * 2);
    const zValues = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      coords2d[i * 2]     = points[i].x;
      coords2d[i * 2 + 1] = points[i].z;
      zValues[i] = points[i].y;
    }

    const Delaunator = _delaunator;
    if (!Delaunator) throw new Error('Delaunator non chargé — appeler _ensureDelaunator() avant');
    const d = new Delaunator(coords2d);
    const indices = d.triangles;

    // Positions Float32 pour Three.js (x=east, y=alt, z=-north)
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3]     = points[i].x;
      positions[i * 3 + 1] = points[i].y;
      positions[i * 3 + 2] = points[i].z;
    }

    return { positions, indices, coords2d, zValues };
  },

  // ── B2 : TENSION ANGULAIRE ──────────────────────────────────────
  // Adapté de glbtobim.html:14072 createAngleDetectionMesh()
  _computeAngleTension(positions, indices) {
    const nVerts = positions.length / 3;
    const faceCount = indices.length / 3;

    // Face normals
    const faceNormals = [];
    const faceVertices = [];
    for (let i = 0; i < faceCount; i++) {
      const i0 = indices[i * 3], i1 = indices[i * 3 + 1], i2 = indices[i * 3 + 2];
      const ax = positions[i0 * 3], ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
      const bx = positions[i1 * 3], by = positions[i1 * 3 + 1], bz = positions[i1 * 3 + 2];
      const cx = positions[i2 * 3], cy = positions[i2 * 3 + 1], cz = positions[i2 * 3 + 2];
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= len; ny /= len; nz /= len;
      faceNormals.push(nx, ny, nz);
      faceVertices.push(i0, i1, i2);
    }

    // Vertex → face adjacency
    const vertFaces = new Array(nVerts);
    for (let i = 0; i < nVerts; i++) vertFaces[i] = [];
    for (let i = 0; i < faceCount; i++) {
      vertFaces[faceVertices[i * 3]].push(i);
      vertFaces[faceVertices[i * 3 + 1]].push(i);
      vertFaces[faceVertices[i * 3 + 2]].push(i);
    }

    // Per-vertex max angle between adjacent edge-sharing faces
    const tensions = new Float32Array(nVerts);
    for (let v = 0; v < nVerts; v++) {
      const adj = vertFaces[v];
      if (adj.length < 2) continue;
      let maxAngle = 0;
      for (let i = 0; i < adj.length; i++) {
        const fi = adj[i];
        const fiv = [faceVertices[fi * 3], faceVertices[fi * 3 + 1], faceVertices[fi * 3 + 2]];
        for (let j = i + 1; j < adj.length; j++) {
          const fj = adj[j];
          const fjv = [faceVertices[fj * 3], faceVertices[fj * 3 + 1], faceVertices[fj * 3 + 2]];
          // Check shared edge (2 shared vertices)
          let shared = 0;
          for (const vi of fiv) if (vi !== v && fjv.includes(vi)) shared++;
          if (shared < 1) continue; // need at least 1 other shared vertex (= shared edge)
          const dot = faceNormals[fi * 3] * faceNormals[fj * 3]
                    + faceNormals[fi * 3 + 1] * faceNormals[fj * 3 + 1]
                    + faceNormals[fi * 3 + 2] * faceNormals[fj * 3 + 2];
          const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);
          if (angle > maxAngle) maxAngle = angle;
        }
      }
      tensions[v] = maxAngle;
    }

    return tensions;
  },

  // ── B3a : FORCE LINES ───────────────────────────────────────────
  // Adapté de glbtobim.html:14298
  _extractForceLines(positions, indices, tensions, threshold) {
    const edges = new Map();
    const edgeKey = (a, b) => a < b ? `${a}_${b}` : `${b}_${a}`;

    for (let i = 0; i < indices.length; i += 3) {
      const tri = [indices[i], indices[i + 1], indices[i + 2]];
      const pairs = [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]];
      for (const [v1, v2] of pairs) {
        const tension = Math.max(tensions[v1], tensions[v2]);
        const key = edgeKey(v1, v2);
        if (!edges.has(key) || edges.get(key).tension < tension) {
          edges.set(key, { v1, v2, tension });
        }
      }
    }

    return Array.from(edges.values()).filter(e => e.tension >= threshold);
  },

  // ── B3b : CHAÎNAGE SEGMENTS CONTINUS ────────────────────────────
  // Adapté de glbtobim.html:14898
  _chainSegments(forceEdges, positions, minLen) {
    if (!forceEdges.length) return [];

    const edgeKey = (a, b) => a < b ? `${a}_${b}` : `${b}_${a}`;

    // Adjacency
    const adj = new Map();
    for (const edge of forceEdges) {
      if (!adj.has(edge.v1)) adj.set(edge.v1, []);
      if (!adj.has(edge.v2)) adj.set(edge.v2, []);
      adj.get(edge.v1).push({ vertex: edge.v2, edge });
      adj.get(edge.v2).push({ vertex: edge.v1, edge });
    }

    // Trace paths from endpoints
    const visited = new Set();
    const segments = [];

    for (const edge of forceEdges) {
      const key = edgeKey(edge.v1, edge.v2);
      if (visited.has(key)) continue;
      visited.add(key);

      const v1Deg = adj.get(edge.v1)?.length ?? 0;
      const v2Deg = adj.get(edge.v2)?.length ?? 0;
      const startV = v1Deg <= v2Deg ? edge.v1 : edge.v2;

      // Trace
      const path = [startV];
      let cur = startV;
      let prevEdge = edge;
      while (true) {
        const neighbors = adj.get(cur) ?? [];
        const next = neighbors.filter(n => {
          const k = edgeKey(cur, n.vertex);
          return !visited.has(k) && n.edge !== prevEdge;
        });
        if (next.length !== 1) break;
        const n = next[0];
        visited.add(edgeKey(cur, n.vertex));
        path.push(n.vertex);
        prevEdge = n.edge;
        cur = n.vertex;
      }

      // Compute path length
      let pathLen = 0;
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1];
        const dx = positions[b * 3] - positions[a * 3];
        const dy = positions[b * 3 + 1] - positions[a * 3 + 1];
        const dz = positions[b * 3 + 2] - positions[a * 3 + 2];
        pathLen += Math.sqrt(dx * dx + dy * dy + dz * dz);
      }

      if (pathLen >= minLen) {
        segments.push({ path, pathLen });
      }
    }

    // Sort by length, keep top 30
    segments.sort((a, b) => b.pathLen - a.pathLen);
    return segments.slice(0, 30);
  },

  // ── B4 : PROJECTION + EMPRISE ───────────────────────────────────
  _projectToFootprints(segments, positions, groundAltFn, simplifyTol, minArea) {
    if (!segments.length) return [];

    // Collect all edge-vertex positions projected to XZ
    const allPts = [];
    for (const seg of segments) {
      for (const v of seg.path) {
        allPts.push({
          x: positions[v * 3],
          y: positions[v * 3 + 1],  // altitude
          z: positions[v * 3 + 2],
        });
      }
    }

    // Cluster points spatially (grid 3m) to separate distinct buildings
    const CELL = 3;
    const cells = new Map();
    for (const p of allPts) {
      const key = `${Math.floor(p.x / CELL)}_${Math.floor(p.z / CELL)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(p);
    }

    // Flood-fill to get building clusters
    const visited = new Set();
    const clusters = [];
    for (const [key] of cells) {
      if (visited.has(key)) continue;
      const cluster = [];
      const stack = [key];
      while (stack.length) {
        const k = stack.pop();
        if (visited.has(k)) continue;
        visited.add(k);
        if (!cells.has(k)) continue;
        cluster.push(...cells.get(k));
        const [cx, cy] = k.split('_').map(Number);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            if (dx || dy) stack.push(`${cx + dx}_${cy + dy}`);
      }
      if (cluster.length >= 4) clusters.push(cluster);
    }

    // For each cluster, compute convex hull footprint
    const footprints = [];
    for (const cluster of clusters) {
      const hull = this._convexHull2D(cluster.map(p => ({ x: p.x, y: p.z })));
      if (hull.length < 3) continue;

      // Simplify (Douglas-Peucker)
      const simplified = this._simplifyPolygon(hull, simplifyTol);
      if (simplified.length < 3) continue;

      // Area
      const area = this._polygonArea(simplified);
      if (area < minArea) continue;

      // Roof altitude = P90 of cluster points (robust against outliers)
      const alts = cluster.map(p => p.y).sort((a, b) => a - b);
      const roofZ = alts[Math.floor(alts.length * 0.9)];

      // Ground altitude = average groundAltFn under footprint centroid
      const cx = simplified.reduce((s, p) => s + p.x, 0) / simplified.length;
      const cz = simplified.reduce((s, p) => s + p.y, 0) / simplified.length;
      const groundZ = groundAltFn ? groundAltFn(cx, cz) : alts[0] - 3;

      footprints.push({
        polygon: simplified, // [{x, y}] in local meters (x=east, y=south)
        roofZ,
        groundZ,
        area,
        direction: 0,
      });
    }

    return footprints;
  },

  // ── B5 : DIRECTION CARDINALE ────────────────────────────────────
  // Adapté de glb2bim-unified.html:456
  _snapToCardinal(footprint) {
    const pts = footprint.polygon;
    if (pts.length < 3) return;

    // Find longest edge → dominant direction
    let maxLen = 0, bestAngle = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > maxLen) {
        maxLen = len;
        bestAngle = Math.atan2(dx, dy); // azimuth
      }
    }

    // Quantize to 8 directions (45° steps)
    const step = Math.PI / 4;
    const snapped = Math.round(bestAngle / step) * step;
    footprint.direction = ((snapped * 180 / Math.PI) % 360 + 360) % 360;
  },

  // ── B6 : MULTI-NIVEAUX ─────────────────────────────────────────
  // Adapté de glb2bim-unified.html:480
  _detectLevels(points) {
    const binSize = 0.3; // 30cm bins
    const hist = new Map();
    for (const p of points) {
      const bin = Math.round(p.y / binSize);
      hist.set(bin, (hist.get(bin) ?? 0) + 1);
    }

    // Find peaks (local maxima, count ≥ 3)
    const levels = [];
    for (const [bin, count] of hist) {
      if (count < 3) continue;
      const prev = hist.get(bin - 1) ?? 0;
      const next = hist.get(bin + 1) ?? 0;
      if (count >= prev && count >= next) {
        levels.push({ y: bin * binSize, count });
      }
    }

    // Remove levels too close together (< 1m)
    levels.sort((a, b) => a.y - b.y);
    const filtered = [];
    for (const l of levels) {
      if (!filtered.length || l.y - filtered[filtered.length - 1].y > 1.0) {
        filtered.push(l);
      }
    }
    return filtered;
  },

  // ── DECIMATION TOITURE — PLANS DOMINANTS (RANSAC-like) ───────────
  // Normales calculées en mètres ISOTROPES (pas en scene coords déformées)
  // + test coplanarité (distance point-plan) en plus de l'angle
  // + region-growing itératif avec re-estimation de la normale
  //
  // @param {Float32Array} rawPositions  Positions brutes en mètres locaux (avant sf/vertExag)
  // @param {Uint32Array}  indices       Triangle indices
  // @param {number}       angleTol      Tolérance angulaire (degrés)
  // @param {number}       distTol       Tolérance distance au plan (mètres)
  // @returns {{ planes: [{normal, centroid, area, triIndices, slopeDeg}], ... }}
  decimateRoof(rawPositions, indices, angleTol = 15, distTol = 0.3) {
    const nTri = indices.length / 3;
    if (nTri < 2) return null;

    // Calcul normales et centroids en espace ISOTROPE (mètres réels)
    const triData = [];
    for (let t = 0; t < nTri; t++) {
      const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
      const ax = rawPositions[i0*3], ay = rawPositions[i0*3+1], az = rawPositions[i0*3+2];
      const bx = rawPositions[i1*3], by = rawPositions[i1*3+1], bz = rawPositions[i1*3+2];
      const cx = rawPositions[i2*3], cy = rawPositions[i2*3+1], cz = rawPositions[i2*3+2];
      const e1x = bx-ax, e1y = by-ay, e1z = bz-az;
      const e2x = cx-ax, e2y = cy-ay, e2z = cz-az;
      let nx = e1y*e2z - e1z*e2y;
      let ny = e1z*e2x - e1x*e2z;
      let nz = e1x*e2y - e1y*e2x;
      const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
      nx /= len; ny /= len; nz /= len;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const area = len / 2;
      const centX = (ax+bx+cx)/3, centY = (ay+by+cy)/3, centZ = (az+bz+cz)/3;
      triData.push({ nx, ny, nz, area, centX, centY, centZ, triIdx: t });
    }

    // Adjacence triangle ↔ triangle (partage d'arête)
    const edgeToTris = new Map();
    const edgeKey = (a, b) => a < b ? `${a}_${b}` : `${b}_${a}`;
    for (let t = 0; t < nTri; t++) {
      const i0 = indices[t*3], i1 = indices[t*3+1], i2 = indices[t*3+2];
      for (const [a, b] of [[i0,i1],[i1,i2],[i2,i0]]) {
        const k = edgeKey(a, b);
        if (!edgeToTris.has(k)) edgeToTris.set(k, []);
        edgeToTris.get(k).push(t);
      }
    }
    const triAdj = new Array(nTri);
    for (let t = 0; t < nTri; t++) triAdj[t] = new Set();
    for (const tris of edgeToTris.values()) {
      if (tris.length === 2) {
        triAdj[tris[0]].add(tris[1]);
        triAdj[tris[1]].add(tris[0]);
      }
    }

    const cosTol = Math.cos(angleTol * Math.PI / 180);
    const assigned = new Int32Array(nTri).fill(-1);
    const planes = [];

    // Trier seeds par aire décroissante
    const sortedTris = triData.map((_, i) => i).sort((a, b) => triData[b].area - triData[a].area);

    for (const seedIdx of sortedTris) {
      if (assigned[seedIdx] >= 0) continue;

      const planeIdx = planes.length;
      const seed = triData[seedIdx];

      // Plan initial : normale et point du seed
      let pnx = seed.nx, pny = seed.ny, pnz = seed.nz;
      let pd = pnx * seed.centX + pny * seed.centY + pnz * seed.centZ; // ax+by+cz=d

      assigned[seedIdx] = planeIdx;
      const members = [seedIdx];

      // Region-growing via adjacence + 2 passes de re-estimation
      for (let pass = 0; pass < 2; pass++) {
        const queue = [...members];
        const visited = new Set(members);

        while (queue.length) {
          const cur = queue.shift();
          for (const neighbor of triAdj[cur]) {
            if (assigned[neighbor] >= 0 || visited.has(neighbor)) continue;
            visited.add(neighbor);

            const td = triData[neighbor];
            // Test 1 : angle entre normales
            const dot = td.nx * pnx + td.ny * pny + td.nz * pnz;
            if (dot < cosTol) continue;

            // Test 2 : distance centroid au plan (coplanarité)
            const dist = Math.abs(td.centX * pnx + td.centY * pny + td.centZ * pnz - pd);
            if (dist > distTol) continue;

            assigned[neighbor] = planeIdx;
            members.push(neighbor);
            queue.push(neighbor);
          }
        }

        // Re-estimer la normale moyenne pondérée par aire (itératif)
        let avgNx = 0, avgNy = 0, avgNz = 0;
        let wCentX = 0, wCentY = 0, wCentZ = 0, wTotal = 0;
        for (const ti of members) {
          const td = triData[ti];
          avgNx += td.nx * td.area;
          avgNy += td.ny * td.area;
          avgNz += td.nz * td.area;
          wCentX += td.centX * td.area;
          wCentY += td.centY * td.area;
          wCentZ += td.centZ * td.area;
          wTotal += td.area;
        }
        const avgLen = Math.sqrt(avgNx*avgNx + avgNy*avgNy + avgNz*avgNz) || 1;
        pnx = avgNx / avgLen;
        pny = avgNy / avgLen;
        pnz = avgNz / avgLen;
        if (wTotal > 0) {
          wCentX /= wTotal; wCentY /= wTotal; wCentZ /= wTotal;
        }
        pd = pnx * wCentX + pny * wCentY + pnz * wCentZ;

        // Passe 2 : libérer les triangles marginaux pour re-test
        if (pass === 0) {
          for (let i = members.length - 1; i >= 1; i--) {
            const td = triData[members[i]];
            const dot2 = td.nx * pnx + td.ny * pny + td.nz * pnz;
            const dist2 = Math.abs(td.centX * pnx + td.centY * pny + td.centZ * pnz - pd);
            if (dot2 < cosTol || dist2 > distTol) {
              assigned[members[i]] = -1;
              members.splice(i, 1);
            }
          }
        }
      }

      const totalArea = members.reduce((s, ti) => s + triData[ti].area, 0);
      const centX = members.reduce((s, ti) => s + triData[ti].centX * triData[ti].area, 0) / (totalArea || 1);
      const centY = members.reduce((s, ti) => s + triData[ti].centY * triData[ti].area, 0) / (totalArea || 1);
      const centZ = members.reduce((s, ti) => s + triData[ti].centZ * triData[ti].area, 0) / (totalArea || 1);

      planes.push({
        nx: pnx, ny: pny, nz: pnz,
        totalArea,
        centX, centY, centZ,
        triIndices: members,
        slopeDeg: Math.acos(Math.min(1, Math.abs(pny))) * 180 / Math.PI,
      });
    }

    // Filtrer micro-plans (< 5% surface totale)
    const totalArea = planes.reduce((s, p) => s + p.totalArea, 0);
    const significant = planes.filter(p => p.totalArea > totalArea * 0.05);

    const decimatedIndices = [];
    for (const plane of significant) {
      for (const ti of plane.triIndices) {
        decimatedIndices.push(indices[ti*3], indices[ti*3+1], indices[ti*3+2]);
      }
    }

    console.log(`[BuildReco] Décimation RANSAC-like: ${nTri}tri → ${significant.length} plans (tol=${angleTol}°/${distTol}m)`);
    return {
      planes: significant,
      decimatedPositions: rawPositions,
      decimatedIndices: new Uint32Array(decimatedIndices),
      totalArea,
    };
  },

  // ── RENDU THREE.JS — METAFORME ───────────────────────────────────
  // Murs : ExtrudeGeometry vers le haut
  // Toit : triangulation polygone footprint → faîtage OBB
  // Chaque bâtiment est positionné indépendamment via terrainYFn
  buildMeshes(result, THREE, terrainYFn, sf, vertExag) {
    const group = new THREE.Group();
    group.name = 'bim-reconstruction';
    sf = sf ?? 1;
    vertExag = vertExag ?? 1;

    if (!result?.buildings?.length) return group;

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xd4c8a0, roughness: 0.75, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x8b5e3c, roughness: 0.55, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
    });

    for (const bld of result.buildings) {
      if (!bld.roofPositions || !bld.roofIndices) continue;

      const rPos = bld.roofPositions;
      const rIdx = bld.roofIndices;
      const nVerts = rPos.length / 3;
      if (nVerts < 3) continue;

      const bldGroup = new THREE.Group();
      bldGroup.name = 'building';

      // Transform roof positions to scene coords
      // Hauteur à l'égout : vertExag (cohérent avec terrain compressé)
      // Variations de pente du toit : 1:1 (pentes réelles non écrasées)
      // Formula : y_scene = eaveHeight * vertExag + (alt - eave) * 1.0
      const rawAlts = [];
      for (let i = 0; i < nVerts; i++) rawAlts.push(rPos[i * 3 + 1]);
      rawAlts.sort((a, b) => a - b);
      const eaveAlt = rawAlts[Math.floor(rawAlts.length * 0.15)]; // P15 = altitude égout

      const roofVerts = new Float32Array(rPos.length);
      for (let i = 0; i < nVerts; i++) {
        const alt = rPos[i * 3 + 1];
        const eaveH = (eaveAlt - bld.groundAltitude) * sf * vertExag; // hauteur égout compressée
        const roofDelta = (alt - eaveAlt) * sf;                       // relief toit 1:1
        roofVerts[i * 3]     = rPos[i * 3] * sf;
        roofVerts[i * 3 + 1] = eaveH + Math.max(0, roofDelta);       // jamais sous l'égout
        roofVerts[i * 3 + 2] = rPos[i * 3 + 2] * sf;
      }

      // --- Eave alignment: clamp boundary vertices to horizontal eave ---
      const boundaryVerts = new Set();
      const edgeCount2 = new Map();
      const ek2 = (a, b) => a < b ? `${a}_${b}` : `${b}_${a}`;
      for (let i = 0; i < rIdx.length; i += 3) {
        for (const [a, b] of [[rIdx[i], rIdx[i+1]], [rIdx[i+1], rIdx[i+2]], [rIdx[i+2], rIdx[i]]]) {
          const k = ek2(a, b);
          edgeCount2.set(k, (edgeCount2.get(k) ?? 0) + 1);
        }
      }
      for (const [k, c] of edgeCount2) {
        if (c === 1) { const [a, b] = k.split('_').map(Number); boundaryVerts.add(a); boundaryVerts.add(b); }
      }

      const eaveSceneY = (eaveAlt - bld.groundAltitude) * sf * vertExag;
      for (const v of boundaryVerts) {
        if (roofVerts[v * 3 + 1] < eaveSceneY) {
          roofVerts[v * 3 + 1] = eaveSceneY;
        }
      }

      // --- Roof mesh avec vertex colors par orientation NSEW ---
      const roofGeo = new THREE.BufferGeometry();
      roofGeo.setAttribute('position', new THREE.BufferAttribute(roofVerts, 3));
      roofGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(rIdx), 1));
      roofGeo.computeVertexNormals();

      // Colorer par orientation XZ de la normale (N/S/E/O) + intensité par pente
      // Azimut de la normale projetée en XZ → teinte NSEW
      //   Nord (nz<0) = bleu froid    Sud (nz>0) = rouge chaud
      //   Est  (nx>0) = orange         Ouest (nx<0) = violet
      // Luminosité modulée par pente (plat=clair, pentu=saturé)
      const roofNormals = roofGeo.getAttribute('normal');
      const roofColors = new Float32Array(nVerts * 3);
      for (let i = 0; i < nVerts; i++) {
        const nx = roofNormals.getX(i);
        const ny = roofNormals.getY(i);
        const nz = roofNormals.getZ(i);
        const slope = 1 - Math.abs(ny); // 0=plat, 1=vertical
        const sat = 0.3 + slope * 0.7;  // saturation : plat=pale, pentu=vif
        // Azimut → composantes couleur
        const hLen = Math.sqrt(nx * nx + nz * nz) || 0.001;
        const hx = nx / hLen, hz = nz / hLen; // direction horizontale normalisée
        // Palette continue : Sud(+z)=rouge, Nord(-z)=bleu, Est(+x)=orange, Ouest(-x)=violet
        const rr = 0.5 + 0.5 * hz;  // rouge : fort au sud
        const gg = 0.3 + 0.3 * hx;  // vert : fort à l'est
        const bb = 0.5 - 0.5 * hz;  // bleu : fort au nord
        // Appliquer saturation (blanc=plat → couleur=pentu)
        roofColors[i * 3]     = 1 - sat * (1 - rr);
        roofColors[i * 3 + 1] = 1 - sat * (1 - gg);
        roofColors[i * 3 + 2] = 1 - sat * (1 - bb);
      }
      roofGeo.setAttribute('color', new THREE.BufferAttribute(roofColors, 3));

      const slopeMat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.55, transparent: true, opacity: 0.9,
        side: THREE.DoubleSide,
      });
      const roof = new THREE.Mesh(roofGeo, slopeMat);
      roof.name = 'roof';
      roof.castShadow = true;
      roof.receiveShadow = true;
      bldGroup.add(roof);

      // --- Décimation RANSAC → plans dominants + arêtes de faîtage/noue ---
      const deci = this.decimateRoof(rPos, rIdx, 15, 0.3);
      if (deci?.planes?.length) {

        // ── Arêtes de contour entre plans adjacents (faîtage/noue/rive) ──
        // Trouver les arêtes partagées par 2 triangles de plans différents
        const triPlaneMap = new Int32Array(rIdx.length / 3).fill(-1);
        for (let pi = 0; pi < deci.planes.length; pi++) {
          for (const ti of deci.planes[pi].triIndices) triPlaneMap[ti] = pi;
        }

        const edgeKey3 = (a, b) => a < b ? `${a}_${b}` : `${b}_${a}`;
        const edgeTris = new Map();
        const nTri = rIdx.length / 3;
        for (let t = 0; t < nTri; t++) {
          const i0 = rIdx[t*3], i1 = rIdx[t*3+1], i2 = rIdx[t*3+2];
          for (const [a, b] of [[i0,i1],[i1,i2],[i2,i0]]) {
            const k = edgeKey3(a, b);
            if (!edgeTris.has(k)) edgeTris.set(k, []);
            edgeTris.get(k).push(t);
          }
        }

        const ridgeVerts = []; // faîtage (plans différents)
        for (const [k, tris] of edgeTris) {
          if (tris.length !== 2) continue;
          const p0 = triPlaneMap[tris[0]], p1 = triPlaneMap[tris[1]];
          if (p0 < 0 || p1 < 0 || p0 === p1) continue;
          // Arête entre 2 plans différents → arête de faîtage/noue
          const [a, b] = k.split('_').map(Number);
          ridgeVerts.push(
            roofVerts[a*3], roofVerts[a*3+1] + 0.05, roofVerts[a*3+2],
            roofVerts[b*3], roofVerts[b*3+1] + 0.05, roofVerts[b*3+2],
          );
        }

        if (ridgeVerts.length) {
          const ridgeGeo = new THREE.BufferGeometry();
          ridgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(ridgeVerts, 3));
          const ridgeMat = new THREE.LineBasicMaterial({
            color: 0xffff00, linewidth: 2, transparent: true, opacity: 0.9,
          });
          const ridgeLines = new THREE.LineSegments(ridgeGeo, ridgeMat);
          ridgeLines.name = 'roof-ridges';
          bldGroup.add(ridgeLines);
        }

        // ── Plans dominants colorés (overlay toggle) ──
        const deciGroup = new THREE.Group();
        deciGroup.name = 'roof-decimated';
        deciGroup.visible = false;

        for (let pi = 0; pi < deci.planes.length; pi++) {
          const plane = deci.planes[pi];
          if (plane.triIndices.length < 1) continue;

          const planeIndices = [];
          for (const ti of plane.triIndices) {
            planeIndices.push(rIdx[ti*3], rIdx[ti*3+1], rIdx[ti*3+2]);
          }

          const planeGeo = new THREE.BufferGeometry();
          planeGeo.setAttribute('position', new THREE.BufferAttribute(roofVerts, 3));
          planeGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(planeIndices), 1));
          planeGeo.computeVertexNormals();

          // Couleur par orientation du plan (même palette NSEW)
          const pnx = plane.nx, pnz = plane.nz;
          const phLen = Math.sqrt(pnx*pnx + pnz*pnz) || 0.001;
          const phx = pnx/phLen, phz = pnz/phLen;
          const pr = Math.round((0.5 + 0.5 * phz) * 255);
          const pg = Math.round((0.3 + 0.3 * phx) * 255);
          const pb = Math.round((0.5 - 0.5 * phz) * 255);

          const planeMat = new THREE.MeshStandardMaterial({
            color: (pr << 16) | (pg << 8) | pb,
            roughness: 0.5, transparent: true, opacity: 0.85,
            side: THREE.DoubleSide,
          });
          const planeMesh = new THREE.Mesh(planeGeo, planeMat);
          planeMesh.name = `roof-plane-${pi}`;
          planeMesh.userData = {
            slopeDeg: plane.slopeDeg,
            area: plane.totalArea,
            normal: { x: plane.nx, y: plane.ny, z: plane.nz },
          };
          deciGroup.add(planeMesh);
        }

        bldGroup.add(deciGroup);
        bld._decimation = deci; // stocker pour accès externe
      }

      // --- Walls : derive from roof boundary edges (edges used by only 1 triangle) ---
      const edgeCount = new Map();
      const edgeKey = (a, b) => a < b ? `${a}_${b}` : `${b}_${a}`;
      for (let i = 0; i < rIdx.length; i += 3) {
        const pairs = [[rIdx[i], rIdx[i+1]], [rIdx[i+1], rIdx[i+2]], [rIdx[i+2], rIdx[i]]];
        for (const [a, b] of pairs) {
          const k = edgeKey(a, b);
          edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
        }
      }

      // Boundary edges = used by exactly 1 triangle = roof perimeter
      // Walls go from ground (y=0) to the clamped eave altitude
      const wallVerts = [];
      for (const [k, count] of edgeCount) {
        if (count !== 1) continue;
        const [a, b] = k.split('_').map(Number);
        const ax = roofVerts[a*3], ay = roofVerts[a*3+1], az = roofVerts[a*3+2];
        const bx = roofVerts[b*3], by = roofVerts[b*3+1], bz = roofVerts[b*3+2];
        // Wall quad from ground (y=0) to roof edge (already eave-clamped)
        wallVerts.push(
          ax, 0, az,    bx, 0, bz,    ax, ay, az,
          bx, 0, bz,    bx, by, bz,   ax, ay, az,
        );
      }
      if (wallVerts.length) {
        const wallGeo = new THREE.BufferGeometry();
        wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallVerts, 3));
        wallGeo.computeVertexNormals();
        const walls = new THREE.Mesh(wallGeo, wallMat.clone());
        walls.castShadow = true;
        walls.receiveShadow = true;
        walls.name = 'walls';
        bldGroup.add(walls);
      }

      // --- Position on terrain via raycast ---
      const cx = roofVerts.reduce((s, _, i) => i % 3 === 0 ? s + roofVerts[i] : s, 0) / nVerts;
      const cz = roofVerts.reduce((s, _, i) => i % 3 === 2 ? s + roofVerts[i] : s, 0) / nVerts;
      if (terrainYFn) {
        bldGroup.position.y = terrainYFn(cx, cz);
      }

      group.add(bldGroup);
    }

    return group;
  },

  // ── POLYGON ROOF (follows actual footprint shape) ──────────────
  // Ridge line along OBB long axis, triangles from footprint edges to ridge
  _buildPolygonRoof(THREE, scPts, wallH, roofH, area, mat) {
    if (scPts.length < 3) return null;

    // OBB for ridge direction
    const pts2d = scPts.map(p => [p.x, p.z]);
    const obb = this._obbFlat(pts2d);
    if (!obb) return null;

    const { ux, uz, vx, vz, minU, maxU, minV, maxV } = obb;
    const midV = (minV + maxV) / 2;
    const ridgeY = wallH + roofH;

    // Ridge line: two endpoints along OBB long axis at midV
    // For hip: inset endpoints by 30% of width
    const spanV = Math.abs(maxV - minV);
    const inset = spanV * 0.35;
    const r0x = (minU + inset) * ux + midV * vx;
    const r0z = (minU + inset) * uz + midV * vz;
    const r1x = (maxU - inset) * ux + midV * vx;
    const r1z = (maxU - inset) * uz + midV * vz;

    // For each footprint edge, create triangle(s) to nearest ridge point
    const verts = [];
    for (let i = 0; i < scPts.length; i++) {
      const a = scPts[i];
      const b = scPts[(i + 1) % scPts.length];

      // Project edge midpoint onto ridge axis to find nearest ridge point
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      const u = mx * ux + mz * uz;
      // Clamp to ridge segment
      const t = Math.max(0, Math.min(1, (u - (minU + inset)) / ((maxU - inset) - (minU + inset) || 1)));
      const rx = r0x + t * (r1x - r0x);
      const rz = r0z + t * (r1z - r0z);

      // Triangle: a → b → ridge point
      verts.push(
        a.x, wallH, a.z,
        b.x, wallH, b.z,
        rx,  ridgeY, rz,
      );
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat);
  },

  // ── OBB (Oriented Bounding Box) ─────────────────────────────────
  _obbFlat(pts) {
    const n = pts.length;
    if (n < 3) return null;
    let best = null, bestA = Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dx = pts[j][0] - pts[i][0], dz = pts[j][1] - pts[i][1];
      const len = Math.hypot(dx, dz);
      if (len < 0.1) continue;
      const ux = dx / len, uz = dz / len, vx = -uz, vz = ux;
      let minU = 1e9, maxU = -1e9, minV = 1e9, maxV = -1e9;
      for (const [x, z] of pts) {
        const u = x * ux + z * uz, v = x * vx + z * vz;
        if (u < minU) minU = u; if (u > maxU) maxU = u;
        if (v < minV) minV = v; if (v > maxV) maxV = v;
      }
      const area = (maxU - minU) * (maxV - minV);
      if (area < bestA) { bestA = area; best = { ux, uz, vx, vz, minU, maxU, minV, maxV }; }
    }
    return best;
  },

  // ── B0 : CLUSTER POINTS (spatial grid + flood-fill) ──────────────
  _clusterPoints(points, gap) {
    const CELL = gap;
    const cells = new Map();
    for (const p of points) {
      const key = `${Math.floor(p.x / CELL)}_${Math.floor(p.z / CELL)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(p);
    }
    const visited = new Set();
    const clusters = [];
    for (const [key] of cells) {
      if (visited.has(key)) continue;
      const cluster = [];
      const stack = [key];
      while (stack.length) {
        const k = stack.pop();
        if (visited.has(k)) continue;
        visited.add(k);
        if (!cells.has(k)) continue;
        cluster.push(...cells.get(k));
        const [cx, cy] = k.split('_').map(Number);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            if (dx || dy) stack.push(`${cx + dx}_${cy + dy}`);
      }
      if (cluster.length >= 5) clusters.push(cluster);
    }
    return clusters;
  },

  // ── OBB FOOTPRINT ───────────────────────────────────────────────
  // Retourne le rectangle orienté (4 coins [{x,y}]) depuis un convex hull
  _obbFootprint(hull) {
    const pts2d = hull.map(p => [p.x, p.y]);
    const obb = this._obbFlat(pts2d);
    if (!obb) return hull; // fallback
    const { ux, uz, vx, vz, minU, maxU, minV, maxV } = obb;
    // 4 coins du rectangle orienté
    return [
      { x: minU * ux + minV * vx, y: minU * uz + minV * vz },
      { x: maxU * ux + minV * vx, y: maxU * uz + minV * vz },
      { x: maxU * ux + maxV * vx, y: maxU * uz + maxV * vz },
      { x: minU * ux + maxV * vx, y: minU * uz + maxV * vz },
    ];
  },

  // ── BOUNDARY POLYGON (concave outline from Delaunay) ───────────
  // Extrait les boundary edges (1 seul triangle adjacent) et les chaine
  // en polygone concave — fallback pour formes L/T/U
  _boundaryPolygon(positions, indices, simplifyTol) {
    const nTri = indices.length / 3;
    const edgeCount = new Map();
    const edgeKey = (a, b) => a < b ? `${a}_${b}` : `${b}_${a}`;

    for (let i = 0; i < nTri; i++) {
      const i0 = indices[i * 3], i1 = indices[i * 3 + 1], i2 = indices[i * 3 + 2];
      for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
        const k = edgeKey(a, b);
        edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
      }
    }

    // Boundary edges = exactement 1 triangle
    const boundaryAdj = new Map();
    for (const [k, count] of edgeCount) {
      if (count !== 1) continue;
      const [a, b] = k.split('_').map(Number);
      if (!boundaryAdj.has(a)) boundaryAdj.set(a, []);
      if (!boundaryAdj.has(b)) boundaryAdj.set(b, []);
      boundaryAdj.get(a).push(b);
      boundaryAdj.get(b).push(a);
    }

    if (boundaryAdj.size < 3) return null;

    // Chainer les boundary vertices en boucle
    const startV = boundaryAdj.keys().next().value;
    const chain = [startV];
    const visited = new Set([startV]);
    let cur = startV;

    while (true) {
      const neighbors = boundaryAdj.get(cur) ?? [];
      const next = neighbors.find(n => !visited.has(n));
      if (next == null) break;
      visited.add(next);
      chain.push(next);
      cur = next;
    }

    if (chain.length < 3) return null;

    // Projeter en 2D (x, z) → {x, y}
    const poly = chain.map(v => ({
      x: positions[v * 3],
      y: positions[v * 3 + 2],
    }));

    return this._simplifyPolygon(poly, simplifyTol);
  },

  // ── GEOMETRY HELPERS ────────────────────────────────────────────

  _convexHull2D(points) {
    // Andrew's monotone chain
    const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
        lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
        upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  },

  _simplifyPolygon(pts, tol) {
    // Douglas-Peucker
    if (pts.length < 3) return pts;
    const sqTol = tol * tol;
    const simplify = (start, end) => {
      let maxDist = 0, maxIdx = 0;
      const dx = pts[end].x - pts[start].x;
      const dy = pts[end].y - pts[start].y;
      const lenSq = dx * dx + dy * dy;
      for (let i = start + 1; i < end; i++) {
        let d;
        if (lenSq === 0) {
          d = (pts[i].x - pts[start].x) ** 2 + (pts[i].y - pts[start].y) ** 2;
        } else {
          const t = Math.max(0, Math.min(1, ((pts[i].x - pts[start].x) * dx + (pts[i].y - pts[start].y) * dy) / lenSq));
          const px = pts[start].x + t * dx, py = pts[start].y + t * dy;
          d = (pts[i].x - px) ** 2 + (pts[i].y - py) ** 2;
        }
        if (d > maxDist) { maxDist = d; maxIdx = i; }
      }
      if (maxDist > sqTol) {
        const left = simplify(start, maxIdx);
        const right = simplify(maxIdx, end);
        return left.slice(0, -1).concat(right);
      }
      return [pts[start], pts[end]];
    };
    return simplify(0, pts.length - 1);
  },

  _polygonArea(pts) {
    let area = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      area += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
    }
    return Math.abs(area / 2);
  },
};

window.BuildingReconstruction = BuildingReconstruction;
export default BuildingReconstruction;
