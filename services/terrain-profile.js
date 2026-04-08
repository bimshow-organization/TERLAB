// TERLAB · services/terrain-profile.js
// Profil altimétrique SVG — adapté de GIEPTerrainProfile (terrain-coupe.js)
// Thème dark TERLAB · Compact · Exportable PDF
// ENSA La Réunion · MGA Architecture
// ════════════════════════════════════════════════════════════════════

const DEFAULTS = {
  width:  560,
  height: 200,
  margin: { top: 24, right: 40, bottom: 36, left: 52 },
  colors: {
    terrain:     '#E8811A',
    terrainFill: 'rgba(232,129,26,0.15)',
    grid:        'rgba(154,120,32,0.2)',
    text:        '#a89060',
    point:       '#00d4ff',
    axis:        '#6b5c3e',
  },
  verticalExaggeration: 1.5,
  smoothing: true,
  title: null,          // null = pas de titre (compact)
};

const TerrainProfile = {

  /**
   * Génère un SVG de profil altimétrique dans un conteneur.
   * @param {Array<{distance: number, altitude: number}>} data
   * @param {HTMLElement|string} container
   * @param {Partial<typeof DEFAULTS>} options
   * @returns {SVGElement|null}
   */
  render(data, container, options = {}) {
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el) { console.warn('[TerrainProfile] Conteneur introuvable'); return null; }
    if (!data || data.length < 2) { console.warn('[TerrainProfile] < 2 points'); return null; }

    const cfg = { ...DEFAULTS, ...options, colors: { ...DEFAULTS.colors, ...options.colors } };
    const W = cfg.width, H = cfg.height;
    const cW = W - cfg.margin.left - cfg.margin.right;
    const cH = H - cfg.margin.top  - cfg.margin.bottom;

    // Data ranges
    const dists = data.map(p => p.distance);
    const alts  = data.map(p => p.altitude).filter(a => a != null);
    const minD = Math.min(...dists), maxD = Math.max(...dists);
    const minA = Math.min(...alts),  maxA = Math.max(...alts);
    const range = (maxA - minA) * cfg.verticalExaggeration;
    const pad = range * 0.12;
    const dMinA = minA - pad, dMaxA = maxA + pad;

    const sx = d => cfg.margin.left + ((d - minD) / (maxD - minD || 1)) * cW;
    const sy = a => cfg.margin.top  + cH - ((a - dMinA) / (dMaxA - dMinA || 1)) * cH;

    // Build SVG string (faster than DOM API for static chart)
    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" class="terrain-profile-svg" style="font-family:monospace">`);

    // Grid
    const altStep = _niceStep(dMaxA - dMinA, 3, 6);
    const distStep = _niceStep(maxD - minD, 3, 6);

    for (let a = Math.ceil(dMinA / altStep) * altStep; a <= dMaxA; a += altStep) {
      const y = sy(a);
      parts.push(`<line x1="${cfg.margin.left}" y1="${y}" x2="${cfg.margin.left + cW}" y2="${y}" stroke="${cfg.colors.grid}" stroke-dasharray="3,3"/>`);
      parts.push(`<text x="${cfg.margin.left - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="${cfg.colors.text}">${Math.round(a)}m</text>`);
    }
    for (let d = Math.ceil(minD / distStep) * distStep; d <= maxD; d += distStep) {
      const x = sx(d);
      parts.push(`<line x1="${x}" y1="${cfg.margin.top}" x2="${x}" y2="${cfg.margin.top + cH}" stroke="${cfg.colors.grid}" stroke-dasharray="3,3"/>`);
      parts.push(`<text x="${x}" y="${cfg.margin.top + cH + 14}" text-anchor="middle" font-size="9" fill="${cfg.colors.text}">${Math.round(d)}m</text>`);
    }

    // Axis labels
    parts.push(`<text x="${W / 2}" y="${H - 4}" text-anchor="middle" font-size="10" fill="${cfg.colors.axis}">Distance (m)</text>`);
    parts.push(`<text x="12" y="${H / 2}" text-anchor="middle" font-size="10" fill="${cfg.colors.axis}" transform="rotate(-90,12,${H / 2})">Alt (m)</text>`);

    // Terrain path
    const validData = data.filter(p => p.altitude != null);
    const pathD = cfg.smoothing && validData.length >= 3
      ? _smoothPath(validData, sx, sy)
      : validData.map((p, i) => `${i ? 'L' : 'M'}${sx(p.distance).toFixed(1)},${sy(p.altitude).toFixed(1)}`).join(' ');

    // Fill
    const lastX = sx(validData[validData.length - 1].distance);
    const firstX = sx(validData[0].distance);
    const bottomY = cfg.margin.top + cH;
    parts.push(`<path d="${pathD} L${lastX.toFixed(1)},${bottomY} L${firstX.toFixed(1)},${bottomY} Z" fill="${cfg.colors.terrainFill}"/>`);
    // Stroke
    parts.push(`<path d="${pathD}" fill="none" stroke="${cfg.colors.terrain}" stroke-width="1.8" stroke-linejoin="round"/>`);

    // Key data points (slope changes + first/last)
    const keyPts = _keyPoints(validData, 8);
    for (const idx of keyPts) {
      const p = validData[idx];
      const x = sx(p.distance), y = sy(p.altitude);
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${cfg.colors.point}"/>`);
      parts.push(`<text x="${x.toFixed(1)}" y="${(y - 7).toFixed(1)}" text-anchor="middle" font-size="8" fill="${cfg.colors.text}">${Math.round(p.altitude)}m</text>`);
    }

    // Title
    if (cfg.title) {
      parts.push(`<text x="${W / 2}" y="14" text-anchor="middle" font-size="12" font-weight="bold" fill="${cfg.colors.text}">${cfg.title}</text>`);
    }

    // Stats badge (compact)
    const denivele = Math.round(maxA - minA);
    const pente = maxD > 0 ? ((maxA - minA) / (maxD - minD) * 100).toFixed(1) : '0';
    parts.push(`<text x="${W - cfg.margin.right}" y="${cfg.margin.top - 6}" text-anchor="end" font-size="9" fill="${cfg.colors.axis}">Δ${denivele}m · ${pente}%</text>`);

    parts.push('</svg>');

    el.innerHTML = parts.join('');
    return el.querySelector('svg');
  },

  /**
   * Profil automatique N-S sur la parcelle via IGNElevationService.
   * @param {object} terrain - { lat, lng } centre parcelle
   * @param {HTMLElement|string} container
   * @param {object} opts
   * @returns {Promise<{svg: SVGElement, data: Array}>}
   */
  async autoProfile(terrain, container, opts = {}) {
    if (!terrain?.lat || !terrain?.lng) return null;
    const svc = window.IGNElevationService;
    if (!svc) { console.warn('[TerrainProfile] IGNElevationService non disponible'); return null; }

    const profile = await svc.getParcelProfile(terrain, opts.nPoints ?? 15);
    if (!profile?.length) return null;

    const data = profile.map(p => ({ distance: p.distance_m, altitude: p.altitude_m }));
    const svg = this.render(data, container, { title: opts.title ?? 'Profil N-S automatique', ...opts });
    return { svg, data, profile };
  },

  /**
   * Export SVG en tant que chaîne (pour PDF).
   * @param {SVGElement} svg
   * @returns {string}
   */
  toSVGString(svg) {
    if (!svg) return '';
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return new XMLSerializer().serializeToString(clone);
  },
};

// ── Helpers internes ────────────────────────────────────────────

function _niceStep(range, minLines, maxLines) {
  const minStep = range / maxLines;
  const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const power = Math.floor(Math.log10(minStep || 1));
  const factor = Math.pow(10, power);
  for (const n of nice) {
    const s = n * factor;
    if (s >= minStep && s <= range / minLines) return s;
  }
  return nice[0] * Math.pow(10, Math.ceil(Math.log10(minStep || 1)));
}

function _smoothPath(data, sx, sy) {
  let path = `M${sx(data[0].distance).toFixed(1)},${sy(data[0].altitude).toFixed(1)}`;
  for (let i = 0; i < data.length - 2; i++) {
    const x0 = sx(data[i].distance), y0 = sy(data[i].altitude);
    const x1 = sx(data[i + 1].distance), y1 = sy(data[i + 1].altitude);
    const x2 = sx(data[i + 2].distance);
    const cp1x = x0 + (x1 - x0) * 0.5;
    const cp2x = x2 - (x2 - x1) * 0.5;
    path += ` C${cp1x.toFixed(1)},${y1.toFixed(1)} ${cp2x.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  const last = data[data.length - 1];
  path += ` L${sx(last.distance).toFixed(1)},${sy(last.altitude).toFixed(1)}`;
  return path;
}

function _keyPoints(data, maxPts) {
  const pts = new Set([0, data.length - 1]);
  for (let i = 1; i < data.length - 1 && pts.size < maxPts; i++) {
    const prev = (data[i].altitude - data[i - 1].altitude) / (data[i].distance - data[i - 1].distance || 1);
    const next = (data[i + 1].altitude - data[i].altitude) / (data[i + 1].distance - data[i].distance || 1);
    if (Math.abs(prev - next) > 0.05) pts.add(i);
  }
  return [...pts].sort((a, b) => a - b);
}

export default TerrainProfile;
