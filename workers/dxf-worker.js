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
  download(dxfString, terrain) {
    const commune  = terrain.commune ?? 'terrain';
    const ref      = `${terrain.section ?? ''}${terrain.parcelle ?? ''}`;
    const filename = `TERLAB_${commune}_${ref}.dxf`.replace(/[^a-zA-Z0-9_.-]/g,'_');
    const blob     = new Blob([dxfString], { type: 'application/dxf' });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    return filename;
  }
};

export default DXFWorker;

// ════════════════════════════════════════════════════════════════════
