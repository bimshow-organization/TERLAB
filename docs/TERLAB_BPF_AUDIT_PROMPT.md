# PROMPT CLAUDE CODE — Audit TERLAB × BPF : Intégration bibliothèque végétale multi-style

> **Objectif** : Auditer précisément le point de contact TERLAB ↔ BPF (p11/bpf-bridge),
> identifier tous les + et - de l'intégration actuelle, puis implémenter un système de
> **bibliothèque végétale sélectionnable par l'étudiant** avec plusieurs styles visuels
> mais une géométrie solide et cohérente en plan masse SVG.
>
> **LIRE EN PREMIER** :
> ```
> CLAUDE.md                                 ← règles Vanilla JS strict, postMessage only
> services/bpf-bridge.js                    ← 40Ko — le cœur de l'intégration (lire en entier)
> services/bpf-garden-advisor.js            ← 3Ko — conseil jardin par zone/enveloppe
> data/bpf-species-reunion.json             ← base espèces (35 espèces, gardenPatterns, etc.)
> phases/p11-esquisse.html                  ← 638L — consommateur principal du bridge
> phases/p07-esquisse.html                  ← 4479L — esquisse 3D + bridge BIMSHOW
> services/vegetation/topview-symbols.js    ← symboles SVG vue-dessus
> components/giep-score.js                  ← score biodiversité GIEP (consommateur indirect)
> ```

---

## PARTIE 0 — AUDIT COMPLET : POINTS FORTS ET FAIBLESSES

### ✅ CE QUI FONCTIONNE BIEN (à préserver impérativement)

**A. Algorithme Poisson Disk (Bridson 2007) — robuste et déterministe**
`_poissonDisk()` dans `bpf-bridge.js` est une vraie implémentation avec :
- RNG seedé par coordonnées GPS (`_seededRng(lat * 10000 + lng * 10000)`) → résultats
  reproductibles pour la même parcelle
- Grid acceleration 2D correcte (cellSize = minDist / √2, cols × rows)
- Safety counter (50 000 iterations max) pour éviter les boucles infinies
- Double guard : point doit être dans `poly` ET dans `parcelLocal`

**→ Ne pas toucher à cet algorithme. Il est correct.**

**B. Gestion des reculs réglementaires (Code Civil Art. 671 + PLU)**
`PLANTATION_RULES_COMMUNE` / `PLANTATION_RULES_DEFAULT` / validation par `reculLimite` :
- Distinction arbre/palmier/arbuste botaniquement justifiée
- Saint-Paul PLU Art. 13 entièrement implémenté (4m inter-arbres, 200m² ratio)
- Règles héritées correctement via `_getPlantationRules(session)`

**→ À étendre aux autres communes prioritaires (Saint-Denis, Saint-Pierre).**

**C. Décomposition de zones polygonales complexes**
`_offsetPolygonPerEdge()` + `_clipHalfPlane()` = Sutherland-Hodgman correct, robuste
pour les parcelles réelles irrégulières. Évite les spikes sur arêtes quasi-parallèles.
`_decomposeZones()` produit les 4 types de zones : bande_voie, fond_parcelle, lateral,
residuel — tous consommés par le scatter.

**→ Architecture de zones : correcte et solide.**

**D. Placement d'amenities intelligent**
`_placeAmenities()` : priorité ordonnée (terrasse → pergola → piscine → ...), stratégies
par type (adjacent_bati / bande_voie / fond_parcelle), collisions rectangulaires
correctes, buffer bâtiment respecté.

**→ Bien implémenté. Compléter le JSON amenities.**

**E. Sélection espèces par zone climatique + pattern**
`_selectPattern()` + `_zoneKey()` : mapping alt/lat/lng → littoral/mipentes/hauts correct.
`gardenPatterns` dans le JSON avec strates pondérées par zone = sélection botanique sensée.

---

### ❌ CE QUI NE FONCTIONNE PAS / MANQUE

**DÉFAUT 1 — UN SEUL STYLE VISUEL SVG (svgSymbol = string fixe)**

Dans `bpf-species-reunion.json`, chaque espèce a `svgSymbol: "broadleaf"` ou `"palm"`.
Ce string est utilisé dans le rendu SVG p11 pour choisir le symbole. Il n'y a qu'un seul
style de symbole par espèce — pas de variante "schématique" vs "détaillé" vs "photorealistic".

L'étudiant architecte a besoin de styles différents selon le contexte du rendu :
- **Schématique** : cercle + croix (standard architecte, PN, DICT)
- **Botanique** : silhouette feuille + canopée (TERLAB pédagogique)
- **Presentationnel** : symbole riche avec texture et fleur (dossier APC)
- **Aquarelle/Esquisse** : trait irrégulier (rendu à la main assisté)

**DÉFAUT 2 — BASE 35 ESPÈCES TROP PETITE**

35 espèces pour couvrir 3 étages (littoral/mipentes/hauts) × 5+ types de zones est
insuffisant. En pratique, certains patterns retombent toujours sur les mêmes 5-6 espèces
(manguier, bananier, palmiste, bougainvillea, filao). L'étudiant voit les mêmes espèces
sur tous les sites, ce qui n'est pas pédagogique.

Manquent :
- Espèces indigènes : Dombeya, Nuxia, Sophora denudata, Sideroxylon, Diospyros
- Espèces fruitières locales : letchi, jacquier, vavangue, ambrevade
- Espèces de haie : Codiaeum, Euphorbia milii, Duranta
- Espèces couvre-sol : Rhoeo, Tradescantia, Arachis pintoi
- Graminées : Vetiver, Panicum maximum, Miscanthus

**DÉFAUT 3 — PAS DE CHOIX PAR L'UTILISATEUR**

`BpfBridge.generate()` est entièrement automatique. L'étudiant reçoit une végétation
calculée sans pouvoir :
1. Choisir une bibliothèque thématique ("jardin indigène" vs "fruitier créole" vs "agrément")
2. Choisir le style visuel du rendu SVG
3. Éditer manuellement une espèce (remplacer une plante automatique)
4. Verrouiller/déverrouiller certaines zones (garder la piscine auto mais changer les arbres)

**DÉFAUT 4 — GÉOMÉTRIE SVG : canopyRadius FIXE, PAS D'ORIENTATION**

Dans `_drawVegetation()` (p11), chaque plant est rendu avec `canopyRadius` comme cercle
simple. Pour les arbres fastigiés (palmiste, cyprès), le cercle sur-représente la largeur.
Pour les arbres étalés (badamier, ficus), il la sous-représente.

De plus, aucune orientation de la couronne (vent dominant, ensoleillement) n'est simulée
en SVG — tous les arbres sont des cercles parfaits.

**DÉFAUT 5 — PAS DE CONNEXION AVEC p06 BIODIVERSITE**

p06 calcule :
- La présence d'espèces protégées (TVB, ZNIEFF)
- La nature écologique du terrain (zone humide, forêt indigène, coteau)

Ces données ne sont PAS utilisées par `BpfBridge.generate()` pour orienter le choix
d'espèces. Un terrain en zone ZNIEFF 1 devrait forcer `especes_indigenes_prioritaires`
et exclure les espèces invasives (goyavier, ajonc). Aujourd'hui c'est silencieux.

**DÉFAUT 6 — PAS DE CALCUL OMBRE / RTAA**

RTAA DOM Art. 5 : les arbres sont des protections solaires. Le bpf-bridge ne calcule pas
l'ombre projetée par les arbres plantés sur les ouvertures du bâtiment. Un arbre à < 3m
d'une fenêtre peut obstruer ou au contraire protéger — aucune info donnée à l'étudiant.

**DÉFAUT 7 — PAS D'EXPORT VERS BPF 3D**

Les plants générés par `bpf-bridge.js` ont `speciesKey`, `trunkH`, `canopyRadius` — tous
les champs nécessaires pour appeler BPF PlantFactory via postMessage et générer un vrai
modèle 3D. Mais ce pont TERLAB → BPF 3D n'est pas implémenté en p11. p07 a le bridge
BIMSHOW mais pas pour la végétation de plan masse.

**DÉFAUT 8 — bpf-garden-advisor.js DÉCONNECTÉ**

`BpfGardenAdvisor` (3Ko) est importé dans `index.js` mais n'est pas exposé dans p11.
Ses conseils ("Éviter manguier à < 5m des fondations") ne sont pas affichés à l'étudiant.
Les presets jardin (varangue_peripheral / central_garden_patio) ne sont pas reliés
aux patterns de scatter — double système qui se ignore mutuellement.

---

## PARTIE 1 — CRÉER UN SYSTÈME DE BIBLIOTHÈQUES THÉMATIQUES

### 1.1 — Nouveau fichier : `data/bpf-libraries.json`

Créer `data/bpf-libraries.json` avec 6 bibliothèques thématiques + 4 styles visuels.
Ce fichier est **indépendant de bpf-species-reunion.json** — il le référence par `speciesKey`.

```json
{
  "_meta": {
    "version": "1.0",
    "description": "Bibliothèques végétales TERLAB — thématiques × styles",
    "species_ref": "bpf-species-reunion.json"
  },

  "libraries": {
    "indigene_foret": {
      "label": "🌿 Forêt indigène & endémique",
      "description": "Espèces indigènes et endémiques de La Réunion. Prioritaire en zone ZNIEFF et TVB.",
      "icon": "🌿",
      "badge_color": "#16a34a",
      "recommended_zones": ["znieff", "tvb", "hauts", "mipentes"],
      "plu_boost": true,
      "strates": {
        "arbore":  ["sophora_denudata", "nuxia_verticillata", "dombeya_acutangula", "sideroxylon_borbonicum", "diospyros_borbonica"],
        "arbustif": ["coffea_mauritiana", "badula_borbonica", "hypericum_lanceolatum"],
        "couvre_sol": ["dichrocephala", "fuchsia_boliviana"]
      }
    },
    "fruitier_creole": {
      "label": "🍋 Jardin fruitier créole",
      "description": "Fruitiers tropicaux traditionnels. Autonomie alimentaire + biodiversité cultivée.",
      "icon": "🍋",
      "badge_color": "#ea580c",
      "recommended_zones": ["mipentes", "littoral"],
      "strates": {
        "arbore":  ["mangifera_indica", "persea_americana", "annona_muricata", "citrus_aurantium", "artocarpus_heterophyllus"],
        "arbustif": ["coffea_arabica", "citrus_limon", "malpighia_emarginata"],
        "couvre_sol": ["arachis_pintoi", "passiflora_edulis"]
      }
    },
    "agrément_tropical": {
      "label": "🌺 Agrément tropical",
      "description": "Plantes ornementales adaptées au contexte tropical réunionnais. Dossiers APC/permis.",
      "icon": "🌺",
      "badge_color": "#db2777",
      "recommended_zones": ["littoral", "mipentes"],
      "strates": {
        "arbore":  ["cocos_nucifera", "roystonea_regia", "plumeria_rubra", "delonix_regia", "terminalia_catappa"],
        "arbustif": ["hibiscus_rosa_sinensis", "bougainvillea_spectabilis", "alpinia_purpurata", "heliconia_bihai"],
        "couvre_sol": ["rhoeo_spathacea", "tradescantia_spathacea", "ipomoea_batatas"]
      }
    },
    "littoral_resilient": {
      "label": "🌊 Littoral résilient",
      "description": "Espèces adaptées au vent, sel et sécheresse littorale. Résistance cyclonique.",
      "icon": "🌊",
      "badge_color": "#0284c7",
      "recommended_zones": ["littoral"],
      "cyclone_resistant": true,
      "strates": {
        "arbore":  ["casuarina_equisetifolia", "pandanus_utilis", "thespesia_populnea", "calophyllum_inophyllum"],
        "arbustif": ["scaevola_taccada", "pemphis_acidula", "tournefortia_argentea"],
        "couvre_sol": ["ipomoea_pes_caprae", "sporobolus_virginicus"]
      }
    },
    "agroforestier": {
      "label": "🌾 Agroforesterie",
      "description": "Association arbres + cultures. Ombrage productif, brise-vent, sol vivant.",
      "icon": "🌾",
      "badge_color": "#854d0e",
      "recommended_zones": ["mipentes", "hauts"],
      "strates": {
        "arbore":  ["grevillea_banksii", "leucaena_diversifolia", "acacia_mearnsii", "casuarina_cunninghamiana"],
        "arbustif": ["tephrosia_purpurea", "cajanus_cajan"],
        "couvre_sol": ["arachis_pintoi", "vetiveria_zizanioides"]
      }
    },
    "minimal_schema": {
      "label": "⬜ Schématique (standard PN)",
      "description": "Végétation réduite aux symboles standards du Plan de Masse (cercle plein / cercle vide).",
      "icon": "⬜",
      "badge_color": "#64748b",
      "recommended_zones": ["all"],
      "schema_only": true,
      "strates": {
        "arbore":  ["arbre_std"],
        "arbustif": ["arbuste_std"],
        "couvre_sol": ["gazon_std"]
      }
    }
  },

  "visual_styles": {
    "schema": {
      "label": "Schématique",
      "description": "Cercles standards — plan de masse technique (permis, DICT)",
      "icon": "◯",
      "svg_renderer": "schema"
    },
    "botanique": {
      "label": "Botanique",
      "description": "Silhouette feuilles + canopée — rendu pédagogique TERLAB",
      "icon": "🌿",
      "svg_renderer": "botanique"
    },
    "presentationnel": {
      "label": "Présentationnel",
      "description": "Symboles riches couleurs + fleurs — dossier APC / présentation client",
      "icon": "🎨",
      "svg_renderer": "presentationnel"
    },
    "esquisse": {
      "label": "Esquisse",
      "description": "Trait irrégulier, ombres douces — rendu à la main assisté",
      "icon": "✏️",
      "svg_renderer": "esquisse"
    }
  }
}
```

---

### 1.2 — Étendre `data/bpf-species-reunion.json`

Passer de 35 à 80+ espèces. Chaque nouvelle espèce doit suivre le schéma existant
avec **les champs manquants comblés** :

```json
{
  "key": "sophora_denudata",
  "label": "Sophora de La Réunion",
  "sci": "Sophora denudata",
  "strate": "arborescente",
  "trunkH": 8,
  "canopyRadius": 4,
  "canopyShape": "spherical",
  "isPalm": false,
  "growthForm": "tree",
  "status": "indigene",
  "zones": ["hauts", "cirque"],
  "invasive": false,
  "rtaa_shade_value": 0.7,
  "svgSymbol": "broadleaf_dense",
  "color2D": "#2d6a1f",
  "flowerColor": "#f5f0dc",
  "drought_resistant": false,
  "cyclone_resistant": false,
  "plu_mention": "espèce indigène protégée — non déplaçable sans autorisation DEAL"
}
```

**Champs à ajouter pour toutes les espèces existantes** :
- `canopyShape`: `"spherical"` | `"columnar"` | `"spreading"` | `"palm_crown"` | `"conical"`
  → utilisé pour le SVG et pour évaluer l'ombre portée RTAA
- `rtaa_shade_value`: float 0-1 → coefficient d'ombrage pour calcul RTAA Art. 5
- `drought_resistant`: boolean → pour le filtre zone climatique sèche
- `cyclone_resistant`: boolean → pour le filtre PPRN vent
- `invasive`: boolean → true pour Psidium guajava, Ulex europaeus, etc.
- `plu_mention`: string | null → note réglementaire à afficher en tooltip

---

## PARTIE 2 — MOTEUR DE SÉLECTION INTELLIGENT

### 2.1 — Mettre à jour `services/bpf-bridge.js` : accepter une libraryId

Modifier la signature de `BpfBridge.generate()` :

```javascript
// AVANT
async generate(session, parcelLocal, edgeTypes, buildingPoly, envZones = null)

// APRÈS
async generate(session, parcelLocal, edgeTypes, buildingPoly, envZones = null, options = {})
// options = {
//   libraryId: 'fruitier_creole',  // bibliothèque thématique (défaut = auto)
//   visualStyle: 'botanique',       // style SVG (défaut = 'botanique')
//   lockedZones: [],                // zones à ne pas regénérer
//   manualOverrides: [],            // espèces manuelles [{x, y, speciesKey}]
//   forceIndigene: false,           // forcer indigene_foret si ZNIEFF
// }
```

**Dans `generate()`**, ajouter après le chargement du DB :

```javascript
const db = await _loadDb();
const libDb = await _loadLibraries(); // nouveau: fetch bpf-libraries.json

// Résolution de la bibliothèque
let libraryId = options.libraryId;
if (!libraryId) {
  // Auto-sélection contextuelle
  const obia = session?.phases?.[6]?.data?.obia_result;
  const isZnieff = session?.phases?.[6]?.data?.znieff_1 || session?.phases?.[6]?.data?.znieff_2;
  const isTvb = session?.phases?.[6]?.data?.tvb_zone;
  if (isZnieff || isTvb || options.forceIndigene) {
    libraryId = 'indigene_foret';
  } else {
    const zk = _zoneKey(zoneClim);
    libraryId = zk === 'littoral' ? 'agrément_tropical'
      : zk === 'mipentes' ? 'fruitier_creole'
      : 'indigene_foret';
  }
}
const library = libDb.libraries[libraryId] ?? libDb.libraries['agrément_tropical'];

// Ajouter libraryId et visualStyle au résultat pour que le renderer SVG sache quoi faire
```

### 2.2 — Nouveau `_selectSpeciesFromLibrary(library, zone, strate, db, rng)` :

```javascript
function _selectSpeciesFromLibrary(library, zoneType, strateTarget, db, rng) {
  // Mapper zone → strate dans la bibliothèque
  const strateKeys = strateTarget === 'arbore'   ? library.strates?.arbore   ?? []
    : strateTarget === 'arbustif'                 ? library.strates?.arbustif ?? []
    :                                               library.strates?.couvre_sol ?? [];

  if (strateKeys.length === 0) return null;

  // Filtres contextuels
  const candidates = strateKeys
    .map(k => db.species.find(s => s.key === k))
    .filter(Boolean)
    .filter(s => !s.invasive); // JAMAIS d'espèces invasives

  if (candidates.length === 0) return null;

  // Pondération : préférer les espèces adaptées à la zone
  const weighted = candidates.map(s => ({
    species: s,
    weight: s.zones?.includes(_zoneKey(null)) ? 2 : 1,
  }));

  return _weightedSelectFromList(weighted, rng);
}
```

---

## PARTIE 3 — MOTEUR DE RENDU SVG MULTI-STYLE

### 3.1 — Nouveau `services/vegetation/svg-renderer.js`

Créer un nouveau service qui encapsule les 4 styles de rendu.
Ce service remplace les appels directs `_drawVegetation()` dans p11.

```javascript
// terlab/services/vegetation/svg-renderer.js
// Rendu SVG végétation multi-style pour plan masse TERLAB

const STYLE_RENDERERS = {

  // ── STYLE SCHEMA — standard architecte (cercle + croix) ──────────────────
  schema: {
    renderPlant(svg, plant, scale) {
      const r = Math.max(3, plant.canopyRadius * scale);
      const g = svg.createElementNS('...', 'g');
      g.setAttribute('class', 'plant-schema');

      // Cercle canopée (trait fin)
      const circle = svg.createElementNS('...', 'circle');
      circle.setAttribute('cx', plant.x * scale);
      circle.setAttribute('cy', plant.y * scale);
      circle.setAttribute('r', r);
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', '#374151');
      circle.setAttribute('stroke-width', '0.5');
      g.appendChild(circle);

      // Croix centrale (standard plan masse)
      const size = r * 0.4;
      const cx = plant.x * scale, cy = plant.y * scale;
      const cross = svg.createElementNS('...', 'path');
      cross.setAttribute('d', `M${cx-size},${cy} L${cx+size},${cy} M${cx},${cy-size} L${cx},${cy+size}`);
      cross.setAttribute('stroke', '#374151');
      cross.setAttribute('stroke-width', '0.5');
      g.appendChild(cross);

      // Arbres > 6m : cercle en tirets (convention PN)
      if (plant.trunkH > 6) {
        circle.setAttribute('stroke-dasharray', '2 1.5');
      }

      return g;
    },
  },

  // ── STYLE BOTANIQUE — silhouette canopée + cercle intérieur tronc ────────
  botanique: {
    renderPlant(svg, plant, scale) {
      const r = Math.max(3, plant.canopyRadius * scale);
      const cx = plant.x * scale, cy = plant.y * scale;
      const g = svg.createElementNS('...', 'g');
      g.setAttribute('class', 'plant-botanique');

      if (plant.isPalm) {
        // Palmier : étoile de fronds
        this._renderPalmTopView(svg, g, cx, cy, r, plant.color2D ?? '#3a7a30');
      } else if (plant.canopyShape === 'columnar') {
        // Colonnaire : ellipse très étroite
        const ellipse = svg.createElementNS('...', 'ellipse');
        ellipse.setAttribute('cx', cx);
        ellipse.setAttribute('cy', cy);
        ellipse.setAttribute('rx', r * 0.3);
        ellipse.setAttribute('ry', r);
        ellipse.setAttribute('fill', plant.color2D ?? '#4a8c3f');
        ellipse.setAttribute('fill-opacity', '0.75');
        g.appendChild(ellipse);
      } else if (plant.canopyShape === 'spreading') {
        // Étalé : cercle large aplati + clusters irreguliers
        this._renderSpreadingTopView(svg, g, cx, cy, r, plant.color2D);
      } else {
        // Défaut : cercle gradient radial (broadleaf sphérique)
        const grad = _createRadialGradient(svg, `grad_${plant.speciesKey}_${cx}`, cx, cy, r, plant.color2D ?? '#4a8c3f');
        g.appendChild(grad);
        const circle = svg.createElementNS('...', 'circle');
        circle.setAttribute('cx', cx);
        circle.setAttribute('cy', cy);
        circle.setAttribute('r', r);
        circle.setAttribute('fill', `url(#grad_${plant.speciesKey}_${cx})`);
        circle.setAttribute('fill-opacity', '0.8');
        g.appendChild(circle);
      }

      // Tronc : petit cercle sombre centré
      const trunkR = Math.max(1, r * 0.12);
      const trunk = svg.createElementNS('...', 'circle');
      trunk.setAttribute('cx', cx);
      trunk.setAttribute('cy', cy);
      trunk.setAttribute('r', trunkR);
      trunk.setAttribute('fill', '#4a2f1a');
      trunk.setAttribute('fill-opacity', '0.6');
      g.appendChild(trunk);

      return g;
    },

    _renderPalmTopView(svg, g, cx, cy, r, color) {
      // 7 fronds rayonnantes depuis le centre
      for (let i = 0; i < 7; i++) {
        const angle = (i / 7) * Math.PI * 2;
        const path = svg.createElementNS('...', 'path');
        const ex = cx + Math.cos(angle) * r;
        const ey = cy + Math.sin(angle) * r;
        const c1x = cx + Math.cos(angle - 0.3) * r * 0.6;
        const c1y = cy + Math.sin(angle - 0.3) * r * 0.6;
        path.setAttribute('d', `M${cx},${cy} Q${c1x},${c1y} ${ex},${ey}`);
        path.setAttribute('stroke', color ?? '#2d7a2a');
        path.setAttribute('stroke-width', r * 0.25);
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('fill', 'none');
        path.setAttribute('opacity', '0.85');
        g.appendChild(path);
      }
    },

    _renderSpreadingTopView(svg, g, cx, cy, r, color) {
      // Ellipse principale aplatie
      const ellipse = svg.createElementNS('...', 'ellipse');
      ellipse.setAttribute('cx', cx);
      ellipse.setAttribute('cy', cy);
      ellipse.setAttribute('rx', r * 1.2);
      ellipse.setAttribute('ry', r * 0.7);
      ellipse.setAttribute('fill', color ?? '#4a8c3f');
      ellipse.setAttribute('fill-opacity', '0.7');
      g.appendChild(ellipse);
      // Clusters de lobes
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const lx = cx + Math.cos(a) * r * 0.6;
        const ly = cy + Math.sin(a) * r * 0.4;
        const lobe = svg.createElementNS('...', 'circle');
        lobe.setAttribute('cx', lx);
        lobe.setAttribute('cy', ly);
        lobe.setAttribute('r', r * 0.35);
        lobe.setAttribute('fill', color ?? '#3a7a30');
        lobe.setAttribute('fill-opacity', '0.45');
        g.appendChild(lobe);
      }
    },
  },

  // ── STYLE PRÉSENTATIONNEL — couleur saturée + ombre portée + fleur ───────
  presentationnel: {
    renderPlant(svg, plant, scale) {
      const r = Math.max(3, plant.canopyRadius * scale);
      const cx = plant.x * scale, cy = plant.y * scale;
      const g = svg.createElementNS('...', 'g');
      g.setAttribute('class', 'plant-presentationnel');

      // Ombre portée (décalage SE)
      const shadow = svg.createElementNS('...', 'circle');
      shadow.setAttribute('cx', cx + r * 0.2);
      shadow.setAttribute('cy', cy + r * 0.2);
      shadow.setAttribute('r', r * 0.92);
      shadow.setAttribute('fill', 'rgba(0,0,0,0.12)');
      g.appendChild(shadow);

      // Cercle principal saturé
      const main = svg.createElementNS('...', 'circle');
      main.setAttribute('cx', cx);
      main.setAttribute('cy', cy);
      main.setAttribute('r', r);
      main.setAttribute('fill', plant.color2D ?? '#5aa84c');
      main.setAttribute('opacity', '0.92');
      g.appendChild(main);

      // Highlight intérieur (reflet)
      const hl = svg.createElementNS('...', 'circle');
      hl.setAttribute('cx', cx - r * 0.25);
      hl.setAttribute('cy', cy - r * 0.25);
      hl.setAttribute('r', r * 0.38);
      hl.setAttribute('fill', 'rgba(255,255,255,0.22)');
      g.appendChild(hl);

      // Fleur (si flowerColor défini et plante en fleur)
      if (plant.flowerColor) {
        const fl = svg.createElementNS('...', 'circle');
        fl.setAttribute('cx', cx + r * 0.45);
        fl.setAttribute('cy', cy - r * 0.45);
        fl.setAttribute('r', r * 0.22);
        fl.setAttribute('fill', plant.flowerColor);
        fl.setAttribute('opacity', '0.9');
        g.appendChild(fl);
      }

      return g;
    },
  },

  // ── STYLE ESQUISSE — trait irrégulier, croquis main levée ────────────────
  esquisse: {
    renderPlant(svg, plant, scale) {
      const r = Math.max(3, plant.canopyRadius * scale);
      const cx = plant.x * scale, cy = plant.y * scale;
      const g = svg.createElementNS('...', 'g');
      g.setAttribute('class', 'plant-esquisse');

      // Cercle irrégulier par approximation de Bézier (8 points perturbés)
      const pathD = _irregularCircle(cx, cy, r, plant.x * 137 + plant.y * 97); // seed déterministe
      const path = svg.createElementNS('...', 'path');
      path.setAttribute('d', pathD);
      path.setAttribute('fill', plant.color2D ?? '#6b9c5a');
      path.setAttribute('fill-opacity', '0.55');
      path.setAttribute('stroke', _darken(plant.color2D ?? '#6b9c5a', 0.4));
      path.setAttribute('stroke-width', '0.8');
      g.appendChild(path);

      return g;
    },
  },
};

// Cercle irrégulier déterministe (seed based)
function _irregularCircle(cx, cy, r, seed) {
  const n = 10;
  let rng = seed | 0 || 42;
  const points = [];
  for (let i = 0; i < n; i++) {
    rng = (rng * 16807) % 2147483647;
    const angle = (i / n) * Math.PI * 2;
    const jitter = 0.8 + ((rng % 100) / 100) * 0.4; // 0.8 → 1.2
    points.push({ x: cx + Math.cos(angle) * r * jitter, y: cy + Math.sin(angle) * r * jitter });
  }
  const d = points.map((p, i) => {
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const cx2 = p.x + (next.x - prev.x) * 0.15;
    const cy2 = p.y + (next.y - prev.y) * 0.15;
    return `${i === 0 ? 'M' : 'C'}${cx2},${cy2} ${cx2},${cy2} ${p.x},${p.y}`;
  }).join(' ') + 'Z';
  return d;
}

function _darken(hex, factor) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.round(r*(1-factor))},${Math.round(g*(1-factor))},${Math.round(b*(1-factor))})`;
}

export default STYLE_RENDERERS;
```

---

## PARTIE 4 — UI DANS P11 : SÉLECTEUR BIBLIOTHÈQUE + STYLE

### 4.1 — Ajouter un panneau de contrôle végétation dans `phases/p11-esquisse.html`

Dans la section `.controls-vegetation` (à créer si absente), ajouter :

```html
<!-- ── VEGETATION LIBRARY PICKER ── -->
<div class="ctrl-section" id="veg-library-ctrl">
  <div class="ctrl-label">Bibliothèque végétale</div>
  <div class="library-grid" id="library-grid">
    <!-- Injecté dynamiquement depuis bpf-libraries.json -->
    <!-- Chaque carte = <div class="lib-card" data-lib-id="fruitier_creole"> -->
  </div>

  <div class="ctrl-label" style="margin-top:8px">Style rendu plan masse</div>
  <div class="style-tabs" id="style-tabs">
    <button class="style-tab active" data-style="botanique">🌿 Botanique</button>
    <button class="style-tab" data-style="schema">◯ Schématique</button>
    <button class="style-tab" data-style="presentationnel">🎨 Présentationnel</button>
    <button class="style-tab" data-style="esquisse">✏️ Esquisse</button>
  </div>

  <div class="ctrl-actions" style="margin-top:8px">
    <button id="btn-regener-veg" class="btn-primary btn-sm">⟳ Régénérer</button>
    <button id="btn-lock-amenities" class="btn-sm" title="Garder les aménités, changer les arbres">
      🔒 Garder aménités
    </button>
  </div>

  <!-- Badge résumé : N arbres · M arbustes · score GIEP -->
  <div class="veg-stats" id="veg-stats"></div>

  <!-- Alertes espèces invasives -->
  <div class="veg-alert" id="veg-invasive-alert" style="display:none">
    ⚠️ Espèces invasives détectées dans la zone — bibliothèque indigène recommandée
  </div>
</div>
```

### 4.2 — Logique JS dans p11 pour le picker

```javascript
// Dans la section script de p11 ou dans un module p11-veg-picker.js

let _currentLibrary = null;  // auto-déterminée au premier lancement
let _currentStyle = 'botanique';
let _lockAmenities = false;

async function _initLibraryPicker() {
  const libDb = await fetch('./data/bpf-libraries.json').then(r => r.json());
  const grid = document.getElementById('library-grid');
  if (!grid) return;

  // Déterminer la bibliothèque recommandée selon p06
  const session = window.SessionManager?.get?.();
  const isZnieff = session?.phases?.[6]?.data?.znieff_1;
  const recoBadge = isZnieff ? 'indigene_foret' : null;

  grid.innerHTML = Object.entries(libDb.libraries).map(([id, lib]) => `
    <div class="lib-card ${id === _currentLibrary ? 'active' : ''}"
         data-lib-id="${id}"
         style="--badge-color: ${lib.badge_color}">
      <span class="lib-icon">${lib.icon}</span>
      <span class="lib-label">${lib.label}</span>
      ${id === recoBadge ? '<span class="lib-reco">✓ recommandée</span>' : ''}
    </div>
  `).join('');

  // Auto-sélection si non définie
  if (!_currentLibrary) {
    _currentLibrary = recoBadge ?? 'agrément_tropical';
    grid.querySelector(`[data-lib-id="${_currentLibrary}"]`)?.classList.add('active');
  }

  // Events
  grid.querySelectorAll('.lib-card').forEach(card => {
    card.addEventListener('click', () => {
      grid.querySelectorAll('.lib-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      _currentLibrary = card.dataset.libId;
      _regenVegetation();
    });
  });

  document.querySelectorAll('.style-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.style-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _currentStyle = btn.dataset.style;
      _redrawVegetationOnly(); // pas de re-scatter — juste re-render
    });
  });

  document.getElementById('btn-regener-veg')?.addEventListener('click', _regenVegetation);
  document.getElementById('btn-lock-amenities')?.addEventListener('click', () => {
    _lockAmenities = !_lockAmenities;
    document.getElementById('btn-lock-amenities').textContent = _lockAmenities ? '🔓 Libérer aménités' : '🔒 Garder aménités';
  });
}

async function _regenVegetation() {
  const session = window.SessionManager?.get?.();
  // ... appeler BpfBridge.generate() avec les nouvelles options
  const result = await BpfBridge.generate(session, parcelLocal, edgeTypes, buildingPoly, envZones, {
    libraryId: _currentLibrary,
    visualStyle: _currentStyle,
    lockedZones: _lockAmenities ? ['amenities'] : [],
  });
  // Re-render le SVG avec le style courant
  _renderVegetationWithStyle(result.plants, result.amenities, _currentStyle);
  _updateVegStats(result.stats);
}
```

---

## PARTIE 5 — CONNEXION P06 BIODIVERSITE → BRIDGE

### 5.1 — Dans `bpf-bridge.js`, lire les données p06 et filtrer

Ajouter dans `generate()` après le calcul de `zoneClim` :

```javascript
// ── Lecture données biodiversité p06 ──────────────────────────────
const p6data = session?.phases?.[6]?.data ?? {};
const isZnieff1   = !!p6data.znieff_1_present;
const isZnieff2   = !!p6data.znieff_2_present;
const isTvb       = !!p6data.tvb_corridor;
const hasInvasifs = p6data.especes_invasives_detectees ?? false;

// Forcer indigene si ZNIEFF 1 (zone à enjeu fort)
if (isZnieff1 && !options.libraryId) {
  options.libraryId = 'indigene_foret';
}

// Avertissement invasives dans le résultat
const invasiveAlert = hasInvasifs
  ? 'Espèces invasives signalées sur ce terrain — bibliothèque indigène recommandée'
  : null;
```

### 5.2 — Filtrage anti-invasif dans `_selectSpeciesFromLibrary`

```javascript
// Dans _selectSpeciesFromLibrary, filtrer les espèces invasives
const filteredCandidates = candidates.filter(s => {
  if (s.invasive && (isZnieff1 || isZnieff2 || isTvb)) return false; // STRICT
  return true;
});
```

---

## PARTIE 6 — EXPORT VERS BPF 3D VIA POSTMESSAGE

### 6.1 — Ajouter un bouton "Envoyer vers BPF 3D" dans p11

Quand p11 est chargé en iframe dans BIMSHOW, permettre à l'étudiant de pousser sa
végétation plan masse vers le viewer 3D BPF.

```javascript
// Dans p11, après _regenVegetation() réussi :
function _sendVegetationToBIMSHOW(plants) {
  const msg = {
    type: 'TERLAB_BPF_VEGETATION',
    plants: plants.map(p => ({
      speciesKey: p.speciesKey,
      x: p.x, y: p.y,
      trunkH: p.trunkH,
      canopyRadius: p.canopyRadius,
      isPalm: p.isPalm,
    })),
    sessionId: window.SessionManager?.get?.()?.sessionId,
  };
  window.parent?.postMessage(msg, '*');
  // Ou via BIMSHOWBridge si disponible
  window.BIMSHOWBridge?.sendVegetation?.(plants);
}
```

**Dans BIMSHOW**, le handler `TERLAB_BPF_VEGETATION` → `VegetationScatterFacadeService.scatterFromTerlabData(plants)`.

---

## PARTIE 7 — TESTS DE VÉRIFICATION

```bash
# Vérifier que bpf-libraries.json est valide JSON
node -e "JSON.parse(require('fs').readFileSync('data/bpf-libraries.json','utf8'))" && echo OK

# Vérifier que les speciesKey dans les libraries existent dans bpf-species-reunion.json
node -e "
  const lib = JSON.parse(require('fs').readFileSync('data/bpf-libraries.json','utf8'));
  const sp = JSON.parse(require('fs').readFileSync('data/bpf-species-reunion.json','utf8'));
  const keys = new Set(sp.species.map(s => s.key));
  Object.entries(lib.libraries).forEach(([id, l]) => {
    Object.values(l.strates ?? {}).flat().forEach(k => {
      if (!keys.has(k)) console.error('MISSING:', id, '->', k);
    });
  });
  console.log('Check done');
"
```

**Tests manuels** :

1. p11 → "Régénérer" → vérifier que la végétation change selon la bibliothèque sélectionnée
2. Changer de style SVG → le plan masse doit se redessiner sans re-scatter (même positions)
3. p06 avec ZNIEFF 1 → p11 doit auto-sélectionner `indigene_foret` et afficher la bibliothèque en recommended
4. Activer "Garder aménités" → re-scatter → les aménités doivent rester au même endroit
5. Vérifier qu'aucune espèce invasive n'apparaît sur une parcelle en zone TVB
6. Tester avec une parcelle < 10m² → message d'erreur correct
7. Tester avec une parcelle > 10 000m² → message d'erreur guard correct

---

## RÉSUMÉ DES FICHIERS À CRÉER / MODIFIER

| Action | Fichier | Changement |
|---|---|---|
| CRÉER | `data/bpf-libraries.json` | 6 bibliothèques × 4 styles |
| MODIFIER | `data/bpf-species-reunion.json` | +45 espèces + champs canopyShape / rtaa_shade_value / invasive |
| CRÉER | `services/vegetation/svg-renderer.js` | 4 styles de rendu SVG |
| MODIFIER | `services/bpf-bridge.js` | Paramètre `options`, libraryId, filtre invasif p06 |
| MODIFIER | `phases/p11-esquisse.html` | Panneau library picker + style tabs |
| CRÉER | `services/vegetation/p11-veg-picker.js` | Logique JS picker (si séparé) |
| MODIFIER | `services/bpf-garden-advisor.js` | Brancher sur les bibliothèques au lieu des presets texte |

---

## NOTE SUR LA PHILOSOPHIE DU PROJET

TERLAB est **Vanilla JS strict** — pas de framework, pas de bundler.
Tous les imports sont `type="module"` ES2022 natif.
Le style SVG est calculé à la volée (pas de canvas, pas de Three.js pour p11).
La bibliothèque sélectionnée doit persister dans `SessionManager` pour les exports PDF.
Le score GIEP doit être recalculé après chaque changement de bibliothèque.

*Prompt généré le 2026-05-08 · TERLAB export audit 75 248 lignes · BPF x TERLAB intégration v2*
