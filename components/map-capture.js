// TERLAB · map-capture.js · Capture des vues Mapbox pré-export
// Capture les vues cartographiques AVANT l'export en dataURL JPEG haute qualité.
// Appelé par export-engine.js au déclenchement de l'export.

const MapCapture = {

  captures: {},

  /**
   * Capture séquentielle de toutes les vues nécessaires aux planches.
   * @param {object} session - SessionManager
   * @returns {Promise<Object>} { viewId: dataUrl }
   */
  async captureAll(session) {
    this.captures = {};
    const map = window.MapViewer?.getMap?.() ?? window.TerlabMap?._map;
    if (!map) return {};

    const terrain = session?.getTerrain?.() ?? {};
    const coords = terrain.lng && terrain.lat ? [terrain.lng, terrain.lat] : [55.536, -21.115];

    const views = [
      { id: 'cover_situation',  center: [55.536, -21.115], zoom: 9,    pitch: 0,  bearing: 0  },
      { id: 'p01_cadastre',     center: coords,            zoom: 17.5, pitch: 0,  bearing: 0  },
      { id: 'p01_situation',    center: coords,            zoom: 14,   pitch: 0,  bearing: 0  },
      { id: 'p01_situation_marked', center: coords,        zoom: 13,   pitch: 0,  bearing: 0  },
      { id: 'p03_ppr',          center: coords,            zoom: 14,   pitch: 45, bearing: 20 },
      { id: 'p05_context3d',    center: coords,            zoom: 16,   pitch: 60, bearing: -30},
    ];

    // Sauvegarder la vue courante pour restaurer après
    const savedCenter  = map.getCenter();
    const savedZoom    = map.getZoom();
    const savedPitch   = map.getPitch();
    const savedBearing = map.getBearing();

    for (const v of views) {
      try {
        this.captures[v.id] = await this._captureView(map, v, coords);
      } catch (e) {
        console.warn(`MapCapture: échec ${v.id}`, e);
        this.captures[v.id] = null;
      }
    }

    // Capturer aussi la vue courante (celle que l'utilisateur voit)
    try {
      map.jumpTo({ center: savedCenter, zoom: savedZoom, pitch: savedPitch, bearing: savedBearing });
      await this._waitIdle(map, 4000);
      this.captures.current_view = map.getCanvas().toDataURL('image/jpeg', 0.92);
    } catch (e) {
      console.warn('MapCapture: restauration vue courante échouée', e);
    }

    return this.captures;
  },

  /**
   * Déplace la carte vers la vue, attend le rendu, capture le canvas.
   * Brûle un marqueur étoile sur les vues à zoom < 17 (parcelle invisible).
   * @param {object} terrainCoords - [lng, lat] du terrain
   */
  _captureView(map, view, terrainCoords) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 8000);

      map.once('idle', () => {
        clearTimeout(timeout);
        try {
          const canvas = map.getCanvas();
          if (view.zoom < 17 && terrainCoords) {
            // Projeter les coordonnées terrain en pixels sur le canvas
            const projected = map.project(terrainCoords);
            const dataUrl = this._burnStarMarker(canvas, projected.x, projected.y);
            resolve(dataUrl);
          } else {
            resolve(canvas.toDataURL('image/jpeg', 0.92));
          }
        } catch (e) { reject(e); }
      });

      map.jumpTo({
        center:  view.center,
        zoom:    view.zoom,
        pitch:   view.pitch  ?? 0,
        bearing: view.bearing ?? 0,
      });
    });
  },

  /**
   * Dessine une étoile 5 branches dorée à la position (px, py) sur le canvas.
   * Adaptée de web-app/mapbox.component.ts — style TERLAB terracotta/or.
   */
  _burnStarMarker(sourceCanvas, px, py) {
    const w = sourceCanvas.width, h = sourceCanvas.height;
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const ctx = tmp.getContext('2d');
    ctx.drawImage(sourceCanvas, 0, 0);

    // Position projetée (pixel ratio Mapbox = 2x)
    const ratio = window.devicePixelRatio ?? 1;
    const cx = (px ?? w / 2) * ratio;
    const cy = (py ?? h / 2) * ratio;

    // Hors canvas → skip
    if (cx < -30 || cx > w + 30 || cy < -30 || cy > h + 30) {
      const dataUrl = tmp.toDataURL('image/jpeg', 0.92);
      tmp.width = 0; tmp.height = 0;
      return dataUrl;
    }

    const spikes = 5, outerR = 28, innerR = 12;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const angle = -Math.PI / 2 + i * Math.PI / spikes;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();

    // Halo
    ctx.shadowColor = 'rgba(193, 101, 43, 0.6)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(221, 200, 154, 0.95)';
    ctx.fill();
    ctx.shadowBlur = 0;

    // Contour terracotta
    ctx.strokeStyle = 'rgba(193, 101, 43, 0.8)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    const dataUrl = tmp.toDataURL('image/jpeg', 0.92);
    tmp.width = 0; tmp.height = 0;
    return dataUrl;
  },

  _waitIdle(map, maxMs = 4000) {
    return new Promise(resolve => {
      const t = setTimeout(resolve, maxMs);
      map.once('idle', () => { clearTimeout(t); resolve(); });
    });
  },
};

export default MapCapture;
