// TERLAB · utils/glb-exporter.js
// Export GLB centralisé — remplace les imports CDN éparpillés
// Utilise GLTFExporter depuis le package Three.js local
// ENSA La Réunion · MGA Architecture
// ════════════════════════════════════════════════════════════════════

import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

let _exporter = null;

const GLBExporter = {

  /**
   * Export un objet Three.js en GLB (binaire) et déclenche le téléchargement.
   * @param {THREE.Object3D} object - Scene, Group, ou Mesh à exporter
   * @param {string} filename - Nom du fichier (sans extension)
   * @returns {Promise<Blob>} le blob GLB
   */
  async download(object, filename = 'TERLAB_export') {
    const blob = await this.toBlob(object);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${filename}.glb`;
    a.click();
    URL.revokeObjectURL(a.href);
    window.TerlabToast?.show('GLB exporté', 'success', 2000);
    // Upload cloud si user BIMSHOW connecte (non bloquant)
    window.TerlabUploadService?.uploadExport?.('glb', blob, `${filename}.glb`)
      .then(url => { if (url) console.info('[GLB] uploaded', url.slice(0, 80)); })
      .catch(() => {});
    return blob;
  },

  /**
   * Export en Blob GLB (pour envoi BIMSHOW, stockage, etc.)
   * @param {THREE.Object3D} object
   * @returns {Promise<Blob>}
   */
  toBlob(object) {
    if (!_exporter) _exporter = new GLTFExporter();
    return new Promise((resolve, reject) => {
      _exporter.parse(object, glb => {
        resolve(new Blob([glb], { type: 'model/gltf-binary' }));
      }, reject, { binary: true });
    });
  },

  /**
   * Export en base64 (pour stockage session).
   * @param {THREE.Object3D} object
   * @returns {Promise<string>}
   */
  async toBase64(object) {
    const blob = await this.toBlob(object);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },
};

export default GLBExporter;
