/**
 * GabaritThree — Scène 3D synchronisée avec GabaritSVG
 * TERLAB Phase 7 — ENSA La Réunion
 *
 * Volumes constructibles hé/hf, solution Pareto, annotations sprites,
 * périmètre parcelles, OrbitControls.
 */

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

  dispose() {
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
