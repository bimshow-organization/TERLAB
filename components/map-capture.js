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
        this.captures[v.id] = await this._captureView(map, v);
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
   */
  _captureView(map, view) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 8000);

      map.once('idle', () => {
        clearTimeout(timeout);
        try {
          const dataUrl = map.getCanvas().toDataURL('image/jpeg', 0.92);
          resolve(dataUrl);
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

  _waitIdle(map, maxMs = 4000) {
    return new Promise(resolve => {
      const t = setTimeout(resolve, maxMs);
      map.once('idle', () => { clearTimeout(t); resolve(); });
    });
  },
};

export default MapCapture;
