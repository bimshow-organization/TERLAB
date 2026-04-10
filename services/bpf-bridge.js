// terlab/services/bpf-bridge.js
// BPF Bridge v2 — Végétation + Aménagement automatique du plan de masse
// Adapter autonome TERLAB : lit bpf-species-reunion.json, scatter Poisson disk,
// génère végétation + amenities à partir de la connaissance du site
// Parcelles polygonales complexes — guard > 1 hectare
// Aucune dépendance Angular/BPF — 100% vanilla JS

import { deduireZoneClimatique } from './reunion-constants.js';

const MAX_PARCEL_AREA = 10000; // 1 hectare — au-delà on bloque

// ══════════════════════════════════════════════════════════════════════════════
// REGLES DE PLANTATION — Code Civil Art. 671 + PLU communes Réunion
// ══════════════════════════════════════════════════════════════════════════════
// Art. 671 CC : arbre > 2m de haut → 2m de la limite, plantation < 2m → 0.5m
// Palmiers et bananiers = monocotylédones, pas des arbres au sens juridique
// Saint-Paul PLU Art. 13 : règles plus strictes (arbre 2m, arbuste 1.5m, inter-arbre 4m)

const PLANTATION_RULES_DEFAULT = {
  arbre_recul_limite_m: 2.0,      // Code Civil Art. 671 (hauteur > 2m)
  arbuste_recul_limite_m: 0.5,    // Code Civil Art. 671 (hauteur ≤ 2m)
  palmier_recul_limite_m: 0,      // Palmier = monocotylédone, pas un arbre
  bananier_recul_limite_m: 0,     // Bananier = herbe, pas un arbre
  arbre_inter_distance_m: 0,      // Pas de règle CC
  palmier_inter_distance_m: 0,
  arbre_recul_facade_m: 0,
};

// Règles spécifiques par commune (INSEE → overrides)
const PLANTATION_RULES_COMMUNE = {
  '97415': { // Saint-Paul — PLU Art. 13 Titre V
    arbre_recul_limite_m: 2.0,
    arbre_recul_facade_m: 2.0,
    arbre_inter_distance_m: 4.0,
    arbuste_recul_limite_m: 1.5,
    palmier_inter_distance_m: 3.0,
    palmier_recul_limite_m: 0,     // Palmier pas soumis au recul Art.671
    ratio_arbre_par_200m2: 1,      // 1 arbre / 200m² (maison indiv.)
    ratio_arbuste_par_200m2: 1,    // 1 arbuste / 200m²
    ratio_arbre_par_100m2_libre: 1,// 1 arbre h≥2m / 100m² d'espaces libres
    strates_min: 3,                // arborescente + arbustive + herbacée
    especes_indigenes_prioritaires: true,
  },
};

function _getPlantationRules(session) {
  const insee = session?.terrain?.code_insee
    ?? session?.phases?.[0]?.data?.code_insee
    ?? null;
  const communeRules = insee ? PLANTATION_RULES_COMMUNE[insee] : null;
  return { ...PLANTATION_RULES_DEFAULT, ...(communeRules ?? {}), insee };
}

// ── DONNEES (chargement lazy) ────────────────────────────────────────────────
let _speciesDb  = null;
let _dbPromise  = null;

async function _loadDb() {
  if (_speciesDb) return _speciesDb;
  if (!_dbPromise) {
    _dbPromise = fetch('./data/bpf-species-reunion.json')
      .then(r => r.json())
      .then(db => { _speciesDb = db; return db; });
  }
  return _dbPromise;
}

// ══════════════════════════════════════════════════════════════════════════════
// POISSON DISK SAMPLING — Bridson 2007, 2D avec exclusion polygonale
// ══════════════════════════════════════════════════════════════════════════════

function _seededRng(seed) {
  let s = seed | 0 || 42;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

function _pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function _distSq(a, b) { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2; }

function _poissonDisk(bounds, minDist, maxAttempts, rng, insideFn, excludeFn) {
  const cellSize = minDist / Math.SQRT2;
  const cols = Math.ceil((bounds.maxX - bounds.minX) / cellSize);
  const rows = Math.ceil((bounds.maxY - bounds.minY) / cellSize);
  if (cols <= 0 || rows <= 0 || cols * rows > 500000) return [];
  const grid = new Array(cols * rows).fill(-1);
  const points = [];
  const active = [];
  const r2 = minDist * minDist;

  function _gridIdx(x, y) {
    const c = Math.floor((x - bounds.minX) / cellSize);
    const r = Math.floor((y - bounds.minY) / cellSize);
    return r * cols + c;
  }

  function _tooClose(x, y) {
    const ci = Math.floor((x - bounds.minX) / cellSize);
    const ri = Math.floor((y - bounds.minY) / cellSize);
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const r2i = ri + dr, c2i = ci + dc;
        if (r2i < 0 || r2i >= rows || c2i < 0 || c2i >= cols) continue;
        const idx = grid[r2i * cols + c2i];
        if (idx >= 0 && _distSq({ x, y }, points[idx]) < r2) return true;
      }
    }
    return false;
  }

  // Seed point — chercher un point valide
  for (let attempt = 0; attempt < 50; attempt++) {
    const sx = bounds.minX + rng() * (bounds.maxX - bounds.minX);
    const sy = bounds.minY + rng() * (bounds.maxY - bounds.minY);
    if (insideFn(sx, sy) && !excludeFn(sx, sy)) {
      points.push({ x: sx, y: sy });
      grid[_gridIdx(sx, sy)] = 0;
      active.push(0);
      break;
    }
  }

  let safety = 0;
  while (active.length > 0 && safety++ < 50000) {
    const ai = Math.floor(rng() * active.length);
    const pt = points[active[ai]];
    let found = false;
    for (let k = 0; k < maxAttempts; k++) {
      const angle = rng() * Math.PI * 2;
      const dist  = minDist + rng() * minDist;
      const nx = pt.x + Math.cos(angle) * dist;
      const ny = pt.y + Math.sin(angle) * dist;
      if (nx < bounds.minX || nx > bounds.maxX || ny < bounds.minY || ny > bounds.maxY) continue;
      if (!insideFn(nx, ny)) continue;
      if (excludeFn(nx, ny)) continue;
      if (_tooClose(nx, ny)) continue;
      const ni = points.length;
      points.push({ x: nx, y: ny });
      grid[_gridIdx(nx, ny)] = ni;
      active.push(ni);
      found = true;
      break;
    }
    if (!found) active.splice(ai, 1);
  }
  return points;
}

// ══════════════════════════════════════════════════════════════════════════════
// GEOMETRIE UTILITAIRE — supporte polygones complexes (N sommets)
// ══════════════════════════════════════════════════════════════════════════════

function _bbox(pts) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

function _polyArea(pts) {
  if (!pts || pts.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

function _centroid(pts) {
  if (!pts?.length) return { x: 0, y: 0 };
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  return { x: cx / pts.length, y: cy / pts.length };
}

function _lineIntersect(a1, a2, b1, b2) {
  const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
  const det = d1x * d2y - d1y * d2x;
  if (Math.abs(det) < 1e-10) return null;
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / det;
  return { x: a1.x + t * d1x, y: a1.y + t * d1y };
}

// Inset polygonal par arête — Sutherland-Hodgman half-plane clipping.
// Robuste pour reculs MIXTES (voie≠lat≠fond) : on clippe la parcelle par chaque
// demi-plan rentrant, on n'extrapole jamais les droites (sinon spikes pour les
// arêtes quasi-parallèles → arbres plantés hors parcelle).
function _offsetPolygonPerEdge(pts, edgeTypes, reculs) {
  const n = pts.length;
  if (n < 3) return [];

  // Aire signée Shoelace → orientation
  let sa = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sa += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  // sa > 0 = CCW math (Y-haut), normale rentrante = (-dy, dx) ; sinon (dy, -dx).
  const orient = sa >= 0 ? 1 : -1;

  // Polygone clippé itérativement
  let clipped = pts.map(p => ({ x: p.x, y: p.y }));

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const type = edgeTypes[i] ?? 'lateral';
    const r = type === 'voie' ? reculs.voie : type === 'fond' ? reculs.fond : reculs.lat;
    if (!(r > 0)) continue;

    const ax = pts[i].x, ay = pts[i].y;
    const bx = pts[j].x, by = pts[j].y;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue;

    const nx = -dy / len * orient;
    const ny =  dx / len * orient;
    const px = ax + nx * r;
    const py = ay + ny * r;

    clipped = _clipHalfPlane(clipped, px, py, nx, ny);
    if (clipped.length < 3) return [];
  }

  return _polyArea(clipped) >= 1 ? clipped : [];
}

// Sutherland-Hodgman : garde les points P tels que n·(P - p) ≥ 0
function _clipHalfPlane(poly, px, py, nx, ny) {
  const m = poly.length;
  if (m === 0) return [];
  const out = [];
  const dist = (x, y) => nx * (x - px) + ny * (y - py);
  for (let i = 0; i < m; i++) {
    const a = poly[i], b = poly[(i + 1) % m];
    const da = dist(a.x, a.y);
    const db = dist(b.x, b.y);
    const aIn = da >= 0;
    const bIn = db >= 0;
    if (aIn) out.push({ x: a.x, y: a.y });
    if (aIn !== bIn) {
      const t = da / (da - db);
      out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }
  }
  return out;
}

// Inset uniforme (tous les bords au même recul)
function _insetPolygon(poly, dist) {
  if (!poly || poly.length < 3 || dist <= 0) return poly;
  const edges = new Array(poly.length).fill('lateral');
  return _offsetPolygonPerEdge(poly, edges, { voie: dist, fond: dist, lat: dist });
}

// Distance point à segment
function _distPointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.01) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Distance point au polygone le plus proche
function _distToPolygonBorder(px, py, poly) {
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const d = _distPointToSegment(px, py, poly[i].x, poly[i].y, poly[j].x, poly[j].y);
    if (d < min) min = d;
  }
  return min;
}

// ══════════════════════════════════════════════════════════════════════════════
// ZONE DECOMPOSITION — polygones complexes réels
// Utilise _offsetPolygonPerEdge (même algo que EnvelopeGenerator._setback)
// ══════════════════════════════════════════════════════════════════════════════

function _decomposeZones(parcelLocal, edgeTypes, buildingPoly, reculs, pprnLocal) {
  const zones = [];
  const n = parcelLocal.length;
  if (n < 3) return zones;

  // ── 1. Zone constructible = polygone inseté par les reculs PLU (par arête)
  const constructible = _offsetPolygonPerEdge(parcelLocal, edgeTypes, reculs);

  // ── 2. Bandes de recul par type d'arête ────────────────────────
  // Chaque bande = zone entre le bord parcelle et le polygone constructible
  // On crée une bande le long de chaque arête du polygone original
  for (let i = 0; i < n; i++) {
    const type = edgeTypes?.[i] ?? 'lateral';
    const a = parcelLocal[i], b = parcelLocal[(i + 1) % n];
    const reculDist = type === 'voie' ? reculs.voie : type === 'fond' ? reculs.fond : reculs.lat;
    if (reculDist < 0.5) continue;

    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;

    // Normale intérieure (CW en espace Y-inverse)
    const nx = dy / len, ny = -dx / len;

    // Bande = quadrilatère le long de l'arête, épaisseur = recul
    const band = [
      { x: a.x, y: a.y },
      { x: b.x, y: b.y },
      { x: b.x + nx * reculDist, y: b.y + ny * reculDist },
      { x: a.x + nx * reculDist, y: a.y + ny * reculDist },
    ];

    const zoneType = type === 'voie' ? 'bande_voie'
                   : type === 'fond' ? 'fond_parcelle'
                   : 'lateral';

    zones.push({ type: zoneType, polygon: band, edgeIdx: i, edgeType: type, edgeLen: len });
  }

  // ── 3. Zones PPRN ─────────────────────────────────────────────
  if (pprnLocal?.length) {
    for (const pprn of pprnLocal) {
      zones.push({ type: 'zone_pprn', polygon: pprn.polygon ?? pprn });
    }
  }

  // ── 4. Zone résiduelle (constructible moins le bâtiment) ──────
  // Utilise le polygone constructible réel, pas un inset simplifié
  const residualPoly = constructible.length >= 3 ? constructible : _insetPolygon(parcelLocal, 1);
  if (residualPoly.length >= 3) {
    zones.push({ type: 'residuel', polygon: residualPoly, buildingExclude: buildingPoly });
  }

  return zones;
}

// ══════════════════════════════════════════════════════════════════════════════
// ESPECE SELECTION
// ══════════════════════════════════════════════════════════════════════════════

function _zoneKey(zoneClim) {
  return zoneClim.includes('hauts') || zoneClim.includes('cirque') ? 'hauts'
    : zoneClim.includes('mipentes') ? 'mipentes' : 'littoral';
}

function _selectPattern(db, zoneType, zoneClim) {
  const zp = db.zonePlacement[zoneType];
  if (!zp) return null;
  const zk = _zoneKey(zoneClim);
  for (const patId of zp.patterns) {
    const pat = db.gardenPatterns[patId];
    if (!pat) continue;
    if (pat.zone?.includes(zk)) return { patternId: patId, ...pat };
  }
  const fallback = db.gardenPatterns[zp.patterns[0]];
  return fallback ? { patternId: zp.patterns[0], ...fallback } : null;
}

// ══════════════════════════════════════════════════════════════════════════════
// AMENITY PLACEMENT — piscine, bassin, kiosque, pergola, cuisine ext, etc.
// Placement intelligent : buffers bâti/limites, zone climatique, exposition
// ══════════════════════════════════════════════════════════════════════════════

function _placeAmenities(db, parcelLocal, edgeTypes, buildingPoly, reculs, zoneClim, rng, session) {
  const amenities = db.amenities;
  if (!amenities) return [];

  const parcelArea = _polyArea(parcelLocal);
  const zk = _zoneKey(zoneClim);
  const placed = [];

  // Construire le polygone constructible (zone libre)
  const constructible = _offsetPolygonPerEdge(parcelLocal, edgeTypes, reculs);
  if (constructible.length < 3) return [];

  // Buffer autour du bâtiment
  const buildBbox = buildingPoly?.length >= 3 ? _bbox(buildingPoly) : null;
  const buildCenter = buildingPoly?.length >= 3 ? _centroid(buildingPoly) : _centroid(parcelLocal);

  // Centroide parcelle pour la géométrie
  const parcelCenter = _centroid(parcelLocal);

  // Exposition dominante (de la session terrain)
  const exposure = session?.terrain?.exposure ?? 'O';

  // Collecte des rectangles placés pour collision
  const placedRects = [];
  if (buildingPoly?.length >= 3) {
    const bb = _bbox(buildingPoly);
    placedRects.push({ minX: bb.minX - 1, maxX: bb.maxX + 1, minY: bb.minY - 1, maxY: bb.maxY + 1 });
  }

  function _rectCollides(cx, cy, hw, hh) {
    for (const r of placedRects) {
      if (cx - hw < r.maxX && cx + hw > r.minX && cy - hh < r.maxY && cy + hh > r.minY) return true;
    }
    return false;
  }

  function _isValidPlacement(cx, cy, hw, hh, bufferBati, bufferLimite) {
    // Les 4 coins doivent être dans la parcelle
    const corners = [
      { x: cx - hw, y: cy - hh }, { x: cx + hw, y: cy - hh },
      { x: cx + hw, y: cy + hh }, { x: cx - hw, y: cy + hh },
    ];
    for (const c of corners) {
      if (!_pointInPolygon(c.x, c.y, parcelLocal)) return false;
    }
    // Buffer limite parcelle
    if (bufferLimite > 0) {
      for (const c of corners) {
        if (_distToPolygonBorder(c.x, c.y, parcelLocal) < bufferLimite) return false;
      }
    }
    // Buffer bâtiment
    if (bufferBati > 0 && buildingPoly?.length >= 3) {
      for (const c of corners) {
        if (_distToPolygonBorder(c.x, c.y, buildingPoly) < bufferBati) return false;
      }
    }
    // Pas dans le bâtiment
    if (buildingPoly?.length >= 3) {
      for (const c of corners) {
        if (_pointInPolygon(c.x, c.y, buildingPoly)) return false;
      }
    }
    // Pas de collision avec un élément déjà placé
    if (_rectCollides(cx, cy, hw, hh)) return false;
    return true;
  }

  // Trier les amenities par priorité de placement
  const priority = ['terrasse', 'pergola', 'piscine', 'kiosque', 'cuisine_ext', 'potager', 'tisanerie', 'bassin'];

  for (const amKey of priority) {
    const am = amenities[amKey];
    if (!am) continue;
    // Zone climatique compatible ?
    if (!am.zone?.includes(zk)) continue;
    // Surface min ?
    if (parcelArea < (am.minParcelArea ?? 0)) continue;

    const w = am.w ?? am.r * 2 ?? 3;
    const h = am.h ?? am.r * 2 ?? 3;
    const hw = w / 2, hh = h / 2;

    // Stratégie de placement selon le type
    let bestPos = null;

    if (am.placement === 'adjacent_bati') {
      // Terrasse : collée au bâtiment (côté préféré = exposition)
      if (buildBbox) {
        const candidates = [
          { x: (buildBbox.minX + buildBbox.maxX) / 2, y: buildBbox.maxY + hh + 0.5 }, // Sud
          { x: buildBbox.maxX + hw + 0.5, y: (buildBbox.minY + buildBbox.maxY) / 2 }, // Est
          { x: (buildBbox.minX + buildBbox.maxX) / 2, y: buildBbox.minY - hh - 0.5 }, // Nord
          { x: buildBbox.minX - hw - 0.5, y: (buildBbox.minY + buildBbox.maxY) / 2 }, // Ouest
        ];
        for (const c of candidates) {
          if (_isValidPlacement(c.x, c.y, hw, hh, 0, am.bufferLimite ?? 0)) {
            bestPos = c;
            break;
          }
        }
      }
    } else if (am.placement === 'bande_voie') {
      // Pergola : côté voie, idéalement façade Ouest (RTAA)
      if (buildBbox) {
        const candidates = [
          { x: buildBbox.minX - hw - 1, y: (buildBbox.minY + buildBbox.maxY) / 2 },
          { x: buildBbox.maxX + hw + 1, y: (buildBbox.minY + buildBbox.maxY) / 2 },
          { x: (buildBbox.minX + buildBbox.maxX) / 2, y: buildBbox.minY - hh - 1 },
        ];
        for (const c of candidates) {
          if (_isValidPlacement(c.x, c.y, hw, hh, am.bufferBati ?? 0, am.bufferLimite ?? 1)) {
            bestPos = c;
            break;
          }
        }
      }
    } else {
      // fond_parcelle / residuel : placer le plus loin possible du bâtiment
      // Stratégie : essayer N positions aléatoires dans le constructible, garder la meilleure
      const bounds = _bbox(constructible);
      let bestDist = -1;
      for (let attempt = 0; attempt < 80; attempt++) {
        const cx = bounds.minX + rng() * (bounds.maxX - bounds.minX);
        const cy = bounds.minY + rng() * (bounds.maxY - bounds.minY);
        if (!_isValidPlacement(cx, cy, hw, hh, am.bufferBati ?? 2, am.bufferLimite ?? 1)) continue;
        // Distance au bâtiment (plus loin = mieux pour fond_parcelle)
        const dist = buildCenter ? Math.hypot(cx - buildCenter.x, cy - buildCenter.y) : 0;
        if (dist > bestDist) {
          bestDist = dist;
          bestPos = { x: cx, y: cy };
        }
      }
    }

    if (bestPos) {
      placedRects.push({
        minX: bestPos.x - hw - 0.5, maxX: bestPos.x + hw + 0.5,
        minY: bestPos.y - hh - 0.5, maxY: bestPos.y + hh + 0.5,
      });
      placed.push({
        type: 'amenity',
        amenityKey: amKey,
        label: am.label,
        svgSymbol: am.svgSymbol,
        x: bestPos.x,
        y: bestPos.y,
        w, h,
        isCircle: !!am.r,
        r: am.r ?? null,
        note: am.note,
      });
    }
  }

  return placed;
}

// ══════════════════════════════════════════════════════════════════════════════
// GENERATE — pipeline principal
// ══════════════════════════════════════════════════════════════════════════════

const BpfBridge = {

  MAX_AREA: MAX_PARCEL_AREA,

  async generate(session, parcelLocal, edgeTypes, buildingPoly, envZones = null) {
    const db = await _loadDb();
    const terrain = session?.terrain ?? {};
    const p4 = session?.phases?.[4]?.data ?? {};

    // ── Guard : parcelle trop grande ───────────────────────────────
    const parcelArea = _polyArea(parcelLocal);
    if (parcelArea > MAX_PARCEL_AREA) {
      return {
        error: `Parcelle trop grande (${Math.round(parcelArea)} m² > ${MAX_PARCEL_AREA} m²). Aménagement automatique limité à 1 hectare.`,
        plants: [], amenities: [], stats: null, zoneClim: null, patterns: [],
      };
    }
    if (parcelArea < 10) {
      return {
        error: 'Parcelle trop petite pour l\'aménagement automatique.',
        plants: [], amenities: [], stats: null, zoneClim: null, patterns: [],
      };
    }

    // ── Contexte site ──────────────────────────────────────────────
    const lat = parseFloat(terrain.lat ?? -21.15);
    const lng = parseFloat(terrain.lng ?? 55.45);
    const alt = parseFloat(terrain.altitude_ngr ?? 100);
    const zoneClim = deduireZoneClimatique(alt, lat, lng);

    const reculs = {
      voie: parseFloat(p4.recul_voie_m ?? p4.recul_avant_m ?? 3) || 3,
      fond: parseFloat(p4.recul_fond_m ?? 3) || 3,
      lat:  parseFloat(p4.recul_lat_m ?? 0) || 0,
    };

    // ── OBIA ───────────────────────────────────────────────────────
    const obia = session?.phases?.[6]?.data?.obia_result ?? terrain.obia;

    // ── PPRN ───────────────────────────────────────────────────────
    const pprnLocal = this._extractPprnLocal(terrain, parcelLocal);

    // ── Normaliser edgeTypes (doit avoir même longueur que parcel) ─
    let edges = edgeTypes;
    if (!edges || edges.length !== parcelLocal.length) {
      edges = new Array(parcelLocal.length).fill('lateral');
      // Heuristique minimale : l'arête la plus au sud = voie
      let maxY = -Infinity, maxI = 0;
      for (let i = 0; i < parcelLocal.length; i++) {
        const mid = (parcelLocal[i].y + parcelLocal[(i + 1) % parcelLocal.length].y) / 2;
        if (mid > maxY) { maxY = mid; maxI = i; }
      }
      edges[maxI] = 'voie';
      // Arête opposée (la plus au nord) = fond
      let minY = Infinity, minI = 0;
      for (let i = 0; i < parcelLocal.length; i++) {
        if (i === maxI) continue;
        const mid = (parcelLocal[i].y + parcelLocal[(i + 1) % parcelLocal.length].y) / 2;
        if (mid < minY) { minY = mid; minI = i; }
      }
      edges[minI] = 'fond';
    }

    const rng = _seededRng(Math.round(lat * 10000 + lng * 10000));

    // ══ REGLES DE PLANTATION (Code Civil + PLU commune) ══════════
    const plantRules = _getPlantationRules(session);

    // ══ AMENITIES d'abord (elles occupent de l'espace) ═══════════
    const amenities = _placeAmenities(db, parcelLocal, edges, buildingPoly, reculs, zoneClim, rng, session);

    // Construire la liste des zones d'exclusion (bâtiment + amenities)
    const exclusionPolys = [];
    if (buildingPoly?.length >= 3) exclusionPolys.push(buildingPoly);
    for (const am of amenities) {
      const hw = am.w / 2, hh = am.h / 2;
      exclusionPolys.push([
        { x: am.x - hw - 1, y: am.y - hh - 1 },
        { x: am.x + hw + 1, y: am.y - hh - 1 },
        { x: am.x + hw + 1, y: am.y + hh + 1 },
        { x: am.x - hw - 1, y: am.y + hh + 1 },
      ]);
    }

    // ══ VEGETATION ═══════════════════════════════════════════════════
    // Si envZones fourni, surcharger les zones calculées avec les zones inset réelles
    let zones;
    if (envZones) {
      zones = this._zonesFromEnvZones(envZones, parcelLocal, buildingPoly);
    } else {
      zones = _decomposeZones(parcelLocal, edges, buildingPoly, reculs, pprnLocal);
    }
    const plants = [];

    for (const zone of zones) {
      const pattern = _selectPattern(db, zone.type, zoneClim);
      if (!pattern) continue;

      const poly = zone.polygon;
      if (!poly || poly.length < 3) continue;
      const bounds = _bbox(poly);
      const area = _polyArea(poly);
      if (area < 2) continue;

      // ── Distance min Poisson disk = max(densité pattern, inter-distance réglementaire)
      const baseDist = pattern.placement === 'linear' ? 3 : 1 / Math.sqrt(Math.max(0.01, pattern.density));
      // Appliquer l'inter-distance réglementaire arbres (Saint-Paul = 4m)
      const reglementDist = plantRules.arbre_inter_distance_m || 0;
      const minDist = Math.max(1.5, baseDist, reglementDist);

      // ── Exclusion : bâtiment + amenities + reculs réglementaires limites
      const excludeFn = (x, y) => {
        // Exclusion polygonale (bâtiment + amenities)
        for (const ep of exclusionPolys) {
          if (_pointInPolygon(x, y, ep)) return true;
        }
        // Recul façade bâtiment (Art. 13 PLU)
        if (plantRules.arbre_recul_facade_m > 0 && buildingPoly?.length >= 3) {
          if (_distToPolygonBorder(x, y, buildingPoly) < plantRules.arbre_recul_facade_m) return true;
        }
        return false;
      };

      // Garde-fou : un point doit être DANS la zone ET DANS la parcelle.
      // Évite que des arbres atterrissent hors parcelle si la zone bavait
      // (legacy bug : inset spike → poly extrapolé hors parcelle).
      const positions = _poissonDisk(
        bounds, minDist, 30, rng,
        (x, y) => _pointInPolygon(x, y, poly) && _pointInPolygon(x, y, parcelLocal),
        excludeFn
      );

      for (const pos of positions) {
        const species = this._weightedSelect(pattern.strata, db.species, rng);
        if (!species) continue;

        // ── Vérifier le recul limite parcelle selon le type de plante ──
        // Art. 671 CC : arbre > 2m → 2m de la limite
        // Palmier/bananier = monocotylédone → pas soumis
        // Arbuste < 2m → 0.5m (ou 1.5m à Saint-Paul)
        const isTree = !species.isPalm
          && species.growthForm !== 'grass'
          && species.growthForm !== 'herb'
          && (species.trunkH ?? 0) > 2;
        const isPalm = species.isPalm === true;
        const isShrub = (species.strate === 'arbustif' || species.strate === 'couvre_sol')
          && !isPalm && (species.trunkH ?? 0) <= 2;

        let reculLimite;
        if (isPalm) {
          reculLimite = plantRules.palmier_recul_limite_m ?? 0;
        } else if (isShrub) {
          reculLimite = plantRules.arbuste_recul_limite_m ?? 0.5;
        } else if (isTree) {
          reculLimite = plantRules.arbre_recul_limite_m ?? 2.0;
        } else {
          reculLimite = 0;
        }

        // Distance au bord de la parcelle
        if (reculLimite > 0) {
          const distBorder = _distToPolygonBorder(pos.x, pos.y, parcelLocal);
          if (distBorder < reculLimite) continue; // SKIP — trop près de la limite
        }

        plants.push({
          x: pos.x, y: pos.y,
          speciesKey: species.key,
          label: species.label,
          sci: species.sci,
          canopyRadius: species.canopyRadius ?? 2,
          trunkH: species.trunkH ?? 5,
          strate: species.strate ?? 'arbustif',
          svgSymbol: species.svgSymbol ?? 'broadleaf',
          isPalm: species.isPalm ?? false,
          growthForm: species.growthForm ?? 'tree',
          status: species.status ?? 'ok',
          zone: zone.type,
          patternId: pattern.patternId,
        });
      }
    }

    // Budget plantes
    const maxPlants = Math.min(200, Math.max(10, Math.round(parcelArea * 0.3)));
    const result = plants.slice(0, maxPlants);

    // Stats + vérification réglementaire
    const stats = this._computeStats(result, amenities, parcelLocal, buildingPoly);
    stats.plantationRules = this._checkPlantationCompliance(result, plantRules, parcelArea, buildingPoly);

    return {
      plants: result,
      amenities,
      stats,
      zoneClim,
      plantRules,
      patterns: zones.map(z => z.type),
    };
  },

  // ── GeoJSON (plantes + amenities) ───────────────────────────────
  toGeoJSON(plants, amenities, centroidGeo) {
    const [clng, clat] = centroidGeo;
    const LNG_M = 111320 * Math.cos(clat * Math.PI / 180);
    const LAT_M = 111320;

    const features = plants.map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [clng + p.x / LNG_M, clat - p.y / LAT_M] },
      properties: {
        kind: 'plant', speciesKey: p.speciesKey, label: p.label, sci: p.sci,
        canopyRadius: p.canopyRadius, trunkH: p.trunkH, strate: p.strate,
        svgSymbol: p.svgSymbol, zone: p.zone, status: p.status,
      },
    }));

    for (const am of (amenities ?? [])) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [clng + am.x / LNG_M, clat - am.y / LAT_M] },
        properties: {
          kind: 'amenity', amenityKey: am.amenityKey, label: am.label,
          svgSymbol: am.svgSymbol, w: am.w, h: am.h, note: am.note,
        },
      });
    }

    return { type: 'FeatureCollection', features };
  },

  // ── Helpers ──────────────────────────────────────────────────────

  _weightedSelect(strata, speciesDb, rng) {
    if (!strata?.length) return null;
    const totalWeight = strata.reduce((s, st) => s + (st.weight ?? 1), 0);
    let r = rng() * totalWeight;
    for (const st of strata) {
      r -= st.weight ?? 1;
      if (r <= 0) {
        const sp = speciesDb[st.speciesKey];
        return sp ? { key: st.speciesKey, ...sp } : null;
      }
    }
    const last = strata[strata.length - 1];
    const sp = speciesDb[last.speciesKey];
    return sp ? { key: last.speciesKey, ...sp } : null;
  },

  _extractPprnLocal(terrain, parcelLocal) {
    const pprnZones = terrain.pprn_zones_detected;
    if (!pprnZones) return [];
    const clat = parseFloat(terrain.lat ?? -21.15);
    const clng = parseFloat(terrain.lng ?? 55.45);
    const LNG_M = 111320 * Math.cos(clat * Math.PI / 180);
    const LAT_M = 111320;
    const parcelGeo = terrain.parcelle_geojson;
    let centGeo = [clng, clat];
    if (parcelGeo) {
      const ring = parcelGeo.type === 'Polygon'
        ? parcelGeo.coordinates[0]
        : parcelGeo.type === 'MultiPolygon'
          ? parcelGeo.coordinates[0][0] : null;
      if (ring) {
        let sx = 0, sy = 0;
        for (const [x, y] of ring) { sx += x; sy += y; }
        centGeo = [sx / ring.length, sy / ring.length];
      }
    }
    const result = [];
    for (const [zKey, zData] of Object.entries(pprnZones)) {
      if (!zData.inconstructible) continue;
      const geoCoords = zData.polygon ?? zData.coordinates;
      if (!geoCoords?.length) continue;
      const localPts = geoCoords.map(([lng, lat]) => ({
        x: (lng - centGeo[0]) * LNG_M,
        y: -(lat - centGeo[1]) * LAT_M,
      }));
      result.push({ polygon: localPts, zoneKey: zKey });
    }
    return result;
  },

  _computeStats(plants, amenities, parcelLocal, buildingPoly) {
    const parcelArea = _polyArea(parcelLocal);
    const buildingArea = buildingPoly?.length >= 3 ? _polyArea(buildingPoly) : 0;
    let amenityArea = 0;
    for (const am of (amenities ?? [])) {
      amenityArea += (am.w ?? 0) * (am.h ?? 0);
    }
    const gardenArea = parcelArea - buildingArea - amenityArea;

    const byStrate = {};
    const byZone = {};
    const bySpecies = {};
    let totalCanopy = 0;
    for (const p of plants) {
      byStrate[p.strate] = (byStrate[p.strate] ?? 0) + 1;
      byZone[p.zone] = (byZone[p.zone] ?? 0) + 1;
      bySpecies[p.speciesKey] = (bySpecies[p.speciesKey] ?? 0) + 1;
      totalCanopy += Math.PI * (p.canopyRadius ?? 1) ** 2;
    }

    return {
      totalPlants: plants.length,
      totalAmenities: (amenities ?? []).length,
      amenityList: (amenities ?? []).map(a => a.label),
      parcelArea: Math.round(parcelArea),
      buildingArea: Math.round(buildingArea),
      amenityArea: Math.round(amenityArea),
      gardenArea: Math.round(gardenArea),
      canopyCoverage: Math.round(totalCanopy),
      canopyPct: gardenArea > 0 ? Math.round(totalCanopy / gardenArea * 100) : 0,
      byStrate, byZone, bySpecies,
      speciesCount: Object.keys(bySpecies).length,
      protectedCount: plants.filter(p => p.status === 'protege').length,
      // Stats enrichies pour Sprint 5 — connexion PLU/GIEP
      arbres: plants.filter(p => !p.isPalm && (p.trunkH ?? 0) > 2).length,
      strates: Object.keys(byStrate),
      airesJeuxM2: (amenities ?? []).filter(a => a.type === 'aire_jeux').reduce((s, a) => s + (a.w ?? 0) * (a.h ?? 0), 0),
      permVegetaliseeM2: Math.round(Math.max(0, gardenArea * (totalCanopy > 0 ? Math.min(1, totalCanopy / gardenArea) : 0.6))),
    };
  },

  /**
   * Construit les zones de végétation depuis envZones (p07 capacity study)
   * envZones = { voie: {poly, width, bearing}, lat: [{poly, side}], fond: {poly, width}, perm: {poly, area} }
   */
  _zonesFromEnvZones(envZones, parcelLocal, buildingPoly) {
    const zones = [];

    // Zone voie → arbres d'alignement
    if (envZones.voie?.poly?.length >= 3) {
      zones.push({
        type: 'bande_voie',
        poly: envZones.voie.poly.map(p => Array.isArray(p) ? { x: p[0], y: p[1] } : p),
        width: envZones.voie.width ?? 3,
      });
    }

    // Zones latérales → haies
    for (const lat of (envZones.lat ?? [])) {
      if (lat.poly?.length >= 3) {
        zones.push({
          type: 'lateral',
          poly: lat.poly.map(p => Array.isArray(p) ? { x: p[0], y: p[1] } : p),
          side: lat.side,
        });
      }
    }

    // Zone fond → arbres endémiques
    if (envZones.fond?.poly?.length >= 3) {
      zones.push({
        type: 'fond_parcelle',
        poly: envZones.fond.poly.map(p => Array.isArray(p) ? { x: p[0], y: p[1] } : p),
        width: envZones.fond.width ?? 3,
      });
    }

    // Zone perméable résiduelle → jardins
    if (envZones.perm?.poly?.length >= 3) {
      zones.push({
        type: 'residuel',
        poly: envZones.perm.poly.map(p => Array.isArray(p) ? { x: p[0], y: p[1] } : p),
      });
    }

    return zones;
  },

  _checkPlantationCompliance(plants, rules, parcelArea, buildingPoly) {
    const buildingArea = buildingPoly?.length >= 3 ? _polyArea(buildingPoly) : 0;
    const gardenArea = parcelArea - buildingArea;
    const warnings = [];
    const ok = [];

    // Compter par type
    const trees = plants.filter(p => !p.isPalm && p.growthForm !== 'grass' && p.growthForm !== 'herb' && (p.trunkH ?? 0) > 2);
    const shrubs = plants.filter(p => p.strate === 'arbustif' || p.strate === 'couvre_sol');
    const palms = plants.filter(p => p.isPalm);

    // Règles communes
    ok.push(`Art. 671 CC : arbres à ${rules.arbre_recul_limite_m}m des limites`);
    ok.push(`Palmiers/bananiers = monocotylédones — pas soumis au recul arbres`);

    if (rules.arbre_inter_distance_m > 0) {
      ok.push(`Inter-distance arbres : ${rules.arbre_inter_distance_m}m (PLU)`);
    }
    if (rules.arbuste_recul_limite_m > 0.5) {
      ok.push(`Arbustes : ${rules.arbuste_recul_limite_m}m des limites (PLU > CC)`);
    }

    // Ratios obligatoires (Saint-Paul)
    if (rules.ratio_arbre_par_200m2) {
      const required = Math.max(1, Math.floor(gardenArea / 200) * rules.ratio_arbre_par_200m2);
      if (trees.length >= required) {
        ok.push(`Ratio arbres : ${trees.length}/${required} requis (1/${200}m²) ✓`);
      } else {
        warnings.push(`Ratio arbres insuffisant : ${trees.length}/${required} (1 arbre / 200m² maison indiv.)`);
      }
    }
    if (rules.ratio_arbuste_par_200m2) {
      const required = Math.max(1, Math.floor(gardenArea / 200) * rules.ratio_arbuste_par_200m2);
      if (shrubs.length >= required) {
        ok.push(`Ratio arbustes : ${shrubs.length}/${required} requis ✓`);
      } else {
        warnings.push(`Ratio arbustes insuffisant : ${shrubs.length}/${required}`);
      }
    }

    // 3 strates obligatoires
    if (rules.strates_min) {
      const strates = new Set(plants.map(p => p.strate));
      if (strates.size >= rules.strates_min) {
        ok.push(`${strates.size} strates végétales (min ${rules.strates_min}) ✓`);
      } else {
        warnings.push(`Seulement ${strates.size} strate(s) — ${rules.strates_min} requises (arborescente + arbustive + herbacée)`);
      }
    }

    // Espèces indigènes
    if (rules.especes_indigenes_prioritaires) {
      const indigenous = plants.filter(p => p.status === 'protege');
      if (indigenous.length > 0) {
        ok.push(`${indigenous.length} espèce(s) indigène(s)/protégée(s) ✓`);
      } else {
        warnings.push('PLU recommande espèces indigènes prioritaires — aucune dans le plan');
      }
    }

    const commune = rules.insee ? (PLANTATION_RULES_COMMUNE[rules.insee] ? `PLU commune ${rules.insee}` : 'Code Civil Art. 671') : 'Code Civil Art. 671';

    return { commune, ok, warnings, trees: trees.length, shrubs: shrubs.length, palms: palms.length };
  },

  async getSpecies(key) {
    const db = await _loadDb();
    return db.species[key] ?? null;
  },

  async getAmenity(key) {
    const db = await _loadDb();
    return db.amenities?.[key] ?? null;
  },

  async getAllPatterns() {
    const db = await _loadDb();
    return db.gardenPatterns;
  },
};

export default BpfBridge;
