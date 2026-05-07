/**
 * TERLAB . roads-profile.js
 * Routes BDTOPO profilees facon CityEngine : profil transverse
 * (chaussee + trottoirs + accotements) au lieu d'un ruban plat.
 *
 * Source attributs BDTOPO troncon_de_route :
 *   - largeur_de_chaussee  (m)
 *   - importance           (1=autoroute, 5=sentier)
 *   - nature               (rond_point, sentier, ...)
 *   - urbain               ('Oui' / 'Non')
 *   - nombre_de_voies
 *
 * Sortie : THREE.Group avec 3 sous-meshes :
 *   1. chaussee (asphalte sombre, +5cm Y)
 *   2. sidewalks (beton clair, +20cm Y -> relief trottoir visible)
 *   3. shoulders (accotement herbe, +5cm Y, autoroute-style)
 */

import * as THREE from 'three';
import { lookupAltAt } from './mnt-grid.js';

const WFS_URL = 'https://data.geopf.fr/wfs/ows';

const Y_ROAD     = 0.05;  // legere elevation pour z-fight terrain
const Y_SIDEWALK = 0.20;  // +15cm relief trottoir au-dessus chaussee
const Y_SHOULDER = 0.05;
const Y_GUTTER   = 0.07;  // caniveau juste sur la chaussee
const Y_ROADMARK = 0.08;  // marquages au-dessus chaussee (anti z-fight)

const ASPHALT_COLOR  = 0x6e6e6e;  // gris clair (asphalte sec)
const PATH_COLOR     = 0x8a7560;  // chemin terre/empierre brun-clair
const SIDEWALK_COLOR = 0x9a8c70;  // gris ocre / beton ancien
const SHOULDER_COLOR = 0x8c8765;  // accotement herbe jaunie
const GUTTER_COLOR   = 0x4a4a48;  // caniveau gris fonce (contraste avec chaussee claire)
const ROADMARK_COLOR = 0xf0eedf;  // marquages blanc casse

// Marquages chaussee : 3m mark + 3m gap (recommandation lignes discontinues)
const MARK_LENGTH_M = 3.0;
const MARK_GAP_M    = 3.0;
const MARK_WIDTH_M  = 0.10;


function lngLatToLocal(lng, lat, latC, lngC) {
  const m_per_deg_lat = 111320.0;
  const m_per_deg_lng = 103900.0 * Math.cos(latC * Math.PI / 180);
  const x = (lng - lngC) * m_per_deg_lng;
  const z = -(lat - latC) * m_per_deg_lat;
  return { x, z };
}


async function fetchWfs(typename, lat, lng, sideM, expand = 3.0, count = 400) {
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


/**
 * Determine profil transverse depuis attributs BDTOPO.
 * Retourne demi-largeurs chaussee/sidewalk/shoulder + materiau.
 */
function getRoadProfile(props) {
  const largeur = parseFloat(props.largeur_de_chaussee);
  const importance = parseInt(props.importance);
  const nature = (props.nature || '').toLowerCase();
  const urbain = props.urbain === 'Oui' || props.urbain === true;

  const isRoundabout = nature.includes('rond_point') || nature.includes('rond-point');
  // Sentier / chemin / piste cyclable : pas de chaussee asphalte
  if (importance >= 5 || nature.includes('sentier')
      || nature.includes('piste') || nature.includes('chemin')) {
    return {
      type: 'path', isRoundabout,
      chaussee: isFinite(largeur) && largeur > 0 ? largeur : 2.0,
      sidewalkLeft: 0, sidewalkRight: 0,
      shoulderLeft: 0.5, shoulderRight: 0.5,
      roadColor: PATH_COLOR,
    };
  }
  // Autoroute (importance 1) hors agglo : 8m chaussee + 2m accotement
  if (importance === 1 && !urbain) {
    return {
      type: 'highway', isRoundabout,
      chaussee: isFinite(largeur) && largeur > 0 ? largeur : 8.0,
      sidewalkLeft: 0, sidewalkRight: 0,
      shoulderLeft: 2.0, shoulderRight: 2.0,
      roadColor: ASPHALT_COLOR,
    };
  }
  // Nationale (importance 2) hors agglo : 7m chaussee + 1.5m accotement
  if (importance === 2 && !urbain) {
    return {
      type: 'highway', isRoundabout,
      chaussee: isFinite(largeur) && largeur > 0 ? largeur : 7.0,
      sidewalkLeft: 0, sidewalkRight: 0,
      shoulderLeft: 1.5, shoulderRight: 1.5,
      roadColor: ASPHALT_COLOR,
    };
  }
  // Urbain typique (importance 3-4) : chaussee + trottoirs des 2 cotes
  return {
    type: 'urban', isRoundabout,
    chaussee: isFinite(largeur) && largeur > 0 ? largeur : 6.0,
    sidewalkLeft: 1.5, sidewalkRight: 1.5,
    shoulderLeft: 0, shoulderRight: 0,
    roadColor: ASPHALT_COLOR,
  };
}


export async function loadRoadsProfile({
  lat, lng, sideM, yRef = 0, expand = 3.0, mntInfo = null,
}) {
  const geo = await fetchWfs(
    'BDTOPO_V3:troncon_de_route', lat, lng, sideM, expand, 400);
  const group = new THREE.Group();
  group.name = 'bdtopo-roads-profile';

  const half = sideM / 2;
  const yLookup = (x, z) => {
    if (mntInfo) return Math.max(0, lookupAltAt(mntInfo, x, z) - mntInfo.mntMin);
    return -yRef;
  };

  // 6 buffers de positions/indices selon material :
  //   chausseeAsphalt, chausseePath (sentier),
  //   sidewalk (beton trottoirs), shoulder (accotements highway),
  //   gutter (caniveau beton fonce a la jonction),
  //   roadmark (marquages dashed centraux)
  const buffers = {
    asphalt:  { pos: [], idx: [] },
    path:     { pos: [], idx: [] },
    sidewalk: { pos: [], idx: [] },
    shoulder: { pos: [], idx: [] },
    gutter:   { pos: [], idx: [] },
    roadmark: { pos: [], idx: [] },
  };

  /**
   * Resample une polyline pour que chaque segment fasse au maximum maxLenM
   * metres. Permet de densifier les angles avant mitering => moins de
   * cassures aux courbes serrees.
   */
  function densifyPolyline(pts, maxLenM = 3.0) {
    if (pts.length < 2) return pts;
    const out = [pts[0]];
    for (let k = 0; k < pts.length - 1; k++) {
      const p1 = pts[k], p2 = pts[k + 1];
      const dx = p2.x - p1.x, dz = p2.z - p1.z;
      const len = Math.hypot(dx, dz);
      if (len > maxLenM) {
        const n = Math.ceil(len / maxLenM);
        for (let i = 1; i < n; i++) {
          const t = i / n;
          out.push({ x: p1.x + dx * t, z: p1.z + dz * t });
        }
      }
      out.push(p2);
    }
    return out;
  }

  /**
   * Calcule normale + ratio d'extension (miter) pour chaque vertex d'une
   * polyline. Aux extremites : normale du segment adjacent. Au milieu :
   * bisectrice entre les 2 normales adjacentes, length 1/cos(angle/2)
   * pour que le bord externe soit continu d'un segment a l'autre.
   * Limit miter ratio a 8 pour eviter les "spikes" sur angles tres aigus.
   */
  function computeMiterNormals(pts) {
    const n = pts.length;
    const out = new Array(n);
    for (let k = 0; k < n; k++) {
      const prev = k > 0 ? pts[k - 1] : null;
      const curr = pts[k];
      const next = k < n - 1 ? pts[k + 1] : null;
      let n1x = 0, n1z = 0, n2x = 0, n2z = 0;
      if (prev) {
        const dx = curr.x - prev.x, dz = curr.z - prev.z;
        const l = Math.hypot(dx, dz) || 1;
        n1x = -dz / l; n1z = dx / l;
      }
      if (next) {
        const dx = next.x - curr.x, dz = next.z - curr.z;
        const l = Math.hypot(dx, dz) || 1;
        n2x = -dz / l; n2z = dx / l;
      }
      if (!prev) { out[k] = { nx: n2x, nz: n2z, ratio: 1 }; continue; }
      if (!next) { out[k] = { nx: n1x, nz: n1z, ratio: 1 }; continue; }
      const bx = n1x + n2x, bz = n1z + n2z;
      const blen = Math.hypot(bx, bz);
      if (blen < 0.05) {
        // Segments quasi colineaires inverse (demi-tour) : fallback simple
        out[k] = { nx: n1x, nz: n1z, ratio: 1 };
        continue;
      }
      const dot = n1x * n2x + n1z * n2z;
      const cosHalf = Math.sqrt(Math.max(0.02, (1 + dot) / 2));
      const ratio = Math.min(8, 1 / cosHalf);
      out[k] = { nx: bx / blen, nz: bz / blen, ratio };
    }
    return out;
  }

  /**
   * Ajoute une bande continue le long d'une polyline pts, decalee
   * perpendiculairement de offA (interne) a offB (externe) avec mitering
   * aux jonctions internes (continuite du bord).
   */
  function addPolylineBand(buf, pts, normals, offA, offB, yOffset, yBoost = 0) {
    if (pts.length < 2) return;
    for (let k = 0; k < pts.length - 1; k++) {
      const p1 = pts[k], p2 = pts[k + 1];
      const n1 = normals[k], n2 = normals[k + 1];
      const oA1 = offA * n1.ratio;
      const oA2 = offA * n2.ratio;
      const oB1 = offB * n1.ratio;
      const oB2 = offB * n2.ratio;
      const p1i = { x: p1.x + n1.nx * oA1, z: p1.z + n1.nz * oA1 };
      const p2i = { x: p2.x + n2.nx * oA2, z: p2.z + n2.nz * oA2 };
      const p2o = { x: p2.x + n2.nx * oB2, z: p2.z + n2.nz * oB2 };
      const p1o = { x: p1.x + n1.nx * oB1, z: p1.z + n1.nz * oB1 };
      const allOut = [p1i, p2i, p2o, p1o].every(p =>
        Math.abs(p.x) > half * 1.5 || Math.abs(p.z) > half * 1.5);
      if (allOut) continue;
      const i = buf.pos.length / 3;
      buf.pos.push(
        p1i.x, yLookup(p1i.x, p1i.z) + yOffset + yBoost, p1i.z,
        p2i.x, yLookup(p2i.x, p2i.z) + yOffset + yBoost, p2i.z,
        p2o.x, yLookup(p2o.x, p2o.z) + yOffset + yBoost, p2o.z,
        p1o.x, yLookup(p1o.x, p1o.z) + yOffset + yBoost, p1o.z,
      );
      buf.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
  }

  /**
   * Ajoute des marquages dashed centres sur l'axe de la route, decales de
   * `centerOffset` perpendiculairement (0 = milieu de chaussee), de largeur
   * markWidth, longueur markLen (m), gap markGap (m).
   * Les marques sont des bandes alignees avec la direction du segment.
   */
  function addDashedMarks(buf, p1, p2, centerOffset, yOffset,
                          markLen, markGap, markWidth) {
    const dx = p2.x - p1.x, dz = p2.z - p1.z;
    const len = Math.hypot(dx, dz);
    if (len < markLen) return;
    const ux = dx / len, uz = dz / len;       // direction unitaire segment
    const nx = -uz,      nz = ux;             // perpendiculaire (gauche)
    const halfW = markWidth / 2;
    const period = markLen + markGap;
    const nMarks = Math.floor((len + markGap) / period);
    for (let m = 0; m < nMarks; m++) {
      const s0 = m * period + markGap / 2;            // debut marque (m)
      const s1 = s0 + markLen;                        // fin marque (m)
      if (s1 > len) break;
      // 4 corners de la marque rectangulaire
      const cx0 = p1.x + ux * s0;
      const cz0 = p1.z + uz * s0;
      const cx1 = p1.x + ux * s1;
      const cz1 = p1.z + uz * s1;
      // Decalage perpendiculaire centerOffset puis ±halfW autour
      const baseX0 = cx0 + nx * centerOffset;
      const baseZ0 = cz0 + nz * centerOffset;
      const baseX1 = cx1 + nx * centerOffset;
      const baseZ1 = cz1 + nz * centerOffset;
      const v0 = { x: baseX0 + nx * halfW, z: baseZ0 + nz * halfW };
      const v1 = { x: baseX1 + nx * halfW, z: baseZ1 + nz * halfW };
      const v2 = { x: baseX1 - nx * halfW, z: baseZ1 - nz * halfW };
      const v3 = { x: baseX0 - nx * halfW, z: baseZ0 - nz * halfW };
      const i = buf.pos.length / 3;
      buf.pos.push(
        v0.x, yLookup(v0.x, v0.z) + yOffset, v0.z,
        v1.x, yLookup(v1.x, v1.z) + yOffset, v1.z,
        v2.x, yLookup(v2.x, v2.z) + yOffset, v2.z,
        v3.x, yLookup(v3.x, v3.z) + yOffset, v3.z,
      );
      buf.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
  }

  /**
   * Disque d'asphalte plat (16 segments) pour masquer les cassures aux
   * jonctions T/+ entre features BDTOPO separees. Utilise le buffer
   * asphalt. Si la jonction est sur un rond-point, on prefere un anneau.
   */
  function addAsphaltDisk(buf, cx, cz, radius, yOffset) {
    const N = 16;
    const cy = yLookup(cx, cz);
    const centerIdx = buf.pos.length / 3;
    buf.pos.push(cx, cy + yOffset, cz);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = cx + Math.cos(a) * radius;
      const z = cz + Math.sin(a) * radius;
      buf.pos.push(x, yLookup(x, z) + yOffset, z);
    }
    for (let i = 0; i < N; i++) {
      buf.idx.push(centerIdx, centerIdx + 1 + i,
                    centerIdx + 1 + ((i + 1) % N));
    }
  }

  // Pre-pass : collecter tous les endpoints de polylignes pour detecter
  // les jonctions T/+ (>=2 endpoints proches).
  const endpoints = [];  // {x, z, halfWidth}
  for (const feat of (geo.features ?? [])) {
    const props = feat.properties ?? {};
    const profile = getRoadProfile(props);
    const halfC = profile.chaussee / 2;
    const gtype = feat.geometry?.type;
    let lines = [];
    if (gtype === 'LineString') lines = [feat.geometry.coordinates];
    else if (gtype === 'MultiLineString') lines = feat.geometry.coordinates;
    else continue;
    for (const coords of lines) {
      if (coords.length < 1) continue;
      const c0 = coords[0];
      const cn = coords[coords.length - 1];
      const p0 = lngLatToLocal(c0[0], c0[1], lat, lng);
      const p1 = lngLatToLocal(cn[0], cn[1], lat, lng);
      endpoints.push({ x: p0.x, z: p0.z, halfWidth: halfC });
      endpoints.push({ x: p1.x, z: p1.z, halfWidth: halfC });
    }
  }
  // Cluster endpoints distance < 2m -> jonctions a couvrir d'un disque
  const visited = new Array(endpoints.length).fill(false);
  for (let i = 0; i < endpoints.length; i++) {
    if (visited[i]) continue;
    visited[i] = true;
    const cluster = [endpoints[i]];
    for (let j = i + 1; j < endpoints.length; j++) {
      if (visited[j]) continue;
      const dx = endpoints[i].x - endpoints[j].x;
      const dz = endpoints[i].z - endpoints[j].z;
      if (Math.hypot(dx, dz) < 2.0) {
        cluster.push(endpoints[j]);
        visited[j] = true;
      }
    }
    if (cluster.length < 2) continue;  // pas une jonction reelle
    const cx = cluster.reduce((s, p) => s + p.x, 0) / cluster.length;
    const cz = cluster.reduce((s, p) => s + p.z, 0) / cluster.length;
    if (Math.abs(cx) > half * 1.5 || Math.abs(cz) > half * 1.5) continue;
    // Rayon = max halfWidth des branches + 1m de marge
    const r = Math.max(...cluster.map(p => p.halfWidth)) + 1.0;
    addAsphaltDisk(buffers.asphalt, cx, cz, r, Y_ROAD);
  }

  let nFeatures = 0, nUrban = 0, nHighway = 0, nPath = 0;

  for (const feat of (geo.features ?? [])) {
    const props = feat.properties ?? {};
    const profile = getRoadProfile(props);
    const halfC = profile.chaussee / 2;
    const swL = profile.sidewalkLeft;
    const swR = profile.sidewalkRight;
    const shL = profile.shoulderLeft;
    const shR = profile.shoulderRight;
    const chausseeBuf = profile.type === 'path' ? buffers.path : buffers.asphalt;

    if (profile.type === 'urban') nUrban++;
    else if (profile.type === 'highway') nHighway++;
    else if (profile.type === 'path') nPath++;

    const gtype = feat.geometry?.type;
    let lines = [];
    if (gtype === 'LineString') lines = [feat.geometry.coordinates];
    else if (gtype === 'MultiLineString') lines = feat.geometry.coordinates;
    else continue;
    nFeatures++;

    // Pont/tunnel : decalage Y (BDTOPO position_par_rapport_au_sol)
    const positionSol = parseInt(props.position_par_rapport_au_sol);
    let yBoost = 0;
    if (positionSol === 1) yBoost = 4.5;       // pont
    else if (positionSol === -1) yBoost = -3.0; // tunnel
    else if (positionSol >= 2) yBoost = 4.5 * positionSol;

    for (const coords of lines) {
      const rawPts = coords.map(c => lngLatToLocal(c[0], c[1], lat, lng));
      if (rawPts.length < 2) continue;
      // Densifier : split segments > 3m en sub-segments. Resultat : courbes
      // mieux miterees, raccords plus lisses sur ronds-points.
      const pts = densifyPolyline(rawPts, 3.0);
      // Calcul normales miter sur la polyline complete (continuite jonctions)
      const normals = computeMiterNormals(pts);
      // Chaussee complete (-halfC a +halfC)
      addPolylineBand(chausseeBuf, pts, normals, -halfC, halfC, Y_ROAD, yBoost);
      // Trottoir gauche + caniveau gauche
      if (swL > 0) {
        addPolylineBand(buffers.sidewalk, pts, normals,
                         halfC, halfC + swL, Y_SIDEWALK, yBoost);
        addPolylineBand(buffers.gutter, pts, normals,
                         halfC - 0.10, halfC, Y_GUTTER, yBoost);
      }
      // Trottoir droit + caniveau droit
      if (swR > 0) {
        addPolylineBand(buffers.sidewalk, pts, normals,
                         -(halfC + swR), -halfC, Y_SIDEWALK, yBoost);
        addPolylineBand(buffers.gutter, pts, normals,
                         -halfC, -(halfC - 0.10), Y_GUTTER, yBoost);
      }
      // Accotements
      if (shL > 0) {
        addPolylineBand(buffers.shoulder, pts, normals,
                         halfC + swL, halfC + swL + shL, Y_SHOULDER, yBoost);
      }
      if (shR > 0) {
        addPolylineBand(buffers.shoulder, pts, normals,
                         -(halfC + swR + shR), -(halfC + swR), Y_SHOULDER, yBoost);
      }
      // Marquage central dashed (segment-par-segment, pas continu)
      if (profile.type !== 'path' && profile.chaussee >= 5.0
          && !profile.isRoundabout) {
        for (let k = 0; k < pts.length - 1; k++) {
          addDashedMarks(buffers.roadmark, pts[k], pts[k + 1], 0,
                          Y_ROADMARK + yBoost,
                          MARK_LENGTH_M, MARK_GAP_M, MARK_WIDTH_M);
        }
      }
    }
  }

  function makeMesh(buf, color, renderOrder) {
    if (buf.pos.length === 0) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
    geom.setIndex(buf.idx);
    geom.computeVertexNormals();
    // transparent + depthWrite=false : le splat (rendu en gaussiennes
    // alpha-blended) ecrase sinon nos materials opaques. Cette config
    // les force a etre dessines par-dessus dans l'ordre des renderOrder.
    const mat = new THREE.MeshLambertMaterial({
      color, side: THREE.DoubleSide,
      transparent: true, opacity: 1.0,
      depthTest: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    return mesh;
  }

  // RenderOrder eleves (60+) pour passer apres le splat (qui se rend
  // typiquement vers 50). Empile : shoulder < asphalt/path < sidewalk
  // < gutter < roadmark (lignes blanches au-dessus de tout).
  const chausseeMesh = makeMesh(buffers.asphalt,  ASPHALT_COLOR,  62);
  const pathMesh     = makeMesh(buffers.path,     PATH_COLOR,     62);
  const sidewalkMesh = makeMesh(buffers.sidewalk, SIDEWALK_COLOR, 63);
  const shoulderMesh = makeMesh(buffers.shoulder, SHOULDER_COLOR, 61);
  const gutterMesh   = makeMesh(buffers.gutter,   GUTTER_COLOR,   64);
  const roadmarkMesh = makeMesh(buffers.roadmark, ROADMARK_COLOR, 65);

  if (chausseeMesh) { chausseeMesh.name = 'roads-asphalt'; group.add(chausseeMesh); }
  if (pathMesh)     { pathMesh.name = 'roads-path';        group.add(pathMesh); }
  if (sidewalkMesh) { sidewalkMesh.name = 'roads-sidewalk'; group.add(sidewalkMesh); }
  if (shoulderMesh) { shoulderMesh.name = 'roads-shoulder'; group.add(shoulderMesh); }
  if (gutterMesh)   { gutterMesh.name = 'roads-gutter';    group.add(gutterMesh); }
  if (roadmarkMesh) { roadmarkMesh.name = 'roads-roadmark'; group.add(roadmarkMesh); }

  group.userData = { n_features: nFeatures, n_urban: nUrban,
                     n_highway: nHighway, n_path: nPath };
  return group;
}
