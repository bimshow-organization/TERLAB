// ═══════════════════════════════════════════════════════════════════════
// TERLAB · scripts/probe-parcel-alts.mjs
// Sonde RÉSEAU : vérifie que les altitudes des sommets de parcelle viennent
// bien du MNT (BIL 1 m IGN via ParcelAltitudes.sample) et non d'une formule.
// Contexte : terrain-3d-viewer fabriquait ses cotes (`denivelé_m ?? 2`,
// `altitude_ngr ?? 100`) — cette sonde est le garde-fou de la correction.
//
//   npx serve . -p 8099 -s     (dans un autre terminal, ou --serve ci-dessous)
//   node scripts/probe-parcel-alts.mjs
// ═══════════════════════════════════════════════════════════════════════

import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

// PROBE_ORIGIN : réutiliser un serveur déjà lancé (le port 8099 peut être pris,
// `serve` bascule alors silencieusement sur un port libre).
const PORT = Number(process.env.PROBE_PORT ?? 8099);
const ORIGIN = process.env.PROBE_ORIGIN ?? `http://localhost:${PORT}`;
const OWN_SERVER = !process.env.PROBE_ORIGIN;

let pass = 0, fail = 0;
const check = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✔ ${label}`); }
  else { fail++; console.error(`  ✘ ${label}${detail ? ' — ' + detail : ''}`); }
};

// ── Parcelles réelles du jeu de démo ────────────────────────────────────
const demos = JSON.parse(readFileSync(new URL('../data/demos.json', import.meta.url), 'utf8'));
const rings = demos.demos.map(d => {
  const g = d.terrain?.parcelle_geojson;
  const c = g?.coordinates?.[0];
  const ring = Array.isArray(c?.[0]?.[0]) ? c[0] : c;
  return { nom: d.terrain?.commune ?? d.id ?? '?', ring };
}).filter(r => r.ring?.length >= 3);

// ── Serveur statique ────────────────────────────────────────────────────
const srv = OWN_SERVER
  ? spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['serve', '.', '-p', String(PORT), '-s'],
      { cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), stdio: 'ignore', shell: true })
  : null;

const waitForServer = async () => {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${ORIGIN}/data/demos.json`)).ok) return true; } catch {}
    if (!OWN_SERVER && i > 4) return false;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
};

const browser = await (async () => {
  if (!await waitForServer()) { console.error(`serveur statique indisponible sur ${ORIGIN}`); srv?.kill(); process.exit(2); }
  return puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
})();

try {
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('    [page]', m.text()); });
  await page.goto(`${ORIGIN}/data/demos.json`, { waitUntil: 'domcontentloaded' });

  for (const { nom, ring } of rings) {
    console.log(`\n── ${nom} (${ring.length} sommets)`);
    const res = await page.evaluate(async (coords) => {
      const [{ default: BIL }, { default: PA }] = await Promise.all([
        import('/services/bil-terrain.js'),
        import('/services/parcel-altitudes.js'),
      ]);
      window.BILTerrain = BIL;                    // ParcelAltitudes lit le global
      const t0 = performance.now();
      const s = await PA.sample(coords.map(c => [c[0], c[1]]));
      return { ...s, ms: Math.round(performance.now() - t0) };
    }, ring);

    const alts = res.points.map(p => p.alt).filter(a => a != null);
    check('tous les sommets ont une altitude lue', alts.length === ring.length,
      `${alts.length}/${ring.length}`);
    check('altitudes plausibles à La Réunion (0–3100 m)',
      alts.every(a => a >= -5 && a <= 3100));
    check('le dénivelé n\'est pas la valeur fabriquée de 2,00 m',
      Math.abs(res.range - 2) > 1e-6, `range=${res.range?.toFixed(2)}`);
    check('les sommets ne sont pas tous à la même altitude',
      new Set(alts.map(a => a.toFixed(3))).size > 1);
    console.log(`    min ${res.minAlt?.toFixed(1)} · max ${res.maxAlt?.toFixed(1)} · dénivelé ${res.range?.toFixed(2)} m · ${res.ms} ms`);
  }
} finally {
  await browser.close();
  srv?.kill();
}

console.log(`\n${fail === 0 ? '✔' : '✘'} ${pass} succès, ${fail} échec(s)`);
process.exit(fail === 0 ? 0 : 1);
