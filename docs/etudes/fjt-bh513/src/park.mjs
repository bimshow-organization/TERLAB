import fs from 'node:fs';
import { layoutParking } from 'file:///C:/GITHUB/code-runner/tools/city/parking-layout.mjs';
const Z = JSON.parse(fs.readFileSync('parking_zones.json', 'utf8')), out = {};
for (const [k, ring] of Object.entries(Z)) {
  let best = null;
  for (let seed = 0; seed < 12; seed++) { const r = layoutParking(ring, [], { seed }); if (!best || r.stalls > best.stalls) best = { ...r, seed }; }
  out[k] = best; console.log(k, best.name, 'places', best.stalls, 'dont PMR', best.pmr, 'rangées', best.rows.length, 'seed', best.seed);
}
fs.writeFileSync('parking_layout.json', JSON.stringify(out));
