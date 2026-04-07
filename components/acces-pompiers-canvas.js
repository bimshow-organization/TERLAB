// TERLAB · components/acces-pompiers-canvas.js
// Canvas interactif Accès Pompiers — SDIS 974 La Réunion
// S'ouvre en modal depuis Phase 8 (Chantier & Construction)
// Données adaptées depuis la session : parcelle, gabarit, altitude, zone PPRN

const AccesPompiers = {

  // ─── DONNÉES RÉGLEMENTAIRES SDIS 974 ──────────────────────────
  // Source : Arrêté du 31/01/1986 modifié · Circulaire SDIS 974
  CRITERES: [
    {
      id:       'largeur',
      groupe:   '§ 01 — Voie d\'accès engins',
      label:    'Largeur de voie ≥ 3,0 m',
      regle:    'Art. 4 Arrêté 31/01/1986 · SDIS 974',
      note:     'La voie d\'accès depuis la rue doit permettre le passage d\'un fourgon pompe tonne (FPT) en toute circonstance.',
      detail:   'La voie d\'accès doit présenter une largeur minimale de 3,0 m en tout point, dégagée de tout obstacle (végétation, clôture, portail en débord). À La Réunion, les voies en impasse sont courantes — vérifier la possibilité de demi-tour ou prévoir une aire de retournement.',
      textes:   'Art. 4 de l\'Arrêté du 31/01/1986 · Circulaire SDIS 974 · Décret n°2006-1658 voirie · Arrêté préfectoral Réunion.',
      penalite: 'Non-conformité bloquante : le permis de construire peut être refusé par le SDIS si la voie est inférieure à 3 m. Obligation réglementaire, pas seulement recommandation.',
      svg_key:  'voie',
    },
    {
      id:       'hauteur',
      groupe:   '§ 01 — Voie d\'accès engins',
      label:    'Hauteur libre ≥ 3,5 m',
      regle:    'Art. 4 Arrêté 1986 · Gabarit FPT Réunion',
      note:     'Portails, câbles, branches et auvents doivent être au-dessus de 3,5 m sur toute la longueur de la voie d\'accès.',
      detail:   'Le gabarit du fourgon pompe tonne (FPT) en Réunion est de 2,60 m de haut avec équipements en toiture. Le gabarit libre réglementaire est donc 3,50 m minimum. À surveiller : câbles EDF basse tension, branches d\'arbres (croissance rapide en zone tropicale).',
      textes:   'Art. 4 Arrêté 1986 · Note SDIS 974 · Guide sécurité incendie DOM-TOM.',
      penalite: null,
      svg_key:  'hauteur',
    },
    {
      id:       'portance',
      groupe:   '§ 01 — Voie d\'accès engins',
      label:    'Portance ≥ 13 tonnes',
      regle:    'Art. 4 Arrêté 1986 · Poids FPT/CCF',
      note:     'Revêtement, dalles et sous-sol doivent supporter le poids du camion citerne en charge (FPT : 12–14 t, CCF : 7,5 t).',
      detail:   'Le sol volcanique basaltique de La Réunion présente généralement une très bonne portance (> 200 kPa), sauf en zones remblayées (Port, embouchures de ravines) ou en terrain alluvionnaire. Vérifier si le terrain est en remblai ou en zone de coulée récente friable.',
      textes:   'Art. 4 Arrêté 1986 · Guide DEAL Réunion fondations · Note BRGM portance sols volcanique.',
      penalite: 'Zones à risque Réunion : zones remblayées côtières (Le Port, La Possession) · Embouchures de ravines · Terrains en scories légères.',
      svg_key:  'portance',
    },
    {
      id:       'hydrant',
      groupe:   '§ 02 — Défense extérieure incendie',
      label:    'Hydrant (PI ou BI) à ≤ 150 m',
      regle:    'DECI · Arrêté préfectoral Réunion 974',
      note:     'Poteau incendie ou bouche d\'incendie à moins de 150 m par voie carrossable. Débit minimum 60 m³/h pendant 2 h.',
      detail:   'La Défense Extérieure Contre l\'Incendie (DECI) à La Réunion est définie par l\'Arrêté Préfectoral. Les hydrants doivent se situer à ≤ 150 m du bâtiment par voie carrossable (pas à vol d\'oiseau). En zone rurale ou en hauteur, la distance peut être portée à 200 m avec accord SDIS.',
      textes:   'DECI Réunion · Arrêté préfectoral de La Réunion · Code de la sécurité intérieure art. L732-1.',
      penalite: 'Données hydrants SDIS 974 non open data — vérification terrain obligatoire. Sans hydrant conforme, des réserves d\'eau compensatoires peuvent être exigées (citerne ≥ 60 m³).',
      svg_key:  'hydrant',
    },
    {
      id:       'degagement',
      groupe:   '§ 02 — Défense extérieure incendie',
      label:    'Dégagement façade ≥ 6 m (voie desserte)',
      regle:    'Art. 4 Arrêté 1986 · Voie de desserte interne',
      note:     'La façade accessible aux pompiers doit être précédée d\'une zone dégagée d\'au moins 6 m pour le déploiement des échelles et lances à incendie.',
      detail:   'La voie de desserte intérieure desservant les façades doit avoir une largeur utile de 6 m minimum (bande de roulement + bande de stationnement dégagée). En terrain en pente à La Réunion, prévoir une plateforme de retournement ou une voie en boucle fermée.',
      textes:   'Art. 4 Arrêté 31/01/1986 · Circulaire SDIS 974 spécifique pente · Guide sécurité incendie ERP DOM.',
      penalite: 'Points spécifiques Réunion : pente montante ≤ 15% · Virage : rayon extérieur ≥ 11 m · Impasse > 60 m : aire de retournement Ø 20 m obligatoire.',
      svg_key:  'degagement',
    },
  ],

  // ─── ÉTAT INTERNE ─────────────────────────────────────────────
  _states:   {}, // { id: 'ok' | 'warn' | 'err' | 'na' }
  _expanded: {}, // { id: true | false }
  _modal:    null,
  _terrain:  null,
  _gabarit:  null,

  // ─── OUVRIR LE MODAL ──────────────────────────────────────────
  open(sessionData) {
    this._terrain = sessionData?.terrain ?? {};
    this._gabarit = sessionData?.phases?.[7]?.data ?? {};

    // Restaurer états depuis session si disponibles
    const saved = sessionData?.phases?.[8]?.data?.acces_pompiers_states ?? {};
    this.CRITERES.forEach(c => {
      this._states[c.id] = saved[c.id] ?? 'warn';
      this._expanded[c.id] = false;
    });

    // Pré-remplir depuis les données terrain
    this._preRemplir();

    // Créer la modal
    if (!this._modal) {
      this._modal = document.createElement('div');
      this._modal.id = 'modal-acces-pompiers';
      document.body.appendChild(this._modal);
    }

    this._modal.innerHTML = this._buildHTML();
    this._modal.style.display = 'flex';
    this._modal.style.cssText = `
      position:fixed;inset:0;z-index:300;
      background:rgba(0,0,0,.7);backdrop-filter:blur(8px);
      display:flex;align-items:center;justify-content:center;
      padding:20px;
    `;

    this._bindEvents();
    this._updateScore();
    this._updatePlan();
    document.getElementById('modal-acces-pompiers').addEventListener('click', e => {
      if (e.target === this._modal) this.close();
    });

    document.addEventListener('keydown', this._keyHandler = e => {
      if (e.key === 'Escape') this.close();
    });
  },

  // ─── PRÉ-REMPLISSAGE DEPUIS SESSION ───────────────────────────
  _preRemplir() {
    const t   = this._terrain;
    const alt = parseFloat(t.altitude_ngr ?? 0);
    const geo = t.type_geologique ?? '';

    // Portance : basalte récent = conforme, remblai = non conforme
    if (geo.includes('remblai') || geo.includes('alluvion')) {
      this._states['portance'] = 'err';
    } else if (geo.includes('basalte') || alt < 100) {
      this._states['portance'] = 'ok';
    }

    // Dégagement : si contenance connue, estimer le ratio
    const contenance = parseFloat(t.contenance_m2 ?? 0);
    const gl = parseFloat(this._gabarit?.gabarit_l_m ?? 10);
    const gw = parseFloat(this._gabarit?.gabarit_w_m ?? 8);
    if (contenance > 0 && gl > 0) {
      const largParc  = Math.sqrt(contenance * 0.6); // Estimation largeur parcelle
      const degagement = (largParc - gl) / 2;
      if (degagement >= 6)        this._states['degagement'] = 'ok';
      else if (degagement >= 3)   this._states['degagement'] = 'warn';
      else                        this._states['degagement'] = 'err';
    }
  },

  // ─── FERMER ───────────────────────────────────────────────────
  close() {
    if (this._modal) this._modal.style.display = 'none';
    document.removeEventListener('keydown', this._keyHandler);
    this._saveToSession();
  },

  // ─── SAUVEGARDER EN SESSION ───────────────────────────────────
  _saveToSession() {
    window.SessionManager?.savePhase(8, { acces_pompiers_states: { ...this._states } });
    window.TerlabToast?.show('Accès pompiers — statuts enregistrés', 'info', 2000);
  },

  // ─── BUILD HTML ───────────────────────────────────────────────
  _buildHTML() {
    const t       = this._terrain;
    const commune = t.commune ?? 'La Réunion';
    const parcRef = `${t.section ?? ''}${t.parcelle ?? ''}`;
    const alt     = t.altitude_ngr ? `${t.altitude_ngr} m NGR` : '—';
    const geo     = t.type_geologique ?? 'Non déterminé';
    const score   = this._computeScore();

    // Grouper les critères
    const grouped = {};
    this.CRITERES.forEach(c => {
      if (!grouped[c.groupe]) grouped[c.groupe] = [];
      grouped[c.groupe].push(c);
    });

    return `
    <div style="
      display:grid;grid-template-columns:400px 1fr;
      width:min(960px,100%);height:min(700px,100%);
      background:#080c12;border-radius:12px;
      border:1px solid rgba(154,120,32,.15);
      overflow:hidden;font-family:'Source Serif 4',Georgia,serif;
    ">
      <!-- COLONNE GAUCHE — Plan SVG -->
      <div style="
        background:#0b1018;border-right:1px solid rgba(154,120,32,.08);
        display:flex;flex-direction:column;
      ">
        <!-- Header -->
        <div style="padding:14px 18px 11px;border-bottom:1px solid rgba(154,120,32,.08);flex-shrink:0">
          <div style="font-family:'Playfair Display',serif;font-size:17px;font-style:italic;color:#dce8f0;margin-bottom:3px">
            Accès pompiers — Plan schématique
          </div>
          <div style="font-family:'Inconsolata',monospace;font-size:8.5px;letter-spacing:.12em;color:#9a7820;text-transform:uppercase;opacity:.7">
            ${commune} · ${parcRef} · ${alt} · ${geo}
          </div>
        </div>

        <!-- SVG Plan -->
        <div style="flex:1;position:relative;overflow:hidden">
          <svg id="ap-svg" width="100%" viewBox="0 0 400 420" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <marker id="ap-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </marker>
              <pattern id="ap-hatch-err" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(239,68,68,.28)" stroke-width="2"/>
              </pattern>
              <pattern id="ap-hatch-ok" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(45,200,154,.15)" stroke-width="2"/>
              </pattern>
            </defs>

            <!-- Fond -->
            <rect width="400" height="420" fill="#090e18"/>

            <!-- Sol rue -->
            <rect x="0" y="285" width="400" height="135" fill="#0d131e"/>
            <text font-family="Inconsolata,monospace" font-size="7.5" fill="rgba(106,138,170,.35)"
                  x="200" y="338" text-anchor="middle" letter-spacing="3">R U E</text>

            <!-- Trottoir -->
            <rect x="0" y="276" width="400" height="12" fill="#111b28"
                  stroke="rgba(154,120,32,.07)" stroke-width=".5"/>

            <!-- Zone voie (hachures si non conforme) -->
            <rect id="ap-voie-fill" x="0" y="288" width="400" height="100"
                  fill="rgba(45,200,154,.03)"/>
            <rect id="ap-voie-hatch" x="0" y="288" width="400" height="100"
                  fill="url(#ap-hatch-err)" opacity="0" style="transition:opacity .35s"/>

            <!-- Parcelle -->
            <rect x="70" y="80" width="210" height="196" fill="#0e1827"
                  stroke="rgba(154,120,32,.3)" stroke-width="1.5"/>
            <text font-family="Inconsolata,monospace" font-size="7" fill="rgba(154,120,32,.35)"
                  x="175" y="97" text-anchor="middle" letter-spacing="2">PARCELLE</text>

            <!-- Bâtiment -->
            <rect x="105" y="108" width="140" height="138" fill="#121d2e"
                  stroke="rgba(154,120,32,.18)" stroke-width="1" rx="2"/>
            <text font-family="Inconsolata,monospace" font-size="7" fill="rgba(154,120,32,.28)"
                  x="175" y="182" text-anchor="middle">bâtiment</text>

            <!-- Limite parcelle côté rue -->
            <line x1="70" y1="276" x2="280" y2="276"
                  stroke="rgba(154,120,32,.45)" stroke-width="1" stroke-dasharray="5 3"/>

            <!-- Zone de manœuvre (devant bâtiment, 6m) -->
            <rect id="ap-zone-mano" x="70" y="218" width="210" height="58"
                  fill="rgba(45,200,154,.06)" stroke="rgba(45,200,154,.18)"
                  stroke-width=".7" stroke-dasharray="4 3"/>
            <rect id="ap-zone-mano-hatch" x="70" y="218" width="210" height="58"
                  fill="url(#ap-hatch-err)" opacity="0" style="transition:opacity .35s"/>
            <text id="ap-mano-label" font-family="Inconsolata,monospace" font-size="6.5"
                  fill="rgba(45,200,154,.5)" x="175" y="251" text-anchor="middle" letter-spacing=".8">
              AIRE DE MANŒUVRE
            </text>

            <!-- Flèche accès principal -->
            <line x1="175" y1="276" x2="175" y2="295" stroke="#9a7820" stroke-width="1.5"
                  marker-end="url(#ap-arr)"/>
            <text font-family="Inconsolata,monospace" font-size="7" fill="rgba(154,120,32,.55)"
                  x="183" y="289">accès</text>

            <!-- Cote largeur voie (extérieure) -->
            <line x1="25" y1="291" x2="25" y2="385" stroke="rgba(45,200,154,.4)"
                  stroke-width=".5" stroke-dasharray="2 2"/>
            <line x1="375" y1="291" x2="375" y2="385" stroke="rgba(45,200,154,.4)"
                  stroke-width=".5" stroke-dasharray="2 2"/>
            <line x1="25" y1="340" x2="375" y2="340" stroke="rgba(45,200,154,.6)"
                  stroke-width=".8" marker-start="url(#ap-arr)" marker-end="url(#ap-arr)"/>
            <text id="ap-voie-cote" font-family="Inconsolata,monospace" font-size="8.5"
                  fill="rgba(45,200,154,.9)" x="200" y="335" text-anchor="middle" font-weight="700">
              ≥ 3,0 m largeur voie
            </text>

            <!-- Cote dégagement façade -->
            <line x1="70" y1="264" x2="280" y2="264"
                  stroke="rgba(245,158,11,.5)" stroke-width=".7" stroke-dasharray="2 2"/>
            <line x1="70" y1="259" x2="70" y2="270" stroke="#f59e0b" stroke-width=".8"/>
            <line x1="280" y1="259" x2="280" y2="270" stroke="#f59e0b" stroke-width=".8"/>
            <text id="ap-degagement-cote" font-family="Inconsolata,monospace" font-size="7.5"
                  fill="rgba(245,158,11,.8)" x="175" y="259" text-anchor="middle">
              desserte ← 6 m requis →
            </text>

            <!-- Hauteur libre (symbole vertical) -->
            <line x1="295" y1="240" x2="295" y2="276"
                  stroke="rgba(45,200,154,.6)" stroke-width=".8"
                  marker-start="url(#ap-arr)" marker-end="url(#ap-arr)"/>
            <text font-family="Inconsolata,monospace" font-size="6.5"
                  fill="rgba(45,200,154,.7)" x="299" y="261">3,5 m</text>
            <text font-family="Inconsolata,monospace" font-size="6"
                  fill="rgba(45,200,154,.45)" x="299" y="270">haut. libre</text>

            <!-- Hydrant -->
            <circle id="ap-hydrant-radius" cx="40" cy="336" r="75"
                    fill="rgba(154,120,32,.04)" stroke="rgba(154,120,32,.18)"
                    stroke-width=".7" stroke-dasharray="4 4"/>
            <circle cx="40" cy="336" r="7" fill="#9a7820" opacity=".8"/>
            <rect x="36" y="333" width="8" height="6" rx="1" fill="#090e18"/>
            <rect x="38" y="332" width="4" height="2" rx="1" fill="#090e18"/>
            <line x1="40" y1="339" x2="40" y2="344" stroke="#090e18" stroke-width="1.5"/>
            <text font-family="Inconsolata,monospace" font-size="6.5"
                  fill="rgba(154,120,32,.65)" x="40" y="353" text-anchor="middle">PI/BI</text>
            <text font-family="Inconsolata,monospace" font-size="6"
                  fill="rgba(154,120,32,.4)" x="40" y="360" text-anchor="middle">≤ 150 m</text>
            <!-- Ligne bâtiment → hydrant -->
            <line x1="47" y1="330" x2="106" y2="176"
                  stroke="rgba(154,120,32,.15)" stroke-width=".4" stroke-dasharray="3 4"/>
            <text font-family="Inconsolata,monospace" font-size="6.5"
                  fill="rgba(154,120,32,.35)" x="70" y="255" text-anchor="middle">~85 m</text>

            <!-- Voisins -->
            <rect x="300" y="105" width="85" height="100" fill="#0c1420"
                  stroke="rgba(106,138,170,.1)" stroke-width=".7" rx="2"/>
            <text font-family="Inconsolata,monospace" font-size="6"
                  fill="rgba(106,138,170,.18)" x="342" y="160" text-anchor="middle">voisin</text>
            <rect x="0" y="135" width="58" height="75" fill="#0c1420"
                  stroke="rgba(106,138,170,.1)" stroke-width=".7" rx="2"/>
            <text font-family="Inconsolata,monospace" font-size="6"
                  fill="rgba(106,138,170,.18)" x="29" y="178" text-anchor="middle">voisin</text>

            <!-- Portance note -->
            <text font-family="Inconsolata,monospace" font-size="6.5"
                  id="ap-portance-note"
                  fill="rgba(45,200,154,.45)" x="200" y="410" text-anchor="middle">
              Portance : 13 t requises — sol basaltique Réunion ✓
            </text>

            <!-- Badge SDIS -->
            <rect x="290" y="58" width="106" height="18" rx="3"
                  fill="rgba(154,120,32,.05)" stroke="rgba(154,120,32,.12)" stroke-width=".5"/>
            <text font-family="Inconsolata,monospace" font-size="7"
                  fill="rgba(154,120,32,.55)" x="343" y="70" text-anchor="middle" letter-spacing=".8">
              SDIS 974 — Réunion
            </text>
          </svg>

          <!-- Mode toggle -->
          <div style="position:absolute;top:8px;left:8px;display:flex;flex-direction:column;gap:3px">
            <button class="ap-mode-btn active" data-mode="plan" onclick="AccesPompiers._setMode('plan',this)">Plan</button>
            <button class="ap-mode-btn" data-mode="dist" onclick="AccesPompiers._setMode('dist',this)">Cotes</button>
          </div>
        </div>

        <!-- Légende -->
        <div style="
          padding:7px 14px;border-top:1px solid rgba(154,120,32,.07);
          display:flex;gap:14px;flex-wrap:wrap;flex-shrink:0
        ">
          ${[
            ['#2dc89a','Conforme'],
            ['#f59e0b','À vérifier'],
            ['#ef4444','Non conforme'],
            ['rgba(154,120,32,.5)','Zone action'],
          ].map(([c,l]) => `
            <span style="display:flex;align-items:center;gap:5px;
              font-family:'Inconsolata',monospace;font-size:8px;
              color:#6b5c3e;text-transform:uppercase;letter-spacing:.07em">
              <span style="width:8px;height:8px;border-radius:50%;background:${c};flex-shrink:0"></span>
              ${l}
            </span>`).join('')}
        </div>
      </div>

      <!-- COLONNE DROITE — Réglementation -->
      <div style="display:flex;flex-direction:column;background:#080c12;overflow:hidden">
        <!-- Header droite -->
        <div style="
          padding:11px 16px 9px;border-bottom:1px solid rgba(154,120,32,.08);
          flex-shrink:0;position:relative
        ">
          <div style="font-family:'Playfair Display',serif;font-size:15px;font-style:italic;color:#dce8f0">
            Réglementation sécurité incendie
          </div>
          <div style="font-family:'Inconsolata',monospace;font-size:8.5px;color:#6b5c3e;letter-spacing:.08em;text-transform:uppercase;margin-top:2px">
            SDIS 974 · Arrêté 31/01/1986 · DECI Réunion
          </div>
          <button onclick="AccesPompiers.close()" style="
            position:absolute;top:10px;right:12px;
            width:26px;height:26px;border-radius:50%;
            border:1px solid rgba(154,120,32,.15);background:none;
            color:#6b5c3e;cursor:pointer;font-size:16px;
            display:flex;align-items:center;justify-content:center;
            transition:all .15s;line-height:1
          " onmouseover="this.style.borderColor='#9a7820';this.style.color='#9a7820'"
             onmouseout="this.style.borderColor='rgba(154,120,32,.15)';this.style.color='#6b5c3e'">
            ✕
          </button>
        </div>

        <!-- Score bar -->
        <div id="ap-score-bar" style="
          padding:9px 16px;border-bottom:1px solid rgba(154,120,32,.08);
          display:flex;align-items:center;gap:12px;flex-shrink:0
        ">
          <div id="ap-score-circle" style="
            width:44px;height:44px;border-radius:50%;
            display:flex;align-items:center;justify-content:center;
            font-family:'Inconsolata',monospace;font-size:13px;font-weight:700;
            flex-shrink:0;border:2px solid #f59e0b;color:#f59e0b
          ">—/5</div>
          <div>
            <div style="font-family:'Inconsolata',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#6b5c3e">
              Conformité SDIS 974
            </div>
            <div id="ap-score-text" style="font-family:'Playfair Display',serif;font-size:13.5px;color:#dce8f0;margin-top:2px;font-style:italic">
              Évaluation en cours…
            </div>
          </div>
        </div>

        <!-- Critères (scrollable) -->
        <div id="ap-criteres" style="flex:1;overflow-y:auto;padding:6px 0">
          ${this._buildCriteres(grouped)}
        </div>

        <!-- Footer -->
        <div style="
          padding:9px 15px;border-top:1px solid rgba(154,120,32,.07);
          font-family:'Inconsolata',monospace;font-size:8.5px;
          color:#38506a;line-height:1.6;flex-shrink:0;
          display:flex;align-items:center;justify-content:space-between;gap:10px
        ">
          <span>Arrêté 31/01/1986 mod. · DECI La Réunion · Guide ERP DOM</span>
          <button onclick="AccesPompiers._exportPDF()" style="
            padding:5px 12px;font-family:'Inconsolata',monospace;font-size:8px;
            letter-spacing:.06em;text-transform:uppercase;
            border:1px solid rgba(154,120,32,.2);background:rgba(154,120,32,.06);
            color:#9a7820;border-radius:4px;cursor:pointer;white-space:nowrap;transition:all .15s
          ">→ Exporter</button>
        </div>
      </div>
    </div>`;
  },

  _buildCriteres(grouped) {
    return Object.entries(grouped).map(([groupe, crits]) => `
      <div style="padding:4px 0">
        <div style="
          padding:4px 16px;font-family:'Inconsolata',monospace;
          font-size:8px;letter-spacing:.15em;text-transform:uppercase;
          color:rgba(154,120,32,.3)
        ">${groupe}</div>
        ${crits.map(c => this._buildCritCard(c)).join('')}
      </div>`).join('');
  },

  _buildCritCard(c) {
    const s    = this._states[c.id] ?? 'warn';
    const cfg  = this._stateConfig(s);
    const valText = { ok:'Conforme', warn:'À vérifier', err:'Non conforme' }[s];

    return `
    <div class="ap-crit-card" id="ap-card-${c.id}" style="
      margin:0 12px 6px;border-radius:6px;
      border:1px solid rgba(154,120,32,.08);background:#131c2a;
      overflow:hidden;transition:border-color .2s
    ">
      <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;cursor:pointer"
           onclick="AccesPompiers._toggle('${c.id}')">
        <div id="ap-st-${c.id}" style="
          width:22px;height:22px;border-radius:50%;flex-shrink:0;margin-top:1px;
          display:flex;align-items:center;justify-content:center;font-size:11px;
          border:1.5px solid;border-color:${cfg.border};
          background:${cfg.bg};color:${cfg.color}
        ">${cfg.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;color:#dce8f0;font-weight:500;line-height:1.3;margin-bottom:2px">
            ${c.label}
          </div>
          <div style="font-family:'Inconsolata',monospace;font-size:8.5px;color:#9a7820;letter-spacing:.05em;margin-bottom:4px;opacity:.75">
            ${c.regle}
          </div>
          <div style="font-size:11px;color:#6b5c3e;line-height:1.55;font-style:italic">
            ${c.note}
          </div>
        </div>
        <div id="ap-val-${c.id}" style="
          font-family:'Inconsolata',monospace;font-size:10px;font-weight:700;
          flex-shrink:0;align-self:center;padding:2px 7px;
          border-radius:3px;border:1px solid;white-space:nowrap;
          border-color:${cfg.valBorder};background:${cfg.valBg};color:${cfg.color}
        ">${valText}</div>
      </div>

      <!-- Status selector -->
      <div style="
        display:flex;border-top:1px solid rgba(154,120,32,.06);
        padding:5px 10px;gap:4px;background:rgba(0,0,0,.12)
      ">
        ${['ok','warn','err'].map(state => {
          const sc    = this._stateConfig(state);
          const label = { ok:'✓ Conforme', warn:'? À vérifier', err:'✕ Non conf.' }[state];
          const isAct = s === state;
          return `<button
            style="flex:1;padding:4px 5px;font-family:'Inconsolata',monospace;
              font-size:8px;letter-spacing:.04em;text-transform:uppercase;
              border-radius:3px;cursor:pointer;transition:all .15s;text-align:center;
              border:1px solid;
              ${isAct
                ? `background:${sc.bg};border-color:${sc.border};color:${sc.color}`
                : 'background:none;border-color:rgba(154,120,32,.08);color:#38506a'}"
            onmouseover="if(!this.classList.contains('active'))this.style.borderColor='rgba(154,120,32,.2)'"
            onmouseout="if(!this.classList.contains('active'))this.style.borderColor='rgba(154,120,32,.08)'"
            onclick="AccesPompiers._setStatus('${c.id}','${state}');event.stopPropagation()">
            ${label}
          </button>`;
        }).join('')}
      </div>

      <!-- Détail déroulant -->
      <div id="ap-det-${c.id}" style="max-height:0;overflow:hidden;transition:max-height .3s ease">
        <div style="padding:8px 14px 12px;font-size:11.5px;color:#6b5c3e;line-height:1.65">
          ${c.detail}
          <div style="
            background:rgba(154,120,32,.05);border-left:2px solid rgba(154,120,32,.4);
            padding:7px 10px;margin-top:8px;border-radius:0 4px 4px 0;
            font-family:'Inconsolata',monospace;font-size:9px;color:#dce8f0;line-height:1.6
          ">
            <span style="display:block;font-size:8px;color:#9a7820;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">
              Textes applicables
            </span>
            ${c.textes}
          </div>
          ${c.penalite ? `
          <div style="
            background:rgba(239,68,68,.07);border-left:2px solid rgba(239,68,68,.5);
            padding:6px 10px;margin-top:6px;border-radius:0 4px 4px 0;
            font-size:10.5px;color:#ef4444;line-height:1.5
          ">⚠ ${c.penalite}</div>` : ''}
        </div>
      </div>
    </div>`;
  },

  // ─── INTERACTIONS ─────────────────────────────────────────────
  _bindEvents() {
    document.querySelectorAll('#modal-acces-pompiers .ap-mode-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#modal-acces-pompiers .ap-mode-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      });
    });
  },

  _toggle(id) {
    this._expanded[id] = !this._expanded[id];
    const det = document.getElementById(`ap-det-${id}`);
    if (det) det.style.maxHeight = this._expanded[id] ? '350px' : '0';
  },

  _setStatus(id, state) {
    this._states[id] = state;
    const cfg     = this._stateConfig(state);
    const valText = { ok:'Conforme', warn:'À vérifier', err:'Non conforme' }[state];

    const st  = document.getElementById(`ap-st-${id}`);
    const val = document.getElementById(`ap-val-${id}`);

    if (st) {
      st.textContent  = cfg.icon;
      st.style.background = cfg.bg;
      st.style.borderColor = cfg.border;
      st.style.color   = cfg.color;
    }
    if (val) {
      val.textContent  = valText;
      val.style.background  = cfg.valBg;
      val.style.borderColor = cfg.valBorder;
      val.style.color       = cfg.color;
    }

    // Mettre à jour les boutons du sélecteur
    const card  = document.getElementById(`ap-card-${id}`);
    const btns  = card?.querySelectorAll('div button');
    if (btns) {
      const stateMap = ['ok','warn','err'];
      btns.forEach((b, i) => {
        const s  = stateMap[i];
        const sc = this._stateConfig(s);
        const isAct = s === state;
        Object.assign(b.style, isAct
          ? { background: sc.bg, borderColor: sc.border, color: sc.color }
          : { background: 'none', borderColor: 'rgba(154,120,32,.08)', color: '#38506a' }
        );
      });
    }

    this._updateScore();
    this._updatePlan();
  },

  _setMode(mode) {
    const voieHatch = document.getElementById('ap-voie-hatch');
    const manoHatch = document.getElementById('ap-zone-mano-hatch');
    const hydrant   = document.getElementById('ap-hydrant-radius');

    if (mode === 'dist') {
      if (voieHatch) voieHatch.style.opacity = this._states['largeur'] === 'err' ? '1' : '0';
      if (manoHatch) manoHatch.style.opacity = this._states['degagement'] === 'err' ? '1' : '0';
      if (hydrant && this._states['hydrant'] === 'err') {
        hydrant.setAttribute('stroke', 'rgba(239,68,68,.4)');
        hydrant.setAttribute('fill', 'rgba(239,68,68,.04)');
      }
    } else {
      if (voieHatch) voieHatch.style.opacity = '0';
      if (manoHatch) manoHatch.style.opacity = '0';
      if (hydrant) {
        hydrant.setAttribute('stroke', 'rgba(154,120,32,.18)');
        hydrant.setAttribute('fill', 'rgba(154,120,32,.04)');
      }
    }
  },

  _updatePlan() {
    const portanceNote = document.getElementById('ap-portance-note');
    if (portanceNote) {
      const cfg = this._stateConfig(this._states['portance'] ?? 'warn');
      portanceNote.setAttribute('fill', cfg.color + 'aa');
      portanceNote.textContent = this._states['portance'] === 'ok'
        ? 'Portance : 13 t requises — sol basaltique Réunion ✓'
        : this._states['portance'] === 'err'
          ? '⚠ Portance insuffisante — étude géotechnique G1 obligatoire'
          : 'Portance : vérification requise (13 t min)';
    }

    // Couleur zone manœuvre selon dégagement
    const zoneMano = document.getElementById('ap-zone-mano');
    const zoneCfg  = this._stateConfig(this._states['degagement'] ?? 'warn');
    if (zoneMano) {
      zoneMano.setAttribute('stroke', zoneCfg.border);
      zoneMano.setAttribute('fill', zoneCfg.bg.replace(')', ', .06)').replace('rgba(', 'rgba('));
    }
  },

  _updateScore() {
    const vals   = Object.values(this._states);
    const ok     = vals.filter(s => s === 'ok').length;
    const errs   = vals.filter(s => s === 'err').length;
    const total  = this.CRITERES.length;
    const circle = document.getElementById('ap-score-circle');
    const text   = document.getElementById('ap-score-text');
    if (!circle || !text) return;

    circle.textContent = `${ok}/${total}`;
    if (errs > 0) {
      circle.style.borderColor = '#ef4444';
      circle.style.color       = '#ef4444';
      text.textContent         = `${errs} non-conformité${errs > 1 ? 's' : ''} bloquante${errs > 1 ? 's' : ''}`;
      text.style.color         = '#ef4444';
    } else if (vals.some(s => s === 'warn')) {
      circle.style.borderColor = '#f59e0b';
      circle.style.color       = '#f59e0b';
      text.textContent         = 'Vérification terrain requise';
      text.style.color         = '#dce8f0';
    } else {
      circle.style.borderColor = '#2dc89a';
      circle.style.color       = '#2dc89a';
      text.textContent         = 'Tous critères conformes ✓';
      text.style.color         = '#2dc89a';
    }
  },

  _computeScore() {
    const ok = Object.values(this._states).filter(s => s === 'ok').length;
    return { ok, total: this.CRITERES.length };
  },

  _stateConfig(s) {
    return {
      ok:   { bg:'rgba(45,200,154,.12)',  border:'rgba(45,200,154,.4)',  valBg:'rgba(45,200,154,.1)',  valBorder:'rgba(45,200,154,.3)',  color:'#2dc89a', icon:'✓' },
      warn: { bg:'rgba(245,158,11,.12)',  border:'rgba(245,158,11,.4)',  valBg:'rgba(245,158,11,.1)',  valBorder:'rgba(245,158,11,.3)',  color:'#f59e0b', icon:'?' },
      err:  { bg:'rgba(239,68,68,.12)',   border:'rgba(239,68,68,.4)',   valBg:'rgba(239,68,68,.1)',   valBorder:'rgba(239,68,68,.3)',   color:'#ef4444', icon:'✕' },
      na:   { bg:'rgba(106,138,170,.1)',  border:'rgba(106,138,170,.3)', valBg:'rgba(106,138,170,.08)',valBorder:'rgba(106,138,170,.2)', color:'#6b5c3e', icon:'—' },
    }[s] ?? {};
  },

  // ─── EXPORT PDF (stub) ─────────────────────────────────────────
  async _exportPDF() {
    const score = this._computeScore();
    const lines = [
      `TERLAB — Analyse Accès Pompiers SDIS 974`,
      `Commune : ${this._terrain.commune ?? '—'} · Parcelle : ${this._terrain.section ?? ''}${this._terrain.parcelle ?? ''}`,
      `Date : ${new Date().toLocaleDateString('fr-FR')}`,
      ``,
      `Conformité : ${score.ok}/${score.total} critères conformes`,
      ``,
      ...this.CRITERES.map(c => {
        const s = this._states[c.id] ?? 'warn';
        const lbl = { ok:'✓ CONFORME', warn:'? À VÉRIFIER', err:'✕ NON CONFORME' }[s];
        return `${lbl} · ${c.label}`;
      }),
      ``,
      `Document pédagogique TERLAB v2 — non opposable.`,
      `Vérifier auprès du SDIS 974 et de la mairie.`,
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `TERLAB_acces_pompiers_${this._terrain.commune ?? 'site'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    window.TerlabToast?.show('Récapitulatif exporté', 'success', 2000);
  },
};

export default AccesPompiers;
