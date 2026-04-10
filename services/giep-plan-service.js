// terlab/services/giep-plan-service.js · Plan GIEP EP SVG auto post-étude de capacité
// Génère le plan de gestion intégrée des eaux pluviales (GIEP) en SVG
// Placé automatiquement après calcul PlanMasseEngine + GIEPCalculator
// Inspiré : plan GIEP La Saline (MGA Architecture)
// ENSA La Réunion · MGA Architecture 2026

import SlopesService from './slopes-service.js';
import GIEPCalculator from './giep-calculator-service.js';

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
    if (!proposal?.bat || !giepResult) return '';

    const terrain = session?.terrain ?? {};
    const bat = proposal.bat;
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
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}"
      width="100%" style="background:#F7F4EE;font-family:'Inter',sans-serif;color:#18130a">
    <defs>
      <marker id="gp-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <polygon points="0 0,8 3,0 6" fill="${DESCENTE_COLOR}"/>
      </marker>
      <marker id="gp-flow" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto">
        <polygon points="0 0,6 2.5,0 5" fill="${cat.hex}" opacity="0.5"/>
      </marker>
    </defs>`;

    // 1. FOND — parcelle
    const parcelPts = poly.map(([x, y]) => `${px(x)},${py(y)}`).join(' ');
    svg += `<polygon points="${parcelPts}" fill="#E8F5E9" fill-opacity="0.5" stroke="#18130a" stroke-width="0.3"/>`;

    // 2. FLOW LINES (chemins d'eau sous tout)
    svg += this._renderFlowLines(poly, px, py, pente_pct, exposition);

    // 3. BÂTIMENT
    svg += `<rect x="${px(bat.x)}" y="${py(bat.y + bat.l)}" width="${bat.w}" height="${bat.l}"
      fill="#B0BEC5" fill-opacity="0.6" stroke="#455A64" stroke-width="0.25"/>`;
    const batArea = (bat.w * bat.l).toFixed(0);
    svg += `<text x="${px(bat.x + bat.w / 2)}" y="${py(bat.y + bat.l / 2)}" text-anchor="middle"
      font-size="1.2" fill="#18130a" font-weight="bold">${batArea} m²</text>`;
    svg += `<text x="${px(bat.x + bat.w / 2)}" y="${py(bat.y + bat.l / 2) + 1.5}" text-anchor="middle"
      font-size="0.8" fill="#555">+0.30m/TN min</text>`;

    // 4. DESCENTES DE TOITURE (flèches rouges sur chaque face du bâtiment)
    svg += this._renderDescentesToiture(bat, px, py);

    // 5. OUVRAGES EP — placement automatique
    svg += this._placeOuvrages(ouvrages, bat, poly, bb, px, py, pente_pct, exposition);

    // 6. PENTE GÉNÉRALE (grande flèche + label)
    svg += this._renderPenteLabel(bb, poly, px, py, pente_pct, exposition, cat);

    // 7. BORDURES (tirets autour voirie)
    svg += this._renderBordures(bat, poly, bb, px, py);

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

  // ── DESCENTES DE TOITURE ──────────────────────────────────────────────────
  _renderDescentesToiture(bat, px, py) {
    let s = '';
    const arrowLen = Math.min(bat.w, bat.l) * 0.15;
    // 4 coins + milieux des faces
    const points = [
      // Face nord (haut)
      { x: bat.x + bat.w * 0.25, y: bat.y + bat.l, dx: 0, dy: 1 },
      { x: bat.x + bat.w * 0.75, y: bat.y + bat.l, dx: 0, dy: 1 },
      // Face sud (bas)
      { x: bat.x + bat.w * 0.25, y: bat.y, dx: 0, dy: -1 },
      { x: bat.x + bat.w * 0.75, y: bat.y, dx: 0, dy: -1 },
      // Face est
      { x: bat.x + bat.w, y: bat.y + bat.l * 0.5, dx: 1, dy: 0 },
      // Face ouest
      { x: bat.x, y: bat.y + bat.l * 0.5, dx: -1, dy: 0 },
    ];

    for (const p of points) {
      const x1 = px(p.x), y1 = py(p.y);
      const x2 = px(p.x + p.dx * arrowLen);
      const y2 = py(p.y + p.dy * arrowLen);
      s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
        stroke="${DESCENTE_COLOR}" stroke-width="0.35" marker-end="url(#gp-arrow)"/>`;
    }
    return s;
  },

  // ── PLACEMENT OUVRAGES ────────────────────────────────────────────────────
  _placeOuvrages(ouvrages, bat, poly, bb, px, py, pente_pct, exposition) {
    let s = '';
    const angle = { N: 270, NE: 315, E: 0, SE: 45, S: 90, SO: 135, O: 180, NO: 225 }[exposition] ?? 90;
    const rad = (angle * Math.PI) / 180;
    const downX = Math.cos(rad), downY = Math.sin(rad);

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
        // Jardins : distribués autour du bâtiment dans l'espace libre
        const positions = [
          [bat.x - 3, bat.y + bat.l * 0.3],
          [bat.x + bat.w + 3, bat.y + bat.l * 0.7],
          [bat.x + bat.w * 0.5, bat.y + bat.l + 3],
        ];
        for (const [jx, jy] of positions) {
          if (jx < bb.x0 || jx > bb.x1 || jy < bb.y0 || jy > bb.y1) continue;
          s += `<circle cx="${px(jx)}" cy="${py(jy)}" r="1.2" fill="${EV_CREUX_COLOR}" opacity="0.4" stroke="${EV_CREUX_COLOR}" stroke-width="0.15"/>`;
        }

      } else if (o.type === 'fosse_infiltration') {
        // Fosses : au pied des descentes EP (coins du bâtiment)
        const corners = [
          [bat.x - 0.8, bat.y - 0.8],
          [bat.x + bat.w + 0.8, bat.y - 0.8],
          [bat.x - 0.8, bat.y + bat.l + 0.8],
          [bat.x + bat.w + 0.8, bat.y + bat.l + 0.8],
        ];
        for (const [fx, fy] of corners) {
          s += `<circle cx="${px(fx)}" cy="${py(fy)}" r="0.6" fill="${style.color}" opacity="0.5" stroke="${style.color}" stroke-width="0.15"/>`;
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
        // Overlay vert sur le bâtiment
        s += `<rect x="${px(bat.x + 0.5)}" y="${py(bat.y + bat.l - 0.5)}" width="${bat.w - 1}" height="${bat.l - 1}"
          fill="${style.color}" fill-opacity="0.12" stroke="${style.color}" stroke-width="0.15" stroke-dasharray="0.5,0.3" rx="0.3"/>`;
      }
    }

    // Jardins privés (cercles verts pâles dans l'espace libre)
    const jardinsPositions = [
      [bb.x0 + bb.w * 0.15, bb.y0 + bb.h * 0.2],
      [bb.x0 + bb.w * 0.85, bb.y0 + bb.h * 0.8],
      [bb.x0 + bb.w * 0.15, bb.y0 + bb.h * 0.7],
      [bb.x0 + bb.w * 0.8, bb.y0 + bb.h * 0.25],
    ];
    for (const [jx, jy] of jardinsPositions) {
      // Vérifier pas dans le bâtiment
      if (jx > bat.x - 1 && jx < bat.x + bat.w + 1 && jy > bat.y - 1 && jy < bat.y + bat.l + 1) continue;
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
  _renderBordures(bat, poly, bb, px, py) {
    // Bordures arasées le long du bâtiment (tirets)
    const margin = 1.5;
    const pts = [
      [bat.x - margin, bat.y - margin],
      [bat.x + bat.w + margin, bat.y - margin],
      [bat.x + bat.w + margin, bat.y + bat.l + margin],
      [bat.x - margin, bat.y + bat.l + margin],
    ];
    const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${px(x)},${py(y)}`).join(' ') + 'Z';
    return `<path d="${path}" fill="none" stroke="${BORDURE_COLOR}" stroke-width="0.15" stroke-dasharray="0.6,0.4" opacity="0.5"/>`;
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
