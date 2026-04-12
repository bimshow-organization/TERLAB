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
import SunState          from './services/sun-state.js';
import TerrainSVG        from './services/terrain-svg-service.js';
import LidarService        from './services/lidar-service.js';
import LidarContextService from './services/lidar-context-service.js';
import EnvelopeGenerator   from './services/envelope-generator.js';
import PlanMasseEngine   from './services/plan-masse-engine.js';
import TerrainProfile    from './services/terrain-profile.js';
import SectionProfileViewer from './components/section-profile-viewer.js';
import ParetoScorer      from './services/pareto-scorer.js';
import ViewDetector      from './services/view-detector.js';
import BpfGardenAdvisor  from './services/bpf-garden-advisor.js';
import ContourService         from './services/contour-service.js';
import ContourCache           from './services/contour-cache.js';
import PrecipitationService   from './services/precipitation-service.js';
import SCOTService            from './services/scot-service.js';
import ParcelAltitudes        from './services/parcel-altitudes.js';
import BpfBridge              from './services/bpf-bridge.js';
import FootprintHelpers       from './services/footprint-helpers.js';
import GeoUtils               from './services/geo-utils.js';
import AutoPlanStrategies     from './services/auto-plan-strategies.js';
import AutoPlanEngine         from './services/auto-plan-engine.js';
import ExistingBuildings      from './services/existing-buildings.js';
import CapacityStudyRenderer  from './services/capacity-study-renderer.js';
import EarthworksService      from './services/earthworks-service.js';
import EarthworksMeshBuilder  from './services/earthworks-mesh-builder.js';
import TerrainMeshBuilder    from './services/terrain-mesh-builder.js';
import SdisChecker            from './services/sdis-checker.js';
import RTAAAnalyzer           from './services/rtaa-analyzer.js';
import UrbanismeAutorisations from './services/urbanisme-autorisations.js';
import CelluleGenerator       from './services/cellule-generator.js';
import RTAAValidator          from './services/rtaa-validator.js';

// ─── Module aéraulique (Sprints 1-4) ────────────────────────
import ParcelSelector     from './components/parcel-selector.js';
import BILTerrain         from './services/bil-terrain.js';
import BackgroundTerrain  from './services/background-terrain.js';
import AeraulicSection    from './components/aeraulic-section.js';
import AeraulicMapTools   from './components/aeraulic-map-tools.js';
import WindNavigator      from './components/wind-navigator.js';
import AeraulicPlanner    from './components/aeraulic-planner.js';
import RtaaVentilationSim from './components/rtaa-ventilation-sim.js';
import AtlasModal         from './components/atlas-modal.js';
import * as MatUtils      from './utils/terlab-mat-utils.js';

// ─── Utilitaires réseau ─────────────────────────────────────
import resilientFetch, { resilientJSON, resilientFetchFirst } from './utils/resilient-fetch.js';

// ─── Export 3D centralisé ────────────────────────────────────
import GLBExporter       from './utils/glb-exporter.js';

// ─── Mini-viewer 3D intégré (remplace popup BIMSHOW) ────────
import BimshowViewer     from './components/bimshow-viewer.js';

// ─── Mobile responsive controller ───────────────────────────
import MobileController  from './components/mobile-controller.js';

// ─── Éditeur GeoJSON 3 niveaux (GPU + import + dessin) ──────
import CoordConverter        from './utils/coord-converter.js';
import UTM40S               from './utils/utm40s.js';
import GPUFetcher            from './services/gpu-fetcher.js';
import GeoJsonLayerService   from './services/geojson-layer-service.js';
import GeoJsonPanel          from './components/geojson-panel.js';

// ─── Data Providers Réunion (Sprint intégration 2026-04) ────
import BdTopoService         from './services/bdtopo-service.js';
import CadastreContextService from './services/cadastre-context-service.js';
import EdfService            from './services/edf-service.js';
import GpuService            from './services/gpu-service.js';
import BiodiversiteService   from './services/biodiversite-service.js';
import IsochroneService      from './services/isochrone-service.js';
import PoiService             from './services/poi-service.js';
import BuildingAgeService     from './services/building-age-service.js';

// ─── Export Site 3D (DXF/IFC ArchiCAD) ──────────────────────
import SiteCaptureService    from './services/site-capture-service.js';
import DXFWorker             from './workers/dxf-worker.js';
import IFCExporter           from './workers/ifc-worker.js';

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

    // État solaire partagé (après SessionManager)
    SunState.init();

    // Activer l'auto-save multi-sessions
    TerlabStorage.attachAutoSave();

    updateSessionBadge();

    setSplash('Token Mapbox…', 50);
    // Token public Mapbox (pk.* = client-side, non secret)
    const _pk = ['pk.eyJ1IjoiYmltc2hvdyIsImEiOi', 'JjbW5yYm55bmkwMGxqMnJxdjU5YXNwcTRrIn0', '.yyUHXQXrvsD2wfSzxP0P0A'];
    const defaultToken = _pk.join('');
    // Purger les anciens tokens invalides du localStorage
    const stored = localStorage.getItem('terlab_mapbox_token');
    if (stored && stored !== defaultToken) localStorage.removeItem('terlab_mapbox_token');
    AppState.mapboxToken = localStorage.getItem('terlab_mapbox_custom') || defaultToken;

    // Namespace TERLAB — évite les collisions avec BIMSHOW globals
    window.TERLAB = window.TERLAB ?? {};

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

    // Aliases namespace (nouveau standard — utiliser window.TERLAB.* dans le nouveau code)
    window.TERLAB.Session = SessionManager;
    window.TERLAB.Map     = MapViewer;
    window.TERLAB.Toast   = Toast;
    window.TERLAB.Export  = ExportEngine;
    window.TERLAB.Sources = SourceModal;
    window.TERLAB.Router  = Router;
    window.TERLAB.Mobile  = MobileController;
    window.MobileController = MobileController;

    // Utilitaires réseau (disponibles dans les scripts inline des phases)
    window.resilientFetch     = resilientFetch;
    window.resilientJSON      = resilientJSON;
    window.resilientFetchFirst = resilientFetchFirst;

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
    window.SunState          = SunState;
    window.TerrainSVG        = TerrainSVG;
    window.LidarService        = LidarService;
    window.LidarContextService = LidarContextService;
    window.EnvelopeGenerator   = EnvelopeGenerator;
    window.PlanMasseEngine   = PlanMasseEngine;
    window.TerrainProfile    = TerrainProfile;
    window.SectionProfileViewer = SectionProfileViewer;
    window.ParetoScorer      = ParetoScorer;
    window.ViewDetector      = ViewDetector;
    window.BpfGardenAdvisor  = BpfGardenAdvisor;
    window.ContourService         = ContourService;
    window.ContourCache           = ContourCache;
    window.ParcelAltitudes        = ParcelAltitudes;
    window.PrecipitationService   = PrecipitationService;
    window.SCOTService            = SCOTService;
    window.BpfBridge              = BpfBridge;
    window.FootprintHelpers       = FootprintHelpers;
    window.GeoUtils               = GeoUtils;
    window.AutoPlanStrategies     = AutoPlanStrategies;
    window.AutoPlanEngine         = AutoPlanEngine;
    window.ExistingBuildings      = ExistingBuildings;
    window.CapacityStudyRenderer  = CapacityStudyRenderer;
    window.EarthworksService      = EarthworksService;
    window.EarthworksMeshBuilder  = EarthworksMeshBuilder;
    window.TerrainMeshBuilder    = TerrainMeshBuilder;
    window.SdisChecker            = SdisChecker;
    window.RTAAAnalyzer           = RTAAAnalyzer;
    window.UrbanismeAutorisations = UrbanismeAutorisations;
    window.CelluleGenerator       = CelluleGenerator;
    window.RTAAValidator          = RTAAValidator;

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
    window.AtlasModal         = AtlasModal;

    // GeoJSON editor (3 niveaux) + projection UTM + export 3D
    window.CoordConverter      = CoordConverter;
    window.UTM40S              = UTM40S;
    window.GLBExporter         = GLBExporter;
    window.GPUFetcher          = GPUFetcher;
    window.GeoJsonLayerService = GeoJsonLayerService;
    window.GeoJsonPanel        = GeoJsonPanel;

    // Data Providers Réunion
    window.BdTopoService        = BdTopoService;
    window.CadastreContextService = CadastreContextService;
    window.EdfService           = EdfService;
    window.GpuService           = GpuService;
    window.BiodiversiteService  = BiodiversiteService;
    window.IsochroneService     = IsochroneService;
    window.PoiService           = PoiService;
    window.BuildingAgeService   = BuildingAgeService;

    // Export Site 3D (DXF + IFC ArchiCAD)
    window.SiteCaptureService   = SiteCaptureService;
    window.DXFWorker            = DXFWorker;
    window.IFCExporter          = IFCExporter;

    // Charger sources-providers.json (non-bloquant)
    fetch('data/sources-providers.json')
      .then(r => r.json())
      .then(d => {
        window.TERLAB_PROVIDERS = d.acteurs_data_providers;
        window.TERLAB.Providers = d.acteurs_data_providers;
      })
      .catch(() => console.warn('[TERLAB] sources-providers.json non chargé'));

    // Charger aeraulique-meta.json (non-bloquant)
    fetch('data/aeraulique-meta.json')
      .then(r => r.json())
      .then(d => { window.TERLAB_AERAULIQUE = d; })
      .catch(() => console.warn('[TERLAB] aeraulique-meta.json non chargé'));

    setSplash('Navigation…', 65);
    buildPhaseNav();
    initDemoBtns();

    // Afficher le player si le terrain est déjà confirmé
    const terrain = SessionManager.getTerrain();
    if (terrain?.terrain_confirmed) {
      const player = document.getElementById('phase-player');
      if (player) player.style.display = '';
    }

    setSplash('Chargement phase…', 80);
    await route();

    // Topbar — afficher le terrain si déjà chargé
    updateTerrainStrips();

    // Init mobile controller (après DOM prêt + première phase chargée)
    MobileController.init();

    // Init GeoJSON layer system
    GeoJsonLayerService.restore();
    const gjpContainer = document.getElementById('gjp-container');
    if (gjpContainer) GeoJsonPanel.init(gjpContainer);

    setSplash('Prêt.', 100);
    setTimeout(hideSplash, 350);

    // Score topbar — mise à jour initiale + sur chaque changement
    updateToplevelScore();
    window.addEventListener('terlab:session-changed', updateToplevelScore);

    // Project menu dropdown (btn-login)
    ProjectMenu.init();

    window.addEventListener('hashchange', route);
    window.addEventListener('message', BIMSHOWBridge.handleMessage.bind(BIMSHOWBridge));
    window.addEventListener('terlab:terrain-confirmed', () => {
      const player = document.getElementById('phase-player');
      if (player) player.style.display = '';
    });
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
    localStorage.setItem('terlab_mapbox_custom', token);
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
  if (window.TERLAB) window.TERLAB.currentPhaseId = phaseId;

  await loadPhase(phaseId);
  AppState.loading = false;

  // Marquer la phase comme "vue" (sauf phase 0, toujours obligatoire)
  if (phaseId > 0) {
    const sess = SessionManager.getPhase(phaseId);
    if (!sess?.visitedAt) {
      const prev = sess?.data ?? {};
      SessionManager.savePhase(phaseId, { ...prev, visitedAt: new Date().toISOString() }, sess?.validations, sess?.completed ?? false);
    }
  }
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

  // ═════════════════════════════════════════════════════
  // Extraire les scripts du HTML brut via regex AVANT innerHTML
  // (innerHTML peut corrompre le textContent des scripts inline)
  // ═════════════════════════════════════════════════════
  const rawScripts = [];
  const htmlClean = html.replace(/<script([^>]*)>([\s\S]*?)<\/script>/gi, (_, attrs, body) => {
    const srcMatch = attrs.match(/src=["']([^"']+)["']/);
    const typeMatch = attrs.match(/type=["']([^"']+)["']/);
    rawScripts.push({
      src: srcMatch ? srcMatch[1] : null,
      type: typeMatch ? typeMatch[1] : null,
      body: body
    });
    return ''; // Retirer le script du HTML
  });

  // Injecter le HTML nettoyé
  container.innerHTML = htmlClean;
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
  // Réexécuter les scripts extraits du HTML brut
  // Les erreurs de chargement sont rapportées mais NON fatales
  // (l'init globale ne doit pas mourir parce qu'un script de phase échoue)
  // ═════════════════════════════════════════════════════
  for (const info of rawScripts) {
    const newScript = document.createElement('script');

    if (info.src) {
      // Script externe
      newScript.src = info.src;
      if (info.type) newScript.type = info.type;
      try {
        await new Promise((res, rej) => {
          newScript.onload = res;
          newScript.onerror = () => rej(new Error(`script load failed: ${info.src}`));
          document.head.appendChild(newScript);
        });
      } catch (e) {
        console.warn('[loadPhase] script externe échoué :', e.message);
      }
    } else {
      // Script inline → Blob URL pour exécution fiable + await
      // Réécrire les imports relatifs ../xxx en chemins absolus (Blob URLs n'ont pas de base hiérarchique)
      const baseUrl = new URL('.', window.location.href).href;
      let code = info.body
        .replace(/from\s+['"]\.\.\/(.*?)['"]/g, `from '${baseUrl}$1'`)
        .replace(/import\(\s*['"]\.\.\/(.*?)['"]\s*\)/g, `import('${baseUrl}$1')`);
      const blob = new Blob([code], { type: 'text/javascript' });
      newScript.type = info.type || 'text/javascript';
      newScript.src = URL.createObjectURL(blob);
      try {
        await new Promise((res, rej) => {
          newScript.onload = res;
          newScript.onerror = () => rej(new Error(`inline script load failed (phase ${id})`));
          document.head.appendChild(newScript);
        });
      } catch (e) {
        console.warn('[loadPhase] script inline échoué :', e.message);
      }
      URL.revokeObjectURL(newScript.src);
    }
  }

  // 4. Carte (skip si map_mode === 'none' ou pas de div #map)
  if (AppState.mapboxToken && meta.map_mode !== 'none' && document.getElementById('map')) {
    try {
      const terrain = SessionManager.getTerrain();
      const hasTerrain = terrain?.lat && terrain?.lng;

      // Phase 0 sans terrain → vue île entière (zoom 10) pour inviter l'utilisateur à naviguer
      const targetZoom = meta.map_zoom_default ?? 15;
      const targetPitch = meta.map_pitch ?? 0;
      const targetBearing = meta.map_bearing ?? 0;

      // Si terrain connu et phase > 0 : démarrer à la verticale du projet (pitch 0, zoom reculé)
      // puis animer vers le zoom/pitch/bearing cible de la phase
      const startAboveProject = hasTerrain && id > 0;
      const initCenter = startAboveProject ? [parseFloat(terrain.lng), parseFloat(terrain.lat)] : undefined;
      const initZoom   = (id === 0 && !hasTerrain) ? 10 : (startAboveProject ? Math.max(targetZoom - 3, 10) : targetZoom);
      const initPitch  = startAboveProject ? 0 : targetPitch;

      await MapViewer.init({
        containerId: 'map',
        token:       AppState.mapboxToken,
        mode:        meta.map_mode,
        pitch:       initPitch,
        bearing:     0,
        zoom:        initZoom,
        center:      initCenter
      });
      // Init ParcelSelector dès que la carte est prête
      const _map = MapViewer.getMap();
      if (_map) ParcelSelector.init(_map);

      // Overlay d'instruction pour P00 nouveau projet
      const mapHint = document.getElementById('map-hint-overlay');
      if (mapHint) mapHint.style.display = hasTerrain ? 'none' : 'flex';

      if (hasTerrain) {
        // Attendre que la carte soit idle pour que le flyTo fonctionne correctement
        const _doFly = () => {
          _showTerrainOnMap(terrain);

          if (startAboveProject) {
            // Animation : plonger depuis la verticale vers la vue cible de la phase
            const lng = parseFloat(terrain.lng);
            const lat = parseFloat(terrain.lat);
            _map.flyTo({
              center:   [lng, lat],
              zoom:     targetZoom,
              pitch:    targetPitch,
              bearing:  targetBearing,
              duration: 2000,
              essential: true
            });
          } else if (terrain.parcelle_geojson) {
            // Phase 0 avec terrain : fitBounds classique
            try {
              const bbox = turf.bbox({ type: 'Feature', geometry: terrain.parcelle_geojson });
              _map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 80, duration: 1200 });
            } catch {
              MapViewer.flyTo(parseFloat(terrain.lng), parseFloat(terrain.lat), targetZoom);
            }
          } else {
            MapViewer.flyTo(parseFloat(terrain.lng), parseFloat(terrain.lat), targetZoom);
          }
        };
        if (_map.isStyleLoaded()) { setTimeout(_doFly, 300); }
        else { _map.once('idle', _doFly); }
      }
    } catch (e) {
      console.warn('[Map] Init failed:', e.message);
    }
  }

  // 5. Hydratation champs depuis session
  hydrate(id);

  // 6. MAJ nav
  updatePhaseNav(id);

  // 6b. Notifier le mobile controller
  MobileController.onPhaseInjected(id, meta.title ?? '');

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
const PHASE_LABELS_SHORT = ['IDENT','TOPO','GEO','HYDRO','PLU','VOIS','BIO','ESQ','CHANT','CO2','DURA','FDV','SYNTH','WORLD'];

function buildPhaseNav() {
  const nav = document.getElementById('tb-phases');
  if (!nav || !PHASES_META) return;

  nav.innerHTML = PHASES_META.phases
    .filter(p => p.id !== 13 && p.active !== false) // p13 World masquée, p11 fusionnée en P10
    .map((p, i) => {
    const sess     = SessionManager.getPhase(p.id);
    const isDone   = sess?.completed ?? false;
    const progress = sess?.data ? Object.keys(sess.data).length > 0 : false;
    const isBlocking = p.blocking ?? false;
    const isVisited = !!(sess?.data?.visitedAt);

    let state = 'empty';
    if (isDone)     state = 'done';
    else if (progress) state = 'progress';

    const icon  = PHASE_ICONS_SVG[p.id] ?? '·';
    const label = PHASE_LABELS_SHORT[p.id] ?? String(p.id);

    return `
      <button class="phase-card ${state}${isVisited ? ' visited' : ''}" data-phaseid="${p.id}"
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
    btn.classList.remove('active', 'done', 'progress', 'visited');
    if (id === activeId)      btn.classList.add('active');
    else if (sess?.completed) btn.classList.add('done');
    else if (sess?.data && Object.keys(sess.data).length > 0) btn.classList.add('progress');
    // Marqueur "déjà vu" (phase 0 exclue — toujours obligatoire)
    if (id > 0 && sess?.data?.visitedAt) btn.classList.add('visited');
  });

  // Démo buttons uniquement visibles en phase 0
  const demoGroup = document.getElementById('demo-group');
  if (demoGroup) demoGroup.style.display = (activeId === 0) ? '' : 'none';

  // Prev/next arrows
  const prevBtn = document.getElementById('phase-prev');
  const nextBtn = document.getElementById('phase-next');
  if (prevBtn) prevBtn.disabled = (activeId <= 0);
  if (nextBtn) nextBtn.disabled = (activeId >= 13);

  // Phase player counter
  if (typeof PhasePlayer !== 'undefined') PhasePlayer.updateCounter();
}

// ═════════════════════════════════════════════════════════════════
// PHASE PLAYER — lecture progressive des phases
// Utilisé aussi par l'export PDF pour parcourir phase par phase
// ═════════════════════════════════════════════════════════════════
const PhasePlayer = {
  playing: false,
  timer: null,
  speed: 5000,
  maxPhase: 12, // 0–12 (world 13 masquée)
  /** Zoom réduit pendant la lecture auto — moins de tuiles à charger */
  liteZoom: true,
  _savedZoom: null,
  /** Sauter les phases déjà visitées (sauf phase 0 toujours jouée) */
  skipVisited: false,
  /** Phases avec couches lourdes (WMS PEIGEO, BRGM, IGN raster) */
  _heavyPhases: new Set([0, 1, 2, 3, 4, 6, 7, 12]),
  /** Max timeout pour attendre les tuiles (ms) */
  _tileTimeout: 8000,

  /** Vérifie si une phase a déjà été vue */
  isVisited(id) {
    if (id === 0) return false; // phase 0 = toujours obligatoire
    const sess = SessionManager.getPhase(id);
    return !!(sess?.data?.visitedAt);
  },

  /** Trouve la prochaine phase non-vue après `from`, ou la prochaine tout court */
  _isActive(id) {
    const p = PHASES_META.phases.find(pp => pp.id === id);
    return p && p.active !== false;
  },

  _nextUnvisited(from) {
    for (let i = from + 1; i <= this.maxPhase; i++) {
      if (this._isActive(i) && !this.isVisited(i)) return i;
    }
    return -1; // toutes vues
  },

  /** Trouve la phase non-vue précédente avant `from` */
  _prevUnvisited(from) {
    for (let i = from - 1; i >= 0; i--) {
      if (this._isActive(i) && !this.isVisited(i)) return i;
    }
    return -1;
  },

  toggle() {
    this.playing ? this.stop() : this.start();
  },

  start() {
    this.playing = true;
    if (this.liteZoom) this._reduceZoom();
    this._updateUI();
    this._tick();
  },

  stop() {
    this.playing = false;
    clearTimeout(this.timer);
    this.timer = null;
    if (this._savedZoom !== null) this._restoreZoom();
    this._updateUI();
  },

  next() {
    const cur = Router.currentPhase;
    const target = this.skipVisited ? this._nextUnvisited(cur) : cur + 1;
    if (target >= 0 && target <= this.maxPhase) TerlabRouter.goto(target);
    else if (this.playing) this.stop();
  },

  prev() {
    const cur = Router.currentPhase;
    const target = this.skipVisited ? this._prevUnvisited(cur) : cur - 1;
    if (target >= 0) TerlabRouter.goto(target);
  },

  toggleSkipVisited() {
    this.skipVisited = !this.skipVisited;
    this._updateUI();
  },

  setSpeed(ms) {
    this.speed = parseInt(ms) || 5000;
    if (this.playing) {
      clearTimeout(this.timer);
      this._tick();
    }
  },

  /** Attendre que la carte ait fini de charger ses tuiles, avec fallback timeout */
  _waitForMap(timeoutMs) {
    const map = window.MapViewer?.getMap?.() ?? window.TerlabMap?._map;
    if (!map) return Promise.resolve();
    if (map.areTilesLoaded?.()) return new Promise(r => setTimeout(r, 300));
    return new Promise(resolve => {
      const onIdle = () => { map.off('idle', onIdle); clearTimeout(fallback); resolve(); };
      map.once('idle', onIdle);
      const fallback = setTimeout(() => { map.off('idle', onIdle); resolve(); }, timeoutMs || this._tileTimeout);
    });
  },

  /** Appelé par l'export PDF pour avancer automatiquement (toutes les phases, ignore skipVisited) */
  async playAll(onPhase) {
    for (let i = 0; i <= this.maxPhase; i++) {
      TerlabRouter.goto(i);
      await new Promise(r => setTimeout(r, 400));
      if (this._heavyPhases.has(i)) {
        await this._waitForMap(this._tileTimeout);
      }
      if (onPhase) await onPhase(i);
    }
  },

  updateCounter() {
    const el = document.getElementById('pp-counter');
    if (!el) return;
    if (this.skipVisited) {
      const unseen = Array.from({ length: this.maxPhase + 1 }, (_, i) => i).filter(i => !this.isVisited(i)).length;
      el.textContent = `${Router.currentPhase}/${this.maxPhase} (${unseen} new)`;
    } else {
      el.textContent = `${Router.currentPhase}/${this.maxPhase}`;
    }
  },

  _tick() {
    if (!this.playing) return;
    this._waitForMap(this._tileTimeout).then(() => {
      if (!this.playing) return;
      this.timer = setTimeout(() => {
        if (!this.playing) return;
        const cur = Router.currentPhase;
        const target = this.skipVisited ? this._nextUnvisited(cur) : cur + 1;
        if (target >= 0 && target <= this.maxPhase) {
          TerlabRouter.goto(target);
          this._tick();
        } else {
          this.stop();
        }
      }, this.speed);
    });
  },

  /** Recule le zoom de ~1.5 niveaux pour charger moins de tuiles */
  _reduceZoom() {
    const map = window.MapViewer?.getMap?.() ?? window.TerlabMap?._map;
    if (!map) return;
    this._savedZoom = map.getZoom();
    const lite = Math.max(this._savedZoom - 1.5, 12);
    if (lite < this._savedZoom) {
      map.easeTo({ zoom: lite, duration: 600 });
    }
  },

  _restoreZoom() {
    const map = window.MapViewer?.getMap?.() ?? window.TerlabMap?._map;
    if (!map || this._savedZoom === null) return;
    map.easeTo({ zoom: this._savedZoom, duration: 600 });
    this._savedZoom = null;
  },

  _updateUI() {
    const btn = document.getElementById('pp-play');
    const iconPlay  = btn?.querySelector('.pp-icon-play');
    const iconPause = btn?.querySelector('.pp-icon-pause');
    if (this.playing) {
      btn?.classList.add('playing');
      if (iconPlay)  iconPlay.style.display  = 'none';
      if (iconPause) iconPause.style.display = '';
    } else {
      btn?.classList.remove('playing');
      if (iconPlay)  iconPlay.style.display  = '';
      if (iconPause) iconPause.style.display = 'none';
    }
    // Toggle skip-visited button state
    const skipBtn = document.getElementById('pp-skip');
    if (skipBtn) {
      skipBtn.classList.toggle('active', this.skipVisited);
      skipBtn.title = this.skipVisited ? 'Montrer toutes les phases' : 'Sauter les phases déjà vues';
      const iconX   = skipBtn.querySelector('svg:first-child');
      const iconEye = skipBtn.querySelector('.pp-skip-eye');
      if (iconX)   iconX.style.display   = this.skipVisited ? '' : 'none';
      if (iconEye) iconEye.style.display = this.skipVisited ? 'none' : '';
    }
    this.updateCounter();
  }
};
window.PhasePlayer = PhasePlayer;

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

  // Phase 4 (PLU) : ne garder que la collectivité de l'intercommunalité du projet
  if (phaseId === 4) {
    const interco = SessionManager.getTerrain()?.intercommunalite;
    if (interco) {
      list = list.filter(a =>
        a.type !== 'collectivité' || a.nom?.toUpperCase() === interco.toUpperCase()
      );
    }
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
      // Skip inactive phases (e.g. P11 fusionnée en P10)
      let targetId = phaseId + 1;
      while (targetId <= 13 && PHASES_META.phases.find(p => p.id === targetId)?.active === false) targetId++;
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

  // Topbar — afficher le nom du terrain
  const tbName = document.getElementById('tb-terrain-name');
  if (tbName) {
    const parts = [terrain.commune];
    const ref = [terrain.section, terrain.parcelle].filter(Boolean).join('');
    if (ref) parts.push(ref);
    tbName.textContent = parts.join(' · ');
    tbName.title = [terrain.commune, ref, terrain.contenance_m2 ? terrain.contenance_m2 + ' m²' : ''].filter(Boolean).join(' · ');
  }

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
  },

  confirm(message, onConfirm) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast warning toast-confirm';
    toast.innerHTML = `
      <span>${message}</span>
      <div class="toast-confirm-actions">
        <button class="toast-confirm-btn toast-confirm-ok">OK</button>
        <button class="toast-confirm-btn toast-confirm-cancel">Annuler</button>
      </div>`;
    container.appendChild(toast);
    toast.querySelector('.toast-confirm-ok').addEventListener('click', () => {
      toast.classList.add('fade-out');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
      onConfirm();
    });
    toast.querySelector('.toast-confirm-cancel').addEventListener('click', () => {
      toast.classList.add('fade-out');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    });
  }
};

// ═════════════════════════════════════════════════════════════════
// PROJECT MENU (dropdown btn-login)
// ═════════════════════════════════════════════════════════════════
const ProjectMenu = {
  _dropdown: null,
  _open: false,

  init() {
    const btn = document.getElementById('btn-login');
    if (!btn) return;

    // Create dropdown container
    const dd = document.createElement('div');
    dd.className = 'pm-dropdown';
    dd.id = 'pm-dropdown';
    btn.parentElement.appendChild(dd);
    this._dropdown = dd;

    // Hidden file input for import
    const fi = document.createElement('input');
    fi.type = 'file';
    fi.accept = '.terlab,.json';
    fi.hidden = true;
    fi.id = 'pm-file-import';
    fi.addEventListener('change', (e) => this._handleImport(e));
    btn.parentElement.appendChild(fi);

    // Toggle on click
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (this._open && !this._dropdown.contains(e.target)) {
        this.close();
      }
    });

    // Refresh on session change
    window.addEventListener('terlab:session-changed', () => {
      if (this._open) this.render();
    });
  },

  toggle() {
    this._open ? this.close() : this.open();
  },

  open() {
    this._open = true;
    this.render();
    this._dropdown.classList.add('open');
    document.getElementById('btn-login')?.classList.add('active');
  },

  close() {
    this._open = false;
    this._dropdown.classList.remove('open');
    document.getElementById('btn-login')?.classList.remove('active');
  },

  render() {
    const sessions = TerlabStorage.listSessions();
    const currentId = SessionManager._sessionId;
    const t = SessionManager.getTerrain();
    const pct = SessionManager.getCompletionPct();
    const loc = t?.commune ? `${t.commune} ${t.parcelle ?? ''}`.trim() : 'Aucune parcelle';
    const col = pct < 30 ? 'var(--danger)' : pct < 60 ? 'var(--warning)' : 'var(--success)';

    let html = '';

    // Current session header
    html += `
      <div class="pm-current">
        <div class="pm-current-label">Session active</div>
        <div class="pm-current-loc">${loc}</div>
        <div class="pm-current-meta">
          <span>${pct}% completé</span>
          <div class="pm-current-bar"><div class="pm-current-bar-fill" style="width:${pct}%;background:${col}"></div></div>
        </div>
      </div>`;

    // Other projects
    const others = sessions.filter(s => s.id !== currentId);
    if (others.length > 0) {
      html += `<div class="pm-section">Autres projets</div>`;
      for (const s of others) {
        const sLoc = s.terrain?.commune || 'Sans commune';
        const sParcelle = s.terrain?.parcelle || s.terrain?.section || '';
        const sPct = s.completion ?? TerlabStorage._computeCompletion(s);
        const sAgo = this._timeAgo(s.updatedAt);
        html += `
          <div class="pm-item" data-id="${s.id}">
            <div class="pm-item-info">
              <div class="pm-item-loc">${sLoc} ${sParcelle}</div>
              <div class="pm-item-sub">${sAgo}</div>
            </div>
            <div class="pm-item-pct">${sPct}%</div>
            <button class="pm-item-del" data-del="${s.id}" title="Supprimer">✕</button>
          </div>`;
      }
    } else {
      html += `<div class="pm-empty">Aucun autre projet sauvegardé</div>`;
    }

    // User connection
    const email = window.TERLAB_USER_EMAIL;
    if (email) {
      html += `
        <div class="pm-section">Compte</div>
        <div class="pm-user-info">
          <span class="pm-user-email">${email}</span>
          <button class="pm-action-btn pm-btn-logout" id="pm-btn-logout">Se deconnecter</button>
        </div>`;
    }

    // Action buttons
    html += `
      <div class="pm-actions">
        <button class="pm-action-btn pm-btn-new" id="pm-btn-new">+ Nouveau</button>
        <button class="pm-action-btn" id="pm-btn-export">Exporter</button>
        <button class="pm-action-btn" id="pm-btn-import">Importer</button>
        <button class="pm-action-btn" id="pm-btn-accueil">Accueil</button>
      </div>`;

    this._dropdown.innerHTML = html;
    this._attachEvents();
  },

  _attachEvents() {
    // Switch to other project
    this._dropdown.querySelectorAll('.pm-item[data-id]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.pm-item-del')) return;
        this._switchSession(el.dataset.id);
      });
    });

    // Delete
    this._dropdown.querySelectorAll('.pm-item-del[data-del]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.del;
        const s = TerlabStorage.getSession(id);
        const name = s?.terrain?.commune || 'ce projet';
        Toast.confirm(`Supprimer ${name} ?`, () => {
          TerlabStorage.deleteSession(id);
          this.render();
          Toast.show('Projet supprimé', 'info');
        });
      });
    });

    // New project
    this._dropdown.querySelector('#pm-btn-new')?.addEventListener('click', () => {
      this._createNew();
    });

    // Export current
    this._dropdown.querySelector('#pm-btn-export')?.addEventListener('click', () => {
      TerlabStorage.export(SessionManager._sessionId);
      Toast.show('Export .terlab téléchargé', 'success');
      this.close();
    });

    // Import
    this._dropdown.querySelector('#pm-btn-import')?.addEventListener('click', () => {
      document.getElementById('pm-file-import')?.click();
    });

    // Logout (Firebase signOut + clear localStorage)
    this._dropdown.querySelector('#pm-btn-logout')?.addEventListener('click', () => {
      Toast.confirm(`Se deconnecter de ${window.TERLAB_USER_EMAIL} ?`, async () => {
        try {
          await window.TerlabLogin?.logout();
        } catch (e) {
          console.warn('logout error', e);
        }
        document.getElementById('btn-login').title = 'Connexion';
        Toast.show('Deconnecte', 'info', 2000);
        this.render();
      });
    });

    // Accueil
    this._dropdown.querySelector('#pm-btn-accueil')?.addEventListener('click', () => {
      window.location.href = 'accueil.html';
    });
  },

  _switchSession(id) {
    const loaded = TerlabStorage.loadSession(id);
    if (!loaded) {
      Toast.show('Session introuvable', 'warning');
      return;
    }
    AppState.sessionId = id;
    updateSessionBadge();
    updateToplevelScore();
    Toast.show(`Projet chargé : ${loaded.terrain?.commune ?? 'session'}`, 'success');
    this.close();
    // Re-route to current phase with new data
    route();
  },

  _createNew() {
    // Save current session first
    SessionManager.syncFirebase();
    // Create new
    const sess = TerlabStorage.createSession();
    SessionManager._loadFromObject(sess);
    AppState.sessionId = sess.id;
    updateSessionBadge();
    updateToplevelScore();
    Toast.show('Nouveau projet créé', 'success');
    this.close();
    // Go to phase 0
    window.location.hash = '#phase/0';
    route();
  },

  async _handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const sess = await TerlabStorage.import(file);
      this._switchSession(sess.id);
      Toast.show('Projet importé', 'success');
    } catch {
      Toast.show('Erreur import fichier', 'danger');
    }
    e.target.value = '';
  },

  _timeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'À l\'instant';
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Hier';
    if (days < 7) return `${days}j`;
    return new Date(dateStr).toLocaleDateString('fr-FR');
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
