/**
 * Debug script — simule l'étude de capacité pour comprendre
 * pourquoi emprCiblePct=100 ne produit pas l'emprise max.
 *
 * Lancer depuis la console navigateur sur P07 :
 *   fetch('scripts/debug-capacity.js').then(r=>r.text()).then(eval)
 */
(function() {
  const PMC = window.PlanMasseCanvas;
  if (!PMC?._terrain) { console.error('PMC non initialisé'); return; }

  const t = PMC._terrain;
  const plu = t.plu;
  const sc = PMC.curSc();
  const env = PMC.computeEnv();
  const envPoly = env.poly;
  const envArea = window.polyArea?.(envPoly) ?? PMC._polyArea?.(envPoly) ?? 0;

  // Recalcul polyArea si non exposé
  function pArea(poly) {
    let a = 0;
    for (let i = 0, n = poly.length; i < n; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2;
  }
  const envA = envArea || pArea(envPoly);

  const FH = window.FootprintHelpers;
  const envXY = envPoly.map(p => FH?.toXY?.(p) ?? { x: p[0], y: p[1] });
  const envOBB = FH?.obb?.(envXY);

  const rtaaW = plu.rtaaZone === 1 ? 10 : 12;
  const profMax = PMC.S.prog.profMax ?? 15;
  const emprMax = plu.emprMax ?? 60;
  const permMin = plu.permMin ?? 25;
  const nvEffMax = PMC.nvMaxPLU();
  const parcelArea = t.area;
  const SP_MOY = 0.175 * 31 + 0.275 * 49 + 0.325 * 68 + 0.225 * 87;
  const H_NIV = 3;

  console.group('=== DEBUG CAPACITÉ P07 ===');
  console.log('Parcelle :', parcelArea.toFixed(0), 'm² · commune:', t.commune);
  console.log('PLU : emprMax', emprMax + '%', '· permMin', permMin + '%', '· heMax', plu.heMax + 'm', '· nvMax R+' + (nvEffMax - 1));
  console.log('RTAA largeur max :', rtaaW, 'm · profMax topo:', profMax, 'm');
  console.log('Stratégie courante :', sc.id, sc.label, '· strategy:', sc.strategy, '· eff:', sc.eff, '· emprFac:', sc.emprFac);
  console.log('Enveloppe : area', envA.toFixed(0), 'm²');
  if (envOBB) console.log('Enveloppe OBB : w', envOBB.w?.toFixed(1), '× l', envOBB.l?.toFixed(1), 'm · theta', (envOBB.theta * 180 / Math.PI).toFixed(1) + '°');

  // Ce que _applyScenarioGeometry calcule
  const cesMaxM2 = parcelArea * (emprMax / 100);
  const vegMin = parcelArea * (permMin / 100);
  const empriseDispo = Math.max(20, Math.min(cesMaxM2, parcelArea - vegMin));
  console.log('');
  console.log('── Calcul cible ──');
  console.log('cesMaxM2 (parcelle × emprMax%) :', cesMaxM2.toFixed(0), 'm²');
  console.log('vegMin (parcelle × permMin%) :', vegMin.toFixed(0), 'm²');
  console.log('empriseDispo (min cesMax, parc-veg) :', empriseDispo.toFixed(0), 'm²');

  // emprCiblePct = 100 → emprCibleFrac = 1.0
  const emprCiblePct = PMC.S.prog.emprCiblePct ?? 100;
  const emprCibleFrac = Math.max(0, Math.min(1, emprCiblePct / 100));
  const fac = sc.emprFac ?? 1;
  let cibleM2 = Math.max(15, empriseDispo * emprCibleFrac * fac);
  console.log('emprCiblePct :', emprCiblePct, '→ frac', emprCibleFrac.toFixed(2));
  console.log('sc.emprFac :', fac);
  console.log('cibleM2 brut (empriseDispo × frac × emprFac) :', cibleM2.toFixed(0), 'm²');

  // Cap permMin
  const maxImpermeab = parcelArea * (1 - permMin / 100);
  console.log('maxImpermeab (parc × (1-permMin%)) :', maxImpermeab.toFixed(0), 'm²');
  if (cibleM2 > maxImpermeab) {
    console.log('  → CLAMP à', maxImpermeab.toFixed(0), 'm² (permMin)');
    cibleM2 = maxImpermeab;
  }

  // Dimensions OBB
  if (envOBB) {
    const fillRatio = Math.min(1, cibleM2 / Math.max(envA, 1));
    const linearScale = Math.sqrt(fillRatio);
    let wTarget = envOBB.w * linearScale;
    let lTarget = envOBB.l * linearScale;
    console.log('');
    console.log('── Dimensionnement dans OBB ──');
    console.log('fillRatio (cibleM2 / envArea) :', fillRatio.toFixed(3));
    console.log('linearScale (√fillRatio) :', linearScale.toFixed(3));
    console.log('Avant caps : wTarget', wTarget.toFixed(1), '× lTarget', lTarget.toFixed(1), '=', (wTarget * lTarget).toFixed(0), 'm²');

    // Caps RTAA (mono-bloc)
    const effMono = ['rect', 'oblique', 'isohypses'].includes(sc.strategy);
    if (effMono) {
      const wCap = Math.min(rtaaW, envOBB.w * 0.95);
      const lCap = Math.min(profMax, envOBB.l * 0.95);
      console.log('Caps RTAA mono : wCap', wCap.toFixed(1), 'lCap', lCap.toFixed(1));
      if (wTarget > wCap) { lTarget *= (wCap / wTarget); wTarget = wCap; console.log('  → wTarget clampé →', wTarget.toFixed(1), '· lTarget ajusté →', lTarget.toFixed(1)); }
      if (lTarget > lCap) { wTarget *= (lCap / lTarget); lTarget = lCap; console.log('  → lTarget clampé →', lTarget.toFixed(1), '· wTarget ajusté →', wTarget.toFixed(1)); }
    }
    console.log('Après caps : wTarget', wTarget.toFixed(1), '× lTarget', lTarget.toFixed(1), '=', (wTarget * lTarget).toFixed(0), 'm²');

    // Escalade multi
    const monoCapM2 = Math.min(rtaaW, envOBB.w * 0.95) * Math.min(profMax, envOBB.l * 0.95);
    const gapInter = Math.max(plu.interBatMin || 4, sc.nv * H_NIV / 2);
    const canMultiFit = envOBB.l >= (Math.min(profMax, envOBB.l * 0.45) * 2 + gapInter);
    const escaladeMulti = effMono && cibleM2 > monoCapM2 * 0.85 && canMultiFit;
    console.log('');
    console.log('── Escalade multi ──');
    console.log('monoCapM2 (rtaaW × profMax, capé OBB) :', monoCapM2.toFixed(0), 'm²');
    console.log('cibleM2 > monoCapM2 × 0.85 ?', cibleM2.toFixed(0), '>', (monoCapM2 * 0.85).toFixed(0), '=', cibleM2 > monoCapM2 * 0.85);
    console.log('canMultiFit (OBB.l ≥ 2×profMax + gap) ?', envOBB.l.toFixed(1), '≥', (Math.min(profMax, envOBB.l * 0.45) * 2 + gapInter).toFixed(1), '=', canMultiFit);
    console.log('→ escaladeMulti :', escaladeMulti);

    // Résultats attendus
    const actualEmprise = PMC._totalBlocArea?.() ?? 0;
    const actualEmpPct = actualEmprise / parcelArea * 100;
    console.log('');
    console.log('── RÉSULTAT ──');
    console.log('Emprise réelle :', actualEmprise.toFixed(0), 'm² (' + actualEmpPct.toFixed(1) + '%)');
    console.log('Emprise max PLU :', cesMaxM2.toFixed(0), 'm² (' + emprMax + '%)');
    console.log('GAP :', (cesMaxM2 - actualEmprise).toFixed(0), 'm² non utilisés');
    console.log('');

    // === DIAGNOSTIC ===
    const problems = [];
    if (actualEmpPct < emprMax * 0.5) {
      if (wTarget * lTarget < cibleM2 * 0.5) {
        problems.push(`RTAA/profMax caps réduisent le rect à ${(wTarget * lTarget).toFixed(0)} m² (cible = ${cibleM2.toFixed(0)} m²). Solution: escalade multi ou stratégie zone/multi.`);
      }
      if (sc.emprFac < 0.8) {
        problems.push(`emprFac=${sc.emprFac} réduit la cible de ${((1 - sc.emprFac) * 100).toFixed(0)}%. Stratégie ${sc.id} pas prévue pour max densité.`);
      }
      if (!escaladeMulti && cibleM2 > monoCapM2) {
        problems.push(`Mono-bloc capé à ${monoCapM2.toFixed(0)} m² mais cible = ${cibleM2.toFixed(0)} m². Escalade multi bloquée (parcelle trop courte ou gap trop grand).`);
      }
    }
    if (problems.length) {
      console.log('%c── PROBLÈMES DÉTECTÉS ──', 'color:red;font-weight:bold');
      problems.forEach(p => console.log('%c  • ' + p, 'color:red'));
    } else {
      console.log('Pas de problème détecté dans la chaîne de calcul.');
    }
  }

  // === Simulation par stratégie ===
  console.log('');
  console.log('%c── CAPACITÉ MAX PAR STRATÉGIE (emprCiblePct=100) ──', 'color:blue;font-weight:bold');
  const table = [];
  for (const s of PMC._scenarios) {
    const effMono = ['rect', 'oblique', 'isohypses'].includes(s.strategy);
    const nvEff = Math.min(s.nv, nvEffMax);
    let maxFootprint;
    if (s.strategy === 'zone' || s.strategy === 'zoneHull') {
      maxFootprint = envA * (s.emprFac ?? 0.55);
    } else if (s.strategy === 'multi' || s.strategy === 'biBarre' || s.strategy === 'deuxLames' || s.strategy === 'troisLames') {
      maxFootprint = Math.min(empriseDispo, envA * 0.9) * (s.emprFac ?? 0.85);
    } else if (effMono && envOBB) {
      const wCap = Math.min(rtaaW, envOBB.w * 0.95);
      const lCap = Math.min(profMax, envOBB.l * 0.95);
      const monoMax = wCap * lCap;
      // Peut-on escalader en multi ?
      const gap = Math.max(plu.interBatMin || 4, s.nv * H_NIV / 2);
      const canMulti = envOBB.l >= (lCap * 2 + gap);
      if (canMulti && monoMax < empriseDispo * 0.85) {
        const nBlocs = Math.floor((envOBB.l + gap) / (lCap + gap));
        maxFootprint = Math.min(empriseDispo, monoMax * nBlocs) * (s.emprFac ?? 1);
      } else {
        maxFootprint = Math.min(empriseDispo, monoMax) * (s.emprFac ?? 1);
      }
    } else {
      maxFootprint = empriseDispo * (s.emprFac ?? 1);
    }
    // Cap permMin
    maxFootprint = Math.min(maxFootprint, maxImpermeab);
    const maxSP = maxFootprint * s.eff * nvEff;
    const maxLgts = Math.max(1, Math.floor(maxSP / SP_MOY));
    table.push({
      id: s.id, label: s.short, strategy: s.strategy,
      nv: 'R+' + (nvEff - 1), eff: s.eff, emprFac: s.emprFac,
      maxFootprint: Math.round(maxFootprint),
      maxEmpPct: (maxFootprint / parcelArea * 100).toFixed(1) + '%',
      maxSP: Math.round(maxSP),
      maxLgts,
    });
  }
  console.table(table);

  console.groupEnd();
})();
