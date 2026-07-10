---
name: lidar-terrain-3d
description: >-
  Chaîne terrain 3D 100% navigateur (vanilla JS, zéro backend) du repo TERLAB : lecture LiDAR HD IGN COPC/LAZ via range requests HTTP, MNT BIL float32, maillage terrain, isolignes Marching Squares, coupes/profils altimétriques en cascade, extrusion bâti et export CAO. Patterns clés : getter copc.js signature (begin, end), hook fetch laz-perf.wasm vers CDN jsDelivr, cache IndexedDB Float32Array(7) points+mesh, cascade profil LiDAR HD→IGN→Mapbox DEM, classes ASPRS 2/3/4/5/6, CHM height-above-ground avec normalisation groundZ, signature palmier (peak sharpness + trunk hollowness), tables pente 5 classes (topo-case-service + coupe-renderer), convention Three.js rotation X=-PI/2 (cf. skill coord-systems double-flip), THREE via window.THREE ?? import (namespace ESM gelé), importmap three@0.182 épinglé. Déclencheurs — LiDAR, COPC, laz-perf, LAZ, MNT, BIL, TIN, Delaunay, isolignes, courbes de niveau, coupe, profil, section A/B, pente, terrain 3D, ExtrudeGeometry, GLB, GLTFExporter, DXF, IFC, classes LiDAR, CHM, palmier, Overpass OSM, Mapbox DEM, IGN WFS.
---

# lidar-terrain-3d — Terrain & LiDAR navigateur (TERLAB)

TERLAB = vanilla JS client-side, déployable sur GitHub Pages, aucun serveur PDAL/Python requis en prod. Pointeurs `fichier:ligne` vérifiés dans `C:\GITHUB\TERLAB` (2026-07).

## 1. Lecture COPC navigateur (LiDAR HD IGN)

`utils/copc-reader.js` — lecture octree COPC via HTTP range requests.
- **Getter signature `(begin, end)` → Uint8Array** (copc.js appelle `get(begin, end)`, PAS `(offset, length)`). Impl : `utils/copc-reader.js:17`, header `Range: bytes=${begin}-${end-1}` `:25`, slice `:48`. Retry/429/timeout.
- Hiérarchie : `Copc.loadHierarchyPage(getter, info.rootHierarchyPage)` `:97` — passer `info.rootHierarchyPage`, PAS `info` (sinon fetch du fichier complet ~92 Mo au lieu de ~47 Ko).
- Décodage : `Copc.loadPointDataView` `:134`, dimensions `view.getter('X'|'Y'|'Z'|'Classification'|'Red'|'Green'|'Blue')` `:141-150`.
- **laz-perf WASM** : Emscripten résout `document.currentScript.src` = null en ES module → 404 sur `laz-perf.wasm`. Fix = hook `fetch()` dans `index.html:25-33` (script classique AVANT imports) qui redirige vers `cdn.jsdelivr.net/npm/laz-perf@0.0.7/lib/laz-perf.wasm` (`CDN_WASM` `index.html:29`).
- Importmap `index.html` : `three@0.182.0` `:17`, `copc@0.0.8` `:21` (ESM, dépend de laz-perf@0.0.7).
- Stack overflow : jamais `arr.push(...pts)` sur 200k+ pts → boucle `for`.
- CORS IGN HD : OK sans proxy.

## 2. Service LiDAR & classes ASPRS

`services/lidar-service.js` — `getPointsForParcel(geojson, marginM, {classes, maxPoints})` `:132`, défaut `classes='2'` `:136`. Auto `_fetchViaBrowser` (COPC) `:114` → fallback `_fetchViaServer` (PDAL) `:90`. `setRawPoints(points, classes)` `:29`, `getProfileFromPoints(points, start, end, corridorWidth=5)` `:226`.

Classes ASPRS utilisées : `1` unclassified, `2` ground, `3` low veg (<0.5 m), `4` medium veg (0.5–2 m), `5` high veg (>2 m), `6` building, `9` water.
- Pente / MNT / altimétrie → **classe 2 uniquement**.
- Contexte 3D nuage → `'2,3,4,5,6'`.
- Toits (voisinage P05) → classe 6 ; végétation (P06) → `'3,4,5'`.
- Cap 200 000 pts, LOD par distance caméra. Colorisation par classe : `PointsMaterial({vertexColors:true, size:0.3})`, caméra plongée ~+38° (`camera.y ≈ r×1.4`).

## 3. Cache IndexedDB (points + mesh)

`services/lidar-cache.js` (`window.LidarCache`). Clef composite `sessionId:bboxHash(geojson):classes`. Sérialisation : `Float32Array(n*7)` = (lng, lat, z, r, g, b, cls) `:67-70`, ≈ 8 Mo / 300k pts. Stores IDB `points` + `mesh`.
- `putPoints({sessionId, geojson, classes, points, meta})` `:96`, `getPoints(...)` `:115` (lire AVANT tout `getPointsForParcel` coûteux — 30–60 s de recompute).
- `putMesh(...)` `:134` (position/color/uv/index en TypedArrays), `rebuildMesh(record)` `:172` → THREE.Mesh MeshStandardMaterial DoubleSide.
- bbox parcelle stable entre phases → clef réutilisable P01→P11.

## 4. MNT BIL & maillage terrain 3D

`services/bil-terrain.js` — `buildMesh(wgsBounds, opts)` `:103`. BIL float32 IGN (MNT 1 m), `PlaneGeometry(w,h,cols-1,rows-1)`, Z par-vertex. THREE via `window.THREE ?? await import(...)` `:105`.
Modes texture : `elevation` (LUT altitude), `slope` (LUT norme pente), `ortho` (drape orthophoto IGN WMS), `satellite` (Mapbox baked).

## 5. Isolignes (Marching Squares)

`services/contour-service.js` — `fromBIL(wgsBounds, opts)` `:331`, algo `_marchingSquares(heights,W,H,level)` `:232`. `toGeoJSON(data)` `:444` (rendu 2D Mapbox line+symbol), `toThreeGroup(data, utmBounds, opts)` `:463` (projection sur mesh via raycaster). Variante projet : `fromBILWithProject(...)` `:650`. Cache : `services/contour-cache.js` (`ContourCache.loadOrGet`).
Intervalles dynamiques selon dénivelé : 0.5 m (<5 m total), 1 m normal, 5 m forte pente, 10 m (>100 m). Majeures (multiples 5/10 m) labellisées, mineures semi-transparentes. Toggle idempotent (try-catch).

## 6. Coupes / profils — cascade altimétrique

`components/section-profile-viewer.js` — `computeSectionAxes(geojson, orientation, center)` `:39` (A longitudinal / B perpendiculaire). Extraction profil `:75-97` :
1. **LiDAR HD** `LidarService.getProfileFromPoints(lidarPoints, start, end, 8)` `:82-83`.
2. Fallback **Mapbox DEM** `:97` (source `mapbox.mapbox-terrain-dem-v1`, cf. `components/map-viewer.js`).
Annotations routes via `map.queryRenderedFeatures` `:146` ; scatter LiDAR par classe superposé `:263+`. Label source `lidar_hd | ign_api | DEM` `:345`. « Aucune coupe vide » : toujours rendre, la pédagogie prime sur la précision.

## 7. Tables pente — 5 classes (VALEURS VÉRIFIÉES, priment sur les mémoires)

`services/topo-case-service.js` `TOPO_CASES` `:22` (ids `flat|gentle|medium|steep|extreme`) :

| id | profMax | systemType |
|----|---------|------------|
| flat | 15 | standard |
| gentle | 12 | soubassement |
| medium | 10 | deblai_remblai |
| steep | 8 | pilotis |
| extreme | 6 | pilotis_long |

`utils/coupe-renderer.js` `TOPO_CLASSES` `:26` (rendu SVG coupe, badge `:484-489`) :

| id | label | maxPct | profMax | pilotis | mult coût | color |
|----|-------|--------|---------|---------|-----------|-------|
| flat | Plat | 5 | 15 | non | 1.0 | #16a34a |
| gentle | Douce | 15 | 13 | non | 1.1 | #65a30d |
| medium | Modérée | 30 | 10 | oui | 1.3 | #d97706 |
| steep | Forte | 50 | 8 | oui | 1.6 | #ea580c |
| xtrm | Extrême | 999 | 6 | oui | 2.1 | #dc2626 |

`classifySlope(pct)` = premier `maxPct >= pct`. Ces deux tables divergent légèrement (systemType, profMax gentle 12 vs 13) : elles vivent dans deux fichiers distincts — synchroniser si cohérence pédagogique requise (auto-plan-engine devrait partager).

## 8. Végétation LiDAR & signature palmier

`services/vegetation/vegetation-detection.js::_detectLiDAR` `:216` — lit `LidarCache.getPoints({classes:'2,3,4,5,6,9'})` (pas COPCReader, absent en browser).
- **Normaliser Z en height-above-ground** : `p.z -= groundZ` (groundZ = altitude sol classe 2, `:224`). CRITIQUE : sans ça la condition CHM `minH < h*0.45` ne se déclenche jamais sur altitudes NGF absolues (+300 m) → tous les arbres fusionnent.
- CHM grid ~0.5 m, local-maxima, radius-shrink.

Signature palmier (sans CNN) → `f.palmLikelihood ∈ [0..1]` :
- **Peak sharpness** : à ~2 m du sommet, palmier chute 60–80 % (fronds étroits), feuillus 10–30 %.
- **Trunk hollowness** : tronc nu, pts LiDAR entre 1 m et 0.6·h quasi absents (palmier 0.7–0.95 vs feuillus 0.3–0.5).
- `palmLikelihood = clamp((sharpness-0.4)*1.2 + (hollow-0.5)*1.0, 0, 1)`.

`services/vegetation/vegetation-species.js::suggestSpecies(h, r, alt, biome, max, opts)` `:141` — `opts.palmLikelihood` `:146`, `opts.isCoastal`. Bonus `sp.isPalm ? score += palm*0.35` `:165`, malus sinon. Appel : `vegetation-detection.js:85-88`. Ne distingue pas cocotier/latanier/royal palm entre eux (même signature).

## 9. Bâti 3D & export CAO

- `services/buildings-service.js` fetch Overpass/BDTOPO IGN WFS `:66`.
- `components/buildings-3d-viewer.js` : `ExtrudeGeometry(shape, extrudeSettings)` `:444`, hauteur `height || levels*3.0 || 6`, export `new GLTFExporter().parse(scene)` `:677`. Vraie géométrie (≠ Mapbox fill-extrusion 2.5D non exportable).
- Export DXF R2000 : `workers/dxf-worker.js` (3DFACE terrain/bâti, layers `TERRAIN`/`BATI_VOISIN`/`PARCELLE`, origine locale UTM40S, slugify NFD noms communes).
- Export IFC 2x3 : `workers/ifc-worker.js` (BuildingElementProxy + PropertySet, web-ifc@0.0.57 réf `:406`). Terrain non inclus en IFC → fourni en DXF compagnon.

## 10. Conventions Three.js (pièges)

- **Rotation X=-PI/2** appliquée au niveau mesh/composant (BIL X=easting, Y=northing, Z=altitude → Y-up) : `utils/terlab-mat-utils.js:1116,1229` (`geo.rotateX(-Math.PI/2)`), `components/buildings-3d-viewer.js:362,450,542`, `components/gabarit-3d.js` (multiples). Après rotation : `pos.getY()`=altitude, composante pente = `normal.z` (PAS `.y`). Ne PAS re-flipper — cf. skill `coord-systems` (double-flip / axial remap).
- **Namespace ESM gelé** : `import * as THREE from 'three'` crée un Module Namespace Object FROZEN → `THREE.OrbitControls = …` échoue silencieusement. Cloner (`Object.assign({}, ns)`) ou exporter les addons séparément. Usage direct : `buildings-3d-viewer.js:7`, `bimshow-viewer.js:8`.
- **window.THREE fallback** (éviter double bundle quand BIMSHOW a déjà chargé Three) : `const THREE = window.THREE ?? await import('…three@0.182.0…')` — `bil-terrain.js:105`, `background-terrain.js:12`, `gabarit-3d.js` (nombreux). S'applique aussi à OrbitControls, GLTFLoader, Mapbox GL, laz-perf, copc. Version épinglée `three@0.182.0` partout (importmap).

## À vérifier

- **TIN Delaunay contraint par breaklines** : la mémoire cite `services/terrain-tin-service.js` — **fichier absent**, aucune dépendance `delaunator` confirmée. Feature non implémentée (aspirationnelle) ou renommée/supprimée. Le maillage terrain actuel = `PlaneGeometry` (bil-terrain), pas de TIN adaptatif. Export DXF 3DFACE existe (dxf-worker) mais alimenté autrement.
- Section A/B : `services/section-profile-viewer.js` (chemin des mémoires) n'existe pas → réel = `components/section-profile-viewer.js`. Le fallback intermédiaire « IGN WFS altimétrie » entre LiDAR et Mapbox DEM n'est pas explicite dans le fichier vérifié (seuls LiDAR + Mapbox DEM confirmés ; label `ign_api` présent → vérifier la branche).
- Table pente : divergence `topo-case-service` vs `coupe-renderer` (profMax gentle 12 vs 13, systemType) non résolue en code — confirmer laquelle fait autorité avant toute synchro cross-phases.
