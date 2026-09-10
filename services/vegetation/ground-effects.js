/**
 * ground-effects.js — effets de sol (AO de contact + teinte d'humus) sur un
 * mesh terrain à VERTEX COLORS. Lot 6 du chantier « terrain végétalisé ».
 *
 * Pourquoi ce module existe
 * ─────────────────────────
 * « Une plante sans ombre au pied flotte au-dessus du sol » : c'est le premier
 * signe d'un rendu artificiel, et l'éclairage de P05 l'aggrave (ambiante +
 * hémisphérique éclairent un dessous de canopée aussi fort qu'une clairière).
 * L'AO de contact est exactement le facteur correctif manquant — voir
 * `utils/biome-lod.js` §7, dont ce module est la transposition « sommets ».
 *
 * ASSUMÉ / limites (pas de dette cachée)
 * ──────────────────────────────────────
 *  ─ PAS de splatmap texture. L'influence plante→sol du BPF (litière, humus
 *    sous couvert) est rendue ici en VERTEX COLORS : la résolution spatiale de
 *    l'effet est donc celle du maillage terrain LiDAR (≈ 1 sommet / m sur un
 *    MNT 1 m), pas celle d'un texel. Sous une canopée de 3 m de rayon cela fait
 *    une trentaine de sommets — assez pour lire la tache, pas pour un bord net.
 *    Une splatmap demanderait des UV + une texture + un shader custom : hors
 *    périmètre, et le mesh terrain n'a aucun attribut `uv`.
 *  ─ `contactAO()` de biome-lod.js N'EST PAS réutilisé : sa signature est
 *    `(size, items, opts)` et elle rend un CHAMP carré row-major indexé
 *    `data[y*size+x]`, centré via `half`. Notre terrain est un maillage
 *    cols×rows dont ce module ne reçoit qu'une BufferGeometry opaque (aucun
 *    cols/rows/origine transmis) : reprojeter le champ sur les sommets
 *    demanderait de redupliquer le mapping grille↔sommets du producteur, donc
 *    d'introduire exactement le genre de désynchronisation qu'on évite. On
 *    applique donc l'effet DIRECTEMENT sur les sommets, avec la même mécanique
 *    (disque atténué, atténuation multiplicative, force croissante avec le
 *    rayon de couronne).
 *  ─ Coût : O(sommets + plantes) grâce à une grille spatiale de plantes dont la
 *    maille vaut le plus grand rayon d'influence — 3×3 cellules suffisent alors
 *    à couvrir tout ce qui peut toucher un sommet. Jamais de double boucle
 *    naïve (40 k sommets × 300 plantes = 12 M tests).
 *
 * Aucune dépendance : ni THREE, ni DOM. On ne touche que
 * `geometry.attributes.position` (lecture) et `.color` (écriture).
 *
 * @coords
 *   Le module travaille dans l'espace des SOMMETS de la géométrie fournie
 *   (unités de scène). C'est l'APPELANT qui convertit ses plantes via
 *   `toLocal(plant) → { x, z, radius }` — un seul point de conversion, donc un
 *   seul endroit où un flip peut se tromper (skill coord-systems).
 */

/* ── Réglages par défaut ──────────────────────────────────────────────────── */

/** Rayon d'influence = canopyRadius × SPREAD (l'ombre déborde de la couronne). */
export const DEFAULT_SPREAD = 1.4;

/** Assombrissement maximal, toutes couronnes confondues (≈ 35 %). */
export const DEFAULT_AO_STRENGTH = 0.35;

/** Mélange maximal vers l'humus (≈ 30 %). */
export const DEFAULT_TINT_STRENGTH = 0.30;

/** Humus / litière sous couvert — brun sombre, comparable au gradient terrain
 *  de `_buildTerrainMesh` (R 0.18→0.43, G 0.35→0.55, B 0.12→0.20). */
export const HUMUS_COLOR = { r: 0.22, g: 0.16, b: 0.09 };

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Falloff doux : 1 au centre, 0 au bord, dérivée nulle aux deux extrémités.
 *  Une atténuation linéaire laisse un cerne visible sur le bord du disque. */
function falloff(d) {
  const t = clamp01(d);
  const s = t * t * (3 - 2 * t);   // smoothstep(0,1,t)
  return 1 - s;
}

/**
 * Grille spatiale de points, maille `cellSize`.
 * `forEachNear` balaie les 9 cellules autour de (x,z) : c'est exhaustif tant
 * que `cellSize` ≥ le plus grand rayon d'influence — d'où le calcul du max
 * avant construction, et non une maille arbitraire.
 * @param {{x:number,z:number}[]} points
 * @param {number} cellSize
 */
export function makePointIndex(points, cellSize) {
  const cell = Math.max(1e-6, cellSize);
  const map = new Map();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.z)) continue;
    const k = Math.floor(p.x / cell) + ',' + Math.floor(p.z / cell);
    let b = map.get(k);
    if (!b) map.set(k, (b = []));
    b.push(p);
  }
  return {
    cell,
    get cellCount() { return map.size; },
    /** @param {number} x @param {number} z @param {(p:any)=>void} fn */
    forEachNear(x, z, fn) {
      const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const b = map.get((gx + dx) + ',' + (gz + dz));
          if (!b) continue;
          for (let i = 0; i < b.length; i++) fn(b[i]);
        }
      }
    },
  };
}

/**
 * Projette les plantes dans l'espace des sommets et construit l'index.
 * @returns {{index: ReturnType<makePointIndex>, maxR: number, count: number}|null}
 */
function projectPlants(plants, toLocal, spread) {
  if (!Array.isArray(plants) || !plants.length) return null;
  const conv = typeof toLocal === 'function'
    ? toLocal
    : (p) => ({ x: p.x, z: p.z ?? p.ySud, radius: p.radius ?? p.canopyRadius });
  const pts = [];
  let maxR = 0;
  for (const p of plants) {
    const q = conv(p);
    if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.z)) continue;
    const r = Math.max(1e-3, (Number.isFinite(q.radius) ? q.radius : 1)) * spread;
    pts.push({ x: q.x, z: q.z, r });
    if (r > maxR) maxR = r;
  }
  if (!pts.length) return null;
  return { index: makePointIndex(pts, maxR), maxR, count: pts.length };
}

/** Géométrie exploitable ? (position + color de même longueur) */
function readAttributes(geometry) {
  const pos = geometry?.attributes?.position;
  const col = geometry?.attributes?.color;
  if (!pos?.array || !col?.array) return null;
  if (col.itemSize !== 3 || pos.itemSize !== 3) return null;
  if (col.count !== pos.count) return null;
  return { pos: pos.array, col, colArr: col.array, count: pos.count };
}

/* ── 1 · AO DE CONTACT ────────────────────────────────────────────────────── */

/**
 * Assombrit les vertex colors du terrain sous et autour de chaque canopée.
 *
 * Mécanique reprise de `contactAO` (biome-lod.js §7) : chaque sujet dépose un
 * disque atténué, les couronnes qui se recouvrent s'assombrissent
 * MULTIPLICATIVEMENT (produit des atténuations, jamais de somme qui passerait
 * sous zéro), et la force suit le rayon — une grande couronne masque plus de
 * ciel qu'un arbuste. L'atténuation totale est bornée à `strength` : sans ce
 * plancher, un bosquet dense peint un trou noir.
 *
 * @param {object}   o
 * @param {object}   o.geometry  BufferGeometry avec attributs position + color
 * @param {Array}    o.plants    plantes (espace appelant)
 * @param {Function} [o.toLocal] plant → { x, z, radius } dans l'espace des sommets
 * @param {number}   [o.strength=0.35] assombrissement maximal (0..1)
 * @param {number}   [o.spread=1.4]    rayon d'influence = radius × spread
 * @returns {number} nombre de sommets effectivement modifiés
 */
export function applyContactAO({ geometry, plants, toLocal, strength = DEFAULT_AO_STRENGTH, spread = DEFAULT_SPREAD } = {}) {
  const attrs = readAttributes(geometry);
  if (!attrs) return 0;
  const S = clamp01(strength);
  if (S <= 0) return 0;
  const proj = projectPlants(plants, toLocal, spread);
  if (!proj) return 0;

  const { pos, col, colArr, count } = attrs;
  const floorFactor = 1 - S;          // plancher global d'assombrissement
  let touched = 0;

  for (let v = 0; v < count; v++) {
    const vx = pos[v * 3], vz = pos[v * 3 + 2];
    let att = 1;
    proj.index.forEachNear(vx, vz, (p) => {
      const dx = vx - p.x, dz = vz - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= p.r * p.r) return;
      const f = falloff(Math.sqrt(d2) / p.r);
      /* Force par sujet : 55 % du budget pour un semis, 100 % à partir d'une
         couronne de 5 m — même progression que biome-lod.contactAO. */
      const s = S * (0.55 + 0.45 * clamp01(p.r / (5 * spread)));
      att *= 1 - s * f;
    });
    if (att >= 0.9999) continue;
    if (att < floorFactor) att = floorFactor;
    const i = v * 3;
    colArr[i] *= att; colArr[i + 1] *= att; colArr[i + 2] *= att;
    touched++;
  }

  if (touched) col.needsUpdate = true;
  return touched;
}

/* ── 2 · TEINTE D'HUMUS ───────────────────────────────────────────────────── */

/**
 * Teinte légèrement le sol vers une couleur d'humus sous les canopées —
 * équivalent vertex-color de l'influence plante→sol du BPF (litière, sol nu
 * ombragé), SANS splatmap texture (voir l'en-tête du module).
 *
 * Même mécanique que l'AO : disque, falloff smoothstep, index spatial. Seule
 * la composition change — un MÉLANGE vers une couleur cible, pas un produit :
 * deux couronnes superposées convergent vers l'humus au lieu de le dépasser.
 *
 * @param {object}   o
 * @param {object}   o.geometry
 * @param {Array}    o.plants
 * @param {Function} [o.toLocal]
 * @param {number}   [o.strength=0.30] mélange maximal vers `color`
 * @param {number}   [o.spread=1.4]
 * @param {{r,g,b}}  [o.color=HUMUS_COLOR] couleur cible (composantes 0..1)
 * @returns {number} nombre de sommets effectivement modifiés
 */
export function applyGroundTint({ geometry, plants, toLocal, strength = DEFAULT_TINT_STRENGTH, spread = DEFAULT_SPREAD, color = HUMUS_COLOR } = {}) {
  const attrs = readAttributes(geometry);
  if (!attrs) return 0;
  const S = clamp01(strength);
  if (S <= 0) return 0;
  const proj = projectPlants(plants, toLocal, spread);
  if (!proj) return 0;

  const { pos, col, colArr, count } = attrs;
  const tr = color?.r ?? HUMUS_COLOR.r;
  const tg = color?.g ?? HUMUS_COLOR.g;
  const tb = color?.b ?? HUMUS_COLOR.b;
  let touched = 0;

  for (let v = 0; v < count; v++) {
    const vx = pos[v * 3], vz = pos[v * 3 + 2];
    /* Influence combinée : on garde la PLUS FORTE couverture plutôt que de
       cumuler — la litière d'un bosquet n'est pas « plus humus » que celle
       d'un seul arbre, elle est juste continue. */
    let cover = 0;
    proj.index.forEachNear(vx, vz, (p) => {
      const dx = vx - p.x, dz = vz - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= p.r * p.r) return;
      const f = falloff(Math.sqrt(d2) / p.r);
      if (f > cover) cover = f;
    });
    if (cover <= 1e-4) continue;
    const k = S * cover;
    const i = v * 3;
    colArr[i]     += (tr - colArr[i])     * k;
    colArr[i + 1] += (tg - colArr[i + 1]) * k;
    colArr[i + 2] += (tb - colArr[i + 2]) * k;
    touched++;
  }

  if (touched) col.needsUpdate = true;
  return touched;
}

export default { applyContactAO, applyGroundTint, makePointIndex, HUMUS_COLOR };
