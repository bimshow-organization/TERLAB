// TERLAB · lidar-cache.js · Cache IndexedDB des points LiDAR + mesh TIN
// Evite de refaire le pipeline IGN + decompression LAZ a chaque reload.
// Clef composite : sessionId + bboxHash + classes.

const DB_NAME    = 'terlab_lidar';
const DB_VERSION = 1;
const STORE_PTS  = 'points';
const STORE_MESH = 'mesh';

let _dbPromise = null;

function _openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PTS))  db.createObjectStore(STORE_PTS);
      if (!db.objectStoreNames.contains(STORE_MESH)) db.createObjectStore(STORE_MESH);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  return _dbPromise;
}

function _txn(storeName, mode = 'readonly') {
  return _openDb().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

function _req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror   = () => reject(r.error);
  });
}

// djb2 hash court et stable
function _hashStr(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function _bboxHash(geojson) {
  if (!geojson) return 'nil';
  const coords = [];
  const walk = (node) => {
    if (typeof node?.[0] === 'number') { coords.push(node[0], node[1]); return; }
    if (Array.isArray(node)) node.forEach(walk);
  };
  walk(geojson.geometry?.coordinates ?? geojson.coordinates ?? []);
  if (!coords.length) return 'empty';
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < coords.length; i += 2) {
    const x = coords[i], y = coords[i + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return _hashStr([minX, minY, maxX, maxY].map(v => v.toFixed(6)).join('|'));
}

function _key(sessionId, geojson, classes) {
  return `${sessionId || 'anon'}:${_bboxHash(geojson)}:${classes || 'all'}`;
}

// ── Serialisation compacte points : 7 * Float32Array (lng, lat, z, r, g, b, cls)
function _packPoints(points) {
  const n = points.length;
  const buf = new Float32Array(n * 7);
  for (let i = 0; i < n; i++) {
    const p = points[i], o = i * 7;
    buf[o]     = p[0];
    buf[o + 1] = p[1];
    buf[o + 2] = p[2];
    buf[o + 3] = p[3];
    buf[o + 4] = p[4];
    buf[o + 5] = p[5];
    buf[o + 6] = p[6];
  }
  return buf;
}

function _unpackPoints(buf) {
  const n = buf.length / 7;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 7;
    out[i] = [buf[o], buf[o + 1], buf[o + 2], buf[o + 3], buf[o + 4], buf[o + 5], buf[o + 6]];
  }
  return out;
}

const LidarCache = {

  async putPoints({ sessionId, geojson, classes, points, meta }) {
    if (!points?.length) return;
    try {
      const key = _key(sessionId, geojson, classes);
      const record = {
        buf: _packPoints(points),
        count: points.length,
        classes,
        meta: meta ?? null,
        ts: Date.now(),
      };
      const store = await _txn(STORE_PTS, 'readwrite');
      await _req(store.put(record, key));
      console.info(`[LidarCache] points sauves : ${points.length} pts -> ${key}`);
    } catch (err) {
      console.warn('[LidarCache] putPoints failed:', err);
    }
  },

  async getPoints({ sessionId, geojson, classes }) {
    try {
      const key = _key(sessionId, geojson, classes);
      const store = await _txn(STORE_PTS, 'readonly');
      const record = await _req(store.get(key));
      if (!record?.buf) return null;
      return {
        points: _unpackPoints(record.buf),
        count:  record.count,
        classes: record.classes,
        meta:    record.meta,
        ts:      record.ts,
      };
    } catch (err) {
      console.warn('[LidarCache] getPoints failed:', err);
      return null;
    }
  },

  async putMesh({ sessionId, geojson, mesh, metadata }) {
    if (!mesh) return;
    try {
      const key = _key(sessionId, geojson, 'mesh');
      const geom = mesh.geometry;
      const pos = geom.attributes.position?.array;
      const col = geom.attributes.color?.array;
      const uv  = geom.attributes.uv?.array;
      const idx = geom.index?.array;
      const record = {
        position: pos ? new Float32Array(pos) : null,
        color:    col ? new Float32Array(col) : null,
        uv:       uv  ? new Float32Array(uv)  : null,
        index:    idx ? new Uint32Array(idx)  : null,
        metadata: metadata ?? null,
        ts: Date.now(),
      };
      const store = await _txn(STORE_MESH, 'readwrite');
      await _req(store.put(record, key));
      console.info(`[LidarCache] mesh sauve : ${metadata?.nTriangles ?? '?'} triangles -> ${key}`);
    } catch (err) {
      console.warn('[LidarCache] putMesh failed:', err);
    }
  },

  async getMesh({ sessionId, geojson }) {
    try {
      const key = _key(sessionId, geojson, 'mesh');
      const store = await _txn(STORE_MESH, 'readonly');
      const record = await _req(store.get(key));
      return record ?? null;
    } catch (err) {
      console.warn('[LidarCache] getMesh failed:', err);
      return null;
    }
  },

  // Reconstruit un THREE.Mesh a partir d'un record cache. Prerequis : window.THREE dispo.
  rebuildMesh(record) {
    const THREE = window.THREE;
    if (!THREE || !record?.position || !record?.index) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(record.position, 3));
    if (record.color) geom.setAttribute('color', new THREE.BufferAttribute(record.color, 3));
    if (record.uv)    geom.setAttribute('uv',    new THREE.BufferAttribute(record.uv, 2));
    geom.setIndex(new THREE.BufferAttribute(record.index, 1));
    geom.computeVertexNormals();
    geom.computeBoundingBox();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: !!record.color,
      flatShading: false,
      roughness: 0.85,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = 'TerrainTIN';
    mesh.receiveShadow = true;
    return mesh;
  },

  async clear(sessionId) {
    try {
      const db = await _openDb();
      const tx = db.transaction([STORE_PTS, STORE_MESH], 'readwrite');
      const sPts = tx.objectStore(STORE_PTS);
      const sMesh = tx.objectStore(STORE_MESH);
      for (const store of [sPts, sMesh]) {
        const keys = await _req(store.getAllKeys());
        for (const k of keys) {
          if (!sessionId || String(k).startsWith(`${sessionId}:`)) {
            await _req(store.delete(k));
          }
        }
      }
      console.info(`[LidarCache] clear(${sessionId || 'all'}) OK`);
    } catch (err) {
      console.warn('[LidarCache] clear failed:', err);
    }
  },
};

window.LidarCache = LidarCache;
export default LidarCache;
