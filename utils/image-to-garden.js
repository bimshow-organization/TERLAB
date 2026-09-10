/* ═══════════════════════════════════════════════════════════════════════════
   IMAGE → JARDIN · lecture PLASTIQUE d'une image quelconque
   ───────────────────────────────────────────────────────────────────────────
   L'image n'est pas lue comme une photo aérienne — le vert n'« est » pas de la
   végétation. Elle est lue comme une COMPOSITION : ses couleurs organisent des
   masses, et on projette cette organisation sur la palette des biomes par
   distance chromatique. Un tableau, une affiche, un motif deviennent alors un
   parti pris de jardin, ce qui est exactement l'esprit de l'atlas.

   Sortie : un SVG dans la boîte 110 du pont, annoté `data-biome`. Tout l'aval
   — blobs, CBS, adaptation, stratégies d'extension, terrain — est déjà écrit
   et n'a pas à savoir d'où vient le plan.

       image → échantillonnage → k-means Lab → masques → morpho →
       composantes → contours → simplification → SVG data-biome → pont

   Le point dur n'est PAS la classification, c'est la SEGMENTATION : une
   classification par pixel produit des milliers de confettis. C'est ce qui
   manque à l'OBIA de TERLAB (services/obia-service.js), qui est per-pixel
   malgré son nom. Morphologie + composantes connexes + aire minimale ne sont
   donc pas du confort, ce sont elles qui font tenir le résultat.

   Dépendances : aucune. Palette injectée par l'hôte via setPalette().
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const IG = {};
  const BOX = 110;                    // boîte du pont atlas

  IG.DEFAULTS = {
    grid: 132,        // résolution d'analyse (cellules par côté)
    superpixels: 900, // cellules de Voronoï SLIC — la précision des frontières
    slicIters: 6,
    compactness: 12,  // bas = épouse les contours · haut = superpixels réguliers
    k: 8,             // nombre de masses chromatiques — 6 écrasait un tableau
    iters: 14,
    minAreaPct: 0.005, // aire mini d'une masse, en fraction de l'image
    epsilon: 2.2,      // simplification des contours, en cellules
    smooth: 2,         // passes de Chaikin — ce qui casse l'effet escalier
    majority: 2,       // passes de vote de voisinage sur les étiquettes
    morph: 1,          // passes d'ouverture + fermeture par masque
    seed: 7,
    maxShapes: 90,     // garde-fou : au-delà le jardin devient illisible
    bgBiome: null,     // force le biome de fond (sinon : masse dominante)
  };

  /* ── Palette cible, injectée par l'hôte ────────────────────────────────────
     [{ id, hex, water }] — les `grad[0]` de BIOME_DEFS font une palette
     naturelle : ce sont les couleurs sous lesquelles chaque biome se lit. */
  IG.palette = [];
  IG.setPalette = function (list) {
    IG.palette = (list || []).filter(p => p && p.id && p.hex).map(p => ({
      id: p.id, hex: p.hex, water: !!p.water, accent: !!p.accent, lab: hexToLab(p.hex),
    }));
    return IG.palette.length;
  };

  /* ══ Couleur ═══════════════════════════════════════════════════════════════
     Distances calculées en Lab : en RGB, deux verts très différents à l'œil
     peuvent être plus proches que deux gris identiques. Lab est
     perceptuellement uniforme, c'est ce qui rend l'appariement crédible. */
  function srgbToLin(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function rgbToLab(r, g, b) {
    const R = srgbToLin(r), G = srgbToLin(g), B = srgbToLin(b);
    let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    let y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
    let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const f = t => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
    x = f(x); y = f(y); z = f(z);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }
  function hexToLab(hex) {
    const h = String(hex).replace('#', '');
    const n = h.length === 3
      ? h.split('').map(c => parseInt(c + c, 16))
      : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    return rgbToLab(n[0], n[1], n[2]);
  }
  function labToHex(L, a, bb) {
    const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - bb / 200;
    const inv = t => { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };
    const x = inv(fx) * 0.95047, y = inv(fy), z = inv(fz) * 1.08883;
    let r = x * 3.2406 + y * -1.5372 + z * -0.4986;
    let g = x * -0.9689 + y * 1.8758 + z * 0.0415;
    let b = x * 0.0557 + y * -0.2040 + z * 1.0570;
    const enc = c => {
      c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
      return Math.max(0, Math.min(255, Math.round(c * 255)));
    };
    return '#' + [enc(r), enc(g), enc(b)].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  const dLab = (p, q) => {
    const dl = p[0] - q[0], da = p[1] - q[1], db = p[2] - q[2];
    return Math.sqrt(dl * dl + da * da + db * db);
  };

  /* LCG : même image + même graine ⇒ même jardin. Indispensable pour comparer
     deux réglages, et pour que la sonde headless soit reproductible. */
  function lcg(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  /* ══ 1 · Échantillonnage ═══════════════════════════════════════════════════
     Recadrage COUVRANT puis carré : la boîte du pont est carrée, et déformer
     l'image pour la faire rentrer trahirait sa composition — or c'est
     précisément la composition qu'on vient chercher. */
  function sampleGrid(src, N) {
    const cv = document.createElement('canvas');
    cv.width = N; cv.height = N;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const sw = src.naturalWidth || src.videoWidth || src.width;
    const sh = src.naturalHeight || src.videoHeight || src.height;
    if (!sw || !sh) throw new Error('image sans dimensions');
    const side = Math.min(sw, sh);
    ctx.drawImage(src, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, N, N);
    return ctx.getImageData(0, 0, N, N).data;
  }

  /* ══ 2 · k-means en Lab ════════════════════════════════════════════════════
     Pas de seuils en dur : les plages HSV calibrées sur une ortho de La Réunion
     ne disent rien d'un tableau ou d'une affiche. On laisse l'image déclarer
     ses propres masses, on les nomme ensuite. */
  function kmeans(labs, n, k, iters, rng) {
    const cent = [];
    /* k-means++ : un tirage uniforme colle souvent deux germes dans la même
       masse dominante et laisse une masse entière sans représentant. */
    cent.push(labs[(rng() * n) | 0].slice());
    const d2 = new Float64Array(n);
    for (let c = 1; c < k; c++) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        let best = Infinity;
        for (const ce of cent) { const d = dLab(labs[i], ce); if (d < best) best = d; }
        d2[i] = best * best; sum += d2[i];
      }
      let t = rng() * sum, pick = n - 1;
      for (let i = 0; i < n; i++) { t -= d2[i]; if (t <= 0) { pick = i; break; } }
      cent.push(labs[pick].slice());
    }
    const lab = new Int32Array(n);
    for (let it = 0; it < iters; it++) {
      let moved = 0;
      for (let i = 0; i < n; i++) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < k; c++) { const d = dLab(labs[i], cent[c]); if (d < bd) { bd = d; best = c; } }
        if (lab[i] !== best) { lab[i] = best; moved++; }
      }
      const acc = Array.from({ length: k }, () => [0, 0, 0, 0]);
      for (let i = 0; i < n; i++) {
        const a = acc[lab[i]];
        a[0] += labs[i][0]; a[1] += labs[i][1]; a[2] += labs[i][2]; a[3]++;
      }
      for (let c = 0; c < k; c++) {
        if (!acc[c][3]) continue;
        cent[c] = [acc[c][0] / acc[c][3], acc[c][1] / acc[c][3], acc[c][2] / acc[c][3]];
      }
      if (!moved && it > 1) break;
    }
    const sizes = new Int32Array(k);
    for (let i = 0; i < n; i++) sizes[lab[i]]++;
    return { labels: lab, centroids: cent, sizes };
  }

  /* ══ 3 · Masse chromatique → biome ═════════════════════════════════════════
     Appariement glouton, des masses les plus GRANDES aux plus petites : c'est
     le fond qui doit obtenir son meilleur biome, pas un détail. Une pénalité
     de réemploi évite que six masses distinctes deviennent six pelouses — la
     variété fait la lecture du jardin autant que la justesse des teintes. */
  function assignBiomes(centroids, sizes, palette) {
    const order = Array.from(centroids.keys()).sort((a, b) => sizes[b] - sizes[a]);
    const used = new Map();
    const out = new Array(centroids.length);
    for (const c of order) {
      let best = null, bd = Infinity;
      for (const p of palette) {
        /* Un accent (grad[1]) est un liseré, pas la couleur dominante d'un
           biome : on le pénalise pour qu'il ne capte pas une grande masse,
           tout en restant atteignable quand rien d'autre ne convient. */
        const d = dLab(centroids[c], p.lab)
          * (1 + 0.55 * (used.get(p.id) || 0)) * (p.accent ? 1.25 : 1);
        if (d < bd) { bd = d; best = p; }
      }
      out[c] = best;
      if (best) used.set(best.id, (used.get(best.id) || 0) + 1);
    }
    return out;
  }

  /* ══ 4 · Morphologie ═══════════════════════════════════════════════════════
     Ouverture (érosion puis dilatation) : supprime les pixels isolés sans
     ronger les masses. Puis fermeture : rebouche les trous d'un pixel. Sans
     cette étape, chaque grain de bruit de l'image devient un biome. */
  function morph(mask, N, passes) {
    const ero = (src) => {
      const dst = new Uint8Array(N * N);
      for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
        const i = y * N + x;
        dst[i] = (src[i] && src[i - 1] && src[i + 1] && src[i - N] && src[i + N]) ? 1 : 0;
      }
      return dst;
    };
    const dil = (src) => {
      const dst = new Uint8Array(N * N);
      for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
        const i = y * N + x;
        dst[i] = (src[i] || src[i - 1] || src[i + 1] || src[i - N] || src[i + N]) ? 1 : 0;
      }
      return dst;
    };
    let m = mask;
    for (let p = 0; p < passes; p++) m = dil(ero(m));   // ouverture
    for (let p = 0; p < passes; p++) m = ero(dil(m));   // fermeture
    return m;
  }

  /* ══ 5 · Composantes connexes (4-connexité, pile explicite) ════════════════ */
  function components(mask, N, minCells) {
    const seen = new Uint8Array(N * N);
    const out = [];
    const stack = new Int32Array(N * N);
    for (let s = 0; s < N * N; s++) {
      if (!mask[s] || seen[s]) continue;
      let sp = 0, count = 0;
      stack[sp++] = s; seen[s] = 1;
      const cells = [];
      while (sp) {
        const i = stack[--sp];
        cells.push(i); count++;
        const x = i % N, y = (i / N) | 0;
        if (x > 0     && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[sp++] = i - 1; }
        if (x < N - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[sp++] = i + 1; }
        if (y > 0     && mask[i - N] && !seen[i - N]) { seen[i - N] = 1; stack[sp++] = i - N; }
        if (y < N - 1 && mask[i + N] && !seen[i + N]) { seen[i + N] = 1; stack[sp++] = i + N; }
      }
      if (count < minCells) continue;
      const cm = new Uint8Array(N * N);
      for (const i of cells) cm[i] = 1;
      out.push({ mask: cm, count });
    }
    return out;
  }

  /* ══ 6 · Contour ═══════════════════════════════════════════════════════════
     Chaînage d'arêtes de cellules plutôt qu'un suivi de bord pixel à pixel :
     chaque cellule pleine dont un voisin est vide émet une arête ORIENTÉE, et
     les arêtes se chaînent d'elles-mêmes en boucles fermées. Exact, et sans
     les cas particuliers du suivi de Moore.
     On ne garde que la boucle la plus longue : le pont ne reconstruit pas les
     trous, un contour extérieur est donc tout ce qui est exploitable. */
  function outline(mask, N) {
    const seg = new Map();                       // "x,y" → [x2,y2]
    const key = (x, y) => x + ',' + y;
    const add = (x1, y1, x2, y2) => { if (!seg.has(key(x1, y1))) seg.set(key(x1, y1), [x2, y2]); };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!mask[y * N + x]) continue;
      if (y === 0     || !mask[(y - 1) * N + x]) add(x + 1, y,     x,     y);
      if (y === N - 1 || !mask[(y + 1) * N + x]) add(x,     y + 1, x + 1, y + 1);
      if (x === 0     || !mask[y * N + x - 1])   add(x,     y,     x,     y + 1);
      if (x === N - 1 || !mask[y * N + x + 1])   add(x + 1, y + 1, x + 1, y);
    }
    let best = null;
    const done = new Set();
    for (const start of seg.keys()) {
      if (done.has(start)) continue;
      const loop = [];
      let cur = start, guard = 0;
      while (seg.has(cur) && !done.has(cur) && guard++ < seg.size + 4) {
        done.add(cur);
        const [x, y] = cur.split(',').map(Number);
        loop.push({ x, y });
        const nx = seg.get(cur);
        cur = key(nx[0], nx[1]);
      }
      if (loop.length >= 4 && (!best || loop.length > best.length)) best = loop;
    }
    return best;
  }

  /* Douglas–Peucker : un contour de cellules est en escalier ; sans
     simplification on émet des centaines de sommets par masse et le pont
     produit des polygones illisibles autant qu'inutilement lourds. */
  function simplify(pts, eps) {
    if (pts.length < 4) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      if (b - a < 2) continue;
      const A = pts[a], B = pts[b];
      const dx = B.x - A.x, dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1;
      let worst = -1, wi = -1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((pts[i].x - A.x) * dy - (pts[i].y - A.y) * dx) / len;
        if (d > worst) { worst = d; wi = i; }
      }
      if (worst > eps) { keep[wi] = 1; stack.push([a, wi], [wi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  /* ══ SLIC — superpixels ════════════════════════════════════════════════════
     Des cellules de Voronoï qui suivent les CONTOURS de l'image, au lieu d'une
     grille régulière qui les coupe au hasard. C'est le gain de précision
     décisif : un k-means par pixel décide indépendamment de chaque cellule et
     produit des bords en dents de scie ; SLIC décide par RÉGION cohérente,
     donc les frontières tombent là où l'image en a une.

     Distance = couleur + position, la position pondérée par `m/S`. m faible
     épouse finement les contours mais donne des superpixels tarabiscotés ; m
     élevé les garde compacts et réguliers. */
  function slic(labs, N, nSeeds, iters, m) {
    const S = Math.max(2, Math.round(Math.sqrt(N * N / Math.max(1, nSeeds))));
    const seeds = [];
    for (let y = (S >> 1); y < N; y += S) {
      for (let x = (S >> 1); x < N; x += S) {
        const p = labs[y * N + x];
        seeds.push({ L: p[0], a: p[1], b: p[2], x, y });
      }
    }
    if (!seeds.length) return null;
    const lab = new Int32Array(N * N).fill(-1);
    const dist = new Float64Array(N * N);
    const inv = (m * m) / (S * S);
    for (let it = 0; it < iters; it++) {
      dist.fill(Infinity);
      for (let s = 0; s < seeds.length; s++) {
        const sd = seeds[s];
        /* Recherche bornée à 2S autour du germe — c'est ce qui rend SLIC
           linéaire là où un k-means global est quadratique. */
        const x0 = Math.max(0, Math.round(sd.x - S)), x1 = Math.min(N - 1, Math.round(sd.x + S));
        const y0 = Math.max(0, Math.round(sd.y - S)), y1 = Math.min(N - 1, Math.round(sd.y + S));
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const i = y * N + x, p = labs[i];
            const dl = p[0] - sd.L, da = p[1] - sd.a, db = p[2] - sd.b;
            const dx = x - sd.x, dy = y - sd.y;
            const d = dl * dl + da * da + db * db + (dx * dx + dy * dy) * inv;
            if (d < dist[i]) { dist[i] = d; lab[i] = s; }
          }
        }
      }
      const acc = seeds.map(() => [0, 0, 0, 0, 0, 0]);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x, s = lab[i];
          if (s < 0) continue;
          const p = labs[i], A = acc[s];
          A[0] += p[0]; A[1] += p[1]; A[2] += p[2]; A[3] += x; A[4] += y; A[5]++;
        }
      }
      for (let s = 0; s < seeds.length; s++) {
        const A = acc[s];
        if (!A[5]) continue;
        seeds[s] = { L: A[0] / A[5], a: A[1] / A[5], b: A[2] / A[5], x: A[3] / A[5], y: A[4] / A[5], n: A[5] };
      }
    }
    return { labels: lab, seeds };
  }

  /* ══ Filtre majoritaire sur les ÉTIQUETTES ═════════════════════════════════
     Sur une photo — un portrait, un paysage — le k-means produit du poivre et
     sel : des cellules isolées prennent l'étiquette d'une masse voisine à cause
     du bruit du capteur ou du JPEG. La morphologie corrige ça masque par
     masque, mais trop tard : deux masques voisins se disputent alors les mêmes
     cellules et les frontières deviennent dentelées. On lisse donc les
     étiquettes AVANT, par vote de voisinage — la frontière devient une
     décision unique au lieu de deux érosions concurrentes. */
  function majority(labels, N, k, passes) {
    let cur = labels;
    const tally = new Int32Array(k);
    for (let p = 0; p < passes; p++) {
      const next = new Int32Array(cur.length);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        tally.fill(0);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          tally[cur[ny * N + nx]]++;
        }
        let best = cur[y * N + x], bc = -1;
        for (let c = 0; c < k; c++) if (tally[c] > bc) { bc = tally[c]; best = c; }
        next[y * N + x] = best;
      }
      cur = next;
    }
    return cur;
  }

  /* ══ Chaikin ═══════════════════════════════════════════════════════════════
     Un contour de cellules n'a que des angles droits : même simplifié, il reste
     un escalier, et sur une composition organique — un visage, un paysage — ça
     se voit immédiatement. Chaikin coupe chaque coin au quart et aux trois
     quarts ; deux passes suffisent à transformer l'escalier en courbe sans
     déplacer la masse. C'est ce qui manque le plus au rendu d'une photo. */
  function chaikin(pts, iters) {
    let p = pts;
    for (let it = 0; it < iters; it++) {
      if (p.length < 4) break;
      const out = [];
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
        out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
      }
      p = out;
    }
    return p;
  }

  /* ══ Pipeline ══════════════════════════════════════════════════════════════ */
  IG.fromImage = function (src, opts) {
    const O = Object.assign({}, IG.DEFAULTS, opts || {});
    if (!IG.palette.length) throw new Error('ImageToGarden : palette non injectée (setPalette)');
    const N = O.grid, n = N * N;
    const rng = lcg(O.seed);

    const px = sampleGrid(src, N);
    const labs = new Array(n);
    for (let i = 0; i < n; i++) labs[i] = rgbToLab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);

    /* Deux étages. SLIC découpe l'image en régions qui suivent ses contours ;
       le k-means ne classe ensuite que les ~900 MOYENNES de ces régions, pas
       les 17 000 pixels. Deux gains d'un coup : les frontières tombent sur les
       vraies limites de l'image, et la classification cesse d'être polluée par
       le bruit pixel à pixel. */
    const sp = slic(labs, N, O.superpixels, O.slicIters, O.compactness);
    let km;
    if (sp) {
      const means = sp.seeds.map(s => [s.L, s.a, s.b]);
      const kmS = kmeans(means, means.length, O.k, O.iters, rng);
      const lab = new Int32Array(n);
      for (let i = 0; i < n; i++) lab[i] = kmS.labels[sp.labels[i]] || 0;
      km = { labels: lab, centroids: kmS.centroids, sizes: new Int32Array(O.k) };
    } else {
      km = kmeans(labs, n, O.k, O.iters, rng);
    }
    /* Le vote de voisinage garde son utilité même après SLIC : il recolle les
       superpixels isolés qu'une frontière chromatique a fait basculer seuls. */
    km.labels = majority(km.labels, N, O.k, O.majority);
    km.sizes = new Int32Array(O.k);
    for (let i = 0; i < n; i++) km.sizes[km.labels[i]]++;
    const biomes = assignBiomes(km.centroids, km.sizes, IG.palette);

    /* Couleur MOYENNE RÉELLE d'un ensemble de cellules — pas le centroïde de
       la classe. C'est elle qui part en `data-tint` et qui va, en bout de
       chaîne, teinter les arbustes et les fleurs posés là. */
    const meanHex = (test) => {
      let r = 0, g = 0, bl = 0, c = 0;
      for (let i = 0; i < n; i++) {
        if (!test(i)) continue;
        r += px[i * 4]; g += px[i * 4 + 1]; bl += px[i * 4 + 2]; c++;
      }
      if (!c) return null;
      const h = (v) => Math.round(v / c).toString(16).padStart(2, '0');
      return '#' + h(r) + h(g) + h(bl);
    };

    /* La masse la plus étendue devient le FOND : un jardin a besoin d'un sol
       continu, et laisser le fond en polygones découpés ferait apparaître le
       plan de référence entre les masses.

       ⚠️ JAMAIS un biome d'eau. Sur un Monet — dont l'étang occupe presque
       toute la toile — le fond devenait `bassin`, donc le terrain ENTIER
       passait en plan d'eau : aucun végétal possible, un grand aplat sombre
       et quelques îlots. L'eau reste un motif, jamais le sol. */
    let bg = -1;
    for (let c = 0; c < O.k; c++) {
      if (biomes[c] && biomes[c].water) continue;
      if (bg < 0 || km.sizes[c] > km.sizes[bg]) bg = c;
    }
    if (bg < 0) { bg = 0; for (let c = 1; c < O.k; c++) if (km.sizes[c] > km.sizes[bg]) bg = c; }

    const minCells = Math.max(9, Math.round(n * O.minAreaPct));
    const shapes = [];
    for (let c = 0; c < O.k; c++) {
      if (c === bg || !biomes[c]) continue;
      let mask = new Uint8Array(n);
      for (let i = 0; i < n; i++) if (km.labels[i] === c) mask[i] = 1;
      mask = morph(mask, N, O.morph);
      for (const comp of components(mask, N, minCells)) {
        const loop = outline(comp.mask, N);
        if (!loop) continue;
        /* Simplifier FRANCHEMENT puis lisser : l'inverse — lisser un escalier
           de plusieurs centaines de sommets — coûte cher et garde l'ondulation
           du crénelage. Ici la simplification décide de la forme, le lissage
           n'en adoucit que les angles. */
        const poly = chaikin(simplify(loop, O.epsilon), O.smooth);
        if (poly.length < 4) continue;
        shapes.push({
          cluster: c, biome: biomes[c], poly, count: comp.count,
          /* Teinte propre à CETTE forme : deux massifs de la même classe mais
             de nuances différentes dans l'image donnent deux jardins de
             nuances différentes. C'est là que la précision se voit. */
          tint: meanHex(i => comp.mask[i] === 1),
        });
      }
    }
    /* Les plus grandes masses d'abord : si le garde-fou coupe, il coupe des
       détails, jamais la structure. */
    shapes.sort((a, b) => b.count - a.count);
    const kept = shapes.slice(0, O.maxShapes);

    const s = BOX / N;
    const d = (poly) => 'M' + poly.map(p =>
      (p.x * s).toFixed(2) + ' ' + (p.y * s).toFixed(2)).join(' L') + ' Z';

    let svg = `<svg viewBox="0 0 ${BOX} ${BOX}" width="${BOX}" height="${BOX}" xmlns="http://www.w3.org/2000/svg">`;
    /* Le biome de FOND est le plus structurant du jardin : il occupe le reste
       du terrain et donne le ton. On laisse donc la main dessus, la masse
       dominante n'étant qu'un défaut. */
    const bgB = (O.bgBiome && IG.palette.find(p => p.id === O.bgBiome)) || biomes[bg];
    const bgTint = meanHex(i => km.labels[i] === bg);
    svg += `<rect x="0" y="0" width="${BOX}" height="${BOX}" fill="${labToHex.apply(null, km.centroids[bg])}"`
         + (bgB ? ` data-biome="${bgB.id}"` : ' data-op="skip"')
         + (bgTint ? ` data-tint="${bgTint}"` : '') + '/>';
    for (const sh of kept) {
      svg += `<path d="${d(sh.poly)}" fill="${labToHex.apply(null, km.centroids[sh.cluster])}"`
           + ` data-biome="${sh.biome.id}"` + (sh.tint ? ` data-tint="${sh.tint}"` : '') + '/>';
    }
    svg += '</svg>';

    return {
      svg,
      report: {
        grid: N, k: O.k,
        fond: bgB ? bgB.id : null,
        masses: km.centroids.map((c, i) => ({
          biome: biomes[i] ? biomes[i].id : null,
          hex: labToHex.apply(null, c),
          pct: Math.round(km.sizes[i] / n * 100),
        })).sort((a, b) => b.pct - a.pct),
        formes: kept.length,
        formesEcartees: shapes.length - kept.length,
        sommets: kept.reduce((t, x) => t + x.poly.length, 0),
      },
    };
  };

  /* Fiche synthétique : `openFromCard` lit un élément DOM, pas un fichier.
     Une image devient donc une fiche de l'atlas comme une autre — elle hérite
     du panneau Composition, des modes d'extension et de l'adaptation. */
  IG.buildCard = function (svg, name, id) {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.gardenType = 'image_import';
    el.dataset.gardenId = id || ('image_' + Date.now().toString(36));
    el.innerHTML = `<span class="badge">image</span>`
      + `<div class="svg-wrap">${svg}</div>`
      + `<div class="name">${(name || 'Image').replace(/[<>&]/g, '')}</div>`;
    return el;
  };

  window.ImageToGarden = IG;
})();

/* ── Export ESM (ajout TERLAB, seule modification) ──────────────────────────
   L'IIFE ci-dessus pose window.ImageToGarden — le global est conservé tel quel
   (compat avec les consommateurs non-module, cf. atlas-jardins-editeur_7.html
   côté web-app). Cet export permet en plus, dans les modules ES de TERLAB :
     import { ImageToGarden } from './utils/image-to-garden.js';
   Aucune modification des algorithmes ni des paramètres par défaut. */
export const ImageToGarden = (typeof window !== 'undefined') ? window.ImageToGarden : undefined;
