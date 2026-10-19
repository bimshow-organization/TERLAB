// node shot.cjs <html|url> <out.png|out.pdf> [w] [h]
const puppeteer = require('C:/GITHUB/TERLAB/node_modules/puppeteer');
(async () => {
  const [src, out, w, h] = process.argv.slice(2);
  const b = await puppeteer.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const p = await b.newPage();
  await p.setViewport({ width: +w || 1100, height: +h || 900 });
  const url = /^https?:/.test(src) ? src : 'file:///' + src.split('\\').join('/');
  await p.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
  if (out.endsWith('.pdf')) await p.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
  else await p.screenshot({ path: out, fullPage: true });
  await b.close();
})();
