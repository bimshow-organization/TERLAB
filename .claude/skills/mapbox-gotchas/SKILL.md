---
name: mapbox-gotchas
description: >-
  Pièges vérifiés Mapbox GL JS v3 + chaîne bioclim/export du projet TERLAB (carte
  cadastre IGN Réunion, fill-extrusion bâtiments LiDAR, overlay OBIA, snapshots PDF,
  auto-play des phases, héliodon/rose des vents, état solaire partagé). Chaque entrée
  donne symptôme → cause → fix avec valeurs exactes (drift ~0.5 m au pan, maxzoom 19,
  timeout tuiles 8000 ms, opacity constante, stride 1/2/3, lat −21.1, jour 172)
  et pointeurs fichier:ligne validés. À charger dès qu'on touche à une couche Mapbox
  dynamique, une capture canvas, un handler drag/click géo, ou les diagrammes/PDF.
  Déclencheurs — Mapbox, fill-extrusion, unproject, project, idle,
  preserveDrawingBuffer, toDataURL, coalesce, feature-state, WMTS, cadastre IGN,
  maxzoom, tuiles, areTilesLoaded, snapshot carte, OBIA, stride, héliodon, rose des
  vents, ERA5, Open-Meteo, SunState, PhasePlayer, rebind, EnvelopeGenerator.
---

# Mapbox v3 + chaîne géo TERLAB — pièges vérifiés

Toutes les lignes ci-dessous sont validées dans l'arbre actuel `C:\GITHUB\TERLAB`.
Format : **symptôme → cause → fix** (`fichier:ligne`).

## Mapbox GL v3 — couches & expressions

- **`fill-extrusion-opacity` avec data expression = rendu muet cassé** → v3 refuse les
  expressions sur cette propriété. Fix : constante (`0.75`/`0.85`/`0.7`) ; la couleur,
  elle, accepte `interpolate`/`case`/`feature-state`.
  `components/map-viewer.js:797`, `:877` ; `services/lidar-heights-service.js:331`.
- **`["get","height"]` sur feature WFS/BDTOPO/OSM incomplète = extrusion plate** →
  propriété absente → null. Fix : toujours `coalesce`.
  `services/lidar-heights-service.js:329` (`['coalesce',['get','height'],0.5]`),
  `components/map-viewer.js:795-796`, `:875-876`, `:818`.
- **Filtre natif `["get","len"]` sur `satellite-streets-v12` = freeze/rendu cassé** →
  `len` parfois null. Fix cosmétique après `load` : réécrire les filtres qui contiennent
  `len` en `["coalesce",["get","len"],0]`. `components/map-viewer.js:198`.
- **Couche orpheline après changement de phase (leak + highlights morts)** → chaque
  `MapViewer` recrée une instance Mapbox ; les panneaux gardent l'ancienne. Fix :
  rebind sur la nouvelle map. `components/map-viewer.js:102` (`LidarHeightsPanel.rebind(this._map)`),
  impl. `components/lidar-heights-panel.js:273`.

## Projection écran ↔ géo

- **`map.unproject([clientX,clientY])` donne un lat/lng décalé (~0.5 m de drift au pan)
  quand la carte est sous une topbar/sidebar** → `unproject` attend des coords RELATIVES
  au canvas, pas à la page. Fix : soustraire `getCanvas().getBoundingClientRect()`
  (`left`/`top`). Vérifié `components/esquisse-canvas.js:3722-3730` ; même règle pour
  `project()` inverse.
- **`map.project()`/geo calculée au bootstrap = coords fausses/undefined** → zoom/center
  pas encore stables. Fix : différer toute op géo derrière le 1er `map.once('idle')`
  (ou queue FIFO flush-on-idle). `map.loaded()` seul NE suffit PAS. Générateur concerné :
  `services/envelope-generator.js:11` (`EnvelopeGenerator.generate`).

## Capture / snapshot pour PDF

- **`map.getCanvas().toDataURL()` renvoie une image vide/noire/transparente** → WebGL
  efface son buffer après render. Fix : init `preserveDrawingBuffer: true` (~5 % perf,
  ok ici) + attendre `idle`/`areTilesLoaded` avant capture.
  `components/map-viewer.js:54` (option), `:130` & `:1887` (capture),
  `components/export-engine.js:1641` (`areTilesLoaded`), `:1745-1746` (héliodon/windRose).

## Tuiles raster IGN (cadastre WMTS Réunion)

- **Spam 404 console + retries** → le WMTS cadastre IGN Géoplateforme ne sert pas z20
  sur La Réunion, Mapbox demande quand même z20. Fix : `maxzoom: 19` sur la source
  (upscale visuel imperceptible). `components/map-viewer.js:238`, `:725` ;
  `components/esquisse-canvas.js:714`. Vérifier `maxzoom` réel dans le GetCapabilities
  pour ortho/PLU.
- **UI** : cadastre en niveaux de gris pour faire ressortir les sélections colorées →
  `'raster-saturation': -1, 'raster-opacity': 0.7`. `components/map-viewer.js:241`, `:728`.
  Ne PAS appliquer `raster-saturation:-1` à l'orthophoto (devient illisible).

## OBIA — overlay classification comme source Mapbox

- **Overlay HTML/canvas positionné sur la carte bloque pan/zoom et ne suit pas la
  projection** → utiliser une source `image` native (4 coins WGS84) + layer raster,
  bascule de visibilité (pas destroy/rebuild). `services/obia-service.js:263` (toDataURL).
- **Stride adaptatif selon aire pixel de la parcelle** : `<40000 px²→1`, `<160000→2`,
  sinon `3`. `services/obia-service.js:147` (`_computeStride`), extraction `:154`
  (`_grabPixels`). Nettoyage overlay en try-catch (peut suivre un `setStyle()` qui
  détruit les sources). Détection végétation : `services/vegetation/vegetation-detection.js`.

## PhasePlayer — auto-play pour export PDF

- **Phase avance avant chargement des overlays WMS lents (PEIGEO/BRGM/IGN) = PDF
  incomplet** → attente fixe insuffisante. Fix : attente adaptative `areTilesLoaded()`
  puis `race(once('idle'), timeout)`. Objet `PhasePlayer` dans **`index.js:896`**
  (PAS de `services/phase-player.js`) : `_waitForMap` `index.js:985`, `playAll`
  `index.js:997`. Valeurs exactes : `_tileTimeout: 8000` ms (`index.js:909`),
  `speed: 5000` ms/phase (`:899`), `maxPhase: 12` (`:900`),
  `_heavyPhases = {0,1,2,3,4,6,7,12}` (`:907`).
- **Skip des phases déjà vues** : `isVisited(id)` teste `session.data.visitedAt`,
  phase 0 TOUJOURS jouée (`index.js:912-916`) ; `playAll` ignore `skipVisited` (export
  maître). NB : `playAll` fait `goto` + attente 400 ms puis `_waitForMap` sur phases
  lourdes (`index.js:998-1004`).

## SunState — état solaire partagé cross-phase

- **3 timelines dupliquées P01/P04/P07 → sliders désync au scrub** → source unique.
  Module `services/sun-state.js` (défaut `_hour:12`, `_dayOfYear:172` = 21 juin,
  `_lat:-21.1`). Émet `CustomEvent('terlab:sun-changed', {detail:{hour,dayOfYear,source}})`
  (`:90`) ; chaque phase écoute cet event.
- **Ne PAS stocker azimuth/élévation** → recalcul via `SunCalcService.getPosition(hour,
  day, lat)` (`sun-state.js:60-63`) ; seuls `sun_hour`/`sun_day` persistés (`_persist` `:78`).
- **Boucle d'événements** évitée par le garde `_broadcasting` (`sun-state.js:88-93`).

## Héliodon & rose des vents (bioclim PDF)

- Wrapper `components/diag-renderer.js` → `utils/sun-heliodon.js` + `utils/wind-rose.js`
  + `utils/wind-data-service.js`. Capture PDF via `toDataURL('image/png')`
  (`components/export-engine.js:1745-1746`).
- **Stations Météo-France DOM peu denses → fallback fréquent** : seuil `MAX_DIST_KM = 8`
  (`utils/wind-data-service.js:21`), sinon Open-Meteo ERA5 (archive-api, sans clé,
  `~9 km`, `ERA5_YEARS=5`) `wind-data-service.js:20`. Rose = 16 secteurs × classes vitesse.

## À vérifier (non confirmé dans le code)

- **Héliodon hémisphère Sud** : « soleil au Nord en été austral » et canvas **600×600 px**
  — annoncés en mémoire mais non relus dans `utils/sun-heliodon.js`.
- **Drift `unproject` ~0.5 m** : ordre de grandeur mémorisé, non re-mesuré.
- **WCS IGN MNH / `CFG.mnhLayer` dynamique et CORS IGN ok** : cités pour l'intégration
  LiDAR Heights mais le service WCS MNH n'a pas été relocalisé ; couche LiDAR active =
  `services/lidar-heights-service.js` / `components/lidar-heights-panel.js`.