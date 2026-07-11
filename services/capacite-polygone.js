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

    // ── Modèle « bande développée » : tout est posé en ABSCISSE CURVILIGNE
    // le long de l'axe. Une cellule peut TRAVERSER un joint (logement plié,
    // points miter internes) ; les coupes entre cellules sont
    // perpendiculaires — sa largeur est donc préservée le long de la bande
    // (plus de fusion dégénérée), et coursive/varangue/footprint partagent
    // exactement les mêmes points miter (plus de chevauchement aux joints).
    const items = [];
    const toWorld = (s, x, y) => [s.ox + s.tx * x + s.nx * y, s.oy + s.ty * x + s.ny * y];
    const cum = [0];
    for (let s = 0; s < nSeg; s++) cum.push(cum[s] + seg[s].len);
    const L = cum[nSeg];
    const locate = t => {
      let i = 0;
      while (i < nSeg - 1 && t > cum[i + 1] + 1e-9) i++;
      return { i, x: t - cum[i] };
    };
    // Bande [tA,tB] × [y0,y1] : suit l'axe, points miter aux joints traversés
    const span = (tA, tB, y0, y1) => {
      const A = locate(Math.max(0, tA)), B = locate(Math.min(tB, L));
      const top = [toWorld(seg[A.i], A.x, y0)];
      const bot = [toWorld(seg[A.i], A.x, y1)];
      for (let j = A.i + 1; j <= B.i; j++) {
        top.push(toWorld(seg[j], jointTan[j] * y0, y0));
        bot.push(toWorld(seg[j], jointTan[j] * y1, y1));
      }
      top.push(toWorld(seg[B.i], B.x, y0));
      bot.push(toWorld(seg[B.i], B.x, y1));
      return [...top, ...bot.reverse()];
    };

    if (L < NOYAU_W + LOGT_W.T1) return null;
    let mergedAtBiais = false;

    // Réserve ESC 2 en bout si la lame sera longue (porte → ESC ≤ 25 m)
    const needSec = L > SEC_MAX_DIST + 2;
    const LUtile = L - (needSec ? ESC_SEC_W : 0);

    // Noyau en tête d'axe
    items.push({ type: 'noyau', poly: span(0, NOYAU_W, 0, prof), label: 'Noyau' });
    items.push({ type: 'escalier', poly: span(0.4, 2.9, 0.4, 2.9), label: 'ESC' });
    items.push({ type: 'ascenseur', poly: span(0.4, 2.4, 3.2, 5.2), label: 'ASC' });

    // Cellules en abscisse curviligne
    const placed = [];
    let t = NOYAU_W;
    for (const cell of cells) {
      if (t + cell.w > LUtile + 0.01) break;
      placed.push({ t0: t, t1: t + cell.w, cell });
      t += cell.w;
    }
    if (!placed.length) return null;
    // Reliquat de façade absorbé par la dernière cellule (≤ 13 m = T5)
    {
      const lastQ = placed[placed.length - 1];
      const add = Math.max(0, Math.min(LUtile - lastQ.t1, 13 - (lastQ.t1 - lastQ.t0)));
      if (add > 0.3) {
        const oldType = lastQ.cell.type;
        lastQ.t1 += add;
        lastQ.cell = { type: labelForWidth(lastQ.t1 - lastQ.t0), w: lastQ.t1 - lastQ.t0 };
        if (lastQ.cell.type !== oldType) mergedAtBiais = true;
      }
    }
    const tEnd = placed[placed.length - 1].t1;

    const counts = {};
    items.push({ type: 'coursive', poly: span(NOYAU_W, tEnd, 0, coursH), label: 'Coursive' });
    for (const q of placed) {
      items.push({ type: 'logement', subtype: q.cell.type, poly: span(q.t0, q.t1, interiorY, interiorY + interiorH), label: q.cell.type });
      counts[q.cell.type] = (counts[q.cell.type] ?? 0) + 1;
    }
    if (varH > 0) items.push({ type: 'varangue', poly: span(NOYAU_W, tEnd, prof - varH, prof), label: 'Varangues' });
    if (needSec) items.push({ type: 'escalier', poly: span(tEnd, Math.min(L, tEnd + ESC_SEC_W), 0, prof), label: 'ESC 2' });

    // Footprint = la bande complète (noyau → dernière cellule + ESC 2)
    const footprint = span(0, needSec ? Math.min(L, tEnd + ESC_SEC_W) : tEnd, 0, prof);

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

  // Offset d'une polyline OUVERTE de d vers la normale (côté normalSign),
  // raccord miter aux sommets intérieurs (intersection des droites offset).
  _offsetPolyline(axis, normalSign, d) {
    const n = axis.length;
    if (n < 2) return [];
    const segs = [];
    for (let i = 0; i < n - 1; i++) {
      const [x1, y1] = axis[i], [x2, y2] = axis[i + 1];
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len * normalSign, ny = dx / len * normalSign;
      segs.push({ x1: x1 + nx * d, y1: y1 + ny * d, x2: x2 + nx * d, y2: y2 + ny * d });
    }
    const out = [[segs[0].x1, segs[0].y1]];
    for (let i = 1; i < segs.length; i++) {
      const a = segs[i - 1], b = segs[i];
      const d1x = a.x2 - a.x1, d1y = a.y2 - a.y1;
      const d2x = b.x2 - b.x1, d2y = b.y2 - b.y1;
      const cross = d1x * d2y - d1y * d2x;
      if (Math.abs(cross) < 1e-8) out.push([a.x2, a.y2]);
      else {
        const t = ((b.x1 - a.x1) * d2y - (b.y1 - a.y1) * d2x) / cross;
        out.push([a.x1 + t * d1x, a.y1 + t * d1y]);
      }
    }
    out.push([segs[segs.length - 1].x2, segs[segs.length - 1].y2]);
    return out;
  },

  // Restreint un axe à sa plus longue portion continue dont la bande
  // [0.15, prof+0.05] tient dans l'enveloppe (échantillonnage 0.5 m).
  // Les coins MITER arrière aux joints (sommets intérieurs) sont testés
  // explicitement : le miter s'étend latéralement de tan(θ/2)·prof entre
  // deux échantillons — sans ce test, la lame mordait l'enveloppe de 0.7 m.
  _trimAxisToEnv(axis, normalSign, prof, env) {
    if (axis.length < 2) return [];
    // Joints dont le miter arrière sort de l'enveloppe
    const badJoints = [];
    for (let j = 1; j < axis.length - 1; j++) {
      const [ax, ay] = axis[j - 1], [vx, vy] = axis[j], [bx, by] = axis[j + 1];
      const l1 = Math.hypot(vx - ax, vy - ay) || 1, l2 = Math.hypot(bx - vx, by - vy) || 1;
      const n1x = -(vy - ay) / l1 * normalSign, n1y = (vx - ax) / l1 * normalSign;
      const n2x = -(by - vy) / l2 * normalSign, n2y = (bx - vx) / l2 * normalSign;
      // Intersection des deux lignes arrière (miter)
      const p1x = ax + n1x * prof, p1y = ay + n1y * prof;
      const p2x = vx + n2x * prof, p2y = vy + n2y * prof;
      const d1x = vx - ax, d1y = vy - ay, d2x = bx - vx, d2y = by - vy;
      const cross = d1x * d2y - d1y * d2x;
      let mx, my;
      if (Math.abs(cross) < 1e-8) { mx = vx + n1x * prof; my = vy + n1y * prof; }
      else {
        const t = ((p2x - p1x) * d2y - (p2y - p1y) * d2x) / cross;
        mx = p1x + t * d1x; my = p1y + t * d1y;
      }
      if (!ptInPoly(mx, my, env)) badJoints.push([vx, vy]);
    }
    const samples = [];
    for (let i = 0; i < axis.length - 1; i++) {
      const [x1, y1] = axis[i], [x2, y2] = axis[i + 1];
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 0.05) continue;
      const nx = -(y2 - y1) / len * normalSign, ny = (x2 - x1) / len * normalSign;
      const steps = Math.max(1, Math.ceil(len / 0.5));
      for (let s = (samples.length ? 1 : 0); s <= steps; s++) {
        const t = s / steps;
        const px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t;
        let ok = ptInPoly(px + nx * 0.15, py + ny * 0.15, env)
              && ptInPoly(px + nx * (prof + 0.05), py + ny * (prof + 0.05), env);
        if (ok) {
          for (const [jx, jy] of badJoints) {
            if (Math.hypot(px - jx, py - jy) < 1.0) { ok = false; break; }
          }
        }
        samples.push({ px, py, ok, segIdx: i });
      }
    }
    let best = null, cur = null;
    for (let i = 0; i < samples.length; i++) {
      if (samples[i].ok) {
        if (!cur) cur = { s: i, e: i }; else cur.e = i;
        if (!best || cur.e - cur.s > best.e - best.s) best = { ...cur };
      } else cur = null;
    }
    if (!best || best.e - best.s < 8) return []; // < ~4 m utiles
    const A = samples[best.s], B = samples[best.e];
    const raw = [[A.px, A.py]];
    for (let i = A.segIdx + 1; i <= B.segIdx; i++) raw.push([...axis[i]]);
    raw.push([B.px, B.py]);
    const out = [];
    for (const p of raw) {
      if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > 0.2) out.push(p);
    }
    return out.length >= 2 ? out : [];
  },

  // Découpe le bord (simplifié) de l'enveloppe en chaînes de « fronts » :
  // coupure aux virages > maxTurn. Chaque front est un axe candidat.
  _boundaryChains(env, opts = {}) {
    const maxTurn = (opts.maxTurnDeg ?? 45) * Math.PI / 180;
    const nE = env.length;
    if (nE < 3) return [];
    const turn = (p0, p1, p2) => {
      const d1x = p1[0] - p0[0], d1y = p1[1] - p0[1];
      const d2x = p2[0] - p1[0], d2y = p2[1] - p1[1];
      return Math.atan2(d1x * d2y - d1y * d2x, d1x * d2x + d1y * d2y);
    };
    // Couper le ring au virage le plus fort, simplifier, resplitter
    let cutIdx = 0, maxA = -1;
    for (let i = 0; i < nE; i++) {
      const a = Math.abs(turn(env[(i - 1 + nE) % nE], env[i], env[(i + 1) % nE]));
      if (a > maxA) { maxA = a; cutIdx = i; }
    }
    const open = [];
    for (let k = 0; k <= nE; k++) open.push(env[(cutIdx + k) % nE]);
    const simp = simplifyDP(open, 0.35);
    const chains = [];
    let cur = [simp[0], simp[1]];
    for (let i = 2; i < simp.length; i++) {
      if (Math.abs(turn(simp[i - 2], simp[i - 1], simp[i])) > maxTurn) {
        chains.push(cur);
        cur = [simp[i - 1], simp[i]];
      } else cur.push(simp[i]);
    }
    chains.push(cur);
    const len = c => c.reduce((s, p, i) => i ? s + Math.hypot(p[0] - c[i - 1][0], p[1] - c[i - 1][1]) : 0, 0);
    return chains.filter(c => c.length >= 2 && len(c) >= NOYAU_W + LOGT_W.T1);
  },

  // Côté intérieur d'une chaîne de bord d'enveloppe
  _chainNormalSign(chain, env) {
    const [ax, ay] = chain[0], [bx, by] = chain[1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    return ptInPoly(mx - dy / len * 0.8, my + dx / len * 0.8, env) ? 1 : -1;
  },

  // Deux lames sont-elles compatibles ? (aucun chevauchement, bord à bord
  // ≥ gap) — AABB d'abord, puis sommets croisés + périmètre échantillonné.
  _lameSpacingOK(fpA, fpB, gap) {
    const bb = pts => {
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    };
    const [ax0, ay0, ax1, ay1] = bb(fpA), [bx0, by0, bx1, by1] = bb(fpB);
    if (ax0 > bx1 + gap || bx0 > ax1 + gap || ay0 > by1 + gap || by0 > ay1 + gap) return true;
    for (const [x, y] of fpA) if (ptInPoly(x, y, fpB)) return false;
    for (const [x, y] of fpB) if (ptInPoly(x, y, fpA)) return false;
    for (let i = 0; i < fpA.length; i++) {
      const [x1, y1] = fpA[i], [x2, y2] = fpA[(i + 1) % fpA.length];
      const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
      for (let s = 0; s <= steps; s++) {
        const px = x1 + (x2 - x1) * s / steps, py = y1 + (y2 - y1) * s / steps;
        for (let j = 0; j < fpB.length; j++) {
          const [x3, y3] = fpB[j], [x4, y4] = fpB[(j + 1) % fpB.length];
          if (distPtSeg(px, py, x3, y3, x4, y4) < gap * 0.95) return false;
        }
      }
    }
    return true;
  },

  // ────────────────────────────────────────────────────────────────────
  // Capacité MULTI-LAMES « multi-fronts » — capacité MAX du terrain :
  //   1. candidats = lame voie (capacite) + une lame par FRONT de
  //      l'enveloppe (chaînes de bord entre virages > 45°) — les bâtiments
  //      s'alignent sur les limites, y compris courbes/latérales ;
  //   2. sélection gloutonne par capacité décroissante, sous contrainte
  //      d'espacement interBat (jamais de chevauchement) ;
  //   3. offsets parallèles des lames retenues pour remplir l'intérieur.
  // Tous les axes passent par _trimAxisToEnv : aucune lame ne déborde.
  // params : { ...capacite, maxLames: 1-3, interBat }
  // ────────────────────────────────────────────────────────────────────
  capaciteMulti(parcel, edgeTypes, env, params = {}) {
    const maxLames = Math.max(1, Math.min(3, params.maxLames ?? 3));
    const interBat = params.interBat ?? Math.max(4, (params.niveaux ?? 2) * 3 / 2);
    const prof = params.profondeur ?? 10.5;
    const warnings = [];

    // 1. Candidats par front
    const candidates = [];
    const first = this.capacite(parcel, edgeTypes, env, params);
    if (first.ok) candidates.push({ ...first, src: 'voie' });
    else warnings.push(...first.warnings);
    for (const chain of this._boundaryChains(env, params)) {
      const ns = this._chainNormalSign(chain, env);
      const axis = this._trimAxisToEnv(chain, ns, prof, env);
      if (axis.length < 2) continue;
      const plateau = this.plateauAlongAxis(axis, ns, params);
      if (!plateau) continue;
      candidates.push({ ok: true, axis, normalSign: ns, ...plateau, src: 'front' });
    }
    if (!candidates.length) return { ok: false, lames: [], warnings: [...warnings, 'AUCUNE_LAME_POSSIBLE'] };

    // 2. Sélection gloutonne (capacité puis emprise) sous espacement
    candidates.sort((a, b) => (b.metrics.perFloor - a.metrics.perFloor) || (b.metrics.emprise - a.metrics.emprise));
    const lames = [];
    const fits = c => lames.every(l => this._lameSpacingOK(c.footprint, l.footprint, interBat));
    for (const c of candidates) {
      if (lames.length >= maxLames) break;
      if (fits(c)) lames.push(c);
    }

    // 3. Offsets parallèles des lames retenues (remplissage intérieur)
    let added = true;
    while (lames.length < maxLames && added) {
      added = false;
      for (const base of [...lames]) {
        if (lames.length >= maxLames) break;
        let axisK = this._offsetPolyline(base.axis, base.normalSign, prof + interBat);
        axisK = this._trimAxisToEnv(axisK, base.normalSign, prof, env);
        if (axisK.length < 2) continue;
        const plateau = this.plateauAlongAxis(axisK, base.normalSign, params);
        if (!plateau) continue;
        const cand = { ok: true, axis: axisK, normalSign: base.normalSign, ...plateau, src: 'offset' };
        if (fits(cand)) { lames.push(cand); added = true; }
      }
    }

    const agg = { perFloor: 0, counts: {}, emprise: 0, su_par_niveau: 0, niveaux: Math.max(1, params.niveaux ?? 2), needSec: false, nLames: lames.length };
    for (const l of lames) {
      agg.perFloor += l.metrics.perFloor;
      agg.emprise += l.metrics.emprise;
      agg.su_par_niveau += l.metrics.su_par_niveau;
      agg.needSec = agg.needSec || l.metrics.needSec;
      for (const [t, c] of Object.entries(l.metrics.counts)) agg.counts[t] = (agg.counts[t] ?? 0) + c;
    }
    agg.logements = agg.perFloor * agg.niveaux;
    agg.sdp = agg.emprise * agg.niveaux;
    return { ok: true, lames, metrics: agg, warnings: [...new Set([...warnings, ...lames.flatMap(l => l.warnings)])], normalSign: lames[0]?.normalSign ?? 1 };
  },

  // ────────────────────────────────────────────────────────────────────
  // Orchestration : parcelle + enveloppe → axe → plateau → validation.
  // ────────────────────────────────────────────────────────────────────
  capacite(parcel, edgeTypes, env, params = {}) {
    const { axis: axis0, normalSign, warnings: aw } = this.deriveAxis(parcel, edgeTypes, env, params);
    if (!axis0.length) return { ok: false, warnings: aw };
    // Anti-débordement : la bande doit tenir dans l'enveloppe sur TOUTE la
    // lame voie aussi (deriveAxis ne testait que les arêtes d'extension —
    // sur une enveloppe qui se resserre, la lame sortait jusqu'à 2 m).
    const axis = this._trimAxisToEnv(axis0, normalSign, params.profondeur ?? 10.5, env);
    if (axis.length < 2) return { ok: false, warnings: [...aw, 'BANDE_HORS_ENV'] };
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
