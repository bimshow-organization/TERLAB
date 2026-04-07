// TERLAB · services/cyclones-service.js
// Données cycloniques historiques La Réunion (RSMC)
// + Fallback données statiques principales trajectoires
// ════════════════════════════════════════════════════════════════════

const CyclonesService = {

  // Données statiques des cyclones marquants Réunion (trajectoires simplifiées)
  // Source : RSMC La Réunion / Météo-France
  CYCLONES_HISTORIQUES: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { nom: 'Belal', annee: 2024, categorie: 4, pression_min: 930, vent_max_kmh: 205, note: 'Passage direct nord Réunion — alerte rouge 14/01/2024' },
        geometry: { type: 'LineString', coordinates: [
          [58.5,-19.8],[57.8,-20.1],[57.0,-20.4],[56.2,-20.7],[55.5,-20.9],[54.8,-21.2],[54.0,-21.4],[53.2,-21.5]
        ]}
      },
      {
        type: 'Feature',
        properties: { nom: 'Freddy', annee: 2023, categorie: 5, pression_min: 905, vent_max_kmh: 285, note: 'Cyclone le plus intense de l\'hémisphère Sud' },
        geometry: { type: 'LineString', coordinates: [
          [60.5,-20.5],[59.0,-20.8],[57.5,-21.0],[56.0,-21.2],[54.5,-21.0],[53.0,-20.8],[51.5,-20.5]
        ]}
      },
      {
        type: 'Feature',
        properties: { nom: 'Batsirai', annee: 2022, categorie: 4, pression_min: 935, vent_max_kmh: 195, note: 'Passage à 350km au nord de Réunion' },
        geometry: { type: 'LineString', coordinates: [
          [61.0,-19.5],[60.0,-19.8],[59.0,-20.0],[58.0,-20.2],[57.0,-20.0],[56.0,-19.8],[55.0,-19.5]
        ]}
      },
      {
        type: 'Feature',
        properties: { nom: 'Gamède', annee: 2007, categorie: 4, pression_min: 930, vent_max_kmh: 220, note: 'Record pluviométrie mondiale — 3 929mm en 72h à Commerson' },
        geometry: { type: 'LineString', coordinates: [
          [59.0,-22.0],[58.0,-21.8],[57.0,-21.5],[56.2,-21.2],[55.8,-21.0],[55.5,-20.8],[55.2,-20.5]
        ]}
      },
      {
        type: 'Feature',
        properties: { nom: 'Dina', annee: 2002, categorie: 3, pression_min: 960, vent_max_kmh: 165, note: 'Dégâts majeurs — 12 000 sinistrés' },
        geometry: { type: 'LineString', coordinates: [
          [57.5,-19.5],[56.8,-19.8],[56.0,-20.0],[55.5,-20.2],[55.0,-20.5],[54.5,-20.8]
        ]}
      }
    ]
  },

  // ─── Charger sur carte ────────────────────────────────────────
  loadOnMap(map) {
    if (!map) return;

    const sourceId = 'cyclones-historiques';
    const src = map.getSource(sourceId);
    if (src) { src.setData(this.CYCLONES_HISTORIQUES); return; }

    map.addSource(sourceId, { type: 'geojson', data: this.CYCLONES_HISTORIQUES });

    // Trajectoires
    map.addLayer({
      id: 'cyclones-trajectoire',
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': ['interpolate',['linear'],['get','categorie'],1,'#fbbf24',3,'#f97316',5,'#ef4444'],
        'line-width': ['interpolate',['linear'],['get','categorie'],1,1,5,3],
        'line-opacity': 0.65,
        'line-dasharray': [4,3]
      }
    });

    // Points direction
    map.addLayer({
      id: 'cyclones-direction',
      type: 'symbol',
      source: sourceId,
      layout: { 'symbol-placement': 'line', 'icon-image': 'triangle', 'icon-size': 0.5, 'symbol-spacing': 100 }
    });

    // Popup info
    map.on('click', 'cyclones-trajectoire', (e) => {
      const p = e.features[0]?.properties;
      if (!p) return;
      new mapboxgl.Popup({ closeButton: false, className: 'terlab-popup' })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div class="terlab-popup-title" style="color:#ef4444">🌀 Cyclone ${p.nom} (${p.annee})</div>
          <div class="terlab-popup-row"><span>Catégorie</span><span class="terlab-popup-val">${p.categorie}/5</span></div>
          <div class="terlab-popup-row"><span>Vent max</span><span class="terlab-popup-val">${p.vent_max_kmh} km/h</span></div>
          <div class="terlab-popup-row"><span>Pression</span><span class="terlab-popup-val">${p.pression_min} hPa</span></div>
          <div style="font-size:10px;color:var(--muted);margin-top:5px;font-style:italic">${p.note}</div>
        `)
        .addTo(map);
    });
    map.on('mouseenter','cyclones-trajectoire',()=>map.getCanvas().style.cursor='pointer');
    map.on('mouseleave','cyclones-trajectoire',()=>map.getCanvas().style.cursor='');
  }
};

export default CyclonesService;

// ════════════════════════════════════════════════════════════════════
