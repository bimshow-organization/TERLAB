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

  // ── Tagger niveaux + hauteur sur une liste de blocs ──────────────
  applyLevels(blocs, niveaux, hNiv = H_NIV) {
    return blocs.map(b => ({
      ...b,
      niveaux,
      hauteur: niveaux * hNiv,
    }));
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
};

export default AutoPlanStrategies;

if (typeof window !== 'undefined') window.AutoPlanStrategies = AutoPlanStrategies;
