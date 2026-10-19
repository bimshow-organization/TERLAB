// TERLAB · tools/roof-remesh-poc/skeleton-remesh.js · Agent 4 — SkeletonRemesh
// Pipeline : plans dominants (Agent 3, BuildingReconstruction.decimateRoof) + footprint
// (Agent 2, BuildingReconstruction.reconstruct) → un poids par arête du footprint dérivé de
// la pente du plan dominant le plus proche → weightedSkeleton() (squelette droit pondéré,
// services/toiture/weighted-skeleton.js, non modifié) → lift() en 3D → buildPanels/planesOf/
// classifyEdges (services/toiture/audit.js, non modifiés) pour reconstruire une toiture
// propre. Identification de forme par comptage pignons/uniformité de pente (comparée aux
// noms du catalogue services/toiture/tiers.js — pavillon/croupe simple, toit deux pans,
// demi-croupe ; buildTieredRoof() lui-même n'est pas appelé ici car il vise les toits à
// PALIERS MULTIPLES (mansarde etc.), hors périmètre d'un squelette single-tier). Sortie :
// mesh toiture propre + type détecté + écart résiduel = distance moyenne des points LiDAR
// bruts au plan de toit du remesh le plus proche (ne nécessite aucune vérité terrain — c'est
// la métrique utilisable en production sur données réelles).
//
// @coords
//   project:   TERLAB
//   plan:      XY (footprint building-reconstruction, y=SUD-positif) → XZ (weighted-skeleton,
//              z=NORD-positif, cf. services/toiture/geom2d.js header)
//   yAxis:     n/a (2D pur ; l'altitude est skel.nodes[].t, portée séparément)
//   anchor:    local(0,0) — mètres locaux hérités de reconstruct()
//   units:     meters
//   bearing:   none
//   north:     none
//   pairsWith: services/building-reconstruction.js (footprint), services/toiture/weighted-skeleton.js
//   roundtrip: footprintToSkeletonPoly / skeletonPolyToFootprint sont inverses exactes (testées ci-dessous)
//
// PIÈGE (cf. skill coord-systems, même famille que le pitfall #2 MNT/polygon.y) :
// building-reconstruction produit footprint.y = point.z, positif VERS LE SUD (commentaire
// _delaunayRoof: "Positions Float32 pour Three.js … z=-north"). weighted-skeleton.js déclare
// son polygone Pt2=[x,z] avec z positif VERS LE NORD (geom2d.js header). Le flip (y → -y) est
// fait UNE SEULE FOIS ici, dans footprintToSkeletonPoly() ; ne JAMAIS reflipper plus loin.

import { weightedSkeleton, lift } from '../../services/toiture/weighted-skeleton.js';
import { buildPanels, planesOf, classifyEdges, auditSkeleton } from '../../services/toiture/audit.js';
import { classerDomaine } from '../../services/toiture/build-roof.js';
import { cotDeg, pitchFromWeight } from '../../services/toiture/edge-modes.js';

/** footprint building-reconstruction ({x,y}, y=sud) → polygone weighted-skeleton ([x,z], z=nord). */
export function footprintToSkeletonPoly(footprint) {
  return footprint.map((p) => [p.x, -p.y]);
}
/** Inverse exacte. */
export function skeletonPolyToFootprint(poly) {
  return poly.map(([x, z]) => ({ x, y: -z }));
}
// @coords-roundtrip — fail loud (protocole coord-systems §4)
(function roundtripTest() {
  const samples = [{ x: 0, y: 0 }, { x: 12.3, y: -4.5 }, { x: -8, y: 30.2 }, { x: 0.001, y: -0.001 }];
  const poly = footprintToSkeletonPoly(samples);
  const back = skeletonPolyToFootprint(poly);
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(back[i].x - samples[i].x) > 1e-9 || Math.abs(back[i].y - samples[i].y) > 1e-9) {
      throw new Error(`[skeleton-remesh] round-trip footprint↔skeleton cassé sur l'échantillon ${i}`);
    }
  }
})();

const SlopeLimits = { min: 3, max: 87 }; // évite cot(0)=Infinity / cot(90)=0 dégénérés

/**
 * Dérive un poids (s_i = cot(pente)) par arête du footprint, depuis le plan dominant
 * (Agent 3) dont le centroïde horizontal est le plus proche du milieu de l'arête.
 * Simplification assumée (POC) : proximité de centroïde seule, sans filtre de direction
 * de normale — suffisant pour une toiture convexe simple (pavillon/croupe), documenté
 * comme limitation pour des emprises en L/T/U où plusieurs plans peuvent border un même
 * segment d'arête.
 */
export function deriveWeightsFromPlanes(footprint, planes) {
  const n = footprint.length;
  const weights = new Array(n);
  const matched = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = footprint[i], b = footprint[(i + 1) % n];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; // y=sud, même repère que plane.centZ
    let best = null, bestD = Infinity;
    for (const pl of planes) {
      const d = Math.hypot(pl.centX - mx, pl.centZ - my);
      if (d < bestD) { bestD = d; best = pl; }
    }
    if (!best) { weights[i] = cotDeg(35); matched[i] = null; continue; }
    const slope = Math.min(SlopeLimits.max, Math.max(SlopeLimits.min, best.slopeDeg));
    weights[i] = cotDeg(slope);
    matched[i] = { planeIndex: planes.indexOf(best), slopeDeg: best.slopeDeg, distance: bestD };
  }
  return { weights, matched };
}

/** Identification heuristique de forme, par comparaison aux noms du catalogue tiers.js. */
function identifyRoofShape(skel, domaine) {
  const W = skel.weights;
  const nPignons = W.filter((s) => s === 0).length;
  if (nPignons === 0 && domaine.penteUniforme) return 'pavillon (croupe simple, pente uniforme — n pans)';
  if (nPignons === 0) return 'croupe (pans multiples, pentes variées)';
  if (nPignons === W.length - 2) return 'toit deux pans (pignon simple)';
  if (nPignons > 0 && domaine.penteUniforme) return 'demi-croupe (mix pignon/croupe, cf. tiers.js:demiCroupe — non étagé ici)';
  return 'toit composite (pignons + pentes variées)';
}

/**
 * Agent 4 — construit le remesh depuis les plans dominants (Agent 3) et le footprint (Agent 2).
 * @param {{footprint: Array<{x,y}>}} building   sortie d'un élément de BuildingReconstruction.reconstruct().buildings
 * @param {{planes: Array}} decimation           sortie de BuildingReconstruction.decimateRoof()
 * @param {Array<{x,y,z}>} rawPoints             points LiDAR bruts (mêmes que ceux fournis à Agent 2), pour l'écart résiduel
 * @param {number} baseY                          altitude de l'égout (mètres)
 * @returns {{ ok, skeleton, panels, edges, planes, shape, residual, lifted, meshPositions, meshIndices }}
 */
export function skeletonRemesh(building, decimation, rawPoints, baseY) {
  const footprint = building.footprint;
  const planesIn = decimation?.planes ?? [];
  if (!footprint?.length || footprint.length < 3 || !planesIn.length) {
    return { ok: false, reason: 'footprint ou plans dominants manquants' };
  }

  const { weights, matched } = deriveWeightsFromPlanes(footprint, planesIn);
  const skeletonPoly = footprintToSkeletonPoly(footprint);

  let skel;
  try {
    skel = weightedSkeleton(skeletonPoly, weights, null);
  } catch (e) {
    return { ok: false, reason: `weightedSkeleton a échoué : ${e.message}` };
  }

  const panels = buildPanels(skel);
  const planes = planesOf(skel.poly, skel.weights);
  const edges = classifyEdges(skel, panels, planes);
  const audit = auditSkeleton(skel, panels, { edges, planes });
  const domaine = classerDomaine(skel, audit, 0);
  const shape = identifyRoofShape(skel, domaine);
  const lifted = lift(skel, baseY); // [x, y, zNord] par node

  // ── Écart résiduel : distance moyenne des points LiDAR bruts au plan de toit
  // du remesh le plus proche (ne nécessite pas de vérité terrain — cf. header).
  const activePlanes = planes.filter((p) => !p.vertical);
  let sumAbs = 0, nCount = 0;
  for (const pt of rawPoints) {
    if (!activePlanes.length) break;
    const zNorth = -pt.z; // même flip que footprintToSkeletonPoly
    let best = Infinity;
    for (const pl of activePlanes) {
      const h = baseY + pl.h([pt.x, zNorth]);
      const d = Math.abs(pt.y - h);
      if (d < best) best = d;
    }
    if (isFinite(best)) { sumAbs += best; nCount++; }
  }
  const residualM = nCount ? sumAbs / nCount : null;

  // ── Mesh 3D pour rendu (fan triangulation par pan, repère scène x=est,y=alt,z=SUD) ──
  const meshPositions = [];
  const meshIndices = [];
  let vOffset = 0;
  for (const panel of panels) {
    if (panel.kind !== 'pan' || !panel.nodeIds || panel.nodeIds.length < 3) continue;
    const ids = panel.nodeIds;
    const base = vOffset;
    for (const id of ids) {
      const nd = skel.nodes[id];
      meshPositions.push(nd.x, baseY + nd.t, -nd.z); // flip retour vers SUD (repère scène)
    }
    for (let i = 1; i < ids.length - 1; i++) {
      meshIndices.push(base, base + i, base + i + 1);
    }
    vOffset += ids.length;
  }

  return {
    ok: true, skeleton: skel, panels, edges, planes, audit, domaine, shape,
    weightsMatched: matched, lifted, residualM, pointsUsedForResidual: nCount,
    meshPositions: new Float32Array(meshPositions), meshIndices: new Uint32Array(meshIndices),
  };
}
