/**
 * TERLAB · AeraulicSection · v1.0
 * Composant de schématisation aéraulique sur profil topographique.
 * Utilise window.TerlabMU (terlab-mat-utils.js) pour les calculs et le dessin.
 *
 * API publique :
 *   AeraulicSection.init(config)
 *   AeraulicSection.renderOverlay(profileData, targetSvgEl)
 *   AeraulicSection.computeSiteScore(profileData) → { score, zones, label }
 *   AeraulicSection.generateDiagnostic(profileData) → string HTML
 *   AeraulicSection.destroy()
 */

const AeraulicSection = {

  _rafHandles: [],   // Pour cleanup animateFlow etc.
  _config: null,

  /**
   * @param {Object} config
   *   terrain        : SessionManager.getTerrain()
   *   windDir        : azimut vent dominant (°N), défaut 105 (alizé ESE Réunion)
   *   terrainType    : 'ouvert'|'suburbain'|'urbain' — rugosité estimée du profil
   *   profileWidth   : largeur SVG du profil existant (px)
   *   profileHeight  : hauteur SVG du profil existant (px)
   */
  init(config) {
    this._config = {
      windDir:      105,
      terrainType:  'suburbain',
      profileWidth:  600,
      profileHeight: 180,
      ...config,
    };
  },

  /**
   * Superpose les annotations aérauliques SUR le SVG overlay du profil topo.
   *
   * Annotations produites (toutes via TerlabMU) :
   *  1. Profil de couche limite (boundaryLayerSVG) à gauche du profil
   *  2. Pour chaque relief traversé (colline, ravine) :
   *     - Zone de sillage (wakeZone) côté sous-le-vent
   *     - Zone accélérée si entre deux reliefs (svgEl rect zone-acc)
   *     - Coefficient C_TP via cTP()
   *     - Flèches de flux animées (streamline avec tl-flow)
   *  3. Streamlines générales sur la longueur du profil
   *     (turbulentStreamline pour effet naturel)
   *  4. Légende C_TP en bas (coeffLabel)
   *
   * @param {Object}     profileData  — données du profil topo de p01
   *   points       : [{dist: m, alt: m}]   tableau des points du profil
   *   svgWidth     : number                largeur du SVG profil
   *   svgHeight    : number                hauteur du SVG profil
   *   groundY      : number                Y de la ligne de sol dans le SVG
   *   scaleX       : number                px/m horizontal
   *   scaleY       : number                px/m vertical
   * @param {SVGElement} targetSvgEl — l'élément <svg> overlay
   */
  renderOverlay(profileData, targetSvgEl) {
    const MU = window.TerlabMU;
    if (!MU) { console.error('[AeraulicSection] TerlabMU non disponible'); return; }

    // Injecter le style d'animation une seule fois
    if (!targetSvgEl.querySelector('#tl-aero-style')) {
      const style = MU.flowAnimStyle();
      style.id = 'tl-aero-style';
      targetSvgEl.prepend(style);
    }

    // Injecter marqueur flèche vent
    MU.ensureArrow(targetSvgEl, 'arr-aero', MU.AERO_COLORS.wind, 4);

    // ── 1. Profil de couche limite (colonne gauche du profil) ──────────────
    const blSvg = MU.boundaryLayerSVG(
      4, profileData.groundY,               // x0, y0 (sol)
      profileData.svgWidth * 0.12,          // largeur max
      profileData.groundY - 8,             // hauteur disponible
      this._config.terrainType,
      { color: MU.AERO_COLORS.wind, arrowCount: 4, markerId: 'arr-aero' }
    );
    blSvg.setAttribute('opacity', '0.75');
    targetSvgEl.appendChild(blSvg);

    // ── 2. Analyse du profil : détecter reliefs et calculer C_TP ──────────
    const zones = this._analyzeProfile(profileData);

    zones.forEach(zone => {
      // Zone de sillage (sous-le-vent)
      if (zone.type === 'hill' && zone.leewardX) {
        const wake = MU.wakeZone(
          zone.leewardX, profileData.groundY - zone.heightPx * 0.5,
          zone.wakeLenPx, zone.heightPx * 1.2, 'right'
        );
        targetSvgEl.appendChild(wake);
      }

      // Zone accélérée (entre deux reliefs)
      if (zone.type === 'gap') {
        const acc = MU.svgEl('rect', {
          x: zone.x0, y: zone.topY,
          width: zone.width, height: zone.heightPx,
          fill: MU.AERO_COLORS.zoneAcc,
          stroke: MU.AERO_COLORS.wind.replace('0.8', '0.3'),
          'stroke-width': 0.6, 'stroke-dasharray': '3,2',
        });
        targetSvgEl.appendChild(acc);
      }

      // Coefficient C_TP
      if (zone.ctpLabel) {
        targetSvgEl.appendChild(MU.coeffLabel(
          zone.labelX, zone.labelY, zone.ctpLabel,
          { color: zone.ctpVal >= 1 ? 'rgba(42,112,64,.9)' : 'rgba(160,50,30,.9)', size: 6.5 }
        ));
      }
    });

    // ── 3. Streamlines générales sur la longueur du profil ─────────────────
    const heights = [0.15, 0.3, 0.5, 0.75];
    heights.forEach((frac, i) => {
      const y = profileData.groundY - frac * (profileData.groundY - 10);
      const pts = MU.turbulentStreamline(
        [0, y],
        [profileData.svgWidth, y],
        3 + frac * 4,
        i * 17,
        18
      );
      const stream = MU.streamline(pts, {
        color: MU.AERO_COLORS.windLight,
        width: 0.9 + frac * 0.5,
        dasharray: '5,3',
        duration: 0,
        markerId: i === heights.length - 1 ? 'arr-aero' : null,
      });
      stream.id = `aero-stream-${i}`;
      targetSvgEl.appendChild(stream);

      const handle = MU.animateFlow(stream, 35 + i * 8, 8);
      this._rafHandles.push(handle);
    });

    // ── 4. Flèche direction vent dominant ──────────────────────────────────
    const windLabel = MU.svgEl('text', {
      x: 6, y: 12,
      style: 'font-family:Inconsolata,monospace;font-size:7px;fill:rgba(28,95,168,.7)',
    });
    windLabel.textContent = `Alizés ${this._config.windDir}°`;
    targetSvgEl.appendChild(windLabel);
  },

  /**
   * Analyse le tableau de points du profil pour identifier :
   * - Collines (peak local) → C_TP (sous-le-vent), zone sillage
   * - Vallées / ravines (creux local) → C_TP (vallée)
   * - Zones entre deux reliefs → C_TP (accélération)
   */
  _analyzeProfile(profileData) {
    const MU   = window.TerlabMU;
    const pts  = profileData.points ?? [];
    if (pts.length < 3) return [];

    const alts = pts.map(p => p.alt);
    const mean = alts.reduce((a,b) => a+b, 0) / alts.length;
    const sigma = Math.sqrt(alts.reduce((s,a) => s + (a-mean)**2, 0) / alts.length);
    const zones = [];

    for (let i = 1; i < pts.length - 1; i++) {
      const alt = alts[i], prev = alts[i-1], next = alts[i+1];
      const x   = pts[i].dist * profileData.scaleX;
      const y   = profileData.groundY - (alt - alts[0]) * profileData.scaleY;

      if (alt > prev && alt > next && alt > mean + sigma * 0.5) {
        const heightPx  = (alt - mean) * profileData.scaleY;
        const { ctp }   = MU.cTP('sous_le_vent');
        const wakePx    = MU.wakeLength((alt - mean) * 2, 'flat') * profileData.scaleX;
        zones.push({
          type: 'hill', i, x, topY: y,
          heightPx,
          leewardX:  x,
          wakeLenPx: Math.min(wakePx, profileData.svgWidth * 0.25),
          ctpVal:    ctp, ctpLabel: `C_TP=${ctp} C₀`,
          labelX: x + 4, labelY: y - 4,
        });
      } else if (alt < prev && alt < next && alt < mean - sigma * 0.5) {
        const { ctp } = MU.cTP('vallee');
        zones.push({
          type: 'valley', i, x, topY: y,
          heightPx: (mean - alt) * profileData.scaleY,
          ctpVal: ctp, ctpLabel: `C_TP=${ctp} C₀`,
          labelX: x - 20, labelY: y + 10,
        });
      }
    }

    const hills = zones.filter(z => z.type === 'hill');
    for (let h = 0; h < hills.length - 1; h++) {
      const a = hills[h], b = hills[h+1];
      const gap = b.x - a.x;
      if (gap > 30 && gap < profileData.svgWidth * 0.4) {
        const { ctp } = MU.cTP('entre_collines');
        zones.push({
          type: 'gap', x0: a.x, topY: Math.min(a.topY, b.topY) - 8,
          width: gap, heightPx: 20,
          ctpVal: ctp, ctpLabel: `C_TP=${ctp} C₀`,
          labelX: a.x + gap/2, labelY: Math.min(a.topY, b.topY) - 12,
        });
      }
    }

    return zones;
  },

  /**
   * Calcule un score aéraulique du site à partir du profil (0–100)
   */
  computeSiteScore(profileData) {
    const zones = this._analyzeProfile(profileData);
    if (!zones.length) return { score: 70, label: 'Site plat — données insuffisantes', zones: [], ctpMoyen: 1.0 };

    const ctpMoyen = zones.reduce((sum, z) => sum + (z.ctpVal ?? 1), 0) / zones.length;
    const score    = Math.round(clamp(ctpMoyen * 70, 0, 100));
    const label    = score >= 80 ? 'Très favorable' : score >= 60 ? 'Favorable'
                   : score >= 40 ? 'Défavorable' : 'Très défavorable';
    return { score, label, zones, ctpMoyen: +ctpMoyen.toFixed(2) };

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  },

  /**
   * Génère le HTML du diagnostic textuel (à injecter dans .rp-section)
   * Adapté au cas (isole/village/ville) depuis session
   */
  generateDiagnostic(profileData) {
    const MU     = window.TerlabMU;
    const terrain = window.SessionManager?.getTerrain() ?? {};
    // D4 : pas de getDemo() — lire _data?.demo
    const demo   = window.SessionManager?._data?.demo ?? null;
    const { score, label, zones, ctpMoyen } = this.computeSiteScore(profileData);

    const altMoy = profileData.points?.reduce((s,p)=>s+p.alt,0) /
                   (profileData.points?.length||1) || 0;
    const rugositeType = altMoy > 600 ? 'ouvert' : demo === 'ville' ? 'dense' : 'suburbain';
    const { ctp: ctpSite } = MU.cTP(
      demo === 'ville' ? 'plaine' : zones.some(z=>z.type==='valley') ? 'vallee' : 'plaine'
    );
    const cycloneV = MU.rtaaCycloneV(rugositeType);

    const hills   = zones.filter(z => z.type === 'hill').length;
    const valleys = zones.filter(z => z.type === 'valley').length;
    const gaps    = zones.filter(z => z.type === 'gap').length;

    const recs = [];
    if (valleys > 0)
      recs.push(`⚠️ ${valleys} creux/ravine(s) détecté(s) — implantation en fond de ravine déconseillée (C_TP ≈ 0,3 C₀).`);
    if (gaps > 0)
      recs.push(`✓ ${gaps} zone(s) entre reliefs — site collecteur favorable (C_TP ≈ 1,1 C₀). Positionner les ouvrants côté alizés.`);
    if (hills > 0)
      recs.push(`⚠️ ${hills} relief(s) identifié(s) — éviter l'implantation sur la face sous-le-vent (C_TP ≈ 0,5 C₀).`);
    recs.push(`🌀 V_réf cyclonique estimée : <strong>${cycloneV.toFixed(0)} m/s</strong> (RTAA DOM, site ${rugositeType}).`);
    recs.push(`📐 Taux d'ouverture minimal RTAA : <strong>S_ou ≥ S_hab / 6</strong> (chaque pièce principale).`);

    return `
      <div class="ped-note" style="padding:10px 12px">
        <div style="font-family:Inconsolata,monospace;font-size:.62rem;letter-spacing:.08em;
                    text-transform:uppercase;color:var(--accent);margin-bottom:8px">
          Diagnostic aéraulique — Score site
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="font-size:1.8rem;font-weight:700;color:${score>=60?'var(--accent)':'#c84040'}">
            ${score}<span style="font-size:.9rem">/100</span>
          </div>
          <div>
            <div style="font-size:.8rem;font-weight:600;color:var(--ink)">${label}</div>
            <div style="font-size:.7rem;color:var(--ink3);font-style:italic">
              C_TP moyen : ${ctpMoyen} C₀ · Rugosité : ${rugositeType}
            </div>
          </div>
        </div>
        <div style="font-size:.72rem;color:var(--ink3);line-height:1.6">
          ${recs.map(r => `<div style="padding:3px 0;border-top:1px solid var(--border)">${r}</div>`).join('')}
        </div>
        <div style="margin-top:8px;font-size:.65rem;font-family:Inconsolata,monospace;
                    color:var(--ink3);border-top:1px solid var(--border);padding-top:6px">
          D'après Izard/CSTB · RTAA DOM 2016 · Garde PUCA
        </div>
      </div>`;
  },

  /** Nettoyer les animations RAF */
  destroy() {
    this._rafHandles.forEach(h => h?.stop?.());
    this._rafHandles = [];
  },
};

export default AeraulicSection;
