/**
 * TERLAB · WindNavigator · v1.0
 * Widget SVG multi-échelle pour la compréhension aéraulique.
 * 5 niveaux d'échelle, navigation par slider ou clic.
 *
 * API :
 *   WindNavigator.init(containerEl, terrain, demo)
 *   WindNavigator.goToScale(n)  n ∈ [0,4]
 *   WindNavigator.destroy()
 */

const WindNavigator = {

  _container:  null,
  _rafHandles: [],
  _currentScale: 0,
  _terrain: null,

  SCALES: [
    {
      id:    'territoire',
      label: 'Territoire',
      icon:  '🌍',
      km:    '~100 km',
      desc:  'Rose des vents alizés · zones C_TP · RTAA zones climatiques',
      buildFn: '_buildTerritoire',
    },
    {
      id:    'commune',
      label: 'Commune',
      icon:  '🏘️',
      km:    '~10 km',
      desc:  'Effets topographiques · ravines · collines · gradient terrain',
      buildFn: '_buildCommune',
    },
    {
      id:    'ilot',
      label: 'Îlot',
      icon:  '🏗️',
      km:    '~200 m',
      desc:  'Rb · groupements · cour urbaine · masque · quinconce',
      buildFn: '_buildIlot',
    },
    {
      id:    'batiment',
      label: 'Bâtiment',
      icon:  '🏠',
      km:    '~15 m',
      desc:  'Sillage · vortex de coin · pression 4 faces · tourbillon rabattant',
      buildFn: '_buildBatiment',
    },
    {
      id:    'piece',
      label: 'Pièce',
      icon:  '🪟',
      km:    '~4 m',
      desc:  'Ventilation transversale · S_ou ≥ S_hab/6 · indicateur C',
      buildFn: '_buildPiece',
    },
  ],

  init(containerEl, terrain, demo = null) {
    if (!containerEl) return;
    this._container = containerEl;
    this._terrain   = terrain;
    this._demo      = demo;
    this._container.innerHTML = '';
    this._renderShell();
    this.goToScale(0);
  },

  _renderShell() {
    this._container.innerHTML = `
      <div class="wn-shell" style="display:flex;flex-direction:column;height:100%;gap:0">
        <div class="wn-tabs" style="display:flex;border-bottom:1px solid var(--border);
             background:var(--card2,var(--card));flex-shrink:0">
          ${this.SCALES.map((s,i) => `
            <button class="wn-tab" data-scale="${i}"
                    onclick="window._WindNavigator_goTo(${i})"
                    style="flex:1;padding:8px 4px;font-family:Inconsolata,monospace;
                           font-size:.62rem;letter-spacing:.06em;border:none;
                           border-bottom:2px solid transparent;
                           background:transparent;cursor:pointer;transition:all .15s">
              <div style="font-size:.9rem">${s.icon}</div>
              <div>${s.label}</div>
              <div style="font-size:.55rem;opacity:.6">${s.km}</div>
            </button>`).join('')}
        </div>
        <div style="padding:6px 12px;flex-shrink:0;display:flex;align-items:center;gap:8px">
          <input type="range" id="wn-slider" min="0" max="4" value="0" step="1"
                 style="flex:1" oninput="window._WindNavigator_goTo(+this.value)"/>
          <span id="wn-scale-label" style="font-family:monospace;font-size:.68rem;
                color:var(--accent);min-width:80px">Territoire</span>
        </div>
        <div id="wn-desc" style="padding:4px 12px 6px;font-size:.7rem;
             color:var(--ink3);font-style:italic;flex-shrink:0"></div>
        <div id="wn-canvas" style="flex:1;overflow:hidden;position:relative;
             background:rgba(240,244,250,.4);display:flex;align-items:center;
             justify-content:center"></div>
        <div id="wn-coeffs" style="flex-shrink:0;padding:5px 12px;
             border-top:1px solid var(--border);font-family:Inconsolata,monospace;
             font-size:.62rem;color:var(--ink3);min-height:28px"></div>
      </div>`;

    window._WindNavigator_goTo = (n) => this.goToScale(n);
  },

  goToScale(n) {
    n = Math.max(0, Math.min(4, n));
    this._currentScale = n;

    this._container.querySelectorAll('.wn-tab').forEach((t, i) => {
      t.style.borderBottomColor = i === n ? 'var(--accent)' : 'transparent';
      t.style.color             = i === n ? 'var(--accent)' : 'var(--ink3)';
      t.style.background        = i === n ? 'rgba(28,95,168,.06)' : 'transparent';
    });

    const slider = this._container.querySelector('#wn-slider');
    if (slider) slider.value = n;

    const scale = this.SCALES[n];
    const lblEl = this._container.querySelector('#wn-scale-label');
    const dscEl = this._container.querySelector('#wn-desc');
    if (lblEl) lblEl.textContent = `${scale.icon} ${scale.label}`;
    if (dscEl) dscEl.textContent = scale.desc;

    this._rafHandles.forEach(h => h?.stop?.());
    this._rafHandles = [];

    const canvas = this._container.querySelector('#wn-canvas');
    if (canvas) {
      canvas.innerHTML = '';
      const svg = this[scale.buildFn]?.();
      if (svg) canvas.appendChild(svg);
    }
  },

  _buildTerritoire() {
    const MU      = window.TerlabMU;
    if (!MU) return null;
    const terrain = this._terrain ?? {};
    const W = 320, H = 220;
    const svg = MU.svgRoot(W, H);
    svg.appendChild(MU.flowAnimStyle());

    const roseData = [
      { dir: 105, v: 0.65 }, { dir: 80,  v: 0.20 },
      { dir: 270, v: 0.10 }, { dir: 90,  v: 0.05 },
    ];
    svg.appendChild(MU.windRose(W * 0.3, H * 0.5, 60, roseData, { showCardinals: true }));

    MU.ensureArrow(svg, 'arr-terr', MU.AERO_COLORS.wind, 4);
    [[100,'rgba(176,88,0,.2)','Z1 Côte O'],[75,'rgba(28,95,168,.15)','Z2 Côte E'],[45,'rgba(58,45,120,.15)','Z3 Hauts']].forEach(([r,fill,lbl]) => {
      svg.appendChild(MU.svgEl('circle',{cx:W*0.7,cy:H*0.4,r,fill,stroke:'rgba(100,100,100,.2)','stroke-width':0.7,'stroke-dasharray':'3,2'}));
      svg.appendChild(MU.coeffLabel(W*0.7+r*0.55,H*0.4,lbl,{size:6,anchor:'middle',color:'rgba(40,50,70,.65)'}));
    });

    for (let i = 0; i < 3; i++) {
      const y = H*0.3 + i*25;
      const stream = MU.streamline(
        MU.wavyStreamline([0, y], [W*0.55, y], 5, 1.5, 16),
        { color: MU.AERO_COLORS.wind, width: 1.2 + i*0.3, dasharray: '6,3', markerId: i===2?'arr-terr':null }
      );
      this._rafHandles.push(MU.animateFlow(stream, 40+i*10, 9));
      svg.appendChild(stream);
    }

    svg.appendChild(MU.coeffLabel(8, 15, 'Rose des vents · La Réunion', {size:7,color:'rgba(28,95,168,.75)'}));
    svg.appendChild(MU.coeffLabel(8, H-5, 'Alizés ESE 105° · V_réf cyclone = 36 m/s (RTAA DOM)', {size:5.5}));

    svg.appendChild(MU.svgEl('circle',{cx:W*0.7,cy:H*0.4,r:5,fill:'rgba(28,95,168,.8)',stroke:'#fff','stroke-width':1}));
    svg.appendChild(MU.coeffLabel(W*0.7+8, H*0.4+4, terrain.commune??'Site', {size:6,color:'rgba(28,95,168,.9)'}));
    return svg;
  },

  _buildCommune() {
    const MU = window.TerlabMU;
    if (!MU) return null;
    const W = 320, H = 220;
    const svg = MU.svgRoot(W, H);
    svg.appendChild(MU.flowAnimStyle());
    MU.ensureArrow(svg, 'arr-com', MU.AERO_COLORS.wind, 4);

    svg.appendChild(MU.groundSVG(0, H-25, W));
    svg.appendChild(MU.hillProfile(90,  H-25, 100, 80, 30));
    svg.appendChild(MU.hillProfile(240, H-25, 90,  60, 30));
    [60,78,100,120].forEach(x => svg.appendChild(MU.treeSVG(x, H-30, 10, 'tree')));
    svg.appendChild(MU.boundaryLayerSVG(8, H-25, 55, H-35, 'ouvert',
      { color: MU.AERO_COLORS.wind, arrowCount:4, markerId:'arr-com' }));

    [[H*0.35],[H*0.5],[H*0.65]].forEach(([y], i) => {
      const pts = MU.turbulentStreamline([0,y],[W,y], 8+i*3, i*13, 20);
      const s = MU.streamline(pts, {color:MU.AERO_COLORS.windLight, width:1.1, dasharray:'5,3'});
      this._rafHandles.push(MU.animateFlow(s, 35+i*8, 8));
      svg.appendChild(s);
    });

    svg.appendChild(MU.wakeZone(138, H-55, 60, 50, 'right'));
    svg.appendChild(MU.coeffLabel(140, H-70, 'C_TP=0,5 C₀', {size:6,color:'rgba(160,50,30,.85)'}));
    svg.appendChild(MU.coeffLabel(175, H*0.3, 'C_TP=1,1 C₀ (entre collines)', {size:6,color:'rgba(42,112,64,.9)'}));
    svg.appendChild(MU.coeffLabel(8, 12, 'Effets topographiques · Commune', {size:7,color:'rgba(74,106,42,.8)'}));
    return svg;
  },

  _buildIlot() {
    const MU = window.TerlabMU;
    if (!MU) return null;
    const W = 320, H = 220;
    const svg = MU.svgRoot(W, H);
    svg.appendChild(MU.flowAnimStyle());
    MU.ensureArrow(svg, 'arr-ilot', MU.AERO_COLORS.wind, 4);

    const bw = 22, bh = 30, gy = H-20;
    svg.appendChild(MU.groundSVG(0, gy, W));
    [15,45,75].forEach(x => svg.appendChild(MU.buildingPlan(x, gy-bh, bw, bh)));
    [15,45,75].forEach(x => svg.appendChild(MU.buildingPlan(x, gy-bh*2-8, bw, bh)));
    [15,45,75].forEach(x => svg.appendChild(MU.wakeZone(x+bw, gy-bh-4, 28, bw*0.8, 'right')));

    const ox = 165;
    [ox,ox+30,ox+60].forEach(x => svg.appendChild(MU.buildingPlan(x, gy-bh, bw, bh)));
    [ox+15,ox+45].forEach(x    => svg.appendChild(MU.buildingPlan(x, gy-bh*2-10, bw, bh)));

    [[H*0.4, 1.6],[H*0.55, 1.3]].forEach(([y, w], i) => {
      const s = MU.streamline(
        MU.wavyStreamline([0,y],[W,y],4,1,20),
        { color:MU.AERO_COLORS.windLight, width:w, dasharray:'5,3', markerId:i?'arr-ilot':null }
      );
      this._rafHandles.push(MU.animateFlow(s, 38+i*6, 8));
      svg.appendChild(s);
    });

    svg.appendChild(MU.coeffLabel(8,  12, 'Aligné → C < C₀',  {size:6.5, color:'rgba(160,50,30,.85)'}));
    svg.appendChild(MU.coeffLabel(165,12, 'Quinconce → C = C₀',{size:6.5, color:'rgba(42,112,64,.9)'}));
    svg.appendChild(MU.coeffLabel(8, H-3,'Rb · Groupements · Îlot', {size:7,color:'rgba(58,45,120,.75)'}));
    svg.appendChild(MU.svgEl('line',{x1:155,y1:5,x2:155,y2:gy,stroke:'rgba(28,95,168,.2)','stroke-width':0.8,'stroke-dasharray':'3,2'}));
    return svg;
  },

  _buildBatiment() {
    const MU = window.TerlabMU;
    if (!MU) return null;
    const svg = MU.buildPressurePlanSVG(320, 220, 0);
    svg.appendChild(MU.coeffLabel(8, 12, 'Pression sur façades · Bâtiment', {size:7,color:'rgba(106,53,32,.8)'}));
    const vx1 = MU.vortexSVG(52, 57, 18, 'cw',  2.8, { color:'rgba(160,50,30,.6)' });
    const vx2 = MU.vortexSVG(52, 163, 18, 'ccw', 2.8, { color:'rgba(160,50,30,.6)' });
    this._rafHandles.push(MU.animateRotate(vx1, 52, 57, 90));
    this._rafHandles.push(MU.animateRotate(vx2, 52, 163, -90));
    svg.appendChild(vx1);
    svg.appendChild(vx2);
    return svg;
  },

  _buildPiece() {
    const MU = window.TerlabMU;
    if (!MU) return null;
    const W = 320, H = 220;
    const svg = MU.svgRoot(W, H);
    svg.appendChild(MU.flowAnimStyle());
    MU.ensureArrow(svg, 'arr-pce', 'rgba(28,95,168,.75)', 4);

    const lx=40, ly=40, lw=240, lh=140;
    svg.appendChild(MU.svgEl('rect',{x:lx,y:ly,width:lw,height:lh,
      fill:'rgba(240,244,250,.6)',stroke:'rgba(25,30,45,.5)','stroke-width':1.5}));
    svg.appendChild(MU.svgEl('line',{x1:lx+lw/2,y1:ly,x2:lx+lw/2,y2:ly+lh,
      stroke:'rgba(25,30,45,.4)','stroke-width':1.2}));
    // Ouvrants E
    svg.appendChild(MU.svgEl('rect',{x:lx-3,y:ly+45,width:6,height:25,
      fill:'rgba(28,95,168,.5)',stroke:'rgba(28,95,168,.7)','stroke-width':1}));
    svg.appendChild(MU.svgEl('rect',{x:lx-3,y:ly+85,width:6,height:25,
      fill:'rgba(28,95,168,.5)',stroke:'rgba(28,95,168,.7)','stroke-width':1}));
    // Ouvrants O
    svg.appendChild(MU.svgEl('rect',{x:lx+lw-3,y:ly+45,width:6,height:25,
      fill:'rgba(74,159,212,.45)',stroke:'rgba(28,95,168,.6)','stroke-width':1}));
    svg.appendChild(MU.svgEl('rect',{x:lx+lw-3,y:ly+85,width:6,height:25,
      fill:'rgba(74,159,212,.45)',stroke:'rgba(28,95,168,.6)','stroke-width':1}));

    [[ly+57,1.8],[ly+72,1.4],[ly+97,1.8],[ly+107,1.4]].forEach(([y,w],i) => {
      const s = MU.streamline(
        [[lx+3,y],[lx+lw/2-10,y],[lx+lw/2+10,y+8],[lx+lw-3,y+8]],
        { color:MU.AERO_COLORS.wind, width:w, dasharray:'4,3', smooth:true, markerId:i%2===1?'arr-pce':null }
      );
      this._rafHandles.push(MU.animateFlow(s, 28+i*5, 7));
      svg.appendChild(s);
    });

    svg.appendChild(MU.coeffLabel(lx+5, ly+15, 'Pièce 1 · S_ou ≥ S_hab/6', {size:6}));
    svg.appendChild(MU.coeffLabel(lx+lw/2+5, ly+15, 'Pièce 2 · Traversant ✓', {size:6, color:'rgba(42,112,64,.85)'}));
    svg.appendChild(MU.coeffLabel(8, H-5, 'Ventilation traversante · RTAA DOM 2016', {size:7,color:'rgba(176,88,0,.8)'}));

    svg.appendChild(MU.svgEl('line',{x1:5,y1:H*0.5,x2:lx-5,y2:H*0.5,
      stroke:MU.AERO_COLORS.wind,'stroke-width':2.2,'marker-end':'url(#arr-pce)'}));
    svg.appendChild(MU.coeffLabel(6,H*0.5-5,'Alizés E',{size:6}));
    return svg;
  },

  destroy() {
    this._rafHandles.forEach(h => h?.stop?.());
    this._rafHandles = [];
    if (this._container) this._container.innerHTML = '';
    delete window._WindNavigator_goTo;
  },
};

export default WindNavigator;
