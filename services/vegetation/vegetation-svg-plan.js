'use strict';
/**
 * TERLAB × BPF — VegetationSVGPlan service
 * Rendu calque SVG différentiel plan masse P11 (keep / cut / new)
 * Port Vanilla JS de terlab-vegetation/services/vegetation-svg-plan.service.ts
 */

import VegetationSpecies from './vegetation-species.js';

const DEFAULT_PLAN = {
  scale: 10, originX: 0, originY: 0,
  theme: 'dark', showLabels: true,
  showDistanceRings: false, showLegend: true, showStatsPanel: true,
};

const THEMES = {
  dark:  { bg: 'none', keep: '#4a7a2c', cut: '#e05030', newCol: '#4ca870', text: '#c9a84c', warn: '#d4902c', sub: '#7a6040' },
  ivory: { bg: 'none', keep: '#2a6020', cut: '#c03018', newCol: '#2a8850', text: '#7a5810', warn: '#b07020', sub: '#9a8060' },
  earth: { bg: 'none', keep: '#5a9848', cut: '#d06040', newCol: '#5a9858', text: '#d4902c', warn: '#d08040', sub: '#706040' },
};

function n(v) { return String(Math.round(v * 100) / 100); }

const VegetationSVGPlan = {

  render(state, config = {}) {
    if (!state || !state.features) return '<g id="vegetation-layer"></g>';
    const cfg = Object.assign({}, DEFAULT_PLAN, config);
    const theme = THEMES[cfg.theme] || THEMES.dark;
    const SC = cfg.scale;

    const defs = this._buildDefs(state);
    let soilRings = '';
    let trees = '';
    let newTrees = '';

    for (const f of state.features) {
      if (!f.positionLocal) continue;
      const sp = f.speciesKey ? VegetationSpecies.get(f.speciesKey) : null;
      const { x, y } = f.positionLocal;
      const cx = cfg.originX + x * SC;
      const cy = cfg.originY - y * SC;
      const r = Math.max(2, f.canopyRadiusMeasured * SC);

      if (f.status === 'existing_cut') {
        trees += `<g class="veg-cut" opacity="0.45">
          <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${theme.cut}15" stroke="${theme.cut}" stroke-width="1.2"/>
          <line x1="${n(cx-r*.65)}" y1="${n(cy-r*.65)}" x2="${n(cx+r*.65)}" y2="${n(cy+r*.65)}" stroke="${theme.cut}" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="${n(cx+r*.65)}" y1="${n(cy-r*.65)}" x2="${n(cx-r*.65)}" y2="${n(cy+r*.65)}" stroke="${theme.cut}" stroke-width="1.5" stroke-linecap="round"/>
        </g>`;
        continue;
      }

      if (sp) {
        const rSoil = r * 1.3;
        soilRings += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(rSoil)}" fill="${sp.color2D}08" stroke="${sp.color2D}18" stroke-width="0.5" stroke-dasharray="4,4"/>`;
      }

      if (f.status === 'existing_keep' && sp) {
        const sz = r * 2;
        trees += `<use href="#veg-sym-${f.speciesKey}" x="${n(cx-r)}" y="${n(cy-r)}" width="${n(sz)}" height="${n(sz)}" class="veg-keep"/>`;
        trees += `<ellipse cx="${n(cx + r*.25)}" cy="${n(cy + r*.2)}" rx="${n(r*.9)}" ry="${n(r*.55)}" fill="rgba(0,0,0,0.12)" class="veg-shadow" style="pointer-events:none"/>`;
        if (cfg.showDistanceRings && sp.distanceFoundation_m > 0) {
          const rDist = sp.distanceFoundation_m * SC;
          trees += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(rDist)}" fill="none" stroke="${theme.warn}" stroke-width="0.6" stroke-dasharray="3,3" opacity="0.5"/>`;
        }
      } else if (f.status && f.status.startsWith('new')) {
        const isValidated = f.status === 'new_validated';
        const strokeW = isValidated ? 1.8 : 1.2;
        const dashArr = isValidated ? '1,0' : '5,4';
        const opacity = isValidated ? 1 : 0.75;
        if (sp) {
          const sz = r * 2;
          newTrees += `<use href="#veg-sym-${f.speciesKey}" x="${n(cx-r)}" y="${n(cy-r)}" width="${n(sz)}" height="${n(sz)}" opacity="${opacity}"/>`;
        } else {
          newTrees += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${theme.newCol}18" opacity="${opacity}"/>`;
        }
        newTrees += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke="${theme.newCol}" stroke-width="${strokeW}" stroke-dasharray="${dashArr}" opacity="${opacity}"/>`;
        newTrees += `<circle cx="${n(cx)}" cy="${n(cy)}" r="3" fill="${theme.newCol}" opacity="${opacity * 0.8}"/>`;
      }
    }

    const labels = cfg.showLabels ? this._renderLabels(state, cfg, SC, theme) : '';
    const legend = cfg.showLegend  ? this._renderLegend(state, cfg, theme)   : '';
    const stats  = cfg.showStatsPanel ? this._renderStats(state, cfg, theme) : '';

    return `<g id="vegetation-layer" class="terlab-veg-layer">
  <defs>${defs}</defs>
  <g id="veg-soil">${soilRings}</g>
  <g id="veg-trees">${trees}</g>
  <g id="veg-new">${newTrees}</g>
  <g id="veg-labels">${labels}</g>
  ${legend}
  ${stats}
</g>`;
  },

  _buildDefs(state) {
    const keys = Array.from(new Set(state.features.map(f => f.speciesKey).filter(Boolean)));
    let defs = '';
    for (const key of keys) {
      const sp = VegetationSpecies.get(key);
      if (!sp) continue;
      let inner = '';
      try {
        const fullSVG = (window.TopViewSymbols && window.TopViewSymbols.generateForDNA)
          ? window.TopViewSymbols.generateForDNA({
              speciesKey: key, isPalm: sp.isPalm,
              crownShape: sp.crownShape, growthForm: sp.growthForm,
              category: sp.category, color2D: sp.color2D,
            })
          : '';
        inner = fullSVG.replace(/<svg[^>]*>/, '').replace('</svg>', '').trim();
      } catch {
        inner = `<circle cx="100" cy="100" r="90" fill="${sp.color2D}22" stroke="${sp.color2D}" stroke-width="2"/>`;
      }
      if (!inner) inner = `<circle cx="100" cy="100" r="90" fill="${sp.color2D}22" stroke="${sp.color2D}" stroke-width="2"/>`;
      defs += `<symbol id="veg-sym-${key}" viewBox="0 0 200 200">${inner}</symbol>`;
    }
    return defs;
  },

  _renderLabels(state, cfg, SC, theme) {
    let out = '';
    const fontSize = Math.max(7, Math.min(11, SC * 0.9));
    for (const f of state.features) {
      if (!f.positionLocal || f.status === 'existing_cut') continue;
      const sp = f.speciesKey ? VegetationSpecies.get(f.speciesKey) : null;
      if (!sp) continue;
      const { x, y } = f.positionLocal;
      const cx = cfg.originX + x * SC;
      const cy = cfg.originY - y * SC - f.canopyRadiusMeasured * SC - 4;
      const col = f.status && f.status.startsWith('new') ? theme.newCol : theme.keep;
      out += `<text x="${n(cx)}" y="${n(cy)}" text-anchor="middle" font-family="Inconsolata,monospace" font-size="${fontSize}px" fill="${col}">${sp.commonName}</text>`;
    }
    return out;
  },

  _renderLegend(state, cfg, theme) {
    const s = state.stats || { totalKeep: 0, totalCut: 0, totalNew: 0 };
    const x0 = cfg.originX + 10, y0 = cfg.originY + 20;
    const items = [
      { col: theme.keep,   dash: '',    label: `Conservé (${s.totalKeep})` },
      { col: theme.cut,    dash: '',    label: `Abattu (${s.totalCut})`, x: true },
      { col: theme.newCol, dash: '5,4', label: `Nouveau (${s.totalNew})` },
    ];
    let out = `<g id="veg-legend" transform="translate(${n(x0)},${n(y0)})">
      <rect x="-6" y="-16" width="160" height="${8 + items.length*18}" fill="rgba(14,12,8,0.7)" rx="3"/>`;
    items.forEach((item, i) => {
      const yi = i * 18;
      out += `<circle cx="0" cy="${yi}" r="6" fill="${item.col}22" stroke="${item.col}" stroke-width="${item.dash?1.5:1}" stroke-dasharray="${item.dash}"/>`;
      if (item.x) out += `<text x="0" y="${yi+4}" text-anchor="middle" font-size="8" fill="${item.col}">✕</text>`;
      out += `<text x="14" y="${yi+4}" font-family="Inconsolata,monospace" font-size="9" fill="${theme.text}">${item.label}</text>`;
    });
    return out + '</g>';
  },

  _renderStats(state, cfg, theme) {
    const s = state.stats;
    if (!s) return '';
    const x0 = cfg.originX + 10, y0 = cfg.originY + 100;
    const rows = [
      ['Canopée avant', `${s.canopyCoverBefore_m2} m²`],
      ['Canopée après', `${s.canopyCoverAfter_m2} m²`],
      ['Variation',     `${s.canopyCoverDelta_pct > 0 ? '+' : ''}${s.canopyCoverDelta_pct}%`],
      ['Espèces après', `${s.speciesCountAfter}`],
      ['Endémiques',    `${s.endemicCountAfter}`],
    ];
    let out = `<g id="veg-stats" transform="translate(${n(x0)},${n(y0)})">
      <rect x="-6" y="-16" width="160" height="${8 + rows.length*16}" fill="rgba(14,12,8,0.7)" rx="3"/>`;
    rows.forEach(([label, val], i) => {
      const yi = i * 16;
      out += `<text x="0" y="${yi}" font-family="Inconsolata,monospace" font-size="8" fill="${theme.sub}">${label}</text>`;
      out += `<text x="155" y="${yi}" text-anchor="end" font-family="Inconsolata,monospace" font-size="8" font-weight="700" fill="${theme.text}">${val}</text>`;
    });
    return out + '</g>';
  },
};

export default VegetationSVGPlan;

if (typeof window !== 'undefined') {
  window.VegetationSVGPlan = VegetationSVGPlan;
}
