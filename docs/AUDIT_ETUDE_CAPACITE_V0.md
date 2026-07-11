# Audit — étude de capacité v0 (POC METAFORME_GEN) — 2026-07-10

Fichier audité : [etude-capacite-v0.html](etude-capacite-v0.html) (copié depuis
`C:/GITHUB/METAFORME_GEN/src/` — repo NON versionné, cette copie fait foi).
1337 lignes, vanilla JS + SVG, zéro dépendance. Testé sous Puppeteer : fonctionne
sans erreur console, les 3 vues rendent.

## Objectif de la v1 (cadrage Mathias)

Reprendre l'étude de capacité **avec une vraie parcelle** en fusionnant ce POC
avec les briques construites le 2026-07-10 dans TERLAB :
`services/capacite-polygone.js` (axe dérivé de la parcelle + lame articulée),
`services/geom-inlet.js` (enveloppe robuste), le harnais 10 parcelles types, et
les correctifs de `plan-masse-canvas.js`.

## Forces à conserver (l'ergonomie est la bonne)

1. **3 vues synchronisées** : Parcelle (plan masse) / Bâtiment (plan d'étage
   détaillé) / Axonométrie cabinet — navigation par étage cliquable (RDC…R+n),
   sélection de bâtiment au clic dans toutes les vues.
2. **Dégradation honnête en 3 phases** (`computeAllBuildings`) : perFloor↓ →
   profondeur↓ → mix forcé T1, avec `clampReason` affiché à l'utilisateur
   (« réduit pour tenir zone : logts 4→2 ») et refus de placer si même le
   minimum ne tient pas (`fitError` explicite). Pattern à généraliser à P07
   (c'est l'anti-« fallback silencieux » de l'audit stratégies).
3. **Générateurs typologiques riches** (§5) : 5 typologies, RDC différencié
   (hall + vélos/poubelles), escalier secondaire auto si porte→ESC > 25 m,
   varangues, séchoirs, mix par presets. Le plan d'étage rendu est de qualité
   quasi-planche (portes, X d'escalier, cercle ascenseur, trame patio).
4. **Multi-bâtiments + mitoyenneté simulée** (G/D), métriques agrégées
   CES/COS en pills colorées ok/err.
5. Code lisible, sections numérotées, state unique.

## Faiblesses et bugs (par gravité)

### F1 — Parcelles synthétiques uniquement
`genParcelle` : 5 types procéduraux (seed PRNG). Aucune entrée réelle —
ni GeoJSON cadastre, ni session TERLAB. `voieIdxs` toujours `[0]`,
`classifyEdges` naïf (« fond » = arête horizontale à `my > 5` **hard-codé**,
latérales par x vs centre) : faux dès que la parcelle est tournée ou que la
voie n'est pas l'arête 0.

### F2 — Placement 100 % rectangle axe-aligné
`maxAARect` (raster 32×32 + histogramme) puis split en N tranches égales avec
`interBat = 6` fixe. Conséquences :
- les bâtiments ne tournent jamais (θ=0) → gaspillage massif sur parcelle en
  biais (le rect inscrit AABB d'un trapèze incliné est petit) ;
- la « Lame articulée » a ses angles en **paramètres manuels** (30°/30°) et son
  AABB doit tenir dans le sous-rectangle : l'articulation ne suit pas la
  parcelle — c'est exactement ce que `capacite-polygone.deriveAxis` résout ;
- reliquat buggy dans le split (lignes ~934-940 : premier calcul écrasé,
  rustine `if (subW < 0)`).

### F3 — Zone constructible par demi-plans globaux
`zoneConstructible` = clip par demi-plan par arête : sur-coupe les parcelles
CONCAVES (pentagone/irrégulier du générateur peuvent l'être) — TERLAB a déjà
le fallback raster (`FH.buildZone`) et GeomInlet (arcs, priorités voie/fond,
guard confinement) pour ça.

### F4 — Métriques dépendantes de l'étage affiché
`computeMetrics` compte les logements en itérant `plan.items` — or le plan est
généré pour `currentLevel` : si l'étage affiché est le RDC (hall + vélos à la
place de 2 logements), `nLogts` et la SDP changent. `updateQuick` fait
l'inverse (`pf × levels`) en ignorant le RDC réduit. Les deux sont faux ;
il faut sommer étage par étage réel.

### F5 — Pas de contraintes Réunion
- PLU jouet (4 zones génériques UAa/UB/UC/N hard-codées) — TERLAB a les vraies
  règles par commune + PPR + permMin/CBS ;
- aucun cap RTAA : profondeur libre jusqu'à 13 m (lame) et 20 m (plot) sans
  alerte ventilation ; pas de `cellule-generator.js` (17 plans réels, zones de
  profondeur séchoir/chambre/humide/séjour) ;
- pas de parking, pas de topo/pente, hautOK calculé mais jamais affiché.

### F6 — Divers
- Conventions d'axes : tout est Y-down SVG, voie en haut, nord fixe — à
  aligner sur le pipeline TERLAB (skill coord-systems) lors du portage ;
- pas de persistance (reset au reload), export SVG seulement (bouton) ;
- `interBat = 6` fixe (commentaire « RTAA proposé ») au lieu du PLU
  `interBatMin`.

## Plan de convergence POC v1 (proposition)

Cible : `docs/etude-capacite-v1.html` (puis intégration P07), qui garde
l'ergonomie v0 et remplace la géométrie par les briques TERLAB.

**P0 — vraie parcelle + vraie enveloppe**
1. Entrée parcelle : les 10 parcelles types du harnais (menu) + collage d'un
   GeoJSON/session TERLAB (via `TerrainP07Adapter.process` pour WGS84→local,
   `inferEdgeTypes` pour voie/lat/fond au lieu de `classifyEdges`).
2. Zone constructible : `GeomInlet.inletPolyline` + guard `_inletContained` +
   fallback `FH.buildZone` (le trio validé sur les PNG).

**P1 — placement polygonal**
3. LAME_SIMPLE / ARTICULE : remplacer maxAARect par
   `CapacitePolygone.deriveAxis` + `plateauAlongAxis` — l'articulation suit la
   parcelle, coursive côté voie, fusion au biais, ESC2 auto. Les paramètres
   v0 (perFloor, profondeur, mix, varangue) se mappent 1:1.
4. PLOT / PATIO / DUPLEX : placement rect ORIENTÉ (repère OBB de l'enveloppe,
   pas AABB) dans les slots restants ; slots multi-bâtiments par split OBB
   avec `interBat` = PLU.
5. Conserver la dégradation 3 phases par bâtiment (elle s'applique telle
   quelle : l'axe consommé remplace le sous-rectangle).

**P2 — métriques et contraintes réelles**
6. Métriques étage par étage (RDC différencié) ; caps RTAA (prof ≤ 12 m zone 2
   sur les lames, alerte sinon) ; PLU réel TERLAB (emprMax/permMin/hauteur) ;
   pills Hauteur et logts corrigées (F4).
7. Parking (resolveParking + placement corrigé du 2026-07-10).

**P3 — jonction P07**
8. Le POC devient la vue « Capacité » de P07 : la session fournit parcelle,
   PLU, topo ; le résultat écrit `S.blocs` (footprints polygonaux) + métriques.
   Le viewer étage/axo alimente les planches PDF.

## Statut

**2026-07-11 soir — v2 construite** : [etude-capacite-v2.html](etude-capacite-v2.html)
= POC de référence « 3 scénarios, 1 choix » (A capacité max / B équilibré /
C qualité résidentielle), lames articulées (modèle « bande développée » :
cellules pliées aux joints, coursive/varangue/footprint aux mêmes points
miter) + plots 4 logts, **parking en poches desservies conforme NF P 91-120**
(bataille 2,30×5,00, allée 5,00 m balayée en profondeur, **desserte tracée** :
bateau perpendiculaire sur la voie + bande oblique 5,00 m double sens — à
défaut 2,80 m sens unique — qui se faufile entre les pignons, entrée possible
n'importe où le long de l'allée avec sacrifice compté des places traversées ;
complément SS pointillé sous lame + rampe 15 m ≤ 18 %), prospect f(H), score
alizés, planche client imprimable. Hook debug : `window._dbg` +
`parking._trace` (diagnostic par profondeur de poche).

**2026-07-11 — v1 construite** : [etude-capacite-v1.html](etude-capacite-v1.html)
couvre P0 (8 présets 1000-3000 m² + GeoJSON via TerrainP07Adapter, enveloppe
GeomInlet+guard+buildZone, arêtes éditables au clic voie→lat→mitoyen→fond),
P1 (lame articulée `CapacitePolygone`, dégradation conservée) et une partie de
P2 (métriques RDC différencié, parking resolveParking, pleine terre, alerte
RTAA prof > 12 m). Reste : multi-bâtiments (plots/2e lame), SU réelles via
cellule-generator, P3 jonction P07. Nécessite le serveur local du repo.

## Reproduction

Ouvrir `docs/etude-capacite-v0.html` dans un navigateur (aucun serveur requis).
Screenshots d'état : harnais scratchpad `shot-poc.mjs`.
