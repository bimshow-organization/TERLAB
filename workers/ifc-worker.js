// TERLAB · ifc-worker.js · Export IFC 2x3 · ENSA La Réunion v1.0
//
// Architecture hybride :
//   Option A — BIMSHOW bridge (si BIMSHOW connecté, pipeline web-ifc côté BIMSHOW)
//   Option C — Génération IFC ASCII en JS pur (fallback, gabarit simple)
//
// ⚠️ Option B (web-ifc WASM autonome) = TODO v2.0 — voir note en bas de fichier
//
// Usage depuis Phase 7 :
//   import IFCExporter from '../workers/ifc-worker.js';
//   const result = await IFCExporter.export(sessionData, gabaritParams);
//   // result.ifc = string IFC | result.source = 'bimshow' | 'ascii'

import BIMSHOWBridge from '../components/bimshow-bridge.js';

const IFCExporter = {

  // ── ENTRY POINT ───────────────────────────────────────────────
  async export(sessionData, gabaritParams, options = {}) {
    const { forceFallback = false, timeout = 6000 } = options;

    // Tenter Option A si BIMSHOW est connecté
    if (!forceFallback) {
      try {
        const bimshowResult = await this.exportViaBIMSHOW(sessionData, gabaritParams, timeout);
        if (bimshowResult) return { ...bimshowResult, source: 'bimshow' };
      } catch (e) {
        console.warn('[IFC] BIMSHOW bridge failed, fallback ASCII:', e.message);
      }
    }

    // Option C — ASCII fallback
    const ifc = this.generateASCII(sessionData, gabaritParams);
    return { ifc, source: 'ascii', note: 'Gabarit simplifié — géométrie boîte IFC 2x3' };
  },

  // ── OPTION A — BIMSHOW BRIDGE ─────────────────────────────────
  async exportViaBIMSHOW(sessionData, params, timeout) {
    const target = window.parent !== window ? window.parent : window.opener;
    if (!target) throw new Error('Pas de frame BIMSHOW parent');

    // Envoyer la demande d'export IFC à BIMSHOW
    BIMSHOWBridge.send('TERLAB_IFC_EXPORT_REQUEST', {
      sessionId:    sessionData.sessionId,
      gabarit:      params,
      terrain:      sessionData.terrain,
      ifcVersion:   'IFC2X3',
      includeMeta:  true
    });

    // Attendre la réponse
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout ${timeout}ms`)), timeout);

      const handler = (event) => {
        if (event.origin !== 'https://bimshow.io') return;
        const { type, payload } = event.data ?? {};
        if (type !== 'BIMSHOW_IFC_EXPORT_RESULT') return;

        clearTimeout(timer);
        window.removeEventListener('message', handler);

        if (!payload?.ifc) reject(new Error('Payload IFC vide'));
        else resolve({ ifc: payload.ifc, filename: payload.filename ?? 'terlab_gabarit.ifc' });
      };

      window.addEventListener('message', handler);
    });
  },

  // ── OPTION C — GÉNÉRATION IFC ASCII JS PUR ────────────────────
  // Génère un fichier IFC 2x3 valide pour un gabarit simple
  // Entités couvertes :
  //   IfcProject, IfcSite, IfcBuilding, IfcBuildingStorey
  //   IfcSlab (dalle RDC), IfcWall × 4, IfcRoof (selon type)
  //   Propriétés de la parcelle (commune, section, parcelle, PPRN, RTAA)
  //
  generateASCII(sessionData, params) {
    const terrain   = sessionData.terrain ?? {};
    const p4        = sessionData.phases?.[4]?.data ?? {};
    const p7        = sessionData.phases?.[7]?.data ?? params ?? {};
    const sid       = sessionData.sessionId ?? 'TERLAB-SESSION';
    const shortSid  = sid.replace(/-/g, '').slice(0, 12).toUpperCase();
    const now       = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const date_ifc  = `'${now}'`;

    const L    = parseFloat(p7.gabarit_l_m ?? params?.L ?? 10);
    const W    = parseFloat(p7.gabarit_w_m ?? params?.W ?? 8);
    const H    = parseFloat(p7.gabarit_h_m ?? params?.H ?? 6);
    const niv  = parseInt(p7.niveaux ?? 1);
    const hautEtage = H / niv;

    const commune    = terrain.commune ?? 'La Réunion';
    const parcelle   = `${terrain.section ?? ''}${terrain.parcelle ?? ''}`;
    const pprn       = terrain.zone_pprn ?? 'Non déterminé';
    const rtaa       = terrain.zone_rtaa ?? '1';
    const interco    = terrain.intercommunalite ?? '';
    const contenance = terrain.contenance_m2 ?? '';
    const altitude   = terrain.altitude_ngr ?? 0;
    const lat        = parseFloat(terrain.lat ?? -21.11);
    const lng        = parseFloat(terrain.lng ?? 55.54);

    // Helpers GUID IFC (simplifié — pas globalement unique mais suffisant pour usage pédagogique)
    let _gid = 1;
    const guid = (prefix = 'T') => {
      const n = String(_gid++).padStart(4,'0');
      return `'${prefix}${shortSid}${n}            '.slice(0,22)`;
    };
    // Version simplifiée — GUID fixe basé sur sid + index
    const G = (n) => `'${shortSid}${String(n).padStart(10,'0')}'`;

    // Références de propriétés IFC
    const lines = [];

    // ─── Header STEP ──────────────────────────────────────────────
    lines.push('ISO-10303-21;');
    lines.push('HEADER;');
    lines.push(`FILE_DESCRIPTION(('TERLAB v1.0 - Analyse terrain ${commune} ${parcelle} - Gabarit pedagogique'),'2;1');`);
    lines.push(`FILE_NAME('terlab_${commune.replace(/[^a-zA-Z0-9]/g,'_')}_${parcelle}.ifc',${date_ifc},('ENSA La Reunion - TERLAB'),('TERLAB v1.0 - outil pedagogique'),'TERLAB-IFC-ASCII','','');`);
    lines.push("FILE_SCHEMA(('IFC2X3'));");
    lines.push('ENDSEC;');
    lines.push('DATA;');
    lines.push('');
    lines.push('/* ═══ ORGANISATION ═══ */');

    // ─── Organisation ─────────────────────────────────────────────
    lines.push(`#1=IFCORGANIZATION($,'ENSA La Reunion',$,$,$);`);
    lines.push(`#2=IFCPERSON($,'Etudiant','ENSA',$,$,$,$,$);`);
    lines.push(`#3=IFCPERSONANDORGANIZATION(#2,#1,$);`);
    lines.push(`#4=IFCAPPLICATION(#1,'1.0','TERLAB - outil pedagogique ENSA La Reunion','TERLAB');`);
    lines.push(`#5=IFCOWNERHISTORY(#3,#4,.ADDED.,$,#3,#4,$,0);`);

    // ─── Géométrie ────────────────────────────────────────────────
    lines.push('');
    lines.push('/* ═══ GEOMETRIE DE BASE ═══ */');
    lines.push(`#10=IFCCARTESIANPOINT((0.,0.,0.));`);
    lines.push(`#11=IFCCARTESIANPOINT((1.,0.,0.));`);
    lines.push(`#12=IFCCARTESIANPOINT((0.,1.,0.));`);
    lines.push(`#13=IFCCARTESIANPOINT((0.,0.,1.));`);
    lines.push(`#14=IFCDIRECTION((1.,0.,0.));`);
    lines.push(`#15=IFCDIRECTION((0.,1.,0.));`);
    lines.push(`#16=IFCDIRECTION((0.,0.,1.));`);
    lines.push(`#17=IFCAXIS2PLACEMENT3D(#10,$,$);`);
    lines.push(`#18=IFCAXIS2PLACEMENT3D(#10,#16,#14);`);
    lines.push(`#19=IFCAXIS2PLACEMENT2D(IFCCARTESIANPOINT((0.,0.)),$);`);

    // ─── Contexte représentation ──────────────────────────────────
    lines.push(`#20=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#18,$);`);
    lines.push(`#21=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#20,$,.MODEL_VIEW.,$);`);
    lines.push(`#22=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Axis','Model',*,*,*,*,#20,$,.GRAPH_VIEW.,$);`);

    // ─── Unités ───────────────────────────────────────────────────
    lines.push('');
    lines.push('/* ═══ UNITES ═══ */');
    lines.push(`#30=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);`);
    lines.push(`#31=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);`);
    lines.push(`#32=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);`);
    lines.push(`#33=IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);`);
    lines.push(`#34=IFCUNITASSIGNMENT((#30,#31,#32,#33));`);

    // ─── Projet ───────────────────────────────────────────────────
    lines.push('');
    lines.push('/* ═══ PROJET ═══ */');
    lines.push(`#100=IFCPROJECT(${G(100)},#5,'TERLAB-${shortSid}','Analyse terrain ${commune} - TERLAB pedagogique',$,$,$,(#20),#34);`);

    // ─── Site ─────────────────────────────────────────────────────
    lines.push(`#110=IFCSITE(${G(110)},#5,'Terrain ${commune} ${parcelle}',$,'Parcelle ${parcelle} - ${interco}',$,$,$,.ELEMENT.,IFCPOSITIONINGGRID(${lat.toFixed(6)},${lng.toFixed(6)},${altitude}.),$,$,$,$);`);
    lines.push(`#111=IFCRELAGGREGATES(${G(111)},#5,'Site-Projet',$,#100,(#110));`);

    // ─── Building ─────────────────────────────────────────────────
    lines.push(`#120=IFCBUILDING(${G(120)},#5,'Gabarit ${commune}',$,'${p4.zone_plu ?? ''} - PPRN:${pprn}',$,$,$,.ELEMENT.,$,$,$);`);
    lines.push(`#121=IFCRELAGGREGATES(${G(121)},#5,'Building-Site',$,#110,(#120));`);

    // ─── Niveaux ──────────────────────────────────────────────────
    lines.push('');
    lines.push('/* ═══ NIVEAUX ═══ */');
    const storeyIds = [];
    for (let i = 0; i < niv; i++) {
      const id = 130 + i * 2;
      const z  = i * hautEtage;
      lines.push(`#${id}=IFCBUILDINGSTOREY(${G(id)},#5,'Niveau ${i}',$,'${i === 0 ? 'RDC' : 'R+' + i}',IFCLOCALPLACEMENT($,IFCAXIS2PLACEMENT3D(IFCCARTESIANPOINT((0.,0.,${z.toFixed(2)})),#16,#14)),$,$,.ELEMENT.,${z.toFixed(3)});`);
      storeyIds.push(id);
    }
    const storeyRefs = storeyIds.map(id => `#${id}`).join(',');
    lines.push(`#${140}=IFCRELAGGREGATES(${G(140)},#5,'Storeys-Building',$,#120,(${storeyRefs}));`);

    // ─── Géométrie gabarit ────────────────────────────────────────
    lines.push('');
    lines.push('/* ═══ GEOMETRIE GABARIT ═══ */');
    // Profil rectangulaire du gabarit
    lines.push(`#200=IFCRECTANGLEPROFILEDEF(.AREA.,$,#19,${L.toFixed(3)},${W.toFixed(3)});`);
    // Direction extrusion verticale
    lines.push(`#201=IFCEXTRUDEDAREASOLID(#200,#18,#16,${H.toFixed(3)});`);
    lines.push(`#202=IFCSHAPEREPRESENTATION(#21,'Body','SweptSolid',(#201));`);
    lines.push(`#203=IFCPRODUCTDEFINITIONSHAPE($,$,(#202));`);
    // Placement gabarit
    lines.push(`#204=IFCLOCALPLACEMENT($,#18);`);

    // ─── Dalle RDC ────────────────────────────────────────────────
    lines.push('');
    lines.push('/* ═══ STRUCTURE ═══ */');
    const dalleProfil = `#210=IFCRECTANGLEPROFILEDEF(.AREA.,$,#19,${L.toFixed(3)},${W.toFixed(3)});`;
    const dalleGeom   = `#211=IFCEXTRUDEDAREASOLID(#210,#18,#16,0.2);`;
    const dalleRep    = `#212=IFCSHAPEREPRESENTATION(#21,'Body','SweptSolid',(#211));`;
    const dalleDef    = `#213=IFCPRODUCTDEFINITIONSHAPE($,$,(#212));`;
    const dallePlac   = `#214=IFCLOCALPLACEMENT(#204,IFCAXIS2PLACEMENT3D(IFCCARTESIANPOINT((0.,0.,-0.2)),#16,#14));`;
    lines.push(dalleProfil, dalleGeom, dalleRep, dalleDef, dallePlac);
    lines.push(`#215=IFCSLAB(${G(215)},#5,'Dalle RDC',$,'Dalle plancher bas','Béton',#214,#213,.FLOOR.);`);
    lines.push(`#216=IFCRELCONTAINEDINSPATIALSTRUCTURE(${G(216)},#5,'Dalle-Storey',$,(#215),#${storeyIds[0]});`);

    // ─── Murs extérieurs (4 façades) ──────────────────────────────
    const wallThick = 0.2;
    const walls = [
      { id: 300, name: 'Façade Sud',  x: 0,       y: 0,       dx: L,          dy: wallThick, dir: '(1.,0.,0.)' },
      { id: 310, name: 'Façade Nord', x: 0,       y: W,       dx: L,          dy: wallThick, dir: '(1.,0.,0.)' },
      { id: 320, name: 'Façade Ouest',x: 0,       y: wallThick, dx: wallThick, dy: W - wallThick*2, dir: '(0.,1.,0.)' },
      { id: 330, name: 'Façade Est',  x: L - wallThick, y: wallThick, dx: wallThick, dy: W - wallThick*2, dir: '(0.,1.,0.)' }
    ];
    const wallIds = [];
    walls.forEach(w => {
      lines.push(`#${w.id}=IFCWALL(${G(w.id)},#5,'${w.name}',$,'Mur porteur RTAA Zone ${rtaa}',$,IFCLOCALPLACEMENT(#204,IFCAXIS2PLACEMENT3D(IFCCARTESIANPOINT((${w.x.toFixed(3)},${w.y.toFixed(3)},0.)),#16,IFCDIRECTION(${w.dir}))),IFCPRODUCTDEFINITIONSHAPE($,$,(IFCSHAPEREPRESENTATION(#21,'Body','SweptSolid',(IFCEXTRUDEDAREASOLID(IFCRECTANGLEPROFILEDEF(.AREA.,$,#19,${w.dx.toFixed(3)},${H.toFixed(3)}),#18,#15,${w.dy.toFixed(3)}))))),${G(w.id + 1)});`);
      wallIds.push(w.id);
    });
    lines.push(`#340=IFCRELCONTAINEDINSPATIALSTRUCTURE(${G(340)},#5,'Murs-Storey',$,(${wallIds.map(id=>`#${id}`).join(',')}),#${storeyIds[0]});`);

    // ─── Propriétés TERLAB ────────────────────────────────────────
    lines.push('');
    lines.push('/* ═══ PROPRIETES TERLAB ═══ */');
    lines.push(`#400=IFCPROPERTYSINGLEVALUE('Commune',$,IFCLABEL('${commune}'),$);`);
    lines.push(`#401=IFCPROPERTYSINGLEVALUE('Section_Parcelle',$,IFCLABEL('${parcelle}'),$);`);
    lines.push(`#402=IFCPROPERTYSINGLEVALUE('Intercommunalite',$,IFCLABEL('${interco}'),$);`);
    lines.push(`#403=IFCPROPERTYSINGLEVALUE('Contenance_m2',$,IFCREAL(${contenance || 0}.),$);`);
    lines.push(`#404=IFCPROPERTYSINGLEVALUE('Altitude_NGR_m',$,IFCREAL(${altitude}.),$);`);
    lines.push(`#405=IFCPROPERTYSINGLEVALUE('Zone_PPRN',$,IFCLABEL('${pprn}'),$);`);
    lines.push(`#406=IFCPROPERTYSINGLEVALUE('Zone_RTAA_DOM',$,IFCLABEL('${rtaa}'),$);`);
    lines.push(`#407=IFCPROPERTYSINGLEVALUE('Zone_PLU',$,IFCLABEL('${p4.zone_plu ?? ''}'),$);`);
    lines.push(`#408=IFCPROPERTYSINGLEVALUE('TERLAB_SessionID',$,IFCLABEL('${sid}'),$);`);
    lines.push(`#409=IFCPROPERTYSINGLEVALUE('Avertissement',$,IFCLABEL('Document pedagogique TERLAB v1.0 - Non opposable aux documents reglementaires officiels. ENSA La Reunion.'),$);`);

    lines.push(`#410=IFCPROPERTYSET(${G(410)},#5,'TERLAB_Terrain',$,(#400,#401,#402,#403,#404,#405,#406,#407,#408,#409));`);
    lines.push(`#411=IFCRELDEFINESBYPROPERTIES(${G(411)},#5,'Props-Building',$,(#120),#410);`);

    // ─── Relations spatiales ──────────────────────────────────────
    lines.push(`#500=IFCRELCONTAINEDINSPATIALSTRUCTURE(${G(500)},#5,'Gabarit-Storey',$,(#${wallIds[0]}),#${storeyIds[0]});`);

    lines.push('');
    lines.push('ENDSEC;');
    lines.push('END-ISO-10303-21;');

    return lines.join('\n');
  },

  // ── TÉLÉCHARGEMENT ────────────────────────────────────────────
  download(ifcString, filename = 'terlab_gabarit.ifc') {
    const blob = new Blob([ifcString], { type: 'application/x-step' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  // ── ENRICHISSEMENT CONTEXTE SITE 3D ────────────────────────────
  // Ajoute au STEP IFC 2x3 :
  //   - N IfcBuildingElementProxy (voisins extrudes BDTOPO) attaches au site #110
  //   - 1 IfcPropertySet 'TERLAB_Site_Contexte' sur le site (alt min/max, sources, count)
  // Note : la TIN du terrain n'est pas serialisee en IFC 2x3 (pas d'IfcTriangulatedFaceSet
  // disponible avant IFC4). Elle est presente dans le DXF compagnon.
  generateASCIIWithContext(sessionData, params, scene) {
    const ifc = this.generateASCII(sessionData, params);
    if (!scene?.buildings?.length && !scene?.terrainMesh?.vertices?.length) return ifc;

    const sid       = sessionData.sessionId ?? 'TERLAB-SESSION';
    const shortSid  = sid.replace(/-/g, '').slice(0, 12).toUpperCase();
    const G         = (n) => `'${shortSid}${String(n).padStart(10, '0')}'`;
    const escape    = (s) => String(s ?? '').replace(/'/g, '');
    const m         = scene.metadata ?? {};

    let id = 1000;
    const out = [];
    out.push('');
    out.push('/* ═══ CONTEXTE SITE 3D — TERLAB ═══ */');
    out.push(`/* Origine UTM40S : E=${scene.origin.E.toFixed(1)} N=${scene.origin.N.toFixed(1)} */`);
    out.push(`/* Centroide WGS84 : ${scene.lat.toFixed(6)}, ${scene.lng.toFixed(6)} */`);
    out.push(`/* Buffer ${scene.bufferM} m | DEM ${scene.pixelSizeM} m | TIN complete dans le DXF compagnon */`);

    // Stats altitude depuis le maillage
    let zMin = Infinity, zMax = -Infinity;
    const verts = scene.terrainMesh?.vertices ?? [];
    for (const v of verts) { if (v.z < zMin) zMin = v.z; if (v.z > zMax) zMax = v.z; }
    if (!isFinite(zMin)) { zMin = 0; zMax = 0; }

    // ── Voisins : IfcBuildingElementProxy par batiment ────────────
    const proxyIds = [];
    const buildings = scene.buildings ?? [];
    for (let b = 0; b < buildings.length; b++) {
      const bat = buildings[b];
      // Ring ferme : on retire le dernier point (== premier)
      const fp = bat.footprint3d ?? [];
      const pts = fp.length > 1 && fp[0].x === fp[fp.length - 1].x && fp[0].y === fp[fp.length - 1].y
        ? fp.slice(0, -1) : fp.slice();
      if (pts.length < 3) continue;

      // IfcCartesianPoint 2D pour chaque sommet du profil
      const ptIds = [];
      for (const p of pts) {
        out.push(`#${id}=IFCCARTESIANPOINT((${p.x.toFixed(3)},${p.y.toFixed(3)}));`);
        ptIds.push(id++);
      }
      // Polyline fermee (premier point repete)
      const polyRefs = ptIds.map(i => `#${i}`).concat(`#${ptIds[0]}`).join(',');
      const polyId = id;
      out.push(`#${id}=IFCPOLYLINE((${polyRefs}));`); id++;
      const profId = id;
      out.push(`#${id}=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,'voisin_${b}',#${polyId});`); id++;
      // Extrusion verticale (utilise #18 axis et #16 Z direction de generateASCII)
      const solidId = id;
      out.push(`#${id}=IFCEXTRUDEDAREASOLID(#${profId},#18,#16,${(bat.height || 6).toFixed(3)});`); id++;
      const repId = id;
      out.push(`#${id}=IFCSHAPEREPRESENTATION(#21,'Body','SweptSolid',(#${solidId}));`); id++;
      const defId = id;
      out.push(`#${id}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${repId}));`); id++;

      // Placement local : altitude de pose = z moyen du footprint (drape DEM)
      const zBase = pts.reduce((s, p) => s + p.z, 0) / pts.length;
      const placePtId = id;
      out.push(`#${id}=IFCCARTESIANPOINT((0.,0.,${zBase.toFixed(3)}));`); id++;
      const axisId = id;
      out.push(`#${id}=IFCAXIS2PLACEMENT3D(#${placePtId},#16,#14);`); id++;
      const placeId = id;
      out.push(`#${id}=IFCLOCALPLACEMENT($,#${axisId});`); id++;

      // BuildingElementProxy
      const proxyId = id;
      const name = `Voisin_${b + 1}`;
      const desc = escape(bat.label || bat.usage || 'Batiment voisin');
      out.push(`#${id}=IFCBUILDINGELEMENTPROXY(${G(proxyId)},#5,'${name}',$,'${desc}',#${placeId},#${defId},$,$);`); id++;
      proxyIds.push(proxyId);
    }

    // Rattachement spatial des voisins au site #110
    if (proxyIds.length) {
      out.push(`#${id}=IFCRELCONTAINEDINSPATIALSTRUCTURE(${G(id)},#5,'Voisins-Site',$,(${proxyIds.map(i => '#' + i).join(',')}),#110);`); id++;
    }

    // ── PropertySet contexte sur le site ──────────────────────────
    const propStart = id;
    out.push(`#${id}=IFCPROPERTYSINGLEVALUE('Buffer_m',$,IFCREAL(${scene.bufferM}.),$);`); id++;
    out.push(`#${id}=IFCPROPERTYSINGLEVALUE('Resolution_DEM_m',$,IFCREAL(${scene.pixelSizeM}.),$);`); id++;
    out.push(`#${id}=IFCPROPERTYSINGLEVALUE('Altitude_min_m',$,IFCREAL(${zMin.toFixed(2)}),$);`); id++;
    out.push(`#${id}=IFCPROPERTYSINGLEVALUE('Altitude_max_m',$,IFCREAL(${zMax.toFixed(2)}),$);`); id++;
    out.push(`#${id}=IFCPROPERTYSINGLEVALUE('Voisins_count',$,IFCINTEGER(${proxyIds.length}),$);`); id++;
    out.push(`#${id}=IFCPROPERTYSINGLEVALUE('Source_DEM',$,IFCLABEL('${escape(m.sources?.dem)}'),$);`); id++;
    out.push(`#${id}=IFCPROPERTYSINGLEVALUE('Source_Batiments',$,IFCLABEL('${escape(m.sources?.buildings)}'),$);`); id++;
    out.push(`#${id}=IFCPROPERTYSINGLEVALUE('Source_Routes',$,IFCLABEL('${escape(m.sources?.roads)}'),$);`); id++;
    out.push(`#${id}=IFCPROPERTYSINGLEVALUE('Centroide_lat',$,IFCREAL(${scene.lat.toFixed(6)}),$);`); id++;
    out.push(`#${id}=IFCPROPERTYSINGLEVALUE('Centroide_lng',$,IFCREAL(${scene.lng.toFixed(6)}),$);`); id++;
    const propRefs = [];
    for (let pid = propStart; pid < id; pid++) propRefs.push('#' + pid);
    const psetId = id;
    out.push(`#${id}=IFCPROPERTYSET(${G(psetId)},#5,'TERLAB_Site_Contexte',$,(${propRefs.join(',')}));`); id++;
    out.push(`#${id}=IFCRELDEFINESBYPROPERTIES(${G(id)},#5,'Site-Contexte-Props',$,(#110),#${psetId});`); id++;

    const block = out.join('\n') + '\n';
    return ifc.replace(
      'ENDSEC;\nEND-ISO-10303-21;',
      block + 'ENDSEC;\nEND-ISO-10303-21;'
    );
  },

  // ── HELPER : EXPORT COMPLET DEPUIS PHASE 7 ────────────────────
  async exportFromPhase7(sessionData) {
    const p7      = sessionData.phases?.[7]?.data ?? {};
    const terrain = sessionData.terrain ?? {};

    const params = {
      L: parseFloat(p7.gabarit_l_m ?? 10),
      W: parseFloat(p7.gabarit_w_m ?? 8),
      H: parseFloat(p7.gabarit_h_m ?? 6),
      niveaux: parseInt(p7.niveaux ?? 1)
    };

    const result   = await this.export(sessionData, params);
    const commune  = terrain.commune ?? 'terrain';
    const parcelle = `${terrain.section ?? ''}${terrain.parcelle ?? ''}`;
    const filename = `TERLAB_${commune}_${parcelle}_gabarit.ifc`.replace(/[^a-zA-Z0-9_\-.]/g, '_');

    this.download(result.ifc, filename);

    console.info(`[IFC] Export ${result.source} — ${result.ifc.length} caractères — ${filename}`);
    window.TerlabToast?.show(
      result.source === 'bimshow'
        ? 'IFC exporté via BIMSHOW'
        : 'IFC gabarit simplifié exporté (ASCII IFC 2x3)',
      'success'
    );

    return result;
  }

  // ─────────────────────────────────────────────────────────────────
  // NOTE — Option B (web-ifc WASM autonome) — TODO v2.0
  //
  // Intégrer web-ifc-api pour un export IFC complet autonome :
  //   import * as WebIFC from 'https://cdn.jsdelivr.net/npm/web-ifc@0.0.57/web-ifc-api.js';
  //   const api = new WebIFC.IfcAPI();
  //   await api.Init(); // charge le WASM (~2MB)
  //
  // Avantages : géométrie IFC propre, propriétés structurées, validation schema
  // Inconvénients : 2MB WASM, latence init, API bas niveau verbose
  //
  // À implémenter si TERLAB devient standalone (hors bimshow.io)
  //
  // ─────────────────────────────────────────────────────────────────
};

export default IFCExporter;
