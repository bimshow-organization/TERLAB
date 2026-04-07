/**
 * TERLAB · AeraulicPlanner · v1.0
 * Comparateur de variantes plan-masse aéraulique.
 * Canvas SVG interactif : drag & drop de bâtiments, calcul sillage/score en temps réel.
 *
 * API :
 *   AeraulicPlanner.init(containerEl, opts)
 *   AeraulicPlanner.reset()
 *   AeraulicPlanner.getScore() → { scoreText, Rb }
 *   AeraulicPlanner.destroy()
 *   AeraulicPlanner.exportSession() → Object
 */

const AeraulicPlanner = {

  _svg: null,
  _buildings: [],
  _windDir:   105,
  _rafHandles: [],
  _dragState: null,
  _container: null,
  _nextId: 0,
  _mouseMoveHandler: null,
  _mouseUpHandler: null,

  CANVAS_W: 480,
  CANVAS_H: 320,
  GRID:     20,
  _gridScale: 0.1,

  init(containerEl, opts = {}) {
    this._container = containerEl;
    this._windDir   = opts.windDir ?? 105;
    this._gridScale = opts.gridScale ?? 0.1;
    this._buildings = [];
    this._nextId    = 0;
    this._renderShell();
  },

  _renderShell() {
    const MU = window.TerlabMU;
    this._container.innerHTML = `
      <div class="ap-shell" style="display:flex;flex-direction:column;height:100%">
        <div style="display:flex;gap:6px;padding:6px 8px;border-bottom:1px solid var(--border);
             flex-shrink:0;align-items:center;flex-wrap:wrap">
          <button class="source-btn" onclick="window._AP_addBuilding('small')"
                  style="padding:4px 8px;border:1px solid var(--border);border-radius:var(--r-sm)">+ Petit</button>
          <button class="source-btn" onclick="window._AP_addBuilding('medium')"
                  style="padding:4px 8px;border:1px solid var(--border);border-radius:var(--r-sm)">+ Moyen</button>
          <button class="source-btn" onclick="window._AP_addBuilding('large')"
                  style="padding:4px 8px;border:1px solid var(--border);border-radius:var(--r-sm)">+ Grand</button>
          <div style="flex:1"></div>
          <label style="font-size:.65rem;font-family:monospace;color:var(--ink3)">
            Vent :
            <input type="range" id="ap-wind-dir" min="0" max="360" value="${this._windDir}"
                   style="width:70px;vertical-align:middle"
                   oninput="window._AP_setWind(+this.value)"/>
            <span id="ap-wind-val" style="color:var(--accent)">${this._windDir}°</span>
          </label>
          <button class="source-btn" onclick="window._AP_reset()"
                  style="padding:4px 8px;border:1px solid var(--border);border-radius:var(--r-sm)">Reset</button>
        </div>
        <div style="flex:1;overflow:hidden;position:relative;cursor:default">
          <svg id="ap-canvas" width="${this.CANVAS_W}" height="${this.CANVAS_H}"
               viewBox="0 0 ${this.CANVAS_W} ${this.CANVAS_H}"
               style="display:block;width:100%;height:100%;background:rgba(240,244,250,.5)">
          </svg>
        </div>
        <div style="display:flex;gap:12px;padding:6px 10px;border-top:1px solid var(--border);
             font-family:Inconsolata,monospace;font-size:.65rem;flex-shrink:0;
             background:var(--card2,var(--card));flex-wrap:wrap">
          <span>Score : <strong id="ap-score">—</strong></span>
          <span>Rb moy : <strong id="ap-rb">—</strong></span>
          <span>Alignement : <strong id="ap-align">—</strong></span>
          <span style="color:var(--ink3);flex:1;text-align:right">
            1 carré = ${this.GRID * this._gridScale * 10}m
          </span>
        </div>
      </div>`;

    this._svg = this._container.querySelector('#ap-canvas');
    const styleEl = MU?.flowAnimStyle?.();
    if (styleEl) this._svg.appendChild(styleEl);
    this._drawGrid();
    this._drawWindArrow();
    this._setupDrag();

    window._AP_addBuilding = (sz) => this.addBuilding(sz);
    window._AP_setWind     = (d)  => this.setWindDir(d);
    window._AP_reset       = ()   => this.reset();
  },

  _drawGrid() {
    const MU = window.TerlabMU;
    if (!MU) return;
    const gGroup = MU.svgEl('g', { id: 'ap-grid', opacity: '0.3' });
    for (let x = 0; x <= this.CANVAS_W; x += this.GRID) {
      gGroup.appendChild(MU.svgEl('line',{x1:x,y1:0,x2:x,y2:this.CANVAS_H,
        stroke:'rgba(28,95,168,.3)','stroke-width':x%(this.GRID*5)===0?0.8:0.4}));
    }
    for (let y = 0; y <= this.CANVAS_H; y += this.GRID) {
      gGroup.appendChild(MU.svgEl('line',{x1:0,y1:y,x2:this.CANVAS_W,y2:y,
        stroke:'rgba(28,95,168,.3)','stroke-width':y%(this.GRID*5)===0?0.8:0.4}));
    }
    this._svg.appendChild(gGroup);
  },

  _drawWindArrow() {
    const MU = window.TerlabMU;
    if (!MU) return;
    this._svg.querySelector('#ap-wind-arr')?.remove();
    MU.ensureArrow(this._svg, 'arr-ap', 'rgba(28,95,168,.45)', 5);
    const rad = (this._windDir - 90) * Math.PI / 180;
    const cx = this.CANVAS_W / 2, cy = this.CANVAS_H / 2;
    const len = Math.min(this.CANVAS_W, this.CANVAS_H) * 0.4;
    const from = [cx - Math.cos(rad)*len*1.2, cy - Math.sin(rad)*len*1.2];
    const to   = [cx - Math.cos(rad)*20,       cy - Math.sin(rad)*20];

    const g = MU.svgEl('g', { id: 'ap-wind-arr' });
    for (let i = -1; i <= 1; i++) {
      const perp = [-Math.sin(rad), Math.cos(rad)];
      const off  = i * 30;
      const f2   = [from[0]+perp[0]*off, from[1]+perp[1]*off];
      const t2   = [to[0]+perp[0]*off,   to[1]+perp[1]*off];
      const s = MU.streamline([f2, t2], {
        color: `rgba(28,95,168,${0.25+Math.abs(i)*0.05})`,
        width: i===0 ? 1.8 : 1.0, dasharray:'5,3',
        markerId: i===0 ? 'arr-ap' : null,
      });
      this._rafHandles.push(MU.animateFlow(s, 35, 8));
      g.appendChild(s);
    }
    const lx = from[0] * 0.7 + to[0] * 0.3;
    const ly = from[1] * 0.7 + to[1] * 0.3;
    const lbl = MU.svgEl('text', { x:lx, y:ly-8, 'text-anchor':'middle',
      style:'font-family:Inconsolata,monospace;font-size:8px;fill:rgba(28,95,168,.65)' });
    lbl.textContent = `Vent ${this._windDir}°`;
    g.appendChild(lbl);
    this._svg.appendChild(g);
  },

  addBuilding(size = 'medium') {
    const MU = window.TerlabMU;
    if (!MU) return;
    const SIZES = { small:{w:40,h:30}, medium:{w:60,h:40}, large:{w:80,h:55} };
    const { w, h } = SIZES[size] ?? SIZES.medium;
    const id = `bld-${this._nextId++}`;
    const snap = v => Math.round(v / this.GRID) * this.GRID;
    const x = snap(this.CANVAS_W * 0.3 + Math.random() * this.CANVAS_W * 0.3);
    const y = snap(this.CANVAS_H * 0.3 + Math.random() * this.CANVAS_H * 0.3);

    const g = MU.svgEl('g', { id, 'data-bld-id': id, cursor: 'grab' });
    const rect = MU.buildingPlan(0, 0, w, h);
    const lbl = MU.svgEl('text',{x:w/2,y:h/2+3,'text-anchor':'middle',
      style:'font-family:Inconsolata,monospace;font-size:7px;fill:rgba(255,255,255,.75);pointer-events:none'});
    lbl.textContent = id.replace('bld-','B');
    g.appendChild(rect);
    g.appendChild(lbl);
    g.setAttribute('transform', `translate(${x},${y})`);

    this._svg.appendChild(g);
    this._buildings.push({ id, x, y, w, h, el: g, wakeEl: null });

    this._updateWakes();
    this._updateScore();
  },

  _setupDrag() {
    const svg = this._svg;
    const snap = v => Math.round(v / this.GRID) * this.GRID;
    let drag = null;

    svg.addEventListener('mousedown', (e) => {
      const g = e.target.closest('[data-bld-id]');
      if (!g) return;
      const id  = g.getAttribute('data-bld-id');
      const bld = this._buildings.find(b => b.id === id);
      if (!bld) return;
      const svgRect = svg.getBoundingClientRect();
      const scaleX  = this.CANVAS_W / svgRect.width;
      const scaleY  = this.CANVAS_H / svgRect.height;
      drag = { id, bld, ox: e.clientX * scaleX - bld.x, oy: e.clientY * scaleY - bld.y, scaleX, scaleY };
      g.style.cursor = 'grabbing';
      e.preventDefault();
    });

    // Stocker les handlers par référence pour cleanup propre
    this._mouseMoveHandler = (e) => {
      if (!drag) return;
      const nx = snap(e.clientX * drag.scaleX - drag.ox);
      const ny = snap(e.clientY * drag.scaleY - drag.oy);
      const bld = drag.bld;
      bld.x = Math.max(0, Math.min(nx, this.CANVAS_W  - bld.w));
      bld.y = Math.max(0, Math.min(ny, this.CANVAS_H - bld.h));
      bld.el.setAttribute('transform', `translate(${bld.x},${bld.y})`);
      this._updateWakes();
      this._updateScore();
    };

    this._mouseUpHandler = () => {
      if (drag) { drag.bld.el.style.cursor = 'grab'; drag = null; }
    };

    window.addEventListener('mousemove', this._mouseMoveHandler);
    window.addEventListener('mouseup', this._mouseUpHandler);
  },

  _updateWakes() {
    const MU = window.TerlabMU;
    if (!MU) return;
    this._svg.querySelectorAll('.ap-wake').forEach(el => el.remove());

    const windRad = (this._windDir - 90) * Math.PI / 180;
    const windVec = [Math.cos(windRad), Math.sin(windRad)];

    this._buildings.forEach(bld => {
      const cx = bld.x + bld.w / 2;
      const cy = bld.y + bld.h / 2;
      const A   = Math.max(bld.w, bld.h);
      const wakeM = MU.wakeLength(A * this._gridScale * 10, 'flat');
      const wakeP = wakeM / (this._gridScale * 10);

      const wake = MU.svgEl('ellipse', {
        cx: cx + windVec[0] * wakeP * 0.5,
        cy: cy + windVec[1] * wakeP * 0.5,
        rx: wakeP * 0.5,
        ry: Math.max(bld.w, bld.h) * 0.6,
        fill: MU.AERO_COLORS.wake,
        stroke: MU.AERO_COLORS.wakeBorder,
        'stroke-width': 0.7, 'stroke-dasharray': '3,2',
        transform: `rotate(${this._windDir}, ${cx + windVec[0]*wakeP*0.5}, ${cy + windVec[1]*wakeP*0.5})`,
      });
      wake.classList.add('ap-wake');
      const firstBld = this._svg.querySelector('[data-bld-id]');
      this._svg.insertBefore(wake, firstBld);
    });
  },

  _updateScore() {
    const MU = window.TerlabMU;
    if (!MU || !this._buildings.length) {
      const sc = document.getElementById('ap-score');
      if (sc) sc.textContent = '—';
      return;
    }

    let totalRb = 0, pairs = 0;
    for (let i = 0; i < this._buildings.length; i++) {
      for (let j = i+1; j < this._buildings.length; j++) {
        const a = this._buildings[i], b = this._buildings[j];
        const dx  = Math.abs((a.x+a.w/2) - (b.x+b.w/2));
        const dy  = Math.abs((a.y+a.h/2) - (b.y+b.h/2));
        const gap = Math.max(dx - (a.w+b.w)/2, dy - (a.h+b.h)/2, 2);
        const H   = Math.max(a.h, b.h) * this._gridScale * 10;
        const W   = gap * this._gridScale * 10;
        const L   = Math.max(a.w, b.w) * this._gridScale * 10;
        totalRb += MU.blockageRatio(W, H, L);
        pairs++;
      }
    }
    const Rb  = pairs ? totalRb / pairs : 0;
    const Vrel = MU.streetVelocity(Rb);
    const { C, label, ok } = MU.ventilationC(Vrel, 1.0);

    let aligned = 0;
    for (let i = 0; i < this._buildings.length; i++) {
      for (let j = i+1; j < this._buildings.length; j++) {
        const a = this._buildings[i], b = this._buildings[j];
        if (Math.abs(a.x - b.x) < this.GRID || Math.abs(a.y - b.y) < this.GRID) aligned++;
      }
    }
    const alignPenalty = Math.min(aligned * 10, 30);
    const score = Math.round(Math.max(0, (1 - Rb) * 80 - alignPenalty + 10));
    const scoreColor = score >= 60 ? 'var(--accent)' : score >= 40 ? '#b05800' : '#8a2020';

    const sc  = document.getElementById('ap-score');
    const rb  = document.getElementById('ap-rb');
    const aln = document.getElementById('ap-align');
    if (sc)  { sc.textContent  = `${score}/100 — ${label}`; sc.style.color = scoreColor; }
    if (rb)  { rb.textContent  = Rb.toFixed(3); }
    if (aln) { aln.textContent = aligned ? `${aligned} paire(s) alignée(s)` : 'Quinconce ✓'; }

    window.SessionManager?.savePhase?.(7, {
      aeraulique_planner_score: score,
      aeraulique_planner_rb:    Rb,
    });
    window.dispatchEvent(new CustomEvent('terlab:planner-score', { detail: { score, Rb, ok } }));
  },

  setWindDir(dir) {
    this._windDir = dir;
    const lbl = document.getElementById('ap-wind-val');
    if (lbl) lbl.textContent = dir + '°';
    this._rafHandles.forEach(h => h?.stop?.());
    this._rafHandles = [];
    this._drawWindArrow();
    this._updateWakes();
  },

  reset() {
    this._buildings = [];
    this._svg.querySelectorAll('[data-bld-id], .ap-wake').forEach(el => el.remove());
    this._updateScore();
  },

  getScore() {
    const sc = document.getElementById('ap-score')?.textContent ?? '—';
    const rb = +(document.getElementById('ap-rb')?.textContent ?? 0);
    return { scoreText: sc, Rb: rb };
  },

  exportSession() {
    return {
      buildings: this._buildings.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
      windDir:   this._windDir,
      score:     this.getScore(),
    };
  },

  destroy() {
    this._rafHandles.forEach(h => h?.stop?.());
    this._rafHandles = [];
    if (this._mouseMoveHandler) window.removeEventListener('mousemove', this._mouseMoveHandler);
    if (this._mouseUpHandler)   window.removeEventListener('mouseup', this._mouseUpHandler);
    this._mouseMoveHandler = null;
    this._mouseUpHandler = null;
    if (this._container) this._container.innerHTML = '';
    delete window._AP_addBuilding;
    delete window._AP_setWind;
    delete window._AP_reset;
  },
};

export default AeraulicPlanner;
