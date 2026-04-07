// terlab/services/bpf-garden-advisor.js
// Conseil jardin BPF selon zone climatique + famille d'enveloppe
// Source : BPF garden-generator CREOLE_RULES / HAUTS_RULES / COASTAL_RULES
// + BPF garden-ifc-bridge suggestPresetFromGps()

const BpfGardenAdvisor = {

  // Règles par zone (adaptées de BPF garden-generator.service.ts)
  PRESETS: {
    littoral: {
      label:   'Jardin littoral créole',
      preset:  '🌴 Littoral créole — filao, pandanus, canne',
      species: ['Casuarina equisetifolia (filao)', 'Pandanus utilis', 'Saccharum officinarum', 'Hibiscus tiliaceus', 'Cocos nucifera'],
      invasive_alert: ['Psidium guajava (goyavier ⚠)', 'Leucaena leucocephala'],
      ground: 'sable_volcanique + paillis',
    },
    mipentes: {
      label:   'Jardin des mi-pentes',
      preset:  '🌿 Mi-pentes — manguier, bananier, gingembre',
      species: ['Mangifera indica (manguier)', 'Musa (bananier)', 'Zingiber officinale', 'Terminalia catappa (badamier)', 'Alpinia purpurata'],
      invasive_alert: ['Psidium guajava ⚠', 'Rubus alceifolius (vigne marronne ⚠)'],
      ground: 'sol_volcanique_rouge',
    },
    hauts: {
      label:   'Jardin des hauts',
      preset:  '🍃 Hauts — tamarin, ajonc, cryptomeria',
      species: ['Acacia mearnsii (tamarin des hauts)', 'Cryptomeria japonica', 'Ulex europaeus (ajonc)', 'Pittosporum senacia', 'Nasturtium officinale'],
      invasive_alert: ['Ulex europaeus si non contrôlé ⚠', 'Rubus alceifolius ⚠'],
      ground: 'sol_montagnard_acide',
    },
  },

  // Règles par famille d'enveloppe (inspiré BPF garden-svg-art)
  FAMILY_GARDEN: {
    'Créole':       { layout: 'varangue_peripheral_3_sides', massif: 'bougainvillers + rondéliers', jardin_front: 'pelouse_creole' },
    'Patio':        { layout: 'central_garden_patio',        massif: 'strelitzia + cannas + heliconias', jardin_front: 'minéral + eau' },
    'En U':         { layout: 'courtyard_garden',            massif: 'bambus + palmiers', jardin_front: 'allée_bordée' },
    'En L':         { layout: 'angle_garden',                massif: 'frangipaniers + bananiers', jardin_front: 'rocaille_volcanique' },
    'Traversant':   { layout: 'linear_garden',               massif: 'haie_vive_mixte', jardin_front: 'bande_fleurie' },
    'Rectangle':    { layout: 'quadrant_garden',             massif: 'potager + fruitiers', jardin_front: 'gazon_ombre' },
  },

  suggest(zone_climatique, altitude_ngr, envelopeFamily) {
    const alt = parseFloat(altitude_ngr ?? 100);
    const zoneKey = alt < 400 ? 'littoral' : alt < 800 ? 'mipentes' : 'hauts';
    const zonePreset = this.PRESETS[zoneKey] ?? this.PRESETS.mipentes;

    // Trouver la famille correspondante
    const famKey = Object.keys(this.FAMILY_GARDEN).find(k =>
      envelopeFamily?.toLowerCase().includes(k.toLowerCase())
    );
    const famGarden = this.FAMILY_GARDEN[famKey] ?? this.FAMILY_GARDEN['Rectangle'];

    return {
      preset: zonePreset.preset,
      species: zonePreset.species,
      invasive_alert: zonePreset.invasive_alert,
      layout: famGarden.layout,
      massif: famGarden.massif,
      jardin_front: famGarden.jardin_front,
      ground: zonePreset.ground,
      safe_note: 'Éviter manguier à < 5m des fondations (racines taproot)',
    };
  },
};

export default BpfGardenAdvisor;
