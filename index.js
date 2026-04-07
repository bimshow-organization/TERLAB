// TERLAB · index.js v2 · Router + App Init · ENSA La Réunion
// ════════════════════════════════════════════════════════
// CORRECTIONS v2 :
//   ✅ Fix critique : script type="module" dans innerHTML ne s'exécute pas
//   ✅ Fix acteurs : restructuration injection depuis JSON plat
//   ✅ Fix session : terrain synchronisé depuis data-session-key
//   ✅ Topbar redesignée : phase-cards avec numéro + icône + label

import SessionManager    from './components/session-manager.js';
import TerlabStorage     from './components/terlab-storage.js';
import TerlabScoreService from './services/terlab-score-service.js';
import CoherenceService  from './services/coherence-service.js';
import MapViewer         from './components/map-viewer.js';
import BIMSHOWBridge  from './components/bimshow-bridge.js';
import ExportEngine   from './components/export-engine.js';
import SourceModal    from './components/source-modal.js';
import DemoLoader     from './components/demo-loader.js';

// ─── Services utilisés par les phases (centralisés ici) ─────────
import BRGMService          from './services/brgm-service.js';
import BuildingsService     from './services/buildings-service.js';
import IGNElevationService  from './services/ign-elevation-service.js';
import PLUService           from './services/plu-service.js';
import PPRService           from './services/ppr-service.js';
import TerrainAnalysis      from './services/terrain-analysis-service.js';
import MeteoService         from './services/meteo-service.js';
import OBIAService          from './services/obia-service.js';

// ─── Composants utilisés par les phases ─────────────────────────
import RiskPlayer        from './components/risk-player.js';
import Terrain3D         from './components/terrain-3d-viewer.js';
import AccesPompiers     from './components/acces-pompiers-canvas.js';
import EsquisseCanvas    from './components/esquisse-canvas.js';
import GIEPScore         from './components/giep-score.js';
import Buildings3DViewer from './components/buildings-3d-viewer.js';
import RTAAPanel         from './components/rtaa-panel.js';

// ─── Services utilisés par les phases (esquisse / analyse) ──────
import SlopesService     from './services/slopes-service.js';
import SunCalcService    from './services/sun-calc-service.js';
import TerrainSVG        from './services/terrain-svg-service.js';
import LidarService      from './services/lidar-service.js';
import EnvelopeGenerator from './services/envelope-generator.js';
import ParetoScorer      from './services/pareto-scorer.js';
import ViewDetector      from './services/view-detector.js';
import BpfGardenAdvisor  from './services/bpf-garden-advisor.js';
import RTAAAnalyzer      from './services/rtaa-analyzer.js';

// ─── Module aéraulique (Sprints 1-4) ────────────────────────
import ParcelSelector     from './components/parcel-selector.js';
import BILTerrain         from './services/bil-terrain.js';
import BackgroundTerrain  from './services/background-terrain.js';
import AeraulicSection    from './components/aeraulic-section.js';
import AeraulicMapTools   from './components/aeraulic-map-tools.js';
import WindNavigator      from './components/wind-navigator.js';
import AeraulicPlanner    from './components/aeraulic-planner.js';
import RtaaVentilationSim from './components/rtaa-ventilation-sim.js';
import * as MatUtils      from './utils/terlab-mat-utils.js';

// ─── Mini-viewer 3D intégré (remplace popup BIMSHOW) ────────
import BimshowViewer     from './components/bimshow-viewer.js';

// ─── Éditeur GeoJSON 3 niveaux (GPU + import + dessin) ──────
import CoordConverter        from './utils/coord-converter.js';
import GPUFetcher            from './services/gpu-fetcher.js';
import GeoJsonLayerService   from './services/geojson-layer-service.js';
import GeoJsonPanel          from './components/geojson-panel.js';

// ─── Données globales ────────────────────────────────────────────
let PHASES_META = null;
let ACTEURS     = null;
let RISQUES     = null;
let REFERENCES  = null;

// ─── État ────────────────────────────────────────────────────────
const AppState = {
  currentPhase: 0,
  sessionId:    null,
  mapboxToken:  null,
  loading:      false
};

// ═════════════════════════════════════════════════════════════════
// INIT
// ═════════════════════════════════════════════════════════════════
async function init() {
  setSplash('Chargement des données…', 10);
  try {
    const [meta, acteurs, risques, refs] = await Promise.all([
      fetch('data/phases-meta.json').then(r => r.json()),
      fetch('data/acteurs.json').then(r => r.json()),
      fetch('data/risques-phases.json').then(r => r.json()),
      fetch('data/references-biblio.json').then(r => r.json())
    ]);

    PHASES_META = meta;
    ACTEURS     = acteurs;
    RISQUES     = risques;
    REFERENCES  = refs;

    window.TERLAB_META  = PHASES_META;
    window.TERLAB_ACT   = ACTEURS;
    window.TERLAB_RISK  = RISQUES;
    window.TERLAB_REFS  = REFERENCES;

    setSplash('Initialisation session…', 30);

    // Multi-sessions : vérifier ?session= ou ?demo=
    const urlParams = new URLSearchParams(window.location.search);
    const requestedSession = urlParams.get('session');
    const isDemo = urlParams.has('demo');

    if (requestedSession) {
      // Charger une session spécifique depuis TerlabStorage
      const loaded = TerlabStorage.loadSession(requestedSession);
      if (loaded) {
        AppState.sessionId = requestedSession;
      } else {
        // Session introuvable — init par défaut
        AppState.sessionId = SessionManager.init();
        Toast.show('Session introuvable — nouvelle session créée', 'warning', 4000);
      }
    } else if (!isDemo) {
      // Pas de session demandée et pas en mode démo → rediriger vers accueil
      // Sauf s'il y a déjà une session active en localStorage (rétro-compatibilité)
      const existingData = localStorage.getItem('terlab_session_data');
      if (!existingData || existingData === '{}') {
        window.location.href = 'accueil.html';
        return;
      }
      AppState.sessionId = SessionManager.init();
    } else {
      // Mode démo
      AppState.sessionId = SessionManager.init();
    }

    // Activer l'auto-save multi-sessions
    TerlabStorage.attachAutoSave();

    updateSessionBadge();

    setSplash('Token Mapbox…', 50);
    // Token public Mapbox (pk.* = client-side, non secret)
    const _pk = ['pk.eyJ1IjoiYmltc2hvdyIsImEiOi', 'Jjbm5vYTJ4d2oxdzZzMnFzbTZwdmp3NnJ1In0', '.JYT9Kofu8088LsnoNUl6qw'];
    AppState.mapboxToken = localStorage.getItem('terlab_mapbox_token') || _pk.join('');
    localStorage.setItem('terlab_mapbox_token', AppState.mapboxToken);

    // Exposer les APIs globales AVANT route() — les scripts de phase en dépendent
    window.TerlabRouter  = Router;
    window.TerlabExport  = ExportEngine;
    window.TerlabSources = SourceModal;
    window.TerlabBIMSHOW = BIMSHOWBridge;
    window.TerlabSidebar = Sidebar;
    window.TerlabActors  = ActorCard;
    window.TerlabMap     = MapViewer;
    window.TerlabToast      = Toast;
    window.TerlabStorage    = TerlabStorage;
    window.DemoLoader       = DemoLoader;
    window.CoherenceService = CoherenceService;
    window.SessionManager   = SessionManager;
    window.BimshowViewer    = BimshowViewer;

    // Services géo/terrain
    window.BRGMService          = BRGMService;
    window.BuildingsService     = BuildingsService;
    window.IGNElevationService  = IGNElevationService;
    window.PLUService           = PLUService;
    window.PPRService           = PPRService;
    window.TerrainAnalysis      = TerrainAnalysis;
    window.MeteoService         = MeteoService;
    window.OBIAService          = OBIAService;

    // Services esquisse/analyse
    window.SlopesService     = SlopesService;
    window.SunCalcService    = SunCalcService;
    window.TerrainSVG        = TerrainSVG;
    window.LidarService      = LidarService;
    window.EnvelopeGenerator = EnvelopeGenerator;
    window.ParetoScorer      = ParetoScorer;
    window.ViewDetector      = ViewDetector;
    window.BpfGardenAdvisor  = BpfGardenAdvisor;
    window.RTAAAnalyzer      = RTAAAnalyzer;

    // Composants phases
    window.RiskPlayer    = RiskPlayer;
    window.Terrain3D     = Terrain3D;
    window.AccesPompiers = AccesPompiers;
    window.EsquisseCanvas = EsquisseCanvas;
    window.GIEPScore     = GIEPScore;
    window.RTAAPanel     = RTAAPanel;
    window.Buildings3DViewer = Buildings3DViewer;

    // Module aéraulique
    window.AeraulicSection  = AeraulicSection;
    window.AeraulicMapTools = AeraulicMapTools;
    window.WindNavigator    = WindNavigator;
    window.AeraulicPlanner    = AeraulicPlanner;
    window.RtaaVentilationSim = RtaaVentilationSim;
    window.ParcelSelector     = ParcelSelector;
    window.BILTerrain         = BILTerrain;
    window.BackgroundTerrain  = BackgroundTerrain;
    window.TerlabMU           = MatUtils;

    // GeoJSON editor (3 niveaux)
    window.CoordConverter      = CoordConverter;
    window.GPUFetcher          = GPUFetcher;
    window.GeoJsonLayerService = GeoJsonLayerService;
    window.GeoJsonPanel        = GeoJsonPanel;

    // Charger aeraulique-meta.json (non-bloquant)
    fetch('data/aeraulique-meta.json')
      .then(r => r.json())
      .then(d => { window.TERLAB_AERAULIQUE = d; })
      .catch(() => console.warn('[TERLAB] aeraulique-meta.json non chargé'));

    setSplash('Navigation…', 65);
    buildPhaseNav();
    initDemoBtns();

    setSplash('Chargement phase…', 80);
    await route();

    // Init GeoJSON layer system
    GeoJsonLayerService.restore();
    const gjpContainer = document.getElementById('gjp-container');
    if (gjpContainer) GeoJsonPanel.init(gjpContainer);

    setSplash('Prêt.', 100);
    setTimeout(hideSplash, 350);

    // Score topbar — mise à jour initiale + sur chaque changement
    updateToplevelScore();
    window.addEventListener('terlab:session-changed', updateToplevelScore);

    window.addEventListener('hashchange', route);
    window.addEventListener('message', BIMSHOWBridge.handleMessage.bind(BIMSHOWBridge));
    window.addEventListener('beforeunload', () => SessionManager.syncFirebase());

    // Toggle 3D viewer panel
    window.Terlab3DToggle = () => {
      const panel = document.getElementById('terlab-3d-panel');
      const app   = document.getElementById('terlab-app');
      const isOpen = !panel.hidden;
      if (isOpen) {
        panel.hidden = true;
        app.classList.remove('tv-open');
      } else {
        panel.hidden = false;
        app.classList.add('tv-open');
        if (!BimshowViewer._inited) BimshowViewer.init('terlab-3d-panel');
        // Send GLB if available
        const p7 = SessionManager?.getPhase?.(7)?.data ?? {};
        if (p7.glb_base64) BimshowViewer.loadGLB(p7.glb_base64);
      }
    };

    console.info(`[TERLAB] v2 initialisé — session ${AppState.sessionId}`);
  } catch (err) {
    console.error('[TERLAB] Erreur init:', err);
    setSplash(`Erreur : ${err.message}`, 0);
    Toast.show('Erreur de chargement — vérifiez la console', 'error', 8000);
  }
}

// ═════════════════════════════════════════════════════════════════
// ROUTER
// ═════════════════════════════════════════════════════════════════
const Router = {
  currentPhase: 0,

  async goto(id) {
    id = parseInt(id);
    if (isNaN(id) || id < 0 || id > 13) return;
    if (id === 13) return; // p13 World masquée — pas encore prête
    window.location.hash = `#phase/${id}`;
  },

  canAccess(id) {
    if (!PHASES_META) return true;
    for (let i = 0; i < Math.min(id, 4); i++) {
      const phaseMeta = PHASES_META.phases[i];
      if (phaseMeta?.blocking) {
        const sess          = SessionManager.getPhase(i);
        const blockingCount = (phaseMeta.validations ?? []).filter(v => v.bloquant).length;
        if (!sess?.completed && blockingCount > 0 && id > i + 1) return false;
      }
    }
    return true;
  },

  saveMapboxToken() {
    const input = document.getElementById('mapbox-token-input');
    const token = input?.value?.trim();
    if (!token || !token.startsWith('pk.')) {
      Toast.show('Token invalide — doit commencer par pk.', 'error'); return;
    }
    localStorage.setItem('terlab_mapbox_token', token);
    AppState.mapboxToken = token;
    document.getElementById('modal-token').hidden = true;
    MapViewer.setToken(token);
    Toast.show('Token Mapbox activé ✓', 'success');
    route();
  },

  skipMapboxToken() {
    document.getElementById('modal-token').hidden = true;
    Toast.show('Carte désactivée — fonctionnalités limitées', 'warning', 4000);
  }
};

async function route() {
  const hash    = window.location.hash || '#phase/0';
  const match   = hash.match(/#phase\/(\d+)/);
  let   phaseId = match ? parseInt(match[1]) : 0;

  // Pas de terrain → retour forcé en phase 0
  if (phaseId > 0) {
    const t = SessionManager.getTerrain();
    if (!t.commune && !t.parcelle_geojson) {
      window.location.hash = '#phase/0';
      return;
    }
  }

  if (AppState.loading) return;
  AppState.loading = true;
  Router.currentPhase = phaseId;
  AppState.currentPhase = phaseId;

  await loadPhase(phaseId);
  AppState.loading = false;
}

// ═════════════════════════════════════════════════════════════════
// LOAD PHASE — LE FIX CRITIQUE : réexécuter les scripts
// ═════════════════════════════════════════════════════════════════
async function loadPhase(id) {
  const meta = PHASES_META?.phases?.[id];
  if (!meta) return;

  // 1. Thème ivoire unifié + accent dynamique par phase
  document.documentElement.dataset.theme = 'ivory';
  if (meta.accent) {
    const r = document.documentElement;
    r.style.setProperty('--accent', meta.accent);
    r.style.setProperty('--accent2', meta.accent + '1f');
    r.style.setProperty('--accent3', meta.accent + '0f');
  }

  // 2. Fetch HTML de la phase
  let html;
  try {
    const fname = `phases/p${String(id).padStart(2,'0')}-${meta.slug}.html`;
    const resp  = await fetch(fname);
    if (!resp.ok) throw new Error(`${fname} introuvable`);
    html = await resp.text();
  } catch (e) {
    html = buildFallbackPhase(id, meta, e.message);
  }

  // ─── Aeraulic module cleanup ────────────────────────────
  window.AeraulicSection?.destroy?.();
  window.AeraulicMapTools?.destroyRbTool?.(MapViewer?.getMap?.());
  window.AeraulicMapTools?.removeCtpOverlay?.(MapViewer?.getMap?.());
  window.WindNavigator?.destroy?.();
  window.AeraulicPlanner?.destroy?.();
  window.RtaaVentilationSim?.destroy?.();

  // 3. Injecter le HTML (SANS les scripts — innerHTML ne les exécute pas)
  const container = document.getElementById('phase-container');

  // Extraire les scripts AVANT d'injecter
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  const scripts = Array.from(tempDiv.querySelectorAll('script'));
  scripts.forEach(s => s.remove()); // Retirer du DOM temporaire

  // Injecter le HTML nettoyé
  container.innerHTML = tempDiv.innerHTML;
  container.dataset.phase = id;

  // ═════════════════════════════════════════════════════
  // SPLIT LEFT-PANEL : contenu scrollable + val-block sticky
  // ═════════════════════════════════════════════════════
  const leftPanel = container.querySelector('.left-panel');
  if (leftPanel) {
    const valBlock = leftPanel.querySelector('.val-block');
    if (valBlock) {
      // Créer le wrapper scroll pour tout sauf val-block
      const scrollWrap = document.createElement('div');
      scrollWrap.className = 'left-panel-scroll';
      // Déplacer tous les enfants sauf val-block dans le wrapper
      while (leftPanel.firstChild && leftPanel.firstChild !== valBlock) {
        scrollWrap.appendChild(leftPanel.firstChild);
      }
      leftPanel.insertBefore(scrollWrap, valBlock);
    }
  }

  // ═════════════════════════════════════════════════════
  // FIX CRITIQUE — Réexécuter les scripts extirpés
  // Les scripts avec type="module" ajoutés via appendChild
  // s'exécutent correctement, contrairement à innerHTML.
  // ═════════════════════════════════════════════════════
  for (const oldScript of scripts) {
    const newScript = document.createElement('script');

    if (oldScript.src) {
      // Script externe
      newScript.src = oldScript.src;
      if (oldScript.type) newScript.type = oldScript.type;
      await new Promise((res, rej) => {
        newScript.onload = res;
        newScript.onerror = rej;
        document.head.appendChild(newScript);
      });
    } else {
      // Script inline — réecrire les imports relatifs pour qu'ils fonctionnent
      // depuis document.head (base URL = racine terlab/)
      newScript.type = oldScript.type || 'text/javascript';
      newScript.textContent = oldScript.textContent;
      document.head.appendChild(newScript);
      // Nettoyer après exécution
      setTimeout(() => newScript.remove(), 500);
    }
  }

  // 4. Carte
  if (AppState.mapboxToken) {
    try {
      await MapViewer.init({
        containerId: 'map',
        token:       AppState.mapboxToken,
        mode:        meta.map_mode,
        pitch:       meta.map_pitch ?? 0,
        bearing:     meta.map_bearing ?? 0,
        zoom:        meta.map_zoom_default ?? 15
      });
      // Init ParcelSelector dès que la carte est prête
      const _map = MapViewer.getMap();
      if (_map) ParcelSelector.init(_map);

      const terrain = SessionManager.getTerrain();
      if (terrain?.lat && terrain?.lng) {
        MapViewer.flyTo(parseFloat(terrain.lng), parseFloat(terrain.lat), meta.map_zoom_default ?? 15);
        _showTerrainOnMap(terrain);
      }
    } catch (e) {
      console.warn('[Map] Init failed:', e.message);
    }
  }

  // 5. Hydratation champs depuis session
  hydrate(id);

  // 6. MAJ nav
  updatePhaseNav(id);

  // 7. Acteurs + risques
  injectActors(id);
  injectRisks(id);

  // 8. Validation events
  attachValidationEvents(id);

  // 9. Sources
  SourceModal.setPhase(id, meta.slug);

  // 10. Animation entrée
  container.querySelectorAll('.anim-slide-up, .anim-fade-in').forEach((el, i) => {
    el.style.animationDelay = `${i * 0.05}s`;
  });

  // 11. Si validations incomplètes, scroll vers le bas pour montrer l'état
  setTimeout(() => {
    const scrollArea = container.querySelector('.left-panel-scroll');
    const valBlock   = container.querySelector('.val-block');
    if (scrollArea && valBlock) {
      const allChecked = container.querySelectorAll('.check-item.checked').length;
      const total      = container.querySelectorAll('.check-item').length;
      if (total && allChecked < total) {
        // Scroll en douceur vers le bas pour montrer que des validations manquent
        scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior: 'smooth' });
        // Puis revenir en haut après avoir montré les validations
        setTimeout(() => {
          scrollArea.scrollTo({ top: 0, behavior: 'smooth' });
        }, 1200);
      }
    }
  }, 400);

  // 12. Auto-capture map snapshot pour le PDF export
  setTimeout(() => { ExportEngine?._captureMapOnPhaseChange?.(id); }, 2000);
}

// Afficher le contour de la parcelle sur la carte après chaque changement de phase
function _showTerrainOnMap(terrain) {
  const map = MapViewer.getMap();
  if (!map) return;
  // Si session a la géométrie de la parcelle
  const geom = terrain.parcelle_geojson
    ?? (terrain.geometrie_approx ? { type: 'Polygon', coordinates: [terrain.geometrie_approx] } : null);
  if (!geom) return;
  try {
    // Mettre à jour la source parcelle si elle existe
    const src = map.getSource('parcelle-selected');
    if (src) src.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geom }] });
  } catch {}
}

// ═════════════════════════════════════════════════════════════════
// TOPBAR PHASES — REDESIGN CARDS
// ═════════════════════════════════════════════════════════════════
// SVG monochromes — stroke="currentColor", pas d'emojis colorés
const PHASE_ICONS_SVG = [
  /* 0 IDENT  */ `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5C5.5 1.5 4 4 4 6c0 3 4 8.5 4 8.5s4-5.5 4-8.5c0-2-1.5-4.5-4-4.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="6" r="1.8" stroke="currentColor" stroke-width="1.2"/></svg>`,
  /* 1 TOPO   */ `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 13l3.5-5 3 3 2.5-4L14 13" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/><path d="M1 13h13" stroke="currentColor" stroke-width="1" opacity=".4"/></svg>`,
  /* 2 GEO    */ `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 14l2-4 3 1 2-5 2 3 3-6" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/><path d="M2 14h12" stroke="currentColor" stroke-width="1" opacity=".5"/><circle cx="5" cy="8" r="1" fill="currentColor" opacity=".4"/></svg>`,
  /* 3 RISQ   */ `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L1.5 13.5h13L8 2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 6.5v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="11.5" r=".7" fill="currentColor"/></svg>`,
  /* 4 PLU    */ `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M2 6h12M6 2v12" stroke="currentColor" stroke-width="1" opacity=".5"/><path d="M9 9l2.5 2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  /* 5 VOIS   */ `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 14V7l3-3.5L9 7v7" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9 14V8.5l2.5-2L14 8.5V14" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M5 10v2M11 10.5v1.5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>`,
  /* 6 BIO    */ `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 14V6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M8 6C8 3 5.5 1.5 3 2.5c0 3 2 4.5 5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 8.5c0-2 2-3.5 4-2.5 0 2.5-1.5 3.5-4 2.5" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
  /* 7 ESQ    */ `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 13V5l3-2.5h4L13 5v8H3z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M6 13V9.5h4V13" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><path d="M3 5h10" stroke="currentColor" stroke-width="1" opacity=".4"/></svg>`,
  /* 8 CHANT  */ `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 14V6h2v8M7 14V4h2v10M10 14V7h2v7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 14h12" stroke="currentColor" stroke-width="1" opacity=".5"/></svg>`,
  /* 9 CO2    */ `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.2"/><path d="M5 8.5a3 3 0 015 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M8 2.5V5M12.5 5.5l-2 1.5M3.5 5.5l2 1.5" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity=".5"/></svg>`,
  /* 10 ENT   */ `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="7" r="3" stroke="currentColor" stroke-width="1.2"/><path d="M8 4V2.5M11.5 5.5l1-1M4.5 5.5l-1-1M12 7h1.5M2.5 7H4M4.5 8.5l-1 1M11.5 8.5l1 1M8 10v1.5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/><path d="M5 13.5h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  /* 11 FDV   */ `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 3h8v10l-4-2.5L4 13V3z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M6.5 6.5l3 3M9.5 6.5l-3 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  /* 12 SYNTH */ `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 2.5h7l3 3V13.5H3V2.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M10 2.5v3h3" stroke="currentColor" stroke-width="1"/><path d="M5.5 7h5M5.5 9.5h5M5.5 12h3" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity=".6"/></svg>`,
  /* 13 WORLD */ `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/><ellipse cx="8" cy="8" rx="3" ry="6" stroke="currentColor" stroke-width="1" opacity=".5"/><path d="M2 8h12M2.8 5h10.4M2.8 11h10.4" stroke="currentColor" stroke-width=".8" opacity=".4"/></svg>`,
];
const PHASE_LABELS_SHORT = ['IDENT','TOPO','GEO','RISQ','PLU','VOIS','BIO','ESQ','CHANT','CO2','ENT','FDV','SYNTH','WORLD'];

function buildPhaseNav() {
  const nav = document.getElementById('tb-phases');
  if (!nav || !PHASES_META) return;

  nav.innerHTML = PHASES_META.phases
    .filter(p => p.id !== 13) // p13 World masquée — pas encore prête
    .map((p, i) => {
    const sess     = SessionManager.getPhase(p.id);
    const isDone   = sess?.completed ?? false;
    const progress = sess?.data ? Object.keys(sess.data).length > 0 : false;
    const isBlocking = p.blocking ?? false;

    let state = 'empty';
    if (isDone)     state = 'done';
    else if (progress) state = 'progress';

    const icon  = PHASE_ICONS_SVG[p.id] ?? '·';
    const label = PHASE_LABELS_SHORT[p.id] ?? String(p.id);

    return `
      <button class="phase-card ${state}" data-phaseid="${p.id}"
              onclick="TerlabRouter.goto(${p.id})"
              title="Phase ${p.id} — ${p.title}"
              aria-label="Phase ${p.id} : ${p.title}">
        <span class="pc-num">${p.id}</span>
        <div class="pc-icon">${icon}</div>
        <div class="pc-label">${label}</div>
        ${isDone ? '<div class="pc-check">✓</div>' : ''}
        ${isBlocking && !isDone ? '<div class="pc-lock">▲</div>' : ''}
      </button>`;
  }).join('');
}

function updatePhaseNav(activeId) {
  document.querySelectorAll('.phase-card').forEach(btn => {
    const id   = parseInt(btn.dataset.phaseid);
    const sess = SessionManager.getPhase(id);
    btn.classList.remove('active', 'done', 'progress');
    if (id === activeId)      btn.classList.add('active');
    else if (sess?.completed) btn.classList.add('done');
    else if (sess?.data && Object.keys(sess.data).length > 0) btn.classList.add('progress');
  });

  // Démo buttons uniquement visibles en phase 0
  const demoGroup = document.getElementById('demo-group');
  if (demoGroup) demoGroup.style.display = (activeId === 0) ? '' : 'none';

  // Prev/next arrows
  const prevBtn = document.getElementById('phase-prev');
  const nextBtn = document.getElementById('phase-next');
  if (prevBtn) prevBtn.disabled = (activeId <= 0);
  if (nextBtn) nextBtn.disabled = (activeId >= 13);
}

// ═════════════════════════════════════════════════════════════════
// ACTEURS — FIX INJECTION
// Le JSON acteurs.json utilise une structure par phase : acteurs.par_phase.p00 = [...]
// OU une liste plate avec un champ phases: [0, 4]
// On gère les deux structures.
// ═════════════════════════════════════════════════════════════════
function injectActors(phaseId) {
  const zone = document.getElementById('actors-zone');
  if (!zone || !ACTEURS) return;

  let list = [];

  // Structure 1 : acteurs.par_phase.p00 = [...]
  const phaseKey = `p${String(phaseId).padStart(2,'0')}`;
  if (ACTEURS.par_phase?.[phaseKey]) {
    list = ACTEURS.par_phase[phaseKey];
  }
  // Structure 2 : acteurs.acteurs = [...] avec acteur.phases = [0, 4, ...]
  else if (Array.isArray(ACTEURS.acteurs)) {
    list = ACTEURS.acteurs.filter(a =>
      (a.phases ?? []).includes(phaseId) ||
      (a.phase === phaseId)
    );
  }
  // Structure 3 : acteurs.acteurs.p00 = [...]
  else if (ACTEURS.acteurs?.[phaseKey]) {
    list = ACTEURS.acteurs[phaseKey];
  }
  // Fallback : tous les acteurs
  else if (Array.isArray(ACTEURS)) {
    list = ACTEURS.filter(a => (a.phases ?? []).includes(phaseId));
  }

  if (!list.length) {
    // Essai avec acteurs multi-phases non filtrés (acteurs globaux)
    const globals = ACTEURS.acteurs_globaux ?? ACTEURS.global ?? [];
    if (globals.length) list = globals;
  }

  if (!list.length) {
    zone.innerHTML = '<p class="rp-empty" style="font-size:10px;color:var(--faint);padding:8px;font-style:italic">Aucun acteur référencé pour cette phase. Consulter le README acteurs.</p>';
    return;
  }

  zone.innerHTML = list.slice(0, 6).map(a => buildActorCard(a)).join('');
}

function buildActorCard(a) {
  if (!a?.nom) return '';
  return `
    <div class="actor-card" onclick="TerlabActors.openModal('${a.id ?? ''}')"
         role="button" tabindex="0" aria-label="Voir ${a.nom}">
      <div class="actor-icon">${a.icon ?? '🏢'}</div>
      <div class="actor-body">
        ${a.type ? `<div class="actor-badge ${a.type}">${a.type}</div>` : ''}
        <div class="actor-name">${a.nom}</div>
        <div class="actor-role">${a.role ?? ''}</div>
        ${a.url ? `<span class="actor-link">${a.url.replace('https://','')}</span>` : ''}
        ${a.conseil ? `<div class="actor-conseil">${a.conseil}</div>` : ''}
      </div>
    </div>`;
}

function injectRisks(phaseId) {
  const zone = document.getElementById('risks-zone');
  if (!zone || !RISQUES) return;

  const risques = Array.isArray(RISQUES) ? RISQUES :
                  Array.isArray(RISQUES.risques) ? RISQUES.risques : [];
  const list = risques.filter(r => r.phase === phaseId || r.phase === String(phaseId));

  if (!list.length) { zone.innerHTML = ''; return; }

  zone.innerHTML = list.map(r => `
    <div class="risk-card" data-level="${r.niveau ?? 'info'}" data-risk-id="${r.id}">
      <div class="risk-label">${levelLabel(r.niveau)} ${r.titre}</div>
      <div class="risk-text">${r.corps ?? ''}</div>
      ${r.action ? `<div class="risk-text" style="margin-top:5px;color:var(--text2)">→ ${r.action}</div>` : ''}
    </div>`).join('');
}

function levelLabel(n) {
  return { warning:'⚠', danger:'🔴', info:'ℹ', bigdata:'🔒' }[n] ?? '·';
}

// ═════════════════════════════════════════════════════════════════
// HYDRATATION + SAVE — FIX SESSION TERRAIN
// ═════════════════════════════════════════════════════════════════
function hydrate(phaseId) {
  const phaseData = SessionManager.getPhase(phaseId)?.data ?? {};
  const terrain   = SessionManager.getTerrain() ?? {};

  // Remplir tous les champs [data-session-key]
  document.querySelectorAll('[data-session-key]').forEach(el => {
    const key = el.dataset.sessionKey;
    // Chercher d'abord dans phaseData, puis dans terrain
    const val = phaseData[key] ?? terrain[key];
    if (val == null) return;

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.value = val;
    } else if (el.tagName === 'SELECT') {
      el.value = val;
      // Déclencher onchange si défini
      if (el.onchange && val) el.onchange();
    } else {
      el.textContent = val;
    }
  });

  // Restaurer radios (type_structure, type_toiture)
  document.querySelectorAll('input[type="radio"]').forEach(radio => {
    const key = radio.closest('[data-session-key]')?.dataset.sessionKey
             ?? (radio.name === 'struct' ? 'type_structure' : radio.name === 'toit' ? 'type_toiture' : null);
    if (!key) return;
    const val = phaseData[key];
    if (val && radio.value === val) {
      radio.checked = true;
      const label = radio.closest('.radio-option');
      if (label) label.classList.add('selected');
    }
  });

  // Restaurer checkboxes
  const validations = SessionManager.getPhase(phaseId)?.validations ?? [];
  document.querySelectorAll('.check-item').forEach((item, idx) => {
    if (validations[idx]) {
      item.classList.add('checked');
      item.setAttribute('aria-checked', 'true');
      const checkSvgs = item.querySelectorAll('.check-svg');
      checkSvgs.forEach(svg => svg.style.display = 'block');
    }
  });

  updateValidationProgress(phaseId);

  // Déclencher update() si le module de phase expose cette méthode (ex: P07.update)
  if (phaseId === 7 && typeof window.P07?.update === 'function') {
    requestAnimationFrame(() => window.P07.update());
  }
}

function attachValidationEvents(phaseId) {
  // Checkboxes
  document.querySelectorAll('.check-item').forEach((item) => {
    item.addEventListener('click', () => {
      if (item.classList.contains('auto-checked')) return; // verrouillé par auto-validation
      const wasChecked = item.classList.contains('checked');
      item.classList.toggle('checked', !wasChecked);
      item.setAttribute('aria-checked', String(!wasChecked));
      const checkSvgs = item.querySelectorAll('.check-svg');
      checkSvgs.forEach(svg => svg.style.display = !wasChecked ? 'block' : 'none');
      saveFieldsToSession(phaseId);
      updateValidationProgress(phaseId);
    });
    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.click(); }
    });
  });

  // Auto-validation : lier les champs [data-val-index] aux check-items
  attachAutoValidation(phaseId);

  // Écouter l'événement custom de validation auto (déclenché par les modules de phase)
  document.addEventListener('terlab:val-changed', () => {
    saveFieldsToSession(phaseId);
    updateValidationProgress(phaseId);
  });

  // Champs formulaire — debounce auto-save
  const TERRAIN_KEYS = new Set([
    'commune','code_insee','section','parcelle','lat','lng',
    'altitude_ngr','contenance_m2','intercommunalite','adresse',
    'zone_pprn','cote_reference_ngr','zone_rtaa','zone_plu',
    'pente_moy_pct','nom_ravine','distance_ravine_m',
    'orientation_terrain','zone_pluvio','station_meteo'
  ]);

  document.querySelectorAll('[data-session-key]').forEach(el => {
    const key = el.dataset.sessionKey;
    const save = debounce(() => {
      saveFieldsToSession(phaseId);
      // Si clé terrain → aussi sauvegarder dans terrain
      if (TERRAIN_KEYS.has(key)) {
        const val = el.value ?? el.textContent;
        if (val) SessionManager.saveTerrain({ [key]: val });
      }
    }, 600);
    el.addEventListener('input',  save);
    el.addEventListener('change', save);
  });

  // Bouton suivant
  const nextBtn = document.querySelector('.next-btn');
  if (nextBtn && !nextBtn.dataset.bound) {
    nextBtn.dataset.bound = '1';
    nextBtn.addEventListener('click', () => {
      const targetId = phaseId + 1;
      if (targetId <= 13) Router.goto(targetId);
    });
  }
}

// ═════════════════════════════════════════════════════════════════
// AUTO-VALIDATION — lie les champs aux check-items via data-val-index
// ═════════════════════════════════════════════════════════════════
function attachAutoValidation(phaseId) {
  const checkItems = document.querySelectorAll('.check-item');
  if (!checkItems.length) return;

  // Selects avec data-val-index
  document.querySelectorAll('select[data-val-index]').forEach(sel => {
    const idx = parseInt(sel.dataset.valIndex, 10);
    const check = checkItems[idx];
    if (!check) return;

    const handler = () => {
      const hasValue = sel.value && sel.value !== '';
      if (hasValue) {
        sel.classList.add('answered');
        autoCheckItem(check, phaseId);
      } else {
        sel.classList.remove('answered');
        autoUncheckItem(check, phaseId);
      }
    };
    sel.addEventListener('change', handler);
    // état initial
    if (sel.value && sel.value !== '') handler();
  });

  // Radio-groups avec data-val-index
  document.querySelectorAll('.radio-group[data-val-index]').forEach(group => {
    const idx = parseInt(group.dataset.valIndex, 10);
    const check = checkItems[idx];
    if (!check) return;

    const radios = group.querySelectorAll('input[type="radio"]');
    const handler = () => {
      const anyChecked = Array.from(radios).some(r => r.checked);
      if (anyChecked) {
        group.classList.add('answered');
        autoCheckItem(check, phaseId);
      }
    };
    radios.forEach(r => r.addEventListener('change', handler));
    // écouter aussi les clics sur radio-option (pour les sélections via onclick)
    group.querySelectorAll('.radio-option').forEach(opt => {
      const observer = new MutationObserver(() => {
        if (opt.classList.contains('selected')) handler();
      });
      observer.observe(opt, { attributes: true, attributeFilter: ['class'] });
    });
    // état initial
    if (Array.from(radios).some(r => r.checked)) handler();
  });

  // Checkboxes (groupes) avec data-val-index
  document.querySelectorAll('.checkbox-group[data-val-index]').forEach(group => {
    const idx = parseInt(group.dataset.valIndex, 10);
    const check = checkItems[idx];
    if (!check) return;

    const boxes = group.querySelectorAll('input[type="checkbox"]');
    const handler = () => {
      if (Array.from(boxes).some(b => b.checked)) {
        autoCheckItem(check, phaseId);
      }
    };
    boxes.forEach(b => b.addEventListener('change', handler));
  });
}

function autoCheckItem(item, phaseId) {
  if (item.classList.contains('checked')) return;
  item.classList.add('checked', 'auto-checked');
  item.setAttribute('aria-checked', 'true');
  saveFieldsToSession(phaseId);
  updateValidationProgress(phaseId);
}

function autoUncheckItem(item, phaseId) {
  if (!item.classList.contains('auto-checked')) return;
  item.classList.remove('checked', 'auto-checked');
  item.setAttribute('aria-checked', 'false');
  saveFieldsToSession(phaseId);
  updateValidationProgress(phaseId);
}

function saveFieldsToSession(phaseId) {
  const data   = {};
  const checks = [];

  document.querySelectorAll('[data-session-key]').forEach(el => {
    const key = el.dataset.sessionKey;
    // Prioriser les inputs/selects : si la clé est déjà renseignée par un
    // input/select, ne pas laisser un span d'affichage l'écraser
    const isFormField = el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA';
    const val = isFormField ? el.value : el.textContent?.trim();
    if (!val || val === '—' || val === '-') return;
    // Ne pas écraser une valeur form par un span d'affichage
    if (!isFormField && data[key]) return;
    data[key] = val;
  });

  document.querySelectorAll('.check-item').forEach(item => {
    checks.push(item.classList.contains('checked'));
  });

  const blockingItems = document.querySelectorAll('.check-item.blocking');
  const allBlocking   = blockingItems.length === 0 ||
    Array.from(blockingItems).every(el => el.classList.contains('checked'));

  SessionManager.savePhase(phaseId, data, checks, allBlocking);

  // Phase 0 : propager les champs terrain explicitement
  if (phaseId === 0) {
    const terrainFields = ['commune','code_insee','section','parcelle',
      'lat','lng','altitude_ngr','contenance_m2','intercommunalite','adresse'];
    const terrainUpdate = {};
    terrainFields.forEach(k => { if (data[k]) terrainUpdate[k] = data[k]; });
    if (Object.keys(terrainUpdate).length) SessionManager.saveTerrain(terrainUpdate);
    updateTerrainStrips();
    updateToplevelScore();
  }

  updatePhaseNav(phaseId);
  updateToplevelScore();
}

function updateValidationProgress(phaseId) {
  const items     = document.querySelectorAll('.check-item');
  const checked   = document.querySelectorAll('.check-item.checked').length;
  const total     = items.length;
  if (!total) return;
  const pct         = Math.round(checked / total * 100);
  const allBlocking = Array.from(document.querySelectorAll('.check-item.blocking'))
    .every(el => el.classList.contains('checked'));

  const bar     = document.querySelector('.val-bar');
  const pctEl   = document.querySelector('.val-pct');
  const nextBtn = document.querySelector('.next-btn');

  if (bar)   bar.style.width = pct + '%';
  if (pctEl) pctEl.textContent = `${checked}/${total}`;

  if (nextBtn) {
    const meta    = PHASES_META?.phases?.[phaseId];
    const canNext = meta?.blocking ? allBlocking : checked >= Math.ceil(total * 0.5);
    nextBtn.classList.toggle('enabled', canNext || !meta?.blocking);
    if (!nextBtn.classList.contains('enabled')) {
      nextBtn.classList.add('enabled'); // Toujours navigable
    }
  }
}

// Met à jour tous les terrain-strips des phases
function updateTerrainStrips() {
  const terrain = SessionManager.getTerrain();
  if (!terrain.commune) return;
  const mappings = {
    'ts-commune':     terrain.commune,
    'ts-commune-p2':  terrain.commune,
    'ts-commune-p3':  terrain.commune,
    'ts-commune-p4':  terrain.commune,
    'ts-commune-p6':  terrain.commune,
    'ts-c-p5':        terrain.commune,
    'ts-c-p9':        terrain.commune,
    'ts-alt':         terrain.altitude_ngr ? `${terrain.altitude_ngr} m` : null,
    'ts-alt-p2':      terrain.altitude_ngr ? `${terrain.altitude_ngr}` : null,
    'ts-interco-p4':  terrain.intercommunalite,
    'ts-zone-plu':    terrain.zone_plu?.split(' ')[0],
    'ts-zone-pprn':   terrain.zone_pprn,
    'ts-contenance':  terrain.contenance_m2 ? `${terrain.contenance_m2} m²` : null,
    'ts-parc':        terrain.parc_national,
    'ts-sp-p9':       terrain.contenance_m2 ? `${terrain.contenance_m2} m²` : null,
  };
  for (const [id, val] of Object.entries(mappings)) {
    if (!val) continue;
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
}

// ═════════════════════════════════════════════════════════════════
// DÉMOS
// ═════════════════════════════════════════════════════════════════
function initDemoBtns() {
  document.querySelectorAll('.demo-chip').forEach(btn => {
    btn.addEventListener('click', async () => {
      const demo = btn.dataset.demo;
      document.querySelectorAll('.demo-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      await DemoLoader.load(demo);
      await loadPhase(Router.currentPhase);
      Toast.show(`Scénario "${demo}" chargé`, 'info');
    });
  });
}

// ═════════════════════════════════════════════════════════════════
// ACTOR MODAL
// ═════════════════════════════════════════════════════════════════
const ActorCard = {
  openModal(actorId) {
    if (!actorId) return;

    // Chercher l'acteur dans toutes les structures possibles
    let actor = null;
    if (Array.isArray(ACTEURS?.acteurs)) {
      actor = ACTEURS.acteurs.find(a => a.id === actorId);
    }
    if (!actor && ACTEURS?.par_phase) {
      for (const list of Object.values(ACTEURS.par_phase)) {
        if (Array.isArray(list)) { actor = list.find(a => a.id === actorId); if (actor) break; }
      }
    }
    if (!actor) return;

    document.getElementById('modal-actor-title').textContent = actor.nom;
    const body = document.getElementById('modal-actor-body');
    body.innerHTML = `
      ${actor.type ? `<div class="actor-badge ${actor.type}" style="margin-bottom:8px">${actor.type}</div>` : ''}
      <p class="modal-text">${actor.role ?? ''}</p>
      ${actor.conseil ? `<div class="ped-note" style="margin-bottom:10px"><strong>💡 Conseil</strong> — ${actor.conseil}</div>` : ''}
      ${actor.ressources?.length ? `
        <div class="fs-head" style="margin-top:10px">Ressources</div>
        ${actor.ressources.map(r => `<a href="${r.url}" target="_blank" rel="noopener" class="source-btn" style="display:flex;gap:5px;margin-bottom:5px">→ ${r.titre}</a>`).join('')}
      ` : ''}
      ${actor.contact ? `<div class="field-note" style="margin-top:10px">Contact : ${actor.contact}</div>` : ''}
    `;

    const urlBtn = document.getElementById('actor-modal-btn-url');
    if (urlBtn && actor.url) {
      urlBtn.onclick = () => window.open(actor.url, '_blank', 'noopener');
      urlBtn.textContent = `Ouvrir ${actor.nom} →`;
    }
    document.getElementById('modal-actor').hidden = false;
  },
  closeModal() {
    document.getElementById('modal-actor').hidden = true;
  }
};

// ═════════════════════════════════════════════════════════════════
// SIDEBAR
// ═════════════════════════════════════════════════════════════════
const Sidebar = {
  activate(tool) {
    document.querySelectorAll('.sb-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`sb-${tool}`);
    if (btn) btn.classList.add('active');
  }
};

// ═════════════════════════════════════════════════════════════════
// TOASTS
// ═════════════════════════════════════════════════════════════════
const Toast = {
  show(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, duration);
  }
};

// ═════════════════════════════════════════════════════════════════
// SCORE TOPBAR
// ═════════════════════════════════════════════════════════════════
function updateToplevelScore() {
  const scoreBar = document.getElementById('terlab-score-bar');
  if (!scoreBar) return;

  const score  = TerlabScoreService.compute(SessionManager._data);
  const alerts = CoherenceService.checkAll(SessionManager._data);
  const t      = SessionManager.getTerrain();
  const loc    = t?.commune ? `${t.commune} ${t.parcelle ?? ''}`.trim() : 'Aucune parcelle';
  const col    = TerlabScoreService.getColor(score.total);
  const barW   = Math.round(score.total);

  scoreBar.innerHTML = `
    <span class="tsb-loc">${loc}</span>
    <div class="tsb-progress">
      <div class="tsb-bar" style="width:${barW}%;background:${col}"></div>
    </div>
    <span class="tsb-pct" style="color:${col}">${barW}%</span>
    ${alerts.length ? `<span class="tsb-alerts" onclick="CoherenceService.showPanel()" title="Voir les incohérences détectées">⚠ ${alerts.length} alerte${alerts.length > 1 ? 's' : ''}</span>` : ''}
  `;
}

// ═════════════════════════════════════════════════════════════════
// FALLBACK PHASE
// ═════════════════════════════════════════════════════════════════
function buildFallbackPhase(id, meta, errorMsg) {
  return `
  <div class="left-panel">
    <div class="lp-head">
      <div class="phase-label">Phase ${id} · En développement</div>
      <h1 class="phase-title">${meta.icon ?? '·'} <em>${meta.title ?? 'Phase'}</em></h1>
      <p class="phase-desc">${meta.subtitle ?? ''}</p>
    </div>
    <div class="form-section">
      <div class="stub-warning">⚠️ Phase en cours — Fichier : phases/p${String(id).padStart(2,'0')}-${meta.slug}.html<br/>Erreur : ${errorMsg}</div>
    </div>
  </div>
  <div class="map-area"><div id="map" style="width:100%;height:100%"></div></div>
  <div class="right-panel">
    <div class="rp-section"><div class="rp-head">Acteurs</div><div id="actors-zone"></div></div>
    <div class="rp-section"><div class="rp-head">Risques</div><div id="risks-zone"></div></div>
  </div>`;
}

// ═════════════════════════════════════════════════════════════════
// SPLASH
// ═════════════════════════════════════════════════════════════════
function setSplash(msg, pct) {
  const bar    = document.getElementById('splash-bar');
  const status = document.getElementById('splash-status');
  if (bar)    bar.style.width = pct + '%';
  if (status) status.textContent = msg;
}
function hideSplash() {
  const splash = document.getElementById('splash');
  if (splash) {
    splash.classList.add('hidden');
    setTimeout(() => splash.remove?.(), 400);
  }
}
function showTokenModal() {
  const modal = document.getElementById('modal-token');
  if (modal) modal.hidden = false;
}
function updateSessionBadge() {
  const el = document.getElementById('session-id-display');
  if (el) el.textContent = AppState.sessionId?.slice(-8) ?? '—';
}

// ═════════════════════════════════════════════════════════════════
// UTILITAIRES
// ═════════════════════════════════════════════════════════════════
function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

// ═════════════════════════════════════════════════════════════════
// DÉMARRAGE
// ═════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', init);

export { Router, Toast, ActorCard, Sidebar };
