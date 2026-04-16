// terlab/components/metaforme-renderer.js
// MetaformeRenderer — Rendu SVG pour un MetaformeEngine
// Extrait de terlab_metaforme_v3.html render() lignes 1050-1425
// ENSA La Réunion · MGA Architecture 2026
//
// Usage :
//   import { createEngine } from './metaforme-engine.js';
//   import { createRenderer } from './metaforme-renderer.js';
//   const eng = createEngine({ initialPolys: [...] });
//   const rnd = createRenderer(svgEl, eng, { viewW: 300, viewH: 260 });
//   rnd.render();   // appeler après chaque mutation du state

import {
  buildPath, pathToPolyline, computeOffsetRoundPath, computeOffset,
  polyArea, isConcave, arcPeakPos, detectSharedWalls,
} from './metaforme-engine.js';

// Palette — copie fidèle de terlab_metaforme_v3.html lignes 523-528
export const COLORS = {
  bg: '#13100a', gold: '#c9a84c', ok: '#4ca870', err: '#e05030',
  blue: '#5090d8', violet: '#a060d8', warn: '#d4902c', orange: '#f97316',
  para:     'rgba(76,168,112,0.6)',
  perp:     'rgba(80,144,216,0.6)',
  cardinal: 'rgba(212,144,44,0.5)',
};

export const POLY_COLORS = [COLORS.gold, '#5090d8', '#a060d8', '#d4902c', '#4ca870'];

const NS = 'http://www.w3.org/2000/svg';

// SVG element factory (équivalent _e() du v3)
function svgEl(svg, tag, attrs = {}, parent = null) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === '_text') el.textContent = v;
    else if (v != null) el.setAttribute(k, v);
  }
  (parent || svg).appendChild(el);
  return el;
}

// ═════════════════════════════════════════════════════════════════
// RENDERER
// ═════════════════════════════════════════════════════════════════

export function createRenderer(svg, engine, opts = {}) {
  const viewW = opts.viewW ?? 300;
  const viewH = opts.viewH ?? 260;
  const drawGrid = opts.drawGrid ?? true;
  const drawSharedWalls = opts.drawSharedWalls ?? true;
  const drawRotateHandle = opts.drawRotateHandle ?? true;

  const e = (tag, attrs, parent) => svgEl(svg, tag, attrs, parent);

  // ── Grille de fond ───────────────────────────────────────────
  function _renderGrid() {
    if (!drawGrid) return;
    const g = e('g', { 'pointer-events': 'none', opacity: '0.06' });
    const step = engine.GRID;
    for (let x = 0; x < viewW; x += step) {
      e('line', { x1: x, y1: 0, x2: x, y2: viewH, stroke: COLORS.gold, 'stroke-width': '0.3' }, g);
    }
    for (let y = 0; y < viewH; y += step) {
      e('line', { x1: 0, y1: y, x2: viewW, y2: y, stroke: COLORS.gold, 'stroke-width': '0.3' }, g);
    }
  }

  // ── Pill hover sur arête (orange dashed + flèches ⊥) ────────
  function _drawEdgePill(idx) {
    const poly = engine.ap();
    if (!poly) return;
    const { verts, edges } = poly;
    const n = verts.length;
    const [x1, y1] = verts[idx], [x2, y2] = verts[(idx + 1) % n];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 0.1) return;
    const vx = dx / len, vy = dy / len, px = -vy, py = vx;
    const r = 12;
    const c1x = x1 + px * r, c1y = y1 + py * r;
    const c2x = x2 + px * r, c2y = y2 + py * r;
    const c3x = x2 - px * r, c3y = y2 - py * r;
    const c4x = x1 - px * r, c4y = y1 - py * r;
    const d = [
      `M ${c1x.toFixed(1)},${c1y.toFixed(1)}`,
      `L ${c2x.toFixed(1)},${c2y.toFixed(1)}`,
      `A ${r} ${r} 0 0 1 ${c3x.toFixed(1)},${c3y.toFixed(1)}`,
      `L ${c4x.toFixed(1)},${c4y.toFixed(1)}`,
      `A ${r} ${r} 0 0 1 ${c1x.toFixed(1)},${c1y.toFixed(1)} Z`,
    ].join(' ');
    e('path', {
      d, fill: 'rgba(249,115,22,0.09)', stroke: 'rgba(249,115,22,0.55)',
      'stroke-width': '1.5', 'stroke-dasharray': '5,4', 'pointer-events': 'none',
    });
    for (const [nx, ny] of [[x1, y1], [x2, y2]]) {
      e('circle', {
        cx: nx.toFixed(1), cy: ny.toFixed(1), r: '7',
        fill: 'rgba(249,115,22,0.20)', stroke: '#f97316',
        'stroke-width': '1.5', 'pointer-events': 'none',
      });
    }
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, ARR = 10;
    for (const sign of [1, -1]) {
      const tx = mx + px * ARR * sign, ty = my + py * ARR * sign;
      e('line', {
        x1: mx.toFixed(1), y1: my.toFixed(1), x2: tx.toFixed(1), y2: ty.toFixed(1),
        stroke: 'rgba(249,115,22,0.80)', 'stroke-width': '1.2', 'pointer-events': 'none',
      });
      e('polygon', {
        points: `${tx.toFixed(1)},${ty.toFixed(1)} ${(tx - px * 3 - py * 2).toFixed(1)},${(ty - py * 3 + px * 2).toFixed(1)} ${(tx - px * 3 + py * 2).toFixed(1)},${(ty - py * 3 - px * 2).toFixed(1)}`,
        fill: 'rgba(249,115,22,0.80)', 'pointer-events': 'none',
      });
    }
    const eType = (edges[idx] || {}).type || 'line';
    const label = eType === 'arc' ? '⌒ arc' : eType === 'bezier' ? '∿ bézier' : 'drag ⊥';
    e('text', {
      x: (mx + px * 16).toFixed(1), y: (my + py * 16).toFixed(1),
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-family': 'Inconsolata,monospace', 'font-size': '8',
      fill: 'rgba(249,115,22,0.80)', 'pointer-events': 'none',
      _text: label,
    });
  }

  // ── Crossing marker (✕ rouge + badge Split) ─────────────────
  function _renderCrossingMarker() {
    const c = engine.state._crossing;
    if (!c) return;
    const { P } = c;
    e('circle', {
      cx: P[0].toFixed(1), cy: P[1].toFixed(1), r: '14',
      fill: 'rgba(224,80,48,0.18)', stroke: 'rgba(224,80,48,0.7)',
      'stroke-width': '1.5', 'stroke-dasharray': '4,3', 'pointer-events': 'none',
    });
    const xW = 7;
    e('line', {
      x1: (P[0] - xW).toFixed(1), y1: (P[1] - xW).toFixed(1),
      x2: (P[0] + xW).toFixed(1), y2: (P[1] + xW).toFixed(1),
      stroke: COLORS.err, 'stroke-width': '2.5', 'stroke-linecap': 'round', 'pointer-events': 'none',
    });
    e('line', {
      x1: (P[0] + xW).toFixed(1), y1: (P[1] - xW).toFixed(1),
      x2: (P[0] - xW).toFixed(1), y2: (P[1] + xW).toFixed(1),
      stroke: COLORS.err, 'stroke-width': '2.5', 'stroke-linecap': 'round', 'pointer-events': 'none',
    });
    e('text', {
      x: (P[0] + 18).toFixed(1), y: (P[1] - 10).toFixed(1),
      'font-family': 'Inconsolata,monospace', 'font-size': '8',
      fill: COLORS.err, 'pointer-events': 'none',
      _text: '↯ Split',
    });
  }

  // ── Parois partagées entre polygones (mitoyennetés) ─────────
  function _renderSharedWalls() {
    if (!drawSharedWalls || engine.state.polys.length < 2) return 0;
    const walls = detectSharedWalls(engine.state.polys);
    walls.forEach(w => {
      e('line', {
        x1: w.x1.toFixed(1), y1: w.y1.toFixed(1),
        x2: w.x2.toFixed(1), y2: w.y2.toFixed(1),
        stroke: 'rgba(212,144,44,0.9)', 'stroke-width': '2.5',
        'stroke-linecap': 'round', 'pointer-events': 'none',
      });
      const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
      e('circle', {
        cx: mx.toFixed(1), cy: my.toFixed(1), r: '3.5',
        fill: 'rgba(212,144,44,0.9)', 'pointer-events': 'none',
      });
    });
    return walls.length;
  }

  // ── Snap inter-poly indicator ───────────────────────────────
  function _renderSnapTarget() {
    const s = engine.state._snapTarget;
    if (!s) return;
    e('circle', {
      cx: s.x.toFixed(1), cy: s.y.toFixed(1), r: '10',
      fill: 'rgba(212,144,44,0.15)', stroke: 'rgba(212,144,44,0.9)',
      'stroke-width': '1.5', 'stroke-dasharray': '3,2', 'pointer-events': 'none',
    });
  }

  // ── Handles pour un polygone actif ──────────────────────────
  function _renderActiveHandles(poly, pi, col) {
    const { verts, edges } = poly;
    const n = verts.length;
    const state = engine.state;

    // Bras Bézier (lignes pointillées sommet → CP)
    edges.forEach((edge, i) => {
      if (edge.type === 'bezier' && edge.cp1 && edge.cp2) {
        const j = (i + 1) % n;
        e('line', {
          x1: verts[i][0], y1: verts[i][1], x2: edge.cp1[0], y2: edge.cp1[1],
          stroke: `${COLORS.violet}80`, 'stroke-width': '0.8', 'stroke-dasharray': '3,2', 'pointer-events': 'none',
        });
        e('line', {
          x1: verts[j][0], y1: verts[j][1], x2: edge.cp2[0], y2: edge.cp2[1],
          stroke: `${COLORS.violet}80`, 'stroke-width': '0.8', 'stroke-dasharray': '3,2', 'pointer-events': 'none',
        });
      }
    });

    // Pill hover sur arête (masqué si Shift ou pendant drag)
    if (state._hoverEdge !== null && !state.drag && !state._shiftHeld) {
      _drawEdgePill(state._hoverEdge);
    }

    // Handles milieu d'arête (rect bleu/violet/orange)
    verts.forEach(([x, y], i) => {
      const j = (i + 1) % n;
      const mx = (x + verts[j][0]) / 2, my = (y + verts[j][1]) / 2;
      const isHov = state._hoverEdge === i && !state.drag;
      const isSel = state.selectedE === i;
      const isInsert = isHov && state._shiftHeld;
      const eType = (edges[i] || {}).type || 'line';
      const fcol = isInsert ? COLORS.ok
        : eType === 'arc' ? COLORS.blue
        : eType === 'bezier' ? COLORS.violet
        : (isHov || isSel) ? COLORS.orange
        : COLORS.blue;
      e('rect', {
        x: (mx - 4.5).toFixed(1), y: (my - 4.5).toFixed(1),
        width: '9', height: '9', rx: '1.5',
        fill: fcol, stroke: isSel ? '#fff' : '#0e0c08',
        'stroke-width': isSel ? '1.8' : '1',
        cursor: 'crosshair',
        'data-poly': pi, 'data-type': 'edge', 'data-idx': i,
      });
    });

    // Insert cursor : ⊕ vert au survol arête + Shift
    if (state._hoverEdge !== null && state._shiftHeld && state._hoverPos && !state.drag) {
      const { x: hx, y: hy } = state._hoverPos;
      e('circle', {
        cx: hx.toFixed(1), cy: hy.toFixed(1), r: '9',
        fill: 'rgba(76,168,112,0.20)', stroke: COLORS.ok, 'stroke-width': '2', 'pointer-events': 'none',
      });
      const SH = 5;
      e('line', {
        x1: (hx - SH).toFixed(1), y1: hy.toFixed(1), x2: (hx + SH).toFixed(1), y2: hy.toFixed(1),
        stroke: COLORS.ok, 'stroke-width': '2', 'stroke-linecap': 'round', 'pointer-events': 'none',
      });
      e('line', {
        x1: hx.toFixed(1), y1: (hy - SH).toFixed(1), x2: hx.toFixed(1), y2: (hy + SH).toFixed(1),
        stroke: COLORS.ok, 'stroke-width': '2', 'stroke-linecap': 'round', 'pointer-events': 'none',
      });
      e('text', {
        x: (hx + 12).toFixed(1), y: (hy - 10).toFixed(1),
        'font-family': 'Inconsolata,monospace', 'font-size': '8',
        fill: COLORS.ok, 'pointer-events': 'none',
        _text: '⊕ insérer',
      });
    }

    // Handles arc peak (triangle bleu au sommet de l'arc)
    edges.forEach((edge, i) => {
      if (edge.type === 'arc' && Math.abs(edge.arcH || 0) > 1) {
        const j = (i + 1) % n;
        const [sx, sy] = verts[i], [ex, ey] = verts[j];
        const [px, py] = arcPeakPos(sx, sy, ex, ey, edge.arcH);
        e('line', {
          x1: ((sx + ex) / 2).toFixed(1), y1: ((sy + ey) / 2).toFixed(1),
          x2: px.toFixed(1), y2: py.toFixed(1),
          stroke: `${COLORS.blue}60`, 'stroke-width': '0.7', 'stroke-dasharray': '3,3', 'pointer-events': 'none',
        });
        const S = 7;
        const tri = `${px.toFixed(1)},${(py - S).toFixed(1)} ${(px + S * .75).toFixed(1)},${(py + S * .5).toFixed(1)} ${(px - S * .75).toFixed(1)},${(py + S * .5).toFixed(1)}`;
        e('polygon', {
          points: tri, fill: COLORS.blue, stroke: '#0e0c08', 'stroke-width': '1',
          cursor: 'ns-resize', 'data-poly': pi, 'data-type': 'arc', 'data-idx': i,
        });
      }
    });

    // Handles Bézier CP (losanges violets)
    edges.forEach((edge, i) => {
      if (edge.type === 'bezier' && edge.cp1 && edge.cp2) {
        for (const [ci, cpArr] of [[0, edge.cp1], [1, edge.cp2]]) {
          const [cpx, cpy] = cpArr, S = 5;
          const pts = `${cpx},${cpy - S} ${cpx + S},${cpy} ${cpx},${cpy + S} ${cpx - S},${cpy}`;
          e('polygon', {
            points: pts, fill: COLORS.violet, stroke: '#0e0c08', 'stroke-width': '1',
            cursor: 'move', 'data-poly': pi, 'data-type': 'bezier', 'data-idx': i, 'data-cp': ci,
          });
        }
      }
    });

    // Handles vertex (cercles, rouge si concave, blanc si hover, ✕ si shift+hover)
    verts.forEach(([x, y], i) => {
      const conc = isConcave(verts, i);
      const isSel = state.selectedV === i;
      const isHovV = state._hoverVertex === i && !state.drag;
      const isDelMode = isHovV && state._shiftHeld;
      let fill = conc ? COLORS.err : col;
      if (isDelMode) fill = '#ff3020';
      else if (isHovV) fill = '#fff';
      e('circle', {
        cx: x.toFixed(1), cy: y.toFixed(1),
        r: isSel ? '7' : isDelMode ? '8' : '5.5',
        fill, stroke: isSel ? '#fff' : isDelMode ? COLORS.err : '#0e0c08',
        'stroke-width': isDelMode ? '2.5' : isSel ? '2' : '1.2',
        cursor: isDelMode ? 'not-allowed' : 'move',
        'data-poly': pi, 'data-type': 'vertex', 'data-idx': i,
      });
      if (isDelMode) {
        const S = 4;
        e('line', {
          x1: (x - S).toFixed(1), y1: (y - S).toFixed(1), x2: (x + S).toFixed(1), y2: (y + S).toFixed(1),
          stroke: '#fff', 'stroke-width': '2', 'stroke-linecap': 'round', 'pointer-events': 'none',
        });
        e('line', {
          x1: (x + S).toFixed(1), y1: (y - S).toFixed(1), x2: (x - S).toFixed(1), y2: (y + S).toFixed(1),
          stroke: '#fff', 'stroke-width': '2', 'stroke-linecap': 'round', 'pointer-events': 'none',
        });
        e('text', {
          x: (x + 12).toFixed(1), y: (y - 10).toFixed(1),
          'font-family': 'Inconsolata,monospace', 'font-size': '8',
          fill: COLORS.err, 'pointer-events': 'none',
          _text: '⊖ suppr',
        });
      }
    });

    // Handle rotation (pastille avec ↻)
    if (drawRotateHandle) {
      const bb = verts.reduce(([a, b, c, d], [x, y]) =>
        [Math.min(a, x), Math.min(b, y), Math.max(c, x), Math.max(d, y)],
        [Infinity, Infinity, -Infinity, -Infinity]);
      const rx = Math.min(bb[2] + 20, viewW - 7);
      const ry = Math.max(bb[1] - 20, 7);
      const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
      e('line', {
        x1: cx.toFixed(1), y1: cy.toFixed(1), x2: rx.toFixed(1), y2: ry.toFixed(1),
        stroke: `${col}40`, 'stroke-width': '0.6', 'stroke-dasharray': '3,2', 'pointer-events': 'none',
      });
      const rg = e('g', { 'data-poly': pi, 'data-type': 'rotate', cursor: 'grab' });
      e('circle', {
        cx: rx.toFixed(1), cy: ry.toFixed(1), r: '10',
        fill: `${col}18`, stroke: col, 'stroke-width': '1.5',
        'data-poly': pi, 'data-type': 'rotate',
      }, rg);
      e('text', {
        x: rx.toFixed(1), y: (ry + 4).toFixed(1), 'text-anchor': 'middle',
        'font-family': 'Inconsolata,monospace', 'font-size': '11',
        fill: col, 'data-poly': pi, 'data-type': 'rotate',
        _text: '↻',
      }, rg);
    }
  }

  // ── Render principal ─────────────────────────────────────────
  function render() {
    const state = engine.state;

    // Nettoyage défensif
    engine.purgeDegenerate();

    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!state.polys.length) return;

    // Defs : clipPath par polygone (pour limiter l'inlet à son poly)
    const defs = e('defs', {});
    state.polys.forEach((poly, pi) => {
      if (!poly.verts.length) return;
      const clip = e('clipPath', { id: `mf-clip-${pi}`, clipPathUnits: 'userSpaceOnUse' }, defs);
      e('path', { d: buildPath(poly.verts, poly.edges) }, clip);
    });

    _renderGrid();

    // Boucle polygones
    state.polys.forEach((poly, pi) => {
      const { verts, edges } = poly;
      if (!verts.length) return;
      const n = verts.length;
      const isActive = pi === state.activePolyIdx;
      const isHole = poly.holeOf !== null && poly.holeOf !== undefined;
      const col = isHole ? '#5090d8' : POLY_COLORS[pi % POLY_COLORS.length];
      const opacity = isActive ? 1 : (isHole ? 0.6 : 0.4);

      // Trous inactifs : juste stroke + label
      if (isHole && !isActive) {
        e('path', {
          d: buildPath(verts, edges),
          fill: 'none', stroke: col,
          'stroke-width': '1', 'stroke-dasharray': '4,3',
          'fill-rule': 'evenodd', opacity: '0.55',
          'data-poly': pi, cursor: 'pointer',
        });
        const hcx = verts.reduce((s, [x]) => s + x, 0) / n;
        const hcy = verts.reduce((s, [, y]) => s + y, 0) / n;
        e('text', {
          x: hcx.toFixed(1), y: hcy.toFixed(1),
          'text-anchor': 'middle', 'dominant-baseline': 'middle',
          'font-size': '8', 'font-family': 'Inconsolata,monospace',
          fill: 'rgba(80,144,216,.6)', 'pointer-events': 'none',
          _text: '⊘',
        });
        return;
      }

      // Inlet (offset 2m) — sauf pour les trous
      if (state.showOffset && !isHole) {
        const pl = pathToPolyline(verts, edges);
        const offPath = computeOffsetRoundPath(pl, engine.OFFSET, 8);
        const offPts = computeOffset(pl, engine.OFFSET);
        const offArea = polyArea(offPts);
        if (offPath && offArea > 4) {
          const cg = e('g', { 'clip-path': `url(#mf-clip-${pi})`, opacity });
          e('path', {
            d: offPath,
            fill: `${COLORS.ok}0e`, stroke: COLORS.ok,
            'stroke-width': '1', 'stroke-dasharray': '5,3',
            'stroke-linejoin': 'round', 'stroke-linecap': 'round',
          }, cg);
        } else if (isActive) {
          const cx = verts.reduce((s, [x]) => s + x, 0) / n;
          const cy = verts.reduce((s, [, y]) => s + y, 0) / n;
          e('circle', {
            cx: cx.toFixed(1), cy: cy.toFixed(1), r: '5',
            fill: `${COLORS.err}70`, stroke: COLORS.err, 'stroke-width': '1',
          });
        }
      }

      // Forme principale — compound path avec trous (fill-rule: evenodd)
      let pathD = buildPath(verts, edges);
      if (!isHole) {
        state.polys.forEach(hp => {
          if (hp.holeOf !== pi || hp.verts?.length < 3) return;
          pathD += ' ' + buildPath(hp.verts, hp.edges || hp.verts.map(() => ({})));
        });
      }
      e('path', {
        d: pathD,
        fill: isHole ? 'rgba(80,144,216,0.10)' : `${col}18`,
        stroke: col, 'stroke-width': isActive ? '1.8' : '1.2',
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        'fill-rule': 'evenodd', opacity,
        'data-poly': pi, cursor: 'pointer',
      });

      // Label trou actif
      if (isHole) {
        const hcx = verts.reduce((s, [x]) => s + x, 0) / n;
        const hcy = verts.reduce((s, [, y]) => s + y, 0) / n;
        e('text', {
          x: hcx.toFixed(1), y: hcy.toFixed(1),
          'text-anchor': 'middle', 'dominant-baseline': 'middle',
          'font-size': '8', 'font-family': 'Inconsolata,monospace',
          fill: 'rgba(80,144,216,.7)', 'pointer-events': 'none',
          _text: '⊘',
        });
        e('text', {
          x: hcx.toFixed(1), y: (hcy + 9).toFixed(1),
          'text-anchor': 'middle', 'dominant-baseline': 'middle',
          'font-size': '7', 'font-family': 'Inconsolata,monospace',
          fill: 'rgba(80,144,216,.5)', 'pointer-events': 'none',
          _text: 'trou·Suppr=effacer',
        });
      }

      if (!isActive) return;
      _renderActiveHandles(poly, pi, col);
    });

    _renderCrossingMarker();
    const walls = _renderSharedWalls();
    _renderSnapTarget();

    // Emit info event pour consommateurs UI
    svg.dispatchEvent(new CustomEvent('metaforme:rendered', {
      detail: { polys: state.polys.length, sharedWalls: walls ?? 0 },
    }));
  }

  return {
    render,
    renderGrid: _renderGrid,
    drawEdgePill: _drawEdgePill,
    setOption(key, val) {
      if (key === 'drawGrid') drawGrid !== !!val && (arguments[0] = null);
      // Simple toggle ops — consommateur peut recréer si besoin
    },
  };
}

export default { createRenderer, COLORS, POLY_COLORS };
