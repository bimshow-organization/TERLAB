// TERLAB · utils/site-plan-renderer.js
// Plan d'état des lieux SVG paramétré (avec ou sans projet)
// ════════════════════════════════════════════════════════════════════
//
// Un seul moteur de rendu, deux livrables :
//   - withProject: false  → P04 PLU, plan d'état des lieux pur
//   - withProject: true   → P07 esquisse, plan masse projet
//
// L'unité du viewBox est le mm — ce qui permet une impression PDF
// directe en respectant les échelles normalisées d'architecte.
//
// Sources de données (toutes optionnelles, le renderer tolère l'absence) :
//   - session.terrain.parcelle_geojson  → parcelle cible (obligatoire)
//   - CadastreContextService            → parcelles voisines
//   - BdTopoService                     → bâti + voirie
//   - ContourService                    → courbes de niveau
//   - withProject:true uniquement :
//       session.phases[7].data.building_aabb / building_polygon
//       session.phases[7].data.envZones (reculs PLU)
//       session._vegetationPlants (BPF)
//
// Usage typique :
//   const renderer = await SitePlanRenderer.build(session, { withProject: false });
//   container.innerHTML = renderer.svg;
//   // ou pour PDF :
//   const html = SitePlanRenderer.wrapForPrint(renderer);
// ════════════════════════════════════════════════════════════════════

import CadastreContextService from '../services/cadastre-context-service.js';
import BdTopoService from '../services/bdtopo-service.js';
import ContourService from '../services/contour-service.js';
import ParcelAltitudes from '../services/parcel-altitudes.js';

// ── ÉCHELLES NORMALISÉES (architecte) ────────────────────────────
// diagonale parcelle (m) → { échelle, format }
const SCALE_TABLE = [
  { maxDiag:   25, scale:  100, format: 'A4' },
  { maxDiag:   50, scale:  200, format: 'A4' },
  { maxDiag:  100, scale:  500, format: 'A4' },
  { maxDiag:  200, scale:  500, format: 'A3' },
  { maxDiag:  400, scale: 1000, format: 'A3' },
  { maxDiag:  800, scale: 2000, format: 'A3' },
  { maxDiag: Infinity, scale: 5000, format: 'A3' },
];

// Format → dimensions (paysage)
const FORMATS = {
  A4: { widthMm: 297, heightMm: 210, marginMm: 12 },
  A3: { widthMm: 420, heightMm: 297, marginMm: 15 },
};

// ── PALETTE TERLAB ────────────────────────────────────────────────
const C = {
  paper:        '#fcf9f3',
  frame:        '#1e1b16',
  parcelTarget: '#C1652B',
  parcelOther:  '#7a6f5f',
  building:     '#544838',
  road:         '#a8a195',
  contourMaj:   '#8a6e3e',
  contourMin:   '#c4b396',
  ngr:          '#1e3a5f',
  reculPlu:     '#a78bfa',
  projet:       '#2563EB',
  text:         '#2a241c',
  textMuted:    '#6b5c3e',
  vegetation:   '#3f7d3f',
};

// ════════════════════════════════════════════════════════════════════
const SitePlanRenderer = {

  /**
   * API publique principale — construit le SVG complet à partir d'une session.
   * @param {Object} session  session TERLAB (window.SessionManager.getSession())
   * @param {Object} opts
   * @param {boolean} opts.withProject  inclure les couches projet (P07)
   * @param {boolean} opts.fetchExternal  défaut true. false = utiliser uniquement
   *                  les données déjà présentes dans session (offline mode)
   * @param {Object} opts.cache         { contour, bdtopoBat, bdtopoRoutes, cadastre }
   * @returns {Promise<{ svg: string, meta: object }>}
   */
  async build(session, opts = {}) {
    const withProject   = !!opts.withProject;
    const fetchExternal = opts.fetchExternal !== false;
    const cache         = opts.cache ?? {};

    // ── 1. Géométrie parcelle cible ────────────────────────────────
    const parcelGeo = this._extractParcelGeo(session);
    if (!parcelGeo || parcelGeo.length < 3) {
      return { svg: this._errorSVG('Parcelle introuvable dans la session'), meta: {} };
    }

    const [clng, clat] = this._centroidGeo(parcelGeo);
    const parcelLocal  = this._geoToLocal(parcelGeo, clng, clat);

    // ── 2. Échelle + format auto ───────────────────────────────────
    const diag = this._diagonal(parcelLocal);
    const { scale, format } = this._chooseScale(diag);
    const fmt = FORMATS[format];

    // ── 3. Récupération des couches contextuelles ──────────────────
    const radiusM = CadastreContextService.recommendedRadius(scale, format);
    const ctx = await this._loadContext({
      lat: clat, lng: clng, radiusM,
      session, parcelGeo, withProject, fetchExternal, cache,
    });

    // ── 4. Calcul du viewBox cadré sur la parcelle + voisinage ─────
    // Le viewBox est en mm. Les coordonnées m → mm via scale.
    // Origine SVG = coin haut-gauche du contenu, parcelle centrée.
    const contentW = fmt.widthMm  - 2 * fmt.marginMm - 70; // -70 pour cartouche droite
    const contentH = fmt.heightMm - 2 * fmt.marginMm;

    // Mètres réels couverts par la zone de contenu
    const realW_m = (contentW * scale) / 1000;
    const realH_m = (contentH * scale) / 1000;

    // Centre local (centroïde des sommets parcelle)
    const cxL = parcelLocal.reduce((s, p) => s + p.x, 0) / parcelLocal.length;
    const cyL = parcelLocal.reduce((s, p) => s + p.y, 0) / parcelLocal.length;

    // Fenêtre locale en mètres autour du centroïde
    const view = {
      minX_m: cxL - realW_m / 2,
      maxX_m: cxL + realW_m / 2,
      minY_m: cyL - realH_m / 2,
      maxY_m: cyL + realH_m / 2,
      // Décalage SVG mm de l'origine de contenu
      offsetX_mm: fmt.marginMm,
      offsetY_mm: fmt.marginMm,
    };

    // ── 5. Render ──────────────────────────────────────────────────
    const svg = this._renderSVG({
      session, parcelGeo, parcelLocal, ctx, view, scale, format, fmt,
      withProject, clng, clat,
    });

    return {
      svg,
      meta: {
        scale, format, diag, radiusM,
        widthMm: fmt.widthMm, heightMm: fmt.heightMm,
        commune: session?.terrain?.commune ?? '',
        reference: session?.terrain?.reference ?? '',
        layers: Object.keys(ctx).filter(k => ctx[k]),
      },
    };
  },

  /**
   * Wrappe un résultat build() dans un document HTML imprimable
   * (utilisé par export-engine pour le pipeline window.print()).
   */
  wrapForPrint({ svg, meta }) {
    return `<!doctype html><html><head><meta charset="utf-8">
<title>TERLAB · Plan ${meta.commune ?? ''} ${meta.reference ?? ''}</title>
<style>
  @page { size: ${meta.widthMm}mm ${meta.heightMm}mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  svg { display: block; width: ${meta.widthMm}mm; height: ${meta.heightMm}mm; }
</style></head><body>${svg}</body></html>`;
  },

  /**
   * Calcule l'échelle et le format optimaux pour une diagonale (m).
   * Exposé pour permettre au code appelant de prévoir le format.
   */
  computeScaleFormat(diagonalM) {
    return this._chooseScale(diagonalM);
  },

  // ════════════════════════════════════════════════════════════════
  // INTERNALS — extraction des données
  // ════════════════════════════════════════════════════════════════

  _extractParcelGeo(session) {
    const geom = session?.terrain?.parcelle_geojson;
    if (!geom) return null;
    let ring = null;
    if (geom.type === 'Polygon')          ring = geom.coordinates[0];
    else if (geom.type === 'MultiPolygon') ring = geom.coordinates[0]?.[0];
    if (!ring?.length) return null;
    // Supprimer le point de fermeture GeoJSON
    if (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) {
      ring = ring.slice(0, -1);
    }
    return ring;
  },

  _centroidGeo(coords) {
    const n = coords.length;
    return [
      coords.reduce((s, c) => s + c[0], 0) / n,
      coords.reduce((s, c) => s + c[1], 0) / n,
    ];
  },

  // WGS84 [[lng,lat]] → local [{x,y}] mètres
  // Y inversé pour cohérence SVG (Y vers le bas)
  _geoToLocal(coords, clng, clat) {
    const LNG = 111320 * Math.cos(clat * Math.PI / 180);
    const LAT = 111320;
    return coords.map(([lng, lat]) => ({
      x:  (lng - clng) * LNG,
      y: -(lat - clat) * LAT,
    }));
  },

  _diagonal(localPts) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of localPts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    return Math.hypot(maxX - minX, maxY - minY);
  },

  _chooseScale(diagonalM) {
    for (const row of SCALE_TABLE) {
      if (diagonalM <= row.maxDiag) return { scale: row.scale, format: row.format };
    }
    return { scale: 5000, format: 'A3' };
  },

  // ── Charge les couches contextuelles (offline-tolerant) ─────────
  async _loadContext({ lat, lng, radiusM, session, parcelGeo, withProject, fetchExternal, cache }) {
    const ctx = {};

    // Cadastre voisins
    if (cache.cadastre) {
      ctx.cadastre = cache.cadastre;
    } else if (fetchExternal) {
      try {
        ctx.cadastre = await CadastreContextService.fetchNeighbors(lat, lng, radiusM);
        if (ctx.cadastre) {
          CadastreContextService.markTarget(ctx.cadastre, { type: 'Polygon', coordinates: [parcelGeo] });
        }
      } catch (e) { console.warn('[SitePlan] cadastre context failed:', e.message); }
    }

    // BDTOPO bâti voisin
    if (cache.bdtopoBat) {
      ctx.batiments = cache.bdtopoBat;
    } else if (fetchExternal) {
      try {
        ctx.batiments = await BdTopoService.fetchBatiments(lat, lng, radiusM);
      } catch (e) { console.warn('[SitePlan] bdtopo bat failed:', e.message); }
    }

    // BDTOPO voirie
    if (cache.bdtopoRoutes) {
      ctx.routes = cache.bdtopoRoutes;
    } else if (fetchExternal) {
      try {
        ctx.routes = await BdTopoService.fetchRoutes(lat, lng, radiusM);
      } catch (e) { console.warn('[SitePlan] bdtopo routes failed:', e.message); }
    }

    // Courbes de niveau (uniquement si BIL disponible — sinon skip silencieux)
    if (cache.contour) {
      ctx.contour = cache.contour;
    } else if (fetchExternal && typeof window !== 'undefined' && window.BILTerrain) {
      try {
        const dM = radiusM / 111000;
        const dN = radiusM / (111000 * Math.cos(lat * Math.PI / 180));
        const wgsBounds = { west: lng - dN, east: lng + dN, south: lat - dM, north: lat + dM };
        ctx.contour = await ContourService.fromBIL(wgsBounds, { pixelSizeM: 2, maxDim: 200 });
      } catch (e) { console.warn('[SitePlan] contour failed:', e.message); }
    }

    // Échantillonnage NGR aux sommets parcelle (BIL une seule requête)
    if (cache.cornerAlts) {
      ctx.cornerAlts = cache.cornerAlts;
    } else if (fetchExternal && typeof window !== 'undefined' && window.BILTerrain) {
      try {
        const res = await ParcelAltitudes.sampleParcelKeyPoints(parcelGeo, { longEdgeM: 30 });
        ctx.cornerAlts = res.points;
      } catch (e) { console.warn('[SitePlan] NGR sample failed:', e.message); }
    }

    // Couches projet (si demandé)
    if (withProject) {
      const p7 = session?.phases?.[7]?.data ?? {};
      ctx.project = {
        building: p7.building_aabb ?? p7.building_polygon ?? null,
        envZones: p7.envZones ?? null,
        vegetation: session?._vegetationPlants ?? p7.vegetation ?? null,
        // PLU pour le cartouche
        plu: {
          zone:    p7.zone_plu ?? session?.terrain?.zone_plu ?? '—',
          ces:     p7.ces_max,
          hMax:    p7.hauteur_max_m,
          recVoie: p7.recul_voie_m,
          recLat:  p7.recul_limite_sep_m,
          recFond: p7.recul_fond_m,
        },
      };
    }

    return ctx;
  },

  // ════════════════════════════════════════════════════════════════
  // INTERNALS — rendu SVG
  // ════════════════════════════════════════════════════════════════

  _renderSVG({ session, parcelGeo, parcelLocal, ctx, view, scale, format, fmt, withProject, clng, clat }) {
    const W = fmt.widthMm, H = fmt.heightMm;
    const layers = [];

    // ── Helpers de projection (m local → mm SVG) ─────────────────
    // Fenêtre vue en mètres → pixels mm
    const mmPerM = 1000 / scale;
    const cxL = (view.minX_m + view.maxX_m) / 2;
    const cyL = (view.minY_m + view.maxY_m) / 2;
    // Centre du contenu en mm sur la planche
    const contentCxMm = view.offsetX_mm + (W - 2 * view.offsetX_mm - 70) / 2;
    const contentCyMm = view.offsetY_mm + (H - 2 * view.offsetY_mm) / 2;

    const m2mm = (pt) => ({
      x: contentCxMm + (pt.x - cxL) * mmPerM,
      y: contentCyMm + (pt.y - cyL) * mmPerM,
    });

    const geoToMm = ([lng, lat]) => {
      const LNG = 111320 * Math.cos(clat * Math.PI / 180);
      const LAT = 111320;
      const pt = { x: (lng - clng) * LNG, y: -(lat - clat) * LAT };
      return m2mm(pt);
    };

    // ── Defs (patterns hachures) ─────────────────────────────────
    layers.push(`
<defs>
  <pattern id="hatch-bat" patternUnits="userSpaceOnUse" width="1.4" height="1.4" patternTransform="rotate(45)">
    <line x1="0" y1="0" x2="0" y2="1.4" stroke="${C.building}" stroke-width="0.18"/>
  </pattern>
  <pattern id="hatch-projet" patternUnits="userSpaceOnUse" width="1.2" height="1.2" patternTransform="rotate(-45)">
    <line x1="0" y1="0" x2="0" y2="1.2" stroke="${C.projet}" stroke-width="0.22"/>
  </pattern>
</defs>`);

    // ── Background ───────────────────────────────────────────────
    layers.push(`<rect width="${W}" height="${H}" fill="${C.paper}"/>`);

    // ── Cadre extérieur ──────────────────────────────────────────
    layers.push(`<rect x="${fmt.marginMm * 0.5}" y="${fmt.marginMm * 0.5}" width="${W - fmt.marginMm}" height="${H - fmt.marginMm}" fill="none" stroke="${C.frame}" stroke-width="0.4"/>`);

    // ── Zone de contenu (clip) ───────────────────────────────────
    const clipW = W - 2 * fmt.marginMm - 70;
    const clipH = H - 2 * fmt.marginMm;
    layers.push(`<defs><clipPath id="content-clip"><rect x="${fmt.marginMm}" y="${fmt.marginMm}" width="${clipW}" height="${clipH}"/></clipPath></defs>`);
    layers.push(`<g clip-path="url(#content-clip)">`);

    // ── 1. Courbes de niveau (fond) ───────────────────────────────
    if (ctx.contour?.lines?.length) {
      const interval = ctx.contour.interval ?? 1;
      const majorEvery = interval * 5;
      for (const line of ctx.contour.lines) {
        const isMajor = Math.abs(line.level % majorEvery) < 0.01;
        const pts = line.coords.map(geoToMm);
        const d = this._polylineD(pts);
        if (!d) continue;
        layers.push(`<path d="${d}" fill="none" stroke="${isMajor ? C.contourMaj : C.contourMin}" stroke-width="${isMajor ? 0.25 : 0.12}" opacity="0.7"/>`);
      }
    }

    // ── 2. Voirie BDTOPO ──────────────────────────────────────────
    const roadNames = [];
    if (ctx.routes?.features?.length) {
      for (const f of ctx.routes.features) {
        if (!f.geometry) continue;
        const lineCoords = f.geometry.type === 'LineString'
          ? [f.geometry.coordinates]
          : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
        for (const ls of lineCoords) {
          const pts = ls.map(geoToMm);
          const d = this._polylineD(pts);
          if (!d) continue;
          // Largeur visuelle selon importance
          const imp = parseInt(f.properties?.importance ?? 5);
          const w = imp <= 2 ? 1.2 : imp <= 3 ? 0.9 : 0.6;
          layers.push(`<path d="${d}" fill="none" stroke="${C.road}" stroke-width="${w}" stroke-linecap="round"/>`);
          // Nom de rue (mémoriser pour rendu après)
          const nom = f.properties?.nom_voie_gauche ?? f.properties?.nom_1_gauche ?? f.properties?.nom_voie_droite;
          if (nom && pts.length >= 2) {
            const mid = pts[Math.floor(pts.length / 2)];
            roadNames.push({ x: mid.x, y: mid.y, nom });
          }
        }
      }
    }

    // ── 3. Parcelles voisines (cadastre) ──────────────────────────
    if (ctx.cadastre?.features?.length) {
      for (const f of ctx.cadastre.features) {
        if (f.properties?.__target) continue; // la cible est dessinée à part
        const ring = this._extractRingFromFeature(f);
        if (!ring) continue;
        const pts = ring.map(geoToMm);
        layers.push(`<polygon points="${this._polyPts(pts)}" fill="none" stroke="${C.parcelOther}" stroke-width="0.18" opacity="0.65"/>`);
        // Numéro parcelle au centroïde si assez grand
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        const num = f.properties?.numero ?? '';
        if (num && pts.length > 2) {
          layers.push(`<text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" font-family="IBM Plex Mono, monospace" font-size="1.6" fill="${C.parcelOther}" text-anchor="middle" opacity="0.7">${num}</text>`);
        }
      }
    }

    // ── 4. Bâti BDTOPO voisin (hachuré) ───────────────────────────
    if (ctx.batiments?.features?.length) {
      for (const f of ctx.batiments.features) {
        if (!f.geometry) continue;
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates]
                    : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
        for (const rings of polys) {
          const ring = rings[0];
          if (!ring) continue;
          const pts = ring.map(geoToMm);
          const ptsStr = this._polyPts(pts);
          layers.push(`<polygon points="${ptsStr}" fill="url(#hatch-bat)" stroke="${C.building}" stroke-width="0.25"/>`);
        }
      }
    }

    // ── 5. Parcelle cible (highlight + cotations) ─────────────────
    const parcelMm = parcelLocal.map(m2mm);
    layers.push(`<polygon points="${this._polyPts(parcelMm)}" fill="${C.parcelTarget}" fill-opacity="0.08" stroke="${C.parcelTarget}" stroke-width="0.6"/>`);

    // Cotations périmétriques (toujours)
    layers.push(this._renderCotationsParcelle(parcelLocal, parcelMm, scale));

    // ── 5b. NGR aux sommets (et milieux d'arêtes longues) ─────────
    if (ctx.cornerAlts?.length) {
      layers.push(this._renderNGRMarkers(ctx.cornerAlts, geoToMm));
    }

    // ── 6. COUCHES PROJET (si demandé) ────────────────────────────
    if (withProject && ctx.project) {
      // Zones de recul PLU
      if (ctx.project.envZones) {
        const z = ctx.project.envZones;
        // envZones = polygons en mètres locaux ou structure { voie, lat, fond, perm }
        // On dessine ce qu'on trouve
        for (const key of ['voie', 'lat', 'fond', 'perm']) {
          const poly = z[key];
          if (Array.isArray(poly) && poly.length >= 3) {
            const pts = poly.map(p => m2mm({ x: p.x ?? p[0], y: p.y ?? p[1] }));
            layers.push(`<polygon points="${this._polyPts(pts)}" fill="none" stroke="${C.reculPlu}" stroke-width="0.3" stroke-dasharray="1.5,1"/>`);
          }
        }
      }

      // Bâtiment projet
      if (ctx.project.building) {
        const b = ctx.project.building;
        let polyM = null;
        if (Array.isArray(b) && b.length >= 3) {
          // Polygon directly
          polyM = b.map(p => ({ x: p.x ?? p[0], y: p.y ?? p[1] }));
        } else if (b && typeof b === 'object' && 'x' in b && 'w' in b) {
          // AABB rect { x, y, w, l }
          polyM = [
            { x: b.x,         y: b.y },
            { x: b.x + b.w,   y: b.y },
            { x: b.x + b.w,   y: b.y + (b.l ?? b.h ?? 0) },
            { x: b.x,         y: b.y + (b.l ?? b.h ?? 0) },
          ];
        }
        if (polyM) {
          const pts = polyM.map(m2mm);
          layers.push(`<polygon points="${this._polyPts(pts)}" fill="url(#hatch-projet)" stroke="${C.projet}" stroke-width="0.6"/>`);
          // Cotations bâtiment projet
          layers.push(this._renderCotationsBat(polyM, m2mm, scale));
        }
      }

      // Végétation BPF
      if (Array.isArray(ctx.project.vegetation)) {
        for (const plant of ctx.project.vegetation) {
          if (plant?.x == null || plant?.y == null) continue;
          const c = m2mm({ x: plant.x, y: plant.y });
          const r = ((plant.crown_m ?? plant.r ?? 3) / 2) * mmPerM;
          layers.push(`<circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${r.toFixed(2)}" fill="${C.vegetation}" fill-opacity="0.18" stroke="${C.vegetation}" stroke-width="0.18"/>`);
        }
      }
    }

    // ── Noms de rues (au-dessus des couches) ─────────────────────
    for (const rn of roadNames) {
      // Évite les doublons proches
      layers.push(`<text x="${rn.x.toFixed(2)}" y="${rn.y.toFixed(2)}" font-family="IBM Plex Mono, monospace" font-size="2.2" fill="${C.text}" text-anchor="middle" font-style="italic">${this._esc(rn.nom)}</text>`);
    }

    layers.push(`</g>`); // fin clip content

    // ── Cartouche (hors clip) ────────────────────────────────────
    layers.push(this._renderCartouche({
      session, scale, format, fmt, withProject, ctx, W, H,
    }));

    // ── Nord + échelle graphique ─────────────────────────────────
    layers.push(this._renderNord(W, fmt));
    layers.push(this._renderEchelle(scale, fmt, H));

    // ── SVG outer ────────────────────────────────────────────────
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" style="display:block;background:${C.paper}">${layers.join('\n')}</svg>`;
  },

  // ── Helpers de rendu ─────────────────────────────────────────────

  _polyPts(pts) { return pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '); },
  _polylineD(pts) {
    if (!pts || pts.length < 2) return '';
    return 'M' + pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L');
  },
  _esc(s) { return String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])); },

  _extractRingFromFeature(f) {
    if (!f?.geometry) return null;
    if (f.geometry.type === 'Polygon')      return f.geometry.coordinates[0];
    if (f.geometry.type === 'MultiPolygon') return f.geometry.coordinates[0]?.[0];
    return null;
  },

  // Cotations périmétriques de la parcelle (toujours affichées)
  _renderCotationsParcelle(parcelLocal, parcelMm, scale) {
    const out = [];
    const n = parcelLocal.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = parcelLocal[i], b = parcelLocal[j];
      const lenM = Math.hypot(b.x - a.x, b.y - a.y);
      if (lenM < 1.5) continue; // pas de cotation sur arête trop courte
      const aMm = parcelMm[i], bMm = parcelMm[j];
      // Vecteur unitaire de l'arête + normale extérieure approximative
      const dx = bMm.x - aMm.x, dy = bMm.y - aMm.y;
      const len = Math.hypot(dx, dy);
      const nx = -dy / len, ny = dx / len;
      // Décalage 1.5 mm vers l'extérieur (par défaut, peut être faux côté mais lisible)
      const off = 1.8;
      const mx = (aMm.x + bMm.x) / 2 + nx * off;
      const my = (aMm.y + bMm.y) / 2 + ny * off;
      // Angle texte parallèle à l'arête, lisible (pas tête en bas)
      let ang = Math.atan2(dy, dx) * 180 / Math.PI;
      if (ang > 90 || ang < -90) ang += 180;
      out.push(`<text x="${mx.toFixed(2)}" y="${my.toFixed(2)}" font-family="IBM Plex Mono, monospace" font-size="1.9" fill="${C.parcelTarget}" text-anchor="middle" transform="rotate(${ang.toFixed(1)} ${mx.toFixed(2)} ${my.toFixed(2)})">${lenM.toFixed(1)} m</text>`);
    }
    return out.join('\n');
  },

  // NGR aux sommets parcelle (et milieux d'arêtes longues)
  _renderNGRMarkers(cornerAlts, geoToMm) {
    const out = [];
    for (const pt of cornerAlts) {
      if (pt.alt == null || !pt.coord) continue;
      const m = geoToMm(pt.coord);
      const isCorner = pt.kind === 'corner';
      // Marqueur
      if (isCorner) {
        const r = 0.9;
        out.push(`<line x1="${(m.x - r).toFixed(2)}" y1="${m.y.toFixed(2)}" x2="${(m.x + r).toFixed(2)}" y2="${m.y.toFixed(2)}" stroke="${C.ngr}" stroke-width="0.3"/>`);
        out.push(`<line x1="${m.x.toFixed(2)}" y1="${(m.y - r).toFixed(2)}" x2="${m.x.toFixed(2)}" y2="${(m.y + r).toFixed(2)}" stroke="${C.ngr}" stroke-width="0.3"/>`);
      } else {
        out.push(`<circle cx="${m.x.toFixed(2)}" cy="${m.y.toFixed(2)}" r="0.4" fill="${C.ngr}"/>`);
      }
      // Étiquette : "+34.5" en noir, fond papier semi-transparent
      const txt = `+${pt.alt.toFixed(1)}`;
      const fz = isCorner ? 2.0 : 1.7;
      const tw = txt.length * fz * 0.55 + 0.6;
      const tx = m.x + 1.2;
      const ty = m.y - 1.2;
      out.push(`<rect x="${(tx - 0.3).toFixed(2)}" y="${(ty - fz).toFixed(2)}" width="${tw.toFixed(2)}" height="${(fz + 0.4).toFixed(2)}" fill="rgba(252,249,243,0.88)" stroke="${C.ngr}" stroke-width="0.08" stroke-opacity="0.4" rx="0.3"/>`);
      out.push(`<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" font-family="IBM Plex Mono, monospace" font-size="${fz}" font-weight="${isCorner ? 700 : 500}" fill="${C.ngr}">${txt}</text>`);
    }
    return out.join('\n');
  },

  // Cotations du bâtiment projet (largeur/profondeur)
  _renderCotationsBat(polyM, m2mm, scale) {
    if (!polyM || polyM.length < 3) return '';
    const out = [];
    const xs = polyM.map(p => p.x), ys = polyM.map(p => p.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    const c = m2mm({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
    out.push(`<text x="${c.x.toFixed(2)}" y="${(c.y - 1).toFixed(2)}" font-family="IBM Plex Mono, monospace" font-size="2.2" fill="${C.projet}" text-anchor="middle" font-weight="600">${w.toFixed(1)} × ${h.toFixed(1)} m</text>`);
    return out.join('\n');
  },

  _renderNord(W, fmt) {
    const cx = W - fmt.marginMm - 75;
    const cy = fmt.marginMm + 12;
    return `<g transform="translate(${cx},${cy})">
  <circle r="6" fill="${C.paper}" stroke="${C.frame}" stroke-width="0.3"/>
  <path d="M0,-5 L1.6,2 L0,1 L-1.6,2 Z" fill="${C.frame}"/>
  <text y="-7.5" text-anchor="middle" font-family="Playfair Display, serif" font-size="3.5" font-weight="700" fill="${C.frame}">N</text>
</g>`;
  },

  _renderEchelle(scale, fmt, H) {
    // Barre 0–10–20–50 m projetée à l'échelle (en mm sur la planche)
    const x0 = fmt.marginMm + 4;
    const y  = H - fmt.marginMm - 8;
    const m2mm = (m) => (m * 1000) / scale;
    // Choix des graduations selon l'échelle
    const stops = scale <= 200 ? [0, 1, 2, 5, 10] :
                  scale <= 500 ? [0, 5, 10, 20, 50] :
                  scale <= 1000 ? [0, 10, 20, 50, 100] :
                  scale <= 2000 ? [0, 20, 50, 100, 200] :
                                  [0, 100, 200, 500, 1000];
    const segs = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const x1 = x0 + m2mm(stops[i]);
      const x2 = x0 + m2mm(stops[i + 1]);
      const fill = i % 2 === 0 ? C.frame : C.paper;
      segs.push(`<rect x="${x1.toFixed(2)}" y="${y.toFixed(2)}" width="${(x2 - x1).toFixed(2)}" height="1.2" fill="${fill}" stroke="${C.frame}" stroke-width="0.15"/>`);
    }
    const labels = stops.map(s => {
      const xs = x0 + m2mm(s);
      return `<text x="${xs.toFixed(2)}" y="${(y + 4).toFixed(2)}" font-family="IBM Plex Mono, monospace" font-size="1.8" fill="${C.text}" text-anchor="middle">${s}</text>`;
    }).join('');
    return `<g>${segs.join('')}${labels}<text x="${x0.toFixed(2)}" y="${(y - 1).toFixed(2)}" font-family="IBM Plex Mono, monospace" font-size="1.8" fill="${C.textMuted}">Échelle 1/${scale} — m</text></g>`;
  },

  _renderCartouche({ session, scale, format, fmt, withProject, ctx, W, H }) {
    const t = session?.terrain ?? {};
    const x = W - fmt.marginMm - 65;
    const y = fmt.marginMm + 22;
    const w = 60;
    const lineH = 4.2;

    const lines = [];
    lines.push({ k: 'Document', v: withProject ? 'Plan masse projet' : "Plan d'état des lieux" });
    lines.push({ k: 'Commune',  v: t.commune ?? '—' });
    lines.push({ k: 'Parcelle', v: `${t.section ?? ''} ${t.parcelle ?? ''}`.trim() || '—' });
    lines.push({ k: 'Contenance', v: t.contenance_m2 ? `${Math.round(t.contenance_m2)} m²` : '—' });
    lines.push({ k: 'Échelle',  v: `1/${scale}` });
    lines.push({ k: 'Format',   v: format });

    if (withProject && ctx.project?.plu) {
      lines.push({ k: 'Zone PLU', v: ctx.project.plu.zone });
      if (ctx.project.plu.ces  != null) lines.push({ k: 'CES max',  v: `${ctx.project.plu.ces}` });
      if (ctx.project.plu.hMax != null) lines.push({ k: 'H max',    v: `${ctx.project.plu.hMax} m` });
    }

    const today = new Date().toISOString().slice(0, 10);
    lines.push({ k: 'Édité le', v: today });

    const rows = lines.map((l, i) => `
  <text x="${(x + 1.5).toFixed(2)}" y="${(y + 4 + i * lineH).toFixed(2)}" font-family="IBM Plex Mono, monospace" font-size="2" fill="${C.textMuted}">${this._esc(l.k)}</text>
  <text x="${(x + w - 1.5).toFixed(2)}" y="${(y + 4 + i * lineH).toFixed(2)}" font-family="IBM Plex Mono, monospace" font-size="2" font-weight="600" fill="${C.text}" text-anchor="end">${this._esc(l.v)}</text>`).join('');

    const hBox = 8 + lines.length * lineH;

    return `<g>
  <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w}" height="${hBox.toFixed(2)}" fill="${C.paper}" stroke="${C.frame}" stroke-width="0.3"/>
  <text x="${(x + w / 2).toFixed(2)}" y="${(y - 1).toFixed(2)}" font-family="Playfair Display, serif" font-size="3" font-weight="700" fill="${C.frame}" text-anchor="middle">TERLAB</text>
  ${rows}
  <text x="${(x + w / 2).toFixed(2)}" y="${(y + hBox + 3).toFixed(2)}" font-family="IBM Plex Mono, monospace" font-size="1.6" fill="${C.textMuted}" text-anchor="middle">Source : IGN Géoplateforme — usage pédagogique</text>
</g>`;
  },

  _errorSVG(msg) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 297 210" width="297mm" height="210mm" style="background:${C.paper}">
  <text x="148.5" y="105" font-family="IBM Plex Mono, monospace" font-size="6" fill="${C.frame}" text-anchor="middle">${this._esc(msg)}</text>
</svg>`;
  },
};

if (typeof window !== 'undefined') {
  window.SitePlanRenderer = SitePlanRenderer;
}

export default SitePlanRenderer;
