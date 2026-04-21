/**
 * TERLAB · user-scenario.js
 * Etat utilisateur immutable — jamais mute par les fonctions de calcul.
 * Les handlers UI ecrivent via setField/merge, le reste lit seulement.
 */

export const DEFAULT_SCENARIO = Object.freeze({
  targetLgts: null,          // null = auto = cap max
  parkMode: 'auto',          // 'auto' | 'ext' | 'rdc' | 'ss'
  strategy: 'equilibre',     // id de la strategie active
  formVariant: 'I',          // I | L | T | X | Y
  mix: Object.freeze({ T1: 10, T2: 30, T3: 40, T4: 20 }),
  effBat: 0.82,              // rendement batiment
  nvMax: null,               // null = auto = nvMaxPLU
  profMax: 15,               // profondeur max (m)
  type: 'collectif',         // 'maison' | 'bande' | 'collectif'
  manualBlocs: null,         // [{polygon, theta, ...}] si edition manuelle
});

/**
 * Modifie un champ du scenario, retourne un nouvel objet gele.
 * @param {Object} scenario - scenario courant
 * @param {string} key - clef a modifier
 * @param {*} value - nouvelle valeur
 * @returns {Object} nouveau scenario gele
 */
export function setField(scenario, key, value) {
  if (!(key in DEFAULT_SCENARIO)) {
    console.warn(`[UserScenario] clef inconnue: ${key}`);
    return scenario;
  }
  return Object.freeze({ ...scenario, [key]: value });
}

/**
 * Merge partiel du scenario.
 * @param {Object} scenario - scenario courant
 * @param {Object} patch - paires clef/valeur a fusionner
 * @returns {Object} nouveau scenario gele
 */
export function merge(scenario, patch) {
  return Object.freeze({ ...scenario, ...patch });
}

/**
 * Resout le parkMode 'auto' en mode concret selon les contraintes.
 * Ne mute PAS le scenario — retourne le mode effectif.
 *
 * @param {Object} scenario - scenario courant
 * @param {number} emprise - emprise au sol du batiment (m2)
 * @param {number} budgetPerm - budget impermeable (m2)
 * @param {number} nbLgts - nombre de logements
 * @returns {string} 'ext' | 'rdc' | 'ss'
 */
export function resolveAutoPark(scenario, emprise, budgetPerm, nbLgts) {
  if (scenario.parkMode !== 'auto') return scenario.parkMode;

  const pkReq = nbLgts * 2;
  const pkExtM2 = pkReq * 25;

  // Ext si ca tient dans le budget
  if (emprise + pkExtM2 <= budgetPerm) return 'ext';

  // RdC si 80% de l'emprise couvre les places
  const rdcPlaces = Math.floor(emprise * 0.80 / 25);
  if (rdcPlaces >= pkReq) return 'rdc';

  // Sinon SS
  return 'ss';
}

/**
 * Resout le nombre de niveaux selon scenario et PLU.
 * @param {Object} scenario
 * @param {number} nvMaxPLU - niveaux max autorises par le PLU
 * @returns {number}
 */
export function resolveNiveaux(scenario, nvMaxPLU) {
  if (scenario.nvMax != null) return Math.min(scenario.nvMax, nvMaxPLU);
  return nvMaxPLU;
}

if (typeof window !== 'undefined') {
  window.UserScenario = { DEFAULT_SCENARIO, setField, merge, resolveAutoPark, resolveNiveaux };
}
