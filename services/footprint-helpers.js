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
};

export default FootprintHelpers;

// Exposition globale pour compat non-module
if (typeof window !== 'undefined') window.FootprintHelpers = FootprintHelpers;
