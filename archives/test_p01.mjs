
// Tous les modules sont exposés sur window par index.js
const SessionManager  = window.SessionManager;
const MapViewer       = window.TerlabMap;
const MeteoService    = window.MeteoService;
const RiskPlayer      = window.RiskPlayer;
const TerrainAnalysis = window.TerrainAnalysis;
const TerrainSVG      = window.TerrainSVG;
const LidarService    = window.LidarService;
const SectionViewer   = window.SectionProfileViewer;
const BdTopoService   = window.BdTopoService;

const P01 = {
  _exag: 1.4,
  _ravinesVisible: true,
  _orientation: null,
  _profileValidated: false,
  _lidarPoints: null,  // cache des points LiDAR chargés

  // ─── Lancer le tracé du profil ────────────────────────────────
  startProfile() {
    MapViewer.activateTool('profile');
    document.getElementById('btn-trace-profile').textContent = '⏳ En cours — posez 2 points…';
  },

  // ─── Profil automatique N-S (API IGN) ──────────────────────────
  async autoProfile() {
    const terrain = SessionManager.getTerrain();
    if (!terrain?.lat || !terrain?.lng) return;
    const btn = document.getElementById('btn-auto-profile');
    if (btn) btn.textContent = '⏳ Chargement…';
    try {
      const result = await window.TerrainProfile.autoProfile(
        terrain, 'auto-profile-container', { nPoints: 20 }
      );
      if (!result) {
        window.TerlabToast?.show('Profil IGN indisponible — tracez manuellement', 'warning');
        return;
      }
      if (btn) btn.textContent = '↻ Régénérer le profil N-S';
    } catch (e) {
      console.warn('[P01] autoProfile:', e.message);
      if (btn) btn.textContent = '⚠ Erreur — réessayer';
    }
  },

  // ─── Valider la coupe au dossier ──────────────────────────────
  validateProfile() {
    const data = MapViewer.getProfileData();
    if (!data) { window.TerlabToast?.show('Aucune coupe à valider', 'warning'); return; }

    // Capturer le snap de la carte avec la ligne de coupe visible
    const mapSnap = MapViewer.captureAsDataURL();

    // Sauvegarder en session (Phase 1 data + terrain + snap carte)
    SessionManager.savePhase(1, {
      profile_validated: true,
      profile_from:      data.from,
      profile_to:        data.to,
      profile_length_m:  data.length_m,
      profile_alt_min:   data.alt_min,
      profile_alt_max:   data.alt_max,
      profile_denivele:  data.denivele,
      profile_pente_moy: data.pente_moy,
      profile_altitudes: data.altitudes,
      profile_distances: data.distances,
      profile_timestamp: data.timestamp,
      profile_map_snap:  mapSnap
    });

    this._profileValidated = true;
    document.getElementById('profile-status').style.display = 'inline';
    document.getElementById('btn-validate-profile').style.display = 'none';
    window.TerlabToast?.show('Coupe altimétrique validée — incluse au dossier PDF', 'success', 4000);
  },

  // ─── Génère des points d'échantillonnage dans la parcelle ────
  _samplePointsInParcelle(geojson, center, count = 16) {
    const feature = { type: 'Feature', geometry: geojson, properties: {} };
    const bbox = turf.bbox(feature);
    const points = [];

    // Toujours inclure le centre
    points.push(center);

    // Coins + milieux des bords de la bbox, filtrés par parcelle
    const [w, s, e, n] = bbox;
    const candidates = [
      [w, s], [e, s], [e, n], [w, n],                           // coins
      [(w+e)/2, s], [e, (s+n)/2], [(w+e)/2, n], [w, (s+n)/2],  // milieux bords
      [(w+e)/2, (s+n)/2],                                        // centre bbox
    ];
    for (const [lng, lat] of candidates) {
      if (turf.booleanPointInPolygon(turf.point([lng, lat]), feature)) {
        points.push([lng, lat]);
      }
    }

    // Si parcelle polygonale : ajouter des sommets du contour
    const coords = geojson.type === 'Polygon' ? geojson.coordinates[0]
                 : geojson.type === 'MultiPolygon' ? geojson.coordinates[0][0]
                 : null;
    if (coords) {
      for (const c of coords) points.push([c[0], c[1]]);
    }

    // Dédoublonner et limiter
    const seen = new Set();
    return points.filter(([lng, lat]) => {
      const key = `${lng.toFixed(7)},${lat.toFixed(7)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, count);
  },

  // ─── Analyse altimétrique depuis DEM ─────────────────────────
  async analyzeAltitude() {
    const map = MapViewer.getMap();
    const terrain = SessionManager.getTerrain();
    if (!terrain?.lat || !terrain?.lng) {
      window.TerlabToast?.show('Complétez la Phase 0 en premier', 'warning'); return;
    }

    const lat = parseFloat(terrain.lat), lng = parseFloat(terrain.lng);
    const center = [lng, lat];
    const pts = [];

    // Déterminer les points d'échantillonnage : dans la parcelle si disponible, sinon grille locale
    let sampleCoords;
    if (terrain.parcelle_geojson) {
      sampleCoords = this._samplePointsInParcelle(terrain.parcelle_geojson, center);
    } else {
      // Fallback grille 3x3 serrée autour du centre (~55m de pas)
      const delta = 0.0005;
      sampleCoords = [];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          sampleCoords.push([lng + dx * delta, lat + dy * delta]);
    }

    // BIL IGN (précision ±1m) — fallback Mapbox DEM (±10m)
    const BIL = window.BILTerrain;
    if (BIL?.getElevation) {
      const promises = sampleCoords.map(([x, y]) => BIL.getElevation(x, y));
      const results = await Promise.allSettled(promises);
      results.forEach(r => { if (r.status === 'fulfilled' && r.value != null) pts.push(r.value); });
    }
    // Fallback Mapbox si BIL a échoué
    if (!pts.length && map?.queryTerrainElevation) {
      for (const [x, y] of sampleCoords) {
        const e = map.queryTerrainElevation([x, y]);
        if (e != null) pts.push(e);
      }
    }

    if (!pts.length) { window.TerlabToast?.show('DEM non disponible — carte non chargée', 'warning'); return; }

    const min = Math.round(Math.min(...pts));
    const max = Math.round(Math.max(...pts));

    // Pente : calculée sur la diagonale de la bbox parcelle (ou fallback)
    let pente = 0;
    if (terrain.parcelle_geojson && pts.length > 1) {
      const bbox = turf.bbox({ type: 'Feature', geometry: terrain.parcelle_geojson });
      const diagDist = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[3]], { units: 'meters' });
      pente = diagDist > 0 ? Math.round((max - min) / diagDist * 100) : 0;
    } else if (pts.length > 1) {
      const delta = 0.0005;
      pente = Math.round((max - min) / (delta * 111000) * 100);
    }

    document.getElementById('topo-alt-min').textContent   = min;
    document.getElementById('topo-alt-max').textContent   = max;
    document.getElementById('topo-pente').textContent     = pente;
    document.getElementById('topo-denivele').textContent  = max - min;

    const altMoy = Math.round((min + max) / 2);
    const rtaaZone = altMoy < 400 ? '1 (Aw côtier)' : altMoy < 900 ? '2 (Cf mi-pentes)' : '3 (Cwb hauts)';
    document.getElementById('ts-rtaa').textContent = rtaaZone;

    if (altMoy > 1000) {
      document.getElementById('alert-altitude').style.display = 'flex';
      document.getElementById('alert-altitude-text').textContent =
        `Terrain à ${altMoy}m NGR — RTAA Zone 3. Gel nocturne possible. Isolation renforcée requise.`;
    }

    document.querySelectorAll('.etage-item').forEach(e => e.classList.remove('active'));
    const etageId = altMoy < 400 ? 'etage-aw' : altMoy < 900 ? 'etage-cf' : 'etage-cwb';
    document.getElementById(etageId)?.classList.add('active');

    SessionManager.saveTerrain({
      altitude_ngr: altMoy, pente_moy_pct: pente,
      alt_min_dem: min, alt_max_dem: max, denivele: max - min
    });
    window.TerlabToast?.show('Altimétrie analysée — données sur la parcelle', 'success');

    // Afficher la section profil auto et déclencher le profil N-S
    document.getElementById('auto-profile-section').style.display = '';
    this.autoProfile();

    // Afficher la section Coupes A/B
    document.getElementById('section-ab-section').style.display = '';

    // Auto-détecter la station météo la plus proche
    P01._autoDetectMeteo(lat, lng);
  },

  // ─── Analyse LiDAR HD ─────────────────────────────────────────
  async analyzeLidar() {
    const terrain = SessionManager.getTerrain();
    if (!terrain?.parcelle_geojson) {
      window.TerlabToast?.show('Parcelle non définie — complétez la Phase 0', 'warning');
      return;
    }

    const btn = document.getElementById('btn-lidar');
    btn?.classList.add('loading');
    btn && (btn.textContent = '⏳ Chargement LiDAR…');

    // Afficher le spinner de progression
    const progressSection = document.getElementById('lidar-progress-section');
    const progressText = document.getElementById('lidar-progress-text');
    const progressDetail = document.getElementById('lidar-progress-detail');
    const progressFill = document.getElementById('lidar-progress-fill');
    if (progressSection) progressSection.style.display = 'block';

    const onProgress = (info) => {
      if (info.phase === 'tiles') {
        if (progressText) progressText.textContent = 'Localisation des tuiles IGN…';
        if (progressFill) progressFill.style.width = '5%';
      } else if (info.phase === 'loading' || info.phase === 'tile') {
        const pct = info.current && info.total
          ? Math.round(10 + (info.current / info.total) * 50)
          : 15;
        if (progressText) progressText.textContent = info.message || `Tuile ${info.current}/${info.total}…`;
        if (progressDetail) progressDetail.textContent = info.tileId || '';
        if (progressFill) progressFill.style.width = pct + '%';
      } else if (info.nodes) {
        const pct = Math.round(60 + (info.nodes / info.totalNodes) * 35);
        if (progressText) progressText.textContent = `Décompression LAZ… ${info.nodes}/${info.totalNodes}`;
        if (progressFill) progressFill.style.width = pct + '%';
      } else if (info.phase === 'fallback') {
        if (progressText) progressText.textContent = 'Basculement serveur PDAL…';
        if (progressFill) progressFill.style.width = '50%';
      }
    };

    try {
      // Charger toutes les classes d'un coup (les noeuds COPC contiennent toutes
      // les classes mélangées, filtrer après décompression = même coût réseau)
      const result = await LidarService.getPointsForParcel(
        terrain.parcelle_geojson, 50, { classes: '2,3,4,5,6,9', maxPoints: 300000, onProgress }
      );

      if (!result.points.length) {
        window.TerlabToast?.show('Aucun point LiDAR disponible pour cette zone', 'warning');
        return;
      }

      // Cacher les points pour le profil + cache global (survit au changement de phase)
      this._lidarPoints = result.points;
      LidarService.setRawPoints(result.points, '2,3,4,5,6,9');

      // Analyser pente / exposition / altitudes
      const analysis = LidarService.analyzeTerrain(result.points, terrain.parcelle_geojson);
      if (analysis.error) {
        window.TerlabToast?.show(analysis.error, 'warning');
        return;
      }

      // Mettre à jour l'UI
      document.getElementById('topo-alt-min').textContent  = analysis.alt_min;
      document.getElementById('topo-alt-max').textContent  = analysis.alt_max;
      document.getElementById('topo-pente').textContent    = analysis.pente_moy_pct;
      document.getElementById('topo-denivele').textContent = analysis.denivele_m;

      // Badge source
      const badge = document.getElementById('topo-source-badge');
      if (badge) {
        badge.textContent = 'LiDAR HD';
        badge.dataset.source = 'lidar';
      }

      // Info LiDAR
      const info = document.getElementById('lidar-info');
      const infoText = document.getElementById('lidar-info-text');
      if (info && infoText) {
        info.style.display = 'flex';
        infoText.textContent = `${result.count.toLocaleString('fr')} pts · ${result.tile_count} tile(s) · ${analysis.exposition} · source: ${result.source}`;
      }

      // Sauvegarder en session
      const altMoy = Math.round((analysis.alt_min + analysis.alt_max) / 2);
      SessionManager.saveTerrain({
        altitude_ngr: altMoy,
        pente_moy_pct: analysis.pente_moy_pct,
        orientation_terrain: analysis.exposition,
      });
      SessionManager.savePhase(1, {
        lidar_available: true,
        lidar_source: 'lidar_hd',
        lidar_point_count: result.count,
        lidar_ground_count: analysis.point_count,
        lidar_alt_min: analysis.alt_min,
        lidar_alt_max: analysis.alt_max,
        lidar_pente: analysis.pente_moy_pct,
        lidar_exposition: analysis.exposition,
        lidar_denivele: analysis.denivele_m,
        lidar_analysis_date: new Date().toISOString(),
      });

      // RTAA zone update
      const rtaaZone = altMoy < 400 ? '1 (Aw côtier)' : altMoy < 900 ? '2 (Cf mi-pentes)' : '3 (Cwb hauts)';
      document.getElementById('ts-rtaa').textContent = rtaaZone;
      if (terrain.altitude_ngr) document.getElementById('ts-alt').textContent = `${altMoy} m`;

      // Highlight étage
      document.querySelectorAll('.etage-item').forEach(e => e.classList.remove('active'));
      const etageId = altMoy < 400 ? 'etage-aw' : altMoy < 900 ? 'etage-cf' : 'etage-cwb';
      document.getElementById(etageId)?.classList.add('active');

      // Auto-select orientation radio
      const expMap = { 'N': 'Nord', 'NE': 'Nord-Est', 'E': 'Est', 'SE': 'Sud-Est', 'S': 'Sud', 'SO': 'Sud-Ouest', 'O': 'Ouest', 'NO': 'Nord-Ouest' };
      const expVal = expMap[analysis.exposition];
      if (expVal) {
        document.querySelectorAll('[name="orientation"]').forEach(r => {
          if (r.value === expVal) {
            r.checked = true;
            r.closest('.radio-option')?.classList.add('selected');
          }
        });
      }

      window.TerlabToast?.show(`LiDAR HD — ${analysis.point_count} pts sol · pente ${analysis.pente_moy_pct}% ${analysis.exposition}`, 'success', 4000);
      P01._autoDetectMeteo(parseFloat(terrain.lat), parseFloat(terrain.lng));

      // Afficher les points sur la carte + panneau de visualisation
      this._showLidarViz(result.points, result.count);

      // Afficher la section Coupes A/B (LiDAR disponible pour HD)
      document.getElementById('section-ab-section').style.display = '';

    } catch (err) {
      console.error('[P01] Erreur LiDAR:', err);
      window.TerlabToast?.show(`Erreur LiDAR : ${err.message}`, 'error');
    } finally {
      // Masquer le spinner de progression
      if (progressSection) progressSection.style.display = 'none';
      if (btn) {
        btn.classList.remove('loading');
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="2" stroke="currentColor" stroke-width="1.2"/><path d="M3 3L2 2M9 3L10 2M3 9L2 10M9 9L10 10" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg> LiDAR HD (±0.15m)`;
      }
    }
  },

  // ─── Afficher la visualisation LiDAR sur la carte ─────────────
  _showLidarViz(points, totalCount) {
    // Stocker les points bruts dans MapViewer pour les changements de mode
    MapViewer.setLidarRawPoints(points);
    MapViewer.showLidarPoints(points, 'classification');

    // Afficher la section de visualisation
    document.getElementById('lidar-viz-section').style.display = 'block';

    // Statistiques par classe
    const classCount = {};
    const classLabels = { 2: 'Sol', 3: 'Vég. basse', 4: 'Vég. moyenne', 5: 'Vég. haute', 6: 'Bâtiments', 9: 'Eau' };
    for (const p of points) {
      const cls = p.length >= 7 ? p[6] : 2;
      classCount[cls] = (classCount[cls] ?? 0) + 1;
    }

    const statsEl = document.getElementById('lidar-stats');
    if (statsEl) {
      const parts = Object.entries(classCount)
        .sort((a, b) => b[1] - a[1])
        .map(([cls, n]) => `${classLabels[cls] ?? `#${cls}`}: <span>${n.toLocaleString('fr')}</span>`)
        .join(' · ');
      statsEl.innerHTML = `Total: <span>${totalCount.toLocaleString('fr')}</span> pts · ${parts}`;
    }

    this._lidarViewMode = 'classification';
  },

  // ─── Sélecteur de couche LiDAR ────────────────────────────────
  setLidarView(mode) {
    document.querySelectorAll('.lidar-layer-btn').forEach(b => b.classList.remove('active'));
    const legendCls  = document.getElementById('lidar-legend');
    const legendAlt  = document.getElementById('lidar-legend-alt');
    const legendHgt  = document.getElementById('lidar-legend-height');

    // Masquer toutes les légendes
    if (legendCls) legendCls.style.display = 'none';
    if (legendAlt) legendAlt.style.display = 'none';
    if (legendHgt) legendHgt.style.display = 'none';

    if (mode === 'off') {
      MapViewer.toggleLidarLayer(false);
      document.getElementById('btn-lidar-off')?.classList.add('active');
    } else {
      MapViewer.toggleLidarLayer(true);
      MapViewer.setLidarMode(mode);
      this._lidarViewMode = mode;

      const btnMap = { classification: 'btn-lidar-class', rgb: 'btn-lidar-rgb', altitude: 'btn-lidar-alt', height: 'btn-lidar-height' };
      document.getElementById(btnMap[mode])?.classList.add('active');

      if (mode === 'classification' && legendCls) legendCls.style.display = 'flex';
      if (mode === 'altitude' && legendAlt) {
        legendAlt.style.display = 'flex';
        const pts = this._lidarPoints ?? [];
        if (pts.length) {
          let aMin = Infinity, aMax = -Infinity;
          for (const p of pts) { if (p[2] < aMin) aMin = p[2]; if (p[2] > aMax) aMax = p[2]; }
          document.getElementById('lidar-alt-min').textContent = Math.round(aMin) + 'm';
          document.getElementById('lidar-alt-max').textContent = Math.round(aMax) + 'm';
        }
      }
      if (mode === 'height' && legendHgt) {
        legendHgt.style.display = 'flex';
        const pts = this._lidarPoints ?? [];
        if (pts.length) {
          let gMin = Infinity, altMax = -Infinity;
          for (const p of pts) {
            if (p[2] > altMax) altMax = p[2];
            if (p[6] === 2 && p[2] < gMin) gMin = p[2];
          }
          if (gMin === Infinity) { for (const p of pts) { if (p[2] < gMin) gMin = p[2]; } }
          document.getElementById('lidar-height-max').textContent = Math.round(altMax - gMin) + 'm';
        }
      }
    }
  },

  // ─── Taille des points LiDAR ──────────────────────────────────
  setLidarPointSize(size) {
    const s = parseFloat(size);
    const lbl = document.getElementById('lidar-size-val');
    if (lbl) lbl.textContent = s;
    MapViewer.setLidarPointSize(s);
  },

  // ─── Charger toutes les classes LiDAR (sol + bâtiments + végétation) ──
  async loadAllLidarClasses() {
    const terrain = SessionManager.getTerrain();
    if (!terrain?.parcelle_geojson) return;

    const btn = document.getElementById('btn-lidar-all-classes');
    if (btn) { btn.classList.add('loading'); btn.textContent = '⏳ Chargement…'; }

    try {
      const result = await LidarService.getPointsForParcel(
        terrain.parcelle_geojson, 50, { classes: '2,3,4,5,6,9', maxPoints: 300000 }
      );

      if (!result.points.length) {
        window.TerlabToast?.show('Aucun point retourné', 'warning');
        return;
      }

      // Mettre à jour le cache local + global (toutes classes pour la 3D)
      this._lidarPoints = result.points;
      LidarService.setRawPoints(result.points, '2,3,4,5,6,9');
      this._showLidarViz(result.points, result.count);
      this.setLidarView(this._lidarViewMode ?? 'classification');

      window.TerlabToast?.show(`${result.count.toLocaleString('fr')} points chargés (toutes classes)`, 'success', 3000);
    } catch (err) {
      console.error('[P01] Erreur chargement toutes classes:', err);
      window.TerlabToast?.show(`Erreur : ${err.message}`, 'error');
    } finally {
      if (btn) {
        btn.classList.remove('loading');
        btn.textContent = 'Charger toutes les classes (sol + bâtiments + végétation)';
      }
    }
  },

  // ─── COUPES A/B — Génération automatique ───────────────────────
  _sectionAxes: null,
  _sectionSplitId: null,

  async generateSections() {
    if (!SectionViewer) {
      window.TerlabToast?.show('Module SectionProfileViewer non chargé', 'error');
      return;
    }

    const terrain = SessionManager.getTerrain();
    if (!terrain?.parcelle_geojson || !terrain?.lat || !terrain?.lng) {
      window.TerlabToast?.show('Parcelle non définie — complétez la Phase 0', 'warning');
      return;
    }

    const btn = document.getElementById('btn-gen-sections');
    if (btn) btn.textContent = '⏳ Calcul des coupes…';

    const center = [parseFloat(terrain.lng), parseFloat(terrain.lat)];
    const orientation = terrain.orientation_terrain
      || (document.querySelector('[name="orientation"]:checked')?.value)
      || 'S';

    try {
      // 1. Compute axes
      const axes = SectionViewer.computeSectionAxes(terrain.parcelle_geojson, orientation, center);
      if (!axes) {
        window.TerlabToast?.show('Impossible de calculer les axes de coupe', 'warning');
        return;
      }
      this._sectionAxes = axes;

      // 2. Draw lines on map
      MapViewer.drawSectionLines(axes);

      // 3. Extract profiles (LiDAR or fallback)
      const lidarPts = this._lidarPoints ?? LidarService?.getRawPoints?.() ?? null;
      const [profileA, profileB] = await Promise.all([
        SectionViewer.extractProfile(axes.A, lidarPts),
        SectionViewer.extractProfile(axes.B, lidarPts),
      ]);

      // 4. Build annotations
      const map = MapViewer.getMap();
      const crossing = SectionViewer.findSectionCrossing(axes.A, axes.B);

      const annoA = [
        ...SectionViewer.findParcelBoundaryIntersections(axes.A.start, axes.A.end, terrain.parcelle_geojson),
        ...SectionViewer.findRoadIntersections(axes.A.start, axes.A.end, map),
      ];
      const annoB = [
        ...SectionViewer.findParcelBoundaryIntersections(axes.B.start, axes.B.end, terrain.parcelle_geojson),
        ...SectionViewer.findRoadIntersections(axes.B.start, axes.B.end, map),
      ];

      // Add cross-section marks
      if (crossing) {
        annoA.push({ name: 'Coupe B', distance_m: crossing.distA_m, type: 'section_cross' });
        annoB.push({ name: 'Coupe A', distance_m: crossing.distB_m, type: 'section_cross' });
      }

      // 5. Render profiles
      const srcLabel = (s) => s === 'lidar_hd' ? 'LiDAR HD ±0.15m' : s === 'ign_api' ? 'IGN ~2m' : 'DEM ~10m';

      if (profileA.data.length) {
        SectionViewer._viewers.A = SectionViewer._viewers.A || {};
        SectionViewer._viewers.A.source = profileA.source;
        SectionViewer.render('A', 'section-viewer-A', profileA.data, annoA);
        const lenA = Math.round(profileA.data[profileA.data.length - 1]?.distance_m || 0);
        document.getElementById('section-info-A').textContent = `${lenA}m · ${srcLabel(profileA.source)}`;
      }

      if (profileB.data.length) {
        SectionViewer._viewers.B = SectionViewer._viewers.B || {};
        SectionViewer._viewers.B.source = profileB.source;
        SectionViewer.render('B', 'section-viewer-B', profileB.data, annoB);
        const lenB = Math.round(profileB.data[profileB.data.length - 1]?.distance_m || 0);
        document.getElementById('section-info-B').textContent = `${lenB}m · ${srcLabel(profileB.source)}`;
      }

      // 6. Show source badge
      const badge = document.getElementById('section-source-badge');
      if (badge) {
        const src = profileA.source || profileB.source;
        badge.textContent = srcLabel(src);
        badge.style.display = 'inline';
      }

      // 7. Save to session
      SessionManager.savePhase(1, {
        section_a_generated: true,
        section_b_generated: true,
        section_source: profileA.source || profileB.source,
        section_a_bearing: axes.A.bearing,
        section_b_bearing: axes.B.bearing,
        section_timestamp: new Date().toISOString(),
      });

      if (btn) btn.textContent = '↻ Régénérer Coupes A/B';
      window.TerlabToast?.show('Coupes A/B générées — cliquez pour le split-screen', 'success', 4000);

    } catch (err) {
      console.error('[P01] Section generation error:', err);
      window.TerlabToast?.show(`Erreur coupes : ${err.message}`, 'error');
      if (btn) btn.textContent = '⚠ Erreur — réessayer';
    }
  },

  selectSection(id) {
    document.querySelectorAll('.section-card').forEach(c => c.classList.remove('active'));
    document.getElementById(`section-card-${id}`)?.classList.add('active');
    MapViewer.highlightSectionLine(id);
  },

  sectionZoom(id, action) {
    if (!SectionViewer) return;
    if (action === 'in') SectionViewer.zoomIn(id);
    else if (action === 'out') SectionViewer.zoomOut(id);
    else SectionViewer.resetZoom(id);
  },

  toggleSectionSplit(id) {
    const wrap = document.getElementById('section-split-wrap');
    if (!wrap) return;

    // If already showing this section, close
    if (this._sectionSplitId === id && wrap.classList.contains('split-active')) {
      this.closeSplit();
      return;
    }

    // Open split screen
    this._sectionSplitId = id;
    const state = SectionViewer._viewers[id];
    if (!state?.data) return;

    const titleEl = document.getElementById('section-split-title');
    if (titleEl) titleEl.textContent = `Coupe ${id} — ${id === 'A' ? 'Longitudinale' : 'Perpendiculaire'}`;

    const panel = document.getElementById('section-split-profile');
    if (panel) {
      panel.innerHTML = `<div id="section-split-viewer-${id}" style="width:100%;height:100%"></div>`;
      // Create a split viewer with larger dimensions
      const splitKey = `${id}_split`;
      SectionViewer._viewers[splitKey] = {
        ...state,
        el: document.getElementById(`section-split-viewer-${id}`),
        cfg: { ...state.cfg, width: 1200, height: 260 },
        zoomLevel: state.zoomLevel || 1,
        panX: state.panX || 0,
      };
      SectionViewer._renderSVG(splitKey);
    }

    wrap.classList.add('split-active');
    MapViewer.highlightSectionLine(id);

    // Update button states
    document.querySelectorAll('.section-split-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.section-split-btn[data-section="${id}"]`)?.classList.add('active');
  },

  closeSplit() {
    const wrap = document.getElementById('section-split-wrap');
    if (wrap) wrap.classList.remove('split-active');
    this._sectionSplitId = null;
    MapViewer.resetSectionHighlight();
    document.querySelectorAll('.section-split-btn').forEach(b => b.classList.remove('active'));
  },

  splitZoom(action) {
    const id = this._sectionSplitId;
    if (!id) return;
    const splitKey = `${id}_split`;
    if (action === 'in') SectionViewer.zoomIn(splitKey);
    else if (action === 'out') SectionViewer.zoomOut(splitKey);
    else SectionViewer.resetZoom(splitKey);
  },

  // ─── Auto-détection station météo via MeteoService ─────────────
  _autoDetectMeteo(lat, lng) {
    const nearest = MeteoService.findNearest(lat, lng);
    if (!nearest) return;
    const select = document.getElementById('station-meteo');
    if (select && !select.value) {
      select.value = nearest.key;
      P01.updateMeteoData();
      window.TerlabToast?.show(`Station météo auto-détectée : ${nearest.label}`, 'info', 3000);
    }
    // Auto-détection ravines via BD TOPO
    P01._autoDetectRavines(lat, lng);
  },

  async _autoDetectRavines(lat, lng) {
    if (!BdTopoService) return;
    const nomInput = document.getElementById('nom-ravine');
    const distInput = document.getElementById('distance-ravine');
    if (nomInput?.value) return; // Déjà renseigné

    try {
      const coursEau = await BdTopoService.fetchCoursEau(lat, lng, 1500);
      if (!coursEau?.features?.length) return;

      // Trouver le cours d'eau le plus proche avec un nom
      let nearest = null, minDist = Infinity;
      for (const f of coursEau.features) {
        const nom = f.properties?.nom;
        if (!nom || nom === 'Inconnu' || nom === 'NR') continue;
        // Distance approx au centroïde de la ligne
        const coords = f.geometry?.coordinates;
        if (!coords?.length) continue;
        const mid = Array.isArray(coords[0][0]) ? coords[0][Math.floor(coords[0].length / 2)] : coords[Math.floor(coords.length / 2)];
        if (!mid) continue;
        const d = Math.hypot((mid[1] - lat) * 111000, (mid[0] - lng) * 111000 * Math.cos(lat * Math.PI / 180));
        if (d < minDist) { minDist = d; nearest = { nom, distance: Math.round(d) }; }
      }
      if (nearest) {
        if (nomInput) nomInput.value = nearest.nom;
        if (distInput) distInput.value = nearest.distance;
        SessionManager.saveTerrain({ nom_ravine: nearest.nom, distance_ravine_m: nearest.distance });
        window.TerlabToast?.show(`Ravine détectée : ${nearest.nom} (${nearest.distance}m)`, 'info', 3000);
      }
    } catch (e) {
      console.warn('[P01] Auto-détection ravines:', e.message);
    }
  },

  // ─── Fly-over ravine ─────────────────────────────────────────
  triggerFlyover() {
    const terrain = SessionManager.getTerrain();
    if (!terrain?.lat) return;
    MapViewer.flyOverRavine([[terrain.lng, terrain.lat - 0.005], [terrain.lng, terrain.lat], [terrain.lng, terrain.lat + 0.005]]);
    window.TerlabToast?.show('Fly-over 3D — cliquez pour arrêter la rotation', 'info', 4000);
  },

  toggleRavines() {
    const map = MapViewer.getMap();
    if (!map) return;
    this._ravinesVisible = !this._ravinesVisible;
    try { map.setLayoutProperty('ravines', 'visibility', this._ravinesVisible ? 'visible' : 'none'); } catch {}
    document.getElementById('btn-ravines-toggle')?.classList.toggle('active', this._ravinesVisible);
  },

  toggle3DExag() {
    const map = MapViewer.getMap();
    if (!map) return;
    this._exag = this._exag === 1.4 ? 2.5 : 1.4;
    try { map.setTerrain({ source: 'mapbox-dem', exaggeration: this._exag }); } catch {}
    const btn = document.querySelector('.map-ctl-btn');
    if (btn) btn.textContent = `3D ×${this._exag}`;
  },

  selectOrientation(label, val) {
    document.querySelectorAll('[name="orientation"]').forEach(r => r.closest('.radio-option')?.classList.remove('selected'));
    label.classList.add('selected');
    this._orientation = val;
    SessionManager.saveTerrain({ orientation_terrain: val });
  },

  selectZonePluvio(label, val) {
    document.querySelectorAll('[name="pluvio"]').forEach(r => r.closest('.radio-option')?.classList.remove('selected'));
    label.classList.add('selected');
    SessionManager.saveTerrain({ zone_pluvio: val });
  },

  async updateMeteoData() {
    const station = document.getElementById('station-meteo')?.value;
    if (!station) return;

    // Utiliser MeteoService pour données enrichies
    const data = await MeteoService.getData(station);
    if (!data) return;

    document.getElementById('meteo-grid').style.display = 'grid';
    document.getElementById('m-pluvio').textContent    = data.pluvio;
    document.getElementById('m-tmoy').textContent      = data.tmoy;
    document.getElementById('m-tmin').textContent      = data.tmin;
    document.getElementById('m-tmax').textContent      = data.tmax;
    document.getElementById('m-vent').textContent      = data.vent;
    document.getElementById('m-amplitude').textContent = data.amp;

    // Afficher la source des données
    const srcNote = document.getElementById('meteo-source-note');
    const srcIcon = document.getElementById('meteo-source-icon');
    const srcText = document.getElementById('meteo-source-text');
    if (srcNote) {
      srcNote.style.display = 'flex';
      srcIcon.textContent = data.source === 'api_meteofrance' ? '📡' : '📊';
      srcText.textContent = data.note;
    }

    SessionManager.saveTerrain({
      station_meteo: station,
      zone_pluvio: data.zone_pluvio,
      pluvio: data.pluvio, tmoy: data.tmoy, tmin: data.tmin, tmax: data.tmax
    });

    if (data.amp >= 15) {
      document.getElementById('alert-altitude').style.display = 'flex';
      document.getElementById('alert-altitude-text').textContent =
        `Amplitude thermique ${data.amp}°C — Isolation renforcée et ruptures de pont thermique requises.`;
    }
  },

  // ─── Aéraulique (Sprint 1) ──────────────────────────────────

  /** Récupère les données du profil topo pour AeraulicSection */
  _getProfileData() {
    const raw = MapViewer.getProfileData?.();
    if (!raw || !raw.altitudes?.length) return null;
    const overlay = document.getElementById('p01-aero-overlay');
    if (!overlay) return null;
    const wrap = overlay.parentElement;
    const rect = wrap?.getBoundingClientRect() ?? { width: 600, height: 120 };
    const w = rect.width, h = rect.height;
    // Mettre à jour le viewBox du SVG overlay
    overlay.setAttribute('viewBox', `0 0 ${w} ${h}`);
    overlay.setAttribute('width', w);
    overlay.setAttribute('height', h);
    const pts = raw.altitudes.map((alt, i) => ({
      dist: raw.distances?.[i] ?? (i * (raw.length_m / Math.max(raw.altitudes.length - 1, 1))),
      alt,
    }));
    const denivele = (raw.alt_max ?? 0) - (raw.alt_min ?? 0);
    return {
      points:    pts,
      svgWidth:  w,
      svgHeight: h,
      groundY:   h - 15,
      scaleX:    w / Math.max(raw.length_m || 1, 1),
      scaleY:    denivele > 0 ? (h - 30) / denivele : 1.5,
    };
  },

  /** Lancer l'analyse aéraulique sur le profil courant */
  runAeraulique() {
    const AeraulicSection = window.AeraulicSection;
    if (!AeraulicSection) { window.TerlabToast?.show('Module aéraulique non chargé', 'error'); return; }

    const terrainType = document.getElementById('p01-terrain-type')?.value ?? 'suburbain';
    const windDir     = +(document.getElementById('p01-wind-dir')?.value ?? 105);
    const terrain     = SessionManager.getTerrain();

    AeraulicSection.destroy();
    AeraulicSection.init({ terrain, terrainType, windDir });

    const profileData = this._getProfileData();
    if (!profileData || profileData.points.length < 3) {
      window.TerlabToast?.show('Tracez d\'abord un profil topographique', 'warning', 4000);
      return;
    }

    // Nettoyer le SVG overlay et superposer
    const overlaySvg = document.getElementById('p01-aero-overlay');
    if (overlaySvg) {
      overlaySvg.innerHTML = '';
      AeraulicSection.renderOverlay(profileData, overlaySvg);
    }

    // Score
    const { score, label, ctpMoyen } = AeraulicSection.computeSiteScore(profileData);
    const scoreEl = document.getElementById('p01-aero-score');
    if (scoreEl) {
      scoreEl.style.display = 'block';
      scoreEl.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;padding:6px 0">
          <div style="font-size:1.4rem;font-weight:700;
                      color:${score>=60?'var(--accent)':'#c84040'}">${score}/100</div>
          <div style="font-size:.75rem;color:var(--ink)">${label}<br>
            <span style="font-family:monospace;font-size:.65rem;color:var(--ink3)">
              C_TP moy. ${ctpMoyen} C₀
            </span>
          </div>
        </div>`;
    }

    // Diagnostic dans colonne droite
    const diagSection = document.getElementById('p01-aero-diag-section');
    const diagEl      = document.getElementById('p01-aero-diag');
    if (diagSection && diagEl) {
      diagSection.style.display = 'block';
      diagEl.innerHTML = AeraulicSection.generateDiagnostic(profileData);
    }

    // Sauvegarder en session
    SessionManager.savePhase(1, {
      aeraulique_score:    score,
      aeraulique_ctp:      ctpMoyen,
      aeraulique_rugosite: terrainType,
    });

    window.TerlabToast?.show(`Score aéraulique : ${score}/100 — ${label}`, 'success', 3500);
    window.dispatchEvent(new CustomEvent('terlab:aeraulique-score', { detail: { score, ctpMoyen } }));
  },

  updateWindDir(val) {
    const el = document.getElementById('p01-wind-dir-val');
    if (el) el.textContent = val + '°';
  },

  // ─── Overlay C_TP (Sprint 2) ────────────────────────────────
  _ctpOverlayActive: false,

  toggleCtpOverlay() {
    const AeraulicMapTools = window.AeraulicMapTools;
    const map = window.TerlabMap?.getMap?.();
    if (!map || !AeraulicMapTools) { window.TerlabToast?.show('Carte non disponible', 'warning'); return; }

    const btn  = document.getElementById('p01-ctp-btn');
    const stub = document.getElementById('p01-ctp-stub');
    if (this._ctpOverlayActive) {
      AeraulicMapTools.removeCtpOverlay(map);
      this._ctpOverlayActive = false;
      if (btn)  btn.textContent = 'Overlay C_TP sur carte';
      if (stub) stub.style.display = 'none';
    } else {
      const windDir = +(document.getElementById('p01-wind-dir')?.value ?? 105);
      AeraulicMapTools.addCtpOverlay(map, [], windDir);
      this._ctpOverlayActive = true;
      if (btn)  btn.textContent = 'Masquer overlay C_TP';
      if (stub) stub.style.display = 'block';
      window.TerlabToast?.show('Overlay C_TP activé — précision indicative', 'info', 4000);
    }
  },
};

// ─── Init données héritées Phase 0 ──────────────────────────
const terrain = SessionManager.getTerrain();
if (terrain?.commune) document.getElementById('ts-commune').textContent = terrain.commune;
if (terrain?.altitude_ngr) document.getElementById('ts-alt').textContent = `${terrain.altitude_ngr} m`;

// ─── Afficher le contour de la parcelle Phase 0 en surbrillance ──
if (terrain?.parcelle_geojson) {
  // Attendre que la carte soit prête
  const waitMap = setInterval(() => {
    const map = MapViewer.getMap();
    if (map && map.isStyleLoaded()) {
      clearInterval(waitMap);
      MapViewer.showParcelleContour(terrain.parcelle_geojson);

      // Afficher le label
      const label = document.getElementById('terrain-label-p01');
      const labelText = document.getElementById('terrain-label-text-p01');
      if (label && labelText && terrain.section && terrain.parcelle) {
        labelText.textContent = `${terrain.section} ${terrain.parcelle} — ${terrain.commune}`;
        label.style.display = 'block';
      }
    }
  }, 300);
}

// ─── Afficher bouton flyover si ravine renseignée ────────────
document.getElementById('nom-ravine')?.addEventListener('input', e => {
  const btn = document.getElementById('btn-flyover');
  if (btn) btn.style.display = e.target.value.length > 2 ? 'flex' : 'none';
});

// ─── Écouter le profil tracé → enrichir avec LiDAR si dispo ────
window.addEventListener('terlab:profile-drawn', (e) => {
  const data = e.detail;
  document.getElementById('profile-empty').style.display = 'none';
  document.getElementById('btn-trace-profile').textContent = '✏ Retracer une nouvelle coupe';

  // Si des points LiDAR sont en cache, recalculer le profil en HD
  if (P01._lidarPoints && data?.from && data?.to) {
    const lidarProfile = LidarService.getProfileFromPoints(
      P01._lidarPoints, data.from, data.to, 5
    );
    if (lidarProfile.length > 5) {
      const alts = lidarProfile.map(p => p.altitude_m);
      data.alt_min    = Math.round(Math.min(...alts) * 10) / 10;
      data.alt_max    = Math.round(Math.max(...alts) * 10) / 10;
      data.denivele   = Math.round((data.alt_max - data.alt_min) * 10) / 10;
      data.altitudes  = alts;
      data.distances  = lidarProfile.map(p => p.distance_m);
      data.pente_moy  = data.length_m > 0 ? Math.round(data.denivele / data.length_m * 1000) / 10 : 0;
      data._lidar_hd  = true;
    }
  }

  // Afficher le résumé
  const summary = document.getElementById('profile-summary');
  if (summary && data) {
    summary.style.display = 'grid';
    const suffix = data._lidar_hd ? ' (LiDAR)' : '';
    document.getElementById('ps-length').textContent   = `${data.length_m} m`;
    document.getElementById('ps-alt-min').textContent  = `${data.alt_min} m${suffix}`;
    document.getElementById('ps-alt-max').textContent  = `${data.alt_max} m${suffix}`;
    document.getElementById('ps-denivele').textContent = `${data.denivele} m`;
    document.getElementById('ps-pente').textContent    = `${data.pente_moy} %`;
  }

  // Afficher le bouton de validation
  document.getElementById('btn-validate-profile').style.display = 'flex';
});

// ─── Restaurer profil validé depuis session ────────────────────
const p1data = SessionManager.getPhase(1)?.data ?? {};
if (p1data.profile_validated) {
  document.getElementById('profile-status').style.display = 'inline';
  document.getElementById('profile-empty').style.display = 'none';
  const summary = document.getElementById('profile-summary');
  if (summary) {
    summary.style.display = 'grid';
    document.getElementById('ps-length').textContent   = `${p1data.profile_length_m} m`;
    document.getElementById('ps-alt-min').textContent  = `${p1data.profile_alt_min} m`;
    document.getElementById('ps-alt-max').textContent  = `${p1data.profile_alt_max} m`;
    document.getElementById('ps-denivele').textContent = `${p1data.profile_denivele} m`;
    document.getElementById('ps-pente').textContent    = `${p1data.profile_pente_moy} %`;
  }
}

// ─── RiskPlayer injection ───────────────────────────────────────
const risksForPhase = (window.TERLAB_RISK?.risques ?? []).filter(r => r.phase === 1 || r.phase === '1');
const rpcContainer  = document.getElementById('risk-player-container-p01');
if (rpcContainer && risksForPhase.length) {
  rpcContainer.innerHTML = RiskPlayer.buildOpenBtn(1, risksForPhase.length);
}

// ─── Auto-détection météo si terrain déjà connu ────────────────
if (terrain?.lat && terrain?.lng && !p1data.station_meteo) {
  const nearest = MeteoService.findNearest(parseFloat(terrain.lat), parseFloat(terrain.lng));
  if (nearest) {
    const select = document.getElementById('station-meteo');
    if (select && !select.value) {
      select.value = nearest.key;
      P01.updateMeteoData();
    }
  }
}

// ─── GIEP : Terrain SVG auto si données parcelle connues ────────
if (terrain?.parcelle_geojson || terrain?.contenance_m2 || terrain?.largeur_m) {
  const svgOpts = {
    pente:       parseFloat(terrain.pente_moy_pct ?? 0),
    exposition:  terrain.orientation_terrain ?? null,
    ravine_dist: parseFloat(terrain.distance_ravine_m ?? 999),
  };
  if (terrain.parcelle_geojson) {
    svgOpts.geojson = terrain.parcelle_geojson;
  } else {
    svgOpts.longueur = parseFloat(terrain.largeur_m ?? Math.sqrt(terrain.contenance_m2 ?? 400));
    svgOpts.largeur  = parseFloat(terrain.longueur_m ?? Math.sqrt(terrain.contenance_m2 ?? 400) * 0.7);
  }
  TerrainSVG.init('terrainSVG', svgOpts);
}

// ─── GIEP : Hydrate les cellules détectées depuis la session ────
if (terrain?.pente_moy_pct) {
  const el = document.getElementById('svg-pente');
  if (el) el.textContent = terrain.pente_moy_pct + '%';
}
if (terrain?.zone_climatique) {
  const el = document.getElementById('svg-zone');
  if (el) el.textContent = terrain.zone_climatique_nom ?? terrain.zone_climatique;
}
if (terrain?.zone_rtaa) {
  const el = document.getElementById('svg-rtaa');
  if (el) el.textContent = 'Zone ' + terrain.zone_rtaa;
}
if (terrain?.pluvio_T10) {
  const el = document.getElementById('svg-pluvio');
  if (el) el.textContent = terrain.pluvio_T10 + ' mm/h';
}

// ─── GIEP : Écouter terlab:parcelle-found pour analyse auto ─────
window.addEventListener('terlab:parcelle-found', async (e) => {
  const feature = e.detail;
  const t = SessionManager.getTerrain();
  try {
    const analyse = await TerrainAnalysis.autoAnalyze(feature, t);
    SessionManager.saveTerrain(analyse);

    // Mettre à jour le SVG avec le vrai polygone
    const svgOpts2 = {
      pente:       analyse.pente_moy_pct,
      exposition:  analyse.orientation_terrain,
      ravine_dist: parseFloat(t.distance_ravine_m ?? 999),
    };
    if (t.parcelle_geojson) {
      svgOpts2.geojson = t.parcelle_geojson;
    } else {
      svgOpts2.longueur = parseFloat(t.largeur_m ?? Math.sqrt(t.contenance_m2 ?? 400));
      svgOpts2.largeur  = parseFloat(t.longueur_m ?? Math.sqrt(t.contenance_m2 ?? 400) * 0.7);
    }
    TerrainSVG.init('terrainSVG', svgOpts2);

    // Mettre à jour les cellules détectées
    const pEl = document.getElementById('svg-pente');
    if (pEl) pEl.textContent = analyse.pente_moy_pct + '%';
    const zEl = document.getElementById('svg-zone');
    if (zEl) zEl.textContent = analyse.zone_climatique_nom;
    const rEl = document.getElementById('svg-rtaa');
    if (rEl) rEl.textContent = 'Zone ' + analyse.zone_rtaa;
    const plEl = document.getElementById('svg-pluvio');
    if (plEl) plEl.textContent = analyse.pluvio_T10 + ' mm/h';

    // Toast de confirmation
    if (window.TerlabToast) {
      window.TerlabToast.show(
        `Zone ${analyse.zone_climatique_nom} · RTAA ${analyse.zone_rtaa} · Pente ≈${analyse.pente_moy_pct}%`,
        'success', 4000
      );
    }
  } catch (err) {
    console.error('[P01] Erreur analyse terrain GIEP:', err);
  }
});

// ─── AUTO-ANALYSE : lancer l'altimétrie automatiquement si terrain connu ──
if (terrain?.lat && terrain?.lng) {
  // Attendre que la carte soit idle (DEM chargé) avant d'analyser
  const _autoAnalyze = () => {
    console.log('[P01] Auto-analyse altimétrie…');
    P01.analyzeAltitude();
  };
  const _map = MapViewer.getMap();
  if (_map) {
    const _tryWhenReady = () => {
      if (_map.isStyleLoaded() && _map.areTilesLoaded()) {
        setTimeout(_autoAnalyze, 400);
      } else {
        _map.once('idle', () => setTimeout(_autoAnalyze, 400));
      }
    };
    _tryWhenReady();
  } else {
    // Carte pas encore créée — fallback polling léger
    const _wait = setInterval(() => {
      const m = MapViewer.getMap();
      if (m) {
        clearInterval(_wait);
        m.once('idle', () => setTimeout(_autoAnalyze, 400));
      }
    }, 300);
  }
}

// ─── LiDAR : vérifier disponibilité serveur au chargement ──────
LidarService.isAvailable().then(available => {
  if (available) {
    document.getElementById('btn-lidar').style.display = 'flex';
    document.getElementById('topo-source-badge').dataset.source = 'dem';
    console.log('[P01] Serveur LiDAR HD disponible');
  }
});

// ─── LiDAR : restaurer données depuis session ─────────────────
if (p1data.lidar_source === 'lidar_hd') {
  const badge = document.getElementById('topo-source-badge');
  if (badge) { badge.textContent = 'LiDAR HD'; badge.dataset.source = 'lidar'; }
  const info = document.getElementById('lidar-info');
  const infoText = document.getElementById('lidar-info-text');
  if (info && infoText) {
    info.style.display = 'flex';
    infoText.textContent = `${(p1data.lidar_point_count ?? 0).toLocaleString('fr')} pts · source: LiDAR HD`;
  }
}

// ── Sun overlay methods ──────────────────────────────────────
P01._onSunScrub = function(val) {
  window.SunState?.setProgress(val / 1000, 'p01');
};

P01._initSunOverlay = function() {
  const wrap = document.getElementById('sg-presets-p01');
  if (wrap && window.SunCalcService?.DATES_CLES) {
    wrap.innerHTML = '';
    for (const [label, day] of Object.entries(SunCalcService.DATES_CLES)) {
      const btn = document.createElement('button');
      btn.className = 'sg-preset-btn';
      btn.textContent = label.replace(/ \(.*\)/, '');
      btn.onclick = () => window.SunState?.setDayOfYear(day, 'p01');
      wrap.appendChild(btn);
    }
  }
  window.addEventListener('terlab:sun-changed', P01._onSunChanged);
  P01._syncSunUI();
};

P01._onSunChanged = function(e) {
  if (e.detail?.source === 'p01') return;
  P01._syncSunUI();
};

P01._syncSunUI = function() {
  const ss = window.SunState;
  if (!ss) return;
  const dl  = ss.getDaylight();
  const pos = ss.getPosition();

  const scrub = document.getElementById('sg-scrub-p01');
  if (scrub) scrub.value = Math.round(ss.getProgress() * 1000);

  const sr = document.getElementById('sg-sunrise-p01');
  const st = document.getElementById('sg-sunset-p01');
  const ct = document.getElementById('sg-current-p01');
  if (sr) sr.textContent = ss.formatHour(dl.sunrise);
  if (st) st.textContent = ss.formatHour(dl.sunset);
  if (ct) ct.textContent = ss.formatHour();

  const hrs = document.getElementById('sg-hours-p01');
  if (hrs) hrs.textContent = dl.hours.toFixed(1) + ' h';

  const alt = document.getElementById('sg-alt-p01');
  if (alt) alt.textContent = pos.aboveHorizon ? Math.round(pos.altitude) + '°' : 'sous horizon';

  const az = document.getElementById('sg-az-p01');
  if (az) az.textContent = Math.round(pos.azimuth) + '°';
};

window.P01 = P01;
P01._initSunOverlay();

// Validation automatique aéraulique
window.addEventListener('terlab:aeraulique-score', () => {
  const check = document.getElementById('p01-check-aeraulique');
  if (check) { check.setAttribute('aria-checked','true'); check.classList.add('checked'); }
});

window.RiskPlayer = RiskPlayer;
window.TerrainSVG = TerrainSVG;
window.LidarService = LidarService;

// enviroBAT cards
if (window.EnvirobatCards) EnvirobatCards.render('eb-cards-p01', 'p01');
