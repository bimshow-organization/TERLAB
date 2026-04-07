// TERLAB · export-engine.js · Moteur exports PDF/DXF/GLB/JSON · v2.0
// ════════════════════════════════════════════════════════════════════════════
// PDF A3 paysage – rendu architecte : fond blanc, typo times/courier,
// filets fins, échelles graphiques, multi-colonnes, schémas cotés.
// ════════════════════════════════════════════════════════════════════════════

const ExportEngine = {

  // ── MODAL ─────────────────────────────────────────────────────
  openModal()  { document.getElementById('modal-export').hidden = false; },
  closeModal() { document.getElementById('modal-export').hidden = true; },

  // ── PROGRESS ──────────────────────────────────────────────────
  _setProgress(pct, label) {
    const prog  = document.getElementById('export-progress');
    const bar   = document.getElementById('export-progress-bar');
    const lbl   = document.getElementById('export-progress-label');
    if (prog) prog.hidden = false;
    if (bar)  bar.style.width = pct + '%';
    if (lbl)  lbl.textContent = label;
  },

  _hideProgress() {
    const prog = document.getElementById('export-progress');
    if (prog) prog.hidden = true;
  },

  // ═══════════════════════════════════════════════════════════════
  //  PDF — CONSTANTES LAYOUT
  // ═══════════════════════════════════════════════════════════════
  _L: {
    W: 420, H: 297, M: 14, M_TOP: 18, M_BOT: 14,
    GUTTER: 8,
    get COL2_W() { return (this.W - this.M * 2 - this.GUTTER) / 2; },
    get COL3_W() { return (this.W - this.M * 2 - this.GUTTER * 2) / 3; },
    get COL2_X1() { return this.M; },
    get COL2_X2() { return this.M + this.COL2_W + this.GUTTER; },
    get COL3_X1() { return this.M; },
    get COL3_X2() { return this.M + this.COL3_W + this.GUTTER; },
    get COL3_X3() { return this.M + (this.COL3_W + this.GUTTER) * 2; },
    get BODY_TOP() { return this.M_TOP + 18; },
    get BODY_BOT() { return this.H - this.M_BOT - 8; },
    get BODY_H() { return this.BODY_BOT - this.BODY_TOP; },
  },

  // Couleurs impression (RGB arrays)
  _C: {
    ink:      [26, 26, 26],
    text2:    [74, 85, 104],
    muted:    [130, 140, 155],
    accent:   [0, 140, 180],
    danger:   [200, 40, 40],
    warning:  [190, 120, 10],
    success:  [5, 140, 100],
    border:   [190, 200, 210],
    borderL:  [220, 225, 232],
    lightBg:  [245, 247, 250],
    white:    [255, 255, 255],
    cardBg:   [250, 251, 253],
  },

  // ═══════════════════════════════════════════════════════════════
  //  PDF — HELPERS DESSIN
  // ═══════════════════════════════════════════════════════════════

  /** Fond blanc + cadre fin */
  _drawPageBg(pdf) {
    const L = this._L, C = this._C;
    pdf.setFillColor(...C.white);
    pdf.rect(0, 0, L.W, L.H, 'F');
    // Cadre extérieur fin
    pdf.setDrawColor(...C.border);
    pdf.setLineWidth(0.3);
    pdf.rect(L.M - 2, L.M_TOP - 4, L.W - (L.M - 2) * 2, L.H - L.M_TOP - L.M_BOT + 8);
  },

  /** Bandeau titre en haut de page */
  _drawPageHeader(pdf, title, phaseLabel, pageNum, totalPages) {
    const L = this._L, C = this._C;
    this._drawPageBg(pdf);

    // Filet accent sous le bandeau
    pdf.setDrawColor(...C.accent);
    pdf.setLineWidth(0.6);
    pdf.line(L.M, L.M_TOP + 12, L.W - L.M, L.M_TOP + 12);

    // Filet fin doublure
    pdf.setDrawColor(...C.borderL);
    pdf.setLineWidth(0.15);
    pdf.line(L.M, L.M_TOP + 13, L.W - L.M, L.M_TOP + 13);

    // Branding gauche
    pdf.setFont('courier', 'normal');
    pdf.setFontSize(6.5);
    pdf.setTextColor(...C.muted);
    pdf.text('TERLAB · Laboratoire d\'analyse de terrain · ENSA La Réunion', L.M, L.M_TOP);

    // Phase label droite
    pdf.setFont('courier', 'bold');
    pdf.setFontSize(6.5);
    pdf.setTextColor(...C.accent);
    pdf.text(phaseLabel, L.W - L.M, L.M_TOP, { align: 'right' });

    // Titre principal
    pdf.setFont('times', 'bold');
    pdf.setFontSize(16);
    pdf.setTextColor(...C.ink);
    pdf.text(title.toUpperCase(), L.M, L.M_TOP + 9);

    // Numéro de page
    pdf.setFont('courier', 'normal');
    pdf.setFontSize(6);
    pdf.setTextColor(...C.muted);
    pdf.text(`${pageNum} / ${totalPages}`, L.W - L.M, L.M_TOP + 9, { align: 'right' });
  },

  /** Pied de page : disclaimer + session */
  _drawPageFooter(pdf, session) {
    const L = this._L, C = this._C;
    const yF = L.H - L.M_BOT;

    // Filet
    pdf.setDrawColor(...C.borderL);
    pdf.setLineWidth(0.2);
    pdf.line(L.M, yF - 2, L.W - L.M, yF - 2);

    pdf.setFont('courier', 'normal');
    pdf.setFontSize(5.5);
    pdf.setTextColor(...C.muted);
    pdf.text(
      'Document pédagogique TERLAB v1.0 — Non opposable aux documents réglementaires officiels (PPRN, PLU, CU, ERP). ENSA La Réunion.',
      L.M, yF + 1
    );
    const uuid = session?.getOrCreateUUID?.()?.slice(-8) ?? '—';
    const date = new Date().toLocaleDateString('fr-FR');
    pdf.text(`Session ${uuid}  ·  ${date}`, L.W - L.M, yF + 1, { align: 'right' });
  },

  /** Étiquette de section : UPPERCASE courier + filet */
  _drawSectionLabel(pdf, x, y, label, w) {
    const C = this._C;
    pdf.setFont('courier', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(...C.accent);
    pdf.text(label.toUpperCase(), x, y);
    if (w) {
      pdf.setDrawColor(...C.borderL);
      pdf.setLineWidth(0.15);
      pdf.line(x, y + 1.5, x + w, y + 1.5);
    }
    return y + 6;
  },

  /** Sous-titre de section */
  _drawSubTitle(pdf, x, y, text) {
    pdf.setFont('times', 'bolditalic');
    pdf.setFontSize(10);
    pdf.setTextColor(...this._C.ink);
    pdf.text(text, x, y);
    return y + 6;
  },

  /** Ligne clé : valeur */
  _drawKV(pdf, x, y, label, value, opts = {}) {
    const C = this._C;
    const labelW = opts.labelW ?? 48;
    const fontSize = opts.fontSize ?? 8;

    pdf.setFont('courier', 'normal');
    pdf.setFontSize(fontSize - 1);
    pdf.setTextColor(...C.muted);
    pdf.text(label, x, y);

    pdf.setFont('times', 'normal');
    pdf.setFontSize(fontSize);
    pdf.setTextColor(...C.ink);
    const val = String(value ?? '—').slice(0, 80);
    pdf.text(val, x + labelW, y);

    return y + (opts.lineH ?? 5.5);
  },

  /** Bloc clé-valeur avec fond alterné */
  _drawKVBlock(pdf, x, y, w, rows, opts = {}) {
    const C = this._C;
    const lineH = opts.lineH ?? 6;
    const labelW = opts.labelW ?? 48;
    const fontSize = opts.fontSize ?? 8;
    let cy = y;

    for (let i = 0; i < rows.length; i++) {
      const [label, value] = rows[i];
      if (value === undefined || value === null) continue;

      // Fond alterné
      if (i % 2 === 0) {
        pdf.setFillColor(...C.lightBg);
        pdf.rect(x - 1, cy - 3.5, w + 2, lineH, 'F');
      }
      cy = this._drawKV(pdf, x, cy, label, value, { labelW, fontSize, lineH });
    }
    return cy + 2;
  },

  /** Carte/encadré avec bordure gauche accent */
  _drawCard(pdf, x, y, w, h, opts = {}) {
    const C = this._C;
    const accentColor = opts.accent ?? C.accent;
    const bg = opts.bg ?? C.cardBg;

    // Fond
    pdf.setFillColor(...bg);
    pdf.roundedRect(x, y, w, h, 1, 1, 'F');

    // Bordure
    pdf.setDrawColor(...C.borderL);
    pdf.setLineWidth(0.2);
    pdf.roundedRect(x, y, w, h, 1, 1);

    // Accent gauche
    pdf.setDrawColor(...accentColor);
    pdf.setLineWidth(1.5);
    pdf.line(x, y + 1, x, y + h - 1);

    return { x: x + 4, y: y + 4, w: w - 8, h: h - 8 };
  },

  /** Badge de risque coloré */
  _drawBadge(pdf, x, y, text, level) {
    const C = this._C;
    const colors = {
      danger:  { bg: [255, 235, 235], fg: C.danger,  border: [240, 180, 180] },
      warning: { bg: [255, 247, 230], fg: C.warning, border: [240, 210, 160] },
      success: { bg: [230, 250, 243], fg: C.success, border: [170, 220, 200] },
      info:    { bg: [230, 246, 252], fg: C.accent,  border: [170, 210, 230] },
      muted:   { bg: C.lightBg,      fg: C.muted,   border: C.borderL },
    };
    const c = colors[level] ?? colors.muted;

    const tw = pdf.getTextWidth(text) + 5;
    pdf.setFillColor(...c.bg);
    pdf.roundedRect(x, y - 3, tw, 5, 1.2, 1.2, 'F');
    pdf.setDrawColor(...c.border);
    pdf.setLineWidth(0.2);
    pdf.roundedRect(x, y - 3, tw, 5, 1.2, 1.2);

    pdf.setFont('courier', 'bold');
    pdf.setFontSize(6);
    pdf.setTextColor(...c.fg);
    pdf.text(text, x + 2.5, y);

    return x + tw + 3;
  },

  // ── ÉCHELLE GRAPHIQUE ──────────────────────────────────────────
  /**
   * Dessine une échelle graphique graduée
   * @param {number} realMeters - longueur réelle représentée en mètres
   * @param {number} barW - largeur de la barre en mm sur le PDF
   */
  _drawScaleBar(pdf, x, y, realMeters, barW) {
    const C = this._C;
    barW = barW ?? 40;

    // Calcul d'une échelle "ronde"
    const niceSteps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];
    const rawStep = realMeters / 4;
    let step = niceSteps.find(s => s >= rawStep) ?? Math.ceil(rawStep);
    const numDiv = Math.min(Math.floor(realMeters / step), 5);
    if (numDiv < 1) return y;
    const divW = barW / numDiv;

    // Barre graduée alternée noir/blanc
    for (let i = 0; i < numDiv; i++) {
      if (i % 2 === 0) {
        pdf.setFillColor(...C.ink);
      } else {
        pdf.setFillColor(...C.white);
      }
      pdf.rect(x + i * divW, y, divW, 1.5, 'F');
    }
    // Cadre
    pdf.setDrawColor(...C.ink);
    pdf.setLineWidth(0.2);
    pdf.rect(x, y, numDiv * divW, 1.5);

    // Graduations
    pdf.setFont('courier', 'normal');
    pdf.setFontSize(5);
    pdf.setTextColor(...C.ink);
    for (let i = 0; i <= numDiv; i++) {
      const val = i * step;
      pdf.line(x + i * divW, y, x + i * divW, y + 2.5);
      pdf.text(`${val}`, x + i * divW, y + 5, { align: 'center' });
    }

    // Unité
    pdf.text('m', x + numDiv * divW + 3, y + 1);

    return y + 8;
  },

  // ── FLÈCHE NORD ────────────────────────────────────────────────
  _drawNorthArrow(pdf, x, y, size) {
    const C = this._C;
    size = size ?? 8;
    const hw = size * 0.3;

    // Triangle plein (moitié droite)
    pdf.setFillColor(...C.ink);
    pdf.triangle(x, y, x + hw, y + size, x, y + size * 0.7, 'F');
    // Triangle vide (moitié gauche)
    pdf.setDrawColor(...C.ink);
    pdf.setLineWidth(0.3);
    pdf.triangle(x, y, x - hw, y + size, x, y + size * 0.7);

    // N
    pdf.setFont('courier', 'bold');
    pdf.setFontSize(6);
    pdf.setTextColor(...C.ink);
    pdf.text('N', x, y - 1.5, { align: 'center' });

    return y + size + 4;
  },

  // ── SCHÉMA DES RECULS COTÉ ─────────────────────────────────────
  /**
   * Dessine un schéma en plan des reculs réglementaires (style archi)
   * avec cotes dimensionnelles
   */
  _drawReculsSchema(pdf, x, y, w, h, reculs, parcelle) {
    const C = this._C;
    const contenance = parseFloat(parcelle?.contenance_m2 ?? 400);
    const side = Math.sqrt(contenance);

    // Échelle : adapter le terrain dans le cadre
    const scale = Math.min((w - 20) / side, (h - 20) / side);

    const pw = side * scale;      // largeur parcelle en mm
    const ph = side * scale;      // hauteur parcelle en mm
    const px = x + (w - pw) / 2;  // centrage x
    const py = y + (h - ph) / 2;  // centrage y

    // Reculs en mm
    const rv = (parseFloat(reculs?.recul_voie_principale_m) || 0) * scale;
    const rv2 = (parseFloat(reculs?.recul_voie_secondaire_m) || 0) * scale;
    const rs = (parseFloat(reculs?.recul_limite_sep_m) || 0) * scale;
    const rf = (parseFloat(reculs?.recul_fond_m) || 0) * scale;

    // Fond du cadre
    pdf.setFillColor(...C.lightBg);
    pdf.rect(x, y, w, h, 'F');
    pdf.setDrawColor(...C.border);
    pdf.setLineWidth(0.2);
    pdf.rect(x, y, w, h);

    // Parcelle (trait fort)
    pdf.setDrawColor(...C.ink);
    pdf.setLineWidth(0.6);
    pdf.rect(px, py, pw, ph);

    // Zone constructible (trait pointillé accent)
    const zx = px + rs;
    const zy = py + rv;
    const zw = pw - rs * 2;
    const zh = ph - rv - rf;

    if (zw > 0 && zh > 0) {
      // Hachures légères zone non constructible
      pdf.setFillColor(240, 245, 250);
      pdf.rect(px, py, pw, ph, 'F');
      pdf.setFillColor(...C.white);
      pdf.rect(zx, zy, zw, zh, 'F');

      // Contour zone constructible
      pdf.setDrawColor(...C.accent);
      pdf.setLineWidth(0.4);
      pdf.setLineDashPattern([1.5, 1], 0);
      pdf.rect(zx, zy, zw, zh);
      pdf.setLineDashPattern([], 0);

      // Parcelle par dessus
      pdf.setDrawColor(...C.ink);
      pdf.setLineWidth(0.6);
      pdf.rect(px, py, pw, ph);
    }

    // ── Cotes dimensionnelles ──
    pdf.setFont('courier', 'normal');
    pdf.setFontSize(5.5);
    pdf.setTextColor(...C.ink);
    pdf.setDrawColor(...C.muted);
    pdf.setLineWidth(0.15);

    const drawDimH = (x1, x2, yc, label, side) => {
      if (!label || label === '0') return;
      const offset = side === 'top' ? -3 : 3;
      const arrowH = side === 'top' ? -1.5 : 1.5;
      // Ligne de cote
      pdf.line(x1, yc + offset, x2, yc + offset);
      // Flèches
      pdf.line(x1, yc + offset - arrowH, x1, yc + offset + arrowH);
      pdf.line(x2, yc + offset - arrowH, x2, yc + offset + arrowH);
      // Texte
      const tx = (x1 + x2) / 2;
      const ty = yc + offset + (side === 'top' ? -1.5 : 3.5);
      pdf.text(`${label} m`, tx, ty, { align: 'center' });
    };

    const drawDimV = (y1, y2, xc, label, side) => {
      if (!label || label === '0') return;
      const offset = side === 'left' ? -4 : 4;
      // Ligne de cote
      pdf.line(xc + offset, y1, xc + offset, y2);
      // Flèches
      pdf.line(xc + offset - 1.5, y1, xc + offset + 1.5, y1);
      pdf.line(xc + offset - 1.5, y2, xc + offset + 1.5, y2);
      // Texte (rotation)
      const ty = (y1 + y2) / 2;
      pdf.text(`${label} m`, xc + offset + (side === 'left' ? -2 : 2), ty, {
        align: 'center', angle: 90
      });
    };

    // Cotes reculs
    if (reculs?.recul_voie_principale_m) {
      drawDimV(py, py + rv, px + pw / 2, reculs.recul_voie_principale_m, 'right');
    }
    if (reculs?.recul_fond_m) {
      drawDimV(py + ph - rf, py + ph, px + pw / 2, reculs.recul_fond_m, 'right');
    }
    if (reculs?.recul_limite_sep_m) {
      drawDimH(px, px + rs, py + ph / 2, reculs.recul_limite_sep_m, 'top');
    }

    // Légendes
    pdf.setFont('courier', 'normal');
    pdf.setFontSize(5);
    pdf.setTextColor(...C.muted);

    // Label voie en bas
    pdf.text('VOIE PRINCIPALE', px + pw / 2, py - 1.5, { align: 'center' });

    // Label fond en haut
    if (rf > 0) pdf.text('FOND', px + pw / 2, py + ph + 5, { align: 'center' });

    // Échelle
    this._drawScaleBar(pdf, x + 2, y + h - 9, side, Math.min(w * 0.5, 35));

    return y + h + 2;
  },

  // ── GRILLE D'AVANCEMENT DES PHASES ─────────────────────────────
  _drawProgressGrid(pdf, x, y, w, session) {
    const C = this._C;
    const phases = [
      { n: 0,  label: 'Identification' },
      { n: 1,  label: 'Topographie' },
      { n: 2,  label: 'Géologie' },
      { n: 3,  label: 'Risques PPRN' },
      { n: 4,  label: 'PLU & RTAA' },
      { n: 5,  label: 'Voisinage' },
      { n: 6,  label: 'Biodiversité' },
      { n: 7,  label: 'Esquisse' },
      { n: 8,  label: 'Chantier' },
      { n: 9,  label: 'Carbone' },
      { n: 10, label: 'Entretien' },
      { n: 11, label: 'Fin de vie' },
      { n: 12, label: 'Synthèse' },
    ];

    const cols = 5;
    const rows = Math.ceil(phases.length / cols);
    const cellW = (w - (cols - 1) * 2) / cols;
    const cellH = 8;

    for (let i = 0; i < phases.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = x + col * (cellW + 2);
      const cy = y + row * (cellH + 2);

      const phase = session?.getPhase?.(phases[i].n);
      const done = phase?.completed === true;
      const hasData = phase?.data && Object.keys(phase.data).length > 0;

      // Fond selon état
      if (done) {
        pdf.setFillColor(225, 245, 235);
      } else if (hasData) {
        pdf.setFillColor(255, 248, 230);
      } else {
        pdf.setFillColor(...C.lightBg);
      }
      pdf.roundedRect(cx, cy, cellW, cellH, 0.8, 0.8, 'F');

      // Bordure
      pdf.setDrawColor(done ? 170 : 210, done ? 220 : 215, done ? 200 : 225);
      pdf.setLineWidth(0.2);
      pdf.roundedRect(cx, cy, cellW, cellH, 0.8, 0.8);

      // Numéro
      pdf.setFont('courier', 'bold');
      pdf.setFontSize(5.5);
      pdf.setTextColor(...(done ? C.success : C.muted));
      pdf.text(`P${phases[i].n}`, cx + 2, cy + 3.5);

      // Label
      pdf.setFont('times', 'normal');
      pdf.setFontSize(6);
      pdf.setTextColor(...C.ink);
      pdf.text(phases[i].label, cx + 10, cy + 3.5);

      // Indicateur
      if (done) {
        pdf.setFont('courier', 'bold');
        pdf.setFontSize(5);
        pdf.setTextColor(...C.success);
        pdf.text('OK', cx + cellW - 6, cy + 3.5);
      }
    }

    return y + rows * (cellH + 2) + 2;
  },

  // ═══════════════════════════════════════════════════════════════
  //  PDF — PAGES
  // ═══════════════════════════════════════════════════════════════

  /** Page 1 — Couverture + Fiche d'identité du terrain */
  _page1(pdf, session, terrain, mapImg) {
    const L = this._L, C = this._C;
    this._drawPageHeader(pdf, 'Fiche d\'identité du terrain', 'Phase 0 — Identification', 1, this._totalPages ?? 8);
    this._drawPageFooter(pdf, session);

    const yStart = L.BODY_TOP + 2;

    // ── COLONNE GAUCHE : données cadastrales ──
    const xL = L.COL2_X1;
    const wL = L.COL2_W;
    let y = yStart;

    y = this._drawSectionLabel(pdf, xL, y, 'Données cadastrales', wL);

    y = this._drawKVBlock(pdf, xL, y, wL, [
      ['Commune',              terrain.commune ?? '—'],
      ['Code INSEE',           terrain.code_insee ?? '—'],
      ['Section / Parcelle',   `${terrain.section ?? '—'} / ${terrain.parcelle ?? '—'}`],
      ['Contenance',           terrain.contenance_m2 ? `${terrain.contenance_m2} m²` : '—'],
      ['Intercommunalité',     terrain.intercommunalite ?? '—'],
      ['Altitude NGR',         terrain.altitude_ngr != null ? `${terrain.altitude_ngr} m` : '—'],
      ['Adresse',              terrain.adresse ?? '—'],
    ]);

    y += 4;

    // Coordonnées
    y = this._drawSectionLabel(pdf, xL, y, 'Coordonnées', wL);
    y = this._drawKVBlock(pdf, xL, y, wL, [
      ['Latitude',  terrain.lat ? `${parseFloat(terrain.lat).toFixed(6)}°` : '—'],
      ['Longitude', terrain.lng ? `${parseFloat(terrain.lng).toFixed(6)}°` : '—'],
      ['Datum',     'WGS 84 — RGR 92'],
    ]);

    y += 6;

    // Carte de situation miniature (si pas de mapImg)
    if (!mapImg) {
      const card = this._drawCard(pdf, xL, y, wL, 40, { accent: C.muted });
      pdf.setFont('times', 'italic');
      pdf.setFontSize(8);
      pdf.setTextColor(...C.muted);
      pdf.text('Carte de situation non disponible', card.x + card.w / 2, card.y + card.h / 2, { align: 'center' });
    }

    // ── COLONNE DROITE : carte ──
    const xR = L.COL2_X2;
    const wR = L.COL2_W;
    const mapH = L.BODY_H - 20;

    if (mapImg) {
      // Cadre carte
      pdf.setDrawColor(...C.border);
      pdf.setLineWidth(0.3);
      pdf.rect(xR, yStart, wR, mapH);

      try {
        pdf.addImage(mapImg, 'PNG', xR + 0.5, yStart + 0.5, wR - 1, mapH - 1);
      } catch (e) {
        console.warn('[PDF] Map image error:', e);
      }

      // Nord + échelle sur la carte
      this._drawNorthArrow(pdf, xR + wR - 10, yStart + 6, 7);

      // Échelle approximative (estimation depuis la contenance)
      const sideM = Math.sqrt(parseFloat(terrain.contenance_m2) || 400);
      const visibleMeters = sideM * 4;
      this._drawScaleBar(pdf, xR + 4, yStart + mapH - 10, visibleMeters, Math.min(wR * 0.4, 50));

      // Légende sous la carte
      pdf.setFont('courier', 'normal');
      pdf.setFontSize(5.5);
      pdf.setTextColor(...C.muted);
      pdf.text('CARTE DE SITUATION — Source : IGN / Mapbox', xR + wR / 2, yStart + mapH + 4, { align: 'center' });
    }
  },

  /** Page 2 — Topographie & Géologie (Phases 1 + 2) */
  _page2(pdf, session, terrain) {
    const L = this._L, C = this._C;
    this._drawPageHeader(pdf, 'Site — Topographie & Géologie', 'Phases 1 + 2', 2, this._totalPages ?? 8);
    this._drawPageFooter(pdf, session);

    const p1 = session?.getPhase?.(1)?.data ?? {};
    const p2 = session?.getPhase?.(2)?.data ?? {};
    const yStart = L.BODY_TOP + 2;

    // ── COLONNE GAUCHE : Topographie ──
    const xL = L.COL2_X1, wL = L.COL2_W;
    let yL = yStart;

    yL = this._drawSectionLabel(pdf, xL, yL, 'Topographie & Microclimat', wL);

    yL = this._drawKVBlock(pdf, xL, yL, wL, [
      ['Pente moyenne',       terrain.pente_moy_pct != null ? `${terrain.pente_moy_pct} %` : '—'],
      ['Orientation',         terrain.orientation ?? terrain.orientation_terrain ?? '—'],
      ['Alt. min DEM',        terrain.alt_min_dem != null ? `${terrain.alt_min_dem} m NGR` : '—'],
      ['Alt. max DEM',        terrain.alt_max_dem != null ? `${terrain.alt_max_dem} m NGR` : '—'],
      ['Dénivelé',            (terrain.denivele ?? terrain.denivele_m) != null ? `${terrain.denivele ?? Math.round(terrain.denivele_m)} m` : '—'],
      ['Zone climatique',     terrain.zone_climatique ?? terrain.zone_climatique_nom ?? '—'],
      ['Zone RTAA',           terrain.zone_rtaa ?? '—'],
      ['Zone pluvio.',        terrain.zone_pluviometrique ?? terrain.zone_pluvio ?? '—'],
      ['Station météo',       terrain.station_meteo ?? '—'],
    ]);

    yL += 6;

    // Ravine
    yL = this._drawSectionLabel(pdf, xL, yL, 'Hydrographie', wL);
    yL = this._drawKVBlock(pdf, xL, yL, wL, [
      ['Ravine',       terrain.nom_ravine ?? '—'],
      ['Distance',     terrain.distance_ravine_m != null ? `${terrain.distance_ravine_m} m` : '—'],
    ]);

    yL += 6;

    // Snap carte avec ligne de coupe transversale
    if (this._visuals?.profileMapSnap) {
      const snapH = 50;
      if (yL + snapH + 6 < L.BODY_BOT) {
        const card = this._drawCard(pdf, xL, yL, wL, snapH, { accent: C.accent });
        let cy = card.y;
        pdf.setFont('courier', 'bold');
        pdf.setFontSize(6);
        pdf.setTextColor(...C.accent);
        pdf.text('COUPE TRANSVERSALE — VUE CARTE', card.x, cy);
        cy += 4;
        try {
          pdf.addImage(this._visuals.profileMapSnap, 'PNG', card.x, cy, card.w, snapH - (cy - card.y) - 2);
        } catch (e) { console.warn('[PDF] Profile map snap error:', e); }
        yL += snapH + 5;
      }
    }

    // Profil altimétrique — image capturée ou dessin simplifié
    if (this._visuals?.profileChart || p1.profile_data || p1.profile_length_m) {
      const cardH = this._visuals?.profileChart ? 70 : 55;
      const card = this._drawCard(pdf, xL, yL, wL, cardH, { accent: C.accent });
      let cy = card.y;
      pdf.setFont('courier', 'bold');
      pdf.setFontSize(6);
      pdf.setTextColor(...C.accent);
      pdf.text('PROFIL ALTIMETRIQUE', card.x, cy);
      cy += 5;

      if (p1.profile_length_m) {
        pdf.setFont('times', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(...C.ink);
        pdf.text(`Longueur du profil : ${p1.profile_length_m} m`, card.x, cy);
        cy += 5;
      }

      // Image Chart.js capturée (priorité) ou dessin vectoriel simplifié
      if (this._visuals?.profileChart) {
        const imgH = cardH - (cy - card.y) - 4;
        try {
          pdf.addImage(this._visuals.profileChart, 'PNG', card.x, cy, card.w, imgH);
        } catch (e) { console.warn('[PDF] Profile chart image error:', e); }
      } else if (p1.profile_data && typeof p1.profile_data === 'object') {
        const pts = Array.isArray(p1.profile_data) ? p1.profile_data : Object.values(p1.profile_data);
        if (pts.length > 1) {
          const altitudes = pts.map(p => p.alt ?? p.y ?? p[1] ?? 0);
          const minAlt = Math.min(...altitudes);
          const maxAlt = Math.max(...altitudes);
          const range = maxAlt - minAlt || 1;
          const graphW = card.w - 10;
          const graphH = 30;
          const gx = card.x + 5;
          const gy = cy + 2;

          pdf.setDrawColor(...C.border);
          pdf.setLineWidth(0.2);
          pdf.line(gx, gy, gx, gy + graphH);
          pdf.line(gx, gy + graphH, gx + graphW, gy + graphH);

          pdf.setDrawColor(...C.accent);
          pdf.setLineWidth(0.5);
          for (let i = 1; i < altitudes.length; i++) {
            const x1 = gx + ((i - 1) / (altitudes.length - 1)) * graphW;
            const x2 = gx + (i / (altitudes.length - 1)) * graphW;
            const y1 = gy + graphH - ((altitudes[i - 1] - minAlt) / range) * graphH;
            const y2 = gy + graphH - ((altitudes[i] - minAlt) / range) * graphH;
            pdf.line(x1, y1, x2, y2);
          }

          pdf.setFont('courier', 'normal');
          pdf.setFontSize(4.5);
          pdf.setTextColor(...C.muted);
          pdf.text(`${maxAlt.toFixed(0)} m`, gx - 2, gy + 2, { align: 'right' });
          pdf.text(`${minAlt.toFixed(0)} m`, gx - 2, gy + graphH, { align: 'right' });
        }
      }
    }

    // Terrain SVG ou aéraulique overlay (si capturé)
    if (this._visuals?.terrainSvg || this._visuals?.aeroOverlay) {
      const svgImg = this._visuals.terrainSvg ?? this._visuals.aeroOverlay;
      yL += (this._visuals?.profileChart ? 75 : 60);
      if (yL + 45 < L.BODY_BOT) {
        const card = this._drawCard(pdf, xL, yL, wL, 40, { accent: C.muted });
        pdf.setFont('courier', 'bold');
        pdf.setFontSize(6);
        pdf.setTextColor(...C.muted);
        pdf.text('COUPE TERRAIN', card.x, card.y);
        try {
          pdf.addImage(svgImg, 'PNG', card.x, card.y + 4, card.w, 34);
        } catch (e) { console.warn('[PDF] Terrain SVG error:', e); }
      }
    }

    // ── COLONNE DROITE : Géologie ──
    const xR = L.COL2_X2, wR = L.COL2_W;
    let yR = yStart;

    yR = this._drawSectionLabel(pdf, xR, yR, 'Géologie & Géotechnique', wR);

    // Type géologique avec badge
    pdf.setFont('courier', 'normal');
    pdf.setFontSize(7);
    pdf.setTextColor(...C.muted);
    pdf.text('Type géologique', xR, yR);

    const geoTypes = {
      basalte_recent: 'Basalte récent',
      basalte_ancien: 'Basalte ancien',
      pahoehoe: 'Pahoehoe',
      aa_scories: 'Aa / Scories',
      alluvions: 'Alluvions',
      remblai: 'Remblai',
      indetermine: 'Indéterminé',
    };
    const geoLabel = geoTypes[terrain.geologie_type] ?? terrain.geologie_type ?? '—';

    pdf.setFont('times', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(...C.ink);
    pdf.text(geoLabel, xR, yR + 6);
    yR += 14;

    yR = this._drawKVBlock(pdf, xR, yR, wR, [
      ['Remblai',               { non: 'Non', possible: 'Possible', oui: 'Oui' }[terrain.remblai] ?? '—'],
      ['Étude géotechnique',    { non: 'Non requise', g1: 'G1 requise', recommande: 'Recommandée' }[terrain.geotech] ?? '—'],
      ['Captage < 100 m',      { non: 'Non', oui: 'Oui', inconnu: 'Inconnu' }[terrain.captage] ?? '—'],
    ]);

    yR += 6;
    yR = this._drawSectionLabel(pdf, xR, yR, 'Dispositions constructives', wR);

    yR = this._drawKVBlock(pdf, xR, yR, wR, [
      ['Chaînages horizontaux', terrain.chainages_hz ? 'Oui' : 'Non / —'],
      ['Chaînages verticaux',   terrain.chainages_vt ? 'Oui' : 'Non / —'],
      ['Fondations spéciales',  terrain.fondations_special ? 'Oui' : 'Non / —'],
    ]);

    yR += 8;

    // Schéma coupe géologique simplifié
    const geoCard = this._drawCard(pdf, xR, yR, wR, 70, { accent: C.warning });
    let gy = geoCard.y;

    pdf.setFont('courier', 'bold');
    pdf.setFontSize(6);
    pdf.setTextColor(...C.warning);
    pdf.text('COUPE SCHÉMATIQUE', geoCard.x, gy);
    gy += 6;

    // Dessin simplifié couches géologiques
    const layerW = geoCard.w - 4;
    const layerX = geoCard.x + 2;
    const layers = [
      { label: 'Sol végétal', h: 8,  color: [160, 140, 100] },
      { label: 'Altérite',    h: 12, color: [190, 170, 130] },
      { label: geoLabel,      h: 25, color: [140, 140, 150] },
    ];

    let ly = gy;
    for (const layer of layers) {
      pdf.setFillColor(...layer.color);
      pdf.rect(layerX, ly, layerW, layer.h, 'F');
      pdf.setDrawColor(...C.ink);
      pdf.setLineWidth(0.15);
      pdf.rect(layerX, ly, layerW, layer.h);

      pdf.setFont('courier', 'normal');
      pdf.setFontSize(5.5);
      pdf.setTextColor(...C.white);
      pdf.text(layer.label, layerX + 3, ly + layer.h / 2 + 1.5);
      ly += layer.h;
    }

    // Échelle verticale
    this._drawScaleBar(pdf, layerX, ly + 4, 5, 20);
  },

  /** Page 3 — Risques & Réglementation PLU (Phases 3 + 4) */
  _page3(pdf, session, terrain) {
    const L = this._L, C = this._C;
    this._drawPageHeader(pdf, 'Risques naturels & Réglementation', 'Phases 3 + 4', 3, this._totalPages ?? 8);
    this._drawPageFooter(pdf, session);

    const p3 = session?.getPhase?.(3)?.data ?? {};
    const p4 = session?.getPhase?.(4)?.data ?? {};
    const yStart = L.BODY_TOP + 2;

    // ── COLONNE GAUCHE : Risques ──
    const xL = L.COL2_X1, wL = L.COL2_W;
    let yL = yStart;

    yL = this._drawSectionLabel(pdf, xL, yL, 'Risques naturels — PPRN', wL);

    // Zone PPRN en gros
    const zoneColors = {
      R1: 'danger', R2: 'danger', B1: 'warning', B2: 'warning',
      J: 'warning', W: 'success',
    };
    const zoneDescriptions = {
      R1: 'Rouge fort — Inconstructible',
      R2: 'Rouge — Inconstructible',
      B1: 'Bleu fort — Constructible sous conditions strictes',
      B2: 'Bleu — Constructible sous conditions',
      J:  'Jaune — Constructible avec prescriptions',
      W:  'Blanc — Hors zone réglementée',
    };

    const zone = p3.zone_pprn ?? '—';
    if (zone !== '—') {
      const level = zoneColors[zone] ?? 'muted';
      const card = this._drawCard(pdf, xL, yL, wL, 18, { accent: C[level] ?? C.muted });
      pdf.setFont('times', 'bold');
      pdf.setFontSize(14);
      pdf.setTextColor(...(C[level] ?? C.ink));
      pdf.text(`Zone ${zone}`, card.x, card.y + 5);
      pdf.setFont('times', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(...C.text2);
      pdf.text(zoneDescriptions[zone] ?? '', card.x, card.y + 11);
      yL += 22;
    }

    yL += 2;
    yL = this._drawKVBlock(pdf, xL, yL, wL, [
      ['Cote réf. NGR',    p3.cote_reference_ngr != null ? `${p3.cote_reference_ngr} m NGR` : '—'],
      ['Simulation crue',  p3.simulateur_flood_m != null ? `+${p3.simulateur_flood_m} m` : '—'],
      ['Zone vent RTAA',   p3.zone_rtaa_vent ?? '—'],
    ]);

    yL += 6;
    yL = this._drawSectionLabel(pdf, xL, yL, 'Sécurité incendie — SDIS 974', wL);

    const hydrantLevel = p3.hydrant_present === 'oui' ? 'success' : p3.hydrant_present === 'non' ? 'danger' : 'warning';
    const sdisLevel = p3.acces_sdis === 'oui' ? 'success' : p3.acces_sdis === 'non' ? 'danger' : 'warning';

    yL = this._drawKVBlock(pdf, xL, yL, wL, [
      ['Hydrant < 150 m',  { oui: 'Oui ✓', non: 'Non ✗', verif: 'À vérifier' }[p3.hydrant_present] ?? '—'],
      ['Accès SDIS',       { oui: 'Conforme ✓', non: 'Non conforme ✗', verif: 'À vérifier' }[p3.acces_sdis] ?? '—'],
    ]);

    yL += 8;

    // Carte de risque légende
    yL = this._drawSectionLabel(pdf, xL, yL, 'Légende PPRN', wL);
    const legendItems = [
      { color: [200, 40, 40],  label: 'R1 / R2 — Inconstructible' },
      { color: [240, 180, 50], label: 'B1 / B2 — Constructible sous conditions' },
      { color: [255, 220, 80], label: 'J — Prescriptions' },
      { color: [220, 240, 220], label: 'W — Hors zone' },
    ];
    for (const item of legendItems) {
      pdf.setFillColor(...item.color);
      pdf.rect(xL, yL - 2.5, 4, 3, 'F');
      pdf.setDrawColor(...C.border);
      pdf.setLineWidth(0.15);
      pdf.rect(xL, yL - 2.5, 4, 3);
      pdf.setFont('times', 'normal');
      pdf.setFontSize(7);
      pdf.setTextColor(...C.text2);
      pdf.text(item.label, xL + 6, yL);
      yL += 5;
    }

    // ── COLONNE DROITE : PLU ──
    const xR = L.COL2_X2, wR = L.COL2_W;
    let yR = yStart;

    yR = this._drawSectionLabel(pdf, xR, yR, 'Réglementation PLU & RTAA DOM', wR);

    // Zone PLU en gros
    const zonePlu = terrain.zone_plu ?? p4.zone_plu ?? '—';
    if (zonePlu !== '—') {
      const pluColors = {
        UA: C.accent, UB: C.accent, UC: C.accent,
        AU: C.warning, AUs: C.warning,
        N: C.success, A: C.success,
      };
      const pluDesc = {
        UA: 'Urbaine dense',
        UB: 'Urbaine résidentielle',
        UC: 'Urbaine périphérique',
        AU: 'À urbaniser',
        AUs: 'À urbaniser strict',
        N: 'Naturelle',
        A: 'Agricole',
      };

      const card = this._drawCard(pdf, xR, yR, wR, 14, { accent: pluColors[zonePlu] ?? C.accent });
      pdf.setFont('times', 'bold');
      pdf.setFontSize(13);
      pdf.setTextColor(...C.ink);
      pdf.text(`Zone ${zonePlu}`, card.x, card.y + 4);
      pdf.setFont('times', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(...C.text2);
      pdf.text(pluDesc[zonePlu] ?? '', card.x + 40, card.y + 4);
      yR += 18;
    }

    yR += 2;
    yR = this._drawKVBlock(pdf, xR, yR, wR, [
      ['Hauteur max',       p4.hauteur_max_m ? `${p4.hauteur_max_m} m` : '—'],
      ['Emprise sol max',   p4.emprise_sol_max_pct ? `${p4.emprise_sol_max_pct} %` : '—'],
      ['ABF',               { non: 'Non', oui: 'Oui — Périmètre ABF', verif: 'À vérifier' }[p4.abf] ?? '—'],
      ['OAP',               { non: 'Non', oui: 'Oui', inconnu: 'Inconnu' }[p4.oap] ?? '—'],
      ['Servitude HT',      { non: 'Non', oui: 'Oui — Ligne HT' }[p4.sup_ht] ?? '—'],
    ]);

    yR += 6;

    // ── Schéma des reculs coté ──
    yR = this._drawSectionLabel(pdf, xR, yR, 'Reculs réglementaires', wR);

    // Tableau des reculs
    yR = this._drawKVBlock(pdf, xR, yR, wR, [
      ['Voie principale',   p4.recul_voie_principale_m ? `${p4.recul_voie_principale_m} m` : '—'],
      ['Voie secondaire',   p4.recul_voie_secondaire_m ? `${p4.recul_voie_secondaire_m} m` : '—'],
      ['Limite séparative', p4.recul_limite_sep_m ? `${p4.recul_limite_sep_m} m` : '—'],
      ['Fond de parcelle',  p4.recul_fond_m ? `${p4.recul_fond_m} m` : '—'],
    ]);

    yR += 4;

    // Schéma graphique des reculs — image capturée (priorité) ou dessin vectoriel
    if (this._visuals?.reculsCanvas) {
      const imgH = Math.min(L.BODY_BOT - yR - 4, 100);
      if (imgH > 30) {
        pdf.setDrawColor(...C.border);
        pdf.setLineWidth(0.2);
        pdf.rect(xR, yR, wR, imgH);
        try {
          pdf.addImage(this._visuals.reculsCanvas, 'PNG', xR + 1, yR + 1, wR - 2, imgH - 2);
        } catch (e) { console.warn('[PDF] Reculs canvas error:', e); }
        pdf.setFont('courier', 'normal');
        pdf.setFontSize(5);
        pdf.setTextColor(...C.muted);
        pdf.text('Schema des reculs — rendu interactif', xR + wR / 2, yR + imgH + 3, { align: 'center' });
      }
    } else {
      const schemaH = Math.min(L.BODY_BOT - yR - 4, 100);
      if (schemaH > 40) {
        this._drawReculsSchema(pdf, xR, yR, wR, schemaH, p4, terrain);
      }
    }
  },

  /** Page 4 — Voisinage & Biodiversité (Phases 5 + 6) */
  _page4(pdf, session, terrain) {
    const L = this._L, C = this._C;
    this._drawPageHeader(pdf, 'Contexte — Voisinage & Biodiversité', 'Phases 5 + 6', 4, this._totalPages ?? 8);
    this._drawPageFooter(pdf, session);

    const p6 = session?.getPhase?.(6)?.data ?? {};
    const yStart = L.BODY_TOP + 2;

    // ── COLONNE GAUCHE : Voisinage & Réseaux ──
    const xL = L.COL2_X1, wL = L.COL2_W;
    let yL = yStart;

    yL = this._drawSectionLabel(pdf, xL, yL, 'Voisinage & Nuisances', wL);

    const polLabels = { non: 'Non', oui: 'Oui — À investiguer', verif: 'À vérifier' };
    yL = this._drawKVBlock(pdf, xL, yL, wL, [
      ['ICPE < 500 m',    polLabels[terrain.icpe] ?? '—'],
      ['BASOL / pollution', polLabels[terrain.basol] ?? '—'],
      ['Bruit',            { aucune: 'Aucune nuisance', faibles: 'Faibles', moderees: 'Modérées', importantes: 'Importantes' }[terrain.bruit] ?? '—'],
      ['Hauteurs voisins', terrain.hauteurs_voisins ?? '—'],
    ]);

    yL += 6;
    yL = this._drawSectionLabel(pdf, xL, yL, 'Réseaux & VRD', wL);

    const reseauIcons = {
      reseau_public: 'Réseau public',
      captage_prive: 'Captage privé',
      inconnu: 'Inconnu',
      collectif: 'Collectif',
      ANC: 'Assainissement non collectif',
      disponible: 'Disponible',
      extension: 'Extension nécessaire',
      groupe: 'Groupe électrogène',
      oui: 'Fibre optique',
      adsl: 'ADSL uniquement',
      zone_blanche: 'Zone blanche',
    };

    yL = this._drawKVBlock(pdf, xL, yL, wL, [
      ['Eau potable',      reseauIcons[terrain.eau_potable] ?? terrain.eau_potable ?? '—'],
      ['Assainissement',   reseauIcons[terrain.assainissement] ?? terrain.assainissement ?? '—'],
      ['Électricité',      reseauIcons[terrain.electricite] ?? terrain.electricite ?? '—'],
      ['Fibre / Internet', reseauIcons[terrain.fibre] ?? terrain.fibre ?? '—'],
    ]);

    yL += 8;

    // Tableau synthétique réseaux
    const card = this._drawCard(pdf, xL, yL, wL, 30, { accent: C.accent });
    let cy = card.y;
    pdf.setFont('courier', 'bold');
    pdf.setFontSize(6);
    pdf.setTextColor(...C.accent);
    pdf.text('SYNTHÈSE DESSERTE', card.x, cy);
    cy += 6;

    const desserte = [
      { label: 'Eau',   ok: terrain.eau_potable === 'reseau_public' },
      { label: 'Assain.', ok: terrain.assainissement === 'collectif' },
      { label: 'Élec.',  ok: terrain.electricite === 'disponible' },
      { label: 'Fibre',  ok: terrain.fibre === 'oui' },
    ];

    let dx = card.x;
    for (const d of desserte) {
      const level = d.ok ? 'success' : 'warning';
      dx = this._drawBadge(pdf, dx, cy, `${d.label}: ${d.ok ? 'OK' : '?'}`, level);
      dx += 2;
    }

    // ── COLONNE DROITE : Biodiversité ──
    const xR = L.COL2_X2, wR = L.COL2_W;
    let yR = yStart;

    yR = this._drawSectionLabel(pdf, xR, yR, 'Biodiversité & Milieu naturel', wR);

    const parcLabels = {
      hors_parc: 'Hors parc', adhesion_500m: 'Zone adhésion < 500 m',
      adhesion: 'Zone d\'adhésion', coeur: 'Cœur de parc',
    };
    const znieffLabels = {
      aucune: 'Aucune', type2_500m: 'Type II < 500 m',
      type1_500m: 'Type I < 500 m', terrain: 'Sur le terrain',
    };
    const tvbLabels = {
      non: 'Non concerné', proche: 'Corridor proche', terrain: 'Sur corridor',
    };

    yR = this._drawKVBlock(pdf, xR, yR, wR, [
      ['Parc National',    parcLabels[p6.parc_situation] ?? p6.parc_situation ?? '—'],
      ['ZNIEFF',           znieffLabels[p6.znieff] ?? p6.znieff ?? '—'],
      ['Trame Verte/Bleue', tvbLabels[p6.tvb] ?? p6.tvb ?? '—'],
      ['Végétation',       p6.vegetation_coverage_pct != null ? `${p6.vegetation_coverage_pct} %` : '—'],
    ]);

    yR += 6;

    // Espèces
    yR = this._drawSectionLabel(pdf, xR, yR, 'Espèces remarquables', wR);

    const especeNames = {
      petrel: 'Pétrel de Barau', papangue: 'Papangue', phelsuma: 'Phelsuma',
      oiseau_blanc: 'Oiseau blanc', flore: 'Flore protégée', aucune: 'Aucune',
    };
    const invasiveNames = {
      longose: 'Longose', lantana: 'Lantana', filaos: 'Filaos',
      raisiniers: 'Raisiniers', ajoncs: 'Ajoncs', aucune_invasive: 'Aucune',
    };

    if (p6.especes_protegees?.length) {
      pdf.setFont('courier', 'normal');
      pdf.setFontSize(6);
      pdf.setTextColor(...C.muted);
      pdf.text('Protégées :', xR, yR);
      let bx = xR + 22;
      for (const sp of p6.especes_protegees) {
        bx = this._drawBadge(pdf, bx, yR, especeNames[sp] ?? sp, 'warning');
      }
      yR += 7;
    }

    if (p6.especes_invasives?.length) {
      pdf.setFont('courier', 'normal');
      pdf.setFontSize(6);
      pdf.setTextColor(...C.muted);
      pdf.text('Invasives :', xR, yR);
      let bx = xR + 22;
      for (const sp of p6.especes_invasives) {
        bx = this._drawBadge(pdf, bx, yR, invasiveNames[sp] ?? sp, 'danger');
      }
      yR += 7;
    }

    yR += 4;
    yR = this._drawKVBlock(pdf, xR, yR, wR, [
      ['Défrichement',     { non: 'Non requis', partiel: 'Partiel', autorisation: 'Autorisation requise' }[p6.defrichement] ?? '—'],
      ['Brise-vent naturel', { oui: 'Oui', non: 'Non' }[p6.brise_vent] ?? '—'],
    ]);
  },

  /** Page 5 — Esquisse & Chantier (Phases 7 + 8) */
  _page5(pdf, session, terrain) {
    const L = this._L, C = this._C;
    this._drawPageHeader(pdf, 'Projet — Esquisse & Chantier', 'Phases 7 + 8', 5, this._totalPages ?? 8);
    this._drawPageFooter(pdf, session);

    const p7 = session?.getPhase?.(7)?.data ?? {};
    const p8 = session?.getPhase?.(8)?.data ?? {};
    const yStart = L.BODY_TOP + 2;

    // ── COLONNE GAUCHE : Esquisse projet ──
    const xL = L.COL2_X1, wL = L.COL2_W;
    let yL = yStart;

    yL = this._drawSectionLabel(pdf, xL, yL, 'Esquisse du projet', wL);

    const structLabels = { maconnerie: 'Maçonnerie', bois: 'Bois', metal: 'Métal', mixte: 'Mixte' };
    const toitLabels = { '4pentes': '4 pentes', '2pentes': '2 pentes', terrasse: 'Terrasse' };

    yL = this._drawKVBlock(pdf, xL, yL, wL, [
      ['Surface plancher', p7.surface_plancher_m2 ? `${p7.surface_plancher_m2} m²` : '—'],
      ['Niveaux',          p7.niveaux ?? '—'],
      ['Gabarit L × l × h', (p7.gabarit_l_m && p7.gabarit_w_m && p7.gabarit_h_m) ?
        `${p7.gabarit_l_m} × ${p7.gabarit_w_m} × ${p7.gabarit_h_m} m` : '—'],
      ['Structure',        structLabels[p7.type_structure] ?? p7.type_structure ?? '—'],
      ['Toiture',          toitLabels[p7.type_toiture] ?? p7.type_toiture ?? '—'],
    ]);

    yL += 6;

    // Snapshot 3D — session (glb_snapshot) ou captures live (terrain3d, bimshow)
    const snapshot3d = p7.glb_snapshot ?? this._visuals?.terrain3d ?? this._visuals?.bimshow ?? null;
    if (snapshot3d) {
      yL = this._drawSectionLabel(pdf, xL, yL, 'Modele 3D — BIMSHOW', wL);
      const imgH = 85;
      pdf.setDrawColor(...C.border);
      pdf.setLineWidth(0.2);
      pdf.rect(xL, yL, wL, imgH);

      try {
        pdf.addImage(snapshot3d, 'PNG', xL + 1, yL + 1, wL - 2, imgH - 2);
      } catch (e) {
        pdf.setFont('times', 'italic');
        pdf.setFontSize(8);
        pdf.setTextColor(...C.muted);
        pdf.text('Apercu 3D non disponible', xL + wL / 2, yL + imgH / 2, { align: 'center' });
      }
      yL += imgH + 4;
    }

    // Wind navigator SVG (si capturé)
    if (this._visuals?.windNav && yL + 55 < L.BODY_BOT) {
      yL = this._drawSectionLabel(pdf, xL, yL, 'Analyse aeraulique multi-echelle', wL);
      const wndH = 50;
      try {
        pdf.addImage(this._visuals.windNav, 'PNG', xL, yL, wL, wndH);
      } catch (e) { console.warn('[PDF] Wind nav error:', e); }
      yL += wndH + 4;
    }

    // Gabarit en plan (schéma simplifié)
    if (p7.gabarit_l_m && p7.gabarit_w_m) {
      yL = this._drawSectionLabel(pdf, xL, yL, 'Gabarit en plan', wL);

      const gL = parseFloat(p7.gabarit_l_m);
      const gW = parseFloat(p7.gabarit_w_m);
      const maxDim = Math.max(gL, gW);
      const schemaW = wL - 30;
      const scale = schemaW / maxDim;
      const bw = gL * scale;
      const bh = gW * scale;
      const bx = xL + (wL - bw) / 2;
      const by = yL + 2;

      // Bâtiment
      pdf.setFillColor(230, 240, 250);
      pdf.rect(bx, by, bw, bh, 'F');
      pdf.setDrawColor(...C.accent);
      pdf.setLineWidth(0.5);
      pdf.rect(bx, by, bw, bh);

      // Cotes
      pdf.setFont('courier', 'normal');
      pdf.setFontSize(5.5);
      pdf.setTextColor(...C.ink);
      // Longueur (bas)
      pdf.line(bx, by + bh + 3, bx + bw, by + bh + 3);
      pdf.text(`${gL} m`, bx + bw / 2, by + bh + 6.5, { align: 'center' });
      // Largeur (droite)
      pdf.line(bx + bw + 3, by, bx + bw + 3, by + bh);
      pdf.text(`${gW} m`, bx + bw + 6, by + bh / 2, { align: 'center', angle: 90 });

      // Hauteur annotation
      pdf.setFont('courier', 'normal');
      pdf.setFontSize(5);
      pdf.setTextColor(...C.muted);
      pdf.text(`h = ${p7.gabarit_h_m ?? '?'} m`, bx + bw / 2, by - 2, { align: 'center' });

      // Échelle
      this._drawScaleBar(pdf, bx, by + bh + 10, maxDim, Math.min(bw, 40));
      yL = by + bh + 18;
    }

    // ── COLONNE DROITE : Chantier ──
    const xR = L.COL2_X2, wR = L.COL2_W;
    let yR = yStart;

    yR = this._drawSectionLabel(pdf, xR, yR, 'Chantier & Construction', wR);

    const saisonLabels = { hors_cyclone: 'Hors saison cyclonique', cyclone: 'Saison cyclonique' };
    const eauxLabels = { bassin: 'Bassin temporaire', cunettes: 'Cunettes', ponton: 'Ponton', a_definir: 'À définir' };

    yR = this._drawKVBlock(pdf, xR, yR, wR, [
      ['Démarrage',          saisonLabels[p8.saison_demarrage] ?? '—'],
      ['Gestion eaux',       eauxLabels[p8.gestion_eaux_chantier] ?? '—'],
      ['Ravine < 50 m',      { non: 'Non', oui: 'Oui — Vigilance' }[p8.ravine_proche] ?? '—'],
    ]);

    yR += 4;

    // Risques santé
    if (p8.risques_sante) {
      yR = this._drawSectionLabel(pdf, xR, yR, 'Risques santé chantier', wR);
      const risques = {
        leptospirose: 'Leptospirose', dengue: 'Dengue', amiante: 'Amiante',
        plomb: 'Plomb', silicose: 'Silicose', merule: 'Mérule',
      };
      let bx = xR;
      for (const [key, label] of Object.entries(risques)) {
        if (p8.risques_sante[key]) {
          bx = this._drawBadge(pdf, bx, yR, label, 'danger');
        }
      }
      if (bx === xR) {
        this._drawBadge(pdf, bx, yR, 'Aucun identifié', 'success');
      }
      yR += 8;
    }

    // GIEP
    yR += 2;
    yR = this._drawSectionLabel(pdf, xR, yR, 'Gestion des eaux pluviales — GIEP', wR);

    if (p8.giep_mesures?.length) {
      const mesureLabels = {
        toiture_verte: 'Toiture végétalisée', citerne_ep: 'Citerne EP',
        noue_infiltration: 'Noue d\'infiltration', pave_drainant: 'Pavé drainant',
      };
      let bx = xR;
      for (const m of p8.giep_mesures) {
        bx = this._drawBadge(pdf, bx, yR, mesureLabels[m] ?? m, 'success');
        if (bx > xR + wR - 20) { yR += 7; bx = xR; }
      }
      yR += 8;
    }

    // Score GIEP (si calculé dans la session via giep-score.js)
    const giep = session?.getPhase?.(8)?.data?.giep_result ?? null;
    if (giep?.score != null) {
      const scoreCard = this._drawCard(pdf, xR, yR, wR, 35, {
        accent: giep.score >= 70 ? C.success : giep.score >= 40 ? C.warning : C.danger
      });
      let sy = scoreCard.y;

      pdf.setFont('times', 'bold');
      pdf.setFontSize(22);
      pdf.setTextColor(...(giep.score >= 70 ? C.success : giep.score >= 40 ? C.warning : C.danger));
      pdf.text(`${giep.score}`, scoreCard.x, sy + 8);

      pdf.setFont('courier', 'normal');
      pdf.setFontSize(6);
      pdf.setTextColor(...C.muted);
      pdf.text('/ 100  SCORE GIEP', scoreCard.x + 18, sy + 8);

      sy += 14;
      if (giep.debitInit && giep.debitFinal) {
        pdf.setFont('times', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(...C.ink);
        pdf.text(`Débit initial : ${giep.debitInit} L/s → final : ${giep.debitFinal} L/s`, scoreCard.x, sy);
        sy += 5;
      }
      if (giep.reduction_pct) {
        pdf.text(`Réduction : ${giep.reduction_pct} %`, scoreCard.x, sy);
      }
      yR += 40;
    }

    // Accès pompiers
    if (p8.acces_pompiers_states) {
      yR += 2;
      yR = this._drawSectionLabel(pdf, xR, yR, 'Accès pompiers — SDIS 974', wR);

      const criteria = {
        largeur: 'Largeur ≥ 3 m',
        hauteur: 'Hauteur libre ≥ 3.5 m',
        portance: 'Portance 16 t',
        hydrant: 'Hydrant < 150 m',
        degagement: 'Dégagement 8 × 12 m',
      };

      for (const [key, label] of Object.entries(criteria)) {
        const state = p8.acces_pompiers_states[key];
        const level = state === 'ok' ? 'success' : state === 'warn' ? 'warning' : state === 'err' ? 'danger' : 'muted';
        const stateLabel = { ok: '✓', warn: '⚠', err: '✗', na: '—' }[state] ?? '—';

        pdf.setFont('courier', 'normal');
        pdf.setFontSize(6.5);
        pdf.setTextColor(...(C[level] ?? C.muted));
        pdf.text(stateLabel, xR, yR);
        pdf.setTextColor(...C.ink);
        pdf.text(label, xR + 5, yR);
        yR += 5;
      }
    }
  },

  /** Page 6 — Synthèse & Durabilité (Phases 9+10+11+12) */
  _page6(pdf, session, terrain) {
    const L = this._L, C = this._C;
    this._drawPageHeader(pdf, 'Synthèse & Durabilité', 'Phases 9 — 12', 6, this._totalPages ?? 8);
    this._drawPageFooter(pdf, session);

    const p9  = session?.getPhase?.(9)?.data ?? {};
    const p10 = session?.getPhase?.(10)?.data ?? {};
    const p11 = session?.getPhase?.(11)?.data ?? {};
    const p12 = session?.getPhase?.(12)?.data ?? {};
    const yStart = L.BODY_TOP + 2;

    // ── 3 COLONNES ──
    const x1 = L.COL3_X1, x2 = L.COL3_X2, x3 = L.COL3_X3;
    const wC = L.COL3_W;

    // ── COL 1 : Carbone & Énergie ──
    let y1 = yStart;
    y1 = this._drawSectionLabel(pdf, x1, y1, 'Impact carbone & Énergie', wC);

    const structCO2 = { beton: 'Béton', bois_local: 'Bois local', bois_importe: 'Bois importé', acier: 'Acier', biosource: 'Biosourcé' };
    const ventilLabels = { traversante: 'Ventilation traversante', brasseurs: 'Brasseurs d\'air', vmc: 'VMC', clim: 'Climatisation' };

    y1 = this._drawKVBlock(pdf, x1, y1, wC, [
      ['Structure',     structCO2[p9.type_struct] ?? p9.type_struct ?? '—'],
      ['CO₂ / m²',     p9.co2_m2 != null ? `${p9.co2_m2} kgCO₂eq/m²` : '—'],
      ['CO₂ total',    p9.co2_total != null ? `${p9.co2_total} kgCO₂eq` : '—'],
      ['Ventilation',   ventilLabels[p9.ventil] ?? p9.ventil ?? '—'],
    ], { labelW: 35 });

    y1 += 4;

    // ENR
    if (p9.enr_selected?.length) {
      y1 = this._drawSectionLabel(pdf, x1, y1, 'Énergies renouvelables', wC);
      const enrLabels = { pv: 'Photovoltaïque', ecs: 'ECS solaire', pluie: 'Récup. pluie', biosource: 'Biosourcé' };
      let bx = x1;
      for (const e of p9.enr_selected) {
        bx = this._drawBadge(pdf, bx, y1, enrLabels[e] ?? e, 'success');
        if (bx > x1 + wC - 15) { y1 += 7; bx = x1; }
      }
      y1 += 8;
    }

    // Barre CO2 visuelle
    if (p9.co2_m2 != null) {
      y1 += 2;
      const barW = wC - 8;
      const barH = 6;
      const maxCO2 = 800;
      const pct = Math.min(parseFloat(p9.co2_m2) / maxCO2, 1);

      // Fond
      pdf.setFillColor(...C.lightBg);
      pdf.roundedRect(x1, y1, barW, barH, 1, 1, 'F');

      // Barre
      const barColor = pct > 0.6 ? C.danger : pct > 0.3 ? C.warning : C.success;
      pdf.setFillColor(...barColor);
      pdf.roundedRect(x1, y1, barW * pct, barH, 1, 1, 'F');

      // Marqueur
      pdf.setFont('courier', 'normal');
      pdf.setFontSize(5);
      pdf.setTextColor(...C.ink);
      pdf.text(`${p9.co2_m2} kg`, x1 + barW * pct + 2, y1 + 4);

      // Échelle
      pdf.setTextColor(...C.muted);
      pdf.text('0', x1, y1 + barH + 3);
      pdf.text(`${maxCO2} kgCO2eq/m2`, x1 + barW, y1 + barH + 3, { align: 'right' });
      y1 += barH + 8;
    }

    // Graphique ACV capturé (Chart.js phase 9)
    if (this._visuals?.acvChart && y1 + 50 < L.BODY_BOT) {
      y1 = this._drawSectionLabel(pdf, x1, y1, 'Comparatif ACV materiaux', wC);
      const acvH = 45;
      try {
        pdf.addImage(this._visuals.acvChart, 'PNG', x1, y1, wC, acvH);
      } catch (e) { console.warn('[PDF] ACV chart error:', e); }
      y1 += acvH + 4;
    }

    // ── COL 2 : Entretien & Adaptation ──
    let y2 = yStart;
    y2 = this._drawSectionLabel(pdf, x2, y2, 'Entretien & Adaptation', wC);

    const termiteLabels = { integre: 'Traitement intégré', a_prevoir: 'À prévoir', existant: 'Existant' };
    const corrosionLabels = { inox: 'Inox', galva_epoxy: 'Galva + Époxy', non_applicable: 'Non applicable' };

    y2 = this._drawKVBlock(pdf, x2, y2, wC, [
      ['Termites',     termiteLabels[p10.termites_trait] ?? '—'],
      ['Corrosion',    corrosionLabels[p10.corrosion_trait] ?? '—'],
    ], { labelW: 30 });

    y2 += 4;
    y2 = this._drawSectionLabel(pdf, x2, y2, 'Diagnostics requis', wC);

    const diags = [
      { key: 'diag_amiante',   label: 'Amiante' },
      { key: 'diag_termites',  label: 'Termites' },
      { key: 'diag_erp',       label: 'ERP' },
      { key: 'diag_dpe',       label: 'DPE DOM' },
    ];
    let bx2 = x2;
    for (const d of diags) {
      if (p10[d.key]) {
        bx2 = this._drawBadge(pdf, bx2, y2, d.label, 'warning');
      }
    }
    if (bx2 === x2) {
      this._drawBadge(pdf, bx2, y2, 'Aucun', 'muted');
    }
    y2 += 10;

    // ── COL 3 : Fin de vie & Économie circulaire ──
    let y3 = yStart;
    y3 = this._drawSectionLabel(pdf, x3, y3, 'Fin de vie & Éco. circulaire', wC);

    const reverseLabels = { oui: 'Oui — Conception réversible', partiel: 'Partiel', non: 'Non' };
    const filiereLabels = {
      beton_inerte: 'Béton inerte', bois_valorisation: 'Bois valorisation',
      acier_recyclage: 'Acier recyclage', mixte_tri: 'Mixte — tri requis', a_definir: 'À définir',
    };

    y3 = this._drawKVBlock(pdf, x3, y3, wC, [
      ['Réversible',        reverseLabels[p11.reversible] ?? '—'],
      ['Filière déchets',   filiereLabels[p11.filiere_dechets] ?? '—'],
      ['Passeport matériaux', { oui: 'Oui', non: 'Non', moe: 'Par la MOE' }[p11.passeport] ?? '—'],
    ], { labelW: 38 });

    y3 += 4;

    // Matériaux réemploi
    if (p11.materiaux_reemploi?.length) {
      y3 = this._drawSectionLabel(pdf, x3, y3, 'Matériaux réemployables', wC);
      const matLabels = {
        struct_bois: 'Structure bois', menuiseries: 'Menuiseries',
        toiture_tole: 'Toiture tôle', equipements: 'Équipements', parpaings: 'Parpaings',
      };
      let bx = x3;
      for (const m of p11.materiaux_reemploi) {
        bx = this._drawBadge(pdf, bx, y3, matLabels[m] ?? m, 'success');
        if (bx > x3 + wC - 15) { y3 += 7; bx = x3; }
      }
      y3 += 10;
    }

    // ── SECTION PLEINE LARGEUR : Synthèse finale ──
    const ySynth = Math.max(y1, y2, y3) + 8;

    // Filet de séparation
    pdf.setDrawColor(...C.accent);
    pdf.setLineWidth(0.4);
    pdf.line(L.M, ySynth - 4, L.W - L.M, ySynth - 4);

    let yS = ySynth;
    yS = this._drawSectionLabel(pdf, L.M, yS, 'Synthèse générale', L.W - L.M * 2);

    // Commentaire global
    if (p12.commentaire_global) {
      pdf.setFont('times', 'italic');
      pdf.setFontSize(9);
      pdf.setTextColor(...C.ink);
      const lines = pdf.splitTextToSize(p12.commentaire_global, L.W - L.M * 2 - 10);
      pdf.text(lines.slice(0, 6), L.M, yS);
      yS += Math.min(lines.length, 6) * 4.5 + 4;
    }

    if (p12.enseignant) {
      pdf.setFont('courier', 'normal');
      pdf.setFontSize(7);
      pdf.setTextColor(...C.muted);
      pdf.text(`Enseignant référent : ${p12.enseignant}`, L.M, yS);
      yS += 6;
    }

    // QR code session (si capturé)
    if (this._visuals?.qrCode) {
      const qrSize = 22;
      const qrX = L.W - L.M - qrSize;
      const qrY = yS - 2;
      try {
        pdf.addImage(this._visuals.qrCode, 'PNG', qrX, qrY, qrSize, qrSize);
        pdf.setFont('courier', 'normal');
        pdf.setFontSize(4.5);
        pdf.setTextColor(...C.muted);
        pdf.text('QR Session', qrX + qrSize / 2, qrY + qrSize + 3, { align: 'center' });
      } catch (e) { console.warn('[PDF] QR code error:', e); }
    }

    // Plan masse SVG (si capturé, phase 11)
    if (this._visuals?.planMasse && yS + 55 < L.BODY_BOT) {
      const pmW = 80;
      const pmH = 55;
      const pmX = L.W - L.M - pmW - (this._visuals?.qrCode ? 28 : 0);
      try {
        pdf.setDrawColor(...C.border);
        pdf.setLineWidth(0.2);
        pdf.rect(pmX, yS, pmW, pmH);
        pdf.addImage(this._visuals.planMasse, 'PNG', pmX + 0.5, yS + 0.5, pmW - 1, pmH - 1);
        pdf.setFont('courier', 'normal');
        pdf.setFontSize(4.5);
        pdf.setTextColor(...C.muted);
        pdf.text('Plan masse', pmX + pmW / 2, yS + pmH + 3, { align: 'center' });
      } catch (e) { console.warn('[PDF] Plan masse error:', e); }
    }

    // Grille d'avancement
    yS += 2;
    if (yS < L.BODY_BOT - 30) {
      yS = this._drawSectionLabel(pdf, L.M, yS, 'Avancement des phases', L.W - L.M * 2);
      this._drawProgressGrid(pdf, L.M, yS, L.W - L.M * 2, session);
    }
  },

  // ═══════════════════════════════════════════════════════════════
  //  PDF — CAPTURE MAP SNAPSHOTS PAR PHASE
  // ═══════════════════════════════════════════════════════════════

  /** Capture et stocke un snapshot carte lors du changement de phase */
  _captureMapOnPhaseChange(phaseId) {
    const snap = window.TerlabMap?.captureAsDataURL?.();
    if (snap) {
      if (!this._phaseSnaps) this._phaseSnaps = {};
      this._phaseSnaps[phaseId] = snap;
      console.log(`[PDF] Snapshot carte sauvegarde pour phase ${phaseId}`);
    }
  },

  // ═══════════════════════════════════════════════════════════════
  //  PDF — AUDIT REPORT BUILDER
  // ═══════════════════════════════════════════════════════════════

  /** Scanne toutes les phases et construit un rapport d'audit complet */
  _buildAuditReport(session) {
    const meta = window.TERLAB_META;
    if (!meta?.phases) return null;

    const phases = [];
    let totalCompleted = 0;
    let totalRisks = 0;
    const missingCritical = [];

    for (let i = 0; i <= 12; i++) {
      const phaseMeta = meta.phases[i];
      if (!phaseMeta) continue;

      const phaseSession = session?.getPhase?.(i);
      const completed = phaseSession?.completed === true;
      const data = phaseSession?.data ?? {};

      if (completed) totalCompleted++;

      // Champs non renseignes
      const missingFields = [];
      if (phaseMeta.input_fields) {
        for (const field of phaseMeta.input_fields) {
          const val = data[field.id];
          if (val === undefined || val === null || val === '') {
            missingFields.push(field.label);
          }
        }
      }

      // Validations non cochees
      const missingValidations = [];
      if (phaseMeta.validations) {
        const checkedIds = (phaseSession?.validations ?? []);
        for (const v of phaseMeta.validations) {
          if (!checkedIds.includes(v.id)) {
            missingValidations.push(v.texte);
            if (v.bloquant) {
              missingCritical.push({ phase: i, title: phaseMeta.title, texte: v.texte });
            }
          }
        }
      }

      // Risques declares
      const risks = phaseMeta.risques_phase ?? [];
      totalRisks += risks.length;

      // Resume donnees non-vides
      const dataSummary = {};
      for (const [key, val] of Object.entries(data)) {
        if (val !== undefined && val !== null && val !== '' && key !== 'profile_map_snap' && key !== 'glb_base64' && key !== 'glb_snapshot') {
          const strVal = typeof val === 'object' ? JSON.stringify(val).slice(0, 60) : String(val).slice(0, 60);
          dataSummary[key] = strVal;
        }
      }

      phases.push({
        id: i,
        title: phaseMeta.title,
        completed,
        missing_fields: missingFields,
        missing_validations: missingValidations,
        risks,
        hasMapSnap: !!(this._phaseSnaps?.[i]),
        data_summary: dataSummary,
      });
    }

    return {
      phases,
      global: {
        total_phases: 13,
        completed: totalCompleted,
        missing_critical: missingCritical,
        total_risks: totalRisks,
        pct_complete: Math.round((totalCompleted / 13) * 100),
      },
    };
  },

  // ═══════════════════════════════════════════════════════════════
  //  PDF — PAGE 7 : AUDIT & VIGILANCE
  // ═══════════════════════════════════════════════════════════════

  /** Page 7 — Audit documentaire et points de vigilance */
  _pageAudit(pdf, session, terrain) {
    const L = this._L, C = this._C;
    this._drawPageHeader(pdf, 'Audit documentaire & Vigilance', 'Toutes phases', 7, this._totalPages ?? 8);
    this._drawPageFooter(pdf, session);

    const audit = this._buildAuditReport(session);
    if (!audit) return;

    const yStart = L.BODY_TOP + 2;

    // ── COLONNE GAUCHE : Jauge + items critiques ──
    const xL = L.COL2_X1, wL = L.COL2_W;
    let yL = yStart;

    // ── Jauge d'avancement ──
    yL = this._drawSectionLabel(pdf, xL, yL, 'Avancement global', wL);

    const g = audit.global;
    const pctLabel = `${g.completed} / ${g.total_phases} phases completes (${g.pct_complete} %)`;

    pdf.setFont('times', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(...C.ink);
    pdf.text(pctLabel, xL, yL);
    yL += 6;

    // Barre de progression
    const barW = wL - 4;
    const barH = 7;
    pdf.setFillColor(...C.lightBg);
    pdf.roundedRect(xL, yL, barW, barH, 1.5, 1.5, 'F');
    pdf.setDrawColor(...C.borderL);
    pdf.setLineWidth(0.2);
    pdf.roundedRect(xL, yL, barW, barH, 1.5, 1.5);

    const pctFill = g.pct_complete / 100;
    const barColor = pctFill >= 0.75 ? C.success : pctFill >= 0.4 ? C.warning : C.danger;
    if (pctFill > 0) {
      pdf.setFillColor(...barColor);
      pdf.roundedRect(xL, yL, barW * pctFill, barH, 1.5, 1.5, 'F');
    }

    pdf.setFont('courier', 'bold');
    pdf.setFontSize(6);
    pdf.setTextColor(...C.white);
    if (pctFill > 0.15) {
      pdf.text(`${g.pct_complete} %`, xL + barW * pctFill / 2, yL + 4.5, { align: 'center' });
    }
    yL += barH + 6;

    // ── Items critiques manquants ──
    if (g.missing_critical.length > 0) {
      yL = this._drawSectionLabel(pdf, xL, yL, 'Validations critiques manquantes', wL);

      const critCard = this._drawCard(pdf, xL, yL, wL, Math.min(g.missing_critical.length * 8 + 6, 80), { accent: C.danger });
      let cy = critCard.y;

      for (const item of g.missing_critical) {
        if (cy > critCard.y + critCard.h - 2) break;
        // Badge phase
        let bx = critCard.x;
        bx = this._drawBadge(pdf, bx, cy, `P${item.phase}`, 'danger');

        // Texte validation
        pdf.setFont('times', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(...C.ink);
        const truncated = item.texte.length > 65 ? item.texte.slice(0, 62) + '...' : item.texte;
        pdf.text(truncated, bx + 2, cy);
        cy += 8;
      }

      yL += Math.min(g.missing_critical.length * 8 + 6, 80) + 4;
    } else {
      yL = this._drawSectionLabel(pdf, xL, yL, 'Validations critiques', wL);
      this._drawBadge(pdf, xL, yL, 'Toutes les validations bloquantes sont cochees', 'success');
      yL += 10;
    }

    // ── Inventaire des risques ──
    yL += 2;
    yL = this._drawSectionLabel(pdf, xL, yL, `Inventaire des risques (${g.total_risks} declares)`, wL);

    let riskY = yL;
    for (const phase of audit.phases) {
      if (phase.risks.length === 0) continue;
      if (riskY + 10 > L.BODY_BOT) break;

      pdf.setFont('courier', 'bold');
      pdf.setFontSize(6);
      pdf.setTextColor(...C.accent);
      pdf.text(`P${phase.id} ${phase.title}`, xL, riskY);
      riskY += 4;

      let bx = xL;
      for (const risk of phase.risks) {
        if (bx + 30 > xL + wL) { riskY += 7; bx = xL; }
        if (riskY + 5 > L.BODY_BOT) break;
        bx = this._drawBadge(pdf, bx, riskY, risk, 'warning');
      }
      riskY += 8;
    }

    // ── COLONNE DROITE : Donnees manquantes par phase ──
    const xR = L.COL2_X2, wR = L.COL2_W;
    let yR = yStart;

    yR = this._drawSectionLabel(pdf, xR, yR, 'Donnees manquantes par phase', wR);

    for (const phase of audit.phases) {
      if (yR + 6 > L.BODY_BOT) break;

      const nbMissing = phase.missing_fields.length + phase.missing_validations.length;
      const statusLevel = phase.completed ? 'success' : nbMissing > 0 ? (nbMissing > 3 ? 'danger' : 'warning') : 'muted';

      // Fond alterne
      if (phase.id % 2 === 0) {
        pdf.setFillColor(...C.lightBg);
        pdf.rect(xR - 1, yR - 3.5, wR + 2, 6, 'F');
      }

      // Numero + titre
      pdf.setFont('courier', 'bold');
      pdf.setFontSize(6);
      pdf.setTextColor(...(C[statusLevel] ?? C.muted));
      pdf.text(`P${String(phase.id).padStart(2, '0')}`, xR, yR);

      pdf.setFont('times', 'normal');
      pdf.setFontSize(7);
      pdf.setTextColor(...C.ink);
      pdf.text(phase.title.slice(0, 30), xR + 10, yR);

      // Status
      if (phase.completed) {
        this._drawBadge(pdf, xR + wR - 22, yR, 'COMPLET', 'success');
      } else if (nbMissing > 0) {
        this._drawBadge(pdf, xR + wR - 30, yR, `${nbMissing} manquant(s)`, statusLevel);
      } else {
        this._drawBadge(pdf, xR + wR - 25, yR, 'NON DEMARRE', 'muted');
      }

      yR += 6;

      // Detail champs manquants (compact)
      if (phase.missing_fields.length > 0 && yR + phase.missing_fields.length * 4 < L.BODY_BOT) {
        for (const field of phase.missing_fields.slice(0, 5)) {
          pdf.setFont('courier', 'normal');
          pdf.setFontSize(5.5);
          pdf.setTextColor(...C.muted);
          pdf.text(`  - ${field.slice(0, 50)}`, xR + 4, yR);
          yR += 4;
        }
        if (phase.missing_fields.length > 5) {
          pdf.setFont('courier', 'normal');
          pdf.setFontSize(5);
          pdf.setTextColor(...C.muted);
          pdf.text(`  + ${phase.missing_fields.length - 5} autre(s)...`, xR + 4, yR);
          yR += 4;
        }
      }

      // Detail validations manquantes (compact)
      if (phase.missing_validations.length > 0 && yR + phase.missing_validations.length * 4 < L.BODY_BOT) {
        for (const val of phase.missing_validations.slice(0, 3)) {
          pdf.setFont('courier', 'normal');
          pdf.setFontSize(5.5);
          pdf.setTextColor(...C.danger);
          pdf.text(`  ! ${val.slice(0, 50)}`, xR + 4, yR);
          yR += 4;
        }
        if (phase.missing_validations.length > 3) {
          pdf.setFont('courier', 'normal');
          pdf.setFontSize(5);
          pdf.setTextColor(...C.danger);
          pdf.text(`  + ${phase.missing_validations.length - 3} autre(s)...`, xR + 4, yR);
          yR += 4;
        }
      }

      yR += 2;
    }

    // ── Snapshots carte disponibles (resume en bas de colonne droite) ──
    if (yR + 20 < L.BODY_BOT) {
      yR += 4;
      yR = this._drawSectionLabel(pdf, xR, yR, 'Snapshots carte disponibles', wR);
      let bx = xR;
      for (const phase of audit.phases) {
        if (bx + 18 > xR + wR) { yR += 7; bx = xR; }
        if (yR + 5 > L.BODY_BOT) break;
        const level = phase.hasMapSnap ? 'success' : 'muted';
        bx = this._drawBadge(pdf, bx, yR, `P${phase.id}`, level);
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════
  //  PDF — CAPTURE VISUELS & ENCODAGE
  // ═══════════════════════════════════════════════════════════════

  /** Convertit un SVG DOM en dataURL PNG (rasterisation) */
  async _svgToDataURL(svgEl, w = 800, h = 600) {
    return new Promise(resolve => {
      try {
        const clone = svgEl.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        if (!clone.getAttribute('width'))  clone.setAttribute('width', w);
        if (!clone.getAttribute('height')) clone.setAttribute('height', h);
        const data = new XMLSerializer().serializeToString(clone);
        const blob = new Blob([data], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width  = img.naturalWidth  || w;
          c.height = img.naturalHeight || h;
          c.getContext('2d').drawImage(img, 0, 0);
          resolve(c.toDataURL('image/png'));
          URL.revokeObjectURL(url);
        };
        img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
        img.src = url;
      } catch { resolve(null); }
    });
  },

  /** Capture un canvas HTML par son ID */
  _canvasToDataURL(id) {
    try {
      const el = document.getElementById(id);
      return el?.width > 0 ? el.toDataURL('image/png') : null;
    } catch { return null; }
  },

  /** Capture tous les visuels disponibles avant génération PDF */
  async _captureVisuals() {
    const v = {};

    // Carte Mapbox (phase 0)
    v.map = window.TerlabMap?.captureAsDataURL?.() ?? null;

    // Snap carte avec ligne de coupe (phase 1, sauvé en session)
    const p1Snap = SessionManager.getPhase(1)?.data?.profile_map_snap;
    if (p1Snap) v.profileMapSnap = p1Snap;

    // Profil altimétrique Chart.js (phase 1)
    v.profileChart = this._canvasToDataURL('profile-chart');

    // Terrain SVG (phase 1)
    const terrainSvg = document.getElementById('terrainSVG');
    if (terrainSvg) v.terrainSvg = await this._svgToDataURL(terrainSvg, 600, 400);

    // Reculs canvas (phase 4)
    v.reculsCanvas = this._canvasToDataURL('reculs-canvas');

    // Vue 3D terrain (phase 7)
    v.terrain3d = window.Terrain3DViewer?.capture?.() ?? null;

    // Snapshot BIMShow Three.js (phase 7)
    const bimCanvas = document.querySelector('.tv-canvas');
    if (bimCanvas) { try { v.bimshow = bimCanvas.toDataURL('image/png'); } catch { /* GL context */ } }

    // ACV chart carbone (phase 9)
    v.acvChart = this._canvasToDataURL('acv-chart');

    // QR code (phase 12)
    v.qrCode = this._canvasToDataURL('qr-canvas');

    // Plan masse SVG (phase 11)
    const planSvg = document.getElementById('p11-svg');
    if (planSvg) v.planMasse = await this._svgToDataURL(planSvg, 1000, 700);

    // Wind navigator SVG (phase 7)
    const windSvg = document.querySelector('#p07-wind-navigator svg');
    if (windSvg) v.windNav = await this._svgToDataURL(windSvg, 600, 600);

    // Aéraulique overlay SVG (phase 1)
    const aeroSvg = document.getElementById('p01-aero-overlay');
    if (aeroSvg) v.aeroOverlay = await this._svgToDataURL(aeroSvg, 600, 300);

    // Capture generique : tout canvas Chart.js present dans le DOM
    v.chartCanvases = {};
    document.querySelectorAll('canvas').forEach(canvas => {
      try {
        const chartInstance = Chart?.getChart?.(canvas);
        if (chartInstance && canvas.id && canvas.width > 0) {
          v.chartCanvases[canvas.id] = canvas.toDataURL('image/png');
        }
      } catch { /* pas de Chart.js ou contexte GL */ }
    });

    // Capture couches GeoJSON custom (SVG combiné)
    try {
      const gjSvgEl = window.GeoJsonLayerService?.toSVGElement?.({ width: 800, height: 600 });
      if (gjSvgEl) v.customGeoJsonLayers = await this._svgToDataURL(gjSvgEl, 800, 600);
    } catch (e) { console.warn('[PDF] GeoJSON layers SVG error:', e); }

    // Capture generique : tout SVG present dans les phases
    v.svgDiagrams = {};
    const svgEls = document.querySelectorAll('svg[id]');
    for (const svgEl of svgEls) {
      try {
        if (svgEl.id && svgEl.getBBox().width > 0) {
          const snap = await this._svgToDataURL(svgEl, 600, 400);
          if (snap) v.svgDiagrams[svgEl.id] = snap;
        }
      } catch { /* SVG vide ou inaccessible */ }
    }

    // Integrer les snapshots de phase stockes precedemment
    v.phaseSnaps = this._phaseSnaps ?? {};

    console.log('[PDF] Visuels captures :', Object.keys(v).filter(k => v[k]).join(', '));
    return v;
  },

  /** Patch pdf.text() — remplace caractères hors WinAnsiEncoding par équivalents sûrs */
  /** Charger polices TTF Unicode pour jsPDF (Standard-14 cassees avec non-ASCII) */
  async _loadUnicodeFont(pdf) {
    // Courier Prime (monospace) + Crimson Text (serif, metriques Times)
    // Fallback : transliteration ASCII si le fetch echoue (mode offline)
    const CDN = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl';
    const FONTS = [
      { url: `${CDN}/courierprime/CourierPrime-Regular.ttf`,    name: 'CourierPrime', style: 'normal' },
      { url: `${CDN}/courierprime/CourierPrime-Bold.ttf`,       name: 'CourierPrime', style: 'bold' },
      { url: `${CDN}/courierprime/CourierPrime-Italic.ttf`,     name: 'CourierPrime', style: 'italic' },
      { url: `${CDN}/courierprime/CourierPrime-BoldItalic.ttf`, name: 'CourierPrime', style: 'bolditalic' },
      { url: `${CDN}/crimsontext/CrimsonText-Regular.ttf`,     name: 'CrimsonText',  style: 'normal' },
      { url: `${CDN}/crimsontext/CrimsonText-Bold.ttf`,        name: 'CrimsonText',  style: 'bold' },
      { url: `${CDN}/crimsontext/CrimsonText-Italic.ttf`,      name: 'CrimsonText',  style: 'italic' },
      { url: `${CDN}/crimsontext/CrimsonText-BoldItalic.ttf`,  name: 'CrimsonText',  style: 'bolditalic' },
    ];

    let loaded = 0;
    for (const f of FONTS) {
      try {
        const resp = await fetch(f.url);
        if (!resp.ok) continue;
        const buf = await resp.arrayBuffer();
        // jsPDF 2.5.1 addFileToVFS attend une string binaire
        const bytes = new Uint8Array(buf);
        let binaryStr = '';
        for (let i = 0; i < bytes.length; i++) binaryStr += String.fromCharCode(bytes[i]);
        const filename = f.url.split('/').pop();
        pdf.addFileToVFS(filename, binaryStr);
        pdf.addFont(filename, f.name, f.style);
        loaded++;
      } catch { /* offline — fallback transliteration */ }
    }

    if (loaded > 0) {
      // Intercepter setFont pour mapper 'courier'→CourierPrime, 'times'→CrimsonText
      const origSetFont = pdf.setFont.bind(pdf);
      pdf.setFont = function(family, style) {
        if (family === 'courier') family = 'CourierPrime';
        if (family === 'times')   family = 'CrimsonText';
        return origSetFont(family, style);
      };
      console.info(`[PDF] ${loaded} polices Unicode chargees — rendu francais OK`);
    } else {
      // Fallback : transliteration ASCII (polices Unicode non disponibles)
      console.warn('[PDF] Polices Unicode non disponibles — transliteration ASCII');
      this._patchTextASCII(pdf);
    }
  },

  /** Fallback : transliteration ASCII pour jsPDF Standard-14 (si polices TTF indisponibles) */
  _patchTextASCII(pdf) {
    const orig = pdf.text.bind(pdf);
    const TRANS = {
      '\u00E9':'e','\u00E8':'e','\u00EA':'e','\u00EB':'e', // éèêë
      '\u00C9':'E','\u00C8':'E','\u00CA':'E','\u00CB':'E', // ÉÈÊË
      '\u00E0':'a','\u00E2':'a','\u00E4':'a',               // àâä
      '\u00C0':'A','\u00C2':'A','\u00C4':'A',               // ÀÂÄ
      '\u00F9':'u','\u00FB':'u','\u00FC':'u',               // ùûü
      '\u00D9':'U','\u00DB':'U','\u00DC':'U',               // ÙÛÜ
      '\u00E7':'c','\u00C7':'C',                             // çÇ
      '\u00EE':'i','\u00EF':'i','\u00CE':'I','\u00CF':'I', // îïÎÏ
      '\u00F4':'o','\u00F6':'o','\u00D4':'O','\u00D6':'O', // ôöÔÖ
      '\u00B2':'2','\u00B3':'3','\u00B0':'o',               // ²³°
      '\u00B7':'-','\u2014':'-','\u2013':'-',               // ·—–
      '\u00AB':'<<','\u00BB':'>>',                           // «»
      '\u2018':"'",'\u2019':"'",'\u201C':'"','\u201D':'"', // ''""
      '\u2026':'...','\u20AC':'EUR',                         // …€
      '\u2082':'2','\u2083':'3',                             // ₂₃
      '\u2713':'v','\u2717':'x','\u26A0':'!',               // ✓✗⚠
      '\u2265':'>=','\u2264':'<=',                           // ≥≤
      '\u2192':'->','\u2190':'<-',                           // →←
      '\u2022':'-','\u00A0':' ',                             // •NBSP
    };
    const fix = s => {
      if (typeof s !== 'string') return s;
      let r = '';
      for (const c of s) r += TRANS[c] ?? (c.charCodeAt(0) > 127 ? '?' : c);
      return r;
    };
    pdf.text = function(text, x, y, opts) {
      if (typeof text === 'string') text = fix(text);
      if (Array.isArray(text)) text = text.map(fix);
      return orig(text, x, y, opts);
    };
  },

  // ═══════════════════════════════════════════════════════════════
  //  PDF — ORCHESTRATEUR
  // ═══════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════
  //  MOTEUR DE PHRASES CONTEXTUELLES — rapport-phrases.json
  // ═══════════════════════════════════════════════════════════════

  _phrasesCache: null,

  async _loadPhrases() {
    if (this._phrasesCache) return this._phrasesCache;
    try {
      const resp = await fetch('../data/rapport-phrases.json', { signal: AbortSignal.timeout(3000) });
      if (!resp.ok) return null;
      this._phrasesCache = await resp.json();
      return this._phrasesCache;
    } catch { return null; }
  },

  /**
   * Construit le contexte d'évaluation depuis la session.
   * Toutes les variables disponibles pour les conditions et l'interpolation.
   */
  _buildPhraseContext(session, terrain) {
    const p3  = session?.getPhase?.(3)?.data ?? {};
    const p4  = session?.getPhase?.(4)?.data ?? {};
    const p6  = session?.getPhase?.(6)?.data ?? {};
    const p7  = session?.getPhase?.(7)?.data ?? {};

    const surface = parseFloat(terrain.contenance_m2 ?? terrain.surface_m2 ?? 0);
    const alt     = parseFloat(terrain.altitude_ngr ?? 0);
    const pente   = parseFloat(terrain.pente_pct ?? terrain.pente_estimee_pct ?? 0);
    const hauteur = parseFloat(p4.hauteur_max_m ?? terrain.hauteur_max_m ?? 0);
    const recul   = parseFloat(p4.recul_voie_principale_m ?? 0);
    const permeable = parseFloat(p4.permeable_min_pct ?? terrain.permeable_min_pct ?? 0);
    const scotRang  = parseInt(terrain.scot_rang ?? 0) || 0;
    const scotDMin  = parseFloat(terrain.scot_densite_min ?? 0);
    const scotPctAides = parseFloat(terrain.scot_pct_aides ?? 0);
    const nbLogements  = parseInt(p7.nb_logements ?? terrain.nb_logements ?? 0) || 0;
    const nbAides      = parseInt(p7.nb_logements_aides ?? 0) || 0;
    const densiteProjet = surface > 0 && nbLogements > 0 ? Math.round(nbLogements / (surface / 10000)) : 0;

    return {
      // Valeurs brutes pour interpolation
      commune:       terrain.commune ?? '—',
      adresse:       terrain.adresse ?? '—',
      section:       terrain.section ?? '—',
      parcelle:      terrain.parcelle ?? '—',
      surface_m2:    surface,
      surface_ha:    (surface / 10000).toFixed(2),
      altitude:      alt,
      pente_pct:     pente,
      exposition:    (terrain.exposition ?? terrain.orientation_terrain ?? '').toLowerCase(),
      zone_plu:      p4.zone_plu ?? terrain.zone_plu ?? '',
      zone_plu_type: ((p4.zone_plu ?? terrain.zone_plu_type ?? '').match(/^(AU|U|A|N)/i)?.[1] ?? '').toUpperCase(),
      zone_pprn:     p3.zone_pprn ?? terrain.zone_pprn ?? '',
      zone_rtaa:     terrain.zone_rtaa ?? '',
      cote_vent:     terrain.cote_vent ?? terrain.zone_pluvio ?? '',
      hauteur_max_m: hauteur,
      recul_voie_m:  recul,
      permeable_min_pct: permeable,
      nom_ravine:    terrain.nom_ravine ?? p3.nom_ravine ?? '',
      has_ravine:    !!(terrain.nom_ravine || p3.nom_ravine || p3.has_ravine),
      has_vue_mer:   !!(terrain.vue_mer || terrain.has_vue_mer),
      especes_protegees: !!(p6.especes_protegees || p6.derogation_cnpn),
      petrel_survol: !!(p6.petrel_survol || p6.corridor_petrel),
      plu_en_revision: !!(terrain.plu_en_revision || p4.plu_en_revision),
      scot_rang:     scotRang,
      scot_densite_min: scotDMin,
      scot_pct_aides: scotPctAides,
      scot_capacite_min: parseInt(terrain.scot_capacite_min ?? 0) || 0,
      scot_rang_label: terrain.scot_rang_label ?? '',
      nb_logements:  nbLogements,
      nb_logements_aides: nbAides,
      densite_projet: densiteProjet,
      pct_aides_projet: nbLogements > 0 && nbAides > 0 ? Math.round(nbAides / nbLogements * 100) : 0,
      programme:     terrain.programme ?? p7.programme ?? '',
      capacite_estimee: scotDMin > 0 && surface > 0 ? Math.ceil(surface / 10000 * scotDMin) : '?',

      // Conditions calculées
      densite_projet_lt_scot:  scotDMin > 0 && densiteProjet > 0 && densiteProjet < scotDMin,
      densite_projet_gte_scot: scotDMin > 0 && densiteProjet > 0 && densiteProjet >= scotDMin,
      pct_aides_lt_scot:  scotPctAides > 0 && nbAides > 0 && (nbAides / nbLogements * 100) < scotPctAides,
      pct_aides_gte_scot: scotPctAides > 0 && nbAides > 0 && (nbAides / nbLogements * 100) >= scotPctAides,
    };
  },

  /**
   * Évalue si une condition est satisfaite par le contexte.
   */
  _evalCond(cond, ctx) {
    for (const [key, val] of Object.entries(cond)) {
      if (key === 'always' && val === true) continue;

      // missing: la donnée est absente
      if (key === 'missing') {
        const v = ctx[val];
        if (v !== undefined && v !== null && v !== '' && v !== 0 && v !== false) return false;
        continue;
      }

      // Suffixes de comparaison
      const m = key.match(/^(.+?)_(gte|gt|lte|lt|eq|in)$/);
      if (m) {
        const field = m[1], op = m[2];
        const fieldVal = parseFloat(ctx[field] ?? 0);
        if (op === 'gte' && !(fieldVal >= val)) return false;
        if (op === 'gt'  && !(fieldVal > val))  return false;
        if (op === 'lte' && !(fieldVal <= val)) return false;
        if (op === 'lt'  && !(fieldVal < val))  return false;
        if (op === 'eq'  && ctx[field] != val)   return false;
        if (op === 'in'  && Array.isArray(val) && !val.includes(ctx[field])) return false;
        continue;
      }

      // Valeur directe (booléen, nombre ou string)
      if (typeof val === 'boolean') {
        if (!!ctx[key] !== val) return false;
      } else if (typeof val === 'number') {
        if (Number(ctx[key]) !== val) return false;
      } else if (typeof val === 'string') {
        const ctxVal = String(ctx[key] ?? '').toLowerCase();
        const condVal = val.toLowerCase();
        // Exact match for short values (zone types), startsWith for longer strings
        if (condVal.length <= 3) {
          if (ctxVal !== condVal) return false;
        } else {
          if (ctxVal !== condVal && !ctxVal.startsWith(condVal)) return false;
        }
      }
    }
    return true;
  },

  /**
   * Interpole les {variables} dans un texte.
   */
  _interpolate(text, ctx) {
    return text.replace(/\{(\w+)\}/g, (_, key) => {
      const v = ctx[key];
      if (v === undefined || v === null || v === '') return '—';
      return String(v);
    });
  },

  /**
   * Collecte toutes les phrases applicables pour une section donnée.
   * @returns {Array<{subsection, text}>}
   */
  _collectPhrases(phrases, sectionKey, ctx) {
    const section = phrases[sectionKey];
    if (!section) return [];
    const result = [];
    for (const [subKey, items] of Object.entries(section)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (this._evalCond(item.cond, ctx)) {
          result.push({
            subsection: subKey,
            text: this._interpolate(item.text, ctx),
          });
        }
      }
    }
    return result;
  },

  /**
   * Construit l'analyse complète : commentaires par section,
   * atouts, contraintes, recommandations, données manquantes.
   */
  _buildAnalysis(phrases, ctx) {
    const sections = [
      { key: 'identification', title: 'Identification du terrain' },
      { key: 'topographie',    title: 'Topographie & Microclimat' },
      { key: 'risques',        title: 'Risques naturels' },
      { key: 'plu',            title: 'Réglementation PLU' },
      { key: 'scot',           title: 'SCoT intercommunal' },
      { key: 'programme',      title: 'Programme & Capacité' },
      { key: 'bioclimatique',  title: 'Bioclimatisme & RTAA DOM' },
      { key: 'environnement',  title: 'Environnement' },
      { key: 'operationnel',   title: 'Approche opérationnelle' },
    ];

    const commentary = [];
    for (const s of sections) {
      const items = this._collectPhrases(phrases, s.key, ctx);
      if (items.length) {
        // Séparer données manquantes du reste
        const missing = items.filter(i => i.subsection === 'donnee_manquante');
        const content = items.filter(i => i.subsection !== 'donnee_manquante');
        commentary.push({ ...s, content, missing });
      }
    }

    const atouts        = this._collectPhrases(phrases, 'synthese', ctx).filter(i => i.subsection === 'atouts');
    const contraintes   = this._collectPhrases(phrases, 'synthese', ctx).filter(i => i.subsection === 'contraintes');
    const recommandations = this._collectPhrases(phrases, 'synthese', ctx).filter(i => i.subsection === 'recommandations');

    // Données manquantes globales
    const allMissing = commentary.flatMap(c => c.missing);

    return { commentary, atouts, contraintes, recommandations, allMissing };
  },

  // ═══════════════════════════════════════════════════════════════
  //  PDF — PAGE 8 : ANALYSE & CONCLUSIONS
  // ═══════════════════════════════════════════════════════════════

  _pageAnalyse(pdf, session, terrain, analysis) {
    const L = this._L, C = this._C;
    this._drawPageHeader(pdf, 'Analyse & Conclusions', 'Synthèse TERLAB', 8, 8);
    this._drawPageFooter(pdf, session);

    const yStart = L.BODY_TOP + 2;

    // ── COLONNE GAUCHE : commentaire contextuel ──
    const xL = L.COL2_X1, wL = L.COL2_W;
    let yL = yStart;

    for (const section of analysis.commentary) {
      if (yL > L.BODY_BOT - 20) break;

      yL = this._drawSectionLabel(pdf, xL, yL, section.title, wL);

      for (const item of section.content) {
        if (yL > L.BODY_BOT - 12) break;
        pdf.setFont('times', 'normal');
        pdf.setFontSize(7.5);
        pdf.setTextColor(...C.ink);
        const lines = pdf.splitTextToSize(item.text, wL - 4);
        const needed = lines.length * 3.5;
        if (yL + needed > L.BODY_BOT - 8) break;
        pdf.text(lines, xL + 2, yL);
        yL += needed + 2;
      }

      // Données manquantes pour cette section
      if (section.missing.length > 0) {
        for (const m of section.missing) {
          if (yL > L.BODY_BOT - 10) break;
          pdf.setFont('times', 'italic');
          pdf.setFontSize(7);
          pdf.setTextColor(...C.warning);
          const mLines = pdf.splitTextToSize('⚠ ' + m.text, wL - 8);
          pdf.text(mLines.slice(0, 2), xL + 4, yL);
          yL += mLines.length * 3.5 + 1;
        }
      }

      yL += 3;
    }

    // ── COLONNE DROITE : atouts / contraintes / recommandations / manquants ──
    const xR = L.COL2_X2, wR = L.COL2_W;
    let yR = yStart;

    // ATOUTS
    if (analysis.atouts.length) {
      yR = this._drawSectionLabel(pdf, xR, yR, 'Atouts du terrain', wR);
      const atoutsCard = this._drawCard(pdf, xR, yR, wR,
        Math.min(analysis.atouts.length * 6 + 6, 60), { accent: C.success });
      let ay = atoutsCard.y;
      for (const a of analysis.atouts) {
        if (ay > atoutsCard.y + atoutsCard.h - 3) break;
        pdf.setFont('times', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(...C.success);
        pdf.text('+ ' + a.text, atoutsCard.x, ay);
        ay += 5.5;
      }
      yR += Math.min(analysis.atouts.length * 6 + 6, 60) + 6;
    }

    // CONTRAINTES
    if (analysis.contraintes.length) {
      yR = this._drawSectionLabel(pdf, xR, yR, 'Contraintes identifiées', wR);
      const contrCard = this._drawCard(pdf, xR, yR, wR,
        Math.min(analysis.contraintes.length * 6 + 6, 60), { accent: C.danger });
      let cy = contrCard.y;
      for (const c of analysis.contraintes) {
        if (cy > contrCard.y + contrCard.h - 3) break;
        pdf.setFont('times', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(...C.danger);
        pdf.text('− ' + c.text, contrCard.x, cy);
        cy += 5.5;
      }
      yR += Math.min(analysis.contraintes.length * 6 + 6, 60) + 6;
    }

    // RECOMMANDATIONS
    if (analysis.recommandations.length) {
      yR = this._drawSectionLabel(pdf, xR, yR, 'Recommandations', wR);
      const recoCard = this._drawCard(pdf, xR, yR, wR,
        Math.min(analysis.recommandations.length * 10 + 6, 70), { accent: C.accent });
      let ry = recoCard.y;
      for (const r of analysis.recommandations) {
        if (ry > recoCard.y + recoCard.h - 3) break;
        pdf.setFont('times', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(...C.ink);
        const rLines = pdf.splitTextToSize('→ ' + r.text, recoCard.w - 2);
        pdf.text(rLines.slice(0, 2), recoCard.x, ry);
        ry += rLines.length * 3.5 + 2;
      }
      yR += Math.min(analysis.recommandations.length * 10 + 6, 70) + 6;
    }

    // DONNÉES MANQUANTES
    if (analysis.allMissing.length) {
      yR = this._drawSectionLabel(pdf, xR, yR, `Données manquantes (${analysis.allMissing.length})`, wR);
      let my = yR;
      for (const m of analysis.allMissing) {
        if (my > L.BODY_BOT - 8) break;
        let bx = xR;
        bx = this._drawBadge(pdf, bx, my, m.subsection ?? '?', 'warning');
        pdf.setFont('times', 'italic');
        pdf.setFontSize(6.5);
        pdf.setTextColor(...C.text2);
        const mText = m.text.length > 70 ? m.text.slice(0, 67) + '...' : m.text;
        pdf.text(mText, bx + 2, my);
        my += 7;
      }
    }

    // ── POTENTIEL : barre en bas de page ──
    const yBottom = L.BODY_BOT - 15;
    if (yBottom > Math.max(yL, yR) + 5) {
      pdf.setDrawColor(...C.accent);
      pdf.setLineWidth(0.4);
      pdf.line(L.M, yBottom - 4, L.W - L.M, yBottom - 4);

      let yP = yBottom;
      yP = this._drawSectionLabel(pdf, L.M, yP, 'Potentiel estimé', L.W - L.M * 2);

      const ctx = this._buildPhraseContext(session, terrain);

      const items = [
        ['Rang SCoT',        ctx.scot_rang ? `Rang ${ctx.scot_rang} — ${ctx.scot_rang_label}` : '—'],
        ['Densité min SCoT', ctx.scot_densite_min ? `${ctx.scot_densite_min} lgts/ha` : '—'],
        ['Surface opération', ctx.surface_m2 ? `${ctx.surface_m2} m² (${ctx.surface_ha} ha)` : '—'],
        ['Capacité min SCoT', ctx.scot_capacite_min ? `${ctx.scot_capacite_min} logements` : '—'],
        ['Pente',             ctx.pente_pct ? `${ctx.pente_pct}%` : '—'],
        ['Zone PLU',          ctx.zone_plu || '—'],
        ['Zone PPR',          ctx.zone_pprn || '—'],
        ['Zone RTAA',         ctx.zone_rtaa ? `Zone ${ctx.zone_rtaa}` : '—'],
      ];

      // 2 rangées de 4 KV côte à côte
      const kvW = (L.W - L.M * 2) / 4 - 2;
      for (let i = 0; i < items.length; i++) {
        const col = i % 4;
        const row = Math.floor(i / 4);
        const kx = L.M + col * (kvW + 2.5);
        const ky = yP + row * 6;
        this._drawKV(pdf, kx, ky, items[i][0], items[i][1], { labelW: 32, fontSize: 7, lineH: 5 });
      }
    }
  },

  async generatePDF() {
    const session = window.SessionManager;
    const terrain = session?.getTerrain?.() ?? {};

    if (!terrain.commune) {
      window.TerlabToast?.show('Complétez la Phase 0 avant d\'exporter', 'warning');
      return;
    }

    this._setProgress(2, 'Capture des visuels…');
    window.TerlabToast?.show('Génération PDF A3 en cours…', 'info', 8000);

    try {
      // Capture tous les visuels AVANT manipulation DOM
      this._setProgress(5, 'Capture cartes, graphiques, 3D…');
      this._visuals = await this._captureVisuals();

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'landscape', format: 'a3', unit: 'mm' });

      // Charger polices Unicode + phrases contextuelles en parallèle
      this._setProgress(8, 'Chargement polices & phrases…');
      const [, phrases] = await Promise.all([
        this._loadUnicodeFont(pdf),
        this._loadPhrases(),
      ]);
      const phraseCtx  = this._buildPhraseContext(session, terrain);
      const analysis   = phrases ? this._buildAnalysis(phrases, phraseCtx) : null;
      this._totalPages = analysis ? 8 : 7;

      // Page 1 — Fiche identité
      this._setProgress(15, 'Page 1 — Fiche d\'identité…');
      this._page1(pdf, session, terrain, this._visuals.map);

      // Page 2 — Topographie & Géologie
      this._setProgress(30, 'Page 2 — Topographie & Géologie…');
      pdf.addPage();
      this._page2(pdf, session, terrain);

      // Page 3 — Risques & PLU
      this._setProgress(45, 'Page 3 — Risques & PLU…');
      pdf.addPage();
      this._page3(pdf, session, terrain);

      // Page 4 — Voisinage & Biodiversité
      this._setProgress(60, 'Page 4 — Voisinage & Biodiversité…');
      pdf.addPage();
      this._page4(pdf, session, terrain);

      // Page 5 — Esquisse & Chantier
      this._setProgress(75, 'Page 5 — Esquisse & Chantier…');
      pdf.addPage();
      this._page5(pdf, session, terrain);

      // Page 6 — Synthèse
      this._setProgress(82, 'Page 6 — Synthèse…');
      pdf.addPage();
      this._page6(pdf, session, terrain);

      // Page 7 — Audit & Vigilance
      this._setProgress(88, 'Page 7 — Audit & Vigilance…');
      pdf.addPage();
      this._pageAudit(pdf, session, terrain);

      // Page 8 — Analyse & Conclusions (si phrases chargées)
      if (analysis) {
        this._setProgress(93, 'Page 8 — Analyse & Conclusions…');
        pdf.addPage();
        this._pageAnalyse(pdf, session, terrain, analysis);
      }

      // Sauvegarde
      this._setProgress(95, 'Sauvegarde…');
      const filename = `TERLAB_${terrain.commune ?? 'terrain'}_${terrain.section ?? ''}${terrain.parcelle ?? ''}_${new Date().toISOString().slice(0, 10)}.pdf`;
      pdf.save(filename);

      session?.saveExport?.('pdf', filename);
      window.TerlabToast?.show('PDF A3 exporté avec succès', 'success');
      this._hideProgress();

    } catch (e) {
      console.error('[Export PDF]', e);
      window.TerlabToast?.show(`Erreur PDF : ${e.message}`, 'error');
      this._hideProgress();
    }
  },

  // ═══════════════════════════════════════════════════════════════
  //  DXF
  // ═══════════════════════════════════════════════════════════════
  async generateDXF() {
    const session = window.SessionManager;
    const terrain = session?.getTerrain?.() ?? {};

    const parcelle = session?.getPhase?.(0)?.data ?? {};
    const p4       = session?.getPhase?.(4)?.data ?? {};

    if (!terrain.lat) {
      window.TerlabToast?.show('Complétez la Phase 0 avant d\'exporter DXF', 'warning');
      return;
    }

    this._setProgress(20, 'Génération DXF…');

    try {
      const lat = parseFloat(terrain.lat ?? -21.11);
      const lng = parseFloat(terrain.lng ?? 55.54);
      const contenance = parseFloat(terrain.contenance_m2 ?? 400);
      const side = Math.sqrt(contenance).toFixed(2);

      const dxf = [
        '0', 'SECTION', '2', 'HEADER',
        '9', '$ACADVER', '1', 'AC1015',
        '9', '$EXTMIN', '10', '0', '20', '0',
        '9', '$EXTMAX', '10', side, '20', side,
        '0', 'ENDSEC',
        '0', 'SECTION', '2', 'ENTITIES',
        '0', 'LWPOLYLINE',
        '8', 'PARCELLE',
        '90', '4', '70', '1',
        '10', '0.0',    '20', '0.0',
        '10', side,     '20', '0.0',
        '10', side,     '20', side,
        '10', '0.0',    '20', side,
        ...(p4.recul_voie_principale_m ? [
          '0', 'LWPOLYLINE', '8', 'RECUL_VOIE', '90', '2', '70', '0',
          '10', `${p4.recul_voie_principale_m}`, '20', '0.0',
          '10', `${parseFloat(side) - p4.recul_voie_principale_m}`, '20', '0.0'
        ] : []),
        '0', 'TEXT', '8', 'ANNOTATIONS',
        '10', `${parseFloat(side)/2}`, '20', '-3',
        '40', '1.5', '1', `TERLAB - ${terrain.commune ?? ''} - ${terrain.section ?? ''}${terrain.parcelle ?? ''}`,
        '0', 'TEXT', '8', 'ANNOTATIONS',
        '10', '0', '20', '-5',
        '40', '1', '1', `Contenance approx: ${contenance} m2`,
        '0', 'ENDSEC',
        '0', 'EOF'
      ].join('\n');

      const blob = new Blob([dxf], { type: 'application/dxf' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `TERLAB_${terrain.commune ?? 'terrain'}_${terrain.section ?? ''}${terrain.parcelle ?? ''}.dxf`;
      a.click();
      URL.revokeObjectURL(url);

      session?.saveExport?.('dxf', a.download);
      window.TerlabToast?.show('DXF exporté', 'success');

    } catch (e) {
      window.TerlabToast?.show(`Erreur DXF : ${e.message}`, 'error');
    }
    this._hideProgress();
  },

  // ═══════════════════════════════════════════════════════════════
  //  GLB
  // ═══════════════════════════════════════════════════════════════
  async generateGLB() {
    const p7 = window.SessionManager?.getPhase?.(7)?.data ?? {};

    if (!p7.glb_base64) {
      window.TerlabToast?.show('Générez d\'abord le modèle en Phase 7', 'warning');
      window.location.hash = '#phase/7';
      return;
    }

    const binary   = atob(p7.glb_base64);
    const bytes    = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const blob     = new Blob([bytes], { type: 'model/gltf-binary' });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    a.href         = url;
    a.download     = `TERLAB_gabarit_${window.SessionManager?.getTerrain?.()?.commune ?? 'terrain'}.glb`;
    a.click();
    URL.revokeObjectURL(url);

    window.TerlabToast?.show('GLB exporté', 'success');
  },

  // ═══════════════════════════════════════════════════════════════
  //  JSON SESSION
  // ═══════════════════════════════════════════════════════════════
  generateJSON() {
    const json = window.SessionManager?.exportJSON?.() ?? '{}';
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `TERLAB_session_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    window.TerlabToast?.show('Session JSON exportée', 'success');
  }
};

export default ExportEngine;
