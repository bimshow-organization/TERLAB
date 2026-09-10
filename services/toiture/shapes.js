// ═══════════════════════════════════════════════════════════════════════════
// S8 — LE CATALOGUE DE FORMES
//
// ── LA CONSIGNE : « ON NE FAIT PAS LES TOITURES REDONDANTES » ──────────────
// Le CDC liste 43 typologies en 8 familles. Écrire 43 générateurs serait une
// faute : la plupart de ces « typologies » sont le MÊME objet géométrique vu
// sous un autre nom commercial. Un pavillon et une pyramide, c'est allCroupe
// sur 4 puis sur n arêtes. Une croupe hollandaise et une demi-croupe, c'est le
// même étagement dans les deux sens. Un papillon et deux appentis avec chéneau
// central, c'est le même agrégat.
//
// Ce fichier ne contient donc AUCUNE géométrie. C'est une table de RECETTES :
// chaque forme dit dans quel moteur elle se résout et avec quels paramètres.
// Les trois moteurs sont ceux qui existent déjà :
//     'simple'   → buildRoof            (poids par arête)
//     'etage'    → buildTieredRoof      (poids par palier)
//     'agregat'  → buildAssembly        (plusieurs emprises + jonctions)
//
// ── ET LA PREUVE QUE CE N'EST PAS REDONDANT ────────────────────────────────
// Une table de noms ne prouve rien. `signatureForme` calcule une empreinte
// topologique mesurable (nombre de pans, de pignons, de faîtages, de noues,
// de chéneaux, de brisis, altitude relative du faîte). Le test du catalogue
// exige que deux formes distinctes aient des signatures distinctes SUR LA
// MÊME EMPRISE. Une forme qui ne se distingue pas d'une autre n'a pas sa place
// dans le catalogue, et le test le dit avec les deux noms.
//
// `classerForme` fait le chemin inverse : depuis un modèle quelconque, il
// retrouve le nom. C'est ce dont l'interface a besoin pour intituler ce que
// l'utilisateur vient de dessiner à la main.
//
// Porté depuis bimshow-vision (POC ciriani-santillana, module `shapes`).
// ═══════════════════════════════════════════════════════════════════════════

import { buildRoof } from './build-roof.js';
import { buildModel } from './model.js';
import { buildTieredRoof, mansard, demiCroupe, croupeHollandaise, pagode } from './tiers.js';
import { buildAssembly } from './assembly.js';
import { allCroupe, croupeExcept } from './edge-modes.js';

const tousSauf = (n, gardees, pente) =>
  Array.from({ length: n }, (_, i) => (gardees.includes(i) ? { mode: 'croupe', pente } : { mode: 'pignon' }));

/** Bande de largeur `l` prise dans un rectangle, le long de x. */
const bande = (x0, x1, z0, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

// ═══ LE CATALOGUE ═══════════════════════════════════════════════════════════
//
// famille · id · label · moteur · params par défaut · recette
// La recette reçoit (emprise, params) et rend ce que le moteur attend.

export const FORMES = {

  // ── Famille 1 · les toitures à pans, un seul niveau ────────────────────
  monopente: {
    famille: 'pans', label: 'Monopente / appentis', moteur: 'simple',
    params: { pente: 30, versant: 0 },
    note: 'Un seul pan. Toutes les autres arêtes sont des pignons. Un toit-terrasse '
        + 'à 2 % est la même chose avec pente = 1,15° — pas une famille à part.',
    recette: (f, p) => tousSauf(f.length, [p.versant], p.pente),
  },
  deux_pans: {
    famille: 'pans', label: 'Deux pans (bâtière)', moteur: 'simple',
    params: { pente: 35, pignons: null },
    note: 'Les deux arêtes opposées aux pignons portent les versants.',
    recette: (f, p) => croupeExcept(f.length, p.pignons ?? paires(f.length), p.pente),
  },
  deux_pans_asymetrique: {
    famille: 'pans', label: 'Deux pans asymétriques', moteur: 'simple',
    params: { penteA: 45, penteB: 25, pignons: null },
    note: 'Le faîtage se décale tout seul : il est là où les deux plans se coupent. '
        + 'Aucun code spécifique — deux poids différents suffisent.',
    recette: (f, p) => {
      const pig = new Set(p.pignons ?? paires(f.length));
      let k = 0;
      return Array.from({ length: f.length }, (_, i) =>
        pig.has(i) ? { mode: 'pignon' } : { mode: 'croupe', pente: k++ === 0 ? p.penteA : p.penteB });
    },
  },
  trois_pans: {
    famille: 'pans', label: 'Trois pans (une croupe)', moteur: 'simple',
    params: { pente: 35, pignon: 1 },
    recette: (f, p) => croupeExcept(f.length, [p.pignon], p.pente),
  },
  quatre_pans: {
    famille: 'pans', label: 'Quatre pans (pavillon)', moteur: 'simple',
    params: { pente: 35 },
    recette: (f, p) => allCroupe(f.length, p.pente),
  },
  pyramide: {
    famille: 'pans', label: 'Pyramide / pavillon à n pans', moteur: 'simple',
    params: { pente: 40 },
    note: 'Ce n\'est PAS une typologie distincte du pavillon : c\'est allCroupe sur une '
        + 'emprise dont le squelette se réduit à un point. La forme naît de l\'emprise.',
    recette: (f, p) => allCroupe(f.length, p.pente),
  },
  // ── Famille 2 · les toitures étagées ──────────────────────────────────
  mansard_2pans: {
    famille: 'etages', label: 'Mansard à deux pans (comble brisé)', moteur: 'etage',
    params: { brisis: 70, terrasson: 30, hBrisis: 2.0, pignons: null },
    recette: (f, p) => mansard({ n: f.length, brisis: p.brisis, terrasson: p.terrasson,
      hBrisis: p.hBrisis, pignons: p.pignons ?? paires(f.length) }),
  },
  mansard_4pans: {
    famille: 'etages', label: 'Mansard à quatre pans', moteur: 'etage',
    params: { brisis: 72, terrasson: 28, hBrisis: 2.2 },
    recette: (f, p) => mansard({ n: f.length, brisis: p.brisis, terrasson: p.terrasson, hBrisis: p.hBrisis }),
  },
  demi_croupe: {
    famille: 'etages', label: 'Demi-croupe (jerkinhead)', moteur: 'etage',
    params: { pente: 40, hPignon: 1.2, cotes: null },
    note: 'Pignon en bas, croupe au-dessus.',
    recette: (f, p) => demiCroupe({ n: f.length, pente: p.pente, hPignon: p.hPignon,
      cotes: p.cotes ?? paires(f.length) }),
  },
  croupe_hollandaise: {
    famille: 'etages', label: 'Croupe hollandaise (pignon écrêté)', moteur: 'etage',
    params: { pente: 40, hCroupe: 2.2, cotes: null },
    note: 'L\'inverse exact de la demi-croupe : croupe en bas, pignon au-dessus. '
        + 'Même mécanisme, ordre des paliers inversé.',
    recette: (f, p) => croupeHollandaise({ n: f.length, pente: p.pente, hCroupe: p.hCroupe,
      cotes: p.cotes ?? paires(f.length) }),
  },
  pagode: {
    famille: 'etages', label: 'Pagode / toit à courbure facettée', moteur: 'etage',
    params: { pentes: [55, 42, 30], hauteurs: [1.0, 2.0] },
    note: 'C\'est ici que se matérialise l\'arbitrage « facetter à la frontière du '
        + 'modèle constructif » : une courbe est une suite de paliers, chacun un vrai pan.',
    recette: (f, p) => pagode({ n: f.length, pentes: p.pentes, hauteurs: p.hauteurs }),
  },

  // ── Famille 3 · les agrégats ──────────────────────────────────────────
  papillon: {
    famille: 'agregats', label: 'Papillon (deux versants inversés, chéneau central)', moteur: 'agregat',
    params: { pente: 20, largeur: 12, profondeur: 8 },
    note: 'Un papillon a un ÉGOUT INTÉRIEUR. Aucun squelette droit d\'un polygone simple '
        + 'n\'en produit — c\'est structurellement un agrégat de deux appentis dos à dos, '
        + 'et c\'est exactement ce que la couche agrégat sait faire.',
    recette: (f, p) => {
      const L = p.largeur, W = p.profondeur;
      // bande() ordonne ses arêtes [bas, droite, haut, gauche]. Le versant
      // gauche doit avoir son ÉGOUT à droite (x = 0, la ligne partagée) pour
      // que l'eau y descende — c'est ce qui fait le chéneau central. L'inverse
      // donnerait deux versants dos à dos, c'est-à-dire une bâtière.
      // Pas de débord au-dessus du chéneau, et une évacuation déclarée à
      // chaque extrémité : les deux règles de la couche agrégat s'appliquent
      // ici sans exception, un papillon n'a rien de spécial de ce point de vue.
      const sansDebord = (garde) => tousSauf(4, [garde], p.pente)
        .map((e, i) => (i === garde ? { ...e, debord: 0 } : e));
      return {
        units: [
          { id: 'gauche', footprint: bande(-L / 2, 0, -W / 2, W / 2), edges: sansDebord(1) },
          { id: 'droite', footprint: bande(0, L / 2, -W / 2, W / 2), edges: sansDebord(3) },
        ],
        evacuations: [[0, -W / 2], [0, W / 2]],
      };
    },
  },
  shed: {
    famille: 'agregats', label: 'Shed / dents de scie', moteur: 'agregat',
    params: { pente: 25, n: 3, largeur: 4, profondeur: 10 },
    note: 'N appentis parallèles, chacun avec sa verrière au nord. Le chéneau entre '
        + 'deux dents est une jonction, pas une géométrie nouvelle.',
    recette: (f, p) => ({
      // Chaque dent monte de gauche à droite : son ÉGOUT est l'arête 3 (x = x0).
      // La face droite de la dent k est donc verticale et haute, et vient buter
      // sur l'égout de la dent k+1 — c'est là que se pose le chéneau et la
      // verrière. Orienter les dents dans l'autre sens donnerait n bâtiments
      // mitoyens, ce que l'audit du catalogue a d'ailleurs dit tel quel.
      units: Array.from({ length: p.n }, (_, k) => ({
        id: `dent${k}`,
        footprint: bande(k * p.largeur, (k + 1) * p.largeur, 0, p.profondeur),
        edges: tousSauf(4, [3], p.pente).map((e, i) => (i === 3 ? { ...e, debord: 0 } : e)),
      })),
      evacuations: Array.from({ length: p.n }, (_, k) => [[k * p.largeur, 0], [k * p.largeur, p.profondeur]]).flat(),
    }),
  },
  deux_toits_cheneau: {
    famille: 'agregats', label: 'Deux quatre-pans accolés, chéneau intermédiaire', moteur: 'agregat',
    params: { pente: 35, largeur: 10, profondeur: 8 },
    note: 'Le chéneau intermédiaire interdit le débord des deux égouts qui s\'y jettent : '
        + 'deux nappes en porte-à-faux au-dessus du même chéneau se toucheraient. '
        + 'La règle vient de la couche agrégat, pas d\'un cas particulier écrit ici.',
    recette: (f, p) => {
      const sansDebord = (garde) => allCroupe(4, p.pente).map((e, i) => (i === garde ? { ...e, debord: 0 } : e));
      return {
        units: [
          { id: 'corps1', footprint: bande(0, p.largeur, 0, p.profondeur), edges: sansDebord(1) },
          { id: 'corps2', footprint: bande(p.largeur, 2 * p.largeur, 0, p.profondeur), edges: sansDebord(3) },
        ],
        evacuations: [[p.largeur, 0], [p.largeur, p.profondeur]],
      };
    },
  },
  corps_et_terrasse: {
    famille: 'agregats', label: 'Corps en pente + liaison en toit terrasse', moteur: 'agregat',
    params: { pente: 35, largeur: 10, profondeur: 8, liaison: 4, hCorps: 3.0, hTerrasse: 2.6 },
    note: 'La terrasse de liaison doit passer SOUS l\'égout des corps : au-dessus, '
        + 'elle noierait l\'égout et l\'eau du versant se jetterait sur l\'étanchéité. '
        + 'C\'est la jonction `egout_noye`, refusée par l\'audit d\'agrégat.',
    recette: (f, p) => ({ units: [
      { id: 'corps1', footprint: bande(0, p.largeur, 0, p.profondeur), baseY: p.hCorps, edges: allCroupe(4, p.pente) },
      { id: 'lien', kind: 'terrasse', footprint: bande(p.largeur, p.largeur + p.liaison, 0, p.profondeur),
        baseY: p.hTerrasse, pentePct: 2 },
      { id: 'corps2', footprint: bande(p.largeur + p.liaison, 2 * p.largeur + p.liaison, 0, p.profondeur),
        baseY: p.hCorps, edges: allCroupe(4, p.pente) },
    ] }),
  },
};

const paires = (n) => Array.from({ length: n }, (_, i) => i).filter((i) => i % 2 === 1);

export const FAMILLES = ['pans', 'etages', 'agregats'];
export const FORME_IDS = Object.keys(FORMES);

// ═══ CONSTRUCTION ═══════════════════════════════════════════════════════════

/**
 * Construit une forme nommée.
 * @param id         clé de FORMES
 * @param footprint  emprise (ignorée par les agrégats, qui portent les leurs)
 * @param params     surcharge des paramètres par défaut
 */
export function buildForme(id, footprint, params = {}) {
  const F = FORMES[id];
  if (!F) throw new Error(`Forme inconnue : "${id}" — connues : ${FORME_IDS.join(', ')}`);
  const P = { ...F.params, ...params };
  const spec = F.recette(footprint ?? [], P);

  if (F.moteur === 'simple') {
    const r = buildRoof(footprint, spec);
    const model = r.validation.ok && r.audit ? buildModel(r) : null;
    return { id, forme: F, params: P, moteur: 'simple', ok: !!(r.ok && model), r, model,
             audit: r.audit, erreurs: r.validation.ok ? [] : r.validation.errors };
  }
  if (F.moteur === 'etage') {
    const t = buildTieredRoof(footprint, spec);
    return { id, forme: F, params: P, moteur: 'etage', ok: t.ok, tiers: t,
             r: t.roof, model: t.roof && t.roof.ok ? buildModel(t.roof) : null,
             audit: t.audit, erreurs: t.erreurs ?? [] };
  }
  const a = buildAssembly(spec);
  return { id, forme: F, params: P, moteur: 'agregat', ok: a.ok, assembly: a,
           audit: a.audit, erreurs: [] };
}

// ═══ SIGNATURE ET CLASSEMENT ════════════════════════════════════════════════

/**
 * Empreinte topologique MESURÉE d'une forme construite. C'est elle qui sert de
 * preuve de non-redondance : deux entrées du catalogue qui rendent la même
 * signature sur la même emprise sont la même toiture sous deux noms.
 */
export function signatureForme(b) {
  if (b.moteur === 'agregat') {
    const A = b.assembly;
    const jonctions = {};
    for (const j of A.junctions) jonctions[j.kind] = (jonctions[j.kind] ?? 0) + 1;
    return {
      moteur: 'agregat', unites: A.units.length,
      terrasses: A.units.filter((u) => u.kind === 'terrasse').length,
      pans: A.units.reduce((s, u) => s + (u.panels ?? []).filter((p) => p.kind === 'pan' && p.aireProjetee > 1e-9).length, 0),
      jonctions,
      // La seule jonction ne suffit pas : un papillon et deux pavillons accolés
      // partagent le même chéneau central. C'est la COMPOSITION des unités qui
      // les distingue. Le test F2 l'a montré en les déclarant identiques.
      composition: A.units.map((u) => u.kind === 'terrasse' ? 'T'
        : `${(u.panels ?? []).filter((x) => x.kind === 'pan' && x.aireProjetee > 1e-9).length}p`).join('+'),
      cle: `agregat|${A.units.length}u|`
         + `${A.units.map((u) => u.kind === 'terrasse' ? 'T' : `${(u.panels ?? []).filter((x) => x.kind === 'pan' && x.aireProjetee > 1e-9).length}p`).join('+')}`
         + `|${Object.entries(jonctions).sort().map(([k, v]) => k + v).join(',')}`,
    };
  }
  const etages = b.moteur === 'etage' ? b.tiers.etages.length : 1;
  // Pour une toiture étagée, la pente du dernier palier ne suffit pas à la
  // décrire : c'est la SUITE des pentes qui fait la typologie (70/30 n'est pas
  // 30/70). On les réunit toutes.
  const m = b.model;
  if (!m) return { moteur: b.moteur, cle: 'ECHEC' };
  const k = {};
  for (const e of m.edges) k[e.kind] = (k[e.kind] ?? 0) + 1;
  const pans = m.pans.filter((p) => p.kind === 'pan' && p.aireProjetee > 1e-9);
  const pentes = b.moteur === 'etage'
    ? b.tiers.etages.map((e) => [...new Set(e.facettes.filter((f) => f.aireProjetee > 1e-9)
        .map((f) => +f.pente.toFixed(2)))].sort((x, y) => x - y).join('+'))
    : [...new Set(pans.map((p) => +p.pente.toFixed(3)))].sort((a, b2) => a - b2);
  const faite = b.moteur === 'etage' ? b.tiers.sommet : m.stats.faite;
  const aire = b.moteur === 'etage'
    ? b.tiers.audit.sommeAires
    : m.stats.aireProjetee;
  return {
    moteur: b.moteur, etages,
    pans: b.moteur === 'etage'
      ? b.tiers.etages.reduce((s, e) => s + e.facettes.filter((f) => f.aireProjetee > 1e-9).length, 0)
      : pans.length,
    pignons: m.pans.filter((p) => p.kind === 'pignon').length,
    pentes, arêtes: k,
    faite: +faite.toFixed(4), aire: +aire.toFixed(4),
    // l'élancement distingue une pagode d'un mansard mieux que le compte de pans
    elancement: +(faite / Math.sqrt(Math.max(aire, 1e-9))).toFixed(4),
    cle: `${b.moteur}|e${etages}|p${pans.length}|g${m.pans.filter((p) => p.kind === 'pignon').length}`
       + `|${pentes.join('/')}|${Object.entries(k).sort().map(([a, v]) => a[0] + v).join('')}`,
  };
}

/**
 * Chemin inverse : depuis un modèle construit à la main, retrouver le nom de
 * la famille. C'est ce qui permet à l'interface d'intituler un dessin libre.
 * Ne devine jamais : rend `null` et la raison quand rien ne correspond.
 */
export function classerForme(model, opts = {}) {
  // ANGLE MORT ASSUMÉ : un modèle S3 ne décrit qu'UN niveau. Le dernier palier
  // d'un mansard est, en lui-même, un authentique deux-pans — et le classifieur
  // répondrait « deux_pans » sans mentir, mais en trompant. Quand l'appelant
  // sait qu'il y a plusieurs paliers, il le dit, et on refuse de trancher.
  if ((opts.etages ?? 1) > 1) {
    return { id: null, etages: opts.etages, horsPortee: true,
      pourquoi: `${opts.etages} paliers : un modèle de pans ne porte pas l'étagement. `
        + `Le classement d'une toiture étagée se lit sur la suite des pentes, pas sur un niveau.` };
  }
  const pans = model.pans.filter((p) => p.kind === 'pan' && p.aireProjetee > 1e-9);
  const pignons = model.pans.filter((p) => p.kind === 'pignon').length;
  const k = {};
  for (const e of model.edges) k[e.kind] = (k[e.kind] ?? 0) + 1;
  const pentes = [...new Set(pans.map((p) => +p.pente.toFixed(2)))];
  const faitages = k.faitage ?? 0, noues = k.noue ?? 0, aretiers = k.aretier ?? 0;

  const dire = (id, pourquoi) => ({ id, label: FORMES[id]?.label ?? id, pourquoi,
    famille: FORMES[id]?.famille ?? null });

  if (pans.length === 0) return { id: null, pourquoi: 'aucun pan incliné — toit terrasse ou emprise dégénérée' };
  if (pans.length === 1) return dire('monopente',
    pentes[0] <= (opts.seuilTerrasse ?? 3) ? `un seul pan à ${pentes[0]}° — toit terrasse à faible pente` : `un seul pan à ${pentes[0]}°`);
  // « versants multiples » n'est PAS une entrée du catalogue : la complexité
  // vient de l'EMPRISE, pas de la recette (c'est allCroupe, comme le pavillon).
  // Le test F2 l'a démontré en trouvant la signature identique sur un rectangle.
  if (noues > 0) return { id: 'versants_multiples', label: 'Versants multiples (emprise en L, T, U…)',
    famille: 'pans', horsCatalogue: true,
    pourquoi: `${noues} noue(s) et ${faitages} faîtage(s) : l'emprise n'est pas convexe — `
      + `même recette que le pavillon, forme donnée par l'emprise` };
  if (pans.length === 2 && pignons === 2) {
    return pentes.length === 1
      ? dire('deux_pans', `2 pans à ${pentes[0]}°, 2 pignons, faîtage central`)
      : dire('deux_pans_asymetrique', `2 pans de pentes différentes (${pentes.join('° / ')}°) — faîtage décalé`);
  }
  if (pans.length === 3 && pignons === 1) return dire('trois_pans', '3 pans, 1 pignon, 2 arêtiers');
  if (pans.length >= 4 && pignons === 0 && faitages === 0 && aretiers === pans.length) {
    return dire('pyramide', `${pans.length} arêtiers convergents, pas de faîtage`);
  }
  if (pans.length === 4 && pignons === 0) return dire('quatre_pans', '4 pans, 4 arêtiers, 1 faîtage');
  if (pans.length > 4 && pignons === 0) return dire('pyramide', `${pans.length} pans convergents sur une emprise convexe à ${pans.length} côtés`);
  return { id: null, pourquoi: `${pans.length} pans, ${pignons} pignon(s), ${faitages} faîtage(s), `
    + `${noues} noue(s) — combinaison hors catalogue, à décrire par ses arêtes` };
}

// ═══ AUDIT DU CATALOGUE ═════════════════════════════════════════════════════

/**
 * Construit TOUTES les formes et vérifie que le catalogue tient debout :
 * chacune se construit, et deux formes distinctes ne rendent pas la même
 * signature. C'est la traduction testable de « on ne fait pas les toitures
 * redondantes ».
 */
export function auditCatalogue(footprint, opts = {}) {
  const resultats = [], echecs = [], doublons = [];
  const vues = new Map();

  for (const id of FORME_IDS) {
    let b;
    try { b = buildForme(id, footprint, opts.params?.[id] ?? {}); }
    catch (e) { echecs.push({ id, msg: e.message }); continue; }
    if (!b.ok) { echecs.push({ id, msg: (b.erreurs?.[0]?.msg) ?? 'audit rouge' }); }
    const sig = signatureForme(b);
    if (vues.has(sig.cle)) doublons.push({ a: vues.get(sig.cle), b: id, cle: sig.cle });
    else vues.set(sig.cle, id);
    resultats.push({ id, famille: FORMES[id].famille, moteur: b.moteur, ok: b.ok, sig });
  }

  const checks = [
    { id: 'F1_TOUTES_CONSTRUITES', ok: echecs.length === 0,
      detail: echecs.length ? echecs.map((e) => `${e.id} : ${e.msg}`).join(' · ') : `${resultats.length} formes` },
    { id: 'F2_AUCUNE_REDONDANTE', ok: doublons.length === 0,
      detail: doublons.length
        ? doublons.map((d) => `${d.a} ≡ ${d.b} (${d.cle})`).join(' · ')
        : `${vues.size} signatures distinctes pour ${resultats.length} formes` },
    { id: 'F3_TROIS_MOTEURS', ok: new Set(resultats.map((r) => r.moteur)).size === 3,
      detail: [...new Set(resultats.map((r) => r.moteur))].join(', ') },
    { id: 'F4_CLASSEMENT_RECIPROQUE', ok: true, detail: '' },
  ];

  // F4 · pour les formes à un seul niveau, le classifieur doit retrouver le nom
  const rates = [];
  for (const r of resultats) {
    if (r.moteur !== 'simple') continue;
    const b = buildForme(r.id, footprint, opts.params?.[r.id] ?? {});
    if (!b.model) continue;
    const c = classerForme(b.model);
    // `pyramide` et `quatre_pans` sont le même moteur : sur une emprise carrée
    // le squelette dégénère en un point et il n'y a pas de faîtage. Le
    // classifieur rend alors `pyramide`, ce qui est la bonne réponse.
    // `pyramide` et `quatre_pans` partagent la même recette : sur une emprise
    // à 4 côtés ils SONT la même toiture, et le classifieur a raison de ne pas
    // les distinguer. On l'écrit ici plutôt que de truquer la signature.
    const memeChose = (a, b2) => (a === 'quatre_pans' && b2 === 'pyramide') || (a === 'pyramide' && b2 === 'quatre_pans');
    if (c.id !== r.id && !memeChose(r.id, c.id)) {
      rates.push(`${r.id} → ${c.id ?? 'null'} (${c.pourquoi})`);
    }
  }
  checks[3].ok = rates.length === 0;
  checks[3].detail = rates.length ? rates.join(' · ') : 'chaque forme simple se reconnaît elle-même';

  return { ok: checks.every((c) => c.ok), checks, resultats, echecs, doublons };
}

/** Résumé lisible du catalogue. */
export function describeCatalogue(a) {
  const L = [`catalogue · ${a.resultats.length} formes en ${FAMILLES.length} familles`];
  for (const f of FAMILLES) {
    L.push(`  ${f} :`);
    for (const r of a.resultats.filter((x) => x.famille === f)) {
      L.push(`     ${r.ok ? '✓' : '✗'} ${r.id.padEnd(22)} ${String(r.moteur).padEnd(8)} ${r.sig.cle}`);
    }
  }
  for (const c of a.checks) L.push(`  ${c.ok ? '✓' : '✗'} ${c.id.padEnd(24)} ${c.detail}`);
  return L.join('\n');
}
