// ═══════════════════════════════════════════════════════════════════════════
// PROBE — validation Node du noyau toiture porté (services/toiture)
//
// Node pur, sans Three.js : n'importe QUE le baril index.js (roof-mesh.js est
// volontairement hors baril). Lancer : node scripts/probe-toiture.mjs
// ═══════════════════════════════════════════════════════════════════════════

import {
  buildRoof, buildModel, buildForme, croupeExcept, allCroupe, roofYUnder,
} from '../services/toiture/index.js';

let nOk = 0, nKo = 0;
function check(nom, cond, detail = '') {
  if (cond) { nOk++; console.log(`  ok  ${nom}${detail ? ' — ' + detail : ''}`); }
  else { nKo++; console.error(`  KO  ${nom}${detail ? ' — ' + detail : ''}`); }
}

const rect = (L, W) => [[0, 0], [L, 0], [L, W], [0, W]];

// ── 1 · Rectangle 12×8, 4 pans à 35° ───────────────────────────────────────
console.log('\n[1] rectangle 12×8 — 4 pans à 35°');
{
  const r = buildRoof(rect(12, 8), allCroupe(4, 35));
  check('buildRoof ok', r.ok, r.domaine?.note);
  const pans = r.panels.filter((p) => p.kind === 'pan' && p.aireProjetee > 1e-9);
  check('4 pans', pans.length === 4, `${pans.length} pans`);
  const m = buildModel(r);
  const faitages = m.edges.filter((e) => e.kind === 'faitage');
  check('1 faîtage', faitages.length === 1, `${faitages.length}`);
  check('faîtage horizontal', faitages.every((e) => e.horizontale && Math.abs(e.denivele) < 1e-9),
    faitages.length ? `dénivelé ${faitages[0].denivele.toExponential(1)} m` : '');
  check('aireRampante > aireProjetee', m.stats.aireRampante > m.stats.aireProjetee + 1e-6,
    `${m.stats.aireRampante.toFixed(2)} > ${m.stats.aireProjetee.toFixed(2)} m²`);
  // t est la hauteur : faîte attendu = (8/2)·tan35° = 2.801 m
  const attendu = 4 * Math.tan(35 * Math.PI / 180);
  check('faîte à 4·tan35°', Math.abs(r.audit.tMax - attendu) < 1e-6,
    `${r.audit.tMax.toFixed(4)} m (attendu ${attendu.toFixed(4)})`);
  // roofYUnder au centre = hauteur du faîte
  const y = roofYUnder({ solve: m }, 6, 4);
  check('roofYUnder(centre) = faîte', Math.abs(y - attendu) < 1e-6, `${y.toFixed(4)} m`);
}

// ── 2 · Rectangle avec 2 pignons sur les petits côtés ──────────────────────
console.log('\n[2] rectangle 12×8 — 2 pans + 2 pignons (bâtière)');
{
  // arêtes : 0 = bas (L=12), 1 = droite (W=8), 2 = haut, 3 = gauche
  const r = buildRoof(rect(12, 8), croupeExcept(4, [1, 3], 35));
  check('buildRoof ok', r.ok, r.domaine?.note);
  const pans = r.panels.filter((p) => p.kind === 'pan' && p.aireProjetee > 1e-9);
  const pignons = r.panels.filter((p) => p.kind === 'pignon');
  check('2 pans', pans.length === 2, `${pans.length}`);
  check('2 pignons', pignons.length === 2, `${pignons.length}`);
  const m = buildModel(r);
  const rives = m.edges.filter((e) => e.kind === 'rive');
  check('4 rives rampantes', rives.length === 4, `${rives.length}`);
  check('1 faîtage', m.edges.filter((e) => e.kind === 'faitage').length === 1);
}

// ── 3 · Pentes asymétriques 25°/45° → faîtage décalé ───────────────────────
console.log('\n[3] rectangle 12×8 — pentes 45°/25°, faîtage décalé');
{
  const specs = [
    { mode: 'croupe', pente: 45 },   // arête 0 (z = 0)
    { mode: 'pignon' },
    { mode: 'croupe', pente: 25 },   // arête 2 (z = 8)
    { mode: 'pignon' },
  ];
  const r = buildRoof(rect(12, 8), specs);
  check('buildRoof ok', r.ok, r.domaine?.note);
  const m = buildModel(r);
  const f = m.edges.find((e) => e.kind === 'faitage');
  check('faîtage présent', !!f);
  if (f) {
    const zF = (f.p1[2] + f.p2[2]) / 2;
    // faîte là où les deux plans se coupent : z·tan45 = (8−z)·tan25 → z ≈ 2.53 m
    const t45 = Math.tan(45 * Math.PI / 180), t25 = Math.tan(25 * Math.PI / 180);
    const zAttendu = 8 * t25 / (t45 + t25);
    check('faîtage décalé du centre (z ≠ 4)', Math.abs(zF - 4) > 0.5, `z = ${zF.toFixed(3)} m`);
    check('position exacte', Math.abs(zF - zAttendu) < 1e-6, `attendu ${zAttendu.toFixed(4)} m`);
  }
}

// ── 4 · Emprise en L (concave) ─────────────────────────────────────────────
console.log('\n[4] emprise en L — modèle valide OU échec nommé');
{
  const L = [[0, 0], [12, 0], [12, 6], [6, 6], [6, 10], [0, 10]];
  const r = buildRoof(L, allCroupe(6, 35));
  if (r.ok) {
    const m = buildModel(r);
    const noues = m.edges.filter((e) => e.kind === 'noue');
    check('L valide : audit vert', true, r.domaine?.note);
    check('au moins 1 noue', noues.length >= 1, `${noues.length} noue(s)`);
    check('partition C3', r.audit.checks.find((c) => c.id === 'C3_PARTITION')?.ok === true);
  } else {
    // ÉCHEC NOMMÉ exigé : jamais un crash, jamais un silence.
    const nomme = (r.audit?.nonResolu?.length > 0 && r.audit.nonResolu[0].cause)
      || (r.validation && !r.validation.ok && r.validation.errors.length > 0);
    check('échec NOMMÉ (C9/validation)', !!nomme,
      r.audit?.nonResolu?.[0]?.cause ?? r.validation?.errors?.[0]?.code ?? 'AUCUNE CAUSE — défaut');
  }
}

// ── 5 · Mansard via le moteur etage ────────────────────────────────────────
console.log('\n[5] mansard_2pans via moteur etage');
{
  const b = buildForme('mansard_2pans', rect(12, 8));
  check('moteur = etage', b.moteur === 'etage');
  check('buildForme ok', b.ok, b.ok ? '' : JSON.stringify(b.erreurs ?? b.audit?.checks?.filter((c) => !c.ok)));
  if (b.tiers) {
    check('2 étages', b.tiers.etages.length === 2, `${b.tiers.etages.length}`);
    const e0 = b.tiers.etages[0];
    const brisis = e0.facettes.filter((f) => f.kind === 'pan');
    check('brisis à 70°', brisis.length > 0 && brisis.every((f) => Math.abs(f.pente - 70) < 1e-9),
      `${brisis.length} facette(s) de brisis`);
    check('palier à 2.0 m', Math.abs(e0.h1 - 2.0) < 1e-9, `${e0.h1} m`);
    const dernier = b.tiers.roof;
    const terrassons = (dernier?.panels ?? []).filter((p) => p.kind === 'pan' && p.aireProjetee > 1e-9);
    check('terrasson à 30°', terrassons.every((p) => Math.abs(p.pente - 30) < 1e-6),
      terrassons.map((p) => p.pente.toFixed(1)).join('/') + '°');
    check('sommet > palier', b.tiers.sommet > 2.0, `sommet ${b.tiers.sommet?.toFixed(3)} m`);
    check('partition globale M2', b.tiers.audit.checks.find((c) => c.id === 'M2_PARTITION_GLOBALE')?.ok === true);
  }
}

console.log(`\n═══ ${nOk} ok · ${nKo} KO ═══`);
process.exit(nKo ? 1 : 0);
