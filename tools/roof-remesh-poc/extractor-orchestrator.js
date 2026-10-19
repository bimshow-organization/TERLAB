// TERLAB · tools/roof-remesh-poc/extractor-orchestrator.js · Agent 0 — Orchestrateur
// Séquence les agents 1→6 sur la zone pilote (façon SessionManager de TERLAB : un objet
// d'état partagé, pas de classe). Chaque agent est un module isolé avec un contrat
// d'entrée/sortie strict, pour pouvoir comparer brut vs remesh à chaque étape dans l'UI.
//
// Agents 1/2/3/5 appellent le code TERLAB réel SANS MODIFICATION :
//   Agent 1 → utils synthetic-data.js (substitut hors-ligne de lidar-service.js/lidar-cache.js
//             — aucun accès réseau IGN pendant ce POC, cf. rapport final)
//   Agent 2 → services/building-reconstruction.js :: reconstruct()
//   Agent 3 → services/building-reconstruction.js :: decimateRoof()
//   Agent 5 → services/vegetation/vegetation-detection.js :: _detectLiDAR()
// Agents 4 et 6 sont nouveaux (skeleton-remesh.js, sat-cross-check.js), construits sur les
// patrons décrits dans leurs propres en-têtes.
//
// Le pont réseau qu'Agent 5 attend (window.LidarCache, window.SessionManager) est stubé ICI,
// au niveau de l'orchestrateur — jamais dans les fichiers TERLAB eux-mêmes — pour lui fournir
// le nuage de points synthétique exactement comme si LidarCache avait répondu depuis IndexedDB.

import BuildingReconstruction from '../../services/building-reconstruction.js';
import VegetationDetection from '../../services/vegetation/vegetation-detection.js';
import { buildPilotDataset, PILOT_ZONE } from './synthetic-data.js';
import { skeletonRemesh } from './skeleton-remesh.js';
import { satCrossCheck } from './sat-cross-check.js';

const VEG_CFG_DEFAULTS = {
  gridRes_m: 1.0,
  peakNeighborhood: 2,
  lidarMinHeight_m: 3.0,
};

/** Moyenne de |f(pt)| sur une liste de points, en ignorant les null (hors mesh). */
function meanAbsResidual(points, f) {
  let sum = 0, n = 0;
  for (const pt of points) {
    const d = f(pt);
    if (d == null || !isFinite(d)) continue;
    sum += d; n++;
  }
  return n ? sum / n : null;
}

/**
 * Hauteur interpolée du maillage Delaunay brut (Agent 2) à la position (x,z), par
 * coordonnées barycentriques dans le triangle qui la contient. Repère : x=est, z=SUD
 * (même convention que building-reconstruction.js::_delaunayRoof). null si (x,z) hors mesh.
 */
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

/** Installe les stubs réseau/cache dont Agent 5 (VegetationDetection._detectLiDAR) a besoin. */
function installOfflineStubs(dataset) {
  const prevCache = window.LidarCache;
  const prevSession = window.SessionManager;
  window.LidarCache = {
    async getPoints({ sessionId, geojson, classes }) {
      void sessionId; void geojson; void classes;
      return { points: dataset.vegPoints };
    },
  };
  window.SessionManager = {
    _data: { terrain: { parcelle_geojson: dataset.parcelleGeojson } },
  };
  return () => { window.LidarCache = prevCache; window.SessionManager = prevSession; };
}

/**
 * Séquence Agent 1 → Agent 6 sur la zone pilote et calcule les métriques de succès.
 * @param {{seed?: number, onProgress?: (msg:string)=>void}} opts
 */
export async function runExtractorPipeline(opts = {}) {
  const log = opts.onProgress ?? (() => {});
  const seed = opts.seed ?? 42;

  // ── Agent 1 — LidarFetch (offline : substitut synthétique, cf. header) ────
  log('Agent 1 · LidarFetch — génération du jeu de données pilote (synthétique, hors-ligne)');
  const dataset = buildPilotDataset(seed);
  const restoreStubs = installOfflineStubs(dataset);

  try {
    // ── Agent 2 — RoofRough (reconstruct(), réutilisation directe) ───────────
    log('Agent 2 · RoofRough — BuildingReconstruction.reconstruct()');
    const groundAltFn = () => PILOT_ZONE.groundAltitude_m;
    const roughResult = await BuildingReconstruction.reconstruct(dataset.roofPoints, groundAltFn, {});
    if (!roughResult?.buildings?.length) throw new Error('Agent 2 : aucun bâtiment reconstruit depuis le nuage synthétique');
    const building = roughResult.buildings[0];

    // ── Agent 3 — PlaneFit (decimateRoof(), réutilisation directe) ───────────
    log('Agent 3 · PlaneFit — BuildingReconstruction.decimateRoof()');
    const decimation = BuildingReconstruction.decimateRoof(building.roofPositions, building.roofIndices, 15, 0.3);

    // ── Agent 4 — SkeletonRemesh (nouveau) ────────────────────────────────────
    log('Agent 4 · SkeletonRemesh — weightedSkeleton() depuis les plans dominants');
    const baseY = PILOT_ZONE.groundAltitude_m + PILOT_ZONE.eaveHeight_m;
    // Le résidu d'Agent 4 est mesuré sur dataset.testPoints (tenus à l'écart de la
    // reconstruction, cf. synthetic-data.js) — jamais sur les points d'entraînement, sinon
    // un point comparé à SON PROPRE plan (dérivé essentiellement de sa propre région) sous-
    // estimerait l'erreur réelle de généralisation.
    const remesh = skeletonRemesh(building, decimation, dataset.testPoints, baseY);

    // ── Métrique de succès #1 : écart résiduel — remesh vs baseline mesh Delaunay brut ──
    // Comparaison en VALIDATION CROISÉE : dataset.testPoints n'ont jamais été donnés à
    // Agent 2/3/4. Pour chacun, on interpole la hauteur du maillage Delaunay BRUT (Agent 2,
    // barycentrique dans le triangle contenant sa position XZ) et celle du plan de remesh
    // le plus proche (Agent 4, déjà calculé ci-dessus), et on compare les deux à sa vérité
    // terrain `trueY` (connue uniquement parce que ce POC est synthétique — cf. rapport
    // final). Comparer un point à SON PROPRE sommet du maillage brut donnerait toujours un
    // résidu ≈ 0 (le sommet EST le point) : ça ne mesurerait rien, d'où la validation croisée.
    const residualRawVsTruth_m = meanAbsResidual(dataset.testPoints, (pt) => {
      const h = baryHeightOnRawMesh(building.roofPositions, building.roofIndices, pt.x, pt.z);
      return h == null ? null : Math.abs(pt.y - h);
    });

    // ── Agent 5 — TreeDetectLidar (_detectLiDAR(), réutilisation directe) ────
    log('Agent 5 · TreeDetectLidar — VegetationDetection._detectLiDAR()');
    const cfg = { ...VEG_CFG_DEFAULTS };
    const candidates = await VegetationDetection._detectLiDAR(dataset.cosiaBbox4326, dataset.centroid, cfg, 'poc-session');

    // ── Agent 6 — SatCrossCheck (nouveau) ─────────────────────────────────────
    log('Agent 6 · SatCrossCheck — croisement masque COSIA synthétique');
    const altitude = PILOT_ZONE.groundAltitude_m; // proxy simple pour ce POC (littoral Le Port)
    const biome = 'tropical-reunion';
    const crossCheck = await satCrossCheck(candidates, dataset.cosiaImageData, dataset.cosiaBbox4326, altitude, biome, {});

    const meta = {
      zone: { city: PILOT_ZONE.city, cleabs: PILOT_ZONE.cleabs, centroid: dataset.centroid },
      generatedAt: new Date().toISOString(),
      seed,
      assumptions: [
        'Nuage de points LiDAR et raster COSIA SYNTHÉTIQUES (aucun accès réseau IGN pendant ce POC).',
        `Bruit LiDAR simulé : gaussien, sigma=${PILOT_ZONE.noiseSigma_m} m.`,
        'Vérité terrain toiture connue uniquement parce que les données sont synthétiques.',
      ],
      metrics: {
        toiture: {
          residualRawVsTruth_m: residualRawVsTruth_m != null ? Math.round(residualRawVsTruth_m * 1000) / 1000 : null,
          residualRemesh_m: remesh.residualM != null ? Math.round(remesh.residualM * 1000) / 1000 : null,
          ameliorationPct: (residualRawVsTruth_m && remesh.residualM)
            ? Math.round((1 - remesh.residualM / residualRawVsTruth_m) * 1000) / 10
            : null,
          shapeDetectee: remesh.shape ?? null,
          pointsEntrainement: dataset.roofPoints.length,
          pointsTestCroise: dataset.testPoints.length,
        },
        vegetation: {
          candidatsAgent5: candidates.length,
          valides: crossCheck.stats.validatedCount,
          rejetes: crossCheck.stats.rejectedCount,
          tauxRejetPct: crossCheck.stats.rejectionRate,
          fauxPositifsConnus: dataset.falsePositives.length,
          vraisArbresConnus: dataset.groundTruthTrees.length,
        },
      },
    };

    return {
      buildings: [{
        footprint: building.footprint,
        rough: { positions: building.roofPositions, indices: building.roofIndices, height: building.height },
        decimation,
        remesh,
      }],
      trees: { candidates, validated: crossCheck.validated, rejected: crossCheck.rejected },
      dataset, // exposé pour le rendu Three.js (points bruts, vérité terrain, masque COSIA)
      meta,
    };
  } finally {
    restoreStubs();
  }
}
