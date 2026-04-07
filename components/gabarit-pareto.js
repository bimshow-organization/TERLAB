/**
 * ParetoSolver — Génère jusqu'à 6 solutions variant sur densité, hauteur, ratio plein/vide
 * TERLAB Phase 7 — ENSA La Réunion
 *
 * 3 archétypes (Compact / Équilibré / Aéré) × 2 variantes hauteur (hé / hf) = 6 solutions
 * Chaque solution est validée contre les contraintes PLU et classée en front de Pareto.
 */

export class ParetoSolver {

  solve(constraints, rules, params = {}) {
    if (!constraints?.emprise_constructible?.length) return [];

    const empriseM2 = this._area(constraints.emprise_constructible);
    const { volumes } = constraints;

    const configs = [
      { id: 'A1', emprise_pct: 95, hauteur: volumes.hf, type: 'compact_max',   label: 'Densit\u00e9 maximale', color: '#e74c3c' },
      { id: 'A2', emprise_pct: 90, hauteur: volumes.he, type: 'compact_he',    label: 'Compact \u00e9gout',    color: '#e67e22' },
      { id: 'B1', emprise_pct: 65, hauteur: volumes.hf, type: 'equilibre_hf',  label: '\u00c9quilibr\u00e9 haut',     color: '#27ae60' },
      { id: 'B2', emprise_pct: 60, hauteur: volumes.he, type: 'equilibre_he',  label: '\u00c9quilibr\u00e9 bas',      color: '#2ecc71' },
      { id: 'C1', emprise_pct: 40, hauteur: volumes.hf, type: 'aere_hf',      label: 'A\u00e9r\u00e9 + vert',       color: '#3498db' },
      { id: 'C2', emprise_pct: 35, hauteur: volumes.he, type: 'aere_he',      label: 'A\u00e9r\u00e9 plein-pied',   color: '#2980b9' },
    ];

    const solutions = configs.map(cfg =>
      this._makeSolution(cfg.id, cfg, empriseM2, rules, params, constraints)
    );

    // Filter invalid, compute Pareto ranks
    const valid = solutions.filter(s => s.valid);
    valid.forEach(s => { s.pareto_rank = this._paretoRank(s, valid); });
    return valid.sort((a, b) => a.pareto_rank - b.pareto_rank);
  }

  _makeSolution(id, config, empriseM2, rules, params, constraints) {
    const empriseUtilisee = empriseM2 * config.emprise_pct / 100;
    const nbNiveaux = Math.max(1, Math.floor(config.hauteur / 3.0));
    const sdpBrute = empriseUtilisee * nbNiveaux;
    const sdpNette = Math.round(sdpBrute * 0.85);
    const totalArea = constraints.metrics.surface_parcelle_m2;
    const permeableReel = totalArea - empriseUtilisee;
    const permeableMin = totalArea * rules.permeable_min_pct / 100;
    const nbLogementsEstimes = Math.floor(sdpNette / 65);

    const violations = [];
    if (permeableReel < permeableMin) {
      violations.push(`Perm\u00e9able insuffisant (${Math.round(permeableReel)}m\u00b2 < ${Math.round(permeableMin)}m\u00b2 requis)`);
    }
    if (sdpBrute <= 0) {
      violations.push('SDP nulle');
    }

    return {
      id,
      label: config.label,
      color: config.color,
      type: config.type,
      emprise_pct: config.emprise_pct,
      hauteur_m: config.hauteur,
      nb_niveaux: nbNiveaux,
      emprise_m2: Math.round(empriseUtilisee),
      sdp_brute_m2: Math.round(sdpBrute),
      sdp_nette_m2: sdpNette,
      permeable_m2: Math.round(permeableReel),
      permeable_pct: Math.round(permeableReel / totalArea * 100),
      nb_logements_estimes: nbLogementsEstimes,
      valid: violations.length === 0,
      violations,
      pareto_axes: {
        sdp: sdpNette,
        permeable: permeableReel,
        compacite: empriseUtilisee / empriseM2,
      },
      pareto_rank: 0,
    };
  }

  _paretoRank(solution, allSolutions) {
    let dominated_by = 0;
    for (const other of allSolutions) {
      if (other.id === solution.id) continue;
      const dominates = (
        other.pareto_axes.sdp >= solution.pareto_axes.sdp &&
        other.pareto_axes.permeable >= solution.pareto_axes.permeable &&
        (
          other.pareto_axes.sdp > solution.pareto_axes.sdp ||
          other.pareto_axes.permeable > solution.pareto_axes.permeable
        )
      );
      if (dominates) dominated_by++;
    }
    return dominated_by + 1;
  }

  _area(polygon) {
    if (!polygon || polygon.length < 3) return 0;
    let a = 0;
    for (let i = 0, n = polygon.length; i < n; i++) {
      const { x: x1, y: y1 } = polygon[i];
      const { x: x2, y: y2 } = polygon[(i + 1) % n];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2;
  }
}

if (typeof window !== 'undefined') {
  window.ParetoSolver = ParetoSolver;
}

export default ParetoSolver;
