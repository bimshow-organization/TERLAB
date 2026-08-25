// TERLAB · ifc-worker.js · Export IFC · ENSA La Réunion v1.0
//
// Deux generateurs distincts :
//   generateASCII      — gabarit seul, IFC 2x3 (legacy, cf. note en bas)
//   generateSiteIFC4   — site complet, IFC4 avec MNT tessele (IfcTriangulatedFaceSet)
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
  //
  // @deprecated Remplace par generateSiteIFC4() depuis le passage de l'export
  // site en IFC4 (MNT tessele). Conserve pour les integrations tierces qui
  // exigeraient encore du 2x3 ; plus appele par ExportEngine.generateIFCSite().
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

  // ══════════════════════════════════════════════════════════════════
  // EXPORT SITE — IFC4 (schema moderne, terrain tessele)
  // ══════════════════════════════════════════════════════════════════
  // Genere un IFC4 valide au sens Part 21 : chaque entite est une instance
  // numerotee (#N=), aucune imbrication inline.
  //
  // Contenu :
  //   IfcSite       — MNT LiDAR/IGN en IfcTriangulatedFaceSet (IFC4 only),
  //                   RefLatitude/Longitude en IfcCompoundPlaneAngleMeasure
  //   IfcAnnotation — contour de parcelle drape sur le MNT
  //   IfcBuilding   — gabarit pedagogique (volume capable) pose a l'altitude
  //                   reelle du terrain + IfcBuildingStorey par niveau
  //   IfcBuildingElementProxy x N — batiments voisins extrudes (BDTOPO)
  //   IfcPropertySet TERLAB_Terrain + TERLAB_Site_Contexte
  //
  // Repere : origine = centroide parcelle (EPSG:2975 UTM40S), X est, Y nord,
  //          Z = altitude NGR absolue (identique au DXF compagnon).
  //
  // Pourquoi IFC4 : IfcTriangulatedFaceSet n'existe pas avant IFC4. En 2x3 il
  // aurait fallu un IfcFace + IfcPolyLoop par triangle (~4 lignes STEP chacun,
  // soit ~13 000 lignes pour un MNT 40x40) ; ici deux entites indexees suffisent.
  generateSiteIFC4(sessionData, params, scene) {
    if (!scene?.terrainMesh?.vertices?.length) {
      throw new Error('[IFC4] SiteScene invalide — terrainMesh manquant');
    }

    const terrain = sessionData.terrain ?? {};
    const p4      = sessionData.phases?.[4]?.data ?? {};
    const p7      = sessionData.phases?.[7]?.data ?? params ?? {};
    const sid     = sessionData.sessionId ?? 'TERLAB-SESSION';
    const m       = scene.metadata ?? {};

    const commune    = terrain.commune ?? 'La Reunion';
    const parcelle   = `${terrain.section ?? ''}${terrain.parcelle ?? ''}`;
    const interco    = terrain.intercommunalite ?? '';
    const pprn       = terrain.zone_pprn ?? 'Non determine';
    const rtaa       = terrain.zone_rtaa ?? '1';
    const contenance = parseFloat(terrain.contenance_m2) || 0;
    const alt        = parseFloat(scene.origin?.alt) || 0;

    const L   = parseFloat(p7.gabarit_l_m ?? params?.L ?? 10);
    const W   = parseFloat(p7.gabarit_w_m ?? params?.W ?? 8);
    const H   = parseFloat(p7.gabarit_h_m ?? params?.H ?? 6);
    const niv = Math.max(1, parseInt(p7.niveaux ?? params?.niveaux ?? 1) || 1);

    // ── Helpers ─────────────────────────────────────────────────────
    const esc = (s) => String(s ?? '').replace(/\\/g, '').replace(/'/g, '');
    const N   = (v, d = 3) => {
      const n = Number(v);
      return (Number.isFinite(n) ? n : 0).toFixed(d);
    };

    const lines = [];
    let _id = 0;
    /** Emet une entite numerotee et retourne son id. */
    const E = (body) => { lines.push(`#${++_id}=${body};`); return _id; };
    const R = (id) => `#${id}`;

    const ifcGuid = this._makeGuidFactory(sid);

    // ── HEADER ──────────────────────────────────────────────────────
    const now   = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const fname = `TERLAB_${esc(commune)}_${esc(parcelle)}_site3d.ifc`;
    const head = [
      'ISO-10303-21;',
      'HEADER;',
      `FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]','TERLAB site 3D - ${esc(commune)} ${esc(parcelle)}'),'2;1');`,
      `FILE_NAME('${fname}','${now}',('ENSA La Reunion - TERLAB'),('ENSA La Reunion'),'TERLAB IFC4 site exporter','TERLAB v1.0','');`,
      "FILE_SCHEMA(('IFC4'));",
      'ENDSEC;',
      'DATA;',
    ];

    // ── Acteurs ─────────────────────────────────────────────────────
    const org    = E(`IFCORGANIZATION($,'ENSA La Reunion',$,$,$)`);
    const pers   = E(`IFCPERSON($,'Etudiant','ENSA',$,$,$,$,$)`);
    const pAndO  = E(`IFCPERSONANDORGANIZATION(${R(pers)},${R(org)},$)`);
    const app    = E(`IFCAPPLICATION(${R(org)},'1.0','TERLAB - outil pedagogique ENSA La Reunion','TERLAB')`);
    const owner  = E(`IFCOWNERHISTORY(${R(pAndO)},${R(app)},$,.ADDED.,$,$,$,${Math.floor(Date.now() / 1000)})`);
    const OW     = R(owner);

    // ── Geometrie de base ───────────────────────────────────────────
    const pOrigin  = E(`IFCCARTESIANPOINT((0.,0.,0.))`);
    const dirZ     = E(`IFCDIRECTION((0.,0.,1.))`);
    const dirX     = E(`IFCDIRECTION((1.,0.,0.))`);
    const axisRoot = E(`IFCAXIS2PLACEMENT3D(${R(pOrigin)},${R(dirZ)},${R(dirX)})`);

    // ── Contextes de representation ─────────────────────────────────
    const ctx     = E(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${R(axisRoot)},$)`);
    const ctxBody = E(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${R(ctx)},$,.MODEL_VIEW.,$)`);
    const ctxAnno = E(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Annotation','Model',*,*,*,*,${R(ctx)},$,.MODEL_VIEW.,$)`);

    // ── Unites ──────────────────────────────────────────────────────
    const uLen  = E(`IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`);
    const uArea = E(`IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)`);
    const uVol  = E(`IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)`);
    const uAng  = E(`IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)`);
    const units = E(`IFCUNITASSIGNMENT((${[uLen, uArea, uVol, uAng].map(R).join(',')}))`);

    // ── Projet ──────────────────────────────────────────────────────
    const project = E(`IFCPROJECT('${ifcGuid()}',${OW},'TERLAB - ${esc(commune)} ${esc(parcelle)}','Analyse de site TERLAB (document pedagogique)',$,$,$,(${R(ctx)}),${R(units)})`);

    // ── Terrain : IfcTriangulatedFaceSet ────────────────────────────
    // CoordIndex est 1-based en IFC4 (les indices JS sont 0-based).
    const verts = scene.terrainMesh.vertices;
    const tris  = scene.terrainMesh.triangles ?? [];
    const coordList = verts.map(v => `(${N(v.x)},${N(v.y)},${N(v.z)})`).join(',');
    const coordIdx  = tris.map(t => `(${t[0] + 1},${t[1] + 1},${t[2] + 1})`).join(',');
    const ptList    = E(`IFCCARTESIANPOINTLIST3D((${coordList}))`);
    // Closed = .F. : le MNT est une surface ouverte, pas un solide ferme.
    const tin       = E(`IFCTRIANGULATEDFACESET(${R(ptList)},$,.F.,(${coordIdx}),$)`);
    const tinRep    = E(`IFCSHAPEREPRESENTATION(${R(ctxBody)},'Body','Tessellation',(${R(tin)}))`);
    const siteShape = E(`IFCPRODUCTDEFINITIONSHAPE($,$,(${R(tinRep)}))`);

    // ── Site ────────────────────────────────────────────────────────
    const sitePlace = E(`IFCLOCALPLACEMENT($,${R(axisRoot)})`);
    const latC = this._compoundAngle(scene.lat);
    const lngC = this._compoundAngle(scene.lng);
    const site = E(`IFCSITE('${ifcGuid()}',${OW},'Terrain ${esc(commune)} ${esc(parcelle)}','Parcelle ${esc(parcelle)} - ${esc(interco)}',$,${R(sitePlace)},${R(siteShape)},'${esc(commune)}',.ELEMENT.,${latC},${lngC},${N(alt)},$,$)`);
    E(`IFCRELAGGREGATES('${ifcGuid()}',${OW},'Project-Site',$,${R(project)},(${R(site)}))`);

    // ── Contour de parcelle drape (IfcAnnotation) ───────────────────
    const siteChildren = [];
    const ring = scene.parcelGeom?.ring3d ?? [];
    const hasRing = ring.length >= 3;
    if (hasRing) {
      const ptIds = ring.map(p => E(`IFCCARTESIANPOINT((${N(p.x)},${N(p.y)},${N(p.z)}))`));
      const refs  = ptIds.map(R).concat(R(ptIds[0])).join(',');   // ferme le contour
      const poly  = E(`IFCPOLYLINE((${refs}))`);
      const curve = E(`IFCGEOMETRICCURVESET((${R(poly)}))`);
      const cRep  = E(`IFCSHAPEREPRESENTATION(${R(ctxAnno)},'Annotation','GeometricCurveSet',(${R(curve)}))`);
      const cDef  = E(`IFCPRODUCTDEFINITIONSHAPE($,$,(${R(cRep)}))`);
      const cPlc  = E(`IFCLOCALPLACEMENT(${R(sitePlace)},${R(axisRoot)})`);
      siteChildren.push(E(`IFCANNOTATION('${ifcGuid()}',${OW},'Limite parcelle ${esc(parcelle)}','Contour cadastral drape sur MNT',$,${R(cPlc)},${R(cDef)})`));
    }

    // ── Batiments voisins (BDTOPO extrudes) ─────────────────────────
    const buildings = scene.buildings ?? [];
    let voisinsCount = 0;
    for (let b = 0; b < buildings.length; b++) {
      const bat = buildings[b];
      let pts = bat.footprint3d ?? [];
      if (pts.length > 1) {
        const f = pts[0], l = pts[pts.length - 1];
        if (f.x === l.x && f.y === l.y) pts = pts.slice(0, -1);
      }
      if (pts.length < 3) continue;

      const zBase = pts.reduce((s, p) => s + (Number(p.z) || 0), 0) / pts.length;
      // Profil 2D dans le plan local du batiment (le Z est porte par le placement)
      const ptIds = pts.map(p => E(`IFCCARTESIANPOINT((${N(p.x)},${N(p.y)}))`));
      const refs  = ptIds.map(R).concat(R(ptIds[0])).join(',');
      const poly  = E(`IFCPOLYLINE((${refs}))`);
      const prof  = E(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,'voisin_${b + 1}',${R(poly)})`);
      const solid = E(`IFCEXTRUDEDAREASOLID(${R(prof)},${R(axisRoot)},${R(dirZ)},${N(Math.max(0.5, Number(bat.height) || 6))})`);
      const rep   = E(`IFCSHAPEREPRESENTATION(${R(ctxBody)},'Body','SweptSolid',(${R(solid)}))`);
      const def   = E(`IFCPRODUCTDEFINITIONSHAPE($,$,(${R(rep)}))`);
      const pt    = E(`IFCCARTESIANPOINT((0.,0.,${N(zBase)}))`);
      const ax    = E(`IFCAXIS2PLACEMENT3D(${R(pt)},${R(dirZ)},${R(dirX)})`);
      const plc   = E(`IFCLOCALPLACEMENT(${R(sitePlace)},${R(ax)})`);
      const label = esc(bat.label || bat.usage || 'Batiment voisin');
      siteChildren.push(E(`IFCBUILDINGELEMENTPROXY('${ifcGuid()}',${OW},'Voisin_${b + 1}','${label}',$,${R(plc)},${R(def)},$,.NOTDEFINED.)`));
      voisinsCount++;
    }

    if (siteChildren.length) {
      E(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${ifcGuid()}',${OW},'Contexte-Site','Voisinage et limites',(${siteChildren.map(R).join(',')}),${R(site)})`);
    }

    // ── Batiment : gabarit pedagogique pose sur le terrain ──────────
    const bPt      = E(`IFCCARTESIANPOINT((0.,0.,${N(alt)}))`);
    const bAx      = E(`IFCAXIS2PLACEMENT3D(${R(bPt)},${R(dirZ)},${R(dirX)})`);
    const bPlace   = E(`IFCLOCALPLACEMENT(${R(sitePlace)},${R(bAx)})`);
    const building = E(`IFCBUILDING('${ifcGuid()}',${OW},'Gabarit ${esc(commune)}','Volume capable - zone ${esc(p4.zone_plu ?? '')} - PPRN ${esc(pprn)}',$,${R(bPlace)},$,'Gabarit pedagogique',.ELEMENT.,${N(alt)},${N(alt)},$)`);
    E(`IFCRELAGGREGATES('${ifcGuid()}',${OW},'Site-Building',$,${R(site)},(${R(building)}))`);

    // Niveaux
    const hEtage  = H / niv;
    const storeys = [];
    for (let i = 0; i < niv; i++) {
      const z   = i * hEtage;
      const pt  = E(`IFCCARTESIANPOINT((0.,0.,${N(z)}))`);
      const ax  = E(`IFCAXIS2PLACEMENT3D(${R(pt)},${R(dirZ)},${R(dirX)})`);
      const plc = E(`IFCLOCALPLACEMENT(${R(bPlace)},${R(ax)})`);
      storeys.push(E(`IFCBUILDINGSTOREY('${ifcGuid()}',${OW},'${i === 0 ? 'RDC' : 'R+' + i}',$,$,${R(plc)},$,'Niveau ${i}',.ELEMENT.,${N(z)})`));
    }
    E(`IFCRELAGGREGATES('${ifcGuid()}',${OW},'Building-Storeys',$,${R(building)},(${storeys.map(R).join(',')}))`);

    // Volume capable : boite extrudee centree sur le centroide parcelle
    const gProfPt  = E(`IFCCARTESIANPOINT((0.,0.))`);
    const gProfPos = E(`IFCAXIS2PLACEMENT2D(${R(gProfPt)},$)`);
    const gProf    = E(`IFCRECTANGLEPROFILEDEF(.AREA.,'gabarit',${R(gProfPos)},${N(L)},${N(W)})`);
    const gSolid   = E(`IFCEXTRUDEDAREASOLID(${R(gProf)},${R(axisRoot)},${R(dirZ)},${N(H)})`);
    const gRep     = E(`IFCSHAPEREPRESENTATION(${R(ctxBody)},'Body','SweptSolid',(${R(gSolid)}))`);
    const gDef     = E(`IFCPRODUCTDEFINITIONSHAPE($,$,(${R(gRep)}))`);
    const gPlc     = E(`IFCLOCALPLACEMENT(${R(bPlace)},${R(axisRoot)})`);
    const gabarit  = E(`IFCBUILDINGELEMENTPROXY('${ifcGuid()}',${OW},'Gabarit ${N(L, 1)}x${N(W, 1)}x${N(H, 1)} m','Volume capable pedagogique - non opposable',$,${R(gPlc)},${R(gDef)},$,.NOTDEFINED.)`);
    E(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${ifcGuid()}',${OW},'Gabarit-Storey',$,(${R(gabarit)}),${R(storeys[0])})`);

    // ── Property sets ───────────────────────────────────────────────
    let zMin = Infinity, zMax = -Infinity;
    for (const v of verts) {
      const z = Number(v.z);
      if (!Number.isFinite(z)) continue;
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
    if (!Number.isFinite(zMin)) { zMin = 0; zMax = 0; }

    const pset = (name, props, target) => {
      const ids = props.map(([k, v]) => E(`IFCPROPERTYSINGLEVALUE('${k}',$,${v},$)`));
      const ps  = E(`IFCPROPERTYSET('${ifcGuid()}',${OW},'${name}',$,(${ids.map(R).join(',')}))`);
      E(`IFCRELDEFINESBYPROPERTIES('${ifcGuid()}',${OW},'${name}-Rel',$,(${R(target)}),${R(ps)})`);
    };

    pset('TERLAB_Terrain', [
      ['Commune',          `IFCLABEL('${esc(commune)}')`],
      ['Section_Parcelle', `IFCLABEL('${esc(parcelle)}')`],
      ['Intercommunalite', `IFCLABEL('${esc(interco)}')`],
      ['Contenance_m2',    `IFCREAL(${N(contenance, 2)})`],
      ['Altitude_NGR_m',   `IFCREAL(${N(alt, 2)})`],
      ['Zone_PPRN',        `IFCLABEL('${esc(pprn)}')`],
      ['Zone_RTAA_DOM',    `IFCLABEL('${esc(rtaa)}')`],
      ['Zone_PLU',         `IFCLABEL('${esc(p4.zone_plu ?? '')}')`],
      ['TERLAB_SessionID', `IFCLABEL('${esc(sid)}')`],
      ['Avertissement',    `IFCLABEL('Document pedagogique TERLAB - non opposable aux documents reglementaires officiels. ENSA La Reunion.')`],
    ], building);

    pset('TERLAB_Site_Contexte', [
      ['Buffer_m',         `IFCREAL(${N(scene.bufferM, 1)})`],
      ['Resolution_DEM_m', `IFCREAL(${N(scene.pixelSizeM, 2)})`],
      ['Altitude_min_m',   `IFCREAL(${N(zMin, 2)})`],
      ['Altitude_max_m',   `IFCREAL(${N(zMax, 2)})`],
      ['Triangles_MNT',    `IFCINTEGER(${tris.length})`],
      ['Sommets_MNT',      `IFCINTEGER(${verts.length})`],
      ['Voisins_count',    `IFCINTEGER(${voisinsCount})`],
      ['Contour_parcelle', `IFCLABEL('${hasRing ? 'presente' : 'absente'}')`],
      ['Source_DEM',       `IFCLABEL('${esc(m.sources?.dem)}')`],
      ['Source_Batiments', `IFCLABEL('${esc(m.sources?.buildings)}')`],
      ['CRS_local',        `IFCLABEL('${esc(m.crs)}')`],
      ['Origine_UTM40S_E', `IFCREAL(${N(scene.origin?.E, 2)})`],
      ['Origine_UTM40S_N', `IFCREAL(${N(scene.origin?.N, 2)})`],
      ['Centroide_lat',    `IFCREAL(${N(scene.lat, 6)})`],
      ['Centroide_lng',    `IFCREAL(${N(scene.lng, 6)})`],
    ], site);

    return head.concat(lines, ['ENDSEC;', 'END-ISO-10303-21;']).join('\n');
  },

  // ── Latitude/longitude decimale → IfcCompoundPlaneAngleMeasure ────
  // IFC attend (degres, minutes, secondes, millioniemes de seconde).
  // Convention : toutes les composantes portent le signe de l'angle.
  _compoundAngle(decimalDeg) {
    const v = Number(decimalDeg);
    if (!Number.isFinite(v)) return '$';
    const sign = v < 0 ? -1 : 1;
    let rest = Math.abs(v);
    const deg = Math.floor(rest);
    rest = (rest - deg) * 60;
    const min = Math.floor(rest);
    rest = (rest - min) * 60;
    const sec = Math.floor(rest);
    const mms = Math.round((rest - sec) * 1e6);
    return `(${sign * deg},${sign * min},${sign * sec},${sign * mms})`;
  },

  // ── GUID IFC (22 caracteres base64 IFC), deterministe par session ──
  // Un GlobalId hors format fait rejeter l'entite par les controleurs.
  _makeGuidFactory(seedStr) {
    const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
    const seed = String(seedStr);
    let h = 2166136261 >>> 0;                        // FNV-1a sur la seed
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    let counter = 0;
    return () => {
      let s = (h ^ Math.imul(++counter, 2654435761)) >>> 0;
      const next = () => {                           // xorshift32
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5;  s >>>= 0;
        return s;
      };
      // 1er caractere sur 2 bits (0-3) : un GUID IFC code 128 bits sur 22 chars
      let out = A[next() % 4];
      for (let i = 1; i < 22; i++) out += A[next() % 64];
      return out;
    };
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
