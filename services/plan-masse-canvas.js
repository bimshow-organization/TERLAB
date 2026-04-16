// terlab/services/plan-masse-canvas.js
// PlanMasseCanvas — Éditeur SVG plan masse interactif inline
// Adapté de terlab-plan-editor-v7.html pour TERLAB Phase 7
// ENSA La Réunion · MGA Architecture 2026
// Vanilla JS ES2022+

import FH from './footprint-helpers.js';

const SVG_W = 860, SVG_H = 600, SCX = SVG_W / 2, SCY = SVG_H / 2 + 15, BS = 10;
const SNAP = 0.5, MIN_W = 4, MIN_L = 5, H_NIV = 3.0;

// Hauteur par niveau selon l'usage (m) — alignée pratiques Réunion
const HEIGHT_BY_USAGE = {
  logement: 2.80,
  commerce: 4.00,
  bureau:   3.30,
  parking:  2.60,
  mixte:    3.00,   // moyenne pondérée usage mixte
};

// Efficacité SDP nette / emprise selon l'usage (rdC parking non compté)
const EFF_BY_USAGE = {
  logement: 0.82,
  commerce: 0.85,
  bureau:   0.80,
  parking:  0.95,
  mixte:    0.80,
};

// Couleurs par usage — utilisées pour le remplissage des blocs sur le canvas
const USAGE_COLORS = {
  logement: '#3B82F6',  // bleu
  commerce: '#F97316',  // orange
  bureau:   '#0891B2',  // cyan
  parking:  '#6b7280',  // gris
  mixte:    '#8B5CF6',  // violet
};
const COL = { voie: 'var(--svg-voie)', lat: 'var(--svg-lat)', fond: 'var(--svg-fond)' };
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
    // blocs : tableau de blocs orientés [{ polygon:[{x,y}...], theta, w, l, cx, cy, id }]
    //   - non vide → rendu multi-blocs (polygones éventuellement rotés, formes T/L/X/Y)
    //   - vide     → fallback éditeur mono-bâtiment legacy (S.bat)
    //   - activeBlocIdx : index du bloc sélectionné (pour drag/handles futurs)
    blocs: [],
    activeBlocIdx: 0,
    shapePreset: null,  // 'I' (simple), 'L', 'T', 'X', 'Y', 'multi'
    prog: { type: 'maison', nvMax: 2, profMax: 15, parkMode: 'ext', parkSS: false, minUnits: 1, maxUnits: 20, emprCiblePct: 100 },
    parkSide: 'est',
    edgeTypes: [],
    mitoyen: [],
    zoom: 1, panX: 0, panY: 0, wcx: 15, wcy: 15,
    layers: { reculs: true, env: true, veg: true, parking: true, dims: true, pir: false, contours: true, ngr: true, emprise: false, circ: false, prog: false },
    view: 'plan',  // 'plan' | 'coupe'
    _insetWarn: null,
    // Dirty flag : user a édité manuellement (drag/resize/rotate/split/addNode/delNode).
    // Bloque les recalculs automatiques (sliders / PLU override / edgeType toggle) pour
    // préserver le travail manuel. Reset explicite ou changement de stratégie → clear.
    _manualEdit: false,
  },

  // Historique Undo/Redo : stack de snapshots { blocs, activeBlocIdx, shapePreset }
  _history: [],
  _historyFuture: [],
  _historyMax: 40,

  _drag: null,

  // Scénarios Pareto — alignés sur AutoPlanEngine._generatePareto
  // strategy = nom de la stratégie géométrique appliquée (rect/oblique/multi/lshape/…)
  // requires = contraintes contextuelles (pente, parcelle trapèze, voie, etc.)
  // emprFac = facteur appliqué aux dimensions cible vs rtaaW / profMax
  _scenarios: [
    { id: 'A1',  nv: 3, eff: 0.80, aide: 0.70, col: '#EF4444', short: 'Densité',    label: 'max densité',     strategy: 'rect',      emprFac: 1.00, desc: 'Rectangle max densité aligné sur l\u2019axe principal' },
    { id: 'A2',  nv: 3, eff: 0.78, aide: 0.65, col: '#F97316', short: 'Multi',      label: 'multi-blocs',     strategy: 'multi',     emprFac: 0.92, desc: 'Plusieurs blocs en bande (parcelles longues/étroites)' },
    { id: 'B1',  nv: 3, eff: 0.82, aide: 0.60, col: '#3B82F6', short: 'Équilibre',  label: 'équilibre',       strategy: 'oblique',   emprFac: 0.90, desc: 'Oblique aligné sur arête dominante non-voirie' },
    { id: 'B2',  nv: 2, eff: 0.85, aide: 0.55, col: '#22C55E', short: 'Perméable',  label: 'perméabilité',    strategy: 'rect',      emprFac: 0.70, desc: 'Rectangle compact, emprise réduite' },
    { id: 'B3',  nv: 2, eff: 0.82, aide: 0.58, col: '#D97706', short: 'L',          label: 'bi-volume L',     strategy: 'lshape',    emprFac: 0.85, desc: 'Empreinte en L sur parcelles larges' },
    { id: 'B4',  nv: 2, eff: 0.80, aide: 0.55, col: '#DC2626', short: 'Trapèze',    label: 'trapézoïde',      strategy: 'trapezoid', emprFac: 0.82, desc: 'Adapté aux parcelles en trapèze', requires: 'trapezoid' },
    { id: 'C1',  nv: 2, eff: 0.88, aide: 0.50, col: '#A855F7', short: 'Aidé',       label: 'habitat aidé',    strategy: 'oblique',   emprFac: 0.75, desc: 'Oblique aligné sur la rue, R+1' },
    { id: 'C2',  nv: 3, eff: 0.75, aide: 0.45, col: '#14B8A6', short: 'Épouse',     label: 'épouse zone',     strategy: 'zone',      emprFac: 0.55, desc: 'Épouse la zone constructible, emprise min' },
    { id: 'C2b', nv: 3, eff: 0.78, aide: 0.48, col: '#059669', short: 'Hull',       label: 'zone adaptative', strategy: 'zoneHull',  emprFac: 0.65, desc: 'Hull de la zone avec surface cible' },
    { id: 'D1',  nv: 2, eff: 0.80, aide: 0.55, col: '#0EA5E9', short: 'Isohypses',  label: 'isohypses',       strategy: 'isohypses', emprFac: 0.70, desc: 'Bâtiment \u22a5 à la pente', requires: 'slope' },
    // Stratégies portées de v4h — typologies multi-volume pour densité compacte
    { id: 'T',   nv: 2, eff: 0.80, aide: 0.55, col: '#7C3AED', short: 'T',          label: 'T-shape',         strategy: 'tShape',    emprFac: 0.75, desc: 'Bar traversant + noyau central (typologie Heidegger)' },
    { id: 'X',   nv: 2, eff: 0.78, aide: 0.52, col: '#0D9488', short: 'X',          label: 'croix',           strategy: 'cross',     emprFac: 0.70, desc: 'Plan en croix (4 ailes autour d\u2019un noyau)' },
    { id: 'BB',  nv: 3, eff: 0.82, aide: 0.58, col: '#B45309', short: 'Bi-barre',   label: 'bi-barre reliée', strategy: 'biBarre',   emprFac: 0.85, desc: '2 barres parallèles reliées par un noyau' },
    { id: '2L',  nv: 2, eff: 0.80, aide: 0.55, col: '#0369A1', short: '2 Lames',    label: '2 lames parallèles', strategy: 'deuxLames', emprFac: 0.75, desc: '2 rectangles max inscrits dans chaque moitié de zone' },
    { id: '3L',  nv: 3, eff: 0.78, aide: 0.50, col: '#7E22CE', short: '3 Lames',    label: '3 lames parallèles', strategy: 'troisLames', emprFac: 0.82, desc: '3 bandes parallèles (parcelles longues/larges ≥ 12×12 m utiles)' },
  ],
  _scId: 'B1',

  curSc() { return this._scenarios.find(s => s.id === this._scId) ?? this._scenarios[2]; },
  nvMaxPLU() { return Math.max(1, Math.floor((this._terrain?.plu?.heMax ?? 9) / H_NIV)); },

  /**
   * Liste des scénarios avec leur applicabilité au contexte courant.
   * Retourne [{ ...scenario, applicable, disabledReason }].
   * Utilisé par la toolbar pour griser les stratégies non pertinentes.
   */
  listScenarios() {
    const t = this._terrain;
    const plu = t?.plu ?? {};
    const nvMaxPLU = this.nvMaxPLU();
    const azimutPente = this.S.prog?._topoConstraints?.azimut_deg;
    const tcSlope = this.S.prog?._topoConstraints?.topoCase;
    const slopeId = tcSlope?.id ?? 'flat';
    const slopeOK = Number.isFinite(azimutPente) && slopeId !== 'flat';

    let isTrap = false, isLN = false;
    try {
      const AS = window.AutoPlanStrategies;
      if (AS && t?.poly?.length >= 3) {
        isLN = AS.isLongAndNarrow?.(t.poly, 2.8) ?? false;
        isTrap = AS.isTrapezoidalParcel?.(t.poly, t.edgeTypes) ?? false;
      }
    } catch { /* silencieux : applicabilité par défaut = true */ }

    return this._scenarios.map(sc => {
      let applicable = true;
      let disabledReason = null;
      if (sc.requires === 'slope' && !slopeOK) {
        applicable = false;
        disabledReason = 'Pente non exploitable (< 5% ou azimut inconnu)';
      }
      if (sc.requires === 'trapezoid' && !isTrap) {
        applicable = false;
        disabledReason = 'Parcelle non trapézoïdale';
      }
      if (sc.nv > nvMaxPLU) {
        disabledReason = (disabledReason ? disabledReason + ' · ' : '') +
          `R+${sc.nv - 1} dépasse PLU (heMax ${plu.heMax ?? '?'}m → R+${nvMaxPLU - 1})`;
      }
      // Suggestions contextuelles (pas bloquantes)
      const hint = (sc.id === 'A2' && isLN) ? 'recommandé (parcelle longue)' :
                   (sc.id === 'D1' && slopeOK) ? `recommandé (${tcSlope?.label ?? 'pente'})` :
                   (sc.id === 'B4' && isTrap) ? 'recommandé (trapèze)' : null;
      return { ...sc, applicable, disabledReason, hint };
    });
  },

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
    this._svg.style.cssText = 'display:block;width:100%;height:100%;cursor:crosshair;touch-action:none;user-select:none;background:var(--svg-bg)';
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

    // Restaurer les blocs sauvegardés (écrase l'init PIR si présents)
    let restoredFromSession = false;
    if (Array.isArray(p7.pmc_blocs) && p7.pmc_blocs.length) {
      try {
        this.S.blocs = p7.pmc_blocs.map((bl, i) => ({
          id: bl.id ?? `bl${i}`,
          polygon: (bl.polygon ?? []).map(p => ({ x: +p.x, y: +p.y })),
          theta: +bl.theta || 0,
          w: +bl.w || 0, l: +bl.l || 0,
          cx: +bl.cx || 0, cy: +bl.cy || 0,
          niveaux: Math.max(1, +bl.niveaux || 1),
          usage: bl.usage || 'logement',
          rdcUsage: bl.rdcUsage || null,
        })).filter(bl => bl.polygon.length >= 3);
        if (this.S.blocs.length) {
          this.S.activeBlocIdx = 0;
          this.S.shapePreset = p7.pmc_shapePreset || (this.S.blocs.length > 1 ? 'multi' : 'I');
          this._syncBatFromBlocs();
          this._clampBat();
          restoredFromSession = true;
        }
      } catch (e) {
        console.warn('[PMC] Failed to restore blocs from session', e);
      }
    }

    // Sans blocs session : matérialiser la stratégie par défaut (B1 Équilibre)
    // via AutoPlanStrategies — sinon le rect PIR peut échouer le clip batSafe
    // et le bâtiment reste invisible jusqu'au 1er clic sur une stratégie.
    if (!restoredFromSession && this._terrain?.plu?.constructible) {
      try { this._applyScenarioGeometry(this.curSc()); }
      catch (e) { console.warn('[PMC] default scenario failed:', e.message); }
    }
    this._resetView();

    // Events
    this._bindEvents();

    // Re-render on theme change (dark/ivory/earth) — var(--svg-*) values change
    this._themeListener = () => { if (this._ready) this.render(); };
    window.addEventListener('terlab-theme-change', this._themeListener);

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
    const cosRaw = p4.cos ?? pluCfg?.plu?.cos;
    const plu = {
      emprMax: emprMaxRaw > 1 ? emprMaxRaw : emprMaxRaw * 100,
      permMin: parseFloat(pluCfg?.plu?.permMin ?? p4.permeabilite_min_pct ?? 25),
      heMax: parseFloat(p4.hauteur_egout_m ?? p4.hauteur_max_m ?? pluCfg?.plu?.heMax ?? 9),
      rtaaZone: parseInt(terrain.zone_rtaa ?? 2),
      zone: p4.zone_plu ?? pluCfg?.meta?.zone ?? 'U',
      interBatMin: parseFloat(pluCfg?.plu?.interBatMin ?? 4),
      constructible: (p4.zone_plu ?? 'U').charAt(0) !== 'A' && (p4.zone_plu ?? 'U').charAt(0) !== 'N',
      recul_voie: reculs.voie,
      recul_lat:  reculs.lat,
      recul_fond: reculs.fond,
      cos: (cosRaw !== null && cosRaw !== undefined && cosRaw !== '') ? parseFloat(cosRaw) : null,
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

    // Auto-side PK : côté de l'arête voie vs centre parcelle (entrée = voie).
    // NB : certaines mairies imposent un recul PK (reculs.voie couvre déjà la
    // limite voie, mais un recul PK spécifique peut différer — TODO rapatrier
    // plu.recul_parking_m depuis data/plu-rules-*.json quand disponible).
    try {
      const voieIdx = edgeTypes.findIndex(t => t === 'voie');
      if (voieIdx >= 0) {
        const a = poly[voieIdx], b = poly[(voieIdx + 1) % poly.length];
        const emx = (a[0] + b[0]) / 2, emy = (a[1] + b[1]) / 2;
        let cx = 0, cy = 0;
        for (const p of poly) { cx += p[0]; cy += p[1]; }
        cx /= poly.length; cy /= poly.length;
        const dx = emx - cx, dy = emy - cy;
        this.S.parkSide = Math.abs(dx) > Math.abs(dy)
          ? (dx > 0 ? 'est' : 'ouest')
          : (dy > 0 ? 'nord' : 'sud');
      }
    } catch { /* parkSide default reste 'est' */ }
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

  // ── BIL : courbes de niveau (une seule fois, mutualisé via ContourCache) ──
  async _loadContoursOnce() {
    if (this._contourData) return;
    if (!this._terrain?.parcelGeo?.length) return;
    const pg = this._terrain.parcelGeo;
    try {
      const data = window.ContourCache
        ? await window.ContourCache.loadOrGet(pg, { pixelSizeM: 1.0, maxDim: 220, padM: 8 })
        : null;
      if (!data) { this._contourData = null; return; }
      // Convertir chaque polyline WGS → local mètres (cohérent avec _terrain.poly).
      // L'origine locale du PMC peut différer de celle de l'esquisse — on reprojette
      // donc systématiquement avec _geoToLocal du PMC.
      const linesLocal = data.lines.map(l => ({
        level: l.level,
        pts: this._geoToLocal(l.coords).map(p => [p.x, p.y]),
      }));
      this._contourData = { ...data, linesLocal };
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

    // Route v4h : convexe → half-plane intersection, concave → raster + flood-fill.
    // Gère les pointes aiguës sur arête mitoyenne (recul=0) voisine d'arêtes à fort
    // recul, et les parcelles non-convexes. Fallback sur _insetPoly si indispo.
    let env = null;
    if (FH && typeof FH.buildZone === 'function') {
      try {
        const polyXY = t.poly.map(([x, y]) => ({ x, y }));
        const zoneV4 = FH.buildZone(polyXY, R);
        if (zoneV4 && zoneV4.length >= 3) env = zoneV4.map(pt => [pt.x, pt.y]);
      } catch (e) {
        console.warn('[PMC] FH.buildZone error, fallback _insetPoly:', e.message);
      }
    }
    if (!env) env = _insetPoly(t.poly, R);

    // Filet v4h : supprimer les pointes résiduelles (angle < 90°) que le raster
    // peut produire aux coins perdus entre 2 reculs très différents.
    if (FH && typeof FH.rmSpikes === 'function' && env.length >= 4) {
      try {
        const cleaned = FH.rmSpikes(env.map(([x, y]) => ({ x, y })), 60);
        if (cleaned.length >= 3) env = cleaned.map(pt => [pt.x, pt.y]);
      } catch (e) { /* best-effort, garder env tel quel */ }
    }

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
    const cx = pir[0], cy = pir[1];
    const W = Math.max(MIN_W, this._snap(bw));
    const L = Math.max(MIN_L, this._snap(bl));
    this.S.bat = { x: this._snap(cx - W / 2), y: this._snap(cy - L / 2), w: W, l: L };
    this._clampBat();
    // Source de vérité unifiée : on crée systématiquement S.blocs[0] rect polygone
    // issu de S.bat. Les rendus et drag utilisent ce polygone uniformément.
    const b = this.S.bat;
    const poly = FH.rectCentered(b.x + b.w / 2, b.y + b.l / 2, b.l, b.w, 0)
      .map(pt => ({ x: this._snap(pt.x), y: this._snap(pt.y) }));
    this.S.blocs = [{
      id: 'bl0', polygon: poly, theta: 0,
      w: b.l, l: b.w, // convention rectCentered : local X=L, Y=W ; ici axis-aligned, L=bat.w et W=bat.l n'ont pas d'importance visuelle à theta=0
      cx: b.x + b.w / 2, cy: b.y + b.l / 2,
      niveaux: Math.min(this.S.prog.nvMax ?? 1, this.nvMaxPLU()),
      usage: this._defaultUsage(),
      rdcUsage: null,
    }];
    this.S.activeBlocIdx = 0;
    this.S.shapePreset = 'I';
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

  _ra(hex, a) {
    // CSS var() fallback: si on reçoit var(--x), on renvoie la même var() (opacité gérée par le CSS token).
    if (typeof hex === 'string' && hex.startsWith('var(')) return hex;
    if (typeof hex !== 'string' || hex[0] !== '#' || hex.length < 7) return hex;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  },
  _polyPts(pts) { return pts.map(([x, y]) => this._w2s(x, y).join(',')).join(' '); },
  _tx(wx, wy, str, sz, fill, anch = 'middle') { const [sx, sy] = this._w2s(wx, wy); return `<text x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" text-anchor="${anch}" font-size="${sz}" fill="${fill}" font-family="'Inconsolata',monospace">${str}</text>`; },
  _dd(n) { return n.toFixed(1); },

  // ── MÉTRIQUES ─────────────────────────────────────────────────────

  metrics() {
    const t = this._terrain, plu = t.plu, b = this.S.bat, p = this.S.prog, sc = this.curSc();
    const env = this.computeEnv();
    const nvEffMax = this.nvMaxPLU(), nvEff = Math.min(p.nvMax, nvEffMax);
    // Emprise : aire réelle des blocs si multi, sinon bbox legacy
    const emprise = this._totalBlocArea();
    const empPct = emprise / t.area * 100;
    // SDP : somme par bloc (niveaux + usage individuels) si multi, sinon fallback scénario
    let spTot;
    if (this.S.blocs?.length) {
      spTot = this.S.blocs.reduce((s, bl) => s + this._blocSDP(bl), 0);
      if (p.parkMode === 'rdc') spTot *= 0.88;  // RdC parking ampute ~12% de SDP logement
    } else {
      let spBase = emprise;
      if (p.parkMode === 'rdc') spBase *= 0.75;
      spTot = spBase * sc.eff * nvEff;
    }
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
    // Multi-blocs réels (polygones issus de stratégie ou preset T/L/X/Y)
    if (this.S.blocs?.length) {
      return this.S.blocs.map(bl => {
        if (bl.polygon?.length >= 3) {
          const xs = bl.polygon.map(p => p.x ?? p[0]);
          const ys = bl.polygon.map(p => p.y ?? p[1]);
          const minX = Math.min(...xs), minY = Math.min(...ys);
          const maxX = Math.max(...xs), maxY = Math.max(...ys);
          return {
            x: minX, y: minY, w: maxX - minX, l: maxY - minY,
            polygon: bl.polygon, theta: bl.theta ?? 0,
            cx: bl.cx, cy: bl.cy,
            _isPoly: true,
          };
        }
        return bl;
      });
    }
    // Fallback legacy : bat unique + split uniforme si nbBlocs > 1
    const b = this.S.bat, nb = m.nbBlocs;
    if (nb <= 1) return [b];
    const g = m.gapMin, tg = (nb - 1) * g, bw = (b.w - tg) / nb;
    if (bw >= MIN_W) return Array.from({ length: nb }, (_, i) => ({ x: b.x + i * (bw + g), y: b.y, w: bw, l: b.l }));
    const bl = (b.l - tg) / nb;
    return bl >= MIN_L ? Array.from({ length: nb }, (_, i) => ({ x: b.x, y: b.y + i * (bl + g), w: b.w, l: bl })) : [b];
  },

  /**
   * Calcule l'OBB (oriented bounding box) d'un bloc à partir de son polygone
   * et de son angle theta. Retourne { cx, cy, w, l, theta } cohérent avec
   * la convention rectCentered : local X = L (longueur), local Y = W (largeur).
   * Pour des polygones arbitraires (L, zone), c'est l'extent rotée.
   */
  _blocOBB(bl) {
    const theta = bl?.theta ?? 0;
    const th = theta * Math.PI / 180;
    const cos = Math.cos(th), sin = Math.sin(th);
    const poly = bl?.polygon ?? [];
    if (poly.length < 3) {
      return { cx: bl?.cx ?? 0, cy: bl?.cy ?? 0, w: bl?.w ?? 0, l: bl?.l ?? 0, theta };
    }
    // Centroïde moyen (indépendant de la forme)
    let cx = 0, cy = 0;
    for (const p of poly) { cx += p.x; cy += p.y; }
    cx /= poly.length; cy /= poly.length;
    // Extent dans le repère local
    let minL = Infinity, minW = Infinity, maxL = -Infinity, maxW = -Infinity;
    for (const p of poly) {
      const dx = p.x - cx, dy = p.y - cy;
      const lx =  dx * cos + dy * sin;  // axe L
      const ly = -dx * sin + dy * cos;  // axe W
      if (lx < minL) minL = lx; if (lx > maxL) maxL = lx;
      if (ly < minW) minW = ly; if (ly > maxW) maxW = ly;
    }
    const l = maxL - minL, w = maxW - minW;
    // Si polygone asymétrique (L-shape…), on recentre sur le milieu de l'extent
    const ocL = (minL + maxL) / 2, ocW = (minW + maxW) / 2;
    const obbCx = cx + ocL * cos - ocW * sin;
    const obbCy = cy + ocL * sin + ocW * cos;
    return { cx: obbCx, cy: obbCy, w, l, theta };
  },

  /** Synchronise S.bat (bbox axis-aligned) depuis le premier bloc polygonal. */
  _syncBatFromBlocs() {
    if (!this.S.blocs?.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const bl of this.S.blocs) {
      const pts = bl.polygon || [];
      for (const p of pts) {
        const x = p.x ?? p[0], y = p.y ?? p[1];
        if (x < minX) minX = x; if (y < minY) minY = y;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
    }
    if (!Number.isFinite(minX)) return;
    this.S.bat = {
      x: this._snap(minX),
      y: this._snap(minY),
      w: Math.max(MIN_W, this._snap(maxX - minX)),
      l: Math.max(MIN_L, this._snap(maxY - minY)),
    };
  },

  /** Somme des aires des blocs (fallback sur S.bat.w*l si pas de blocs). */
  _totalBlocArea() {
    if (!this.S.blocs?.length) return this.S.bat.w * this.S.bat.l;
    let a = 0;
    for (const bl of this.S.blocs) {
      if (bl.polygon?.length >= 3) a += polyArea(bl.polygon.map(p => [p.x ?? p[0], p.y ?? p[1]]));
    }
    return a > 0 ? a : this.S.bat.w * this.S.bat.l;
  },

  // ═════════════════════════════════════════════════════════════════
  // RENDU PLAN
  // ═════════════════════════════════════════════════════════════════

  renderPlan(m) {
    const t = this._terrain, b = this.S.bat, sc = m.sc, env = this.computeEnv();
    const batCol = m.inEnv ? sc.col : 'var(--svg-voie)';
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

    // Zone fills recul — bande perpendiculaire largeur=recul, clippée à la parcelle
    // pour éviter les triangles d'overlap aux sommets aigus (diagonales).
    if (this.S.layers.reculs) {
      const n = t.poly.length;
      for (let i = 0; i < n; i++) {
        const type = this.S.edgeTypes[i];
        const r = this.edgeRecul(i);
        if (r <= 0) continue;
        const col = COL[type];
        const [p1x, p1y] = t.poly[i], [p2x, p2y] = t.poly[(i + 1) % n];
        const dx = p2x - p1x, dy = p2y - p1y, len = Math.hypot(dx, dy);
        if (len < 0.1) continue;
        // Normale rentrante (vers l'intérieur du polygone) — orientation via signedArea
        const sa = _signedAreaArr(t.poly);
        const orient = sa >= 0 ? 1 : -1;
        const nxu = -dy / len * orient, nyu = dx / len * orient;
        // Quad perpendiculaire de largeur r (pas dérivé du env polygon)
        const band = [
          [p1x, p1y],
          [p2x, p2y],
          [p2x + nxu * r, p2y + nyu * r],
          [p1x + nxu * r, p1y + nyu * r],
        ];
        const clipped = clipSH(band, t.poly);
        if (clipped.length < 3) continue;
        const pts = clipped.map(([x, y]) => this._w2s(x, y).map(v => this._dd(v)).join(',')).join(' ');
        parts.push(`<polygon points="${pts}" fill="${this._ra(col, .08)}" stroke="none"/>`);
      }
    }

    // Terrain outline
    parts.push(`<polygon points="${this._polyPts(t.poly)}" fill="none" stroke="rgba(100,88,68,.5)" stroke-width="1.5"/>`);
    parts.push(this._tx((x0 + x1) / 2, y0 - 1.6, `${t.area.toFixed(0)} m² · ${t.commune}`, 8.5, 'rgba(100,88,68,.7)'));

    // NB : les arêtes colorées épaisses sont dessinées en fin de renderPlan
    // (après bâtiment/parking/végétation) pour rester toujours lisibles.

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
      parts.push(`<polygon points="${this._polyPts(env.poly)}" fill="rgba(34,197,94,.07)" stroke="var(--svg-fond)" stroke-width="1.2" stroke-dasharray="8,4"/>`);
      const ebb = polyAABB(env.poly);
      parts.push(this._tx((ebb.x + ebb.x1) / 2, ebb.y1 + 1.5, `env. ${polyArea(env.poly).toFixed(0)} m² · max ${this._terrain.plu.emprMax}% = ${(polyArea(env.poly) * this._terrain.plu.emprMax / 100).toFixed(0)} m²`, 7.5, 'rgba(34,197,94,.75)'));
    }

    // Végétation
    if (this.S.layers.veg && this._terrain.plu.constructible) {
      const plants = this._computeVegPlants(m);
      for (const p of plants) this._drawPlant(parts, p.x, p.y, p.r, p.type, p.s);
    }

    // Parking — clippé contre la PARCELLE et l'enveloppe pour ne pas déborder
    if (this.S.layers.parking && this.S.prog.parkMode === 'ext' && !this.S.prog.parkSS && m.parkReq > 0 && this._terrain.plu.constructible) {
      const GAP = 1.0, totalArea = m.parkReq * 25;
      const env2 = this.computeEnv();
      let pkx, pkl, pkw, pkbb;
      if (this.S.parkSide === 'est') { const av = env2.x1 - (b.x + b.w) - GAP; pkw = Math.max(4, Math.min(13, av)); pkl = Math.min(env2.h, Math.max(5, totalArea / pkw)); pkx = Math.min(b.x + b.w + GAP, env2.x1 - pkw); pkbb = Math.max(env2.y, Math.min(b.y, env2.y1 - pkl)); }
      else if (this.S.parkSide === 'ouest') { const av = b.x - env2.x - GAP; pkw = Math.max(4, Math.min(13, av)); pkl = Math.min(env2.h, Math.max(5, totalArea / pkw)); pkx = Math.max(env2.x, b.x - pkw - GAP); pkbb = Math.max(env2.y, Math.min(b.y, env2.y1 - pkl)); }
      else if (this.S.parkSide === 'nord') { const av = env2.y1 - (b.y + b.l) - GAP; pkl = Math.max(4, Math.min(13, av)); pkw = Math.min(env2.w, Math.max(5, totalArea / pkl)); pkx = Math.max(env2.x, Math.min(b.x, env2.x1 - pkw)); pkbb = Math.min(b.y + b.l + GAP, env2.y1 - pkl); }
      else { const av = b.y - env2.y - GAP; pkl = Math.max(4, Math.min(13, av)); pkw = Math.min(env2.w, Math.max(5, totalArea / pkl)); pkx = Math.max(env2.x, Math.min(b.x, env2.x1 - pkw)); pkbb = Math.max(env2.y, b.y - pkl - GAP); }
      const pkRect = [[pkx, pkbb], [pkx + pkw, pkbb], [pkx + pkw, pkbb + pkl], [pkx, pkbb + pkl]];
      const pkClipped = clipSH(clipSH(pkRect, env.poly), t.poly);
      if (pkClipped.length >= 3) {
        const pkPts = pkClipped.map(([x, y]) => this._w2s(x, y).map(v => this._dd(v)).join(',')).join(' ');
        parts.push(`<polygon points="${pkPts}" fill="rgba(172,164,140,.32)" stroke="rgba(120,112,90,.45)" stroke-width="1"/>`);
        parts.push(`<polygon points="${pkPts}" fill="url(#pmc-hatch)" opacity=".4"/>`);
        const cx = pkClipped.reduce((s, p) => s + p[0], 0) / pkClipped.length;
        const cy = pkClipped.reduce((s, p) => s + p[1], 0) / pkClipped.length;
        parts.push(this._tx(cx, cy, `${m.parkReq} PK`, 9, 'rgba(70,60,50,.7)'));
      }
    }

    // Bâtiment — filet de sécurité : clip chaque BLOC (pas l'AABB global) contre
    // la parcelle, puis vérification de surface minimale (12 m²). L'AABB peut
    // déborder d'une parcelle diagonale ou d'une forme L/T — d'où le check bloc
    // par bloc avant d'abandonner le rendu.
    const SURFACE_MIN_M2 = 12;
    let batTotalArea = 0;
    for (const bl of (this.S.blocs ?? [])) {
      const blPoly = bl.polygon?.length >= 3
        ? bl.polygon.map(p => [p.x ?? p[0], p.y ?? p[1]])
        : [[bl.x, bl.y], [bl.x + bl.w, bl.y], [bl.x + bl.w, bl.y + bl.l], [bl.x, bl.y + bl.l]];
      const blClipped = clipSH(blPoly, t.poly);
      if (blClipped.length >= 3) batTotalArea += polyArea(blClipped);
    }
    // Fallback legacy : test AABB si blocs absents
    if (!this.S.blocs?.length) {
      const batRect = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.l], [b.x, b.y + b.l]];
      const batClipped = clipSH(clipSH(batRect, env.poly), t.poly);
      batTotalArea = batClipped.length >= 3 ? polyArea(batClipped) : 0;
    }
    const batSafe = batTotalArea >= SURFACE_MIN_M2;
    if (!batSafe) {
      this.S._insetWarn = `Bâtiment hors parcelle (surface clip = ${batTotalArea.toFixed(1)} m²) — repositionnez ou ajustez les reculs`;
    }

    if (this._terrain.plu.constructible && batSafe) {
      const blocs = this.getBlocRects(m);
      const isMulti = blocs.length > 1;
      const activeIdx = this.S.activeBlocIdx ?? 0;
      let activeBBox = null;

      // Wrap blocs dans clip parcelle — tout débordement rotation/resize
      // est masqué visuellement au niveau SVG.
      parts.push(`<g clip-path="url(#pmc-tc)">`);

      blocs.forEach((bl, bi) => {
        const isActive = bi === activeIdx;
        // Couleur par usage (blocs multi). Si rdcUsage diffère, on applique un
        // gradient vertical pour suggérer l'empilement.
        const srcBl = this.S.blocs?.[bi];
        const usg = srcBl?.usage ?? 'logement';
        const rdcU = srcBl?.rdcUsage;
        const col = (isMulti && USAGE_COLORS[usg]) ? USAGE_COLORS[usg] : batCol;

        // Polygone du bloc en coords world [x,y] (pour _insetPoly 2m).
        let blocPolyW = null;
        if (bl._isPoly && bl.polygon?.length >= 3) {
          blocPolyW = bl.polygon.map(p => [p.x, p.y]);
        } else {
          blocPolyW = [
            [bl.x, bl.y], [bl.x + bl.w, bl.y],
            [bl.x + bl.w, bl.y + bl.l], [bl.x, bl.y + bl.l],
          ];
        }

        // Tous les blocs sont draggables : data-type + data-bloc-idx sur chaque body
        if (bl._isPoly && bl.polygon?.length >= 3) {
          const pts = bl.polygon.map(p => this._w2s(p.x, p.y).map(v => this._dd(v)).join(',')).join(' ');
          parts.push(`<polygon points="${pts}" fill="rgba(0,0,0,.13)" transform="translate(4,4)" pointer-events="none"/>`);
          parts.push(`<polygon points="${pts}" fill="${this._ra(col, isActive ? .32 : .20)}" stroke="${col}" stroke-width="${isActive ? 2.5 : 1.8}" data-type="building-body" data-bloc-idx="${bi}" style="cursor:move"/>`);
        } else {
          const [bsx, bsy] = this._w2s(bl.x, bl.y + bl.l);
          const bw2 = this._px(bl.w), bh2 = this._px(bl.l);
          parts.push(`<rect x="${this._dd(bsx + 4)}" y="${this._dd(bsy + 4)}" width="${this._dd(bw2)}" height="${this._dd(bh2)}" fill="rgba(0,0,0,.13)" rx="2" pointer-events="none"/>`);
          parts.push(`<rect x="${this._dd(bsx)}" y="${this._dd(bsy)}" width="${this._dd(bw2)}" height="${this._dd(bh2)}" fill="${this._ra(col, isActive ? .32 : .20)}" stroke="${col}" stroke-width="${isActive ? 2.5 : 1.8}" rx="2" data-type="building-body" data-bloc-idx="${bi}" style="cursor:move"/>`);
          const vaH = Math.min(this._px(1.5), bh2 * .16);
          parts.push(`<rect x="${this._dd(bsx)}" y="${this._dd(bsy)}" width="${this._dd(bw2)}" height="${this._dd(vaH)}" fill="rgba(245,222,179,.6)" stroke="${col}" stroke-width=".9" stroke-dasharray="5,3" pointer-events="none"/>`);
        }

        // Contour intérieur 2m — clipPath bloc + evenodd masquent débordements.
        const inset = _insetPoly(blocPolyW, Array(blocPolyW.length).fill(2));
        const insetValid = inset && inset.length >= 3
          && inset.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]))
          && polyArea(inset) >= 1;
        if (insetValid) {
          const clipPts = blocPolyW.map(([x, y]) => this._w2s(x, y).map(v => this._dd(v)).join(',')).join(' ');
          const insPts = inset.map(([x, y]) => this._w2s(x, y).map(v => this._dd(v)).join(',')).join(' ');
          parts.push(`<clipPath id="pmc-bl-${bi}"><polygon points="${clipPts}"/></clipPath>`);
          parts.push(`<g clip-path="url(#pmc-bl-${bi})" pointer-events="none">`);
          parts.push(`<polygon points="${insPts}" fill="rgba(76,168,112,0.08)" fill-rule="evenodd" stroke="#4ca870" stroke-width="0.9" stroke-dasharray="5,3"/>`);
          parts.push(`</g>`);
        }
        // Label
        const cxBloc = bl.cx ?? (bl.x + bl.w / 2);
        const cyBloc = bl.cy ?? (bl.y + bl.l / 2);
        const [sx, sy] = this._w2s(cxBloc, cyBloc);
        if (bi === 0 && !isMulti) {
          const nvL = NV[m.nvEff] || `R+${m.nvEff - 1}`;
          const sub = `${bl.w.toFixed(1)}\u00d7${bl.l.toFixed(1)}m`;
          parts.push(`<text x="${this._dd(sx)}" y="${this._dd(sy - 10)}" text-anchor="middle" font-size="16" fill="${col}" font-weight="700" font-family="'Playfair Display',sans-serif" pointer-events="none">${this.S.prog.type === 'maison' ? 'Maison' : `${m.nbLgts} lgts`}</text>`);
          parts.push(`<text x="${this._dd(sx)}" y="${this._dd(sy + 6)}" text-anchor="middle" font-size="9.5" fill="${col}" opacity=".85" font-family="'Inconsolata',monospace" pointer-events="none">${sub}</text>`);
          parts.push(`<text x="${this._dd(sx)}" y="${this._dd(sy + 19)}" text-anchor="middle" font-size="9" fill="${col}" opacity=".65" font-family="'Inconsolata',monospace" pointer-events="none">${nvL} \u00b7 h\u2264${m.nvEff * H_NIV}m</text>`);
        } else if (isMulti) {
          const nv = srcBl?.niveaux ?? m.nvEff;
          const nvStr = nv <= 1 ? 'R+0' : `R+${nv - 1}`;
          const SHORT = { logement: 'log', commerce: 'com', bureau: 'bur', parking: 'park', mixte: 'mix' };
          const uShort = SHORT[usg] ?? usg;
          // Affichage empilement : "com/log R+2" si RdC a un usage différent
          const stackStr = (rdcU && rdcU !== usg)
            ? `${SHORT[rdcU] ?? rdcU}+${uShort} ${nvStr}`
            : `${nvStr} \u00b7 ${uShort}`;
          parts.push(`<text x="${this._dd(sx)}" y="${this._dd(sy - 4)}" text-anchor="middle" font-size="11" fill="${col}" font-weight="700" font-family="'Inconsolata',monospace" pointer-events="none">B${bi + 1}</text>`);
          parts.push(`<text x="${this._dd(sx)}" y="${this._dd(sy + 8)}" text-anchor="middle" font-size="8.5" fill="${col}" opacity=".85" font-family="'Inconsolata',monospace" pointer-events="none">${stackStr}</text>`);
        }
        if (isActive) activeBBox = { x: bl.x, y: bl.y, w: bl.w, l: bl.l };
      });

      parts.push(`</g>`); // /g clip-path pmc-tc

      // Handles alignés sur l'OBB du bloc actif (rotation respectée).
      // Convention rectCentered : local X = L (longueur), local Y = W (largeur).
      // Handles 'e/w' scale L, 'n/s' scale W.
      const hasBlocs = this.S.blocs?.length > 0;
      const activeBl = hasBlocs ? this.S.blocs[activeIdx] : null;
      const obb = hasBlocs && activeBl
        ? this._blocOBB(activeBl)
        : { cx: b.x + b.w / 2, cy: b.y + b.l / 2, w: b.l, l: b.w, theta: 0 };
      const oth = obb.theta * Math.PI / 180;
      const oc = Math.cos(oth), os = Math.sin(oth);
      const L2W = (lx, ly) => [obb.cx + lx * oc - ly * os, obb.cy + lx * os + ly * oc];
      const HL = obb.l / 2;   // demi-longueur le long de X local
      const HW = obb.w / 2;   // demi-largeur le long de Y local
      const HH = [
        ['sw', L2W(-HL, -HW)], ['s', L2W(0, -HW)], ['se', L2W(HL, -HW)],
        ['w',  L2W(-HL, 0)],                       ['e',  L2W(HL, 0)],
        ['nw', L2W(-HL, HW)],  ['n', L2W(0, HW)],  ['ne', L2W(HL, HW)],
      ];

      // Outline OBB
      {
        const corners = [L2W(-HL, -HW), L2W(HL, -HW), L2W(HL, HW), L2W(-HL, HW)];
        const pts = corners.map(([x, y]) => this._w2s(x, y).map(v => this._dd(v)).join(',')).join(' ');
        parts.push(`<polygon points="${pts}" fill="none" stroke="${batCol}" stroke-width="1" stroke-dasharray="4,3" opacity=".55" pointer-events="none"/>`);
      }

      // Curseur : sur un bloc tourné, les curseurs directionnels CSS deviennent
      // trompeurs. On utilise 'crosshair' quand theta!=0 pour éviter l'ambiguïté.
      const rotated = Math.abs(obb.theta % 180) > 0.5;
      const cursorFor = (hid) => rotated ? 'crosshair' : `${hid}-resize`;

      HH.forEach(([hid, [hwx, hwy]]) => {
        const [hsx, hsy] = this._w2s(hwx, hwy);
        const isCorner = ['sw', 'se', 'ne', 'nw'].includes(hid);
        const cur = cursorFor(hid);
        if (isCorner) parts.push(`<circle cx="${this._dd(hsx)}" cy="${this._dd(hsy)}" r="5.5" fill="white" stroke="${batCol}" stroke-width="2" data-handle="${hid}" style="cursor:${cur}"/>`);
        else { const s = 4.5; parts.push(`<rect x="${this._dd(hsx - s)}" y="${this._dd(hsy - s)}" width="${this._dd(s * 2)}" height="${this._dd(s * 2)}" fill="white" stroke="${batCol}" stroke-width="1.5" data-handle="${hid}" style="cursor:${cur}" transform="rotate(45,${this._dd(hsx)},${this._dd(hsy)})"/>`); }
      });

      // Handle de rotation : dans la direction +Y local (côté "nord" OBB)
      if (hasBlocs) {
        const rotExt = Math.max(1.5, HW * 0.35 + 1.2);
        const [nrot_x, nrot_y] = L2W(0, HW + rotExt);
        const [np_x, np_y] = L2W(0, HW);
        const [rsx, rsy] = this._w2s(nrot_x, nrot_y);
        const [nsx, nsy] = this._w2s(np_x, np_y);
        parts.push(`<line x1="${this._dd(nsx)}" y1="${this._dd(nsy)}" x2="${this._dd(rsx)}" y2="${this._dd(rsy)}" stroke="${batCol}" stroke-width="1" stroke-dasharray="3,3" pointer-events="none"/>`);
        parts.push(`<circle cx="${this._dd(rsx)}" cy="${this._dd(rsy)}" r="7" fill="white" stroke="${batCol}" stroke-width="2" data-handle="rot" style="cursor:grab"/>`);
        parts.push(`<text x="${this._dd(rsx)}" y="${this._dd(rsy + 3.2)}" text-anchor="middle" font-size="9" fill="${batCol}" pointer-events="none" font-family="'Inconsolata',monospace">\u21bb</text>`);
      }
    }

    // Emprise du parti (bounding box multi-blocs clipped to env)
    if (this.S.layers.emprise && this._terrain.plu.constructible) this._drawEmprise(parts, m, env);

    // Circulation portail → blocs
    if (this.S.layers.circ && this._terrain.plu.constructible) this._drawCirculation(parts, m);

    // Programme COLL/BANDE/INDIV + split JOUR/NUIT (via FH.clipToBand)
    if (this.S.layers.prog && this._terrain.plu.constructible) this._drawProgramme(parts, m);

    // Arêtes colorées épaisses — dessinées EN DERNIER pour rester visibles
    // par-dessus bâtiment/parking/végétation (demande utilisateur).
    { const n = t.poly.length;
      for (let i = 0; i < n; i++) {
        const [p1x, p1y] = t.poly[i], [p2x, p2y] = t.poly[(i + 1) % n];
        const [sx1, sy1] = this._w2s(p1x, p1y), [sx2, sy2] = this._w2s(p2x, p2y);
        const type = this.S.edgeTypes[i];
        const col = COL[type];
        const isMit = type === 'lat' && this.S.mitoyen[i];
        const sw = isMit ? 7 : 4;
        const op = isMit ? 0.95 : 0.85;
        parts.push(`<line x1="${this._dd(sx1)}" y1="${this._dd(sy1)}" x2="${this._dd(sx2)}" y2="${this._dd(sy2)}" stroke="${col}" stroke-width="${sw}" opacity="${op}" stroke-linecap="round" pointer-events="none"/>`);
        if (isMit) {
          const mx = (p1x + p2x) / 2, my = (p1y + p2y) / 2;
          const dx = p2x - p1x, dy = p2y - p1y, len = Math.hypot(dx, dy) || 1;
          const nxu = -dy / len, nyu = dx / len;
          const [slx, sly] = this._w2s(mx + nxu * 1.0, my + nyu * 1.0);
          parts.push(`<rect x="${this._dd(slx - 30)}" y="${this._dd(sly - 9)}" width="60" height="13" fill="rgba(59,130,246,.92)" rx="2" pointer-events="none"/>`);
          parts.push(`<text x="${this._dd(slx)}" y="${this._dd(sly + 1)}" text-anchor="middle" font-size="9" font-weight="700" fill="white" font-family="'Inconsolata',monospace" pointer-events="none">MITOYEN 0m</text>`);
        }
      }
    }

    // Arêtes hit areas (par-dessus tout pour capter les clics)
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
      parts.push(`<line x1="${this._dd(bx1)}" y1="${this._dd(cotY)}" x2="${this._dd(bx2)}" y2="${this._dd(cotY)}" stroke="var(--svg-dim)" stroke-width="1"/>`);
      parts.push(`<text x="${this._dd((bx1 + bx2) / 2)}" y="${this._dd(cotY + 12)}" text-anchor="middle" font-size="9" fill="var(--svg-dim)" font-family="'Inconsolata',monospace" font-weight="500">${b.w.toFixed(1)} m</text>`);
      // Profondeur
      const [, by3] = this._w2s(b.x + b.w, b.y + b.l);
      const cotX = bx2 + 18;
      parts.push(`<line x1="${this._dd(cotX)}" y1="${this._dd(by1)}" x2="${this._dd(cotX)}" y2="${this._dd(by3)}" stroke="var(--svg-dim)" stroke-width="1"/>`);
      parts.push(`<text x="${this._dd(cotX + 8)}" y="${this._dd((by1 + by3) / 2 + 4)}" font-size="9" fill="var(--svg-dim)" font-family="'Inconsolata',monospace" font-weight="500">${b.l.toFixed(1)} m</text>`);
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
      <rect x="${sb0x}" y="${sb0y - 9}" width="${this._dd(sc10 / 2)}" height="7" fill="var(--svg-dim)" opacity=".75" rx="1"/>
      <rect x="${this._dd(sb0x + sc10 / 2)}" y="${sb0y - 9}" width="${this._dd(sc10 / 2)}" height="7" fill="white" stroke="var(--svg-dim)" stroke-width=".6" rx="1" opacity=".75"/>
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
      <line x1="${this._dd(lsx + 5)}" y1="${this._dd(lsy + 22)}" x2="${this._dd(lsx + 18)}" y2="${this._dd(lsy + 22)}" stroke="var(--svg-voie)" stroke-width="3"/>
      <text x="${this._dd(lsx + 22)}" y="${this._dd(lsy + 25)}" font-size="7.5" fill="#6B7280" font-family="'Inconsolata',monospace">voie</text>
      <line x1="${this._dd(lsx + 5)}" y1="${this._dd(lsy + 32)}" x2="${this._dd(lsx + 18)}" y2="${this._dd(lsy + 32)}" stroke="var(--svg-lat)" stroke-width="3"/>
      <text x="${this._dd(lsx + 22)}" y="${this._dd(lsy + 35)}" font-size="7.5" fill="#6B7280" font-family="'Inconsolata',monospace">latérale</text>
      <line x1="${this._dd(lsx + 5)}" y1="${this._dd(lsy + 42)}" x2="${this._dd(lsx + 18)}" y2="${this._dd(lsy + 42)}" stroke="var(--svg-fond)" stroke-width="3"/>
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
    parts.push(`<text x="${xVoie + r.voie * SC2 / 2}" y="${groundY + 18}" text-anchor="middle" font-size="8.5" fill="var(--svg-voie)" font-family="'Inconsolata',monospace">voie ${r.voie}m</text>`);
    parts.push(`<rect x="${xBatN}" y="${MT}" width="${r.fond * SC2}" height="${groundY - MT}" fill="rgba(34,197,94,.07)"/>`);
    parts.push(`<text x="${xBatN + r.fond * SC2 / 2}" y="${groundY + 18}" text-anchor="middle" font-size="8.5" fill="var(--svg-fond)" font-family="'Inconsolata',monospace">fond ${r.fond}m</text>`);

    // heMax
    parts.push(`<line x1="${xVoie - 18}" y1="${heMaxY}" x2="${xFond + 22}" y2="${heMaxY}" stroke="var(--svg-voie)" stroke-width="1.5" stroke-dasharray="8,4"/>`);
    parts.push(`<text x="${xFond + 26}" y="${heMaxY + 4}" font-size="10" fill="var(--svg-voie)" font-family="'Inconsolata',monospace" font-weight="600">h max ${heMax}m</text>`);

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
    parts.push(`<line x1="${dimX}" y1="${batTopY}" x2="${dimX}" y2="${groundY}" stroke="var(--svg-dim)" stroke-width="1"/>`);
    parts.push(`<text x="${dimX + 10}" y="${(batTopY + groundY) / 2 + 4}" font-size="11" fill="var(--svg-dim)" font-family="'Inconsolata',monospace" font-weight="600">${hBat}m</text>`);

    // Cotation profondeur
    parts.push(`<line x1="${xBatS}" y1="${groundY + 32}" x2="${xBatN}" y2="${groundY + 32}" stroke="var(--svg-dim)" stroke-width="1"/>`);
    parts.push(`<text x="${(xBatS + xBatN) / 2}" y="${groundY + 47}" text-anchor="middle" font-size="11" fill="var(--svg-dim)" font-family="'Inconsolata',monospace" font-weight="600">${b.l.toFixed(1)}m N-S</text>`);

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
    // Persist blocs dans la session (debounced via scheduler simple)
    if (!this._persistTimer) {
      this._persistTimer = setTimeout(() => {
        this._persistTimer = null;
        this._persistBlocs?.();
      }, 250);
    }
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

    // Gauges — labels PLU explicites (emprise MAX, perméabilité MIN)
    const empPct = m.empPct, empMax = plu.emprMax;
    const empBar = Math.min(100, empPct / empMax * 100);
    const empOver = empPct > empMax;
    const empColor = empOver ? 'var(--svg-voie)' : empPct > empMax * .9 ? '#F59E0B' : '#6366F1';
    const gfEmp = g('pmc-gf-emp');
    if (gfEmp) { gfEmp.style.width = empBar.toFixed(0) + '%'; gfEmp.style.background = empColor; }
    sv('pmc-gv-emp', empPct.toFixed(1) + '%');
    const glEmp = g('pmc-gl-emp');
    if (glEmp) {
      glEmp.textContent = `MAX ${empMax}% PLU`;
      glEmp.style.color = empOver ? 'var(--svg-voie)' : 'var(--faint)';
      glEmp.style.fontWeight = empOver ? '700' : '400';
    }

    const permPct = m.permPct, permMin = plu.permMin;
    const permBar = Math.min(100, permPct / 100 * 100);
    const permUnder = permPct < permMin;
    const permColor = permUnder ? 'var(--svg-voie)' : 'var(--svg-fond)';
    const gfPerm = g('pmc-gf-perm');
    if (gfPerm) { gfPerm.style.width = permBar.toFixed(0) + '%'; gfPerm.style.background = permColor; }
    const gvPerm = g('pmc-gv-perm');
    if (gvPerm) {
      gvPerm.textContent = permPct.toFixed(1) + '%';
      gvPerm.style.color = permUnder ? 'var(--svg-voie)' : 'var(--success)';
    }
    const glPerm = g('pmc-gl-perm');
    if (glPerm) {
      glPerm.textContent = `MIN ${permMin}% PLU (espace vert)`;
      glPerm.style.color = permUnder ? 'var(--svg-voie)' : 'var(--faint)';
      glPerm.style.fontWeight = permUnder ? '700' : '400';
    }

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

    // Status bar — terrain + scénario + stratégie géométrique
    const sc = this.curSc();
    const scLabel = sc ? ` · ${sc.id} ${sc.label} (${sc.strategy})` : '';
    sv('pmc-terrain-info', `${this._terrain.commune} · ${this._terrain.area.toFixed(0)} m²${scLabel}`);

    // Dispatch event pour sync avec P07
    window.dispatchEvent(new CustomEvent('pmc:metrics', { detail: m }));
  },

  // ── EMPRISE DU PARTI (BBox multi-blocs ∩ env) ──────────────────────
  // Porté depuis testbench terlab_parcelles_v4h.html / computeEmprise+drawEmprise.
  // Monobloc → rect bloc. Multi-blocs → bbox de tous les blocs, clip contre
  // l'enveloppe constructible. Visuel dashed orange, utile pour la lecture
  // "ici se tient le parti, là on laisse libre".
  _drawEmprise(parts, m, env) {
    const blocs = this.getBlocRects(m);
    if (!blocs || !blocs.length) return;
    let emp;
    if (blocs.length === 1) {
      const bl = blocs[0];
      emp = [[bl.x, bl.y], [bl.x + bl.w, bl.y], [bl.x + bl.w, bl.y + bl.l], [bl.x, bl.y + bl.l]];
    } else {
      const xs = [], ys = [];
      for (const bl of blocs) { xs.push(bl.x, bl.x + bl.w); ys.push(bl.y, bl.y + bl.l); }
      const PAD = 0.5;
      const bbox = [
        [Math.min(...xs) - PAD, Math.min(...ys) - PAD],
        [Math.max(...xs) + PAD, Math.min(...ys) - PAD],
        [Math.max(...xs) + PAD, Math.max(...ys) + PAD],
        [Math.min(...xs) - PAD, Math.max(...ys) + PAD],
      ];
      emp = clipSH(bbox, env.poly);
      if (!emp || emp.length < 3) emp = bbox;
    }
    const pts = emp.map(([x, y]) => this._w2s(x, y).map(v => this._dd(v)).join(',')).join(' ');
    parts.push(`<polygon points="${pts}" fill="rgba(251,191,36,.10)" stroke="rgba(217,119,6,.70)" stroke-width="1.6" stroke-dasharray="10,5" pointer-events="none"/>`);
    const ecx = emp.reduce((s, p) => s + p[0], 0) / emp.length;
    const ecy = emp.reduce((s, p) => s + p[1], 0) / emp.length;
    parts.push(this._tx(ecx, ecy - 0.2, `emprise ${polyArea(emp).toFixed(0)} m²`, 7, 'rgba(146,64,14,.80)'));
  },

  // ── CIRCULATION PORTAIL → BLOCS ────────────────────────────────────
  // Porté depuis testbench terlab_parcelles_v4h.html / drawCirculation.
  // Portail = milieu de l'arête voie. Jonction = 8 m vers l'intérieur.
  // Chemin brisé L : portail → jonction → entrée (milieu de l'arête de
  // chaque bloc la plus proche du portail). Distance Manhattan affichée.
  _drawCirculation(parts, m) {
    const t = this._terrain;
    const n = t.poly.length;
    let vI = -1;
    for (let i = 0; i < n; i++) if (this.S.edgeTypes[i] === 'voie') { vI = i; break; }
    if (vI < 0) return;
    const a = t.poly[vI], b = t.poly[(vI + 1) % n];
    const portal = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 };
    // Normale intérieure à l'arête voie
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    // Centre parcelle comme "intérieur" de référence
    const cx = t.poly.reduce((s, p) => s + p[0], 0) / n;
    const cy = t.poly.reduce((s, p) => s + p[1], 0) / n;
    let nxu = -dy / len, nyu = dx / len;
    if ((cx - portal.x) * nxu + (cy - portal.y) * nyu < 0) { nxu = -nxu; nyu = -nyu; }
    const JUNCT = 8; // m
    const junction = { x: portal.x + nxu * JUNCT, y: portal.y + nyu * JUNCT };

    // Portal marker
    const [psx, psy] = this._w2s(portal.x, portal.y);
    parts.push(`<circle cx="${this._dd(psx)}" cy="${this._dd(psy)}" r="7" fill="rgba(220,38,38,.85)" stroke="white" stroke-width="2" pointer-events="none"/>`);
    parts.push(`<circle cx="${this._dd(psx)}" cy="${this._dd(psy)}" r="11" fill="none" stroke="rgba(220,38,38,.35)" stroke-width="1.3" pointer-events="none"/>`);
    parts.push(this._tx(portal.x + nxu * 1.0, portal.y + nyu * 1.0 - 0.8, 'PORTAIL', 7, 'rgba(180,20,20,.90)'));

    const blocs = this.getBlocRects(m);
    blocs.forEach((bl, bi) => {
      // Milieu d'arête la plus proche du portail : polygone réel si dispo, sinon bbox
      let edges;
      if (bl.polygon?.length >= 3) {
        edges = [];
        for (let i = 0, n = bl.polygon.length; i < n; i++) {
          const a = bl.polygon[i], b = bl.polygon[(i + 1) % n];
          edges.push({ mx: ((a.x ?? a[0]) + (b.x ?? b[0])) / 2, my: ((a.y ?? a[1]) + (b.y ?? b[1])) / 2 });
        }
      } else {
        edges = [
          { mx: bl.x + bl.w / 2, my: bl.y },
          { mx: bl.x + bl.w / 2, my: bl.y + bl.l },
          { mx: bl.x,          my: bl.y + bl.l / 2 },
          { mx: bl.x + bl.w,   my: bl.y + bl.l / 2 },
        ];
      }
      let best = edges[0], bestD = Infinity;
      for (const e of edges) {
        const d = Math.hypot(e.mx - portal.x, e.my - portal.y);
        if (d < bestD) { bestD = d; best = e; }
      }
      const midTurn = { x: best.mx, y: junction.y };
      const path = [portal, junction, midTurn, best]
        .map(p => this._w2s(p.x, p.y).map(v => this._dd(v)).join(','))
        .join(' ');
      parts.push(`<polyline points="${path}" fill="none" stroke="rgba(220,38,38,.60)" stroke-width="1.6" stroke-dasharray="6,3" stroke-linecap="round" pointer-events="none"/>`);
      const [ex, ey] = this._w2s(best.mx, best.my);
      parts.push(`<circle cx="${this._dd(ex)}" cy="${this._dd(ey)}" r="4" fill="rgba(220,38,38,.80)" stroke="white" stroke-width="1.3" pointer-events="none"/>`);
      const distM = Math.abs(junction.y - portal.y) + Math.abs(midTurn.x - junction.x) + Math.abs(best.my - midTurn.y);
      const lblMx = (portal.x + best.mx) / 2;
      const lblMy = (junction.y + best.my) / 2;
      parts.push(this._tx(lblMx, lblMy - 0.3, `${distM.toFixed(0)} m`, 8, 'rgba(180,20,20,.90)'));
      if (blocs.length > 1) parts.push(this._tx(best.mx, best.my - 0.9, `entrée ${bi + 1}`, 6.5, 'rgba(180,20,20,.80)'));
    });
  },

  // ── PROGRAMME COLL / BANDE / INDIV + JOUR/NUIT ─────────────────────
  // Porté depuis testbench terlab_parcelles_v4h.html / drawProgPoly via FH.clipToBand.
  // Axe profondeur = normale à l'arête voie, orientée vers l'intérieur parcelle.
  // Split t=0 (voie) → t=1 (fond) : COLL [0..pC], BANDE [pC..pC+pB],
  // INDIV [pC+pB..1]. Individuel sous-divisé JOUR (voie-half) / NUIT (fond-half).
  _progMix() {
    const p = this.S.prog ?? {};
    const raw = p.mix ?? (p.type === 'maison' ? { c: 0, b: 0, i: 1 } : { c: 1, b: 0, i: 0 });
    const s = (raw.c || 0) + (raw.b || 0) + (raw.i || 0);
    if (s < 1e-4) return { c: 0, b: 0, i: 1 };
    return { c: (raw.c || 0) / s, b: (raw.b || 0) / s, i: (raw.i || 0) / s };
  },
  _voieAxis() {
    const t = this._terrain;
    const n = t.poly.length;
    let vI = -1;
    for (let i = 0; i < n; i++) if (this.S.edgeTypes[i] === 'voie') { vI = i; break; }
    if (vI < 0) return FH.polyDepthAxis(t.poly.map(([x, y]) => ({ x, y })), { voieIsMinY: false });
    const a = t.poly[vI], b = t.poly[(vI + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    let nxu = -dy / len, nyu = dx / len;
    const cx = t.poly.reduce((s, p) => s + p[0], 0) / n;
    const cy = t.poly.reduce((s, p) => s + p[1], 0) / n;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if ((cx - mx) * nxu + (cy - my) * nyu < 0) { nxu = -nxu; nyu = -nyu; }
    return { x: nxu, y: nyu };
  },
  _polyToSvgPts(poly) {
    return poly.map(p => {
      const [x, y] = Array.isArray(p) ? p : [p.x, p.y];
      const [sx, sy] = this._w2s(x, y);
      return `${this._dd(sx)},${this._dd(sy)}`;
    }).join(' ');
  },
  _drawProgramme(parts, m) {
    const mix = this._progMix();
    if (mix.c + mix.b + mix.i < 1e-4) return;
    const axis = this._voieAxis();
    const blocs = this.getBlocRects(m);
    const tColl = mix.c, tBand = mix.c + mix.b;
    for (const bl of blocs) {
      const rect = [
        { x: bl.x,         y: bl.y },
        { x: bl.x + bl.w,  y: bl.y },
        { x: bl.x + bl.w,  y: bl.y + bl.l },
        { x: bl.x,         y: bl.y + bl.l },
      ];
      const zColl  = mix.c > 0.005 ? FH.clipToBand(rect, axis, 0, tColl)     : null;
      const zBand  = mix.b > 0.005 ? FH.clipToBand(rect, axis, tColl, tBand) : null;
      const zIndiv = mix.i > 0.005 ? FH.clipToBand(rect, axis, tBand, 1.0)   : null;
      const midX = bl.x + bl.w / 2, midY = bl.y + bl.l / 2;

      if (zColl && zColl.length >= 3) {
        parts.push(`<polygon points="${this._polyToSvgPts(zColl)}" fill="rgba(42,88,72,.18)" stroke="rgba(42,88,72,.60)" stroke-width="1.1" pointer-events="none"/>`);
        const cc = zColl.reduce((a, p) => (a.x += p.x, a.y += p.y, a), { x: 0, y: 0 });
        parts.push(this._tx(cc.x / zColl.length, cc.y / zColl.length, 'COLL.', 7, 'rgba(42,88,72,.88)'));
      }
      if (zBand && zBand.length >= 3) {
        parts.push(`<polygon points="${this._polyToSvgPts(zBand)}" fill="rgba(122,72,50,.16)" stroke="rgba(122,72,50,.55)" stroke-width="1.1" pointer-events="none"/>`);
        const bc = zBand.reduce((a, p) => (a.x += p.x, a.y += p.y, a), { x: 0, y: 0 });
        parts.push(this._tx(bc.x / zBand.length, bc.y / zBand.length, 'BANDE', 7, 'rgba(122,72,50,.85)'));
      }
      if (zIndiv && zIndiv.length >= 3) {
        parts.push(`<polygon points="${this._polyToSvgPts(zIndiv)}" fill="rgba(243,233,210,.55)" stroke="rgba(90,65,28,.60)" stroke-width="1.1" pointer-events="none"/>`);
        const zJour = FH.clipToBand(zIndiv, axis, 0, 0.5);
        const zNuit = FH.clipToBand(zIndiv, axis, 0.5, 1.0);
        if (zJour && zJour.length >= 3) {
          parts.push(`<polygon points="${this._polyToSvgPts(zJour)}" fill="rgba(255,220,120,.28)" stroke="none" pointer-events="none"/>`);
          const jc = zJour.reduce((a, p) => (a.x += p.x, a.y += p.y, a), { x: 0, y: 0 });
          parts.push(this._tx(jc.x / zJour.length, jc.y / zJour.length, 'JOUR', 6.5, 'rgba(88,68,42,.75)'));
        }
        if (zNuit && zNuit.length >= 3) {
          parts.push(`<polygon points="${this._polyToSvgPts(zNuit)}" fill="rgba(130,160,210,.24)" stroke="none" pointer-events="none"/>`);
          const nc = zNuit.reduce((a, p) => (a.x += p.x, a.y += p.y, a), { x: 0, y: 0 });
          parts.push(this._tx(nc.x / zNuit.length, nc.y / zNuit.length, 'NUIT', 6.5, 'rgba(60,80,120,.80)'));
        }
        const sep = FH.cutLineInPoly(zIndiv, axis, 0.5);
        if (sep) {
          const [s1x, s1y] = this._w2s(sep[0].x, sep[0].y);
          const [s2x, s2y] = this._w2s(sep[1].x, sep[1].y);
          parts.push(`<line x1="${this._dd(s1x)}" y1="${this._dd(s1y)}" x2="${this._dd(s2x)}" y2="${this._dd(s2y)}" stroke="rgba(88,68,42,.35)" stroke-width=".9" stroke-dasharray="3,2" pointer-events="none"/>`);
        }
        if (!zColl && !zBand) parts.push(this._tx(midX, midY - bl.l * 0.42, 'INDIVIDUEL', 6.5, 'rgba(90,65,28,.75)'));
      }

      const drawDiv = (t) => {
        const seg = FH.cutLineInPoly(rect, axis, t);
        if (!seg) return;
        const [x1, y1] = this._w2s(seg[0].x, seg[0].y);
        const [x2, y2] = this._w2s(seg[1].x, seg[1].y);
        parts.push(`<line x1="${this._dd(x1)}" y1="${this._dd(y1)}" x2="${this._dd(x2)}" y2="${this._dd(y2)}" stroke="rgba(30,30,30,.22)" stroke-width="1" stroke-dasharray="5,3" pointer-events="none"/>`);
      };
      if (mix.c > 0.005 && (mix.b > 0.005 || mix.i > 0.005)) drawDiv(tColl);
      if (mix.b > 0.005 && mix.i > 0.005) drawDiv(tBand);
    }
  },

  // ── VÉGÉTATION ─────────────────────────────────────────────────────

  _computeVegPlants(m) {
    const t = this._terrain, n = t.poly.length, plants = [];
    const env = this.computeEnv();
    const MARGE = 1.8;
    const blocs = this.getBlocRects(m);
    // Expansion du polygone par inflation approximée : on teste le point contre
    // le polygone réel du bloc + une marge. Pour les rotés/L, ça évite que la
    // végétation s'installe dans les "coins vides" de la bbox axis-aligned.
    function onAnyBloc(fx, fy) {
      return blocs.some(bl => {
        if (bl.polygon?.length >= 3) {
          // Point dans le polygone réel ?
          if (ptInPoly(fx, fy, bl.polygon.map(p => [p.x ?? p[0], p.y ?? p[1]]))) return true;
          // Sinon distance au polygone ≤ MARGE (approximation : vérifier les arêtes)
          const pts = bl.polygon;
          for (let i = 0, n = pts.length; i < n; i++) {
            const a = pts[i], b = pts[(i + 1) % n];
            const ax = a.x ?? a[0], ay = a.y ?? a[1];
            const bx = b.x ?? b[0], by = b.y ?? b[1];
            if (distPtSeg(fx, fy, ax, ay, bx, by) < MARGE) return true;
          }
          return false;
        }
        // Fallback bbox axis-aligned
        return fx >= bl.x - MARGE && fx <= bl.x + bl.w + MARGE && fy >= bl.y - MARGE && fy <= bl.y + bl.l + MARGE;
      });
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
      if (edgeIdx !== undefined) {
        // Pending : cycleEdge ne se déclenche qu'au pointerup si l'utilisateur
        // n'a pas bougé > 4px (évite cycles accidentels en début de pan).
        self._drag = { type: 'edge-pending', edgeIdx: parseInt(edgeIdx), sx0: sx, sy0: sy, moved: false };
        svg.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      const h = e.target.dataset?.handle;
      const isBody = e.target.dataset?.type?.startsWith('building');
      const blocIdx = e.target.dataset?.blocIdx;
      // Click sur un bloc (body OU background-polygon) : change l'actif avant drag
      if (blocIdx !== undefined) self.S.activeBlocIdx = parseInt(blocIdx);
      if (h || isBody) {
        self.pushHistory?.();   // snapshot pré-drag pour undo
        const snap = self._snapshotActiveBloc();
        self._drag = {
          type: h ? 'handle' : 'body',
          h: h || null,
          ww0: [wx, wy],
          bat0: { ...self.S.bat },
          blocIdx: self.S.activeBlocIdx ?? 0,
          ...snap,      // poly0, bbox0, center0, theta0, w0, l0
        };
        svg.setPointerCapture(e.pointerId);
        e.preventDefault();
      } else {
        self._drag = { type: 'pan', sw0: [sx, sy], pan0: [self.S.panX, self.S.panY] };
        svg.setPointerCapture(e.pointerId);
      }
    });

    svg.addEventListener('pointermove', e => {
      if (!self._drag || self.S.view !== 'plan') return;
      const [sx, sy] = getSVGPt(e);
      const [wx, wy] = self._s2w(sx, sy);

      if (self._drag.type === 'edge-pending') {
        const ddx = sx - self._drag.sx0, ddy = sy - self._drag.sy0;
        if (Math.hypot(ddx, ddy) > 4) self._drag.moved = true;
        return;
      }

      if (self._drag.type === 'pan') {
        self.S.panX = self._drag.pan0[0] + sx - self._drag.sw0[0];
        self.S.panY = self._drag.pan0[1] + sy - self._drag.sw0[1];
        self.render(); return;
      }

      const dw = wx - self._drag.ww0[0], dh = wy - self._drag.ww0[1];
      const hasPoly = Array.isArray(self._drag.poly0);
      if (self._drag.type === 'body') {
        if (hasPoly) {
          self._translateActiveBloc(dw, dh);
        } else {
          const sb = self._drag.bat0, b = self.S.bat;
          b.x = self._snap(sb.x + dw); b.y = self._snap(sb.y + dh);
        }
      } else if (self._drag.type === 'handle' && self._drag.h === 'rot' && hasPoly) {
        self._rotateActiveBloc(wx, wy, e.shiftKey);
      } else {
        const hh = self._drag.h;
        if (hasPoly) {
          self._resizeActiveBloc(hh, dw, dh);
        } else {
          const sb = self._drag.bat0, b = self.S.bat;
          if (hh === 'sw' || hh === 'w' || hh === 'nw') { const nx = self._snap(sb.x + dw), nw = sb.x + sb.w - nx; if (nw >= MIN_W) { b.x = nx; b.w = nw; } }
          if (hh === 'se' || hh === 'e' || hh === 'ne') { const nw = self._snap(sb.w + dw); if (nw >= MIN_W) b.w = nw; }
          if (hh === 'sw' || hh === 's' || hh === 'se') { const ny = self._snap(sb.y + dh), nl = sb.y + sb.l - ny; if (nl >= MIN_L) { b.y = ny; b.l = nl; } }
          if (hh === 'nw' || hh === 'n' || hh === 'ne') { const nl = self._snap(sb.l + dh); if (nl >= MIN_L) b.l = nl; }
        }
      }
      if (self.S.blocs?.length) self._syncBatFromBlocs();
      self._clampBat();
      self.render();
    });

    svg.addEventListener('pointerup', () => {
      // Edge-pending : cycle uniquement si pas de drag détecté
      if (self._drag?.type === 'edge-pending' && !self._drag.moved) {
        self.cycleEdge(self._drag.edgeIdx);
      }
      // Drag réel sur bloc (body/handle) → édition manuelle : marque dirty
      // pour que les sliders / PLU override ne réécrasent pas la géométrie.
      const d = self._drag;
      if (d && (d.type === 'body' || d.type === 'handle')) {
        self.S._manualEdit = true;
      }
      self._drag = null;
    });

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
    // edgeType change l'enveloppe constructible (reculs voie/lat/fond) →
    // re-appliquer la stratégie SAUF si édition manuelle en cours.
    this._reApplyIfClean('cycleEdge');
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
    // Mitoyen = recul 0 sur cette arête → enveloppe change → re-apply sauf manual edit
    this._reApplyIfClean('setMitoyen');
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

  /** Deep-clone l'état blocs courant pour l'historique. */
  _snapshotBlocs() {
    return {
      blocs: (this.S.blocs ?? []).map(bl => ({
        ...bl,
        polygon: bl.polygon.map(p => ({ x: p.x, y: p.y })),
      })),
      activeBlocIdx: this.S.activeBlocIdx ?? 0,
      shapePreset: this.S.shapePreset ?? 'I',
    };
  },

  /** Sauvegarde l'état courant dans l'historique (avant une mutation). */
  pushHistory() {
    const snap = this._snapshotBlocs();
    this._history.push(snap);
    if (this._history.length > this._historyMax) this._history.shift();
    this._historyFuture.length = 0;  // toute nouvelle action efface le redo
  },

  /** Annule la dernière mutation. */
  undo() {
    if (!this._history.length) return false;
    this._historyFuture.push(this._snapshotBlocs());
    const prev = this._history.pop();
    this.S.blocs = prev.blocs;
    this.S.activeBlocIdx = prev.activeBlocIdx;
    this.S.shapePreset = prev.shapePreset;
    this._syncBatFromBlocs();
    this.render();
    return true;
  },

  /** Rejoue l'action annulée. */
  redo() {
    if (!this._historyFuture.length) return false;
    this._history.push(this._snapshotBlocs());
    const next = this._historyFuture.pop();
    this.S.blocs = next.blocs;
    this.S.activeBlocIdx = next.activeBlocIdx;
    this.S.shapePreset = next.shapePreset;
    this._syncBatFromBlocs();
    this.render();
    return true;
  },

  /** Persiste S.blocs[] dans la session (restauré au prochain chargement). */
  _persistBlocs() {
    const p7 = this._session?.phases?.[7]?.data;
    if (!p7) return;
    p7.pmc_blocs = (this.S.blocs ?? []).map(bl => ({
      id: bl.id,
      polygon: bl.polygon.map(p => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) })),
      theta: +(bl.theta ?? 0).toFixed(2),
      w: +(bl.w ?? 0).toFixed(2),
      l: +(bl.l ?? 0).toFixed(2),
      cx: +(bl.cx ?? 0).toFixed(2),
      cy: +(bl.cy ?? 0).toFixed(2),
      niveaux: bl.niveaux ?? 1,
      usage: bl.usage ?? 'logement',
      rdcUsage: bl.rdcUsage ?? null,
    }));
    p7.pmc_shapePreset = this.S.shapePreset ?? 'I';
  },

  setView(v) { this.S.view = v; this.render(); },

  // Re-applique la stratégie courante SAUF si l'utilisateur a édité manuellement.
  // Utilisé par les sliders, overrides PLU, cycleEdge et mitoyen pour ne pas
  // écraser une édition utilisateur ponctuelle. Reset explicite nécessaire.
  _reApplyIfClean(label) {
    if (this.S._manualEdit) {
      console.info(`[PMC] skip re-apply (${label}) — _manualEdit=true`);
      return false;
    }
    try { this._applyScenarioGeometry(this.curSc()); return true; }
    catch (e) { console.warn(`[PMC] scenario re-apply after ${label} failed:`, e.message); return false; }
  },

  setProg(key, val) {
    if (key === 'type') {
      this.S.prog.type = val;
      if (val === 'maison') this.S.prog.profMax = Math.min(this.S.prog.profMax, 12);
      this._initBatFromPIR();
      // Matérialiser la stratégie courante — évite que la bascule maison↔collectif
      // laisse un rect PIR trop étroit pour passer le clip batSafe.
      this._reApplyIfClean('setProg(type)');
    } else if (key === 'nvMax') {
      const capped = Math.min(val, this.nvMaxPLU());
      this.S.prog.nvMax = capped;
      // Clamp descendant uniquement sur les blocs qui dépassaient
      if (this.S.blocs?.length) {
        for (const bl of this.S.blocs) {
          if (bl.niveaux > capped) bl.niveaux = capped;
        }
      }
      this._reApplyIfClean('setProg(nvMax)');
    } else if (key === 'profMax') {
      this.S.prog.profMax = val;
      this._reApplyIfClean('setProg(profMax)');
    } else if (key === 'parkMode') {
      this.S.prog.parkMode = val;
      this._reApplyIfClean('setProg(parkMode)');
    } else if (key === 'maxUnits') {
      this.S.prog.maxUnits = Math.max(this.S.prog.minUnits ?? 1, val);
      this._reApplyIfClean('setProg(maxUnits)');
    } else if (key === 'minUnits') {
      const capped = Math.min(this.S.prog.maxUnits ?? val, Math.max(1, val));
      this.S.prog.minUnits = capped;
      // si min > max, pousser max (sync complète côté state)
      if (this.S.prog.maxUnits < capped) this.S.prog.maxUnits = capped;
      this._reApplyIfClean('setProg(minUnits)');
    } else if (key === 'emprCiblePct') {
      this.S.prog.emprCiblePct = Math.max(0, Math.min(100, val));
      this._reApplyIfClean('setProg(emprCiblePct)');
    }
    this.render();
  },

  setParkSide(side) { this.S.parkSide = side; this.render(); },

  /**
   * Applique un preset de forme (I/L/T/X/Y/Multi) centré sur le PIR.
   * Les blocs sont axis-aligned pour rester éditables simplement.
   * Chaque branche fait `bw × bl` avec chevauchement au centre.
   */
  setShape(shapeId) {
    if (!this._terrain?.plu?.constructible) return;
    this.pushHistory?.();
    const env = this.computeEnv();
    if (!env?.poly || env.poly.length < 3) return;
    const pir = poleOfInaccessibility(env.poly, 1.5);
    const cx = pir[0], cy = pir[1];
    const plu = this._terrain.plu;
    const rtaaW = plu.rtaaZone === 1 ? 10 : 12;
    const profMax = this.S.prog.profMax ?? 15;

    // Dimensions d'une branche : épaisseur ~ RTAA/2, longueur ~ profMax/2
    const bw = Math.min(rtaaW, env.w * 0.45);
    const bl = Math.min(profMax, env.h * 0.45);
    const th = Math.min(bw, 8); // épaisseur de branche
    const lg = Math.max(bl, 10); // longueur de branche

    const rectPoly = (x, y, w, h) => [
      { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
    ];

    let blocs = [];
    switch (shapeId) {
      case 'I':
        blocs = [{ polygon: rectPoly(cx - bw / 2, cy - bl / 2, bw, bl), theta: 0, w: bw, l: bl, cx, cy, id: 'bl0' }];
        break;
      case 'L':
        // branche verticale + branche horizontale se rejoignant coin bas-gauche
        blocs = [
          { polygon: rectPoly(cx - lg / 2, cy - lg / 2, th, lg), theta: 0, w: th, l: lg, cx: cx - lg / 2 + th / 2, cy, id: 'bl0' },
          { polygon: rectPoly(cx - lg / 2, cy + lg / 2 - th, lg, th), theta: 0, w: lg, l: th, cx, cy: cy + lg / 2 - th / 2, id: 'bl1' },
        ];
        break;
      case 'T':
        // barre horizontale en haut + branche verticale descendante
        blocs = [
          { polygon: rectPoly(cx - lg / 2, cy - lg / 2, lg, th), theta: 0, w: lg, l: th, cx, cy: cy - lg / 2 + th / 2, id: 'bl0' },
          { polygon: rectPoly(cx - th / 2, cy - lg / 2 + th, th, lg - th), theta: 0, w: th, l: lg - th, cx, cy: cy + th / 2, id: 'bl1' },
        ];
        break;
      case 'X':
        // croix : une barre horizontale + une verticale centrées
        blocs = [
          { polygon: rectPoly(cx - lg / 2, cy - th / 2, lg, th), theta: 0, w: lg, l: th, cx, cy, id: 'bl0' },
          { polygon: rectPoly(cx - th / 2, cy - lg / 2, th, lg), theta: 0, w: th, l: lg, cx, cy, id: 'bl1' },
        ];
        break;
      case 'Y':
        // 3 branches à 120° autour du centre (polygones rotés)
        {
          const rot = (pts, ang) => pts.map(p => ({
            x: cx + (p.x - cx) * Math.cos(ang) - (p.y - cy) * Math.sin(ang),
            y: cy + (p.x - cx) * Math.sin(ang) + (p.y - cy) * Math.cos(ang),
          }));
          const branch = rectPoly(cx - th / 2, cy - lg / 2, th, lg);
          blocs = [0, 2 * Math.PI / 3, 4 * Math.PI / 3].map((a, i) => ({
            polygon: rot(branch, a), theta: a * 180 / Math.PI, w: th, l: lg,
            cx: cx + Math.cos(a - Math.PI / 2) * lg / 3,
            cy: cy + Math.sin(a - Math.PI / 2) * lg / 3,
            id: `bl${i}`, niveaux: Math.min(this.S.prog.nvMax, this.nvMaxPLU()), usage: this._defaultUsage(),
          }));
        }
        break;
      default:
        blocs = [];
    }

    if (!blocs.length) return;
    const defN = Math.min(this.S.prog.nvMax ?? 1, this.nvMaxPLU());
    const defU = this._defaultUsage();
    for (const bl of blocs) {
      if (bl.niveaux == null) bl.niveaux = defN;
      if (bl.usage == null) bl.usage = defU;
    }
    this.S.blocs = blocs;
    this.S.shapePreset = shapeId;
    this.S.activeBlocIdx = 0;
    this._syncBatFromBlocs();
    this._clampBat();
    this.render();
  },

  /** Usage par défaut dérivé du type de programme ('maison' → logement, etc.). */
  _defaultUsage() {
    const t = this.S.prog?.type;
    if (t === 'commerce') return 'commerce';
    if (t === 'bureau') return 'bureau';
    if (t === 'erp') return 'bureau';
    return 'logement';
  },

  /**
   * Identifie les indices des arêtes latérale-G, latérale-D et fond depuis la voie.
   * Convention : debout sur la voie, face à l'intérieur de la parcelle
   *   → G à gauche, D à droite, fond en face.
   * Retourne { voie, G, D, fond } (indices ou null).
   */
  _edgeRoles() {
    const t = this._terrain;
    if (!t?.poly?.length || !t.edgeTypes) return { voie: null, G: null, D: null, fond: null };
    const n = t.poly.length;
    const voieIdx = t.edgeTypes.indexOf('voie');
    if (voieIdx < 0) return { voie: null, G: null, D: null, fond: t.edgeTypes.indexOf('fond') };
    const [p1x, p1y] = t.poly[voieIdx];
    const [p2x, p2y] = t.poly[(voieIdx + 1) % n];
    const voieMid = { x: (p1x + p2x) / 2, y: (p1y + p2y) / 2 };
    const vx = p2x - p1x, vy = p2y - p1y;
    let G = null, D = null, fond = null;
    for (let i = 0; i < n; i++) {
      if (i === voieIdx) continue;
      const kind = t.edgeTypes[i];
      const [ax, ay] = t.poly[i], [bx, by] = t.poly[(i + 1) % n];
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      // projection (edge centroid - voieMid) sur direction voie
      const dot = (mx - voieMid.x) * vx + (my - voieMid.y) * vy;
      if (kind === 'fond') { fond = i; continue; }
      if (kind === 'lat') {
        if (dot < 0) { if (G == null) G = i; }
        else         { if (D == null) D = i; }
      }
    }
    return { voie: voieIdx, G, D, fond };
  },

  /** Etat actuel d'une arête par rôle : 'mitoyen' | 'recul' | null. */
  edgeStateByRole(role) {
    const roles = this._edgeRoles();
    const i = roles[role];
    if (i == null) return null;
    return this.S.mitoyen[i] ? 'mitoyen' : 'recul';
  },

  /**
   * Bascule l'état mitoyen pour un rôle donné ('G' | 'D' | 'fond').
   * Appel N°1 : recul → mitoyen (0m)
   * Appel N°2 : mitoyen → recul (annule)
   */
  toggleMitoyen(role) {
    const roles = this._edgeRoles();
    const i = roles[role];
    if (i == null) return false;
    // Force l'arête à son type canonique (lat ou fond) pour que la mitoyenneté soit cohérente
    if (role === 'fond') this.S.edgeTypes[i] = 'fond';
    else this.S.edgeTypes[i] = 'lat';
    this.S.mitoyen[i] = !this.S.mitoyen[i];
    this._reApplyIfClean('toggleMitoyen');
    this.render();
    this._persistEdges?.();
    return this.S.mitoyen[i];
  },

  /**
   * Applique la même valeur de niveaux à tous les blocs (sync slider global → tous).
   * Retourne le nombre de blocs modifiés.
   */
  syncAllBlocsNiveaux(nv) {
    const nvMax = this.nvMaxPLU();
    const v = Math.max(1, Math.min(+nv || 1, nvMax));
    let n = 0;
    for (const bl of this.S.blocs ?? []) {
      if (bl.niveaux !== v) { bl.niveaux = v; n++; }
    }
    if (n > 0) this.render();
    return n;
  },

  /** Applique le même usage à tous les blocs (sync rapide). */
  syncAllBlocsUsage(usage) {
    if (!HEIGHT_BY_USAGE[usage]) return 0;
    let n = 0;
    for (const bl of this.S.blocs ?? []) {
      if (bl.usage !== usage) { bl.usage = usage; n++; }
    }
    if (n > 0) this.render();
    return n;
  },

  /**
   * Met à jour une propriété d'un bloc (niveaux, usage, etc.) et re-render.
   * Retourne le bloc modifié ou null.
   */
  setBlocProperty(idx, key, value) {
    const bl = this.S.blocs?.[idx];
    if (!bl) return null;
    this.pushHistory?.();
    if (key === 'niveaux') {
      const nvMax = this.nvMaxPLU();
      bl.niveaux = Math.max(1, Math.min(+value, nvMax));
    } else if (key === 'usage') {
      if (HEIGHT_BY_USAGE[value]) bl.usage = value;
    } else if (key === 'rdcUsage') {
      if (value === '' || value === null) bl.rdcUsage = null;
      else if (HEIGHT_BY_USAGE[value]) bl.rdcUsage = value;
    } else {
      bl[key] = value;
    }
    this.render();
    return bl;
  },

  /**
   * Hauteur totale d'un bloc (m). Si rdcUsage est défini, le RdC prend la
   * hauteur de cet usage et les niveaux supérieurs celle de bloc.usage.
   */
  _blocHeight(bl) {
    const n = bl?.niveaux ?? 1;
    const hUp = HEIGHT_BY_USAGE[bl?.usage] ?? H_NIV;
    const rdcU = bl?.rdcUsage;
    if (rdcU && rdcU !== bl.usage && n >= 1) {
      const hRdc = HEIGHT_BY_USAGE[rdcU] ?? H_NIV;
      return hRdc + (n - 1) * hUp;
    }
    return n * hUp;
  },

  /**
   * SDP nette estimée d'un bloc (m²), prenant en compte le RdC d'usage différent.
   */
  _blocSDP(bl) {
    const poly = bl?.polygon;
    if (!poly || poly.length < 3) return 0;
    const area = polyArea(poly.map(p => [p.x ?? p[0], p.y ?? p[1]]));
    const n = bl?.niveaux ?? 1;
    const effUp = EFF_BY_USAGE[bl.usage] ?? 0.80;
    const rdcU = bl?.rdcUsage;
    if (rdcU && rdcU !== bl.usage && n >= 1) {
      const effRdc = EFF_BY_USAGE[rdcU] ?? 0.80;
      return area * effRdc + area * (n - 1) * effUp;
    }
    return area * n * effUp;
  },

  /** Repasse en mode mono-bloc : un seul rect polygone centré PIR. */
  clearBlocs() {
    this.S.blocs = [];
    this.S.shapePreset = 'I';
    this._initBatFromPIR();  // re-crée S.blocs[0] unifié
    this.render();
  },

  /**
   * Ajoute un nouveau bloc rect à côté du bloc actif (offset de 2m en X).
   * Renvoie l'index du nouveau bloc.
   */
  addBloc(opts = {}) {
    const env = this.computeEnv();
    if (!env?.poly?.length) return -1;
    this.pushHistory?.();
    const src = this.S.blocs?.[this.S.activeBlocIdx ?? 0];
    const pir = poleOfInaccessibility(env.poly, 1.5);
    const cx = (src?.cx ?? pir[0]) + (opts.offsetX ?? 3);
    const cy = (src?.cy ?? pir[1]);
    const w = src?.w ?? 8;
    const l = src?.l ?? 10;
    const theta = src?.theta ?? 0;
    const poly = FH.rectCentered(cx, cy, w, l, theta).map(p => ({
      x: this._snap(p.x), y: this._snap(p.y),
    }));
    const bloc = {
      id: `bl${Date.now().toString(36)}`,
      polygon: poly, theta, w, l, cx, cy,
      niveaux: src?.niveaux ?? Math.min(this.S.prog.nvMax ?? 1, this.nvMaxPLU()),
      usage: src?.usage ?? this._defaultUsage(),
      rdcUsage: src?.rdcUsage ?? null,
    };
    this.S.blocs = [...(this.S.blocs ?? []), bloc];
    this.S.activeBlocIdx = this.S.blocs.length - 1;
    this.S.shapePreset = 'multi';
    this.render();
    return this.S.activeBlocIdx;
  },

  /** Duplique le bloc actif avec un offset de 3m. */
  duplicateBloc(idx = null) {
    const i = idx ?? this.S.activeBlocIdx ?? 0;
    const src = this.S.blocs?.[i];
    if (!src) return -1;
    return this.addBloc({ offsetX: 3 });
  },

  /** Supprime un bloc (laisse au moins 1 bloc). Renvoie true si supprimé. */
  deleteBloc(idx = null) {
    const i = idx ?? this.S.activeBlocIdx ?? 0;
    if (!this.S.blocs?.length || this.S.blocs.length <= 1) return false;
    this.pushHistory?.();
    this.S.blocs.splice(i, 1);
    if (this.S.activeBlocIdx >= this.S.blocs.length) this.S.activeBlocIdx = this.S.blocs.length - 1;
    if (this.S.blocs.length === 1) this.S.shapePreset = 'I';
    this.render();
    return true;
  },

  /**
   * Snapshot de l'état du bloc actif avant drag.
   * Retourne { poly0, bbox0, center0 } :
   *   - poly0 : copie profonde du polygone (null si mode legacy mono-bat sans S.blocs)
   *   - bbox0 : {x, y, w, l} bounding-box au moment du click (référence pour resize)
   *   - center0 : centroïde bbox
   */
  _snapshotActiveBloc() {
    const idx = this.S.activeBlocIdx ?? 0;
    const bl = this.S.blocs?.[idx];
    if (!bl?.polygon?.length) {
      return {
        poly0: null,
        bbox0: { ...this.S.bat },
        center0: {
          x: this.S.bat.x + this.S.bat.w / 2,
          y: this.S.bat.y + this.S.bat.l / 2,
        },
        theta0: 0, w0: this.S.bat.w, l0: this.S.bat.l,
      };
    }
    const poly0 = bl.polygon.map(p => ({ x: p.x, y: p.y }));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of poly0) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    // OBB dérivée depuis le polygone (dimensions et centre réels dans le repère theta)
    const obb = this._blocOBB(bl);
    return {
      poly0,
      bbox0: { x: minX, y: minY, w: maxX - minX, l: maxY - minY },
      center0: { x: obb.cx, y: obb.cy },
      theta0: obb.theta,
      w0: obb.w, l0: obb.l,
    };
  },

  /**
   * Rotation du bloc actif : angle basé sur la souris (wx, wy) relatif au
   * centre du bloc. Utilise le poly0 snapshot et center0 stockés au pointerdown.
   */
  _rotateActiveBloc(wx, wy, shiftSnap = false) {
    const idx = this.S.activeBlocIdx ?? 0;
    const bl = this.S.blocs?.[idx];
    const snap = this._drag;
    if (!bl || !snap?.poly0 || !snap.center0) return;
    const c = snap.center0;
    // Angle initial (souris au pointerdown → centre) vs angle courant
    const a0 = Math.atan2(snap.ww0[1] - c.y, snap.ww0[0] - c.x);
    const a1 = Math.atan2(wy - c.y, wx - c.x);
    let da = a1 - a0;
    // Shift enfoncée → snap à 15° sur theta absolue (theta0 + da)
    if (shiftSnap) {
      const step = 15 * Math.PI / 180;
      const thetaAbs = (snap.theta0 || 0) * Math.PI / 180 + da;
      const snapped = Math.round(thetaAbs / step) * step;
      da = snapped - (snap.theta0 || 0) * Math.PI / 180;
    }
    const cos = Math.cos(da), sin = Math.sin(da);
    // Rotation appliquée AU POLYGONE ORIGINAL (poly0), pas au polygone courant
    // → évite l'accumulation d'erreurs et les rotations "chaotiques"
    const newPoly = snap.poly0.map(p => {
      const dx = p.x - c.x, dy = p.y - c.y;
      return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
    });
    // Clamp env : on bloque la rotation si elle ferait sortir un sommet
    // ALORS QUE poly0 était entièrement à l'intérieur. Si poly0 sortait déjà
    // (cas blocs issus de stratégies clippées), on tolère pour ne pas freezer.
    const env = this.computeEnv();
    if (env?.poly?.length >= 3) {
      const poly0AllIn = snap.poly0.every(p => ptInPoly(p.x, p.y, env.poly));
      const newOut = newPoly.some(p => !ptInPoly(p.x, p.y, env.poly));
      if (poly0AllIn && newOut) return;
    }
    bl.polygon = newPoly;
    // Theta absolue depuis le snapshot : theta_snap + da (en degrés)
    bl.theta = (snap.theta0 || 0) + da * 180 / Math.PI;
  },

  /** Translate le bloc actif de (dx, dy) (m) depuis son polygone snapshot. */
  _translateActiveBloc(dx, dy) {
    const idx = this.S.activeBlocIdx ?? 0;
    const bl = this.S.blocs?.[idx];
    if (!bl || !this._drag?.poly0) return;
    let sdx = this._snap(dx), sdy = this._snap(dy);
    // Clamp dans l'enveloppe constructible : on réduit la translation
    // si elle ferait sortir n'importe quel sommet du polygone hors env.
    const env = this.computeEnv();
    if (env?.poly?.length >= 3) {
      const clamped = this._clampTranslationToPoly(this._drag.poly0, sdx, sdy, env.poly);
      sdx = clamped.dx; sdy = clamped.dy;
    }
    bl.polygon = this._drag.poly0.map(p => ({ x: p.x + sdx, y: p.y + sdy }));
    if (bl.cx != null) bl.cx = this._drag.center0.x + sdx;
    if (bl.cy != null) bl.cy = this._drag.center0.y + sdy;
  },

  /**
   * Réduit (dx, dy) pour que tous les sommets de poly0 translatés restent dans containerPoly.
   * Stratégie : projection axis-aligned — on borne dx sur [minDx, maxDx] tel que
   * la bbox translatée reste dans la bbox de container, puis on affine sommet-par-sommet
   * avec une bissection ; si un sommet reste out, on clip à 0 sur cet axe.
   */
  _clampTranslationToPoly(poly0, dx, dy, containerPoly) {
    // 1) bbox-based quick clamp
    const cbb = polyAABB(containerPoly);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of poly0) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    const maxDxPos = cbb.x1 - maxX, maxDxNeg = cbb.x - minX;
    const maxDyPos = cbb.y1 - maxY, maxDyNeg = cbb.y - minY;
    if (dx > maxDxPos) dx = maxDxPos;
    if (dx < maxDxNeg) dx = maxDxNeg;
    if (dy > maxDyPos) dy = maxDyPos;
    if (dy < maxDyNeg) dy = maxDyNeg;

    // 2) Polygone réel : bissection sur le facteur si un sommet sort encore
    const allIn = (fx, fy) => poly0.every(p => ptInPoly(p.x + fx, p.y + fy, containerPoly));
    if (allIn(dx, dy)) return { dx, dy };
    let lo = 0, hi = 1;
    for (let k = 0; k < 16; k++) {
      const mid = (lo + hi) / 2;
      if (allIn(dx * mid, dy * mid)) lo = mid; else hi = mid;
    }
    return { dx: dx * lo, dy: dy * lo };
  },

  /**
   * Redimensionne le bloc actif en déplaçant la poignée hh (sw/s/se/w/e/nw/n/ne).
   * Scale non-uniforme autour du point opposé (coin/côté).
   * Préserve la rotation : on scale les points en espace monde, mais ça marche
   * pour des polygones arbitraires (rotation implicite dans les sommets).
   */
  /**
   * Resize du bloc actif : on REGÉNÈRE un rectangle propre via FH.rectCentered
   * à partir de (cx, cy, l, w, theta) mis à jour selon la poignée tirée.
   *
   * Pourquoi régénérer plutôt que scaler les sommets ?
   *   - Les polygones issus de 'zone'/'zoneHull'/'trapezoid' ne sont PAS des rect
   *     (4+ sommets non rectangulaires). Un scale sommet-par-sommet déforme
   *     dangereusement (diagonales incohérentes, angles brisés).
   *   - Les polygones 'oblique'/'isohypses' peuvent être clippés par env
   *     (pentagon/hexagon) → idem.
   *   - Le resize d'un bloc "se comprend" toujours comme « nouvelle largeur /
   *     longueur au bon angle » → un rect propre est prévisible.
   *
   * Compromis assumé : un bloc issu d'une stratégie non-rect perd sa forme
   * exacte au premier resize (reconverti en rect orienté). L'utilisateur
   * peut toujours recliquer la stratégie pour la reconstruire.
   */
  _resizeActiveBloc(hh, dw, dh) {
    const idx = this.S.activeBlocIdx ?? 0;
    const bl = this.S.blocs?.[idx];
    const snap = this._drag;
    if (!bl || !snap?.poly0) return;

    const { w0, l0, center0 } = snap;
    const theta = snap.theta0 || 0;
    if (!(w0 > 0) || !(l0 > 0)) return;

    const th = theta * Math.PI / 180;
    const cos = Math.cos(th), sin = Math.sin(th);

    // Mapping poignée → (sL, sW) : 'e/w' scalent L (axe X local), 'n/s' scalent W
    const HMAP = { sw: [-1,-1], s: [0,-1], se: [1,-1], w: [-1,0], e: [1,0], nw: [-1,1], n: [0,1], ne: [1,1] };
    const [sL, sW] = HMAP[hh] ?? [0, 0];

    // Delta souris monde → local
    const du =  dw * cos + dh * sin;
    const dv = -dw * sin + dh * cos;

    let nl = sL !== 0 ? (l0 + sL * du) : l0;
    let nw = sW !== 0 ? (w0 + sW * dv) : w0;
    if (nl < MIN_L) nl = MIN_L;
    if (nw < MIN_W) nw = MIN_W;

    // Nouveau centre : translaté vers le côté tiré, coin opposé fixe
    //   shift en local = (sL * (nl - l0) / 2, sW * (nw - w0) / 2)
    const shiftL = sL * (nl - l0) / 2;
    const shiftW = sW * (nw - w0) / 2;
    const ncx = center0.x + shiftL * cos - shiftW * sin;
    const ncy = center0.y + shiftL * sin + shiftW * cos;

    // Régénère un rectangle propre (rectCentered renvoie 4 sommets {x,y})
    const buildRect = (cxn, cyn, L, W) => FH.rectCentered(cxn, cyn, W, L, theta).map(p => ({
      x: this._snap(p.x), y: this._snap(p.y),
    }));

    const newPoly = buildRect(ncx, ncy, nl, nw);

    // Clamp env : même logique que rotation — on bloque le resize seulement
    // si poly0 était valide ET newPoly sort. Préserve le drag des blocs
    // initialement hors env (issus de stratégies clippées).
    const env = this.computeEnv();
    if (env?.poly?.length >= 3) {
      const poly0AllIn = snap.poly0.every(p => ptInPoly(p.x, p.y, env.poly));
      const newOut = newPoly.some(p => !ptInPoly(p.x, p.y, env.poly));
      if (poly0AllIn && newOut) return;
    }
    bl.polygon = newPoly;
    bl.cx = ncx; bl.cy = ncy; bl.l = nl; bl.w = nw; bl.theta = theta;
  },

  setScenario(scId) {
    this.pushHistory?.();
    this._scId = scId;
    const sc = this.curSc();
    if (!sc) return;
    this.S.prog.nvMax = Math.min(sc.nv, this.nvMaxPLU());
    // Changement explicite de stratégie → clear dirty, géométrie fraîche
    this.S._manualEdit = false;
    this._applyScenarioGeometry(sc);
    this.render();
  },

  /**
   * Reset : efface le flag manual-edit et ré-applique la stratégie courante.
   * Utilisé par le bouton UI "Reset" pour retrouver la géométrie auto après édition.
   */
  resetToStrategy() {
    this.pushHistory?.();
    this.S._manualEdit = false;
    try { this._applyScenarioGeometry(this.curSc()); }
    catch (e) { console.warn('[PMC] resetToStrategy failed:', e.message); }
    this.render();
  },

  /**
   * Applique la géométrie de la stratégie au bâtiment courant.
   * Peuple S.blocs[] avec les polygones réels issus de AutoPlanStrategies
   * (rotés pour oblique/isohypses, en L pour lshape, multi-blocs pour multi, etc.).
   * S.bat reste synchronisé sur la bbox union (compat legacy pour drag/metrics).
   */
  _applyScenarioGeometry(sc) {
    if (!this._terrain?.plu?.constructible) return;
    const env = this.computeEnv();
    if (!env?.poly || env.poly.length < 3) return;
    const plu = this._terrain.plu;
    const rtaaW = plu.rtaaZone === 1 ? 10 : 12;
    const profMax = this.S.prog.profMax ?? 15;
    const fac = sc.emprFac ?? 1;

    // Mode densité max (A1 emprFac=1.0, stratégie rect) : lève le cap rtaaW
    // mais target dans le repère OBB de l'enveloppe (pas AABB) pour que le rect
    // orienté par la stratégie tienne EXACTEMENT dans env, sans déborder sur
    // les reculs après clipping.
    // ── Cible CES uniforme sur toutes les stratégies (v4h pattern) ───
    // Ciblage par surface : cibleM2 = parcelArea × emprMax% × emprCible% × emprFac
    //   - emprCiblePct (slider user, 0-100) : override global du % CES
    //   - sc.emprFac (0.55-1.00) : cap présélectionné par stratégie
    //   - emprMax PLU : plafond réglementaire absolu
    // Puis dimensionne w/l dans le repère OBB de l'enveloppe pour respecter
    // l'orientation de la parcelle, en appliquant les caps RTAA (largeur
    // ventilation) sur les strategies mono-bloc uniquement.
    const parcelArea = this._terrain.area ?? 0;
    const cesMaxM2   = parcelArea * ((plu.emprMax ?? 60) / 100);
    const vegMin     = parcelArea * ((plu.permMin ?? 25) / 100);
    const isANC      = (this._session?.terrain?.assainissement === 'ANC');
    const ancArea    = isANC ? 40 : 0;
    const parkExt    = this.S.prog.parkMode === 'ext' ? Math.min(50, parcelArea * 0.05) : 0;
    const empriseDispo = Math.max(20, Math.min(cesMaxM2, parcelArea - vegMin - ancArea - parkExt));
    const emprCibleFrac = Math.max(0, Math.min(1, (this.S.prog.emprCiblePct ?? 100) / 100));
    let cibleM2 = Math.max(MIN_W * MIN_L, empriseDispo * emprCibleFrac * fac);

    // ── Contraintes lgts min/max : clamp cibleM2 sur la plage de logements ──
    // lgts = cibleFootprint × nvEff × eff / SP_MOY (≈57 m²/logement pondéré).
    // Applicable uniquement aux types collectif/bureau/erp où le slider est visible.
    const typeIsUnits = ['collectif', 'bureau', 'erp'].includes(this.S.prog.type);
    if (typeIsUnits) {
      const nvEff = Math.min(this.S.prog.nvMax ?? sc.nv, this.nvMaxPLU());
      const lgtsPerM2 = (nvEff * (sc.eff ?? 0.8)) / SP_MOY;
      const minU = Math.max(1, this.S.prog.minUnits ?? 1);
      const maxU = Math.max(minU, this.S.prog.maxUnits ?? 40);
      const cibleMin = minU / lgtsPerM2;
      const cibleMax = maxU / lgtsPerM2;
      if (cibleM2 < cibleMin) cibleM2 = Math.min(empriseDispo, cibleMin);
      if (cibleM2 > cibleMax) cibleM2 = cibleMax;
      this.S._lgtsRange = { min: minU, max: maxU, per: lgtsPerM2, cibleMin, cibleMax };
    } else {
      this.S._lgtsRange = null;
    }

    const envXY = env.poly.map(p => FH.toXY(p));
    const envOBB = FH.obb(envXY);
    const envArea = polyArea(env.poly);
    const fillRatio = Math.min(1, cibleM2 / Math.max(envArea, 1));
    const linearScale = Math.sqrt(fillRatio);

    // Escalade densité MAX : si mono-bloc capé par RTAA/profMax ne peut pas
    // atteindre cibleM2, bascule sur multiRect pour saturer vers l'emprMax PLU.
    // Critère : cibleM2 > 115% du cap mono-bloc ET parcelle assez longue
    // pour ≥2 blocs alignés (profMax + gap interBat minimum).
    const monoBloc = ['rect', 'oblique', 'isohypses'].includes(sc.strategy);
    const monoCapM2 = Math.min(rtaaW, envOBB.w * 0.95) * Math.min(profMax, envOBB.l * 0.95);
    const gapInter = Math.max(plu.interBatMin || 4, sc.nv * H_NIV / 2);
    const canMultiFit = envOBB.l >= (Math.min(profMax, envOBB.l * 0.45) * 2 + gapInter);
    const escaladeMulti = monoBloc && cibleM2 > monoCapM2 * 1.15 && canMultiFit;
    const effStrategy = escaladeMulti ? 'multi' : sc.strategy;
    const effMono = ['rect', 'oblique', 'isohypses'].includes(effStrategy);

    // Dimensions cibles dans le repère OBB (respecte la rotation parcelle)
    let wTarget, lTarget;
    if (escaladeMulti) {
      // Multi escaladé : bloc = cap RTAA × cap profMax, multiRect tuile obb.l
      wTarget = Math.min(rtaaW, envOBB.w * 0.95);
      lTarget = Math.min(profMax, (envOBB.l - gapInter) / 2);
    } else {
      wTarget = envOBB.w * linearScale;
      lTarget = envOBB.l * linearScale;
      // Caps RTAA DOM (largeur ventilation) : uniquement mono-bloc.
      // Multi-blocs / zone distribuent la surface : chaque bloc reste dans RTAA.
      if (effMono) {
        const wCap = Math.min(rtaaW, envOBB.w * 0.95);
        const lCap = Math.min(profMax, envOBB.l * 0.95);
        if (wTarget > wCap) { lTarget *= (wCap / wTarget); wTarget = wCap; }
        if (lTarget > lCap) { wTarget *= (lCap / lTarget); lTarget = lCap; }
      }
    }

    // Réorienter si l'enveloppe est plus étroite côté l que w
    if (envOBB.l < lTarget * 0.7 && envOBB.w > wTarget) [wTarget, lTarget] = [lTarget, wTarget];

    // Filet final : le rect d'UN bloc ne doit pas dépasser cibleM2.
    // Exception : multi escaladé → cibleM2 se répartit sur N blocs,
    // le cap par bloc n'a pas de sens.
    if (!escaladeMulti) {
      const cur = wTarget * lTarget;
      if (cur > cibleM2) {
        const k = Math.sqrt(cibleM2 / cur);
        wTarget *= k; lTarget *= k;
      }
    }
    wTarget = Math.max(MIN_W, wTarget);
    lTarget = Math.max(MIN_L, lTarget);

    // Exposer pour hints UI
    this.S._empriseDispo = empriseDispo;
    this.S._cibleM2 = cibleM2;
    this.S._deductions = { vegMin, ancArea, parkExt, isANC };
    this.S._escaladeMulti = escaladeMulti;

    const AS = window.AutoPlanStrategies;
    let rawBlocs = [];
    if (AS && typeof AS[effStrategy] === 'function') {
      try {
        const pir = poleOfInaccessibility(env.poly, 1.5);
        const pirXY = { x: pir[0], y: pir[1] };
        const gapMin = Math.max(plu.interBatMin || 4, sc.nv * H_NIV / 2);
        const azimut = this.S.prog?._topoConstraints?.azimut_deg;
        switch (effStrategy) {
          case 'rect':       rawBlocs = AS.rect(env.poly, wTarget, lTarget, pirXY); break;
          case 'oblique':    rawBlocs = AS.oblique(env.poly, this._terrain.poly, this._terrain.edgeTypes, wTarget, lTarget); break;
          case 'zone':       rawBlocs = AS.zone(env.poly, 0.5, wTarget * lTarget); break;
          case 'zoneHull':   rawBlocs = AS.zoneHull(env.poly, wTarget * lTarget); break;
          case 'multi':      rawBlocs = AS.multiRect(env.poly, wTarget, lTarget, gapMin, 4); break;
          case 'lshape':     rawBlocs = AS.lShape(env.poly, wTarget, lTarget, pirXY); break;
          case 'trapezoid':  rawBlocs = AS.trapezoid(env.poly, this._terrain.poly, this._terrain.edgeTypes, wTarget, lTarget); break;
          case 'tShape':     rawBlocs = AS.tShape(env.poly); break;
          case 'cross':      rawBlocs = AS.cross(env.poly); break;
          case 'biBarre':    rawBlocs = AS.biBarre(env.poly, null, Math.max(3, gapMin)); break;
          case 'deuxLames':  rawBlocs = AS.deuxLames(env.poly, gapMin); break;
          case 'troisLames': rawBlocs = AS.troisLames(env.poly, gapMin); break;
          case 'isohypses':
            if (Number.isFinite(azimut)) {
              rawBlocs = AS.isohypses(env.poly, wTarget, lTarget, pirXY, azimut, profMax);
              // v4h : clampProf applique la contrainte profondeur relative à la pente
              rawBlocs = (rawBlocs || []).map(bl => bl?.polygon
                ? { ...bl, polygon: FH.clampProf(bl.polygon, azimut, profMax) }
                : bl);
            }
            break;
        }
        // Si escalade multi échoue (fallback requis) : retomber sur mono-rect capé
        if (escaladeMulti && !rawBlocs.length) {
          const wCap = Math.min(rtaaW, envOBB.w * 0.95);
          const lCap = Math.min(profMax, envOBB.l * 0.95);
          rawBlocs = AS.rect(env.poly, wCap, lCap, pirXY);
        }
      } catch (e) {
        console.warn('[PMC] scenario geometry failed', sc.id, e);
      }
    }

    // ── v4h expandToMit : pousser vers les arêtes mitoyennes recul=0 ──
    // Uniquement si au moins une arête latérale est marquée mitoyenne.
    const hasMitoyen = this._terrain.edgeTypes.some((t, i) =>
      t === 'lat' && (this.S.mitoyen?.[i] === true));
    if (hasMitoyen && rawBlocs.length) {
      try {
        const reculsArr = this.S.edgeTypes.map((_, i) => this.edgeRecul(i));
        const batPolys = rawBlocs.map(bl => bl.polygon).filter(p => p?.length >= 3);
        const expanded = FH.expandToMit(batPolys, this._terrain.poly, reculsArr, this._terrain.edgeTypes, env.poly);
        if (expanded?.length === rawBlocs.length) {
          // Remplace polygones en conservant theta/w/l/metadata
          rawBlocs = rawBlocs.map((bl, i) => expanded[i]?.length >= 3
            ? { ...bl, polygon: expanded[i] }
            : bl);
        }
        // Mesure de contact mitoyenneté (métrique exposée pour validation PLU)
        this.S._lMitFacade = FH.lMitFacade(
          rawBlocs.map(bl => bl.polygon).filter(p => p?.length >= 3),
          this._terrain.poly, reculsArr, this._terrain.edgeTypes);
      } catch (e) {
        console.warn('[PMC] expandToMit failed:', e.message);
      }
    } else {
      this.S._lMitFacade = 0;
    }

    // Usage par défaut selon le type programme
    const defaultUsage = this._defaultUsage();
    const defaultNiveaux = Math.min(sc.nv, this.nvMaxPLU());

    // Normalise en S.blocs[{polygon:[{x,y}],theta,w,l,cx,cy,niveaux,usage}]
    const blocs = (rawBlocs || []).filter(bl => bl?.polygon?.length >= 3).map((bl, i) => {
      const poly = bl.polygon.map(p => ({ x: p.x ?? p[0], y: p.y ?? p[1] }));
      let cx = 0, cy = 0;
      for (const p of poly) { cx += p.x; cy += p.y; }
      cx /= poly.length; cy /= poly.length;
      return {
        id: `bl${i}`, polygon: poly, theta: bl.theta ?? 0,
        w: bl.w ?? 0, l: bl.l ?? 0, cx, cy,
        niveaux: defaultNiveaux, usage: defaultUsage,
      };
    });

    if (blocs.length) {
      this.S.blocs = blocs;
      this.S.shapePreset = effStrategy === 'lshape' ? 'L' :
                           effStrategy === 'multi' ? 'multi' : 'I';
      this.S.activeBlocIdx = 0;
      this._syncBatFromBlocs();
      this._clampBat();
      return;
    }

    // Fallback : rectangle centré PIR aux dimensions cibles (S.blocs[0] unifié)
    this.S.shapePreset = 'I';
    const pir = poleOfInaccessibility(env.poly, 1.5);
    const wf = Math.max(MIN_W, wTarget);
    const lf = Math.max(MIN_L, lTarget);
    const poly = FH.rectCentered(pir[0], pir[1], wf, lf, 0).map(p => ({
      x: this._snap(p.x), y: this._snap(p.y),
    }));
    this.S.blocs = [{
      id: 'bl0', polygon: poly, theta: 0, w: wf, l: lf,
      cx: pir[0], cy: pir[1],
      niveaux: Math.min(sc.nv, this.nvMaxPLU()), usage: this._defaultUsage(), rdcUsage: null,
    }];
    this.S.activeBlocIdx = 0;
    this._syncBatFromBlocs();
    this._clampBat();
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
    if (this._terrain?.plu?.constructible) {
      try { this._applyScenarioGeometry(this.curSc()); }
      catch (e) { console.warn('[PMC] rebuild scenario failed:', e.message); }
    }
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
