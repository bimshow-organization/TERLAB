---
name: plu-reglementaire
description: >-
  Analyse et application du règlement d'urbanisme (PLU/PPR/GPU) dans TERLAB : dérivation de l'enveloppe constructible 3D depuis reculs/prospect/hauteur/emprise, génération multi-blocs de bâtiments par stratégies d'implantation scorées (densité × perméabilité × conformité × coût topo), primitives géométriques buildZone (flag TERLAB_USE_V4_GEOM), classification PPRN multi-points R1/R2/B1/B2/J par échantillonnage WMS 3 m, autodétection ABF/OAP/SUP via API Carto GPU, coefficient de biotope CBS (légal Saint-Pierre Ua/AUa seulement, pédagogique ailleurs), règles de plantation spécifiques Saint-Paul. À utiliser dès qu'on touche à l'enveloppe légale, aux footprints, au scoring d'implantation ou aux contraintes réglementaires d'une parcelle réunionnaise. Déclencheurs — PLU, PPR, PPRN, GPU, SUP, ABF, OAP, CBS, coefficient biotope, reculs, prospect, emprise, CES, COS, enveloppe constructible, Shape Grammar, gabarit, placement, implantation, buildZone, footprint, multi-blocs, GIEP, zone U, prescription, servitude, Saint-Pierre, Saint-Paul.
---

# PLU réglementaire — TERLAB (ENSA La Réunion)

Toutes géométries : **WGS84 = source de vérité**, local mètres uniquement pour contraintes PLU (P11 refactor v2). Piège récurrent : double-flip Y SVG (Y-down) ↔ Three.js (Y-up) → voir skill `coord-systems`.

## 1. Enveloppe constructible — `services/envelope-generator.js`
Pipeline : parcelle locale → `_setback()` (`:652`) applique reculs par arête → exclusion PPRN → clip.
- **Flag v4 géom** (`:672`) : actif si `window.TERLAB_USE_V4_GEOM === true` **ou** `plu.useV4Geom`. Si actif et `FH.buildZone` existe → `FH.buildZone(parcelLocal, reculsArr)` (`:675`) ; fallback `_offsetPolygon(...)` (`:736`) sinon, ou si buildZone renvoie vide/erreur.
- **Exclusion PPRN R1/R2** (`:100`-`:140`) : lit `terrain.pprn_zones_detected` (`:103`) ; pour chaque zone `inconstructible` avec ≥3 pts → convex hull local (`:135`) → `zone.filter(pt => !this._pointInPoly(pt, pprnHull))`. Un bâtiment ne peut empiéter même sur un coin.

## 2. Stratégies d'implantation — `services/auto-plan-strategies.js`
Chaque stratégie retourne des **blocs** `{polygon, theta, w, l, strategy, areaM2, niveaux, hauteur}`. Modèle Proposal v2 : `proposal.blocs[]` = source de vérité ; `bat`/`polygon` dérivés (rétrocompat). Lecture unifiée via `FH.readProposal(prop)`.

**4 stratégies de base :**
- `rect(env,w,l,pir,bearing)` (`:28`) — rectangle orienté PCA (`FH.obb`), centré PIR, rétréci si clip trop agressif.
- `oblique(env,parcel,edgeTypes,w,l)` (`:71`) — aligné sur arête la plus longue **non-voirie**, translation ±3 m si clip faible.
- `zone(env,wallRetreat,areaCap)` (`:131`) — épouse la zone via inset demi-plans `FH._clipHalfPlane`.
- `multiRect(env,w,l,gap=4,nMax=4,bearing)` (`:181`) — N bandes // axe OBB, gap min ; warning (pas rejet) si gaps serrés.

Stratégies étendues portées de v4h : `isohypses` (`:260`, ⊥ pente), `alize` (`:312`, 45° NE bioclim RTAA), `roadAligned` (`:325`), `latMax` (`:358`), `tShape` (`:391`), `cross` (`:421`), `biBarre` (`:450`), `deuxLames` (`:484`), `troisLames` (`:537`), `lShape` (`:607`), `trapezoid` (`:662`), `zoneHull` (`:717`). Tests : `isLongAndNarrow(env,threshold)` (`:737`, défaut 2.5), `isTrapezoidalParcel` (`:747`).

## 3. Scoring — `services/auto-plan-engine.js`
`_generatePareto(...)` (`:411`) construit les familles A1/A2/B1/B2/C1/C2/B3/B4/C2b (+D1 isohypses si pente ≥5 % et azimut connu) (`:435`-`:510`). Mapping famille→stratégie : A1=rect (multi si `isLongAndNarrow(env,2.8)` `:423`), A2=multi, B1/C1=oblique, B2=rect, C2=zone, B3=lshape, B4=trapezoid, C2b=zoneHull.

**Formule réelle** (`:627`-`:635`) :
`score = densScore × permScore × confScore × costScore`
- `densScore = nLgts / max(1, parcelArea/10000)`
- `permScore = permPct/100` (permPct = 100 − emprise%)
- `confScore = 1` si `empPct ≤ emprMax+1 && he ≤ heMax && cosOk` sinon `0.5`
- `costScore = 1/√(coutMultiplicateur topo)`

Tri final `solutions.sort((a,b)=>b.score-a.score)` (`:223`) ; fallback house-generator à `score=0.1`. Pilotis : SP calculé sur `nv-1` étages habitables (`:606`).

## 4. Primitives buildZone — `services/footprint-helpers.js` (`FH` / `window.FootprintHelpers`)
- `buildZone(poly,reculs)` (`:680`) → `_buildZoneConvex` (`:688`, clip demi-plans) si convexe, sinon `_buildZoneRaster` (`:706`, cellSize 0.42 m).
- `bandPoly(poly,i,r)` (`:661`), `maxInscribedAABB(zone,48,48)` (`:945`, grille 48×48), `maxInscribedRotAABB(zone,thetaRad)` (`:999`), `concaveArcs(poly,reculs,18)` (`:1115`), `_clipHalfPlane` (`:182`).

## 5. Classification PPR — `services/ppr-sampling-service.js`
`sampleParcel(parcelGeo, map)` (`:28`) — classe **toute la parcelle**, pas le centroïde.
- `ZONE_COLOR_MAP` (`:13`) : **R1/R2** = inconstructible, **B1/B2** = conditionnel, **J** = vigilance.
- Grille 3 m dans le polygone (`_buildGrid` `:183`, ray-casting).
- Méthode primaire = image WMS **PEIGEO** offscreen `ppr_approuve` (`_sampleFromWMSImage` `:108`), sampling pixel par point (`_classifyColor` `:226`, seuil distance RGB 100). Fallback WMS GetFeatureInfo sur ≤8 sondes si l'image échoue.
- Setback : pts en zone R exclus (voir §1). Export polygones locaux via convex hull `toLocalPolygons` (`:276`) / `toGeoPolygons` (`:305`).

## 6. Autodétection ABF/OAP/SUP — `services/plu-service.js`
`detectConstraints(lat,lng,documentId)` (`:339`) — `Promise.allSettled` sur 3 requêtes (`:351`) :
- **ABF** : `prescription-surf`, `typepsc === '07'` (MH) ou `startsWith('AC')` (`:362`-`:366`) ; fallback assiettes SUP catégorie AC* / regex monument (`:374`-`:384`).
- **SUP HT** : `assiette-sup-s`, catégorie `I4` ou regex haute-tension/RTE/EDF (`:387`-`:392`).
- **OAP** : `getDocumentFiles(documentId)` filtré `type === 'oap'` (`:398`-`:404`).
Couches GPU génériques (overlay) : `services/gpu-fetcher.js` `ENDPOINTS` (`:15`-`:24`, allSettled `:34`). Badges "AUTO" P04/P05 dans les HTML (ne jamais écraser une saisie user).

## 7. CBS — `services/cbs-calculator-service.js`
`CBS_COEFFS` (`:15`) : imperméable 0 · semi-perméable 0,5 · dalle plantée 0,7 · toiture végétalisée 0,7 · pleine terre 1,0. CBS = A(éco)/B(parcelle).
**Légal uniquement Saint-Pierre 97416** — `CBS_EXIGENCES` (`:48`-`:54`) : Ua/AUa `cbs_min ≥ 30 %`, `pleine_terre ≥ 20 %` (Éco-PLU Ua5/AUa5). Partout ailleurs = **indicateur pédagogique** (badge INDICATEUR).
- `compute(surfaces, B)` (`:72`), `computeFromSession(session)` (`:185`).
- Adapter `services/plu-p07-adapter.js` : convertit `cbs.gt250m2_cbs_min_pct` → `permMin` quand `permeable_min_pct` absent (`:219`-`:225`) ; expose bloc `cfg.plu.cbs` (`:278`-`:286`, y compris dérogation hauteur si CBS >60/70 %).
- Widget `components/giep-score.js` : `CBSCalculator.computeFromSession(sessionData)` (`:60`), badge CONFORME/NON CONFORME (SP) vs INDICATEUR (`:70`-`:73`).

## 8. Scope communes (feedback validé)
- **Saint-Paul 97415** = golden standard ; règles de plantation spécifiques (inter-arbres 4 m, recul arbuste 1,5 m, 3 strates) implémentées **uniquement** pour Saint-Paul. Autres communes → Code Civil Art. 671 par défaut. Ne pas ajouter d'autres communes sans demande explicite.
- CBS réglementaire = Saint-Pierre uniquement (voir §7).

## À vérifier (pointeurs morts corrigés / mémoires obsolètes)
- **`services/placement-strategies.js` N'EXISTE PAS** — le "registry" (CompactAA/AlignVoirie/AlignFond/EpouseZone, scoring `area×compactness×cesPenalty`) est obsolète. Réalité : stratégies dans `auto-plan-strategies.js`, scoring dans `auto-plan-engine.js:635` (§3).
- **`services/giep-optimizer.js` N'EXISTE PAS** — pas de `suggestImprovements` trouvé. GIEP réel : `services/giep-calculator-service.js` + `components/giep-score.js`. L'auto-suggest greedy décrit en mémoire est non implémenté (ou déplacé) → à confirmer avant de s'y référer.
- **`inferEdgeTypes(parcel,edges)` absent de `footprint-helpers.js`** — la classification d'arêtes (voie/fond/lat) provient d'`edgeTypes` fourni par `components/esquisse-canvas.js` (classifyEdges, P11 v2), pas d'une primitive FH. À vérifier si portage v4h prévu.
- Mémoire PPR : décrivait Mapbox `queryRenderedFeatures`/WebGL. Réalité = **image WMS PEIGEO offscreen** + fallback GetFeatureInfo, et classe **J** en plus de R1/R2/B1/B2.
- `services/plu_schemas_extractor.py` (pipeline extraction schémas PDF) non vérifié dans ce repo — confirmer présence avant usage.
