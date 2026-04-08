// TERLAB · components/risk-player.js
// Player narratif des risques — présentation immersive phase par phase
// Inspiré des narratives de jeux de sensibilisation (GIEP-style)
// Usage : RiskPlayer.open(phaseId)  puis fenêtre modale autonome

const RiskPlayer = {
  _risks:       [],
  _currentIdx:  0,
  _phaseId:     null,
  _playing:     false,
  _autoTimer:   null,

  // ── NIVEAU → STYLE ────────────────────────────────────────────
  _niveauConfig: {
    danger:  { color: '#ef4444', bg: 'rgba(239,68,68,.12)',  icon: '🔴', label: 'CRITIQUE',  conseq_icon: '⚠️' },
    warning: { color: '#f59e0b', bg: 'rgba(245,158,11,.10)', icon: '⚠',  label: 'ATTENTION', conseq_icon: '⚡' },
    info:    { color: '#E8811A', bg: 'rgba(154,120,32,.10)',  icon: 'ℹ',  label: 'INFO',      conseq_icon: '💡' },
    bigdata: { color: '#a78bfa', bg: 'rgba(167,139,250,.10)',icon: '🔒', label: 'DONNÉES',   conseq_icon: '🔒' }
  },

  // ── OUVRIR ────────────────────────────────────────────────────
  open(phaseId) {
    const allRisques = Array.isArray(window.TERLAB_RISK)
      ? window.TERLAB_RISK
      : window.TERLAB_RISK?.risques ?? [];

    this._risks   = allRisques.filter(r =>
      r.phase === phaseId || r.phase === String(phaseId)
    );
    this._phaseId = phaseId;
    this._currentIdx = 0;

    if (!this._risks.length) {
      window.TerlabToast?.show('Aucun risque documenté pour cette phase', 'info');
      return;
    }

    // Créer ou récupérer la modal
    let modal = document.getElementById('risk-player-modal');
    if (!modal) {
      modal = this._buildModal();
      document.body.appendChild(modal);
    }

    modal.hidden = false;
    this._renderSlide(0);
    this._renderDots();
  },

  // ── CONSTRUIRE LA MODAL ───────────────────────────────────────
  _buildModal() {
    const div = document.createElement('div');
    div.id        = 'risk-player-modal';
    div.className = 'risk-player-modal';
    div.setAttribute('role', 'dialog');
    div.setAttribute('aria-modal', 'true');
    div.setAttribute('aria-label', 'Player des risques');

    div.innerHTML = `
      <div class="rp-box" id="rp-box">
        <div class="rp-header">
          <div class="rp-title">🔍 Analyse des risques — Narration guidée</div>
          <button class="rp-close" onclick="RiskPlayer.close()" aria-label="Fermer">✕</button>
        </div>

        <div class="rp-stage" id="rp-stage">
          <!-- Slides injectées dynamiquement -->
        </div>

        <div class="rp-footer">
          <button class="rp-nav-btn" id="rp-prev" onclick="RiskPlayer.prev()" aria-label="Risque précédent">← Préc.</button>

          <div class="rp-progress-dots" id="rp-dots" role="tablist" aria-label="Navigation risques"></div>

          <button class="rp-nav-btn primary" id="rp-next" onclick="RiskPlayer.next()" aria-label="Risque suivant">Suiv. →</button>
        </div>
      </div>`;

    // Fermer sur clic backdrop
    div.addEventListener('click', e => {
      if (e.target === div) this.close();
    });

    // Clavier : flèches + Escape
    document.addEventListener('keydown', this._keyHandler = (e) => {
      if (document.getElementById('risk-player-modal')?.hidden) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') this.next();
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   this.prev();
      if (e.key === 'Escape')  this.close();
    });

    return div;
  },

  // ── RENDER SLIDE ──────────────────────────────────────────────
  _renderSlide(idx, direction = 'in') {
    const stage = document.getElementById('rp-stage');
    if (!stage) return;
    const risk = this._risks[idx];
    if (!risk) return;

    const cfg    = this._niveauConfig[risk.niveau ?? 'info'];
    const total  = this._risks.length;
    const isLast = idx === total - 1;

    // Animer la sortie de l'ancien slide
    const old = stage.querySelector('.risk-slide');
    if (old) {
      old.classList.add('exit');
      setTimeout(() => old.remove(), 250);
    }

    const slide = document.createElement('div');
    slide.className = 'risk-slide';

    // Localisation sur carte (si terrain disponible)
    const hasMap    = !!window.TerlabMap?.getMap();
    const hasCoords = !!(window.SessionManager?.getTerrain()?.lat);

    slide.innerHTML = `
      <!-- Catégorie + compteur -->
      <div class="rs-category" style="color:${cfg.color}">
        <span class="rs-category-dot" style="background:${cfg.color}"></span>
        ${cfg.icon} ${cfg.label}
        <span style="margin-left:auto;color:var(--faint);font-size:8px">${idx+1} / ${total}</span>
      </div>

      <!-- Titre principal -->
      <div class="rs-titre">${risk.titre ?? 'Risque'}</div>

      <!-- Corps narratif -->
      <div class="rs-corps">${risk.corps ?? ''}</div>

      <!-- Conséquences -->
      ${risk.consequences ? `
        <div class="rs-consequence" style="border-left-color:${cfg.color};background:${cfg.bg}">
          <span class="rs-consequence-icon">${cfg.conseq_icon}</span>
          <div class="rs-consequence-text">
            <strong style="color:var(--text2)">Conséquences</strong><br/>
            ${risk.consequences}
          </div>
        </div>` : ''}

      <!-- Action -->
      ${risk.action ? `<div class="rs-action">${risk.action}</div>` : ''}

      <!-- Mini carte si risque géolocalisable -->
      ${(hasMap && hasCoords && ['inondation','seisme','glissement','feu','cyclone'].some(k => (risk.titre+risk.corps+'').toLowerCase().includes(k))) ? `
        <div class="rs-map-mini" id="rp-map-mini-${idx}">
          <div class="rs-map-mini-placeholder">
            <div style="font-size:20px">🗺</div>
            <div>Localisation : ${window.SessionManager?.getTerrain()?.commune ?? '—'}</div>
          </div>
        </div>` : ''}

      <!-- Source -->
      ${risk.source ? `<div class="rs-source">Source : ${risk.source}</div>` : ''}
    `;

    stage.appendChild(slide);

    // Mettre à jour le bouton suivant
    const nextBtn = document.getElementById('rp-next');
    if (nextBtn) {
      nextBtn.textContent = isLast ? 'Fermer ✓' : 'Suiv. →';
      nextBtn.className   = isLast ? 'rp-nav-btn primary' : 'rp-nav-btn primary';
    }

    // Mettre à jour les dots
    this._updateDots(idx);

    // Mettre à jour le contour sur la carte principale si possible
    this._highlightRiskOnMap(risk);
  },

  // ── HIGHLIGHT SUR CARTE PRINCIPALE ───────────────────────────
  _highlightRiskOnMap(risk) {
    const map     = window.TerlabMap?.getMap();
    const terrain = window.SessionManager?.getTerrain();
    if (!map || !terrain?.lat) return;

    const niv = risk.niveau ?? 'info';
    const colors = { danger:'#ef4444', warning:'#f59e0b', info:'#E8811A', bigdata:'#a78bfa' };

    // Flash du marker terrain
    try {
      const src = map.getSource('parcelle-selected');
      if (src) {
        // Faire pulser la bordure de la parcelle
        map.setPaintProperty('parcelle-outline', 'line-color', colors[niv] ?? '#E8811A');
        map.setPaintProperty('parcelle-outline', 'line-width', 4);
        setTimeout(() => {
          map.setPaintProperty('parcelle-outline', 'line-color', '#E8811A');
          map.setPaintProperty('parcelle-outline', 'line-width', 2);
        }, 1200);
      }
    } catch {}
  },

  // ── DOTS ──────────────────────────────────────────────────────
  _renderDots() {
    const container = document.getElementById('rp-dots');
    if (!container) return;
    container.innerHTML = this._risks.map((r, i) => {
      const cfg = this._niveauConfig[r.niveau ?? 'info'];
      return `<div class="rpd" data-idx="${i}"
                   role="tab" aria-selected="${i === 0}"
                   aria-label="Risque ${i+1} : ${r.titre}"
                   onclick="RiskPlayer.goTo(${i})"
                   style="${i === 0 ? `background:${cfg.color}` : ''}"></div>`;
    }).join('');
  },

  _updateDots(activeIdx) {
    document.querySelectorAll('.rpd').forEach((dot, i) => {
      dot.classList.remove('active', 'done');
      dot.setAttribute('aria-selected', i === activeIdx ? 'true' : 'false');
      const cfg = this._niveauConfig[this._risks[i]?.niveau ?? 'info'];

      if (i === activeIdx) {
        dot.classList.add('active');
        dot.style.background = cfg.color;
      } else if (i < activeIdx) {
        dot.classList.add('done');
        dot.style.background = '';
      } else {
        dot.style.background = '';
      }
    });
  },

  // ── NAVIGATION ────────────────────────────────────────────────
  next() {
    if (this._currentIdx >= this._risks.length - 1) { this.close(); return; }
    this._currentIdx++;
    this._renderSlide(this._currentIdx);
  },

  prev() {
    if (this._currentIdx <= 0) return;
    this._currentIdx--;
    this._renderSlide(this._currentIdx);
  },

  goTo(idx) {
    if (idx < 0 || idx >= this._risks.length) return;
    this._currentIdx = idx;
    this._renderSlide(idx);
  },

  // ── FERMER ────────────────────────────────────────────────────
  close() {
    const modal = document.getElementById('risk-player-modal');
    if (modal) modal.hidden = true;
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
    clearInterval(this._autoTimer);

    // Restaurer la carte
    const map = window.TerlabMap?.getMap();
    try {
      map?.setPaintProperty('parcelle-outline', 'line-color', '#E8811A');
      map?.setPaintProperty('parcelle-outline', 'line-width', 2);
    } catch {}
  },

  // ── BUILDER BOUTON D'OUVERTURE ────────────────────────────────
  // À appeler depuis les phases pour injecter le bouton
  buildOpenBtn(phaseId, risksCount) {
    if (!risksCount) return '';
    return `
      <button class="risk-player-btn"
              onclick="RiskPlayer.open(${phaseId})"
              aria-label="Ouvrir le player de risques — ${risksCount} risques documentés">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.3"/>
          <path d="M5.5 4.5L10 7 5.5 9.5V4.5z" fill="currentColor"/>
        </svg>
        ${risksCount} risque${risksCount > 1 ? 's' : ''} documenté${risksCount > 1 ? 's' : ''} — Voir la narration
      </button>`;
  }
};

export default RiskPlayer;
