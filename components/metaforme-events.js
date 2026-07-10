// terlab/components/metaforme-events.js
// MetaformeEvents — Handlers pointer/wheel/keyboard pour un MetaformeEngine
// Extrait de terlab_metaforme_v3.html lignes 1500-1955
// ENSA La Réunion · MGA Architecture 2026
//
// Usage :
//   import { createEngine } from './metaforme-engine.js';
//   import { createRenderer } from './metaforme-renderer.js';
//   import { bindEvents } from './metaforme-events.js';
//   const eng = createEngine({ initialPolys });
//   const rnd = createRenderer(svg, eng);
//   const unbind = bindEvents(svg, eng, rnd, { viewW: 300, viewH: 260 });
//   // unbind() pour retirer tous les handlers

import {
  findFirstIntersection, findCoincidentVertices, arcHFromPeak,
} from './metaforme-engine.js';

// Convertit un event pointer → coords SVG (tient compte du viewBox + pan/zoom)
export function svgPt(svg, e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

export function bindEvents(svg, engine, renderer, opts = {}) {
  const viewW = opts.viewW ?? 300;
  const viewH = opts.viewH ?? 260;
  const enablePanZoom = opts.enablePanZoom ?? true;
  const enableKeyboard = opts.enableKeyboard ?? true;
  const onChange = opts.onChange ?? (() => {});

  const state = engine.state;
  let panDrag = null;
  let lastPolyClick = 0;

  // ── Tactile ──────────────────────────────────────────────────
  // Pas de clavier ni de hover au doigt : appui long sur un sommet =
  // suppression, appui long sur une arête = insertion de sommet,
  // pinch 2 doigts = zoom. Le SVG gère lui-même pan/zoom/drag.
  svg.style.touchAction = 'none';
  const touchPts = new Map();       // pointerId → {x, y}
  let pinch = null;                 // {dist, zoom} au départ du pinch
  let longPress = null;             // {timer, x, y}
  const LONG_PRESS_MS = 550, LONG_PRESS_TOL = 9;

  function cancelLongPress() {
    if (longPress) { clearTimeout(longPress.timer); longPress = null; }
  }

  // ── Apply viewBox with pan/zoom ──────────────────────────────
  function applyViewBox() {
    svg.setAttribute('viewBox',
      `${-state.svgPan.x} ${-state.svgPan.y} ${viewW * state.svgZoom} ${viewH * state.svgZoom}`);
  }
  applyViewBox();

  // ── pointerdown ──────────────────────────────────────────────
  function onPointerDown(e) {
    if (e.pointerType === 'touch') {
      touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPts.size === 2 && enablePanZoom) {
        // Second doigt → pinch zoom : annule drag/pan/appui-long en cours
        cancelLongPress();
        state.drag = null; panDrag = null;
        const [a, b] = [...touchPts.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: state.svgZoom };
        return;
      }
    }
    const t = e.target;
    const type = t.dataset?.type;

    // Shift + click sur le corps du polygone (pas sur un handle)
    if (e.shiftKey && !type) {
      const poly = engine.ap();
      const p = svgPt(svg, e);
      // Shift + hover arête → insérer sommet
      if (state._hoverEdge !== null && state._hoverPos && poly) {
        e.preventDefault();
        const idx = state._hoverEdge;
        const n = poly.verts.length;
        const j = (idx + 1) % n;
        const [x1, y1] = poly.verts[idx], [x2, y2] = poly.verts[j];
        const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
        const vx = dx / len, vy = dy / len;
        const proj = Math.max(0.1, Math.min(len - 0.1, (p.x - x1) * vx + (p.y - y1) * vy));
        const ix = x1 + vx * proj, iy = y1 + vy * proj;
        engine.doInsertVertex(engine.state.activePolyIdx, idx, ix, iy);
        renderer.render(); onChange('insert'); return;
      }
      // Shift + hover vertex → supprimer
      if (state._hoverVertex !== null && poly) {
        e.preventDefault();
        engine.doDeleteVertex(engine.state.activePolyIdx, state._hoverVertex);
        renderer.render(); onChange('delete'); return;
      }
    }

    // Click sur polygone inactif → switch active
    if (!type && t.dataset?.poly != null) {
      const pi = +t.dataset.poly;
      state.activePolyIdx = pi;
      state.selectedV = null; state.selectedE = null;
      renderer.render(); return;
    }

    // Click sur fond SVG → pan
    if (!type && enablePanZoom && (e.button === 0 || e.button === 1)) {
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      const rect = svg.getBoundingClientRect();
      panDrag = {
        startX: e.clientX, startY: e.clientY,
        startPanX: state.svgPan.x, startPanY: state.svgPan.y,
        vwPerPx: (viewW * state.svgZoom) / rect.width,
        vhPerPx: (viewH * state.svgZoom) / rect.height,
      };
      svg.style.cursor = 'grabbing';
      return;
    }

    if (!type) return;

    // Drag sur un handle (vertex / edge / arc / bezier / rotate)
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    const p = svgPt(svg, e);
    const poly = engine.ap();
    if (!poly) return;
    const { verts } = poly;
    const n = verts.length;
    const cx = verts.reduce((s, [x]) => s + x, 0) / n;
    const cy = verts.reduce((s, [, y]) => s + y, 0) / n;

    if (type === 'vertex') {
      if (e.shiftKey) {
        engine.doDeleteVertex(engine.state.activePolyIdx, +t.dataset.idx);
        renderer.render(); onChange('delete'); return;
      }
      state.selectedV = +t.dataset.idx; state.selectedE = null;
      state.drag = { type: 'vertex', idx: +t.dataset.idx };
    } else if (type === 'edge') {
      if (e.shiftKey) {
        const idx = +t.dataset.idx;
        const j = (idx + 1) % n;
        const [x1, y1] = verts[idx], [x2, y2] = verts[j];
        const ix = state._hoverPos ? state._hoverPos.x : (x1 + x2) / 2;
        const iy = state._hoverPos ? state._hoverPos.y : (y1 + y2) / 2;
        engine.doInsertVertex(engine.state.activePolyIdx, idx, ix, iy);
        renderer.render(); onChange('insert'); return;
      }
      state.selectedE = +t.dataset.idx; state.selectedV = null;
      state.drag = { type: 'edge', idx: +t.dataset.idx, prevX: p.x, prevY: p.y };
    } else if (type === 'arc') {
      state.selectedE = +t.dataset.idx;
      state.drag = { type: 'arc', idx: +t.dataset.idx };
    } else if (type === 'bezier') {
      state.selectedE = +t.dataset.idx;
      state.drag = { type: 'bezier', idx: +t.dataset.idx, cp: +t.dataset.cp };
    } else if (type === 'rotate') {
      state.drag = {
        type: 'rotate', cx, cy,
        startAngle: Math.atan2(p.y - cy, p.x - cx),
        startVerts: verts.map(v => [...v]),
        startEdges: JSON.parse(JSON.stringify(poly.edges)),
      };
    }

    // Appui long tactile (équivalent Shift+clic) : sommet → suppression,
    // arête → insertion de sommet au point d'appui. Si le doigt bouge
    // au-delà de la tolérance, l'appui-long est annulé et le drag continue.
    if (e.pointerType === 'touch' && (type === 'vertex' || type === 'edge')) {
      cancelLongPress();
      const idx = +t.dataset.idx;
      longPress = {
        x: e.clientX, y: e.clientY,
        timer: setTimeout(() => {
          longPress = null;
          state.drag = null; state._snapTarget = null; state._crossing = null;
          const pi = engine.state.activePolyIdx;
          if (type === 'vertex') {
            engine.doDeleteVertex(pi, idx);
            renderer.render(); onChange('delete');
          } else {
            const lp = engine.ap();
            if (!lp) return;
            const ln = lp.verts.length;
            const lj = (idx + 1) % ln;
            const [x1, y1] = lp.verts[idx], [x2, y2] = lp.verts[lj];
            const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
            if (len < 0.2) return;
            const vx = dx / len, vy = dy / len;
            const proj = Math.max(0.1, Math.min(len - 0.1, (p.x - x1) * vx + (p.y - y1) * vy));
            engine.doInsertVertex(pi, idx, x1 + vx * proj, y1 + vy * proj);
            renderer.render(); onChange('insert');
          }
        }, LONG_PRESS_MS),
      };
    }
    renderer.render();
  }

  // ── pointermove ──────────────────────────────────────────────
  function onPointerMove(e) {
    // Pinch zoom 2 doigts (même logique de recentrage que onWheel)
    if (e.pointerType === 'touch' && touchPts.has(e.pointerId)) {
      touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touchPts.size === 2) {
        const [a, b] = [...touchPts.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist > 1) {
          const newZoom = Math.max(0.25, Math.min(8, pinch.zoom * pinch.dist / dist));
          if (newZoom !== state.svgZoom) {
            const mid = svgPt(svg, { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
            const f = newZoom / state.svgZoom;
            state.svgPan.x = mid.x + (state.svgPan.x - mid.x) * f;
            state.svgPan.y = mid.y + (state.svgPan.y - mid.y) * f;
            state.svgZoom = newZoom;
            applyViewBox();
          }
        }
        return;
      }
    }
    // Appui-long en attente : immobile → on attend, mouvement → drag normal
    if (longPress) {
      if (Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) > LONG_PRESS_TOL) {
        cancelLongPress();
      } else {
        return;
      }
    }
    const p = svgPt(svg, e);
    // Pan en cours
    if (panDrag) {
      state.svgPan.x = panDrag.startPanX + (e.clientX - panDrag.startX) * panDrag.vwPerPx;
      state.svgPan.y = panDrag.startPanY + (e.clientY - panDrag.startY) * panDrag.vhPerPx;
      applyViewBox();
      return;
    }
    if (!state.drag) {
      const { changed } = engine.detectHover(p.x, p.y, e.shiftKey);
      if (changed) renderer.render();
      return;
    }
    e.preventDefault();
    const d = state.drag;
    const poly = engine.ap();
    if (!poly) return;
    const { verts, edges } = poly;
    const n = verts.length;

    if (d.type === 'vertex') {
      let [sx, sy] = engine.snapPoint(p.x, p.y);
      // Snap inter-polys (priorité sur snap grille)
      const inter = engine.snapToOtherPolys(sx, sy);
      if (inter.type) { sx = inter.x; sy = inter.y; state._snapTarget = inter; }
      else state._snapTarget = null;
      verts[d.idx] = [sx, sy];
      state._crossing = findFirstIntersection(verts) || findCoincidentVertices(verts);
    } else if (d.type === 'edge') {
      const i = d.idx, j = (i + 1) % n;
      const [x1, y1] = verts[i], [x2, y2] = verts[j];
      const ex2 = x2 - x1, ey2 = y2 - y1, len = Math.hypot(ex2, ey2);
      if (len < 0.1) return;
      const nx = -ey2 / len, ny = ex2 / len;
      const proj = (p.x - d.prevX) * nx + (p.y - d.prevY) * ny;
      verts[i] = [x1 + proj * nx, y1 + proj * ny];
      verts[j] = [x2 + proj * nx, y2 + proj * ny];
      const edge = edges[i];
      if (edge?.type === 'bezier' && edge.cp1 && edge.cp2) {
        edge.cp1 = [edge.cp1[0] + proj * nx, edge.cp1[1] + proj * ny];
        edge.cp2 = [edge.cp2[0] + proj * nx, edge.cp2[1] + proj * ny];
      }
      d.prevX = p.x; d.prevY = p.y;
      state._crossing = findFirstIntersection(verts) || findCoincidentVertices(verts);
    } else if (d.type === 'arc') {
      const i = d.idx, j = (i + 1) % n;
      const [sx, sy] = verts[i], [ex, ey] = verts[j];
      if (!edges[i]) edges[i] = { type: 'arc' };
      edges[i].type = 'arc';
      edges[i].arcH = arcHFromPeak(sx, sy, ex, ey, p.x, p.y);
    } else if (d.type === 'bezier') {
      const cpKey = d.cp === 0 ? 'cp1' : 'cp2';
      if (edges[d.idx]) edges[d.idx][cpKey] = [p.x, p.y];
    } else if (d.type === 'rotate') {
      const angle = Math.atan2(p.y - d.cy, p.x - d.cx) - d.startAngle;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      poly.verts = d.startVerts.map(([x, y]) => {
        const dx = x - d.cx, dy = y - d.cy;
        return [d.cx + dx * cos - dy * sin, d.cy + dx * sin + dy * cos];
      });
      d.startEdges.forEach((se, i) => {
        if (se.type === 'bezier') {
          ['cp1', 'cp2'].forEach(k => {
            if (se[k]) {
              const [x, y] = se[k];
              const dx = x - d.cx, dy = y - d.cy;
              if (!edges[i]) edges[i] = {};
              edges[i][k] = [d.cx + dx * cos - dy * sin, d.cy + dx * sin + dy * cos];
            }
          });
        }
      });
    }
    renderer.render();
  }

  // ── pointerup ────────────────────────────────────────────────
  function onPointerUp(e) {
    try { svg.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    if (e.pointerType === 'touch') {
      touchPts.delete(e.pointerId);
      if (touchPts.size < 2) pinch = null;
    }
    cancelLongPress();
    if (panDrag) { panDrag = null; svg.style.cursor = ''; return; }
    const wasCrossing = state._crossing;
    const hadDrag = !!state.drag;
    state.drag = null;
    if (wasCrossing && wasCrossing.i != null) engine.doSplit(wasCrossing);
    state._crossing = null;
    engine.purgeDegenerate();
    renderer.render();
    if (hadDrag) {
      engine.updateHoleRelationships();
      engine.refreshTypology();
      renderer.render();
      onChange('drag-end');
    }
  }

  function onPointerCancel(e) {
    if (e?.pointerType === 'touch') {
      touchPts.delete(e.pointerId);
      if (touchPts.size < 2) pinch = null;
    }
    cancelLongPress();
    state.drag = null; state._crossing = null;
    panDrag = null; svg.style.cursor = '';
  }

  function onMouseLeave() {
    const changed = state._hoverEdge !== null || state._hoverVertex !== null || state._shiftHeld;
    state._hoverEdge = null; state._hoverVertex = null; state._hoverPos = null;
    state._shiftHeld = false;
    if (changed) renderer.render();
  }

  // ── wheel (zoom vers curseur) ────────────────────────────────
  function onWheel(e) {
    if (!enablePanZoom) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 0.82 : 1.22;
    const newZoom = Math.max(0.25, Math.min(8, state.svgZoom * factor));
    if (newZoom === state.svgZoom) return;
    const p = svgPt(svg, e);
    const f = newZoom / state.svgZoom;
    state.svgPan.x = p.x + (state.svgPan.x - p.x) * f;
    state.svgPan.y = p.y + (state.svgPan.y - p.y) * f;
    state.svgZoom = newZoom;
    applyViewBox();
  }

  // ── dblclick fond → reset vue ────────────────────────────────
  function onDblClick(e) {
    if (!enablePanZoom) return;
    if (e.target !== svg && !e.target.matches?.('path[data-poly]')) return;
    state.svgPan = { x: 0, y: 0 };
    state.svgZoom = 1;
    applyViewBox();
  }

  // ── Keyboard ─────────────────────────────────────────────────
  function onKeyDown(e) {
    if (!enableKeyboard) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const pi = state.activePolyIdx;
      const poly = state.polys[pi];
      if (!poly) return;
      if (poly.holeOf !== null && poly.holeOf !== undefined) {
        state.polys.splice(pi, 1);
      } else {
        state.polys = state.polys.filter((_, i) =>
          i !== pi && state.polys[i]?.holeOf !== pi);
      }
      state.activePolyIdx = Math.min(state.activePolyIdx, Math.max(0, state.polys.length - 1));
      engine.afterMutation();
      renderer.render();
      onChange('delete-poly');
    }
  }

  // ── Bind ─────────────────────────────────────────────────────
  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerCancel);
  svg.addEventListener('mouseleave', onMouseLeave);
  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('dblclick', onDblClick);
  if (enableKeyboard) document.addEventListener('keydown', onKeyDown);

  // Expose l'API unbind + refresh viewBox (si viewW/viewH changent)
  return {
    unbind() {
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', onPointerUp);
      svg.removeEventListener('pointercancel', onPointerCancel);
      svg.removeEventListener('mouseleave', onMouseLeave);
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('dblclick', onDblClick);
      if (enableKeyboard) document.removeEventListener('keydown', onKeyDown);
    },
    resetView() {
      state.svgPan = { x: 0, y: 0 };
      state.svgZoom = 1;
      applyViewBox();
    },
    applyViewBox,
  };
}

export default { bindEvents, svgPt };
