---
name: geometrie-2d
description: >-
  Patterns géométrie 2D du stack TERLAB (éditeur SVG plan-masse / esquisse P07-P11) : guards anti-self-intersection empilés en défense-en-profondeur autour de insetPolygon (winding hissé hors boucle → removeAcuteSpikes → hasSelfIntersect → return null), fallback raster marching-squares pour polygones L/T/U non-convexes quand Sutherland-Hodgman échoue, manipulation OBB par snapshot theta0 absolu + rebuild rectCentered anti-dérive, drag edge-handle perpendiculaire vs drag vertex, rendu clipPath union + fill-rule evenodd, pipeline WGS84→local mètres (rotation voie + SW(0,0) + CCW), piège AutoPlanEngine (rejet silencieux si mauvais CRS), séparation v4h constructif vs Métaforme édition (4 modules ES, flag TERLAB_USE_METAFORME). Pointeurs fichier:ligne vérifiés. Conventions d'axes 2D↔3D détaillées : voir skill user-level coord-systems. Déclencheurs — polygone, inset, offset, self-intersection, winding, spike/éperon, OBB, rotation bloc, drag vertex, edge handle, clipPath, evenodd, fill-rule, WGS84, UTM40S, EPSG:2975, proj4, heading/bearing, zone constructible, recul PLU, Métaforme, v4h, éditeur SVG, plan-masse, esquisse P07/P11.
---

# Géométrie 2D — TERLAB

Éditeur vectoriel SVG (plan-masse, esquisse P07/P11), génération auto de blocs, projection parcelles cadastrales. Conventions d'axes 2D↔3D (Y-down SVG vs Y-up THREE, double-flip, azimuth) → **skill user-level `coord-systems`**, non répété ici.

## Principe directeur : guards en défense-en-profondeur

Sur tout pipeline offset/inset/clip, **empiler** les guards, ne jamais en remplacer un par un autre tant qu'ils catchent des modes de défaillance **distincts**. Avant de « remplacer » un guard, se demander s'il catche le MÊME mode : si non → empiler.
- `dist > 3*diag` catche les divergences quasi-parallèles (intersection à l'infini).
- `removeAcuteSpikes(poly, 90)` catche les éperons aigus (intersections valides, angle < 90°).
Deux modes différents → les deux restent.

## Chaîne inset polygone (reculs PLU)

Implémentée dans `components/gabarit-engine.js`. Autour de chaque `insetPolygon(poly, distances)` (`gabarit-engine.js:133`) :
1. **Hisser le winding hors de la boucle edges** : `const winding = polygonWinding(poly)` une seule fois (`:163`, `polygonWinding` défini `:207`) — sinon O(n²).
2. Offset des arêtes.
3. `removeAcuteSpikes(result, 90)` (`:199`, def `:102`) — supprime tout vertex d'angle aigu post-inset.
4. `hasSelfIntersect(final)` (`:203`, def `:87`) → **`return null` si croise** ; le caller décide du fallback (skip edit ou clip raster).
Guards exposés globalement : `window.GeoGuards = { hasSelfIntersect, removeAcuteSpikes }` (`gabarit-engine.js:123`). Usage réel : `emprise_constructible = insetPolygon(poly, insetMap) ?? []` (`:360`).

Autres implémentations d'utilitaires géométriques (coexistent, chacune son rôle) :
- `services/geo-utils.js` → `window.GeoUtils` (`:612`) : `removeAcuteSpikes` (`:124`), `isConvex` (`:47`), `buildZoneHalfplane` (`:460`), `buildZoneRaster` (`:484`), `buildZone` (`:541`).
- `services/footprint-helpers.js` → `window.FootprintHelpers` alias **FH** (`:1290`) : `clipPolygon` (`:156`, Sutherland-Hodgman), `rectCentered` (`:234`), `obb` (`:271`), `rmSpikes` (`:811`), `buildZone` (`:680`), `_clipToBandRaster` (`:1247`).

## Fallback raster marching-squares (L/T/U-shapes)

Sutherland-Hodgman est exact sur convexes mais produit des artefacts silencieux sur formes concaves (pédagogie JOUR/NUIT cassée). Wrapper systématique : `if (!isConvex(poly)) → raster ; else → SH`.
- Zone constructible : `FH.buildZone` (`footprint-helpers.js:680`) route `_buildZoneConvex` (`:688`) vs `_buildZoneRaster` (`:706`, cellSize défaut **0.42** m/cell).
- Clip contre bande : `FH.clipToBand` → `_clipToBandRaster` (`:1223`/`:1247`, cellSize défaut **0.30** m/cell).
- Path raster : grille cellulaire → PIP par cellule → flood-fill **composante principale** (plus grande, pas d'orphelines) → contour → `rmSpikes(90°)` pour éponger les marches d'escalier.
- Path convexe : SH classique, rapide/exact — ne pas toucher.
Même logique côté GeoUtils : `buildZone` route halfplane vs raster (`geo-utils.js:541`).

## OBB — rotation & resize par snapshot

Manipuler un bloc tourné (Oriented Bounding Box) sans dérive cumulative. Utilisé dans `services/plan-masse-canvas.js`.
- **Rotation** : au pointerdown, snapshot `theta0, cx0, cy0, w0, l0, poly0`. Au pointermove : `newTheta = theta0 + (atan2(wy-cy, wx-cx) - atan2(wy0-cy, wx0-cx))` — **absolu depuis le snapshot, jamais `theta += da`**. Zéro dérive même après 1000° de drag.
- **Resize d'un rect tourné** : ne JAMAIS scaler les sommets individuellement (casse les angles 90°). Régénérer un rect propre via `FH.rectCentered(cx, cy, w, l, thetaDeg)` — 4 sommets à 90° garantis (`plan-masse-canvas.js:659, 2719, 2943, 3261` ; resize `:2893-2943`). Coin opposé au handle fixe ; clamp par bissection si le poly sort de la zone.
- **Signature** : `rectCentered(cx, cy, w, l, thetaDeg)` — theta en **degrés**, convention interne local X = L (longueur), local Y = W (largeur).
- Un bloc trapèze/reclippé redevient rect au premier resize (normal — relancer la stratégie pour retrouver une forme complexe).

## Drag edge-handle perpendiculaire vs vertex

UX édition polygone (`components/esquisse-canvas.js`, `components/metaforme-events.js`) :
- **Vertex** : hitbox rond, rouge si concave, drag = déplace ce seul point.
- **Edge-mid** : hitbox **carré** (pas diamond), bleu ; hover = pill pointillée orange + flèches ⊥ + label « drag ⊥ ».
- Pointermove edge : normale `theta = atan2(p2.y-p1.y, p2.x-p1.x) + π/2` ; projeter `(dx,dy)` sur la normale `d_perp = dx·cos + dy·sin` ; déplacer les 2 endpoints de `d_perp·normale` ; **revert si self-intersect**.
- Pointerup sans mouvement (**Δ < 0.3 m** world) = click → `insertVertex(edgeIdx, midPoint)` (legacy préservé). Le seuil 0.3 m évite les faux-drags.

## Rendu SVG : clipPath union + evenodd

Pour toute couche SVG dépendant de la parcelle (plan-masse, gabarit, végétation) :
- `<defs><clipPath id="pmc-tc">` = union de toutes les parcelles ; chaque bloc édito dans `<g clip-path="url(#pmc-tc)">`.
- Polygones parcelle avec `fill-rule="evenodd"` → trous/îlots/intersections gérés naturellement (renderer Métaforme dessine polygones+trous en evenodd, cf. `metaforme-renderer.js`).
- **Contour 2 m = inset négatif hachuré, PAS un stroke** : un stroke déborde sur les voisins même à l'intérieur d'un clipPath.

## Pipeline WGS84 → local mètres (heading-aware)

Entrée éditeur SVG depuis GeoJSON cadastre IGN. Implémenté dans `services/terrain-p07-adapter.js`, exposé `window.TerrainP07Adapter` (alias **TA/TPA**). Point d'entrée `TA.process(geojson, { bearing })` (`:16`).
1. **Projection locale équirectangulaire** autour du centroïde parcelle : `geoToLocal` (`:623`) → `(lng-lng0)·M_LON(lat0)`, `(lat-lat0)·M_LAT`. (Ce N'EST PAS proj4/UTM ici — voir `## À vérifier`.)
2. `bearing` voie : fourni par la session, sinon `inferBearingFromPCA` (`:65`, eigenvecteur PCA, `:~515`).
3. Rotation `-bearing` → voie horizontale en bas.
4. Translation SW → `(0, 0)`.
5. `ensureCCW(poly)` (`:131`) — GeoJSON peut être CW, flip si besoin.
6. `checkSelfIntersect` (`:74`), `poleOfInaccessibility` (PIR, `:88`), `inferEdgeTypes` (voie/fond/latéral). Réversible via `localToGeo` (`:~655`) pour ré-exporter en WGS84.

Conversion **UTM Zone 40 Sud / EPSG:2975** (La Réunion) = fichier séparé `utils/utm40s.js` (**implémentation pure JS, pas de dépendance proj4**) : `toUTM`, `ringToUTM`, distances/surfaces mètres. Utilisée par les couches LiDAR/altitude/contours, PAS par le pipeline éditeur ci-dessus.

## Piège AutoPlanEngine — CRS silencieux

`services/auto-plan-engine.js` retourne **0 solutions sans log clair** si la géométrie parcelle est dans le mauvais CRS.
- `:53-54` : `const geojson = session?.terrain?.parcelle_geojson ?? session?.geojson; if (!geojson) { warn('[AutoPlan] Pas de GeoJSON parcelle'); return []; }`.
- `:57` `TA.process(geojson, { bearing })` ; `:58-60` `if (!adapted.valid) { warn('[AutoPlan] Parcelle invalide'); return []; }`. `TA = window.TerrainP07Adapter` (`:35, 326, 412, 694`).
- **Check avant appel** : coords WGS84 attendues (lon ~55.4–55.8, lat ~-21.4 à -20.8 pour Réunion). Si `|coord| > 100` ou `> 500000` → c'est de l'UTM, convertir d'abord. Logs silencieux ⇒ suspecter le CRS.

## Séparation v4h (constructif) vs Métaforme (édition)

Deux couches distinctes, ne pas mélanger dans un même service :
- **v4h — logique constructive** (placement / sizing / orientation, non-débordement) : `services/auto-plan-strategies.js` + sizing de `services/plan-masse-canvas.js`. Stratégies maxRot / T-shape / cross / expandToMit / lMitFacade ; clip SH + rmSpikes + buildZone. Bug de placement/dimensionnement/suivi de limite → ici.
- **Métaforme — édition géométrique interactive** : 4 modules ES sous `components/`, portés depuis le prototype `.docs/terlab-v5/terlab_metaforme_v3.html`. Bug d'interaction/drag/split/hover/typologie → ici.
  - `metaforme-engine.js` : state + geom core `polyArea` (`:35`), `isConcave` (`:81`, fix cross<0=concave), `computeOffsetRoundPath` (`:174`), `pathToPolyline` (`:346`) ; actions `doSplit` (`:524`), `doInsertVertex` (`:548`), `purgeDegenerate` (`:582`) ; typologies `refreshTypology` (`:675`, isolée/collée/bande).
  - `metaforme-renderer.js` : `createRenderer(svg, engine, opts)` (grille, clipPath, polygones+trous evenodd, handles vertex/edge/arc/bezier/rotate, marker crossing ✕).
  - `metaforme-events.js` : `bindEvents(svg, engine, renderer, opts)` (pointer/wheel/dblclick/keyboard, drag ⊥/arc/bezier/rotate, pan/zoom, split au pointerup).
  - `esquisse-metaforme-adapter.js` : `createAdapter(svg, opts)` (`:48`), `loadSession` (`:71`), `exportToSession` (`:118`) — pont session TERLAB ↔ engine (WGS84 → local → SVG px).
- **Activation opt-in** : flag `window.TERLAB_USE_METAFORME = true` (référencé dans `phases/p07-esquisse.html`, `phases/p11-esquisse.html`), OU toggle « M⚡ legacy/métaforme ». Quand actif, l'`EsquisseCanvas` legacy (`components/esquisse-canvas.js`) est bypassé. Rester opt-in tant que l'équivalence fonctionnelle sur parcelles réelles n'est pas validée.

## Corpus (contexte)

Pipeline multi-sources normalisé (PEIGEO/IGN/PLU/LiDAR) : `data/corpus-schema.json`, `services/corpus-collector.js`, `services/corpus-normalizer.js`, `services/corpus-runner.js`, `services/conformity-scorer.js`, `scripts/corpus_seed_builder.py`, `scripts/corpus_lidar_enrich.py`, `scripts/corpus_alti_enrich.py`, viewer `phases/corpus-viewer.html`. Gotcha : phrases de rapport en ASCII pur.

## À vérifier

- **proj4 / UTM40S dans le pipeline éditeur** : la mémoire source décrivait `geoToLocal` via `proj4 EPSG:4326→EPSG:2975 (UTM40S)`. Vérification code : `terrain-p07-adapter.js:623` utilise une **projection équirectangulaire locale** (`M_LON(lat0)`, `M_LAT`), pas proj4/UTM. L'UTM40S existe bien mais isolé dans `utils/utm40s.js` (pure JS). Confirmer que c'est le comportement voulu et non une régression.
- **Constantes `M_LAT=55.2964, M_LON=-21.1345`** (mémoire) : non retrouvées telles quelles ; ressemblent à des coordonnées lon/lat d'un point Réunion, pas à des mètres/degré. `M_LAT` et `M_LON(lat0)` réels sont définis dans `terrain-p07-adapter.js` (têtes de fichier) — vérifier leurs valeurs exactes avant réutilisation.
- `emprise_raw` vs `emprise_constructible` (`gabarit-engine.js:360-362`) : actuellement identiques, refacto futur possible — ne pas s'appuyer sur une divergence.
