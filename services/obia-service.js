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

  // Icônes par classe
  CLASS_ICONS: {
    pctTresBoise:     '🌳',
    pctBoise:         '🌿',
    pctSavane:        '🌾',
    pctCanne:         '🎋',
    pctAride:         '🏜',
    pctConstructions: '🏗',
  },

  // ── Générer le HTML de résultat OBIA pour l'UI ────────────────────
  buildResultHTML(obiaResult) {
    if (!obiaResult) return '<div class="stub-warning">Analyse satellite non disponible</div>';

    const { surfaces, pixelCount, confidence } = obiaResult;

    // Badge confiance
    const confLabel = confidence === 'medium' ? 'Moyenne' : 'Faible';
    const confColor = confidence === 'medium' ? 'var(--accent)' : '#c0852a';

    let html = `<div class="obia-header">
      <span class="obia-pixels">${pixelCount.toLocaleString('fr-FR')} pixels classifiés</span>
      <span class="obia-confidence" style="color:${confColor}">Confiance : ${confLabel}</span>
    </div>`;

    html += '<div class="obia-grid">';

    // Trier par pourcentage décroissant
    const sorted = Object.entries(this.LABELS)
      .map(([key, label]) => ({ key, label, pct: surfaces[key] ?? 0 }))
      .filter(d => d.pct > 0)
      .sort((a, b) => b.pct - a.pct);

    for (const { key, label, pct } of sorted) {
      const rgb = this.CLASS_COLORS[key]?.slice(0, 3).join(',') ?? '0,212,255';
      const icon = this.CLASS_ICONS[key] ?? '';
      html += `
        <div class="obia-cell">
          <div class="obia-cell-head">
            <span class="obia-icon">${icon}</span>
            <span class="obia-label">${label}</span>
          </div>
          <div class="obia-val-row">
            <span class="obia-val">${pct}%</span>
            <span class="obia-bar-wrap"><span class="obia-bar" style="width:${pct}%;background:rgb(${rgb})"></span></span>
          </div>
        </div>`;
    }

    html += '</div>';
    html += `<div class="stub-warning" style="margin-top:6px">Analyse satellite approximative ±15% — vérifier sur le terrain</div>`;
    return html;
  },

  // ── Stride adaptatif selon la taille du terrain en pixels ──────
  _computeStride(pixelArea) {
    if (pixelArea < 40000)  return 1;  // petit terrain → pleine résolution
    if (pixelArea < 160000) return 2;  // moyen → demi résolution
    return 3;                           // grand → tiers
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

    // Stride adaptatif selon la surface en pixels
    const stride = this._computeStride(w * h);
    const samples = [];
    for (let y = 0; y < h; y += stride) {
      for (let x = 0; x < w; x += stride) {
        const idx = (y * w + x) * 4;
        const a = pixels[idx + 3];
        if (a < 128) continue; // pixel transparent
        samples.push({ r: pixels[idx], g: pixels[idx + 1], b: pixels[idx + 2] });
      }
    }

    return { samples, w, h, raster: pixels, minX, minY, stride };
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

  // ═══════════════════════════════════════════════════════════════════
  //  CLASSIFICATION GÉOLOGIQUE (BRGM pixel sampling)
  //  Porté depuis carte.js GIEP — sampling couleurs carte BRGM
  // ═══════════════════════════════════════════════════════════════════

  /** Carte couleur BRGM → formation géologique La Réunion */
  GEOLOGICAL_COLOR_MAP: {
    '#F5E6D3': { type: 'sable_plage',         name: 'Sables et galets de plage',        permeability: 'très_forte', coefficient: 150 },
    '#D2B48C': { type: 'alluvions',            name: 'Alluvions de rivières',             permeability: 'forte',      coefficient: 120 },
    '#CD853F': { type: 'eboulis',              name: 'Éboulis de pente, colluvions',      permeability: 'forte',      coefficient: 100 },
    '#FF0000': { type: 'coulees_xxe',          name: 'Coulées du XXe siècle',             permeability: 'extrême',    coefficient: 250, age: '1900-2000' },
    '#DC143C': { type: 'coulees_historiques',  name: 'Coulées XVII-XIXe siècles',         permeability: 'très_forte', coefficient: 200, age: '1600-1900' },
    '#FF6347': { type: 'coulees_2300',         name: 'Coulées historiques (0-2300 ans)',   permeability: 'très_forte', coefficient: 180, age: '0-2300 ans' },
    '#FFD700': { type: 'fournaise_37ka',       name: 'Coulées 2300-37000 ans',            permeability: 'forte',      coefficient: 140, age: '2.3-37 ka' },
    '#FFFF00': { type: 'fournaise_170ka',      name: 'Coulées 37000-170000 ans',          permeability: 'forte',      coefficient: 120, age: '37-170 ka' },
    '#F0E68C': { type: 'fournaise_350ka',      name: 'Coulées 170000-350000 ans',         permeability: 'moyenne',    coefficient: 90,  age: '170-350 ka' },
    '#32CD32': { type: 'plaine_cafres',        name: 'Axe volcanique Plaine des Cafres',  permeability: 'forte',      coefficient: 110, age: '50-350 ka' },
    '#006400': { type: 'neiges_primitif',      name: 'Basaltes alcalins peu évolués',     permeability: 'forte',      coefficient: 100, age: '350-2000 ka' },
    '#228B22': { type: 'neiges_alcalins',      name: 'Basaltes alcalins et transitionnels', permeability: 'moyenne',  coefficient: 80,  age: '120-700 ka' },
    '#7CFC00': { type: 'neiges_differencie',   name: 'Basaltes différenciés',             permeability: 'moyenne',    coefficient: 70,  age: '70-500 ka' },
    '#2F4F4F': { type: 'intrusions',           name: 'Intrusions (gabbros, syénites)',    permeability: 'faible',     coefficient: 25,  age: '70-300 ka' },
    '#696969': { type: 'breches_explosion',    name: 'Brèches d\'explosion',              permeability: 'moyenne',    coefficient: 60 },
    '#87CEEB': { type: 'formations_marines',   name: 'Formations marines',                permeability: 'variable',   coefficient: 50 },
  },

  /** Analyser la géologie au point central du terrain depuis la carte BRGM */
  async analyzeGeologyAtPoint(mapInstance, lng, lat) {
    if (!mapInstance) return null;
    // Vérifier qu'on est dans les limites de La Réunion
    if (lng < 55.2 || lng > 55.85 || lat < -21.42 || lat > -20.85) {
      return { type: 'hors_limites', name: 'Hors limites La Réunion', permeability: 'inconnue', coefficient: 50 };
    }

    const pixel = this._samplePixelAt(mapInstance, lng, lat);
    if (!pixel || pixel.a < 128) return this._fallbackGeology(lng, lat);

    const match = this._findClosestGeology(pixel);
    if (match && match.confidence !== 'très_faible') {
      return { ...match, coordinates: { lng, lat }, pixelColor: `rgb(${pixel.r},${pixel.g},${pixel.b})`, method: 'brgm_pixel' };
    }
    return this._fallbackGeology(lng, lat);
  },

  /** Analyser la géologie sur toute la parcelle (multi-pixel) */
  async analyzeGeologyParcel(mapInstance, parcelleGeoJSON) {
    if (!mapInstance || !parcelleGeoJSON) return null;
    const grabbed = this._grabPixels(mapInstance, parcelleGeoJSON);
    if (!grabbed?.samples?.length) return null;

    // Compter les formations géologiques par pixel
    const counts = {};
    let total = 0;
    for (const { r, g, b } of grabbed.samples) {
      const match = this._findClosestGeology({ r, g, b });
      if (match && match.confidence !== 'très_faible') {
        counts[match.type] = (counts[match.type] || 0) + 1;
        if (!counts[`_meta_${match.type}`]) counts[`_meta_${match.type}`] = match;
        total++;
      }
    }
    if (!total) return null;

    // Trier par fréquence
    const formations = Object.entries(counts)
      .filter(([k]) => !k.startsWith('_meta_'))
      .map(([type, count]) => ({
        ...counts[`_meta_${type}`],
        type, count, pct: Math.round(count / total * 100),
      }))
      .sort((a, b) => b.count - a.count);

    return {
      dominant: formations[0] ?? null,
      formations,
      pixelCount: total,
      confidence: total > 200 ? 'haute' : total > 50 ? 'moyenne' : 'faible',
    };
  },

  /** Échantillonner un pixel via WebGL */
  _samplePixelAt(map, lng, lat) {
    const pt = map.project([lng, lat]);
    const gl = map.getCanvas().getContext('webgl2') || map.getCanvas().getContext('webgl');
    if (!gl) return null;
    const pixels = new Uint8Array(4);
    try {
      const h = map.getCanvas().height;
      gl.readPixels(Math.floor(pt.x * (window.devicePixelRatio || 1)),
                    Math.floor(h - pt.y * (window.devicePixelRatio || 1)),
                    1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return { r: pixels[0], g: pixels[1], b: pixels[2], a: pixels[3] };
    } catch { return null; }
  },

  /** Trouver la formation géologique la plus proche par couleur */
  _findClosestGeology(pixel) {
    let minDist = Infinity, best = null;
    for (const [hex, formation] of Object.entries(this.GEOLOGICAL_COLOR_MAP)) {
      const t = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      const dr = pixel.r - t, dg = pixel.g - g, db = pixel.b - b;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      if (dist < minDist) { minDist = dist; best = { hex, ...formation }; }
    }
    if (!best) return null;
    best.confidence = minDist < 30 ? 'très_haute' : minDist < 60 ? 'haute' : minDist < 90 ? 'moyenne' : minDist < 150 ? 'faible' : 'très_faible';
    best.distance = Math.round(minDist);
    return best;
  },

  /** Fallback géologie par altitude/position quand les pixels ne sont pas dispo */
  _fallbackGeology(lng, lat) {
    // Piton de la Fournaise (est)
    if (lng > 55.55 && lat > -21.35) {
      return { type: 'coulees_2300', name: 'Coulées récentes (Fournaise)', permeability: 'très_forte', coefficient: 180, method: 'fallback_geo' };
    }
    // Littoral
    if (lat < -21.3 || lat > -21.0) {
      return { type: 'alluvions', name: 'Alluvions littorales', permeability: 'forte', coefficient: 120, method: 'fallback_geo' };
    }
    // Intérieur / hauts
    return { type: 'neiges_alcalins', name: 'Basaltes Piton des Neiges', permeability: 'moyenne', coefficient: 80, method: 'fallback_geo' };
  },

  /** HTML de résultat géologique pour l'UI P02 */
  buildGeologyResultHTML(geoResult) {
    if (!geoResult) return '<div class="stub-warning">Analyse géologique non disponible</div>';
    const dom = geoResult.dominant ?? geoResult;
    const permColors = { 'extrême': '#ef4444', 'très_forte': '#f59e0b', 'forte': '#eab308', 'moyenne': '#22c55e', 'faible': '#3b82f6', 'variable': '#8b5cf6' };
    const permC = permColors[dom.permeability] ?? '#888';

    let html = `<div style="margin-bottom:6px">
      <div style="font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--text)">${dom.name}</div>
      <div style="display:flex;gap:8px;margin-top:4px;font-size:10px;font-family:var(--font-mono)">
        <span style="color:${permC}">Perméabilité : ${dom.permeability}</span>
        <span style="color:var(--muted)">Coeff. : ${dom.coefficient} mm/h</span>
        ${dom.age ? `<span style="color:var(--faint)">Âge : ${dom.age}</span>` : ''}
      </div>
    </div>`;

    // Si multi-formations (parcelle)
    if (geoResult.formations?.length > 1) {
      html += '<div style="margin-top:6px">';
      for (const f of geoResult.formations.slice(0, 4)) {
        html += `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:9px;font-family:var(--font-mono)">
          <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${f.hex};border:1px solid rgba(0,0,0,.15)"></span>
          <span style="flex:1;color:var(--text2)">${f.name}</span>
          <span style="color:var(--accent);font-weight:600">${f.pct}%</span>
        </div>`;
      }
      html += '</div>';
      html += `<div class="stub-warning" style="margin-top:4px">${geoResult.pixelCount} pixels · confiance ${geoResult.confidence}</div>`;
    }
    return html;
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
