'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   TERLAB · ObiaSegmentation — segmentation par OBJETS de l'ortho IGN
   ───────────────────────────────────────────────────────────────────────────
   POURQUOI CE MODULE EXISTE (en complement, pas en remplacement, de
   services/obia-service.js — qui n'est PAS touche) :

   L'OBIA de TERLAB est per-pixel malgre son nom : chaque pixel de l'ortho est
   classe independamment (cf. classifyPixelReunion dans reunion-constants.js).
   Sur une ortho reelle — bruit JPEG, ombres portees de canopee, variation
   d'exposition entre dalles — une decision par pixel produit des milliers de
   CONFETTIS : des taches d'un ou deux pixels qui ne designent aucun objet du
   terrain. C'est parfait pour un pourcentage d'occupation du sol (ce que fait
   obia-service, et il le fait bien), c'est inexploitable des qu'on veut des
   ZONES : une masse boisee, une planche de canne, une aire minerale.

   Le point dur n'est donc pas la classification, c'est la SEGMENTATION. C'est
   exactement le diagnostic ecrit en tete de utils/image-to-garden.js, dont on
   reutilise ici la chaine complete :

       ortho IGN → SLIC (superpixels qui suivent les contours)
                 → k-means Lab sur les MOYENNES de superpixels
                 → vote de voisinage
                 → morphologie (ouverture + fermeture)
                 → composantes connexes + aire minimale
                 → contours → Douglas-Peucker → Chaikin
                 → SVG data-biome  → [ici] → polygones WGS84 → Mapbox

   SLIC decide par REGION coherente au lieu de decider pixel par pixel : les
   frontieres tombent la ou l'image en a une. Morphologie + composantes +
   aire minimale ne sont pas du confort, ce sont elles qui font tenir le
   resultat. D'ou des zones lisibles la ou l'OBIA per-pixel donne du poivre.

   Statut : CALQUE DE LECTURE. Aucune donnee de session n'est ecrite, aucune
   saisie utilisateur n'est ecrasee (convention AUTO de TERLAB).

   @coords  Image 1024x1024 (origine haut-gauche, y vers le BAS)
            → SVG boite 110 de image-to-garden (meme sens, y vers le bas)
            → WGS84. UN SEUL y-flip, applique dans _svgToZones :
              lat = maxLat - v * (maxLat - minLat).
            Aucun autre flip en aval (Mapbox consomme du [lng,lat] direct).
   ═══════════════════════════════════════════════════════════════════════════ */

import { ImageToGarden } from '../utils/image-to-garden.js';

const IGN_WMS         = 'https://data.geopf.fr/wms-r/wms';
const IGN_ORTHO_LAYER = 'HR.ORTHOIMAGERY.ORTHOPHOTOS';

const SOURCE_ID  = 'obia-segmentation';
const LAYER_FILL = 'obia-segmentation-fill';
const LAYER_LINE = 'obia-segmentation-outline';

/* ── Palette des biomes reunionnais ────────────────────────────────────────
   Ces hex ne sont PAS des couleurs de rendu choisies pour l'oeil : ce sont
   les couleurs sous lesquelles chaque milieu se lit REELLEMENT sur une ortho
   IGN de La Reunion. image-to-garden apparie les masses chromatiques de
   l'image a cette palette par distance perceptuelle en Lab — un hex faux ici
   deplace la classification entiere. Calage sur les plages HSV de
   classifyPixelReunion (services/reunion-constants.js L.260+), converties en
   representant median de chaque plage.

   `water: true` sur l'eau : image-to-garden refuse alors d'en faire le fond
   (garde-fou documente dans son pipeline — un plan d'eau dominant noyait tout
   le terrain). Ici l'effet utile est le meme : sur une parcelle cotiere le
   lagon ne doit pas devenir le sol de reference. */
export const BIOMES_REUNION = [
  { id: 'canopee',  label: 'Canopee dense',        hex: '#2f3f26' }, // vert sombre, ombre de couvert
  { id: 'boise',    label: 'Boise / arbustif',     hex: '#55763a' }, // vegetation secondaire, arbres isoles
  { id: 'canne',    label: 'Canne a sucre',        hex: '#86a84a' }, // vert vif sature, monoculture
  { id: 'herbace',  label: 'Herbace / savane',     hex: '#b3b169' }, // jaune-vert clair, herbe seche
  { id: 'sol_nu',   label: 'Sol nu / terre',       hex: '#9d7b57' }, // brun ocre, basalte altere
  { id: 'mineral',  label: 'Mineral / voirie',     hex: '#a6a29b' }, // enrobe, dalle, gris neutre
  { id: 'bati',     label: 'Bati / toiture',       hex: '#8c5442' }, // tuile, tole peinte, terrasse
  { id: 'eau',      label: 'Eau',                  hex: '#3b6a8c', water: true },
];

const BIOME_BY_ID = new Map(BIOMES_REUNION.map(b => [b.id, b]));

/* Reglages du pipeline. `grid` est la resolution d'ANALYSE (cellules par
   cote), independante des 1024 px telecharges : au-dela de ~160 le cout SLIC
   grimpe sans gain visible, en dessous de ~120 les masses fines fondent. */
const DEFAULT_OPTS = {
  imgSize:     1024,
  timeoutMs:   12000,
  grid:        160,
  superpixels: 1200,
  k:           8,      // = taille de la palette
  minAreaPct:  0.004,  // ~0.4 % de la vignette : sous ce seuil, c'est du bruit
  epsilon:     2.0,
  smooth:      2,
  maxShapes:   60,
};

const M_PER_DEG = 111320;

const ObiaSegmentation = {

  BIOMES: BIOMES_REUNION,

  /**
   * Segmente l'ortho de la parcelle en masses de biomes.
   * @param {{bbox:number[], centroid:number[], map?:object}} args
   *        bbox = [minLng, minLat, maxLng, maxLat]
   *        centroid = [lng, lat]
   * @returns {Promise<{zones:Array, stats:object, svg:string}>}
   */
  async segmentParcel({ bbox, centroid, map } = {}, config = {}) {
    const opts = Object.assign({}, DEFAULT_OPTS, config);

    // Repli sur l'emprise visible si l'appelant n'a pas de bbox propre.
    if ((!bbox || bbox.length !== 4) && map?.getBounds) {
      const b = map.getBounds();
      bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    }
    if (!bbox || bbox.length !== 4 || bbox.some(v => !Number.isFinite(v))) {
      throw new Error('Segmentation biomes : emprise (bbox) invalide.');
    }
    if (!centroid || centroid.length < 2) {
      centroid = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
    }

    const IG = ImageToGarden || (typeof window !== 'undefined' ? window.ImageToGarden : null);
    if (!IG?.fromImage) {
      throw new Error('Segmentation biomes : module image-to-garden indisponible.');
    }

    /* L'analyse travaille sur une vignette CARREE (image-to-garden recadre au
       carre couvrant). Si on lui donnait une bbox rectangulaire etiree sur
       1024x1024, les pixels ne seraient plus carres au sol et toutes les
       surfaces seraient fausses. On carre donc l'emprise EN METRES avant la
       requete WMS, en couvrant la bbox demandee. */
    const sq = this._squareBbox(bbox, centroid[1]);

    const img = await this._fetchOrtho(sq.bbox, opts.imgSize, opts.timeoutMs);

    IG.setPalette(BIOMES_REUNION);
    let out;
    try {
      out = IG.fromImage(img, {
        grid: opts.grid, superpixels: opts.superpixels, k: opts.k,
        minAreaPct: opts.minAreaPct, epsilon: opts.epsilon,
        smooth: opts.smooth, maxShapes: opts.maxShapes,
      });
    } catch (e) {
      // Cause la plus frequente : canvas taint (CORS refuse par le proxy).
      throw new Error('Segmentation biomes : analyse impossible (' + (e?.message || e) + ').');
    }

    const zones = this._svgToZones(out.svg, sq.bbox, centroid[1]);
    const stats = this._buildStats(zones, out.report, sq);

    console.info(`[ObiaSeg] ${zones.length} zones · ${sq.side_m.toFixed(0)} m de cote · `
      + `${(sq.side_m / opts.imgSize).toFixed(2)} m/px · fond = ${stats.fond?.label || '—'}`);

    return { zones, stats, svg: out.svg };
  },

  /* ── 1 · Emprise carree en metres ─────────────────────────────────────── */
  _squareBbox(bbox, refLat) {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const cLng = (minLng + maxLng) / 2;
    const cLat = (minLat + maxLat) / 2;
    const lngM = M_PER_DEG * Math.cos((refLat ?? cLat) * Math.PI / 180) || 1;
    const wM = Math.abs(maxLng - minLng) * lngM;
    const hM = Math.abs(maxLat - minLat) * M_PER_DEG;
    const side = Math.max(wM, hM) || 100;          // carre COUVRANT
    const halfLng = (side / 2) / lngM;
    const halfLat = (side / 2) / M_PER_DEG;
    return {
      bbox: [cLng - halfLng, cLat - halfLat, cLng + halfLng, cLat + halfLat],
      side_m: side,
      lngM,
    };
  },

  /* ── 2 · Ortho IGN ─────────────────────────────────────────────────────
     Volontairement le WMS, PAS le canvas Mapbox : lire le canvas imposerait
     preserveDrawingBuffer:true a toute l'application (cout GPU permanent) et
     rendrait la segmentation dependante du fond de carte affiche.
     WMS 1.3.0 + EPSG:4326 ⇒ BBOX en lat,lng (meme convention que
     parking-detection.js et vegetation-detection.js). */
  _fetchOrtho(bbox, size, timeoutMs) {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const url = `${IGN_WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap`
      + `&LAYERS=${IGN_ORTHO_LAYER}&CRS=EPSG:4326`
      + `&BBOX=${minLat},${minLng},${maxLat},${maxLng}`
      + `&WIDTH=${size}&HEIGHT=${size}&FORMAT=image/jpeg&STYLES=`;

    // Geste utilisateur explicite : UNE seule tentative, pas de boucle retry.
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        img.src = '';                                 // annule le chargement
        reject(new Error(`Ortho IGN : delai depasse (${Math.round(timeoutMs / 1000)} s).`));
      }, timeoutMs);
      img.onload = () => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (!img.naturalWidth) { reject(new Error('Ortho IGN : image vide.')); return; }
        resolve(img);
      };
      img.onerror = () => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        reject(new Error('Ortho IGN : image non chargee (reseau ou CORS).'));
      };
      img.src = url;
    });
  },

  /* ── 3 · SVG data-biome → polygones WGS84 ──────────────────────────────
     image-to-garden emet un SVG en boite 110 : un <rect> de fond (la masse
     dominante, qui couvre toute la vignette) puis les <path> des masses. On
     ne convertit QUE les path : un fond plein-cadre pose sur la carte
     masquerait la parcelle sans rien apprendre. Le fond part dans stats. */
  _svgToZones(svg, bbox, refLat) {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName === 'parsererror') {
      throw new Error('Segmentation biomes : sortie SVG illisible.');
    }
    const vb = (root.getAttribute('viewBox') || '0 0 110 110').trim().split(/\s+/).map(Number);
    const boxW = vb[2] || 110, boxH = vb[3] || 110;

    const [minLng, minLat, maxLng, maxLat] = bbox;
    const dLng = maxLng - minLng, dLat = maxLat - minLat;

    const zones = [];
    doc.querySelectorAll('path[data-biome]').forEach((el, i) => {
      const pts = this._parsePathPoints(el.getAttribute('d') || '');
      if (pts.length < 3) return;
      const polygon = pts.map(([x, y]) => [
        minLng + (x / boxW) * dLng,
        maxLat - (y / boxH) * dLat,     // <- unique y-flip (image y vers le bas)
      ]);
      const biomeId = el.getAttribute('data-biome');
      const def = BIOME_BY_ID.get(biomeId);
      zones.push({
        id: `${biomeId}-${i}`,
        biomeId,
        label: def?.label || biomeId,
        color: def?.hex || '#888888',
        tint: el.getAttribute('data-tint') || null,   // couleur moyenne reelle de la masse
        polygon,
        areaM2: Math.round(this._areaM2(polygon, refLat)),
      });
    });
    zones.sort((a, b) => b.areaM2 - a.areaM2);
    return zones;
  },

  // Les `d` produits par image-to-garden n'utilisent que M / L / Z : un simple
  // balayage des nombres suffit et evite d'embarquer un parseur de chemin.
  _parsePathPoints(d) {
    const nums = d.match(/-?\d+(?:\.\d+)?/g);
    if (!nums) return [];
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      pts.push([parseFloat(nums[i]), parseFloat(nums[i + 1])]);
    }
    return pts;
  },

  // Shoelace en metres locaux (equirectangulaire au centroide : l'emprise fait
  // quelques centaines de metres, la deformation est negligeable).
  _areaM2(ring, refLat) {
    const kx = M_PER_DEG * Math.cos((refLat || 0) * Math.PI / 180);
    const ky = M_PER_DEG;
    let s = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      s += (ring[j][0] * kx) * (ring[i][1] * ky) - (ring[i][0] * kx) * (ring[j][1] * ky);
    }
    return Math.abs(s / 2);
  },

  /* ── 4 · Statistiques ──────────────────────────────────────────────────
     `report.masses` d'image-to-garden donne le POURCENTAGE de vignette par
     masse chromatique (fond compris) ; les zones donnent les surfaces
     polygonales (fond exclu). Les deux se lisent ensemble : le fond n'a pas
     de polygone mais reste le milieu dominant du site. */
  _buildStats(zones, report, sq) {
    const byBiome = new Map();
    for (const z of zones) {
      const acc = byBiome.get(z.biomeId) || { biomeId: z.biomeId, label: z.label, color: z.color, areaM2: 0, count: 0 };
      acc.areaM2 += z.areaM2; acc.count++;
      byBiome.set(z.biomeId, acc);
    }
    const list = [...byBiome.values()].sort((a, b) => b.areaM2 - a.areaM2);

    const fondDef = report?.fond ? BIOME_BY_ID.get(report.fond) : null;
    const fondPct = report?.masses?.find(m => m.biome === report?.fond)?.pct ?? null;

    return {
      zones: zones.length,
      totalAreaM2: list.reduce((s, b) => s + b.areaM2, 0),
      byBiome: list,
      dominant: list[0] || null,
      fond: fondDef ? { biomeId: fondDef.id, label: fondDef.label, color: fondDef.hex, pct: fondPct } : null,
      masses: report?.masses || [],
      emprise_m: Math.round(sq.side_m),
      resolution_m_px: +(sq.side_m / DEFAULT_OPTS.imgSize).toFixed(2),
      formesEcartees: report?.formesEcartees ?? 0,
    };
  },

  /* ── 5 · Rendu Mapbox ──────────────────────────────────────────────────
     Idempotent : setData si la source existe, addLayer seulement si absent.
     Couleur portee par la feature (`['get','color']`) : une seule paire de
     couches suffit pour les 8 biomes. */
  renderOnMap(map, zones) {
    if (!map || !Array.isArray(zones)) return;

    const fc = {
      type: 'FeatureCollection',
      features: zones.map((z, i) => ({
        type: 'Feature',
        id: i,
        geometry: { type: 'Polygon', coordinates: [[...z.polygon, z.polygon[0]]] },
        properties: {
          biomeId: z.biomeId, label: z.label,
          color: z.color, tint: z.tint || z.color, areaM2: z.areaM2,
        },
      })),
    };

    const src = map.getSource(SOURCE_ID);
    if (src) src.setData(fc);
    else map.addSource(SOURCE_ID, { type: 'geojson', data: fc });

    if (!map.getLayer(LAYER_FILL)) {
      map.addLayer({
        id: LAYER_FILL, type: 'fill', source: SOURCE_ID,
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.42 },
      });
    }
    if (!map.getLayer(LAYER_LINE)) {
      map.addLayer({
        id: LAYER_LINE, type: 'line', source: SOURCE_ID,
        paint: { 'line-color': ['get', 'color'], 'line-width': 1.2, 'line-opacity': 0.9 },
      });
    }
  },

  clearFromMap(map) {
    if (!map?.getLayer) return;
    [LAYER_LINE, LAYER_FILL].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  },
};

if (typeof window !== 'undefined') window.ObiaSegmentation = ObiaSegmentation;
export default ObiaSegmentation;
