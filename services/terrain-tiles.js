// ═══════════════════════════════════════════════════════════════════════
// TERLAB · services/terrain-tiles.js
// Grille GLOBALE de tiles MNT 500 m alignees sur les km UTM40S (EPSG:2975)
// — 1 dalle COPC IGN 1 km = exactement 4 tiles (2×2).
// Source DEM : WMS-R IGN ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES (BIL float32)
// Drapage optionnel : WMS ORTHOIMAGERY.ORTHOPHOTOS (une texture par tile).
// Cache IndexedDB `terlab_tiles` (cle "tx:ty:lod", SANS sessionId — une tile
// de terrain est partageable entre projets).
//
// La math de grille (snap global, bounds, LOD) est en EXPORTS NOMMES PURS
// (zero THREE, zero DOM, zero reseau) : testable sous Node par
// scripts/probe-tiles.mjs. Le mesh building (buildTileMesh/applyOrtho) est
// a part et charge THREE paresseusement.
//
// @coords
//   project:   TERLAB
//   plan:      XZ (Three.js Y-up produit DIRECTEMENT — pas de rotateX par tile)
//   yAxis:     up (Y = altitude NGR relative a origin.alt)
//   anchor:    geodetic(lng,lat) → origin UTM40S {E0, N0, alt0} UNIQUE de scene
//   units:     meters
//   bearing:   none
//   north:     -Z (le nord UTM est en −Z : z = −(N − N0))
//   pairsWith: services/terrain-tile-manager.js
//   roundtrip: E = x + E0 ; N = N0 − z ; alt = y + alt0
//
// Mapping axe par axe (axial remap + y-flip UNIQUE sur le nord) :
//   x3D = E   − origin.E0     (est UTM → +X)
//   y3D = alt − origin.alt0   (altitude NGR → +Y)
//   z3D = −(N − origin.N0)    (nord UTM → −Z ; LE SEUL flip de la chaine)
// Toutes les tiles partagent CE repere : aucune rotation par tile, aucun
// recentrage par tile — l'appelant n'applique NI rotateX NI scale.
//
// External source: IGN RGE Alti via WMS-R BIL float32
// Native convention: raster row 0 = NORD (haut image), E croissant vers l'est
// Converted here to: Y-up Three, nord en −Z (voir mapping ci-dessus)
// ═══════════════════════════════════════════════════════════════════════

/* ═══ 1 · MATH DE GRILLE PURE (exports testables sous Node) ═══════════════ */

/** Taille de tile en metres — 500 m ⇒ 4 tiles par dalle COPC IGN de 1 km. */
export const TILE_SIZE_M = 500;

/** Resolutions DEM par palier LOD (m/px). Index 0 = le plus fin. */
export const LOD_PIXEL_SIZES = [1, 2, 4, 8];

/**
 * Erreur geometrique par palier (m), consommee par BiomeLOD.pickLod.
 * Ordre IMPOSE fin → grossier (meme index que LOD_PIXEL_SIZES) : pickLod
 * parcourt du plus grossier au plus fin. On prend l'erreur = taille de pixel :
 * un MNT echantillonne a p metres ne peut pas restituer un relief plus fin.
 */
export const LOD_GEOMETRIC_ERRORS = [1, 2, 4, 8];

/** Profondeur des jupes (m) — rideau vertical anti-craquelures inter-LOD. */
export const SKIRT_DEPTH_M = 2;

/** Guard WMS-R : jamais plus de 512 px par axe et par requete. */
export const MAX_WMS_PX = 512;

/**
 * Snap pixel-CENTRE partage GLOBAL (repris de bil-terrain._snap).
 * Rend une valeur de la forme (k + 0.5) * px, k entier : deux tiles voisines
 * qui snappent leur frontiere commune obtiennent LA MEME valeur, donc
 * echantillonnent la meme grille RGE Alti — aucun decalage sub-pixel.
 */
export function snapGlobal(v, px) {
  return (Math.round(v / px - 0.5) + 0.5) * px;
}

/** Tile (tx, ty) contenant le point UTM40S (E, N). */
export function tileForUTM(E, N) {
  return { tx: Math.floor(E / TILE_SIZE_M), ty: Math.floor(N / TILE_SIZE_M) };
}

/** Emprise UTM40S nominale de la tile (tx, ty). */
export function tileBounds(tx, ty) {
  return {
    minE: tx * TILE_SIZE_M,
    minN: ty * TILE_SIZE_M,
    maxE: (tx + 1) * TILE_SIZE_M,
    maxN: (ty + 1) * TILE_SIZE_M,
  };
}

/** Cle de cache — SANS sessionId : une tile de terrain est inter-projets. */
export function tileKey(tx, ty, lod) {
  return `${tx}:${ty}:${lod}`;
}

/** Dalle COPC IGN 1 km (kx, ky) contenant la tile — 4 tiles par dalle. */
export function copcDalleForTile(tx, ty) {
  return { kx: Math.floor(tx / 2), ky: Math.floor(ty / 2) };
}

/**
 * Grille d'echantillonnage d'une tile a un palier LOD donne.
 * Les bords de tile sont snappes sur la grille pixel-centre GLOBALE : deux
 * tiles voisines partagent EXACTEMENT leur colonne/ligne d'echantillons de
 * frontiere (meme E ou N absolu → meme altitude → pas de craquelure au meme
 * LOD ; les jupes couvrent le cas inter-LOD).
 * `bbox` est la requete WMS (bords de pixels) telle que le centre du pixel i
 * tombe sur minE + i*px — convention RGE Alti pixel-centre.
 */
export function tileGrid(tx, ty, lod) {
  const px = LOD_PIXEL_SIZES[lod];
  if (!px) throw new Error(`[TerrainTiles] LOD invalide : ${lod}`);
  const b = tileBounds(tx, ty);
  const minE = snapGlobal(b.minE, px);
  const maxE = snapGlobal(b.maxE, px);
  const minN = snapGlobal(b.minN, px);
  const maxN = snapGlobal(b.maxN, px);
  const W = Math.round((maxE - minE) / px) + 1;
  const H = Math.round((maxN - minN) / px) + 1;
  if (W > MAX_WMS_PX || H > MAX_WMS_PX) {
    throw new Error(`[TerrainTiles] grille ${W}x${H} > ${MAX_WMS_PX} px — LOD ${lod} incoherent`);
  }
  return {
    px, W, H,
    minE, minN, maxE, maxN,                     // extent des CENTRES d'echantillons
    bbox: [minE - px / 2, minN - px / 2, minE + (W - 0.5) * px, minN + (H - 0.5) * px],
  };
}

/**
 * Tiles dans un rayon (distance de Chebyshev) autour de la tile centrale.
 * Ordre spirale-approx : triees par distance de grille croissante, pour que
 * la file de chargement serve d'abord le centre.
 */
export function tilesInRadius(ctx, cty, radiusTiles) {
  const out = [];
  for (let dy = -radiusTiles; dy <= radiusTiles; dy++) {
    for (let dx = -radiusTiles; dx <= radiusTiles; dx++) {
      out.push({ tx: ctx + dx, ty: cty + dy, ring: Math.max(Math.abs(dx), Math.abs(dy)) });
    }
  }
  out.sort((a, b) => a.ring - b.ring);
  return out;
}

/**
 * Centre de tile dans le repere local de scene (voir @coords).
 * `groundY` : altitude locale estimee du sol (0 par defaut).
 */
export function tileCenterLocal(tx, ty, origin, groundY = 0) {
  return {
    x: (tx + 0.5) * TILE_SIZE_M - origin.E0,
    y: groundY,
    z: -((ty + 0.5) * TILE_SIZE_M - origin.N0),
  };
}

/**
 * Priorisation : copie triee par distance 3D croissante a la camera locale.
 * Pur — `camLocal` = {x, y, z} dans le repere de scene.
 */
export function sortTilesByDistance(tiles, camLocal, origin, groundY = 0) {
  return tiles
    .map(t => {
      const c = tileCenterLocal(t.tx, t.ty, origin, groundY);
      return { ...t, distance: Math.hypot(c.x - camLocal.x, c.y - (camLocal.y ?? 0), c.z - camLocal.z) };
    })
    .sort((a, b) => a.distance - b.distance);
}

/* ═══ 2 · CACHE INDEXEDDB (pattern lidar-cache.js, guards Node) ═══════════ */

const DB_NAME = 'terlab_tiles';
const DB_VERSION = 1;
const STORE = 'tiles';
let _dbPromise = null;

function _openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function _req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function _cacheGet(key) {
  try {
    const db = await _openDb();
    if (!db) return null;
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    return (await _req(store.get(key))) ?? null;
  } catch (err) {
    console.warn('[TerrainTiles] cache get echec:', err?.message ?? err);
    return null;
  }
}

async function _cachePut(key, record) {
  try {
    const db = await _openDb();
    if (!db) return;
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    await _req(store.put(record, key));
  } catch (err) {
    console.warn('[TerrainTiles] cache put echec:', err?.message ?? err);
  }
}

/* ═══ 3 · SERVICE (reseau + THREE, navigateur) ════════════════════════════ */

const WMSR_BASE = 'https://data.geopf.fr/wms-r';
const CRS_REUNION = 'EPSG:2975';
const LAYER_DEM = 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES';
const LAYER_ORTHO = 'ORTHOIMAGERY.ORTHOPHOTOS';
const FORMAT_BIL32 = 'image/x-bil;bits=32';

/* Rampe hypsometrique ABSOLUE (m NGR) partagee par toutes les tiles — une
   rampe relative par tile ferait des coutures de teinte entre voisines. */
const HYPSO_STOPS = [
  [0,    0x2f6b4f],   // littoral — vert fonce
  [300,  0x6f9c56],   // bas des pentes
  [800,  0xb0a45e],   // mi-pentes — ocre
  [1600, 0x8f6f4e],   // hauts — brun
  [2400, 0x8a8a8a],   // hautes terres — gris
  [3100, 0xe8e8e8],   // sommets (Piton des Neiges 3070 m)
];

function _hypsoColor(alt) {
  const a = Math.max(HYPSO_STOPS[0][0], Math.min(HYPSO_STOPS[HYPSO_STOPS.length - 1][0], alt));
  let k = 0;
  while (k < HYPSO_STOPS.length - 2 && a > HYPSO_STOPS[k + 1][0]) k++;
  const [a0, c0] = HYPSO_STOPS[k], [a1, c1] = HYPSO_STOPS[k + 1];
  const t = (a - a0) / (a1 - a0 || 1);
  const ch = (c, s) => (c >> s) & 255;
  return [
    (ch(c0, 16) + (ch(c1, 16) - ch(c0, 16)) * t) / 255,
    (ch(c0, 8) + (ch(c1, 8) - ch(c0, 8)) * t) / 255,
    (ch(c0, 0) + (ch(c1, 0) - ch(c0, 0)) * t) / 255,
  ];
}

const TerrainTiles = {

  /** Origine de scene globale UNIQUE {E0, N0, alt0} — fournie a l'init. */
  _origin: null,

  /** Cache memoire des textures ortho (cle "tx:ty"). */
  _orthoCache: new Map(),

  init({ origin } = {}) {
    if (!origin || !isFinite(origin.E0) || !isFinite(origin.N0)) {
      throw new Error('[TerrainTiles] init : origin {E0, N0, alt0} requis');
    }
    this._origin = { E0: origin.E0, N0: origin.N0, alt0: origin.alt0 ?? 0 };
    return this;
  },

  async _three() {
    return globalThis.window?.THREE
      ?? await import('https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.module.js');
  },

  // ── URLs WMS-R ────────────────────────────────────────────────────
  _buildUrl(bbox, W, H) {
    const p = new URLSearchParams({
      SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap',
      LAYERS: LAYER_DEM, STYLES: '', CRS: CRS_REUNION,
      BBOX: bbox.join(','), WIDTH: String(W), HEIGHT: String(H),
      FORMAT: FORMAT_BIL32,
    });
    return `${WMSR_BASE}?${p.toString()}`;
  },

  _buildOrthoUrl(bbox, W, H) {
    const p = new URLSearchParams({
      SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap',
      LAYERS: LAYER_ORTHO, STYLES: '', CRS: CRS_REUNION,
      BBOX: bbox.join(','), WIDTH: String(W), HEIGHT: String(H),
      FORMAT: 'image/jpeg',
    });
    return `${WMSR_BASE}?${p.toString()}`;
  },

  // ── Decodage BIL float32, heuristique endianness (cf. bil-terrain) ──
  _parseBIL(buffer) {
    const le = new Float32Array(buffer);
    const ok = v => v > -1000 && v < 5000 && isFinite(v);
    const nOK = arr => {
      let c = 0;
      const n = Math.min(arr.length, 5000);
      for (let i = 0; i < n; i++) if (ok(arr[i])) c++;
      return c / n;
    };
    if (nOK(le) > 0.8) return le;
    const dv = new DataView(buffer);
    const be = new Float32Array(buffer.byteLength / 4);
    for (let i = 0; i < be.length; i++) be[i] = dv.getFloat32(i * 4, false);
    return nOK(be) > 0.8 ? be : le;
  },

  /**
   * Fetch avec timeout 15 s, 2 retries, backoff — style bil-terrain.
   * Tolerance offline : throw propre apres la derniere tentative, jamais de
   * boucle infinie. Un abort externe interrompt immediatement.
   */
  async _fetchBuffer(url, { signal, timeoutMs = 15000, retries = 2, expectBIL = true } = {}) {
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal?.aborted) throw new DOMException('Tile annulee', 'AbortError');
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ct = res.headers.get('content-type') ?? '';
        if (expectBIL && !ct.includes('bil') && !ct.includes('octet')) {
          throw new Error(`reponse inattendue: ${ct.slice(0, 80)}`);
        }
        return await res.arrayBuffer();
      } catch (err) {
        lastErr = err;
        if (signal?.aborted) throw new DOMException('Tile annulee', 'AbortError');
        if (attempt < retries) {
          // Backoff 600 ms puis 1800 ms
          await new Promise(r => setTimeout(r, 600 * Math.pow(3, attempt)));
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    }
    throw new Error(`[TerrainTiles] fetch echec apres ${retries + 1} tentatives : ${lastErr?.message ?? lastErr}`);
  },

  /**
   * Get-or-fetch d'une tile DEM.
   * @returns {Promise<{demData: {W,H,pixelSizeM,minE,minN,heights}, meta}>}
   */
  async fetchTile(tx, ty, lod, { signal } = {}) {
    const g = tileGrid(tx, ty, lod);
    const key = tileKey(tx, ty, lod);
    const utmBounds = { minE: g.minE, minN: g.minN, maxE: g.maxE, maxN: g.maxN };

    // 1. Cache IndexedDB transparent
    const cached = await _cacheGet(key);
    if (cached?.dem instanceof Float32Array && cached.dem.length === g.W * g.H) {
      return {
        demData: { tx, ty, W: g.W, H: g.H, pixelSizeM: g.px, minE: g.minE, minN: g.minN, heights: cached.dem },
        meta: { tx, ty, lod, key, utmBounds, fromCache: true, ts: cached.ts },
      };
    }

    // 2. WMS-R BIL
    const url = this._buildUrl(g.bbox, g.W, g.H);
    const buf = await this._fetchBuffer(url, { signal });
    if (buf.byteLength < g.W * g.H * 4) {
      throw new Error(`[TerrainTiles] buffer BIL trop petit : ${buf.byteLength} octets (attendu ${g.W * g.H * 4})`);
    }
    const raw = this._parseBIL(buf);

    // Filtre nodata (-9999, hors plage Reunion) — meme guard que site-capture
    const heights = new Float32Array(g.W * g.H);
    for (let i = 0; i < heights.length; i++) {
      const v = raw[i];
      heights[i] = (isFinite(v) && v > -500 && v < 5000) ? v : 0;
    }

    // 3. Ecriture cache (fire & forget — l'echec du cache n'echoue pas la tile)
    _cachePut(key, { dem: heights, W: g.W, H: g.H, utmBounds, ts: Date.now() });

    return {
      demData: { tx, ty, W: g.W, H: g.H, pixelSizeM: g.px, minE: g.minE, minN: g.minN, heights },
      meta: { tx, ty, lod, key, utmBounds, fromCache: false, ts: Date.now() },
    };
  },

  /**
   * DEM → THREE.Mesh dans le repere de scene global (voir @coords en tete).
   * BufferGeometry indexee + jupes de SKIRT_DEPTH_M sur le perimetre,
   * MeshStandardMaterial vertex-colors hypsometriques par defaut.
   */
  async buildTileMesh(demData, lod, origin = this._origin) {
    if (!origin) throw new Error('[TerrainTiles] buildTileMesh : origin absent (init non appele ?)');
    const THREE = await this._three();
    const { W, H, pixelSizeM: px, minE, minN, heights } = demData;
    const { E0, N0, alt0 } = { E0: origin.E0, N0: origin.N0, alt0: origin.alt0 ?? 0 };

    // ── Assainissement NODATA + anti-aiguilles (mutation en place : couvre
    // aussi les jupes, et les dems déjà en cache IDB passent par ici) ──
    // Le RGE Alti renvoie du nodata (NaN, −99999…) sur mer/hors couverture,
    // et l'heuristique d'endianness de _parseBIL peut lire du bruit quand les
    // premiers échantillons sont océaniques → pics isolés. Un vrai relief
    // est continu : médiane 3×3 conditionnelle (seuil 40 m), une passe.
    {
      let fixed = 0;
      for (let i = 0; i < heights.length; i++) {
        if (!Number.isFinite(heights[i]) || heights[i] < -100 || heights[i] > 4000) { heights[i] = 0; fixed++; }
      }
      const nb = new Array(8);
      let spikes = 0;
      for (let j = 1; j < H - 1; j++) {
        for (let i = 1; i < W - 1; i++) {
          const k = j * W + i;
          nb[0] = heights[k - W - 1]; nb[1] = heights[k - W]; nb[2] = heights[k - W + 1];
          nb[3] = heights[k - 1];                              nb[4] = heights[k + 1];
          nb[5] = heights[k + W - 1]; nb[6] = heights[k + W]; nb[7] = heights[k + W + 1];
          const s = [...nb].sort((a, b) => a - b);
          const med = (s[3] + s[4]) / 2;
          if (Math.abs(heights[k] - med) > 40) { heights[k] = med; spikes++; }
        }
      }
      if (fixed || spikes) {
        console.info(`[TerrainTiles] tile ${demData.tx ?? '?'}:${demData.ty ?? '?'} : ${fixed} nodata → 0, ${spikes} aiguilles écrêtées`);
      }
    }

    const nGrid = W * H;
    const loop = [];                                        // perimetre ordonne
    for (let i = 0; i < W; i++)      loop.push(i);                     // nord, ouest→est (j=0)
    for (let j = 1; j < H; j++)      loop.push(j * W + (W - 1));       // est, nord→sud
    for (let i = W - 2; i >= 0; i--) loop.push((H - 1) * W + i);       // sud, est→ouest
    for (let j = H - 2; j >= 1; j--) loop.push(j * W);                 // ouest, sud→nord
    const nLoop = loop.length;

    const pos = new Float32Array((nGrid + nLoop) * 3);
    const col = new Float32Array((nGrid + nLoop) * 3);
    const uvs = new Float32Array((nGrid + nLoop) * 2);

    // Grille : raster WMS ligne 0 = NORD → N = minN + (H-1-j)*px
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        const alt = heights[k];
        pos[k * 3]     = (minE + i * px) - E0;              // x = E − E0
        pos[k * 3 + 1] = alt - alt0;                        // y = alt − alt0
        pos[k * 3 + 2] = -((minN + (H - 1 - j) * px) - N0); // z = −(N − N0)
        const c = _hypsoColor(alt);
        col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
        uvs[k * 2] = i / (W - 1);
        uvs[k * 2 + 1] = 1 - j / (H - 1);                   // v=1 au nord (haut image)
      }
    }

    // Jupes : copie du perimetre descendue de SKIRT_DEPTH_M (couleur/uv du haut)
    for (let k = 0; k < nLoop; k++) {
      const src = loop[k], dst = nGrid + k;
      pos[dst * 3]     = pos[src * 3];
      pos[dst * 3 + 1] = pos[src * 3 + 1] - SKIRT_DEPTH_M;
      pos[dst * 3 + 2] = pos[src * 3 + 2];
      col[dst * 3] = col[src * 3]; col[dst * 3 + 1] = col[src * 3 + 1]; col[dst * 3 + 2] = col[src * 3 + 2];
      uvs[dst * 2] = uvs[src * 2]; uvs[dst * 2 + 1] = uvs[src * 2 + 1];
    }

    const idx = new Uint32Array(((W - 1) * (H - 1) + nLoop) * 6);
    let q = 0;
    // Surface — CCW vue de dessus (+Y) : (a, c, b) puis (b, c, d)
    for (let j = 0; j < H - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const a = j * W + i, b = a + 1, c = (j + 1) * W + i, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    }
    // Jupes — normales sortantes horizontales (winding verifie par arete) :
    // (T_k, T_k+1, B_k) et (T_k+1, B_k+1, B_k) sur le perimetre boucle
    for (let k = 0; k < nLoop; k++) {
      const k1 = (k + 1) % nLoop;
      const T0 = loop[k], T1 = loop[k1], B0 = nGrid + k, B1 = nGrid + k1;
      idx[q++] = T0; idx[q++] = T1; idx[q++] = B0;
      idx[q++] = T1; idx[q++] = B1; idx[q++] = B0;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
    geom.computeVertexNormals();
    geom.computeBoundingBox();
    geom.computeBoundingSphere();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.0,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = `TerrainTile_${tileKey(demData.tx ?? '?', demData.ty ?? '?', lod)}`;
    mesh.frustumCulled = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      type: 'terrain-tile',
      tx: demData.tx, ty: demData.ty, lod,
      pixelSizeM: px,
      utmBounds: { minE, minN, maxE: minE + (W - 1) * px, maxN: minN + (H - 1) * px },
    };
    return mesh;
  },

  /**
   * Drapage ortho IGN optionnel — une texture JPEG par tile sur son emprise
   * d'echantillons, cache memoire par tile (independant du LOD DEM).
   */
  async applyOrtho(mesh, { sizePx = 512, signal } = {}) {
    const THREE = await this._three();
    const ud = mesh?.userData;
    if (!ud?.utmBounds) throw new Error('[TerrainTiles] applyOrtho : mesh sans utmBounds');
    const key = `${ud.tx}:${ud.ty}`;

    let texture = this._orthoCache.get(key);
    if (!texture) {
      const b = ud.utmBounds;
      const url = this._buildOrthoUrl([b.minE, b.minN, b.maxE, b.maxN], sizePx, sizePx);
      const buf = await this._fetchBuffer(url, { signal, expectBIL: false });
      const bitmap = await createImageBitmap(new Blob([buf], { type: 'image/jpeg' }));
      // ⚠ PIÈGE (vérifié au zénithal vs ortho de référence) : un ImageBitmap
      // N'EST PAS affecté par texture.flipY dans WebGL → texture en miroir
      // nord-sud malgré flipY=true. Passage par un canvas 2D intermédiaire,
      // qui suit flipY normalement — v=1 en haut = nord, comme nos UV.
      const cv = document.createElement('canvas');
      cv.width = bitmap.width; cv.height = bitmap.height;
      cv.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close?.();
      texture = new THREE.CanvasTexture(cv);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      this._orthoCache.set(key, texture);
    }

    mesh.material.map = texture;
    mesh.material.vertexColors = false;
    mesh.material.color?.set?.(0xffffff);
    mesh.material.needsUpdate = true;
    return mesh;
  },

  /** Libere geometry + material + textures d'une tile (hors cache ortho partage). */
  disposeTile(mesh) {
    if (!mesh) return;
    mesh.geometry?.dispose?.();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      // La texture ortho vit dans _orthoCache (partagee entre swaps de LOD) :
      // on ne la dispose pas ici, clearOrthoCache() s'en charge.
      m.dispose?.();
    }
  },

  /** Vide le cache memoire des textures ortho (dispose GPU). */
  clearOrthoCache() {
    for (const tex of this._orthoCache.values()) tex.dispose?.();
    this._orthoCache.clear();
  },

  /** Purge du cache IndexedDB (toutes tiles — il est inter-projets). */
  async clearCache() {
    try {
      const db = await _openDb();
      if (!db) return;
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
      await _req(store.clear());
      console.info('[TerrainTiles] cache IndexedDB vide');
    } catch (err) {
      console.warn('[TerrainTiles] clearCache echec:', err?.message ?? err);
    }
  },
};

export default TerrainTiles;
