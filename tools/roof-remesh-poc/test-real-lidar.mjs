// TERLAB · tools/roof-remesh-poc/test-real-lidar.mjs
// ─────────────────────────────────────────────────────────────────────────
// Script de test AUTONOME — tentative de faire tourner le pipeline roof-remesh
// (Agent 1 LidarFetch → Agent 2 RoofRough → Agent 3 PlaneFit → Agent 4
// SkeletonRemesh → Agent 5 TreeDetectLidar → Agent 6 SatCrossCheck) sur du VRAI
// LiDAR IGN (tuiles COPC LiDAR HD) et du VRAI WMS COSIA, depuis Node.js (pas de
// navigateur), sur la zone pilote réelle : Le Port, bâtiment BD TOPO
// cleabs=BATIMENT0000001400100704 (code-runner/data/cities/leport/batiment.geojson).
//
// Ce script NE MODIFIE AUCUN FICHIER EXISTANT. Il réutilise tel quel :
//   - utils/copc-reader.js, utils/copc-tile-index.js, utils/utm40s.js (fetch COPC réel)
//   - services/building-reconstruction.js (reconstruct/decimateRoof)
//   - services/vegetation/vegetation-detection.js (_detectLiDAR)
//   - services/vegetation/vegetation-species.js (suggestSpecies)
//   - tools/roof-remesh-poc/skeleton-remesh.js, sat-cross-check.js
//
// Ce que ce script AJOUTE (uniquement ici, jamais dans les fichiers TERLAB) pour
// combler les écarts navigateur → Node :
//   1. Un hook de chargement ESM (module.register) qui permet le
//      `await import('https://cdn.jsdelivr.net/.../delaunator/+esm')` que fait
//      building-reconstruction.js::_ensureDelaunator() — Node refuse nativement
//      les specifiers https:// dans l'import() dynamique.
//   2. global.window = globalThis, pour les `window.X = ...` et `window.LidarCache`
//      / `window.SessionManager` que ces services attendent (stubs de données RÉELLES
//      cette fois, pas synthétiques comme dans extractor-orchestrator.js).
//   3. Un patch de fetch() pour l'appel relatif `fetch('./data/bpf-species-reunion.json')`
//      de vegetation-species.js (chemin relatif à une page servie, n'a pas de sens en
//      Node) — résolu ici vers le fichier réel sur disque.
//   4. Un décodage PNG (pngjs) du WMS COSIA — VegetationDetection._fetchImageData()
//      utilise Image/canvas (DOM), indisponibles en Node ; on fait donc le fetch +
//      décodage nous-mêmes, puis on passe le résultat déjà décodé à sat-cross-check.js
//      (qui, lui, ne dépend d'aucune API DOM).
//
// Prérequis (installés localement dans ce dossier, npm-workspace isolé, ne touche
// pas le package.json racine de TERLAB) :
//   cd tools/roof-remesh-poc && npm install copc pngjs
//
// Lancer :
//   node tools/roof-remesh-poc/test-real-lidar.mjs
//
// Si ça échoue faute de réseau, le script l'indique clairement (URL + erreur) et
// s'arrête — il ne fabrique jamais de résultat de repli.

import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TERLAB_ROOT = path.resolve(__dirname, '../..');
const CODE_RUNNER_ROOT = path.resolve(TERLAB_ROOT, '../code-runner');

// ── 1. Hook réseau pour import() de CDN https:// (Delaunator) ─────────────
// Node refuse `import('https://...')` par défaut (contrairement à un navigateur).
// On enregistre un petit loader inline (data: URL, aucun fichier créé) qui
// fetch le module à la volée et le charge comme du JS ESM classique.
const loaderSrc = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('https://') || specifier.startsWith('http://')) {
    return { url: specifier, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url.startsWith('https://') || url.startsWith('http://')) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('CDN fetch failed ' + res.status + ': ' + url);
    const source = await res.text();
    return { format: 'module', source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(loaderSrc)}`, pathToFileURL('./'));

// ── 2. window shim (services TERLAB font `window.X = ...` au chargement) ──
global.window = globalThis;

// ── 3. fetch() patché : chemins relatifs (vegetation-species.js charge son
//    JSON via `fetch('./data/...')`, valable seulement depuis une page servie) ──
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url && url.startsWith('./')) {
    const abs = path.resolve(TERLAB_ROOT, url);
    const text = await fs.readFile(abs, 'utf8');
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return nativeFetch(input, init);
};

console.log('=== TERLAB roof-remesh-poc — test VRAI LiDAR IGN (Node, pas de navigateur) ===\n');

// ── 4. Vérification réseau réelle (même check que LidarService.isAvailable) ──
const SAMPLE_TILE_URL = 'https://data.geopf.fr/telechargement/download/LiDARHD-NUALID/'
  + 'NUALHD_1-0__LAZ_RGR92UTM40S_REU_2025-06-18/'
  + 'LHD_REU_0356_7687_PTS_RGR92UTM40S_REUN89.copc.laz';

console.log(`[réseau] HEAD ${SAMPLE_TILE_URL}`);
let networkOk = false;
try {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  const res = await nativeFetch(SAMPLE_TILE_URL, { method: 'HEAD', signal: ctrl.signal });
  clearTimeout(timer);
  console.log(`[réseau] → HTTP ${res.status} ${res.ok ? 'OK' : 'ÉCHEC'}`);
  networkOk = res.ok;
} catch (e) {
  console.log(`[réseau] → ÉCHEC : ${e.message}`);
}

if (!networkOk) {
  console.log('\n[BLOQUÉ] Pas d\'accès réseau réel aux tuiles IGN LiDAR HD depuis cet environnement.');
  console.log('Rien n\'a été fabriqué. Relancer ce script depuis un environnement avec accès internet sortant vers data.geopf.fr.');
  process.exit(1);
}

// ── 5. Charger le bâtiment pilote réel (Le Port, BD TOPO) ─────────────────
const CLEABS = 'BATIMENT0000001400100704';
const batimentPath = path.join(CODE_RUNNER_ROOT, 'data/cities/leport/batiment.geojson');
console.log(`\n[data] Lecture ${batimentPath}`);
const batGeojson = JSON.parse(await fs.readFile(batimentPath, 'utf8'));
const feature = batGeojson.features.find(f => f.properties?.cleabs === CLEABS);
if (!feature) {
  console.log(`[BLOQUÉ] cleabs ${CLEABS} introuvable dans batiment.geojson`);
  process.exit(1);
}
console.log(`[data] Bâtiment trouvé : hauteur=${feature.properties.hauteur}m, sol=${feature.properties.altitude_minimale_sol}m`);

const ring = feature.geometry.coordinates[0][0]; // MultiPolygon → premier polygone, premier ring
const groundAltitude_m = feature.properties.altitude_minimale_sol ?? 13.2;
const eaveHeight_m = Math.max(2.5, (feature.properties.hauteur ?? 8.6) * 0.6); // approx égout, pas de mesure directe BD TOPO
const treeAreaRadius_m = 32; // même rayon que la zone pilote synthétique (synthetic-data.js)

let refLng = 0, refLat = 0;
for (const [lng, lat] of ring) { refLng += lng; refLat += lat; }
refLng /= ring.length; refLat /= ring.length;

function geoToLocalSouth(lng, lat) {
  const mLng = 111320 * Math.cos(refLat * Math.PI / 180);
  return { x: (lng - refLng) * mLng, y: (refLat - lat) * 111320 };
}

// bbox WGS84 = emprise bâtiment + marge zone arbres
const margin_deg_lat = treeAreaRadius_m / 111320;
const margin_deg_lng = treeAreaRadius_m / (111320 * Math.cos(refLat * Math.PI / 180));
let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
for (const [lng, lat] of ring) {
  if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
  if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
}
const bbox4326 = [minLng - margin_deg_lng, minLat - margin_deg_lat, maxLng + margin_deg_lng, maxLat + margin_deg_lat];
console.log(`[data] bbox WGS84 (bâtiment + ${treeAreaRadius_m}m) : ${bbox4326.map(v => v.toFixed(6)).join(', ')}`);

// ── 6. Agent 1 réel — LidarFetch : tuiles COPC IGN, vrai réseau ───────────
console.log('\n[Agent 1 · LidarFetch] Fetch réel des tuiles COPC IGN LiDAR HD…');
const { tilesForBboxWgs84, bboxWgs84ToUtm } = await import(pathToFileURL(path.join(TERLAB_ROOT, 'utils/copc-tile-index.js')));
const { readPointsBbox } = await import(pathToFileURL(path.join(TERLAB_ROOT, 'utils/copc-reader.js')));

const tiles = tilesForBboxWgs84(bbox4326[0], bbox4326[1], bbox4326[2], bbox4326[3]);
console.log(`[Agent 1] ${tiles.length} tuile(s) : ${tiles.map(t => t.tileId).join(', ')}`);
if (tiles.length === 0) {
  console.log('[BLOQUÉ] Aucune tuile LiDAR HD pour cette bbox (hors couverture ou hors Réunion).');
  process.exit(1);
}

const utmBbox = bboxWgs84ToUtm(bbox4326[0], bbox4326[1], bbox4326[2], bbox4326[3]);
let lidarResult;
try {
  lidarResult = await readPointsBbox(
    tiles, utmBbox.minX, utmBbox.minY, utmBbox.maxX, utmBbox.maxY,
    { classes: '2,3,4,5,6,9', maxPoints: 300000,
      onProgress: (p) => { if (p.phase) console.log(`[Agent 1]   ${JSON.stringify(p)}`); } },
  );
} catch (e) {
  console.log(`[BLOQUÉ] readPointsBbox a levé une erreur réseau/décodage : ${e.message}`);
  console.log(e.stack);
  process.exit(1);
}
console.log(`[Agent 1] → ${lidarResult.count} points réels chargés (${lidarResult.tile_count} tuile(s))`);
if (lidarResult.count === 0) {
  console.log('[BLOQUÉ] 0 point retourné — la zone est probablement hors emprise LiDAR HD réelle ou le filtre classe est trop strict.');
  process.exit(1);
}

// Répartition par classe
const byClass = {};
for (const p of lidarResult.points) byClass[p[6]] = (byClass[p[6]] || 0) + 1;
console.log(`[Agent 1] Répartition classes : ${JSON.stringify(byClass)}`);

// ── 7. Points toiture réels (classe 6) → repère local (x=est, y=alt, z=sud) ──
const roofPointsAll = lidarResult.points
  .filter(p => p[6] === 6)
  .map(p => { const { x, y } = geoToLocalSouth(p[0], p[1]); return { x, y: p[2], z: y }; });
console.log(`[Agent 1] ${roofPointsAll.length} points classe=6 (toiture) dans la zone`);

if (roofPointsAll.length < 20) {
  console.log('[BLOQUÉ] Pas assez de points toiture réels (classe 6) pour reconstruire ce bâtiment.');
  console.log('Cause possible : la classification IGN classe=6 (bâti) est absente/clairsemée sur cette dalle, ou le bâtiment est trop petit pour la densité LiDAR HD.');
  process.exit(1);
}

// Holdout 15% pour validation croisée SANS vérité terrain synthétique (mêmes points
// réels, juste tenus à l'écart de la reconstruction — méthodologie de
// extractor-orchestrator.js::meanAbsResidual, mais appliquée à du LiDAR réel).
function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry32(42);
const roofPoints = [], testPoints = [];
for (const pt of roofPointsAll) (rng() < 0.15 ? testPoints : roofPoints).push(pt);
console.log(`[Agent 1] Split réel : ${roofPoints.length} entraînement / ${testPoints.length} test croisé (holdout 15%)`);

// ── 8. Agent 2 — RoofRough : reconstruct() réel, non modifié ──────────────
console.log('\n[Agent 2 · RoofRough] BuildingReconstruction.reconstruct() sur points LiDAR RÉELS…');
const { default: BuildingReconstruction } = await import(pathToFileURL(path.join(TERLAB_ROOT, 'services/building-reconstruction.js')));
const groundAltFn = () => groundAltitude_m;
let roughResult;
try {
  roughResult = await BuildingReconstruction.reconstruct(roofPoints, groundAltFn, {});
} catch (e) {
  console.log(`[BLOQUÉ] Agent 2 a échoué (souvent : CDN Delaunator injoignable) : ${e.message}`);
  console.log(e.stack);
  process.exit(1);
}
if (!roughResult?.buildings?.length) {
  console.log('[BLOQUÉ] Agent 2 : aucun bâtiment reconstruit depuis le nuage LiDAR réel (points trop bruités/épars pour ce cleabs).');
  process.exit(1);
}
const building = roughResult.buildings[0];
console.log(`[Agent 2] → footprint ${building.footprintType}, ${building.footprint.length} sommets, hauteur estimée ${building.height?.toFixed?.(2)}m`);

// ── 9. Agent 3 — PlaneFit : decimateRoof() réel, non modifié ──────────────
console.log('\n[Agent 3 · PlaneFit] BuildingReconstruction.decimateRoof()…');
const decimation = BuildingReconstruction.decimateRoof(building.roofPositions, building.roofIndices, 15, 0.3);
console.log(`[Agent 3] → ${decimation?.planes?.length ?? 0} plan(s) dominant(s)`);

// ── 10. Agent 4 — SkeletonRemesh (POC, réutilisé tel quel) ────────────────
console.log('\n[Agent 4 · SkeletonRemesh] weightedSkeleton() depuis les plans dominants RÉELS…');
const { skeletonRemesh } = await import(pathToFileURL(path.join(__dirname, 'skeleton-remesh.js')));
const baseY = groundAltitude_m + eaveHeight_m;
const remesh = skeletonRemesh(building, decimation, testPoints, baseY);
if (!remesh.ok) {
  console.log(`[Agent 4] → ÉCHEC : ${remesh.reason}`);
} else {
  console.log(`[Agent 4] → forme détectée : ${remesh.shape}`);
  console.log(`[Agent 4] → résidu remesh vs points LiDAR réels tenus à l'écart : ${remesh.residualM != null ? remesh.residualM.toFixed(3) + ' m' : 'n/a'} (sur ${remesh.pointsUsedForResidual} points)`);
}

// Résidu du mesh Delaunay BRUT (Agent 2) sur les mêmes points holdout, pour comparaison —
// même méthode que extractor-orchestrator.js::baryHeightOnRawMesh, sans vérité terrain
// synthétique : on compare juste à l'altitude RÉELLEMENT mesurée par le LiDAR.
function baryHeightOnRawMesh(positions, indices, qx, qz) {
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
    const ax = positions[i0 * 3], ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
    const bx = positions[i1 * 3], by = positions[i1 * 3 + 1], bz = positions[i1 * 3 + 2];
    const cx = positions[i2 * 3], cy = positions[i2 * 3 + 1], cz = positions[i2 * 3 + 2];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) continue;
    const w0 = ((bz - cz) * (qx - cx) + (cx - bx) * (qz - cz)) / d;
    const w1 = ((cz - az) * (qx - cx) + (ax - cx) * (qz - cz)) / d;
    const w2 = 1 - w0 - w1;
    if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
    return w0 * ay + w1 * by + w2 * cy;
  }
  return null;
}
let sumRaw = 0, nRaw = 0;
for (const pt of testPoints) {
  const h = baryHeightOnRawMesh(building.roofPositions, building.roofIndices, pt.x, pt.z);
  if (h == null) continue;
  sumRaw += Math.abs(pt.y - h); nRaw++;
}
const residualRaw_m = nRaw ? sumRaw / nRaw : null;
console.log(`[Agent 2 baseline] → résidu mesh Delaunay brut vs mêmes points holdout : ${residualRaw_m != null ? residualRaw_m.toFixed(3) + ' m' : 'n/a'} (sur ${nRaw} points)`);

// ── 11. Agent 5 — TreeDetectLidar (_detectLiDAR() réel, non modifié) ──────
console.log('\n[Agent 5 · TreeDetectLidar] VegetationDetection._detectLiDAR() sur points RÉELS (classes 4/5)…');
const { default: VegetationDetection } = await import(pathToFileURL(path.join(TERLAB_ROOT, 'services/vegetation/vegetation-detection.js')));
const parcelleRing = [
  [bbox4326[0], bbox4326[1]], [bbox4326[2], bbox4326[1]],
  [bbox4326[2], bbox4326[3]], [bbox4326[0], bbox4326[3]], [bbox4326[0], bbox4326[1]],
];
window.SessionManager = { _data: { terrain: { parcelle_geojson: { type: 'Polygon', coordinates: [parcelleRing] } } } };
window.LidarCache = { async getPoints() { return { points: lidarResult.points }; } };

const vegCfg = { gridRes_m: 1.0, peakNeighborhood: 2, lidarMinHeight_m: 3.0 };
let candidates = [];
try {
  candidates = await VegetationDetection._detectLiDAR(bbox4326, [refLng, refLat], vegCfg, 'real-lidar-test');
} catch (e) {
  console.log(`[Agent 5] → ÉCHEC : ${e.message}`);
}
console.log(`[Agent 5] → ${candidates.length} candidat(s) arbre détecté(s) sur CHM LiDAR réel`);

// ── 12. Agent 6 — SatCrossCheck : WMS COSIA RÉEL (fetch + décodage PNG ici,
//     car _fetchImageData() de vegetation-detection.js est DOM-only) ──────
console.log('\n[Agent 6 · SatCrossCheck] Fetch WMS COSIA réel…');
const IMG_SIZE = 512;
const wmsUrl = `https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap`
  + `&LAYERS=IGNF_COSIA_2021-2023&CRS=EPSG:4326`
  + `&BBOX=${bbox4326[1]},${bbox4326[0]},${bbox4326[3]},${bbox4326[2]}`
  + `&WIDTH=${IMG_SIZE}&HEIGHT=${IMG_SIZE}&FORMAT=image/png&STYLES=`;
console.log(`[Agent 6] GET ${wmsUrl}`);

let cosiaImageData = null;
try {
  const res = await nativeFetch(wmsUrl);
  console.log(`[Agent 6] → HTTP ${res.status}, content-type=${res.headers.get('content-type')}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const png = PNG.sync.read(buf);
  cosiaImageData = { data: png.data, width: png.width, height: png.height };
  console.log(`[Agent 6] → PNG décodé ${png.width}x${png.height}`);
} catch (e) {
  console.log(`[Agent 6] → ÉCHEC fetch/décodage WMS COSIA : ${e.message}`);
}

let crossCheck = null;
if (cosiaImageData && candidates.length) {
  const { satCrossCheck } = await import(pathToFileURL(path.join(__dirname, 'sat-cross-check.js')));
  try {
    crossCheck = await satCrossCheck(candidates, cosiaImageData, bbox4326, groundAltitude_m, 'tropical-reunion', {});
    console.log(`[Agent 6] → ${crossCheck.stats.validatedCount} validé(s) / ${crossCheck.stats.rejectedCount} rejeté(s) (taux rejet ${crossCheck.stats.rejectionRate}%)`);
  } catch (e) {
    console.log(`[Agent 6] → ÉCHEC satCrossCheck : ${e.message}`);
  }
} else if (!candidates.length) {
  console.log('[Agent 6] → sauté (Agent 5 n\'a produit aucun candidat sur cette zone)');
}

// ── 13. Résumé métriques RÉELLES ───────────────────────────────────────────
console.log('\n=== RÉSUMÉ — métriques mesurées sur VRAI LiDAR IGN + VRAI WMS COSIA ===');
console.log(JSON.stringify({
  zone: { city: 'leport', cleabs: CLEABS, centroid: [refLng, refLat], tiles: tiles.map(t => t.tileId) },
  lidar: { totalPoints: lidarResult.count, byClass, roofPointsTrain: roofPoints.length, roofPointsHoldout: testPoints.length },
  toiture: {
    footprintType: building.footprintType,
    plansDetectes: decimation?.planes?.length ?? 0,
    formeDetectee: remesh.ok ? remesh.shape : null,
    residualMeshBrut_m: residualRaw_m != null ? Math.round(residualRaw_m * 1000) / 1000 : null,
    residualRemesh_m: remesh.ok && remesh.residualM != null ? Math.round(remesh.residualM * 1000) / 1000 : null,
  },
  vegetation: {
    candidatsAgent5: candidates.length,
    valides: crossCheck?.stats?.validatedCount ?? null,
    rejetes: crossCheck?.stats?.rejectedCount ?? null,
    tauxRejetPct: crossCheck?.stats?.rejectionRate ?? null,
  },
}, null, 2));
