p = r'C:\GITHUB\code-runner\tools\city\fjt-bh513.html'
s = open(p, encoding='utf-8').read()
L = s.split('\n')
i0 = next(i for i, l in enumerate(L) if l.strip().startswith('// toiture MONOPENTE'))
i1 = next(i for i, l in enumerate(L) if i > i0 and l.strip() == 'return { y0, g0, Htot };')
roof = r'''    // toiture MONOPENTE tôle peinte 10°, débords 0,8 m : point haut côté logements (−gs), égout côté coursive / jardin (+gs)
    const RW = DEPTH + 1.6, rise = Math.tan(10 * Math.PI / 180) * RW, yR = y0 + Htot + 0.25, tHi = -gs * RW / 2, tLo = gs * RW / 2, sE = L / 2 + 0.8;
    const tri3 = (pts, m) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3)); g.computeVertexNormals();
      const o = new THREE.Mesh(g, m); o.castShadow = o.receiveShadow = true; proj.add(o); };
    const W3 = (sv, t, y) => { const [x, z] = at(sv, t); return [x, y, z]; };
    const r1 = W3(-sE, tHi, yR + rise), r2 = W3(sE, tHi, yR + rise), r3 = W3(sE, tLo, yR), r4 = W3(-sE, tLo, yR);
    tri3([r1, r2, r3, r1, r3, r4], mat.roof);
    // pignons bardés : triangle rectangle, côté vertical au point haut
    for (const e of [-1, 1]) { const sv = e * (L / 2 + 0.02);
      tri3([W3(sv, tLo + (tHi - tLo) * 0.0, yR), W3(sv, tHi, yR), W3(sv, tHi, yR + rise)], mat.bardage); }'''
L = L[:i0] + roof.split('\n') + L[i1:]
s = '\n'.join(L)
# parking : enrobé limité aux allées + places (pas toute la poche)
a = s.index('    const Z = V.parkingLayout.zone, sh = new THREE.Shape(')
b = s.index("    const pmr = new THREE.MeshStandardMaterial({ color: 0x3f6fb5")
s = s[:a] + r'''    const flat = (poly, m, dy) => { const sh = new THREE.Shape(poly.map(q => new THREE.Vector2(q[0], -q[1]))); const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2);
      const pos = g.attributes.position; for (let i = 0; i < pos.count; i++) pos.setY(i, terrain.height(pos.getX(i), pos.getZ(i)) + dy); g.computeVertexNormals();
      const o = new THREE.Mesh(g, m); o.receiveShadow = true; proj.add(o); };
    for (const [x0, z0, x1, z1, w] of V.parkingLayout.aisles) { const l = Math.hypot(x1 - x0, z1 - z0), nx = -(z1 - z0) / l * w / 2, nz = (x1 - x0) / l * w / 2;
      flat([[x0 + nx, z0 + nz], [x1 + nx, z1 + nz], [x1 - nx, z1 - nz], [x0 - nx, z0 - nz]], mat.asph, 0.12); }
    for (const [ox, oz, ax, az, sx, sz, n, pitch, len] of V.parkingLayout.rows) {
      const a0 = [ox, oz], a1 = [ox + ax * n * pitch, oz + az * n * pitch];
      flat([a0, a1, [a1[0] + sx * len, a1[1] + sz * len], [a0[0] + sx * len, a0[1] + sz * len]], mat.asph, 0.12); }
''' + s[b:]
open(p, 'w', encoding='utf-8').write(s)
print('ok')
