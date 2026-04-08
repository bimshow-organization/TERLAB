// TERLAB · export-engine.js · Moteur exports PDF/DXF/GLB/JSON · v3.0
// ════════════════════════════════════════════════════════════════════════════
// PDF A4 portrait – rendu print-template.html + window.print()
// Planches HTML injectées dans iframe, typo Cormorant Garamond / IBM Plex Mono / Jost
// ════════════════════════════════════════════════════════════════════════════

import MapCapture from './map-capture.js';

// ── HELPERS ────────────────────────────────────────────────────────────────
const val  = (v, fallback = 'a renseigner') => (v != null && v !== '' && v !== '—') ? String(v) : fallback;
// acc, warn, ok available for future planches
// const acc  = (v) => `<span class="fv ac">${val(v)}</span>`;
// const warn = (v) => `<span class="fv wa">${val(v)}</span>`;
// const ok   = (v) => `<span class="fv ok">${val(v)}</span>`;
const em   = (v) => `<span class="fv em">${val(v, 'a renseigner')}</span>`;
const auto = (v) => v != null && v !== '' ? `<span class="fv au">${v}</span>` : em();

/** Data row helper — detecte auto-values suffixees "(≈)" et applique style auto */
const row = (label, value, cls = '') => {
  const v = val(value);
  const isAuto = typeof value === 'string' && value.includes('≈');
  return `<div class="fr"><span class="fl">${label}</span><span class="fv ${cls}${isAuto ? ' au' : ''}">${v}</span></div>`;
};

/** Section title */
const sec = (title) => `<div class="stitle">${title}</div>`;

/** Map image or SVG placeholder */
function mapImg(captures, id, height, label, source, svgFallback) {
  const content = captures?.[id]
    ? `<img src="${captures[id]}" alt="${label}">`
    : (svgFallback ?? svgPlaceholder(label));
  return `
    <div class="map-wrap" style="height:${height}px">
      ${content}
      <span class="map-lbl">${label}</span>
      <span class="map-src">${source}</span>
    </div>`;
}

/** Generic SVG placeholder */
function svgPlaceholder(label) {
  return `<svg viewBox="0 0 430 270" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
    <defs><pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M0 20L20 0M-5 5L5-5M15 25L25 15" stroke="#D0CCC4" stroke-width="0.5"/></pattern></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="215" y="135" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="10" fill="#A8A49C">${label}</text>
    <text x="215" y="152" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="8" fill="#C1652B">Capture indisponible</text>
    <!-- North arrow -->
    <g transform="translate(20,20)"><polygon points="0,-12 4,0 -4,0" fill="#1C1C1A"/>
    <polygon points="0,-12 -4,0 0,-4" fill="none" stroke="#1C1C1A" stroke-width="0.5"/>
    <text x="0" y="-14" text-anchor="middle" font-family="IBM Plex Mono" font-size="6" fill="#1C1C1A">N</text></g>
    <!-- Scale bar -->
    <g transform="translate(15,255)"><rect width="40" height="2" fill="#1C1C1A"/>
    <rect x="20" width="20" height="2" fill="#fff" stroke="#1C1C1A" stroke-width="0.3"/>
    <text x="0" y="9" font-family="IBM Plex Mono" font-size="5" fill="#1C1C1A">0</text>
    <text x="40" y="9" font-family="IBM Plex Mono" font-size="5" fill="#1C1C1A">50m</text></g>
  </svg>`;
}

/** SVG situation placeholder (simplified Reunion island) */
function svgSituation() {
  return `<svg viewBox="0 0 430 196" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
    <rect width="100%" height="100%" fill="#E8E4DD"/>
    <ellipse cx="215" cy="98" rx="80" ry="55" fill="#D4CFC5" stroke="#A8A49C" stroke-width="0.8"/>
    <circle cx="215" cy="98" r="4" fill="#C1652B"/>
    <text x="215" y="165" text-anchor="middle" font-family="IBM Plex Mono" font-size="8" fill="#6A6860">Situation - Ile de La Reunion</text>
  </svg>`;
}

// ── PAGE HEADER / FOOTER ───────────────────────────────────────────────────
function pageHead(subtitle) {
  return `<div class="tc-bar"></div>
  <div class="pg-head">
    <span class="pg-brand">TERLAB</span>
    <span class="pg-sep">|</span>
    <span class="pg-sub">${subtitle}</span>
    <span class="pg-spacer"></span>
  </div>`;
}

function plancheHead(title, num, total, ref) {
  return `<div class="tc-bar"></div>
  <div class="ph">
    <div>
      <div class="ph-brand">TERLAB · Analyse de terrain</div>
      <div class="ph-title">${title}</div>
    </div>
    <div>
      <div class="ph-n">${num} / ${total}</div>
      <div class="ph-ref">${ref}</div>
    </div>
  </div>`;
}

function plancheFoot(commune, ref, num, total) {
  return `<div class="ph-foot">
    <span class="phf-e">ENSA La Reunion</span>
    <span class="phf-c">${val(commune)}</span>
    <span class="phf-m">TERLAB</span>
    <span class="phf-e">${ref} · ${new Date().toLocaleDateString('fr-FR')}</span>
    <span class="phf-n">${num}/${total}</span>
  </div>`;
}

// ════════════════════════════════════════════════════════════════════════════
//  EXPORT ENGINE
// ════════════════════════════════════════════════════════════════════════════

const ExportEngine = {

  // ── MODAL ─────────────────────────────────────────────────────
  openModal()  { document.getElementById('modal-export').hidden = false; },
  closeModal() { document.getElementById('modal-export').hidden = true; },

  // ── PROGRESS ──────────────────────────────────────────────────
  _setProgress(pct, label) {
    const prog  = document.getElementById('export-progress');
    const bar   = document.getElementById('export-progress-bar');
    const lbl   = document.getElementById('export-progress-label');
    if (prog) prog.hidden = false;
    if (bar)  bar.style.width = pct + '%';
    if (lbl)  lbl.textContent = label;
  },

  _hideProgress() {
    const prog = document.getElementById('export-progress');
    if (prog) prog.hidden = true;
  },

  // ═══════════════════════════════════════════════════════════════
  //  PDF — GENERATE
  // ═══════════════════════════════════════════════════════════════

  async generatePDF(mode = 'site') {
    const session = window.SessionManager;
    const terrainRaw = session?.getTerrain?.() ?? {};

    if (!terrainRaw.commune) {
      window.TerlabToast?.show('Completez la Phase 0 avant d\'exporter', 'warning');
      return;
    }

    const modeLabel = mode === 'projet' ? 'PDF Projet' : 'PDF Site';
    this._setProgress(2, `${modeLabel} — Capture des cartes...`);
    window.TerlabToast?.show(`Generation ${modeLabel} A4 en cours...`, 'info', 15000);

    try {
      // ── Capture cartes Mapbox ──
      this._setProgress(5, 'Capture des vues cartographiques...');
      const mapCaptures = await MapCapture.captureAll(session);

      // ── Capture visuels DOM existants ──
      this._setProgress(15, 'Capture visuels DOM...');
      this._visuals = await this._captureVisuals();

      // ── Auto-enrichissement ──
      this._setProgress(25, 'Auto-enrichissement du terrain...');
      const enrichResult = await this._autoEnrich(session, terrainRaw);
      const terrain = enrichResult.terrain;
      this._autoFields = enrichResult.autoFields;
      this._enrichedPhases = enrichResult.phases;

      // ── Garde de qualite ──
      const score = session?.audit?.globalScore ?? window.TerlabScoreService?.computeGlobalScore?.(session) ?? 0;
      if (score < 40) {
        const missing = this._getMissingCriticalPhases(session);
        const proceed = confirm(
          `Completude de l'analyse : ${score}%\n\n` +
          `Le document PDF contiendra de nombreuses donnees manquantes.\n` +
          `Phases critiques manquantes : ${missing.join(', ')}\n\n` +
          `Continuer quand meme ?`
        );
        if (!proceed) { this._hideProgress(); return; }
      }

      // ── Rendu HTML des planches ──
      this._setProgress(35, 'Rendu des planches...');
      const allMaps = { ...mapCaptures, ...this._visuals };
      const html = this._renderAllPlanches(session, terrain, allMaps, mode);

      // ── Impression ──
      this._setProgress(90, 'Impression...');
      await this._injectAndPrint(html);

      session?.saveExport?.('pdf', `TERLAB_${terrain.commune}_A4.pdf`);
      const autoCount = this._autoFields?.size ?? 0;
      const msg = autoCount > 0
        ? `${modeLabel} genere — ${autoCount} champs auto-enrichis`
        : `${modeLabel} genere avec succes`;
      window.TerlabToast?.show(msg, 'success');

    } catch (e) {
      console.error('[Export PDF]', e);
      window.TerlabToast?.show(`Erreur PDF : ${e.message}`, 'error');
    }
    this._hideProgress();
  },

  // ═══════════════════════════════════════════════════════════════
  //  INJECT & PRINT (iframe → window.print)
  // ═══════════════════════════════════════════════════════════════

  async _injectAndPrint(htmlContent) {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(iframe);

    const res = await fetch('./print-template.html');
    const shell = await res.text();

    const doc = iframe.contentDocument;
    doc.open();
    doc.write(shell);
    doc.close();

    // Attendre fonts CDN
    await new Promise(resolve => {
      iframe.contentWindow.document.fonts.ready.then(resolve);
      setTimeout(resolve, 3000);
    });

    // Injecter le contenu
    doc.getElementById('terlab-print-root').innerHTML = htmlContent;

    // Imprimer
    iframe.contentWindow.focus();
    iframe.contentWindow.print();

    // Cleanup
    setTimeout(() => {
      try { document.body.removeChild(iframe); } catch { /* already removed */ }
    }, 2000);
  },

  // ═══════════════════════════════════════════════════════════════
  //  RENDER ALL PLANCHES
  // ═══════════════════════════════════════════════════════════════

  _renderAllPlanches(session, terrain, maps, mode) {
    const ref = `${terrain.section ?? ''}${terrain.parcelle ?? ''}`;
    const tp = mode === 'projet' ? 7 : 6; // total pages (densifié)

    let html = '';
    html += this._renderCover(session, terrain, maps, mode, tp);
    html += this._renderPlanche1(session, terrain, maps, ref, tp);
    html += this._renderPlanche2_3(session, terrain, maps, ref, tp); // Topo + Risques fusionnés

    if (mode === 'projet') {
      html += this._renderPlanche4(session, terrain, maps, ref, tp);
    }

    html += this._renderPlanche5_6(session, terrain, maps, ref, tp); // Voisinage + Gabarit fusionnés
    html += this._renderPlanche7(session, terrain, maps, ref, tp);
    html += this._renderPlanche8(session, terrain, maps, ref, tp);

    return html;
  },

  // ═══════════════════════════════════════════════════════════════
  //  COVER PAGE
  // ═══════════════════════════════════════════════════════════════

  _renderCover(session, terrain, maps, mode, tp) {
    const commune = (terrain.commune ?? 'Terrain').toUpperCase();
    const ref = [terrain.section, terrain.parcelle].filter(Boolean).join(' ');
    const modeLabel = mode === 'projet' ? 'ANALYSE PROJET' : 'ANALYSE SITE';
    const uuid = session?.getOrCreateUUID?.()?.slice(-8) ?? '';
    const date = new Date().toLocaleDateString('fr-FR');
    const score = window.TerlabScoreService?.computeGlobalScore?.(session);

    return `<div class="page">
      ${pageHead('Analyse de terrain · ENSA La Reunion')}
      <div class="cover-body">
        <div class="mode-pill"><span class="mode-dot"></span>${modeLabel}</div>
        <div class="commune">${ref || commune}</div>
        <div class="parcelle-ref">${ref ? commune : ''}</div>

        <div class="cover-grid">
          <div class="sec">
            ${row('Commune', terrain.commune)}
            ${row('Code INSEE', terrain.code_insee)}
            ${row('Intercommunalite', terrain.intercommunalite)}
            ${row('Contenance', terrain.contenance_m2 ? `${terrain.contenance_m2} m2` : null)}
            ${row('Zone PLU', terrain.zone_plu, 'ac')}
            ${row('Altitude NGR', terrain.altitude_ngr != null ? `${terrain.altitude_ngr} m` : null)}
            ${row('Date', date)}
            ${row('Reference', uuid)}
          </div>
          <div>
            ${mapImg(maps, 'p01_situation_marked', 180, 'Situation', 'Mapbox · Satellite', maps?.cover_situation ? `<img src="${maps.cover_situation}" alt="Situation">` : undefined)}
            ${score != null ? `
            <div class="pot-grid">
              <div class="pcrd">
                <span class="pcl">AVANCEMENT</span>
                <span class="pcv" style="color:${score >= 70 ? '#2E5C2E' : score >= 40 ? '#8B6A20' : '#C1652B'}">${score}%</span>
                <span class="pcu">global</span>
              </div>
              <div class="pcrd">
                <span class="pcl">MODE</span>
                <span class="pcv" style="font-size:16px">${mode === 'projet' ? 'Projet' : 'Site'}</span>
                <span class="pcu">${tp} planches</span>
              </div>
              <div class="pcrd">
                <span class="pcl">FORMAT</span>
                <span class="pcv" style="font-size:16px">A4</span>
                <span class="pcu">portrait</span>
              </div>
            </div>` : ''}
          </div>
        </div>
      </div>
      <div class="pg-foot">
        <span class="pf">TERLAB v1.0 · ENSA La Reunion · Document pedagogique non opposable</span>
        <span class="pf">${uuid} · ${date}</span>
      </div>
    </div>`;
  },

  // ═══════════════════════════════════════════════════════════════
  //  PLANCHE 1 — Identite parcelle
  // ═══════════════════════════════════════════════════════════════

  _renderPlanche1(_session, terrain, maps, ref, tp) {
    return `<div class="page">
      ${plancheHead('Identite du terrain', 2, tp, ref)}
      <div class="pb pb2">
        <div class="sec">
          ${sec('DONNEES CADASTRALES')}
          ${row('Commune', terrain.commune)}
          ${row('Code INSEE', terrain.code_insee)}
          ${row('Section / Parcelle', `${val(terrain.section)} / ${val(terrain.parcelle)}`)}
          ${row('Contenance', terrain.contenance_m2 ? `${terrain.contenance_m2} m2` : null)}
          ${row('Intercommunalite', terrain.intercommunalite)}
          ${row('Altitude NGR', terrain.altitude_ngr != null ? `${terrain.altitude_ngr} m` : null)}

          ${sec('COORDONNEES')}
          ${row('Latitude', terrain.lat)}
          ${row('Longitude', terrain.lng)}
          ${row('Adresse', terrain.adresse)}

          ${sec('ORIENTATION')}
          ${row('Orientation', terrain.orientation ?? terrain.orientation_terrain)}
          ${row('Pente moy.', terrain.pente_moy_pct != null ? `${terrain.pente_moy_pct} %` : null)}
        </div>
        <div>
          ${mapImg(maps, 'p01_cadastre', 270, 'Cadastre parcelle', 'IGN · Mapbox Satellite')}
          ${mapImg(maps, 'p01_situation', 196, 'Situation commune', 'Mapbox Streets', svgSituation())}
        </div>
      </div>
      ${plancheFoot(terrain.commune, ref, 2, tp)}
    </div>`;
  },

  // ═══════════════════════════════════════════════════════════════
  //  PLANCHE 2+3 — Analyse du site + Risques & PLU (fusionnée)
  // ═══════════════════════════════════════════════════════════════

  _renderPlanche2_3(session, terrain, maps, ref, tp) {
    const p3 = this._getPhaseData(session, 3);
    const p4 = this._getPhaseData(session, 4);

    const geoTypes = {
      basalte_recent: 'Basalte recent', basalte_ancien: 'Basalte ancien',
      pahoehoe: 'Pahoehoe', aa_scories: 'Aa / Scories',
      alluvions: 'Alluvions', remblai: 'Remblai', indetermine: 'Indetermine',
    };
    const geoLabel = geoTypes[terrain.geologie_type] ?? terrain.geologie_type ?? null;
    const geoIsAuto = this._autoFields?.has('geologie_type');

    // Coupes A/B
    const sectionAImg = this._visuals?.sectionA
      ? `<div class="map-wrap" style="height:90px"><img src="${this._visuals.sectionA}" alt="Coupe A longitudinale"><span class="map-lbl">Coupe A — Longitudinale</span></div>`
      : '';
    const sectionBImg = this._visuals?.sectionB
      ? `<div class="map-wrap" style="height:90px"><img src="${this._visuals.sectionB}" alt="Coupe B perpendiculaire"><span class="map-lbl">Coupe B — Perpendiculaire</span></div>`
      : '';

    // PPR
    const zone = p3.zone_pprn ?? terrain.zone_pprn ?? null;
    const zoneDesc = {
      R1: 'Rouge fort — Inconstructible', R2: 'Rouge — Inconstructible',
      B1: 'Bleu fort — Constructible sous conditions strictes', B2: 'Bleu — Constructible sous conditions',
      J: 'Jaune — Constructible avec prescriptions', W: 'Blanc — Hors zone reglementee',
    };
    const zoneColor = {
      R1: '#8B2020', R2: '#8B2020', B1: '#8B6A20', B2: '#8B6A20', J: '#8B6A20', W: '#2E5C2E',
    };

    // PLU
    const zonePlu = terrain.zone_plu ?? p4.zone_plu ?? null;
    const pluDesc = {
      UA: 'Urbaine dense', UB: 'Urbaine residentielle', UC: 'Urbaine peripherique',
      AU: 'A urbaniser', AUs: 'A urbaniser strict', N: 'Naturelle', A: 'Agricole',
    };

    const pprSnap = terrain.snap_ppr ?? this._visuals?.phaseSnaps?.[3] ?? null;
    const reculsSnap = this._visuals?.reculsCanvas ?? null;

    // PPRN hors zone — message explicite
    const pprnHorsZoneMsg = !zone
      ? `<div class="hbox" style="background:#F5F0E8;padding:4px 8px;margin:2px 0;font-size:7.5pt">
          <p style="margin:0">Parcelle hors zone PPR approuve — verifier PPRN en cours d'elaboration aupres de la DEAL 974</p>
        </div>`
      : '';

    return `<div class="page">
      ${plancheHead('Analyse du site & Risques', 3, tp, ref)}
      <div class="pb pb3">
        <div class="sec">
          ${sec('TOPOGRAPHIE')}
          ${row('Orientation', terrain.orientation ?? terrain.orientation_terrain)}
          ${row('Alt. min/max', terrain.alt_min_dem != null && terrain.alt_max_dem != null ? `${terrain.alt_min_dem} — ${terrain.alt_max_dem} m NGR` : null)}
          ${row('Pente moy.', terrain.pente_moy_pct != null ? `${terrain.pente_moy_pct} %` : null)}
          ${row('Zone pluvio.', terrain.zone_pluviometrique ?? terrain.zone_pluvio)}

          ${sec('GEOLOGIE')}
          ${geoLabel ? `<div class="hbox"><p>Type : <strong>${geoLabel}</strong>${geoIsAuto ? ' <span class="fv au"></span>' : ''}</p></div>` : ''}
          ${row('Remblai', { non: 'Non', possible: 'Possible', oui: 'Oui' }[terrain.remblai])}
          ${row('Geotechnique', { non: 'Non requise', g1: 'G1 requise', recommande: 'Recommandee' }[terrain.geotech])}

          ${sectionAImg}
          ${sectionBImg}
        </div>
        <div class="sec">
          ${sec('RISQUES — PPRN')}
          ${zone ? `<div class="hbox"><p>Zone <strong style="color:${zoneColor[zone] ?? '#C1652B'}">${zone}</strong> — ${zoneDesc[zone] ?? ''}</p></div>` : pprnHorsZoneMsg}
          ${row('Cote ref. NGR', p3.cote_reference_ngr != null ? `${p3.cote_reference_ngr} m NGR` : null)}
          ${row('Zone vent RTAA', p3.zone_rtaa_vent)}
          ${row('Hydrant < 150 m', { oui: 'Oui', non: 'Non', verif: 'A verifier' }[p3.hydrant_present])}

          ${pprSnap ? `
          <div class="map-wrap" style="height:140px">
            <img src="${pprSnap}" alt="Carte PPR">
            <span class="map-lbl">Carte PPR</span>
            <span class="map-src">AGORAH PEIGEO</span>
          </div>` : mapImg(maps, 'p03_ppr', 140, 'PPR — Vue rapprochee', 'AGORAH PEIGEO')}
        </div>
        <div class="sec">
          ${sec('PLU & RECULS')}
          ${zonePlu ? `<div class="hbox"><p>Zone <strong>${zonePlu}</strong> — ${pluDesc[zonePlu] ?? ''}</p></div>` : ''}
          ${row('Hauteur max', p4.hauteur_max_m ? `${p4.hauteur_max_m} m` : null)}
          ${row('Emprise sol', p4.emprise_sol_max_pct ? `${p4.emprise_sol_max_pct} %` : null)}
          ${row('Reculs V / L / F', [p4.recul_voie_principale_m, p4.recul_limite_sep_m, p4.recul_fond_m].filter(Boolean).join(' / ') || null)}

          ${reculsSnap ? `
          <div class="map-wrap" style="height:130px">
            <img src="${reculsSnap}" alt="Schema reculs">
            <span class="map-lbl">Schema des reculs</span>
          </div>` : ''}
        </div>
      </div>
      ${plancheFoot(terrain.commune, ref, 3, tp)}
    </div>`;
  },

  // ═══════════════════════════════════════════════════════════════
  //  PLANCHE 4 — Plan masse & Conformite (mode projet)
  // ═══════════════════════════════════════════════════════════════

  _renderPlanche4(_session, terrain, _maps, ref, tp) {
    const proposal = this._visuals?.activeProposal ?? window._activeProposal ?? null;
    const planMasseImg = this._visuals?.planMasse ?? null;

    const bat = proposal?.bat ?? {};
    const metrics = proposal?.metrics ?? {};

    return `<div class="page">
      ${plancheHead('Plan masse & Conformite', 4, tp, ref)}
      <div class="pb pb2">
        <div class="sec">
          ${sec('METRIQUES CONFORMITE')}
          ${row('Emprise au sol', metrics.emprise_m2 ? `${metrics.emprise_m2} m2` : null)}
          ${row('Surface plancher', metrics.sdp_m2 ? `${metrics.sdp_m2} m2` : null)}
          ${row('CES reel', metrics.ces_pct ? `${metrics.ces_pct} %` : null)}
          ${row('Permeable reel', metrics.permeable_pct ? `${metrics.permeable_pct} %` : null)}
          ${row('Hauteur', bat.h ? `${bat.h} m` : null)}
          ${row('Niveaux', bat.niveaux)}

          ${sec('VEGETATION & AMENITES')}
          ${row('Arbres', metrics.arbres_count)}
          ${row('Surface vegetalisee', metrics.vegetation_m2 ? `${metrics.vegetation_m2} m2` : null)}
          ${row('Amenites', metrics.amenites?.join(', '))}
        </div>
        <div>
          ${planMasseImg ? `
          <div class="map-wrap" style="height:400px">
            <img src="${planMasseImg}" alt="Plan masse">
            <span class="map-lbl">Plan masse</span>
            <span class="map-src">TERLAB · Auto-plan</span>
          </div>` : `
          <div class="map-wrap" style="height:400px">
            ${svgPlaceholder('Plan masse')}
            <span class="map-lbl">Plan masse</span>
          </div>`}
        </div>
      </div>
      ${plancheFoot(terrain.commune, ref, 4, tp)}
    </div>`;
  },

  // ═══════════════════════════════════════════════════════════════
  //  PLANCHE 5+6 — Voisinage & Esquisse (fusionnée)
  // ═══════════════════════════════════════════════════════════════

  _renderPlanche5_6(session, terrain, _maps, ref, tp) {
    const p6 = session?.getPhase?.(6)?.data ?? {};
    const p7 = this._getPhaseData(session, 7);
    const p8 = this._getPhaseData(session, 8);
    const pluRules = terrain._pluRules;
    const num = tp >= 7 ? (tp === 7 ? 5 : 6) : 5;

    const reseauLabels = {
      reseau_public: 'Reseau public', captage_prive: 'Captage prive', inconnu: 'Inconnu',
      collectif: 'Collectif', ANC: 'ANC', disponible: 'Disponible',
      extension: 'Extension necessaire', oui: 'Fibre optique', adsl: 'ADSL', zone_blanche: 'Zone blanche',
    };

    const parcLabels = {
      hors_parc: 'Hors parc', adhesion_500m: 'Zone adhesion < 500 m',
      adhesion: 'Zone d\'adhesion', coeur: 'Coeur de parc',
    };

    const snapBati = terrain.snap_bati3d ?? this._visuals?.phaseSnaps?.[5] ?? null;
    const snapshot3d = p7.glb_snapshot ?? this._visuals?.terrain3d ?? this._visuals?.bimshow ?? null;
    const coupeGabarit = this._visuals?.coupeGabarit ?? null;

    // Pre-esquisse auto
    let preEsquisseHtml = '';
    const hasManualEsquisse = p7.gabarit_l_m || p7.surface_plancher_m2 || p7.glb_snapshot;
    if (!hasManualEsquisse && pluRules && terrain.contenance_m2) {
      const surface = parseFloat(terrain.contenance_m2);
      const emprMax = pluRules.plu?.emprMax ?? 60;
      const heMax   = pluRules.plu?.heMax ?? 9;
      const empriseEst = Math.round(surface * emprMax / 100);
      const sdpMax = empriseEst * Math.floor(heMax / 3);
      preEsquisseHtml = `
        <div class="fr"><span class="fl">Emprise constr. est.</span>${auto(`~${empriseEst} m2`)}</div>
        <div class="fr"><span class="fl">SDP max estimee</span>${auto(`~${sdpMax} m2`)}</div>
      `;
    }

    // GIEP
    const giep = session?.getPhase?.(8)?.data?.giep_result ?? null;
    let giepHtml = '';
    if (giep?.score != null) {
      const col = giep.score >= 70 ? '#2E5C2E' : giep.score >= 40 ? '#8B6A20' : '#C1652B';
      giepHtml = `<div class="hbox"><p>GIEP : <strong style="color:${col}">${giep.score}/100</strong>
        ${giep.reduction_pct ? ` · -${giep.reduction_pct}%` : ''}</p></div>`;
    }

    return `<div class="page">
      ${plancheHead('Voisinage & Esquisse', num, tp, ref)}
      <div class="pb pb3">
        <div class="sec">
          ${sec('VOISINAGE & RESEAUX')}
          ${row('ICPE < 500 m', { non: 'Non', oui: 'Oui', verif: 'A verifier' }[terrain.icpe])}
          ${row('Parc National', parcLabels[p6.parc_situation] ?? p6.parc_situation)}
          ${row('Eau potable', reseauLabels[terrain.eau_potable] ?? terrain.eau_potable)}
          ${row('Assainissement', reseauLabels[terrain.assainissement] ?? terrain.assainissement)}
          ${row('Electricite', reseauLabels[terrain.electricite] ?? terrain.electricite)}
          ${row('Fibre', reseauLabels[terrain.fibre] ?? terrain.fibre)}

          ${snapBati ? `
          <div class="map-wrap" style="height:130px">
            <img src="${snapBati}" alt="Batiments voisins">
            <span class="map-lbl">Batiments voisins 3D</span>
          </div>` : mapImg(_maps, 'p05_context3d', 130, 'Contexte 3D', 'Mapbox')}
        </div>
        <div class="sec">
          ${sec('ESQUISSE DU PROJET')}
          ${row('Surface plancher', p7.surface_plancher_m2 ? `${p7.surface_plancher_m2} m2` : null)}
          ${row('Niveaux', p7.niveaux)}
          ${row('Gabarit L x l x h', (p7.gabarit_l_m && p7.gabarit_w_m && p7.gabarit_h_m) ?
            `${p7.gabarit_l_m} x ${p7.gabarit_w_m} x ${p7.gabarit_h_m} m` : null)}
          ${preEsquisseHtml}

          ${coupeGabarit ? `
          <div class="map-wrap" style="height:140px">
            <img src="${coupeGabarit}" alt="Coupe gabarit">
            <span class="map-lbl">Coupe N-S · Reculs</span>
          </div>` : ''}

          ${snapshot3d ? `
          <div class="map-wrap" style="height:200px">
            <img src="${snapshot3d}" alt="Modele 3D" style="object-fit:contain">
            <span class="map-lbl">Terrain 3D · LiDAR</span>
          </div>` : ''}
        </div>
        <div class="sec">
          ${sec('CHANTIER & SDIS')}
          ${row('Demarrage', { hors_cyclone: 'Hors cyclone', cyclone: 'Saison cyclonique' }[p8.saison_demarrage])}
          ${row('Gestion eaux', { bassin: 'Bassin', cunettes: 'Cunettes', a_definir: 'A definir' }[p8.gestion_eaux_chantier])}
          ${giepHtml || row('GIEP', null)}

          ${sec('SDIS 974')}
          ${this._renderSdisChecklist(p8)}
        </div>
      </div>
      ${plancheFoot(terrain.commune, ref, num, tp)}
    </div>`;
  },

  _renderSdisChecklist(p8) {
    if (!p8.acces_pompiers_states) return row('Acces pompiers', 'Non renseigne');
    const criteria = {
      largeur: 'Largeur >= 3 m', hauteur: 'Hauteur libre >= 3.5 m',
      portance: 'Portance 16 t', hydrant: 'Hydrant < 150 m', degagement: 'Degagement 8 x 12 m',
    };
    return Object.entries(criteria).map(([key, label]) => {
      const state = p8.acces_pompiers_states[key];
      const icon = { ok: '+', warn: '!', err: '-', na: '?' }[state] ?? '?';
      const cls = { ok: 'p', warn: 'a', err: 'm' }[state] ?? '';
      return `<div class="synth-row"><span class="si ${cls}">${icon}</span><span class="st">${label}</span></div>`;
    }).join('');
  },

  // ═══════════════════════════════════════════════════════════════
  //  PLANCHE 7 — Checklist & Audit
  // ═══════════════════════════════════════════════════════════════

  _renderPlanche7(session, terrain, _maps, ref, tp) {
    const num = tp - 1;

    // Phase progress
    const phases = [
      { n: 0,  label: 'Identification' }, { n: 1,  label: 'Topographie' },
      { n: 2,  label: 'Geologie' },       { n: 3,  label: 'Risques PPRN' },
      { n: 4,  label: 'PLU & RTAA' },     { n: 5,  label: 'Voisinage' },
      { n: 6,  label: 'Biodiversite' },    { n: 7,  label: 'Esquisse' },
      { n: 8,  label: 'Chantier' },        { n: 9,  label: 'Carbone' },
      { n: 10, label: 'Entretien' },       { n: 11, label: 'Fin de vie' },
      { n: 12, label: 'Synthese' },
    ];

    const progressHtml = phases.map(ph => {
      const phase = session?.getPhase?.(ph.n);
      const done = phase?.completed === true;
      const hasData = phase?.data && Object.keys(phase.data).length > 0;
      const pct = done ? 100 : hasData ? 50 : 0;
      return `<div class="sr">
        <span class="sl">P${ph.n} · ${ph.label}</span>
        <div class="sb"><div class="sf" style="width:${pct}%"></div></div>
        <span class="sp">${pct}%</span>
      </div>`;
    }).join('');

    // Commentaire global
    const p12 = session?.getPhase?.(12)?.data ?? {};
    const commentaire = p12.commentaire_global ?? null;
    const enseignant = p12.enseignant ?? null;

    return `<div class="page">
      ${plancheHead('Checklist & Audit', num, tp, ref)}
      <div class="pb pb3">
        <div class="sec">
          ${sec('PROGRESSION DES PHASES')}
          ${progressHtml}
        </div>
        <div class="sec">
          ${sec('INFORMATIONS SESSION')}
          ${row('UUID', session?.getOrCreateUUID?.()?.slice(-8))}
          ${row('Date export', new Date().toLocaleDateString('fr-FR'))}
          ${row('Enseignant', enseignant)}

          ${commentaire ? `
          ${sec('COMMENTAIRE GENERAL')}
          <div class="hbox"><p>${commentaire}</p></div>` : ''}

          ${sec('AVERTISSEMENT')}
          <div class="hbox">
            <p>Ce document est produit avec TERLAB v1.0, outil pedagogique de l'ENSA La Reunion.
            Il <strong>ne se substitue pas</strong> aux documents reglementaires officiels
            (PPRN, PLU, CU, ERP, attestations techniques).</p>
          </div>
        </div>
      </div>
      ${plancheFoot(terrain.commune, ref, num, tp)}
    </div>`;
  },

  // ═══════════════════════════════════════════════════════════════
  //  PLANCHE 8 — Synthese & Conclusions
  // ═══════════════════════════════════════════════════════════════

  _renderPlanche8(_session, terrain, _maps, ref, tp) {
    const num = tp;

    // Build synthesis items
    const items = [];

    // Positif
    if (terrain.zone_plu && /^U/.test(terrain.zone_plu))
      items.push({ icon: '+', cls: 'p', text: `Zone ${terrain.zone_plu} — terrain urbanisable` });
    if (terrain.zone_pprn === 'W')
      items.push({ icon: '+', cls: 'p', text: 'Hors zone PPR — pas de contrainte inondation' });
    if (terrain.eau_potable === 'reseau_public')
      items.push({ icon: '+', cls: 'p', text: 'Desserte eau potable reseau public' });
    if (terrain.electricite === 'disponible')
      items.push({ icon: '+', cls: 'p', text: 'Raccordement electrique disponible' });

    // Vigilance
    if (terrain.zone_pprn && /^[BR]/.test(terrain.zone_pprn))
      items.push({ icon: '!', cls: 'a', text: `Zone PPR ${terrain.zone_pprn} — contraintes fortes` });
    if (terrain.pente_moy_pct > 15)
      items.push({ icon: '!', cls: 'a', text: `Pente moyenne ${terrain.pente_moy_pct}% — terrassements importants` });
    if (terrain.distance_ravine_m != null && terrain.distance_ravine_m < 50)
      items.push({ icon: '!', cls: 'a', text: `Ravine a ${terrain.distance_ravine_m} m — vigilance eaux pluviales` });

    // Negatif
    if (terrain.zone_pprn === 'R1' || terrain.zone_pprn === 'R2')
      items.push({ icon: '-', cls: 'm', text: 'Zone rouge PPR — inconstructible' });
    if (terrain.assainissement === 'ANC')
      items.push({ icon: '-', cls: 'm', text: 'Assainissement non collectif — etude filiere requise' });

    if (items.length === 0) {
      items.push({ icon: '?', cls: 'a', text: 'Analyse incomplete — completer les phases pour obtenir la synthese' });
    }

    const synthHtml = items.map(it =>
      `<div class="synth-row"><span class="si ${it.cls}">${it.icon}</span><span class="st">${it.text}</span></div>`
    ).join('');

    // Potentiel
    const contenance = parseFloat(terrain.contenance_m2) || 0;
    const pluRules = terrain._pluRules;
    const empMax = pluRules?.plu?.emprMax ?? 60;
    const heMax = pluRules?.plu?.heMax ?? 9;
    const empriseEst = Math.round(contenance * empMax / 100);
    const sdpEst = empriseEst * Math.floor(heMax / 3);

    return `<div class="page">
      ${plancheHead('Synthese & Conclusions', num, tp, ref)}
      <div class="pb pb3">
        <div class="sec">
          ${sec('SYNTHESE DES ENJEUX')}
          ${synthHtml}
        </div>
        <div class="sec">
          ${sec('POTENTIEL CONSTRUCTIF ESTIME')}
          <div class="pot-grid" style="grid-template-columns:1fr 1fr">
            <div class="pcrd">
              <span class="pcl">EMPRISE SOL</span>
              <span class="pcv">${contenance > 0 ? empriseEst : '—'}</span>
              <span class="pcu">m2 max estimee</span>
            </div>
            <div class="pcrd">
              <span class="pcl">SDP ESTIMEE</span>
              <span class="pcv">${contenance > 0 ? sdpEst : '—'}</span>
              <span class="pcu">m2</span>
            </div>
            <div class="pcrd">
              <span class="pcl">HAUTEUR MAX</span>
              <span class="pcv">${heMax}</span>
              <span class="pcu">m (PLU)</span>
            </div>
            <div class="pcrd">
              <span class="pcl">CONTENANCE</span>
              <span class="pcv">${contenance || '—'}</span>
              <span class="pcu">m2</span>
            </div>
          </div>

          ${sec('PROCHAINES ETAPES')}
          <div class="synth-row"><span class="si a">1</span><span class="st">Verifier les donnees reglementaires aupres des services competents</span></div>
          <div class="synth-row"><span class="si a">2</span><span class="st">Commander l'etude geotechnique G1 si requise</span></div>
          <div class="synth-row"><span class="si a">3</span><span class="st">Consulter le PLU en mairie pour les regles specifiques</span></div>
          <div class="synth-row"><span class="si a">4</span><span class="st">Developper l'esquisse architecturale en atelier</span></div>
        </div>
      </div>
      ${plancheFoot(terrain.commune, ref, num, tp)}
    </div>`;
  },

  // ═══════════════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════════════

  _getPhaseData(session, phaseId) {
    const sessionData = session?.getPhase?.(phaseId)?.data ?? {};
    const autoData = this._enrichedPhases?.[phaseId] ?? {};
    return { ...autoData, ...sessionData };
  },

  _getPlancheNum(base) {
    return base;
  },

  _getMissingCriticalPhases(session) {
    const critical = [
      { n: 0, label: 'Identification' },
      { n: 1, label: 'Topographie' },
      { n: 3, label: 'Risques PPRN' },
      { n: 4, label: 'PLU' },
    ];
    return critical
      .filter(c => {
        const p = session?.getPhase?.(c.n);
        return !p?.completed && !(p?.data && Object.keys(p.data).length > 3);
      })
      .map(c => `P${c.n} ${c.label}`);
  },

  // ═══════════════════════════════════════════════════════════════
  //  VISUAL CAPTURE (from DOM — existing canvases, SVGs, charts)
  // ═══════════════════════════════════════════════════════════════

  async _captureVisuals() {
    const v = {};

    // Carte Mapbox (phase 0)
    const map = window.MapViewer?.getMap?.() ?? window.TerlabMap?._map;
    if (map && !map.areTilesLoaded?.()) {
      await new Promise(resolve => {
        const onIdle = () => { map.off('idle', onIdle); resolve(); };
        map.once('idle', onIdle);
        setTimeout(resolve, 6000);
      });
    }
    v.map = window.TerlabMap?.captureAsDataURL?.() ?? null;

    // Snap carte avec ligne de coupe (phase 1)
    const p1Snap = window.SessionManager?.getPhase(1)?.data?.profile_map_snap;
    if (p1Snap) v.profileMapSnap = p1Snap;

    // Profil altimetrique Chart.js (phase 1)
    v.profileChart = this._canvasToDataURL('profile-chart');

    // Terrain SVG (phase 1)
    const terrainSvg = document.getElementById('terrainSVG');
    if (terrainSvg) v.terrainSvg = await this._svgToDataURL(terrainSvg, 600, 400);

    // Reculs canvas (phase 4)
    v.reculsCanvas = this._canvasToDataURL('reculs-canvas');

    // Vue 3D terrain (phase 7)
    v.terrain3d = window.Terrain3DViewer?.capture?.() ?? window.Terrain3D?.capture?.() ?? null;

    // Snapshot BIMShow Three.js (phase 7)
    const bimCanvas = document.querySelector('.tv-canvas');
    if (bimCanvas) { try { v.bimshow = bimCanvas.toDataURL('image/png'); } catch { /* GL context */ } }

    // ACV chart carbone (phase 9)
    v.acvChart = this._canvasToDataURL('acv-chart');

    // QR code (phase 12)
    v.qrCode = this._canvasToDataURL('qr-canvas');

    // Plan masse SVG (phase 11)
    const planSvg = document.getElementById('p11-svg');
    if (planSvg) v.planMasse = await this._svgToDataURL(planSvg, 1000, 700);

    // Wind navigator SVG (phase 7)
    const windSvg = document.querySelector('#p07-wind-navigator svg');
    if (windSvg) v.windNav = await this._svgToDataURL(windSvg, 600, 600);

    // Aeraulique overlay SVG (phase 1)
    const aeroSvg = document.getElementById('p01-aero-overlay');
    if (aeroSvg) v.aeroOverlay = await this._svgToDataURL(aeroSvg, 600, 300);

    // Coupes A/B SVG (phase 1)
    const sectionA = document.querySelector('#section-viewer-A svg');
    if (sectionA) v.sectionA = await this._svgToDataURL(sectionA, 700, 220);
    const sectionB = document.querySelector('#section-viewer-B svg');
    if (sectionB) v.sectionB = await this._svgToDataURL(sectionB, 700, 220);

    // Capture generique : tout canvas Chart.js
    v.chartCanvases = {};
    document.querySelectorAll('canvas').forEach(canvas => {
      try {
        const chartInstance = Chart?.getChart?.(canvas);
        if (chartInstance && canvas.id && canvas.width > 0) {
          v.chartCanvases[canvas.id] = canvas.toDataURL('image/png');
        }
      } catch { /* pas de Chart.js ou contexte GL */ }
    });

    // Capture couches GeoJSON custom
    try {
      const gjSvgEl = window.GeoJsonLayerService?.toSVGElement?.({ width: 800, height: 600 });
      if (gjSvgEl) v.customGeoJsonLayers = await this._svgToDataURL(gjSvgEl, 800, 600);
    } catch (e) { console.warn('[PDF] GeoJSON layers SVG error:', e); }

    // Capture generique : tout SVG present dans les phases
    v.svgDiagrams = {};
    const svgEls = document.querySelectorAll('svg[id]');
    for (const svgEl of svgEls) {
      try {
        if (svgEl.id && svgEl.getBBox().width > 0) {
          const snap = await this._svgToDataURL(svgEl, 600, 400);
          if (snap) v.svgDiagrams[svgEl.id] = snap;
        }
      } catch { /* SVG vide ou inaccessible */ }
    }

    // Phase snapshots
    v.phaseSnaps = {};
    for (let i = 0; i <= 12; i++) {
      const snap = window.SessionManager?.getPhase(i)?.data?.map_snapshot;
      if (snap) v.phaseSnaps[i] = snap;
    }

    // Active proposal (mode projet)
    v.activeProposal = window._activeProposal ?? null;

    // Coupe gabarit SVG (mode projet)
    try {
      const CSR = window.CapacityStudyRenderer;
      const proposal = v.activeProposal;
      if (CSR && proposal && window.SessionManager) {
        const svgStr = CSR.renderCoupeGabarit(window.SessionManager, proposal, null);
        if (svgStr && svgStr.length > 50) {
          const svgEl = new DOMParser().parseFromString(svgStr, 'image/svg+xml').documentElement;
          v.coupeGabarit = await this._svgToDataURL(svgEl, 840, 400);
        }
      }
    } catch (e) { console.warn('[PDF] Coupe gabarit capture error:', e); }

    console.log('[PDF] Visuels captures :', Object.keys(v).filter(k => v[k]).join(', '));
    return v;
  },

  /** Canvas to dataURL helper */
  _canvasToDataURL(id) {
    const canvas = document.getElementById(id);
    if (!canvas || canvas.width === 0) return null;
    try { return canvas.toDataURL('image/png'); } catch { return null; }
  },

  /** SVG element to dataURL via offscreen canvas */
  _svgToDataURL(svgEl, w, h) {
    return new Promise(resolve => {
      try {
        const serializer = new XMLSerializer();
        let svgStr = serializer.serializeToString(svgEl);
        // Assurer namespace
        if (!svgStr.includes('xmlns=')) {
          svgStr = svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
        }
        const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
      } catch { resolve(null); }
    });
  },

  // ═══════════════════════════════════════════════════════════════
  //  AUTO-ENRICH
  // ═══════════════════════════════════════════════════════════════

  async _autoEnrich(session, terrain) {
    const lat = parseFloat(terrain.lat);
    const lng = parseFloat(terrain.lng);
    if (!lat || !lng) return { terrain, phases: {}, autoFields: new Set() };

    const alt = parseFloat(terrain.altitude_ngr) || null;
    const geojson = terrain.parcelle_geojson ?? null;
    const autoFields = new Set();
    const enriched = { ...terrain };
    const phases = {};

    this._setProgress(6, 'Auto-enrichissement — requetes APIs...');

    const results = await Promise.allSettled([
      (async () => {
        const TA = window.TerrainAnalysis;
        if (!TA) return null;
        const zone = TA.deduireZoneClimatique?.(alt);
        const rtaa = TA.getZoneRTAA?.(alt);
        let pente = null;
        if (geojson && TA.calculateSlopeFromParcelle) {
          try {
            const sr = await TA.calculateSlopeFromParcelle(geojson, alt);
            pente = sr?.slope;
          } catch { /* fallback */ }
        }
        return { zone_climatique: zone, zone_rtaa: rtaa, pente_moy_pct: pente };
      })(),
      window.PPRService?.queryPoint?.(lat, lng)?.catch?.(() => null),
      window.PLUService?.queryZoneUrba?.(lat, lng)?.catch?.(() => null),
      (async () => {
        const B = window.BRGMService;
        if (!B) return null;
        if (B.queryWMS) return B.queryWMS(lat, lng);
        if (B.inferFromAltitude) return B.inferFromAltitude(alt, lat, lng);
        return null;
      })().catch(() => null),
      window.IGNElevationService?.getElevations?.([{ lng, lat }])?.catch?.(() => []),
      window.BuildingsService?.fetchBuildings?.(lat, lng, 200)?.catch?.(() => []),
    ]);

    const topo = results[0].status === 'fulfilled' ? results[0].value : null;
    const ppr  = results[1].status === 'fulfilled' ? results[1].value : null;
    const plu  = results[2].status === 'fulfilled' ? results[2].value : null;
    const geo  = results[3].status === 'fulfilled' ? results[3].value : null;
    const alti = results[4].status === 'fulfilled' ? results[4].value : null;
    const bati = results[5].status === 'fulfilled' ? results[5].value : null;

    const set = (obj, key, val, fieldName) => {
      if (val == null || val === '') return;
      if (obj[key] != null && obj[key] !== '' && obj[key] !== '—') return;
      obj[key] = val;
      autoFields.add(fieldName ?? key);
    };

    if (topo) {
      set(enriched, 'zone_climatique', topo.zone_climatique, 'zone_climatique');
      set(enriched, 'zone_rtaa', topo.zone_rtaa, 'zone_rtaa');
      set(enriched, 'pente_moy_pct', topo.pente_moy_pct != null ? parseFloat(topo.pente_moy_pct.toFixed?.(1) ?? topo.pente_moy_pct) : null, 'pente_moy_pct');
    }

    if (alti?.length) {
      const z = alti[0]?.z ?? alti[0]?.altitude;
      set(enriched, 'altitude_ngr', z, 'altitude_ngr');
      if (z != null && !terrain.zone_climatique) {
        const TA = window.TerrainAnalysis;
        if (TA) {
          enriched.zone_climatique = TA.deduireZoneClimatique?.(z) ?? enriched.zone_climatique;
          enriched.zone_rtaa = TA.getZoneRTAA?.(z) ?? enriched.zone_rtaa;
          autoFields.add('zone_climatique');
          autoFields.add('zone_rtaa');
        }
      }
    }

    if (ppr?.features?.length) {
      const props = ppr.features[0].properties ?? {};
      const pprZone = props.zone ?? props.alea ?? props.ZONE ?? null;
      const pprLabel = props.libelle ?? props.nom ?? props.LIBELLE ?? pprZone;
      set(enriched, 'zone_pprn', pprZone, 'zone_pprn');
      set(enriched, 'ppr_label', pprLabel, 'ppr_label');
      if (!phases[3]) phases[3] = {};
      set(phases[3], 'zone_pprn', pprZone, 'zone_pprn');
    }

    if (plu?.features?.length) {
      const props = plu.features[0].properties ?? {};
      const pluZone = props.libelle ?? props.typezone ?? props.LIBELLE ?? null;
      set(enriched, 'zone_plu', pluZone, 'zone_plu');
      if (!phases[4]) phases[4] = {};
      set(phases[4], 'zone_plu', pluZone, 'zone_plu');

      try {
        let adapterInst = window.PLUP07Adapter;
        if (!adapterInst) {
          const mod = await import('../services/plu-p07-adapter.js').catch(() => null);
          if (mod?.PLUP07Adapter) adapterInst = new mod.PLUP07Adapter();
          else if (mod?.default) adapterInst = typeof mod.default === 'function' ? new mod.default() : mod.default;
        }
        if (typeof adapterInst === 'function') adapterInst = new adapterInst();
        if (adapterInst && !adapterInst._loaded && adapterInst.loadRules) {
          await adapterInst.loadRules('../data/plu-rules-reunion.json');
        }
        if (adapterInst?.resolve) {
          const pluRules = adapterInst.resolve(
            enriched.code_insee ?? enriched.commune, pluZone, enriched.zone_rtaa
          );
          if (pluRules) {
            set(phases[4], 'hauteur_max_m', pluRules.plu?.heMax, 'hauteur_max_m');
            set(phases[4], 'emprise_sol_max_pct', pluRules.plu?.emprMax, 'emprise_sol_max_pct');
            set(phases[4], 'permeable_min_pct', pluRules.plu?.permMin, 'permeable_min_pct');
            set(phases[4], 'recul_voie_principale_m', pluRules.reculs?.voie, 'recul_voie_principale_m');
            set(phases[4], 'recul_voie_secondaire_m', pluRules.reculs?.voie_secondaire, 'recul_voie_secondaire_m');
            set(phases[4], 'recul_limite_sep_m', pluRules.reculs?.lat, 'recul_limite_sep_m');
            set(phases[4], 'recul_fond_m', pluRules.reculs?.fond, 'recul_fond_m');
            enriched._pluRules = pluRules;
          }
        }
      } catch (e) { console.warn('[PDF AutoEnrich] PLU adapter error:', e); }
    }

    if (geo) {
      const geoLabel = geo.label ?? geo.name ?? null;
      set(enriched, 'geologie_type', geoLabel, 'geologie_type');
      set(enriched, 'permeabilite', geo.permeability, 'permeabilite');
    }

    const batCount = Array.isArray(bati) ? bati.length : (bati?.features?.length ?? 0);
    if (batCount > 0) set(enriched, 'batiments_voisins_count', batCount, 'batiments_voisins_count');

    if (!enriched._pluRules && enriched.contenance_m2) {
      const zp = enriched.zone_plu ?? 'UB';
      const isU = /^U/i.test(zp);
      enriched._pluRules = {
        id: 'FALLBACK_GENERIC',
        plu: { emprMax: isU ? 60 : 40, permMin: isU ? 30 : 50, heMax: isU ? 9 : 7 },
        reculs: { voie: 3, fond: 3, lat: 1.5 },
      };
      if (!phases[4]) phases[4] = {};
      set(phases[4], 'hauteur_max_m', enriched._pluRules.plu.heMax, 'hauteur_max_m');
      set(phases[4], 'emprise_sol_max_pct', enriched._pluRules.plu.emprMax, 'emprise_sol_max_pct');
      set(phases[4], 'permeable_min_pct', enriched._pluRules.plu.permMin, 'permeable_min_pct');
      set(phases[4], 'recul_voie_principale_m', enriched._pluRules.reculs.voie, 'recul_voie_principale_m');
      set(phases[4], 'recul_limite_sep_m', enriched._pluRules.reculs.lat, 'recul_limite_sep_m');
      set(phases[4], 'recul_fond_m', enriched._pluRules.reculs.fond, 'recul_fond_m');
    }

    console.log('[PDF AutoEnrich]', autoFields.size, 'champs enrichis :', [...autoFields].join(', '));
    return { terrain: enriched, phases, autoFields };
  },

  // ═══════════════════════════════════════════════════════════════
  //  DXF
  // ═══════════════════════════════════════════════════════════════
  async generateDXF() {
    const session = window.SessionManager;
    const terrain = session?.getTerrain?.() ?? {};

    const parcelle = session?.getPhase?.(0)?.data ?? {};
    const p4       = session?.getPhase?.(4)?.data ?? {};

    if (!terrain.lat) {
      window.TerlabToast?.show('Completez la Phase 0 avant d\'exporter DXF', 'warning');
      return;
    }

    this._setProgress(20, 'Generation DXF...');

    try {
      const lat = parseFloat(terrain.lat ?? -21.11);
      const lng = parseFloat(terrain.lng ?? 55.54);
      const contenance = parseFloat(terrain.contenance_m2 ?? 400);
      const side = Math.sqrt(contenance).toFixed(2);

      const dxf = [
        '0', 'SECTION', '2', 'HEADER',
        '9', '$ACADVER', '1', 'AC1015',
        '9', '$EXTMIN', '10', '0', '20', '0',
        '9', '$EXTMAX', '10', side, '20', side,
        '0', 'ENDSEC',
        '0', 'SECTION', '2', 'ENTITIES',
        '0', 'LWPOLYLINE',
        '8', 'PARCELLE',
        '90', '4', '70', '1',
        '10', '0.0',    '20', '0.0',
        '10', side,     '20', '0.0',
        '10', side,     '20', side,
        '10', '0.0',    '20', side,
        ...(p4.recul_voie_principale_m ? [
          '0', 'LWPOLYLINE', '8', 'RECUL_VOIE', '90', '2', '70', '0',
          '10', `${p4.recul_voie_principale_m}`, '20', '0.0',
          '10', `${parseFloat(side) - p4.recul_voie_principale_m}`, '20', '0.0'
        ] : []),
        '0', 'TEXT', '8', 'ANNOTATIONS',
        '10', `${parseFloat(side)/2}`, '20', '-3',
        '40', '1.5', '1', `TERLAB - ${terrain.commune ?? ''} - ${terrain.section ?? ''}${terrain.parcelle ?? ''}`,
        '0', 'TEXT', '8', 'ANNOTATIONS',
        '10', '0', '20', '-5',
        '40', '1', '1', `Contenance approx: ${contenance} m2`,
        '0', 'ENDSEC',
        '0', 'EOF'
      ].join('\n');

      const blob = new Blob([dxf], { type: 'application/dxf' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `TERLAB_${terrain.commune ?? 'terrain'}_${terrain.section ?? ''}${terrain.parcelle ?? ''}.dxf`;
      a.click();
      URL.revokeObjectURL(url);

      session?.saveExport?.('dxf', a.download);
      window.TerlabToast?.show('DXF exporte', 'success');

    } catch (e) {
      window.TerlabToast?.show(`Erreur DXF : ${e.message}`, 'error');
    }
    this._hideProgress();
  },

  // ═══════════════════════════════════════════════════════════════
  //  GLB
  // ═══════════════════════════════════════════════════════════════
  async generateGLB() {
    const p7 = window.SessionManager?.getPhase?.(7)?.data ?? {};

    if (!p7.glb_base64) {
      window.TerlabToast?.show('Generez d\'abord le modele en Phase 7', 'warning');
      window.location.hash = '#phase/7';
      return;
    }

    const binary   = atob(p7.glb_base64);
    const bytes    = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const blob     = new Blob([bytes], { type: 'model/gltf-binary' });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    a.href         = url;
    a.download     = `TERLAB_gabarit_${window.SessionManager?.getTerrain?.()?.commune ?? 'terrain'}.glb`;
    a.click();
    URL.revokeObjectURL(url);

    window.TerlabToast?.show('GLB exporte', 'success');
  },

  // ═══════════════════════════════════════════════════════════════
  //  JSON SESSION
  // ═══════════════════════════════════════════════════════════════
  generateJSON() {
    const json = window.SessionManager?.exportJSON?.() ?? '{}';
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `TERLAB_session_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    window.TerlabToast?.show('Session JSON exportee', 'success');
  }
};

export default ExportEngine;
