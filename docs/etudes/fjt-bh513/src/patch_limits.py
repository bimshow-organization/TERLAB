p = r'C:\GITHUB\code-runner\tools\city\fjt-bh513.html'
s = open(p, encoding='utf-8').read()
anchor = "  const info = V ? V.blocks.map(block) : [];"
add = anchor + r"""
  // ── limites : ruban drapé sur le terrain (assiette FJT orange, parcelle BH 513 blanc, lot SIDR pointillé bleu) ; ?lim=0 pour les rendus IA ──
  function ribbon(poly, w, color, dash, lift) {
    const pos = [], idx = []; let n = 0;
    const pts = poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1] ? poly : poly.concat([poly[0]]);
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], L = Math.hypot(x1 - x0, z1 - z0); if (L < 0.05) continue;
      const tx = (x1 - x0) / L, tz = (z1 - z0) / L, ox = -tz * w / 2, oz = tx * w / 2;
      for (let d = 0; d < L; d += dash ? dash * 2 : 1.0) {
        const d1 = Math.min(L, d + (dash || 1.0));
        const a = [x0 + tx * d, z0 + tz * d], b = [x0 + tx * d1, z0 + tz * d1];
        for (const [px, pz] of [[a[0] - ox, a[1] - oz], [a[0] + ox, a[1] + oz], [b[0] - ox, b[1] - oz], [b[0] + ox, b[1] + oz]]) pos.push(px, terrain.height(px, pz) + lift, pz);
        idx.push(n, n + 2, n + 1, n + 1, n + 2, n + 3); n += 4;
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false }));
    m.renderOrder = 5; proj.add(m); return m;
  }
  if (Q.get('lim') !== '0') {
    ribbon(P.parcel, 0.35, 0xffffff, 0, 0.3);
    ribbon(P.sidr, 0.35, 0x8fb3ff, 1.2, 0.32);
    ribbon(P.fjt, 0.9, 0xff8a1f, 0, 0.35);
  }"""
assert anchor in s
s = s.replace(anchor, add, 1)
open(p, 'w', encoding='utf-8').write(s)
print('ok')
