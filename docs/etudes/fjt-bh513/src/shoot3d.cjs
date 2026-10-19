// node shoot3d.cjs <outDir> <W> <H> v:cam [v:cam ...]
const puppeteer = require('C:/GITHUB/TERLAB/node_modules/puppeteer');
(async () => {
  const [out, W, H, ...jobs] = process.argv.slice(2);
  const b = await puppeteer.launch({ headless: 'new', args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu-rasterization'] });
  for (const j of jobs) {
    const [v, cam, extra] = j.split(':'); const p = await b.newPage(); await p.setViewport({ width: +W, height: +H });
    p.on('console', m => { if (/error|warn/i.test(m.type())) console.log('  [page]', m.type(), m.text().slice(0, 200)); });
    p.on('pageerror', e => console.log('  [pageerror]', e.message));
    const t0 = Date.now();
    await p.goto(`http://127.0.0.1:54892/tools/city/fjt-bh513.html?v=${v}&cam=${cam}&shot=1${extra ? '&' + extra : ''}`, { waitUntil: 'load', timeout: 120000 });
    await p.waitForFunction('window.__SHOT_READY__ === true', { timeout: 60000, polling: 500 }).catch(() => console.log('  timeout ready'));
    await new Promise(r => setTimeout(r, 1500));
    await p.screenshot({ path: `${out}/3d_${v}_${cam}${extra ? '_' + extra.replace(/[=&]/g, '') : ''}.png` }); console.log(j, 'ok', ((Date.now() - t0) / 1000).toFixed(1) + 's');
    await p.close();
  }
  await b.close();
})();
