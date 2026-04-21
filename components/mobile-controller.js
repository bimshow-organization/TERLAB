/* ═══════════════════════════════════════════════════════════════
 * TERLAB · mobile-controller.js
 * Logique UI mobile : bottom sheet, tab bar, phase navigation
 * Pattern: HOUSEG-SPEECH mobile (single breakpoint 800px)
 * v2 : reparenting via MobileStepper (plus de clone)
 * ═══════════════════════════════════════════════════════════════ */

const MobileController = {

  _isOpen:      false,
  _activeTab:   'form',
  _isMobile:    false,
  _touchStartY: 0,

  // ── Detection mobile ─────────────────────────────────────────
  get isMobile() {
    return window.innerWidth <= 800;
  },

  // ── Init ─────────────────────────────────────────────────────
  init() {
    this._isMobile = this.isMobile;
    // Sources button : bind inconditionnel (le CSS le cache sur desktop,
    // mais l'utilisateur peut resize vers mobile sans rechargement)
    this._bindSourcesButton();

    if (!this._isMobile) return; // rien a faire sur desktop

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

    // Reparenter le contenu via MobileStepper (pas de clone)
    if (this._activeTab === 'form') {
      window.MobileStepper?.reparentToSheet();
    }
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

    // Remettre le contenu a sa place desktop
    window.MobileStepper?.reparentToDesktop();
  },

  toggleSheet() {
    this._isOpen ? this.closeSheet() : this.openSheet();
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
      tabs.querySelectorAll('.mob-sheet-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.tab === target)
      );

      // Gerer visibilite des contenus
      const stepperBody = document.getElementById('mob-stepper-body');
      const tipsEl      = document.getElementById('mob-stepper-tips');
      const progressEl  = document.getElementById('mob-stepper-progress');
      const indicatorEl = document.getElementById('mob-stepper-indicator');
      const navEl       = document.getElementById('mob-stepper-nav');
      const risksEl     = document.getElementById('mob-sheet-risks-content');
      const actorsEl    = document.getElementById('mob-sheet-actors-content');

      // Hide all
      [stepperBody, tipsEl, risksEl, actorsEl].forEach(el => {
        if (el) el.style.display = 'none';
      });
      // Hide stepper chrome
      [progressEl, indicatorEl, navEl].forEach(el => {
        if (el) el.style.display = 'none';
      });

      if (target === 'form') {
        // Show stepper
        window.MobileStepper?.reparentToSheet();
        if (stepperBody) stepperBody.style.display = '';
        window.MobileStepper?._showStepperUI(true);
      } else if (target === 'risks') {
        if (risksEl) risksEl.style.display = '';
        this._populateRisks();
      } else if (target === 'actors') {
        if (actorsEl) actorsEl.style.display = '';
        this._populateActors();
      }
    });
  },

  // Copier le contenu risques depuis le right-panel
  _populateRisks() {
    const rightPanel = document.querySelector('.right-panel');
    const dest = document.getElementById('mob-sheet-risks-content');
    if (!rightPanel || !dest) return;

    const riskSection = rightPanel.querySelector('.rp-section');
    if (riskSection) {
      dest.innerHTML = riskSection.innerHTML;
    } else {
      dest.innerHTML = '<p style="font-size:11px;color:var(--faint);padding:16px;text-align:center">Aucun risque identifie pour cette phase</p>';
    }
  },

  _populateActors() {
    const rightPanel = document.querySelector('.right-panel');
    const dest = document.getElementById('mob-sheet-actors-content');
    if (!rightPanel || !dest) return;

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
    const current = window.TERLAB?.currentPhaseId ?? window.TerlabRouter?.currentPhase ?? 0;
    const target  = Math.max(0, Math.min(12, current + delta));
    if (target === current) return;

    this.closeSheet();

    if (window.TerlabRouter?.goto) {
      window.TerlabRouter.goto(target);
    }
  },

  // ── Mettre a jour l'indicateur de phase ──────────────────────
  updatePhaseIndicator(phaseId, phaseName) {
    const id   = phaseId   ?? window.TerlabRouter?.currentPhase ?? 0;
    let   name = phaseName ?? '';

    // Fallback : recuperer le titre depuis phases-meta.json (deja charge)
    if (!name) {
      const meta = window.TerlabRouter?._phasesMeta?.[id]
                ?? window.PHASES_META?.[id]
                ?? null;
      name = meta?.title ?? meta?.name ?? '';
    }

    const phaseTag = `P${String(id).padStart(2, '0')}`;

    // Tab bar indicator
    const indicator = document.getElementById('mob-phase-indicator');
    const nameEl    = document.getElementById('mob-phase-name');
    if (indicator) indicator.textContent = phaseTag;
    if (nameEl)    nameEl.textContent = name;

    // Topbar phase label (mobile uniquement via CSS)
    const tbNum   = document.querySelector('#tb-phase-label .tb-phase-num');
    const tbTitle = document.querySelector('#tb-phase-label .tb-phase-title');
    if (tbNum)   tbNum.textContent   = phaseTag;
    if (tbTitle) tbTitle.textContent = name || '—';

    const prevBtn = document.getElementById('mob-prev-btn');
    const nextBtn = document.getElementById('mob-next-btn');
    if (prevBtn) prevBtn.disabled = (id <= 0);
    if (nextBtn) nextBtn.disabled = (id >= 12);
  },

  // ── Bouton Sources dans le mob-sheet (deplace depuis topbar) ──
  _bindSourcesButton() {
    document.getElementById('mob-sources-btn')
      ?.addEventListener('click', () => {
        const phase = window.TerlabRouter?.currentPhase ?? 0;
        window.TerlabSources?.open?.(phase);
      });
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

  // ── Resize observer (passage desktop/mobile) ─────────────────
  _bindResizeObserver() {
    const mql = window.matchMedia('(max-width: 800px)');
    mql.addEventListener('change', (e) => {
      const wasMobile = this._isMobile;
      this._isMobile  = e.matches;
      if (wasMobile && !this._isMobile) {
        // Mobile → desktop : remettre le contenu
        this.closeSheet();
      }
      if (!wasMobile && this._isMobile) {
        this.updatePhaseIndicator();
      }
    });
  },

  // ── Appele par index.js apres injection d'une nouvelle phase ─
  onPhaseInjected(phaseId, phaseName) {
    if (!this.isMobile) return;
    this.updatePhaseIndicator(phaseId, phaseName);

    // Vider les onglets risks/actors
    ['risks','actors'].forEach(t => {
      const el = document.getElementById(`mob-sheet-${t}-content`);
      if (el) el.innerHTML = '';
    });

    // Notifier le stepper
    window.MobileStepper?.onPhaseReady(phaseId);

    // Fermer le sheet si ouvert
    this.closeSheet();
  },

  destroy() {
    // Cleanup si necessaire
  }
};

export default MobileController;
