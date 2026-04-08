// terlab/services/existing-buildings.js · Gestion bâtiments existants parcelle · v1
// ENSA La Réunion · MGA Architecture 2026
// Vanilla JS ES2022+, aucune dépendance externe
// Détecte, analyse et gère les bâtiments existants — 3 modes : démolition, conservation, extension

const ExistingBuildings = {

  /**
   * Analyse les bâtiments existants depuis la session p05
   * Sources : session.phases[5].data.batiments_parcelle, Mapbox buildings layer
   * @param {Object} session — SessionManager.getSession()
   * @returns {{ footprints, totalArea, mode, warnings }}
   */
  analyse(session) {
    const warnings = [];
    const TA = window.TerrainP07Adapter;

    // Sources candidates
    const bats = session?.phases?.[5]?.data?.batiments_parcelle
              ?? session?.terrain?.batiments_parcelle
              ?? [];

    if (!bats.length) {
      return { footprints: [], totalArea: 0, mode: null, warnings: ['AUCUN_BATIMENT_EXISTANT'] };
    }

    // Centroïde parcelle pour projection
    const geojson = session?.terrain?.parcelle_geojson ?? session?.geojson;
    let lat0 = parseFloat(session?.terrain?.lat ?? -21.15);
    let lng0 = parseFloat(session?.terrain?.lng ?? 55.45);

    if (geojson) {
      try {
        const ring = TA?._extractRing(geojson) ?? [];
        if (ring.length) {
          lng0 = ring.reduce((s, c) => s + c[0], 0) / ring.length;
          lat0 = ring.reduce((s, c) => s + c[1], 0) / ring.length;
        }
      } catch { /* utiliser défauts */ }
    }

    const footprints = [];
    let totalArea = 0;

    for (const bat of bats) {
      let poly = null;
      let area = 0;

      if (bat.footprint && Array.isArray(bat.footprint)) {
        // Coordonnées locales déjà fournies [[x,y]...]
        poly = bat.footprint;
        area = TA?.polyArea(poly) ?? this._polyArea(poly);
      } else if (bat.geojson) {
        // GeoJSON → local
        try {
          const ring = TA?._extractRing(bat.geojson) ?? [];
          poly = TA?.geoToLocal(ring, 0, lat0, lng0) ?? [];
          area = TA?.polyArea(poly) ?? this._polyArea(poly);
        } catch {
          warnings.push('FOOTPRINT_CONVERSION_ERROR');
          continue;
        }
      } else {
        // Estimation rectangulaire depuis surface
        const s = parseFloat(bat.surface ?? bat.area ?? 100);
        const side = Math.sqrt(s);
        poly = [[0, 0], [side, 0], [side, side], [0, side]];
        area = s;
        warnings.push('FOOTPRINT_ESTIME');
      }

      footprints.push({
        poly,
        area,
        hauteur: parseFloat(bat.hauteur ?? bat.height ?? 6),
        source: bat.source ?? 'session',
        usage: bat.usage ?? 'inconnu',
      });

      totalArea += area;
    }

    return { footprints, totalArea, mode: null, warnings };
  },

  /**
   * Zone constructible libre = enveloppe - Σ footprints existants
   * Simplification : exclure par AABB pour le PIR, aire soustraite pour métriques
   * @param {Array} envPoly     — polygone enveloppe [[x,y]...]
   * @param {Array} footprints  — [{poly, area}...]
   * @returns {{ freeZone, freeArea, occupancyRate }}
   */
  computeFreeZone(envPoly, footprints) {
    const TA = window.TerrainP07Adapter;
    const envArea = TA?.polyArea(envPoly) ?? this._polyArea(envPoly);
    const totalFP = footprints.reduce((s, fp) => s + fp.area, 0);
    const freeArea = Math.max(0, envArea - totalFP);
    const occupancyRate = envArea > 0 ? totalFP / envArea : 0;

    // Zone libre = enveloppe (on exclut les footprints au niveau du placement PIR)
    return {
      freeZone: envPoly,
      freeArea,
      occupancyRate,
    };
  },

  /**
   * Rendu SVG des footprints selon le mode
   * @param {SVGGElement} g         — groupe SVG parent
   * @param {Array}       footprints — [{poly, area, source}...]
   * @param {string}      mode       — 'demolition'|'conservation'|'extension'
   * @param {Function}    projectFn  — (x, y) => { x, y } — projection local → SVG
   */
  renderSVG(g, footprints, mode, projectFn) {
    if (!g || !footprints?.length) return;

    // Créer defs hachures si pas encore
    const svg = g.ownerSVGElement;
    if (svg && !svg.querySelector('#hatch-demolition')) {
      const defs = svg.querySelector('defs') || svg.insertBefore(
        document.createElementNS('http://www.w3.org/2000/svg', 'defs'), svg.firstChild
      );
      defs.innerHTML += `
        <pattern id="hatch-demolition" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(239,68,68,.7)" stroke-width="1.5"/>
        </pattern>
      `;
    }

    const colors = {
      demolition:   { fill: 'url(#hatch-demolition)', stroke: '#EF4444', label: 'à démolir' },
      conservation: { fill: 'rgba(148,163,184,.6)',    stroke: '#94A3B8', label: 'conservé' },
      extension:    { fill: 'rgba(59,130,246,.4)',     stroke: '#3B82F6', label: 'extension' },
    };

    const style = colors[mode] ?? colors.conservation;

    for (const fp of footprints) {
      if (!fp.poly?.length) continue;

      const pts = fp.poly.map(([x, y]) => {
        const p = projectFn(x, y);
        return `${p.x},${p.y}`;
      }).join(' ');

      // Polygone
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', pts);
      polygon.setAttribute('fill', style.fill);
      polygon.setAttribute('stroke', style.stroke);
      polygon.setAttribute('stroke-width', '1.5');
      polygon.setAttribute('stroke-dasharray', mode === 'demolition' ? '4,2' : 'none');
      g.appendChild(polygon);

      // Label
      const cx = fp.poly.reduce((s, p) => s + p[0], 0) / fp.poly.length;
      const cy = fp.poly.reduce((s, p) => s + p[1], 0) / fp.poly.length;
      const cp = projectFn(cx, cy);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', cp.x);
      text.setAttribute('y', cp.y);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('font-size', '9');
      text.setAttribute('fill', style.stroke);
      text.setAttribute('font-weight', 'bold');
      text.textContent = `${style.label} ${fp.area.toFixed(0)}m²`;
      g.appendChild(text);
    }
  },

  /**
   * Détecte le mode recommandé selon le programme
   * @returns {'demolition'|'conservation'|'extension'}
   */
  suggestMode(session, prog) {
    const result = this.analyse(session);
    if (!result.footprints.length) return 'demolition';

    const totalArea = result.totalArea;
    const type = prog?.type ?? 'collectif';

    // Petit bâti + maison → démolition
    if (type === 'maison' && totalArea < 150) return 'demolition';
    // Grand bâti + collectif → conservation
    if (type === 'collectif' && totalArea > 200) return 'conservation';
    // Même structure → extension
    if (result.footprints.length === 1 && totalArea < 300) return 'extension';

    return 'demolition';
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Fallback polyArea (si adapter non dispo)
  // ═══════════════════════════════════════════════════════════════════════════

  _polyArea(pts) {
    let s = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
      s += x1 * y2 - x2 * y1;
    }
    return Math.abs(s) / 2;
  },
};

export { ExistingBuildings };
export default ExistingBuildings;

// Expose pour compatibilité non-module TERLAB
if (typeof window !== 'undefined') window.ExistingBuildings = ExistingBuildings;
