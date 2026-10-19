// TERLAB · tools/roof-remesh-poc/sat-cross-check.js · Agent 6 — SatCrossCheck
// Pipeline, sur le patron de services/parking-detection.js::detect() (seul exemple existant
// dans le repo d'un croisement LiDAR × imagerie satellite classifiée) : pour chaque arbre
// candidat d'Agent 5 (TreeDetectLidar, détection par pics de hauteur sur le CHM LiDAR —
// approximative par construction), on échantillonne le masque végétation COSIA autour de sa
// position et on calcule un ratio de pixels "verts" dans son rayon de canopée — exactement le
// même rôle que `groundRatio` dans parking-detection.js (qui, lui, croise un masque COSIA
// pavé avec un ratio de CLASSES LiDAR sol/bâti ; ici on croise un masque COSIA végétation
// avec la SEULE POSITION+RAYON du candidat, puisque Agent 5 ne fournit pas de polygone).
// Le masque lui-même est calculé par VegetationDetection._cosiaVegetationMask(), réutilisée
// telle quelle (même seuil greenDom que la détection OBIA/COSIA réelle). L'espèce suggérée
// des arbres validés vient de VegetationSpecies.suggestSpecies(), réutilisée telle quelle.
//
// @coords  Entrée candidats : {x,y} locaux, y=SUD-positif (même repère que synthetic-data.js
//          et vegetation-detection.js::wgs84ToLocal). Masque raster : pixels (px,py) avec
//          origine haut-gauche = coin NORD-OUEST du bbox WGS84 fourni — même convention que
//          _cosiaVegetationMask/_pavedMask (WMS GetMap classique, py croît vers le sud).

import VegetationDetection from '../../services/vegetation/vegetation-detection.js';
import VegetationSpecies from '../../services/vegetation/vegetation-species.js';
import { M_PER_DEG_LAT, mPerDegLng } from '../../utils/geo-constants.js';

/**
 * Agent 6 — valide/rejette les candidats d'Agent 5 par croisement avec un masque COSIA.
 * @param {Array} candidates      sortie d'Agent 5 (TreeDetectLidar) : {position:[lng,lat], canopyRadiusMeasured, heightMeasured, palmLikelihood, ...}
 * @param {{data,width,height}} cosiaImageData   raster COSIA (réel via WMS, ou synthétique en POC hors-ligne)
 * @param {[number,number,number,number]} bbox4326  bbox du raster [minLng,minLat,maxLng,maxLat]
 * @param {number} altitude  altitude du site (pour suggestSpecies)
 * @param {string} biome     biome (pour suggestSpecies)
 * @param {{minVegRatio:number}} opts
 * @returns {{ validated, rejected, stats }}
 */
export async function satCrossCheck(candidates, cosiaImageData, bbox4326, altitude, biome, opts = {}) {
  const minVegRatio = opts.minVegRatio ?? 0.25;
  await VegetationSpecies.load();

  const mask = VegetationDetection._cosiaVegetationMask(cosiaImageData); // réutilisation directe, non modifiée
  const { width: W, height: H } = cosiaImageData;
  const [minLng, minLat, maxLng, maxLat] = bbox4326;
  const refLat = (minLat + maxLat) / 2;
  const pxToM = (maxLng - minLng) * mPerDegLng(refLat) / W;
  const lngToPx = (lng) => ((lng - minLng) / (maxLng - minLng)) * W;
  const latToPy = (lat) => ((maxLat - lat) / (maxLat - minLat)) * H;

  const validated = [];
  const rejected = [];

  for (const cand of candidates) {
    const [lng, lat] = cand.position;
    const cx = lngToPx(lng), cy = latToPy(lat);
    const rPx = Math.max(1, Math.round((cand.canopyRadiusMeasured || 2) / pxToM));

    // ── ratio de pixels végétation dans le disque de canopée (même logique que
    // groundRatio de parking-detection.js, appliquée à un masque vert plutôt qu'à des
    // classes LiDAR) ──────────────────────────────────────────────────────────────
    let green = 0, total = 0;
    const x0 = Math.max(0, Math.floor(cx - rPx)), x1 = Math.min(W - 1, Math.ceil(cx + rPx));
    const y0 = Math.max(0, Math.floor(cy - rPx)), y1 = Math.min(H - 1, Math.ceil(cy + rPx));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px - cx, dy = py - cy;
        if (dx * dx + dy * dy > rPx * rPx) continue;
        total++;
        if (mask[py * W + px]) green++;
      }
    }
    const vegRatio = total > 0 ? green / total : 0;
    const out = { ...cand, vegRatio: Math.round(vegRatio * 100) / 100, confidence: Math.round(vegRatio * 100) / 100 };

    if (total === 0 || vegRatio < minVegRatio) {
      rejected.push({ ...out, rejectReason: total === 0 ? 'hors raster COSIA' : `masque végétation trop faible (${(vegRatio * 100).toFixed(0)}% < ${(minVegRatio * 100).toFixed(0)}%)` });
      continue;
    }

    const isCoastal = typeof altitude === 'number' && altitude < 100;
    const speciesCandidates = VegetationSpecies.suggestSpecies( // réutilisation directe, non modifiée
      cand.heightMeasured ?? 10, cand.canopyRadiusMeasured, altitude, biome, 3,
      { palmLikelihood: cand.palmLikelihood || 0, isCoastal },
    );
    validated.push({
      ...out,
      speciesCandidates,
      speciesKey: speciesCandidates[0]?.speciesKey,
      speciesConfidence: speciesCandidates[0]?.score,
    });
  }

  const total = candidates.length;
  const stats = {
    total, validatedCount: validated.length, rejectedCount: rejected.length,
    rejectionRate: total ? Math.round((rejected.length / total) * 1000) / 10 : 0,
  };
  return { validated, rejected, stats };
}
