// ═══════════════════════════════════════════════════════════════════════════
// MODES D'ARÊTE → POIDS DU SQUELETTE
//
// L'IDÉE CENTRALE DU NOYAU TOITURE :
//   un seul paramètre par arête — sa vitesse de recul horizontale par mètre
//   de montée — encode à la fois la pente du pan ET le fait qu'il n'y ait
//   pas de pan du tout.
//
//        s_i = cot(θ_i)          θ_i = pente du pan porté par l'arête i
//        s_i = 0                 l'arête ne recule pas  →  PLAN VERTICAL
//                                                       →  PIGNON
//
// Conséquence : le temps t du squelette EST la hauteur au-dessus de l'égout,
// en mètres. Le recul horizontal de l'arête i à la hauteur t vaut s_i · t.
// Plus aucun tan() dans l'élévation.
//
// S1 implémente les deux modes à poids constant. Les modes à poids variable
// dans le temps (demi_croupe, croupe_hollandaise, mansard, pagode) sont S6 et
// réutilisent exactement le même mécanisme, par paliers.
//
// Porté depuis bimshow-vision (POC ciriani-santillana, module `edge-modes`).
// ═══════════════════════════════════════════════════════════════════════════

export const DEG = Math.PI / 180;

/** cot(θ) avec θ en degrés. θ→0 ⇒ +∞ (pente nulle = recul infini). */
export function cotDeg(deg) {
  const t = Math.tan(deg * DEG);
  if (!isFinite(t)) return 0;          // θ = 90° → vertical → s = 0
  if (Math.abs(t) < 1e-12) return Infinity;
  return 1 / t;
}

/** Réciproque : pente en degrés depuis un poids. */
export function pitchFromWeight(s) {
  if (s === 0) return 90;
  if (!isFinite(s)) return 0;
  return Math.atan(1 / s) / DEG;
}

export const EDGE_MODES = {
  /** Pan de toiture incliné. Paramètre : pente en degrés. */
  croupe: {
    label: 'Croupe (pan incliné)',
    needsPitch: true,
    weight: (spec) => cotDeg(spec.pente),
  },
  /** Plan vertical : pas de pan, un mur pignon. Le moteur de murs le reprend. */
  pignon: {
    label: 'Pignon (plan vertical)',
    needsPitch: false,
    weight: () => 0,
  },
};

export const MODE_IDS = Object.keys(EDGE_MODES);

/**
 * Spécification d'arête. Une par arête de l'emprise, dans l'ordre.
 *   { id, mode: 'croupe'|'pignon', pente?: deg, debord?: m }
 */
export function normalizeEdgeSpecs(specs, n, defaults = {}) {
  const pente = defaults.pente ?? 35;
  const debord = defaults.debord ?? 0.4;
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = specs?.[i] ?? {};
    const mode = s.mode ?? 'croupe';
    if (!EDGE_MODES[mode]) throw new Error(`Mode d'arête inconnu : "${mode}" (arête ${i})`);
    out.push({
      id: s.id ?? `e${i}`,
      mode,
      pente: s.pente ?? pente,
      debord: s.debord ?? debord,
    });
  }
  return out;
}

/** Vecteur des poids s_i depuis les specs d'arête. */
export function weightsFrom(edgeSpecs) {
  return edgeSpecs.map((s) => EDGE_MODES[s.mode].weight(s));
}

// ── Raccourcis pour construire des jeux d'arêtes ───────────────────────────

/** Toutes les arêtes en croupe à la même pente. → pavillon / croupe_4pans */
export const allCroupe = (n, pente) =>
  Array.from({ length: n }, () => ({ mode: 'croupe', pente }));

/** Certaines arêtes en pignon, le reste en croupe. */
export function croupeExcept(n, pignonIdx, pente) {
  const set = new Set(pignonIdx);
  return Array.from({ length: n }, (_, i) =>
    set.has(i) ? { mode: 'pignon' } : { mode: 'croupe', pente });
}
