// TERLAB · services/lidar-heights-service.js · ENSA La Reunion · MGA Architecture
// Hauteurs batiments LiDAR HD IGN — modes LIVE (WCS par batiment) ou IMPORT (JSON Python)
// Dependances globales chargees dans index.html : GeoTIFF (geotiff.js), proj4

export const LidarHeights = (() => {

  const CFG = {
    overpassUrl:    'https://overpass-api.de/api/interpreter',
    wcsUrl:         'https://data.geopf.fr/wcs',
    mnhLayer:       'LIDARHD_MNH',
    percentile:     95,
    maxConcurrent:  4,
    batchMarginDeg: 0.0005,
    minHeight:      2.5,
    maxHeight:      50.0,
    vegDelta:       2.0,
    minPixels:      4,
    minCoverage:    0.25,
    nodata:        -9999,
    layerId:        'lidar-heights-extrusion',
    sourceId:       'lidar-heights-source',
    cacheKey:       'terlab_lidar_heights_cache',
  };

  // RGR92 / UTM zone 40S — projection legale Reunion
  const PROJ_RGR92 = '+proj=utm +zone=40 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';

  const state = {
    map:         null,
    buildings:   [],
    heights:     new Map(),
    queue:       [],
    active:      0,
    aborted:     false,
    mode:        null,
    onProgress:  null,
    selectedId:  null,
  };

  async function init(map, options = {}) {
    state.map = map;
    state.onProgress = options.onProgress || state.onProgress;

    if (window.proj4) {
      proj4.defs('EPSG:4471', PROJ_RGR92);
    }

    _setupMapboxLayer();
    _setupMapClick();

    console.log('[LidarHeights] Module initialise.');
    return api;
  }

  const api = {
    init,

    async analyzeBbox(bbox) {
      state.aborted = false;
      state.mode = 'live';
      state.heights.clear();
      await _fetchOSMBuildings(bbox);
      _buildQueue();
      _processQueue();
      return api;
    },

    loadJSON(jsonData) {
      state.mode = 'import';
      state.heights.clear();
      state.buildings = [];

      const records = Array.isArray(jsonData) ? jsonData : jsonData.buildings || [];
      records.forEach(r => {
        state.heights.set(r.osm_id, {
          osm_id:      r.osm_id,
          height_p95:  r.height_p95 ?? r.height_m,
          height_p50:  r.height_p50 ?? null,
          pixel_count: r.pixel_count ?? null,
          coverage:    r.coverage ?? null,
          veg_suspect: r.veg_suspect ?? false,
          tag_ready:   r.tag_ready ?? true,
          reject_reason: r.reject_reason ?? 'imported',
          status:      'done',
        });
        if (r.geometry) {
          state.buildings.push({ osm_id: r.osm_id, geometry: r.geometry, tags: r });
        }
      });

      _refreshMapLayer();
      _notifyProgress();
      console.log(`[LidarHeights] ${state.heights.size} hauteurs chargees depuis JSON.`);
      return api;
    },

    abort() {
      state.aborted = true;
      state.queue = [];
    },

    getStats() { return _computeStats(); },
    exportCSV()  { return _exportCSV(); },
    exportOSM()  { return _exportOSMXML(); },
    exportJSON() { return _exportJSON(); },

    setSelected(osmId) {
      state.selectedId = osmId;
      _refreshMapLayer();
      return state.heights.get(osmId) || null;
    },

    overrideHeight(osmId, newHeight) {
      const h = state.heights.get(osmId);
      if (h) {
        h.height_override = parseFloat(newHeight);
        h.tag_ready = true;
        h.reject_reason = 'manual_override';
        _refreshMapLayer();
      }
    },

    validateBuilding(osmId, approved) {
      const h = state.heights.get(osmId);
      if (h) {
        h.validated = approved;
        h.tag_ready = approved;
        _refreshMapLayer();
      }
    },
  };

  async function _fetchOSMBuildings(bbox) {
    const [lonMin, latMin, lonMax, latMax] = bbox;
    const query = `
      [out:json][timeout:30];
      (way["building"](${latMin},${lonMin},${latMax},${lonMax}););
      out body; >; out skel qt;
    `;

    console.log('[LidarHeights] Fetch OSM buildings...');
    const resp = await fetch(CFG.overpassUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    'data=' + encodeURIComponent(query),
    });
    if (!resp.ok) throw new Error(`Overpass error: ${resp.status}`);
    const data = await resp.json();

    const nodes = {};
    data.elements.forEach(el => {
      if (el.type === 'node') nodes[el.id] = [el.lon, el.lat];
    });

    state.buildings = [];
    data.elements.forEach(el => {
      if (el.type !== 'way' || !el.tags?.building) return;
      const coords = (el.nodes || []).map(n => nodes[n]).filter(Boolean);
      if (coords.length < 4) return;
      if (coords[0][0] !== coords[coords.length - 1][0]) coords.push(coords[0]);

      state.buildings.push({
        osm_id:   el.id,
        geometry: coords,
        tags:     el.tags || {},
      });
    });

    console.log(`[LidarHeights] ${state.buildings.length} batiments OSM charges.`);
    _notifyProgress();
  }

  function _buildQueue() {
    state.queue = state.buildings
      .filter(b => !state.heights.has(b.osm_id))
      .map(b => b.osm_id);

    state.buildings.forEach(b => {
      if (!state.heights.has(b.osm_id)) {
        state.heights.set(b.osm_id, {
          osm_id:  b.osm_id,
          status:  'pending',
          tag_ready: false,
        });
      }
    });
    _refreshMapLayer();
  }

  function _processQueue() {
    while (state.active < CFG.maxConcurrent && state.queue.length > 0 && !state.aborted) {
      const osmId = state.queue.shift();
      state.active++;
      _fetchHeightForBuilding(osmId)
        .then(() => { state.active--; _processQueue(); _notifyProgress(); })
        .catch(() => { state.active--; _processQueue(); });
    }
  }

  async function _fetchHeightForBuilding(osmId) {
    const building = state.buildings.find(b => b.osm_id === osmId);
    if (!building) return;

    state.heights.set(osmId, { ...state.heights.get(osmId), status: 'loading' });

    try {
      const lons = building.geometry.map(c => c[0]);
      const lats = building.geometry.map(c => c[1]);
      const bbox = [
        Math.min(...lons) - CFG.batchMarginDeg,
        Math.min(...lats) - CFG.batchMarginDeg,
        Math.max(...lons) + CFG.batchMarginDeg,
        Math.max(...lats) + CFG.batchMarginDeg,
      ];

      let xMin, yMin, xMax, yMax;
      if (window.proj4) {
        [xMin, yMin] = proj4('EPSG:4326', 'EPSG:4471', [bbox[0], bbox[1]]);
        [xMax, yMax] = proj4('EPSG:4326', 'EPSG:4471', [bbox[2], bbox[3]]);
      } else {
        const lat0 = (bbox[1] + bbox[3]) / 2;
        const mPerDegLon = 111320 * Math.cos(lat0 * Math.PI / 180);
        const mPerDegLat = 110540;
        xMin = bbox[0] * mPerDegLon; xMax = bbox[2] * mPerDegLon;
        yMin = bbox[1] * mPerDegLat; yMax = bbox[3] * mPerDegLat;
      }

      const width  = Math.max(8, Math.round((xMax - xMin) / 0.5));
      const height = Math.max(8, Math.round((yMax - yMin) / 0.5));

      const url = `${CFG.wcsUrl}?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage`
        + `&COVERAGEID=${CFG.mnhLayer}&FORMAT=image/tiff`
        + `&OUTPUTCRS=EPSG:4471&SUBSETTINGCRS=EPSG:4471`
        + `&SUBSET=E(${xMin.toFixed(2)},${xMax.toFixed(2)})`
        + `&SUBSET=N(${yMin.toFixed(2)},${yMax.toFixed(2)})`
        + `&WIDTH=${width}&HEIGHT=${height}`;

      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`WCS ${resp.status}`);
      const buffer = await resp.arrayBuffer();

      const tiff   = await GeoTIFF.fromArrayBuffer(buffer);
      const image  = await tiff.getImage();
      const raster = await image.readRasters();
      const band   = Array.from(raster[0]);

      const valid = band.filter(v => v > CFG.nodata && v > -1.0);
      if (valid.length < CFG.minPixels) throw new Error('not_enough_pixels');

      const bboxAreaM2 = (xMax - xMin) * (yMax - yMin);
      const pixelAreaM2 = 0.25;
      const coverage = (valid.length * pixelAreaM2) / bboxAreaM2;

      const sorted = [...valid].sort((a, b) => a - b);
      const p95  = _percentile(sorted, 95);
      const p50  = _percentile(sorted, 50);
      const pmax = sorted[sorted.length - 1];

      const vegSuspect = (p95 - p50) > CFG.vegDelta;
      const alreadyTagged = !!building.tags.height;

      let tagReady = true;
      let rejectReason = 'ok';
      if (coverage < CFG.minCoverage)      { tagReady = false; rejectReason = 'low_coverage'; }
      if (p95 < CFG.minHeight)              { tagReady = false; rejectReason = 'below_min_height'; }
      if (p95 > CFG.maxHeight)              { tagReady = false; rejectReason = 'above_max_height'; }
      if (vegSuspect)                       { tagReady = false; rejectReason = 'vegetation_suspected'; }
      if (alreadyTagged)                    { tagReady = false; rejectReason = 'height_already_in_osm'; }

      state.heights.set(osmId, {
        osm_id:        osmId,
        height_p95:    Math.round(p95 * 10) / 10,
        height_p50:    Math.round(p50 * 10) / 10,
        height_max:    Math.round(pmax * 10) / 10,
        pixel_count:   valid.length,
        coverage:      Math.round(coverage * 100) / 100,
        veg_suspect:   vegSuspect,
        tag_ready:     tagReady,
        reject_reason: rejectReason,
        status:        'done',
        tags:          building.tags,
      });

    } catch (err) {
      state.heights.set(osmId, {
        osm_id:        osmId,
        status:        'error',
        tag_ready:     false,
        reject_reason: err.message || 'fetch_error',
      });
    }

    _refreshMapLayer();
  }

  function _setupMapboxLayer() {
    const map = state.map;
    if (!map) return;

    const geojson = { type: 'FeatureCollection', features: [] };

    if (map.getSource(CFG.sourceId)) {
      map.getSource(CFG.sourceId).setData(geojson);
    } else {
      map.addSource(CFG.sourceId, { type: 'geojson', data: geojson });
    }

    if (!map.getLayer(CFG.layerId)) {
      map.addLayer({
        id:   CFG.layerId,
        type: 'fill-extrusion',
        source: CFG.sourceId,
        paint: {
          'fill-extrusion-color': [
            'case',
            ['==', ['get', 'status'], 'pending'], '#aaaaaa',
            ['==', ['get', 'status'], 'loading'], '#6ec6ff',
            ['==', ['get', 'status'], 'error'],   '#ff6b6b',
            ['==', ['get', 'veg_suspect'], true],  '#ff9f43',
            ['==', ['get', 'tag_ready'], false],   '#ee5a24',
            ['interpolate', ['linear'], ['get', 'height'],
              0,  '#2ecc71',
              6,  '#f9ca24',
              12, '#f0932b',
              20, '#eb4d4b',
              35, '#6c5ce7',
            ],
          ],
          'fill-extrusion-height': ['coalesce', ['get', 'height'], 0.5],
          'fill-extrusion-base':   0,
          'fill-extrusion-opacity': 0.85,
        },
      });
    }
  }

  function _refreshMapLayer() {
    const map = state.map;
    if (!map || !map.getSource(CFG.sourceId)) return;

    const features = state.buildings.map(b => {
      const h = state.heights.get(b.osm_id);
      const displayH = h?.height_override ?? h?.height_p95 ?? null;
      return {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [b.geometry] },
        properties: {
          osm_id:      b.osm_id,
          height:      displayH,
          status:      h?.status ?? 'pending',
          tag_ready:   h?.tag_ready ?? false,
          veg_suspect: h?.veg_suspect ?? false,
          coverage:    h?.coverage ?? null,
          reject_reason: h?.reject_reason ?? '',
          name:        b.tags?.name ?? '',
          building:    b.tags?.building ?? 'yes',
        },
      };
    });

    map.getSource(CFG.sourceId).setData({ type: 'FeatureCollection', features });
  }

  function _setupMapClick() {
    const map = state.map;
    if (!map) return;

    map.on('click', CFG.layerId, e => {
      const feat = e.features?.[0];
      if (!feat) return;
      const osmId = feat.properties.osm_id;
      state.selectedId = osmId;
      _refreshMapLayer();

      const h = state.heights.get(osmId);
      if (api.onBuildingClick) api.onBuildingClick(osmId, h, feat);
    });

    map.on('mouseenter', CFG.layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', CFG.layerId, () => { map.getCanvas().style.cursor = ''; });
  }

  api.onBuildingClick = null;

  function _computeStats() {
    const all    = [...state.heights.values()];
    const done   = all.filter(h => h.status === 'done');
    const ready  = done.filter(h => h.tag_ready);
    const veg    = done.filter(h => h.veg_suspect);
    const errors = all.filter(h => h.status === 'error');
    const pending = state.queue.length + state.active;

    const heights = ready.map(h => h.height_override ?? h.height_p95).filter(Boolean);
    const avgH = heights.length ? (heights.reduce((a, b) => a + b, 0) / heights.length) : 0;

    const rejectBreakdown = {};
    done.filter(h => !h.tag_ready).forEach(h => {
      rejectBreakdown[h.reject_reason] = (rejectBreakdown[h.reject_reason] || 0) + 1;
    });

    return {
      total:    state.buildings.length,
      done:     done.length,
      ready:    ready.length,
      veg:      veg.length,
      errors:   errors.length,
      pending,
      avgHeight: Math.round(avgH * 10) / 10,
      minHeight: heights.length ? Math.min(...heights) : null,
      maxHeight: heights.length ? Math.max(...heights) : null,
      rejectBreakdown,
    };
  }

  function _notifyProgress() {
    if (state.onProgress) state.onProgress(_computeStats());
    _refreshMapLayer();
  }

  function _exportCSV() {
    const rows = [
      ['osm_id', 'height_m', 'height_p50', 'coverage', 'pixel_count',
       'veg_suspect', 'tag_ready', 'reject_reason', 'source'].join(',')
    ];
    state.heights.forEach((h, id) => {
      if (h.status !== 'done') return;
      const height = h.height_override ?? h.height_p95;
      rows.push([
        id,
        height ?? '',
        h.height_p50 ?? '',
        h.coverage ?? '',
        h.pixel_count ?? '',
        h.veg_suspect ? '1' : '0',
        h.tag_ready ? '1' : '0',
        h.reject_reason ?? '',
        'IGN LiDAR HD MNH',
      ].join(','));
    });
    return rows.join('\n');
  }

  function _exportOSMXML() {
    const date = new Date().toISOString().slice(0, 10);
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<osm version="0.6" generator="terlab-lidar-heights">\n`;
    xml += `  <!-- Hauteurs LiDAR HD IGN — La Reunion — ${date} -->\n`;
    xml += `  <!-- VALIDATION HUMAINE REQUISE dans JOSM avant upload -->\n\n`;

    state.heights.forEach((h, id) => {
      if (!h.tag_ready) return;
      const height = h.height_override ?? h.height_p95;
      if (!height) return;
      const hRounded = Math.round(height * 2) / 2;
      const building = state.buildings.find(b => b.osm_id === id);
      const bTag = building?.tags?.building ?? 'yes';

      xml += `  <way id="${id}" action="modify" visible="true">\n`;
      xml += `    <tag k="building" v="${bTag}"/>\n`;
      xml += `    <tag k="height" v="${hRounded}"/>\n`;
      xml += `    <tag k="source:height" v="IGN LiDAR HD MNH"/>\n`;
      if (h.validated) xml += `    <tag k="lidar:validated" v="yes"/>\n`;
      xml += `  </way>\n`;
    });

    xml += `</osm>`;
    return xml;
  }

  function _exportJSON() {
    const records = [];
    state.heights.forEach((h, id) => {
      const building = state.buildings.find(b => b.osm_id === id);
      records.push({
        osm_id:      id,
        height_p95:  h.height_p95,
        height_p50:  h.height_p50,
        height_m:    h.height_override ?? h.height_p95,
        pixel_count: h.pixel_count,
        coverage:    h.coverage,
        veg_suspect: h.veg_suspect,
        tag_ready:   h.tag_ready,
        reject_reason: h.reject_reason,
        validated:   h.validated ?? false,
        geometry:    building?.geometry ?? null,
        tags:        building?.tags ?? {},
      });
    });
    return JSON.stringify({ buildings: records }, null, 2);
  }

  function _percentile(sorted, p) {
    if (!sorted.length) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  }

  return api;
})();

export default LidarHeights;
