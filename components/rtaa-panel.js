// terlab/components/rtaa-panel.js
// Panneau droit Phase 11 — Rapport RTAA interactif
// Affiche le rapport RTAA (Art.5+6 solaire + Art.9+10 ventilation)
// Vanilla JS ES2022+ — innerHTML (pattern TERLAB existant)

const RTAAPanel = {

  _container: null,
  _report: null,

  /**
   * Rendu complet du rapport RTAA dans un conteneur
   * @param {Object} report - rapport RTAAAnalyzer
   * @param {HTMLElement} container
   */
  render(report, container) {
    this._container = container;
    this._report = report;

    if (!container) return;

    if (!report || !report.ok) {
      container.innerHTML = this._renderEmpty(report?.note);
      return;
    }

    const { synthese, baies, ventilation, toiture, zone } = report;
    const score = synthese.score_rtaa;

    container.innerHTML = `
      ${this._renderScoreHeader(score, zone)}
      ${this._renderToiture(toiture)}
      ${this._renderBaies(baies)}
      ${this._renderVentilation(ventilation)}
      ${this._renderActions(synthese.actions)}
    `;
  },

  // ── Score Header ──────────────────────────────────────────────────────────

  _renderScoreHeader(score, zone) {
    const color = score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
    const zoneLabel = zone === 'reunion_zone1' ? 'Zone 1 (≤400m)'
                    : zone === 'reunion_zone2' ? 'Zone 2 (400-600m)'
                    : 'Zone 3 (>600m)';
    return `
      <div class="rtaa-score-header" style="background:${color}15;border-left:3px solid ${color}">
        <div style="display:flex;align-items:baseline;gap:8px">
          <span style="font-size:28px;font-weight:800;color:${color};font-family:var(--font-mono)">${score}</span>
          <span style="font-size:11px;color:var(--muted)">/100</span>
        </div>
        <div style="font-size:9px;color:var(--muted);margin-top:2px">Score RTAA · ${zoneLabel}</div>
      </div>
    `;
  },

  // ── Toiture Art.5 ─────────────────────────────────────────────────────────

  _renderToiture(toiture) {
    if (!toiture) return '';
    const icon = toiture.conforme === true ? '✓' : toiture.conforme === false ? '✗' : '—';
    const cls = toiture.conforme === true ? 'rtaa-ok' : toiture.conforme === false ? 'rtaa-fail' : 'rtaa-info';
    return `
      <div class="rtaa-section">
        <div class="rtaa-section-title">Art.3 · Isolation toiture</div>
        <div class="rtaa-row ${cls}">
          <span class="rtaa-icon">${icon}</span>
          <span class="rtaa-text">${toiture.note_pedagogique}</span>
        </div>
      </div>
    `;
  },

  // ── Baies Art.5+6 ─────────────────────────────────────────────────────────

  _renderBaies(baies) {
    if (!baies || baies.length === 0) return '';

    const rows = baies.map(b => {
      if (b.exemption) {
        return `<div class="rtaa-baie-row rtaa-info"><span class="rtaa-icon">—</span><span>${b.room} ${b.orientation} : ${b.note}</span></div>`;
      }
      const ok = b.conforme;
      const cls = ok ? 'rtaa-ok' : 'rtaa-fail';
      const icon = ok ? '✓' : '✗';
      const detail = `So=${b.So} × Cm=${b.Cm} = S=${b.S} ${ok ? '≤' : '>'} ${b.Smax}`;
      const suggHtml = !ok && b.suggestion?.length > 0
        ? `<div class="rtaa-suggestions">${b.suggestion.map(s =>
            `<div class="rtaa-suggest-item" data-baie-id="${b.id}" onclick="RTAAPanel.applySuggestion('${b.id}','${s.type ?? ''}')">→ ${s.label ?? s}</div>`
          ).join('')}</div>`
        : '';

      return `
        <div class="rtaa-baie-row ${cls}" data-baie-id="${b.id}" onclick="RTAAPanel.highlightBaie('${b.id}')">
          <span class="rtaa-icon">${icon}</span>
          <div>
            <div class="rtaa-baie-label">${b.room} · ${b.orientation}</div>
            <div class="rtaa-baie-detail">${detail}</div>
            ${suggHtml}
          </div>
        </div>
      `;
    }).join('');

    const conformes = baies.filter(b => b.conforme === true).length;
    return `
      <div class="rtaa-section">
        <div class="rtaa-section-title">Art.5+6 · Baies <span class="rtaa-count">${conformes}/${baies.length}</span></div>
        ${rows}
      </div>
    `;
  },

  // ── Ventilation Art.9+10 ──────────────────────────────────────────────────

  _renderVentilation(ventilation) {
    if (!ventilation) return '';

    const traversIcon = ventilation.traversante_possible ? '✓' : '✗';
    const traversCls = ventilation.traversante_possible ? 'rtaa-ok' : 'rtaa-fail';
    const equipIcon = ventilation.conforme ? '✓' : '✗';
    const equipCls = ventilation.conforme ? 'rtaa-ok' : 'rtaa-fail';

    const alertes = (ventilation.alertes ?? []).map(a =>
      `<div class="rtaa-row rtaa-fail"><span class="rtaa-icon">✗</span><span class="rtaa-text">${a}</span></div>`
    ).join('');

    return `
      <div class="rtaa-section">
        <div class="rtaa-section-title">Art.9+10 · Ventilation</div>
        <div class="rtaa-row ${traversCls}">
          <span class="rtaa-icon">${traversIcon}</span>
          <span class="rtaa-text">Ventilation traversante</span>
        </div>
        <div class="rtaa-row ${equipCls}">
          <span class="rtaa-icon">${equipIcon}</span>
          <span class="rtaa-text">Équilibre façades ≤70%</span>
        </div>
        ${alertes}
        <div class="rtaa-row rtaa-info">
          <span class="rtaa-icon">◎</span>
          <span class="rtaa-text">Façades : ${ventilation.facades_avec_baies.join(', ') || '—'}</span>
        </div>
      </div>
    `;
  },

  // ── Actions prioritaires ──────────────────────────────────────────────────

  _renderActions(actions) {
    if (!actions || actions.length === 0) {
      return `<div class="rtaa-section"><div class="rtaa-section-title">Actions</div><div class="rtaa-row rtaa-ok"><span class="rtaa-icon">✓</span><span>Aucune action requise</span></div></div>`;
    }

    const rows = actions.slice(0, 5).map(a => `
      <div class="rtaa-action-row">
        <span class="rtaa-action-num">${a.priorite}</span>
        <span class="rtaa-action-text">${a.action}</span>
      </div>
    `).join('');

    return `
      <div class="rtaa-section">
        <div class="rtaa-section-title">Actions prioritaires</div>
        ${rows}
      </div>
    `;
  },

  // ── État vide ─────────────────────────────────────────────────────────────

  _renderEmpty(note) {
    return `
      <div style="padding:20px;text-align:center;color:var(--muted)">
        <div style="font-size:32px;margin-bottom:8px;opacity:0.3">◎</div>
        <div style="font-size:10px">${note ?? 'Sélectionnez une proposition pour lancer l\'analyse RTAA'}</div>
      </div>
    `;
  },

  // ── Interactions ──────────────────────────────────────────────────────────

  highlightBaie(baieId) {
    window.dispatchEvent(new CustomEvent('terlab:rtaa-highlight', { detail: { baieId } }));
  },

  applySuggestion(baieId, type) {
    window.dispatchEvent(new CustomEvent('terlab:rtaa-apply-suggestion', {
      detail: { baieId, type },
    }));
  },

  /**
   * Mise à jour rapide après reanalyse (debounced)
   */
  onReportUpdated(report) {
    if (this._container) this.render(report, this._container);
  },
};

window.RTAAPanel = RTAAPanel;
export default RTAAPanel;
