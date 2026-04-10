/**
 * wind-rose.js — TERLAB · ENSA La Réunion
 * Dessin d'une rose des vents 16 secteurs sur canvas HTML.
 * Données issues de wind-stations-reunion.json (pré-calculé) ou ERA5 (fallback).
 *
 * RÈGLES :
 * - Vanilla JS ES2022+, aucune dépendance externe
 * - Ne jamais ajouter le canvas au DOM sans raison (off-screen pour PDF)
 * - Les fréquences sont en % (0-100), somme ≈ 100 hors calmes
 *
 * Usage :
 *   import { drawWindRose } from '../utils/wind-rose.js';
 *   const canvas = document.createElement('canvas');
 *   drawWindRose(canvas, { freqs16: [...], stationName: 'Bras-Panon', ... });
 *   const dataUrl = canvas.toDataURL('image/png');
 */

/** Labels des 16 secteurs (N=0, NNE=1, ..., NNO=15) */
export const SECTOR_LABELS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];

/**
 * Classification d'un secteur selon le type de vent à La Réunion.
 * 'alize'   → alizés (E, ENE, NE, ESE)
 * 'cyclone' → secteur cyclonique (NO, NNO, ONO)
 * 'autre'   → vents secondaires / brises
 */
export function sectorType(sectorIndex) {
  const ALIZE   = [2, 3, 4, 5];     // NE, ENE, E, ESE
  const CYCLONE = [13, 14, 15];     // ONO, NO, NNO
  if (ALIZE.includes(sectorIndex))   return 'alize';
  if (CYCLONE.includes(sectorIndex)) return 'cyclone';
  return 'autre';
}

/**
 * @param {HTMLCanvasElement} canvas     Canvas cible
 * @param {object}            opts
 * @param {number[]}  opts.freqs16       Tableau 16 fréquences % (N→NNO, clockwise)
 * @param {string}    [opts.stationName] Nom de la station (légende)
 * @param {number}    [opts.calmPct=0]   % de calmes (affiché au centre)
 * @param {number}    [opts.meanSpeed]   Vitesse moyenne m/s (légende)
 * @param {string}    [opts.dominantDir] Direction dominante (légende)
 * @param {number}    [opts.size=400]    Taille px (carré)
 * @param {boolean}   [opts.isDark=false]
 * @param {boolean}   [opts.showScale=true]  Afficher échelle % sur anneaux
 * @param {boolean}   [opts.show16Labels=true] Afficher labels 16 directions
 */
export function drawWindRose(canvas, opts = {}) {
  const freqs  = opts.freqs16 ?? new Array(16).fill(6.25);
  const W      = opts.size   ?? 400;
  const isDark = opts.isDark ?? false;
  const bg     = isDark ? '#1a1a1a' : '#F5F3EE';                                 // TERLAB --bg2
  // Anneaux/rayons : terracotta atténué (var(--tc) #C1652B à ~30%) — bien plus contrasté
  const gc     = isDark ? 'rgba(255,255,255,.20)' : 'rgba(193,101,43,.30)';
  const tc     = isDark ? '#aaa' : '#6A6860';                                    // --ink2
  const tlc    = isDark ? '#eee' : '#1C1C1A';                                    // --ink

  canvas.width  = W;
  canvas.height = W;
  const ctx = canvas.getContext('2d');
  const cx  = W / 2;
  const cy  = W / 2;
  const R   = W * 0.36;    // Rayon max (= 100% fréquence)

  // Fond
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, W);

  // ── Auto-échelle adaptative ─────────────────────────────────────
  // Le dominant atteint ~85% du rayon : on calcule un max "propre" arrondi au multiple de 5
  // au-dessus du pic (min 10%) — sinon les pétales sont écrasées contre le centre.
  const peakFreq = Math.max(...freqs, 1);
  const niceCeil = (v) => {
    if (v <= 10) return 10;
    if (v <= 15) return 15;
    if (v <= 20) return 20;
    if (v <= 25) return 25;
    if (v <= 30) return 30;
    if (v <= 40) return 40;
    if (v <= 50) return 50;
    return Math.ceil(v / 10) * 10;
  };
  const scaleMax = niceCeil(peakFreq / 0.85);          // dominant ≈ 85% du rayon
  const ringPcts = [scaleMax * 0.25, scaleMax * 0.5, scaleMax * 0.75, scaleMax];

  // Anneaux de fréquence (4 paliers de l'échelle adaptative)
  ringPcts.forEach((p, i) => {
    ctx.strokeStyle = gc;
    ctx.lineWidth   = i === ringPcts.length - 1 ? 1.4 : 0.7;
    ctx.beginPath();
    ctx.arc(cx, cy, R * p / scaleMax, 0, 2 * Math.PI);
    ctx.stroke();
    if (opts.showScale !== false && i < ringPcts.length - 1) {
      ctx.fillStyle    = tc;
      ctx.font         = `${Math.round(W * 0.024)}px monospace`;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(Math.round(p) + '%', cx + R * p / scaleMax + 3, cy);
    }
  });

  // Rayons directionnels (16) — secteurs cardinaux N/E/S/O plus marqués
  for (let i = 0; i < 16; i++) {
    const ar = (i * 22.5 - 90) * Math.PI / 180;
    const isCardinal = i % 4 === 0;
    ctx.strokeStyle = isCardinal ? gc : (isDark ? 'rgba(255,255,255,.10)' : 'rgba(193,101,43,.14)');
    ctx.lineWidth   = isCardinal ? 0.7 : 0.4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.cos(ar), cy + R * Math.sin(ar));
    ctx.stroke();
  }

  // Secteurs (roses) — pétales scalées sur l'échelle adaptative
  const halfAngle = (Math.PI * 2) / 16 / 2;  // = 11.25° en radians
  freqs.forEach((freq, i) => {
    if (freq < 0.5) return;
    const type   = sectorType(i);
    const az_rad = (i * 22.5 - 90) * Math.PI / 180;  // azimuth → angle canvas (N en haut)
    // Conversion azimuth → angle canvas : N=up → az=0° → angle=-π/2
    const azN_rad = i * 22.5 * Math.PI / 180;  // azimuth depuis N, clockwise
    const canvAng = azN_rad - Math.PI / 2;      // rotation canvas
    const r       = R * freq / scaleMax;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, canvAng - halfAngle, canvAng + halfAngle);
    ctx.closePath();

    const fillAlpha = isDark ? 0.60 : 0.50;
    if (type === 'alize') {
      ctx.fillStyle   = `rgba(55,138,221,${fillAlpha})`;
      ctx.strokeStyle = '#378ADD';
    } else if (type === 'cyclone') {
      ctx.fillStyle   = `rgba(224,89,42,${fillAlpha})`;
      ctx.strokeStyle = '#E0592A';
    } else {
      ctx.fillStyle   = isDark ? `rgba(180,180,180,.22)` : `rgba(100,100,100,.18)`;
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.10)';
    }
    ctx.lineWidth = 0.5;
    ctx.fill();
    ctx.stroke();
  });

  // Labels directionnels (16 directions ou 8 cardinaux selon option)
  const showAll = opts.show16Labels !== false;
  SECTOR_LABELS.forEach((lbl, i) => {
    const isCardinal = i % 4 === 0;
    if (!showAll && !isCardinal) return;
    const type    = sectorType(i);
    const azN_rad = i * 22.5 * Math.PI / 180;
    const canvAng = azN_rad - Math.PI / 2;
    const dist    = R + W * (isCardinal ? 0.075 : 0.060);

    ctx.fillStyle    = type === 'alize' ? '#378ADD' : type === 'cyclone' ? '#E0592A' : tlc;
    ctx.font         = `${isCardinal ? 'bold ' : ''}${Math.round(W * (isCardinal ? 0.032 : 0.024))}px monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(lbl, cx + dist * Math.cos(canvAng), cy + dist * Math.sin(canvAng));
  });

  // Centre — calmes
  const calmPct = opts.calmPct ?? 0;
  ctx.fillStyle = isDark ? '#555' : '#ccc';
  ctx.beginPath();
  ctx.arc(cx, cy, W * 0.025, 0, 2 * Math.PI);
  ctx.fill();
  if (calmPct > 0) {
    ctx.fillStyle    = isDark ? '#888' : '#999';
    ctx.font         = `${Math.round(W * 0.022)}px monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${calmPct}% calmes`, cx, cy + W * 0.030);
  }

  // Légende (désactivable via opts.showLegend = false — utilisé en mode PDF
  // pour éviter la collision avec les pills .map-lbl posées par l'export-engine)
  if (opts.showLegend !== false) {
    const legendItems = [
      { col: '#378ADD', lbl: 'Alizés (NE/E)' },
      { col: '#E0592A', lbl: 'Cyclones (NO)' },
      { col: isDark ? '#aaa' : '#888', lbl: 'Vents secondaires' },
    ];
    const lx  = W * 0.04;
    const ly  = W * 0.85;
    const ldy = W * 0.040;
    legendItems.forEach(({ col, lbl }, i) => {
      ctx.fillStyle = col;
      ctx.fillRect(lx, ly + i * ldy, W * 0.038, W * 0.014);
      ctx.fillStyle    = tc;
      ctx.font         = `${Math.round(W * 0.026)}px monospace`;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(lbl, lx + W * 0.048, ly + i * ldy);
    });
  }

  // Station + vitesse moyenne (désactivable via opts.showStationLine = false)
  if (opts.showStationLine !== false) {
    const stationLine = [
      opts.stationName ?? '',
      opts.meanSpeed != null ? `v̄ ${opts.meanSpeed.toFixed(1)} m/s` : '',
      opts.dominantDir ? `dir. dom. ${opts.dominantDir}` : '',
    ].filter(Boolean).join(' · ');

    if (stationLine) {
      ctx.fillStyle    = tc;
      ctx.font         = `${Math.round(W * 0.026)}px monospace`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(stationLine, cx, W * 0.02);
    }
  }
}

/**
 * Agrège un tableau de directions DD (degrés) et vitesses FF (m/s)
 * en fréquences 16 secteurs (% hors calmes).
 * @param {number[]} directions  Tableau de directions en degrés
 * @param {number[]} speeds      Tableau de vitesses m/s (même longueur)
 * @param {number}   calmThresh  Seuil calme m/s (défaut 1.0)
 * @returns {{ freqs16: number[], calmPct: number, dominantDir: string }}
 */
export function aggregateToWindRose(directions, speeds, calmThresh = 1.0) {
  const sectors = new Array(16).fill(0);
  let   calms   = 0;
  let   total   = 0;

  directions.forEach((dd, i) => {
    if (dd == null || speeds[i] == null) return;
    total++;
    if (speeds[i] < calmThresh) { calms++; return; }
    const idx = Math.round(dd / 22.5) % 16;
    sectors[idx]++;
  });

  const moving = total - calms;
  const freqs16 = moving > 0
    ? sectors.map(v => +((v / moving) * 100).toFixed(1))
    : new Array(16).fill(0);

  const maxIdx    = freqs16.indexOf(Math.max(...freqs16));
  const dominantDir = SECTOR_LABELS[maxIdx];
  const calmPct     = total > 0 ? Math.round(calms / total * 100) : 0;

  return { freqs16, calmPct, dominantDir };
}
