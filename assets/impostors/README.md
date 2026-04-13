# Impostors vegetation

Atlases octahedral 8 vues (2048x1024 webp, 4 colonnes x 2 lignes) captures depuis BPF.

## Provenance

Extraits de `bimshow-plant-factory-angular` via `OctahedralCaptureService.captureAtlas()` le 2026-04-13.
Chaque webp = un arbre rendu 3D complet sous 8 azimuts (0, 45, 90, ..., 315 degres).

## Mapping especes

| Fichier | speciesKey TERLAB | Label |
|---------|-------------------|-------|
| impostor_palm_coconut.webp | palm_coconut | Cocotier |
| impostor_latania.webp | latania | Latanier rouge |
| impostor_palm_howea.webp | acanthophoenix_crinita | Palmiste rouge (substitut visuel Kentia) |
| impostor_mango.webp | mango | Manguier |
| impostor_flamboyant.webp | flamboyant | Flamboyant |
| impostor_tamarind.webp | tamarind | Tamarinier |
| impostor_pandanus.webp | pandanus | Vacoa |
| impostor_terminalia_catappa.webp | terminalia_catappa | Badamier |
| impostor_plumeria.webp | plumeria | Frangipanier |
| impostor_hibiscus_tiliaceus.webp | hibiscus_tiliaceus | Bourao |

Total : 10 especes, ~850 KB.

## Utilisation

Le mapping est dans `data/bpf-species-reunion.json` champ `impostorPath`.
Le loader est dans `services/impostor-loader.js` (global `window.ImpostorLoader`).

```js
// Recuperer une texture Three.js (3D viewer)
const tex = await ImpostorLoader.getTexture('mango');

// Recuperer une image HTML (pour canvas 2D / plan masse)
const img = await ImpostorLoader.getImageElement('mango');

// Dessiner une vue specifique sur un canvas
ImpostorLoader.drawViewOnCanvas(ctx, img, x, y, w, h, viewIdx);

// Convertir un azimut radian en index de vue
const viewIdx = ImpostorLoader.azimuthToViewIndex(azRad);
```

## Ajout d'une nouvelle espece

1. Lancer BPF, ouvrir la console dev tools
2. Coller le script batch (voir `.docs/bake-impostors.md` si present)
3. Deposer le webp dans ce dossier
4. Ajouter `impostorPath` dans `data/bpf-species-reunion.json`
