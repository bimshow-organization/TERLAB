// TERLAB · obia-service.js · Analyse OBIA satellite simplifiée
// Porté depuis obia-lite.js GIEP — version légère pour TERLAB pédagogique
// Classification par pixel HSV calibrée La Réunion
// ENSA La Réunion · MGA Architecture

import { classifyPixelReunion } from './reunion-constants.js';

const OBIAService = {

  // Labels FR pour l'affichage
  LABELS: {
    pctTresBoise:     'Forêt dense (endémique)',
    pctBoise:         'Végétation secondaire',
    pctSavane:        'Savane / herbacées',
    pctCanne:         'Canne à sucre',
    pctAride:         'Sol nu / aride',
    pctConstructions: 'Bâti / routes',
  },

  // Couleurs overlay pour chaque classe
  CLASS_COLORS: {
    pctTresBoise:     [30, 100, 30, 180],
    pctBoise:         [60, 160, 60, 150],
    pctSavane:        [180, 160, 60, 150],
    pctCanne:         [120, 200, 80, 150],
    pctAride:         [160, 120, 80, 150],
    pctConstructions: [100, 100, 120, 150],
  },

  // ── Classifier un pixel unique (wrapper public) ───────────────────
  classifyPixel(r, g, b) {
    return classifyPixelReunion(r, g, b);
  },

  // ── Analyser une parcelle depuis la carte Mapbox ──────────────────
  async analyzeParcel(mapInstance, parcelleGeoJSON) {
    if (!mapInstance || !parcelleGeoJSON) return null;

    try {
      // Extraire les pixels du canvas Mapbox dans la zone de la parcelle
      const pixelData = this._grabPixels(mapInstance, parcelleGeoJSON);
      if (!pixelData || pixelData.samples.length === 0) {
        console.warn('[OBIA] Aucun pixel récupéré');
        return null;
      }

      // Classifier chaque pixel
      const counts = {};
      let totalClassified = 0;

      for (const { r, g, b } of pixelData.samples) {
        const cls = classifyPixelReunion(r, g, b);
        if (cls) {
          counts[cls] = (counts[cls] ?? 0) + 1;
          totalClassified++;
        }
      }

      if (totalClassified === 0) return null;

      // Convertir en pourcentages
      const surfaces = {};
      for (const key of Object.keys(this.LABELS)) {
        surfaces[key] = Math.round(((counts[key] ?? 0) / totalClassified) * 100);
      }

      // Normaliser à 100%
      const total = Object.values(surfaces).reduce((s, v) => s + v, 0);
      if (total !== 100 && total > 0) {
        const keys = Object.keys(surfaces);
        const maxKey = keys.reduce((a, b) => surfaces[a] >= surfaces[b] ? a : b);
        surfaces[maxKey] += (100 - total);
      }

      return {
        source: 'obia_mapbox_satellite',
        confidence: totalClassified > 500 ? 'medium' : 'low',
        note_confidence: 'Analyse depuis ortho satellite — précision ±15%',
        surfaces,
        pixelCount: totalClassified,
        raster: pixelData.raster,
        rasterW: pixelData.w,
        rasterH: pixelData.h,
        origin: { minX: pixelData.minX, minY: pixelData.minY },
      };
    } catch (err) {
      console.error('[OBIA] Erreur analyse:', err);
      return null;
    }
  },

  // ── Générer le HTML de résultat OBIA pour l'UI ────────────────────
  buildResultHTML(obiaResult) {
    if (!obiaResult) return '<div class="stub-warning">Analyse satellite non disponible</div>';

    const { surfaces } = obiaResult;
    let html = '<div class="obia-grid">';

    for (const [key, label] of Object.entries(this.LABELS)) {
      const pct = surfaces[key] ?? 0;
      if (pct <= 0) continue;
      html += `
        <div class="obia-cell">
          <div class="obia-label">${label}</div>
          <div class="obia-val">${pct}%</div>
          <div class="obia-bar" style="width:${pct}%;background:rgb(${this.CLASS_COLORS[key]?.slice(0,3).join(',') ?? '0,212,255'})"></div>
        </div>`;
    }

    html += '</div>';
    html += `<div class="stub-warning" style="margin-top:6px">Analyse satellite approximative ±15% — vérifier sur le terrain</div>`;
    return html;
  },

  // ── Extraire les pixels du canvas Mapbox pour la parcelle ─────────
  _grabPixels(map, geojson) {
    const canvas = map.getCanvas();
    if (!canvas) return null;

    const dpr = window.devicePixelRatio || 1;

    // Calculer la bbox en pixels écran
    const coords = this._extractCoords(geojson);
    if (coords.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [lng, lat] of coords) {
      const p = map.project([lng, lat]);
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    // Marges
    minX = Math.max(0, Math.floor(minX - 2));
    minY = Math.max(0, Math.floor(minY - 2));
    maxX = Math.min(canvas.width / dpr, Math.ceil(maxX + 2));
    maxY = Math.min(canvas.height / dpr, Math.ceil(maxY + 2));

    const w = Math.round((maxX - minX) * dpr);
    const h = Math.round((maxY - minY) * dpr);
    if (w <= 0 || h <= 0) return null;

    // Lire les pixels via WebGL
    const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
    if (!gl) return null;

    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(
      Math.round(minX * dpr),
      Math.round(gl.drawingBufferHeight - (maxY * dpr)),
      w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels
    );

    // Échantillonner (stride 2 pour performance)
    const stride = 2;
    const samples = [];
    for (let y = 0; y < h; y += stride) {
      for (let x = 0; x < w; x += stride) {
        const idx = (y * w + x) * 4;
        const a = pixels[idx + 3];
        if (a < 128) continue; // pixel transparent
        samples.push({ r: pixels[idx], g: pixels[idx + 1], b: pixels[idx + 2] });
      }
    }

    return { samples, w, h, raster: pixels, minX, minY };
  },

  // ── Générer une image classifiée colorée, masquée par le polygone ──
  /**
   * @param {Uint8Array} raster — pixels RGBA bruts (bbox rectangulaire)
   * @param {number} w — largeur en pixels
   * @param {number} h — hauteur en pixels
   * @param {Object} map — instance Mapbox GL (pour project())
   * @param {Array} polyCoords — coordonnées [lng,lat] du polygone parcelle
   * @param {{ minX, minY }} origin — coin supérieur gauche de la bbox en pixels écran
   * @returns {string} data URL PNG
   */
  buildClassifiedImage(raster, w, h, map, polyCoords, origin) {
    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // 1. Classifier chaque pixel — readPixels est flippé verticalement (OpenGL)
    const imgData = ctx.createImageData(w, h);
    const rowBytes = w * 4;
    for (let y = 0; y < h; y++) {
      const srcRow = (h - 1 - y) * rowBytes; // flip vertical
      const dstRow = y * rowBytes;
      for (let x = 0; x < w; x++) {
        const si = srcRow + x * 4;
        const di = dstRow + x * 4;
        const r = raster[si], g = raster[si + 1], b = raster[si + 2], a = raster[si + 3];
        if (a < 128) { imgData.data[di + 3] = 0; continue; }
        const cls = classifyPixelReunion(r, g, b);
        const color = cls ? (this.CLASS_COLORS[cls] ?? [150, 150, 150, 120]) : [0, 0, 0, 0];
        imgData.data[di]     = color[0];
        imgData.data[di + 1] = color[1];
        imgData.data[di + 2] = color[2];
        imgData.data[di + 3] = color[3];
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // 2. Masquer avec le polygone de la parcelle (clip)
    if (map && polyCoords && polyCoords.length > 2 && origin) {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.beginPath();
      for (let i = 0; i < polyCoords.length; i++) {
        const p = map.project(polyCoords[i]);
        const px = (p.x - origin.minX) * dpr;
        const py = (p.y - origin.minY) * dpr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    return canvas.toDataURL('image/png');
  },

  // ── Extraire les coordonnées d'un GeoJSON ─────────────────────────
  _extractCoords(geojson) {
    if (!geojson) return [];
    if (geojson.type === 'Feature') return this._extractCoords(geojson.geometry);
    if (geojson.type === 'Polygon') return geojson.coordinates[0] ?? [];
    if (geojson.type === 'MultiPolygon') return geojson.coordinates[0]?.[0] ?? [];
    return [];
  },
};

export default OBIAService;
