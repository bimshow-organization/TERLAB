// TERLAB · topo-case-service.js · Cas d'implantation selon la pente · ENSA La Réunion v1.0
// Service pur (aucune dépendance UI) — consommé par AutoPlanEngine, EsquisseCanvas, PlanMasseEngine

/**
 * @typedef {Object} TopoCase
 * @property {string}  id            — 'flat'|'gentle'|'medium'|'steep'|'extreme'
 * @property {string}  label         — Libellé court
 * @property {number}  penteMin      — % min
 * @property {number}  penteMax      — % max (Infinity pour le dernier)
 * @property {number}  profMax       — Profondeur max bâtiment (m)
 * @property {number}  largeurCollectifRef — Largeur référence collectif (m) : 15 ou 10
 * @property {string}  systemType    — 'standard'|'soubassement'|'deblai_remblai'|'pilotis'|'pilotis_long'
 * @property {boolean} pmrNaturelAmont — true si accès PMR de plain-pied depuis voie amont
 * @property {boolean} parkingAere   — true si parking sous dalle ouvert côté aval (SDIS)
 * @property {boolean} bureauStructure — true si bureau d'études structure obligatoire
 * @property {boolean} pompesRelev   — true si pompes de relevage probables pour R-1+
 * @property {number}  coutMultiplicateur — vs terrain plat (×1 à ×3)
 * @property {string[]} conseils     — IDs conseils pertinents de la forme 'C18', 'C22'…
 * @property {string}  coupeRef      — ID de la section dans atlas-topographie : 'cas00'…'cas04'
 */

const TOPO_CASES = [
  {
    id: 'flat',
    label: 'Terrain quasi-plat',
    penteMin: 0,    penteMax: 5,
    profMax: 15,    largeurCollectifRef: 15,
    systemType: 'standard',
    pmrNaturelAmont: false, parkingAere: false,
    bureauStructure: false, pompesRelev: false,
    coutMultiplicateur: 1.0,
    conseils: ['C17', 'D25', 'F40'],
    coupeRef: 'cas00',
  },
  {
    id: 'gentle',
    label: 'Pente douce',
    penteMin: 5,    penteMax: 15,
    profMax: 12,    largeurCollectifRef: 15,
    systemType: 'soubassement',
    pmrNaturelAmont: false, parkingAere: false,
    bureauStructure: false, pompesRelev: false,
    coutMultiplicateur: 1.2,
    conseils: ['C18', 'E32', 'E33', 'G49'],
    coupeRef: 'cas01',
  },
  {
    id: 'medium',
    label: 'Pente moyenne',
    penteMin: 15,   penteMax: 30,
    profMax: 10,    largeurCollectifRef: 15,
    systemType: 'deblai_remblai',
    pmrNaturelAmont: false, parkingAere: false,
    bureauStructure: false, pompesRelev: true,
    coutMultiplicateur: 1.5,
    conseils: ['C19', 'E32', 'E33', 'E34', 'F40', 'F41', 'G49'],
    coupeRef: 'cas02',
  },
  {
    id: 'steep',
    label: 'Pente forte',
    penteMin: 30,   penteMax: 50,
    profMax: 8,     largeurCollectifRef: 10,
    systemType: 'pilotis',
    pmrNaturelAmont: true, parkingAere: true,
    bureauStructure: false, pompesRelev: true,
    coutMultiplicateur: 1.8,
    conseils: ['C20', 'C22', 'D29', 'E37', 'F40', 'F41', 'G48'],
    coupeRef: 'cas03',
  },
  {
    id: 'extreme',
    label: 'Pente extrême',
    penteMin: 50,   penteMax: Infinity,
    profMax: 6,     largeurCollectifRef: 6,
    systemType: 'pilotis_long',
    pmrNaturelAmont: true, parkingAere: true,
    bureauStructure: true, pompesRelev: true,
    coutMultiplicateur: 2.8,
    conseils: ['C21', 'D29', 'E37', 'E38', 'F40', 'F41', 'G50', 'G51'],
    coupeRef: 'cas04',
  },
];

export default {
  /**
   * Retourne le TopoCase pour une pente donnée.
   * Si pente_moy_pct est null/undefined → retourne le cas 'flat' avec un flag `unknown: true`
   */
  getCase(pente_moy_pct) {
    if (pente_moy_pct == null) {
      return { ...TOPO_CASES[0], unknown: true };
    }
    const p = parseFloat(pente_moy_pct);
    return TOPO_CASES.find(c => p >= c.penteMin && p < c.penteMax) ?? TOPO_CASES.at(-1);
  },

  /**
   * Retourne les contraintes de programme dérivées du cas topo.
   * Ces valeurs peuvent surcharger les valeurs par défaut du _prog de EsquisseCanvas.
   *
   * @param {number} pente_moy_pct
   * @param {Object} progBase
   * @param {number} [azimut_pente_deg]  Direction de la pente (compass, 0=N) —
   *                                     exposé tel quel pour la stratégie Isohypses.
   */
  getProgConstraints(pente_moy_pct, progBase = {}, azimut_pente_deg = null) {
    const tc = this.getCase(pente_moy_pct);
    return {
      profMax:          Math.min(progBase.profMax ?? 15, tc.profMax),
      nvMaxEffectif:    progBase.nvMax ?? 2,
      parkMode:         tc.parkingAere ? 'aere' : (progBase.parkMode ?? 'ext'),
      parkSS:           false,
      pmrNaturel:       tc.pmrNaturelAmont,
      bureauStructure:  tc.bureauStructure,
      pompesRelev:      tc.pompesRelev,
      topoCase:         tc,
      azimut_deg:       Number.isFinite(parseFloat(azimut_pente_deg))
                         ? parseFloat(azimut_pente_deg)
                         : null,
    };
  },

  /** Chemin vers le fichier conseils (relatif à la racine du projet) */
  CONSEILS_PATH: '.docs/terlab-v3/60-conseils-construction-pente-reunion.html',

  /** URL anchor vers une section du fichier conseils */
  conseilsURL(sectionId) {
    return `${this.CONSEILS_PATH}#${sectionId}`;
  },

  all: TOPO_CASES,
};
