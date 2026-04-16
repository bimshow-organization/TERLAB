// ═══════════════════════════════════════════════════════════════════════
// TERLAB · services/bil-terrain.js
// Porté de GIEP-LA-REUNION/src/components/projets3d/giep-3d-bil-terrain.js
// WMS-R BIL float32 IGN — altimétrie précise + mesh Three.js (EPSG:2975)
// ═══════════════════════════════════════════════════════════════════════

const CRS_REUNION   = 'EPSG:2975'; // UTM zone 40S RGR92
const WMSR_BASE     = 'https://data.geopf.fr/wms-r';
const LAYER_HIGHRES = 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES';
const FORMAT_BIL32  = 'image/x-bil;bits=32';

const BILTerrain = {

  // ── Proj4 lazy-load ───────────────────────────────────────────────
  async _ensureProj4() {
    if (window.proj4) return;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/proj4@2.9.0/dist/proj4.js';
      s.onload = res;
      s.onerror = () => rej(new Error('proj4 load failed'));
      document.head.appendChild(s);
    });
    if (!proj4.defs['EPSG:2975'])
      proj4.defs('EPSG:2975', '+proj=utm +zone=40 +south +datum=RGR92 +units=m +no_defs');
    if (!proj4.defs['EPSG:4326'])
      proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs');
  },

  // WGS84 → UTM40S
  async lngLatToUTM(lng, lat) {
    await this._ensureProj4();
    return proj4('EPSG:4326', 'EPSG:2975', [lng, lat]);
  },

  // Aligner sur grille pixel-centre RGE Alti (GIEP: snapToPixelCenter)
  _snap(v, px) {
    return (Math.round(v / px - 0.5) + 0.5) * px;
  },

  // Construire URL WMS-R BIL
  _buildUrl(bbox, W, H) {
    const p = new URLSearchParams({
      SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap',
      LAYERS: LAYER_HIGHRES, STYLES: '', CRS: CRS_REUNION,
      BBOX: bbox.join(','), WIDTH: String(W), HEIGHT: String(H),
      FORMAT: FORMAT_BIL32
    });
    return `${WMSR_BASE}?${p.toString()}`;
  },

  // Décoder BIL float32 avec heuristique endian (GIEP: parseFloat32WithEndianHeuristic)
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

  // Interpolation bilinéaire (GIEP: bilinearSample)
  _bilinear(heights, W, H, fx, fy) {
    const x0 = Math.max(0, Math.min(W - 2, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(H - 2, Math.floor(fy)));
    const tx = fx - x0, ty = fy - y0;
    const idx = (y, x) => y * W + x;
    const z00 = heights[idx(y0, x0)],     z10 = heights[idx(y0, x0 + 1)];
    const z01 = heights[idx(y0 + 1, x0)], z11 = heights[idx(y0 + 1, x0 + 1)];
    return z00 * (1 - tx) * (1 - ty) + z10 * tx * (1 - ty) + z01 * (1 - tx) * ty + z11 * tx * ty;
  },

  // ── API : altitude ponctuelle WGS84 ───────────────────────────────
  async getElevation(lng, lat) {
    await this._ensureProj4();
    const [e, n] = proj4('EPSG:4326', 'EPSG:2975', [lng, lat]);
    const px = 1.0, W = 4, H = 4;
    const minX = this._snap(e - 2 * px, px);
    const minY = this._snap(n - 2 * px, px);
    const bbox = [minX, minY, minX + W * px, minY + H * px];

    try {
      const url = this._buildUrl(bbox, W, H);
      const buf = await (await fetch(url)).arrayBuffer();
      const heights = this._parseBIL(buf);
      const fx = (e - minX) / px;
      const fy = (minY + H * px - n) / px;
      return this._bilinear(heights, W, H, fx, fy);
    } catch (err) {
      console.warn('[BIL] getElevation fallback Mapbox:', err.message);
      return window.TerlabMap?.getMap()?.queryTerrainElevation?.([lng, lat]) ?? null;
    }
  },

  // ── API : mesh Three.js (p07 esquisse 3D) ─────────────────────────
  async buildMesh(wgsBounds, opts = {}) {
    await this._ensureProj4();
    const THREE = window.THREE ?? await import('https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.module.js');

    const sw = proj4('EPSG:4326', 'EPSG:2975', [wgsBounds.west, wgsBounds.south]);
    const ne = proj4('EPSG:4326', 'EPSG:2975', [wgsBounds.east, wgsBounds.north]);
    const px = opts.pixelSizeM ?? 1.0;
    const maxDim = opts.maxDim ?? 512;

    const minX = this._snap(sw[0], px), minY = this._snap(sw[1], px);
    const maxX = this._snap(ne[0], px), maxY = this._snap(ne[1], px);
    let W = Math.min(maxDim, Math.ceil((maxX - minX) / px));
    let H = Math.min(maxDim, Math.ceil((maxY - minY) / px));
    const bbox = [minX, minY, minX + W * px, minY + H * px];
    const cX = (minX + minX + W * px) / 2;
    const cY = (minY + minY + H * px) / 2;

    const url = this._buildUrl(bbox, W, H);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`BIL WMS ${res.status} ${res.statusText}`);
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('bil') && !ct.includes('octet')) {
      throw new Error(`BIL WMS réponse inattendue: ${ct.slice(0, 80)}`);
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength < W * H * 4) {
      throw new Error(`BIL buffer trop petit: ${buf.byteLength} octets (attendu ${W * H * 4})`);
    }
    const heights = this._parseBIL(buf);

    const stepX = (W * px) / (W - 1), stepY = (H * px) / (H - 1);
    const scaleZ = opts.verticalExaggeration ?? 1.0;
    const pos = new Float32Array(W * H * 3);
    const uvs = new Float32Array(W * H * 2);
    const idx = new Uint32Array((W - 1) * (H - 1) * 6);
    let p = 0, t = 0, q = 0;

    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const x = (minX + i * stepX) - cX;
        const y = (minY + (H - 1 - j) * stepY) - cY;
        const z = (heights[j * W + i] ?? 0) * scaleZ;
        pos[p++] = x; pos[p++] = y; pos[p++] = z;
        uvs[t++] = i / (W - 1); uvs[t++] = 1 - j / (H - 1);
      }
    }
    for (let j = 0; j < H - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const a = j * W + i, b = a + 1, c = (j + 1) * W + i, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
    geom.computeVertexNormals();
    geom.computeBoundingBox();

    const mat = new THREE.MeshStandardMaterial({ color: 0x8FAF7A, wireframe: opts.wireframe ?? false });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData = {
      type: 'bil-terrain',
      utmBounds: { minX, minY, maxX: minX + W * px, maxY: minY + H * px, cX, cY },
      pixelSizeM: px
    };
    return mesh;
  },
};

export default BILTerrain;
