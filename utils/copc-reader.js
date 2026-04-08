// TERLAB · utils/copc-reader.js
// Lecteur COPC client-side pour LiDAR HD IGN — zéro serveur
// Port navigateur de lidar-fetcher/copc_reader.py
// Utilise copc.js (laz-perf WASM) + HTTP range requests directes sur IGN
// ENSA La Réunion · MGA Architecture

import { Copc } from 'copc';
import UTM40S from './utm40s.js';

// ── Retry-aware HTTP Getter pour IGN (rate limit ~1 req/s, burst 10) ──
// copc.js Getter signature: (begin, end) → Promise<Uint8Array>
//   begin = offset du premier octet, end = offset après le dernier octet (exclusif)
//   Le getter doit retourner exactement (end - begin) octets.
function createIgnGetter(url, onProgress) {
  let requestCount = 0;

  return async (begin, end) => {
    const length = end - begin;
    const MAX_RETRIES = 6;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 30000); // 30s timeout par range request
        const res = await fetch(url, {
          headers: { Range: `bytes=${begin}-${end - 1}` },
          signal: ctrl.signal,
        });
        clearTimeout(timer);

        if (res.status === 429) {
          const wait = 1.5 * (2 ** attempt);
          console.warn(`[COPC] IGN 429 — retry ${attempt + 1}/${MAX_RETRIES} (${wait.toFixed(1)}s)`);
          await new Promise(r => setTimeout(r, wait * 1000));
          continue;
        }

        if (!res.ok && res.status !== 206) {
          throw new Error(`HTTP ${res.status}`);
        }

        requestCount++;
        if (onProgress) onProgress({ requests: requestCount });
        const buf = await res.arrayBuffer();

        // Si le serveur renvoie 200 au lieu de 206, extraire le segment demandé
        if (res.status === 200 && buf.byteLength > length) {
          console.warn(`[COPC] Serveur 200 au lieu de 206 — slice ${begin}..${end} sur ${buf.byteLength}`);
          return new Uint8Array(buf.slice(begin, end));
        }

        return new Uint8Array(buf);
      } catch (err) {
        if (attempt === MAX_RETRIES - 1) throw err;
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  };
}

// ── Calcul bounds d'un noeud octree à partir de sa clé ────────────────
// info.cube = [minX, minY, minZ, maxX, maxY, maxZ] (flat array)
function nodeBounds(keyParts, cube) {
  const [d, x, y, z] = keyParts;
  const size = (cube[3] - cube[0]) / (2 ** d);  // cube is flat: [minX,minY,minZ,maxX,maxY,maxZ]
  return {
    minX: cube[0] + x * size,
    minY: cube[1] + y * size,
    maxX: cube[0] + (x + 1) * size,
    maxY: cube[1] + (y + 1) * size,
  };
}

// ── Intersection 2D bbox ──────────────────────────────────────────────
function intersects2D(a, qMinX, qMinY, qMaxX, qMaxY) {
  return a.maxX >= qMinX && a.minX <= qMaxX &&
         a.maxY >= qMinY && a.minY <= qMaxY;
}

// ── Lecture des points d'une tuile COPC via bbox UTM40S ──────────────
async function readTile(url, queryMinX, queryMinY, queryMaxX, queryMaxY, options = {}) {
  const classFilter = options.classes ?? null;  // Set of class IDs, or null for all
  const maxPoints = options.maxPoints ?? 200000;
  const onProgress = options.onProgress ?? null;

  const tileId = url.split('/').pop().replace(/_PTS.*/, '');
  const getter = createIgnGetter(url, onProgress);

  // 1. Ouvrir le COPC (header + info VLR, ~65KB initial fetch)
  console.log(`[COPC] ${tileId} — ouverture header…`);
  const copc = await Copc.create(getter);
  const { info } = copc;
  console.log(`[COPC] ${tileId} — header OK, cube: ${info.cube.map(v => v.toFixed(0)).join(',')}`,
    `rootPage: offset=${info.rootHierarchyPage?.pageOffset}, length=${info.rootHierarchyPage?.pageLength}`);

  // 2. Charger la hiérarchie (Copc.loadHierarchyPage prend getter + info)
  console.log(`[COPC] ${tileId} — chargement hiérarchie…`);
  const hierarchy = await Copc.loadHierarchyPage(getter, info.rootHierarchyPage);
  console.log(`[COPC] ${tileId} — hiérarchie: ${Object.keys(hierarchy.nodes).length} noeuds`);

  // 3. Trouver les noeuds qui intersectent la bbox
  const matchingNodes = [];
  for (const [keyStr, entry] of Object.entries(hierarchy.nodes)) {
    if (entry.pointCount <= 0) continue;

    // keyStr format: "D-X-Y-Z"
    const parts = keyStr.split('-').map(Number);
    const bounds = nodeBounds(parts, info.cube);

    if (intersects2D(bounds, queryMinX, queryMinY, queryMaxX, queryMaxY)) {
      matchingNodes.push({ key: keyStr, entry, depth: parts[0] });
    }
  }

  if (matchingNodes.length === 0) return [];

  // Trier par profondeur croissante : décompresser les noeuds grossiers d'abord,
  // arrêter dès qu'on a assez de points (évite OOM sur les noeuds fins)
  matchingNodes.sort((a, b) => a.depth - b.depth);

  // Limiter la profondeur max selon le nombre de points demandés
  // Depth 5 = ~1m de résolution, largement suffisant pour 200K pts sur une parcelle
  const MAX_DEPTH = 4;
  const cappedNodes = matchingNodes.filter(n => n.depth <= MAX_DEPTH);
  console.log(`[COPC] ${matchingNodes.length} noeuds intersectent la bbox (${cappedNodes.length} retenus, depth≤${MAX_DEPTH})`);

  // 4. Charger et décoder les points de chaque noeud
  const allPoints = [];
  let loaded = 0;

  for (const node of cappedNodes) {
    if (allPoints.length >= maxPoints) break;

    try {
      const view = await Copc.loadPointDataView(getter, copc, node.entry);

      loaded++;
      // Debug noeud retiré — garder uniquement les logs de progression tuile
      if (onProgress) onProgress({ nodes: loaded, totalNodes: matchingNodes.length });

      // Préparer les extracteurs de dimensions
      const getX = view.getter('X');
      const getY = view.getter('Y');
      const getZ = view.getter('Z');
      const getCls = view.getter('Classification');

      let getRed = null, getGreen = null, getBlue = null;
      try {
        getRed   = view.getter('Red');
        getGreen = view.getter('Green');
        getBlue  = view.getter('Blue');
      } catch { /* pas de couleur dans ce fichier */ }

      // 5. Extraire les points
      for (let i = 0; i < view.pointCount; i++) {
        if (allPoints.length >= maxPoints) break;

        const cls = getCls(i);

        // Filtrer par classe
        if (classFilter && !classFilter.has(cls)) continue;

        const x = getX(i);
        const y = getY(i);

        // Filtrer par bbox (les noeuds octree peuvent déborder)
        if (x < queryMinX || x > queryMaxX || y < queryMinY || y > queryMaxY) continue;

        const z = getZ(i);

        // RGB (16-bit → 8-bit)
        let r = 0, g = 0, b = 0;
        if (getRed) {
          r = (getRed(i) >> 8) & 0xFF;
          g = (getGreen(i) >> 8) & 0xFF;
          b = (getBlue(i) >> 8) & 0xFF;
        }

        // UTM40S → WGS84
        const wgs = UTM40S.toWGS84(x, y);

        allPoints.push([
          Math.round(wgs.lng * 1e7) / 1e7,
          Math.round(wgs.lat * 1e7) / 1e7,
          Math.round(z * 100) / 100,
          r, g, b,
          cls,
        ]);
      }
    } catch (err) {
      console.warn(`[COPC] Erreur noeud ${node.key}:`, err.message);
    }
  }

  return allPoints;
}

// ── API publique : lecture multi-tuiles avec fusion ───────────────────
async function readPointsBbox(tiles, queryMinX, queryMinY, queryMaxX, queryMaxY, options = {}) {
  const maxPoints = options.maxPoints ?? 200000;
  const classFilter = options.classes
    ? (typeof options.classes === 'string' ? new Set(options.classes.split(',').map(Number)) : options.classes)
    : null;
  const onProgress = options.onProgress ?? null;

  console.log(`[COPC] readPointsBbox: ${tiles.length} tuile(s), bbox UTM [${queryMinX.toFixed(0)},${queryMinY.toFixed(0)}]→[${queryMaxX.toFixed(0)},${queryMaxY.toFixed(0)}], max=${maxPoints}`);

  const allPoints = [];
  const ptsPerTile = Math.max(Math.floor(maxPoints / Math.max(tiles.length, 1)), 10000);

  for (let t = 0; t < tiles.length; t++) {
    if (allPoints.length >= maxPoints) break;

    const tile = tiles[t];
    console.log(`[COPC] Tuile ${t + 1}/${tiles.length}: ${tile.tileId} — ${tile.url.split('/').pop()}`);
    if (onProgress) onProgress({ phase: 'tile', current: t + 1, total: tiles.length, tileId: tile.tileId });

    try {
      const tilePoints = await readTile(tile.url, queryMinX, queryMinY, queryMaxX, queryMaxY, {
        classes: classFilter,
        maxPoints: ptsPerTile,
        onProgress,
      });
      for (let i = 0; i < tilePoints.length; i++) allPoints.push(tilePoints[i]);
    } catch (err) {
      console.warn(`[COPC] Tuile ${tile.tileId} échouée:`, err.message);
    }
  }

  // Sous-échantillonnage global si nécessaire
  let finalPoints = allPoints;
  if (allPoints.length > maxPoints) {
    const indices = new Set();
    while (indices.size < maxPoints) {
      indices.add(Math.floor(Math.random() * allPoints.length));
    }
    finalPoints = [...indices].sort((a, b) => a - b).map(i => allPoints[i]);
  }

  // Calculer bounds
  let bounds = null;
  if (finalPoints.length > 0) {
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;
    let minAlt = Infinity, maxAlt = -Infinity;
    for (const p of finalPoints) {
      if (p[0] < minLng) minLng = p[0];
      if (p[0] > maxLng) maxLng = p[0];
      if (p[1] < minLat) minLat = p[1];
      if (p[1] > maxLat) maxLat = p[1];
      if (p[2] < minAlt) minAlt = p[2];
      if (p[2] > maxAlt) maxAlt = p[2];
    }
    bounds = {
      minLng: Math.round(minLng * 1e6) / 1e6,
      maxLng: Math.round(maxLng * 1e6) / 1e6,
      minLat: Math.round(minLat * 1e6) / 1e6,
      maxLat: Math.round(maxLat * 1e6) / 1e6,
      minAlt: Math.round(minAlt * 100) / 100,
      maxAlt: Math.round(maxAlt * 100) / 100,
    };
  }

  return {
    points: finalPoints,
    count: finalPoints.length,
    bounds: bounds ?? { minLng: 0, maxLng: 0, minLat: 0, maxLat: 0, minAlt: 0, maxAlt: 0 },
    tile_count: tiles.length,
    source: 'copc_browser',
  };
}

export { readPointsBbox, readTile };
export default { readPointsBbox, readTile };
