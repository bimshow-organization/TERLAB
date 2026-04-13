/**
 * ImpostorLoader — charge les atlases impostor BPF (octahedral 8 vues, 2048x1024 webp)
 *
 * Atlas layout : grille 4 colonnes x 2 lignes, chaque cellule = une vue a 45 degres
 * (azimuts 0,45,90,135,180,225,270,315).
 *
 * Utilisation :
 *   const tex = await ImpostorLoader.getTexture('mango');        // THREE.Texture (pour 3D viewer)
 *   const url = ImpostorLoader.getUrl('mango');                  // string ou null
 *   const img = await ImpostorLoader.getImageElement('mango');   // HTMLImageElement (pour canvas 2D)
 *   ImpostorLoader.drawViewOnCanvas(ctx, img, x, y, w, h, viewIdx); // dessine une vue specifique
 */
const ImpostorLoader = (() => {
  const cache = new Map();      // speciesKey -> promise<HTMLImageElement>
  const texCache = new Map();   // speciesKey -> promise<THREE.Texture>

  const ATLAS_COLS = 4;
  const ATLAS_ROWS = 2;
  const NUM_VIEWS = 8;

  let _db = null;
  let _dbPromise = null;
  async function _loadDb() {
    if (_db) return _db;
    if (!_dbPromise) {
      _dbPromise = fetch('./data/bpf-species-reunion.json').then(r => r.json()).then(d => { _db = d; return d; });
    }
    return _dbPromise;
  }

  async function getUrl(speciesKey) {
    const db = await _loadDb();
    return db?.species?.[speciesKey]?.impostorPath ?? null;
  }

  async function hasImpostor(speciesKey) {
    return !!(await getUrl(speciesKey));
  }

  async function getImageElement(speciesKey) {
    if (cache.has(speciesKey)) return cache.get(speciesKey);
    const url = await getUrl(speciesKey);
    if (!url) return null;
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = url;
    });
    cache.set(speciesKey, p);
    return p;
  }

  async function getTexture(speciesKey) {
    if (!window.THREE) return null;
    if (texCache.has(speciesKey)) return texCache.get(speciesKey);
    const url = await getUrl(speciesKey);
    if (!url) return null;
    const p = new Promise((resolve, reject) => {
      new window.THREE.TextureLoader().load(url, (tex) => {
        tex.colorSpace = window.THREE.SRGBColorSpace ?? tex.colorSpace;
        tex.anisotropy = 4;
        resolve(tex);
      }, undefined, reject);
    });
    texCache.set(speciesKey, p);
    return p;
  }

  /**
   * Calcule l'index de vue (0..7) le plus proche d'un azimut en radians (0 = sud, sens trigo).
   */
  function azimuthToViewIndex(azimuthRad) {
    const a = ((azimuthRad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.round(a / (Math.PI * 2 / NUM_VIEWS)) % NUM_VIEWS;
  }

  /**
   * UV rect dans l'atlas pour une vue donnee.
   * Retourne { sx, sy, sw, sh } en pixels sur l'image source.
   */
  function viewRect(img, viewIdx) {
    const cellW = img.width / ATLAS_COLS;
    const cellH = img.height / ATLAS_ROWS;
    const col = viewIdx % ATLAS_COLS;
    const row = Math.floor(viewIdx / ATLAS_COLS);
    return { sx: col * cellW, sy: row * cellH, sw: cellW, sh: cellH };
  }

  /**
   * Dessine une vue specifique de l'atlas sur un contexte Canvas 2D.
   * Utile pour un previewer SVG -> canvas, ou un plan masse hybride.
   */
  function drawViewOnCanvas(ctx, img, dx, dy, dw, dh, viewIdx = 0) {
    const { sx, sy, sw, sh } = viewRect(img, viewIdx);
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  return {
    getUrl,
    hasImpostor,
    getImageElement,
    getTexture,
    azimuthToViewIndex,
    viewRect,
    drawViewOnCanvas,
    NUM_VIEWS,
    ATLAS_COLS,
    ATLAS_ROWS,
  };
})();

export default ImpostorLoader;
