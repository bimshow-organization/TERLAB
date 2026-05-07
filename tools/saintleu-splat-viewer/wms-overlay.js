/**
 * TERLAB . wms-overlay.js
 * Helper generique pour charger un raster WMS GetMap en texture sur un
 * plane horizontal Three.js, place legerement au-dessus du terrain MNT.
 *
 * Reutilise pour : PPRN PEIGEO, PLU PEIGEO, BRGM Geologie, COSIA IGN.
 *
 * Usage :
 *   const mesh = await buildWmsOverlay({
 *     wmsUrl, layer, lat, lng, sideM,
 *     yOffset: 0.5, opacity: 0.5, version: '1.3.0',
 *   });
 *   scene.add(mesh);
 */

import * as THREE from 'three';
import { buildTerrainGeometry } from './mnt-grid.js';

const _loader = new THREE.TextureLoader();
_loader.crossOrigin = 'anonymous';


export async function buildWmsOverlay({
  wmsUrl, layer, lat, lng, sideM,
  pix = 1024,
  yOffset = 0.5,
  opacity = 0.5,
  version = '1.3.0',
  format = 'image/png',
  crs = 'EPSG:4326',  // par defaut 4326 : meme convention que conversion locale
  transparent = true,
  styles = '',
  yRefAlt = 0,
  mntInfo = null,    // si fourni, drape sur le terrain MNT (subdivise)
  draped = false,    // alias : si true et mntInfo absent, throw
} = {}) {
  if (draped && !mntInfo) throw new Error('draped=true requires mntInfo');
  // Bbox : si EPSG:4326 utilise les memes constantes que conversion locale
  // 111320 / 103900*cos(lat) -> alignement parfait. Sinon EPSG:3857 mercator.
  let bbox;
  if (crs === 'EPSG:4326') {
    const dLat = (sideM / 2) / 111320.0;
    const dLng = (sideM / 2) / (103900.0 * Math.cos(lat * Math.PI / 180));
    // WMS 1.3.0 + EPSG:4326 : ordre BBOX = lat_min,lng_min,lat_max,lng_max
    bbox = `${lat-dLat},${lng-dLng},${lat+dLat},${lng+dLng}`;
  } else {
    // Fallback EPSG:3857 (mercator)
    const R = 6378137.0;
    const cx = R * lng * Math.PI / 180;
    const cy = R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    const halfMerc = (sideM / 2) / Math.cos(lat * Math.PI / 180);
    bbox = `${cx-halfMerc},${cy-halfMerc},${cx+halfMerc},${cy+halfMerc}`;
  }

  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: version,
    REQUEST: 'GetMap',
    LAYERS: layer,
    STYLES: styles,
    CRS: crs,
    BBOX: bbox,
    WIDTH: pix.toString(),
    HEIGHT: pix.toString(),
    FORMAT: format,
    TRANSPARENT: transparent ? 'TRUE' : 'FALSE',
  });
  const url = `${wmsUrl}?${params.toString()}`;

  // Charger texture
  const tex = await new Promise((resolve, reject) => {
    _loader.load(url, t => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      resolve(t);
    }, undefined, reject);
  });

  // Geometry : soit plane plat (legacy), soit mesh terrain MNT subdivise (drape)
  let geom;
  if (mntInfo) {
    // Drape sur le MNT : reuse buildTerrainGeometry. yOffset ajoute legerement.
    geom = buildTerrainGeometry(mntInfo, mntInfo.mntMin);
    // Ajout offset Y a chaque vertex
    if (yOffset !== 0) {
      const positions = geom.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        positions.setY(i, positions.getY(i) + yOffset);
      }
      positions.needsUpdate = true;
    }
  } else {
    geom = new THREE.PlaneGeometry(sideM, sideM, 1, 1);
    geom.rotateX(-Math.PI / 2);
  }

  // SAT/Ortho a opacity 1.0 -> OPAQUE (depthWrite true, occlude correctement
  // les bati/sprites en arriere). Les overlays semi-transparents (PPRN, PLU,
  // COSIA, BRGM) restent translucides mais avec depthTest pour ordre correct.
  const isOpaque = opacity >= 0.95;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: !isOpaque,
    opacity: isOpaque ? 1.0 : opacity,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: isOpaque,
  });
  const mesh = new THREE.Mesh(geom, mat);
  if (!mntInfo) mesh.position.y = yOffset - yRefAlt;
  // renderOrder : 0 pour terrain SAT opaque (rendu en premier passe opaque),
  // 50 pour overlays semi-trans (passe trans, ordre apres opaque).
  mesh.renderOrder = isOpaque ? 0 : 50;
  mesh.frustumCulled = false;
  mesh.userData = { wmsLayer: layer, wmsUrl, draped: !!mntInfo, opaque: isOpaque };
  return mesh;
}


/** Dispose proprement texture + material + geometry */
export function disposeWmsOverlay(mesh) {
  if (!mesh) return;
  mesh.geometry?.dispose?.();
  if (mesh.material) {
    mesh.material.map?.dispose?.();
    mesh.material.dispose?.();
  }
}
