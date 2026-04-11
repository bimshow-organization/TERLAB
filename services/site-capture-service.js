// TERLAB · services/site-capture-service.js
// Capture 3D du site reel : DEM IGN (BIL float32) + Batiments + Routes BDTOPO
// Coordonnees locales en metres (origine = centroide de la parcelle, EPSG:2975 UTM40S RGR92).
// Sortie : SiteScene consommee par DXFWorker.generateSite3D() et IFCExporter.generateASCIIWithContext()
// ENSA La Reunion · TERLAB v1
// ═══════════════════════════════════════════════════════════════════════

const SiteCaptureService = {

  /**
   * Capture complete du site 3D autour de la parcelle de la session courante.
   *
   * @param {Object} opts
   * @param {number}   [opts.bufferM=100]      Buffer autour de la parcelle (50|100|200m)
   * @param {number}   [opts.pixelSizeM=2]     Resolution DEM en metres (1|2|5)
   * @param {boolean}  [opts.withBuildings=true]
   * @param {boolean}  [opts.withRoads=true]
   * @param {boolean}  [opts.decimate=false]   Vraie decimation : 1 vertex sur 2 par axe (÷4 triangles)
   * @param {AbortSignal} [opts.signal]        Permet d'annuler les fetch reseau
   * @param {Function} [opts.onProgress]       (pct, label)
   * @returns {Promise<SiteScene>}
   */
  async capture(opts = {}) {
    const {
      bufferM       = 100,
      pixelSizeM    = 2,
      withBuildings = true,
      withRoads     = true,
      decimate      = false,
      signal,
      onProgress    = () => {},
    } = opts;

    // ── 1. Lecture session ──────────────────────────────────────────
    const terrain = window.SessionManager?.getTerrain?.() ?? {};
    const lat = parseFloat(terrain.lat);
    const lng = parseFloat(terrain.lng);
    if (!isFinite(lat) || !isFinite(lng)) {
      throw new Error('[SiteCapture] terrain.lat / terrain.lng manquants — completez la Phase 0');
    }
    // altitude_ngr peut etre absent (non initialise dans _defaultData) → fallback 0
    const altRef = parseFloat(terrain.altitude_ngr);
    const originAlt = isFinite(altRef) ? altRef : 0;

    onProgress(2, 'Initialisation projection…');
    if (!window.BILTerrain?._ensureProj4) {
      throw new Error('[SiteCapture] BILTerrain indisponible — verifiez le chargement de services/bil-terrain.js');
    }
    await window.BILTerrain._ensureProj4();
    if (signal?.aborted) throw new DOMException('Capture annulee', 'AbortError');

    // ── 2. Origine UTM40S locale ────────────────────────────────────
    const [originE, originN] = proj4('EPSG:4326', 'EPSG:2975', [lng, lat]);
    const origin = { E: originE, N: originN, alt: originAlt };

    // BBox UTM40S et WGS84 autour du centroide
    const utmBbox = {
      minE: originE - bufferM, minN: originN - bufferM,
      maxE: originE + bufferM, maxN: originN + bufferM,
    };
    const degLat = bufferM / 111320;
    const degLng = bufferM / (111320 * Math.cos(lat * Math.PI / 180));
    const wgsBbox = {
      west:  lng - degLng, east:  lng + degLng,
      south: lat - degLat, north: lat + degLat,
    };

    // ── 3. Terrain DEM ──────────────────────────────────────────────
    onProgress(10, 'Chargement DEM IGN…');
    const demData = await this._fetchDEM(utmBbox, pixelSizeM, signal);
    if (signal?.aborted) throw new DOMException('Capture annulee', 'AbortError');

    onProgress(40, 'Maillage terrain…');
    const terrainMesh = this._buildTerrainMesh(demData, origin, decimate);

    // ── 4. Parcelle drapee ──────────────────────────────────────────
    onProgress(50, 'Drapage parcelle…');
    const parcelGeom = this._buildParcel3D(terrain, origin, demData);

    // ── 5. Batiments BDTOPO ─────────────────────────────────────────
    let buildings = [];
    if (withBuildings) {
      onProgress(60, 'Chargement batiments BDTOPO…');
      try {
        const batGJ = await window.BdTopoService?.fetchBatiments?.(lat, lng, bufferM + 50);
        if (signal?.aborted) throw new DOMException('Capture annulee', 'AbortError');
        buildings = this._processBuildings(batGJ, origin, demData);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        console.warn('[SiteCapture] Batiments BDTOPO echec:', e.message);
      }
    }

    // ── 6. Routes BDTOPO drapees ────────────────────────────────────
    let roads = [];
    if (withRoads) {
      onProgress(78, 'Chargement routes BDTOPO…');
      try {
        const routesGJ = await window.BdTopoService?.fetchRoutes?.(lat, lng, bufferM + 50);
        if (signal?.aborted) throw new DOMException('Capture annulee', 'AbortError');
        roads = this._processRoads(routesGJ, origin, demData);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        console.warn('[SiteCapture] Routes BDTOPO echec:', e.message);
      }
    }

    onProgress(95, 'Assemblage scene…');

    /** @typedef {Object} SiteScene */
    const scene = {
      origin,            // { E, N, alt } UTM40S absolus + alt NGR
      lat, lng,          // WGS84 du centroide (pour IFC RefLatitude/Longitude)
      wgsBbox, utmBbox,
      bufferM, pixelSizeM, decimated: !!decimate,
      demData,           // { W, H, pixelSizeM, minE, minN, heights }
      terrainMesh,       // { vertices: [{x,y,z}], triangles: [[i,j,k]] }
      parcelGeom,        // { ring3d: [{x,y,z}], area } | null
      buildings,         // [{ footprint3d, height, usage, label, source }]
      roads,             // [{ vertices3d, nom, type, largeur, nature }]
      metadata: {
        commune:    terrain.commune    ?? 'La Reunion',
        insee:      terrain.code_insee ?? '',
        section:    terrain.section    ?? '',
        parcelle:   terrain.parcelle   ?? '',
        capturedAt: new Date().toISOString(),
        crs:        'EPSG:2975 (UTM40S RGR92) — origine locale parcelle',
        altRef:     'NGR (Nivellement General de La Reunion)',
        sources: {
          dem:       'IGN ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES (WMS-R BIL float32)',
          buildings: 'BDTOPO_V3:batiment (WFS data.geopf.fr)',
          roads:     'BDTOPO_V3:troncon_de_route (WFS data.geopf.fr)',
        },
        generator: 'TERLAB v1 · ENSA La Reunion',
      },
    };

    onProgress(100, 'Termine');
    return scene;
  },

  // ── Slug filename-safe (gere accents, apostrophes, espaces) ─────────
  slugify(s) {
    if (!s) return '';
    // Decompose les accents puis filtre tout sauf alphanum / tiret / underscore / point
    return String(s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_.-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  },

  // ── Fetch DEM IGN BIL ───────────────────────────────────────────────
  async _fetchDEM(utmBbox, pixelSizeM, signal) {
    const BT = window.BILTerrain;
    const px = pixelSizeM;
    const minX = BT._snap(utmBbox.minE, px);
    const minY = BT._snap(utmBbox.minN, px);
    const maxX = BT._snap(utmBbox.maxE, px);
    const maxY = BT._snap(utmBbox.maxN, px);
    const W = Math.max(2, Math.ceil((maxX - minX) / px));
    const H = Math.max(2, Math.ceil((maxY - minY) / px));
    // Le WMS-R limite la taille raster — guard a 512px par axe (cf. BILTerrain.buildMesh)
    if (W > 512 || H > 512) {
      throw new Error(`[SiteCapture] DEM trop grand (${W}x${H}) — augmentez pixelSizeM ou reduisez bufferM`);
    }
    const bbox = [minX, minY, minX + W * px, minY + H * px];
    const url = BT._buildUrl(bbox, W, H);

    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`[SiteCapture] DEM HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const heights = BT._parseBIL(buf);

    // Filtre nodata (-9999, hors plage Reunion)
    const clean = new Float32Array(heights.length);
    for (let i = 0; i < heights.length; i++) {
      const v = heights[i];
      clean[i] = (isFinite(v) && v > -500 && v < 5000) ? v : 0;
    }
    return { W, H, pixelSizeM: px, minE: minX, minN: minY, heights: clean };
  },

  // ── Maillage terrain : grille → triangles, coords locales ─────────
  // decimate=true : echantillonne 1 vertex sur 2 par axe (vraie decimation, ÷4 triangles).
  _buildTerrainMesh(demData, origin, decimate) {
    const step = decimate ? 2 : 1;
    const { W, H, pixelSizeM: px, minE, minN, heights } = demData;
    const W2 = Math.floor((W - 1) / step) + 1;
    const H2 = Math.floor((H - 1) / step) + 1;

    const vertices = new Array(W2 * H2);
    let v = 0;
    for (let jj = 0; jj < H2; jj++) {
      const j = jj * step;
      for (let ii = 0; ii < W2; ii++) {
        const i = ii * step;
        const x = (minE + i * px) - origin.E;
        const y = (minN + (H - 1 - j) * px) - origin.N;  // Y vers le nord
        const z = heights[j * W + i];
        vertices[v++] = { x, y, z };
      }
    }

    const triangles = [];
    for (let jj = 0; jj < H2 - 1; jj++) {
      for (let ii = 0; ii < W2 - 1; ii++) {
        const a = jj * W2 + ii;
        const b = a + 1;
        const c = (jj + 1) * W2 + ii;
        const d = c + 1;
        // CCW vue du dessus avec Y nord
        triangles.push([a, c, b]);
        triangles.push([b, c, d]);
      }
    }
    return { vertices, triangles };
  },

  // ── Parcelle drapee sur DEM ─────────────────────────────────────────
  _buildParcel3D(terrain, origin, demData) {
    const geojson = terrain?.parcelle_geojson;
    if (!geojson) return null;
    const ring = geojson.type === 'Polygon'
      ? geojson.coordinates?.[0]
      : geojson.coordinates?.[0]?.[0];
    if (!ring?.length || ring.length < 3) return null;

    const ring3d = [];
    for (const coord of ring) {
      if (!Array.isArray(coord) || coord.length < 2) continue;
      const [E, N] = proj4('EPSG:4326', 'EPSG:2975', [coord[0], coord[1]]);
      const z = this._sampleDEM(demData, E, N);
      ring3d.push({ x: E - origin.E, y: N - origin.N, z });
    }
    if (ring3d.length < 3) return null;

    // Aire (shoelace 2D, ignore Z)
    let area = 0;
    for (let i = 0; i < ring3d.length - 1; i++) {
      area += ring3d[i].x * ring3d[i + 1].y - ring3d[i + 1].x * ring3d[i].y;
    }
    return { ring3d, area: Math.abs(area) / 2 };
  },

  // ── Batiments BDTOPO → solides extrudes ─────────────────────────────
  _processBuildings(batGJ, origin, demData) {
    if (!batGJ?.features?.length) return [];
    const out = [];
    for (const f of batGJ.features) {
      const t = f.geometry?.type;
      if (t !== 'Polygon' && t !== 'MultiPolygon') continue;
      const coords = t === 'Polygon'
        ? f.geometry.coordinates?.[0]
        : f.geometry.coordinates?.[0]?.[0];
      if (!coords || coords.length < 4) continue;

      const footprint3d = [];
      for (const c of coords) {
        if (!Array.isArray(c) || c.length < 2) continue;
        const [E, N] = proj4('EPSG:4326', 'EPSG:2975', [c[0], c[1]]);
        const z = this._sampleDEM(demData, E, N);
        footprint3d.push({ x: E - origin.E, y: N - origin.N, z });
      }
      // Footprint degenere apres projection ?
      if (footprint3d.length < 4) continue;
      const xs = footprint3d.map(p => p.x), ys = footprint3d.map(p => p.y);
      const dx = Math.max(...xs) - Math.min(...xs);
      const dy = Math.max(...ys) - Math.min(...ys);
      if (dx < 0.5 || dy < 0.5) continue;  // < 50cm = degenere

      const p = f.properties ?? {};
      // Mo4 : pas d'heuristique nombre_de_logements. Hauteur reelle ou fallback 6m.
      const hauteurAttr = parseFloat(p.hauteur);
      const height = isFinite(hauteurAttr) && hauteurAttr > 0
        ? Math.min(60, Math.max(2, hauteurAttr))
        : 6;

      // B4 : usage_1 absent dans BdTopoService — fallback nature
      const nature = (p.nature ?? '').toString();
      const label = nature || 'Batiment';
      const usage = nature.toLowerCase() || 'indifferencie';

      out.push({ footprint3d, height, usage, label, source: 'bdtopo' });
    }
    return out;
  },

  // ── Routes BDTOPO → polylignes 3D drapees ───────────────────────────
  _processRoads(routesGJ, origin, demData) {
    if (!routesGJ?.features?.length) return [];
    const out = [];
    for (const f of routesGJ.features) {
      const t = f.geometry?.type;
      if (t !== 'LineString' && t !== 'MultiLineString') continue;
      const coords = t === 'LineString'
        ? f.geometry.coordinates
        : f.geometry.coordinates?.[0];
      if (!coords || coords.length < 2) continue;

      const vertices3d = [];
      for (const c of coords) {
        if (!Array.isArray(c) || c.length < 2) continue;
        const [E, N] = proj4('EPSG:4326', 'EPSG:2975', [c[0], c[1]]);
        const z = this._sampleDEM(demData, E, N);
        vertices3d.push({ x: E - origin.E, y: N - origin.N, z });
      }
      if (vertices3d.length < 2) continue;

      const p = f.properties ?? {};
      const nature = (p.nature ?? '').toString();
      const imp = (p.importance ?? '5').toString();
      let type = 'local';
      if (imp <= '2' || /nationale|autoroute/i.test(nature))   type = 'primary';
      else if (imp <= '3' || /départementale|departementale/i.test(nature)) type = 'secondary';
      else if (/chemin|sentier/i.test(nature))                 type = 'path';

      out.push({
        vertices3d,
        nom:     p.nom_voie_gauche ?? p.nom_voie_droite ?? '',
        type,
        largeur: parseFloat(p.largeur_de_chaussee) || null,
        nature:  nature || null,
      });
    }
    return out;
  },

  // ── Echantillonnage bilineaire du DEM (E,N en absolus UTM40S) ───────
  _sampleDEM(demData, E, N) {
    const { W, H, pixelSizeM: px, minE, minN, heights } = demData;
    const fi = (E - minE) / px;
    const fj = (H - 1) - (N - minN) / px;  // ligne 0 = nord
    const i0 = Math.max(0, Math.min(W - 2, Math.floor(fi)));
    const j0 = Math.max(0, Math.min(H - 2, Math.floor(fj)));
    const tx = Math.max(0, Math.min(1, fi - i0));
    const ty = Math.max(0, Math.min(1, fj - j0));
    const z00 = heights[j0 * W + i0],         z10 = heights[j0 * W + i0 + 1];
    const z01 = heights[(j0 + 1) * W + i0],   z11 = heights[(j0 + 1) * W + i0 + 1];
    return z00 * (1 - tx) * (1 - ty) + z10 * tx * (1 - ty) +
           z01 * (1 - tx) * ty       + z11 * tx * ty;
  },
};

export default SiteCaptureService;
