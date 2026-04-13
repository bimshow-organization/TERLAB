// TERLAB · services/anc-service.js · Calculateur Assainissement Non Collectif
// Dimensionnement filière ANC adapté Réunion — sources :
//   - DTU 64.1 (assainissement autonome)
//   - Arrêté du 7 septembre 2009 modifié (prescriptions techniques ANC)
//   - Guide SPANC Réunion / DEAL Réunion
//   - Données géologiques BRGM via brgm-service.js
// ENSA La Réunion · MGA Architecture

// ── Correspondance perméabilité qualitative BRGM → K sol (mm/h) ──────
// Le BRGM donne une perméabilité de la roche-mère ; pour l'ANC ce qui
// compte c'est le sol superficiel (1-2 m). On applique un abattement
// conservateur car l'altération crée souvent une couche argileuse.
const PERM_BRGM_TO_K = {
  'extrême':    40,   // lave récente fracturée — sol très drainant
  'très_forte': 25,   // coulées historiques
  'forte':      15,   // basalte intermédiaire
  'moyenne':     8,   // basalte altéré
  'faible':      3,   // intrusions, altération argileuse
  'variable':    6,   // alluvions, formations marines — conservateur
};

// ── Classes de perméabilité ANC (DTU 64.1 + arrêté 2009) ─────────────
// K en mm/h mesuré par test de percolation in situ
const CLASSES_K = [
  { id: 'tres_rapide', min: 50, max: Infinity, label: 'Très rapide',
    verdict: 'Sol trop perméable — risque de pollution nappe',
    filieres: ['filtre_sable_vertical', 'micro_station', 'filtre_plante'] },
  { id: 'rapide',      min: 15, max: 50,       label: 'Rapide',
    verdict: 'Épandage classique possible',
    filieres: ['epandage_classique', 'filtre_plante'] },
  { id: 'moyen',       min: 6,  max: 15,       label: 'Moyen',
    verdict: 'Épandage possible sous conditions',
    filieres: ['epandage_classique', 'filtre_sable_vertical', 'filtre_plante'] },
  { id: 'lent',        min: 2,  max: 6,        label: 'Lent',
    verdict: 'Épandage impossible — filière drainée obligatoire',
    filieres: ['filtre_sable_vertical_draine', 'micro_station', 'filtre_plante'] },
  { id: 'impermeable', min: 0,  max: 2,        label: 'Imperméable',
    verdict: 'Sol imperméable — filière compacte ou tertre',
    filieres: ['tertre_infiltration', 'micro_station', 'filtre_compact'] },
];

// ── Catalogue filières ANC ───────────────────────────────────────────
const FILIERES = {
  epandage_classique: {
    label: 'Fosse toutes eaux + tranchées d\'épandage',
    short: 'Épandage classique',
    description: 'Solution traditionnelle : fosse toutes eaux (prétraitement) + tranchées filtrantes en sol naturel.',
    fosse_m3_par_eh: 0.80,       // ~4 m³ pour 5 EH (pratique SPANC Réunion)
    epandage_m2_par_eh: 5,       // 25 m² min pour 5 EH
    profondeur_tranchee_m: 0.7,
    largeur_tranchee_m: 0.5,
    entraxe_tranchees_m: 1.5,
    reculs: { limite_parcelle: 5, habitation: 5, captage: 35, arbre: 3, puits: 35 },
    capex_min: 4000, capex_max: 8000,
    opex_annuel: 200,            // vidange tous les 4 ans ~800€ → 200/an
    duree_vie_ans: 20,
    entretien: 'Vidange fosse tous les 4 ans. Contrôle SPANC obligatoire.',
    conditions: 'K entre 6 et 50 mm/h, pente < 10%, nappe > 1.5m',
  },
  filtre_sable_vertical: {
    label: 'Fosse toutes eaux + filtre à sable vertical non drainé',
    short: 'Filtre à sable vertical',
    description: 'Massif de sable calibré remplaçant le sol naturel quand celui-ci est trop perméable. Infiltration en fond.',
    fosse_m3_par_eh: 0.80,
    epandage_m2_par_eh: 3.5,     // surface filtre plus compacte
    profondeur_m: 1.0,
    reculs: { limite_parcelle: 5, habitation: 5, captage: 35, arbre: 3, puits: 35 },
    capex_min: 5000, capex_max: 10000,
    opex_annuel: 250,
    duree_vie_ans: 15,
    entretien: 'Vidange fosse tous les 4 ans. Remplacement sable tous les 15 ans.',
    conditions: 'K > 50 mm/h (sol trop perméable) ou K 6-15 mm/h',
  },
  filtre_sable_vertical_draine: {
    label: 'Fosse toutes eaux + filtre à sable vertical drainé',
    short: 'Filtre à sable drainé',
    description: 'Identique au filtre vertical mais avec drainage en fond : les effluents traités sont évacués vers un exutoire (fossé, ravine).',
    fosse_m3_par_eh: 0.80,
    epandage_m2_par_eh: 4,
    profondeur_m: 1.2,
    reculs: { limite_parcelle: 5, habitation: 5, captage: 35, arbre: 3, puits: 35 },
    capex_min: 6000, capex_max: 12000,
    opex_annuel: 300,
    duree_vie_ans: 15,
    entretien: 'Vidange fosse tous les 4 ans. Remplacement sable tous les 15 ans. Vérification exutoire.',
    conditions: 'K < 6 mm/h (sol lent) — nécessite un exutoire',
  },
  micro_station: {
    label: 'Micro-station d\'épuration',
    short: 'Micro-station',
    description: 'Système compact agréé : traitement biologique aérobie dans une cuve unique. Adapté aux terrains en pente ou à faible emprise.',
    fosse_m3_par_eh: 0,          // intégré dans la station
    emprise_m2_par_eh: 1.5,      // très compact
    profondeur_m: 2.0,
    reculs: { limite_parcelle: 3, habitation: 5, captage: 35, arbre: 2, puits: 35 },
    capex_min: 8000, capex_max: 15000,
    opex_annuel: 500,            // contrat entretien + électricité
    duree_vie_ans: 15,
    entretien: 'Contrat entretien annuel obligatoire. Consommation électrique ~1 kWh/jour.',
    conditions: 'Agréement ministériel requis. Adaptée forte pente ou sol imperméable.',
    electricite: true,
  },
  filtre_plante: {
    label: 'Filtre planté de roseaux (phytoépuration)',
    short: 'Phytoépuration',
    description: 'Deux étages de bassins plantés (roseaux, héliconia). Très adapté au climat tropical réunionnais. Pas de fosse en amont sur les systèmes agréés.',
    fosse_m3_par_eh: 0,          // pas de fosse pour les systèmes agréés récents
    epandage_m2_par_eh: 2.5,     // étage 1 : 1.5 m²/EH + étage 2 : 1 m²/EH
    profondeur_m: 0.8,
    reculs: { limite_parcelle: 5, habitation: 10, captage: 35, arbre: 3, puits: 35 },
    capex_min: 6000, capex_max: 12000,
    opex_annuel: 150,            // faucardage annuel, pas de vidange
    duree_vie_ans: 25,
    entretien: 'Faucardage annuel des roseaux. Curage boues étage 1 tous les 10 ans.',
    conditions: 'Surface suffisante. Climat tropical favorable.',
    tropical_bonus: true,
  },
  filtre_compact: {
    label: 'Filtre compact agréé (zéolithe, coco, laine de roche)',
    short: 'Filtre compact',
    description: 'Fosse + massif filtrant compact (zéolithe, fibre de coco). Emprise réduite par rapport au filtre à sable.',
    fosse_m3_par_eh: 0.80,
    emprise_m2_par_eh: 1.5,
    profondeur_m: 1.5,
    reculs: { limite_parcelle: 3, habitation: 5, captage: 35, arbre: 2, puits: 35 },
    capex_min: 7000, capex_max: 14000,
    opex_annuel: 350,
    duree_vie_ans: 10,
    entretien: 'Vidange fosse tous les 4 ans. Remplacement média filtrant tous les 10 ans.',
    conditions: 'Agréement ministériel requis. Sol imperméable ou emprise très contrainte.',
  },
  tertre_infiltration: {
    label: 'Tertre d\'infiltration (hors sol)',
    short: 'Tertre hors sol',
    description: 'Filtre à sable surélevé quand nappe trop haute ou sol imperméable. Pompe de relevage nécessaire.',
    fosse_m3_par_eh: 0.80,
    epandage_m2_par_eh: 5,
    hauteur_tertre_m: 1.2,
    reculs: { limite_parcelle: 5, habitation: 10, captage: 35, arbre: 3, puits: 35 },
    capex_min: 10000, capex_max: 20000,
    opex_annuel: 400,
    duree_vie_ans: 15,
    entretien: 'Vidange fosse tous les 4 ans. Pompe de relevage à vérifier annuellement.',
    conditions: 'Sol imperméable ET nappe haute. Pompe de relevage obligatoire.',
    electricite: true,
  },
};

// ── Contacts SPANC par intercommunalité ──────────────────────────────
const SPANC_CONTACTS = {
  TCO:    { nom: 'SPANC du TCO',   tel: '0262 32 12 12', communes: 'Le Port, La Possession, Saint-Paul, Trois-Bassins, Saint-Leu' },
  CINOR:  { nom: 'SPANC CINOR',    tel: '0262 92 32 32', communes: 'Saint-Denis, Sainte-Marie, Sainte-Suzanne' },
  CIREST: { nom: 'SPANC CIREST',   tel: '0262 90 49 00', communes: 'Saint-André, Bras-Panon, Saint-Benoît, Plaine-des-Palmistes, Sainte-Rose, Salazie' },
  CIVIS:  { nom: 'SPANC CIVIS',    tel: '0262 25 43 00', communes: 'Saint-Pierre, Le Tampon, Cilaos, Entre-Deux, Saint-Louis, Petite-Île, Les Avirons, L\'Étang-Salé' },
  CASUD:  { nom: 'SPANC CASUD',    tel: '0262 56 96 96', communes: 'Saint-Joseph, Saint-Philippe' },
};

// ══════════════════════════════════════════════════════════════════════

const ANCService = {

  // ── Estimation équivalent-habitants (EH) ─────────────────────────
  // Source : arrêté du 7 sept 2009, art. 5 — 1 EH = 1 pièce principale
  // En pratique : nombre de chambres + 1 (séjour) pour habitat individuel
  estimerEH(usage, occupants, surfaceHabitable_m2) {
    if (usage === 'collectif' || usage === 'erp') {
      // Locaux collectifs : 1 EH pour 15 m² de SDP (règle SPANC)
      return Math.max(5, Math.ceil((surfaceHabitable_m2 ?? 150) / 15));
    }
    // Individuel : priorité aux occupants déclarés (plus fiable).
    // Sinon estimation par pièces principales (~25 m²/PP), plafonnée à 8 EH
    // (au-delà c'est du collectif ou une très grande villa atypique).
    if (occupants && occupants > 0) return Math.max(3, Math.min(10, occupants));
    const parSurface = Math.ceil((surfaceHabitable_m2 ?? 100) / 25);
    return Math.max(3, Math.min(8, parSurface));
  },

  // ── Volume eaux usées journalier ─────────────────────────────────
  // Source : DTU 64.1 — 150 L/EH/jour (eaux grises + eaux vannes)
  estimerVolumeEU(eh) {
    return eh * 0.150; // m³/jour
  },

  // ── Classification perméabilité depuis données BRGM ──────────────
  // Convertit la perméabilité qualitative BRGM en K sol estimé (mm/h)
  // puis classe selon les seuils ANC
  classerPermeabilite(brgmPermeability, kOverride) {
    const k = kOverride ?? PERM_BRGM_TO_K[brgmPermeability] ?? 8;
    const classe = CLASSES_K.find(c => k >= c.min && k < c.max)
                ?? CLASSES_K[CLASSES_K.length - 1];
    return { k, classe, filieres: classe.filieres };
  },

  // ── Recommandation filière optimale ──────────────────────────────
  // Logique décisionnelle :
  //   1. Classer le sol → filières admissibles
  //   2. Filtrer par contraintes terrain (pente, surface, nappe)
  //   3. Privilégier phytoépuration si climat tropical + surface OK
  //   4. Scorer et trier par pertinence
  recommanderFiliere(terrain) {
    const {
      k, pente_pct = 0, surface_m2 = 500, nappe_m = 3,
      eh = 5, brgmPermeability, kOverride,
    } = terrain;

    const perm = this.classerPermeabilite(brgmPermeability, kOverride ?? k);
    const pente = parseFloat(pente_pct);
    const surface = parseFloat(surface_m2);
    const nappe = parseFloat(nappe_m);
    const popEq = eh;

    const candidats = perm.filieres.map(id => {
      const f = FILIERES[id];
      if (!f) return null;

      let score = 50;
      const alertes = [];

      // Surface nécessaire
      const empriseParEH = f.epandage_m2_par_eh ?? f.emprise_m2_par_eh ?? 3;
      const empriseFiliere = empriseParEH * popEq;
      const fosseVol = Math.max(4, (f.fosse_m3_par_eh ?? 0) * popEq);
      const fosseSurface = fosseVol > 0 ? Math.ceil(fosseVol / 1.5) * 1.2 : 0; // emprise fosse ~L×l×h
      const empriseTotal = empriseFiliere + fosseSurface;

      // Surface de parcelle disponible pour ANC (hors bâti, ~40% parcelle)
      const surfaceDispo = surface * 0.4;
      if (empriseTotal > surfaceDispo) {
        score -= 30;
        alertes.push(`Emprise ${Math.round(empriseTotal)} m² > surface disponible ~${Math.round(surfaceDispo)} m²`);
      }

      // Pente
      if (pente > 15 && id === 'epandage_classique') {
        score -= 40;
        alertes.push('Pente > 15% : épandage classique déconseillé');
      } else if (pente > 10 && id === 'epandage_classique') {
        score -= 15;
        alertes.push('Pente > 10% : tranchées perpendiculaires aux courbes de niveau obligatoires');
      }
      if (pente > 8 && !['micro_station', 'filtre_compact'].includes(id)) {
        score -= 10;
        alertes.push('Pente > 8% : filière compacte recommandée par SPANC Réunion');
      }

      // Nappe
      if (nappe < 1.5 && id !== 'tertre_infiltration') {
        score -= 20;
        alertes.push('Nappe < 1.5m : risque contamination — tertre ou micro-station');
      }
      if (nappe < 0.8) {
        score -= 30;
        alertes.push('Nappe < 0.8m : tertre d\'infiltration obligatoire');
      }

      // Bonus tropical phytoépuration
      if (id === 'filtre_plante' && f.tropical_bonus) {
        score += 15;
      }

      // Coût (pénalité légère pour les plus chers)
      const coutMoyen = (f.capex_min + f.capex_max) / 2;
      if (coutMoyen > 12000) score -= 5;

      // Électricité (pénalité en zone isolée)
      if (f.electricite) score -= 5;

      return {
        id,
        filiere: f,
        score: Math.max(0, Math.min(100, score)),
        empriseFiliere_m2: Math.round(empriseFiliere),
        fosseSurface_m2: Math.round(fosseSurface),
        fosseVolume_m3: +fosseVol.toFixed(1),
        empriseTotal_m2: Math.round(empriseTotal),
        alertes,
      };
    }).filter(Boolean);

    candidats.sort((a, b) => b.score - a.score);

    return {
      classeK: perm.classe,
      k_mmh: perm.k,
      eh: popEq,
      volume_m3_jour: +this.estimerVolumeEU(popEq).toFixed(2),
      pente_pct: pente,
      nappe_m: nappe,
      recommandation: candidats[0] ?? null,
      alternatives: candidats.slice(1),
      toutes: candidats,
    };
  },

  // ── Dimensionnement détaillé d'une filière ───────────────────────
  dimensionner(filiereId, eh) {
    const f = FILIERES[filiereId];
    if (!f) return null;

    const popEq = Math.max(3, eh);
    const fosseVol = Math.max(4, (f.fosse_m3_par_eh ?? 0) * popEq);
    const empriseParEH = f.epandage_m2_par_eh ?? f.emprise_m2_par_eh ?? 3;
    const empriseFiliere = empriseParEH * popEq;

    // Fosse toutes eaux : dimensions standards
    let fosseDim = null;
    if (fosseVol > 0) {
      // Proportions courantes : L ≈ 2×l, h = 1.5m
      const h = 1.5;
      const volUtil = fosseVol / h;
      const largeur = Math.sqrt(volUtil / 2);
      const longueur = largeur * 2;
      fosseDim = {
        volume_m3: +fosseVol.toFixed(1),
        longueur_m: +longueur.toFixed(1),
        largeur_m: +largeur.toFixed(1),
        profondeur_m: h,
        emprise_m2: Math.ceil(longueur * largeur * 1.2), // +20% accès
      };
    }

    // Tranchées d'épandage (si applicable)
    let tranchees = null;
    if (f.epandage_m2_par_eh && filiereId.includes('epandage')) {
      const surfaceTotale = empriseParEH * popEq;
      const nbTranchees = Math.ceil(surfaceTotale / (f.largeur_tranchee_m * 30)); // max 30m/tranchée
      const longueurParTranchee = surfaceTotale / (f.largeur_tranchee_m * nbTranchees);
      tranchees = {
        nombre: nbTranchees,
        longueur_m: +longueurParTranchee.toFixed(1),
        largeur_m: f.largeur_tranchee_m,
        profondeur_m: f.profondeur_tranchee_m,
        entraxe_m: f.entraxe_tranchees_m,
        surface_totale_m2: Math.round(surfaceTotale),
        emprise_avec_entraxes_m2: Math.round(nbTranchees * longueurParTranchee * f.entraxe_tranchees_m),
      };
    }

    // Filtre planté : 2 étages
    let filtres = null;
    if (filiereId === 'filtre_plante') {
      filtres = {
        etage_1_m2: +(1.5 * popEq).toFixed(0),
        etage_2_m2: +(1.0 * popEq).toFixed(0),
        total_m2: Math.round(empriseFiliere),
        profondeur_m: f.profondeur_m,
        plantes: 'Phragmites australis, Typha latifolia, Heliconia (Réunion)',
      };
    }

    return {
      filiereId,
      label: f.label,
      short: f.short,
      eh: popEq,
      fosse: fosseDim,
      tranchees,
      filtres,
      empriseFiliere_m2: Math.round(empriseFiliere),
      empriseTotal_m2: Math.round(empriseFiliere + (fosseDim?.emprise_m2 ?? 0)),
      reculs: f.reculs,
      conditions: f.conditions,
    };
  },

  // ── Estimation coût ──────────────────────────────────────────────
  // CapEx + OpEx sur durée de vie, corrigé Réunion (+20% surcoût DOM)
  estimerCout(filiereId, eh, pentePct = 0) {
    const f = FILIERES[filiereId];
    if (!f) return null;

    const popEq = Math.max(3, eh);
    const facteurEH = popEq <= 5 ? 1 : 1 + (popEq - 5) * 0.12; // +12%/EH au-delà de 5
    const facteurPente = pentePct > 10 ? 1.2 : pentePct > 5 ? 1.1 : 1.0;
    const facteurDOM = 1.20; // surcoût matériaux/main-d'œuvre Réunion

    const capexBase = (f.capex_min + f.capex_max) / 2;
    const capex = Math.round(capexBase * facteurEH * facteurPente * facteurDOM);
    const capexMin = Math.round(f.capex_min * facteurEH * facteurPente * facteurDOM);
    const capexMax = Math.round(f.capex_max * facteurEH * facteurPente * facteurDOM);

    const opexAnnuel = Math.round(f.opex_annuel * facteurDOM);
    const duree = f.duree_vie_ans;
    const coutGlobal = capex + opexAnnuel * duree;

    return {
      filiereId,
      capex,
      capex_min: capexMin,
      capex_max: capexMax,
      opex_annuel: opexAnnuel,
      duree_vie_ans: duree,
      cout_global: coutGlobal,
      facteurs: { eh: +facteurEH.toFixed(2), pente: facteurPente, dom: facteurDOM },
      note: `Estimation indicative. Devis professionnel requis. Surcoût DOM ${Math.round((facteurDOM - 1) * 100)}% inclus.`,
    };
  },

  // ── Vérification conformité PLU ──────────────────────────────────
  verifierConformite(terrain, pluRules) {
    const checks = [];

    // Vérifier si la zone PLU impose le collectif
    if (pluRules?.assainissement_collectif_ou_individuel === false) {
      checks.push({
        ok: false, severity: 'error',
        text: 'Zone PLU imposant le raccordement collectif — ANC non autorisé',
      });
    }

    // Emprise maximale assainissement collectif
    if (pluRules?.emprise_assainissement_collectif_pct) {
      checks.push({
        ok: true, severity: 'info',
        text: `PLU : emprise assainissement collectif = ${pluRules.emprise_assainissement_collectif_pct}%`,
      });
    }

    // Note zone Uca (semi-collectif)
    if (pluRules?.note?.includes('assainissement semi-collectif')) {
      checks.push({
        ok: true, severity: 'warning',
        text: 'Zone Uca : assainissement semi-collectif toléré en attente de raccordement',
      });
    }

    // Vérifier surface minimale pour ANC
    const surface = parseFloat(terrain?.contenance_m2 ?? 0);
    if (surface > 0 && surface < 300) {
      checks.push({
        ok: false, severity: 'error',
        text: `Parcelle ${Math.round(surface)} m² trop petite pour ANC (min ~300 m² avec reculs)`,
      });
    } else if (surface > 0 && surface < 500) {
      checks.push({
        ok: true, severity: 'warning',
        text: `Parcelle ${Math.round(surface)} m² exiguë — filière compacte probable`,
      });
    }

    return checks;
  },

  // ── Contact SPANC par intercommunalité ───────────────────────────
  getSPANC(interco) {
    if (!interco) return null;
    const key = interco.toUpperCase().replace(/\s/g, '');
    return SPANC_CONTACTS[key] ?? null;
  },

  // ══════════════════════════════════════════════════════════════════
  // CALCUL COMPLET DEPUIS SESSION TERLAB
  // (même pattern que GIEPCalculator.computeFromSession)
  // ══════════════════════════════════════════════════════════════════

  computeFromSession(sessionData) {
    const terrain = sessionData?.terrain ?? {};
    const p7 = sessionData?.phases?.[7]?.data ?? {};

    // Assainissement collectif → pas besoin de calculer ANC
    const assainissement = terrain.assainissement ?? 'inconnu';
    if (assainissement === 'collectif') {
      return {
        type: 'collectif',
        label: 'Raccordement collectif (tout-à-l\'égout)',
        besoinANC: false,
        note: 'Pas d\'ANC requis — raccordement au réseau public.',
      };
    }

    const surface = parseFloat(terrain.contenance_m2 ?? 0);
    if (surface <= 0) return null;

    const pente = parseFloat(terrain.pente_moy_pct ?? 5);
    const nappe = parseFloat(terrain.nappe_m ?? terrain.profondeur_nappe_m ?? 3);
    const brgmPerm = terrain.geologie?.permeability ?? terrain.brgm_permeability ?? null;
    const kOverride = terrain.anc_k_mmh ? parseFloat(terrain.anc_k_mmh) : undefined;

    // Équivalent-habitants depuis gabarit P7
    const usage = p7.usage ?? terrain.usage ?? 'individuel';
    const occupants = parseInt(p7.occupants ?? terrain.occupants ?? 4, 10);
    const surfHab = parseFloat(p7.gabarit_l_m ?? 10) * parseFloat(p7.gabarit_w_m ?? 8);
    const eh = this.estimerEH(usage, occupants, surfHab);

    // Recommandation
    const reco = this.recommanderFiliere({
      k: kOverride, kOverride, brgmPermeability: brgmPerm,
      pente_pct: pente, surface_m2: surface, nappe_m: nappe, eh,
    });

    // Dimensionnement de la filière recommandée
    const best = reco.recommandation;
    const dim = best ? this.dimensionner(best.id, eh) : null;
    const cout = best ? this.estimerCout(best.id, eh, pente) : null;

    // Conformité PLU
    const pluRules = sessionData?.pluResolved ?? sessionData?.phases?.[4]?.data ?? {};
    const conformite = this.verifierConformite(terrain, pluRules);

    // SPANC
    const interco = terrain.interco ?? terrain.intercommunalite ?? null;
    const spanc = this.getSPANC(interco);

    // Placement géométrique sur parcelle (si proposal disponible)
    let placement = null;
    const parcelPoly = sessionData?._parcelLocal;
    const activeProposal = sessionData?._activeProposal ?? sessionData?.proposal;
    if (dim && parcelPoly && activeProposal) {
      const bloc = activeProposal.blocs?.[0] ?? activeProposal;
      const building = {
        polygon: bloc.polygon ?? null,
        aabb:    activeProposal.bat ?? bloc.aabb ?? null,
      };
      if (building.polygon || building.aabb) {
        placement = this.placerSurParcelle(dim, building, parcelPoly);
      }
    }

    // Score ANC (0-100) : synthèse faisabilité (pénalité si placement infaisable)
    let score = best ? this._computeScore(best, conformite, pente, nappe) : 0;
    if (placement && !placement.feasible) score = Math.max(0, score - 25);
    const lbl = this._labelFromScore(score);

    return {
      type: assainissement === 'ANC' ? 'ANC' : 'inconnu',
      besoinANC: true,
      label: assainissement === 'ANC'
        ? 'Assainissement Non Collectif obligatoire'
        : 'Statut inconnu — vérifier auprès de la mairie',
      eh,
      volume_m3_jour: reco.volume_m3_jour,
      classeK: reco.classeK,
      k_mmh: reco.k_mmh,
      pente_pct: pente,
      nappe_m: nappe,
      recommandation: best ? {
        id: best.id,
        label: best.filiere.short,
        description: best.filiere.description,
        score: best.score,
        alertes: best.alertes,
        emprise_m2: best.empriseTotal_m2,
      } : null,
      alternatives: reco.alternatives.map(a => ({
        id: a.id,
        label: a.filiere.short,
        score: a.score,
        emprise_m2: a.empriseTotal_m2,
        alertes: a.alertes,
      })),
      dimensionnement: dim,
      placement,
      cout,
      conformite,
      spanc,
      score,
      scoreLabel: lbl.label,
      scoreColor: lbl.color,
      source_note: 'DTU 64.1 · Arrêté 7 sept. 2009 · Guide SPANC Réunion',
    };
  },

  // ── Score de faisabilité ANC (0-100) ─────────────────────────────
  _computeScore(best, conformite, pente, nappe) {
    let score = best.score;

    // Pénalités conformité
    for (const c of conformite) {
      if (c.severity === 'error') score -= 25;
      else if (c.severity === 'warning') score -= 10;
    }

    return Math.max(0, Math.min(100, score));
  },

  _labelFromScore(score) {
    if (score >= 70) return { label: 'Faisable',     color: 'var(--success)' };
    if (score >= 45) return { label: 'Sous réserves', color: 'var(--warning)' };
    if (score >= 20) return { label: 'Contraint',    color: 'var(--accent)' };
    return                   { label: 'Très contraint', color: 'var(--danger)' };
  },

  // ══════════════════════════════════════════════════════════════════
  // PLACEMENT GÉOMÉTRIQUE — sur parcelle, aligné au bâtiment
  // ══════════════════════════════════════════════════════════════════

  /**
   * Place fosse + zone traitement sur la parcelle, aligné à l'orientation
   * principale du bâtiment, côté avec le plus d'espace libre.
   *
   * @param {Object}   dim       — résultat ANCService.dimensionner()
   * @param {Object}   building  — { polygon: [{x,y}...], aabb: {x,y,w,l} }
   * @param {Array}    parcelPoly — polygone parcelle [[x,y], ...] ou [{x,y}...]
   * @param {Object}   [opts]    — { gapFosse_m, gapTrait_m, reculParcelle_m }
   * @returns {Object} { fosse, traitement, feasible, margin_m, reductionBatiment_m2, candidats }
   */
  placerSurParcelle(dim, building, parcelPoly, opts = {}) {
    const gapFosse = opts.gapFosse_m ?? 3;
    const gapTrait = opts.gapTrait_m ?? 2;
    const reculParcelle = opts.reculParcelle_m ?? (dim?.reculs?.limite_parcelle ?? 5);

    if (!dim || !building || !parcelPoly || parcelPoly.length < 3) {
      return { feasible: false, reason: 'Donnees insuffisantes' };
    }

    // Normaliser parcelle en [[x,y],...]
    const parcel = parcelPoly.map(p => Array.isArray(p) ? p : [p.x, p.y]);

    // Orientation du bâtiment : angle de l'arête la plus longue
    const bldgPoly = building.polygon && building.polygon.length >= 3
      ? building.polygon.map(p => ({ x: p.x ?? p[0], y: p.y ?? p[1] }))
      : null;
    const orient = bldgPoly
      ? this._buildingOrientation(bldgPoly)
      : { angle: 0, cx: building.aabb.x + building.aabb.w / 2, cy: building.aabb.y + building.aabb.l / 2 };

    // Dimensions ANC
    const fosseLong = dim.fosse?.longueur_m ?? 2.5;
    const fosseLarg = dim.fosse?.largeur_m ?? 1.2;
    const traitW = this._traitW(dim);
    const traitH = this._traitH(dim);

    // Points d'ancrage sur les 4 côtés du bâtiment, en repère local (bâtiment à l'origine, angle 0)
    // - "mid-side" local coordinates depuis le centre bâtiment
    const bldgW = orient.width  ?? building.aabb?.w ?? 10;
    const bldgL = orient.length ?? building.aabb?.l ?? 10;

    const sides = [
      { name: 'sud', dxLocal: 0,             dyLocal: -bldgL / 2, normalLocal: { x: 0, y: -1 } },
      { name: 'nord', dxLocal: 0,            dyLocal:  bldgL / 2, normalLocal: { x: 0, y:  1 } },
      { name: 'est',  dxLocal:  bldgW / 2,   dyLocal: 0,          normalLocal: { x: 1, y:  0 } },
      { name: 'ouest',dxLocal: -bldgW / 2,   dyLocal: 0,          normalLocal: { x:-1, y:  0 } },
    ];

    const cosA = Math.cos(orient.angle);
    const sinA = Math.sin(orient.angle);
    const rotate = (lx, ly) => ({
      x: orient.cx + lx * cosA - ly * sinA,
      y: orient.cy + lx * sinA + ly * cosA,
    });

    // Tester chaque côté
    const candidats = [];
    for (const s of sides) {
      // Point médian du côté
      const mid = rotate(s.dxLocal, s.dyLocal);
      // Normale sortante en repère global
      const nx = s.normalLocal.x * cosA - s.normalLocal.y * sinA;
      const ny = s.normalLocal.x * sinA + s.normalLocal.y * cosA;

      // Centre fosse : à gapFosse + fosseLarg/2 du bord bâtiment, le long de la normale
      const fosseDist = gapFosse + fosseLarg / 2;
      const fosseCx = mid.x + nx * fosseDist;
      const fosseCy = mid.y + ny * fosseDist;

      // Centre zone traitement : au-delà de la fosse
      const traitDist = fosseDist + fosseLarg / 2 + gapTrait + traitH / 2;
      const traitCx = mid.x + nx * traitDist;
      const traitCy = mid.y + ny * traitDist;

      // Coins des deux rectangles (rotation = orient.angle pour alignement bâtiment)
      const fosseCorners = this._rotRectCorners(fosseCx, fosseCy, fosseLong, fosseLarg, orient.angle);
      const traitCorners = this._rotRectCorners(traitCx,  traitCy,  traitW,    traitH,   orient.angle);

      // Test inclusion parcelle avec recul
      const parcelShrunk = this._insetPolygon(parcel, reculParcelle);
      const fosseInside = fosseCorners.every(p => this._pointInPoly(p, parcelShrunk));
      const traitInside = traitCorners.every(p => this._pointInPoly(p, parcelShrunk));
      const allInside = fosseInside && traitInside;

      // Marge minimale (distance du coin le plus proche au bord de parcelle rétrécie)
      let margin = Infinity;
      for (const p of [...fosseCorners, ...traitCorners]) {
        const d = this._distPointToPoly(p, parcel) - reculParcelle;
        if (d < margin) margin = d;
      }

      candidats.push({
        side: s.name,
        fosse: { cx: fosseCx, cy: fosseCy, w: fosseLong, h: fosseLarg, rotation: orient.angle },
        traitement: { cx: traitCx, cy: traitCy, w: traitW, h: traitH, rotation: orient.angle },
        inside: allInside,
        fosseInside, traitInside,
        margin: +margin.toFixed(2),
      });
    }

    // Priorité : (1) tout inside, (2) meilleure marge
    candidats.sort((a, b) => {
      if (a.inside !== b.inside) return a.inside ? -1 : 1;
      return b.margin - a.margin;
    });
    const best = candidats[0];

    // Si infaisable → calculer réduction bâtiment nécessaire
    let reductionBat_m2 = 0;
    if (!best.inside) {
      // Emprise ANC nécessaire (fosse + trait + gaps + reculs)
      const empriseANC = dim.empriseTotal_m2 + Math.PI * (reculParcelle ** 2) * 0.3; // approx
      reductionBat_m2 = Math.max(0, Math.round(empriseANC - Math.abs(best.margin) * 10));
    }

    return {
      feasible: best.inside,
      fosse: best.fosse,
      traitement: best.traitement,
      side: best.side,
      margin_m: best.margin,
      orientation_deg: +(orient.angle * 180 / Math.PI).toFixed(1),
      reductionBatiment_m2: reductionBat_m2,
      candidats,
    };
  },

  // ── Orientation bâtiment depuis son polygone (arête la plus longue) ──
  _buildingOrientation(pts) {
    let maxLen = 0, bestAngle = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len > maxLen) {
        maxLen = len;
        bestAngle = Math.atan2(dy, dx);
      }
    }
    // Centre = centroïde
    let cx = 0, cy = 0, area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const cross = a.x * b.y - b.x * a.y;
      cx += (a.x + b.x) * cross;
      cy += (a.y + b.y) * cross;
      area += cross;
    }
    area *= 0.5;
    if (Math.abs(area) > 1e-6) { cx /= (6 * area); cy /= (6 * area); }
    else { cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
           cy = pts.reduce((s, p) => s + p.y, 0) / pts.length; }

    // AABB local pour width/length (en repère aligné bâtiment)
    const c = Math.cos(-bestAngle), s = Math.sin(-bestAngle);
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const p of pts) {
      const lx = (p.x - cx) * c - (p.y - cy) * s;
      const ly = (p.x - cx) * s + (p.y - cy) * c;
      if (lx < xmin) xmin = lx; if (lx > xmax) xmax = lx;
      if (ly < ymin) ymin = ly; if (ly > ymax) ymax = ly;
    }
    return { angle: bestAngle, cx, cy, width: xmax - xmin, length: ymax - ymin };
  },

  _rotRectCorners(cx, cy, w, h, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const hw = w / 2, hh = h / 2;
    return [
      [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]
    ].map(([lx, ly]) => [cx + lx * c - ly * s, cy + lx * s + ly * c]);
  },

  _traitW(dim) {
    if (dim.tranchees) return Math.max(4, dim.tranchees.nombre * dim.tranchees.entraxe_m);
    if (dim.filtres)   return Math.max(3, Math.sqrt(dim.filtres.total_m2) * 1.3);
    return Math.max(2, Math.sqrt(dim.empriseFiliere_m2 ?? 10));
  },
  _traitH(dim) {
    if (dim.tranchees) return Math.max(3, dim.tranchees.longueur_m * 0.5);
    if (dim.filtres)   return Math.max(2.5, Math.sqrt(dim.filtres.total_m2) * 0.8);
    return Math.max(2, Math.sqrt(dim.empriseFiliere_m2 ?? 10) * 0.7);
  },

  _pointInPoly(p, poly) {
    const x = p[0] ?? p.x, y = p[1] ?? p.y;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0] ?? poly[i].x, yi = poly[i][1] ?? poly[i].y;
      const xj = poly[j][0] ?? poly[j].x, yj = poly[j][1] ?? poly[j].y;
      const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  },

  _distPointToPoly(p, poly) {
    const x = p[0] ?? p.x, y = p[1] ?? p.y;
    let minD = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ax = a[0] ?? a.x, ay = a[1] ?? a.y;
      const bx = b[0] ?? b.x, by = b[1] ?? b.y;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = ax + t * dx, py = ay + t * dy;
      const d = Math.hypot(x - px, y - py);
      if (d < minD) minD = d;
    }
    const sign = this._pointInPoly(p, poly) ? 1 : -1;
    return sign * minD;
  },

  _insetPolygon(poly, d) {
    // Shrink simple par normale bissectrice
    const n = poly.length;
    if (n < 3 || d <= 0) return poly;
    let sa = 0;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const ax = a[0] ?? a.x, ay = a[1] ?? a.y;
      const bx = b[0] ?? b.x, by = b[1] ?? b.y;
      sa += ax * by - bx * ay;
    }
    const ccw = sa > 0 ? 1 : -1;
    const out = [];
    for (let i = 0; i < n; i++) {
      const prev = poly[(i - 1 + n) % n], curr = poly[i], next = poly[(i + 1) % n];
      const px = prev[0] ?? prev.x, py = prev[1] ?? prev.y;
      const cx = curr[0] ?? curr.x, cy = curr[1] ?? curr.y;
      const nx = next[0] ?? next.x, ny = next[1] ?? next.y;
      const d1x = cx - px, d1y = cy - py, l1 = Math.hypot(d1x, d1y) || 1;
      const d2x = nx - cx, d2y = ny - cy, l2 = Math.hypot(d2x, d2y) || 1;
      const n1x = -ccw * d1y / l1, n1y = ccw * d1x / l1;
      const n2x = -ccw * d2y / l2, n2y = ccw * d2x / l2;
      let bxn = n1x + n2x, byn = n1y + n2y;
      const bl = Math.hypot(bxn, byn) || 1;
      bxn /= bl; byn /= bl;
      out.push([cx + bxn * d, cy + byn * d]);
    }
    return out;
  },

  // ── Accesseurs catalogue ─────────────────────────────────────────
  getFilieres()        { return FILIERES; },
  getClassesK()        { return CLASSES_K; },
  getSPANCContacts()   { return SPANC_CONTACTS; },
};

export default ANCService;
