// TERLAB · services/corpus-collector.js
// Collecteur de cas réels depuis IGN WFS (parcelles) + BDTopo (bâtiments)
// ENSA La Réunion · MGA Architecture 2026
// Vanilla JS ES2022+ · Aucune dépendance externe

import FH from './footprint-helpers.js';

// ─── Constantes ───────────────────────────────────────────────────────────────
const IGN_WFS_BASE   = 'https://data.geopf.fr/wfs/ows';
const BDTOPO_WFS     = 'https://data.geopf.fr/wfs/ows';
const GEOREF_BASE    = 'https://data.geopf.fr/geocodage/search';
const AGORAH_WMS     = 'https://peigeo.re:8080/geoserver/wfs';

// Couches BDTopo pertinentes
const BDTOPO_BATI_LAYER = 'BDTOPO_V3:batiment';    // bâtiments avec hauteur
const BDTOPO_ADDR_LAYER = 'BDTOPO_V3:adresse';

// WGS84 → UTM40S EPSG:2975 (approx locale Réunion — précision ~1m)
const WGS84_TO_LOCAL = (lng, lat, refLng, refLat) => {
  const LNG_M = 111320 * Math.cos(refLat * Math.PI / 180);
  const LAT_M = 111320;
  return {
    x:  (lng - refLng) * LNG_M,
    y: -(lat - refLat) * LAT_M,   // Y↑ nord (inverser pour SVG Y↓)
  };
};

// ─── CorpusCollector ──────────────────────────────────────────────────────────
const CorpusCollector = {

  // ── 1. Géocodage adresse → bbox ─────────────────────────────────────────────
  async geocodeAddress(address) {
    const url = `${GEOREF_BASE}?q=${encodeURIComponent(address)}&limit=1&type=housenumber,street`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Géocodage erreur ${r.status}`);
    const data = await r.json();
    const feat = data.features?.[0];
    if (!feat) throw new Error(`Adresse introuvable : ${address}`);
    const [lng, lat] = feat.geometry.coordinates;
    return { lng, lat, label: feat.properties.label };
  },

  // ── 2. Recherche parcelle IGN WFS par bbox ou ref cadastrale ────────────────
  async fetchParcelByRef(refCad) {
    // refCad = "97408000AB0042" (code commune + section + numéro)
    const filter = `<Filter xmlns:ogc="http://www.opengis.net/ogc">
      <PropertyIsEqualTo>
        <PropertyName>numero</PropertyName>
        <Literal>${refCad}</Literal>
      </PropertyIsEqualTo>
    </Filter>`;
    return this._wfsFetch(IGN_WFS_BASE, 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle', filter);
  },

  async fetchParcelByPoint(lng, lat, bufferM = 5) {
    // Buffer approximatif en degrés
    const dLng = bufferM / (111320 * Math.cos(lat * Math.PI / 180));
    const dLat = bufferM / 111320;
    const bbox = `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}`;
    const url = `${IGN_WFS_BASE}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature`
      + `&TYPENAMES=CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle`
      + `&BBOX=${bbox},EPSG:4326&outputFormat=application/json&count=1`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`WFS parcelle erreur ${r.status}`);
    return r.json();
  },

  // ── 3. Bâtiments BDTopo dans le bbox de la parcelle ─────────────────────────
  async fetchBuildingsForParcel(parcelBbox, { bufferM = 2 } = {}) {
    // parcelBbox = { minLng, maxLng, minLat, maxLat }
    const dLng = bufferM / (111320 * Math.cos(((parcelBbox.minLat + parcelBbox.maxLat) / 2) * Math.PI / 180));
    const dLat = bufferM / 111320;
    const bbox = `${parcelBbox.minLng - dLng},${parcelBbox.minLat - dLat},${parcelBbox.maxLng + dLng},${parcelBbox.maxLat + dLat}`;
    const url = `${BDTOPO_WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature`
      + `&TYPENAMES=${BDTOPO_BATI_LAYER}`
      + `&BBOX=${bbox},EPSG:4326&outputFormat=application/json`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`BDTopo bâtiments erreur ${r.status}`);
    return r.json();
  },

  // ── 4. Récupération DEM (altitude + pente) ──────────────────────────────────
  async fetchAltitudeAtPoint(lng, lat) {
    // Utilise le service IGN Altimétrie
    const url = `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json`
      + `?lon=${lng}&lat=${lat}&resource=ign_rge_alti_wld&zonly=true`;
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const d = await r.json();
      return d?.elevations?.[0]?.z ?? null;
    } catch { return null; }
  },

  // ── 5. Pipeline complet : adresse → cas corpus ──────────────────────────────
  async collectCase(opts) {
    // opts = {
    //   address?:    '12 rue des Lataniers, Saint-Denis',
    //   refCad?:     '97411000AB0042',
    //   lat?, lng?:  coordonnées directes
    //   plu:         { zone, recul_voie_m, ... }   — données PLU manuelles
    //   meta:        { commune, annee_construction, source, ... }
    // }

    let lat = opts.lat, lng = opts.lng;

    // 1. Géocodage si nécessaire
    if (!lat && opts.address) {
      const geo = await this.geocodeAddress(opts.address);
      lat = geo.lat; lng = geo.lng;
    }
    if (!lat) throw new Error('Aucune coordonnée disponible');

    // 2. Parcelle IGN
    let parcelGeoJSON;
    if (opts.refCad) {
      parcelGeoJSON = await this.fetchParcelByRef(opts.refCad);
    } else {
      parcelGeoJSON = await this.fetchParcelByPoint(lng, lat);
    }

    const parcelFeat = parcelGeoJSON.features?.[0];
    if (!parcelFeat) throw new Error('Parcelle non trouvée');

    // 3. Conversion → local mètres
    const ring = parcelFeat.geometry.coordinates[0];   // [lng, lat][]
    const refLng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
    const refLat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
    const parcelleLoc = ring.slice(0, -1).map(([cLng, cLat]) => WGS84_TO_LOCAL(cLng, cLat, refLng, refLat));

    // 4. Métriques parcelle
    const parcelXY = parcelleLoc.map(p => ({ x: p.x, y: p.y }));
    const parcelArea  = FH.area(parcelXY);
    const parcelPerim = FH.perimeter(parcelXY);
    const obb         = FH.obb(parcelXY);
    const shapeRatio  = obb.l > 0 ? (obb.w > obb.l ? obb.w / obb.l : obb.l / obb.w) : 1;

    // 5. bbox WGS84 pour BDTopo
    const lngs = ring.map(c => c[0]), lats = ring.map(c => c[1]);
    const parcelBbox = {
      minLng: Math.min(...lngs), maxLng: Math.max(...lngs),
      minLat: Math.min(...lats), maxLat: Math.max(...lats),
    };

    // 6. Bâtiments réels BDTopo
    const batiGeoJSON = await this.fetchBuildingsForParcel(parcelBbox);
    const blocs = this._parseBDTopoBuildings(batiGeoJSON, refLng, refLat, parcelXY);

    // 7. Altitude
    const altNGR = await this.fetchAltitudeAtPoint(refLng, refLat);

    // 8. Métriques réelles
    const metriques = this._computeMetriques(parcelleLoc, blocs, opts.plu || {});

    // 9. Comparable filters
    const filters = this._computeFilters(parcelArea, metriques, opts.plu || {}, obb);

    // 10. Construction du cas
    const id = this._generateId(opts.meta?.commune, opts.meta?.annee_construction);
    const cas = {
      id,
      meta: {
        commune:             opts.meta?.commune || parcelFeat.properties?.commune || '?',
        code_insee:          parcelFeat.properties?.commune || null,
        annee_construction:  opts.meta?.annee_construction || new Date().getFullYear(),
        source:              opts.meta?.source || 'estimation',
        statut:              'a_verifier',
        date_annotation:     new Date().toISOString().split('T')[0],
        refs: {
          cadastre_id:  parcelFeat.properties?.id || null,
          bdtopo_count: blocs.length,
        },
        notes:               opts.meta?.notes || '',
      },
      parcelle: {
        geojson_wgs84:      parcelFeat,
        geojson_local:      parcelleLoc,
        centroid_utm40s:    [refLng, refLat],
        surface_m2:         Math.round(parcelArea),
        perimetre_m:        Math.round(parcelPerim * 10) / 10,
        shape_ratio:        Math.round(shapeRatio * 100) / 100,
        obb_theta_deg:      Math.round(obb.theta * 180 / Math.PI * 10) / 10,
        bearing_voie_deg:   null,   // à renseigner manuellement ou via TerrainP07Adapter
        edge_types:         null,   // idem
        topographie: {
          pente_moy_pct:    null,   // à remplir via DEM analysis
          azimut_pente_deg: null,
          topo_case_id:     'flat', // par défaut
          altitude_ngr_m:   altNGR,
        },
      },
      plu:    opts.plu || {},
      bat_reel: {
        blocs,
        type_programme:      this._guessProgramme(blocs, opts.plu),
        niveaux:             blocs.length ? Math.max(...blocs.map(b => b.niveaux || 1)) : 1,
        surface_emprise_m2:  Math.round(blocs.reduce((s, b) => s + (b.surface_m2 || 0), 0)),
        surface_plancher_m2: null,
        n_logements:         null,
        parking_ss:          false,
        has_pilotis:         false,
        shape_type:          this._guessShapeType(blocs),
        strategy_guess:      'inconnu',
        orientation_deg:     blocs.length ? blocs[0].obb_theta_deg : null,
        source_bdtopo:       blocs.length > 0,
      },
      metriques_reelles:     metriques,
      comparable_filters:    filters,
      engine_results:        null,   // rempli par corpus-runner.js
    };

    return cas;
  },

  // ── Batch collecte sur une liste d'adresses ──────────────────────────────────
  async collectBatch(list, { onProgress, onError, delayMs = 800 } = {}) {
    // list = [{ address?, refCad?, lat?, lng?, plu, meta }, ...]
    const results = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      try {
        onProgress?.({ i, total: list.length, item, status: 'fetching' });
        const cas = await this.collectCase(item);
        results.push({ ok: true, cas });
        onProgress?.({ i, total: list.length, id: cas.id, status: 'ok' });
      } catch (err) {
        onError?.({ i, item, err });
        results.push({ ok: false, item, err: err.message });
      }
      // Respect délai entre requêtes IGN
      if (i < list.length - 1 && delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
    return results;
  },

  // ── Internes ─────────────────────────────────────────────────────────────────
  async _wfsFetch(base, typeName, cqlFilter) {
    const params = new URLSearchParams({
      SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature',
      TYPENAMES: typeName,
      outputFormat: 'application/json',
      count: 10,
    });
    if (cqlFilter) params.set('CQL_FILTER', cqlFilter);
    const r = await fetch(`${base}?${params}`);
    if (!r.ok) throw new Error(`WFS erreur ${r.status}`);
    return r.json();
  },

  _parseBDTopoBuildings(geoJSON, refLng, refLat, parcelXY) {
    if (!geoJSON?.features?.length) return [];
    const blocs = [];
    for (const feat of geoJSON.features) {
      const geom = feat.geometry;
      if (!geom) continue;
      const rings = geom.type === 'Polygon'
        ? [geom.coordinates[0]]
        : geom.type === 'MultiPolygon'
          ? geom.coordinates.map(p => p[0])
          : [];
      for (const ring of rings) {
        const localPts = ring.slice(0, -1).map(([cLng, cLat]) => WGS84_TO_LOCAL(cLng, cLat, refLng, refLat));
        if (localPts.length < 3) continue;
        const localXY = localPts.map(p => ({ x: p.x, y: p.y }));
        // Vérifier intersection avec parcelle
        const centroid = FH.centroid(localXY);
        if (!FH.pointInPoly(centroid.x, centroid.y, parcelXY)) continue;
        const area = FH.area(localXY);
        if (area < 10) continue;
        const obb = FH.obb(localXY);
        const niveaux = feat.properties?.nombre_d_etages ?? feat.properties?.nombre_etages ?? 1;
        const hEgout  = feat.properties?.hauteur ?? niveaux * 3.2;
        blocs.push({
          polygon_local:   localXY,
          niveaux:         Math.max(1, parseInt(niveaux)),
          hauteur_egout_m: parseFloat(hEgout) || niveaux * 3.2,
          hauteur_faitage_m: null,
          obb_theta_deg:   Math.round(obb.theta * 180 / Math.PI * 10) / 10,
          surface_m2:      Math.round(area),
          type_bloc:       'principal',
          bdtopo_id:       feat.properties?.id || null,
        });
      }
    }
    // Trier par surface décroissante
    blocs.sort((a, b) => b.surface_m2 - a.surface_m2);
    return blocs;
  },

  _computeMetriques(parcelLoc, blocs, plu) {
    const parcelXY  = parcelLoc.map(p => ({ x: p.x, y: p.y }));
    const parcelArea = FH.area(parcelXY);
    const emprise    = blocs.reduce((s, b) => s + (b.surface_m2 || 0), 0);
    const ces_reel   = parcelArea > 0 ? emprise / parcelArea : 0;
    const niv        = blocs.length ? Math.max(...blocs.map(b => b.niveaux || 1)) : 1;
    const sp_approx  = emprise * 0.82 * niv;
    const cos_reel   = parcelArea > 0 ? sp_approx / parcelArea : 0;
    const permea     = Math.max(0, 100 - ces_reel * 100);

    // Distances par rapport aux arêtes
    const mainBloc = blocs[0];
    let recul_voie = null, recul_fond = null;
    if (mainBloc) {
      const ys = parcelXY.map(p => p.y);
      const maxY = Math.max(...ys), minY = Math.min(...ys);
      const bys  = mainBloc.polygon_local.map(p => p.y);
      recul_voie = Math.max(0, maxY - Math.max(...bys));
      recul_fond = Math.max(0, Math.min(...bys) - minY);
    }

    return {
      ces_reel:             Math.round(ces_reel * 1000) / 1000,
      cos_reel:             Math.round(cos_reel * 100) / 100,
      permea_pct:           Math.round(permea),
      ratio_recul_voie_m:   recul_voie !== null ? Math.round(recul_voie * 10) / 10 : null,
      ratio_recul_fond_m:   recul_fond !== null ? Math.round(recul_fond * 10) / 10 : null,
      surface_emprise_m2:   Math.round(emprise),
      conforme_plu: (
        ces_reel <= ((plu.ces_max_pct || 70) / 100) + 0.02 &&
        (plu.hauteur_egout_max_m == null || (blocs[0]?.hauteur_egout_m || 0) <= plu.hauteur_egout_max_m + 0.3)
      ),
    };
  },

  _computeFilters(parcelArea, metriques, plu, obb) {
    const shapeRatio = obb.l > 0 ? Math.max(obb.w, obb.l) / Math.min(obb.w, obb.l) : 1;
    return {
      bucket_surface:  parcelArea < 300 ? 'XS_<300' : parcelArea < 600 ? 'S_300-600' : parcelArea < 1200 ? 'M_600-1200' : parcelArea < 3000 ? 'L_1200-3000' : 'XL_>3000',
      bucket_pente:    'flat',   // à remplir depuis DEM
      bucket_shape:    shapeRatio < 1.5 ? 'carre' : shapeRatio < 2.5 ? 'allonge' : shapeRatio < 3.5 ? 'etroit' : 'complexe',
      bucket_ces:      metriques.ces_reel < 0.4 ? 'libre_<40' : metriques.ces_reel < 0.6 ? 'moyen_40-60' : 'dense_>60',
      groupe_plu:      plu.zone || 'UA',
      has_mitoyen:     !!(plu.mitoyen_g || plu.mitoyen_d),
      has_slope_constraint: false,   // à dériver de topo_case
    };
  },

  _guessProgramme(blocs, plu) {
    if (!blocs.length) return 'collectif_moyen';
    const niv = Math.max(...blocs.map(b => b.niveaux || 1));
    const area = blocs.reduce((s, b) => s + (b.surface_m2 || 0), 0);
    if (niv >= 4 && area > 500) return 'collectif_grand';
    if (niv >= 2 && area > 200) return 'collectif_moyen';
    if (niv >= 2) return 'collectif_petit';
    if (blocs.length > 1) return 'bande';
    return 'collectif_petit';
  },

  _guessShapeType(blocs) {
    if (!blocs.length) return 'rect';
    if (blocs.length >= 3) return 'multi_barres';
    if (blocs.length === 2) return 'l_shape';
    const b = blocs[0];
    if (!b.polygon_local || b.polygon_local.length < 5) return 'rect';
    return b.polygon_local.length > 6 ? 'irregular' : 'rect';
  },

  _generateId(commune, year) {
    const comm = (commune || 'REUNION').toUpperCase().replace(/\s+/g, '_').substring(0, 12);
    const yr   = year || new Date().getFullYear();
    const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
    return `REUNION_${comm}_${yr}_${rand}`;
  },
};

export default CorpusCollector;
