// TERLAB · coherence-service.js · Détection incohérences inter-phases
// Vérifie la cohérence des données entre les 14 phases
// ENSA La Réunion · MGA Architecture

const CoherenceService = {

  // ── Règles de cohérence ────────────────────────────────────────
  RULES: [

    {
      id: 'slope_foundation',
      label: 'Pente > 15% → G1 obligatoire',
      severity: 'error',
      check(s) {
        const pente = parseFloat(s.terrain?.pente_moy_pct ?? 0);
        const geo   = s.terrain?.type_geologique ?? '';
        return pente > 15 && !geo.toLowerCase().includes('g1');
      },
      message: 'Pente > 15% détectée (Phase 1) — étude géotechnique G1 obligatoire (Phase 2)',
      phases: [1, 2],
    },

    {
      id: 'ppr_rouge_habitable',
      label: 'Zone PPR rouge → construction interdite',
      severity: 'error',
      check(s) {
        const ppr = (s.terrain?.ppr_zone ?? '').toLowerCase();
        return ppr.includes('rouge');
      },
      message: 'Zone PPR rouge (Phase 3) — construction interdite ou très fortement prescrite',
      phases: [0, 3],
    },

    {
      id: 'gabarit_reculs',
      label: 'Gabarit dépasse les reculs PLU',
      severity: 'error',
      check(s) {
        const conf = s.phases?.[11]?.data?.reculs_conformes;
        return conf === false || conf === 'false';
      },
      message: 'Gabarit (Phase 7) ne respecte pas les reculs PLU (Phase 4) — revoir implantation',
      phases: [4, 7],
    },

    {
      id: 'surface_plancher_cos',
      label: 'Surface plancher > COS autorisé',
      severity: 'warning',
      check(s) {
        const contenance = parseFloat(s.terrain?.contenance_m2 ?? 0);
        const cos        = parseFloat(s.terrain?.plu_cos ?? 0.5);
        const plancher   = parseFloat(s.phases?.[10]?.data?.surface_plancher_m2 ?? 0);
        return contenance > 0 && cos > 0 && plancher > 0 && plancher > contenance * cos;
      },
      message: 'Surface plancher (Phase 10) dépasse le COS autorisé (Phase 4)',
      phases: [4, 10],
    },

    {
      id: 'giep_score_low',
      label: 'Score GIEP insuffisant',
      severity: 'warning',
      check(s) {
        const score = s.phases?.[8]?.data?.giep_score;
        return score != null && parseFloat(score) < 30;
      },
      message: 'Score GIEP < 30/100 (Phase 8) — revoir les mesures de gestion des eaux pluviales',
      phases: [8],
    },

    {
      id: 'rtaa_isolation',
      label: 'Zone RTAA 3 → isolation requise',
      severity: 'warning',
      check(s) {
        const rtaa = s.terrain?.zone_rtaa;
        const isol = s.phases?.[10]?.data?.isolation_prevue;
        return (rtaa === '3' || rtaa === 3) && !isol;
      },
      message: 'Zone RTAA 3 (altitude > 800m) — isolation thermique obligatoire non cochée (Phase 10)',
      phases: [1, 10],
    },

    {
      id: 'sdis_non_conforme',
      label: 'Accès pompiers non conforme',
      severity: 'error',
      check(s) {
        const states = s.phases?.[8]?.data?.acces_pompiers_states;
        if (!states || typeof states !== 'object') return false;
        return Object.values(states).some(v => v === 'err' || v === 'ko');
      },
      message: 'Accès pompiers non conforme SDIS 974 (Phase 8) — bloquant pour le permis de construire',
      phases: [8],
    },

    {
      id: 'no_parcelle',
      label: 'Parcelle non définie',
      severity: 'warning',
      check(s) {
        return !s.terrain?.parcelle_geojson && !s.terrain?.commune;
      },
      message: 'Aucune parcelle identifiée (Phase 0) — les analyses suivantes manquent de contexte',
      phases: [0],
    },

    {
      id: 'altitude_aberrant',
      label: 'Altitude aberrante',
      severity: 'error',
      check(s) {
        const alt = parseFloat(s.terrain?.altitude_ngr);
        if (isNaN(alt)) return false;
        return alt < 0 || alt > 3100; // Piton des Neiges = 3069m
      },
      message: 'Altitude NGR hors bornes Réunion (0–3069m) — vérifier Phase 0',
      phases: [0],
    },

    {
      id: 'pente_extreme',
      label: 'Pente > 30% → attention',
      severity: 'warning',
      check(s) {
        const pente = parseFloat(s.terrain?.pente_moy_pct ?? 0);
        return pente > 30;
      },
      message: 'Pente > 30% — terrain très pentu, vérifier la faisabilité de construction (Phase 7)',
      phases: [1, 7],
    },
  ],

  // ── Vérifier toutes les règles ─────────────────────────────────
  checkAll(sessionData) {
    if (!sessionData) return [];
    return this.RULES
      .filter(rule => rule.check(sessionData))
      .sort((a, b) => (a.severity === 'error' ? -1 : 1) - (b.severity === 'error' ? -1 : 1));
  },

  // ── Compter par sévérité ───────────────────────────────────────
  countBySeverity(sessionData) {
    const alerts = this.checkAll(sessionData);
    return {
      errors:   alerts.filter(a => a.severity === 'error').length,
      warnings: alerts.filter(a => a.severity === 'warning').length,
      total:    alerts.length
    };
  },

  // ── Panel d'alertes (DOM) ──────────────────────────────────────
  showPanel() {
    const alerts = this.checkAll(window.SessionManager?._data);

    // Créer ou récupérer le modal
    let modal = document.getElementById('modal-coherence');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-coherence';
      modal.className = 'modal-backdrop';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.innerHTML = `
        <div class="modal-box modal-wide">
          <div class="modal-head">
            <h2 class="modal-title">Cohérence inter-phases</h2>
            <button class="modal-close" onclick="CoherenceService.hidePanel()" aria-label="Fermer">✕</button>
          </div>
          <div class="modal-body" id="coherence-body"></div>
          <div class="modal-foot">
            <p class="modal-disclaimer">Les alertes sont indicatives. Vérifier auprès des sources réglementaires.</p>
            <button class="modal-btn-ghost" onclick="CoherenceService.hidePanel()">Fermer</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
    }

    const body = document.getElementById('coherence-body');
    if (!alerts.length) {
      body.innerHTML = '<p style="text-align:center;color:var(--success);padding:20px">✓ Aucune incohérence détectée</p>';
    } else {
      body.innerHTML = alerts.map(a => `
        <div class="risk-card" data-level="${a.severity === 'error' ? 'danger' : 'warning'}" style="margin-bottom:8px">
          <div class="risk-label">${a.severity === 'error' ? '🔴' : '⚠'} ${a.label}</div>
          <div class="risk-text">${a.message}</div>
          <div style="margin-top:4px;font-family:var(--font-mono);font-size:9px;color:var(--faint)">
            Phases concernées : ${a.phases.map(p => `P${p}`).join(', ')}
            ${a.phases.length ? `<button style="margin-left:8px;padding:2px 6px;border:1px solid var(--border2);border-radius:3px;background:var(--card);color:var(--accent);font-size:9px;cursor:pointer;font-family:var(--font-mono)" onclick="TerlabRouter.goto(${a.phases[0]});CoherenceService.hidePanel()">Aller à P${a.phases[0]}</button>` : ''}
          </div>
        </div>
      `).join('');
    }

    modal.hidden = false;
  },

  hidePanel() {
    const modal = document.getElementById('modal-coherence');
    if (modal) modal.hidden = true;
  }
};

export default CoherenceService;
