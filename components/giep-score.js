// TERLAB · giep-score.js · Widget Score GIEP transversal
// Affiché en Phase 8, 9 et 12
// ENSA La Réunion · MGA Architecture

import GIEPCalculator from '../services/giep-calculator-service.js';
import CBSCalculator from '../services/cbs-calculator-service.js';

const OUVRAGE_LABELS = {
  noue_infiltration:    'Noue paysagère',
  jardin_pluie:         'Jardin de pluie',
  fosse_infiltration:   "Fosse d'infiltration",
  revetement_drainant:  'Revêtement perméable',
  tranchee_drainante:   'Tranchée drainante',
  structure_alveolaire: 'Structure alvéolaire',
  bassin_retention:     'Bassin de rétention',
  toiture_vegetalisee:  'Toiture végétalisée',
};

const OUVRAGE_ICONS = {
  noue_infiltration:    '\u301C',
  jardin_pluie:         '\u{1F33A}',
  fosse_infiltration:   '\u{1F573}',
  revetement_drainant:  '\u2B1B',
  tranchee_drainante:   '\u{1F529}',
  structure_alveolaire: '\u{1F3D7}',
  bassin_retention:     '\u{1F4A7}',
  toiture_vegetalisee:  '\u{1F33F}',
};

const OUVRAGE_COLORS = {
  noue_infiltration:    '#22c55e',
  jardin_pluie:         '#f59e0b',
  fosse_infiltration:   '#8b5cf6',
  revetement_drainant:  '#6b7280',
  tranchee_drainante:   '#0ea5e9',
  structure_alveolaire: '#ec4899',
  bassin_retention:     '#3b82f6',
  toiture_vegetalisee:  '#16a34a',
};

const GIEPScore = {

  // ── Bloc CBS — Coefficient de Biotope par Surface ─────────────────
  buildCBSBlock(sessionData) {
    const cbs = CBSCalculator.computeFromSession(sessionData);
    if (!cbs || !cbs.valid) return '';

    const v = cbs.validation ?? {};
    const b = cbs.benchmark ?? { color: '#6b7280', label: '—' };
    const cbsPct = cbs.cbs_pct.toFixed(1);
    const ptPct  = cbs.pleine_terre_pct.toFixed(1);

    // Header : score CBS + badge réglementaire
    const badge = v.reglementaire
      ? (v.conforme_cbs
          ? `<span style="font-size:8px;background:var(--success2);color:var(--success);padding:2px 6px;border-radius:3px;font-family:var(--font-mono)">CONFORME ${v.exigence?.cbs_min_pct ?? '—'}%</span>`
          : `<span style="font-size:8px;background:rgba(239,68,68,.15);color:#dc2626;padding:2px 6px;border-radius:3px;font-family:var(--font-mono)">NON CONFORME &lt; ${v.exigence?.cbs_min_pct ?? '—'}%</span>`)
      : `<span style="font-size:8px;background:rgba(107,114,128,.15);color:#6b7280;padding:2px 6px;border-radius:3px;font-family:var(--font-mono)">INDICATEUR</span>`;

    // Stack horizontale empilée des surfaces (tronquée à 100%)
    const totalPct = cbs.breakdown.reduce((s, it) => s + it.pct_parcelle, 0);
    const stackHTML = cbs.breakdown
      .filter(it => it.surface_m2 > 0)
      .map(it => {
        const w = totalPct > 0 ? (it.pct_parcelle / totalPct) * 100 : 0;
        return `<div title="${it.label} : ${it.surface_m2.toFixed(0)}m² (×${it.coeff})"
                     style="background:${it.color};width:${w.toFixed(1)}%;height:100%"></div>`;
      }).join('');

    // Tableau breakdown
    const rowsHTML = cbs.breakdown
      .filter(it => it.surface_m2 > 0)
      .map(it => `
        <div class="gsw-row">
          <span><span style="display:inline-block;width:8px;height:8px;background:${it.color};border-radius:1px;margin-right:4px;vertical-align:middle"></span>${it.label} <span style="color:var(--muted);font-size:9px">×${it.coeff}</span></span>
          <strong>${it.surface_m2.toFixed(0)} m² <span style="color:var(--muted);font-weight:400;font-size:9px">→ ${it.surface_eco_m2.toFixed(0)} m²éco</span></strong>
        </div>`).join('');

    // Note réglementaire
    const noteHTML = v.reglementaire
      ? `<div class="gsw-note">Exigence ${v.exigence.source} : CBS ≥ ${v.exigence.cbs_min_pct}%${v.exigence.pleine_terre_min_pct ? ` · pleine terre ≥ ${v.exigence.pleine_terre_min_pct}%` : ''}</div>`
      : `<div class="gsw-note">CBS non réglementé pour cette zone — indicateur écologique pédagogique (méthode Saint-Pierre Ua5 / biotope Berlin)</div>`;

    return `
      <div class="gsw-cbs-block" style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
        <div class="gsw-header" style="margin-bottom:6px">
          <div class="gsw-title">CBS — Coefficient de Biotope par Surface ${badge}</div>
          <div class="gsw-score" style="color:${b.color};font-size:24px;font-family:var(--font-serif)">${cbsPct}<small>%</small></div>
          <div class="gsw-label" style="color:${b.color}">${b.label}</div>
        </div>
        <div style="display:flex;height:10px;border-radius:3px;overflow:hidden;margin:6px 0;background:#1a1a1a">${stackHTML}</div>
        <div class="gsw-grid">
          <div class="gsw-row"><span>Surface parcelle (B)</span><strong>${cbs.surface_parcelle_m2.toFixed(0)} m²</strong></div>
          <div class="gsw-row"><span>Surface éco-aménageable (A)</span><strong>${cbs.surface_eco_m2.toFixed(0)} m²</strong></div>
          <div class="gsw-row"><span>CBS = A / B</span><strong style="color:${b.color}">${cbsPct} %</strong></div>
          <div class="gsw-row"><span>Pleine terre</span><strong>${ptPct} %</strong></div>
          ${rowsHTML}
        </div>
        ${noteHTML}
      </div>`;
  },

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
        <div class="gsw-reco-title">Ouvrages recommandés (${s.ouvrages.length})</div>
        ${s.ouvrages.map(o => `
          <div class="gsw-reco-item" style="border-left:3px solid ${OUVRAGE_COLORS[o.type] ?? '#999'}; padding-left:6px; margin:2px 0">
            <div>
              <span>${OUVRAGE_ICONS[o.type] ?? '\u2192'} ${OUVRAGE_LABELS[o.type] ?? o.type}</span>
              ${o.priority ? '<span style="font-size:8px;background:var(--success);color:white;padding:1px 4px;border-radius:3px;margin-left:4px">prioritaire</span>' : ''}
            </div>
            <span class="gsw-dim">${o.dim}</span>
            ${o.note ? `<div style="font-size:8px;color:var(--muted);margin-top:1px">${o.note}</div>` : ''}
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
        ${this.buildCBSBlock(sessionData)}
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
