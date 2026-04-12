// TERLAB · components/section-profile-viewer.js
// Coupes A (longitudinale) / B (perpendiculaire) — SVG interactif avec zoom,
// annotations routes, limites terrain, intersection coupe, labels paysagistes
// ENSA La Réunion · MGA Architecture
// ════════════════════════════════════════════════════════════════════

const SECTION_COLORS = {
  A: { line: '#E8811A', fill: 'rgba(232,129,26,0.12)', label: '#E8811A' },
  B: { line: '#4A90D9', fill: 'rgba(74,144,217,0.12)', label: '#4A90D9' },
};

// Couleurs scatter par classe LiDAR (hex pour SVG)
const SCATTER_CLASS_COLORS = {
  2: '#b8860b',  // sol — brun
  3: '#90ee90',  // veg basse — vert clair
  4: '#32cd32',  // veg moyenne — vert
  5: '#006400',  // veg haute — vert fonce
  6: '#ff4444',  // batiments — rouge
  9: '#4488ff',  // eau — bleu
  0: '#888888',  // non classe — gris
};

const VIEWER_DEFAULTS = {
  width: 720,
  height: 220,
  margin: { top: 28, right: 24, bottom: 40, left: 52 },
  verticalExaggeration: 2.0,
  smoothing: true,
};

const SectionProfileViewer = {

  // ── State ──────────────────────────────────────────────────────
  _viewers: {},   // { A: { el, data, annotations, zoomLevel, panX }, B: {...} }
  _splitActive: false,
  _activeSection: null,

  // ── Compute section axes from parcelle + orientation ───────────
  computeSectionAxes(parcelleGeojson, orientation, center) {
    if (!parcelleGeojson || !center) return null;

    const feature = { type: 'Feature', geometry: parcelleGeojson, properties: {} };
    const bbox = turf.bbox(feature);
    const [w, s, e, n] = bbox;

    // Diagonal extent for section length (with 15% margin)
    const diagKm = turf.distance([w, s], [e, n], { units: 'kilometers' });
    const halfLen = (diagKm * 0.65); // slightly larger than half-diagonal

    // Orientation to bearing (degrees from north, clockwise)
    const orientMap = {
      'N': 0, 'NE': 45, 'E': 90, 'SE': 135,
      'S': 180, 'SO': 225, 'O': 270, 'NO': 315,
      'Nord': 0, 'Nord-Est': 45, 'Est': 90, 'Sud-Est': 135,
      'Sud': 180, 'Sud-Ouest': 225, 'Ouest': 270, 'Nord-Ouest': 315,
    };
    const bearing = orientMap[orientation] ?? 0;

    // Coupe A: along slope direction (bearing = downhill direction)
    const centerPt = turf.point(center);
    const aStart = turf.destination(centerPt, halfLen, bearing + 180, { units: 'kilometers' });
    const aEnd   = turf.destination(centerPt, halfLen, bearing, { units: 'kilometers' });

    // Coupe B: perpendicular (bearing + 90°)
    const bStart = turf.destination(centerPt, halfLen, bearing + 90 + 180, { units: 'kilometers' });
    const bEnd   = turf.destination(centerPt, halfLen, bearing + 90, { units: 'kilometers' });

    return {
      A: { start: aStart.geometry.coordinates, end: aEnd.geometry.coordinates, bearing },
      B: { start: bStart.geometry.coordinates, end: bEnd.geometry.coordinates, bearing: (bearing + 90) % 360 },
      center,
    };
  },

  // ── Extract profile data (LiDAR or IGN fallback) ──────────────
  async extractProfile(axis, lidarPoints) {
    const { start, end } = axis;
    const LidarService = window.LidarService;
    const IGN = window.IGNElevationService;

    // Try LiDAR first
    if (lidarPoints?.length && LidarService?.getProfileFromPoints) {
      const profile = LidarService.getProfileFromPoints(lidarPoints, start, end, 8);
      if (profile.length >= 3) {
        return { data: profile, source: 'lidar_hd' };
      }
    }

    // Fallback: IGN API
    if (IGN?.getProfile) {
      const profile = await IGN.getProfile(start[0], start[1], end[0], end[1], 40);
      if (profile?.length >= 3) {
        return { data: profile, source: 'ign_api' };
      }
    }

    // Last fallback: Mapbox DEM
    const map = window.TerlabMap?.getMap();
    if (map?.queryTerrainElevation) {
      const line = turf.lineString([start, end]);
      const len  = turf.length(line, { units: 'kilometers' });
      const steps = 40;
      const profile = [];
      for (let i = 0; i < steps; i++) {
        const pt = turf.along(line, (i / (steps - 1)) * len, { units: 'kilometers' });
        const [lng, lat] = pt.geometry.coordinates;
        const elev = map.queryTerrainElevation([lng, lat]) ?? 0;
        profile.push({
          distance_m: Math.round(i * len * 1000 / (steps - 1)),
          altitude_m: Math.round(elev * 100) / 100,
        });
      }
      if (profile.length >= 3) return { data: profile, source: 'mapbox_dem' };
    }

    return { data: [], source: null };
  },

  // ── Find road intersections along a section line ──────────────
  findRoadIntersections(sectionStart, sectionEnd, map) {
    if (!map) return [];
    const intersections = [];

    // Query Mapbox road labels visible on the map
    const roadLayers = map.getStyle()?.layers?.filter(l =>
      l.id.includes('road') && (l.type === 'line' || l.type === 'symbol')
    ).map(l => l.id) ?? [];

    if (!roadLayers.length) return [];

    // Sample points along the section line and check road features nearby
    const line = turf.lineString([sectionStart, sectionEnd]);
    const len = turf.length(line, { units: 'kilometers' });
    const totalDistM = len * 1000;
    const steps = 60;

    const seen = new Set();

    for (let i = 0; i < steps; i++) {
      const fraction = i / (steps - 1);
      const pt = turf.along(line, fraction * len, { units: 'kilometers' });
      const [lng, lat] = pt.geometry.coordinates;
      const screenPt = map.project([lng, lat]);

      // Query features in a 15px radius
      const features = map.queryRenderedFeatures(
        [[screenPt.x - 15, screenPt.y - 15], [screenPt.x + 15, screenPt.y + 15]],
        { layers: roadLayers.slice(0, 10) }
      );

      for (const f of features) {
        const name = f.properties?.name || f.properties?.name_fr || f.properties?.name_en;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        intersections.push({
          name,
          distance_m: Math.round(fraction * totalDistM),
          type: 'road',
          lngLat: [lng, lat],
        });
      }
    }

    return intersections;
  },

  // ── Find parcel boundary crossings along a section line ───────
  findParcelBoundaryIntersections(sectionStart, sectionEnd, parcelleGeojson) {
    if (!parcelleGeojson) return [];

    const sectionLine = turf.lineString([sectionStart, sectionEnd]);
    const totalLen = turf.length(sectionLine, { units: 'kilometers' }) * 1000;

    // Get parcel boundary as LineString
    const coords = parcelleGeojson.type === 'Polygon'
      ? parcelleGeojson.coordinates[0]
      : parcelleGeojson.type === 'MultiPolygon'
        ? parcelleGeojson.coordinates[0][0]
        : null;
    if (!coords) return [];

    const boundary = turf.lineString(coords);
    const crossings = [];

    // Check intersection with turf
    try {
      const intersections = turf.lineIntersect(sectionLine, boundary);
      if (intersections?.features) {
        for (const pt of intersections.features) {
          const [lng, lat] = pt.geometry.coordinates;
          // Compute distance along section
          const sliced = turf.lineSlice(turf.point(sectionStart), pt, sectionLine);
          const dist = turf.length(sliced, { units: 'kilometers' }) * 1000;
          crossings.push({
            name: 'Limite parcelle',
            distance_m: Math.round(dist),
            type: 'boundary',
            lngLat: [lng, lat],
          });
        }
      }
    } catch (e) { /* turf intersection can fail on degenerate geometries */ }

    return crossings;
  },

  // ── Find where Coupe A and B cross ────────────────────────────
  findSectionCrossing(axisA, axisB) {
    if (!axisA || !axisB) return null;
    try {
      const lineA = turf.lineString([axisA.start, axisA.end]);
      const lineB = turf.lineString([axisB.start, axisB.end]);
      const cross = turf.lineIntersect(lineA, lineB);
      if (!cross?.features?.length) return null;

      const [lng, lat] = cross.features[0].geometry.coordinates;
      const lenA = turf.length(lineA, { units: 'kilometers' }) * 1000;
      const lenB = turf.length(lineB, { units: 'kilometers' }) * 1000;

      const sliceA = turf.lineSlice(turf.point(axisA.start), cross.features[0], lineA);
      const sliceB = turf.lineSlice(turf.point(axisB.start), cross.features[0], lineB);

      return {
        lngLat: [lng, lat],
        distA_m: Math.round(turf.length(sliceA, { units: 'kilometers' }) * 1000),
        distB_m: Math.round(turf.length(sliceB, { units: 'kilometers' }) * 1000),
      };
    } catch { return null; }
  },

  // ── Render interactive SVG profile ────────────────────────────
  render(sectionId, container, profileData, annotations, options = {}) {
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el || !profileData?.length) return null;

    const colors = SECTION_COLORS[sectionId] || SECTION_COLORS.A;
    const cfg = { ...VIEWER_DEFAULTS, ...options };
    const W = cfg.width, H = cfg.height;
    const m = cfg.margin;
    const cW = W - m.left - m.right;
    const cH = H - m.top - m.bottom;

    // Store viewer state
    if (!this._viewers[sectionId]) {
      this._viewers[sectionId] = { zoomLevel: 1, panX: 0 };
    }
    const state = this._viewers[sectionId];
    // Defensive: si le state a été pré-créé ailleurs (ex: pour stocker `source`
    // avant render), zoomLevel/panX peuvent être absents → NaN partout dans sx/sy.
    if (!Number.isFinite(state.zoomLevel)) state.zoomLevel = 1;
    if (!Number.isFinite(state.panX)) state.panX = 0;
    state.data = profileData;
    state.annotations = annotations || [];
    state.scatter = options.scatter ?? state.scatter ?? null;
    state.el = el;
    state.colors = colors;
    state.cfg = cfg;

    this._renderSVG(sectionId);
    return el;
  },

  // ── Injecter/mettre a jour le scatter LiDAR d'une coupe ───────
  setScatter(sectionId, scatter) {
    const state = this._viewers[sectionId];
    if (!state) return;
    state.scatter = scatter;
    this._renderSVG(sectionId);
  },

  _renderSVG(sectionId) {
    const state = this._viewers[sectionId];
    if (!state?.data?.length) return;

    const { data, annotations, el, colors, cfg, zoomLevel, panX } = state;
    const W = cfg.width, H = cfg.height;
    const m = cfg.margin;
    const cW = W - m.left - m.right;
    const cH = H - m.top - m.bottom;

    // Data ranges (filtrer NaN et null)
    const dists = data.map(p => p.distance_m).filter(Number.isFinite);
    const alts  = data.map(p => p.altitude_m).filter(Number.isFinite);
    if (!alts.length || !dists.length) {
      el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="var(--card, #1a1814)" rx="4"/><text x="${W/2}" y="${H/2}" text-anchor="middle" fill="#8b7355" font-size="10">Pas de données altimétriques</text></svg>`;
      return;
    }
    const minD = Math.min(...dists), maxD = Math.max(...dists);
    let minA = Math.min(...alts),  maxA = Math.max(...alts);

    // Elargir les bornes altitude si scatter LiDAR present (vegetation, batiments = plus haut)
    if (state.scatter?.length) {
      for (const pt of state.scatter) {
        if (pt.z < minA) minA = pt.z;
        if (pt.z > maxA) maxA = pt.z;
      }
    }
    const range = (maxA - minA) * cfg.verticalExaggeration;
    const pad = Math.max(range * 0.15, 0.5);
    const dMinA = minA - pad, dMaxA = maxA + pad;

    // Zoom + pan transforms
    const visMinD = minD + panX;
    const visMaxD = minD + (maxD - minD) / zoomLevel + panX;

    const sx = d => m.left + ((d - visMinD) / (visMaxD - visMinD || 1)) * cW;
    const sy = a => m.top + cH - ((a - dMinA) / (dMaxA - dMinA || 1)) * cH;

    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${W} ${H}" class="section-profile-svg" style="font-family:monospace;user-select:none">`);

    // Background
    parts.push(`<rect width="${W}" height="${H}" fill="var(--card, #1a1814)" rx="4"/>`);

    // Clip area
    parts.push(`<defs><clipPath id="clip-${sectionId}"><rect x="${m.left}" y="${m.top}" width="${cW}" height="${cH}"/></clipPath></defs>`);

    // Grid
    const altStep = this._niceStep(dMaxA - dMinA, 3, 6);
    const distStep = this._niceStep(visMaxD - visMinD, 4, 8);

    for (let a = Math.ceil(dMinA / altStep) * altStep; a <= dMaxA; a += altStep) {
      const y = sy(a);
      parts.push(`<line x1="${m.left}" y1="${y}" x2="${m.left + cW}" y2="${y}" stroke="rgba(154,120,32,0.15)" stroke-dasharray="3,3"/>`);
      parts.push(`<text x="${m.left - 6}" y="${y + 3}" text-anchor="end" font-size="8" fill="#a89060">${a.toFixed(1)}m</text>`);
    }
    for (let d = Math.ceil(visMinD / distStep) * distStep; d <= visMaxD; d += distStep) {
      const x = sx(d);
      if (x < m.left || x > m.left + cW) continue;
      parts.push(`<line x1="${x}" y1="${m.top}" x2="${x}" y2="${m.top + cH}" stroke="rgba(154,120,32,0.12)" stroke-dasharray="3,3"/>`);
      parts.push(`<text x="${x}" y="${m.top + cH + 12}" text-anchor="middle" font-size="8" fill="#a89060">${Math.round(d)}m</text>`);
    }

    // Axis labels
    parts.push(`<text x="${W / 2}" y="${H - 4}" text-anchor="middle" font-size="9" fill="#6b5c3e">Distance (m)</text>`);
    parts.push(`<text x="10" y="${H / 2}" text-anchor="middle" font-size="9" fill="#6b5c3e" transform="rotate(-90,10,${H / 2})">Alt (m)</text>`);

    // Section label badge
    parts.push(`<rect x="${m.left + 4}" y="${m.top + 4}" width="60" height="16" rx="3" fill="${colors.line}22"/>`);
    parts.push(`<text x="${m.left + 34}" y="${m.top + 15}" text-anchor="middle" font-size="9" font-weight="bold" fill="${colors.line}">Coupe ${sectionId}</text>`);

    // Source badge
    const source = state.source || '';
    if (source) {
      const srcLabel = source === 'lidar_hd' ? 'LiDAR HD' : source === 'ign_api' ? 'IGN API' : 'DEM';
      parts.push(`<text x="${W - m.right}" y="${m.top + 14}" text-anchor="end" font-size="7.5" fill="#8b7355">${srcLabel}</text>`);
    }

    // ── Scatter LiDAR background (clipped) ──────────────────────
    parts.push(`<g clip-path="url(#clip-${sectionId})">`);

    if (state.scatter?.length) {
      // Decimer si trop de points pour le SVG (>5000 = lent)
      let scPts = state.scatter;
      if (scPts.length > 5000) {
        const step = scPts.length / 5000;
        const decimated = [];
        for (let i = 0; i < scPts.length; i += step) decimated.push(scPts[Math.floor(i)]);
        scPts = decimated;
      }

      const corridorW = state.corridorWidth ?? 8;
      for (const pt of scPts) {
        const x = sx(pt.d);
        const y = sy(pt.z);
        if (x < m.left - 2 || x > m.left + cW + 2) continue;
        if (y < m.top - 2 || y > m.top + cH + 2) continue;

        const color = SCATTER_CLASS_COLORS[pt.cls] ?? SCATTER_CLASS_COLORS[0];
        // Opacite decroit avec la distance perpendiculaire (plus proche = plus opaque)
        const alpha = Math.max(0.15, 1.0 - (pt.perp / corridorW) * 0.7);
        const r = pt.cls === 2 ? 1.0 : 1.3; // sol = plus petit, vegetation/bati = plus gros
        parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${color}" opacity="${alpha.toFixed(2)}"/>`);
      }
    }

    // ── Terrain profile path ──────────────────────────────────────
    const validData = data.filter(p => Number.isFinite(p.altitude_m) && Number.isFinite(p.distance_m));
    const pathD = this._buildPath(validData, sx, sy, cfg.smoothing);

    if (pathD) {
      const lastX = sx(validData[validData.length - 1].distance_m);
      const firstX = sx(validData[0].distance_m);
      const bottomY = m.top + cH;
      parts.push(`<path d="${pathD} L${lastX.toFixed(1)},${bottomY} L${firstX.toFixed(1)},${bottomY} Z" fill="${colors.fill}"/>`);
      parts.push(`<path d="${pathD}" fill="none" stroke="${colors.line}" stroke-width="2" stroke-linejoin="round"/>`);
    }

    // Annotations: road intersections, boundaries, section crossing
    for (const ann of (annotations || [])) {
      const x = sx(ann.distance_m);
      if (x < m.left || x > m.left + cW) continue;

      if (ann.type === 'road') {
        // Vertical dashed line + label
        parts.push(`<line x1="${x}" y1="${m.top}" x2="${x}" y2="${m.top + cH}" stroke="#f59e0b" stroke-width="1" stroke-dasharray="4,3" opacity="0.7"/>`);
        parts.push(`<text x="${x}" y="${m.top - 4}" text-anchor="middle" font-size="7" fill="#f59e0b" font-weight="600">${this._escapeXml(ann.name)}</text>`);
      } else if (ann.type === 'boundary') {
        // Solid vertical red line
        parts.push(`<line x1="${x}" y1="${m.top}" x2="${x}" y2="${m.top + cH}" stroke="#ff4444" stroke-width="1.5" opacity="0.6"/>`);
        parts.push(`<text x="${x + 3}" y="${m.top + 12}" text-anchor="start" font-size="6.5" fill="#ff4444">${this._escapeXml(ann.name)}</text>`);
      } else if (ann.type === 'section_cross') {
        // Blue diamond for crossing point
        const alt = this._interpolateAlt(data, ann.distance_m);
        const y = alt != null ? sy(alt) : m.top + cH / 2;
        parts.push(`<line x1="${x}" y1="${m.top}" x2="${x}" y2="${m.top + cH}" stroke="#00d4ff" stroke-width="1" stroke-dasharray="2,4" opacity="0.5"/>`);
        parts.push(`<polygon points="${x},${y - 5} ${x + 4},${y} ${x},${y + 5} ${x - 4},${y}" fill="#00d4ff" opacity="0.8"/>`);
        parts.push(`<text x="${x + 6}" y="${y + 3}" font-size="7" fill="#00d4ff" font-weight="600">${ann.name}</text>`);
      } else if (ann.type === 'landscape') {
        // Green annotation for vegetation / landscape feature
        parts.push(`<line x1="${x}" y1="${m.top}" x2="${x}" y2="${m.top + cH}" stroke="#32cd32" stroke-width="0.8" stroke-dasharray="2,3" opacity="0.5"/>`);
        parts.push(`<text x="${x}" y="${m.top + cH + 24}" text-anchor="middle" font-size="6.5" fill="#32cd32">${this._escapeXml(ann.name)}</text>`);
      }
    }

    // Key elevation points
    const keyPts = this._keyPoints(validData, 6);
    for (const idx of keyPts) {
      const p = validData[idx];
      const x = sx(p.distance_m), y = sy(p.altitude_m);
      if (x < m.left || x > m.left + cW) continue;
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="#00d4ff"/>`);
      parts.push(`<text x="${x.toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#a89060">${p.altitude_m.toFixed(1)}m</text>`);
    }

    parts.push('</g>'); // close clip

    // Stats badge
    const denivele = Math.round(maxA - minA);
    const pente = maxD > 0 ? ((maxA - minA) / (maxD - minD) * 100).toFixed(1) : '0';
    const lenM = Math.round(maxD);
    parts.push(`<text x="${W - m.right}" y="${m.top - 6}" text-anchor="end" font-size="8" fill="#6b5c3e">${lenM}m · Δ${denivele}m · ${pente}%</text>`);

    // Zoom indicator
    if (zoomLevel > 1) {
      parts.push(`<text x="${W - m.right - 2}" y="${H - 4}" text-anchor="end" font-size="7.5" fill="#8b7355">×${zoomLevel.toFixed(1)}</text>`);
    }

    parts.push('</svg>');
    el.innerHTML = parts.join('');

    // Attach zoom/pan event listeners
    this._attachInteraction(sectionId);
  },

  // ── Zoom / Pan interaction ────────────────────────────────────
  _attachInteraction(sectionId) {
    const state = this._viewers[sectionId];
    if (!state?.el) return;
    const svg = state.el.querySelector('svg');
    if (!svg) return;

    // Remove old listeners
    if (state._wheelHandler) svg.removeEventListener('wheel', state._wheelHandler);
    if (state._pointerDown) svg.removeEventListener('pointerdown', state._pointerDown);

    // Wheel zoom
    state._wheelHandler = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.2 : 0.2;
      state.zoomLevel = Math.max(1, Math.min(10, state.zoomLevel + delta));
      // Clamp pan
      const dists = state.data.map(p => p.distance_m);
      const maxD = Math.max(...dists), minD = Math.min(...dists);
      const visRange = (maxD - minD) / state.zoomLevel;
      state.panX = Math.max(0, Math.min(maxD - minD - visRange, state.panX));
      this._renderSVG(sectionId);
    };
    svg.addEventListener('wheel', state._wheelHandler, { passive: false });

    // Drag pan
    let dragging = false, dragStartX = 0, dragStartPan = 0;
    state._pointerDown = (e) => {
      dragging = true;
      dragStartX = e.clientX;
      dragStartPan = state.panX;
      svg.setPointerCapture(e.pointerId);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dists = state.data.map(p => p.distance_m);
      const maxD = Math.max(...dists), minD = Math.min(...dists);
      const cW = state.cfg.width - state.cfg.margin.left - state.cfg.margin.right;
      const pixelsPerMeter = cW / ((maxD - minD) / state.zoomLevel);
      const dxPixels = dragStartX - e.clientX;
      const dxMeters = dxPixels / pixelsPerMeter * (svg.getBoundingClientRect().width > 0 ? state.cfg.width / svg.getBoundingClientRect().width : 1);
      const visRange = (maxD - minD) / state.zoomLevel;
      state.panX = Math.max(0, Math.min(maxD - minD - visRange, dragStartPan + dxMeters));
      this._renderSVG(sectionId);
    };
    const onUp = () => { dragging = false; };

    svg.addEventListener('pointerdown', state._pointerDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);

    // Store for cleanup
    state._moveHandler = onMove;
    state._upHandler = onUp;
  },

  // ── Zoom controls (called from buttons) ───────────────────────
  zoomIn(sectionId) {
    const state = this._viewers[sectionId];
    if (!state) return;
    state.zoomLevel = Math.min(10, state.zoomLevel + 0.5);
    this._renderSVG(sectionId);
  },

  zoomOut(sectionId) {
    const state = this._viewers[sectionId];
    if (!state) return;
    state.zoomLevel = Math.max(1, state.zoomLevel - 0.5);
    // Clamp pan
    const dists = state.data.map(p => p.distance_m);
    const maxD = Math.max(...dists), minD = Math.min(...dists);
    const visRange = (maxD - minD) / state.zoomLevel;
    state.panX = Math.max(0, Math.min(maxD - minD - visRange, state.panX));
    this._renderSVG(sectionId);
  },

  resetZoom(sectionId) {
    const state = this._viewers[sectionId];
    if (!state) return;
    state.zoomLevel = 1;
    state.panX = 0;
    this._renderSVG(sectionId);
  },

  // ── Split screen toggle ───────────────────────────────────────
  toggleSplitScreen(sectionId) {
    const wrap = document.getElementById('section-split-wrap');
    if (!wrap) return;

    if (this._splitActive && this._activeSection === sectionId) {
      // Close split
      wrap.classList.remove('split-active');
      this._splitActive = false;
      this._activeSection = null;
      // Emit event
      window.dispatchEvent(new CustomEvent('terlab:section-split', { detail: { active: false } }));
    } else {
      // Open split for this section
      wrap.classList.add('split-active');
      this._splitActive = true;
      this._activeSection = sectionId;

      // Move viewer into the split panel
      const panel = document.getElementById('section-split-profile');
      const viewer = document.getElementById(`section-viewer-${sectionId}`);
      if (panel && viewer) {
        panel.innerHTML = '';
        panel.appendChild(viewer.cloneNode(false));
        // Re-render at larger size
        const clone = panel.firstChild;
        clone.id = `section-split-viewer-${sectionId}`;
        const state = this._viewers[sectionId];
        if (state) {
          const splitCfg = { ...state.cfg, width: 900, height: 280 };
          this._viewers[`${sectionId}_split`] = { ...state, el: clone, cfg: splitCfg, zoomLevel: state.zoomLevel, panX: state.panX };
          this._renderSVG(`${sectionId}_split`);
        }
      }

      // Highlight section line on map
      window.dispatchEvent(new CustomEvent('terlab:section-split', { detail: { active: true, sectionId } }));
    }

    // Toggle button states
    document.querySelectorAll('.section-split-btn').forEach(b => b.classList.remove('active'));
    if (this._splitActive) {
      document.querySelector(`.section-split-btn[data-section="${sectionId}"]`)?.classList.add('active');
    }
  },

  // ── Helpers ────────────────────────────────────────────────────
  _buildPath(data, sx, sy, smooth) {
    if (!data.length) return null;
    if (smooth && data.length >= 3) {
      let path = `M${sx(data[0].distance_m).toFixed(1)},${sy(data[0].altitude_m).toFixed(1)}`;
      for (let i = 0; i < data.length - 2; i++) {
        const x0 = sx(data[i].distance_m), y0 = sy(data[i].altitude_m);
        const x1 = sx(data[i + 1].distance_m), y1 = sy(data[i + 1].altitude_m);
        const x2 = sx(data[i + 2].distance_m);
        const cp1x = x0 + (x1 - x0) * 0.5;
        const cp2x = x2 - (x2 - x1) * 0.5;
        path += ` C${cp1x.toFixed(1)},${y1.toFixed(1)} ${cp2x.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
      }
      const last = data[data.length - 1];
      path += ` L${sx(last.distance_m).toFixed(1)},${sy(last.altitude_m).toFixed(1)}`;
      return path;
    }
    return data.map((p, i) => `${i ? 'L' : 'M'}${sx(p.distance_m).toFixed(1)},${sy(p.altitude_m).toFixed(1)}`).join(' ');
  },

  _niceStep(range, minLines, maxLines) {
    const minStep = range / maxLines;
    const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
    const power = Math.floor(Math.log10(minStep || 0.1));
    const factor = Math.pow(10, power);
    for (const n of nice) {
      const s = n * factor;
      if (s >= minStep && s <= range / minLines) return s;
    }
    return nice[0] * Math.pow(10, Math.ceil(Math.log10(minStep || 0.1)));
  },

  _keyPoints(data, maxPts) {
    const pts = new Set([0, data.length - 1]);
    for (let i = 1; i < data.length - 1 && pts.size < maxPts; i++) {
      const prev = (data[i].altitude_m - data[i - 1].altitude_m) / (data[i].distance_m - data[i - 1].distance_m || 1);
      const next = (data[i + 1].altitude_m - data[i].altitude_m) / (data[i + 1].distance_m - data[i].distance_m || 1);
      if (Math.abs(prev - next) > 0.03) pts.add(i);
    }
    return [...pts].sort((a, b) => a - b);
  },

  _interpolateAlt(data, distance_m) {
    if (!data?.length) return null;
    for (let i = 0; i < data.length - 1; i++) {
      if (data[i].distance_m <= distance_m && data[i + 1].distance_m >= distance_m) {
        const t = (distance_m - data[i].distance_m) / (data[i + 1].distance_m - data[i].distance_m || 1);
        return data[i].altitude_m + t * (data[i + 1].altitude_m - data[i].altitude_m);
      }
    }
    return data[data.length - 1]?.altitude_m ?? null;
  },

  _escapeXml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  // ── Export SVG string for PDF ─────────────────────────────────
  toSVGString(sectionId) {
    const state = this._viewers[sectionId];
    if (!state?.el) return '';
    const svg = state.el.querySelector('svg');
    if (!svg) return '';
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return new XMLSerializer().serializeToString(clone);
  },
};

export default SectionProfileViewer;
