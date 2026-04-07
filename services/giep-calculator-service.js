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

  // ── Score GIEP (0–100) ────────────────────────────────────────────
  computeScoreGIEP(debitInitial, debitFinal) {
    if (!debitInitial || debitInitial <= 0) return 0;
    return Math.min(100, Math.round((1 - debitFinal / debitInitial) * 100));
  },

  // ── Calcul complet depuis la session TERLAB ───────────────────────
  computeFromSession(sessionData) {
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

    // Surfaces projet depuis Phase 7 + Phase 8
    const surfaceProjet = parseFloat(p7.gabarit_l_m ?? 10) * parseFloat(p7.gabarit_w_m ?? 8);
    const pctBati = surface > 0 ? (surfaceProjet / surface) * 100 : 40;
    const giepMesures = p8.giep_mesures ?? [];

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
      scoreLabel: score >= 70 ? 'Excellent' : score >= 50 ? 'Bon' : score >= 30 ? 'Moyen' : 'Insuffisant',
      scoreColor: score >= 70 ? 'var(--success)' : score >= 50 ? 'var(--accent)' : score >= 30 ? 'var(--warning)' : 'var(--danger)',
      infiltration,
      ouvrages: this._recommandOuvrages(debitInit - debitFinal, surface, giepMesures),
      source_note: 'Méthode rationnelle · Kirpich/Caquot/Sogreah · Intensités DEAL Réunion 2012',
    };
  },

  // ── Recommandation d'ouvrages ─────────────────────────────────────
  _recommandOuvrages(deltaQ_Ls, surface_m2, existants = []) {
    const reco = [];
    if (deltaQ_Ls > 8)   reco.push({ type: 'bassin_retention',    dim: `${Math.round(deltaQ_Ls * 0.4)} m³` });
    if (deltaQ_Ls > 4)   reco.push({ type: 'noue_infiltration',   dim: `${Math.round(deltaQ_Ls * 2)} ml` });
    if (surface_m2 > 80) reco.push({ type: 'toiture_vegetalisee', dim: `${Math.round(surface_m2 * 0.3)} m²` });
    if (!existants.includes('pave_drainant')) reco.push({ type: 'revetement_drainant', dim: 'Accès/parking' });
    return reco;
  },
};

export default GIEPCalculator;
