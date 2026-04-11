// TERLAB · giep-calculator-service.js · Calculs hydrauliques GIEP
// Méthode rationnelle adaptée Réunion — porté depuis simulateur.js GIEP
// Sources : DEAL Réunion 2012, méthodes Kirpich/Caquot/Sogreah
// ENSA La Réunion · MGA Architecture

import {
  ZONES_CLIMATIQUES, COEFFS_INITIAL, COEFFS_PROJET,
  estimerPenteParAltitude
} from './reunion-constants.js';

const GIEPCalculator = {

  // ── Coefficient de ruissellement état initial ─────────────────────
  // Source : simulateur.js GIEP L.152–175
  computeCoeffInitial(surfaces, altitude = 0, exposition = 'neutre') {
    const coeff = (
      (parseFloat(surfaces.pctTresBoise ?? 0))     * COEFFS_INITIAL.tresBoise +
      (parseFloat(surfaces.pctBoise ?? 0))          * COEFFS_INITIAL.boise +
      (parseFloat(surfaces.pctSavane ?? 0))         * COEFFS_INITIAL.savane +
      (parseFloat(surfaces.pctCanne ?? 0))          * COEFFS_INITIAL.canne +
      (parseFloat(surfaces.pctAride ?? 0))          * COEFFS_INITIAL.aride +
      (parseFloat(surfaces.pctConstructions ?? 0))  * COEFFS_INITIAL.constructions
    ) / 100;

    // Facteurs correctifs Guide DEAL (source simulateur.js L.162–171)
    let facteurAltitude = 1.0;
    if (altitude < 200)       facteurAltitude = 1.1;
    else if (altitude >= 600 && altitude < 1200) facteurAltitude = 0.9;
    else if (altitude >= 1200) facteurAltitude = 0.8;

    let facteurExposition = 1.0;
    if (exposition === 'auVent')    facteurExposition = 0.85;
    else if (exposition === 'sousVent') facteurExposition = 1.15;

    return coeff * facteurAltitude * facteurExposition;
  },

  // ── Coefficient de ruissellement état projet ──────────────────────
  // Source : simulateur.js GIEP L.177–192
  computeCoeffFinal(surfaces) {
    return (
      (parseFloat(surfaces.pctToitureVersant ?? 0))     * COEFFS_PROJET.toitureVersant +
      (parseFloat(surfaces.pctToitureVegetalisee ?? 0)) * COEFFS_PROJET.toitureVegetalisee +
      (parseFloat(surfaces.pctVoirie ?? 0))             * COEFFS_PROJET.voirie +
      (parseFloat(surfaces.pctSemiPerm ?? 0))           * COEFFS_PROJET.semiPerm +
      (parseFloat(surfaces.pctEspacesVerts ?? 0))       * COEFFS_PROJET.espacesVerts
    ) / 100;
  },

  // ── Temps de concentration — 3 méthodes DEAL 2012 ────────────────
  // Source : simulateur.js GIEP L.194–234
  computeTC(longueur_m, pente_pct, surface_m2, coeffFinal, longueurTerrain, largeurTerrain) {
    const L_m   = Math.max(longueur_m, 10);
    const L_km  = L_m / 1000;
    const i_dec = Math.max(pente_pct, 0.1) / 100;
    const S_ha  = surface_m2 / 10000;
    const C     = coeffFinal || 0.6;

    // 1. Kirpich (source DEAL 2012)
    const tc_kirpich = 0.0195 * Math.pow(L_m, 0.77) / Math.pow(i_dec, 0.385);

    // 2. Caquot
    const tc_caquot = 0.0195 * Math.pow(Math.pow(L_km, 2) / Math.sqrt(i_dec), 0.385) * 60;

    // 3. Sogreah avec facteur morphologique
    const rapport = Math.max(longueurTerrain || L_m, largeurTerrain || L_m * 0.5)
                  / Math.min(longueurTerrain || L_m, largeurTerrain || L_m * 0.5);
    let K_morpho;
    if (rapport > 2.0) K_morpho = 0.127;
    else if (rapport > 1.5) K_morpho = 0.105;
    else K_morpho = 0.085;

    const tc_sogreah = K_morpho * Math.pow(S_ha / C, 0.35) * Math.pow(i_dec, -0.5) * 60;

    const tc_moyen = (tc_kirpich + tc_caquot + tc_sogreah) / 3;
    const tc_final = Math.max(6, Math.min(120, tc_moyen));

    const morphologie = rapport > 2.0 ? 'très allongé' : rapport > 1.5 ? 'allongé' : 'ramassé';

    return {
      tc: tc_final,
      kirpich: tc_kirpich,
      caquot: tc_caquot,
      sogreah: tc_sogreah,
      morphologie,
      K_morpho,
    };
  },

  // ── Intensité de pluie (Montana IDF) ──────────────────────────────
  // Source : simulateur.js GIEP L.237–267
  computeIntensity(zone, periodeRetour, tc_min, sourceIntensites = 'deal2012') {
    const z = ZONES_CLIMATIQUES[zone];
    if (!z) return 220; // fallback

    let iBase_1h;
    if (sourceIntensites === 'deal2012') {
      iBase_1h = periodeRetour >= 20 ? z.i20_deal : z.i10_deal;
    } else {
      iBase_1h = periodeRetour >= 20 ? z.i20 : z.i10;
    }

    const tc_h = tc_min / 60;
    const facteur_d = Math.pow(tc_h, -0.33);
    return iBase_1h * facteur_d;
  },

  // ── Débits de pointe — méthode rationnelle Q = 0.278 × C × I × S ─
  // Source : simulateur.js GIEP L.269–279 (résultat en L/s)
  computeDebitPointe(surface_m2, coeff, intensite_mmh) {
    const surface_ha = surface_m2 / 10000;
    return 0.278 * coeff * intensite_mmh * surface_ha; // L/s
  },

  // ── Surface d'infiltration nécessaire ─────────────────────────────
  // Source : simulateur.js GIEP L.281–317
  computeSurfaceInfiltration(surface_m2, zone, coeffFinal, intensite, tc_min, pctEspacesVerts, zeroRejet = true) {
    const z = ZONES_CLIMATIQUES[zone];
    if (!z) return null;

    const S_ha  = surface_m2 / 10000;
    const tc_h  = tc_min / 60;

    const V_in  = intensite * tc_h * S_ha * coeffFinal * 10; // m³
    const q_lim_Ls = zeroRejet ? 0 : z.qref * S_ha;
    const V_out = q_lim_Ls * (tc_h * 3600) / 1000;          // m³
    const V_net = Math.max(0, V_in - V_out);

    const k_eff_mph = (z.k * 0.5) / 1000; // perméabilité effective m/h
    const h_p_moy   = 0.25;               // hauteur piézométrique moyenne m
    const duree_h   = 24;                  // durée d'infiltration h

    const A_inf  = V_net / (h_p_moy + k_eff_mph * duree_h); // m²
    const A_EV   = surface_m2 * pctEspacesVerts / 100;
    const deficit = A_inf - A_EV;

    return { V_in, V_out, V_net, A_inf, A_dispo: A_EV, deficit };
  },

  // ── Score GIEP (peut être négatif si Q_final > Q_init = aggravation) ─
  // Plafonné à 100 mais PAS planché à 0 : un score < 0 signifie que le projet
  // aggrave le ruissellement par rapport à l'état naturel (terrain végétalisé
  // imperméabilisé). Le label "Aggravation" est appliqué dans computeFromSession.
  computeScoreGIEP(debitInitial, debitFinal) {
    if (!debitInitial || debitInitial <= 0) return 0;
    return Math.min(100, Math.round((1 - debitFinal / debitInitial) * 100));
  },

  // ── Label + couleur depuis le score (gère le cas négatif) ─────────
  _labelFromScore(score) {
    if (score < 0)        return { label: 'Aggravation', color: 'var(--danger)' };
    if (score >= 70)      return { label: 'Excellent',   color: 'var(--success)' };
    if (score >= 50)      return { label: 'Bon',         color: 'var(--accent)' };
    if (score >= 30)      return { label: 'Moyen',       color: 'var(--warning)' };
    return                       { label: 'Insuffisant', color: 'var(--danger)' };
  },

  // ── Calcul complet depuis la session TERLAB ───────────────────────
  // opts (optionnel, pour simulation) :
  //   - mesuresOverride : string[]  → remplace p8.giep_mesures (ex. best-case)
  //   - pctBatiOverride : number    → remplace l'emprise dérivée du gabarit P7
  computeFromSession(sessionData, opts = {}) {
    const terrain = sessionData?.terrain ?? {};
    const p7 = sessionData?.phases?.[7]?.data ?? {};
    const p8 = sessionData?.phases?.[8]?.data ?? {};

    const surface = parseFloat(terrain.contenance_m2 ?? 0);
    if (surface <= 0) return null;

    const zone    = terrain.zone_climatique ?? 'littoral_ouest_sec';
    const alt     = parseFloat(terrain.altitude_ngr ?? terrain.altitude ?? 0);
    const pente   = parseFloat(terrain.pente_moy_pct ?? estimerPenteParAltitude(alt));
    const longueurTerrain = parseFloat(terrain.largeur_m ?? Math.sqrt(surface));
    const largeurTerrain  = parseFloat(terrain.longueur_m ?? Math.sqrt(surface) * 0.7);
    const longueur_hydr   = Math.sqrt(longueurTerrain ** 2 + largeurTerrain ** 2);

    // Surfaces initiales depuis OBIA (Phase 6) ou défauts
    const obia = terrain.obia_surfaces ?? {
      pctTresBoise: 0, pctBoise: 20, pctSavane: 30,
      pctCanne: 10, pctAride: 0, pctConstructions: 40
    };

    // Surfaces projet depuis Phase 7 + Phase 8 (ou overrides de simulation)
    const surfaceProjet = parseFloat(p7.gabarit_l_m ?? 10) * parseFloat(p7.gabarit_w_m ?? 8);
    const pctBatiBase = surface > 0 ? (surfaceProjet / surface) * 100 : 40;
    const pctBati = opts.pctBatiOverride != null ? opts.pctBatiOverride : pctBatiBase;
    const giepMesures = opts.mesuresOverride ?? p8.giep_mesures ?? [];

    const surfacesFinales = {
      pctToitureVersant:     Math.max(0, pctBati - (giepMesures.includes('toiture_verte') ? 15 : 0)),
      pctToitureVegetalisee: giepMesures.includes('toiture_verte') ? 15 : 0,
      pctVoirie:             5,
      pctSemiPerm:           giepMesures.includes('pave_drainant') ? 10 : 0,
      pctEspacesVerts:       Math.max(0, 100 - pctBati - 5),
    };

    const coeffInit  = this.computeCoeffInitial(obia, alt);
    const coeffFinal = this.computeCoeffFinal(surfacesFinales);

    const tcResult = this.computeTC(longueur_hydr, pente, surface, coeffFinal, longueurTerrain, largeurTerrain);
    const intensite = this.computeIntensity(zone, 10, tcResult.tc, 'deal2012');

    const debitInit  = this.computeDebitPointe(surface, coeffInit, intensite);
    const debitFinal = this.computeDebitPointe(surface, coeffFinal, intensite);
    const score      = this.computeScoreGIEP(debitInit, debitFinal);

    const infiltration = this.computeSurfaceInfiltration(
      surface, zone, coeffFinal, intensite, tcResult.tc,
      surfacesFinales.pctEspacesVerts
    );

    const lbl = this._labelFromScore(score);

    return {
      zone,
      zone_nom: ZONES_CLIMATIQUES[zone]?.nom ?? zone,
      intensite_T10: Math.round(intensite),
      tc: tcResult.tc.toFixed(1),
      tc_kirpich: tcResult.kirpich.toFixed(1),
      tc_caquot: tcResult.caquot.toFixed(1),
      tc_sogreah: tcResult.sogreah.toFixed(1),
      tc_morphologie: tcResult.morphologie,
      coeffInit: coeffInit.toFixed(3),
      coeffFinal: coeffFinal.toFixed(3),
      debitInit: debitInit.toFixed(1),
      debitFinal: debitFinal.toFixed(1),
      reduction_pct: debitInit > 0 ? Math.round((1 - debitFinal / debitInit) * 100) : 0,
      score,
      scoreLabel: lbl.label,
      scoreColor: lbl.color,
      pctBati:     +pctBati.toFixed(1),
      pctBatiBase: +pctBatiBase.toFixed(1),
      mesuresActives: [...giepMesures],
      infiltration,
      ouvrages: this._recommandOuvrages(debitInit - debitFinal, surface, giepMesures),
      source_note: 'Méthode rationnelle · Kirpich/Caquot/Sogreah · Intensités DEAL Réunion 2012',
    };
  },

  // ── Score potentiel : toutes les mesures GIEP activées ────────────
  // Utilisé par le widget pour montrer "où tu pourrais aller sans rien changer
  // au gabarit". Note : seules toiture_verte et pave_drainant influencent
  // actuellement le coefficient final (noue/citerne sont des "ouvrages
  // recommandés" calculés en aval, sans entrée dans surfacesFinales).
  computeBestCaseFromSession(sessionData) {
    return this.computeFromSession(sessionData, {
      mesuresOverride: ['toiture_verte', 'pave_drainant', 'noue_infiltration', 'citerne_ep'],
    });
  },

  // ── Optimiseur greedy : mesures + emprise pour atteindre une cible ─
  // Stratégie pédagogique TERLAB :
  //   1. Si déjà au-dessus → rien à faire
  //   2. Sinon, activer toutes les mesures GIEP et re-tester
  //   3. Sinon, réduire progressivement l'emprise (pas de 1%) jusqu'à 5% mini
  //   4. Si cible inatteignable et target > 30 → fallback à 30 ("Moyen")
  //   5. Sinon retourner reached:false avec message explicatif
  // Cible par défaut = 50 ("Bon") : ambition GIEP réelle qui force l'arbitrage
  // densité ↔ hydrologie. Inatteignable sur terrain naturel sans réduire
  // l'emprise — c'est précisément le débat que le studio veut provoquer.
  suggestImprovements(sessionData, targetScore = 50) {
    const current = this.computeFromSession(sessionData);
    if (!current) return null;

    const ALL_MESURES_UTILES = ['toiture_verte', 'pave_drainant'];
    const mesuresActuelles = sessionData?.phases?.[8]?.data?.giep_mesures ?? [];
    const mesuresManquantes = ALL_MESURES_UTILES.filter(m => !mesuresActuelles.includes(m));
    const surface = parseFloat(sessionData?.terrain?.contenance_m2 ?? 0);

    // Étape 1 : déjà au-dessus de la cible
    if (current.score >= targetScore) {
      return {
        reached: true,
        alreadyOk: true,
        targetScore,
        current,
        mesuresAAjouter: [],
      };
    }

    // Étape 2 : essayer avec toutes les mesures sans toucher à l'emprise
    const withMesures = this.computeFromSession(sessionData, {
      mesuresOverride: ALL_MESURES_UTILES,
    });
    if (withMesures.score >= targetScore) {
      return {
        reached: true,
        alreadyOk: false,
        targetScore,
        scoreProjet: withMesures.score,
        scoreLabel: withMesures.scoreLabel,
        scoreColor: withMesures.scoreColor,
        mesuresAAjouter: mesuresManquantes,
        empriseActuelle_pct: current.pctBati,
        empriseCible_pct:    current.pctBati,
        empriseActuelle_m2:  Math.round(surface * current.pctBati / 100),
        empriseCible_m2:     Math.round(surface * current.pctBati / 100),
        reductionEmprise_m2: 0,
        current,
        simulated: withMesures,
      };
    }

    // Étape 3 : mesures + réduction d'emprise (pas 1%, plancher 5%)
    let bestB = null;
    let bestSim = null;
    for (let b = Math.floor(current.pctBati); b >= 5; b -= 1) {
      const sim = this.computeFromSession(sessionData, {
        mesuresOverride: ALL_MESURES_UTILES,
        pctBatiOverride: b,
      });
      if (sim.score >= targetScore) { bestB = b; bestSim = sim; break; }
    }
    if (bestB !== null) {
      return {
        reached: true,
        alreadyOk: false,
        targetScore,
        scoreProjet: bestSim.score,
        scoreLabel: bestSim.scoreLabel,
        scoreColor: bestSim.scoreColor,
        mesuresAAjouter: mesuresManquantes,
        empriseActuelle_pct: +current.pctBati.toFixed(1),
        empriseCible_pct:    +bestB.toFixed(1),
        empriseActuelle_m2:  Math.round(surface * current.pctBati / 100),
        empriseCible_m2:     Math.round(surface * bestB / 100),
        reductionEmprise_m2: Math.round(surface * (current.pctBati - bestB) / 100),
        current,
        simulated: bestSim,
      };
    }

    // Étape 4 : fallback à 30 si on visait plus haut
    if (targetScore > 30) {
      const fallback = this.suggestImprovements(sessionData, 30);
      if (fallback?.reached) return { ...fallback, fallbackFrom: targetScore };
    }

    // Étape 5 : insolvable
    return {
      reached: false,
      targetScore,
      current,
      mesuresAAjouter: mesuresManquantes,
      message: `Cible ${targetScore}/100 inatteignable, même toutes mesures activées et emprise réduite à 5%. Le terrain naturel infiltre déjà mieux que tout projet bâti envisageable ici.`,
    };
  },

  // ── Recommandation d'ouvrages — 7 types GIEP ──────────────────────
  // Source : GIEP-LA-REUNION simulateur.js OUVRAGES_CONFIG L.21–89
  // Prioritaires : noues, jardins de pluie, fosses d'infiltration
  // Secondaires : revêtements perméables, tranchées drainantes, structures alvéolaires, bassins
  _recommandOuvrages(deltaQ_Ls, surface_m2, existants = []) {
    const reco = [];
    const V_net = deltaQ_Ls * 600 / 1000; // volume net m³ (Tc ~10min)

    // ── Prioritaires (toujours recommandés si deltaQ > 0)
    if (deltaQ_Ls > 0.5) {
      reco.push({
        type: 'noue_infiltration', priority: true,
        dim: `${Math.round(Math.max(10, deltaQ_Ls * 2))} ml`,
        surface_m2: Math.round(deltaQ_Ls * 2 * 1.5), // 1.5m large
        hauteur_m: 0.30,
        note: 'Noues paysagères h: 0.30m, redents tous les 20m sur pente',
      });
    }
    if (deltaQ_Ls > 1) {
      reco.push({
        type: 'jardin_pluie', priority: true,
        dim: `${Math.round(V_net * 0.3 / 0.25)} m²`,
        surface_m2: Math.round(V_net * 0.3 / 0.25),
        hauteur_m: 0.25,
        note: 'Jardins privatifs creux -0.20m max, point bas parcelle',
      });
    }
    if (deltaQ_Ls > 2) {
      reco.push({
        type: 'fosse_infiltration', priority: true,
        dim: `${Math.round(V_net * 0.2)} m³`,
        surface_m2: Math.round(V_net * 0.2 / 0.5),
        hauteur_m: 0.50,
        note: "Fosses d'infiltration aux pieds de descentes EP",
      });
    }

    // ── Secondaires (selon surface et contexte)
    if (!existants.includes('pave_drainant')) {
      reco.push({
        type: 'revetement_drainant', priority: false,
        dim: 'Accès/parking',
        surface_m2: Math.round(surface_m2 * 0.05),
        note: 'Stabilisé perméable cheminements, dalles alvéolées parking',
      });
    }
    if (deltaQ_Ls > 4 && !existants.includes('tranchee')) {
      reco.push({
        type: 'tranchee_drainante', priority: false,
        dim: `${Math.round(deltaQ_Ls * 1.5)} ml`,
        surface_m2: Math.round(deltaQ_Ls * 1.5 * 0.6),
        hauteur_m: 0.60,
        note: 'Tranchées drainantes périphériques, grave drainante',
      });
    }
    if (deltaQ_Ls > 6 && surface_m2 > 500) {
      reco.push({
        type: 'structure_alveolaire', priority: false,
        dim: `${Math.round(V_net * 0.15)} m³`,
        surface_m2: Math.round(V_net * 0.15 / 0.4),
        hauteur_m: 0.40,
        note: 'Structures alvéolaires sous parking/voirie',
      });
    }
    if (deltaQ_Ls > 8) {
      reco.push({
        type: 'bassin_retention', priority: false,
        dim: `${Math.round(V_net * 0.25)} m³`,
        surface_m2: Math.round(V_net * 0.25 / 0.8),
        hauteur_m: 0.80,
        note: 'Bassin de rétention — zone de surverse finale en point bas',
      });
    }
    if (surface_m2 > 80 && !existants.includes('toiture_verte')) {
      reco.push({
        type: 'toiture_vegetalisee', priority: false,
        dim: `${Math.round(surface_m2 * 0.3)} m²`,
        surface_m2: Math.round(surface_m2 * 0.3),
        note: 'Toiture végétalisée extensive (substrate 8-12cm)',
      });
    }

    return reco;
  },
};

export default GIEPCalculator;
