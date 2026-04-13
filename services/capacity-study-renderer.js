// terlab/services/capacity-study-renderer.js · Étude de capacité SVG + coupe + 3D · v2
// ENSA La Réunion · MGA Architecture 2026
// Vanilla JS ES2022+, aucune dépendance externe
// Produit plan masse SVG A3, coupe gabarit, scène Three.js, métriques
// v2 : multi-blocs + polygones tournés (lit proposal.blocs[] avec fallback legacy)

import FH from './footprint-helpers.js';

const H_NIV = 3.0;
const EDGE_COLORS = { voie: '#EF4444', lat: '#3B82F6', fond: '#22C55E' };
const EDGE_LABELS = { voie: 'voie', lat: 'lat.', fond: 'fond' };

const CapacityStudyRenderer = {

  /**
   * Génère l'étude de capacité complète
   * @returns {{ planSVG, coupeSVG, metricsHTML }}
   */
  async generate(session, proposal, prog, existingMode, existingBldgs) {
    const planSVG    = this.renderPlanMasse(session, proposal, prog, existingBldgs, existingMode);
    const coupeSVG   = this.renderCoupeGabarit(session, proposal, prog);
    const metricsHTML = this.renderMetricsTable(proposal, session);
    return { planSVG, coupeSVG, metricsHTML };
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PLAN MASSE SVG A3
  // ═══════════════════════════════════════════════════════════════════════════

  renderPlanMasse(session, proposal, prog, existingBldgs, existingMode) {
    // Lecture unifiée : blocs[] OU bat legacy
    const r = FH.readProposal(proposal);
    if (!r.blocs.length || !r.bat) return '<svg></svg>';

    const bat = r.bat;            // AABB de l'union des blocs
    const blocs = r.blocs;        // tableau de blocs (1+)
    const TA = window.TerrainP07Adapter;

    // Récupérer polygone parcelle local
    const parcelLocal = session?._parcelLocal ?? [];
    const edgeTypes   = session?._edgeTypes ?? [];
    const poly = parcelLocal.length >= 3
      ? parcelLocal.map(p => [p.x ?? p[0], p.y ?? p[1]])
      : [[0, 0], [30, 0], [30, 20], [0, 20]];

    const bb = TA?.polyAABB(poly) ?? this._aabb(poly);
    const parcelArea = TA?.polyArea(poly) ?? this._area(poly);

    // Échelle auto
    const maxDim = Math.max(bb.w, bb.h);
    const scale = maxDim < 40 ? 200 : maxDim < 100 ? 500 : 1000;
    // Marge réduite (10 % au lieu de 25 %) pour maximiser le zoom sur la parcelle.
    // Le cartouche N+échelle est désormais positionné à l'intérieur du viewBox
    // (top-right) au lieu de déborder à droite comme dans la v1.
    const margin = maxDim * 0.10;

    // ViewBox en mètres (espace local)
    const vbX = bb.x - margin;
    const vbY = -(bb.y + bb.h + margin); // Y inversé pour SVG
    const vbW = bb.w + margin * 2;
    const vbH = bb.h + margin * 2;

    // Fonction de projection (Y inversé)
    const px = x => x;
    const py = y => -(y);

    // Reculs depuis session
    const p4 = session?.phases?.[4]?.data ?? {};
    const reculs = {
      voie: parseFloat(p4.recul_voie_m ?? p4.recul_avant_m ?? 3) || 3,
      fond: parseFloat(p4.recul_fond_m ?? 3) || 3,
      lat:  parseFloat(p4.recul_lat_m ?? 0) || 0,
    };

    // Enveloppe inset
    let envPoly = [];
    if (TA && poly.length >= 3) {
      const reculArr = edgeTypes.map(t => reculs[t] ?? reculs.lat ?? 0);
      const insetResult = TA.insetPoly(poly, reculArr);
      envPoly = insetResult.env ?? [];
    }
    const envArea = TA?.polyArea(envPoly) ?? this._area(envPoly);

    // ── CONSTRUCTION SVG ──────────────────────────────────────────
    // (Le cartouche commune/réf/zone/date/auteur a été retiré : ces infos
    //  figurent déjà en pied de planche TERLAB. On ne garde que N + échelle.)
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}"
      width="420mm" height="297mm" style="background:#F7F4EE;font-family:'Inter',sans-serif;color:#18130a">
    <defs>
      <pattern id="grid-5m" patternUnits="userSpaceOnUse" width="5" height="5">
        <path d="M 5 0 L 0 0 0 5" fill="none" stroke="#999" stroke-width="0.05" opacity="0.15"/>
      </pattern>
      <pattern id="hatch-demo" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="4" stroke="#EF4444" stroke-width="1" opacity="0.7"/>
      </pattern>
      <pattern id="hatch-park" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(-45)">
        <line x1="0" y1="0" x2="0" y2="4" stroke="#666" stroke-width="0.5" opacity="0.4"/>
      </pattern>
    </defs>`;

    // 1. CARTOUCHE — Nord + échelle uniquement, top-right interne au viewBox
    // Les infos commune/réf/zone/date/auteur sont déjà en pied de planche TERLAB.
    // ⚠️  L'unité utilisateur SVG = mètre, mais le SVG est figé à 420×297 mm.
    //    Donc 1 unité ≈ 9–11 mm physiques (pas 2 mm comme à l'échelle 1:500).
    //    Toutes les épaisseurs / tailles ci-dessous sont calibrées en consequence
    //    (×0.3-0.4 par rapport à des valeurs "naturelles" en mm).
    const scaleLen = scale === 200 ? 5 : scale === 500 ? 10 : 20;
    const cartW   = Math.max(8, vbW * 0.18);
    const cartH   = cartW * 0.32;
    const cartPad = vbW * 0.010;
    const cartX   = vbX + vbW - cartW - cartPad;
    const cartY   = vbY + cartPad;
    // Compartiment N (gauche, carré) + compartiment échelle (droite)
    const nBoxW = cartH;                  // carré gauche
    const sBoxW = cartW - nBoxW;          // reste
    const nCx = cartX + nBoxW / 2;
    const nCy = cartY + cartH * 0.55;
    const sCx = cartX + nBoxW + sBoxW / 2;
    const ar  = cartH * 0.28;
    const sBarLen = sBoxW * 0.68;
    const sBarX0  = sCx - sBarLen / 2;
    const sBarY   = cartY + cartH * 0.66;
    const tickH   = cartH * 0.10;
    svg += `<g class="cartouche">
      <rect x="${cartX}" y="${cartY}" width="${cartW}" height="${cartH}"
            fill="#FFFEFB" fill-opacity="0.94"
            stroke="#18130a" stroke-width="0.06" rx="0.25"/>
      <line x1="${cartX + nBoxW}" y1="${cartY + cartH * 0.18}"
            x2="${cartX + nBoxW}" y2="${cartY + cartH * 0.82}"
            stroke="#18130a" stroke-width="0.04" stroke-opacity="0.35"/>
      <!-- Compartiment Nord -->
      <g transform="translate(${nCx},${nCy})">
        <line x1="0" y1="${ar * 0.60}" x2="0" y2="-${ar * 0.40}"
              stroke="#18130a" stroke-width="0.10"/>
        <polygon points="0,-${ar} -${ar * 0.32},-${ar * 0.32} ${ar * 0.32},-${ar * 0.32}"
                 fill="#18130a" stroke="none"/>
        <text x="0" y="${ar * 1.10}" text-anchor="middle"
              font-family="Inter,sans-serif" font-size="${cartH * 0.20}" font-weight="700" fill="#18130a">N</text>
      </g>
      <!-- Compartiment échelle -->
      <g class="scale-cart">
        <line x1="${sBarX0}" y1="${sBarY}" x2="${sBarX0 + sBarLen}" y2="${sBarY}"
              stroke="#18130a" stroke-width="0.10"/>
        <line x1="${sBarX0}" y1="${sBarY - tickH}" x2="${sBarX0}" y2="${sBarY + tickH}"
              stroke="#18130a" stroke-width="0.08"/>
        <line x1="${sBarX0 + sBarLen / 2}" y1="${sBarY - tickH * 0.7}" x2="${sBarX0 + sBarLen / 2}" y2="${sBarY + tickH * 0.7}"
              stroke="#18130a" stroke-width="0.06"/>
        <line x1="${sBarX0 + sBarLen}" y1="${sBarY - tickH}" x2="${sBarX0 + sBarLen}" y2="${sBarY + tickH}"
              stroke="#18130a" stroke-width="0.08"/>
        <text x="${sBarX0}"           y="${sBarY - tickH - 0.04}" text-anchor="middle"
              font-family="IBM Plex Mono,monospace" font-size="${cartH * 0.14}" fill="#18130a">0</text>
        <text x="${sBarX0 + sBarLen}" y="${sBarY - tickH - 0.04}" text-anchor="middle"
              font-family="IBM Plex Mono,monospace" font-size="${cartH * 0.14}" fill="#18130a">${scaleLen}m</text>
        <text x="${sCx}" y="${cartY + cartH * 0.33}" text-anchor="middle"
              font-family="IBM Plex Mono,monospace" font-size="${cartH * 0.16}" font-weight="600" fill="#C1652B">1 / ${scale}</text>
      </g>
    </g>`;

    // 2. TERRAIN — Grille + polygone parcelle
    const parcelPts = poly.map(([x, y]) => `${px(x)},${py(y)}`).join(' ');
    svg += `<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="url(#grid-5m)"/>`;
    svg += `<polygon points="${parcelPts}" fill="#F5F0E0" fill-opacity="0.5" stroke="#18130a" stroke-width="0.10"/>`;
    // Surface parcelle label
    const parcelCx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    svg += `<text x="${px(parcelCx)}" y="${py(bb.y - 1.5)}" text-anchor="middle" font-size="0.85" fill="#18130a" font-weight="600">${Math.round(parcelArea)} m²</text>`;

    // 3. LIMITES PLU — arêtes colorées + zones de recul
    for (let i = 0; i < poly.length; i++) {
      const type = edgeTypes[i] ?? 'lat';
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      const color = EDGE_COLORS[type] ?? '#3B82F6';
      const recul = reculs[type] ?? 0;
      const label = EDGE_LABELS[type] ?? type;

      // Arête colorée — épaisseur 0.20 (~2 mm physiques) au lieu de 0.6 (~6 mm)
      svg += `<line x1="${px(x1)}" y1="${py(y1)}" x2="${px(x2)}" y2="${py(y2)}" stroke="${color}" stroke-width="0.20" stroke-linecap="round"/>`;

      // Label sur l'arête
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      if (recul > 0) {
        svg += `<text x="${px(mx)}" y="${py(my) - 0.5}" text-anchor="middle" font-size="0.55" fill="${color}" font-weight="bold">${label} ${recul}m</text>`;
      }
    }

    // 4. ENVELOPPE
    if (envPoly.length >= 3) {
      const envPts = envPoly.map(([x, y]) => `${px(x)},${py(y)}`).join(' ');
      svg += `<polygon points="${envPts}" fill="#22C55E" fill-opacity="0.06" stroke="#22C55E" stroke-width="0.08" stroke-dasharray="0.40,0.20"/>`;
      const envCx = envPoly.reduce((s, p) => s + p[0], 0) / envPoly.length;
      const envCy = envPoly.reduce((s, p) => s + p[1], 0) / envPoly.length;
      const emprMax = parseFloat(p4.ces_max ?? 60);
      const emprMaxNorm = emprMax > 1 ? emprMax : emprMax * 100;
      svg += `<text x="${px(envCx)}" y="${py(envCy) + 0.6}" text-anchor="middle" font-size="0.55" fill="#22C55E">Env. ${Math.round(envArea)}m² · max ${emprMaxNorm.toFixed(0)}% = ${Math.round(envArea * emprMaxNorm / 100)}m²</text>`;
    }

    // 5. BÂTIMENTS EXISTANTS
    if (existingBldgs?.footprints?.length) {
      for (const fp of existingBldgs.footprints) {
        if (!fp.poly?.length) continue;
        const fpPts = fp.poly.map(([x, y]) => `${px(x)},${py(y)}`).join(' ');
        const fill = existingMode === 'demolition' ? 'url(#hatch-demo)' : 'rgba(148,163,184,.6)';
        const stroke = existingMode === 'demolition' ? '#EF4444' : '#94A3B8';
        const label = existingMode === 'demolition' ? `à démolir ${fp.area.toFixed(0)}m²` : `existant ${fp.area.toFixed(0)}m²`;
        svg += `<polygon points="${fpPts}" fill="${fill}" stroke="${stroke}" stroke-width="0.08"/>`;
        const fpCx = fp.poly.reduce((s, p) => s + p[0], 0) / fp.poly.length;
        const fpCy = fp.poly.reduce((s, p) => s + p[1], 0) / fp.poly.length;
        svg += `<text x="${px(fpCx)}" y="${py(fpCy)}" text-anchor="middle" font-size="0.50" fill="${stroke}" font-weight="bold">${label}</text>`;
      }
    }

    // 6. BÂTIMENT(S) PROPOSÉ(S) — un polygone par bloc
    const nv = proposal.niveaux ?? 2;
    const he = nv * H_NIV;
    const nLgts = proposal.nLgts ?? 0;
    const nvLabel = nv <= 1 ? 'RdC' : `R+${nv - 1}`;
    const batColor = proposal.color ?? '#3B82F6';

    blocs.forEach((bloc, bi) => {
      const polyPts = (bloc.polygon ?? []).map(p => `${px(p.x)},${py(p.y)}`).join(' ');
      if (!polyPts) return;
      svg += `<polygon points="${polyPts}" fill="${batColor}" fill-opacity="0.25" stroke="${batColor}" stroke-width="0.10"/>`;

      // Label par bloc
      const cw = FH.centroidWeighted(bloc.polygon);
      const blocLabel = blocs.length > 1
        ? `B${bi + 1} · ${Math.round(bloc.areaM2 ?? FH.area(bloc.polygon))}m²`
        : `${nLgts} lgts / ${nvLabel} / hé ${he}m`;
      svg += `<text x="${px(cw.x)}" y="${py(cw.y)}" text-anchor="middle" dominant-baseline="central" font-size="0.75" fill="#18130a" font-weight="bold">${blocLabel}</text>`;
    });

    // Label global pour multi-blocs
    if (blocs.length > 1) {
      const allCw = FH.centroidWeighted(blocs.flatMap(b => b.polygon ?? []));
      svg += `<text x="${px(allCw.x)}" y="${py(bat.y + bat.l + 1.5)}" text-anchor="middle" font-size="0.70" fill="#18130a">${nLgts} lgts / ${nvLabel} / hé ${he}m · ${blocs.length} blocs</text>`;
    }

    // Cotations AABB d'ensemble (largeur + profondeur)
    svg += `<text x="${px(bat.x + bat.w / 2)}" y="${py(bat.y) + 0.9}" text-anchor="middle" font-size="0.55" fill="#555">↔ ${bat.w.toFixed(1)}m</text>`;
    svg += `<text x="${px(bat.x + bat.w) + 0.6}" y="${py(bat.y + bat.l / 2)}" font-size="0.55" fill="#555" transform="rotate(-90,${px(bat.x + bat.w) + 0.6},${py(bat.y + bat.l / 2)})">↕ ${bat.l.toFixed(1)}m</text>`;

    // 9. LÉGENDE — bottom-left interne au viewBox (le N + échelle sont dans le cartouche top-right)
    const legW = Math.max(10, vbW * 0.22);
    const legH = legW * 0.20;
    const legX = vbX + cartPad;
    const legY = vbY + vbH - legH - cartPad;
    const legFs = legH * 0.32;
    const colW  = legW / 4;
    svg += `<g class="legend">
      <rect x="${legX}" y="${legY}" width="${legW}" height="${legH}"
            fill="#FFFEFB" fill-opacity="0.94"
            stroke="#18130a" stroke-width="0.06" rx="0.25"/>
      ${[
        { lbl: 'Voie',      col: EDGE_COLORS.voie, dash: false },
        { lbl: 'Latéral',   col: EDGE_COLORS.lat,  dash: false },
        { lbl: 'Fond',      col: EDGE_COLORS.fond, dash: false },
        { lbl: 'Enveloppe', col: '#22C55E',        dash: true  },
      ].map((it, i) => {
        const cx0 = legX + i * colW + colW * 0.08;
        const cx1 = legX + i * colW + colW * 0.32;
        const cy  = legY + legH * 0.55;
        return `
        <line x1="${cx0}" y1="${cy}" x2="${cx1}" y2="${cy}"
              stroke="${it.col}" stroke-width="0.18" stroke-linecap="round"
              ${it.dash ? 'stroke-dasharray="0.30,0.18"' : ''}/>
        <text x="${cx1 + colW * 0.04}" y="${cy + legFs * 0.35}"
              font-family="Inter,sans-serif" font-size="${legFs}" fill="#18130a">${it.lbl}</text>`;
      }).join('')}
    </g>`;

    svg += '</svg>';
    return svg;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // COUPE GABARIT N-S
  // ═══════════════════════════════════════════════════════════════════════════

  renderCoupeGabarit(session, proposal, prog) {
    const r = FH.readProposal(proposal);
    // Fallback rupture C : synthétiser un bloc minimal plutôt qu'un SVG vide
    // (utilisé quand proposal arrive sans blocs/bat, ex. export PDF avant génération)
    let _fallback = false;
    if (!r.blocs.length) {
      const wDef = proposal?.bat?.w ?? proposal?.w ?? 8;
      const lDef = proposal?.bat?.l ?? proposal?.l ?? 10;
      const nvDef = proposal?.niveaux ?? prog?.niveaux ?? 2;
      const poly = FH.batToPolygon({ x: 0, y: 0, w: wDef, l: lDef });
      r.blocs = [FH.makeBloc(poly, nvDef)];
      r.bat = { x: 0, y: 0, w: wDef, l: lDef };
      r.primaryPolygon = poly;
      r.primaryBloc = r.blocs[0];
      _fallback = true;
    }

    // Pour la coupe, on prend le bloc le plus profond (max longueur)
    // et on utilise sa vraie profondeur (le long de son axe local).
    let coupeBloc = r.blocs[0];
    let coupeProf = coupeBloc.l ?? 0;
    for (const b of r.blocs) {
      const lens = FH.edgeLengths(b.polygon ?? []);
      if (!lens.length) continue;
      // Profondeur = plus petite dimension entre les arêtes paires/impaires (rect rotated)
      // Pour un rectangle, edges 0,2 sont parallèles et edges 1,3 aussi → on prend min de l'une des paires
      const dProf = lens.length >= 2 ? Math.min(lens[0], lens[1]) : 0;
      if (dProf > coupeProf) { coupeProf = dProf; coupeBloc = b; }
    }
    // Profondeur N-S effective : utiliser la dimension réelle du bloc
    const lensCoupe = FH.edgeLengths(coupeBloc.polygon ?? []);
    const profEff = lensCoupe.length >= 2 ? Math.min(lensCoupe[0], lensCoupe[1]) : (coupeBloc.l ?? r.bat.l);
    const widthEff = lensCoupe.length >= 2 ? Math.max(lensCoupe[0], lensCoupe[1]) : (coupeBloc.w ?? r.bat.w);
    // bat compat pour le reste de la fonction
    const bat = { x: 0, y: 0, w: widthEff, l: profEff };
    const nv = proposal.niveaux ?? 2;
    const he = nv * H_NIV;

    const p4 = session?.phases?.[4]?.data ?? {};
    const pluCfg = window.TERLAB_PLU_CONFIG?.plu ?? {};
    const heMax = parseFloat(p4.hauteur_max_m ?? p4.hauteur_egout_m ?? 9) || 9;
    const reculVoie = parseFloat(p4.recul_voie_m ?? p4.recul_avant_m ?? 3) || 3;
    const reculFond = parseFloat(p4.recul_fond_m ?? 3) || 3;
    const pente = parseFloat(session?.terrain?.pente_pct ?? 0);

    // Pente toiture depuis PLU (pct → degrés), fallback 30% = ~17° (RTAA DOM min 20°)
    const penteToitMinPct = pluCfg.pente_toiture_min_pct ?? 30;
    const penteToitMaxPct = pluCfg.pente_toiture_max_pct ?? 100;
    const penteToitPct = Math.max(penteToitMinPct, 30); // au moins 30% (RTAA DOM)
    const penteToitDeg = Math.atan(penteToitPct / 100) * 180 / Math.PI;
    const hf = he + Math.tan(penteToitPct / 100) * (bat.l / 2);

    // Dimensions coupe
    const totalW = reculVoie + bat.l + 1.5 + reculFond; // + varangue
    const totalH = Math.max(hf + 3, heMax + 3);
    const margin = 4;

    const vbX = -margin;
    const vbY = -(totalH + margin);
    const vbW = totalW + margin * 3;
    const vbH = totalH + margin * 2;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}"
      width="420mm" height="200mm" style="background:#F7F4EE;font-family:'Inter',sans-serif">`;

    // 1. Sol naturel
    const slopeY = (x) => -pente / 100 * x;
    svg += `<line x1="0" y1="${slopeY(0)}" x2="${totalW}" y2="${slopeY(totalW)}" stroke="#8B7355" stroke-width="0.3"/>`;
    svg += `<rect x="0" y="0" width="${totalW}" height="${margin}" fill="#D4C9A8" opacity="0.3"/>`;

    // 2. Zone de recul voie
    svg += `<rect x="0" y="${-totalH}" width="${reculVoie}" height="${totalH}" fill="#EF4444" opacity="0.06"/>`;
    svg += `<text x="${reculVoie / 2}" y="${-totalH + 1.5}" text-anchor="middle" font-size="0.9" fill="#EF4444">voie ${reculVoie}m</text>`;

    // 3. Zone de recul fond
    const fondX = reculVoie + bat.l + 1.5;
    svg += `<rect x="${fondX}" y="${-totalH}" width="${reculFond}" height="${totalH}" fill="#22C55E" opacity="0.06"/>`;
    svg += `<text x="${fondX + reculFond / 2}" y="${-totalH + 1.5}" text-anchor="middle" font-size="0.9" fill="#22C55E">fond ${reculFond}m</text>`;

    // 4. Volume bâtiment
    const batX = reculVoie;
    const color = proposal.color ?? '#3B82F6';

    // Corps principal
    svg += `<rect x="${batX}" y="${-he}" width="${bat.l}" height="${he}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="0.25"/>`;

    // Niveaux
    for (let i = 0; i < nv; i++) {
      const y = -(i + 1) * H_NIV;
      svg += `<line x1="${batX}" y1="${y}" x2="${batX + bat.l}" y2="${y}" stroke="#666" stroke-width="0.1" stroke-dasharray="0.5,0.3"/>`;
      const label = i === 0 ? 'RdC' : `R+${i}`;
      svg += `<text x="${batX + 0.5}" y="${y + H_NIV / 2 + 0.4}" font-size="0.8" fill="#333">${label}</text>`;
    }

    // Varangue nord
    svg += `<rect x="${batX + bat.l}" y="${-H_NIV}" width="1.5" height="${H_NIV}" fill="#D4A574" fill-opacity="0.35" stroke="#D4A574" stroke-width="0.15"/>`;
    svg += `<text x="${batX + bat.l + 0.75}" y="${-H_NIV / 2}" text-anchor="middle" font-size="0.7" fill="#8B6914">var.</text>`;

    // Toiture (pente PLU : ${penteToitPct}% = ${penteToitDeg.toFixed(0)}°)
    const midX = batX + bat.l / 2;
    svg += `<polygon points="${batX},${-he} ${midX},${-hf} ${batX + bat.l},${-he}" fill="#8B6914" fill-opacity="0.15" stroke="#8B6914" stroke-width="0.2"/>`;
    svg += `<text x="${midX}" y="${-hf - 0.5}" text-anchor="middle" font-size="0.7" fill="#8B6914">pente ${penteToitPct}% (${penteToitDeg.toFixed(0)}°) · PLU min ${penteToitMinPct}% max ${penteToitMaxPct}%</text>`;

    // 5. heMax PLU (ligne rouge pointillée)
    svg += `<line x1="0" y1="${-heMax}" x2="${totalW}" y2="${-heMax}" stroke="#EF4444" stroke-width="0.2" stroke-dasharray="1,0.5"/>`;
    svg += `<text x="${totalW + 0.5}" y="${-heMax + 0.4}" font-size="0.9" fill="#EF4444">hé max ${heMax}m</text>`;

    // 5b. h_PE — hauteur plancher dernier étage (seuil SDIS)
    const h_PE = (nv - 1) * H_NIV;
    if (nv > 1) {
      svg += `<line x1="${batX}" y1="${-h_PE}" x2="${batX + bat.l}" y2="${-h_PE}" stroke="#F97316" stroke-width="0.2" stroke-dasharray="0.8,0.4"/>`;
      svg += `<text x="${batX - 0.5}" y="${-h_PE + 0.3}" text-anchor="end" font-size="0.8" fill="#F97316">h plancher ${h_PE.toFixed(0)}m</text>`;
    }

    // 5c. Seuil 8m SDIS (basculement 3ème famille)
    if (heMax >= 8) {
      const seuil8color = h_PE > 8 ? '#EF4444' : '#64748b';
      svg += `<line x1="0" y1="${-8}" x2="${totalW}" y2="${-8}" stroke="${seuil8color}" stroke-width="0.15" stroke-dasharray="0.4,0.4"/>`;
      svg += `<text x="${totalW + 0.5}" y="${-8 + 0.4}" font-size="0.75" fill="${seuil8color}">seuil 8m SDIS (3e fam.)</text>`;
    }

    // 6. Références altitude
    for (let h = 0; h <= totalH; h += 3) {
      svg += `<text x="${-0.5}" y="${-h + 0.3}" text-anchor="end" font-size="0.7" fill="#999">${h}m</text>`;
      svg += `<line x1="${-0.3}" y1="${-h}" x2="0" y2="${-h}" stroke="#ccc" stroke-width="0.1"/>`;
    }

    // 7. Cotations
    // Hauteur égout
    const cotX = totalW + 2;
    svg += `<line x1="${cotX}" y1="0" x2="${cotX}" y2="${-he}" stroke="#333" stroke-width="0.15"/>`;
    svg += `<text x="${cotX + 0.5}" y="${-he / 2}" font-size="0.8" fill="#333">hé ${he.toFixed(1)}m</text>`;

    // Hauteur plancher dernier étage (SDIS)
    if (h_PE > 0) {
      svg += `<line x1="${cotX + 1.5}" y1="0" x2="${cotX + 1.5}" y2="${-h_PE}" stroke="#F97316" stroke-width="0.15"/>`;
      svg += `<text x="${cotX + 2}" y="${-h_PE / 2}" font-size="0.8" fill="#F97316">h_PE ${h_PE.toFixed(0)}m</text>`;
    }

    // Hauteur faîtage
    svg += `<line x1="${cotX + 3}" y1="0" x2="${cotX + 3}" y2="${-hf}" stroke="#333" stroke-width="0.15"/>`;
    svg += `<text x="${cotX + 3.5}" y="${-hf / 2}" font-size="0.8" fill="#333">hf ${hf.toFixed(1)}m</text>`;

    // Profondeur bat
    svg += `<line x1="${batX}" y1="1.5" x2="${batX + bat.l}" y2="1.5" stroke="#333" stroke-width="0.15"/>`;
    svg += `<text x="${batX + bat.l / 2}" y="2.5" text-anchor="middle" font-size="0.8" fill="#333">↔ ${bat.l.toFixed(1)}m</text>`;

    // 8. Indicateur N-S
    svg += `<text x="0" y="${-totalH - 1}" font-size="1" fill="#333">↑ Nord</text>`;
    svg += `<text x="${totalW}" y="${-totalH - 1}" text-anchor="end" font-size="1" fill="#333">Sud ↓</text>`;

    if (_fallback) {
      svg += `<rect x="${totalW / 2 - 6}" y="${-totalH - 3}" width="12" height="2" fill="#FEF3C7" stroke="#F59E0B" stroke-width="0.15" rx="0.3"/>`;
      svg += `<text x="${totalW / 2}" y="${-totalH - 1.6}" text-anchor="middle" font-size="0.9" fill="#92400E">⚠ coupe indicative — données partielles</text>`;
    }

    svg += '</svg>';
    return svg;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // THREE.JS 3D
  // ═══════════════════════════════════════════════════════════════════════════

  renderThreeJS(canvasEl, session, proposal, prog, existingBldgs) {
    if (!canvasEl || !window.GabaritThree) return null;
    const scene = new window.GabaritThree(canvasEl);
    // loadCapacityStudy est async (échantillonnage TN + CSG) — on lance sans
    // attendre, le rendu Three se met à jour automatiquement quand les meshes
    // arrivent. L'événement 'terlab:earthworks-updated' notifie l'UI.
    scene.loadCapacityStudy(proposal, session, existingBldgs).catch(err => {
      console.warn('[CapacityStudyRenderer] loadCapacityStudy failed:', err);
    });
    return scene;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TABLEAU MÉTRIQUES
  // ═══════════════════════════════════════════════════════════════════════════

  renderMetricsTable(proposal, session) {
    const r = FH.readProposal(proposal);
    if (!r.blocs.length || !r.bat) return '<p>Aucune solution sélectionnée.</p>';

    const bat = r.bat;
    const blocs = r.blocs;
    const nv = proposal.niveaux ?? 2;
    const he = nv * H_NIV;
    const nLgts = proposal.nLgts ?? 0;
    const empPct = proposal.empPct ?? 0;
    const permPct = proposal.permPct ?? 0;
    const sp = proposal.spTot ?? 0;
    // Surface emprise réelle (somme des aires des blocs après clip)
    const empriseTot = proposal.surface ?? FH.totalArea(blocs);

    const p4 = session?.phases?.[4]?.data ?? {};
    const heMax = parseFloat(p4.hauteur_max_m ?? 9);
    const emprMax = parseFloat(p4.ces_max ?? 60);
    const emprMaxNorm = emprMax > 1 ? emprMax : emprMax * 100;
    const pprn = session?.phases?.[3]?.data?.zone_pprn ?? '';

    const row = (label, val, rule, ok) => {
      const cls = ok ? 'metric-ok' : 'metric-ko';
      const icon = ok ? '✓' : '✗';
      return `<tr class="${cls}"><td>${label}</td><td>${val}</td><td>${rule}</td><td>${icon}</td></tr>`;
    };

    let html = `<div class="capacity-metrics" style="color:#18130a">
    <h3 style="margin:0 0 8px;font-size:14px">Métriques — ${proposal.label ?? proposal.family}</h3>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr style="border-bottom:1px solid #ccc"><th>Indicateur</th><th>Projet</th><th>Règle</th><th></th></tr></thead>
    <tbody>`;

    html += row('Emprise bâtiment', `${empriseTot.toFixed(0)} m²`, '', true);
    if (blocs.length > 1) {
      html += row('Nombre de blocs', `${blocs.length}`, '', true);
    }
    html += row('Emprise sol', `${empPct.toFixed(1)}%`, `≤ ${emprMaxNorm.toFixed(0)}%`, empPct <= emprMaxNorm);
    html += row('Hauteur égout', `${he.toFixed(1)} m`, `≤ ${heMax} m`, he <= heMax);
    html += row('Niveaux', nv <= 1 ? 'RdC' : `R+${nv - 1}`, `≤ ${Math.floor(heMax / H_NIV)} niv.`, nv <= Math.floor(heMax / H_NIV));
    html += row('Surface plancher', `${sp.toFixed(0)} m²`, '', true);
    html += row('Logements', `${nLgts}`, '', true);
    html += row('Perméabilité', `${permPct.toFixed(1)}%`, '≥ 25%', permPct >= 25);
    // Largeur RTAA = plus petite dimension du bloc le plus large
    let maxBlocWidth = 0;
    for (const b of blocs) {
      const lens = FH.edgeLengths(b.polygon ?? []);
      if (lens.length >= 2) {
        const w = Math.min(lens[0], lens[1]);
        if (w > maxBlocWidth) maxBlocWidth = w;
      }
    }
    if (maxBlocWidth > 0) {
      html += row('Largeur RTAA', `${maxBlocWidth.toFixed(1)} m`, '≤ 12 m', maxBlocWidth <= 12);
    }

    if (pprn) {
      const pprnColor = pprn === 'rouge' ? '#EF4444' : pprn === 'orange' ? '#F97316' : '#22C55E';
      html += `<tr><td>PPRN</td><td style="color:${pprnColor};font-weight:bold">${pprn}</td><td></td><td></td></tr>`;
    }

    html += '</tbody></table></div>';
    return html;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Utilitaires fallback
  // ═══════════════════════════════════════════════════════════════════════════

  _aabb(poly) {
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    const xMin = Math.min(...xs), yMin = Math.min(...ys);
    return { x: xMin, y: yMin, w: Math.max(...xs) - xMin, h: Math.max(...ys) - yMin };
  },

  _area(pts) {
    let s = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
      s += x1 * y2 - x2 * y1;
    }
    return Math.abs(s) / 2;
  },
};

export { CapacityStudyRenderer };
export default CapacityStudyRenderer;

// Expose pour compatibilité non-module TERLAB
if (typeof window !== 'undefined') window.CapacityStudyRenderer = CapacityStudyRenderer;
