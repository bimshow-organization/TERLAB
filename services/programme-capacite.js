// services/programme-capacite.js
// Calcul programme logements (ind/band/col) depuis stratégie active + session PLU.
// Base SHON = emprise réelle de la stratégie (score.area_m2), pas parcelle × CES.
// Vanilla JS ES2022+ — TERLAB / ENSA La Réunion / MGA Architecture
// Author: Mathias Giraud — 2026-04

const PROG_PARAMS = {
  ind:  { label: 'Individuel', shon_t: 90, park_ratio: 0,   park_m2: 0,  circ_ratio: 0,    commun_ratio: 0    },
  band: { label: 'En bande',   shon_t: 80, park_ratio: 1,   park_m2: 14, circ_ratio: 0.03, commun_ratio: 0.01 },
  col:  { label: 'Collectif',  shon_t: 68, park_ratio: 1.3, park_m2: 25, circ_ratio: 0.12, commun_ratio: 0.06 },
};

const ProgrammeCapacite = {

  PROG_PARAMS,

  compute(strategy, session, mix = { ind: 33, band: 34, col: 33 }, niveaux = 2) {
    const score   = strategy?.score ?? {};
    const parcelA = session?._parcelAreaM2 ?? 0;
    const p4      = session?.phases?.[4]?.data ?? {};
    const cesMax  = parseFloat(p4.ces_max ?? 0.50) || 0.50;
    const pente   = parseFloat(session?.terrain?.pente_pct ?? 0);

    const stratArea = score.area_m2 ?? strategy?.areaM2 ?? strategy?.area_m2 ?? 0;
    const emprBase  = stratArea > 0 ? stratArea : parcelA * cesMax;

    const sum = Math.max(1, (mix.ind || 0) + (mix.band || 0) + (mix.col || 0));
    const rInd  = (mix.ind  || 0) / sum;
    const rBand = (mix.band || 0) / sum;
    const rCol  = (mix.col  || 0) / sum;

    const shonInd  = emprBase * rInd;
    const shonBand = emprBase * rBand;
    const shonCol  = emprBase * rCol * niveaux;

    const calc = (type, shon) => {
      const p = PROG_PARAMS[type];
      const nLgts      = Math.floor(shon / p.shon_t);
      const parkSurf   = nLgts * p.park_ratio * p.park_m2;
      const circSurf   = shon * p.circ_ratio;
      const communSurf = shon * p.commun_ratio;
      return { shon, nLgts, parkSurf, circSurf, communSurf };
    };

    const ind  = calc('ind',  shonInd);
    const band = calc('band', shonBand);
    const col  = calc('col',  shonCol);

    const totLgts = ind.nLgts + band.nLgts + col.nLgts;
    const totShon = ind.shon + band.shon + col.shon;
    const totPark = ind.parkSurf + band.parkSurf + col.parkSurf;
    const totCirc = ind.circSurf + band.circSurf + col.circSurf
                  + ind.communSurf + band.communSurf + col.communSurf;

    const tcase = this._topoCase(pente);
    const depth = score.depth ?? strategy?.l ?? 0;
    const minDim = score.minDim ?? Math.min(strategy?.w ?? 0, strategy?.l ?? 0);

    const rtaa = {
      profOk:        depth <= 13.5,
      dimOk:         minDim >= 5,
      traversant:    true,
      ascenseurReqd: niveaux >= 4,
      pilotis:       tcase.pilotis,
      profMaxOk:     depth <= tcase.profMax,
    };

    return {
      emprBase, parcelA, cesMax,
      cesEffectif: parcelA > 0 ? emprBase / parcelA : 0,
      ind, band, col,
      totLgts, totShon, totPark, totCirc,
      densite: parcelA > 0 ? Math.round(totLgts / (parcelA / 10000)) : 0,
      niveaux, mix, tcase, rtaa,
      stratId: strategy?.id ?? strategy?.strategy ?? '—',
      depth, minDim,
    };
  },

  _topoCase(pct) {
    if (pct <= 5)  return { id: 'flat',    label: 'Plat',    pilotis: false, profMax: 15, coutMult: 1.0 };
    if (pct <= 15) return { id: 'gentle',  label: 'Douce',   pilotis: false, profMax: 13, coutMult: 1.1 };
    if (pct <= 30) return { id: 'medium',  label: 'Modérée', pilotis: true,  profMax: 10, coutMult: 1.3 };
    if (pct <= 50) return { id: 'steep',   label: 'Forte',   pilotis: true,  profMax: 8,  coutMult: 1.6 };
    return                 { id: 'extreme', label: 'Extrême', pilotis: true,  profMax: 6,  coutMult: 2.1 };
  },
};

if (typeof window !== 'undefined') window.ProgrammeCapacite = ProgrammeCapacite;
export default ProgrammeCapacite;
