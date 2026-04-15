// TERLAB · utils/coupe-renderer.js · v1.0
// ════════════════════════════════════════════════════════════════════════════
// Coupe N-S schématique avec gabarit PLU + toiture 2 pans.
//
// Règles impératives :
//   ✓ hé mesuré depuis le SOL AVAL (point le plus bas adjacent au bâtiment)
//   ✓ pente terrain lue dans la session (jamais hardcodée)
//   ✓ orientation amont/aval lue dans la session
//   ✓ hf = hé + (largeur_bat / 2) × pente_toiture
//   ✓ ES2022 pur, zéro dépendance externe
// ════════════════════════════════════════════════════════════════════════════

/**
 * Adapte une session TERLAB (forme réelle SessionManager._data) vers la forme
 * nominale attendue par buildCoupeSVGString. Lit les deux schémas pour rester
 * compatible avec d'éventuelles refactos futures du SessionManager.
 *
 * @param {object} raw  Session brute
 * @returns {object}    Session normalisée (terrain, plu, parcelle, esquisse)
 * @private
 */
// ── Classes de pente v4h (atlas-topographie-coupes-reunion) ────────────────
// profMax = profondeur bâtie max le long de la pente (m)
// pilotis  = typologie préconisée en pente forte
// mult     = coefficient coût indicatif
const TOPO_CLASSES = [
  { id: 'flat',   label: 'Plat',    maxPct: 5,   profMax: 15, pilotis: false, mult: 1.0, color: '#16a34a' },
  { id: 'gentle', label: 'Douce',   maxPct: 15,  profMax: 13, pilotis: false, mult: 1.1, color: '#65a30d' },
  { id: 'medium', label: 'Modérée', maxPct: 30,  profMax: 10, pilotis: true,  mult: 1.3, color: '#d97706' },
  { id: 'steep',  label: 'Forte',   maxPct: 50,  profMax: 8,  pilotis: true,  mult: 1.6, color: '#ea580c' },
  { id: 'xtrm',   label: 'Extrême', maxPct: 999, profMax: 6,  pilotis: true,  mult: 2.1, color: '#dc2626' },
];
function _topoClass(pct) {
  for (const t of TOPO_CLASSES) if (pct <= t.maxPct) return t;
  return TOPO_CLASSES[TOPO_CLASSES.length - 1];
}

function _normalize(raw) {
  if (!raw || typeof raw !== 'object') return {};

  // Phase data peut venir soit de raw.phases[i].data, soit déjà aplati
  const phase = (i) => raw?.phases?.[i]?.data ?? {};
  const p4 = phase(4);
  const p7 = phase(7);

  const terrainSrc  = raw.terrain ?? {};
  const pluSrc      = raw.plu     ?? {};
  const parcelleSrc = raw.parcelle ?? {};
  const esqSrc      = raw.esquisse ?? p7 ?? {};

  // Pente : préfère pente_moy (spec), fallback pente_moy_pct (TERLAB)
  const pente_moy =
    pluSrc.pente_moy ??
    terrainSrc.pente_moy ??
    terrainSrc.pente_moy_pct ??
    terrainSrc.pente_pct ??
    null;

  // Orientation amont (côté du point le plus haut)
  const orientation =
    terrainSrc.orientation ??
    terrainSrc.orientation_terrain ??
    terrainSrc.orientation_amont ??
    'N';

  // Hauteur PLU max
  const hauteur_max =
    pluSrc.hauteur_max ??
    p4.hauteur_max_m ??
    p4.hauteur_egout_m ??
    null;

  // Pente toiture (PLU)
  const pente_toiture_min =
    pluSrc.pente_toiture_min ??
    p4.pente_toiture_min_pct ??
    p4.pente_toiture_pct ??
    null;

  // Reculs PLU
  const recul_voirie =
    pluSrc.recul_voirie ??
    p4.recul_voie_m ??
    p4.recul_avant_m ??
    null;
  const recul_fond =
    pluSrc.recul_fond ??
    p4.recul_fond_m ??
    null;
  const recul_lateral =
    pluSrc.recul_lateral ??
    p4.recul_lateral_m ??
    null;

  // Zone PLU
  const zone =
    pluSrc.zone ??
    p4.zone_plu?.toString().split(' ')[0] ??
    terrainSrc.zone_plu?.toString().split(' ')[0] ??
    null;

  // Référence parcelle
  const reference =
    parcelleSrc.reference ??
    (terrainSrc.section && terrainSrc.parcelle
       ? `${terrainSrc.section} ${terrainSrc.parcelle}`
       : null);
  const commune = parcelleSrc.commune ?? terrainSrc.commune ?? null;

  // Altitude NGR
  const altitude_ngr =
    terrainSrc.altitude_ngr ??
    parcelleSrc.altitude_ngr ??
    null;

  // Esquisse : emprise/profondeur pour estimer la largeur N-S du bâtiment
  const emprise_m2 =
    esqSrc.emprise_m2 ??
    p7.emprise_m2 ??
    p7.surface_emprise_m2 ??
    null;
  const profondeur_m =
    esqSrc.profondeur_m ??
    p7.gabarit_w_m ??
    p7.profondeur_m ??
    null;
  const niveaux =
    esqSrc.niveaux ??
    p7.niveaux ??
    p4.niveaux_max ??
    2;

  return {
    terrain:  { pente_moy, orientation, altitude_ngr },
    plu:      { hauteur_max, pente_toiture_min, recul_voirie, recul_fond, recul_lateral, zone },
    parcelle: { reference, commune },
    esquisse: { emprise_m2, profondeur_m, niveaux },
  };
}

/**
 * Génère une string SVG de la coupe N-S avec toiture 2 pans.
 *
 * @param {object} sessionRaw    Session TERLAB (brute ou normalisée)
 * @param {object} [opts]
 * @param {number} [opts.width=760]      Largeur SVG px
 * @param {number} [opts.height=340]     Hauteur SVG px
 * @param {boolean}[opts.forPDF=false]   true → fond blanc, textes plus grands
 * @param {boolean}[opts.isDark=false]   Mode sombre (live preview)
 * @returns {string}  String SVG complète (sans balise <svg> englobante)
 */
export function buildCoupeSVGString(sessionRaw, opts = {}) {
  const session = _normalize(sessionRaw);

  // ── 1. EXTRACTION SESSION ────────────────────────────────────────────────

  const pente_pct  = session?.terrain?.pente_moy              ?? 3;    // %
  const orient     = session?.terrain?.orientation             ?? 'N';  // 'N' ou 'S'
  const heMax      = session?.plu?.hauteur_max                 ?? 9;    // m
  const pToit      = session?.plu?.pente_toiture_min           ?? 40;   // % (RTAA min 30%)
  const rV         = session?.plu?.recul_voirie                ?? 2;    // m
  const rF         = session?.plu?.recul_fond                  ?? 3;    // m
  const _rL        = session?.plu?.recul_lateral               ?? 3;    // m (réservé futur)
  const zone       = session?.plu?.zone                        ?? 'Uc';
  const ref        = session?.parcelle?.reference              ?? '—';
  const commune    = session?.parcelle?.commune                ?? '—';
  const altNGR     = session?.terrain?.altitude_ngr            ?? 0;
  const nivMax     = Math.max(1, Math.min(6, parseInt(session?.esquisse?.niveaux ?? 2)));
  const topoCls    = _topoClass(pente_pct);

  // Largeur bâtiment estimée depuis surface parcelle et emprise.
  // Fallback 9.3 m si données insuffisantes.
  const batM = (() => {
    const emprise = session?.esquisse?.emprise_m2;
    const profond = session?.esquisse?.profondeur_m;
    if (emprise && profond) return emprise / profond;
    return 9.3;
  })();

  const totM = rV + batM + rF; // portée totale N-S en mètres

  // ── 2. GÉOMÉTRIE SVG ────────────────────────────────────────────────────

  const W   = opts.width  ?? 760;
  const H   = opts.height ?? 340;
  const xN  = 62;                       // bord gauche (Nord)
  const xS  = W - 62;                   // bord droit  (Sud)
  const scW = (xS - xN) / totM;         // px/m horizontal
  const scH = 17.5;                     // px/m vertical
  const yRef = H - 78;                  // y sol aval de référence (px)
  const yVoie = H - 40;                 // y route

  const xV = xN + rV * scW;             // bord N bâtiment
  const xF = xV + batM * scW;           // bord S bâtiment
  const xC = (xV + xF) / 2;             // centre bâtiment

  // ── 3. TERRAIN PENTU ────────────────────────────────────────────────────
  // RÈGLE : orient='N' → amont au Nord → sol Nord plus haut que sol Sud
  //         orient='S' → amont au Sud  → sol Sud plus haut que sol Nord

  const drop_m   = totM * pente_pct / 100;      // dénivelé total N-S (m)
  const drop_px  = drop_m * scH;
  const yN_sol   = orient === 'N' ? yRef - drop_px : yRef;
  const yS_sol   = orient === 'S' ? yRef - drop_px : yRef;

  const yGround = x => yN_sol + (yS_sol - yN_sol) * (x - xN) / (xS - xN);

  const ygV = yGround(xV);   // sol côté voirie
  const ygF = yGround(xF);   // sol côté fond

  // ── 4. RÉFÉRENCE HÉ : SOL AVAL (point le plus bas = y le plus grand) ───
  //
  // ATTENTION : ne JAMAIS mesurer hé depuis le centre ou depuis un sol plat.
  // La règle PLU est : hé mesuré depuis le point de terrain naturel (ou fini)
  // le plus bas adjacent au bâtiment. Sur terrain pentu, c'est TOUJOURS le
  // côté aval (le plus bas physiquement).
  //
  const yAval  = Math.max(ygV, ygF);            // sol aval (y le plus grand = plus bas)
  const yEgout = yAval - heMax * scH;           // niveau égout (horizontal, PLU-conforme)

  // ── 5. TOITURE 2 PANS (défaut PDF) ──────────────────────────────────────
  //
  // Formule faîtage :  hf = hé + (largeur_bat / 2) × pente_toiture
  //                    rise_px = (batM / 2) × (pToit / 100) × scH
  //
  const rise_m  = (batM / 2) * (pToit / 100);  // surélévation faîtage (m)
  const rise_px = rise_m * scH;
  const yRidge  = yEgout - rise_px;             // y faîtage (px)
  const hf      = heMax + rise_m;               // hauteur totale au faîtage (m)

  // Débords (larmiers) : 0.5 m standard RTAA DOM
  const deb_px  = 0.5 * scW;

  // ── 6. PROFONDEUR FONDATIONS (adaptée à la pente) ───────────────────────
  const fondD_m  = pente_pct < 5  ? 0.40
                 : pente_pct < 15 ? 0.65
                 : pente_pct < 30 ? 1.00
                 :                  1.50;
  const fondD_px = fondD_m * scH;

  // ── 7. COULEURS ─────────────────────────────────────────────────────────
  // Physical scene → hex hardcodés (ne PAS utiliser CSS vars — SVG injecté via string)
  // Le theme 'earth' emprunte la branche dark (fond sombre terre).
  const forPDF  = opts.forPDF ?? false;
  const theme   = opts.theme ?? (typeof document !== 'undefined' ? (document.documentElement.dataset.theme || 'dark') : 'dark');
  const isDark  = opts.isDark ?? (theme === 'dark' || theme === 'earth');
  const bgFill  = forPDF ? '#f8f5ef' : (isDark ? '#1a1612' : '#f0ece0');
  const C = {
    sky:   forPDF ? '#f8f5ef' : (isDark ? '#1a1a22' : '#e8eef5'),
    terr:  'rgba(160,125,75,.28)',
    terrS: isDark ? 'rgba(200,160,100,.65)' : 'rgba(95,68,32,.62)',
    hatch: isDark ? 'rgba(200,160,100,.28)' : 'rgba(118,88,46,.32)',
    bat:   isDark ? 'rgba(180,162,132,.55)' : 'rgba(210,192,162,.78)',
    batS:  isDark ? 'rgba(200,165,110,.8)'  : 'rgba(128,95,48,.75)',
    roof:  isDark ? 'rgba(185,148,88,.75)'  : 'rgba(168,128,68,.78)',
    roofS: isDark ? 'rgba(200,148,55,.9)'   : 'rgba(112,72,22,.82)',
    floor: isDark ? 'rgba(200,165,110,.3)'  : 'rgba(128,95,48,.28)',
    fai:   isDark ? 'rgba(210,175,60,.85)'  : 'rgba(148,112,22,.85)',
    faiL:  isDark ? 'rgba(210,175,60,.5)'   : 'rgba(148,112,22,.5)',
    he:    isDark ? '#e04828' : '#9a2818',
    hf_c:  isDark ? '#c08020' : '#7a5010',
    vs:    isDark ? 'rgba(60,55,40,.35)'    : 'rgba(235,228,208,.72)',
    grVeg: 'rgba(60,110,40,.32)',
    road:  isDark ? 'rgba(50,45,38,.55)'    : 'rgba(105,95,78,.22)',
    roadS: isDark ? 'rgba(120,100,70,.5)'   : 'rgba(85,72,50,.38)',
    ink:   isDark ? '#d4c8a8' : '#3c2e18',
    inkL:  isDark ? '#a89878' : '#6b5c3e',
    inkLL: isDark ? '#887858' : '#9a8868',
    blue:  isDark ? '#6090d8' : '#1a4878',
    blueL: isDark ? 'rgba(96,144,216,.42)'  : 'rgba(26,72,120,.42)',
    ref_:  isDark ? 'rgba(80,140,200,.28)'  : 'rgba(26,72,120,.18)',
  };

  const FONT = "font-family='Inconsolata,monospace'";
  const fs   = forPDF ? 1.15 : 1.0;  // scale texte pour PDF

  // ── 8. CONSTRUCTION SVG ──────────────────────────────────────────────────

  let s = '';

  // Defs : hachures + marqueurs flèches
  s += `<defs>
    <pattern id="ht" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="5" stroke="${C.hatch}" stroke-width="1.3"/>
    </pattern>
    <marker id="aE" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
      <path d="M0 0L5 2.5L0 5" fill="none" stroke="${C.he}" stroke-width=".9"/>
    </marker>
    <marker id="aEs" markerWidth="5" markerHeight="5" refX="1" refY="2.5" orient="auto">
      <path d="M5 0L0 2.5L5 5" fill="none" stroke="${C.he}" stroke-width=".9"/>
    </marker>
    <marker id="aF" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
      <path d="M0 0L5 2.5L0 5" fill="none" stroke="${C.hf_c}" stroke-width=".9"/>
    </marker>
    <marker id="aFs" markerWidth="5" markerHeight="5" refX="1" refY="2.5" orient="auto">
      <path d="M5 0L0 2.5L5 5" fill="none" stroke="${C.hf_c}" stroke-width=".9"/>
    </marker>
    <marker id="aN" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
      <path d="M0 0L5 2.5L0 5" fill="none" stroke="${C.ink}" stroke-width=".8"/>
    </marker>
    <marker id="aNs" markerWidth="5" markerHeight="5" refX="1" refY="2.5" orient="auto">
      <path d="M5 0L0 2.5L5 5" fill="none" stroke="${C.ink}" stroke-width=".8"/>
    </marker>
  </defs>`;

  // Fond
  s += `<rect width="${W}" height="${H}" fill="${bgFill}"/>`;

  // Route
  s += `<rect x="0" y="${yVoie}" width="${W}" height="${H - yVoie}" fill="${C.road}"/>`;
  s += `<line x1="0" y1="${yVoie}" x2="${W}" y2="${yVoie}" stroke="${C.roadS}" stroke-width="1"/>`;
  const rLbl = orient === 'N' ? 'VOIE PUBLIQUE · aval (sud)' : 'VOIE PUBLIQUE · aval (nord)';
  s += `<text x="${W/2}" y="${yVoie + 13}" text-anchor="middle" ${FONT} font-size="${8*fs}" fill="${C.inkLL}" letter-spacing=".1em">${rLbl}</text>`;

  // Terrain — polygone sol + ligne de surface
  const ygN0 = yGround(0);
  const ygW  = yGround(W);
  s += `<path d="M0,${ygN0} L${W},${ygW} L${W},${yVoie} L0,${yVoie} Z" fill="${C.terr}"/>`;
  s += `<path d="M0,${ygN0} L${W},${ygW}" fill="none" stroke="${C.terrS}" stroke-width="1.8"/>`;
  // Herbe
  s += `<path d="M0,${ygN0} L${W},${ygW} L${W},${ygW+5} L0,${ygN0+5} Z" fill="${C.grVeg}"/>`;

  // Hachures sol sous bâtiment
  s += `<path d="M${xV-8},${ygV} L${xF+8},${ygF} L${xF+8},${yVoie} L${xV-8},${yVoie} Z"
        fill="url(#ht)" opacity=".75"/>`;

  // Fondations (rectangles fondation)
  [{ x: xV, yg: ygV }, { x: xF, yg: ygF }].forEach(({ x, yg }) => {
    s += `<rect x="${x - 5}" y="${yg}" width="10" height="${fondD_px}"
          fill="${C.batS}" opacity=".5" stroke="${C.batS}" stroke-width=".7"/>`;
    // hachures fondation
    for (let hx = x - 4; hx < x + 4; hx += 2.5) {
      s += `<line x1="${hx}" y1="${yg}" x2="${hx - 1.5}" y2="${yg + fondD_px}"
            stroke="${C.hatch}" stroke-width=".5"/>`;
    }
  });

  // Vide sanitaire (visible si pente < 12 %)
  if (pente_pct < 12) {
    s += `<path d="M${xV},${ygV} L${xF},${ygF} L${xF},${Math.min(ygV,ygF)} L${xV},${Math.min(ygV,ygF)} Z"
          fill="${C.vs}" stroke="${C.hatch}" stroke-width=".7" stroke-dasharray="5,3"/>`;
    if (pente_pct < 8) {
      s += `<text x="${xC}" y="${(ygV+ygF)/2 + 4}" text-anchor="middle" ${FONT}
            font-size="${7*fs}" fill="${C.inkL}" font-style="italic">vide sanitaire</text>`;
    }
  }

  // Corps bâtiment (trapèze : base suit le terrain, sommet horizontal à yEgout)
  s += `<polygon points="${xV},${yEgout} ${xF},${yEgout} ${xF},${ygF} ${xV},${ygV}"
        fill="${C.bat}" stroke="${C.batS}" stroke-width="1.5"/>`;

  // Refend central
  s += `<line x1="${xC}" y1="${yEgout}" x2="${xC}" y2="${yAval}"
        stroke="${C.floor}" stroke-width=".8" opacity=".6"/>`;

  // Planchers intérieurs — niveaux dynamiques (R+1 .. R+nivMax-1)
  for (let n = 1; n < nivMax; n++) {
    const yFloor = yAval - n * 3 * scH;
    if (yFloor > yEgout + 10 && yFloor < yAval - 6) {
      s += `<line x1="${xV}" y1="${yFloor}" x2="${xF}" y2="${yFloor}"
            stroke="${C.floor}" stroke-width=".9" stroke-dasharray="3,2"/>`;
      const lvl = `R+${n}`;
      s += `<line x1="${xV - 14}" y1="${yFloor}" x2="${xV}" y2="${yFloor}"
            stroke="rgba(74,54,125,.3)" stroke-width=".7" stroke-dasharray="3,2"/>`;
      s += `<text x="${xV - 16}" y="${yFloor + 3}" text-anchor="end" ${FONT}
            font-size="${7.5*fs}" fill="rgba(74,54,125,.8)" font-weight="500">${lvl}</text>`;
    }
  }
  // RdC
  s += `<line x1="${xV - 14}" y1="${yAval}" x2="${xV}" y2="${yAval}"
        stroke="rgba(74,54,125,.35)" stroke-width=".7" stroke-dasharray="3,2"/>`;
  s += `<text x="${xV - 16}" y="${yAval + 3}" text-anchor="end" ${FONT}
        font-size="${7.5*fs}" fill="rgba(74,54,125,.85)" font-weight="500">RdC ±0</text>`;

  // ── TOITURE 2 PANS ───────────────────────────────────────────────────────
  // Triangle : (xV, yEgout) → (xC, yRidge) → (xF, yEgout)
  // + débords larmiers ~0.5 m de chaque côté
  s += `<polygon points="${xV},${yEgout} ${xC},${yRidge} ${xF},${yEgout}"
        fill="${C.roof}" stroke="${C.roofS}" stroke-width="1.8"/>`;

  // Larmiers (débords)
  s += `<line x1="${xV - deb_px}" y1="${yEgout + 9}" x2="${xV}" y2="${yEgout}"
        stroke="${C.roofS}" stroke-width="1.2"/>`;
  s += `<line x1="${xF}" y1="${yEgout}" x2="${xF + deb_px}" y2="${yEgout + 9}"
        stroke="${C.roofS}" stroke-width="1.2"/>`;

  // Point faîtage
  s += `<circle cx="${xC}" cy="${yRidge}" r="3.5" fill="${C.roofS}"/>`;

  // Annotation pente toiture sur le pan gauche (N→C)
  const angT    = (Math.atan(pToit / 100) * 180 / Math.PI).toFixed(0);
  const midPanX = (xV + xC) / 2;
  const midPanY = (yEgout + yRidge) / 2;
  s += `<text x="${midPanX - 5}" y="${midPanY}" text-anchor="end" ${FONT}
        font-size="${7.5*fs}" fill="${C.roofS}" font-style="italic">${pToit}% (${angT}°)</text>`;

  // Points égout (cercles rouges)
  s += `<circle cx="${xV}" cy="${yEgout}" r="4" fill="${C.he}" opacity=".85"/>`;
  s += `<circle cx="${xF}" cy="${yEgout}" r="4" fill="${C.he}" opacity=".85"/>`;

  // ── LIGNE FAÎTAGE PLU MAX (hé limite) ────────────────────────────────────
  s += `<line x1="${xN - 18}" y1="${yEgout}" x2="${xS + 18}" y2="${yEgout}"
        stroke="${C.fai}" stroke-width="1.1" stroke-dasharray="10,5" opacity=".75"/>`;
  s += `<text x="${xS + 22}" y="${yEgout + 3}" ${FONT}
        font-size="${8*fs}" fill="${C.fai}" font-weight="500">hé max PLU ${heMax}m</text>`;
  s += `<text x="${xS + 22}" y="${yEgout + 13}" ${FONT}
        font-size="${7*fs}" fill="${C.faiL}">/ sol aval · Zone ${zone}</text>`;

  // ── COTATIONS HÉ ET HF (côté droit) ─────────────────────────────────────
  const xCot = xF + 28;

  // Trait de rappel sol aval et égout
  s += `<line x1="${xF}" y1="${yAval}" x2="${xCot + 4}" y2="${yAval}"
        stroke="${C.he}" stroke-width=".7" stroke-dasharray="3,2"/>`;
  s += `<line x1="${xF}" y1="${yEgout}" x2="${xCot + 4}" y2="${yEgout}"
        stroke="${C.he}" stroke-width=".7" stroke-dasharray="3,2"/>`;

  // Flèche double hé
  s += `<line x1="${xCot}" y1="${yAval - 2}" x2="${xCot}" y2="${yEgout + 2}"
        stroke="${C.he}" stroke-width="1.1"
        marker-end="url(#aE)" marker-start="url(#aEs)"/>`;
  s += `<text x="${xCot + 5}" y="${(yAval + yEgout) / 2 + 3}" ${FONT}
        font-size="${9.5*fs}" fill="${C.he}" font-weight="500">hé ${heMax}m</text>`;

  // Flèche double hf (depuis sol aval)
  const xCotF = xCot + 42;
  s += `<line x1="${xC}" y1="${yRidge}" x2="${xCotF + 4}" y2="${yRidge}"
        stroke="${C.hf_c}" stroke-width=".7" stroke-dasharray="3,2"/>`;
  s += `<line x1="${xCotF}" y1="${yAval - 2}" x2="${xCotF}" y2="${yRidge + 2}"
        stroke="${C.hf_c}" stroke-width="1.1"
        marker-end="url(#aF)" marker-start="url(#aFs)"/>`;
  s += `<text x="${xCotF + 5}" y="${(yAval + yRidge) / 2 + 3}" ${FONT}
        font-size="${9.5*fs}" fill="${C.hf_c}" font-weight="500">hf ${hf.toFixed(1)}m</text>`;

  // Label faîtage
  s += `<text x="${xC}" y="${yRidge - 10}" text-anchor="middle" ${FONT}
        font-size="${8*fs}" fill="${C.fai}" font-weight="500">faîtage</text>`;

  // Labels égout
  s += `<text x="${xV - 5}" y="${yEgout - 6}" text-anchor="end" ${FONT}
        font-size="${7.5*fs}" fill="${C.he}">égout N</text>`;
  s += `<text x="${xF + 5}" y="${yEgout - 6}" ${FONT}
        font-size="${7.5*fs}" fill="${C.he}">égout S</text>`;

  // ── POINT DE RÉFÉRENCE SOL AVAL ──────────────────────────────────────────
  const xRefDot = orient === 'N' ? xF : xV;  // côté aval
  s += `<circle cx="${xRefDot}" cy="${yAval}" r="5.5" fill="${C.blue}" opacity=".8"/>`;
  s += `<line x1="${xN}" y1="${yAval}" x2="${xRefDot - 6}" y2="${yAval}"
        stroke="${C.blueL}" stroke-width=".8" stroke-dasharray="6,4"/>`;
  s += `<text x="${xN - 2}" y="${yAval + 3}" text-anchor="end" ${FONT}
        font-size="${8*fs}" fill="${C.blue}" font-weight="500">sol aval ±0.00</text>`;
  s += `<text x="${xN - 2}" y="${yAval + 13}" text-anchor="end" ${FONT}
        font-size="${7*fs}" fill="${C.blue}">NGR ${Number(altNGR).toFixed(1)} m</text>`;

  // ── PENTE TERRAIN (annotation oblique) ───────────────────────────────────
  if (pente_pct > 0) {
    const midXT = (xV + xN) / 2;
    const midYT = yGround(midXT) - 10;
    const angSite = (Math.atan(pente_pct / 100) * 180 / Math.PI).toFixed(1);
    s += `<text x="${midXT}" y="${midYT}" text-anchor="middle" ${FONT}
          font-size="${8*fs}" fill="${C.inkL}" font-style="italic">${pente_pct}% (${angSite}°)</text>`;
  }

  // ── RECULS BASSE (cotations sous voie) ───────────────────────────────────
  const yCot = yVoie + 16;
  [
    { x1: xN, x2: xV, lbl: `V ${rV}m` },
    { x1: xV, x2: xF, lbl: `bat. ~${batM.toFixed(1)}m`, dash: true },
    { x1: xF, x2: xS, lbl: `F ${rF}m` },
  ].forEach(({ x1, x2, lbl, dash }) => {
    const mid = (x1 + x2) / 2;
    s += `<line x1="${x1}" y1="${yCot - 4}" x2="${x1}" y2="${yCot + 4}"
          stroke="${C.ink}" stroke-width="1.2"/>`;
    s += `<line x1="${x2}" y1="${yCot - 4}" x2="${x2}" y2="${yCot + 4}"
          stroke="${C.ink}" stroke-width="1.2"/>`;
    s += `<line x1="${x1 + 2}" y1="${yCot}" x2="${x2 - 2}" y2="${yCot}"
          stroke="${dash ? C.batS : C.ink}" stroke-width=".9"
          ${dash ? 'stroke-dasharray="4,2"' : ''}
          marker-end="url(#aN)" marker-start="url(#aNs)"/>`;
    s += `<text x="${mid}" y="${yCot + 13}" text-anchor="middle" ${FONT}
          font-size="${8.5*fs}" fill="${dash ? C.batS : C.ink}" font-weight="500">${lbl}</text>`;
  });

  // ── BADGE CLASSE TOPO (profMax + pilotis + coût) ─────────────────────────
  const badgeY = 24;
  s += `<rect x="${xN}" y="${badgeY}" width="230" height="18" rx="2"
        fill="${topoCls.color}22" stroke="${topoCls.color}66" stroke-width=".8"/>`;
  s += `<text x="${xN + 6}" y="${badgeY + 13}" ${FONT} font-size="${8.5*fs}"
        fill="${topoCls.color}" font-weight="600" letter-spacing=".04em">${topoCls.label} · ${pente_pct}% · profMax ${topoCls.profMax}m · ×${topoCls.mult.toFixed(1)} coût${topoCls.pilotis ? ' · PILOTIS' : ''}</text>`;

  // ── LIGNE profMax (profondeur bâtie max le long de la pente) ─────────────
  if (batM > topoCls.profMax + 0.5) {
    const excedent = batM - topoCls.profMax;
    const xLimit = xV + topoCls.profMax * scW;
    s += `<line x1="${xLimit}" y1="${yEgout - 18}" x2="${xLimit}" y2="${yAval + 6}"
          stroke="${C.he}" stroke-width="1.3" stroke-dasharray="4,3" opacity=".85"/>`;
    s += `<text x="${xLimit}" y="${yEgout - 22}" text-anchor="middle" ${FONT}
          font-size="${7.5*fs}" fill="${C.he}" font-weight="600">profMax ${topoCls.profMax}m · ⚠ +${excedent.toFixed(1)}m</text>`;
  }

  // ── LABELS N / S ─────────────────────────────────────────────────────────
  const amontN = orient === 'N' ? '↑ N · amont' : '↑ N · aval';
  const amontS = orient === 'S' ? 'S · amont ↓' : 'S · aval ↓';
  s += `<text x="${xN + 4}" y="14" ${FONT} font-size="${9*fs}" fill="${C.ink}" font-weight="500">${amontN}</text>`;
  s += `<text x="${xS - 4}" y="14" text-anchor="end" ${FONT} font-size="${9*fs}" fill="${C.ink}" font-weight="500">${amontS}</text>`;

  // Titre
  const titre = `COUPE N-S · ${ref} ${commune} · Zone ${zone} · pente ${pente_pct}% · Toiture 2 pans ${pToit}%`;
  s += `<text x="${W / 2}" y="14" text-anchor="middle" ${FONT}
        font-size="${8.5*fs}" fill="rgba(42,88,72,.85)" font-weight="500"
        letter-spacing=".05em">${titre}</text>`;

  // Échelle graphique
  const escX = xN, escY = yCot + 25;
  const escStep = scW * 2;  // tous les 2 m
  for (let i = 0; i <= 4; i++) {
    const xi = escX + i * escStep;
    s += `<line x1="${xi}" y1="${escY - 3}" x2="${xi}" y2="${escY + 3}"
          stroke="${C.ink}" stroke-width=".8"/>`;
    s += `<text x="${xi}" y="${escY + 12}" text-anchor="middle" ${FONT}
          font-size="${7*fs}" fill="${C.inkL}">${i * 2}m</text>`;
  }
  s += `<line x1="${escX}" y1="${escY}" x2="${escX + 4 * escStep}" y2="${escY}"
        stroke="${C.ink}" stroke-width="1"/>`;

  return s;
}

/**
 * Retourne une string SVG complète (avec balise <svg>) prête à être injectée
 * comme document SVG autonome (Blob, dataURL, img.src).
 *
 * @param {object} session
 * @param {object} [opts]
 * @returns {string}
 */
export function buildCoupeSVGDocument(session, opts = {}) {
  const W = opts.width  ?? 760;
  const H = opts.height ?? 340;
  const inner = buildCoupeSVGString(session, { ...opts, width: W, height: H });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${inner}</svg>`;
}

/**
 * Injecte la coupe dans un élément SVG du DOM existant.
 *
 * @param {SVGElement|string} container  Élément SVG ou id
 * @param {object}            session
 * @param {object}            [opts]
 */
export function drawCoupeSVG(container, session, opts = {}) {
  const el = typeof container === 'string'
    ? document.getElementById(container)
    : container;
  if (!el) { console.warn('[coupe-renderer] conteneur introuvable'); return; }

  const W = el.viewBox?.baseVal?.width  || el.clientWidth  || 760;
  const H = el.viewBox?.baseVal?.height || el.clientHeight || 340;
  el.innerHTML = buildCoupeSVGString(session, { ...opts, width: W, height: H });
}

export default { buildCoupeSVGString, buildCoupeSVGDocument, drawCoupeSVG };
