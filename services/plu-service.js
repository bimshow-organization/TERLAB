// TERLAB · services/plu-service.js
// Données PLU via API Carto IGN (remplace WMS instable pour DOM)
// https://apicarto.ign.fr/api/gpu/zone-urba
// Gratuite, stable, pas de clé API requise
// ════════════════════════════════════════════════════════════════════

const PLUService = {

  // ─── Principales intercommunalités Réunion avec PLU info ────────
  INTERCO_INFO: {
    CINOR: {
      nom: 'Communauté Intercommunale du Nord de La Réunion',
      plui: 'PLUi approuvé 2019 — révision en cours',
      contact: 'urbanisme@cinor.re',
      url: 'https://www.cinor.re/vivre-cinor/logement-urbanisme/'
    },
    CIREST: {
      nom: 'Communauté Intercommunale Réunion Est',
      plui: 'PLUi approuvé 2020',
      contact: 'urbanisme@cirest.re',
      url: 'https://www.cirest.fr/urbanisme/'
    },
    CASUD: {
      nom: 'Communauté d\'Agglomération du Sud de La Réunion',
      plui: 'PLUi en cours d\'élaboration',
      contact: 'urbanisme@casud.re',
      url: 'https://www.casud.re/urbanisme/'
    },
    TCO: {
      nom: 'Territoire de la Côte Ouest',
      plui: 'PLUi approuvé 2018',
      contact: 'urbanisme@tco.re',
      url: 'https://www.tco.re/urbanisme/'
    }
  },

  // ─── Requête API Carto IGN ──────────────────────────────────────
  async queryZoneUrba(lat, lng) {
    const url = `https://apicarto.ign.fr/api/gpu/zone-urba`
      + `?geom=${encodeURIComponent(JSON.stringify({
          type: 'Point', coordinates: [lng, lat]
        }))}`;

    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`API Carto ${resp.status}`);
    const data = await resp.json();
    return data;
  },

  // ─── Requête prescriptions réglementaires ───────────────────────
  async queryPrescriptions(lat, lng) {
    const url = `https://apicarto.ign.fr/api/gpu/prescription-lin`
      + `?geom=${encodeURIComponent(JSON.stringify({
          type: 'Point', coordinates: [lng, lat]
        }))}`;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.features ?? [];
    } catch { return []; }
  },

  // ─── Requête SUP (Servitudes d'Utilité Publique) ────────────────
  async querySUP(lat, lng) {
    const url = `https://apicarto.ign.fr/api/gpu/acte-sup`
      + `?geom=${encodeURIComponent(JSON.stringify({
          type: 'Point', coordinates: [lng, lat]
        }))}`;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.features ?? [];
    } catch { return []; }
  },

  // ─── Requête complète avec fallback ────────────────────────────
  async query(lat, lng) {
    try {
      const [zoneData, prescriptions, sups] = await Promise.all([
        this.queryZoneUrba(lat, lng),
        this.queryPrescriptions(lat, lng),
        this.querySUP(lat, lng)
      ]);

      const features = zoneData.features ?? [];
      if (!features.length) return this._fallback(lat, lng);

      const zone = features[0];
      const p    = zone.properties ?? {};

      return {
        source:       'api_carto_ign',
        zone:         p.typezone ?? '—',
        libelle:      p.libelle ?? p.libelong ?? '—',
        destdomi:     p.destdomi ?? '—',
        partition:    p.partition ?? '—',
        datappro:     p.datappro ?? '—',
        nomfic:       p.nomfic ?? '—',
        prescriptions: prescriptions.map(f => ({
          type:   f.properties?.typepsc ?? '—',
          libelle: f.properties?.libelle ?? '—'
        })),
        sups: sups.map(f => ({
          libelle: f.properties?.libelle ?? '—',
          gestionnaire: f.properties?.gestionnaire ?? '—'
        })),
        // Valeurs RTAA DOM déduites de la zone
        rtaa_notes: this._rtaaFromZone(p.typezone)
      };

    } catch (e) {
      console.warn('[PLU] API Carto failed:', e.message);
      return this._fallback(lat, lng);
    }
  },

  // ─── Fallback par intercommunalité ──────────────────────────────
  _fallback(lat, lng) {
    return {
      source:    'fallback',
      zone:      '—',
      libelle:   'API Carto indisponible — vérification manuelle requise',
      note:      '⚠️ Consulter le Géoportail de l\'Urbanisme ou la mairie',
      url_gpu:   `https://www.geoportail-urbanisme.gouv.fr`,
      prescriptions: [],
      sups: []
    };
  },

  _rtaaFromZone(zone) {
    // Inférer la RTAA DOM depuis la zone PLU (approximatif)
    if (!zone) return null;
    const z = zone.toUpperCase();
    if (z.startsWith('A') || z.startsWith('N')) return 'Zone agricole/naturelle — constructibilité très limitée';
    if (z.startsWith('U')) return 'Zone urbaine — RTAA DOM applicable selon altitude';
    if (z.startsWith('AU')) return 'Zone à urbaniser — étudier OAP';
    return null;
  },

  // ─── WFS direct (Géoportail de l'Urbanisme) ─────────────────────
  // Porté de GIEP-LA-REUNION carte-infos.js getPLU()
  _wfsCache: new Map(),

  async fetch(lng, lat) {
    const key = `${lng.toFixed(6)}_${lat.toFixed(6)}`;
    if (this._wfsCache.has(key)) return this._wfsCache.get(key);

    const buf  = 0.0001;
    const bbox = `${lng - buf},${lat - buf},${lng + buf},${lat + buf}`;
    const url  = `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature`
               + `&TYPENAMES=wfs_du:zone_urba&OUTPUTFORMAT=application/json`
               + `&SRSNAME=EPSG:4326&BBOX=${bbox},EPSG:4326`;

    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 10000);
      const resp = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (!data.features?.length) return null;

      const p  = data.features[0].properties;
      const tz = p?.typezone;
      const res = {
        zone:          p?.libelle ?? '—',
        typeZone:      tz,
        libelong:      p?.libelong ?? '',
        destdomi:      p?.destdomi ?? '',
        constructible: tz === 'U' || tz === 'AU',
        interpretation:
          tz === 'U'  ? 'Zone urbaine — Constructible' :
          tz === 'AU' ? 'Zone à urbaniser — Constructible sous conditions' :
          tz === 'A'  ? 'Zone agricole — Protection stricte' :
          tz === 'N'  ? 'Zone naturelle — Protection stricte' : 'Non défini',
        source: 'IGN GPU Géoportail Urbanisme',
      };
      this._wfsCache.set(key, res);
      return res;
    } catch (e) {
      if (e.name === 'AbortError') window.TerlabToast?.show('PLU: timeout IGN', 'warning');
      else console.warn('[PLU]', e.message);
      return null;
    }
  },

  // DescribeFeatureType pour détecter le champ géom (GIEP pattern)
  _geomFieldCache: new Map(),
  async getGeomField(typeName) {
    if (this._geomFieldCache.has(typeName)) return this._geomFieldCache.get(typeName);
    try {
      const url = `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=DescribeFeatureType&TYPENAMES=${encodeURIComponent(typeName)}`;
      const xml = new DOMParser().parseFromString(await (await fetch(url)).text(), 'text/xml');
      const els = Array.from(xml.getElementsByTagNameNS('*', 'element'));
      let field = els.find(e => /gml/i.test(e.getAttribute('type') || ''))?.getAttribute('name');
      if (!field) field = ['geometrie', 'geom', 'the_geom', 'geometry'].find(n => els.some(e => e.getAttribute('name') === n));
      field = field ?? 'geometrie';
      this._geomFieldCache.set(typeName, field);
      return field;
    } catch { return 'geometrie'; }
  },

  // ─── GPU REST API — Règlement & documents ───────────────────────
  // Endpoint principal : geoportail-urbanisme.gouv.fr/api/
  // Pas de clé API requise

  /**
   * Récupère les infos du document d'urbanisme approuvé pour une partition.
   * @param {string} partition — ex: "DU_97436" (Saint-Leu)
   * @returns {{ id, type, name, datAppro, status } | null}
   */
  async queryDocument(partition) {
    const url = `https://www.geoportail-urbanisme.gouv.fr/api/document`
      + `?partition=${encodeURIComponent(partition)}`
      + `&status=document.production&legalStatus=APPROVED`;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return null;
      const docs = await resp.json();
      if (!Array.isArray(docs) || !docs.length) return null;
      const d = docs[0];
      return {
        id:        d.id,
        type:      d.type ?? '—',
        name:      d.originalName ?? d.title ?? '—',
        datAppro:  d.datAppro ?? '—',
        status:    d.status ?? '—',
      };
    } catch (e) {
      console.warn('[PLU] queryDocument failed:', e.message);
      return null;
    }
  },

  /**
   * Liste les fichiers d'un document d'urbanisme (règlement, OAP, etc.)
   * @param {string} documentId — identifiant GPU hex 32 chars
   * @returns {Array<{ name, type, url }>}
   */
  async getDocumentFiles(documentId) {
    const url = `https://www.geoportail-urbanisme.gouv.fr/api/document/${documentId}/files`;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return [];
      const files = await resp.json();
      if (!Array.isArray(files)) return [];
      return files.map(f => {
        const name = typeof f === 'string' ? f : (f.name ?? f);
        const lower = name.toLowerCase();
        let type = 'autre';
        if (lower.includes('reglement') || lower.includes('règlement')) type = 'reglement';
        else if (lower.includes('oap'))          type = 'oap';
        else if (lower.includes('rapport'))      type = 'rapport';
        else if (lower.includes('padd'))         type = 'padd';
        else if (lower.includes('zonage'))       type = 'zonage';
        return {
          name,
          type,
          url: `https://www.geoportail-urbanisme.gouv.fr/api/document/${documentId}/files/${encodeURIComponent(name)}`
        };
      });
    } catch (e) {
      console.warn('[PLU] getDocumentFiles failed:', e.message);
      return [];
    }
  },

  /**
   * URL directe vers le règlement PDF via le raccourci par partition.
   * @param {string} partition — ex: "DU_97436"
   * @param {string} nomfic — nom du fichier règlement (retourné par zone-urba)
   */
  getReglementDirectUrl(partition, nomfic) {
    if (!partition || !nomfic || nomfic === '—') return null;
    return `https://www.geoportail-urbanisme.gouv.fr/api/document/download-by-partition/${partition}/file/${encodeURIComponent(nomfic)}`;
  },

  /**
   * Workflow complet : coordonnées → liens vers le règlement + fichiers clés
   * @returns {{ zone, partition, nomfic, reglementUrl, documentId, files, prescriptions, sups }}
   */
  async fetchReglement(lat, lng) {
    // Étape 1 : zone-urba pour obtenir partition + nomfic
    const zoneData = await this.queryZoneUrba(lat, lng);
    const features = zoneData?.features ?? [];
    if (!features.length) return null;

    const zone = features[0];
    const p    = zone.properties ?? {};
    const partition = p.partition ?? null;
    const nomfic    = p.nomfic ?? null;

    // URL directe vers le règlement (shortcut par partition)
    const reglementUrl = this.getReglementDirectUrl(partition, nomfic);

    // Étape 2 : document complet + fichiers (OAP, rapport, etc.)
    let documentId = null;
    let files = [];
    if (partition) {
      const doc = await this.queryDocument(partition);
      if (doc) {
        documentId = doc.id;
        files = await this.getDocumentFiles(doc.id);
      }
    }

    return {
      zone:       p.typezone ?? '—',
      libelle:    p.libelle ?? p.libelong ?? '—',
      partition,
      nomfic,
      reglementUrl,
      documentId,
      files,
      datappro:   p.datappro ?? '—',
    };
  },

  // ─── Lien direct Géoportail Urbanisme pour la commune ───────────
  getGPUUrl(commune, insee) {
    return `https://www.geoportail-urbanisme.gouv.fr/commune/${insee}/document/list`;
  }
};

export default PLUService;
