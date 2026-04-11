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

    // Capturer la sortie de serve uniquement pour la joindre au message d'erreur en cas d'echec
    let serveOut = '';
    srv.stdout?.on('data', (chunk) => { serveOut += chunk.toString(); });
    srv.stderr?.on('data', (chunk) => { serveOut += chunk.toString(); });

    // Attendre que le port soit reellement accessible via HTTP
    const http = require('http');
    const checkReady = (retries = 0) => {
      if (retries > 120) {
        const tail = serveOut.slice(-800) || '(aucune sortie de serve)';
        reject(new Error(`Serveur non pret apres 60s. Sortie serve:\n${tail}`));
        return;
      }
      const req = http.get(`http://localhost:${PORT}/`, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 400) {
          log(`Serveur local pret sur :${PORT}`);
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

            // Reverse geocoding adresse (centroïde parcelle) — IGN BAN puis fallback Nominatim
            let adresse = '';
            try {
              const banResp = await fetch(`https://data.geopf.fr/geocodage/reverse?lon=${cLng}&lat=${cLat}&limit=1&index=address`, { signal: AbortSignal.timeout(6000) });
              const banData = await banResp.json();
              adresse = banData?.features?.[0]?.properties?.label ?? '';
            } catch { /* fallback */ }
            if (!adresse) {
              try {
                const nomResp = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${cLat}&lon=${cLng}&format=json&zoom=18`, { headers: { 'Accept-Language': 'fr' }, signal: AbortSignal.timeout(5000) });
                const nomData = await nomResp.json();
                adresse = nomData?.display_name ?? '';
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
              adresse: adresse || undefined,
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
            // classes 2 (sol) + 3,4,5 (vegetation) + 6 (batiments/toitures)
            // pour que le rendu 3D montre relief + arbres + toits
            const pts = await window.LidarService.getPointsForParcel(t.parcelle_geojson, 30, { classes: '2,3,4,5,6' });
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

              // Dimensions audit : depuis l'AABB d'ensemble (cohérent pour multi-blocs)
              const bestBat = best.bat ?? null;
              SM.savePhase(7, {
                auto_plan_solutions: solutions,
                active_solution: best,
                niveaux: best.niveaux,
                surface_plancher_m2: best.spTot ? Math.round(best.spTot) : null,
                gabarit_l_m: bestBat?.l ? Math.round(bestBat.l * 10) / 10 : null,
                gabarit_w_m: bestBat?.w ? Math.round(bestBat.w * 10) / 10 : null,
                gabarit_h_m: best.hauteur ? Math.round(best.hauteur * 10) / 10 : null,
                nb_blocs: best.blocs?.length ?? 1,
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

                    // Retirer la couche PPR avant d'ajouter la geologie BRGM
                    if (map.getLayer('ppr-layer')) map.removeLayer('ppr-layer');
                    if (map.getSource('ppr-peigeo')) map.removeSource('ppr-peigeo');

                    // ── Couche geologie BRGM WMS ──
                    if (!map.getSource('brgm-geol')) {
                      map.addSource('brgm-geol', {
                        type: 'raster',
                        tiles: [
                          'https://geoservices.brgm.fr/geologie?'
                          + 'SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap'
                          + '&LAYERS=GEOL_REU_50K&STYLES='
                          + '&FORMAT=image/png&TRANSPARENT=TRUE'
                          + '&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}'
                        ],
                        tileSize: 256,
                      });
                      map.addLayer({
                        id: 'brgm-geol-layer',
                        type: 'raster',
                        source: 'brgm-geol',
                        paint: { 'raster-opacity': 0.65 },
                      });
                    }
                    // Geologie vue centree (zoom 14)
                    map.jumpTo({ center: coords, zoom: 14, pitch: 0, bearing: 0 });
                    await new Promise(r => { map.once('idle', r); setTimeout(r, 7000); });
                    mapCaptures.p02_geologie = map.getCanvas().toDataURL('image/jpeg', 0.92);
                    console.log('[PDF] Capture geologie BRGM : ' + Math.round(mapCaptures.p02_geologie.length / 1024) + 'K');

                    // Cleanup
                    if (map.getLayer('brgm-geol-layer')) map.removeLayer('brgm-geol-layer');
                    if (map.getSource('brgm-geol')) map.removeSource('brgm-geol');
                  }
                } catch (e) { console.warn('[PDF] PPR/Geol capture:', e.message); }

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

              // Recalculer la géométrie locale pour BpfBridge / GIEPPlanService
              const TA = window.TerrainP07Adapter;
              if (TA?.process && terrain.parcelle_geojson) {
                const adapted = TA.process(terrain.parcelle_geojson);
                if (adapted.valid) {
                  sessionData._parcelLocal = adapted.poly?.map(([x, y]) => ({ x, y })) ?? [];
                  sessionData._edgeTypes = TA.inferEdgeTypes?.(adapted.poly, sessionData) ?? [];
                  // Propager au SessionManager : _renderPlancheGIEP lit session._parcelLocal
                  if (session) {
                    session._parcelLocal = sessionData._parcelLocal;
                    session._edgeTypes   = sessionData._edgeTypes;
                  }
                }
              }

              let svgStr = CSR.renderPlanMasse(sessionData, proposal, null, null, null);

              // Enrichir le SVG avec la végétation BpfBridge
              if (svgStr && svgStr.length > 100) {
                try {
                  const BPF = window.BpfBridge;
                  if (BPF?.generate && sessionData._parcelLocal?.length >= 3) {
                    // BPF v2 : utiliser les blocs réels (polygons tournés / multi)
                    // Si la proposal n'a pas de blocs[], fallback sur l'AABB legacy
                    let buildingPoly;
                    if (proposal.blocs?.length) {
                      // Pour BPF, on prend l'union AABB (BpfBridge attend un seul polygon)
                      let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
                      for (const b of proposal.blocs) {
                        for (const p of (b.polygon ?? [])) {
                          if (p.x < xMin) xMin = p.x;
                          if (p.x > xMax) xMax = p.x;
                          if (p.y < yMin) yMin = p.y;
                          if (p.y > yMax) yMax = p.y;
                        }
                      }
                      buildingPoly = [
                        { x: xMin, y: yMin }, { x: xMax, y: yMin },
                        { x: xMax, y: yMax }, { x: xMin, y: yMax },
                      ];
                    } else if (proposal.bat) {
                      buildingPoly = [
                        { x: proposal.bat.x, y: proposal.bat.y },
                        { x: proposal.bat.x + proposal.bat.w, y: proposal.bat.y },
                        { x: proposal.bat.x + proposal.bat.w, y: proposal.bat.y + proposal.bat.l },
                        { x: proposal.bat.x, y: proposal.bat.y + proposal.bat.l },
                      ];
                    } else {
                      buildingPoly = null;
                    }
                    const bpfResult = buildingPoly
                      ? await BPF.generate(sessionData, sessionData._parcelLocal, sessionData._edgeTypes ?? [], buildingPoly)
                      : null;
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

          // ── Plan d'état des lieux + plan masse projet (SitePlanRenderer) ──
          // Génère deux planches vectorielles (sans projet et avec projet) à
          // l'échelle architecte normalisée. Réutilise les caches BDTOPO/cadastre
          // déjà chargés par les phases.
          try {
            const mod = await import('/utils/site-plan-renderer.js');
            const SPR = mod.default;
            const sessionFull = window.SessionManager?.getSession?.()
                              ?? { terrain: window.SessionManager?.getTerrain?.() ?? terrain };
            // Hydrate la session avec le bâtiment courant si dispo
            if (window.EsquisseCanvas?._buildingAABB) {
              sessionFull.phases = sessionFull.phases ?? {};
              sessionFull.phases[7] = sessionFull.phases[7] ?? { data: {} };
              sessionFull.phases[7].data.building_aabb = window.EsquisseCanvas._buildingAABB;
              sessionFull.phases[7].data.envZones      = window.EsquisseCanvas._envZones;
            }
            // 1. État des lieux (sans projet) — utilisable en P04
            const etat = await SPR.build(sessionFull, { withProject: false });
            if (etat?.svg && etat.svg.length > 200) {
              const blob = new Blob([etat.svg], { type: 'image/svg+xml' });
              visuals.siteEtatDesLieux = await new Promise(r => {
                const reader = new FileReader();
                reader.onload = () => r(reader.result);
                reader.readAsDataURL(blob);
              });
              // Planche 4 (Plan masse & Conformite) lit visuals.cadastreVector
              // En mode headless, EsquisseCanvas n'est pas monte donc
              // _captureCadastreVector renvoie null. On reinjecte le plan
              // SPR (cadastre WFS + BDTOPO + NGR aux sommets) a la place.
              if (!visuals.cadastreVector) visuals.cadastreVector = visuals.siteEtatDesLieux;
              console.log('[PDF] Site état des lieux SVG : ' + Math.round(etat.svg.length / 1024) + 'K · 1/' + etat.meta.scale + ' ' + etat.meta.format
                + (etat.meta.layers?.length ? ' · couches: ' + etat.meta.layers.join(',') : ''));
            }
            // 2. Plan masse projet (avec bâtiment + reculs + végétation)
            const projet = await SPR.build(sessionFull, {
              withProject: true,
              cache: { cadastre: etat?.meta?._cadastre, bdtopoBat: etat?.meta?._bdtopoBat, bdtopoRoutes: etat?.meta?._bdtopoRoutes },
            });
            if (projet?.svg && projet.svg.length > 200) {
              const blob = new Blob([projet.svg], { type: 'image/svg+xml' });
              visuals.sitePlanMasseProjet = await new Promise(r => {
                const reader = new FileReader();
                reader.onload = () => r(reader.result);
                reader.readAsDataURL(blob);
              });
              console.log('[PDF] Site plan masse projet SVG : ' + Math.round(projet.svg.length / 1024) + 'K');
            }
          } catch (e) { console.warn('[PDF] SitePlanRenderer:', e.message); }

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
          // Bug fixé : LidarService.getProfileFromPoints() renvoie {distance_m, altitude_m}
          // mais TerrainProfile.render() lit {distance, altitude} → remap obligatoire,
          // sinon SVG produit avec NaN partout (invisible).
          if (window.LidarService?._lastPoints || terrain.parcelle_geojson) {
            try {
              const TP = window.TerrainProfile;
              const LS = window.LidarService;
              if (TP?.render && LS?.getProfileFromPoints && LS._lastPoints?.length) {
                const geojson = terrain.parcelle_geojson;
                const coords = geojson?.coordinates?.[0] ?? geojson?.coordinates?.[0]?.[0];
                if (coords?.length >= 2) {
                  // Helper : profil LiDAR → SVG dataURL via TerrainProfile.render
                  const renderProfile = async (start, end, title) => {
                    const profile = LS.getProfileFromPoints(LS._lastPoints, start, end, 8);
                    if (!profile?.length || profile.length < 3) return null;
                    // Remap distance_m/altitude_m → distance/altitude
                    const data = profile.map(p => ({ distance: p.distance_m, altitude: p.altitude_m }));
                    const tmpDiv = document.createElement('div');
                    tmpDiv.style.cssText = 'position:absolute;left:-9999px;width:700px;height:220px';
                    document.body.appendChild(tmpDiv);
                    try {
                      const svg = TP.render(data, tmpDiv, { width: 700, height: 220, title });
                      if (!svg) return null;
                      const str = TP.toSVGString?.(svg) ?? new XMLSerializer().serializeToString(svg);
                      const blob = new Blob([str], { type: 'image/svg+xml' });
                      return await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(blob); });
                    } finally {
                      tmpDiv.remove();
                    }
                  };

                  // Coupe A : axe long (sommet 0 → sommet opposé)
                  const idxOppA = Math.floor(coords.length / 2);
                  const dataUrlA = await renderProfile(coords[0], coords[idxOppA], 'Coupe A — Longitudinale');
                  if (dataUrlA) {
                    visuals.sectionA = dataUrlA;
                    console.log('[PDF] Section A SVG : ' + Math.round(dataUrlA.length / 1024) + 'K');
                  }

                  // Coupe B : axe perpendiculaire (sommet 1/4 → sommet 3/4)
                  const idxStartB = Math.floor(coords.length / 4);
                  const idxEndB   = Math.floor(coords.length * 3 / 4);
                  const dataUrlB = await renderProfile(coords[idxStartB], coords[idxEndB], 'Coupe B — Perpendiculaire');
                  if (dataUrlB) {
                    visuals.sectionB = dataUrlB;
                    console.log('[PDF] Section B SVG : ' + Math.round(dataUrlB.length / 1024) + 'K');
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

              // ── Helper : récupérer l'orthophoto IGN WMS et préparer le sampling RGB
              // Inspiré de Lidar-fetcher/lidar-server/server.py — fetch_orthophoto +
              // get_ortho_color, mais 100% navigateur (fetch + canvas + getImageData).
              // Couche IGN BD ORTHO 50cm/px, EPSG:3857 Web Mercator.
              async function _fetchOrthoForLidar(ptsLngLat) {
                let lngMin = Infinity, lngMax = -Infinity, latMin = Infinity, latMax = -Infinity;
                for (const p of ptsLngLat) {
                  if (p[0] < lngMin) lngMin = p[0]; if (p[0] > lngMax) lngMax = p[0];
                  if (p[1] < latMin) latMin = p[1]; if (p[1] > latMax) latMax = p[1];
                }
                // Marge 5 % pour couvrir les points en bord
                const dlng = (lngMax - lngMin) * 0.05;
                const dlat = (latMax - latMin) * 0.05;
                lngMin -= dlng; lngMax += dlng; latMin -= dlat; latMax += dlat;

                const R = 6378137;
                const toMerc = (lng, lat) => [
                  R * lng * Math.PI / 180,
                  R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)),
                ];
                const [wmMinX, wmMinY] = toMerc(lngMin, latMin);
                const [wmMaxX, wmMaxY] = toMerc(lngMax, latMax);

                // Cible 50 cm/px, plafond 1024 px côté max
                const widthM = wmMaxX - wmMinX;
                const heightM = wmMaxY - wmMinY;
                const targetRes = 0.5;
                let widthPx = Math.max(64, Math.round(widthM / targetRes));
                let heightPx = Math.max(64, Math.round(heightM / targetRes));
                const maxPx = 1024;
                if (Math.max(widthPx, heightPx) > maxPx) {
                  const k = maxPx / Math.max(widthPx, heightPx);
                  widthPx = Math.max(64, Math.round(widthPx * k));
                  heightPx = Math.max(64, Math.round(heightPx * k));
                }

                const params = new URLSearchParams({
                  SERVICE: 'WMS',
                  VERSION: '1.3.0',
                  REQUEST: 'GetMap',
                  LAYERS: 'ORTHOIMAGERY.ORTHOPHOTOS',
                  CRS: 'EPSG:3857',
                  BBOX: `${wmMinX},${wmMinY},${wmMaxX},${wmMaxY}`,
                  WIDTH: String(widthPx),
                  HEIGHT: String(heightPx),
                  FORMAT: 'image/jpeg',
                  STYLES: '',
                });
                const url = `https://data.geopf.fr/wms-r?${params}`;
                const resp = await fetch(url);
                if (!resp.ok) throw new Error('WMS HTTP ' + resp.status);
                const blob = await resp.blob();
                if (blob.size < 1000) throw new Error('WMS blob trop petit (' + blob.size + ' o)');
                const bitmap = await createImageBitmap(blob);

                const c = document.createElement('canvas');
                c.width = widthPx; c.height = heightPx;
                const ctx = c.getContext('2d');
                ctx.drawImage(bitmap, 0, 0);
                const imgData = ctx.getImageData(0, 0, widthPx, heightPx);
                bitmap.close?.();

                return {
                  data: imgData.data,
                  widthPx, heightPx,
                  wmMinX, wmMinY, wmMaxX, wmMaxY,
                  toMerc,
                };
              }

              // Tenter de récupérer l'orthophoto (non bloquant : fallback colormap altitude)
              let ortho = null;
              try {
                ortho = await _fetchOrthoForLidar(points.filter(p => Array.isArray(p) && p.length >= 3));
                console.log('[PDF] Ortho LiDAR : ' + ortho.widthPx + 'x' + ortho.heightPx + 'px depuis IGN BD ORTHO');
              } catch (e) {
                console.warn('[PDF] Ortho LiDAR fetch échoué, fallback colormap altitude :', e.message);
              }

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

                  // Lumières (sans effet sur PointsMaterial mais utiles pour de futurs meshes)
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
                  let orthoSampled = 0;
                  for (let i = 0; i < n; i++) {
                    const p = pts[i];
                    positions[i * 3]     = (p[0] - cx) * mlon;
                    positions[i * 3 + 1] = (p[2] - cz) * vExag;
                    positions[i * 3 + 2] = -(p[1] - cy) * mlat;

                    // Couleur : sample orthophoto si dispo, sinon colormap altitude
                    let r0, g0, b0;
                    if (ortho) {
                      const [mx, my] = ortho.toMerc(p[0], p[1]);
                      const fx = (mx - ortho.wmMinX) / (ortho.wmMaxX - ortho.wmMinX);
                      const fy = (ortho.wmMaxY - my) / (ortho.wmMaxY - ortho.wmMinY); // Y inversé image
                      const px = Math.max(0, Math.min(ortho.widthPx - 1, Math.floor(fx * ortho.widthPx)));
                      const py = Math.max(0, Math.min(ortho.heightPx - 1, Math.floor(fy * ortho.heightPx)));
                      const idx = (py * ortho.widthPx + px) * 4;
                      r0 = ortho.data[idx]     / 255;
                      g0 = ortho.data[idx + 1] / 255;
                      b0 = ortho.data[idx + 2] / 255;
                      orthoSampled++;
                    } else {
                      // Fallback : colormap altitude (vert bas → brun haut)
                      const t = Math.max(0, Math.min(1, (p[2] - zMin) / dz));
                      r0 = 0.18 + t * 0.5;
                      g0 = 0.45 - t * 0.15;
                      b0 = 0.15 + t * 0.1;
                    }
                    colors[i * 3]     = r0;
                    colors[i * 3 + 1] = g0;
                    colors[i * 3 + 2] = b0;
                  }

                  const geom = new THREE.BufferGeometry();
                  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
                  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
                  geom.computeBoundingSphere();

                  // Taille de point augmentée pour qu'on perçoive bien la texture sat
                  const mat = new THREE.PointsMaterial({ size: 1.1, vertexColors: true, sizeAttenuation: true });
                  const cloud = new THREE.Points(geom, mat);
                  scene.add(cloud);

                  // Caméra axonométrique cadrée — vue en plongée (~38° élévation)
                  // pour bien lire le relief + toitures + canopée
                  const sphere = geom.boundingSphere;
                  const r = sphere.radius || 30;
                  const aspect = W / H;
                  const cam = new THREE.OrthographicCamera(-r * aspect, r * aspect, r, -r, 0.1, r * 10);
                  cam.position.set(
                    sphere.center.x + r * 1.3,
                    sphere.center.y + r * 1.4,   // ↑ depuis 0.6 → +20° de plongée (~38°)
                    sphere.center.z + r * 1.3,
                  );
                  cam.lookAt(sphere.center);
                  cam.updateProjectionMatrix();

                  renderer.render(scene, cam);
                  const snap = canvas.toDataURL('image/jpeg', 0.88);
                  if (snap.length > 500) {
                    visuals.terrain3d = snap;
                    terrain3dOk = true;
                    const orthoTag = ortho ? `, ortho ${orthoSampled}/${n}` : ', colormap altitude';
                    console.log('[PDF] Terrain 3D vue oblique LiDAR : ' + Math.round(snap.length / 1024) + 'K (' + n + ' pts, dz=' + Math.round(dz) + 'm' + orthoTag + ')');
                  }

                  // ── VUE 2 — Vue oblique 60° depuis l'OPPOSE de la vue 1 ──
                  // Vue 1 = position (+1.3r, +1.4r, +1.3r), elevation ~38°
                  // Vue 2 = direction OPPOSEE (-1.3r, ?, -1.3r), elevation ~60°
                  // sin(60°) ≈ 0.866 → composante Y ≈ 0.866 * sqrt(2 * 1.3²) ≈ 1.59
                  // Cadrage plus serre (×0.95) pour mieux lire les details bati.
                  const aspectOblique2 = W / H;
                  const rOblique2 = r * 0.95;
                  cam.left   = -rOblique2 * aspectOblique2;
                  cam.right  =  rOblique2 * aspectOblique2;
                  cam.top    =  rOblique2;
                  cam.bottom = -rOblique2;
                  cam.up.set(0, 1, 0); // Y up classique pour vue oblique
                  cam.position.set(
                    sphere.center.x - r * 1.0,
                    sphere.center.y + r * 1.95,  // 60° d'elevation
                    sphere.center.z - r * 1.0,
                  );
                  cam.lookAt(sphere.center);
                  cam.updateProjectionMatrix();
                  renderer.render(scene, cam);
                  const snapOblique2 = canvas.toDataURL('image/jpeg', 0.88);
                  if (snapOblique2.length > 500) {
                    visuals.terrain3dTop = snapOblique2; // garde la cle pour compat
                    console.log('[PDF] Terrain 3D vue oblique 60° opposee LiDAR : ' + Math.round(snapOblique2.length / 1024) + 'K');
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

    // ── Debug : sauver le HTML brut pour inspection ─────────────
    try {
      const htmlPath = path.join(OUT_DIR, `planches_${runId}.html`);
      fs.writeFileSync(htmlPath, pdfHtml, 'utf-8');
    } catch { /* non bloquant */ }

    // ── Debug : dumper le plan masse SVG en standalone pour inspection inset ──
    try {
      const planMasseDataUrl = await page.evaluate(() => window.TerlabExport?._visuals?.planMasse ?? null);
      if (planMasseDataUrl?.startsWith('data:image/svg+xml;base64,')) {
        const svgB64 = planMasseDataUrl.split(',')[1];
        const svgRaw = Buffer.from(svgB64, 'base64').toString('utf-8');
        const svgPath = path.join(OUT_DIR, `planmasse_${runId}.svg`);
        fs.writeFileSync(svgPath, svgRaw, 'utf-8');
        log(`  🧭 Plan masse SVG dumpé : ${path.basename(svgPath)} (${(svgRaw.length / 1024).toFixed(1)} Ko)`);
      }
    } catch (e) { /* non bloquant */ }

    // ── Debug : dumper le terrain 3D LiDAR (point cloud Three.js / SVG fallback) ──
    try {
      const terrain3dUrl = await page.evaluate(() => window.TerlabExport?._visuals?.terrain3d ?? null);
      if (terrain3dUrl?.startsWith('data:image/jpeg;base64,')) {
        const b64 = terrain3dUrl.split(',')[1];
        const buf = Buffer.from(b64, 'base64');
        const p = path.join(OUT_DIR, `lidar3d_${runId}.jpg`);
        fs.writeFileSync(p, buf);
        log(`  🛰  LiDAR 3D dumpé : ${path.basename(p)} (${(buf.length / 1024).toFixed(0)} Ko)`);
      } else if (terrain3dUrl?.startsWith('data:image/svg+xml;base64,')) {
        const svgRaw = Buffer.from(terrain3dUrl.split(',')[1], 'base64').toString('utf-8');
        const p = path.join(OUT_DIR, `lidar3d_${runId}.svg`);
        fs.writeFileSync(p, svgRaw, 'utf-8');
        log(`  🛰  LiDAR 3D (SVG fallback) dumpé : ${path.basename(p)} (${(svgRaw.length / 1024).toFixed(1)} Ko)`);
      }
    } catch (e) { /* non bloquant */ }

    // ── Debug : dumper le plan GIEP standalone ──
    try {
      const giepInfo = await page.evaluate(async () => {
        const eng = window.TerlabExport;
        const sess = window.SessionManager;
        if (!eng || !sess) return { error: 'no engine/session' };
        const terrain = sess.getTerrain?.() ?? {};
        const proposal = eng._visuals?.activeProposal ?? window._activeProposal ?? null;
        if (!proposal?.bat) return { error: 'no proposal.bat' };

        const [calcMod, planMod] = await Promise.all([
          import('./services/giep-calculator-service.js').catch(e => ({ __err: e.message })),
          import('./services/giep-plan-service.js').catch(e => ({ __err: e.message })),
        ]);
        if (calcMod.__err) return { error: 'calc import: ' + calcMod.__err };
        if (planMod.__err) return { error: 'plan import: ' + planMod.__err };
        const Calc = calcMod.default ?? calcMod.GIEPCalculator;
        const Plan = planMod.default ?? planMod.GIEPPlanService;

        const sessionData = {
          terrain,
          _parcelLocal: sess._parcelLocal,
          _edgeTypes: sess._edgeTypes,
          phases: { 7: sess.getPhase?.(7) ?? {}, 8: sess.getPhase?.(8) ?? {} },
        };
        const giepResult = Calc?.computeFromSession?.(sessionData);
        if (!giepResult) return { error: 'no giepResult', hasParcelLocal: Array.isArray(sess._parcelLocal), parcelLocalLen: sess._parcelLocal?.length ?? 0 };
        const svg = Plan?.generatePlan?.(sess, proposal, giepResult);
        return {
          svg,
          parcelLocalLen: sess._parcelLocal?.length ?? 0,
          ouvrages: giepResult.ouvrages?.length ?? 0,
          score: giepResult.score,
        };
      });
      if (giepInfo?.svg) {
        const svgPath = path.join(OUT_DIR, `giep_${runId}.svg`);
        fs.writeFileSync(svgPath, giepInfo.svg, 'utf-8');
        log(`  💧 GIEP SVG dumpé : ${path.basename(svgPath)} (${(giepInfo.svg.length / 1024).toFixed(1)} Ko, parcelLocal=${giepInfo.parcelLocalLen}, ouvrages=${giepInfo.ouvrages}, score=${giepInfo.score})`);
      } else if (giepInfo?.error) {
        log(`  ⚠ GIEP non généré : ${giepInfo.error} (parcelLocal=${giepInfo.parcelLocalLen ?? '?'})`);
      }
    } catch (e) { log(`  ⚠ GIEP debug failed: ${e.message}`); }

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
