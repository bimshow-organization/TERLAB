/**
 * species-geometry.js — géométrie végétale procédurale low-poly (vertex colors)
 * portée depuis l'atlas-jardins (.docs/atlas-jardins-editeur_7.html, Section D,
 * L11690-12318) vers TERLAB. Portage fidèle des builders palm / canopy /
 * conifer / lily / shrub / fern / grass / flower / cave / rock / slab / slabr.
 *
 * @coords
 *   ─ Les builders atlas produisent du **Z-up** (convention de l'éditeur
 *     atlas : camera.up = (0,0,1)). Concrètement : mergeParts() applique
 *     rotateX(+π/2) (espace d'auteur Y-up → moteur Z-up, détail INTERNE au
 *     builder, conservé verbatim), buildGrass/buildCaveMouth sont écrits
 *     directement en Z-up, buildRock/buildSlab font leur rotateX(+π/2) interne.
 *   ─ TERLAB est **Y-up**. La conversion Z-up → Y-up est faite en UN SEUL
 *     point : à la fin de buildSpeciesGeometry() (et buildGrassTuftGeometry),
 *     par geometry.applyMatrix4(makeRotationX(-π/2)) — jamais de second flip
 *     en aval (skill coord-systems : un seul y-flip). applyMatrix4 transforme
 *     aussi l'attribut normal (on ne recalcule PAS computeVertexNormals après
 *     le flip : l'herbe a des normales d'auteur volontairement uniformes).
 *   ─ Origine au pied de la plante : y = 0 au sol après conversion.
 *
 * Écarts assumés vs la source (voir aussi species-map.js) :
 *   ─ RNG : mulberry32 seedé par speciesKey+variant (déterministe) au lieu du
 *     LCG makeRng de l'atlas — silhouettes équivalentes, séquences différentes.
 *   ─ buildCaveMouth : la source renvoie un THREE.Group (3 matériaux) ; ici
 *     tout est fusionné en une BufferGeometry vertex-colorée (le fond noir
 *     devient des vertex colors très sombres au lieu d'un MeshBasicMaterial).
 *   ─ Recettes 'bam' (designs paramétriques) : non portées → null + warn.
 *   ─ Échelle : ajustée aux trunkH / canopyRadius du JSON bpf (scale non
 *     uniforme XZ vs Y), au lieu de SPECIES_SCALE de l'atlas.
 *   ─ Teinte : opts.tint / opts.flowerColor modulent les couleurs de recette
 *     AVANT le bake (mix feuillage 0.42, fleurs 0.78 — analogue de
 *     IMAGE_TINT_STRENGTH de l'atlas).
 *
 * Usage :
 *   await initSpeciesGeometry();
 *   const { geometry, height, canopyRadius } =
 *     buildSpeciesGeometry('palm_coconut', 1, { tint: '#4a7c3f' });
 */

import {
  ATLAS_SPECIES, SPECIES_MAP, DEFAULT_BY_GROWTHFORM,
  STRATA_SHYNESS, SPECIES_SCALE, VEG_VARIANTS, resolveAtlasId,
} from './species-map.js';
import { resilientJSON } from '../../utils/resilient-fetch.js';

/* Ré-exports : la table pure reste importable sans THREE via species-map.js */
export { SPECIES_MAP, ATLAS_SPECIES, DEFAULT_BY_GROWTHFORM, STRATA_SHYNESS, SPECIES_SCALE, VEG_VARIANTS, resolveAtlasId };

/* ── État module ──────────────────────────────────────────────────────────── */
let THREE = null;          // namespace three.js, résolu une fois à l'init
let BPF = null;            // dictionnaire espèces de data/bpf-species-reunion.json
let _initPromise = null;
const _cache = new Map();  // clé speciesKey|variant|tint|flower|fit → résultat

/**
 * Initialise le module : résout THREE (window.THREE partagé BIMSHOW sinon CDN
 * épinglé, jamais de double bundle) et charge le JSON bpf des 33 espèces.
 * Idempotent. @param {{speciesData?: object}} [opts] injection pour tests.
 */
export async function initSpeciesGeometry(opts = {}) {
  if (_initPromise && !opts.speciesData) return _initPromise;
  _initPromise = (async () => {
    THREE = (typeof window !== 'undefined' && window.THREE)
      ? window.THREE
      : await import('https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.module.js');
    if (opts.speciesData) {
      BPF = opts.speciesData.species || opts.speciesData;
    } else if (BPF == null) {
      const url = new URL('../../data/bpf-species-reunion.json', import.meta.url).href;
      const json = await resilientJSON(url, { fallback: null, retries: 2, timeout: 8000 });
      BPF = (json && json.species) || {};   // tolère l'échec : bake sans mise à l'échelle bpf
    }
  })();
  return _initPromise;
}

function _assertReady() {
  if (!THREE) throw new Error('[species-geometry] initSpeciesGeometry() doit être awaité avant tout bake');
}

/* ── RNG mulberry32 déterministe (règle du portage : seed speciesKey+variant) */
function mulberry32(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* hashStr de l'atlas (L24034) — verbatim */
function hashStr(s) {
  let h = 9;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 387420489);
  return (h ^ (h >>> 9)) >>> 0;
}

/* Seed par espèce+variante — même formule que speciesVariant de l'atlas
   (1009 + v*7919 + hashStr(sp) % 4001), la clé bpf remplaçant l'id atlas pour
   que deux espèces bpf partageant une recette ne soient pas des clones. */
function seedFor(speciesKey, variant) {
  return 1009 + variant * 7919 + (hashStr(speciesKey) % 4001);
}

/* ── Helpers géométriques de l'atlas (portage verbatim, THREE injecté) ────── */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + t * (b - a);
const jit = (rng, a) => 1 + (rng() - 0.5) * a;     // facteur autour de 1
const off = (rng, a) => (rng() - 0.5) * a;         // décalage centré sur 0

const CYL  = (a, b, h, s) => new THREE.CylinderGeometry(a, b, h, s);
const CONE = (r, h, s)    => new THREE.ConeGeometry(r, h, s);
const ICO  = (r)          => new THREE.IcosahedronGeometry(r, 0);

function col3(h) { const c = new THREE.Color(h); return [c.r, c.g, c.b]; }

function M4(tx, ty, tz, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4().makeTranslation(tx, ty, tz);
  if (ry) m.multiply(new THREE.Matrix4().makeRotationY(ry));
  if (rz) m.multiply(new THREE.Matrix4().makeRotationZ(rz));
  m.multiply(new THREE.Matrix4().makeScale(sx, sy, sz));
  return m;
}

/** Merge de sous-géométries + vertex colors + bascule Z-up (rotateX π/2).
    Verbatim atlas L11709 — le rotateX fait partie du builder (espace d'auteur
    → convention atlas Z-up), la conversion TERLAB Y-up vient APRÈS, une fois. */
function mergeParts(parts) {
  let tot = 0;
  const pr = parts.map(p => {
    let g = p.geo.clone();
    g.applyMatrix4(p.m);
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.normal) g.computeVertexNormals();
    const c = g.attributes.position.count;
    tot += c;
    return { g, c: p.c, cnt: c };
  });
  const pos = new Float32Array(tot * 3);
  const nor = new Float32Array(tot * 3);
  const col = new Float32Array(tot * 3);
  let o = 0;
  for (const { g, c, cnt } of pr) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < cnt; i++) {
      col[(o + i) * 3] = c[0]; col[(o + i) * 3 + 1] = c[1]; col[(o + i) * 3 + 2] = c[2];
    }
    o += cnt;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
  geo.rotateX(Math.PI / 2);        // auteur Y-up → convention atlas Z-up
  return geo;
}

/** Fusion de géométries portant DÉJÀ leur attribut color (cave mouth).
    Adaptation locale : la source rend un Group multi-matériaux, ici on
    aplatit tout en une seule BufferGeometry vertex-colorée. */
function mergeColored(geos) {
  const flat = geos.map(g => {
    let x = g;
    if (x.index) x = x.toNonIndexed();
    if (!x.attributes.normal) x.computeVertexNormals();
    return x;
  });
  let tot = 0;
  for (const g of flat) tot += g.attributes.position.count;
  const pos = new Float32Array(tot * 3);
  const nor = new Float32Array(tot * 3);
  const col = new Float32Array(tot * 3);
  let o = 0;
  for (const g of flat) {
    const cnt = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += cnt;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
  return geo;
}

/* ── Builders atlas (portage verbatim L11885-12244) ──────────────────────── */

/** Segment tronc/branche orienté de A vers B. M4 = T·Ry·Rz·S, donc l'axe local
    +Y devient (−sinθ·cosφ, cosθ, sinθ·sinφ) : on inverse pour trouver θ et φ. */
function limb(ax, ay, az, bx, by, bz, r0, r1, c) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const L = Math.max(1e-4, Math.hypot(dx, dy, dz));
  const th = Math.acos(Math.max(-1, Math.min(1, dy / L)));
  const ph = Math.atan2(dz, -dx);
  return { geo: CYL(r1, r0, L, 5), m: M4((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, ph, th), c };
}

/** Palmier — stipe légèrement incliné + palmes en cross-quads (2 lames
    sécantes aplaties l'une sur Z, l'autre sur X). */
function buildPalm(t, f, sp, rng) {
  const H = 2.4 * jit(rng, 0.28);
  const lean = off(rng, 0.5);
  const tx = lean * 0.22, tz = off(rng, 0.3) * 0.18;
  const p = [
    limb(0, 0, 0, tx * 0.5, H * 0.55, tz * 0.5, 0.15, 0.11, col3(t)),
    limb(tx * 0.5, H * 0.55, tz * 0.5, tx, H, tz, 0.11, 0.075, col3(t)),
  ];
  const n = sp ? 11 : 8;
  const base = sp ? 1.9 : 1.7, wid = sp ? 0.3 : 0.5, flat = sp ? 0.11 : 0.17;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + off(rng, 0.55);
    const len = base * jit(rng, 0.36);
    const droop = (sp ? -1.5 : -1.18) + off(rng, 0.42);
    for (let k = 0; k < 2; k++) {
      p.push({
        geo: CONE(wid, len, 4),
        m: M4(tx, H, tz, a, droop, k ? flat : 1, 1, k ? 1 : flat)
             .multiply(new THREE.Matrix4().makeTranslation(0, len * 0.5, 0)),
        c: col3(f),
      });
    }
  }
  return mergeParts(p);
}

/** Feuillu — tronc à contrefort + masses de canopée reliées par des branches.
    Le flare basal suit 1 + A·e^(−λt), approché en 2 segments. */
function buildCanopy(t, f, fl, rng) {
  const H = 1.8 * jit(rng, 0.3);
  const R = 1.2 * jit(rng, 0.26);
  const p = [
    { geo: CYL(0.19, 0.33, 0.28, 7), m: M4(0, 0.14, 0), c: col3(t) },       // contrefort
    { geo: CYL(0.125, 0.19, H, 7),   m: M4(0, 0.28 + H / 2, 0), c: col3(t) },
  ];
  const top = 0.28 + H;
  const nb = 3 + (rng() > 0.55 ? 1 : 0);
  for (let i = 0; i < nb; i++) {
    const a = i / nb * Math.PI * 2 + off(rng, 0.8);
    const d = i === 0 ? 0 : R * (0.5 + rng() * 0.45);
    const bx = Math.cos(a) * d, bz = Math.sin(a) * d;
    const by = top + (i === 0 ? R * 0.5 : R * (0.1 + rng() * 0.5));
    const rr = (i === 0 ? R : R * (0.46 + rng() * 0.3));
    if (i > 0) p.push(limb(0, top - 0.25, 0, bx, by, bz, 0.085, 0.045, col3(t)));
    p.push({ geo: ICO(rr), m: M4(bx, by, bz, off(rng, 3), 0, 1.22, 0.82, 1.22), c: col3(f) });
  }
  if (fl != null) {
    const nf = 5 + Math.floor(rng() * 3);
    for (let i = 0; i < nf; i++) {
      const a = i / nf * Math.PI * 2 + off(rng, 0.5);
      p.push({ geo: ICO(0.2 * jit(rng, 0.4)),
               m: M4(Math.cos(a) * R * 0.8, top + R * (0.5 + off(rng, 0.5)), Math.sin(a) * R * 0.8),
               c: col3(fl) });
    }
  }
  return mergeParts(p);
}

/** Conifère — tronc + étages coniques jittés. `narrow` : port colonnaire
    (cyprès) — étages resserrés et empilés plus haut. */
function buildConifer(t, f, narrow, rng) {
  const nar = narrow ? 1 : 0;
  const H = (narrow ? 3.4 : 2.6) * jit(rng, 0.32);
  const p = [{ geo: CYL(0.065, 0.15, H, 6), m: M4(0, H / 2, 0), c: col3(t) }];
  const tiers = (narrow ? 5 : 4) + (rng() > 0.6 ? 1 : 0);
  const rBase = narrow ? 0.5 : 1.15;
  for (let i = 0; i < tiers; i++) {
    const k = i / tiers;
    p.push({
      geo: CONE(rBase * (1 - k * (narrow ? 0.45 : 0.7)) * jit(rng, 0.22),
                (narrow ? 1.6 : 1.3) * jit(rng, 0.26), 7),
      m: M4(off(rng, nar ? 0.03 : 0.1), H * 0.5 + i * (H * (narrow ? 0.19 : 0.27)),
            off(rng, nar ? 0.03 : 0.1), off(rng, 3), 0),
      c: col3(f),
    });
  }
  return mergeParts(p);
}

/** Nénuphar — feuilles flottantes + fleur. */
function buildLily(f, fl, rng) {
  const p = [];
  const n = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + off(rng, 0.9);
    const d = 0.16 + rng() * 0.34;
    const r = 0.23 * jit(rng, 0.55);
    p.push({ geo: CYL(r, r, 0.03, 7), m: M4(Math.cos(a) * d, 0.02, Math.sin(a) * d), c: col3(f) });
  }
  if (fl != null) {
    p.push({ geo: ICO(0.1), m: M4(off(rng, 0.2), 0.09, off(rng, 0.2), 0, 0, 1, 0.65, 1), c: col3(fl) });
  }
  return mergeParts(p);
}

/** Arbuste — 3 à 4 masses basses, rayons et décentrages tirés au sort */
function buildShrub(f, fl, rng) {
  const p = [];
  const nb = 3 + (rng() > 0.5 ? 1 : 0);
  for (let i = 0; i < nb; i++) {
    const a = i / nb * Math.PI * 2 + off(rng, 0.9);
    const d = i === 0 ? 0 : 0.28 + rng() * 0.24;
    const r = (i === 0 ? 0.5 : 0.34 + rng() * 0.14) * jit(rng, 0.26);
    p.push({ geo: ICO(r),
             m: M4(Math.cos(a) * d, 0.4 + off(rng, 0.18), Math.sin(a) * d, off(rng, 3), 0, 1.1, 0.88, 1.1),
             c: col3(f) });
  }
  if (fl != null) {
    const nf = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < nf; i++) {
      const a = i / nf * Math.PI * 2 + off(rng, 0.6);
      p.push({ geo: ICO(0.15 * jit(rng, 0.4)),
               m: M4(Math.cos(a) * 0.42, 0.66 + off(rng, 0.18), Math.sin(a) * 0.42), c: col3(fl) });
    }
  }
  return mergeParts(p);
}

/** Fougère — rosette de frondes arquées en cross-quads. */
function buildFern(f, rng) {
  const p = [];
  const n = 7 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + off(rng, 0.45);
    const len = 0.9 * jit(rng, 0.42);
    const droop = -0.9 + off(rng, 0.55);
    for (let k = 0; k < 2; k++) {
      p.push({
        geo: CONE(0.17, len, 4),
        m: M4(off(rng, 0.06), 0.08, off(rng, 0.06), a, droop, k ? 0.13 : 1, 1, k ? 1 : 0.13)
             .multiply(new THREE.Matrix4().makeTranslation(0, len * 0.5, 0)),
        c: col3(f),
      });
    }
  }
  return mergeParts(p);
}

/** Brin d'herbe cross-quad plié (style Forest-Master) — auteur DIRECT Z-up */
function buildGrass(colHex, tall) {
  const H = tall ? 0.9 : 0.4, W = 0.15, HW = W * 0.5;
  const SEGS = 5, ROWS = SEGS + 1, MAX_BEND = 0.05;
  const c = new THREE.Color(colHex);
  const VPQ = ROWS * 2, TOT = VPQ * 2;
  const positions = new Float32Array(TOT * 3);
  const colors    = new Float32Array(TOT * 3);
  const normals   = new Float32Array(TOT * 3);
  const indices = [];
  const buildQuad = (ofs, axis, bendDir) => {
    for (let r = 0; r < ROWS; r++) {
      const t = r / SEGS, z = t * H, bend = bendDir * MAX_BEND * t * t;
      for (let s = 0; s < 2; s++) {
        const side = s === 0 ? -HW : HW;
        const vi = ofs + r * 2 + s;
        if (axis === 'x') { positions[vi*3] = side + bend; positions[vi*3+1] = 0; positions[vi*3+2] = z; }
        else              { positions[vi*3] = 0; positions[vi*3+1] = side + bend; positions[vi*3+2] = z; }
        const k = 0.7 + 0.3 * t;   // dégradé pied 70% → sommet 100%
        colors[vi*3] = c.r * k; colors[vi*3+1] = c.g * k; colors[vi*3+2] = c.b * k;
        normals[vi*3] = 0; normals[vi*3+1] = 0; normals[vi*3+2] = 1;
      }
    }
    for (let r = 0; r < SEGS; r++) {
      const a = ofs + r*2, b = ofs + r*2 + 1, cc = ofs + (r+1)*2, d = ofs + (r+1)*2 + 1;
      indices.push(a, b, d,  a, d, cc,  a, d, b,  a, cc, d);   // front + back
    }
  };
  buildQuad(0, 'x', +1);
  buildQuad(VPQ, 'y', -1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

/** Fleur sur tige — tiges + corolle de pétales, nombre/inclinaison par seed. */
function buildFlower(b1, b2, rng) {
  const p = [];
  const ns = 3 + (rng() > 0.6 ? 1 : 0);
  let hTop = 1;
  for (let i = 0; i < ns; i++) {
    const a = i / ns * Math.PI * 2 + off(rng, 0.7);
    const hh = 1 * jit(rng, 0.34);
    if (hh > hTop) hTop = hh;
    p.push({ geo: CYL(0.018, 0.032, hh, 4),
             m: M4(Math.cos(a) * 0.1, hh / 2, Math.sin(a) * 0.1, a, Math.cos(a) * 0.22),
             c: col3(0x3f6b33) });
  }
  const np = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < np; i++) {
    const a = i / np * Math.PI * 2;
    p.push({ geo: CONE(0.085 * jit(rng, 0.3), 0.3 * jit(rng, 0.25), 4),
             m: M4(Math.cos(a) * 0.06, hTop + 0.04, Math.sin(a) * 0.06, a, -0.8 + off(rng, 0.3), 1, 1, 0.32),
             c: col3(b1) });
  }
  p.push({ geo: ICO(0.085), m: M4(0, hTop + 0.07, 0, 0, 0, 1, 0.6, 1), c: col3(b2) });
  return mergeParts(p);
}

/**
 * Entrée de grotte — un SUJET posé, pas une cavité traversable (auteur Z-up).
 * Écart vs source : le Group (auvent Lambert + joues + fond MeshBasic noir)
 * est fusionné en UNE géométrie vertex-colorée — le fond devient des sommets
 * quasi noirs (0x05060a), il s'éclaircira légèrement sous lumière directe.
 */
function buildCaveMouthGeo(colHex, size) {
  const rng = mulberry32(4711 + Math.round(size * 100));
  const W = size, H = size * 1.15, D = size * 0.85;
  const rock = new THREE.Color(colHex || 0x6e6a60);
  const geos = [];

  /* L'auvent : demi-sphère aplatie ouverte vers l'avant, jitter par sommet,
     assombrissement vers l'intérieur du porche. */
  const arch = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI, 0, Math.PI * 0.55);
  {
    const pos = arch.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const j = 0.86 + rng() * 0.28;
      pos.setXYZ(i, pos.getX(i) * W * j, pos.getY(i) * D * j, pos.getZ(i) * H * j);
    }
    arch.computeVertexNormals();
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const depth = clamp((pos.getY(i) / D) * 0.5 + 0.5, 0, 1);
      const sh = lerp(0.30, 1.0, depth);
      col[i * 3] = rock.r * sh; col[i * 3 + 1] = rock.g * sh; col[i * 3 + 2] = rock.b * sh;
    }
    arch.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(arch);
  }

  /* Les joues : deux masses latérales qui encadrent l'ouverture. */
  for (const side of [-1, 1]) {
    const cheek = new THREE.IcosahedronGeometry(size * 0.5, 1);
    const pos = cheek.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const j = 0.7 + rng() * 0.6;
      pos.setXYZ(i, pos.getX(i) * j * 0.8, pos.getY(i) * j * 0.9, pos.getZ(i) * j * 1.25);
    }
    cheek.computeVertexNormals();
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const sh = 0.72 + (pos.getZ(i) / size) * 0.3;
      col[i * 3] = rock.r * sh; col[i * 3 + 1] = rock.g * sh; col[i * 3 + 2] = rock.b * sh;
    }
    cheek.setAttribute('color', new THREE.BufferAttribute(col, 3));
    cheek.translate(side * W * 0.82, D * 0.1, H * 0.28);
    geos.push(cheek);
  }

  /* Le fond : disque quasi noir en retrait, visible par l'ouverture. */
  {
    const back = new THREE.CircleGeometry(W * 0.78, 20);
    const dark = new THREE.Color(0x05060a);
    const cnt = back.attributes.position.count;
    const col = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) { col[i*3] = dark.r; col[i*3+1] = dark.g; col[i*3+2] = dark.b; }
    back.setAttribute('color', new THREE.BufferAttribute(col, 3));
    back.rotateX(Math.PI / 2);                    // équiv. mesh.rotation.x = π/2
    back.translate(0, D * 0.42, H * 0.42);
    geos.push(back);
  }

  return mergeColored(geos);
}

/** Rocher — ICO déplacé pseudo-aléatoirement, écrasé au sol */
function buildRock(colHex, size) {
  const geo = new THREE.IcosahedronGeometry(size, 1);
  const pos = geo.attributes.position;
  const rng = mulberry32(1234 + Math.round(size * 100));
  for (let i = 0; i < pos.count; i++) {
    const jf = 0.72 + rng() * 0.5;
    pos.setXYZ(i, pos.getX(i) * jf, pos.getY(i) * jf * 0.62, pos.getZ(i) * jf);
  }
  geo.computeVertexNormals();
  const c = new THREE.Color(colHex);
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const sh = 0.85 + (pos.getY(i) / size) * 0.25;   // + clair au sommet
    col[i*3] = c.r * sh; col[i*3+1] = c.g * sh; col[i*3+2] = c.b * sh;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, size * 0.28);
  return geo;
}

/** Dalle RECTANGULAIRE (allées architecturées — posée orientée au tracé) */
function buildSlabRect(colHex, sx, sy) {
  const geo = new THREE.BoxGeometry(sx, sy, 0.09);
  const c = new THREE.Color(colHex);
  const cnt = geo.attributes.position.count;
  const col = new Float32Array(cnt * 3);
  for (let i = 0; i < cnt; i++) {
    const sh = geo.attributes.position.getZ(i) > 0 ? 1 : 0.82;   // chants + sombres
    col[i * 3] = c.r * sh; col[i * 3 + 1] = c.g * sh; col[i * 3 + 2] = c.b * sh;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.translate(0, 0, 0.055);
  return geo;
}

/** Dalle / pas japonais — cylindre plat irrégulier */
function buildSlab(colHex, r) {
  const geo = new THREE.CylinderGeometry(r, r * 1.06, 0.09, 9);
  const c = new THREE.Color(colHex);
  const cnt = geo.attributes.position.count;
  const col = new Float32Array(cnt * 3);
  for (let i = 0; i < cnt; i++) { col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, 0.05);
  return geo;
}

/* ── Dispatch recette → builder (miroir du switch atlas L12251) ──────────── */
function buildRecipeGeometry(recipe, rng) {
  const [type, ...a] = recipe;
  switch (type) {
    case 'palm':    return buildPalm(a[0], a[1], a[2], rng);
    case 'canopy':  return buildCanopy(a[0], a[1], a[2], rng);
    case 'conifer': return buildConifer(a[0], a[1], a[2], rng);
    case 'lily':    return buildLily(a[0], a[1], rng);
    case 'shrub':   return buildShrub(a[0], a[1], rng);
    case 'fern':    return buildFern(a[0], rng);
    case 'grass':   return buildGrass(a[0], a[1]);
    case 'flower':  return buildFlower(a[0], a[1], rng);
    case 'rock':    return buildRock(a[0], a[1]);
    case 'cave':    return buildCaveMouthGeo(a[0], a[1]);
    case 'slab':    return buildSlab(a[0], a[1]);
    case 'slabr':   return buildSlabRect(a[0], a[1], a[2]);
    case 'bam':
      console.warn('[species-geometry] recette BAM non portée :', a[0]);
      return null;
    default:
      console.warn('[species-geometry] type de recette inconnu :', type);
      return null;
  }
}

/* ── Teinte : modulation des couleurs de recette AVANT bake ──────────────── */
const TINT_LEAF = 0.42;    // analogue IMAGE_TINT_STRENGTH leaf de l'atlas
const TINT_FLOWER = 0.78;  // analogue IMAGE_TINT_STRENGTH flower

/** Mixe deux hex (0xRRGGBB ou '#rrggbb') : base·(1−k) + tint·k, par canal. */
function mixHex(baseHex, tintHex, k) {
  const b = new THREE.Color(baseHex), t = new THREE.Color(tintHex);
  const c = new THREE.Color(lerp(b.r, t.r, k), lerp(b.g, t.g, k), lerp(b.b, t.b, k));
  return c.getHex();
}

/* Index des params feuillage / fleur par type de recette (recipe[1 + idx]) */
const LEAF_IDX   = { palm: 1, canopy: 1, conifer: 1, shrub: 0, fern: 0, grass: 0, lily: 0 };
const FLOWER_IDX = { canopy: 2, shrub: 1, lily: 1 };

/** Applique tint/flowerColor à une COPIE de la recette. */
function tintedRecipe(recipe, tint, flowerColor) {
  if (tint == null && flowerColor == null) return recipe;
  const r = recipe.slice();
  const type = r[0];
  if (tint != null && LEAF_IDX[type] !== undefined) {
    const i = 1 + LEAF_IDX[type];
    if (r[i] != null) r[i] = mixHex(r[i], tint, TINT_LEAF);
  }
  if (flowerColor != null) {
    if (type === 'flower') {
      /* pétales + cœur : la corolle entière prend la teinte fleur */
      r[1] = mixHex(r[1], flowerColor, TINT_FLOWER);
      r[2] = mixHex(r[2], flowerColor, TINT_FLOWER);
    } else if (FLOWER_IDX[type] !== undefined) {
      const i = 1 + FLOWER_IDX[type];
      /* une recette sans fleur (null) en gagne une si l'espèce bpf fleurit */
      r[i] = r[i] != null ? mixHex(r[i], flowerColor, TINT_FLOWER) : new THREE.Color(flowerColor).getHex();
    }
  }
  return r;
}

/* ── API publique ─────────────────────────────────────────────────────────── */

/**
 * Recette atlas résolue pour une clé bpf.
 * @returns {{speciesKey, atlasId, exact, recipe, canopyR, label, cat, bpf}|null}
 */
export function getSpeciesRecipe(speciesKey) {
  const bpf = (BPF && BPF[speciesKey]) || null;
  const { atlasId, exact } = resolveAtlasId(speciesKey, bpf?.growthForm);
  const def = ATLAS_SPECIES[atlasId];
  if (!def) return null;
  return {
    speciesKey, atlasId, exact,
    recipe: def.recipe.slice(),
    canopyR: def.canopyR,
    label: def.label, cat: def.cat,
    bpf,
  };
}

/**
 * Bake la géométrie d'une espèce bpf (Y-up, origine au pied, vertex colors).
 *
 * @param {string} speciesKey  clé bpf (ex. 'palm_coconut') — les ids atlas
 *                             ('cocotier'…) sont aussi acceptés en direct.
 * @param {number} [variant=0] 0..VEG_VARIANTS-1, silhouette seedée stable
 * @param {object} [opts]
 *   tint        hex color2D — module le feuillage (mix 0.42)
 *   flowerColor hex — module/ajoute les fleurs (mix 0.78)
 *   fit         false pour garder l'échelle atlas brute (défaut : ajuste à
 *               trunkH / canopyRadius du JSON bpf, scale XZ ≠ Y)
 *   height / canopyRadius  cibles explicites (m) prioritaires sur le JSON
 * @returns {{geometry: THREE.BufferGeometry, height: number, canopyRadius: number}|null}
 */
export function buildSpeciesGeometry(speciesKey, variant = 0, opts = {}) {
  _assertReady();
  const nv = VEG_VARIANTS;
  const v = ((variant % nv) + nv) % nv;
  const key = `${speciesKey}|${v}|${opts.tint ?? ''}|${opts.flowerColor ?? ''}|${opts.fit !== false}|${opts.height ?? ''}|${opts.canopyRadius ?? ''}`;
  if (_cache.has(key)) return _cache.get(key);

  /* Résolution : clé bpf mappée, sinon id atlas direct, sinon repli growthForm */
  const rec = getSpeciesRecipe(speciesKey)
    ?? (ATLAS_SPECIES[speciesKey]
        ? { speciesKey, atlasId: speciesKey, exact: true, recipe: ATLAS_SPECIES[speciesKey].recipe.slice(), canopyR: ATLAS_SPECIES[speciesKey].canopyR, bpf: null }
        : null);
  if (!rec) return null;

  const recipe = tintedRecipe(rec.recipe, opts.tint ?? null, opts.flowerColor ?? null);
  const rng = mulberry32(seedFor(speciesKey, v));
  const geo = buildRecipeGeometry(recipe, rng);
  if (!geo) return null;

  /* @coords — LE flip unique Z-up (atlas) → Y-up (TERLAB). applyMatrix4
     transforme positions ET normales ; pas de recompute des normales (celles
     de l'herbe sont d'auteur). Origine au pied : y = 0. */
  geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  geo.computeBoundingBox();

  /* Échelle : hauteur → trunkH (proxy hauteur totale bpf), rayon horizontal →
     canopyRadius bpf. Scale non uniforme XZ vs Y. */
  let height = geo.boundingBox.max.y;
  let radius = Math.max(
    geo.boundingBox.max.x, -geo.boundingBox.min.x,
    geo.boundingBox.max.z, -geo.boundingBox.min.z);
  if (opts.fit !== false) {
    const targetH = opts.height ?? rec.bpf?.trunkH ?? null;
    const targetR = opts.canopyRadius ?? rec.bpf?.canopyRadius ?? null;
    const sh = (targetH != null && height > 1e-3) ? targetH / height : 1;
    const sr = (targetR != null && radius > 1e-3) ? targetR / radius : sh;
    if (sh !== 1 || sr !== 1) {
      geo.applyMatrix4(new THREE.Matrix4().makeScale(sr, sh, sr));
      geo.computeBoundingBox();
      height *= sh;
      radius *= sr;
    }
  }
  geo.computeBoundingSphere();

  const out = { geometry: geo, height, canopyRadius: radius };
  _cache.set(key, out);
  return out;
}

/**
 * Touffe d'herbe = 3 quads croisés, pivot au pied, UV 0..1 (portage verbatim
 * de buildGrassTuft atlas L14552, auteur Z-up → converti Y-up ici, une fois).
 * Attributs : position, uv, ah (hauteur normalisée 0..1 pour vent/dégradé).
 * @param {number} height hauteur de la touffe (m)
 */
export function buildGrassTuftGeometry(height) {
  _assertReady();
  const H = height, HW = H * 0.5, NQ = 3;
  const pos = [], uv = [], ah = [], idx = [];
  for (let q = 0; q < NQ; q++) {
    const a = q * Math.PI / NQ, ca = Math.cos(a), sa = Math.sin(a), b = q * 4;
    pos.push(-HW * ca, -HW * sa, 0,   HW * ca, HW * sa, 0,
              HW * ca,  HW * sa, H,  -HW * ca, -HW * sa, H);
    uv.push(0, 0,  1, 0,  1, 1,  0, 1);
    ah.push(0, 0, 1, 1);
    idx.push(b, b + 1, b + 2,  b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('ah', new THREE.Float32BufferAttribute(ah, 1));
  g.setIndex(idx);
  /* @coords — même flip unique Z-up → Y-up que buildSpeciesGeometry */
  g.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
