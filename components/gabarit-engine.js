/**
 * GabaritEngine — Orchestrateur gabarit PLU 2D/3D
 * TERLAB Phase 7 — ENSA La Réunion
 *
 * ParcelSet : gestion multi-parcelles (1–5), union convexe, métriques
 * ConstraintSolver : zones constructibles / non-constructibles depuis règles PLU
 */

// ─── Geometry helpers ───────────────────────────────────────────────

function shoelaceArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const { x: x1, y: y1 } = poly[i];
    const { x: x2, y: y2 } = poly[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function centroid(poly) {
  const n = poly.length;
  return {
    x: poly.reduce((s, p) => s + p.x, 0) / n,
    y: poly.reduce((s, p) => s + p.y, 0) / n,
  };
}

function perimeter(poly) {
  let p = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}

function bbox(poly) {
  return {
    minX: Math.min(...poly.map(p => p.x)),
    maxX: Math.max(...poly.map(p => p.x)),
    minY: Math.min(...poly.map(p => p.y)),
    maxY: Math.max(...poly.map(p => p.y)),
  };
}

/** Gift-wrapping (Jarvis march) for convex hull */
function convexHull(points) {
  if (points.length < 3) return [...points];
  let start = points.reduce((best, p) => p.x < best.x || (p.x === best.x && p.y < best.y) ? p : best, points[0]);
  const hull = [];
  let current = start;
  do {
    hull.push(current);
    let next = points[0];
    for (let i = 1; i < points.length; i++) {
      const cross = (next.x - current.x) * (points[i].y - current.y)
                  - (next.y - current.y) * (points[i].x - current.x);
      if (next === current || cross < 0 ||
          (cross === 0 && dist2(current, points[i]) > dist2(current, next))) {
        next = points[i];
      }
    }
    current = next;
  } while (current !== start && hull.length < points.length + 1);
  return hull;
}

function dist2(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/**
 * Inset (shrink) a convex polygon by distance d on each edge.
 * distances can be:
 *  - a number (uniform inset)
 *  - an object { nord, sud, est, ouest } for directional insets
 *  - an array of per-edge distances
 */
function insetPolygon(poly, distances) {
  const n = poly.length;
  if (n < 3) return null;

  // Compute per-edge inset distance
  const edgeDistances = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    let d;
    if (typeof distances === 'number') {
      d = distances;
    } else if (Array.isArray(distances)) {
      d = distances[i] ?? 0;
    } else {
      // Directional: determine edge direction
      const dx = b.x - a.x, dy = b.y - a.y;
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      // Classify edge by outward normal direction
      // Normal points to the left of the edge direction (for CW polygon)
      const normalAngle = angle - 90;
      const na = ((normalAngle % 360) + 360) % 360;
      if (na >= 315 || na < 45) d = distances.est ?? distances.default ?? 0;       // normal points east
      else if (na >= 45 && na < 135) d = distances.sud ?? distances.default ?? 0;   // normal points south
      else if (na >= 135 && na < 225) d = distances.ouest ?? distances.default ?? 0; // normal points west
      else d = distances.nord ?? distances.default ?? 0; // normal points north
    }
    edgeDistances.push(d);
  }

  // For each edge, compute offset line
  const offsetLines = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    // Inward normal (for CCW polygon)
    const nx = -dy / len, ny = dx / len;
    // Check winding — if polygon is CW, flip normal
    const winding = polygonWinding(poly);
    const sign = winding < 0 ? -1 : 1;
    const d = edgeDistances[i];
    offsetLines.push({
      px: a.x + sign * nx * d,
      py: a.y + sign * ny * d,
      dx: dx,
      dy: dy,
    });
  }

  // Intersect consecutive offset lines
  const result = [];
  for (let i = 0; i < offsetLines.length; i++) {
    const l1 = offsetLines[i];
    const l2 = offsetLines[(i + 1) % offsetLines.length];
    const pt = lineLineIntersection(l1, l2);
    if (pt) result.push(pt);
  }

  if (result.length < 3) return null;
  // Check for degenerate (self-intersecting) result
  if (shoelaceArea(result) < 0.01) return null;

  // Garde finale : éperons aigus (angle intérieur < 90°). insetPolygon ne
  // possède aucun spike guard amont (extend & intersect pur), donc une
  // limite oblique peut produire des sommets sub-90°. removeAcuteSpikes
  // les rabote en conservant le polygone valide.
  const GU = (typeof window !== 'undefined') ? window.GeoUtils : null;
  if (GU?.removeAcuteSpikes) {
    const cleaned = GU.removeAcuteSpikes(result, 90);
    if (cleaned && cleaned.length >= 3 && shoelaceArea(cleaned) >= 0.01) {
      return cleaned;
    }
  }
  return result;
}

function polygonWinding(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    sum += (b.x - a.x) * (b.y + a.y);
  }
  return sum; // > 0 = CW, < 0 = CCW
}

function lineLineIntersection(l1, l2) {
  const det = l1.dx * l2.dy - l1.dy * l2.dx;
  if (Math.abs(det) < 1e-12) return null;
  const dpx = l2.px - l1.px, dpy = l2.py - l1.py;
  const t = (dpx * l2.dy - dpy * l2.dx) / det;
  return { x: l1.px + t * l1.dx, y: l1.py + t * l1.dy };
}

// ─── ParcelSet ──────────────────────────────────────────────────────

export class ParcelSet {
  constructor() {
    this.parcels = [];
    this.zone = null;
    this.rules = null;
    this.unionPolygon = [];
  }

  addParcel(polygon) {
    if (this.parcels.length >= 5) throw new Error('Max 5 parcelles');
    this.parcels.push({
      id: crypto.randomUUID(),
      polygon: polygon.map(p => ({ x: p.x, y: p.y })),
      locked: false,
      sourceIGN: false,
    });
    this._recomputeUnion();
  }

  removeParcel(id) {
    this.parcels = this.parcels.filter(p => p.id !== id);
    this._recomputeUnion();
  }

  _recomputeUnion() {
    if (this.parcels.length === 0) {
      this.unionPolygon = [];
      return;
    }
    if (this.parcels.length === 1) {
      this.unionPolygon = [...this.parcels[0].polygon];
      return;
    }
    const allPoints = this.parcels.flatMap(p => p.polygon);
    this.unionPolygon = convexHull(allPoints);
  }

  get totalArea() {
    return this.parcels.reduce((s, p) => s + shoelaceArea(p.polygon), 0);
  }

  get perimeter() {
    return perimeter(this.unionPolygon);
  }

  get boundingBox() {
    if (this.unionPolygon.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    return bbox(this.unionPolygon);
  }
}

// ─── ConstraintSolver ───────────────────────────────────────────────

export class ConstraintSolver {
  solve(parcelSet, rules, context) {
    const poly = parcelSet.unionPolygon;
    if (!poly || poly.length < 3) return null;

    const voieSides = Array.isArray(context.hasVoie) ? context.hasVoie : [context.hasVoie].filter(Boolean);
    const userReculs = context.userReculs ?? {};

    // Compute per-edge inset distances based on context
    const bb = bbox(poly);
    const cx = (bb.minX + bb.maxX) / 2;
    const cy = (bb.minY + bb.maxY) / 2;

    const rVoie = userReculs.voie ?? rules.recul_voie_m;
    const rLat = userReculs.lat ?? rules.recul_sep_lat_m;
    const rFond = userReculs.fond ?? rules.recul_sep_fond_m;

    // Build directional inset map
    const insetMap = { nord: rLat, sud: rLat, est: rLat, ouest: rLat, default: rLat };
    // Voie sides get voie recul
    voieSides.forEach(side => {
      const s = side.toLowerCase();
      if (s in insetMap) insetMap[s] = rVoie;
    });
    // Fond = opposite of voie
    const fondSides = { nord: 'sud', sud: 'nord', est: 'ouest', ouest: 'est' };
    voieSides.forEach(side => {
      const opp = fondSides[side.toLowerCase()];
      if (opp && !voieSides.includes(opp)) insetMap[opp] = rFond;
    });

    // Non-constructible zones
    const zones_non_constructibles = [];

    // Pré-classer chaque arête par direction de sa normale extérieure
    // (nord/sud/est/ouest) pour pouvoir générer des bandes qui suivent
    // l'inclinaison réelle de la limite — jamais un rectangle bbox.
    const edgeSides = this._classifyEdges(poly);

    // Bande voie — toutes les arêtes de la parcelle qui regardent la voie
    voieSides.forEach(side => {
      const bandes = this._makeBandeEdges(poly, edgeSides, side, rVoie);
      bandes.forEach(({ polygon, edgeIdx }) => zones_non_constructibles.push({
        polygon,
        label: `Recul voie ${rVoie}m`,
        type: 'voie',
        side,
        edgeIdx,
      }));
    });

    // Bandes latérales : toutes les arêtes qui ne sont ni voie ni fond
    const fondSideList = voieSides.map(s => fondSides[s.toLowerCase()]).filter(Boolean);
    const latSides = ['nord', 'sud', 'est', 'ouest'].filter(s =>
      !voieSides.includes(s) && !fondSideList.includes(s)
    );

    latSides.forEach(side => {
      const bandes = this._makeBandeEdges(poly, edgeSides, side, rLat);
      bandes.forEach(({ polygon, edgeIdx }) => zones_non_constructibles.push({
        polygon,
        label: `Recul lat. ${rLat}m`,
        type: 'lateral',
        side,
        edgeIdx,
      }));
    });

    // Bande fond — arêtes opposées à la voie
    fondSideList.forEach(side => {
      const bandes = this._makeBandeEdges(poly, edgeSides, side, rFond);
      bandes.forEach(({ polygon, edgeIdx }) => zones_non_constructibles.push({
        polygon,
        label: `Recul fond ${rFond}m`,
        type: 'fond',
        side,
        edgeIdx,
      }));
    });

    // Zone constructible = inset polygon (avec post-process anti-éperon < 90°)
    const emprise_constructible = insetPolygon(poly, insetMap) ?? [];
    // emprise_raw : conservée pour debug visuel (avant removeAcuteSpikes,
    // cf. insetPolygon). Pour l'instant identique — un futur refacto pourrait
    // séparer raw et safe en deux étapes du pipeline.
    const emprise_raw = emprise_constructible;

    // Zones mitoyen zone N
    let zones_mitoyen_n = null;
    if (context.hasZoneN && rules.mitoyen_zone_n_bande_m) {
      zones_mitoyen_n = [];
      fondSideList.forEach(side => {
        const bandes = this._makeBandeEdges(poly, edgeSides, side, rules.mitoyen_zone_n_bande_m);
        bandes.forEach(({ polygon, edgeIdx }) => zones_mitoyen_n.push({
          polygon,
          label: `Mitoyen N — ${rules.mitoyen_zone_n_hauteur_limite}`,
          type: 'mitoyen_n',
          side,
          edgeIdx,
          hauteur_limite: rules.mitoyen_zone_n_hauteur_limite,
        }));
      });
    }

    const empriseArea = emprise_constructible.length >= 3 ? shoelaceArea(emprise_constructible) : 0;
    const totalArea = parcelSet.totalArea;
    const nonConstArea = totalArea - empriseArea;

    return {
      zones_non_constructibles,
      emprise_constructible,
      emprise_raw,
      zones_mitoyen_n,
      volumes: {
        he: rules.he_max_m,
        hf: rules.hf_max_m,
        he_bande_voie: rules.he_bande_voie_m,
        hf_bande_voie: rules.hf_bande_voie_m,
        bande_voie_profondeur: rules.bande_voie_profondeur_m,
      },
      zone_permeable: {
        pct: rules.permeable_min_pct,
        surface_m2: totalArea * rules.permeable_min_pct / 100,
      },
      metrics: {
        surface_parcelle_m2: totalArea,
        surface_constructible_m2: empriseArea,
        surface_non_constructible_m2: nonConstArea,
        ratio_constructible_pct: totalArea > 0 ? (empriseArea / totalArea * 100) : 0,
        surface_permeable_min_m2: totalArea * rules.permeable_min_pct / 100,
        hauteur_egout_max: rules.he_max_m,
        hauteur_faitage_max: rules.hf_max_m,
      },
    };
  }

  /**
   * Classe chaque arête du polygone par la direction cardinale de sa
   * normale extérieure (nord/sud/est/ouest). Y est orienté vers le bas
   * (convention écran), donc nord = ny < 0, sud = ny > 0.
   *
   * @param {Array<{x,y}>} poly
   * @returns {string[]} ['nord'|'sud'|'est'|'ouest', ...] indexé par arête
   */
  _classifyEdges(poly) {
    const n = poly.length;
    const winding = polygonWinding(poly); // > 0 = CW (Y-down)
    const sign = winding < 0 ? -1 : 1;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) { out.push(null); continue; }
      // Normale intérieure (sign-corrigée selon winding)
      const nxIn = sign * (-dy / len);
      const nyIn = sign * ( dx / len);
      // Normale extérieure
      const nxOut = -nxIn, nyOut = -nyIn;
      // Angle extérieur en degrés (0 = est, 90 = sud, 180 = ouest, 270 = nord)
      const angDeg = ((Math.atan2(nyOut, nxOut) * 180 / Math.PI) + 360) % 360;
      let side;
      if (angDeg >= 315 || angDeg < 45)        side = 'est';
      else if (angDeg >= 45  && angDeg < 135)  side = 'sud';
      else if (angDeg >= 135 && angDeg < 225)  side = 'ouest';
      else                                     side = 'nord';
      out.push(side);
    }
    return out;
  }

  /**
   * Génère la bande d'exclusion pour UNE ARÊTE en décalant la limite
   * vers l'intérieur. La bande suit l'inclinaison réelle de la limite —
   * jamais un rectangle bbox.
   *
   * @param {Array<{x,y}>} poly  Polygone parcelle
   * @param {number} i           Index de l'arête (poly[i] → poly[i+1])
   * @param {number} d           Recul en mètres
   * @param {number} sign        +1 ou -1 selon winding du polygone
   * @returns {Array<{x,y}>|null}
   */
  _makeBandeEdge(poly, i, d, sign) {
    if (d <= 0) return null;
    const n = poly.length;
    const p1 = poly[i], p2 = poly[(i + 1) % n];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;
    // Normale intérieure (sign-corrigée selon winding)
    const nxIn = sign * (-dy / len);
    const nyIn = sign * ( dx / len);
    // Quad : [limite_a, limite_b, limite_b + d*ninw, limite_a + d*ninw]
    return [
      { x: p1.x,             y: p1.y             },
      { x: p2.x,             y: p2.y             },
      { x: p2.x + nxIn * d,  y: p2.y + nyIn * d  },
      { x: p1.x + nxIn * d,  y: p1.y + nyIn * d  },
    ];
  }

  /**
   * Génère toutes les bandes pour les arêtes d'une direction cardinale
   * donnée. Une parcelle peut avoir plusieurs arêtes regardant la même
   * direction (parcelle non orthogonale, en L, etc.).
   *
   * @param {Array<{x,y}>} poly
   * @param {string[]} edgeSides  Pré-classification (cf _classifyEdges)
   * @param {string} side         'nord'|'sud'|'est'|'ouest'
   * @param {number} d            Recul en mètres
   * @returns {{polygon, edgeIdx}[]}
   */
  _makeBandeEdges(poly, edgeSides, side, d) {
    if (d <= 0) return [];
    const winding = polygonWinding(poly);
    const sign = winding < 0 ? -1 : 1;
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      if (edgeSides[i] !== side) continue;
      const polygon = this._makeBandeEdge(poly, i, d, sign);
      if (polygon) out.push({ polygon, edgeIdx: i });
    }
    return out;
  }
}

// ─── GabaritEngine (orchestrateur) ──────────────────────────────────

/**
 * GabaritEngine — version commune-aware (post-refacto P0-1).
 *
 * Source de vérité unique : data/plu-rules-reunion.json (24 communes).
 * La résolution zone PLU passe par PLUP07Adapter (gestion AVAP, ref_zone,
 * fuzzy match, fallback graceful avec status distinct).
 *
 * Le ConstraintSolver attend toujours un objet `rules` plat avec les clés
 * recul_voie_m / he_max_m / etc. — `_flattenZoneRules()` traduit le format
 * nesté de plu-rules-reunion.json vers ce format legacy.
 */
export class GabaritEngine {
  constructor() {
    this.parcelSet  = new ParcelSet();
    this.solver     = new ConstraintSolver();
    this._adapter   = null;             // PLUP07Adapter — chargé lazily
    this._rulesUrl  = null;
    this.currentCodeInsee = null;
    this.currentZone = null;
    this.lastResolution = null;          // cfg complet du dernier resolve()
    this._lastFlatRules = null;          // règles aplaties du dernier setZone (fallback)
  }

  /**
   * Charge les règles PLU communales.
   * @param {string} url — défaut data/plu-rules-reunion.json
   * @returns {Promise<Object>} — l'objet rules brut (compat)
   */
  async loadRules(url = '../data/plu-rules-reunion.json') {
    this._rulesUrl = url;
    const { PLUP07Adapter } = await import('../services/plu-p07-adapter.js');
    this._adapter = new PLUP07Adapter();
    await this._adapter.loadRules(url);
    return this._adapter._rules;
  }

  /**
   * Sélectionne une parcelle par commune + zone (signature changée).
   * @param {string} codeInsee — code INSEE 5 chiffres (ex 97415 pour Saint-Paul)
   * @param {string} zoneKey   — code zone PLU (ex U1a, AUa, Uavap…)
   * @param {Object} [options] — { secteurAvap, zoneRtaa }
   *
   * Compat : si appelé en mode legacy `setZone(zoneKey)` (1 seul arg string
   * sans préfixe numérique), on log un warning et on tente avec la dernière
   * commune connue. À supprimer après audit complet.
   */
  setZone(codeInsee, zoneKey, options = {}) {
    // Compat ascendante : setZone('U1a') sans commune → warn + fallback
    if (zoneKey === undefined && typeof codeInsee === 'string' && !/^\d{5}$/.test(codeInsee)) {
      console.warn('[GabaritEngine] setZone(zoneKey) deprecated — passez (codeInsee, zoneKey)');
      zoneKey = codeInsee;
      codeInsee = this.currentCodeInsee;
    }

    if (!this._adapter) {
      console.error('[GabaritEngine] loadRules() doit être appelé avant setZone()');
      return null;
    }
    if (!codeInsee) {
      console.warn('[GabaritEngine] setZone : code INSEE manquant — résolution impossible');
      this.currentZone = zoneKey;
      this.parcelSet.zone = zoneKey;
      this.parcelSet.rules = null;
      this.lastResolution = null;
      return null;
    }

    const cfg = this._adapter.resolve(codeInsee, zoneKey, options.zoneRtaa ?? '1', {
      secteurAvap: options.secteurAvap,
    });
    this.currentCodeInsee = codeInsee;
    this.currentZone      = cfg.zone_plu ?? zoneKey;
    this._lastFlatRules   = this._flattenZoneRules(cfg);
    this.parcelSet.zone   = this.currentZone;
    this.parcelSet.rules  = this._lastFlatRules;
    this.lastResolution   = cfg;
    return cfg;
  }

  solve(parcelSet, zoneRules, context) {
    // Si zoneRules est un cfg PLUP07Adapter (objet riche), aplatir
    if (zoneRules && (zoneRules.plu || zoneRules.reculs?.voie != null)) {
      zoneRules = this._flattenZoneRules(zoneRules);
    }
    // Cascade de fallback : args explicite → parcelSet.rules → dernier setZone
    if (!zoneRules) zoneRules = (parcelSet ?? this.parcelSet)?.rules ?? this._lastFlatRules;
    if (!zoneRules) {
      console.warn('[GabaritEngine] solve() : aucune règle PLU disponible — appelez setZone() avant');
      return null;
    }
    return this.solver.solve(parcelSet ?? this.parcelSet, zoneRules, context);
  }

  /**
   * Récupère les règles d'une zone (format plat solver).
   * @param {string} [codeInsee] — défaut commune courante
   * @param {string} [zoneKey]   — défaut zone courante
   */
  getZoneRules(codeInsee, zoneKey) {
    const insee = codeInsee ?? this.currentCodeInsee;
    const zone  = zoneKey ?? this.currentZone;
    if (!this._adapter || !insee || !zone) return null;
    const cfg = this._adapter.resolve(insee, zone, '1');
    return this._flattenZoneRules(cfg);
  }

  /**
   * Liste les zones d'une commune.
   * @param {string} [codeInsee] — défaut commune courante
   * @returns {Array<{key, label, type, status}>}
   */
  getZoneList(codeInsee) {
    const insee = codeInsee ?? this.currentCodeInsee;
    if (!this._adapter?._rules || !insee) return [];
    const communeData = this._adapter._rules.communes?.[insee];
    if (!communeData?.zones) {
      // Commune absente — aucune zone exacte ; on n'invente pas de fallback
      return [];
    }
    return Object.entries(communeData.zones).map(([key, z]) => ({
      key,
      label: `${key} — ${z.label ?? z.type ?? ''}`,
      type:  z.type ?? '?',
    }));
  }

  /** Statut de la dernière résolution (OK / FALLBACK / reason) */
  getResolutionStatus() {
    if (!this.lastResolution) return null;
    const m = this.lastResolution._meta ?? {};
    return {
      status:     m.status,
      reason:     m.reason ?? null,
      confidence: m.confidence ?? null,
      warnings:   m.warnings ?? [],
      commune:    this.lastResolution.commune,
      zone:       this.lastResolution.zone_plu,
      isExact:    m.status === 'OK',
    };
  }

  /**
   * Aplatit un cfg PLUP07Adapter (objet riche nesté) vers le format legacy
   * attendu par ConstraintSolver. Conserve les clés exactes consommées par
   * solver.solve() : recul_*_m, he/hf_*_m, permeable_min_pct, mitoyen_*.
   */
  _flattenZoneRules(cfg) {
    if (!cfg) return null;
    const plu = cfg.plu ?? {};
    const r   = cfg.reculs ?? {};
    return {
      // Identité
      label: cfg.label ?? cfg.zone_plu ?? '—',
      zone:  cfg.zone_plu ?? null,

      // Reculs (clés legacy attendues par ConstraintSolver)
      recul_voie_m:     r.voie ?? 3,
      recul_sep_lat_m:  r.lat  ?? 3,
      recul_sep_fond_m: r.fond ?? 3,
      distance_inter_batiments_m: plu.interBatMin ?? 4,

      // Hauteurs
      he_max_m: plu.heEgout ?? plu.heMax ?? 9,
      hf_max_m: plu.hfFaitage ?? plu.heMax ?? 12,
      he_bande_voie_m:        cfg.hauteurs_brutes?.he_bande_voie_m ?? null,
      hf_bande_voie_m:        cfg.hauteurs_brutes?.hf_bande_voie_m ?? null,
      bande_voie_profondeur_m: cfg.hauteurs_brutes?.bande_voie_profondeur_m ?? null,

      // Annexes
      annexe_hauteur_max_m:  plu.annexe_hf_max_m ?? null,
      annexe_emprise_max_m2: plu.annexe_emprise_max_m2 ?? null,

      // Emprise
      emprise_sol_max_pct:   plu.emprMax ?? null,
      emprise_sol_reglementee: plu.emprMax != null && plu.emprMax < 100,

      // Perméabilité (avec conversion CBS via l'adapter quand applicable)
      permeable_min_pct: plu.permMin ?? 30,

      // CBS (réglementaire ou indicateur)
      cbs: plu.cbs ?? null,

      // Toiture
      toit_versants_obligatoire: plu.versants_obligatoire ?? null,
      toit_versants_pct_volume:  plu.versants_pct_volume ?? null,
      toit_pente_min_pct:        plu.pente_toiture_min_pct ?? null,
      toit_pente_max_pct:        plu.pente_toiture_max_pct ?? null,

      // Mitoyen zone N (clés legacy)
      mitoyen_zone_n_bande_m:        cfg.mitoyen_zone_n_bande_m ?? null,
      mitoyen_zone_n_hauteur_limite: cfg.mitoyen_zone_n_hauteur_limite ?? null,

      // Stationnement (passe-plat)
      stationnement: {
        logement_standard: plu.park_logement_std,
        logement_aide:     plu.park_logement_aide,
        visiteur_par_5lots: plu.park_visiteur_par5,
        commerce_bureau:    plu.park_commerce_bureau,
        hotel_par_2chambres: plu.park_hotel_par_2chambres,
      },

      // Logement aidé
      quota_loge_aide: {
        sdp_seuil_1_m2: plu.aide_seuil_m2,
        pct_aide_seuil_1: plu.aide_pct,
      },

      // Métadonnées
      _commune:    cfg.commune,
      _code_insee: cfg.code_insee,
      _meta:       cfg._meta,
    };
  }
}

// Expose for non-module usage
if (typeof window !== 'undefined') {
  window.GabaritEngine = GabaritEngine;
  window.ParcelSet = ParcelSet;
  window.ConstraintSolver = ConstraintSolver;
}

export default GabaritEngine;
