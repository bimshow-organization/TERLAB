// TERLAB · services/envelope-generator.js
// Shape Grammar PLU v2.1 — Mueller et al. 2006 adapte RTAA DOM / Reunion
// Pipeline : Lot → SetBack → FootprintZone → ShapeRules → Volume → Score Pareto
// v2.1 : utilise TerrainP07Adapter pour lineIsect, PIR et validate

const EnvelopeGenerator = {

  // ── ENTREE PRINCIPALE ──────────────────────────────────────────
  // parcelLocal : [{x,y}] en metres — espace SVG (Y inverse)
  // edgeTypes   : string[] — 'voie'|'fond'|'lateral' par arete
  async generate(session, parcelLocal, edgeTypes) {
    const p4      = session?.phases?.[4]?.data ?? {};
    const terrain = session?.terrain ?? {};

    // ── 1. Regles PLU (session + TERLAB_PLU_CONFIG réel) ────────
    const realPlu = (typeof window !== 'undefined' ? window.TERLAB_PLU_CONFIG?.plu : null) ?? {};
    let reculVoie = parseFloat(p4.recul_voie_principale_m ?? p4.recul_voie_m ?? p4.recul_avant_m ?? 3) || 3;
    // Alignement voie autorisé → recul voie = 0 (enveloppe agrandie côté voie)
    if (realPlu.voie_alignement === true) reculVoie = 0;

    let hFaitage = parseFloat(realPlu.heMax ?? p4.hauteur_faitage_m ?? 9) || 9;
    // Cap absolu PLU
    if (realPlu.hauteur_absolue_max_m) {
      hFaitage = Math.min(hFaitage, realPlu.hauteur_absolue_max_m);
    }

    // ── AVAP : règle de proximité patrimoniale ────────────────
    const avap = (typeof window !== 'undefined' ? window.TERLAB_PLU_CONFIG?.avap : null) ?? null;
    let hEgout = parseFloat(realPlu.heEgout ?? realPlu.heMax ?? p4.hauteur_max_m ?? p4.hauteur_egout_m ?? 7) || 7;
    if (avap?.proximite) {
      // Si bâtiment de référence voisin renseigné (hauteur connue),
      // He ne peut excéder de plus de 1 niveau (~3m) la hauteur du bâtiment de référence
      const hRef = parseFloat(p4.avap_h_reference_m ?? 0);
      if (hRef > 0) {
        const heMaxProximite = hRef + 3; // +1 niveau ≈ 3m
        hEgout = Math.min(hEgout, heMaxProximite);
        hFaitage = Math.min(hFaitage, heMaxProximite + 4); // comble max ~4m au-dessus égout
      }
    }

    // Règle BINAIRE latérale : 0 si mitoyen, sinon Lmin (jamais valeur intermédiaire)
    // Lmin = recul réglementaire PLU avec plancher 3m (minimum standard La Réunion).
    // Mitoyenneté détectée via flags p7 (mitoyen_g/d/lateral) ou alignement voie PLU.
    // mitoyen_g / mitoyen_d sont indépendants : G mitoyen + D recul standard est valide.
    const p7data    = session?.phases?.[7]?.data ?? {};
    const mitG      = !!(p7data.mitoyen_g || p7data.mitoyen_lateral
                       || p7data.implantation_limite_sep === true);
    const mitD      = !!(p7data.mitoyen_d || p7data.mitoyen_lateral
                       || p7data.implantation_limite_sep === true);
    const isMitoyen = mitG || mitD;
    // Plancher dur à 3m — un slider PLU <3 est IGNORÉ (binarité stricte).
    // 3m = minimum réglementaire La Réunion pour limite séparative non mitoyenne.
    const LmRaw     = parseFloat(p4.recul_limite_sep_m ?? p4.recul_lat_m ?? realPlu.recul_lat ?? 3);
    const LM_FLOOR  = 3;
    const Lmin      = Math.max(Number.isFinite(LmRaw) ? LmRaw : 0, LM_FLOOR);
    const reculLat  = isMitoyen ? 0 : Lmin;

    const PLU = {
      recul_voie:    reculVoie,
      recul_fond:    parseFloat(p4.recul_fond_m  ?? 3)                       || 3,
      recul_lat:     reculLat,            // BINAIRE : 0 (mitoyen) OU Lmin
      lat_mitoyen:   isMitoyen,           // pour _ruleOblique et debug
      mitoyen_g:     mitG,                // règle binaire côté gauche
      mitoyen_d:     mitD,                // règle binaire côté droit
      lat_lmin:      Lmin,                // mémorisé pour validation
      h_egout:       hEgout,
      h_faitage:     hFaitage,
      ces_max:       parseFloat(p4.emprise_sol_max_pct ? p4.emprise_sol_max_pct / 100 : p4.ces_max ?? 0.7) || 0.7,
      cos_max:       parseFloat(realPlu.cos ?? p4.cos_max ?? 2.1) || 2.1,
      niveaux:       parseInt(p4.niveaux_max ?? 2)                           || 2,
      avap_proximite: !!(avap?.proximite),
    };

    // ── 2. Zone constructible (SetBack) ─────────────────────────
    // Si parcelLocal fourni, utiliser directement ; sinon fallback session
    let parcel = parcelLocal;
    let edges  = edgeTypes;
    if (!parcel || parcel.length < 3) {
      parcel = this._parcelToLocal(session);
      edges  = this._classifyEdgesHeuristic(parcel);
    }
    if (!parcel || parcel.length < 3) return [];
    if (!edges || edges.length !== parcel.length) {
      edges = new Array(parcel.length).fill('lateral');
    }

    // Validation robuste via TerrainP07Adapter si disponible
    const TA = typeof window !== 'undefined' ? window.TerrainP07Adapter : null;
    if (TA) {
      const polyArr = parcel.map(p => [p.x, p.y]);
      const validation = TA.validate(polyArr, null, session);
      if (validation?.warnings?.length) {
        validation.warnings.forEach(w => console.warn('[EnvelopeGenerator]', w));
      }
    }

    let zone = this._setback(parcel, edges, PLU);
    if (!zone.length) return [];

    // ── 2b. Exclure les zones PPRN inconstructibles (R1/R2) ────
    // Si le scan PPRN a détecté des zones R1/R2 sur la parcelle,
    // soustraire ces zones de l'emprise constructible
    const pprnZones = terrain.pprn_zones_detected;
    if (pprnZones) {
      const clat = parseFloat(terrain.lat ?? -21.15);
      const clng = parseFloat(terrain.lng ?? 55.45);
      const LNG_M = 111320 * Math.cos(clat * Math.PI / 180);
      const LAT_M = 111320;

      // Centroide parcelle geo (meme calcul que esquisse-canvas)
      const parcelGeo = terrain.parcelle_geojson;
      let geoRing = null;
      if (parcelGeo) {
        geoRing = parcelGeo.type === 'Polygon'
          ? parcelGeo.coordinates[0]
          : parcelGeo.type === 'MultiPolygon'
            ? parcelGeo.coordinates[0][0] : null;
      }
      const cGeo = geoRing?.length
        ? [geoRing.reduce((s, c) => s + c[0], 0) / geoRing.length,
           geoRing.reduce((s, c) => s + c[1], 0) / geoRing.length]
        : [clng, clat];

      for (const [zKey, zData] of Object.entries(pprnZones)) {
        if (!zData.inconstructible || !zData.pts?.length || zData.pts.length < 3) continue;

        // Convertir les points PPRN WGS84 → local mètres (meme repere que parcelLocal)
        const pprnLocal = zData.pts.map(p => ({
          x:  (p.lng - cGeo[0]) * LNG_M,
          y: -(p.lat - cGeo[1]) * LAT_M,
        }));

        // Soustraire : garder seulement les points de zone qui ne sont PAS
        // dans le polygone PPRN inconstructible, puis recalculer le convex hull
        const pprnHull = this._convexHull(pprnLocal);
        const filtered = zone.filter(pt => !this._pointInPoly(pt, pprnHull));
        if (filtered.length >= 3) {
          zone = this._convexHull(filtered);
        } else {
          // Toute la zone est inconstructible
          return [];
        }
      }
    }

    const zoneArea = this._area(zone);
    if (zoneArea < 10) return [];

    // ── 3. Contexte ─────────────────────────────────────────────
    const ctx = {
      altitude:    parseFloat(terrain.altitude_ngr ?? 0),
      voieAzimuth: this._voieAzimuth(parcel, edges),
      viewDir:     this._viewDirection(terrain),
      zone_rtaa:   terrain.zone_rtaa ?? '1',
    };

    // ── 4. Appliquer les Shape Rules ────────────────────────────
    const proposals = [];

    const compact = this._ruleCompact(zone, PLU, ctx);
    if (compact) proposals.push(compact);

    const linear = this._ruleLineaire(zone, parcel, edges, PLU, ctx);
    if (linear) proposals.push(linear);

    if (zoneArea > 80) {
      const enL = this._ruleEnL(zone, parcel, edges, PLU, ctx);
      if (enL) proposals.push(enL);
    }

    if (zoneArea > 200) {
      const enU = this._ruleEnU(zone, PLU, ctx);
      if (enU) proposals.push(enU);
    }

    // Oblique : aligné sur la limite latérale la plus longue
    // (essentiel quand mitoyen=true ou parcelle non orthogonale)
    const lateralIdx = this._longestLateralEdge(parcel, edges);
    if (lateralIdx >= 0) {
      const oblique = this._ruleOblique(zone, parcel, edges, lateralIdx, PLU, ctx);
      if (oblique) proposals.push(oblique);
    }

    // ── 4b. Filet de securite : double clip + filtre surface minimale ──
    // 1. Clip contre la zone constructible (reculs respectés)
    // 2. Clip contre la parcelle brute (double sécurité)
    // 3. Rejet en dessous de 12 m² (forme non viable)
    // 4. Si mitoyen_g/d actif → expandFaceMitoyenne pour snap flush sur la
    //    limite séparative oblique, puis re-clip + removeAcuteSpikes.
    const SURFACE_MIN_M2 = 12;
    const GU = (typeof window !== 'undefined') ? window.GeoUtils : null;
    const splitMit = !!PLU.mitoyen_g !== !!PLU.mitoyen_d;
    let edgeReculsForMit = null;
    let edgeTypesForMit = null;
    if (splitMit && GU?.expandFaceMitoyenne) {
      const sides = this._classifyLateralSides(parcel, edges);
      edgeTypesForMit = edges;
      edgeReculsForMit = edges.map((t, i) => {
        if (t === 'voie') return PLU.recul_voie;
        if (t === 'fond') return PLU.recul_fond;
        const side = sides[i];
        if (side === 'g' && PLU.mitoyen_g) return 0;
        if (side === 'd' && PLU.mitoyen_d) return 0;
        return PLU.lat_lmin ?? PLU.recul_lat;
      });
    }
    for (const prop of proposals) {
      prop.polygon = this._clipSH(prop.polygon, zone);
      prop.polygon = this._clipSH(prop.polygon, parcel);
      // Snap flush sur la limite mitoyenne (si activé)
      if (splitMit && edgeReculsForMit && prop.polygon.length >= 3) {
        prop.polygon = GU.expandFaceMitoyenne(
          prop.polygon, parcel, edgeReculsForMit, edgeTypesForMit
        );
        // Re-clip après expansion (le polygone étendu déborde de zone+parcel)
        prop.polygon = this._clipSH(prop.polygon, zone);
        prop.polygon = this._clipSH(prop.polygon, parcel);
        if (GU.removeAcuteSpikes && prop.polygon.length >= 3) {
          prop.polygon = GU.removeAcuteSpikes(prop.polygon, 90);
        }
      }
      prop.surface = this._area(prop.polygon);
      if (prop.surface < SURFACE_MIN_M2) {
        prop.polygon = [];
        prop.surface = 0;
        prop.score   = -1; // sera trié en dernier puis filtré
      }
    }
    // Filtrer les propositions vides ou trop petites
    const filtered = proposals.filter(p => p.surface >= SURFACE_MIN_M2 && p.polygon.length >= 3);
    proposals.length = 0;
    proposals.push(...filtered);

    // ── 5. Score Pareto pour chaque proposition ──────────────────
    const parcelArea = parseFloat(terrain.contenance_m2 ?? this._area(parcel));
    for (const prop of proposals) {
      const sd   = this._scorePareto(prop, PLU, ctx, session, parcelArea, parcel);
      prop.scoreData = sd;
      prop.score     = this._aggregateScore(sd);
    }

    // ── 6. Trier par score decroissant ───────────────────────────
    proposals.sort((a, b) => b.score - a.score);

    return proposals;
  },

  // ── SHAPE RULE : COMPACT ───────────────────────────────────────
  // Construit depuis le centroïde RÉEL de la zone (pas centroïde bbox).
  // PIR utilisé en priorité car plus stable sur formes concaves.
  _ruleCompact(zone, plu, ctx) {
    const bbox = this._bbox(zone);
    const zW   = bbox.maxX - bbox.minX;
    const zH   = bbox.maxY - bbox.minY;
    const area = this._area(zone);
    if (area < 12) return null;

    // Centre : PIR si disponible (plus robuste pour formes concaves),
    // sinon centroïde des sommets de la zone (pas de la bbox)
    let cx, cy;
    const TA2 = typeof window !== 'undefined' ? window.TerrainP07Adapter : null;
    if (TA2?.poleOfInaccessibility) {
      const polyArr = zone.map(p => [p.x, p.y]);
      const [pirX, pirY] = TA2.poleOfInaccessibility(polyArr, 1.5);
      cx = pirX;
      cy = pirY;
    } else {
      cx = zone.reduce((s, p) => s + p.x, 0) / zone.length;
      cy = zone.reduce((s, p) => s + p.y, 0) / zone.length;
    }

    // Aspect bioclimatique (axe long perpendiculaire au soleil)
    const aspect = this._optimalAspect(ctx);
    let bW = Math.sqrt(area * plu.ces_max * aspect);
    let bH = bW / aspect;
    bW = Math.min(bW, zW * 0.92);
    bH = Math.min(bH, zH * 0.92);

    const raw = [
      { x: cx - bW / 2, y: cy - bH / 2 },
      { x: cx + bW / 2, y: cy - bH / 2 },
      { x: cx + bW / 2, y: cy + bH / 2 },
      { x: cx - bW / 2, y: cy + bH / 2 },
    ];

    // Clip contre la zone — filet de sécurité (le post-loop le fera aussi)
    const clipped = this._clipSH(raw, zone);
    if (clipped.length < 3) return null;

    return {
      family:        'Compact',
      familyKey:     'COMPACT',
      strategy:      'compact',
      strategyLabel: 'Compact — economique',
      polygon:       clipped,
      polygonGeo:    null,
      surface:       this._area(clipped),
      hauteur:       plu.h_egout,
      niveaux:       plu.niveaux,
      scoreData:     null,
      score:         0,
    };
  },

  // ── SHAPE RULE : LINEAIRE ──────────────────────────────────────
  // Façade voie longue, profondeur courte (RTAA DOM optimisée).
  // Ancré sur le bas réel de la zone (côté voie en SVG Y-down = maxY).
  _ruleLineaire(zone, parcelLocal, edgeTypes, plu, ctx) {
    const bbox = this._bbox(zone);
    const zW   = bbox.maxX - bbox.minX;
    const zH   = bbox.maxY - bbox.minY;
    const area = this._area(zone);
    if (area < 15 || zW < 6) return null;

    // Profondeur max : limitée par PLU (prof_max) ET par la hauteur de zone
    const profMaxPLU = plu.prof_max ?? 15;
    const profMax    = Math.min(profMaxPLU, zH * 0.45);
    if (profMax < 4) return null;

    // Largeur cible : utilise la largeur de zone, plafonnée par CES
    const largeur = Math.min(zW * 0.90, (area * plu.ces_max) / profMax);
    if (largeur < 5) return null;

    const cx     = (bbox.minX + bbox.maxX) / 2;
    const yVoie  = bbox.maxY;             // côté voie (bas en Y-down)
    const yArr   = yVoie - profMax;       // arrière du bâtiment

    const raw = [
      { x: cx - largeur / 2, y: yArr  },
      { x: cx + largeur / 2, y: yArr  },
      { x: cx + largeur / 2, y: yVoie },
      { x: cx - largeur / 2, y: yVoie },
    ];

    const clipped = this._clipSH(raw, zone);
    if (clipped.length < 3) return null;

    return {
      family:        'Lineaire',
      familyKey:     'LINEAIRE',
      strategy:      'linear',
      strategyLabel: 'Lineaire — facade voie, RTAA optimise',
      polygon:       clipped,
      polygonGeo:    null,
      surface:       this._area(clipped),
      hauteur:       plu.h_egout,
      niveaux:       plu.niveaux,
      scoreData:     null,
      score:         0,
    };
  },

  // ── SHAPE RULE : EN L ─────────────────────────────────────────
  // Construit depuis les coins réels de la zone (pas des proportions
  // arbitraires de la bbox). Le clip final supprime tout débordement
  // dans les coins concaves.
  _ruleEnL(zone, parcelLocal, edgeTypes, plu, ctx) {
    const bbox = this._bbox(zone);
    const x0   = bbox.minX, y0 = bbox.minY;
    const zW   = bbox.maxX - bbox.minX;
    const zH   = bbox.maxY - bbox.minY;
    if (zW < 8 || zH < 8) return null;

    const montantW = Math.min(zW * 0.32, 5.5);   // m — épaisseur du montant
    const barreH   = Math.min(zH * 0.30, 8.0);   // m — épaisseur de la barre voie
    const barreW   = Math.min(zW * 0.82, 13.0);  // m — longueur de la barre voie

    //  1────2
    //  │    │  ← montant fond
    //  │    3────4
    //  │         │  ← barre voie
    //  6─────────5
    const raw = [
      { x: x0,            y: y0 },                  // 1 fond gauche
      { x: x0 + montantW, y: y0 },                  // 2 fond, fin montant
      { x: x0 + montantW, y: y0 + zH - barreH },    // 3 coin intérieur
      { x: x0 + barreW,   y: y0 + zH - barreH },    // 4 barre droite haut
      { x: x0 + barreW,   y: y0 + zH },             // 5 voirie droite
      { x: x0,            y: y0 + zH },             // 6 voirie gauche
    ];

    const clipped = this._clipSH(raw, zone);
    if (clipped.length < 3) return null;

    return {
      family:        'En L',
      familyKey:     'EN_L',
      strategy:      'sprawl',
      strategyLabel: 'Etale — L bioclimatique',
      polygon:       clipped,
      polygonGeo:    null,
      surface:       this._area(clipped),
      hauteur:       plu.h_egout,
      niveaux:       plu.niveaux,
      scoreData:     null,
      score:         0,
    };
  },

  // ── SHAPE RULE : OBLIQUE ──────────────────────────────────────
  // Bâtiment aligné parallèlement à une limite latérale réelle de la
  // parcelle (mitoyen ou recul L). Utile quand la parcelle n'est pas
  // alignée aux axes — le bâtiment suit la géométrie réelle.
  // edgeIdx = index de l'arête latérale dans parcelLocal/edgeTypes.
  _ruleOblique(zone, parcelLocal, edgeTypes, edgeIdx, plu, ctx) {
    if (!parcelLocal || edgeIdx == null) return null;
    const n  = parcelLocal.length;
    if (n < 3 || edgeIdx < 0 || edgeIdx >= n) return null;

    const p1 = parcelLocal[edgeIdx];
    const p2 = parcelLocal[(edgeIdx + 1) % n];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const l  = Math.hypot(dx, dy);
    if (l < 6) return null;

    // Vecteur unitaire le long de la limite
    const u = { x: dx / l, y: dy / l };
    // Normale potentielle (les deux orientations sont essayées plus bas
    // car le sens "intérieur" dépend du winding du polygon parcelle).
    const vCandidates = [
      { x: -dy / l, y:  dx / l },  // rotation +90° math
      { x:  dy / l, y: -dx / l },  // rotation -90° math (sens opposé)
    ];

    // Recul latéral BINAIRE déjà calculé (0 mitoyen, sinon Lmin)
    const rLat = plu.recul_lat;
    const rV   = plu.recul_voie;
    const rF   = plu.recul_fond;

    // Profondeur disponible le long de la limite
    const profDispo = l - rV - rF;
    if (profDispo < 4) return null;

    const batL = Math.min(profDispo * 0.72, 18);
    const bbox = this._bbox(zone);
    const zW   = bbox.maxX - bbox.minX;
    const batW = Math.min(7, zW * 0.45);
    if (batW < 4) return null;

    // Essayer les deux normales et garder celle qui produit la plus
    // grande surface clippée (= celle qui pointe vers l'intérieur).
    let bestClipped = [];
    let bestArea    = 0;
    for (const v of vCandidates) {
      const O = {
        x: p1.x + u.x * rV + v.x * rLat,
        y: p1.y + u.y * rV + v.y * rLat,
      };
      const raw = [
        { x: O.x,                              y: O.y                              },
        { x: O.x + v.x * batW,                 y: O.y + v.y * batW                 },
        { x: O.x + v.x * batW + u.x * batL,    y: O.y + v.y * batW + u.y * batL    },
        { x: O.x + u.x * batL,                 y: O.y + u.y * batL                 },
      ];
      const c = this._clipSH(raw, zone);
      if (c.length >= 3) {
        const a = this._area(c);
        if (a > bestArea) { bestArea = a; bestClipped = c; }
      }
    }
    if (bestArea < 12) return null;
    const clipped = bestClipped;

    return {
      family:        'Oblique',
      familyKey:     'OBLIQUE',
      strategy:      plu.lat_mitoyen ? 'mitoyen' : 'aligne',
      strategyLabel: plu.lat_mitoyen
        ? 'Mitoyen — implantation en limite séparative'
        : 'Aligne — paralele a la limite',
      polygon:       clipped,
      polygonGeo:    null,
      surface:       this._area(clipped),
      hauteur:       plu.h_egout,
      niveaux:       plu.niveaux,
      scoreData:     null,
      score:         0,
    };
  },

  // ── SHAPE RULE : EN U ─────────────────────────────────────────
  _ruleEnU(zone, plu, ctx) {
    const bbox  = this._bbox(zone);
    const W     = bbox.maxX - bbox.minX;
    const H     = bbox.maxY - bbox.minY;
    if (W < 12 || H < 10) return null;

    const eW  = Math.max(3, W * 0.20);
    const eH  = Math.max(3, H * 0.20);
    const cW  = W - 2 * eW;
    const cH  = H * 0.5;

    const polygon = [
      { x: bbox.minX,           y: bbox.minY         },
      { x: bbox.maxX,           y: bbox.minY         },
      { x: bbox.maxX,           y: bbox.maxY         },
      { x: bbox.minX + eW + cW, y: bbox.maxY         },
      { x: bbox.minX + eW + cW, y: bbox.minY + cH    },
      { x: bbox.minX + eW,      y: bbox.minY + cH    },
      { x: bbox.minX + eW,      y: bbox.maxY         },
      { x: bbox.minX,           y: bbox.maxY         },
    ];

    const clipped = this._clipSH(polygon, zone);
    if (clipped.length < 3) return null;

    return {
      family:        'En U',
      familyKey:     'EN_U',
      strategy:      'courtyard',
      strategyLabel: 'Cour — ventilation naturelle',
      polygon:       clipped,
      polygonGeo:    null,
      surface:       this._area(clipped),
      hauteur:       plu.h_egout,
      niveaux:       plu.niveaux,
      scoreData:     null,
      score:         0,
    };
  },

  // ── SCORE PARETO 5 OBJECTIFS ───────────────────────────────────
  _scorePareto(prop, plu, ctx, session, parcelArea, parcelLocal) {
    const surf = prop.surface;

    // 1. Orientation RTAA
    const mainAzimuth = ctx.voieAzimuth;
    const rtaaPref    = [45, 90, 135];
    const angleDiff   = Math.min(...rtaaPref.map(a => Math.abs(((mainAzimuth - a) % 360 + 360) % 360)));
    const orientScore = Math.max(0, 1 - angleDiff / 90);

    // 2. Vue mer/montagne
    const viewScore = this._computeViewScore(prop, ctx);

    // 3. Conformite PLU (CES + AVAP proximité)
    const ces       = parcelArea > 0 ? surf / parcelArea : 0;
    const cesScore  = ces > 0 && ces <= plu.ces_max ? 1 : Math.max(0, 1 - (ces - plu.ces_max) / plu.ces_max);
    // Malus AVAP : si proximité patrimoniale active et hauteur > h_egout cap
    const avapPenalty = plu.avap_proximite && prop.hauteur > plu.h_egout ? 0.2 : 0;
    const pluScore  = Math.max(0, cesScore - avapPenalty);

    // 4. Espace jardin restant
    const gardenPct  = parcelArea > 0 ? 1 - surf / parcelArea : 0;
    const gardenScore = Math.max(0, Math.min(1, gardenPct * 1.5));

    // 5. RTAA DOM
    const rtaaZone   = parseInt(session.terrain?.zone_rtaa ?? 1);
    const rtaaThresh = rtaaZone === 1 ? 0.20 : rtaaZone === 2 ? 0.25 : 0.30;
    const rtaaRisk   = surf * 0.30 / (surf + 1);
    const rtaaScore  = 1 - Math.min(1, rtaaRisk / rtaaThresh);

    // 6. Densité SCoT — capacité logements vs minimum SCoT
    const scotDensMin = parseFloat(session.terrain?.scot_densite_min ?? 0);
    let densiteScotScore = 0.5; // neutre si pas de données SCoT
    let lgtsEstimes = 0;
    let lgtsMinScot = 0;
    if (scotDensMin > 0 && parcelArea > 0) {
      const ha = parcelArea / 10000;
      lgtsMinScot = Math.ceil(ha * scotDensMin);
      // Estimation logements possibles : emprise * niveaux / ~80m² SDP par logement
      const niveaux = plu.niveaux || 2;
      lgtsEstimes = Math.floor(surf * niveaux / 80);
      if (lgtsMinScot > 0) {
        const ratio = lgtsEstimes / lgtsMinScot;
        // 1.0 si ratio >= 1 (conforme), décroit linéairement en dessous
        densiteScotScore = Math.max(0, Math.min(1, ratio));
      }
    }

    return {
      orientationScore: orientScore,
      vueScore:         viewScore,
      pluScore,
      gardenScore,
      rtaaScore,
      densiteScotScore,
      lgtsEstimes,
      lgtsMinScot,
      scotDensMin,
      hauteur_egout:    plu.h_egout,
      niveaux:          plu.niveaux,
      viewType:         ctx.viewDir < 180 ? 'mer' : 'montagne',
      viewDirection:    ctx.viewDir,
    };
  },

  _aggregateScore(sd) {
    // Si densité SCoT dispo, elle prend 10% sur PLU et jardin
    if (sd.scotDensMin > 0) {
      return sd.orientationScore  * 0.25
           + sd.vueScore          * 0.15
           + sd.pluScore          * 0.20
           + sd.gardenScore       * 0.10
           + sd.rtaaScore         * 0.20
           + sd.densiteScotScore  * 0.10;
    }
    return sd.orientationScore * 0.25
         + sd.vueScore         * 0.15
         + sd.pluScore         * 0.25
         + sd.gardenScore      * 0.15
         + sd.rtaaScore        * 0.20;
  },

  _computeViewScore(prop, ctx) {
    const alt      = ctx.altitude;
    const altScore = Math.min(1, alt / 500);
    const viewDiff  = Math.abs((ctx.voieAzimuth - ctx.viewDir + 360) % 360);
    const dirScore  = Math.max(0, 1 - viewDiff / 180);
    return (altScore + dirScore) / 2;
  },

  // Index de l'arête latérale la plus longue (-1 si aucune)
  _longestLateralEdge(parcel, edgeTypes) {
    if (!parcel || parcel.length < 3) return -1;
    let bestIdx = -1, bestLen = 0;
    for (let i = 0; i < parcel.length; i++) {
      if (edgeTypes[i] !== 'lateral' && edgeTypes[i] !== 'lat') continue;
      const j = (i + 1) % parcel.length;
      const len = Math.hypot(parcel[j].x - parcel[i].x, parcel[j].y - parcel[i].y);
      if (len > bestLen) { bestLen = len; bestIdx = i; }
    }
    return bestIdx;
  },

  _voieAzimuth(parcelLocal, edgeTypes) {
    const voieIdx = edgeTypes.indexOf('voie');
    if (voieIdx < 0) return 180;
    const n  = parcelLocal.length;
    const j  = (voieIdx + 1) % n;
    const dx = parcelLocal[j].x - parcelLocal[voieIdx].x;
    const dy = parcelLocal[j].y - parcelLocal[voieIdx].y;
    return ((Math.atan2(dx, dy) * 180 / Math.PI) + 360) % 360;
  },

  _viewDirection(terrain) {
    const lng = parseFloat(terrain.lng ?? 55.45);
    const lat = parseFloat(terrain.lat ?? -21.15);
    if (lng < 55.4)  return 270;
    if (lng > 55.65) return 90;
    if (lat > -21.0) return 180;
    return 0;
  },

  _optimalAspect(ctx) {
    return 1.7;
  },

  // ── SETBACK ────────────────────────────────────────────────────
  // Si mitoyen_g XOR mitoyen_d, on construit un tableau de reculs par arête
  // (recul=0 du côté mitoyen, Lmin de l'autre). Sinon on passe le map simple
  // qui sera traduit en interne par _offsetPolygon.
  _setback(parcelLocal, edgeTypes, plu) {
    const splitMit = !!plu.mitoyen_g !== !!plu.mitoyen_d;
    if (splitMit) {
      const sides = this._classifyLateralSides(parcelLocal, edgeTypes);
      const reculsArr = edgeTypes.map((t, i) => {
        if (t === 'voie') return plu.recul_voie;
        if (t === 'fond') return plu.recul_fond;
        // lateral : règle binaire par côté
        const side = sides[i];
        if (side === 'g' && plu.mitoyen_g) return 0;
        if (side === 'd' && plu.mitoyen_d) return 0;
        return plu.lat_lmin ?? plu.recul_lat;
      });
      return this._offsetPolygon(parcelLocal, edgeTypes, reculsArr);
    }
    const reculs = { voie: plu.recul_voie, fond: plu.recul_fond, lateral: plu.recul_lat };
    return this._offsetPolygon(parcelLocal, edgeTypes, reculs);
  },

  // Classifie chaque arête latérale en 'g' (gauche) ou 'd' (droite) en
  // projetant son midpoint sur la tangente de l'arête voie principale.
  // Retourne un tableau de la même longueur que parcelLocal — null pour
  // les arêtes non latérales.
  _classifyLateralSides(parcelLocal, edgeTypes) {
    const n = parcelLocal.length;
    const out = new Array(n).fill(null);
    const voieIdx = edgeTypes.indexOf('voie');
    if (voieIdx < 0) {
      // Pas de voie connue → fallback : signe X relatif au centroïde
      const cx = parcelLocal.reduce((s, p) => s + p.x, 0) / n;
      for (let i = 0; i < n; i++) {
        if (edgeTypes[i] !== 'lateral' && edgeTypes[i] !== 'lat') continue;
        const j = (i + 1) % n;
        const mx = (parcelLocal[i].x + parcelLocal[j].x) / 2;
        out[i] = mx < cx ? 'g' : 'd';
      }
      return out;
    }
    const vj = (voieIdx + 1) % n;
    const vdx = parcelLocal[vj].x - parcelLocal[voieIdx].x;
    const vdy = parcelLocal[vj].y - parcelLocal[voieIdx].y;
    const vlen = Math.hypot(vdx, vdy);
    if (vlen < 0.01) return out;
    // Tangente unitaire de la voie (orientée parcelLocal[voieIdx]→[vj])
    const tx = vdx / vlen, ty = vdy / vlen;
    const vmx = (parcelLocal[voieIdx].x + parcelLocal[vj].x) / 2;
    const vmy = (parcelLocal[voieIdx].y + parcelLocal[vj].y) / 2;
    // Sens du polygone (en espace SVG Y-down : signedArea>0 = CW visuel)
    const sa = this._signedAreaSH(parcelLocal);
    // En CW visuel, "gauche" du sens de marche voie = projection négative
    const flip = sa > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      if (edgeTypes[i] !== 'lateral' && edgeTypes[i] !== 'lat') continue;
      const j = (i + 1) % n;
      const mx = (parcelLocal[i].x + parcelLocal[j].x) / 2;
      const my = (parcelLocal[i].y + parcelLocal[j].y) / 2;
      const proj = ((mx - vmx) * tx + (my - vmy) * ty) * flip;
      out[i] = proj < 0 ? 'g' : 'd';
    }
    return out;
  },

  // Offset polygon autonome (corrige : CW en espace Y-inverse, normales interieures)
  // reculs : soit { voie, fond, lateral } (map par type), soit [r0..rn-1] (array
  // par arête, longueur === pts.length). Le mode array permet le mitoyen G/D.
  _offsetPolygon(pts, edgeTypes, reculs) {
    const n = pts.length;
    if (n < 3) return [];
    const isArr = Array.isArray(reculs);

    const signedArea = (p) => {
      let a = 0;
      for (let i = 0; i < p.length; i++) {
        const j = (i + 1) % p.length;
        a += p[i].x * p[j].y - p[j].x * p[i].y;
      }
      return a / 2;
    };

    // En espace SVG (Y inverse), shoelace > 0 = CW visuellement
    const sa = signedArea(pts);
    const cw = sa > 0 ? pts : [...pts].reverse();
    const et = sa > 0 ? edgeTypes : [...edgeTypes].reverse();
    const ra = isArr ? (sa > 0 ? reculs : [...reculs].reverse()) : null;

    // Bbox parcelle pour clamp des sommets aberrants (angles aigus)
    const bx = this._bbox(cw);
    const margin = Math.max(bx.maxX - bx.minX, bx.maxY - bx.minY) * 0.5;
    const clampBox = {
      minX: bx.minX - margin, maxX: bx.maxX + margin,
      minY: bx.minY - margin, maxY: bx.maxY + margin,
    };

    const offsetEdges = [];
    for (let i = 0; i < n; i++) {
      const j   = (i + 1) % n;
      const dx  = cw[j].x - cw[i].x;
      const dy  = cw[j].y - cw[i].y;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) {
        if (offsetEdges.length > 0) offsetEdges.push({ ...offsetEdges[offsetEdges.length - 1] });
        continue;
      }
      // Normale interieure en espace Y-inverse pour polygon CW : (-dy/len, +dx/len)
      const nx  = -dy / len;
      const ny  =  dx / len;
      const type = et[i] ?? 'lateral';
      const r    = isArr
        ? (ra[i] ?? 0)
        : (type === 'voie' ? reculs.voie : type === 'fond' ? reculs.fond : reculs.lateral);
      offsetEdges.push({
        p1: { x: cw[i].x + nx * r, y: cw[i].y + ny * r },
        p2: { x: cw[j].x + nx * r, y: cw[j].y + ny * r },
      });
    }
    if (offsetEdges.length < 3) return [];

    const result = [];
    for (let i = 0; i < offsetEdges.length; i++) {
      const j  = (i + 1) % offsetEdges.length;
      const pt = this._intersectLines(offsetEdges[i].p1, offsetEdges[i].p2, offsetEdges[j].p1, offsetEdges[j].p2);
      if (pt && isFinite(pt.x) && isFinite(pt.y)) {
        // Clamp angles aigus
        pt.x = Math.max(clampBox.minX, Math.min(clampBox.maxX, pt.x));
        pt.y = Math.max(clampBox.minY, Math.min(clampBox.maxY, pt.y));
        result.push(pt);
      }
    }
    const area = Math.abs(signedArea(result));
    if (result.length < 3 || area < 1) return [];

    // Garde finale : éperons aigus (angle intérieur < 90°). Complémentaire au
    // clamp box ci-dessus (qui borne les sommets aberrants distants). Ici on
    // catche les sommets convexes valides mais sub-90° (limites obliques).
    const GU = (typeof window !== 'undefined') ? window.GeoUtils : null;
    if (GU?.removeAcuteSpikes) {
      const cleaned = GU.removeAcuteSpikes(result, 90);
      if (cleaned && cleaned.length >= 3 && Math.abs(signedArea(cleaned)) >= 1) {
        return cleaned;
      }
    }
    return result;
  },

  // Fallback: convertir GeoJSON parcelle en local (si pas fourni par EsquisseCanvas)
  _parcelToLocal(session) {
    const geom = session.terrain?.parcelle_geojson;
    if (!geom) return null;
    const coords = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
    const center = [
      coords.reduce((s, c) => s + c[0], 0) / coords.length,
      coords.reduce((s, c) => s + c[1], 0) / coords.length,
    ];
    const LNG = 111320 * Math.cos(center[1] * Math.PI / 180);
    const LAT = 111320;
    return coords.map(c => ({
      x:  (c[0] - center[0]) * LNG,
      y: -(c[1] - center[1]) * LAT,
    }));
  },

  // Heuristique classification aretes quand pas fourni par EsquisseCanvas
  _classifyEdgesHeuristic(parcel) {
    if (!parcel || parcel.length < 3) return [];
    const n = parcel.length;
    const types = new Array(n).fill('lateral');
    const mids = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      mids.push({
        idx:  i,
        midY: (parcel[i].y + parcel[j].y) / 2,
        len:  Math.hypot(parcel[j].x - parcel[i].x, parcel[j].y - parcel[i].y),
      });
    }
    // y max = sud (Y inverse)
    const sortedS = [...mids].sort((a, b) => b.midY - a.midY);
    let voieCount = 0;
    for (const s of sortedS) {
      if (voieCount >= 1) break;
      if (s.len > 3) { types[s.idx] = 'voie'; voieCount++; }
    }
    if (!types.includes('fond')) {
      const voieIdx = types.indexOf('voie');
      if (voieIdx >= 0) {
        const oppositeIdx = (voieIdx + Math.floor(n / 2)) % n;
        if (types[oppositeIdx] === 'lateral') types[oppositeIdx] = 'fond';
      }
    }
    return types;
  },

  // ── UTILITAIRES GEOMETRIQUES ───────────────────────────────────

  _intersectLines(a, b, c, d) {
    // Déléguer à TerrainP07Adapter.lineIsect si disponible (plus robuste : midpoint + spike guard)
    const TA = typeof window !== 'undefined' ? window.TerrainP07Adapter : null;
    if (TA?.lineIsect) {
      const [ix, iy] = TA.lineIsect(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y);
      return { x: ix, y: iy };
    }
    // Fallback intersection classique
    const a1 = b.y - a.y, b1 = a.x - b.x, c1 = a1 * a.x + b1 * a.y;
    const a2 = d.y - c.y, b2 = c.x - d.x, c2 = a2 * c.x + b2 * c.y;
    const det = a1 * b2 - a2 * b1;
    if (Math.abs(det) < 1e-10) return { x: (b.x + d.x) / 2, y: (b.y + d.y) / 2 };
    return { x: (c1 * b2 - c2 * b1) / det, y: (a1 * c2 - a2 * c1) / det };
  },

  // Sutherland-Hodgman clipping
  // En espace SVG (Y-down) : un polygone CW visuel a signedArea < 0.
  // Pour que cross(a,b,p) >= 0 = "intérieur", on doit reverser quand sa < 0.
  // (avant : test inversé → cross >= 0 ne sélectionnait JAMAIS l'intérieur,
  //  donc le clip retournait [] et tout bâtiment disparaissait)
  _clipSH(subject, clip) {
    if (!clip || clip.length < 3 || !subject || subject.length < 3) return [];
    const sa = this._signedAreaSH(clip);
    const ccwClip = sa < 0 ? [...clip].reverse() : clip;

    const cross  = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const isect  = (a, b, c, d) => this._intersectLines(a, b, c, d);
    let output   = [...subject];
    const n      = ccwClip.length;
    for (let i = 0; i < n && output.length; i++) {
      const input = output;
      output      = [];
      const a     = ccwClip[i], b = ccwClip[(i + 1) % n];
      for (let j = 0; j < input.length; j++) {
        const p = input[j], q = input[(j + 1) % input.length];
        const pIn = cross(a, b, p) >= 0;
        const qIn = cross(a, b, q) >= 0;
        if (pIn) { output.push(p); if (!qIn) output.push(isect(a, b, p, q)); }
        else if (qIn) output.push(isect(a, b, p, q));
      }
    }
    return output;
  },

  _signedAreaSH(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return a / 2;
  },

  _area(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return Math.abs(a) / 2;
  },

  _bbox(pts) {
    return {
      minX: Math.min(...pts.map(p => p.x)), maxX: Math.max(...pts.map(p => p.x)),
      minY: Math.min(...pts.map(p => p.y)), maxY: Math.max(...pts.map(p => p.y)),
    };
  },

  // Point-in-polygon (ray casting) pour {x,y}
  _pointInPoly(pt, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const yi = polygon[i].y, yj = polygon[j].y;
      if ((yi > pt.y) !== (yj > pt.y) &&
          pt.x < (polygon[j].x - polygon[i].x) * (pt.y - yi) / (yj - yi) + polygon[i].x) {
        inside = !inside;
      }
    }
    return inside;
  },

  // Convex hull (Andrew's monotone chain) pour [{x,y}]
  _convexHull(pts) {
    if (pts.length < 3) return [...pts];
    const sorted = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  },
};

export default EnvelopeGenerator;
