// TERLAB · terrain-svg-service.js · Visualisation SVG du terrain
// Porté depuis terrain-svg.js GIEP — adapté ES module + design system TERLAB
// v2 : supporte le vrai polygone GeoJSON (plus seulement rectangle)
// v3 : flèches pente 5 classes visibles (fond pill), flow lines, labels haute lisibilité
// ENSA La Réunion · MGA Architecture

import SlopesService from './slopes-service.js';

const TERRAIN_COLORS = {
  terrain:    'rgba(154, 120, 32, 0.06)',
  gradient_a: '#e2dbcd',
  gradient_b: '#d5cbb8',
  border:     '#9a7820',
  text:       '#3c3220',
  dimensions: '#6b5c3e',
  diagonal:   '#8a6c1a',
  pente:      '#8b2a3a',
  vegetation: '#3d6b2e',
  ravine:     '#2a5a7a',
};

const TERRAIN_PRESETS = {
  square_small:  { longueur: 30,  largeur: 30  },
  square_medium: { longueur: 50,  largeur: 50  },
  square_large:  { longueur: 150, largeur: 150 },
  rect_typical:  { longueur: 70,  largeur: 36  },
  rect_wide:     { longueur: 100, largeur: 25  },
  rect_long:     { longueur: 120, largeur: 20  },
  rect_very_long:{ longueur: 200, largeur: 15  },
};

const EXPO_ANGLES = { N:270, NE:315, E:0, SE:45, S:90, SO:135, O:180, NO:225 };
const EXPO_ICONS  = { N:'\u2191', NE:'\u2197', E:'\u2192', SE:'\u2198', S:'\u2193', SO:'\u2199', O:'\u2190', NO:'\u2196' };

let _currentDimensions = { longueur: 0, largeur: 0, surface: 0, diagonale: 0 };

const TerrainSVG = {

  PRESETS: TERRAIN_PRESETS,

  // ── Init : dessiner le terrain dans un conteneur SVG ──────────────
  init(svgId, options = {}) {
    const svg = document.getElementById(svgId);
    if (!svg) { console.warn('[TerrainSVG] SVG introuvable:', svgId); return; }

    const pente       = parseFloat(options.pente ?? 0);
    const exposition  = options.exposition ?? null;
    const ravine_dist = parseFloat(options.ravine_dist ?? 999);

    // Mode polygone réel (GeoJSON) vs mode rectangle
    if (options.geojson) {
      const poly = this._geojsonToLocal(options.geojson);
      if (poly.length >= 3) {
        const area = Math.abs(this._polyArea(poly));
        const bb = this._polyBBox(poly);
        _currentDimensions = {
          longueur: bb.w, largeur: bb.h,
          surface: area,
          diagonale: Math.sqrt(bb.w * bb.w + bb.h * bb.h),
        };
        this._renderPolygon(svg, poly, _currentDimensions, pente, exposition, ravine_dist);
        return;
      }
    }

    // Fallback rectangle
    const longueur = parseFloat(options.longueur ?? 70);
    const largeur  = parseFloat(options.largeur ?? 36);
    _currentDimensions = {
      longueur, largeur,
      surface: longueur * largeur,
      diagonale: Math.sqrt(longueur * longueur + largeur * largeur),
    };
    this._renderRect(svg, _currentDimensions, pente, exposition, ravine_dist);
  },

  update(svgId, options = {}) { this.init(svgId, options); },

  applyPreset(svgId, presetName, extraOptions = {}) {
    const preset = TERRAIN_PRESETS[presetName];
    if (!preset) return;
    this.init(svgId, { ...preset, ...extraOptions });
  },

  getDimensions() { return { ..._currentDimensions }; },

  // ═══════════════════════════════════════════════════════════════
  //  CONVERSION GeoJSON → mètres locaux
  // ═══════════════════════════════════════════════════════════════

  _geojsonToLocal(geojson) {
    const coords = geojson.type === 'Polygon'
      ? geojson.coordinates[0]
      : geojson.type === 'MultiPolygon'
        ? geojson.coordinates[0][0]
        : [];
    if (coords.length < 3) return [];

    const n = coords.length;
    const clng = coords.reduce((s, c) => s + c[0], 0) / n;
    const clat = coords.reduce((s, c) => s + c[1], 0) / n;
    const LNG_M = 111320 * Math.cos(clat * Math.PI / 180);
    const LAT_M = 111320;

    let poly = coords.map(([lng, lat]) => [
      (lng - clng) * LNG_M,
      -(lat - clat) * LAT_M,  // Y inversé pour SVG
    ]);
    // Supprimer le point de fermeture GeoJSON
    if (poly.length > 1 && Math.hypot(poly[0][0] - poly[poly.length - 1][0],
        poly[0][1] - poly[poly.length - 1][1]) < 0.01) {
      poly.pop();
    }
    return poly;
  },

  _polyArea(pts) {
    let s = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
      s += x1 * y2 - x2 * y1;
    }
    return s / 2;
  },

  _polyBBox(pts) {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  },

  // ═══════════════════════════════════════════════════════════════
  //  RENDER POLYGONE RÉEL
  // ═══════════════════════════════════════════════════════════════

  _renderPolygon(svg, poly, dim, pente, exposition, ravine_dist) {
    const W = 300, H = 200;
    const padding = 40;
    const bb = this._polyBBox(poly);

    const availW = W - padding * 2;
    const availH = H - padding * 2 - 30;
    const scale = Math.min(availW / (bb.w || 1), availH / (bb.h || 1)) * 0.8;

    const offX = padding + (availW - bb.w * scale) / 2 - bb.x0 * scale;
    const offY = padding + 10 + (availH - bb.h * scale) / 2 - bb.y0 * scale;
    const tx = (x) => offX + x * scale;
    const ty = (y) => offY + y * scale;

    // Points SVG du polygone
    const polyPts = poly.map(([x, y]) => `${tx(x).toFixed(1)},${ty(y).toFixed(1)}`).join(' ');

    // Centroïde
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;

    // Diagonale : segment le plus long entre sommets
    let maxDist = 0, diagP1 = poly[0], diagP2 = poly[1];
    for (let i = 0; i < poly.length; i++) {
      for (let j = i + 1; j < poly.length; j++) {
        const d = Math.hypot(poly[j][0] - poly[i][0], poly[j][1] - poly[i][1]);
        if (d > maxDist) { maxDist = d; diagP1 = poly[i]; diagP2 = poly[j]; }
      }
    }

    // Cotations bbox
    const cotY = ty(bb.y1) + 12;
    const cotX = tx(bb.x0) - 12;

    let svgContent = `
      <defs>
        <linearGradient id="tg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${TERRAIN_COLORS.gradient_a}" stop-opacity="0.8"/>
          <stop offset="100%" stop-color="${TERRAIN_COLORS.gradient_b}" stop-opacity="0.4"/>
        </linearGradient>
        <marker id="arrow-pente" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="${TERRAIN_COLORS.pente}"/>
        </marker>
        <marker id="arrow-flow" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto">
          <polygon points="0 0, 6 2.5, 0 5" fill="${TERRAIN_COLORS.pente}" opacity="0.5"/>
        </marker>
      </defs>

      <!-- Titre -->
      <text x="${W / 2}" y="16" text-anchor="middle"
            font-size="11" font-weight="600" fill="${TERRAIN_COLORS.text}"
            font-family="var(--font-mono, monospace)">
        Géométrie du Terrain
      </text>

      <!-- Flow lines (sous le polygone) -->
      ${this._renderFlowLines(poly, tx, ty, pente, exposition)}

      <!-- Polygone terrain -->
      <polygon points="${polyPts}"
               fill="url(#tg)" stroke="${TERRAIN_COLORS.border}"
               stroke-width="1.5" stroke-linejoin="round"/>

      <!-- Diagonale (longueur hydraulique) -->
      <line x1="${tx(diagP1[0]).toFixed(1)}" y1="${ty(diagP1[1]).toFixed(1)}"
            x2="${tx(diagP2[0]).toFixed(1)}" y2="${ty(diagP2[1]).toFixed(1)}"
            stroke="${TERRAIN_COLORS.diagonal}" stroke-width="1.2"
            stroke-dasharray="4,3" opacity="0.7"/>
      <text x="${tx((diagP1[0] + diagP2[0]) / 2).toFixed(1)}"
            y="${(ty((diagP1[1] + diagP2[1]) / 2) - 5).toFixed(1)}"
            text-anchor="middle" font-size="9" fill="${TERRAIN_COLORS.diagonal}"
            font-weight="500" font-family="var(--font-mono, monospace)">
        L.hydr. ${maxDist.toFixed(0)} m
      </text>

      <!-- Cotation largeur bbox (bas) -->
      <line x1="${tx(bb.x0).toFixed(1)}" y1="${cotY}" x2="${tx(bb.x1).toFixed(1)}" y2="${cotY}"
            stroke="${TERRAIN_COLORS.dimensions}" stroke-width="1"/>
      <line x1="${tx(bb.x0).toFixed(1)}" y1="${cotY - 3}" x2="${tx(bb.x0).toFixed(1)}" y2="${cotY + 3}"
            stroke="${TERRAIN_COLORS.dimensions}" stroke-width="1"/>
      <line x1="${tx(bb.x1).toFixed(1)}" y1="${cotY - 3}" x2="${tx(bb.x1).toFixed(1)}" y2="${cotY + 3}"
            stroke="${TERRAIN_COLORS.dimensions}" stroke-width="1"/>
      <text x="${tx((bb.x0 + bb.x1) / 2).toFixed(1)}" y="${cotY + 13}"
            text-anchor="middle" font-size="11" fill="${TERRAIN_COLORS.dimensions}"
            font-family="var(--font-mono, monospace)">
        ${bb.w.toFixed(0)} m
      </text>

      <!-- Cotation profondeur bbox (gauche) -->
      <line x1="${cotX}" y1="${ty(bb.y0).toFixed(1)}" x2="${cotX}" y2="${ty(bb.y1).toFixed(1)}"
            stroke="${TERRAIN_COLORS.dimensions}" stroke-width="1"/>
      <line x1="${cotX - 3}" y1="${ty(bb.y0).toFixed(1)}" x2="${cotX + 3}" y2="${ty(bb.y0).toFixed(1)}"
            stroke="${TERRAIN_COLORS.dimensions}" stroke-width="1"/>
      <line x1="${cotX - 3}" y1="${ty(bb.y1).toFixed(1)}" x2="${cotX + 3}" y2="${ty(bb.y1).toFixed(1)}"
            stroke="${TERRAIN_COLORS.dimensions}" stroke-width="1"/>
      <text x="${cotX - 6}" y="${ty((bb.y0 + bb.y1) / 2).toFixed(1)}"
            text-anchor="middle" font-size="11" fill="${TERRAIN_COLORS.dimensions}"
            font-family="var(--font-mono, monospace)"
            transform="rotate(-90, ${cotX - 6}, ${ty((bb.y0 + bb.y1) / 2).toFixed(1)})">
        ${bb.h.toFixed(0)} m
      </text>

      <!-- Surface au centroïde -->
      <text x="${tx(cx).toFixed(1)}" y="${(ty(cy) + 4).toFixed(1)}"
            text-anchor="middle" font-size="12" fill="${TERRAIN_COLORS.text}"
            font-family="var(--font-mono, monospace)" opacity="0.7">
        ${dim.surface.toFixed(0)} m²
      </text>

      <!-- Cotations par arête -->
      ${this._renderEdgeLengths(poly, tx, ty)}
    `;

    if (pente > 0 && exposition) {
      svgContent += this._renderPenteArrowAt(tx(cx), ty(cy), Math.min(bb.w, bb.h) * scale * 0.3, pente, exposition);
    }
    if (ravine_dist < 100) {
      svgContent += this._renderRavineIndicator(tx(bb.x1) + 4, ty(bb.y0), 6, bb.h * scale * 0.6, ravine_dist);
    }
    if (exposition) {
      svgContent += this._renderCompass(W - 22, 30, exposition);
    }

    svg.innerHTML = svgContent;
  },

  /** Longueurs des arêtes du polygone */
  _renderEdgeLengths(poly, tx, ty) {
    let out = '';
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      const [x1, y1] = poly[i], [x2, y2] = poly[j];
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 2) continue;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      // Décaler le label vers l'extérieur du polygone
      const dx = x2 - x1, dy = y2 - y1;
      const nx = -dy / len * 1.5, ny = dx / len * 1.5;
      out += `<text x="${tx(mx + nx).toFixed(1)}" y="${(ty(my + ny) - 1).toFixed(1)}"
                text-anchor="middle" font-size="7.5" fill="${TERRAIN_COLORS.dimensions}"
                font-family="var(--font-mono, monospace)" opacity="0.65">
                ${len.toFixed(1)}m</text>`;
    }
    return out;
  },

  // ═══════════════════════════════════════════════════════════════
  //  RENDER RECTANGLE (fallback legacy)
  // ═══════════════════════════════════════════════════════════════

  _renderRect(svg, dim, pente, exposition, ravine_dist) {
    const W = 300, H = 200;
    const padding = 40;

    const maxDim = Math.max(dim.longueur, dim.largeur);
    const availW = W - padding * 2;
    const availH = H - padding * 2 - 30;
    const scale  = Math.min(availW / maxDim, availH / maxDim) * 0.8;

    const svgW = dim.longueur * scale;
    const svgH = dim.largeur * scale;
    const oX   = (W - svgW) / 2;
    const oY   = (H - svgH) / 2 + 5;

    const diagAngle = Math.atan2(svgH, svgW) * 180 / Math.PI;
    const diagCX = oX + svgW / 2;
    const diagCY = oY + svgH / 2;

    const cotY = oY + svgH + 15;
    const cotX = oX - 15;

    let svgContent = `
      <defs>
        <linearGradient id="tg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${TERRAIN_COLORS.gradient_a}" stop-opacity="0.8"/>
          <stop offset="100%" stop-color="${TERRAIN_COLORS.gradient_b}" stop-opacity="0.4"/>
        </linearGradient>
        <marker id="arrow-pente" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="${TERRAIN_COLORS.pente}"/>
        </marker>
        <marker id="arrow-ravine" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="${TERRAIN_COLORS.ravine}"/>
        </marker>
        <marker id="arrow-flow" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto">
          <polygon points="0 0, 6 2.5, 0 5" fill="${TERRAIN_COLORS.pente}" opacity="0.5"/>
        </marker>
      </defs>

      <text x="${W / 2}" y="16" text-anchor="middle"
            font-size="11" font-weight="600" fill="${TERRAIN_COLORS.text}"
            font-family="var(--font-mono, monospace)">
        Géométrie du Terrain
      </text>

      <rect x="${oX}" y="${oY}" width="${svgW}" height="${svgH}"
            fill="url(#tg)" stroke="${TERRAIN_COLORS.border}"
            stroke-width="1.5" rx="3"/>

      <line x1="${oX}" y1="${oY}" x2="${oX + svgW}" y2="${oY + svgH}"
            stroke="${TERRAIN_COLORS.diagonal}" stroke-width="1.5"
            stroke-dasharray="4,3" opacity="0.8"/>
      <text x="${diagCX}" y="${diagCY - 6}"
            text-anchor="middle" font-size="10" fill="${TERRAIN_COLORS.diagonal}"
            font-weight="500" font-family="var(--font-mono, monospace)"
            transform="rotate(${diagAngle}, ${diagCX}, ${diagCY - 6})">
        L.hydr: ${dim.diagonale.toFixed(0)} m
      </text>

      <line x1="${oX}" y1="${cotY}" x2="${oX + svgW}" y2="${cotY}"
            stroke="${TERRAIN_COLORS.dimensions}" stroke-width="1"/>
      <line x1="${oX}" y1="${cotY - 3}" x2="${oX}" y2="${cotY + 3}"
            stroke="${TERRAIN_COLORS.dimensions}" stroke-width="1"/>
      <line x1="${oX + svgW}" y1="${cotY - 3}" x2="${oX + svgW}" y2="${cotY + 3}"
            stroke="${TERRAIN_COLORS.dimensions}" stroke-width="1"/>
      <text x="${oX + svgW / 2}" y="${cotY + 13}"
            text-anchor="middle" font-size="11" fill="${TERRAIN_COLORS.dimensions}"
            font-family="var(--font-mono, monospace)">
        ${dim.longueur.toFixed(0)} m
      </text>

      <line x1="${cotX}" y1="${oY}" x2="${cotX}" y2="${oY + svgH}"
            stroke="${TERRAIN_COLORS.dimensions}" stroke-width="1"/>
      <line x1="${cotX - 3}" y1="${oY}" x2="${cotX + 3}" y2="${oY}"
            stroke="${TERRAIN_COLORS.dimensions}" stroke-width="1"/>
      <line x1="${cotX - 3}" y1="${oY + svgH}" x2="${cotX + 3}" y2="${oY + svgH}"
            stroke="${TERRAIN_COLORS.dimensions}" stroke-width="1"/>
      <text x="${cotX - 8}" y="${oY + svgH / 2}"
            text-anchor="middle" font-size="11" fill="${TERRAIN_COLORS.dimensions}"
            font-family="var(--font-mono, monospace)"
            transform="rotate(-90, ${cotX - 8}, ${oY + svgH / 2})">
        ${dim.largeur.toFixed(0)} m
      </text>

      <text x="${oX + svgW / 2}" y="${oY + svgH / 2 + 4}"
            text-anchor="middle" font-size="12" fill="${TERRAIN_COLORS.text}"
            font-family="var(--font-mono, monospace)" opacity="0.7">
        ${dim.surface.toFixed(0)} m²
      </text>
    `;

    if (pente > 0 && exposition) {
      svgContent += this._renderPenteArrowAt(oX + svgW / 2, oY + svgH / 2, Math.min(svgW, svgH) * 0.3, pente, exposition);
    }
    if (ravine_dist < 100) {
      svgContent += this._renderRavineIndicator(oX + svgW + 6, oY, 6, svgH * 0.6, ravine_dist);
    }
    if (exposition) {
      svgContent += this._renderCompass(W - 22, 30, exposition);
    }

    svg.innerHTML = svgContent;
  },

  // ═══════════════════════════════════════════════════════════════
  //  ÉLÉMENTS COMMUNS
  // ═══════════════════════════════════════════════════════════════

  _renderPenteArrowAt(cx, cy, len, pente_pct, exposition) {
    const cat = SlopesService.classify(pente_pct);
    const couleur = cat.hex;
    const angle = EXPO_ANGLES[exposition] ?? 90;
    const rad = (angle * Math.PI) / 180;
    const x2 = cx + Math.cos(rad) * len;
    const y2 = cy + Math.sin(rad) * len;

    // Label position (perpendiculaire à la flèche pour lisibilité)
    const mx = (cx + x2) / 2, my = (cy + y2) / 2;
    const perpOff = 14;
    const lx = mx - Math.sin(rad) * perpOff;
    const ly = my + Math.cos(rad) * perpOff;

    const labelText = `${Math.abs(pente_pct).toFixed(1)}%`;
    const labelW = labelText.length * 6.5 + 8;

    return `
      <!-- Flèche pente principale -->
      <line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}"
            stroke="${couleur}" stroke-width="2.5" marker-end="url(#arrow-pente)" opacity="0.9"/>
      <!-- Pill label visible -->
      <rect x="${lx - labelW / 2}" y="${ly - 8}" width="${labelW}" height="16"
            rx="8" fill="white" stroke="${couleur}" stroke-width="1" opacity="0.92"/>
      <text x="${lx}" y="${ly + 4}"
            text-anchor="middle" font-size="10" fill="${couleur}" font-weight="700"
            font-family="var(--font-mono, monospace)">
        ${labelText}
      </text>
      <!-- Classification label -->
      <rect x="${lx - 40}" y="${ly + 8}" width="80" height="13"
            rx="6" fill="${couleur}" opacity="0.15"/>
      <text x="${lx}" y="${ly + 18}"
            text-anchor="middle" font-size="7.5" fill="${couleur}" font-weight="600"
            font-family="var(--font-mono, monospace)">
        ${cat.label}
      </text>`;
  },

  // ── Flow lines — chemins d'écoulement SVG ─────────────────────
  _renderFlowLines(poly, tx, ty, pente_pct, exposition) {
    if (!pente_pct || pente_pct < 0.1 || !exposition) return '';

    const localPoly = poly.map(([x, y]) => [x, y]);
    const flowLines = SlopesService.computeFlowLines(localPoly, pente_pct, exposition, 10);
    if (!flowLines.length) return '';

    const cat = SlopesService.classify(pente_pct);
    let out = '';
    for (const line of flowLines) {
      if (line.length < 2) continue;
      const pts = line.map(p => `${tx(p.x).toFixed(1)},${ty(p.y).toFixed(1)}`).join(' ');
      out += `
        <polyline points="${pts}"
                  fill="none" stroke="${cat.hex}" stroke-width="1.2"
                  stroke-dasharray="3,4" opacity="0.45"
                  marker-end="url(#arrow-flow)"/>`;
    }
    return out;
  },

  _renderRavineIndicator(x, y, w, h, distance_m) {
    const urgence = distance_m < 30 ? '#ef4444' : '#f59e0b';
    return `
      <rect x="${x}" y="${y}" width="${w}" height="${h}"
            fill="${urgence}" opacity="0.6" rx="2"/>
      <text x="${x + 10}" y="${y + 12}"
            font-size="8" fill="${urgence}"
            font-family="var(--font-mono, monospace)">
        Ravine ${Math.round(distance_m)}m
      </text>`;
  },

  _renderCompass(x, y, exposition) {
    const icon = EXPO_ICONS[exposition] ?? '?';
    return `
      <circle cx="${x}" cy="${y}" r="12" fill="rgba(154,120,32,0.08)"
              stroke="${TERRAIN_COLORS.border}" stroke-width="0.8"/>
      <text x="${x}" y="${y + 4}" text-anchor="middle"
            font-size="12" fill="${TERRAIN_COLORS.border}">${icon}</text>
      <text x="${x}" y="${y + 22}" text-anchor="middle"
            font-size="8" fill="${TERRAIN_COLORS.dimensions}"
            font-family="var(--font-mono, monospace)">${exposition}</text>`;
  },
};

export default TerrainSVG;
