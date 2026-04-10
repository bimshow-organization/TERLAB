// terlab/services/earthworks-service.js
// EarthworksService — Calcul terrassement (déblais/remblais) sous emprise bâtiment
// Stratégie A1 (moyenne pondérée 50/50) + A3 (cascades) + A4 (pilotis)
// ENSA La Réunion · TERLAB · vanilla JS ES2022+
//
// ── CONVENTION COORDONNÉES (TERLAB unified) ──
//   polygon = [{x, y}] en mètres locaux (origine = centroïde parcelle)
//   y est SUD-positif (convention SVG / Y-down d'esquisse-canvas)
//
//   Pour LiDAR MNT (qui est north-positif en interne, voir lidar-context-service):
//     LCS.sampleMNT(mnt, polygon.x, -polygon.y)   ← flip Y obligatoire
//
//   Pour BIL (lng,lat):
//     lng = clng + x/LNG  ;  lat = clat - y/LAT  (cf. _localToGeo)
//
//   Pour Three.js scene (cf. earthworks-mesh-builder + gabarit-3d):
//     three.x = polygon.x   three.z = polygon.y   (sans flip)
//     three.y = altitude_NGR + groundYRef         (cf. altitudeReference())
//
// ── CONVENTION ALTITUDE Y dans la scène 3D ──
//   Toutes les scènes 3D TERLAB qui consomment ce service utilisent désormais :
//     three.y = (alt_NGR - tnMin_NGR)  (= groundYRef appliqué à toutes les altitudes)
//   ⇒ Y=0 visuel correspond au point bas du terrain naturel sous l'emprise.
//   ⇒ Cohérent avec buildings-3d-viewer qui utilise déjà groundZ = mnt.minAlt.
//   ⇒ terrain-3d-viewer (ancien) utilise les altitudes brutes — pour le faire
//     cohabiter, ajouter terrainMesh.position.y -= tnMin_NGR au moment du load.
//
// API:
//   await EarthworksService.computeEarthworks(polygon, session, opts)
//     → { strategy, samples, platform, V_cut_m3, V_fill_m3, ratio,
//         hMaxCutAmont, hMaxFillAval, talusEdges, pilotisPosts,
//         steps, slopeMean, slopeMax, source, warnings,
//         altitudeReference: { tnMin_m, groundYRef } }
//
//   EarthworksService.altitudeReference(session)
//     → { tnMin_m, groundYRef } depuis le LiDAR MNT cache ou null
//
//   EarthworksService.toSceneY(altitude_NGR, ref)
//     → altitude_NGR + ref.groundYRef  (helper pour autres viewers)

const M_PER_DEG_LAT = 111320;

const DEFAULTS = {
  gridStep: 0.5,            // m — pas d'échantillonnage TN
  marginM: 4.0,             // m — marge autour de l'emprise (talus + contexte courbes niveau)
                            // Permet des talus jusqu'à ~2.5m (1V:1.5H = 3.75m) et donne
                            // un raccord visuel propre avec le terrain naturel environnant.
  marginAuto: true,         // si true, ajuste la marge selon le dénivelé local (pré-pass)
  source: 'auto',           // 'lidar' | 'bil' | 'auto'
  // Seuils de bascule de stratégie
  thresholdSlopeA3: 8,      // % — au-dessus → A3 cascades
  thresholdSlopeA4: 15,     // % — au-dessus → A4 pilotis
  // Talus
  talusRatioH_V: 1.5,       // pente talus 1V:1.5H (réglementaire La Réunion)
  retainingWallH: 2.0,      // m — au-delà : mur de soutènement requis
  // Pilotis
  pilotisGardeM: 0.5,       // m — garde au sol minimale
  // A3
  cascadeDropM: 1.5,        // m — saut entre cascades (demi-niveau)
  maxCascades: 3,           // nb max de plateformes étagées
};

const EarthworksService = {

  // ── ALTITUDE REFERENCE (helper unifié) ───────────────────────────
  /**
   * Retourne le helper de référence altitude pour la scène 3D.
   * { tnMin_m, groundYRef } où groundYRef = -tnMin_m.
   * Pour traduire toute altitude NGR en Y de scène : alt + groundYRef.
   *
   * @param {Object} session
   * @returns {{tnMin_m: number|null, groundYRef: number}}
   */
  altitudeReference(session) {
    const mnt = this._extractLidarMNT(session);
    if (mnt && isFinite(mnt.minAlt)) {
      return { tnMin_m: mnt.minAlt, groundYRef: -mnt.minAlt };
    }
    const altNgr = parseFloat(session?.terrain?.altitude_ngr ?? 0);
    return { tnMin_m: altNgr, groundYRef: -altNgr };
  },

  /**
   * Convertit une altitude m NGR en Y de scène Three.js selon la référence.
   * Helper pratique pour les viewers tiers (terrain-3d-viewer, buildings-3d).
   */
  toSceneY(altitude_NGR, ref) {
    if (!ref || !isFinite(ref.groundYRef)) return altitude_NGR;
    return altitude_NGR + ref.groundYRef;
  },

  // ── API PRINCIPALE ───────────────────────────────────────────────
  /**
   * Pipeline complet : sample TN → choose strategy → compute platform → result.
   * @param {Array<{x,y}>} polygon  Emprise bâtiment en mètres locaux
   * @param {Object} session        Session TERLAB (terrain, phases, lidarCtx)
   * @param {Object} opts           Override DEFAULTS
   * @returns {Promise<Object>}     Résultat complet earthworks
   */
  async computeEarthworks(polygon, session, opts = {}) {
    const cfg = { ...DEFAULTS, ...opts };
    const warnings = [];

    if (!polygon || polygon.length < 3) {
      return this._emptyResult('Emprise bâtiment invalide (< 3 sommets)');
    }

    // 1. Échantillonner le TN sous l'emprise (+ marge)
    const sampling = await this.sampleTN(polygon, session, cfg);
    if (!sampling || sampling.samples.length === 0) {
      return this._emptyResult('Aucune altitude TN disponible (LiDAR + BIL absents)');
    }
    if (sampling.warnings?.length) warnings.push(...sampling.warnings);

    // 2. Choisir la stratégie (A1/A3/A4) selon pente et zone PPR
    const plu = session?.phases?.[4]?.data ?? {};
    const terrain = session?.terrain ?? {};
    const strategy = this.chooseStrategy(sampling, polygon, plu, terrain, cfg);

    // 3. Calculer la plateforme selon la stratégie
    let platformResult;
    if (strategy.type === 'A1') {
      platformResult = this.computePlatformA1(polygon, sampling.samples);
    } else if (strategy.type === 'A3') {
      const edgeTypes = session?._edgeTypes ?? this._guessEdgeTypes(polygon);
      platformResult = this.computePlatformA3(polygon, sampling.samples, edgeTypes, cfg);
    } else { // A4
      platformResult = this.computePlatformA4(polygon, sampling.samples, cfg);
    }

    // 4. Calculer talus (pour A1 et A3 ; pas pour A4)
    let talusEdges = [];
    if (strategy.type !== 'A4') {
      talusEdges = this._computeTalusEdges(polygon, sampling.samples, platformResult.H, cfg);
    }
    const hMaxTalus = talusEdges.reduce(
      (m, e) => Math.max(m, Math.abs(e.cutAmont), Math.abs(e.fillAval)),
      0
    );
    const needsRetainingWall = hMaxTalus > cfg.retainingWallH;
    if (needsRetainingWall) {
      warnings.push(`Talus ${hMaxTalus.toFixed(1)}m > ${cfg.retainingWallH}m — mur de soutènement requis`);
    }

    // 5. Agréger les warnings de pente locale
    if (sampling.slopeMaxLocal > 14) {
      warnings.push(`Pente locale ${sampling.slopeMaxLocal.toFixed(0)}% — risque ravinement`);
    }

    return {
      strategy,
      polygon,
      samples: sampling.samples,
      sampleGrid: sampling.grid,    // pour génération mesh TN ultérieure
      area_m2: this._polyArea(polygon),
      H_platform_m: platformResult.H,
      V_cut_m3: platformResult.V_cut_m3,
      V_fill_m3: platformResult.V_fill_m3,
      ratio_balance: platformResult.ratio,
      hMaxCutAmont_m: platformResult.hMaxCutAmont ?? null,
      hMaxFillAval_m: platformResult.hMaxFillAval ?? null,
      talusEdges,
      hMaxTalus_m: hMaxTalus,
      needsRetainingWall,
      pilotisPosts: platformResult.pilotisPosts ?? [],
      steps: platformResult.steps ?? null,
      slopeMean_pct: sampling.slopeMean,
      slopeMaxLocal_pct: sampling.slopeMaxLocal,
      source: sampling.source,
      tnMean_m: sampling.mean,
      tnMin_m: sampling.min,
      tnMax_m: sampling.max,
      // Référence altitude unifiée pour la scène 3D : tnMin = Y=0 visuel.
      // Tous les viewers TERLAB doivent appliquer groundYRef à leurs altitudes.
      altitudeReference: { tnMin_m: sampling.min, groundYRef: -sampling.min },
      warnings,
    };
  },

  // ── ÉCHANTILLONNAGE TN ────────────────────────────────────────────
  /**
   * Échantillonne le terrain naturel sous l'emprise + marge en grille régulière.
   * Source : LiDAR si disponible (rapide, local), sinon BIL (réseau, lent).
   * @returns {Promise<{samples, grid, mean, min, max, slopeMean, slopeMaxLocal, source, warnings}>}
   */
  async sampleTN(polygon, session, cfg) {
    const bbox = this._polyBBox(polygon);

    // Marge adaptative : si marginAuto, on ajuste selon le dénivelé estimé.
    // Pré-pass : moyenne grossière des coins du polygone via _extractLidarMNT
    // ou fallback altitude_ngr. Si dénivelé > 1m, on étend la marge à 1.5×denivele.
    let margin = cfg.marginM;
    if (cfg.marginAuto !== false) {
      try {
        const denivEstime = this._estimateDenivele(polygon, session);
        const marginEst = Math.max(cfg.marginM, 1.5 * denivEstime + 1.0);
        // Plafond raisonnable : ne pas dépasser la moitié de la dimension parcellaire
        const maxDim = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
        margin = Math.min(marginEst, maxDim * 0.6, 12);
      } catch (_) { /* ignore, use default */ }
    }

    const x0 = bbox.minX - margin, x1 = bbox.maxX + margin;
    const y0 = bbox.minY - margin, y1 = bbox.maxY + margin;
    const step = cfg.gridStep;

    const cols = Math.max(2, Math.ceil((x1 - x0) / step) + 1);
    const rows = Math.max(2, Math.ceil((y1 - y0) / step) + 1);

    // Décider de la source
    let source = cfg.source;
    let lidarMnt = this._extractLidarMNT(session);

    // ── AUTO-FETCH LiDAR si absent et qu'on est en mode 'auto' ou 'lidar' ──
    // Tente de charger les points LiDAR depuis IGN HD pour la parcelle, puis
    // construit le MNT via LidarContextService. Met en cache sur session._lidarMNT
    // pour les appels suivants.
    if (!lidarMnt && (source === 'auto' || source === 'lidar') && cfg.autoFetchLidar !== false) {
      lidarMnt = await this._tryAutoFetchLidar(session);
    }

    if (source === 'auto') {
      source = lidarMnt ? 'lidar' : 'bil';
    } else if (source === 'lidar' && !lidarMnt) {
      source = 'bil'; // fallback silencieux
    }

    const warnings = [];
    const grid = new Float32Array(cols * rows); // altitudes TN brutes
    const samples = [];                          // [{x,y,z, inPolygon}]

    if (source === 'lidar') {
      const LCS = (typeof window !== 'undefined') ? window.LidarContextService : null;
      if (!LCS || !lidarMnt) {
        warnings.push('LiDAR demandé mais indisponible — fallback BIL');
        source = 'bil';
      } else {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const x = x0 + c * step;
            const y = y0 + r * step;
            // LiDAR MNT utilise z = (lat-clat)*LAT (north-positif)
            // polygon.y est south-positif → flip
            const z = LCS.sampleMNT(lidarMnt, x, -y);
            grid[r * cols + c] = z;
            samples.push({ x, y, z, inPolygon: this._pointInPoly(x, y, polygon) });
          }
        }
      }
    }

    if (source === 'bil') {
      const BIL = (typeof window !== 'undefined') ? window.BILTerrain : null;
      const terrain = session?.terrain ?? {};
      const clat = parseFloat(terrain.lat ?? -21.15);
      const clng = parseFloat(terrain.lng ?? 55.45);
      const LNG = M_PER_DEG_LAT * Math.cos(clat * Math.PI / 180);
      const LAT = M_PER_DEG_LAT;

      if (!BIL) {
        warnings.push('BILTerrain indisponible — TN plat fallback');
        const altFallback = parseFloat(terrain.altitude_ngr ?? 0);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const x = x0 + c * step;
            const y = y0 + r * step;
            grid[r * cols + c] = altFallback;
            samples.push({ x, y, z: altFallback, inPolygon: this._pointInPoly(x, y, polygon) });
          }
        }
      } else {
        // Échantillonnage BIL est réseau-bound : on limite la densité pour rester rapide
        // Strategy : on échantillonne en blocs ≤ 256 points et on remplit les autres par
        // interpolation bilinéaire des voisins. À 0.5m sur ~400 points (20×20 m), c'est ~5s
        // de fetch BIL. Pour rester sous 2s, on subsample 1 sur 2 et on bilinear-fill.
        const stride = Math.max(1, Math.ceil(Math.sqrt((cols * rows) / 256)));
        const promises = [];
        const sampleMap = new Map(); // "r,c" → promise

        for (let r = 0; r < rows; r += stride) {
          for (let c = 0; c < cols; c += stride) {
            const x = x0 + c * step;
            const y = y0 + r * step;
            const lng = clng + x / LNG;
            const lat = clat - y / LAT;
            const key = `${r},${c}`;
            const p = BIL.getElevation(lng, lat).catch(() => null);
            sampleMap.set(key, p);
            promises.push(p);
          }
        }
        await Promise.all(promises);

        // Remplir le grid sparsifié
        for (const [key, prom] of sampleMap.entries()) {
          const [r, c] = key.split(',').map(Number);
          const z = await prom;
          if (z != null && isFinite(z)) {
            grid[r * cols + c] = z;
          } else {
            grid[r * cols + c] = NaN;
          }
        }

        // Interpoler les cellules non-échantillonnées via plus-proche-voisin sparsifié
        this._interpolateGrid(grid, cols, rows, stride);

        // Construire samples
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const x = x0 + c * step;
            const y = y0 + r * step;
            samples.push({
              x, y,
              z: grid[r * cols + c],
              inPolygon: this._pointInPoly(x, y, polygon),
            });
          }
        }
      }
    }

    // Statistiques sur les samples DANS le polygone uniquement
    const inSamples = samples.filter(s => s.inPolygon && isFinite(s.z));
    if (inSamples.length === 0) {
      return { samples: [], grid: null, mean: 0, min: 0, max: 0, slopeMean: 0, slopeMaxLocal: 0, source, warnings };
    }

    let sum = 0, min = Infinity, max = -Infinity;
    for (const s of inSamples) {
      sum += s.z;
      if (s.z < min) min = s.z;
      if (s.z > max) max = s.z;
    }
    const mean = sum / inSamples.length;

    // Pente moyenne et locale max via gradient sur grid
    const { slopeMean, slopeMaxLocal } = this._computeSlopes(grid, cols, rows, step);

    return {
      samples,
      grid: { data: grid, cols, rows, x0, y0, step },
      mean,
      min,
      max,
      slopeMean,
      slopeMaxLocal,
      source,
      warnings,
    };
  },

  // ── BASCULE STRATÉGIE ─────────────────────────────────────────────
  /**
   * Décide A1/A3/A4 selon pente, surface, PPR, programme.
   */
  chooseStrategy(sampling, polygon, plu, terrain, cfg) {
    const slopeMax = sampling.slopeMaxLocal;
    const slopeMean = sampling.slopeMean;
    const area = this._polyArea(polygon);

    // ── Détection sols/zones défavorables → pilotis obligatoire ──
    // 1. PPRN zone inconstructible (R1/R2) — saisi P03 ou détecté par scan
    const zonePprn = terrain.zone_pprn ?? '';
    const isPprnRouge = zonePprn === 'R1' || zonePprn === 'R2';
    const pprnScan = terrain.pprn_zones_detected ?? null;
    const hasScanIncon = pprnScan && Object.values(pprnScan).some(z => z?.inconstructible);
    // 2. Géologie instable (P02 saisie) — éboulis/colluvions ou remblai
    const geol = (terrain.geologie_type ?? '').toLowerCase();
    const isGeolInstable = geol === 'eboulis' || geol === 'colluvions';
    const isRemblai = (terrain.remblai === 'oui') || geol === 'remblai';

    if (isPprnRouge || hasScanIncon) {
      const cause = isPprnRouge ? `PPRN ${zonePprn}` : 'PPRN scan inconstructible';
      return { type: 'A4', reason: `${cause} — pilotis obligatoire (zéro terrassement)` };
    }
    if (isGeolInstable) {
      return { type: 'A4', reason: `Géologie ${geol} (instable) — pilotis recommandé` };
    }
    if (isRemblai) {
      return { type: 'A4', reason: `Sol de remblai — pilotis pour éviter tassements différentiels` };
    }

    // Pente forte → pilotis
    if (slopeMax >= cfg.thresholdSlopeA4) {
      return {
        type: 'A4',
        reason: `Pente max ${slopeMax.toFixed(0)}% ≥ ${cfg.thresholdSlopeA4}% — pilotis (zéro terrassement)`,
      };
    }

    // Pente intermédiaire ET emprise > 80m² → cascades
    if (slopeMean >= cfg.thresholdSlopeA3 && area >= 80) {
      return {
        type: 'A3',
        reason: `Pente moyenne ${slopeMean.toFixed(0)}% ≥ ${cfg.thresholdSlopeA3}% — cascades étagées`,
      };
    }

    // Défaut : plateforme unique 50/50
    return {
      type: 'A1',
      reason: `Pente ${slopeMean.toFixed(1)}% < ${cfg.thresholdSlopeA3}%, emprise ${area.toFixed(0)}m² — plateforme unique 50/50`,
    };
  },

  // ── A1 : PLATEFORME MOYENNE PONDÉRÉE ──────────────────────────────
  /**
   * H = moyenne arithmétique des altitudes TN sous l'emprise.
   * Cette cote équilibre rigoureusement V_cut et V_fill pour une pente linéaire
   * (et reste ≈ équilibrée pour des pentes peu variables).
   */
  computePlatformA1(polygon, samples) {
    const inSamples = samples.filter(s => s.inPolygon && isFinite(s.z));
    if (inSamples.length === 0) {
      return { H: 0, V_cut_m3: 0, V_fill_m3: 0, ratio: 0, hMaxCutAmont: 0, hMaxFillAval: 0 };
    }

    // Moyenne arithmétique = cote 50/50 (les échantillons sont équidistants → poids égal)
    const H = inSamples.reduce((s, p) => s + p.z, 0) / inSamples.length;

    // Volumes : chaque sample représente une cellule de surface step² qu'on calcule
    // depuis l'écart entre samples adjacents. Pour simplifier on prend la surface
    // moyenne par sample = aire_polygone / nb_samples_in.
    const area = this._polyArea(polygon);
    const cellArea = area / inSamples.length;

    let V_cut = 0, V_fill = 0;
    let hMaxCut = 0, hMaxFill = 0;
    for (const s of inSamples) {
      const dh = s.z - H; // > 0 = TN au-dessus de plateforme = déblai
      if (dh > 0) {
        V_cut += dh * cellArea;
        if (dh > hMaxCut) hMaxCut = dh;
      } else {
        V_fill += (-dh) * cellArea;
        if (-dh > hMaxFill) hMaxFill = -dh;
      }
    }

    const ratio = (V_cut + V_fill) > 0
      ? 1 - Math.abs(V_cut - V_fill) / (V_cut + V_fill)
      : 1;

    return {
      H,
      V_cut_m3: V_cut,
      V_fill_m3: V_fill,
      ratio,
      hMaxCutAmont: hMaxCut,
      hMaxFillAval: hMaxFill,
    };
  },

  // ── A3 : CASCADES ÉTAGÉES ─────────────────────────────────────────
  /**
   * Découpe l'emprise en bandes perpendiculaires à la pente principale,
   * chaque bande a sa propre cote (espacement = cascadeDropM = 1.5m typiquement).
   */
  computePlatformA3(polygon, samples, edgeTypes, cfg) {
    const inSamples = samples.filter(s => s.inPolygon && isFinite(s.z));
    if (inSamples.length === 0) {
      return { H: 0, V_cut_m3: 0, V_fill_m3: 0, ratio: 0, steps: [] };
    }

    // 1. Direction de plus grande pente : moindres carrés sur (x, y, z)
    //    z = a*x + b*y + c → gradient = (a, b), direction de pente = -(a,b)
    let sx = 0, sy = 0, sz = 0, sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0, n = 0;
    for (const s of inSamples) {
      sx += s.x; sy += s.y; sz += s.z;
      sxx += s.x * s.x; sxy += s.x * s.y; syy += s.y * s.y;
      sxz += s.x * s.z; syz += s.y * s.z;
      n++;
    }
    const mx = sx / n, my = sy / n, mz = sz / n;
    const Sxx = sxx - n * mx * mx;
    const Syy = syy - n * my * my;
    const Sxy = sxy - n * mx * my;
    const Sxz = sxz - n * mx * mz;
    const Syz = syz - n * my * mz;
    const det = Sxx * Syy - Sxy * Sxy;
    let gradX = 0, gradY = 0;
    if (Math.abs(det) > 1e-9) {
      gradX = (Sxz * Syy - Syz * Sxy) / det;
      gradY = (Syz * Sxx - Sxz * Sxy) / det;
    }
    const gradLen = Math.hypot(gradX, gradY);
    if (gradLen < 1e-6) {
      // Terrain plat — fallback A1
      return this.computePlatformA1(polygon, samples);
    }

    // Vecteur unitaire descendant la pente
    const dx = -gradX / gradLen, dy = -gradY / gradLen;

    // 2. Projeter chaque sample sur l'axe de pente, déterminer min/max
    const projs = inSamples.map(s => ({
      ...s,
      t: (s.x - mx) * dx + (s.y - my) * dy,
    }));
    let tMin = Infinity, tMax = -Infinity;
    for (const p of projs) {
      if (p.t < tMin) tMin = p.t;
      if (p.t > tMax) tMax = p.t;
    }

    // 3. Décider du nombre de cascades selon dénivelé total
    const altMin = Math.min(...projs.map(p => p.z));
    const altMax = Math.max(...projs.map(p => p.z));
    const denivele = altMax - altMin;
    const nSteps = Math.min(cfg.maxCascades, Math.max(2, Math.ceil(denivele / cfg.cascadeDropM)));

    // 4. Découper en nSteps bandes égales le long de t
    const stepWidth = (tMax - tMin) / nSteps;
    const steps = [];
    let totalCut = 0, totalFill = 0;

    for (let i = 0; i < nSteps; i++) {
      const tLo = tMin + i * stepWidth;
      const tHi = tMin + (i + 1) * stepWidth;
      const bandSamples = projs.filter(p => p.t >= tLo && p.t <= tHi);
      if (bandSamples.length === 0) continue;

      // Cote de la bande = moyenne des TN dans la bande (50/50 local)
      const Hi = bandSamples.reduce((s, p) => s + p.z, 0) / bandSamples.length;
      const cellArea = this._polyArea(polygon) / inSamples.length;

      let cutI = 0, fillI = 0;
      for (const s of bandSamples) {
        const dh = s.z - Hi;
        if (dh > 0) cutI += dh * cellArea;
        else fillI += (-dh) * cellArea;
      }

      steps.push({
        index: i,
        tLo, tHi,
        H: Hi,
        n: bandSamples.length,
        V_cut_m3: cutI,
        V_fill_m3: fillI,
        // Empreinte approximative de la bande dans l'emprise (clip par polygone)
        bandPoly: this._clipBandToPolygon(polygon, dx, dy, mx, my, tLo, tHi),
      });

      totalCut += cutI;
      totalFill += fillI;
    }

    const H_mean = steps.reduce((s, st) => s + st.H * st.n, 0) / inSamples.length;
    const ratio = (totalCut + totalFill) > 0
      ? 1 - Math.abs(totalCut - totalFill) / (totalCut + totalFill)
      : 1;

    return {
      H: H_mean,
      V_cut_m3: totalCut,
      V_fill_m3: totalFill,
      ratio,
      hMaxCutAmont: Math.max(...steps.map(s => s.H)) - Math.min(...projs.map(p => p.z)),
      hMaxFillAval: Math.max(...projs.map(p => p.z)) - Math.min(...steps.map(s => s.H)),
      steps,
      slopeAxis: { dx, dy },
    };
  },

  // ── A4 : PILOTIS ──────────────────────────────────────────────────
  /**
   * Plateforme = max(TN) + garde au sol. Aucun déblai/remblai.
   * Pilotis posés aux 4 coins + grille intermédiaire si emprise > 60m².
   */
  computePlatformA4(polygon, samples, cfg) {
    const inSamples = samples.filter(s => s.inPolygon && isFinite(s.z));
    if (inSamples.length === 0) {
      return { H: 0, V_cut_m3: 0, V_fill_m3: 0, ratio: 1, pilotisPosts: [] };
    }

    // H = max(TN) + garde
    const tnMax = Math.max(...inSamples.map(s => s.z));
    const H = tnMax + cfg.pilotisGardeM;

    // Posts aux sommets du polygone + grille intérieure
    const pilotisPosts = [];
    for (const v of polygon) {
      const tnLocal = this._sampleAtPoint(samples, v.x, v.y);
      pilotisPosts.push({
        x: v.x,
        y: v.y,
        tn: tnLocal,
        h: H - tnLocal, // hauteur du pilotis
      });
    }

    // Grille intérieure si emprise > 60m² : un post tous les ~5m
    const area = this._polyArea(polygon);
    if (area > 60) {
      const bbox = this._polyBBox(polygon);
      const spacing = 5;
      for (let x = bbox.minX + spacing; x < bbox.maxX; x += spacing) {
        for (let y = bbox.minY + spacing; y < bbox.maxY; y += spacing) {
          if (!this._pointInPoly(x, y, polygon)) continue;
          const tnLocal = this._sampleAtPoint(samples, x, y);
          pilotisPosts.push({ x, y, tn: tnLocal, h: H - tnLocal });
        }
      }
    }

    return {
      H,
      V_cut_m3: 0,
      V_fill_m3: 0,
      ratio: 1, // pas de terrassement → équilibre parfait par définition
      hMaxCutAmont: 0,
      hMaxFillAval: 0,
      pilotisPosts,
    };
  },

  // ══════════════════════════════════════════════════════════════════
  // HELPERS GÉOMÉTRIE
  // ══════════════════════════════════════════════════════════════════

  _polyArea(pts) {
    let a = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return Math.abs(a) / 2;
  },

  _polyBBox(pts) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, maxX, minY, maxY };
  },

  _pointInPoly(px, py, polygon) {
    let inside = false;
    const n = polygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      if ((yi > py) !== (yj > py) &&
          px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  },

  _sampleAtPoint(samples, x, y) {
    // Plus proche voisin
    let best = samples[0], bestD = Infinity;
    for (const s of samples) {
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best.z;
  },

  /**
   * Estime rapidement le dénivelé sur le polygone via 5 points (4 coins + centre)
   * échantillonnés dans le LiDAR MNT s'il est dispo, sinon retourne 1.0m par défaut.
   * Sert à dimensionner la marge de sampling avant le full grid.
   */
  _estimateDenivele(polygon, session) {
    if (typeof window === 'undefined') return 1.0;
    const LCS = window.LidarContextService;
    const mnt = session?._lidarMNT ?? session?.lidarCtx?.mnt;
    if (!LCS || !mnt) return 1.0;
    const probes = [...polygon];
    const cx = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
    const cy = polygon.reduce((s, p) => s + p.y, 0) / polygon.length;
    probes.push({ x: cx, y: cy });
    let zMin = Infinity, zMax = -Infinity;
    for (const p of probes) {
      const z = LCS.sampleMNT(mnt, p.x, -p.y);
      if (isFinite(z)) {
        if (z < zMin) zMin = z;
        if (z > zMax) zMax = z;
      }
    }
    return isFinite(zMin) && isFinite(zMax) ? (zMax - zMin) : 1.0;
  },

  // ── PENTES ────────────────────────────────────────────────────────
  /**
   * Calcule la pente moyenne et la pente locale max sur la grille TN.
   * Gradient central via différences finies.
   */
  _computeSlopes(grid, cols, rows, step) {
    let sumSlope = 0, n = 0, maxSlope = 0;
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        const z = grid[r * cols + c];
        if (!isFinite(z)) continue;
        const zL = grid[r * cols + (c - 1)];
        const zR = grid[r * cols + (c + 1)];
        const zU = grid[(r - 1) * cols + c];
        const zD = grid[(r + 1) * cols + c];
        if (![zL, zR, zU, zD].every(isFinite)) continue;
        const dzdx = (zR - zL) / (2 * step);
        const dzdy = (zD - zU) / (2 * step);
        const slope = Math.hypot(dzdx, dzdy) * 100; // %
        sumSlope += slope;
        n++;
        if (slope > maxSlope) maxSlope = slope;
      }
    }
    return {
      slopeMean: n > 0 ? sumSlope / n : 0,
      slopeMaxLocal: maxSlope,
    };
  },

  // ── INTERPOLATION GRILLE ──────────────────────────────────────────
  /**
   * Remplit les cellules NaN d'une grille sparsifiée par interpolation
   * bilinéaire des cellules connues à distance `stride`.
   */
  _interpolateGrid(grid, cols, rows, stride) {
    if (stride <= 1) {
      // Aucun trou — remplir juste les NaN éventuels par moyenne globale
      let sum = 0, n = 0;
      for (let i = 0; i < grid.length; i++) {
        if (isFinite(grid[i])) { sum += grid[i]; n++; }
      }
      const mean = n > 0 ? sum / n : 0;
      for (let i = 0; i < grid.length; i++) {
        if (!isFinite(grid[i])) grid[i] = mean;
      }
      return;
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (isFinite(grid[r * cols + c])) continue;
        // Trouver les 4 voisins de la grille de référence
        const r0 = Math.floor(r / stride) * stride;
        const c0 = Math.floor(c / stride) * stride;
        const r1 = Math.min(rows - 1, r0 + stride);
        const c1 = Math.min(cols - 1, c0 + stride);
        const v00 = grid[r0 * cols + c0];
        const v01 = grid[r0 * cols + c1];
        const v10 = grid[r1 * cols + c0];
        const v11 = grid[r1 * cols + c1];
        const valid = [v00, v01, v10, v11].filter(isFinite);
        if (valid.length === 0) {
          grid[r * cols + c] = NaN;
          continue;
        }
        if (valid.length < 4) {
          grid[r * cols + c] = valid.reduce((s, v) => s + v, 0) / valid.length;
          continue;
        }
        const tx = (c - c0) / Math.max(1, (c1 - c0));
        const ty = (r - r0) / Math.max(1, (r1 - r0));
        grid[r * cols + c] =
          v00 * (1 - tx) * (1 - ty) +
          v01 * tx * (1 - ty) +
          v10 * (1 - tx) * ty +
          v11 * tx * ty;
      }
    }

    // Pass final : remplacer NaN restants par moyenne
    let sum = 0, n = 0;
    for (let i = 0; i < grid.length; i++) {
      if (isFinite(grid[i])) { sum += grid[i]; n++; }
    }
    const mean = n > 0 ? sum / n : 0;
    for (let i = 0; i < grid.length; i++) {
      if (!isFinite(grid[i])) grid[i] = mean;
    }
  },

  // ── EXTRACTION LiDAR MNT ──────────────────────────────────────────
  /**
   * Cherche un MNT LiDAR déjà chargé dans le contexte (session ou viewer global).
   * Le MNT est stocké par buildings-3d-viewer dans son state interne ; on essaie
   * plusieurs sources connues.
   */
  _extractLidarMNT(session) {
    // 1. Session directe (cache)
    if (session?._lidarMNT) return session._lidarMNT;
    if (session?.lidarCtx?.mnt) return session.lidarCtx.mnt;
    // 2. Composant Buildings3DViewer (P05/P07)
    if (typeof window !== 'undefined') {
      const b3d = window.Buildings3DViewer;
      if (b3d?._lidarCtx?.mnt) return b3d._lidarCtx.mnt;
      // 3. P07 terrain-3d-viewer (s'il a chargé un MNT lidar)
      if (window.Terrain3DViewer?._lidarCtx?.mnt) return window.Terrain3DViewer._lidarCtx.mnt;
    }
    return null;
  },

  /**
   * Tente de charger les points LiDAR IGN HD pour la parcelle et de construire
   * un MNT via LidarContextService. Cache le résultat sur session._lidarMNT pour
   * éviter de retéléchargér à chaque calcul earthworks.
   *
   * Renvoie null en cas d'échec (offline, hors zone HD, etc.) — l'earthworks
   * basculera sur BIL automatiquement.
   */
  async _tryAutoFetchLidar(session) {
    if (typeof window === 'undefined') return null;
    const LS  = window.LidarService;
    const LCS = window.LidarContextService;
    const parcelGJ = session?.terrain?.parcelle_geojson;
    if (!LS || !LCS || !parcelGJ) return null;

    try {
      // Réutilise les points déjà chargés (P05/P07 ont pu déclencher un fetch)
      let rawPoints = LS.getRawPoints?.();
      const cachedClasses = LS.getRawPointsClasses?.() ?? '';
      const needsClasses = '2,3,4,5,6,9';
      // Si les points cachés n'ont pas la classe sol (2), refetch
      if (!rawPoints?.length || !cachedClasses.includes('2')) {
        console.info('[Earthworks] Auto-fetch LiDAR pour échantillonnage TN…');
        const result = await LS.getPointsForParcel(
          parcelGJ, 30,
          { classes: needsClasses, maxPoints: 200000 }
        );
        if (!result?.points?.length) return null;
        rawPoints = result.points;
        LS.setRawPoints?.(rawPoints, needsClasses);
      }

      // Construire le contexte LiDAR (MNT + heights + trees)
      const ctx = LCS.process(rawPoints, parcelGJ, null);
      if (!ctx?.mnt || ctx.mnt.cols === 0) return null;

      // Cacher pour les appels suivants
      session._lidarMNT = ctx.mnt;
      session.lidarCtx = ctx;
      console.info(`[Earthworks] LiDAR MNT chargé : ${ctx.mnt.cols}×${ctx.mnt.rows} cellules`);
      return ctx.mnt;
    } catch (err) {
      console.warn('[Earthworks] Auto-fetch LiDAR échoué:', err.message);
      return null;
    }
  },

  // ── EDGE TYPES (devine si pas fournis) ────────────────────────────
  _guessEdgeTypes(polygon) {
    // Heuristique : arête avec midY le plus grand (= la plus au sud) = voie
    const n = polygon.length;
    const types = new Array(n).fill('lat');
    let maxMidY = -Infinity, voieIdx = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const midY = (polygon[i].y + polygon[j].y) / 2;
      if (midY > maxMidY) { maxMidY = midY; voieIdx = i; }
    }
    types[voieIdx] = 'voie';
    types[(voieIdx + Math.floor(n / 2)) % n] = 'fond';
    return types;
  },

  // ── TALUS PAR ARÊTE ───────────────────────────────────────────────
  /**
   * Pour chaque arête de l'emprise, mesure :
   *   cutAmont = TN extérieur juste hors arête − H_platform   (positif si déblai amont)
   *   fillAval = H_platform − TN extérieur juste hors arête   (positif si remblai aval)
   * Retourne aussi le polygone du talus (à pente 1V:1.5H) à destination du mesh builder.
   */
  _computeTalusEdges(polygon, samples, H, cfg) {
    const edges = [];
    const n = polygon.length;
    const offset = 1.0; // m hors de l'arête pour échantillonner le TN extérieur

    for (let i = 0; i < n; i++) {
      const p1 = polygon[i];
      const p2 = polygon[(i + 1) % n];
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.5) continue;

      // Normale extérieure (le polygone est CW-visuel SVG → normale extérieure = (-dy, dx)/len)
      // En convention Y-down : la normale "vers l'extérieur" dépend du winding.
      // On échantillonne dans les deux sens et on garde celui qui est HORS du polygone.
      const nxA = -dy / len, nyA = dx / len;
      const nxB = dy / len, nyB = -dx / len;
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      const probeA = { x: mx + nxA * offset, y: my + nyA * offset };
      const probeB = { x: mx + nxB * offset, y: my + nyB * offset };
      let nx, ny, probe;
      if (!this._pointInPoly(probeA.x, probeA.y, polygon)) {
        nx = nxA; ny = nyA; probe = probeA;
      } else {
        nx = nxB; ny = nyB; probe = probeB;
      }

      const tnExt = this._sampleAtPoint(samples, probe.x, probe.y);
      const dh = tnExt - H; // > 0 = TN extérieur au-dessus de plateforme = besoin déblai
      const cutAmont  = dh > 0 ?  dh : 0;
      const fillAval  = dh < 0 ? -dh : 0;

      // Polygone talus : 4 sommets (bord plateforme p1/p2 + projeté sur TN à pente 1V:1.5H)
      const talusW = Math.abs(dh) * cfg.talusRatioH_V; // largeur horizontale du talus
      const talus = [
        { x: p1.x, y: p1.y, z: H },
        { x: p2.x, y: p2.y, z: H },
        { x: p2.x + nx * talusW, y: p2.y + ny * talusW, z: tnExt },
        { x: p1.x + nx * talusW, y: p1.y + ny * talusW, z: tnExt },
      ];

      edges.push({
        edgeIndex: i,
        p1, p2,
        midX: mx, midY: my,
        normalX: nx, normalY: ny,
        tnExt,
        dh,
        cutAmont,
        fillAval,
        kind: dh > 0.05 ? 'cut' : (dh < -0.05 ? 'fill' : 'flat'),
        talus,
      });
    }
    return edges;
  },

  // ── CLIP BAND POLYGON (helper A3) ─────────────────────────────────
  /**
   * Clip approximatif : retourne les sommets du polygone de la bande
   * définie par t ∈ [tLo, tHi] où t = (x-mx)*dx + (y-my)*dy.
   * Implémentation simple par Sutherland-Hodgman contre 2 demi-plans.
   */
  _clipBandToPolygon(polygon, dx, dy, mx, my, tLo, tHi) {
    const tOf = (p) => (p.x - mx) * dx + (p.y - my) * dy;
    const interp = (a, b, tA, tB, tCut) => {
      const k = (tCut - tA) / (tB - tA);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    };

    // Clip contre t >= tLo
    let out = [];
    {
      const n = polygon.length;
      for (let i = 0; i < n; i++) {
        const a = polygon[i], b = polygon[(i + 1) % n];
        const tA = tOf(a), tB = tOf(b);
        const aIn = tA >= tLo, bIn = tB >= tLo;
        if (aIn) { out.push(a); if (!bIn) out.push(interp(a, b, tA, tB, tLo)); }
        else if (bIn) out.push(interp(a, b, tA, tB, tLo));
      }
    }
    // Clip contre t <= tHi
    let out2 = [];
    {
      const n = out.length;
      for (let i = 0; i < n; i++) {
        const a = out[i], b = out[(i + 1) % n];
        const tA = tOf(a), tB = tOf(b);
        const aIn = tA <= tHi, bIn = tB <= tHi;
        if (aIn) { out2.push(a); if (!bIn) out2.push(interp(a, b, tA, tB, tHi)); }
        else if (bIn) out2.push(interp(a, b, tA, tB, tHi));
      }
    }
    return out2.length >= 3 ? out2 : null;
  },

  // ── EMPTY ─────────────────────────────────────────────────────────
  _emptyResult(reason) {
    return {
      strategy: { type: 'A1', reason: 'Données insuffisantes — défaut plat' },
      polygon: null,
      samples: [],
      sampleGrid: null,
      area_m2: 0,
      H_platform_m: 0,
      V_cut_m3: 0,
      V_fill_m3: 0,
      ratio_balance: 0,
      hMaxCutAmont_m: 0,
      hMaxFillAval_m: 0,
      talusEdges: [],
      hMaxTalus_m: 0,
      needsRetainingWall: false,
      pilotisPosts: [],
      steps: null,
      slopeMean_pct: 0,
      slopeMaxLocal_pct: 0,
      source: 'none',
      tnMean_m: 0,
      tnMin_m: 0,
      tnMax_m: 0,
      warnings: [reason],
    };
  },
};

export { EarthworksService };
export default EarthworksService;

if (typeof window !== 'undefined') {
  window.EarthworksService = EarthworksService;
}
