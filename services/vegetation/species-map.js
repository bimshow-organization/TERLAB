/**
 * species-map.js — table de correspondance espèces BPF → recettes atlas-jardins.
 *
 * Module PUR (aucune dépendance THREE, importable en Node tel quel) : la partie
 * géométrique vit dans species-geometry.js qui importe ces tables. Le probe
 * scripts/probe-species-map.mjs valide ce fichier sans navigateur.
 *
 * Source des recettes : .docs/atlas-jardins-editeur_7.html (SPECIES_DEFS,
 * L11407-11462) — portage verbatim des 44 entrées (id, label, cat, dot,
 * recette, canopyR). Les 5 recettes 'bam' (designs paramétriques BAM) sont
 * conservées pour fidélité mais NON constructibles ici (les builders BAM ne
 * sont pas embarqués) — aucune clé BPF ne pointe dessus.
 */

/* ── Recettes atlas (portage 1:1 de SPECIES_DEFS) ─────────────────────────
   recipe : [type, ...params]
     palm    [trunkHex, frondHex, spiky]     conifer [trunkHex, foliageHex, narrow]
     canopy  [trunkHex, foliageHex, flowerHex|null]
     shrub   [foliageHex, flowerHex|null]    fern [foliageHex]
     grass   [colHex, tall]                  lily [leafHex, flowerHex]
     flower  [petalHex, heartHex]            rock/cave [colHex, size]
     slab    [colHex, r]                     slabr [colHex, sx, sy]
     bam     [design, variantes|null]  — non porté (repli silencieux)        */
export const ATLAS_SPECIES = {
  flamboyant:     { label: 'Flamboyant',       cat: 'Arbres',   dot: '#d9603a', recipe: ['canopy', 0x6e5238, 0x6e9a3e, 0xe0533a], canopyR: 4.0 },
  tamarin:        { label: 'Tamarin',          cat: 'Arbres',   dot: '#6ba848', recipe: ['canopy', 0x8b6a4a, 0x6ba848, null],     canopyR: 3.5 },
  filao:          { label: 'Filao',            cat: 'Arbres',   dot: '#2f6a4a', recipe: ['conifer', 0x5a4632, 0x3f6b4a],          canopyR: 1.2 },
  eucalyptus:     { label: 'Eucalyptus',       cat: 'Arbres',   dot: '#a0b87a', recipe: ['canopy', 0x9a8866, 0xb5c08a, null],     canopyR: 3.2 },
  ficus:          { label: 'Ficus',            cat: 'Arbres',   dot: '#5a8a3a', recipe: ['canopy', 0x4a3a2a, 0x4a7a3a, null],     canopyR: 2.8 },
  pin_sombre:     { label: 'Pin sombre',       cat: 'Arbres',   dot: '#3a5e44', recipe: ['conifer', 0x4a3a2e, 0x2f4a3a],          canopyR: 1.5 },
  cocotier:       { label: 'Cocotier',         cat: 'Palmiers', dot: '#4f7a37', recipe: ['palm', 0x7a5a3a, 0x4f7a37, false],      canopyR: 2.5 },
  vacoa:          { label: 'Vacoa',            cat: 'Palmiers', dot: '#6a8a4a', recipe: ['palm', 0x6a5a3a, 0x5c7a40, true],       canopyR: 1.8 },
  palmiste:       { label: 'Palmiste',         cat: 'Palmiers', dot: '#5f8a3a', recipe: ['palm', 0x8a6a4a, 0x6f9a4a, false],      canopyR: 2.0 },
  hibiscus:       { label: 'Hibiscus',         cat: 'Arbustes', dot: '#d24d6a', recipe: ['shrub', 0x3e6b33, 0xd24d6a],            canopyR: 0.8 },
  bougainvillier: { label: 'Bougainville',     cat: 'Arbustes', dot: '#c0397a', recipe: ['shrub', 0x3a5e30, 0xc0397a],            canopyR: 0.8 },
  croton:         { label: 'Croton',           cat: 'Arbustes', dot: '#8a8a2a', recipe: ['shrub', 0x5a6b1f, null],                canopyR: 0.6 },
  laurier:        { label: 'Laurier rose',     cat: 'Arbustes', dot: '#d870a0', recipe: ['shrub', 0x3a5e2e, 0xe07090],            canopyR: 0.5 },
  lavande:        { label: 'Lavande',          cat: 'Arbustes', dot: '#9070c0', recipe: ['shrub', 0x6a7a5a, 0x9c70c8],            canopyR: 0.5 },
  strelitzia:     { label: 'Strelitzia',       cat: 'Fleurs',   dot: '#ff7a3d', recipe: ['flower', 0xff7a3d, 0x5b3a8a],           canopyR: 0.3 },
  heliconia:      { label: 'Héliconia',        cat: 'Fleurs',   dot: '#e04545', recipe: ['flower', 0xe04545, 0xd4902c],           canopyR: 0.3 },
  jasmin:         { label: 'Jasmin',           cat: 'Fleurs',   dot: '#f0e0a0', recipe: ['flower', 0xf0e0a0, 0xa8c060],           canopyR: 0.4 },
  marguerite:     { label: 'Marguerite',       cat: 'Fleurs',   dot: '#f0f0e0', recipe: ['flower', 0xf0f0e0, 0xc6c050],           canopyR: 0.3 },
  gazon:          { label: 'Gazon',            cat: 'Sol',      dot: '#6d9b40', recipe: ['grass', 0x6d9b40, false],               canopyR: 0 },
  herbe:          { label: 'Herbe haute',      cat: 'Sol',      dot: '#8a9c44', recipe: ['grass', 0x8a9c44, true],                canopyR: 0 },
  fougere:        { label: 'Fougère',          cat: 'Sol',      dot: '#4a8a4a', recipe: ['fern', 0x4a8a4a],                       canopyR: 0.5 },
  buis:           { label: 'Buis',             cat: 'Arbustes', dot: '#4a6b3a', recipe: ['shrub', 0x4a6b3a, null],                canopyR: 0.6 },
  rosier:         { label: 'Rosier',           cat: 'Arbustes', dot: '#c8557a', recipe: ['shrub', 0x5f7f45, 0xc8557a],            canopyR: 0.7 },
  letchi:         { label: 'Letchi',           cat: 'Arbres',   dot: '#7a9a3e', recipe: ['canopy', 0x5a4632, 0x4f7a35, 0xc0392b], canopyR: 3.2 },
  cypres:         { label: 'Cyprès',           cat: 'Arbres',   dot: '#3f5f42', recipe: ['conifer', 0x4a3a2e, 0x35563c, 1],       canopyR: 0.9 },
  legume:         { label: 'Planche potagère', cat: 'Sol',      dot: '#7fa04a', recipe: ['shrub', 0x7fa04a, null],                canopyR: 0.35 },
  nenuphar:       { label: 'Nénuphar',         cat: 'Sol',      dot: '#3f7a4a', recipe: ['lily', 0x3f7a4a, 0xf2e2d0],             canopyR: 0.5 },
  roseau:         { label: 'Roseau',           cat: 'Sol',      dot: '#8a9a5a', recipe: ['grass', 0x8a9a5a, true],                canopyR: 0 },
  miscanthus:     { label: 'Miscanthus',       cat: 'Sol',      dot: '#c2b070', recipe: ['grass', 0xc2b070, true],                canopyR: 0 },
  stipa:          { label: 'Stipa',            cat: 'Sol',      dot: '#d8cb92', recipe: ['grass', 0xd8cb92, false],               canopyR: 0 },
  cave_mouth:     { label: 'Entrée de grotte', cat: 'Sol',      dot: '#5a564d', recipe: ['cave', 0x6e6a60, 2.2],                  canopyR: 2.6 },
  rock_focal:     { label: 'Rocher focal',     cat: 'Sol',      dot: '#909088', recipe: ['rock', 0x8a857a, 1.4],                  canopyR: 1.5 },
  rock_medium:    { label: 'Rocher moyen',     cat: 'Sol',      dot: '#9a958a', recipe: ['rock', 0x94908a, 0.9],                  canopyR: 1.0 },
  pebble_decor:   { label: 'Caillou',          cat: 'Sol',      dot: '#a8a8a0', recipe: ['rock', 0xa39e94, 0.35],                 canopyR: 0.3 },
  sp_round_thin:  { label: 'Pas japonais',     cat: 'Sol',      dot: '#a0a09a', recipe: ['slab', 0x9a988e, 0.55],                 canopyR: 0 },
  dalle_deck:     { label: 'Dalle deck',       cat: 'Sol',      dot: '#b8a888', recipe: ['slab', 0xb0a48c, 0.8],                  canopyR: 0 },
  dalle_rect:     { label: 'Dalle rect.',      cat: 'Sol',      dot: '#b4ac9c', recipe: ['slabr', 0xaea698, 1.15, 0.52],          canopyR: 0 },
  marquage:       { label: 'Marquage',         cat: 'Sol',      dot: '#e8e8e0', recipe: ['slabr', 0xe9e9e2, 0.9, 0.13],           canopyR: 0 },
  /* Designs paramétriques BAM — NON portés (builders /designer absents ici).
     Conservés pour fidélité du catalogue ; buildSpeciesGeometry → null. */
  fontaine_p:     { label: 'Fontaine',         cat: 'Sol',      dot: '#9aa8b0', recipe: ['bam', 'fountain', ['tiered', 'basin', 'modern']],    canopyR: 1.2 },
  banc_p:         { label: 'Banc',             cat: 'Sol',      dot: '#a9814f', recipe: ['bam', 'bench',    ['garden', 'backless']],           canopyR: 0.9 },
  pergola_p:      { label: 'Pergola',          cat: 'Sol',      dot: '#b09070', recipe: ['bam', 'pergola',  null],                             canopyR: 2.6 },
  jardiniere_p:   { label: 'Jardinière',       cat: 'Sol',      dot: '#8d6a4f', recipe: ['bam', 'planter',  ['rectangular', 'round', 'trough']], canopyR: 0.7 },
  piscine_p:      { label: 'Piscine',          cat: 'Sol',      dot: '#5fa8c8', recipe: ['bam', 'pool',     ['rectangular', 'kidney']],        canopyR: 3.5 },
};

/* Nombre de silhouettes seedées par espèce (atlas VEG_VARIANTS) */
export const VEG_VARIANTS = 3;

/* Timidité de canopée — distance min inter-instances de MÊME catégorie (m) */
export const STRATA_SHYNESS = { Arbres: 5.5, Palmiers: 4.5, Arbustes: 1.6, Fleurs: 1, Sol: 0 };

/* Échelle par espèce atlas (Bug E — arbres hauts boostés). Conservée à titre
   documentaire : dans TERLAB l'échelle vient de trunkH/canopyRadius du JSON
   bpf-species-reunion.json, pas de cette table. */
export const SPECIES_SCALE = {
  flamboyant: 2.0, tamarin: 1.8, filao: 1.7,
  cocotier: 1.8, vacoa: 1.5, palmiste: 1.7,
};

/* ── Mapping 33 clés bpf-species-reunion.json → recettes atlas ────────────
   exact:true  = recouvrement direct d'espèce/label
   exact:false = analogue morphologique (growthForm/crownShape/isPalm)

   ⚠ strelitzia / heliconia bpf sont isPalm:true (géants bananiformes,
   Strelitzia nicolai 4 m, Heliconia rostrata 3 m) : ils mappent vers des
   recettes PALM (vacoa, port compact en éventail), pas vers les fleurs
   homonymes de l'atlas (strelitzia/heliconia atlas = fleurs sur tige ~1 m,
   utilisées ici comme analogues de canna/alpinia). */
export const SPECIES_MAP = {
  /* Palmiers et ports palmiformes (8 isPalm → recettes palm) */
  palm_coconut:           { atlasId: 'cocotier',   exact: true  }, // Cocos nucifera
  latania:                { atlasId: 'vacoa',      exact: false }, // Latanier rouge — palmier éventail trapu → vacoa (sp)
  acanthophoenix_crinita: { atlasId: 'palmiste',   exact: true  }, // Palmiste rouge
  pandanus:               { atlasId: 'vacoa',      exact: true  }, // Vacoa
  banana_musa:            { atlasId: 'cocotier',   exact: false }, // Bananier — frondes larges retombantes
  carica_papaya:          { atlasId: 'palmiste',   exact: false }, // Papayer — stipe fin, couronne haute
  strelitzia:             { atlasId: 'vacoa',      exact: false }, // Strelitzia nicolai géant (isPalm) — cf. note
  heliconia:              { atlasId: 'vacoa',      exact: false }, // Heliconia rostrata (isPalm) — cf. note

  /* Arbres (canopy / conifer) */
  mango:                  { atlasId: 'ficus',      exact: false }, // Manguier — houppier dense sombre
  casuarina:              { atlasId: 'filao',      exact: true  }, // Filao
  flamboyant:             { atlasId: 'flamboyant', exact: true  }, // Delonix regia
  tamarind:               { atlasId: 'tamarin',    exact: true  }, // Tamarinier
  acacia_heterophylla:    { atlasId: 'tamarin',    exact: false }, // Tamarin des hauts — port étalé analogue
  calophyllum_tacamahaca: { atlasId: 'ficus',      exact: false }, // Takamaka
  calophyllum_inophyllum: { atlasId: 'ficus',      exact: false }, // Tamanu
  plumeria:               { atlasId: 'flamboyant', exact: false }, // Frangipanier — canopy fleurie (teinter flowerColor)
  hibiscus_tiliaceus:     { atlasId: 'hibiscus',   exact: true  }, // Bourao (recouvrement de label atlas)
  cryptomeria_japonica:   { atlasId: 'pin_sombre', exact: false }, // Cryptomeria — conifère sombre étagé
  ficus_benjamina:        { atlasId: 'ficus',      exact: true  }, // Figuier pleureur
  terminalia_catappa:     { atlasId: 'tamarin',    exact: false }, // Badamier — port étagé étalé
  persea_americana:       { atlasId: 'ficus',      exact: false }, // Avocatier
  psidium_guajava:        { atlasId: 'letchi',     exact: false }, // Goyavier — canopy à fruits rouges
  dombeya_acutangula:     { atlasId: 'flamboyant', exact: false }, // Mahot tantan — canopy fleurie rose (teinter)
  cassine_orientalis:     { atlasId: 'ficus',      exact: false }, // Bois rouge
  aphloia_theiformis:     { atlasId: 'ficus',      exact: false }, // Fougère marron (petit arbre)

  /* Bambous — port colonnaire → conifère narrow (cyprès) */
  bamboo_phyllo:          { atlasId: 'cypres',     exact: false }, // Bambou doré
  nastus_borbonicus:      { atlasId: 'cypres',     exact: false }, // Bambou marron

  /* Arbustes */
  bougainvillea:          { atlasId: 'bougainvillier', exact: true  },
  pittosporum:            { atlasId: 'buis',           exact: false }, // arbuste vert compact
  ixora_coccinea:         { atlasId: 'hibiscus',       exact: false }, // arbuste à fleurs rouges (teinter)

  /* Herbacées et couvre-sol */
  vetiver:                { atlasId: 'herbe',      exact: false }, // graminée haute
  alpinia:                { atlasId: 'heliconia',  exact: false }, // fleur tropicale rouge sur tige
  canna_indica:           { atlasId: 'strelitzia', exact: false }, // fleur orangée sur tige
};

/* Repli par growthForm pour toute clé bpf inconnue de SPECIES_MAP */
export const DEFAULT_BY_GROWTHFORM = {
  palm:   'cocotier',
  tree:   'ficus',
  shrub:  'hibiscus',
  grass:  'herbe',
  bamboo: 'cypres',
  herb:   'heliconia',
};

/**
 * Résout une clé bpf vers son id de recette atlas.
 * @param {string} speciesKey clé bpf (ex. 'palm_coconut')
 * @param {string} [growthForm] repli si la clé est inconnue
 * @returns {{atlasId: string, exact: boolean}}
 */
export function resolveAtlasId(speciesKey, growthForm) {
  const hit = SPECIES_MAP[speciesKey];
  if (hit) return hit;
  const fb = DEFAULT_BY_GROWTHFORM[growthForm] || 'ficus';
  return { atlasId: fb, exact: false };
}
