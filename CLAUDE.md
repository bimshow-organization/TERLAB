# TERLAB — brief permanent

TERLAB (TERrain LABoratoire) = app web pédagogique d'analyse de terrain pour les étudiants M1 de l'**ENSA La Réunion** (⚠ jamais « EARL »/« ÉARL » ; clés JSON internes en `_ensa`). 14 phases P00→P13 d'analyse d'une parcelle réelle : identification, topo/LiDAR, risques PPR, PLU, bioclimatique, biodiversité, esquisse, programme, synthèse. Socle théorique : cours Jean-Louis Izard (bioclimatique tropical) — `data/sources-izard.json`, 19 visualisations cartographiées dans `data/izard-visualisations.json`. Usage réel : studio S8 « Habiter les risques » (Saint-Denis, ravines/côtier) → **toute phase doit fonctionner sur n'importe quel site saisi**, pas seulement les sites de démo.

## Stack & contraintes structurelles

- **Vanilla JS ES2022+, zéro bundler, zéro npm client** — ES modules natifs + importmap CDN ([index.html](index.html) : `three@0.182.0` épinglé, `copc@0.0.8`). Mapbox GL JS v3.7, Chart.js v4, Firebase RTDB. PDF = HTML + print.css (jsPDF **supprimé**).
- Servi en SPA statique sous BIMSHOW (Angular) → **URLs relatives obligatoires**. Three.js partagé : `window.THREE ?? await import(...)` (jamais de double bundle).
- Les phases sont injectées dynamiquement dans `#phase-container` par `loadPhase()` ([index.js](index.js)) — pas de pages complètes. Stubs marqués `.stub-warning` + `// STUB`. UI en français académique.
- **Sessions à 2 niveaux** : anonyme (localStorage + `/sessions/{uuid}`, compat QR code) et connecté BIMSHOW (`/terlab/projects/{id}` + index `/users/{uid}/terlabProjects`), migration auto au login — [components/session-manager.js](components/session-manager.js). Toute modif de structure de session passe par `schemaVersion` + `_migrateIfNeeded` (migrations cumulatives, idempotentes, à appliquer côté local ET cloud).
- **Firebase** : init inline dans index.html ; apiKey stub → `window.TERLAB_DB = null` = mode local. Tout code aval doit tolérer `TERLAB_DB === null`. `firebase deploy --only database` touche les rules RTDB globales BIMSHOW — vérifier avec Amaury avant.

## Règles non négociables

1. `data/rapport-phrases.json` : toute nouvelle entrée en **ASCII pur sans accents** (stabilité Puppeteer/PDF).
2. **Guards géométriques = défense en profondeur** : empiler les guards qui catchent des modes de défaillance distincts, ne jamais « remplacer » sans vérifier qu'ils catchent le même mode.
3. **P13 World est volontairement masquée** (`p.id !== 13`) — ne pas proposer de l'enrichir dans audits/roadmaps. (P11 fin-de-vie, elle, reste à étoffer.)
4. Coordonnées 2D↔3D : suivre le skill user-level **coord-systems** (headers `@coords`, double-flip atomique, un seul y-flip).
5. Autodétections (GPU/ABF/PPR/géocodage) : badge AUTO, **ne jamais écraser une saisie utilisateur**.

## Patterns transverses (à réutiliser, pas réinventer)

- **Fetch** : [utils/resilient-fetch.js](utils/resilient-fetch.js) `resilientJSON(url,{fallback,retries,timeout})` — aucune boucle retry manuelle.
- **Notifications** : [components/terlab-notification.js](components/terlab-notification.js) `TerlabNotification.notify({severity, rule, phase, docRef})`, 4 niveaux BLOQUANT/CRITIQUE/AVERTISSEMENT/INFO — remplace tout `alert()`/toast custom ; émet `terlab:notification-shown` (traçabilité P12).
- **Thèmes** : Design System v1 (dark/ivory/earth), source unique [assets/terlab-design-system.css](assets/terlab-design-system.css) ; [components/theme-switcher.js](components/theme-switcher.js) émet `terlab-theme-change` ; les canvas SVG cachent `getComputedStyle` et re-render sur l'event (jamais de getComputedStyle dans la boucle de draw). Ne jamais toucher : `terlab-print.css`, `terlab-map.css`, `workers/`.
- **Soleil cross-phase** : [services/sun-state.js](services/sun-state.js) singleton (`terlab:sun-changed`) — persister `hour`/`day` uniquement, recalculer azimut/élévation (lat −21.1).
- **Mobile** : [components/mobile-controller.js](components/mobile-controller.js) (matchMedia 800 px → bottom sheet + tab bar, `100dvh`, safe-area iOS) — desktop intact.
- **Layout phase** : wrapper `.left-panel-scroll` + `.val-block` sticky injecté par `loadPhase()` — ne pas modifier les 14 HTML de phases.
- **Terrain streamé** : [services/terrain-tiles.js](services/terrain-tiles.js) (grille 500 m UTM40S, snap pixel-centre global, jupes, cache IDB `terlab_tiles` **sans** sessionId) + [services/terrain-tile-manager.js](services/terrain-tile-manager.js) (LOD caméra via [utils/biome-lod.js](utils/biome-lod.js), hystérésis, AbortController par tile). Démo : `.docs/tiles-demo.html`. Probe : `node scripts/probe-tiles.mjs`.
- **Toitures v2** : [services/toiture/](services/toiture/) — noyau squelette droit pondéré porté de bimshow-vision (JS pur sans THREE, tolérances = 12 000 cas de test, ne pas « simplifier »), rendu [services/toiture/roof-mesh.js](services/toiture/roof-mesh.js). Branché dans gabarit-3d pour hip/pyramid, **fallback RoofBuilder OBB conservé** (flag `window.TERLAB_ROOF_V2`). Probe : `node scripts/probe-toiture.mjs`.
- **Calage carte 3D** : [components/mapbox-three-bridge.js](components/mapbox-three-bridge.js) — custom layer horloge + canvas alpha superposé, scène **Z-up** en mètres locaux (5 pièges documentés dans le header ; probe `scripts/probe-bridge-math.mjs`).
- **Végétation 3D** : billboard impostor partagé [services/vegetation/impostor-billboard.js](services/vegetation/impostor-billboard.js) (uCameraPos à rafraîchir par rendu) ; géométrie procédurale 33 espèces [services/vegetation/species-geometry.js](services/vegetation/species-geometry.js) + mapping pur [services/vegetation/species-map.js](services/vegetation/species-map.js). Couleur d'espèce : source unique `color2D` (SVG/carte/3D). Nouvelles constantes de projection : [utils/geo-constants.js](utils/geo-constants.js) (ne pas « corriger » les call-sites compensés existants).

## Skills versionnés — `.claude/skills/`

| Skill | Domaine |
|---|---|
| `sig-donnees-reunion` | Sources SIG : PEIGEO, Géoplateforme IGN (BDTOPO/COSIA/isochrones/BAN), Géorisques, BDNB, SCoT/intercos |
| `lidar-terrain-3d` | COPC navigateur, MNT BIL, isolignes, coupes, classes ASPRS, cache IDB, exports GLB/DXF/IFC |
| `plu-reglementaire` | Enveloppe constructible, stratégies d'implantation + scoring, PPR sampling, GPU/ABF/SUP, CBS |
| `geometrie-2d` | Guards inset/self-intersect, fallback raster, OBB, WGS84→local, v4h vs Métaforme |
| `mapbox-gotchas` | Pièges Mapbox v3, snapshots, PhasePlayer, SunState, héliodon/rose des vents |
| `vegetation-bpf` | Détection canopée COSIA+LiDAR, signature palmier, Poisson disk, pont BPF, surfaces minérales |
| `exports-pdf` | print.css + iframe, Puppeteer random-pdf, règle ASCII, legacy jsPDF |

Chaque skill contient une section `## À vérifier` : divergences memory↔code détectées lors de la distillation (2026-07) — les traiter comme des hypothèses, pas des faits.

## Écosystème

- **dev1.bimshow.io** (origine unique, SSO Firebase `bimshow-dev1`) : `/` website · `/app/` web-app · `/houseg-speech/` · `/bpf/` · TERLAB à migrer depuis GitHub Pages. Branches : `development` → CI → dev1 ; `main` → prod.
- **houseg-speech** = repo sœur : patterns canvas absorbables (multi-select snap-radius 35 px, drag ⊥ d'arête, undo pushHist) ; briques RTAA à extraire vers web-app Pro **avant** TERLAB.
- Toute extraction de brique cross-repo doit considérer les 3 clients potentiels (TERLAB, web-app Pro, BPF).
- `docs/EPUB/` : 8 livres sous DRM LCP TEA CARE (passphrase = email) — conversion via Vivlio + Print to PDF uniquement, **pas de script de déchiffrement**.
