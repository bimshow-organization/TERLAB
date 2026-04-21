// TERLAB · bimshow-project-browser.js · Browse & import BIMSHOW projects · v1.0
// ════════════════════════════════════════════════════════════════════════════
// Uses the same Firebase instance as TERLAB (bimshow-preprod1) to list the
// logged-in user's BIMSHOW projects, fetch thumbnails, and download GLB models.
//
// Firebase paths (mirrors web-app structure):
//   users/{uid}/ownedProjects          → Record<projectId, true>
//   projects/{pid}/details             → { name, dateCreated, modelFormat, fallbackThumb, defaultView, ... }
//   projects/{pid}/data/views/{vid}/initialPhoto → photoId
//   projects/{pid}/data/photos/{phid}  → { thumbData }
//   projects/{pid}/data/siteData       → { latitude, longitude, elevation, offsetX/Y/Z, rotate }
//   Storage: projects/{pid}/generatedModels/model.glb
// ════════════════════════════════════════════════════════════════════════════

const BimshowProjectBrowser = {

  _projects: [],      // cached project list [{ id, name, dateCreated, modelFormat, thumb, ... }]
  _loading: false,

  // ── AUTH CHECK ──────────────────────────────────────────────
  get isLoggedIn() {
    return !!(window.TERLAB_UID && window.TERLAB_AUTH?.currentUser && !window.TERLAB_AUTH.currentUser.isAnonymous);
  },

  get userEmail() {
    return window.TERLAB_AUTH?.currentUser?.email ?? null;
  },

  // ── LIST PROJECTS ──────────────────────────────────────────
  /**
   * Fetch the logged-in user's owned projects from Firebase RTDB.
   * Returns [{ id, name, dateCreated, modelFormat, fallbackThumb, ... }]
   */
  async listProjects() {
    if (!this.isLoggedIn) {
      console.warn('[BimshowBrowser] Not logged in — cannot list projects');
      return [];
    }

    const uid = window.TERLAB_UID;
    const fbRef = window.TERLAB_FB_REF;
    const fbGet = window.TERLAB_FB_GET;
    const db    = window.TERLAB_DB;

    if (!db || !fbRef || !fbGet) {
      console.warn('[BimshowBrowser] Firebase not initialized');
      return [];
    }

    this._loading = true;

    try {
      // 1. Get owned project IDs
      const ownedSnap = await fbGet(fbRef(db, `users/${uid}/ownedProjects`));
      const ownedMap  = ownedSnap.val();
      if (!ownedMap) {
        this._projects = [];
        return [];
      }

      const pids = Object.keys(ownedMap).reverse(); // newest first (Firebase push IDs)

      // 2. Fetch details in batches of 10
      const projects = [];
      const BATCH = 10;
      for (let i = 0; i < pids.length; i += BATCH) {
        const batch = pids.slice(i, i + BATCH);
        const results = await Promise.all(batch.map(async (pid) => {
          try {
            const snap = await fbGet(fbRef(db, `projects/${pid}/details`));
            const details = snap.val();
            if (!details) return null;
            return { id: pid, ...details };
          } catch {
            return null;
          }
        }));
        projects.push(...results.filter(Boolean));
      }

      this._projects = projects;
      return projects;

    } catch (err) {
      console.error('[BimshowBrowser] listProjects error:', err);
      return [];
    } finally {
      this._loading = false;
    }
  },

  // ── LOAD THUMBNAIL ─────────────────────────────────────────
  /**
   * Fetch the best available thumbnail for a project.
   * Tries: defaultView → initialPhoto → thumbData, then fallbackThumb.
   */
  async loadThumbnail(project) {
    if (project._thumb) return project._thumb;

    const fbRef = window.TERLAB_FB_REF;
    const fbGet = window.TERLAB_FB_GET;
    const db    = window.TERLAB_DB;

    // Try defaultView → photo → thumbData
    if (project.defaultView) {
      try {
        const viewSnap = await fbGet(fbRef(db, `projects/${project.id}/data/views/${project.defaultView}/initialPhoto`));
        const photoId = viewSnap.val();
        if (photoId) {
          const photoSnap = await fbGet(fbRef(db, `projects/${project.id}/data/photos/${photoId}`));
          const photoData = photoSnap.val();
          if (photoData?.thumbData) {
            project._thumb = photoData.thumbData;
            return photoData.thumbData;
          }
        }
      } catch { /* fallthrough */ }
    }

    // Fallback
    project._thumb = project.fallbackThumb || null;
    return project._thumb;
  },

  // ── LOAD SITE DATA ─────────────────────────────────────────
  /**
   * Fetch siteData for geo-positioning.
   * Returns { latitude, longitude, elevation, offsetX, offsetY, offsetZ, rotate }
   */
  async loadSiteData(projectId) {
    const fbRef = window.TERLAB_FB_REF;
    const fbGet = window.TERLAB_FB_GET;
    const db    = window.TERLAB_DB;

    try {
      const snap = await fbGet(fbRef(db, `projects/${projectId}/data/siteData`));
      return snap.val() || null;
    } catch {
      return null;
    }
  },

  // ── DOWNLOAD GLB ───────────────────────────────────────────
  /**
   * Download model.glb from Firebase Storage.
   * Returns { buffer: ArrayBuffer, siteData } or null.
   * onProgress(percent) callback for UI.
   */
  async downloadGLB(projectId, onProgress) {
    const storage    = window.TERLAB_STORAGE;
    const storageRef = window.TERLAB_FB_STORAGE_REF;
    const getURL     = window.TERLAB_FB_GET_URL;

    if (!storage || !storageRef || !getURL) {
      console.error('[BimshowBrowser] Firebase Storage not initialized');
      return null;
    }

    try {
      onProgress?.(0);

      // 1. Get download URL for the GLB
      const glbRef = storageRef(storage, `projects/${projectId}/generatedModels/model.glb`);
      const url = await getURL(glbRef);

      // 2. Fetch with progress tracking
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10);
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength > 0) {
          onProgress?.(Math.round((received / contentLength) * 100));
        }
      }

      // 3. Merge chunks into single ArrayBuffer
      const buffer = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }

      onProgress?.(100);

      // 4. Also fetch siteData for positioning
      const siteData = await this.loadSiteData(projectId);

      console.info(`[BimshowBrowser] GLB downloaded: ${(received / 1024 / 1024).toFixed(1)} MB`);

      return { buffer: buffer.buffer, siteData, size: received };

    } catch (err) {
      console.error('[BimshowBrowser] downloadGLB error:', err);
      return null;
    }
  },

  // ── HAS GLB MODEL ─────────────────────────────────────────
  /**
   * Check if project has a downloadable GLB model.
   */
  hasGLB(project) {
    const fmt = project.modelFormat;
    return fmt === 'glb' || fmt === 'v2' || fmt === 'json.gz' || !!project.daeFileName;
    // For now we only download model.glb — formats other than 'glb' may not have it.
    // TODO: support v2 chunks download later.
  },
};

export default BimshowProjectBrowser;
