---
name: vegetation-bpf
description: >
  Chaîne TERLAB de détection et rendu de la végétation existante + amenities paysagers sur le plan masse, sans relevé terrain. Détecte canopées et espèces depuis ortho/COSIA IGN + LiDAR HD (COPC), classe par espèce probable (33 espèces Réunion), distingue palmiers par pure géométrie LiDAR (peak sharpness + trunk hollowness, PAS de CNN), place la végétation en Poisson disk avec guard 1 ha, détecte les surfaces minérales (parking/terrasses) par masque gris COSIA + OBB PCA + validation classes LiDAR 2 vs 6, et rend en symboles top-view BPF (color2D/flowerColor) sur SVG + Mapbox. Pont bpf-bridge auto-plantation + 8 amenities. Vanilla JS, offline-first. Utiliser dès qu'on touche à la détection végétation P06, au différentiel esquisse P11, au plan masse végétal P07, aux palmiers/cocotiers ou aux surfaces imperméables. Déclencheurs — végétation, canopée, OBIA, NDVI, MNH, CHM, COSIA, espèces, cocotier, palmier, latanier, Poisson disk, plantation, plan masse végétal, BPF, plant factory, arbres, amenities, parking, surfaces minérales, top-view, color2D, différentiel abattage.
---

# vegetation-bpf — détection & rendu végétation TERLAB (P06/P07/P11)

Service vanilla JS, offline-first. Repo `C:\GITHUB\TERLAB`. Toutes les réf. `fichier:ligne` ci-dessous sont vérifiées.

## Architecture des fichiers
- Détection : `services/vegetation/vegetation-detection.js` (`VegetationDetection`)
- Classif espèces : `services/vegetation/vegetation-species.js` (`VegetationSpecies`)
- État/sync : `services/vegetation/vegetation-state.js`
- Rendus/exports : `vegetation-svg-plan.js`, `vegetation-mapbox.js`, `vegetation-export.js`
- Symboles top-view : `services/vegetation/topview-symbols.js` (chargé **non-module** dans `index.html:67`, expose `window.TopViewSymbols.generateForDNA` + `window.generateForDNA/suggestStyle`, cf. `topview-symbols.js:12-15,344,370`)
- Auto-plantation + amenities : `services/bpf-bridge.js` (`BpfBridge`)
- Surfaces minérales : `services/parking-detection.js` (`ParkingDetection`)
- DB : `data/bpf-species-reunion.json` — **33 espèces**, 8 amenities, 9 gardenPatterns
- Composants : `components/vegetation/vegetation-p06-panel.js`, `.../vegetation-p11-toolbar.js`, `components/esquisse-canvas.js`
- Phases : `phases/p06-biodiversite.html`, `phases/p07-esquisse.html`, `phases/corpus-viewer.html`

## Chaîne de détection végétation (P06)
`VegetationDetection.detect()` → `_detectCOSIA()` (primaire, `vegetation-detection.js:66,110`), fallback `_detectOBIA()` (NDVI maison, `:173`, appelé si COSIA WMS tombe `:124,131`). Sources `'cosia'` et `'obia'` routent toutes deux vers COSIA.
1. **Masque vert COSIA** (couche IGN pré-classée IA `IGNF_COSIA_2021-2023`, WMS `data.geopf.fr/wms-r/wms`, EPSG:4326, 1024px) : `greenDom = G > R+10 && G > B+10 && G > 50` ET `notOliveCrop = !(R>150 && G>150 && B<120 && |R-G|<40)` → exclut cultures/vignes/sol/eau/bâti (`vegetation-detection.js:166-168`). Plus fiable que NDVI (qui rendait souvent 0 arbre sur terrains réels Réunion).
2. **MNH / CHM LiDAR** : LidarCache classes `2,3,4,5,6,9` (`:232`), `groundZ` = min Z classe 2 pour normaliser le CHM en hauteur-au-sol (prérequis impératif des signatures).
3. **Fusion** : polygones canopée + hauteur → pour chaque pic, `suggestSpecies(h, r, alt, biome, n, {palmLikelihood, isCoastal})` (`:85-88`).
4. Classif probabiliste par hauteur + rayon canopée + altitude + biome sur les 33 espèces (`vegetation-species.js:141`).

## Signature palmier (PAS de CNN — pure géométrie LiDAR)
Distingue palmier (cocotier/latania/acanthophoenix…) d'un feuillu, robuste toutes versions IGN HD.
1. **Peak sharpness** `_peakSharpness()` (`vegetation-detection.js:371`) : chute du CHM sur anneau à ring=2 cellules (~2 m). Palmier 0.6-0.8 · feuillu 0.1-0.3 · bosquet ~0.
2. **Trunk hollowness** `_trunkHollowness()` (`:393`) : creux du tronc nu, pts entre 1 m et 0.6·h quasi absents. Palmier 0.7-0.95 · feuillu 0.3-0.5. `return canopyPts/(canopyPts + trunkPts*3)`.
3. **Combine** (`:345`) : `palmLikelihood = clamp((sharpness-0.4)*1.2 + (hollow-0.5)*1.0, 0, 1)`.
4. **Biais** dans `suggestSpecies` (`vegetation-species.js:146,165`) : `sp.isPalm` → score `+= palm*0.35` (malus sinon). 8 espèces `isPalm` dans la DB. Ne distingue pas les palmiers entre eux (même signature) → tri final par altitude/biome/taille.

## Poisson disk + guard 1 ha (bpf-bridge, P07)
`BpfBridge.generate()` (`services/bpf-bridge.js`) : parcelle polygonale → décomposition zones via `_offsetPolygonPerEdge()` (voie/fond/lat, `:203,301`) → amenities d'abord (`_placeAmenities` `:374`, priorité `['terrasse','pergola','piscine','kiosque','cuisine_ext','potager','tisanerie','bassin']` `:447`) → végétation **Poisson disk** (pas grille) avec distance min = max(densité pattern, inter-distance réglementaire), exclusions bâtiment+amenities+reculs (`:646-654`).
**Guard** : `MAX_PARCEL_AREA = 10000` m² (1 ha), au-delà on bloque (`:10`) — sinon le scatter explose.
UI P07 : bouton « Générer la végétation » `phases/p07-esquisse.html:91` → `P07.generateVegetation()` (`:2707`) → `EsquisseCanvas.generateVegetation()` + `BpfBridge.toGeoJSON()` (`:2714,2721`) → layers Mapbox GL.

## Pont BPF & rendu top-view
Chaque espèce du JSON porte `svgSymbol` (palm/broadleaf/conifer/bamboo/shrub/tropical_shrub + variantes `_flower`), `color2D` (feuillage botanique, 33/33), `flowerColor` (10/33). Lookup runtime `plant.svgSymbol ?? 'broadleaf'`, `plant.color2D` fallback par symbole (`esquisse-canvas.js:2660-2664`). Switch de dessin `_drawPlantSVG()` (`:2659`) : grass=brins radiants, shrub/tropical_shrub=lobes (`:2724`), broadleaf=points FBM, palm/conifer/bamboo dédiés ; pastilles fleurs si `flowerColor` et r>5 (`:2767-2771`). Amenities dessinés par `am.svgSymbol` (`:2415`). `topview-symbols.js` génère aussi les symboles BPF depuis un DNA (`generateForDNA` `:370`, `suggestStyle` `:344`). Même pattern `color2D`/`flowerColor` que `bimshow-plant-factory-angular`.

## Détection surfaces minérales (parking/terrasses, P06)
`ParkingDetection.detect(bbox, centroid, sessionId)` (`services/parking-detection.js`, retour `{polygon, area_m2, aspectRatio, groundRatio}` `:13`).
1. **COSIA WMS** 1024px.
2. **Masque gris neutre** : `spread = max(R,G,B)-min(R,G,B) < 25` ET `mid=(R+G+B)/3 ∈ [70..185]` (`:108-110`).
3. **Blobs** `_labelBlobsWithPixels()` BFS 4-connexité, min 30 px (`:46,115`).
4. **OBB via PCA** `_orientedBox()` : covariance → angle principal → 4 coins rotés (`:61,147`).
5. **Filtre forme** : `aspectRatio < maxAspectRatio` (~3.5) → rejette allées étroites (`:63-64`).
6. **Validation LiDAR classe 2 (sol) vs classe 6 (bâti)** : `groundRatio = ground/total`, rejet si majoritairement toit (`:74-85`) — écarte les toits gris mal classés COSIA (~90 % des cas), **nécessite LiDAR chargé**.
7. Filtre aire > 15 m².
Rendu `renderOnMap()` (`:221`) : `parking-fill` #4a4a4a op.0.45 + `parking-stroke` #2a2a2a dash [2,2] ; `removeFromMap()` (`:261`).
UI P06 : bouton « Détecter les surfaces minérales » `phases/p06-biodiversite.html:85` → `P06.detectParking()` (`:355-371`). Prérequis LiDAR auto-load classes `2,3,4,5,6,9`.

## Validation humaine & différentiel (P06/P11)
- P06 : `vegetation-p06-panel.js` — select source, option `cosia` « COSIA IGN (segmentation IA) » (`:165`), défaut `'obia'` (`:64`) ; l'étudiant confirme/corrige.
- P11 : `vegetation-p11-toolbar.js` — calque différentiel **keep/cut/new** (abattage/plantation) via `EsquisseCanvas._project()` (`:8-9`), toolbar toggles + « Tableau plantation » (`:154`).

## État & persistance
`vegetation-state.js` — RTDB path **`terlab/sessions/{sessionId}/vegetation`** (`:5`), mirror offline-first `SessionManager._data.phases.p06.vegetation` (`:6,156`). Globals requis : `TerlabMap`, `SessionManager`, `TERLAB_DB`/`TERLAB_FB_REF/SET/GET`, `TERLAB_UID`, `ThemeSwitcher`, `EsquisseCanvas._project()`. CSS tokens dans `assets/terlab-v2-additions.css`. Overlay COSIA aussi dans `phases/corpus-viewer.html:806-817` (op.0.50).

## Pièges
- Z LiDAR **doit** être normalisé hauteur-au-sol (soustraire `groundZ`) sinon signatures palmier invalides.
- Validation parking exige le LiDAR en cache (auto-load init P06).
- OBB PCA sur allée en L/U trace un seul rectangle englobant (pas de morpho ouverture/fermeture).
- Palette COSIA calibrée 2021-2023 ; recalibrer masques si IGN sort une v2024.
- Guard 1 ha bloquant : parcelles >10 000 m² non traitées.

## À vérifier
- Les memories citaient **35 espèces** ; le JSON en contient **33** (`data/bpf-species-reunion.json`, clés latines/EN : `mango`, `plumeria`, `flamboyant`, `palm_coconut`…, pas `manguier`/`frangipanier`).
- Champ de forme réel = **`svgSymbol`** (+ `growthForm`), pas `growth_form` comme écrit dans la memory SVG.
- Memory `project_vegetation_bpf_v5` annonçait le path RTDB `terlab/users/{uid}/terlabProjects/{sid}/vegetation` ; le code actuel utilise `terlab/sessions/{sessionId}/vegetation` (fallback non-authentifié à confirmer).
- Masque vert COSIA : le code n'applique **pas** de test alpha `A>128` (présent dans la memory `skill_cosia_ign_detection`).
- Hors scope confirmé : `impostor-bridge.service.ts` (pont BIMSHOW 3D) et pré-génération 30 GLB LOD2 (Option B) non intégrés.
