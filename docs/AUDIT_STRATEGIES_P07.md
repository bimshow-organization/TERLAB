# Audit des stratégies d'esquisse P07 — 2026-07-10

## Méthodologie

Harnais headless exécutant le **vrai** `_applyScenarioGeometry` (chaîne complète :
cible CES, escalade multi, expandToMit, guards) sur **15 stratégies × 10 parcelles
types** (rectangle, trapèze oblique, pointe aiguë, L concave, drapeau, limite
courbe, mitoyen, bande étroite 9 m, reculs mixtes, octogone à 2 rentrants).
PLU test : emprMax 60 %, permMin 25 %, RTAA zone 2 (largeur ventilation 12 m),
programme collectif R+1, slider emprise 100 %.

Mesures par combo : emprise vs cible CES, **débordement hors enveloppe**,
**chevauchement inter-blocs**, dimension mini du plus gros bloc (RTAA),
détection du **fallback PIR silencieux** (stratégie ayant rendu `[]`).

Script : scratchpad `audit-strategies.mjs` (réutilise `PMC._geom`).

## Synthèse (nombre de parcelles en défaut sur 10)

| SC | stratégie | déborde env | chevauche | fallback PIR | CES>60% | <50% cible | minDim>12m |
|----|-----------|:---:|:---:|:---:|:---:|:---:|:---:|
| A1 | rect | 1 | 1 | 2 | 2 | 3 | 4 |
| A2 | multi | 1 | 0 | 1 | 2 | 2 | 4 |
| B1 | oblique | 1 | 1 | 2 | 2 | 3 | 4 |
| B2 | rect | 1 | 0 | 2 | 1 | 3 | 3 |
| B3 | lshape | 0 | 0 | 0 | 0 | 3 | 6 |
| B4 | trapezoid | **6** | 0 | **6** | 1 | 3 | 7 |
| C1 | oblique | 1 | 0 | 2 | 1 | 3 | 3 |
| C2 | zone | 0 | 0 | 0 | 2 | 2 | 7 |
| C2b | zoneHull | 0 | 0 | 0 | 1 | 2 | 7 |
| D1 | isohypses | 1 | 0 | 2 | 1 | 3 | 3 |
| T | tShape | 0 | **10** | 0 | 0 | 5 | 1 |
| X | cross | 0 | **9** | 0 | 0 | 6 | 0 |
| BB | biBarre | **7** | 1 | **7** | 4 | 2 | 6 |
| 2L | deuxLames | 3 | 0 | 2 | 3 | 0 | 3 |
| 3L | troisLames | 1 | 0 | 1 | 1 | 2 | 1 |

Pires cas : `BB×L-concave` emprise 905 m² pour 422 de cible (**CES 129 % — plus
grand que la parcelle**, 619 m² hors enveloppe) ; `T×courbe` 150 m²
double-comptés ; `A2/BB/2L/3L×drapeau` 357 m² hors enveloppe.

## Causes racines (par ordre d'impact)

### RC1 — Le fallback PIR ne clippe jamais et ne dit rien
`plan-masse-canvas.js` `_applyScenarioGeometry`, bloc final (« Fallback :
rectangle centré PIR ») : quand une stratégie rend `[]`, un rect
`wTarget×lTarget` est posé au pôle d'inaccessibilité **sans clip contre
l'enveloppe ni la parcelle**, et **sans avertissement** — l'étudiant croit voir
la stratégie choisie. C'est la source de TOUS les débordements mesurés
(B4 6/10, BB 7/10…) et du screenshot Saint-Paul. Le rect fallback hérite en
plus de `wTarget/lTarget` calculés pour l'OBB entier → CES jusqu'à 129 %.

### RC2 — tShape et cross : parts superposées, jamais dé-dupliquées
`auto-plan-strategies.js:391/421` : bar et stem sont deux rects **centrés sur
le même point** ; leur intersection (le cœur du T/X) est comptée deux fois
dans l'emprise (`_totalBlocArea` somme les aires). 10/10 et 9/10 parcelles en
chevauchement (jusqu'à 150 m²). Ni `cibleM2`, ni caps RTAA/profMax ne leur
sont transmis (`AS.tShape(env.poly)` sans arguments de taille) → le « T »
remplit le rect inscrit entier. Le rendu de l'union ressemble à un simple
rectangle (cf. screenshot « Maison 23.5×17 »).

### RC3 — trapezoid et biBarre échouent sur leurs parcelles cibles
`B4 trapezoid` rend `[]` sur 6/10 parcelles **dont le trapèze** (sa raison
d'être, `requires: 'trapezoid'`). `biBarre` exige `(Lp-3)/2 ≥ MIN_L` sur le
rect inscrit → `[]` sur 7/10. Chaque échec bascule sur RC1.

### RC4 — Caps RTAA appliqués aux seuls mono-blocs
`_applyScenarioGeometry` : `rtaaW`(12 m) et `profMax` ne capent que
`rect/oblique/isohypses`. zone/zoneHull/lshape/biBarre produisent des blocs de
14 à 26 m d'épaisseur (7/10 parcelles pour C2/C2b) — non ventilables
naturellement (RTAA DOM), inutilisables en logement.

### RC5 — Le guard « retirer les plus petits » ampute les compositions
Guard cibleM2×1.15 (tri par aire, suppression des petits) : sur tShape il
supprime le stem (le T redevient barre), sur biBarre il peut supprimer le
noyau reliant. Il faudrait **réduire homothétiquement la composition**, pas
l'amputer.

### RC6 — deuxLames / troisLames travaillent en AABB écran
`auto-plan-strategies.js:484/537` : split médian sur X/Y **monde** (pas le
repère OBB de la parcelle). Sur parcelle oblique (trapèze Saint-Paul), les
lames sortent désaxées par rapport à la voie et `maxInscribedAABB` sous-remplit.

### RC7 — FH.clipPolygon = Sutherland-Hodgman avec clip potentiellement concave
`footprint-helpers.js:156` itère les demi-plans du polygone de **clip** : faux
dès que l'enveloppe est concave (L, encoches, certains inlets à arcs). Toutes
les stratégies clippent leurs rects ainsi. Même famille de bug que celui
corrigé dans les bandes de recul (`clipSH`) le 2026-07-10.

### RC8 — Sous-utilisation structurelle des parcelles non convexes
L concave / drapeau / octogone : 3 à 43 % de la cible seulement (toutes
stratégies rect-based). Les stratégies pensent rectangle inscrit — c'est la
motivation du chantier « capacité polygonale » (`services/capacite-polygone.js`,
lame articulée le long de l'enveloppe) qui doit devenir une stratégie à part
entière.

### RC9 — Divers
- `D1 isohypses` sans azimut → `rawBlocs=[]` → RC1 (l'UI le désactive, mais
  autoPlace/session peuvent l'invoquer).
- Escalade multi + expandToMit : 2 blocs poussés sur la même zone mitoyenne se
  chevauchent (A1/B1×mitoyen : 123 m²).
- `StrategyRegistry` référencé (`window.StrategyRegistry`) mais **inexistant**
  dans le repo → le chemin « registry avec dégénération/mutation/fallback
  intégrés » est du code mort ; c'est le fallback legacy qui tourne.

## Recommandations (ordre de traitement proposé)

1. **RC1** — ✅ **TRAITÉ 2026-07-10** — filet de sécurité universel en sortie de
   `_applyScenarioGeometry` : chaque bloc clippé contre l'enveloppe (clip
   convexe-aware `interPoly`), rect de repli PIR clippé lui aussi (sans snap
   post-clip), et notification `TerlabNotification` AVERTISSEMENT dédupliquée
   quand le repli s'active (`_notifyStrategyFallback`, flag `S._strategyFallback`).
   Guard empilé, les clips internes des stratégies restent. Re-audit :
   **0 m² de débordement sur les 150 combos** (contre 619 m² au pire avant).
2. **RC2** — ✅ **TRAITÉ 2026-07-10** — tShape/cross réécrits en UN polygone
   composé (`_composedShape` : T 8 sommets barre+descente, X 12 sommets),
   dimensionné par bissection sur cibleM2 (aire exacte), épaisseurs d'ailes
   capées rtaaW. Le dispatch transmet `{ cibleM2, rtaaW }`. Re-audit :
   chevauchement T 10/10 → **0/10**, X 9/10 → **0/10** ; les parcelles où les
   ailes ≥ 4 m ne tiennent pas (pointe, bande 9 m) passent par le repli
   notifié RC1. NB : la colonne « minDim>12 » de l'audit mesure l'OBB global
   du bloc — pour une forme composée c'est l'encombrement, pas l'épaisseur
   d'aile (qui est bien ≤ 12) ; métrique à affiner si besoin.
3. **RC4** — appliquer `rtaaW` comme cap d'épaisseur à TOUTES les stratégies
   (largeur de bande, épaisseur de lame).
4. **RC3** — assouplir trapezoid/biBarre (réduction progressive avant `[]`).
5. **RC6** — porter deuxLames/troisLames dans le repère OBB.
6. **RC5** — guard homothétique au lieu de l'amputation.
7. **RC7** — clip convexe-aware dans FH.clipPolygon (ou raster fallback,
   pattern skill geometrie-2d).
8. **RC8** — intégrer `capacite-polygone.js` comme stratégie « Lame articulée »
   (chantier en cours, validé sur PNG).

## Reproduction

`node audit-strategies.mjs` (scratchpad session) — sortie : synthèse par
stratégie, pires combos, sous-utilisation. Les 10 parcelles types sont celles
des PNG de validation `terlab-recul-cases.png` / `terlab-capacite-cases.png`.
