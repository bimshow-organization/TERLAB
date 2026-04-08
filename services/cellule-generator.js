/* ════════════════════════════════════════════════════════════════
 * TERLAB · cellule-generator.js
 * Générateur cellules logement collectif La Réunion
 * Référentiel : 17 plans réels SIDR/SHLMR · 2015-2021
 * v2 — Escaliers/ascenseurs extérieurs couverts (norme LLS Réunion)
 * ════════════════════════════════════════════════════════════════ */

import RTAAValidator from './rtaa-validator.js';

const CelluleGenerator = {

  _rules: null,

  // ── Init ──────────────────────────────────────────────────────

  async init() {
    const base = import.meta.url
      ? new URL('../data/cellule-rules.json', import.meta.url).href
      : 'data/cellule-rules.json';
    this._rules = await fetch(base).then(r => r.json());
    console.log('[CelluleGenerator] Initialisé · Types:', Object.keys(this._rules.types));
    console.log('[CelluleGenerator] Noyau défaut:', this._rules.noyau_circulation.default_type);
  },

  // ── Génération cellule ────────────────────────────────────────

  generate(typeId, options = {}) {
    if (!this._rules) throw new Error('CelluleGenerator non initialisé');
    const typeRules = this._rules.types[typeId];
    if (!typeRules) throw new Error(`Type inconnu: ${typeId}`);

    const {
      stagger_offset_m      = 0,
      depth_variation       = 0,
      width_override        = null,
      position              = 'MILIEU',
      varangue_profondeur_m = null,
      noyau_type            = this._rules.noyau_circulation.default_type,
      is_rdc                = false,
      is_attique            = false
    } = options;

    const dz = typeRules.depth_zones || {};
    const varP = varangue_profondeur_m ?? (dz.varangue?.std ?? 3.2);

    const sechoir_d = this._lerp(dz.sechoir?.min ?? 0.8,   dz.sechoir?.max ?? 1.5,  0.5 + depth_variation * 0.5);
    const chambre_d = this._lerp(dz.chambres?.min ?? dz.chambre?.min ?? 2.8, dz.chambres?.max ?? dz.chambre?.max ?? 3.6, 0.5 + depth_variation * 0.5);
    const humide_d  = dz.humide?.std ?? 2.0;
    const sejour_d  = this._lerp(dz.sejour?.min ?? 3.5,    dz.sejour?.max ?? 5.0,   0.5 + depth_variation * 0.5);
    const totalDepth = sechoir_d + chambre_d + humide_d + sejour_d + varP;

    const width = width_override ?? typeRules.width_m?.target ?? 8.0;
    const noyauDef = this._rules.noyau_circulation.types[noyau_type]
                  ?? this._rules.noyau_circulation.types.EXTERIEUR_COUVERT;

    const pieces = typeRules.pieces ?? {};
    const surfaces = {};
    Object.entries(pieces).forEach(([k, d]) => {
      surfaces[k] = d.target ?? ((d.min + d.max) / 2);
    });

    const facades    = this._computeFacades(position, typeId);
    const rtaaRules  = typeRules.rtaa ?? {};
    const cm_varangue = RTAAValidator.computeCm('VARANGUE_PROFONDE', varP * 100, 150);
    const rtaaResult  = RTAAValidator.validateCellule({
      width_m:               width,
      varangue_profondeur_m: varP,
      sejour_baies_m2:       rtaaRules.baie_sejour?.libre_m2 ?? 0,
      sejour_facade_m2:      width * 2.5,
      cuisine_jalousie:      true,
      porte_paliere:         true
    }, typeRules);

    return {
      id:            `${typeId}_${Date.now()}`,
      type:          typeId,
      label:         typeRules.label,
      width_m:       Math.round(width * 100) / 100,
      depth_total_m: Math.round(totalDepth * 100) / 100,
      depth_varangue:Math.round(varP * 100) / 100,
      stagger_offset_m,
      niveaux:       typeRules.niveaux ?? 1,
      position,
      facades,
      depth_zones: {
        sechoir:  Math.round(sechoir_d * 100) / 100,
        chambre:  Math.round(chambre_d * 100) / 100,
        humide:   Math.round(humide_d * 100) / 100,
        sejour:   Math.round(sejour_d * 100) / 100,
        varangue: Math.round(varP * 100) / 100
      },
      surfaces,
      surface_utile_m2: Math.round(
        (surfaces.sejour ?? surfaces.sejour_sam ?? 21) + (surfaces.cuisine ?? 0) +
        (surfaces.chambre1 ?? 0) + (surfaces.chambre2 ?? 0) +
        (surfaces.chambre3 ?? 0) + (surfaces.sdb ?? 5) +
        (surfaces.wc ?? 0) + (surfaces.degt ?? 0)
      ),
      cm_varangue,
      rtaa:       rtaaResult,
      menuiseries: this._generateMenuiseries(typeId, rtaaRules),

      noyau: {
        type:      noyau_type,
        label:     noyauDef.label,
        position:  noyauDef.position,
        saillie_m: noyauDef.saillie_m?.std ?? 0,
        largeur_consommee_m: noyauDef.largeur_consommee_m?.std ?? 0,
        impact:    noyauDef.impact_largeur_cellules
      },

      constantes: {
        sechoir_position: 'COURSIVE_SIDE',
        varangue_position:'FACADE_PRINCIPALE',
        groupe_humide:    'CLUSTER_CENTRAL',
        cuisine_position: 'COTE_SERVICE',
        jalousies_cuisine:true,
        hsp_std_m:        2.50,
        hsp_varangue_m:   3.00,
        wc_separe:        typeRules.wc_separe ?? false
      },
      module_sdb:   this._rules.module_sdb,
      generated_at: new Date().toISOString(),
      source:       '17 plans réels La Réunion 2015-2021'
    };
  },

  // ── Génération plateau ────────────────────────────────────────

  generatePlateau(config) {
    const {
      type_batiment    = 'lame_simple',
      mixite           = [{ type: 'T2', count: 3 }, { type: 'T3', count: 2 }],
      width_batiment_m = 55,
      stagger          = false,
      stagger_offset_m = 1.0,
      noyau_type       = null,
      noyau_spacing_m  = 12.0,
      avec_ascenseur   = false
    } = config;

    const profil       = (this._rules.profils_batiment || []).find(p => p.id === type_batiment);
    const noyauEffectif = noyau_type
      ?? profil?.noyau_recommande
      ?? this._rules.noyau_circulation.default_type;

    const noyauDef = this._rules.noyau_circulation.types[noyauEffectif]
                  ?? this._rules.noyau_circulation.types.EXTERIEUR_COUVERT;

    const noyauWidthInBat = noyauDef.position === 'DANS_BATIMENT'
      ? (noyauDef.largeur_consommee_m?.std ?? 1.80)
      : noyauDef.position === 'SEMI_INTEGRE'
        ? (noyauDef.largeur_consommee_m?.std ?? 0.80)
        : 0;

    const noyauSaillie = noyauDef.saillie_m?.std ?? 0;
    const ascWidth = avec_ascenseur ? 1.40 : 0;
    const noyauTotalW = noyauWidthInBat + ascWidth;

    const cellules = [];
    const noyaux   = [];
    let currentX   = 0;
    let noyauX     = noyau_spacing_m;

    mixite.forEach(({ type, count }) => {
      for (let i = 0; i < count; i++) {
        if (cellules.length > 0 && currentX >= noyauX) {
          noyaux.push({
            x_m:       currentX,
            type:      noyauEffectif,
            label:     noyauDef.label,
            position:  noyauDef.position,
            saillie_m: noyauSaillie,
            width_m:   noyauTotalW,
            avec_asc:  avec_ascenseur
          });
          currentX += noyauTotalW;
          noyauX    = currentX + noyau_spacing_m;
        }

        const staggerThisOne = stagger && (i % 2 === 1);
        const position = i === 0 ? 'COIN_GAUCHE'
                       : (currentX + 6 >= width_batiment_m) ? 'COIN_DROIT'
                       : 'MILIEU';

        const cellule = this.generate(type, {
          position,
          noyau_type: noyauEffectif,
          stagger_offset_m: staggerThisOne ? stagger_offset_m : 0,
          depth_variation: 0
        });

        cellule.plateau_x_m = currentX;
        cellule.plateau_y_m = staggerThisOne ? stagger_offset_m : 0;
        cellules.push(cellule);
        currentX += cellule.width_m;
        if (currentX >= width_batiment_m) break;
      }
    });

    if (noyaux.length === 0 && cellules.length >= 2) {
      const midX = currentX / 2;
      noyaux.push({
        x_m: midX, type: noyauEffectif, label: noyauDef.label,
        position: noyauDef.position, saillie_m: noyauSaillie,
        width_m: noyauTotalW, avec_asc: avec_ascenseur
      });
    }

    const profondeur_max = Math.max(...cellules.map(c => c.depth_total_m + c.plateau_y_m));

    return {
      id: `plateau_${Date.now()}`,
      type_batiment,
      profil:     profil?.label ?? type_batiment,
      noyau_type: noyauEffectif,
      cellules,
      noyaux,
      dimensions: {
        longueur_m:           Math.round(currentX * 100) / 100,
        profondeur_m:         Math.round(profondeur_max * 100) / 100,
        saillie_noyau_m:      Math.round(noyauSaillie * 100) / 100,
        profondeur_totale_m:  Math.round((profondeur_max + noyauSaillie) * 100) / 100
      },
      mixite_reelle: this._computeMixite(cellules),
      stats:         this._computeStats(cellules)
    };
  },

  // ── Rendu SVG plateau ─────────────────────────────────────────

  renderPlateauSVG(plateau, container, scale = 36) {
    const { cellules, noyaux, dimensions } = plateau;

    const saillieH  = (dimensions.saillie_noyau_m ?? 0) * scale;
    const coursiveH = 0.80 * scale;
    const offX      = 60;
    const offY      = 60 + saillieH;

    const W = dimensions.longueur_m * scale + 140;
    const H = offY + coursiveH + dimensions.profondeur_m * scale + 80;

    const C = {
      varangue:'#5DCAA5', sejour:'#9FE1CB', humide:'#B5D4F4',
      chambre:'#FAEEDA',  sechoir:'#FAC775', coursive:'#D3D1C7',
      noyau_ext:'#C8B888', noyau_int:'#A09070', asc:'#9ABFDA'
    };

    let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
      <defs>
        <pattern id="p_esc" patternUnits="userSpaceOnUse" width="5" height="5">
          <line x1="0" y1="0" x2="5" y2="5" stroke="rgba(90,70,40,.4)" stroke-width=".6"/>
          <line x1="5" y1="0" x2="0" y2="5" stroke="rgba(90,70,40,.4)" stroke-width=".6"/>
        </pattern>
      </defs>`;

    // Nord
    svg += `<text x="${offX-30}" y="${offY - saillieH + 14}" font-size="9" fill="#888"
              font-family="Inconsolata,monospace">N &#8593;</text>`;

    // ── Noyaux EXTÉRIEURS (saillie AU-DESSUS coursive) ──
    noyaux.filter(n => n.position === 'SAILLIE_COURSIVE').forEach(n => {
      const nx = offX + n.x_m * scale;
      const nw = Math.max(n.width_m, 1.40) * scale;
      const nh = n.saillie_m * scale;
      const ny = offY - nh;

      // Auvent
      svg += `<rect x="${nx-4}" y="${ny-5}" width="${nw+8}" height="${nh + coursiveH + 5}"
                fill="none" stroke="rgba(100,80,40,.35)" stroke-width="0.8"
                stroke-dasharray="4,2" rx="2"/>`;
      svg += `<text x="${nx + nw/2}" y="${ny - 7}" text-anchor="middle"
                font-size="6.5" fill="rgba(90,70,40,.55)" font-family="Inconsolata,monospace">auvent</text>`;

      // Escalier ext.
      const escW = n.avec_asc ? nw * 0.60 : nw;
      svg += `<rect x="${nx}" y="${ny}" width="${escW}" height="${nh}"
                fill="${C.noyau_ext}" stroke="rgba(90,70,40,.6)" stroke-width="0.8"/>`;
      svg += `<rect x="${nx}" y="${ny}" width="${escW}" height="${nh}"
                fill="url(#p_esc)" opacity="0.65"/>`;
      for (let s = 1; s < 5; s++) {
        svg += `<line x1="${nx}" y1="${ny + nh/5*s}" x2="${nx+escW}" y2="${ny + nh/5*s}"
                  stroke="rgba(90,70,40,.25)" stroke-width="0.5"/>`;
      }
      svg += `<text x="${nx+escW/2}" y="${ny+nh/2+4}" text-anchor="middle"
                font-size="8" fill="rgba(80,60,30,.7)">&#8593;</text>`;
      svg += `<text x="${nx+escW/2}" y="${ny+nh/2+13}" text-anchor="middle"
                font-size="6.5" fill="rgba(80,60,30,.6)" font-family="Inconsolata,monospace">ESC</text>`;

      // Ascenseur ext. accolé
      if (n.avec_asc) {
        const ax = nx + escW + 1;
        const aw = nw - escW - 1;
        svg += `<rect x="${ax}" y="${ny}" width="${aw}" height="${nh}"
                  fill="${C.asc}" stroke="rgba(50,90,130,.55)" stroke-width="0.8"/>`;
        const cr = Math.min(aw, nh) * 0.27;
        svg += `<circle cx="${ax+aw/2}" cy="${ny+nh/2}" r="${cr}"
                  fill="none" stroke="rgba(40,80,120,.55)" stroke-width="0.8"/>`;
        svg += `<text x="${ax+aw/2}" y="${ny+nh/2+4}" text-anchor="middle"
                  font-size="7" fill="rgba(30,70,110,.8)">A</text>`;
      }
    });

    // ── Coursive ──
    svg += `<rect x="${offX}" y="${offY}" width="${dimensions.longueur_m*scale}" height="${coursiveH}"
              fill="${C.coursive}" stroke="#999" stroke-width="0.5"/>`;
    svg += `<text x="${offX+8}" y="${offY+coursiveH/2+4}" font-size="8" fill="#666"
              font-family="Inconsolata,monospace">Coursive ext.</text>`;

    // ── Noyaux INTÉRIEURS ──
    noyaux.filter(n => n.position === 'DANS_BATIMENT' || n.position === 'SEMI_INTEGRE').forEach(n => {
      const nx = offX + n.x_m * scale;
      const nw = n.width_m * scale;
      const ny = offY + coursiveH;
      const nh = dimensions.profondeur_m * scale;

      svg += `<rect x="${nx}" y="${ny}" width="${nw}" height="${nh}"
                fill="${C.noyau_int}" stroke="rgba(80,65,35,.6)" stroke-width="0.8"/>`;
      svg += `<rect x="${nx}" y="${ny}" width="${nw}" height="${nh}"
                fill="url(#p_esc)" opacity="0.55"/>`;

      const escW = n.avec_asc ? nw * 0.62 : nw;
      svg += `<text x="${nx+escW/2}" y="${ny+nh/2-4}" text-anchor="middle"
                font-size="8" fill="rgba(70,55,30,.7)">&#8593;&#8595;</text>`;
      svg += `<text x="${nx+escW/2}" y="${ny+nh/2+8}" text-anchor="middle"
                font-size="6.5" fill="rgba(70,55,30,.6)" font-family="Inconsolata,monospace">ESC INT.</text>`;

      if (n.avec_asc) {
        const ax = nx + escW;
        const aw = nw - escW;
        svg += `<rect x="${ax}" y="${ny}" width="${aw}" height="${nh}"
                  fill="${C.asc}" stroke="rgba(50,90,130,.5)" stroke-width="0.8"/>`;
        const cr = Math.min(aw, nh) * 0.25;
        svg += `<circle cx="${ax+aw/2}" cy="${ny+nh/2}" r="${cr}"
                  fill="none" stroke="rgba(40,80,120,.5)" stroke-width="0.8"/>`;
        svg += `<text x="${ax+aw/2}" y="${ny+nh/2+4}" text-anchor="middle"
                  font-size="7" fill="rgba(30,70,110,.8)">A</text>`;
      }
    });

    // ── Cellules ──
    const zoneLabels = { sechoir:'Sch', chambre:'Ch.', humide:'Hum.', sejour:'Sj.', varangue:'Var.' };
    cellules.forEach(c => {
      const cx = offX + c.plateau_x_m * scale;
      const cy = offY + coursiveH + c.plateau_y_m * scale;
      const cw = c.width_m * scale;
      let zy = cy;

      [
        { key:'sechoir',  d: c.depth_zones.sechoir,  col: C.sechoir  },
        { key:'chambre',  d: c.depth_zones.chambre,   col: C.chambre  },
        { key:'humide',   d: c.depth_zones.humide,    col: C.humide   },
        { key:'sejour',   d: c.depth_zones.sejour,    col: C.sejour   },
        { key:'varangue', d: c.depth_zones.varangue,  col: C.varangue }
      ].forEach(z => {
        const zh = z.d * scale;
        svg += `<rect x="${cx}" y="${zy}" width="${cw-1}" height="${zh}"
                  fill="${z.col}" stroke="rgba(0,0,0,.18)" stroke-width="0.5"/>`;
        if (zh > 14)
          svg += `<text x="${cx+cw/2}" y="${zy+zh/2+3}" text-anchor="middle"
                    font-size="7.5" fill="rgba(0,0,0,.5)">${zoneLabels[z.key]}</text>`;
        zy += zh;
      });

      // Cadre + labels
      svg += `<rect x="${cx}" y="${cy}" width="${cw-1}" height="${c.depth_total_m*scale}"
                fill="none" stroke="rgba(0,0,0,.4)" stroke-width="0.9"/>`;
      const lyBase = cy + (c.depth_zones.sechoir + c.depth_zones.chambre + c.depth_zones.humide) * scale;
      svg += `<text x="${cx+cw/2}" y="${lyBase + c.depth_zones.sejour*scale/2 - 4}"
                text-anchor="middle" font-size="9" font-weight="500" fill="#1a3a1a">${c.type}</text>`;
      svg += `<text x="${cx+cw/2}" y="${lyBase + c.depth_zones.sejour*scale/2 + 8}"
                text-anchor="middle" font-size="7" fill="#555">${c.surface_utile_m2}m&#178;</text>`;

      // RTAA dot
      svg += `<circle cx="${cx+cw-8}" cy="${cy+8}" r="5"
                fill="${c.rtaa.conforme ? '#3A6B3A' : '#A32D2D'}" opacity="0.8"/>`;

      // Cote largeur
      svg += `<text x="${cx+cw/2}" y="${offY - saillieH - 4}" text-anchor="middle"
                font-size="7" fill="#777">${c.width_m}m</text>`;
    });

    // ── Cote profondeur totale ──
    const px   = offX + dimensions.longueur_m * scale + 16;
    const yTop = offY - saillieH;
    const yBot = offY + coursiveH + dimensions.profondeur_m * scale;
    svg += `<line x1="${px}" y1="${yTop}" x2="${px}" y2="${yBot}"
              stroke="#888" stroke-width="0.5" stroke-dasharray="3,2"/>`;
    svg += `<line x1="${px-4}" y1="${yTop}" x2="${px+4}" y2="${yTop}" stroke="#888" stroke-width="0.5"/>`;
    svg += `<line x1="${px-4}" y1="${yBot}" x2="${px+4}" y2="${yBot}" stroke="#888" stroke-width="0.5"/>`;
    svg += `<text x="${px+6}" y="${(yTop+yBot)/2+4}" font-size="8" fill="#666">
              ${(dimensions.profondeur_totale_m ?? dimensions.profondeur_m).toFixed(1)}m</text>`;

    // ── Légende ──
    const legY = yBot + 16;
    const legItems = [
      ['S\u00e9choir',C.sechoir],['Chambre',C.chambre],['Humide',C.humide],
      ['S\u00e9jour',C.sejour],['Varangue',C.varangue],['Coursive',C.coursive],
      ['Esc. ext.',C.noyau_ext],['Ascenseur',C.asc]
    ];
    legItems.forEach(([l, col], i) => {
      const lx = offX + i * 74;
      svg += `<rect x="${lx}" y="${legY}" width="11" height="7"
                fill="${col}" stroke="rgba(0,0,0,.2)" stroke-width="0.4"/>`;
      svg += `<text x="${lx+14}" y="${legY+6}" font-size="7" fill="#666"
                font-family="Inconsolata,monospace">${l}</text>`;
    });
    svg += `<circle cx="${offX + legItems.length*74 + 5}" cy="${legY+3}" r="4"
              fill="#3A6B3A" opacity="0.8"/>`;
    svg += `<text x="${offX + legItems.length*74 + 13}" y="${legY+6}" font-size="7" fill="#666"
              font-family="Inconsolata,monospace">RTAA OK</text>`;

    svg += '</svg>';

    if (typeof container === 'string') {
      const el = document.getElementById(container);
      if (el) el.innerHTML = svg;
    } else if (container?.innerHTML !== undefined) {
      container.innerHTML = svg;
    }
    return svg;
  },

  // ── Helpers ───────────────────────────────────────────────────

  _lerp(a, b, t) {
    return Math.round((a + (b-a) * Math.max(0, Math.min(1, t))) * 100) / 100;
  },

  _computeFacades(position) {
    if (['COIN_GAUCHE','COIN_DROIT','BOUT'].includes(position))
      return { nb_facades: 3, descriptions: ['facade_principale','facade_service','facade_pignon'] };
    return { nb_facades: 2, descriptions: ['facade_principale','facade_service'] };
  },

  _generateMenuiseries(typeId, r) {
    const m = [];
    if (r.baie_sejour)     m.push({ piece:'sejour',  ...r.baie_sejour });
    if (r.jalousie_cuisine)m.push({ piece:'cuisine', type:'JALOUSIE', ...r.jalousie_cuisine, obligatoire:true });
    if (r.jalousie_sdb)    m.push({ piece:'sdb',     type:'JALOUSIE', ...r.jalousie_sdb,     obligatoire:true });
    return m;
  },

  _computeMixite(cellules) {
    const c = {};
    cellules.forEach(cl => { c[cl.type] = (c[cl.type] ?? 0) + 1; });
    return c;
  },

  _computeStats(cellules) {
    const su = cellules.map(c => c.surface_utile_m2);
    return {
      n_logements:             cellules.length,
      surface_utile_totale_m2: su.reduce((a,b) => a+b, 0),
      surface_utile_moy_m2:    Math.round(su.reduce((a,b)=>a+b,0) / su.length),
      rtaa_conformes:          cellules.filter(c => c.rtaa.conforme).length
    };
  }
};

export default CelluleGenerator;
