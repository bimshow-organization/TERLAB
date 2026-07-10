---
name: exports-pdf
description: >-
  Exports PDF/impression du projet TERLAB (Réunion). Architecture actuelle : PDF A4
  généré via template HTML + print.css injecté dans une iframe cachée puis
  window.print() (PAS de jsPDF — supprimé), moteur components/export-engine.js
  (generatePDF, _renderPlancheN). Batch/QA headless via scripts/random-terrain-pdf.js
  (Puppeteer, page.pdf sur le même template). Couvre : monkey-patch unicode WinAnsi
  (legacy jsPDF), typo Cormorant/Jost/IBM Plex, captures Mapbox pré-export
  (map-capture.js), gotchas Puppeteer (timeouts, WFS code_insee, retry zone U/AU,
  modules ES tués par setTimeout(remove)), convention ASCII pur pour
  data/rapport-phrases.json, export DXF R2000. Utiliser dès qu'on touche à un export,
  une planche, une impression ou le pipeline random. Déclencheurs — PDF, jsPDF,
  export, impression, print.css, @page, iframe, window.print, Puppeteer, headless,
  planches, rapport, rapport-phrases, random-pdf, random-terrain, WinAnsi, unicode,
  DXF, Mapbox capture, WFS, zone U.
---

# Exports PDF TERLAB

## État de l'art (VÉRIFIÉ 2026-07)
Le PDF n'utilise **plus jsPDF** — retiré (`index.html:69` « jsPDF + html2canvas supprimés »). Rendu = HTML + `print.css` + `window.print()`.

- Moteur : `components/export-engine.js` (v3.0). `generatePDF(mode)` @ `:150`.
- Template : `print-template.html` (racine) → charge `assets/print.css`. Root DOM `#terlab-print-root`.
- Captures cartes : `components/map-capture.js`, `MapCapture.captureAll(session)` @ `:14`, appelé `export-engine.js:166`. JPEG dataURL, `preserveDrawingBuffer` requis côté Mapbox.
- Pipeline batch/E2E : `scripts/random-terrain-pdf.js` (Puppeteer headless).

## HTML + print.css (chemin nominal)
1. `MapCapture.captureAll()` → vues Mapbox en JPEG.
2. `_captureVisuals()` → visuels DOM (plan masse, terrain3D SVG).
3. `_autoEnrich()` → enrichissement terrain.
4. `_renderPlancheN(...)` construisent le HTML par planche :
   - `_renderPlanche2_3` `:523` · `_renderPlanche4` `:757` · `_renderPlancheGIEP` `:824` · `_renderPlancheANC` `:890` · `_renderPlanche5_6` `:965` · `_renderPlanche7` `:1177` (planches fusionnées, ~7 pages).
5. Injection iframe cachée + impression : `export-engine.js:233-274` (`iframe.contentWindow.print()`), attente `document.fonts.ready` avant print (`:265`), retrait iframe après (`:277`).

### print.css (VÉRIFIÉ `assets/print.css`)
- `@page { size: A4 portrait; margin: 0; }` `:135` (marge 0, PAS 12mm — les marges sont gérées par `.page`).
- `.page { page-break-after: always; page-break-inside: avoid; }` `:129`, dernier `.page` sans break `:134`.
- Typo (vars `:43-46`) : **Cormorant Garamond** (`--font-display` / `--font-body`), **Jost** (`--font-ui`), **IBM Plex Mono** (`--font-mono`). (Source Serif n'existe PAS — mémoire périmée.)
- Classes planche réelles : `.ph` (header) `:258`, `.pcrd` (cartouche) `:524`, `.hbox` (2 colonnes) `:390`, `.ph-foot` `:565`.
- Fonts chargées via `@fontsource` CDN jsdelivr dans `print-template.html:6-10`.

## Pipeline Puppeteer (`scripts/random-terrain-pdf.js`)
Parcelle random Réunion → toutes phases headless → `page.pdf()`. Gotchas VÉRIFIÉS :
- **Timeouts généreux** : `RANDOM_PARCEL: 90_000` `:52` (WFS + apicarto PLU lents) ; PDF gen 60 s `:888` ; autoEnrich 25 s `:901` ; captures Mapbox 20 s/carte `:931`.
- **WFS cadastre** : champ `code_insee` (jamais `commune`). Filtre CQL `:258`, reconstruction `code_dep`+`code_com` `:395`, propage `:289/:432`.
- **Retry zone U/AU** : si aucune `selectedFeature` en zone U/AU, retente une autre bbox (`:386-388`), max ~3 retries avant fallback ; plafond checks PLU par tentative `:362`.
- **Logique random inline** : écrite directement dans `page.evaluate()` (`:246`, `:311`) — ne PAS dépendre du loader de phase P00.
- **PIÈGE modules ES (symptôme MUET)** : `setTimeout(() => newScript.remove(), 500)` après injection d'un `<script type="module">` supprime le script AVANT résolution asynchrone des imports → code injecté jamais exécuté, aucune erreur. Contournement retenu : exécuter la logique inline via `page.evaluate()` plutôt que patcher le cycle de vie du loader (`index.js:549 loadPhase`). Moins invasif, portable.

## Règle ASCII — `data/rapport-phrases.json`
Toute entrée ajoutée/modifiée doit être **ASCII pur, sans accents** (`text` et `short`). But : rendu stable en headless Puppeteer, zéro souci d'encodage. Écrire « deja, tres, metres, specifique, facade, reglement, operationnel ». Le JSON existant mixe (héritage) mais les nouvelles entrées sont ASCII. Moteur : `services/rapport-phrases-engine.js` (`loadPhrases`, `pickShort`, `buildPluContext`, `buildFullContext`), consommé `export-engine.js:14`.

## Export DXF R2000 (adjacent)
`workers/dxf-worker.js` (PAS `services/` — mémoire périmée). `generateSite3D(scene, opts)` `:215` : entête `AC1015` (R2000) `:229`, terrain 3DFACE par triangle `:271/:314`, bâtiments voisins extrudés, polyline 3D `:323`. Origine locale = centroïde parcelle UTM40S. Guards : footprints < 50 cm rejetés, clamp altitudes LiDAR. Le 3D est couvert par le skill lidar-terrain-3d.

## Legacy jsPDF — monkey-patch unicode (SEULEMENT si réintroduit)
jsPDF 2.5.x mappe mal les caractères hors WinAnsiEncoding : `CO₂`→`CO?`, `≥ 150 m²`→`? 150 m²`, `✓ ✗ ⚠` → carrés. Correctif = patcher `pdf.text` UNE fois avant génération (pas callsite par callsite) :
```js
function _patchTextEncoding(pdf) {
  const MAP = { '₂':'2','₃':'3','✓':'v','✗':'x','⚠':'!','≥':'>=','≤':'<=','–':'-','—':'-' };
  const orig = pdf.text.bind(pdf);
  pdf.text = (str, ...rest) => {
    if (typeof str === 'string') for (const [k,v] of Object.entries(MAP)) str = str.replaceAll(k,v);
    return orig(str, ...rest);
  };
}
```
Alternative robuste : embarquer une TTF Unicode (coûteux en taille PDF). En pratique la migration HTML/print rend ce patch inutile.

## À vérifier
- `_patchTextEncoding` : **introuvable** dans le code actuel ET dans l'archive `.docs/terlab-v0/components/export-engine.js`. Snippet conservé comme leçon uniquement — n'existe dans aucun fichier vivant.
- `_renderPlanche1` (couverture) : non localisé par grep isolé ; vérifier son nom exact / point d'appel dans la boucle de `_buildHTML` (`export-engine.js:290-307`) avant d'y toucher.
- Nombre de planches : mémoire dit 8, TODO dit 7 ; le code rend des planches fusionnées (2_3, 5_6, 7) → compter réellement les pages générées.
- Reste `jsPDF` cité dans `README.md`, `data/references-biblio.json`, `export_terlab.py` (script Python séparé) : vérifier si `export_terlab.py` est un chemin d'export encore utilisé ou du code mort.