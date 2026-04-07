// TERLAB · giep-score.js · Widget Score GIEP transversal
// Affiché en Phase 8, 9 et 12
// ENSA La Réunion · MGA Architecture

import GIEPCalculator from '../services/giep-calculator-service.js';

const OUVRAGE_LABELS = {
  bassin_retention:    'Bassin de rétention',
  noue_infiltration:   "Noue d'infiltration",
  toiture_vegetalisee: 'Toiture végétalisée',
  revetement_drainant: 'Revêtement drainant',
};

const OUVRAGE_ICONS = {
  bassin_retention:    '\u{1F3D7}',
  noue_infiltration:   '\u301C',
  toiture_vegetalisee: '\u{1F33F}',
  revetement_drainant: '\u2B1B',
};

const GIEPScore = {

  // ── Calcul et rendu HTML du widget ────────────────────────────────
  buildWidget(sessionData) {
    const s = GIEPCalculator.computeFromSession(sessionData);
    if (!s) {
      return `<div class="stub-warning">Compléter Phase 0 (parcelle) et Phase 7 (gabarit) pour calculer le score GIEP</div>`;
    }

    const infiltHTML = s.infiltration ? `
      <div class="gsw-row"><span>Volume net à infiltrer</span><strong>${s.infiltration.V_net.toFixed(1)} m³</strong></div>
      <div class="gsw-row"><span>Surface infiltration</span><strong>${s.infiltration.A_inf.toFixed(0)} m²</strong></div>
      <div class="gsw-row"><span>Surface EV disponible</span><strong>${s.infiltration.A_dispo.toFixed(0)} m²</strong></div>
      ${s.infiltration.deficit > 0
        ? `<div class="gsw-row"><span>Déficit</span><strong style="color:var(--danger)">${s.infiltration.deficit.toFixed(0)} m²</strong></div>`
        : `<div class="gsw-row"><span>Marge</span><strong style="color:var(--success)">${Math.abs(s.infiltration.deficit).toFixed(0)} m²</strong></div>`
      }` : '';

    const ouvragesHTML = s.ouvrages?.length ? `
      <div class="gsw-reco">
        <div class="gsw-reco-title">Ouvrages recommandés</div>
        ${s.ouvrages.map(o => `
          <div class="gsw-reco-item">
            <span>${OUVRAGE_ICONS[o.type] ?? '\u2192'} ${OUVRAGE_LABELS[o.type] ?? o.type}</span>
            <span class="gsw-dim">${o.dim}</span>
          </div>`).join('')}
      </div>` : '';

    return `
      <div class="giep-score-widget" role="region" aria-label="Score GIEP">
        <div class="gsw-header">
          <div class="gsw-title">Score GIEP — Gestion Eaux Pluviales</div>
          <div class="gsw-score" style="color:${s.scoreColor};font-size:28px;font-family:var(--font-serif)">${s.score}<small>/100</small></div>
          <div class="gsw-label" style="color:${s.scoreColor}">${s.scoreLabel}</div>
        </div>
        <div class="gsw-grid">
          <div class="gsw-row"><span>Zone climatique</span><strong>${s.zone_nom}</strong></div>
          <div class="gsw-row"><span>Intensité T10</span><strong>${s.intensite_T10} mm/h</strong></div>
          <div class="gsw-row"><span>Temps de concentration</span><strong>${s.tc} min</strong></div>
          <div class="gsw-row"><span>TC détail</span><strong style="font-size:9px">K:${s.tc_kirpich} C:${s.tc_caquot} S:${s.tc_sogreah} (${s.tc_morphologie})</strong></div>
          <div class="gsw-row"><span>Coeff. initial</span><strong>${s.coeffInit}</strong></div>
          <div class="gsw-row"><span>Coeff. projet</span><strong>${s.coeffFinal}</strong></div>
          <div class="gsw-row"><span>Débit initial</span><strong>${s.debitInit} L/s</strong></div>
          <div class="gsw-row"><span>Débit projet</span><strong style="color:${s.scoreColor}">${s.debitFinal} L/s</strong></div>
          <div class="gsw-row"><span>Réduction</span><strong style="color:${s.scoreColor}">\u2212${s.reduction_pct}%</strong></div>
          ${infiltHTML}
        </div>
        ${ouvragesHTML}
        <div class="gsw-note">${s.source_note}</div>
        <a href="https://www.reunion.developpement-durable.gouv.fr" target="_blank"
           rel="noopener" class="gsw-source-link">\u2192 DEAL Réunion</a>
      </div>`;
  },

  // ── Injecter le widget dans un conteneur DOM ──────────────────────
  render(containerId, sessionData) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = this.buildWidget(sessionData);
  },
};

export default GIEPScore;
