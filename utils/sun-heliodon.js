/**
 * sun-heliodon.js — TERLAB · ENSA La Réunion
 * Dessin d'un héliodone (diagramme de trajectoires solaires) sur canvas HTML.
 * Projection azimutale équidistante, Nord en haut.
 *
 * RÈGLES :
 * - Vanilla JS ES2022+, aucune dépendance externe
 * - Ne jamais ajouter ce canvas au DOM (canvas off-screen pour export PDF)
 * - Latitude NÉGATIVE pour l'hémisphère sud (La Réunion ≈ -21°)
 * - Été = décembre (δ = -23.45°) / Hiver = juin (δ = +23.45°) en hémisphère sud
 *
 * Usage :
 *   import { drawHeliodon } from '../utils/sun-heliodon.js';
 *   const canvas = document.createElement('canvas');
 *   drawHeliodon(canvas, -20.99, { size: 400 });
 *   const dataUrl = canvas.toDataURL('image/png');
 */

/**
 * @param {HTMLCanvasElement} canvas  Canvas cible (off-screen ou DOM)
 * @param {number}            lat_deg Latitude en degrés (négatif = sud)
 * @param {object}            options
 * @param {number}  [options.size=400]          Taille en pixels (carré)
 * @param {boolean} [options.isDark=false]      Mode sombre
 * @param {string}  [options.bgColor='#f5f4f1'] Fond clair
 * @param {string}  [options.darkBg='#1a1a1a']  Fond sombre
 * @param {string}  [options.locale='fr']        Langue labels
 */
export function drawHeliodon(canvas, lat_deg, options = {}) {
  const W      = options.size   ?? 400;
  const isDark = options.isDark ?? false;
  const bg     = isDark ? (options.darkBg  ?? '#1a1a1a') : (options.bgColor ?? '#F5F3EE'); // TERLAB --bg2
  // Anneaux/rayons : terracotta atténué (var(--tc) #C1652B à ~22%) — bien plus contrasté
  const gc     = isDark ? 'rgba(255,255,255,.20)' : 'rgba(193,101,43,.30)';
  const tc     = isDark ? '#aaa' : '#6A6860';   // --ink2
  const tlc    = isDark ? '#eee' : '#1C1C1A';   // --ink

  canvas.width  = W;
  canvas.height = W;
  const ctx = canvas.getContext('2d');
  const cx  = W / 2;
  const cy  = W / 2;
  const R   = W * 0.38;

  // Fond
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, W);

  // Anneaux d'altitude 0° → 80° par 10°
  for (let alt = 0; alt < 90; alt += 10) {
    const r = R * (90 - alt) / 90;
    ctx.strokeStyle = gc;
    ctx.lineWidth   = alt === 0 ? 1.4 : 0.7;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.stroke();
    if (alt > 0 && alt < 80) {
      ctx.fillStyle    = tc;
      ctx.font         = `${Math.round(W * 0.030)}px monospace`;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(alt + '°', cx + r + 3, cy - W * 0.030);
    }
  }

  // Rayons azimutaux (tous les 30°, tous les 10° en trait fin)
  for (let az = 0; az < 360; az += 10) {
    const ar     = az * Math.PI / 180;
    const isMaj  = az % 30 === 0;
    ctx.strokeStyle = isMaj ? gc : (isDark ? 'rgba(255,255,255,.10)' : 'rgba(193,101,43,.14)');
    ctx.lineWidth   = isMaj ? 0.7 : 0.4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.sin(ar), cy - R * Math.cos(ar));
    ctx.stroke();
  }

  // Labels cardinaux N E S O (et intermédiaires NE SE SO NO)
  const cardLabels = [
    { az:   0, l: 'N',  bold: true  },
    { az:  45, l: 'NE', bold: false },
    { az:  90, l: 'E',  bold: true  },
    { az: 135, l: 'SE', bold: false },
    { az: 180, l: 'S',  bold: true  },
    { az: 225, l: 'SO', bold: false },
    { az: 270, l: 'O',  bold: true  },
    { az: 315, l: 'NO', bold: false },
  ];
  cardLabels.forEach(({ az, l, bold }) => {
    const ar   = az * Math.PI / 180;
    const dist = R + W * (bold ? 0.075 : 0.060);
    ctx.fillStyle    = tlc;
    ctx.font         = `${bold ? 'bold ' : ''}${Math.round(W * (bold ? 0.034 : 0.026))}px monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(l, cx + dist * Math.sin(ar), cy - dist * Math.cos(ar));
  });

  // Trajectoires solaires — 3 déclinaisons
  // Hémisphère sud : été = décembre δ<0, hiver = juin δ>0
  const φ = lat_deg * Math.PI / 180;
  const configs = [
    { δ_deg: -23.45, col: '#E0592A', label: options.locale === 'fr' ? 'Été (déc.)' : 'Summer (Dec)' },
    { δ_deg:   0,    col: '#1D9E75', label: 'Équinoxe'  },
    { δ_deg: +23.45, col: '#378ADD', label: options.locale === 'fr' ? 'Hiver (juin)' : 'Winter (Jun)' },
  ];

  configs.forEach(({ δ_deg, col, label }) => {
    const δ   = δ_deg * Math.PI / 180;
    const pts = [];

    for (let i = 0; i <= 1440; i++) {
      const ω  = ((i / 1440) * 2 - 1) * Math.PI;
      const sh = Math.sin(φ) * Math.sin(δ) + Math.cos(φ) * Math.cos(δ) * Math.cos(ω);
      if (sh <= 0.005) continue;

      const h   = Math.asin(Math.min(1, sh));
      const Az  = Math.atan2(
        -Math.cos(δ) * Math.sin(ω),
        Math.sin(δ) * Math.cos(φ) - Math.cos(δ) * Math.sin(φ) * Math.cos(ω)
      );
      const h_d = h * 180 / Math.PI;
      const r   = R * (90 - h_d) / 90;
      pts.push([cx + r * Math.sin(Az), cy - r * Math.cos(Az)]);
    }

    if (pts.length < 2) return;

    ctx.strokeStyle = col;
    ctx.lineWidth   = W * 0.0040;
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    pts.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.stroke();

    // Marqueurs horaires (6h–18h par 1h, label sur heures paires)
    for (let hr = 6; hr <= 18; hr++) {
      const ω  = (hr - 12) * 15 * Math.PI / 180;
      const sh = Math.sin(φ) * Math.sin(δ) + Math.cos(φ) * Math.cos(δ) * Math.cos(ω);
      if (sh <= 0.005) continue;
      const h  = Math.asin(Math.min(1, sh));
      const Az = Math.atan2(
        -Math.cos(δ) * Math.sin(ω),
        Math.sin(δ) * Math.cos(φ) - Math.cos(δ) * Math.sin(φ) * Math.cos(ω)
      );
      const h_d = h * 180 / Math.PI;
      const r   = R * (90 - h_d) / 90;
      const x   = cx + r * Math.sin(Az);
      const y   = cy - r * Math.cos(Az);

      ctx.fillStyle = col;
      const dotR = hr % 3 === 0 ? W * 0.014 : W * 0.008;
      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, 2 * Math.PI);
      ctx.fill();

      if (hr % 3 === 0) {
        ctx.fillStyle    = isDark ? '#ddd' : '#333';
        ctx.font         = `${Math.round(W * 0.024)}px monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${hr}h`, x, y - dotR - 2);
      }
    }
  });

  // Légende (désactivable via opts.showLegend = false — utile en mode PDF
  // pour éviter la collision avec les pills .map-lbl posées par l'export-engine)
  if (options.showLegend !== false) {
    const legendItems = [
      { col: '#E0592A', lbl: configs[0].label + ` — hé≈${_noonAlt(φ, -23.45)}° S` },
      { col: '#1D9E75', lbl: configs[1].label + ` — hé≈${_noonAlt(φ, 0)}° N`      },
      { col: '#378ADD', lbl: configs[2].label + ` — hé≈${_noonAlt(φ, +23.45)}° N` },
    ];
    const lx  = W * 0.05;
    const ly  = W * 0.86;
    const ldy = W * 0.040;
    legendItems.forEach(({ col, lbl }, i) => {
      ctx.fillStyle = col;
      ctx.fillRect(lx, ly + i * ldy, W * 0.040, W * 0.014);
      ctx.fillStyle    = tc;
      ctx.font         = `${Math.round(W * 0.026)}px monospace`;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(lbl, lx + W * 0.050, ly + i * ldy);
    });
  }

  // Point zénith
  ctx.fillStyle = isDark ? '#666' : '#ccc';
  ctx.beginPath();
  ctx.arc(cx, cy, W * 0.012, 0, 2 * Math.PI);
  ctx.fill();

  // Titre latitude (désactivable via opts.showLatTitle = false)
  if (options.showLatTitle !== false) {
    ctx.fillStyle    = tc;
    ctx.font         = `${Math.round(W * 0.026)}px monospace`;
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(`φ = ${lat_deg.toFixed(2)}°`, W - W * 0.02, W * 0.02);
  }
}

/** Altitude solaire au midi solaire (degrés) */
function _noonAlt(φ_rad, δ_deg) {
  const δ  = δ_deg * Math.PI / 180;
  const sh = Math.sin(φ_rad) * Math.sin(δ) + Math.cos(φ_rad) * Math.cos(δ);
  return Math.round(Math.asin(Math.max(-1, Math.min(1, sh))) * 180 / Math.PI);
}

/**
 * Retourne { sunrise_h, sunset_h, day_length_h } en heures solaires locales.
 * Utile pour la légende ou les annotations.
 * @param {number} lat_deg
 * @param {number} δ_deg
 */
export function sunriseSunset(lat_deg, δ_deg) {
  const φ  = lat_deg * Math.PI / 180;
  const δ  = δ_deg   * Math.PI / 180;
  const cosH0 = -Math.tan(φ) * Math.tan(δ);
  if (cosH0 > 1)  return { sunrise_h: null, sunset_h: null, day_length_h: 0 };   // nuit polaire
  if (cosH0 < -1) return { sunrise_h: 0,    sunset_h: 24,   day_length_h: 24 };  // jour polaire
  const ωs      = Math.acos(cosH0) * 180 / Math.PI;
  const rise    = 12 - ωs / 15;
  const set     = 12 + ωs / 15;
  return {
    sunrise_h:   +rise.toFixed(2),
    sunset_h:    +set.toFixed(2),
    day_length_h: +(ωs * 2 / 15).toFixed(2),
  };
}
