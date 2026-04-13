// TERLAB · services/building-age-service.js
// Anciennete du bati : BDNB CSTB (primaire) + OSM start_date (fallback)
// Retourne un GeoJSON avec annee_construction + tranche reglementaire
// + couche Mapbox coloree par epoque
// ════════════════════════════════════════════════════════════════════

import { resilientJSON } from '../utils/resilient-fetch.js';

const BuildingAgeService = {

  // ─── Tranches d'epoque (alignees reglementation thermique FR) ──
  TRANCHES: [
    { id: 'pre1950',   label: 'Avant 1950',    min: 0,    max: 1949, color: '#1e3a5f', fg: '#7db8e8', risk: 'Plomb, amiante probable' },
    { id: 'pre1975',   label: '1950–1974',      min: 1950, max: 1974, color: '#2d5a8e', fg: '#a0c8e8', risk: 'Pre-RT, amiante probable' },
    { id: 'rt1975',    label: '1975–1999',       min: 1975, max: 1999, color: '#3d8b5e', fg: '#a0d8b0', risk: 'RT 1974/1988' },
    { id: 'rt2000',    label: '2000–2012',       min: 2000, max: 2012, color: '#c98620', fg: '#f0d080', risk: 'RT 2000/2005' },
    { id: 'rt2012',    label: 'Apres 2012',     min: 2013, max: 9999, color: '#b84530', fg: '#f0a090', risk: 'RT 2012 / RE 2020' },
  ],

  // ─── BDNB API (CSTB open data) ────────────────────────────────
  // PostgREST API sur donnees croisees fichiers fonciers + DPE + BDTOPO
  BDNB_API: 'https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe',

  // La Reunion n'est pas couverte par BDNB (France metropolitaine uniquement)
  _isReunion(lat, lng) {
    return lng > 55 && lng < 56 && lat > -21.5 && lat < -20.7;
  },

  // ─── Charger anciennete du bati autour d'un point ─────────────
  async fetch(lat, lng, radiusMeters = 300) {
    const reunion = this._isReunion(lat, lng);

    // 1. BDNB (meilleure source, croisement fichiers fonciers + DPE)
    //    Skip hors metropole (Reunion, DROM) : BDNB ne couvre que la metropole
    if (!reunion) {
      try {
        const bdnb = await this._fetchBDNB(lat, lng, radiusMeters);
        if (bdnb?.features?.length) {
          console.info(`[BuildingAge] BDNB: ${bdnb.features.length} batiments dates`);
          return bdnb;
        }
      } catch (e) {
        console.warn('[BuildingAge] BDNB failed:', e.message);
      }
    }

    // 2. Overpass OSM start_date (fallback communautaire)
    try {
      const osm = await this._fetchOSMAge(lat, lng, radiusMeters);
      if (osm?.features?.length) {
        console.info(`[BuildingAge] OSM: ${osm.features.length} batiments dates`);
        return osm;
      }
    } catch (e) {
      console.warn('[BuildingAge] OSM failed:', e.message);
    }

    console.warn('[BuildingAge] Aucune source disponible');
    return { type: 'FeatureCollection', features: [], _source: 'none' };
  },

  // ─── BDNB PostgREST API ───────────────────────────────────────
  async _fetchBDNB(lat, lng, radiusMeters) {
    const deg  = radiusMeters / 111000;
    const west = lng - deg, east = lng + deg;
    const south = lat - deg, north = lat + deg;

    // BDNB utilise un filtre bbox via parametre geom en WKT
    // et expose annee_construction + geom_groupe (GeoJSON)
    const bbox = `${west},${south},${east},${north}`;
    const url = `${this.BDNB_API}?select=batiment_groupe_id,annee_construction,usage_niveau_1_txt,s_geom_groupe,geom_groupe`
      + `&annee_construction=not.is.null`
      + `&geom_groupe=cd.${bbox}`
      + `&limit=200`;

    const data = await resilientJSON(url, { timeoutMs: 12000, retries: 1 });

    // BDNB renvoie un array d'objets (PostgREST)
    const items = Array.isArray(data) ? data : (data?.features ?? data?.data ?? []);
    if (!items.length) return null;

    const features = [];
    for (const b of items) {
      const year = parseInt(b.annee_construction);
      if (!year || year < 1700) continue;

      // geom_groupe est deja du GeoJSON ou un WKT
      let geometry = null;
      if (b.geom_groupe) {
        if (typeof b.geom_groupe === 'object') {
          geometry = b.geom_groupe;
        } else if (typeof b.geom_groupe === 'string') {
          try { geometry = JSON.parse(b.geom_groupe); } catch {}
        }
      }
      if (!geometry) continue;

      const tranche = this._getTranche(year);
      features.push({
        type: 'Feature',
        geometry,
        properties: {
          source:       'bdnb',
          annee:        year,
          tranche_id:   tranche.id,
          tranche_label: tranche.label,
          color:        tranche.color,
          risk:         tranche.risk,
          usage:        b.usage_niveau_1_txt ?? '',
          surface:      parseFloat(b.s_geom_groupe) || null,
        }
      });
    }

    return { type: 'FeatureCollection', features, _source: 'bdnb' };
  },

  // ─── Overpass OSM (fallback) ──────────────────────────────────
  OVERPASS_ENDPOINTS: [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ],

  async _fetchOSMAge(lat, lng, radiusMeters) {
    const deg   = radiusMeters / 111000;
    const south = lat - deg, north = lat + deg;
    const west  = lng - deg, east  = lng + deg;

    const query = `[out:json][timeout:15];
(
  way["building"]["start_date"](${south},${west},${north},${east});
  relation["building"]["start_date"](${south},${west},${north},${east});
);
out geom;`;

    let data = null;
    for (const ep of this.OVERPASS_ENDPOINTS) {
      try {
        const resp = await fetch(ep, {
          method: 'POST',
          body: query,
          signal: AbortSignal.timeout(12000)
        });
        if (resp.ok) { data = await resp.json(); break; }
      } catch {}
    }
    if (!data?.elements?.length) return null;

    const features = [];
    for (const el of data.elements) {
      if (el.type !== 'way' || !el.geometry?.length) continue;

      const coords = el.geometry.map(n => [n.lon, n.lat]);
      if (coords.length && (coords[0][0] !== coords[coords.length-1][0] ||
          coords[0][1] !== coords[coords.length-1][1])) {
        coords.push(coords[0]);
      }
      if (coords.length < 4) continue;

      const raw = el.tags?.start_date ?? '';
      const year = this._parseYear(raw);
      if (!year) continue;

      const tranche = this._getTranche(year);
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: {
          source:       'osm',
          osm_id:       el.id,
          annee:        year,
          tranche_id:   tranche.id,
          tranche_label: tranche.label,
          color:        tranche.color,
          risk:         tranche.risk,
          usage:        el.tags?.building ?? 'yes',
        }
      });
    }

    return { type: 'FeatureCollection', features, _source: 'osm' };
  },

  // ─── Helpers ──────────────────────────────────────────────────
  _parseYear(raw) {
    if (!raw) return null;
    // "2005", "2005-03", "2005-03-12", "~1960", "C19", "early 1900s"
    const m = raw.match(/(\d{4})/);
    return m ? parseInt(m[1]) : null;
  },

  _getTranche(year) {
    return this.TRANCHES.find(t => year >= t.min && year <= t.max)
      ?? this.TRANCHES[this.TRANCHES.length - 1];
  },

  // ─── Statistiques par tranche ─────────────────────────────────
  analyzeAge(geojson) {
    if (!geojson?.features?.length) return null;
    const f = geojson.features;
    const stats = {};
    for (const t of this.TRANCHES) {
      const batch = f.filter(b => b.properties.tranche_id === t.id);
      stats[t.id] = { count: batch.length, label: t.label, color: t.color, fg: t.fg };
    }
    const years = f.map(b => b.properties.annee).filter(Boolean);
    return {
      total:      f.length,
      source:     geojson._source,
      annee_min:  Math.min(...years),
      annee_max:  Math.max(...years),
      annee_moy:  Math.round(years.reduce((s, y) => s + y, 0) / years.length),
      tranches:   stats
    };
  },

  // ─── Charger couche Mapbox coloree ────────────────────────────
  loadAgeLayer(map, geojson) {
    const sourceId = 'building-age';
    const fillId   = 'building-age-fill';
    const lineId   = 'building-age-outline';

    // Nettoyer anciennes couches
    [fillId, lineId].forEach(id => {
      try { if (map.getLayer(id)) map.removeLayer(id); } catch {}
    });
    try { if (map.getSource(sourceId)) map.removeSource(sourceId); } catch {}

    if (!geojson?.features?.length) return;

    map.addSource(sourceId, { type: 'geojson', data: geojson });

    // Fill colore par propriete 'color' (defini par tranche)
    map.addLayer({
      id: fillId,
      type: 'fill',
      source: sourceId,
      paint: {
        'fill-color':   ['get', 'color'],
        'fill-opacity':  0.55
      }
    });

    map.addLayer({
      id: lineId,
      type: 'line',
      source: sourceId,
      paint: {
        'line-color':   ['get', 'color'],
        'line-width':    1.2,
        'line-opacity':  0.8
      }
    });

    // Popups
    map.on('click', fillId, (e) => {
      const p = e.features[0]?.properties;
      if (!p) return;
      new mapboxgl.Popup({ closeButton: false, className: 'terlab-popup', offset: 10 })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div class="terlab-popup-title">${p.tranche_label}</div>
          <div class="terlab-popup-row"><span>Annee</span><span class="terlab-popup-val">${p.annee}</span></div>
          <div class="terlab-popup-row"><span>Risques</span><span class="terlab-popup-val">${p.risk}</span></div>
          ${p.usage ? `<div class="terlab-popup-row"><span>Usage</span><span class="terlab-popup-val">${p.usage}</span></div>` : ''}
          <div class="terlab-popup-row"><span>Source</span><span class="terlab-popup-val">${p.source}</span></div>
        `)
        .addTo(map);
    });
    map.on('mouseenter', fillId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', fillId, () => { map.getCanvas().style.cursor = ''; });
  },

  // ─── Toggle visibilite ────────────────────────────────────────
  toggleAgeLayer(map, visible) {
    const vis = visible ? 'visible' : 'none';
    ['building-age-fill', 'building-age-outline'].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    });
  },

  // ─── Photos historiques IGN (Remonter le Temps) WMTS ──────────
  // Couches disponibles via Geoplateforme :
  //   ORTHOIMAGERY.ORTHOPHOTOS.1950-1965
  //   ORTHOIMAGERY.ORTHOPHOTOS (actuelle)
  HIST_WMTS: 'https://data.geopf.fr/wmts',
  HIST_LAYERS: [
    { id: 'ortho-1950', layer: 'ORTHOIMAGERY.ORTHOPHOTOS.1950-1965', label: '1950-1965', year: 1950 },
    { id: 'ortho-now',  layer: 'ORTHOIMAGERY.ORTHOPHOTOS',           label: 'Actuelle',  year: 2024 },
  ],

  addHistoricalLayer(map, layerDef) {
    const sourceId = `hist-${layerDef.id}`;
    const layerId  = `hist-${layerDef.id}-raster`;

    if (map.getSource(sourceId)) return layerId; // deja charge

    map.addSource(sourceId, {
      type: 'raster',
      tiles: [
        `${this.HIST_WMTS}?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile`
        + `&LAYER=${layerDef.layer}&STYLE=normal&FORMAT=image/jpeg`
        + `&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`
      ],
      tileSize: 256,
      attribution: 'IGN Remonter le Temps'
    });

    // Inserer sous les labels
    const firstSymbol = map.getStyle().layers.find(l => l.type === 'symbol');
    map.addLayer({
      id: layerId,
      type: 'raster',
      source: sourceId,
      paint: { 'raster-opacity': 0.85 },
      layout: { visibility: 'none' }
    }, firstSymbol?.id);

    return layerId;
  },

  toggleHistoricalLayer(map, layerDef, visible) {
    const layerId = `hist-${layerDef.id}-raster`;
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    } else if (visible) {
      this.addHistoricalLayer(map, layerDef);
      map.setLayoutProperty(`hist-${layerDef.id}-raster`, 'visibility', 'visible');
    }
  }
};

export default BuildingAgeService;
