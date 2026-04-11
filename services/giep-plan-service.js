// terlab/services/giep-plan-service.js · Plan GIEP EP SVG auto post-étude de capacité
// Génère le plan de gestion intégrée des eaux pluviales (GIEP) en SVG
// Placé automatiquement après calcul PlanMasseEngine + GIEPCalculator
// Inspiré : plan GIEP La Saline (MGA Architecture)
// ENSA La Réunion · MGA Architecture 2026

import SlopesService from './slopes-service.js';
import GIEPCalculator from './giep-calculator-service.js';
import FH from './footprint-helpers.js';

// ── CONSTANTES OUVRAGES GIEP ────────────────────────────────────────────────
const OUVRAGE_STYLES = {
  noue_infiltration:    { color: '#3B82F6', icon: '\u301C',     label: 'Noues paysagères',      shape: 'line' },
  jardin_pluie:         { color: '#22C55E', icon: '\u{1F33A}',  label: 'Jardins de pluie',       shape: 'circle' },
  fosse_infiltration:   { color: '#8B5CF6', icon: '\u25CB',     label: "Fosses d'infiltration",  shape: 'circle-sm' },
  revetement_drainant:  { color: '#F59E0B', icon: '\u25CF',     label: 'Stabilisé perméable',    shape: 'circle' },
  tranchee_drainante:   { color: '#0EA5E9', icon: '\u2500',     label: 'Tranchées drainantes',   shape: 'line' },
  structure_alveolaire: { color: '#EC4899', icon: '\u25CB',     label: 'Dalles alvéolées',       shape: 'circle' },
  bassin_retention:     { color: '#3B82F6', icon: '\u{1F4A7}',  label: 'Zone surverse point bas', shape: 'diamond' },
  toiture_vegetalisee:  { color: '#16A34A', icon: '\u{1F33F}',  label: 'Toiture végétalisée',    shape: 'rect-fill' },
};

const DESCENTE_COLOR = '#EF4444';
const JARDINS_PRIVES_COLOR = '#4ADE80';
const EV_CREUX_COLOR = '#166534';
const BORDURE_COLOR = '#D4A574';

const GIEPPlanService = {

  /**
   * Génère le plan GIEP SVG complet
   * @param {Object} session     — session TERLAB
   * @param {Object} proposal    — résultat étude de capacité (bat, metrics, etc.)
   * @param {Object} giepResult  — résultat GIEPCalculator.computeFromSession()
   * @returns {string} SVG string
   */
  generatePlan(session, proposal, giepResult) {
    if (!proposal || !giepResult) return '';
    // Lecture unifiée v2/legacy : on récupère l'AABB d'ensemble + les blocs réels
    const r = FH.readProposal(proposal);
    if (!r.blocs.length || !r.bat) return '';

    const terrain = session?.terrain ?? {};
    const bat = r.bat;        // AABB pour le placement des accessoires (axis-aligned)
    const blocsList = r.blocs; // polygones réels pour le tracé du bâtiment
    const ouvrages = giepResult.ouvrages ?? [];
    const pente_pct = parseFloat(terrain.pente_moy_pct ?? 0);
    const exposition = terrain.exposition ?? terrain.orientation ?? 'S';
    const cat = SlopesService.classify(pente_pct);

    // Polygone parcelle local
    const parcelLocal = session?._parcelLocal ?? [];
    const poly = parcelLocal.length >= 3
      ? parcelLocal.map(p => [p.x ?? p[0], p.y ?? p[1]])
      : [[0, 0], [30, 0], [30, 20], [0, 20]];

    const bb = this._aabb(poly);
    const parcelArea = this._area(poly);
    const maxDim = Math.max(bb.w, bb.h);
    const margin = maxDim * 0.3;

    // ViewBox — _aabb expose x0/y0 (pas x/y) ; le viewBox part du coin haut-gauche
    // décalé de margin, l'inversion Y se fait via py(y) = -y dans le tracé.
    const vbX = bb.x0 - margin;
    const vbY = -(bb.y1 + margin);
    const vbW = bb.w + margin * 2 + maxDim * 0.6; // extra pour légende + principes
    const vbH = bb.h + margin * 2;

    const px = x => x;
    const py = y => -(y);

    // ── SVG START ────────────────────────────────────────────────
    // ClipPath parcelle pour confiner courbes de niveau et flow lines
    const parcelPts = poly.map(([x, y]) => `${px(x)},${py(y)}`).join(' ');
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}"
      width="100%" style="background:#F7F4EE;font-family:'Inter',sans-serif;color:#18130a">
    <defs>
      <clipPath id="gp-parcel-clip"><polygon points="${parcelPts}"/></clipPath>
      <marker id="gp-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <polygon points="0 0,8 3,0 6" fill="${DESCENTE_COLOR}"/>
      </marker>
      <marker id="gp-flow" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto">
        <polygon points="0 0,6 2.5,0 5" fill="${cat.hex}" opacity="0.5"/>
      </marker>
    </defs>`;

    // 1. FOND — parcelle
    svg += `<polygon points="${parcelPts}" fill="#E8F5E9" fill-opacity="0.5" stroke="#18130a" stroke-width="0.3"/>`;

    // 2a. COURBES DE NIVEAU (depuis ContourCache si disponible) — sous tout le reste
    svg += this._renderContours(session, px, py, bb);

    // 2b. FLOW LINES (chemins d'eau, sens descendant)
    svg += this._renderFlowLines(poly, px, py, pente_pct, exposition);

    // 3. BÂTIMENT(S) — un polygone par bloc (multi-blocs supportés)
    blocsList.forEach((bloc, bi) => {
      const polyB = bloc.polygon ?? [];
      if (polyB.length < 3) return;
      const ptsStr = polyB.map(p => `${px(p.x)},${py(p.y)}`).join(' ');
      svg += `<polygon points="${ptsStr}" fill="#B0BEC5" fill-opacity="0.6" stroke="#455A64" stroke-width="0.25"/>`;
      const cw = FH.centroidWeighted(polyB);
      const blocArea = Math.round(bloc.areaM2 ?? FH.area(polyB));
      const blocLbl = blocsList.length > 1 ? `B${bi + 1} · ${blocArea} m²` : `${blocArea} m²`;
      svg += `<text x="${px(cw.x)}" y="${py(cw.y)}" text-anchor="middle"
        font-size="1.2" fill="#18130a" font-weight="bold">${blocLbl}</text>`;
      svg += `<text x="${px(cw.x)}" y="${py(cw.y) + 1.5}" text-anchor="middle"
        font-size="0.8" fill="#555">+0.30m/TN min</text>`;
    });

    // 4. DESCENTES DE TOITURE (flèches rouges sur chaque face du bâtiment)
    svg += this._renderDescentesToiture(blocsList, px, py);

    // 5. OUVRAGES EP — placement automatique
    svg += this._placeOuvrages(ouvrages, blocsList, bat, poly, bb, px, py, pente_pct, exposition);

    // 6. PENTE GÉNÉRALE (grande flèche + label)
    svg += this._renderPenteLabel(bb, poly, px, py, pente_pct, exposition, cat);

    // 7. BORDURES (tirets autour des bâtiments réels, pas du bbox)
    svg += this._renderBordures(blocsList, px, py);

    // 8. SURFACE PARCELLE
    const pcx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const pcy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    svg += `<text x="${px(bb.x0 + bb.w / 2)}" y="${py(bb.y1) - 1}" text-anchor="middle"
      font-size="1.1" fill="#18130a">Surf  ${Math.round(parcelArea)} m²</text>`;

    // Pré-calcul stockage
    const V_net = giepResult.infiltration?.V_net ?? 0;
    svg += `<text x="${px(bb.x0 + bb.w / 2)}" y="${py(bb.y1) - 2.5}" text-anchor="middle"
      font-size="0.9" fill="#555">Précalcul stockage global envisagé ${V_net.toFixed(0)} m³</text>`;

    // 9. NORD + ÉCHELLE
    svg += this._renderNorthArrow(bb, margin, px, py);
    svg += this._renderScaleBar(bb, margin, maxDim, vbX, vbY, vbH);

    // 10. LÉGENDE (en haut de la colonne droite)
    const legendInfo = this._renderLegend(ouvrages, bb, margin, py);
    svg += legendInfo.svg;

    // 11. PRINCIPES GIEP (sous la légende, jamais empilés dessus)
    svg += this._renderPrincipes(bb, margin, py, pente_pct, giepResult, terrain, legendInfo.bottomY + 2);

    svg += '</svg>';
    return svg;
  },

  // ── HELPERS GÉOMÉTRIE POLYGONE ────────────────────────────────────────────
  // Offset extérieur d'un polygone par bissectrice locale, en mètres.
  // Convention CW/CCW gérée via signedArea.
  _offsetPolyOutward(poly, d) {
    const n = poly.length;
    if (n < 3) return poly.slice();
    let sa = 0;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      sa += a.x * b.y - b.x * a.y;
    }
    const cw = sa > 0 ? 1 : -1;
    const out = [];
    for (let i = 0; i < n; i++) {
      const prev = poly[(i - 1 + n) % n], curr = poly[i], next = poly[(i + 1) % n];
      const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
      const len1 = Math.hypot(dx1, dy1);
      const dx2 = next.x - curr.x, dy2 = next.y - curr.y;
      const len2 = Math.hypot(dx2, dy2);
      if (len1 < 1e-6 || len2 < 1e-6) { out.push({ x: curr.x, y: curr.y }); continue; }
      // Normales sortantes (signe inversé par rapport à inset)
      const nx1 = cw * (dy1 / len1),  ny1 = cw * (-dx1 / len1);
      const nx2 = cw * (dy2 / len2),  ny2 = cw * (-dx2 / len2);
      let bx = nx1 + nx2, by = ny1 + ny2;
      const blen = Math.hypot(bx, by);
      if (blen < 1e-6) { out.push({ x: curr.x + nx1 * d, y: curr.y + ny1 * d }); continue; }
      bx /= blen; by /= blen;
      const cosHalf = bx * nx1 + by * ny1;
      const factor = cosHalf > 0.1 ? d / cosHalf : d;
      out.push({ x: curr.x + bx * factor, y: curr.y + by * factor });
    }
    return out;
  },

  // Renvoie pour chaque arête {midpoint, normale sortante unitaire, longueur}.
  _edgeMidsAndNormals(poly) {
    const n = poly.length;
    let sa = 0;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      sa += a.x * b.y - b.x * a.y;
    }
    const cw = sa > 0 ? 1 : -1;
    const res = [];
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      // Normale sortante = rotation -90° (cw=1) de la tangente
      const nx = cw * (dy / len), ny = cw * (-dx / len);
      res.push({ mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, nx, ny, len });
    }
    return res;
  },

  // ── DESCENTES DE TOITURE ──────────────────────────────────────────────────
  // Pour chaque bloc, place une descente sur chaque face longue (>2m) au milieu.
  _renderDescentesToiture(blocsList, px, py) {
    let s = '';
    for (const bloc of blocsList) {
      const polyB = bloc.polygon ?? [];
      if (polyB.length < 3) continue;
      const edges = this._edgeMidsAndNormals(polyB);
      if (!edges.length) continue;
      const maxLen = Math.max(...edges.map(e => e.len));
      const arrowLen = maxLen * 0.18;
      for (const e of edges) {
        if (e.len < 2) continue;
        const x1 = px(e.mx), y1 = py(e.my);
        const x2 = px(e.mx + e.nx * arrowLen);
        const y2 = py(e.my + e.ny * arrowLen);
        s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
          stroke="${DESCENTE_COLOR}" stroke-width="0.35" marker-end="url(#gp-arrow)"/>`;
      }
    }
    return s;
  },

  // ── PLACEMENT OUVRAGES ────────────────────────────────────────────────────
  _placeOuvrages(ouvrages, blocsList, bat, poly, bb, px, py, pente_pct, exposition) {
    let s = '';
    const angle = { N: 270, NE: 315, E: 0, SE: 45, S: 90, SO: 135, O: 180, NO: 225 }[exposition] ?? 90;
    const rad = (angle * Math.PI) / 180;
    const downX = Math.cos(rad), downY = Math.sin(rad);
    // Polygone parcelle au format {x,y} pour pointInPoly clamp
    const parcelXY = poly.map(p => ({ x: p[0], y: p[1] }));
    const inParcel = (x, y) => FH.pointInPoly(x, y, parcelXY);

    for (const o of ouvrages) {
      const style = OUVRAGE_STYLES[o.type];
      if (!style) continue;

      // Placement selon type
      if (o.type === 'noue_infiltration') {
        // Noues : côté aval du bâtiment, parallèle à la face basse
        const noueY = bat.y - 2; // 2m en dessous du bâtiment
        const noueX1 = bat.x - 1, noueX2 = bat.x + bat.w + 1;
        s += `<line x1="${px(noueX1)}" y1="${py(noueY)}" x2="${px(noueX2)}" y2="${py(noueY)}"
          stroke="${style.color}" stroke-width="0.5" stroke-dasharray="1,0.5"/>`;
        s += `<text x="${px((noueX1 + noueX2) / 2)}" y="${py(noueY) + 1.3}" text-anchor="middle"
          font-size="0.7" fill="${style.color}" font-style="italic">Noue paysagère avec redents −0.30m max</text>`;
        // Points bleus le long de la noue
        for (let t = 0; t <= 1; t += 0.25) {
          const nx = noueX1 + (noueX2 - noueX1) * t;
          s += `<circle cx="${px(nx)}" cy="${py(noueY)}" r="0.5" fill="${style.color}" opacity="0.6"/>`;
        }

      } else if (o.type === 'jardin_pluie') {
        // Jardins : distribués dans l'espace libre, clampés dans la parcelle réelle.
        const candidates = [
          [bat.x - 3, bat.y + bat.l * 0.3],
          [bat.x + bat.w + 3, bat.y + bat.l * 0.7],
          [bat.x + bat.w * 0.5, bat.y + bat.l + 3],
          [bat.x + bat.w * 0.5, bat.y - 3],
          [bat.x - 3, bat.y + bat.l + 2],
          [bat.x + bat.w + 3, bat.y - 2],
        ];
        for (const [jx, jy] of candidates) {
          if (!inParcel(jx, jy)) continue;
          // Skip si dans un bloc bâtiment
          let inBloc = false;
          for (const b of blocsList) {
            const polyB = (b.polygon ?? []).map(p => ({ x: p.x ?? p[0], y: p.y ?? p[1] }));
            if (polyB.length >= 3 && FH.pointInPoly(jx, jy, polyB)) { inBloc = true; break; }
          }
          if (inBloc) continue;
          s += `<circle cx="${px(jx)}" cy="${py(jy)}" r="1.2" fill="${EV_CREUX_COLOR}" opacity="0.4" stroke="${EV_CREUX_COLOR}" stroke-width="0.15"/>`;
        }

      } else if (o.type === 'fosse_infiltration') {
        // Fosses : au pied des descentes EP, sur les sommets réels de chaque bloc
        // (offset 0.8m vers l'extérieur le long de la bissectrice).
        for (const bloc of blocsList) {
          const polyB = (bloc.polygon ?? []).map(p => ({ x: p.x ?? p[0], y: p.y ?? p[1] }));
          if (polyB.length < 3) continue;
          const corners = this._offsetPolyOutward(polyB, 0.8);
          for (const c of corners) {
            if (!inParcel(c.x, c.y)) continue;
            s += `<circle cx="${px(c.x)}" cy="${py(c.y)}" r="0.6" fill="${style.color}" opacity="0.5" stroke="${style.color}" stroke-width="0.15"/>`;
          }
        }

      } else if (o.type === 'revetement_drainant') {
        // Stabilisé perméable : zone d'accès
        const accX = bat.x + bat.w * 0.3, accY = bb.y0 + 1;
        s += `<circle cx="${px(accX)}" cy="${py(accY)}" r="0.8" fill="${style.color}" opacity="0.5"/>`;
        s += `<circle cx="${px(accX + 3)}" cy="${py(accY)}" r="0.8" fill="${style.color}" opacity="0.5"/>`;

      } else if (o.type === 'tranchee_drainante') {
        // Tranchées : périphérie de la parcelle côté aval
        const ty = bb.y0 + 1;
        s += `<line x1="${px(bb.x0 + 2)}" y1="${py(ty)}" x2="${px(bb.x1 - 2)}" y2="${py(ty)}"
          stroke="${style.color}" stroke-width="0.4" stroke-dasharray="0.8,0.4"/>`;

      } else if (o.type === 'structure_alveolaire') {
        // Alvéolaire : sous parking
        const parkX = bat.x + bat.w + 2, parkY = bat.y + bat.l * 0.5;
        s += `<circle cx="${px(parkX)}" cy="${py(parkY)}" r="0.7" fill="${style.color}" opacity="0.4" stroke="${style.color}" stroke-width="0.15"/>`;

      } else if (o.type === 'bassin_retention') {
        // Bassin : point bas de la parcelle
        const basX = (bb.x0 + bb.x1) / 2 + downX * bb.w * 0.35;
        const basY = (bb.y0 + bb.y1) / 2 + downY * bb.h * 0.35;
        s += `<polygon points="${px(basX)},${py(basY) - 1.5} ${px(basX) + 1.2},${py(basY)} ${px(basX)},${py(basY) + 1.5} ${px(basX) - 1.2},${py(basY)}"
          fill="${style.color}" fill-opacity="0.3" stroke="${style.color}" stroke-width="0.2"/>`;
        s += `<text x="${px(basX)}" y="${py(basY) + 0.4}" text-anchor="middle" font-size="0.7" fill="${style.color}" font-weight="bold">\u{1F4A7}</text>`;

      } else if (o.type === 'toiture_vegetalisee') {
        // Overlay vert sur chaque bloc bâtiment (inset 0.5m pour les acrotères),
        // suit la géométrie réelle du polygone, jamais l'AABB englobant.
        for (const bloc of blocsList) {
          const polyB = (bloc.polygon ?? []).map(p => ({ x: p.x ?? p[0], y: p.y ?? p[1] }));
          if (polyB.length < 3) continue;
          const inner = this._offsetPolyOutward(polyB, -0.5);
          if (inner.length < 3) continue;
          const ptsStr = inner.map(p => `${px(p.x)},${py(p.y)}`).join(' ');
          s += `<polygon points="${ptsStr}" fill="${style.color}" fill-opacity="0.12"
            stroke="${style.color}" stroke-width="0.15" stroke-dasharray="0.5,0.3"/>`;
        }
      }
    }

    // Jardins privés (cercles verts pâles dans l'espace libre, clampés dans la parcelle réelle)
    const jardinsPositions = [
      [bb.x0 + bb.w * 0.15, bb.y0 + bb.h * 0.2],
      [bb.x0 + bb.w * 0.85, bb.y0 + bb.h * 0.8],
      [bb.x0 + bb.w * 0.15, bb.y0 + bb.h * 0.7],
      [bb.x0 + bb.w * 0.8, bb.y0 + bb.h * 0.25],
      [bb.x0 + bb.w * 0.5, bb.y0 + bb.h * 0.15],
      [bb.x0 + bb.w * 0.5, bb.y0 + bb.h * 0.85],
    ];
    for (const [jx, jy] of jardinsPositions) {
      if (!inParcel(jx, jy)) continue;
      // Vérifier pas dans un bloc bâtiment réel
      let inBloc = false;
      for (const b of blocsList) {
        const polyB = (b.polygon ?? []).map(p => ({ x: p.x ?? p[0], y: p.y ?? p[1] }));
        if (polyB.length >= 3 && FH.pointInPoly(jx, jy, polyB)) { inBloc = true; break; }
      }
      if (inBloc) continue;
      s += `<circle cx="${px(jx)}" cy="${py(jy)}" r="1" fill="${JARDINS_PRIVES_COLOR}" opacity="0.35" stroke="${JARDINS_PRIVES_COLOR}" stroke-width="0.1"/>`;
    }

    return s;
  },

  // ── PENTE GÉNÉRALE ────────────────────────────────────────────────────────
  _renderPenteLabel(bb, poly, px, py, pente_pct, exposition, cat) {
    if (pente_pct < 0.1) return '';

    const angle = { N: 270, NE: 315, E: 0, SE: 45, S: 90, SO: 135, O: 180, NO: 225 }[exposition] ?? 90;
    const rad = (angle * Math.PI) / 180;
    const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
    const arrowLen = Math.max(bb.w, bb.h) * 0.35;

    // Flèche décalée pour ne pas croiser le bâtiment
    const offX = -Math.sin(rad) * bb.w * 0.35;
    const offY = Math.cos(rad) * bb.h * 0.35;
    const x1 = cx + offX - Math.cos(rad) * arrowLen * 0.5;
    const y1 = cy + offY - Math.sin(rad) * arrowLen * 0.5;
    const x2 = x1 + Math.cos(rad) * arrowLen;
    const y2 = y1 + Math.sin(rad) * arrowLen;

    // Label rotatif
    const labelAngle = (angle * Math.PI / 180);
    const lx = (x1 + x2) / 2, ly = (y1 + y2) / 2;
    const rotDeg = angle > 90 && angle < 270 ? angle + 180 : angle;

    return `
      <line x1="${px(x1)}" y1="${py(y1)}" x2="${px(x2)}" y2="${py(y2)}"
        stroke="${cat.hex}" stroke-width="0.4" marker-end="url(#gp-flow)" opacity="0.7"/>
      <text x="${px(lx)}" y="${py(ly) - 1}" text-anchor="middle"
        font-size="1.1" fill="${cat.hex}" font-weight="bold" font-style="italic"
        transform="rotate(${-rotDeg},${px(lx)},${py(ly) - 1})">
        Pente générale ${pente_pct.toFixed(0)}%
      </text>`;
  },

  // ── COURBES DE NIVEAU + INDICATEURS PENTE ────────────────────────────────
  // Lit le cache global ContourCache (alimenté par plan-masse-canvas ou prefetch).
  // Projette WGS84 → local GIEP (centroid arithmétique cohérent avec esquisse-canvas).
  // Rend :
  //   - courbes mineures (fines, claires)
  //   - courbes majeures (épaisses, foncées) avec étiquette altitude
  //   - tickmarks perpendiculaires sur les majeures, sens descendant (bas-pente)
  _renderContours(session, px, py, bb) {
    if (typeof window === 'undefined' || !window.ContourCache) return '';
    const parcelGeo = window.ContourCache.parcelGeoFromTerrain(session?.terrain);
    if (!parcelGeo) return '';
    const cache = window.ContourCache.getCached(parcelGeo);
    if (!cache?.lines?.length) return '';

    // Centroid GIEP = moyenne arithmétique de la parcelle (cohérent esquisse-canvas)
    let clng = 0, clat = 0;
    for (const [lng, lat] of parcelGeo) { clng += lng; clat += lat; }
    clng /= parcelGeo.length; clat /= parcelGeo.length;
    const linesLocal = cache.lines.map(l => ({
      level: l.level,
      pts: window.ContourCache.geoToLocal(l.coords, clng, clat),
    }));

    const interval = cache.interval ?? 1;
    const majorEvery = interval * 5;
    const isMajor = lvl => Math.abs(lvl % majorEvery) < 0.01;

    // Index des majeures par altitude pour déterminer le sens "aval"
    // (le tick perpendiculaire pointe vers la courbe d'altitude inférieure).
    const majorByLevel = new Map();
    for (const l of linesLocal) {
      if (!isMajor(l.level)) continue;
      if (!majorByLevel.has(l.level)) majorByLevel.set(l.level, []);
      majorByLevel.get(l.level).push(l);
    }
    const sortedMajLvls = [...majorByLevel.keys()].sort((a, b) => a - b);
    const lowerLevelOf = lvl => {
      const idx = sortedMajLvls.indexOf(lvl);
      return idx > 0 ? sortedMajLvls[idx - 1] : null;
    };

    let s = `<g clip-path="url(#gp-parcel-clip)" pointer-events="none">`;

    // Tracé courbes
    for (const l of linesLocal) {
      if (l.pts.length < 2) continue;
      const major = isMajor(l.level);
      const d = 'M' + l.pts.map(p => `${px(p.x).toFixed(2)},${py(p.y).toFixed(2)}`).join(' L');
      s += `<path d="${d}" fill="none" stroke="${major ? '#8a6e3e' : '#c4b396'}"
        stroke-width="${major ? 0.3 : 0.18}" opacity="${major ? 0.78 : 0.5}"
        stroke-linecap="round" stroke-linejoin="round"/>`;
    }

    // Étiquettes altitude — sur les 4 plus longues courbes majeures
    let labeled = 0;
    const majorSorted = linesLocal
      .filter(l => isMajor(l.level) && l.pts.length >= 4)
      .sort((a, b) => b.pts.length - a.pts.length);
    for (const l of majorSorted) {
      if (labeled >= 4) break;
      const mid = l.pts[Math.floor(l.pts.length / 2)];
      s += `<text x="${px(mid.x + 0.4).toFixed(2)}" y="${py(mid.y - 0.4).toFixed(2)}"
        font-size="0.85" font-weight="700" fill="#6a5430">${Math.round(l.level)} m</text>`;
      labeled++;
    }

    // Ticks perpendiculaires de pente, sens descendant
    // Tous les ~6m le long de chaque courbe majeure (1 tick par 6m)
    for (const l of linesLocal) {
      if (!isMajor(l.level) || l.pts.length < 3) continue;
      const lower = lowerLevelOf(l.level);
      const lowerLines = lower != null ? majorByLevel.get(lower) ?? [] : [];
      // Cumul des longueurs pour échantillonner régulièrement
      let cumul = 0;
      let nextSample = 6;
      for (let i = 1; i < l.pts.length; i++) {
        const a = l.pts[i - 1], b = l.pts[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        const seg = Math.hypot(dx, dy);
        cumul += seg;
        if (cumul < nextSample || seg < 0.1) continue;
        const t = (nextSample - (cumul - seg)) / seg;
        const mx = a.x + dx * t, my = a.y + dy * t;
        // Normale unitaire (2 candidats)
        const nx1 = -dy / seg, ny1 = dx / seg;
        const nx2 = dy / seg, ny2 = -dx / seg;
        // Choix du sens descendant : prendre la normale qui pointe vers la courbe
        // d'altitude inférieure la plus proche. Si pas de courbe inf, fallback : on
        // garde nx1/ny1 (orientation arbitraire mais cohérente).
        let nx = nx1, ny = ny1;
        if (lowerLines.length) {
          const probeDist = 1.0;
          const p1 = { x: mx + nx1 * probeDist, y: my + ny1 * probeDist };
          const p2 = { x: mx + nx2 * probeDist, y: my + ny2 * probeDist };
          let d1 = Infinity, d2 = Infinity;
          for (const ll of lowerLines) {
            for (const pp of ll.pts) {
              const dd1 = Math.hypot(pp.x - p1.x, pp.y - p1.y);
              const dd2 = Math.hypot(pp.x - p2.x, pp.y - p2.y);
              if (dd1 < d1) d1 = dd1;
              if (dd2 < d2) d2 = dd2;
            }
          }
          if (d2 < d1) { nx = nx2; ny = ny2; }
        }
        const tickLen = 0.6;
        const tx2 = mx + nx * tickLen, ty2 = my + ny * tickLen;
        s += `<line x1="${px(mx).toFixed(2)}" y1="${py(my).toFixed(2)}"
          x2="${px(tx2).toFixed(2)}" y2="${py(ty2).toFixed(2)}"
          stroke="#8a6e3e" stroke-width="0.18" opacity="0.7"/>`;
        nextSample += 6;
      }
    }

    s += '</g>';
    return s;
  },

  // ── FLOW LINES ────────────────────────────────────────────────────────────
  _renderFlowLines(poly, px, py, pente_pct, exposition) {
    if (pente_pct < 0.3) return '';
    const flowLines = SlopesService.computeFlowLines(poly, pente_pct, exposition, 8);
    const cat = SlopesService.classify(pente_pct);
    let s = '';
    for (const line of flowLines) {
      if (line.length < 2) continue;
      const pts = line.map(p => `${px(p.x).toFixed(2)},${py(p.y).toFixed(2)}`).join(' ');
      s += `<polyline points="${pts}" fill="none" stroke="${cat.hex}" stroke-width="0.15"
        stroke-dasharray="0.6,0.8" opacity="0.25" marker-end="url(#gp-flow)"/>`;
    }
    return s;
  },

  // ── BORDURES ──────────────────────────────────────────────────────────────
  // Bordures arasées : trace un offset polygone autour de chaque bloc (tirets).
  _renderBordures(blocsList, px, py) {
    const offset = 1.5;
    let s = '';
    for (const bloc of blocsList) {
      const polyB = bloc.polygon ?? [];
      if (polyB.length < 3) continue;
      const offsetPoly = this._offsetPolyOutward(polyB, offset);
      const path = offsetPoly.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.x)},${py(p.y)}`).join(' ') + 'Z';
      s += `<path d="${path}" fill="none" stroke="${BORDURE_COLOR}" stroke-width="0.15" stroke-dasharray="0.6,0.4" opacity="0.5"/>`;
    }
    return s;
  },

  // ── LÉGENDE ───────────────────────────────────────────────────────────────
  // Renvoie { svg, bottomY } pour que _renderPrincipes puisse s'empiler dessous
  // sans collision (les deux partagent la colonne droite à bb.x1 + margin*0.4).
  _renderLegend(ouvrages, bb, margin, py) {
    const lx = bb.x1 + margin * 0.4;
    const ly = py(bb.y1) + 2;
    const lineH = 2.2;
    const usedTypes = new Set(ouvrages.map(o => o.type));
    // Toujours afficher les types de base
    usedTypes.add('noue_infiltration');
    usedTypes.add('jardin_pluie');

    const items = [
      { color: JARDINS_PRIVES_COLOR, shape: 'circle', label: 'Jardins privés' },
      { color: EV_CREUX_COLOR, shape: 'circle', label: 'Espaces verts creux' },
      ...Array.from(usedTypes).map(t => ({
        color: OUVRAGE_STYLES[t]?.color ?? '#999',
        shape: OUVRAGE_STYLES[t]?.shape ?? 'circle',
        label: OUVRAGE_STYLES[t]?.label ?? t,
      })),
      { color: DESCENTE_COLOR, shape: 'arrow', label: 'Descente de toitures' },
      { color: BORDURE_COLOR, shape: 'dash', label: 'Bordures arasées' },
    ];

    let s = `<g font-size="0.85" fill="#18130a">`;
    items.forEach((item, i) => {
      const y = ly + i * lineH;
      if (item.shape === 'circle' || item.shape === 'circle-sm') {
        const r = item.shape === 'circle-sm' ? 0.4 : 0.5;
        s += `<circle cx="${lx + 0.6}" cy="${y}" r="${r}" fill="${item.color}" opacity="0.6"/>`;
      } else if (item.shape === 'line') {
        s += `<line x1="${lx}" y1="${y}" x2="${lx + 1.2}" y2="${y}" stroke="${item.color}" stroke-width="0.4" stroke-dasharray="0.5,0.3"/>`;
      } else if (item.shape === 'diamond') {
        s += `<polygon points="${lx + 0.6},${y - 0.5} ${lx + 1.1},${y} ${lx + 0.6},${y + 0.5} ${lx + 0.1},${y}" fill="${item.color}" opacity="0.4"/>`;
      } else if (item.shape === 'arrow') {
        s += `<line x1="${lx}" y1="${y}" x2="${lx + 1.2}" y2="${y}" stroke="${item.color}" stroke-width="0.3" marker-end="url(#gp-arrow)"/>`;
      } else if (item.shape === 'dash') {
        s += `<line x1="${lx}" y1="${y}" x2="${lx + 1.2}" y2="${y}" stroke="${item.color}" stroke-width="0.2" stroke-dasharray="0.5,0.3"/>`;
      } else if (item.shape === 'rect-fill') {
        s += `<rect x="${lx}" y="${y - 0.4}" width="1.2" height="0.8" fill="${item.color}" opacity="0.3" rx="0.1"/>`;
      }
      s += `<text x="${lx + 1.8}" y="${y + 0.35}">${item.label}</text>`;
    });
    s += '</g>';
    const bottomY = ly + items.length * lineH;
    return { svg: s, bottomY };
  },

  // ── PRINCIPES GIEP (panneau texte) ────────────────────────────────────────
  // startY (optionnel) = y de départ vertical, en display units.
  // Si non fourni, fallback à mi-hauteur (ancien comportement).
  _renderPrincipes(bb, margin, py, pente_pct, giepResult, terrain, startY = null) {
    const px = bb.x1 + margin * 0.4;
    let y = startY != null ? startY : py(bb.y0 + bb.h * 0.5);
    const lineH = 1.6;

    const sections = [
      { title: 'NIVELLEMENT', lines: [
        `Bâtiments +0,30m/TN minimum`,
        `Pente naturelle ${pente_pct.toFixed(0)}% préservée`,
        `Équilibre déblais/remblais sur site`,
      ]},
      { title: 'INFILTRATION', lines: [
        `EV creux -0,25/-0,30m`,
        `Noues paysagères h: 0,30m`,
        `Redents tous les 20m sur pente`,
      ]},
      { title: 'STOCKAGE', lines: [
        `Voirie grave drainante si nécessaire`,
        `Dalles alvéolées parking visiteurs`,
        `Stabilisé perméable cheminements`,
      ]},
      { title: 'GESTION', lines: [
        `Zéro canalisation EP enterrée`,
        `Bordures arasées uniquement`,
        `Descentes EP directes vers jardins`,
        `Temps vidange <24h`,
      ]},
      { title: 'OBJECTIF', lines: [
        `100% infiltration pluie ${terrain.zone_climatique?.includes('hauts') ? '10' : '20'} ans`,
        `Économie VRD: -30%`,
        `Score GIEP : ${giepResult.score}/100 (${giepResult.scoreLabel})`,
      ]},
    ];

    let s = '';
    for (const sec of sections) {
      s += `<text x="${px}" y="${y}" font-size="0.9" font-weight="bold" fill="#18130a">${sec.title}</text>`;
      y += lineH * 0.8;
      for (const line of sec.lines) {
        s += `<text x="${px}" y="${y}" font-size="0.75" fill="#555" font-style="italic">${line}</text>`;
        y += lineH;
      }
      y += lineH * 0.3;
    }
    return s;
  },

  // ── NORD + ÉCHELLE ────────────────────────────────────────────────────────
  _renderNorthArrow(bb, margin, px, py) {
    const nx = bb.x0 + 2, ny = bb.y1 - 2;
    return `<g transform="translate(${px(nx)},${py(ny)})">
      <line x1="0" y1="2" x2="0" y2="-2" stroke="#18130a" stroke-width="0.2"/>
      <polygon points="-0.5,0 0,-2 0.5,0" fill="#18130a"/>
      <text x="0" y="-3" text-anchor="middle" font-size="1" font-weight="bold" fill="#18130a">N</text>
    </g>`;
  },

  _renderScaleBar(bb, margin, maxDim, vbX, vbY, vbH) {
    const barLen = maxDim < 40 ? 5 : maxDim < 100 ? 10 : 25;
    const sx = vbX + 2, sy = vbY + vbH - 2;
    let s = `<g transform="translate(${sx},${sy})">
      <line x1="0" y1="0" x2="${barLen}" y2="0" stroke="#18130a" stroke-width="0.2"/>
      <line x1="0" y1="-0.5" x2="0" y2="0.5" stroke="#18130a" stroke-width="0.15"/>
      <line x1="${barLen}" y1="-0.5" x2="${barLen}" y2="0.5" stroke="#18130a" stroke-width="0.15"/>
      <line x1="${barLen / 2}" y1="-0.3" x2="${barLen / 2}" y2="0.3" stroke="#18130a" stroke-width="0.08"/>`;
    // Seulement 3 labels (0, mid, max) pour éviter l'overlap à font-size 0.8
    s += `<text x="0" y="1.5" font-size="0.8" fill="#18130a">0</text>`;
    s += `<text x="${barLen / 2}" y="1.5" text-anchor="middle" font-size="0.8" fill="#18130a">${(barLen / 2).toFixed(0)}</text>`;
    s += `<text x="${barLen}" y="1.5" text-anchor="middle" font-size="0.8" fill="#18130a">${barLen.toFixed(0)} m</text>`;
    s += '</g>';
    return s;
  },

  // ── UTILITAIRES ───────────────────────────────────────────────────────────
  _aabb(poly) {
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  },

  _area(pts) {
    if (pts.length < 3) return 0;
    let s = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
      s += x1 * y2 - x2 * y1;
    }
    return Math.abs(s) / 2;
  },
};

export default GIEPPlanService;
