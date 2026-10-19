  const HN = 3.0, RAISE = 0.6, DU = 5.9, VAR = 1.2, GAL = 1.5, T1 = 3.4, T2 = 7.8, CORE = 4.0, DEPTH = DU + VAR + GAL;
  // bardage bois à lames verticales : texture rayée partagée, UV recalées à l'échelle (pas 0,18 m)
  const lamesTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 8; const g = c.getContext('2d');
    g.fillStyle = '#a8784a'; g.fillRect(0, 0, 64, 8); g.fillStyle = '#8a5f38'; g.fillRect(56, 0, 8, 8); g.fillStyle = '#b98a5c'; g.fillRect(0, 0, 20, 8);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t; })();
  mat.bardage = new THREE.MeshStandardMaterial({ map: lamesTex, roughness: 0.8 });
  mat.enduit = M(0xf3efe7); mat.varFond = M(0xe9e2d4); mat.frame = new THREE.MeshStandardMaterial({ color: 0x2f3437, roughness: 0.5, metalness: 0.4 });
  const boxUV = (w, h, d, m, x, y, z, rot, pas) => { const o = box(w, h, d, m, x, y, z, rot); if (pas) { const uv = o.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / pas, uv.getY(i) * h / 2); } return o; };
  const composer = window.SpeechBaies && window.SpeechBaies.composerBaies;
  // fenêtre verticale (≈ 1,05 × 1,53) composée par houseg-speech/engine/baies (rythme libre, largeur imposée, allège chambre)
  function baies(len, centres) {
    if (!composer) return centres.map(t => ({ a: t - 0.52, b: t + 0.52, yb: 0.95, yt: 2.48 }));
    return composer({ len, facade: 'ext' }, centres.map(t => ({ t, len: 1.4, room: 'ch1', largeur: 1.05 })), { rythme: 'libre', hMur: HN - 0.3, y0: 0 }).baies;
  }
  // séquence des logements d'un niveau (le long de la lame, depuis le noyau) — un T1 sur deux en miroir : varangues jumelées
  const seqDe = (name, k) => { const A = name.endsWith('A');
    if (k === 1) return A ? [] : ['T1', 'T2', 'T1'];                  // RDC : A = communs ; B = 2 T1 + 1 T2 PMR (+ atelier)
    return A ? ['T1', 'T1', 'T1', 'T1', 'T2', 'T1', 'T1', 'T1', 'T2', 'T1', 'T1'] : ['T1', 'T1', 'T1', 'T2', 'T1', 'T1', 'T1', 'T1']; };
  function block(b, i) {
    const p = b.poly.slice(0, 4), cx = p.reduce((s, q) => s + q[0], 0) / 4, cz = p.reduce((s, q) => s + q[1], 0) / 4;
    const a = b.az * Math.PI / 180, ux = Math.sin(a), uz = -Math.cos(a), nx = -uz, nz = ux;
    const gs = b.gallery === 'S' ? 1 : -1, rot = -Math.atan2(uz, ux);
    let g0 = Infinity; for (let s = -0.5; s <= 0.5; s += 0.1) for (let t = -0.5; t <= 0.5; t += 0.25) g0 = Math.min(g0, terrain.height(cx + ux * s * b.len + nx * t * DEPTH, cz + uz * s * b.len + nz * t * DEPTH));
    const y0 = g0 + RAISE, L = b.len, NL = b.nlev, Htot = NL * HN;
    const at = (s, t) => [cx + ux * s + nx * t, cz + uz * s + nz * t];
    // t : 0 = axe de la lame ; côté extérieur (logements) = −gs, côté coursive = +gs
    const tOut = -gs * DEPTH / 2, tVarIn = tOut + gs * VAR, tGalIn = gs * (DEPTH / 2 - GAL), tGalOut = gs * DEPTH / 2;
    const mid = (t0, t1) => (t0 + t1) / 2;
    let x, z;
    // socle
    [x, z] = at(0, 0); box(L + 0.6, RAISE + 0.2, DEPTH + 0.6, mat.base, x, g0 + (RAISE + 0.2) / 2 - 0.1, z, rot);
    // corps (logements, sans la bande des varangues)
    [x, z] = at(CORE / 2, mid(tVarIn, tGalIn)); box(L - CORE, Htot, DU, mat.enduit, x, y0 + Htot / 2, z, rot);
    // noyau escalier + ascenseur : bardé
    [x, z] = at(-L / 2 + CORE / 2, 0); boxUV(CORE, Htot + 1.2, DEPTH + 0.4, mat.bardage, x, y0 + (Htot + 1.2) / 2, z, rot, 0.18);
    // niveaux
    for (let k = 1; k <= NL; k++) {
      const yk = y0 + (k - 1) * HN, seq = seqDe(b.name, k);
      // dalle + nez de dalle filant côté extérieur (lit la strate)
      [x, z] = at(CORE / 2, mid(tOut, tVarIn)); box(L - CORE, 0.25, VAR + 0.1, mat.slab, x, yk + HN - 0.12, z, rot);
      if (!seq.length) { // RDC communs : bande de varangue devenue galerie vitrée
        [x, z] = at(CORE / 2, tVarIn - gs * 0.02); box(L - CORE - 0.4, 2.4, 0.08, mat.glass, x, yk + 1.3, z, rot);
        for (let s = -L / 2 + CORE + 0.2; s <= L / 2; s += 3.4) { [x, z] = at(s, tOut + gs * 0.12); box(0.22, HN, 0.22, mat.frame, x, yk + HN / 2, z, rot); }
        continue;
      }
      let s = -L / 2 + CORE, flip = false;
      for (const ty of seq) {
        const w = ty === 'T1' ? T1 : T2, s0 = s, s1 = s + w;
        // découpage du module : [varangue | mur bardé] (miroir un sur deux → varangues jumelées)
        let varA, varB, fen;
        if (ty === 'T2') { varA = s0 + 2.4; varB = s1 - 2.4; fen = [s0 + 1.2, s1 - 1.2]; }
        else { const vw = 1.9; if (!flip) { varA = s0; varB = s0 + vw; } else { varA = s1 - vw; varB = s1; } fen = [!flip ? (varB + s1) / 2 : (s0 + varA) / 2]; flip = !flip; }
        const pleins = ty === 'T2' ? [[s0, varA], [varB, s1]] : (varA === s0 ? [[varB, s1]] : [[s0, varA]]);
        for (const [m0, m1] of pleins) {
          const wl = m1 - m0; if (wl < 0.1) continue;
          const bs = baies(wl, fen.filter(t => t > m0 && t < m1).map(t => t - m0));
          const holes = bs.map(q => [q.a, q.b, q.yb, q.yt]);
          const yb = holes.length ? holes[0][2] : 0, yt = holes.length ? holes[0][3] : 0;
          // bardage autour des baies : allège, linteau, trumeaux
          [x, z] = at(mid(m0, m1), mid(tOut, tVarIn));
          if (yb > 0.02) boxUV(wl, yb, VAR, mat.bardage, x, yk + yb / 2, z, rot, 0.18);
          boxUV(wl, HN - 0.25 - yt, VAR, mat.bardage, x, yk + yt + (HN - 0.25 - yt) / 2, z, rot, 0.18);
          let c0 = 0;
          for (const [ha, hb] of holes.map(h => [h[0], h[1]]).concat([[wl, wl]])) {
            if (ha - c0 > 0.02) { [x, z] = at(m0 + (c0 + ha) / 2, mid(tOut, tVarIn)); boxUV(ha - c0, yt - yb, VAR, mat.bardage, x, yk + (yb + yt) / 2, z, rot, 0.18); }
            c0 = hb;
          }
          for (const [ha, hb, qb, qt] of holes) { // vitrage en retrait + appui sombre
            [x, z] = at(m0 + (ha + hb) / 2, tOut + gs * 0.35); box(hb - ha, qt - qb, 0.06, mat.glass, x, yk + (qb + qt) / 2, z, rot);
            [x, z] = at(m0 + (ha + hb) / 2, tOut + gs * 0.02); box(hb - ha + 0.08, 0.06, 0.12, mat.frame, x, yk + qb, z, rot);
          }
        }
        // varangue : fond enduit + porte-fenêtre + garde-corps bois à claire-voie
        [x, z] = at(mid(varA, varB), tVarIn + gs * 0.01); box(varB - varA, HN - 0.25, 0.05, mat.varFond, x, yk + (HN - 0.25) / 2, z, rot);
        [x, z] = at(mid(varA, varB), tVarIn - gs * 0.03); box(Math.min(1.6, varB - varA - 0.4), 2.2, 0.05, mat.glass, x, yk + 1.1, z, rot);
        [x, z] = at(mid(varA, varB), tOut + gs * 0.05); box(varB - varA, 0.08, 0.08, mat.frame, x, yk + 1.02, z, rot);
        for (let q = varA + 0.12; q < varB - 0.05; q += 0.16) { [x, z] = at(q, tOut + gs * 0.05); box(0.05, 1.0, 0.05, mat.wood, x, yk + 0.5, z, rot); }
        s = s1;
      }
    }
    // coursives : dalles, garde-corps, poteaux ; façade côté coursive : portes + impostes hautes (ventilation traversante)
    for (let k = 1; k <= NL; k++) {
      const yk = y0 + (k - 1) * HN;
      if (k > 1) { [x, z] = at(CORE / 2, mid(tGalIn, tGalOut)); box(L - CORE, 0.22, GAL, mat.slab, x, yk, z, rot);
        [x, z] = at(CORE / 2, tGalOut - gs * 0.03); box(L - CORE, 1.0, 0.05, mat.rail, x, yk + 0.6, z, rot); }
      for (let s = -L / 2 + CORE + T1 / 2; s < L / 2; s += T1) {
        [x, z] = at(s - 0.6, tGalIn + gs * 0.02); box(0.95, 2.15, 0.06, mat.wood, x, yk + 1.08, z, rot);
        [x, z] = at(s + 0.8, tGalIn + gs * 0.02); box(0.8, 0.55, 0.06, mat.glass, x, yk + 2.15, z, rot);
      }
    }
    [x, z] = at(CORE / 2, mid(tGalIn, tGalOut)); box(L - CORE, 0.22, GAL, mat.slab, x, y0 + Htot, z, rot);
    for (let s = -L / 2 + CORE; s <= L / 2 + 0.01; s += T1 * 2) { [x, z] = at(s, tGalOut - gs * 0.1); box(0.2, Htot, 0.2, mat.rail, x, y0 + Htot / 2, z, rot); }
    // toiture tôle 2 pans 12°, débords 0,8 m
    const RW = DEPTH + 1.6, pitch = 12 * Math.PI / 180, half = RW / 2, rise = Math.tan(pitch) * half, yR = y0 + Htot + 0.25;
    [-1, 1].forEach(sd => { const pl = new THREE.Mesh(new THREE.PlaneGeometry(L + 1.6, half / Math.cos(pitch)), mat.roof);
      const [px, pz] = at(0, sd * half / 2); pl.position.set(px, yR + rise / 2, pz);
      pl.rotation.order = 'YXZ'; pl.rotation.y = rot; pl.rotation.x = -Math.PI / 2 + sd * pitch; pl.castShadow = pl.receiveShadow = true; proj.add(pl); });
    return { y0, g0, Htot };
  }
