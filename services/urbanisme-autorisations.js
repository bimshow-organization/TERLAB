// TERLAB · services/urbanisme-autorisations.js
// Points d'attention — Régime des autorisations d'urbanisme
// Basé sur les cours d'urbanisme ENSA La Réunion
// Code de l'urbanisme : R.421-1 à R.421-17, R.431-2
// MGA Architecture 2026

const UrbanismeAutorisations = {

  // ── Seuils réglementaires ─────────────────────────────────────
  SEUILS: {
    // Déclaration préalable vs Permis de construire
    dp_max_m2:           20,   // SDP ou emprise max pour DP (hors zone U PLU)
    dp_max_zone_u_m2:    40,   // SDP ou emprise max pour DP en zone U avec PLU
    pc_architecte_m2:   150,   // Seuil recours architecte obligatoire (depuis 01/03/2017)
    // Constructions sans autorisation
    libre_max_m2:         5,   // SDP ou emprise max sans autorisation
    libre_h_max_m:       12,   // Hauteur max sans autorisation (si SDP ≤ 5m²)
    // Murs
    mur_dp_h_m:           2,   // Mur > 2m → DP
    // Piscines
    piscine_dp_max_m2:  100,   // Piscine ≤ 100m² → DP, > 100m² → PC
    piscine_couv_h_m:   1.8,   // Couverture piscine > 1.80m → PC
  },

  // ── Durées de validité ────────────────────────────────────────
  VALIDITES: {
    dp:  { instruction: '1 mois', validite: '2 ans' },
    pc:  { instruction: '3 mois (privé) / 5 mois (ERP)', validite: '3 ans (prolongeable 5 ans)' },
    pcmi: { instruction: '2 mois', validite: '3 ans (prolongeable 5 ans)' },
  },

  // ── Évaluation principale ─────────────────────────────────────
  // Retourne { regime, cerfa, points[], validite }
  evaluate(params) {
    const {
      surface_plancher = 0,   // m² SDP
      emprise_sol = 0,        // m² emprise au sol
      hauteur = 0,            // m hauteur max
      niveaux = 1,
      est_construction_neuve = true,
      est_zone_u_plu = false, // zone U couverte par PLU
      est_erp = false,
      est_maison_individuelle = true,
      changement_destination = false,
      modification_facade = false,
      modification_structure = false,
      zone_protegee = false,  // site patrimonial, abords MH, etc.
      contenance_parcelle = 0,
    } = params;

    const sdp = Math.max(surface_plancher, 0);
    const emp = Math.max(emprise_sol, 0);
    const h   = Math.max(hauteur, 0);
    const surface_ref = Math.max(sdp, emp); // on prend le max des deux

    const points = [];
    let regime, cerfa;

    // ── 1. Déterminer le régime d'autorisation ──────────────────

    const seuil_dp = est_zone_u_plu ? this.SEUILS.dp_max_zone_u_m2 : this.SEUILS.dp_max_m2;

    if (!est_construction_neuve && changement_destination) {
      // Changement de destination
      if (modification_structure || modification_facade) {
        regime = 'PC';
        cerfa  = '13409*16';
        points.push({
          type: 'info',
          titre: 'Permis de construire requis',
          texte: 'Changement de destination avec modification de structure porteuse ou de façade → PC obligatoire.',
          ref: 'Art. R.421-14 c) Code de l\'urbanisme',
        });
      } else {
        regime = 'DP';
        cerfa  = '16702*02';
        points.push({
          type: 'info',
          titre: 'Déclaration préalable suffisante',
          texte: 'Changement de destination sans modification en façade ni en structure → DP.',
          ref: 'Art. R.421-17 Code de l\'urbanisme',
        });
      }
    } else if (surface_ref <= this.SEUILS.libre_max_m2 && h <= this.SEUILS.libre_h_max_m) {
      // Aucune autorisation requise
      regime = 'LIBRE';
      cerfa  = null;
      points.push({
        type: 'ok',
        titre: 'Aucune autorisation requise',
        texte: `Surface ≤ 5 m² et hauteur ≤ 12 m → construction dispensée d'autorisation.`,
        ref: 'Art. R.421-2 Code de l\'urbanisme',
      });
    } else if (surface_ref <= this.SEUILS.libre_max_m2 && h > this.SEUILS.libre_h_max_m) {
      // Petite surface mais haute → DP
      regime = 'DP';
      cerfa  = '16702*02';
      points.push({
        type: 'attention',
        titre: 'Déclaration préalable requise (hauteur)',
        texte: `Surface ≤ 5 m² mais hauteur > 12 m → DP obligatoire.`,
        ref: 'Art. R.421-9 Code de l\'urbanisme',
      });
    } else if (surface_ref <= seuil_dp) {
      // Déclaration préalable
      regime = 'DP';
      cerfa  = '16702*02';
      points.push({
        type: 'info',
        titre: `Déclaration préalable (CERFA ${cerfa})`,
        texte: `Surface ${sdp > 0 ? sdp.toFixed(0) + ' m²' : '—'} ≤ ${seuil_dp} m²${est_zone_u_plu ? ' (seuil zone U PLU)' : ''} → DP.`,
        ref: 'Art. R.421-9 Code de l\'urbanisme',
      });
    } else {
      // Permis de construire
      if (est_maison_individuelle && !est_erp) {
        regime = 'PCMI';
        cerfa  = '13406*15';
        points.push({
          type: 'attention',
          titre: `Permis de construire MI (CERFA ${cerfa})`,
          texte: `Surface > ${seuil_dp} m² — Permis de construire maison individuelle requis.`,
          ref: 'Art. R.421-1 Code de l\'urbanisme',
        });
      } else {
        regime = 'PC';
        cerfa  = '13409*16';
        points.push({
          type: 'attention',
          titre: `Permis de construire (CERFA ${cerfa})`,
          texte: `Surface > ${seuil_dp} m² — Permis de construire requis.`,
          ref: 'Art. R.421-1 Code de l\'urbanisme',
        });
      }
    }

    // ── 2. Points d'attention complémentaires ───────────────────

    // Architecte obligatoire à partir de 150 m²
    if (sdp > this.SEUILS.pc_architecte_m2) {
      points.push({
        type: 'important',
        titre: 'Recours à un architecte obligatoire',
        texte: `Surface de plancher ${sdp.toFixed(0)} m² > 150 m² → architecte DPLG/HMONP obligatoire (loi du 1er mars 2017).`,
        ref: 'Art. R.431-2 Code de l\'urbanisme',
      });
    } else if (sdp > 0 && sdp <= this.SEUILS.pc_architecte_m2 && regime !== 'LIBRE' && regime !== 'DP') {
      points.push({
        type: 'ok',
        titre: 'Architecte non obligatoire (mais recommandé)',
        texte: `Surface de plancher ${sdp.toFixed(0)} m² ≤ 150 m² — dispense de recours obligatoire à un architecte pour une MI. Un accompagnement reste recommandé.`,
        ref: 'Art. R.431-2 Code de l\'urbanisme',
      });
    }

    // Zone protégée → DP minimum
    if (zone_protegee && regime === 'LIBRE') {
      regime = 'DP';
      cerfa  = '16702*02';
      points.push({
        type: 'attention',
        titre: 'Zone protégée — DP obligatoire',
        texte: 'Travaux en périmètre de site patrimonial classé, abords MH ou réserve naturelle → DP minimum obligatoire, même pour travaux mineurs.',
        ref: 'Art. R.421-11 Code de l\'urbanisme',
      });
    }

    // Rappel surface de plancher (définition)
    if (sdp > 0 && niveaux > 1) {
      const sdp_par_niveau = sdp / niveaux;
      points.push({
        type: 'info',
        titre: 'Surface de plancher — calcul',
        texte: `SDP totale ${sdp.toFixed(0)} m² sur ${niveaux} niveaux ≈ ${sdp_par_niveau.toFixed(0)} m²/niveau. La SDP se calcule à partir du nu intérieur des murs, hauteur sous plafond > 1,80 m, hors stationnement et combles non aménageables.`,
        ref: 'Art. L.112-1 Code de l\'urbanisme',
      });
    }

    // Emprise au sol vs surface de plancher
    if (emp > 0 && sdp > 0 && emp !== sdp) {
      points.push({
        type: 'info',
        titre: 'Emprise au sol ≠ Surface de plancher',
        texte: `Emprise au sol : ${emp.toFixed(0)} m² — SDP : ${sdp.toFixed(0)} m². Les deux critères sont évalués indépendamment : c'est le seuil le plus contraignant qui s'applique.`,
        ref: 'Art. R.420-1 Code de l\'urbanisme',
      });
    }

    // ERP
    if (est_erp) {
      points.push({
        type: 'important',
        titre: 'Établissement recevant du public',
        texte: 'Délai d\'instruction majoré à 5 mois. Commission de sécurité et d\'accessibilité obligatoire.',
        ref: 'Art. R.423-28 Code de l\'urbanisme',
      });
    }

    // Durée de validité
    const regimeKey = regime === 'PCMI' ? 'pcmi' : regime === 'PC' ? 'pc' : regime === 'DP' ? 'dp' : null;
    if (regimeKey && this.VALIDITES[regimeKey]) {
      const v = this.VALIDITES[regimeKey];
      points.push({
        type: 'info',
        titre: `Délais — ${regime}`,
        texte: `Instruction : ${v.instruction}${regime === 'DP' ? ' (ou tacite)' : ''}. Validité : ${v.validite}. Les travaux doivent débuter dans ce délai.`,
        ref: 'Art. R.423-23 / R.424-17 Code de l\'urbanisme',
      });
    }

    // CU recommandé
    if (contenance_parcelle > 0 && regime !== 'LIBRE') {
      points.push({
        type: 'conseil',
        titre: 'Certificat d\'urbanisme recommandé',
        texte: 'Avant tout dépôt, demander un CUb (certificat opérationnel) pour confirmer la faisabilité. Le CU gèle les règles pendant 18 mois. Attention : un CU positif n\'est pas un accord de construction.',
        ref: 'Art. L.410-1 Code de l\'urbanisme',
      });
    }

    return {
      regime,
      cerfa,
      points,
      validite: regimeKey ? this.VALIDITES[regimeKey] : null,
      seuil_dp_applique: seuil_dp,
      est_zone_u_plu,
    };
  },

  // ── Helper : extraire les params depuis la session TERLAB ─────
  fromSession(session) {
    const terrain = session?.terrain ?? {};
    const p7data  = session?.phases?.[7]?.data ?? {};
    const p4data  = session?.phases?.[4]?.data ?? {};
    const pluCfg  = window.TERLAB_PLU_CONFIG ?? null;

    const L = parseFloat(p7data.gabarit_l_m ?? 0);
    const W = parseFloat(p7data.gabarit_w_m ?? 0);
    const H = parseFloat(p7data.gabarit_h_m ?? 0);
    const niveaux = parseInt(p7data.niveaux ?? 1);
    const sdp = parseFloat(p7data.surface_plancher_m2 ?? 0);
    const emprise = L * W;

    // Déterminer si zone U avec PLU
    const zonePlu = pluCfg?.plu?.zone ?? p4data.zone_plu ?? terrain.zone_plu ?? '';
    const zoneType = pluCfg?.plu?.type ?? (
      zonePlu.startsWith('AU') ? 'AU' :
      zonePlu.startsWith('U')  ? 'U'  :
      zonePlu.startsWith('A')  ? 'A'  :
      zonePlu.startsWith('N')  ? 'N'  : ''
    );
    const est_zone_u_plu = zoneType === 'U';

    const contenance = pluCfg?.area ?? parseFloat(terrain.contenance_m2 ?? 0);

    return this.evaluate({
      surface_plancher: sdp,
      emprise_sol: emprise,
      hauteur: H,
      niveaux,
      est_construction_neuve: true,
      est_zone_u_plu,
      est_erp: false,
      est_maison_individuelle: niveaux <= 3 && sdp <= 500,
      changement_destination: false,
      modification_facade: false,
      modification_structure: false,
      zone_protegee: false,
      contenance_parcelle: contenance,
    });
  },

  // ── Évaluation rapide depuis les inputs P07 (live) ────────────
  fromP07Inputs() {
    const L   = parseFloat(document.getElementById('sp-l')?.value ?? 0);
    const W   = parseFloat(document.getElementById('sp-w')?.value ?? 0);
    const H   = parseFloat(document.getElementById('sp-h')?.value ?? 0);
    const niv = parseInt(document.getElementById('sp-niveaux')?.value ?? 1);
    const sdp = parseFloat(document.getElementById('sp-m2')?.value ?? 0);

    const pluCfg = window.TERLAB_PLU_CONFIG ?? null;
    const terrain = window.SessionManager?.getTerrain?.() ?? {};
    const p4data  = window.SessionManager?.getPhase?.(4)?.data ?? {};

    const zonePlu = pluCfg?.plu?.zone ?? p4data.zone_plu ?? terrain.zone_plu ?? '';
    const zoneType = pluCfg?.plu?.type ?? (
      zonePlu.startsWith('U') && !zonePlu.startsWith('AU') ? 'U' : ''
    );

    const contenance = pluCfg?.area ?? parseFloat(terrain?.contenance_m2 ?? 0);

    return this.evaluate({
      surface_plancher: sdp,
      emprise_sol: L * W,
      hauteur: H,
      niveaux: niv,
      est_construction_neuve: true,
      est_zone_u_plu: zoneType === 'U',
      est_erp: false,
      est_maison_individuelle: niv <= 3 && sdp <= 500,
      contenance_parcelle: contenance,
    });
  },
};

export default UrbanismeAutorisations;

// Expose pour compatibilité non-module TERLAB
if (typeof window !== 'undefined') window.UrbanismeAutorisations = UrbanismeAutorisations;
