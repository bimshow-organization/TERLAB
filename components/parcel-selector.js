// ═══════════════════════════════════════════════════════════════════════
// TERLAB · components/parcel-selector.js
// Porté de GIEP-LA-REUNION/src/components/carte/carte-selection.js
// Multi-sélection parcelles + union Turf + sauvegarde session
// ═══════════════════════════════════════════════════════════════════════

const ParcelSelector = {

  _map:       null,
  _selected:  [],        // [{parcelle, coordinates}]
  _maxP:      5,
  _active:    false,
  _callback:  null,

  // ── Init ──────────────────────────────────────────────────────────
  init(map) {
    this._map = map;
    // Éviter doublons
    window.removeEventListener('terlab:parcelle-click', this._boundClick);
    this._boundClick = this._handleClick.bind(this);
    window.addEventListener('terlab:parcelle-click', this._boundClick);
  },

  destroy() {
    this._selected = [];
    this._active   = false;
    this._clearVisuals();
    window.removeEventListener('terlab:parcelle-click', this._boundClick);
  },

  // ── Démarrer la sélection multiple ────────────────────────────────
  start(callback) {
    this._active   = true;
    this._callback = callback;
    this._selected = [];
    if (this._map) this._map.getCanvas().style.cursor = 'crosshair';
    window.TerlabToast?.show('Cliquez sur les parcelles pour les ajouter. Re-cliquez pour retirer.', 'info', 5000);
    this._showPanel();
    this._updatePanel();
  },

  cancel() {
    this._active = false;
    this._clearVisuals();
    this._hidePanel();
    if (this._map) this._map.getCanvas().style.cursor = '';
    window.TerlabToast?.show('Sélection annulée', 'info');
  },

  // ── Toggle parcelle (clic = add/remove) ───────────────────────────
  _handleClick(e) {
    if (!this._active) return;
    const { parcelle, coordinates } = e.detail ?? {};
    if (!parcelle) return;

    const key = this._parcelKey(parcelle);
    const idx = this._selected.findIndex(p => this._parcelKey(p.parcelle) === key);

    if (idx !== -1) {
      this._selected.splice(idx, 1);
      window.TerlabToast?.show(
        `Parcelle retirée (${this._selected.length}/${this._maxP})`, 'info'
      );
    } else {
      if (this._selected.length >= this._maxP) {
        window.TerlabToast?.show(`Maximum ${this._maxP} parcelles`, 'warning');
        return;
      }
      this._selected.push({ parcelle, coordinates });
      window.TerlabToast?.show(
        `Parcelle ajoutée (${this._selected.length}/${this._maxP})`, 'success'
      );
    }
    this._redrawVisuals();
    this._updatePanel();
  },

  _parcelKey(p) {
    return p.reference
      || `${p.commune ?? ''}${p.section ?? ''}${p.numero ?? ''}`;
  },

  // ── Terminer et fusionner ─────────────────────────────────────────
  async complete() {
    if (!this._selected.length) {
      window.TerlabToast?.show('Aucune parcelle sélectionnée', 'warning');
      return;
    }

    const merged = this._mergeGeometries();
    if (!merged) {
      window.TerlabToast?.show('Fusion géométrique impossible', 'error');
      return;
    }

    const surfTotale = this._selected.reduce(
      (s, i) => s + (i.parcelle.contenance ?? i.parcelle.contenance_m2 ?? 0), 0
    );

    // Calculer dimensions depuis la géométrie fusionnée
    const dims = this._dimensionsFromGeometry(merged);

    // Sauvegarder en session
    const refs = this._selected
      .map(i => `${i.parcelle.section ?? ''}${i.parcelle.numero ?? ''}`)
      .join('+');

    window.SessionManager?.saveTerrain({
      parcelle_geojson:    merged,
      contenance_m2:       Math.round(surfTotale),
      parcelles_multiples: this._selected.map(i => i.parcelle),
      parcelle:            refs,
      longueur:            dims.longueur,
      largeur:             dims.largeur,
    });

    // Visualisation unifiée
    this._drawUnified(merged);
    this._hidePanel();
    this._active = false;
    if (this._map) this._map.getCanvas().style.cursor = '';

    this._callback?.(merged, surfTotale);

    window.dispatchEvent(new CustomEvent('terlab:parcelle-found', {
      detail: { type: 'Feature', geometry: merged, properties: { merged: true, surface: surfTotale } }
    }));

    window.TerlabToast?.show(
      `${this._selected.length} parcelles fusionnées — ${surfTotale.toLocaleString()} m²`, 'success'
    );
  },

  // ── Union Turf ────────────────────────────────────────────────────
  _mergeGeometries() {
    const geoms = this._selected
      .map(i => i.parcelle?.geometry ?? i.parcelle?.parcelle_geojson)
      .filter(g => g?.type === 'Polygon' || g?.type === 'MultiPolygon');

    if (!geoms.length) return null;
    if (geoms.length === 1) return geoms[0];

    // Turf union (v6 ou v7)
    if (window.turf?.union) {
      try {
        const toFeature = g =>
          g.type === 'Polygon'      ? turf.polygon(g.coordinates) :
          g.type === 'MultiPolygon' ? turf.multiPolygon(g.coordinates) : null;

        const features = geoms.map(toFeature).filter(Boolean);
        if (features.length < 2) return geoms[0];

        // turf v7 : union(featureCollection) — v6 : union(a, b)
        let u = features[0];
        for (let i = 1; i < features.length; i++) {
          u = turf.union(u, features[i]);
        }
        if (u?.geometry) return u.geometry;
      } catch (e) {
        console.warn('[ParcelSelector] turf.union failed:', e);
      }
    }

    // Fallback : MultiPolygon empilé
    const all = geoms.flatMap(g =>
      g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    );
    return { type: 'MultiPolygon', coordinates: all };
  },

  // ── Dimensions bbox ───────────────────────────────────────────────
  _dimensionsFromGeometry(geom) {
    const coords = geom.type === 'Polygon'
      ? geom.coordinates[0]
      : geom.coordinates.flatMap(p => p[0]);

    if (!coords?.length) return { longueur: 0, largeur: 0 };

    const lngs = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    const avgLat = (Math.min(...lats) + Math.max(...lats)) / 2;

    const longueur = Math.round(
      (Math.max(...lngs) - Math.min(...lngs)) * 111320 * Math.cos(avgLat * Math.PI / 180)
    );
    const largeur = Math.round(
      (Math.max(...lats) - Math.min(...lats)) * 110540
    );
    return { longueur, largeur };
  },

  // ── Visualisation individuelle (hue par index) ────────────────────
  // Couleurs distinctes par parcelle (contraste fort sur fond gris)
  _PARCEL_COLORS: ['#ff6b35', '#ffc53a', '#51cf66', '#339af0', '#cc5de8'],

  _redrawVisuals() {
    this._clearVisuals();
    this._selected.forEach(({ parcelle }, idx) => {
      const geom = parcelle.geometry ?? parcelle.parcelle_geojson;
      if (!geom) return;
      const color = this._PARCEL_COLORS[idx % this._PARCEL_COLORS.length];
      const sid   = `terlab-sel-${idx}`;

      if (!this._map.getSource(sid)) {
        this._map.addSource(sid, {
          type: 'geojson',
          data: { type: 'Feature', geometry: geom }
        });
      } else {
        this._map.getSource(sid).setData({ type: 'Feature', geometry: geom });
      }
      if (!this._map.getLayer(`${sid}-fill`)) {
        this._map.addLayer({
          id: `${sid}-fill`, type: 'fill', source: sid,
          paint: { 'fill-color': color, 'fill-opacity': 0.35 }
        });
      }
      // Contour principal épais
      if (!this._map.getLayer(`${sid}-line`)) {
        this._map.addLayer({
          id: `${sid}-line`, type: 'line', source: sid,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': color, 'line-width': 4 }
        });
      }
      // Contour blanc intérieur pour lisibilité
      if (!this._map.getLayer(`${sid}-line-inner`)) {
        this._map.addLayer({
          id: `${sid}-line-inner`, type: 'line', source: sid,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-dasharray': [4, 3] }
        });
      }
    });
  },

  _drawUnified(geometry) {
    const sid  = 'terlab-unified-parcelles';
    const data = { type: 'Feature', geometry };
    if (!this._map.getSource(sid)) {
      this._map.addSource(sid, { type: 'geojson', data });
      // Halo extérieur
      this._map.addLayer({
        id: 'terlab-unified-halo', type: 'line', source: sid,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#00d4ff', 'line-width': 8, 'line-opacity': 0.3 }
      });
      this._map.addLayer({
        id: 'terlab-unified-fill', type: 'fill', source: sid,
        paint: { 'fill-color': '#00d4ff', 'fill-opacity': 0.2 }
      });
      this._map.addLayer({
        id: 'terlab-unified-line', type: 'line', source: sid,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#00d4ff', 'line-width': 3 }
      });
    } else {
      this._map.getSource(sid).setData(data);
    }
  },

  _clearVisuals() {
    if (!this._map) return;
    const style = this._map.getStyle();
    if (!style) return;
    const layers = style.layers ?? [];
    layers
      .filter(l => l.id.startsWith('terlab-sel-') || l.id.startsWith('terlab-unified-'))
      .forEach(l => { try { this._map.removeLayer(l.id); } catch {} });
    try { this._map.removeSource('terlab-unified-parcelles'); } catch {}
    for (let i = 0; i < this._maxP; i++) {
      try { this._map.removeSource(`terlab-sel-${i}`); } catch {}
    }
  },

  // ── Panel UI ──────────────────────────────────────────────────────
  _showPanel() {
    document.getElementById('terlab-multiselect-panel')?.removeAttribute('hidden');
  },
  _hidePanel() {
    document.getElementById('terlab-multiselect-panel')?.setAttribute('hidden', '');
  },
  _updatePanel() {
    const el = document.getElementById('terlab-sel-count');
    if (el) el.textContent = `${this._selected.length}/${this._maxP}`;

    const list = document.getElementById('terlab-sel-list');
    if (!list) return;
    list.innerHTML = this._selected.map((item, idx) => {
      const p = item.parcelle;
      const ref = `${p.section ?? ''}${p.numero ?? ''}`;
      const surf = (p.contenance ?? p.contenance_m2 ?? 0).toLocaleString();
      const dot  = this._PARCEL_COLORS[idx % this._PARCEL_COLORS.length];
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:11px">
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${dot};margin-right:5px;vertical-align:middle"></span>${idx + 1}. ${ref} — ${surf} m²</span>
        <button onclick="window.ParcelSelector._removeAt(${idx})"
                style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px;padding:0 4px">×</button>
      </div>`;
    }).join('');
  },

  _removeAt(idx) {
    this._selected.splice(idx, 1);
    this._redrawVisuals();
    this._updatePanel();
  },

  // ── État public ───────────────────────────────────────────────────
  isActive()    { return this._active; },
  getSelected() { return [...this._selected]; },
  setMax(n)     { this._maxP = n; },
};

export default ParcelSelector;
