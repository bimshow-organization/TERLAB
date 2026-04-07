// TERLAB · source-modal.js · Modal sources et références · v1.0
// ════════════════════════════════════════════════════════════════════════════

const SourceModal = {
  _currentPhase: 0,
  _currentSlug:  'identification',
  _refs:         null,

  setPhase(id, slug) {
    this._currentPhase = id;
    this._currentSlug  = slug;
  },

  async open(phaseId) {
    phaseId = phaseId ?? this._currentPhase;

    if (!this._refs) {
      try {
        this._refs = await fetch('data/references-biblio.json').then(r => r.json());
      } catch {
        window.TerlabToast?.show('Références non disponibles', 'warning');
        return;
      }
    }

    const modal = document.getElementById('modal-sources');
    if (!modal) return;

    // Titre
    const title = document.getElementById('modal-sources-title');
    const meta  = window.TERLAB_META?.phases?.[phaseId];
    if (title) title.textContent = `Sources — Phase ${phaseId} · ${meta?.title ?? ''}`;

    // Corps
    const body = document.getElementById('modal-sources-body');
    if (!body) return;

    const phaseKey = `p${String(phaseId).padStart(2,'0')}`;
    const list     = this._refs.par_phase?.[phaseKey] ?? [];
    const global   = this._refs.par_phase?.global ?? [];
    const allRefs  = [...list, ...global];

    if (!allRefs.length) {
      body.innerHTML = '<p style="color:var(--muted);font-style:italic;font-size:12px">Aucune référence spécifique pour cette phase.</p>';
    } else {
      body.innerHTML = `
        ${list.length ? `
        <div class="source-section">
          <div class="source-section-head">Références spécifiques — Phase ${phaseId}</div>
          ${list.map(r => this._buildRefItem(r)).join('')}
        </div>` : ''}
        ${global.length ? `
        <div class="source-section" style="margin-top:14px">
          <div class="source-section-head">Références transversales (toutes phases)</div>
          ${global.map(r => this._buildRefItem(r)).join('')}
        </div>` : ''}
      `;
    }

    // Status APIs
    body.innerHTML += `
      <div class="source-section" style="margin-top:14px">
        <div class="source-section-head">APIs actives dans cette phase</div>
        ${this._buildApiStatus(meta)}
      </div>`;

    modal.hidden = false;
  },

  _buildRefItem(r) {
    const typeColors = {
      'réglementaire':       '#f25757',
      'données':             '#9a7820',
      'guide':               '#f59e0b',
      'retour-experience':   '#3cb860',
      'api':                 '#a78bfa',
      'ouvrage':             '#c8922a',
      'portail':             '#00bcd4',
      'publication-academique': '#88a8d0',
      'outil':               '#f0b800'
    };
    const color = typeColors[r.type] ?? '#6b5c3e';

    return `
      <div class="ref-item">
        <div class="ref-type-badge" style="color:${color};border-color:${color}40;background:${color}10">${r.type}</div>
        <div class="ref-body">
          <div class="ref-title">${r.titre}</div>
          <div class="ref-meta">${r.auteur ?? ''}${r.annee ? ` · ${r.annee}` : ''}</div>
          ${r.note ? `<div class="ref-note">${r.note}</div>` : ''}
          ${r.url ? `<a href="${r.url}" target="_blank" rel="noopener" class="ref-link">Ouvrir ↗</a>` : ''}
          ${r.doi ? `<span class="ref-doi">DOI: ${r.doi}</span>` : ''}
        </div>
      </div>`;
  },

  _buildApiStatus(meta) {
    if (!meta?.apis_requises?.length) return '<p style="font-size:11px;color:var(--muted)">Aucune API active.</p>';

    return [...(meta.apis_requises ?? []), ...(meta.apis_optionnelles ?? []).map(a => `${a} (optionnel)`)].map(api => {
      const isStub = api.includes('stub');
      return `
        <div class="api-status-row">
          <span class="api-status-dot" style="background:${isStub ? 'var(--warning)' : 'var(--success)'}"></span>
          <span class="api-status-label">${api}</span>
          ${isStub ? '<span class="api-status-note">⚠️ STUB</span>' : '<span class="api-status-note" style="color:var(--success)">✓ Actif</span>'}
        </div>`;
    }).join('');
  },

  close() {
    const modal = document.getElementById('modal-sources');
    if (modal) modal.hidden = true;
  }
};

export default SourceModal;

// ════════════════════════════════════════════════════════════════════════════
