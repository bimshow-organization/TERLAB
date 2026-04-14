/**
 * GabaritThree — Scène 3D synchronisée avec GabaritSVG
 * TERLAB Phase 7 — ENSA La Réunion
 *
 * Volumes constructibles hé/hf, solution Pareto, annotations sprites,
 * périmètre parcelles, OrbitControls.
 */

import RoofBuilder from '../services/roof-builder.js';
import FootprintAnalyzer from '../services/footprint-analyzer.js';

export class GabaritThree {
  constructor(canvasEl) {
    const THREE = window.THREE;
    if (!THREE) {
      console.warn('[GabaritThree] Three.js not loaded');
      return;
    }

    this.canvas = canvasEl;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1117);

    const w = canvasEl.clientWidth || canvasEl.width || 600;
    const h = canvasEl.clientHeight || canvasEl.height || 400;
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 2000);
    this.camera.position.set(0, 60, 80);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;

    // Lights
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(30, 60, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    this.scene.add(sun);
    this._sun = sun;

    // Ground grid
    this.scene.add(new THREE.GridHelper(200, 40, 0x334455, 0x223344));

    // Groups
    this.groups = {
      parcels: new THREE.Group(),
      non_constructible: new THREE.Group(),
      constructible: new THREE.Group(),
      solution: new THREE.Group(),
      permeable: new THREE.Group(),
      annotations: new THREE.Group(),
    };
    Object.values(this.groups).forEach(g => this.scene.add(g));

    this._initOrbitControls();
    this._animate();
    this._initResize();
  }

  update(parcelSet, constraints, solution = null) {
    if (!window.THREE) return;
    this._clearGroups();
    if (!constraints || !parcelSet.unionPolygon?.length) return;

    this._drawParcelOutline(parcelSet);
    this._drawNonConstructible(constraints.zones_non_constructibles);
    this._drawConstructibleVolume(constraints.emprise_constructible, constraints.volumes);
    if (solution) this._drawSolutionVolume(constraints.emprise_constructible, solution);
    this._drawPermeablePlane(parcelSet, constraints);
    this._drawAnnotations(constraints, parcelSet);
  }

  _drawParcelOutline(parcelSet) {
    const THREE = window.THREE;
    parcelSet.parcels.forEach(parcel => {
      const pts = parcel.polygon.map(p => new THREE.Vector3(p.x, 0.1, p.y));
      pts.push(pts[0].clone());
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
      this.groups.parcels.add(new THREE.Line(geo, mat));
    });
  }

  _drawNonConstructible(zones) {
    const THREE = window.THREE;
    zones.forEach(zone => {
      const shape = this._polyToShape(zone.polygon);
      if (!shape) return;
      const geo = new THREE.ShapeGeometry(shape);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xe74c3c, transparent: true, opacity: 0.12,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.05;
      this.groups.non_constructible.add(mesh);
    });
  }

  _drawConstructibleVolume(emprisePoly, volumes) {
    const THREE = window.THREE;
    if (!emprisePoly || emprisePoly.length < 3) return;

    const shape = this._polyToShape(emprisePoly);
    if (!shape) return;

    // Volume hf (faitage) — translucent
    const geoHF = new THREE.ExtrudeGeometry(shape, {
      depth: volumes.hf, bevelEnabled: false,
    });
    const matHF = new THREE.MeshPhongMaterial({
      color: 0x27ae60, transparent: true, opacity: 0.08,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const meshHF = new THREE.Mesh(geoHF, matHF);
    meshHF.rotation.x = -Math.PI / 2;
    this.groups.constructible.add(meshHF);

    // Wireframe he (egout)
    const geoHE = new THREE.ExtrudeGeometry(shape, {
      depth: volumes.he, bevelEnabled: false,
    });
    const edgesHE = new THREE.EdgesGeometry(geoHE);
    const wireHE = new THREE.LineSegments(edgesHE,
      new THREE.LineBasicMaterial({ color: 0x27ae60, opacity: 0.6, transparent: true }));
    wireHE.rotation.x = -Math.PI / 2;
    this.groups.constructible.add(wireHE);

    // Wireframe hf
    const edgesHF = new THREE.EdgesGeometry(geoHF);
    const wireHF = new THREE.LineSegments(edgesHF,
      new THREE.LineBasicMaterial({ color: 0x2ecc71, opacity: 0.4, transparent: true }));
    wireHF.rotation.x = -Math.PI / 2;
    this.groups.constructible.add(wireHF);
  }

  _drawSolutionVolume(emprisePoly, solution) {
    const THREE = window.THREE;
    if (!emprisePoly || emprisePoly.length < 3) return;

    const bb = this._bboxPoly(emprisePoly);
    const factor = Math.sqrt(solution.emprise_pct / 100);
    const w = (bb.maxX - bb.minX) * factor;
    const h = (bb.maxY - bb.minY) * factor;
    const cx = (bb.minX + bb.maxX) / 2;
    const cy = (bb.minY + bb.maxY) / 2;

    const colorInt = parseInt(solution.color.replace('#', ''), 16);

    const geo = new THREE.BoxGeometry(w, solution.hauteur_m, h);
    const mat = new THREE.MeshPhongMaterial({
      color: colorInt, transparent: true, opacity: 0.35,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, solution.hauteur_m / 2, cy);
    mesh.castShadow = true;
    this.groups.solution.add(mesh);

    // Wireframe
    const edges = new THREE.EdgesGeometry(geo);
    const wire = new THREE.LineSegments(edges,
      new THREE.LineBasicMaterial({ color: colorInt }));
    wire.position.copy(mesh.position);
    this.groups.solution.add(wire);

    // Floor levels
    for (let i = 1; i < solution.nb_niveaux; i++) {
      const y = i * 3.0;
      const planeGeo = new THREE.PlaneGeometry(w, h);
      const planeMat = new THREE.MeshBasicMaterial({
        color: colorInt, transparent: true, opacity: 0.08,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const plane = new THREE.Mesh(planeGeo, planeMat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(cx, y, cy);
      this.groups.solution.add(plane);
    }
  }

  _drawPermeablePlane(parcelSet, constraints) {
    const THREE = window.THREE;
    const shape = this._polyToShape(parcelSet.unionPolygon);
    if (!shape) return;
    const geo = new THREE.ShapeGeometry(shape);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x2ecc71, transparent: true, opacity: 0.06,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.02;
    this.groups.permeable.add(mesh);
  }

  _drawAnnotations(constraints, parcelSet) {
    const THREE = window.THREE;
    const { volumes, metrics } = constraints;
    const bb = this._bboxPoly(parcelSet.unionPolygon);
    const xLabel = bb.maxX + 3;

    // Vertical line he
    const ptsHE = [new THREE.Vector3(xLabel, 0, 0), new THREE.Vector3(xLabel, volumes.he, 0)];
    this.groups.annotations.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ptsHE),
      new THREE.LineBasicMaterial({ color: 0xf1c40f }),
    ));

    // Vertical line hf
    const ptsHF = [new THREE.Vector3(xLabel + 1, 0, 0), new THREE.Vector3(xLabel + 1, volumes.hf, 0)];
    this.groups.annotations.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ptsHF),
      new THREE.LineBasicMaterial({ color: 0xe67e22 }),
    ));

    // Sprites
    this._addSprite(`h\u00e9 = ${volumes.he}m`, { x: xLabel - 1, y: volumes.he + 1, z: 0 }, '#f1c40f');
    this._addSprite(`hf = ${volumes.hf}m`, { x: xLabel, y: volumes.hf + 1, z: 0 }, '#e67e22');
    this._addSprite(
      `${Math.round(metrics.surface_parcelle_m2)}m\u00b2 \u2014 Const. ${Math.round(metrics.surface_constructible_m2)}m\u00b2`,
      { x: (bb.minX + bb.maxX) / 2, y: -3, z: (bb.minY + bb.maxY) / 2 }, '#ffffff'
    );
  }

  _addSprite(text, pos, color = '#ffffff') {
    const THREE = window.THREE;
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 28px monospace';
    ctx.fillStyle = color;
    ctx.fillText(text, 8, 44);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(16, 2, 1);
    sprite.position.set(pos.x, pos.y, pos.z);
    this.groups.annotations.add(sprite);
  }

  // ──── Camera presets ────────────────────────────────────────────

  setView(mode) {
    if (!this.camera) return;
    switch (mode) {
      case 'top':
        this.camera.position.set(0, 80, 0.1);
        break;
      case 'front':
        this.camera.position.set(0, 10, 80);
        break;
      case 'orbit':
      default:
        this.camera.position.set(0, 60, 80);
        break;
    }
    this.camera.lookAt(0, 0, 0);
    if (this._orbitControls) this._orbitControls.target.set(0, 0, 0);
  }

  // ──── Helpers ───────────────────────────────────────────────────

  _polyToShape(polygon) {
    const THREE = window.THREE;
    if (!polygon || polygon.length < 3) return null;
    const shape = new THREE.Shape();
    polygon.forEach((p, i) => {
      if (i === 0) shape.moveTo(p.x, p.y);
      else shape.lineTo(p.x, p.y);
    });
    shape.closePath();
    return shape;
  }

  _bboxPoly(poly) {
    return {
      minX: Math.min(...poly.map(p => p.x)),
      maxX: Math.max(...poly.map(p => p.x)),
      minY: Math.min(...poly.map(p => p.y)),
      maxY: Math.max(...poly.map(p => p.y)),
    };
  }

  _clearGroups() {
    const THREE = window.THREE;
    Object.values(this.groups).forEach(g => {
      while (g.children.length) {
        const child = g.children[0];
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
        g.remove(child);
      }
    });
  }

  _initOrbitControls() {
    const THREE = window.THREE;
    // Minimal orbit controls inline (no CDN dependency)
    const canvas = this.canvas;
    const camera = this.camera;
    let isDown = false;
    let prevX = 0, prevY = 0;
    let theta = Math.PI / 4, phi = Math.PI / 3;
    let radius = 100;
    const target = new THREE.Vector3(0, 0, 0);

    const updateCamera = () => {
      camera.position.set(
        target.x + radius * Math.sin(phi) * Math.cos(theta),
        target.y + radius * Math.cos(phi),
        target.z + radius * Math.sin(phi) * Math.sin(theta),
      );
      camera.lookAt(target);
    };

    canvas.addEventListener('mousedown', e => {
      if (e.target.closest('[data-node-type]')) return;
      isDown = true;
      prevX = e.clientX;
      prevY = e.clientY;
    });

    canvas.addEventListener('mousemove', e => {
      if (!isDown) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      theta -= dx * 0.005;
      phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi - dy * 0.005));
      prevX = e.clientX;
      prevY = e.clientY;
      updateCamera();
    });

    canvas.addEventListener('mouseup', () => { isDown = false; });
    canvas.addEventListener('mouseleave', () => { isDown = false; });

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      radius *= e.deltaY > 0 ? 1.1 : 0.9;
      radius = Math.max(5, Math.min(500, radius));
      updateCamera();
    }, { passive: false });

    // Touch
    let prevTouchDist = 0;
    canvas.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        isDown = true;
        prevX = e.touches[0].clientX;
        prevY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        const [a, b] = [...e.touches];
        prevTouchDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 1 && isDown) {
        const dx = e.touches[0].clientX - prevX;
        const dy = e.touches[0].clientY - prevY;
        theta -= dx * 0.005;
        phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi - dy * 0.005));
        prevX = e.touches[0].clientX;
        prevY = e.touches[0].clientY;
        updateCamera();
      } else if (e.touches.length === 2) {
        const [a, b] = [...e.touches];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (prevTouchDist > 0) {
          radius *= prevTouchDist / dist;
          radius = Math.max(5, Math.min(500, radius));
          updateCamera();
        }
        prevTouchDist = dist;
      }
    }, { passive: false });

    canvas.addEventListener('touchend', () => { isDown = false; prevTouchDist = 0; });

    this._orbitControls = { target, update: updateCamera };
    updateCamera();
  }

  _animate() {
    if (!this.renderer) return;
    this.renderer.setAnimationLoop(() => {
      this.renderer.render(this.scene, this.camera);
    });
  }

  _initResize() {
    const ro = new ResizeObserver(() => {
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      if (w && h) {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h, false);
      }
    });
    ro.observe(this.canvas.parentElement ?? this.canvas);
  }

  // ── ETUDE DE CAPACITE 3D ──────────────────────────────────────
  /**
   * Charge une étude de capacité complète dans la scène 3D
   * @param {Object} proposal       — solution Pareto sélectionnée
   * @param {Object} session        — session TERLAB
   * @param {Array}  existingBldgs  — résultat ExistingBuildings.analyse()
   */
  /**
   * Charge une étude de capacité avec terrassement complet (déblais/remblais).
   * Pipeline :
   *   1. Échantillonner le TN sous l'emprise (LiDAR ou BIL)
   *   2. Choisir stratégie (A1/A3/A4) selon pente et zone PPR
   *   3. Calculer plateforme + V_cut/V_fill
   *   4. Générer meshes (TN, plateforme, cut/fill CSG, talus, pilotis)
   *   5. Poser le bâtiment sur la plateforme à H_platform + dalle
   *
   * @param {Object} proposal      { polygon, bat, niveaux, hauteur, color, ... }
   * @param {Object} session       Session TERLAB (terrain, _parcelLocal, _edgeTypes)
   * @param {Object} existingBldgs { footprints: [{poly,hauteur}, ...] }
   */
  async loadCapacityStudy(proposal, session, existingBldgs) {
    const THREE = window.THREE;
    if (!THREE) return;

    // Nettoyer les groupes
    for (const g of Object.values(this.groups)) {
      while (g.children.length) g.remove(g.children[0]);
    }
    if (this._earthworksGroup) {
      this.scene.remove(this._earthworksGroup);
      this._earthworksGroup = null;
    }
    if (this._existingGroup) {
      this.scene.remove(this._existingGroup);
      this._existingGroup = null;
    }

    // ── Récupérer la liste des blocs (footprints) ─────────────────
    // v2 : proposal.blocs[] = liste de bâtiments tournés / multi-blocs
    // v1 : proposal.polygon (single) ou proposal.bat (AABB)
    let blocsList = proposal?.blocs;
    if (!blocsList?.length) {
      // Fallback legacy : reconstruire 1 bloc depuis polygon ou bat
      let footprint = proposal?.polygon;
      if (!footprint || footprint.length < 3) {
        const bat = proposal?.bat;
        if (!bat) return;
        footprint = [
          { x: bat.x,         y: bat.y         },
          { x: bat.x + bat.w, y: bat.y         },
          { x: bat.x + bat.w, y: bat.y + bat.l },
          { x: bat.x,         y: bat.y + bat.l },
        ];
      }
      blocsList = [{ polygon: footprint, niveaux: proposal?.niveaux ?? 2 }];
    }
    // Footprint global pour les terrassements (union AABB)
    const footprint = (() => {
      let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
      for (const b of blocsList) {
        for (const p of (b.polygon ?? [])) {
          if (p.x < xMin) xMin = p.x;
          if (p.x > xMax) xMax = p.x;
          if (p.y < yMin) yMin = p.y;
          if (p.y > yMax) yMax = p.y;
        }
      }
      return [
        { x: xMin, y: yMin }, { x: xMax, y: yMin },
        { x: xMax, y: yMax }, { x: xMin, y: yMax },
      ];
    })();

    const nv = proposal?.niveaux ?? 2;
    const he = proposal?.hauteur ?? nv * 3;
    const color = proposal?.color ?? '#3B82F6';
    const terrain = session?.terrain ?? {};
    const parcelLocal = session?._parcelLocal ?? [];

    // ── EARTHWORKS : sample TN + stratégie + meshes ───────────────
    let earthworks = null;
    let groundY = 0;          // décalage Y de la scène (= -tnMin pour ramener à 0)
    let H_platform_local = 0; // altitude plateforme dans le repère scène

    const EWS = window.EarthworksService;
    if (EWS) {
      try {
        earthworks = await EWS.computeEarthworks(footprint, session, { gridStep: 0.5 });
        // Convention altitude unifiée TERLAB : Y=0 = TN min sous l'emprise
        // (cf. earthworks-service header doc + altitudeReference helper)
        groundY = earthworks.altitudeReference?.groundYRef ?? -(earthworks.tnMin_m ?? 0);
        H_platform_local = (earthworks.H_platform_m ?? 0) + groundY;
      } catch (err) {
        console.warn('[GabaritThree] Earthworks failed:', err.message);
      }
    }

    // Construire les meshes earthworks
    if (earthworks && window.EarthworksMeshBuilder) {
      try {
        // Tenter import dynamique de three-bvh-csg
        let csgLib = null;
        try {
          csgLib = await import('three-bvh-csg');
        } catch (e) {
          console.info('[GabaritThree] three-bvh-csg indisponible — cut/fill non volumétriques');
        }
        const builder = new window.EarthworksMeshBuilder(THREE, csgLib);
        const meshes = builder.buildAll(earthworks, { groundY, useCSG: !!csgLib });

        this._earthworksGroup = new THREE.Group();
        this._earthworksGroup.name = 'earthworks';
        this._earthworksMeshes = meshes;
        this._earthworksLayers = {
          tn: meshes.tnMesh,
          platform: meshes.platformMesh,
          cut: meshes.cutMesh,
          fill: meshes.fillMesh,
          talus: meshes.talusGroup,
          pilotis: meshes.pilotisGroup,
        };
        if (meshes.tnMesh)        this._earthworksGroup.add(meshes.tnMesh);
        if (meshes.platformMesh)  this._earthworksGroup.add(meshes.platformMesh);
        if (meshes.cutMesh)       this._earthworksGroup.add(meshes.cutMesh);
        if (meshes.fillMesh)      this._earthworksGroup.add(meshes.fillMesh);
        if (meshes.talusGroup)    this._earthworksGroup.add(meshes.talusGroup);
        if (meshes.pilotisGroup)  this._earthworksGroup.add(meshes.pilotisGroup);
        this.scene.add(this._earthworksGroup);

        // Notifier l'UI (panneau terrassement)
        window.dispatchEvent(new CustomEvent('terlab:earthworks-updated', {
          detail: { earthworks, V_cut_csg: meshes.V_cut_csg, V_fill_csg: meshes.V_fill_csg },
        }));
      } catch (err) {
        console.warn('[GabaritThree] Earthworks mesh build failed:', err);
      }
    }

    // ── Sol parcelle (sous le mesh TN, au niveau scène) ──────────
    if (parcelLocal.length >= 3) {
      const shape = new THREE.Shape();
      const first = parcelLocal[0];
      shape.moveTo(first.x ?? first[0], first.y ?? first[1]);
      for (let i = 1; i < parcelLocal.length; i++) {
        const p = parcelLocal[i];
        shape.lineTo(p.x ?? p[0], p.y ?? p[1]);
      }
      shape.closePath();
      const geom = new THREE.ShapeGeometry(shape);
      // Rotate to XZ plane and flip Z to align polygon.y → Three.z
      geom.rotateX(-Math.PI / 2);
      geom.scale(1, 1, -1);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xd4c9a8, side: THREE.DoubleSide,
        transparent: true, opacity: 0.35,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.receiveShadow = true;
      mesh.position.y = -0.05; // sous le mesh TN
      this.groups.parcels.add(mesh);
    }

    // ── Bâtiment(s) proposé(s) : extrusion par bloc ──────────────
    // Chaque bloc peut avoir sa propre hauteur (mais pour TERLAB v2 tous les blocs
    // d'une même proposal partagent niveaux/hauteur).
    const Y_base = H_platform_local + 0.25; // sur la dalle
    const batMat = new THREE.MeshPhongMaterial({
      color: new THREE.Color(color),
      transparent: true, opacity: 0.85,
    });
    const linesMat = new THREE.LineBasicMaterial({ color: 0x666666, opacity: 0.6, transparent: true });
    const wireMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(color), opacity: 0.7, transparent: true,
    });

    blocsList.forEach((bloc, bi) => {
      const polyB = bloc.polygon ?? [];
      if (polyB.length < 3) return;
      const blocNv = bloc.niveaux ?? nv;
      const blocHe = bloc.hauteur ?? blocNv * 3;

      const batShape = new THREE.Shape();
      batShape.moveTo(polyB[0].x, polyB[0].y);
      for (let i = 1; i < polyB.length; i++) {
        batShape.lineTo(polyB[i].x, polyB[i].y);
      }
      batShape.closePath();

      const batGeom = new THREE.ExtrudeGeometry(batShape, { depth: blocHe, bevelEnabled: false });
      batGeom.rotateX(-Math.PI / 2);
      batGeom.scale(1, 1, -1);

      const batMesh = new THREE.Mesh(batGeom, batMat);
      batMesh.position.y = Y_base;
      batMesh.castShadow = true;
      batMesh.receiveShadow = true;
      batMesh.name = `building-extruded-${bi}`;
      this.groups.solution.add(batMesh);

      // Wireframe
      const edges = new THREE.EdgesGeometry(batGeom);
      const wire = new THREE.LineSegments(edges, wireMat);
      wire.position.y = Y_base;
      this.groups.solution.add(wire);

      // Lignes de plancher
      for (let i = 1; i < blocNv; i++) {
        const y = Y_base + i * 3;
        const floorShape = batShape.clone();
        const floorGeom = new THREE.ShapeGeometry(floorShape);
        floorGeom.rotateX(-Math.PI / 2);
        floorGeom.scale(1, 1, -1);
        const floorEdges = new THREE.EdgesGeometry(floorGeom);
        const floorLine = new THREE.LineSegments(floorEdges, linesMat);
        floorLine.position.y = y;
        this.groups.solution.add(floorLine);
      }

      // ── Toiture LOD2 (RoofBuilder) ──
      // bloc.roofSpec = { type: 'flat'|'shed'|'gable'|'hip'|'pyramid', pentePct?, debord?, color? }
      // Si non defini : 'flat' par defaut (compat retro)
      const roofSpec = bloc.roofSpec ?? { type: 'flat' };
      if (roofSpec.type && roofSpec.type !== 'flat' && RoofBuilder && FootprintAnalyzer) {
        const obb = FootprintAnalyzer.fitOBB(polyB);
        if (obb) {
          // Sce <-> poly : poly.x = scene.x, poly.y = scene.z (apres rotateX + scale)
          const orientation = roofSpec.orientation
            ?? (obb.size.long >= obb.size.span ? 'EO' : 'EO'); // long axis aligne avec roof X
          const roof = RoofBuilder.buildRoof({
            type: roofSpec.type,
            W: obb.size.long,
            D: obb.size.span,
            pentePct: roofSpec.pentePct,
            debord: roofSpec.debord ?? 0.5,
            orientation,
            baseY: 0, // groupe positionne ensuite
            color: roofSpec.color,
          });
          // Position : centre OBB en scene + au sommet du bloc
          roof.position.set(obb.center.x, Y_base + blocHe, obb.center.y);
          // Aligner l'axe long du toit avec l'axe long de l'OBB
          roof.rotation.y = -obb.angle;
          roof.name = `building-roof-${bi}`;
          this.groups.solution.add(roof);
        }
      }
    });

    // ── Bâtiments existants (posés sur leur sol naturel) ──────────
    this._existingGroup = new THREE.Group();
    this._existingGroup.name = 'existing-buildings';
    if (existingBldgs?.footprints?.length) {
      for (const fp of existingBldgs.footprints) {
        if (!fp.poly?.length) continue;
        const shape = new THREE.Shape();
        shape.moveTo(fp.poly[0][0], fp.poly[0][1]);
        for (let i = 1; i < fp.poly.length; i++) shape.lineTo(fp.poly[i][0], fp.poly[i][1]);
        shape.closePath();
        const extGeom = new THREE.ExtrudeGeometry(shape, { depth: fp.hauteur ?? 6, bevelEnabled: false });
        extGeom.rotateX(-Math.PI / 2);
        extGeom.scale(1, 1, -1);
        const mat = new THREE.MeshPhongMaterial({
          color: 0x94A3B8, transparent: true, opacity: 0.5,
        });
        const mesh = new THREE.Mesh(extGeom, mat);
        // Sample altitude TN sous le centroïde du footprint existant
        let groundLocal = 0;
        if (earthworks) {
          const cx = fp.poly.reduce((s, p) => s + p[0], 0) / fp.poly.length;
          const cy = fp.poly.reduce((s, p) => s + p[1], 0) / fp.poly.length;
          // Approx : TN min de l'earthworks scaled (les bâtis existants sont hors emprise)
          groundLocal = groundY + (earthworks.tnMean_m ?? 0);
        }
        mesh.position.y = groundLocal;
        mesh.castShadow = true;
        this._existingGroup.add(mesh);
      }
    }
    this.scene.add(this._existingGroup);

    // ── Caméra auto centrée sur l'emprise + plateforme ─────────────
    const bbox = footprint.reduce(
      (b, p) => ({
        minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x),
        minY: Math.min(b.minY, p.y), maxY: Math.max(b.maxY, p.y),
      }),
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    );
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cz = (bbox.minY + bbox.maxY) / 2;
    const span = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) + he;
    this.camera.position.set(cx - span * 0.9, H_platform_local + he + span * 0.7, cz + span * 1.1);
    this.camera.lookAt(cx, H_platform_local + he / 2, cz);
  }

  /**
   * Toggle visibilité d'une couche earthworks ('tn'|'platform'|'cut'|'fill'|'talus'|'pilotis').
   */
  toggleEarthworksLayer(layer, visible) {
    const m = this._earthworksLayers?.[layer];
    if (m) m.visible = visible;
  }

  /**
   * Met à jour le mode d'affichage des bâtiments existants
   * @param {'demolition'|'conservation'|'extension'} mode
   */
  updateExistingMode(mode) {
    const THREE = window.THREE;
    if (!THREE || !this._existingGroup) return;

    const colors = {
      demolition:   { color: 0xEF4444, wireframe: true,  opacity: 0.5 },
      conservation: { color: 0x94A3B8, wireframe: false, opacity: 0.6 },
      extension:    { color: 0x3B82F6, wireframe: false, opacity: 0.4 },
    };

    const style = colors[mode] ?? colors.conservation;
    for (const mesh of this._existingGroup.children) {
      if (mesh.material) {
        mesh.material.color.setHex(style.color);
        mesh.material.wireframe = style.wireframe;
        mesh.material.opacity = style.opacity;
        mesh.material.needsUpdate = true;
      }
    }
  }

  // ── SILLAGE + PRESSION FACADES (Izard Microclimat Urbain 2) ──
  /**
   * Affiche la visualisation aéraulique sur le bâtiment :
   *  - Coloration Cp des 4 façades (rouge surpression, bleu dépression)
   *  - Zone de sillage semi-transparente derrière le bâtiment
   *  - Particules de vent animées
   * @param {number} windDirDeg  Direction du vent en degrés (0=N, 90=E)
   * @param {number} windSpeed   Vitesse ref m/s (optionnel, pour particules)
   */
  showWindViz(windDirDeg = 105, windSpeed = 4) {
    const THREE = window.THREE;
    const MU = window.TerlabMU;
    if (!THREE || !MU) return;

    this.clearWindViz();

    // Trouver le bâtiment solution dans la scène
    const solutionMeshes = this.groups.solution.children.filter(c => c.isMesh && !c.material?.wireframe);
    if (!solutionMeshes.length) return;

    const bldg = solutionMeshes[0];
    const bb = new THREE.Box3().setFromObject(bldg);
    const size = new THREE.Vector3();
    bb.getSize(size);
    const center = new THREE.Vector3();
    bb.getCenter(center);

    const W = size.x; // largeur
    const D = size.z; // profondeur
    const H = size.y; // hauteur
    const A = Math.max(W, D); // dimension caractéristique

    this._windGroup = new THREE.Group();
    this.scene.add(this._windGroup);

    const windRad = (windDirDeg - 90) * Math.PI / 180; // convertir en angle scène
    const windDirX = Math.cos(windRad);
    const windDirZ = Math.sin(windRad);

    // ── 1. Façades colorées par Cp ──────────────────────────────
    const faces = [
      { name: 'windward',  normal: [-windDirX, 0, -windDirZ] },
      { name: 'leeward',   normal: [windDirX, 0, windDirZ] },
      { name: 'side',      normal: [-windDirZ, 0, windDirX] },
      { name: 'side',      normal: [windDirZ, 0, -windDirX] },
    ];

    for (const face of faces) {
      const cp = MU.pressureCp(face.name, 0);
      const [r, g, b] = MU.cpToRGB(cp, [-2, 1]);

      // Créer un plan sur chaque façade
      const nx = face.normal[0], nz = face.normal[2];
      let pw, ph, px, py, pz, rotY;

      if (Math.abs(nx) > Math.abs(nz)) {
        // Façade parallèle à Z
        pw = D; ph = H;
        px = center.x + nx * (W / 2 + 0.1);
        py = center.y;
        pz = center.z;
        rotY = 0;
      } else {
        // Façade parallèle à X
        pw = W; ph = H;
        px = center.x;
        py = center.y;
        pz = center.z + nz * (D / 2 + 0.1);
        rotY = Math.PI / 2;
      }

      const geo = new THREE.PlaneGeometry(pw, ph);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(r, g, b),
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const plane = new THREE.Mesh(geo, mat);
      plane.position.set(px, py, pz);
      plane.rotation.y = rotY;
      // Orienter la face vers l'extérieur
      plane.lookAt(px + face.normal[0] * 10, py, pz + face.normal[2] * 10);
      this._windGroup.add(plane);
    }

    // ── 2. Zone de sillage (Izard — wakeLength) ─────────────────
    const wakeLen = MU.wakeLength(A, 'flat');
    const wakeGeo = new THREE.BoxGeometry(W * 0.9, H * 0.6, wakeLen);
    const wakeMat = new THREE.MeshBasicMaterial({
      color: 0x4a9fd4, transparent: true, opacity: 0.06,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const wakeMesh = new THREE.Mesh(wakeGeo, wakeMat);
    wakeMesh.position.set(
      center.x + windDirX * (D / 2 + wakeLen / 2),
      center.y * 0.6,
      center.z + windDirZ * (D / 2 + wakeLen / 2),
    );
    this._windGroup.add(wakeMesh);

    // Contour sillage
    const wakeEdges = new THREE.EdgesGeometry(wakeGeo);
    const wakeWire = new THREE.LineSegments(wakeEdges,
      new THREE.LineBasicMaterial({ color: 0x4a9fd4, opacity: 0.3, transparent: true }));
    wakeWire.position.copy(wakeMesh.position);
    this._windGroup.add(wakeWire);

    // Label sillage
    this._addWindSprite(`Sillage ${wakeLen.toFixed(0)}m`, {
      x: wakeMesh.position.x,
      y: H * 0.8,
      z: wakeMesh.position.z,
    }, '#4a9fd4');

    // ── 3. Particules vent animées ──────────────────────────────
    if (MU.threeWindParticles) {
      const bounds = [
        center.x - A * 2, center.x + A * 2,
        0, H * 1.5,
        center.z - A * 2, center.z + A * 2,
      ];
      const particles = MU.threeWindParticles(300, bounds, 0x4a9fd4);
      this._windGroup.add(particles.mesh);
      this._windParticles = particles;
      this._windDir = { x: windDirX * windSpeed, z: windDirZ * windSpeed };
    }

    // Modifier la boucle d'animation pour mettre à jour les particules
    if (this._windParticles) {
      const origLoop = this.renderer.info.autoReset;
      this.renderer.setAnimationLoop(() => {
        if (this._windParticles) {
          this._windParticles.update(0.016, (pos) => ({
            x: this._windDir.x,
            y: 0,
            z: this._windDir.z,
          }));
        }
        this.renderer.render(this.scene, this.camera);
      });
    }
  }

  clearWindViz() {
    if (this._windGroup) {
      this.scene.remove(this._windGroup);
      this._windGroup.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) {
          if (c.material.map) c.material.map.dispose();
          c.material.dispose();
        }
      });
      this._windGroup = null;
    }
    this._windParticles = null;
    this._windDir = null;
  }

  _addWindSprite(text, pos, color) {
    const THREE = window.THREE;
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = color;
    ctx.fillText(text, 4, 22);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(12, 1.5, 1);
    sprite.position.set(pos.x, pos.y, pos.z);
    this._windGroup.add(sprite);
  }

  dispose() {
    this.clearWindViz();
    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      this.renderer.dispose();
    }
  }
}

if (typeof window !== 'undefined') {
  window.GabaritThree = GabaritThree;
}

export default GabaritThree;
