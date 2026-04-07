// TERLAB · services/buildings-service.js
// Chargement des bâtiments OSM via API Overpass
// Utilisé pour afficher le contexte bâti autour du terrain
// + Bâtiments des projets démo (rendu enrichi)
// Aucune clé API requise — données OpenStreetMap

const BuildingsService = {

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

  // ─── CHARGER LES BÂTIMENTS OSM ─────────────────────────────────
  async fetchBuildings(lat, lng, radiusMeters = 250) {
    const deg    = radiusMeters / 111000;
    const south  = lat - deg, north = lat + deg;
    const west   = lng - deg, east  = lng + deg;

    const query = `[out:json][timeout:15];
(
  way["building"](${south},${west},${north},${east});
  relation["building"](${south},${west},${north},${east});
);
out geom;`;

    // Essayer les deux endpoints Overpass
    for (const endpoint of this.OVERPASS_ENDPOINTS) {
      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          body: query,
          signal: AbortSignal.timeout(12000)
        });
        if (!resp.ok) throw new Error(`Overpass ${resp.status}`);
        const data = await resp.json();
        return this._toGeoJSON(data, lat, lng);
      } catch (e) {
        console.warn(`[Buildings] ${endpoint} failed:`, e.message);
        continue;
      }
    }

    console.warn('[Buildings] Tous les endpoints Overpass indisponibles — fallback procédural');
    return this._proceduralBuildings(lat, lng, radiusMeters);
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
