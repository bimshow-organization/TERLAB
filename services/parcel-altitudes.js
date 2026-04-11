// ═══════════════════════════════════════════════════════════════════════
// TERLAB · services/parcel-altitudes.js
// Échantillonnage BIL groupé pour étiqueter NGR aux sommets parcelle
// Une seule requête WMS-R pour N points → conversion bilinéaire en local.
// ═══════════════════════════════════════════════════════════════════════

const ParcelAltitudes = {

  _cache: new Map(),

  // ── Sélectionne les points "clés" à étiqueter ──────────────────────
  // Sommets de la parcelle + milieux des arêtes longues (selon longEdgeM).
  // parcelGeo : [[lng,lat], ...]   (sans point de fermeture)
  // Retourne  : [{ kind:'corner'|'mid', coord:[lng,lat], edge:i }]
  // Cap dur : maxPoints (defaut 12) — sur les parcelles cadastre densifiees
  // (bords courbes), on peut avoir 70+ vertices ; on echantillonne alors
  // un sous-ensemble bien reparti le long du perimetre.
  selectKeyPoints(parcelGeo, opts = {}) {
    if (!parcelGeo || parcelGeo.length < 3) return [];
    const longEdgeM = opts.longEdgeM ?? 30;
    const maxPoints = opts.maxPoints ?? 12;
    const out = [];
    const n = parcelGeo.length;
    const lat0 = parcelGeo[0][1];
    const LNG_M = 111320 * Math.cos(lat0 * Math.PI / 180);
    const LAT_M = 111320;
    for (let i = 0; i < n; i++) {
      out.push({ kind: 'corner', coord: parcelGeo[i], edge: i });
      const j = (i + 1) % n;
      const dx = (parcelGeo[j][0] - parcelGeo[i][0]) * LNG_M;
      const dy = (parcelGeo[j][1] - parcelGeo[i][1]) * LAT_M;
      const len = Math.hypot(dx, dy);
      if (len > longEdgeM) {
        const nMid = Math.min(3, Math.floor(len / longEdgeM));
        for (let k = 1; k <= nMid; k++) {
          const t = k / (nMid + 1);
          out.push({
            kind: 'mid',
            coord: [
              parcelGeo[i][0] + (parcelGeo[j][0] - parcelGeo[i][0]) * t,
              parcelGeo[i][1] + (parcelGeo[j][1] - parcelGeo[i][1]) * t,
            ],
            edge: i,
          });
        }
      }
    }
    if (out.length <= maxPoints) return out;

    // Decimation par stride sur l'ordre de perimetre. La sequence `out`
    // suit deja l'ordre du polygone (corner i, puis ses mids, puis corner i+1).
    // Stride = total/max → pioche maxPoints indices repartis uniformement.
    const step = out.length / maxPoints;
    const decimated = [];
    for (let k = 0; k < maxPoints; k++) {
      const idx = Math.floor(k * step);
      decimated.push(out[idx]);
    }
    return decimated;
  },

  // ── Échantillonne en une seule requête BIL ─────────────────────────
  // points : [[lng,lat], ...]
  // Retourne { points:[{lng,lat,alt}], minAlt, maxAlt, range }
  async sample(points, opts = {}) {
    if (!points?.length) return { points: [], minAlt: null, maxAlt: null, range: 0 };

    const BIL = window.BILTerrain;
    if (!BIL) {
      return {
        points: points.map(([lng, lat]) => ({ lng, lat, alt: null })),
        minAlt: null, maxAlt: null, range: 0,
      };
    }

    const key = points.map(([a, b]) => `${a.toFixed(6)},${b.toFixed(6)}`).join('|');
    if (this._cache.has(key)) return this._cache.get(key);

    await BIL._ensureProj4();

    // Bbox UTM avec padding
    const padM = opts.padM ?? 6;
    const utmPts = points.map(([lng, lat]) => proj4('EPSG:4326', 'EPSG:2975', [lng, lat]));
    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
    for (const [e, n] of utmPts) {
      if (e < minE) minE = e; if (e > maxE) maxE = e;
      if (n < minN) minN = n; if (n > maxN) maxN = n;
    }
    minE -= padM; maxE += padM; minN -= padM; maxN += padM;

    // Pas adaptatif : limite à 200×200 pixels max
    const span = Math.max(maxE - minE, maxN - minN);
    const px = Math.max(opts.pixelSizeM ?? 1.0, Math.ceil(span / 200));
    const minX = BIL._snap(minE, px);
    const minY = BIL._snap(minN, px);
    const W = Math.max(4, Math.ceil((maxE - minX) / px));
    const H = Math.max(4, Math.ceil((maxN - minY) / px));
    const bbox = [minX, minY, minX + W * px, minY + H * px];

    let heights;
    try {
      const url = BIL._buildUrl(bbox, W, H);
      const buf = await (await fetch(url)).arrayBuffer();
      heights = BIL._parseBIL(buf);
    } catch (e) {
      console.warn('[ParcelAltitudes] BIL fetch failed:', e.message);
      const result = {
        points: points.map(([lng, lat]) => ({ lng, lat, alt: null })),
        minAlt: null, maxAlt: null, range: 0,
      };
      this._cache.set(key, result);
      return result;
    }

    let minAlt = Infinity, maxAlt = -Infinity;
    const out = points.map(([lng, lat], i) => {
      const [e, n] = utmPts[i];
      const fx = (e - minX) / px;
      const fy = (minY + H * px - n) / px;
      const alt = BIL._bilinear(heights, W, H, fx, fy);
      if (alt > -500 && alt < 5000 && isFinite(alt)) {
        if (alt < minAlt) minAlt = alt;
        if (alt > maxAlt) maxAlt = alt;
        return { lng, lat, alt };
      }
      return { lng, lat, alt: null };
    });

    const result = {
      points: out,
      minAlt: minAlt === Infinity ? null : minAlt,
      maxAlt: maxAlt === -Infinity ? null : maxAlt,
      range: (minAlt === Infinity || maxAlt === -Infinity) ? 0 : (maxAlt - minAlt),
    };
    this._cache.set(key, result);
    return result;
  },

  // ── Helper combiné : sélection + échantillonnage ───────────────────
  // Retourne [{ kind, coord:[lng,lat], alt }] pour usage direct dans renderers.
  async sampleParcelKeyPoints(parcelGeo, opts = {}) {
    const keyPts = this.selectKeyPoints(parcelGeo, opts);
    if (!keyPts.length) return { points: [], minAlt: null, maxAlt: null, range: 0 };
    const sampled = await this.sample(keyPts.map(p => p.coord), opts);
    return {
      points: keyPts.map((kp, i) => ({ ...kp, alt: sampled.points[i]?.alt ?? null })),
      minAlt: sampled.minAlt, maxAlt: sampled.maxAlt, range: sampled.range,
    };
  },
};

if (typeof window !== 'undefined') {
  window.ParcelAltitudes = ParcelAltitudes;
}

export default ParcelAltitudes;
