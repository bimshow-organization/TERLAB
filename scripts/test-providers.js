#!/usr/bin/env node
/* ================================================================
 * TERLAB · test-providers.js
 * Vérifie l'accessibilité de chaque provider data
 * Exécuter : node scripts/test-providers.js
 * ================================================================ */

const PROVIDERS = [

  // ── PRIORITÉ 1 : Sans token, GeoJSON direct ──────────────────
  {
    id:       'ign-wfs-cadastre',
    name:     'IGN WFS Cadastre',
    priority: 1,
    phase:    ['P00','P01'],
    test_url: 'https://data.geopf.fr/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities',
    note:     'Déjà intégré P00 — vérifier GetCapabilities OK'
  },
  {
    id:       'ign-bdtopo-batiments',
    name:     'IGN BD TOPO Bâtiments',
    priority: 1,
    phase:    ['P05'],
    test_url: 'https://data.geopf.fr/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature'
            + '&TYPENAMES=BDTOPO_V3:batiment&OUTPUTFORMAT=application/json'
            + '&COUNT=1&BBOX=55.45,-20.92,55.47,-20.90,EPSG:4326',
    note:     'Bâtiments 3D avec attribut hauteur'
  },
  {
    id:       'ign-bdtopo-cours-eau',
    name:     'IGN BD TOPO Cours d\'eau',
    priority: 1,
    phase:    ['P01','P03'],
    test_url: 'https://data.geopf.fr/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature'
            + '&TYPENAMES=BDTOPO_V3:cours_d_eau&OUTPUTFORMAT=application/json'
            + '&COUNT=5&BBOX=55.45,-20.92,55.47,-20.90,EPSG:4326',
    note:     'Ravines et cours d\'eau nommés'
  },
  {
    id:       'brgm-geol1m',
    name:     'BRGM Géologie 1M',
    priority: 1,
    phase:    ['P02'],
    test_url: 'https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap'
            + '&LAYERS=BRGM.GEOL1M&FORMAT=image/png&TRANSPARENT=true'
            + '&CRS=EPSG:4326&WIDTH=256&HEIGHT=256&BBOX=-21.4,55.2,-20.8,55.9',
    note:     'WMS raster seulement — pas de WFS vectoriel direct'
  },
  {
    id:       'gpu-urbanisme',
    name:     'Géoportail Urbanisme (PLU)',
    priority: 1,
    phase:    ['P04','P07'],
    test_url: 'https://www.geoportail-urbanisme.gouv.fr/api/document?nom=97421',
    note:     'Zonage PLU vectoriel officiel — Sainte-Suzanne test'
  },
  {
    id:       'inpn-znieff',
    name:     'INPN ZNIEFF',
    priority: 1,
    phase:    ['P06'],
    test_url: 'https://ws.carmencarto.fr/WS/119/fxx_znieff1.map?SERVICE=WFS'
            + '&REQUEST=GetFeature&TYPENAME=fxx_znieff1&OUTPUTFORMAT=geojson'
            + '&BBOX=55.2,-21.4,55.9,-20.8',
    note:     'Attention : service parfois instable'
  },
  {
    id:       'open-elevation',
    name:     'Open Elevation',
    priority: 2,
    phase:    ['P01'],
    test_url: 'https://api.open-elevation.com/api/v1/lookup?locations=-20.913,55.618',
    note:     'Fallback DEM mobile si Mapbox non dispo'
  },
  {
    id:       'overpass-osm',
    name:     'OSM Overpass API',
    priority: 2,
    phase:    ['P05'],
    test_url: 'https://overpass-api.de/api/interpreter?data='
            + encodeURIComponent('[out:json];way["building"](around:500,-20.913,55.618);out geom;'),
    note:     'Bâtiments OSM avec hauteur — latence variable'
  },

  // ── PRIORITÉ 2 : GeoJSON direct, Réunion-specific ────────────
  {
    id:       'edf-postes-sources',
    name:     'EDF Réunion — Postes sources',
    priority: 2,
    phase:    ['P05'],
    test_url: 'https://opendata-reunion.edf.fr/api/explore/v2.1/catalog/datasets/'
            + 'postes-sources/exports/geojson?limit=100',
    note:     'GeoJSON postes HTA/HTB géolocalisés'
  },
  {
    id:       'edf-installations-pv',
    name:     'EDF Réunion — Installations PV',
    priority: 2,
    phase:    ['P09'],
    test_url: 'https://opendata-reunion.edf.fr/api/explore/v2.1/catalog/datasets/'
            + 'registre-installations-production-stockage/exports/geojson?limit=100',
    note:     'Installations PV raccordées au réseau'
  },
  {
    id:       'region-reuniondata',
    name:     'Open Data Région Réunion',
    priority: 2,
    phase:    ['P05','P11'],
    test_url: 'https://data.regionreunion.com/api/explore/v2.1/catalog/datasets?limit=20',
    note:     'Catalogue complet — explorer les datasets dispo'
  },
  {
    id:       'saintdenis-sig',
    name:     'SIG Saint-Denis',
    priority: 2,
    phase:    ['P05','P08'],
    test_url: 'https://opendata-sig.saintdenis.re/arcgis/rest/services?f=json',
    note:     'ArcGIS REST services list — hydrants, voirie, équipements'
  },

  // ── PRIORITÉ 3 : Nécessite token/proxy ───────────────────────
  {
    id:       'meteofrance-api',
    name:     'Météo-France API Hub',
    priority: 3,
    phase:    ['P01','P03'],
    test_url: 'https://portail-api.meteofrance.fr/public/DPObs/v1/liste-stations'
            + '?id-departement=974',
    note:     'Token GRATUIT requis — portail-api.meteofrance.fr',
    requires: 'TOKEN_METEOFRANCE'
  },
  {
    id:       'georisques-proxy',
    name:     'Géorisques (via proxy)',
    priority: 3,
    phase:    ['P03','P05'],
    test_url: 'https://georisques.gouv.fr/api/v1/gaspar/risques'
            + '?latlon=-20.913,55.618&rayon=500',
    note:     'CORS bloque les DOM — Firebase Function proxy à déployer',
    requires: 'PROXY_CORS'
  },
  {
    id:       'global-wind-atlas',
    name:     'Global Wind Atlas',
    priority: 3,
    phase:    ['P01','P07'],
    test_url: 'https://globalwindatlas.info/api/gis/country/REU/wind-speed/10',
    note:     'GeoTIFF ou GeoJSON vitesse vent — nécessite parsing raster'
  },
  {
    id:       'global-solar-atlas',
    name:     'Global Solar Atlas',
    priority: 4,
    phase:    ['P07','P09'],
    test_url: 'https://api.globalsolaratlas.info/data/lta?loc=-20.913,55.618',
    note:     'Irradiation solaire par coordonnées'
  },
  {
    id:       'peigeo-ppr',
    name:     'PEIGEO PPR (GeoServer)',
    priority: 1,
    phase:    ['P03','P04'],
    test_url: 'http://peigeo.re:8080/geoserver/wfs?SERVICE=WFS&REQUEST=GetCapabilities',
    note:     'CORS bloque navigateur — proxy requis ou pré-téléchargement',
    requires: 'PROXY_CORS'
  },
];

async function testProvider(p) {
  const start = Date.now();
  try {
    const res = await fetch(p.test_url, {
      signal: AbortSignal.timeout(8000),
      headers: p.requires === 'TOKEN_METEOFRANCE'
        ? { apikey: process.env.METEOFRANCE_TOKEN || 'TEST' }
        : {}
    });
    const ms = Date.now() - start;
    const ct = res.headers.get('content-type') || '';
    let size = '?';
    try {
      const buf = await res.arrayBuffer();
      size = `${Math.round(buf.byteLength / 1024)}Ko`;
    } catch {}
    return {
      id: p.id, status: res.status, ok: res.ok,
      contentType: ct.split(';')[0], ms, size,
      cors: !res.headers.get('access-control-allow-origin') ? 'MISSING' : 'OK',
      result: res.ok ? 'OK' : `HTTP ${res.status}`
    };
  } catch (e) {
    return { id: p.id, status: 0, ok: false, ms: Date.now() - start,
             result: e.name === 'TimeoutError' ? 'TIMEOUT' : `ERREUR: ${e.message}` };
  }
}

async function main() {
  console.log('\n=== TERLAB DATA PROVIDERS TEST ===\n');
  const results = [];
  for (const p of PROVIDERS) {
    process.stdout.write(`Testing ${p.id}... `);
    const r = await testProvider(p);
    results.push({ ...p, ...r });
    const icon = r.ok ? '✅' : r.result === 'TIMEOUT' ? '⏱️' : '❌';
    console.log(`${icon} ${r.result} (${r.ms}ms) ${r.size || ''} CORS:${r.cors || '?'}`);
  }

  // Rapport classé
  console.log('\n=== CLASSIFICATION PAR PRIORITÉ ===\n');
  [1,2,3,4].forEach(prio => {
    const group = results.filter(r => r.priority === prio);
    if (!group.length) return;
    console.log(`\nPRIORITÉ ${prio}:`);
    group.forEach(r => {
      const feasible = r.ok && r.cors !== 'MISSING' && !r.requires;
      console.log(`  [${feasible ? 'INTÉGRABLE' : r.requires ? 'TOKEN REQUIS' : 'CORS/ERREUR'}] ${r.name} — ${r.result} — Phases: ${r.phase.join(',')}`);
    });
  });

  // Export JSON des résultats pour le sprint
  const fs = await import('fs');
  fs.writeFileSync('data/providers-test-results.json', JSON.stringify(results, null, 2));
  console.log('\n→ Résultats sauvés dans data/providers-test-results.json\n');
}

main().catch(console.error);
