/**
 * TERLAB · capacity-model.js
 * Calcul pur de capacite maximale — aucun acces DOM, aucune mutation d'etat.
 * Produit une matrice [strategy × parkMode] de capacites.
 *
 * Usage :
 *   const table = CapacityModel.compute(parcelle, plu, programme);
 *   table.max       → { lgts, strategy, parkMode, emprise, sdp, limiting }
 *   table.cells     → tableau de 12+ cellules (strategy × parkMode)
 *   table.byPark    → { ext: maxLgts, rdc: maxLgts, ss: maxLgts }
 */

const SP_MOY = 0.175 * 31 + 0.275 * 49 + 0.325 * 68 + 0.225 * 87; // ~57 m2
const H_NIV = 3; // hauteur par niveau (m)
const PK_M2 = 25; // m2 par place de parking

const CapacityModel = {

  SP_MOY,

  /**
   * Calcule la capacite maximale pour toutes les combinaisons.
   *
   * @param {Object} parcelle - { area, envelopeArea, obbW, obbL }
   * @param {Object} plu - { emprMax, permMin, heMax, rtaaZone, interBatMin }
   * @param {Object} programme - { eff, profMax, type }
   * @returns {Object} { max, cells, byPark, byStrategy }
   */
  compute(parcelle, plu, programme = {}) {
    const area = parcelle.area ?? 0;
    const envArea = parcelle.envelopeArea ?? area * 0.8;
    const obbW = parcelle.obbW ?? Math.sqrt(envArea);
    const obbL = parcelle.obbL ?? Math.sqrt(envArea);

    const emprMax = plu.emprMax ?? 60;
    const permMin = plu.permMin ?? 25;
    const heMax = plu.heMax ?? 9;
    const rtaaW = (plu.rtaaZone ?? 1) === 1 ? 10 : 12;
    const interBat = plu.interBatMin ?? 4;

    const nvMaxPLU = Math.max(1, Math.floor(heMax / H_NIV));
    const eff = programme.eff ?? 0.82;
    const profMax = programme.profMax ?? 15;
    const type = programme.type ?? 'collectif';

    // Budget impermeable
    const budgetPerm = area * (1 - permMin / 100);
    // Emprise max PLU
    const cesMaxM2 = area * emprMax / 100;
    // Emprise max geometrique (la plus restrictive)
    const empriseMaxGeo = Math.min(cesMaxM2, budgetPerm, envArea);

    const STRATEGIES = [
      { id: 'rect',    label: 'Rectangle',  mono: true },
      { id: 'multi',   label: 'Multi-blocs', mono: false },
      { id: 'zone',    label: 'Zone',        mono: false },
      { id: 'lshape',  label: 'L-shape',     mono: false },
    ];
    const PARK_MODES = ['ext', 'rdc', 'ss'];

    const cells = [];
    let globalMax = { lgts: 0 };

    for (const strat of STRATEGIES) {
      for (const park of PARK_MODES) {
        const cell = this._computeCell({
          area, envArea, obbW, obbL,
          emprMax, permMin, budgetPerm, cesMaxM2, empriseMaxGeo,
          rtaaW, profMax, interBat, nvMaxPLU, eff, type,
          strategy: strat, parkMode: park,
        });
        cells.push(cell);
        if (cell.feasible && cell.lgts > globalMax.lgts) {
          globalMax = cell;
        }
      }
    }

    // Synthese par parking
    const byPark = {};
    for (const park of PARK_MODES) {
      const best = cells.filter(c => c.parkMode === park && c.feasible)
        .sort((a, b) => b.lgts - a.lgts)[0];
      byPark[park] = best?.lgts ?? 0;
    }

    // Synthese par strategie
    const byStrategy = {};
    for (const strat of STRATEGIES) {
      const best = cells.filter(c => c.strategy === strat.id && c.feasible)
        .sort((a, b) => b.lgts - a.lgts)[0];
      byStrategy[strat.id] = best?.lgts ?? 0;
    }

    // Cap max par typologie — INDEPENDANT du mix utilisateur
    // Chaque typo a son propre SP_MOY
    const TYPO_SP = { maison: 120, bande: 80, collectif: SP_MOY };
    const byTypo = {};
    for (const [typoId, spMoy] of Object.entries(TYPO_SP)) {
      // Meilleure cellule tous parkModes confondus, avec SP_MOY ajusté
      let bestLgts = 0;
      let bestCell = null;
      for (const cell of cells) {
        if (!cell.feasible) continue;
        const adjustedLgts = typoId === 'maison' ? 1
          : Math.max(1, Math.floor(cell.sdp / spMoy));
        if (adjustedLgts > bestLgts) {
          bestLgts = adjustedLgts;
          bestCell = { ...cell, lgts: adjustedLgts, typo: typoId, spMoy };
        }
      }
      byTypo[typoId] = bestCell ?? { lgts: typoId === 'maison' ? 1 : 0, typo: typoId, limiting: 'none' };
    }

    return { max: globalMax, cells, byPark, byStrategy, byTypo, nvMaxPLU, budgetPerm, cesMaxM2 };
  },

  /**
   * Calcule une cellule (strategy × parkMode).
   */
  _computeCell(p) {
    const { area, envArea, obbW, obbL, emprMax, permMin, budgetPerm, cesMaxM2,
            rtaaW, profMax, interBat, nvMaxPLU, eff, type,
            strategy, parkMode } = p;

    const result = {
      strategy: strategy.id,
      strategyLabel: strategy.label,
      parkMode,
      feasible: true,
      emprise: 0,
      niveaux: nvMaxPLU,
      sdp: 0,
      lgts: 0,
      lgtsParNiveau: 0,
      parkReq: 0,
      parkPlaces: '',
      limiting: null,
      reason: null,
    };

    if (type === 'maison') {
      result.lgts = 1;
      result.emprise = Math.min(150, cesMaxM2, budgetPerm);
      result.sdp = result.emprise * eff;
      result.niveaux = 1;
      result.parkReq = 2;
      result.limiting = 'type';
      return result;
    }

    // 1. Emprise max selon la strategie
    let maxEmpr;
    if (strategy.mono) {
      // Mono-bloc : cap RTAA largeur × profMax
      const wCap = Math.min(rtaaW, obbW * 0.95);
      const lCap = Math.min(profMax, obbL * 0.95);
      const monoMax = wCap * lCap;
      // Multi-blocs possible ?
      const gap = Math.max(interBat, nvMaxPLU * H_NIV / 2);
      const nBlocs = Math.max(1, Math.floor((obbL + gap) / (lCap + gap)));
      maxEmpr = nBlocs > 1 ? Math.min(cesMaxM2, monoMax * nBlocs) : monoMax;
    } else {
      // Non-mono : emprise = enveloppe utilisable
      maxEmpr = envArea * 0.90; // 90% de l'enveloppe (marge circulation)
    }

    // 2. Cap par les contraintes PLU
    maxEmpr = Math.min(maxEmpr, cesMaxM2);

    // 3. Cap parking selon le mode
    let limiting = null;
    if (parkMode === 'ext') {
      // Dichotomie : empr + park(empr) <= budgetPerm
      const solved = this._solveExtParking(maxEmpr, budgetPerm, eff, nvMaxPLU);
      if (solved < maxEmpr) {
        maxEmpr = solved;
        limiting = 'permMin+parking';
      }
    } else {
      // SS ou RdC : pas de parking en surface
      maxEmpr = Math.min(maxEmpr, budgetPerm);
      if (maxEmpr === budgetPerm) limiting = 'permMin';
    }

    if (maxEmpr < 20) {
      result.feasible = false;
      result.reason = 'Emprise insuffisante';
      result.limiting = limiting ?? 'emprMax';
      return result;
    }

    // 4. Logements
    result.emprise = Math.round(maxEmpr);
    result.niveaux = nvMaxPLU;
    result.lgtsParNiveau = Math.max(1, Math.floor(maxEmpr * eff / SP_MOY));
    result.lgts = result.lgtsParNiveau * nvMaxPLU;
    result.sdp = Math.round(maxEmpr * eff * nvMaxPLU);
    result.parkReq = result.lgts * 2;

    // 5. Parking RdC : verifie que le RdC suffit
    if (parkMode === 'rdc') {
      const rdcPlaces = Math.floor(maxEmpr * 0.80 / PK_M2);
      const surplus = Math.max(0, result.parkReq - rdcPlaces);
      result.parkPlaces = surplus > 0 ? `${rdcPlaces} RdC + ${surplus} SS` : `${rdcPlaces} RdC`;
      // RdC ampute ~20% de SDP au RdC
      result.sdp = Math.round(maxEmpr * eff * (nvMaxPLU - 0.2));
      result.lgts = Math.max(1, Math.floor(result.sdp / SP_MOY));
    } else if (parkMode === 'ss') {
      result.parkPlaces = `${result.parkReq} SS`;
    } else {
      result.parkPlaces = `${result.parkReq} ext`;
    }

    // 6. Facteur limitant (la contrainte la plus basse)
    if (!limiting) {
      if (maxEmpr >= cesMaxM2 * 0.95) limiting = 'emprMax';
      else if (maxEmpr >= budgetPerm * 0.95) limiting = 'permMin';
      else limiting = 'height';
    }
    result.limiting = limiting;

    return result;
  },

  /**
   * Dichotomie parking ext : max emprise tel que empr + park(empr) <= budget.
   */
  _solveExtParking(maxEmpr, budget, eff, nv) {
    const parkForEmpr = (empr) => {
      const lgts = Math.max(1, Math.floor(empr * eff * nv / SP_MOY));
      return lgts * 2 * PK_M2;
    };
    if (maxEmpr + parkForEmpr(maxEmpr) <= budget) return maxEmpr;
    let lo = 20, hi = maxEmpr;
    for (let i = 0; i < 25; i++) {
      const mid = (lo + hi) / 2;
      if (mid + parkForEmpr(mid) <= budget) lo = mid; else hi = mid;
    }
    return lo;
  },

  /**
   * Explique pourquoi le max est ce qu'il est — texte lisible.
   */
  explain(table) {
    const m = table.max;
    if (!m || !m.lgts) return 'Aucune capacite calculable';
    const parts = [`Cap. max ${m.lgts} lgts`];
    parts.push(`${m.lgtsParNiveau}/niv × ${m.niveaux} niv`);
    parts.push(`emprise ${m.emprise}m2`);
    parts.push(`PK ${m.parkPlaces}`);
    if (m.limiting) {
      const labels = {
        permMin: `espace vert ${table.max.parkMode === 'ext' ? '+ parking ext ' : ''}= facteur limitant`,
        'permMin+parking': 'parking ext consomme le budget impermeable',
        emprMax: 'emprise max PLU atteinte',
        height: 'hauteur PLU (niveaux max)',
        rtaa: 'largeur RTAA ventilation',
      };
      parts.push(`limitant: ${labels[m.limiting] ?? m.limiting}`);
    }
    return parts.join(' · ');
  },
};

if (typeof window !== 'undefined') window.CapacityModel = CapacityModel;
export default CapacityModel;
