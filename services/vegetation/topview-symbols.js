'use strict';
/**
 * TERLAB × BPF — TopViewSymbolService (port Vanilla JS ES2022+)
 * Source : bimshow-plant-factory-angular/src/app/services/topview-symbol.service.ts (534L)
 *
 * Génère des symboles SVG procéduraux top-view pour plans de masse paysagistes.
 *   CONTOUR : contour_wavy | contour_smooth | contour_jagged
 *   FILL    : fill_branching | fill_radial_needles | fill_radial_fronds
 *             | fill_leaf_masses | fill_crown_detail
 *
 * API globale :
 *   window.TopViewSymbols.generateSVG(style, cfg)
 *   window.TopViewSymbols.suggestStyle(dna)
 *   window.TopViewSymbols.generateForDNA(dna)
 *   window.generateForDNA(dna)   — raccourci compat ZIP terlab-vegetation
 *   window.suggestStyle(dna)     — raccourci compat
 */

(function () {

  const VB = 200;
  const CX = VB / 2;
  const CY = VB / 2;

  const COLORS = {
    outlineStroke: '#2a3a1a',
    outlineFill:   'none',
    fillStroke:    '#3a4a2a',
    fillFill:      '#e8f0e0',
  };

  const STROKE_OUTLINE = 1.5;
  const STROKE_DETAIL  = 0.8;

  // ── Seeded PRNG ────────────────────────────────────────────────────────────
  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let s = seed | 0;
    return () => {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rng(config) {
    const seed = config.seed != null
      ? config.seed
      : typeof config.speciesKey === 'string'
        ? hashString(config.speciesKey)
        : 42;
    return mulberry32(seed);
  }

  // ── SVG helpers ────────────────────────────────────────────────────────────
  function n(v) { return Math.round(v * 100) / 100; }

  function closedPath(pts) {
    if (pts.length === 0) return '';
    const [x0, y0] = pts[0];
    let d = `M${n(x0)},${n(y0)}`;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0];
      const dy = pts[i][1] - pts[i - 1][1];
      d += ` l${n(dx)},${n(dy)}`;
    }
    return d + 'Z';
  }

  function smoothClosedPath(pts) {
    const len = pts.length;
    if (len < 3) return closedPath(pts);
    const tension = 0.35;
    let d = `M${n(pts[0][0])},${n(pts[0][1])}`;
    for (let i = 0; i < len; i++) {
      const p0 = pts[(i - 1 + len) % len];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % len];
      const p3 = pts[(i + 2) % len];
      const cp1x = p1[0] + (p2[0] - p0[0]) * tension;
      const cp1y = p1[1] + (p2[1] - p0[1]) * tension;
      const cp2x = p2[0] - (p3[0] - p1[0]) * tension;
      const cp2y = p2[1] - (p3[1] - p1[1]) * tension;
      d += ` C${n(cp1x)},${n(cp1y)} ${n(cp2x)},${n(cp2y)} ${n(p2[0])},${n(p2[1])}`;
    }
    return d + 'Z';
  }

  function polarOutline(cx, cy, radius, segments, rand, modFn) {
    const pts = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const r = modFn(angle, i, rand);
      pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
    }
    return pts;
  }

  function wrap(inner) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}" width="${VB}" height="${VB}">\n${inner}\n</svg>`;
  }

  function outlineSvg(config, rand) {
    const radius = config.radius || 70;
    const segments = 24;
    const phase = rand() * Math.PI * 2;
    const amp = 0.08 + rand() * 0.06;
    const pts = polarOutline(CX, CY, radius, segments, rand, (angle) => {
      let r = radius;
      r += Math.sin(angle * 3 + phase) * amp * radius;
      r += (rand() - 0.5) * radius * 0.03;
      return r;
    });
    const d = smoothClosedPath(pts);
    return `<path d="${d}" fill="${config.fill || COLORS.fillFill}" stroke="${config.stroke || COLORS.fillStroke}" stroke-width="${STROKE_OUTLINE}" stroke-linejoin="round"/>`;
  }

  // ── CONTOUR generators ─────────────────────────────────────────────────────
  function contour_wavy(config = {}) {
    const { radius = 70, segments = 18, amplitude = 0.15, harmonics = 3,
      stroke = COLORS.outlineStroke, fill = COLORS.outlineFill } = config;
    const rand = rng(config);
    const phases = [];
    const amps = [];
    for (let h = 0; h < harmonics; h++) {
      phases.push(rand() * Math.PI * 2);
      amps.push((rand() * 0.5 + 0.5) * amplitude / (h + 1));
    }
    const pts = polarOutline(CX, CY, radius, segments, rand, (angle) => {
      let r = radius;
      for (let h = 0; h < harmonics; h++) {
        r += Math.sin(angle * (h + 2) + phases[h]) * amps[h] * radius;
      }
      r += (rand() - 0.5) * radius * amplitude * 0.3;
      return Math.max(r, radius * 0.4);
    });
    const d = smoothClosedPath(pts);
    return wrap(`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${STROKE_OUTLINE}" stroke-linejoin="round"/>`);
  }

  function contour_smooth(config = {}) {
    const { radius = 70, lobes = 4, stroke = COLORS.outlineStroke, fill = COLORS.outlineFill } = config;
    const rand = rng(config);
    const segments = Math.max(lobes * 6, 24);
    const phase1 = rand() * Math.PI * 2;
    const phase2 = rand() * Math.PI * 2;
    const amp1 = 0.12 + rand() * 0.08;
    const amp2 = 0.05 + rand() * 0.04;
    const pts = polarOutline(CX, CY, radius, segments, rand, (angle) => {
      let r = radius;
      r += Math.sin(angle * lobes + phase1) * amp1 * radius;
      r += Math.sin(angle * (lobes * 2 + 1) + phase2) * amp2 * radius;
      r += (rand() - 0.5) * radius * 0.02;
      return Math.max(r, radius * 0.5);
    });
    const d = smoothClosedPath(pts);
    return wrap(`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${STROKE_OUTLINE}" stroke-linejoin="round"/>`);
  }

  function contour_jagged(config = {}) {
    const { radius = 70, jags = 12, depth = 0.2,
      stroke = COLORS.outlineStroke, fill = COLORS.outlineFill } = config;
    const rand = rng(config);
    const segments = jags * 2;
    const pts = polarOutline(CX, CY, radius, segments, rand, (_angle, i) => {
      const isOuter = i % 2 === 0;
      const variation = (rand() - 0.5) * 0.15;
      return isOuter ? radius * (1 + variation) : radius * (1 - depth + variation * 0.5);
    });
    const d = closedPath(pts);
    return wrap(`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${STROKE_OUTLINE}" stroke-linejoin="round"/>`);
  }

  // ── FILL generators ────────────────────────────────────────────────────────
  function fill_branching(config = {}) {
    const { radius = 70, mainBranches = 7, levels = 2, spread = 0.5,
      outline = true, stroke = COLORS.fillStroke, fill = COLORS.fillFill } = config;
    const rand = rng(config);
    let svg = '';
    if (outline) svg += outlineSvg({ radius, stroke, fill }, rng(config));
    const lines = [];

    function branch(x, y, angle, length, level) {
      const ex = x + Math.cos(angle) * length;
      const ey = y + Math.sin(angle) * length;
      lines.push(`M${n(x)},${n(y)} L${n(ex)},${n(ey)}`);
      if (level < levels) {
        const subCount = 2 + Math.floor(rand() * 2);
        const subLen = length * (0.45 + rand() * 0.2);
        for (let s = 0; s < subCount; s++) {
          branch(ex, ey, angle + (rand() - 0.5) * Math.PI * spread, subLen, level + 1);
        }
      }
    }

    for (let i = 0; i < mainBranches; i++) {
      const angle = (i / mainBranches) * Math.PI * 2 + (rand() - 0.5) * 0.3;
      branch(CX, CY, angle, radius * (0.5 + rand() * 0.35), 0);
    }
    svg += `\n<circle cx="${CX}" cy="${CY}" r="3" fill="${stroke}" stroke="none"/>`;
    svg += `\n<path d="${lines.join(' ')}" fill="none" stroke="${stroke}" stroke-width="${STROKE_DETAIL}" stroke-linecap="round"/>`;
    return wrap(svg);
  }

  function fill_radial_needles(config = {}) {
    const { radius = 70, count = 45, lengthVariation = 0.3,
      outline = true, stroke = COLORS.fillStroke, fill = COLORS.fillFill } = config;
    const rand = rng(config);
    let svg = '';
    if (outline) svg += outlineSvg({ radius, stroke, fill }, rng(config));
    const lines = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.15;
      const innerR = radius * (0.05 + rand() * 0.1);
      const outerR = radius * (1 - rand() * lengthVariation);
      lines.push(`M${n(CX + Math.cos(angle) * innerR)},${n(CY + Math.sin(angle) * innerR)} L${n(CX + Math.cos(angle) * outerR)},${n(CY + Math.sin(angle) * outerR)}`);
    }
    svg += `\n<circle cx="${CX}" cy="${CY}" r="2.5" fill="${stroke}" stroke="none"/>`;
    svg += `\n<path d="${lines.join(' ')}" fill="none" stroke="${stroke}" stroke-width="${STROKE_DETAIL * 0.6}" stroke-linecap="round" opacity="0.7"/>`;
    return wrap(svg);
  }

  function fill_radial_fronds(config = {}) {
    const { radius = 70, fronds = 8, gapRatio = 0.35,
      outline = true, stroke = COLORS.fillStroke, fill = COLORS.fillFill } = config;
    const rand = rng(config);
    let svg = '';
    if (outline) svg += outlineSvg({ radius, stroke, fill }, rng(config));
    const arcPerFrond = (Math.PI * 2) / fronds;
    const frondArc = arcPerFrond * (1 - gapRatio);

    for (let i = 0; i < fronds; i++) {
      const startAngle = (i / fronds) * Math.PI * 2 + (rand() - 0.5) * 0.1;
      const endAngle = startAngle + frondArc;
      const frondR = radius * (0.75 + rand() * 0.2);
      const midR = frondR * 0.55;
      const innerR = 6;
      const midAngle = (startAngle + endAngle) / 2;
      const x0 = CX + Math.cos(midAngle) * innerR;
      const y0 = CY + Math.sin(midAngle) * innerR;
      const tipL = [CX + Math.cos(startAngle) * frondR, CY + Math.sin(startAngle) * frondR];
      const tipR = [CX + Math.cos(endAngle) * frondR, CY + Math.sin(endAngle) * frondR];
      const tipM = [CX + Math.cos(midAngle) * frondR, CY + Math.sin(midAngle) * frondR];
      const ctrlL = [CX + Math.cos(startAngle + frondArc * 0.15) * midR, CY + Math.sin(startAngle + frondArc * 0.15) * midR];
      const ctrlR = [CX + Math.cos(endAngle - frondArc * 0.15) * midR, CY + Math.sin(endAngle - frondArc * 0.15) * midR];

      const d = `M${n(x0)},${n(y0)} Q${n(ctrlL[0])},${n(ctrlL[1])} ${n(tipL[0])},${n(tipL[1])} L${n(tipM[0])},${n(tipM[1])} L${n(tipR[0])},${n(tipR[1])} Q${n(ctrlR[0])},${n(ctrlR[1])} ${n(x0)},${n(y0)}Z`;
      svg += `\n<path d="${d}" fill="${stroke}" fill-opacity="0.18" stroke="${stroke}" stroke-width="${STROKE_DETAIL}" stroke-linejoin="round"/>`;
      svg += `\n<line x1="${n(x0)}" y1="${n(y0)}" x2="${n(tipM[0])}" y2="${n(tipM[1])}" stroke="${stroke}" stroke-width="${STROKE_DETAIL}" stroke-linecap="round"/>`;
    }
    svg += `\n<circle cx="${CX}" cy="${CY}" r="4" fill="${stroke}" stroke="none"/>`;
    return wrap(svg);
  }

  function fill_leaf_masses(config = {}) {
    const { radius = 70, blobCount = 35, blobSize = 0.18,
      outline = true, stroke = COLORS.fillStroke, fill = COLORS.fillFill } = config;
    const rand = rng(config);
    let svg = '';
    if (outline) svg += outlineSvg({ radius, stroke, fill }, rng(config));
    const blobs = [];
    let attempts = 0;
    while (blobs.length < blobCount && attempts < blobCount * 5) {
      attempts++;
      const angle = rand() * Math.PI * 2;
      const dist = Math.sqrt(rand()) * radius * 0.9;
      blobs.push([CX + Math.cos(angle) * dist, CY + Math.sin(angle) * dist, radius * blobSize * (0.5 + rand() * 0.7)]);
    }
    for (const [bx, by, br] of blobs) {
      const rx = br * (0.8 + rand() * 0.4);
      const ry = br * (0.8 + rand() * 0.4);
      const rot = rand() * 360;
      svg += `\n<ellipse cx="${n(bx)}" cy="${n(by)}" rx="${n(rx)}" ry="${n(ry)}" transform="rotate(${n(rot)},${n(bx)},${n(by)})" fill="${stroke}" fill-opacity="0.12" stroke="${stroke}" stroke-width="${STROKE_DETAIL * 0.5}"/>`;
    }
    svg += `\n<circle cx="${CX}" cy="${CY}" r="2" fill="${stroke}" stroke="none"/>`;
    return wrap(svg);
  }

  function fill_crown_detail(config = {}) {
    const { radius = 70, branches = 6, clusterSize = 8,
      outline = true, stroke = COLORS.fillStroke, fill = COLORS.fillFill } = config;
    const rand = rng(config);
    let svg = '';
    if (outline) svg += outlineSvg({ radius, stroke, fill }, rng(config));
    const lines = [];
    const clusters = [];

    function addBranch(x, y, angle, length, level) {
      const ex = x + Math.cos(angle) * length;
      const ey = y + Math.sin(angle) * length;
      lines.push(`M${n(x)},${n(y)} L${n(ex)},${n(ey)}`);
      if (level >= 2) {
        clusters.push([ex, ey, clusterSize * (0.7 + rand() * 0.6)]);
      } else {
        const cnt = 2 + Math.floor(rand() * 2);
        const subLen = length * (0.4 + rand() * 0.2);
        for (let s = 0; s < cnt; s++) {
          addBranch(ex, ey, angle + (rand() - 0.5) * Math.PI * 0.6, subLen, level + 1);
        }
      }
    }

    for (let i = 0; i < branches; i++) {
      const angle = (i / branches) * Math.PI * 2 + (rand() - 0.5) * 0.3;
      addBranch(CX, CY, angle, radius * (0.4 + rand() * 0.25), 0);
    }

    svg += `\n<path d="${lines.join(' ')}" fill="none" stroke="${stroke}" stroke-width="${STROKE_DETAIL}" stroke-linecap="round"/>`;
    for (const [cx, cy, cr] of clusters) {
      const nPts = 8;
      const pts = [];
      for (let j = 0; j < nPts; j++) {
        const a = (j / nPts) * Math.PI * 2;
        pts.push([cx + Math.cos(a) * cr * (0.75 + rand() * 0.5), cy + Math.sin(a) * cr * (0.75 + rand() * 0.5)]);
      }
      svg += `\n<path d="${smoothClosedPath(pts)}" fill="${stroke}" fill-opacity="0.15" stroke="${stroke}" stroke-width="${STROKE_DETAIL * 0.6}"/>`;
    }
    svg += `\n<circle cx="${CX}" cy="${CY}" r="3" fill="${stroke}" stroke="none"/>`;
    return wrap(svg);
  }

  const GENERATORS = {
    contour_wavy, contour_smooth, contour_jagged,
    fill_branching, fill_radial_needles, fill_radial_fronds, fill_leaf_masses, fill_crown_detail,
  };

  const svgCache = new Map();

  function generateSVG(styleName, config = {}) {
    const fn = GENERATORS[styleName];
    if (!fn) throw new Error(`Unknown top-view symbol style: "${styleName}"`);
    return fn(config);
  }

  function suggestStyle(dna) {
    const cs  = (dna.crownShape   || 'spherical').toLowerCase();
    const gf  = (dna.growthForm   || 'tree').toLowerCase();
    const fs  = (dna.foliageStyle || '').toLowerCase();
    const cat = (dna.category     || '').toLowerCase();

    if (dna.isPalm || cs === 'palm_crown' || gf === 'palm')
      return { outline: 'contour_smooth', fill: 'fill_radial_fronds' };
    if (cs === 'conical' || cs === 'pyramidal' || fs === 'strip' || cat === 'conifer' || cat === 'boreal')
      return { outline: 'contour_smooth', fill: 'fill_radial_needles' };
    if (cs === 'weeping')
      return { outline: 'contour_smooth', fill: 'fill_leaf_masses' };
    if (cs === 'columnar')
      return { outline: 'contour_smooth', fill: 'fill_branching' };
    if (cs === 'umbrella' || cs === 'spreading')
      return { outline: 'contour_wavy', fill: 'fill_crown_detail' };
    if (gf === 'rosette' || gf === 'cactus')
      return { outline: 'contour_smooth', fill: 'fill_leaf_masses' };
    if (cs === 'irregular' || cat === 'broadleaf')
      return { outline: 'contour_jagged', fill: 'fill_crown_detail' };
    if (cat === 'tropical' || cat === 'mediterranean')
      return { outline: 'contour_wavy', fill: 'fill_leaf_masses' };

    return { outline: 'contour_wavy', fill: 'fill_branching' };
  }

  function generateForDNA(dna) {
    const key = dna.speciesKey || 'default';
    const cacheKey = `${key}:${dna.color2D || ''}:${dna.seed || ''}`;
    const cached = svgCache.get(cacheKey);
    if (cached) return cached;

    const style = suggestStyle(dna);
    const cfg = { speciesKey: key, seed: dna.seed };
    if (dna.color2D) {
      cfg.fill   = dna.color2D;
      cfg.stroke = shade(dna.color2D, -0.35);
    }
    const svg = generateSVG(style.fill, Object.assign({}, cfg, { outline: true }));
    svgCache.set(cacheKey, svg);
    return svg;
  }

  function clearCache() { svgCache.clear(); }

  // ── Shade hex color by pct (-1..1) ────────────────────────────────────────
  function shade(hex, pct) {
    const h = hex.replace('#', '');
    if (h.length !== 6) return hex;
    const r = parseInt(h.substr(0, 2), 16);
    const g = parseInt(h.substr(2, 2), 16);
    const b = parseInt(h.substr(4, 2), 16);
    const mix = pct < 0 ? 0 : 255;
    const t = Math.abs(pct);
    const nr = Math.round(r + (mix - r) * t);
    const ng = Math.round(g + (mix - g) * t);
    const nb = Math.round(b + (mix - b) * t);
    return '#' + [nr, ng, nb].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  const api = { generateSVG, suggestStyle, generateForDNA, clearCache, hashString };
  window.TopViewSymbols = api;
  // Raccourcis compat ZIP
  window.generateForDNA = generateForDNA;
  window.suggestStyle   = suggestStyle;
})();
