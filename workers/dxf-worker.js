// TERLAB · workers/dxf-worker.js v2
// Export DXF complet — vrai contour parcelle + reculs + gabarit + annotations
// Format DXF R12 ASCII — compatible AutoCAD, FreeCAD, DraftSight, LibreCAD

const DXFWorker = {

  // ─── EXPORT PRINCIPAL ──────────────────────────────────────────
  generate(sessionData) {
    const terrain = sessionData.terrain ?? {};
    const p4      = sessionData.phases?.[4]?.data ?? {};
    const p7      = sessionData.phases?.[7]?.data ?? {};

    // Récupérer la géométrie réelle de la parcelle si disponible
    const parcelleGeom = terrain.parcelle_geojson;

    // Calculer l'emprise (points en mètres depuis centroïde)
    const pts = parcelleGeom
      ? this._geojsonToLocal(parcelleGeom, terrain)
      : this._approximateParcel(terrain);

    const commune    = terrain.commune ?? 'La_Réunion';
    const ref        = `${terrain.section ?? ''}${terrain.parcelle ?? ''}`;
    const contenance = parseFloat(terrain.contenance_m2 ?? 0);

    // Reculs en mètres
    const rv   = parseFloat(p4.recul_voie_principale_m ?? 0);
    const rs   = parseFloat(p4.recul_limite_sep_m ?? 0);
    const rf   = parseFloat(p4.recul_fond_m ?? 0);
    const rv2  = parseFloat(p4.recul_voie_secondaire_m ?? 0);
    const hmax = parseFloat(p4.hauteur_max_m ?? 0);

    // Gabarit Phase 7
    const gl = parseFloat(p7.gabarit_l_m ?? 0);
    const gw = parseFloat(p7.gabarit_w_m ?? 0);
    const gh = parseFloat(p7.gabarit_h_m ?? 0);

    const now   = new Date().toISOString().replace('T',' ').slice(0,19);
    const lines = [];

    // ─── HEADER DXF ────────────────────────────────────────────
    lines.push('0\nSECTION\n2\nHEADER');
    lines.push('9\n$ACADVER\n1\nAC1009');   // DXF R12 — compatibilité max
    lines.push('9\n$INSUNITS\n70\n6');      // Unités : mètres
    lines.push('9\n$EXTMIN\n10\n-50.0\n20\n-50.0');
    lines.push('9\n$EXTMAX\n10\n200.0\n20\n200.0');
    lines.push('0\nENDSEC');

    // ─── TABLES ────────────────────────────────────────────────
    lines.push('0\nSECTION\n2\nTABLES');
    lines.push('0\nTABLE\n2\nLAYER\n70\n8');

    const LAYERS = [
      ['PARCELLE',      7, 'CONTINUOUS'],   // Blanc  — contour parcelle
      ['RECULS',        5, 'DASHED'],        // Bleu   — reculs réglementaires
      ['ZONE_CONSTR',   3, 'CONTINUOUS'],    // Vert   — zone constructible
      ['GABARIT',       2, 'CONTINUOUS'],    // Jaune  — gabarit Phase 7
      ['ANNOTATIONS',   1, 'CONTINUOUS'],    // Rouge  — textes
      ['COTATIONS',     6, 'CONTINUOUS'],    // Magenta — cotes
      ['REPERES_GPS',   4, 'CONTINUOUS'],    // Cyan   — repères GPS
    ];

    for (const [name, color, ltype] of LAYERS) {
      lines.push(`0\nLAYER\n2\n${name}\n70\n0\n62\n${color}\n6\n${ltype}`);
    }
    lines.push('0\nENDTABLE\n0\nENDSEC');

    // ─── ENTITIES ──────────────────────────────────────────────
    lines.push('0\nSECTION\n2\nENTITIES');

    // PARCELLE — contour réel ou approximé
    if (pts.length >= 3) {
      lines.push(`0\nLWPOLYLINE\n8\nPARCELLE\n70\n1\n90\n${pts.length}`);
      for (const [x, y] of pts) { lines.push(`10\n${x.toFixed(3)}\n20\n${y.toFixed(3)}`); }
    }

    // Calculer la bbox de la parcelle pour les reculs
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    const ymin = Math.min(...ys), ymax = Math.max(...ys);
    const cx = (xmin+xmax)/2, cy = (ymin+ymax)/2;

    // RECULS — hachures intérieures
    if (rv > 0 || rs > 0 || rf > 0) {
      const rx1 = xmin + rs;
      const rx2 = xmax - rs;
      const ry1 = ymin + rv;    // Voie principale (sud par défaut)
      const ry2 = ymax - rf;

      if (rx2 > rx1 && ry2 > ry1) {
        lines.push(`0\nLWPOLYLINE\n8\nRECULS\n70\n1\n90\n4`);
        lines.push(`10\n${rx1.toFixed(3)}\n20\n${ry1.toFixed(3)}`);
        lines.push(`10\n${rx2.toFixed(3)}\n20\n${ry1.toFixed(3)}`);
        lines.push(`10\n${rx2.toFixed(3)}\n20\n${ry2.toFixed(3)}`);
        lines.push(`10\n${rx1.toFixed(3)}\n20\n${ry2.toFixed(3)}`);

        // ZONE CONSTRUCTIBLE
        lines.push(`0\nLWPOLYLINE\n8\nZONE_CONSTR\n70\n1\n90\n4`);
        lines.push(`10\n${(rx1+1).toFixed(3)}\n20\n${(ry1+1).toFixed(3)}`);
        lines.push(`10\n${(rx2-1).toFixed(3)}\n20\n${(ry1+1).toFixed(3)}`);
        lines.push(`10\n${(rx2-1).toFixed(3)}\n20\n${(ry2-1).toFixed(3)}`);
        lines.push(`10\n${(rx1+1).toFixed(3)}\n20\n${(ry2-1).toFixed(3)}`);
      }
    }

    // GABARIT Phase 7
    if (gl > 0 && gw > 0) {
      const gx1 = cx - gl/2, gx2 = cx + gl/2;
      const gy1 = cy - gw/2, gy2 = cy + gw/2;
      lines.push(`0\nLWPOLYLINE\n8\nGABARIT\n70\n1\n90\n4`);
      lines.push(`10\n${gx1.toFixed(3)}\n20\n${gy1.toFixed(3)}`);
      lines.push(`10\n${gx2.toFixed(3)}\n20\n${gy1.toFixed(3)}`);
      lines.push(`10\n${gx2.toFixed(3)}\n20\n${gy2.toFixed(3)}`);
      lines.push(`10\n${gx1.toFixed(3)}\n20\n${gy2.toFixed(3)}`);

      // Diagonales gabarit (repère volumique)
      lines.push(`0\nLINE\n8\nGABARIT\n10\n${gx1.toFixed(3)}\n20\n${gy1.toFixed(3)}\n11\n${gx2.toFixed(3)}\n21\n${gy2.toFixed(3)}`);
      lines.push(`0\nLINE\n8\nGABARIT\n10\n${gx2.toFixed(3)}\n20\n${gy1.toFixed(3)}\n11\n${gx1.toFixed(3)}\n21\n${gy2.toFixed(3)}`);
    }

    // REPÈRE GPS — croix au centroïde
    if (terrain.lat && terrain.lng) {
      const cr = 1.5; // taille croix en m
      lines.push(`0\nLINE\n8\nREPERES_GPS\n10\n${(cx-cr).toFixed(3)}\n20\n${cy.toFixed(3)}\n11\n${(cx+cr).toFixed(3)}\n21\n${cy.toFixed(3)}`);
      lines.push(`0\nLINE\n8\nREPERES_GPS\n10\n${cx.toFixed(3)}\n20\n${(cy-cr).toFixed(3)}\n11\n${cx.toFixed(3)}\n21\n${(cy+cr).toFixed(3)}`);
      lines.push(`0\nCIRCLE\n8\nREPERES_GPS\n10\n${cx.toFixed(3)}\n20\n${cy.toFixed(3)}\n40\n0.5`);
    }

    // COTES — dimensions parcelle
    const largeur = xmax - xmin;
    const hauteur = ymax - ymin;
    this._addDimension(lines, xmin, ymin - 4, xmax, ymin - 4, xmin, ymin, xmax, ymin, largeur);
    this._addDimension(lines, xmax + 4, ymin, xmax + 4, ymax, xmax, ymin, xmax, ymax, hauteur);

    // ANNOTATIONS
    const texts = [
      [cx, ymax + 3, 1.5, `PARCELLE ${ref} — ${commune}`],
      [cx, ymax + 1.5, 1.0, `Contenance : ${contenance} m²`],
      [xmin, ymin - 7, 0.8, `TERLAB v2 · ${now}`],
    ];
    if (rv > 0) texts.push([cx, ymin + rv/2, 0.7, `Recul voie = ${rv}m`]);
    if (rs > 0) texts.push([xmin + rs/2, cy, 0.7, `Sep = ${rs}m`]);
    if (hmax > 0) texts.push([cx + 2, cy + 2, 0.7, `Hmax = ${hmax}m`]);
    if (gl > 0)   texts.push([cx, cy, 0.8, `Gabarit ${gl}×${gw}m H=${gh}m`]);

    for (const [x, y, h, txt] of texts) {
      lines.push(`0\nTEXT\n8\nANNOTATIONS\n10\n${x.toFixed(3)}\n20\n${y.toFixed(3)}\n30\n0.0\n40\n${h}\n1\n${txt}\n72\n1`);
    }

    lines.push('0\nENDSEC\n0\nEOF');
    return lines.join('\n');
  },

  // ─── GEOJSON → COORDONNÉES LOCALES (mètres) ──────────────────
  _geojsonToLocal(geom, terrain) {
    const rings = geom.type === 'Polygon' ? geom.coordinates : [[{ lng: parseFloat(terrain.lng), lat: parseFloat(terrain.lat) }]];
    const ring  = rings[0];
    const cLng  = parseFloat(terrain.lng ?? ring[0][0]);
    const cLat  = parseFloat(terrain.lat ?? ring[0][1]);
    const kLng  = 111320 * Math.cos(cLat * Math.PI / 180);
    const kLat  = 111000;

    return ring.map(coord => {
      const lng = Array.isArray(coord) ? coord[0] : coord.lon;
      const lat = Array.isArray(coord) ? coord[1] : coord.lat;
      return [(lng - cLng) * kLng, (lat - cLat) * kLat];
    });
  },

  // ─── APPROXIMATION si géométrie réelle absente ────────────────
  _approximateParcel(terrain) {
    const contenance = parseFloat(terrain.contenance_m2 ?? 400);
    const side = Math.sqrt(contenance);
    return [[0,0],[side,0],[side,side],[0,side],[0,0]];
  },

  // ─── COTATION DXF ─────────────────────────────────────────────
  _addDimension(lines, x1, y1, x2, y2, defx1, defy1, defx2, defy2, value) {
    lines.push(`0\nDIMENSION\n8\nCOTATIONS`);
    lines.push(`10\n${((x1+x2)/2).toFixed(3)}\n20\n${((y1+y2)/2).toFixed(3)}\n30\n0`);
    lines.push(`13\n${defx1.toFixed(3)}\n23\n${defy1.toFixed(3)}\n33\n0`);
    lines.push(`14\n${defx2.toFixed(3)}\n24\n${defy2.toFixed(3)}\n34\n0`);
    lines.push(`70\n33\n1\n${value.toFixed(2)}m`);
  },

  // ─── TÉLÉCHARGEMENT ──────────────────────────────────────────
  download(dxfString, terrain, suffix = '') {
    const commune  = terrain.commune ?? 'terrain';
    const ref      = `${terrain.section ?? ''}${terrain.parcelle ?? ''}`;
    const tail     = suffix ? `_${suffix}` : '';
    const filename = `TERLAB_${commune}_${ref}${tail}.dxf`
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-zA-Z0-9_.-]/g,'_');
    const blob     = new Blob([dxfString], { type: 'application/dxf' });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    return filename;
  },

  // ════════════════════════════════════════════════════════════════════
  // SITE 3D — Export DXF R2000 (AC1015) depuis SiteScene
  // ════════════════════════════════════════════════════════════════════
  // Couches generees :
  //   TERRAIN          3DFACE par triangle DEM IGN
  //   PARCELLE_3D      POLYLINE 3D contour drape
  //   BATIMENTS_VOISIN 3DFACE parois + toiture extrudees BDTOPO
  //   ROUTES_DRAPEES   POLYLINE 3D centrale BDTOPO
  //   ROUTES_NOMS      TEXT noms de voies
  //   METADATA         TEXT bloc d'origine/CRS
  //
  // Coordonnees locales en metres (origine = centroide parcelle).
  // Cible : ArchiCAD 18+, AutoCAD, QGIS, FreeCAD.
  // ════════════════════════════════════════════════════════════════════
  generateSite3D(scene, opts = {}) {
    const {
      withBuildings = true,
      withRoads     = true,
    } = opts;
    if (!scene?.terrainMesh?.vertices?.length) {
      throw new Error('[DXFWorker] SiteScene invalide (terrainMesh manquant)');
    }

    const lines = [];
    const w = (...args) => { for (const a of args) lines.push(String(a)); };

    // ── HEADER ─────────────────────────────────────────────────────
    w('0','SECTION','2','HEADER');
    w('9','$ACADVER','1','AC1015');     // R2000
    w('9','$INSUNITS','70','6');        // 6 = metres
    w('9','$AUNITS','70','0');
    w('9','$ANGBASE','50','0.0');
    const projName = `TERLAB-Site3D-${(scene.metadata.commune||'').replace(/[^A-Za-z0-9]/g,'_')}`
      + `-${(scene.metadata.parcelle||'').replace(/[^A-Za-z0-9]/g,'_')}`
      + `-EPSG2975-O${scene.origin.E.toFixed(0)}_${scene.origin.N.toFixed(0)}`;
    w('9','$PROJECTNAME','1', projName);
    w('0','ENDSEC');

    // ── TABLES ─────────────────────────────────────────────────────
    w('0','SECTION','2','TABLES');
    w('0','TABLE','2','LTYPE','70','2');
    w('0','LTYPE','2','CONTINUOUS','70','0','3','Solid line','72','65','73','0','40','0.0');
    w('0','LTYPE','2','DASHED','70','0','3','Dashed','72','65','73','2','40','0.75',
      '49','0.5','74','0','49','-0.25','74','0');
    w('0','ENDTAB');

    const layers3D = [
      ['TERRAIN',          3, 'CONTINUOUS'],
      ['PARCELLE_3D',      1, 'CONTINUOUS'],
      ['BATIMENTS_VOISIN', 5, 'CONTINUOUS'],
      ['ROUTES_DRAPEES',   7, 'CONTINUOUS'],
      ['ROUTES_NOMS',      6, 'CONTINUOUS'],
      ['METADATA',         8, 'DASHED'],
    ];
    w('0','TABLE','2','LAYER','70', String(layers3D.length));
    for (const [name, color, ltype] of layers3D) {
      w('0','LAYER','2', name, '70','0','62', String(color), '6', ltype);
    }
    w('0','ENDTAB');

    w('0','TABLE','2','STYLE','70','1');
    w('0','STYLE','2','Standard','70','0','40','0.0','41','1.0','50','0.0','71','0',
      '42','2.5','3','arial.shx','4','');
    w('0','ENDTAB');

    w('0','ENDSEC');

    // ── ENTITIES ───────────────────────────────────────────────────
    w('0','SECTION','2','ENTITIES');

    // Terrain : 3DFACE par triangle
    const verts = scene.terrainMesh.vertices;
    const tris  = scene.terrainMesh.triangles;
    for (const [a, b, c] of tris) {
      const va = verts[a], vb = verts[b], vc = verts[c];
      if (!va || !vb || !vc) continue;
      this._3DFace(w, 'TERRAIN', va, vb, vc, vc);
    }

    // Parcelle : polyligne 3D fermee
    if (scene.parcelGeom?.ring3d?.length >= 3) {
      this._polyline3D(w, 'PARCELLE_3D', scene.parcelGeom.ring3d, true);
    }

    // Batiments : parois + toiture
    if (withBuildings && Array.isArray(scene.buildings)) {
      for (const bat of scene.buildings) {
        this._buildingExtrude(w, 'BATIMENTS_VOISIN', bat);
      }
    }

    // Routes : polyligne 3D centrale + label TEXT au milieu si nom
    if (withRoads && Array.isArray(scene.roads)) {
      for (const road of scene.roads) {
        if (!road.vertices3d || road.vertices3d.length < 2) continue;
        this._polyline3D(w, 'ROUTES_DRAPEES', road.vertices3d, false);
        if (road.nom) {
          const mid = road.vertices3d[Math.floor(road.vertices3d.length / 2)];
          this._text(w, 'ROUTES_NOMS', mid, road.nom, 1.5);
        }
      }
    }

    // Bloc metadata en bas-gauche
    this._writeSiteMetadata(w, scene);

    w('0','ENDSEC');
    w('0','EOF');
    return lines.join('\n');
  },

  // ─── HELPERS DXF 3D ──────────────────────────────────────────────
  _3DFace(w, layer, p1, p2, p3, p4) {
    w('0','3DFACE');
    w('8', layer);
    w('10', p1.x.toFixed(4), '20', p1.y.toFixed(4), '30', p1.z.toFixed(4));
    w('11', p2.x.toFixed(4), '21', p2.y.toFixed(4), '31', p2.z.toFixed(4));
    w('12', p3.x.toFixed(4), '22', p3.y.toFixed(4), '32', p3.z.toFixed(4));
    w('13', p4.x.toFixed(4), '23', p4.y.toFixed(4), '33', p4.z.toFixed(4));
    w('70', '0');
  },

  // POLYLINE 3D format ancien (compatible R2000) — flag 8 (3D), 9 (3D fermee)
  _polyline3D(w, layer, pts, closed) {
    w('0','POLYLINE');
    w('8', layer);
    w('66','1');
    w('70', closed ? '9' : '8');
    w('10','0.0','20','0.0','30','0.0');
    for (const p of pts) {
      w('0','VERTEX');
      w('8', layer);
      w('10', p.x.toFixed(4), '20', p.y.toFixed(4), '30', p.z.toFixed(4));
      w('70','32');
    }
    w('0','SEQEND');
    w('8', layer);
  },

  // Batiment extrude : parois 4 + toiture par ear-clipping (gere concaves Mo5)
  _buildingExtrude(w, layer, bat) {
    const fp = bat.footprint3d;
    if (!fp || fp.length < 4) return;
    const h = bat.height || 6;
    // Le ring est ferme (premier === dernier) → on parcourt n-1 aretes
    const n = fp.length - 1;
    if (n < 3) return;

    // Parois verticales (2 triangles par arete)
    for (let i = 0; i < n; i++) {
      const p0 = fp[i];
      const p1 = fp[i + 1];
      const p0t = { x: p0.x, y: p0.y, z: p0.z + h };
      const p1t = { x: p1.x, y: p1.y, z: p1.z + h };
      this._3DFace(w, layer, p0, p1, p1t, p0t);
    }

    // Toiture plane (Z = base + h, simplification raisonnable pour fond de plan)
    // Ear clipping 2D pour gerer les footprints concaves (L, U…)
    const ringTop = fp.slice(0, n).map(p => ({ x: p.x, y: p.y, z: p.z + h }));
    const earTris = this._earClip(ringTop);
    for (const [a, b, c] of earTris) {
      this._3DFace(w, layer, ringTop[a], ringTop[b], ringTop[c], ringTop[c]);
    }
  },

  // Ear clipping 2D simple (renvoie indices de triangles dans le polygone d'origine).
  // Hypothese : polygone simple sans trou. Robuste sur formes en L/U typiques BDTOPO.
  _earClip(pts) {
    const n = pts.length;
    if (n < 3) return [];
    if (n === 3) return [[0, 1, 2]];

    const idx = Array.from({ length: n }, (_, i) => i);
    const tris = [];
    const area2 = (a, b, c) =>
      (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

    // Determiner orientation (CCW ou CW)
    let orient = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      orient += (b.x - a.x) * (b.y + a.y);
    }
    const ccw = orient < 0;
    const isConvex = (a, b, c) => ccw ? area2(a, b, c) > 0 : area2(a, b, c) < 0;
    const inside = (p, a, b, c) => {
      const d1 = area2(p, a, b);
      const d2 = area2(p, b, c);
      const d3 = area2(p, c, a);
      const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
      const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
      return !(hasNeg && hasPos);
    };

    let guard = n * 3;
    while (idx.length > 3 && guard-- > 0) {
      let earFound = false;
      for (let k = 0; k < idx.length; k++) {
        const i0 = idx[(k - 1 + idx.length) % idx.length];
        const i1 = idx[k];
        const i2 = idx[(k + 1) % idx.length];
        const a = pts[i0], b = pts[i1], c = pts[i2];
        if (!isConvex(a, b, c)) continue;
        // Aucun autre point a l'interieur du triangle
        let ok = true;
        for (let m = 0; m < idx.length; m++) {
          const im = idx[m];
          if (im === i0 || im === i1 || im === i2) continue;
          if (inside(pts[im], a, b, c)) { ok = false; break; }
        }
        if (!ok) continue;
        tris.push([i0, i1, i2]);
        idx.splice(k, 1);
        earFound = true;
        break;
      }
      if (!earFound) break; // fallback : polygone degenere → on s'arrete
    }
    if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
    return tris;
  },

  _text(w, layer, pos, txt, height) {
    w('0','TEXT');
    w('8', layer);
    w('10', pos.x.toFixed(2), '20', pos.y.toFixed(2), '30', pos.z.toFixed(2));
    w('40', String(height));
    w('1', String(txt).replace(/\n/g, ' ').substring(0, 250));
    w('7', 'Standard');
  },

  _writeSiteMetadata(w, scene) {
    const m = scene.metadata;
    const ox = -(scene.bufferM * 0.92);
    const oy = -(scene.bufferM * 0.92);
    const zMin = scene.terrainMesh.vertices.reduce(
      (z, v) => Math.min(z, v.z), Infinity);
    const oz = (isFinite(zMin) ? zMin : 0) - 5;

    const txt = [
      `TERLAB Site 3D — ${m.commune} · Parcelle ${m.section}${m.parcelle}`,
      `Capture le ${new Date(m.capturedAt).toLocaleDateString('fr-FR')}`,
      `CRS: EPSG:2975 (UTM40S RGR92) — origine locale parcelle`,
      `Origine UTM40S: E=${scene.origin.E.toFixed(1)} N=${scene.origin.N.toFixed(1)}`,
      `Centroide WGS84: ${scene.lat.toFixed(6)}, ${scene.lng.toFixed(6)}`,
      `Alt origine: ${scene.origin.alt} m NGR`,
      `Buffer: ${scene.bufferM} m | Resolution DEM: ${scene.pixelSizeM} m${scene.decimated ? ' (decime)' : ''}`,
      `Source DEM: ${m.sources.dem}`,
      `Source batiments: ${m.sources.buildings}`,
      `Source routes: ${m.sources.roads}`,
      `${m.generator}`,
    ];
    txt.forEach((line, i) => {
      this._text(w, 'METADATA', { x: ox, y: oy - i * 3, z: oz }, line, 2.0);
    });
  },
};

export default DXFWorker;

// ════════════════════════════════════════════════════════════════════
