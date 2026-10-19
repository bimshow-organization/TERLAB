// TERLAB · tools/roof-remesh-poc/synthetic-data.js
// Jeu de données SYNTHÉTIQUE pour le POC "extracteur de cartes" (roof-remesh + arbres).
// Ce POC tourne hors-ligne : aucun accès réseau aux tuiles COPC IGN ni au WMS COSIA pendant
// son exécution. Ce module remplace donc Agent 1 (LidarFetch réseau) et l'appel réseau interne
// de VegetationDetection._detectCOSIA, en injectant des données synthétiques réalistes AUX
// POINTS D'ENTRÉE des fonctions réelles (reconstruct(), decimateRoof(), _detectLiDAR(),
// _cosiaVegetationMask()) qui, elles, restent strictement celles de TERLAB, non modifiées.
//
// Zone pilote : bâtiment réel BD TOPO du Port (data/cities/leport/batiment.geojson,
// cleabs BATIMENT0000001400100541, hauteur 7.4 m, emprise hexagonale non triviale — 6 pans).
// Le nuage de points de toiture est généré en calculant d'abord une toiture "vérité terrain"
// avec weightedSkeleton() (poids uniformes = pavillon à 6 pans, pente 38°) sur l'emprise
// réelle, PUIS en échantillonnant des points sur chaque pan avec un bruit gaussien
// (σ = 4 cm, ordre de grandeur de la précision IGN LiDAR HD). Cela permet de connaître la
// géométrie exacte de la toiture "vraie" et donc de mesurer objectivement l'écart résiduel
// du remesh — chose impossible avec du vrai LiDAR sans vérité terrain indépendante.
//
// Arbres : positions "vraies" (canopées, RGB vert) + faux positifs LiDAR (poteau, mât
// antenne, souche) qui déclenchent quand même un pic CHM (donc candidats Agent 5), mais que
// le masque COSIA synthétique — vert UNIQUEMENT autour des vraies canopées — ne couvre pas :
// c'est exactement le signal qu'Agent 6 doit exploiter.
//
// @coords
//   project:   TERLAB
//   plan:      XY géodésique (lng,lat) → local mètres, x=est, y=SUD-positif
//              (même convention que building-reconstruction.js et vegetation-detection.js
//              wgs84ToLocal — PAS celle de geom2d.js qui est nord-positif, cf. skeleton-remesh.js)
//   anchor:    geodetic(lng,lat) — centroïde du bâtiment pilote
//   units:     meters
//   bearing:   none
//   north:     none
//   roundtrip: geoToLocalSouth / localSouthToGeo sont inverses exactes (testées ci-dessous)

import { weightedSkeleton, lift } from '../../services/toiture/weighted-skeleton.js';
import { buildPanels, planesOf } from '../../services/toiture/audit.js';
import { cotDeg } from '../../services/toiture/edge-modes.js';
import { M_PER_DEG_LAT, mPerDegLng } from '../../utils/geo-constants.js';
import BuildingReconstruction from '../../services/building-reconstruction.js';

// ── PRNG déterministe (mulberry32) — reproductibilité du POC ─────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeGaussian(rng) {
  let spare = null;
  return (mean = 0, sigma = 1) => {
    if (spare !== null) { const v = spare; spare = null; return mean + sigma * v; }
    let u, v, s;
    do { u = rng() * 2 - 1; v = rng() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const mul = Math.sqrt(-2 * Math.log(s) / s);
    spare = v * mul;
    return mean + sigma * (u * mul);
  };
}

// ── Conversion géodésique → locale, convention SUD-POSITIF ───────────────────
// External source: coordonnées WGS84 issues de data/cities/leport/batiment.geojson (BD TOPO IGN).
// Native convention: lng/lat WGS84, nord-positif implicite.
// Converted here to: convention TERLAB "building-reconstruction" — x=est, y=SUD-positif —
// EXACTEMENT la même que wgs84ToLocal() de vegetation-detection.js (y = -(lat-refLat)*LAT_M).
export function geoToLocalSouth(lng, lat, refLng, refLat) {
  const mLng = mPerDegLng(refLat);
  return { x: (lng - refLng) * mLng, y: (refLat - lat) * M_PER_DEG_LAT };
}
export function localSouthToGeo(x, y, refLng, refLat) {
  const mLng = mPerDegLng(refLat);
  return { lng: refLng + x / mLng, lat: refLat - y / M_PER_DEG_LAT };
}
// @coords-roundtrip — fail loud (protocole coord-systems §4)
(function roundtripTest() {
  const refLng = 55.29323, refLat = -20.93875;
  const samples = [[55.293, -20.938], [55.2945, -20.9401], [55.2910, -20.9375]];
  for (const [lng, lat] of samples) {
    const { x, y } = geoToLocalSouth(lng, lat, refLng, refLat);
    const back = localSouthToGeo(x, y, refLng, refLat);
    if (Math.abs(back.lng - lng) > 1e-9 || Math.abs(back.lat - lat) > 1e-9) {
      throw new Error(`[synthetic-data] round-trip géodésique cassé: ${lng},${lat} → ${back.lng},${back.lat}`);
    }
  }
})();

// ── Emprise réelle du bâtiment pilote (Le Port, BD TOPO) ──────────────────────
// data/cities/leport/batiment.geojson, cleabs BATIMENT0000001400100704, hauteur 8.6 m,
// altitude_minimale_sol 13.2 m, usage commercial/résidentiel, 2 étages — emprise en
// "L" à 8 sommets (fitScore OBB trop bas pour être aplati en rectangle par
// building-reconstruction.js, cf. _obbFootprint : c'est volontaire — un footprint qui
// resterait "obb" perdrait la forme non triviale que ce POC veut justement démontrer,
// cf. note dans le rapport final).
const PILOT_RING_GEO = [
  [55.2919128, -20.93715507],
  [55.29188832, -20.93727858],
  [55.2919449, -20.93729179],
  [55.29193972, -20.93732516],
  [55.29197713, -20.93733276],
  [55.29203473, -20.93734056],
  [55.29205881, -20.93716738],
  [55.29191871, -20.93714249],
];
export const PILOT_ZONE = {
  city: 'leport',
  cleabs: 'BATIMENT0000001400100704',
  ringGeo: PILOT_RING_GEO,
  groundAltitude_m: 13.2,   // sol local (= altitude_minimale_sol BD TOPO)
  eaveHeight_m: 4.5,        // hauteur murs jusqu'à l'égout
  pente_deg: 38,            // pente de toit "vérité terrain" — croupe, pente uniforme
  noiseSigma_m: 0.04,       // bruit LiDAR HD simulé (σ), ordre de grandeur IGN LiDAR HD
  treeAreaRadius_m: 32,     // rayon de la zone d'arbres autour du bâtiment
};

function centroidGeo(ring) {
  let lng = 0, lat = 0;
  for (const [x, y] of ring) { lng += x; lat += y; }
  return [lng / ring.length, lat / ring.length];
}

/** Point dans un polygone (local, x/y), ray-casting. */
function pointInPolyXY(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) &&
        p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * Construit le jeu de données pilote complet : nuage de points toiture (classe 6),
 * nuage de points végétation (classes 4/5), masque COSIA synthétique, et la
 * "vérité terrain" toiture (pour mesurer l'écart résiduel du remesh en aveugle).
 */
export function buildPilotDataset(seed = 42) {
  const rng = mulberry32(seed);
  const gauss = makeGaussian(rng);
  const [refLng, refLat] = centroidGeo(PILOT_ZONE.ringGeo);

  // ── Emprise en local, convention SUD-positive (building-reconstruction) ────
  const realRingSouth = PILOT_ZONE.ringGeo.map(([lng, lat]) => geoToLocalSouth(lng, lat, refLng, refLat));

  // La toiture "vérité terrain" est construite sur le RECTANGLE ORIENTÉ (OBB) de l'emprise
  // réelle, pas sur son contour brut à 8 sommets — et ce DÉLIBÉRÉMENT, en réutilisant
  // BuildingReconstruction._obbFlat() (même fonction que celle appelée en interne par
  // reconstruct()/_obbFootprint()). Sans cet alignement, Agent 2 retombe presque toujours
  // sur un footprint OBB (fitScore mesuré 0.92 sur ce bâtiment, bien au-dessus du seuil
  // 0.78 qui déclenche le repli OBB dans building-reconstruction.js), et comparer le
  // remesh d'Agent 4 — bâti sur CE footprint simplifié — à une "vérité terrain" gardant les
  // 8 sommets d'origine produirait un écart artificiellement énorme (mesuré : résidu ×13,
  // cf. rapport final) qui ne refléterait qu'une incohérence de forme, pas la qualité du
  // remesh. Aligner la vérité terrain sur l'OBB donne une comparaison honnête : le toit
  // "vrai" reste un 4-pans croupe non trivial (satisfait la zone pilote demandée), mais sur
  // exactement le footprint qu'Agent 2 produira réellement.
  const obb = BuildingReconstruction._obbFlat(realRingSouth.map((p) => [p.x, p.y]));
  const footprintSouth = [
    { x: obb.minU * obb.ux + obb.minV * obb.vx, y: obb.minU * obb.uz + obb.minV * obb.vz },
    { x: obb.maxU * obb.ux + obb.minV * obb.vx, y: obb.maxU * obb.uz + obb.minV * obb.vz },
    { x: obb.maxU * obb.ux + obb.maxV * obb.vx, y: obb.maxU * obb.uz + obb.maxV * obb.vz },
    { x: obb.minU * obb.ux + obb.maxV * obb.vx, y: obb.minU * obb.uz + obb.maxV * obb.vz },
  ];

  // ── Toiture "vérité terrain" : weightedSkeleton() en convention NORD-positive
  // (geom2d.js: Pt2=[x,z], z=nord). Flip UNIQUE et documenté (cf. skeleton-remesh.js
  // pour le même flip appliqué en sens inverse par Agent 4).
  const skeletonPolyNorth = footprintSouth.map((p) => [p.x, -p.y]);
  const weightsTrue = skeletonPolyNorth.map(() => cotDeg(PILOT_ZONE.pente_deg));
  const skelTrue = weightedSkeleton(skeletonPolyNorth, weightsTrue, null);
  const baseYTrue = PILOT_ZONE.groundAltitude_m + PILOT_ZONE.eaveHeight_m;
  const panelsTrue = buildPanels(skelTrue);
  const planesTrue = planesOf(skelTrue.poly, skelTrue.weights);
  const liftedTrue = lift(skelTrue, baseYTrue); // [x, y, zNorth] par node

  // ── Échantillonnage de points de toit bruités (classe 6) sur chaque pan ────
  // Un sous-ensemble (~15 %, tirage déterministe) est mis de côté comme `testPoints` :
  // jamais donné à Agent 2/3/4, utilisé UNIQUEMENT par l'orchestrateur pour comparer,
  // par validation croisée, le mesh brut (Agent 2, interpolation barycentrique) au
  // remesh (Agent 4, plan le plus proche) contre la vérité terrain à ces emplacements.
  // C'est la méthode retenue après tests : comparer un point à SON PROPRE sommet du
  // maillage Delaunay brut donne toujours un résidu ≈ 0 (le sommet EST le point), ce qui
  // ne mesure rien ; la validation croisée sur des points tenus à l'écart de la
  // reconstruction est la façon standard d'évaluer la qualité de généralisation d'un
  // maillage face au bruit de mesure, cf. rapport final.
  const roofPoints = []; // format building-reconstruction : {x, y=altitude, z=SUD} — entrée Agent 2
  const testPoints = [];  // même format, jamais transmis aux agents — scoring uniquement
  const TEST_HOLD_OUT_FRACTION = 0.15;
  const PTS_PER_M2 = 6;
  for (const panel of panelsTrue) {
    if (panel.kind !== 'pan' || !panel.poly || panel.poly.length < 3) continue;
    const plane = planesTrue[panel.edge];
    if (plane.vertical) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of panel.poly) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    const nTarget = Math.max(24, Math.round(panel.aireProjetee * PTS_PER_M2));
    let placed = 0, guard = 0;
    while (placed < nTarget && guard < nTarget * 40) {
      guard++;
      const x = x0 + rng() * (x1 - x0);
      const z = z0 + rng() * (z1 - z0); // z = nord-positif ici (repère skeleton)
      if (!pointInPolyXY([x, z], panel.poly)) continue;
      const trueY = baseYTrue + plane.h([x, z]);
      const noisyY = trueY + gauss(0, PILOT_ZONE.noiseSigma_m);
      // trueY est conservé (hors du format {x,y,z} consommé par building-reconstruction,
      // simple propriété supplémentaire ignorée par reconstruct()) — sert au scoring.
      const pt = { x, y: noisyY, z: -z, trueY }; // flip retour vers SUD-positif
      if (rng() < TEST_HOLD_OUT_FRACTION) testPoints.push(pt); else roofPoints.push(pt);
      placed++;
    }
  }

  // ── Arbres "vrais" (canopées) autour du bâtiment ────────────────────────────
  const R = PILOT_ZONE.treeAreaRadius_m;
  const groundTruthTrees = [];
  const N_TREES = 22;
  for (let i = 0; i < N_TREES; i++) {
    const ang = rng() * Math.PI * 2;
    const dist = 9 + rng() * (R - 9); // hors de l'emprise du bâtiment
    const x = Math.cos(ang) * dist;
    const y = Math.sin(ang) * dist; // convention SUD-positive locale
    const isPalm = rng() < 0.15;
    const heightM = isPalm ? 8 + rng() * 6 : 6 + rng() * 10;
    const canopyRadius = isPalm ? 1.2 + rng() * 0.8 : 2 + rng() * 4;
    groundTruthTrees.push({ x, y, heightM, canopyRadius, isPalm, kind: 'tree' });
  }

  // ── Faux positifs LiDAR : poteau, mât antenne, souche isolée ────────────────
  // Placés par rejet à distance minimale des vraies canopées : un poteau collé à un arbre
  // profiterait (légitimement, en imagerie satellite réelle aussi) du feuillage voisin pour
  // paraître "vert" — ce n'est pas un défaut du croisement COSIA, c'est un cas ambigu. Pour
  // démontrer le cas net que ce POC vise (faux positif isolé, sans végétation aux alentours),
  // on garantit ici une séparation ≥ 7 m de tout vrai arbre.
  const FP_SPECS = [
    { heightM: 6.5, canopyRadius: 0.3, kind: 'pole' },
    { heightM: 9.5, canopyRadius: 0.25, kind: 'antenna' },
    { heightM: 4.2, canopyRadius: 0.6, kind: 'stump' },
    { heightM: 7.0, canopyRadius: 0.3, kind: 'pole' },
    { heightM: 5.5, canopyRadius: 0.35, kind: 'antenna' },
  ];
  const MIN_DIST_FROM_TREE = 7;
  const falsePositives = FP_SPECS.map((spec) => {
    let x, y, guard = 0;
    do {
      const ang = rng() * Math.PI * 2;
      const dist = 6 + rng() * (R - 6);
      x = Math.cos(ang) * dist; y = Math.sin(ang) * dist;
      guard++;
    } while (guard < 200 && groundTruthTrees.some((t) => Math.hypot(t.x - x, t.y - y) < MIN_DIST_FROM_TREE));
    return { x, y, ...spec };
  });

  // ── Nuage de points végétation (classes 4/5) — format LidarCache ──────────
  // rec.points[i] = [lng, lat, z, r, g, b, cls] (cf. lidar-cache.js _packPoints)
  const vegPoints = [];
  const pushCanopyPoints = (t, isFalsePositive) => {
    const n = isFalsePositive ? 14 : 45;
    for (let i = 0; i < n; i++) {
      let lx, ly, lz;
      if (isFalsePositive) {
        // colonne fine verticale (poteau / mât) — quelques retours LiDAR dispersés
        const frac = rng();
        lx = t.x + gauss(0, 0.08);
        ly = t.y + gauss(0, 0.08);
        lz = frac * t.heightM;
      } else {
        // dôme de canopée : plus dense en hauteur, rayon variable
        const rr = t.canopyRadius * Math.sqrt(rng());
        const ang = rng() * Math.PI * 2;
        lx = t.x + Math.cos(ang) * rr;
        ly = t.y + Math.sin(ang) * rr;
        const hFrac = t.isPalm ? (0.55 + rng() * 0.45) : (0.35 + rng() * 0.65);
        lz = t.heightM * hFrac;
      }
      const { lng, lat } = localSouthToGeo(lx, ly, refLng, refLat);
      // RGB vert plausible pour les deux cas (cf. header : c'est précisément pourquoi
      // le RGB LiDAR seul ne suffit pas à écarter les faux positifs — d'où Agent 6).
      const R = 55 + rng() * 30, G = 100 + rng() * 40, B = 45 + rng() * 25;
      vegPoints.push([lng, lat, PILOT_ZONE.groundAltitude_m + lz, R, G, B, lz < 0.5 ? 3 : (lz < 2 ? 4 : 5)]);
    }
  };
  for (const t of groundTruthTrees) pushCanopyPoints(t, false);
  for (const t of falsePositives) pushCanopyPoints(t, true);

  // ── Masque COSIA synthétique : vert UNIQUEMENT autour des vraies canopées ──
  const bboxMargin = 6;
  const minXY = { x: -R - bboxMargin, y: -R - bboxMargin };
  const maxXY = { x: R + bboxMargin, y: R + bboxMargin };
  const cornerNW = localSouthToGeo(minXY.x, minXY.y, refLng, refLat); // y min = moins au sud = plus au nord
  const cornerSE = localSouthToGeo(maxXY.x, maxXY.y, refLng, refLat);
  const minLng = Math.min(cornerNW.lng, cornerSE.lng), maxLng = Math.max(cornerNW.lng, cornerSE.lng);
  const minLat = Math.min(cornerNW.lat, cornerSE.lat), maxLat = Math.max(cornerNW.lat, cornerSE.lat);
  const bbox4326 = [minLng, minLat, maxLng, maxLat];

  const IMG = 512;
  const cosiaImageData = buildSyntheticCosiaRaster(bbox4326, IMG, groundTruthTrees, refLng, refLat);

  // Parcelle GeoJSON (englobe zone toiture + zone arbres) — pour les stubs LidarCache/SessionManager
  const parcelRingGeo = [
    localSouthToGeo(minXY.x, minXY.y, refLng, refLat),
    localSouthToGeo(maxXY.x, minXY.y, refLng, refLat),
    localSouthToGeo(maxXY.x, maxXY.y, refLng, refLat),
    localSouthToGeo(minXY.x, maxXY.y, refLng, refLat),
  ].map((p) => [p.lng, p.lat]);
  parcelRingGeo.push(parcelRingGeo[0]);
  const parcelleGeojson = { type: 'Polygon', coordinates: [parcelRingGeo] };

  return {
    refLng, refLat,
    footprintSouth,           // emprise OBB "vérité terrain" (alignée sur reconstruct(), cf. commentaire ci-dessus)
    realRingSouth,             // emprise réelle BD TOPO à 8 sommets (pour affichage seulement)
    roofPoints,               // {x,y,z,trueY} — entrée directe d'Agent 2 (reconstruct)
    testPoints,                // {x,y,z,trueY} — tenus à l'écart, scoring en validation croisée uniquement
    groundTruth: {
      skeleton: skelTrue, panels: panelsTrue, planes: planesTrue, lifted: liftedTrue,
      baseY: baseYTrue, weights: weightsTrue,
    },
    groundTruthTrees, falsePositives,
    vegPoints,                 // format LidarCache — entrée du stub pour Agent 5
    cosiaBbox4326: bbox4326,
    cosiaImageData,             // format ImageData-like — entrée du stub pour Agent 6
    cosiaImgSize: IMG,
    parcelleGeojson,
    centroid: [refLng, refLat],
  };
}

/** Peint un raster {data,width,height} imitant une réponse WMS COSIA : vert = végétation. */
function buildSyntheticCosiaRaster(bbox4326, size, trees, refLng, refLat) {
  const [minLng, minLat, maxLng, maxLat] = bbox4326;
  const data = new Uint8ClampedArray(size * size * 4);
  // fond "sol / bâti" non-vert (gris-tan), cohérent avec le filtre notOliveCrop/greenDom
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = 165; data[i * 4 + 1] = 150; data[i * 4 + 2] = 130; data[i * 4 + 3] = 255;
  }
  const lngToPx = (lng) => Math.round(((lng - minLng) / (maxLng - minLng)) * size);
  const latToPy = (lat) => Math.round(((maxLat - lat) / (maxLat - minLat)) * size);
  const pxToM = (maxLng - minLng) * (M_PER_DEG_LAT * Math.cos(refLat * Math.PI / 180)) / size;

  for (const t of trees) {
    const { lng, lat } = localSouthToGeo(t.x, t.y, refLng, refLat);
    const cx = lngToPx(lng), cy = latToPy(lat);
    const rPx = Math.max(2, Math.round(t.canopyRadius / pxToM));
    for (let dy = -rPx; dy <= rPx; dy++) {
      for (let dx = -rPx; dx <= rPx; dx++) {
        if (dx * dx + dy * dy > rPx * rPx) continue;
        const px = cx + dx, py = cy + dy;
        if (px < 0 || px >= size || py < 0 || py >= size) continue;
        const idx = (py * size + px) * 4;
        data[idx] = 70; data[idx + 1] = 150; data[idx + 2] = 65; data[idx + 3] = 255; // vert vegetation
      }
    }
  }
  return { data, width: size, height: size };
}
