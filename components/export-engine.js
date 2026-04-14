// TERLAB · export-engine.js · Moteur exports PDF/DXF/GLB/JSON · v3.0
// ════════════════════════════════════════════════════════════════════════════
// PDF A4 portrait – rendu print-template.html + window.print()
// Planches HTML injectées dans iframe, typo Cormorant Garamond / IBM Plex Mono / Jost
// ════════════════════════════════════════════════════════════════════════════

import MapCapture from './map-capture.js';
import GIEPPlanService from '../services/giep-plan-service.js';
import GIEPCalculator from '../services/giep-calculator-service.js';
import ANCService from '../services/anc-service.js';
import ANCPlanService from '../services/anc-plan-service.js';
import DiagRenderer from './diag-renderer.js';
import { buildCoupeSVGDocument } from '../utils/coupe-renderer.js';
import { loadPhrases, pickShort, buildPluContext, buildFullContext } from '../services/rapport-phrases-engine.js';

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

/** Petite phrase contextuelle italique sous une row (depuis rapport-phrases.json) */
const tag = (phrase) => phrase
  ? `<div class="fr-tag" style="font-size:6.6pt;color:#6a6860;font-style:italic;padding:0 4px 3px 6px;line-height:1.25;margin-top:-1px">${phrase}</div>`
  : '';

/** Row + phrase contextuelle en dessous */
const rowTag = (label, value, phrase, cls = '') => row(label, value, cls) + tag(phrase);

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

      // ── Dictionnaire de phrases contextuelles (rapport-phrases.json) ──
      this._phrasesDict = await loadPhrases();

      // ── Garde de qualite ──
      const score = session?.audit?.globalScore ?? window.TerlabScoreService?.computeGlobalScore?.(session) ?? 0;
      if (score < 40) {
        const missing = this._getMissingCriticalPhases(session);
        const proceed = await this._confirmLowScore(score, missing);
        if (!proceed) { this._hideProgress(); return; }
      }

      // ── Prefetch courbes de niveau (mutualisé via ContourCache) ──
      // Charge les contours BIL une seule fois pour qu'ils soient disponibles
      // dans les planches GIEP / topo / plan masse en mode sync.
      if (window.ContourCache) {
        const parcelGeo = window.ContourCache.parcelGeoFromTerrain(terrain);
        if (parcelGeo) {
          this._setProgress(32, 'Chargement courbes de niveau...');
          try {
            await window.ContourCache.loadOrGet(parcelGeo, { pixelSizeM: 1.0, maxDim: 220 });
          } catch (e) {
            console.warn('[ExportEngine] prefetch contours failed:', e?.message ?? e);
          }
        }
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
    // Total pages : cover+identité (1) + planche 2_3 (2) + [4 + GIEP en mode projet] + 5_6 (5/3) + 7 (synthèse fusionnée)
    // Site : 4 pages   ·   Projet : 6 pages
    const tp = mode === 'projet' ? 6 : 4;

    let html = '';
    html += this._renderCoverIdentite(session, terrain, maps, mode, tp, ref);
    html += this._renderPlanche2_3(session, terrain, maps, ref, tp); // Topo + Risques fusionnés

    if (mode === 'projet') {
      html += this._renderPlanche4(session, terrain, maps, ref, tp);
      html += this._renderPlancheGIEP(session, terrain, ref, tp);
      html += this._renderPlancheANC(session, terrain, ref, tp);
    }

    html += this._renderPlanche5_6(session, terrain, maps, ref, tp); // Voisinage + Gabarit fusionnés
    html += this._renderPlanche7(session, terrain, maps, ref, tp);    // Synthèse + Audit + Sources fusionnés

    return html;
  },

  // ═══════════════════════════════════════════════════════════════
  //  COVER + IDENTITE (fusionnées en 1 page)
  // ═══════════════════════════════════════════════════════════════

  _renderCoverIdentite(session, terrain, maps, mode, tp, ref) {
    const commune = (terrain.commune ?? 'Terrain').toUpperCase();
    const modeLabel = mode === 'projet' ? 'ANALYSE PROJET' : 'ANALYSE SITE';
    const uuid = session?.getOrCreateUUID?.()?.slice(-8) ?? '';
    const date = new Date().toLocaleDateString('fr-FR');

    return `<div class="page">
      ${pageHead('Analyse de terrain · ENSA La Reunion')}
      <div class="cover-body" style="padding-bottom:8px">
        <div class="mode-pill"><span class="mode-dot"></span>${modeLabel}</div>
        <div class="commune">${ref || commune}</div>
        <div class="parcelle-ref">${ref ? commune : ''}</div>
      </div>

      <div class="pb" style="display:flex;flex-direction:column;gap:10px;padding:0 40px">
        <div style="display:flex;gap:8px">
          <div style="flex:1;min-width:0">${mapImg(maps, 'cover_situation', 130, 'Ile · 1:500 000', 'Mapbox', svgSituation())}</div>
          <div style="flex:1;min-width:0">${mapImg(maps, 'p01_situation_marked', 130, 'Commune · 1:25 000', 'Mapbox Satellite')}</div>
          <div style="flex:1;min-width:0">${mapImg(maps, 'p01_situation', 130, 'Quartier · 1:5 000', 'Mapbox Satellite')}</div>
        </div>
        <div style="display:flex;gap:14px">
          <div class="sec" style="flex:0.78;min-width:0">
            ${sec('IDENTIFICATION')}
            ${row('Commune', terrain.commune)}
            ${row('Code INSEE', terrain.code_insee)}
            ${row('Section / Parcelle', `${val(terrain.section)} / ${val(terrain.parcelle)}`)}
            ${row('Contenance', terrain.contenance_m2 ? `${terrain.contenance_m2} m2` : null)}
            ${row('Intercommunalite', terrain.intercommunalite)}
            ${row('Zone PLU', terrain.zone_plu, 'ac')}
            ${row('Altitude NGR', terrain.altitude_ngr != null ? `${terrain.altitude_ngr} m` : null)}
            ${row('Orientation', terrain.orientation ?? terrain.orientation_terrain)}
            ${row('Pente moy.', terrain.pente_moy_pct != null ? `${terrain.pente_moy_pct} %` : null)}
            ${row('Adresse', terrain.adresse)}
            ${row('Coordonnees', terrain.lat && terrain.lng ? `${Number(terrain.lat).toFixed(4)}, ${Number(terrain.lng).toFixed(4)}` : null)}
          </div>
          <div style="flex:1.22;min-width:0">
            ${mapImg(maps, 'p01_cadastre', 360, 'Parcelle · Cadastre', 'IGN · Mapbox Satellite')}
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

    // Coupes A/B — profils altimétriques LiDAR
    const sectionAImg = this._visuals?.sectionA
      ? `<div class="map-wrap" style="height:110px"><img src="${this._visuals.sectionA}" alt="Coupe A longitudinale" style="object-fit:contain"><span class="map-lbl">Coupe A — Longitudinale (LiDAR)</span></div>`
      : '';
    const sectionBImg = this._visuals?.sectionB
      ? `<div class="map-wrap" style="height:110px;margin-top:4px"><img src="${this._visuals.sectionB}" alt="Coupe B perpendiculaire" style="object-fit:contain"><span class="map-lbl">Coupe B — Perpendiculaire (LiDAR)</span></div>`
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

    // Phrases contextuelles PLU (rapport-phrases.json)
    const phrasesDict  = this._phrasesDict ?? {};
    const pluCtx       = buildPluContext(terrain, p4);
    const phZone       = pickShort(phrasesDict, 'plu', 'zone',       pluCtx);
    const phHauteur    = pickShort(phrasesDict, 'plu', 'hauteur',    pluCtx);
    const phEmprise    = pickShort(phrasesDict, 'plu', 'emprise',    pluCtx);
    const phReculVoie  = pickShort(phrasesDict, 'plu', 'recul_voie', pluCtx);
    const phReculLat   = pickShort(phrasesDict, 'plu', 'recul_lat',  pluCtx);
    const phReculFond  = pickShort(phrasesDict, 'plu', 'recul_fond', pluCtx);

    // Format helpers pour les reculs (m, accepte 0)
    const reculVal = (v) => v != null ? `${v} m` : null;
    // Affichage du fond : "idem latéral" si non différencié dans le PLU
    const reculFondLabel = (p4.recul_fond_m == null && p4.recul_limite_sep_m != null)
      ? 'idem latéral'
      : reculVal(p4.recul_fond_m);

    const pprSnap = terrain.snap_ppr ?? this._visuals?.phaseSnaps?.[3] ?? null;
    const reculsSnap = this._visuals?.reculsCanvas ?? null;

    // Bioclimatique (héliodone + rose des vents MF)
    const helioImg = this._visuals?.heliodone ?? null;
    const windImg  = this._visuals?.windRose  ?? null;
    const windMeta = this._visuals?.windMeta  ?? {};
    const rainfallMeta = this._visuals?.rainfallMeta ?? {};

    // ── Contexte complet pour toutes les sections phrase ──
    const fullCtx = buildFullContext(terrain, { 3: p3, 4: p4 }, { windMeta, rainfallMeta });

    // Topographie
    const phPente   = pickShort(phrasesDict, 'topographie', 'pente',     fullCtx);
    const phAlt     = pickShort(phrasesDict, 'topographie', 'altitude',  fullCtx);
    const phOrient  = pickShort(phrasesDict, 'topographie', 'orientation', fullCtx);
    // Geologie
    const phGeoType = pickShort(phrasesDict, 'geologie', 'type',         fullCtx);
    const phRemblai = pickShort(phrasesDict, 'geologie', 'remblai',      fullCtx);
    const phGeotech = pickShort(phrasesDict, 'geologie', 'geotechnique', fullCtx);
    // Risques extra
    const phPprn    = pickShort(phrasesDict, 'risques', 'pprn',          fullCtx);
    const phCoteRef = pickShort(phrasesDict, 'risques_extra', 'cote_ref',  fullCtx);
    const phRtaaVent= pickShort(phrasesDict, 'risques_extra', 'rtaa_vent', fullCtx);
    const phHydrant = pickShort(phrasesDict, 'risques_extra', 'hydrant',   fullCtx);
    // Bioclim extra
    const phVentDir = pickShort(phrasesDict, 'bioclimatique_extra', 'vent_dominant', fullCtx);
    const phVentVit = pickShort(phrasesDict, 'bioclimatique_extra', 'vent_vitesse',  fullCtx);
    const phPluvio  = pickShort(phrasesDict, 'bioclimatique_extra', 'pluviometrie',  fullCtx);

    // Flèche vent dominant pour overlay sur la carte PPRN
    // Convention météo : "vent du E" = vent VENANT de l'Est → flèche pointant vers l'Ouest
    const SECTOR_AZIMUTH = {
      N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
      S: 180, SSO: 202.5, SO: 225, OSO: 247.5, O: 270, ONO: 292.5, NO: 315, NNO: 337.5,
    };
    const dirAz = windMeta.dominantDir != null ? SECTOR_AZIMUTH[windMeta.dominantDir] : null;
    // Path dessiné pointant vers le HAUT (Nord, y négatif) pour qu'une rotation = azimut.
    // Le vent "va vers" l'opposé de sa direction d'origine ⇒ rotation = az + 180°.
    const arrowRot = dirAz != null ? (dirAz + 180) % 360 : null;
    // Path ondulé (deux cubiques en S inverse) + tête de flèche triangulaire au bout.
    const wavyPath = 'M 0 28 C -9 18, 9 8, 0 -2 C -9 -12, 9 -22, 0 -32';
    const arrowHead = 'M -8 -24 L 0 -36 L 8 -24 Z';
    const windArrowSvg = (arrowRot != null) ? `
      <svg class="wind-arrow" viewBox="-44 -44 88 88" xmlns="http://www.w3.org/2000/svg"
           style="position:absolute;top:4px;right:4px;width:62px;height:62px;pointer-events:none">
        <!-- Repère N fixe (non rotaté), petit, en haut-gauche -->
        <g opacity="0.85">
          <line x1="-36" y1="-30" x2="-36" y2="-40" stroke="#1C1C1A" stroke-width="1.2" stroke-linecap="round"/>
          <text x="-36" y="-22" text-anchor="middle" font-family="monospace" font-size="9" font-weight="bold" fill="#1C1C1A">N</text>
        </g>
        <!-- Flèche ondulée rotatée -->
        <g transform="rotate(${arrowRot.toFixed(1)})">
          <!-- Halo blanc pour lisibilité sur fond satellite -->
          <path d="${wavyPath}" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>
          <path d="${arrowHead}" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="4" stroke-linejoin="round" opacity="0.85"/>
          <!-- Trait terracotta -->
          <path d="${wavyPath}" fill="none" stroke="#C1652B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="${arrowHead}" fill="#C1652B" stroke="#C1652B" stroke-width="1.2" stroke-linejoin="round"/>
        </g>
        <!-- Label dir au bas, fixe -->
        <text x="0" y="42" text-anchor="middle" font-family="monospace" font-size="10" font-weight="bold"
              fill="#C1652B" stroke="#FFFFFF" stroke-width="2.5" paint-order="stroke">${windMeta.dominantDir}</text>
      </svg>` : '';

    // PPRN hors zone — message explicite
    const pprnHorsZoneMsg = !zone
      ? `<div class="hbox" style="background:#F5F0E8;padding:4px 8px;margin:2px 0;font-size:7.5pt">
          <p style="margin:0">Parcelle hors zone PPR approuve — verifier PPRN en cours d'elaboration aupres de la DEAL 974</p>
        </div>`
      : '';

    return `<div class="page">
      ${plancheHead('Analyse du site & Risques', 2, tp, ref)}
      <div class="pb pb3">
        <div class="sec">
          ${sec('TOPOGRAPHIE')}
          ${rowTag('Orientation', terrain.orientation ?? terrain.orientation_terrain, phOrient)}
          ${row('Alt. min/max', terrain.alt_min_dem != null && terrain.alt_max_dem != null ? `${terrain.alt_min_dem} — ${terrain.alt_max_dem} m NGR` : null)}
          ${tag(phAlt)}
          ${rowTag('Pente moy.', terrain.pente_moy_pct != null ? `${terrain.pente_moy_pct} %` : null, phPente)}
          ${row('Zone pluvio.', terrain.zone_pluviometrique ?? terrain.zone_pluvio)}

          ${sec('GEOLOGIE')}
          ${geoLabel ? `<div class="hbox"><p>Type : <strong>${geoLabel}</strong>${geoIsAuto ? ' <span class="fv au"></span>' : ''}</p></div>${tag(phGeoType)}` : ''}
          ${rowTag('Remblai', { non: 'Non', possible: 'Possible', oui: 'Oui' }[terrain.remblai], phRemblai)}
          ${rowTag('Geotechnique', { non: 'Non requise', g1: 'G1 requise', recommande: 'Recommandee' }[terrain.geotech], phGeotech)}
          ${maps?.p02_geologie ? `
          <div class="map-wrap" style="height:135px;margin-top:4px">
            <img src="${maps.p02_geologie}" alt="Carte geologie BRGM">
            <span class="map-lbl">Geologie · BRGM 1:50 000</span>
            <span class="map-src">geoservices.brgm.fr WMS</span>
          </div>` : ''}

          ${sectionAImg}
          ${sectionBImg}

          ${this._visuals?.contoursMap ? `
          <div class="map-wrap" style="height:160px;margin-top:4px;background:#fcf9f3">
            <img src="${this._visuals.contoursMap}" alt="Courbes de niveau" style="object-fit:contain">
            <span class="map-lbl">Topographie · ${this._visuals.contoursMeta?.interval ?? '?'}m · ${this._visuals.contoursMeta?.minAlt ?? '?'}–${this._visuals.contoursMeta?.maxAlt ?? '?'}m NGR</span>
            <span class="map-src">IGN BIL HD</span>
          </div>` : ''}
        </div>
        <div class="sec">
          ${sec('RISQUES — PPRN')}
          ${zone ? `<div class="hbox"><p>Zone <strong style="color:${zoneColor[zone] ?? '#C1652B'}">${zone}</strong> — ${zoneDesc[zone] ?? ''}</p></div>${tag(phPprn)}` : pprnHorsZoneMsg}
          ${rowTag('Cote ref. NGR', p3.cote_reference_ngr != null ? `${p3.cote_reference_ngr} m NGR` : null, phCoteRef)}
          ${rowTag('Zone vent RTAA', p3.zone_rtaa_vent, phRtaaVent)}
          ${rowTag('Hydrant < 150 m', { oui: 'Oui', non: 'Non', verif: 'A verifier' }[p3.hydrant_present], phHydrant)}

          ${pprSnap ? `
          <div class="map-wrap" style="height:140px">
            <img src="${pprSnap}" alt="Carte PPR">
            ${windArrowSvg}
            <span class="map-lbl">Carte PPR${windMeta.dominantDir ? ` · vent ${windMeta.dominantDir}` : ''}</span>
            <span class="map-src">AGORAH PEIGEO</span>
          </div>` : `<div class="map-wrap" style="height:140px">
            ${maps?.p03_ppr ? `<img src="${maps.p03_ppr}" alt="PPR — Vue rapprochee">` : svgPlaceholder('PPR — Vue rapprochee')}
            ${windArrowSvg}
            <span class="map-lbl">PPR — Vue rapprochee${windMeta.dominantDir ? ` · vent ${windMeta.dominantDir}` : ''}</span>
            <span class="map-src">AGORAH PEIGEO</span>
          </div>`}
        </div>
        <div class="sec">
          ${sec('PLU & RECULS')}
          ${zonePlu ? `<div class="hbox"><p>Zone <strong>${zonePlu}</strong> — ${pluDesc[zonePlu] ?? ''}</p></div>${tag(phZone)}` : ''}
          ${rowTag('Hauteur max', p4.hauteur_max_m ? `${p4.hauteur_max_m} m` : null, phHauteur)}
          ${rowTag('Emprise sol', p4.emprise_sol_max_pct ? `${p4.emprise_sol_max_pct} %` : null, phEmprise)}
          ${rowTag('Recul voirie',  reculVal(p4.recul_voie_principale_m), phReculVoie)}
          ${rowTag('Recul latéral', reculVal(p4.recul_limite_sep_m),      phReculLat)}
          ${rowTag('Recul fond',    reculFondLabel,                        phReculFond)}

          ${reculsSnap ? `
          <div class="map-wrap" style="height:130px">
            <img src="${reculsSnap}" alt="Schema reculs">
            <span class="map-lbl">Schema des reculs</span>
          </div>` : ''}

          ${this._renderScotPanel(this._visuals?.scotData)}
        </div>
        <div class="sec">
          ${sec('BIOCLIMATIQUE')}
          ${(helioImg || windImg) ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
            ${helioImg ? `
            <div class="map-wrap" style="height:135px;background:#f5f4f1">
              <img src="${helioImg}" alt="Heliodone" style="object-fit:contain">
              <span class="map-lbl">Héliodone${windMeta.lat != null ? ` · φ=${windMeta.lat.toFixed(2)}°` : ''}</span>
            </div>` : ''}
            ${windImg ? `
            <div class="map-wrap" style="height:135px;background:#f5f4f1">
              <img src="${windImg}" alt="Rose des vents" style="object-fit:contain">
              <span class="map-lbl">Rose vents${windMeta.stationName ? ` · ${windMeta.stationName}` : ''}</span>
              <span class="map-src">${windMeta.source ?? '—'}</span>
            </div>` : ''}
          </div>
          ${rowTag('Dir. dominante', windMeta.dominantDir, phVentDir)}
          ${rowTag('Vitesse moy.', windMeta.meanSpeed != null ? `${windMeta.meanSpeed} m/s` : null, phVentVit)}
          ${row('Période', windMeta.period)}
          ${tag(phPluvio)}
          ` : `<div class="hbox" style="background:#F5F0E8;padding:4px 8px;font-size:7.5pt"><p style="margin:0">Diagrammes bioclimatiques non disponibles (latitude/longitude manquantes)</p></div>`}

          ${this._visuals?.rainfallChart ? `
          <div class="map-wrap" style="height:140px;margin-top:6px;background:#fcf9f3">
            <img src="${this._visuals.rainfallChart}" alt="Pluviométrie mensuelle" style="object-fit:contain">
            <span class="map-lbl">Pluviométrie · ${this._visuals.rainfallMeta?.annual ?? '?'} mm/an</span>
            <span class="map-src">${this._visuals.rainfallMeta?.source ?? 'ERA5'}</span>
          </div>` : ''}
        </div>
      </div>
      ${plancheFoot(terrain.commune, ref, 2, tp)}
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

    // Métriques en bande horizontale compacte
    const mRow = (l, v) => v != null && v !== '' ? `<span class="phf-e" style="margin-right:12px"><strong>${l}</strong> ${v}</span>` : '';

    // Variante active (utilisée comme label sur l'image plan masse)
    // Tableau Pareto retiré temporairement de la planche 4 — réintégration à venir.
    const activeFamily = proposal?.family ?? null;

    // ── Phrases contextuelles plan masse ──
    const phrasesDict = this._phrasesDict ?? {};
    const fullCtx = buildFullContext(terrain, {}, { proposal });
    const phCes        = pickShort(phrasesDict, 'plan_masse', 'ces',        fullCtx);
    const phPermeable  = pickShort(phrasesDict, 'plan_masse', 'permeable',  fullCtx);
    const phVegetation = pickShort(phrasesDict, 'plan_masse', 'vegetation', fullCtx);
    const narrPM = [phCes, phPermeable, phVegetation].filter(Boolean).join(' ');
    const narrPMHtml = narrPM
      ? `<div class="hbox" style="background:#fcf9f3;padding:5px 9px;font-size:7pt;line-height:1.45;border-left:2px solid #C1652B;font-style:italic;color:#6a6860"><p style="margin:0">${narrPM}</p></div>`
      : '';

    return `<div class="page">
      ${plancheHead('Plan masse & Conformite', 3, tp, ref)}
      <div class="pb" style="display:flex;flex-direction:column;gap:4px">
        <div style="display:flex;flex-wrap:wrap;gap:2px 0;font-size:7.5pt;line-height:1.6">
          ${mRow('Emprise', metrics.emprise_m2 ? `${metrics.emprise_m2} m2` : null)}
          ${mRow('SDP', metrics.sdp_m2 ? `${metrics.sdp_m2} m2` : null)}
          ${mRow('CES', metrics.ces_pct ? `${metrics.ces_pct}%` : null)}
          ${mRow('Permeable', metrics.permeable_pct ? `${metrics.permeable_pct}%` : null)}
          ${mRow('Hauteur', bat.h ? `${bat.h} m` : null)}
          ${mRow('Niveaux', bat.niveaux)}
          ${mRow('Arbres', metrics.arbres_count)}
          ${mRow('Veg.', metrics.vegetation_m2 ? `${metrics.vegetation_m2} m2` : null)}
          ${mRow('Amenites', metrics.amenites?.join(', '))}
        </div>
        ${narrPMHtml}
        <div style="display:flex;flex-direction:column;gap:6px;flex:1;min-height:0">
          ${this._visuals?.cadastreVector ? `
          <div class="map-wrap" style="flex:1;width:100%;min-height:0">
            <img src="${this._visuals.cadastreVector}" alt="Plan cadastral" style="object-fit:contain">
            <span class="map-lbl">Plan cadastral · contexte IGN</span>
            <span class="map-src">IGN · Cadastre WFS + BDTOPO</span>
          </div>` : ''}
          ${planMasseImg ? `
          <div class="map-wrap" style="flex:1;width:100%;min-height:0">
            <img src="${planMasseImg}" alt="Plan masse" style="object-fit:contain">
            <span class="map-lbl">Plan masse · variante ${activeFamily ?? '?'}</span>
            <span class="map-src">TERLAB · Auto-plan</span>
          </div>` : `
          <div class="map-wrap" style="flex:1;width:100%;min-height:0">
            ${svgPlaceholder('Plan masse')}
            <span class="map-lbl">Plan masse</span>
          </div>`}
        </div>
      </div>
      ${plancheFoot(terrain.commune, ref, 3, tp)}
    </div>`;
  },

  // ═══════════════════════════════════════════════════════════════
  //  PLANCHE GIEP — Plan Gestion Integree Eaux Pluviales (auto)
  // ═══════════════════════════════════════════════════════════════

  _renderPlancheGIEP(session, terrain, ref, tp) {
    // Calcul GIEP depuis session
    const sessionData = {
      terrain,
      phases: {
        7: session?.getPhase?.(7) ?? {},
        8: session?.getPhase?.(8) ?? {},
      },
    };
    const giepResult = GIEPCalculator.computeFromSession(sessionData);
    if (!giepResult) return ''; // pas assez de données

    // Proposal depuis le visuals ou la session
    const proposal = this._visuals?.activeProposal ?? window._activeProposal ?? null;
    if (!proposal || (!proposal.bat && !proposal.blocs?.length)) return ''; // pas d'étude de capacité

    // Générer le plan GIEP SVG
    const giepSVG = GIEPPlanService.generatePlan(session, proposal, giepResult);
    if (!giepSVG) return '';

    // Tableau hydraulique compact
    const hydroHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:2px 12px;font-size:7.5pt;line-height:1.5">
        <span><strong>Zone clim.</strong> ${giepResult.zone_nom}</span>
        <span><strong>Tc</strong> ${giepResult.tc} min (K:${giepResult.tc_kirpich} C:${giepResult.tc_caquot} S:${giepResult.tc_sogreah})</span>
        <span><strong>I T10</strong> ${giepResult.intensite_T10} mm/h</span>
        <span><strong>C init.</strong> ${giepResult.coeffInit}</span>
        <span><strong>C projet</strong> ${giepResult.coeffFinal}</span>
        <span><strong>Q init.</strong> ${giepResult.debitInit} L/s</span>
        <span><strong>Q projet</strong> ${giepResult.debitFinal} L/s</span>
        <span><strong>Reduction</strong> <strong style="color:${giepResult.scoreColor}">${giepResult.reduction_pct}%</strong></span>
        ${giepResult.infiltration ? `
        <span><strong>V net</strong> ${giepResult.infiltration.V_net.toFixed(1)} m3</span>
        <span><strong>S infilt.</strong> ${giepResult.infiltration.A_inf.toFixed(0)} m2</span>
        <span><strong>S EV dispo</strong> ${giepResult.infiltration.A_dispo.toFixed(0)} m2</span>
        <span><strong>${giepResult.infiltration.deficit > 0 ? 'Deficit' : 'Marge'}</strong>
          <strong style="color:${giepResult.infiltration.deficit > 0 ? 'var(--danger)' : 'var(--success)'}">
            ${Math.abs(giepResult.infiltration.deficit).toFixed(0)} m2
          </strong></span>` : ''}
      </div>`;

    // Score badge
    const scoreBadge = `<div style="text-align:center;margin:4px 0">
      <span style="font-size:22pt;font-weight:bold;color:${giepResult.scoreColor};font-family:var(--font-serif)">${giepResult.score}<small>/100</small></span>
      <span style="color:${giepResult.scoreColor};font-size:10pt;margin-left:8px">${giepResult.scoreLabel}</span>
    </div>`;

    return `<div class="page">
      ${plancheHead('Plan GIEP — Gestion Integree Eaux Pluviales', 'GIEP', tp, ref)}
      <div class="pb" style="display:flex;flex-direction:column;gap:4px">
        ${scoreBadge}
        ${hydroHTML}
        <div class="map-wrap" style="flex:1;min-height:400px">
          ${giepSVG}
          <span class="map-lbl">Plan GIEP</span>
          <span class="map-src">TERLAB · Methode rationnelle DEAL Reunion 2012</span>
        </div>
      </div>
      ${plancheFoot(terrain.commune, ref, 'GIEP', tp)}
    </div>`;
  },

  // ═══════════════════════════════════════════════════════════════
  //  PLANCHE ANC — Assainissement Non Collectif
  // ═══════════════════════════════════════════════════════════════

  _renderPlancheANC(session, terrain, ref, tp) {
    const sessionData = {
      terrain,
      phases: {
        4: { data: this._getPhaseData(session, 4) },
        7: { data: this._getPhaseData(session, 7) },
      },
      pluResolved: terrain._pluRules,
    };
    const ancResult = ANCService.computeFromSession(sessionData);
    if (!ancResult?.besoinANC) return '';

    const proposal = this._visuals?.activeProposal ?? window._activeProposal ?? null;
    const ancSVG = proposal ? ANCPlanService.generatePlan(session, proposal, ancResult) : '';

    const dim = ancResult.dimensionnement;
    const cout = ancResult.cout;

    // Tableau technique
    const techHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:2px 12px;font-size:7.5pt;line-height:1.5">
        <span><strong>Filiere</strong> ${ancResult.recommandation?.label ?? '—'}</span>
        <span><strong>EH</strong> ${ancResult.eh}</span>
        <span><strong>Volume EU</strong> ${ancResult.volume_m3_jour} m3/j</span>
        <span><strong>K sol</strong> ${ancResult.k_mmh} mm/h (${ancResult.classeK?.label})</span>
        <span><strong>Pente</strong> ${ancResult.pente_pct}%</span>
        ${dim?.fosse ? `<span><strong>Fosse</strong> ${dim.fosse.volume_m3} m3</span>` : ''}
        ${dim ? `<span><strong>Emprise ANC</strong> ${dim.empriseTotal_m2} m2</span>` : ''}
        ${cout ? `<span><strong>CapEx</strong> ${cout.capex_min.toLocaleString()}-${cout.capex_max.toLocaleString()} EUR</span>` : ''}
        ${cout ? `<span><strong>OpEx</strong> ${cout.opex_annuel} EUR/an</span>` : ''}
      </div>`;

    // Score badge
    const scoreBadge = `<div style="text-align:center;margin:4px 0">
      <span style="font-size:22pt;font-weight:bold;color:${ancResult.scoreColor};font-family:var(--font-serif)">${ancResult.score}<small>/100</small></span>
      <span style="color:${ancResult.scoreColor};font-size:10pt;margin-left:8px">${ancResult.scoreLabel}</span>
    </div>`;

    // Conformité
    const confHTML = ancResult.conformite?.length ? `
      <div style="font-size:7.5pt;margin-top:4px">
        ${ancResult.conformite.map(c => {
          const color = c.severity === 'error' ? '#DC2626' : c.severity === 'warning' ? '#D97706' : '#16A34A';
          const icon = c.severity === 'error' ? '✗' : c.severity === 'warning' ? '⚠' : '✓';
          return `<div style="color:${color}">${icon} ${c.text}</div>`;
        }).join('')}
      </div>` : '';

    // SPANC
    const spancHTML = ancResult.spanc ? `
      <div style="font-size:7pt;margin-top:4px;padding:4px;background:#EFF6FF;border-radius:3px">
        SPANC : <strong>${ancResult.spanc.nom}</strong> — ${ancResult.spanc.tel}
      </div>` : '';

    return `<div class="page">
      ${plancheHead('Plan ANC — Assainissement Non Collectif', 'ANC', tp, ref)}
      <div class="pb" style="display:flex;flex-direction:column;gap:4px">
        ${scoreBadge}
        ${techHTML}
        ${ancSVG ? `<div class="map-wrap" style="flex:1;min-height:350px">
          ${ancSVG}
          <span class="map-lbl">Plan ANC</span>
          <span class="map-src">DTU 64.1 · Arrete 7 sept. 2009 · Guide SPANC Reunion</span>
        </div>` : ''}
        ${confHTML}
        ${spancHTML}
      </div>
      ${plancheFoot(terrain.commune, ref, 'ANC', tp)}
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
    // Site mode (tp=4) → page 3 ; Projet mode (tp=6) → page 5 (après cover, 2_3, 4, GIEP)
    const num = tp >= 6 ? 5 : 3;

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

    // ── Phrases contextuelles planche 5_6 ──
    const phrasesDict = this._phrasesDict ?? {};
    const proposal = this._visuals?.activeProposal ?? window._activeProposal ?? null;
    const fullCtx = buildFullContext(
      terrain,
      { 3: this._getPhaseData(session, 3), 4: this._getPhaseData(session, 4), 6: p6, 7: p7, 8: p8 },
      { proposal, giepResult: giep, windMeta: this._visuals?.windMeta ?? {}, rainfallMeta: this._visuals?.rainfallMeta ?? {} }
    );
    // Reseaux
    const phIcpe        = pickShort(phrasesDict, 'reseaux', 'icpe',          fullCtx);
    const phParc        = pickShort(phrasesDict, 'reseaux', 'parc_national', fullCtx);
    const phEau         = pickShort(phrasesDict, 'reseaux', 'eau_potable',   fullCtx);
    const phAssain      = pickShort(phrasesDict, 'reseaux', 'assainissement',fullCtx);
    const phElec        = pickShort(phrasesDict, 'reseaux', 'electricite',   fullCtx);
    const phFibre       = pickShort(phrasesDict, 'reseaux', 'fibre',         fullCtx);
    // Esquisse
    const phSdp         = pickShort(phrasesDict, 'esquisse', 'surface_plancher', fullCtx);
    const phNiveaux     = pickShort(phrasesDict, 'esquisse', 'niveaux',          fullCtx);
    const phGabarit     = pickShort(phrasesDict, 'esquisse', 'gabarit',          fullCtx);
    // Chantier
    const phSaison      = pickShort(phrasesDict, 'chantier', 'saison',       fullCtx);
    const phGestionEau  = pickShort(phrasesDict, 'chantier', 'gestion_eaux', fullCtx);
    // GIEP (cable ici car GIEP score affiche dans planche 5_6)
    const phGiepScore   = pickShort(phrasesDict, 'giep', 'score',        fullCtx);
    const phGiepReduc   = pickShort(phrasesDict, 'giep', 'reduction',    fullCtx);
    // SDIS synthese
    const phSdisSynth   = pickShort(phrasesDict, 'sdis', 'synthese',     fullCtx);

    return `<div class="page">
      ${plancheHead('Voisinage & Esquisse', num, tp, ref)}
      <div class="pb pb3">
        <div class="sec">
          ${sec('VOISINAGE & RESEAUX')}
          ${rowTag('ICPE < 500 m', { non: 'Non', oui: 'Oui', verif: 'A verifier' }[terrain.icpe], phIcpe)}
          ${rowTag('Parc National', parcLabels[p6.parc_situation] ?? p6.parc_situation, phParc)}
          ${rowTag('Eau potable', reseauLabels[terrain.eau_potable] ?? terrain.eau_potable, phEau)}
          ${rowTag('Assainissement', reseauLabels[terrain.assainissement] ?? terrain.assainissement, phAssain)}
          ${rowTag('Electricite', reseauLabels[terrain.electricite] ?? terrain.electricite, phElec)}
          ${rowTag('Fibre', reseauLabels[terrain.fibre] ?? terrain.fibre, phFibre)}

          ${snapBati ? `
          <div class="map-wrap" style="height:130px">
            <img src="${snapBati}" alt="Batiments voisins">
            <span class="map-lbl">Batiments voisins 3D</span>
          </div>` : mapImg(_maps, 'p05_context3d', 130, 'Contexte 3D', 'Mapbox')}

          ${this._visuals?.obiaChart ? `
          <div class="map-wrap" style="height:135px;margin-top:4px;background:#fcf9f3">
            <img src="${this._visuals.obiaChart}" alt="OBIA couverture du sol" style="object-fit:contain">
            <span class="map-lbl">Couverture sol · ${this._visuals.obiaMeta?.top ?? 'OBIA'}</span>
            <span class="map-src">Mapbox sat. · OBIA HSV</span>
          </div>` : ''}
        </div>
        <div class="sec">
          ${sec('ESQUISSE DU PROJET')}
          ${rowTag('Surface plancher', p7.surface_plancher_m2 ? `${p7.surface_plancher_m2} m2` : null, phSdp)}
          ${rowTag('Niveaux', p7.niveaux, phNiveaux)}
          ${rowTag('Gabarit L x l x h', (p7.gabarit_l_m && p7.gabarit_w_m && p7.gabarit_h_m) ?
            `${p7.gabarit_l_m} x ${p7.gabarit_w_m} x ${p7.gabarit_h_m} m` : null, phGabarit)}
          ${preEsquisseHtml}

          ${coupeGabarit ? `
          <div class="map-wrap" style="height:140px">
            <img src="${coupeGabarit}" alt="Coupe gabarit">
            <span class="map-lbl">Coupe N-S · Reculs</span>
          </div>` : ''}

          ${snapshot3d ? `
          <div class="map-wrap" style="height:130px">
            <img src="${snapshot3d}" alt="LiDAR vue oblique" style="object-fit:contain">
            <span class="map-lbl">LiDAR · vue oblique 38°</span>
            <span class="map-src">IGN HD · Three.js</span>
          </div>` : ''}
          ${this._visuals?.terrain3dTop ? `
          <div class="map-wrap" style="height:130px;margin-top:4px">
            <img src="${this._visuals.terrain3dTop}" alt="LiDAR vue oblique 60° opposee" style="object-fit:contain">
            <span class="map-lbl">LiDAR · vue oblique 60° opposee</span>
            <span class="map-src">IGN HD · Three.js</span>
          </div>` : ''}
        </div>
        <div class="sec">
          ${sec('CHANTIER & SDIS')}
          ${rowTag('Demarrage', { hors_cyclone: 'Hors cyclone', cyclone: 'Saison cyclonique' }[p8.saison_demarrage], phSaison)}
          ${rowTag('Gestion eaux', { bassin: 'Bassin', cunettes: 'Cunettes', a_definir: 'A definir' }[p8.gestion_eaux_chantier], phGestionEau)}
          ${giepHtml || row('GIEP', null)}
          ${tag(phGiepScore)}
          ${tag(phGiepReduc)}

          ${sec('SDIS 974')}
          ${this._renderSdisChecklist(p8)}
          ${tag(phSdisSynth)}
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

  // Panneau SCoT compact — affiché sous PLU & RECULS en planche 2_3
  // Source : SCOTService.analyze() depuis data/scot-rules-{interco}.json (DOO)
  _renderScotPanel(scot) {
    if (!scot) return '';
    if (scot.status !== 'ok') {
      return `<div class="hbox" style="background:#F5F0E8;padding:4px 8px;font-size:7pt;margin-top:4px">
        <p style="margin:0"><strong>SCoT</strong> · ${val(scot.message ?? scot.status)}</p>
      </div>`;
    }
    const r = scot.rang;
    const d = scot.densite;
    const cap = scot.capacite;
    const log = scot.logement;
    const env = scot.environnement_resume ?? {};
    // Densité : la valeur peut être un nombre OU un objet {min, max}
    const formatDens = (v) => {
      if (v == null) return null;
      if (typeof v === 'object') return `${v.min}–${v.max}`;
      return String(v);
    };
    const densMinStr = formatDens(d?.densite_min_lgts_ha);
    const densMaxStr = formatDens(d?.densite_max_lgts_ha);
    const densLabel = densMinStr
      ? `${densMinStr}${densMaxStr ? '–' + densMaxStr : ' min'} lgts/ha`
      : '—';
    // Bande ravine : objet {min, max}
    const bandeStr = env.bande_ravine_m
      ? (typeof env.bande_ravine_m === 'object'
          ? `${env.bande_ravine_m.min}–${env.bande_ravine_m.max} m enherbée`
          : `${env.bande_ravine_m} m enherbée`)
      : null;
    return `
      ${sec(`SCOT · ${scot.interco}`)}
      <div class="hbox" style="background:#F5F0E8;padding:5px 8px;font-size:7pt;line-height:1.4">
        <p style="margin:0"><strong>${scot.scot_nom}</strong>${scot.approbation ? ` · approuvé ${scot.approbation}` : ''}</p>
        ${r ? `<p style="margin:2px 0 0">Armature urbaine · <strong>rang ${r.rang_num}</strong> — ${r.label}${r.place_urbaine ? ` (${r.place_urbaine})` : ''}</p>` : ''}
      </div>
      ${row('Densité min DOO', densLabel)}
      ${cap ? row('Capacité indicative', `${cap.logements_min_scot ?? '?'} lgts min${cap.logements_max_scot ? ` / ${cap.logements_max_scot} max` : ''}`) : ''}
      ${log?.pct_aides != null ? row('Logements aidés', `${log.pct_aides}% prod.`) : ''}
      ${d?.zatt_500m ? row('ZATT 500 m', d.zatt_500m.rang_1_2_densite_min ? `≥ ${d.zatt_500m.rang_1_2_densite_min} lgts/ha si rang 1-2` : 'Oui') : ''}
      ${bandeStr ? row('Bande ravine', bandeStr) : ''}
      ${env.assainissement ? row('Assainissement', env.assainissement) : ''}
      ${log?.orientations_resume?.length ? `
      <div class="hbox" style="background:#fcf9f3;padding:4px 7px;font-size:6.6pt;line-height:1.4;margin-top:3px;border-left:2px solid #C1652B">
        ${log.orientations_resume.slice(0, 3).map(o => `<p style="margin:1px 0;font-style:italic;color:#6a6860">· ${o}</p>`).join('')}
      </div>` : ''}
    `;
  },

  // ═══════════════════════════════════════════════════════════════
  //  PLANCHE 7 — Checklist & Audit
  // ═══════════════════════════════════════════════════════════════

  _renderPlanche7(session, terrain, _maps, ref, tp) {
    const num = tp;

    // ── Phase progress ────────────────────────────────────────────
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

    // ── Commentaire global ────────────────────────────────────────
    const p12 = session?.getPhase?.(12)?.data ?? {};
    const commentaire = p12.commentaire_global ?? null;
    const enseignant = p12.enseignant ?? null;

    // ── Synthèse des enjeux ───────────────────────────────────────
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
    if (terrain.assainissement === 'ANC') {
      const ancFil = terrain.anc_filiere;
      const ancLabels = {
        epandage_classique: 'epandage classique', filtre_sable_vertical: 'filtre a sable',
        filtre_sable_vertical_draine: 'filtre a sable draine', micro_station: 'micro-station',
        filtre_plante: 'phytoepuration', filtre_compact: 'filtre compact', tertre_infiltration: 'tertre hors sol',
      };
      const filLabel = ancLabels[ancFil] ?? 'etude filiere requise';
      items.push({ icon: '-', cls: 'm', text: `ANC — ${filLabel} · K=${terrain.anc_k_mmh ?? '?'} mm/h` });
    }
    if (items.length === 0) {
      items.push({ icon: '?', cls: 'a', text: 'Analyse incomplete — completer les phases pour obtenir la synthese' });
    }
    const synthHtml = items.map(it =>
      `<div class="synth-row"><span class="si ${it.cls}">${it.icon}</span><span class="st">${it.text}</span></div>`
    ).join('');

    // ── Potentiel constructif ─────────────────────────────────────
    const contenance = parseFloat(terrain.contenance_m2) || 0;
    const pluRules = terrain._pluRules;
    const empMax = pluRules?.plu?.emprMax ?? 60;
    const heMax  = pluRules?.plu?.heMax ?? 9;
    const empriseEst = Math.round(contenance * empMax / 100);
    const sdpEst     = empriseEst * Math.floor(heMax / 3);

    // ── Sources utilisées ─────────────────────────────────────────
    const windMeta = this._visuals?.windMeta ?? {};
    const sources = this._getSourcesUsed(terrain, windMeta);
    const sourcesHtml = sources.map(s =>
      `<div class="fr"><span class="fl">${s.lbl}</span><span class="fv">${s.src}</span></div>`
    ).join('');

    return `<div class="page">
      ${plancheHead('Synthèse, audit & sources', num, tp, ref)}
      <div class="pb pb3">
        <!-- Colonne gauche : Synthèse + Potentiel + Prochaines étapes -->
        <div class="sec">
          ${sec('SYNTHESE DES ENJEUX')}
          ${synthHtml}

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

        <!-- Colonne droite : Audit + Sources + Avertissement -->
        <div class="sec">
          ${sec('PROGRESSION DES PHASES')}
          ${progressHtml}

          ${sec('SOURCES UTILISEES')}
          ${sourcesHtml}

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
  //  SOURCES — utilisé par la planche fusionnée Audit + Synthèse
  // ═══════════════════════════════════════════════════════════════

  _getSourcesUsed(terrain, windMeta) {
    // Sources actives selon les données récupérées par l'enrichissement
    const sources = [
      { lbl: 'Cadastre PARCELLAIRE EXPRESS', src: 'IGN Géoplateforme · WFS' },
      { lbl: 'Fond satellite & relief',      src: 'Mapbox GL JS' },
    ];
    if (terrain?.parcelle_geojson)
      sources.push({ lbl: 'Géocodage commune INSEE', src: 'geo.api.gouv.fr' });
    if (terrain?.altitude_ngr != null || terrain?.alt_min_dem != null)
      sources.push({ lbl: 'Altimétrie · MNT BIL',     src: 'IGN Alti · API publique' });
    if (terrain?.lidar_source === 'lidar_hd' || terrain?.alt_min_dem != null)
      sources.push({ lbl: 'Nuage de points LiDAR HD', src: 'IGN LiDAR HD · COPC' });
    if (terrain?.zone_pprn != null || terrain?.ppr_label != null)
      sources.push({ lbl: 'PPRN — Plan Prévention Risques', src: 'AGORAH PEIGEO · WMS' });
    if (terrain?.zone_plu != null)
      sources.push({ lbl: 'Zonage PLU communal',      src: 'API Carto IGN · GPU' });
    if (terrain?.geologie_type != null)
      sources.push({ lbl: 'Géologie · cartes 1/50 000', src: 'BRGM InfoTerre · WMS' });
    if (terrain?.station_meteo != null)
      sources.push({ lbl: 'Données climatiques station',  src: 'Météo-France Réunion' });
    if (windMeta?.source === 'MF-precomputed')
      sources.push({ lbl: 'Rose des vents · station MF', src: `Météo-France · ${windMeta.stationName ?? '—'}` });
    else if (windMeta?.source === 'ERA5-Open-Meteo')
      sources.push({ lbl: 'Rose des vents · réanalyse',  src: 'Open-Meteo ERA5 · ECMWF' });
    sources.push({ lbl: 'Bâti & voirie · BD TOPO',       src: 'IGN BD TOPO · WFS' });
    sources.push({ lbl: 'Règles RTAA DOM 974',           src: 'DEAL Réunion' });
    sources.push({ lbl: 'Fiches Envirobat Réunion',       src: 'Envirobat-Réunion · PDF' });
    return sources;
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

  /**
   * Modal "completude faible" — remplace le confirm() natif.
   * Retourne une Promise<boolean> : true = proceder quand meme, false = annuler.
   */
  _confirmLowScore(score, missing) {
    return new Promise((resolve) => {
      const prev = document.getElementById('terlab-export-confirm');
      if (prev) prev.remove();

      const missingHtml = missing?.length
        ? `<ul class="mlp-list">${missing.map(m => `<li>${m}</li>`).join('')}</ul>`
        : '<p class="mlp-muted">Aucune phase critique detectee.</p>';

      const el = document.createElement('div');
      el.id = 'terlab-export-confirm';
      el.innerHTML = `
        <style>
          #terlab-export-confirm {
            position:fixed; inset:0; z-index:10000;
            background:rgba(8,14,24,0.75); backdrop-filter:blur(4px);
            display:flex; align-items:center; justify-content:center;
            animation:mlpFade .18s ease;
          }
          @keyframes mlpFade { from { opacity:0 } to { opacity:1 } }
          .mlp-box {
            background:var(--surface, #1a1814);
            border:1px solid var(--border, #2a2a2a);
            border-radius:8px; box-shadow:0 20px 60px rgba(0,0,0,.6);
            max-width:460px; width:90%; padding:20px 24px;
            font-family:var(--font-body, system-ui);
            color:var(--text, #e8e4dd);
          }
          .mlp-head { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
          .mlp-icon { font-size:22px; }
          .mlp-title { font-size:14px; font-weight:600; color:var(--text); margin:0; }
          .mlp-score {
            font-family:var(--font-mono, monospace); font-size:11px;
            padding:2px 8px; border-radius:3px; margin-left:auto;
            background:rgba(232,100,50,.15); color:#e86432;
          }
          .mlp-body { font-size:12px; line-height:1.55; color:var(--text2, #ccc); }
          .mlp-body p { margin:6px 0; }
          .mlp-list { margin:6px 0 8px; padding-left:18px; font-size:11px; }
          .mlp-list li { color:var(--accent, #9a7820); font-family:var(--font-mono); }
          .mlp-muted { color:var(--muted, #888); font-size:11px; font-style:italic; }
          .mlp-actions { display:flex; gap:8px; margin-top:16px; justify-content:flex-end; }
          .mlp-btn {
            padding:8px 16px; border-radius:4px; font-size:11px;
            font-family:var(--font-mono, monospace); cursor:pointer;
            border:1px solid var(--border, #2a2a2a); background:transparent;
            color:var(--text2); transition:all .15s;
          }
          .mlp-btn:hover { border-color:var(--accent, #9a7820); color:var(--text); }
          .mlp-btn-primary {
            background:var(--accent, #9a7820); color:#000; border-color:var(--accent);
            font-weight:600;
          }
          .mlp-btn-primary:hover { background:var(--accent, #9a7820); filter:brightness(1.1); }
        </style>
        <div class="mlp-box" role="dialog" aria-labelledby="mlp-title">
          <div class="mlp-head">
            <span class="mlp-icon">⚠</span>
            <h3 id="mlp-title" class="mlp-title">Complétude de l'analyse</h3>
            <span class="mlp-score">${score}%</span>
          </div>
          <div class="mlp-body">
            <p>Le document PDF contiendra de nombreuses données manquantes.</p>
            <p style="margin-top:10px;font-weight:600">Phases critiques à compléter :</p>
            ${missingHtml}
            <p class="mlp-muted">Vous pouvez continuer pour un export brut, ou revenir compléter les phases.</p>
          </div>
          <div class="mlp-actions">
            <button class="mlp-btn" data-action="cancel">Revenir compléter</button>
            <button class="mlp-btn mlp-btn-primary" data-action="proceed">Exporter quand même</button>
          </div>
        </div>
      `;
      document.body.appendChild(el);

      const close = (result) => {
        el.remove();
        resolve(result);
      };
      el.querySelector('[data-action="cancel"]').addEventListener('click', () => close(false));
      el.querySelector('[data-action="proceed"]').addEventListener('click', () => close(true));
      el.addEventListener('click', (e) => { if (e.target === el) close(false); });
      document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { document.removeEventListener('keydown', esc); close(false); }
      });
    });
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

  /**
   * Si les DOM #section-viewer-A/B ne contiennent pas de SVG, calcule les
   * coupes A/B via SectionProfileViewer + LiDAR et les rend dans des conteneurs
   * caches. Utilise lors d'un export sans passage prealable par Phase 1.
   */
  async _ensureSectionsRendered() {
    const existingA = document.querySelector('#section-viewer-A svg');
    const existingB = document.querySelector('#section-viewer-B svg');
    if (existingA && existingB) return;

    const SV = window.SectionProfileViewer;
    const SM = window.SessionManager;
    const MV = window.MapViewer ?? window.TerlabMap;
    if (!SV || !SM) return;

    const terrain = SM.getTerrain?.() ?? {};
    const geojson = terrain.parcelle_geojson;
    const lat = parseFloat(terrain.lat), lng = parseFloat(terrain.lng);
    if (!geojson || !Number.isFinite(lat) || !Number.isFinite(lng)) return;

    // Creer les conteneurs DOM caches si absents
    const ensureDiv = (id) => {
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.style.cssText = 'position:absolute;left:-9999px;width:700px;height:220px;';
        document.body.appendChild(el);
      }
      return el;
    };
    ensureDiv('section-viewer-A');
    ensureDiv('section-viewer-B');

    const center = [lng, lat];
    const orientation = terrain.orientation_terrain || 'S';
    let axes;
    try {
      axes = SV.computeSectionAxes(geojson, orientation, center);
    } catch (e) { console.warn('[Export] computeSectionAxes failed:', e.message); return; }
    if (!axes) return;

    // Charger les points LiDAR si dispo (sinon fallback IGN/DEM interne)
    const lidarPts = window.LidarService?.getRawPoints?.() ?? null;

    try {
      const [profileA, profileB] = await Promise.all([
        SV.extractProfile(axes.A, lidarPts),
        SV.extractProfile(axes.B, lidarPts),
      ]);

      const map = MV?.getMap?.();
      const annoA = [
        ...(SV.findParcelBoundaryIntersections?.(axes.A.start, axes.A.end, geojson) ?? []),
        ...(map && SV.findRoadIntersections ? SV.findRoadIntersections(axes.A.start, axes.A.end, map) : []),
      ];
      const annoB = [
        ...(SV.findParcelBoundaryIntersections?.(axes.B.start, axes.B.end, geojson) ?? []),
        ...(map && SV.findRoadIntersections ? SV.findRoadIntersections(axes.B.start, axes.B.end, map) : []),
      ];

      let scatterA = null, scatterB = null;
      if (lidarPts?.length && window.LidarService?.getScatterFromPoints) {
        const rA = window.LidarService.getScatterFromPoints(lidarPts, axes.A.start, axes.A.end, 8);
        const rB = window.LidarService.getScatterFromPoints(lidarPts, axes.B.start, axes.B.end, 8);
        scatterA = rA?.scatter?.length ? rA.scatter : null;
        scatterB = rB?.scatter?.length ? rB.scatter : null;
      }

      if (profileA?.data?.length) {
        SV.render('A', 'section-viewer-A', profileA.data, annoA, { scatter: scatterA });
        if (SV._viewers?.A) SV._viewers.A.source = profileA.source;
        SV._renderSVG?.('A');
      }
      if (profileB?.data?.length) {
        SV.render('B', 'section-viewer-B', profileB.data, annoB, { scatter: scatterB });
        if (SV._viewers?.B) SV._viewers.B.source = profileB.source;
        SV._renderSVG?.('B');
      }
      console.log('[Export] Coupes A/B generees a la volee (source:',
        profileA?.source ?? '?', '/', profileB?.source ?? '?', ')');
    } catch (e) {
      console.warn('[Export] Generation coupes A/B failed:', e.message);
    }
  },

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

    // Plan cadastre vecteur — esquisse SVG avec cadastre visible
    v.cadastreVector = await this._captureCadastreVector();

    // Wind navigator SVG (phase 7)
    const windSvg = document.querySelector('#p07-wind-navigator svg');
    if (windSvg) v.windNav = await this._svgToDataURL(windSvg, 600, 600);

    // Aeraulique overlay SVG (phase 1)
    const aeroSvg = document.getElementById('p01-aero-overlay');
    if (aeroSvg) v.aeroOverlay = await this._svgToDataURL(aeroSvg, 600, 300);

    // Coupes A/B SVG (phase 1) - genere a la volee si absentes du DOM
    await this._ensureSectionsRendered();
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

    // ── Diagrammes bioclimatiques (héliodone + rose des vents MF) ───────────
    // Génère deux canvas off-screen 600px → dataURL PNG.
    // Source vent : station Météo-France pré-calculée < 8 km, fallback ERA5 Open-Meteo.
    // Mode "minimal" : pas de légendes intra-canvas (l'export-engine ajoute ses
    // propres pills .map-lbl par-dessus, et la station/v̄/dir vont dans le row meta).
    try {
      const r = await DiagRenderer.renderDiagrams(window.SessionManager, { size: 600, minimal: true });
      v.heliodone = r.heliCanvas.toDataURL('image/png');
      v.windRose  = r.windCanvas.toDataURL('image/png');
      v.windMeta  = {
        stationName: r.windData?.stationName ?? null,
        dominantDir: r.windData?.dominantDir ?? null,
        meanSpeed:   r.windData?.meanSpeed ?? null,
        source:      r.windData?.source ?? null,
        period:      r.windData?.period ?? null,
        lat:         r.lat,
      };
      console.log('[PDF] Bioclim : héliodone φ=' + r.lat.toFixed(2) + '° + rose ' + (r.windData?.dominantDir ?? '?') + ' (' + (r.windData?.source ?? '?') + ')');
    } catch (e) { console.warn('[PDF] Bioclim capture error:', e); }

    // ── Pluviométrie mensuelle (Open-Meteo ERA5, 5 dernières années) ─────────
    try {
      const PS = window.PrecipitationService;
      const t  = window.SessionManager?.getTerrain?.() ?? {};
      const lat = parseFloat(t.lat), lng = parseFloat(t.lng);
      if (PS && lat && lng) {
        const rain = await PS.fetchMonthly(lat, lng, 5);
        const svgStr = PS.renderBarChart(rain, { width: 600, height: 220 });
        const blob = new Blob([svgStr], { type: 'image/svg+xml' });
        v.rainfallChart = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(blob); });
        v.rainfallMeta = { annual: rain.annual, period: rain.period, source: rain.source };
        console.log('[PDF] Pluviométrie : ' + rain.annual + ' mm/an (' + rain.period + ')');
      }
    } catch (e) { console.warn('[PDF] Pluviométrie capture error:', e.message); }

    // ── Topographie courbes de niveau IGN BIL (1 m) ──────────────────────────
    try {
      const CC = window.ContourCache;
      const CS = window.ContourService;
      const tt = window.SessionManager?.getTerrain?.() ?? {};
      const parcelGeo = CC?.parcelGeoFromTerrain?.(tt);
      if (CC && CS && parcelGeo?.length >= 3) {
        // loadOrGet déclenche fromBIL si pas déjà cache (P01 / GIEP / SitePlan ont pu le faire)
        const data = await CC.loadOrGet(parcelGeo, { pixelSizeM: 1.0, maxDim: 220, padM: 12 });
        if (data?.lines?.length) {
          const svgStr = CS.renderTopoSVG(data, parcelGeo, { width: 600, height: 380 });
          const blob = new Blob([svgStr], { type: 'image/svg+xml' });
          v.contoursMap = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(blob); });
          v.contoursMeta = { interval: data.interval, minAlt: Math.round(data.minAlt), maxAlt: Math.round(data.maxAlt), nLines: data.lines.length };
          console.log('[PDF] Courbes niveau BIL : ' + data.lines.length + ' lignes, ' + data.interval + 'm interval, ' + Math.round(data.minAlt) + '-' + Math.round(data.maxAlt) + 'm NGR');
        }
      }
    } catch (e) { console.warn('[PDF] Contours BIL capture error:', e.message); }

    // ── SCoT analyse (intercommunalité, rang armature, densité, environnement) ──
    try {
      const SC = window.SCOTService;
      const ts = window.SessionManager?.getTerrain?.() ?? {};
      if (SC && ts.code_insee && ts.commune) {
        const surface = parseFloat(ts.contenance_m2) || null;
        const scot = await SC.analyze({
          insee: ts.code_insee,
          commune: ts.commune,
          quartier: ts.lieu_dit ?? ts.quartier ?? null,
          surface_m2: surface,
        });
        if (scot && scot.status === 'ok') {
          v.scotData = scot;
          console.log('[PDF] SCoT : ' + scot.interco + ' rang ' + (scot.rang?.rang_num ?? '?') + ' (' + (scot.rang?.label ?? '?') + ')');
        } else if (scot?.status) {
          v.scotData = scot;
          console.log('[PDF] SCoT : ' + scot.status + (scot.message ? ' — ' + scot.message : ''));
        }
      }
    } catch (e) { console.warn('[PDF] SCoT capture error:', e.message); }

    // ── Analyse OBIA satellite (couverture sol depuis Mapbox) ───────────────
    try {
      const OBIA = window.OBIAService;
      const ttO  = window.SessionManager?.getTerrain?.() ?? {};
      const mapO = window.MapViewer?.getMap?.() ?? window.TerlabMap?._map;
      const geoO = ttO.parcelle_geojson;
      if (OBIA && mapO && geoO) {
        const result = await OBIA.analyzeParcel(mapO, geoO);
        if (result?.surfaces) {
          // Rendu SVG : 6 barres horizontales triées par % décroissant
          const W = 600, H = 220;
          const margin = { top: 28, right: 14, bottom: 14, left: 130 };
          const cW = W - margin.left - margin.right;
          const cH = H - margin.top - margin.bottom;
          const rows = Object.entries(OBIA.LABELS)
            .map(([k, lbl]) => ({ key: k, lbl, pct: result.surfaces[k] ?? 0 }))
            .filter(r => r.pct > 0)
            .sort((a, b) => b.pct - a.pct);
          const rowH = cH / Math.max(rows.length, 1);
          const parts = [];
          parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="IBM Plex Mono,monospace">`);
          parts.push(`<rect width="${W}" height="${H}" fill="#fcf9f3"/>`);
          parts.push(`<text x="${W/2}" y="14" text-anchor="middle" font-size="10" font-weight="700" fill="#1C1C1A">Couverture du sol · OBIA satellite</text>`);
          parts.push(`<text x="${W - 6}" y="14" text-anchor="end" font-size="7" fill="#A8A49C">${result.pixelCount.toLocaleString('fr-FR')} pixels · ±15%</text>`);
          rows.forEach((r, i) => {
            const y = margin.top + i * rowH;
            const barW = (r.pct / 100) * cW;
            const rgb = (OBIA.CLASS_COLORS[r.key] ?? [150,150,150]).slice(0, 3).join(',');
            parts.push(`<text x="${margin.left - 6}" y="${y + rowH * 0.65}" text-anchor="end" font-size="8" fill="#1C1C1A">${r.lbl}</text>`);
            parts.push(`<rect x="${margin.left}" y="${y + rowH * 0.25}" width="${cW}" height="${rowH * 0.5}" fill="#EDEBE6"/>`);
            parts.push(`<rect x="${margin.left}" y="${y + rowH * 0.25}" width="${barW.toFixed(1)}" height="${rowH * 0.5}" fill="rgb(${rgb})" fill-opacity="0.85"/>`);
            parts.push(`<text x="${margin.left + barW + 4}" y="${y + rowH * 0.65}" font-size="8" fill="#1C1C1A" font-weight="600">${r.pct}%</text>`);
          });
          parts.push('</svg>');
          const blob = new Blob([parts.join('')], { type: 'image/svg+xml' });
          v.obiaChart = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(blob); });
          v.obiaMeta = { confidence: result.confidence, pixelCount: result.pixelCount, top: rows[0]?.lbl };
          console.log('[PDF] OBIA : ' + result.pixelCount + ' pixels, top=' + rows[0]?.lbl + ' (' + rows[0]?.pct + '%)');
        }
      }
    } catch (e) { console.warn('[PDF] OBIA capture error:', e.message); }

    // Active proposal (mode projet)
    v.activeProposal = window._activeProposal ?? null;

    // Coupe N-S gabarit PLU + toiture 2 pans (utils/coupe-renderer.js)
    // ⚠️  hé mesuré depuis le sol AVAL (point le plus bas adjacent au bâtiment),
    //     pente terrain lue dans la session — pas de valeur hardcodée.
    try {
      const sm = window.SessionManager;
      if (sm?._data) {
        const svgDoc = buildCoupeSVGDocument(sm._data, {
          width:  1200,
          height: 500,
          forPDF: true,
          isDark: false,
        });
        const svgEl = new DOMParser().parseFromString(svgDoc, 'image/svg+xml').documentElement;
        v.coupeGabarit = await this._svgToDataURL(svgEl, 1200, 500);
      }
    } catch (e) { console.warn('[PDF] Coupe N-S capture error:', e); }

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

  // Capture plan cadastre vecteur depuis EsquisseCanvas SVG
  async _captureCadastreVector() {
    try {
      const ec = window.EsquisseCanvas;
      if (!ec?._svg) return null;

      // S'assurer que le cadastre vecteur est chargé et dessiné
      if (!ec._cadastreVectorGeo) {
        const features = await ec._loadCadastreVector?.();
        if (!features) return null;
        ec._drawCadastreVector(features);
      }

      // Créer un SVG isolé avec : cadastre vecteur + parcelle + nord
      const svgNS = 'http://www.w3.org/2000/svg';
      const svgClone = ec._svg.cloneNode(true);

      // Ne garder que cadastre-vector-layer, parcelle, north
      const keepers = new Set(['cadastre-vector-layer', 'parcelle-layer', 'north-indicator', 'scale-bar']);
      for (const child of [...svgClone.children]) {
        const id = child.getAttribute('id') ?? '';
        if (!keepers.has(id) && id !== '') {
          // Garder les defs (patterns, gradients)
          if (child.tagName !== 'defs') child.remove();
        }
      }

      // Dessiner la parcelle en surbrillance dans le clone
      const parcelG = svgClone.querySelector('#parcelle-layer');
      if (!parcelG) {
        // Ajouter un outline parcelle
        const g = document.createElementNS(svgNS, 'g');
        g.setAttribute('id', 'parcelle-layer');
        const parcelPolys = ec._svg.querySelectorAll('[id^="parcel-"]');
        parcelPolys.forEach(p => g.appendChild(p.cloneNode(true)));
        svgClone.appendChild(g);
      }

      return await this._svgToDataURL(svgClone, 800, 560);
    } catch (e) {
      console.warn('[ExportEngine] Capture cadastre vector failed:', e.message);
      return null;
    }
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
  //  DXF — Parcelle 2D (contour reel + reculs + gabarit P07)
  // ═══════════════════════════════════════════════════════════════
  async generateDXF() {
    const session = window.SessionManager;
    const terrain = session?.getTerrain?.() ?? {};

    if (!terrain.lat) {
      window.TerlabToast?.show('Completez la Phase 0 avant d\'exporter DXF', 'warning');
      return;
    }
    if (!window.DXFWorker) {
      window.TerlabToast?.show('DXFWorker indisponible', 'error');
      return;
    }

    this._setProgress(20, 'Generation DXF parcelle...');
    try {
      const sessionData = {
        terrain,
        phases: {
          0: session?.getPhase?.(0) ?? null,
          4: session?.getPhase?.(4) ?? null,
          7: session?.getPhase?.(7) ?? null,
        },
      };
      const dxf      = window.DXFWorker.generate(sessionData);
      const filename = window.DXFWorker.download(dxf, terrain, 'parcelle');
      session?.saveExport?.('dxf', filename);
      window.TerlabToast?.show('DXF parcelle exporte', 'success');
    } catch (e) {
      window.TerlabToast?.show(`Erreur DXF : ${e.message}`, 'error');
    }
    this._hideProgress();
  },

  // ═══════════════════════════════════════════════════════════════
  //  DXF Site 3D — Terrain DEM IGN + batiments BDTOPO + routes drapees
  //  Compatible ArchiCAD 18+, AutoCAD, QGIS. Coords locales m, EPSG:2975.
  // ═══════════════════════════════════════════════════════════════
  async generateDXFSite(opts = {}) {
    const session = window.SessionManager;
    const terrain = session?.getTerrain?.() ?? {};

    if (!terrain.lat) {
      window.TerlabToast?.show('Completez la Phase 0 avant d\'exporter le site 3D', 'warning');
      return;
    }
    if (!window.SiteCaptureService || !window.DXFWorker) {
      window.TerlabToast?.show('SiteCaptureService ou DXFWorker indisponible', 'error');
      return;
    }

    const {
      bufferM    = 100,
      pixelSizeM = 2,
      withBuildings = true,
      withRoads     = true,
      decimate      = false,
    } = opts;

    this._setProgress(2, 'Capture site 3D...');
    const ctrl = new AbortController();
    try {
      const scene = await window.SiteCaptureService.capture({
        bufferM, pixelSizeM, withBuildings, withRoads, decimate,
        signal: ctrl.signal,
        onProgress: (pct, label) => this._setProgress(Math.min(95, pct), label),
      });

      this._setProgress(96, 'Generation DXF R2000...');
      const dxf = window.DXFWorker.generateSite3D(scene, { withBuildings, withRoads });

      this._setProgress(99, 'Telechargement...');
      const filename = window.DXFWorker.download(dxf, terrain, 'site3d');
      session?.saveExport?.('dxf_site3d', filename);

      window.TerlabToast?.show(
        `Site 3D exporte (${scene.terrainMesh.triangles.length} triangles, ${scene.buildings.length} batiments, ${scene.roads.length} routes)`,
        'success'
      );
    } catch (e) {
      if (e.name === 'AbortError') {
        window.TerlabToast?.show('Export site 3D annule', 'info');
      } else {
        window.TerlabToast?.show(`Erreur site 3D : ${e.message}`, 'error');
      }
    }
    this._hideProgress();
  },

  // ═══════════════════════════════════════════════════════════════
  //  IFC — Gabarit Phase 7 simple (IFC 2x3 ASCII)
  // ═══════════════════════════════════════════════════════════════
  async generateIFC() {
    const session = window.SessionManager;
    const terrain = session?.getTerrain?.() ?? {};

    if (!terrain.lat) {
      window.TerlabToast?.show('Completez la Phase 0 avant d\'exporter IFC', 'warning');
      return;
    }
    if (!window.IFCExporter) {
      window.TerlabToast?.show('IFCExporter indisponible', 'error');
      return;
    }

    this._setProgress(20, 'Generation IFC gabarit...');
    try {
      const sessionData = {
        sessionId: session?._sessionId ?? session?.getField?.('sessionId') ?? 'TERLAB',
        terrain,
        phases: {
          4: session?.getPhase?.(4) ?? null,
          7: session?.getPhase?.(7) ?? null,
        },
      };
      const result = await window.IFCExporter.exportFromPhase7(sessionData);
      session?.saveExport?.('ifc', `${terrain.commune ?? 'terrain'}_gabarit.ifc`);
      window.TerlabToast?.show(
        result.source === 'bimshow' ? 'IFC exporte via BIMSHOW' : 'IFC gabarit exporte (IFC 2x3 ASCII)',
        'success'
      );
    } catch (e) {
      window.TerlabToast?.show(`Erreur IFC : ${e.message}`, 'error');
    }
    this._hideProgress();
  },

  // ═══════════════════════════════════════════════════════════════
  //  IFC Site — Gabarit + voisins BDTOPO extrudes + propertyset terrain
  // ═══════════════════════════════════════════════════════════════
  async generateIFCSite(opts = {}) {
    const session = window.SessionManager;
    const terrain = session?.getTerrain?.() ?? {};

    if (!terrain.lat) {
      window.TerlabToast?.show('Completez la Phase 0 avant d\'exporter IFC site', 'warning');
      return;
    }
    if (!window.SiteCaptureService || !window.IFCExporter) {
      window.TerlabToast?.show('SiteCaptureService ou IFCExporter indisponible', 'error');
      return;
    }

    const {
      bufferM    = 100,
      pixelSizeM = 5,            // Plus grossier pour IFC : on n'exporte pas la TIN
      withBuildings = true,
      withRoads     = false,     // Routes en IFC = bruit visuel sans valeur ajoutee
    } = opts;

    this._setProgress(2, 'Capture site...');
    const ctrl = new AbortController();
    try {
      const scene = await window.SiteCaptureService.capture({
        bufferM, pixelSizeM, withBuildings, withRoads,
        signal: ctrl.signal,
        onProgress: (pct, label) => this._setProgress(Math.min(85, pct), label),
      });

      this._setProgress(88, 'Generation IFC enrichi...');
      const p7 = session?.getPhase?.(7)?.data ?? {};
      const params = {
        L: parseFloat(p7.gabarit_l_m ?? 10),
        W: parseFloat(p7.gabarit_w_m ?? 8),
        H: parseFloat(p7.gabarit_h_m ?? 6),
        niveaux: parseInt(p7.niveaux ?? 1),
      };
      const sessionData = {
        sessionId: session?._sessionId ?? 'TERLAB',
        terrain,
        phases: {
          4: session?.getPhase?.(4) ?? null,
          7: session?.getPhase?.(7) ?? null,
        },
      };

      const ifc = window.IFCExporter.generateASCIIWithContext(sessionData, params, scene);

      const slug = window.SiteCaptureService.slugify;
      const filename = `TERLAB_${slug(terrain.commune)}_${slug((terrain.section ?? '') + (terrain.parcelle ?? ''))}_site3d.ifc`;
      window.IFCExporter.download(ifc, filename);
      session?.saveExport?.('ifc_site3d', filename);

      this._setProgress(100, 'Termine');
      window.TerlabToast?.show(
        `IFC site exporte (${scene.buildings.length} voisins)`,
        'success'
      );
    } catch (e) {
      if (e.name === 'AbortError') {
        window.TerlabToast?.show('Export IFC site annule', 'info');
      } else {
        window.TerlabToast?.show(`Erreur IFC site : ${e.message}`, 'error');
      }
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
