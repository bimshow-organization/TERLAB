// TERLAB · terlab-upload-service.js · Upload Firebase Storage · ENSA La Reunion
// Namespace : /terlab/{uid}/{projectId}/{thumbnail.webp|export.pdf|model.glb|plan.dxf}
// Regles : lecture publique, ecriture owner uniquement (cf. storage.rules).

const TerlabUploadService = {

  _isBimshowUser() {
    const auth = window.TERLAB_AUTH;
    const uid  = window.TERLAB_UID;
    return !!(uid && auth?.currentUser && !auth.currentUser.isAnonymous);
  },

  // Upload un Blob → downloadURL. Retourne null si non connecte ou erreur.
  async uploadBlob(relativePath, blob, contentType) {
    if (!this._isBimshowUser()) return null;
    if (!window.TERLAB_STORAGE) return null;
    try {
      const uid = window.TERLAB_UID;
      const ref = window.TERLAB_FB_STORAGE_REF(window.TERLAB_STORAGE, `terlab/${uid}/${relativePath}`);
      await window.TERLAB_FB_UPLOAD(ref, blob, contentType ? { contentType } : undefined);
      const url = await window.TERLAB_FB_GET_URL(ref);
      console.info('[Upload]', relativePath, '→', url.slice(0, 80));
      return url;
    } catch (e) {
      console.warn('[Upload] failed', relativePath, e.message);
      return null;
    }
  },

  // Capture la Mapbox courante + upload thumbnail 512px webp.
  // Fallback : capture le viewer 3D (#three-canvas) ou l'esquisse canvas.
  async captureAndUploadThumbnail() {
    if (!this._isBimshowUser()) return null;
    const sid = window.SessionManager?._sessionId;
    if (!sid) return null;

    const blob = await this._captureThumbnailBlob();
    if (!blob) return null;

    const url = await this.uploadBlob(`${sid}/thumbnail.webp`, blob, 'image/webp');
    if (url) {
      window.SessionManager.saveExport('thumbnail', url);
    }
    return url;
  },

  // Produit un Blob webp (512px max cote). Priorise : Mapbox > Three.js > Esquisse canvas.
  async _captureThumbnailBlob() {
    const TARGET = 512;

    // 1. Mapbox (carte terrain visible)
    const mapCanvas = window.TerlabMap?.map?.getCanvas?.()
                   ?? document.querySelector('.mapboxgl-canvas')
                   ?? null;
    if (mapCanvas && mapCanvas.width > 0) {
      // preserveDrawingBuffer Mapbox n'est pas toujours actif — forcer un render
      try { window.TerlabMap?.map?.triggerRepaint?.(); } catch {}
      return this._canvasToWebp(mapCanvas, TARGET);
    }

    // 2. Viewer 3D (Three.js) — composants exposent generalement leur renderer via un canvas tag
    const threeCanvas = document.querySelector('#three-canvas')
                     ?? document.querySelector('.t3d-canvas')
                     ?? document.querySelector('canvas[data-three]');
    if (threeCanvas) return this._canvasToWebp(threeCanvas, TARGET);

    // 3. Esquisse
    const esq = document.querySelector('#esquisse-canvas, .esquisse-canvas');
    if (esq) return this._canvasToWebp(esq, TARGET);

    return null;
  },

  _canvasToWebp(srcCanvas, maxSide) {
    return new Promise((resolve) => {
      const w = srcCanvas.width, h = srcCanvas.height;
      if (!w || !h) return resolve(null);
      const scale = Math.min(1, maxSide / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width  = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      const ctx = c.getContext('2d');
      try {
        ctx.drawImage(srcCanvas, 0, 0, c.width, c.height);
      } catch (e) {
        console.warn('[Upload] drawImage failed (tainted canvas ?)', e.message);
        return resolve(null);
      }
      c.toBlob(b => resolve(b), 'image/webp', 0.78);
    });
  },

  // Upload un export GLB/PDF/DXF deja genere. type = 'glb' | 'pdf' | 'dxf' | 'ifc' | 'json'
  async uploadExport(type, blob, filename) {
    if (!this._isBimshowUser()) return null;
    const sid = window.SessionManager?._sessionId;
    if (!sid) return null;

    const ext = filename?.split('.').pop() || type;
    const name = filename || `export.${ext}`;
    const contentType = {
      glb:  'model/gltf-binary',
      pdf:  'application/pdf',
      dxf:  'application/dxf',
      ifc:  'application/ifc',
      json: 'application/json'
    }[type] || blob.type || 'application/octet-stream';

    const url = await this.uploadBlob(`${sid}/${name}`, blob, contentType);
    if (url) {
      window.SessionManager.saveExport(type, url);
    }
    return url;
  }
};

window.TerlabUploadService = TerlabUploadService;
export default TerlabUploadService;
