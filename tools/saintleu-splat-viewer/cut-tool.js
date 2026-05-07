/**
 * TERLAB . cut-tool.js
 * Outil de coupe transversale interactif :
 *   - 2 handles 3D draggables (sphere bleue A, sphere rouge B)
 *   - Ligne orange entre les deux
 *   - Sample 200 points le long de A->B :
 *       * sol = lookupAltAt(MNT IGN)
 *       * batis = raycaster vertical depuis +inf vers le bas
 *                 sur le group BDTOPO buildings
 *       * arbres = lidar_trees dans rayon 3m du sample
 *   - Callback onProfileUpdate(profile) appele a chaque drag pour
 *     rafraichir le bottom panel SVG.
 *
 * Usage :
 *   const cut = createCutTool({...});
 *   cut.start();             // affiche les handles, active drag
 *   cut.stop();              // masque
 *   cut.setPoints({A, B});   // forcer positions
 *   cut.dispose();
 */

import * as THREE from 'three';

const HANDLE_RADIUS    = 1.5;
const HANDLE_COLOR_A   = 0x4080ff;  // bleu
const HANDLE_COLOR_B   = 0xff5060;  // rouge
const LINE_COLOR       = 0xffaa00;  // orange
const N_SAMPLES        = 200;
const TREE_NEAR_RADIUS = 3.0;       // m


export function createCutTool({
  scene, camera, renderer, domElement,
  mntInfo, lookupAltAt,
  bdtopoBuildingsGroup,    // THREE.Group des batis BDTOPO (peut etre null)
  lidarTreesData,          // {trees: [{lat,lng,h,...}]} (peut etre null)
  splatViewer,             // GaussianSplats3D.Viewer pour acces splat centers
  zoneCenterLat, zoneCenterLng, sideM,
  onProfileUpdate,
}) {
  const mntMin = mntInfo?.mntMin ?? 0;
  const half = sideM / 2;

  const group = new THREE.Group();
  group.name = 'cut-tool';
  group.visible = false;
  scene.add(group);

  const handleGeom = new THREE.SphereGeometry(HANDLE_RADIUS, 12, 8);
  const matA = new THREE.MeshBasicMaterial({
    color: HANDLE_COLOR_A, depthTest: false, transparent: true, opacity: 0.95,
  });
  const matB = new THREE.MeshBasicMaterial({
    color: HANDLE_COLOR_B, depthTest: false, transparent: true, opacity: 0.95,
  });
  const handleA = new THREE.Mesh(handleGeom, matA);
  const handleB = new THREE.Mesh(handleGeom, matB);
  handleA.userData.role = 'A';
  handleB.userData.role = 'B';
  handleA.renderOrder = 9999;
  handleB.renderOrder = 9999;
  group.add(handleA);
  group.add(handleB);

  const lineGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0),
  ]);
  const lineMat = new THREE.LineBasicMaterial({
    color: LINE_COLOR, depthTest: false,
    transparent: true, opacity: 0.85, linewidth: 3,
  });
  const line = new THREE.Line(lineGeom, lineMat);
  line.renderOrder = 9998;
  group.add(line);

  // Positions initiales : -25m a +25m sur l'axe X
  let posA = { x: -25, z: 0 };
  let posB = { x: 25, z: 0 };

  function altAt(x, z) {
    return mntInfo
      ? Math.max(0, lookupAltAt(mntInfo, x, z) - mntMin)
      : 0;
  }

  function updateHandlesAndLine() {
    handleA.position.set(posA.x, altAt(posA.x, posA.z) + 1.0, posA.z);
    handleB.position.set(posB.x, altAt(posB.x, posB.z) + 1.0, posB.z);
    const positions = lineGeom.attributes.position.array;
    positions[0] = handleA.position.x;
    positions[1] = handleA.position.y;
    positions[2] = handleA.position.z;
    positions[3] = handleB.position.x;
    positions[4] = handleB.position.y;
    positions[5] = handleB.position.z;
    lineGeom.attributes.position.needsUpdate = true;
  }

  // Pre-compute tree positions en local pour rapid lookup pendant sampling
  let treesLocal = [];
  function recomputeTreesLocal() {
    treesLocal = [];
    if (!lidarTreesData?.trees) return;
    const m_per_deg_lat = 111320.0;
    const m_per_deg_lng = 103900.0 * Math.cos(zoneCenterLat * Math.PI / 180);
    for (const t of lidarTreesData.trees) {
      const dx = (t.lng - zoneCenterLng) * m_per_deg_lng;
      const dy = (t.lat - zoneCenterLat) * m_per_deg_lat;
      if (Math.abs(dx) > half * 1.2 || Math.abs(dy) > half * 1.2) continue;
      treesLocal.push({ x: dx, z: -dy, h: t.h, alt: t.alt });
    }
  }
  recomputeTreesLocal();

  // Cache splat centers en Float32Array pour iteration rapide
  // au moment de la coupe. Re-compute si splat change (zone change).
  let splatCenters = null;  // Float32Array(N*3) [x,y,z, x,y,z, ...]
  function recomputeSplatCenters() {
    splatCenters = null;
    if (!splatViewer) return;
    const splatMesh = splatViewer.splatMesh;
    if (!splatMesh || typeof splatMesh.getSplatCenter !== 'function') return;
    const count = splatMesh.getSplatCount?.() || 0;
    if (count <= 0) return;
    const arr = new Float32Array(count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      try {
        splatMesh.getSplatCenter(i, v);
        arr[i*3]     = v.x;
        arr[i*3 + 1] = v.y;
        arr[i*3 + 2] = v.z;
      } catch { continue; }
    }
    splatCenters = arr;
    console.log(`[cut-tool] splat centers cached : ${count} points`);
  }
  // Defer le cache splats : besoin que mkkellogg ait fini de loader
  setTimeout(recomputeSplatCenters, 800);

  const _ray = new THREE.Raycaster();
  const _down = new THREE.Vector3(0, -1, 0);
  const _rayOrigin = new THREE.Vector3();

  function getProfile() {
    const dx = posB.x - posA.x;
    const dz = posB.z - posA.z;
    const totalLen = Math.hypot(dx, dz);
    if (totalLen < 0.5) {
      return { totalLen: 0, samples: [], posA, posB };
    }
    const samples = new Array(N_SAMPLES + 1);
    for (let i = 0; i <= N_SAMPLES; i++) {
      const t = i / N_SAMPLES;
      const x = posA.x + dx * t;
      const z = posA.z + dz * t;
      const distM = totalLen * t;
      const ground = altAt(x, z);
      // Bati : raycaster top-down sur bdtopoBuildingsGroup
      let buildY = null;
      if (bdtopoBuildingsGroup) {
        _rayOrigin.set(x, 1000, z);
        _ray.set(_rayOrigin, _down);
        _ray.far = 2000;
        const hits = _ray.intersectObject(bdtopoBuildingsGroup, true);
        if (hits.length > 0) {
          // Le plus haut hit (toit) - hits sont ordonnees du proche au loin
          // raycast venant d'en haut, le plus proche = le plus haut
          buildY = hits[0].point.y;
        }
      }
      // Tree : nearest tree dans rayon
      let treeH = null;
      let treeY = null;
      for (const tr of treesLocal) {
        const ddx = tr.x - x, ddz = tr.z - z;
        if (ddx * ddx + ddz * ddz < TREE_NEAR_RADIUS * TREE_NEAR_RADIUS) {
          const candY = altAt(tr.x, tr.z) + tr.h;
          if (treeY === null || candY > treeY) {
            treeY = candY;
            treeH = tr.h;
          }
        }
      }
      samples[i] = { dist: distM, ground, build: buildY, tree: treeY };
    }
    // Splat slice : projection des splat centers dans une bande de 1.0m
    // perpendiculaire au segment AB. Filtrage rapide via bbox + dot product.
    const splatPoints = [];
    if (splatCenters && totalLen > 0.5) {
      const ux = dx / totalLen, uz = dz / totalLen;
      const halfBandW = 1.0;
      // bbox englobante du segment + bande
      const minX = Math.min(posA.x, posB.x) - halfBandW - 1;
      const maxX = Math.max(posA.x, posB.x) + halfBandW + 1;
      const minZ = Math.min(posA.z, posB.z) - halfBandW - 1;
      const maxZ = Math.max(posA.z, posB.z) + halfBandW + 1;
      for (let i = 0; i < splatCenters.length; i += 3) {
        const sx = splatCenters[i];
        const sy = splatCenters[i + 1];
        const sz = splatCenters[i + 2];
        if (sx < minX || sx > maxX || sz < minZ || sz > maxZ) continue;
        const rx = sx - posA.x, rz = sz - posA.z;
        const proj = rx * ux + rz * uz;
        if (proj < 0 || proj > totalLen) continue;
        const perp = Math.abs(rx * (-uz) + rz * ux);
        if (perp > halfBandW) continue;
        splatPoints.push(proj, sy);
      }
    }
    return { totalLen, samples, splatPoints,
             posA: { ...posA }, posB: { ...posB } };
  }

  // Drag pointer events
  let activeHandle = null;
  const _mouse = new THREE.Vector2();
  const _pickRay = new THREE.Raycaster();

  function setMouseFromEvent(e) {
    const rect = domElement.getBoundingClientRect();
    _mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _pickRay.setFromCamera(_mouse, camera);
  }

  function intersectGroundPlane() {
    // Plan horizontal Y = altAt approx, projete depuis le ray courant.
    // Pour simplifier on intersecte avec Y=0 (= MNT min, niveau bas).
    // Puis on raffine via altAt(x, z).
    const t = -_pickRay.ray.origin.y / _pickRay.ray.direction.y;
    if (t <= 0 || !isFinite(t)) return null;
    const x = _pickRay.ray.origin.x + _pickRay.ray.direction.x * t;
    const z = _pickRay.ray.origin.z + _pickRay.ray.direction.z * t;
    return { x, z };
  }

  // Recherche les controls OrbitControls dans le splatViewer pour pouvoir
  // les desactiver pendant le drag d'un handle (sinon mkkellogg gere
  // les pointerdown en simultane et la camera bouge).
  function setControlsEnabled(enabled) {
    const ctrls = splatViewer?.controls;
    if (ctrls && typeof ctrls.enabled === 'boolean') {
      ctrls.enabled = enabled;
    }
  }

  function onPointerDown(e) {
    setMouseFromEvent(e);
    const hits = _pickRay.intersectObjects([handleA, handleB], false);
    if (hits.length > 0) {
      activeHandle = hits[0].object;
      setControlsEnabled(false);
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();
      window.addEventListener('pointermove', onPointerMove, true);
      window.addEventListener('pointerup', onPointerUp, true);
    }
  }

  function onPointerMove(e) {
    if (!activeHandle) return;
    setMouseFromEvent(e);
    const p = intersectGroundPlane();
    if (!p) return;
    const cx = Math.max(-half * 1.5, Math.min(half * 1.5, p.x));
    const cz = Math.max(-half * 1.5, Math.min(half * 1.5, p.z));
    if (activeHandle.userData.role === 'A') {
      posA.x = cx; posA.z = cz;
    } else {
      posB.x = cx; posB.z = cz;
    }
    updateHandlesAndLine();
    onProfileUpdate?.(getProfile());
    e.stopPropagation();
    e.stopImmediatePropagation();
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (activeHandle) {
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();
    }
    activeHandle = null;
    setControlsEnabled(true);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
  }

  function start() {
    group.visible = true;
    // capture: true pour interceper avant mkkellogg OrbitControls
    domElement.addEventListener('pointerdown', onPointerDown, true);
    updateHandlesAndLine();
    onProfileUpdate?.(getProfile());
  }

  function stop() {
    group.visible = false;
    domElement.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    setControlsEnabled(true);
    activeHandle = null;
  }

  function setPoints(a, b) {
    if (a) { posA.x = a.x; posA.z = a.z; }
    if (b) { posB.x = b.x; posB.z = b.z; }
    updateHandlesAndLine();
    onProfileUpdate?.(getProfile());
  }

  function refreshContext({ bdtopoBuildingsGroup: newBld, lidarTreesData: newTrees }) {
    if (newBld !== undefined) bdtopoBuildingsGroup = newBld;
    if (newTrees !== undefined) {
      lidarTreesData = newTrees;
      recomputeTreesLocal();
    }
    if (group.visible) {
      onProfileUpdate?.(getProfile());
    }
  }

  function dispose() {
    stop();
    scene.remove(group);
    handleGeom.dispose();
    matA.dispose();
    matB.dispose();
    lineGeom.dispose();
    lineMat.dispose();
  }

  return { start, stop, setPoints, getProfile, refreshContext, dispose,
            isVisible: () => group.visible };
}
