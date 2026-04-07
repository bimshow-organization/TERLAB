// terlab/components/esquisse-canvas.js
// Editeur SVG plan masse Phase 11 TERLAB v2.0
// SVG overlay sur Mapbox GL JS live — re-projete sur map.on('render')
// Bug fixes : CCW/winding, normales interieures, classifyEdges, centroide

const EsquisseCanvas = {

  // ── GEOMETRIES WGS84 [lng, lat][] — source de verite absolue ───
  _parcelGeo:    [],   // sommets parcelle [[lng,lat], ...]
  _streetsGeo:   [],   // { nom, type, points: [[lng,lat],...] }[]
  _voisinsGeo:   [],   // { pts: [[lng,lat],...], hauteur?, usage? }[]
  _proposalsGeo: [],   // { polygon: [[lng,lat],...], ...metadata }[]

  // ── GEOMETRIES LOCAL METRES (origine = centroide parcelle) ─────
  _parcelLocal:  [],   // { x, y }[] — derive de _parcelGeo
  _edgeTypes:    [],   // 'voie'|'fond'|'lateral'[]

  // ── REFERENCES ─────────────────────────────────────────────────
  _svg:    null,       // <svg> overlay
  _map:    null,       // mapboxgl.Map (via MapViewer.getMap())
  _canvas: null,       // HTMLElement du container Mapbox

  // ── ETAT ───────────────────────────────────────────────────────
  _session:    null,
  _proposals:  [],
  _selected:   0,
  _dragging:   null,
  _mode:       'select',
  _boundRender:  null,
  _boundDrag:    null,
  _boundDragEnd: null,

  // ── INIT ───────────────────────────────────────────────────────
  async init(svgId, sessionData) {
    this._session  = sessionData ?? {};
    this._map      = window.MapViewer?.getMap();

    // ── 1. SVG overlay ───────────────────────────────────────────
    // Si Mapbox disponible : overlay sur le canvas Mapbox
    // Sinon : fallback mode standalone (ancien fonctionnement)
    if (this._map) {
      this._canvas = this._map.getContainer();
      this._svg    = document.getElementById(svgId);
      if (!this._svg) {
        this._svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this._svg.id = svgId;
        this._canvas.appendChild(this._svg);
      }
      Object.assign(this._svg.style, {
        position:      'absolute',
        inset:         '0',
        width:         '100%',
        height:        '100%',
        pointerEvents: 'none',
        overflow:      'visible',
        zIndex:        '10',
      });
    } else {
      // Fallback : mode SVG standalone (sans Mapbox)
      this._svg = document.getElementById(svgId);
      if (!this._svg) return;
      const rect = this._svg.parentElement.getBoundingClientRect();
      this._svgW = Math.round(rect.width)  || 600;
      this._svgH = Math.round(rect.height) || 500;
      this._svg.setAttribute('width', this._svgW);
      this._svg.setAttribute('height', this._svgH);
      this._svg.setAttribute('viewBox', `0 0 ${this._svgW} ${this._svgH}`);
      this.SCALE = 5;
    }

    // ── 2. Charger la geometrie en WGS84 ─────────────────────────
    this._parcelGeo  = this._extractParcelGeo(this._session);
    this._streetsGeo = this._extractStreetsGeo(this._session);
    this._voisinsGeo = this._extractVoisinsGeo(this._session);

    // ── 3. Deriver l'espace local (pour EnvelopeGenerator) ───────
    this._parcelLocal = this._geoToLocal(this._parcelGeo);
    this._edgeTypes   = this._classifyEdges(this._session);

    // ── 4. Fly-to sur la parcelle ────────────────────────────────
    if (this._map && this._parcelGeo.length > 0) {
      const [clng, clat] = this._centroidGeo(this._parcelGeo);
      this._map.flyTo({ center: [clng, clat], zoom: 18, duration: 1200 });
    } else if (!this._map) {
      this._autoFit();
    }

    // ── 5. Injecter le contexte Mapbox (routes, batiments) ───────
    if (this._map) {
      this._injectMapboxContext();
    }

    // ── 6. Bind drag handlers ────────────────────────────────────
    this._boundDrag    = this._onDrag.bind(this);
    this._boundDragEnd = this._onDragEnd.bind(this);

    // ── 7. Generer enveloppes + render (APRES map idle si Mapbox) ─
    const _generateAndRender = async () => {
      this._proposals = await window.EnvelopeGenerator?.generate(
        this._session, this._parcelLocal, this._edgeTypes
      ) ?? [];
      this._proposals.forEach(p => {
        p.polygonGeo = this._localToGeo(p.polygon);
      });
      this._renderScorePanel();
      this._fullRedraw();
    };

    if (this._map) {
      // Attendre que Mapbox soit stable pour que map.project() soit fiable
      if (this._map.isStyleLoaded() && this._map.loaded()) {
        await _generateAndRender();
      } else {
        this._map.once('idle', () => _generateAndRender());
      }
      // Re-projeter le SVG sur chaque render Mapbox
      this._boundRender = () => this._fullRedraw();
      this._map.on('render', this._boundRender);
    } else {
      // Mode standalone
      await _generateAndRender();
      this._injectDefs();
      this._drawBackground();
      this._drawContext();
      this._drawParcel();
      this._drawReculs();
      this._drawNorthArrow();
      this._drawScale();
      if (this._proposals.length > 0) {
        this._renderProposal(0);
      }
    }

    // ── 8. Events interaction ────────────────────────────────────
    if (this._svg) {
      this._svg.style.pointerEvents = 'auto';
      this._bindEvents();
    }
  },

  // ── FULL REDRAW (Mapbox mode) ──────────────────────────────────
  _fullRedraw() {
    if (!this._svg) return;

    if (this._map) {
      const { width, height } = this._canvas.getBoundingClientRect();
      this._svg.setAttribute('width',   width);
      this._svg.setAttribute('height',  height);
      this._svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }

    this._svg.innerHTML = '';
    this._injectDefs();

    if (!this._map) {
      this._drawBackground();
    }

    this._drawContext();
    this._drawParcel();
    this._drawReculs();
    this._drawNorthArrow();
    this._drawScale();
    if (this._proposals.length > 0) {
      this._renderProposal(this._selected);
    }
  },

  // ── PROJECTION ─────────────────────────────────────────────────
  // Projeter [lng, lat] → {x, y} pixel SVG via Mapbox (ou fallback local)
  _project(lngLat) {
    if (this._map) {
      const pt = this._map.project(lngLat);
      return { x: pt.x, y: pt.y };
    }
    // Fallback mode standalone : local → SVG
    const local = this._geoToLocal([lngLat])[0];
    return this._localToSvgPt(local);
  },

  _projectAll(coords) {
    return coords.map(c => this._project(c));
  },

  // Projeter un point local {x,y} metres → pixel SVG (mode standalone)
  _localToSvgPt(p) {
    const W = this._svgW || 600;
    const H = this._svgH || 500;
    return {
      x: W / 2 + p.x * this.SCALE,
      y: H / 2 + p.y * this.SCALE,
    };
  },

  // Projeter tableau de points locaux → SVG pixels (mode standalone)
  _localToSvg(pts) {
    if (this._map) {
      // En mode Mapbox, convertir local→geo puis projeter
      const geo = this._localToGeo(pts);
      return this._projectAll(geo);
    }
    return pts.map(p => this._localToSvgPt(p));
  },

  _polyPoints(pts) {
    return pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  },

  // ── EXTRACTION GEOMETRIE WGS84 ────────────────────────────────
  _extractParcelGeo(session) {
    const geom = session.terrain?.parcelle_geojson;
    if (!geom) return this._defaultParcelGeo(session);
    const ring = geom.type === 'Polygon'
      ? geom.coordinates[0]
      : geom.type === 'MultiPolygon'
        ? geom.coordinates[0][0]
        : [];
    // Retourner [lng,lat], supprimer le point de fermeture GeoJSON
    return ring.length > 0 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  },

  _defaultParcelGeo(session) {
    const lng = parseFloat(session.terrain?.lng ?? 55.45);
    const lat = parseFloat(session.terrain?.lat ?? -21.15);
    const dLng = 0.00009;
    const dLat = 0.000067;
    return [
      [lng - dLng, lat - dLat],
      [lng + dLng, lat - dLat],
      [lng + dLng, lat + dLat],
      [lng - dLng, lat + dLat],
    ];
  },

  _extractStreetsGeo(session) {
    const rues = session.terrain?.rues_adjacentes ?? [];
    return rues.map(r => ({
      nom:    r.nom ?? '',
      type:   r.type ?? 'road',
      points: r.points ?? [],
    }));
  },

  _extractVoisinsGeo(session) {
    const voisins = session.terrain?.batiments_voisins ?? [];
    return voisins.map(v => ({
      pts:     v.pts ?? [],
      hauteur: v.hauteur ?? null,
      usage:   v.usage ?? 'batiment',
      label:   v.label ?? null,
    }));
  },

  // ── CONVERSION GEO ↔ LOCAL ─────────────────────────────────────
  // WGS84 [[lng,lat]] → local [{x,y}] metres, origine = centroide
  _geoToLocal(coords) {
    if (!coords.length) return [];
    const [clng, clat] = this._centroidGeo(this._parcelGeo.length ? this._parcelGeo : coords);
    const LNG = 111320 * Math.cos(clat * Math.PI / 180);
    const LAT = 111320;
    return coords.map(([lng, lat]) => ({
      x:  (lng - clng) * LNG,
      y: -(lat - clat) * LAT,  // Y inverse (SVG convention)
    }));
  },

  // Local [{x,y}] → WGS84 [[lng,lat]]
  _localToGeo(pts) {
    if (!this._parcelGeo.length) return [];
    const [clng, clat] = this._centroidGeo(this._parcelGeo);
    const LNG = 111320 * Math.cos(clat * Math.PI / 180);
    const LAT = 111320;
    return pts.map(p => [
      clng + p.x / LNG,
      clat - p.y / LAT,  // Y reinverse
    ]);
  },

  // Centroide geographique (moyenne simple — suffisant pour petites parcelles)
  _centroidGeo(coords) {
    if (!coords.length) return [0, 0];
    const n = coords.length;
    return [
      coords.reduce((s, c) => s + c[0], 0) / n,
      coords.reduce((s, c) => s + c[1], 0) / n,
    ];
  },

  // ── CONTEXTE MAPBOX ────────────────────────────────────────────
  _injectMapboxContext() {
    const map = this._map;
    if (!map) return;
    if (!map.isStyleLoaded()) {
      map.once('styledata', () => this._injectMapboxContext());
      return;
    }

    // ── Plan cadastral IGN (parcelles + bati + routes) ───────────
    this._injectCadastreLayer();

    const center = this._centroidGeo(this._parcelGeo);
    const centerPx = map.project(center);

    const bbox = [
      [centerPx.x - 200, centerPx.y - 200],
      [centerPx.x + 200, centerPx.y + 200],
    ];

    // Batiments voisins
    const buildingFeatures = [
      ...map.queryRenderedFeatures(bbox, { layers: ['building'] }),
      ...map.queryRenderedFeatures(bbox, { layers: ['building-extrusion', 'buildings'] }),
    ];

    const mapVoisins = buildingFeatures
      .filter(f => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon')
      .map(f => {
        const coords = f.geometry.type === 'Polygon'
          ? f.geometry.coordinates[0]
          : f.geometry.coordinates[0][0];
        return {
          pts:     coords,
          hauteur: f.properties?.height ?? f.properties?.render_height ?? null,
          usage:   f.properties?.type ?? 'batiment',
        };
      })
      .filter(v => !this._polygonsOverlap(v.pts, this._parcelGeo));

    // Routes
    const roadLayers = ['road-simple', 'road-primary', 'road-secondary',
                        'road-street', 'road-minor', 'road', 'roads'];
    const roadFeatures = map.queryRenderedFeatures(bbox, { layers: roadLayers });

    const mapStreets = roadFeatures
      .filter(f => f.geometry?.type === 'LineString')
      .map(f => ({
        nom:    f.properties?.name ?? f.properties?.ref ?? '',
        type:   f.properties?.class ?? f.properties?.type ?? 'road',
        points: f.geometry.coordinates,
      }))
      .slice(0, 20);

    // Merger avec les donnees session (session prioritaire si Mapbox vide)
    if (mapVoisins.length > 0) {
      this._voisinsGeo = mapVoisins;
    }
    if (mapStreets.length > 0) {
      this._streetsGeo = mapStreets;
    }
  },

  // ── COUCHE CADASTRALE IGN ──────────────────────────────────────
  // Source primaire : IGN Geoplateforme WMTS raster (plan cadastral officiel)
  // Gratuit sans cle API depuis 2023
  _injectCadastreLayer() {
    const map = this._map;
    if (!map) return;

    // Eviter d'ajouter la source en double
    if (map.getSource('cadastre-ign')) return;

    try {
      // ── Plan cadastral parcellaire express (WMTS raster) ───────
      map.addSource('cadastre-ign', {
        type: 'raster',
        tiles: [
          'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=CADASTRALPARCELS.PARCELLAIRE_EXPRESS&STYLE=PCI%20vecteur&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'
        ],
        tileSize: 256,
        minzoom: 14,
        maxzoom: 20,
        attribution: '&copy; IGN Geoplateforme — Plan cadastral',
      });

      // Inserer sous les labels Mapbox pour ne pas masquer le texte
      const firstSymbolLayer = this._findFirstSymbolLayer(map);
      map.addLayer({
        id: 'cadastre-ign-raster',
        type: 'raster',
        source: 'cadastre-ign',
        minzoom: 14,
        paint: {
          'raster-opacity': 0.55,
        },
      }, firstSymbolLayer);

      console.info('[EsquisseCanvas] Plan cadastral IGN charge (data.geopf.fr WMTS)');
    } catch (e) {
      console.warn('[EsquisseCanvas] Echec chargement cadastre IGN:', e);
    }
  },

  // Trouver la premiere couche de type symbol (pour inserer en dessous)
  _findFirstSymbolLayer(map) {
    const layers = map.getStyle()?.layers ?? [];
    for (const layer of layers) {
      if (layer.type === 'symbol') return layer.id;
    }
    return undefined;
  },

  // Toggle visibilite couche cadastrale
  toggleCadastre(visible) {
    // Mode Mapbox : toggle du layer raster
    const map = this._map;
    if (map) {
      const vis = visible ? 'visible' : 'none';
      if (map.getLayer('cadastre-ign-raster')) {
        map.setLayoutProperty('cadastre-ign-raster', 'visibility', vis);
      }
      return;
    }

    // Mode standalone : injecter/toggle une image WMS cadastre derriere le SVG
    let img = document.getElementById('cadastre-standalone-img');
    if (img) {
      img.style.display = visible ? 'block' : 'none';
      return;
    }
    if (!visible) return;

    // Construire la bbox WGS84 (EPSG:4326) depuis la parcelle
    if (!this._parcelGeo.length) { console.warn('[EsquisseCanvas] Pas de parcelle pour le cadastre'); return; }
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lng, lat] of this._parcelGeo) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    // Elargir de 40% pour voir le contexte autour
    const padLng = (maxLng - minLng) * 0.4 || 0.0003;
    const padLat = (maxLat - minLat) * 0.4 || 0.0003;
    minLng -= padLng; maxLng += padLng;
    minLat -= padLat; maxLat += padLat;

    // Calculer la correspondance entre la bbox WGS84 et les pixels SVG standalone
    // Local → SVG : svgX = W/2 + local.x * SCALE,  svgY = H/2 + local.y * SCALE
    // Local → Geo : lng = clng + x / LNG_SCALE,     lat = clat - y / LAT_SCALE
    const W = this._svgW || 600;
    const H = this._svgH || 500;
    const SCALE = this.SCALE || 5;
    const [clng, clat] = this._centroidGeo(this._parcelGeo);
    const LNG_SCALE = 111320 * Math.cos(clat * Math.PI / 180);
    const LAT_SCALE = 111320;

    // Convertir la bbox GPS en pixels SVG
    const svgMinX = W / 2 + (minLng - clng) * LNG_SCALE * SCALE;
    const svgMaxX = W / 2 + (maxLng - clng) * LNG_SCALE * SCALE;
    // Y inverse : lat+ = local y- = svg y-
    const svgMinY = H / 2 - (maxLat - clat) * LAT_SCALE * SCALE;
    const svgMaxY = H / 2 - (minLat - clat) * LAT_SCALE * SCALE;
    const imgW = svgMaxX - svgMinX;
    const imgH = svgMaxY - svgMinY;

    // WMS GetMap — IGN Geoplateforme cadastre (EPSG:3857)
    const toMerc = (lng, lat) => {
      const x = lng * 20037508.34 / 180;
      const latRad = lat * Math.PI / 180;
      const y = Math.log(Math.tan(Math.PI / 4 + latRad / 2)) * 20037508.34 / Math.PI;
      return [x, y];
    };
    const [mMinX, mMinY] = toMerc(minLng, minLat);
    const [mMaxX, mMaxY] = toMerc(maxLng, maxLat);
    const pxW = Math.round(Math.max(imgW * 2, 512));  // haute res
    const pxH = Math.round(Math.max(imgH * 2, 512));
    const url = `https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap`
      + `&LAYERS=CADASTRALPARCELS.PARCELLAIRE_EXPRESS`
      + `&CRS=EPSG:3857&BBOX=${mMinX},${mMinY},${mMaxX},${mMaxY}`
      + `&WIDTH=${pxW}&HEIGHT=${pxH}&FORMAT=image/png&STYLES=&TRANSPARENT=true`;

    console.info('[EsquisseCanvas] Cadastre WMS URL:', url);

    img = document.createElement('img');
    img.id = 'cadastre-standalone-img';
    Object.assign(img.style, {
      position: 'absolute',
      left:   `${svgMinX}px`,
      top:    `${svgMinY}px`,
      width:  `${imgW}px`,
      height: `${imgH}px`,
      opacity: '0.55', zIndex: '0',
      pointerEvents: 'none',
    });

    const wrap = this._svg?.parentElement;
    if (wrap) {
      wrap.style.position = 'relative';
      wrap.insertBefore(img, wrap.firstChild);
    }

    img.onload = () => {
      console.info('[EsquisseCanvas] Cadastre WMS charge OK');
    };
    img.onerror = () => {
      console.warn('[EsquisseCanvas] Echec WMS cadastre');
      img.style.display = 'none';
      window.TerlabToast?.show('Plan cadastral indisponible', 'warning');
    };
    img.src = url;
  },

  // Test simpliste de chevauchement (centroide de A dans B)
  _polygonsOverlap(ptsA, ptsB) {
    if (!ptsA?.length || !ptsB?.length) return false;
    const cA = this._centroidGeo(ptsA);
    // Point-in-polygon ray casting sur ptsB
    let inside = false;
    for (let i = 0, j = ptsB.length - 1; i < ptsB.length; j = i++) {
      const yi = ptsB[i][1], yj = ptsB[j][1];
      if ((yi > cA[1]) !== (yj > cA[1]) &&
          cA[0] < (ptsB[j][0] - ptsB[i][0]) * (cA[1] - yi) / (yj - yi) + ptsB[i][0]) {
        inside = !inside;
      }
    }
    return inside;
  },

  // ── DESSIN CONTEXTE ────────────────────────────────────────────
  _drawContext() {
    const g = this._el('g', { id: 'ctx-layer' });

    // Routes
    for (const rue of this._streetsGeo) {
      if (!rue.points?.length) continue;
      const pts = this._map ? this._projectAll(rue.points) : this._localToSvg(
        Array.isArray(rue.points[0]) ? this._geoToLocal(rue.points) : rue.points
      );
      const strokeW = rue.type === 'primary' ? 10 : rue.type === 'secondary' ? 7 : 5;
      this._el('polyline', {
        points: this._polyPoints(pts),
        fill: 'none', stroke: '#c8d0d8', 'stroke-width': strokeW,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      }, null, g);
      this._el('polyline', {
        points: this._polyPoints(pts),
        fill: 'none', stroke: '#e8ecf0', 'stroke-width': 1,
        'stroke-dasharray': '8 6', 'stroke-linecap': 'round',
      }, null, g);
      if (rue.nom && pts.length >= 2) {
        const mid = pts[Math.floor(pts.length / 2)];
        this._label(mid.x, mid.y - strokeW / 2 - 3, rue.nom,
          { size: 8, color: '#889aaa', anchor: 'middle' }, null, g);
      }
    }

    // Batiments voisins
    for (const v of this._voisinsGeo) {
      if (!v.pts?.length) continue;
      const pts = this._map ? this._projectAll(v.pts) : this._localToSvg(
        Array.isArray(v.pts[0]) ? this._geoToLocal(v.pts) : v.pts
      );
      this._el('polygon', {
        points: this._polyPoints(pts),
        fill: 'url(#hatch-batiment)', stroke: '#8a9aaa',
        'stroke-width': 1.5, opacity: 0.8,
      }, null, g);
      if (v.hauteur) {
        const c = this._centroidPx(pts);
        this._label(c.x, c.y, `H${v.hauteur}m`,
          { size: 7, color: '#667788' }, null, g);
      }
      if (v.label) {
        const c = this._centroidPx(pts);
        this._label(c.x, c.y + (v.hauteur ? 10 : 0), v.label,
          { size: 7, color: '#7a8a9a' }, null, g);
      }
    }

    // Bati existant sur la parcelle
    const existingBuildings = this._session?.phases?.[5]?.data?.batiments_parcelle
      ?? this._session?.terrain?.batiments_parcelle ?? [];
    existingBuildings.forEach((b, i) => {
      let localPts;
      if (b.geojson) {
        localPts = this._geojsonToLocal(b.geojson);
      } else if (b.pts) {
        localPts = b.pts;
      } else return;
      if (localPts.length < 3) return;
      const svgPts = this._localToSvg(localPts);
      this._el('polygon', {
        points: this._polyPoints(svgPts),
        fill: 'rgba(100,116,139,0.25)', stroke: '#475569', 'stroke-width': 1.5,
        'stroke-dasharray': '4 2',
      }, `bati-existant-${i}`, g);
      const c = this._centroidPx(svgPts);
      this._label(c.x, c.y, 'Bati existant', { size: 10, color: '#475569', bold: true }, null, g);
      if (b.hauteur) {
        this._label(c.x, c.y + 12, `H~${b.hauteur}m`, { size: 9, color: '#64748b' }, null, g);
      }
    });

    // Bande de recul voie
    this._drawVoieBuffer(g);
  },

  // Bande de recul visuelle entre la voie et la limite de construction
  _drawVoieBuffer(g) {
    const p4 = this._session?.phases?.[4]?.data ?? {};
    const rVoie = parseFloat(p4.recul_voie_m ?? p4.recul_voie_principale_m ?? p4.recul_avant_m ?? 0);
    if (!rVoie) return;

    const voieIdx = this._edgeTypes.indexOf('voie');
    if (voieIdx < 0) return;

    const n = this._parcelGeo.length;
    const j = (voieIdx + 1) % n;
    const a = this._parcelGeo[voieIdx];
    const b = this._parcelGeo[j];

    const pa = this._project(a);
    const pb = this._project(b);

    const dx = pb.x - pa.x, dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;

    // Convertir rVoie metres → pixels
    const centerGeo = this._centroidGeo(this._parcelGeo);
    const c1 = this._project(centerGeo);
    const c2 = this._project([centerGeo[0] + rVoie / (111320 * Math.cos(centerGeo[1] * Math.PI / 180)), centerGeo[1]]);
    const rVoiePx = Math.abs(c2.x - c1.x);

    const nx = -(dy / len), ny = dx / len;
    const pts = [
      pa, pb,
      { x: pb.x + nx * rVoiePx, y: pb.y + ny * rVoiePx },
      { x: pa.x + nx * rVoiePx, y: pa.y + ny * rVoiePx },
    ];
    this._el('polygon', {
      points: this._polyPoints(pts),
      fill: 'url(#hatch-voie)', opacity: 0.35,
    }, null, g);
  },

  _centroidPx(pts) {
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
  },

  // Convertir un GeoJSON polygon en coordonnees locales (metres)
  _geojsonToLocal(geojson) {
    const coords = geojson.type === 'Polygon'
      ? geojson.coordinates[0]
      : geojson.coordinates?.[0]?.[0] ?? [];
    if (coords.length < 3) return [];
    return this._geoToLocal(coords);
  },

  // ── DESSIN PARCELLE ────────────────────────────────────────────
  _drawParcel() {
    const g   = this._el('g', { id: 'parcel-layer' });
    const pts = this._map ? this._projectAll(this._parcelGeo) : this._localToSvg(this._parcelLocal);

    // Fond parcelle
    this._el('polygon', {
      points: this._polyPoints(pts),
      fill: 'rgba(232, 237, 240, 0.45)',
      stroke: '#1e3a5f', 'stroke-width': 2.5, 'stroke-linejoin': 'miter',
    }, 'parcelle-shape', g);

    // Label surface centroide
    const c    = this._centroidPx(pts);
    const surf = this._session?.terrain?.contenance_m2 ?? '--';
    this._label(c.x, c.y, `${surf} m\u00B2`,
      { size: 16, color: '#2a4a6b', bold: true }, 'lbl-surf', g);

    // Labels par arete
    this._drawEdgeLabels(pts, g);
  },

  _drawEdgeLabels(svgPts, g) {
    const n = svgPts.length;
    if (n < 3) return;
    const c  = this._centroidPx(svgPts);
    const p4 = this._session?.phases?.[4]?.data ?? {};

    for (let i = 0; i < n; i++) {
      const j  = (i + 1) % n;
      const p1 = svgPts[i], p2 = svgPts[j];
      const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (len < 20) continue;

      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;

      // Offset vers l'exterieur de la parcelle
      const dx = mx - c.x, dy = my - c.y;
      const dist = Math.hypot(dx, dy) || 1;
      const offX = dx / dist * 16, offY = dy / dist * 16;

      // Longueur en metres
      let lenM;
      if (this._parcelGeo[i] && this._parcelGeo[j]) {
        const geo1 = this._parcelGeo[i];
        const geo2 = this._parcelGeo[j];
        const LNG  = 111320 * Math.cos(geo1[1] * Math.PI / 180);
        lenM = Math.hypot(
          (geo2[0] - geo1[0]) * LNG,
          (geo2[1] - geo1[1]) * 111320
        ).toFixed(1);
      } else {
        lenM = (len / (this.SCALE || 5)).toFixed(1);
      }

      // Type et recul
      const type = this._edgeTypes[i] ?? 'lateral';
      let label, color;
      if (type === 'voie') {
        const rv = p4.recul_voie_m ?? p4.recul_voie_principale_m ?? p4.recul_avant_m ?? '--';
        label = `Voie (${rv}m)`;
        color = '#e87c3e';
      } else if (type === 'fond') {
        label = `Fond (${p4.recul_fond_m ?? '--'}m)`;
        color = '#8b5cf6';
      } else {
        const rl = p4.recul_lat_m ?? p4.recul_limite_sep_m;
        const isAcc = parseFloat(rl) === 0;
        label = isAcc ? 'Accroche (0m)' : `Separ. (${rl ?? '--'}m)`;
        color = isAcc ? '#0ea5e9' : '#6b7280';
      }

      this._label(mx + offX, my + offY - 7, `${lenM}m`,
        { size: 11, color: '#1e3a5f', anchor: 'middle', bold: true }, null, g);
      this._label(mx + offX, my + offY + 8, label,
        { size: 9.5, color, anchor: 'middle' }, null, g);
    }
  },

  // ── ZONE DE RECULS ─────────────────────────────────────────────
  _drawReculs() {
    const p4 = this._session?.phases?.[4]?.data ?? {};
    const reculs = {
      voie:    parseFloat(p4.recul_voie_m ?? p4.recul_voie_principale_m ?? p4.recul_avant_m ?? 3) || 3,
      fond:    parseFloat(p4.recul_fond_m ?? 3) || 3,
      lateral: parseFloat(p4.recul_lat_m ?? p4.recul_limite_sep_m ?? 0) || 0,
    };

    const constructibleLocal = this._offsetPolygonFixed(this._parcelLocal, reculs);
    if (!constructibleLocal.length) {
      window.TerlabToast?.show('Zone constructible nulle avec ces reculs', 'warning');
      return;
    }

    // Convertir en geo puis projeter en pixels
    const constructibleGeo = this._localToGeo(constructibleLocal);
    const pts = this._map ? this._projectAll(constructibleGeo) : this._localToSvg(constructibleLocal);

    const g = this._el('g', { id: 'reculs-layer' });

    // Zone constructible
    this._el('polygon', {
      points: this._polyPoints(pts),
      fill: 'rgba(220, 240, 228, 0.55)',
      stroke: '#22c55e', 'stroke-width': 1.5, 'stroke-dasharray': '6 4',
    }, 'zone-constructible', g);

    // Label surface constructible
    const surf = this._polygonAreaLocal(constructibleLocal).toFixed(0);
    const cpt  = this._centroidPx(pts);
    this._label(cpt.x, cpt.y + 30, `Zone constructible ${surf} m\u00B2`,
      { size: 12, color: '#166534', bold: true }, 'lbl-constructible', g);

    // Cotations reculs
    const parcelPts = this._map ? this._projectAll(this._parcelGeo) : this._localToSvg(this._parcelLocal);
    this._drawReculCotes(parcelPts, pts, g);
  },

  // Cotations de recul — pour chaque arete parcelle, projeter le milieu
  // perpendiculairement sur le polygone constructible (pas de correspondance 1:1)
  _drawReculCotes(parcelPts, constrPts, g) {
    const nP = parcelPts.length;
    if (nP < 3 || constrPts.length < 3) return;

    const p4 = this._session?.phases?.[4]?.data ?? {};
    const centroidC = this._centroidPx(constrPts);

    for (let i = 0; i < nP; i++) {
      const j    = (i + 1) % nP;
      const midP = { x: (parcelPts[i].x + parcelPts[j].x) / 2,
                     y: (parcelPts[i].y + parcelPts[j].y) / 2 };

      // Type et valeur de recul pour cette arete
      const type = this._edgeTypes[i] ?? 'lateral';
      const rM   = type === 'voie'   ? (p4.recul_voie_m ?? p4.recul_voie_principale_m ?? p4.recul_avant_m ?? '?') :
                   type === 'fond'   ? (p4.recul_fond_m ?? '?') :
                                      (p4.recul_lat_m ?? p4.recul_limite_sep_m ?? '0');
      if (parseFloat(rM) <= 0) continue;

      // Trouver le point le plus proche sur le polygone constructible
      let bestDist = Infinity, bestPt = null;
      for (let k = 0; k < constrPts.length; k++) {
        const l  = (k + 1) % constrPts.length;
        const cp = this._closestPointOnSegment(midP, constrPts[k], constrPts[l]);
        const d  = Math.hypot(cp.x - midP.x, cp.y - midP.y);
        if (d < bestDist) { bestDist = d; bestPt = cp; }
      }

      if (!bestPt || bestDist < 4 || bestDist > 300) continue;

      // Ligne cotation
      this._el('line', {
        x1: midP.x, y1: midP.y, x2: bestPt.x, y2: bestPt.y,
        stroke: '#f59e0b', 'stroke-width': 1, 'stroke-dasharray': '3 3',
      }, null, g);

      // Label
      const mx = (midP.x + bestPt.x) / 2, my = (midP.y + bestPt.y) / 2;
      this._label(mx, my, `${rM}m`, { size: 10, color: '#d97706', anchor: 'middle', bold: true }, null, g);
    }
  },

  // Point le plus proche sur un segment [a, b] depuis un point p
  _closestPointOnSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.01) return { x: a.x, y: a.y };
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return { x: a.x + t * dx, y: a.y + t * dy };
  },

  // ── UTILITAIRES GEOMETRIQUES CORRIGES ──────────────────────────

  // Shoelace area (signee, en espace local metres)
  _signedArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return a / 2;
  },

  _polygonAreaLocal(pts) {
    return Math.abs(this._signedArea(pts));
  },

  // CW dans espace local (Y inverse SVG) = sens geometrique correct pour l'offset interieur
  _ensureCW(pts) {
    return this._signedArea(pts) > 0 ? pts : [...pts].reverse();
  },

  // Offset interieur du polygone — chaque arete recule selon son type
  // CORRIGE : normale interieure en espace Y-inverse + clamp angles aigus
  _offsetPolygonFixed(pts, reculs) {
    const n = pts.length;
    if (n < 3) return [];

    const cw = this._ensureCW(pts);

    const offsetEdges = [];
    for (let i = 0; i < n; i++) {
      const j  = (i + 1) % n;
      const dx = cw[j].x - cw[i].x;
      const dy = cw[j].y - cw[i].y;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) {
        // Arete degeneree : copier l'arete precedente pour garder le meme nombre
        if (offsetEdges.length > 0) {
          offsetEdges.push({ ...offsetEdges[offsetEdges.length - 1], orig: i });
        }
        continue;
      }

      // Normale interieure en espace Y-inverse pour polygon CW : (+dy/len, -dx/len)
      const nx =  dy / len;
      const ny = -dx / len;

      const edgeRecul = this._getEdgeRecul(cw[i], cw[j], reculs);

      offsetEdges.push({
        p1: { x: cw[i].x + nx * edgeRecul, y: cw[i].y + ny * edgeRecul },
        p2: { x: cw[j].x + nx * edgeRecul, y: cw[j].y + ny * edgeRecul },
        orig: i,
      });
    }

    if (offsetEdges.length < 3) return [];

    // Seuil de distance max pour une intersection valide
    // (au-dela, l'angle est trop aigu et l'intersection diverge)
    const bx = this._bboxLocal(cw);
    const maxDim = Math.max(bx.maxX - bx.minX, bx.maxY - bx.minY);
    const maxIntersectDist = maxDim * 0.3;

    // Intersections successives — rejeter les points aberrants (angles aigus)
    const result = [];
    for (let i = 0; i < offsetEdges.length; i++) {
      const j  = (i + 1) % offsetEdges.length;
      const pt = this._intersect(offsetEdges[i].p1, offsetEdges[i].p2, offsetEdges[j].p1, offsetEdges[j].p2);
      if (pt && isFinite(pt.x) && isFinite(pt.y)) {
        // Verifier que l'intersection n'est pas aberrante
        // Le point devrait etre proche du sommet original correspondant
        const origIdx = (offsetEdges[i].orig + 1) % n;
        const origPt = cw[origIdx];
        const dist = Math.hypot(pt.x - origPt.x, pt.y - origPt.y);

        if (dist < maxIntersectDist) {
          result.push(pt);
        } else {
          // Angle trop aigu : utiliser le milieu des points offset les plus proches
          result.push({
            x: (offsetEdges[i].p2.x + offsetEdges[j].p1.x) / 2,
            y: (offsetEdges[i].p2.y + offsetEdges[j].p1.y) / 2,
          });
        }
      }
    }

    if (result.length < 3 || this._polygonAreaLocal(result) < 1) return [];
    return result;
  },

  // Centroide area-weighted (correct pour polygones non-convexes)
  _centroidLocal(pts) {
    const A = this._signedArea(pts);
    if (Math.abs(A) < 0.001) {
      return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
               y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    }
    let cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const j   = (i + 1) % pts.length;
      const fac = pts[i].x * pts[j].y - pts[j].x * pts[i].y;
      cx += (pts[i].x + pts[j].x) * fac;
      cy += (pts[i].y + pts[j].y) * fac;
    }
    return { x: cx / (6 * A), y: cy / (6 * A) };
  },

  // ── CLASSIFICATION DES LIMITES (CORRIGEE) ──────────────────────
  // CORRIGE : dans l'espace local Y-inverse, y_max = sud geographique
  _classifyEdges(session) {
    const n = this._parcelLocal?.length ?? 0;
    if (n < 3) return new Array(n).fill('lateral');

    const terrain = session.terrain ?? {};
    const rues    = terrain.rues_adjacentes ?? [];
    const types   = new Array(n).fill('lateral');

    // Methode 1 : matching avec les rues connues
    if (rues.length > 0) {
      for (let i = 0; i < n; i++) {
        const j  = (i + 1) % n;
        const em = { x: (this._parcelLocal[i].x + this._parcelLocal[j].x) / 2,
                     y: (this._parcelLocal[i].y + this._parcelLocal[j].y) / 2 };
        for (const rue of rues) {
          const ruePts = rue.points ?? [];
          if (!ruePts.length) continue;
          // Convertir en local si [lng,lat]
          const rueLocal = Array.isArray(ruePts[0]) && ruePts[0].length === 2 && Math.abs(ruePts[0][0]) > 50
            ? this._geoToLocal(ruePts)
            : ruePts;
          for (let k = 0; k < rueLocal.length - 1; k++) {
            if (this._distPointToSegment(em, rueLocal[k], rueLocal[k + 1]) < 8) {
              types[i] = 'voie';
              break;
            }
          }
        }
      }
    }

    // Methode 2 : heuristique geometrique (si pas de rues connues)
    if (!types.includes('voie')) {
      const mids = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        mids.push({
          idx:  i,
          midY: (this._parcelLocal[i].y + this._parcelLocal[j].y) / 2,
          len:  Math.hypot(this._parcelLocal[j].x - this._parcelLocal[i].x,
                           this._parcelLocal[j].y - this._parcelLocal[i].y),
        });
      }
      // CORRIGE : y max = le plus au sud (Y inverse)
      const sortedS = [...mids].sort((a, b) => b.midY - a.midY);
      let voieCount = 0;
      for (const s of sortedS) {
        if (voieCount >= 1) break;
        if (s.len > 3) { types[s.idx] = 'voie'; voieCount++; }
      }
    }

    // Fond = arete opposee a la voie
    if (!types.includes('fond')) {
      const voieIdx = types.indexOf('voie');
      if (voieIdx >= 0) {
        const oppositeIdx = (voieIdx + Math.floor(n / 2)) % n;
        if (types[oppositeIdx] === 'lateral') types[oppositeIdx] = 'fond';
      }
    }

    return types;
  },

  // Distance point → segment
  _distPointToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.01) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  },

  // Determiner le recul d'une arete selon la classification des limites
  _getEdgeRecul(p1, p2, reculs) {
    if (this._edgeTypes?.length && this._parcelLocal?.length) {
      const n = this._parcelLocal.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const eMid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const pMid = {
          x: (this._parcelLocal[i].x + this._parcelLocal[j].x) / 2,
          y: (this._parcelLocal[i].y + this._parcelLocal[j].y) / 2,
        };
        if (Math.hypot(eMid.x - pMid.x, eMid.y - pMid.y) < 0.5) {
          const type = this._edgeTypes[i];
          if (type === 'voie') return reculs.voie;
          if (type === 'fond') return reculs.fond;
          return reculs.lateral;
        }
      }
    }
    return reculs.lateral;
  },

  // ── AFFICHAGE PROPOSITION ──────────────────────────────────────
  _renderProposal(idx) {
    this._svg.querySelectorAll('.proposal-group').forEach(el => el.remove());
    const prop = this._proposals[idx];
    if (!prop) return;
    this._selected = idx;

    const pts = prop.polygonGeo?.length
      ? (this._map ? this._projectAll(prop.polygonGeo) : this._localToSvg(prop.polygon))
      : this._localToSvg(prop.polygon);
    const g = this._el('g', { class: 'proposal-group', id: 'active-proposal' });

    // Corps de l'enveloppe
    this._el('polygon', {
      points: this._polyPoints(pts),
      fill: 'rgba(154, 120, 32, 0.12)',
      stroke: '#9a7820', 'stroke-width': 2, 'stroke-linejoin': 'round',
    }, null, g);

    // Hauteur
    this._drawHeightIndicator(pts, prop, g);

    // Aretes editables
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      this._el('line', {
        x1: pts[i].x, y1: pts[i].y, x2: pts[j].x, y2: pts[j].y,
        stroke: 'rgba(154,120,32,0.15)', 'stroke-width': 12,
        'stroke-linecap': 'round',
        cursor: 'grab', class: 'edit-edge',
        'data-edge': i, 'data-proposal': idx,
      }, `edge-${idx}-${i}`, g);
    }

    // Noeuds editables
    pts.forEach((pt, i) => {
      this._el('circle', {
        cx: pt.x, cy: pt.y, r: 14,
        fill: 'transparent', stroke: 'none',
        cursor: 'move', class: 'edit-node-hit',
        'data-node': i, 'data-proposal': idx,
      }, null, g);
      this._el('circle', {
        cx: pt.x, cy: pt.y, r: 7,
        fill: '#9a7820', stroke: '#fff', 'stroke-width': 2.5,
        cursor: 'move', class: 'edit-node',
        'data-node': i, 'data-proposal': idx,
        'pointer-events': 'none',
      }, `node-${idx}-${i}`, g);
    });

    // Cotations internes
    this._drawProposalDims(pts, prop, g);

    // Label famille + surface
    const c = this._centroidPx(pts);
    this._label(c.x, c.y - 8, prop.family, { size: 9, color: '#9a7820', bold: true }, null, g);
    this._label(c.x, c.y + 8, `${prop.surface.toFixed(0)} m\u00B2 · H+${prop.scoreData?.hauteur_egout ?? '--'}m`,
      { size: 8, color: '#6b5c3e' }, null, g);

    // Badge score
    this._drawScoreBadge(pts, prop, g);

    // Indicateur vue
    if (prop.scoreData?.vueScore > 0.6) {
      this._drawViewIndicator(pts, prop, g);
    }

    // Coloration RTAA des facades
    this._renderRTAAFacades(prop.polygon, g);

    // Jardins recommandes BPF
    this._renderGardenHint(prop);
  },

  _renderRTAAFacades(polygon, g) {
    const report = window.SessionManager?.getRTAAReport();
    if (!report?.ok) return;

    const facades = window.RTAAAnalyzer?.getFacadesRTAA(polygon, this._session);
    const baies = report.baies ?? [];

    for (const f of facades) {
      const facadeBaies = baies.filter(b => b.orientation === f.cardinal);
      let color = '#22c55e';
      if (facadeBaies.length > 0) {
        const nonConformes = facadeBaies.filter(b => b.conforme === false);
        if (nonConformes.length > 0) color = '#ef4444';
        else if (facadeBaies.some(b => b.conforme === null)) color = '#f59e0b';
      }

      const p1 = this._localToSvg([f.p1])[0];
      const p2 = this._localToSvg([f.p2])[0];
      if (!p1 || !p2) continue;

      this._el('line', {
        x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
        stroke: color, 'stroke-width': 4, 'stroke-linecap': 'round',
        opacity: 0.7, class: 'rtaa-facade',
        'data-cardinal': f.cardinal,
      }, null, g);
    }
  },

  _drawHeightIndicator(pts, prop, g) {
    const plu = this._session?.phases?.[4]?.data ?? {};
    const hEgout   = plu.hauteur_egout_m;
    const hFaitage = plu.hauteur_faitage_m;
    const niveaux  = prop.scoreData?.niveaux ?? plu.niveaux_max;

    if (!hEgout && !hFaitage && !niveaux) return;

    const bbox = this._bboxPx(pts);
    const x = bbox.minX - 6;
    const y = bbox.minY;

    const lines = [];
    if (hEgout)   lines.push(`H eg. ${hEgout}m`);
    if (hFaitage) lines.push(`H fait. ${hFaitage}m`);
    if (niveaux)  lines.push(`R+${niveaux}`);

    lines.forEach((txt, i) => {
      this._label(x, y + i * 10, txt, { size: 7, color: '#f59e0b', anchor: 'end' }, null, g);
    });
  },

  _drawScoreBadge(pts, prop, g) {
    const bbox = this._bboxPx(pts);
    const x = bbox.maxX + 4;
    const y = bbox.minY;
    const s = prop.score;
    const col = s > 0.75 ? '#22c55e' : s > 0.5 ? '#f59e0b' : '#ef4444';

    this._el('rect', { x, y, width: 32, height: 18, rx: 3, fill: col, opacity: 0.9 }, null, g);
    this._el('text', {
      x: x + 16, y: y + 12, 'text-anchor': 'middle',
      'font-size': 12, fill: '#fff', 'font-weight': 700,
      'font-family': 'var(--font-mono)',
    }, null, g).textContent = `${Math.round(s * 100)}`;
  },

  _drawViewIndicator(pts, prop, g) {
    const bbox = this._bboxPx(pts);
    const label = prop.scoreData?.viewType === 'mer' ? '\u{1F30A}' : '\u26F0';

    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = bbox.minY - 16;

    this._el('circle', { cx, cy, r: 10, fill: 'rgba(99,102,241,0.2)', stroke: '#6366f1', 'stroke-width': 1 }, null, g);
    this._el('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', 'font-size': 10 }, null, g).textContent = label;
  },

  _drawProposalDims(pts, prop, g) {
    // Calculer L et l en metres depuis le polygon local
    const poly = prop.polygon;
    if (!poly?.length) return;

    // Arete la plus longue = L
    let maxLen = 0, maxIdx = 0;
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      const l = Math.hypot(poly[j].x - poly[i].x, poly[j].y - poly[i].y);
      if (l > maxLen) { maxLen = l; maxIdx = i; }
    }
    const L = maxLen;

    // Largeur perpendiculaire (min width approx)
    const bbox = this._bboxLocal(poly);
    const W = bbox.maxX - bbox.minX;
    const H = bbox.maxY - bbox.minY;
    const l = Math.min(W, H);

    const bboxPx = this._bboxPx(pts);
    this._label(
      (bboxPx.minX + bboxPx.maxX) / 2, bboxPx.maxY + 14,
      `${L.toFixed(1)}m`, { size: 11, color: '#374151', bold: true }, null, g
    );
    this._label(
      bboxPx.maxX + 16, (bboxPx.minY + bboxPx.maxY) / 2,
      `${l.toFixed(1)}m`, { size: 11, color: '#374151', bold: true }, null, g
    );
  },

  // ── FLECHE NORD ────────────────────────────────────────────────
  _drawNorthArrow() {
    let W, x;
    if (this._map) {
      const r = this._canvas.getBoundingClientRect();
      W = r.width;
    } else {
      W = this._svgW || 600;
    }
    x = W - 45;
    const g = this._el('g', { transform: `translate(${x}, 45)` }, 'north');
    this._el('polygon', { points: '0,-20 6,5 0,2 -6,5', fill: '#1e3a5f' }, null, g);
    this._el('polygon', { points: '0,20 6,-5 0,-2 -6,-5', fill: '#c8d4dc', stroke: '#1e3a5f', 'stroke-width': 0.5 }, null, g);
    this._el('circle', { cx: 0, cy: 0, r: 22, fill: 'none', stroke: '#1e3a5f', 'stroke-width': 1 }, null, g);
    this._el('text', { x: 0, y: -28, 'text-anchor': 'middle', 'font-size': 13, 'font-family': 'var(--font-mono)', fill: '#1e3a5f', 'font-weight': 700 }, null, g).textContent = 'N';
  },

  _drawScale() {
    let H;
    if (this._map) {
      const r = this._canvas.getBoundingClientRect();
      H = r.height;
    } else {
      H = this._svgH || 500;
    }
    const g = this._el('g', { transform: `translate(12, ${H - 20})` }, 'scale-bar');

    // Calculer la barre d'echelle (10m en pixels)
    let barW;
    if (this._map && this._parcelGeo.length) {
      const c = this._centroidGeo(this._parcelGeo);
      const c1 = this._project(c);
      const dLng = 10 / (111320 * Math.cos(c[1] * Math.PI / 180));
      const c2 = this._project([c[0] + dLng, c[1]]);
      barW = Math.abs(c2.x - c1.x);
    } else {
      barW = (this.SCALE || 5) * 10;
    }

    const half = barW / 2;
    this._el('rect', { x: 0, y: -6, width: half, height: 6, fill: '#1e3a5f' }, null, g);
    this._el('rect', { x: half, y: -6, width: half, height: 6, fill: '#fff', stroke: '#1e3a5f', 'stroke-width': 0.5 }, null, g);
    this._el('text', { x: half, y: -12, 'text-anchor': 'middle', 'font-size': 11, fill: '#1e3a5f' }, null, g).textContent = '5m';
    this._el('text', { x: barW, y: -12, 'text-anchor': 'middle', 'font-size': 11, fill: '#1e3a5f' }, null, g).textContent = '10m';
  },

  // ── PANEL SCORE ────────────────────────────────────────────────
  _renderScorePanel() {
    const panel = document.getElementById('p07-score-panel')
               ?? document.getElementById('p11-score-panel');
    if (!panel) return;

    panel.innerHTML = this._proposals.map((p, i) => {
      const col = p.score > 0.75 ? '#22c55e' : p.score > 0.5 ? '#f59e0b' : '#ef4444';
      const isSelected = i === this._selected;
      return `
        <div class="p11-proposal-card ${isSelected ? 'selected' : ''}"
             onclick="EsquisseCanvas.selectProposal(${i})"
             style="border-color:${isSelected ? col : 'transparent'}">
          <div class="p11-card-header">
            <span class="p11-family">${p.family}</span>
            <span class="p11-score" style="color:${col}">${Math.round(p.score * 100)}/100</span>
          </div>
          <div class="p11-card-dims">${p.surface.toFixed(0)} m\u00B2 · ${p.polygon.length} cotes</div>
          <div class="p11-card-scores">
            ${this._scoreBars(p.scoreData)}
          </div>
          <div class="p11-card-strategy">${p.strategyLabel}</div>
        </div>
      `;
    }).join('');
  },

  _scoreBars(sd) {
    if (!sd) return '';
    const items = [
      { label: 'Orientation', val: sd.orientationScore, color: '#f59e0b' },
      { label: 'Vue',         val: sd.vueScore,         color: '#6366f1' },
      { label: 'PLU',         val: sd.pluScore,         color: '#22c55e' },
      { label: 'Jardin',      val: sd.gardenScore,      color: '#2dc89a' },
      { label: 'RTAA',        val: sd.rtaaScore ?? 0,   color: '#ef4444' },
    ];
    return items.map(it => `
      <div class="p11-score-row">
        <span>${it.label}</span>
        <div class="p11-score-bar">
          <div style="width:${Math.round(it.val * 100)}%;background:${it.color}"></div>
        </div>
        <span>${Math.round(it.val * 100)}</span>
      </div>
    `).join('');
  },

  _renderGardenHint(prop) {
    const hint = document.getElementById('p11-garden-hint');
    if (!hint || !window.BpfGardenAdvisor) return;
    const advice = window.BpfGardenAdvisor.suggest(
      this._session?.terrain?.zone_climatique,
      this._session?.terrain?.altitude_ngr,
      prop.family
    );
    if (!advice) return;
    hint.innerHTML = `
      <div class="p11-garden-preset">${advice.preset}</div>
      <div class="p11-garden-species">${advice.species?.slice(0, 3).join(' · ') ?? ''}</div>
    `;
  },

  // ── EVENEMENTS ─────────────────────────────────────────────────
  _bindEvents() {
    // Drag des noeuds
    this._svg.addEventListener('mousedown', e => {
      const rect = this._canvas?.getBoundingClientRect() ?? { left: 0, top: 0 };
      if (e.target.classList.contains('edit-node-hit') || e.target.classList.contains('edit-node')) {
        this._dragging = {
          type: 'node',
          nodeIdx: parseInt(e.target.dataset.node),
          propIdx: parseInt(e.target.dataset.proposal),
          startX: e.clientX, startY: e.clientY,
          prevX: e.clientX - rect.left, prevY: e.clientY - rect.top,
        };
        document.addEventListener('mousemove', this._boundDrag);
        document.addEventListener('mouseup',   this._boundDragEnd);
        e.preventDefault();
      }
      else if (e.target.classList.contains('edit-edge')) {
        this._dragging = {
          type: 'edge',
          edgeIdx: parseInt(e.target.dataset.edge),
          propIdx: parseInt(e.target.dataset.proposal),
          startX: e.clientX, startY: e.clientY,
          prevX: e.clientX - rect.left, prevY: e.clientY - rect.top,
        };
        document.addEventListener('mousemove', this._boundDrag);
        document.addEventListener('mouseup',   this._boundDragEnd);
        e.preventDefault();
      }
    });

    // Wheel zoom (mode standalone uniquement)
    if (!this._map) {
      this._svg.addEventListener('wheel', e => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        this.SCALE = Math.max(2, Math.min(20, this.SCALE * factor));
        this._refresh();
      }, { passive: false });
    }

    // RTAA highlight listener
    window.addEventListener('terlab:rtaa-highlight', (e) => {
      const { baieId } = e.detail ?? {};
      if (!baieId) return;
      this._svg.querySelectorAll('.rtaa-facade').forEach(el => {
        el.style.transition = 'opacity 0.3s';
        el.style.opacity = '0.2';
      });
      const report = window.SessionManager?.getRTAAReport();
      const baie = report?.baies?.find(b => b.id === baieId);
      if (baie) {
        this._svg.querySelectorAll(`.rtaa-facade[data-cardinal="${baie.orientation}"]`).forEach(el => {
          el.style.opacity = '1';
          el.style.stroke = '#ff0000';
          el.style.strokeWidth = '6';
        });
      }
      setTimeout(() => {
        this._svg.querySelectorAll('.rtaa-facade').forEach(el => {
          el.style.opacity = '0.7';
          el.style.stroke = '';
          el.style.strokeWidth = '';
        });
      }, 2000);
    });
  },

  _onDrag(e) {
    if (!this._dragging) return;
    const { type, propIdx } = this._dragging;
    const prop = this._proposals[propIdx];

    // Convertir deplacement pixels en metres locaux
    let dxM, dyM;
    if (this._map) {
      // Coordonnees RELATIVES au canvas Mapbox (map.unproject attend ca)
      const rect = this._canvas.getBoundingClientRect();
      const prevX = this._dragging.prevX ?? (this._dragging.startX - rect.left);
      const prevY = this._dragging.prevY ?? (this._dragging.startY - rect.top);
      const currX = e.clientX - rect.left;
      const currY = e.clientY - rect.top;

      const geo1 = this._map.unproject([prevX, prevY]);
      const geo2 = this._map.unproject([currX, currY]);

      const c = this._centroidGeo(this._parcelGeo);
      const LNG = 111320 * Math.cos(c[1] * Math.PI / 180);
      const LAT = 111320;
      dxM =  (geo2.lng - geo1.lng) * LNG;
      dyM = -(geo2.lat - geo1.lat) * LAT;

      this._dragging.prevX = currX;
      this._dragging.prevY = currY;
    } else {
      dxM = (e.clientX - this._dragging.startX) / this.SCALE;
      dyM = (e.clientY - this._dragging.startY) / this.SCALE;
      this._dragging.startX = e.clientX;
      this._dragging.startY = e.clientY;
    }

    const GRID = 1;
    if (type === 'node') {
      const { nodeIdx } = this._dragging;
      prop.polygon[nodeIdx].x = Math.round((prop.polygon[nodeIdx].x + dxM) / GRID) * GRID;
      prop.polygon[nodeIdx].y = Math.round((prop.polygon[nodeIdx].y + dyM) / GRID) * GRID;
    } else if (type === 'edge') {
      const { edgeIdx } = this._dragging;
      const j = (edgeIdx + 1) % prop.polygon.length;
      const p1 = prop.polygon[edgeIdx], p2 = prop.polygon[j];
      p1.x = Math.round((p1.x + dxM) / GRID) * GRID;
      p1.y = Math.round((p1.y + dyM) / GRID) * GRID;
      p2.x = Math.round((p2.x + dxM) / GRID) * GRID;
      p2.y = Math.round((p2.y + dyM) / GRID) * GRID;
    }

    // Mettre a jour polygonGeo
    prop.polygonGeo = this._localToGeo(prop.polygon);
    prop.surface = this._polygonAreaLocal(prop.polygon);

    // Recalculer le score
    window.EnvelopeGenerator._scorePareto && (() => {
      // Score inline simplifie (pas d'appel async pendant le drag)
      const sd = prop.scoreData;
      if (sd) {
        const parcelArea = parseFloat(this._session?.terrain?.contenance_m2 ?? 200);
        const ces = parcelArea > 0 ? prop.surface / parcelArea : 0;
        sd.pluScore = ces <= (parseFloat(this._session?.phases?.[4]?.data?.ces_max ?? 0.7)) ? 1 : 0.5;
        sd.gardenScore = Math.max(0, Math.min(1, (1 - prop.surface / parcelArea) * 1.5));
        prop.score = window.EnvelopeGenerator._aggregateScore(sd);
      }
    })();

    this._renderProposal(propIdx);
    this._renderScorePanel();
  },

  _onDragEnd() {
    this._dragging = null;
    document.removeEventListener('mousemove', this._boundDrag);
    document.removeEventListener('mouseup',   this._boundDragEnd);
    this._saveToSession();
    // Re-analyser RTAA
    const prop = this._proposals[this._selected];
    if (prop) {
      window.RTAAAnalyzer?.analyzeDebounced(this._session, { polygon: prop.polygon }, (report) => {
        window.SessionManager?.saveRTAAReport(report);
        this._renderProposal(this._selected);
        window.dispatchEvent(new CustomEvent('terlab:rtaa-updated', { detail: { report } }));
      });
    }
  },

  // ── SELECTION ──────────────────────────────────────────────────
  selectProposal(idx) {
    this._renderProposal(idx);
    this._renderScorePanel();
  },

  // ── EXPORT ─────────────────────────────────────────────────────
  exportSVG() {
    const prop = this._proposals[this._selected];
    const svgData = new XMLSerializer().serializeToString(this._svg);
    window.SessionManager?.savePhase(11, {
      esquisse_svg: svgData,
      proposition_retenue: prop,
      score_final: prop?.score,
    });
    window.TerlabToast?.show('Esquisse sauvegardee', 'success', 2000);
    return svgData;
  },

  _saveToSession() {
    const prop = this._proposals[this._selected];
    if (!prop) return;
    window.SessionManager?.savePhase(11, {
      esquisse_svg: null,
      proposition_retenue: {
        family: prop.family,
        polygon: prop.polygon,
        polygonGeo: prop.polygonGeo,
        surface: prop.surface,
        score: prop.score,
        scoreData: prop.scoreData,
      },
    });
    window.dispatchEvent(new CustomEvent('terlab:session-changed'));
  },

  // ── UTILITAIRES SVG ────────────────────────────────────────────
  _el(tag, attrs = {}, id = null, parent = null) {
    const ns = 'http://www.w3.org/2000/svg';
    const el = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if (id) el.id = id;
    (parent ?? this._svg).appendChild(el);
    return el;
  },

  _label(x, y, text, { size = 10, color = '#374151', bold = false, anchor = 'middle' } = {}, id = null, parent = null) {
    const el = this._el('text', {
      x, y, 'text-anchor': anchor, 'font-size': size, fill: color,
      'font-family': 'var(--font-mono, monospace)',
      'font-weight': bold ? '700' : '400',
    }, id, parent);
    el.textContent = text;
    return el;
  },

  _bboxPx(pts) {
    return {
      minX: Math.min(...pts.map(p => p.x)),
      maxX: Math.max(...pts.map(p => p.x)),
      minY: Math.min(...pts.map(p => p.y)),
      maxY: Math.max(...pts.map(p => p.y)),
    };
  },

  _bboxLocal(pts) {
    return {
      minX: Math.min(...pts.map(p => p.x)),
      maxX: Math.max(...pts.map(p => p.x)),
      minY: Math.min(...pts.map(p => p.y)),
      maxY: Math.max(...pts.map(p => p.y)),
    };
  },

  _polygonArea(pts) {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += pts[i].x * pts[j].y;
      area -= pts[j].x * pts[i].y;
    }
    return Math.abs(area) / 2;
  },

  _intersect(a, b, p, q) {
    const a1 = b.y - a.y, b1 = a.x - b.x, c1 = a1 * a.x + b1 * a.y;
    const a2 = q.y - p.y, b2 = p.x - q.x, c2 = a2 * p.x + b2 * p.y;
    const det = a1 * b2 - a2 * b1;
    if (Math.abs(det) < 1e-10) return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    return { x: (c1 * b2 - c2 * b1) / det, y: (a1 * c2 - a2 * c1) / det };
  },

  _injectDefs() {
    const defs = this._el('defs');
    // Hachure reculs orange
    const p1 = this._el('pattern', { id: 'hatch-recul', patternUnits: 'userSpaceOnUse', width: 8, height: 8 }, null, defs);
    this._el('line', { x1: 0, y1: 8, x2: 8, y2: 0, stroke: '#f59e0b', 'stroke-width': 0.8, opacity: 0.5 }, null, p1);
    // Hachure zone constructible vert
    const p2 = this._el('pattern', { id: 'hatch-constructible', patternUnits: 'userSpaceOnUse', width: 8, height: 8 }, null, defs);
    this._el('line', { x1: 0, y1: 8, x2: 8, y2: 0, stroke: '#22c55e', 'stroke-width': 0.6, opacity: 0.4 }, null, p2);
    // Hachure batiments voisins
    const p3 = this._el('pattern', { id: 'hatch-batiment', patternUnits: 'userSpaceOnUse', width: 6, height: 6 }, null, defs);
    this._el('line', { x1: 0, y1: 6, x2: 6, y2: 0, stroke: '#8a9aaa', 'stroke-width': 0.5, opacity: 0.6 }, null, p3);
    // Hachure bande voie
    const p4 = this._el('pattern', { id: 'hatch-voie', patternUnits: 'userSpaceOnUse', width: 6, height: 6 }, null, defs);
    this._el('line', { x1: 0, y1: 6, x2: 6, y2: 0, stroke: '#e87c3e', 'stroke-width': 0.6, opacity: 0.5 }, null, p4);
  },

  _autoFit() {
    if (!this._parcelLocal?.length) return;
    const pts = this._parcelLocal;
    const xs = pts.map(p => Math.abs(p.x));
    const ys = pts.map(p => Math.abs(p.y));
    const maxDim = Math.max(...xs, ...ys) * 2;
    const W = this._svgW || 600;
    const H = this._svgH || 500;
    const targetPx = Math.min(W, H) * 0.7;
    this.SCALE = Math.max(2, Math.min(20, targetPx / maxDim));
  },

  _refresh() {
    this._fullRedraw();
  },

  // ── BACKGROUND (mode standalone uniquement) ────────────────────
  _drawBackground() {
    if (this._map) return;
    const w = this._svgW || 600;
    const h = this._svgH || 500;
    this._el('rect', { x: 0, y: 0, width: w, height: h, fill: 'rgba(245,240,232,0.35)' }, 'bg');
    this._drawGrid(w, h);
  },

  _drawGrid(w, h) {
    const g = this._el('g', { class: 'grid', opacity: 0.15 }, 'grid');
    const step = (this.SCALE || 5) * 1;
    const cx = w / 2, cy = h / 2;
    for (let x = cx % step; x < w; x += step) {
      this._el('line', { x1: x, y1: 0, x2: x, y2: h, stroke: '#6a7a8a', 'stroke-width': 0.3 }, null, g);
    }
    for (let y = cy % step; y < h; y += step) {
      this._el('line', { x1: 0, y1: y, x2: w, y2: y, stroke: '#6a7a8a', 'stroke-width': 0.3 }, null, g);
    }
    const step5 = step * 5;
    for (let x = cx % step5; x < w; x += step5) {
      this._el('line', { x1: x, y1: 0, x2: x, y2: h, stroke: '#6a7a8a', 'stroke-width': 0.6 }, null, g);
    }
    for (let y = cy % step5; y < h; y += step5) {
      this._el('line', { x1: 0, y1: y, x2: w, y2: y, stroke: '#6a7a8a', 'stroke-width': 0.6 }, null, g);
    }
  },

  // ── DESTROY ────────────────────────────────────────────────────
  destroy() {
    if (this._map && this._boundRender) {
      this._map.off('render', this._boundRender);
    }
    document.removeEventListener('mousemove', this._boundDrag);
    document.removeEventListener('mouseup',   this._boundDragEnd);
    if (this._svg) {
      this._svg.innerHTML = '';
    }
    Object.assign(this, {
      _proposals: [], _parcelGeo: [], _parcelLocal: [],
      _streetsGeo: [], _voisinsGeo: [], _edgeTypes: [],
      _map: null, _svg: null, _canvas: null, _boundRender: null,
    });
  },
};

export default EsquisseCanvas;
