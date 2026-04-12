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
   * Zone constructible libre = enveloppe - Σ footprints existants (AABB + gap)
   * Pour chaque footprint, construit un rectangle interdit (AABB + interBuildingGap)
   * et soustrait de l'enveloppe en gardant le plus grand fragment.
   * @param {Array} envPoly     — polygone enveloppe [[x,y]...] ou [{x,y}...]
   * @param {Array} footprints  — [{poly, area, hauteur}...]
   * @param {Object} [opts]     — { interBuildingGap: number } gap override
   * @returns {{ freeZone, freeArea, occupancyRate }}
   */
  computeFreeZone(envPoly, footprints, opts = {}) {
    const FH = window.FootprintHelpers;
    const TA = window.TerrainP07Adapter;
    const envArea = TA?.polyArea(envPoly) ?? this._polyArea(envPoly);

    if (!footprints?.length || !FH) {
      const totalFP = (footprints ?? []).reduce((s, fp) => s + fp.area, 0);
      return {
        freeZone: envPoly,
        freeArea: Math.max(0, envArea - totalFP),
        occupancyRate: envArea > 0 ? totalFP / envArea : 0,
      };
    }

    // Normaliser les points en {x,y}
    let current = envPoly.map(p => FH.toXY(p));

    for (const fp of footprints) {
      if (!fp.poly?.length) continue;

      // Gap = max(H/2 du bâtiment existant, 4m), surchargeable par opts
      const hExist = parseFloat(fp.hauteur ?? 6);
      const gap = opts.interBuildingGap ?? Math.max(4, hExist / 2);

      // AABB du footprint étendu du gap
      const fpXY = fp.poly.map(p => FH.toXY(p));
      const bb = FH.aabb(fpXY);
      const forbiddenXMin = bb.x  - gap;
      const forbiddenXMax = bb.x1 + gap;
      const forbiddenYMin = bb.y  - gap;
      const forbiddenYMax = bb.y1 + gap;

      // Soustraire le rectangle interdit de l'enveloppe courante.
      // Approche : clipper l'enveloppe par chacun des 4 demi-plans EXTERIEURS
      // au rectangle, produisant 4 fragments. Garder le plus grand.
      const fragments = [];

      // Demi-plan gauche : x < forbiddenXMin  → clip par normal (-1, 0) au point (forbiddenXMin, 0)
      const fragLeft = FH._clipHalfPlane(current,
        { x: forbiddenXMin, y: 0 }, -1, 0);
      if (fragLeft.length >= 3) fragments.push(fragLeft);

      // Demi-plan droit : x > forbiddenXMax  → clip par normal (+1, 0) au point (forbiddenXMax, 0)
      const fragRight = FH._clipHalfPlane(current,
        { x: forbiddenXMax, y: 0 }, 1, 0);
      if (fragRight.length >= 3) fragments.push(fragRight);

      // Demi-plan bas : y < forbiddenYMin  → clip par normal (0, -1) au point (0, forbiddenYMin)
      const fragBottom = FH._clipHalfPlane(current,
        { x: 0, y: forbiddenYMin }, 0, -1);
      if (fragBottom.length >= 3) fragments.push(fragBottom);

      // Demi-plan haut : y > forbiddenYMax  → clip par normal (0, +1) au point (0, forbiddenYMax)
      const fragTop = FH._clipHalfPlane(current,
        { x: 0, y: forbiddenYMax }, 0, 1);
      if (fragTop.length >= 3) fragments.push(fragTop);

      if (fragments.length) {
        // Garder le plus grand fragment
        let bestArea = -1, bestFrag = current;
        for (const frag of fragments) {
          const a = FH.area(frag);
          if (a > bestArea) { bestArea = a; bestFrag = frag; }
        }
        current = bestFrag;
      }
      // Si aucun fragment valide, l'enveloppe est entièrement couverte — on garde current tel quel
    }

    const freeArea = FH.area(current);
    const occupancyRate = envArea > 0 ? (envArea - freeArea) / envArea : 0;

    return {
      freeZone: current,
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
   * Calcule une bande d'extension collée à la plus longue facade libre
   * du bâtiment existant principal (le plus grand footprint).
   * @param {Array} envPoly     — polygone enveloppe [{x,y}...]
   * @param {Array} footprints  — [{poly, area, hauteur}...]
   * @param {Object} [opts]     — { stripDepth: number (m, def 8) }
   * @returns {Array<{x,y}>}   — polygone de la bande d'extension, ou envPoly si échec
   */
  computeExtensionStrip(envPoly, footprints, opts = {}) {
    const FH = window.FootprintHelpers;
    if (!FH || !footprints?.length || !envPoly?.length) return envPoly;

    // Trouver le plus grand bâtiment
    let largest = footprints[0];
    for (const fp of footprints) {
      if (fp.area > largest.area) largest = fp;
    }
    const fpXY = largest.poly.map(p => FH.toXY(p));
    const envXY = envPoly.map(p => FH.toXY(p));
    if (fpXY.length < 3) return envPoly;

    // Trouver la facade la plus "libre" = celle dont le milieu est le plus loin
    // de la frontière de l'enveloppe (= le plus de recul disponible)
    const nEdges = fpXY.length;
    let bestIdx = 0, bestDist = -1;
    for (let i = 0; i < nEdges; i++) {
      const a = fpXY[i];
      const b = fpXY[(i + 1) % nEdges];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const d = FH.minDistPointPoly(mx, my, envXY);
      if (d > bestDist) { bestDist = d; bestIdx = i; }
    }

    // Direction perpendiculaire à cette façade, pointant vers l'extérieur du bâtiment
    const fa = fpXY[bestIdx];
    const fb = fpXY[(bestIdx + 1) % nEdges];
    const edx = fb.x - fa.x, edy = fb.y - fa.y;
    const elen = Math.hypot(edx, edy) || 1;
    // Normale vers l'extérieur : on teste quel côté est vers le centroïde de l'enveloppe
    const fpCent = FH.centroid(fpXY);
    let nx = -edy / elen, ny = edx / elen;
    // Si la normale pointe vers le centroïde du bâtiment, inverser
    const toFpDot = (fpCent.x - fa.x) * nx + (fpCent.y - fa.y) * ny;
    if (toFpDot > 0) { nx = -nx; ny = -ny; }

    // Construire la bande : rectangle le long de la facade, profondeur stripDepth
    const stripDepth = opts.stripDepth ?? 8;
    const strip = [
      { x: fa.x,                    y: fa.y },
      { x: fb.x,                    y: fb.y },
      { x: fb.x + nx * stripDepth,  y: fb.y + ny * stripDepth },
      { x: fa.x + nx * stripDepth,  y: fa.y + ny * stripDepth },
    ];

    // Clipper la bande par l'enveloppe constructible
    const clipped = FH.clipPolygon(strip, envXY);
    if (clipped.length >= 3 && FH.area(clipped) > 10) {
      return clipped;
    }
    // Fallback : retourner l'enveloppe complète
    return envPoly;
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
