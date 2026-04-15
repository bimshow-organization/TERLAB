'use strict';
/**
 * TERLAB × BPF — VegetationSpecies service
 * Adapter + suggestSpecies() + checkDistanceFoundation()
 * Port de terlab-vegetation/services/vegetation-species.service.ts
 *
 * Consomme data/bpf-species-reunion.json (33+ espèces). Comme la structure
 * diffère du species-db-terlab.ts du ZIP, ce module normalise les entrées
 * à la volée :
 *   trunkH       → matureHeight_m
 *   canopyRadius → canopyRadius_m
 *   zone[]       → biomes[]  (mappé sur biomes TERLAB)
 *   trunkH       → altitudeRange[] heuristique (hauts / mipentes / littoral)
 *   status       → origin ('endemic' | 'cultivated' | ...)
 *   dérivé       → distanceFoundation_m (rule-based)
 *
 * API :
 *   await VegetationSpecies.load()
 *   VegetationSpecies.normalize(entry, key) → SpeciesDBEntry
 *   VegetationSpecies.suggestSpecies(h, r, alt, biome, n)
 *   VegetationSpecies.checkDistanceFoundation(key, dist)
 *   VegetationSpecies.suggestStyle(sp)
 */

const ZONE_BIOME = {
  littoral: ['tropical-reunion', 'coastal', 'tropical', 'mediterranean'],
  mipentes: ['tropical-reunion', 'tropical', 'subtropical'],
  hauts:    ['tropical-reunion', 'forest', 'boreal', 'subtropical'],
};

const ZONE_ALT = {
  littoral: [0, 400],
  mipentes: [400, 1000],
  hauts:    [800, 2800],
};

const STATUS_ORIGIN = {
  protege:            'endemic',
  invasif:            'invasive',
  invasif_vigilance:  'naturalized',
  ok:                 'cultivated',
};

function _distanceFoundation(entry) {
  if (entry.isPalm) return 2;
  if (entry.growthForm === 'bamboo') return 3;
  const note = (entry.note || '').toLowerCase();
  const m = note.match(/min\s+(\d+(?:\.\d+)?)\s*m/);
  if (m) return parseFloat(m[1]);
  if (entry.growthForm === 'shrub' || entry.growthForm === 'herb' || entry.growthForm === 'grass') return 1;
  const r = entry.canopyRadius || 3;
  return Math.round(Math.max(3, r * 0.8) * 10) / 10;
}

function _category(entry) {
  if (entry.isPalm) return 'palm';
  if (entry.crownShape === 'conical' || entry.crownShape === 'pyramidal') return 'conifer';
  if (entry.growthForm === 'shrub') return 'shrub';
  if (entry.growthForm === 'grass' || entry.growthForm === 'bamboo') return 'grass';
  if (entry.growthForm === 'herb') return 'flower';
  if ((entry.zone || []).includes('littoral')) return 'tropical';
  return 'broadleaf';
}

function _altitudeRange(entry) {
  const zones = entry.zone || ['littoral'];
  let lo = Infinity, hi = -Infinity;
  for (const z of zones) {
    const r = ZONE_ALT[z];
    if (!r) continue;
    if (r[0] < lo) lo = r[0];
    if (r[1] > hi) hi = r[1];
  }
  return isFinite(lo) ? [lo, hi] : [0, 2800];
}

function _biomes(entry) {
  const zones = entry.zone || ['littoral'];
  const out = new Set();
  for (const z of zones) (ZONE_BIOME[z] || []).forEach(b => out.add(b));
  return Array.from(out);
}

function normalize(raw, key) {
  if (!raw) return null;
  return {
    key,
    commonName:        raw.label || key,
    scientificName:    raw.sci || '',
    family:            raw.family || '',
    category:          _category(raw),
    origin:            STATUS_ORIGIN[raw.status] || 'cultivated',
    color2D:           raw.color2D || '#4a7c3f',
    matureHeight_m:    raw.trunkH || 5,
    canopyRadius_m:    raw.canopyRadius || 2,
    distanceFoundation_m: _distanceFoundation(raw),
    altitude:          _altitudeRange(raw),
    biomes:            _biomes(raw),
    isPalm:            !!raw.isPalm,
    crownShape:        raw.crownShape || 'spherical',
    growthForm:        raw.growthForm || 'tree',
    status:            raw.status || 'ok',
    strate:            raw.strate || 'canopee',
    cycloneResist:     raw.cycloneResist || 'moyenne',
    zone:              raw.zone || [],
    note:              raw.note || '',
    raw,
  };
}

let _dbPromise = null;
let _db = null;    // Array normalized
let _byKey = null; // Map key→entry

async function load() {
  if (_db) return _db;
  if (!_dbPromise) {
    _dbPromise = fetch('./data/bpf-species-reunion.json')
      .then(r => r.json())
      .then(json => {
        _db = [];
        _byKey = new Map();
        const species = json.species || {};
        for (const key of Object.keys(species)) {
          const norm = normalize(species[key], key);
          if (norm && norm.canopyRadius_m > 0) {
            _db.push(norm);
            _byKey.set(key, norm);
          }
        }
        return _db;
      });
  }
  return _dbPromise;
}

function get(key) { return _byKey ? _byKey.get(key) || null : null; }

function all() { return _db ? _db.slice() : []; }

function suggestSpecies(hauteurM, canopyRadiusM, altitude, biome, maxCandidates = 3) {
  if (!_db) return [];
  const biomeLc = (biome || '').toLowerCase();
  return _db
    .filter(sp => {
      const [lo, hi] = sp.altitude;
      const altOk = altitude >= lo && altitude <= hi;
      const biomeOk = sp.biomes.some(b => {
        const blc = b.toLowerCase();
        return blc.includes(biomeLc) || biomeLc.includes(blc);
      });
      return altOk && biomeOk && sp.canopyRadius_m > 0;
    })
    .map(sp => {
      const rDelta = Math.abs(sp.canopyRadius_m - canopyRadiusM) / Math.max(sp.canopyRadius_m, 1);
      const hDelta = Math.abs(sp.matureHeight_m - (hauteurM || sp.matureHeight_m)) / Math.max(sp.matureHeight_m, 1);
      const score = Math.max(0, 1 - (rDelta * 0.6 + hDelta * 0.4));
      return {
        speciesKey:          sp.key,
        commonName:          sp.commonName,
        scientificName:      sp.scientificName,
        color2D:             sp.color2D,
        canopyRadius:        sp.canopyRadius_m,
        score:               Math.round(score * 100) / 100,
        distanceFoundation:  sp.distanceFoundation_m,
        isSafe:              true,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCandidates);
}

function checkDistanceFoundation(speciesKey, distanceToFoundation_m) {
  const sp = get(speciesKey);
  if (!sp) return { isSafe: true, required: 0, delta: 0 };
  const required = sp.distanceFoundation_m;
  const delta = distanceToFoundation_m - required;
  return { isSafe: delta >= 0, required, delta: Math.round(delta * 10) / 10 };
}

function suggestStyle(sp) {
  if (window.TopViewSymbols && window.TopViewSymbols.suggestStyle) {
    return window.TopViewSymbols.suggestStyle(sp);
  }
  const cs = (sp.crownShape || 'spherical').toLowerCase();
  const gf = (sp.growthForm || 'tree').toLowerCase();
  const cat = (sp.category || '').toLowerCase();
  if (sp.isPalm || cs === 'palm_crown' || gf === 'palm')
    return { outline: 'contour_smooth', fill: 'fill_radial_fronds' };
  if (cs === 'conical' || cat === 'conifer')
    return { outline: 'contour_smooth', fill: 'fill_radial_needles' };
  return { outline: 'contour_wavy', fill: 'fill_branching' };
}

const VegetationSpecies = {
  load, get, all, normalize,
  suggestSpecies, checkDistanceFoundation, suggestStyle,
};

export default VegetationSpecies;
export { load, get, all, normalize, suggestSpecies, checkDistanceFoundation, suggestStyle };

if (typeof window !== 'undefined') {
  window.VegetationSpecies = VegetationSpecies;
}
