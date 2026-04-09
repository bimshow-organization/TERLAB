// terlab/services/terrain-p07-adapter.js · Pipeline géométrique robuste parcelle · v2
// ENSA La Réunion · MGA Architecture 2026
// Vanilla JS ES2022+, aucune dépendance externe
// Centralise toutes les fonctions géométriques critiques pour p07

const M_LAT = 111_132.954;                          // m/deg (constant)
function M_LON(lat) { return M_LAT * Math.cos(lat * Math.PI / 180); }

const TerrainP07Adapter = {

  // ═══════════════════════════════════════════════════════════════════════════
  // Point d'entrée principal
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Valide + transforme un GeoJSON Feature parcelle → polygone local CCW mètres
   * @param {Object} feature  — GeoJSON Feature (Polygon ou MultiPolygon)
   * @param {Object} [options] — { precision: 2, bearing: 0 }
   * @returns {{ poly, bearing, pir, bb, area, edgeTypes, origin, warnings, valid }}
   */
  process(feature, options = {}) {
    const warnings = [];
    const errors   = [];

    // 1. Extraire anneau extérieur
    let coords;
    try {
      coords = this._extractRing(feature);
    } catch (e) {
      return { valid: false, errors: [e.message], warnings, poly: [] };
    }

    // 2. Détecter CRS
    const crs = this.detectCRS(coords);
    if (crs === 'L93_PROBABLE') {
      return { valid: false, errors: ['CRS_L93'], warnings: ['Coordonnées Lambert 93 détectées — reprojection nécessaire'], poly: [] };
    }

    // 3. Nettoyer + dédupliquer
    let ring = this.cleanVertices(coords);
    ring = this.deduplicateVertices(ring, 0.000005); // ~0.5m en WGS84

    if (ring.length < 3) {
      warnings.push('GEOM_DEGENERE');
      // Fallback AABB 20×20m centré sur le centroïde
      const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      const mlon = M_LON(cy);
      const hw = 10 / mlon, hh = 10 / M_LAT;
      ring = [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]];
      warnings.push('FALLBACK_AABB_20x20');
    }

    // 4. Centroïde pour projection
    const cx = ring.reduce((s, c) => s + c[0], 0) / ring.length;
    const cy = ring.reduce((s, c) => s + c[1], 0) / ring.length;

    // 5. Convertir → local mètres (sans rotation d'abord pour PCA)
    let bearing = options.bearing ?? 0;
    let poly = this.geoToLocal(ring, bearing, cy, cx);
    let polyCCW = this.ensureCCW(poly);

    // 5b. Si pas de bearing fourni, calculer via PCA et reconvertir avec rotation
    if (!options.bearing) {
      const pcaBearing = this.inferBearingFromPCA(polyCCW);
      if (pcaBearing > 1) { // seuil pour éviter micro-rotations inutiles
        bearing = pcaBearing;
        poly = this.geoToLocal(ring, bearing, cy, cx);
        polyCCW = this.ensureCCW(poly);
      }
    }

    // 6. Auto-intersection
    const selfIsect = this.checkSelfIntersect(polyCCW);
    if (!selfIsect.valid) {
      warnings.push('GEOM_INVALID');
    }

    // 7. Aire
    const area = this.polyArea(polyCCW);
    if (area < 50) warnings.push('TINY_PARCEL');

    // 8. AABB
    const bb = this.polyAABB(polyCCW);

    // 9. PIR
    const prec = options.precision ?? 1.5;
    const pir = this.poleOfInaccessibility(polyCCW, prec);

    const finalBearing = bearing;

    return {
      poly:      polyCCW,
      bearing:   finalBearing,
      pir,
      bb,
      area,
      edgeTypes: null,   // calculé séparément via inferEdgeTypes(poly, session)
      origin:    { lat: cy, lng: cx },
      warnings,
      errors,
      valid:     errors.length === 0,
    };
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Géométrie de base
  // ═══════════════════════════════════════════════════════════════════════════

  /** Détecte CRS Lambert 93 (|x| > 180 → probable L93) */
  detectCRS(coords) {
    for (const c of coords) {
      if (Math.abs(c[0]) > 180 || Math.abs(c[1]) > 180) return 'L93_PROBABLE';
    }
    return 'WGS84';
  },

  /** Supprime le sommet de fermeture (p[0]=p[last]) + déduplique ε=0.01m */
  cleanVertices(coords) {
    if (coords.length < 2) return [...coords];
    const ring = [...coords];
    // Retirer doublon de fermeture
    const last = ring.length - 1;
    if (ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1]) {
      ring.pop();
    }
    return ring;
  },

  /** Garantit winding CCW (sens trigonométrique, Y-haut) */
  ensureCCW(poly) {
    const area = this._signedArea(poly);
    return area < 0 ? [...poly].reverse() : poly;
  },

  /** Détecte auto-intersection O(n²) paires non-adjacentes */
  checkSelfIntersect(poly) {
    const n = poly.length;
    const segments = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue; // arêtes adjacentes (boucle)
        const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
        const [x3, y3] = poly[j], [x4, y4] = poly[(j + 1) % n];
        if (this._segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4)) {
          segments.push([i, j]);
        }
      }
    }
    return { valid: segments.length === 0, segments };
  },

  /** Supprime vertices quasi-colinéaires (arête < eps mètres) */
  deduplicateVertices(poly, eps = 0.01) {
    if (poly.length < 3) return poly;
    const out = [poly[0]];
    for (let i = 1; i < poly.length; i++) {
      const prev = out[out.length - 1];
      const dx = poly[i][0] - prev[0], dy = poly[i][1] - prev[1];
      if (Math.hypot(dx, dy) >= eps) out.push(poly[i]);
    }
    // Vérifier dernier-premier
    if (out.length > 1) {
      const f = out[0], l = out[out.length - 1];
      if (Math.hypot(f[0] - l[0], f[1] - l[1]) < eps) out.pop();
    }
    return out;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Inset robuste
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Intersection de deux droites infinies — robuste
   * Midpoint fallback si |cross| < 1e-8 ou spike > 3×AABB
   */
  lineIsect(x1, y1, x2, y2, x3, y3, x4, y4, aabbDiag = Infinity) {
    const d1x = x2 - x1, d1y = y2 - y1;
    const d2x = x4 - x3, d2y = y4 - y3;
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-8) {
      // Lignes parallèles → midpoint
      return [(x2 + x3) / 2, (y2 + y3) / 2];
    }
    const t = ((x3 - x1) * d2y - (y3 - y1) * d2x) / cross;
    const px = x1 + t * d1x, py = y1 + t * d1y;
    // Guard spike : si le point est à plus de 3× la diagonale AABB
    if (aabbDiag < Infinity) {
      const dist = Math.hypot(px - (x2 + x3) / 2, py - (y2 + y3) / 2);
      if (dist > 3 * aabbDiag) return [(x2 + x3) / 2, (y2 + y3) / 2];
    }
    return [px, py];
  },

  /**
   * Inset polygonal avec reculs par arête
   * @param {Array} poly   — [[x,y]...] CCW local mètres
   * @param {Array} reculs — [r0, r1, ...rn] un recul par arête
   * @returns {{ env, ratio, collapsed, warnings }}
   */
  insetPoly(poly, reculs) {
    const n = poly.length;
    const warnings = [];
    const bb = this.polyAABB(poly);
    const diag = Math.hypot(bb.w, bb.h);

    // Calculer arêtes décalées
    const iedges = [];
    for (let i = 0; i < n; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
      const d = reculs[i] ?? 0;
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
      if (len < 0.01) { iedges.push([x1, y1, x2, y2]); continue; }
      const nx = -dy / len, ny = dx / len;
      iedges.push([x1 + nx * d, y1 + ny * d, x2 + nx * d, y2 + ny * d]);
    }

    // Intersection arêtes consécutives
    const env = iedges.map((_, i) => {
      const [x1, y1, x2, y2] = iedges[i];
      const [x3, y3, x4, y4] = iedges[(i + 1) % n];
      return this.lineIsect(x1, y1, x2, y2, x3, y3, x4, y4, diag);
    });

    // Détecter effondrement
    const envArea = this.polyArea(env);
    const polyAreaVal = this.polyArea(poly);
    const ratio = polyAreaVal > 0 ? envArea / polyAreaVal : 0;
    const collapsed = envArea <= 5;

    if (collapsed) warnings.push('INSET_COLLAPSED');

    return { env, ratio, collapsed, warnings };
  },

  /**
   * Inset adaptatif : réduit reculs si parcelle trop étroite
   * Seuil effondrement : polyArea(env) ≤ 5 m²
   * @param {Array} poly          — [[x,y]...] CCW local mètres
   * @param {Object} reculsTyped  — { voie, lat, fond, mitoyen: [] }
   * @param {string[]} edgeTypes  — types par arête
   * @returns {{ env, ratio, collapsed, warnings, reculsEffectifs }}
   */
  adaptiveInset(poly, reculsTyped, edgeTypes) {
    const n = poly.length;

    // Construire tableau reculs par arête
    const buildReculs = (factor = 1) => edgeTypes.map(type => {
      if (type === 'voie')    return (reculsTyped.voie ?? 3) * factor;
      if (type === 'fond')    return (reculsTyped.fond ?? 3) * factor;
      if (type === 'mitoyen') return 0;
      return (reculsTyped.lat ?? 1.5) * factor;
    });

    // Essai plein recul
    let reculs = buildReculs(1);
    let result = this.insetPoly(poly, reculs);

    if (!result.collapsed) {
      return { ...result, reculsEffectifs: reculs };
    }

    // Réduction adaptative
    const lMin = this.minWidth(poly);
    const rMax = Math.max(...reculs);
    const ratio = rMax > 0 ? Math.min(1, lMin / (2.2 * rMax)) : 1;

    if (ratio < 1) {
      reculs = buildReculs(ratio);
      result = this.insetPoly(poly, reculs);
      result.warnings.push(`RECULS_REDUITS ×${ratio.toFixed(2)}`);
    }

    return { ...result, ratio, reculsEffectifs: reculs };
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PIR + PCA
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Pôle d'inaccessibilité (point le plus intérieur)
   * Grid search prec=1.5m, maximise min_dist_to_edges
   * Garanti ptInPoly = true
   */
  poleOfInaccessibility(poly, prec = 1.5) {
    const bb = this.polyAABB(poly);
    let bestX = bb.x + bb.w / 2, bestY = bb.y + bb.h / 2;
    let bestDist = -Infinity;

    // Grille sur la AABB
    for (let x = bb.x; x <= bb.x + bb.w; x += prec) {
      for (let y = bb.y; y <= bb.y + bb.h; y += prec) {
        if (!this.ptInPoly(x, y, poly)) continue;
        const d = this._minDistToEdges(x, y, poly);
        if (d > bestDist) { bestDist = d; bestX = x; bestY = y; }
      }
    }

    // Raffinement local (prec / 4)
    const finePrec = prec / 4;
    const cx = bestX, cy = bestY;
    for (let x = cx - prec; x <= cx + prec; x += finePrec) {
      for (let y = cy - prec; y <= cy + prec; y += finePrec) {
        if (!this.ptInPoly(x, y, poly)) continue;
        const d = this._minDistToEdges(x, y, poly);
        if (d > bestDist) { bestDist = d; bestX = x; bestY = y; }
      }
    }

    return [bestX, bestY];
  },

  /**
   * Axe principal par PCA sur les sommets du polygone
   * Eigenvecteur de la plus grande valeur propre → bearing (0–360, nord=0)
   */
  inferBearingFromPCA(poly) {
    if (poly.length < 3) return 0;

    // Centroïde
    const n = poly.length;
    const cx = poly.reduce((s, p) => s + p[0], 0) / n;
    const cy = poly.reduce((s, p) => s + p[1], 0) / n;

    // Matrice de covariance 2×2
    let cxx = 0, cxy = 0, cyy = 0;
    for (const [x, y] of poly) {
      const dx = x - cx, dy = y - cy;
      cxx += dx * dx;
      cxy += dx * dy;
      cyy += dy * dy;
    }
    cxx /= n; cxy /= n; cyy /= n;

    // Eigenvecteur de la plus grande valeur propre
    // λ = ((cxx+cyy) ± sqrt((cxx-cyy)² + 4cxy²)) / 2
    const trace = cxx + cyy;
    const det   = cxx * cyy - cxy * cxy;
    const disc  = Math.sqrt(Math.max(0, trace * trace / 4 - det));
    // λ_max = trace/2 + disc (la plus grande)
    const lambdaMax = trace / 2 + disc;

    // Eigenvecteur : [cxy, lambdaMax - cxx] ou [lambdaMax - cyy, cxy]
    let vx, vy;
    if (Math.abs(cxy) > 1e-10) {
      vx = cxy;
      vy = lambdaMax - cxx;
    } else {
      // Axes alignés : prendre l'axe principal
      vx = cxx >= cyy ? 1 : 0;
      vy = cxx >= cyy ? 0 : 1;
    }

    // Convertir en bearing (0=nord, sens horaire)
    // atan2(vx, vy) car bearing = angle depuis nord (Y+) vers est (X+)
    let bearing = Math.atan2(vx, vy) * 180 / Math.PI;
    if (bearing < 0) bearing += 360;

    return bearing;
  },

  /** Largeur minimale de la parcelle (min dimension AABB) */
  minWidth(poly) {
    const bb = this.polyAABB(poly);
    return Math.min(bb.w, bb.h);
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Primitives géométriques
  // ═══════════════════════════════════════════════════════════════════════════

  /** Aire par shoelace (valeur absolue) */
  polyArea(poly) {
    let s = 0;
    for (let i = 0, n = poly.length; i < n; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
      s += x1 * y2 - x2 * y1;
    }
    return Math.abs(s) / 2;
  },

  /** AABB {x, y, x1, y1, w, h} */
  polyAABB(poly) {
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    const xMin = Math.min(...xs), yMin = Math.min(...ys);
    const xMax = Math.max(...xs), yMax = Math.max(...ys);
    return { x: xMin, y: yMin, x1: xMax, y1: yMax, w: xMax - xMin, h: yMax - yMin };
  },

  /** ptInPoly ray casting */
  ptInPoly(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  },

  /** Distance point-segment */
  distPtSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-12) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Conversion coordonnées
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Conversion GeoJSON WGS84 → polygone local CCW en mètres
   * Origine = SW coin AABB, Y-haut = nord
   * @param {Array} coords    — [[lng,lat]...]
   * @param {number} [bearing] — rotation en degrés (0 = nord)
   * @param {number} [lat0]   — latitude origine (centroïde si omis)
   * @param {number} [lng0]   — longitude origine (centroïde si omis)
   * @returns [[x, y]...] local mètres
   */
  geoToLocal(coords, bearing = 0, lat0 = null, lng0 = null) {
    if (!coords.length) return [];

    // Centroïde par défaut
    if (lat0 === null) lat0 = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    if (lng0 === null) lng0 = coords.reduce((s, c) => s + c[0], 0) / coords.length;

    const mlon = M_LON(lat0);

    // WGS84 → métriques
    const metriques = coords.map(([lng, lat]) => [
      (lng - lng0) * mlon,
      (lat - lat0) * M_LAT,
    ]);

    // Rotation inverse de l'azimut
    const theta = -(bearing * Math.PI / 180);
    const cos = Math.cos(theta), sin = Math.sin(theta);
    const rotated = metriques.map(([x, y]) => [
      x * cos - y * sin,
      x * sin + y * cos,
    ]);

    // Translater SW → (0, 0)
    const xs = rotated.map(p => p[0]), ys = rotated.map(p => p[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    return rotated.map(([x, y]) => [
      parseFloat((x - minX).toFixed(3)),
      parseFloat((y - minY).toFixed(3)),
    ]);
  },

  /**
   * Conversion local mètres → WGS84
   * @param {Array} poly     — [[x,y]...] local mètres
   * @param {number} bearing — rotation en degrés
   * @param {number} lat0    — latitude origine
   * @param {number} lng0    — longitude origine
   * @returns [[lng, lat]...]
   */
  localToGeo(poly, bearing, lat0, lng0) {
    const mlon = M_LON(lat0);
    const theta = bearing * Math.PI / 180;
    const cos = Math.cos(theta), sin = Math.sin(theta);
    return poly.map(([x, y]) => {
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      return [lng0 + rx / mlon, lat0 + ry / M_LAT];
    });
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Inférence edgeTypes
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Infère edgeTypes[] depuis le polygone et la session
   * Arête la plus au sud → 'voie', arêtes ⊥ → 'lat', nord → 'fond'
   * Surcharge via session.terrain.bearing_voie_deg si présent
   */
  inferEdgeTypes(polyCCW, session = {}) {
    const n = polyCCW.length;
    if (n < 3) return Array(n).fill('lat');

    // Calculer midpoint Y de chaque arête
    const edgeMids = Array.from({ length: n }, (_, i) => {
      const [, y1] = polyCCW[i], [, y2] = polyCCW[(i + 1) % n];
      return { i, midY: (y1 + y2) / 2 };
    });

    // Arête voie = midY le plus bas (le plus au sud après rotation)
    const voieIdx = edgeMids.reduce((a, b) => b.midY < a.midY ? b : a).i;
    // Arête fond = midY le plus haut (le plus au nord)
    const fondIdx = edgeMids.reduce((a, b) => b.midY > a.midY ? b : a).i;

    // Surcharge si bearing_voie_deg fourni dans la session
    // (on pourrait affiner avec l'angle de chaque arête vs le bearing)

    return Array.from({ length: n }, (_, i) => {
      if (i === voieIdx) return 'voie';
      if (i === fondIdx) return 'fond';
      return 'lat';
    });
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Validation
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Rapport complet de validation
   * @returns {{ valid, warnings[], errors[] }}
   */
  validate(poly, env, session = {}) {
    const warnings = [];
    const errors   = [];

    const area = this.polyArea(poly);
    if (area < 50)  warnings.push('TINY_PARCEL');
    if (area < 10)  errors.push('PARCEL_TOO_SMALL');

    const selfIsect = this.checkSelfIntersect(poly);
    if (!selfIsect.valid) warnings.push('GEOM_INVALID');

    // Vérifier zone PLU
    const zone = session?.terrain?.zone_plu;
    if (zone === 'N' || zone === 'A') {
      warnings.push('ZONE_NON_CONSTRUCTIBLE');
    }

    // Vérifier PPRN
    const pprn = session?.phases?.[3]?.data?.zone_pprn;
    if (pprn === 'rouge') {
      warnings.push('PPRN_ROUGE_EMPRISE_0');
    } else if (pprn === 'orange') {
      warnings.push('PPRN_ORANGE_EMPRISE_MAX_20');
    }

    // Enveloppe
    if (env) {
      const envArea = this.polyArea(env);
      if (envArea <= 5) warnings.push('ENVELOPPE_COLLAPSED');
    }

    return { valid: errors.length === 0, warnings, errors };
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Helpers de conversion format
  // ═══════════════════════════════════════════════════════════════════════════

  /** [[x,y]...] → [{x,y}...] */
  toObjArray(arrPoly) {
    return arrPoly.map(([x, y]) => ({ x, y }));
  },

  /** [{x,y}...] → [[x,y]...] */
  toArrArray(objPoly) {
    return objPoly.map(p => [p.x, p.y]);
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Méthodes internes
  // ═══════════════════════════════════════════════════════════════════════════

  /** Aire signée (positive = CCW en Y-haut) */
  _signedArea(poly) {
    let s = 0;
    for (let i = 0, n = poly.length; i < n; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
      s += x1 * y2 - x2 * y1;
    }
    return s / 2;
  },

  /** Min distance d'un point à toutes les arêtes du polygone */
  _minDistToEdges(px, py, poly) {
    let minD = Infinity;
    for (let i = 0, n = poly.length; i < n; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
      const d = this.distPtSeg(px, py, x1, y1, x2, y2);
      if (d < minD) minD = d;
    }
    return minD;
  },

  /** Intersection propre de deux segments (pas juste les droites) */
  _segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
    const d1 = (x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3);
    const d2 = (x4 - x3) * (y2 - y3) - (y4 - y3) * (x2 - x3);
    const d3 = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
    const d4 = (x2 - x1) * (y4 - y1) - (y2 - y1) * (x4 - x1);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    // Colinéaires sur le segment
    if (Math.abs(d1) < 1e-10 && this._onSegment(x3, y3, x4, y4, x1, y1)) return true;
    if (Math.abs(d2) < 1e-10 && this._onSegment(x3, y3, x4, y4, x2, y2)) return true;
    if (Math.abs(d3) < 1e-10 && this._onSegment(x1, y1, x2, y2, x3, y3)) return true;
    if (Math.abs(d4) < 1e-10 && this._onSegment(x1, y1, x2, y2, x4, y4)) return true;
    return false;
  },

  /** Point p sur segment [a, b] ? */
  _onSegment(ax, ay, bx, by, px, py) {
    return Math.min(ax, bx) <= px + 1e-10 && px <= Math.max(ax, bx) + 1e-10 &&
           Math.min(ay, by) <= py + 1e-10 && py <= Math.max(ay, by) + 1e-10;
  },

  /** Extrait l'anneau extérieur d'un GeoJSON Polygon ou MultiPolygon */
  _extractRing(feature) {
    const geom = feature.geometry ?? feature;
    if (geom.type === 'Polygon')      return geom.coordinates[0];
    if (geom.type === 'MultiPolygon') return geom.coordinates[0][0];
    throw new Error(`Geometry type non supporté : ${geom.type}`);
  },
};

export { TerrainP07Adapter };
export default TerrainP07Adapter;

// Expose pour compatibilité non-module TERLAB
if (typeof window !== 'undefined') window.TerrainP07Adapter = TerrainP07Adapter;
