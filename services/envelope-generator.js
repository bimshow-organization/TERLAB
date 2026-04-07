// TERLAB · services/envelope-generator.js
// Shape Grammar PLU v2 — Mueller et al. 2006 adapte RTAA DOM / Reunion
// Pipeline : Lot → SetBack → FootprintZone → ShapeRules → Volume → Score Pareto

const EnvelopeGenerator = {

  // ── ENTREE PRINCIPALE ──────────────────────────────────────────
  // parcelLocal : [{x,y}] en metres — espace SVG (Y inverse)
  // edgeTypes   : string[] — 'voie'|'fond'|'lateral' par arete
  async generate(session, parcelLocal, edgeTypes) {
    const p4      = session?.phases?.[4]?.data ?? {};
    const terrain = session?.terrain ?? {};

    // ── 1. Regles PLU ────────────────────────────────────────────
    const PLU = {
      recul_voie:    parseFloat(p4.recul_voie_m  ?? p4.recul_avant_m ?? 3)  || 3,
      recul_fond:    parseFloat(p4.recul_fond_m  ?? 3)                       || 3,
      recul_lat:     parseFloat(p4.recul_lat_m   ?? 0)                       || 0,
      h_egout:       parseFloat(p4.hauteur_egout_m ?? 7)                     || 7,
      h_faitage:     parseFloat(p4.hauteur_faitage_m ?? 9)                   || 9,
      ces_max:       parseFloat(p4.ces_max ?? 0.7)                           || 0.7,
      cos_max:       parseFloat(p4.cos_max ?? 2.1)                           || 2.1,
      niveaux:       parseInt(p4.niveaux_max ?? 2)                           || 2,
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

    const zone = this._setback(parcel, edges, PLU);
    if (!zone.length) return [];

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

    // ── 4b. Filet de securite : clipper contre la parcelle elle-meme ──
    // Aucune enveloppe ne doit jamais deborder de la parcelle
    for (const prop of proposals) {
      prop.polygon = this._clipSH(prop.polygon, parcel);
      prop.surface = this._area(prop.polygon);
    }

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
  _ruleCompact(zone, plu, ctx) {
    const bbox    = this._bbox(zone);
    const W       = bbox.maxX - bbox.minX;
    const H       = bbox.maxY - bbox.minY;
    const STarget = Math.min(W * H * plu.ces_max, W * H * 0.9);
    const aspect  = this._optimalAspect(ctx);
    let w, h;
    if (W / H > 1) {
      h = Math.sqrt(STarget / aspect);
      w = STarget / h;
    } else {
      w = Math.sqrt(STarget * aspect);
      h = STarget / w;
    }
    w = Math.min(w, W);
    h = Math.min(h, H);

    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;

    const polygon = [
      { x: cx - w/2, y: cy - h/2 },
      { x: cx + w/2, y: cy - h/2 },
      { x: cx + w/2, y: cy + h/2 },
      { x: cx - w/2, y: cy + h/2 },
    ];

    const clipped = this._clipSH(polygon, zone);
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
  _ruleLineaire(zone, parcelLocal, edgeTypes, plu, ctx) {
    const voieIdx = edgeTypes.indexOf('voie');
    if (voieIdx < 0) return null;

    const n  = parcelLocal.length;
    const j  = (voieIdx + 1) % n;
    const vA = parcelLocal[voieIdx];
    const vB = parcelLocal[j];

    const dx  = vB.x - vA.x, dy = vB.y - vA.y;
    const len = Math.hypot(dx, dy);
    if (len < 3) return null;

    const bbox  = this._bbox(zone);
    const L     = len * 0.85;
    const zoneD = Math.abs(bbox.maxY - bbox.minY);
    const D     = Math.min(zoneD * 0.6, L * plu.ces_max / 1.5);

    const cx   = (bbox.minX + bbox.maxX) / 2;
    const yBot = bbox.maxY;
    const yTop = yBot - D;

    const polygon = [
      { x: cx - L/2, y: yTop },
      { x: cx + L/2, y: yTop },
      { x: cx + L/2, y: yBot },
      { x: cx - L/2, y: yBot },
    ];

    const clipped = this._clipSH(polygon, zone);
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
  _ruleEnL(zone, parcelLocal, edgeTypes, plu, ctx) {
    const bbox  = this._bbox(zone);
    const W     = bbox.maxX - bbox.minX;
    const H     = bbox.maxY - bbox.minY;
    const SMax  = Math.min(W * H * plu.ces_max, this._area(zone) * 0.75);

    const L1   = W * 0.75;
    const l1   = SMax / (L1 + W * 0.4);
    const l2   = W * 0.35;
    const H2   = H * 0.65;

    const viewRight = (ctx.viewDir - ctx.voieAzimuth + 360) % 360 > 180;

    const polygon = viewRight ? [
      { x: bbox.minX,       y: bbox.minY         },
      { x: bbox.minX + L1,  y: bbox.minY         },
      { x: bbox.minX + L1,  y: bbox.minY + l1    },
      { x: bbox.maxX,       y: bbox.minY + l1    },
      { x: bbox.maxX,       y: bbox.minY + l1 + H2 },
      { x: bbox.minX,       y: bbox.minY + l1 + H2 },
    ] : [
      { x: bbox.maxX - L1,  y: bbox.minY         },
      { x: bbox.maxX,       y: bbox.minY         },
      { x: bbox.maxX,       y: bbox.minY + l1 + H2 },
      { x: bbox.minX,       y: bbox.minY + l1 + H2 },
      { x: bbox.minX,       y: bbox.minY + l1    },
      { x: bbox.maxX - L1,  y: bbox.minY + l1    },
    ];

    const clipped = this._clipSH(polygon, zone);
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

    // 3. Conformite PLU
    const ces       = parcelArea > 0 ? surf / parcelArea : 0;
    const cesScore  = ces > 0 && ces <= plu.ces_max ? 1 : Math.max(0, 1 - (ces - plu.ces_max) / plu.ces_max);
    const pluScore  = cesScore;

    // 4. Espace jardin restant
    const gardenPct  = parcelArea > 0 ? 1 - surf / parcelArea : 0;
    const gardenScore = Math.max(0, Math.min(1, gardenPct * 1.5));

    // 5. RTAA DOM
    const rtaaZone   = parseInt(session.terrain?.zone_rtaa ?? 1);
    const rtaaThresh = rtaaZone === 1 ? 0.20 : rtaaZone === 2 ? 0.25 : 0.30;
    const rtaaRisk   = surf * 0.30 / (surf + 1);
    const rtaaScore  = 1 - Math.min(1, rtaaRisk / rtaaThresh);

    return {
      orientationScore: orientScore,
      vueScore:         viewScore,
      pluScore,
      gardenScore,
      rtaaScore,
      hauteur_egout:    plu.h_egout,
      niveaux:          plu.niveaux,
      viewType:         ctx.viewDir < 180 ? 'mer' : 'montagne',
      viewDirection:    ctx.viewDir,
    };
  },

  _aggregateScore(sd) {
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
  _setback(parcelLocal, edgeTypes, plu) {
    const reculs = { voie: plu.recul_voie, fond: plu.recul_fond, lateral: plu.recul_lat };
    return this._offsetPolygon(parcelLocal, edgeTypes, reculs);
  },

  // Offset polygon autonome (corrige : CW en espace Y-inverse, normales interieures)
  _offsetPolygon(pts, edgeTypes, reculs) {
    const n = pts.length;
    if (n < 3) return [];

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
      // Normale interieure en espace Y-inverse pour polygon CW : (+dy/len, -dx/len)
      const nx  =  dy / len;
      const ny  = -dx / len;
      const type = et[i] ?? 'lateral';
      const r    = type === 'voie' ? reculs.voie : type === 'fond' ? reculs.fond : reculs.lateral;
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
    return (result.length >= 3 && area >= 1) ? result : [];
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
    const a1 = b.y - a.y, b1 = a.x - b.x, c1 = a1 * a.x + b1 * a.y;
    const a2 = d.y - c.y, b2 = c.x - d.x, c2 = a2 * c.x + b2 * c.y;
    const det = a1 * b2 - a2 * b1;
    if (Math.abs(det) < 1e-10) return { x: (b.x + d.x) / 2, y: (b.y + d.y) / 2 };
    return { x: (c1 * b2 - c2 * b1) / det, y: (a1 * c2 - a2 * c1) / det };
  },

  // Sutherland-Hodgman clipping
  // CORRIGE : force le clip polygon en CCW pour que cross >= 0 = interieur
  _clipSH(subject, clip) {
    // S'assurer que clip est CCW (cross product positif = interieur)
    // En espace Y-inverse, signedArea > 0 = CW visuellement → il faut inverser
    const sa = this._signedAreaSH(clip);
    const ccwClip = sa > 0 ? [...clip].reverse() : clip;

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
};

export default EnvelopeGenerator;
