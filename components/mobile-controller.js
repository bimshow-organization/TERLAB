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
  _rpHome:      null,   // { parent, next } : position desktop du .right-panel reparente

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
    this._bindVirtualKeyboard();

    // Init indicateur phase
    this.updatePhaseIndicator();
  },

  // ── Ouvrir / fermer le sheet ──────────────────────────────────
  openSheet() {
    const sheet = document.getElementById('mob-sheet');
    const btn   = document.getElementById('mob-sheet-btn');
    if (!sheet) return;

    this._isOpen = true;
    sheet.classList.remove('sheet-peek');
    sheet.classList.add('sheet-open');
    sheet.setAttribute('data-tab', this._activeTab);
    sheet.setAttribute('aria-hidden', 'false');
    btn?.classList.add('sheet-open');
    btn?.setAttribute('aria-expanded', 'true');

    // Reparenter le contenu via MobileStepper (pas de clone)
    if (this._activeTab === 'form') {
      window.MobileStepper?.reparentToSheet();
    } else if (this._activeTab === 'tools') {
      this._reparentTools();
    }
  },

  closeSheet() {
    const sheet = document.getElementById('mob-sheet');
    const btn   = document.getElementById('mob-sheet-btn');
    if (!sheet) return;

    this._isOpen = false;
    sheet.classList.remove('sheet-open', 'sheet-peek');
    sheet.setAttribute('aria-hidden', 'true');
    btn?.classList.remove('sheet-open');
    btn?.setAttribute('aria-expanded', 'false');

    // Remettre le contenu a sa place desktop
    window.MobileStepper?.reparentToDesktop();
    this._restoreTools();
  },

  toggleSheet() {
    this._isOpen ? this.closeSheet() : this.openSheet();
  },

  // ── Mode "peek" : sheet reduit, carte + haut du formulaire visibles ──
  peekSheet() {
    if (!this._isOpen) return;
    document.getElementById('mob-sheet')?.classList.add('sheet-peek');
  },

  unpeekSheet() {
    document.getElementById('mob-sheet')?.classList.remove('sheet-peek');
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
      // Le chrome du stepper est en display:flex !important dans
      // mobile.css : un style inline ne peut pas le masquer. On pilote
      // donc sa visibilite par attribut sur le sheet (cf. mobile.css).
      document.getElementById('mob-sheet')?.setAttribute('data-tab', target);

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
      const toolsEl     = document.getElementById('mob-sheet-tools-content');
      const risksEl     = document.getElementById('mob-sheet-risks-content');
      const actorsEl    = document.getElementById('mob-sheet-actors-content');

      // Hide all
      [stepperBody, tipsEl, toolsEl, risksEl, actorsEl].forEach(el => {
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
      } else if (target === 'tools') {
        if (toolsEl) toolsEl.style.display = '';
        this._reparentTools();
      } else if (target === 'risks') {
        if (risksEl) risksEl.style.display = '';
        this._populateRisks();
      } else if (target === 'actors') {
        if (actorsEl) actorsEl.style.display = '';
        this._populateActors();
      }
    });
  },

  // ── Onglet Outils : reparentage REEL du right-panel ──────────
  // Le right-panel contient les fonctionnalites interactives des phases
  // (conception P07, exports P12…) : un clone innerHTML perdrait les
  // listeners — on deplace donc le noeud, comme le fait MobileStepper.
  _reparentTools() {
    const dest = document.getElementById('mob-sheet-tools-content');
    if (!dest) return;
    if (dest.querySelector('.right-panel')) return; // deja reparente

    const rp = document.querySelector('#phase-container .right-panel');
    if (!rp) {
      dest.innerHTML = '<p style="font-size:11px;color:var(--faint);padding:16px;text-align:center">Aucun outil pour cette phase</p>';
      return;
    }
    dest.innerHTML = '';
    this._rpHome = { parent: rp.parentElement, next: rp.nextElementSibling };
    dest.appendChild(rp);
    // Canvas/SVG inities en display:none ont un clientWidth de 0
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  },

  _restoreTools() {
    const dest = document.getElementById('mob-sheet-tools-content');
    const rp = dest?.querySelector('.right-panel');
    if (!rp) return;
    const home = this._rpHome;
    this._rpHome = null;
    if (home?.parent?.isConnected) {
      home.parent.insertBefore(rp, home.next?.isConnected ? home.next : null);
    } else {
      rp.remove(); // la phase d'origine a ete remplacee : panel obsolete
    }
  },

  // Copier le contenu risques depuis le right-panel
  // (copie assumee : #risks-zone est purement informatif, injecte par index.js)
  _populateRisks() {
    const dest = document.getElementById('mob-sheet-risks-content');
    if (!dest) return;

    const zone = document.getElementById('risks-zone');
    const src  = zone?.closest('.rp-section') ?? zone;
    if (src?.innerHTML?.trim()) {
      dest.innerHTML = src.innerHTML;
      // Eviter les ids dupliques dans le document (getElementById fiable)
      dest.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    } else {
      dest.innerHTML = '<p style="font-size:11px;color:var(--faint);padding:16px;text-align:center">Aucun risque identifie pour cette phase</p>';
    }
  },

  _populateActors() {
    const dest = document.getElementById('mob-sheet-actors-content');
    if (!dest) return;

    const zone = document.getElementById('actors-zone');
    const src  = zone?.closest('.rp-section') ?? zone;
    if (src?.innerHTML?.trim()) {
      dest.innerHTML = src.innerHTML;
      dest.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    } else {
      dest.innerHTML = '<p style="font-size:11px;color:var(--faint);padding:16px;text-align:center">Aucun acteur pour cette phase</p>';
    }
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
      // Drag vers le bas : peek d'abord, fermeture si deja en peek
      // (ou sur un drag franc). Drag vers le haut : redeployer.
      if (dy > 80) {
        if (sheet.classList.contains('sheet-peek') || dy > 180) this.closeSheet();
        else this.peekSheet();
      } else if (dy < -40) {
        this.unpeekSheet();
      }
    }, { passive: true });
  },

  // ── Tap carte : reduire le sheet en "peek" (pas fermer) ──────
  // Un tap sur un marqueur, une popup ou un contrôle Mapbox est une
  // interaction carte volontaire : on ne touche pas au sheet dessus.
  // Pour le reste, on reduit en peek plutot que fermer : l'utilisateur
  // voit le resultat de son tap (parcelle P00, point de coupe P01,
  // alea P03) se refleter dans le formulaire sans devoir le rouvrir.
  // Un tap dans le sheet le redeploye ; le drag du handle ferme.
  _bindBackdropClose() {
    document.getElementById('map')
      ?.addEventListener('click', (ev) => {
        if (ev.target.closest?.('.mapboxgl-marker, .mapboxgl-popup, .mapboxgl-ctrl')) return;
        this.peekSheet();
      });

    // Tap dans le sheet en mode peek → redeployer
    document.getElementById('mob-sheet')
      ?.addEventListener('click', () => this.unpeekSheet());
  },

  // ── Clavier virtuel ───────────────────────────────────────────
  // Le sheet est position:fixed;bottom:0 : quand le clavier iOS/Android
  // s'ouvre, il recouvre les champs du bas. On compense la hauteur du
  // clavier via visualViewport et on remonte le champ focusé dans la vue.
  _bindVirtualKeyboard() {
    const vv = window.visualViewport;
    if (!vv) return;

    const sheet = () => document.getElementById('mob-sheet');

    const onResize = () => {
      const s = sheet();
      if (!s || !this._isOpen) return;
      // Hauteur masquée par le clavier (0 quand il est fermé)
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      s.style.bottom = hidden ? `${hidden}px` : '';
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);

    // Remonter le champ focusé une fois le clavier déployé
    document.addEventListener('focusin', (e) => {
      if (!this._isMobile || !this._isOpen) return;
      const t = e.target;
      if (!t.matches?.('input, select, textarea')) return;
      if (!sheet()?.contains(t)) return;
      setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
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

    // Evacuer un eventuel right-panel obsolete de l'onglet Outils
    // (sa phase d'origine vient d'etre remplacee → il sera supprime)
    this._restoreTools();

    // Vider les onglets tools/risks/actors
    ['tools','risks','actors'].forEach(t => {
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
