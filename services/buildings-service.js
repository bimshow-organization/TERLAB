// TERLAB · services/buildings-service.js
// Chargement des bâtiments : BDTOPO IGN (primaire) + Overpass OSM (fallback)
// Utilisé pour afficher le contexte bâti autour du terrain
// + Bâtiments des projets démo (rendu enrichi)
// Aucune clé API requise
// ════════════════════════════════════════════════════════════════════

import resilientFetch, { resilientFetchFirst } from '../utils/resilient-fetch.js';
import { resilientJSON } from '../utils/resilient-fetch.js';

const BuildingsService = {

  // ─── Sources de données ──────────────────────────────────────────
  BDTOPO_WFS: 'https://data.geopf.fr/wfs/ows',
  BDTOPO_LAYER: 'BDTOPO_V3:batiment',

  OVERPASS_ENDPOINTS: [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'  // Miroir si principal down
  ],

  // ─── Types de bâtiments → couleur + hauteur par défaut ─────────
  BUILDING_STYLES: {
    house:          { color: '#c4b396', height: 5,  label: 'Maison individuelle' },
    residential:    { color: '#c4b396', height: 6,  label: 'Résidentiel' },
    apartments:     { color: '#b8a888', height: 12, label: 'Immeuble' },
    commercial:     { color: '#bfaf96', height: 8,  label: 'Commercial' },
    industrial:     { color: '#a89880', height: 7,  label: 'Industriel' },
    school:         { color: '#b0a490', height: 6,  label: 'Scolaire' },
    church:         { color: '#b5a898', height: 10, label: 'Église' },
    garage:         { color: '#c8bca8', height: 3,  label: 'Garage' },
    shed:           { color: '#ccc0a8', height: 2.5,label: 'Hangar' },
    yes:            { color: '#c4b396', height: 5,  label: 'Bâtiment' },
    _default:       { color: '#c4b396', height: 4,  label: 'Bâtiment' }
  },

  // ─── CHARGER LES BÂTIMENTS (BDTOPO → Overpass → procédural) ─────
  async fetchBuildings(lat, lng, radiusMeters = 250) {
    // 1. BDTOPO IGN (meilleure couverture DOM, données officielles)
    try {
      const bdtopo = await this._fetchBDTOPO(lat, lng, radiusMeters);
      if (bdtopo?.features?.length) {
        console.info(`[Buildings] BDTOPO: ${bdtopo.features.length} bâtiments`);
        return bdtopo;
      }
    } catch (e) {
      console.warn('[Buildings] BDTOPO failed:', e.message);
    }

    // 2. Overpass OSM (fallback communautaire)
    try {
      const osm = await this._fetchOverpass(lat, lng, radiusMeters);
      if (osm?.features?.length) {
        console.info(`[Buildings] Overpass: ${osm.features.length} bâtiments`);
        return osm;
      }
    } catch (e) {
      console.warn('[Buildings] Overpass failed:', e.message);
    }

    // 3. Génération procédurale (dernier recours)
    console.warn('[Buildings] Toutes sources indisponibles — fallback procédural');
    return this._proceduralBuildings(lat, lng, radiusMeters);
  },

  // ─── BDTOPO IGN WFS ────────────────────────────────────────────
  async _fetchBDTOPO(lat, lng, radiusMeters) {
    const deg  = radiusMeters / 111000;
    const bbox = `${lng - deg},${lat - deg},${lng + deg},${lat + deg}`;
    const url  = `${this.BDTOPO_WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature`
      + `&TYPENAMES=${this.BDTOPO_LAYER}`
      + `&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326`
      + `&BBOX=${bbox},EPSG:4326&COUNT=200`;

    const data = await resilientJSON(url, { timeoutMs: 10000, retries: 1 });
    if (!data?.features?.length) return null;

    // Normaliser les features BDTOPO vers le format TERLAB
    return {
      type: 'FeatureCollection',
      source: 'bdtopo_ign',
      features: data.features.map(f => {
        const p = f.properties ?? {};
        const usage  = (p.usage_1 ?? p.nature ?? '').toLowerCase();
        const style  = this._bdtopoStyle(usage);
        const height = parseFloat(p.hauteur ?? style.height);
        return {
          type: 'Feature',
          geometry: f.geometry,
          properties: {
            source:      'bdtopo',
            type:        usage || 'yes',
            label:       style.label,
            color:       style.color,
            height:      height,
            levels:      Math.max(1, Math.round(height / 3)),
            distance_m:  this._distanceTo(lat, lng, f.geometry),
          }
        };
      })
    };
  },

  _bdtopoStyle(usage) {
    if (usage.includes('résidentiel') || usage.includes('habitation'))
      return this.BUILDING_STYLES.residential;
    if (usage.includes('commercial'))  return this.BUILDING_STYLES.commercial;
    if (usage.includes('industriel'))  return this.BUILDING_STYLES.industrial;
    if (usage.includes('religieux'))   return this.BUILDING_STYLES.church;
    if (usage.includes('sportif'))     return { color: '#a0b090', height: 6, label: 'Équipement sportif' };
    if (usage.includes('agricole'))    return this.BUILDING_STYLES.shed;
    return this.BUILDING_STYLES._default;
  },

  // ─── OVERPASS OSM ──────────────────────────────────────────────
  async _fetchOverpass(lat, lng, radiusMeters) {
    const deg    = radiusMeters / 111000;
    const south  = lat - deg, north = lat + deg;
    const west   = lng - deg, east  = lng + deg;

    const query = `[out:json][timeout:15];
(
  way["building"](${south},${west},${north},${east});
  relation["building"](${south},${west},${north},${east});
);
out geom;`;

    const resp = await resilientFetchFirst(
      this.OVERPASS_ENDPOINTS,
      { method: 'POST', body: query, timeoutMs: 12000, retries: 1 }
    );
    const data = await resp.json();
    return this._toGeoJSON(data, lat, lng);
  },

  // ─── CONVERTIR OVERPASS → GEOJSON ──────────────────────────────
  _toGeoJSON(overpassData, terrainLat, terrainLng) {
    const features = [];
    const elements = overpassData.elements ?? [];

    for (const el of elements) {
      if (el.type !== 'way' || !el.geometry?.length) continue;

      const coords   = el.geometry.map(n => [n.lon, n.lat]);
      // Fermer le polygone si nécessaire
      if (coords.length && (coords[0][0] !== coords[coords.length-1][0] ||
          coords[0][1] !== coords[coords.length-1][1])) {
        coords.push(coords[0]);
      }
      if (coords.length < 4) continue;

      const tags    = el.tags ?? {};
      const bType   = tags.building ?? 'yes';
      const style   = this.BUILDING_STYLES[bType] ?? this.BUILDING_STYLES._default;
      const height  = parseFloat(tags['building:levels'] ?? 0) * 3 ||
                      parseFloat(tags.height ?? 0) ||
                      style.height;

      // Distance au terrain
      const midLng = coords.reduce((s,c) => s+c[0], 0) / coords.length;
      const midLat = coords.reduce((s,c) => s+c[1], 0) / coords.length;
      const dist   = Math.hypot((midLat-terrainLat)*111000, (midLng-terrainLng)*111000*Math.cos(terrainLat*Math.PI/180));

      features.push({
        type: 'Feature',
        properties: {
          osm_id:  el.id,
          type:    bType,
          name:    tags.name ?? tags['addr:housenumber'] ?? null,
          height,
          floors:  parseInt(tags['building:levels'] ?? 1),
          color:   style.color,
          label:   style.label,
          dist_m:  Math.round(dist),
          // Flags utiles
          is_heritage:  !!(tags['heritage'] || tags['historic']),
          is_commercial: ['commercial','retail','supermarket'].includes(bType),
        },
        geometry: { type: 'Polygon', coordinates: [coords] }
      });
    }

    // Trier par distance
    features.sort((a,b) => a.properties.dist_m - b.properties.dist_m);

    return { type: 'FeatureCollection', features };
  },

  // ─── Distance centroïde géométrie → point ─────────────────────
  _distanceTo(lat, lng, geometry) {
    const coords = geometry?.coordinates?.[0] ?? geometry?.coordinates?.[0]?.[0] ?? [];
    if (!coords.length) return 999;
    const n = coords.length;
    const midLng = coords.reduce((s, c) => s + c[0], 0) / n;
    const midLat = coords.reduce((s, c) => s + c[1], 0) / n;
    return Math.round(Math.hypot((midLat - lat) * 111000, (midLng - lng) * 111000 * Math.cos(lat * Math.PI / 180)));
  },

  // ─── FALLBACK : BÂTIMENTS PROCÉDURAUX ──────────────────────────
  // Génère un contexte urbain plausible si Overpass est indisponible
  _proceduralBuildings(lat, lng, radius) {
    const features = [];
    const R = radius / 111000;

    // Grille pseudo-aléatoire de bâtiments
    const seed   = Math.abs(Math.round(lat * 10000 + lng * 10000)) % 100;
    const cols   = 5, rows = 5;
    const cellW  = R * 2 / cols, cellH = R * 2 / rows;

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        // Skip central cell (c'est la parcelle)
        if (i === Math.floor(rows/2) && j === Math.floor(cols/2)) continue;

        const pseudo = (seed + i * 7 + j * 13) % 10;
        if (pseudo < 3) continue; // 30% de cases vides

        const baseLng = lng - R + j * cellW + cellW * 0.1;
        const baseLat = lat - R + i * cellH + cellH * 0.1;
        const w = cellW * 0.7, h = cellH * 0.7;
        const floors = (pseudo % 3) + 1;

        features.push({
          type: 'Feature',
          properties: {
            osm_id:  null,
            type:    floors > 2 ? 'apartments' : 'house',
            height:  floors * 3,
            floors,
            color:   floors > 2 ? '#b8a888' : '#c4b396',
            label:   floors > 2 ? 'Immeuble' : 'Maison',
            dist_m:  Math.round(Math.hypot(i-rows/2, j-cols/2) * cellW * 111000),
            procedural: true
          },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [baseLng,     baseLat],
              [baseLng + w, baseLat],
              [baseLng + w, baseLat + h],
              [baseLng,     baseLat + h],
              [baseLng,     baseLat]
            ]]
          }
        });
      }
    }

    return {
      type: 'FeatureCollection',
      features,
      _source: 'procedural',
      _note: 'Bâtiments générés procéduralement (Overpass indisponible)'
    };
  },

  // ─── CHARGER SUR LA CARTE MAPBOX ───────────────────────────────
  async loadOnMap(map, lat, lng, options = {}) {
    const {
      radius     = 250,
      sourceId   = 'context-buildings',
      layerId    = 'context-buildings-3d',
      layerIdFlat = 'context-buildings-flat',
      pitch      = 45,
      showPopups = true
    } = options;

    // Charger les données
    const geojson = await this.fetchBuildings(lat, lng, radius);

    // Créer ou mettre à jour la source
    let src = map.getSource(sourceId);
    if (src) {
      src.setData(geojson);
    } else {
      map.addSource(sourceId, { type: 'geojson', data: geojson });
    }

    // Supprimer anciennes couches
    [layerId, layerIdFlat].forEach(id => {
      try { if (map.getLayer(id)) map.removeLayer(id); } catch {}
    });

    // Couche 3D fill-extrusion (si pitch > 20°)
    if (pitch > 20) {
      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: 'fill-extrusion',
          source: sourceId,
          paint: {
            'fill-extrusion-color':   ['get', 'color'],
            'fill-extrusion-height':  ['get', 'height'],
            'fill-extrusion-base':    0,
            'fill-extrusion-opacity': 0.85
          }
        });
      }
    } else {
      // Couche 2D flat (vue de dessus)
      if (!map.getLayer(layerIdFlat)) {
        map.addLayer({
          id: layerIdFlat,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color':   ['get', 'color'],
            'fill-opacity': 0.8
          }
        });
        map.addLayer({
          id: layerIdFlat + '-outline',
          type: 'line',
          source: sourceId,
          paint: { 'line-color': 'rgba(154,120,32,.2)', 'line-width': 0.5 }
        });
      }
    }

    // Popups au clic
    if (showPopups) {
      map.off('click', layerId);
      map.on('click', layerId, (e) => {
        const p = e.features[0]?.properties;
        if (!p) return;
        new mapboxgl.Popup({ closeButton: false, className: 'terlab-popup', offset: 10 })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div class="terlab-popup-title">${p.label}</div>
            <div class="terlab-popup-row"><span>Hauteur</span><span class="terlab-popup-val">${p.height}m</span></div>
            <div class="terlab-popup-row"><span>Niveaux</span><span class="terlab-popup-val">R+${p.floors - 1}</span></div>
            <div class="terlab-popup-row"><span>Distance</span><span class="terlab-popup-val">${p.dist_m}m</span></div>
            ${p.name ? `<div class="terlab-popup-row"><span>Nom</span><span class="terlab-popup-val">${p.name}</span></div>` : ''}
          `)
          .addTo(map);
        map.getCanvas().style.cursor = '';
      });
      map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
    }

    return {
      count:     geojson.features.length,
      source:    geojson._source ?? 'overpass_osm',
      radius
    };
  },

  // ─── STATISTIQUES VOISINAGE ─────────────────────────────────────
  analyzeContext(geojson) {
    if (!geojson?.features?.length) return null;
    const f = geojson.features;
    return {
      total:         f.length,
      hauteur_max:   Math.max(...f.map(b => b.properties.height ?? 0)),
      hauteur_moy:   Math.round(f.reduce((s,b) => s + (b.properties.height ?? 0), 0) / f.length),
      individuels:   f.filter(b => ['house','residential'].includes(b.properties.type)).length,
      collectifs:    f.filter(b => b.properties.type === 'apartments').length,
      commerces:     f.filter(b => b.properties.is_commercial).length,
      plus_proche:   Math.min(...f.map(b => b.properties.dist_m ?? 999))
    };
  }
};

export default BuildingsService;
