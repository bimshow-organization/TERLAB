// TERLAB · utils/coord-converter.js
// Conversion bidirectionnelle WGS84 <-> coordonnées locales (mètres)
// + GeoJSON <-> SVG path
// Factorisé depuis esquisse-canvas.js _geoToLocal / _localToGeo
// ════════════════════════════════════════════════════════════════════

const CoordConverter = {

  // Origine en WGS84 [lng, lat] — typiquement centroïde parcelle
  _origin: null,   // [lng, lat]
  _lngScale: 0,    // mètres par degré de longitude à cette latitude
  _latScale: 111320, // mètres par degré de latitude (constant)

  // ── INIT ──────────────────────────────────────────────────────
  setOrigin(lngLat) {
    this._origin = lngLat;
    this._lngScale = 111320 * Math.cos(lngLat[1] * Math.PI / 180);
  },

  getOrigin() { return this._origin; },

  // Calcul automatique de l'origine depuis un tableau de coords
  setOriginFromCoords(coords) {
    if (!coords?.length) return;
    const n = coords.length;
    this.setOrigin([
      coords.reduce((s, c) => s + c[0], 0) / n,
      coords.reduce((s, c) => s + c[1], 0) / n,
    ]);
  },

  // ── GEO → LOCAL ──────────────────────────────────────────────
  // WGS84 [lng, lat] → local {x, y} mètres (Y inversé = convention SVG)
  geoToLocal(coords) {
    if (!this._origin || !coords?.length) return [];
    const [clng, clat] = this._origin;
    return coords.map(([lng, lat]) => ({
      x:  (lng - clng) * this._lngScale,
      y: -(lat - clat) * this._latScale,
    }));
  },

  // Conversion d'un seul point
  geoToLocalPt(lng, lat) {
    if (!this._origin) return { x: 0, y: 0 };
    return {
      x:  (lng - this._origin[0]) * this._lngScale,
      y: -(lat - this._origin[1]) * this._latScale,
    };
  },

  // ── LOCAL → GEO ──────────────────────────────────────────────
  // Local {x, y} → WGS84 [lng, lat]
  localToGeo(pts) {
    if (!this._origin || !pts?.length) return [];
    const [clng, clat] = this._origin;
    return pts.map(p => [
      clng + p.x / this._lngScale,
      clat - p.y / this._latScale,
    ]);
  },

  localToGeoPt(x, y) {
    if (!this._origin) return [0, 0];
    return [
      this._origin[0] + x / this._lngScale,
      this._origin[1] - y / this._latScale,
    ];
  },

  // ── BBOX ──────────────────────────────────────────────────────
  // Calcule [west, south, east, north] d'un FeatureCollection
  computeBBox(fc) {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    const visit = (coords) => {
      if (typeof coords[0] === 'number') {
        if (coords[0] < w) w = coords[0];
        if (coords[0] > e) e = coords[0];
        if (coords[1] < s) s = coords[1];
        if (coords[1] > n) n = coords[1];
        return;
      }
      coords.forEach(visit);
    };
    (fc.features ?? []).forEach(f => {
      if (f.geometry?.coordinates) visit(f.geometry.coordinates);
    });
    return (w === Infinity) ? null : [w, s, e, n];
  },

  // ── GEOJSON → SVG PATH ────────────────────────────────────────
  // Convertit une Feature GeoJSON en string SVG path (d="...")
  // Coordonnées en mètres locaux (nécessite setOrigin() avant)
  featureToSVGPath(feature) {
    if (!feature?.geometry) return '';
    const geom = feature.geometry;
    const type = geom.type;

    switch (type) {
      case 'Point':
        return this._pointToSVG(geom.coordinates);
      case 'MultiPoint':
        return geom.coordinates.map(c => this._pointToSVG(c)).join(' ');
      case 'LineString':
        return this._lineToSVG(geom.coordinates);
      case 'MultiLineString':
        return geom.coordinates.map(r => this._lineToSVG(r)).join(' ');
      case 'Polygon':
        return geom.coordinates.map(r => this._ringToSVG(r)).join(' ');
      case 'MultiPolygon':
        return geom.coordinates.flatMap(p => p.map(r => this._ringToSVG(r))).join(' ');
      default:
        return '';
    }
  },

  // Retourne le type SVG adapté à la géométrie ('circle'|'path')
  svgElementType(feature) {
    const t = feature?.geometry?.type;
    return (t === 'Point' || t === 'MultiPoint') ? 'circle' : 'path';
  },

  _pointToSVG(coord) {
    const p = this.geoToLocalPt(coord[0], coord[1]);
    return `cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}"`;
  },

  _lineToSVG(coords) {
    const pts = this.geoToLocal(coords);
    if (!pts.length) return '';
    return 'M' + pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L');
  },

  _ringToSVG(coords) {
    return this._lineToSVG(coords) + ' Z';
  },

  // ── SVG PATH → GEOJSON ────────────────────────────────────────
  // Parse un SVG path d="M... L... Z" → GeoJSON geometry
  // type = 'Polygon' | 'LineString' | 'Point'
  svgPathToGeometry(pathD, type = 'Polygon') {
    const points = [];
    const re = /([ML])\s*([\d.e+-]+)[,\s]+([\d.e+-]+)/gi;
    let match;
    while ((match = re.exec(pathD)) !== null) {
      points.push({ x: parseFloat(match[2]), y: parseFloat(match[3]) });
    }
    if (!points.length) return null;

    const coords = this.localToGeo(points);

    switch (type) {
      case 'Point':
        return { type: 'Point', coordinates: coords[0] };
      case 'LineString':
        return { type: 'LineString', coordinates: coords };
      case 'Polygon':
      default:
        // Fermer le ring si nécessaire
        const first = coords[0], last = coords[coords.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) coords.push([...first]);
        return { type: 'Polygon', coordinates: [coords] };
    }
  },

  // ── SVG DOCUMENT COMPLET ──────────────────────────────────────
  // Génère un SVG complet depuis un FeatureCollection
  featureCollectionToSVG(fc, options = {}) {
    const { width = 800, height = 600, padding = 20,
            strokeColor = '#9a7820', fillColor = '#9a7820',
            strokeWidth = 1, fillOpacity = 0.15 } = options;

    const bbox = this.computeBBox(fc);
    if (!bbox) return '';

    // Calculer l'emprise en mètres locaux
    if (!this._origin) this.setOriginFromCoords(this._extractAllCoords(fc));
    const minPt = this.geoToLocalPt(bbox[0], bbox[3]); // NW
    const maxPt = this.geoToLocalPt(bbox[2], bbox[1]); // SE
    const geoW = maxPt.x - minPt.x;
    const geoH = maxPt.y - minPt.y;
    if (geoW <= 0 || geoH <= 0) return '';

    const viewBox = `${(minPt.x - padding).toFixed(2)} ${(minPt.y - padding).toFixed(2)} ${(geoW + padding * 2).toFixed(2)} ${(geoH + padding * 2).toFixed(2)}`;

    let paths = '';
    for (const f of (fc.features ?? [])) {
      const t = f.geometry?.type;
      if (!t) continue;
      const fColor = f.properties?.color ?? fillColor;
      const sColor = f.properties?.strokeColor ?? strokeColor;

      if (t === 'Point' || t === 'MultiPoint') {
        const coords = t === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (const c of coords) {
          const p = this.geoToLocalPt(c[0], c[1]);
          paths += `  <circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="2" fill="${fColor}" stroke="${sColor}" stroke-width="${strokeWidth}"/>\n`;
        }
      } else {
        const d = this.featureToSVGPath(f);
        if (!d) continue;
        const isFill = t.includes('Polygon');
        paths += `  <path d="${d}" fill="${isFill ? fColor : 'none'}" fill-opacity="${isFill ? fillOpacity : 0}" stroke="${sColor}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>\n`;
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">\n${paths}</svg>`;
  },

  _extractAllCoords(fc) {
    const all = [];
    const visit = (c) => {
      if (typeof c[0] === 'number') { all.push(c); return; }
      c.forEach(visit);
    };
    (fc.features ?? []).forEach(f => {
      if (f.geometry?.coordinates) visit(f.geometry.coordinates);
    });
    return all;
  },
};

export default CoordConverter;
