// TERLAB · services/anc-plan-service.js · Plan ANC SVG
// Génère le plan d'implantation Assainissement Non Collectif en SVG
// Placement automatique : fosse toutes eaux + zone traitement + reculs
// Même pattern que giep-plan-service.js
// ENSA La Réunion · MGA Architecture

import ANCService from './anc-service.js';
import FH from './footprint-helpers.js';

// ── STYLES OUVRAGES ANC ─────────────────────────────────────────────
const ANC_STYLES = {
  fosse:            { fill: '#6B7280', stroke: '#374151', label: 'Fosse toutes eaux' },
  epandage:         { fill: '#A78BFA', stroke: '#7C3AED', label: 'Tranchées d\'épandage', hatch: true },
  filtre_sable:     { fill: '#FBBF24', stroke: '#D97706', label: 'Filtre à sable' },
  filtre_plante:    { fill: '#34D399', stroke: '#059669', label: 'Filtre planté (phyto)' },
  micro_station:    { fill: '#60A5FA', stroke: '#2563EB', label: 'Micro-station' },
  filtre_compact:   { fill: '#F472B6', stroke: '#DB2777', label: 'Filtre compact' },
  tertre:           { fill: '#D4A574', stroke: '#92400E', label: 'Tertre d\'infiltration' },
  recul:            { stroke: '#EF4444', label: 'Zone de recul', dash: '0.5,0.3' },
  canalisation:     { stroke: '#6B7280', label: 'Canalisation EU', dash: '0.3,0.2' },
};

// Map filière id → style key
const FILIERE_TO_STYLE = {
  epandage_classique:          'epandage',
  filtre_sable_vertical:       'filtre_sable',
  filtre_sable_vertical_draine:'filtre_sable',
  micro_station:               'micro_station',
  filtre_plante:               'filtre_plante',
  filtre_compact:              'filtre_compact',
  tertre_infiltration:         'tertre',
};

const ANCPlanService = {

  /**
   * Génère le plan ANC SVG complet
   * @param {Object} session    — session TERLAB
   * @param {Object} proposal   — résultat étude de capacité (bat, blocs)
   * @param {Object} ancResult  — résultat ANCService.computeFromSession()
   * @returns {string} SVG string ou '' si pas d'ANC
   */
  generatePlan(session, proposal, ancResult) {
    if (!proposal || !ancResult?.besoinANC || !ancResult.dimensionnement) return '';

    const r = FH.readProposal(proposal);
    if (!r.blocs.length || !r.bat) return '';

    const terrain = session?.terrain ?? {};
    const bat = r.bat;
    const blocsList = r.blocs;
    const dim = ancResult.dimensionnement;
    const pente_pct = parseFloat(terrain.pente_moy_pct ?? 0);

    // Polygone parcelle local
    const parcelLocal = session?._parcelLocal ?? [];
    const poly = parcelLocal.length >= 3
      ? parcelLocal.map(p => [p.x ?? p[0], p.y ?? p[1]])
      : [[0, 0], [30, 0], [30, 20], [0, 20]];

    // Placement : utiliser celui calculé par ANCService si dispo, sinon fallback
    let placement = ancResult.placement;
    if (!placement) {
      const building = { polygon: blocsList[0]?.polygon ?? null, aabb: bat };
      placement = ANCService.placerSurParcelle(dim, building, poly);
    }

    const bb = this._aabb(poly);
    const maxDim = Math.max(bb.w, bb.h);
    const margin = maxDim * 0.25;

    const vbX = bb.x0 - margin;
    const vbY = -(bb.y1 + margin);
    const vbW = bb.w + margin * 2 + maxDim * 0.5;
    const vbH = bb.h + margin * 2;

    const px = x => x;
    const py = y => -(y);

    // ── SVG START ────────────────────────────────────────────────
    const parcelPts = poly.map(([x, y]) => `${px(x)},${py(y)}`).join(' ');
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}"
      width="100%" style="background:#FAFAF5;font-family:'Inter',sans-serif;color:#18130a">
    <defs>
      <pattern id="anc-hatch" patternUnits="userSpaceOnUse" width="1.5" height="1.5" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="1.5" stroke="#7C3AED" stroke-width="0.2" opacity="0.4"/>
      </pattern>
    </defs>`;

    // 1. Parcelle
    svg += `<polygon points="${parcelPts}" fill="#F0FDF4" fill-opacity="0.5" stroke="#18130a" stroke-width="0.3"/>`;

    // 2. Bâtiment(s)
    blocsList.forEach((bloc) => {
      const polyB = bloc.polygon ?? [];
      if (polyB.length < 3) return;
      const ptsStr = polyB.map(p => `${px(p.x)},${py(p.y)}`).join(' ');
      svg += `<polygon points="${ptsStr}" fill="#B0BEC5" fill-opacity="0.6" stroke="#455A64" stroke-width="0.25"/>`;
    });

    // 4. Fosse toutes eaux (avec rotation bâtiment)
    if (dim.fosse && placement?.fosse) {
      svg += this._drawFosseRot(dim.fosse, placement.fosse, px, py);
    }

    // 5. Zone de traitement (avec rotation bâtiment)
    const styleKey = FILIERE_TO_STYLE[dim.filiereId] ?? 'epandage';
    if (placement?.traitement) {
      svg += this._drawZoneTraitementRot(dim, placement.traitement, styleKey, px, py);
    }

    // 6. Canalisation fosse → traitement
    if (placement?.fosse && placement?.traitement) {
      svg += this._drawCanalisation(placement.fosse, placement.traitement, px, py);
    }

    // 7. Reculs réglementaires
    if (dim.reculs && placement?.fosse) {
      svg += this._drawReculs(placement, dim.reculs, bat, poly, px, py, bb);
    }

    // 7b. Alerte si placement infaisable
    if (placement && !placement.feasible) {
      svg += this._drawInfeasibilityWarning(placement, bb, px, py);
    }

    // 8. Cotes et labels
    svg += this._drawLabels(dim, ancResult, placement, px, py, bb, margin);

    // 9. Légende
    svg += this._renderLegend(dim, ancResult, bb, margin, py);

    // 10. Nord + échelle
    svg += this._renderNorthArrow(bb, margin, px, py);

    svg += '</svg>';
    return svg;
  },

  // ── Placement automatique : fosse en aval proche du bâtiment,
  //    zone traitement plus loin en aval ─────────────────────────
  _computePlacement(bat, poly, pente_pct, dim) {
    // Direction aval : on prend le point le plus bas de la parcelle
    const bb = this._aabb(poly);
    // Par convention, l'aval est vers y négatif (bas du plan)
    // On place la fosse à 3m du bâtiment côté bas, la zone traitement à 5m de la fosse

    const fosseLarg = dim.fosse?.largeur_m ?? 1.5;
    const fosseLong = dim.fosse?.longueur_m ?? 2.5;

    // Centre fosse : 3m sous le bâtiment
    const fosseX = bat.x + bat.w / 2;
    const fosseY = bat.y - 3 - fosseLarg / 2;

    // Zone traitement : sous la fosse
    const traitH = this._traitementHeight(dim);
    const traitW = this._traitementWidth(dim);
    const traitX = fosseX;
    const traitY = fosseY - fosseLarg / 2 - 2 - traitH / 2;

    return {
      fosse: { cx: fosseX, cy: fosseY, w: fosseLong, h: fosseLarg },
      traitement: { cx: traitX, cy: traitY, w: traitW, h: traitH },
    };
  },

  _traitementWidth(dim) {
    if (dim.tranchees) {
      return Math.max(5, dim.tranchees.nombre * dim.tranchees.entraxe_m);
    }
    if (dim.filtres) {
      return Math.max(4, Math.sqrt(dim.filtres.total_m2) * 1.3);
    }
    return Math.max(3, Math.sqrt(dim.empriseFiliere_m2));
  },

  _traitementHeight(dim) {
    if (dim.tranchees) {
      return Math.max(4, dim.tranchees.longueur_m * 0.5);
    }
    if (dim.filtres) {
      return Math.max(3, Math.sqrt(dim.filtres.total_m2) * 0.8);
    }
    return Math.max(2, Math.sqrt(dim.empriseFiliere_m2) * 0.7);
  },

  // ── Dessin fosse toutes eaux AVEC ROTATION (aligné bâtiment) ──
  _drawFosseRot(fosse, pos, px, py) {
    if (!fosse || !pos) return '';
    const st = ANC_STYLES.fosse;
    const angleDeg = (pos.rotation ?? 0) * 180 / Math.PI;
    const cx = pos.cx, cy = pos.cy;
    const hw = pos.w / 2, hh = pos.h / 2;
    // Rectangle centré à l'origine puis transformé (translate + rotate)
    let svg = `<g transform="translate(${px(cx)},${py(cy)}) rotate(${-angleDeg})">
      <rect x="${-hw}" y="${-hh}" width="${pos.w}" height="${pos.h}"
        fill="${st.fill}" fill-opacity="0.5" stroke="${st.stroke}" stroke-width="0.2" rx="0.3"/>
      <text x="0" y="0.3" text-anchor="middle" font-size="0.8" fill="#fff" font-weight="bold">FTE</text>
      <text x="0" y="1.2" text-anchor="middle" font-size="0.6" fill="${st.stroke}">${fosse.volume_m3} m³</text>
    </g>`;
    return svg;
  },

  // ── Dessin zone traitement AVEC ROTATION ─────────────────────
  _drawZoneTraitementRot(dim, pos, styleKey, px, py) {
    if (!pos) return '';
    const st = ANC_STYLES[styleKey] ?? ANC_STYLES.epandage;
    const angleDeg = (pos.rotation ?? 0) * 180 / Math.PI;
    const hw = pos.w / 2, hh = pos.h / 2;
    const fill = st.hatch ? 'url(#anc-hatch)' : st.fill;
    const fillOp = st.hatch ? '1' : '0.4';

    let inner = '';
    if (st.hatch) {
      inner += `<rect x="${-hw}" y="${-hh}" width="${pos.w}" height="${pos.h}"
        fill="${st.fill}" fill-opacity="0.15" stroke="none" rx="0.2"/>`;
    }
    inner += `<rect x="${-hw}" y="${-hh}" width="${pos.w}" height="${pos.h}"
      fill="${fill}" fill-opacity="${fillOp}" stroke="${st.stroke}" stroke-width="0.2"
      stroke-dasharray="${st.dash ?? 'none'}" rx="0.2"/>`;

    // Tranchées individuelles
    if (dim.tranchees && dim.tranchees.nombre > 1) {
      const entraxe = pos.w / dim.tranchees.nombre;
      for (let i = 0; i < dim.tranchees.nombre; i++) {
        const tx = -hw + entraxe * (i + 0.5);
        inner += `<line x1="${tx}" y1="${-hh}" x2="${tx}" y2="${hh}"
          stroke="${st.stroke}" stroke-width="0.15" stroke-dasharray="0.4,0.2" opacity="0.5"/>`;
      }
    }

    const label = dim.filtres ? 'PHYTO' : dim.tranchees ? 'ÉPANDAGE' : styleKey.toUpperCase().replace('_', ' ');
    inner += `<text x="0" y="0.3" text-anchor="middle" font-size="0.7" fill="${st.stroke}" font-weight="600">${label}</text>`;
    inner += `<text x="0" y="1.2" text-anchor="middle" font-size="0.55" fill="${st.stroke}">${dim.empriseFiliere_m2} m²</text>`;

    return `<g transform="translate(${px(pos.cx)},${py(pos.cy)}) rotate(${-angleDeg})">${inner}</g>`;
  },

  // ── Alerte placement infaisable ──────────────────────────────
  _drawInfeasibilityWarning(placement, bb, px, py) {
    const x = bb.x0 + 1;
    const y = py(bb.y0 + 0.5);
    const reduction = placement.reductionBatiment_m2 ?? 0;
    return `<g>
      <rect x="${x}" y="${y - 1.5}" width="${bb.w - 2}" height="2.5" fill="#FEE2E2" stroke="#DC2626" stroke-width="0.2" rx="0.3"/>
      <text x="${x + 0.5}" y="${y - 0.2}" font-size="0.8" fill="#991B1B" font-weight="bold">⚠ Placement ANC infaisable</text>
      <text x="${x + 0.5}" y="${y + 0.7}" font-size="0.6" fill="#991B1B">Réduire l'emprise du bâtiment de ~${reduction} m² ou choisir une filière compacte.</text>
    </g>`;
  },

  // ── Dessin fosse toutes eaux (legacy, axis-aligned) ───────────
  _drawFosse(fosse, pos, px, py) {
    if (!fosse || !pos) return '';
    const st = ANC_STYLES.fosse;
    const x1 = pos.cx - pos.w / 2;
    const y1 = pos.cy - pos.h / 2;
    let svg = `<rect x="${px(x1)}" y="${py(y1 + pos.h)}" width="${pos.w}" height="${pos.h}"
      fill="${st.fill}" fill-opacity="0.5" stroke="${st.stroke}" stroke-width="0.2" rx="0.3"/>`;
    svg += `<text x="${px(pos.cx)}" y="${py(pos.cy) + 0.3}" text-anchor="middle"
      font-size="0.8" fill="#fff" font-weight="bold">FTE</text>`;
    svg += `<text x="${px(pos.cx)}" y="${py(pos.cy) + 1.2}" text-anchor="middle"
      font-size="0.6" fill="${st.stroke}">${fosse.volume_m3} m³</text>`;
    return svg;
  },

  // ── Dessin zone de traitement ─────────────────────────────────
  _drawZoneTraitement(dim, pos, styleKey, px, py) {
    if (!pos) return '';
    const st = ANC_STYLES[styleKey] ?? ANC_STYLES.epandage;
    const x1 = pos.cx - pos.w / 2;
    const y1 = pos.cy - pos.h / 2;

    let svg = '';

    // Rectangle principal
    const fill = st.hatch ? 'url(#anc-hatch)' : st.fill;
    const fillOp = st.hatch ? '1' : '0.4';
    svg += `<rect x="${px(x1)}" y="${py(y1 + pos.h)}" width="${pos.w}" height="${pos.h}"
      fill="${fill}" fill-opacity="${fillOp}" stroke="${st.stroke}" stroke-width="0.2" stroke-dasharray="${st.dash ?? 'none'}" rx="0.2"/>`;

    // Si hachures, fond coloré léger en dessous
    if (st.hatch) {
      svg = `<rect x="${px(x1)}" y="${py(y1 + pos.h)}" width="${pos.w}" height="${pos.h}"
        fill="${st.fill}" fill-opacity="0.15" stroke="none" rx="0.2"/>` + svg;
    }

    // Tranchées individuelles
    if (dim.tranchees && dim.tranchees.nombre > 1) {
      const entraxe = pos.w / dim.tranchees.nombre;
      for (let i = 0; i < dim.tranchees.nombre; i++) {
        const tx = x1 + entraxe * (i + 0.5);
        svg += `<line x1="${px(tx)}" y1="${py(y1)}" x2="${px(tx)}" y2="${py(y1 + pos.h)}"
          stroke="${st.stroke}" stroke-width="0.15" stroke-dasharray="0.4,0.2" opacity="0.5"/>`;
      }
    }

    // Label central
    const label = dim.filtres ? 'PHYTO' : dim.tranchees ? 'ÉPANDAGE' : styleKey.toUpperCase().replace('_', ' ');
    svg += `<text x="${px(pos.cx)}" y="${py(pos.cy) + 0.3}" text-anchor="middle"
      font-size="0.7" fill="${st.stroke}" font-weight="600">${label}</text>`;
    svg += `<text x="${px(pos.cx)}" y="${py(pos.cy) + 1.2}" text-anchor="middle"
      font-size="0.55" fill="${st.stroke}">${dim.empriseFiliere_m2} m²</text>`;

    return svg;
  },

  // ── Canalisation fosse → traitement ───────────────────────────
  _drawCanalisation(fosse, trait, px, py) {
    const st = ANC_STYLES.canalisation;
    return `<line x1="${px(fosse.cx)}" y1="${py(fosse.cy - fosse.h / 2)}"
      x2="${px(trait.cx)}" y2="${py(trait.cy + trait.h / 2)}"
      stroke="${st.stroke}" stroke-width="0.2" stroke-dasharray="${st.dash}"/>
    <text x="${px((fosse.cx + trait.cx) / 2 + 0.5)}" y="${py((fosse.cy - fosse.h / 2 + trait.cy + trait.h / 2) / 2)}"
      font-size="0.5" fill="${st.stroke}" transform="rotate(-90, ${px((fosse.cx + trait.cx) / 2 + 0.5)}, ${py((fosse.cy - fosse.h / 2 + trait.cy + trait.h / 2) / 2)})">EU ø100</text>`;
  },

  // ── Zones de recul (cercles pointillés) ───────────────────────
  _drawReculs(placement, reculs, bat, poly, px, py, bb) {
    const st = ANC_STYLES.recul;
    let svg = '';

    // Recul depuis la fosse
    if (placement.fosse && reculs.habitation) {
      const r = reculs.habitation;
      svg += `<circle cx="${px(placement.fosse.cx)}" cy="${py(placement.fosse.cy)}" r="${r}"
        fill="none" stroke="${st.stroke}" stroke-width="0.12" stroke-dasharray="${st.dash}" opacity="0.4"/>`;
      svg += `<text x="${px(placement.fosse.cx + r + 0.3)}" y="${py(placement.fosse.cy)}"
        font-size="0.5" fill="${st.stroke}">${r}m hab.</text>`;
    }

    // Recul limite parcelle (lignes le long des bords)
    if (reculs.limite_parcelle) {
      const d = reculs.limite_parcelle;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        if (len < 2) continue;
        const nx = -dy / len * d, ny = dx / len * d;
        svg += `<line x1="${px(a[0] + nx)}" y1="${py(a[1] + ny)}" x2="${px(b[0] + nx)}" y2="${py(b[1] + ny)}"
          stroke="${st.stroke}" stroke-width="0.1" stroke-dasharray="${st.dash}" opacity="0.25"/>`;
      }
    }

    return svg;
  },

  // ── Labels dimensions et cotes ────────────────────────────────
  _drawLabels(dim, ancResult, placement, px, py, bb, margin) {
    let svg = '';

    // Titre
    svg += `<text x="${px(bb.x0 + bb.w / 2)}" y="${py(bb.y1) - 1}" text-anchor="middle"
      font-size="1.3" fill="#18130a" font-weight="bold">Plan ANC — ${dim.short}</text>`;

    // Emprise totale
    svg += `<text x="${px(bb.x0 + bb.w / 2)}" y="${py(bb.y1) - 2.5}" text-anchor="middle"
      font-size="0.9" fill="#555">Emprise totale ANC : ${dim.empriseTotal_m2} m² · ${ancResult.eh} EH · ${ancResult.volume_m3_jour} m³/j</text>`;

    // Coût
    if (ancResult.cout) {
      svg += `<text x="${px(bb.x0 + bb.w / 2)}" y="${py(bb.y1) - 3.8}" text-anchor="middle"
        font-size="0.8" fill="#666">CapEx ≈ ${ancResult.cout.capex_min.toLocaleString()}–${ancResult.cout.capex_max.toLocaleString()} € · OpEx ≈ ${ancResult.cout.opex_annuel} €/an</text>`;
    }

    return svg;
  },

  // ── Légende ───────────────────────────────────────────────────
  _renderLegend(dim, ancResult, bb, margin, py) {
    const x0 = bb.x1 + 2;
    let y = py(bb.y1) + 2;
    const lh = 1.8;
    let svg = '';

    svg += `<text x="${x0}" y="${y}" font-size="0.9" font-weight="bold" fill="#18130a">LÉGENDE ANC</text>`;
    y += lh;

    const items = [
      { key: 'fosse', show: !!dim.fosse },
      { key: FILIERE_TO_STYLE[dim.filiereId] ?? 'epandage', show: true },
      { key: 'canalisation', show: !!dim.fosse },
      { key: 'recul', show: true },
    ];

    for (const item of items) {
      if (!item.show) continue;
      const st = ANC_STYLES[item.key];
      if (!st) continue;

      if (st.fill) {
        svg += `<rect x="${x0}" y="${y - 0.6}" width="1.2" height="0.8"
          fill="${st.fill}" fill-opacity="0.5" stroke="${st.stroke}" stroke-width="0.15" rx="0.1"/>`;
      } else {
        svg += `<line x1="${x0}" y1="${y - 0.2}" x2="${x0 + 1.2}" y2="${y - 0.2}"
          stroke="${st.stroke}" stroke-width="0.2" stroke-dasharray="${st.dash ?? 'none'}"/>`;
      }
      svg += `<text x="${x0 + 1.8}" y="${y}" font-size="0.65" fill="#18130a">${st.label}</text>`;
      y += lh;
    }

    // Infos filière
    y += 0.5;
    svg += `<text x="${x0}" y="${y}" font-size="0.6" fill="#666">K sol : ${ancResult.k_mmh} mm/h (${ancResult.classeK?.label})</text>`;
    y += lh * 0.7;
    svg += `<text x="${x0}" y="${y}" font-size="0.6" fill="#666">Score : ${ancResult.score}/100 — ${ancResult.scoreLabel}</text>`;
    y += lh * 0.7;
    if (ancResult.spanc) {
      svg += `<text x="${x0}" y="${y}" font-size="0.55" fill="#666">SPANC : ${ancResult.spanc.nom} · ${ancResult.spanc.tel}</text>`;
    }

    return svg;
  },

  // ── Nord ──────────────────────────────────────────────────────
  _renderNorthArrow(bb, margin, px, py) {
    const x = bb.x1 + margin * 0.5;
    const y = py(bb.y1) + 0.5;
    return `<g transform="translate(${x},${y})">
      <line x1="0" y1="2" x2="0" y2="-1" stroke="#18130a" stroke-width="0.2"/>
      <polygon points="-0.5,0 0,-1.3 0.5,0" fill="#18130a"/>
      <text x="0" y="-1.8" text-anchor="middle" font-size="0.7" fill="#18130a" font-weight="bold">N</text>
    </g>`;
  },

  // ── Utilitaires géométriques ──────────────────────────────────
  _aabb(poly) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of poly) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  },
};

export default ANCPlanService;
