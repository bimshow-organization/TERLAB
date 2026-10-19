p = r'C:\GITHUB\code-runner\tools\city\fjt-bh513.html'
L = open(p, encoding='utf-8').read().split('\n')
i0 = next(i for i, l in enumerate(L) if l.strip().startswith('// toiture tôle 2 pans'))
i1 = next(i for i, l in enumerate(L) if i > i0 and l.strip() == 'return { y0, g0, Htot };')
roof = r'''    // toiture MONOPENTE tôle peinte 10°, débords 0,8 m : point haut côté logements (façade extérieure), égout côté coursive / jardin (noue)
    const RW = DEPTH + 1.6, pitch = 10 * Math.PI / 180, rise = Math.tan(pitch) * RW, yR = y0 + Htot + 0.25;
    { const pl = new THREE.Mesh(new THREE.PlaneGeometry(L + 1.6, RW / Math.cos(pitch)), mat.roof);
      const [px, pz] = at(0, 0); pl.position.set(px, yR + rise / 2, pz);
      // la normale du plan est inclinée vers le côté coursive (+gs sur t) : le haut est côté logements (−gs)
      pl.rotation.order = 'YXZ'; pl.rotation.y = rot; pl.rotation.x = -Math.PI / 2 - gs * pitch; pl.castShadow = pl.receiveShadow = true; proj.add(pl); }
    // pignons : triangles rectangles bardés (haut côté logements)
    [-1, 1].forEach(e => { const hx = -gs * RW / 2;   // abscisse (t) du point haut dans le repère du pignon
      const tri = new THREE.Shape([new THREE.Vector2(-RW / 2, 0), new THREE.Vector2(RW / 2, 0), new THREE.Vector2(hx, rise)]);
      const g = new THREE.ShapeGeometry(tri); const m = new THREE.Mesh(g, mat.bardage); const [px, pz] = at(e * (L / 2 + 0.05), 0);
      m.position.set(px, yR - 0.02, pz); m.rotation.y = rot - Math.PI / 2; m.material.side = THREE.DoubleSide; proj.add(m); });'''
L = L[:i0] + roof.split('\n') + L[i1:]
s = '\n'.join(L)
# parking : rangées du générateur (parking-layout.mjs)
a = s.index('  // parking : enrobé + marquage'); b = s.index('  // arbres de projet : jardin entre les lames')
park = r'''  // parking : rangées du générateur code-runner (tools/city/parking-layout.mjs, NF P 91-100) — enrobé sur la poche, places, PMR bleue
  if (V && V.parkingLayout) {
    const Z = V.parkingLayout.zone, sh = new THREE.Shape(Z.map(q => new THREE.Vector2(q[0], -q[1])));
    const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position; for (let i = 0; i < pos.count; i++) pos.setY(i, terrain.height(pos.getX(i), pos.getZ(i)) + 0.12);
    g.computeVertexNormals(); const m = new THREE.Mesh(g, mat.asph); m.receiveShadow = true; proj.add(m);
    const pmr = new THREE.MeshStandardMaterial({ color: 0x3f6fb5, roughness: 0.8 });
    for (const [ox, oz, ax, az, sx, sz, n, pitch, len, typ] of V.parkingLayout.rows) {
      const rotS = -Math.atan2(sz, sx) + Math.PI / 2;
      for (let i = 0; i <= n; i++) { const x = ox + ax * i * pitch + sx * len / 2, z = oz + az * i * pitch + sz * len / 2; box(0.12, 0.02, len, mat.line, x, terrain.height(x, z) + 0.16, z, rotS); }
      if (typ === 3) for (let i = 0; i < n; i++) { const x = ox + ax * (i + 0.5) * pitch + sx * len / 2, z = oz + az * (i + 0.5) * pitch + sz * len / 2; box(pitch - 0.2, 0.02, len - 0.2, pmr, x, terrain.height(x, z) + 0.15, z, rotS); }
    }
  }
'''
s = s[:a] + park + s[b:]
# les arbres existants disparaissent aussi sur la poche de parking (déjà : tout le lot est dégagé)
open(p, 'w', encoding='utf-8').write(s)
print('ok')
