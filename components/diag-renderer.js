/**
 * TERLAB · diag-renderer.js
 * Wrapper haut niveau qui orchestre héliodone (canvas) + rose des vents Météo-France (canvas).
 * Adapté au schéma TERLAB : SessionManager.getTerrain() retourne { lat, lng, ... }.
 *
 * Exporte renderDiagrams(session, opts) → { heliCanvas, windCanvas, windData, lat, lng }.
 *
 * Usage interactif (P01) :
 *   import DiagRenderer from '../components/diag-renderer.js';
 *   const r = await DiagRenderer.renderDiagrams(window.SessionManager, { size: 280 });
 *   document.getElementById('p01-wind-canvas').replaceWith(r.windCanvas);
 *
 * Usage PDF (export-engine / pipeline headless) :
 *   const r = await DiagRenderer.renderDiagrams(session, { size: 600 });
 *   const heliPng = r.heliCanvas.toDataURL('image/png');
 *   const windPng = r.windCanvas.toDataURL('image/png');
 */

import { drawHeliodon }    from '../utils/sun-heliodon.js';
import { drawWindRose }    from '../utils/wind-rose.js';
import { getWindRoseData } from '../utils/wind-data-service.js';

/**
 * Extrait lat/lng depuis un SessionManager TERLAB ou un objet terrain plat.
 * @param {object} sessionOrTerrain  SessionManager (avec getTerrain()) ou terrain { lat, lng }
 * @returns {{ lat: number, lng: number }}
 */
function _extractCoords(sessionOrTerrain) {
  // SessionManager TERLAB
  if (typeof sessionOrTerrain?.getTerrain === 'function') {
    const t = sessionOrTerrain.getTerrain() ?? {};
    const lat = parseFloat(t.lat);
    const lng = parseFloat(t.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  // Objet plat { terrain: { lat, lng } }
  if (sessionOrTerrain?.terrain) {
    const lat = parseFloat(sessionOrTerrain.terrain.lat);
    const lng = parseFloat(sessionOrTerrain.terrain.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  // Objet terrain direct
  const lat = parseFloat(sessionOrTerrain?.lat);
  const lng = parseFloat(sessionOrTerrain?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };

  // Fallback : centre de La Réunion
  console.warn('[diag-renderer] Pas de coords lat/lng, fallback centre Réunion');
  return { lat: -21.115, lng: 55.536 };
}

/**
 * Rend héliodone + rose des vents dans deux canvas off-screen.
 * @param {object} session  SessionManager TERLAB ou objet { terrain: { lat, lng } }
 * @param {object} [opts]
 * @param {number}  [opts.size=600]   Taille canvas en px
 * @param {boolean} [opts.isDark=false]
 * @returns {Promise<{ heliCanvas: HTMLCanvasElement, windCanvas: HTMLCanvasElement, windData: object, lat: number, lng: number }>}
 */
async function renderDiagrams(session, opts = {}) {
  const size   = opts.size   ?? 600;
  const isDark = opts.isDark ?? (document?.documentElement?.dataset?.theme === 'dark');
  // Mode "minimal" : pas de légendes ni titre intra-canvas (utilisé en PDF où
  // l'export-engine pose ses propres pills .map-lbl par-dessus le canvas).
  const minimal = opts.minimal === true;

  const { lat, lng } = _extractCoords(session);

  // ── Héliodone ─────────────────────────────────────────────────────────────
  const heliCanvas = document.createElement('canvas');
  drawHeliodon(heliCanvas, lat, {
    size,
    isDark,
    showLegend:   !minimal,
    showLatTitle: !minimal,
  });

  // ── Rose des vents ────────────────────────────────────────────────────────
  let windData;
  try {
    windData = await getWindRoseData(lat, lng);
  } catch (err) {
    console.warn('[diag-renderer] getWindRoseData a échoué :', err);
    windData = {
      freqs16:     [3, 4, 12, 20, 24, 14, 8, 4, 2, 2, 1, 1, 1, 2, 3, 3],
      calmPct:     7,
      dominantDir: 'E',
      meanSpeed:   5.5,
      source:      'fallback-indicatif',
      stationName: 'Données indicatives La Réunion',
      period:      '—',
    };
  }

  const windCanvas = document.createElement('canvas');
  drawWindRose(windCanvas, {
    freqs16:     windData.freqs16,
    calmPct:     windData.calmPct,
    meanSpeed:   windData.meanSpeed,
    dominantDir: windData.dominantDir,
    stationName: windData.stationName,
    size,
    isDark,
    showLegend:      !minimal,
    showStationLine: !minimal,
  });

  return { heliCanvas, windCanvas, windData, lat, lng };
}

const DiagRenderer = { renderDiagrams, _extractCoords };

// Export ES module + global window pour scripts non-module (export-engine.js, pipeline Puppeteer)
export default DiagRenderer;
export { renderDiagrams };

if (typeof window !== 'undefined') {
  window.DiagRenderer = DiagRenderer;
}
