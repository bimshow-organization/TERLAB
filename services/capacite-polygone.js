// terlab/services/capacite-polygone.js
// Étude de capacité polygonale — lame de logements collectifs ARTICULÉE le
// long d'un axe dérivé de la zone constructible (« penser polygones, pas
// rectangles »). Porté et généralisé depuis les prototypes METAFORME_GEN :
//   - etude-capacite-v0.html (GEN.ARTICULE_COURSIVE : miter joints + merge)
//   - organigramme-viewer-collectif.html (typologies, mix, coursives)
// La différence clé : les angles ne sont plus des paramètres, ils sont DÉRIVÉS
// de la géométrie de la parcelle (axe = chaîne de bord de l'enveloppe).
// Vanilla JS ES2022+, zéro dépendance. Coordonnées : mètres locaux (cf. skill
// coord-systems — même convention que plan-masse-canvas).

// ── Constantes métier (référentiel proto + pratiques Réunion) ─────────
const LOGT_W = { T1: 5.0, T2: 7.0, T3: 8.5, T4: 10.0, T5: 12.0 };
const LOGT_SU = { T1: 31, T2: 49, T3: 68, T4: 87, T5: 100 }; // m² SU moyens (aligné SP_MOY pmc)
const LOGT_MIN_W = 4.2;   // largeur mini d'un logement (m)
const SEC_MAX_DIST = 25;  // distance max porte → escalier (m)
const ESC_SEC_W = 3;      // largeur escalier secondaire (m)
const NOYAU_W = 4;        // largeur noyau ESC+ASC (m)

const MIX_PRESETS = {
  mixte:    [{ type: 'T2', ratio: 0.4 }, { type: 'T3', ratio: 0.6 }],
  compact:  [{ type: 'T2', ratio: 1.0 }],
  familial: [{ type: 'T3', ratio: 0.5 }, { type: 'T4', ratio: 0.5 }],
  social:   [{ type: 'T1', ratio: 0.3 }, { type: 'T2', ratio: 0.4 }, { type: 'T3', ratio: 0.3 }],
};

// ── Primitives géométriques ───────────────────────────────────────────
function polyArea(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}
function ptInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function distPtSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  if (l2 < 1e-10) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
// Douglas-Peucker sur polyline ouverte — élimine les micro-arêtes (arcs inlet)
function simplifyDP(pts, eps) {
  if (pts.length <= 2) return pts;
  let maxD = 0, idx = 0;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distPtSeg(pts[i][0], pts[i][1], ax, ay, bx, by);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  const left = simplifyDP(pts.slice(0, idx + 1), eps);
  const right = simplifyDP(pts.slice(idx), eps);
  return [...left.slice(0, -1), ...right];
}

// ── Mix logements ─────────────────────────────────────────────────────
function mixCounts(perFloor, preset) {
  const p = MIX_PRESETS[preset] || MIX_PRESETS.mixte;
  const out = {};
  let leftover = perFloor;
  const sorted = p.slice().sort((a, b) => b.ratio - a.ratio);
  for (const m of sorted) {
    const c = Math.max(1, Math.round(perFloor * m.ratio));
    out[m.type] = Math.min(leftover, c);
    leftover -= out[m.type];
  }
  if (leftover > 0 && sorted[0]) out[sorted[0].type] += leftover;
  return Object.entries(out).map(([type, count]) => ({ type, count }));
}
// Suite répétable de largeurs suivant le preset (motif entrelacé)
function* mixStream(preset) {
  const p = MIX_PRESETS[preset] || MIX_PRESETS.mixte;
  const acc = p.map(() => 0);
  let total = 0;
  while (true) {
    // choisit le type le plus en retard sur son ratio
    let best = 0, bestGap = -Infinity;
    for (let i = 0; i < p.length; i++) {
      const gap = p[i].ratio - (total ? acc[i] / total : 0);
      if (gap > bestGap) { bestGap = gap; best = i; }
    }
    acc[best]++; total++;
    const type = p[best].type;
    yield { type, w: LOGT_W[type] ?? 7 };
  }
}
function labelForWidth(w) {
  if (w >= 12) return 'T5';
  if (w >= 10) return 'T4';
  if (w >= 8) return 'T3';
  if (w >= 6.5) return 'T2';
  if (w >= 4.2) return 'T1';
  return 'T0';
}

const CapacitePolygone = {

  LOGT_W, LOGT_SU, LOGT_MIN_W, SEC_MAX_DIST, MIX_PRESETS,

  // ────────────────────────────────────────────────────────────────────
  // Axe squelette : chaîne du bord de l'enveloppe côté voie (implantation
  // classique sur le recul avant), simplifiée. Le bâtiment s'étend vers
  // l'intérieur de l'enveloppe (profondeur), coursive côté axe.
  //
  // @param {Array} parcel     — [[x,y]...] parcelle locale
  // @param {string[]} edgeTypes — types par arête parcelle ('voie'|'lat'|'fond')
  // @param {Array} env        — [[x,y]...] enveloppe constructible (inlet)
  // @param {Object} opts      — { side:'voie'|'longest', simplifyEps:0.35 }
  // @returns {{ axis, normalSign, warnings }} axis = polyline [[x,y]...]
  // ────────────────────────────────────────────────────────────────────
  deriveAxis(parcel, edgeTypes, env, opts = {}) {
    const warnings = [];
    const side = opts.side ?? 'voie';
    const nE = env.length;
    if (nE < 3) return { axis: [], normalSign: 1, warnings: ['ENV_DEGENERE'] };

    // 1. Classer chaque arête env par l'arête parcelle la plus proche
    const nP = parcel.length;
    const envTypes = [];
    for (let i = 0; i < nE; i++) {
      const [x1, y1] = env[i], [x2, y2] = env[(i + 1) % nE];
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      let best = Infinity, bt = 'lat';
      for (let j = 0; j < nP; j++) {
        const d = distPtSeg(mx, my, parcel[j][0], parcel[j][1], parcel[(j + 1) % nP][0], parcel[(j + 1) % nP][1]);
        if (d < best) { best = d; bt = edgeTypes[j] ?? 'lat'; }
      }
      envTypes.push(bt);
    }

    // 2. Chaîne cible : la plus longue suite circulaire d'arêtes du type voulu
    const edgeLen = i => Math.hypot(env[(i + 1) % nE][0] - env[i][0], env[(i + 1) % nE][1] - env[i][1]);
    const pick = (want) => {
      let bestRun = null, cur = null;
      for (let k = 0; k < 2 * nE; k++) { // ×2 : gère le wrap circulaire
        const i = k % nE;
        const ok = want === null || envTypes[i] === want;
        if (ok) {
          if (!cur) cur = { start: i, len: 0, count: 0 };
          cur.len += edgeLen(i); cur.count++;
          if (cur.count >= nE) break; // tout le ring
          if (!bestRun || cur.len > bestRun.len) bestRun = { ...cur };
        } else cur = null;
      }
      return bestRun;
    };
    let run = side === 'voie' ? pick('voie') : null;
    if (!run || run.len < LOGT_MIN_W + NOYAU_W) {
      if (side === 'voie') warnings.push('VOIE_INTROUVABLE_FALLBACK_LONGEST');
      // Fallback : l'arête d'enveloppe la plus longue → lame droite (évite de
      // boucler sur tout le ring, cas parcelle drapeau à accès étroit).
      let bi = 0, bl = 0;
      for (let i = 0; i < nE; i++) { const l = edgeLen(i); if (l > bl) { bl = l; bi = i; } }
      run = { start: bi, count: 1, len: bl };
    }
    if (!run || run.len < 2) return { axis: [], normalSign: 1, warnings: [...warnings, 'AUCUNE_CHAINE'] };

    // 3b. Étendre la chaîne autour des coins — c'est l'ARTICULATION : la lame
    // se plie tant que
    //   · le virage reste ≤ maxTurn (45° : voie oblique/courbe ; les ailes à
    //     90° relèvent du multi-lames, pas du miter — camemberts dégénérés)
    //   · la bande de profondeur tient dans l'enveloppe
    //   · la nouvelle aile ne chevauche pas les segments déjà retenus
    const prof = opts.profondeur ?? 10.5;
    const maxTurn = (opts.maxTurnDeg ?? 45) * Math.PI / 180;
    const dirOf = i => {
      const [x1, y1] = env[i], [x2, y2] = env[(i + 1) % nE];
      const l = Math.hypot(x2 - x1, y2 - y1) || 1;
      return [(x2 - x1) / l, (y2 - y1) / l];
    };
    const inwardOf = i => {
      const [x1, y1] = env[i], [x2, y2] = env[(i + 1) % nE];
      const [tx, ty] = dirOf(i);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      return ptInPoly(mx - ty * 0.5, my + tx * 0.5, env) ? 1 : -1;
    };
    const accepted = []; // indices d'arêtes env retenues, dans l'ordre
    for (let k = 0; k < Math.min(run.count, nE); k++) accepted.push((run.start + k) % nE);
    const bandFits = (i, connectedTo) => {
      const [x1, y1] = env[i], [x2, y2] = env[(i + 1) % nE];
      const [tx, ty] = dirOf(i);
      const s = inwardOf(i);
      const nx = -ty * s, ny = tx * s;
      for (const t of [0.25, 0.75]) {
        const px = x1 + (x2 - x1) * t + nx * (prof - 0.25);
        const py = y1 + (y2 - y1) * t + ny * (prof - 0.25);
        if (!ptInPoly(px, py, env)) return false;
      }
      // anti-chevauchement : le fond de la nouvelle aile doit rester à ≥ prof
      // des fronts déjà retenus — seule l'arête de chaîne à laquelle elle se
      // connecte est exclue (PAS toutes les adjacentes du ring).
      const bmx = (x1 + x2) / 2 + nx * prof, bmy = (y1 + y2) / 2 + ny * prof;
      for (const a of accepted) {
        if (a === i || a === connectedTo) continue;
        const d = distPtSeg(bmx, bmy, env[a][0], env[a][1], env[(a + 1) % nE][0], env[(a + 1) % nE][1]);
        if (d < prof * 0.9) return false;
      }
      return true;
    };
    const turnOK = (iFrom, iTo) => {
      const [ax2, ay2] = dirOf(iFrom), [bx2, by2] = dirOf(iTo);
      return Math.abs(Math.atan2(ax2 * by2 - ay2 * bx2, ax2 * bx2 + ay2 * by2)) <= maxTurn;
    };
    // avant (fin de chaîne) puis arrière (début), sans refermer le ring
    while (accepted.length < nE - 1) {
      const last = accepted[accepted.length - 1];
      const next = (last + 1) % nE;
      if (accepted.includes(next) || !turnOK(last, next) || !bandFits(next, last)) break;
      accepted.push(next);
    }
    while (accepted.length < nE - 1) {
      const first = accepted[0];
      const prev = (first - 1 + nE) % nE;
      if (accepted.includes(prev) || !turnOK(prev, first) || !bandFits(prev, first)) break;
      accepted.unshift(prev);
    }

    // 3. Extraire la polyline de la chaîne étendue
    const raw = [env[accepted[0]]];
    for (const i of accepted) raw.push(env[(i + 1) % nE]);

    // 4. Simplifier (arcs inlet = micro-arêtes → articulations parasites)
    const axis = simplifyDP(raw, opts.simplifyEps ?? 0.35);
    if (axis.length < 2) return { axis: [], normalSign: 1, warnings: [...warnings, 'AXE_TROP_COURT'] };

    // 4b. Rentrer les extrémités de 0.4 m : les coins d'enveloppe sont des
    // arcs facettisés, le coin carré du bâtiment posé pile dessus déborde.
    // Jamais en-dessous du minimum viable (noyau + T1) — cas bande étroite.
    const axisLen = axis.reduce((s, p, i) => i ? s + Math.hypot(p[0] - axis[i - 1][0], p[1] - axis[i - 1][1]) : 0, 0);
    const dTrim = Math.min(0.4, Math.max(0, (axisLen - (NOYAU_W + LOGT_W.T1 + 0.2)) / 2));
    if (dTrim > 0.05) {
      const trim = (i0, i1) => {
        const [x1, y1] = axis[i0], [x2, y2] = axis[i1];
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len > dTrim + 1) axis[i0] = [x1 + (x2 - x1) / len * dTrim, y1 + (y2 - y1) / len * dTrim];
      };
      trim(0, 1);
      trim(axis.length - 1, axis.length - 2);
    }

    // 5. Côté intérieur : normale telle que axe + n pointe dans l'enveloppe
    const [ax, ay] = axis[0], [bx, by] = axis[1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const normalSign = ptInPoly(mx - dy / len * 0.8, my + dx / len * 0.8, env) ? 1 : -1;

    return { axis, normalSign, warnings };
  },

  // ────────────────────────────────────────────────────────────────────
  // Plateau articulé le long d'un axe polyline.
  // Généralisation de GEN.ARTICULE_COURSIVE : les angles sont lus sur l'axe,
  // joints en miter (tan(θ/2)), fusion des logements trop étroits au biais.
  //
  // @param {Array} axis    — [[x,y]...] polyline front (côté coursive)
  // @param {number} normalSign — +1/-1 : côté du bâtiment
  // @param {Object} p — { profondeur:11, coursH:1.5, varangue:true,
  //                       mixPreset:'mixte', niveaux:2, fill:true, perFloor }
  // @returns {{ items, footprint, metrics, warnings }} | null
  // items : { type, subtype?, poly:[[x,y]…4], label }
  // ────────────────────────────────────────────────────────────────────
  plateauAlongAxis(axis, normalSign, p = {}) {
    if (!axis || axis.length < 2) return null;
    const warnings = [];
    const prof = p.profondeur ?? 11;
    const coursH = p.coursH ?? 1.5;
    const varH = p.varangue === false ? 0 : 1.5;
    const interiorY = coursH, interiorH = prof - coursH - varH;
    if (interiorH < 4) return null;

    // Frames par segment : tangente, normale (côté bâtiment), longueur
    const nSeg = axis.length - 1;
    const seg = [];
    for (let s = 0; s < nSeg; s++) {
      const [x1, y1] = axis[s], [x2, y2] = axis[s + 1];
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
      seg.push({ ox: x1, oy: y1, tx: dx / len, ty: dy / len, nx: -dy / len * normalSign, ny: dx / len * normalSign, len });
    }
    // Demi-angles aux joints intérieurs : tan(θ/2) SIGNÉ.
    // θ > 0 = le virage mord côté bâtiment (le bord arrière raccourcit) —
    // c'est le cas qui impose la fusion des logements trop étroits.
    const jointTan = new Array(axis.length).fill(0);
    for (let j = 1; j < nSeg; j++) {
      const a = seg[j - 1], b = seg[j];
      const cross = a.tx * b.ty - a.ty * b.tx;
      const dot = a.tx * b.tx + a.ty * b.ty;
      const theta = Math.atan2(cross, dot); // virage signé (repère monde)
      // Signe côté bâtiment : virage vers la normale = mord dans le bâtiment
      jointTan[j] = Math.tan(theta / 2) * normalSign;
    }

    // Largeurs de cellules : flux du mix, remplissage de l'axe entier (fill)
    // ou perFloor imposé.
    const totalAxisLen = seg.reduce((s, x) => s + x.len, 0);
    const stream = mixStream(p.mixPreset ?? 'mixte');
    const cells = [];
    let used = NOYAU_W;
    if (p.fill !== false) {
      while (true) {
        let c = stream.next().value;
        if (used + c.w > totalAxisLen) {
          // essayer plus petit (T2 puis T1) avant d'abandonner — capacité max
          const rest = totalAxisLen - used;
          c = rest >= LOGT_W.T2 ? { type: 'T2', w: LOGT_W.T2 }
            : rest >= LOGT_W.T1 ? { type: 'T1', w: LOGT_W.T1 } : null;
          if (!c) break;
        }
        cells.push({ ...c });
        used += c.w;
      }
    } else {
      for (const m of mixCounts(p.perFloor ?? 5, p.mixPreset ?? 'mixte'))
        for (let i = 0; i < m.count; i++) cells.push({ type: m.type, w: LOGT_W[m.type] ?? 7 });
    }
    if (!cells.length) return null;

    // Répartir les cellules sur les segments (le noyau consomme le début du seg 0)
    const items = [];
    const toWorld = (s, x, y) => [s.ox + s.tx * x + s.nx * y, s.oy + s.ty * x + s.ny * y];
    // quad local d'une cellule [x1..x2]×[y1..y2] avec biais éventuels aux joints
    const quad = (s, x1, x2, y1, y2, lt, rt) => [
      toWorld(s, x1 + lt * y1, y1), toWorld(s, x2 - rt * y1, y1),
      toWorld(s, x2 - rt * y2, y2), toWorld(s, x1 + lt * y2, y2),
    ];

    let sIdx = 0, cursor = 0; // position courante le long du segment sIdx
    let mergedAtBiais = false;

    // Noyau au départ de l'axe
    {
      const s = seg[0];
      const lt = 0, rt = 0;
      items.push({ type: 'noyau', poly: quad(s, 0, NOYAU_W, 0, prof, lt, rt), label: 'Noyau' });
      items.push({ type: 'escalier', poly: quad(s, 0.4, 2.9, 0.4, 2.9, 0, 0), label: 'ESC' });
      items.push({ type: 'ascenseur', poly: quad(s, 0.4, 2.4, 3.2, 5.2, 0, 0), label: 'ASC' });
      cursor = NOYAU_W;
    }

    // Découpage : liste [{sIdx, x1, x2, cell, lt, rt}] — une cellule ne
    // franchit pas un joint : si elle ne tient pas, elle passe au segment
    // suivant et la précédente absorbe le reliquat (fusion au biais du proto).
    const placed = [];
    for (const cell of cells) {
      let s = seg[sIdx];
      let remaining = s.len - cursor - (sIdx < nSeg - 1 ? 0 : 0);
      if (cell.w > remaining) {
        // reliquat → absorbé par la cellule précédente du même segment
        if (remaining > 0.3 && placed.length && placed[placed.length - 1].sIdx === sIdx) {
          placed[placed.length - 1].x2 += remaining;
          const pc = placed[placed.length - 1];
          pc.cell = { type: labelForWidth(pc.x2 - pc.x1), w: pc.x2 - pc.x1 };
          mergedAtBiais = true;
        }
        if (sIdx >= nSeg - 1) break; // axe épuisé
        sIdx++; cursor = 0; s = seg[sIdx];
      }
      placed.push({ sIdx, x1: cursor, x2: cursor + cell.w, cell });
      cursor += cell.w;
    }
    if (!placed.length) return null;

    // Absorber le reliquat de fin d'axe dans la dernière cellule (jusqu'à
    // 13 m = plafond T5) — un front de façade inutilisé = capacité perdue.
    {
      const lastQ = placed[placed.length - 1];
      const s = seg[lastQ.sIdx];
      let leftover = s.len - lastQ.x2;
      // réserve pour l'ESC 2 si la lame sera longue
      const frontSoFar = placed.reduce((sum, q) => sum + (q.x2 - q.x1), 0);
      if (frontSoFar + NOYAU_W > SEC_MAX_DIST) leftover -= ESC_SEC_W;
      const add = Math.max(0, Math.min(leftover, 13 - (lastQ.x2 - lastQ.x1)));
      if (add > 0.3) {
        lastQ.x2 += add;
        lastQ.cell = { type: labelForWidth(lastQ.x2 - lastQ.x1), w: lastQ.x2 - lastQ.x1 };
      }
    }

    // Biais aux extrémités de segment + fusion si largeur arrière < mini
    const innerBottom = prof - varH;
    for (let s = 0; s < nSeg; s++) {
      const inSeg = placed.filter(q => q.sIdx === s);
      if (!inSeg.length) continue;
      const lt = jointTan[s] ?? 0, rt = jointTan[s + 1] ?? 0;
      // fusion côté droit (fin de segment) si le biais mord trop
      let last = inSeg[inSeg.length - 1];
      while (rt > 0 && inSeg.length >= 2 && (last.x2 - last.x1) - rt * innerBottom < LOGT_MIN_W) {
        const prev = inSeg[inSeg.length - 2];
        prev.x2 = last.x2;
        prev.cell = { type: labelForWidth(prev.x2 - prev.x1), w: prev.x2 - prev.x1 };
        placed.splice(placed.indexOf(last), 1);
        inSeg.pop();
        last = inSeg[inSeg.length - 1];
        mergedAtBiais = true;
      }
      // fusion côté gauche (début de segment)
      let first = inSeg[0];
      while (lt > 0 && inSeg.length >= 2 && (first.x2 - first.x1) - lt * innerBottom < LOGT_MIN_W) {
        const next = inSeg[1];
        next.x1 = first.x1;
        next.cell = { type: labelForWidth(next.x2 - next.x1), w: next.x2 - next.x1 };
        placed.splice(placed.indexOf(first), 1);
        inSeg.shift();
        first = inSeg[0];
        mergedAtBiais = true;
      }
      first = inSeg[0]; last = inSeg[inSeg.length - 1];
      for (const q of inSeg) {
        q.lt = (q === first && (s > 0 || false)) ? Math.max(0, lt) : 0;
        q.rt = (q === last && s < nSeg - 1) ? Math.max(0, rt) : 0;
        // biais négatif (virage ouvrant) : le coin s'étire, porté par le quad
        if (q === first && s > 0 && lt < 0) q.lt = lt;
        if (q === last && s < nSeg - 1 && rt < 0) q.rt = rt;
      }
    }

    // Émettre coursive + logements + varangue par segment
    const counts = {};
    for (let s = 0; s < nSeg; s++) {
      const inSeg = placed.filter(q => q.sIdx === s);
      if (!inSeg.length) continue;
      const S = seg[s];
      const x1 = inSeg[0].x1, x2 = inSeg[inSeg.length - 1].x2;
      const lt = inSeg[0].lt ?? 0, rt = inSeg[inSeg.length - 1].rt ?? 0;
      items.push({ type: 'coursive', poly: quad(S, x1, x2, 0, coursH, lt, rt), label: s === 0 ? 'Coursive' : '' });
      for (const q of inSeg) {
        items.push({
          type: 'logement', subtype: q.cell.type,
          poly: quad(S, q.x1, q.x2, interiorY, interiorY + interiorH, q.lt ?? 0, q.rt ?? 0),
          label: q.cell.type,
        });
        counts[q.cell.type] = (counts[q.cell.type] ?? 0) + 1;
      }
      if (varH > 0) items.push({ type: 'varangue', poly: quad(S, x1, x2, prof - varH, prof, lt, rt), label: s === 0 ? 'Varangues' : '' });
    }

    // Escalier secondaire si distance porte→ESC > 25 m
    const frontLen = placed.reduce((sum, q) => sum + (q.x2 - q.x1), 0);
    const needSec = frontLen - (placed[placed.length - 1].x2 - placed[placed.length - 1].x1) / 2 + NOYAU_W > SEC_MAX_DIST;
    if (needSec) {
      const lastQ = placed[placed.length - 1];
      const S = seg[lastQ.sIdx];
      items.push({ type: 'escalier', poly: quad(S, lastQ.x2, Math.min(S.len, lastQ.x2 + ESC_SEC_W), 0, prof, 0, 0), label: 'ESC 2' });
    }

    // Footprint : reconstruit depuis les cellules posées — front (biais nul à
    // y=0) + arrière avec miter aux joints (le point arrière de fin de segment
    // coïncide avec le point arrière de début du suivant : même construction
    // tan(θ/2), pas de couture).
    const front = [], back = [];
    {
      const lastQ = placed[placed.length - 1];
      front.push(toWorld(seg[0], 0, 0)); // inclut le noyau
      back.push(toWorld(seg[0], 0, prof));
      const segsWithCells = [...new Set(placed.map(q => q.sIdx))].sort((a, b) => a - b);
      for (const s of segsWithCells) {
        const inSeg = placed.filter(q => q.sIdx === s);
        const last = inSeg[inSeg.length - 1];
        const isEnd = (last === lastQ);
        const endX = last.x2 + (isEnd && needSec ? ESC_SEC_W : 0);
        const rt = isEnd ? 0 : (last.rt ?? 0);
        front.push(toWorld(seg[s], endX, 0));
        back.push(toWorld(seg[s], endX - rt * prof, prof));
      }
    }
    const footprint = [...front, ...back.reverse()];

    const perFloorN = Object.values(counts).reduce((s, c) => s + c, 0);
    const niveaux = Math.max(1, p.niveaux ?? 2);
    const su = Object.entries(counts).reduce((s, [t, c]) => s + (LOGT_SU[t] ?? 49) * c, 0);
    if (mergedAtBiais) warnings.push('LOGEMENTS_FUSIONNES_AU_BIAIS');

    return {
      items, footprint,
      metrics: {
        perFloor: perFloorN,
        counts,
        niveaux,
        logements: perFloorN * niveaux,
        su_par_niveau: su,
        su_totale: su * niveaux,
        emprise: polyArea(footprint),
        sdp: polyArea(footprint) * niveaux,
        needSec,
      },
      warnings,
    };
  },

  // ────────────────────────────────────────────────────────────────────
  // Orchestration : parcelle + enveloppe → axe → plateau → validation.
  // ────────────────────────────────────────────────────────────────────
  capacite(parcel, edgeTypes, env, params = {}) {
    const { axis, normalSign, warnings: aw } = this.deriveAxis(parcel, edgeTypes, env, params);
    if (!axis.length) return { ok: false, warnings: aw };
    const plateau = this.plateauAlongAxis(axis, normalSign, params);
    if (!plateau) return { ok: false, warnings: [...aw, 'PLATEAU_IMPOSSIBLE'] };
    // Guard confinement : sommets du footprint dans l'enveloppe. Tolérance
    // 0.35 m : les coins d'enveloppe sont des arcs facettisés (GeomInlet),
    // le coin carré du bâtiment peut mordre la flèche de l'arc sans enjeu.
    let outCount = 0;
    for (const [x, y] of plateau.footprint) {
      if (ptInPoly(x, y, env)) continue;
      let d = Infinity;
      for (let i = 0; i < env.length && d >= 0.35; i++) {
        const [x1, y1] = env[i], [x2, y2] = env[(i + 1) % env.length];
        d = Math.min(d, distPtSeg(x, y, x1, y1, x2, y2));
      }
      if (d >= 0.35) outCount++;
    }
    const warnings = [...aw, ...plateau.warnings];
    if (outCount) warnings.push(`FOOTPRINT_HORS_ENV_${outCount}PTS`);
    return { ok: true, axis, normalSign, ...plateau, warnings };
  },
};

export { CapacitePolygone };
export default CapacitePolygone;
if (typeof window !== 'undefined') window.CapacitePolygone = CapacitePolygone;
