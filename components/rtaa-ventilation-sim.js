/**
 * TERLAB · RtaaVentilationSim · v1.0
 * Simulateur interactif de ventilation naturelle RTAA DOM 2016.
 * Plan logement SVG cliquable : placement ouvrants, vérification S_ou/S_hab.
 *
 * API :
 *   RtaaVentilationSim.init(containerEl, opts)
 *   RtaaVentilationSim.getValidation() → { rtaaOk, traversant, C, pieces }
 *   RtaaVentilationSim.destroy()
 */

const RtaaVentilationSim = {

  _container:  null,
  _svg:        null,
  _openings:   [],
  _rafHandles: [],
  _windDir:    105,

  PIECES: [
    { id:'ch1', label:'Chambre 1', shab:12, walls:['E','N'], x:20,  y:20,  w:80, h:80  },
    { id:'ch2', label:'Chambre 2', shab:14, walls:['E','S'], x:20,  y:108, w:80, h:90  },
    { id:'sjr', label:'Séjour',    shab:22, walls:['O','N'], x:140, y:20,  w:120,h:100 },
    { id:'cui', label:'Cuisine',   shab:10, walls:['O'],     x:140, y:128, w:80, h:60  },
    { id:'sdb', label:'SdB',       shab:5,  walls:[],        x:228, y:128, w:40, h:60  },
  ],

  CANVAS_W: 320,
  CANVAS_H: 240,

  init(containerEl, opts = {}) {
    this._container = containerEl;
    this._windDir   = opts.windDir ?? 105;
    this._openings  = [];
    this._renderShell();
  },

  _renderShell() {
    const MU = window.TerlabMU;
    this._container.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%">
        <div style="padding:6px 10px;font-size:.7rem;color:var(--ink3);font-style:italic;
             flex-shrink:0;border-bottom:1px solid var(--border)">
          Cliquez sur un mur extérieur (en vert) pour poser un ouvrant RTAA.
          Objectif : S_ou ≥ S_hab/6 pour chaque pièce + logement traversant.
        </div>
        <div style="flex:1;display:flex;justify-content:center;align-items:center;padding:8px">
          <svg id="rtaa-plan" width="${this.CANVAS_W}" height="${this.CANVAS_H}"
               viewBox="0 0 ${this.CANVAS_W} ${this.CANVAS_H}"
               xmlns="http://www.w3.org/2000/svg"
               style="max-width:100%;max-height:100%;border:1px solid var(--border);
                      border-radius:2px;background:#f5f8fd;cursor:pointer">
          </svg>
        </div>
        <div id="rtaa-results" style="flex-shrink:0;padding:6px 10px;
             border-top:1px solid var(--border);font-family:Inconsolata,monospace;
             font-size:.65rem"></div>
      </div>`;

    this._svg = this._container.querySelector('#rtaa-plan');
    if (!this._svg) return;
    if (MU) {
      this._svg.appendChild(MU.flowAnimStyle());
      MU.ensureArrow(this._svg,'arr-rtaa',MU.AERO_COLORS.wind,3);
    }
    this._drawPlan();
    this._svg.addEventListener('click', (e) => this._onPlanClick(e));
    this._updateResults();
  },

  _drawPlan() {
    const MU  = window.TerlabMU;
    if (!MU) return;
    const svg = this._svg;

    svg.appendChild(MU.svgEl('rect',
      { x:0,y:0,width:this.CANVAS_W,height:this.CANVAS_H, fill:'rgba(220,230,240,.4)' }));

    this.PIECES.forEach(p => {
      const g    = MU.svgEl('g', { id: `rtaa-piece-${p.id}` });
      g.appendChild(MU.svgEl('rect',{x:p.x,y:p.y,width:p.w,height:p.h,
        fill:'rgba(245,248,253,.95)',stroke:'rgba(25,30,45,.5)','stroke-width':1.5}));
      const lbl = MU.svgEl('text',{x:p.x+p.w/2,y:p.y+p.h/2-6,'text-anchor':'middle',
        style:'font-family:Inconsolata,monospace;font-size:6.5px;fill:rgba(20,30,45,.7)'});
      lbl.textContent = p.label;
      const slbl = MU.svgEl('text',{x:p.x+p.w/2,y:p.y+p.h/2+6,'text-anchor':'middle',
        style:'font-family:Inconsolata,monospace;font-size:6px;fill:rgba(80,100,120,.65)'});
      slbl.textContent = `${p.shab}m²`;
      g.appendChild(lbl);
      g.appendChild(slbl);
      p.walls.forEach(wall => {
        const [x1,y1,x2,y2] = this._wallCoords(p, wall);
        const hitEl = MU.svgEl('line',{
          x1,y1,x2,y2,
          stroke:'rgba(42,112,64,.6)','stroke-width':4,'stroke-linecap':'round',
          cursor:'pointer', 'data-piece':p.id, 'data-wall':wall,
        });
        hitEl.style.strokeDasharray = '6,3';
        g.appendChild(hitEl);
      });
      svg.appendChild(g);
    });

    // Flèche vent
    const windX = this.CANVAS_W * 0.05;
    const windY = this.CANVAS_H * 0.5;
    if (MU.windArrow) {
      const wArr = MU.windArrow([windX, windY], [windX + 22, windY],
        { markerId:'arr-rtaa', color:MU.AERO_COLORS.wind, width:2 });
      svg.appendChild(wArr);
    }
    const wLbl = MU.svgEl('text',{x:windX+3,y:windY-8,
      style:'font-family:Inconsolata,monospace;font-size:6px;fill:rgba(28,95,168,.7)'});
    wLbl.textContent = 'Alizés';
    svg.appendChild(wLbl);
  },

  _wallCoords(piece, wall) {
    const {x,y,w,h} = piece;
    const pad = 6;
    switch(wall) {
      case 'E': return [x,   y+pad,   x,   y+h-pad ];
      case 'O': return [x+w, y+pad,   x+w, y+h-pad ];
      case 'N': return [x+pad, y,     x+w-pad, y    ];
      case 'S': return [x+pad, y+h,   x+w-pad, y+h  ];
    }
    return [x,y,x,y];
  },

  _onPlanClick(e) {
    const MU  = window.TerlabMU;
    if (!MU) return;
    const hit = e.target.closest('[data-piece]');
    if (!hit) return;
    const pieceId = hit.getAttribute('data-piece');
    const wall    = hit.getAttribute('data-wall');
    const piece   = this.PIECES.find(p => p.id === pieceId);
    if (!piece) return;

    const existing = this._openings.findIndex(o => o.pieceId === pieceId && o.wall === wall);
    if (existing >= 0) {
      this._openings[existing].el?.remove();
      this._openings.splice(existing, 1);
      hit.setAttribute('stroke','rgba(42,112,64,.6)');
      hit.setAttribute('stroke-dasharray','6,3');
    } else {
      const wallPx = (wall==='E'||wall==='O') ? piece.h : piece.w;
      const ouWidth_m = wallPx * 0.18 * 0.1;

      const [x1,y1,x2,y2] = this._wallCoords(piece, wall);
      const mx = (x1+x2)/2, my = (y1+y2)/2;
      const el  = MU.svgEl('line',{
        x1: mx - (x2-x1)*0.15, y1: my - (y2-y1)*0.15,
        x2: mx + (x2-x1)*0.15, y2: my + (y2-y1)*0.15,
        stroke:'rgba(28,95,168,.9)','stroke-width':5,'stroke-linecap':'round',
      });
      hit.setAttribute('stroke','rgba(28,95,168,.4)');
      hit.removeAttribute('stroke-dasharray');
      this._svg.querySelector(`#rtaa-piece-${pieceId}`)?.appendChild(el);
      this._openings.push({ pieceId, wall, width_m: ouWidth_m, el });
    }

    this._updateFlows();
    this._updateResults();
  },

  _updateFlows() {
    this._rafHandles.forEach(h => h?.stop?.());
    this._rafHandles = [];
    this._svg.querySelectorAll('.rtaa-flow').forEach(el => el.remove());

    const MU = window.TerlabMU;
    if (!MU) return;

    this.PIECES.forEach(piece => {
      const opens = this._openings.filter(o => o.pieceId === piece.id);
      if (opens.length < 2) return;

      const getWallMid = (wall) => {
        const [x1,y1,x2,y2] = this._wallCoords(piece, wall);
        return [(x1+x2)/2, (y1+y2)/2];
      };
      const pt0 = getWallMid(opens[0].wall);
      const pt1 = getWallMid(opens[1].wall);

      for (let i = 0; i < 2; i++) {
        const pts = MU.wavyStreamline(pt0, pt1, 4, 1, 12);
        const s   = MU.streamline(pts, {
          color: MU.AERO_COLORS.wind, width: 1.0 + i*0.3, dasharray:'4,3',
        });
        s.classList.add('rtaa-flow');
        this._svg.appendChild(s);
        this._rafHandles.push(MU.animateFlow(s, 28+i*6, 7));
      }
    });
  },

  _updateResults() {
    const MU = window.TerlabMU;
    const pieces = this.PIECES.map(piece => {
      const opens  = this._openings.filter(o => o.pieceId === piece.id);
      const Sou    = opens.reduce((s, o) => s + (o.width_m * 2.2), 0);
      const minSou = MU ? MU.rtaaMinOpening(piece.shab) : piece.shab / 6;
      const ok     = Sou >= minSou;
      const walls    = opens.map(o => o.wall);
      const traversant = (walls.includes('E') && walls.includes('O'))
                       || (walls.includes('N') && walls.includes('S'));
      return { id: piece.id, label: piece.label, Sou, minSou, ok, traversant };
    }).filter(p => this.PIECES.find(pp=>pp.id===p.id)?.walls.length);

    const allRtaaOk    = pieces.every(p => p.ok);
    const anyTraversant = pieces.some(p => p.traversant);
    const Vrel = anyTraversant ? 0.7 : 0.2;
    const { C, label: cLabel } = MU ? MU.ventilationC(Vrel, 1.0) : { C: 0.3, label:'—' };

    const resEl = this._container.querySelector('#rtaa-results');
    if (!resEl) return;
    resEl.innerHTML = `
      ${pieces.map(p => `
        <span style="display:inline-flex;gap:4px;align-items:center;margin-right:10px">
          <span style="color:${p.ok?'#2a7040':'#8a2020'}">${p.ok?'✓':'✕'}</span>
          <span style="color:var(--ink3)">${p.label}:</span>
          <span>${p.Sou.toFixed(2)}/${p.minSou.toFixed(2)}m²</span>
          ${p.traversant?'<span style="color:#2a7040">↔</span>':''}
        </span>`).join('')}
      <span style="margin-left:8px;color:${allRtaaOk?'#2a7040':'#8a2020'};font-weight:bold">
        ${allRtaaOk?'✓ RTAA OK':'✕ RTAA NOK'}
      </span>
      <span style="margin-left:10px">C ≈ ${C.toFixed(2)} — ${cLabel}</span>`;

    window.dispatchEvent(new CustomEvent('terlab:rtaa-sim-check', {
      detail: { rtaaOk: allRtaaOk, traversant: anyTraversant, C }
    }));
    window.SessionManager?.savePhase?.(4, { rtaa_ventilation_ok: allRtaaOk, rtaa_C: C });
  },

  getValidation() {
    const pieces = this.PIECES.map(piece => {
      const opens  = this._openings.filter(o => o.pieceId === piece.id);
      const Sou    = opens.reduce((s,o) => s + (o.width_m*2.2), 0);
      const minSou = piece.shab / 6;
      return { id: piece.id, Sou, minSou, ok: Sou >= minSou,
               traversant: (opens.map(o=>o.wall).includes('E') && opens.map(o=>o.wall).includes('O')) };
    });
    const rtaaOk    = pieces.every(p => p.ok);
    const traversant = pieces.some(p => p.traversant);
    return { rtaaOk, traversant, C: traversant ? 0.7 : 0.2, pieces };
  },

  destroy() {
    this._rafHandles.forEach(h => h?.stop?.());
    this._rafHandles = [];
    if (this._container) this._container.innerHTML = '';
  },
};

export default RtaaVentilationSim;
