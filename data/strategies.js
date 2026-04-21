/**
 * TERLAB · data/strategies.js
 * Declarations parametriques des strategies d'implantation.
 *
 * Chaque strategie a :
 *   - id, name, short : identification
 *   - axis : axe de reference (remplissage, lineaire-voie, perpendiculaire-voie, parcours-inlet)
 *   - anchor : type d'ancrage (libre, voie, fond, mitG, mitD, suit-limites)
 *   - multiplyLaw(N, ctx) : calcule nBlocs, gapM, blocDims selon N logements
 *   - generate(inlet, N, prog, AS) : delegue a AutoPlanStrategies, retourne [{polygon,...}]
 *   - degeneration : {minN, fallback} si N trop faible pour la strategie
 *   - mutation : [{fromN, to}] si N depasse la capacite de la strategie
 *   - emprFac : facteur d'emprise (0.55-1.0)
 *   - nv : niveaux par defaut
 *   - eff : rendement (SDP utile / emprise)
 *   - applicable(ctx) : test si la strategie est utilisable sur cette parcelle
 */

const H_NIV = 3;
const MIN_W = 4;
const MIN_L = 5;

export const STRATEGIES = {

  densite: {
    id: 'A1', name: 'Densite', short: 'Densite',
    nv: 3, eff: 0.80, emprFac: 1.00,
    axis: 'remplissage', anchor: 'libre',
    desc: 'Rectangle max densite aligne sur l\'axe principal',
    multiplyLaw: (N, ctx) => {
      const monoCap = ctx.rtaaW * ctx.profMax;
      const spPerNiv = monoCap * ctx.eff;
      const lgtsPerNiv = Math.floor(spPerNiv / ctx.spMoy);
      if (N <= lgtsPerNiv * ctx.nvMax) return { nBlocs: 1 };
      return { nBlocs: Math.min(4, Math.ceil(N / (lgtsPerNiv * ctx.nvMax))), gapM: 4.5 };
    },
    generate: (inlet, N, prog, AS) => {
      const pir = AS._pir(inlet);
      const law = STRATEGIES.densite.multiplyLaw(N, prog);
      if (law.nBlocs > 1) {
        return AS.multiRect(inlet, prog.rtaaW, prog.profMax, law.gapM ?? 4.5, law.nBlocs);
      }
      return AS.rect(inlet, prog.wTarget, prog.lTarget, pir);
    },
    applicable: () => true,
  },

  multi: {
    id: 'A2', name: 'Multi-blocs', short: 'Multi',
    nv: 3, eff: 0.78, emprFac: 0.92,
    axis: 'lineaire-voie', anchor: 'libre',
    desc: 'Plusieurs blocs en bande (parcelles longues/etroites)',
    multiplyLaw: (N, ctx) => ({
      nBlocs: N <= 4 ? 1 : N <= 8 ? 2 : N <= 14 ? 3 : 4,
      gapM: 4.5,
    }),
    generate: (inlet, N, prog, AS) => {
      const law = STRATEGIES.multi.multiplyLaw(N, prog);
      return AS.multiRect(inlet, prog.wTarget, prog.lTarget, law.gapM, law.nBlocs);
    },
    applicable: (ctx) => ctx.obbRatio >= 1.5,
  },

  equilibre: {
    id: 'B1', name: 'Equilibre', short: 'Equilibre',
    nv: 3, eff: 0.82, emprFac: 0.90,
    axis: 'lineaire-fond', anchor: 'libre',
    desc: 'Oblique aligne sur arete dominante non-voirie',
    multiplyLaw: (N, ctx) => {
      const monoCap = ctx.rtaaW * ctx.profMax;
      if (N * ctx.spMoy / (ctx.eff * ctx.nvMax) > monoCap) {
        return { nBlocs: 2, gapM: 4.5 };
      }
      return { nBlocs: 1 };
    },
    generate: (inlet, N, prog, AS) => {
      const law = STRATEGIES.equilibre.multiplyLaw(N, prog);
      if (law.nBlocs > 1) {
        return AS.multiRect(inlet, prog.wTarget, prog.lTarget, law.gapM, law.nBlocs);
      }
      return AS.oblique(inlet, prog.parcelPoly, prog.edgeTypes, prog.wTarget, prog.lTarget);
    },
    applicable: () => true,
  },

  permeable: {
    id: 'B2', name: 'Permeable', short: 'Permeable',
    nv: 2, eff: 0.85, emprFac: 0.70,
    axis: 'remplissage', anchor: 'libre',
    desc: 'Rectangle compact, emprise reduite',
    multiplyLaw: () => ({ nBlocs: 1 }),
    generate: (inlet, N, prog, AS) => {
      const pir = AS._pir(inlet);
      return AS.rect(inlet, prog.wTarget, prog.lTarget, pir);
    },
    applicable: () => true,
  },

  lshape: {
    id: 'B3', name: 'L-shape', short: 'L',
    nv: 2, eff: 0.82, emprFac: 0.85,
    axis: 'remplissage', anchor: 'libre',
    desc: 'Empreinte en L sur parcelles larges',
    multiplyLaw: () => ({ nBlocs: 1 }),
    generate: (inlet, N, prog, AS) => {
      const pir = AS._pir(inlet);
      return AS.lShape(inlet, prog.wTarget, prog.lTarget, pir);
    },
    applicable: (ctx) => ctx.obbW >= 15 && ctx.obbL >= 15,
  },

  trapeze: {
    id: 'B4', name: 'Trapeze', short: 'Trapeze',
    nv: 2, eff: 0.80, emprFac: 0.82,
    axis: 'lineaire-voie', anchor: 'voie',
    desc: 'Adapte aux parcelles en trapeze',
    requires: 'trapezoid',
    multiplyLaw: () => ({ nBlocs: 1 }),
    generate: (inlet, N, prog, AS) => {
      return AS.trapezoid(inlet, prog.parcelPoly, prog.edgeTypes, prog.wTarget, prog.lTarget);
    },
    applicable: (ctx) => ctx.isTrapezoid,
  },

  aide: {
    id: 'C1', name: 'Aide', short: 'Aide',
    nv: 2, eff: 0.88, emprFac: 0.75,
    axis: 'lineaire-voie', anchor: 'voie',
    desc: 'Oblique aligne sur la rue, R+1',
    multiplyLaw: () => ({ nBlocs: 1 }),
    generate: (inlet, N, prog, AS) => {
      return AS.oblique(inlet, prog.parcelPoly, prog.edgeTypes, prog.wTarget, prog.lTarget);
    },
    applicable: () => true,
  },

  epouse: {
    id: 'C2', name: 'Epouse', short: 'Epouse',
    nv: 3, eff: 0.75, emprFac: 0.55,
    axis: 'parcours-inlet', anchor: 'suit-limites',
    desc: 'Epouse la zone constructible, emprise min',
    multiplyLaw: () => ({ nBlocs: 1 }),
    generate: (inlet, N, prog, AS) => {
      return AS.zone(inlet, 0.5, prog.cibleM2);
    },
    applicable: () => true,
  },

  hull: {
    id: 'C2b', name: 'Hull', short: 'Hull',
    nv: 3, eff: 0.78, emprFac: 0.65,
    axis: 'parcours-inlet', anchor: 'suit-limites',
    desc: 'Hull de la zone avec surface cible',
    multiplyLaw: (N) => ({
      epaisseurM: Math.max(8, Math.min(15, 8 + N * 0.4)),
    }),
    generate: (inlet, N, prog, AS) => {
      return AS.zoneHull(inlet, prog.cibleM2);
    },
    applicable: () => true,
  },

  isohypses: {
    id: 'D1', name: 'Isohypses', short: 'Isohypses',
    nv: 2, eff: 0.80, emprFac: 0.70,
    axis: 'perpendiculaire-pente', anchor: 'libre',
    desc: 'Batiment perpendiculaire a la pente',
    requires: 'slope',
    multiplyLaw: () => ({ nBlocs: 1 }),
    generate: (inlet, N, prog, AS) => {
      const pir = AS._pir(inlet);
      return AS.isohypses(inlet, prog.wTarget, prog.lTarget, pir, prog.azimut, prog.profMax);
    },
    applicable: (ctx) => ctx.hasSlope,
  },

  biBarre: {
    id: 'BB', name: 'Bi-barre', short: 'Bi-barre',
    nv: 3, eff: 0.82, emprFac: 0.85,
    axis: 'lineaire-voie', anchor: 'libre',
    desc: '2 barres paralleles reliees par un noyau',
    degeneration: { minN: 3, fallback: 'multi' },
    mutation: [{ fromN: 12, to: 'troisLames' }],
    multiplyLaw: (N, ctx) => ({
      nBlocs: 2,
      gapM: Math.max(ctx.interBat ?? 4, 6),
    }),
    generate: (inlet, N, prog, AS) => {
      // Degeneration : < 3 lgts → mono
      if (N < 3) return AS.rect(inlet, prog.wTarget, prog.lTarget, AS._pir(inlet));
      const law = STRATEGIES.biBarre.multiplyLaw(N, prog);
      return AS.biBarre(inlet, null, law.gapM);
    },
    applicable: (ctx) => ctx.obbL >= 20,
  },

  deuxLames: {
    id: '2L', name: '2 Lames', short: '2 Lames',
    nv: 2, eff: 0.80, emprFac: 0.75,
    axis: 'perpendiculaire-voie', anchor: 'libre',
    desc: '2 rectangles max inscrits dans chaque moitie de zone',
    multiplyLaw: () => ({ nBlocs: 2, gapM: 6 }),
    generate: (inlet, N, prog, AS) => {
      const law = STRATEGIES.deuxLames.multiplyLaw(N, prog);
      return AS.deuxLames(inlet, law.gapM);
    },
    applicable: (ctx) => ctx.obbW >= 20,
  },

  troisLames: {
    id: '3L', name: '3 Lames', short: '3 Lames',
    nv: 3, eff: 0.78, emprFac: 0.82,
    axis: 'perpendiculaire-voie', anchor: 'libre',
    desc: '3 bandes paralleles (parcelles longues/larges >= 12x12 m utiles)',
    multiplyLaw: () => ({ nBlocs: 3, gapM: 5 }),
    generate: (inlet, N, prog, AS) => {
      const law = STRATEGIES.troisLames.multiplyLaw(N, prog);
      return AS.troisLames(inlet, law.gapM);
    },
    applicable: (ctx) => ctx.obbW >= 25 && ctx.obbL >= 25,
  },
};

// Helper : PIR depuis un polygone [[x,y],...]
// Ajouté sur AS dans l'import pour que generate puisse l'utiliser
if (typeof window !== 'undefined' && window.AutoPlanStrategies) {
  const AS = window.AutoPlanStrategies;
  if (!AS._pir) {
    AS._pir = function(env) {
      // Simple centroide pour fallback
      let cx = 0, cy = 0;
      const pts = env.map(p => [p[0] ?? p.x ?? 0, p[1] ?? p.y ?? 0]);
      for (const [x, y] of pts) { cx += x; cy += y; }
      cx /= pts.length; cy /= pts.length;
      return { x: cx, y: cy };
    };
  }
}

/**
 * Retourne la liste ordonnee des strategies avec applicabilite testee.
 * @param {Object} ctx - contexte parcelle { obbW, obbL, obbRatio, hasSlope, isTrapezoid, interBat }
 * @returns {Array<Object>}
 */
export function listStrategies(ctx = {}) {
  return Object.values(STRATEGIES).map(s => ({
    ...s,
    isApplicable: s.applicable ? s.applicable(ctx) : true,
    requiresMet: !s.requires || (s.requires === 'slope' && ctx.hasSlope) || (s.requires === 'trapezoid' && ctx.isTrapezoid),
  }));
}

/**
 * Execute une strategie avec degeneration/mutation automatique.
 * @param {string} stratId - id de la strategie
 * @param {Array} inlet - polygone inlet [[x,y],...]
 * @param {number} N - nombre de logements cible
 * @param {Object} prog - contexte programme { wTarget, lTarget, rtaaW, profMax, eff, nvMax, spMoy, cibleM2, parcelPoly, edgeTypes, azimut }
 * @returns {{ blocs: Array, strategy: string, warnings: Array<string> }}
 */
export function executeStrategy(stratId, inlet, N, prog) {
  const AS = typeof window !== 'undefined' ? window.AutoPlanStrategies : null;
  if (!AS) return { blocs: [], strategy: stratId, warnings: ['AutoPlanStrategies non charge'] };

  let strat = STRATEGIES[stratId];
  if (!strat) return { blocs: [], strategy: stratId, warnings: [`Strategie ${stratId} inconnue`] };

  const warnings = [];

  // Degeneration : N trop faible pour cette strategie
  if (strat.degeneration && N < strat.degeneration.minN) {
    const fallbackId = strat.degeneration.fallback;
    warnings.push(`${strat.short} degenere en ${fallbackId} (N=${N} < min=${strat.degeneration.minN})`);
    strat = STRATEGIES[fallbackId] ?? strat;
  }

  // Mutation : N depasse la capacite → passer a une autre strategie
  if (strat.mutation) {
    for (const m of strat.mutation) {
      if (N >= m.fromN && STRATEGIES[m.to]) {
        warnings.push(`${strat.short} mute en ${m.to} (N=${N} >= ${m.fromN})`);
        strat = STRATEGIES[m.to];
        break;
      }
    }
  }

  // Executer
  let blocs;
  try {
    blocs = strat.generate(inlet, N, prog, AS) ?? [];
  } catch (e) {
    warnings.push(`generate() echoue: ${e.message}`);
    blocs = [];
  }

  // Si aucun bloc produit, fallback rect
  if (!blocs.length) {
    warnings.push(`${strat.short} n'a produit aucun bloc — fallback rect`);
    try {
      const pir = AS._pir?.(inlet) ?? { x: 0, y: 0 };
      blocs = AS.rect(inlet, prog.wTarget ?? 10, prog.lTarget ?? 12, pir) ?? [];
    } catch { /* rect fallback failed */ }
  }

  return { blocs, strategy: strat.id, warnings };
}

if (typeof window !== 'undefined') {
  window.StrategyRegistry = { STRATEGIES, listStrategies, executeStrategy };
}
