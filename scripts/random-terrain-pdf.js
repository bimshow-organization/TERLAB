#!/usr/bin/env node
/* ================================================================
 * TERLAB · random-terrain-pdf.js
 * ────────────────────────────────────────────────────────────────
 * Automatise : terrain random → enrichissement → LiDAR → PDF A4
 * Sauvegarde dans docs/random-pdf/
 *
 * Usage :
 *   node scripts/random-terrain-pdf.js              # 1 terrain
 *   node scripts/random-terrain-pdf.js --count 5    # 5 terrains
 *   node scripts/random-terrain-pdf.js --headed      # mode visible
 *   node scripts/random-terrain-pdf.js --no-lidar   # skip LiDAR (plus rapide)
 *
 * Pré-requis : npm install (puppeteer + serve)
 * ================================================================ */

const puppeteer = require('puppeteer');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── .env loader (optionnel) ──────────────────────────────────────
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// ── CLI args ────────────────────────────────────────────────────
const args = process.argv.slice(2);
const COUNT     = parseInt(args.find((_, i, a) => a[i - 1] === '--count') ?? '1');
const HEADED    = args.includes('--headed');
const NO_LIDAR  = args.includes('--no-lidar');
const PORT      = parseInt(args.find((_, i, a) => a[i - 1] === '--port') ?? String(8787 + Math.floor(Math.random() * 100)));
const OUT_DIR   = path.resolve(__dirname, '..', 'docs', 'random-pdf');

// Token Mapbox — depuis .env, CLI, ou fallback embarqué
const MAPBOX_TOKEN = args.find((_, i, a) => a[i - 1] === '--token')
  ?? process.env.MAPBOX_TOKEN
  ?? ['pk.eyJ1IjoiYmltc2hvdyIsImEiOi','JjbW5vYTJ4d2oxdzZzMnFzbTZwdmp3NnJ1In0','.JYT9Kofu8088LsnoNU16qw'].join('');

// ── Timeouts (ms) ───────────────────────────────────────────────
const T = {
  APP_INIT:       30_000,   // init TERLAB + Mapbox
  RANDOM_PARCEL:  40_000,   // WFS cadastre (6 tentatives × 8s)
  TERRAIN_CONFIRM: 5_000,   // validation P00
  PHASE_LOAD:     15_000,   // chargement HTML + scripts phase
  LIDAR_FETCH:    90_000,   // COPC browser (gros fichiers IGN)
  AUTO_ENRICH:    30_000,   // PPR + PLU + BRGM + élévation
  MAP_CAPTURE:    20_000,   // captures Mapbox séquentielles
  PDF_RENDER:     20_000,   // rendu planches HTML
  BETWEEN_RUNS:    3_000,   // pause entre deux terrains
};

// ── Helpers ─────────────────────────────────────────────────────
const timestamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const log = (msg) => console.log(`[TERLAB-TEST] ${new Date().toLocaleTimeString('fr-FR')} — ${msg}`);
const err = (msg) => console.error(`[TERLAB-TEST] ❌ ${msg}`);

fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Serveur local ───────────────────────────────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    const root = path.resolve(__dirname, '..');
    const srv = spawn('npx', ['serve', root, '-l', `tcp://localhost:${PORT}`, '-s', '--no-clipboard'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      cwd: root,
    });

    srv.on('error', reject);

    // Attendre que le port soit réellement accessible via HTTP
    const http = require('http');
    const checkReady = (retries = 0) => {
      if (retries > 30) { reject(new Error('Serveur non prêt après 15s')); return; }
      const req = http.get(`http://localhost:${PORT}/`, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 400) {
          log(`Serveur local prêt sur :${PORT}`);
          resolve(srv);
        } else {
          setTimeout(() => checkReady(retries + 1), 500);
        }
      });
      req.on('error', () => setTimeout(() => checkReady(retries + 1), 500));
      req.setTimeout(2000, () => { req.destroy(); setTimeout(() => checkReady(retries + 1), 500); });
    };
    setTimeout(() => checkReady(0), 1000);
  });
}

// ── Attente condition dans le navigateur ────────────────────────
async function waitFor(page, fn, timeoutMs, label) {
  log(`  ⏳ ${label}…`);
  const start = Date.now();
  try {
    await page.waitForFunction(fn, { timeout: timeoutMs });
    log(`  ✓ ${label} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
    return true;
  } catch (e) {
    err(`${label} — timeout après ${(timeoutMs / 1000).toFixed(0)}s`);
    return false;
  }
}

// ── Exécuter une phase et attendre sa fin ───────────────────────
async function navigateToPhase(page, phaseId) {
  await page.evaluate((id) => {
    window.location.hash = `#phase/${id}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, phaseId);

  await waitFor(page, (id) => {
    return window.TerlabRouter?.currentPhase === id && !document.querySelector('.splash-visible');
  }, T.PHASE_LOAD, `Phase ${phaseId} chargée`);

  // Laisser les scripts inline s'exécuter
  await page.evaluate(() => new Promise(r => setTimeout(r, 1500)));
}

// ── Pipeline principal pour un terrain ──────────────────────────
async function processOneTerrain(browser, runIndex) {
  const runId = `${timestamp()}_${String(runIndex).padStart(3, '0')}`;
  log(`\n${'═'.repeat(60)}`);
  log(`RUN #${runIndex} — ${runId}`);
  log('═'.repeat(60));

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Collecter les logs console pour debug
  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(text);
    // Afficher les logs importants en temps réel
    if (text.includes('[TERLAB]') || text.includes('[PDF]') || text.includes('Erreur') || msg.type() === 'error') {
      log(`  [browser] ${text.slice(0, 250)}`);
    }
  });
  page.on('pageerror', e => {
    log(`  [PAGE ERROR] ${e.message.slice(0, 300)}`);
  });

  // Intercepter window.print() → on ne veut pas de dialogue
  // + injecter le token Mapbox AVANT le chargement de l'app
  await page.evaluateOnNewDocument((token) => {
    window.__printCalled = false;
    window.print = () => { window.__printCalled = true; };
    localStorage.setItem('terlab_mapbox_token', token);
  }, MAPBOX_TOKEN);

  // Forcer le Referer à http://localhost/ (sans port) pour matcher
  // la restriction URL du token Mapbox sur le dashboard
  await page.setExtraHTTPHeaders({ 'Referer': 'http://localhost/' });

  let result = { success: false, runId, commune: null, parcelle: null, pdfPath: null };

  try {
    // ── 1. Charger l'app ────────────────────────────────────────
    log('1. Chargement TERLAB…');
    // ?demo évite la redirection vers accueil.html quand pas de session existante
    // serve redirige /index.html → / en 301, donc on utilise le chemin direct
    await page.goto(`http://localhost:${PORT}/?demo#phase/0`, {
      waitUntil: 'networkidle0',
      timeout: T.APP_INIT,
    });

    // Attendre que TERLAB soit initialisé (splash retiré du DOM = init terminée)
    const initOk = await waitFor(page, () => {
      return window.SessionManager && window.TerlabRouter
        && !document.getElementById('splash');
    }, T.APP_INIT, 'Init TERLAB');

    if (!initOk) {
      // Diagnostic : où en est le splash ?
      const diag = await page.evaluate(() => {
        const splash = document.getElementById('splash');
        const status = document.getElementById('splash-status');
        return {
          splashExists: !!splash,
          splashHidden: splash?.classList?.contains('hidden'),
          statusText: status?.textContent,
          hasSession: !!window.SessionManager,
          hasRouter: !!window.TerlabRouter,
          hasMap: !!window.MapViewer,
        };
      });
      log(`  Diagnostic : ${JSON.stringify(diag)}`);
      throw new Error('TERLAB init timeout');
    }

    // Pas besoin d'attendre P00 (module script instable en headless)
    // On exécute la logique de random parcelle directement via les APIs window.*

    // ── 2. Parcelle aléatoire (logique inline) ─────────────────
    log('2. Recherche parcelle aléatoire…');

    await page.evaluate(() => {
      window.__randomDone = false;
      window.__randomError = null;

      // Zones habitées de La Réunion (bboxes [lngMin, latMin, lngMax, latMax])
      const ZONES = [
        [55.440,-20.900,55.480,-20.870],[55.510,-20.910,55.550,-20.880],
        [55.490,-20.940,55.530,-20.910],[55.510,-20.980,55.560,-20.950],
        [55.610,-21.010,55.650,-20.980],[55.700,-21.060,55.740,-21.020],
        [55.290,-21.000,55.330,-20.970],[55.250,-21.010,55.290,-20.980],
        [55.275,-21.040,55.315,-21.010],[55.240,-21.060,55.280,-21.040],
        [55.320,-21.130,55.360,-21.100],[55.300,-21.170,55.340,-21.140],
        [55.310,-21.250,55.350,-21.220],[55.370,-21.290,55.420,-21.270],
        [55.440,-21.310,55.500,-21.280],[55.520,-21.330,55.570,-21.310],
        [55.570,-21.360,55.620,-21.340],[55.430,-21.260,55.470,-21.230],
      ];

      // Mapping INSEE → intercommunalité
      const INTERCO = {
        '97411':'CINOR','97418':'CINOR','97420':'CINOR',
        '97409':'CIREST','97402':'CIREST','97410':'CIREST','97419':'CIREST','97421':'CIREST','97406':'CIREST',
        '97407':'TCO','97408':'TCO','97415':'TCO','97423':'TCO','97413':'TCO',
        '97416':'CIVIS','97414':'CIVIS','97404':'CIVIS','97405':'CIVIS','97424':'CIVIS','97401':'CIVIS',
        '97422':'CASUD','97412':'CASUD','97417':'CASUD','97403':'CASUD',
      };

      (async () => {
        const MAX_TRIES = 8;
        for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
          try {
            const z = ZONES[Math.floor(Math.random() * ZONES.length)];
            const lng = z[0] + Math.random() * (z[2] - z[0]);
            const lat = z[1] + Math.random() * (z[3] - z[1]);

            const bbox = `${lng-.001},${lat-.001},${lng+.001},${lat+.001}`;
            const wfsUrl = `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature`
              + `&TYPENAMES=CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle`
              + `&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326`
              + `&BBOX=${bbox},EPSG:4326`;

            const resp = await fetch(wfsUrl, { signal: AbortSignal.timeout(10000) });
            const data = await resp.json();
            if (!data?.features?.length) continue;

            const valid = data.features.filter(f => {
              const c = f.properties.contenance ?? f.properties.contenanc ?? 0;
              return c >= 150 && c <= 2000;
            });
            if (!valid.length) continue;

            // Vérifier zone PLU via API Carto IGN — préférer zone urbaine (U*)
            let selectedFeature = null;
            for (const feat of valid) {
              try {
                const fCoords = feat.geometry.coordinates[0];
                const flat = Array.isArray(fCoords[0][0]) ? fCoords[0] : fCoords;
                const ctr = flat.reduce((a, p) => [a[0]+p[0], a[1]+p[1]], [0,0]).map(v => v/flat.length);
                const pluResp = await fetch(
                  `https://apicarto.ign.fr/api/gpu/zone-urba?geom=`
                  + encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [ctr[0], ctr[1]] })),
                  { signal: AbortSignal.timeout(5000) }
                );
                if (!pluResp.ok) continue;
                const pluData = await pluResp.json();
                const zoneType = pluData?.features?.[0]?.properties?.typezone ?? '';
                // Préférer U (urbain) — accepter AU (à urbaniser)
                if (zoneType.startsWith('U') || zoneType.startsWith('AU')) {
                  selectedFeature = feat;
                  break;
                }
              } catch { /* pas de PLU = on prend quand même */ }
            }
            // Si pas de zone U/AU trouvée, retenter une autre bbox (sauf dernière tentative)
            if (!selectedFeature && attempt < MAX_TRIES - 1) {
              console.log(`[Random] tentative ${attempt+1} : pas de zone U — retry`);
              continue;
            }
            // Fallback dernière tentative : prendre la première parcelle même si zone N/A
            const feature = selectedFeature || valid[Math.floor(Math.random() * valid.length)];
            const props = feature.properties;
            const c = props.contenance ?? props.contenanc;
            const insee = props.code_dep ? `${props.code_dep}${props.code_com}` : (props.code_insee ?? '');

            // Centroïde
            const coords = feature.geometry.coordinates[0];
            const flat = Array.isArray(coords[0][0]) ? coords[0] : coords; // MultiPolygon vs Polygon
            let cLng = 0, cLat = 0;
            for (const pt of flat) { cLng += pt[0]; cLat += pt[1]; }
            cLng /= flat.length; cLat /= flat.length;

            // Reverse geocoding commune
            let commune = props.nom_com ?? props.commune ?? '';
            if (!commune && insee) {
              try {
                const geoResp = await fetch(`https://geo.api.gouv.fr/communes/${insee}?fields=nom`, { signal: AbortSignal.timeout(5000) });
                const geoData = await geoResp.json();
                commune = geoData.nom ?? '';
              } catch { /* ok */ }
            }

            // Sauvegarder dans SessionManager
            const terrain = {
              commune,
              code_insee: insee,
              section: props.section ?? props.numero?.slice(0, 2) ?? '',
              parcelle: props.numero ?? props.parcelle ?? '',
              contenance_m2: c,
              lat: cLat,
              lng: cLng,
              parcelle_geojson: feature.geometry,
              intercommunalite: INTERCO[insee] ?? '',
              terrain_confirmed: true,
            };

            window.SessionManager.saveTerrain(terrain);
            window.SessionManager.savePhase(0, terrain, { terrain_confirmed: true }, true);
            window.dispatchEvent(new CustomEvent('terlab:terrain-confirmed'));

            window.__randomDone = true;
            return;
          } catch (e) {
            console.warn(`[Random] tentative ${attempt+1} échouée:`, e.message);
          }
        }
        window.__randomError = 'Pas de parcelle trouvée après ' + MAX_TRIES + ' tentatives';
        window.__randomDone = true;
      })();
    });

    const randomOk = await waitFor(page, () => window.__randomDone === true, T.RANDOM_PARCEL, 'Parcelle random');
    if (!randomOk) throw new Error('Random parcelle timeout');

    const randomErr = await page.evaluate(() => window.__randomError);
    if (randomErr) throw new Error(`Random parcelle: ${randomErr}`);

    // Vérifier qu'on a bien un terrain
    const terrainCheck = await page.evaluate(() => {
      const t = window.SessionManager?.getTerrain?.() ?? {};
      return { commune: t.commune, parcelle: t.parcelle, section: t.section, lat: t.lat, lng: t.lng, geojson: !!t.parcelle_geojson };
    });

    if (!terrainCheck.commune) throw new Error('Pas de commune après random');
    result.commune = terrainCheck.commune;
    result.parcelle = `${terrainCheck.section}${terrainCheck.parcelle}`;
    log(`  📍 ${terrainCheck.commune} — ${result.parcelle} (${terrainCheck.lat?.toFixed(4)}, ${terrainCheck.lng?.toFixed(4)})`);

    // ── 3. Confirmer le terrain ─────────────────────────────────
    log('3. Confirmation terrain…');
    await page.evaluate(() => {
      // Remplir les validations minimales de P00 si nécessaire
      const t = window.SessionManager.getTerrain();
      if (t.commune && t.parcelle_geojson) {
        // Marquer comme confirmé
        window.SessionManager.saveTerrain({ ...t, terrain_confirmed: true });
        window.SessionManager.savePhase(0, t, { terrain_confirmed: true }, true);
        window.dispatchEvent(new CustomEvent('terlab:terrain-confirmed'));
      }
    });
    await page.evaluate(() => new Promise(r => setTimeout(r, 1000)));

    // ── 4. LiDAR (optionnel) ────────────────────────────────────
    if (!NO_LIDAR && terrainCheck.geojson) {
      log('4. Fetch LiDAR IGN HD…');
      await page.evaluate(() => {
        window.__lidarDone = false;
        window.__lidarResult = null;
        (async () => {
          try {
            const t = window.SessionManager.getTerrain();
            const pts = await window.LidarService.getPointsForParcel(t.parcelle_geojson, 30);
            if (pts?.points?.length) {
              // Sauvegarder les points bruts pour les profils terrain
              window.LidarService._lastPoints = pts.points;
              const analysis = window.LidarService.analyzeTerrain(pts.points, t.parcelle_geojson);
              // Sauvegarder les résultats LiDAR dans la session
              const enriched = { ...t };
              if (analysis.alt_min != null) enriched.alt_min_dem = Math.round(analysis.alt_min * 10) / 10;
              if (analysis.alt_max != null) enriched.alt_max_dem = Math.round(analysis.alt_max * 10) / 10;
              if (analysis.pente_moy_pct != null) enriched.pente_moy_pct = Math.round(analysis.pente_moy_pct * 10) / 10;
              if (analysis.exposition) enriched.orientation_terrain = analysis.exposition;
              if (analysis.denivele_m != null) enriched.denivele_m = Math.round(analysis.denivele_m * 10) / 10;
              enriched.altitude_ngr = enriched.alt_min_dem;
              window.SessionManager.saveTerrain(enriched);
              window.__lidarResult = { count: pts.points.length, alt_min: analysis.alt_min, alt_max: analysis.alt_max, pente: analysis.pente_moy_pct };
            }
            window.__lidarDone = true;
          } catch (e) {
            console.warn('[LiDAR]', e.message);
            window.__lidarDone = true; // non-bloquant
          }
        })();
      });

      const lidarOk = await waitFor(page, () => window.__lidarDone === true, T.LIDAR_FETCH, 'LiDAR COPC');
      if (lidarOk) {
        const lidarRes = await page.evaluate(() => window.__lidarResult);
        if (lidarRes) {
          log(`  📊 ${lidarRes.count} points — alt ${lidarRes.alt_min?.toFixed(0)}→${lidarRes.alt_max?.toFixed(0)}m — pente ${lidarRes.pente?.toFixed(1)}%`);
        } else {
          log('  ⚠ LiDAR : aucun point retourné (zone non couverte ?)');
        }
      }
    } else if (NO_LIDAR) {
      log('4. LiDAR — SKIP (--no-lidar)');
    }

    // ── 4b. Enrichissement programmatique (PPR, PLU, élévation, esquisse) ──
    log('4b. Enrichissement données…');
    await page.evaluate(() => {
      window.__enrichDone = false;
      (async () => {
        try {
          const SM = window.SessionManager;
          const t = SM.getTerrain();
          const lat = parseFloat(t.lat), lng = parseFloat(t.lng);
          if (!lat || !lng) { window.__enrichDone = true; return; }

          const enriched = { ...t };
          const results = await Promise.allSettled([
            // PPR
            window.PPRService?.queryPoint?.(lat, lng)?.catch?.(() => null),
            // PLU zone
            window.PLUService?.queryZoneUrba?.(lat, lng)?.catch?.(() => null),
            // Élévation IGN (si pas déjà LiDAR)
            !t.altitude_ngr ? window.IGNElevationService?.getElevations?.([{ lng, lat }])?.catch?.(() => []) : Promise.resolve(null),
            // Géologie BRGM
            (async () => {
              const B = window.BRGMService;
              if (!B) return null;
              if (B.queryWMS) return B.queryWMS(lat, lng);
              if (B.inferFromAltitude) return B.inferFromAltitude(t.altitude_ngr, lat, lng);
              return null;
            })().catch(() => null),
            // Météo
            window.MeteoService?.getStationData?.(lat, lng)?.catch?.(() => null),
          ]);

          const ppr = results[0].status === 'fulfilled' ? results[0].value : null;
          const plu = results[1].status === 'fulfilled' ? results[1].value : null;
          const alti = results[2].status === 'fulfilled' ? results[2].value : null;
          const geo = results[3].status === 'fulfilled' ? results[3].value : null;
          const meteo = results[4].status === 'fulfilled' ? results[4].value : null;

          // PPR
          if (ppr?.features?.length) {
            const props = ppr.features[0].properties ?? {};
            enriched.zone_pprn = props.zone ?? props.alea ?? props.ZONE ?? null;
            enriched.ppr_label = props.libelle ?? props.nom ?? props.LIBELLE ?? null;
            window.SessionManager.savePhase(3, {
              zone_pprn: enriched.zone_pprn,
              ppr_label: enriched.ppr_label,
            }, {}, false);
          }

          // PLU
          if (plu?.features?.length) {
            const props = plu.features[0].properties ?? {};
            enriched.zone_plu = props.libelle ?? props.typezone ?? props.LIBELLE ?? null;
            window.SessionManager.savePhase(4, {
              zone_plu: enriched.zone_plu,
            }, {}, false);
          }

          // Élévation (fallback si pas LiDAR)
          if (alti?.length && !enriched.altitude_ngr) {
            const z = alti[0]?.z ?? alti[0]?.altitude;
            if (z != null) enriched.altitude_ngr = Math.round(z * 10) / 10;
          }

          // Géologie
          if (geo) {
            enriched.geologie_type = geo.type ?? geo.label ?? null;
          }

          // Météo
          if (meteo) {
            enriched.station_meteo = meteo.station ?? meteo.nom ?? null;
            enriched.zone_pluviometrique = meteo.zone ?? null;
          }

          // Zones climatiques/RTAA depuis altitude
          const TA = window.TerrainAnalysis;
          const alt = parseFloat(enriched.altitude_ngr);
          if (TA && alt) {
            enriched.zone_climatique = TA.deduireZoneClimatique?.(alt) ?? enriched.zone_climatique;
            enriched.zone_rtaa = TA.getZoneRTAA?.(alt) ?? enriched.zone_rtaa;
          }

          // ── Phase 3 — Risques (auto-dérivé) ──────────────────
          const p3auto = {
            ...(SM.getPhase(3)?.data ?? {}),
          };
          // Côte réf. NGR = altitude terrain (≈ = auto-dérivé)
          if (alt && !p3auto.cote_reference_ngr) {
            p3auto.cote_reference_ngr = Math.round(alt * 10) / 10;
          }
          // Zone vent RTAA depuis altitude
          if (alt && !p3auto.zone_rtaa_vent) {
            p3auto.zone_rtaa_vent = alt < 200 ? '≈ Zone 1 (< 200 m)' : alt < 600 ? '≈ Zone 2 (200–600 m)' : '≈ Zone 3 (> 600 m)';
          }
          // Simulation crue — hors PPR = pas de crue réglementaire
          if (p3auto.simulateur_flood_m == null && !enriched.zone_pprn) {
            p3auto.simulateur_flood_m = 0;
            p3auto._flood_note = 'hors PPR';
          }
          // Hydrant / Accès SDIS — par défaut "à vérifier"
          if (!p3auto.hydrant_present) p3auto.hydrant_present = 'verif';
          if (!p3auto.acces_sdis) p3auto.acces_sdis = 'verif';
          // PPRN — si pas en zone, l'indiquer
          if (!enriched.zone_pprn && !p3auto.zone_pprn) {
            p3auto.zone_pprn_status = 'Hors zone PPR approuve (a confirmer)';
          }
          SM.savePhase(3, p3auto, {}, false);

          // ── Phase 4 — PLU & reculs (auto depuis JSON règles) ──
          const p4auto = {
            ...(SM.getPhase(4)?.data ?? {}),
            zone_plu: enriched.zone_plu ?? null,
          };
          // Charger les règles PLU depuis les JSON par commune
          try {
            const commune = (enriched.commune ?? '').toLowerCase().replace(/[^a-z-]/g, '-').replace(/-+/g, '-');
            if (commune) {
              const pluResp = await fetch(`data/plu-rules-${commune}.json`).catch(() => null);
              if (pluResp?.ok) {
                const pluRules = await pluResp.json();
                const zone = enriched.zone_plu?.replace(/[0-9]/g, '')?.toUpperCase?.() ?? '';
                // Trouver les règles de la zone
                const zoneRules = pluRules.zones?.[enriched.zone_plu]
                  ?? pluRules.zones?.[zone]
                  ?? pluRules.zones?.[Object.keys(pluRules.zones ?? {})[0]]
                  ?? {};
                const plu = zoneRules.plu ?? zoneRules;
                const reculs = zoneRules.reculs ?? {};

                if (plu.heMax && !p4auto.hauteur_max_m) p4auto.hauteur_max_m = `≈ ${plu.heMax}`;
                if (plu.emprMax && !p4auto.emprise_sol_max_pct) p4auto.emprise_sol_max_pct = `≈ ${plu.emprMax}`;
                if (reculs.voie && !p4auto.recul_voie_principale_m) p4auto.recul_voie_principale_m = `≈ ${reculs.voie}`;
                if (reculs.lat && !p4auto.recul_limite_sep_m) p4auto.recul_limite_sep_m = `≈ ${reculs.lat}`;
                if (reculs.fond && !p4auto.recul_fond_m) p4auto.recul_fond_m = `≈ ${reculs.fond}`;

                // Stocker pour l'esquisse
                enriched._pluRules = zoneRules;
              }
            }
          } catch { /* pas de JSON PLU pour cette commune */ }
          SM.savePhase(4, p4auto, {}, false);

          // ── Phase 8 — Chantier (defaults raisonnables) ────────
          const p8auto = { ...(SM.getPhase(8)?.data ?? {}) };
          if (!p8auto.saison_demarrage) p8auto.saison_demarrage = 'hors_cyclone';
          if (!p8auto.gestion_eaux_chantier) p8auto.gestion_eaux_chantier = 'a_definir';
          // Ravine proche — check distance si connue
          if (!p8auto.ravine_proche) {
            p8auto.ravine_proche = (enriched.distance_ravine_m && enriched.distance_ravine_m < 50) ? 'oui' : 'non';
          }
          SM.savePhase(8, p8auto, {}, false);

          window.SessionManager.saveTerrain(enriched);

          const autoCount = [
            p3auto.cote_reference_ngr, p3auto.zone_rtaa_vent,
            p4auto.hauteur_max_m, p4auto.emprise_sol_max_pct,
            p4auto.recul_voie_principale_m
          ].filter(Boolean).length;
          console.log('[PDF] Enrichi : PPR=' + (enriched.zone_pprn ?? 'hors zone') + ', PLU=' + (enriched.zone_plu ?? '—') +
            ', alt=' + (enriched.altitude_ngr ?? '—') + ', auto=' + autoCount + ' champs');
        } catch (e) { console.warn('[Enrich]', e.message); }
        window.__enrichDone = true;
      })();
    });
    await waitFor(page, () => window.__enrichDone, 25_000, 'Enrichissement APIs');

    // ── 4c. Esquisse automatique (AutoPlanEngine) ────────────────
    log('4c. Génération esquisse automatique…');
    await page.evaluate(() => {
      window.__esquisseDone = false;
      window.__esquisseTime = 0;
      (async () => {
        const t0 = performance.now();
        try {
          const APE = window.AutoPlanEngine;
          const SM = window.SessionManager;
          if (!APE?.generate || !SM) { window.__esquisseDone = true; return; }

          const t = SM.getTerrain();
          if (!t.parcelle_geojson) { window.__esquisseDone = true; return; }

          // Charger TerrainP07Adapter dynamiquement s'il n'est pas sur window
          if (!window.TerrainP07Adapter) {
            try {
              const mod = await import('./services/terrain-p07-adapter.js');
              window.TerrainP07Adapter = mod.default ?? mod;
            } catch (e) { console.warn('[Esquisse] TerrainP07Adapter import failed:', e.message); }
          }

          // Construire l'objet session tel qu'attendu par AutoPlanEngine
          // (format plat : session.terrain, session.phases)
          const sessionData = {
            terrain: t,
            phases: {},
          };
          // Récupérer les données phases existantes
          for (let i = 0; i <= 12; i++) {
            const ph = SM.getPhase(i);
            if (ph) sessionData.phases[i] = ph;
          }

          // Calculer la géométrie locale (pour le plan masse SVG + BpfBridge)
          const TA = window.TerrainP07Adapter;
          if (TA?.process) {
            const adapted = TA.process(t.parcelle_geojson);
            if (adapted.valid) {
              sessionData._parcelLocal = adapted.poly?.map(([x, y]) => ({ x, y })) ?? [];
              sessionData._edgeTypes = TA.inferEdgeTypes?.(adapted.poly, sessionData) ?? [];
            }
          }

          // Programme par défaut : logement collectif
          const prog = { type: 'collectif', niveaux_max: 3 };
          const solutions = await APE.generate(sessionData, prog);

          if (solutions?.length) {
            // Filtrer les vraies solutions (pas X0)
            const real = solutions.filter(s => s.family !== 'X0' && s.bat);
            if (real.length) {
              const best = real.reduce((a, b) => (b.score ?? 0) > (a.score ?? 0) ? b : a, real[0]);
              window._activeProposal = best;

              SM.savePhase(7, {
                auto_plan_solutions: solutions,
                active_solution: best,
                niveaux: best.niveaux,
                surface_plancher_m2: best.spTot ? Math.round(best.spTot) : null,
                gabarit_l_m: best.bat?.l ? Math.round(best.bat.l * 10) / 10 : null,
                gabarit_w_m: best.bat?.w ? Math.round(best.bat.w * 10) / 10 : null,
                gabarit_h_m: best.bat?.h ? Math.round(best.bat.h * 10) / 10 : null,
                emprise_pct: best.empPct,
                permeable_pct: best.permPct,
              }, {}, false);

              console.log('[PDF] Esquisse : ' + real.length + ' variantes, best=' + best.family +
                ' ' + best.niveaux + 'N ' + Math.round(best.spTot ?? 0) + 'm² score=' + (best.score?.toFixed(2) ?? '—'));
            } else {
              console.log('[PDF] AutoPlan : solutions non-constructibles uniquement');
            }
          } else {
            console.log('[PDF] AutoPlan : aucune solution');
          }
        } catch (e) { console.warn('[Esquisse] ' + e.message); }
        window.__esquisseTime = Math.round(performance.now() - t0);
        window.__esquisseDone = true;
      })();
    });
    await waitFor(page, () => window.__esquisseDone, 15_000, 'Esquisse auto');
    const esqTime = await page.evaluate(() => window.__esquisseTime);
    log(`  ⏱ AutoPlanEngine : ${esqTime}ms`);

    // ── 5. Initialiser Mapbox pour les captures cartes ─────────
    log('5. Init Mapbox pour captures…');
    const mapReady = await page.evaluate(() => {
      return new Promise(async (resolve) => {
        const timeout = setTimeout(() => resolve(false), 20000);
        try {
          const token = localStorage.getItem('terlab_mapbox_token');
          if (!token) { clearTimeout(timeout); resolve(false); return; }

          const MV = window.MapViewer ?? window.TerlabMap;
          if (!MV?.init) { clearTimeout(timeout); resolve(false); return; }

          // Créer un conteneur map si absent
          let mapDiv = document.getElementById('map');
          if (!mapDiv) {
            mapDiv = document.createElement('div');
            mapDiv.id = 'map';
            mapDiv.style.cssText = 'position:absolute;top:0;left:0;width:1200px;height:800px;opacity:0;pointer-events:none;z-index:-1';
            document.body.appendChild(mapDiv);
          }

          const t = window.SessionManager?.getTerrain?.() ?? {};
          const center = (t.lng && t.lat) ? [parseFloat(t.lng), parseFloat(t.lat)] : [55.536, -21.115];

          await MV.init({
            containerId: 'map',
            token,
            mode: 'satellite',
            zoom: 17,
            pitch: 0,
            bearing: 0,
            center,
          });

          // Attendre que la carte soit idle
          const map = MV.getMap?.() ?? MV._map;
          if (map) {
            const waitIdle = () => new Promise(r => {
              if (map.loaded?.()) return r();
              map.once('idle', r);
              setTimeout(r, 8000);
            });
            await waitIdle();
            clearTimeout(timeout);
            resolve(true);
          } else {
            clearTimeout(timeout);
            resolve(false);
          }
        } catch (e) {
          console.warn('[MapInit]', e.message);
          clearTimeout(timeout);
          resolve(false);
        }
      });
    });
    // Ajouter marqueur projet + contour parcelle (SANS couche PPR pour ne pas ralentir les captures)
    if (mapReady) {
      await page.evaluate(() => {
        try {
          const map = window.MapViewer?.getMap?.() ?? window.TerlabMap?._map;
          const t = window.SessionManager?.getTerrain?.();
          if (!map || !t?.lng || !t?.lat) return;

          const lng = parseFloat(t.lng), lat = parseFloat(t.lat);

          // Marqueur projet (terracotta)
          if (window.mapboxgl) {
            new mapboxgl.Marker({ color: '#C1652B' }).setLngLat([lng, lat]).addTo(map);
          }

          // Contour parcelle
          if (t.parcelle_geojson && !map.getLayer('parcelle-outline')) {
            map.addSource('parcelle-outline', { type: 'geojson', data: { type: 'Feature', geometry: t.parcelle_geojson, properties: {} } });
            map.addLayer({ id: 'parcelle-outline', type: 'line', source: 'parcelle-outline', paint: { 'line-color': '#C1652B', 'line-width': 3 } });
            map.addLayer({ id: 'parcelle-fill', type: 'fill', source: 'parcelle-outline', paint: { 'fill-color': '#C1652B', 'fill-opacity': 0.15 } });
          }
        } catch (e) { console.warn('[Map] Setup:', e.message); }
      });
      await page.evaluate(() => new Promise(resolve => {
        const map = window.MapViewer?.getMap?.() ?? window.TerlabMap?._map;
        if (!map) return resolve();
        map.once('idle', resolve);
        setTimeout(resolve, 4000);
      }));
    }
    log(mapReady ? '  ✓ Mapbox prêt pour captures' : '  ⚠ Mapbox non disponible — placeholders SVG');

    // ── 6. Générer le HTML des planches ─────────────────────────
    log('6. Génération PDF…');

    // Patcher ExportEngine pour capturer le HTML au lieu de print()
    const pdfHtml = await page.evaluate(() => {
      return new Promise(async (resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('PDF gen timeout')), 60000);
        try {
          const engine = window.TerlabExport ?? window.ExportEngine ?? window.TERLAB?.Export;
          if (!engine) throw new Error('ExportEngine introuvable');

          const session = window.SessionManager;
          const terrainRaw = session?.getTerrain?.() ?? {};

          // Auto-enrichissement (avec timeout interne)
          let enrichResult;
          try {
            enrichResult = await Promise.race([
              engine._autoEnrich(session, terrainRaw),
              new Promise((_, rej) => setTimeout(() => rej(new Error('autoEnrich timeout')), 25000))
            ]);
          } catch (e) {
            console.warn('[PDF] autoEnrich failed:', e.message);
            enrichResult = { terrain: terrainRaw, phases: {}, autoFields: new Set() };
          }
          const terrain = enrichResult.terrain;
          engine._autoFields = enrichResult.autoFields;
          engine._enrichedPhases = enrichResult.phases;

          // Captures cartes Mapbox (avec timeout)
          let mapCaptures = {};
          try {
            const map = window.MapViewer?.getMap?.() ?? window.TerlabMap?._map;
            if (map) {
              // Attendre idle si pas encore chargée
              if (!map.loaded?.()) {
                await new Promise(r => { map.once('idle', r); setTimeout(r, 6000); });
              }
              // Import dynamique du module MapCapture
              let MC = window.MapCapture;
              if (!MC) {
                try {
                  const mod = await import('./components/map-capture.js');
                  MC = mod.default ?? mod;
                } catch { /* ok */ }
              }
              if (MC?.captureAll) {
                mapCaptures = await Promise.race([
                  MC.captureAll(session),
                  new Promise(r => setTimeout(() => r({}), 20000))
                ]);

                // Après les captures standard → ajouter couche PPR PEIGEO + capture contexte élargi
                try {
                  const t = session?.getTerrain?.() ?? {};
                  const coords = t.lng && t.lat ? [parseFloat(t.lng), parseFloat(t.lat)] : null;
                  if (coords) {
                    // Ajouter la couche PPR WMS
                    if (!map.getSource('ppr-peigeo')) {
                      const pprCfg = window.PPRService?.getPPRSourceConfig?.();
                      if (pprCfg) {
                        map.addSource('ppr-peigeo', pprCfg);
                        map.addLayer({ id: 'ppr-layer', type: 'raster', source: 'ppr-peigeo', paint: { 'raster-opacity': 0.6 } });
                      }
                    }
                    // PPR vue rapprochée (zoom 14)
                    map.jumpTo({ center: coords, zoom: 14, pitch: 0, bearing: 0 });
                    await new Promise(r => { map.once('idle', r); setTimeout(r, 6000); });
                    mapCaptures.p03_ppr = map.getCanvas().toDataURL('image/jpeg', 0.92);

                    // PPR contexte élargi (zoom 12)
                    map.jumpTo({ center: coords, zoom: 12, pitch: 0, bearing: 0 });
                    await new Promise(r => { map.once('idle', r); setTimeout(r, 5000); });
                    mapCaptures.p03_ppr_context = map.getCanvas().toDataURL('image/jpeg', 0.92);
                  }
                } catch (e) { console.warn('[PDF] PPR capture:', e.message); }

                const capKeys = Object.keys(mapCaptures).filter(k => mapCaptures[k]);
                console.log(`[PDF] MapCapture : ${capKeys.length} vues — ${capKeys.join(', ')}`);
              }
            }
          } catch (e) { console.warn('[PDF] MapCapture error:', e.message); }

          // Capture visuels DOM (certains existeront, d'autres non en headless)
          let visuals = {};
          try { visuals = await engine._captureVisuals(); } catch { /* ok */ }

          // ── Génération visuels programmatiques (headless) ──────
          const CSR = window.CapacityStudyRenderer;
          const proposal = window._activeProposal;

          // Plan masse SVG + végétation BpfBridge
          if (CSR?.renderPlanMasse && proposal && proposal.bat) {
            try {
              const sessionData = { terrain, phases: {} };
              for (let i = 0; i <= 12; i++) {
                const ph = session?.getPhase?.(i);
                if (ph) sessionData.phases[i] = ph;
              }

              // Recalculer la géométrie locale pour BpfBridge
              const TA = window.TerrainP07Adapter;
              if (TA?.process && terrain.parcelle_geojson) {
                const adapted = TA.process(terrain.parcelle_geojson);
                if (adapted.valid) {
                  sessionData._parcelLocal = adapted.poly?.map(([x, y]) => ({ x, y })) ?? [];
                  sessionData._edgeTypes = TA.inferEdgeTypes?.(adapted.poly, sessionData) ?? [];
                }
              }

              let svgStr = CSR.renderPlanMasse(sessionData, proposal, null, null, null);

              // Enrichir le SVG avec la végétation BpfBridge
              if (svgStr && svgStr.length > 100) {
                try {
                  const BPF = window.BpfBridge;
                  if (BPF?.generate && sessionData._parcelLocal?.length >= 3) {
                    const buildingPoly = [
                      { x: proposal.bat.x, y: proposal.bat.y },
                      { x: proposal.bat.x + proposal.bat.w, y: proposal.bat.y },
                      { x: proposal.bat.x + proposal.bat.w, y: proposal.bat.y + proposal.bat.l },
                      { x: proposal.bat.x, y: proposal.bat.y + proposal.bat.l },
                    ];
                    const bpfResult = await BPF.generate(sessionData, sessionData._parcelLocal, sessionData._edgeTypes ?? [], buildingPoly);
                    if (bpfResult?.plants?.length) {
                      // Injecter les arbres dans le SVG avant </svg>
                      let treeSvg = '';
                      for (const p of bpfResult.plants) {
                        const r = p.canopyRadius ?? 2;
                        const color = p.strate === 'arbre' ? '#2D5A27' : p.strate === 'arbuste' ? '#4A7C3F' : '#6B9B5E';
                        const opacity = p.strate === 'arbre' ? 0.35 : 0.25;
                        treeSvg += `<circle cx="${p.x}" cy="${-(p.y)}" r="${r}" fill="${color}" fill-opacity="${opacity}" stroke="${color}" stroke-width="0.1" stroke-opacity="0.5"/>`;
                      }
                      for (const a of (bpfResult.amenities ?? [])) {
                        treeSvg += `<rect x="${a.x - (a.w??2)/2}" y="${-(a.y + (a.h??2)/2)}" width="${a.w??2}" height="${a.h??2}" fill="#D4A574" fill-opacity="0.3" stroke="#B8956A" stroke-width="0.1" rx="0.3"/>`;
                        treeSvg += `<text x="${a.x}" y="${-(a.y)}" text-anchor="middle" font-size="0.7" fill="#8B6A20">${a.label ?? ''}</text>`;
                      }
                      svgStr = svgStr.replace('</svg>', treeSvg + '</svg>');

                      // Stocker métriques BpfBridge pour la planche 4
                      window.__bpfMetrics = {
                        arbres_count: bpfResult.plants.filter(p => p.strate === 'arbre').length,
                        vegetation_m2: Math.round(bpfResult.plants.reduce((s, p) => s + Math.PI * (p.canopyRadius ?? 2) ** 2, 0)),
                        amenites: (bpfResult.amenities ?? []).map(a => a.label).filter(Boolean),
                      };
                      console.log('[PDF] BpfBridge : ' + bpfResult.plants.length + ' plantes, ' + (bpfResult.amenities?.length ?? 0) + ' amenites');
                    }
                  }
                } catch (e) { console.warn('[PDF] BpfBridge:', e.message); }

                const blob = new Blob([svgStr], { type: 'image/svg+xml' });
                visuals.planMasse = await new Promise(r => {
                  const reader = new FileReader();
                  reader.onload = () => r(reader.result);
                  reader.readAsDataURL(blob);
                });
                console.log('[PDF] Plan masse SVG généré : ' + Math.round(svgStr.length / 1024) + 'K');
              }
            } catch (e) { console.warn('[PDF] PlanMasse:', e.message); }
          }

          // Coupe gabarit SVG
          if (CSR?.renderCoupeGabarit && proposal) {
            try {
              const sessionData = { terrain, phases: {} };
              for (let i = 0; i <= 12; i++) {
                const ph = session?.getPhase?.(i);
                if (ph) sessionData.phases[i] = ph;
              }
              const svgStr = CSR.renderCoupeGabarit(sessionData, proposal, null);
              if (svgStr && svgStr.length > 100) {
                const blob = new Blob([svgStr], { type: 'image/svg+xml' });
                visuals.coupeGabarit = await new Promise(r => {
                  const reader = new FileReader();
                  reader.onload = () => r(reader.result);
                  reader.readAsDataURL(blob);
                });
                console.log('[PDF] Coupe gabarit SVG : ' + Math.round(svgStr.length / 1024) + 'K');
              }
            } catch (e) { console.warn('[PDF] CoupeGabarit:', e.message); }
          }

          // Profils terrain depuis LiDAR (si points disponibles)
          if (window.LidarService?._lastPoints || terrain.parcelle_geojson) {
            try {
              const TP = window.TerrainProfile;
              const LS = window.LidarService;
              if (TP?.render && LS?.getProfileFromPoints && LS._lastPoints?.length) {
                const geojson = terrain.parcelle_geojson;
                const coords = geojson?.coordinates?.[0] ?? geojson?.coordinates?.[0]?.[0];
                if (coords?.length >= 2) {
                  // Coupe A : longitudinale (premier→dernier point du polygone)
                  const profileA = LS.getProfileFromPoints(LS._lastPoints, coords[0], coords[Math.floor(coords.length / 2)]);
                  if (profileA?.length > 2) {
                    const tmpDiv = document.createElement('div');
                    tmpDiv.style.cssText = 'position:absolute;left:-9999px;width:700px;height:220px';
                    document.body.appendChild(tmpDiv);
                    const svgA = TP.render(profileA, tmpDiv, { width: 700, height: 220, label: 'Coupe A — Longitudinale' });
                    if (svgA) {
                      const str = TP.toSVGString?.(svgA) ?? new XMLSerializer().serializeToString(svgA);
                      const blob = new Blob([str], { type: 'image/svg+xml' });
                      visuals.sectionA = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(blob); });
                      console.log('[PDF] Section A SVG : ' + Math.round(str.length / 1024) + 'K');
                    }
                    tmpDiv.remove();
                  }

                  // Coupe B : perpendiculaire
                  const mid = Math.floor(coords.length / 4);
                  const profileB = LS.getProfileFromPoints(LS._lastPoints, coords[mid], coords[mid + Math.floor(coords.length / 2)]);
                  if (profileB?.length > 2) {
                    const tmpDiv2 = document.createElement('div');
                    tmpDiv2.style.cssText = 'position:absolute;left:-9999px;width:700px;height:220px';
                    document.body.appendChild(tmpDiv2);
                    const svgB = TP.render(profileB, tmpDiv2, { width: 700, height: 220, label: 'Coupe B — Perpendiculaire' });
                    if (svgB) {
                      const str = TP.toSVGString?.(svgB) ?? new XMLSerializer().serializeToString(svgB);
                      const blob = new Blob([str], { type: 'image/svg+xml' });
                      visuals.sectionB = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(blob); });
                      console.log('[PDF] Section B SVG : ' + Math.round(str.length / 1024) + 'K');
                    }
                    tmpDiv2.remove();
                  }
                }
              }
            } catch (e) { console.warn('[PDF] Sections terrain:', e.message); }
          }

          // ── Terrain 3D (point cloud Three.js depuis LiDAR COPC, fallback SVG) ──
          if (window.LidarService?._lastPoints?.length > 10) {
            try {
              const points = window.LidarService._lastPoints;
              let terrain3dOk = false;

              // Rendu point cloud Three.js direct depuis les points LiDAR
              const THREE = window.THREE;
              if (THREE?.WebGLRenderer) {
                try {
                  const W = 1000, H = 600;
                  const canvas = document.createElement('canvas');
                  canvas.width = W; canvas.height = H;
                  document.body.appendChild(canvas);

                  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
                  renderer.setSize(W, H);
                  renderer.setClearColor(0xF5F0E8, 1); // fond papier TERLAB

                  const scene = new THREE.Scene();
                  scene.fog = new THREE.Fog(0xF5F0E8, 150, 350);

                  // Lumières
                  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
                  const sun = new THREE.DirectionalLight(0xfff5e0, 0.8);
                  sun.position.set(40, 60, 30);
                  scene.add(sun);

                  // Points LiDAR → positions + couleurs
                  const pts = points.filter(p => Array.isArray(p) && p.length >= 3);
                  const n = pts.length;

                  // Centroïde et bbox
                  let cx = 0, cy = 0, cz = 0, zMin = Infinity, zMax = -Infinity;
                  for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; if (p[2] < zMin) zMin = p[2]; if (p[2] > zMax) zMax = p[2]; }
                  cx /= n; cy /= n; cz /= n;
                  const dz = zMax - zMin || 1;

                  // Conversion WGS84 → mètres locaux
                  const mlon = 111132.954 * Math.cos(cy * Math.PI / 180);
                  const mlat = 111132.954;
                  const vExag = Math.min(3, 40 / dz); // exagération verticale adaptative

                  const positions = new Float32Array(n * 3);
                  const colors = new Float32Array(n * 3);
                  for (let i = 0; i < n; i++) {
                    const p = pts[i];
                    positions[i * 3]     = (p[0] - cx) * mlon;
                    positions[i * 3 + 1] = (p[2] - cz) * vExag;
                    positions[i * 3 + 2] = -(p[1] - cy) * mlat;

                    // Couleur altitude : vert bas → brun haut
                    const t = Math.max(0, Math.min(1, (p[2] - zMin) / dz));
                    colors[i * 3]     = 0.18 + t * 0.5;  // R
                    colors[i * 3 + 1] = 0.45 - t * 0.15; // G
                    colors[i * 3 + 2] = 0.15 + t * 0.1;  // B
                  }

                  const geom = new THREE.BufferGeometry();
                  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
                  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
                  geom.computeBoundingSphere();

                  const mat = new THREE.PointsMaterial({ size: 0.8, vertexColors: true, sizeAttenuation: true });
                  const cloud = new THREE.Points(geom, mat);
                  scene.add(cloud);

                  // Caméra axonométrique cadrée
                  const sphere = geom.boundingSphere;
                  const r = sphere.radius || 30;
                  const aspect = W / H;
                  const cam = new THREE.OrthographicCamera(-r * aspect, r * aspect, r, -r, 0.1, r * 10);
                  // Vue axonométrique : 45° azimut, 35° élévation
                  cam.position.set(
                    sphere.center.x + r * 1.2,
                    sphere.center.y + r * 0.9,
                    sphere.center.z + r * 1.2
                  );
                  cam.lookAt(sphere.center);
                  cam.updateProjectionMatrix();

                  renderer.render(scene, cam);
                  const snap = canvas.toDataURL('image/jpeg', 0.88);
                  if (snap.length > 500) {
                    visuals.terrain3d = snap;
                    terrain3dOk = true;
                    console.log('[PDF] Terrain 3D point cloud LiDAR : ' + Math.round(snap.length / 1024) + 'K (' + n + ' pts, dz=' + Math.round(dz) + 'm)');
                  }
                  renderer.dispose();
                  geom.dispose();
                  mat.dispose();
                  canvas.remove();
                } catch (e) { console.warn('[PDF] Three.js point cloud:', e.message); }
              }

              // Fallback : SVG isométrique depuis points LiDAR
              // Points LiDAR = tableaux [lng, lat, z] (pas d'objets)
              if (!terrain3dOk) {
                const groundPts = points.filter(p => Array.isArray(p) && p.length >= 3);
                if (groundPts.length > 5) {
                  // Calculer bbox et normaliser
                  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity, zMin = Infinity, zMax = -Infinity;
                  for (const p of groundPts) {
                    if (p[0] < xMin) xMin = p[0]; if (p[0] > xMax) xMax = p[0];
                    if (p[1] < yMin) yMin = p[1]; if (p[1] > yMax) yMax = p[1];
                    if (p[2] < zMin) zMin = p[2]; if (p[2] > zMax) zMax = p[2];
                  }
                  const dx = xMax - xMin || 1, dy = yMax - yMin || 1, dz = zMax - zMin || 1;
                  const W = 600, H = 400;
                  const scale = Math.min(W * 0.6 / dx, H * 0.6 / dy);
                  const zScale = Math.min(80 / dz, scale * 3); // exagération verticale

                  // Grille de sous-échantillonnage pour un rendu propre
                  const gridN = 30;
                  const grid = Array.from({ length: gridN }, () => Array(gridN).fill(null));
                  for (const p of groundPts) {
                    const gx = Math.min(gridN - 1, Math.floor((p[0] - xMin) / dx * gridN));
                    const gy = Math.min(gridN - 1, Math.floor((p[1] - yMin) / dy * gridN));
                    if (!grid[gy][gx] || p[2] > grid[gy][gx]) grid[gy][gx] = p[2];
                  }
                  // Interpoler les trous
                  for (let y = 0; y < gridN; y++) {
                    for (let x = 0; x < gridN; x++) {
                      if (grid[y][x] === null) {
                        let sum = 0, cnt = 0;
                        for (let dy2 = -2; dy2 <= 2; dy2++) for (let dx2 = -2; dx2 <= 2; dx2++) {
                          const ny = y + dy2, nx = x + dx2;
                          if (ny >= 0 && ny < gridN && nx >= 0 && nx < gridN && grid[ny][nx] !== null) {
                            sum += grid[ny][nx]; cnt++;
                          }
                        }
                        grid[y][x] = cnt > 0 ? sum / cnt : zMin;
                      }
                    }
                  }

                  // Projection isométrique (30°)
                  const iso = (gx, gy, z) => {
                    const wx = (gx / gridN) * dx * scale;
                    const wy = (gy / gridN) * dy * scale;
                    const wz = (z - zMin) * zScale;
                    const ix = (wx - wy) * 0.866 + W / 2;
                    const iy = (wx + wy) * 0.5 - wz + H * 0.7;
                    return [ix, iy];
                  };

                  // Générer les facettes + calculer la bounding box réelle
                  let facets = '';
                  let fxMin = Infinity, fxMax = -Infinity, fyMin = Infinity, fyMax = -Infinity;
                  for (let y = 0; y < gridN - 1; y++) {
                    for (let x = 0; x < gridN - 1; x++) {
                      const z00 = grid[y][x], z10 = grid[y][x + 1], z01 = grid[y + 1][x], z11 = grid[y + 1][x + 1];
                      const pts = [iso(x, y, z00), iso(x+1, y, z10), iso(x+1, y+1, z11), iso(x, y+1, z01)];
                      for (const [px, py] of pts) {
                        if (px < fxMin) fxMin = px; if (px > fxMax) fxMax = px;
                        if (py < fyMin) fyMin = py; if (py > fyMax) fyMax = py;
                      }
                      // Couleur hillshade basée sur la pente locale
                      const slopeX = (z10 - z00 + z11 - z01) / 2;
                      const slopeY = (z01 - z00 + z11 - z10) / 2;
                      const shade = Math.max(0.15, Math.min(0.95, 0.5 + slopeX * 0.3 - slopeY * 0.2));
                      const r = Math.round(46 + shade * 140), g = Math.round(80 + shade * 100), b = Math.round(38 + shade * 80);
                      facets += `<polygon points="${pts.map(p => p.join(',')).join(' ')}" fill="rgb(${r},${g},${b})" stroke="rgb(${r-15},${g-15},${b-15})" stroke-width="0.3"/>`;
                    }
                  }

                  // ViewBox ajusté à la bbox réelle des facettes + marge
                  const pad = 20;
                  const vbX = fxMin - pad, vbY = fyMin - pad;
                  const vbW = (fxMax - fxMin) + pad * 2, vbH = (fyMax - fyMin) + pad * 2 + 20; // +20 pour texte

                  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" style="width:100%;height:100%" preserveAspectRatio="xMidYMid meet">
                    <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#F5F0E8"/>
                    ${facets}
                    <text x="${(fxMin+fxMax)/2}" y="${fyMax+15}" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="8" fill="#6A6860">
                      Terrain 3D · ${groundPts.length} pts LiDAR · denivele ${Math.round(dz)} m
                    </text>
                  </svg>`;

                  const blob = new Blob([svgStr], { type: 'image/svg+xml' });
                  visuals.terrain3d = await new Promise(r => {
                    const reader = new FileReader();
                    reader.onload = () => r(reader.result);
                    reader.readAsDataURL(blob);
                  });
                  console.log('[PDF] Terrain 3D SVG isometrique : ' + Math.round(svgStr.length / 1024) + 'K (' + groundPts.length + ' pts)');
                }
              }
            } catch (e) { console.warn('[PDF] Terrain 3D:', e.message); }
          }

          // Injecter dans engine._visuals pour que _renderPlanche4 les trouve
          if (proposal?.bat) {
            // Enrichir bat avec niveaux/hauteur pour _renderPlanche4
            const enrichedBat = {
              ...proposal.bat,
              niveaux: proposal.niveaux,
              h: proposal.hauteur ?? (proposal.niveaux * 3),
            };
            visuals.activeProposal = {
              ...proposal,
              bat: enrichedBat,
              metrics: {
                emprise_m2: proposal.bat ? Math.round(proposal.bat.w * proposal.bat.l) : null,
                sdp_m2: proposal.spTot ? Math.round(proposal.spTot) : null,
                ces_pct: proposal.empPct ? Math.round(proposal.empPct * 10) / 10 : null,
                permeable_pct: proposal.permPct ? Math.round(proposal.permPct * 10) / 10 : null,
                ...(window.__bpfMetrics ?? {}),
              },
            };
          }
          engine._visuals = visuals;

          // Debug : vérifier que plan masse est dans _visuals
          console.log('[PDF] _visuals.planMasse: ' + (visuals.planMasse ? visuals.planMasse.slice(0, 60) + '...' : 'NULL'));
          console.log('[PDF] _visuals.activeProposal: ' + (visuals.activeProposal ? JSON.stringify(Object.keys(visuals.activeProposal)).slice(0, 100) : 'NULL'));

          const allMaps = { ...mapCaptures, ...visuals };

          // Debug : compter les captures
          const capKeys = Object.keys(allMaps).filter(k => allMaps[k]);
          const capSizes = capKeys.map(k => `${k}:${Math.round((allMaps[k]?.length ?? 0)/1024)}K`);
          console.log(`[PDF] ${capKeys.length} captures — ${capSizes.join(', ')}`);

          // Toujours mode projet pour avoir la planche plan masse
          const pdfMode = 'projet';
          const html = engine._renderAllPlanches(session, terrain, allMaps, pdfMode);

          clearTimeout(timeout);
          resolve(html);
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });
    });

    if (!pdfHtml || pdfHtml.length < 500) throw new Error('HTML planches vide ou trop court');
    log(`  📄 HTML généré : ${(pdfHtml.length / 1024).toFixed(0)} Ko`);

    // ── 7. Rendu PDF via Puppeteer ──────────────────────────────
    log('7. Rendu PDF A4…');

    // Créer une page dédiée avec le template print inline (serve -s redirige .html → index)
    const pdfPage = await browser.newPage();
    const printHtml = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"><title>TERLAB PDF</title>
  <link href="https://cdn.jsdelivr.net/npm/@fontsource/cormorant-garamond@5/400.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/@fontsource/cormorant-garamond@5/600.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@6/400.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/@fontsource/jost@5/300.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/@fontsource/jost@5/400.min.css" rel="stylesheet">
  <link rel="stylesheet" href="http://localhost:${PORT}/assets/print.css">
</head>
<body><div id="terlab-print-root"></div></body>
</html>`;
    await pdfPage.setContent(printHtml, { waitUntil: 'networkidle0' });

    // Injecter le HTML des planches
    await pdfPage.evaluate((html) => {
      document.getElementById('terlab-print-root').innerHTML = html;
    }, pdfHtml);

    // Attendre les fonts + toutes les images base64 chargées
    await pdfPage.evaluate(() => document.fonts.ready);
    await pdfPage.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return Promise.all(imgs.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(r => { img.onload = r; img.onerror = r; setTimeout(r, 5000); });
      }));
    });
    await pdfPage.evaluate(() => new Promise(r => setTimeout(r, 2000)));

    // Générer le PDF
    const communeSlug = (result.commune ?? 'inconnu').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
    const fileName = `TERLAB_${communeSlug}_${result.parcelle ?? 'XX'}_${runId}.pdf`;
    const pdfPath = path.join(OUT_DIR, fileName);

    await pdfPage.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
      preferCSSPageSize: true,
    });

    await pdfPage.close();

    result.pdfPath = pdfPath;
    result.success = true;
    const sizeKb = (fs.statSync(pdfPath).size / 1024).toFixed(0);
    log(`  ✅ PDF sauvegardé : ${fileName} (${sizeKb} Ko)`);

  } catch (e) {
    err(`Run #${runIndex} échoué : ${e.message}`);
    result.error = e.message;

    // Screenshot de debug
    try {
      const debugPath = path.join(OUT_DIR, `debug_${runId}.png`);
      await page.screenshot({ path: debugPath, fullPage: true });
      log(`  📸 Screenshot debug : ${debugPath}`);
    } catch { /* ignore */ }
  }

  await page.close();
  return result;
}

// ── Main ────────────────────────────────────────────────────────
(async () => {
  log(`TERLAB Random Terrain → PDF`);
  const tokenPreview = MAPBOX_TOKEN.slice(0, 12) + '…' + MAPBOX_TOKEN.slice(-6);
  log(`Terrains : ${COUNT} | Headed : ${HEADED} | LiDAR : ${!NO_LIDAR} | Port : ${PORT}`);
  log(`Token Mapbox : ${tokenPreview}${process.env.MAPBOX_TOKEN ? ' (depuis .env)' : ' (fallback)'}`);
  log(`Output : ${OUT_DIR}\n`);

  // Vérifier que Puppeteer est installé
  try { require('puppeteer'); } catch {
    err('Puppeteer non installé. Exécuter : npm install');
    process.exit(1);
  }

  // Démarrer le serveur local
  let server;
  try {
    server = await startServer();
  } catch (e) {
    err(`Impossible de démarrer le serveur : ${e.message}`);
    process.exit(1);
  }

  // Lancer le navigateur
  const browser = await puppeteer.launch({
    headless: HEADED ? false : 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',            // CORS pour les APIs
      '--disable-features=IsolateOrigins',
      '--disable-site-isolation-trials',
      '--enable-webgl',
      '--window-size=1400,900',
    ],
    defaultViewport: null,
  });

  const results = [];

  for (let i = 1; i <= COUNT; i++) {
    const result = await processOneTerrain(browser, i);
    results.push(result);

    if (i < COUNT) {
      log(`\n  ⏸ Pause ${T.BETWEEN_RUNS / 1000}s avant le prochain terrain…`);
      await new Promise(r => setTimeout(r, T.BETWEEN_RUNS));
    }
  }

  // ── Résumé ──────────────────────────────────────────────────
  log(`\n${'═'.repeat(60)}`);
  log('RÉSUMÉ');
  log('═'.repeat(60));

  const success = results.filter(r => r.success);
  const failed  = results.filter(r => !r.success);

  for (const r of results) {
    const icon = r.success ? '✅' : '❌';
    const info = r.commune ? `${r.commune} ${r.parcelle}` : 'N/A';
    const file = r.pdfPath ? path.basename(r.pdfPath) : (r.error ?? 'erreur');
    log(`  ${icon} ${info} → ${file}`);
  }

  log(`\n  Succès : ${success.length}/${COUNT} | Échecs : ${failed.length}/${COUNT}`);
  log(`  Dossier : ${OUT_DIR}`);

  // Cleanup
  await browser.close();
  if (server) {
    server.kill();
    log('Serveur arrêté.');
  }

  process.exit(failed.length > 0 ? 1 : 0);
})();
