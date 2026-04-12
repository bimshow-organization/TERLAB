// ═══════════════════════════════════════════════════════════════════════
// TERLAB · services/contour-service.js
// Courbes de niveau (isolignes) — Marching Squares sur grille DEM
// Génère des LineString pour Mapbox 2D et THREE.Line pour scène 3D
// ═══════════════════════════════════════════════════════════════════════

const ContourService = {

  // ══════════════════════════════════════════════════════════════════
  // A · LISSAGE DEM — Gaussian blur 3×3 (supprime le crénelage à la source)
  // ══════════════════════════════════════════════════════════════════

  /**
   * Gaussian blur 3×3 itéré `passes` fois sur une grille Float32Array (row-major).
   * Noyau normalisé [1 2 1; 2 4 2; 1 2 1] / 16.
   * Les bords sont gérés par clamping (pas de shrink).
   * Mutate-free : retourne un NOUVEAU Float32Array.
   */
  _gaussianBlur3x3(heights, W, H, passes = 2) {
    let src = heights;
    for (let p = 0; p < passes; p++) {
      const dst = new Float32Array(W * H);
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
          // Clamp-access pour les bords
          const ic = (ii) => Math.max(0, Math.min(W - 1, ii));
          const jc = (jj) => Math.max(0, Math.min(H - 1, jj));
          const g = (ii, jj) => {
            const v = src[jc(jj) * W + ic(ii)];
            return (v != null && isFinite(v)) ? v : src[j * W + i];
          };
          dst[j * W + i] = (
            g(i-1,j-1) + 2*g(i,j-1) + g(i+1,j-1) +
            2*g(i-1,j) + 4*g(i,j)   + 2*g(i+1,j) +
            g(i-1,j+1) + 2*g(i,j+1) + g(i+1,j+1)
          ) / 16;
        }
      }
      src = dst;
    }
    return src;
  },

  // ══════════════════════════════════════════════════════════════════
  // B · LISSAGE POLYLINE — Chaikin corner-cutting
  // ══════════════════════════════════════════════════════════════════

  /**
   * Chaikin corner-cutting : coupe chaque segment à 25%/75%.
   * Chaque passe double ~les points et lisse les angles.
   * Converge vers une B-spline quadratique (C1, dans l'enveloppe convexe).
   * @param {Array<[x,y]>} pts   polyline ouverte
   * @param {number}       passes nombre d'itérations (2-3 = bon compromis)
   * @returns {Array<[x,y]>}
   */
  _chaikinSmooth(pts, passes = 2) {
    if (pts.length < 3) return pts;
    let line = pts;
    for (let p = 0; p < passes; p++) {
      const out = [line[0]]; // conserver le premier point
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, ay] = line[i];
        const [bx, by] = line[i + 1];
        out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
        out.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
      }
      out.push(line[line.length - 1]); // conserver le dernier point
      line = out;
    }
    return line;
  },

  // ══════════════════════════════════════════════════════════════════
  // C · STAMP PLATEFORMES — modification locale du DEM pour le projet
  // ══════════════════════════════════════════════════════════════════

  /**
   * Applique des plateformes projet sur un DEM, retourne un nouveau DEM (terrain projet).
   *
   * Chaque plateforme :
   *   { polygon: [[x,y]...],  — coordonnées grille (gi, gj) float
   *     altitude: number,      — cote NGR cible
   *     talusRatio: number }   — pente talus 1V:Nh (défaut 1.5 = 1V:1.5H)
   *
   * Pixels intérieurs au polygone → altitude cible.
   * Pixels dans la bande talus → interpolation linéaire entre altitude cible et TN.
   *
   * @param {Float32Array} heights  DEM source (row-major)
   * @param {number} W, H          dimensions grille
   * @param {Array} platforms       liste de plateformes
   * @returns {Float32Array}        DEM modifié (terrain projet)
   */
  stampPlatforms(heights, W, H, platforms) {
    const tp = new Float32Array(heights); // copie
    if (!platforms || !platforms.length) return tp;

    for (const pf of platforms) {
      const poly = pf.polygon; // [[gi,gj], ...] en coordonnées grille
      if (!poly || poly.length < 3) continue;
      const alt = pf.altitude;
      const talusR = pf.talusRatio ?? 1.5;

      // BBox du polygone + marge talus
      let gMin = Infinity, gMax = -Infinity, jMin = Infinity, jMax = -Infinity;
      for (const [gi, gj] of poly) {
        if (gi < gMin) gMin = gi; if (gi > gMax) gMax = gi;
        if (gj < jMin) jMin = gj; if (gj > jMax) jMax = gj;
      }
      // Marge talus en pixels (hauteur max estimée / pixelSize * talusR)
      const marge = 10; // pixels de sécurité
      const i0 = Math.max(0, Math.floor(gMin - marge));
      const i1 = Math.min(W - 1, Math.ceil(gMax + marge));
      const j0 = Math.max(0, Math.floor(jMin - marge));
      const j1 = Math.min(H - 1, Math.ceil(jMax + marge));

      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const dist = this._distToPolygon(i, j, poly);
          if (dist <= 0) {
            // Intérieur au polygone → altitude cible
            tp[j * W + i] = alt;
          } else {
            // Bande talus : distance en pixels, convertie en mètres via hauteur
            const tn = heights[j * W + i];
            const dh = Math.abs(alt - tn);
            const talusW = dh * talusR; // largeur talus en pixels (si pixelSize=1m)
            if (dist < talusW && dh > 0.05) {
              const t = dist / talusW; // 0=bord plateforme → 1=terrain naturel
              tp[j * W + i] = alt + t * (tn - alt);
            }
            // else : hors talus → TN inchangé
          }
        }
      }
    }
    return tp;
  },

  /**
   * Distance signée approchée d'un point (px,py) à un polygone.
   * Négatif = intérieur, positif = extérieur.
   * Utilise la distance minimale aux arêtes + ray-casting pour le signe.
   */
  _distToPolygon(px, py, poly) {
    let minDist2 = Infinity;
    let inside = false;
    const n = poly.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];

      // Ray-casting (point-in-polygon)
      if (((yi > py) !== (yj > py)) &&
          (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }

      // Distance au segment [j→i]
      const dx = xj - xi, dy = yj - yi;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((px - xi) * dx + (py - yi) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const cx = xi + t * dx, cy = yi + t * dy;
      const d2 = (px - cx) ** 2 + (py - cy) ** 2;
      if (d2 < minDist2) minDist2 = d2;
    }
    const dist = Math.sqrt(minDist2);
    return inside ? -dist : dist;
  },

  // ══════════════════════════════════════════════════════════════════
  // D · CUBATURE — calcul déblais / remblais pixel par pixel
  // ══════════════════════════════════════════════════════════════════

  /**
   * Calcule les volumes de déblais et remblais entre TN et TP.
   * @param {Float32Array} demTN   terrain naturel (row-major)
   * @param {Float32Array} demTP   terrain projet  (row-major)
   * @param {number} W, H          dimensions grille
   * @param {number} pixelSizeM    taille pixel en mètres
   * @param {Array} [clipPoly]     polygone de clipping optionnel [[gi,gj]...]
   *                               (si fourni, seuls les pixels à l'intérieur comptent)
   * @returns {{ V_cut_m3, V_fill_m3, balance, ratio, grid, maxCut, maxFill,
   *             cutArea_m2, fillArea_m2 }}
   */
  computeEarthworks(demTN, demTP, W, H, pixelSizeM, clipPoly) {
    const cellArea = pixelSizeM * pixelSizeM;
    const grid = new Float32Array(W * H); // dh par pixel (positif=remblai, négatif=déblai)
    let V_cut = 0, V_fill = 0, maxCut = 0, maxFill = 0;
    let cutCells = 0, fillCells = 0;

    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const idx = j * W + i;
        // Clipping optionnel
        if (clipPoly && this._distToPolygon(i, j, clipPoly) > 0) {
          grid[idx] = 0;
          continue;
        }
        const dh = demTP[idx] - demTN[idx]; // >0=remblai, <0=déblai
        grid[idx] = dh;
        if (dh < -0.01) {
          V_cut += (-dh) * cellArea;
          cutCells++;
          if (-dh > maxCut) maxCut = -dh;
        } else if (dh > 0.01) {
          V_fill += dh * cellArea;
          fillCells++;
          if (dh > maxFill) maxFill = dh;
        }
      }
    }
    const total = V_cut + V_fill;
    return {
      V_cut_m3: V_cut,
      V_fill_m3: V_fill,
      balance_m3: V_fill - V_cut,  // >0 = besoin d'apport, <0 = excédent
      ratio: total > 0 ? 1 - Math.abs(V_cut - V_fill) / total : 1,
      grid,  // pour rendu SVG coloré
      maxCut_m: maxCut,
      maxFill_m: maxFill,
      cutArea_m2: cutCells * cellArea,
      fillArea_m2: fillCells * cellArea,
    };
  },

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

    // Lissage DEM (supprime le crénelage Marching Squares à la source)
    const blurPasses = opts.blurPasses ?? 2;
    const smoothed = blurPasses > 0 ? this._gaussianBlur3x3(heights, W, H, blurPasses) : heights;

    // Chaikin passes pour les polylines (0 = désactivé)
    const chaikinPasses = opts.chaikinPasses ?? 2;

    const result = [];
    for (let level = startLevel; level <= hMax; level += interval) {
      const segments = this._marchingSquares(smoothed, W, H, level);
      let polylines = this._joinSegments(segments);
      for (let pts of polylines) {
        // Lissage Chaikin sur la polyline en coordonnées grille
        if (chaikinPasses > 0) pts = this._chaikinSmooth(pts, chaikinPasses);
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
    // Retourner aussi le DEM brut + smoothed + métadonnées grille pour re-contouring projet
    return {
      lines: result, interval, minAlt: hMin, maxAlt: hMax,
      _grid: { heights, smoothed, W, H, px, bbox, minX, minY },
    };
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

    const blurPasses = opts.blurPasses ?? 2;
    const smoothed = blurPasses > 0 ? this._gaussianBlur3x3(heights, W, H, blurPasses) : heights;
    const chaikinPasses = opts.chaikinPasses ?? 2;

    const result = [];
    for (let level = startLevel; level <= hMax; level += interval) {
      const segments = this._marchingSquares(smoothed, W, H, level);
      let polylines = this._joinSegments(segments);
      for (let pts of polylines) {
        if (chaikinPasses > 0) pts = this._chaikinSmooth(pts, chaikinPasses);
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

  // ── Render SVG topo standalone (pour PDF) ─────────────────────────
  // Produit un SVG indépendant : parcelle + courbes de niveau colorisées
  // par altitude (gradient vert→brun) + étiquettes sur courbes majeures.
  // Params :
  //   - contourData : sortie de fromBIL() ou ContourCache.loadOrGet()
  //   - parcelGeo : Array<[lng,lat]> ring extérieur parcelle (sans fermeture)
  //   - opts : { width, height, title }
  renderTopoSVG(contourData, parcelGeo, opts = {}) {
    if (!contourData?.lines?.length || !parcelGeo?.length) return '';
    const W = opts.width  ?? 600;
    const H = opts.height ?? 400;
    const margin = 24;

    // Centroïde + projection locale (mètres, Y inversé pour SVG)
    let clng = 0, clat = 0;
    for (const [lng, lat] of parcelGeo) { clng += lng; clat += lat; }
    clng /= parcelGeo.length; clat /= parcelGeo.length;
    const LNG = 111320 * Math.cos(clat * Math.PI / 180);
    const LAT = 111320;
    const toLocal = ([lng, lat]) => [(lng - clng) * LNG, -(lat - clat) * LAT];

    // BBox locale combinée (parcelle + courbes)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const parcelLocal = parcelGeo.map(toLocal);
    for (const [x, y] of parcelLocal) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    // Élargir avec un peu des courbes voisines
    for (const line of contourData.lines) {
      for (const c of line.coords) {
        const [x, y] = toLocal(c);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    const dx = maxX - minX, dy = maxY - minY;
    const scale = Math.min((W - margin * 2) / dx, (H - margin * 2) / dy);
    const offX = (W - dx * scale) / 2 - minX * scale;
    const offY = (H - dy * scale) / 2 - minY * scale;
    const sx = x => x * scale + offX;
    const sy = y => y * scale + offY;

    // Palette altitude : vert (bas) → brun (haut)
    const { minAlt, maxAlt, interval } = contourData;
    const range = maxAlt - minAlt || 1;
    const altColor = (level) => {
      const t = Math.max(0, Math.min(1, (level - minAlt) / range));
      // vert sombre → brun
      const r = Math.round(0x4a + t * (0xa8 - 0x4a));
      const g = Math.round(0x6e + t * (0x6e - 0x6e));
      const b = Math.round(0x3e + t * (0x3e - 0x3e));
      return `rgb(${r},${g + Math.round((1 - t) * 60)},${b - Math.round(t * 20)})`;
    };

    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="IBM Plex Mono,monospace">`);
    parts.push(`<rect width="${W}" height="${H}" fill="#fcf9f3"/>`);

    // Titre
    const title = opts.title ?? `Topographie · courbes ${interval} m IGN BIL`;
    parts.push(`<text x="${W/2}" y="14" text-anchor="middle" font-size="10" font-weight="700" fill="#1C1C1A">${title}</text>`);
    parts.push(`<text x="${W - 6}" y="14" text-anchor="end" font-size="7" fill="#A8A49C">${Math.round(minAlt)}–${Math.round(maxAlt)} m NGR · Δ${Math.round(maxAlt - minAlt)} m</text>`);

    // Courbes de niveau (ordre : bas → haut pour stacker)
    const sorted = [...contourData.lines].sort((a, b) => a.level - b.level);
    for (const line of sorted) {
      const isMajor = (Math.round(line.level) % (interval * 5)) === 0;
      const pts = line.coords.map(c => {
        const [x, y] = toLocal(c);
        return `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
      }).join(' ');
      const col = altColor(line.level);
      parts.push(`<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="${isMajor ? 1.0 : 0.45}" stroke-opacity="${isMajor ? 0.85 : 0.55}" stroke-linejoin="round"/>`);
      // Label sur courbes majeures (au milieu de la polyline)
      if (isMajor && line.coords.length > 4) {
        const midIdx = Math.floor(line.coords.length / 2);
        const [mx, my] = toLocal(line.coords[midIdx]);
        const lx = sx(mx), ly = sy(my);
        parts.push(`<rect x="${(lx - 8).toFixed(1)}" y="${(ly - 5).toFixed(1)}" width="16" height="8" fill="#fcf9f3" fill-opacity="0.85" rx="1"/>`);
        parts.push(`<text x="${lx.toFixed(1)}" y="${(ly + 1.5).toFixed(1)}" text-anchor="middle" font-size="6" fill="${col}" font-weight="600">${Math.round(line.level)}</text>`);
      }
    }

    // Parcelle en surbrillance
    const pPts = parcelLocal.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ');
    parts.push(`<polygon points="${pPts}" fill="#C1652B" fill-opacity="0.10" stroke="#C1652B" stroke-width="1.5" stroke-linejoin="round"/>`);

    // Légende couleurs altitude (gradient bar)
    const lbW = 80, lbH = 6;
    const lbX = margin, lbY = H - 16;
    for (let i = 0; i < 10; i++) {
      const t = i / 10;
      const lvl = minAlt + t * range;
      parts.push(`<rect x="${lbX + i * lbW / 10}" y="${lbY}" width="${lbW / 10}" height="${lbH}" fill="${altColor(lvl)}"/>`);
    }
    parts.push(`<rect x="${lbX}" y="${lbY}" width="${lbW}" height="${lbH}" fill="none" stroke="#1C1C1A" stroke-width="0.4"/>`);
    parts.push(`<text x="${lbX}" y="${lbY - 2}" font-size="6" fill="#6A6860">${Math.round(minAlt)}m</text>`);
    parts.push(`<text x="${lbX + lbW}" y="${lbY - 2}" text-anchor="end" font-size="6" fill="#6A6860">${Math.round(maxAlt)}m</text>`);

    parts.push('</svg>');
    return parts.join('');
  },

  // ═════════════════════════════════════════��════════════════════════
  // E · PIPELINE PROJET — TN + plateformes → double jeu de courbes
  //     + cubature déblais/remblais
  // ═════════��════════════════════════════════════════════════════════

  /**
   * Pipeline complet : charge le BIL, génère les courbes TN lissées,
   * applique les plateformes projet, génère les courbes TP, calcule la cubature.
   *
   * @param {Object} wgsBounds  { west, south, east, north }
   * @param {Array}  platforms  Plateformes en coordonnées WGS84 :
   *   [{ polygon: [[lng,lat]...], altitude: number, talusRatio?: number, label?: string }]
   * @param {Object} opts       Mêmes options que fromBIL + :
   *   - parcelGeo: [[lng,lat]...] ring parcelle (pour clipping cubature)
   * @returns {Promise<{
   *   tn: contourData,   tp: contourData,
   *   earthworks: cubatureResult,
   *   platforms: Array
   * }>}
   */
  async fromBILWithProject(wgsBounds, platforms, opts = {}) {
    // 1. Charger TN via le pipeline standard (qui retourne aussi _grid)
    const tn = await this.fromBIL(wgsBounds, opts);
    const { heights, smoothed, W, H, px, minX, minY } = tn._grid;

    // Helper : convertir [lng,lat] → [gi, gj] grille
    const toGrid = ([lng, lat]) => {
      const [e, n] = proj4('EPSG:4326', 'EPSG:2975', [lng, lat]);
      return [(e - minX) / px, H - (n - minY) / px];
    };

    // 2. Convertir les plateformes en coordonnées grille
    const gridPlatforms = (platforms || []).map(pf => ({
      polygon: pf.polygon.map(toGrid),
      altitude: pf.altitude,
      talusRatio: pf.talusRatio ?? 1.5,
      label: pf.label ?? '',
    }));

    // 3. Stamp sur le DEM lissé → terrain projet
    const demTP = this.stampPlatforms(smoothed, W, H, gridPlatforms);

    // 4. Contourner le terrain projet
    const interval = tn.interval;
    const startLevel = Math.ceil(tn.minAlt / interval) * interval;
    const chaikinPasses = opts.chaikinPasses ?? 2;

    const tpLines = [];
    for (let level = startLevel; level <= tn.maxAlt + 5; level += interval) {
      const segments = this._marchingSquares(demTP, W, H, level);
      let polylines = this._joinSegments(segments);
      for (let pts of polylines) {
        if (chaikinPasses > 0) pts = this._chaikinSmooth(pts, chaikinPasses);
        const coords = pts.map(([gi, gj]) => {
          const easting  = minX + gi * px;
          const northing = minY + (H - gj) * px;
          return proj4('EPSG:2975', 'EPSG:4326', [easting, northing]);
        });
        if (coords.length >= 2) tpLines.push({ level, coords });
      }
    }
    const tp = { lines: tpLines, interval, minAlt: tn.minAlt, maxAlt: tn.maxAlt };

    // 5. Cubature déblais/remblais
    const clipPoly = opts.parcelGeo ? opts.parcelGeo.map(toGrid) : null;
    const earthworks = this.computeEarthworks(smoothed, demTP, W, H, px, clipPoly);

    return {
      tn,
      tp,
      earthworks,
      platforms: gridPlatforms,
      _grid: { W, H, px, minX, minY, demTN: smoothed, demTP },
    };
  },

  // ════════��════════════════════════════���════════════════════════════
  // F · PLAN DÉBLAIS/REMBLAIS SVG — rendu coloré pixel par pixel
  // ═══════��═══════════════════════════��══════════════════════════════

  /**
   * Produit un SVG indépendant : plan déblais/remblais coloré
   * (bleu = déblai, rouge/orange = remblai) + parcelle + plateformes
   * + légende volumes.
   *
   * @param {Object} projectData  Sortie de fromBILWithProject()
   * @param {Array}  parcelGeo    [[lng,lat]...] ring parcelle
   * @param {Object} opts         { width, height, title }
   * @returns {string}            SVG markup
   */
  renderEarthworksSVG(projectData, parcelGeo, opts = {}) {
    const { earthworks, _grid, tn, tp, platforms } = projectData;
    if (!earthworks || !_grid || !parcelGeo?.length) return '';

    const SVG_W = opts.width  ?? 600;
    const SVG_H = opts.height ?? 500;
    const margin = 24;
    const { W, H, px, minX, minY, demTN, demTP } = _grid;

    // Projection locale (m��tres, Y inversé)
    let clng = 0, clat = 0;
    for (const [lng, lat] of parcelGeo) { clng += lng; clat += lat; }
    clng /= parcelGeo.length; clat /= parcelGeo.length;
    const LNG = 111320 * Math.cos(clat * Math.PI / 180);
    const LAT = 111320;
    const toLocal = ([lng, lat]) => [(lng - clng) * LNG, -(lat - clat) * LAT];

    // BBox locale
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    const parcelLocal = parcelGeo.map(toLocal);
    for (const [x, y] of parcelLocal) {
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
      if (y < by0) by0 = y; if (y > by1) by1 = y;
    }
    // Marge 15%
    const padX = (bx1 - bx0) * 0.15, padY = (by1 - by0) * 0.15;
    bx0 -= padX; bx1 += padX; by0 -= padY; by1 += padY;

    const dxL = bx1 - bx0, dyL = by1 - by0;
    const viewH = SVG_H - 80; // réserver espace légende bas
    const scale = Math.min((SVG_W - margin * 2) / dxL, (viewH - margin * 2) / dyL);
    const offX = (SVG_W - dxL * scale) / 2 - bx0 * scale;
    const offY = (viewH - dyL * scale) / 2 - by0 * scale;
    const sx = x => x * scale + offX;
    const sy = y => y * scale + offY;

    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}" font-family="IBM Plex Mono,monospace">`);
    parts.push(`<rect width="${SVG_W}" height="${SVG_H}" fill="#fcf9f3"/>`);

    // Titre
    const title = opts.title ?? 'Plan deblais / remblais';
    parts.push(`<text x="${SVG_W/2}" y="14" text-anchor="middle" font-size="10" font-weight="700" fill="#1C1C1A">${title}</text>`);

    // ── Heatmap déblais/remblais (image bitmap rasterisée) ──
    // On rasterise la grille earthworks.grid en une petite image colorée,
    // puis on l'intègre en data-URI dans le SVG.
    const maxDh = Math.max(earthworks.maxCut_m, earthworks.maxFill_m, 0.5);
    const imgW = W, imgH = H;
    const canvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;

    if (canvas) {
      canvas.width = imgW; canvas.height = imgH;
      const ctx = canvas.getContext('2d');
      const imgData = ctx.createImageData(imgW, imgH);
      const d = imgData.data;

      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
          const idx = j * W + i;
          const dh = earthworks.grid[idx];
          const pIdx = (j * imgW + i) * 4;

          if (Math.abs(dh) < 0.01) {
            // Pas de mouvement → transparent
            d[pIdx] = 0; d[pIdx+1] = 0; d[pIdx+2] = 0; d[pIdx+3] = 0;
          } else if (dh < 0) {
            // Déblai = bleu (plus intense si profond)
            const t = Math.min(1, (-dh) / maxDh);
            d[pIdx]   = Math.round(30 + 40 * (1-t));    // R
            d[pIdx+1] = Math.round(100 + 80 * (1-t));   // G
            d[pIdx+2] = Math.round(180 + 75 * t);       // B
            d[pIdx+3] = Math.round(80 + 160 * t);       // A
          } else {
            // Remblai = orange/rouge
            const t = Math.min(1, dh / maxDh);
            d[pIdx]   = Math.round(200 + 55 * t);       // R
            d[pIdx+1] = Math.round(140 - 80 * t);       // G
            d[pIdx+2] = Math.round(50 - 30 * t);        // B
            d[pIdx+3] = Math.round(80 + 160 * t);       // A
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);

      // Positionner l'image dans le SVG
      // Grille pixel 0,0 = UTM (minX, minY+H*px) → WGS84 → local
      const sw = proj4('EPSG:2975', 'EPSG:4326', [minX, minY]);
      const ne = proj4('EPSG:2975', 'EPSG:4326', [minX + W * px, minY + H * px]);
      const [lx0, ly1] = toLocal(sw);
      const [lx1, ly0] = toLocal(ne);
      const imgSvgX = sx(lx0), imgSvgY = sy(ly0);
      const imgSvgW = sx(lx1) - sx(lx0);
      const imgSvgH = sy(ly1) - sy(ly0);

      const dataUrl = canvas.toDataURL('image/png');
      parts.push(`<image x="${imgSvgX.toFixed(1)}" y="${imgSvgY.toFixed(1)}" width="${imgSvgW.toFixed(1)}" height="${imgSvgH.toFixed(1)}" href="${dataUrl}" image-rendering="pixelated"/>`);
    }

    // ── Courbes TN (gris fin) ──
    for (const line of (tn?.lines ?? [])) {
      const isMajor = (Math.round(line.level) % ((tn.interval ?? 1) * 5)) === 0;
      const pts = line.coords.map(c => {
        const [x, y] = toLocal(c);
        return `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
      }).join(' ');
      parts.push(`<polyline points="${pts}" fill="none" stroke="#9E9A92" stroke-width="${isMajor ? 0.6 : 0.25}" stroke-opacity="${isMajor ? 0.5 : 0.3}" stroke-linejoin="round"/>`);
    }

    // ── Courbes TP (trait fort brun) ��─
    for (const line of (tp?.lines ?? [])) {
      const isMajor = (Math.round(line.level) % ((tp.interval ?? 1) * 5)) === 0;
      const pts = line.coords.map(c => {
        const [x, y] = toLocal(c);
        return `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
      }).join(' ');
      parts.push(`<polyline points="${pts}" fill="none" stroke="${isMajor ? '#8a5e1e' : '#b8946a'}" stroke-width="${isMajor ? 1.0 : 0.4}" stroke-opacity="${isMajor ? 0.85 : 0.55}" stroke-linejoin="round"/>`);
    }

    // ── Plateformes (contour pointillé + label) ──
    if (platforms?.length) {
      for (const pf of platforms) {
        // Convertir grille → UTM → WGS84 → local
        const pfLocal = pf.polygon.map(([gi, gj]) => {
          const e = minX + gi * px;
          const n = minY + (H - gj) * px;
          const [lng, lat] = proj4('EPSG:2975', 'EPSG:4326', [e, n]);
          return toLocal([lng, lat]);
        });
        const pfPts = pfLocal.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ');
        parts.push(`<polygon points="${pfPts}" fill="none" stroke="#2563EB" stroke-width="1.2" stroke-dasharray="4,2" stroke-linejoin="round"/>`);
        // Label altitude
        if (pf.label || pf.altitude) {
          const cx = pfLocal.reduce((s, [x]) => s + x, 0) / pfLocal.length;
          const cy = pfLocal.reduce((s, [,y]) => s + y, 0) / pfLocal.length;
          const lbl = pf.label || `${pf.altitude.toFixed(1)} m`;
          parts.push(`<text x="${sx(cx).toFixed(1)}" y="${sy(cy).toFixed(1)}" text-anchor="middle" font-size="7" font-weight="600" fill="#2563EB">${lbl}</text>`);
        }
      }
    }

    // ── Parcelle ──
    const pPts = parcelLocal.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ');
    parts.push(`<polygon points="${pPts}" fill="none" stroke="#C1652B" stroke-width="1.5" stroke-linejoin="round"/>`);

    // ── Légende en bas ──
    const legY = SVG_H - 65;

    // Barre gradient déblai ← → remblai
    const barW = 160, barH = 8;
    const barX = (SVG_W - barW) / 2;
    // Gradient
    parts.push(`<defs><linearGradient id="ew-grad" x1="0" y1="0" x2="1" y2="0">`);
    parts.push(`<stop offset="0%" stop-color="#3478c6"/>`);
    parts.push(`<stop offset="50%" stop-color="#fcf9f3"/>`);
    parts.push(`<stop offset="100%" stop-color="#d4602a"/>`);
    parts.push(`</linearGradient></defs>`);
    parts.push(`<rect x="${barX}" y="${legY}" width="${barW}" height="${barH}" fill="url(#ew-grad)" stroke="#1C1C1A" stroke-width="0.4" rx="2"/>`);
    parts.push(`<text x="${barX}" y="${legY - 2}" font-size="6" fill="#3478c6">Deblai</text>`);
    parts.push(`<text x="${barX + barW}" y="${legY - 2}" text-anchor="end" font-size="6" fill="#d4602a">Remblai</text>`);

    // Volumes
    const ew = earthworks;
    const volY = legY + barH + 12;
    parts.push(`<text x="${SVG_W/2}" y="${volY}" text-anchor="middle" font-size="8" fill="#1C1C1A">`);
    parts.push(`Deblai ${ew.V_cut_m3.toFixed(1)} m3`);
    parts.push(`  |  Remblai ${ew.V_fill_m3.toFixed(1)} m3`);
    parts.push(`  |  Balance ${ew.balance_m3 > 0 ? '+' : ''}${ew.balance_m3.toFixed(1)} m3`);
    parts.push(`  |  Equilibre ${(ew.ratio * 100).toFixed(0)}%`);
    parts.push(`</text>`);

    // Max hauteurs
    parts.push(`<text x="${SVG_W/2}" y="${volY + 12}" text-anchor="middle" font-size="6.5" fill="#6A6860">`);
    parts.push(`Deblai max ${ew.maxCut_m.toFixed(2)} m · Remblai max ${ew.maxFill_m.toFixed(2)} m`);
    parts.push(`  · Surfaces : deblai ${ew.cutArea_m2.toFixed(0)} m2, remblai ${ew.fillArea_m2.toFixed(0)} m2`);
    parts.push(`</text>`);

    parts.push('</svg>');
    return parts.join('');
  },
};

export default ContourService;
