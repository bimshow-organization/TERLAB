/**
 * TERLAB . cut-panel.js
 * Bottom panel SVG affichant la coupe transversale en live.
 *   - Sol = courbe noire pleine + remplissage brun
 *   - Batiments = rectangles gris translucides extrudes du sol au toit
 *   - Arbres = triangles verts a position + hauteur
 *   - Echelle X = distance metres (ticks tous les 10m)
 *   - Echelle Y = altitude metres (auto-fit)
 *
 * Largeur du panel = min(window.width - 32, distance_AB * 5 px/m)
 * pour eviter compression sur coupes courtes / scrollH sur longues.
 */


export function mountCutPanel({ container, height = 200 }) {
  const wrap = document.createElement('div');
  wrap.id = 'cut-panel';
  wrap.style.cssText = `
    position: fixed; bottom: 8px; left: 332px;
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 8px; padding: 8px 12px;
    box-shadow: 0 -4px 24px rgba(0,0,0,0.4);
    z-index: 11; display: none;
    max-width: calc(100vw - 348px);
    box-sizing: border-box;
  `;
  wrap.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;
                margin-bottom:6px; gap:12px;">
      <strong style="font-size:12px; color:var(--accent);">Coupe transversale</strong>
      <span class="cut-info" style="flex:1; font-size:11px; color:var(--muted);
                                     font-family:monospace;"></span>
      <button class="cut-close" title="Fermer la coupe"
        style="background:transparent; border:1px solid var(--border);
                border-radius:4px; color:var(--muted); cursor:pointer;
                font-size:14px; line-height:1; padding:2px 8px;">×</button>
    </div>
    <svg class="cut-svg" preserveAspectRatio="none"
         style="display:block; background:#0a0a0c; border-radius:4px;
                overflow:visible;">
    </svg>
  `;
  container.appendChild(wrap);

  const svg = wrap.querySelector('.cut-svg');
  const info = wrap.querySelector('.cut-info');
  const closeBtn = wrap.querySelector('.cut-close');

  let onCloseCallback = null;
  closeBtn.onclick = () => { hide(); onCloseCallback?.(); };

  function show(onClose) {
    onCloseCallback = onClose;
    wrap.style.display = 'block';
  }

  function hide() {
    wrap.style.display = 'none';
  }

  /**
   * Render le profil. profile = { totalLen, samples: [{dist, ground, build, tree}] }
   */
  function render(profile) {
    if (!profile || !profile.samples?.length || profile.totalLen < 0.5) {
      svg.innerHTML = '';
      info.textContent = 'Coupe < 0.5m';
      return;
    }
    const { totalLen, samples } = profile;
    // Largeur SVG : 5 px/m, plafonnee a la largeur viewport - panel left
    const targetW = Math.max(400, Math.min(window.innerWidth - 348,
                                              totalLen * 5));
    const svgW = Math.floor(targetW);
    const svgH = height - 60;  // -header -info -padding
    svg.setAttribute('width', svgW);
    svg.setAttribute('height', svgH);
    svg.style.width = svgW + 'px';
    svg.style.height = svgH + 'px';

    // Auto-fit Y range
    let yMin = Infinity, yMax = -Infinity;
    for (const s of samples) {
      yMin = Math.min(yMin, s.ground);
      yMax = Math.max(yMax, s.ground);
      if (s.build !== null) yMax = Math.max(yMax, s.build);
      if (s.tree !== null)  yMax = Math.max(yMax, s.tree);
    }
    yMin = Math.floor(yMin - 1);
    yMax = Math.ceil(yMax + 2);
    const yRange = Math.max(5, yMax - yMin);
    const padTop = 10, padBot = 18, padLR = 28;
    const plotW = svgW - padLR * 2;
    const plotH = svgH - padTop - padBot;

    function px(d) { return padLR + (d / totalLen) * plotW; }
    function py(y) { return padTop + plotH - ((y - yMin) / yRange) * plotH; }

    // 1) Ground polyline + fill brun
    let groundPath = '';
    for (let i = 0; i < samples.length; i++) {
      groundPath += (i === 0 ? 'M' : 'L')
                    + px(samples[i].dist).toFixed(1) + ','
                    + py(samples[i].ground).toFixed(1) + ' ';
    }
    const groundFillPath = groundPath
      + `L${px(totalLen).toFixed(1)},${py(yMin).toFixed(1)} `
      + `L${px(0).toFixed(1)},${py(yMin).toFixed(1)} Z`;

    // 2) Batiments : pour chaque sample avec build, dessiner barre verticale
    let buildBars = '';
    const sStep = totalLen / N(samples);
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (s.build === null) continue;
      const xL = px(s.dist - sStep / 2);
      const xR = px(s.dist + sStep / 2);
      const yT = py(s.build);
      const yB = py(s.ground);
      buildBars += `<rect x="${xL.toFixed(1)}" y="${yT.toFixed(1)}" `
                  + `width="${(xR - xL).toFixed(1)}" `
                  + `height="${(yB - yT).toFixed(1)}" `
                  + `fill="rgba(180,170,150,0.85)" stroke="rgba(80,70,60,0.6)" `
                  + `stroke-width="0.5" />`;
    }

    // 3) Arbres : triangles verts a leur position
    const treeMarks = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (s.tree === null) continue;
      // Eviter drawer 200 triangles : sample tous les 4
      if (i % 4 !== 0) continue;
      const xc = px(s.dist);
      const yt = py(s.tree);
      const yg = py(s.ground);
      treeMarks.push(`<polygon points="${xc},${yt} `
        + `${(xc - 4).toFixed(1)},${yg} ${(xc + 4).toFixed(1)},${yg}" `
        + `fill="rgba(63,122,77,0.85)" />`);
    }

    // 3.5) Splat points : nuage de points cyan dans la bande de coupe
    let splatDots = '';
    if (profile.splatPoints && profile.splatPoints.length >= 2) {
      const sp = profile.splatPoints;
      const dotR = 0.6;
      // Buffer pour sous-echantillonner si tres dense (>2000 points)
      const step = sp.length / 2 > 2000 ? Math.ceil(sp.length / 2 / 2000) : 1;
      let circles = '';
      for (let i = 0; i < sp.length; i += 2 * step) {
        const dist = sp[i];
        const yAlt = sp[i + 1];
        if (dist < 0 || dist > totalLen) continue;
        if (yAlt < yMin - 0.5 || yAlt > yMax + 0.5) continue;
        circles += `<circle cx="${px(dist).toFixed(1)}" `
                  + `cy="${py(yAlt).toFixed(1)}" r="${dotR}" `
                  + `fill="rgba(180,210,255,0.75)" />`;
      }
      splatDots = circles;
    }

    // 4) Echelle X : ticks tous les 10m, plus pour > 100m
    const tickStep = totalLen > 100 ? 25 : (totalLen > 30 ? 10 : 5);
    let xTicks = '';
    for (let d = 0; d <= totalLen + 0.001; d += tickStep) {
      const x = px(d);
      xTicks += `<line x1="${x.toFixed(1)}" y1="${(padTop + plotH).toFixed(1)}" `
              + `x2="${x.toFixed(1)}" y2="${(padTop + plotH + 3).toFixed(1)}" `
              + `stroke="#888" stroke-width="0.5" />`;
      xTicks += `<text x="${x.toFixed(1)}" y="${(padTop + plotH + 13).toFixed(1)}" `
              + `text-anchor="middle" font-family="sans-serif" `
              + `font-size="9" fill="#888">${d.toFixed(0)}m</text>`;
    }
    // 5) Echelle Y : 3-4 valeurs auto
    const yTickStep = yRange < 8 ? 1 : (yRange < 25 ? 5 : 10);
    let yTicks = '';
    for (let y = Math.ceil(yMin / yTickStep) * yTickStep;
         y <= yMax; y += yTickStep) {
      const yy = py(y);
      yTicks += `<line x1="${padLR}" y1="${yy.toFixed(1)}" `
              + `x2="${(svgW - padLR).toFixed(1)}" y2="${yy.toFixed(1)}" `
              + `stroke="rgba(120,120,120,0.15)" stroke-width="0.5" />`;
      yTicks += `<text x="${(padLR - 4).toFixed(1)}" y="${(yy + 3).toFixed(1)}" `
              + `text-anchor="end" font-family="sans-serif" `
              + `font-size="9" fill="#888">${y.toFixed(0)}</text>`;
    }

    svg.innerHTML = `
      ${yTicks}
      <path d="${groundFillPath}" fill="rgba(80,60,40,0.4)" />
      ${splatDots}
      ${buildBars}
      ${treeMarks.join('')}
      <path d="${groundPath}" stroke="#aaa" fill="none" stroke-width="1.4" />
      ${xTicks}
    `;

    // Stats info
    const altMin = Math.min(...samples.map(s => s.ground));
    const altMax = Math.max(...samples.map(s => s.ground));
    const buildHits = samples.filter(s => s.build !== null).length;
    const buildMaxH = buildHits > 0
      ? Math.max(...samples.filter(s => s.build !== null)
                            .map(s => s.build - s.ground)).toFixed(1)
      : '-';
    info.textContent =
      `${totalLen.toFixed(1)}m | sol ${altMin.toFixed(1)}-${altMax.toFixed(1)}m `
      + `(deniv ${(altMax - altMin).toFixed(1)}m) | bati hMax ${buildMaxH}m`;
  }

  function N(arr) { return Math.max(1, arr.length - 1); }

  return { show, hide, render };
}
