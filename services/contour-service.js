// ═══════════════════════════════════════════════════════════════════════
// TERLAB · services/contour-service.js
// Courbes de niveau (isolignes) — Marching Squares sur grille DEM
// Génère des LineString pour Mapbox 2D et THREE.Line pour scène 3D
// ═══════════════════════════════════════════════════════════════════════

const ContourService = {

  // ── Marching Squares : extraction d'isolignes depuis une grille ────
  // heights: Float32Array (row-major, top→bottom)
  // W, H: dimensions grille
  // level: altitude de l'isoligne
  // Retourne un tableau de segments [[x0,y0], [x1,y1]]
  _marchingSquares(heights, W, H, level) {
    const segments = [];
    const val = (i, j) => {
      const v = heights[j * W + i];
      return (v != null && isFinite(v)) ? v : level;
    };
    const lerp = (a, b, va, vb) => {
      const t = (level - va) / (vb - va);
      return a + t * (b - a);
    };

    for (let j = 0; j < H - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const z0 = val(i, j),     z1 = val(i + 1, j);
        const z2 = val(i + 1, j + 1), z3 = val(i, j + 1);

        // 4-bit case index
        let c = 0;
        if (z0 >= level) c |= 1;
        if (z1 >= level) c |= 2;
        if (z2 >= level) c |= 4;
        if (z3 >= level) c |= 8;
        if (c === 0 || c === 15) continue;

        // Edge midpoints (interpolated)
        const top    = [lerp(i, i + 1, z0, z1), j];
        const right  = [i + 1, lerp(j, j + 1, z1, z2)];
        const bottom = [lerp(i, i + 1, z3, z2), j + 1];
        const left   = [i, lerp(j, j + 1, z0, z3)];

        const add = (a, b) => segments.push([a, b]);

        switch (c) {
          case 1: case 14: add(top, left); break;
          case 2: case 13: add(top, right); break;
          case 3: case 12: add(left, right); break;
          case 4: case 11: add(right, bottom); break;
          case 6: case 9:  add(top, bottom); break;
          case 7: case 8:  add(left, bottom); break;
          case 5:  // Saddle
            add(top, left);
            add(right, bottom);
            break;
          case 10: // Saddle
            add(top, right);
            add(left, bottom);
            break;
        }
      }
    }
    return segments;
  },

  // ── Assembler les segments en polylignes continues ─────────────────
  _joinSegments(segments, tolerance = 0.01) {
    if (!segments.length) return [];
    const lines = [];
    const used = new Uint8Array(segments.length);
    const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
    const tol2 = tolerance * tolerance;

    for (let s = 0; s < segments.length; s++) {
      if (used[s]) continue;
      used[s] = 1;
      const line = [segments[s][0], segments[s][1]];
      let changed = true;
      while (changed) {
        changed = false;
        for (let k = 0; k < segments.length; k++) {
          if (used[k]) continue;
          const [a, b] = segments[k];
          const head = line[0], tail = line[line.length - 1];
          if (dist2(tail, a) < tol2)      { line.push(b); used[k] = 1; changed = true; }
          else if (dist2(tail, b) < tol2)  { line.push(a); used[k] = 1; changed = true; }
          else if (dist2(head, b) < tol2)  { line.unshift(a); used[k] = 1; changed = true; }
          else if (dist2(head, a) < tol2)  { line.unshift(b); used[k] = 1; changed = true; }
        }
      }
      if (line.length >= 2) lines.push(line);
    }
    return lines;
  },

  // ── Choisir l'intervalle automatique selon dénivelé ───────────────
  autoInterval(minAlt, maxAlt) {
    const range = maxAlt - minAlt;
    if (range < 5)   return 0.5;
    if (range < 20)  return 1;
    if (range < 50)  return 2;
    if (range < 100) return 5;
    return 10;
  },

  // ══════════════════════════════════════════════════════════════════
  // API PUBLIQUE
  // ══════════════════════════════════════════════════════════════════

  // ── Générer des isolignes depuis BILTerrain (WMS-R haute précision)
  // Retourne { lines: [{ level, coords: [[lng,lat]...] }...], interval, minAlt, maxAlt }
  async fromBIL(wgsBounds, opts = {}) {
    const BIL = window.BILTerrain;
    if (!BIL) throw new Error('BILTerrain non disponible');
    await BIL._ensureProj4();

    const px = opts.pixelSizeM ?? 2.0;
    const maxDim = opts.maxDim ?? 256;

    const sw = proj4('EPSG:4326', 'EPSG:2975', [wgsBounds.west, wgsBounds.south]);
    const ne = proj4('EPSG:4326', 'EPSG:2975', [wgsBounds.east, wgsBounds.north]);
    const minX = BIL._snap(sw[0], px), minY = BIL._snap(sw[1], px);
    const maxX = BIL._snap(ne[0], px), maxY = BIL._snap(ne[1], px);
    let W = Math.min(maxDim, Math.ceil((maxX - minX) / px));
    let H = Math.min(maxDim, Math.ceil((maxY - minY) / px));
    const bbox = [minX, minY, minX + W * px, minY + H * px];

    const url = BIL._buildUrl(bbox, W, H);
    const buf = await (await fetch(url)).arrayBuffer();
    const heights = BIL._parseBIL(buf);

    // Stats altitude
    let hMin = Infinity, hMax = -Infinity;
    for (let k = 0; k < heights.length; k++) {
      const v = heights[k];
      if (v > -500 && v < 5000 && isFinite(v)) {
        if (v < hMin) hMin = v;
        if (v > hMax) hMax = v;
      }
    }
    const interval = opts.interval ?? this.autoInterval(hMin, hMax);
    const startLevel = Math.ceil(hMin / interval) * interval;

    const result = [];
    for (let level = startLevel; level <= hMax; level += interval) {
      const segments = this._marchingSquares(heights, W, H, level);
      const polylines = this._joinSegments(segments);
      for (const pts of polylines) {
        // Convertir grid → UTM → WGS84
        const coords = pts.map(([gi, gj]) => {
          const easting  = minX + gi * px;
          const northing = minY + (H - gj) * px;
          return proj4('EPSG:2975', 'EPSG:4326', [easting, northing]);
        });
        if (coords.length >= 2) {
          result.push({ level, coords });
        }
      }
    }
    return { lines: result, interval, minAlt: hMin, maxAlt: hMax };
  },

  // ── Générer des isolignes depuis BackgroundTerrain DEM Mapbox ─────
  // Fallback si BIL indisponible — moins précis mais toujours utile
  fromDEMTiles(wgsBounds, demTiles, opts = {}) {
    const gridRes = opts.gridRes ?? 64;
    const BG = window.BackgroundTerrain;
    if (!BG) throw new Error('BackgroundTerrain non disponible');

    const W = gridRes, H = gridRes;
    const dLng = wgsBounds.east - wgsBounds.west;
    const dLat = wgsBounds.north - wgsBounds.south;
    const heights = new Float32Array(W * H);

    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const lng = wgsBounds.west + i / (W - 1) * dLng;
        const lat = wgsBounds.south + j / (H - 1) * dLat;
        heights[j * W + i] = BG._sampleDEM(lng, lat, demTiles);
      }
    }

    let hMin = Infinity, hMax = -Infinity;
    for (let k = 0; k < heights.length; k++) {
      const v = heights[k];
      if (v > -500 && v < 5000) { if (v < hMin) hMin = v; if (v > hMax) hMax = v; }
    }
    const interval = opts.interval ?? this.autoInterval(hMin, hMax);
    const startLevel = Math.ceil(hMin / interval) * interval;

    const result = [];
    for (let level = startLevel; level <= hMax; level += interval) {
      const segments = this._marchingSquares(heights, W, H, level);
      const polylines = this._joinSegments(segments);
      for (const pts of polylines) {
        const coords = pts.map(([gi, gj]) => [
          wgsBounds.west + (gi / (W - 1)) * dLng,
          wgsBounds.south + ((H - 1 - gj) / (H - 1)) * dLat,
        ]);
        if (coords.length >= 2) result.push({ level, coords });
      }
    }
    return { lines: result, interval, minAlt: hMin, maxAlt: hMax };
  },

  // ── Convertir en GeoJSON FeatureCollection (pour Mapbox 2D) ───────
  toGeoJSON(contourData) {
    const features = contourData.lines.map(line => ({
      type: 'Feature',
      properties: {
        level: line.level,
        label: Math.round(line.level) + ' m',
        isMajor: line.level % (contourData.interval * 5) === 0,
      },
      geometry: {
        type: 'LineString',
        coordinates: line.coords,
      },
    }));
    return { type: 'FeatureCollection', features };
  },

  // ── Convertir en THREE.Group (pour scène 3D terrain) ──────────────
  // utmBounds: { minX, minY, maxX, maxY, cX, cY } du mesh BIL
  // scaleZ: exagération verticale
  toThreeGroup(contourData, utmBounds, opts = {}) {
    const THREE = window.THREE;
    if (!THREE) throw new Error('THREE.js non disponible');

    const scaleZ = opts.scaleZ ?? 1.0;
    const group = new THREE.Group();
    group.name = 'contour-lines';

    const majorColor = opts.majorColor ?? 0xffa500;
    const minorColor = opts.minorColor ?? 0x8a6e3e;
    const majorInterval = contourData.interval * 5;

    for (const line of contourData.lines) {
      const isMajor = line.level % majorInterval === 0;
      const points = [];

      for (const [lng, lat] of line.coords) {
        // WGS84 → UTM pour positionnement dans la scène
        const [e, n] = proj4('EPSG:4326', 'EPSG:2975', [lng, lat]);
        const x = e - utmBounds.cX;
        const y = n - utmBounds.cY;
        const z = line.level * scaleZ;
        points.push(new THREE.Vector3(x, y, z));
      }

      if (points.length < 2) continue;

      const geom = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({
        color: isMajor ? majorColor : minorColor,
        linewidth: isMajor ? 2 : 1,
        transparent: true,
        opacity: isMajor ? 0.9 : 0.5,
      });
      const lineObj = new THREE.Line(geom, mat);
      lineObj.name = isMajor ? 'contour-major' : 'contour-minor';
      group.add(lineObj);

      // Label altitude sur les courbes majeures
      if (isMajor && points.length > 3 && opts.labels !== false) {
        const mid = points[Math.floor(points.length / 2)];
        const cv = document.createElement('canvas');
        cv.width = 96; cv.height = 32;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, 96, 32);
        ctx.fillStyle = '#ffa500';
        ctx.font = 'bold 14px Inconsolata, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(Math.round(line.level) + ' m', 48, 16);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true,
        }));
        sp.position.copy(mid).add(new THREE.Vector3(0, 0, 1.5));
        sp.scale.set(5, 1.8, 1);
        sp.name = 'contour-label';
        group.add(sp);
      }
    }
    return group;
  },
};

export default ContourService;
