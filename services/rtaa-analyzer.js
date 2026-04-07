// terlab/services/rtaa-analyzer.js
// Orchestrateur RTAA Phase 11 — chemins A (IFC) et B (enveloppe)
// Combine RTAAChecker (Art.5+6 solaire) + RTAAVentilation (Art.9+10)
// Vanilla JS ES2022+ — La Réunion

import RTAAChecker     from './rtaa-checker.js';
import RTAAVentilation from './rtaa-ventilation.js';
import SpaceProducer   from './space-producer.js';
import Orientation     from '../utils/orientation.js';

// ── Debounce timer ──────────────────────────────────────────────────────────
let _debounceTimer = null;
let _lastCallback = null;

const RTAAAnalyzer = {

  /**
   * Analyse RTAA complète d'une session
   * Choisit automatiquement le chemin A (IFC) ou B (enveloppe)
   * @param {Object} session - données session TERLAB complètes
   * @param {Object} [options]
   * @param {Array<{x,y}>} [options.polygon] - polygone de l'enveloppe sélectionnée (override)
   * @returns {Promise<RTAAReport>}
   */
  async analyze(session, options = {}) {
    const planSource = session?.plan_source;
    const polygon = options.polygon ?? session?.batiment?.enveloppe?.polygon_local;

    // Chemin A : IFC uploadé (stub Level 2)
    if (planSource?.type === 'ifc' && planSource?.firebase_path) {
      return this._analyzeViaIFC(session);
    }

    // Chemin B : enveloppe générée
    if (polygon && polygon.length >= 3) {
      return this._analyzeViaEnvelope(session, polygon);
    }

    return {
      ok: false,
      note: 'Aucune enveloppe sélectionnée — choisir une proposition Phase 11',
      score_rtaa: 0,
    };
  },

  /**
   * Analyse avec debounce 800ms (pour drag interactif)
   * @param {Object} session
   * @param {Object} options
   * @param {Function} callback - appelé avec le rapport
   */
  analyzeDebounced(session, options = {}, callback) {
    _lastCallback = callback;
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(async () => {
      try {
        const report = await this.analyze(session, options);
        if (_lastCallback === callback) callback(report);
      } catch (e) {
        console.error('[RTAAAnalyzer] Erreur analyse debounced:', e);
      }
    }, 800);
  },

  // ── Chemin A : IFC (stub Level 2) ─────────────────────────────────────────

  async _analyzeViaIFC(session) {
    console.info('[RTAAAnalyzer] Chemin A (IFC) — stub Level 2');
    return {
      ok: false,
      stub: true,
      note: 'Analyse IFC via BIMSHOW — disponible prochainement',
      score_rtaa: 0,
      baies: [],
      ventilation: null,
      synthese: {
        nb_baies_total: 0,
        nb_baies_conformes: 0,
        nb_baies_a_corriger: 0,
        ventilation_ok: false,
        score_rtaa: 0,
        actions: [],
      },
    };
  },

  // ── Chemin B : Enveloppe générée ──────────────────────────────────────────

  async _analyzeViaEnvelope(session, polygon) {
    const config = this._buildConfig(session);

    // Générer les pièces depuis l'enveloppe
    const rooms = SpaceProducer.fromEnvelope(polygon, session);
    if (rooms.length === 0) {
      return { ok: false, note: 'Enveloppe trop petite pour générer des pièces', score_rtaa: 0 };
    }

    // Lancer les deux analyses en parallèle
    const [solarReport, ventReport] = await Promise.all([
      RTAAChecker.checkPlan(rooms, config),
      Promise.resolve(RTAAVentilation.check(rooms, config)),
    ]);

    // Combiner les rapports
    return this._combineReports(solarReport, ventReport, config, polygon);
  },

  // ── Configuration depuis la session ───────────────────────────────────────

  _buildConfig(session) {
    const terrain = session?.terrain ?? {};
    const p4 = session?.phases?.[4]?.data ?? {};

    return {
      altitude: parseFloat(terrain.altitude_ngr ?? 25),
      debord_m: parseFloat(p4.debord_m ?? terrain.debord_m ?? 0.60),
      couleur_murs: p4.couleur_murs ?? 'claire',
      couleur_toit: p4.couleur_toit ?? 'claire',
      R_mur: parseFloat(p4.R_mur ?? 0.21),
      R_toit: parseFloat(p4.R_toit ?? 0.21),
      h_plafond: parseFloat(p4.h_plafond ?? 2.60),
      prolongement_m: 0,
      n_joues: 0,
    };
  },

  // ── Combinaison des rapports ──────────────────────────────────────────────

  _combineReports(solarReport, ventReport, config, polygon) {
    const zone = RTAAChecker.getZone(config.altitude);

    // Score RTAA combiné : solaire 60% + ventilation 40%
    const score_solar = solarReport.score ?? 0;
    const score_vent = ventReport.score ?? 0;
    const score_rtaa = Math.round(score_solar * 0.60 + score_vent * 0.40);

    // Baies avec détails
    const baies = (solarReport.results_baies ?? []).map(b => ({
      id: b.id,
      room: b.room,
      orientation: b.orientation,
      So: b.So,
      Cm: b.Cm,
      S: b.S,
      Smax: b.Smax,
      conforme: b.conforme,
      deficit: b.deficit,
      note: b.note,
      suggestion: b.suggestion,
    }));

    // Ventilation résumé
    const ventilation = {
      traversante_possible: ventReport.art930?.some(r => r.conforme) ?? false,
      facades_avec_baies: Object.keys(ventReport.art920?.by_facade ?? {}).filter(k => (ventReport.art920.by_facade[k] ?? 0) > 0),
      conforme: ventReport.art920?.conforme ?? false,
      alertes: ventReport.violations?.map(v => v.msg) ?? [],
      score: score_vent,
    };

    // Toiture
    const toiture_result = solarReport.results_parois?.find(p => p.id === 'toiture');
    const toiture = {
      zone_rtaa: zone,
      isolation_requise: zone !== 'reunion_zone3',
      R_min_m2KW: zone === 'reunion_zone1' ? 2.5 : zone === 'reunion_zone2' ? 1.5 : 0,
      conforme: toiture_result?.conforme,
      note_pedagogique: zone === 'reunion_zone1'
        ? 'Zone 1 : toiture doit avoir R ≥ 2.5 m²·K/W (laine de verre 10cm minimum)'
        : zone === 'reunion_zone2'
          ? 'Zone 2 : toiture doit avoir R ≥ 1.5 m²·K/W'
          : 'Zone 3 : exigence thermique U (pas de Smax imposé)',
    };

    // Actions prioritaires
    const actions = [];
    let priorite = 1;

    for (const b of baies) {
      if (b.conforme === false && b.suggestion?.length > 0) {
        actions.push({
          priorite: priorite++,
          type: 'baie', id: b.id,
          action: `${b.suggestion[0].label ?? b.suggestion[0]} côté ${b.orientation}`,
        });
      }
    }
    for (const v of ventReport.violations ?? []) {
      if (v.severity === 'major') {
        actions.push({
          priorite: priorite++,
          type: 'ventilation',
          action: v.msg,
        });
      }
    }

    // Synthèse
    const nb_baies_total = baies.length;
    const nb_baies_conformes = baies.filter(b => b.conforme === true).length;

    return {
      ok: true,
      zone,
      date_analyse: new Date().toISOString(),

      baies,
      ventilation,
      toiture,

      solar: solarReport,
      vent: ventReport,

      synthese: {
        nb_baies_total,
        nb_baies_conformes,
        nb_baies_a_corriger: nb_baies_total - nb_baies_conformes,
        ventilation_ok: ventilation.conforme,
        score_rtaa,
        actions,
      },
    };
  },

  // ── Analyse thermique simplifiée par façade (porté de GIEP giep-rtaa-thermal.js) ──
  // Constantes RTAA DOM par zone
  _RTAA_ZONES: {
    1: { toiture: { sMax: 2.2, alphaMax: 0.85 }, murOpaque: { sMax: 1.8, alphaMax: 0.70 }, baie: { sMax: 0.50 } },
    2: { toiture: { sMax: 2.5, alphaMax: 0.85 }, murOpaque: { sMax: 2.0, alphaMax: 0.70 }, baie: { sMax: 0.55 } },
    3: { toiture: { sMax: 2.8, alphaMax: 0.85 }, murOpaque: { sMax: 2.2, alphaMax: 0.70 }, baie: { sMax: 0.60 } },
  },
  _MASQUE: { nord: { Cm: 0.7, Cv: 1.0 }, est: { Cm: 1.0, Cv: 1.0 }, sud: { Cm: 1.0, Cv: 1.0 }, ouest: { Cm: 1.0, Cv: 1.0 } },
  _U_VALS: { beton: 2.1, brique: 0.8, bois: 0.15, metal: 50, verre: 5.8, inconnu: 2.0 },
  _ALPHA:  { beton: 0.65, brique: 0.70, bois: 0.60, metal: 0.80, verre: 0.10, inconnu: 0.65 },

  analyzeFacade(orientation, material, hasDebord, session) {
    const zone   = parseInt(session?.terrain?.zone_rtaa ?? 1);
    const limits = this._RTAA_ZONES[zone] ?? this._RTAA_ZONES[1];
    const mat    = material ?? 'inconnu';
    const alpha  = this._ALPHA[mat]  ?? this._ALPHA.inconnu;
    const U      = this._U_VALS[mat] ?? this._U_VALS.inconnu;
    const masque = this._MASQUE[orientation] ?? this._MASQUE.sud;
    const S      = alpha * U * masque.Cm * masque.Cv;
    const prot   = hasDebord ? 0.65 : orientation === 'sud' ? 0.80 : 1.0;
    const Sbaie  = 0.85 * prot;
    return {
      orientation, zone, material: mat,
      mur:  { S, limit: limits.murOpaque.sMax, alpha, alphaLimit: limits.murOpaque.alphaMax,
              conforme: S <= limits.murOpaque.sMax && alpha <= limits.murOpaque.alphaMax },
      baie: { S: Sbaie, limit: limits.baie.sMax, conforme: Sbaie <= limits.baie.sMax, prot },
      severity: S > limits.murOpaque.sMax * 1.3 ? 'HIGH' : S > limits.murOpaque.sMax ? 'MEDIUM' : 'LOW',
    };
  },

  /**
   * Extraire les façades d'un polygone avec leur orientation RTAA
   * Utile pour le canvas SVG (coloration)
   * @param {Array<{x,y}>} polygon
   * @param {Object} session
   * @returns {Array<{idx, p1, p2, length, cardinal, smax}>}
   */
  getFacadesRTAA(polygon, session) {
    const terrain = session?.terrain ?? {};
    const rotation = parseFloat(terrain.building_rotation_deg ?? 0);
    const northAngle = parseFloat(terrain.north_angle_deg ?? 0);
    const altitude = parseFloat(terrain.altitude_ngr ?? 25);
    const zone = RTAAChecker.getZone(altitude);

    const facades = Orientation.extractFacades(polygon, rotation, northAngle);

    return facades.map(f => ({
      ...f,
      rtaaKey: Orientation.cardinalToRtaaKey(f.cardinal),
      zone,
    }));
  },
};

export default RTAAAnalyzer;
