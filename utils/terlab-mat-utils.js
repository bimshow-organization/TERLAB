/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  TERLAB · terlab-mat-utils.js · v1.0.0                                     ║
 * ║  Utilitaires mathématiques et dessin SVG / Three.js                        ║
 * ║  Usage : import * as MU from './utils/terlab-mat-utils.js'                 ║
 * ║                                                                            ║
 * ║  Stack : Vanilla ES2022+ · Three.js r182 via window.THREE                  ║
 * ║  Auteur : MGA Architecture / TERLAB-ÉARL                                   ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 *
 * SECTIONS
 *   A · Constants & Configuration
 *   B · Vec2 / Vec3 — algèbre vectorielle légère
 *   C · Math / Géom — interpolation, courbes, bruit
 *   D · Wind — physique aéraulique (Izard / CSTB / RTAA DOM)
 *   E · SVG — builders d'éléments SVG pour schémas animés
 *   F · THREE — factories géométriques Three.js r182
 *   G · Color — palettes pression/vitesse, thèmes TERLAB
 *   H · Animate — helpers d'animation SVG / requestAnimationFrame
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// A · CONSTANTS & CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/** Namespace SVG — toujours passer en createElementNS */
export const SVG_NS = 'http://www.w3.org/2000/svg';

/** Alizés dominants à La Réunion (°N géographique, provenance) */
export const REUNION_ALIZES = {
  dominant:    105,   // ESE — alizé dominant côte Est
  secondaire:   80,   // E   — alizé côte Nord
  thermique:   270,   // O   — brise thermique après-midi côte Ouest
  nocturn:      90,   // E   — brise nocturne de montagne
};

/** Rugosités z₀ standard (m) selon type de terrain — loi log */
export const ROUGHNESS = {
  mer:        0.0001, // eau libre
  ouvert:     0.01,   // prairie, champs
  suburbain:  0.3,    // lotissement, forêt basse
  urbain:     1.0,    // centre-ville, bâtiments moyens
  dense:      3.0,    // centre historique, R+5+
};

/** Hauteurs de gradient Zg (m) selon rugosité — profil puissance */
export const ZG = {
  mer:        200,
  ouvert:     250,
  suburbain:  400,
  urbain:     500,
  dense:      600,
};

/** Exposants α du profil de vent en loi puissance U(z) = U10 · (z/10)^α */
export const ALPHA = {
  mer:        0.10,
  ouvert:     0.14,
  suburbain:  0.22,
  urbain:     0.28,
  dense:      0.33,
};

/** Vitesse de référence cyclonique RTAA DOM (m/s) */
export const V_REF_CYCLONE = 36.0;

/** Thèmes CSS TERLAB — couleurs primaires */
export const TERLAB_THEMES = {
  dark:   { bg: '#111418', ink: '#e8e0d4', accent: '#c9a84c' },
  ivory:  { bg: '#f2f0ea', ink: '#18130a', accent: '#9a7820' },
  risk:   { bg: '#1a0d0d', ink: '#f0dbd8', accent: '#c84040' },
  earth:  { bg: '#0e1208', ink: '#d4e0c8', accent: '#6a9a3a' },
  site:   { bg: '#0d1520', ink: '#d0dcea', accent: '#4a9fd4' },
  green:  { bg: '#081410', ink: '#c8e4d4', accent: '#3ab06a' },
  world:  { bg: '#060d18', ink: '#c0cce0', accent: '#2866a8' },
};

/** Couleurs aérauliques par convention Izard/CSTB */
export const AERO_COLORS = {
  wind:         'rgba(28,95,168,0.8)',
  windLight:    'rgba(74,159,212,0.6)',
  windFaint:    'rgba(74,159,212,0.3)',
  pressPos:     'rgba(200,50,35,0.22)',  // surpression (+)
  pressNeg:     'rgba(30,80,180,0.18)',  // dépression (−)
  pressBorderP: 'rgba(180,40,30,0.5)',
  pressBorderN: 'rgba(20,60,160,0.4)',
  wake:         'rgba(160,50,30,0.12)',
  wakeBorder:   'rgba(130,40,25,0.35)',
  turb:         'rgba(160,50,30,0.55)',
  zoneAcc:      'rgba(28,95,168,0.14)',
  building:     'rgba(25,30,45,0.45)',
  buildingStk:  'rgba(15,20,35,0.7)',
  hill:         'rgba(120,105,65,0.45)',
  tree:         'rgba(35,100,40,0.55)',
  hedge:        'rgba(25,80,30,0.60)',
  ground:       'rgba(160,138,85,0.40)',
  groundLine:   'rgba(100,80,40,0.65)',
};


// ═══════════════════════════════════════════════════════════════════════════════
// B · VEC2 / VEC3 — algèbre vectorielle légère (no deps)
// ═══════════════════════════════════════════════════════════════════════════════

/** Vec2 — tableau [x, y] immuable-friendly */
export const Vec2 = {
  /** Crée [x, y] */
  of:     (x, y)        => [x, y],
  add:    ([ax,ay], [bx,by])  => [ax+bx, ay+by],
  sub:    ([ax,ay], [bx,by])  => [ax-bx, ay-by],
  scale:  ([x,y], s)          => [x*s, y*s],
  dot:    ([ax,ay], [bx,by])  => ax*bx + ay*by,
  len:    ([x,y])             => Math.hypot(x, y),
  norm:   (v)                 => { const l = Vec2.len(v); return l ? Vec2.scale(v, 1/l) : [0,0]; },
  rot:    ([x,y], a)          => [x*Math.cos(a)-y*Math.sin(a), x*Math.sin(a)+y*Math.cos(a)],
  lerp:   ([ax,ay],[bx,by],t) => [ax+(bx-ax)*t, ay+(by-ay)*t],
  perp:   ([x,y])             => [-y, x],  // rotation 90° CCW
  angle:  ([x,y])             => Math.atan2(y, x),
  dist:   (a, b)              => Vec2.len(Vec2.sub(b, a)),
  /** Milieu de deux points */
  mid:    (a, b)              => Vec2.lerp(a, b, 0.5),
  /** Projette p sur le segment [a,b] */
  projSeg([px,py],[ax,ay],[bx,by]) {
    const dx = bx-ax, dy = by-ay, l2 = dx*dx+dy*dy;
    if (!l2) return [ax,ay];
    const t = Math.max(0,Math.min(1, ((px-ax)*dx+(py-ay)*dy)/l2));
    return [ax+t*dx, ay+t*dy];
  },
};

/** Vec3 — tableau [x, y, z] */
export const Vec3 = {
  of:     (x,y,z)            => [x,y,z],
  add:    ([ax,ay,az],[bx,by,bz]) => [ax+bx,ay+by,az+bz],
  sub:    ([ax,ay,az],[bx,by,bz]) => [ax-bx,ay-by,az-bz],
  scale:  ([x,y,z],s)            => [x*s,y*s,z*s],
  dot:    ([ax,ay,az],[bx,by,bz]) => ax*bx+ay*by+az*bz,
  cross:  ([ax,ay,az],[bx,by,bz]) => [ay*bz-az*by, az*bx-ax*bz, ax*by-ay*bx],
  len:    ([x,y,z])               => Math.hypot(x,y,z),
  norm:   (v)  => { const l=Vec3.len(v); return l?Vec3.scale(v,1/l):[0,0,0]; },
  lerp:   ([ax,ay,az],[bx,by,bz],t) => [ax+(bx-ax)*t, ay+(by-ay)*t, az+(bz-az)*t],
  /** Vecteur vers angle azimut + élévation (rad) */
  fromAngles: (az, el) => [
    Math.cos(el)*Math.sin(az),
    Math.sin(el),
    Math.cos(el)*Math.cos(az),
  ],
  toTHREE: ([x,y,z]) => new (window.THREE?.Vector3 ?? Object)(x, y, z),
};


// ═══════════════════════════════════════════════════════════════════════════════
// C · MATH / GÉOM — interpolation, courbes de Bézier, bruit, géométrie
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Clamp value dans [min, max]
 */
export function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

/**
 * Interpolation linéaire a→b par t∈[0,1]
 */
export function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * Interpolation lissée (smoothstep) t∈[0,1]
 */
export function smoothstep(a, b, t) {
  t = clamp((t - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Interpolation de Catmull-Rom entre des points, t∈[0,1] sur le segment [p1,p2]
 * @param {number[]} p0 p1 p2 p3 — points [x,y]
 * @param {number}   t
 */
export function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t*t, t3 = t2*t;
  return Vec2.scale(
    Vec2.add(
      Vec2.add(
        Vec2.scale(p0, -t3+2*t2-t),
        Vec2.scale(p1,  3*t3-5*t2+2)
      ),
      Vec2.add(
        Vec2.scale(p2, -3*t3+4*t2+t),
        Vec2.scale(p3,  t3-t2)
      )
    ), 0.5
  );
}

/**
 * Évalue un point sur une courbe de Bézier cubique à paramètre t∈[0,1]
 */
export function bezier3(p0, p1, p2, p3, t) {
  const u=1-t, u2=u*u, u3=u2*u, t2=t*t, t3=t2*t;
  return [
    u3*p0[0] + 3*u2*t*p1[0] + 3*u*t2*p2[0] + t3*p3[0],
    u3*p0[1] + 3*u2*t*p1[1] + 3*u*t2*p2[1] + t3*p3[1],
  ];
}

/**
 * Construit une chaîne SVG path 'd' depuis un tableau de points [x,y]
 * avec tension de courbe Catmull-Rom (smooth=true) ou polyline (smooth=false)
 * @param {number[][]} pts    — tableau de points [[x,y], ...]
 * @param {boolean}    smooth — courbe lissée (défaut true)
 * @param {boolean}    closed — fermer le chemin
 */
export function pathFromPoints(pts, smooth = true, closed = false) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  if (!smooth) {
    const d = pts.map(([x,y], i) => `${i?'L':'M'}${x},${y}`).join(' ');
    return closed ? d + ' Z' : d;
  }
  // Catmull-Rom → approximation Bézier cubique (Schur 1994)
  const n = pts.length;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < (closed ? n : n-1); i++) {
    const p0 = pts[(i-1+n)%n];
    const p1 = pts[i];
    const p2 = pts[(i+1)%n];
    const p3 = pts[(i+2)%n];
    const cp1x = p1[0] + (p2[0]-p0[0])/6;
    const cp1y = p1[1] + (p2[1]-p0[1])/6;
    const cp2x = p2[0] - (p3[0]-p1[0])/6;
    const cp2y = p2[1] - (p3[1]-p1[1])/6;
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`;
  }
  return closed ? d + ' Z' : d;
}

/**
 * Génère N points équidistants sur un arc de cercle
 * @param {number} cx cy — centre
 * @param {number} r       — rayon
 * @param {number} a0 a1   — angles start/end (rad)
 * @param {number} n       — nombre de points
 */
export function arcPoints(cx, cy, r, a0, a1, n = 32) {
  return Array.from({ length: n }, (_, i) => {
    const a = lerp(a0, a1, i / (n - 1));
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

/**
 * Spirale logarithmique (vortex) — n points
 * @param {number} cx cy   — centre
 * @param {number} r0 r1   — rayon min/max
 * @param {number} turns   — nombre de tours
 * @param {number} n       — points
 * @param {boolean} ccw    — sens trigo
 */
export function vortexPoints(cx, cy, r0, r1, turns = 1.5, n = 48, ccw = false) {
  const sign = ccw ? 1 : -1;
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const r = lerp(r0, r1, t);
    const a = sign * t * turns * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

/**
 * Bruit de gradient 2D simplifié (valeur Perlin-like) dans [-1,1]
 * Seed entier pour reproductibilité
 */
export function noise2D(x, y, seed = 0) {
  const h = (n) => {
    let s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix,        fy = y - iy;
  const u = fx*fx*(3-2*fx), v = fy*fy*(3-2*fy);
  const a = h(ix   + iy   *57);
  const b = h(ix+1 + iy   *57);
  const c = h(ix   +(iy+1)*57);
  const dd= h(ix+1 +(iy+1)*57);
  return -1 + 2*lerp(lerp(a,b,u), lerp(c,dd,u), v);
}

/**
 * Profil de streamline perturbée par bruit (effet turbulence)
 * @param {number[]} from  [x,y] départ
 * @param {number[]} to    [x,y] arrivée
 * @param {number}   amp   amplitude de perturbation (px)
 * @param {number}   seed  graine de bruit
 * @param {number}   n     points
 */
export function turbulentStreamline(from, to, amp = 4, seed = 0, n = 20) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const base = Vec2.lerp(from, to, t);
    const perp = Vec2.perp(Vec2.norm(Vec2.sub(to, from)));
    const noise = noise2D(t * 8, seed * 3.7, seed) * amp * Math.sin(Math.PI * t);
    return Vec2.add(base, Vec2.scale(perp, noise));
  });
}

/**
 * Découpe un segment en n points, avec décalage transversal sinusoïdal (filet ondulé)
 */
export function wavyStreamline(from, to, amplitude = 3, frequency = 2, n = 24) {
  const dir = Vec2.norm(Vec2.sub(to, from));
  const perp = Vec2.perp(dir);
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const base = Vec2.lerp(from, to, t);
    const wave = amplitude * Math.sin(t * Math.PI * frequency * 2);
    return Vec2.add(base, Vec2.scale(perp, wave));
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// D · WIND — physique aéraulique d'après Izard / CSTB / RTAA DOM 2016
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Profil logarithmique de vitesse du vent (Prandtl)
 * U(z) = (U* / κ) · ln(z / z₀)
 * simplifié via calibration sur U₁₀
 * @param {number} z    hauteur (m)
 * @param {number} z0   rugosité (m) — cf. ROUGHNESS
 * @param {number} U10  vitesse de référence à 10m (m/s)
 * @returns {number} vitesse (m/s), ≥ 0
 */
export function windProfileLog(z, z0 = ROUGHNESS.suburbain, U10 = 1) {
  if (z <= z0) return 0;
  return U10 * Math.log(z / z0) / Math.log(10 / z0);
}

/**
 * Profil en loi puissance (CSTB, plus répandu en pratique)
 * U(z) = U10 · (z / 10)^α       pour z ≤ Zg
 * U(z) = U10 · (Zg / 10)^α      pour z > Zg  (vent gradient constant)
 * @param {number} z        hauteur (m)
 * @param {string} terrain  clé de ROUGHNESS / ALPHA / ZG
 * @param {number} U10      vitesse à 10m (m/s)
 */
export function windProfilePower(z, terrain = 'suburbain', U10 = 1) {
  const alpha = ALPHA[terrain] ?? ALPHA.suburbain;
  const zg    = ZG[terrain]    ?? ZG.suburbain;
  const zRef  = Math.min(z, zg);
  return U10 * Math.pow(Math.max(zRef, 0.01) / 10, alpha);
}

/**
 * Génère N paires (hauteur, vitesse_relative) pour dessiner un profil
 * @param {number} zMax     hauteur max du diagramme (m)
 * @param {string} terrain
 * @param {number} n
 * @returns {{ z: number, u: number }[]}  u ∈ [0,1]
 */
export function windProfilePoints(zMax = 50, terrain = 'suburbain', n = 20) {
  const pts = Array.from({ length: n }, (_, i) => {
    const z = lerp(0, zMax, i / (n - 1));
    return { z, u: windProfilePower(z, terrain, 1) };
  });
  // normaliser sur la valeur max
  const uMax = Math.max(...pts.map(p => p.u), 1e-9);
  return pts.map(p => ({ z: p.z, u: p.u / uMax }));
}

/**
 * Coefficient de site C_TP selon Izard / CSTB
 * @param {'colline_favorable'|'entre_collines'|'toit_ecope'|'plaine'|
 *          'sous_le_vent'|'pied_colline'|'vallee'|'falaise'} siteType
 * @returns {{ ctp: number, label: string, description: string }}
 */
export function cTP(siteType) {
  const TABLE = {
    entre_collines:   { ctp: 1.1,  label: 'Entre collines', description: 'Zone accélérée entre deux reliefs orientés face au vent' },
    toit_ecope:       { ctp: 1.3,  label: 'Toit écope',     description: 'Toiture pente opposée à la colline (+30%)' },
    plaine:           { ctp: 1.0,  label: 'Plaine dégagée', description: 'Site plat sans obstacle notable' },
    colline_sommet:   { ctp: 1.05, label: 'Sommet colline', description: 'Sommet arrondi, légère accélération' },
    sous_le_vent:     { ctp: 0.5,  label: 'Sous le vent',   description: 'Pente sous-le-vent avec zone tourbillonnaire (sévère)' },
    pied_colline:     { ctp: 0.6,  label: 'Pied de colline',description: 'Tourbillon plongeant au pied, zone déventée' },
    vallee:           { ctp: 0.3,  label: 'Vallée',          description: 'Franchissement global, très défavorable' },
    falaise:          { ctp: 0.7,  label: 'Falaise/faille',  description: 'Décollement de crête + retombée tourbillonnaire' },
    habitation_dense: { ctp: 0.3,  label: 'Tissu dense + végétation', description: 'C_EP = 0.3 C₀ pour tissu + végétation mixte' },
  };
  return TABLE[siteType] ?? { ctp: 1.0, label: '—', description: 'Site indéfini' };
}

/**
 * Facteur d'obstruction Rb (CSTB) — mesure la rugosité d'une rue
 * Rb = (W × H) / (W + L)²
 * @param {number} W  largeur de rue (m)
 * @param {number} H  hauteur des bâtiments (m)
 * @param {number} L  largeur des bâtiments (profondeur de front bâti) (m)
 * @returns {number} Rb ∈ [0, ~0.7]
 */
export function blockageRatio(W, H, L) {
  return (W * H) / Math.pow(W + L, 2);
}

/**
 * Vitesse relative en rue selon Rb (lecture abaque CSTB)
 * Régression exponentielle sur les données CSTB (erreur < 5%)
 * @param {number} Rb  facteur d'obstruction
 * @returns {number}   V_rue / V_libre ∈ [0,1]
 */
export function streetVelocity(Rb) {
  // fit sur la courbe CSTB : V_% = 85 · e^(-2.3·Rb)  capped [0,1]
  return clamp(0.85 * Math.exp(-2.3 * Rb), 0, 1);
}

/**
 * Indicateur de ventilation C (CSTB — indicateur d'usage)
 * C = V_intérieur / V₁.₅_référence
 * @param {number} Vint  vitesse mesurée à l'intérieur du logement (m/s)
 * @param {number} V15   vitesse de référence à 1,5m sur site dégagé (m/s)
 * @returns {{ C: number, label: string, ok: boolean }}
 */
export function ventilationC(Vint, V15) {
  const C = V15 > 0 ? Vint / V15 : 0;
  let label, ok;
  if (C >= 1.0)      { label = 'Excellent'; ok = true;  }
  else if (C >= 0.8) { label = 'Bon';       ok = true;  }
  else if (C >= 0.5) { label = 'Passable';  ok = false; }
  else               { label = 'Insuffisant'; ok = false; }
  return { C: +C.toFixed(3), label, ok };
}

/**
 * Longueur approximative du sillage selon la forme de toit (Izard / CSTB)
 * @param {number} A  largeur du bâtiment (m)
 * @param {'flat'|'pitched_low'|'pitched_med'|'pitched_high'} roofType
 * @returns {number} longueur sillage (m)
 */
export function wakeLength(A, roofType = 'flat') {
  const MULT = { flat: 3.25, pitched_low: 3.75, pitched_med: 4.25, pitched_high: 5.0 };
  return A * (MULT[roofType] ?? 3.25);
}

/**
 * Coefficient de pression Cp simplifié sur les faces d'un bâtiment rectangulaire
 * (valeurs tabulées moyennes d'après CSTB / Allard 2002)
 * @param {'windward'|'leeward'|'side'|'roof_windward'|'roof_leeward'} face
 * @param {number} incidence  angle d'incidence du vent en degrés [0,90]
 * @returns {number} Cp moyen
 */
export function pressureCp(face, incidence = 0) {
  const a = clamp(incidence, 0, 90) / 90; // 0=normal, 1=parallèle
  switch (face) {
    case 'windward':      return lerp(0.7, -0.1, a);     // + → - quand oblique
    case 'leeward':       return lerp(-0.3, -0.5, a);
    case 'side':          return lerp(-0.7, -0.6, a);
    case 'roof_windward': return lerp(-1.0, -0.5, a);
    case 'roof_leeward':  return lerp(-0.5, -0.4, a);
    case 'ridge':         return -1.5;
    case 'corner':        return -2.0;
    default:              return 0;
  }
}

/**
 * Résistance cyclonique RTAA DOM — coefficient de site
 * @param {string} terrain  clé ROUGHNESS
 * @returns {number} V_site = V_REF_CYCLONE × coeff
 */
export function rtaaCycloneV(terrain = 'suburbain') {
  const COEFF = { mer: 1.25, ouvert: 1.20, suburbain: 1.00, urbain: 0.88, dense: 0.82 };
  return V_REF_CYCLONE * (COEFF[terrain] ?? 1.0);
}

/**
 * Surface minimale d'ouvrant RTAA DOM (Art. 7)
 * @param {number} Shab  surface habitable de la pièce (m²)
 * @returns {number}     surface ouvrant minimale (m²)
 */
export function rtaaMinOpening(Shab) { return Shab / 6; }


// ═══════════════════════════════════════════════════════════════════════════════
// D2 · SOLAR — géométrie solaire d'après Izard / Parties 1.3-1.4 + altitude
//   Fonctions autonomes (pas de dépendance SunCalcService).
//   Latitude par défaut : La Réunion −21.1° (hémisphère sud).
// ═══════════════════════════════════════════════════════════════════════════════

const DEG = Math.PI / 180;
const DEFAULT_LAT = -21.1;

/**
 * Déclinaison solaire (angle entre plan équatorial et direction Terre-Soleil).
 * @param {number} dayOfYear  1–365
 * @returns {number} degrés (+ = nord, − = sud)
 */
export function solarDeclination(dayOfYear) {
  return 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * DEG);
}

/**
 * Altitude solaire (hauteur au-dessus de l'horizon).
 * @param {number} hour       heure décimale locale (12 = midi solaire)
 * @param {number} dayOfYear  1–365
 * @param {number} lat        latitude en degrés (négatif = sud)
 * @returns {number} degrés [0, 90] — clampé à 0 si sous l'horizon
 */
export function solarHeight(hour, dayOfYear, lat = DEFAULT_LAT) {
  const latR  = lat * DEG;
  const declR = solarDeclination(dayOfYear) * DEG;
  const ha    = (hour - 12) * 15 * DEG;
  const sinAlt = Math.sin(latR) * Math.sin(declR)
               + Math.cos(latR) * Math.cos(declR) * Math.cos(ha);
  return Math.max(0, Math.asin(sinAlt) / DEG);
}

/**
 * Azimut solaire (angle depuis le Nord, sens horaire).
 * @param {number} hour       heure décimale locale
 * @param {number} dayOfYear  1–365
 * @param {number} lat        latitude en degrés
 * @returns {number} degrés [0, 360)
 */
export function solarAzimuth(hour, dayOfYear, lat = DEFAULT_LAT) {
  const latR  = lat * DEG;
  const declR = solarDeclination(dayOfYear) * DEG;
  const ha    = (hour - 12) * 15 * DEG;
  const sinAlt = Math.sin(latR) * Math.sin(declR)
               + Math.cos(latR) * Math.cos(declR) * Math.cos(ha);
  const alt    = Math.asin(sinAlt);
  const cosAlt = Math.cos(alt);
  if (cosAlt < 1e-9) return 180; // zénith
  const cosAzi = (Math.sin(declR) - Math.sin(latR) * sinAlt) / (Math.cos(latR) * cosAlt);
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAzi))) / DEG;
  if (hour > 12) azimuth = 360 - azimuth;
  return azimuth;
}

/**
 * Position solaire complète (altitude + azimut + aboveHorizon).
 * Compatible avec l'interface SunCalcService.getPosition().
 */
export function solarPosition(hour, dayOfYear, lat = DEFAULT_LAT) {
  const altitude = solarHeight(hour, dayOfYear, lat);
  const azimuth  = solarAzimuth(hour, dayOfYear, lat);
  return { altitude, azimuth, aboveHorizon: altitude > 0 };
}

/**
 * Angle d'occultation minimum pour protéger une façade (Izard Fig.17-21).
 * Scanne le solstice d'été austral (jour 355) et retourne l'angle minimal
 * du brise-soleil horizontal nécessaire.
 * @param {number} facadeAzDeg  azimut façade en degrés (0=N, 90=E, 180=S)
 * @param {number} lat          latitude
 * @returns {{ angle, altitude, hour, facadeAz }}
 */
export function overhangAngle(facadeAzDeg, lat = DEFAULT_LAT) {
  const hotDay = 355; // solstice été austral = 21 déc
  let maxAlt = 0, criticalHour = 12;

  for (let h = 5; h <= 19; h += 0.25) {
    const alt = solarHeight(h, hotDay, lat);
    if (alt < 1) continue;
    const az  = solarAzimuth(h, hotDay, lat);
    let diff = Math.abs(az - facadeAzDeg);
    if (diff > 180) diff = 360 - diff;
    if (diff > 60) continue;
    if (alt > maxAlt) { maxAlt = alt; criticalHour = h; }
  }

  return {
    angle:    maxAlt > 0 ? Math.round(90 - maxAlt) : 0,
    altitude: Math.round(maxAlt),
    hour:     criticalHour,
    facadeAz: facadeAzDeg,
  };
}

/**
 * Masque topographique : pour un profil altimétrique [{dist, alt}],
 * calcule l'angle d'élévation du relief vu depuis un point donné.
 * Retourne les heures perdues matin/soir au solstice d'hiver.
 * @param {Array<{dist:number, alt:number}>} profile  profil altimétrique
 * @param {number} observerIdx  index du point d'observation dans le profil
 * @param {number} dayOfYear    jour de calcul (défaut 172 = solstice hiver austral)
 * @param {number} lat          latitude
 * @returns {{ maskAngleEast, maskAngleWest, hoursLostMorning, hoursLostEvening }}
 */
export function topoMask(profile, observerIdx, dayOfYear = 172, lat = DEFAULT_LAT) {
  if (!profile?.length || observerIdx < 0 || observerIdx >= profile.length) {
    return { maskAngleEast: 0, maskAngleWest: 0, hoursLostMorning: 0, hoursLostEvening: 0 };
  }

  const obs = profile[observerIdx];

  // Angle de masque max à l'est (indices croissants = vers l'est par convention)
  let maskAngleEast = 0;
  for (let i = observerIdx + 1; i < profile.length; i++) {
    const dx = profile[i].dist - obs.dist;
    const dz = profile[i].alt - obs.alt;
    if (dx > 0) {
      const angle = Math.atan2(dz, dx) / DEG;
      if (angle > maskAngleEast) maskAngleEast = angle;
    }
  }

  // Angle de masque max à l'ouest (indices décroissants)
  let maskAngleWest = 0;
  for (let i = observerIdx - 1; i >= 0; i--) {
    const dx = obs.dist - profile[i].dist;
    const dz = profile[i].alt - obs.alt;
    if (dx > 0) {
      const angle = Math.atan2(dz, dx) / DEG;
      if (angle > maskAngleWest) maskAngleWest = angle;
    }
  }

  // Calcul des heures perdues (solstice hiver = jour le plus court)
  let hoursLostMorning = 0, hoursLostEvening = 0;
  for (let h = 5; h <= 12; h += 0.25) {
    const alt = solarHeight(h, dayOfYear, lat);
    if (alt > 0 && alt < maskAngleEast) hoursLostMorning += 0.25;
  }
  for (let h = 12; h <= 19; h += 0.25) {
    const alt = solarHeight(h, dayOfYear, lat);
    if (alt > 0 && alt < maskAngleWest) hoursLostEvening += 0.25;
  }

  return { maskAngleEast: Math.round(maskAngleEast), maskAngleWest: Math.round(maskAngleWest), hoursLostMorning, hoursLostEvening };
}


// ═══════════════════════════════════════════════════════════════════════════════
// E · SVG — builders d'éléments SVG pour schémas aérauliques animés
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Crée un élément SVG avec un namespace correct
 * @param {string} tag   — nom de tag SVG ('rect','path','circle',…)
 * @param {Object} attrs — attributs à setter
 * @returns {SVGElement}
 */
export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  }
  return el;
}

/**
 * Crée un élément <svg> racine avec viewBox et dimensions
 */
export function svgRoot(width, height, opts = {}) {
  return svgEl('svg', {
    viewBox: opts.viewBox ?? `0 0 ${width} ${height}`,
    width, height,
    xmlns: SVG_NS,
    ...opts.attrs,
  });
}

/**
 * Crée un <defs> contenant un marqueur de flèche
 * @param {string} id     — id unique du marqueur
 * @param {string} color  — couleur de remplissage
 * @param {number} size   — taille (unités SVG, défaut 5)
 * @returns {SVGDefsElement}
 */
export function arrowMarkerDef(id, color = AERO_COLORS.wind, size = 5) {
  const defs   = svgEl('defs');
  const marker = svgEl('marker', {
    id, viewBox: '0 0 10 10', refX: 9, refY: 5,
    markerWidth: size, markerHeight: size, orient: 'auto',
  });
  marker.appendChild(svgEl('path', { d: 'M0,0 L10,5 L0,10 Z', fill: color }));
  defs.appendChild(marker);
  return defs;
}

/**
 * Insère un marqueur de flèche dans un <svg> (crée/réutilise le <defs>)
 * Retourne l'url() pour l'attribut marker-end
 */
export function ensureArrow(svg, id, color = AERO_COLORS.wind, size = 5) {
  if (!svg.querySelector(`#${id}`)) {
    let defs = svg.querySelector('defs');
    if (!defs) { defs = svgEl('defs'); svg.prepend(defs); }
    defs.appendChild(arrowMarkerDef(id, color, size).querySelector('marker'));
  }
  return `url(#${id})`;
}

/**
 * Dessine une flèche de vent (line + marker-end)
 * @param {number[]} from  [x,y]
 * @param {number[]} to    [x,y]
 * @param {Object}   opts
 *   markerId, color, width, dasharray, opacity, markerSize
 */
export function windArrow(from, to, opts = {}) {
  const {
    markerId  = 'arr-default',
    color     = AERO_COLORS.wind,
    width     = 2,
    dasharray = null,
    opacity   = 1,
    markerEnd = `url(#${markerId})`,
  } = opts;
  return svgEl('line', {
    x1: from[0], y1: from[1], x2: to[0], y2: to[1],
    stroke: color, 'stroke-width': width,
    'stroke-dasharray': dasharray ?? undefined,
    opacity,
    'marker-end': markerEnd,
  });
}

/**
 * Dessine une streamline courbe (path animé)
 * @param {number[][]} points   [[x,y], …]
 * @param {Object}     opts
 *   color, width, dasharray, dashLength, gap, duration, delay, smooth
 */
export function streamline(points, opts = {}) {
  const {
    color      = AERO_COLORS.windLight,
    width      = 1.4,
    dasharray  = '5,3',
    duration   = 2,
    delay      = 0,
    smooth     = true,
    markerId   = null,
    closed     = false,
  } = opts;
  const d = pathFromPoints(points, smooth, closed);
  const el = svgEl('path', {
    d, fill: 'none',
    stroke: color, 'stroke-width': width,
    'stroke-dasharray': dasharray,
    'marker-end': markerId ? `url(#${markerId})` : undefined,
  });
  // Animation stroke-dashoffset
  if (duration > 0) {
    const [dash] = dasharray.split(',').map(Number);
    const gap    = +dasharray.split(',')[1] || 3;
    const total  = dash + gap;
    const style  = `animation: terlab-flow-${Math.random().toString(36).slice(2)} `
                 + `${duration}s linear ${delay}s infinite`;
    el.setAttribute('style', style);
    // Injection de la @keyframe dans le SVG via style inline (compatible sans <style>)
    el.style.setProperty('stroke-dashoffset', String(total));
    // Utiliser setAttribute pour une animation CSS compatible
    el.setAttribute('style',
      `stroke-dashoffset:${total};` +
      `animation:tl-flow ${duration}s linear ${delay}s infinite`
    );
  }
  return el;
}

/**
 * Bloc <style> à injecter une fois dans le SVG pour les animations de flux
 * Doit être enfant de <defs> ou <svg>
 */
export function flowAnimStyle() {
  const style = svgEl('style');
  style.textContent = `
    @keyframes tl-flow { from { stroke-dashoffset: 8 } to { stroke-dashoffset: 0 } }
    @keyframes tl-flow-r { from { stroke-dashoffset: 0 } to { stroke-dashoffset: 8 } }
    @keyframes tl-pulse { 0%,100%{opacity:.6} 50%{opacity:1} }
    @keyframes tl-spin-cw  { from{transform:rotate(0deg)}   to{transform:rotate(360deg)}  }
    @keyframes tl-spin-ccw { from{transform:rotate(0deg)}   to{transform:rotate(-360deg)} }
  `;
  return style;
}

/**
 * Bâtiment en vue de plan (rectangle + trame)
 */
export function buildingPlan(x, y, w, h, opts = {}) {
  const { fill = AERO_COLORS.building, stroke = AERO_COLORS.buildingStk,
          strokeWidth = 1.3, rx = 0 } = opts;
  return svgEl('rect', { x, y, width: w, height: h, fill, stroke,
                          'stroke-width': strokeWidth, rx });
}

/**
 * Bâtiment en coupe — mur + toit à pente
 * @param {number} x y   — coin bas-gauche du mur
 * @param {number} w h   — largeur et hauteur du mur
 * @param {number} pitch — pente du toit (0=plat, 1=45°) — fraction de w/2
 */
export function buildingSection(x, y, w, h, pitch = 0.3, opts = {}) {
  const { fill = AERO_COLORS.building, stroke = AERO_COLORS.buildingStk } = opts;
  const g   = svgEl('g');
  // Mur
  g.appendChild(svgEl('rect', { x, y, width: w, height: h,
                                 fill, stroke, 'stroke-width': 1.3 }));
  // Toit
  if (pitch > 0) {
    const ridge = y - pitch * w * 0.5;
    const midX  = x + w / 2;
    g.appendChild(svgEl('polygon', {
      points: `${x},${y} ${midX},${ridge} ${x+w},${y}`,
      fill: fill.replace(/[\d.]+\)$/, '0.5)'), stroke, 'stroke-width': 1.2,
    }));
  }
  return g;
}

/**
 * Zone de pression (ellipse + / –)
 * @param {number} cx cy rx ry — centre et demi-axes
 * @param {'pos'|'neg'}  type
 * @param {Object} opts  — animPulse, opacity, label
 */
export function pressureZone(cx, cy, rx, ry, type = 'neg', opts = {}) {
  const { animPulse = true, delay = 0, label = true } = opts;
  const fill   = type === 'pos' ? AERO_COLORS.pressPos : AERO_COLORS.pressNeg;
  const stroke = type === 'pos' ? AERO_COLORS.pressBorderP : AERO_COLORS.pressBorderN;
  const g = svgEl('g');
  const el = svgEl('ellipse', { cx, cy, rx, ry, fill, stroke, 'stroke-width': 0.8 });
  if (animPulse) el.setAttribute('style',
    `animation: tl-pulse 2.5s ease-in-out ${delay}s infinite`);
  g.appendChild(el);
  if (label) {
    const sign = type === 'pos' ? '+' : '–';
    const color = type === 'pos' ? 'rgba(170,35,25,.9)' : 'rgba(25,65,175,.9)';
    g.appendChild(svgEl('text', {
      x: cx, y: cy + 3, 'text-anchor': 'middle',
      style: `font-family:Inconsolata,monospace;font-size:8px;font-weight:bold;fill:${color}`,
    })).textContent = sign;
  }
  return g;
}

/**
 * Zone de sillage (wake) — forme effilée derrière un bâtiment
 * @param {number} x0 y0  — point d'attache (sous-le-vent du bâtiment)
 * @param {number} len     — longueur du sillage
 * @param {number} width   — largeur max (au départ)
 * @param {'right'|'left'|'up'|'down'} dir — direction du sillage
 */
export function wakeZone(x0, y0, len, width, dir = 'right', opts = {}) {
  const { fill = AERO_COLORS.wake, stroke = AERO_COLORS.wakeBorder } = opts;
  let d;
  const hw = width / 2;
  switch(dir) {
    case 'right': d=`M${x0},${y0-hw} Q${x0+len},${y0} ${x0},${y0+hw} Z`; break;
    case 'left':  d=`M${x0},${y0-hw} Q${x0-len},${y0} ${x0},${y0+hw} Z`; break;
    case 'down':  d=`M${x0-hw},${y0} Q${x0},${y0+len} ${x0+hw},${y0} Z`; break;
    case 'up':    d=`M${x0-hw},${y0} Q${x0},${y0-len} ${x0+hw},${y0} Z`; break;
  }
  return svgEl('path', { d, fill, stroke, 'stroke-width': 0.7,
                          'stroke-dasharray': '3,2' });
}

/**
 * Colline / butte en coupe — profil gaussien
 * @param {number} cx     — centre X
 * @param {number} base   — Y de la base (sol)
 * @param {number} w      — largeur totale
 * @param {number} h      — hauteur au sommet
 * @param {number} n      — points du profil
 */
export function hillProfile(cx, base, w, h, n = 30, opts = {}) {
  const { fill = AERO_COLORS.hill, stroke = 'rgba(85,70,35,.55)' } = opts;
  const pts = Array.from({ length: n }, (_, i) => {
    const x = cx - w/2 + (w / (n-1)) * i;
    const t = (x - cx) / (w / 2);
    const y = base - h * Math.exp(-3 * t * t);
    return [x, y];
  });
  // Fermer par le bas
  pts.push([cx + w/2, base], [cx - w/2, base]);
  const d = pathFromPoints(pts.slice(0, -2), true, false)
          + ` L${cx+w/2},${base} L${cx-w/2},${base} Z`;
  return svgEl('path', { d: pathFromPoints(pts, false, true),
                          fill, stroke, 'stroke-width': 1 });
}

/**
 * Arbre stylisé (cercle couronné + tronc)
 * @param {number} cx cy  — centre de la couronne
 * @param {number} r      — rayon couronne
 * @param {'tree'|'treeSm'|'shrub'|'hedge'} style
 */
export function treeSVG(cx, cy, r, style = 'tree') {
  const FILLS = {
    tree:   AERO_COLORS.tree,
    treeSm: 'rgba(45,110,45,.5)',
    shrub:  'rgba(50,105,40,.45)',
    hedge:  AERO_COLORS.hedge,
  };
  const fill = FILLS[style] ?? AERO_COLORS.tree;
  const g = svgEl('g');
  // Tronc
  if (style === 'tree' || style === 'treeSm') {
    g.appendChild(svgEl('rect', {
      x: cx - r*0.15, y: cy, width: r*0.3, height: r*0.5,
      fill: 'rgba(90,60,25,.6)',
    }));
  }
  // Couronne
  g.appendChild(svgEl('circle', {
    cx, cy, r, fill,
    stroke: fill.replace(/[\d.]+\)$/, '0.8)'), 'stroke-width': 0.8,
  }));
  return g;
}

/**
 * Sol (rectangle + ligne de sol animable)
 */
export function groundSVG(x, y, w, h = 20, opts = {}) {
  const { fill = AERO_COLORS.ground, lineColor = AERO_COLORS.groundLine } = opts;
  const g = svgEl('g');
  g.appendChild(svgEl('rect', { x, y, width: w, height: h, fill }));
  g.appendChild(svgEl('line', { x1: x, y1: y, x2: x+w, y2: y,
                                  stroke: lineColor, 'stroke-width': 1, fill: 'none' }));
  return g;
}

/**
 * Vortex animé (spirale + animation de rotation)
 * @param {number} cx cy  — centre
 * @param {number} r      — rayon
 * @param {'cw'|'ccw'} dir
 * @param {number} duration (s)
 */
export function vortexSVG(cx, cy, r, dir = 'cw', duration = 3, opts = {}) {
  const { color = AERO_COLORS.turb, fill = 'rgba(130,40,25,.1)' } = opts;
  const pts = vortexPoints(cx, cy, r*0.2, r, 1.2, 32, dir === 'ccw');
  const d   = pathFromPoints(pts, true, false);
  const el  = svgEl('path', { d, fill, stroke: color,
                               'stroke-width': 1.2, 'stroke-dasharray': '5,3' });
  const anim = dir === 'cw' ? 'tl-spin-cw' : 'tl-spin-ccw';
  el.setAttribute('style',
    `transform-origin:${cx}px ${cy}px;animation:${anim} ${duration}s linear infinite`);
  return el;
}

/**
 * Rose des vents simplifiée en SVG
 * @param {number} cx cy  — centre
 * @param {number} r      — rayon
 * @param {Object[]} data — [{ dir: number (°N), v: number (0-1), label?: string }]
 * @param {Object}   opts — colors, labelFont, showCardinals
 */
export function windRose(cx, cy, r, data = [], opts = {}) {
  const {
    fillColor  = AERO_COLORS.zoneAcc,
    strokeColor = AERO_COLORS.wind,
    showCardinals = true,
  } = opts;
  const g = svgEl('g');
  // Grille circulaire
  [0.33, 0.66, 1].forEach(f => {
    g.appendChild(svgEl('circle', {
      cx, cy, r: r*f, fill: 'none',
      stroke: 'rgba(28,95,168,.15)', 'stroke-width': 0.6, 'stroke-dasharray': '2,2',
    }));
  });
  // Secteurs
  const n = data.length;
  const dAngle = n > 0 ? (2 * Math.PI / n) : 0;
  data.forEach(({ dir, v }, i) => {
    const a = (dir - 90) * Math.PI / 180; // 0°=N → -90° en SVG
    const r2 = r * clamp(v, 0, 1);
    const a0 = a - dAngle / 2, a1 = a + dAngle / 2;
    const x0 = cx + r2 * Math.cos(a0), y0 = cy + r2 * Math.sin(a0);
    const x1 = cx + r2 * Math.cos(a1), y1 = cy + r2 * Math.sin(a1);
    g.appendChild(svgEl('path', {
      d: `M${cx},${cy} L${x0},${y0} A${r2},${r2} 0 0 1 ${x1},${y1} Z`,
      fill: fillColor, stroke: strokeColor, 'stroke-width': 0.7,
    }));
  });
  // Points cardinaux
  if (showCardinals) {
    [['N',0],['E',90],['S',180],['O',270]].forEach(([lbl, deg]) => {
      const a = (deg - 90) * Math.PI / 180;
      const lx = cx + (r + 8) * Math.cos(a);
      const ly = cy + (r + 8) * Math.sin(a);
      const t = svgEl('text', {
        x: lx, y: ly + 3, 'text-anchor': 'middle',
        style: 'font-family:Inconsolata,monospace;font-size:7px;fill:rgba(20,30,45,.6)',
      });
      t.textContent = lbl;
      g.appendChild(t);
    });
  }
  return g;
}

/**
 * Profil de vitesse (boundary layer) dessiné en SVG
 * @param {number} x0 y0   — coin bas-gauche du profil
 * @param {number} w h     — dimensions du diagramme (w=largeur max, h=hauteur totale)
 * @param {string} terrain — clé ALPHA/ZG
 * @param {Object} opts    — color, n, showArrows, arrowCount
 */
export function boundaryLayerSVG(x0, y0, w, h, terrain = 'suburbain', opts = {}) {
  const { color = AERO_COLORS.wind, n = 40, showArrows = true,
          arrowCount = 6, markerId = 'arr-bl' } = opts;
  const g  = svgEl('g');
  const pts = windProfilePoints(50, terrain, n);
  // Courbe de profil
  const curvePts = pts.map(({ z, u }) => [x0 + u * w, y0 - (z / 50) * h]);
  g.appendChild(svgEl('path', {
    d: pathFromPoints(curvePts, true, false),
    fill: color.replace(/[\d.]+\)$/, '0.08)'),
    stroke: color.replace(/[\d.]+\)$/, '0.6)'), 'stroke-width': 1.3,
  }));
  // Flèches à intervalles réguliers
  if (showArrows) {
    const step = Math.floor(n / arrowCount);
    pts.filter((_, i) => i % step === 0 && i > 0).forEach(({ z, u }) => {
      const py = y0 - (z / 50) * h;
      const px = x0 + u * w;
      const opacity = clamp(0.3 + u * 0.6, 0.3, 1);
      const sw = clamp(0.8 + u * 1.6, 0.8, 2.4);
      g.appendChild(svgEl('line', {
        x1: x0, y1: py, x2: px, y2: py,
        stroke: color, 'stroke-width': sw, opacity,
        'marker-end': `url(#${markerId})`,
      }));
    });
  }
  return g;
}

/**
 * Étiquette de coefficient (petit texte monospace bleu)
 */
export function coeffLabel(x, y, text, opts = {}) {
  const { color = 'rgba(30,85,150,.9)', size = 6.5, anchor = 'start' } = opts;
  const el = svgEl('text', {
    x, y, 'text-anchor': anchor,
    style: `font-family:Inconsolata,monospace;font-size:${size}px;fill:${color};font-weight:bold`,
  });
  el.textContent = text;
  return el;
}

/**
 * Ligne de sol + rectangle gnd dans le même groupe
 */
export function sceneGround(x, y, w, opts = {}) {
  return groundSVG(x, y, w, opts.h ?? 20, opts);
}


// ═══════════════════════════════════════════════════════════════════════════════
// F · THREE — factories géométriques Three.js r182 (window.THREE)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Récupère THREE en sécurité (BIMSHOW partagé)
 * @throws {Error} si window.THREE non disponible
 */
function getT() {
  const T = window.THREE;
  if (!T) throw new Error('[TERLAB] window.THREE non disponible — attendre BIMSHOW');
  return T;
}

/**
 * Box simple représentant un bâtiment
 * @param {number} w d h  — dimensions (m)
 * @param {THREE.Material|null} mat — matériau (défaut MeshStandardMaterial gris)
 * @returns {THREE.Mesh}
 */
export function threeBuilding(w, d, h, mat = null) {
  const T = getT();
  const geo = new T.BoxGeometry(w, h, d);
  const m   = mat ?? new T.MeshStandardMaterial({
    color: 0x2a3040, roughness: 0.7, metalness: 0.1, transparent: true, opacity: 0.85,
  });
  const mesh = new T.Mesh(geo, m);
  mesh.position.y = h / 2;
  mesh.castShadow    = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Groupe de bâtiments depuis un tableau de footprints
 * @param {{ x: number, z: number, w: number, d: number, h: number }[]} footprints
 * @param {THREE.Material|null} mat
 * @returns {THREE.Group}
 */
export function threeBuildingGroup(footprints, mat = null) {
  const T = getT();
  const g = new T.Group();
  footprints.forEach(({ x = 0, z = 0, w = 10, d = 10, h = 8 }) => {
    const mesh = threeBuilding(w, d, h, mat);
    mesh.position.set(x, 0, z);
    g.add(mesh);
  });
  return g;
}

/**
 * Terrain mesh depuis un DEM (tableau 2D de hauteurs)
 * @param {number[][]} dem   — dem[row][col] en mètres
 * @param {Object}     opts  — cellSize, material, maxH
 * @returns {THREE.Mesh}
 */
export function threeTerrainMesh(dem, opts = {}) {
  const T = getT();
  const { cellSize = 10, maxH = null } = opts;
  const rows = dem.length, cols = dem[0].length;
  const geo  = new T.PlaneGeometry(cols * cellSize, rows * cellSize, cols - 1, rows - 1);
  geo.rotateX(-Math.PI / 2);
  const heights = dem.flat();
  const hMax    = maxH ?? Math.max(...heights);
  const pos     = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heights[i] ?? 0);
  }
  pos.needsUpdate   = true;
  geo.computeVertexNormals();
  const mat = opts.material ?? new T.MeshStandardMaterial({
    color: 0x8a7850, wireframe: false, roughness: 0.9,
  });
  const mesh = new T.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Flèche 3D (ArrowHelper wrappé)
 * @param {number[]} from  [x,y,z]
 * @param {number[]} to    [x,y,z]
 * @param {number}   color hex
 * @param {number}   headLength proportion (défaut 0.2)
 */
export function threeWindArrow(from, to, color = 0x1c5fa8, headLength = 0.2) {
  const T   = getT();
  const f   = new T.Vector3(...from);
  const dir = new T.Vector3(...to).sub(f);
  const len = dir.length();
  dir.normalize();
  return new T.ArrowHelper(dir, f, len, color, len * headLength, len * headLength * 0.6);
}

/**
 * Grille de flèches de vent (field aéraulique 2D → 3D à y=0)
 * @param {Function} fieldFn  (x, z) → { ux, uz } — vitesse normalisée
 * @param {Object}   opts     — nx, nz, spacing, color, scale
 * @returns {THREE.Group}
 */
export function threeWindField(fieldFn, opts = {}) {
  const { nx = 10, nz = 10, spacing = 5, color = 0x4a9fd4, scale = 1.5, y = 0.5 } = opts;
  const T = getT();
  const g = new T.Group();
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = (ix - nx/2) * spacing;
      const z = (iz - nz/2) * spacing;
      const { ux = 1, uz = 0 } = fieldFn(x, z);
      const len = Math.hypot(ux, uz);
      if (len < 0.01) continue;
      const arrow = threeWindArrow(
        [x, y, z],
        [x + ux * scale, y, z + uz * scale],
        color
      );
      g.add(arrow);
    }
  }
  return g;
}

/**
 * Particules de vent (Points) — système simple sans dépendance externe
 * @param {number}   count    — nombre de particules
 * @param {number[]} bounds   — [xMin, xMax, yMin, yMax, zMin, zMax]
 * @param {number}   color    — hex
 * @returns {{ mesh: THREE.Points, update: (dt, fieldFn) => void }}
 */
export function threeWindParticles(count = 500, bounds = [-50,50,0,20,-50,50], color = 0x4a9fd4) {
  const T = getT();
  const [x0,x1,y0,y1,z0,z1] = bounds;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i*3]   = lerp(x0, x1, Math.random());
    positions[i*3+1] = lerp(y0, y1, Math.random());
    positions[i*3+2] = lerp(z0, z1, Math.random());
    velocities[i*3]  = lerp(-1,1,Math.random());
    velocities[i*3+2]= lerp(-1,1,Math.random());
  }
  const geo  = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(positions, 3));
  const mat  = new T.PointsMaterial({ color, size: 0.3, sizeAttenuation: true, transparent: true, opacity: 0.7 });
  const mesh = new T.Points(geo, mat);
  function update(dt = 0.016, fieldFn = null) {
    const pos = geo.attributes.position.array;
    for (let i = 0; i < count; i++) {
      const px = pos[i*3], py = pos[i*3+1], pz = pos[i*3+2];
      const { ux = velocities[i*3], uz = velocities[i*3+2] } =
        fieldFn ? fieldFn(px, pz) : {};
      pos[i*3]   += ux * dt * 5;
      pos[i*3+2] += uz * dt * 5;
      // Reset si hors bounds
      if (pos[i*3] > x1) pos[i*3] = x0;
      if (pos[i*3] < x0) pos[i*3] = x1;
      if (pos[i*3+2] > z1) pos[i*3+2] = z0;
      if (pos[i*3+2] < z0) pos[i*3+2] = z1;
    }
    geo.attributes.position.needsUpdate = true;
  }
  return { mesh, update };
}

/**
 * Plane de couleur de pression (heatmap Cp sur une surface)
 * @param {number} w d     — dimensions (m)
 * @param {number[][]} cpGrid — grille Cp[row][col] ∈ [-3,3]
 * @returns {THREE.Mesh}
 */
export function threePressurePlane(w, d, cpGrid, opts = {}) {
  const T    = getT();
  const rows = cpGrid.length, cols = cpGrid[0].length;
  const geo  = new T.PlaneGeometry(w, d, cols-1, rows-1);
  geo.rotateX(-Math.PI/2);
  const colors = new Float32Array(geo.attributes.position.count * 3);
  const flat   = cpGrid.flat();
  for (let i = 0; i < geo.attributes.position.count; i++) {
    const cp = flat[i] ?? 0;
    const [r, g, b] = cpToRGB(cp, opts.range ?? [-2, 1]);
    colors[i*3] = r; colors[i*3+1] = g; colors[i*3+2] = b;
  }
  geo.setAttribute('color', new T.BufferAttribute(colors, 3));
  const mat  = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75 });
  return new T.Mesh(geo, mat);
}


// ═══════════════════════════════════════════════════════════════════════════════
// G · COLOR — palettes pression/vitesse, thèmes TERLAB
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convertit une valeur Cp en RGB [0,1] — palette blue(-) → white(0) → red(+)
 * @param {number} cp    — valeur Cp ∈ [minCp, maxCp]
 * @param {number[]} range — [minCp, maxCp]
 * @returns {[number, number, number]} [r, g, b] ∈ [0,1]
 */
export function cpToRGB(cp, range = [-2, 1]) {
  const t = clamp((cp - range[0]) / (range[1] - range[0]), 0, 1);
  if (t < 0.5) {
    const u = t * 2; // 0→1 pour bleu→blanc
    return [u, u, 1];
  } else {
    const u = (t - 0.5) * 2; // 0→1 pour blanc→rouge
    return [1, 1-u, 1-u];
  }
}

/**
 * Convertit une vitesse normalisée en RGB — palette cyan → jaune → rouge
 * @param {number} u  — vitesse normalisée ∈ [0,1]
 */
export function velocityToRGB(u) {
  u = clamp(u, 0, 1);
  if (u < 0.5) {
    const t = u * 2;
    return [t, t, 1];           // bleu → cyan → blanc
  } else {
    const t = (u - 0.5) * 2;
    return [1, 1 - t * 0.5, 0]; // jaune → orange → rouge
  }
}

/**
 * Couleur CSS rgba depuis tableau [r,g,b] ∈ [0,1]
 */
export function rgbToCss([r, g, b], alpha = 1) {
  return `rgba(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},${alpha})`;
}

/**
 * Couleur hex Three.js depuis Cp
 */
export function cpToHex(cp, range = [-2, 1]) {
  const [r, g, b] = cpToRGB(cp, range);
  return (Math.round(r*255) << 16) | (Math.round(g*255) << 8) | Math.round(b*255);
}

/**
 * Palette de couleurs pour les 3 cas TERLAB
 */
export const CAS_COLORS = {
  isole:   { primary: '#4a6a2a', light: 'rgba(74,106,42,.15)', label: 'Isolé · Plaine des Cafres' },
  village: { primary: '#236030', light: 'rgba(35,96,48,.15)',  label: 'Village · Saint-Joseph'    },
  ville:   { primary: '#144855', light: 'rgba(20,72,85,.15)',  label: 'Ville · Saint-Denis'       },
};

/**
 * Génère un SVG de barre de couleur (colorbar) pour les cartes de pression
 * @param {number} x y w h  — position et dimensions
 * @param {number[]} range   — [min, max] Cp
 * @param {number} n         — nombre de gradations
 */
export function colorbarSVG(x, y, w, h, range = [-2, 1], n = 20, opts = {}) {
  const g = svgEl('g');
  for (let i = 0; i < n; i++) {
    const t    = i / (n - 1);
    const cp   = lerp(range[0], range[1], t);
    const [r, gb, b] = cpToRGB(cp, range);
    g.appendChild(svgEl('rect', {
      x: x + (w / n) * i, y, width: Math.ceil(w / n) + 1, height: h,
      fill: rgbToCss([r, gb, b], 0.85),
    }));
  }
  // Labels
  const lbl = (v, lx) => {
    const t = svgEl('text', {
      x: lx, y: y + h + 8, 'text-anchor': 'middle',
      style: 'font-family:Inconsolata,monospace;font-size:5.5px;fill:rgba(20,30,45,.65)',
    });
    t.textContent = v.toFixed(1);
    g.appendChild(t);
  };
  lbl(range[0], x);
  lbl((range[0]+range[1])/2, x + w/2);
  lbl(range[1], x + w);
  // Titre
  if (opts.title) {
    const t = svgEl('text', {
      x: x + w/2, y: y - 3, 'text-anchor': 'middle',
      style: 'font-family:Inconsolata,monospace;font-size:5px;fill:rgba(20,30,45,.5)',
    });
    t.textContent = opts.title;
    g.appendChild(t);
  }
  return g;
}


// ═══════════════════════════════════════════════════════════════════════════════
// H · ANIMATE — helpers d'animation SVG / requestAnimationFrame
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Démarre une boucle RAF propre, retourne une fonction stop()
 * @param {(t: number, dt: number) => void} onFrame
 * @returns {{ stop: () => void }}
 */
export function rafLoop(onFrame) {
  let id, last = 0;
  function frame(ts) {
    const dt = (ts - last) / 1000;
    last = ts;
    onFrame(ts / 1000, Math.min(dt, 0.1));
    id = requestAnimationFrame(frame);
  }
  id = requestAnimationFrame(ts => { last = ts; id = requestAnimationFrame(frame); });
  return { stop: () => cancelAnimationFrame(id) };
}

/**
 * Anime la valeur stroke-dashoffset d'un élément SVG pour simuler un flux
 * Compatible avec les éléments sans CSS animation (iframes, shadow DOM)
 * @param {SVGElement} el       — élément path/line
 * @param {number}     speed    — px/s (vitesse de défilement)
 * @param {number}     total    — period = dash + gap (px)
 * @returns {{ stop: () => void }}
 */
export function animateFlow(el, speed = 40, total = 8) {
  let offset = total;
  return rafLoop((_, dt) => {
    offset -= speed * dt;
    if (offset < 0) offset += total;
    el.setAttribute('stroke-dashoffset', offset.toFixed(2));
  });
}

/**
 * Anime la rotation d'un groupe SVG autour d'un point (vortex)
 * @param {SVGElement} el   — groupe à faire tourner
 * @param {number} cx cy    — pivot
 * @param {number} speed    — deg/s (positif = CW, négatif = CCW)
 */
export function animateRotate(el, cx, cy, speed = 90) {
  let angle = 0;
  return rafLoop((_, dt) => {
    angle += speed * dt;
    el.setAttribute('transform', `rotate(${angle}, ${cx}, ${cy})`);
  });
}

/**
 * Anime une séquence de streamlines (décalage de phase progressif)
 * @param {SVGElement[]} lines  — tableau de path/line
 * @param {number}       speed  — px/s
 * @param {number}       total  — periode dasharray
 * @param {number}       phaseStep — décalage de phase entre lignes (px)
 */
export function animateFlowGroup(lines, speed = 40, total = 8, phaseStep = 2) {
  const offsets = lines.map((_, i) => total - i * phaseStep);
  return rafLoop((_, dt) => {
    offsets.forEach((off, i) => {
      offsets[i] -= speed * dt;
      if (offsets[i] < 0) offsets[i] += total;
      lines[i].setAttribute('stroke-dashoffset', offsets[i].toFixed(2));
    });
  });
}

/**
 * Pulse d'opacité sur un élément SVG (zones de pression)
 * @param {SVGElement} el
 * @param {number} min max  — opacité min/max
 * @param {number} period   — période (s)
 */
export function animatePulse(el, min = 0.55, max = 1.0, period = 2.5) {
  return rafLoop((t) => {
    const v = min + (max - min) * (0.5 + 0.5 * Math.sin(t * 2 * Math.PI / period));
    el.setAttribute('opacity', v.toFixed(3));
  });
}

/**
 * Tweene une propriété numérique d'un élément
 * @param {SVGElement} el
 * @param {string}     attr   — nom d'attribut SVG
 * @param {number}     from to — valeurs de départ/arrivée
 * @param {number}     duration — (s)
 * @param {Function}   ease   — function t→t' (défaut smoothstep)
 * @returns {Promise<void>} résolu à la fin du tween
 */
export function tween(el, attr, from, to, duration = 0.4, ease = null) {
  return new Promise(resolve => {
    const start = performance.now();
    const easeFn = ease ?? (t => smoothstep(0, 1, t));
    function frame(now) {
      const t = clamp((now - start) / (duration * 1000), 0, 1);
      el.setAttribute(attr, lerp(from, to, easeFn(t)));
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

/**
 * Séquence d'animations: tableau de { fn: () => Promise } exécutées en chaîne
 */
export async function sequence(steps) {
  for (const { fn, delay: d = 0 } of steps) {
    if (d > 0) await new Promise(r => setTimeout(r, d * 1000));
    await fn();
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// I · HELPERS TERLAB — fonctions composites pour les phases HTML
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Construit un schéma SVG de couche limite complet (prêt à insérer dans le DOM)
 * @param {number} w h   — dimensions SVG
 * @param {string[]} terrains — terrains à comparer ['ouvert','suburbain','urbain']
 * @param {Object}  opts
 */
export function buildBoundaryLayerSVG(w = 300, h = 200, terrains = ['ouvert', 'suburbain', 'urbain'], opts = {}) {
  const svg = svgRoot(w, h);
  svg.appendChild(flowAnimStyle());

  const TERRAIN_COLORS = {
    mer:       'rgba(28,95,168,.7)',
    ouvert:    'rgba(28,95,168,.7)',
    suburbain: 'rgba(74,159,212,.6)',
    urbain:    'rgba(120,180,220,.55)',
    dense:     'rgba(180,210,235,.5)',
  };
  const TERRAIN_LABELS = {
    mer: 'Mer', ouvert: 'Ouvert', suburbain: 'Suburbain', urbain: 'Urbain', dense: 'Dense'
  };

  const colW = w / terrains.length;
  terrains.forEach((t, i) => {
    const cx = colW * i + colW / 2;
    const x0 = colW * i + colW * 0.25;
    const color = TERRAIN_COLORS[t] ?? AERO_COLORS.wind;
    // Profil
    svg.appendChild(boundaryLayerSVG(x0, h - 20, colW * 0.5, h - 30, t, {
      color, arrowCount: 5, markerId: `arr-bl-${i}`,
    }));
    // Marqueur
    const defs = svg.querySelector('defs') ?? (svg.prepend(svgEl('defs')), svg.querySelector('defs'));
    const mEl = svgEl('marker', { id: `arr-bl-${i}`, viewBox: '0 0 8 8', refX: 7, refY: 4,
                                    markerWidth: 4, markerHeight: 4, orient: 'auto' });
    mEl.appendChild(svgEl('path', { d: 'M0,0 L8,4 L0,8 Z', fill: color }));
    defs.appendChild(mEl);
    // Label
    svg.appendChild(coeffLabel(cx, h - 5, TERRAIN_LABELS[t] ?? t,
                                { anchor: 'middle', size: 6, color: 'rgba(20,30,45,.6)' }));
    // Zg line
    const zg = ZG[t] ?? 400;
    const zy = h - 20 - ((h - 30) * Math.min(1, zg / 600));
    svg.appendChild(svgEl('line', { x1: colW*i+2, y1: zy, x2: colW*(i+1)-2, y2: zy,
                                     stroke: color, 'stroke-width': 0.5, 'stroke-dasharray': '2,2' }));
    svg.appendChild(coeffLabel(colW*i+4, zy-2, `Zg ${zg}m`,
                                { size: 5, color: color.replace(/[\d.]+\)$/, '0.65)') }));
  });

  // Sol
  svg.appendChild(sceneGround(0, h - 20, w));
  return svg;
}

/**
 * Schéma SVG de pression sur bâtiment (plan) — prêt à insérer
 * @param {number} w h   — dimensions SVG
 * @param {number} incidence — angle d'incidence du vent (°)
 */
export function buildPressurePlanSVG(w = 180, h = 180, incidence = 0) {
  const svg = svgRoot(w, h);
  svg.appendChild(flowAnimStyle());
  const mid = { x: w / 2, y: h / 2 };
  const bw = w * 0.35, bh = h * 0.42;
  const bx = mid.x - bw / 2, by = mid.y - bh / 2;

  // Flèche vent
  const windRad = (incidence - 90) * Math.PI / 180; // SVG coords
  const wFrom = Vec2.add([mid.x, mid.y], Vec2.scale([Math.cos(windRad), Math.sin(windRad)], -w * 0.45));
  const wTo   = Vec2.add([mid.x, mid.y], Vec2.scale([Math.cos(windRad), Math.sin(windRad)], -bw * 0.6));
  const markId = 'arr-pplan';
  svg.appendChild(arrowMarkerDef(markId, AERO_COLORS.wind));
  svg.appendChild(windArrow(wFrom, wTo, { markerId: markId, width: 2.5 }));

  // Zones de pression sur 4 faces
  const faces = [
    { side: 'windward',  angle: incidence,       rx: 18, ry: bh*0.45, dx: -bw*0.5-15, dy: 0 },
    { side: 'leeward',   angle: incidence+180,   rx: 18, ry: bh*0.45, dx:  bw*0.5+15, dy: 0 },
    { side: 'side',      angle: incidence+90,    rx: bw*0.45, ry: 10, dx: 0, dy: -bh*0.5-10 },
    { side: 'side',      angle: incidence-90,    rx: bw*0.45, ry: 10, dx: 0, dy:  bh*0.5+10 },
  ];
  faces.forEach(({ side, rx, ry, dx, dy }, i) => {
    const cp   = pressureCp(side, incidence);
    const type = cp >= 0 ? 'pos' : 'neg';
    svg.appendChild(pressureZone(mid.x + dx, mid.y + dy, rx, ry, type,
                                  { delay: i * 0.4 }));
    svg.appendChild(coeffLabel(mid.x + dx, mid.y + dy + 3,
                                `${cp >= 0 ? '+' : ''}${cp.toFixed(1)}`,
                                { anchor: 'middle', size: 6, color: cp >= 0 ? 'rgba(160,35,25,.9)' : 'rgba(25,65,175,.9)' }));
  });

  // Bâtiment
  svg.appendChild(buildingPlan(bx, by, bw, bh));
  return svg;
}

/**
 * Schéma comparatif des 3 cas TERLAB côte-à-côte — SVG
 * Chaque cas = une colonne avec : profil vent, bâtiments, coefficients
 * @param {number} w h  — dimensions totales
 */
export function buildCasComparisonSVG(w = 600, h = 220) {
  const svg = svgRoot(w, h);
  svg.appendChild(flowAnimStyle());

  const cases = [
    { id: 'isole',   label: 'Isolé · Cafres',   terrain: 'ouvert',    ctp: 1.0, color: CAS_COLORS.isole.primary },
    { id: 'village', label: 'Village · St-Jo',  terrain: 'suburbain', ctp: 0.7, color: CAS_COLORS.village.primary },
    { id: 'ville',   label: 'Ville · St-Denis', terrain: 'dense',     ctp: 0.4, color: CAS_COLORS.ville.primary  },
  ];

  const colW = w / cases.length;
  cases.forEach(({ label, terrain, ctp: ctpVal, color }, i) => {
    const x0 = colW * i;
    const bldH = h * 0.38 * (i === 2 ? 1.6 : i === 1 ? 1.0 : 0.7); // ville = plus haut
    const bldW = colW * 0.22;
    const gY   = h - 22;

    // Sol
    svg.appendChild(sceneGround(x0, gY, colW));

    // Bâtiment(s)
    if (i === 0) { // Isolé: 1 bâtiment
      svg.appendChild(buildingPlan(x0 + colW/2 - bldW/2, gY - bldH, bldW, bldH));
    } else if (i === 1) { // Village: 3 bâtiments espacés
      [-1.2, 0, 1.2].forEach(off => {
        svg.appendChild(buildingPlan(x0 + colW/2 - bldW/2 + off*bldW*1.6, gY - bldH, bldW, bldH));
      });
    } else { // Ville: 4 bâtiments hauts serrés
      [-1.5,-0.5,0.5,1.5].forEach(off => {
        svg.appendChild(buildingPlan(x0 + colW/2 - bldW/2 + off*bldW*1.15, gY - bldH, bldW*0.95, bldH));
      });
    }

    // Profil de vent
    const markId = `arr-cas-${i}`;
    const defs = svg.querySelector('defs') ?? (svg.prepend(svgEl('defs')), svg.querySelector('defs'));
    const mEl = svgEl('marker', { id: markId, viewBox:'0 0 8 8', refX:7, refY:4,
                                    markerWidth:4, markerHeight:4, orient:'auto' });
    mEl.appendChild(svgEl('path', { d:'M0,0 L8,4 L0,8 Z', fill: color }));
    defs.appendChild(mEl);
    svg.appendChild(boundaryLayerSVG(
      x0 + 4, gY, colW * 0.3, gY - 10, terrain,
      { color, arrowCount: 4, markerId }
    ));

    // Label titre
    const titleEl = svgEl('text', {
      x: x0 + colW/2, y: 10, 'text-anchor': 'middle',
      style: `font-family:Inconsolata,monospace;font-size:7px;fill:${color};font-weight:bold`,
    });
    titleEl.textContent = label;
    svg.appendChild(titleEl);

    // Coeff C_TP
    svg.appendChild(coeffLabel(x0 + colW/2, gY + 10,
      `C_TP = ${ctpVal} C₀`, { anchor: 'middle', color }));

    // Séparateur vertical
    if (i > 0) {
      svg.appendChild(svgEl('line', { x1: x0, y1: 5, x2: x0, y2: h-5,
                                       stroke: 'rgba(28,95,168,.15)', 'stroke-width': 0.7 }));
    }
  });
  return svg;
}
