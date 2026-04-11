/**
 * PLUP07Adapter — Bridge plu-rules-reunion.json → TerrainConfig éditeur p07
 * TERLAB Phase 7 — ENSA La Réunion — MGA Architecture 2026
 * Vanilla JS ES2022+, aucune dépendance externe
 */

export class PLUP07Adapter {

  constructor() {
    this._rules = null;
    this._loaded = false;
  }

  /* ── Chargement ──────────────────────────────────────────── */

  async loadRules(url = '../data/plu-rules-reunion.json') {
    try {
      // Resoudre les chemins relatifs contre l'URL du module pour
      // fonctionner aussi bien en local qu'en sous-dossier (ex: GitHub Pages
      // /TERLAB/). Sinon `../data/...` est resolu contre document.baseURI
      // et atterrit hors du repo en prod.
      const resolved = (typeof url === 'string' && url.startsWith('.'))
        ? new URL(url, import.meta.url)
        : url;
      const resp = await fetch(resolved);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      this._rules = await resp.json();
      this._loaded = true;
      console.info('[PLUP07Adapter] Règles PLU chargées :',
        Object.keys(this._rules.communes ?? {}).length, 'communes');
    } catch (err) {
      console.error('[PLUP07Adapter] Erreur chargement PLU :', err);
      this._rules = null;
    }
    return this;
  }

  /* ── Résolution ──────────────────────────────────────────── */

  resolve(codeInsee, zonePlu, zoneRtaa = '1', options = {}) {
    const warnings = [];

    if (!this._loaded || !this._rules) {
      return this._fallback(codeInsee, zonePlu, zoneRtaa,
        ['plu-rules-reunion.json non chargé — utilisation valeurs par défaut'],
        0, 'RULES_NOT_LOADED');
    }

    // Trouver commune par code INSEE ou par nom
    let communeData = this._rules.communes?.[codeInsee];
    if (!communeData) {
      communeData = Object.values(this._rules.communes ?? {})
        .find(c => (c.meta?.commune ?? c.nom)?.toLowerCase() === codeInsee?.toLowerCase());
    }
    if (!communeData) {
      const w = (typeof window !== 'undefined') ? window : {};
      const communeName = w.SessionManager?.getTerrain?.()?.commune ?? codeInsee;
      console.warn(`plu-p07-adapter: commune ${codeInsee} (${communeName}) absente de plu-rules-reunion.json — valeurs par défaut RTAA`);
      w.TerlabToast?.show?.(`PLU ${communeName} : données non disponibles — valeurs RTAA par défaut`, 'warning', 5000);
      return this._fallback(codeInsee, zonePlu, zoneRtaa,
        [`Commune ${codeInsee} (${communeName}) absente de plu-rules-reunion.json`],
        0, 'COMMUNE_MISSING');
    }

    // ── Vérification age de la donnée PLU ──────────────────────
    const dateApprob = communeData.meta?.plu_date_approbation;
    if (dateApprob) {
      const ageYears = (Date.now() - new Date(dateApprob).getTime()) / (365.25 * 24 * 3600 * 1000);
      if (ageYears > 8) {
        warnings.push(`ℹ PLU approuvé en ${dateApprob.slice(0,4)} (${Math.floor(ageYears)} ans) — vérifier les modifications récentes`);
      }
    }

    // Trouver zone
    let zoneData = communeData.zones?.[zonePlu];
    let resolvedZoneKey = zonePlu;

    // Résoudre les références (ex: AU3 → ref_zone U3)
    if (zoneData?.ref_zone || zoneData?.ref) {
      const refKey = zoneData.ref_zone ?? zoneData.ref;
      const refData = communeData.zones?.[refKey];
      if (refData) {
        // Fusionner : zone référencée comme base, zone actuelle en override
        zoneData = this._mergeZone(refData, zoneData);
        warnings.push(`Zone "${resolvedZoneKey}" réfère à "${refKey}" — règles héritées`);
      }
    }

    if (!zoneData) {
      // Chercher zone similaire (AU3c → AU3, AU3 → AU, etc.)
      const similar = this._findSimilarZone(communeData.zones, zonePlu);
      if (similar) {
        zoneData = similar.data;
        resolvedZoneKey = similar.key;
        warnings.push(`Zone "${zonePlu}" inconnue → fallback "${similar.key}"`);
        // Résoudre les références sur la zone trouvée aussi
        if (zoneData.ref_zone || zoneData.ref) {
          const refKey = zoneData.ref_zone ?? zoneData.ref;
          const refData = communeData.zones?.[refKey];
          if (refData) zoneData = this._mergeZone(refData, zoneData);
        }
      } else {
        return this._fallback(codeInsee, zonePlu, zoneRtaa,
          [`Zone "${zonePlu}" introuvable dans commune ${codeInsee}`],
          0.3, 'ZONE_MISSING');
      }
    }

    // ── Résolution AVAP : si zone contient des secteurs (S1-S6) ──
    let avapData = null;
    if (zoneData.secteurs) {
      const secteurKey = options.secteurAvap ?? 'S1';
      const secteur = zoneData.secteurs[secteurKey];
      if (secteur) {
        avapData = {
          secteur:    secteurKey,
          label:      secteur.label,
          caractere:  secteur.caractere,
          proximite:  zoneData.regles_proximite_patrimoniale ?? null,
          prescriptions: zoneData.prescriptions_architecturales ?? null,
          espaces_libres: zoneData.espaces_libres ?? null,
          dependances: zoneData.dependances_front_rue ?? null,
        };
        // Aplatir les règles du secteur dans le format attendu par le pipeline
        const sr = secteur.reculs ?? {};
        const sh = secteur.hauteurs ?? {};
        const se = secteur.emprise ?? {};
        zoneData = {
          ...zoneData,
          reculs: {
            voie_principale_m: this._parseReculAvap(sr.voie, 4),
            voie_alignement:   sr.voie?.includes?.('Alignement') ?? false,
            sep_lat_m:         this._parseReculAvap(sr.sep_lat, 4),
            sep_lat_limite_autorisee: sr.sep_lat?.includes?.('limites') ?? true,
            inter_batiments_m: Array.isArray(sr.entre_batiments_meme_parcelle_m)
              ? sr.entre_batiments_meme_parcelle_m[0] : (sr.entre_batiments_meme_parcelle_m ?? 4),
            voie_note: sr.voie,
            sep_lat_note: sr.sep_lat,
          },
          hauteurs: {
            hf_max_m:  sh.H_max_m ?? null,
            he_max_m:  sh.He_max_m ?? null,
            h_max_m:   sh.H_max_m ?? null,
            hauteur_note: `AVAP ${secteurKey} : ${sh.He_niveaux ?? ''}`,
          },
          emprise: {
            emprise_sol_max_pct: se.emprise_sol_max_pct ?? 70,
          },
          _meta: zoneData._meta,
        };
        warnings.push(`ℹ Zone AVAP secteur ${secteurKey} — ${secteur.label}`);
        if (sh.proximite_patrimoniale) {
          warnings.push('ℹ Règle de proximité patrimoniale AVAP active : He limitée par bâtiments de référence voisins');
        }
      } else {
        warnings.push(`Secteur AVAP "${secteurKey}" introuvable — vérifiez le document graphique AVAP`);
      }
    }

    const regles = communeData.regles_communes ?? {};
    const commune = communeData.meta?.commune ?? communeData.nom ?? codeInsee;

    // Avertissement usages
    if (zoneData.usages?.habitation === false) {
      warnings.push(`Zone ${resolvedZoneKey} : habitation non autorisée selon PLU`);
    }

    // Parser les valeurs de stationnement (peut être string ou number)
    const parkStd  = this._parseParking(zoneData.stationnement?.logement_standard, 2);
    const parkAide = this._parseParking(
      zoneData.stationnement?.logement_aide ?? zoneData.stationnement?.logement_social, 1);
    const parkVisit = this._parseParking(zoneData.stationnement?.visiteur_par_5lots
      ?? zoneData.stationnement?.visiteur_par_5logements, 1);

    // Remonter les ambiguïtés déclarées dans le JSON
    const ambiguites = zoneData?._meta?.ambiguites ?? [];
    if (ambiguites.length) {
      ambiguites.forEach(a => warnings.push(`⚠ ${a}`));
    }
    // Signaler les valeurs manquantes critiques pour que l'utilisateur vérifie
    if (zoneData?.hauteurs?.hf_max_m == null && zoneData?.hauteurs?.he_max_m == null && zoneData?.hauteurs?.h_max_m == null) {
      warnings.push('Hauteur max non chiffrée dans le PLU — vérifiez le document graphique');
    }
    if (zoneData?.emprise?.emprise_sol_max_pct == null) {
      warnings.push('Emprise au sol non chiffrée dans le PLU — vérifiez le règlement');
    }

    const confidence = this._computeConfidence(zoneData, warnings);

    return {
      id:        'REAL',
      label:     `${commune} — ${resolvedZoneKey}`,
      commune,
      code_insee: codeInsee,
      zone_plu:   resolvedZoneKey,
      zone_plu_demandee: zonePlu !== resolvedZoneKey ? zonePlu : undefined,
      poly:       null,       // → TerrainP07Adapter
      edgeTypes:  null,
      area:       null,
      origin:     null,
      bearing:    0,

      reculs: {
        voie:   this._v(zoneData.reculs?.voie_principale_m,
                        zoneData.reculs?.voie_secondaire_m,
                        regles.voie_par_defaut_m, 3),
        fond:   this._v(zoneData.reculs?.sep_fond_m,
                        regles.sep_fond_par_defaut_m, 3),
        lat:    this._v(zoneData.reculs?.sep_lat_m, 1.5),
        voie_secondaire: zoneData.reculs?.voie_secondaire_m ?? null,
        sep_lat_limite:  zoneData.reculs?.sep_lat_limite_autorisee ?? false,
        ravine:  regles.ravine_recul_m ?? 10,
        dpm:     zoneData.reculs?.dpm_recul_m
              ?? zoneData.contraintes_specifiques?.dpm_recul_m ?? null,
      },

      plu: {
        emprMax:      this._v(zoneData.emprise?.emprise_sol_max_pct, 60),
        // permMin : valeur PLU directe OU conversion CBS (cas Saint-Pierre EcoPLU)
        // Les zones Saint-Pierre n'ont pas permeable_min_pct mais cbs.gt250m2_cbs_min_pct.
        // Le CBS représente une surface ÉCO-équivalente : on l'utilise comme proxy pédagogique.
        permMin:      this._v(
                        zoneData.permeabilite?.permeable_min_pct,
                        zoneData.cbs?.gt250m2_cbs_min_pct,
                        zoneData.cbs?.cbs_min_pct,
                        30),
        heMax:        this._v(zoneData.hauteurs?.hf_max_m,
                              zoneData.hauteurs?.he_max_m,
                              zoneData.hauteurs?.h_max_m, 9),
        heEgout:      zoneData.hauteurs?.he_max_m ?? null,
        hfFaitage:    zoneData.hauteurs?.hf_max_m ?? null,
        rtaaZone:     parseInt(zoneRtaa ?? '1') || 1,
        zone:         resolvedZoneKey,
        type:         zoneData.type ?? (resolvedZoneKey.startsWith('AU') ? 'AU'
                        : resolvedZoneKey.startsWith('A') ? 'A'
                        : resolvedZoneKey.startsWith('N') ? 'N' : 'U'),
        sous_type:    zoneData.sous_type ?? null,
        interBatMin:  this._v(zoneData.reculs?.inter_batiments_m, 4),
        loi_littoral: zoneData.loi_littoral ?? false,
        usages:       zoneData.usages ?? {},
        versants_obligatoire: zoneData.toiture?.versants_obligatoire ?? true,
        pente_toiture_min_pct: zoneData.toiture?.pente_min_pct ?? null,
        pente_toiture_max_pct: zoneData.toiture?.pente_max_pct ?? null,
        versants_pct_volume:   zoneData.toiture?.versants_pct_volume ?? null,
        ebc:          zoneData.contraintes_specifiques?.ebc ?? false,
        // COS
        cos:          zoneData.emprise?.cos ?? null,
        // Annexes
        annexe_hf_max_m:       zoneData.hauteurs?.annexe_hf_max_m ?? null,
        annexe_emprise_max_m2: zoneData.hauteurs?.annexe_emprise_max_m2 ?? null,
        // Bonifications hauteur
        bonus_logement_social: zoneData.hauteurs?.bonus_logement_social_50pct ?? null,
        bonus_hotel:           zoneData.hauteurs?.bonus_hotel ?? null,
        bonus_vide_sanitaire:  zoneData.hauteurs?.bonus_vide_sanitaire ?? null,
        hauteur_absolue_max_m: zoneData.hauteurs?.hauteur_absolue_max_m ?? null,
        // Reculs détaillés
        voie_alignement:       zoneData.reculs?.voie_alignement ?? null,
        sep_lat_longueur_max_m: zoneData.reculs?.sep_lat_longueur_max_m ?? null,
        // Perméabilité détaillée
        marge_recul_voie_permeable_pct: zoneData.permeabilite?.marge_recul_voie_permeable_pct ?? null,
        // Stationnement réel — résidentiel
        park_logement_std:  parkStd,
        park_logement_aide: parkAide,
        park_visiteur_par5: parkVisit,
        // Stationnement — non résidentiel
        park_commerce_bureau:     zoneData.stationnement?.commerce_bureau ?? null,
        park_hotel_par_2chambres: zoneData.stationnement?.hotel_par_2chambres ?? null,
        park_enseignement:        zoneData.stationnement?.enseignement_par_classe ?? null,
        park_erp:                 zoneData.stationnement?.erp_par_10personnes ?? null,
        // Logements aidés PLU
        aide_seuil_m2:  zoneData.logement_aide?.sdp_seuil_1_m2
                     ?? zoneData.logement_aide?.sdp_seuil_m2
                     ?? regles.logement_aide_seuil_m2 ?? null,
        aide_pct:       zoneData.logement_aide?.pct_seuil_1
                     ?? zoneData.logement_aide?.pct_aide
                     ?? regles.logement_aide_pct ?? null,
        // CBS — Coefficient de Biotope par Surface (légal Saint-Pierre, indicateur ailleurs)
        cbs: zoneData.cbs ? {
          cbs_min_pct:           zoneData.cbs.gt250m2_cbs_min_pct ?? zoneData.cbs.cbs_min_pct ?? null,
          cbs_min_pct_lt250:     zoneData.cbs.lte250m2_cbs_min_pct ?? null,
          pleine_terre_min_pct:  zoneData.cbs.gt250m2_pleine_terre_min_pct
                              ?? zoneData.cbs.pleine_terre_min_pct ?? null,
          pleine_terre_min_pct_lt250: zoneData.cbs.lte250m2_pleine_terre_min_pct ?? null,
          derogation_hauteur:    zoneData.cbs.cbs_gt60pct_derogation_hauteur
                              ?? zoneData.cbs.cbs_gt70pct_derogation_hauteur ?? false,
          derogation_seuil_pct:  zoneData.cbs.cbs_gt70pct_derogation_hauteur ? 70
                              : (zoneData.cbs.cbs_gt60pct_derogation_hauteur ? 60 : null),
          source:                `${commune} — PLU zone ${resolvedZoneKey}`,
          reglementaire:         true,
          note:                  zoneData.cbs.note ?? null,
        } : null,
        // Notes pédagogiques (textes PLU détaillés)
        notes: {
          hauteur:      zoneData.hauteurs?.hauteur_note ?? zoneData.hauteurs?.note ?? null,
          emprise:      zoneData.emprise?.emprise_note ?? null,
          permeabilite: zoneData.permeabilite?.permeable_note ?? null,
          reculs_voie:  zoneData.reculs?.voie_note ?? null,
          reculs_lat:   zoneData.reculs?.sep_lat_note ?? null,
        },
      },

      // Données AVAP spécifiques (null si hors AVAP)
      avap: avapData,

      _meta: {
        confidence,
        source:      communeData.meta?.source ?? 'plu-rules-reunion.json',
        status:      confidence > 0 ? 'OK' : 'FALLBACK',
        last_update: communeData.meta?.generated ?? null,
        warnings,
      },
    };
  }

  /* ── Liste des zones ─────────────────────────────────────── */

  listZones(codeInsee) {
    const communeData = this._rules?.communes?.[codeInsee];
    if (!communeData?.zones) return [];
    return Object.entries(communeData.zones).map(([key, z]) => ({
      key,
      label: `${key} — ${z.label ?? z.type ?? ''}`,
      type:  z.type ?? '?',
    }));
  }

  /* ── Calcul parking PLU réel ─────────────────────────────── */

  /**
   * Calcul du stationnement PLU — résidentiel et non-résidentiel
   * @param {number} nbLgts     — nombre logements (résidentiel)
   * @param {number} nbAide     — nombre logements aidés
   * @param {Object} pluConfig  — config PLU (plu.park_*)
   * @param {Object} [options]  — { type, sp, effectif, nbChambres, nbClasses }
   */
  computeParking(nbLgts, nbAide, pluConfig, options = {}) {
    const p = pluConfig ?? {};
    const { type, sp, effectif, nbChambres, nbClasses } = options;

    // Non-résidentiel : règles spécifiques PLU
    if (type === 'bureau' || type === 'commerce') {
      const ratio = p.park_commerce_bureau;
      if (ratio && sp) {
        // ratio = "1 pour 50m² SP" → on parse le nombre
        const r = typeof ratio === 'string' ? parseFloat(ratio.match(/(\d+)/)?.[1] ?? 50) : ratio;
        return Math.ceil(sp / r);
      }
      return Math.ceil((sp ?? 0) / 50); // fallback 1 PK / 50 m² SP
    }
    if (type === 'hotel' || type === 'hebergement') {
      const r = p.park_hotel_par_2chambres ?? 1;
      return Math.ceil((nbChambres ?? 0) / 2 * r);
    }
    if (type === 'enseignement') {
      const r = p.park_enseignement ?? 2;
      return Math.ceil((nbClasses ?? 0) * r);
    }
    if (type === 'erp' || type === 'sante') {
      const r = p.park_erp ?? 1;
      return Math.ceil((effectif ?? 0) / 10 * r);
    }

    // Résidentiel (maison / collectif)
    const nbLibre = Math.max(0, nbLgts - nbAide);
    const plStd   = Math.ceil(nbLibre * (p.park_logement_std  ?? 2));
    const plAide  = Math.ceil(nbAide  * (p.park_logement_aide ?? 1));
    const plVisit = Math.ceil(nbLgts / 5 * (p.park_visiteur_par5 ?? 1));
    return plStd + plAide + plVisit;
  }

  /* ── Privé ──────────────────────────────────────────────── */

  /** Retourne la première valeur non-null / non-NaN parmi les candidats */
  _v(...candidates) {
    for (const v of candidates) if (v != null && !Number.isNaN(v)) return v;
    return null;
  }

  /** Parse une valeur de stationnement (numérique ou chaîne "2 places / logement") */
  _parseParking(val, fallback) {
    if (val == null) return fallback;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const m = val.match(/^(\d+(?:\.\d+)?)/);
      if (m) return parseFloat(m[1]);
    }
    return fallback;
  }

  /** Parse un recul AVAP depuis une chaîne comme "Alignement ou retrait 4m min..." */
  _parseReculAvap(str, fallback) {
    if (str == null) return fallback;
    if (typeof str === 'number') return str;
    const m = str.match(/(\d+(?:[.,]\d+)?)\s*m\s*min/);
    return m ? parseFloat(m[1].replace(',', '.')) : fallback;
  }

  /** Cherche une zone similaire par troncation progressive du nom */
  _findSimilarZone(zones, zonePlu) {
    if (!zones || !zonePlu) return null;
    // Tentatives : AU3c → AU3, AU3 → AU, AU → A
    const attempts = [
      zonePlu.replace(/[a-z]$/i, ''),           // AU3c → AU3
      zonePlu.replace(/[a-z0-9]+$/i, ''),        // AU3c → AU
      zonePlu.replace(/\d.*$/, ''),               // AU3c → AU
      zonePlu[0],                                 // AU3c → A
    ];
    for (const key of attempts) {
      if (!key || key === zonePlu) continue;
      if (zones[key]) return { key, data: zones[key] };
      // Cherche une zone commençant par ce préfixe
      const found = Object.entries(zones).find(([k]) => k.startsWith(key));
      if (found) return { key: found[0], data: found[1] };
    }
    return null;
  }

  /** Fusionne une zone de référence avec la zone actuelle (override sparse) */
  _mergeZone(refData, overrideData) {
    const merged = {};
    const allKeys = new Set([...Object.keys(refData), ...Object.keys(overrideData)]);
    for (const key of allKeys) {
      if (key === 'ref' || key === 'ref_zone' || key === 'ref_note') continue;
      const r = refData[key], o = overrideData[key];
      if (o != null && typeof o === 'object' && !Array.isArray(o) &&
          r != null && typeof r === 'object' && !Array.isArray(r)) {
        merged[key] = { ...r, ...o };
      } else {
        merged[key] = o ?? r;
      }
    }
    return merged;
  }

  /** Calcule la confiance en fonction des données disponibles */
  _computeConfidence(zoneData, warnings) {
    const base = zoneData?._meta?.confidence ?? zoneData?._confidence ?? 1.0;
    // Ne pas pénaliser les warnings informatifs (préfixe ℹ ou ⚠)
    const realWarnings = warnings.filter(w => !w.startsWith('ℹ') && !w.startsWith('⚠'));
    const penalty = realWarnings.length * 0.1;
    const criticalMissing = [
      zoneData?.emprise?.emprise_sol_max_pct,
      zoneData?.permeabilite?.permeable_min_pct,
      zoneData?.hauteurs?.hf_max_m ?? zoneData?.hauteurs?.he_max_m ?? zoneData?.hauteurs?.h_max_m,
      zoneData?.reculs?.voie_principale_m,
    ].filter(v => v == null).length;
    return Math.max(0, Math.min(1, base - penalty - criticalMissing * 0.15));
  }

  /**
   * Retourne une config de fallback avec données par défaut.
   * @param {string} reason — RULES_NOT_LOADED | COMMUNE_MISSING | ZONE_MISSING | UNKNOWN
   */
  _fallback(codeInsee, zonePlu, zoneRtaa, warnings, confidence = 0.3, reason = 'UNKNOWN') {
    return {
      id: 'FALLBACK', label: `${zonePlu} (données non disponibles)`,
      commune: codeInsee, code_insee: codeInsee, zone_plu: zonePlu,
      poly: null, edgeTypes: null, area: null, origin: null, bearing: 0,
      reculs: { voie: 3, fond: 3, lat: 1.5, ravine: 10, dpm: null },
      plu: {
        emprMax: 60, permMin: 30, heMax: 9, heEgout: null, hfFaitage: null,
        rtaaZone: parseInt(zoneRtaa ?? '1') || 1,
        zone: zonePlu, type: 'U', sous_type: null, interBatMin: 4,
        loi_littoral: false, usages: {}, versants_obligatoire: true, ebc: false,
        park_logement_std: 2, park_logement_aide: 1, park_visiteur_par5: 1,
        aide_seuil_m2: null, aide_pct: null, cbs: null,
      },
      _meta: {
        confidence,
        status: 'FALLBACK',
        reason,
        warnings,
        source: 'fallback',
        last_update: null,
      },
    };
  }
}

export default PLUP07Adapter;

// Expose pour compatibilité non-module TERLAB
if (typeof window !== 'undefined') window.PLUP07Adapter = PLUP07Adapter;
