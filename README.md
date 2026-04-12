# TERLAB — Laboratoire d'Analyse de Terrain

**Application web pédagogique · ENSA La Réunion · Master 1 Semestre 8**

> *MOC (Map of Content) guidé qui synthétise les risques, la réglementation, la biodiversité, l'énergie et la culture constructive tropicale d'un terrain réel à La Réunion, et produit des exports académiques exploitables (PDF A4 · SVG · GLB · IFC).*

---

## Sommaire

1. [Présentation](#1--présentation)
2. [Cadre académique](#2--cadre-académique)
3. [Les 14 phases d'analyse](#3--les-14-phases-danalyse)
4. [Stack technique](#4--stack-technique)
5. [Architecture du projet](#5--architecture-du-projet)
6. [Sources de données et API](#6--sources-de-données-et-api)
7. [Installation et lancement local](#7--installation-et-lancement-local)
8. [Pipeline d'export PDF automatisé (Puppeteer)](#8--pipeline-dexport-pdf-automatisé-puppeteer)
9. [Conventions de développement](#9--conventions-de-développement)
10. [Contribution](#10--contribution)
11. [Crédits et licence](#11--crédits-et-licence)

---

## 1 · Présentation

**TERLAB** (TERrain LABoratoire) est une application web destinée aux étudiants en **Master 1 Semestre 8** de l'**ENSA La Réunion** (École Nationale Supérieure d'Architecture). Elle accompagne chaque étudiant à travers **14 phases d'analyse de site** sur l'île de La Réunion, depuis l'identification cadastrale jusqu'à la synthèse exportable.

L'application est hébergée et servie depuis **BIMSHOW** ([`bimshow.io/terlab`](https://bimshow.io/terlab)), la plateforme BIM web de **MGA Architecture** (Mathias Giraud Architecte DPLG, Saint-Leu, La Réunion). Les données étudiantes sont collectées **anonymement** via Firebase RTDB sans login — un UUID est généré côté client.

### Objectifs pédagogiques

- **Cadrer un terrain** dans son contexte administratif, cadastral, géologique et réglementaire.
- **Identifier les risques** naturels et anthropiques (PPRN, sismique, cyclonique, érosion, ICPE).
- **Quantifier les contraintes** PLU/SCoT/RTAA-DOM avant l'esquisse.
- **Esquisser** un projet conforme au gabarit légal, avec validation temps réel.
- **Évaluer l'impact** carbone, énergie, biodiversité, fin de vie.
- **Synthétiser** sous forme d'un dossier d'analyse PDF prêt à présenter en jury.

### Public cible

- **Étudiants ENSA M1 S8** : utilisateurs principaux, parcours guidé phase par phase.
- **Enseignants** : visualisation des sessions étudiantes, exports académiques pour évaluation.
- **Architectes praticiens** : pré-étude rapide d'un terrain réunionnais.
- **Développeurs / chercheurs** : forking pour adaptation à d'autres territoires (DROM-COM, France métropolitaine).

---

## 2 · Cadre académique

### Institution

**ENSA La Réunion** — École Nationale Supérieure d'Architecture de La Réunion. TERLAB s'inscrit dans le cycle Master 1, Semestre 8, pour le studio « Risques & Territoires Tropicaux ».

### Méthode pédagogique

Les **14 phases** sont structurées en trois familles :

| Famille | Phases | Statut | Logique |
|---|---|---|---|
| **Bloquantes** | P00 → P03 | obligatoires | Sans cadastre exact, PPR analysé et topo validée, le projet est nul juridiquement. |
| **Indicatives** | P04 → P12 | recommandées | Analyses approfondies — esquisse, voisinage, biodiversité, impact, synthèse. |
| **Ouverture** | P13 World | optionnelle | Mise en perspective avec l'architecture tropicale mondiale (Köppen, partenariats). |

Chaque phase possède :
- **Validations bloquantes/non-bloquantes** vérifiées en temps réel ;
- **Sources & références** documentées (Envirobat Réunion, Izard, AGORAH, PLU, BRGM…) ;
- **Champs d'analyse libre** sauvegardés en session UUID ;
- **Exports** intermédiaires (SVG, JSON) intégrés à la synthèse finale.

### Note pédagogique sur les risques

> *Les phases 0 à 3 sont bloquantes : elles conditionnent la sécurité et la légalité du projet. Les phases 4 à 12 sont indicatives. La Phase World est optionnelle mais recommandée.*
> — `data/phases-meta.json`

---

## 3 · Les 14 phases d'analyse

| # | Phase | Slug | Contenu principal |
|---|---|---|---|
| **00** | 📍 Identification du terrain | `p00-identification` | Cadastre IGN/PCI, commune, contenance, ancrage GPS |
| **01** | ⛰ Topographie & Microclimat | `p01-topographie` | DEM 3D, profils de pente, ravines, vents, héliodone, bloc bioclim Köppen + précipitations ERA5, maillage TIN adaptatif (Delaunay + breaklines) |
| **02** | 🪨 Géologie & Géotechnique | `p02-geologie` | BRGM Infoterre, zones sismiques, cartes géologiques |
| **03** | 🌊 Hydrologie & Risques | `p03-risques` | PPRN inondation/cyclones/mouvements de terrain (PEIGEO/AGORAH) |
| **04** | 📐 PLU & SCoT | `p04-plu` | Zonage PLU 24 communes, reculs, CES, hauteurs, CBS, servitudes/passages/réseaux |
| **05** | 🏢 Voisinage & Réseaux | `p05-voisinage` | Bâti BD TOPO, ICPE, ENEDIS/EDF, accès pompiers, ancienneté bâti (BDNB/OSM) |
| **06** | 🌿 Biodiversité & Milieu Naturel | `p06-biodiversite` | Parc National, ZNIEFF, espèces protégées, TVB |
| **07** | 🏗 Esquisse & Simulation | `p07-esquisse` | Plan masse interactif, gabarit PLU, RTAA, plan masse canvas |
| **08** | ⚙ Chantier & Construction | `p08-chantier` | Risques sanitaires tropicaux, accès, voisinage |
| **09** | ♻ Impact Carbone & Énergie | `p09-carbone` | ACV matériaux Réunion, Chart.js, bilan énergétique, mouvements de terre 3D (earthworks-mesh-builder) |
| **10** | 🔧 Durabilité & Entretien | `p10-entretien` | Diagnostic durabilité tropicale, fin de vie circulaire, ANC (assainissement non collectif) |
| **11** | 📐 Esquisse Plan Masse | `p11-esquisse` | EsquisseCanvas Mapbox live overlay + EnvelopeGenerator Shape Grammar |
| **12** | 📄 Synthèse & Exports | `p12-synthese` | Dossier PDF A4, QR code session, sauvegarde Firebase |
| **13** | 🌍 Architectures Tropicales Mondiales | `p13-world` | Globe Köppen, partenariats internationaux ENSA |

> **Note** : la phase historique `p11-fin-de-vie` a été archivée et fusionnée dans `p10-entretien`. Le slot P11 est désormais occupé par l'esquisse plan masse de seconde génération (EsquisseCanvas + EnvelopeGenerator).

### Phases-clés détaillées

#### P04 — PLU & SCoT
Source de vérité unique : `data/plu-rules-reunion.json` (24 communes consolidées) + 24 fichiers `plu-rules-<commune>.json` individuels. Le service `plu-p07-adapter.js` gère la résolution zone PLU avec fuzzy match, gestion AVAP, ref_zone, fallback graceful. Calcul **CBS** (Coefficient Biotope) intégré, validation Saint-Paul Ua5 conforme.

#### P07 — Esquisse interactive
- `services/plan-masse-canvas.js` (PlanMasseCanvas) : éditeur SVG inline avec gabarit PLU temps réel, drag-handles, scénarios Pareto (A1/B1/B2/C1).
- `components/gabarit-engine.js` (ConstraintSolver) : moteur de zones constructibles edge-aware, bandes de recul suivant l'inclinaison réelle des limites parcellaires (parcelles non orthogonales, trapèzes, polygones en L).
- Règle **binaire** d'implantation latérale : 0 m (mitoyen) OU Lmin (recul standard), conforme à la jurisprudence réunionnaise.
- Clamping AABB strict dans le polygone constructible réel (et non sa bbox).
- `services/contour-service.js` : lissage DEM Gaussian blur 3×3 + lissage polyline Chaikin corner-cutting. Supprime le crénelage des courbes de niveau.
- `services/geo-utils.js` : `arcInterpolateCorners` — post-processeur Minkowski qui remplace les coins vifs de la zone constructible par des arcs circulaires aux intersections de reculs.
- `services/terrain-p07-adapter.js` : arc corners convex parcels + inlet notches sur limites mitoyennes + `inferEdgeTypes()` unifié.

#### P01 — Topographie : maillage TIN adaptatif
- `services/terrain-mesh-builder.js` : triangulation Delaunay (delaunator CDN) sur points LiDAR sol avec insertion de breaklines (cadastre, ravines, bâtiments, routes). Décimation adaptative 80k points max, layers couleur interchangeables (classification LiDAR, pente, altitude, ortho UV).
- Section P01 interactive : bouton « LiDAR Make Mesh », progression, sélecteur de couche couleur, légende dynamique.

#### P04 — PLU : servitudes, passages & réseaux
- Section servitudes Art. 682-685 CC (enclave, droit de passage, SDIS, SUP réseaux).
- Vérification parcelle (accès voie publique, servitudes, largeur accès, réseaux en limite).
- Alerte automatique parcelle enclavée propagée depuis EsquisseCanvas.

#### P05 — Voisinage : ancienneté du bâti
- `services/building-age-service.js` : ancienneté via BDNB CSTB (primaire) + OSM `start_date` (fallback). Tranches réglementaires thermiques (pré-1950, RT 1974/1988, RT 2000/2005, RT 2012 / RE 2020). Couche Mapbox colorée par époque.

#### P10 — Entretien : ANC (Assainissement Non Collectif)
- `services/anc-service.js` : dimensionnement filière ANC adapté Réunion (DTU 64.1, arrêté 7 sept. 2009, guide SPANC Réunion/DEAL). Classes de perméabilité, scoring 0-100, coût CapEx/OpEx, conformité, SPANC local.
- `services/anc-plan-service.js` : plan d'implantation SVG (fosse toutes eaux, zone de traitement, reculs réglementaires, canalisations). Même pattern que `giep-plan-service.js`.
- Planche ANC intégrée dans le rapport PDF (`export-engine.js`).

#### P11 — Esquisse Plan Masse v2
- `components/esquisse-canvas.js` : overlay Mapbox live avec dessin de bâtiment AABB. Classification des limites (voie/fond/latéral) déléguée à `TerrainP07Adapter.inferEdgeTypes()` (pipeline unifié). Arêtes cliquables pour override de type. Intégration ANC auto-compute.
- `services/envelope-generator.js` : générateur d'enveloppe constructible Shape Grammar PLU.
- `services/bpf-bridge.js` : injection automatique végétation + aménités (Poisson disk, 35 espèces, 8 aménités).
- `services/auto-plan-strategies.js` : 6 stratégies de placement (rect, oblique, zone, multi-blocs, L-shape, courtyard).
- `services/existing-buildings.js` : modes conservation (zone libre = env − AABB footprints + gap) et extension (bande collée façade libre).

---

## 4 · Stack technique

### Front-end

| Couche | Technologie | Version | Notes |
|---|---|---|---|
| **Langage** | Vanilla JavaScript ES2022+ | — | Aucun bundler, modules ES natifs |
| **Cartographie 2D** | Mapbox GL JS | v3.7.0 | + Mapbox Draw v1.4.3 |
| **3D** | Three.js | r182 | Partagé avec BIMSHOW via `window.THREE`, addons via importmap |
| **Géométrie** | Turf.js | v7 | Calculs géodésiques, intersections, buffers |
| **Graphiques** | Chart.js | v4.4.0 | Profils topo, ACV, carbone |
| **CSG / BVH** | three-bvh-csg, three-mesh-bvh | 0.0.17 / 0.7.8 | Booléens 3D pour les volumes bâtis |
| **LiDAR navigateur** | COPC.js + laz-perf WASM | 0.0.8 / 0.0.7 | Lecture point cloud IGN HD côté client |
| **Triangulation** | Delaunator | 5.0.1 | Maillage TIN adaptatif terrain (CDN) |
| **PDF** | `print-template.html` + `window.print()` | — | jsPDF/html2canvas supprimés. Mode narratif : phrases contextuelles auto via `data/rapport-phrases.json` (19 sections, ~150 phrases) |
| **QR code** | qrcode-generator | 1.4.4 | Phase 12, session UUID |

### Back-end / persistance

| Service | Rôle |
|---|---|
| **Firebase RTDB** | Sauvegarde session anonyme (UUID client). Config publique dans `config/firebase-config.public.js`, surcharge locale gitignored dans `config/firebase-config.js`. |
| **Firebase Auth** | Anonymous sign-in, persistance `browserLocalPersistence` |
| **CDN jsDelivr** | Toutes les libs JS chargées via CDN, aucun `node_modules` côté client |

### Polices et design system

- **Playfair Display** (titres serif), **Source Serif 4** (corps), **Inconsolata** (mono / chiffres)
- **CSS Themes** : 7 thèmes commutables via `data-theme` sur `<html>` (par défaut : `ivory`)
- Design system dans `assets/terlab-shell.css`

### Particularités d'intégration BIMSHOW

- TERLAB est servi comme **SPA statique** depuis BIMSHOW (Angular 19), URL `bimshow.io/terlab`
- Communication parent/enfant via **postMessage** (`BIMSHOWBridge`)
- **Three.js partagé** : TERLAB utilise `window.THREE` injecté par BIMSHOW pour éviter le double chargement
- **URLs relatives** obligatoires partout (pas de path absolu)
- **Sessions anonymes** : aucune donnée nominative collectée

---

## 5 · Architecture du projet

```
TERLAB/
├── index.html                       ← Shell SPA, importmap, Mapbox/Firebase init
├── index.js                         ← Router (TerlabRouter), session manager, injection phases
├── accueil.html                     ← Page d'accueil
├── print-template.html              ← Template PDF imprimable A4
├── package.json                     ← Scripts npm (puppeteer + serve)
│
├── assets/                          ← CSS, fonts, logos, illustrations
│   ├── terlab-shell.css             ← Design system complet (7 thèmes)
│   ├── terlab-map.css               ← Surcharges Mapbox GL JS
│   └── terlab-print.css             ← Styles impression / export PDF
│
├── config/
│   ├── firebase-config.public.js    ← Config Firebase publique (committée)
│   └── firebase-config.js           ← Config locale (gitignored)
│
├── data/                            ← JSON de configuration (lecture seule)
│   ├── phases-meta.json             ← Métadonnées 14 phases
│   ├── plu-rules-reunion.json       ← Règles PLU 24 communes consolidées
│   ├── plu-rules-<commune>.json     ← 24 fichiers PLU individuels
│   ├── bpf-species-reunion.json     ← 35 espèces végétales pour Bpf
│   ├── cellule-rules.json           ← Règles génération cellules logement
│   ├── climat-koppen.json           ← Zones climatiques mondiales (P13)
│   ├── cyclones-reunion.json        ← Trajectoires cycloniques historiques
│   ├── materiaux-acv-reunion.json   ← ACV matériaux pour P09
│   ├── partenariats-ensa.json       ← Partenariats internationaux ENSA
│   ├── rapport-phrases.json         ← Phrases conditionnelles pour rapports
│   ├── coastline-reunion-simplified.geojson
│   ├── filieres-reunion.geojson
│   ├── geojson/                     ← Parc National, ZNIEFF1, ZNIEFF2
│   └── atlas/                       ← Pages atlas pédagogiques (HTML)
│
├── phases/                          ← 14 phases HTML injectées dynamiquement
│   ├── p00-identification.html
│   ├── p01-topographie.html
│   ├── ...
│   └── p13-world.html
│
├── services/                        ← Modules métier (≈60 fichiers)
│   ├── plan-masse-canvas.js         ← Éditeur SVG plan masse P07
│   ├── envelope-generator.js        ← Générateur enveloppe constructible
│   ├── plu-p07-adapter.js           ← Résolution PLU commune-aware
│   ├── auto-plan-engine.js          ← Génération automatique de plans
│   ├── auto-plan-strategies.js      ← 6 stratégies (rect/oblique/zone/multi-blocs/L-shape/courtyard)
│   ├── bpf-bridge.js                ← Injection végétation + aménités
│   ├── ppr-service.js               ← PPR via WMS PEIGEO/AGORAH
│   ├── cadastre-context-service.js  ← WFS cadastre IGN
│   ├── lidar-service.js             ← Téléchargement LiDAR HD
│   ├── parcel-altitudes.js          ← Altitudes 4 coins parcelle
│   ├── earthworks-service.js        ← Calcul mouvements de terre
│   ├── earthworks-mesh-builder.js   ← Mesh Three.js déblais/remblais 3D (P09)
│   ├── giep-calculator-service.js   ← Calcul score GIEP biodiversité
│   ├── giep-plan-service.js         ← Plan GIEP SVG dédié pour le PDF auto
│   ├── cbs-calculator-service.js    ← Coefficient Biotope par Surface
│   ├── ign-elevation-service.js     ← API altimétrie IGN
│   ├── meteo-service.js             ← Météo-France API Hub
│   ├── precipitation-service.js     ← Précipitations ERA5 (Open-Meteo)
│   ├── brgm-service.js              ← Géologie BRGM Infoterre
│   ├── gpu-service.js, gpu-fetcher.js ← Géoportail Urbanisme
│   ├── scot-service.js              ← SCoT 5 intercommunalités Réunion
│   ├── rtaa-*.js                    ← Validation RTAA DOM (5 modules)
│   ├── plan-masse-engine.js         ← Moteur plan masse Three.js
│   ├── pareto-scorer.js             ← Scoring multicritères
│   ├── terrain-p07-adapter.js       ← Adaptateur terrain → P07
│   ├── isochrone-service.js         ← Isochrones piéton/VL (calcul accès)
│   ├── poi-service.js               ← Points d'intérêt (commerces, équipements)
│   ├── anc-service.js               ← Dimensionnement ANC (DTU 64.1, arrêté 2009)
│   ├── anc-plan-service.js          ← Plan d'implantation ANC en SVG
│   ├── building-age-service.js      ← Ancienneté bâti (BDNB CSTB + OSM fallback)
│   ├── terrain-mesh-builder.js      ← Maillage TIN adaptatif Delaunay + breaklines
│   ├── contour-service.js           ← Courbes de niveau, lissage Gaussian + Chaikin
│   ├── geo-utils.js                 ← Helpers géodésiques transverses + arc corners Minkowski
│   ├── rapport-phrases-engine.js    ← Picker + buildFullContext pour le PDF narratif
│   └── …                            ← +30 services (météo, sun, sismique, etc.)
│
├── components/                      ← Composants UI réutilisables (≈30)
│   ├── esquisse-canvas.js           ← Canvas plan masse P11 (Mapbox overlay)
│   ├── gabarit-engine.js            ← ConstraintSolver edge-aware
│   ├── gabarit-svg.js               ← Rendu SVG gabarit interactif
│   ├── gabarit-3d.js                ← Rendu 3D Three.js gabarit
│   ├── envirobat-cards.js           ← Cartes ressources Envirobat Réunion
│   ├── giep-score.js                ← Widget score GIEP
│   ├── map-capture.js               ← Captures Mapbox haute résolution
│   ├── session-manager.js           ← Gestionnaire session UUID + Firebase
│   ├── wind-navigator.js            ← Navigateur vents bioclimatique
│   ├── aeraulic-planner.js          ← Comparateur variantes plan masse
│   ├── parcel-selector.js           ← Sélection parcelles cadastrales
│   ├── bimshow-bridge.js            ← Pont postMessage BIMSHOW ↔ TERLAB
│   ├── source-modal.js              ← Modale sources & références
│   └── …
│
├── utils/                           ← Helpers transverses
│   ├── site-plan-renderer.js        ← Rendu site plan SVG
│   └── terlab-mat-utils.js          ← Fonctions matricielles et géométriques
│
├── workers/                         ← Web Workers (calculs lourds)
│
├── scripts/                         ← Outillage Node.js
│   ├── random-terrain-pdf.js        ← Pipeline Puppeteer export PDF
│   ├── terrain_api.py               ← API terrain Python
│   ├── terrain_pipeline.py          ← Pipeline pré-calcul Python
│   └── test-providers.js            ← Tests providers données
│
├── lidar-fetcher/                   ← Outils Python LiDAR (venv local)
│
├── plu-sources/                     ← Sources brutes PLU (PDF, scrapping)
├── plu-schemas/                     ← Schémas JSON validation PLU
│
├── docs/
│   └── random-pdf/                  ← Sortie pipeline Puppeteer
│
└── prompts/                         ← Prompts d'aide au développement
```

### Routage et chargement des phases

L'app est une **SPA pure** avec routing par hash : `#phase/0` → `#phase/13`.

Le router (`TerlabRouter` dans `index.js`) :
1. Lit `window.location.hash`
2. Récupère les métadonnées de la phase dans `data/phases-meta.json`
3. Charge le HTML de la phase via `fetch('phases/p<NN>-<slug>.html')`
4. Injecte le HTML dans `#phase-container`
5. Exécute les `<script>` inline et externes contenus dans le HTML phase
6. Met à jour `window.TerlabRouter.currentPhase`

Cette approche **sans bundler** permet de :
- Itérer phase par phase sans rebuild
- Faire fonctionner l'app servie comme statique depuis n'importe quel CDN
- Conserver la compatibilité BIMSHOW (Angular 19 héberge le shell, TERLAB injecte ses fragments)

---

## 6 · Sources de données et API

### APIs publiques utilisées

| Source | Type | URL | Usage |
|---|---|---|---|
| **Géoportail IGN** | WFS / WMS / Altimétrie | `data.geopf.fr` | Cadastre, BD TOPO, DEM, élévations |
| **APICarto IGN** | REST | `apicarto.ign.fr/api/gpu` | PLU, prescriptions, SUP |
| **Géoportail Urbanisme** | REST | `geoportail-urbanisme.gouv.fr/api` | Documents PLU, fichiers, métadonnées |
| **PEIGEO / AGORAH** | WMS GeoServer | `peigeo.re:8080/geoserver/peigeo/wms` | PPR, PLU réunionnais (couches `ppr_approuve`, `pos_plu_simp`, `communes`, `cn_agorah`) |
| **BRGM Infoterre** | REST | `geoservices.brgm.fr/geologie` | Géologie, sismicité |
| **Météo-France API Hub** | REST | `public-api.meteofrance.fr` | Stations climato mensuelles |
| **Mapbox** | Raster + Style | `api.mapbox.com` | Tuiles satellite, terrain-RGB DEM, styles cartographiques |
| **IGN LiDAR HD** | Téléchargement direct | `data.geopf.fr/telechargement/download/LiDARHD-NUALID` | Point clouds COPC navigateur |

> **Aucune clé API requise** pour PEIGEO, BRGM, Géoportail (services publics). Mapbox et Météo-France nécessitent un token, à placer dans `.env` ou `config.local.js` (gitignored).

### Données embarquées (`data/`)

#### PLU consolidé Réunion
- `plu-rules-reunion.json` : **source de vérité unique** pour les 24 communes de La Réunion. Format flat pour `ConstraintSolver`. Contient les règles de recul, hauteurs, CES, mitoyenneté, zones spéciales (Ua5, Zone N, AVAP).
- 24 fichiers `plu-rules-<commune>.json` : versions individuelles par commune (audit, debug).
- Les communes couvertes : Saint-Paul, Saint-Denis, Saint-Pierre, Saint-Leu, Le Tampon, Le Port, La Possession, Saint-André, Saint-Benoît, Bras-Panon, Cilaos, Entre-Deux, L'Étang-Salé, Petite-Île, La Plaine-des-Palmistes, Saint-Joseph, Saint-Louis, Saint-Philippe, Sainte-Marie, Sainte-Rose, Sainte-Suzanne, Les Avirons, Salazie, Trois-Bassins.

#### SCoT — 5 intercommunalités
TERLAB intègre les 5 SCoT réunionnais : **TCO**, **CINOR**, **CIREST** (abrogé), **CIVIS**, **CASUD** — avec consolidation **Grand Sud** (CIVIS + CASUD), ZATT 500 m, palettes DAUPI. Sources documentées dans `services/scot-service.js`.

#### Biodiversité
- `bpf-species-reunion.json` : 35 espèces végétales avec taille, croissance, contraintes, `color2D` + `flowerColor` pour rendu plan masse
- `data/geojson/parc-national-reunion.geojson`
- `data/geojson/znieff1-reunion.geojson`, `znieff2-reunion.geojson`
- `coastline-reunion-simplified.geojson`

#### Risques
- `cyclones-reunion.json` : trajectoires historiques
- `risques-phases.json` : matrice risques × phases avec entrées ANC, servitudes, ancienneté bâti

#### ACV / Carbone
- `materiaux-acv-reunion.json` : matériaux locaux avec impact carbone, source filière Réunion

#### Climat
- `climat-koppen.json` : 20 zones climatiques mondiales pour P13 World

#### Pédagogie
- `acteurs.json` : 33 acteurs institutionnels (DEAL, AGORAH, communes, etc.)
- `partenariats-ensa.json` : partenariats internationaux ENSA
- `izard-visualisations.json` : 12 documents Izard indexés
- `rapport-phrases.json` : **dictionnaire narratif du PDF auto** — 19 sections (identification, topographie, géologie, risques, PLU, SCoT, programme, bioclimatique, environnement, synthèse, opérationnel, géologie détaillée, réseaux, esquisse, plan masse, GIEP, chantier, SDIS, vent/pluviométrie). Chaque entrée a un `short` (tag italique sous une row du PDF) et un `text` (paragraphe long pour mode narratif). Les phrases sont sélectionnées par conditions évaluées sur le contexte terrain (`buildFullContext` dans `services/rapport-phrases-engine.js`). Convention ASCII stricte (sans accents) pour les nouvelles entrées

#### Atlas
- `data/atlas/*.html` : pages atlas pédagogiques (composition urbaine, jardins/parcs/places, composition psychédélique)

### Sources PDF Envirobat

14 fiches Envirobat Réunion ([envirobat-reunion.com](https://www.envirobat-reunion.com)) sont téléchargées et intégrées dans 10 phases via `components/envirobat-cards.js` + `components/source-modal.js`. Thumbnails générés pour la sidebar « Sources & références ».

---

## 7 · Installation et lancement local

### Prérequis

- **Node.js ≥ 18** (pour le pipeline Puppeteer)
- **npm** (pour `puppeteer` et `serve`)
- **Navigateur moderne** (Chrome/Edge/Firefox récent — WebGL2 + WASM requis)
- **Token Mapbox** (gratuit sur [mapbox.com](https://account.mapbox.com))

### Installation

```bash
git clone https://github.com/<owner>/TERLAB.git
cd TERLAB
npm install
```

> `npm install` n'installe **que** les outils de dev (Puppeteer + serve). L'app elle-même n'a aucune dépendance npm runtime — toutes les libs sont chargées via CDN dans `index.html`.

### Configuration

#### 1. Token Mapbox

Créer un fichier `.env` à la racine :

```env
MAPBOX_TOKEN=pk.eyJ1IjoiVOTRE_TOKEN_ICI...
```

Ou bien créer `config.local.js` (gitignored) :

```javascript
window.TERLAB_MAPBOX_TOKEN = 'pk.eyJ1...';
```

#### 2. Firebase (optionnel)

Sans Firebase, TERLAB fonctionne en **mode local** : sessions sauvegardées en `localStorage` uniquement. Pour activer la persistance cloud :

- Copier `config/firebase-config.public.js` vers `config/firebase-config.js`
- Remplacer la config par celle de votre projet Firebase
- `firebase-config.js` est gitignored, `firebase-config.public.js` est commité avec une config de démo

### Lancement

```bash
npm run serve
```

Cela lance `npx serve . -p 8080 -s` (mode SPA, fallback `index.html`). Ouvrir [http://localhost:8080](http://localhost:8080).

#### Routes

- `/` — accueil (`accueil.html`)
- `/index.html#phase/0` — Phase 0 Identification
- `/index.html#phase/7` — Phase 7 Esquisse
- `/index.html#phase/12` — Synthèse + exports

### Build / déploiement

**Aucun build** n'est requis. L'app est déjà du JavaScript natif. Pour déployer :

1. Copier le dossier complet sur un serveur statique (GitHub Pages, Netlify, Cloudflare Pages, S3, BIMSHOW…)
2. S'assurer que les **URLs relatives** sont préservées (servir depuis la racine ou un sous-dossier configuré)
3. Configurer le fallback SPA (`index.html` par défaut) si le serveur le nécessite

#### URLs publiques

| URL | Source | Mise à jour |
|---|---|---|
| **https://bimshow-organization.github.io/TERLAB/** | GitHub Pages, ce repo | **Auto à chaque push sur `main`** via [`.github/workflows/pages.yml`](.github/workflows/pages.yml) |
| **https://bimshow.io/terlab** | App Angular 19 BIMSHOW (autre repo) | Dépend du build Angular séparé |

> **GitHub Pages** est l'URL canonique pour valider en temps réel les changements de TERLAB. **bimshow.io/terlab** est l'hébergement de référence pédagogique : TERLAB y est servi comme fragment statique injecté par l'app Angular 19 BIMSHOW (postMessage `BIMSHOWBridge`).

---

## 8 · Pipeline d'export PDF automatisé (Puppeteer)

TERLAB embarque un pipeline Node.js qui automatise la génération de dossiers PDF académiques sur des terrains aléatoires de La Réunion. Idéal pour :
- Tester la non-régression sur des cas réels
- Générer des planches de présentation
- Produire des datasets d'entraînement pour ML
- Vérifier visuellement la conformité PLU des esquisses générées

### Localisation

- Script principal : [`scripts/random-terrain-pdf.js`](scripts/random-terrain-pdf.js)
- Sortie : [`docs/random-pdf/`](docs/random-pdf/)

### Lancement

```bash
# 1 terrain (mode rapide)
npm run test:random

# 5 terrains en batch
npm run test:random:batch

# Avec options
node scripts/random-terrain-pdf.js --count 3 --no-lidar --headed
```

### Options CLI

| Option | Effet |
|---|---|
| `--count <N>` | Nombre de terrains à traiter (défaut : 1) |
| `--headed` | Mode visible (Chromium ouvert, debug) |
| `--no-lidar` | Skip téléchargement LiDAR HD (gain ~80 s/terrain) |
| `--port <N>` | Port du serveur local (défaut : aléatoire 8787-8887) |
| `--token <token>` | Token Mapbox CLI (sinon `.env` puis fallback embarqué) |

### Étapes du pipeline

1. **Démarrage serveur** local (`npx serve` sur port aléatoire)
2. **Lancement Puppeteer** (Chromium headless ou headed)
3. **Init TERLAB** (chargement Mapbox, session UUID)
4. **Recherche parcelle aléatoire** via WFS cadastre IGN (6 tentatives × 8 s)
5. **Confirmation terrain** (validation P00)
6. **LiDAR** (optionnel — COPC navigateur, 90 s timeout)
7. **Enrichissement** APIs (PPRN PEIGEO + PLU + BRGM + élévation IGN)
8. **AutoPlanEngine** : génération esquisse automatique (6 variantes Pareto)
9. **Mapbox capture** : 8 vues haute résolution (cadastre, situation, PPR, contexte 3D, plan masse)
10. **BpfBridge** : injection végétation + aménités
11. **Plan masse SVG** + GIEP SVG + coupe gabarit SVG
12. **Rendu HTML** dans `print-template.html` — chaque row du dossier est accompagnée automatiquement d'un tag italique narratif (zone PLU, hauteur, recul, géologie, réseaux, esquisse, GIEP, SDIS…) issu de [`data/rapport-phrases.json`](data/rapport-phrases.json) via `pickShort()` + `buildFullContext()`
13. **PDF A4** via `page.pdf()` Puppeteer

### Sortie

```
docs/random-pdf/
├── TERLAB_<commune>_<parcelle>_<timestamp>.pdf
├── planmasse_<timestamp>.svg
└── giep_<timestamp>.svg
```

### Exemple de log

```
[TERLAB-TEST] 01:47:05 — RUN #1 — 2026-04-10T21-47-05_001
[TERLAB-TEST] 01:47:05 — 1. Chargement TERLAB…
[TERLAB-TEST] 01:47:21 —   📍 Saint-Paul — DN0194 (-21.0533, 55.2735)
[TERLAB-TEST] 01:47:23 —   [browser] [PDF] Enrichi : PPR=hors zone, PLU=U3c, alt=423
[TERLAB-TEST] 01:47:23 —   [browser] [PDF] Esquisse : 6 variantes, best=A1 3N 369m² score=4.02
[TERLAB-TEST] 01:47:51 —   [browser] [PDF] MapCapture : 8 vues
[TERLAB-TEST] 01:47:58 —   ✅ PDF sauvegardé : TERLAB_Saint-Paul_DN0194_…pdf (2830 Ko)
```

### Configuration des timeouts

Tous les timeouts sont déclarés en haut du script (objet `T`) :

```javascript
const T = {
  APP_INIT:       30_000,   // init TERLAB + Mapbox
  RANDOM_PARCEL:  40_000,   // WFS cadastre (6 tentatives × 8s)
  TERRAIN_CONFIRM: 5_000,   // validation P00
  PHASE_LOAD:     15_000,   // chargement HTML + scripts phase
  LIDAR_FETCH:    90_000,   // COPC browser (gros fichiers IGN)
  AUTO_ENRICH:    30_000,   // PPR + PLU + BRGM + élévation
  MAP_CAPTURE:    20_000,   // captures Mapbox séquentielles
  PDF_RENDER:     20_000,   // rendu planches HTML
  BETWEEN_RUNS:    3_000,   // pause entre deux terrains
};
```

### Cas d'usage avancés

#### Tests de non-régression PLU

Après modification du moteur de gabarit (`gabarit-engine.js`, `plan-masse-canvas.js`, `envelope-generator.js`), lancer :

```bash
node scripts/random-terrain-pdf.js --count 5 --no-lidar
```

Vérifier visuellement dans les PDF que :
- Les bandes de recul suivent l'inclinaison réelle des limites parcellaires
- Le bâtiment reste dans la zone constructible (pas de débordement)
- L'enveloppe constructible n'a pas de coins perdus excessifs

#### Génération de datasets ML

```bash
node scripts/random-terrain-pdf.js --count 100 --no-lidar
```

Les SVG plan masse + GIEP sont sauvegardés à part et peuvent servir d'inputs pour des modèles d'analyse de site.

---

## 9 · Conventions de développement

### Style de code

- **Vanilla JS ES2022+** — pas de TypeScript, pas de JSX, pas de bundler
- **Modules ES natifs** — `import`/`export`, jamais de CommonJS dans le runtime navigateur
- **Pas de framework** — DOM API natif, événements, fetch
- **Singletons** d'objet pour les services (`const PlanMasseCanvas = { ... }`)
- **Fichiers nommés** en `kebab-case.js`
- **Aucune dépendance npm runtime** — uniquement CDN

### Stubs et données factices

Tout code de stub doit être marqué :
- En JS : commentaire `// ⚠️ STUB`
- En HTML : classe CSS `.stub-warning` sur l'élément concerné

### Internationalisation

L'**UI est en français académique**. Les commentaires de code peuvent être en français ou en anglais (français préféré pour les explications métier PLU/RTAA).

### Conventions de commit

Format observé dans les commits récents :

```
<scope court> — <description courte>
```

Exemples :
- `P04 PLU détails CBS + étoile capture agrandie`
- `GIEP score — intégration bloc CBS dans le widget`
- `Pipeline PDF v3 — Three.js headless, plan masse pleine largeur`

### Compatibilité BIMSHOW

Avant tout commit, vérifier :
- ✅ Aucun import npm runtime ajouté
- ✅ URLs relatives uniquement
- ✅ `window.THREE` réutilisé si Three.js requis (pas de double chargement)
- ✅ Communication parent ↔ TERLAB via `BIMSHOWBridge` (postMessage)
- ✅ Aucune donnée nominative collectée (sessions UUID anonymes)

### Tests

Pas de framework de tests unitaires actuellement. Les vérifications passent par :
1. **Smoke test syntaxique** : `node --check services/<file>.js`
2. **Pipeline Puppeteer** : `npm run test:random` (test e2e visuel)
3. **Tests Node.js spécifiques** : `test_p01.mjs`, `test_earthworks.mjs` (à la racine)

---

## 10 · Contribution

### Pour les étudiants ENSA

TERLAB est un outil pédagogique. Vos retours et suggestions sont précieux. Vous pouvez :
- Ouvrir une **issue GitHub** décrivant un bug ou une suggestion
- Proposer une **pull request** pour un correctif (suivre les conventions ci-dessus)
- Contacter directement le mainteneur (cf. section Crédits)

### Pour les développeurs

1. **Forker** le dépôt
2. Créer une **branche feature** : `feat/<short-name>` ou `fix/<short-name>`
3. Faire vos changements en respectant les conventions :
   - Pas de bundler, pas de npm runtime
   - URLs relatives, sessions anonymes
   - Code commenté en français pour les règles PLU/RTAA
4. Lancer le pipeline test : `npm run test:random`
5. Soumettre une **pull request** vers `main` avec une description claire (problème, solution, tests)

### Adaptation à d'autres territoires

TERLAB est conçu pour La Réunion mais peut être adapté à d'autres territoires :
- **DROM-COM** : remplacer `data/plu-rules-reunion.json`, `cyclones-reunion.json`, `bpf-species-reunion.json`
- **France métropolitaine** : remplacer PEIGEO par les PLU locaux, adapter la RTAA → RT2020, retirer la validation cyclonique
- **Tropical international** : utile pour la phase P13 World qui contient déjà 20 zones Köppen

---

## 11 · Crédits et licence

### Maintenance

**Mathias Giraud** — Architecte DPLG (n° 26.469)
**MGA Architecture** — Saint-Leu, La Réunion
Lead développeur **BIMSHOW** & **TERLAB**
Contact : `mathias@mga-archi.re`

### Institution

**ENSA La Réunion** — École Nationale Supérieure d'Architecture
TERLAB est développé pour le studio Master 1 Semestre 8 « Risques & Territoires Tropicaux ».

### Hébergement

**BIMSHOW** ([bimshow.io](https://bimshow.io)) — Plateforme BIM web de MGA Architecture, écrite en Angular 19 + Three.js r182 + WebGPU + Firebase. TERLAB est servi comme fragment statique sous `/terlab`.

### Licence

**Usage académique** — © MGA Architecture × ENSA La Réunion × BIMSHOW, 2025-2026.

Ce code est distribué pour un **usage pédagogique et de recherche**. Toute réutilisation commerciale, intégration à un produit propriétaire ou diffusion modifiée doit faire l'objet d'un accord écrit avec MGA Architecture.

Les **données embarquées** (`data/*.json`, GeoJSON) restent la propriété de leurs émetteurs respectifs (AGORAH, IGN, BRGM, Météo-France, ENSA, Envirobat Réunion). Leur usage est encadré par les conditions de chacune des sources.

### Sources documentaires citées

- **AGORAH PEIGEO** — Plateforme d'Échange d'Informations Géographiques Réunion
- **IGN Géoportail** — Cadastre, BD TOPO, LiDAR HD, altimétrie
- **BRGM Infoterre** — Géologie, sismicité
- **Météo-France** — API Hub climato
- **DEAL Réunion** — Risques naturels, PLU, environnement
- **Envirobat Réunion** ([envirobat-reunion.com](https://envirobat-reunion.com)) — 14 fiches REX intégrées dans 10 phases
- **Jean-Marie Izard** — Architecture tropicale, 12 documents indexés
- **SCoT TCO/CINOR/CIREST/CIVIS/CASUD** — Schémas de Cohérence Territoriale Réunion
- **PLU des 24 communes de La Réunion** — Sources brutes dans `plu-sources/`

### Remerciements

- L'équipe pédagogique de l'**ENSA La Réunion** pour le cadrage du studio M1 S8
- **Asmahani (Saroumaia)** — interlocutrice ML/réseaux pour la pipeline d'analyse automatisée
- L'**AGORAH** pour la mise à disposition publique de PEIGEO
- La communauté **Envirobat Réunion** pour les retours d'expérience tropicaux
- Les contributeurs **Three.js**, **Mapbox GL JS**, **Turf.js**, **Chart.js** sans qui rien ne serait possible

---

*TERLAB · TERrain LABoratoire · 2025-2026*
*MGA Architecture × ENSA La Réunion × BIMSHOW*
