// terlab/services/earthworks-mesh-builder.js
// Mesh builder Three.js pour visualisation terrassement (déblais/remblais).
// Consomme les résultats de EarthworksService et produit les BufferGeometries
// pour TN, plateforme, déblai (CSG), remblai (CSG), talus, pilotis.
//
// Convention scène Three.js (cohérente avec gabarit-3d.js loadCapacityStudy) :
//   X = est (polygon.x)
//   Z = south  (polygon.y, sans flip)  ← cohérent avec batMesh.position.set
//   Y = altitude (m NGR ou relative)
//
// CSG via three-bvh-csg (Brush + Evaluator).
//
// API:
//   const builder = new EarthworksMeshBuilder(THREE, csgLib);
//   const meshes = builder.buildAll(earthworksResult, { groundY=0 });
//   meshes = { tnMesh, platformMesh, cutMesh, fillMesh, talusGroup, pilotisGroup, V_cut_csg, V_fill_csg }

class EarthworksMeshBuilder {

  /**
   * @param {Object} THREE  Module THREE
   * @param {Object} csgLib { Brush, Evaluator, SUBTRACTION, ADDITION, INTERSECTION }
   */
  constructor(THREE, csgLib = null) {
    this.THREE = THREE;
    this.csg = csgLib;
    // Échelle Y pour cas où la scène a un facteur d'échelle vertical (héritage)
    this._yScale = 1.0;
  }

  /**
   * Pipeline complet : génère tous les meshes et le retour est un objet
   * prêt à être ajouté à un Three.Group.
   *
   * @param {Object} ew      Résultat EarthworksService.computeEarthworks()
   * @param {Object} opts    { groundY, useCSG=true, tnExtensionM=1.5 }
   */
  buildAll(ew, opts = {}) {
    const {
      groundY = 0,             // décalage Y global (Y=0 = bas de la scène)
      useCSG = true,           // false → squelette sans cut/fill volumetric
      tnExtensionM = 1.5,      // m d'extension du mesh TN au-delà de l'emprise
    } = opts;

    if (!ew || !ew.polygon || ew.polygon.length < 3) {
      return this._emptyResult();
    }

    const result = {
      tnMesh: null,
      platformMesh: null,
      cutMesh: null,
      fillMesh: null,
      talusGroup: null,
      pilotisGroup: null,
      V_cut_csg: 0,
      V_fill_csg: 0,
      groundY,
    };

    // 1. Mesh TN sous l'emprise (à partir des samples grid)
    if (ew.sampleGrid) {
      result.tnMesh = this.buildTNMesh(ew.sampleGrid, ew.H_platform_m, groundY);
    }

    // 2. Plateforme (extrudée depuis polygon)
    if (ew.strategy.type === 'A4') {
      // Pour les pilotis, la "plateforme" est la dalle sur poteaux
      result.platformMesh = this.buildPlatformMesh(
        ew.polygon, ew.H_platform_m + groundY, 0.25, 0x6b7280
      );
      result.pilotisGroup = this.buildPilotisGroup(ew.pilotisPosts, groundY);
    } else if (ew.strategy.type === 'A3' && ew.steps) {
      // Cascades : une plateforme par step
      result.platformMesh = this.buildCascadesGroup(ew.steps, groundY);
    } else {
      // A1 : plateforme unique
      result.platformMesh = this.buildPlatformMesh(
        ew.polygon, ew.H_platform_m + groundY, 0.25, 0x9ca3af
      );
    }

    // 3. Volumes cut/fill via CSG (uniquement si useCSG et A1)
    if (useCSG && this.csg && ew.strategy.type === 'A1' && result.tnMesh) {
      const csgResult = this.buildCutFillCSG(ew, groundY);
      result.cutMesh = csgResult.cutMesh;
      result.fillMesh = csgResult.fillMesh;
      result.V_cut_csg = csgResult.V_cut;
      result.V_fill_csg = csgResult.V_fill;
    }

    // 4. Talus (prismes par arête)
    if (ew.talusEdges?.length) {
      result.talusGroup = this.buildTalusGroup(ew.talusEdges, groundY);
    }

    return result;
  }

  // ══════════════════════════════════════════════════════════════════
  // 1. MESH TN
  // ══════════════════════════════════════════════════════════════════
  /**
   * Construit le mesh du terrain naturel sous l'emprise depuis la grille de
   * samples. Mesh régulier (rows × cols), couleurs per-vertex selon écart à H.
   */
  buildTNMesh(sampleGrid, H_platform, groundY = 0) {
    const THREE = this.THREE;
    const { data, cols, rows, x0, y0, step } = sampleGrid;

    const positions = new Float32Array(cols * rows * 3);
    const colors    = new Float32Array(cols * rows * 3);
    const indices   = new Uint32Array((cols - 1) * (rows - 1) * 6);

    // Étendue altitude pour color mapping
    let altMin = Infinity, altMax = -Infinity;
    for (let i = 0; i < data.length; i++) {
      const z = data[i];
      if (isFinite(z)) {
        if (z < altMin) altMin = z;
        if (z > altMax) altMax = z;
      }
    }
    if (!isFinite(altMin)) { altMin = 0; altMax = 0; }
    const altRange = Math.max(altMax - altMin, 0.1);

    // Vertices : (x, y_alt+groundY, z=polygon_y)  — pas de flip Z
    let p = 0, k = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = x0 + c * step;
        const y = y0 + r * step;       // = polygon.y → Three.z direct
        const alt = data[r * cols + c];
        positions[p++] = x;
        positions[p++] = (alt - altMin) + groundY; // référence locale au-dessus du sol scène
        positions[p++] = y;

        // Couleur : amont (au-dessus de plateforme = rouge) / aval (sous = bleu)
        const dh = alt - H_platform;
        if (dh > 0) {
          // Rouge plus saturé selon hauteur déblai
          const t = Math.min(1, dh / 2);
          colors[k++] = 0.7 + 0.3 * t;
          colors[k++] = 0.3 - 0.2 * t;
          colors[k++] = 0.25;
        } else {
          // Bleu pour zones à remblayer
          const t = Math.min(1, -dh / 2);
          colors[k++] = 0.3;
          colors[k++] = 0.45 - 0.1 * t;
          colors[k++] = 0.65 + 0.3 * t;
        }
      }
    }

    // Indices triangles
    let q = 0;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const d = (r + 1) * cols + c;
        const e = d + 1;
        indices[q++] = a; indices[q++] = d; indices[q++] = b;
        indices[q++] = b; indices[q++] = d; indices[q++] = e;
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = 'earthworks-tn';
    mesh.userData = { type: 'tn', altMin, altMax, H_platform };
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    return mesh;
  }

  // ══════════════════════════════════════════════════════════════════
  // 2. PLATEFORME
  // ══════════════════════════════════════════════════════════════════
  /**
   * Plateforme = dalle extrudée depuis le polygone à l'altitude Y_top.
   */
  buildPlatformMesh(polygon, Y_top, thickness = 0.25, color = 0x9ca3af) {
    const THREE = this.THREE;
    const shape = new THREE.Shape();
    shape.moveTo(polygon[0].x, polygon[0].y);
    for (let i = 1; i < polygon.length; i++) {
      shape.lineTo(polygon[i].x, polygon[i].y);
    }
    shape.closePath();

    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: false,
    });
    // ExtrudeGeometry extrude le long de +Z. On rotate -π/2 pour mettre en plan XZ
    geom.rotateX(-Math.PI / 2);
    // Après rotateX(-π/2): shape (x,y,0) → (x, 0, -y).
    // On veut polygon.y → +Three.z donc on inverse Z aussi
    geom.scale(1, 1, -1);

    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.1,
      transparent: true,
      opacity: 0.92,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = Y_top - thickness; // dessus de la dalle exactement à Y_top
    mesh.name = 'earthworks-platform';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  // ══════════════════════════════════════════════════════════════════
  // 3. CUT/FILL via CSG
  // ══════════════════════════════════════════════════════════════════
  /**
   * Construit les volumes déblai et remblai par opérations booléennes :
   *   cut  = volume entre TN et plateforme là où TN > H
   *   fill = volume entre plateforme et TN là où TN < H
   * Approche : extruder le polygone d'emprise sur une hauteur globale, puis
   * intersecter avec un mesh "TN solid" (TN extrudé vers le bas) et un mesh
   * "platform solid" (plateforme étendue vers le haut/bas), puis soustraire.
   *
   * Implémentation simplifiée : on construit deux Brushes :
   *   A = prism polygon × [tn_min, tn_max+marge]  (volume TN extrudé)
   *   B = prism polygon × [-marge, H_platform]    (volume platform "solide")
   * cut = A − B    (TN moins ce qui est sous la plateforme)
   * fill = B − A   (platform moins ce qui est sous le TN)
   *
   * NOTE : pour rester rapide, on utilise un mesh TN "lifté" via grille
   * triangulée — équivalent à un prism par cellule.
   */
  buildCutFillCSG(ew, groundY = 0) {
    const THREE = this.THREE;
    const { Brush, Evaluator, SUBTRACTION } = this.csg;

    const polygon = ew.polygon;
    const H = ew.H_platform_m;
    const grid = ew.sampleGrid;
    if (!grid) return { cutMesh: null, fillMesh: null, V_cut: 0, V_fill: 0 };

    // 1. Brush "TN solid" : prism par cellule (uniquement cellules dans polygon)
    //    On clip directement à l'emprise pour réduire le coût CSG.
    const tnGeom = this._buildTNSolidGeometry(grid, polygon, ew.tnMin_m - 1, groundY);

    // 2. Brush "platform solid" : prism polygon × [tnMin-1, H]
    const platGeom = this._buildExtrudedPolygonGeometry(
      polygon, ew.tnMin_m - 1 + groundY, H + groundY
    );

    if (!tnGeom || !platGeom) {
      return { cutMesh: null, fillMesh: null, V_cut: 0, V_fill: 0 };
    }

    const tnBrush = new Brush(tnGeom);
    tnBrush.updateMatrixWorld();
    const platBrush = new Brush(platGeom);
    platBrush.updateMatrixWorld();

    const evaluator = new Evaluator();
    evaluator.useGroups = false;

    let cutMesh = null, fillMesh = null;
    let V_cut = 0, V_fill = 0;

    try {
      const cutResult = evaluator.evaluate(tnBrush, platBrush, SUBTRACTION);
      const cutMat = new THREE.MeshStandardMaterial({
        color: 0xdc2626, transparent: true, opacity: 0.55,
        roughness: 0.85, side: THREE.DoubleSide,
      });
      cutMesh = new THREE.Mesh(cutResult.geometry, cutMat);
      cutMesh.name = 'earthworks-cut';
      V_cut = this._meshVolume(cutResult.geometry);
    } catch (err) {
      console.warn('[EarthworksMeshBuilder] CSG cut failed:', err.message);
    }

    try {
      const fillResult = evaluator.evaluate(platBrush, tnBrush, SUBTRACTION);
      const fillMat = new THREE.MeshStandardMaterial({
        color: 0x2563eb, transparent: true, opacity: 0.55,
        roughness: 0.85, side: THREE.DoubleSide,
      });
      fillMesh = new THREE.Mesh(fillResult.geometry, fillMat);
      fillMesh.name = 'earthworks-fill';
      V_fill = this._meshVolume(fillResult.geometry);
    } catch (err) {
      console.warn('[EarthworksMeshBuilder] CSG fill failed:', err.message);
    }

    return { cutMesh, fillMesh, V_cut, V_fill };
  }

  /**
   * Construit un prism par cellule de la grille TN, clippé à l'emprise.
   * Geometry = somme des prismes ; chaque cellule donne 2 triangles (dessus)
   * + 2 triangles (dessous plat) + 4 quads latéraux.
   * Pour réduire le coût, on n'inclut que les cellules dont le centre est
   * dans le polygone.
   */
  _buildTNSolidGeometry(grid, polygon, baseY, groundY = 0) {
    const THREE = this.THREE;
    const { data, cols, rows, x0, y0, step } = grid;

    // ── DÉCIMATION POUR PERF CSG ──────────────────────────────────
    // CSG sur 1000+ prismes est très lent. On vise ≤ 400 cellules pour
    // garder un temps d'évaluation < 1s sur la majorité des emprises.
    // Stride = facteur de saut entre cellules sources, step effectif = step×stride.
    const MAX_CELLS_CSG = 400;
    const totalCells = (cols - 1) * (rows - 1);
    const stride = Math.max(1, Math.ceil(Math.sqrt(totalCells / MAX_CELLS_CSG)));
    const stepEff = step * stride;
    if (stride > 1) {
      console.info(
        `[EarthworksMeshBuilder] CSG decimation : stride=${stride}, ` +
        `${totalCells} → ${Math.ceil(totalCells / (stride * stride))} cellules`
      );
    }

    const positions = [];
    const indices = [];
    let vertexCount = 0;

    // Helper : test point in polygon
    const inPoly = (px, py) => {
      let inside = false;
      const n = polygon.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      return inside;
    };

    // Pour chaque cellule (décimée), créer un prism rectangulaire vertical
    // base = baseY, top = altitude TN locale (interpolée par 4 coins de cellule)
    for (let r = 0; r < rows - stride; r += stride) {
      for (let c = 0; c < cols - stride; c += stride) {
        const cx = x0 + (c + stride / 2) * step;
        const cy = y0 + (r + stride / 2) * step;
        if (!inPoly(cx, cy)) continue;

        const z00 = data[r * cols + c];
        const z01 = data[r * cols + (c + stride)];
        const z10 = data[(r + stride) * cols + c];
        const z11 = data[(r + stride) * cols + (c + stride)];

        const x0c = x0 + c * step,            x1c = x0 + (c + stride) * step;
        const y0c = y0 + r * step,            y1c = y0 + (r + stride) * step;

        // 8 sommets du prism (4 base + 4 top)
        const v = [
          [x0c, baseY + groundY, y0c], // 0 base
          [x1c, baseY + groundY, y0c], // 1 base
          [x1c, baseY + groundY, y1c], // 2 base
          [x0c, baseY + groundY, y1c], // 3 base
          [x0c, z00 + groundY, y0c],   // 4 top
          [x1c, z01 + groundY, y0c],   // 5 top
          [x1c, z11 + groundY, y1c],   // 6 top
          [x0c, z10 + groundY, y1c],   // 7 top
        ];

        const i0 = vertexCount;
        for (const p of v) positions.push(...p);
        vertexCount += 8;

        // Faces (12 triangles, normales orientées vers l'extérieur)
        // base (Y-)
        indices.push(i0+0, i0+2, i0+1,  i0+0, i0+3, i0+2);
        // top (Y+)
        indices.push(i0+4, i0+5, i0+6,  i0+4, i0+6, i0+7);
        // -Z face (y=y0c)
        indices.push(i0+0, i0+1, i0+5,  i0+0, i0+5, i0+4);
        // +Z face (y=y1c)
        indices.push(i0+3, i0+7, i0+6,  i0+3, i0+6, i0+2);
        // -X face (x=x0c)
        indices.push(i0+0, i0+4, i0+7,  i0+0, i0+7, i0+3);
        // +X face (x=x1c)
        indices.push(i0+1, i0+2, i0+6,  i0+1, i0+6, i0+5);
      }
    }

    if (positions.length === 0) return null;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geom.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    geom.computeVertexNormals();
    return geom;
  }

  /**
   * Prism extrudé depuis polygon entre yBase et yTop.
   * Triangulation des faces top/base via THREE.ShapeUtils.triangulateShape
   * qui gère correctement les polygones concaves (L, U, T, parcelles
   * trapézoïdales avec coins perdus, etc.).
   */
  _buildExtrudedPolygonGeometry(polygon, yBase, yTop) {
    const THREE = this.THREE;
    const n = polygon.length;
    if (n < 3) return null;

    // 1. Trianguler le polygone en 2D via earcut/ShapeUtils
    //    Format attendu : [{x,y}] (le y devient l'axe horizontal "z" 3D)
    const contour2D = polygon.map(p => new THREE.Vector2(p.x, p.y));
    let triangles;
    try {
      triangles = THREE.ShapeUtils.triangulateShape(contour2D, []);
    } catch (err) {
      console.warn('[EarthworksMeshBuilder] triangulateShape failed, fallback fan:', err.message);
      triangles = [];
      for (let i = 1; i < n - 1; i++) triangles.push([0, i, i + 1]);
    }
    if (!triangles.length) return null;

    const positions = [];
    const indices = [];

    // Sommets base [0..n-1] puis top [n..2n-1]
    for (const p of polygon) positions.push(p.x, yBase, p.y);
    for (const p of polygon) positions.push(p.x, yTop, p.y);

    // Top : winding pour normale +Y
    for (const tri of triangles) {
      indices.push(n + tri[0], n + tri[2], n + tri[1]);
    }
    // Base : winding inversé pour normale -Y
    for (const tri of triangles) {
      indices.push(tri[0], tri[1], tri[2]);
    }
    // Faces latérales (quads → 2 triangles)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      indices.push(i, j, n + j,   i, n + j, n + i);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geom.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    geom.computeVertexNormals();
    return geom;
  }

  // ══════════════════════════════════════════════════════════════════
  // 4. TALUS
  // ══════════════════════════════════════════════════════════════════
  /**
   * Pour chaque arête, génère un quad incliné entre le bord plateforme et
   * la projection sur le TN à pente normalisée. Couleur jaune (déblai amont)
   * ou orange (remblai aval).
   */
  buildTalusGroup(talusEdges, groundY = 0) {
    const THREE = this.THREE;
    const group = new THREE.Group();
    group.name = 'earthworks-talus';

    for (const edge of talusEdges) {
      if (edge.kind === 'flat') continue;
      const t = edge.talus; // [{x,y,z},{x,y,z},{x,y,z},{x,y,z}]

      // Quad → 2 triangles (2x3 vertices)
      const positions = new Float32Array([
        t[0].x, t[0].z + groundY, t[0].y,
        t[1].x, t[1].z + groundY, t[1].y,
        t[2].x, t[2].z + groundY, t[2].y,
        t[0].x, t[0].z + groundY, t[0].y,
        t[2].x, t[2].z + groundY, t[2].y,
        t[3].x, t[3].z + groundY, t[3].y,
      ]);
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.computeVertexNormals();

      const color = edge.kind === 'cut' ? 0xfacc15 : 0xfb923c;
      const mat = new THREE.MeshStandardMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.65,
        roughness: 0.95,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.name = `talus-${edge.edgeIndex}-${edge.kind}`;
      mesh.userData = {
        kind: edge.kind,
        cutAmont: edge.cutAmont,
        fillAval: edge.fillAval,
        edgeIndex: edge.edgeIndex,
      };
      group.add(mesh);
    }
    return group;
  }

  // ══════════════════════════════════════════════════════════════════
  // 5. PILOTIS (A4)
  // ══════════════════════════════════════════════════════════════════
  buildPilotisGroup(pilotisPosts, groundY = 0) {
    const THREE = this.THREE;
    const group = new THREE.Group();
    group.name = 'earthworks-pilotis';

    const radius = 0.25;
    const matPost = new THREE.MeshStandardMaterial({
      color: 0x57534e, roughness: 0.7, metalness: 0.2,
    });

    for (const post of pilotisPosts) {
      const h = Math.max(0.1, post.h);
      const geom = new THREE.CylinderGeometry(radius, radius, h, 8);
      const mesh = new THREE.Mesh(geom, matPost);
      mesh.position.set(post.x, post.tn + h / 2 + groundY, post.y);
      mesh.castShadow = true;
      mesh.name = 'pilotis-post';
      group.add(mesh);

      // Petit cube semelle
      const baseGeom = new THREE.BoxGeometry(0.6, 0.15, 0.6);
      const base = new THREE.Mesh(baseGeom, matPost);
      base.position.set(post.x, post.tn + 0.075 + groundY, post.y);
      group.add(base);
    }
    return group;
  }

  // ══════════════════════════════════════════════════════════════════
  // 6. CASCADES (A3)
  // ══════════════════════════════════════════════════════════════════
  buildCascadesGroup(steps, groundY = 0) {
    const THREE = this.THREE;
    const group = new THREE.Group();
    group.name = 'earthworks-cascades';

    const colors = [0x9ca3af, 0xa1a1aa, 0xb1b5ba];

    steps.forEach((step, i) => {
      if (!step.bandPoly || step.bandPoly.length < 3) return;
      const mesh = this.buildPlatformMesh(
        step.bandPoly,
        step.H + groundY,
        0.25,
        colors[i % colors.length]
      );
      mesh.name = `cascade-${i}`;
      mesh.userData = { stepIndex: i, H: step.H, V_cut: step.V_cut_m3, V_fill: step.V_fill_m3 };
      group.add(mesh);
    });

    return group;
  }

  // ══════════════════════════════════════════════════════════════════
  // VOLUME D'UN MESH (vérification post-CSG)
  // ══════════════════════════════════════════════════════════════════
  /**
   * Calcule le volume d'un mesh fermé via somme des tétraèdres signés
   * formés avec l'origine. Robuste pour les meshes manifold issus de CSG.
   */
  _meshVolume(geometry) {
    const pos = geometry.attributes.position.array;
    const idx = geometry.index?.array;
    let v = 0;
    if (idx) {
      for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
        v += this._tetraVolume(
          pos[a], pos[a + 1], pos[a + 2],
          pos[b], pos[b + 1], pos[b + 2],
          pos[c], pos[c + 1], pos[c + 2],
        );
      }
    } else {
      for (let i = 0; i < pos.length; i += 9) {
        v += this._tetraVolume(
          pos[i], pos[i + 1], pos[i + 2],
          pos[i + 3], pos[i + 4], pos[i + 5],
          pos[i + 6], pos[i + 7], pos[i + 8],
        );
      }
    }
    return Math.abs(v);
  }

  _tetraVolume(x1, y1, z1, x2, y2, z2, x3, y3, z3) {
    return (
      x1 * (y2 * z3 - y3 * z2) +
      x2 * (y3 * z1 - y1 * z3) +
      x3 * (y1 * z2 - y2 * z1)
    ) / 6;
  }

  _emptyResult() {
    return {
      tnMesh: null, platformMesh: null, cutMesh: null, fillMesh: null,
      talusGroup: null, pilotisGroup: null,
      V_cut_csg: 0, V_fill_csg: 0, groundY: 0,
    };
  }
}

export { EarthworksMeshBuilder };
export default EarthworksMeshBuilder;

if (typeof window !== 'undefined') {
  window.EarthworksMeshBuilder = EarthworksMeshBuilder;
}
