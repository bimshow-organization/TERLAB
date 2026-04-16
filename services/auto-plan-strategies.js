// terlab/services/auto-plan-strategies.js
// AutoPlanStrategies — Stratégies d'implantation et générateur multi-blocs
// ENSA La Réunion · MGA Architecture 2026
//
// 4 stratégies de footprint :
//   1. rect    : rectangle aligné sur l'axe principal de l'enveloppe (PCA), centré sur PIR
//   2. oblique : rectangle aligné sur l'arête dominante non-voirie, ancré côté voirie
//   3. zone    : épouse la zone constructible (polygone n-côtés inset)
//   4. multi   : N rectangles en bande le long de l'axe principal, avec gap minimum
//
// Toutes les stratégies retournent une liste de blocs :
//   [{ polygon, theta, w, l, niveaux, hauteur, areaM2 }, ...]

import FH from './footprint-helpers.js';

const H_NIV  = 3.0;
const MIN_W  = 4;
const MIN_L  = 5;

const AutoPlanStrategies = {

  // ── Stratégie 1 : Rectangle orienté PCA, centré sur PIR ─────────
  // env       : polygone enveloppe constructible (zone après inset)
  // wTarget   : largeur visée (m, perpendiculaire à l'axe principal)
  // lTarget   : longueur visée (m, le long de l'axe principal)
  // pir       : { x, y } pôle d'inaccessibilité
  // bearing   : (optionnel) bearing imposé en degrés (math, atan2(uy,ux)*180/PI)
  rect(env, wTarget, lTarget, pir, bearing = null) {
    if (!env || env.length < 3) return [];
    const envXY = env.map(p => FH.toXY(p));

    let theta;
    if (bearing != null && !isNaN(bearing)) {
      theta = bearing;
    } else {
      const obb = FH.obb(envXY);
      theta = obb.theta;
    }

    // Construire le rectangle centré sur PIR et orienté theta
    const cx = pir?.x ?? FH.centroidWeighted(envXY).x;
    const cy = pir?.y ?? FH.centroidWeighted(envXY).y;

    let raw = FH.rectCentered(cx, cy, wTarget, lTarget, theta);
    let clipped = FH.clipPolygon(raw, envXY);

    // Si le clip trop agressif détruit le rect, on rétrécit progressivement
    let scale = 1.0;
    while ((clipped.length < 3 || FH.area(clipped) < MIN_W * MIN_L) && scale > 0.4) {
      scale *= 0.85;
      raw = FH.rectCentered(cx, cy, wTarget * scale, lTarget * scale, theta);
      clipped = FH.clipPolygon(raw, envXY);
    }

    if (clipped.length < 3) return [];
    return [{
      polygon: clipped,
      theta,
      w: wTarget * scale,
      l: lTarget * scale,
      strategy: 'rect',
      areaM2: FH.area(clipped),
    }];
  },

  // ── Stratégie 2 : Oblique aligné sur arête non-voirie dominante ─
  // env        : enveloppe constructible
  // parcelPoly : polygone parcelle d'origine (utilisé pour calculer l'arête dominante)
  // edgeTypes  : types des arêtes parcelle ('voie', 'lat', 'fond', ...)
  // wTarget, lTarget
  oblique(env, parcelPoly, edgeTypes, wTarget, lTarget) {
    if (!env || env.length < 3 || !parcelPoly || parcelPoly.length < 3) return [];
    const envXY = env.map(p => FH.toXY(p));
    const parcelXY = parcelPoly.map(p => FH.toXY(p));

    // Trouver l'arête la plus longue qui n'est PAS la voirie
    const voieIdx = (edgeTypes ?? []).indexOf('voie');
    const longest = FH.longestEdge(parcelXY, voieIdx);
    if (!longest) return [];

    const u = longest.dir;          // direction de la longueur (le long de l'arête)
    const v = { x: -u.y, y: u.x };  // perpendiculaire (90° trigo)

    // Centre de l'enveloppe
    const c = FH.centroidWeighted(envXY);

    // Le rectangle est tourné de theta = atan2(uy, ux)
    const theta = Math.atan2(u.y, u.x) * 180 / Math.PI;

    let raw = FH.rectCentered(c.x, c.y, wTarget, lTarget, theta);
    let clipped = FH.clipPolygon(raw, envXY);

    // Si le clip rétrécit trop, on essaie de translater le rect le long de la
    // perpendiculaire (v) pour trouver une meilleure position
    if (clipped.length < 3 || FH.area(clipped) < MIN_W * MIN_L) {
      let bestArea = 0, bestClipped = clipped;
      for (let t = -3; t <= 3; t += 0.5) {
        const cx2 = c.x + v.x * t;
        const cy2 = c.y + v.y * t;
        const r2 = FH.rectCentered(cx2, cy2, wTarget, lTarget, theta);
        const c2 = FH.clipPolygon(r2, envXY);
        const a2 = FH.area(c2);
        if (a2 > bestArea) { bestArea = a2; bestClipped = c2; }
      }
      clipped = bestClipped;
    }

    // Réduction si toujours trop petit
    let scale = 1.0;
    while ((clipped.length < 3 || FH.area(clipped) < MIN_W * MIN_L) && scale > 0.4) {
      scale *= 0.85;
      const r3 = FH.rectCentered(c.x, c.y, wTarget * scale, lTarget * scale, theta);
      clipped = FH.clipPolygon(r3, envXY);
    }

    if (clipped.length < 3) return [];
    return [{
      polygon: clipped,
      theta,
      w: wTarget * scale,
      l: lTarget * scale,
      strategy: 'oblique',
      areaM2: FH.area(clipped),
    }];
  },

  // ── Stratégie 3 : Épouse la zone constructible (polygone inset) ─
  // env : zone constructible
  // wallRetreat : retrait épaisseur mur (défaut 0.5m)
  // areaCap : surface emprise max acceptable (m²) — si la zone dépasse, on ne fait rien
  zone(env, wallRetreat = 0.5, areaCap = Infinity) {
    if (!env || env.length < 3) return [];
    const envXY = env.map(p => FH.toXY(p));
    const envArea = FH.area(envXY);
    if (envArea < MIN_W * MIN_L) return [];
    if (envArea > areaCap * 1.4) return []; // zone trop grande pour cette stratégie

    // Inset 0.5m via clip par chaque demi-plan retreat — utilisons l'OBB élargie
    // approche simplifiée : on utilise l'enveloppe directement (le retreat est cosmétique)
    // Pour un vrai inset uniforme, on clippe par chaque demi-plan décalé.
    let clipped = envXY.map(p => ({ x: p.x, y: p.y }));
    if (wallRetreat > 0.01) {
      const orient = FH.signedArea(envXY) >= 0 ? 1 : -1;
      const n = envXY.length;
      for (let i = 0; i < n; i++) {
        const a = envXY[i];
        const b = envXY[(i + 1) % n];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len * orient;
        const ny =  dx / len * orient;
        const px = a.x + nx * wallRetreat;
        const py = a.y + ny * wallRetreat;
        clipped = FH._clipHalfPlane(clipped, { x: px, y: py }, nx, ny);
        if (clipped.length < 3) break;
      }
    }
    if (clipped.length < 3) return [];

    const aabb = FH.aabb(clipped);
    return [{
      polygon: clipped,
      theta: 0,
      w: Math.min(aabb.w, aabb.l),
      l: Math.max(aabb.w, aabb.l),
      strategy: 'zone',
      areaM2: FH.area(clipped),
    }];
  },

  // ── Stratégie 4 : Multi-blocs en bande le long de l'axe principal ──
  // Découpe l'enveloppe en N bandes parallèles de longueur lTarget chacune,
  // séparées par un gap. Chaque bande est ensuite clippée par l'enveloppe.
  //
  // env       : enveloppe constructible
  // wTarget   : largeur d'un bloc (perp axe)
  // lTarget   : longueur d'un bloc (le long axe) — si null → adaptatif
  // gap       : distance entre blocs (m)
  // nMax      : nombre max de blocs à essayer
  // bearing   : angle imposé (deg, math). Si null, OBB.theta
  multiRect(env, wTarget, lTarget, gap = 4, nMax = 4, bearing = null) {
    if (!env || env.length < 3) return [];
    const envXY = env.map(p => FH.toXY(p));
    const envArea = FH.area(envXY);
    if (envArea < MIN_W * MIN_L * 2) return []; // pas la peine

    const obb = FH.obb(envXY);
    const theta = bearing != null ? bearing : obb.theta;
    const u = { x: Math.cos(theta * Math.PI / 180), y: Math.sin(theta * Math.PI / 180) };
    const v = { x: -u.y, y: u.x };

    const c = obb.center;

    // Longueur disponible le long de u = obb.l
    // Pour N blocs avec gap : lAvail = N*lBloc + (N-1)*gap
    // Si lTarget non fourni, on calcule lBloc tel que ça tienne dans obb.l
    let lBloc = lTarget;
    let n = nMax;
    if (!lBloc || lBloc <= 0) {
      // Adaptatif : essayer de tenir 2..nMax blocs de longueur >= MIN_L
      for (let trial = nMax; trial >= 2; trial--) {
        const l = (obb.l - (trial - 1) * gap) / trial;
        if (l >= MIN_L) { lBloc = l; n = trial; break; }
      }
      if (!lBloc) return []; // pas assez de place pour 2 blocs
    } else {
      // lBloc imposé : combien de blocs tiennent ?
      n = Math.min(nMax, Math.max(2, Math.floor((obb.l + gap) / (lBloc + gap))));
      if (n < 2) return [];
    }

    // Pas entre centres successifs
    const stride = lBloc + gap;
    // Position du premier centre (le long de u, depuis c)
    const start = -((n - 1) * stride) / 2;

    const blocs = [];
    for (let i = 0; i < n; i++) {
      const offset = start + i * stride;
      const cx = c.x + u.x * offset;
      const cy = c.y + u.y * offset;
      const raw = FH.rectCentered(cx, cy, wTarget, lBloc, theta);
      const clipped = FH.clipPolygon(raw, envXY);
      if (clipped.length >= 3 && FH.area(clipped) >= MIN_W * MIN_L * 0.7) {
        blocs.push({
          polygon: clipped,
          theta,
          w: wTarget,
          l: lBloc,
          strategy: 'multi',
          areaM2: FH.area(clipped),
        });
      }
    }

    // Vérifier que les gaps réels entre blocs sont OK
    if (blocs.length >= 2) {
      const ok = FH.blocsRespectGap(blocs, gap * 0.9); // tolérance 10%
      if (!ok) return [];
    }

    return blocs;
  },

  // ── Stratégie 5 : Isohypses (alignement ⊥ à la pente) ───────────
  // Aligne le rectangle perpendiculairement à l'axe de la pente (parallèle
  // aux courbes de niveau) puis le tronque pour respecter profMax topo.
  // Convient aux pentes ≥ 5% — cf. TopoCaseService.profMax.
  //
  // env         : enveloppe constructible
  // wTarget     : largeur le long des courbes (m)
  // lTarget     : profondeur perpendiculaire aux courbes (m, ≤ profMax)
  // pir         : pôle d'inaccessibilité {x,y}
  // azimut_deg  : direction de la pente (0=N, sens horaire compass)
  // profMax     : profondeur maximum imposée par TopoCaseService (m)
  // opts        : { ySouth: true si l'espace est SVG Y-down }
  isohypses(env, wTarget, lTarget, pir, azimut_deg, profMax, opts = {}) {
    if (!env || env.length < 3) return [];
    if (!Number.isFinite(azimut_deg)) return [];
    const envXY = env.map(p => FH.toXY(p));

    // Theta math (rad) : perpendiculaire à la pente = parallèle aux courbes.
    // azimut_deg est compass (0=N, sens horaire), donc l'axe pente en math
    // (atan2 standard, 0=+X, sens trigo) est θ_pente = π/2 − az_rad.
    // Le bâtiment est aligné perpendiculairement → on tourne de +π/2 :
    //   θ_bat_rad = (π/2 − az_rad) + π/2 = π − az_rad
    // On veut une rotation en degrés (math) pour FH.rectCentered :
    const azRad = azimut_deg * Math.PI / 180;
    const thetaRad = Math.PI - azRad;
    const thetaDeg = thetaRad * 180 / Math.PI;

    // Profondeur effective : min(lTarget, profMax)
    const lEff = Math.min(lTarget, profMax);
    if (lEff < MIN_L) return [];

    const cx = pir?.x ?? FH.centroidWeighted(envXY).x;
    const cy = pir?.y ?? FH.centroidWeighted(envXY).y;

    let raw = FH.rectCentered(cx, cy, wTarget, lEff, thetaDeg);
    // Clamp le long de l'axe pente (filet de sécurité — lEff respecte déjà profMax,
    // mais après le clip ça peut déborder côté aval)
    raw = FH.clampRectProfMaxAlongAzimut(raw, azimut_deg, profMax, opts);
    let clipped = FH.clipPolygon(raw, envXY);

    // Réduction adaptative si le clip détruit le rect
    let scale = 1.0;
    while ((clipped.length < 3 || FH.area(clipped) < MIN_W * MIN_L) && scale > 0.4) {
      scale *= 0.85;
      let r = FH.rectCentered(cx, cy, wTarget * scale, lEff * scale, thetaDeg);
      r = FH.clampRectProfMaxAlongAzimut(r, azimut_deg, profMax, opts);
      clipped = FH.clipPolygon(r, envXY);
    }
    if (clipped.length < 3) return [];

    return [{
      polygon: clipped,
      theta: thetaDeg,
      w: wTarget * scale,
      l: lEff * scale,
      strategy: 'isohypses',
      areaM2: FH.area(clipped),
    }];
  },

  // ── Stratégie Alizés : rectangle orienté 45° NE (bioclimatique Réunion) ─
  // Flux alizés dominants NE → façades principales orientées NE/SW pour
  // captation ventilation naturelle traversante (RTAA DOM 2016).
  // Délègue à rect() avec bearing=45° math (NE en repère Y-up).
  alize(env, wTarget, lTarget, pir) {
    const blocs = this.rect(env, wTarget, lTarget, pir, 45);
    return blocs.map(b => ({ ...b, strategy: 'alize' }));
  },

  // ═══════════════════════════════════════════════════════════════════
  // Stratégies v4h portées depuis terlab_parcelles_v4h.html
  // Utilisent maxInscribedAABB / maxInscribedRotAABB / clipPolygon
  // ═══════════════════════════════════════════════════════════════════

  // ── Stratégie : Aligné voirie (rectangle // edge voie) ────────────
  // v4h 'voie' : utilise l'angle de l'edge voie comme axe principal,
  // puis cherche le plus grand rectangle inscrit orienté selon cet axe.
  roadAligned(env, parcelPoly, edgeTypes, wTarget, lTarget) {
    if (!env || env.length < 3 || !parcelPoly || parcelPoly.length < 3) return [];
    const envXY = env.map(p => FH.toXY(p));
    const parcelXY = parcelPoly.map(p => FH.toXY(p));
    const voieIdx = (edgeTypes ?? []).indexOf('voie');
    if (voieIdx < 0) return [];
    const j = (voieIdx + 1) % parcelXY.length;
    const dx = parcelXY[j].x - parcelXY[voieIdx].x;
    const dy = parcelXY[j].y - parcelXY[voieIdx].y;
    const thetaRad = Math.atan2(dy, dx);
    const thetaDeg = thetaRad * 180 / Math.PI;

    // Max inscribed AABB orienté sur thetaRad (v4h maxRot)
    const inscribed = FH.maxInscribedRotAABB(envXY, thetaRad);
    if (!inscribed || inscribed.length < 3) return [];
    const a = FH.area(inscribed);
    if (a < MIN_W * MIN_L) return [];

    // Dims du rect inscrit
    const c = FH.centroid(inscribed);
    const rot = FH.rotatePoly(inscribed, c.x, c.y, -thetaDeg);
    const bb = FH.aabb(rot);
    return [{
      polygon: inscribed,
      theta: thetaDeg,
      w: Math.min(bb.w, bb.l),
      l: Math.max(bb.w, bb.l),
      strategy: 'roadAligned',
      areaM2: a,
    }];
  },

  // ── Stratégie : Long. lat. max (rectangle // plus long edge lateral) ──
  latMax(env, parcelPoly, edgeTypes) {
    if (!env || env.length < 3 || !parcelPoly || parcelPoly.length < 3) return [];
    const envXY = env.map(p => FH.toXY(p));
    const parcelXY = parcelPoly.map(p => FH.toXY(p));
    const n = parcelXY.length;
    let bestI = -1, bestLen = 0;
    for (let i = 0; i < n; i++) {
      if ((edgeTypes?.[i] ?? 'lat') !== 'lat' && (edgeTypes?.[i] ?? 'lateral') !== 'lateral') continue;
      const j = (i + 1) % n;
      const len = Math.hypot(parcelXY[j].x - parcelXY[i].x, parcelXY[j].y - parcelXY[i].y);
      if (len > bestLen) { bestLen = len; bestI = i; }
    }
    if (bestI < 0) return [];
    const j = (bestI + 1) % n;
    const thetaRad = Math.atan2(parcelXY[j].y - parcelXY[bestI].y, parcelXY[j].x - parcelXY[bestI].x);
    const inscribed = FH.maxInscribedRotAABB(envXY, thetaRad);
    if (!inscribed || FH.area(inscribed) < MIN_W * MIN_L) return [];
    const thetaDeg = thetaRad * 180 / Math.PI;
    const c = FH.centroid(inscribed);
    const rot = FH.rotatePoly(inscribed, c.x, c.y, -thetaDeg);
    const bb = FH.aabb(rot);
    return [{
      polygon: inscribed,
      theta: thetaDeg,
      w: Math.min(bb.w, bb.l),
      l: Math.max(bb.w, bb.l),
      strategy: 'latMax',
      areaM2: FH.area(inscribed),
    }];
  },

  // ── Stratégie : T-Shape (intersection 2 rect orthogonaux) ────────
  // Bar horizontal (traversant) + bar vertical (central court)
  tShape(env, bearing = null, lRatio = 0.55, wRatio = 0.45) {
    if (!env || env.length < 3) return [];
    const envXY = env.map(p => FH.toXY(p));
    const theta = bearing != null ? bearing : FH.obb(envXY).theta;

    // Bar principal aligné sur theta — emprise du rect inscrit orienté
    const primary = FH.maxInscribedRotAABB(envXY, theta * Math.PI / 180);
    if (!primary || primary.length < 3) return [];
    const c = FH.centroid(primary);
    const rot = FH.rotatePoly(primary, c.x, c.y, -theta);
    const bb = FH.aabb(rot);
    const Wp = bb.w, Lp = bb.l;
    const wBar = Wp * wRatio, lBar = Lp;                 // bar horizontal (fin, long)
    const wStem = Wp, lStem = Lp * lRatio;                // bar vertical (large, court)

    const bar = FH.rectCentered(c.x, c.y, wBar, lBar, theta);
    const stem = FH.rectCentered(c.x, c.y, wStem, lStem, theta);
    const barClip = FH.clipPolygon(bar, envXY);
    const stemClip = FH.clipPolygon(stem, envXY);
    const out = [];
    if (barClip.length >= 3 && FH.area(barClip) >= MIN_W * MIN_L * 0.5) {
      out.push({ polygon: barClip, theta, w: wBar, l: lBar, strategy: 'tShape', shapeType: 'tShape', part: 'bar', areaM2: FH.area(barClip) });
    }
    if (stemClip.length >= 3 && FH.area(stemClip) >= MIN_W * MIN_L * 0.5) {
      out.push({ polygon: stemClip, theta, w: wStem, l: lStem, strategy: 'tShape', shapeType: 'tShape', part: 'stem', areaM2: FH.area(stemClip) });
    }
    return out.length ? out : [];
  },

  // ── Stratégie : Cross (+ intersection 2 rect orthogonaux centrés) ──
  cross(env, bearing = null, armRatio = 0.35) {
    if (!env || env.length < 3) return [];
    const envXY = env.map(p => FH.toXY(p));
    const theta = bearing != null ? bearing : FH.obb(envXY).theta;
    const primary = FH.maxInscribedRotAABB(envXY, theta * Math.PI / 180);
    if (!primary || primary.length < 3) return [];
    const c = FH.centroid(primary);
    const rot = FH.rotatePoly(primary, c.x, c.y, -theta);
    const bb = FH.aabb(rot);
    const Wp = bb.w, Lp = bb.l;
    const wH = Wp * armRatio, lH = Lp;         // bras horizontal fin
    const wV = Wp, lV = Lp * armRatio;          // bras vertical fin

    const horiz = FH.rectCentered(c.x, c.y, wH, lH, theta);
    const vert = FH.rectCentered(c.x, c.y, wV, lV, theta);
    const hClip = FH.clipPolygon(horiz, envXY);
    const vClip = FH.clipPolygon(vert, envXY);
    const out = [];
    if (hClip.length >= 3 && FH.area(hClip) >= MIN_W * MIN_L * 0.5) {
      out.push({ polygon: hClip, theta, w: wH, l: lH, strategy: 'cross', shapeType: 'cross', part: 'horiz', areaM2: FH.area(hClip) });
    }
    if (vClip.length >= 3 && FH.area(vClip) >= MIN_W * MIN_L * 0.5) {
      out.push({ polygon: vClip, theta, w: wV, l: lV, strategy: 'cross', shapeType: 'cross', part: 'vert', areaM2: FH.area(vClip) });
    }
    return out.length ? out : [];
  },

  // ── Stratégie : Bi-barre reliée (2 bars + noyau central) ─────────
  // 2 barres parallèles + 1 petit noyau central reliant les deux.
  biBarre(env, bearing = null, noyauM = 3) {
    if (!env || env.length < 3) return [];
    const envXY = env.map(p => FH.toXY(p));
    const theta = bearing != null ? bearing : FH.obb(envXY).theta;
    const primary = FH.maxInscribedRotAABB(envXY, theta * Math.PI / 180);
    if (!primary || primary.length < 3) return [];
    const c = FH.centroid(primary);
    const rot = FH.rotatePoly(primary, c.x, c.y, -theta);
    const bb = FH.aabb(rot);
    const Lp = bb.l, Wp = bb.w;
    const barL = (Lp - noyauM) / 2;
    const barW = Wp;
    if (barL < MIN_L) return [];

    // Positions (dans le repère local de primary)
    const u = { x: Math.cos(theta * Math.PI / 180), y: Math.sin(theta * Math.PI / 180) };
    const offset = (noyauM + barL) / 2;
    const c1 = { x: c.x - u.x * offset, y: c.y - u.y * offset };
    const c2 = { x: c.x + u.x * offset, y: c.y + u.y * offset };

    const bar1 = FH.clipPolygon(FH.rectCentered(c1.x, c1.y, barW, barL, theta), envXY);
    const bar2 = FH.clipPolygon(FH.rectCentered(c2.x, c2.y, barW, barL, theta), envXY);
    const noyau = FH.clipPolygon(FH.rectCentered(c.x, c.y, noyauM, noyauM, theta), envXY);

    const out = [];
    if (bar1.length >= 3 && FH.area(bar1) >= MIN_W * MIN_L * 0.5) out.push({ polygon: bar1, theta, w: barW, l: barL, strategy: 'biBarre', shapeType: 'biBarre', part: 'bar1', areaM2: FH.area(bar1) });
    if (bar2.length >= 3 && FH.area(bar2) >= MIN_W * MIN_L * 0.5) out.push({ polygon: bar2, theta, w: barW, l: barL, strategy: 'biBarre', shapeType: 'biBarre', part: 'bar2', areaM2: FH.area(bar2) });
    if (noyau.length >= 3 && FH.area(noyau) >= 4) out.push({ polygon: noyau, theta, w: noyauM, l: noyauM, strategy: 'biBarre', shapeType: 'biBarre', part: 'noyau', areaM2: FH.area(noyau) });
    return out.length >= 2 ? out : [];
  },

  // ── Stratégie : 2 Lames parallèles (split axial + maxAABB par moitié) ──
  // Découpe l'enveloppe par la médiane (Y si portrait, X si paysage) avec un
  // gap central, puis inscrit un rectangle max dans chaque moitié.
  deuxLames(env, gap = 4, minDimM = 5) {
    if (!env || env.length < 3) return [];
    const envXY = env.map(p => FH.toXY(p));
    const xs = envXY.map(p => p.x), ys = envXY.map(p => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const zW = x1 - x0, zH = y1 - y0;
    const PAD = 1000, HG = gap / 2;
    let poly1 = null, poly2 = null;

    if (zH >= zW) {
      const mY = y0 + zH / 2;
      const top = FH.clipPolygon(envXY, [
        { x: x0 - PAD, y: y0 - PAD }, { x: x1 + PAD, y: y0 - PAD },
        { x: x1 + PAD, y: mY - HG }, { x: x0 - PAD, y: mY - HG },
      ]);
      const bot = FH.clipPolygon(envXY, [
        { x: x0 - PAD, y: mY + HG }, { x: x1 + PAD, y: mY + HG },
        { x: x1 + PAD, y: y1 + PAD }, { x: x0 - PAD, y: y1 + PAD },
      ]);
      if (top?.length >= 3) poly1 = FH.maxInscribedAABB(top);
      if (bot?.length >= 3) poly2 = FH.maxInscribedAABB(bot);
    } else {
      const mX = x0 + zW / 2;
      const lf = FH.clipPolygon(envXY, [
        { x: x0 - PAD, y: y0 - PAD }, { x: mX - HG, y: y0 - PAD },
        { x: mX - HG, y: y1 + PAD }, { x: x0 - PAD, y: y1 + PAD },
      ]);
      const rt = FH.clipPolygon(envXY, [
        { x: mX + HG, y: y0 - PAD }, { x: x1 + PAD, y: y0 - PAD },
        { x: x1 + PAD, y: y1 + PAD }, { x: mX + HG, y: y1 + PAD },
      ]);
      if (lf?.length >= 3) poly1 = FH.maxInscribedAABB(lf);
      if (rt?.length >= 3) poly2 = FH.maxInscribedAABB(rt);
    }
    const minD = r => {
      if (!r || r.length < 3) return 0;
      const xx = r.map(p => p.x), yy = r.map(p => p.y);
      return Math.min(Math.max(...xx) - Math.min(...xx), Math.max(...yy) - Math.min(...yy));
    };
    const res = [poly1, poly2].filter(r => r && r.length >= 3 && minD(r) >= minDimM);
    if (res.length < 2) return [];
    return res.map((p, i) => {
      const bb = FH.aabb(p);
      return {
        polygon: p, theta: 0, w: Math.min(bb.w, bb.l), l: Math.max(bb.w, bb.l),
        strategy: 'deuxLames', shapeType: 'deuxLames', part: `lame${i + 1}`,
        areaM2: FH.area(p),
      };
    });
  },

  // ── Stratégie : 3 Lames parallèles (3 bandes égales + maxAABB par bande) ──
  troisLames(env, gap = 4, minDimM = 5) {
    if (!env || env.length < 3) return [];
    const envXY = env.map(p => FH.toXY(p));
    const xs = envXY.map(p => p.x), ys = envXY.map(p => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const zW = x1 - x0, zH = y1 - y0;
    const PAD = 1000;
    // Seuil empirique v4h : pas la peine sous ~12 × 12 m utiles (une fois gaps)
    if (zW * zH < 12 * 12) return [];
    const res = [];

    if (zH >= zW) {
      const slH = (zH - 2 * gap) / 3;
      if (slH < minDimM) return [];
      for (let k = 0; k < 3; k++) {
        const yS = y0 + k * (slH + gap), yE = yS + slH;
        const sl = FH.clipPolygon(envXY, [
          { x: x0 - PAD, y: yS }, { x: x1 + PAD, y: yS },
          { x: x1 + PAD, y: yE }, { x: x0 - PAD, y: yE },
        ]);
        if (sl?.length >= 3) {
          const r = FH.maxInscribedAABB(sl);
          if (r?.length >= 3) res.push(r);
        }
      }
    } else {
      const slW = (zW - 2 * gap) / 3;
      if (slW < minDimM) return [];
      for (let k = 0; k < 3; k++) {
        const xS = x0 + k * (slW + gap), xE = xS + slW;
        const sl = FH.clipPolygon(envXY, [
          { x: xS, y: y0 - PAD }, { x: xE, y: y0 - PAD },
          { x: xE, y: y1 + PAD }, { x: xS, y: y1 + PAD },
        ]);
        if (sl?.length >= 3) {
          const r = FH.maxInscribedAABB(sl);
          if (r?.length >= 3) res.push(r);
        }
      }
    }
    const minD = r => {
      const xx = r.map(p => p.x), yy = r.map(p => p.y);
      return Math.min(Math.max(...xx) - Math.min(...xx), Math.max(...yy) - Math.min(...yy));
    };
    const valid = res.filter(r => minD(r) >= minDimM);
    if (valid.length < 2) return [];
    return valid.map((p, i) => {
      const bb = FH.aabb(p);
      return {
        polygon: p, theta: 0, w: Math.min(bb.w, bb.l), l: Math.max(bb.w, bb.l),
        strategy: 'troisLames', shapeType: 'troisLames', part: `lame${i + 1}`,
        areaM2: FH.area(p),
      };
    });
  },

  // ── Tagger niveaux + hauteur sur une liste de blocs ──────────────
  applyLevels(blocs, niveaux, hNiv = H_NIV) {
    return blocs.map(b => ({
      ...b,
      niveaux,
      hauteur: niveaux * hNiv,
    }));
  },

  // ── Stratégie 6 : L-shape (bi-volume en L) ─────────────────────────
  // Construit un L orienté sur l'axe de l'enveloppe, clippé dedans.
  // lRatio contrôle la proportion de l'aile secondaire (0.4 → 0.7).
  // On essaie les 4 coins de retrait et on garde celui qui donne la meilleure emprise.
  lShape(env, wTarget, lTarget, pir, bearing = null, lRatio = 0.6) {
    if (!env || env.length < 3) return [];
    const envXY = env.map(p => FH.toXY(p));

    let theta;
    if (bearing != null && !isNaN(bearing)) {
      theta = bearing;
    } else {
      theta = FH.obb(envXY).theta;
    }

    const cx = pir?.x ?? FH.centroidWeighted(envXY).x;
    const cy = pir?.y ?? FH.centroidWeighted(envXY).y;

    const wMinor = wTarget * lRatio;
    const lMinor = lTarget * lRatio;
    const corners = ['NE', 'NW', 'SE', 'SW'];

    let bestClipped = [], bestArea = 0, bestCorner = 'NE';
    for (const corner of corners) {
      const raw = FH.lShapeCentered(cx, cy, wTarget, lTarget, wMinor, lMinor, theta, corner);
      const clipped = FH.clipPolygon(raw, envXY);
      const a = clipped.length >= 3 ? FH.area(clipped) : 0;
      if (a > bestArea) { bestArea = a; bestClipped = clipped; bestCorner = corner; }
    }

    // Réduction si nécessaire
    let scale = 1.0;
    while ((bestClipped.length < 3 || bestArea < MIN_W * MIN_L) && scale > 0.4) {
      scale *= 0.85;
      bestArea = 0;
      for (const corner of corners) {
        const raw = FH.lShapeCentered(cx, cy, wTarget * scale, lTarget * scale,
          wMinor * scale, lMinor * scale, theta, corner);
        const clipped = FH.clipPolygon(raw, envXY);
        const a = clipped.length >= 3 ? FH.area(clipped) : 0;
        if (a > bestArea) { bestArea = a; bestClipped = clipped; bestCorner = corner; }
      }
    }

    if (bestClipped.length < 3) return [];
    return [{
      polygon: bestClipped,
      theta,
      w: wTarget * scale,
      l: lTarget * scale,
      strategy: 'lshape',
      shapeType: 'lshape',
      corner: bestCorner,
      areaM2: FH.area(bestClipped),
    }];
  },

  // ── Stratégie 7 : Trapézoïde (adapté aux parcelles qui rétrécissent) ──
  // Détecte la largeur côté voie vs côté fond et crée un trapèze adapté.
  trapezoid(env, parcelPoly, edgeTypes, wTarget, lTarget) {
    if (!env || env.length < 3 || !parcelPoly || parcelPoly.length < 3) return [];
    const envXY = env.map(p => FH.toXY(p));
    const parcelXY = parcelPoly.map(p => FH.toXY(p));
    const obb = FH.obb(envXY);

    // Détecter les largeurs côté voie et côté fond via projection
    const n = parcelXY.length;
    const voieIdx = (edgeTypes ?? []).indexOf('voie');
    const fondIdx = (edgeTypes ?? []).indexOf('fond');
    if (voieIdx < 0 || fondIdx < 0) return [];

    // Largeur côté voie
    const va = parcelXY[voieIdx], vb = parcelXY[(voieIdx + 1) % n];
    const wVoie = Math.hypot(vb.x - va.x, vb.y - va.y);
    // Largeur côté fond
    const fa = parcelXY[fondIdx], fb = parcelXY[(fondIdx + 1) % n];
    const wFond = Math.hypot(fb.x - fa.x, fb.y - fa.y);

    // Si ratio < 1.15, la parcelle est quasi-rectangulaire, le trapèze n'apporte rien
    const ratio = Math.max(wVoie, wFond) / (Math.min(wVoie, wFond) || 1);
    if (ratio < 1.15) return [];

    const c = FH.centroidWeighted(envXY);
    const theta = obb.theta;

    // wStart = côté le plus large (voie ou fond), wEnd = côté le plus étroit
    // La profondeur suit lTarget
    const wStart = Math.min(wTarget, Math.max(wVoie, wFond) * 0.85);
    const wEnd = Math.min(wTarget * 0.95, Math.min(wVoie, wFond) * 0.85);

    const raw = FH.trapezoidCentered(c.x, c.y, wStart, wEnd, lTarget, theta);
    let clipped = FH.clipPolygon(raw, envXY);

    // Réduction si nécessaire
    let scale = 1.0;
    while ((clipped.length < 3 || FH.area(clipped) < MIN_W * MIN_L) && scale > 0.4) {
      scale *= 0.85;
      const r = FH.trapezoidCentered(c.x, c.y, wStart * scale, wEnd * scale, lTarget * scale, theta);
      clipped = FH.clipPolygon(r, envXY);
    }

    if (clipped.length < 3) return [];
    return [{
      polygon: clipped,
      theta,
      w: (wStart + wEnd) / 2 * scale,
      l: lTarget * scale,
      strategy: 'trapezoid',
      shapeType: 'trapezoid',
      areaM2: FH.area(clipped),
    }];
  },

  // ── Stratégie 3b : Épouse zone améliorée (hull avec surface cible) ──
  zoneHull(env, areaCap = Infinity) {
    if (!env || env.length < 3) return [];
    const envXY = env.map(p => FH.toXY(p));
    const clipped = FH.hullFromZone(envXY, 0.5, areaCap);
    if (clipped.length < 3) return [];

    const aabb = FH.aabb(clipped);
    return [{
      polygon: clipped,
      theta: 0,
      w: Math.min(aabb.w, aabb.l),
      l: Math.max(aabb.w, aabb.l),
      strategy: 'zoneHull',
      shapeType: 'zone',
      areaM2: FH.area(clipped),
    }];
  },

  // ── Test si une parcelle est "longue et étroite" ─────────────────
  // Retourne true si le ratio l/w de l'OBB de l'enveloppe ≥ threshold
  isLongAndNarrow(env, threshold = 2.5) {
    if (!env || env.length < 3) return false;
    const envXY = env.map(p => FH.toXY(p));
    const obb = FH.obb(envXY);
    if (obb.w < 0.1) return false;
    return (obb.l / obb.w) >= threshold;
  },

  // ── Test si une parcelle est trapézoïdale ───────────────────────────
  // Retourne true si le ratio largeur voie / largeur fond ≥ threshold
  isTrapezoidalParcel(parcelPoly, edgeTypes, threshold = 1.2) {
    if (!parcelPoly || parcelPoly.length < 3) return false;
    const n = parcelPoly.length;
    const voieIdx = (edgeTypes ?? []).indexOf('voie');
    const fondIdx = (edgeTypes ?? []).indexOf('fond');
    if (voieIdx < 0 || fondIdx < 0) return false;
    const va = FH.toXY(parcelPoly[voieIdx]), vb = FH.toXY(parcelPoly[(voieIdx + 1) % n]);
    const fa = FH.toXY(parcelPoly[fondIdx]), fb = FH.toXY(parcelPoly[(fondIdx + 1) % n]);
    const wV = Math.hypot(vb.x - va.x, vb.y - va.y);
    const wF = Math.hypot(fb.x - fa.x, fb.y - fa.y);
    return Math.max(wV, wF) / (Math.min(wV, wF) || 1) >= threshold;
  },
};

export default AutoPlanStrategies;

if (typeof window !== 'undefined') window.AutoPlanStrategies = AutoPlanStrategies;
