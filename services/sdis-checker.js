// terlab/services/sdis-checker.js · Vérifications sécurité incendie p07 · v1.0
// Sources : Arrêté 31 jan. 1986 · CCH R.122 · AP DECI 974 · RTAA DOM 2016
// ENSA La Réunion · MGA Architecture 2026

export const SdisChecker = {

  // ── SEUILS ──────────────────────────────────────────────────────
  SEUILS: {
    H_2F: 8,      // m — seuil 2ème famille
    H_3F: 28,     // m — seuil 3ème famille → 4ème
    H_IGH_HAB: 50,// m — IGH habitation
    H_IGH_BUR: 28,// m — IGH bureaux/ERP
    VOIE_L: 3.0,  // m — largeur utile voie pompiers
    VOIE_H: 3.5,  // m — gabarit hauteur
    VOIE_PENTE: 15,// % — pente max
    VOIE_CHARGE: 130, // kN (13T)
    FACADE_DIST: 8,  // m — distance max façade accessible / voie échelle
    ESPACE_LIBRE_L: 10, // m — longueur espace libre façade
    ESPACE_LIBRE_P: 7,  // m — profondeur espace libre façade
    HYDRANT_FAM12: 200, // m — distance max hydrant fam. 1+2
    HYDRANT_FAM34: 150, // m — distance max hydrant fam. 3+4
    HYDRANT_DEBIT_1: 60, // m³/h — débit fam. 1+2
    HYDRANT_DEBIT_3: 60, // m³/h — débit fam. 3
    HYDRANT_DEBIT_4: 120,// m³/h — débit fam. 4
    DIST_MIN_BAT: 4, // m — distance entre bâtiments (Réunion UC/UA)
    CS_SEUIL: 3,  // à partir du 3ème niveau → colonne sèche recommandée
  },

  // ── DÉTERMINATION FAMILLE HABITATION ────────────────────────────
  getFamilleHabitation(nvEff, distFacadeVoie, type) {
    const h_PE = (nvEff - 1) * 3.0;

    if (type === 'maison') {
      if (nvEff <= 2) return { code: 'F1', nom: '1ère famille', h_PE };
      return { code: 'F2', nom: '2ème famille', h_PE };
    }

    // Collectif
    if (h_PE <= 0 && nvEff === 1) return { code: 'F1', nom: '1ère famille (RdC)', h_PE: 0 };
    if (h_PE <= this.SEUILS.H_2F) return { code: 'F2', nom: '2ème famille', h_PE };
    if (h_PE <= this.SEUILS.H_3F) {
      const accessible = distFacadeVoie !== null && distFacadeVoie <= this.SEUILS.FACADE_DIST;
      return {
        code: accessible ? 'F3A' : 'F3B',
        nom: accessible ? '3ème famille A' : '3ème famille B',
        h_PE,
        accessible,
      };
    }
    if (h_PE <= this.SEUILS.H_IGH_HAB) return { code: 'F4', nom: '4ème famille', h_PE };
    return { code: 'IGH', nom: 'IGH — Immeuble Grande Hauteur', h_PE };
  },

  // ── CATÉGORIE ERP ────────────────────────────────────────────────
  getCategorieERP(effectif) {
    if (effectif > 1500) return { code: 'CAT1', nom: '1ère catégorie', effectif };
    if (effectif > 700)  return { code: 'CAT2', nom: '2ème catégorie', effectif };
    if (effectif > 300)  return { code: 'CAT3', nom: '3ème catégorie', effectif };
    if (effectif > 200)  return { code: 'CAT4', nom: '4ème catégorie', effectif };
    return { code: 'CAT5', nom: '5ème catégorie (petit ERP)', effectif };
  },

  // ── CHECKS PRINCIPAUX ────────────────────────────────────────────
  // session   : données TERLAB (session p04/p07)
  // metrics   : résultat PlanMasseEngine.metrics()
  // batGeo    : { distFacadeVoie, distInterBat, facadeLong }
  run(session, metrics, batGeo = {}) {
    const plu   = session?.terrain?.plu ?? {};
    const nvEff = metrics?.nvEff ?? 1;
    const type  = metrics?.type ?? 'collectif';
    const nbLgts = metrics?.nbLgts ?? 0;
    const emprise = metrics?.emprise ?? 0;
    const hBat   = nvEff * 3.0;
    const h_PE   = (nvEff - 1) * 3.0;
    const { distFacadeVoie = null, distInterBat = null, facadeLong = null } = batGeo;

    const famille = this.getFamilleHabitation(nvEff, distFacadeVoie, type);
    const checks  = [];

    // ── A. VOIE D'ACCÈS POMPIERS ──────────────────────────────────
    checks.push({
      id:    'voie_acces',
      titre: 'Voie d\'accès pompiers',
      loi:   'CCH R.122-2 · AP DECI 974',
      ok:    true,
      critical: false,
      regle: `Largeur libre ≥ ${this.SEUILS.VOIE_L}m · Hauteur ≥ ${this.SEUILS.VOIE_H}m · Pente ≤ ${this.SEUILS.VOIE_PENTE}% · Charge ${this.SEUILS.VOIE_CHARGE} kN`,
      texte: `Toute voie d'accès au bâtiment doit permettre le passage des véhicules de secours. À La Réunion, les voies en impasse sont fréquentes — prévoir une aire de retournement de 18×18m ou un demi-tour avec rayon intérieur ≥ 11m. Les câbles EDF basse tension et les branches d'arbres (croissance rapide en zone tropicale) sont les obstructions les plus fréquentes.`,
    });

    // ── B. FAÇADE ACCESSIBLE (3ème famille A) ─────────────────────
    if (famille.code === 'F3A' || famille.code === 'F4') {
      const facadeOk = distFacadeVoie !== null && distFacadeVoie <= this.SEUILS.FACADE_DIST;
      checks.push({
        id:    'facade_accessible',
        titre: 'Façade accessible aux échelles',
        loi:   'Arr. 31/01/1986 art. 4 · 3ème famille A',
        ok:    facadeOk,
        critical: true,
        regle: `Façade accessible ≤ ${this.SEUILS.FACADE_DIST}m de la voie · Espace libre ${this.SEUILS.ESPACE_LIBRE_L}×${this.SEUILS.ESPACE_LIBRE_P}m devant façade`,
        mesure: distFacadeVoie !== null ? `${distFacadeVoie.toFixed(1)}m mesurés` : 'non calculé',
        texte: famille.code === 'F3A'
          ? `En 3ème famille A, au moins une façade doit être accessible aux engins à grande échelle. La distance entre cette façade et le bord de la voie échelle ne doit pas dépasser 8m. Un espace libre de 10m de long (le long de la façade) sur 7m de profondeur est nécessaire. Toute clôture, muret ou végétation haute dans cette bande est proscrite.`
          : `En 4ème famille (h > 28m), l'accès façade est renforcé avec voie engin sur au moins 2 côtés du bâtiment et des aires de stationnement pour EPAN (Échelle Pivotante À Nacelle).`,
        recommandation: !facadeOk ? `Reculer le bâtiment ou élargir la voie pour atteindre ≤ 8m entre façade et voie.` : null,
      });
    }

    // ── C. ESPACE LIBRE FAÇADE (3ème famille) ─────────────────────
    if (famille.code === 'F3A' && facadeLong !== null) {
      const espaceOk = facadeLong >= this.SEUILS.ESPACE_LIBRE_L;
      checks.push({
        id:    'espace_libre',
        titre: 'Espace libre façade accessible',
        loi:   'Arr. 31/01/1986 art. 5',
        ok:    espaceOk,
        critical: false,
        regle: `Longueur façade accessible ≥ ${this.SEUILS.ESPACE_LIBRE_L}m`,
        mesure: `${(facadeLong || 0).toFixed(1)}m façade`,
        texte: `L'espace libre devant la façade accessible doit permettre la mise en station d'une grande échelle. Éviter tout obstacle : mobilier urbain, bennes, arbres de fort développement dans la bande des 7m.`,
      });
    }

    // ── D. HYDRANT DECI ───────────────────────────────────────────
    const maxHydrant = ['F1', 'F2'].includes(famille.code)
      ? this.SEUILS.HYDRANT_FAM12 : this.SEUILS.HYDRANT_FAM34;
    const debitHydrant = famille.code === 'F4'
      ? this.SEUILS.HYDRANT_DEBIT_4 : this.SEUILS.HYDRANT_DEBIT_3;
    checks.push({
      id:    'deci_hydrant',
      titre: 'Défense extérieure contre l\'incendie',
      loi:   'Arrêté Préfectoral DECI 974 · D.2015-235',
      ok:    null, // à croiser avec couche réseau p05
      critical: true,
      regle: `Hydrant à ≤ ${maxHydrant}m par voie carrossable · Débit ≥ ${debitHydrant} m³/h pendant 2h`,
      texte: `À La Réunion, les hydrants (PI ou BI) doivent se situer à moins de ${maxHydrant}m du bâtiment mesuré par voie carrossable (pas à vol d'oiseau). En zone rurale ou en hauteur (Hauts), la distance peut être portée à 400m sous réserve d'accord SDIS 974. En cas de défaillance du réseau, une réserve d'eau privée (bâche ou bassin ≥ 60 m³) peut se substituer. Vérifier la pression résidence : 1 bar minimum au point de branchement.`,
      sourcesDonnees: 'Réseau AEP couche p05 · IGN WFS réseaux',
    });

    // ── E. DÉSENFUMAGE CIRCULATIONS ──────────────────────────────
    if (nvEff >= 3 || ['F3A', 'F3B', 'F4'].includes(famille.code)) {
      checks.push({
        id:    'desenfumage',
        titre: 'Désenfumage circulations',
        loi:   'Arr. 31/01/1986 art. 79–90',
        ok:    null,
        critical: false,
        regle: `Désenfumage naturel ou mécanique des cages d'escalier et paliers obligatoire dès 3ème famille`,
        texte: `Les circulations horizontales et les cages d'escalier doivent être désenfumées. En désenfumage naturel, les amenées d'air se font en bas de cage (1m² mini) et les évacuations en parties hautes (1m² mini). En zone tropicale, le tirage naturel est favorisé mais sensible aux vents dominants — orienter les bouches d'extraction face aux vents dominants (alizés E-NE à La Réunion) est déconseillé pour éviter le refoulement.`,
      });
    }

    // ── F. COLONNE SÈCHE ─────────────────────────────────────────
    if (nvEff >= this.SEUILS.CS_SEUIL || famille.code === 'F3B') {
      checks.push({
        id:    'colonne_seche',
        titre: 'Colonne sèche',
        loi:   'Arr. 31/01/1986 art. 94',
        ok:    null,
        critical: false,
        regle: `Obligatoire si ≥ ${this.SEUILS.CS_SEUIL} niveaux ou 3ème famille B`,
        texte: `Une colonne sèche doit être installée dans chaque cage d'escalier desservant des niveaux à plus de 18m de hauteur (ou dès la 3ème famille B). Raccord d'alimentation FFDI 65mm en façade ou en accès pompiers ≤ 5m du bord de voie. Un raccord de départ de 45mm par niveau. La colonne doit être visitée tous les 2 ans.`,
      });
    }

    // ── G. DISTANCE ENTRE BÂTIMENTS ──────────────────────────────
    if (distInterBat !== null) {
      const minDist = Math.max(this.SEUILS.DIST_MIN_BAT, nvEff * 3.0 / 2);
      const distOk  = distInterBat >= minDist;
      checks.push({
        id:    'dist_inter_bat',
        titre: 'Distance entre bâtiments',
        loi:   'PLU Art.8 · Règle du H/2',
        ok:    distOk,
        critical: false,
        regle: `≥ ${minDist.toFixed(1)}m (max(PLU, H/2) = max(${this.SEUILS.DIST_MIN_BAT}, ${(nvEff * 3 / 2).toFixed(1)}m))`,
        mesure: `${distInterBat.toFixed(1)}m mesuré`,
        texte: `La distance entre deux bâtiments doit permettre l'intervention des pompiers et limiter la propagation des flammes. La règle H/2 (moitié de la hauteur totale du plus grand) s'applique en complément des reculs PLU. En cas de façades aveugles en vis-à-vis, un assouplissement est possible sous réserve de l'accord de l'ABF et du SDIS.`,
      });
    }

    // ── H. SPRINKLER (3ème famille B + 4ème) ─────────────────────
    if (famille.code === 'F3B' || famille.code === 'F4') {
      checks.push({
        id:    'sprinkler',
        titre: 'Installation sprinkler',
        loi:   'CCH R.141-2 · Note DGSCGC 2012',
        ok:    null,
        critical: famille.code === 'F4',
        regle: `Recommandé F3B · Obligatoire F4 dans certaines configurations`,
        texte: `En 3ème famille B (pas de façade accessible), la mise en place d'un système d'extinction automatique à eau (SSI de type SAEI) peut compenser l'absence d'accès pompiers. En 4ème famille, le sprinkler est souvent exigé par le SDIS lors de la consultation préalable (réunion de synthèse obligatoire avant PC).`,
      });
    }

    // ── I. DÉTECTEUR AVERTISSEUR AUTONOME ─────────────────────────
    checks.push({
      id:    'daaf',
      titre: 'DAAF — Détecteur autonome avertisseur de fumée',
      loi:   'Loi n°2010-238 · CCH L.129-8',
      ok:    true,
      critical: false,
      regle: `Obligatoire dans toute habitation (1 par niveau minimum)`,
      texte: `Tout logement doit être équipé d'au moins un DAAF. À La Réunion, privilégier les modèles avec traitement anti-insectes (moustiques, fourmis électriques) qui déclenchent des fausses alarmes. Installer en haut des cages d'escalier, loin des cuisines et salles de bain. Durée de vie : 10 ans.`,
    });

    // ── J. TOITURE (RTAA DOM + risque cyclone) ────────────────────
    checks.push({
      id:    'toiture_cyclone',
      titre: 'Toiture · Résistance cyclonique (RTAA DOM)',
      loi:   'RTAA DOM 2016 · NF P 06-001',
      ok:    null,
      critical: false,
      regle: `Pente min 20° (toitures inclinées) · Fixation renforcée en zones cycloniques`,
      texte: `La toiture est la première source de propagation d'incendie en zone tropicale (tôles arrachées = projectiles + tirage). Le RTAA DOM 2016 impose des fixations renforcées pour vents jusqu'à 240 km/h (zone cyclonique C). En cas d'incendie conjugué à un cyclone, l'intervention des pompiers est impossible — la compartimentage est la seule protection.`,
    });

    // ── K. RÈGLES SPÉCIFIQUES TYPE ────────────────────────────────
    if (type !== 'maison' && type !== 'collectif') {
      const erpChecks = this._erpChecks(type, session);
      checks.push(...erpChecks);
    }

    // ── RETOUR ─────────────────────────────────────────────────────
    return {
      famille,
      hBat,
      h_PE,
      checks,
      hasWarnings:  checks.some(c => c.ok === false),
      hasCritical:  checks.some(c => c.ok === false && c.critical),
      summary:      this._buildSummary(famille, nvEff, checks),
    };
  },

  // ── ERP CHECKS ────────────────────────────────────────────────────
  _erpChecks(type, session) {
    const checks = [];
    const isERP = ['erp', 'commerce', 'bureau', 'enseignement', 'sante', 'hebergement'].includes(type);
    if (!isERP) return checks;

    checks.push({
      id:    'erp_categorie',
      titre: 'Catégorie ERP',
      loi:   'CCH R.123-2 · Arrêté 25/06/1980',
      ok:    null,
      critical: true,
      regle: `Effectif > 1500 → Cat.1 · > 700 → Cat.2 · > 300 → Cat.3 · > 200 → Cat.4 · ≤ 200 → Cat.5`,
      texte: `L'effectif total (public + personnel) détermine la catégorie ERP. Les ERP de catégories 1 à 4 sont soumis à la visite de la Commission de Sécurité avant ouverture. Les Cat.5 (petits établissements) sont soumis à visite uniquement si sous-sol ou > 1 étage. Dans tous les cas, le dossier PC doit intégrer une notice de sécurité.`,
    });

    if (type === 'bureau') {
      checks.push({
        id:    'bureau_igh',
        titre: 'Bureaux — seuil IGH',
        loi:   'CCH R.122-2 · Décret n°73-1007',
        ok:    null,
        critical: true,
        regle: `Bureaux : seuil IGH à h_plancher > 28m (vs 50m habitation)`,
        texte: `Pour les bâtiments à usage de bureaux, le seuil d'application de la réglementation IGH (Immeuble de Grande Hauteur) est abaissé à 28m de hauteur du plancher du dernier étage (contre 50m pour l'habitation). Dès R+9 environ, une consultation préalable SDIS est obligatoire.`,
      });
    }

    return checks;
  },

  // ── RÉSUMÉ PÉDAGOGIQUE ────────────────────────────────────────────
  _buildSummary(famille, nvEff, checks) {
    const nOk   = checks.filter(c => c.ok === true).length;
    const nWarn = checks.filter(c => c.ok === false).length;
    const nNa   = checks.filter(c => c.ok === null).length;

    const famTexte = {
      F1:  `Bâtiment classé **1ère famille** — réglementation allégée. DAAF obligatoire, voie d'accès 3m.`,
      F2:  `Bâtiment classé **2ème famille** (h plancher ≤ 8m). Voie 3m, hydrant ≤ 200m, pas d'obligation façade accessible.`,
      F3A: `Bâtiment classé **3ème famille A** — façade accessible obligatoire. Vérifier la distance façade/voie ≤ 8m et l'espace libre 10×7m.`,
      F3B: `Bâtiment classé **3ème famille B** — pas de façade accessible. Compensation obligatoire : colonnes sèches + désenfumage renforcé + sprinkler.`,
      F4:  `Bâtiment classé **4ème famille** (28m < h ≤ 50m). Voie engin périmétrique, EPAN, colonnes sèches, sprinkler. Consultation SDIS obligatoire avant dépôt PC.`,
      IGH: `**IGH** — réglementation spécifique DGSCGC. PC impossible sans accord SDIS et mission sécurité incendie spécialisée.`,
    };

    return {
      familleTexte: famTexte[famille.code] ?? famille.nom,
      nOk, nWarn, nNa,
      conseil: nWarn > 0
        ? `${nWarn} point(s) à corriger en esquisse — modifier la hauteur ou la position du bâtiment.`
        : `Aucun point bloquant détecté à ce stade. ${nNa} point(s) à confirmer lors des études.`,
    };
  },

  // ── GÉNÉRATION HTML — tableau checks avec icônes ──────────────────
  texteHtml(result) {
    if (!result) return '';

    const { famille, checks, summary } = result;
    const icon = (ok) => ok === true ? '✓' : ok === false ? '⚠' : '—';
    const cls  = (ok) => ok === true ? 'sdis-ok' : ok === false ? 'sdis-warn' : 'sdis-na';

    // Résumé famille avec h_PE et seuil critique
    const hPE = result.h_PE ?? 0;
    const hBat = result.hBat ?? 0;
    const seuil8 = hPE > 8;
    const seuilColor = seuil8 ? '#EF4444' : '#22C55E';
    let html = `<div style="margin-bottom:6px;padding:5px 8px;border-radius:4px;font-size:10px;`
      + `background:rgba(${seuil8 ? '239,68,68' : '34,197,94'},0.08);`
      + `border:1px solid ${seuilColor}30;color:${seuilColor}">`;
    html += `<strong>${famille.nom}</strong> · h plancher dernier étage = <strong>${hPE.toFixed(0)}m</strong>`;
    if (seuil8) {
      html += ` · <span style="color:#EF4444">seuil 8m dépassé → obligations renforcées</span>`;
    } else {
      html += ` · seuil 8m non atteint`;
    }
    html += ` · h totale bâtiment = ${hBat.toFixed(0)}m`;
    html += `</div>`;

    html += `<table class="sdis-table" style="width:100%;font-size:10px;border-collapse:collapse">`;
    html += `<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1)">`;
    html += `<th style="width:20px"></th>`;
    html += `<th style="text-align:left;padding:2px 4px;color:var(--faint,#888)">Vérification</th>`;
    html += `<th style="text-align:left;padding:2px 4px;color:var(--faint,#888)">Règle</th>`;
    html += `<th style="text-align:right;padding:2px 4px;color:var(--faint,#888)">Mesure</th>`;
    html += `</tr></thead><tbody>`;

    for (const c of checks) {
      const statusColor = c.ok === true ? '#22C55E' : c.ok === false ? '#EF4444' : '#64748b';
      const critMark = c.critical ? ' *' : '';
      const rowId = `sdis-row-${c.id}`;
      html += `<tr class="${cls(c.ok)}" style="border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer" onclick="document.getElementById('${rowId}').style.display=document.getElementById('${rowId}').style.display==='none'?'':'none'">`;
      html += `<td style="text-align:center;padding:3px 2px;color:${statusColor};font-size:12px">${icon(c.ok)}</td>`;
      html += `<td style="padding:3px 4px">${c.titre}${critMark}</td>`;
      html += `<td style="padding:3px 4px;color:var(--faint,#888);font-size:9px">${c.regle}</td>`;
      html += `<td style="text-align:right;padding:3px 4px;font-size:9px">${c.mesure ?? ''}</td>`;
      html += `</tr>`;
      // Texte pédagogique expansible (masqué par défaut, visible au clic ou si warning)
      const showByDefault = c.ok === false || (c.ok === null && c.critical);
      html += `<tr id="${rowId}" style="display:${showByDefault ? '' : 'none'}">`;
      html += `<td colspan="4" style="padding:4px 8px 6px 24px;font-size:9px;color:var(--faint,#999);line-height:1.4">`;
      html += c.texte ?? '';
      if (c.recommandation) {
        html += `<div style="margin-top:3px;color:#F97316;font-weight:600">${c.recommandation}</div>`;
      }
      if (c.loi) {
        html += `<div style="margin-top:2px;font-size:8px;color:var(--faint,#666)">Réf. : ${c.loi}</div>`;
      }
      html += `</td></tr>`;
    }

    html += `</tbody></table>`;

    // Conseil résumé
    if (summary?.conseil) {
      const conseilColor = summary.nWarn > 0 ? '#EF4444' : '#22C55E';
      html += `<div style="margin-top:6px;padding:6px 8px;border-radius:4px;font-size:10px;`
            + `background:rgba(${summary.nWarn > 0 ? '239,68,68' : '34,197,94'},0.1);`
            + `color:${conseilColor};border:1px solid ${conseilColor}30">`;
      html += summary.conseil;
      html += `</div>`;
    }

    return html;
  },
};

export default SdisChecker;

// Expose pour compatibilité non-module TERLAB
if (typeof window !== 'undefined') window.SdisChecker = SdisChecker;
