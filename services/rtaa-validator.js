/* ════════════════════════════════════════════════════════════════
 * TERLAB · rtaa-validator.js
 * Validation RTAA DOM 2016 simplifiée pour CelluleGenerator
 * Calcul Cm, S0, S, facteur solaire, porosité, équilibre façades
 * Vanilla JS ES2022+ · La Réunion
 * ════════════════════════════════════════════════════════════════ */

const RTAAValidator = {

  // ── Coefficient de masque Cm ──────────────────────────────────
  // type: 'VARANGUE_PROFONDE' | 'COURSIVE' | 'DEBORD'
  // profondeur_cm: profondeur du débord en cm
  // hauteur_cm: hauteur de la baie en cm (défaut 150)
  computeCm(type, profondeur_cm, hauteur_cm = 150) {
    const dh = profondeur_cm / hauteur_cm;
    if (type === 'VARANGUE_PROFONDE' || type === 'COURSIVE') {
      if (dh >= 1.8) return 0.25;
      if (dh >= 1.0) return 0.25;
      if (dh >= 0.55) return 0.50;
      return 0.65;
    }
    // Débord classique — interpolation linéaire simplifiée
    if (dh >= 1.0) return 0.35;
    if (dh >= 0.5) return 0.50;
    if (dh >= 0.3) return 0.65;
    return 0.88;
  },

  // ── Coefficient de transmission S0 ────────────────────────────
  computeS0(menuiserieType) {
    const table = {
      'baie_libre': 1.00,
      'pf_coulissante_2v': 0.75,
      'coulissant': 0.78,
      'fen_battante': 0.87,
      'jalousie': 0.40,
      'jalousie_opaque': 0.40,
      'lame_reflechissante': 0.30,
      'store_projetable_opaque': 0.35,
      'volet_battant_persienne': 0.40,
      'pare_soleil_vertical_ventile': 0.30,
      'porte_opaque': 0.00
    };
    return table[menuiserieType] ?? 0.78;
  },

  // ── Facteur solaire S = S0 × Cm ──────────────────────────────
  computeS(s0, cm) {
    return Math.round(s0 * cm * 100) / 100;
  },

  // ── Vérification facteur S ≤ S_max ────────────────────────────
  checkFacteurS(s, orientation = 'N', zone = 1) {
    const S_max = {
      1: { N: 0.60, S: 0.80, E: 0.60, W: 0.60, NE: 0.60, NO: 0.60, SE: 0.80, SO: 0.60 },
      2: { N: 0.80, S: null, E: 0.80, W: 0.80, NE: 0.80, NO: 0.80, SE: null, SO: 0.80 }
    };
    const smax = S_max[zone]?.[orientation] ?? 0.67;
    if (smax === null) return { conforme: true, note: 'Pas de limite S pour cette orientation en zone 2' };
    return {
      conforme: s <= smax,
      s,
      s_max: smax,
      note: s <= smax ? `S=${s} ≤ ${smax} OK` : `S=${s} > ${smax} NON CONFORME`
    };
  },

  // ── Vérification porosité façade ──────────────────────────────
  checkPorosity(surface_baies_m2, surface_facade_m2, piece = 'sejour') {
    const min_pct = piece === 'sejour' ? 18 : 14;
    const pct = surface_facade_m2 > 0
      ? Math.round(surface_baies_m2 / surface_facade_m2 * 100)
      : 0;
    return {
      conforme: pct >= min_pct,
      porosity_pct: pct,
      min_pct,
      note: pct >= min_pct ? `${pct}% ≥ ${min_pct}% OK` : `${pct}% < ${min_pct}% — insuffisant`
    };
  },

  // ── Vérification équilibre façades ────────────────────────────
  checkEquilibreFacades(facades) {
    if (!facades || facades.length < 2) return { conforme: true, note: 'Mono-façade' };
    const totals = facades.map(f => f.baies_m2 ?? 0);
    const max = Math.max(...totals);
    const min = Math.min(...totals);
    const ratio = max > 0 ? min / max : 1;
    return {
      conforme: ratio >= 0.30,
      ratio: Math.round(ratio * 100) / 100,
      note: ratio >= 0.30 ? `Équilibre ${Math.round(ratio*100)}% OK` : `Déséquilibre ${Math.round(ratio*100)}%`
    };
  },

  // ── Validation complète d'une cellule ─────────────────────────
  validateCellule(cellule, typeRules) {
    const checks = [];
    const rtaa = typeRules?.rtaa ?? {};

    // 1. Cm varangue
    const varP = cellule.varangue_profondeur_m ?? 3.0;
    const cm = this.computeCm('VARANGUE_PROFONDE', varP * 100, 150);
    checks.push({ id: 'cm_varangue', label: 'Cm varangue', value: cm, conforme: cm <= 0.50 });

    // 2. Facteur S séjour
    const s0 = this.computeS0('coulissant');
    const s = this.computeS(s0, cm);
    const sCheck = this.checkFacteurS(s, 'N', 1);
    checks.push({ id: 'facteur_s', label: 'Facteur S séjour', value: s, conforme: sCheck.conforme, note: sCheck.note });

    // 3. Porosité séjour
    const baiesSejour = cellule.sejour_baies_m2 ?? rtaa.baie_sejour?.libre_m2 ?? 0;
    const facadeSejour = cellule.sejour_facade_m2 ?? (cellule.width_m ?? 8) * 2.5;
    const poroCheck = this.checkPorosity(baiesSejour, facadeSejour, 'sejour');
    checks.push({ id: 'porosite_sejour', label: 'Porosité séjour', value: `${poroCheck.porosity_pct}%`, conforme: poroCheck.conforme, note: poroCheck.note });

    // 4. Jalousie cuisine
    const jalCuisine = cellule.cuisine_jalousie ?? !!rtaa.jalousie_cuisine;
    checks.push({ id: 'jalousie_cuisine', label: 'Jalousie cuisine', value: jalCuisine ? 'Oui' : 'Non', conforme: jalCuisine });

    // 5. Porte palière (ventilation traversante)
    const portePal = cellule.porte_paliere ?? true;
    checks.push({ id: 'porte_paliere', label: 'Porte palière ventilée', value: portePal ? 'Oui' : 'Non', conforme: portePal });

    const conforme = checks.every(c => c.conforme);
    return {
      conforme,
      score: checks.filter(c => c.conforme).length,
      total: checks.length,
      checks
    };
  }
};

export default RTAAValidator;
