// node crop_bbox.cjs <out.json> <svg1> [svg2 ...] : emprise (unités du viewBox) de l'ensemble des groupes .bloc-plan de chaque plan SVG de la planche
const puppeteer = require('C:/GITHUB/TERLAB/node_modules/puppeteer'); const fs = require('fs');
(async () => {
  const [out, ...files] = process.argv.slice(2); const b = await puppeteer.launch({ headless: 'new' }); const res = {};
  for (const f of files) {
    const p = await b.newPage(); await p.setViewport({ width: 1200, height: 1200 });
    const svg = fs.readFileSync(f, 'utf8'); await p.setContent('<html><body style="margin:0">' + svg + '</body></html>');
    res[f] = await p.evaluate(() => {
      const s = document.querySelector('svg'); const r0 = s.getBoundingClientRect(); const vb = s.viewBox.baseVal; const k = vb.width / r0.width;
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const g of s.querySelectorAll('g.bloc-plan')) { const r = g.getBoundingClientRect(); if (!r.width) continue; x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); }
      return { x0: (x0 - r0.left) * k + vb.x, y0: (y0 - r0.top) * k + vb.y, x1: (x1 - r0.left) * k + vb.x, y1: (y1 - r0.top) * k + vb.y, vb: [vb.x, vb.y, vb.width, vb.height] };
    });
    await p.close();
  }
  fs.writeFileSync(out, JSON.stringify(res, null, 1)); await b.close();
})();
