// terlab/services/rtaa-checker.js
// RTAA DOM 2016 — Vérification protection solaire Art.5 (parois opaques) + Art.6 (baies)
// Port fidèle de HOUSEG-SPEECH engine/rtaa-solar-checker.js (594L)
// Vanilla JS ES2022+ — La Réunion uniquement
// Ref : Arrêté 17 avril 2009 modifié 11 janvier 2016 — Annexe III

import Orientation from '../utils/orientation.js';

// ── Tables chargées depuis rtaa-tables.json ──────────────────────────────────
let TABLES = null;

async function _ensureTables() {
  if (TABLES) return;
  try {
    const base = import.meta.url ? new URL('../data/rtaa-tables.json', import.meta.url).href : '../data/rtaa-tables.json';
    const res = await fetch(base);
    TABLES = await res.json();
  } catch (e) {
    console.warn('[RTAAChecker] Chargement rtaa-tables.json échoué, fallback inline');
    TABLES = _fallbackTables();
  }
}

// Fallback inline minimal si fetch échoue (mode offline)
function _fallbackTables() {
  return {
    S_max_baies: {
      reunion_zone1: { N: 0.60, S: 0.80, E: 0.60, W: 0.60, NE: 0.60, NO: 0.60, SE: 0.80, SO: 0.60 },
      reunion_zone2: { N: 0.80, S: null, E: 0.80, W: 0.80, NE: 0.80, NO: 0.80, SE: null, SO: 0.80 },
    },
    S_max_parois_opaques: { toiture_horizontale: 0.03, mur_vertical_pp: 0.09 },
    So_par_menuiserie: {
      baie_libre: 1.00, pf_coulissante_2v: 0.75, fen_battante: 0.87,
      jalousie_opaque: 0.40, lame_reflechissante: 0.30, store_projetable_opaque: 0.35,
      volet_battant_persienne: 0.40, pare_soleil_vertical_ventile: 0.30, porte_opaque: 0.00,
    },
    alpha_absorption: {
      claire: { verticale: 0.40, horizontale: 0.60 },
      moyenne: { verticale: 0.60, horizontale: 0.60 },
      sombre: { verticale: 0.80, horizontale: 0.80 },
      noire: { verticale: 1.00, horizontale: 1.00 },
    },
    Cm_forfaitaire: {
      reunion_nord: {
        dh: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0],
        debord_fini: [0.88, 0.79, 0.72, 0.67, 0.63, 0.61, 0.59, 0.58],
        debord_05h:  [0.86, 0.74, 0.64, 0.57, 0.52, 0.48, 0.45, 0.43],
        debord_2h:   [0.85, 0.72, 0.61, 0.53, 0.46, 0.42, 0.37, 0.35],
        debord_1joue:[0.84, 0.73, 0.64, 0.58, 0.54, 0.51, 0.49, 0.47],
        debord_2joues:[0.80, 0.66, 0.56, 0.49, 0.45, 0.41, 0.38, 0.36],
      },
      reunion_sud: {
        dh: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0],
        debord_fini: [0.94, 0.89, 0.84, 0.81, 0.78, 0.76, 0.74, 0.73],
        debord_05h:  [0.93, 0.87, 0.81, 0.76, 0.72, 0.69, 0.65, 0.63],
        debord_2h:   [0.93, 0.86, 0.79, 0.74, 0.69, 0.66, 0.61, 0.58],
        debord_1joue:[0.92, 0.86, 0.80, 0.75, 0.72, 0.69, 0.65, 0.63],
        debord_2joues:[0.91, 0.83, 0.76, 0.71, 0.67, 0.64, 0.60, 0.57],
      },
      reunion_est: {
        dh: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0],
        debord_fini: [0.86, 0.76, 0.68, 0.63, 0.59, 0.56, 0.53, 0.52],
        debord_05h:  [0.84, 0.71, 0.62, 0.55, 0.50, 0.46, 0.42, 0.40],
        debord_2h:   [0.83, 0.70, 0.60, 0.52, 0.46, 0.42, 0.37, 0.34],
        debord_1joue:[0.82, 0.70, 0.62, 0.55, 0.50, 0.47, 0.43, 0.41],
        debord_2joues:[0.78, 0.64, 0.55, 0.48, 0.43, 0.40, 0.36, 0.33],
      },
      reunion_ouest: {
        dh: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0],
        debord_fini: [0.86, 0.76, 0.68, 0.63, 0.59, 0.56, 0.53, 0.52],
        debord_05h:  [0.84, 0.71, 0.62, 0.55, 0.50, 0.46, 0.42, 0.40],
        debord_2h:   [0.83, 0.70, 0.60, 0.52, 0.46, 0.42, 0.37, 0.34],
        debord_1joue:[0.82, 0.70, 0.62, 0.55, 0.50, 0.47, 0.43, 0.41],
        debord_2joues:[0.78, 0.64, 0.55, 0.48, 0.43, 0.40, 0.36, 0.33],
      },
    },
  };
}

// ── Pièces principales au sens RTAA ──────────────────────────────────────────
const PP = new Set(['sejour', 'chambre', 'chambre_parentale', 'bureau']);

// ── RTAAChecker ──────────────────────────────────────────────────────────────

const RTAAChecker = {

  /**
   * Zone RTAA depuis altitude (La Réunion uniquement)
   * @param {number} altitude - mètres NGR
   * @returns {string} 'reunion_zone1'|'reunion_zone2'|'reunion_zone3'
   */
  getZone(altitude) {
    if (altitude <= 400) return 'reunion_zone1';
    if (altitude <= 600) return 'reunion_zone2';
    return 'reunion_zone3';
  },

  /**
   * Smax d'une baie selon zone et orientation
   * @param {string} zone - 'reunion_zone1'|'reunion_zone2'
   * @param {string} orientation - direction cardinale (clé RTAA : N/S/E/W/NE/NO/SE/SO)
   * @returns {number|null} null = exempté
   */
  async getSmaxBaie(zone, orientation) {
    await _ensureTables();
    const table = TABLES.S_max_baies[zone];
    if (!table) return null; // zone3 = exempté
    return table[orientation] ?? table[orientation?.[0]] ?? 0.60;
  },

  /**
   * Interpolation linéaire dans le tableau Cm forfaitaire
   * @param {string} secteur - 'reunion_nord'|'reunion_sud'|'reunion_est'|'reunion_ouest'
   * @param {string} config  - 'debord_fini'|'debord_05h'|'debord_2h'|'debord_1joue'|'debord_2joues'
   * @param {number} dh      - ratio d/h calculé
   * @returns {number} Cm interpolé
   */
  async getCmForfaitaire(secteur, config, dh) {
    await _ensureTables();
    const table = TABLES.Cm_forfaitaire[secteur];
    if (!table) return 1.0;

    const dhs = table.dh;
    const vals = table[config];
    if (!vals) return 1.0;

    if (dh <= dhs[0]) return vals[0];
    if (dh >= dhs[dhs.length - 1]) return vals[vals.length - 1];

    for (let i = 0; i < dhs.length - 1; i++) {
      if (dh >= dhs[i] && dh <= dhs[i + 1]) {
        const t = (dh - dhs[i]) / (dhs[i + 1] - dhs[i]);
        return Math.round((vals[i] + t * (vals[i + 1] - vals[i])) * 1000) / 1000;
      }
    }
    return 1.0;
  },

  /**
   * Calcul du Cm depuis la géométrie d'un débord
   * @param {Object} params - { debord_m, h_baie_m, b_m, prolongement_m, n_joues }
   * @param {string} orientation - N|S|E|W|NE|NO|SE|SO
   * @param {string} zone
   * @returns {Promise<{Cm, dh, config, secteur, note}>}
   */
  async computeCm(params, orientation, zone) {
    const {
      debord_m,
      h_baie_m = 1.20,
      b_m = 0.10,
      prolongement_m = 0,
      n_joues = 0,
    } = params;

    const h_total = h_baie_m + b_m;
    const dh = debord_m / h_total;

    // Vérification limite b < h/10
    const b_limit = h_baie_m / 10;
    if (b_m > b_limit) {
      return {
        Cm: 1.0, dh: Math.round(dh * 1000) / 1000, config: 'debord_fini',
        note: `b=${b_m}m > h/10=${b_limit.toFixed(2)}m — méthode détaillée Cerema requise`,
      };
    }

    // Configuration du débord
    let config = 'debord_fini';
    if (n_joues === 2) config = 'debord_2joues';
    else if (n_joues === 1) config = 'debord_1joue';
    else if (prolongement_m >= 2 * h_baie_m) config = 'debord_2h';
    else if (prolongement_m >= 0.5 * h_baie_m) config = 'debord_05h';

    // Secteur RTAA depuis orientation
    const dir = orientation.toUpperCase();
    let secteur = 'reunion_nord';
    if (dir === 'S' || dir === 'SE' || dir === 'SO') secteur = 'reunion_sud';
    else if (dir === 'E' || dir === 'NE') secteur = 'reunion_est';
    else if (dir === 'W' || dir === 'O' || dir === 'NO') secteur = 'reunion_ouest';

    const Cm = await this.getCmForfaitaire(secteur, config, dh);
    return {
      Cm, dh: Math.round(dh * 1000) / 1000, config, secteur,
      note: `d/h=${dh.toFixed(2)} config=${config} Cm=${Cm}`,
    };
  },

  /**
   * Vérification facteur solaire d'une baie : S = So × Cm
   * @param {Object} baie - { menuiserie_type, protection_type, debord, orientation }
   * @param {string} zone
   * @returns {Promise<SolarResult>}
   */
  async checkBaie(baie, zone) {
    await _ensureTables();
    const { menuiserie_type, protection_type, debord, orientation } = baie;

    const Smax = await this.getSmaxBaie(zone, Orientation.cardinalToRtaaKey(orientation));
    if (Smax === null) {
      return {
        type: 'baie', orientation, zone,
        So: null, Cm: null, S: null, Smax: null,
        conforme: null, exemption: true,
        note: `Zone ${zone} — Exemption altitude >600m`,
      };
    }

    // So depuis type menuiserie
    const So = TABLES.So_par_menuiserie[menuiserie_type] ?? TABLES.So_par_menuiserie.fen_battante ?? 0.87;

    // Cm selon protection
    let Cm = 1.0, Cm_detail = {};

    if (protection_type === 'debord' && debord) {
      Cm_detail = await this.computeCm(debord, orientation, zone);
      Cm = Cm_detail.Cm;
    } else if (protection_type === 'varangue') {
      const h_ref = debord?.h_baie_m ?? 2.60;
      const d = debord?.debord_m ?? 2.0;
      Cm_detail = await this.computeCm({ debord_m: d, h_baie_m: h_ref, b_m: 0.10 }, orientation, zone);
      Cm = Cm_detail.Cm;
    } else if (protection_type === 'surtoiture_standard') {
      Cm = 0.30;
    } else if (protection_type === 'surtoiture_performante') {
      Cm = 0.15;
    } else if (protection_type === 'bardage_ventile') {
      Cm = 0.30;
    } else if (protection_type === 'brise_soleil_vertical' || menuiserie_type === 'pare_soleil_vertical_ventile') {
      Cm = 1.0; // So intègre déjà la protection
    } else if (protection_type === 'store_projetable' || protection_type === 'jalousie') {
      Cm = 1.0; // So intègre déjà
    }

    const S = Math.round(So * Cm * 1000) / 1000;
    const conforme = S <= Smax;

    return {
      type: 'baie', orientation, zone,
      So: Math.round(So * 1000) / 1000,
      Cm: Math.round(Cm * 1000) / 1000,
      Cm_detail, S, Smax, conforme,
      deficit: conforme ? 0 : Math.round((S - Smax) * 1000) / 1000,
      note: `S=${S} ${conforme ? '≤' : '>'} Smax=${Smax} — ${conforme ? '✓' : '✗'}`,
      suggestion: conforme ? null : await this._suggestProtection(S, Smax, orientation, So, debord, zone),
    };
  },

  /**
   * Vérification facteur solaire paroi opaque : S = (0.074 × Cm × α) / (R + 0.2)
   * @param {Object} paroi - { type_paroi, inclinaison, couleur, R_m2KW, protection, debord, orientation }
   * @param {string} zone
   * @returns {Promise<SolarResult>}
   */
  async checkParoiOpaque(paroi, zone) {
    if (zone === 'reunion_zone3') {
      return { type: 'paroi_opaque', conforme: null, exemption: true, note: 'Hauts >600m — exigence U' };
    }

    await _ensureTables();
    const { type_paroi, inclinaison = 'verticale', couleur = 'claire', R_m2KW = 0.21, protection, debord, orientation } = paroi;

    // α absorption
    const alpha_table = TABLES.alpha_absorption[couleur] ?? TABLES.alpha_absorption.claire;
    const alpha = inclinaison === 'horizontale' ? alpha_table.horizontale : alpha_table.verticale;

    // Smax
    const Smax = type_paroi === 'toiture'
      ? TABLES.S_max_parois_opaques.toiture_horizontale
      : TABLES.S_max_parois_opaques.mur_vertical_pp;

    // Cm
    let Cm = 1.0;
    if (protection === 'surtoiture_performante') Cm = 0.15;
    else if (protection === 'surtoiture_standard') Cm = 0.30;
    else if (protection === 'bardage_ventile') Cm = 0.30;
    else if (protection === 'debord' && debord && orientation) {
      const detail = await this.computeCm(debord, orientation, zone);
      Cm = detail.Cm;
    }

    const S = Math.round((0.074 * Cm * alpha) / (R_m2KW + 0.2) * 1000) / 1000;
    const conforme = S <= Smax;

    return {
      type: 'paroi_opaque', type_paroi, inclinaison, couleur, alpha, R_m2KW,
      Cm, S, Smax, conforme,
      deficit: conforme ? 0 : Math.round((S - Smax) * 1000) / 1000,
      note: `S=(0.074×${Cm}×${alpha})/(${R_m2KW}+0.2)=${S} ${conforme ? '≤' : '>'} ${Smax}`,
    };
  },

  /**
   * Vérification complète Art.5 + Art.6 pour toutes les rooms
   * @param {Array} rooms - [{id, type, w, h, openings, by_facade}]
   * @param {Object} config - { altitude, debord_m, couleur_murs, couleur_toit, R_mur, R_toit, h_plafond }
   * @returns {Promise<SolarReport>}
   */
  async checkPlan(rooms, config = {}) {
    await _ensureTables();

    const {
      altitude = 25,
      debord_m = 0.60,
      couleur_murs = 'claire',
      couleur_toit = 'claire',
      R_mur = 0.21,
      R_toit = 0.21,
      prolongement_m = 0,
      n_joues = 0,
      h_plafond = 2.60,
    } = config;

    const zone = this.getZone(altitude);
    const results_baies = [];
    const results_parois = [];
    const violations = [];

    // ── Art.5 — Toiture (globale) ──
    const toiture = await this.checkParoiOpaque({
      type_paroi: 'toiture', inclinaison: 'horizontale',
      couleur: couleur_toit, R_m2KW: R_toit,
      protection: debord_m >= 1.0 ? 'surtoiture_standard' : null,
    }, zone);
    results_parois.push({ id: 'toiture', ...toiture });
    if (toiture.conforme === false) {
      violations.push({ article: '5', severity: 'major', element: 'Toiture', msg: toiture.note });
    }

    // ── Art.5 — Murs PP par orientation ──
    for (const r of rooms) {
      if (!PP.has(r.type)) continue;
      const facades_ext = Object.keys(r.by_facade ?? {}).filter(d => (r.by_facade[d] ?? 0) > 0);
      const dirs = facades_ext.length > 0 ? facades_ext : ['N', 'S'];

      for (const dir of dirs) {
        const mur = await this.checkParoiOpaque({
          type_paroi: 'mur', inclinaison: 'verticale',
          couleur: couleur_murs, R_m2KW: R_mur,
          protection: debord_m > 0 ? 'debord' : null,
          debord: { debord_m, h_baie_m: h_plafond, b_m: 0.10, prolongement_m, n_joues },
          orientation: dir,
        }, zone);
        results_parois.push({ id: `mur_${r.id}_${dir}`, room: r.type, ...mur });
        if (mur.conforme === false) {
          violations.push({ article: '5', severity: 'major', element: `Mur ${r.type} ${dir}`, msg: mur.note });
        }
      }
    }

    // ── Art.6 — Baies ──
    for (const r of rooms) {
      for (const op of (r.openings ?? [])) {
        const side = op.side ?? op.direction ?? 'S';
        const is_service = !PP.has(r.type);
        const s_baie = (op.width ?? 1.0) * (op.height ?? 1.20);
        if (is_service && s_baie < 0.5) continue;

        if (op.menuiserie_type === 'porte_opaque' && !op.participe_ventilation) {
          results_baies.push({
            id: op.id, room: r.type, orientation: side,
            conforme: true, exemption: true, note: 'Porte opaque hors ventilation — exemptée',
          });
          continue;
        }

        const baie_config = {
          menuiserie_type: op.menuiserie_type ?? 'fen_battante',
          protection_type: op.protection_type ?? null,
          debord: op.debord ?? (debord_m > 0 ? {
            debord_m, h_baie_m: op.height ?? 1.20, b_m: 0.10, prolongement_m, n_joues,
          } : null),
          orientation: side,
        };

        const result = await this.checkBaie(baie_config, zone);
        results_baies.push({ id: op.id ?? `op_${r.id}_${side}`, room: r.type, ...result });

        if (result.conforme === false) {
          violations.push({
            article: '6', severity: 'major',
            element: `Baie ${r.type} ${side}`,
            msg: result.note, suggestion: result.suggestion,
          });
        }
      }
    }

    // Score
    const total = results_baies.length + results_parois.length;
    const ok = [...results_baies, ...results_parois].filter(r => r.conforme === true).length;
    const score = total > 0 ? Math.round(ok / total * 100) : 100;

    return {
      ok: true, zone, altitude, score,
      results_parois, results_baies, violations,
      summary: `Art.5+6 : ${ok}/${total} conformes — score ${score}/100`,
      generatedAt: new Date().toISOString(),
    };
  },

  // ── Suggestions correctives ────────────────────────────────────────────────

  async _suggestProtection(S_actuel, Smax, orientation, So, debord_actuel, zone) {
    await _ensureTables();
    const suggestions = [];
    const dir = Orientation.cardinalToRtaaKey(orientation.toUpperCase());

    // Option 1 : augmenter le débord
    const target_Cm = Smax / So;
    if (target_Cm < 1.0) {
      const secteur = (dir === 'S' || dir === 'SE' || dir === 'SO') ? 'reunion_sud' :
                      (dir === 'E' || dir === 'NE') ? 'reunion_est' :
                      (dir === 'W' || dir === 'NO') ? 'reunion_ouest' : 'reunion_nord';
      const table = TABLES.Cm_forfaitaire[secteur];
      if (table) {
        // Débord simple
        for (let i = 0; i < table.debord_fini.length; i++) {
          if (table.debord_fini[i] <= target_Cm) {
            const h = debord_actuel?.h_baie_m ?? 1.20;
            const d = table.dh[i] * (h + 0.10);
            suggestions.push({
              type: 'debord_toit', profondeur_m: +d.toFixed(2),
              Cm_fourni: table.debord_fini[i],
              label: `Débord ${d.toFixed(0)}cm`,
            });
            break;
          }
        }
        // Varangue 2m
        const h_ref = debord_actuel?.h_baie_m ?? 1.20;
        const dh_varangue = 2.0 / (h_ref + 0.10);
        const Cm_varangue = await this.getCmForfaitaire(secteur, 'debord_fini', dh_varangue);
        if (Cm_varangue * So <= Smax) {
          suggestions.push({
            type: 'varangue', profondeur_m: 2.0,
            Cm_fourni: Cm_varangue,
            label: `Varangue 2m (Cm=${Cm_varangue})`,
          });
        }
        // Casquette 60cm
        const dh_casquette = 0.60 / (h_ref + 0.10);
        const Cm_casquette = await this.getCmForfaitaire(secteur, 'debord_fini', dh_casquette);
        suggestions.push({
          type: 'casquette', profondeur_m: 0.60,
          Cm_fourni: Cm_casquette,
          label: `Casquette 60cm (Cm=${Cm_casquette})`,
        });
      }
    }

    // Option 2 : changer la menuiserie
    if (So > 0.40) {
      suggestions.push({ type: 'menuiserie', label: `Jalousie opaque (So=0.40)` });
    }
    if (So > 0.30) {
      suggestions.push({ type: 'menuiserie', label: `Brise-soleil vertical (So=0.30)` });
    }

    return suggestions;
  },

  /**
   * Proxy rapide : score RTAA depuis les façades d'un polygone (sans rooms)
   * Utilisé par ParetoScorer pour scorer rapidement 6 propositions
   * @param {Array<{x,y}>} polygon
   * @param {string} zone
   * @returns {Promise<number>} score 0-1
   */
  async quickScoreFromPolygon(polygon, zone) {
    await _ensureTables();
    if (!polygon || polygon.length < 3 || zone === 'reunion_zone3') return 1.0;

    const facades = Orientation.extractFacades(polygon);
    const table = TABLES.S_max_baies[zone];
    if (!table) return 1.0;

    let totalLen = 0, favorableLen = 0;
    for (const f of facades) {
      const key = Orientation.cardinalToRtaaKey(f.cardinal);
      const smax = table[key] ?? 0.60;
      totalLen += f.length;
      // Smax élevé = favorable (peu de contrainte solaire)
      if (smax >= 0.70) favorableLen += f.length;
      else if (smax >= 0.60) favorableLen += f.length * 0.7;
      else favorableLen += f.length * 0.3;
    }

    return totalLen > 0 ? Math.round(favorableLen / totalLen * 100) / 100 : 0.5;
  },
};

export default RTAAChecker;
