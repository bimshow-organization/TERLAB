/**
 * TERLAB . layers-registry.js
 * Catalogue central des couches disponibles dans le viewer SOTA
 * Saint-Leu. Inspire des 30 couches TERLAB (audit services/*.js).
 *
 * Pour chaque couche : id, label, type, source/api, params, status
 * (implemented = code branche dans index-multilayer.html / pending = TODO).
 *
 * Le viewer auto-genere les boutons toggle depuis ce registre.
 */

export const LAYERS_REGISTRY = [
  // ═══════════════════════════════════════════════════════════════
  // COUCHES BASE TERRAIN (deja implementees dans le viewer)
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'splats', group: 'terrain',
    label: 'Splats LiDAR HD',
    desc: 'Nuage de gaussiennes colorise ortho (zone notable)',
    type: '3d-splats', source: 'IGN HD COPC + BD ORTHO',
    status: 'implemented',
    defaultOn: true,
  },
  {
    id: 'contours', group: 'terrain',
    label: 'Courbes de niveau IGN RGE ALTI',
    desc: 'Marching squares sur grille 65x65 alti IGN, intervalle 5m / majeur 25m',
    type: '3d-lines', source: 'IGN RGE ALTI / data.geopf.fr',
    status: 'implemented',
    params: { interval_m: 5, major_every: 5, gridN: 65 },
  },

  // ═══════════════════════════════════════════════════════════════
  // VEGETATION (deja implementee)
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'impostors', group: 'vegetation',
    label: 'Arbres LiDAR (sprites WebP)',
    desc: '~200/zone, mango majoritaire, palm 5-10% urbain',
    type: '3d-sprites', source: 'LiDAR cls 4-5 + WebP atlas BIMSHOW',
    status: 'implemented',
    params: { species_mix: 'mango+palm', boost: 1.0 },
  },
  {
    id: 'trees_3d_heros', group: 'vegetation',
    label: 'Arbres 3D low-poly (BPF)',
    desc: 'Trunk cylinder + leaves crossed planes pour h >= 5m. Port BPF.',
    type: '3d-mesh-instanced',
    source: 'LiDAR cls 5 (peaks) + texture procedurale BIMSHOW Plant Factory',
    status: 'implemented',
    params: { hMin: 5, lodLevel: 1 },
  },
  {
    id: 'trees_v2_splat', group: 'vegetation',
    label: 'Arbres V2 (ellipsoid splat-fit)',
    desc: 'Enveloppe ellipsoid PCA 3D des points splat cls 5 + couleur ortho HD per arbre',
    type: '3d-mesh-ellipsoid',
    source: 'LiDAR cls 5 + ortho IGN HD (pre-process Python sota/extract_lidar_trees_v2.py)',
    status: 'implemented',
    params: { hMin: 5 },
  },
  {
    id: 'trees_v3_mesh', group: 'vegetation',
    label: 'Arbres V3 mesh (experimental)',
    desc: 'ConvexHull 3D des points splat cls 5 + couleur per-vertex ortho HD = silhouette fidele',
    type: '3d-mesh-convex',
    source: 'LiDAR cls 5 + ortho IGN HD (pre-process sota/extract_lidar_trees_v3_mesh.py)',
    status: 'implemented',
    params: { hMin: 5 },
  },

  // ═══════════════════════════════════════════════════════════════
  // RISQUES (PPR / Georisques)
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'pprn', group: 'risques',
    label: 'PPR Naturels (zonage R/B)',
    desc: 'PEIGEO ppr_approuve raster - inondation/cyclone/mvt terrain',
    type: '2d-wms-overlay',
    source: 'PEIGEO GeoServer http://peigeo.re:8080',
    layer: 'ppr_approuve',
    wmsUrl: 'http://peigeo.re:8080/geoserver/peigeo/wms',
    status: 'implemented',
    params: { opacity: 0.55, height_above_terrain: 0.5 },
  },
  {
    id: 'georisques_pin', group: 'risques',
    label: 'Risques Georisques (point report)',
    desc: 'Liste des risques presents au point (API Georisques HTTPS)',
    type: '2d-pin-info',
    source: 'https://georisques.gouv.fr/api/v1/resultats_rapport_risque',
    status: 'pending',
  },
  {
    id: 'sismique', group: 'risques',
    label: 'Zones sismiques BRGM',
    desc: 'Zones 1-5 sismicite reglementaire',
    type: '2d-static',
    source: 'BRGM (donnees pre-cachees)',
    status: 'pending',
  },

  // ═══════════════════════════════════════════════════════════════
  // URBANISME / PLU / SCoT
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'plu_zones', group: 'urbanisme',
    label: 'Zones PLU (PEIGEO simp)',
    desc: 'pos_plu_simp - zones reglementaires Saint-Leu',
    type: '2d-wms-overlay',
    source: 'PEIGEO GeoServer http://peigeo.re:8080',
    layer: 'pos_plu_simp',
    wmsUrl: 'http://peigeo.re:8080/geoserver/peigeo/wms',
    status: 'implemented',
    params: { opacity: 0.45 },
  },
  {
    id: 'plu_gpu', group: 'urbanisme',
    label: 'Zones PLU GPU (vectoriel)',
    desc: 'WFS GPU - reculs/hauteurs/CES par zone',
    type: '2d-vector',
    source: 'IGN GPU / data.geopf.fr',
    status: 'pending',
  },
  {
    id: 'scot', group: 'urbanisme',
    label: 'SCoT zones (5 intercos)',
    desc: 'ZATT 500m, DAUPI - CASUD/CINOR/CIVIS/CIREST/TCO',
    type: '2d-static',
    source: 'TERLAB scot-rules-*.json embedded',
    status: 'pending',
  },

  // ═══════════════════════════════════════════════════════════════
  // BATI EXISTANT
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'bdtopo_buildings', group: 'bati',
    label: 'Batiments BDTOPO (3D extrudes)',
    desc: 'Hauteur reelle BDTOPO + style maquette urbanisme blanc',
    type: '3d-extrude',
    source: 'IGN BDTOPO_V3:batiment / data.geopf.fr',
    status: 'implemented',
  },
  {
    id: 'bdtopo_roads', group: 'bati',
    label: 'Routes BDTOPO',
    desc: 'troncon_de_route rubans rouges plaques au MNT',
    type: '2d-vector-3d',
    source: 'IGN BDTOPO_V3:troncon_de_route',
    status: 'implemented',
  },
  {
    id: 'bdtopo_roads_profile', group: 'bati',
    label: 'Routes profilees (CityEngine-like)',
    desc: 'Chaussee + trottoirs + accotements selon importance / largeur / urbain BDTOPO',
    type: '3d-mesh-profile',
    source: 'IGN BDTOPO_V3:troncon_de_route + profil parametre',
    status: 'implemented',
  },
  {
    id: 'vehicles_yolo', group: 'bati',
    label: 'Vehicules (YOLOv8-OBB ortho HD)',
    desc: 'Detection voitures/camions par YOLO sur ortho IGN HD 20cm + box 3D + couleur sample',
    type: '3d-mesh-instances',
    source: 'YOLOv8-OBB DOTAv1 sur HR.ORTHOIMAGERY (pre-process sota/extract_ortho_vehicles.py)',
    status: 'implemented',
  },
  {
    id: 'bdtopo_water', group: 'bati',
    label: 'Cours d eau / ravines BDTOPO',
    desc: 'BDTOPO_V3:cours_d_eau',
    type: '2d-vector',
    source: 'IGN BDTOPO_V3 / data.geopf.fr',
    status: 'pending',
  },
  {
    id: 'bdnb_age', group: 'bati',
    label: 'Anciennete batiments (BDNB)',
    desc: '5 tranches thermiques RTAA DOM (T1-T5)',
    type: '2d-vector-tinted',
    source: 'BDNB CSTB API + OSM start_date fallback',
    status: 'pending',
  },

  // ═══════════════════════════════════════════════════════════════
  // CADASTRE / PARCELLES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'cadastre', group: 'cadastre',
    label: 'Cadastre IGN (clotures 1m)',
    desc: 'Parcellaire Express - clotures 3D 1m de haut',
    type: '2d-vector-3d',
    source: 'IGN PARCELLAIRE_EXPRESS:parcelle / data.geopf.fr',
    status: 'implemented',
  },

  // ═══════════════════════════════════════════════════════════════
  // GEOLOGIE / SOL
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'brgm_geol', group: 'geologie',
    label: 'Geologie BRGM 1:50000',
    desc: 'Formations geologiques + permeabilite',
    type: '2d-wms-overlay',
    source: 'BRGM https://geoservices.brgm.fr',
    layer: 'GEOL_REU_50K',
    wmsUrl: 'https://geoservices.brgm.fr/risques',
    status: 'implemented',
    params: { opacity: 0.45 },
  },

  // ═══════════════════════════════════════════════════════════════
  // ORTHO / IMAGERY
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'sat_draped', group: 'imagery',
    label: 'Ortho IGN HD drapee sur terrain',
    desc: 'BD ORTHO 20cm reprojetee sur MNT IGN RGE ALTI = vraie maquette texturee',
    type: '2d-wms-overlay',
    source: 'IGN data.geopf.fr',
    layer: 'HR.ORTHOIMAGERY.ORTHOPHOTOS',
    wmsUrl: 'https://data.geopf.fr/wms-r/wms',
    status: 'implemented',
    params: { opacity: 1.0 },
  },
  {
    id: 'cosia', group: 'imagery',
    label: 'COSIA segmentation IA IGN',
    desc: 'IGNF_COSIA_2021-2023 - 16 classes pre-classifiees IA',
    type: '2d-wms-overlay',
    source: 'IGN data.geopf.fr',
    layer: 'IGNF_COSIA_2021-2023',
    wmsUrl: 'https://data.geopf.fr/wms-r/wms',
    status: 'implemented',
    params: { opacity: 0.45 },
  },

  // ═══════════════════════════════════════════════════════════════
  // BIODIVERSITE
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'znieff', group: 'biodiv',
    label: 'ZNIEFF 1 et 2',
    desc: 'Zones d interet ecologique - INPN data.gouv.fr',
    type: '2d-vector',
    source: 'data.gouv.fr / INPN (pre-telecharge)',
    status: 'pending',
  },
  {
    id: 'parc_national', group: 'biodiv',
    label: 'Parc National Reunion',
    desc: 'Coeur + aire d adhesion',
    type: '2d-vector',
    source: 'INPN / Parc National',
    status: 'pending',
  },

  // ═══════════════════════════════════════════════════════════════
  // METEO / CLIMAT
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'meteo_stations', group: 'meteo',
    label: 'Stations meteo Reunion',
    desc: 'T/HR/pluvio/vent mensuels (10+ stations)',
    type: '2d-points',
    source: 'Meteo-France API + normales 1991-2020',
    status: 'pending',
  },
  {
    id: 'pluvio_era5', group: 'meteo',
    label: 'Pluviometrie ERA5',
    desc: 'Open-Meteo reanalysis 5 ans',
    type: '2d-static',
    source: 'open-meteo.com (gratuit)',
    status: 'pending',
  },

  // ═══════════════════════════════════════════════════════════════
  // VIEWER OVERLAYS (deja implementes)
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'typology_grid', group: 'viewer',
    label: 'Carte typologique 500m',
    desc: 'Grid auto-classifie depuis DINOv2 + LiDAR (foret/canne/urbain/...)',
    type: '3d-grid-tinted',
    source: 'TERLAB pipeline DINOv2 + UMAP+HDBSCAN',
    status: 'implemented',
  },
];


export const LAYER_GROUPS = {
  terrain:    { label: 'Terrain', order: 1 },
  vegetation: { label: 'Vegetation', order: 2 },
  bati:       { label: 'Bati existant', order: 3 },
  risques:    { label: 'Risques', order: 4 },
  urbanisme:  { label: 'Urbanisme PLU', order: 5 },
  cadastre:   { label: 'Cadastre', order: 6 },
  geologie:   { label: 'Geologie', order: 7 },
  imagery:    { label: 'Imagery', order: 8 },
  biodiv:     { label: 'Biodiversite', order: 9 },
  meteo:      { label: 'Meteo', order: 10 },
  viewer:     { label: 'Viewer', order: 11 },
};

// Stats
export function registryStats() {
  const total = LAYERS_REGISTRY.length;
  const implemented = LAYERS_REGISTRY.filter(l => l.status === 'implemented').length;
  return { total, implemented, pending: total - implemented };
}
