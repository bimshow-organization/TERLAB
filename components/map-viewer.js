// TERLAB · map-viewer.js · Wrapper Mapbox GL JS partagé · ENSA La Réunion v1.0
// Gestion unique de la carte, réutilisée dans toutes les phases

import PPRService from '../services/ppr-service.js';
import BRGMService from '../services/brgm-service.js';
import GeoStatusBar from './geo-status-bar.js';
import LidarHeightsPanel from './lidar-heights-panel.js';
import { resilientJSON } from '../utils/resilient-fetch.js';

let _lidarHeightsMounted = false;

const MapViewer = {

  _map:        null,
  _token:      null,
  _mode:       null,
  _draw:       null,
  _profileChart: null,
  _activeTool:  null,
  _profileClickHandler: null,

  // Coordonnées par défaut — centre Réunion
  DEFAULT_CENTER: [55.54, -21.11],
  DEFAULT_ZOOM:   10,

  // ── INIT ──────────────────────────────────────────────────────
  async init({ containerId = 'map', token, mode, pitch = 0, bearing = 0, zoom, center }) {
    this._token = token ?? this._token;
    if (!this._token) { this._renderNoMap(containerId); return; }

    mapboxgl.accessToken = this._token;

    // Détruire la carte précédente si existante
    if (this._map) {
      this._map.remove();
      this._map = null;
    }

    const container = document.getElementById(containerId);
    if (!container) return;

    // Sélectionner le style selon le mode
    const style = this._getStyle(mode);

    this._map = new mapboxgl.Map({
      container: containerId,
      style,
      center:    center ?? this.DEFAULT_CENTER,
      zoom:      zoom ?? this.DEFAULT_ZOOM,
      pitch,
      bearing,
      projection: mode === 'globe-koppen' ? 'globe' : 'mercator',
      antialias:  true,
      preserveDrawingBuffer: true
    });

    // Navigation controls
    this._map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    this._map.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    this._map.addControl(new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'bottom-right');

    this._mode = mode;

    await new Promise(resolve => this._map.once('load', resolve));

    // Patch Mapbox : coercer "len" en 0 pour éviter les erreurs d'expression sur les layers road
    this._patchRoadLenFilters();

    // Injecter la map dans BRGMService pour le pixel sampling
    BRGMService.setMap(this._map);

    // Ajouter les couches selon le mode
    await this._setupLayers(mode);

    // Parcelle toujours visible (toutes phases)
    this._ensureParcelleLayer();

    // Barre de statut géographique
    GeoStatusBar.detach(document.getElementById(containerId));
    const mapContainer = document.getElementById(containerId);
    if (mapContainer) {
      GeoStatusBar.attach({ container: mapContainer, source: 'mapbox', map: this._map });
    }

    // Atmosphère pour le globe
    if (mode === 'globe-koppen') {
      this._map.setFog({ range: [0.8, 8], color: '#0a0f1e', 'horizon-blend': 0.03 });
      this._startGlobeRotation();
    }

    // Auto-capture snapshot couche thématique après chargement des tuiles
    this._autoCaptureLayerSnap(mode);

    // LiDAR Heights : mount panel (first time) ou rebind (changement de map)
    try {
      const root = document.getElementById('lidar-heights-root');
      if (root) {
        if (!_lidarHeightsMounted) {
          LidarHeightsPanel.mount(root, this._map);
          _lidarHeightsMounted = true;
        } else {
          LidarHeightsPanel.rebind(this._map);
        }
      }
    } catch (err) {
      console.warn('[Map] LidarHeightsPanel mount failed:', err);
    }

    console.info(`[Map] Init mode="${mode}" pitch=${pitch} bearing=${bearing}`);
    return this._map;
  },

  /** Capture un snapshot de la carte une fois les tuiles chargées, stocké en session */
  _autoCaptureLayerSnap(mode) {
    const LAYER_SNAP_MODES = {
      'pprn+simulation-eau':   'snap_ppr',
      'plu+reculs':            'snap_plu',
      'satellite+cadastre':    'snap_cadastre',
      'brgm+pprn-mouvements':  'snap_brgm',
      'nature-ign+znieff':     'snap_nature',
      'terrain3d+ravines':     'snap_terrain3d',
      'buildings3d+icpe':      'snap_bati3d',
    };
    const snapKey = LAYER_SNAP_MODES[mode];
    if (!snapKey) return;

    const m = this._map;
    const doCapture = () => {
      // JPEG compressé pour limiter la taille en session (~60-100 Ko au lieu de ~300-500 Ko PNG)
      const dataURL = this._map?.getCanvas()?.toDataURL('image/jpeg', 0.7) ?? null;
      if (dataURL) {
        window.SessionManager?.saveTerrain?.({ [snapKey]: dataURL });
        console.log(`[Map] Snapshot couche "${snapKey}" sauvegardé (${Math.round(dataURL.length / 1024)} Ko)`);
      }
    };
    // Attendre idle (toutes tuiles chargées) puis capturer
    if (m.areTilesLoaded()) {
      setTimeout(doCapture, 500);
    } else {
      m.once('idle', () => setTimeout(doCapture, 300));
    }
  },

  setToken(token) { this._token = token; },

  // ── STYLES MAPBOX ─────────────────────────────────────────────
  _getStyle(mode) {
    const styles = {
      'satellite+cadastre':    'mapbox://styles/mapbox/satellite-streets-v12',
      'terrain3d+ravines':     'mapbox://styles/mapbox/satellite-streets-v12',
      'brgm+pprn-mouvements':  'mapbox://styles/mapbox/satellite-streets-v12',
      'pprn+simulation-eau':   'mapbox://styles/mapbox/satellite-streets-v12',
      'plu+reculs':            'mapbox://styles/mapbox/satellite-streets-v12',
      'buildings3d+icpe':      'mapbox://styles/mapbox/satellite-streets-v12',
      'nature-ign+znieff':     'mapbox://styles/mapbox/satellite-streets-v12',
      'bimshow-extrusion':     'mapbox://styles/mapbox/satellite-streets-v12',
      'satellite':             'mapbox://styles/mapbox/satellite-streets-v12',
      'overview':              'mapbox://styles/mapbox/satellite-streets-v12',
      'globe-koppen':          'mapbox://styles/mapbox/satellite-streets-v12',
      'durabilite+filieres':   'mapbox://styles/mapbox/satellite-streets-v12',
      'chantier+securite':     'mapbox://styles/mapbox/satellite-streets-v12'
    };
    return styles[mode] ?? 'mapbox://styles/mapbox/satellite-streets-v12';
  },

  // ── SETUP COUCHES PAR MODE ────────────────────────────────────
  async _setupLayers(mode) {
    switch (mode) {
      case 'satellite+cadastre':     await this._addCadastreLayers();      break;
      case 'terrain3d+ravines':      await this._addTerrain3D();            break;
      case 'brgm+pprn-mouvements':   await this._addBRGMLayers();            break;
      case 'pprn+simulation-eau':    await this._addPPRNLayers();           break;
      case 'plu+reculs':             await this._addPLULayers();            break;
      case 'buildings3d+icpe':       await this._addBuildings3D();          break;
      case 'nature-ign+znieff':      await this._addNatureLayers();         break;
      case 'bimshow-extrusion':      await this._addExtrusionLayer();       break;
      case 'overview':               await this._addOverviewLayers();       break;
      case 'globe-koppen':           await this._addKoppenMarkers();        break;
      case 'durabilite+filieres':    await this._addDurabiliteLayers();     break;
      case 'chantier+securite':     await this._addChantierLayers();      break;
    }
  },

  // ── PATCH ROAD LEN — coercer "len" null → 0 dans les filtres road ──
  _patchRoadLenFilters() {
    const m = this._map;
    if (!m) return;
    try {
      const style = m.getStyle();
      if (!style?.layers) return;
      for (const layer of style.layers) {
        const filter = layer.filter;
        if (!filter) continue;
        const json = JSON.stringify(filter);
        if (json.includes('"get","len"')) {
          const patched = JSON.parse(json.replaceAll(
            '["get","len"]',
            '["coalesce",["get","len"],0]'
          ));
          m.setFilter(layer.id, patched);
        }
      }
    } catch (e) {
      // silently ignore — cosmetic fix only
    }
  },

  // ── PARCELLE — toujours visible (toutes phases) ──────────────
  _ensureParcelleLayer() {
    const m = this._map;
    if (!m || m.getSource('parcelle-selected')) return;

    m.addSource('parcelle-selected', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'parcelle-fill', type: 'fill', source: 'parcelle-selected', paint: { 'fill-color': '#C1652B', 'fill-opacity': 0.18 } });
    m.addLayer({ id: 'parcelle-casing', type: 'line', source: 'parcelle-selected', paint: { 'line-color': '#000000', 'line-width': 5, 'line-opacity': 0.5 } });
    m.addLayer({ id: 'parcelle-outline', type: 'line', source: 'parcelle-selected', paint: { 'line-color': '#C1652B', 'line-width': 3 } });

    // Restaurer la géométrie depuis la session
    const terrain = window.SessionManager?.getTerrain?.() ?? {};
    const geom = terrain.parcelle_geojson
      ?? (terrain.geometrie_approx ? { type: 'Polygon', coordinates: [terrain.geometrie_approx] } : null);
    if (geom) {
      const src = m.getSource('parcelle-selected');
      if (src) src.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geom }] });
    }
  },

  // ── COUCHE CADASTRE (Phase 0) ─────────────────────────────────
  async _addCadastreLayers() {
    const m = this._map;

    // WMTS Cadastre IGN
    m.addSource('cadastre-wmts', {
      type: 'raster',
      tiles: ['https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=CADASTRALPARCELS.PARCELLAIRE_EXPRESS&STYLE=PCI%20vecteur&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png'],
      tileSize: 256,
      minzoom: 14,
      maxzoom: 19,
      attribution: '© IGN Géoplateforme'
    });
    m.addLayer({ id: 'cadastre', type: 'raster', source: 'cadastre-wmts', minzoom: 14, paint: { 'raster-opacity': 0.7, 'raster-saturation': -1 } });

    // Plan IGN WMTS (GIEP: carte.js addGeoportailLayers)
    m.addSource('geoportail-plan', {
      type: 'raster',
      tiles: ['https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
             + '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal'
             + '&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'],
      tileSize: 256,
      maxzoom: 18,
    });
    m.addLayer({
      id: 'plan-ign', type: 'raster', source: 'geoportail-plan',
      paint: { 'raster-opacity': 0.5 },
      layout: { visibility: 'none' }
    });

    // Parcelle sélectionnée — déjà créée par _ensureParcelleLayer

    // Reculs ghost (Phase 4 si données disponibles)
    m.addSource('reculs-preview', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'reculs-fill', type: 'fill', source: 'reculs-preview', paint: { 'fill-color': '#a78bfa', 'fill-opacity': 0.08 } });
    m.addLayer({ id: 'reculs-outline', type: 'line', source: 'reculs-preview', paint: { 'line-color': '#a78bfa', 'line-width': 1, 'line-dasharray': [4, 3] } });

    // Clic → recherche parcelle (ou multi-sélection si actif)
    m.on('click', async e => {
      const feature = await this.searchParcelleAt(e.lngLat.lng, e.lngLat.lat);
      if (!feature) return;

      // Si multi-sélection active → dispatch pour ParcelSelector
      if (window.ParcelSelector?.isActive?.()) {
        const props = feature.properties ?? {};
        window.dispatchEvent(new CustomEvent('terlab:parcelle-click', {
          detail: {
            parcelle: {
              commune:        props.commune ?? props.nom_com ?? '',
              section:        props.section ?? '',
              numero:         props.numero ?? '',
              reference:      `${props.commune ?? ''}${props.section ?? ''}${props.numero ?? ''}`,
              contenance_m2:  props.contenance ? parseFloat(props.contenance) : 0,
              geometry:       feature.geometry,
            },
            coordinates: feature.geometry,
          }
        }));
      }
    });
  },

  // ── TERRAIN 3D (Phase 1) ──────────────────────────────────────
  async _addTerrain3D() {
    const m = this._map;

    m.addSource('mapbox-dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
    m.setTerrain({ source: 'mapbox-dem', exaggeration: 1.4 });

    // Source DEM separee pour le hillshade (evite le warning Mapbox resolution)
    m.addSource('mapbox-dem-hillshade', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
    m.addLayer({ id: 'hillshade', type: 'hillshade', source: 'mapbox-dem-hillshade', paint: { 'hillshade-shadow-color': '#1a0e00', 'hillshade-exaggeration': 0.5 } });

    // Ravines (waterway OSM via Mapbox)
    m.addLayer({
      id: 'ravines',
      type: 'line',
      source: 'composite',
      'source-layer': 'waterway',
      paint: {
        'line-color': '#00bcd4',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 3],
        'line-opacity': 0.8
      }
    });

    // Lumière sky
    m.setFog({ range: [0.5, 10], color: '#0a0a14', 'high-color': '#1a1a2e', 'horizon-blend': 0.02 });
  },

  // ── OVERLAY ZONES PERENE (Izard — 3 zones altitude) ──────────
  addPereneOverlay(altitudeMoy) {
    const m = this._map;
    if (!m || m.getSource('perene-zone')) return;

    const zone = altitudeMoy < 400 ? 1 : altitudeMoy < 800 ? 2 : 3;
    const PERENE = {
      1: { color: '#22c55e', label: 'PERENE 1 — Bas (<400m)',       opacity: 0.12 },
      2: { color: '#f59e0b', label: 'PERENE 2 — Mi-pentes (400-800m)', opacity: 0.15 },
      3: { color: '#ef4444', label: 'PERENE 3 — Hauts (>800m)',     opacity: 0.18 },
    };
    const p = PERENE[zone];

    // Cercle de contexte (~500m) autour de la parcelle
    const terrain = window.SessionManager?.getTerrain?.() ?? {};
    const center = terrain.center_lnglat ?? terrain.lnglat ?? this.DEFAULT_CENTER;
    const lng = Array.isArray(center) ? center[0] : center.lng;
    const lat = Array.isArray(center) ? center[1] : center.lat;

    // Générer un polygone circulaire ~500m
    const R = 0.005; // ~500m en degrés à lat -21°
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * 2 * Math.PI;
      pts.push([lng + R * Math.cos(a), lat + R * Math.sin(a) * 1.08]);
    }

    m.addSource('perene-zone', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] }, properties: { zone, label: p.label } }
    });
    m.addLayer({
      id: 'perene-zone-fill',
      type: 'fill',
      source: 'perene-zone',
      paint: { 'fill-color': p.color, 'fill-opacity': p.opacity }
    });
    m.addLayer({
      id: 'perene-zone-line',
      type: 'line',
      source: 'perene-zone',
      paint: { 'line-color': p.color, 'line-width': 2, 'line-opacity': 0.6, 'line-dasharray': [4, 2] }
    });
    m.addLayer({
      id: 'perene-zone-label',
      type: 'symbol',
      source: 'perene-zone',
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-anchor': 'center',
      },
      paint: { 'text-color': p.color, 'text-halo-color': 'rgba(0,0,0,0.8)', 'text-halo-width': 1.5 }
    });

    return zone;
  },

  removePereneOverlay() {
    const m = this._map;
    if (!m) return;
    ['perene-zone-label', 'perene-zone-line', 'perene-zone-fill'].forEach(id => {
      if (m.getLayer(id)) m.removeLayer(id);
    });
    if (m.getSource('perene-zone')) m.removeSource('perene-zone');
  },

  // ── COURBES DE NIVEAU 2D (GeoJSON isolignes) ─────────────────
  async addContourLines(wgsBounds, opts = {}) {
    const m = this._map;
    if (!m) return;
    const ContourService = window.ContourService;
    if (!ContourService) { console.warn('[Map] ContourService non disponible'); return; }

    try {
      // Générer les isolignes depuis BIL (haute résolution)
      const contourData = await ContourService.fromBIL(wgsBounds, {
        pixelSizeM: opts.pixelSizeM ?? 2,
        maxDim: opts.maxDim ?? 256,
        interval: opts.interval,
      });
      if (!contourData.lines.length) return;

      const geojson = ContourService.toGeoJSON(contourData);

      // Nettoyer source/layers existants
      if (m.getLayer('contour-major')) m.removeLayer('contour-major');
      if (m.getLayer('contour-minor')) m.removeLayer('contour-minor');
      if (m.getLayer('contour-labels')) m.removeLayer('contour-labels');
      if (m.getSource('contour-lines')) m.removeSource('contour-lines');

      m.addSource('contour-lines', { type: 'geojson', data: geojson });

      // Courbes mineures
      m.addLayer({
        id: 'contour-minor',
        type: 'line',
        source: 'contour-lines',
        filter: ['==', ['get', 'isMajor'], false],
        paint: {
          'line-color': '#c8a85a',
          'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 17, 1.2],
          'line-opacity': 0.45,
        },
      });

      // Courbes majeures
      m.addLayer({
        id: 'contour-major',
        type: 'line',
        source: 'contour-lines',
        filter: ['==', ['get', 'isMajor'], true],
        paint: {
          'line-color': '#ffa500',
          'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 17, 2.5],
          'line-opacity': 0.8,
        },
      });

      // Labels altitude sur courbes majeures
      m.addLayer({
        id: 'contour-labels',
        type: 'symbol',
        source: 'contour-lines',
        filter: ['==', ['get', 'isMajor'], true],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'label'],
          'text-size': 11,
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          'text-max-angle': 30,
          'text-padding': 40,
        },
        paint: {
          'text-color': '#ffa500',
          'text-halo-color': 'rgba(0,0,0,0.7)',
          'text-halo-width': 1.5,
        },
      });

      console.log(`[Map] ${contourData.lines.length} courbes de niveau (interval ${contourData.interval}m, ${contourData.minAlt.toFixed(0)}–${contourData.maxAlt.toFixed(0)} m)`);
      return contourData;
    } catch (err) {
      console.warn('[Map] Courbes de niveau indisponibles:', err.message);
    }
  },

  removeContourLines() {
    const m = this._map;
    if (!m) return;
    if (m.getLayer('contour-major'))  m.removeLayer('contour-major');
    if (m.getLayer('contour-minor'))  m.removeLayer('contour-minor');
    if (m.getLayer('contour-labels')) m.removeLayer('contour-labels');
    if (m.getSource('contour-lines')) m.removeSource('contour-lines');
  },

  toggleContourLines(visible) {
    const m = this._map;
    if (!m) return;
    const v = visible ? 'visible' : 'none';
    ['contour-major', 'contour-minor', 'contour-labels'].forEach(id => {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', v);
    });
  },

  // ── CARTE GÉOLOGIQUE BRGM (Phase 2) ───────────────────────────
  async _addBRGMLayers() {
    const m = this._map;

    // Terrain 3D pour le relief
    await this._addTerrain3D();

    // ── Couche raster WMS BRGM Réunion 1:50 000 ────────────────
    // Endpoint vérifié via GetCapabilities geoservices.brgm.fr
    // Layers dispo : GEOL_REU_50K (1:50k), GEOL_REU_100K (1:100k)
    m.addSource('brgm-geol', {
      type: 'raster',
      tiles: [
        'https://geoservices.brgm.fr/geologie?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap'
        + '&LAYERS=GEOL_REU_50K&STYLES=&CRS=EPSG:3857'
        + '&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true'
      ],
      tileSize: 256,
      attribution: '© BRGM — Carte géologique Réunion 1:50 000'
    });
    m.addLayer({
      id: 'brgm-geol-layer',
      type: 'raster',
      source: 'brgm-geol',
      paint: { 'raster-opacity': 0.65 }
    });

    // ── Fallback : BRGM 1:100 000 si 50k indisponible ──────────
    m.addSource('brgm-geol-100k', {
      type: 'raster',
      tiles: [
        'https://geoservices.brgm.fr/geologie?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap'
        + '&LAYERS=GEOL_REU_100K&STYLES=&CRS=EPSG:3857'
        + '&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true'
      ],
      tileSize: 256,
      attribution: '© BRGM — Carte géologique Réunion 1:100 000'
    });
    m.addLayer({
      id: 'brgm-geol-100k-layer',
      type: 'raster',
      source: 'brgm-geol-100k',
      paint: { 'raster-opacity': 0 },
      layout: { visibility: 'none' }
    });

    // Détection erreur tuiles BRGM 50k → bascule vers 100k → fallback image locale
    let brgmFailed = false, brgm100kFailed = false;
    m.on('error', (e) => {
      const src = e.sourceId ?? e.source?.id;
      if (src === 'brgm-geol' && !brgmFailed) {
        brgmFailed = true;
        console.warn('[Map] Tuiles BRGM 50k indisponibles — fallback 100k');
        m.setPaintProperty('brgm-geol-layer', 'raster-opacity', 0);
        m.setLayoutProperty('brgm-geol-100k-layer', 'visibility', 'visible');
        m.setPaintProperty('brgm-geol-100k-layer', 'raster-opacity', 0.65);
      }
      if (src === 'brgm-geol-100k' && !brgm100kFailed) {
        brgm100kFailed = true;
        console.warn('[Map] Tuiles BRGM 100k indisponibles — fallback image locale');
        m.setPaintProperty('brgm-geol-100k-layer', 'raster-opacity', 0);
        this._addGeolFallbackImage(m);
      }
    });
  },

  /** Fallback carte géologique : image PNG statique géoréférencée */
  _addGeolFallbackImage(m) {
    // Bounds de l'île de La Réunion (carte géologique BRGM scannée)
    const bounds = [
      [55.205, -21.395],  // SW [lng, lat]
      [55.845, -21.395],  // SE
      [55.845, -20.855],  // NE
      [55.205, -20.855],  // NW
    ];
    try {
      m.addSource('brgm-fallback', {
        type: 'image',
        url: 'data/carte-geologique-reunion.png',
        coordinates: bounds
      });
      m.addLayer({
        id: 'brgm-fallback-layer',
        type: 'raster',
        source: 'brgm-fallback',
        paint: { 'raster-opacity': 0.55 }
      });
      this._showStubBanner('Carte géologique locale (BRGM offline) — précision limitée');
    } catch (e) {
      console.warn('[Map] Fallback image géol. indisponible:', e.message);
    }
  },

  // ── PPRN + SIMULATION EAU (Phase 3) ──────────────────────────
  async _addPPRNLayers() {
    const m = this._map;

    // Terrain 3D + DEM
    m.addSource('mapbox-dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
    m.setTerrain({ source: 'mapbox-dem', exaggeration: 1.2 });

    // ── PPR approuvés — AGORAH PEIGEO (GeoServer public) ───────
    // Si PPRService est désactivé (HTTPS context), config = null → on
    // skip directement la couche et on affiche la bannière de fallback.
    const pprCfg = PPRService.getPPRSourceConfig();
    if (pprCfg) {
      m.addSource('ppr-peigeo', pprCfg);
      m.addLayer({
        id: 'ppr-layer',
        type: 'raster',
        source: 'ppr-peigeo',
        paint: { 'raster-opacity': 0.65 }
      });

      // Fallback si PEIGEO indisponible (timeout, CORS, etc.)
      let pprFailed = false;
      m.on('error', (e) => {
        if (pprFailed) return;
        const src = e.sourceId ?? e.source?.id;
        if (src === 'ppr-peigeo') {
          pprFailed = true;
          console.warn('[Map] Tuiles PPR PEIGEO indisponibles');
          m.setPaintProperty('ppr-layer', 'raster-opacity', 0);
          this._showStubBanner('PPR PEIGEO indisponible — saisie manuelle requise');
        }
      });
    } else {
      console.warn('[Map] PPRService désactivé:', PPRService.disabledReason);
      this._showStubBanner('PPR PEIGEO indisponible (HTTPS) — saisie manuelle requise');
    }

    // Couche simulation inondation — bathtub DEM
    m.addSource('flood-sim', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({
      id: 'flood-fill',
      type: 'fill',
      source: 'flood-sim',
      paint: {
        'fill-color': [
          'interpolate', ['linear'], ['get', 'depth'],
          0,   'rgba(14, 165, 233, 0.20)',   // très peu profond
          1,   'rgba(14, 165, 233, 0.45)',
          3,   'rgba(2,  132, 199, 0.60)',
          5,   'rgba(3,   105, 161, 0.75)'   // profond
        ],
        'fill-opacity': 1
      }
    });

    // Trajectoires cyclones (GeoJSON statique — stub si fichier absent)
    try {
      const resp = await fetch('data/cyclones-reunion.json');
      if (resp.ok) {
        const gj = await resp.json();
        m.addSource('cyclones', { type: 'geojson', data: gj });
        m.addLayer({ id: 'cyclones-line', type: 'line', source: 'cyclones',
          paint: { 'line-color': '#ff6b4a', 'line-width': 1.5, 'line-opacity': 0.6, 'line-dasharray': [3, 2] } });
      }
    } catch { /* cyclones.json non disponible — pas critique */ }
  },

  // ── PLU + RECULS (Phase 4) ────────────────────────────────────
  async _addPLULayers() {
    const m = this._map;

    // ── Cadastre + Plan IGN (toggleables depuis P04) ───────────
    if (!m.getSource('cadastre-wmts')) {
      m.addSource('cadastre-wmts', {
        type: 'raster',
        tiles: ['https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=CADASTRALPARCELS.PARCELLAIRE_EXPRESS&STYLE=PCI%20vecteur&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png'],
        tileSize: 256, minzoom: 14, maxzoom: 19,
        attribution: '© IGN Géoplateforme'
      });
      m.addLayer({ id: 'cadastre', type: 'raster', source: 'cadastre-wmts', minzoom: 14, paint: { 'raster-opacity': 0.7, 'raster-saturation': -1 } });
    }
    if (!m.getSource('geoportail-plan')) {
      m.addSource('geoportail-plan', {
        type: 'raster',
        tiles: ['https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
               + '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal'
               + '&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'],
        tileSize: 256, maxzoom: 18,
      });
      m.addLayer({ id: 'plan-ign', type: 'raster', source: 'geoportail-plan', paint: { 'raster-opacity': 0.5 }, layout: { visibility: 'none' } });
    }

    // ── PLU simplifié — AGORAH PEIGEO (GeoServer public) ───────
    const pluCfg = PPRService.getPLUSourceConfig();
    if (pluCfg) {
      m.addSource('plu-peigeo', pluCfg);
      m.addLayer({
        id: 'plu-layer',
        type: 'raster',
        source: 'plu-peigeo',
        paint: { 'raster-opacity': 0.55 }
      });

      // Fallback si PEIGEO indisponible
      let pluFailed = false;
      m.on('error', (e) => {
        if (pluFailed) return;
        const src = e.sourceId ?? e.source?.id;
        if (src === 'plu-peigeo') {
          pluFailed = true;
          console.warn('[Map] Tuiles PLU PEIGEO indisponibles');
          m.setPaintProperty('plu-layer', 'raster-opacity', 0);
          this._showStubBanner('PLU PEIGEO indisponible — API Carto IGN utilisée en fallback');
        }
      });
    } else {
      console.warn('[Map] PLU PEIGEO désactivé:', PPRService.disabledReason);
      this._showStubBanner('PLU PEIGEO indisponible (HTTPS) — API Carto IGN utilisée en fallback');
    }

    // Couche parcelle + reculs depuis session
    m.addSource('parcelle-p4', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'parcelle-p4-fill', type: 'fill', source: 'parcelle-p4', paint: { 'fill-color': '#C1652B', 'fill-opacity': 0.1 } });
    m.addLayer({ id: 'parcelle-p4-line', type: 'line', source: 'parcelle-p4', paint: { 'line-color': '#C1652B', 'line-width': 2 } });

    m.addSource('reculs-p4', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'reculs-p4-fill', type: 'fill', source: 'reculs-p4', paint: { 'fill-color': '#a78bfa', 'fill-opacity': 0.15 } });
    m.addLayer({ id: 'reculs-p4-line', type: 'line', source: 'reculs-p4', paint: { 'line-color': '#a78bfa', 'line-width': 1, 'line-dasharray': [4, 3] } });

    // Overlay PERENE automatique si altitude connue (Izard — zones RTAA)
    const altNgr = parseFloat(window.SessionManager?.getTerrain?.()?.altitude_ngr);
    if (altNgr > 0) this.addPereneOverlay(altNgr);
  },

  // ── BÂTIMENTS 3D + ICPE (Phase 5) ────────────────────────────
  async _addBuildings3D() {
    const m = this._map;

    m.addLayer({
      id: 'buildings-3d',
      type: 'fill-extrusion',
      source: 'composite',
      'source-layer': 'building',
      filter: ['==', 'extrude', 'true'],
      paint: {
        'fill-extrusion-color': '#c4b396',
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 16, ['coalesce', ['get', 'height'], 0]],
        'fill-extrusion-base':   ['coalesce', ['get', 'min_height'], 0],
        'fill-extrusion-opacity': 0.75
      }
    });

    // Cercle rayon 500m pour ICPE
    m.addSource('icpe-radius', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'icpe-circle', type: 'fill', source: 'icpe-radius',
      paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.08 } });
    m.addLayer({ id: 'icpe-circle-line', type: 'line', source: 'icpe-radius',
      paint: { 'line-color': '#f59e0b', 'line-width': 1, 'line-dasharray': [4, 3] } });

    // ── Heatmap ICU — Îlot de chaleur urbain (Izard Microclimat Urbain 1) ──
    // Densité bâtie → proxy ICU. Plus le tissu est dense, plus l'effet est marqué.
    m.addLayer({
      id: 'icu-heatmap',
      type: 'heatmap',
      source: 'composite',
      'source-layer': 'building',
      maxzoom: 18,
      layout: { visibility: 'none' },
      paint: {
        'heatmap-weight': ['interpolate', ['linear'], ['coalesce', ['get', 'height'], 6], 0, 0, 6, 0.4, 15, 0.8, 30, 1],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 11, 0.3, 15, 1],
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0,    'rgba(0,0,0,0)',
          0.2,  'rgba(34,197,94,0.3)',
          0.4,  'rgba(234,179,8,0.5)',
          0.6,  'rgba(249,115,22,0.6)',
          0.8,  'rgba(239,68,68,0.7)',
          1,    'rgba(185,28,28,0.8)',
        ],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 11, 8, 15, 20, 17, 30],
        'heatmap-opacity': 0.7,
      }
    });
  },

  /** Toggle heatmap ICU (appelé depuis P05) */
  toggleICUHeatmap(visible) {
    const m = this._map;
    if (!m || !m.getLayer('icu-heatmap')) return;
    m.setLayoutProperty('icu-heatmap', 'visibility', visible ? 'visible' : 'none');
  },

  // ── NATURE + ZNIEFF (Phase 6) ─────────────────────────────────
  async _addNatureLayers() {
    const m = this._map;

    // Style clair pour le fond
    await m.setStyle('mapbox://styles/mapbox/outdoors-v12');
    await new Promise(r => m.once('styledata', r));

    m.addSource('parc-national', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'parc-fill', type: 'fill', source: 'parc-national',
      paint: { 'fill-color': '#3d6b2e', 'fill-opacity': 0.12 } });
    m.addLayer({ id: 'parc-line', type: 'line', source: 'parc-national',
      paint: { 'line-color': '#3d6b2e', 'line-width': 2, 'line-dasharray': [3, 2] } });
  },

  // ── EXTRUSION GABARIT (Phase 7) ───────────────────────────────
  async _addExtrusionLayer() {
    const m = this._map;

    m.addSource('mapbox-dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
    m.setTerrain({ source: 'mapbox-dem', exaggeration: 1.0 });

    m.addSource('gabarit-3d', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({
      id: 'gabarit-extrusion',
      type: 'fill-extrusion',
      source: 'gabarit-3d',
      paint: {
        'fill-extrusion-color':   '#f59e0b',
        'fill-extrusion-height':  ['coalesce', ['get', 'height'], 0],
        'fill-extrusion-base':    0,
        'fill-extrusion-opacity': 0.7
      }
    });

    // Ombres reculs
    m.addSource('reculs-3d', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'reculs-shade', type: 'fill', source: 'reculs-3d',
      paint: { 'fill-color': '#a78bfa', 'fill-opacity': 0.12 } });
  },

  // ── OVERVIEW (Phase 12) ───────────────────────────────────────
  async _addOverviewLayers() {
    const m = this._map;
    m.addSource('mapbox-dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
    m.setTerrain({ source: 'mapbox-dem', exaggeration: 1.2 });
    await this._addCadastreLayers();
  },

  // ── GLOBE Köppen (Phase 13) ───────────────────────────────────
  async _addKoppenMarkers() {
    const m = this._map;

    try {
      const resp = await fetch('data/climat-koppen.json');
      if (!resp.ok) throw new Error('Köppen JSON non trouvé');
      const data = await resp.json();

      for (const zone of data.zones_similaires) {
        const el = document.createElement('div');
        el.className = 'koppen-marker';
        el.style.cssText = `
          width:${zone.marker_size === 'large' ? 16 : 10}px;
          height:${zone.marker_size === 'large' ? 16 : 10}px;
          background:${zone.marker_color ?? '#3c78dc'};
          border-radius:50%;
          border:2px solid rgba(255,255,255,0.6);
          cursor:pointer;
          transition:transform .2s;
        `;
        el.title = zone.nom;

        el.addEventListener('mouseenter', () => el.style.transform = 'scale(1.6)');
        el.addEventListener('mouseleave', () => el.style.transform = 'scale(1)');
        el.addEventListener('click', () => this._showKoppenPanel(zone));

        new mapboxgl.Marker(el)
          .setLngLat([zone.lng, zone.lat])
          .addTo(m);
      }
    } catch (e) {
      console.warn('[Map] Köppen markers:', e.message);
    }
  },

  // ── CHANTIER + SECURITE (P08) ───────────────────────────────────
  async _addChantierLayers() {
    const m = this._map;
    const terrain = window.SessionManager?.getTerrain() ?? {};
    const lng = parseFloat(terrain.lng ?? 55.45);
    const lat = parseFloat(terrain.lat ?? -21.11);
    const center = [lng, lat];
    const parcelleGeom = terrain.parcelle_geometry ?? terrain.parcelle_geojson;

    // ── 1. Hydrant SDIS 150m radius ──
    if (!m.getSource('hydrant-circle-src')) {
      m.addSource('hydrant-circle-src', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'Point', coordinates: center }, properties: {} }
      });
      m.addLayer({
        id: 'hydrant-circle',
        type: 'circle',
        source: 'hydrant-circle-src',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 15, 15, 80, 17, 250, 19, 600],
          'circle-color': 'rgba(239, 68, 68, 0.08)',
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(239, 68, 68, 0.5)'
        }
      });
    }

    // ── 2. Zone d'Installation de Chantier (ZIC) ──
    const p07data = window.SessionManager?.getPhase(7)?.data ?? {};
    let zicGeojson = null;

    if (parcelleGeom && window.turf) {
      try {
        const parcelleFeature = parcelleGeom.type === 'Feature' ? parcelleGeom
          : parcelleGeom.type === 'FeatureCollection' ? parcelleGeom.features[0]
          : { type: 'Feature', geometry: parcelleGeom, properties: {} };
        const bbox = turf.bbox(parcelleFeature);
        // ZIC = 1/3 de la parcelle côté voie (approximation : premier tiers en latitude)
        const thirdH = (bbox[3] - bbox[1]) / 3;
        zicGeojson = {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [bbox[0], bbox[1]],
              [bbox[2], bbox[1]],
              [bbox[2], bbox[1] + thirdH],
              [bbox[0], bbox[1] + thirdH],
              [bbox[0], bbox[1]]
            ]]
          },
          properties: { label: 'ZIC' }
        };
      } catch (e) {
        console.warn('[Map] ZIC calc:', e.message);
      }
    }

    if (zicGeojson && !m.getSource('zic-src')) {
      m.addSource('zic-src', { type: 'geojson', data: zicGeojson });
      m.addLayer({
        id: 'zic-fill',
        type: 'fill',
        source: 'zic-src',
        paint: { 'fill-color': 'rgba(59, 130, 246, 0.15)', 'fill-outline-color': 'rgba(59, 130, 246, 0.6)' }
      });
      m.addLayer({
        id: 'zic-line',
        type: 'line',
        source: 'zic-src',
        paint: { 'line-color': '#3b82f6', 'line-width': 2, 'line-dasharray': [6, 4] }
      });
      m.addLayer({
        id: 'zic-label',
        type: 'symbol',
        source: 'zic-src',
        layout: {
          'text-field': 'Zone Installation Chantier (ZIC)',
          'text-size': 11,
          'text-anchor': 'center'
        },
        paint: { 'text-color': '#3b82f6', 'text-halo-color': 'rgba(0,0,0,0.6)', 'text-halo-width': 1 }
      });
    }

    // ── 3. Cyclone badge overlay ──
    // Managed by SVG overlay in phase script (not map layer)
    const month = new Date().getMonth();
    const isCyclone = month >= 10 || month <= 3;
    window.TERLAB_CYCLONE_STATUS = { isCyclone, month };

    // ── 4. Hydrant stub badge ──
    // SDIS 974 non open data — indicatif seulement
    window.TERLAB_HYDRANT_STUB = {
      warning: 'Données hydrants SDIS 974 non open data — vérifier sur terrain',
      radius_m: 150,
      center
    };
  },

  // ── DURABILITE + FILIERES (P10 fusionnée) ──────────────────────
  async _addDurabiliteLayers() {
    const m = this._map;
    const terrain = window.SessionManager?.getTerrain() ?? {};
    const lng = parseFloat(terrain.lng ?? 55.45);
    const lat = parseFloat(terrain.lat ?? -21.11);
    const center = [lng, lat];

    // ── 1. Corrosion circles ──
    // Approximation distance côte via centroïde île (fallback si coastline non chargée)
    let corrosionLevel = 'modérée';
    let distCoast_km = 5;

    try {
      if (!window.TERLAB_COASTLINE) {
        const resp = await fetch('data/coastline-reunion-simplified.geojson');
        if (resp.ok) window.TERLAB_COASTLINE = await resp.json();
      }
      if (window.TERLAB_COASTLINE && window.turf) {
        const pt = turf.point(center);
        const line = window.TERLAB_COASTLINE.geometry
          ? window.TERLAB_COASTLINE
          : turf.lineString(window.TERLAB_COASTLINE.geometry.coordinates);
        const nearest = turf.nearestPointOnLine(line, pt);
        distCoast_km = nearest.properties.dist ?? 5;
      } else {
        // Fallback : distance vol d'oiseau vers centroïde côtier
        const dLat = lat - (-21.115);
        const dLng = lng - 55.536;
        distCoast_km = Math.sqrt(dLat * dLat + dLng * dLng) * 111;
      }
      if (distCoast_km < 0.5) corrosionLevel = 'forte';
      else if (distCoast_km < 2.0) corrosionLevel = 'modérée';
      else corrosionLevel = 'faible';
    } catch (e) {
      console.warn('[Map] Corrosion calc:', e.message);
    }

    // Store corrosion data for phase script
    window.TERLAB_CORROSION = { level: corrosionLevel, dist_km: Math.round(distCoast_km * 10) / 10 };

    // Add corrosion circle layers
    const corrosionCircles = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: center }, properties: { radius: 2000, level: 'faible' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: center }, properties: { radius: 500,  level: 'forte' } }
      ]
    };

    if (!m.getSource('corrosion-src')) {
      m.addSource('corrosion-src', { type: 'geojson', data: corrosionCircles });

      // Outer ring (> 2km = faible)
      m.addLayer({
        id: 'corrosion-outer',
        type: 'circle',
        source: 'corrosion-src',
        filter: ['==', ['get', 'level'], 'faible'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 30, 14, 200, 17, 800],
          'circle-color': 'rgba(46, 184, 96, 0.08)',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': 'rgba(46, 184, 96, 0.4)'
        }
      });

      // Inner ring (< 500m = forte)
      m.addLayer({
        id: 'corrosion-inner',
        type: 'circle',
        source: 'corrosion-src',
        filter: ['==', ['get', 'level'], 'forte'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 8, 14, 50, 17, 200],
          'circle-color': 'rgba(239, 68, 68, 0.1)',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': 'rgba(239, 68, 68, 0.5)'
        }
      });
    }

    // ── 2. Filières ILEVA / ressourceries ──
    try {
      if (!window.TERLAB_FILIERES) {
        const resp = await fetch('data/filieres-reunion.geojson');
        if (resp.ok) window.TERLAB_FILIERES = await resp.json();
      }

      const filieres = window.TERLAB_FILIERES;
      if (filieres && !m.getSource('filieres-src')) {
        m.addSource('filieres-src', { type: 'geojson', data: filieres });

        // Points filières
        m.addLayer({
          id: 'filieres-points',
          type: 'circle',
          source: 'filieres-src',
          paint: {
            'circle-radius': 7,
            'circle-color': [
              'match', ['get', 'type'],
              'ileva', '#3b82f6',
              'ressourcerie', '#22c55e',
              '#888'
            ],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#fff'
          }
        });

        // Labels filières
        m.addLayer({
          id: 'filieres-labels',
          type: 'symbol',
          source: 'filieres-src',
          layout: {
            'text-field': ['get', 'nom'],
            'text-size': 10,
            'text-offset': [0, 1.5],
            'text-anchor': 'top',
            'text-max-width': 12
          },
          paint: {
            'text-color': '#fff',
            'text-halo-color': 'rgba(0,0,0,0.7)',
            'text-halo-width': 1
          }
        });

        // Find nearest filière and draw line
        let nearestDist = Infinity;
        let nearestCoords = null;
        let nearestName = '';
        for (const f of filieres.features) {
          const fc = f.geometry.coordinates;
          const d = Math.sqrt(Math.pow(fc[0] - lng, 2) + Math.pow(fc[1] - lat, 2)) * 111;
          if (d < nearestDist) {
            nearestDist = d;
            nearestCoords = fc;
            nearestName = f.properties.nom;
          }
        }

        window.TERLAB_NEAREST_FILIERE = { nom: nearestName, dist_km: Math.round(nearestDist * 10) / 10 };

        if (nearestCoords) {
          m.addSource('filiere-line-src', {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: [center, nearestCoords] }
            }
          });
          m.addLayer({
            id: 'filieres-line',
            type: 'line',
            source: 'filiere-line-src',
            paint: {
              'line-color': '#f59e0b',
              'line-width': 2,
              'line-dasharray': [4, 4]
            }
          });
        }

        // Popups on click
        m.on('click', 'filieres-points', (e) => {
          const props = e.features[0].properties;
          const accepts = typeof props.accepts === 'string' ? JSON.parse(props.accepts) : props.accepts;
          new mapboxgl.Popup({ maxWidth: '260px' })
            .setLngLat(e.lngLat)
            .setHTML(`<div style="font-size:12px"><strong>${props.nom}</strong><br/>Type : ${props.type}<br/>Accepte : ${(accepts || []).join(', ')}</div>`)
            .addTo(m);
        });
        m.on('mouseenter', 'filieres-points', () => m.getCanvas().style.cursor = 'pointer');
        m.on('mouseleave', 'filieres-points', () => m.getCanvas().style.cursor = '');
      }
    } catch (e) {
      console.warn('[Map] Filières layers:', e.message);
    }
  },

  _startGlobeRotation() {
    const m = this._map;
    let rotating = true;
    let bearing  = 10; // part sur Réunion

    const spin = () => {
      if (!rotating || !m) return;
      bearing -= 0.06;
      m.setBearing(bearing);
      requestAnimationFrame(spin);
    };
    requestAnimationFrame(spin);

    // Arrêter la rotation si l'utilisateur interagit
    m.once('mousedown', () => { rotating = false; });
    m.once('touchstart', () => { rotating = false; });

    // Exposer contrôle
    this._globeRotating = { get: () => rotating, set: v => { rotating = v; if (v) spin(); } };
  },

  _showKoppenPanel(zone) {
    const panel = document.getElementById('koppen-detail-panel');
    if (!panel) return;

    panel.innerHTML = `
      <div class="koppen-detail-head">
        <span class="koppen-badge" style="background:${zone.marker_color ?? '#3c78dc'}20;color:${zone.marker_color ?? '#3c78dc'};border:1px solid ${zone.marker_color ?? '#3c78dc'}40">
          ${zone.koppen ?? zone.etage_principal}
        </span>
        <h3 class="koppen-detail-title">${zone.nom}</h3>
        <p class="koppen-detail-pays">${zone.pays} · ${zone.continent}</p>
      </div>
      ${zone.note ? `<p class="koppen-detail-note">${zone.note}</p>` : ''}
      ${zone.architectures_ref?.length ? `
        <div class="koppen-refs">
          <div class="rp-head">Références architecturales</div>
          ${zone.architectures_ref.map(r => `<div class="koppen-ref-item">→ ${r}</div>`).join('')}
        </div>` : ''}
      ${zone.partenariat_ensa ? `
        <div class="koppen-partenariat">🤝 Partenariat ENSA potentiel ou actif</div>` : ''}
    `;
    panel.style.display = 'block';
  },

  // ── OUTILS ────────────────────────────────────────────────────
  activateTool(tool) {
    this._activeTool = tool;

    if (tool === 'profile') {
      this._enableProfileTool();
    } else if (tool === 'measure') {
      this._enableMeasureTool();
    }
  },

  toggle3D() {
    if (!this._map) return;
    const current = this._map.getPitch();
    this._map.easeTo({ pitch: current > 0 ? 0 : 60, duration: 800 });
  },

  // ── PROFIL ALTIMÉTRIQUE ───────────────────────────────────────
  _profileData: null, // Stocke les dernières données du profil

  _enableProfileTool() {
    if (!this._map) return;
    this._map.getCanvas().style.cursor = 'crosshair';

    this._profilePoints = [];

    // Préparer la source GeoJSON pour le tracé live sur la carte
    this._ensureProfileLayer();

    // Handler de mouvement — tracé live entre le 1er point et le curseur
    this._profileMoveHandler = (e) => {
      if (this._profilePoints.length !== 1) return;
      const liveLineData = {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [this._profilePoints[0], [e.lngLat.lng, e.lngLat.lat]] }
        }]
      };
      const src = this._map.getSource('profile-line');
      if (src) src.setData(liveLineData);
    };
    this._map.on('mousemove', this._profileMoveHandler);

    this._profileClickHandler = async (e) => {
      this._profilePoints.push([e.lngLat.lng, e.lngLat.lat]);

      // Afficher le marqueur du point cliqué
      this._addProfileMarker(e.lngLat, this._profilePoints.length);

      if (this._profilePoints.length === 1) {
        window.TerlabToast?.show('1er point posé — cliquez le 2e point pour finaliser la coupe', 'info', 4000);
      }

      if (this._profilePoints.length === 2) {
        this._map.getCanvas().style.cursor = '';
        this._map.off('click', this._profileClickHandler);
        this._map.off('mousemove', this._profileMoveHandler);

        // Tracer la ligne finale sur la carte
        const finalLineData = {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [this._profilePoints[0], this._profilePoints[1]] }
          }]
        };
        const src = this._map.getSource('profile-line');
        if (src) src.setData(finalLineData);

        await this._renderProfile(this._profilePoints[0], this._profilePoints[1]);
      }
    };

    this._map.on('click', this._profileClickHandler);
    window.TerlabToast?.show('Cliquez sur le 1er point de la coupe altimétrique', 'info', 5000);
  },

  // Assurer que la couche de tracé profil existe sur la carte
  _ensureProfileLayer() {
    if (!this._map) return;
    if (!this._map.getSource('profile-line')) {
      this._map.addSource('profile-line', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      this._map.addLayer({
        id: 'profile-line-layer',
        type: 'line',
        source: 'profile-line',
        paint: {
          'line-color': '#ff6b4a',
          'line-width': 3,
          'line-dasharray': [4, 2],
          'line-opacity': 0.9
        }
      });
    }
    // Supprimer les anciens marqueurs
    document.querySelectorAll('.profile-point-marker').forEach(m => m.remove());
  },

  // Ajouter un marqueur visuel pour un point du profil
  _addProfileMarker(lngLat, num) {
    const el = document.createElement('div');
    el.className = 'profile-point-marker';
    el.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#ff6b4a;border:2px solid #fff;box-shadow:0 0 6px rgba(255,107,74,.6);cursor:default;';
    el.title = `Point ${num} de la coupe`;
    new mapboxgl.Marker({ element: el }).setLngLat(lngLat).addTo(this._map);
  },

  async _renderProfile(from, to) {
    if (!this._map || !this._map.queryTerrainElevation) return;

    const steps = 50;
    const line  = turf.lineString([from, to]);
    const len   = turf.length(line, { units: 'kilometers' });
    const pts   = Array.from({ length: steps }, (_, i) => {
      const pt = turf.along(line, (i / (steps - 1)) * len, { units: 'kilometers' });
      return pt.geometry.coordinates;
    });

    const alts = pts.map(([lng, lat]) => {
      const elev = this._map.queryTerrainElevation([lng, lat]);
      return elev ?? 0;
    });

    const distancesM = alts.map((_, i) => Math.round((i / (steps - 1)) * len * 1000));
    const labels     = distancesM.map(d => `${d}m`);

    // Stocker les données du profil pour sauvegarde et export
    this._profileData = {
      from, to,
      length_m:   Math.round(len * 1000),
      altitudes:  alts.map(a => Math.round(a * 10) / 10),
      distances:  distancesM,
      alt_min:    Math.round(Math.min(...alts)),
      alt_max:    Math.round(Math.max(...alts)),
      denivele:   Math.round(Math.max(...alts) - Math.min(...alts)),
      pente_moy:  Math.round((Math.max(...alts) - Math.min(...alts)) / (len * 1000) * 100 * 10) / 10,
      timestamp:  new Date().toISOString()
    };

    // Injecter dans le canvas Chart.js de la phase
    const canvas = document.getElementById('profile-chart');
    if (!canvas) return;

    if (this._profileChart) this._profileChart.destroy();

    this._profileChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Altitude NGR (approx.)',
          data:  alts,
          fill:  true,
          backgroundColor: 'rgba(154,120,32,0.1)',
          borderColor:     '#E8811A',
          borderWidth:     1.5,
          pointRadius:     0,
          tension:         0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#6b5c3e', font: { size: 9 }, maxTicksLimit: 6 } },
          y: {
            ticks: { color: '#6b5c3e', font: { size: 9 }, callback: v => parseFloat(v.toFixed(2)) + 'm' },
            grid: { color: 'rgba(154,120,32,0.1)' }
          }
        }
      }
    });

    // Emettre l'événement pour la phase + bouton validation
    window.dispatchEvent(new CustomEvent('terlab:profile-drawn', { detail: this._profileData }));
  },

  // Récupérer les données du dernier profil (pour sauvegarde session)
  getProfileData() {
    return this._profileData;
  },

  // Afficher le contour de la parcelle Phase 0 sur la carte courante
  showParcelleContour(geojson) {
    if (!this._map || !geojson) return;
    const srcId = 'parcelle-selected';
    const data  = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geojson }] };

    if (this._map.getSource(srcId)) {
      this._map.getSource(srcId).setData(data);
    } else {
      this._map.addSource(srcId, { type: 'geojson', data });
      this._map.addLayer({
        id: 'parcelle-fill',
        type: 'fill',
        source: srcId,
        paint: { 'fill-color': '#C1652B', 'fill-opacity': 0.08 }
      });
      this._map.addLayer({
        id: 'parcelle-outline',
        type: 'line',
        source: srcId,
        paint: { 'line-color': '#C1652B', 'line-width': 2.5, 'line-opacity': 0.85 }
      });
    }
  },

  // ── MESURE DISTANCE ───────────────────────────────────────────
  _enableMeasureTool() {
    if (!this._map) return;

    if (window.MapboxDraw) {
      if (this._draw) { this._draw.deleteAll(); } else {
        this._draw = new MapboxDraw({
          displayControlsDefault: false,
          controls: { line_string: true, trash: true },
          styles: [
            { id: 'gl-draw-line', type: 'line', filter: ['==', '$type', 'LineString'],
              paint: { 'line-color': '#E8811A', 'line-width': 2 } }
          ]
        });
        this._map.addControl(this._draw);
      }
      this._draw.changeMode('draw_line_string');

      this._map.on('draw.update', e => this._showMeasureResult(e));
      this._map.on('draw.create', e => this._showMeasureResult(e));
    }
  },

  _showMeasureResult(e) {
    const data = this._draw?.getAll();
    if (!data?.features?.length) return;
    const line = data.features[0];
    const dist = turf.length(line, { units: 'kilometers' });
    window.TerlabToast?.show(`Distance : ${(dist * 1000).toFixed(0)} m`, 'info', 4000);
  },

  // ── COUPES A/B — LIGNES DE SECTION SUR LA CARTE ──────────────
  _sectionMarkers: [],

  drawSectionLines(axes) {
    if (!this._map || !axes) return;
    const m = this._map;

    const features = [];
    const labelFeatures = [];

    for (const id of ['A', 'B']) {
      const axis = axes[id];
      if (!axis) continue;

      features.push({
        type: 'Feature',
        properties: { section: id },
        geometry: { type: 'LineString', coordinates: [axis.start, axis.end] },
      });

      // Label at both ends
      for (const [pos, coords] of [['start', axis.start], ['end', axis.end]]) {
        labelFeatures.push({
          type: 'Feature',
          properties: { label: `${id}`, section: id },
          geometry: { type: 'Point', coordinates: coords },
        });
      }
    }

    const lineData = { type: 'FeatureCollection', features };
    const labelData = { type: 'FeatureCollection', features: labelFeatures };

    // Section lines
    if (m.getSource('section-lines')) {
      m.getSource('section-lines').setData(lineData);
    } else {
      m.addSource('section-lines', { type: 'geojson', data: lineData });

      m.addLayer({
        id: 'section-lines-A',
        type: 'line',
        source: 'section-lines',
        filter: ['==', ['get', 'section'], 'A'],
        paint: {
          'line-color': '#E8811A',
          'line-width': 2.5,
          'line-dasharray': [6, 3],
          'line-opacity': 0.85,
        },
      });

      m.addLayer({
        id: 'section-lines-B',
        type: 'line',
        source: 'section-lines',
        filter: ['==', ['get', 'section'], 'B'],
        paint: {
          'line-color': '#4A90D9',
          'line-width': 2.5,
          'line-dasharray': [6, 3],
          'line-opacity': 0.85,
        },
      });
    }

    // Section labels at endpoints
    if (m.getSource('section-labels')) {
      m.getSource('section-labels').setData(labelData);
    } else {
      m.addSource('section-labels', { type: 'geojson', data: labelData });

      m.addLayer({
        id: 'section-labels-layer',
        type: 'symbol',
        source: 'section-labels',
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 14,
          'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
          'text-allow-overlap': true,
          'text-offset': [0, -1],
        },
        paint: {
          'text-color': ['match', ['get', 'section'], 'A', '#E8811A', 'B', '#4A90D9', '#fff'],
          'text-halo-color': 'rgba(0,0,0,0.8)',
          'text-halo-width': 1.5,
        },
      });
    }

    // Remove previous endpoint markers
    this._sectionMarkers.forEach(mk => mk.remove());
    this._sectionMarkers = [];

    // Add circle markers at endpoints
    for (const id of ['A', 'B']) {
      const axis = axes[id];
      if (!axis) continue;
      const color = id === 'A' ? '#E8811A' : '#4A90D9';
      for (const coords of [axis.start, axis.end]) {
        const el = document.createElement('div');
        el.className = 'section-endpoint-marker';
        el.style.cssText = `width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 6px ${color}80;cursor:default;`;
        el.title = `Coupe ${id}`;
        const mk = new mapboxgl.Marker({ element: el }).setLngLat(coords).addTo(m);
        this._sectionMarkers.push(mk);
      }
    }
  },

  highlightSectionLine(sectionId) {
    if (!this._map) return;
    // Brighten the selected section, dim the other
    for (const id of ['A', 'B']) {
      const layerId = `section-lines-${id}`;
      if (!this._map.getLayer(layerId)) continue;
      this._map.setPaintProperty(layerId, 'line-opacity', id === sectionId ? 1 : 0.35);
      this._map.setPaintProperty(layerId, 'line-width', id === sectionId ? 3.5 : 1.5);
    }
  },

  resetSectionHighlight() {
    if (!this._map) return;
    for (const id of ['A', 'B']) {
      const layerId = `section-lines-${id}`;
      if (!this._map.getLayer(layerId)) continue;
      this._map.setPaintProperty(layerId, 'line-opacity', 0.85);
      this._map.setPaintProperty(layerId, 'line-width', 2.5);
    }
  },

  clearSectionLines() {
    if (!this._map) return;
    this._sectionMarkers.forEach(mk => mk.remove());
    this._sectionMarkers = [];
    const emptyFC = { type: 'FeatureCollection', features: [] };
    if (this._map.getSource('section-lines')) this._map.getSource('section-lines').setData(emptyFC);
    if (this._map.getSource('section-labels')) this._map.getSource('section-labels').setData(emptyFC);
  },

  // ── RECHERCHE PARCELLE (API IGN WFS) ─────────────────────────
  _WFS_BASE: 'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature'
    + '&TYPENAMES=CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle'
    + '&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326',

  async searchParcelleAt(lng, lat) {
    const bbox = `${lng-0.0005},${lat-0.0005},${lng+0.0005},${lat+0.0005}`;
    const url  = `${this._WFS_BASE}&BBOX=${bbox},EPSG:4326`;

    try {
      const data = await resilientJSON(url, { timeoutMs: 10000, retries: 2 });
      if (!data?.features?.length) {
        window.TerlabToast?.show('Aucune parcelle trouvée à cet emplacement', 'warning');
        return null;
      }

      // Trouver la parcelle contenant le point
      const point   = turf.point([lng, lat]);
      const feature = data.features.find(f => {
        try { return turf.booleanPointInPolygon(point, f); }
        catch { return false; }
      }) ?? data.features[0];

      // Toujours sauvegarder section/numéro cadastral en session
      // (même hors phase 0 / hors mode cadastre)
      this._persistCadastralInfo(feature, lng, lat);

      // En multi-sélection, ne PAS highlight ni émettre parcelle-found
      // (le click handler dispatch terlab:parcelle-click, ParcelSelector gère le reste)
      if (window.ParcelSelector?.isActive?.()) {
        return feature;
      }

      this._highlightParcelle(feature);
      window.dispatchEvent(new CustomEvent('terlab:parcelle-found', { detail: feature }));

      return feature;
    } catch (e) {
      console.warn('[Map] Recherche parcelle WFS:', e.message);
      window.TerlabToast?.show('Erreur IGN WFS — vérifiez la connexion', 'error');
      return null;
    }
  },

  // ── RECHERCHE PARCELLE PAR RÉFÉRENCE (section + numéro) ─────
  async searchParcelleByRef(commune, section, numero) {
    const cql = `commune='${commune}' AND section='${section}' AND numero='${numero}'`;
    const url  = `${this._WFS_BASE}&CQL_FILTER=${encodeURIComponent(cql)}&COUNT=1`;

    try {
      const data = await resilientJSON(url, { timeoutMs: 10000, retries: 2 });
      if (!data?.features?.length) {
        window.TerlabToast?.show(`Parcelle ${section} ${numero} introuvable (commune ${commune})`, 'warning');
        return null;
      }

      const feature = data.features[0];
      this._persistCadastralInfo(feature, null, null);
      this._highlightParcelle(feature);
      window.dispatchEvent(new CustomEvent('terlab:parcelle-found', { detail: feature }));

      return feature;
    } catch (e) {
      console.warn('[Map] Recherche parcelle par ref:', e.message);
      window.TerlabToast?.show('Erreur recherche cadastrale — vérifiez la connexion', 'error');
      return null;
    }
  },

  _highlightParcelle(feature) {
    if (!this._map) return;
    const src = this._map.getSource('parcelle-selected');
    if (src) {
      src.setData({ type: 'FeatureCollection', features: [feature] });
    }

    // Centrer sur la parcelle
    const bbox = turf.bbox(feature);
    this._map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 60, duration: 800 });
  },

  /** Sauvegarde section/numéro cadastral en session quelle que soit la phase active */
  _persistCadastralInfo(feature, lng, lat) {
    const SM = window.SessionManager;
    if (!SM?.saveTerrain) return;
    const p = feature.properties ?? {};
    const commune    = p.nom_com ?? p.commune_abs ?? p.commune ?? '';
    const insee      = p.commune ?? '';
    const section    = p.section ?? '';
    const numero     = p.numero ?? '';
    const contenance = p.contenance ? parseFloat(p.contenance) : undefined;

    // Centroïde si pas de coords fournies
    let cLat = lat, cLng = lng;
    if ((cLat == null || cLng == null) && feature.geometry) {
      try {
        const c = turf.centroid(feature);
        [cLng, cLat] = c.geometry.coordinates;
      } catch { /* keep null */ }
    }

    // Altitude approx depuis DEM Mapbox
    let altitude;
    if (this._map && cLng != null && cLat != null) {
      const elev = this._map.queryTerrainElevation?.([cLng, cLat]);
      if (elev != null) altitude = Math.round(elev);
    }

    const update = {
      commune, code_insee: insee, section, parcelle: numero,
      lat: cLat, lng: cLng,
      parcelle_geojson: feature.geometry,
    };
    if (contenance)  update.contenance_m2 = contenance;
    if (altitude != null) update.altitude_ngr = altitude;

    SM.saveTerrain(update);
    console.log(`[Map] Cadastre persisté : ${section} ${numero} — ${commune} (${insee})`);
  },

  // ── SIMULATION INONDATION (Phase 3) — Bathtub DEM ────────────
  // Modèle « bathtub » : tout point du DEM < niveau d'eau absolu → inondé
  // waterLevelNGR = cote de référence NGR + hauteur simulée
  // Le DEM Mapbox ≈ WGS84 → NGR ≈ +0.48m (Réunion)
  _floodRAF: null,
  _floodCache: null,       // { grid, bounds, step } — réutilisé si vue stable

  updateFloodSimulation(waterLevelNGR) {
    if (this._floodRAF) cancelAnimationFrame(this._floodRAF);
    this._floodRAF = requestAnimationFrame(() => this._computeFlood(waterLevelNGR));
  },

  _computeFlood(waterLevelNGR) {
    const m = this._map;
    if (!m) return;
    const src = m.getSource('flood-sim');
    if (!src) return;

    if (!waterLevelNGR || waterLevelNGR <= 0) {
      src.setData({ type: 'FeatureCollection', features: [] });
      this._floodCache = null;
      return;
    }

    const terrain = window.SessionManager?.getTerrain?.() ?? {};
    if (!terrain.lat || !terrain.lng) return;

    const centerLng = parseFloat(terrain.lng);
    const centerLat = parseFloat(terrain.lat);
    const NGR_OFFSET = 0.48; // WGS84 → NGR approx pour La Réunion

    // Grille d'échantillonnage : 2km × 2km, cellules de 40m
    const GRID   = 50;             // 50×50 = 2500 points
    const EXTENT = 1.0;            // 1 km de chaque côté du centre
    const CELL   = (EXTENT * 2) / GRID; // taille cellule en km

    // Conversion km → degrés (latitude Réunion ≈ -21°)
    const cosLat = Math.cos(centerLat * Math.PI / 180);
    const KM_PER_DEG_LAT = 111.32;
    const KM_PER_DEG_LNG = 111.32 * cosLat;

    const halfCellLng = (CELL / 2) / KM_PER_DEG_LNG;
    const halfCellLat = (CELL / 2) / KM_PER_DEG_LAT;

    // Échantillonner le DEM
    const features = [];
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const dxKm = (i - GRID / 2 + 0.5) * CELL;
        const dyKm = (j - GRID / 2 + 0.5) * CELL;
        const lng  = centerLng + dxKm / KM_PER_DEG_LNG;
        const lat  = centerLat + dyKm / KM_PER_DEG_LAT;

        // queryTerrainElevation retourne l'altitude WGS84 du DEM chargé
        const elevWGS = m.queryTerrainElevation({ lng, lat }, { exaggerated: false });
        if (elevWGS == null) continue;

        const elevNGR = elevWGS + NGR_OFFSET;

        if (elevNGR < waterLevelNGR) {
          // Cellule inondée → petit carré GeoJSON
          features.push({
            type: 'Feature',
            properties: { depth: +(waterLevelNGR - elevNGR).toFixed(2) },
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [lng - halfCellLng, lat - halfCellLat],
                [lng + halfCellLng, lat - halfCellLat],
                [lng + halfCellLng, lat + halfCellLat],
                [lng - halfCellLng, lat + halfCellLat],
                [lng - halfCellLng, lat - halfCellLat]
              ]]
            }
          });
        }
      }
    }

    src.setData({ type: 'FeatureCollection', features });
  },

  // ── GABARIT 3D (Phase 7) ──────────────────────────────────────
  updateGabarit({ geometry, height }) {
    if (!this._map) return;
    const src = this._map.getSource('gabarit-3d');
    if (!src || !geometry) return;

    const feature = { type: 'Feature', properties: { height }, geometry };
    src.setData({ type: 'FeatureCollection', features: [feature] });
  },

  // ── FLY TO ────────────────────────────────────────────────────
  flyTo(lng, lat, zoom = 16) {
    if (!this._map) return;
    this._map.flyTo({ center: [lng, lat], zoom, duration: 1200 });
  },

  flyOverRavine(ravineCoords) {
    if (!this._map || !ravineCoords?.length) return;
    const center = ravineCoords[Math.floor(ravineCoords.length / 2)];
    this._map.flyTo({
      center,
      zoom:    15,
      pitch:   65,
      bearing: 0,
      duration: 2000
    });

    // Rotation progressive
    let bearing = 0;
    const spin = setInterval(() => {
      bearing += 2;
      if (bearing >= 360) { clearInterval(spin); return; }
      this._map?.setBearing(bearing);
    }, 16);

    setTimeout(() => clearInterval(spin), 4000);
  },

  // ── CAPTURE CARTE ─────────────────────────────────────────────
  captureAsDataURL() {
    if (!this._map) return null;
    return this._map.getCanvas().toDataURL('image/png');
  },

  // ── STUB BANNER ───────────────────────────────────────────────
  _showStubBanner(msg) {
    const zone = document.getElementById('map-stub-banner');
    if (zone) { zone.textContent = `⚠️ ${msg}`; zone.style.display = 'flex'; }
  },

  // ── NO MAP FALLBACK ───────────────────────────────────────────
  _renderNoMap(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.style.cssText = 'display:flex;align-items:center;justify-content:center;background:var(--bg, #ede8dc);';
    el.innerHTML = `
      <div style="text-align:center;opacity:.4">
        <div style="font-size:32px;margin-bottom:12px">🗺</div>
        <div style="font-family:monospace;font-size:11px;color:var(--muted, #6b5c3e)">
          Carte désactivée<br/>Token Mapbox requis
        </div>
      </div>`;
  },

  // ── LIDAR : Afficher le nuage de points sur la carte ─────────
  // points = [[lng, lat, alt, r, g, b, classification], ...]
  // mode = 'classification' (couleurs par type) ou 'rgb' (couleurs ortho)
  showLidarPoints(points, mode = 'classification') {
    if (!this._map || !points?.length) return;
    const m = this._map;

    // Couleurs par classe LiDAR (ASPRS)
    const CLASS_COLORS = {
      2: '#b8860b',  // Sol — brun doré
      3: '#90ee90',  // Végétation basse — vert clair
      4: '#32cd32',  // Végétation moyenne — vert
      5: '#006400',  // Végétation haute — vert foncé
      6: '#ff4444',  // Bâtiments — rouge
      9: '#4488ff',  // Eau — bleu
    };
    const DEFAULT_COLOR = '#888888';

    // Sous-échantillonner si trop de points (Mapbox GeoJSON performant jusqu'à ~50k features)
    const MAX_RENDER = 50000;
    let renderPts = points;
    if (points.length > MAX_RENDER) {
      const step = Math.ceil(points.length / MAX_RENDER);
      renderPts = points.filter((_, i) => i % step === 0);
    }

    // Construire le GeoJSON
    // Pré-calcul des bornes pour les modes altitude et hauteur
    let altMin = Infinity, altMax = -Infinity, groundMin = Infinity;
    if (mode === 'altitude' || mode === 'height') {
      for (const p of renderPts) {
        if (p[2] < altMin) altMin = p[2];
        if (p[2] > altMax) altMax = p[2];
        if ((p.length >= 7 ? p[6] : 2) === 2 && p[2] < groundMin) groundMin = p[2];
      }
      if (groundMin === Infinity) groundMin = altMin;
    }
    const altRange = Math.max(altMax - altMin, 0.1);
    const heightMax = Math.max(altMax - groundMin, 0.1);

    const features = renderPts.map(p => {
      const cls = p.length >= 7 ? p[6] : 2;
      let color;
      if (mode === 'rgb' && p.length >= 6 && (p[3] || p[4] || p[5])) {
        color = `rgb(${p[3]},${p[4]},${p[5]})`;
      } else if (mode === 'altitude') {
        // Divergent bleu → blanc → rouge
        const t = (p[2] - altMin) / altRange;
        color = this._lerpColorRamp(t, [
          [0, '#2166ac'], [0.25, '#67a9cf'], [0.5, '#f7f7f7'],
          [0.75, '#ef8a62'], [1, '#b2182b']
        ]);
      } else if (mode === 'height') {
        // Séquentiel jaune → vert → vert foncé (hauteur / sol)
        const h = Math.max(0, p[2] - groundMin);
        const t = Math.min(1, h / heightMax);
        color = this._lerpColorRamp(t, [
          [0, '#f7fcb9'], [0.33, '#addd8e'], [0.66, '#31a354'], [1, '#003418']
        ]);
      } else {
        color = CLASS_COLORS[cls] ?? DEFAULT_COLOR;
      }

      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p[0], p[1]] },
        properties: { alt: p[2], cls, color }
      };
    });

    const data = { type: 'FeatureCollection', features };
    const srcId = 'lidar-points';

    if (m.getSource(srcId)) {
      m.getSource(srcId).setData(data);
    } else {
      m.addSource(srcId, { type: 'geojson', data });
      m.addLayer({
        id: 'lidar-points-layer',
        type: 'circle',
        source: srcId,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 1.5, 17, 3, 19, 5],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.85,
          'circle-stroke-width': 0,
        }
      });
    }

    // Popup au survol
    if (!this._lidarPopupHandler) {
      const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'lidar-popup' });
      this._lidarPopupHandler = (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const cls = f.properties.cls;
        const labels = { 2: 'Sol', 3: 'Vég. basse', 4: 'Vég. moyenne', 5: 'Vég. haute', 6: 'Bâtiment', 9: 'Eau' };
        popup.setLngLat(e.lngLat)
          .setHTML(`<span style="font-family:monospace;font-size:10px">${labels[cls] ?? `Classe ${cls}`} · ${f.properties.alt?.toFixed(1) ?? '—'}m</span>`)
          .addTo(m);
      };
      m.on('mouseenter', 'lidar-points-layer', this._lidarPopupHandler);
      m.on('mouseleave', 'lidar-points-layer', () => popup.remove());
      m.on('mouseenter', 'lidar-points-layer', () => { m.getCanvas().style.cursor = 'crosshair'; });
      m.on('mouseleave', 'lidar-points-layer', () => { m.getCanvas().style.cursor = ''; });
    }
  },

  // Changer le mode d'affichage des points LiDAR (classification / rgb / altitude / height)
  async setLidarMode(mode) {
    if (!this._map) return;
    const src = this._map.getSource('lidar-points');
    if (!src) return;
    if (!this._lidarRawPoints) return;

    // Mode 'rgb' (Ortho) : echantillonner l'orthophoto IGN si pas encore fait
    if (mode === 'rgb' && !this._lidarRgbSampled) {
      window.TerlabToast?.show('Echantillonnage ortho IGN en cours...', 'info', 2500);
      try {
        await this._sampleOrthoColors(this._lidarRawPoints);
        this._lidarRgbSampled = true;
      } catch (err) {
        console.warn('[MapViewer] Ortho sampling echoue:', err.message);
        window.TerlabToast?.show(`Ortho indisponible : ${err.message}`, 'warning');
      }
    }

    this.showLidarPoints(this._lidarRawPoints, mode);
  },

  // Echantillonne l'orthophoto IGN et ecrit les RGB dans chaque point (p[3], p[4], p[5])
  // Points = [[lng, lat, alt, r, g, b, classification], ...]
  async _sampleOrthoColors(points) {
    if (!points?.length) return;

    // Bbox englobant + petite marge
    let lngMin = Infinity, lngMax = -Infinity, latMin = Infinity, latMax = -Infinity;
    for (const p of points) {
      if (p[0] < lngMin) lngMin = p[0];
      if (p[0] > lngMax) lngMax = p[0];
      if (p[1] < latMin) latMin = p[1];
      if (p[1] > latMax) latMax = p[1];
    }
    const marginLng = (lngMax - lngMin) * 0.02 || 0.0005;
    const marginLat = (latMax - latMin) * 0.02 || 0.0005;
    lngMin -= marginLng; lngMax += marginLng;
    latMin -= marginLat; latMax += marginLat;

    // Taille raster adaptee a la densite des points (resolution ~ 1 pixel / 2m en moyenne a La Reunion)
    const W = 1536, H = 1536;
    const params = new URLSearchParams({
      SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap',
      LAYERS: 'ORTHOIMAGERY.ORTHOPHOTOS', STYLES: '',
      CRS: 'EPSG:4326',
      BBOX: `${latMin},${lngMin},${latMax},${lngMax}`,
      WIDTH: String(W), HEIGHT: String(H),
      FORMAT: 'image/jpeg',
    });
    const url = `https://data.geopf.fr/wms-r?${params}`;

    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Fetch ortho WMS echec'));
      i.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    let imgData;
    try {
      imgData = ctx.getImageData(0, 0, W, H).data;
    } catch (err) {
      throw new Error('Canvas taint (CORS) — verifier le token IGN');
    }

    const spanLng = lngMax - lngMin || 1e-9;
    const spanLat = latMax - latMin || 1e-9;

    // Format attendu : [lng, lat, z, r, g, b, cls] — on ecrase r,g,b
    for (const p of points) {
      const u = (p[0] - lngMin) / spanLng;
      const v = 1 - (p[1] - latMin) / spanLat;
      const x = Math.max(0, Math.min(W - 1, Math.round(u * (W - 1))));
      const y = Math.max(0, Math.min(H - 1, Math.round(v * (H - 1))));
      const idx = (y * W + x) * 4;
      p[3] = imgData[idx];
      p[4] = imgData[idx + 1];
      p[5] = imgData[idx + 2];
    }
    console.info(`[MapViewer] Ortho echantillonnee sur ${points.length} points (${W}x${H})`);
  },

  clearLidarRgbCache() {
    this._lidarRgbSampled = false;
  },

  setLidarRawPoints(points) {
    this._lidarRawPoints = points;
    this._lidarRgbSampled = false; // nouveaux points → re-echantillonner l'ortho au prochain mode 'rgb'
  },

  // ── Injecter un mesh TIN terrain dans le viewer 3D ──────────────
  addTerrainMesh(mesh) {
    if (window.Terrain3D?.addTerrainTIN) {
      window.Terrain3D.addTerrainTIN(mesh);
    } else {
      // Stocker pour injection differee quand Terrain3D sera initialise
      this._pendingTerrainMesh = mesh;
      console.log('[MapViewer] TIN mesh stocke (Terrain3D non encore init)');
    }
  },

  setLidarPointSize(size) {
    if (!this._map?.getLayer('lidar-points-layer')) return;
    const s = parseFloat(size) || 3;
    this._map.setPaintProperty('lidar-points-layer', 'circle-radius',
      ['interpolate', ['linear'], ['zoom'], 14, s * 0.5, 17, s, 19, s * 1.8]
    );
  },

  /** Interpolation sur une rampe de couleurs [[t, hex], ...] */
  _lerpColorRamp(t, ramp) {
    t = Math.max(0, Math.min(1, t));
    let i = 0;
    while (i < ramp.length - 1 && ramp[i + 1][0] < t) i++;
    if (i >= ramp.length - 1) return ramp[ramp.length - 1][1];
    const [t0, c0] = ramp[i], [t1, c1] = ramp[i + 1];
    const f = (t - t0) / (t1 - t0 || 1);
    const r0 = parseInt(c0.slice(1, 3), 16), g0 = parseInt(c0.slice(3, 5), 16), b0 = parseInt(c0.slice(5, 7), 16);
    const r1 = parseInt(c1.slice(1, 3), 16), g1 = parseInt(c1.slice(3, 5), 16), b1 = parseInt(c1.slice(5, 7), 16);
    const r = Math.round(r0 + (r1 - r0) * f), g = Math.round(g0 + (g1 - g0) * f), b = Math.round(b0 + (b1 - b0) * f);
    return `rgb(${r},${g},${b})`;
  },

  toggleLidarLayer(visible) {
    if (!this._map) return;
    try {
      this._map.setLayoutProperty('lidar-points-layer', 'visibility', visible ? 'visible' : 'none');
    } catch {}
  },

  // Supprimer le layer LiDAR
  clearLidarPoints() {
    if (!this._map) return;
    const src = this._map.getSource('lidar-points');
    if (src) src.setData({ type: 'FeatureCollection', features: [] });
    this._lidarRawPoints = null;
  },

  // ── TOGGLE COUCHES GEOPORTAIL ─────────────────────────────────
  toggleCadastre(visible, opacity = 0.7) {
    if (!this._map?.getLayer('cadastre')) return;
    this._map.setLayoutProperty('cadastre', 'visibility', visible ? 'visible' : 'none');
    if (opacity != null) this._map.setPaintProperty('cadastre', 'raster-opacity', opacity);
  },

  togglePlanIGN(visible, opacity = 0.5) {
    if (!this._map?.getLayer('plan-ign')) return;
    this._map.setLayoutProperty('plan-ign', 'visibility', visible ? 'visible' : 'none');
    if (opacity != null) this._map.setPaintProperty('plan-ign', 'raster-opacity', opacity);
  },

  // ══════════════════════════════════════════════════════════════
  // COUCHES GEOJSON CUSTOM (GPU / import / dessin projet)
  // ══════════════════════════════════════════════════════════════

  addCustomLayer(layerDef) {
    const m = this._map;
    if (!m) return;
    const sid = `custom-${layerDef.id}`;
    if (m.getSource(sid)) return;

    m.addSource(sid, { type: 'geojson', data: layerDef.geojson });

    const types = this._detectGeomTypes(layerDef.geojson);

    if (types.has('Polygon') || types.has('MultiPolygon')) {
      m.addLayer({ id: `${sid}-fill`, type: 'fill', source: sid,
        filter: ['any', ['==', '$type', 'Polygon']],
        paint: { 'fill-color': layerDef.color, 'fill-opacity': layerDef.fillOpacity ?? 0.2 } });
      m.addLayer({ id: `${sid}-outline`, type: 'line', source: sid,
        filter: ['any', ['==', '$type', 'Polygon']],
        paint: { 'line-color': layerDef.color, 'line-width': layerDef.lineWidth ?? 2, 'line-opacity': layerDef.opacity ?? 0.8 } });
    }
    if (types.has('LineString') || types.has('MultiLineString')) {
      if (!m.getLayer(`${sid}-outline`)) {
        m.addLayer({ id: `${sid}-stroke`, type: 'line', source: sid,
          filter: ['==', '$type', 'LineString'],
          paint: { 'line-color': layerDef.color, 'line-width': layerDef.lineWidth ?? 2, 'line-opacity': layerDef.opacity ?? 0.8 } });
      }
    }
    if (types.has('Point') || types.has('MultiPoint')) {
      m.addLayer({ id: `${sid}-circle`, type: 'circle', source: sid,
        filter: ['==', '$type', 'Point'],
        paint: { 'circle-color': layerDef.color, 'circle-radius': 5, 'circle-opacity': layerDef.opacity ?? 0.8, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
    }
  },

  removeCustomLayer(id) {
    const m = this._map;
    if (!m) return;
    const sid = `custom-${id}`;
    ['fill', 'outline', 'stroke', 'circle'].forEach(suffix => {
      if (m.getLayer(`${sid}-${suffix}`)) m.removeLayer(`${sid}-${suffix}`);
    });
    if (m.getSource(sid)) m.removeSource(sid);
  },

  updateCustomLayerData(id, geojson) {
    const m = this._map;
    if (!m) return;
    const src = m.getSource(`custom-${id}`);
    if (src) src.setData(geojson);
  },

  updateCustomLayerStyle(id, style) {
    const m = this._map;
    if (!m) return;
    const sid = `custom-${id}`;
    if (style.color) {
      if (m.getLayer(`${sid}-fill`))    m.setPaintProperty(`${sid}-fill`, 'fill-color', style.color);
      if (m.getLayer(`${sid}-outline`)) m.setPaintProperty(`${sid}-outline`, 'line-color', style.color);
      if (m.getLayer(`${sid}-stroke`))  m.setPaintProperty(`${sid}-stroke`, 'line-color', style.color);
      if (m.getLayer(`${sid}-circle`))  m.setPaintProperty(`${sid}-circle`, 'circle-color', style.color);
    }
    if (style.fillOpacity != null && m.getLayer(`${sid}-fill`)) {
      m.setPaintProperty(`${sid}-fill`, 'fill-opacity', style.fillOpacity);
    }
    if (style.opacity != null) {
      if (m.getLayer(`${sid}-outline`)) m.setPaintProperty(`${sid}-outline`, 'line-opacity', style.opacity);
      if (m.getLayer(`${sid}-stroke`))  m.setPaintProperty(`${sid}-stroke`, 'line-opacity', style.opacity);
      if (m.getLayer(`${sid}-circle`))  m.setPaintProperty(`${sid}-circle`, 'circle-opacity', style.opacity);
    }
    if (style.lineWidth != null) {
      if (m.getLayer(`${sid}-outline`)) m.setPaintProperty(`${sid}-outline`, 'line-width', style.lineWidth);
      if (m.getLayer(`${sid}-stroke`))  m.setPaintProperty(`${sid}-stroke`, 'line-width', style.lineWidth);
    }
  },

  toggleCustomLayerVisibility(id, visible) {
    const m = this._map;
    if (!m) return;
    const sid = `custom-${id}`;
    const v = visible ? 'visible' : 'none';
    ['fill', 'outline', 'stroke', 'circle'].forEach(suffix => {
      if (m.getLayer(`${sid}-${suffix}`)) m.setLayoutProperty(`${sid}-${suffix}`, 'visibility', v);
    });
  },

  fitToCustomLayer(bbox) {
    if (!this._map || !bbox) return;
    this._map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 60, duration: 800 });
  },

  _detectGeomTypes(fc) {
    const types = new Set();
    for (const f of (fc?.features ?? [])) {
      const t = f.geometry?.type;
      if (t) types.add(t);
    }
    return types;
  },

  // ── DESSIN PROJET (étend MapboxDraw existant) ─────────────────
  enableProjectDraw(mode = 'draw_polygon') {
    if (!this._map || !window.MapboxDraw) return;

    if (!this._draw) {
      this._draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: { point: true, line_string: true, polygon: true, trash: true },
        styles: [
          { id: 'gl-draw-polygon-fill', type: 'fill', filter: ['==', '$type', 'Polygon'],
            paint: { 'fill-color': '#E8811A', 'fill-opacity': 0.15 } },
          { id: 'gl-draw-polygon-stroke', type: 'line', filter: ['==', '$type', 'Polygon'],
            paint: { 'line-color': '#E8811A', 'line-width': 2, 'line-dasharray': [2, 2] } },
          { id: 'gl-draw-line', type: 'line', filter: ['==', '$type', 'LineString'],
            paint: { 'line-color': '#E8811A', 'line-width': 2 } },
          { id: 'gl-draw-point', type: 'circle', filter: ['==', '$type', 'Point'],
            paint: { 'circle-color': '#E8811A', 'circle-radius': 6, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } },
        ]
      });
      this._map.addControl(this._draw);
    }

    this._draw.changeMode(mode);

    // Écouter les events de création
    this._map.off('draw.create', this._onDrawCreate);
    this._onDrawCreate = (e) => {
      const feature = e.features?.[0];
      if (feature) {
        window.dispatchEvent(new CustomEvent('terlab:feature-drawn', { detail: feature }));
        this._draw.deleteAll();
      }
    };
    this._map.on('draw.create', this._onDrawCreate);
  },

  disableProjectDraw() {
    if (this._draw) {
      this._draw.deleteAll();
      try { this._draw.changeMode('simple_select'); } catch {}
    }
    if (this._map && this._onDrawCreate) {
      this._map.off('draw.create', this._onDrawCreate);
    }
  },

  // ── TERRAIN LIBRE — dessin polygone + détection parcelles ─────
  activateTerrainLibre() {
    this.enableProjectDraw('draw_polygon');
    window.TerlabToast?.show('Dessinez un polygone fermé sur la carte (double-clic pour terminer)', 'info', 5000);

    // Remplacer le handler draw.create pour le mode terrain libre
    this._map.off('draw.create', this._onDrawCreate);
    this._onDrawCreate = async (e) => {
      const feature = e.features?.[0];
      if (!feature || feature.geometry?.type !== 'Polygon') return;
      this._draw.deleteAll();

      // Afficher le polygone dessiné
      this._highlightTerrainLibre(feature.geometry);

      // Détecter les parcelles cadastrales
      window.TerlabToast?.show('Détection des parcelles…', 'info', 3000);
      const result = await this.detectParcelsInPolygon(feature.geometry);

      window.dispatchEvent(new CustomEvent('terlab:terrain-libre-complete', {
        detail: { polygon: feature.geometry, parcels: result }
      }));
    };
    this._map.on('draw.create', this._onDrawCreate);
  },

  deactivateTerrainLibre() {
    this.disableProjectDraw();
    // Nettoyer les couches terrain-libre
    const m = this._map;
    if (!m) return;
    try { if (m.getLayer('terrain-libre-fill'))    m.removeLayer('terrain-libre-fill'); } catch {}
    try { if (m.getLayer('terrain-libre-outline'))  m.removeLayer('terrain-libre-outline'); } catch {}
    try { if (m.getLayer('terrain-libre-parcels-full'))    m.removeLayer('terrain-libre-parcels-full'); } catch {}
    try { if (m.getLayer('terrain-libre-parcels-partial')) m.removeLayer('terrain-libre-parcels-partial'); } catch {}
    try { if (m.getSource('terrain-libre'))         m.removeSource('terrain-libre'); } catch {}
    try { if (m.getSource('terrain-libre-parcels')) m.removeSource('terrain-libre-parcels'); } catch {}
  },

  _highlightTerrainLibre(geometry) {
    const m = this._map;
    if (!m) return;
    const data = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry }] };

    if (m.getSource('terrain-libre')) {
      m.getSource('terrain-libre').setData(data);
    } else {
      m.addSource('terrain-libre', { type: 'geojson', data });
      m.addLayer({ id: 'terrain-libre-fill', type: 'fill', source: 'terrain-libre',
        paint: { 'fill-color': '#00d4ff', 'fill-opacity': 0.12 } });
      m.addLayer({ id: 'terrain-libre-outline', type: 'line', source: 'terrain-libre',
        paint: { 'line-color': '#00d4ff', 'line-width': 2, 'line-dasharray': [4, 2] } });
    }
  },

  // ── DÉTECTION PARCELLES DANS UN POLYGONE (WFS INTERSECTS) ─────
  async detectParcelsInPolygon(polygon) {
    // Construire le WKT du polygone pour le filtre CQL
    const ring = polygon.coordinates[0];
    const wkt = 'POLYGON((' + ring.map(c => `${c[0]} ${c[1]}`).join(',') + '))';
    const cql = `INTERSECTS(geom,${wkt})`;

    const url = `${this._WFS_BASE}&CQL_FILTER=${encodeURIComponent(cql)}&COUNT=50`;

    try {
      const data = await resilientJSON(url, { timeoutMs: 15000, retries: 2 });
      if (!data?.features?.length) return { full: [], partial: [], all: [] };

      const drawnFeature = { type: 'Feature', geometry: polygon };
      const drawnArea = turf.area(drawnFeature);

      const full = [], partial = [];

      for (const f of data.features) {
        try {
          const parcelFeature = { type: 'Feature', geometry: f.geometry, properties: f.properties };
          const parcelArea = turf.area(parcelFeature);

          // Calculer l'intersection
          const inter = turf.intersect(drawnFeature, parcelFeature);
          if (!inter) { partial.push(this._toParcelInfo(f, 0)); continue; }

          const interArea = turf.area(inter);
          const coverage = parcelArea > 0 ? interArea / parcelArea : 0;

          const info = this._toParcelInfo(f, coverage);

          // > 90% couvert → entière, sinon partielle
          if (coverage > 0.9) full.push(info);
          else partial.push(info);
        } catch {
          partial.push(this._toParcelInfo(f, 0));
        }
      }

      // Afficher sur la carte
      this._showDetectedParcels(full, partial);

      return { full, partial, all: [...full, ...partial], drawnArea: Math.round(drawnArea) };

    } catch (e) {
      console.warn('[Map] detectParcelsInPolygon:', e.message);
      return { full: [], partial: [], all: [], error: e.message };
    }
  },

  _toParcelInfo(feature, coverage) {
    const p = feature.properties ?? {};
    return {
      commune:       p.commune ?? p.nom_com ?? '',
      commune_nom:   p.nom_com ?? '',
      section:       p.section ?? '',
      numero:        p.numero ?? '',
      reference:     `${p.commune ?? ''}${p.section ?? ''}${p.numero ?? ''}`,
      contenance_m2: p.contenance ? parseFloat(p.contenance) : 0,
      geometry:      feature.geometry,
      coverage:      Math.round(coverage * 100),   // % de la parcelle dans le polygone
    };
  },

  _showDetectedParcels(full, partial) {
    const m = this._map;
    if (!m) return;

    const features = [
      ...full.map(p => ({ type: 'Feature', geometry: p.geometry, properties: { type: 'full', ref: p.reference } })),
      ...partial.map(p => ({ type: 'Feature', geometry: p.geometry, properties: { type: 'partial', ref: p.reference } })),
    ];
    const fc = { type: 'FeatureCollection', features };

    if (m.getSource('terrain-libre-parcels')) {
      m.getSource('terrain-libre-parcels').setData(fc);
    } else {
      m.addSource('terrain-libre-parcels', { type: 'geojson', data: fc });
      m.addLayer({ id: 'terrain-libre-parcels-full', type: 'fill', source: 'terrain-libre-parcels',
        filter: ['==', ['get', 'type'], 'full'],
        paint: { 'fill-color': '#51cf66', 'fill-opacity': 0.25 } });
      m.addLayer({ id: 'terrain-libre-parcels-partial', type: 'fill', source: 'terrain-libre-parcels',
        filter: ['==', ['get', 'type'], 'partial'],
        paint: { 'fill-color': '#ffc53a', 'fill-opacity': 0.25 } });
    }
  },

  // ── ACCÈS MAP INSTANCE ────────────────────────────────────────
  getMap() { return this._map; }
};

export default MapViewer;
