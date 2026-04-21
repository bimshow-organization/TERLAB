/* ═══════════════════════════════════════════════════════════════
 * TERLAB · mobile-stepper.js
 * Stepper mobile didactique : 1 form-section = 1 step card
 * Reparente le DOM (pas de clone) → preserve event listeners
 * Tips contextuels depuis rapport-phrases-engine.js
 * ═══════════════════════════════════════════════════════════════ */

import { loadPhrases, pickAll, buildPluContext }
  from '../services/rapport-phrases-engine.js';

const MobileStepper = {

  _steps:       [],     // Array<{ el: HTMLElement, title: string, type: 'intro'|'form'|'val' }>
  _currentStep: 0,
  _totalSteps:  0,
  _phaseId:     null,
  _phrasesDict: null,
  _reparented:  false,
  _origDisplays: new Map(), // original display values before hide

  // ── Elements cache ──────────────────────────────────────────
  get _progressEl()  { return document.getElementById('mob-stepper-progress'); },
  get _numEl()       { return document.querySelector('.mob-step-num'); },
  get _titleEl()     { return document.querySelector('.mob-step-title'); },
  get _bodyEl()      { return document.getElementById('mob-stepper-body'); },
  get _tipsEl()      { return document.getElementById('mob-stepper-tips'); },
  get _prevBtn()     { return document.getElementById('mob-step-prev'); },
  get _nextBtn()     { return document.getElementById('mob-step-next'); },
  get _navEl()       { return document.getElementById('mob-stepper-nav'); },
  get _phaseNextBtn(){ return document.getElementById('mob-next-phase-btn'); },

  // ── Init ────────────────────────────────────────────────────
  async init() {
    // Preload phrases
    this._phrasesDict = await loadPhrases();

    // Bind step nav buttons
    document.getElementById('mob-step-prev')
      ?.addEventListener('click', () => this._prevStep());
    document.getElementById('mob-step-next')
      ?.addEventListener('click', () => this._nextStep());

    // Listen for validation changes to update step dots
    document.addEventListener('terlab:val-changed', () => {
      this._renderProgress();
    });
  },

  // ── Called after loadPhase completes ─────────────────────────
  onPhaseReady(phaseId) {
    this._phaseId = phaseId;
    this._currentStep = 0;
    this._discoverSteps();
  },

  // ── Discover form-sections as steps ─────────────────────────
  _discoverSteps() {
    this._steps = [];

    const scrollWrap = document.querySelector('.left-panel-scroll');
    if (!scrollWrap) return;

    // Step 0 : intro (.lp-head)
    const lpHead = scrollWrap.querySelector('.lp-head');
    if (lpHead) {
      const title = lpHead.querySelector('.phase-title')?.textContent?.trim() ?? '';
      this._steps.push({ el: lpHead, title, type: 'intro' });
    }

    // Steps 1..N : form-sections
    scrollWrap.querySelectorAll('.form-section').forEach(fs => {
      const fsHead = fs.querySelector('.fs-head');
      const title  = fsHead?.textContent?.trim() ?? '';
      this._steps.push({ el: fs, title, type: 'form' });
    });

    // Last step : val-block
    const leftPanel = document.querySelector('.left-panel');
    const valBlock  = leftPanel?.querySelector('.val-block');
    if (valBlock) {
      this._steps.push({ el: valBlock, title: 'Validation', type: 'val' });
    }

    this._totalSteps = this._steps.length;
  },

  // ── Reparent : move DOM to sheet ────────────────────────────
  reparentToSheet() {
    if (this._reparented) return;

    const scrollWrap = document.querySelector('.left-panel-scroll');
    const leftPanel  = document.querySelector('.left-panel');
    const valBlock   = leftPanel?.querySelector('.val-block');
    const body       = this._bodyEl;
    if (!scrollWrap || !body) return;

    // Move scroll wrapper (contains lp-head + form-sections)
    body.appendChild(scrollWrap);

    // Move val-block as last element
    if (valBlock) body.appendChild(valBlock);

    this._reparented = true;

    // Show stepper UI elements
    this._showStepperUI(true);

    // Go to step 0
    this._goToStep(0);
  },

  // ── Reparent : move DOM back to desktop ─────────────────────
  reparentToDesktop() {
    if (!this._reparented) return;

    const scrollWrap = document.querySelector('.left-panel-scroll');
    const leftPanel  = document.querySelector('.left-panel');
    const valBlock   = this._bodyEl?.querySelector('.val-block');
    if (!scrollWrap || !leftPanel) return;

    // Move val-block back first
    if (valBlock) leftPanel.appendChild(valBlock);

    // Move scroll wrapper back before val-block
    leftPanel.insertBefore(scrollWrap, leftPanel.querySelector('.val-block'));

    // Reset all step visibility
    this._steps.forEach(s => { s.el.style.display = ''; });

    this._reparented = false;

    // Hide stepper UI
    this._showStepperUI(false);

    // Clear tips
    if (this._tipsEl) this._tipsEl.innerHTML = '';
  },

  // ── Go to specific step ─────────────────────────────────────
  _goToStep(index) {
    if (index < 0 || index >= this._totalSteps) return;

    this._currentStep = index;

    // Show only current step, hide others
    this._steps.forEach((step, i) => {
      step.el.style.display = i === index ? '' : 'none';
    });

    // Update indicator
    const step = this._steps[index];
    if (this._numEl)   this._numEl.textContent = `${index + 1}/${this._totalSteps}`;
    if (this._titleEl) this._titleEl.textContent = step.title;

    // Update progress bar
    this._renderProgress();

    // Update nav buttons
    this._updateNavButtons();

    // Inject tips for this step
    this._injectTips(index);

    // Scroll sheet body to top
    const sheetBody = document.getElementById('mob-sheet-body');
    if (sheetBody) sheetBody.scrollTo(0, 0);
  },

  _nextStep() {
    if (this._currentStep < this._totalSteps - 1) {
      this._goToStep(this._currentStep + 1);
    }
  },

  _prevStep() {
    if (this._currentStep > 0) {
      this._goToStep(this._currentStep - 1);
    }
  },

  // ── Nav button state ────────────────────────────────────────
  _updateNavButtons() {
    const prev = this._prevBtn;
    const next = this._nextBtn;
    const phaseNext = this._phaseNextBtn;

    if (prev) prev.disabled = this._currentStep <= 0;

    const isLast = this._currentStep >= this._totalSteps - 1;
    if (next) next.style.display = isLast ? 'none' : '';
    if (phaseNext) phaseNext.style.display = isLast ? '' : 'none';
  },

  // ── Progress bar ────────────────────────────────────────────
  _renderProgress() {
    const container = this._progressEl;
    if (!container) return;

    // Build segments
    let html = '';
    for (let i = 0; i < this._totalSteps; i++) {
      const state = this._getStepState(i);
      html += `<div class="step-seg ${state}" data-step="${i}"></div>`;
    }
    container.innerHTML = html;

    // Allow clicking segments to navigate
    container.querySelectorAll('.step-seg').forEach(seg => {
      seg.addEventListener('click', () => {
        this._goToStep(parseInt(seg.dataset.step, 10));
      });
    });
  },

  // ── Step completion state ───────────────────────────────────
  _getStepState(index) {
    if (index === this._currentStep) return 'active';

    const step = this._steps[index];
    if (!step) return '';

    if (step.type === 'intro') return index < this._currentStep ? 'done' : '';

    if (step.type === 'val') {
      const allChecked = document.querySelectorAll('.check-item.checked').length;
      const total      = document.querySelectorAll('.check-item').length;
      return (total && allChecked === total) ? 'done' : '';
    }

    // form step : check if fields with data-val-index in this section are satisfied
    const valIndexEls = step.el.querySelectorAll('[data-val-index]');
    if (!valIndexEls.length) {
      // No validation fields — consider done if past
      return index < this._currentStep ? 'done' : '';
    }

    const checkItems = document.querySelectorAll('.check-item');
    const allDone = Array.from(valIndexEls).every(el => {
      const idx = parseInt(el.dataset.valIndex, 10);
      return checkItems[idx]?.classList.contains('checked');
    });

    return allDone ? 'done' : '';
  },

  // ── Tips injection ──────────────────────────────────────────
  _injectTips(index) {
    const tipsEl = this._tipsEl;
    if (!tipsEl) return;
    tipsEl.innerHTML = '';

    const step = this._steps[index];
    if (!step || !this._phrasesDict) return;

    // Read data-tips="section:key1,key2" from the element
    const tipsAttr = step.el.dataset?.tips;
    if (!tipsAttr) return;

    // Parse "section:key1,key2"
    const [section, keysStr] = tipsAttr.split(':');
    if (!section || !keysStr) return;
    const keys = keysStr.split(',').map(k => k.trim()).filter(Boolean);

    // Build context
    const ctx = this._buildContext();

    // Collect all matching tips
    const tips = [];
    for (const key of keys) {
      const matches = pickAll(this._phrasesDict, section, key, ctx, { mode: 'short' });
      tips.push(...matches);
    }

    if (!tips.length) return;

    // Render tip cards
    tipsEl.innerHTML = tips.map(text =>
      `<div class="mob-tip-card"><span class="tip-label">Conseil</span>${_escHtml(text)}</div>`
    ).join('');
  },

  // ── Build evaluation context ────────────────────────────────
  _buildContext() {
    const SM = window.SessionManager;
    if (!SM) return {};

    const terrain = SM.getTerrain?.() ?? {};
    const p4 = SM.getPhase?.(4) ?? {};

    // Use buildPluContext as base + add terrain fields
    const ctx = buildPluContext(terrain, p4);

    // Merge extra terrain fields
    Object.assign(ctx, {
      adresse:            terrain.adresse ?? null,
      section:            terrain.section ?? null,
      parcelle:           terrain.parcelle ?? null,
      altitude:           terrain.altitude_ngr ?? null,
      pente_pct:          terrain.pente_moy_pct ?? null,
      exposition:         terrain.orientation_terrain ?? null,
      zone_pprn:          terrain.zone_pprn ?? null,
      cote_reference_ngr: terrain.cote_reference_ngr ?? null,
      nom_ravine:         terrain.nom_ravine ?? null,
      distance_ravine_m:  terrain.distance_ravine_m ?? null,
      zone_rtaa:          terrain.zone_rtaa ?? null,
      zone_pluvio:        terrain.zone_pluvio ?? null,
    });

    // Phase-specific data
    const p2 = SM.getPhase?.(2) ?? {};
    const p3 = SM.getPhase?.(3) ?? {};
    Object.assign(ctx, {
      geologie_type: p2.geologie_type ?? null,
      has_remblai:   p2.has_remblai ?? null,
    });

    return ctx;
  },

  // ── Show/hide stepper UI ────────────────────────────────────
  _showStepperUI(show) {
    const els = [
      this._progressEl,
      document.getElementById('mob-stepper-indicator'),
      this._tipsEl,
      this._navEl,
    ];
    els.forEach(el => {
      if (el) el.style.display = show ? '' : 'none';
    });
  },

  // ── Cleanup ─────────────────────────────────────────────────
  destroy() {
    this.reparentToDesktop();
    this._steps = [];
    this._currentStep = 0;
    this._totalSteps = 0;
    this._phaseId = null;
  }
};

// ── Helpers ───────────────────────────────────────────────────
function _escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export default MobileStepper;
