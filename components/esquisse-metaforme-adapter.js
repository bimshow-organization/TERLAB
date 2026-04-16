// terlab/components/esquisse-metaforme-adapter.js
// EsquisseMetaformeAdapter — Pont session ↔ MetaformeEngine/Renderer/Events
// Permet à Esquisse P07/P11 d'utiliser le moteur Métaforme v3 comme couche
// d'édition SVG (arcs/béziers/split/typologies/drag propre) sans dépendre de Mapbox.
// ENSA La Réunion · MGA Architecture 2026

import { createEngine } from './metaforme-engine.js';
import { createRenderer } from './metaforme-renderer.js';
import { bindEvents } from './metaforme-events.js';

// Convertit WGS84 → coords locales mètres centrées sur centroïde parcelle
// Cohérent avec EsquisseCanvas._geoToLocal et SessionManager.
function geoToLocal(coords, origin) {
  if (!origin || !coords?.length) return coords.map(() => ({ x: 0, y: 0 }));
  const { clng, clat, LNG, LAT } = origin;
  return coords.map(([lng, lat]) => ({
    x: (lng - clng) * LNG,
    y: -(lat - clat) * LAT,   // Y-down = -latitude
  }));
}

function buildGeoOrigin(parcelGeo) {
  if (!parcelGeo?.length) return null;
  const clng = parcelGeo.reduce((s, c) => s + c[0], 0) / parcelGeo.length;
  const clat = parcelGeo.reduce((s, c) => s + c[1], 0) / parcelGeo.length;
  return {
    clng, clat,
    LNG: 111320 * Math.cos(clat * Math.PI / 180),
    LAT: 111320,
  };
}

// Convertit coords locales mètres → SVG coords (px) en centrant dans viewBox
function localToSVG(localPts, viewW, viewH, scale = 5) {
  const cx = viewW / 2, cy = viewH / 2;
  return localPts.map(p => [cx + p.x * scale, cy + p.y * scale]);
}

function svgToLocal(svgPts, viewW, viewH, scale = 5) {
  const cx = viewW / 2, cy = viewH / 2;
  return svgPts.map(([x, y]) => ({ x: (x - cx) / scale, y: (y - cy) / scale }));
}

// ═════════════════════════════════════════════════════════════════
// ADAPTER FACTORY
// ═════════════════════════════════════════════════════════════════

export function createAdapter(svg, opts = {}) {
  const viewW = opts.viewW ?? 860;
  const viewH = opts.viewH ?? 600;
  const scale = opts.scale ?? 5;         // 1m = scale px
  const GRID  = opts.GRID  ?? scale;     // alignement grille sur échelle

  // Configurer le SVG si non fait
  svg.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.background = svg.style.background || 'var(--bg, #13100a)';

  const engine = createEngine({ GRID, OFFSET: GRID * 2 });  // inlet 2m
  const renderer = createRenderer(svg, engine, { viewW, viewH });
  const events = bindEvents(svg, engine, renderer, {
    viewW, viewH,
    onChange: opts.onChange ?? (() => {}),
  });

  let currentOrigin = null;
  let currentEdgeTypes = null;

  // ── Charger la parcelle depuis la session (TERLAB) ──────────
  function loadSession(session) {
    const terrain = session?.terrain ?? {};
    const geom = terrain.parcelle_geojson;
    let parcelGeo = null;
    if (geom?.type === 'Polygon') parcelGeo = geom.coordinates[0];
    else if (geom?.type === 'MultiPolygon') parcelGeo = geom.coordinates[0]?.[0];
    if (!parcelGeo?.length) return false;

    // Supprimer point de fermeture GeoJSON
    const r = parcelGeo;
    if (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) {
      parcelGeo = r.slice(0, -1);
    }

    currentOrigin = buildGeoOrigin(parcelGeo);
    const localPts = geoToLocal(parcelGeo, currentOrigin);
    const svgPts = localToSVG(localPts, viewW, viewH, scale);

    currentEdgeTypes = session._edgeTypes ?? inferEdgeTypes(svgPts);

    // Importer dans le moteur
    engine.importPolys([{
      verts: svgPts,
      edges: svgPts.map(() => ({ type: 'line' })),
      holeOf: null,
      typology: 'isolee',
    }]);
    renderer.render();
    return true;
  }

  // Fallback edgeType : arête la plus courte = voie, 2 suivantes = lat, dernière = fond
  function inferEdgeTypes(pts) {
    const n = pts.length;
    const lens = pts.map((p, i) => {
      const [x1, y1] = p, [x2, y2] = pts[(i + 1) % n];
      return Math.hypot(x2 - x1, y2 - y1);
    });
    const minIdx = lens.indexOf(Math.min(...lens));
    return pts.map((_, i) => {
      if (i === minIdx) return 'voie';
      if (i === (minIdx + Math.floor(n / 2)) % n) return 'fond';
      return 'lat';
    });
  }

  // ── Exporter retour vers session (WGS84) ─────────────────────
  function exportToSession(session) {
    if (!currentOrigin) return null;
    const polys = engine.exportPolys();
    // Convertir SVG → local → WGS84
    const wgs = polys.map(p => {
      const locals = svgToLocal(p.verts, viewW, viewH, scale);
      const coords = locals.map(l => [
        currentOrigin.clng + l.x / currentOrigin.LNG,
        currentOrigin.clat - l.y / currentOrigin.LAT,
      ]);
      coords.push([...coords[0]]);  // fermeture GeoJSON
      return {
        coords, edges: p.edges, holeOf: p.holeOf, typology: p.typology,
      };
    });
    if (session) {
      session._esquisseMetaforme = { polys: wgs, edgeTypes: currentEdgeTypes };
    }
    return wgs;
  }

  // ── Ajouter un nouveau polygone (bâtiment, annexe, trou) ────
  function addPoly(verts, opts = {}) {
    engine.addPoly({
      verts,
      edges: opts.edges ?? verts.map(() => ({ type: 'line' })),
      holeOf: opts.holeOf ?? null,
      typology: opts.typology ?? 'isolee',
    });
    engine.afterMutation();
    renderer.render();
  }

  function reset() {
    engine.clear();
    renderer.render();
  }

  function destroy() {
    events.unbind();
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  return {
    engine, renderer, events,
    loadSession,
    exportToSession,
    addPoly,
    reset,
    destroy,
    render: renderer.render,
    resetView: events.resetView,
    // helpers export pour consommateurs
    svgToLocal: pts => svgToLocal(pts, viewW, viewH, scale),
    localToSVG: pts => localToSVG(pts, viewW, viewH, scale),
    getOrigin: () => currentOrigin,
    getEdgeTypes: () => currentEdgeTypes,
  };
}

export default { createAdapter };
