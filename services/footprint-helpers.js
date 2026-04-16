// terlab/services/footprint-helpers.js
// FootprintHelpers — Primitives géométriques pour bâtiments orientés / multi-blocs
// ENSA La Réunion · MGA Architecture 2026
//
// Vocabulaire :
//   - point   = { x, y }
//   - polygon = [{x,y}, ...]   (≥3 sommets, fermeture implicite)
//   - bloc    = { polygon, theta, w, l, niveaux, hauteur, areaM2 }
//   - poly2D  = [[x,y], ...]   (forme alternative utilisée par TerrainP07Adapter)
//
// Conventions :
//   - Repère local mètres, X→est, Y→nord (cohérent avec _parcelLocal et terrain-p07-adapter)
//   - Tous les polygones sont supposés simples (non auto-intersectants)
//
// Ce module ne dépend de RIEN : utilisable côté navigateur ou Node (puppeteer).

const FootprintHelpers = {

  // ── Conversions ──────────────────────────────────────────────────
  toXY(p)    { return Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y }; },
  toPair(p)  { return Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y]; },
  polyToXY(poly)   { return poly.map(p => this.toXY(p)); },
  polyToPair(poly) { return poly.map(p => this.toPair(p)); },

  // ── Aire signée (shoelace) ───────────────────────────────────────
  signedArea(poly) {
    let s = 0;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = this.toPair(poly[i]);
      const b = this.toPair(poly[(i + 1) % n]);
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  },

  area(poly) { return Math.abs(this.signedArea(poly)); },

  perimeter(poly) {
    if (!poly || poly.length < 2) return 0;
    let p = 0;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = this.toXY(poly[i]), b = this.toXY(poly[(i + 1) % n]);
      p += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return p;
  },

  // ── AABB ─────────────────────────────────────────────────────────
  aabb(poly) {
    const xs = poly.map(p => this.toXY(p).x);
    const ys = poly.map(p => this.toXY(p).y);
    const xMin = Math.min(...xs), yMin = Math.min(...ys);
    const xMax = Math.max(...xs), yMax = Math.max(...ys);
    return {
      x: xMin, y: yMin, x1: xMax, y1: yMax,
      w: xMax - xMin, l: yMax - yMin, h: yMax - yMin,
    };
  },

  // ── Centroïde (moyenne des sommets) ──────────────────────────────
  centroid(poly) {
    const n = poly.length;
    let cx = 0, cy = 0;
    for (const p of poly) { const q = this.toXY(p); cx += q.x; cy += q.y; }
    return { x: cx / n, y: cy / n };
  },

  // ── Centroïde géométrique pondéré (centre de masse) ──────────────
  centroidWeighted(poly) {
    const n = poly.length;
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < n; i++) {
      const p1 = this.toXY(poly[i]);
      const p2 = this.toXY(poly[(i + 1) % n]);
      const cross = p1.x * p2.y - p2.x * p1.y;
      a += cross;
      cx += (p1.x + p2.x) * cross;
      cy += (p1.y + p2.y) * cross;
    }
    a *= 0.5;
    if (Math.abs(a) < 1e-10) return this.centroid(poly);
    return { x: cx / (6 * a), y: cy / (6 * a) };
  },

  // ── Point dans polygone (ray casting) ────────────────────────────
  pointInPoly(px, py, poly) {
    let inside = false;
    const n = poly.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const pi = this.toXY(poly[i]);
      const pj = this.toXY(poly[j]);
      if ((pi.y > py) !== (pj.y > py)
          && px < (pj.x - pi.x) * (py - pi.y) / (pj.y - pi.y) + pi.x) {
        inside = !inside;
      }
    }
    return inside;
  },

  // ── Distance d'un point à un segment ─────────────────────────────
  distPointSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-10) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  },

  // ── Distance min d'un point au polygone (frontière) ──────────────
  minDistPointPoly(px, py, poly) {
    let dMin = Infinity;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = this.toXY(poly[i]);
      const b = this.toXY(poly[(i + 1) % n]);
      const d = this.distPointSeg(px, py, a.x, a.y, b.x, b.y);
      if (d < dMin) dMin = d;
    }
    return dMin;
  },

  // ── Distance min entre deux polygones (par sommets et arêtes) ───
  // Si les polygones se touchent / s'intersectent, retourne 0.
  minDistPolyPoly(polyA, polyB) {
    // Si un point de A est dans B (ou inverse) → 0
    for (const p of polyA) {
      const q = this.toXY(p);
      if (this.pointInPoly(q.x, q.y, polyB)) return 0;
    }
    for (const p of polyB) {
      const q = this.toXY(p);
      if (this.pointInPoly(q.x, q.y, polyA)) return 0;
    }
    // Sinon : distance sommets de A → arêtes de B et inverse
    let dMin = Infinity;
    for (const p of polyA) {
      const q = this.toXY(p);
      const d = this.minDistPointPoly(q.x, q.y, polyB);
      if (d < dMin) dMin = d;
    }
    for (const p of polyB) {
      const q = this.toXY(p);
      const d = this.minDistPointPoly(q.x, q.y, polyA);
      if (d < dMin) dMin = d;
    }
    return dMin;
  },

  // ── Sutherland-Hodgman : clip polygon (subject) par polygon convexe (clip) ──
  // Le polygone clip doit être convexe et orienté CCW.
  // Si subject n'est pas convexe, le résultat reste valide tant que l'intersection
  // par chaque demi-plan donne un polygone simple.
  clipPolygon(subject, clip) {
    if (!subject || subject.length < 3 || !clip || clip.length < 3) return [];

    // Forcer orientation CCW du clip
    let cc = clip.map(p => this.toXY(p));
    if (this.signedArea(cc) < 0) cc = cc.reverse();

    let out = subject.map(p => this.toXY(p));

    for (let i = 0; i < cc.length && out.length >= 2; i++) {
      const a = cc[i];
      const b = cc[(i + 1) % cc.length];
      // Normale rentrante du demi-plan défini par (a → b)
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-10) continue;
      const nx = -dy / len, ny = dx / len;

      out = this._clipHalfPlane(out, a, nx, ny);
      if (out.length < 3) return [];
    }
    return out;
  },

  // Clip un polygone par un demi-plan défini par un point a et la normale rentrante (nx, ny)
  // Garde les sommets P tels que (P - a)·n ≥ 0
  _clipHalfPlane(poly, a, nx, ny) {
    const out = [];
    const n = poly.length;
    if (n === 0) return out;

    const dist = (p) => (p.x - a.x) * nx + (p.y - a.y) * ny;

    for (let i = 0; i < n; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % n];
      const dp = dist(p);
      const dq = dist(q);
      const pIn = dp >= 0;
      const qIn = dq >= 0;

      if (pIn) out.push(p);
      if (pIn !== qIn) {
        const t = dp / (dp - dq);
        out.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
      }
    }
    return out;
  },

  // ── Test : polygone entièrement contenu dans un autre ───────────
  polyInPoly(inner, outer) {
    for (const p of inner) {
      const q = this.toXY(p);
      if (!this.pointInPoly(q.x, q.y, outer)) return false;
    }
    return true;
  },

  // ── Construire un rectangle dans un repère (u, v) tournée ───────
  // origin : { x, y } point du coin "sw" du rectangle dans le repère monde
  // u      : vecteur direction de la longueur (unitaire) — axe local "x"
  // v      : vecteur direction de la largeur  (unitaire) — axe local "y"
  // l      : longueur (le long de u)
  // w      : largeur  (le long de v)
  // Retourne 4 sommets {x,y} en CCW (math, Y vers le haut)
  rectFromUV(origin, u, v, l, w) {
    const o = this.toXY(origin);
    return [
      { x: o.x,                 y: o.y                 },
      { x: o.x + u.x * l,       y: o.y + u.y * l       },
      { x: o.x + u.x * l + v.x * w, y: o.y + u.y * l + v.y * w },
      { x: o.x + v.x * w,       y: o.y + v.y * w       },
    ];
  },

  // ── Rectangle centré sur un point, orienté par un angle theta (deg) ──
  // theta : rotation de l'axe LONGUEUR par rapport à l'est (X), trigonométrique
  rectCentered(cx, cy, w, l, thetaDeg) {
    const r = thetaDeg * Math.PI / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    // Demi-dimensions dans le repère local
    const hw = w / 2, hl = l / 2;
    // 4 coins en local : (-hl, -hw), (+hl, -hw), (+hl, +hw), (-hl, +hw)
    const corners = [
      [-hl, -hw], [+hl, -hw], [+hl, +hw], [-hl, +hw],
    ];
    return corners.map(([lx, ly]) => ({
      x: cx + lx * cos - ly * sin,
      y: cy + lx * sin + ly * cos,
    }));
  },

  // ── Rotation d'un polygone autour d'un point ─────────────────────
  rotatePoly(poly, cx, cy, thetaDeg) {
    const r = thetaDeg * Math.PI / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    return poly.map(p => {
      const q = this.toXY(p);
      const dx = q.x - cx, dy = q.y - cy;
      return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
    });
  },

  // ── Translation d'un polygone ────────────────────────────────────
  translatePoly(poly, dx, dy) {
    return poly.map(p => {
      const q = this.toXY(p);
      return { x: q.x + dx, y: q.y + dy };
    });
  },

  // ── OBB (Oriented Bounding Box) approchée par PCA ───────────────
  // Retourne { center, u, v, l, w, theta } où u/v sont les axes propres.
  // l = longueur le long de u (max), w = largeur le long de v.
  obb(poly) {
    const n = poly.length;
    if (n < 3) {
      return { center: { x: 0, y: 0 }, u: { x: 1, y: 0 }, v: { x: 0, y: 1 }, l: 0, w: 0, theta: 0 };
    }
    // Centroïde
    const c = this.centroidWeighted(poly);
    // Matrice de covariance 2×2
    let cxx = 0, cxy = 0, cyy = 0;
    for (const p of poly) {
      const q = this.toXY(p);
      const dx = q.x - c.x, dy = q.y - c.y;
      cxx += dx * dx;
      cxy += dx * dy;
      cyy += dy * dy;
    }
    cxx /= n; cxy /= n; cyy /= n;
    // Eigenvecteur de la plus grande valeur propre
    const trace = cxx + cyy;
    const det   = cxx * cyy - cxy * cxy;
    const disc  = Math.sqrt(Math.max(0, trace * trace / 4 - det));
    const lambdaMax = trace / 2 + disc;

    let ux, uy;
    if (Math.abs(cxy) > 1e-10) {
      ux = cxy;
      uy = lambdaMax - cxx;
    } else {
      ux = cxx >= cyy ? 1 : 0;
      uy = cxx >= cyy ? 0 : 1;
    }
    const ulen = Math.hypot(ux, uy) || 1;
    ux /= ulen; uy /= ulen;
    const vx = -uy, vy = ux;

    // Projeter tous les points sur (u, v) pour calculer l et w
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const p of poly) {
      const q = this.toXY(p);
      const dx = q.x - c.x, dy = q.y - c.y;
      const pu = dx * ux + dy * uy;
      const pv = dx * vx + dy * vy;
      if (pu < uMin) uMin = pu;
      if (pu > uMax) uMax = pu;
      if (pv < vMin) vMin = pv;
      if (pv > vMax) vMax = pv;
    }
    const l = uMax - uMin;
    const w = vMax - vMin;
    const theta = Math.atan2(uy, ux) * 180 / Math.PI;

    // Recentrer le centre OBB sur le milieu du AABB local
    const center = {
      x: c.x + ((uMin + uMax) / 2) * ux + ((vMin + vMax) / 2) * vx,
      y: c.y + ((uMin + uMax) / 2) * uy + ((vMin + vMax) / 2) * vy,
    };

    return { center, u: { x: ux, y: uy }, v: { x: vx, y: vy }, l, w, theta };
  },

  // ── Vecteur unitaire le long d'une arête ─────────────────────────
  edgeDir(poly, i) {
    const n = poly.length;
    const a = this.toXY(poly[i]);
    const b = this.toXY(poly[(i + 1) % n]);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  },

  // ── Longueurs d'arêtes ───────────────────────────────────────────
  edgeLengths(poly) {
    const n = poly.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = this.toXY(poly[i]);
      const b = this.toXY(poly[(i + 1) % n]);
      out.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
    return out;
  },

  // ── Trouver l'arête la plus longue (ou la plus longue qui n'est pas
  //     l'arête voirie). Retourne { index, length, dir, theta }.
  longestEdge(poly, excludeIdx = -1) {
    const lens = this.edgeLengths(poly);
    let best = -1, bestLen = -1;
    for (let i = 0; i < lens.length; i++) {
      if (i === excludeIdx) continue;
      if (lens[i] > bestLen) { bestLen = lens[i]; best = i; }
    }
    if (best < 0) return null;
    const dir = this.edgeDir(poly, best);
    const theta = Math.atan2(dir.y, dir.x) * 180 / Math.PI;
    return { index: best, length: bestLen, dir, theta };
  },

  // ── Helpers blocs ────────────────────────────────────────────────

  // Construire un bloc à partir d'un polygone footprint + niveaux
  makeBloc(polygon, niveaux = 1, hNiv = 3.0, theta = 0) {
    const aabb = this.aabb(polygon);
    return {
      polygon,
      theta,
      w: Math.min(aabb.w, aabb.l),  // largeur = petit côté
      l: Math.max(aabb.w, aabb.l),  // longueur = grand côté
      niveaux,
      hauteur: niveaux * hNiv,
      areaM2: this.area(polygon),
    };
  },

  // AABB d'un ensemble de polygones (union des sommets)
  aabbOfBlocs(blocs) {
    if (!blocs?.length) return { x: 0, y: 0, w: 0, l: 0 };
    const all = [];
    for (const b of blocs) {
      for (const p of (b.polygon ?? [])) all.push(this.toXY(p));
    }
    return this.aabb(all);
  },

  // Émulation de l'ancien { bat: {x,y,w,l} } depuis un proposal.blocs[]
  // Utilisé pour la rétrocompatibilité (cotations grossières, scoring legacy).
  derivedAABB(blocs) {
    const bb = this.aabbOfBlocs(blocs);
    return { x: bb.x, y: bb.y, w: bb.w, l: bb.l };
  },

  // Surface emprise totale (somme des aires de tous les blocs, sans double comptage
  // car les blocs sont supposés disjoints)
  totalArea(blocs) {
    return blocs.reduce((s, b) => s + (b.areaM2 ?? this.area(b.polygon)), 0);
  },

  // Vérifie qu'un bloc respecte une distance minimale aux autres
  // (utile dans le splitter multi-blocs).
  blocsRespectGap(blocs, gapMin) {
    for (let i = 0; i < blocs.length; i++) {
      for (let j = i + 1; j < blocs.length; j++) {
        const d = this.minDistPolyPoly(blocs[i].polygon, blocs[j].polygon);
        if (d + 1e-6 < gapMin) return false;
      }
    }
    return true;
  },

  // ── Conversion legacy bat → polygon ──────────────────────────────
  batToPolygon(bat) {
    if (!bat) return [];
    return [
      { x: bat.x,         y: bat.y         },
      { x: bat.x + bat.w, y: bat.y         },
      { x: bat.x + bat.w, y: bat.y + bat.l },
      { x: bat.x,         y: bat.y + bat.l },
    ];
  },

  // ── Lecture sécurisée d'un proposal (compat legacy + blocs[]) ────
  // Renvoie toujours { blocs, primaryPolygon, primaryBloc, aabb, bat }
  // - blocs : tableau (jamais null) — fabriqué depuis bat si nécessaire
  // - primaryPolygon : polygon du premier bloc
  // - primaryBloc : { polygon, theta, ... } premier bloc
  // - aabb : AABB de l'union des blocs
  // - bat  : forme legacy { x, y, w, l } dérivée du AABB
  readProposal(proposal) {
    if (!proposal) {
      return { blocs: [], primaryPolygon: null, primaryBloc: null, aabb: null, bat: null };
    }
    let blocs = proposal.blocs;
    if (!blocs || !blocs.length) {
      // Legacy fallback : reconstruire un bloc depuis proposal.bat ou proposal.polygon
      if (proposal.bat) {
        const polygon = this.batToPolygon(proposal.bat);
        blocs = [this.makeBloc(polygon, proposal.niveaux ?? 1)];
      } else if (proposal.polygon?.length >= 3) {
        blocs = [this.makeBloc(proposal.polygon, proposal.niveaux ?? 1)];
      } else {
        blocs = [];
      }
    }
    const primaryBloc = blocs[0] ?? null;
    const primaryPolygon = primaryBloc?.polygon ?? null;
    const aabb = blocs.length ? this.aabbOfBlocs(blocs) : null;
    const bat = aabb ? { x: aabb.x, y: aabb.y, w: aabb.w, l: aabb.l } : null;
    return { blocs, primaryPolygon, primaryBloc, aabb, bat };
  },

  /**
   * Tronque le côté aval d'un rectangle (ou polygone) pour respecter une
   * profondeur maximum mesurée selon l'azimut de la pente. Utilisé par la
   * stratégie Isohypses : la profondeur du bâtiment perpendiculaire aux
   * courbes de niveau est plafonnée par TopoCaseService.profMax.
   *
   * Le clamp est appliqué dans le repère local mètres. azimut_deg est la
   * direction de la pente (0=Nord, 90=Est, sens horaire compass), et le
   * "côté aval" est le côté le plus avancé dans cette direction.
   *
   * Cas X-est, Y-nord (espace TerrainP07Adapter local) :
   *   downX = sin(az), downY = cos(az)  ← pas de signe inversé
   * Cas X-est, Y-sud (espace SVG) :
   *   downX = sin(az), downY = -cos(az) ← inverser le signe Y
   * Le helper retourne par défaut le repère local mètres (Y-nord).
   *
   * @param {Array<{x,y}>} rect    polygone à tronquer (≥ 3 sommets)
   * @param {number} azimut_deg    direction aval en degrés compass
   * @param {number} profMax_m     profondeur maximum (m, le long de l'axe pente)
   * @param {Object} [opts]        { ySouth: true → repère SVG Y-down }
   * @returns {Array<{x,y}>}
   */
  clampRectProfMaxAlongAzimut(rect, azimut_deg, profMax_m, opts = {}) {
    if (!rect || rect.length < 3) return rect;
    if (!Number.isFinite(profMax_m) || profMax_m <= 0) return rect;
    const az = azimut_deg * Math.PI / 180;
    const ySign = opts.ySouth ? -1 : 1;
    const downX = Math.sin(az);
    const downY = Math.cos(az) * ySign;
    const projs = rect.map(p => p.x * downX + p.y * downY);
    const pMin = Math.min(...projs), pMax = Math.max(...projs);
    const totalDepth = pMax - pMin;
    if (totalDepth <= profMax_m + 1e-6) return rect;
    const targetMax = pMin + profMax_m;
    return rect.map((p, i) => {
      if (projs[i] > targetMax) {
        // Reculer ce sommet vers l'amont, le long de la direction pente
        const delta = targetMax - projs[i]; // négatif
        return { x: p.x + delta * downX, y: p.y + delta * downY };
      }
      return { x: p.x, y: p.y };
    });
  },

  // ── L-shape centré (6 sommets) ────────────────────────────────────
  // Génère un footprint en L par retrait d'un coin d'un rectangle.
  // corner : 'NE'|'NW'|'SE'|'SW' — coin retiré dans le repère local
  // wMajor/lMajor : dimensions du rectangle englobant
  // wMinor/lMinor : dimensions de l'aile secondaire (la partie qui reste
  //   quand on retire le coin). wMinor < wMajor, lMinor < lMajor.
  // Retourne 6 points en CCW (repère math Y-nord), orientés par thetaDeg.
  lShapeCentered(cx, cy, wMajor, lMajor, wMinor, lMinor, thetaDeg, corner = 'NE') {
    const hw = wMajor / 2, hl = lMajor / 2;
    // Rectangle englobant en local : (-hl, -hw) → (+hl, +hw)
    // On retire le coin spécifié
    let pts;
    const wCut = wMajor - wMinor;
    const lCut = lMajor - lMinor;
    switch (corner) {
      case 'NE': // retrait en haut-droite
        pts = [[-hl,-hw],[hl,-hw],[hl,hw-wCut],[hl-lCut,hw-wCut],[hl-lCut,hw],[-hl,hw]];
        break;
      case 'NW': // retrait en haut-gauche
        pts = [[-hl,-hw],[hl,-hw],[hl,hw],[-hl+lCut,hw],[-hl+lCut,hw-wCut],[-hl,hw-wCut]];
        break;
      case 'SE': // retrait en bas-droite
        pts = [[-hl,-hw],[hl-lCut,-hw],[hl-lCut,-hw+wCut],[hl,-hw+wCut],[hl,hw],[-hl,hw]];
        break;
      case 'SW': // retrait en bas-gauche
        pts = [[-hl,-hw],[-hl+lCut,-hw],[-hl+lCut,-hw+wCut],[-hl,-hw+wCut],[-hl,hw],[hl,hw],[hl,-hw]];
        // Correction : SW a 7 points, simplifions
        pts = [[-hl,-hw+wCut],[-hl+lCut,-hw+wCut],[-hl+lCut,-hw],[hl,-hw],[hl,hw],[-hl,hw]];
        break;
      default:
        pts = [[-hl,-hw],[hl,-hw],[hl,hw-wCut],[hl-lCut,hw-wCut],[hl-lCut,hw],[-hl,hw]];
    }
    const r = thetaDeg * Math.PI / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    return pts.map(([lx, ly]) => ({
      x: cx + lx * cos - ly * sin,
      y: cy + lx * sin + ly * cos,
    }));
  },

  // ── Trapézoïde centré (4 sommets) ──────────────────────────────────
  // Parallèle à l'axe thetaDeg, le côté "début" a largeur wStart,
  // le côté "fin" a largeur wEnd. Profondeur = l.
  trapezoidCentered(cx, cy, wStart, wEnd, l, thetaDeg) {
    const hl = l / 2;
    const hw0 = wStart / 2, hw1 = wEnd / 2;
    // En local : début = -hl, fin = +hl
    const pts = [
      [-hl, -hw0], [hl, -hw1], [hl, hw1], [-hl, hw0],
    ];
    const r = thetaDeg * Math.PI / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    return pts.map(([lx, ly]) => ({
      x: cx + lx * cos - ly * sin,
      y: cy + lx * sin + ly * cos,
    }));
  },

  // ── Hull from zone (épouse zone avec surface cible) ────────────────
  // Prend l'enveloppe constructible et retourne un polygone adapté
  // qui respecte une surface cible (areaCap).
  // Si l'enveloppe est plus petite que areaCap, retourne l'enveloppe insettée.
  // Si plus grande, inset progressif jusqu'à atteindre la surface cible.
  hullFromZone(envXY, wallRetreat = 0.5, areaCap = Infinity) {
    if (!envXY || envXY.length < 3) return [];
    let clipped = envXY.map(p => ({ x: p.x, y: p.y }));

    // Inset mur
    if (wallRetreat > 0.01) {
      const orient = this.signedArea(envXY) >= 0 ? 1 : -1;
      const n = envXY.length;
      for (let i = 0; i < n; i++) {
        const a = envXY[i];
        const b = envXY[(i + 1) % n];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len * orient;
        const ny =  dx / len * orient;
        const px = a.x + nx * wallRetreat;
        const py = a.y + ny * wallRetreat;
        clipped = this._clipHalfPlane(clipped, { x: px, y: py }, nx, ny);
        if (clipped.length < 3) return [];
      }
    }

    // Si la surface dépasse areaCap, inset uniforme progressif
    let area = this.area(clipped);
    if (area > areaCap && areaCap > 0) {
      let retreat = 0.5;
      for (let iter = 0; iter < 20 && area > areaCap * 1.02; iter++) {
        const orient = this.signedArea(clipped) >= 0 ? 1 : -1;
        const n = clipped.length;
        let shrunk = clipped.map(p => ({ ...p }));
        for (let i = 0; i < n; i++) {
          const a = clipped[i];
          const b = clipped[(i + 1) % n];
          const dx = b.x - a.x, dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len * orient;
          const ny =  dx / len * orient;
          const px = a.x + nx * retreat;
          const py = a.y + ny * retreat;
          shrunk = this._clipHalfPlane(shrunk, { x: px, y: py }, nx, ny);
          if (shrunk.length < 3) break;
        }
        if (shrunk.length >= 3) {
          clipped = shrunk;
          area = this.area(clipped);
        } else {
          break;
        }
        retreat *= 0.8;
      }
    }

    return clipped.length >= 3 ? clipped : [];
  },

  // ═══════════════════════════════════════════════════════════════════
  // ── v4h geometry — portage depuis terlab_parcelles_v4h.html ────────
  // Primitives additionnelles pour zone constructible fidèle au PLU,
  // largest inscribed rectangle, partition bi-volume L, et arcs concaves.
  // API additive : les méthodes existantes ne sont pas modifiées.
  // ═══════════════════════════════════════════════════════════════════

  // Test de convexité (signe constant du produit vectoriel successif)
  isConvex(poly) {
    const n = poly.length;
    if (n < 4) return true;
    let sign = 0;
    for (let i = 0; i < n; i++) {
      const a = this.toXY(poly[i]);
      const b = this.toXY(poly[(i + 1) % n]);
      const c = this.toXY(poly[(i + 2) % n]);
      const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cr) < 1e-6) continue;
      const s = cr > 0 ? 1 : -1;
      if (!sign) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  },

  // Normale entrante sur l'arête i (unitaire). Gère CCW ou CW.
  edgeNormalIn(poly, i) {
    const n = poly.length;
    const a = this.toXY(poly[i]);
    const b = this.toXY(poly[(i + 1) % n]);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.1) return { nx: 0, ny: 0 };
    const cw = this.signedArea(poly) > 0 ? 1 : -1;
    return { nx: cw * (-dy / len), ny: cw * (dx / len) };
  },

  // Bande de recul sur l'arête i à distance r (mètres) — quad 4 sommets
  // orientée vers l'intérieur. Retourne null si recul nul ou arête dégénérée.
  bandPoly(poly, i, r) {
    if (!r || r <= 0) return null;
    const n = poly.length;
    const p1 = this.toXY(poly[i]);
    const p2 = this.toXY(poly[(i + 1) % n]);
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    if (Math.hypot(dx, dy) < 0.1) return null;
    const { nx, ny } = this.edgeNormalIn(poly, i);
    return [
      { x: p1.x,           y: p1.y           },
      { x: p2.x,           y: p2.y           },
      { x: p2.x + nx * r,  y: p2.y + ny * r  },
      { x: p1.x + nx * r,  y: p1.y + ny * r  },
    ];
  },

  // Zone constructible — voie polygonale (convex rapide / concave raster)
  // reculs : tableau de longueur poly.length, valeurs en mètres (0 = mitoyen)
  // opts   : { cellSize: 0.42 } pour raster
  buildZone(poly, reculs, opts = {}) {
    if (!poly || poly.length < 3) return [];
    if (this.isConvex(poly)) return this._buildZoneConvex(poly, reculs);
    return this._buildZoneRaster(poly, reculs, opts.cellSize ?? 0.42);
  },

  // Zone constructible convexe — clipping successif par demi-plan entrant
  // à distance r de chaque arête. Réutilise _clipHalfPlane existant.
  _buildZoneConvex(poly, reculs) {
    const n = poly.length;
    let zone = poly.map(p => this.toXY(p));
    for (let i = 0; i < n; i++) {
      const r = reculs[i];
      if (!r || r <= 0) continue;
      const p1 = this.toXY(poly[i]);
      const { nx, ny } = this.edgeNormalIn(poly, i);
      // Demi-plan : côté intérieur à distance r → point ancre = p1 + n*r
      const anchor = { x: p1.x + nx * r, y: p1.y + ny * r };
      zone = this._clipHalfPlane(zone, anchor, nx, ny);
      if (zone.length < 3) return [];
    }
    return zone;
  },

  // Zone constructible concave — rasterisation + composante connexe max
  // Retourne le contour du plus grand blob de cellules "dedans ET hors bandes".
  _buildZoneRaster(poly, reculs, cellSize = 0.42) {
    const n = poly.length;
    const bands = reculs.map((r, i) => this.bandPoly(poly, i, r));
    const xs = poly.map(p => this.toXY(p).x);
    const ys = poly.map(p => this.toXY(p).y);
    const x0 = Math.min(...xs) - 2, x1 = Math.max(...xs) + 2;
    const y0 = Math.min(...ys) - 2, y1 = Math.max(...ys) + 2;
    const W = Math.max(20, Math.ceil((x1 - x0) / cellSize));
    const H = Math.max(20, Math.ceil((y1 - y0) / cellSize));
    const ddx = (x1 - x0) / W, ddy = (y1 - y0) / H;
    const grid = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const px = x0 + (i + 0.5) * ddx;
        const py = y0 + (j + 0.5) * ddy;
        if (!this.pointInPoly(px, py, poly)) continue;
        let inBand = false;
        for (const b of bands) {
          if (b && this.pointInPoly(px, py, b)) { inBand = true; break; }
        }
        if (!inBand) grid[j * W + i] = 1;
      }
    }
    // Composante connexe max (BFS 4-voisins)
    const lbl = new Int32Array(W * H);
    const sizes = [0];
    let nL = 0;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (!grid[j * W + i] || lbl[j * W + i]) continue;
        nL++; sizes.push(0);
        const stk = [[i, j]];
        while (stk.length) {
          const [ci, cj] = stk.pop();
          if (ci < 0 || ci >= W || cj < 0 || cj >= H) continue;
          if (!grid[cj * W + ci] || lbl[cj * W + ci]) continue;
          lbl[cj * W + ci] = nL;
          sizes[nL]++;
          stk.push([ci + 1, cj], [ci - 1, cj], [ci, cj + 1], [ci, cj - 1]);
        }
      }
    }
    if (!nL) return [];
    let best = 1;
    for (let k = 2; k <= nL; k++) if (sizes[k] > sizes[best]) best = k;
    const mask = new Uint8Array(W * H);
    for (let k = 0; k < W * H; k++) mask[k] = lbl[k] === best ? 1 : 0;
    return this._gridToPoly(mask, W, H, x0, y0, ddx, ddy);
  },

  // Contour d'une grille binaire par traçage des arêtes frontières,
  // puis chaînage en polygone unique (simple boundary walk).
  _gridToPoly(mask, W, H, x0, y0, ddx, ddy) {
    const edges = new Map();
    const key = (x, y) => `${x.toFixed(3)}|${y.toFixed(3)}`;
    const addEdge = (ax, ay, bx, by) => {
      const k = key(ax, ay);
      if (!edges.has(k)) edges.set(k, []);
      edges.get(k).push({ x: bx, y: by });
    };
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (!mask[j * W + i]) continue;
        const xL = x0 + i * ddx,       xR = x0 + (i + 1) * ddx;
        const yB = y0 + j * ddy,       yT = y0 + (j + 1) * ddy;
        // Arête bas : voisin (i, j-1) hors
        if (j === 0 || !mask[(j - 1) * W + i]) addEdge(xR, yB, xL, yB);
        // Arête haut : voisin (i, j+1) hors
        if (j === H - 1 || !mask[(j + 1) * W + i]) addEdge(xL, yT, xR, yT);
        // Arête gauche : voisin (i-1, j) hors
        if (i === 0 || !mask[j * W + (i - 1)]) addEdge(xL, yB, xL, yT);
        // Arête droite : voisin (i+1, j) hors
        if (i === W - 1 || !mask[j * W + (i + 1)]) addEdge(xR, yT, xR, yB);
      }
    }
    if (!edges.size) return [];
    // Chaîner : partir du premier sommet, suivre les arêtes
    const firstKey = edges.keys().next().value;
    const [fx, fy] = firstKey.split('|').map(Number);
    const poly = [{ x: fx, y: fy }];
    let curKey = firstKey;
    const maxSteps = edges.size * 4;
    for (let step = 0; step < maxSteps; step++) {
      const nexts = edges.get(curKey);
      if (!nexts || !nexts.length) break;
      const next = nexts.shift();
      if (!nexts.length) edges.delete(curKey);
      const nk = key(next.x, next.y);
      if (nk === key(fx, fy)) break;
      poly.push({ x: next.x, y: next.y });
      curKey = nk;
    }
    // Simplification colinéaire
    return this._simplifyCollinear(poly, 1e-4);
  },

  // ── v4h constructive patterns ────────────────────────────────────
  // Porté depuis terlab_parcelles_v4h.html (MGA 2026). Unités : mètres.
  // Les fonctions opèrent sur des listes de polygones (bat) pour gérer
  // uniformément blocs simples et multi-blocs.

  // Supprime itérativement les sommets créant des angles aigus (< minDeg°).
  // Nettoie les pointes parasites produites par les offsets inset sur des
  // arêtes courtes avec reculs hétérogènes. Boucle max poly.length × 4.
  // Retourne le polygone original si la réduction dégénère en < 3 sommets.
  rmSpikes(poly, minDeg = 90) {
    if (!poly || poly.length < 3) return poly;
    const th = Math.cos(minDeg * Math.PI / 180);
    let pts = poly.map(p => this.toXY(p));
    let changed = true, safety = pts.length * 4;
    while (changed && safety-- > 0 && pts.length >= 4) {
      changed = false;
      const ccw = this.signedArea(pts) > 0;
      const kept = [];
      for (let i = 0; i < pts.length; i++) {
        const pp = pts[(i - 1 + pts.length) % pts.length];
        const p  = pts[i];
        const pn = pts[(i + 1) % pts.length];
        const v1x = pp.x - p.x, v1y = pp.y - p.y;
        const v2x = pn.x - p.x, v2y = pn.y - p.y;
        const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
        if (l1 < 0.05 || l2 < 0.05) { kept.push(p); continue; }
        const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
        const cr  = v1x * v2y - v1y * v2x;
        if ((ccw ? cr > 0 : cr < 0) && dot > th + 1e-4) changed = true;
        else kept.push(p);
      }
      if (changed) pts = kept;
    }
    return pts.length >= 3 ? pts : poly;
  },

  // Longueur cumulée (mètres) des façades bâtiment alignées sur les arêtes
  // de la parcelle marquées mitoyennes (recul = 0 ET edgeType = 'lat').
  // Critères d'alignement : distance perpendiculaire des 2 sommets de façade
  // à l'arête parcelle < 0.5m, ET projections dans [0, L_arête].
  // bat : Array<Polygon>, chaque polygone = Array<{x,y}>.
  lMitFacade(bat, parc, reculs, edgeTypes) {
    if (!bat || !reculs || !edgeTypes) return 0;
    const n = parc.length, EPS = 0.5;
    let total = 0;
    for (let i = 0; i < n; i++) {
      if (reculs[i] !== 0 || edgeTypes[i] !== 'lat') continue;
      const a = this.toXY(parc[i]);
      const b = this.toXY(parc[(i + 1) % n]);
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      if (len < 0.1) continue;
      const tx = dx / len, ty = dy / len;
      const nx = -ty, ny = tx;
      for (const poly of bat) {
        if (!poly || poly.length < 3) continue;
        for (let k = 0; k < poly.length; k++) {
          const p1 = this.toXY(poly[k]);
          const p2 = this.toXY(poly[(k + 1) % poly.length]);
          const d1 = Math.abs((p1.x - a.x) * nx + (p1.y - a.y) * ny);
          const d2 = Math.abs((p2.x - a.x) * nx + (p2.y - a.y) * ny);
          if (d1 > EPS || d2 > EPS) continue;
          const t1 = (p1.x - a.x) * tx + (p1.y - a.y) * ty;
          const t2 = (p2.x - a.x) * tx + (p2.y - a.y) * ty;
          const tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
          if (tmax < 0 || tmin > len) continue;
          total += Math.max(0, Math.min(len, tmax) - Math.max(0, tmin));
        }
      }
    }
    return total;
  },

  // Pousse les sommets "proches" d'une arête mitoyenne recul=0 vers l'extérieur
  // selon la normale sortante, puis re-clippe contre l'enveloppe (côté appelant).
  // Effet net : le bâtiment vient se coller à la limite mitoyenne.
  // bat : Array<Polygon>, renvoie Array<Polygon> (peut filtrer les dégénérés).
  // envZone : (optionnel) enveloppe constructible pour re-clip automatique.
  expandToMit(bat, parc, reculs, edgeTypes, envZone = null) {
    if (!bat || !bat.length) return bat;
    if (!reculs.some((r, i) => r === 0 && edgeTypes[i] === 'lat')) return bat;
    const n = parc.length;
    const EXP = 50;       // mètres ; grande distance, clip ramènera à la limite
    const THRESH = 0.5;   // mètres : seuil de proximité au bord mitoyen
    let res = bat.map(poly => poly ? poly.map(p => ({ ...this.toXY(p) })) : null);

    for (let i = 0; i < n; i++) {
      if (reculs[i] !== 0 || edgeTypes[i] !== 'lat') continue;
      const { nx, ny } = this.edgeNormalIn(parc, i);
      const oX = -nx, oY = -ny;   // sortante = opposée de la normale intérieure
      const p1 = this.toXY(parc[i]);
      res = res.map(poly => {
        if (!poly || poly.length < 3) return poly;
        const dists = poly.map(p => (p.x - p1.x) * nx + (p.y - p1.y) * ny);
        const mn = Math.min(...dists);
        return poly.map((p, k) => dists[k] <= mn + THRESH
          ? { x: p.x + oX * EXP, y: p.y + oY * EXP }
          : p);
      }).filter(Boolean);
    }

    // Clip contre l'enveloppe constructible si fournie — sinon à la parcelle
    const clipper = envZone && envZone.length >= 3 ? envZone : parc;
    res = res
      .map(poly => this.clipPolygon(poly, clipper.map(p => this.toXY(p))))
      .filter(p => p && p.length >= 3 && this.area(p) > 1);
    return res;
  },

  // Clampe la profondeur d'un rect orienté selon l'azimut de pente.
  // Projette chaque sommet sur l'axe de pente (dx, dy) ; si l'étalement excède
  // profMax, décale les sommets au-delà de (pMin + profMax) vers l'amont.
  // Utile pour la stratégie isohypses : limite la profondeur bâtiment par
  // rapport au terrain (contrainte topographique RTAA DOM).
  clampProf(rect, azimut_deg, profMax) {
    if (!rect || rect.length < 3) return rect;
    const azR = azimut_deg * Math.PI / 180;
    const dx = Math.sin(azR), dy = -Math.cos(azR);
    const proj = rect.map(p => p.x * dx + p.y * dy);
    const pMin = Math.min(...proj), pMax2 = Math.max(...proj);
    if (pMax2 - pMin <= profMax) return rect;
    const tgt = pMin + profMax;
    return rect.map((p, i) => proj[i] > tgt
      ? { x: p.x + (tgt - proj[i]) * dx, y: p.y + (tgt - proj[i]) * dy }
      : p);
  },

  // Retire les sommets colinéaires (tolérance en mètres²)
  _simplifyCollinear(poly, tol = 1e-4) {
    if (poly.length < 4) return poly;
    const out = [];
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[(i - 1 + n) % n];
      const b = poly[i];
      const c = poly[(i + 1) % n];
      const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cr) > tol) out.push(b);
    }
    return out.length >= 3 ? out : poly;
  },

  // Plus grand rectangle axis-aligned inscrit dans un polygone (grille + histogramme).
  // gridW/H : résolution (défaut 48 = compromis vitesse/précision).
  maxInscribedAABB(zone, gridW = 48, gridH = 48) {
    if (!zone || zone.length < 3) return null;
    const xs = zone.map(p => this.toXY(p).x);
    const ys = zone.map(p => this.toXY(p).y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const W = gridW, H = gridH;
    const ddx = (x1 - x0) / W, ddy = (y1 - y0) / H;
    const grid = [];
    for (let j = 0; j < H; j++) {
      const row = new Uint8Array(W);
      for (let i = 0; i < W; i++) {
        const px = x0 + (i + 0.5) * ddx;
        const py = y0 + (j + 0.5) * ddy;
        row[i] = this.pointInPoly(px, py, zone) ? 1 : 0;
      }
      grid.push(row);
    }
    // Largest rectangle in histogram, ligne par ligne
    const hist = new Array(W).fill(0);
    let best = { area: 0, x: 0, y: 0, w: 0, h: 0 };
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) hist[i] = grid[j][i] ? hist[i] + 1 : 0;
      const stk = [];
      for (let i = 0; i <= W; i++) {
        const cur = i < W ? hist[i] : 0;
        while (stk.length && hist[stk[stk.length - 1]] > cur) {
          const top = stk.pop();
          const width = stk.length ? i - stk[stk.length - 1] - 1 : i;
          const area = width * hist[top];
          if (area > best.area) {
            best = {
              area,
              x: stk.length ? stk[stk.length - 1] + 1 : 0,
              y: j - hist[top] + 1,
              w: width,
              h: hist[top],
            };
          }
        }
        stk.push(i);
      }
    }
    if (!best.area) return null;
    const rx0 = x0 + best.x * ddx, ry0 = y0 + best.y * ddy;
    return [
      { x: rx0,                 y: ry0                 },
      { x: rx0 + best.w * ddx,  y: ry0                 },
      { x: rx0 + best.w * ddx,  y: ry0 + best.h * ddy  },
      { x: rx0,                 y: ry0 + best.h * ddy  },
    ];
  },

  // Plus grand rectangle inscrit orienté selon theta (radians).
  maxInscribedRotAABB(zone, thetaRad, gridW = 48, gridH = 48) {
    if (!zone || zone.length < 3) return null;
    const c = this.centroid(zone);
    const rotated = this.rotatePoly(zone, c.x, c.y, -thetaRad * 180 / Math.PI);
    const r = this.maxInscribedAABB(rotated, gridW, gridH);
    if (!r) return null;
    return this.rotatePoly(r, c.x, c.y, thetaRad * 180 / Math.PI);
  },

  // Bi-volume L : partitionne la zone en deux rectangles (top/bot ou lf/rt)
  // selon la coupe axiale qui maximise la somme des aires.
  // minDimM : dimension minimale d'un rectangle (défaut 5 m)
  // gapM    : entrefer mini entre blocs (défaut 3 m)
  maxLShape(zone, minDimM = 5, gapM = 3) {
    if (!zone || zone.length < 3) return null;
    const xs = zone.map(p => this.toXY(p).x);
    const ys = zone.map(p => this.toXY(p).y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const HG = gapM / 2, PAD = 1000;
    const minDim = (r) => {
      if (!r || r.length < 3) return 0;
      const xx = r.map(p => p.x), yy = r.map(p => p.y);
      return Math.min(Math.max(...xx) - Math.min(...xx), Math.max(...yy) - Math.min(...yy));
    };
    const valid = (r) => r && r.length >= 3 && minDim(r) >= minDimM;
    const base = this.maxInscribedAABB(zone);
    let best = { rects: valid(base) ? [base] : null, area: valid(base) ? this.area(base) : 0 };
    const tryPair = (r1, r2) => {
      const v1 = valid(r1), v2 = valid(r2);
      if (!v1 && !v2) return;
      if (v1 && !v2) { const a = this.area(r1); if (a > best.area * 1.02) best = { rects: [r1], area: a }; return; }
      if (!v1 && v2) { const a = this.area(r2); if (a > best.area * 1.02) best = { rects: [r2], area: a }; return; }
      const a = this.area(r1) + this.area(r2);
      if (a > best.area * 1.02) best = { rects: [r1, r2], area: a };
    };
    // Coupes horizontales (candidats = sommets Y + milieu)
    const ySet = new Set(ys.map(y => +y.toFixed(1))); ySet.add((y0 + y1) / 2);
    for (const ysp of ySet) {
      if (ysp <= y0 + minDimM + HG || ysp >= y1 - minDimM - HG) continue;
      const top = this.clipPolygon(zone, [
        { x: x0 - PAD, y: y0 - PAD }, { x: x1 + PAD, y: y0 - PAD },
        { x: x1 + PAD, y: ysp - HG }, { x: x0 - PAD, y: ysp - HG },
      ]);
      const bot = this.clipPolygon(zone, [
        { x: x0 - PAD, y: ysp + HG }, { x: x1 + PAD, y: ysp + HG },
        { x: x1 + PAD, y: y1 + PAD }, { x: x0 - PAD, y: y1 + PAD },
      ]);
      tryPair(
        top && top.length >= 3 ? this.maxInscribedAABB(top) : null,
        bot && bot.length >= 3 ? this.maxInscribedAABB(bot) : null,
      );
    }
    // Coupes verticales
    const xSet = new Set(xs.map(x => +x.toFixed(1))); xSet.add((x0 + x1) / 2);
    for (const xsp of xSet) {
      if (xsp <= x0 + minDimM + HG || xsp >= x1 - minDimM - HG) continue;
      const lf = this.clipPolygon(zone, [
        { x: x0 - PAD, y: y0 - PAD }, { x: xsp - HG, y: y0 - PAD },
        { x: xsp - HG, y: y1 + PAD }, { x: x0 - PAD, y: y1 + PAD },
      ]);
      const rt = this.clipPolygon(zone, [
        { x: xsp + HG, y: y0 - PAD }, { x: x1 + PAD, y: y0 - PAD },
        { x: x1 + PAD, y: y1 + PAD }, { x: xsp + HG, y: y1 + PAD },
      ]);
      tryPair(
        lf && lf.length >= 3 ? this.maxInscribedAABB(lf) : null,
        rt && rt.length >= 3 ? this.maxInscribedAABB(rt) : null,
      );
    }
    return best.rects;
  },

  // Règle de prospect H/2 : distance min du bâti à chaque arête non mitoyenne
  // et non-voie du polygone parcelle doit être ≥ hauteur / 2.
  // Retourne { ok, violations: [{ edgeIndex, need, got, excess }] }.
  // parcPoly   : polygone parcelle (mètres)
  // edgeTypes  : tableau 'voie'|'fond'|'lat' par arête
  // mitoyenFlags : tableau bool par arête (true = mitoyen = exempt du H/2)
  // bldgPoly   : polygone bâti (footprint unique ou union)
  // hauteurM   : hauteur du bâtiment en m
  checkProspectH2(parcPoly, edgeTypes, mitoyenFlags, bldgPoly, hauteurM) {
    if (!parcPoly || parcPoly.length < 3 || !bldgPoly || bldgPoly.length < 3) {
      return { ok: true, violations: [] };
    }
    const need = hauteurM / 2;
    const n = parcPoly.length;
    const violations = [];
    for (let i = 0; i < n; i++) {
      const type = edgeTypes?.[i] ?? 'lat';
      if (type === 'voie' || type === 'fond') continue; // exemptés (règle voie/fond propre)
      if (mitoyenFlags?.[i]) continue; // mitoyen exempt
      const a = this.toXY(parcPoly[i]);
      const b = this.toXY(parcPoly[(i + 1) % n]);
      let dMin = Infinity;
      for (const p of bldgPoly) {
        const q = this.toXY(p);
        const d = this.distPointSeg(q.x, q.y, a.x, a.y, b.x, b.y);
        if (d < dMin) dMin = d;
      }
      if (dMin < need - 1e-3) {
        violations.push({
          edgeIndex: i,
          edgeType: type,
          need: +need.toFixed(2),
          got: +dMin.toFixed(2),
          excess: +(need - dMin).toFixed(2),
        });
      }
    }
    return { ok: violations.length === 0, violations };
  },

  // Arcs de transition concaves — rendu PLU des coins rentrants.
  // Retourne une liste d'objets { arcPts, secPts, am } pour chaque coin concave.
  // nSeg = nombre de segments d'approximation de l'arc (défaut 18).
  concaveArcs(poly, reculs, nSeg = 18) {
    const n = poly.length;
    const sa = this.signedArea(poly);
    const res = [];
    const norms = poly.map((_, i) => this.edgeNormalIn(poly, i));
    for (let k = 0; k < n; k++) {
      const ip = (k - 1 + n) % n;
      const rP = reculs[ip] || 0, rN = reculs[k] || 0;
      if (!rP || !rN) continue;
      const pp = this.toXY(poly[(k - 1 + n) % n]);
      const pc = this.toXY(poly[k]);
      const pn = this.toXY(poly[(k + 1) % n]);
      const ex1 = pc.x - pp.x, ey1 = pc.y - pp.y;
      const ex2 = pn.x - pc.x, ey2 = pn.y - pc.y;
      const cr = ex1 * ey2 - ey1 * ex2;
      // Coin concave : signe opposé à l'orientation globale
      if (!(sa < 0 ? cr > 0 : cr < 0)) continue;
      const nP = norms[ip], nN = norms[k];
      if (!nP || (!nP.nx && !nP.ny)) continue;
      const R = Math.min(rP, rN);
      const angS = Math.atan2(nP.ny, nP.nx);
      const angE = Math.atan2(nN.ny, nN.nx);
      let delta = angE - angS;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta <= -Math.PI) delta += 2 * Math.PI;
      if (sa < 0 && delta < 0) delta += 2 * Math.PI;
      if (sa > 0 && delta > 0) delta -= 2 * Math.PI;
      if (Math.abs(delta) > Math.PI * 1.9 || Math.abs(delta) < 0.01) continue;
      const arcPts = [];
      const secPts = [{ ...pc }];
      for (let s = 0; s <= nSeg; s++) {
        const a = angS + delta * s / nSeg;
        const p = { x: pc.x + R * Math.cos(a), y: pc.y + R * Math.sin(a) };
        arcPts.push(p);
        secPts.push(p);
      }
      const am = Math.abs(delta) / 2 * R * R;
      res.push({
        arcPts, secPts, am,
        cx: secPts.reduce((s, p) => s + p.x, 0) / secPts.length,
        cy: secPts.reduce((s, p) => s + p.y, 0) / secPts.length,
      });
    }
    return res;
  },

  // ── Axe de profondeur voie → fond ─────────────────────────────────
  // Retourne un vecteur unitaire {x,y} dirigé depuis la façade voie
  // vers la façade fond. Sans connaissance explicite de la voie, on
  // prend l'arête de plus grande moyenne Y comme voie (convention
  // SVG Y↓) par défaut. En repère métrique Y↑ (par ex. TERLAB engine),
  // passer { voieIsMinY: true }.
  polyDepthAxis(poly, opts = {}) {
    if (!poly || poly.length < 3) return { x: 0, y: -1 };
    const voieIsMinY = !!opts.voieIsMinY;
    const n = poly.length;
    let vMid = null, fMid = null, bestV = -Infinity, bestF = Infinity;
    for (let i = 0; i < n; i++) {
      const a = this.toXY(poly[i]), b = this.toXY(poly[(i + 1) % n]);
      const my = (a.y + b.y) / 2, mx = (a.x + b.x) / 2;
      const vKey = voieIsMinY ? -my : my;
      if (vKey > bestV) { bestV = vKey; vMid = { x: mx, y: my }; }
      if (vKey < bestF) { bestF = vKey; fMid = { x: mx, y: my }; }
    }
    if (!vMid || !fMid) return { x: 0, y: -1 };
    const dx = fMid.x - vMid.x, dy = fMid.y - vMid.y, len = Math.hypot(dx, dy);
    if (len < 0.5) return { x: 0, y: -1 };
    return { x: dx / len, y: dy / len };
  },

  // ── Intersection ligne de coupe / polygone ────────────────────────
  // Pour un axis unitaire et une fraction t∈[0,1] le long de l'axe,
  // retourne le segment [pIn, pOut] de la ligne de coupe perpendiculaire
  // à axis, restreinte au polygone. Null si <2 intersections.
  cutLineInPoly(poly, axis, t) {
    if (!poly || poly.length < 3) return null;
    const xy = poly.map(p => this.toXY(p));
    const projs = xy.map(p => p.x * axis.x + p.y * axis.y);
    const pMin = Math.min(...projs), pMax = Math.max(...projs), total = pMax - pMin;
    if (total < 0.5) return null;
    const cut = pMin + total * t, pts = [];
    for (let i = 0; i < xy.length; i++) {
      const j = (i + 1) % xy.length, pi = projs[i], pj = projs[j];
      if (Math.abs(pj - pi) < 1e-8) continue;
      if ((pi - cut) * (pj - cut) <= 0) {
        const tE = (cut - pi) / (pj - pi);
        pts.push({
          x: xy[i].x + (xy[j].x - xy[i].x) * tE,
          y: xy[i].y + (xy[j].y - xy[i].y) * tE,
        });
      }
    }
    const uniq = pts.filter((p, k) => k === 0 || Math.hypot(p.x - pts[k - 1].x, p.y - pts[k - 1].y) > 0.01);
    return uniq.length >= 2 ? [uniq[0], uniq[uniq.length - 1]] : null;
  },

  // ── Clip d'une bande (profondeur t0..t1) ──────────────────────────
  // Extrait la tranche du polygone entre les fractions t0 et t1 le long
  // de l'axe. Polygone convexe → double half-plane (SH, rapide et exact).
  // Polygone non-convexe → fallback raster (coupure peut séparer en
  // composantes disjointes, SH les souderait artificiellement).
  clipToBand(poly, axis, t0, t1, opts = {}) {
    if (!poly || poly.length < 3 || t1 <= t0) return null;
    const xy = poly.map(p => this.toXY(p));
    const projs = xy.map(p => p.x * axis.x + p.y * axis.y);
    const pMin = Math.min(...projs), pMax = Math.max(...projs), total = pMax - pMin;
    if (total < 0.5) return null;
    const cut0 = pMin + total * t0, cut1 = pMin + total * t1;
    if (!this.isConvex(xy)) return this._clipToBandRaster(xy, axis, cut0, cut1, opts.cellSize ?? 0.30);
    const perp = { x: -axis.y, y: axis.x }, BIG = 1500;
    const cx = xy.reduce((s, p) => s + p.x, 0) / xy.length;
    const cy = xy.reduce((s, p) => s + p.y, 0) / xy.length;
    const pC = cx * axis.x + cy * axis.y;
    let out = xy.slice();
    const halfPlane = (cut, keepPositive) => {
      const d = cut - pC;
      const c0x = cx + axis.x * d, c0y = cy + axis.y * d;
      const a = { x: c0x - perp.x * BIG, y: c0y - perp.y * BIG };
      const b = { x: c0x + perp.x * BIG, y: c0y + perp.y * BIG };
      const sign = keepPositive ? 1 : -1;
      return [
        a, b,
        { x: b.x + axis.x * BIG * sign, y: b.y + axis.y * BIG * sign },
        { x: a.x + axis.x * BIG * sign, y: a.y + axis.y * BIG * sign },
      ];
    };
    out = this.clipPolygon(out, halfPlane(cut0, true));
    if (!out || out.length < 3) return null;
    out = this.clipPolygon(out, halfPlane(cut1, false));
    return out && out.length >= 3 ? out : null;
  },

  _clipToBandRaster(xy, axis, cut0, cut1, cellSize = 0.30) {
    const xs = xy.map(p => p.x), ys = xy.map(p => p.y);
    const x0 = Math.min(...xs) - 2, x1 = Math.max(...xs) + 2;
    const y0 = Math.min(...ys) - 2, y1 = Math.max(...ys) + 2;
    const W = Math.max(12, Math.ceil((x1 - x0) / cellSize));
    const H = Math.max(12, Math.ceil((y1 - y0) / cellSize));
    const ddx = (x1 - x0) / W, ddy = (y1 - y0) / H;
    const grid = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const px = x0 + (i + 0.5) * ddx, py = y0 + (j + 0.5) * ddy;
      const pr = px * axis.x + py * axis.y;
      if (pr < cut0 || pr > cut1) continue;
      if (!this.pointInPoly(px, py, xy)) continue;
      grid[j * W + i] = 1;
    }
    // Plus grande composante connexe (4-conn)
    const lbl = new Int32Array(W * H), sizes = [0];
    let nL = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      if (!grid[j * W + i] || lbl[j * W + i]) continue;
      nL++; sizes.push(0);
      const stk = [[i, j]];
      while (stk.length) {
        const [ci, cj] = stk.pop();
        if (ci < 0 || ci >= W || cj < 0 || cj >= H) continue;
        if (!grid[cj * W + ci] || lbl[cj * W + ci]) continue;
        lbl[cj * W + ci] = nL; sizes[nL]++;
        stk.push([ci + 1, cj], [ci - 1, cj], [ci, cj + 1], [ci, cj - 1]);
      }
    }
    if (!nL) return null;
    let best = 1;
    for (let k = 2; k <= nL; k++) if (sizes[k] > sizes[best]) best = k;
    const mask = new Uint8Array(W * H);
    for (let k = 0; k < W * H; k++) mask[k] = lbl[k] === best ? 1 : 0;
    const out = this._gridToPoly(mask, W, H, x0, y0, ddx, ddy);
    return out && out.length >= 3 ? out : null;
  },
};

export default FootprintHelpers;

// Exposition globale pour compat non-module
if (typeof window !== 'undefined') window.FootprintHelpers = FootprintHelpers;
