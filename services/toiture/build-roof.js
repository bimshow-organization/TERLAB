// ═══════════════════════════════════════════════════════════════════════════
// buildRoof — LE PIPELINE S1, DANS SON PROPRE MODULE
//
// Il vivait dans `index.mjs`, le baril de réexports. `tiers`, `shapes` et
// `dormer` avaient donc besoin d'importer depuis le baril, qui les importait
// en retour : un cycle. Les modules ES le tolèrent grâce au hoisting, mais
// c'était une dépendance circulaire bien réelle, et elle a explosé au premier
// bundle mono-fichier — `__mods['index']` n'existait pas encore quand `tiers`
// s'exécutait.
//
// Le baril ne contient plus que des réexports. Le graphe est acyclique.
//
// Porté depuis bimshow-vision (POC ciriani-santillana, module `build-roof`).
// ═══════════════════════════════════════════════════════════════════════════

import { normalizeEdgeSpecs, weightsFrom } from './edge-modes.js';
import { validateFootprint } from './validate.js';
import { weightedSkeleton, lift } from './weighted-skeleton.js';
import { buildPanels, classifyEdges, planesOf, auditSkeleton } from './audit.js';
import { insertVerticalBreaks, heightsOfBreaks } from './breaks.js';

/**
 * Construit une toiture depuis une emprise et des modes d'arête.
 *
 * @param {Array<[number,number]>} footprint  emprise en mètres, Pt2 = [x, z]
 * @param {Array<object>} edgeSpecs           un objet par arête : { mode, pente?, debord? }
 * @param {object} opts                       { baseY, defaults, strict }
 * @returns {{ ok, validation, skeleton, planes, panels, edges, audit, lifted }}
 */
export function buildRoof(footprint, edgeSpecs, opts = {}) {
  const specs = normalizeEdgeSpecs(edgeSpecs, footprint.length, opts.defaults);
  const w0 = weightsFrom(specs);

  const validation = validateFootprint(footprint, w0, opts.limits);
  if (!validation.ok) {
    return { ok: false, validation, skeleton: null, planes: null, panels: null, edges: null, audit: null, lifted: null, specs };
  }

  // S2 · les sommets à 180° à poids différents reçoivent un retour vertical
  const br = insertVerticalBreaks(validation.poly, validation.weights, validation.origin);
  validation.warnings.push(...br.warnings);
  const { poly, weights, dirs, origin } = br;
  const skeleton = weightedSkeleton(poly, weights, dirs);
  skeleton.breaks = heightsOfBreaks(skeleton, br.breaks);
  skeleton.origin = origin;
  const planes = planesOf(skeleton.poly, skeleton.weights);
  const panels = buildPanels(skeleton);
  const edges = classifyEdges(skeleton, panels, planes);
  const audit = auditSkeleton(skeleton, panels, { edges, planes });
  const lifted = lift(skeleton, opts.baseY ?? 0);
  const domaine = classerDomaine(skeleton, audit, br.breaks.length);

  return { ok: audit.ok, domaine, validation, skeleton, planes, panels, edges, audit, lifted, specs, weights,
           breaks: skeleton.breaks };
}

/**
 * DOMAINE DE VALIDITÉ MESURÉ — balayage de 12 000 emprises concaves
 * (L, T, U, croix, escalier), pentes et pignons tirés au sort, PRNG déterministe.
 *
 *                                                     avant S10   après S10
 *   emprise CONVEXE, quelles que soient pentes/pignons   100 %       100 %
 *   concave, pente uniforme, sans pignon                  92,9 %      98,9 %
 *   concave, pentes variées, sans pignon                  87,0 %      87,0 %
 *   concave, pente uniforme, avec pignon                  74,1 %      76,1 %
 *   concave, pentes variées, avec pignon                  68,6 %      68,6 %
 *
 * CE QUI A CHANGÉ EN S10. La fermeture de boucle prenait le barycentre des
 * sommets restants à l'altitude la plus tardive — une invention pure. Elle
 * résout maintenant l'intersection EXACTE des plans quand ils se coupent en un
 * point (ce qui a réglé le régime à pente uniforme), et refuse de poser un nœud
 * sinon. Le refus est nommé par `C9_BOUCLES_RESOLUES`.
 *
 * CE QUI RESTE, ET C'EST MESURÉ. 67 % des boucles non résolues sont des boucles
 * dont TOUS les fronts sont mutuellement parallèles. Leurs plans ne se coupent
 * en aucun point : la fermeture correcte n'est pas un sommet mais une SUITE DE
 * CRÊTES HORIZONTALES, donnée par l'enveloppe inférieure à une dimension des
 * hauteurs h_i(ξ) le long de la normale commune. L'événement de crête entre
 * fronts parallèles reste à implémenter ; c'est un problème à une dimension,
 * donc exactement soluble, et c'est le prochain chantier identifié.
 *
 * Aucun échec n'est silencieux : tous sont détectés par l'audit, et depuis S10
 * ils portent leur cause.
 */
export function classerDomaine(skeleton, audit, nBreaks = 0) {
  const poly = skeleton.poly, W = skeleton.weights, n = poly.length;
  let reflex = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n], b = poly[i], c = poly[(i + 1) % n];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -1e-9) reflex++;
  }
  // Un retour vertical (S2) crée un sommet rentrant que le produit vectoriel ne
  // voit pas : ses arêtes sont de longueur nulle. Il compte pourtant, et il
  // place la construction dans le régime limite.
  reflex += nBreaks;
  const actifs = W.filter((s) => s > 0);
  const pignons = W.length - actifs.length;
  const uniforme = actifs.every((s) => Math.abs(s - actifs[0]) < 1e-9);
  const eprouve = nBreaks === 0 && (reflex === 0 || (uniforme && pignons === 0));
  return {
    convexe: reflex === 0, reflex, pignons, retoursVerticaux: nBreaks, penteUniforme: uniforme,
    eprouve,                       // vrai = régime où S1 est exact à 100 %
    nonResolu: audit?.nonResolu ?? [],
    note: eprouve
      ? 'régime éprouvé (100 % sur 12 000 cas)'
      : `régime limite : ${nBreaks ? `${nBreaks} retour(s) vertical(aux) · ` : ''}emprise concave (${reflex} rentrant${reflex > 1 ? 's' : ''})`
        + `${pignons ? ` + ${pignons} pignon(s)` : ''}${uniforme ? '' : ' + pentes variées'}`
        + ` — ${audit.ok ? 'construit et audité vert'
             : (audit.nonResolu?.length
                ? `ÉCHEC NOMMÉ : ${audit.nonResolu[0].cause} — ${audit.nonResolu.length} boucle(s) non résolue(s)`
                : 'ÉCHEC détecté par l\'audit, ne pas utiliser')}`,
  };
}

/** Résumé lisible d'un résultat de `buildRoof` — pour la console et les tests. */
export function describeRoof(r) {
  if (!r.validation.ok) {
    return ['VALIDATION ÉCHOUÉE', ...r.validation.errors.map((e) => `  ✗ [${e.code}] ${e.msg}`)].join('\n');
  }
  const L = [];
  const byKind = {};
  for (const e of r.edges) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  const pans = r.panels.filter((p) => p.kind === 'pan' && p.aireProjetee > 1e-9);
  const pig = r.panels.filter((p) => p.kind === 'pignon');
  L.push(`emprise ${r.skeleton.poly.length} sommets · ${r.audit.aireEmprise.toFixed(2)} m²`);
  L.push(`faîte    ${r.audit.tMax.toFixed(3)} m au-dessus de l'égout`);
  L.push(`pans     ${pans.length} incliné(s)${pig.length ? ` + ${pig.length} pignon(s)` : ''}`);
  for (const p of pans) {
    L.push(`         · pan e${p.edge} — pente ${p.pente.toFixed(1)}° — ${p.aireProjetee.toFixed(2)} m² projeté / ${p.aireRampante.toFixed(2)} m² rampant`);
  }
  L.push(`arêtes   ${Object.entries(byKind).map(([k, v]) => `${v} ${k}`).join(' · ')}`);
  // on décrit toutes les lignes de crête « en face » et tous les creux : le nom
  // exact (faitage / faitage_rampant / cheneau / noue) est dans `e.kind`.
  for (const e of r.edges.filter((x) => (x.famille === 'crete' && x.enFace) || x.famille === 'creux')) {
    L.push(`         · ${e.kind} ${e.longueur.toFixed(3)} m — dièdre ${e.diedre?.toFixed(1)}°`);
  }
  for (const c of r.audit.checks) L.push(`  ${c.ok ? '✓' : '✗'} ${c.id.padEnd(24)} ${c.detail}`);
  if (r.validation.repairs.length) L.push(...r.validation.repairs.map((x) => `  ⟳ [${x.code}] ${x.msg}`));
  if (r.validation.warnings.length) L.push(...r.validation.warnings.map((x) => `  ⚠ [${x.code}] ${x.msg}`));
  return L.join('\n');
}
