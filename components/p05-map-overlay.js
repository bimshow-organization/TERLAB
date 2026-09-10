// ═══════════════════════════════════════════════════════════════════════
// TERLAB · components/p05-map-overlay.js
// LE JARDIN DE LA PARCELLE en 3D au-dessus de la carte Mapbox vivante
// (phase P05 Voisinage), calé par MapboxThreeBridge.
//
// Périmètre volontairement limité À LA PARCELLE — pas de végétation de
// voisinage (l'ortho satellite la montre déjà, et des centaines de
// billboards hors parcelle ne racontent rien tout en coûtant cher).
//
// Source végétation (dans l'ordre) :
//   1. Végétation P06 validée (lecture SEULE)
//   2. Jardin généré par BpfBridge (Poisson disk, espèces par zone
//      climatique, amenities terrasse/piscine/kiosque…) — le même moteur
//      que P07/P11, donc le même jardin d'une phase à l'autre.
//   + arbres LiDAR existants DANS la parcelle, uniquement si les points
//     sont déjà en cache mémoire (JAMAIS de fetch réseau lourd ici — perf).
//
// Rendu : impostors octahedral Z-up pour les espèces avec atlas, géométrie
// procédurale pour les autres, amenities en socles colorés.
//
// @coords
//   project:   TERLAB
//   plan:      XY (scène bridge : X = est, Y = NORD, Z = altitude — Z-up)
//   yAxis:     up (Z)
//   anchor:    geodetic(centroïde du POLYGONE parcelle) — la même origine
//              sert au bridge ET aux coordonnées locales BpfBridge, sinon
//              le jardin serait décalé du fond de carte.
//   units:     meters
//   north:     +Y
//   pairsWith: components/mapbox-three-bridge.js · services/bpf-bridge.js
//   roundtrip: BpfBridge produit {x est, y SUD} → bridge (x, -y, 0).
//              Wrapper procédural Y-up : rotation.x = +π/2, intérieur
//              (x, 0, ySud) → monde (x, -ySud, 0). UN seul flip nord/sud.
//              Carte P05 plate (pas de DEM) → z = 0 partout.
// ═══════════════════════════════════════════════════════════════════════

import MapboxThreeBridge from './mapbox-three-bridge.js';
import ImpostorLoader from '../services/impostor-loader.js';
import { buildImpostorMaterialZUp } from '../services/vegetation/impostor-billboard.js';
import { trianguler } from '../services/toiture/triangulate.js';

const LAT_M = 111320;

const AMENITY_COLORS = {
  piscine: 0x3b8ac4, bassin: 0x2e6b8a, terrasse: 0xb08a5a, pergola: 0x8a6a4a,
  kiosque: 0x9a7850, cuisine_ext: 0x9a8060, potager: 0x6a8a3a, tisanerie: 0x7a9a5a,
};

const P05MapOverlay = {
  _bridge: null,
  _mats: [],
  _vegGroup: null,
  _originMerc: null,
  _meter: 0,
  _plants: [],
  _amenities: [],
  source: null,         // 'P06' | 'Jardin BPF'

  get active() { return !!this._bridge; },

  /**
   * @param {object} o { map, session }  session = SessionManager._data
   * @returns {Promise<{plants:number, amenities:number, source:string}|false>}
   */
  async enable({ map, session } = {}) {
    if (this._bridge) return { plants: this._plants.length, amenities: this._amenities.length, source: this.source };
    const terrain = session?.terrain;
    const ring = this._parcelRing(terrain);
    if (!map || !ring) return false;

    // Origine = centroïde du POLYGONE (et pas terrain.lat/lng : la même
    // origine doit servir au bridge et aux mètres locaux du jardin).
    const clng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
    const clat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
    const lngM = LAT_M * Math.cos(clat * Math.PI / 180);
    // Parcelle en mètres locaux {x est, y SUD} — convention BpfBridge/P06
    const parcelLocal = ring.map(c => ({ x: (c[0] - clng) * lngM, y: -(c[1] - clat) * LAT_M }));

    // Bâti existant (OSM) intersectant la parcelle : exclusion de plantation
    // + emprise passée à BpfBridge. « On ne plante pas là où il y a une
    // construction » — les routes sont hors parcelle, couvertes par le clip.
    const buildingsLocal = await this._buildingFootprintsLocal(clat, clng, lngM, parcelLocal, map);

    // 1. Données jardin (avant le bridge : si rien, on ne crée rien)
    let { plants, amenities } = await this._collectGarden(session, terrain, parcelLocal, buildingsLocal);

    // Clip STRICT : dans la parcelle ET hors de toute emprise bâtie.
    // Ceinture + bretelles quelle que soit la source (P06 / BPF / LiDAR).
    const keep = p => this._pointInPoly(p.x, p.ySud, parcelLocal)
      && !buildingsLocal.some(b => this._pointInPoly(p.x, p.ySud, b));
    const before = plants.length;
    plants = plants.filter(keep);
    amenities = amenities.filter(a => this._pointInPoly(a.x, a.y, parcelLocal)
      && !buildingsLocal.some(b => this._pointInPoly(a.x, a.y, b)));
    if (before !== plants.length) {
      console.info(`[P05Overlay] clip parcelle/bâti : ${before - plants.length} sujets écartés`);
    }
    if (!plants.length && !amenities.length) {
      console.info('[P05Overlay] aucun jardin (ni P06, ni BpfBridge)');
      return false;
    }
    this._plants = plants;
    this._amenities = amenities;
    this._parcelLocal = parcelLocal;

    // 2. Bridge (carte plate → elevation 0, scène statique → PAS d'horloge continue)
    try {
      this._bridge = await MapboxThreeBridge.create({ map, origin: { lng: clng, lat: clat }, elevation: 0 });
    } catch (e) {
      console.warn('[P05Overlay] bridge indisponible :', e?.message ?? e);
      return false;
    }
    this._bridge.setModelCenter({ x: 0, y: 0, z: 0 });   // PIÈGE 3

    // Garantir window.THREE AVANT ImpostorLoader.getTexture (qui rend null
    // sans lui → tout partirait en procédural low-poly). Namespace ESM gelé
    // → clone (convention TERLAB).
    if (typeof window !== 'undefined' && !window.THREE) {
      window.THREE = Object.assign({}, this._bridge.THREE);
    }

    // La carte est recréée à chaque changement de phase : quand elle meurt,
    // l'overlay se démonte proprement (sinon canvas orphelin + erreurs resize).
    map.once('remove', () => { if (this._bridge?.map === map) this.disable(); });

    this._originMerc = mapboxgl.MercatorCoordinate.fromLngLat([clng, clat], 0);
    this._meter = this._originMerc.meterInMercatorCoordinateUnits();

    // 3. Construction
    await this._buildGarden();

    // 4. Par frame : uCameraPos des billboards + fondu INVERSE des quads de
    // canopée (billboards fondus au zénith dans le shader ; les quads, eux,
    // n'apparaissent qu'en plongée — bande complémentaire, pattern web-app).
    this._bridge.onBeforeRender = () => {
      const cam = map.getFreeCameraOptions?.()?.position;
      if (!cam) return;
      const sx = (cam.x - this._originMerc.x) / this._meter;
      const sy = (this._originMerc.y - cam.y) / this._meter;   // mercator sud+ → scène nord+
      const sz = (cam.z ?? 0) / this._meter;
      for (const m of this._mats) m.uniforms?.uCameraPos?.value?.set(sx, sy, sz);

      if (this._canopyMats?.length) {
        const elev = Math.atan2(sz, Math.hypot(sx, sy));        // élévation vers l'origine parcelle
        const t = Math.min(1, Math.max(0, (elev - 0.6) / 0.5)); // bande 0.6→1.1 rad (34°→63°)
        const op = t * t * (3 - 2 * t) * 0.85;                  // smoothstep
        for (const m of this._canopyMats) m.opacity = op;
      }
    };
    map.triggerRepaint();   // un premier rendu (l'horloge continue est coupée)

    return { plants: plants.length, amenities: amenities.length, source: this.source };
  },

  disable() {
    if (!this._bridge) return;
    this._vegGroup?.traverse(o => {
      if (!o.userData?.sharedGeometry) o.geometry?.dispose?.();
      if (o.material && !Array.isArray(o.material)) o.material.dispose?.();
    });
    this._bridge.dispose();
    this._bridge = null;
    this._vegGroup = null;
    this._mats = [];
    this._plants = [];
    this._amenities = [];
    this.source = null;
  },

  // ── Données ──────────────────────────────────────────────────────────

  _parcelRing(terrain) {
    const geom = terrain?.parcelle_geojson;
    const coords = geom?.type === 'Polygon' ? geom.coordinates?.[0] : geom?.coordinates?.[0]?.[0];
    if (!coords || coords.length < 3) return null;
    // Retirer le sommet de fermeture éventuel (ring GeoJSON fermé)
    const ring = coords.slice();
    const a = ring[0], z = ring[ring.length - 1];
    if (a && z && a[0] === z[0] && a[1] === z[1]) ring.pop();
    return ring.length >= 3 ? ring : null;
  },

  _polyArea(poly) {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
    }
    return Math.abs(a / 2);
  },

  /**
   * Emprises bâties (mètres locaux {x, y sud}) touchant la parcelle.
   * Source primaire : la couche bâtiments DE LA CARTE (queryRenderedFeatures
   * — zéro réseau, et c'est exactement ce que l'utilisateur voit à l'écran).
   * Repli : Overpass via BuildingsService (souvent bloqué CORS/429 en local).
   */
  async _buildingFootprintsLocal(clat, clng, lngM, parcelLocal, map) {
    const toLocal = ring => ring.map(c => ({ x: (c[0] - clng) * lngM, y: -(c[1] - clat) * LAT_M }));
    const touchesParcel = loc => {
      const cx = loc.reduce((s, p) => s + p.x, 0) / loc.length;
      const cy = loc.reduce((s, p) => s + p.y, 0) / loc.length;
      return this._pointInPoly(cx, cy, parcelLocal)
        || loc.some(p => this._pointInPoly(p.x, p.y, parcelLocal));
    };

    // 1. Couche carte (auto-découverte : buildings-3d de MapViewer, sinon
    //    toute couche du style dont l'id contient "building")
    try {
      if (map?.queryRenderedFeatures) {
        const layerIds = (map.getStyle()?.layers ?? [])
          .filter(l => /building/i.test(l.id) || /building/i.test(l['source-layer'] ?? ''))
          .map(l => l.id);
        if (layerIds.length) {
          const feats = map.queryRenderedFeatures(undefined, { layers: layerIds });
          const out = [];
          for (const f of feats) {
            const rings = f.geometry?.type === 'Polygon' ? [f.geometry.coordinates[0]]
              : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates.map(c => c[0]) : [];
            for (const ring of rings) {
              if (!ring || ring.length < 4) continue;
              const loc = toLocal(ring);
              if (touchesParcel(loc)) out.push(loc);
            }
          }
          if (out.length) {
            console.info(`[P05Overlay] ${out.length} emprise(s) bâtie(s) sur la parcelle (couche carte)`);
            return out;
          }
        }
      }
    } catch (e) {
      console.info('[P05Overlay] queryRenderedFeatures bâti :', e?.message ?? e);
    }

    // 2. Repli Overpass
    try {
      const BS = window.BuildingsService;
      if (!BS?.fetchBuildings) return [];
      const gj = await BS.fetchBuildings(clat, clng, 150);
      const out = [];
      for (const f of gj?.features ?? []) {
        const ring = f.geometry?.coordinates?.[0];
        if (!ring || ring.length < 4) continue;
        const loc = toLocal(ring);
        if (touchesParcel(loc)) out.push(loc);
      }
      return out;
    } catch (e) {
      console.info('[P05Overlay] bâti OSM indisponible :', e?.message ?? e);
      return [];
    }
  },

  async _collectGarden(session, terrain, parcelLocal, buildingsLocal = []) {
    // 1. P06 validée (lecture seule) — déjà clippée parcelle par la détection
    const feats = session?.phases?.p06?.vegetation?.features;
    if (feats?.length) {
      this.source = 'P06';
      return {
        plants: feats
          .filter(f => f.status !== 'existing_cut')
          .map(f => ({
            x: f.positionLocal?.x ?? 0,
            ySud: f.positionLocal?.y ?? 0,
            speciesKey: f.speciesKey ?? 'palm_coconut',
            canopyRadius: f.canopyRadiusMeasured ?? 3,
            height: f.heightMeasured,
            color2D: f.speciesCandidates?.[0]?.color2D,
          })),
        amenities: [],
      };
    }

    // 2. Jardin BPF généré (le moteur de P07/P11 — même jardin partout)
    let plants = [], amenities = [];
    try {
      const BpfBridge = window.BpfBridge
        ?? (await import('../services/bpf-bridge.js')).default;
      // edgeTypes : ceux de P07 si l'esquisse a tourné, sinon voie sur la
      // première arête + latéral partout (suffisant pour zoner le jardin)
      const edgeTypes = (session?._edgeTypes?.length === parcelLocal.length)
        ? session._edgeTypes
        : parcelLocal.map((_, i) => (i === 0 ? 'voie' : 'lateral'));
      // Emprise bâtie : le plus grand bâtiment EXISTANT sur la parcelle (OSM),
      // sinon la proposition retenue de P07/P11 si elle existe
      const prop = session?.phases?.p11?.data?.proposition_retenue
        ?? session?.phases?.[11]?.data?.proposition_retenue
        ?? session?.phases?.p7?.data?.proposition_retenue
        ?? session?.phases?.[7]?.data?.proposition_retenue;
      const biggest = buildingsLocal.length
        ? buildingsLocal.reduce((a, b) => (this._polyArea(b) > this._polyArea(a) ? b : a))
        : null;
      const buildingPoly = biggest ?? prop?.polygon ?? [];

      const result = await BpfBridge.generate(session, parcelLocal, edgeTypes, buildingPoly, null);
      if (result?.error) {
        console.info('[P05Overlay] BpfBridge :', result.error);
      } else {
        this.source = 'Jardin BPF';
        plants = (result?.plants ?? []).map(p => ({
          x: p.x, ySud: p.y,
          speciesKey: p.speciesKey,
          canopyRadius: p.canopyRadius ?? 2,
          height: p.trunkH,
          color2D: p.color2D,
        }));
        amenities = result?.amenities ?? [];
      }
    } catch (e) {
      console.warn('[P05Overlay] BpfBridge indisponible :', e?.message ?? e);
    }

    // 3. + arbres LiDAR existants DANS la parcelle — cache mémoire SEULEMENT
    //    (jamais de fetch ici : c'est un enrichissement, pas un prérequis)
    try {
      const LS = window.LidarService, LCS = window.LidarContextService;
      const raw = LS?.getRawPoints?.();
      if (raw?.length && LCS) {
        const ctx = LCS.process(raw, terrain.parcelle_geojson, null);
        const inParcel = (x, ySud) => this._pointInPoly(x, ySud, parcelLocal);
        const existing = (ctx?.trees ?? [])
          .map(t => ({ x: t.x, ySud: -t.z, h: t.height, r: t.radiusM }))
          .filter(t => inParcel(t.x, t.ySud))
          .map(t => ({
            x: t.x, ySud: t.ySud,
            speciesKey: (t.h ?? 0) > 6 ? 'palm_coconut' : 'tamarind',
            canopyRadius: Math.max(1.5, Math.min(5, t.r ?? (t.h ?? 6) * 0.35)),
            height: t.h,
          }));
        if (existing.length) {
          plants = plants.concat(existing);
          this.source = this.source ? `${this.source} + LiDAR` : 'LiDAR';
        }
      }
    } catch { /* enrichissement optionnel */ }

    return { plants, amenities };
  },

  _pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  },

  // ── Rendu ────────────────────────────────────────────────────────────

  // Texture radiale de canopée (vue de dessus) — cache par couleur
  _canopyTexCache: new Map(),
  _canopyTexture(THREE, hex) {
    const key = hex || '#3f6f45';
    if (this._canopyTexCache.has(key)) return this._canopyTexCache.get(key);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    g.addColorStop(0, key);
    g.addColorStop(0.72, key);
    g.addColorStop(1, key + '00');   // bord transparent (hex 6 digits + alpha)
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace ?? tex.colorSpace;
    this._canopyTexCache.set(key, tex);
    return tex;
  },

  async _buildGarden() {
    const THREE = this._bridge.THREE;
    const group = new THREE.Group();
    group.name = 'p05-jardin';
    this._vegGroup = group;
    this._bridge.scene.add(group);

    // ── Sol du jardin : voile de pelouse clipé à la parcelle ──
    // Semi-transparent (0.5) : le grain de l'ortho reste lisible dessous, et
    // le bâti existant (dessiné par la CARTE, sous notre canvas) transparaît.
    if (this._parcelLocal?.length >= 3) {
      const ring = this._parcelLocal.map(p => [p.x, p.y]);
      const tris = trianguler(ring);
      const pos = [];
      for (const [i, j, k] of tris) {
        for (const idx of [i, j, k]) {
          pos.push(ring[idx][0], -ring[idx][1], 0.02);   // y sud → nord = -y
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const lawn = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: 0x7aa05a, roughness: 1, metalness: 0,
        transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
      }));
      lawn.name = 'jardin-pelouse';
      group.add(lawn);
    }

    // ── Ombres de contact au pied de chaque sujet ──
    // « Une plante sans ombre au pied flotte au-dessus du sol » — disque
    // sombre instancié, coût nul, gain de crédibilité disproportionné.
    if (this._plants.length) {
      const shGeo = new THREE.CircleGeometry(1, 12);   // plan XY → à plat en Z-up
      const shMat = new THREE.MeshBasicMaterial({
        color: 0x08140a, transparent: true, opacity: 0.26, depthWrite: false,
      });
      const sh = new THREE.InstancedMesh(shGeo, shMat, this._plants.length);
      sh.name = 'jardin-ombres';
      sh.frustumCulled = false;
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion();
      const S = new THREE.Vector3(), P = new THREE.Vector3();
      for (let i = 0; i < this._plants.length; i++) {
        const p = this._plants[i];
        const r = (p.canopyRadius ?? 2) * 0.8;
        P.set(p.x, -p.ySud, 0.05);
        S.set(r, r, 1);
        Q.set(0, 0, 0, 1);
        M.compose(P, Q, S);
        sh.setMatrixAt(i, M);
      }
      sh.instanceMatrix.needsUpdate = true;
      group.add(sh);
    }

    // ── Amenities : socles colorés (terrasse, piscine, kiosque…) ──
    for (const am of this._amenities) {
      const w = am.w ?? 3, h = am.h ?? 3;
      const geo = new THREE.BoxGeometry(w, h, 0.15);
      const mat = new THREE.MeshStandardMaterial({
        color: AMENITY_COLORS[am.amenityKey] ?? 0x9a8a6a,
        roughness: 0.8, transparent: true, opacity: 0.9,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(am.x, -am.y, 0.075);   // y BPF = sud → scène nord = -y
      mesh.name = `amenity-${am.amenityKey}`;
      group.add(mesh);
    }

    // ── Végétation ──
    const bySpecies = {};
    for (const p of this._plants) (bySpecies[p.speciesKey] ??= []).push(p);

    // Quads horizontaux de canopée (vue de dessus) — l'atlas impostor n'a
    // AUCUNE vue zénithale : quand la caméra passe au-dessus, le billboard
    // se fond (shader) et c'est ce quad, naturellement invisible de profil,
    // qui raconte la canopée (pattern hybride côté+dessus de la web-app).
    this._canopyMats = [];
    for (const [, list] of Object.entries(bySpecies)) {
      const tex = this._canopyTexture(THREE, list[0]?.color2D);
      const geo = new THREE.PlaneGeometry(1, 1);       // plan XY → horizontal en Z-up
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      });
      this._canopyMats.push(mat);   // opacité pilotée par l'élévation caméra (hook)
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      inst.name = 'jardin-canopees';
      inst.frustumCulled = false;
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion();
      const S = new THREE.Vector3(), P = new THREE.Vector3();
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const r = (p.canopyRadius ?? 2);
        const h = (p.height && p.height > 1) ? p.height * 0.72 : r * 1.5;
        P.set(p.x, -p.ySud, h);                        // à hauteur de couronne
        S.set(r * 2, r * 2, 1);
        Q.set(0, 0, 0, 1);
        M.compose(P, Q, S);
        inst.setMatrixAt(i, M);
      }
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
    }

    const procedural = [];
    let impostorCount = 0;

    for (const [speciesKey, list] of Object.entries(bySpecies)) {
      let tex = null;
      try { tex = await ImpostorLoader.getTexture(speciesKey); } catch { /* offline */ }
      if (!tex) { procedural.push({ speciesKey, list }); continue; }

      const mat = buildImpostorMaterialZUp(THREE, tex);
      this._mats.push(mat);
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.translate(0, 0.5, 0);
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      inst.name = `veg-${speciesKey}`;
      inst.frustumCulled = false;

      const M = new THREE.Matrix4(), Q = new THREE.Quaternion();
      const S = new THREE.Vector3(), P = new THREE.Vector3();
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const radM = p.canopyRadius ?? 2;
        P.set(p.x, -p.ySud, 0);
        S.set(radM * 2, (p.height && p.height > 1) ? p.height : radM * 2.2, 1);
        Q.set(0, 0, 0, 1);
        M.compose(P, Q, S);
        inst.setMatrixAt(i, M);
      }
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
      impostorCount += list.length;
    }

    // Espèces sans atlas → géométrie procédurale (Y-up natif, wrapper +90°X)
    let procCount = 0;
    if (procedural.length) {
      try {
        const SG = await import('../services/vegetation/species-geometry.js');
        await SG.initSpeciesGeometry();
        const yUpWrap = new THREE.Group();
        yUpWrap.rotation.x = Math.PI / 2;
        group.add(yUpWrap);
        const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });

        for (const { speciesKey, list } of procedural) {
          let built = null;
          try { built = SG.buildSpeciesGeometry(speciesKey, 0, { tint: list[0]?.color2D }); } catch { /* bam */ }
          if (!built?.geometry) {
            console.warn(`[P05Overlay] espèce sans impostor ni géométrie : ${speciesKey} (${list.length})`);
            continue;
          }
          const inst = new THREE.InstancedMesh(built.geometry, mat, list.length);
          inst.name = `veg-proc-${speciesKey}`;
          inst.userData.sharedGeometry = true;
          inst.frustumCulled = false;
          const M = new THREE.Matrix4(), Q = new THREE.Quaternion();
          const S = new THREE.Vector3(), P = new THREE.Vector3(), E = new THREE.Euler();
          for (let i = 0; i < list.length; i++) {
            const p = list[i];
            const s = Math.max(0.5, Math.min(2, (p.canopyRadius ?? 2) / (built.canopyRadius || 2)));
            P.set(p.x, 0, p.ySud);
            E.set(0, (Math.abs(Math.round(p.x * 31 + p.ySud * 17)) % 360) * Math.PI / 180, 0);
            Q.setFromEuler(E);
            S.set(s, s, s);
            M.compose(P, Q, S);
            inst.setMatrixAt(i, M);
          }
          inst.instanceMatrix.needsUpdate = true;
          yUpWrap.add(inst);
          procCount += list.length;
        }
      } catch (e) {
        console.warn('[P05Overlay] species-geometry indisponible :', e?.message ?? e);
      }
    }

    console.info(`[P05Overlay] jardin : ${impostorCount} impostors + ${procCount} géométries + ${this._amenities.length} aménités (${this.source})`);
  },
};

export default P05MapOverlay;
