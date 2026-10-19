const puppeteer = require('C:/GITHUB/TERLAB/node_modules/puppeteer');
(async () => {
  const b = await puppeteer.launch(); const p = await b.newPage(); await p.setViewport({ width: 1600, height: 1200 });
  await p.goto('file:///' + process.argv[2], { waitUntil: 'networkidle0' });
  const r = await p.evaluate(() => {
    const f = document.querySelector('figure.ppr'); if (!f) return null;
    const s = f.querySelector('svg'), cs = getComputedStyle(s);
    return { fig: f.getBoundingClientRect().toJSON(), svg: s.getBoundingClientRect().toJSON(), disp: cs.display, parent: f.parentElement.className || f.parentElement.tagName, body: f.closest('.body').getBoundingClientRect().toJSON() };
  });
  console.log(JSON.stringify(r)); await b.close();
})();
