// terlab/services/plan-masse-canvas.js
// PlanMasseCanvas — Éditeur SVG plan masse interactif inline
// Adapté de terlab-plan-editor-v7.html pour TERLAB Phase 7
// ENSA La Réunion · MGA Architecture 2026
// Vanilla JS ES2022+, aucune dépendance externe

const SVG_W = 860, SVG_H = 600, SCX = SVG_W / 2, SCY = SVG_H / 2 + 15, BS = 10;
const SNAP = 0.5, MIN_W = 4, MIN_L = 5, H_NIV = 3.0;
const COL = { voie: '#EF4444', lat: '#3B82F6', fond: '#22C55E' };
const DASH = { voie: '10,5', lat: '6,4', fond: '10,5' };
const NV = ['', 'R+0', 'R+1', 'R+2', 'R+3', 'R+4'];
const SP_MOY = 0.175 * 31 + 0.275 * 49 + 0.325 * 68 + 0.225 * 87;

// ── GÉOMÉTRIE ────────────────────────────────────────────────────
function lineIsect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d1x = x2 - x1, d1y = y2 - y1, d2x = x4 - x3, d2y = y4 - y3;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-8) return [(x2 + x3) / 2, (y2 + y3) / 2];
  const t = ((x3 - x1) * d2y - (y3 - y1) * d2x) / cross;
  const px = x1 + t * d1x, py = y1 + t * d1y;
  const r = 3 * Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), Math.abs(x4 - x3), Math.abs(y4 - y3), 15);
  if (Math.abs(px - x1) > r || Math.abs(py - y1) > r) return [(x2 + x3) / 2, (y2 + y3) / 2];
  return [px, py];
}

function _insetPoly(poly, reculs) {
  const n = poly.length;
  const ie = [];
  for (let i = 0; i < n; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
    const d = reculs[i] ?? 0, dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 1e-9) { ie.push([x1, y1, x2, y2]); continue; }
    const nx = -dy / len * d, ny = dx / len * d;
    ie.push([x1 + nx, y1 + ny, x2 + nx, y2 + ny]);
  }
  return ie.map((_, i) => {
    const [x1, y1, x2, y2] = ie[i], [x3, y3, x4, y4] = ie[(i + 1) % n];
    return lineIsect(x1, y1, x2, y2, x3, y3, x4, y4);
  });
}

function polyArea(pts) { let s = 0; for (let i = 0, n = pts.length; i < n; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n]; s += x1 * y2 - x2 * y1; } return Math.abs(s) / 2; }
function polyAABB(p) { const xs = p.map(v => v[0]), ys = p.map(v => v[1]); return { x: Math.min(...xs), y: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
function ptInPoly(px, py, poly) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside; } return inside; }

// ── Sutherland-Hodgman pour [x,y] ─────────────────────────────────
// En espace SVG (Y-down), un polygone CW visuel a signedArea < 0.
// On reverse le clip dans ce cas pour que cross >= 0 = intérieur.
function _signedAreaArr(pts) { let a = 0; for (let i = 0, n = pts.length; i < n; i++) { const j = (i + 1) % n; a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; } return a / 2; }
function clipSH(subject, clip) {
  if (!clip || clip.length < 3 || !subject || subject.length < 3) return [];
  const sa = _signedAreaArr(clip);
  const ccwClip = sa < 0 ? [...clip].reverse() : clip;
  const cross  = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const isect  = (a, b, c, d) => { const r = lineIsect(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]); return [r[0], r[1]]; };
  let output = [...subject];
  const n = ccwClip.length;
  for (let i = 0; i < n && output.length; i++) {
    const input = output;
    output = [];
    const a = ccwClip[i], b = ccwClip[(i + 1) % n];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const pIn = cross(a, b, p) >= 0;
      const qIn = cross(a, b, q) >= 0;
      if (pIn) { output.push(p); if (!qIn) output.push(isect(a, b, p, q)); }
      else if (qIn) output.push(isect(a, b, p, q));
    }
  }
  return output;
}
function distPtSeg(px, py, x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy; if (l2 < 1e-10) return Math.hypot(px - x1, py - y1); const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)); return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)); }

// Coins perdus : quand deux reculs se croisent à un angle aigu, la zone
// constructible perd un quadrilatère entre [parc[i-1], parc[i], zone[i-1], zone[i]].
// Détection : si dist(parc[i], zone[i]) > seuil (en mètres), le coin est perdu.
function lostCorners(parc, zone, seuilM = 1.2) {
  if (!parc || !zone || parc.length !== zone.length || parc.length < 3) return [];
  const corners = [];
  const n = parc.length;
  for (let i = 0; i < n; i++) {
    const pc = parc[i], zc = zone[i];
    const dist = Math.hypot(pc[0] - zc[0], pc[1] - zc[1]);
    if (dist > seuilM) {
      const prevP = parc[(i - 1 + n) % n];
      const prevZ = zone[(i - 1 + n) % n];
      corners.push([prevP, pc, zc, prevZ]);
    }
  }
  return corners;
}

function poleOfInaccessibility(poly, prec = 1.5) {
  const bb = polyAABB(poly);
  let best = [(bb.x + bb.x1) / 2, (bb.y + bb.y1) / 2], bestD = -Infinity;
  for (let x = bb.x + prec / 2; x <= bb.x1; x += prec) {
    for (let y = bb.y + prec / 2; y <= bb.y1; y += prec) {
      if (!ptInPoly(x, y, poly)) continue;
      let minD = Infinity;
      for (let i = 0, n = poly.length; i < n; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n]; minD = Math.min(minD, distPtSeg(x, y, x1, y1, x2, y2)); }
      if (minD > bestD) { bestD = minD; best = [x, y]; }
    }
  }
  return best;
}

// Bruit végétation
function h1(n) { return Math.abs(Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1; }

// ═════════════════════════════════════════════════════════════════════
// PlanMasseCanvas — singleton
// ═════════════════════════════════════════════════════════════════════

const PlanMasseCanvas = {

  // ── ÉTAT ──────────────────────────────────────────────────────────
  _el: null,         // conteneur <div>
  _svg: null,        // <svg>
  _session: null,
  _terrain: null,    // { poly, edgeTypes, reculs, area, plu, parcelGeo, geoOrigin }
  _ready: false,

  // ── BIL : contours + NGR aux sommets ─────────────────────────────
  _contourData: null,   // { lines, linesLocal:[{level,pts}], interval, minAlt, maxAlt }
  _cornerAlts:  null,   // [{ kind, coord, alt, local:{x,y} }]

  S: {
    bat: { x: 5, y: 4, w: 10, l: 12 },
    prog: { type: 'maison', nvMax: 2, profMax: 15, parkMode: 'ext', parkSS: false, maxUnits: 20 },
    parkSide: 'est',
    edgeTypes: [],
    mitoyen: [],
    zoom: 1, panX: 0, panY: 0, wcx: 15, wcy: 15,
    layers: { reculs: true, env: true, veg: true, parking: true, dims: true, pir: false, contours: true, ngr: true },
    view: 'plan',  // 'plan' | 'coupe'
    _insetWarn: null,
  },

  _drag: null,

  // Scénarios Pareto (par défaut : B1)
  _scenarios: [
    { id: 'A1', nv: 3, eff: 0.80, aide: 0.70, col: '#7C3AED', label: 'max densité' },
    { id: 'B1', nv: 3, eff: 0.82, aide: 0.60, col: '#2563EB', label: 'équilibre' },
    { id: 'B2', nv: 2, eff: 0.85, aide: 0.55, col: '#0891B2', label: 'durable' },
    { id: 'C1', nv: 2, eff: 0.88, aide: 0.50, col: '#059669', label: 'verdure' },
  ],
  _scId: 'B1',

  curSc() { return this._scenarios.find(s => s.id === this._scId) ?? this._scenarios[1]; },
  nvMaxPLU() { return Math.max(1, Math.floor((this._terrain?.plu?.heMax ?? 9) / H_NIV)); },

  // ═════════════════════════════════════════════════════════════════
  // INIT
  // ═════════════════════════════════════════════════════════════════

  init(containerId, session) {
    this._el = document.getElementById(containerId);
    if (!this._el) { console.warn('[PMC] conteneur introuvable:', containerId); return; }
    this._session = session ?? {};

    // Créer le SVG
    this._svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this._svg.id = 'pmc-svg';
    this._svg.style.cssText = 'display:block;width:100%;height:100%;cursor:crosshair;touch-action:none;user-select:none;background:#ede8dc';
    this._el.innerHTML = '';
    this._el.appendChild(this._svg);

    // Extraire terrain de la session
    this._buildTerrain();

    // Init état
    this.S.edgeTypes = [...this._terrain.edgeTypes];
    this.S.mitoyen = new Array(this._terrain.poly.length).fill(false);

    // Adapter programme depuis session
    const p7 = session?.phases?.[7]?.data ?? {};
    if (p7.niveaux) this.S.prog.nvMax = Math.min(parseInt(p7.niveaux) || 2, this.nvMaxPLU());

    // Restaurer types d'arêtes et mitoyen depuis session si présents
    if (Array.isArray(p7.pmc_edgeTypes) && p7.pmc_edgeTypes.length === this.S.edgeTypes.length) {
      this.S.edgeTypes = [...p7.pmc_edgeTypes];
    }
    if (Array.isArray(p7.pmc_mitoyen) && p7.pmc_mitoyen.length === this.S.mitoyen.length) {
      this.S.mitoyen = p7.pmc_mitoyen.map(Boolean);
    }

    // Auto-placer bâtiment par PIR
    this._initBatFromPIR();
    this._resetView();

    // Events
    this._bindEvents();
    this._ready = true;

    // Premier rendu
    this.render();
    console.log(`[PMC] Plan masse canvas initialisé — terrain ${Math.round(this._terrain.area)} m²`);

    // Charger BIL en arrière-plan (contours + NGR sommets), puis re-render
    Promise.all([this._loadContoursOnce(), this._loadCornerAltsOnce()])
      .then(() => { if (this._ready) this.render(); })
      .catch(e => console.warn('[PMC] BIL load failed:', e));

    console.info('[PMC] Plan masse canvas initialisé — terrain', Math.round(this._terrain.area), 'm²');
    return this;
  },

  _buildTerrain() {
    const ses = this._session;
    const terrain = ses?.terrain ?? {};
    const p4 = ses?.phases?.[4]?.data ?? {};
    const pluCfg = ses?.pluConfig ?? {};

    // Parcelle locale
    let parcelLocal = ses._parcelLocal ?? [];
    let edgeTypes = ses._edgeTypes ?? [];

    // Si pas de parcelLocal, fallback rectangulaire
    if (parcelLocal.length < 3) {
      const contenance = parseFloat(terrain.contenance_m2 ?? 600);
      const side = Math.sqrt(contenance);
      const w = side * 1.2, h = side / 1.2;
      parcelLocal = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
      edgeTypes = ['voie', 'lat', 'fond', 'lat'];
    }

    const poly = parcelLocal.map(p => [p.x ?? p[0], p.y ?? p[1]]);
    if (edgeTypes.length < poly.length) {
      edgeTypes = poly.map((_, i) => i === 0 ? 'voie' : i === poly.length - 1 ? 'fond' : 'lat');
    }

    const area = polyArea(poly) || parseFloat(terrain.contenance_m2 ?? 600);

    // Règle BINAIRE latérale : 0 (mitoyen) OU Lmin (recul std), jamais entre.
    // Lmin = max(valeur PLU, 3m) — minimum réglementaire La Réunion.
    // La mitoyenneté est gérée per-arête via S.mitoyen[i] dans edgeRecul().
    const Lraw = parseFloat(p4.recul_limite_sep_m ?? p4.recul_lat_m ?? pluCfg?.reculs?.lat ?? 3);
    const Lmin = (Number.isFinite(Lraw) && Lraw > 0) ? Lraw : 3;
    const reculs = {
      voie: parseFloat(p4.recul_voie_m ?? p4.recul_avant_m ?? pluCfg?.reculs?.voie ?? 3) || 3,
      fond: parseFloat(p4.recul_fond_m ?? pluCfg?.reculs?.fond ?? 3) || 3,
      lat:  Math.max(Lmin, 0),  // jamais inférieur au minimum réglementaire
    };

    const emprMaxRaw = parseFloat(p4.ces_max ?? pluCfg?.plu?.emprMax ?? 60);
    const plu = {
      emprMax: emprMaxRaw > 1 ? emprMaxRaw : emprMaxRaw * 100,
      permMin: parseFloat(pluCfg?.plu?.permMin ?? p4.permeabilite_min_pct ?? 25),
      heMax: parseFloat(p4.hauteur_egout_m ?? p4.hauteur_max_m ?? pluCfg?.plu?.heMax ?? 9),
      rtaaZone: parseInt(terrain.zone_rtaa ?? 2),
      zone: p4.zone_plu ?? pluCfg?.meta?.zone ?? 'U',
      interBatMin: parseFloat(pluCfg?.plu?.interBatMin ?? 4),
      constructible: (p4.zone_plu ?? 'U').charAt(0) !== 'A' && (p4.zone_plu ?? 'U').charAt(0) !== 'N',
    };

    // Origine géographique = centroïde de la parcelle WGS84 (cohérent avec EsquisseCanvas._geoToLocal)
    let parcelGeo = null, geoOrigin = null;
    const geom = terrain?.parcelle_geojson;
    if (geom?.type === 'Polygon')      parcelGeo = geom.coordinates[0];
    else if (geom?.type === 'MultiPolygon') parcelGeo = geom.coordinates[0]?.[0];
    if (parcelGeo?.length) {
      // Supprimer point de fermeture GeoJSON
      const r = parcelGeo;
      if (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) {
        parcelGeo = r.slice(0, -1);
      }
      const clng = parcelGeo.reduce((s, c) => s + c[0], 0) / parcelGeo.length;
      const clat = parcelGeo.reduce((s, c) => s + c[1], 0) / parcelGeo.length;
      geoOrigin = { clng, clat, LNG: 111320 * Math.cos(clat * Math.PI / 180), LAT: 111320 };
    }

    this._terrain = { poly, edgeTypes, reculs, area, plu, commune: terrain.commune ?? 'Commune', reference: terrain.reference ?? '', parcelGeo, geoOrigin };
  },

  // ── CONVERSION WGS84 → local mètres (cohérent avec EsquisseCanvas) ─
  _geoToLocal(coords) {
    const o = this._terrain?.geoOrigin;
    if (!o) return coords.map(() => ({ x: 0, y: 0 }));
    return coords.map(([lng, lat]) => ({
      x:  (lng - o.clng) * o.LNG,
      y: -(lat - o.clat) * o.LAT,
    }));
  },

  // ── BIL : courbes de niveau (une seule fois) ───────────────────────
  async _loadContoursOnce() {
    if (this._contourData || !window.ContourService || !window.BILTerrain) return;
    if (!this._terrain?.parcelGeo?.length) return;
    const pg = this._terrain.parcelGeo;
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lng, lat] of pg) {
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    }
    const lat0 = (minLat + maxLat) / 2;
    const padM = 8;
    const dLat = padM / 111320;
    const dLng = padM / (111320 * Math.cos(lat0 * Math.PI / 180));
    try {
      const data = await window.ContourService.fromBIL(
        { west: minLng - dLng, east: maxLng + dLng, south: minLat - dLat, north: maxLat + dLat },
        { pixelSizeM: 1.0, maxDim: 220 }
      );
      // Convertir chaque polyline WGS → local mètres (cohérent avec _terrain.poly)
      data.linesLocal = data.lines.map(l => ({
        level: l.level,
        pts: this._geoToLocal(l.coords).map(p => [p.x, p.y]),
      }));
      this._contourData = data;
    } catch (e) {
      console.warn('[PMC] contours BIL failed:', e.message);
      this._contourData = null;
    }
  },

  async _loadCornerAltsOnce() {
    if (this._cornerAlts || !window.ParcelAltitudes) return;
    if (!this._terrain?.parcelGeo?.length) return;
    try {
      const res = await window.ParcelAltitudes.sampleParcelKeyPoints(this._terrain.parcelGeo, { longEdgeM: 30 });
      // Pré-projeter en local pour rendu rapide
      this._cornerAlts = res.points.map(pt => {
        const [lp] = this._geoToLocal([pt.coord]);
        return { ...pt, local: lp };
      });
    } catch (e) {
      console.warn('[PMC] NGR sample failed:', e.message);
      this._cornerAlts = null;
    }
  },

  // ── ENVELOPPE ─────────────────────────────────────────────────────

  // Recul effectif d'une arête. Latéral = BINAIRE (0 mitoyen, sinon Lmin).
  // Voie / fond : valeur PLU directe.
  edgeRecul(i) {
    const t = this.S.edgeTypes[i];
    if (t === 'lat') {
      // Règle binaire stricte : mitoyen → 0, sinon recul standard
      return this.S.mitoyen[i] ? 0 : (this._terrain.reculs.lat ?? 0);
    }
    return this._terrain.reculs[t] ?? 0;
  },

  computeEnvPoly() {
    const t = this._terrain;
    const R = this.S.edgeTypes.map((_, i) => this.edgeRecul(i));
    let env = _insetPoly(t.poly, R);
    const area = polyArea(env);
    if (area <= 5) {
      const bb = polyAABB(t.poly);
      const lMin = Math.min(bb.w, bb.h);
      const rMax = Math.max(...R.filter(r => r > 0), 1);
      const ratio = Math.min(0.85, lMin / (2.2 * rMax));
      env = _insetPoly(t.poly, R.map(r => r * ratio));
      this.S._insetWarn = `Reculs réduits ×${ratio.toFixed(2)} — parcelle étroite`;
    } else { this.S._insetWarn = null; }
    return env;
  },

  computeEnv() {
    const poly = this.computeEnvPoly();
    return { ...polyAABB(poly), poly };
  },

  // ── BAT POSITION ──────────────────────────────────────────────────

  _initBatFromPIR() {
    if (!this._terrain.plu.constructible) return;
    const env = this.computeEnv();
    if (!env || polyArea(env.poly) < MIN_W * MIN_L) return;
    const pir = poleOfInaccessibility(env.poly, 1.5);
    const p = this.S.prog;
    const plu = this._terrain.plu;
    const rtaaW = plu.rtaaZone === 1 ? 10 : 12;
    const profMaxEff = p.type === 'maison' ? Math.min(p.profMax, 12) : p.profMax;
    const bw = p.type === 'maison'
      ? Math.min(rtaaW, env.w * 0.7)
      : Math.min(rtaaW, env.w * 0.55, profMaxEff);
    const bl = p.type === 'maison'
      ? Math.min(profMaxEff, env.h * 0.8)
      : Math.min(profMaxEff, env.h * 0.65);
    this.S.bat = { x: this._snap(pir[0] - bw / 2), y: this._snap(pir[1] - bl / 2), w: Math.max(MIN_W, this._snap(bw)), l: Math.max(MIN_L, this._snap(bl)) };
    this._clampBat();
  },

  _snap(v) { return Math.round(v / SNAP) * SNAP; },

  // Vérifie que les 4 coins du rectangle bâtiment sont dans la zone
  // constructible (polygone réel, pas seulement sa bbox).
  _batCornersInPoly(b, poly) {
    if (!poly || poly.length < 3) return true;
    const corners = [
      [b.x,       b.y      ],
      [b.x + b.w, b.y      ],
      [b.x + b.w, b.y + b.l],
      [b.x,       b.y + b.l],
    ];
    return corners.every(([px, py]) => ptInPoly(px, py, poly));
  },

  // Clamp dur du bâtiment dans la zone constructible.
  // 1) clamp dimensions à la bbox de l'enveloppe
  // 2) clamp position à la bbox de l'enveloppe
  // 3) si un coin sort encore du polygone réel (parcelle non rectangulaire),
  //    interpolation linéaire vers le PIR jusqu'à ce que les 4 coins rentrent.
  _clampBat() {
    const env = this.computeEnv();
    const b = this.S.bat;
    if (!env || !env.poly || env.poly.length < 3) return;

    // 1) Dimensions
    b.w = Math.max(MIN_W, Math.min(b.w, env.w));
    b.l = Math.max(MIN_L, Math.min(b.l, env.h));

    // 2) Position bbox
    b.x = Math.max(env.x, Math.min(env.x1 - b.w, b.x));
    b.y = Math.max(env.y, Math.min(env.y1 - b.l, b.y));

    // 3) Test polygone réel — early exit si déjà légal
    if (this._batCornersInPoly(b, env.poly)) return;

    // Converger vers le PIR par dichotomie : on garde les dimensions et on
    // déplace le rectangle vers le point d'inaccessibilité jusqu'à ce que
    // les 4 coins soient dans le polygone.
    const pir = poleOfInaccessibility(env.poly, 1.5);
    const cxTarget = pir[0] - b.w / 2;
    const cyTarget = pir[1] - b.l / 2;
    let lo = 0, hi = 1;
    let bestX = b.x, bestY = b.y, found = false;
    for (let iter = 0; iter < 16; iter++) {
      const t = (lo + hi) / 2;
      const tx = b.x + (cxTarget - b.x) * t;
      const ty = b.y + (cyTarget - b.y) * t;
      if (this._batCornersInPoly({ x: tx, y: ty, w: b.w, l: b.l }, env.poly)) {
        bestX = tx; bestY = ty; found = true;
        hi = t; // peut-on bouger moins ?
      } else {
        lo = t; // pas assez convergé
      }
    }
    if (found) { b.x = this._snap(bestX); b.y = this._snap(bestY); }
    else       { b.x = this._snap(cxTarget); b.y = this._snap(cyTarget); }

    // Filet final : si dimensions trop grandes pour la zone, réduire
    // itérativement jusqu'à atteindre une forme légale ou MIN.
    let guard = 12;
    while (guard-- > 0 && !this._batCornersInPoly(b, env.poly)) {
      if (b.w > MIN_W) b.w = Math.max(MIN_W, b.w * 0.9);
      if (b.l > MIN_L) b.l = Math.max(MIN_L, b.l * 0.9);
      b.x = pir[0] - b.w / 2;
      b.y = pir[1] - b.l / 2;
      if (b.w === MIN_W && b.l === MIN_L) break;
    }
    b.x = this._snap(b.x);
    b.y = this._snap(b.y);
    b.w = this._snap(b.w);
    b.l = this._snap(b.l);
  },

  // ── TRANSFORMS ─────────────────────────────────────────────────────

  _w2s(wx, wy) { const sc = BS * this.S.zoom; return [SCX + (wx - this.S.wcx) * sc + this.S.panX, SCY - (wy - this.S.wcy) * sc + this.S.panY]; },
  _s2w(sx, sy) { const sc = BS * this.S.zoom; return [this.S.wcx + (sx - SCX - this.S.panX) / sc, this.S.wcy + (SCY + this.S.panY - sy) / sc]; },
  _px(m) { return m * BS * this.S.zoom; },

  _resetView() {
    if (!this._terrain) return;
    const bb = polyAABB(this._terrain.poly);
    this.S.wcx = bb.x + bb.w / 2;
    this.S.wcy = bb.y + bb.h / 2;
    const margin = 80;
    this.S.zoom = Math.max(0.2, Math.min(6, Math.min(
      (SVG_W - 2 * margin) / (bb.w * BS),
      (SVG_H - 2 * margin) / (bb.h * BS)
    )));
    this.S.panX = 0;
    this.S.panY = 0;
  },

  // ── HELPERS SVG ────────────────────────────────────────────────────

  _ra(hex, a) { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return `rgba(${r},${g},${b},${a})`; },
  _polyPts(pts) { return pts.map(([x, y]) => this._w2s(x, y).join(',')).join(' '); },
  _tx(wx, wy, str, sz, fill, anch = 'middle') { const [sx, sy] = this._w2s(wx, wy); return `<text x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" text-anchor="${anch}" font-size="${sz}" fill="${fill}" font-family="'Inconsolata',monospace">${str}</text>`; },
  _dd(n) { return n.toFixed(1); },

  // ── MÉTRIQUES ─────────────────────────────────────────────────────

  metrics() {
    const t = this._terrain, plu = t.plu, b = this.S.bat, p = this.S.prog, sc = this.curSc();
    const env = this.computeEnv();
    const nvEffMax = this.nvMaxPLU(), nvEff = Math.min(p.nvMax, nvEffMax);
    const emprise = b.w * b.l, empPct = emprise / t.area * 100;
    let spBase = emprise;
    if (p.parkMode === 'rdc') spBase *= 0.75;
    const spTot = spBase * sc.eff * nvEff;
    const nbLgts = p.type === 'maison' ? 1 : Math.floor(spTot / SP_MOY);
    const nbAide = p.type === 'maison' ? 0 : Math.round(nbLgts * sc.aide);
    const parkReq = p.type === 'maison' ? 2 : (nbLgts - nbAide) * 2 + nbAide + Math.ceil(nbLgts / 5);
    let parkExt = 0, parkSS = 0, empPark = 0;
    if (p.parkMode === 'ss') { parkSS = parkReq; }
    else if (p.parkMode === 'rdc') { parkExt = Math.floor(emprise * 0.25 / 25); if (p.parkSS) parkSS = Math.max(0, parkReq - parkExt); }
    else { parkExt = parkReq; empPark = parkExt * 25; if (p.parkSS) { parkExt = 0; parkSS = parkReq; empPark = 0; } }
    const impermeab = emprise + empPark;
    const permPct = Math.max(0, (1 - impermeab / t.area) * 100);
    const dens = nbLgts / (t.area / 10000);
    const rtaaW = plu.rtaaZone === 1 ? 10 : 12;
    const inEnv = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.l], [b.x, b.y + b.l]].every(([px, py]) => ptInPoly(px, py, env.poly));
    const gapMin = Math.max(plu.interBatMin || 4, nvEff * H_NIV / 2);
    const nbBlocs = (p.type === 'collectif' && p.maxUnits > 0 && nbLgts > p.maxUnits) ? Math.ceil(nbLgts / Math.max(1, p.maxUnits)) : 1;
    const envArea = polyArea(env.poly);
    const maxLgts = Math.floor(envArea * plu.emprMax / 100 * sc.eff * nvEffMax / SP_MOY);
    const Q = 0.9 * (80 / 3600) * impermeab;

    const checks = [
      { lbl: 'Constructible', ok: !!plu.constructible, proj: plu.zone, rule: 'U/AU', u: '' },
      { lbl: 'Dans env.', ok: inEnv, proj: inEnv ? 'oui' : 'NON', rule: 'requis', u: '' },
      { lbl: 'Larg. RTAA', ok: b.w <= rtaaW, proj: b.w.toFixed(1), rule: `≤${rtaaW}`, u: 'm' },
      { lbl: 'Prof. N-S', ok: b.l <= (p.profMax ?? 25), proj: b.l.toFixed(1), rule: `≤${p.profMax ?? 25}`, u: 'm' },
      { lbl: 'Niv. PLU', ok: nvEff <= nvEffMax, proj: NV[nvEff] || nvEff, rule: `≤${NV[nvEffMax] || nvEffMax}`, u: '' },
      { lbl: 'Emprise', ok: empPct <= plu.emprMax, proj: empPct.toFixed(1), rule: `≤${plu.emprMax}`, u: '%' },
      { lbl: 'Perméab.', ok: permPct >= plu.permMin, proj: permPct.toFixed(1), rule: `≥${plu.permMin}`, u: '%' },
      { lbl: 'Densité SCoT', ok: dens >= 30, proj: dens.toFixed(0), rule: '≥30', u: 'l/ha' },
    ];

    return {
      sc, nvEff, nvEffMax, emprise, empPct, spTot, nbLgts, nbAide, nbLibre: nbLgts - nbAide,
      parkExt, parkSS, parkReq, empPark, impermeab, permPct, dens, Q,
      vGiep: Q * 600, sNoue: Q * 600 / 0.30, inEnv, checks,
      allOk: checks.every(c => c.ok), nbBlocs, gapMin, rtaaW, maxLgts, envArea,
    };
  },

  getBlocRects(m) {
    const b = this.S.bat, nb = m.nbBlocs;
    if (nb <= 1) return [b];
    const g = m.gapMin, tg = (nb - 1) * g, bw = (b.w - tg) / nb;
    if (bw >= MIN_W) return Array.from({ length: nb }, (_, i) => ({ x: b.x + i * (bw + g), y: b.y, w: bw, l: b.l }));
    const bl = (b.l - tg) / nb;
    return bl >= MIN_L ? Array.from({ length: nb }, (_, i) => ({ x: b.x, y: b.y + i * (bl + g), w: b.w, l: bl })) : [b];
  },

  // ═════════════════════════════════════════════════════════════════
  // RENDU PLAN
  // ═════════════════════════════════════════════════════════════════

  renderPlan(m) {
    const t = this._terrain, b = this.S.bat, sc = m.sc, env = this.computeEnv();
    const batCol = m.inEnv ? sc.col : '#EF4444';
    const parts = [];
    const bb = polyAABB(t.poly);
    const x0 = bb.x, x1 = bb.x1, y0 = bb.y, y1 = bb.y1;

    // Defs
    parts.push(`<defs>
      <pattern id="pmc-hatch" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="rgba(100,100,100,.35)" stroke-width="1.4"/></pattern>
      <clipPath id="pmc-tc"><polygon points="${this._polyPts(t.poly)}"/></clipPath>
    </defs>`);

    // Fond papier
    parts.push(`<rect width="${SVG_W}" height="${SVG_H}" fill="#ede8dc"/>`);
    parts.push(`<polygon points="${this._polyPts(t.poly)}" fill="#EAE3D3" stroke="none"/>`);

    // Grille 5m
    { let g = `<g opacity=".10" clip-path="url(#pmc-tc)">`;
      for (let gx = Math.ceil(x0); gx <= x1; gx += 5) { const [gsx] = this._w2s(gx, 0); const [, a] = this._w2s(0, y1); const [, c] = this._w2s(0, y0); g += `<line x1="${this._dd(gsx)}" y1="${this._dd(a)}" x2="${this._dd(gsx)}" y2="${this._dd(c)}" stroke="#70634A" stroke-width=".4"/>`; }
      for (let gy = Math.ceil(y0); gy <= y1; gy += 5) { const [a] = this._w2s(x0, 0); const [c] = this._w2s(x1, 0); const [, gsy] = this._w2s(0, gy); g += `<line x1="${this._dd(a)}" y1="${this._dd(gsy)}" x2="${this._dd(c)}" y2="${this._dd(gsy)}" stroke="#70634A" stroke-width=".4"/>`; }
      parts.push(g + '</g>');
    }

    // Courbes de niveau BIL (clipées sur la parcelle)
    if (this.S.layers.contours && this._contourData?.linesLocal?.length) {
      const interval = this._contourData.interval ?? 1;
      const majorEvery = interval * 5;
      let cg = `<g clip-path="url(#pmc-tc)" pointer-events="none">`;
      for (const line of this._contourData.linesLocal) {
        if (line.pts.length < 2) continue;
        const isMajor = Math.abs(line.level % majorEvery) < 0.01;
        const d = 'M' + line.pts.map(([x, y]) => {
          const [sx, sy] = this._w2s(x, y);
          return `${this._dd(sx)},${this._dd(sy)}`;
        }).join(' L');
        cg += `<path d="${d}" fill="none" stroke="${isMajor ? '#8a6e3e' : '#c4b396'}" stroke-width="${isMajor ? 1.0 : 0.6}" opacity="${isMajor ? 0.78 : 0.55}" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      // Étiquettes altitude — sur les courbes majeures les plus longues
      let labeled = 0;
      const majorLines = this._contourData.linesLocal
        .filter(l => Math.abs(l.level % majorEvery) < 0.01 && l.pts.length >= 4)
        .sort((a, b) => b.pts.length - a.pts.length);
      for (const line of majorLines) {
        if (labeled >= 4) break;
        const mid = line.pts[Math.floor(line.pts.length / 2)];
        const [sx, sy] = this._w2s(mid[0], mid[1]);
        cg += `<text x="${this._dd(sx + 2)}" y="${this._dd(sy - 2)}" font-family="'Inconsolata',monospace" font-size="9" font-weight="700" fill="#6a5430">${Math.round(line.level)} m</text>`;
        labeled++;
      }
      parts.push(cg + '</g>');
    }

    // Zone fills recul
    if (this.S.layers.reculs) {
      const envPoly = this.computeEnvPoly();
      const n = t.poly.length;
      for (let i = 0; i < n; i++) {
        const type = this.S.edgeTypes[i];
        const r = this.edgeRecul(i);
        if (r <= 0) continue;
        const col = COL[type];
        const [p1x, p1y] = t.poly[i], [p2x, p2y] = t.poly[(i + 1) % n];
        const [e1x, e1y] = envPoly[i], [e2x, e2y] = envPoly[(i + 1) % n];
        const pts = [[p1x, p1y], [p2x, p2y], [e2x, e2y], [e1x, e1y]].map(([x, y]) => this._w2s(x, y).map(v => this._dd(v)).join(',')).join(' ');
        parts.push(`<polygon points="${pts}" fill="${this._ra(col, .09)}" stroke="none"/>`);
      }
    }

    // Terrain outline
    parts.push(`<polygon points="${this._polyPts(t.poly)}" fill="none" stroke="rgba(100,88,68,.5)" stroke-width="1.5"/>`);
    parts.push(this._tx((x0 + x1) / 2, y0 - 1.6, `${t.area.toFixed(0)} m² · ${t.commune}`, 8.5, 'rgba(100,88,68,.7)'));

    // Arêtes colorées — épaisseur double + label "MITOYEN" pour les
    // arêtes latérales en limite (recul = 0 par règle binaire PLU)
    { const n = t.poly.length;
      for (let i = 0; i < n; i++) {
        const [p1x, p1y] = t.poly[i], [p2x, p2y] = t.poly[(i + 1) % n];
        const [sx1, sy1] = this._w2s(p1x, p1y), [sx2, sy2] = this._w2s(p2x, p2y);
        const type = this.S.edgeTypes[i];
        const col = COL[type];
        const isMit = type === 'lat' && this.S.mitoyen[i];
        const sw = isMit ? 7 : 4;
        const op = isMit ? 0.92 : 0.68;
        parts.push(`<line x1="${this._dd(sx1)}" y1="${this._dd(sy1)}" x2="${this._dd(sx2)}" y2="${this._dd(sy2)}" stroke="${col}" stroke-width="${sw}" opacity="${op}" stroke-linecap="round"/>`);
        if (isMit) {
          // Label MITOYEN (0m) sur le milieu de l'arête
          const mx = (p1x + p2x) / 2, my = (p1y + p2y) / 2;
          const dx = p2x - p1x, dy = p2y - p1y, len = Math.hypot(dx, dy) || 1;
          const nxu = -dy / len, nyu = dx / len;
          const lx = mx + nxu * 1.0, ly = my + nyu * 1.0;
          const [slx, sly] = this._w2s(lx, ly);
          parts.push(`<rect x="${this._dd(slx - 30)}" y="${this._dd(sly - 9)}" width="60" height="13" fill="rgba(59,130,246,.92)" rx="2"/>`);
          parts.push(`<text x="${this._dd(slx)}" y="${this._dd(sly + 1)}" text-anchor="middle" font-size="9" font-weight="700" fill="white" font-family="'Inconsolata',monospace">MITOYEN 0m</text>`);
        }
      }
    }

    // Inset lines + labels
    if (this.S.layers.reculs) {
      const n = t.poly.length;
      for (let i = 0; i < n; i++) {
        const type = this.S.edgeTypes[i];
        const r = this.edgeRecul(i);
        const col = COL[type];
        const [p1x, p1y] = t.poly[i], [p2x, p2y] = t.poly[(i + 1) % n];
        const dx = p2x - p1x, dy = p2y - p1y, len = Math.hypot(dx, dy);
        if (len < 0.1) continue;
        const nxu = -dy / len, nyu = dx / len;
        if (r > 0) {
          const ix1 = p1x + nxu * r, iy1 = p1y + nyu * r, ix2 = p2x + nxu * r, iy2 = p2y + nyu * r;
          const [si1x, si1y] = this._w2s(ix1, iy1), [si2x, si2y] = this._w2s(ix2, iy2);
          parts.push(`<line x1="${this._dd(si1x)}" y1="${this._dd(si1y)}" x2="${this._dd(si2x)}" y2="${this._dd(si2y)}" stroke="${col}" stroke-width="1.1" stroke-dasharray="${DASH[type]}" opacity=".88" clip-path="url(#pmc-tc)"/>`);
          // Label
          const mx = (p1x + p2x) / 2 + nxu * r * 0.5, my = (p1y + p2y) / 2 + nyu * r * 0.5;
          const [slx, sly] = this._w2s(mx, my);
          const tLabel = { voie: 'voie', fond: 'fond', lat: 'lat.' }[type];
          const tw = (tLabel.length + r.toFixed(1).length + 2) * 4.6;
          parts.push(`<rect x="${this._dd(slx - tw / 2)}" y="${this._dd(sly - 9)}" width="${this._dd(tw)}" height="12" fill="rgba(240,237,225,.8)" rx="2" clip-path="url(#pmc-tc)"/>`);
          parts.push(`<text x="${this._dd(slx)}" y="${this._dd(sly)}" text-anchor="middle" font-size="8.5" fill="${col}" font-family="'Inconsolata',monospace" font-weight="600" clip-path="url(#pmc-tc)">${tLabel} ${r}m</text>`);
        }
      }
    }

    // Coins perdus (Fm.24c) — quadrilatères orange aux angles aigus
    // Quand deux reculs se croisent à un angle < 90°, la zone perd un quadrilatère.
    if (this.S.layers.reculs && this._terrain.plu.constructible) {
      const corners = lostCorners(t.poly, env.poly, 1.2);
      for (const corner of corners) {
        const pts = corner.map(([x, y]) => this._w2s(x, y).map(v => this._dd(v)).join(',')).join(' ');
        parts.push(`<polygon points="${pts}" fill="rgba(251,146,0,.35)" stroke="#F59E0B" stroke-width="1.1" stroke-dasharray="3,2"/>`);
        const cx = corner.reduce((s, p) => s + p[0], 0) / corner.length;
        const cy = corner.reduce((s, p) => s + p[1], 0) / corner.length;
        parts.push(this._tx(cx, cy, 'coin perdu', 6.5, 'rgba(146,64,14,.85)'));
      }
    }

    // Enveloppe
    if (this.S.layers.env && this._terrain.plu.constructible) {
      parts.push(`<polygon points="${this._polyPts(env.poly)}" fill="rgba(34,197,94,.07)" stroke="#22C55E" stroke-width="1.2" stroke-dasharray="8,4"/>`);
      const ebb = polyAABB(env.poly);
      parts.push(this._tx((ebb.x + ebb.x1) / 2, ebb.y1 + 1.5, `env. ${polyArea(env.poly).toFixed(0)} m² · max ${this._terrain.plu.emprMax}% = ${(polyArea(env.poly) * this._terrain.plu.emprMax / 100).toFixed(0)} m²`, 7.5, 'rgba(34,197,94,.75)'));
    }

    // Végétation
    if (this.S.layers.veg && this._terrain.plu.constructible) {
      const plants = this._computeVegPlants(m);
      for (const p of plants) this._drawPlant(parts, p.x, p.y, p.r, p.type, p.s);
    }

    // Parking
    if (this.S.layers.parking && this.S.prog.parkMode === 'ext' && !this.S.prog.parkSS && m.parkReq > 0 && this._terrain.plu.constructible) {
      const GAP = 1.0, totalArea = m.parkReq * 25;
      const env2 = this.computeEnv();
      let pkx, pkl, pkw, pkbb;
      if (this.S.parkSide === 'est') { const av = env2.x1 - (b.x + b.w) - GAP; pkw = Math.max(4, Math.min(13, av)); pkl = Math.min(env2.h, Math.max(5, totalArea / pkw)); pkx = Math.min(b.x + b.w + GAP, env2.x1 - pkw); pkbb = Math.max(env2.y, Math.min(b.y, env2.y1 - pkl)); }
      else if (this.S.parkSide === 'ouest') { const av = b.x - env2.x - GAP; pkw = Math.max(4, Math.min(13, av)); pkl = Math.min(env2.h, Math.max(5, totalArea / pkw)); pkx = Math.max(env2.x, b.x - pkw - GAP); pkbb = Math.max(env2.y, Math.min(b.y, env2.y1 - pkl)); }
      else if (this.S.parkSide === 'nord') { const av = env2.y1 - (b.y + b.l) - GAP; pkl = Math.max(4, Math.min(13, av)); pkw = Math.min(env2.w, Math.max(5, totalArea / pkl)); pkx = Math.max(env2.x, Math.min(b.x, env2.x1 - pkw)); pkbb = Math.min(b.y + b.l + GAP, env2.y1 - pkl); }
      else { const av = b.y - env2.y - GAP; pkl = Math.max(4, Math.min(13, av)); pkw = Math.min(env2.w, Math.max(5, totalArea / pkl)); pkx = Math.max(env2.x, Math.min(b.x, env2.x1 - pkw)); pkbb = Math.max(env2.y, b.y - pkl - GAP); }
      const [prx, pry] = this._w2s(pkx, pkbb + pkl);
      parts.push(`<rect x="${this._dd(prx)}" y="${this._dd(pry)}" width="${this._dd(this._px(pkw))}" height="${this._dd(this._px(pkl))}" fill="rgba(172,164,140,.32)" stroke="rgba(120,112,90,.45)" stroke-width="1" rx="2"/>`);
      parts.push(`<rect x="${this._dd(prx)}" y="${this._dd(pry)}" width="${this._dd(this._px(pkw))}" height="${this._dd(this._px(pkl))}" fill="url(#pmc-hatch)" opacity=".4"/>`);
      parts.push(this._tx(pkx + pkw / 2, pkbb + pkl / 2, `${m.parkReq} PK`, 9, 'rgba(70,60,50,.7)'));
    }

    // Bâtiment — filet de sécurité : clip contre la zone constructible ET la
    // parcelle, puis vérification de surface minimale (12 m²). Si la forme
    // résultante est trop petite, on n'affiche RIEN et on remonte un warning.
    const SURFACE_MIN_M2 = 12;
    const batRect = [
      [b.x,         b.y],
      [b.x + b.w,   b.y],
      [b.x + b.w,   b.y + b.l],
      [b.x,         b.y + b.l],
    ];
    const batClipped = clipSH(clipSH(batRect, env.poly), t.poly);
    const batClippedArea = batClipped.length >= 3 ? polyArea(batClipped) : 0;
    const batSafe = batClippedArea >= SURFACE_MIN_M2;
    if (!batSafe) {
      this.S._insetWarn = `Bâtiment hors zone constructible (clip = ${batClippedArea.toFixed(1)} m²) — repositionnez ou ajustez les reculs`;
    }

    if (this._terrain.plu.constructible && batSafe) {
      const blocs = this.getBlocRects(m);
      blocs.forEach((bl, bi) => {
        const [bsx, bsy] = this._w2s(bl.x, bl.y + bl.l);
        const bw2 = this._px(bl.w), bh2 = this._px(bl.l);
        // Shadow + body
        parts.push(`<rect x="${this._dd(bsx + 4)}" y="${this._dd(bsy + 4)}" width="${this._dd(bw2)}" height="${this._dd(bh2)}" fill="rgba(0,0,0,.13)" rx="2"/>`);
        const bodyAttr = bi === 0 ? 'data-type="building-body" style="cursor:move"' : '';
        parts.push(`<rect x="${this._dd(bsx)}" y="${this._dd(bsy)}" width="${this._dd(bw2)}" height="${this._dd(bh2)}" fill="${this._ra(batCol, .22)}" stroke="${batCol}" stroke-width="2.5" rx="2" ${bodyAttr}/>`);

        // Varangue nord
        const vaH = Math.min(this._px(1.5), bh2 * .16);
        parts.push(`<rect x="${this._dd(bsx)}" y="${this._dd(bsy)}" width="${this._dd(bw2)}" height="${this._dd(vaH)}" fill="rgba(245,222,179,.6)" stroke="${batCol}" stroke-width=".9" stroke-dasharray="5,3" pointer-events="none"/>`);

        // Labels
        if (bi === 0) {
          const [cx, cy] = this._w2s(bl.x + bl.w / 2, bl.y + bl.l / 2);
          const nvL = NV[m.nvEff] || `R+${m.nvEff - 1}`;
          const sub = m.nbBlocs > 1 ? `${m.nbBlocs} blocs` : `${bl.w.toFixed(1)}×${bl.l.toFixed(1)}m`;
          parts.push(`<text x="${this._dd(cx)}" y="${this._dd(cy - 10)}" text-anchor="middle" font-size="16" fill="${batCol}" font-weight="700" font-family="'Playfair Display',sans-serif" pointer-events="none">${this.S.prog.type === 'maison' ? 'Maison' : `${m.nbLgts} lgts`}</text>`);
          parts.push(`<text x="${this._dd(cx)}" y="${this._dd(cy + 6)}" text-anchor="middle" font-size="9.5" fill="${batCol}" opacity=".85" font-family="'Inconsolata',monospace" pointer-events="none">${sub}</text>`);
          parts.push(`<text x="${this._dd(cx)}" y="${this._dd(cy + 19)}" text-anchor="middle" font-size="9" fill="${batCol}" opacity=".65" font-family="'Inconsolata',monospace" pointer-events="none">${nvL} · h≤${m.nvEff * H_NIV}m</text>`);
        }
      });

      // Handles
      const HH = [
        ['sw', b.x, b.y], ['s', b.x + b.w / 2, b.y], ['se', b.x + b.w, b.y],
        ['e', b.x + b.w, b.y + b.l / 2],
        ['ne', b.x + b.w, b.y + b.l], ['n', b.x + b.w / 2, b.y + b.l], ['nw', b.x, b.y + b.l],
        ['w', b.x, b.y + b.l / 2],
      ];
      HH.forEach(([hid, hwx, hwy]) => {
        const [hsx, hsy] = this._w2s(hwx, hwy);
        const isCorner = ['sw', 'se', 'ne', 'nw'].includes(hid);
        if (isCorner) parts.push(`<circle cx="${this._dd(hsx)}" cy="${this._dd(hsy)}" r="5.5" fill="white" stroke="${batCol}" stroke-width="2" data-handle="${hid}" style="cursor:${hid}-resize"/>`);
        else { const s = 4.5; parts.push(`<rect x="${this._dd(hsx - s)}" y="${this._dd(hsy - s)}" width="${this._dd(s * 2)}" height="${this._dd(s * 2)}" fill="white" stroke="${batCol}" stroke-width="1.5" data-handle="${hid}" style="cursor:${hid}-resize" transform="rotate(45,${this._dd(hsx)},${this._dd(hsy)})"/>`); }
      });
    }

    // Arêtes hit areas
    { const n = t.poly.length;
      for (let i = 0; i < n; i++) {
        const [p1x, p1y] = t.poly[i], [p2x, p2y] = t.poly[(i + 1) % n];
        const [sx1, sy1] = this._w2s(p1x, p1y), [sx2, sy2] = this._w2s(p2x, p2y);
        parts.push(`<line x1="${this._dd(sx1)}" y1="${this._dd(sy1)}" x2="${this._dd(sx2)}" y2="${this._dd(sy2)}" stroke="transparent" stroke-width="20" data-edge="${i}" style="cursor:pointer"/>`);
      }
    }

    // Cotations bâtiment
    if (this.S.layers.dims && this._terrain.plu.constructible) {
      // Largeur
      const [bx1, by1] = this._w2s(b.x, b.y), [bx2] = this._w2s(b.x + b.w, b.y);
      const cotY = by1 + 18;
      parts.push(`<line x1="${this._dd(bx1)}" y1="${this._dd(cotY)}" x2="${this._dd(bx2)}" y2="${this._dd(cotY)}" stroke="#374151" stroke-width="1"/>`);
      parts.push(`<text x="${this._dd((bx1 + bx2) / 2)}" y="${this._dd(cotY + 12)}" text-anchor="middle" font-size="9" fill="#374151" font-family="'Inconsolata',monospace" font-weight="500">${b.w.toFixed(1)} m</text>`);
      // Profondeur
      const [, by3] = this._w2s(b.x + b.w, b.y + b.l);
      const cotX = bx2 + 18;
      parts.push(`<line x1="${this._dd(cotX)}" y1="${this._dd(by1)}" x2="${this._dd(cotX)}" y2="${this._dd(by3)}" stroke="#374151" stroke-width="1"/>`);
      parts.push(`<text x="${this._dd(cotX + 8)}" y="${this._dd((by1 + by3) / 2 + 4)}" font-size="9" fill="#374151" font-family="'Inconsolata',monospace" font-weight="500">${b.l.toFixed(1)} m</text>`);
    }

    // Nord + échelle
    const [nax, nay] = [SVG_W - 58, 58];
    parts.push(`<g>
      <circle cx="${nax}" cy="${nay}" r="26" fill="rgba(247,244,238,.92)" stroke="#8A7F78" stroke-width="1.2"/>
      <path d="M${nax},${nay - 20} L${nax - 8},${nay + 12} L${nax},${nay + 5} L${nax + 8},${nay + 12} Z" fill="#18130a"/>
      <path d="M${nax},${nay - 20} L${nax - 8},${nay + 12} L${nax},${nay + 5} Z" fill="white" stroke="#1E293B" stroke-width=".5"/>
      <text x="${nax}" y="${nay - 26}" text-anchor="middle" font-size="13" font-weight="800" fill="#18130a" font-family="'Playfair Display',sans-serif">N</text>
    </g>`);

    // Échelle
    const sc10 = this._px(10);
    const [sb0x, sb0y] = [44, SVG_H - 38];
    parts.push(`<g>
      <rect x="${sb0x}" y="${sb0y - 9}" width="${this._dd(sc10 / 2)}" height="7" fill="#374151" opacity=".75" rx="1"/>
      <rect x="${this._dd(sb0x + sc10 / 2)}" y="${sb0y - 9}" width="${this._dd(sc10 / 2)}" height="7" fill="white" stroke="#374151" stroke-width=".6" rx="1" opacity=".75"/>
      <text x="${sb0x}" y="${sb0y + 4}" font-size="8" fill="#6B7280" font-family="'Inconsolata',monospace">0</text>
      <text x="${this._dd(sb0x + sc10)}" y="${sb0y + 4}" font-size="8" fill="#6B7280" font-family="'Inconsolata',monospace" text-anchor="end">10m</text>
    </g>`);

    // NGR aux sommets parcelle (BIL)
    if (this.S.layers.ngr && this._cornerAlts?.length) {
      let ng = `<g pointer-events="none">`;
      for (const pt of this._cornerAlts) {
        if (pt.alt == null || !pt.local) continue;
        const [sx, sy] = this._w2s(pt.local.x, pt.local.y);
        const isCorner = pt.kind === 'corner';
        if (isCorner) {
          // Croix repère
          ng += `<line x1="${this._dd(sx - 4)}" y1="${this._dd(sy)}" x2="${this._dd(sx + 4)}" y2="${this._dd(sy)}" stroke="#1e3a5f" stroke-width="1.4"/>`;
          ng += `<line x1="${this._dd(sx)}" y1="${this._dd(sy - 4)}" x2="${this._dd(sx)}" y2="${this._dd(sy + 4)}" stroke="#1e3a5f" stroke-width="1.4"/>`;
        } else {
          ng += `<circle cx="${this._dd(sx)}" cy="${this._dd(sy)}" r="2" fill="#1e3a5f"/>`;
        }
        const txt = `+${pt.alt.toFixed(1)}`;
        const tw = txt.length * 5.4 + 4;
        ng += `<rect x="${this._dd(sx + 5)}" y="${this._dd(sy - 12)}" width="${this._dd(tw)}" height="11" fill="rgba(252,249,243,.88)" stroke="rgba(30,58,95,.35)" stroke-width=".4" rx="1.5"/>`;
        ng += `<text x="${this._dd(sx + 7)}" y="${this._dd(sy - 4)}" font-family="'Inconsolata',monospace" font-size="${isCorner ? 9 : 8}" font-weight="${isCorner ? 700 : 500}" fill="#1e3a5f">${txt}</text>`;
      }
      parts.push(ng + '</g>');
    }

    // Légende
    { const [lsx, lsy] = this._w2s(x0 + 0.5, y1 - 0.5); const lw = 96, lh = 50;
      parts.push(`<rect x="${this._dd(lsx)}" y="${this._dd(lsy)}" width="${lw}" height="${lh}" fill="rgba(247,244,238,.92)" stroke="#D4C8A8" rx="2"/>
      <text x="${this._dd(lsx + 5)}" y="${this._dd(lsy + 13)}" font-size="7" fill="#9CA3AF" font-weight="600" font-family="'Inconsolata',monospace">LIMITES PLU</text>
      <line x1="${this._dd(lsx + 5)}" y1="${this._dd(lsy + 22)}" x2="${this._dd(lsx + 18)}" y2="${this._dd(lsy + 22)}" stroke="#EF4444" stroke-width="3"/>
      <text x="${this._dd(lsx + 22)}" y="${this._dd(lsy + 25)}" font-size="7.5" fill="#6B7280" font-family="'Inconsolata',monospace">voie</text>
      <line x1="${this._dd(lsx + 5)}" y1="${this._dd(lsy + 32)}" x2="${this._dd(lsx + 18)}" y2="${this._dd(lsy + 32)}" stroke="#3B82F6" stroke-width="3"/>
      <text x="${this._dd(lsx + 22)}" y="${this._dd(lsy + 35)}" font-size="7.5" fill="#6B7280" font-family="'Inconsolata',monospace">latérale</text>
      <line x1="${this._dd(lsx + 5)}" y1="${this._dd(lsy + 42)}" x2="${this._dd(lsx + 18)}" y2="${this._dd(lsy + 42)}" stroke="#22C55E" stroke-width="3"/>
      <text x="${this._dd(lsx + 22)}" y="${this._dd(lsy + 45)}" font-size="7.5" fill="#6B7280" font-family="'Inconsolata',monospace">fond</text>`);
    }

    return parts.join('');
  },

  // ═════════════════════════════════════════════════════════════════
  // RENDU COUPE
  // ═════════════════════════════════════════════════════════════════

  renderCoupe(m) {
    const plu = this._terrain.plu, b = this.S.bat, sc = m.sc;
    const heMax = plu.heMax, hBat = m.nvEff * H_NIV;
    const r = this._terrain.reculs;
    const sceneW = r.voie + b.l + r.fond + 8, sceneH = heMax + 5;
    const ML = 110, MR = 52, MT = 60, MB = 92;
    const SC2 = Math.min((SVG_W - ML - MR) / sceneW, (SVG_H - MT - MB) / sceneH, 24);
    const groundY = SVG_H - MB;
    const xVoie = ML + 16, xBatS = xVoie + r.voie * SC2, xBatN = xBatS + b.l * SC2, xFond = xBatN + r.fond * SC2;
    const heMaxY = groundY - heMax * SC2, batTopY = groundY - hBat * SC2;
    const parts = [];

    parts.push(`<rect width="${SVG_W}" height="${SVG_H}" fill="#f5f1e8"/>`);
    parts.push(`<rect x="0" y="${groundY}" width="${SVG_W}" height="${SVG_H - groundY}" fill="#E0D8C8"/>`);
    parts.push(`<text x="${SVG_W / 2}" y="34" text-anchor="middle" font-size="14" font-weight="700" fill="#18130a" font-family="'Playfair Display',sans-serif">COUPE N—S · GABARIT PLU</text>`);
    parts.push(`<text x="${SVG_W / 2}" y="50" text-anchor="middle" font-size="10" fill="#6b5c3e" font-family="'Inconsolata',monospace">${this._terrain.commune} · ${plu.zone} · heMax ${heMax}m</text>`);

    // Zones recul
    parts.push(`<rect x="${xVoie}" y="${MT}" width="${r.voie * SC2}" height="${groundY - MT}" fill="rgba(239,68,68,.07)"/>`);
    parts.push(`<text x="${xVoie + r.voie * SC2 / 2}" y="${groundY + 18}" text-anchor="middle" font-size="8.5" fill="#EF4444" font-family="'Inconsolata',monospace">voie ${r.voie}m</text>`);
    parts.push(`<rect x="${xBatN}" y="${MT}" width="${r.fond * SC2}" height="${groundY - MT}" fill="rgba(34,197,94,.07)"/>`);
    parts.push(`<text x="${xBatN + r.fond * SC2 / 2}" y="${groundY + 18}" text-anchor="middle" font-size="8.5" fill="#22C55E" font-family="'Inconsolata',monospace">fond ${r.fond}m</text>`);

    // heMax
    parts.push(`<line x1="${xVoie - 18}" y1="${heMaxY}" x2="${xFond + 22}" y2="${heMaxY}" stroke="#EF4444" stroke-width="1.5" stroke-dasharray="8,4"/>`);
    parts.push(`<text x="${xFond + 26}" y="${heMaxY + 4}" font-size="10" fill="#EF4444" font-family="'Inconsolata',monospace" font-weight="600">h max ${heMax}m</text>`);

    // Niveaux
    for (let f = 0; f <= Math.ceil(heMax / H_NIV); f++) {
      const fy = groundY - f * H_NIV * SC2;
      if (fy >= MT - 4) {
        parts.push(`<line x1="${xVoie - 5}" y1="${fy}" x2="${xFond + 8}" y2="${fy}" stroke="rgba(200,200,200,.6)" stroke-width=".7"/>`);
        parts.push(`<text x="${xVoie - 9}" y="${fy + 3}" text-anchor="end" font-size="9" fill="#A0AEC0" font-family="'Inconsolata',monospace">${(f * H_NIV).toFixed(0)}m</text>`);
      }
    }

    // Volume
    const batW = b.l * SC2, col2 = sc.col;
    parts.push(`<rect x="${xBatS}" y="${batTopY}" width="${batW}" height="${hBat * SC2}" fill="${this._ra(col2, .18)}" stroke="${col2}" stroke-width="2" rx="1"/>`);
    for (let f = 0; f < m.nvEff; f++) {
      const fBot = groundY - f * H_NIV * SC2, fTop = groundY - (f + 1) * H_NIV * SC2, fMid = (fBot + fTop) / 2;
      const lbl = f === 0 ? 'RdC' : `R+${f}`;
      if (f > 0) parts.push(`<line x1="${xBatS}" y1="${fBot}" x2="${xBatS + batW}" y2="${fBot}" stroke="${col2}" stroke-width="1" opacity=".45"/>`);
      parts.push(`<text x="${xBatS + batW / 2}" y="${fMid + 6}" text-anchor="middle" font-size="18" font-weight="700" fill="${col2}" font-family="'Playfair Display',sans-serif" opacity=".9">${lbl}</text>`);
    }

    // Toiture
    const roofH = Math.min(26, batW * .18);
    parts.push(`<polygon points="${xBatS},${batTopY} ${xBatS + batW / 2},${batTopY - roofH} ${xBatS + batW},${batTopY}" fill="${this._ra(col2, .1)}" stroke="${col2}" stroke-width="1.5"/>`);

    // Sol
    parts.push(`<line x1="${xVoie - 32}" y1="${groundY}" x2="${xFond + 32}" y2="${groundY}" stroke="#8A7F78" stroke-width="3"/>`);

    // Cotation hauteur
    const dimX = xBatS + batW + 32;
    parts.push(`<line x1="${dimX}" y1="${batTopY}" x2="${dimX}" y2="${groundY}" stroke="#374151" stroke-width="1"/>`);
    parts.push(`<text x="${dimX + 10}" y="${(batTopY + groundY) / 2 + 4}" font-size="11" fill="#374151" font-family="'Inconsolata',monospace" font-weight="600">${hBat}m</text>`);

    // Cotation profondeur
    parts.push(`<line x1="${xBatS}" y1="${groundY + 32}" x2="${xBatN}" y2="${groundY + 32}" stroke="#374151" stroke-width="1"/>`);
    parts.push(`<text x="${(xBatS + xBatN) / 2}" y="${groundY + 47}" text-anchor="middle" font-size="11" fill="#374151" font-family="'Inconsolata',monospace" font-weight="600">${b.l.toFixed(1)}m N-S</text>`);

    // Repères
    parts.push(`<text x="${xVoie - 24}" y="${groundY - 14}" text-anchor="middle" font-size="9.5" fill="#6b5c3e" font-family="'Inconsolata',monospace">SUD</text>`);
    parts.push(`<text x="${xFond + 18}" y="${groundY - 14}" text-anchor="middle" font-size="9.5" fill="#6b5c3e" font-family="'Inconsolata',monospace">NORD</text>`);

    return parts.join('');
  },

  // ═════════════════════════════════════════════════════════════════
  // RENDER PRINCIPAL
  // ═════════════════════════════════════════════════════════════════

  render() {
    if (!this._svg || !this._terrain) return;
    const m = this.metrics();
    this._svg.setAttribute('width', SVG_W);
    this._svg.setAttribute('height', SVG_H);
    this._svg.setAttribute('viewBox', `0 0 ${SVG_W} ${SVG_H}`);
    this._svg.innerHTML = this.S.view === 'plan' ? this.renderPlan(m) : this.renderCoupe(m);
    this.updatePanel(m);
  },

  // ── PANEL MÉTRIQUES ───────────────────────────────────────────────

  updatePanel(m) {
    const g = id => document.getElementById(id);
    const sv = (id, v) => { const el = g(id); if (el) el.textContent = v; };
    const plu = this._terrain.plu;

    // Pill conformité
    const ss = g('pmc-status');
    if (ss) { ss.textContent = m.allOk ? 'Conforme' : 'Non conforme'; ss.className = 'pmc-pill ' + (m.allOk ? 'ok' : 'nok'); }

    // Grandes métriques
    sv('pmc-lgts', this.S.prog.type === 'maison' ? '1' : m.nbLgts);
    sv('pmc-lgts-sub', this.S.prog.type === 'maison' ? 'maison individuelle' : 'logements');
    sv('pmc-sp', m.spTot.toFixed(0) + ' m²');
    sv('pmc-nv', `${NV[m.nvEff] || m.nvEff} (max ${NV[m.nvEffMax] || m.nvEffMax})`);
    sv('pmc-envarea', m.envArea.toFixed(0) + ' m²');
    sv('pmc-park', this.S.prog.parkMode === 'ss' ? `${m.parkReq}↓SS` : `${m.parkExt} PK ext`);
    sv('pmc-dens', m.dens.toFixed(0) + ' l/ha');
    sv('pmc-maxlgts', m.maxLgts);
    sv('pmc-maxniv', `${NV[m.nvMaxPLU] || 'R+' + (this.nvMaxPLU() - 1)} PLU · ${plu.heMax}m`);

    // Gauges
    const empPct = m.empPct, empMax = plu.emprMax;
    const empBar = Math.min(100, empPct / empMax * 100);
    const empColor = empPct > empMax ? '#EF4444' : empPct > empMax * .9 ? '#F59E0B' : '#6366F1';
    const gfEmp = g('pmc-gf-emp');
    if (gfEmp) { gfEmp.style.width = empBar.toFixed(0) + '%'; gfEmp.style.background = empColor; }
    sv('pmc-gv-emp', empPct.toFixed(1) + '%');
    sv('pmc-gl-emp', `max ${empMax}%`);

    const permPct = m.permPct, permMin = plu.permMin;
    const permBar = Math.min(100, permPct / 100 * 100);
    const permColor = permPct < permMin ? '#EF4444' : '#22C55E';
    const gfPerm = g('pmc-gf-perm');
    if (gfPerm) { gfPerm.style.width = permBar.toFixed(0) + '%'; gfPerm.style.background = permColor; }
    sv('pmc-gv-perm', permPct.toFixed(1) + '%');
    sv('pmc-gl-perm', `min ${permMin}%`);

    // Checks table
    const ckBody = g('pmc-ck-body');
    if (ckBody) {
      ckBody.innerHTML = m.checks.map(c =>
        `<tr style="color:${c.ok ? '#3d6b2e' : '#8b2a3a'}"><td>${c.lbl}</td><td style="text-align:right">${c.proj}${c.u}</td><td style="text-align:right">${c.rule}${c.u}</td><td style="text-align:center;font-weight:700">${c.ok ? '✓' : '✗'}</td></tr>`
      ).join('');
    }

    // GIEP
    sv('pmc-Q', m.Q.toFixed(5));
    sv('pmc-vg', m.vGiep.toFixed(1));
    sv('pmc-sn', m.sNoue.toFixed(0));

    // Bâtiment position
    sv('pmc-bpos', `x=${this.S.bat.x.toFixed(1)} y=${this.S.bat.y.toFixed(1)} m`);
    sv('pmc-bdim', `${this.S.bat.w.toFixed(1)}×${this.S.bat.l.toFixed(1)} m`);

    // Status bar
    sv('pmc-terrain-info', `${this._terrain.commune} · ${this._terrain.area.toFixed(0)} m²`);

    // Dispatch event pour sync avec P07
    window.dispatchEvent(new CustomEvent('pmc:metrics', { detail: m }));
  },

  // ── VÉGÉTATION ─────────────────────────────────────────────────────

  _computeVegPlants(m) {
    const t = this._terrain, n = t.poly.length, plants = [];
    const env = this.computeEnv();
    const MARGE = 1.8;
    const blocs = this.getBlocRects(m);
    function onAnyBloc(fx, fy) {
      return blocs.some(bl => fx >= bl.x - MARGE && fx <= bl.x + bl.w + MARGE && fy >= bl.y - MARGE && fy <= bl.y + bl.l + MARGE);
    }

    for (let i = 0; i < n; i++) {
      const type = this.S.edgeTypes[i], r = this.edgeRecul(i);
      if (r < 0.8) continue;
      const [p1x, p1y] = t.poly[i], [p2x, p2y] = t.poly[(i + 1) % n];
      const dx = p2x - p1x, dy = p2y - p1y, len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const nx = -dy / len, ny = dx / len;
      const seed = (p1x * 137 + p1y * 89 + i * 43);
      let pos = 1.5, k = 0;
      while (pos < len - 1.5) {
        const f = pos / len;
        const ptx = p1x + (p2x - p1x) * f + nx * (1.5 + h1(seed + k * 19) * .6);
        const pty = p1y + (p2y - p1y) * f + ny * (1.5 + h1(seed + k * 19) * .6);
        if (ptInPoly(ptx, pty, t.poly) && !onAnyBloc(ptx, pty))
          plants.push({ x: ptx, y: pty, r: 1.6 + h1(seed + k * 7) * .5, type: 'tree', s: (seed + k) % 999 });
        pos += 5.0 * (0.75 + h1(seed + k * 53) * .5); k++;
      }
    }

    // Semis intérieur
    const batSeed = blocs.reduce((s, bl) => s + Math.round(bl.x * 7 + bl.y * 11 + bl.w * 13 + bl.l * 17), 0) % 997;
    const ebb = polyAABB(env.poly);
    const nFree = Math.floor(ebb.w * ebb.h / 28);
    for (let k = 0; k < nFree; k++) {
      const fx = ebb.x + h1(k * 19 + batSeed + 1) * ebb.w;
      const fy = ebb.y + h1(k * 23 + batSeed + 7) * ebb.h;
      if (!ptInPoly(fx, fy, t.poly) || !ptInPoly(fx, fy, env.poly) || onAnyBloc(fx, fy)) continue;
      plants.push({ x: fx, y: fy, r: 1.0 + h1(k * 31 + batSeed) * .9, type: h1(k * 41 + batSeed) < 0.28 ? 'tree' : 'shrub', s: (k + batSeed) % 999 });
    }
    return plants;
  },

  _drawPlant(parts, cx, cy, r, type, seed) {
    const rPx = Math.max(3.5, Math.min(35, r * this._px(1)));
    const [sx, sy] = this._w2s(cx, cy);
    const fill = type === 'tree' ? 'rgba(22,78,18,.42)' : 'rgba(45,90,35,.38)';
    const stroke = type === 'tree' ? 'rgba(12,55,10,.55)' : 'rgba(28,65,20,.5)';
    parts.push(`<circle cx="${this._dd(sx + rPx * .22)}" cy="${this._dd(sy + rPx * .22)}" r="${this._dd(rPx)}" fill="rgba(0,0,0,0.07)"/>`);
    parts.push(`<circle cx="${this._dd(sx)}" cy="${this._dd(sy)}" r="${this._dd(rPx)}" fill="${fill}" stroke="${stroke}" stroke-width="0.7"/>`);
    parts.push(`<circle cx="${this._dd(sx)}" cy="${this._dd(sy)}" r="${this._dd(Math.max(1.2, rPx * .12))}" fill="${stroke}" opacity="0.55"/>`);
  },

  // ═════════════════════════════════════════════════════════════════
  // EVENTS
  // ═════════════════════════════════════════════════════════════════

  _bindEvents() {
    const svg = this._svg;
    const self = this;

    function getSVGPt(e) { const r = svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

    svg.addEventListener('pointerdown', e => {
      if (self.S.view !== 'plan') return;
      const [sx, sy] = getSVGPt(e);
      const [wx, wy] = self._s2w(sx, sy);
      const edgeIdx = e.target.dataset?.edge;
      if (edgeIdx !== undefined) { self.cycleEdge(parseInt(edgeIdx)); return; }
      const h = e.target.dataset?.handle, isBody = e.target.dataset?.type?.startsWith('building');
      if (h || isBody) { self._drag = { type: h ? 'handle' : 'body', h: h || null, ww0: [wx, wy], bat0: { ...self.S.bat } }; svg.setPointerCapture(e.pointerId); e.preventDefault(); }
      else { self._drag = { type: 'pan', sw0: [sx, sy], pan0: [self.S.panX, self.S.panY] }; svg.setPointerCapture(e.pointerId); }
    });

    svg.addEventListener('pointermove', e => {
      if (!self._drag || self.S.view !== 'plan') return;
      const [sx, sy] = getSVGPt(e);
      const [wx, wy] = self._s2w(sx, sy);

      if (self._drag.type === 'pan') {
        self.S.panX = self._drag.pan0[0] + sx - self._drag.sw0[0];
        self.S.panY = self._drag.pan0[1] + sy - self._drag.sw0[1];
        self.render(); return;
      }

      const dw = wx - self._drag.ww0[0], dh = wy - self._drag.ww0[1], sb = self._drag.bat0, b = self.S.bat;
      if (self._drag.type === 'body') { b.x = self._snap(sb.x + dw); b.y = self._snap(sb.y + dh); }
      else {
        const hh = self._drag.h;
        if (hh === 'sw' || hh === 'w' || hh === 'nw') { const nx = self._snap(sb.x + dw), nw = sb.x + sb.w - nx; if (nw >= MIN_W) { b.x = nx; b.w = nw; } }
        if (hh === 'se' || hh === 'e' || hh === 'ne') { const nw = self._snap(sb.w + dw); if (nw >= MIN_W) b.w = nw; }
        if (hh === 'sw' || hh === 's' || hh === 'se') { const ny = self._snap(sb.y + dh), nl = sb.y + sb.l - ny; if (nl >= MIN_L) { b.y = ny; b.l = nl; } }
        if (hh === 'nw' || hh === 'n' || hh === 'ne') { const nl = self._snap(sb.l + dh); if (nl >= MIN_L) b.l = nl; }
      }
      self._clampBat(); self.render();
    });

    svg.addEventListener('pointerup', () => { self._drag = null; });

    svg.addEventListener('wheel', e => {
      if (self.S.view !== 'plan') return;
      e.preventDefault();
      const [sx, sy] = getSVGPt(e);
      const [mwx, mwy] = self._s2w(sx, sy);
      self.S.zoom = Math.max(0.12, Math.min(18, self.S.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      const ns = BS * self.S.zoom;
      self.S.panX = sx - SCX - (mwx - self.S.wcx) * ns;
      self.S.panY = sy - SCY + (mwy - self.S.wcy) * ns;
      self.render();
    }, { passive: false });
  },

  // ── API PUBLIQUE ──────────────────────────────────────────────────

  // Cycle d'arête à 4 états — règle BINAIRE PLU :
  //   voie → lat (Lmin)  → lat-mitoyen (0m)  → fond → voie...
  // Le mitoyen est BINAIRE : 0m (en limite) ou Lmin. Jamais entre.
  cycleEdge(i) {
    const cur = this.S.edgeTypes[i];
    const isMit = !!this.S.mitoyen[i];

    if (cur === 'voie') {
      this.S.edgeTypes[i] = 'lat';
      this.S.mitoyen[i]   = false;
    } else if (cur === 'lat' && !isMit) {
      // lat → lat-mitoyen (toggle binaire)
      this.S.mitoyen[i] = true;
    } else if (cur === 'lat' && isMit) {
      this.S.edgeTypes[i] = 'fond';
      this.S.mitoyen[i]   = false;
    } else if (cur === 'fond') {
      this.S.edgeTypes[i] = 'voie';
      this.S.mitoyen[i]   = false;
    } else {
      // Fallback
      this.S.edgeTypes[i] = 'voie';
      this.S.mitoyen[i]   = false;
    }
    this._persistEdgeState();
    this._clampBat();
    this.render();
  },

  /**
   * Active / désactive l'implantation en limite pour une arête latérale.
   * Règle BINAIRE : 0m (mitoyen) OU Lmin (recul std), jamais entre.
   * Toast de feedback si conditions critiques.
   *
   * @param {number} edgeIdx
   * @param {boolean} isMitoyen
   */
  setMitoyen(edgeIdx, isMitoyen) {
    if (!this._terrain || edgeIdx < 0 || edgeIdx >= this.S.mitoyen.length) return;
    if (this.S.edgeTypes[edgeIdx] !== 'lat') {
      console.warn('[PMC] setMitoyen ignoré : arête', edgeIdx, 'n\'est pas latérale');
      return;
    }
    this.S.mitoyen[edgeIdx] = !!isMitoyen;
    this._persistEdgeState();
    this._clampBat();
    this.render();
    if (isMitoyen) {
      const hLim = this._terrain.plu.heMax ?? 9;
      window.TerlabToast?.show?.(
        `Implantation en limite — H façade ≤ ${hLim}m, mur aveugle requis`,
        'warning', 3500
      );
    }
  },

  toggleMitoyen(edgeIdx) {
    this.setMitoyen(edgeIdx, !this.S.mitoyen[edgeIdx]);
  },

  // Persistance dans session.phases[7].data — picked up at save time
  _persistEdgeState() {
    const p7 = this._session?.phases?.[7]?.data;
    if (!p7) return;
    p7.pmc_edgeTypes = [...this.S.edgeTypes];
    p7.pmc_mitoyen   = [...this.S.mitoyen];
  },

  setView(v) { this.S.view = v; this.render(); },

  setProg(key, val) {
    if (key === 'type') {
      this.S.prog.type = val;
      if (val === 'maison') this.S.prog.profMax = Math.min(this.S.prog.profMax, 12);
      this._initBatFromPIR();
    } else if (key === 'nvMax') {
      this.S.prog.nvMax = Math.min(val, this.nvMaxPLU());
    } else if (key === 'profMax') {
      this.S.prog.profMax = val;
    } else if (key === 'parkMode') {
      this.S.prog.parkMode = val;
    } else if (key === 'maxUnits') {
      this.S.prog.maxUnits = val;
    }
    this.render();
  },

  setParkSide(side) { this.S.parkSide = side; this.render(); },

  setScenario(scId) {
    this._scId = scId;
    const sc = this.curSc();
    this.S.prog.nvMax = Math.min(sc.nv, this.nvMaxPLU());
    this.render();
  },

  autoPlace() {
    if (!this._terrain.plu.constructible) return;
    this._initBatFromPIR();
    this.render();
  },

  /** Recharger le terrain depuis la session (après chargement PLU asynchrone) */
  rebuild(session) {
    if (session) this._session = session;
    this._buildTerrain();
    this.S.edgeTypes = [...this._terrain.edgeTypes];
    this.S.mitoyen = new Array(this._terrain.poly.length).fill(false);
    this._initBatFromPIR();
    this._resetView();
    this.render();
    console.log(`[PMC] Rebuild — terrain ${Math.round(this._terrain.area)} m²`);
  },

  resetView() { this._resetView(); this.render(); },

  exportSVG() {
    const m = this.metrics();
    const content = this.S.view === 'plan' ? this.renderPlan(m) : this.renderCoupe(m);
    const blob = new Blob(
      [`<?xml version="1.0" encoding="utf-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}"><rect width="${SVG_W}" height="${SVG_H}" fill="white"/>${content}</svg>`],
      { type: 'image/svg+xml' }
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `terlab-plan-masse-${this.S.view}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
};

// Expose global
if (typeof window !== 'undefined') window.PlanMasseCanvas = PlanMasseCanvas;

export { PlanMasseCanvas };
export default PlanMasseCanvas;
