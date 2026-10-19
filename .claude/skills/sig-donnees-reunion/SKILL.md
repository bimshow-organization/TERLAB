---
name: sig-donnees-reunion
description: >-
  Catalogue opérationnel des sources SIG/données ouvertes branchées dans TERLAB (La Réunion) : endpoints exacts, noms de couches, profils, seuils et pointeurs fichier:ligne vérifiés. Couvre le GeoServer PEIGEO/AGORAH (WMS/WFS PPR/PLU), l'API Géorisques (risques au point), la Géoplateforme IGN (WFS BDTOPO tronçons de route, WMS COSIA végétation IA, WMS ortho, isochrones Valhalla, géocodage BAN), BDNB/OSM pour l'âge du bâti, geo.api.gouv.fr (cadastre/communes), les 5 intercommunalités (table INSEE→interco) et les 5 SCoT (fichiers scot-rules-*.json). Documente les patterns résilients (resilientJSON, Promise.allSettled, fallbacks HTTP→HTTPS, compensation relief), les pièges (Mixed Content PEIGEO, BDNB hors DROM) et l'auto-enrichissement PDF. Déclencheurs — PEIGEO, GeoServer, AGORAH, WFS, WMS, BDTOPO, COSIA, ortho IGN, Géoplateforme, cadastre, Géorisques, PPR, BDNB, âge bâti, BAN, géocodage, isochrone, Valhalla, SCoT, interco, INSEE, geo.api.gouv.fr, végétation, resilientJSON.
---

# SIG & données ouvertes — TERLAB Réunion

Catalogue des sources externes câblées dans TERLAB. Toutes URLs/couches/pointeurs vérifiés contre `C:\GITHUB\TERLAB`. Base fetch résiliente : `utils/resilient-fetch.js` → `resilientJSON(url,{fallback,retries,timeout})` (:123) et `resilientFetchFirst(urls,opts)` (:137). Il n'existe PAS de `resilientFetch` nu.

## PEIGEO / AGORAH GeoServer (public, sans clé)
- WMS : `http://peigeo.re:8080/geoserver/peigeo/wms` — `services/ppr-service.js:22` (`PEIGEO_WMS_URL`).
- WFS : `https://peigeo.re:8080/geoserver/wfs` — `services/corpus-collector.js:12` ; aussi `tools/saintleu-splat-viewer/layers-registry.js:82,113`.
- Couches connues : `ppr_approuve`, `pos_plu_simp`, `communes`, `cn_agorah`, `cache_974_v2`. GetMap + GetFeatureInfo.
- PIÈGE Mixed Content : PEIGEO est en `http:` → bloqué en prod HTTPS. `ppr-service.js` désactive l'overlay WMS en contexte HTTPS (`disabled=_isHttpsContext`, :36) et bascule sur Géorisques.

## Risques — Géorisques (primaire) + PEIGEO (fallback)
- `services/ppr-service.js` — `queryPoint(lat,lng)` (:42) : Géorisques HTTPS d'abord (marche partout), PEIGEO WMS seulement en HTTP local.
- Endpoint Géorisques : `resultats_rapport_risque?latlon=LNG,LAT&rayon=100` (ordre lng,lat). Donne présence/absence des risques au point ; pas de zonage fin R1/R2/B1/B2 (ça vient de PEIGEO).
- Retour : `{ source, features, count, risques?, error? }`.

## BDTOPO tronçons de route (WFS Géoplateforme)
- `services/bdtopo-service.js` — `fetchRoutes(lat,lng,radius_m=300)` (:67). Base `WFS_BASE` = `https://data.geopf.fr/wfs/ows`.
- Params : `SERVICE=WFS VERSION=2.0.0 REQUEST=GetFeature TYPENAMES=BDTOPO_V3:troncon_de_route OUTPUTFORMAT=application/json COUNT=100 BBOX=lng-,lat-,lng+,lat+,EPSG:4326`. Timeout 10 s, retour `null` si échec.
- Attributs utiles : `largeur_de_chaussee` (m), `importance` (1-5), `nature`, `cpx_numero` (RN/RD/VC). Normalisation `routesToStreets()` (:94).
- Usage edge-typing : voie retenue si `importance<=3` ET `largeur>=3 m` ; chemins/sentiers ignorés. Préféré à `queryRenderedFeatures` Mapbox (couche `road` sans largeur/nature).

## Végétation — COSIA IGN (WMS pré-classé IA)
- `services/vegetation/vegetation-detection.js` — `_detectCOSIA()` (:110), méthode primaire ; fallback `_detectOBIA` (NDVI ortho).
- WMS : `IGN_WMS='https://data.geopf.fr/wms-r/wms'` (:10) ; couche `IGNF_COSIA_2021-2023` (:12). Aussi `services/parking-detection.js:16-17`.
- Requête : `SERVICE=WMS VERSION=1.3.0 REQUEST=GetMap LAYERS=IGNF_COSIA_2021-2023 CRS=EPSG:4326 BBOX=latMin,lngMin,latMax,lngMax WIDTH=1024 HEIGHT=1024 FORMAT=image/png`.
- Masque végétation `_cosiaVegetationMask()` (:160) : `greenDom = G>R+10 && G>B+10 && G>50` ET `notOliveCrop = !(R>150&&G>150&&B<120&&|R-G|<40)`. Blobs filtrés `minBlobArea_m2=4`, `maxBlobArea_m2=300`. Classes vertes = Conifères/Feuillus/Broussailles ; exclut cultures (jaune), vignes (magenta), sol (tan), eau, bâti. Fallback si WMS échoue ou masque vide.
- Ortho IGN : couche `HR.ORTHOIMAGERY.ORTHOPHOTOS` (:11).

## Isochrones — Géoplateforme Valhalla
- `services/isochrone-service.js` — `fetch(lat,lng,profile='pedestrian',costSec=900)` (:28).
- ENDPOINT `https://data.geopf.fr/navigation/isochrone` (:9), `resource=bdtopo-valhalla` (:10). Point transmis en **lng,lat**.
- Profils supportés : `pedestrian`, `car`. Compensation relief Réunion : `WALK_KMH=4` vs `WALK_KMH_NATIVE=5` → `effectiveCost = costSec * 4/5` (×0,8) pour le piéton (:35). Cache mémoire `Map` clé `lat|lng|profile|sec` (:29).

## Âge du bâti — BDNB (métropole) + OSM (DROM)
- `services/building-age-service.js` — `fetch(lat,lng,radius=300)` (:30).
- `BDNB_API='https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe'` (:22). PIÈGE : La Réunion **non couverte** — `_isReunion()` (:25, `lng∈]55,56[ & lat∈]-21.5,-20.7[`) → skip BDNB, fallback OSM `start_date` (Overpass), puis « inconnu ».
- 5 tranches (:12-18) : `pre1950` (<1950), `pre1975` (1950-1974), `rt1975` (1975-1999), `rt2000` (2000-2012), `rt2012` (≥2013), avec couleur + risque plomb/amiante.

## Géocodage inverse — BAN IGN + Nominatim
- `phases/p00-identification.html` — `_reverseGeocode(lng,lat)` (:921), fire-and-forget après parcelle trouvée, anti-écrasement (ne remplit que si champ vide).
- IGN BAN : `https://data.geopf.fr/geocodage/reverse?lon=LNG&lat=LAT&limit=1&index=address` (:924). Fallback Nominatim `.../reverse?lat=&lon=&format=json&zoom=18` (:931). Même pattern dans `scripts/random-terrain-pdf.js:417,423`.

## Cadastre & communes — geo.api.gouv.fr (sans clé)
- Service : `services/cadastre-context-service.js` (contexte cadastral, `contenance`/`contenanc` m²).
- Commune depuis INSEE : `https://geo.api.gouv.fr/communes/{insee}?fields=nom` — `scripts/random-terrain-pdf.js:277,408`.

## Intercommunalités (INSEE → interco)
- Table autoritaire : `services/reunion-constants.js:174` `INTERCO_MAP` (dérivée dans `services/terrain-analysis-service.js:20`). Il n'y a PAS de `reunion-interco-service.js`.
- CINOR : 97411, 97418, 97420 · CIREST : 97402, 97406, 97409, 97410, 97419, 97421 · TCO : 97407, 97408, 97413, 97415, 97423 · CIVIS : 97401, 97404, 97405, 97414, 97416, 97424 · CASUD : 97403, 97412, 97417, 97422.
- Communes : `COMMUNES_REUNION` (:191).

## SCoT (5 intercos → règles)
- `services/scot-service.js` — `loadRules(interco)` (:41) charge `data/scot-rules-${slug}.json` via `new URL(...,import.meta.url)` (:47, robuste GitHub Pages). `getInterco(insee)` (:65).
- Fichiers présents : `data/scot-rules-{tco,cinor,cirest,civis,casud}.json`. Clés = `TCO CINOR CIREST CIVIS CASUD`.
- Statuts : **TCO** Ouest approuvé 21/12/2016, modifié 03/10/2022 (5 rangs, 50/30/20-30/10-20 lgts/ha, 60 % aidés). **Grand Sud** (CIVIS+CASUD, SMEP Grand Sud) approuvé 18/02/2020 (5 rangs 10-50 lgts/ha, 40 % aidés). **CINOR** en révision (DOO v6 oct 2024, non approuvé — JSON = prescriptions projet). **CIREST** SANS SCoT (abrogé 13/12/2018, seul le SAR 2011 opposable). Règle **ZATT 500 m** commune : densité min 50 lgts/ha à ≤500 m d'un arrêt TCSP/RRTG.

## Auto-enrichissement PDF
- `components/export-engine.js` — `_autoEnrich(session,terrain)` (:1963) appelé avant mise en page (:174). Re-fetch parallèle `Promise.allSettled` (:1976). Marquage `source:'auto'` (italique bleu + badge AUTO) vs `'confirmed'`. Idem `scripts/random-terrain-pdf.js:551,900`.

## Références biblio Envirobat
- Affichage : `components/envirobat-cards.js` (+ CSS assets). Index : `data/references-biblio.json`. Ajout de fiches via `FICHES[]` + `PHASE_PICKS{}`.

## Données brutes téléchargées — Litto3D, niveaux marins, PPRL
- Catalogue versionné : `docs/sources/README.md`. Il couvre Litto3D Réunion 2016 (MNT terre-mer 1 m, blocs par secteur, données locales non commitées dans `docs/sources/litto3d/`), les niveaux marins SHOM (ZH / IGN89, plus haute mer) et la méthode de submersion des PPRL. Les tuiles de ville de code-runner s'en servent (`tools/city/import-litto3d.mjs`, `coast-classes.mjs`, `litto3d-coverage.mjs`).
- Repère vertical : Litto3D, LiDAR HD et RGE ALTI sont tous en REUN89 → aucun recalage ; 0 m IGN89 ≈ niveau moyen de la mer (±5 cm).

## À vérifier (mémoire potentiellement périmée vs code)
- **Géorisques ICPE/BASIAS auto-detect** : `services/georisques-service.js` N'EXISTE PAS. Aucun appel à `installations_classees` (rayon 1 km) ni `/ssp` BASIAS (500 m) dans le code applicatif (seulement métadonnées `data/*.json` + stub `__stubs__/georisques-proxy.js`). `terrain.icpe` est un champ **manuel** Non/Oui/À vérifier (`export-engine.js:1045`). Le service risques réel = `ppr-service.js` (rapport risque au point), pas d'ICPE/BASIAS.
- **Cadastre comparables** : `services/cadastre-comparables.js` N'EXISTE PAS (seul `cadastre-context-service.js`). Le pipeline « comparables même zone PLU ±30 % + CES observé » n'est pas implémenté.
- **INTERCO_MAP mémoire** : les codes listés dans `skill_interco_wfs_autodetect.md` étaient FAUX ; référence unique = `reunion-constants.js:174` (ci-dessus).
- **BDNB URL mémoire** : `bdnb-api.staging.cstb.fr` obsolète → réel `api.bdnb.io/v1/bdnb/donnees/batiment_groupe`.
- **Isochrone** : la mémoire disait « ×1,25 » ; le code applique ×0,8 (4/5) au budget temps piéton. Profil `bicycle` non implémenté (uniquement `pedestrian`/`car`).
- **Tranches âge bâti** : la mémoire décrit T1-T5 RTAA DOM ; le code utilise pre1950/pre1975/rt1975/rt2000/rt2012 (bornes/couleurs différentes).
- **`services/reunion-constants.js`** est sous `services/` (mémoire le référençait parfois en racine).
- Overlay COSIA dans `phases/corpus-viewer.html` (~ligne 806) : présence non revérifiée.