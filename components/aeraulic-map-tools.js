/**
 * TERLAB · AeraulicMapTools · v1.0
 * Outils aérauliques sur fond Mapbox.
 *
 * API publique :
 *   AeraulicMapTools.initRbTool(map, onResult)
 *   AeraulicMapTools.destroyRbTool()
 *   AeraulicMapTools.addCtpOverlay(map, profilePoints, windDir)
 *   AeraulicMapTools.removeCtpOverlay(map)
 */

const AeraulicMapTools = {

  _clickHandler: null,
  _cursorSaved:  null,

  /**
   * Active l'outil de calcul Rb sur clic de rue dans Mapbox.
   * @param {mapboxgl.Map} map
   * @param {Function} onResult
   */
  initRbTool(map, onResult) {
    if (!map) return;
    const MU = window.TerlabMU;
    this._cursorSaved = map.getCanvas().style.cursor;
    map.getCanvas().style.cursor = 'crosshair';

    this._clickHandler = (e) => {
      const pt = e.point;

      // D3 : couche réelle = 'buildings-3d' (map-viewer.js)
      const BUILDING_LAYERS = [
        'buildings-3d',
      ].filter(l => { try { return !!map.getLayer(l); } catch { return false; } });

      if (!BUILDING_LAYERS.length) {
        // ⚠️ STUB — Couche bâtiments non trouvée — effort XS : vérifier nom couche
        window.TerlabToast?.show('Couche bâtiments non détectée — zoomez > 15', 'warning', 4000);
        return;
      }

      const bbox = [[pt.x - 40, pt.y - 40], [pt.x + 40, pt.y + 40]];
      const features = map.queryRenderedFeatures(bbox, { layers: BUILDING_LAYERS });

      if (features.length < 2) {
        window.TerlabToast?.show('Cliquez sur une rue entre deux bâtiments', 'info', 3000);
        return;
      }

      const heights = features.map(f =>
        +(f.properties?.height ?? f.properties?.render_height ?? f.properties?.building_height ?? 8)
      ).filter(h => h > 0);
      const H = heights.length ? heights.reduce((a,b)=>a+b,0)/heights.length : 8;

      const clickLng = e.lngLat.lng, clickLat = e.lngLat.lat;
      const latM = 111000;
      const lngM = 111000 * Math.cos(clickLat * Math.PI / 180);

      const centroids = features.map(f => {
        const coords = f.geometry?.coordinates;
        if (!coords) return null;
        const lngs = coords.flat(3).filter((_, i) => i % 2 === 0);
        const lats = coords.flat(3).filter((_, i) => i % 2 === 1);
        if (!lngs.length || !lats.length) return null;
        return {
          lng: lngs.reduce((a,b)=>a+b,0)/lngs.length,
          lat: lats.reduce((a,b)=>a+b,0)/lats.length,
        };
      }).filter(Boolean);

      let W = 8;
      if (centroids.length >= 2) {
        const dists = centroids.map(c => ({
          c,
          d: Math.hypot((c.lng - clickLng)*lngM, (c.lat - clickLat)*latM)
        })).sort((a,b) => a.d - b.d);
        const c0 = dists[0].c, c1 = dists[1].c;
        W = Math.hypot((c0.lng - c1.lng)*lngM, (c0.lat - c1.lat)*latM);
        W = Math.max(2, Math.min(W, 50));
      }

      const L  = W * 1.5; // ⚠️ STUB estimation — effort XS : mesure réelle du profil bâti
      const Rb = MU.blockageRatio(W, H, L);
      const Vrel = MU.streetVelocity(Rb);
      const { C, label: cLabel, ok } = MU.ventilationC(Vrel, 1.0);

      const color = ok ? '#2a7040' : Rb < 0.4 ? '#b05800' : '#8a2020';

      const popupHTML = `
        <div style="font-family:Inconsolata,monospace;font-size:.72rem;min-width:180px">
          <div style="font-weight:bold;color:#1c5fa8;margin-bottom:6px;font-size:.8rem">
            Calcul Rb — Rue canyon
          </div>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="color:#666">W (largeur rue)</td><td style="font-weight:bold">${W.toFixed(1)} m</td></tr>
            <tr><td style="color:#666">H (hauteur bât.)</td><td style="font-weight:bold">${H.toFixed(1)} m</td></tr>
            <tr><td style="color:#666">L (profondeur)</td><td style="font-weight:bold">${L.toFixed(1)} m <span style="color:#b05800;font-size:.6rem">estimé</span></td></tr>
            <tr style="border-top:1px solid #ddd"><td style="color:#666">Rb</td><td style="font-weight:bold">${Rb.toFixed(3)}</td></tr>
            <tr><td style="color:#666">V rue / V libre</td><td style="font-weight:bold">${(Vrel*100).toFixed(0)}%</td></tr>
            <tr><td style="color:#666">Indicateur C</td>
                <td style="font-weight:bold;color:${color}">${C.toFixed(2)} — ${cLabel}</td></tr>
          </table>
          <div style="margin-top:6px;font-size:.6rem;color:#888">
            D'après abaque CSTB · Rb=(W×H)/(W+L)²
          </div>
        </div>`;

      new mapboxgl.Popup({ closeButton: true, maxWidth: '220px' })
        .setLngLat(e.lngLat)
        .setHTML(popupHTML)
        .addTo(map);

      onResult?.({ W, H, L, Rb, Vrel, C, cLabel, ok, lngLat: e.lngLat });
    };

    map.on('click', this._clickHandler);
  },

  destroyRbTool(map) {
    if (!map || !this._clickHandler) return;
    map.off('click', this._clickHandler);
    this._clickHandler = null;
    if (this._cursorSaved !== null) {
      map.getCanvas().style.cursor = this._cursorSaved;
      this._cursorSaved = null;
    }
  },

  /**
   * Ajoute un overlay heatmap C_TP sur la carte Mapbox.
   * ⚠️ STUB PARTIEL — C_TP estimé depuis altitude Mapbox uniquement.
   */
  addCtpOverlay(map, profilePoints = [], windDir = 105) {
    if (!map) return;
    const MU      = window.TerlabMU;
    const terrain = window.SessionManager?.getTerrain?.() ?? {};
    const lat0    = terrain.lat  ?? -21.0;
    const lng0    = terrain.lng  ?? 55.4;
    const step    = 0.002;
    const ext     = 0.04;

    const features = [];
    for (let dlat = -ext; dlat <= ext; dlat += step) {
      for (let dlng = -ext; dlng <= ext; dlng += step) {
        const lat = lat0 + dlat;
        const lng = lng0 + dlng;

        const alt = map.queryTerrainElevation?.([lng, lat]) ?? null;

        let siteType = 'plaine';
        if (alt !== null) {
          if (alt > 1200)     siteType = 'ouvert';
          else if (alt > 600) siteType = 'entre_collines';
          else if (alt < 0)   siteType = 'vallee';
        }

        const { ctp } = MU.cTP(siteType);
        const t = (ctp - 0.3) / (1.3 - 0.3);
        const [r, g, b] = MU.cpToRGB(ctp - 0.65, [-0.65, 0.65]);

        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lng, lat] },
          properties: {
            ctp,
            color: MU.rgbToCss([r, g, b], 0.55),
            radius: 8,
          },
        });
      }
    }

    const geojson = { type: 'FeatureCollection', features };

    this.removeCtpOverlay(map);

    map.addSource('ctp-overlay', { type: 'geojson', data: geojson });
    map.addLayer({
      id: 'ctp-overlay-layer',
      type: 'circle',
      source: 'ctp-overlay',
      paint: {
        'circle-radius': 6,
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.55,
        'circle-blur': 0.5,
      },
    });
  },

  removeCtpOverlay(map) {
    if (!map) return;
    if (map.getLayer('ctp-overlay-layer'))  map.removeLayer('ctp-overlay-layer');
    if (map.getSource('ctp-overlay'))       map.removeSource('ctp-overlay');
  },
};

export default AeraulicMapTools;
