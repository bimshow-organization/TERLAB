// terlab/services/rtaa-ventilation.js
// RTAA DOM 2016 — Vérification ventilation naturelle Art.9 + Art.10
// Port fidèle de HOUSEG-SPEECH engine/rtaa-ventilation-checker.js (569L)
// Converti de class → singleton object (pattern TERLAB)
// Ref : Arrêté 17 avril 2009 modifié 11 janvier 2016 — Art.9 + Art.10

import Orientation from '../utils/orientation.js';

// ── Constantes RTAA Art.9 ────────────────────────────────────────────────────

/** Taux d'ouverture minimaux par zone altitude et type de pièce */
const TAUX_MIN = {
  zone1: { sejour: 0.22, chambre: 0.18, chambre_parentale: 0.18 }, // ≤400m
  zone2: { sejour: 0.18, chambre: 0.14, chambre_parentale: 0.14 }, // 400-600m
  zone3: {},                                                          // >600m (exempt)
};

/** Coefficients de porosité Annexe II RTAA 2016 */
const COEFF_POROSITE = {
  battant:         0.87,
  coulissant_2v:   0.44,
  coulissant_4v:   0.70,
  galandage:       1.00,
  jalousie:        0.87,
  fixe:            0.00,
  default_small:   0.87,  // <0.9m → battante
  default_medium:  0.44,  // 0.9-1.4m → coulissant 2v
  default_large:   0.70,  // ≥1.4m → coulissant 4v
};

/** Surfaces minimales ouvertures internes Art.9.4° */
const OI_MIN = { small: 1.6, medium: 1.8, large: 2.2 }; // <12m², 12-25m², >25m²

const H_FENETRE_DEFAULT = 1.20;
const H_PLAFOND_DEFAULT = 2.60;
const PIECES_PRINCIPALES = new Set(['sejour', 'chambre', 'chambre_parentale', 'bureau']);

// ── Fonctions utilitaires ────────────────────────────────────────────────────

function surfaceLibre(L_m, H_m = H_FENETRE_DEFAULT, type = null) {
  let coeff;
  if (type && COEFF_POROSITE[type] !== undefined) {
    coeff = COEFF_POROSITE[type];
  } else {
    if (L_m >= 1.4) coeff = COEFF_POROSITE.default_large;
    else if (L_m >= 0.9) coeff = COEFF_POROSITE.default_medium;
    else coeff = COEFF_POROSITE.default_small;
  }
  return Math.round(L_m * H_m * coeff * 1000) / 1000;
}

function surfaceFacade(dim_m, h_plafond = H_PLAFOND_DEFAULT) {
  return Math.round(dim_m * Math.min(h_plafond, 3.0) * 100) / 100;
}

// ── RTAAVentilation Singleton ────────────────────────────────────────────────

const RTAAVentilation = {

  /**
   * Zone RTAA ventilation depuis altitude
   * @param {number} altitude
   * @returns {'zone1'|'zone2'|'zone3'}
   */
  getZone(altitude) {
    if (altitude <= 400) return 'zone1';
    if (altitude <= 600) return 'zone2';
    return 'zone3';
  },

  /**
   * Vérification complète Art.9 + Art.10
   * @param {Array} rooms - [{id, type, w, h, openings:[{side, width, height, menuiserie}]}]
   * @param {Object} config - { altitude, h_plafond }
   * @returns {RtaaVentReport}
   */
  check(rooms, config = {}) {
    const altitude = config.altitude ?? 25;
    const h_plafond = config.h_plafond ?? H_PLAFOND_DEFAULT;
    const zone = this.getZone(altitude);
    const taux_min = TAUX_MIN[zone] ?? {};

    const rooms_pp = rooms.filter(r => PIECES_PRINCIPALES.has(r.type));
    if (rooms_pp.length === 0) {
      return { ok: false, score: 0, zone, altitude, note: 'Aucune pièce principale', violations: [] };
    }

    const roomsData = rooms_pp.map(r => this._buildRoomData(r, rooms, h_plafond));

    const results_910 = roomsData.map(r => this._check910(r, taux_min, h_plafond));
    const result_920 = this._check920(roomsData, taux_min, h_plafond);
    const results_930 = roomsData.map(r => this._check930(r));
    const results_940 = roomsData.map((r, i) => this._check940(r, results_930[i]));
    const results_10 = roomsData.map((r, i) => this._checkArt10(r, results_930[i]));

    // Score
    const n910 = results_910.filter(r => r.conforme).length;
    const n930 = results_930.filter(r => r.conforme).length;
    const total_pp = roomsData.length;

    const score_910 = total_pp > 0 ? Math.round(n910 / total_pp * 100) : 100;
    const score_920 = result_920.conforme ? 100 : result_920.conforme_restricted ? 80 : 40;
    const score_930 = total_pp > 0 ? Math.round(n930 / total_pp * 100) : 100;
    const score = Math.round(score_910 * 0.40 + score_920 * 0.20 + score_930 * 0.40);

    const violations = this._buildViolations(results_910, result_920, results_930, results_940);

    return {
      ok: true, zone, altitude, score,
      scores: { art910: score_910, art920: score_920, art930: score_930 },
      art910: results_910,
      art920: result_920,
      art930: results_930,
      art940: results_940,
      art10: results_10,
      violations,
      generatedAt: new Date().toISOString(),
    };
  },

  // ── Art.9.1° — Taux d'ouverture ───────────────────────────────────────────

  _check910(roomData, taux_min, h_plafond) {
    const { type, label, dims, ops_by_facade } = roomData;
    const taux_req = taux_min[type] ?? 0;

    if (taux_req === 0) {
      return { type, label, article: '9.1°', conforme: null, taux_req: 0, note: 'Non soumis' };
    }

    const { wm, hm } = dims;

    // Surface libre par façade
    const A_by_f = {};
    for (const [dir, ops] of Object.entries(ops_by_facade)) {
      A_by_f[dir] = ops.reduce((s, op) => s + op.s_libre, 0);
    }

    // Façade principale (plus d'ouvertures)
    const best_f = Object.entries(A_by_f).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'S';
    const A1 = A_by_f[best_f] ?? 0;
    const SP1 = surfaceFacade(best_f === 'N' || best_f === 'S' ? wm : hm, h_plafond);

    // A2 : autres façades si ratio > 10%
    let A2 = 0;
    for (const [dir, a] of Object.entries(A_by_f)) {
      if (dir === best_f || a === 0) continue;
      const sp = surfaceFacade(dir === 'N' || dir === 'S' ? wm : hm, h_plafond);
      if (sp > 0 && a / sp > 0.10) A2 += a;
    }

    const taux = SP1 > 0 ? (A1 + A2) / SP1 : 0;
    const conforme = taux >= taux_req;
    const deficit_m2 = conforme ? 0 : Math.max(0, taux_req * SP1 - A1 - A2);

    return {
      type, label, article: '9.1°', conforme,
      taux: Math.round(taux * 1000) / 10,
      taux_req: Math.round(taux_req * 100),
      SP1: Math.round(SP1 * 100) / 100,
      A1: Math.round(A1 * 1000) / 1000,
      A2: Math.round(A2 * 1000) / 1000,
      facade_principale: best_f,
      deficit_m2: Math.round(deficit_m2 * 100) / 100,
      note: conforme
        ? `✓ (A1+A2)/SP1 = ${Math.round(taux * 1000) / 10}% ≥ ${Math.round(taux_req * 100)}%`
        : `✗ Déficit ${Math.round(deficit_m2 * 100) / 100}m² — agrandir baies façade ${best_f}`,
    };
  },

  // ── Art.9.2° — Équilibre des façades ──────────────────────────────────────

  _check920(roomsData, taux_min, h_plafond) {
    const A_global = { N: 0, S: 0, E: 0, W: 0 };

    for (const r of roomsData) {
      for (const [dir, ops] of Object.entries(r.ops_by_facade)) {
        const key = Orientation.cardinalToRtaaKey(dir);
        A_global[key] = (A_global[key] ?? 0) + ops.reduce((s, op) => s + op.s_libre, 0);
      }
    }

    const total = Object.values(A_global).reduce((s, v) => s + v, 0);
    if (total === 0) return { article: '9.2°', conforme: null, note: 'Aucune ouverture' };

    const max_entry = Object.entries(A_global).sort((a, b) => b[1] - a[1])[0];
    const max_pct = max_entry[1] / total * 100;
    const conforme = max_pct <= 70;

    // Restriction §2
    const sejour = roomsData.find(r => r.type === 'sejour');
    let conforme_restricted = conforme;
    if (!conforme && sejour) {
      const SP1_s = surfaceFacade(Math.max(sejour.dims.wm, sejour.dims.hm), h_plafond);
      const A_min = SP1_s * (taux_min.sejour ?? 0.22);
      const A_restricted = Math.min(max_entry[1], A_min);
      const total_r = total - max_entry[1] + A_restricted;
      conforme_restricted = total_r > 0 ? (A_restricted / total_r * 100) <= 70 : false;
    }

    return {
      article: '9.2°', conforme, conforme_restricted,
      by_facade: Object.fromEntries(Object.entries(A_global).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
      total: Math.round(total * 1000) / 1000,
      max_facade: max_entry[0],
      max_pct: Math.round(max_pct * 10) / 10,
      note: conforme
        ? `✓ Façade ${max_entry[0]} à ${Math.round(max_pct * 10) / 10}% < 70%`
        : conforme_restricted
          ? `✓ Conforme après restriction §2`
          : `✗ Façade ${max_entry[0]} à ${Math.round(max_pct * 10) / 10}% > 70%`,
    };
  },

  // ── Art.9.3° — Balayage traversant ────────────────────────────────────────

  _check930(roomData) {
    const { type, label, dims, ops_by_facade } = roomData;
    const diag = dims.diag;
    const diag_half = diag / 2;

    // Baies valables : s_libre > 0.5m²
    const valid_ops = [];
    for (const [dir, ops] of Object.entries(ops_by_facade)) {
      for (const op of ops) {
        if (op.s_libre > 0.5) valid_ops.push({ ...op, dir });
      }
    }

    if (valid_ops.length < 2) {
      return {
        type, label, article: '9.3°', conforme: false,
        diag_m: Math.round(diag * 100) / 100,
        note: `✗ ${valid_ops.length} baie(s) valable(s) — minimum 2`,
      };
    }

    // Chercher paire façades différentes avec dist > diag/2
    let best_pair = null, best_dist = 0;
    for (let i = 0; i < valid_ops.length; i++) {
      for (let j = i + 1; j < valid_ops.length; j++) {
        if (valid_ops[i].dir === valid_ops[j].dir) continue;
        // Distance estimée depuis les façades
        const dirs_horiz = new Set(['N', 'S']);
        const dist = dirs_horiz.has(valid_ops[i].dir) !== dirs_horiz.has(valid_ops[j].dir)
          ? Math.hypot(dims.wm, dims.hm) // diagonale
          : Math.max(dims.wm, dims.hm);  // façades opposées
        if (dist > diag_half && dist > best_dist) {
          best_dist = dist;
          best_pair = { dir1: valid_ops[i].dir, dir2: valid_ops[j].dir, dist: Math.round(dist * 100) / 100 };
        }
      }
    }

    const conforme = best_pair !== null;
    return {
      type, label, article: '9.3°', conforme,
      diag_m: Math.round(diag * 100) / 100,
      diag_half: Math.round(diag_half * 100) / 100,
      best_pair,
      note: conforme
        ? `✓ Paire ${best_pair.dir1}↔${best_pair.dir2} dist=${best_pair.dist}m > ${Math.round(diag_half * 100) / 100}m`
        : `✗ Aucune paire avec dist > ${Math.round(diag_half * 100) / 100}m`,
    };
  },

  // ── Art.9.4° — Ouvertures internes ────────────────────────────────────────

  _check940(roomData, result930) {
    const { type, label, area_m2 } = roomData;
    if (result930.conforme) {
      return { type, label, article: '9.4°', requis: false, note: '✓ Balayage 9.3° confirmé' };
    }
    const oi_min = area_m2 < 12 ? OI_MIN.small : area_m2 < 25 ? OI_MIN.medium : OI_MIN.large;
    return {
      type, label, article: '9.4°', requis: true, oi_min,
      note: `Ouverture interne requise : ${oi_min}m²`,
    };
  },

  // ── Art.10 — Ventilateur de plafond ───────────────────────────────────────

  _checkArt10(roomData, result930) {
    const { type, label, area_m2 } = roomData;
    const has_balayage = result930.conforme;

    let obligation;
    if (type === 'chambre' || type === 'chambre_parentale') {
      obligation = has_balayage ? 'Attente électrique' : 'Ventilateur FIXE obligatoire';
    } else if (type === 'sejour') {
      obligation = `${area_m2 >= 20 ? 2 : 1} attente(s) électrique(s)`;
    } else {
      obligation = 'Attente électrique recommandée';
    }

    return { type, label, article: '10', obligation, note: `Art.10 : ${obligation}` };
  },

  // ── Helpers ────────────────────────────────────────────────────────────────

  _buildRoomData(room, allRooms, h_plafond) {
    const wm = room.w ?? 0;
    const hm = room.h ?? 0;
    const diag = Math.hypot(wm, hm);
    const ops_by_facade = { N: [], S: [], E: [], W: [] };

    if (room.openings?.length > 0) {
      for (const op of room.openings) {
        const dir = Orientation.cardinalToRtaaKey(op.side ?? op.direction ?? 'S');
        const L = op.width ?? 1.0;
        const H = op.height ?? H_FENETRE_DEFAULT;
        const sl = surfaceLibre(L, H, op.menuiserie ?? null);
        if (!ops_by_facade[dir]) ops_by_facade[dir] = [];
        ops_by_facade[dir].push({ L, H, s_libre: sl, menuiserie: op.menuiserie ?? null });
      }
    } else {
      // Estimation heuristique : baie minimum pour conformité
      const taux_req = TAUX_MIN.zone1[room.type] ?? 0.22;
      const SP1 = Math.max(wm, hm) * Math.min(h_plafond, 3.0);
      const A_needed = SP1 * taux_req;
      const L_main = A_needed / H_FENETRE_DEFAULT / COEFF_POROSITE.default_large;
      ops_by_facade.S.push({ L: +L_main.toFixed(2), H: H_FENETRE_DEFAULT, s_libre: +A_needed.toFixed(2), estimated: true });
      // Baie secondaire pour balayage
      if (PIECES_PRINCIPALES.has(room.type)) {
        ops_by_facade.N.push({ L: 0.9, H: H_FENETRE_DEFAULT, s_libre: surfaceLibre(0.9), estimated: true });
      }
    }

    return {
      id: room.id, type: room.type, label: room.label ?? room.type,
      area_m2: room.areaSqm ?? (wm * hm),
      dims: { wm, hm, diag },
      ops_by_facade,
    };
  },

  _buildViolations(results910, result920, results930, results940) {
    const violations = [];
    for (const r of results910) {
      if (r.conforme === false) {
        violations.push({ article: '9.1°', severity: 'major', room: r.type, label: r.label, msg: r.note, deficit_m2: r.deficit_m2 });
      }
    }
    if (result920.conforme === false && !result920.conforme_restricted) {
      violations.push({ article: '9.2°', severity: 'major', msg: result920.note });
    }
    for (const r of results930) {
      if (r.conforme === false) {
        violations.push({ article: '9.3°', severity: 'warn', room: r.type, label: r.label, msg: r.note });
      }
    }
    for (const r of results940) {
      if (r.requis) {
        violations.push({ article: '9.4°', severity: 'info', room: r.type, label: r.label, msg: r.note });
      }
    }
    return violations;
  },
};

export default RTAAVentilation;
