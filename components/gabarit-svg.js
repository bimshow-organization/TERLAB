/**
 * GabaritSVG — Canvas 2D interactif avec cotations architecturales
 * TERLAB Phase 7 — ENSA La Réunion
 *
 * Layers: grid, permeable, non_constructible, constructible, solution,
 *         mitoyen_n, parcels, cotations, nodes, labels
 * Interactions: drag vertex, insert edge-mid, pan, wheel zoom, touch pinch
 */

const NS = 'http://www.w3.org/2000/svg';

export class GabaritSVG {
  constructor(containerEl, onNodesChange) {
    this.container = containerEl;
    this.onNodesChange = onNodesChange;
    this.scale = 10;
    this.origin = { x: 0, y: 0 };
    this.selectedSolution = null;
    this.snapGrid = 0.5; // meters
    this._parcelSet = null;
    this._lastConstraints = null;

    this._initSVG();
    this._initDefs();
    this._initInteraction();
  }

  _initSVG() {
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.style.cssText = `
      width:100%;height:100%;
      background:#1a1a2e;
      cursor:default;
      user-select:none;
      display:block;
    `;

    this.rootG = document.createElementNS(NS, 'g');
    this.rootG.setAttribute('id', 'gabarit-root');
    this.svg.appendChild(this.rootG);

    this.layers = {};
    ['grid', 'permeable', 'non_constructible', 'constructible', 'solution',
     'mitoyen_n', 'parcels', 'cotations', 'nodes', 'labels'
    ].forEach(name => {
      const g = document.createElementNS(NS, 'g');
      g.dataset.layer = name;
      this.layers[name] = g;
      this.rootG.appendChild(g);
    });

    this.container.appendChild(this.svg);
  }

  _initDefs() {
    const defs = document.createElementNS(NS, 'defs');

    // Arrow markers for cotations
    ['start', 'end'].forEach(pos => {
      const marker = document.createElementNS(NS, 'marker');
      marker.setAttribute('id', `gabarit-arrow-${pos}`);
      marker.setAttribute('markerWidth', '8');
      marker.setAttribute('markerHeight', '6');
      marker.setAttribute('refX', pos === 'end' ? '8' : '0');
      marker.setAttribute('refY', '3');
      marker.setAttribute('orient', 'auto');
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', pos === 'end' ? 'M0,0 L8,3 L0,6' : 'M8,0 L0,3 L8,6');
      path.setAttribute('fill', '#f1c40f');
      marker.appendChild(path);
      defs.appendChild(marker);
    });

    // Hatch pattern for permeable
    const pattern = document.createElementNS(NS, 'pattern');
    pattern.setAttribute('id', 'gabarit-hatch-permeable');
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    pattern.setAttribute('width', '8');
    pattern.setAttribute('height', '8');
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', '0'); line.setAttribute('y1', '8');
    line.setAttribute('x2', '8'); line.setAttribute('y2', '0');
    line.setAttribute('stroke', 'rgba(46,204,113,0.4)');
    line.setAttribute('stroke-width', '1');
    pattern.appendChild(line);
    defs.appendChild(pattern);

    // Hatch pattern for non-constructible
    const patternNC = document.createElementNS(NS, 'pattern');
    patternNC.setAttribute('id', 'gabarit-hatch-nc');
    patternNC.setAttribute('patternUnits', 'userSpaceOnUse');
    patternNC.setAttribute('width', '6');
    patternNC.setAttribute('height', '6');
    const lineNC = document.createElementNS(NS, 'line');
    lineNC.setAttribute('x1', '0'); lineNC.setAttribute('y1', '6');
    lineNC.setAttribute('x2', '6'); lineNC.setAttribute('y2', '0');
    lineNC.setAttribute('stroke', 'rgba(231,76,60,0.3)');
    lineNC.setAttribute('stroke-width', '1');
    patternNC.appendChild(lineNC);
    defs.appendChild(patternNC);

    this.svg.insertBefore(defs, this.svg.firstChild);
  }

  // ──────────────────────────────────────────────────────────────────
  // COORDINATE TRANSFORMS
  // ──────────────────────────────────────────────────────────────────

  _toScreen(pt) {
    return {
      x: pt.x * this.scale + this.origin.x,
      y: pt.y * this.scale + this.origin.y,
    };
  }

  _toWorld(sx, sy) {
    return {
      x: (sx - this.origin.x) / this.scale,
      y: (sy - this.origin.y) / this.scale,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // RENDER PRINCIPAL
  // ──────────────────────────────────────────────────────────────────

  render(parcelSet, constraints, solution = null) {
    this._parcelSet = parcelSet;
    this._lastConstraints = constraints;
    this.selectedSolution = solution;

    this._clearAll();

    if (!constraints || !parcelSet.unionPolygon.length) return;

    this._renderGrid(parcelSet);
    this._renderPermeable(parcelSet);
    this._renderNonConstructible(constraints.zones_non_constructibles);
    this._renderConstructible(constraints.emprise_constructible);
    if (constraints.zones_mitoyen_n) this._renderMitoyenN(constraints.zones_mitoyen_n);
    this._renderParcels(parcelSet);
    if (solution) this._renderSolution(constraints.emprise_constructible, solution);
    this._renderCotations(parcelSet, constraints);
    this._renderNodes(parcelSet);
    this._renderLabels(parcelSet, constraints, solution);
  }

  // ──────────────────────────────────────────────────────────────────
  // GRID
  // ──────────────────────────────────────────────────────────────────

  _renderGrid(parcelSet) {
    const layer = this.layers.grid;
    const bb = parcelSet.boundingBox;
    const margin = 10; // meters
    const step = this.scale > 6 ? 5 : 10; // grid step in meters

    for (let x = Math.floor((bb.minX - margin) / step) * step; x <= bb.maxX + margin; x += step) {
      const sx = x * this.scale + this.origin.x;
      const sy1 = (bb.minY - margin) * this.scale + this.origin.y;
      const sy2 = (bb.maxY + margin) * this.scale + this.origin.y;
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', sx); line.setAttribute('y1', sy1);
      line.setAttribute('x2', sx); line.setAttribute('y2', sy2);
      line.setAttribute('stroke', x === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)');
      line.setAttribute('stroke-width', '1');
      layer.appendChild(line);
    }
    for (let y = Math.floor((bb.minY - margin) / step) * step; y <= bb.maxY + margin; y += step) {
      const sy = y * this.scale + this.origin.y;
      const sx1 = (bb.minX - margin) * this.scale + this.origin.x;
      const sx2 = (bb.maxX + margin) * this.scale + this.origin.x;
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', sx1); line.setAttribute('y1', sy);
      line.setAttribute('x2', sx2); line.setAttribute('y2', sy);
      line.setAttribute('stroke', y === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)');
      line.setAttribute('stroke-width', '1');
      layer.appendChild(line);
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // ZONES
  // ──────────────────────────────────────────────────────────────────

  _renderNonConstructible(zones) {
    zones.forEach(zone => {
      const path = this._polyToPath(zone.polygon);
      this._addPath(this.layers.non_constructible, path, {
        fill: 'url(#gabarit-hatch-nc)',
        stroke: 'rgba(231,76,60,0.6)',
        strokeWidth: 1,
        strokeDasharray: '4 3'
      });
      const c = this._centroid(zone.polygon);
      this._addText(this.layers.labels, c, zone.label, {
        fill: '#e74c3c', fontSize: 9, fontWeight: 'bold', anchor: 'middle'
      });
    });
  }

  _renderPermeable(parcelSet) {
    const path = this._polyToPath(parcelSet.unionPolygon);
    this._addPath(this.layers.permeable, path, {
      fill: 'url(#gabarit-hatch-permeable)',
      stroke: 'none'
    });
  }

  _renderConstructible(polygon) {
    if (!polygon || polygon.length < 3) return;
    const path = this._polyToPath(polygon);
    this._addPath(this.layers.constructible, path, {
      fill: 'rgba(39,174,96,0.22)',
      stroke: '#27ae60',
      strokeWidth: 1.5
    });
  }

  _renderMitoyenN(zones) {
    zones.forEach(zone => {
      const path = this._polyToPath(zone.polygon);
      this._addPath(this.layers.mitoyen_n, path, {
        fill: 'rgba(230,126,34,0.15)',
        stroke: 'rgba(230,126,34,0.7)',
        strokeWidth: 1,
        strokeDasharray: '6 2'
      });
      const c = this._centroid(zone.polygon);
      this._addText(this.layers.labels, c, zone.label, {
        fill: '#e67e22', fontSize: 9, fontWeight: 'bold', anchor: 'middle'
      });
    });
  }

  _renderSolution(empriseConstructible, solution) {
    if (!empriseConstructible || empriseConstructible.length < 3) return;

    // Centroïde RÉEL de la zone constructible (pas centroïde de bbox)
    const centroid = this._centroid(empriseConstructible);
    const cx = centroid.x, cy = centroid.y;

    // Rectangle candidat dimensionné depuis la bbox de la zone
    const bb = this._bbox(empriseConstructible);
    const factor = Math.sqrt(solution.emprise_pct / 100);
    const w = (bb.maxX - bb.minX) * factor;
    const h = (bb.maxY - bb.minY) * factor;

    let solutionPoly = [
      { x: cx - w / 2, y: cy - h / 2 },
      { x: cx + w / 2, y: cy - h / 2 },
      { x: cx + w / 2, y: cy + h / 2 },
      { x: cx - w / 2, y: cy + h / 2 },
    ];

    // CLIP contre la zone constructible — garantie absolue qu'on ne déborde pas
    // (essentiel sur parcelles non rectangulaires : trapèze, polygone en L…)
    const clipped = this._clipPolygon(solutionPoly, empriseConstructible);
    if (clipped && clipped.length >= 3) solutionPoly = clipped;

    // Aire minimale viable (10 m²) — sinon ne rien afficher
    if (this._area(solutionPoly) < 10) return;

    const path = this._polyToPath(solutionPoly);
    this._addPath(this.layers.solution, path, {
      fill: `${solution.color}33`,
      stroke: solution.color,
      strokeWidth: 2.5
    });
    // Label sur centroïde du polygone clippé (pas de la bbox)
    const labelC = this._centroid(solutionPoly);
    this._addText(this.layers.labels, labelC, solution.label, {
      fill: solution.color, fontSize: 11, fontWeight: 'bold', anchor: 'middle'
    });
  }

  /**
   * Sutherland-Hodgman : clippe un polygone subject contre un polygone clip convexe.
   * Polygones {x,y}. Le clip doit être convexe ; pour les parcelles convexes
   * issues de insetPolygon c'est garanti.
   */
  _clipPolygon(subject, clip) {
    if (!clip || clip.length < 3 || !subject || subject.length < 3) return [];
    // Orientation : forcer CCW pour que cross >= 0 = intérieur
    const sa = (() => {
      let a = 0;
      for (let i = 0; i < clip.length; i++) {
        const p = clip[i], q = clip[(i + 1) % clip.length];
        a += p.x * q.y - q.x * p.y;
      }
      return a / 2;
    })();
    const ccwClip = sa < 0 ? [...clip].reverse() : clip;
    const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const isect = (a, b, c, d) => {
      const x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y;
      const x3 = c.x, y3 = c.y, x4 = d.x, y4 = d.y;
      const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      if (Math.abs(den) < 1e-12) return { x: x2, y: y2 };
      const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
      return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
    };
    let output = [...subject];
    for (let i = 0; i < ccwClip.length && output.length; i++) {
      const input = output;
      output = [];
      const a = ccwClip[i], b = ccwClip[(i + 1) % ccwClip.length];
      for (let j = 0; j < input.length; j++) {
        const p = input[j], q = input[(j + 1) % input.length];
        const pIn = cross(a, b, p) >= 0;
        const qIn = cross(a, b, q) >= 0;
        if (pIn) {
          output.push(p);
          if (!qIn) output.push(isect(a, b, p, q));
        } else if (qIn) {
          output.push(isect(a, b, p, q));
        }
      }
    }
    return output;
  }

  _renderParcels(parcelSet) {
    parcelSet.parcels.forEach(parcel => {
      const path = this._polyToPath(parcel.polygon);
      this._addPath(this.layers.parcels, path, {
        fill: 'none',
        stroke: '#ffffff',
        strokeWidth: 2
      });
    });
    // Union polygon (if multi-parcels)
    if (parcelSet.parcels.length > 1) {
      const path = this._polyToPath(parcelSet.unionPolygon);
      this._addPath(this.layers.parcels, path, {
        fill: 'none',
        stroke: 'rgba(255,255,255,0.4)',
        strokeWidth: 1,
        strokeDasharray: '6 3'
      });
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // COTATIONS
  // ──────────────────────────────────────────────────────────────────

  _renderCotations(parcelSet, constraints) {
    const bb = parcelSet.boundingBox;
    const offset = 3; // meters offset for cotation lines

    // Width (bottom)
    this._addCotation(
      { x: bb.minX, y: bb.maxY + offset },
      { x: bb.maxX, y: bb.maxY + offset },
      `${(bb.maxX - bb.minX).toFixed(1)} m`, 'horizontal'
    );

    // Height (right)
    this._addCotation(
      { x: bb.maxX + offset, y: bb.minY },
      { x: bb.maxX + offset, y: bb.maxY },
      `${(bb.maxY - bb.minY).toFixed(1)} m`, 'vertical'
    );

    // Recul from voie to constructible
    if (constraints.emprise_constructible?.length >= 3) {
      const cBB = this._bbox(constraints.emprise_constructible);
      const rNord = cBB.minY - bb.minY;
      const rSud = bb.maxY - cBB.maxY;
      const rOuest = cBB.minX - bb.minX;
      const rEst = bb.maxX - cBB.maxX;

      if (rNord > 0.1) {
        this._addCotation(
          { x: bb.minX - 2, y: bb.minY },
          { x: bb.minX - 2, y: cBB.minY },
          `R=${rNord.toFixed(1)}m`, 'vertical', '#e74c3c'
        );
      }
      if (rSud > 0.1) {
        this._addCotation(
          { x: bb.minX - 2, y: cBB.maxY },
          { x: bb.minX - 2, y: bb.maxY },
          `R=${rSud.toFixed(1)}m`, 'vertical', '#e74c3c'
        );
      }
      if (rOuest > 0.1) {
        this._addCotation(
          { x: bb.minX, y: bb.minY - 2 },
          { x: cBB.minX, y: bb.minY - 2 },
          `R=${rOuest.toFixed(1)}m`, 'horizontal', '#e74c3c'
        );
      }
      if (rEst > 0.1) {
        this._addCotation(
          { x: cBB.maxX, y: bb.minY - 2 },
          { x: bb.maxX, y: bb.minY - 2 },
          `R=${rEst.toFixed(1)}m`, 'horizontal', '#e74c3c'
        );
      }
    }
  }

  _addCotation(ptA, ptB, label, orientation, color = '#f1c40f') {
    const layer = this.layers.cotations;
    const a = this._toScreen(ptA);
    const b = this._toScreen(ptB);

    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
    line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '1');
    line.setAttribute('marker-start', 'url(#gabarit-arrow-start)');
    line.setAttribute('marker-end', 'url(#gabarit-arrow-end)');
    layer.appendChild(line);

    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('fill', color);
    text.setAttribute('font-size', '10');
    text.setAttribute('font-family', 'monospace');
    text.setAttribute('text-anchor', 'middle');
    if (orientation === 'vertical') {
      text.setAttribute('x', mx - 6);
      text.setAttribute('y', my);
      text.setAttribute('transform', `rotate(-90, ${mx - 6}, ${my})`);
    } else {
      text.setAttribute('x', mx);
      text.setAttribute('y', my - 5);
    }
    text.textContent = label;
    layer.appendChild(text);
  }

  // ──────────────────────────────────────────────────────────────────
  // LABELS
  // ──────────────────────────────────────────────────────────────────

  _renderLabels(parcelSet, constraints, solution) {
    const bb = parcelSet.boundingBox;
    const cx = (bb.minX + bb.maxX) / 2;

    // Surface header
    const constM2 = Math.round(constraints.metrics.surface_constructible_m2);
    const totalM2 = Math.round(constraints.metrics.surface_parcelle_m2);
    this._addText(this.layers.labels,
      { x: cx, y: bb.minY - 5 },
      `${totalM2} m\u00b2  |  Constructible : ${constM2} m\u00b2 (${constraints.metrics.ratio_constructible_pct.toFixed(0)}%)`,
      { fill: '#f1c40f', fontSize: 11, fontWeight: 'bold', anchor: 'middle' }
    );

    // Permeable label
    this._addText(this.layers.labels,
      { x: cx, y: bb.maxY + 6 },
      `Perm\u00e9able min : ${constraints.zone_permeable.pct}% = ${Math.round(constraints.zone_permeable.surface_m2)} m\u00b2`,
      { fill: '#2ecc71', fontSize: 9, anchor: 'middle' }
    );

    // Solution info
    if (solution) {
      this._addText(this.layers.labels,
        { x: cx, y: bb.maxY + 9 },
        `${solution.label} — SDP ${solution.sdp_nette_m2} m\u00b2 — ${solution.nb_niveaux}N — ~${solution.nb_logements_estimes} logts`,
        { fill: solution.color, fontSize: 10, fontWeight: 'bold', anchor: 'middle' }
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // NODES EDITABLES
  // ──────────────────────────────────────────────────────────────────

  _renderNodes(parcelSet) {
    const layer = this.layers.nodes;
    parcelSet.parcels.forEach((parcel, pIdx) => {
      parcel.polygon.forEach((pt, vIdx) => {
        // Vertex node
        const s = this._toScreen(pt);
        const circle = document.createElementNS(NS, 'circle');
        circle.setAttribute('cx', s.x);
        circle.setAttribute('cy', s.y);
        circle.setAttribute('r', 6);
        circle.setAttribute('fill', '#ffffff');
        circle.setAttribute('stroke', '#f1c40f');
        circle.setAttribute('stroke-width', '2');
        circle.dataset.nodeType = 'vertex';
        circle.dataset.parcelIdx = pIdx;
        circle.dataset.vertexIdx = vIdx;
        circle.style.cursor = 'grab';
        layer.appendChild(circle);

        // Edge midpoint (diamond)
        const next = parcel.polygon[(vIdx + 1) % parcel.polygon.length];
        const mid = { x: (pt.x + next.x) / 2, y: (pt.y + next.y) / 2 };
        const ms = this._toScreen(mid);
        const r = 4;
        const diamond = document.createElementNS(NS, 'polygon');
        diamond.setAttribute('points',
          `${ms.x},${ms.y - r} ${ms.x + r},${ms.y} ${ms.x},${ms.y + r} ${ms.x - r},${ms.y}`);
        diamond.setAttribute('fill', 'rgba(255,255,255,0.2)');
        diamond.setAttribute('stroke', '#f1c40f');
        diamond.setAttribute('stroke-width', '1.5');
        diamond.dataset.nodeType = 'edge-mid';
        diamond.dataset.parcelIdx = pIdx;
        diamond.dataset.edgeIdx = vIdx;
        diamond.style.cursor = 'crosshair';
        layer.appendChild(diamond);
      });
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // INTERACTION
  // ──────────────────────────────────────────────────────────────────

  _initInteraction() {
    let dragging = null;
    let panning = null;
    let rafPending = false;

    const svgPt = (e) => {
      const rect = this.svg.getBoundingClientRect();
      return this._toWorld(e.clientX - rect.left, e.clientY - rect.top);
    };

    // MOUSEDOWN
    this.svg.addEventListener('mousedown', e => {
      const node = e.target.closest('[data-node-type]');
      if (node) {
        e.preventDefault();
        e.stopPropagation();
        if (node.dataset.nodeType === 'vertex') {
          dragging = {
            el: node,
            parcelIdx: +node.dataset.parcelIdx,
            vertexIdx: +node.dataset.vertexIdx,
          };
          node.style.cursor = 'grabbing';
          node.setAttribute('r', 8);
        } else if (node.dataset.nodeType === 'edge-mid') {
          this._insertVertex(+node.dataset.parcelIdx, +node.dataset.edgeIdx);
          this.onNodesChange(this._parcelSet);
        }
      } else {
        panning = {
          startX: e.clientX, startY: e.clientY,
          ox: this.origin.x, oy: this.origin.y,
        };
        this.svg.style.cursor = 'move';
      }
    });

    // MOUSEMOVE
    this.svg.addEventListener('mousemove', e => {
      if (dragging) {
        const pt = svgPt(e);
        const snap = this.snapGrid;
        const snapped = {
          x: Math.round(pt.x / snap) * snap,
          y: Math.round(pt.y / snap) * snap,
        };
        this._parcelSet.parcels[dragging.parcelIdx].polygon[dragging.vertexIdx] = snapped;

        if (!rafPending) {
          rafPending = true;
          requestAnimationFrame(() => {
            this._parcelSet._recomputeUnion();
            this._quickUpdate();
            rafPending = false;
          });
        }
      } else if (panning) {
        this.origin.x = panning.ox + (e.clientX - panning.startX);
        this.origin.y = panning.oy + (e.clientY - panning.startY);
        this.rootG.setAttribute('transform',
          `translate(${this.origin.x - panning.ox},${this.origin.y - panning.oy})`);
      }
    });

    // MOUSEUP
    this.svg.addEventListener('mouseup', () => {
      if (dragging) {
        dragging.el.style.cursor = 'grab';
        dragging.el.setAttribute('r', 6);
        dragging = null;
        this.onNodesChange(this._parcelSet);
      }
      if (panning) {
        panning = null;
        this.svg.style.cursor = 'default';
        this.rootG.removeAttribute('transform');
        // Full re-render at new origin
        if (this._parcelSet && this._lastConstraints) {
          this.render(this._parcelSet, this._lastConstraints, this.selectedSolution);
        }
      }
    });

    // WHEEL ZOOM
    this.svg.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 0.87;
      const rect = this.svg.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      this.origin.x = px - (px - this.origin.x) * factor;
      this.origin.y = py - (py - this.origin.y) * factor;
      this.scale *= factor;
      if (this._parcelSet && this._lastConstraints) {
        this.render(this._parcelSet, this._lastConstraints, this.selectedSolution);
      }
    }, { passive: false });

    // TOUCH
    let prevTouchDist = 0;
    this.svg.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        const [a, b] = [...e.touches];
        prevTouchDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      }
    }, { passive: true });

    this.svg.addEventListener('touchmove', e => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const [a, b] = [...e.touches];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (prevTouchDist > 0) {
          const factor = dist / prevTouchDist;
          this.scale *= factor;
          if (this._parcelSet && this._lastConstraints) {
            this.render(this._parcelSet, this._lastConstraints, this.selectedSolution);
          }
        }
        prevTouchDist = dist;
      }
    }, { passive: false });
  }

  _insertVertex(parcelIdx, edgeIdx) {
    const poly = this._parcelSet.parcels[parcelIdx].polygon;
    const a = poly[edgeIdx];
    const b = poly[(edgeIdx + 1) % poly.length];
    poly.splice(edgeIdx + 1, 0, {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    });
  }

  _quickUpdate() {
    this._clearLayer(this.layers.parcels);
    this._clearLayer(this.layers.cotations);
    this._clearLayer(this.layers.nodes);
    this._clearLayer(this.layers.labels);
    if (this._parcelSet) {
      this._renderParcels(this._parcelSet);
      if (this._lastConstraints) {
        this._renderCotations(this._parcelSet, this._lastConstraints);
        this._renderLabels(this._parcelSet, this._lastConstraints, this.selectedSolution);
      }
      this._renderNodes(this._parcelSet);
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // AUTO-FIT
  // ──────────────────────────────────────────────────────────────────

  fitToView() {
    if (!this._parcelSet?.unionPolygon?.length) return;
    const bb = this._parcelSet.boundingBox;
    const svgRect = this.svg.getBoundingClientRect();
    const margin = 60; // px
    const availW = svgRect.width - margin * 2;
    const availH = svgRect.height - margin * 2;
    const rangeX = bb.maxX - bb.minX || 1;
    const rangeY = bb.maxY - bb.minY || 1;
    this.scale = Math.min(availW / rangeX, availH / rangeY);
    this.origin.x = margin + (availW - rangeX * this.scale) / 2 - bb.minX * this.scale;
    this.origin.y = margin + (availH - rangeY * this.scale) / 2 - bb.minY * this.scale;
    if (this._lastConstraints) {
      this.render(this._parcelSet, this._lastConstraints, this.selectedSolution);
    }
  }

  setSnapGrid(val) {
    this.snapGrid = val;
  }

  // ──────────────────────────────────────────────────────────────────
  // SVG EXPORT (for PDF p12)
  // ──────────────────────────────────────────────────────────────────

  exportSVGString() {
    return new XMLSerializer().serializeToString(this.svg);
  }

  // ──────────────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────────────

  _polyToPath(polygon) {
    return polygon.map((p, i) => {
      const s = this._toScreen(p);
      return `${i === 0 ? 'M' : 'L'} ${s.x} ${s.y}`;
    }).join(' ') + ' Z';
  }

  _addPath(layer, d, style) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', style.fill ?? 'none');
    if (style.stroke && style.stroke !== 'none') path.setAttribute('stroke', style.stroke);
    if (style.strokeWidth) path.setAttribute('stroke-width', style.strokeWidth);
    if (style.strokeDasharray) path.setAttribute('stroke-dasharray', style.strokeDasharray);
    layer.appendChild(path);
    return path;
  }

  _addText(layer, pt, text, style) {
    const el = document.createElementNS(NS, 'text');
    const s = this._toScreen(pt);
    el.setAttribute('x', s.x);
    el.setAttribute('y', s.y);
    el.setAttribute('fill', style.fill ?? '#fff');
    el.setAttribute('font-size', style.fontSize ?? 12);
    el.setAttribute('font-family', 'monospace');
    el.setAttribute('text-anchor', style.anchor ?? 'start');
    if (style.fontWeight) el.setAttribute('font-weight', style.fontWeight);
    el.textContent = text;
    layer.appendChild(el);
  }

  _centroid(polygon) {
    const n = polygon.length;
    return {
      x: polygon.reduce((s, p) => s + p.x, 0) / n,
      y: polygon.reduce((s, p) => s + p.y, 0) / n,
    };
  }

  _bbox(polygon) {
    return {
      minX: Math.min(...polygon.map(p => p.x)),
      maxX: Math.max(...polygon.map(p => p.x)),
      minY: Math.min(...polygon.map(p => p.y)),
      maxY: Math.max(...polygon.map(p => p.y)),
    };
  }

  _area(polygon) {
    let a = 0;
    for (let i = 0, n = polygon.length; i < n; i++) {
      const { x: x1, y: y1 } = polygon[i];
      const { x: x2, y: y2 } = polygon[(i + 1) % n];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2;
  }

  _clearAll() {
    Object.values(this.layers).forEach(l => { while (l.firstChild) l.removeChild(l.firstChild); });
  }

  _clearLayer(l) {
    while (l.firstChild) l.removeChild(l.firstChild);
  }
}

if (typeof window !== 'undefined') {
  window.GabaritSVG = GabaritSVG;
}

export default GabaritSVG;
