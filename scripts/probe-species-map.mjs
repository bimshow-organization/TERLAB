/**
 * probe-species-map.mjs — validation Node pure (sans THREE) du mapping
 * espèces bpf → recettes atlas de services/vegetation/species-map.js.
 *
 * Vérifie :
 *   1. chaque clé de data/bpf-species-reunion.json a une entrée SPECIES_MAP ;
 *   2. chaque espèce isPalm:true mappe vers une recette de type 'palm' ;
 *   3. chaque atlasId référencé (mapping + replis growthForm) existe dans
 *      ATLAS_SPECIES et sa recette n'est pas un design 'bam' non porté ;
 *   4. aucune clé orpheline dans SPECIES_MAP (absente du JSON bpf).
 *
 * Usage : node scripts/probe-species-map.mjs   → exit 0 si tout est vert.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { ATLAS_SPECIES, SPECIES_MAP, DEFAULT_BY_GROWTHFORM } =
  await import(new URL('../services/vegetation/species-map.js', import.meta.url));

const bpf = JSON.parse(readFileSync(join(root, 'data', 'bpf-species-reunion.json'), 'utf8'));
const keys = Object.keys(bpf.species);

let errors = 0;
const fail = (msg) => { console.error('  ECHEC  ' + msg); errors++; };

console.log(`Probe species-map — ${keys.length} espèces bpf, ${Object.keys(ATLAS_SPECIES).length} recettes atlas\n`);

/* 1 + 2 + 3 : couverture, palmiers, existence des recettes */
let nPalm = 0;
const rows = [];
for (const k of keys) {
  const sp = bpf.species[k];
  const m = SPECIES_MAP[k];
  if (!m) { fail(`clé bpf sans mapping : ${k}`); continue; }
  const def = ATLAS_SPECIES[m.atlasId];
  if (!def) { fail(`${k} → recette atlas inexistante : ${m.atlasId}`); continue; }
  const type = def.recipe[0];
  if (type === 'bam') fail(`${k} → ${m.atlasId} : recette 'bam' non portée`);
  if (sp.isPalm) {
    nPalm++;
    if (type !== 'palm') fail(`${k} est isPalm mais mappe vers '${type}' (${m.atlasId})`);
  }
  rows.push([k, sp.label, m.atlasId, type, m.exact ? 'exact' : 'fallback']);
}

/* 4 : orphelins */
for (const k of Object.keys(SPECIES_MAP)) {
  if (!bpf.species[k]) fail(`clé SPECIES_MAP absente du JSON bpf : ${k}`);
}

/* replis growthForm */
for (const [gf, id] of Object.entries(DEFAULT_BY_GROWTHFORM)) {
  if (!ATLAS_SPECIES[id]) fail(`repli growthForm '${gf}' → recette inexistante : ${id}`);
}

/* Table récapitulative */
const w = [24, 26, 14, 8, 8];
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('clé bpf', w[0]) + pad('label', w[1]) + pad('→ atlas', w[2]) + pad('type', w[3]) + 'statut');
console.log('-'.repeat(w.reduce((a, b) => a + b, 0)));
for (const r of rows) console.log(r.map((c, i) => pad(c, w[i])).join(''));

console.log(`\n${rows.length}/${keys.length} clés mappées, ${nPalm} isPalm vérifiées palm.`);
if (errors) { console.error(`\n${errors} erreur(s).`); process.exit(1); }
console.log('PROBE VERT — mapping complet et coherent.');
