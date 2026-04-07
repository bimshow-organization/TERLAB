// ═══════════════════════════════════════════════════════════════════════
// TERLAB · services/background-terrain.js
// Porté de GIEP-LA-REUNION/src/components/projets3d/giep-3d-background-terrain.js
// Mesh Three.js : DEM Mapbox RGB + texture WMS IGN ortho
// ═══════════════════════════════════════════════════════════════════════

const BackgroundTerrain = {
  _mesh: null,

  // ── Construire le mesh de contexte ────────────────────────────────
  async build(parcelGeo, opts = {}) {
    const THREE = window.THREE ?? await import('https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.module.js');
    const token = localStorage.getItem('terlab_mapbox_token') ?? window.TerlabMap?.getMap?.()?.getAccessToken?.();
    if (!token) { console.warn('[BG] Token Mapbox manquant'); return null; }

    // Bounds étendus autour de la parcelle
    const factor = opts.expansionFactor ?? 2.0;
    const lngs = parcelGeo.map(c => c[0]), lats = parcelGeo.map(c => c[1]);
    const center = [
      lngs.reduce((s, v) => s + v, 0) / lngs.length,
      lats.reduce((s, v) => s + v, 0) / lats.length,
    ];
    const dLng = (Math.max(...lngs) - Math.min(...lngs)) * factor;
    const dLat = (Math.max(...lats) - Math.min(...lats)) * factor;
    const wgsBounds = {
      west:  center[0] - dLng,
      east:  center[0] + dLng,
      south: center[1] - dLat,
      north: center[1] + dLat
    };

    // DEM depuis tuiles Mapbox terrain-rgb
    const zoom = opts.demZoom ?? 13;
    const demTiles = await this._loadDEMTiles(wgsBounds, zoom, token);

    // Mesh grille
    const gridRes = opts.gridRes ?? 64;
    const { mesh } = this._buildGridMesh(THREE, wgsBounds, gridRes, demTiles, opts);

    // Texture IGN WMS ortho
    const texture = await this._loadIgnTexture(THREE, wgsBounds, opts);
    if (texture && mesh.material) {
      mesh.material.map = texture;
      mesh.material.needsUpdate = true;
    }

    this._mesh = mesh;
    return mesh;
  },

  // DEM Mapbox terrain-rgb@2x
  async _loadDEMTiles(wgsBounds, zoom, token) {
    const tiles = [];
    const z = Math.min(15, Math.max(8, zoom));
    const wgs2tile = (lng, lat, z) => ({
      x: Math.floor((lng + 180) / 360 * Math.pow(2, z)),
      y: Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z)),
      z
    });
    const sw = wgs2tile(wgsBounds.west, wgsBounds.south, z);
    const ne = wgs2tile(wgsBounds.east, wgsBounds.north, z);
    const [xMin, xMax] = [Math.min(sw.x, ne.x), Math.max(sw.x, ne.x)];
    const [yMin, yMax] = [Math.min(sw.y, ne.y), Math.max(sw.y, ne.y)];

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        const url = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${z}/${x}/${y}@2x.pngraw?access_token=${token}`;
        const tile = await new Promise(res => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.width; c.height = img.height;
            c.getContext('2d').drawImage(img, 0, 0);
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
            const n2 = Math.pow(2, z);
            const west = (x / n2) * 360 - 180, east = ((x + 1) / n2) * 360 - 180;
            const north = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n2))) * 180 / Math.PI;
            const south = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n2))) * 180 / Math.PI;
            res({ bounds: { west, east, north, south }, data: d.data, width: c.width, height: c.height });
          };
          img.onerror = () => res(null);
          img.src = url;
        });
        if (tile) tiles.push(tile);
      }
    }
    return tiles;
  },

  // Lire altitude depuis tiles DEM (GIEP: sampleDEMElevation)
  _sampleDEM(lng, lat, tiles) {
    for (const t of tiles) {
      const b = t.bounds;
      if (lng < b.west || lng > b.east || lat < b.south || lat > b.north) continue;
      const u = (lng - b.west) / (b.east - b.west);
      const v = (b.north - lat) / (b.north - b.south);
      const px = Math.round(u * (t.width - 1));
      const py = Math.round(v * (t.height - 1));
      const i = (py * t.width + px) * 4;
      return -10000 + ((t.data[i] * 65536 + t.data[i + 1] * 256 + t.data[i + 2]) * 0.1);
    }
    return 0;
  },

  // Construire mesh grille Three.js avec DEM baké
  _buildGridMesh(THREE, wgsBounds, res, demTiles, opts) {
    const W = res, H = res;
    const dLng = wgsBounds.east - wgsBounds.west;
    const dLat = wgsBounds.north - wgsBounds.south;
    const cx = wgsBounds.west + dLng / 2, cy = wgsBounds.south + dLat / 2;
    const LNG = 111320 * Math.cos(cy * Math.PI / 180), LAT = 111320;

    const scaleZ = opts.elevationFactor ?? 1.0;
    const pos = new Float32Array(W * H * 3);
    const uvs = new Float32Array(W * H * 2);
    const idx = new Uint32Array((W - 1) * (H - 1) * 6);
    let p = 0, t = 0, q = 0;

    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const lng = wgsBounds.west + i / (W - 1) * dLng;
        const lat = wgsBounds.south + j / (H - 1) * dLat;
        const x = (lng - cx) * LNG, y = (lat - cy) * LAT;
        const z = this._sampleDEM(lng, lat, demTiles) * scaleZ;
        pos[p++] = x; pos[p++] = y; pos[p++] = z;
        uvs[t++] = i / (W - 1); uvs[t++] = j / (H - 1);
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

    const mat = new THREE.MeshStandardMaterial({
      color: 0x8FAF7A,
      opacity: opts.opacity ?? 0.85,
      transparent: true
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData = { type: 'background-terrain', wgsBounds };
    return { mesh };
  },

  // Texture IGN WMS ortho
  async _loadIgnTexture(THREE, wgsBounds, opts = {}) {
    const { west, south, east, north } = wgsBounds;
    const W = opts.wmsWidth ?? 1024, H = opts.wmsHeight ?? 1024;
    const url = `https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap`
      + `&LAYERS=ORTHOIMAGERY.ORTHOPHOTOS&STYLES=&CRS=EPSG:4326`
      + `&BBOX=${south},${west},${north},${east}&WIDTH=${W}&HEIGHT=${H}&FORMAT=image/jpeg`;

    return new Promise(res => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        c.getContext('2d').drawImage(img, 0, 0, W, H);
        const tex = new THREE.CanvasTexture(c);
        tex.flipY = false;
        tex.needsUpdate = true;
        res(tex);
      };
      img.onerror = () => { console.warn('[BG] IGN WMS texture failed'); res(null); };
      img.src = url;
    });
  },

  getMesh()  { return this._mesh; },
  dispose()  {
    this._mesh?.geometry?.dispose();
    this._mesh?.material?.map?.dispose();
    this._mesh?.material?.dispose();
    this._mesh = null;
  },
};

export default BackgroundTerrain;
