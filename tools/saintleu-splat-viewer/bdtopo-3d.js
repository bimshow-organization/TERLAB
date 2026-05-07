/**
 * TERLAB . bdtopo-3d.js
 * Charge depuis BDTOPO IGN (WFS) et rend en 3D Three.js :
 *   - batiments extrudes (hauteur reelle + couleur ortho-aplomb)
 *   - routes rubans plaques au MNT (largeur_de_chaussee)
 *   - cadastre clotures 1m (parcellaire express)
 *
 * Reprise de la logique voxel_patterns_real.py::draw_mockup_3d
 * et overlay_routes_on_mockup_3d, portee en JS Three.js.
 *
 * BBox WFS : EPSG:4326 ordre lng,lat,lng,lat (verifie sur Geoplateforme).
 */

import * as THREE from 'three';
import { lookupAltAt } from './mnt-grid.js';

const WFS_URL = 'https://data.geopf.fr/wfs/ows';

// ─── Texture facade procedurale 3m x 3m style creole (cached) ───
// 1 module 3m horizontal × 3m vertical = 1 etage avec 1 fenetre + persiennes
// + corniche haute + soubassement bas. Repete sur les murs en RepeatWrapping.
let _facadeTexture = null;
function getFacadeTexture() {
  if (_facadeTexture) return _facadeTexture;
  const W = 256, H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Mur blanc + leger crepi (la couleur creole vient du material.color tint)
  ctx.fillStyle = '#f5f0e6';
  ctx.fillRect(0, 0, W, H);

  // Bandeau corniche en haut (~15cm/3m = 13px)
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, 0, W, 13);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(0, 13, W, 4);
  // Soubassement gris fonce (~30cm)
  ctx.fillStyle = 'rgba(40,30,20,0.55)';
  ctx.fillRect(0, H - 26, W, 26);

  // Fenetre centree ~1.2m × 1.7m sur 3m × 3m -> ~102×145 px
  const winX = (W - 102) / 2, winY = 50, winW = 102, winH = 145;
  // Encadrement clair (~10cm)
  ctx.fillStyle = '#ece4d4';
  ctx.fillRect(winX - 8, winY - 8, winW + 16, winH + 16);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(winX - 8, winY - 8, winW + 16, winH + 16);
  // Volet/persiennes : fond sombre + lattes horizontales
  ctx.fillStyle = '#3d2a1a';
  ctx.fillRect(winX, winY, winW, winH);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 14; i++) {
    const y = winY + i * winH / 14;
    ctx.beginPath();
    ctx.moveTo(winX, y); ctx.lineTo(winX + winW, y); ctx.stroke();
  }
  // Separation centrale verticale (2 vantaux)
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(winX + winW / 2, winY); ctx.lineTo(winX + winW / 2, winY + winH); ctx.stroke();

  // Marquage discret separation etage / module (lignes en bordures)
  ctx.strokeStyle = 'rgba(50,42,32,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 0);   ctx.lineTo(W, 0);
  ctx.moveTo(0, H);   ctx.lineTo(W, H);
  ctx.moveTo(0, 0);   ctx.lineTo(0, H);
  ctx.moveTo(W, 0);   ctx.lineTo(W, H);
  ctx.stroke();

  // Bruit subtil (texture crepi)
  for (let i = 0; i < 800; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const a = 0.03 + Math.random() * 0.05;
    ctx.fillStyle = Math.random() > 0.5
      ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    ctx.fillRect(x, y, 1, 1);
  }

  _facadeTexture = new THREE.CanvasTexture(canvas);
  _facadeTexture.colorSpace = THREE.SRGBColorSpace;
  _facadeTexture.wrapS = THREE.RepeatWrapping;
  _facadeTexture.wrapT = THREE.RepeatWrapping;
  _facadeTexture.minFilter = THREE.LinearMipmapLinearFilter;
  _facadeTexture.magFilter = THREE.LinearFilter;
  _facadeTexture.generateMipmaps = true;
  return _facadeTexture;
}

const FACADE_MODULE_M = 3.0;

// Palette couleurs creoles typiques Saint-Leu (jaune ocre, vert,
// bleu pastel, rouge brique, blanc casse, beige). Tint via material.color
// sur la texture mur claire.
const CREOLE_PALETTE = [
  0xe8d2a0,  // jaune ocre
  0xb0c890,  // vert tendre
  0x90a8c0,  // bleu pastel
  0xd06848,  // rouge brique
  0xede8dc,  // blanc casse
  0xc4a878,  // beige
  0xa890c0,  // mauve
  0x88b0a0,  // turquoise pale
];

function pickFacadeColor(seedStr) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) {
    h = ((h * 31) + seedStr.charCodeAt(i)) | 0;
  }
  return CREOLE_PALETTE[Math.abs(h) % CREOLE_PALETTE.length];
}

// Hauteurs par defaut selon usage_1 BDTOPO (logique web-app/services/buildings-service.js)
const USAGE_HEIGHTS = {
  residentiel: 6.0, habitation: 6.0,
  commercial:  8.0, service:    8.0,
  industriel:  7.0,
  religieux:  10.0,
  sportif:     6.0,
  agricole:    2.5, annexe:     2.5,
};


function lngLatToLocal(lng, lat, latC, lngC) {
  const m_per_deg_lat = 111320.0;
  const m_per_deg_lng = 103900.0 * Math.cos(latC * Math.PI / 180);
  const x = (lng - lngC) * m_per_deg_lng;
  const z = -(lat - latC) * m_per_deg_lat;  // Y-up : nord -> -Z
  return { x, z };
}


// ─────────────────────────────────────────────────────────────────────────
// 1. WFS FETCHERS
// ─────────────────────────────────────────────────────────────────────────

async function fetchWfs(typename, lat, lng, sideM, expand = 1.1, count = 200) {
  const half = (sideM * expand) / 2;
  const dLat = half / 111320.0;
  const dLng = half / (103900.0 * Math.cos(lat * Math.PI / 180));
  const bbox = `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat},EPSG:4326`;
  const params = new URLSearchParams({
    SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature',
    typenames: typename, bbox, outputFormat: 'application/json',
    count: count.toString(),
  });
  const resp = await fetch(`${WFS_URL}?${params.toString()}`);
  if (!resp.ok) throw new Error(`WFS ${typename} HTTP ${resp.status}`);
  return await resp.json();
}


// ─────────────────────────────────────────────────────────────────────────
// 2. BATIMENTS BDTOPO (extrudes 3D)
// ─────────────────────────────────────────────────────────────────────────

function batHeights(props) {
  // Retourne {eaves, ridge} :
  //   eaves = hauteur jusqu'au debut de la pente du toit
  //   ridge = hauteur jusqu'au faitage (sommet toit)
  // Si BDTOPO fournit altitude_minimale_toit + altitude_maximale_toit -> precis
  const altSol = parseFloat(props.altitude_minimale_sol);
  const altMinToit = parseFloat(props.altitude_minimale_toit);
  const altMaxToit = parseFloat(props.altitude_maximale_toit);
  if (isFinite(altSol) && isFinite(altMinToit) && isFinite(altMaxToit)
      && altMinToit > altSol + 0.5 && altMaxToit >= altMinToit) {
    return { eaves: altMinToit - altSol, ridge: altMaxToit - altSol };
  }
  // Fallback : hauteur BDTOPO (= faitage typiquement)
  const h = parseFloat(props.hauteur);
  if (isFinite(h) && h > 0) return { eaves: h * 0.80, ridge: h };
  // Fallback : nb etages * 3m
  const et = parseFloat(props.nombre_d_etages);
  if (isFinite(et) && et > 0) {
    const r = Math.max(3.0, et * 3.0);
    return { eaves: r * 0.85, ridge: r };
  }
  // Fallback : table par usage
  const usage = (props.usage_1 ?? props.nature ?? '').toLowerCase();
  for (const k of Object.keys(USAGE_HEIGHTS)) {
    if (usage.includes(k)) {
      const r = USAGE_HEIGHTS[k];
      return { eaves: r * 0.85, ridge: r };
    }
  }
  return { eaves: 2.5, ridge: 3.0 };
}

function makeBuildingMeshes(pts, hauteurEaves, hauteurRidge, zBase, wallColor,
                             orthoTexture = null, sideM = 0, batiSeed = '') {
  // walls jusqu'a yEaves, toit en N-pans depuis chaque arete vers
  // le centroide eleve a yRidge (style "tente"). Si ridge == eaves,
  // toit plat (fan triangulation classique). UVs ortho sur le toit.
  const n = pts.length;
  const closed = (n > 2 && pts[0].x === pts[n - 1].x && pts[0].z === pts[n - 1].z);
  const outer = closed ? pts.slice(0, n - 1) : pts.slice();
  const m = outer.length;
  if (m < 3) return null;

  const yBot = zBase;
  const yEaves = zBase + hauteurEaves;
  const yRidge = zBase + Math.max(hauteurEaves, hauteurRidge);
  const hasSlope = (yRidge - yEaves) > 0.5;

  // ─── Walls (jusqu'a egout) avec UV mapping en metres reels ───
  // Texture procedurale 3mx3m repetee : chaque mur a UV (0,0 a w/3, h/3)
  const wPos = [];
  const wUv = [];
  const wIdx = [];
  for (let k = 0; k < m; k++) {
    const p1 = outer[k];
    const p2 = outer[(k + 1) % m];
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const wallWidth = Math.sqrt(dx * dx + dz * dz);
    const wallHeight = yEaves - yBot;
    const uMax = wallWidth / FACADE_MODULE_M;
    // vMax arrondi a un nombre entier d'etages : derniere ligne d'etage
    // tombe pile sur l'egout. Hauteur d'etage etiree de ±15% au max,
    // sinon visuel acceptable.
    const nStages = Math.max(1, Math.round(wallHeight / FACADE_MODULE_M));
    const vMax = nStages;
    const i = wPos.length / 3;
    wPos.push(
      p1.x, yBot, p1.z,        // 0 bot-left
      p2.x, yBot, p2.z,        // 1 bot-right
      p2.x, yEaves, p2.z,      // 2 top-right
      p1.x, yEaves, p1.z,      // 3 top-left
    );
    wUv.push(
      0,    0,
      uMax, 0,
      uMax, vMax,
      0,    vMax,
    );
    wIdx.push(i, i + 1, i + 2,  i, i + 2, i + 3);
  }
  const wallsGeom = new THREE.BufferGeometry();
  wallsGeom.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
  wallsGeom.setAttribute('uv', new THREE.Float32BufferAttribute(wUv, 2));
  wallsGeom.setIndex(wIdx);
  wallsGeom.computeVertexNormals();
  // Couleur creole tint random deterministe par bati (palette typique).
  // wallColor garde une compat (peut overrider) mais en general
  // on ignore et on tire depuis batiSeed.
  const tint = batiSeed ? pickFacadeColor(batiSeed) : (wallColor || 0xede8dc);
  const wallsMat = new THREE.MeshLambertMaterial({
    map: getFacadeTexture(),
    color: tint,           // tint applique sur la texture mur claire
    transparent: false, opacity: 1.0,
    side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const walls = new THREE.Mesh(wallsGeom, wallsMat);

  // ─── Roof : N triangles depuis aretes vers centroide ridge ───
  const cx = outer.reduce((s, p) => s + p.x, 0) / m;
  const cz = outer.reduce((s, p) => s + p.z, 0) / m;
  const half = sideM / 2;
  const useUV = orthoTexture && sideM > 0;
  const rPos = [];
  const rUv = [];
  const rIdx = [];

  // Triangulation ear-clipping (THREE.ShapeUtils) - robuste sur polygones
  // non-convexes (L, T, U, batiments BDTOPO complexes). Retourne array de
  // triangles [i, j, k] referencant les indices du contour.
  const contour2D = outer.map(p => new THREE.Vector2(p.x, p.z));
  const tris = THREE.ShapeUtils.triangulateShape(contour2D, []);

  // Convexite simple : signe du cross-product constant tout autour
  // -> pour les non-convexes, on force toit plat (sinon le centroide
  // peut etre HORS du polygone, creant des "voiles" hors silhouette).
  let isConvex = true;
  for (let k = 0; k < m; k++) {
    const p0 = outer[(k - 1 + m) % m];
    const p1 = outer[k];
    const p2 = outer[(k + 1) % m];
    const cross = (p1.x - p0.x) * (p2.z - p1.z) - (p1.z - p0.z) * (p2.x - p1.x);
    if (cross < -0.001) { isConvex = false; break; }
  }

  if (hasSlope && isConvex) {
    // Tente vers centroide pour bati convexe (rectangulaire typiquement)
    const apexU = useUV ? (cx + half) / sideM : 0;
    const apexV = useUV ? 1 - (cz + half) / sideM : 0;
    for (let k = 0; k < m; k++) {
      const p1 = outer[k];
      const p2 = outer[(k + 1) % m];
      const i = rPos.length / 3;
      rPos.push(
        p1.x, yEaves, p1.z,
        p2.x, yEaves, p2.z,
        cx,   yRidge, cz,
      );
      if (useUV) {
        rUv.push(
          (p1.x + half) / sideM, 1 - (p1.z + half) / sideM,
          (p2.x + half) / sideM, 1 - (p2.z + half) / sideM,
          apexU, apexV,
        );
      }
      rIdx.push(i, i + 1, i + 2);
    }
  } else {
    // Toit plat avec ear-clipping triangulation propre.
    // Pour les non-convexes en pente, on prend yRidge (entre eaves et faitage).
    const yFlat = isConvex ? yEaves : (yEaves + yRidge) / 2;
    for (const p of outer) {
      rPos.push(p.x, yFlat, p.z);
      if (useUV) {
        rUv.push((p.x + half) / sideM, 1 - (p.z + half) / sideM);
      }
    }
    for (const [i, j, k] of tris) {
      rIdx.push(i, j, k);
    }
  }
  const roofGeom = new THREE.BufferGeometry();
  roofGeom.setAttribute('position', new THREE.Float32BufferAttribute(rPos, 3));
  if (useUV) {
    roofGeom.setAttribute('uv', new THREE.Float32BufferAttribute(rUv, 2));
  }
  roofGeom.setIndex(rIdx);
  roofGeom.computeVertexNormals();
  const roofMat = useUV
    ? new THREE.MeshLambertMaterial({
        map: orthoTexture,
        transparent: false, opacity: 1.0,
        side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      })
    : new THREE.MeshLambertMaterial({
        color: 0xc04030,
        transparent: false, opacity: 1.0,
        side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      });
  const roof = new THREE.Mesh(roofGeom, roofMat);

  return { walls, roof };
}


/** Sample couleur RGB d'un canvas ortho (centre zone = origine).
 *  x_m, z_m : coords locales metres. Retourne 0xRRGGBB. */
function sampleOrthoCanvas(canvasCtx, w, h, sideM, x_m, z_m) {
  const half = sideM / 2;
  // ortho EPSG:3857 nord-en-haut : px = ouest->est, py = nord->sud
  const px = Math.max(0, Math.min(w - 1,
    Math.round(((x_m + half) / sideM) * (w - 1))));
  const py = Math.max(0, Math.min(h - 1,
    Math.round(((z_m + half) / sideM) * (h - 1))));
  const d = canvasCtx.getImageData(px, py, 1, 1).data;
  return (d[0] << 16) | (d[1] << 8) | d[2];
}


export async function loadBuildings3D({
  lat, lng, sideM, yRef = 0, mntInfo = null,
  orthoTexture = null,  // THREE.CanvasTexture pour drapage toits
}) {
  const geo = await fetchWfs('BDTOPO_V3:batiment', lat, lng, sideM, 1.1, 300);
  const group = new THREE.Group();
  group.name = 'bdtopo-buildings';
  let n = 0;

  for (const feat of (geo.features ?? [])) {
    const props = feat.properties ?? {};
    const { eaves, ridge } = batHeights(props);
    const gtype = feat.geometry?.type;
    let rings = [];
    if (gtype === 'Polygon') rings = [feat.geometry.coordinates[0]];
    else if (gtype === 'MultiPolygon') rings = feat.geometry.coordinates.map(p => p[0]);
    else continue;

    const half = sideM / 2;
    for (const ring of rings) {
      const pts = ring.map(c => lngLatToLocal(c[0], c[1], lat, lng));
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
      if (Math.abs(cx) > half || Math.abs(cz) > half) continue;

      // z_base : priorite mntInfo (IGN RGE ALTI 1m) -> alt_min_sol BDTOPO -> 0
      let zBase = 0;
      if (mntInfo) {
        // Min des MNT lookup sur la bbox du polygone (le pied est a son point bas)
        let minY = Infinity;
        for (const p of pts) {
          const a = lookupAltAt(mntInfo, p.x, p.z);
          if (a < minY) minY = a;
        }
        if (isFinite(minY)) zBase = Math.max(0, minY - mntInfo.mntMin);
      } else {
        const altSol = parseFloat(props.altitude_minimale_sol);
        if (isFinite(altSol)) zBase = Math.max(0, altSol - yRef);
      }

      // Toit : drape la TEXTURE ortho HD (chaque polygone toit avec
      // UVs calculees vers les pixels ortho correspondants -> tuiles,
      // tole, panneaux solaires, etc. visibles a leur place exacte).
      // Seed pour couleur creole : id BDTOPO unique du bati (cleabs)
      const batiSeed = String(feat.id || props.cleabs || `${cx}_${cz}`);
      const meshes = makeBuildingMeshes(
        pts, eaves, ridge, zBase, 0xffffff, orthoTexture, sideM, batiSeed);
      if (meshes) {
        meshes.walls.renderOrder = 10;
        meshes.roof.renderOrder = 11; // toit colore juste au-dessus des walls
        group.add(meshes.walls);
        group.add(meshes.roof);
        n++;
      }
    }
  }
  group.userData = { n_buildings: n };
  return group;
}


// ─────────────────────────────────────────────────────────────────────────
// 3. ROUTES BDTOPO (rubans plats sur MNT)
// ─────────────────────────────────────────────────────────────────────────

export async function loadRoads3D({ lat, lng, sideM, yRef = 0, expand = 3.0, mntInfo = null }) {
  const geo = await fetchWfs('BDTOPO_V3:troncon_de_route', lat, lng, sideM, expand, 200);
  const group = new THREE.Group();
  group.name = 'bdtopo-roads';

  const positions = [];
  const indices = [];
  const half = sideM / 2;
  const yLookup = (x, z) => {
    if (mntInfo) return Math.max(0, lookupAltAt(mntInfo, x, z) - mntInfo.mntMin) + 0.4;
    return 0.4 - yRef;
  };

  for (const feat of (geo.features ?? [])) {
    const props = feat.properties ?? {};
    let largeur = parseFloat(props.largeur_de_chaussee);
    if (!isFinite(largeur) || largeur <= 0) largeur = 4.0;
    const halfW = Math.max(1.0, largeur / 2);

    const gtype = feat.geometry?.type;
    let lines = [];
    if (gtype === 'LineString') lines = [feat.geometry.coordinates];
    else if (gtype === 'MultiLineString') lines = feat.geometry.coordinates;
    else continue;

    for (const coords of lines) {
      const pts = coords.map(c => lngLatToLocal(c[0], c[1], lat, lng));
      for (let k = 0; k < pts.length - 1; k++) {
        const p1 = pts[k], p2 = pts[k + 1];
        const dx = p2.x - p1.x;
        const dz = p2.z - p1.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        const nx = -dz / len, nz = dx / len;
        const p1l = { x: p1.x + nx * halfW, z: p1.z + nz * halfW };
        const p1r = { x: p1.x - nx * halfW, z: p1.z - nz * halfW };
        const p2l = { x: p2.x + nx * halfW, z: p2.z + nz * halfW };
        const p2r = { x: p2.x - nx * halfW, z: p2.z - nz * halfW };
        const allOut = [p1l, p1r, p2l, p2r].every(p =>
          Math.abs(p.x) > half * 1.2 || Math.abs(p.z) > half * 1.2);
        if (allOut) continue;
        const i = positions.length / 3;
        positions.push(
          p1l.x, yLookup(p1l.x, p1l.z), p1l.z,
          p2l.x, yLookup(p2l.x, p2l.z), p2l.z,
          p2r.x, yLookup(p2r.x, p2r.z), p2r.z,
          p1r.x, yLookup(p1r.x, p1r.z), p1r.z,
        );
        indices.push(i, i + 1, i + 2,  i, i + 2, i + 3);
      }
    }
  }

  if (positions.length === 0) return group;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    color: 0xdc2828, transparent: true, opacity: 0.85,
    side: THREE.DoubleSide,
    depthTest: true, depthWrite: false,  // Z-tested mais ne write pas
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = 59;  // au-dessus du splat (~50), juste sous profile (60+)
  mesh.frustumCulled = false;
  group.add(mesh);
  return group;
}


// ─────────────────────────────────────────────────────────────────────────
// 4. CADASTRE (clotures 1m)
// ─────────────────────────────────────────────────────────────────────────

export async function loadCadastre3D({ lat, lng, sideM, yRef = 0, fenceH = 1.0, mntInfo = null }) {
  const geo = await fetchWfs(
    'CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle',
    lat, lng, sideM, 1.1, 500);
  const group = new THREE.Group();
  group.name = 'cadastre-fences';

  const positions = [];
  const indices = [];
  const half = sideM / 2;
  const yLookup = (x, z) => {
    if (mntInfo) return Math.max(0, lookupAltAt(mntInfo, x, z) - mntInfo.mntMin);
    return -yRef;
  };

  for (const feat of (geo.features ?? [])) {
    const gtype = feat.geometry?.type;
    let rings = [];
    if (gtype === 'Polygon') rings = [feat.geometry.coordinates[0]];
    else if (gtype === 'MultiPolygon') rings = feat.geometry.coordinates.map(p => p[0]);
    else continue;

    for (const ring of rings) {
      const pts = ring.map(c => lngLatToLocal(c[0], c[1], lat, lng));
      for (let k = 0; k < pts.length - 1; k++) {
        const p1 = pts[k], p2 = pts[k + 1];
        const out1 = Math.abs(p1.x) > half * 1.2 || Math.abs(p1.z) > half * 1.2;
        const out2 = Math.abs(p2.x) > half * 1.2 || Math.abs(p2.z) > half * 1.2;
        if (out1 && out2) continue;
        const y1 = yLookup(p1.x, p1.z);
        const y2 = yLookup(p2.x, p2.z);
        const i = positions.length / 3;
        positions.push(
          p1.x, y1,            p1.z,
          p2.x, y2,            p2.z,
          p2.x, y2 + fenceH,   p2.z,
          p1.x, y1 + fenceH,   p1.z,
        );
        indices.push(i, i + 1, i + 2,  i, i + 2, i + 3);
      }
    }
  }

  if (positions.length === 0) return group;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x8a8a8a, transparent: true, opacity: 0.55,
    side: THREE.DoubleSide,
    depthTest: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = 55;  // passe transparente, entre overlays (50) et routes (60)
  group.add(mesh);
  return group;
}
