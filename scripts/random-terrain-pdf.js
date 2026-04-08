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
const PORT      = parseInt(args.find((_, i, a) => a[i - 1] === '--port') ?? '8787');
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

            const feature = valid[Math.floor(Math.random() * valid.length)];
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
          const t = window.SessionManager.getTerrain();
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
          if (TA && enriched.altitude_ngr) {
            enriched.zone_climatique = TA.deduireZoneClimatique?.(enriched.altitude_ngr) ?? enriched.zone_climatique;
            enriched.zone_rtaa = TA.getZoneRTAA?.(enriched.altitude_ngr) ?? enriched.zone_rtaa;
          }

          window.SessionManager.saveTerrain(enriched);
          console.log('[PDF] Enrichi : PPR=' + (enriched.zone_pprn ?? '—') + ', PLU=' + (enriched.zone_plu ?? '—') +
            ', alt=' + (enriched.altitude_ngr ?? '—') + ', geo=' + (enriched.geologie_type ?? '—'));
        } catch (e) { console.warn('[Enrich]', e.message); }
        window.__enrichDone = true;
      })();
    });
    await waitFor(page, () => window.__enrichDone, 25_000, 'Enrichissement APIs');

    // ── 4c. Esquisse automatique (AutoPlanEngine) ────────────────
    log('4c. Génération esquisse automatique…');
    await page.evaluate(() => {
      window.__esquisseDone = false;
      (async () => {
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
        window.__esquisseDone = true;
      })();
    });
    await waitFor(page, () => window.__esquisseDone, 15_000, 'Esquisse auto');

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
            if (map && map.loaded?.()) {
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
                const capKeys = Object.keys(mapCaptures).filter(k => mapCaptures[k]);
                console.log(`[PDF] MapCapture : ${capKeys.length} vues — ${capKeys.join(', ')}`);
              }
            }
          } catch (e) { console.warn('[PDF] MapCapture error:', e.message); }

          // Capture visuels DOM
          let visuals = {};
          try { visuals = await engine._captureVisuals(); } catch { /* ok */ }

          const allMaps = { ...mapCaptures, ...visuals };

          // Debug : compter les captures
          const capKeys = Object.keys(allMaps).filter(k => allMaps[k]);
          const capSizes = capKeys.map(k => `${k}:${Math.round((allMaps[k]?.length ?? 0)/1024)}K`);
          console.log(`[PDF] ${capKeys.length} captures — ${capSizes.join(', ')}`);

          const html = engine._renderAllPlanches(session, terrain, allMaps, 'site');

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
