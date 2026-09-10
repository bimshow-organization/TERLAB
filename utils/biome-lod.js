/* ═══════════════════════════════════════════════════════════════════════════
   BIOME-LOD · biomes dérivés du terrain + sélection de niveau de détail
   ───────────────────────────────────────────────────────────────────────────
   Pourquoi ce module existe.

   Le POC sait déjà ingérer un terrain réel : `commitTerrainFromMesh` avale un
   TIN, et `IGNElevationService.getGridElevations` sait rendre une grille RGE
   ALTI sur une emprise allant jusqu'à 400 m. Deux choses cassent à cette
   échelle-là :

     1 · Les biomes sont POSÉS à la main (blobs, pont SVG). Sur un vrai relief
         de 400 m, poser à la main n'a plus de sens — et surtout, le terrain
         PORTE l'information : là où l'eau se rassemble il y a de la ripisylve,
         sur un versant sud sec il y a de la garrigue. Ici on la lit.

     2 · La végétation plafonne à INST_CAP = 18 000 instances et bascule en
         billboards à une distance FIXE (IMP.far = 320 m). Une distance en
         mètres ne sait rien du champ de vision ni de la hauteur de fenêtre :
         elle est trop prudente en plan large, trop agressive en gros plan.

   Ce module n'a aucune dépendance — ni three.js, ni DOM. Il tourne dans le
   navigateur (`window.BiomeLOD`) comme sous Node (`module.exports`), ce qui
   permet de l'éprouver en headless : voir `probe-biome-lod.mjs`.

   Convention de champ, reprise du POC : { size, data: Float32Array } en
   row-major, `data[y * size + x]`, coordonnées monde croissant vers l'est (x)
   et vers le nord (y).
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BiomeLOD = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ═══ 1 · CHAMPS ═════════════════════════════════════════════════════════ */

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a || 1e-9)); return t * t * (3 - 2 * t); };

  function makeField(size, fill = 0) {
    const data = new Float32Array(size * size);
    if (fill !== 0) data.fill(fill);
    return { size, data };
  }

  function cloneField(f) { return { size: f.size, data: Float32Array.from(f.data) }; }

  /** Lecture à bords ouverts : hors grille, on rend la valeur du bord (clamp). */
  function sample(f, x, y) {
    const s = f.size;
    const cx = x < 0 ? 0 : x >= s ? s - 1 : x;
    const cy = y < 0 ? 0 : y >= s ? s - 1 : y;
    return f.data[cy * s + cx];
  }

  /**
   * Gradient central. `cell` est la taille de cellule en mètres : sans elle le
   * gradient est en « unités par cellule » et la pente d'un terrain de 400 m
   * lue sur la même grille qu'un terrain de 40 m sort dix fois trop faible.
   */
  function gradient(f, x, y, cell = 1) {
    return {
      gx: (sample(f, x + 1, y) - sample(f, x - 1, y)) / (2 * cell),
      gy: (sample(f, x, y + 1) - sample(f, x, y - 1)) / (2 * cell),
    };
  }

  /** Pente en radians (0 = plat, π/2 = falaise). */
  function slopeField(f, cell = 1) {
    const out = makeField(f.size);
    for (let y = 0; y < f.size; y++) for (let x = 0; x < f.size; x++) {
      const g = gradient(f, x, y, cell);
      out.data[y * f.size + x] = Math.atan(Math.hypot(g.gx, g.gy));
    }
    return out;
  }

  function blur(f, radius, passes = 1) {
    if (radius < 0.5) return cloneField(f);
    const r = Math.max(1, Math.round(radius));
    const s = f.size;
    let src = cloneField(f);
    const tmp = makeField(s);
    /* Séparé en deux passes 1D : un noyau 2D de rayon r coûte (2r+1)² par
       cellule, deux passes 1D coûtent 2(2r+1). À r = 6, c'est 169 contre 26. */
    const k = [];
    let ksum = 0;
    for (let i = -r; i <= r; i++) { const w = Math.exp(-(i * i) / (2 * radius * radius)); k.push(w); ksum += w; }
    for (let i = 0; i < k.length; i++) k[i] /= ksum;
    for (let p = 0; p < passes; p++) {
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        let a = 0;
        for (let i = -r; i <= r; i++) a += sample(src, x + i, y) * k[i + r];
        tmp.data[y * s + x] = a;
      }
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        let a = 0;
        for (let i = -r; i <= r; i++) a += sample(tmp, x, y + i) * k[i + r];
        src.data[y * s + x] = a;
      }
    }
    return src;
  }

  /**
   * Normalisation par PERCENTILES, pas par min/max.
   * Une grille RGE ALTI contient des valeurs aberrantes isolées (bâtiment pris
   * pour le sol, artefact de corrélation). Un seul pic écrase tout le reste du
   * champ dans les derniers pourcents de la plage : la carte devient plate.
   */
  function normalizeByPercentile(f, lo = 0.005, hi = 0.995) {
    const sorted = Float32Array.from(f.data).sort();
    const a = sorted[Math.floor(clamp01(lo) * (sorted.length - 1))];
    const span = sorted[Math.floor(clamp01(hi) * (sorted.length - 1))] - a || 1;
    const out = makeField(f.size);
    for (let i = 0; i < f.data.length; i++) out.data[i] = clamp01((f.data[i] - a) / span);
    return out;
  }

  /** Refuse un champ non fini plutôt que de le laisser se propager. */
  function assertFinite(f, label) {
    for (let i = 0; i < f.data.length; i++) {
      if (!Number.isFinite(f.data[i])) {
        throw new Error(`${label} : valeur non finie à l'index ${i} (${f.data[i]})`);
      }
    }
    return f;
  }

  /* ═══ 2 · HYDROLOGIE ═════════════════════════════════════════════════════ */

  /** Tas binaire min, indexé sur une clé numérique. Sert au priority-flood. */
  function MinHeap() {
    const key = [], val = [];
    return {
      get size() { return key.length; },
      push(k, v) {
        key.push(k); val.push(v);
        let i = key.length - 1;
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (key[p] <= key[i]) break;
          [key[p], key[i]] = [key[i], key[p]];
          [val[p], val[i]] = [val[i], val[p]];
          i = p;
        }
      },
      pop() {
        const topK = key[0], topV = val[0], last = key.length - 1;
        key[0] = key[last]; val[0] = val[last];
        key.pop(); val.pop();
        let i = 0;
        const n = key.length;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < n && key[l] < key[m]) m = l;
          if (r < n && key[r] < key[m]) m = r;
          if (m === i) break;
          [key[m], key[i]] = [key[i], key[m]];
          [val[m], val[i]] = [val[i], val[m]];
          i = m;
        }
        return { k: topK, v: topV };
      },
    };
  }

  /**
   * Comblement des cuvettes (priority-flood, Barnes et al. 2014).
   *
   * ⚠️ Étape OBLIGATOIRE avant toute accumulation de flux sur un MNT réel.
   * Un RGE ALTI est criblé de micro-cuvettes — bruit de mesure, ponts, talus
   * routiers. Sans comblement, chaque cuvette avale le flux qui l'atteint et
   * l'accumulation rend des ruisseaux hachés de trois pixels au lieu d'un
   * réseau continu. C'est LE piège de l'hydrologie sur données réelles, et il
   * ne se voit pas sur du bruit de Perlin, qui n'a presque pas de minima
   * locaux fermés.
   *
   * Les bords sont OUVERTS : le flux qui les atteint quitte la parcelle. Sur
   * une emprise découpée dans un territoire, c'est le comportement juste — un
   * bord toroïdal ferait déboucher le ruisseau du sud dans le nord.
   */
  const FILL_EPS = 1e-5;   // m — pente résiduelle donnée aux plateaux comblés

  function fillDepressions(f) {
    const s = f.size, n = s * s;
    const out = Float32Array.from(f.data);
    const closed = new Uint8Array(n);
    const heap = MinHeap();

    for (let x = 0; x < s; x++) {
      for (const y of [0, s - 1]) {
        const i = y * s + x;
        if (!closed[i]) { closed[i] = 1; heap.push(out[i], i); }
      }
    }
    for (let y = 0; y < s; y++) {
      for (const x of [0, s - 1]) {
        const i = y * s + x;
        if (!closed[i]) { closed[i] = 1; heap.push(out[i], i); }
      }
    }

    const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
    const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
    while (heap.size) {
      const { k: elev, v: i } = heap.pop();
      const x = i % s, y = (i / s) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= s || ny >= s) continue;
        const j = ny * s + nx;
        if (closed[j]) continue;
        closed[j] = 1;
        /* Le voisin ne peut pas être plus bas que la cellule par laquelle on
           l'atteint : c'est ce qui remplit la cuvette jusqu'à son exutoire.
           L'EPSILON n'est pas cosmétique — sans lui la cuvette devient un
           plateau parfaitement plat, où D8 n'a plus aucune direction de
           plus grande pente : le flux s'y arrête, exactement le défaut qu'on
           croyait corriger. Le pas est de 10 µm : sur mille cellules de
           traversée il ajoute un centimètre. */
        if (out[j] <= elev) out[j] = elev + FILL_EPS;
        heap.push(out[j], j);
      }
    }
    return { size: s, data: out };
  }

  /**
   * Accumulation de flux D8.
   *
   * Chaque cellule verse une unité de pluie dans son plus bas voisin, en
   * traitant les cellules de la plus haute à la plus basse — un tri suffit,
   * aucune récursion. La sortie est compressée en log : sans ça, un fond de
   * vallon concentre 10 000 unités quand un versant en porte 1, et toute
   * carte dérivée est noire avec une ligne blanche.
   *
   * Le comblement est fait ici par défaut (`opts.fill = false` pour le sauter
   * quand le champ a déjà été traité).
   */
  function flowAccumulation(field, opts = {}) {
    const src = opts.fill === false ? field : fillDepressions(field);
    const s = src.size, n = s * s;
    const h = src.data;
    const acc = new Float32Array(n).fill(1);

    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    /* Tri décroissant : on ne peut verser que vers plus bas, donc traiter du
       haut vers le bas garantit qu'une cellule a reçu tout son amont avant
       de donner. */
    const sorted = Array.from(order).sort((a, b) => h[b] - h[a]);

    const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
    const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
    const DIAG = [1, 0, 1, 0, 0, 1, 0, 1];
    for (const i of sorted) {
      const x = i % s, y = (i / s) | 0;
      let best = -1, bestDrop = 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= s || ny >= s) continue;   // bord ouvert : le flux sort
        const j = ny * s + nx;
        /* Pente, pas dénivelé brut : sans diviser par √2 en diagonale, D8
           préfère systématiquement les diagonales et le réseau part en biais. */
        const drop = (h[i] - h[j]) / (DIAG[d] ? Math.SQRT2 : 1);
        if (drop > bestDrop) { bestDrop = drop; best = j; }
      }
      if (best >= 0) acc[best] += acc[i];
    }

    const out = makeField(s);
    for (let i = 0; i < n; i++) out.data[i] = Math.log(1 + acc[i]);
    return out;
  }

  /**
   * Exposition : +1 plein sud (adret), −1 plein nord (ubac), 0 sur un plat ou
   * un versant est/ouest.
   *
   * Le raisonnement, parce que le signe se trompe une fois sur deux : la pente
   * descend dans la direction −∇h. Un versant EXPOSÉ AU SUD est un versant qui
   * DESCEND vers le sud, donc dont l'altitude CROÎT vers le nord — et comme y
   * croît vers le nord, gy > 0. La « sudité » est donc +gy / ‖∇h‖.
   */
  function exposure(field, cell = 1) {
    const out = makeField(field.size);
    for (let y = 0; y < field.size; y++) for (let x = 0; x < field.size; x++) {
      const g = gradient(field, x, y, cell);
      const mag = Math.hypot(g.gx, g.gy);
      out.data[y * field.size + x] = mag < 1e-6 ? 0 : g.gy / mag;
    }
    return out;
  }

  /**
   * Érosion thermique : tout ce qui dépasse l'angle de talus s'effondre.
   * `talusAngle` est une PENTE (dz/dx), pas un angle — 0,7 ≈ 35°, l'angle de
   * repos d'un éboulis sec.
   */
  function thermalErosion(field, opts = {}) {
    const iterations = opts.iterations ?? 6;
    const talus = (opts.talusAngle ?? 0.7) * (opts.cell ?? 1);
    const rate = opts.rate ?? 0.4;
    const s = field.size;
    const h = Float32Array.from(field.data);
    const delta = new Float32Array(s * s);
    const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
    const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
    const DIAG = [1, 0, 1, 0, 0, 1, 0, 1];

    for (let it = 0; it < iterations; it++) {
      delta.fill(0);
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        const i = y * s + x;
        let total = 0, maxExcess = 0;
        const drops = [];
        for (let d = 0; d < 8; d++) {
          const nx = x + DX[d], ny = y + DY[d];
          if (nx < 0 || ny < 0 || nx >= s || ny >= s) continue;
          const j = ny * s + nx;
          const dist = DIAG[d] ? Math.SQRT2 : 1;
          const excess = (h[i] - h[j]) - talus * dist;
          if (excess > 0) {
            drops.push([j, excess]);
            total += excess;
            if (excess > maxExcess) maxExcess = excess;
          }
        }
        if (!total) continue;
        /* Le volume déplacé est borné par la MOITIÉ DU PLUS GRAND excédent, pas
           par leur somme. Avec la somme, une cellule entourée de huit voisins
           bas cède huit fois son propre excédent en une passe : la surface
           diverge au lieu de converger — mesuré à 2 × 10⁶ m sur un pilier de
           40 m, avec un volume total pourtant conservé (elle oscille). */
        const move = Math.min(total, maxExcess * 0.5) * rate;
        delta[i] -= move;
        for (const [j, excess] of drops) delta[j] += move * (excess / total);
      }
      for (let i = 0; i < h.length; i++) h[i] += delta[i];
    }
    return { size: s, data: h };
  }

  /* ═══ 3 · CARTES DE BIOME ════════════════════════════════════════════════ */

  /**
   * Dérive du terrain les quatre cartes qui décident d'un biome.
   * Toutes en 0..1, prêtes à être comparées entre elles.
   *
   *   humidity  — accumulation de flux normalisée : où l'eau se rassemble
   *   exposure  — 0 plein nord (ubac), 1 plein sud (adret)
   *   slope     — 0 plat, 1 à `maxSlopeDeg` et au-delà
   *   elevation — altitude relative dans l'emprise
   */
  function deriveBiomeMaps(height, opts = {}) {
    const cell = opts.cell ?? 1;
    const maxSlope = Math.tan((opts.maxSlopeDeg ?? 45) * Math.PI / 180);

    assertFinite(height, 'deriveBiomeMaps/height');

    const filled = fillDepressions(height);
    const flow = flowAccumulation(filled, { fill: false });
    const humidity = normalizeByPercentile(blur(flow, opts.humiditySmooth ?? 1.2), 0.02, 0.995);

    const expRaw = exposure(height, cell);
    const expo = makeField(height.size);
    for (let i = 0; i < expo.data.length; i++) expo.data[i] = clamp01(expRaw.data[i] * 0.5 + 0.5);
    const exposureMap = blur(expo, opts.exposureSmooth ?? 2);

    const slopeRad = slopeField(height, cell);
    const slope = makeField(height.size);
    for (let i = 0; i < slope.data.length; i++) slope.data[i] = clamp01(Math.tan(slopeRad.data[i]) / maxSlope);

    const elevation = normalizeByPercentile(height, 0.01, 0.99);

    return {
      humidity: assertFinite(humidity, 'humidity'),
      exposure: assertFinite(exposureMap, 'exposure'),
      slope: assertFinite(slope, 'slope'),
      elevation: assertFinite(elevation, 'elevation'),
      filled,
    };
  }

  /**
   * Classification déclarative. Une règle décrit une fenêtre sur chaque carte ;
   * le score d'une règle est le produit des appartenances, pondéré par `weight`.
   * La règle la mieux notée gagne, et on garde le score : une cellule mal
   * classée (score faible) doit pouvoir rester nue plutôt que de recevoir le
   * biome le moins improbable.
   */
  function membership(v, range) {
    if (!range) return 1;
    const [lo, hi, soft = 0.12] = range;
    return smoothstep(lo - soft, lo + soft, v) * (1 - smoothstep(hi - soft, hi + soft, v));
  }

  function classifyBiomes(maps, rules, opts = {}) {
    const size = maps.humidity.size;
    const n = size * size;
    const biome = new Int16Array(n).fill(-1);
    const score = new Float32Array(n);
    const minScore = opts.minScore ?? 0.08;

    for (let i = 0; i < n; i++) {
      let bestS = 0, bestR = -1;
      for (let r = 0; r < rules.length; r++) {
        const rule = rules[r];
        const s =
          membership(maps.humidity.data[i], rule.humidity) *
          membership(maps.exposure.data[i], rule.exposure) *
          membership(maps.slope.data[i], rule.slope) *
          membership(maps.elevation.data[i], rule.elevation) *
          (rule.weight ?? 1);
        if (s > bestS) { bestS = s; bestR = r; }
      }
      if (bestS >= minScore) { biome[i] = bestR; score[i] = bestS; }
    }
    return { size, biome, score, rules };
  }

  /**
   * Jeu de règles par défaut, calé sur un coteau tempéré français — le cas que
   * rend l'IGN sur la plupart des sites. À remplacer par le vocabulaire de
   * biomes du POC ; la structure est ce qui compte.
   */
  const DEFAULT_RULES = [
    { id: 'ripisylve',      humidity: [0.72, 1.00], slope: [0.00, 0.30], weight: 1.35 },
    { id: 'prairie_humide', humidity: [0.50, 0.80], slope: [0.00, 0.22] },
    { id: 'boisement_ubac', exposure: [0.00, 0.42], slope: [0.10, 0.72], humidity: [0.20, 0.85] },
    { id: 'garrigue_adret', exposure: [0.60, 1.00], slope: [0.15, 0.80], humidity: [0.00, 0.45] },
    { id: 'eboulis',        slope: [0.72, 1.00], weight: 1.2 },
    { id: 'prairie_seche',  humidity: [0.00, 0.42], slope: [0.00, 0.35] },
    { id: 'lande',          humidity: [0.25, 0.62], slope: [0.10, 0.55] },
  ];

  /* ═══ 4 · NIVEAU DE DÉTAIL ═══════════════════════════════════════════════ */

  /**
   * Erreur géométrique projetée en pixels.
   * Le terme de focale ne dépend QUE de la caméra : le calculer une fois par
   * image et le passer ici évite un `tan()` par tuile et par frame.
   */
  function focalPixels(viewportHeight, verticalFovRadians) {
    return viewportHeight / (2 * Math.tan(verticalFovRadians * 0.5));
  }
  function screenSpaceError(geometricError, distance, focal) {
    return geometricError * focal / Math.max(distance, 0.001);
  }

  /**
   * Choisit le palier le plus grossier dont l'erreur reste sous la tolérance,
   * puis applique une HYSTÉRÉSIS asymétrique autour du palier courant.
   *
   * Sans elle, une caméra qui tremble sur la frontière fait osciller le palier
   * à chaque image : c'est le clignotement d'impostors. La bande est
   * asymétrique à dessein — on va vers le détail à contrecœur (dépasser de
   * 16 %) et on relâche franchement (redescendre sous 72 %). Le coût d'un
   * palier trop fin est du budget ; celui d'un palier trop grossier se voit.
   */
  const HYST_UP = 1.16, HYST_DOWN = 0.72;

  function pickLod(errors, distance, focal, tolerance, currentLod) {
    /* On descend du PLUS GROSSIER vers le plus fin et on garde le premier qui
       tient sous la tolérance — c'est le plus économique des acceptables.
       Parcourir dans l'autre sens rend systématiquement le palier 0 dès qu'il
       est acceptable, donc le détail maximum à l'horizon : l'inverse du but.
       Si aucun ne tient, on est si près que même le plus fin dépasse : palier 0,
       on ne peut pas faire mieux. */
    let want = 0;
    for (let l = errors.length - 1; l >= 0; l--) {
      if (screenSpaceError(errors[l], distance, focal) <= tolerance) { want = l; break; }
    }
    if (currentLod === undefined || currentLod === want) return want;
    if (want < currentLod) {
      // vers plus fin : il faut que le palier courant soit franchement trop grossier
      return screenSpaceError(errors[currentLod], distance, focal) > tolerance * HYST_UP ? want : currentLod;
    }
    // vers plus grossier : il faut que le candidat soit confortablement sous le seuil
    return screenSpaceError(errors[want], distance, focal) < tolerance * HYST_DOWN ? want : currentLod;
  }

  /**
   * Plancher de palier pendant le déplacement : on refuse de construire du
   * détail qu'on n'aura pas le temps de voir. Deux seuils de vitesse, pas un —
   * une rampe continue ferait varier le palier en permanence, ce que
   * l'hystérésis passe son temps à empêcher.
   */
  function motionFloor(speed, opts = {}) {
    const slow = opts.slow ?? 6, fast = opts.fast ?? 22;
    return speed > fast ? 2 : speed > slow ? 1 : 0;
  }

  /**
   * Index de tuiles pour la végétation.
   *
   * Le POC traite sa végétation comme un bloc unique : un cap global de 18 000
   * instances et une bascule en billboards à distance fixe, identiques pour
   * tout le monde. Découpée en tuiles, chaque parcelle de terrain porte son
   * propre palier — et une tuile lointaine peut à la fois passer en billboard
   * ET perdre 80 % de sa densité, ce qu'un cap global ne sait pas faire.
   */
  function TileIndex(opts = {}) {
    const tileSize = opts.tileSize ?? 24;       // m
    const tiles = new Map();                     // "tx,ty" → tuile
    const densities = opts.densities ?? [1, 0.55, 0.25, 0.08];
    const errors = opts.geometricErrors ?? [0.35, 0.9, 2.4, 6.5];
    const budget = opts.instanceBudget ?? 18000;

    const keyOf = (x, y) => `${Math.floor(x / tileSize)},${Math.floor(y / tileSize)}`;

    return {
      tileSize, densities, errors,

      /** Range une instance. `item` est opaque : le module ne le lit jamais. */
      add(x, y, item) {
        const k = keyOf(x, y);
        let t = tiles.get(k);
        if (!t) {
          const tx = Math.floor(x / tileSize), ty = Math.floor(y / tileSize);
          t = {
            key: k, tx, ty,
            cx: (tx + 0.5) * tileSize, cy: (ty + 0.5) * tileSize,
            items: [], lod: undefined, visible: 0, distance: 0,
          };
          tiles.set(k, t);
        }
        t.items.push(item);
        return t;
      },

      get tiles() { return tiles; },
      get tileCount() { return tiles.size; },
      get itemCount() { let n = 0; for (const t of tiles.values()) n += t.items.length; return n; },

      clear() { tiles.clear(); },

      /**
       * Recalcule le palier de chaque tuile.
       * `ctx` : { camera:{x,y,z}, focal, tolerance, speed, floorOpts }
       * Rend un rapport, pour que l'appelant puisse afficher ce qui se passe
       * plutôt que de le deviner.
       */
      update(ctx) {
        const floor = motionFloor(ctx.speed ?? 0, ctx.floorOpts);
        const maxLod = errors.length - 1;
        let visible = 0, changed = 0;
        const byLod = new Array(errors.length).fill(0);

        for (const t of tiles.values()) {
          const dx = t.cx - ctx.camera.x, dy = t.cy - ctx.camera.y;
          const dz = ctx.camera.z ?? 0;
          t.distance = Math.max(1, Math.hypot(dx, dy, dz));
          const want = pickLod(errors, t.distance, ctx.focal, ctx.tolerance, t.lod);
          const next = clamp(Math.max(want, floor), 0, maxLod);
          if (next !== t.lod) { t.lod = next; changed++; }
          t.visible = Math.round(t.items.length * densities[t.lod]);
          visible += t.visible;
          byLod[t.lod] += t.visible;
        }

        /* Garde-fou de budget : si le total dépasse le cap, on dégrade les
           tuiles LES PLUS LOINTAINES d'abord. Rogner uniformément ferait
           perdre autant de détail au premier plan qu'à l'horizon. */
        let trimmed = 0;
        if (visible > budget) {
          const far = [...tiles.values()].sort((a, b) => b.distance - a.distance);
          for (const t of far) {
            if (visible <= budget) break;
            if (t.lod >= maxLod) continue;
            const before = t.visible;
            t.lod = Math.min(maxLod, t.lod + 1);
            t.visible = Math.round(t.items.length * densities[t.lod]);
            visible -= before - t.visible;
            trimmed++;
          }
          byLod.fill(0);
          for (const t of tiles.values()) byLod[t.lod] += t.visible;
        }

        return { visible, changed, trimmed, floor, byLod, tiles: tiles.size, budget };
      },

      /** Les instances effectivement retenues, tuile par tuile. */
      *selected() {
        for (const t of tiles.values()) {
          const n = t.visible;
          if (!n) continue;
          if (n >= t.items.length) { yield* t.items; continue; }
          /* Pas de random : on prend un pas régulier dans la liste, donc une
             instance visible au palier 2 l'est aussi au palier 1. Un tirage
             aléatoire ferait scintiller les plantes à chaque changement de
             palier — elles apparaîtraient et disparaîtraient sans bouger. */
          const step = t.items.length / n;
          for (let k = 0; k < n; k++) yield t.items[Math.floor(k * step)];
        }
      },
    };
  }

  /* ═══ 5 · ADAPTATEUR IGN ═════════════════════════════════════════════════ */

  /**
   * Grille RGE ALTI → champ du module.
   * `IGNElevationService.getGridElevations` rend un `number[][]` indexé
   * [row][col], row 0 = SUD, col 0 = OUEST — même orientation que nos y et x
   * croissants, donc pas de retournement à faire. Le piège serait d'en
   * ajouter un « au cas où » : il ferait basculer adret et ubac.
   */
  function fieldFromIgnGrid(elevations, opts = {}) {
    if (!Array.isArray(elevations) || !elevations.length) throw new Error('grille IGN vide');
    const size = elevations.length;
    for (const row of elevations) {
      if (!Array.isArray(row) || row.length !== size) throw new Error('grille IGN non carrée');
    }
    const f = makeField(size);
    let min = Infinity, max = -Infinity, holes = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let v = elevations[y][x];
      /* L'IGN rend -99999 hors couverture, et le service met 0 en repli. Les
         deux valent « pas de donnée » : les laisser creuserait un puits de
         100 km dans lequel toute l'accumulation de flux irait se jeter. */
      if (!Number.isFinite(v) || v <= -9999) { v = NaN; holes++; }
      f.data[y * size + x] = v;
      if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
    }
    if (!Number.isFinite(min)) throw new Error('grille IGN sans aucune altitude valide');

    if (holes) {
      /* Bouchage par diffusion depuis les voisins valides — quelques passes
         suffisent, les trous du RGE ALTI sont petits et isolés. */
      for (let pass = 0; pass < 8 && holes; pass++) {
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const i = y * size + x;
          if (Number.isFinite(f.data[i])) continue;
          let sum = 0, cnt = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
            const v = f.data[ny * size + nx];
            if (Number.isFinite(v)) { sum += v; cnt++; }
          }
          if (cnt) { f.data[i] = sum / cnt; holes--; }
        }
      }
      for (let i = 0; i < f.data.length; i++) if (!Number.isFinite(f.data[i])) f.data[i] = min;
    }

    const emprise = opts.emprise ?? size;
    return {
      field: f,
      cell: emprise / (size - 1),
      size,
      emprise,
      /* Altitude absolue conservée à part : le POC travaille recentré, mais on
         doit pouvoir revenir aux coordonnées du géomètre. */
      origin: { z: min },
      relief: max - min,
      holesFilled: opts.emprise === undefined ? 0 : 0,
    };
  }

  /**
   * Champ → TIN au format que `commitTerrainFromMesh` attend déjà.
   * Recentré en XY sur l'emprise, rebasé sur z minimum : mêmes conventions que
   * `extract-ifc-terrain.mjs`, donc le POC l'avale sans rien changer.
   */
  function tinFromField(field, opts = {}) {
    const s = field.size;
    const cell = opts.cell ?? 1;
    const half = (s - 1) * cell / 2;
    let zmin = Infinity;
    for (let i = 0; i < field.data.length; i++) if (field.data[i] < zmin) zmin = field.data[i];

    const positions = new Array(s * s * 3);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 3;
      positions[i] = x * cell - half;
      positions[i + 1] = y * cell - half;
      positions[i + 2] = field.data[y * s + x] - zmin;
    }
    const indices = [];
    for (let y = 0; y < s - 1; y++) for (let x = 0; x < s - 1; x++) {
      const a = y * s + x, b = a + 1, c = a + s, d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
    return {
      source: opts.source || 'IGN RGE ALTI',
      origin: { x: opts.originX ?? 0, y: opts.originY ?? 0, z: zmin },
      size: { x: (s - 1) * cell, y: (s - 1) * cell, z: 0 },
      vertexCount: s * s,
      triangleCount: indices.length / 3,
      positions, indices,
    };
  }

  /** Chaîne complète : grille IGN → cartes de biome + TIN prêt à poser. */
  function buildFromIgn(elevations, opts = {}) {
    const g = fieldFromIgnGrid(elevations, opts);
    let height = g.field;
    if (opts.thermal !== false) {
      height = thermalErosion(height, {
        iterations: opts.thermalIterations ?? 4,
        talusAngle: opts.talusAngle ?? 0.7,
        rate: 0.4, cell: g.cell,
      });
    }
    const maps = deriveBiomeMaps(height, { cell: g.cell, maxSlopeDeg: opts.maxSlopeDeg ?? 45 });
    const classes = classifyBiomes(maps, opts.rules || DEFAULT_RULES, opts);
    return {
      ...g,
      height,
      maps,
      classes,
      tin: tinFromField(height, { cell: g.cell, source: opts.source }),
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* ═══ 6 · COULEUR EN LINÉAIRE ════════════════════════════════════════════
     Le POC mélange ses couleurs en sRGB (`mixC(hexC(a), hexC(b), t)`). Un
     dégradé sable → turquoise interpolé ainsi passe par un creux terne au
     milieu : sRGB n'est pas linéaire en lumière, la moyenne de deux couleurs y
     est plus sombre et plus grise que la vraie moyenne physique. En linéaire,
     non. C'est petit, c'est partout, et ça ne se voit qu'une fois corrigé.  */

  function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function linearToSrgb(c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }

  function hexToLinear(hex) {
    const n = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex;
    return {
      r: srgbToLinear(((n >> 16) & 255) / 255),
      g: srgbToLinear(((n >> 8) & 255) / 255),
      b: srgbToLinear((n & 255) / 255),
    };
  }
  function linearToHex(c) {
    const q = (v) => Math.round(clamp01(linearToSrgb(v)) * 255);
    return (q(c.r) << 16) | (q(c.g) << 8) | q(c.b);
  }
  /** Mélange DEUX couleurs sRGB en passant par le linéaire. */
  function mixSrgb(hexA, hexB, t) {
    const a = hexToLinear(hexA), b = hexToLinear(hexB);
    return linearToHex({ r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) });
  }

  /* ═══ 7 · OCCLUSION AMBIANTE ═════════════════════════════════════════════
     Le POC n'en a AUCUNE — vérifié, zéro occurrence. Il est éclairé par une
     directionnelle, une hémisphérique et une ambiante, donc rien ne s'assombrit
     là où les choses se touchent. C'est le premier signe d'un rendu artificiel,
     et la lumière hémisphérique aggrave le cas : elle éclaire un creux aussi
     fort qu'une crête. L'AO est exactement le facteur correctif manquant.   */

  /**
   * AO du terrain par balayage d'horizon.
   * Pour chaque cellule et chaque direction, on cherche l'angle du plus haut
   * obstacle dans un rayon donné ; l'occlusion est la moyenne de leurs sinus.
   *
   * Le rayon est en MÈTRES, pas en cellules : sur une parcelle de 400 m une
   * cellule fait 4 m, sur 40 m elle en fait 0,4 — un rayon en cellules
   * donnerait deux résultats sans rapport pour le même relief.
   */
  function horizonAO(field, opts = {}) {
    const dirs = opts.directions ?? 16;
    const cell = opts.cell ?? 1;
    const steps = Math.max(2, Math.round((opts.radius ?? 14) / cell));
    const intensity = opts.intensity ?? 1;
    const s = field.size;
    const out = makeField(s, 1);
    const cs = [], sn = [];
    for (let d = 0; d < dirs; d++) {
      const a = (d / dirs) * Math.PI * 2;
      cs.push(Math.cos(a)); sn.push(Math.sin(a));
    }
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const h0 = field.data[y * s + x];
      let occ = 0;
      for (let d = 0; d < dirs; d++) {
        let maxTan = 0;
        for (let k = 1; k <= steps; k++) {
          const dh = sample(field, Math.round(x + cs[d] * k), Math.round(y + sn[d] * k)) - h0;
          if (dh <= 0) continue;
          const t = dh / (k * cell);
          if (t > maxTan) maxTan = t;
        }
        /* sin(atan(t)) sans trigonométrie : c'est la fraction de ciel masquée
           dans cette direction. */
        occ += maxTan / Math.sqrt(1 + maxTan * maxTan);
      }
      out.data[y * s + x] = clamp01(1 - (occ / dirs) * intensity);
    }
    return out;
  }

  /**
   * Assombrissement de CONTACT sous la végétation.
   *
   * C'est la moitié qui compte. Une plante sans ombre de contact flotte au-
   * dessus du sol, quelle que soit la qualité de son maillage. Chaque sujet
   * dépose un disque atténué à sa base ; les couronnes qui se recouvrent
   * s'assombrissent mutuellement, sans jamais passer sous zéro.
   *
   * `items` : { x, y, radius } en mètres, monde centré comme la grille.
   */
  function contactAO(size, items, opts = {}) {
    const cell = opts.cell ?? 1;
    const half = opts.half ?? ((size - 1) * cell) / 2;
    const spread = opts.spread ?? 1.25;
    const out = makeField(size, 1);
    for (const it of items || []) {
      const r = Math.max(0.12, it.radius ?? 0.6);
      /* Une grande couronne masque plus de ciel qu'une petite : la force suit
         le rayon, plafonnée — sinon un arbre de 8 m peint un trou noir. */
      const strength = clamp01(it.strength ?? (0.30 + 0.45 * clamp01(r / 5)));
      const rc = (r * spread) / cell;
      if (!(rc > 0)) continue;
      const cx = (it.x + half) / cell, cy = (it.y + half) / cell;
      const i0 = Math.max(0, Math.floor(cx - rc)), i1 = Math.min(size - 1, Math.ceil(cx + rc));
      const j0 = Math.max(0, Math.floor(cy - rc)), j1 = Math.min(size - 1, Math.ceil(cy + rc));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i - cx, j - cy) / rc;
        if (d >= 1) continue;
        const f = (1 - d) * (1 - d);           // atténuation douce vers le bord
        out.data[j * size + i] *= 1 - strength * f;
      }
    }
    return out;
  }

  /** Combine plusieurs cartes d'occlusion (produit, borné). */
  function combineAO() {
    const fields = Array.prototype.slice.call(arguments);
    const s = fields[0].size;
    const out = makeField(s, 1);
    for (let i = 0; i < out.data.length; i++) {
      let v = 1;
      for (const f of fields) v *= f.data[i];
      out.data[i] = clamp01(v);
    }
    return out;
  }

  /* ═══ 8 · DISTRIBUTION ═══════════════════════════════════════════════════
     La végétation réelle n'est pas semée uniformément : elle est groupée, ses
     tailles suivent une loi de puissance (beaucoup de petits sujets, peu de
     grands), et une grande couronne étouffe ce qui pousse dessous.          */

  function makeRng(seed) {
    let n = (seed | 0) >>> 0 || 2654435769;
    return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296);
  }

  /**
   * Taches de colonisation. Le rayon est tiré en `u^power` : c'est CETTE loi
   * qui fait le réalisme, pas le nombre de taches. Un tirage uniforme donne
   * des massifs tous de la même taille, ce qu'aucun peuplement ne fait.
   */
  function colonyPatches(size, seed, opts = {}) {
    const colonies = opts.colonies ?? 90;
    const minR = opts.minRadius ?? size / 90;
    const maxR = opts.maxRadius ?? size / 12;
    const ragged = opts.ragged ?? 0.55;
    const power = opts.power ?? 2.1;
    const rng = makeRng(seed);
    const out = makeField(size);
    for (let c = 0; c < colonies; c++) {
      const r = lerp(minR, maxR, Math.pow(rng(), power));
      const cx = rng() * size, cy = rng() * size;
      const phase = rng() * Math.PI * 2, lobes = 3 + Math.floor(rng() * 4);
      const i0 = Math.max(0, Math.floor(cx - r * 1.6)), i1 = Math.min(size - 1, Math.ceil(cx + r * 1.6));
      const j0 = Math.max(0, Math.floor(cy - r * 1.6)), j1 = Math.min(size - 1, Math.ceil(cy + r * 1.6));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = i - cx, dy = j - cy;
        const a = Math.atan2(dy, dx);
        /* Bord lobé : un disque parfait se lit comme un tampon. */
        const rr = r * (1 + ragged * 0.5 * Math.sin(a * lobes + phase));
        const d = Math.hypot(dx, dy) / (rr || 1);
        if (d >= 1) continue;
        const v = (1 - d) * (1 - d);
        const k = j * size + i;
        out.data[k] = Math.min(1, out.data[k] + v);
      }
    }
    return out;
  }

  /**
   * Semis avec EXCLUSION par couronne.
   *
   * Les candidats sont traités du plus grand au plus petit ; un candidat est
   * rejeté s'il tombe sous la couronne d'un sujet déjà accepté plus grand que
   * lui. Sans cette règle on voit de l'herbe pousser au travers des troncs et
   * des arbustes sous une canopée fermée — deux choses que la nature ne fait
   * pas. `suppression` règle la dureté : 1 = la couronne exclut exactement,
   * 0,6 = elle tolère un sous-étage clairsemé.
   */
  function scatterWithExclusion(candidates, opts = {}) {
    const suppression = opts.suppression ?? 0.85;
    const cellSize = opts.gridCell ?? 8;
    const sorted = [...candidates].sort((a, b) => (b.radius ?? 0) - (a.radius ?? 0));
    const grid = new Map();
    const keep = [];
    for (const c of sorted) {
      const r = c.radius ?? 0.5;
      let blocked = false;
      const gx = Math.floor(c.x / cellSize), gy = Math.floor(c.y / cellSize);
      const span = Math.ceil((r + cellSize) / cellSize);
      for (let dy = -span; dy <= span && !blocked; dy++) {
        for (let dx = -span; dx <= span; dx++) {
          const bucket = grid.get((gx + dx) + ',' + (gy + dy));
          if (!bucket) continue;
          for (const o of bucket) {
            if (o.radius <= r) continue;              // seul un PLUS GRAND exclut
            if (Math.hypot(o.x - c.x, o.y - c.y) < o.radius * suppression) { blocked = true; break; }
          }
          if (blocked) break;
        }
      }
      if (blocked) continue;
      keep.push(c);
      const k = Math.floor(c.x / cellSize) + ',' + Math.floor(c.y / cellSize);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(c);
    }
    return keep;
  }

  /**
   * Poids d'appartenance de TOUTES les règles en une cellule, normalisés.
   * C'est l'écotone : au lieu d'un gagnant net, on rend un mélange. Une lisière
   * qui s'arrête d'un coup se lit comme fausse ; en tirant l'espèce selon ces
   * poids, la transition se fait toute seule sur quelques mètres.
   */
  function biomeWeights(maps, rules, k) {
    const w = new Array(rules.length);
    let sum = 0;
    for (let r = 0; r < rules.length; r++) {
      const rule = rules[r];
      const v =
        membership(maps.humidity.data[k], rule.humidity) *
        membership(maps.exposure.data[k], rule.exposure) *
        membership(maps.slope.data[k], rule.slope) *
        membership(maps.elevation.data[k], rule.elevation) *
        (rule.weight ?? 1);
      w[r] = v; sum += v;
    }
    if (sum <= 0) { w.fill(0); return w; }
    for (let r = 0; r < w.length; r++) w[r] /= sum;
    return w;
  }

  /* ═══ 9 · ESPÈCES RÉELLES (TERLAB) ═══════════════════════════════════════
     Le POC posait des biomes plausibles mais fictifs. TERLAB sait ce qui
     pousse vraiment : 33 espèces de La Réunion avec étage altitudinal, strate,
     hauteur adulte, rayon de couronne, statut de protection. Et
     `vegetation-detection.js` détecte les arbres EXISTANTS d'un site à partir
     du raster COSIA de l'IGN et du MNH LiDAR — hauteur et couronne mesurées.
     On n'invente plus, on nomme.                                            */

  /**
   * Appartenance douce aux trois étages. Les bornes SE CHEVAUCHENT dans la
   * source (mipentes 400–1000, hauts 800–2800) : entre 800 et 1000 m les deux
   * cohabitent, et c'est exact — c'est la zone de transition réelle.
   */
  function zoneForAltitude(altitudeM, zones) {
    const Z = zones || { littoral: [0, 400], mipentes: [400, 1000], hauts: [800, 2800] };
    const out = {};
    for (const name of Object.keys(Z)) {
      const lo = Z[name][0], hi = Z[name][1];
      const soft = (hi - lo) * 0.18;
      out[name] = smoothstep(lo - soft, lo + soft, altitudeM) *
                  (1 - smoothstep(hi - soft, hi + soft, altitudeM));
    }
    return out;
  }

  /**
   * Espèces plausibles pour un sujet mesuré.
   * `height` et `canopyRadius` viennent de la détection (MNH LiDAR + COSIA) ;
   * `altitude` est l'altitude ABSOLUE en mètres — pas l'altitude relative de
   * la carte `elevation`, qui ne dit rien d'un étage bioclimatique.
   */
  function suggestSpecies(species, q = {}) {
    const zw = zoneForAltitude(q.altitude ?? 0, q.zones);
    const scored = [];
    for (const sp of species) {
      const zones = [].concat(sp.zone || []);
      let z = 0;
      for (const n of zones) z = Math.max(z, zw[n] || 0);
      if (z <= 0.001) continue;

      let s = z;
      if (q.strate && sp.strate !== q.strate) s *= 0.15;
      if (q.height != null && sp.trunkH) {
        /* Tolérance RELATIVE : un écart absolu traiterait 2 m d'erreur pareil
           sur un couvre-sol de 1,5 m et sur un tamarin de 22 m. */
        s *= Math.max(0.02, 1 - Math.abs(sp.trunkH - q.height) / (sp.trunkH * 0.9));
      }
      if (q.canopyRadius != null && sp.canopyRadius) {
        s *= Math.max(0.05, 1 - Math.abs(sp.canopyRadius - q.canopyRadius) / (sp.canopyRadius * 1.1));
      }
      if (/invasif/.test(sp.status || '')) s *= q.allowInvasive ? 0.6 : 0.08;
      if (sp.status === 'protege' && q.favourProtected) s *= 1.25;
      if (q.cyclone && sp.cycloneResist === 'faible') s *= 0.55;
      if (s > 0) scored.push({ species: sp, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, q.max ?? 3);
  }

  /**
   * Arbres détectés par TERLAB → repère local du POC.
   * Format d'entrée : { position: [lng, lat], canopyRadiusMeasured,
   * heightMeasured? } — la sortie de `vegetation-detection.js`.
   */
  function importDetectedTrees(features, opts = {}) {
    const refLng = opts.refLng, refLat = opts.refLat;
    if (refLng === undefined || refLat === undefined) {
      throw new Error('importDetectedTrees : refLng/refLat requis pour projeter');
    }
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos(refLat * Math.PI / 180);
    const out = [];
    for (const f of features || []) {
      const p = f.position || f.coordinates;
      if (!Array.isArray(p) || p.length < 2) continue;
      out.push({
        id: f.id,
        x: (p[0] - refLng) * mPerDegLng,
        y: (p[1] - refLat) * mPerDegLat,
        radius: f.canopyRadiusMeasured != null ? f.canopyRadiusMeasured : (f.canopyRadius != null ? f.canopyRadius : 2),
        height: f.heightMeasured != null ? f.heightMeasured : null,
        source: f.source || 'terlab',
      });
    }
    return out;
  }

  /* ═══════════════════════════════════════════════════════════════════════ */

  /* ═══ 10 · GÉOLOGIE ET ÉROSION DIFFÉRENTIELLE ════════════════════════════
     L'érosion du module creusait une matière HOMOGÈNE. C'est pour ça qu'elle
     rendait des collines molles : ce qui fabrique une corniche, une vire, un
     ressaut de falaise, c'est l'érosion DIFFÉRENTIELLE entre un banc dur et un
     banc tendre.

     La dureté vient maintenant de la carte BRGM via TERLAB (`geology-reunion.js`),
     pas d'un bruit. Et l'infiltration compte autant : une coulée basaltique
     récente est à la fois inentamable ET si perméable qu'aucun ruisseau ne s'y
     forme — c'est pourquoi on n'y voit pas de ravines.                        */

  /**
   * Champ de dureté par bancs horizontaux.
   *
   * `beds` : [{ hardness, thickness }] du BAS vers le HAUT, épaisseurs en
   * mètres. Une cellule prend la dureté du banc que son altitude traverse.
   * `noise` fait onduler les contacts : une limite parfaitement plane se lit
   * comme un défaut de rendu, pas comme une stratigraphie.
   */
  function hardnessFromBeds(height, beds, opts = {}) {
    if (!beds || !beds.length) throw new Error('hardnessFromBeds : aucun banc');
    const s = height.size;
    const out = makeField(s);
    const base = opts.base ?? 0;
    const wobble = opts.wobble ?? 0.0;
    const rng = makeRng(opts.seed || 1);
    /* Déphasages tirés une fois : sans eux, tous les contacts ondulent
       ensemble et on voit une nappe, pas des bancs. */
    const ph = beds.map(() => rng() * Math.PI * 2);

    const tops = [];
    let acc = base;
    for (const b of beds) { acc += Math.max(0.01, b.thickness); tops.push(acc); }
    const topMost = tops[tops.length - 1];

    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const k = y * s + x;
      let z = height.data[k];
      if (wobble > 0) {
        z += Math.sin(x * 0.13 + ph[0]) * wobble * 0.6 + Math.cos(y * 0.11 + ph[0]) * wobble * 0.4;
      }
      let idx = 0;
      while (idx < tops.length - 1 && z > tops[idx]) idx++;
      /* Au-dessus du dernier banc on garde le plus haut plutôt que d'inventer :
         une altitude hors stratigraphie connue n'est pas une roche inconnue,
         c'est le sommet de la pile. */
      out.data[k] = z > topMost ? beds[beds.length - 1].hardness : beds[idx].hardness;
    }
    return out;
  }

  /**
   * Érosion thermique MODULÉE par la dureté.
   *
   * L'angle de talus n'est plus constant : une roche dure tient une pente
   * raide, une roche tendre s'effondre tôt. C'est exactement ce qui creuse une
   * vire sous un banc dur — le tendre recule, le dur reste en encorbellement.
   *
   * `hardness` : champ 0..1 de même taille. `talusSoft`/`talusHard` bornent la
   * pente tenable.
   */
  function differentialThermalErosion(field, hardness, opts = {}) {
    if (!hardness || hardness.size !== field.size) {
      throw new Error('differentialThermalErosion : champ de dureté absent ou de taille différente');
    }
    const iterations = opts.iterations ?? 8;
    const cell = opts.cell ?? 1;
    const talusSoft = (opts.talusSoft ?? 0.35) * cell;
    const talusHard = (opts.talusHard ?? 1.4) * cell;
    const rate = opts.rate ?? 0.4;
    const s = field.size;
    const h = Float32Array.from(field.data);
    const delta = new Float32Array(s * s);
    const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
    const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
    const DIAG = [1, 0, 1, 0, 0, 1, 0, 1];

    for (let it = 0; it < iterations; it++) {
      delta.fill(0);
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        const i = y * s + x;
        const talus = lerp(talusSoft, talusHard, clamp01(hardness.data[i]));
        let total = 0, maxExcess = 0;
        const drops = [];
        for (let d = 0; d < 8; d++) {
          const nx = x + DX[d], ny = y + DY[d];
          if (nx < 0 || ny < 0 || nx >= s || ny >= s) continue;
          const j = ny * s + nx;
          const dist = DIAG[d] ? Math.SQRT2 : 1;
          const excess = (h[i] - h[j]) - talus * dist;
          if (excess > 0) {
            drops.push([j, excess]); total += excess;
            if (excess > maxExcess) maxExcess = excess;
          }
        }
        if (!total) continue;
        /* Même borne que `thermalErosion` : la MOITIÉ du plus grand excédent,
           jamais leur somme — sinon la surface diverge en oscillant, avec un
           volume pourtant conservé. */
        const move = Math.min(total, maxExcess * 0.5) * rate;
        delta[i] -= move;
        for (const [j, excess] of drops) delta[j] += move * (excess / total);
      }
      for (let i = 0; i < h.length; i++) h[i] += delta[i];
    }
    return { size: s, data: h };
  }

  /**
   * Accumulation de flux pondérée par l'INFILTRATION.
   *
   * Chaque cellule ne verse plus une unité de pluie mais `1 − infiltration` :
   * une coulée récente boit tout et ne fabrique aucun ruisseau, un sol argileux
   * ruisselle. Sur une île volcanique, c'est ce qui explique que le réseau
   * hydrographique existe dans les massifs anciens et pas sur les coulées
   * fraîches — la pente y est pourtant la même.
   */
  function flowWithInfiltration(field, infiltration, opts = {}) {
    const src = opts.fill === false ? field : fillDepressions(field);
    const s = src.size, n = s * s;
    const h = src.data;
    const acc = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const inf = infiltration ? clamp01(infiltration.data[i]) : 0;
      acc[i] = Math.max(0.02, 1 - inf);
    }

    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    const sorted = Array.from(order).sort((a, b) => h[b] - h[a]);

    const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
    const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
    const DIAG = [1, 0, 1, 0, 0, 1, 0, 1];
    for (const i of sorted) {
      const x = i % s, y = (i / s) | 0;
      let best = -1, bestDrop = 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= s || ny >= s) continue;
        const j = ny * s + nx;
        const drop = (h[i] - h[j]) / (DIAG[d] ? Math.SQRT2 : 1);
        if (drop > bestDrop) { bestDrop = drop; best = j; }
      }
      if (best >= 0) acc[best] += acc[i];
    }
    const out = makeField(s);
    for (let i = 0; i < n; i++) out.data[i] = Math.log(1 + acc[i]);
    return out;
  }

  /**
   * Pile de bancs depuis une formation BRGM.
   *
   * Une formation donne UNE dureté ; un versant en montre plusieurs. On génère
   * donc une pile alternée autour de la valeur de référence — c'est une
   * hypothèse, pas une mesure, et elle est signalée comme telle par
   * `synthetic: true`. La carte au 1:50 000 ne descend pas au banc.
   */
  function bedsFromFormation(formation, opts = {}) {
    const raw = clamp01(formation && formation.hardness != null ? formation.hardness : 0.5);
    const count = opts.count ?? 5;
    const spread = opts.spread ?? 0.22;
    /* La référence est REPLIÉE dans [spread, 1−spread] avant d'alterner. Sans
       ça, une formation à 0,95 voit tous ses bancs durs écrêsés à 1,0 par le
       clamp : l'alternance survit d'un côté seulement et le CONTRASTE — la
       seule chose qui fabrique une corniche — s'effondre. */
    const base = raw * (1 - 2 * spread) + spread;
    const thickness = opts.thickness ?? 3.5;
    const rng = makeRng(opts.seed || 7);
    const beds = [];
    for (let i = 0; i < count; i++) {
      /* Alternance dur / tendre : c'est le contraste qui fait la corniche, pas
         la valeur absolue. */
      const sign = i % 2 === 0 ? 1 : -1;
      beds.push({
        hardness: clamp01(base + sign * spread * (0.6 + rng() * 0.8)),
        thickness: thickness * (0.6 + rng() * 0.9),
      });
    }
    return { beds, synthetic: true, from: formation ? formation.type : null };
  }

  return {

    makeField, cloneField, sample, gradient, slopeField, blur,
    normalizeByPercentile, assertFinite,
    // hydrologie & relief
    fillDepressions, flowAccumulation, exposure, thermalErosion,
    // biomes
    deriveBiomeMaps, classifyBiomes, membership, DEFAULT_RULES,
    // LOD
    focalPixels, screenSpaceError, pickLod, motionFloor, TileIndex,
    HYST_UP, HYST_DOWN,
    // IGN
    fieldFromIgnGrid, tinFromField, buildFromIgn,
    // couleur linéaire
    srgbToLinear, linearToSrgb, hexToLinear, linearToHex, mixSrgb,
    // occlusion ambiante
    horizonAO, contactAO, combineAO,
    // distribution
    makeRng, colonyPatches, scatterWithExclusion, biomeWeights,
    // espèces réelles
    zoneForAltitude, suggestSpecies, importDetectedTrees,
    // géologie et érosion différentielle
    hardnessFromBeds, differentialThermalErosion, flowWithInfiltration, bedsFromFormation,
    // utilitaires exposés pour les sondes
    clamp, clamp01, lerp, smoothstep,
  };
});

/* ═══════════════════════════════════════════════════════════════════════════
   Wrapper ESM TERLAB — ajoute des exports ES modules SANS toucher aux
   algorithmes ci-dessus (copie integrale de web-app/docs/terrain garden/
   biome-lod.js). L'UMD a deja pose `globalThis.BiomeLOD` : on le reexporte,
   ce qui garde la compat avec les consommateurs globaux (editeur
   atlas-jardins) tout en permettant `import BiomeLOD from '.../biome-lod.js'`
   dans TERLAB (navigateur) et dans les sondes Node (scripts/probe-tiles.mjs).
   ═══════════════════════════════════════════════════════════════════════════ */

const BiomeLOD = globalThis.BiomeLOD;
if (!BiomeLOD) {
  throw new Error('[biome-lod] UMD non initialise — globalThis.BiomeLOD absent');
}

export default BiomeLOD;

// Sous-ensemble LOD consomme par services/terrain-tile-manager.js et les sondes
export const {
  focalPixels,
  screenSpaceError,
  pickLod,
  motionFloor,
  TileIndex,
  HYST_UP,
  HYST_DOWN,
} = BiomeLOD;
