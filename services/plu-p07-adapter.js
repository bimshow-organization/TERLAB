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
      const resp = await fetch(url);
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

  resolve(codeInsee, zonePlu, zoneRtaa = '1') {
    const warnings = [];

    if (!this._loaded || !this._rules) {
      return this._fallback(codeInsee, zonePlu, zoneRtaa,
        ['plu-rules-reunion.json non chargé — utilisation valeurs par défaut'], 0);
    }

    // Trouver commune par code INSEE ou par nom
    let communeData = this._rules.communes?.[codeInsee];
    if (!communeData) {
      communeData = Object.values(this._rules.communes ?? {})
        .find(c => (c.meta?.commune ?? c.nom)?.toLowerCase() === codeInsee?.toLowerCase());
    }
    if (!communeData) {
      // ⚠️ STUB — Commune ${codeInsee} absente — effort S : compléter plu-rules-reunion.json
      return this._fallback(codeInsee, zonePlu, zoneRtaa,
        [`Commune ${codeInsee} absente de plu-rules-reunion.json`], 0);
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
          [`Zone "${zonePlu}" introuvable dans commune ${codeInsee}`], 0.3);
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
        permMin:      this._v(zoneData.permeabilite?.permeable_min_pct, 30),
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
        ebc:          zoneData.contraintes_specifiques?.ebc ?? false,
        // Stationnement réel
        park_logement_std:  parkStd,
        park_logement_aide: parkAide,
        park_visiteur_par5: parkVisit,
        // Logements aidés PLU
        aide_seuil_m2:  zoneData.logement_aide?.sdp_seuil_1_m2
                     ?? zoneData.logement_aide?.sdp_seuil_m2
                     ?? regles.logement_aide_seuil_m2 ?? null,
        aide_pct:       zoneData.logement_aide?.pct_seuil_1
                     ?? zoneData.logement_aide?.pct_aide
                     ?? regles.logement_aide_pct ?? null,
      },

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

  computeParking(nbLgts, nbAide, pluConfig) {
    const p = pluConfig ?? {};
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
    const penalty = warnings.length * 0.1;
    const criticalMissing = [
      zoneData?.emprise?.emprise_sol_max_pct,
      zoneData?.permeabilite?.permeable_min_pct,
      zoneData?.hauteurs?.hf_max_m ?? zoneData?.hauteurs?.he_max_m ?? zoneData?.hauteurs?.h_max_m,
      zoneData?.reculs?.voie_principale_m,
    ].filter(v => v == null).length;
    return Math.max(0, Math.min(1, base - penalty - criticalMissing * 0.15));
  }

  /** Retourne une config de fallback avec données par défaut */
  _fallback(codeInsee, zonePlu, zoneRtaa, warnings, confidence = 0.3) {
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
        aide_seuil_m2: null, aide_pct: null,
      },
      _meta: { confidence, status: 'FALLBACK', warnings, source: 'fallback', last_update: null },
    };
  }
}

export default PLUP07Adapter;

// Expose pour compatibilité non-module TERLAB
if (typeof window !== 'undefined') window.PLUP07Adapter = PLUP07Adapter;
