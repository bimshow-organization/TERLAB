// TERLAB · terrain-svg-service.js · Visualisation SVG du terrain
// Porté depuis terrain-svg.js GIEP — adapté ES module + design system TERLAB
// ENSA La Réunion · MGA Architecture

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

    const longueur     = parseFloat(options.longueur ?? 70);
    const largeur      = parseFloat(options.largeur ?? 36);
    const pente        = parseFloat(options.pente ?? 0);
    const exposition   = options.exposition ?? null;
    const ravine_dist  = parseFloat(options.ravine_dist ?? 999);

    _currentDimensions = {
      longueur, largeur,
      surface: longueur * largeur,
      diagonale: Math.sqrt(longueur * longueur + largeur * largeur),
    };

    this._render(svg, _currentDimensions, pente, exposition, ravine_dist);
  },

  // ── Update avec nouvelles dimensions ──────────────────────────────
  update(svgId, options = {}) {
    this.init(svgId, options);
  },

  // ── Appliquer un preset ───────────────────────────────────────────
  applyPreset(svgId, presetName, extraOptions = {}) {
    const preset = TERRAIN_PRESETS[presetName];
    if (!preset) return;
    this.init(svgId, { ...preset, ...extraOptions });
  },

  // ── Obtenir les dimensions courantes ──────────────────────────────
  getDimensions() {
    return { ..._currentDimensions };
  },

  // ── Render interne ────────────────────────────────────────────────
  _render(svg, dim, pente, exposition, ravine_dist) {
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

    // Cotation longueur (bas)
    const cotY = oY + svgH + 15;
    // Cotation largeur (gauche)
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
      </defs>

      <!-- Titre -->
      <text x="${W / 2}" y="16" text-anchor="middle"
            font-size="11" font-weight="600" fill="${TERRAIN_COLORS.text}"
            font-family="var(--font-mono, monospace)">
        Géométrie du Terrain
      </text>

      <!-- Rectangle terrain -->
      <rect x="${oX}" y="${oY}" width="${svgW}" height="${svgH}"
            fill="url(#tg)" stroke="${TERRAIN_COLORS.border}"
            stroke-width="1.5" rx="3"/>

      <!-- Diagonale (longueur hydraulique) -->
      <line x1="${oX}" y1="${oY}" x2="${oX + svgW}" y2="${oY + svgH}"
            stroke="${TERRAIN_COLORS.diagonal}" stroke-width="1.5"
            stroke-dasharray="4,3" opacity="0.8"/>
      <text x="${diagCX}" y="${diagCY - 6}"
            text-anchor="middle" font-size="10" fill="${TERRAIN_COLORS.diagonal}"
            font-weight="500" font-family="var(--font-mono, monospace)"
            transform="rotate(${diagAngle}, ${diagCX}, ${diagCY - 6})">
        L.hydr: ${dim.diagonale.toFixed(0)} m
      </text>

      <!-- Cotation longueur (bas) -->
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

      <!-- Cotation largeur (gauche) -->
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

      <!-- Surface -->
      <text x="${oX + svgW / 2}" y="${oY + svgH / 2 + 4}"
            text-anchor="middle" font-size="12" fill="${TERRAIN_COLORS.text}"
            font-family="var(--font-mono, monospace)" opacity="0.7">
        ${dim.surface.toFixed(0)} m²
      </text>
    `;

    // ── Flèche de pente ─────────────────────────────────────────────
    if (pente > 0 && exposition) {
      svgContent += this._renderPenteArrow(oX, oY, svgW, svgH, pente, exposition);
    }

    // ── Indicateur ravine ───────────────────────────────────────────
    if (ravine_dist < 100) {
      svgContent += this._renderRavineIndicator(oX, oY, svgW, svgH, ravine_dist);
    }

    // ── Boussole orientation ────────────────────────────────────────
    if (exposition) {
      svgContent += this._renderCompass(W - 22, 30, exposition);
    }

    svg.innerHTML = svgContent;
  },

  // ── Flèche de pente avec direction ────────────────────────────────
  _renderPenteArrow(oX, oY, svgW, svgH, pente_pct, exposition) {
    const couleur = pente_pct > 5 ? '#ef4444' : pente_pct > 2 ? '#f59e0b' : '#3cb860';
    const angle = EXPO_ANGLES[exposition] ?? 90;
    const cx = oX + svgW / 2;
    const cy = oY + svgH / 2;
    const len = Math.min(svgW, svgH) * 0.3;
    const rad = (angle * Math.PI) / 180;
    const x2 = cx + Math.cos(rad) * len;
    const y2 = cy + Math.sin(rad) * len;

    return `
      <line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}"
            stroke="${couleur}" stroke-width="2" marker-end="url(#arrow-pente)" opacity="0.85"/>
      <text x="${(cx + x2) / 2 + 10}" y="${(cy + y2) / 2}"
            font-size="10" fill="${couleur}" font-weight="bold"
            font-family="var(--font-mono, monospace)">
        ${Math.abs(pente_pct).toFixed(1)}%
      </text>`;
  },

  // ── Indicateur ravine si < 100m ───────────────────────────────────
  _renderRavineIndicator(oX, oY, svgW, svgH, distance_m) {
    const urgence = distance_m < 30 ? '#ef4444' : '#f59e0b';
    return `
      <rect x="${oX + svgW + 6}" y="${oY}" width="6" height="${svgH * 0.6}"
            fill="${urgence}" opacity="0.6" rx="2"/>
      <text x="${oX + svgW + 16}" y="${oY + 12}"
            font-size="8" fill="${urgence}"
            font-family="var(--font-mono, monospace)">
        Ravine ${Math.round(distance_m)}m
      </text>`;
  },

  // ── Boussole orientation solaire ──────────────────────────────────
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
