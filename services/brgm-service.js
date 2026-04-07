// TERLAB · services/brgm-service.js
// Carte géologique BRGM Réunion — 3 niveaux d'analyse :
//   1. Pixel sampling WebGL sur la couche raster BRGM (rapide, offline)
//   2. WMS GetFeatureInfo geoservices.brgm.fr (réseau)
//   3. Fallback inférence par altitude + zone géographique
// ════════════════════════════════════════════════════════════════════

const BRGMService = {

  // ─── Correspondance couleurs BRGM Réunion 1:50 000 → formations ─
  // Couleurs calibrées sur la carte géologique BRGM Réunion
  // Même approche que GIEP : sampling pixel → nearest color → formation
  GEOLOGICAL_COLOR_MAP: {
    '#F5E6D3': { type: 'sable_plage',          label: 'Sables et galets de plage',              permeability: 'très_forte', resistance: 'faible',      geotech: 'G1 OBLIGATOIRE — tassements' },
    '#D2B48C': { type: 'alluvions',             label: 'Alluvions de rivières',                  permeability: 'forte',      resistance: 'faible',      geotech: 'G1 OBLIGATOIRE' },
    '#CD853F': { type: 'eboulis',               label: 'Éboulis de pente, colluvions',           permeability: 'forte',      resistance: 'faible',      geotech: 'G1 OBLIGATOIRE — instabilité' },
    '#FF0000': { type: 'coulees_xxe',           label: 'Coulées du XXe siècle',                  permeability: 'extrême',    resistance: 'excellente',  geotech: 'Superficielle', age: '1900-2000' },
    '#DC143C': { type: 'coulees_historiques',   label: 'Coulées XVII-XIXe siècles',              permeability: 'très_forte', resistance: 'excellente',  geotech: 'Superficielle', age: '1600-1900' },
    '#FF6347': { type: 'coulees_2300',          label: 'Coulées historiques (0-2300 ans)',        permeability: 'très_forte', resistance: 'très bonne',  geotech: 'Superficielle possible', age: '0-2300 ans' },
    '#FFD700': { type: 'fournaise_37ka',        label: 'Coulées 2300-37000 ans',                 permeability: 'forte',      resistance: 'très bonne',  geotech: 'Superficielle possible', age: '2.3-37 ka' },
    '#FFFF00': { type: 'fournaise_170ka',       label: 'Coulées 37000-170000 ans',               permeability: 'forte',      resistance: 'bonne',       geotech: 'G1 recommandée', age: '37-170 ka' },
    '#F0E68C': { type: 'fournaise_350ka',       label: 'Coulées 170000-350000 ans',              permeability: 'moyenne',    resistance: 'bonne',       geotech: 'G1 recommandée si altéré', age: '170-350 ka' },
    '#32CD32': { type: 'plaine_cafres',         label: 'Axe volcanique Plaine des Cafres',       permeability: 'forte',      resistance: 'bonne',       geotech: 'G1 recommandée', age: '50-350 ka' },
    '#006400': { type: 'neiges_primitif',       label: 'Basaltes alcalins peu évolués',          permeability: 'forte',      resistance: 'bonne',       geotech: 'G1 recommandée', age: '350-2000 ka' },
    '#228B22': { type: 'neiges_alcalins',       label: 'Basaltes alcalins et transitionnels',    permeability: 'moyenne',    resistance: 'bonne',       geotech: 'G1 recommandée — argilisation possible', age: '120-700 ka' },
    '#7CFC00': { type: 'neiges_differencie',    label: 'Basaltes différenciés',                  permeability: 'moyenne',    resistance: 'bonne',       geotech: 'G1 recommandée', age: '70-500 ka' },
    '#2F4F4F': { type: 'intrusions',            label: 'Intrusions (gabbros, syénites)',         permeability: 'faible',     resistance: 'excellente',  geotech: 'Fondations superficielles', age: '70-300 ka' },
    '#696969': { type: 'breches_explosion',     label: 'Brèches d\'explosion',                  permeability: 'moyenne',    resistance: 'variable',    geotech: 'G1 recommandée' },
    '#87CEEB': { type: 'formations_marines',    label: 'Formations marines',                     permeability: 'variable',   resistance: 'faible',      geotech: 'G1 OBLIGATOIRE' },
    '#8B4513': { type: 'remblai',               label: 'Remblai anthropique',                    permeability: 'variable',   resistance: 'très faible', geotech: 'G1 OBLIGATOIRE — tassements' }
  },

  // ─── Codes lithologiques BRGM (pour WMS GetFeatureInfo) ─────────
  LITHO_MAP: {
    'f1-2Bf':  { label: 'Basaltes hawaiites anciens', type: 'neiges_alcalins',  age: '> 500 000 ans', resistance: 'bonne', geotech: 'G1 recommandée si altéré' },
    'f1-2Bb':  { label: 'Basaltes trachybasaltes',    type: 'neiges_alcalins',  age: '> 500 000 ans', resistance: 'bonne', geotech: 'G1 recommandée' },
    'f2Bb':    { label: 'Coulées récentes Piton Neiges', type: 'neiges_differencie', age: '100–500 000 ans', resistance: 'très bonne', geotech: 'Superficielle possible' },
    'f3Ba':    { label: 'Coulées Piton Fournaise récentes', type: 'coulees_2300',  age: '< 5 000 ans', resistance: 'excellente', geotech: 'Superficielle' },
    'f3Bb':    { label: 'Coulées Fournaise historiques',    type: 'coulees_historiques', age: '5 000–100 000 ans', resistance: 'très bonne', geotech: 'Superficielle' },
    'Fz':      { label: 'Alluvions récentes (fond de ravine)', type: 'alluvions', age: 'Holocène', resistance: 'faible', geotech: 'G1 OBLIGATOIRE' },
    'CFz':     { label: 'Colluvions de versant',       type: 'eboulis',   age: 'Holocène', resistance: 'faible', geotech: 'G1 OBLIGATOIRE' },
    'X':       { label: 'Remblai anthropique',          type: 'remblai',   age: 'Recent',   resistance: 'très faible', geotech: 'G1 OBLIGATOIRE — tassements' },
  },

  // ─── Référence Mapbox map (injectée par MapViewer) ──────────────
  _map: null,
  setMap(map) { this._map = map; },

  // ═══════════════════════════════════════════════════════════════
  // NIVEAU 1 — Pixel sampling WebGL (rapide, pas de réseau)
  // ═══════════════════════════════════════════════════════════════

  samplePixelAt(lng, lat) {
    const m = this._map;
    if (!m || !m.loaded()) return null;

    try {
      const point = m.project([lng, lat]);
      const gl = m.getCanvas().getContext('webgl2') || m.getCanvas().getContext('webgl');
      if (!gl) return null;

      const pixels = new Uint8Array(4);
      const canvasHeight = m.getCanvas().height;
      const x = Math.floor(point.x * (window.devicePixelRatio || 1));
      const y = Math.floor((canvasHeight - point.y * (window.devicePixelRatio || 1)));

      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      if (pixels[3] < 128) return null; // transparent → pas de donnée
      return { r: pixels[0], g: pixels[1], b: pixels[2], a: pixels[3] };
    } catch (e) {
      console.warn('[BRGM] Pixel sampling error:', e.message);
      return null;
    }
  },

  findClosestGeologicalMatch(color) {
    if (!color) return null;

    let minDistance = Infinity;
    let bestMatch  = null;

    for (const [hex, formation] of Object.entries(this.GEOLOGICAL_COLOR_MAP)) {
      const t = this._hexToRgb(hex);
      const d = Math.sqrt(
        (color.r - t.r) ** 2 +
        (color.g - t.g) ** 2 +
        (color.b - t.b) ** 2
      );
      if (d < minDistance) {
        minDistance = d;
        bestMatch  = { hex, ...formation, distance: Math.round(d) };
      }
    }

    // Confiance basée sur la distance couleur
    if (bestMatch) {
      bestMatch.confidence =
        minDistance < 30  ? 'très_haute' :
        minDistance < 60  ? 'haute'      :
        minDistance < 90  ? 'moyenne'    :
        minDistance < 150 ? 'faible'     : 'très_faible';
    }

    return bestMatch;
  },

  // ═══════════════════════════════════════════════════════════════
  // NIVEAU 2 — WMS GetFeatureInfo (réseau)
  // ═══════════════════════════════════════════════════════════════

  async queryWMS(lat, lng) {
    const d    = 0.002;
    const bbox = `${lng-d},${lat-d},${lng+d},${lat+d}`;
    const url  = `https://geoservices.brgm.fr/geologie?`
      + `SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo`
      + `&LAYERS=GEOL_REU_50K&QUERY_LAYERS=GEOL_REU_50K`
      + `&INFO_FORMAT=application/json`
      + `&SRS=EPSG:4326&I=128&J=128&WIDTH=256&HEIGHT=256`
      + `&BBOX=${bbox}`;

    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`WMS ${resp.status}`);
    const data = await resp.json();

    if (data.features?.length) {
      const feat  = data.features[0];
      const code  = feat.properties?.CODE_LITHO ?? feat.properties?.CODE ?? '';
      const litho = this.LITHO_MAP[code];
      return {
        source:     'wms_brgm',
        code,
        label:      litho?.label ?? feat.properties?.LABEL ?? `Code ${code}`,
        type:       litho?.type ?? this._inferType(code),
        age:        litho?.age ?? '—',
        resistance: litho?.resistance ?? '—',
        geotech:    litho?.geotech ?? 'Étude recommandée',
        raw:        feat.properties
      };
    }
    throw new Error('Aucun feature retourné');
  },

  // ═══════════════════════════════════════════════════════════════
  // NIVEAU 3 — Fallback altitude + zone géographique
  // ═══════════════════════════════════════════════════════════════

  _fallbackByAltitude(lat, lng, altNgr) {
    const alt = altNgr ?? window.SessionManager?.getTerrain?.()?.altitude_ngr ?? 0;
    const a   = parseFloat(alt);

    const estCoast = lng > 55.7 && lat > -21.1;
    const portZone = lng < 55.35 && lat > -21.0;
    const fournaise = lng > 55.65 && lat < -21.2;

    if (portZone)  return this._buildFallback('remblai',        'Zone portuaire — remblai probable', 'G1 OBLIGATOIRE', a);
    if (fournaise) return this._buildFallback('coulees_2300',   'Coulées Piton de la Fournaise récentes', 'Superficielle possible', a);
    if (a < 100)   return this._buildFallback('coulees_2300',   'Basalte côtier récent (probable)', 'Très bonne — vérifier', a);
    if (a < 400)   return this._buildFallback('fournaise_37ka', 'Coulées récentes mi-pentes', 'Bonne', a);
    if (a < 800)   return this._buildFallback('neiges_alcalins','Basalte ancien altéré probable', 'Bonne — argilisation possible', a);
    if (a < 1400)  return this._buildFallback('neiges_alcalins','Trachybasaltes hauts (probable)', 'Bonne', a);
    return         this._buildFallback('neiges_differencie',    'Zone sommitale Piton des Neiges', 'Très bonne', a);
  },

  _buildFallback(type, label, geotech, alt) {
    return {
      source:  'fallback_altitude',
      code:    null,
      label,
      type,
      age:     '—',
      resistance: '—',
      geotech,
      note:    `Données inférées depuis altitude ${alt}m — consulter InfoTerre BRGM 1:50 000`
    };
  },

  // ═══════════════════════════════════════════════════════════════
  // QUERY PRINCIPAL — cascade pixel → WMS → altitude
  // ═══════════════════════════════════════════════════════════════

  async query(lat, lng) {
    // Hors limites Réunion ?
    if (lng < 55.2 || lng > 55.85 || lat < -21.42 || lat > -20.85) {
      return { source: 'hors_limites', label: 'Point hors limites La Réunion', type: 'indetermine', geotech: '—' };
    }

    // NIVEAU 1 — pixel sampling (instantané)
    const pixel = this.samplePixelAt(lng, lat);
    if (pixel) {
      const match = this.findClosestGeologicalMatch(pixel);
      if (match && (match.confidence === 'très_haute' || match.confidence === 'haute')) {
        return {
          source:     'pixel_sampling',
          code:       null,
          label:      match.label,
          type:       match.type,
          age:        match.age ?? '—',
          resistance: match.resistance,
          geotech:    match.geotech,
          permeability: match.permeability,
          confidence: match.confidence,
          pixelColor: match.hex,
          distance:   match.distance
        };
      }
    }

    // NIVEAU 2 — WMS GetFeatureInfo
    try {
      return await this.queryWMS(lat, lng);
    } catch (e) {
      console.warn('[BRGM] WMS failed, fallback altitude:', e.message);
    }

    // NIVEAU 3 — inférence altitude
    return this._fallbackByAltitude(lat, lng);
  },

  // ─── Utilitaires ──────────────────────────────────────────────

  _hexToRgb(hex) {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return r ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) } : { r: 0, g: 0, b: 0 };
  },

  _inferType(code) {
    if (!code) return 'indetermine';
    if (code.startsWith('f3')) return 'coulees_2300';
    if (code.startsWith('f2')) return 'neiges_differencie';
    if (code.startsWith('f1')) return 'neiges_alcalins';
    if (code.startsWith('F'))  return 'alluvions';
    if (code === 'X')          return 'remblai';
    return 'indetermine';
  },

  // ─── Conseils géotechniques depuis le type ─────────────────────
  getGeoAdvice(type) {
    const advice = {
      coulees_xxe:          'Lave très récente — excellente portance. Vérifier l\'absence de tunnels de lave.',
      coulees_historiques:   'Basalte récent — excellente portance. Fondations superficielles.',
      coulees_2300:          'Basalte récent — très bonne portance. Fondations superficielles possibles.',
      fournaise_37ka:        'Basalte intermédiaire — très bonne portance. Vérifier poches de scories.',
      fournaise_170ka:       'Basalte altéré — bonne portance. G1 recommandée.',
      fournaise_350ka:       'Basalte ancien — bonne portance. Argilisation possible. G1 recommandée.',
      plaine_cafres:         'Axe volcanique — bonne portance. G1 recommandée.',
      neiges_primitif:       'Basalte ancien — bonne portance. Altération profonde possible. G1 recommandée.',
      neiges_alcalins:       'Basalte altéré — argilisation possible en profondeur. G1 recommandée en zone PPRN.',
      neiges_differencie:    'Basalte différencié — bonne portance. G1 recommandée.',
      intrusions:            'Roche plutonique — excellente portance. Fondations superficielles.',
      breches_explosion:     'Brèches — résistance variable. G1 recommandée.',
      sable_plage:           'Sables littoraux — compressibles. G1 OBLIGATOIRE.',
      alluvions:             'Alluvions — compressibles et saturées. Tassements différentiels probables. G1 OBLIGATOIRE.',
      eboulis:               'Éboulis/colluvions — instables. G1 OBLIGATOIRE. Risque mouvement de terrain.',
      formations_marines:    'Formations marines — G1 OBLIGATOIRE.',
      remblai:               'Remblai anthropique — tassements différentiels. G1 OBLIGATOIRE. Sondages pour épaisseur.',
      indetermine:           'Nature indéterminée — G1 recommandée pour sécuriser le projet.',
    };
    return advice[type] ?? advice.indetermine;
  }
};

export default BRGMService;

// ════════════════════════════════════════════════════════════════════
