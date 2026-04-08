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

    // Providers data cartographiques
    const providersHtml = this._buildProviders(phaseId);
    if (providersHtml) {
      body.innerHTML += providersHtml;
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

    // APIs connues avec token stub détectable
    const stubTokens = {
      'Météo-France': () => window.MeteoService?.API_KEY === 'METEO_FRANCE_API_KEY',
      'Firebase':     () => !window.TERLAB_DB,
    };

    return [...(meta.apis_requises ?? []), ...(meta.apis_optionnelles ?? []).map(a => `${a} (optionnel)`)].map(api => {
      const checkFn = Object.entries(stubTokens).find(([k]) => api.includes(k))?.[1];
      const isStub  = api.includes('stub') || (checkFn?.() ?? false);
      const label   = isStub ? 'Non configuré' : '✓ Actif';
      const color   = isStub ? 'var(--warning)' : 'var(--success)';
      return `
        <div class="api-status-row">
          <span class="api-status-dot" style="background:${color}"></span>
          <span class="api-status-label">${api}</span>
          <span class="api-status-note" style="color:${color}">${label}</span>
        </div>`;
    }).join('');
  },

  _buildProviders(phaseId) {
    const phaseKey = `P${String(phaseId).padStart(2, '0')}`;
    const providers = (window.TERLAB_PROVIDERS || [])
      .filter(p => p.phases_terlab.includes(phaseKey));

    if (!providers.length) return '';

    const statusLabels = {
      'actif':            'Actif',
      'nouveau':          'Nouveau',
      'nouveau_statique': 'Statique',
      'stub_actif':       'Token requis',
      'stub_cors':        'Proxy requis',
    };

    const statusColors = {
      'actif':            'var(--success, #3cb860)',
      'nouveau':          'var(--info, #00bcd4)',
      'nouveau_statique': 'var(--muted, #888)',
      'stub_actif':       'var(--warning, #f59e0b)',
      'stub_cors':        'var(--warning, #f59e0b)',
    };

    return `
      <div class="source-section" style="margin-top:14px">
        <div class="source-section-head">Sources de données cartographiques</div>
        ${providers.map(p => {
          const label = statusLabels[p.integration_status] || p.integration_status;
          const color = statusColors[p.integration_status] || 'var(--muted)';
          return `
          <div class="ref-item" style="gap:8px">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span style="font-weight:600;font-size:12px">${p.nom}</span>
                <span style="font-size:10px;padding:1px 6px;border-radius:3px;border:1px solid ${color}40;color:${color};background:${color}10">${label}</span>
              </div>
              <div style="font-size:11px;margin-top:3px">
                <a href="${p.url}" target="_blank" rel="noopener" class="ref-link" style="font-size:11px">${p.url}</a>
              </div>
              <div style="font-size:11px;color:var(--muted);margin-top:3px">${p.note_pedagogique}</div>
              <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">
                ${p.format.map(f => `<span style="font-size:9px;padding:1px 4px;border-radius:2px;background:var(--surface, #f5f0e8);color:var(--fg, #3e3527)">${f}</span>`).join('')}
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>`;
  },

  close() {
    const modal = document.getElementById('modal-sources');
    if (modal) modal.hidden = true;
  }
};

export default SourceModal;

// ════════════════════════════════════════════════════════════════════════════
