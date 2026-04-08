/* ═══════════════════════════════════════════════════════════════
 * TERLAB · mobile-controller.js
 * Logique UI mobile : bottom sheet, tab bar, phase navigation
 * Pattern: HOUSEG-SPEECH mobile (single breakpoint 800px)
 * ═══════════════════════════════════════════════════════════════ */

const MobileController = {

  _isOpen:      false,
  _activeTab:   'form',
  _isMobile:    false,
  _touchStartY: 0,

  // ── Détection mobile ─────────────────────────────────────────
  get isMobile() {
    return window.innerWidth <= 800;
  },

  // ── Init ─────────────────────────────────────────────────────
  init() {
    this._isMobile = this.isMobile;
    if (!this._isMobile) return; // rien à faire sur desktop

    this._bindSheetToggle();
    this._bindPhaseNav();
    this._bindSheetTabs();
    this._bindDragHandle();
    this._bindBackdropClose();
    this._bindResizeObserver();

    // Init indicateur phase
    this.updatePhaseIndicator();
  },

  // ── Ouvrir / fermer le sheet ──────────────────────────────────
  openSheet() {
    const sheet = document.getElementById('mob-sheet');
    const btn   = document.getElementById('mob-sheet-btn');
    if (!sheet) return;

    this._isOpen = true;
    sheet.classList.add('sheet-open');
    sheet.setAttribute('aria-hidden', 'false');
    btn?.classList.add('sheet-open');
    btn?.setAttribute('aria-expanded', 'true');

    // Déplacer le contenu du left-panel dans le sheet
    this._syncSheetContent();
  },

  closeSheet() {
    const sheet = document.getElementById('mob-sheet');
    const btn   = document.getElementById('mob-sheet-btn');
    if (!sheet) return;

    this._isOpen = false;
    sheet.classList.remove('sheet-open');
    sheet.setAttribute('aria-hidden', 'true');
    btn?.classList.remove('sheet-open');
    btn?.setAttribute('aria-expanded', 'false');
  },

  toggleSheet() {
    this._isOpen ? this.closeSheet() : this.openSheet();
  },

  // ── Synchroniser le contenu du left-panel → sheet ────────────
  _syncSheetContent() {
    const formContent  = document.getElementById('mob-sheet-form-content');
    const leftPanel    = document.querySelector('.left-panel');
    if (!formContent || !leftPanel) return;

    // Cloner le contenu (ne pas déplacer — le left-panel reste dans le DOM desktop)
    formContent.innerHTML = '';
    const clone = leftPanel.cloneNode(true);
    // Enlever les éléments non utiles dans le sheet
    clone.querySelectorAll('.lp-head .phase-label').forEach(el => el.remove());
    // Ajouter tout le contenu
    Array.from(clone.children).forEach(child => formContent.appendChild(child.cloneNode(true)));

    // Re-bind les événements de validation sur les clones
    this._rebindClonedEvents(formContent);

    // Synchroniser le bouton next
    const nextBtn   = leftPanel.querySelector('.next-btn');
    const mobNextBtn = document.getElementById('mob-next-phase-btn');
    if (nextBtn && mobNextBtn) {
      mobNextBtn.textContent = nextBtn.textContent;
      mobNextBtn.disabled    = !nextBtn.classList.contains('enabled');
      mobNextBtn.onclick     = () => { nextBtn.click(); this.closeSheet(); };
    }
  },

  // Re-bind click events on cloned check-items (since cloneNode doesn't copy event listeners)
  _rebindClonedEvents(container) {
    container.querySelectorAll('.check-item').forEach(clone => {
      const idx = clone.dataset.idx;
      if (idx == null) return;
      clone.addEventListener('click', () => {
        // Find the original check-item and click it
        const originals = document.querySelectorAll('.left-panel .check-item');
        const original = originals[parseInt(idx)];
        if (original) original.click();
        // Re-sync after a tick
        setTimeout(() => this._syncSheetContent(), 100);
      });
    });

    // Re-bind field inputs to sync back to original
    container.querySelectorAll('.field-input, .field-select, .field-textarea').forEach(clone => {
      const name = clone.name || clone.id;
      if (!name) return;
      clone.addEventListener('change', () => {
        const original = document.querySelector(`.left-panel [name="${name}"], .left-panel #${name}`);
        if (original) {
          original.value = clone.value;
          original.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });
  },

  // ── Tabs du sheet ─────────────────────────────────────────────
  _bindSheetTabs() {
    const tabs = document.getElementById('mob-sheet-tabs');
    if (!tabs) return;

    tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.mob-sheet-tab');
      if (!tab) return;

      const target = tab.dataset.tab;
      this._activeTab = target;

      // Activer l'onglet
      tabs.querySelectorAll('.mob-sheet-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === target));

      // Afficher le contenu
      ['form', 'risks', 'actors'].forEach(name => {
        const el = document.getElementById(`mob-sheet-${name}-content`);
        if (el) el.style.display = name === target ? 'block' : 'none';
      });

      // Peupler risks et actors si besoin
      if (target === 'risks')  this._populateRisks();
      if (target === 'actors') this._populateActors();
    });
  },

  // Copier le contenu risques depuis le right-panel
  _populateRisks() {
    const rightPanel = document.querySelector('.right-panel');
    const dest = document.getElementById('mob-sheet-risks-content');
    if (!rightPanel || !dest) return;

    // Find risk cards in right panel
    const riskSection = rightPanel.querySelector('.rp-section');
    if (riskSection) {
      dest.innerHTML = riskSection.innerHTML;
    } else {
      dest.innerHTML = '<p style="font-size:11px;color:var(--faint);padding:16px;text-align:center">Aucun risque identifié pour cette phase</p>';
    }
  },

  _populateActors() {
    const rightPanel = document.querySelector('.right-panel');
    const dest = document.getElementById('mob-sheet-actors-content');
    if (!rightPanel || !dest) return;

    // Find actor cards in right panel
    const sections = rightPanel.querySelectorAll('.rp-section');
    let actorHtml = '';
    sections.forEach(s => {
      if (s.querySelector('.actor-card')) {
        actorHtml += s.innerHTML;
      }
    });
    dest.innerHTML = actorHtml || '<p style="font-size:11px;color:var(--faint);padding:16px;text-align:center">Aucun acteur pour cette phase</p>';
  },

  // ── Bind toggle bouton ────────────────────────────────────────
  _bindSheetToggle() {
    document.getElementById('mob-sheet-btn')
      ?.addEventListener('click', () => this.toggleSheet());
  },

  // ── Navigation phases prev/next ───────────────────────────────
  _bindPhaseNav() {
    document.getElementById('mob-prev-btn')
      ?.addEventListener('click', () => this._navigatePhase(-1));
    document.getElementById('mob-next-btn')
      ?.addEventListener('click', () => this._navigatePhase(+1));
  },

  _navigatePhase(delta) {
    // Utiliser le router existant de TERLAB
    const current = window.TERLAB?.currentPhaseId ?? window.TerlabRouter?.currentPhase ?? 0;
    const target  = Math.max(0, Math.min(12, current + delta));
    if (target === current) return;

    this.closeSheet();

    // Déléguer au router existant
    if (window.TerlabRouter?.goto) {
      window.TerlabRouter.goto(target);
    }
  },

  // ── Mettre à jour l'indicateur de phase ──────────────────────
  updatePhaseIndicator(phaseId, phaseName) {
    const id   = phaseId   ?? window.TerlabRouter?.currentPhase ?? 0;
    const name = phaseName ?? '';

    const indicator = document.getElementById('mob-phase-indicator');
    const nameEl    = document.getElementById('mob-phase-name');
    if (indicator) indicator.textContent = `P${String(id).padStart(2, '0')}`;
    if (nameEl)    nameEl.textContent = name;

    // Activer/désactiver les boutons prev/next
    const prevBtn = document.getElementById('mob-prev-btn');
    const nextBtn = document.getElementById('mob-next-btn');
    if (prevBtn) prevBtn.disabled = (id <= 0);
    if (nextBtn) nextBtn.disabled = (id >= 12);
  },

  // ── Drag-to-close sur le handle ──────────────────────────────
  _bindDragHandle() {
    const handle = document.getElementById('mob-sheet-handle');
    const sheet  = document.getElementById('mob-sheet');
    if (!handle || !sheet) return;

    handle.addEventListener('touchstart', (e) => {
      this._touchStartY = e.touches[0].clientY;
    }, { passive: true });

    handle.addEventListener('touchmove', (e) => {
      const dy = e.touches[0].clientY - this._touchStartY;
      if (dy > 0) {
        sheet.style.transform = `translateY(${dy}px)`;
        sheet.style.transition = 'none';
      }
    }, { passive: true });

    handle.addEventListener('touchend', (e) => {
      const dy = e.changedTouches[0].clientY - this._touchStartY;
      sheet.style.transition = '';
      sheet.style.transform  = '';
      if (dy > 80) this.closeSheet();
    }, { passive: true });
  },

  // ── Fermer en cliquant la carte (backdrop) ────────────────────
  _bindBackdropClose() {
    document.getElementById('map')
      ?.addEventListener('click', () => {
        if (this._isOpen) this.closeSheet();
      });
  },

  // ── Resize observer (passage desktop↔mobile) ─────────────────
  _bindResizeObserver() {
    const mql = window.matchMedia('(max-width: 800px)');
    mql.addEventListener('change', (e) => {
      const wasMobile = this._isMobile;
      this._isMobile  = e.matches;
      if (wasMobile && !this._isMobile) {
        this.closeSheet();
      }
      if (!wasMobile && this._isMobile) {
        this.updatePhaseIndicator();
      }
    });
  },

  // ── Appelé par index.js après injection d'une nouvelle phase ─
  onPhaseInjected(phaseId, phaseName) {
    if (!this.isMobile) return;
    this.updatePhaseIndicator(phaseId, phaseName);
    // Vider le cache du sheet
    const formContent = document.getElementById('mob-sheet-form-content');
    if (formContent) formContent.innerHTML = '';
    ['risks','actors'].forEach(t => {
      const el = document.getElementById(`mob-sheet-${t}-content`);
      if (el) el.innerHTML = '';
    });
    // Fermer le sheet si ouvert
    this.closeSheet();
  },

  destroy() {
    // Cleanup si nécessaire
  }
};

export default MobileController;
