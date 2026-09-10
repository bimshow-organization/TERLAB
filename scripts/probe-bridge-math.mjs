#!/usr/bin/env node
/**
 * probe-bridge-math.mjs — validation pur JS (Node, zéro dépendance) de la
 * composition de matrices de components/mapbox-three-bridge.js.
 *
 * On importe la vraie fonction composeLayerMatrix() du bridge et on lui passe
 * un mock minimal de THREE (Matrix4 column-major, sémantique identique à
 * Three.js : multiply = this·m, scale = post-multiplication par diag(v)).
 *
 * Invariants testés :
 *   1. SANDWICH (piège 2)  — off⁻¹·euler·off laisse le centre du modèle
 *      invariant par rotation (le modèle pivote, il n'orbite pas).
 *   2. FLIP Y UNIQUE (piège 1) — la base scène (est, nord, haut) part sur
 *      (+s, -s, +s) en mercator : Y nié exactement une fois
 *      (déterminant de la partie linéaire = -s³, pas +s³).
 *   3. SENS DE ROTATION — +90° envoie l'est scène sur le nord scène
 *      (anti-horaire vu du ciel), soit -s en Y mercator.
 *   4. CONTRE-EXEMPLE — sans le sandwich (T·S·R nu), le centre bouge :
 *      preuve que le sandwich n'est pas décoratif.
 *
 * Usage : node scripts/probe-bridge-math.mjs
 */

import { composeLayerMatrix } from '../components/mapbox-three-bridge.js';

/* ── Mock THREE minimal (sémantique Three.js, column-major) ──────────────── */

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
}

class Euler {
  constructor(x = 0, y = 0, z = 0, order = 'XYZ') {
    this.x = x; this.y = y; this.z = z; this.order = order;
  }
}

class Matrix4 {
  constructor() {
    // Identité, column-major comme Three.js (elements[12..14] = translation).
    this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }
  makeTranslation(x, y, z) {
    this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
    return this;
  }
  makeRotationFromEuler(e) {
    if (e.x !== 0 || e.y !== 0) {
      throw new Error('mock: seule la rotation Z est supportée (le bridge ne fait que rotateZ)');
    }
    const c = Math.cos(e.z), s = Math.sin(e.z);
    // Colonne 0 = (c, s, 0, 0) ; colonne 1 = (-s, c, 0, 0) — rotation Z CCW.
    this.elements = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    return this;
  }
  scale(v) {
    // Sémantique Three.js : multiplie les COLONNES par v ⇔ this = this·diag(v).
    const te = this.elements;
    te[0] *= v.x; te[1] *= v.x; te[2] *= v.x; te[3] *= v.x;
    te[4] *= v.y; te[5] *= v.y; te[6] *= v.y; te[7] *= v.y;
    te[8] *= v.z; te[9] *= v.z; te[10] *= v.z; te[11] *= v.z;
    return this;
  }
  multiply(m) {
    // Sémantique Three.js : this = this · m
    const a = this.elements, b = m.elements, r = new Array(16).fill(0);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
        r[col * 4 + row] = sum;
      }
    }
    this.elements = r;
    return this;
  }
  clone() {
    const m = new Matrix4();
    m.elements = this.elements.slice();
    return m;
  }
  invert() {
    // Le bridge n'inverse que `off` (translation pure) → inversion analytique.
    const te = this.elements;
    const isPureTranslation =
      te[0] === 1 && te[5] === 1 && te[10] === 1 && te[15] === 1 &&
      te[1] === 0 && te[2] === 0 && te[3] === 0 && te[4] === 0 &&
      te[6] === 0 && te[7] === 0 && te[8] === 0 && te[9] === 0 && te[11] === 0;
    if (!isPureTranslation) {
      throw new Error('mock invert: translation pure uniquement — le bridge a changé ?');
    }
    te[12] = -te[12]; te[13] = -te[13]; te[14] = -te[14];
    return this;
  }
  fromArray(a) {
    this.elements = Array.from(a);
    return this;
  }
}

const THREE = { Matrix4, Vector3, Euler };

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function applyPoint(m, p) {
  const te = m.elements;
  return {
    x: te[0] * p.x + te[4] * p.y + te[8] * p.z + te[12],
    y: te[1] * p.x + te[5] * p.y + te[9] * p.z + te[13],
    z: te[2] * p.x + te[6] * p.y + te[10] * p.z + te[14],
  };
}

function det3(m) {
  // Déterminant de la partie linéaire 3×3 (column-major).
  const te = m.elements;
  const a = te[0], b = te[4], c = te[8];
  const d = te[1], e = te[5], f = te[9];
  const g = te[2], h = te[6], i = te[10];
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

let failures = 0;
function assertNear(actual, expected, eps, label) {
  const ok = Math.abs(actual - expected) <= eps;
  if (!ok) {
    failures++;
    console.error(`  ✗ ${label} : attendu ${expected}, obtenu ${actual} (eps ${eps})`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}
function assertTrue(cond, label) {
  if (!cond) { failures++; console.error(`  ✗ ${label}`); }
  else console.log(`  ✓ ${label}`);
}

/* ── Données de test (ordres de grandeur réels : mercator ~[0,1], s ~1e-8) ─ */

const s = 8.983152841e-8;                 // meterInMercatorCoordinateUnits à La Réunion (~lat -21)
const base = {
  translateX: 0.654321,                   // mercator x de Saint-Denis (ordre de grandeur)
  translateY: 0.558877,
  translateZ: 12 * s,
  scale: s,
  center: { x: 37.2, y: -12.8 },          // centre bbox modèle, en mètres scène
};
const C = { x: base.center.x, y: base.center.y, z: 0 };
const EPS = 1e-15;                        // tolérance en unités mercator (1e-15 ≈ 0,01 mm ici)

/* ── Test 1 : invariance du centre sous rotation (sandwich, piège 2) ─────── */

console.log('Test 1 — sandwich off⁻¹·euler·off : centre invariant par rotation');
const l0 = composeLayerMatrix(THREE, { ...base, rotateZ: 0 });
const ref = applyPoint(l0, C);
for (const theta of [0.001, 0.7, Math.PI / 3, Math.PI / 2, Math.PI, -2.1, 5.9]) {
  const l = composeLayerMatrix(THREE, { ...base, rotateZ: theta });
  const p = applyPoint(l, C);
  assertNear(p.x, ref.x, EPS, `θ=${theta.toFixed(3)} : centre.x invariant`);
  assertNear(p.y, ref.y, EPS, `θ=${theta.toFixed(3)} : centre.y invariant`);
  assertNear(p.z, ref.z, EPS, `θ=${theta.toFixed(3)} : centre.z invariant`);
  // Le centre reste invariant à toute altitude (la rotation est autour de Z).
  const pz = applyPoint(l, { ...C, z: 42 });
  const refz = applyPoint(l0, { ...C, z: 42 });
  assertNear(pz.x, refz.x, EPS, `θ=${theta.toFixed(3)} : centre.x invariant à z=42 m`);
  assertNear(pz.y, refz.y, EPS, `θ=${theta.toFixed(3)} : centre.y invariant à z=42 m`);
}

/* ── Test 2 : flip Y appliqué exactement une fois (piège 1) ──────────────── */

console.log('Test 2 — flip Y unique : base (est, nord, haut) → (+s, -s, +s) mercator');
{
  const l = composeLayerMatrix(THREE, { ...base, rotateZ: 0 });
  const o = applyPoint(l, C);
  const est = applyPoint(l, { x: C.x + 1, y: C.y, z: 0 });
  const nord = applyPoint(l, { x: C.x, y: C.y + 1, z: 0 });
  const haut = applyPoint(l, { x: C.x, y: C.y, z: 1 });
  assertNear(est.x - o.x, +s, EPS, '+1 m est   → mercator x augmente de +s');
  assertNear(est.y - o.y, 0, EPS, '+1 m est   → mercator y inchangé');
  assertNear(nord.y - o.y, -s, EPS, '+1 m nord  → mercator y DIMINUE de s (flip appliqué UNE fois)');
  assertNear(nord.x - o.x, 0, EPS, '+1 m nord  → mercator x inchangé');
  assertNear(haut.z - o.z, +s, EPS, '+1 m haut  → mercator z augmente de +s (pas de flip sur Z)');
  // Un double flip donnerait det = +s³ ; zéro flip aussi. Un seul flip → -s³.
  const d = det3(l);
  assertTrue(d < 0, 'det(partie linéaire) < 0 (nombre IMPAIR de flips)');
  assertNear(d, -s * s * s, Math.abs(s * s * s) * 1e-9, 'det = -s³ exactement (un seul flip, échelle uniforme)');
  // Et le déterminant ne dépend pas de la rotation (une rotation ne flippe rien).
  const dRot = det3(composeLayerMatrix(THREE, { ...base, rotateZ: 1.234 }));
  assertNear(dRot, -s * s * s, Math.abs(s * s * s) * 1e-9, 'det = -s³ aussi avec rotation (le flip reste unique)');
}

/* ── Test 3 : sens de rotation (anti-horaire vu du ciel) ─────────────────── */

console.log('Test 3 — rotation +90° : l\'est scène part sur le nord scène');
{
  const l90 = composeLayerMatrix(THREE, { ...base, rotateZ: Math.PI / 2 });
  const o = applyPoint(l90, C);
  const est = applyPoint(l90, { x: C.x + 1, y: C.y, z: 0 });
  // Scène : R(+90°)·(1,0) = (0,1) = nord → mercator (0, -s) après le flip.
  assertNear(est.x - o.x, 0, EPS, 'est tourné de 90° : Δx mercator = 0');
  assertNear(est.y - o.y, -s, EPS, 'est tourné de 90° : Δy mercator = -s (pointe le nord)');
}

/* ── Test 4 : contre-exemple — sans sandwich, le centre ORBITE ───────────── */

console.log('Test 4 — contre-exemple : T·S·R nu (sans sandwich) fait orbiter le centre');
{
  const theta = Math.PI / 2;
  const lBad = new Matrix4()
    .makeTranslation(base.translateX, base.translateY, base.translateZ)
    .scale(new Vector3(s, -s, s))
    .multiply(new Matrix4().makeRotationFromEuler(new Euler(0, 0, theta, 'XYZ')));
  const pBad = applyPoint(lBad, C);
  const drift = Math.hypot(pBad.x - ref.x, pBad.y - ref.y) / s; // en mètres scène
  // ‖C‖ ≈ 39,3 m : sans sandwich le centre dérive de l'ordre de ‖C‖·√2.
  assertTrue(drift > 10, `sans sandwich, le centre dérive de ${drift.toFixed(1)} m (> 10 m) — le sandwich est nécessaire`);
}

/* ── Bilan ───────────────────────────────────────────────────────────────── */

if (failures > 0) {
  console.error(`\n${failures} échec(s) — la composition de matrices du bridge est FAUSSE.`);
  process.exit(1);
}
console.log('\nTous les invariants passent : sandwich OK, flip Y unique OK, sens de rotation OK.');
