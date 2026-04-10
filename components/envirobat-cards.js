/**
 * TERLAB · Composant Fiches enviroBAT-Réunion
 * Affiche des cartes-exemples avec thumbnail, résumé et lien PDF
 * Usage : EnvirobatCards.render(containerId, phaseId)
 *
 * Idempotent : wrappé dans un `if` pour que le `const` soit en scope
 * de bloc et ne crashe pas si le fichier est ré-évalué (rechargement
 * SPA, blob URL phase, etc.).
 */
if (typeof window !== 'undefined' && !window.EnvirobatCards) {

const EnvirobatCards = (() => {

  const FICHES = [
    {
      id: 'mediatheque-saint-leu',
      titre: 'Médiathèque de Saint-Leu',
      archi: 'Olivier Brabant · 2019',
      commune: 'Saint-Leu',
      programme: 'Équipement culturel — 1 500 m²',
      thumb: 'assets/thumbs/envirobat/fiche-mediatheque-saint-leu-2020.jpg',
      pdf: 'https://cdn.s-pass.org/SPASSDATA/attachments/2021_03/01/83498-fiche-mediateque-st-leu-3.pdf',
      url: 'https://www.envirobat-reunion.com/fr/portail/357/observatoire/55035/fiche-envirobat-reunion-mediatheque-saint-leu-olivier-brabant-2020.html',
      tags: ['ventilation naturelle', 'soufflerie', 'front de mer', 'bois'],
      resume: 'Ventilation naturelle 100% testée en soufflerie. Vitesses 1 m/s = −4°C ressenti. Liaison ville-mer, terrasse végétalisée.',
      phases: ['p04', 'p05', 'p07']
    },
    {
      id: 'zac-coeur-ville-possession',
      titre: 'ZAC Cœur de Ville',
      archi: 'SEMADER · LEU-Atelier · 2012-2026',
      commune: 'La Possession',
      programme: 'Éco-quartier 34 ha — 1 800 logements',
      thumb: 'assets/thumbs/envirobat/fiche-coeur-de-ville-la-possession.jpg',
      pdf: 'https://cdn.s-pass.org/SPASSDATA/attachments/2023_03/20/124228-fiche-coeur-de-ville-la-possession.pdf',
      url: 'https://www.envirobat-reunion.com',
      tags: ['éco-quartier', 'densification', 'mixité', 'TCSP', 'jardins partagés'],
      resume: '34 ha, 60% logements aidés, densité 50 log/ha. Mail tropical, TCSP, label Éco-quartier National.',
      phases: ['p04', 'p05', 'p07', 'p09']
    },
    {
      id: 'ufr-sante-saint-pierre',
      titre: 'UFR Santé — Université',
      archi: 'T&T Architecture · 2023',
      commune: 'Saint-Pierre',
      programme: 'Campus 6 770 m² — 1 000 étudiants',
      thumb: 'assets/thumbs/envirobat/fiche-ufr-sante-saint-pierre-2023.jpg',
      pdf: 'https://cdn.s-pass.org/SPASSDATA/attachments/2025_12/17/242159-251215-ufr-sante-fiche-envirobat-sc-2-compressed.pdf',
      url: 'https://www.envirobat-reunion.com/fr/portail/357/observatoire/88088/fiche-envirobat-reunion-ufr-sante-saint-pierre-2023.html',
      tags: ['campus', 'parc habité', 'structure mixte', 'PREBAT', 'solaire'],
      resume: '"Parc habité" avec jardins thématiques. Structure mixte béton/ossature légère. Rue intérieure ventilée, production solaire.',
      phases: ['p04', 'p07', 'p09']
    },
    {
      id: 'olea-saint-pierre',
      titre: 'OLEA — 28 logements sociaux',
      archi: 'Co-Architectes / SHLMR · 2021',
      commune: 'Saint-Pierre',
      programme: '28 LLTS — 1 821 m²',
      thumb: 'assets/thumbs/envirobat/fiche-olea-saint-pierre-2021.jpg',
      pdf: 'https://cdn.s-pass.org/SPASSDATA/attachments/2025_12/17/242157-251215-olea-fiche-envirobat-sc-2-compressed.pdf',
      url: 'https://www.envirobat-reunion.com/fr/portail/357/observatoire/88087/fiche-envirobat-reunion-olea-saint-pierre-2021.html',
      tags: ['participatif', 'NF Habitat HQE', 'jardins', 'bioclimatique'],
      resume: 'Conception participative inédite à La Réunion (4 ateliers, 22 familles). NF Habitat HQE. 1 logement = 1 jardin.',
      phases: ['p04', 'p05', 'p07']
    },
    {
      id: 'ecotole-saint-pierre',
      titre: 'ECOTOLE — Industrie & bureaux',
      archi: 'LAB Réunion · 2025',
      commune: 'Saint-Pierre',
      programme: 'Atelier + bureaux — 1 364 m²',
      thumb: 'assets/thumbs/envirobat/fiche-ecotole-saint-pierre-2025.jpg',
      pdf: 'https://cdn.s-pass.org/SPASSDATA/attachments/2025_12/17/242155-fiche-envirobat-ecotole-sc.pdf',
      url: 'https://www.envirobat-reunion.com/fr/portail/357/observatoire/88086/fiche-envirobat-reunion-batiment-industriel-et-bureaux-ecotole-saint-pierre-2025.html',
      tags: ['puits dépressionnaire', 'PREBAT', 'noues', 'endémiques'],
      resume: 'Puits dépressionnaire (110 vol/h atelier). Noues végétalisées, cuve 3 200 L, essences endémiques. PREBAT.',
      phases: ['p04', 'p07', 'p09', 'p10']
    },
    {
      id: 'agence-tt-saint-paul',
      titre: 'Agence T&T Architecture',
      archi: 'T&T Architecture · 2025',
      commune: 'Saint-Paul',
      programme: 'Bureaux R+2 — 330 m²',
      thumb: 'assets/thumbs/envirobat/fiche-agence-tt-architecture-saint-paul-2025.jpg',
      pdf: 'https://cdn.s-pass.org/SPASSDATA/attachments/2025_12/17/242153-fiche-envirobat-agence-t-t-sc.pdf',
      url: 'https://www.envirobat-reunion.com/fr/portail/357/observatoire/88084/fiche-envirobat-reunion-agence-et-bureaux-t-t-architecture-saint-paul-2025.html',
      tags: ['sobriété', 'matériaux locaux', 'réversibilité', '0 clim', 'chaux scories'],
      resume: 'Manifeste sobriété : 0 clim, parpaings endogènes, enduits chaux/talc de scories, menuiseries artisanales. Bâtiment réversible.',
      phases: ['p07', 'p09', 'p10', 'p11']
    },
    {
      id: 'coarm-saint-denis',
      titre: 'COARM — Ordre des Architectes',
      archi: 'Co-Architectes · 2022',
      commune: 'Saint-Denis',
      programme: 'Surélévation + rénovation — 140 m²',
      thumb: 'assets/thumbs/envirobat/fiche-coarm-saint-denis-2022.jpg',
      pdf: 'https://cdn.s-pass.org/SPASSDATA/attachments/2025_12/17/242151-251215-coarm-fiche-envirobat-sc-2-compressed.pdf',
      url: 'https://www.envirobat-reunion.com/fr/portail/357/observatoire/88083/fiche-envirobat-reunion-coarm-saint-denis-2022-1.html',
      tags: ['réemploi intégral', 'surélévation', 'case Satec', 'économie circulaire', 'frugalité'],
      resume: '1er bâtiment 100% réemploi à La Réunion. Case Satec 70s surélevée. 33 kWhef/m²/an. Grand Prix Bâtiments Circulaires 2022.',
      phases: ['p09', 'p10', 'p11']
    },
    {
      id: 'les-mahots-le-port',
      titre: 'Les Mahots — 45 logements',
      archi: 'Co-Architectes / SEMADER · 2018',
      commune: 'Le Port',
      programme: '45 LLTS — 3 737 m²',
      thumb: 'assets/thumbs/envirobat/fiche-les-mahots-le-port-2019.jpg',
      pdf: 'https://cdn.s-pass.org/SPASSDATA/attachments/2020_03/25/5f7f4dd1d5c0f-d77775.pdf',
      url: 'https://www.envirobat-reunion.com/fr/portail/357/observatoire/49223/fiche-envirobat-reunion-operation-les-mahots-le-port-co-architectes-2019.html',
      tags: ['acoustique vs ventilation', 'mur antibruit chicanes', 'RTAA DOM', 'ZAC'],
      resume: 'Dilemme ventilation/acoustique en milieu urbain résolu : implantation ⊥ voie + mur antibruit chicanes laissant passer l\u2019air.',
      phases: ['p04', 'p05', 'p07']
    },
    {
      id: 'ecole-denise-salai',
      titre: 'École Denise Salaï',
      archi: 'NEO Architectes · 2018',
      commune: 'Saint-Benoît',
      programme: 'Maternelle 12 classes — 300 élèves',
      thumb: 'assets/thumbs/envirobat/fiche-ecole-denise-salai-saint-benoit-2019.jpg',
      pdf: 'https://cdn.s-pass.org/SPASSDATA/attachments/2020_03/25/5f7f4dd051f7a-d77734.pdf',
      url: 'https://www.envirobat-reunion.com/fr/portail/357/observatoire/49217/fiche-envirobat-reunion-ecole-maternelle-denise-salai-saint-benoit-neo-architectes-2019.html',
      tags: ['forme proue', 'alizé', 'PERENE zone 2', 'cour triangulaire'],
      resume: "Forme de proue dans l'alizé (côte au vent). PERENE zone 2 volontaire. Cour triangulaire ventilée naturellement.",
      phases: ['p04', 'p07']
    },
    {
      id: 'hotel-region-saint-denis',
      titre: 'Hôtel de Région — Moufia',
      archi: 'Atelier Grouard · 2016',
      commune: 'Saint-Denis',
      programme: 'Tertiaire — 17 003 m² SU',
      thumb: 'assets/thumbs/envirobat/fiche-hotel-de-region-saint-denis-2019.jpg',
      pdf: 'https://cdn.s-pass.org/SPASSDATA/attachments/2019_10/17/5f7f4bbb5f1e4-d72226.pdf',
      url: 'https://www.envirobat-reunion.com/fr/portail/357/observatoire/46974/fiche-envirobat-reunion-restructuration-et-extension-de-lhotel-de-region-saint-denis-atelier-grouard-architectes-2019.html',
      tags: ['puits dépressionnaire', 'écope', 'HQE', 'PERENE', 'pyramide inversée'],
      resume: 'Rue intérieure = puits dépressionnaire + écope. HQE + PERENE 30% porosités. Ventilation naturelle R+5 tertiaire.',
      phases: ['p04', 'p07', 'p09']
    },
    {
      id: 'corem-le-port',
      titre: 'COREM / INNOVAL',
      archi: 'T&T Architecture · 2011',
      commune: 'Le Port',
      programme: 'Bureaux ossature bois — 721 m²',
      thumb: 'assets/thumbs/envirobat/fiche-corem-le-port-2011.jpg',
      pdf: 'https://cdn.s-pass.org/SPASSDATA/attachments/2019_10/16/5f7f4bb5db4d7-d72224.pdf',
      url: 'https://www.envirobat-reunion.com/fr/portail/357/observatoire/46944/fiche-envirobat-reunion-corem-le-port-t-t-architecture-2011.html',
      tags: ['ossature bois', 'Feng Shui', 'PREBAT', 'TEEO', 'patio caducs'],
      resume: 'Ossature bois + démarche Feng Shui = qualité environnementale. Patio arbres caducs, escalier-cheminée ventilation. PREBAT.',
      phases: ['p07', 'p09', 'p10']
    },
    {
      id: 'maison-parc-national',
      titre: 'Maison du Parc National',
      archi: 'AP Architectures + 2APMR · 2013',
      commune: 'Plaine des Palmistes',
      programme: 'Siège Parc National — 1 215 m²',
      thumb: 'assets/thumbs/envirobat/fiche-maison-parc-national-plaine-palmistes-2014.jpg',
      pdf: 'https://cdn.s-pass.org/SPASSDATA/attachments/2019_10/17/5f7f4bba48806-d72231.pdf',
      url: 'https://www.envirobat-reunion.com/fr/portail/357/observatoire/46970/fiche-envirobat-reunion-maison-du-parc-national-plaine-des-palmistes-antoine-perrau-architectures-2apmr-2014.html',
      tags: ['altitude 1000m', 'confort hiver', 'restauration écologique', 'endémiques', 'bois'],
      resume: "1 000 m d'altitude : confort d'hiver (11°C nuit). Restauration écologique préalable. Bâtiment en branches, 0 chauffage/clim.",
      phases: ['p06', 'p07', 'p09', 'p10']
    },
    {
      id: 'college-ouangani',
      titre: 'Collège de Ouangani',
      archi: 'Terreneuve · 2017-2019',
      commune: 'Ouangani, Mayotte',
      programme: 'Collège 1 128 élèves — 10 000 m²',
      thumb: 'assets/thumbs/envirobat/fiche-college-ouangani-mayotte-2020.jpg',
      pdf: 'https://cdn.s-pass.org/SPASSDATA/attachments/2021_04/26/80912-fiche-college-ouangani.pdf',
      url: 'https://www.envirobat-reunion.com/fr/portail/357/observatoire/54603/fiche-envirobat-reunion-college-de-ouangani-mayotte-terreneuve-2020.html',
      tags: ['Mayotte', 'terrasses décalées', 'topographie', 'tropical'],
      resume: 'Terrasses décalées épousant la topographie. Équilibre déblais/remblais. Vues Baie de Chiconi, Mont Bénara.',
      phases: ['p01', 'p07', 'p13']
    },
    {
      id: 'college-mandela',
      titre: 'Collège Nelson Mandela',
      archi: 'Co-Architectes · 2014',
      commune: 'Mamoudzou, Mayotte',
      programme: 'Extension KLH — 620 m²',
      thumb: 'assets/thumbs/envirobat/fiche-college-nelson-mandela-mayotte-2016.jpg',
      pdf: 'https://cdn.s-pass.org/SPASSDATA/attachments/2019/11/29/5f7f4c1a1bf17-d73471.pdf',
      url: 'https://www.envirobat-reunion.com/fr/portail/357/observatoire/47455/fiche-envirobat-reunion-college-nelson-mandela-mayotte-co-architectes-2016.html',
      tags: ['KLH', 'construction sèche', 'inondable', 'gradins enherbés', 'bois massif'],
      resume: 'Panneaux massifs KLH = construction sèche, chantier rapide. Surélevé 1 m (inondable). Gradins enherbés anti-bruit.',
      phases: ['p03', 'p07', 'p09', 'p13']
    }
  ];

  // Sélection des meilleures fiches par phase (ordre de pertinence)
  const PHASE_PICKS = {
    p01: ['college-ouangani'],
    p03: ['college-mandela'],
    p04: ['les-mahots-le-port', 'mediatheque-saint-leu', 'ecole-denise-salai', 'ecotole-saint-pierre'],
    p05: ['les-mahots-le-port', 'zac-coeur-ville-possession', 'olea-saint-pierre'],
    p06: ['maison-parc-national'],
    p07: ['mediatheque-saint-leu', 'ufr-sante-saint-pierre', 'ecole-denise-salai', 'hotel-region-saint-denis', 'agence-tt-saint-paul', 'corem-le-port'],
    p09: ['coarm-saint-denis', 'agence-tt-saint-paul', 'ecotole-saint-pierre', 'college-mandela'],
    p10: ['agence-tt-saint-paul', 'maison-parc-national', 'ecotole-saint-pierre', 'corem-le-port'],
    p11: ['coarm-saint-denis', 'agence-tt-saint-paul'],
    p13: ['college-ouangani', 'college-mandela']
  };

  function getForPhase(phaseId) {
    const picks = PHASE_PICKS[phaseId];
    if (!picks) return [];
    return picks.map(id => FICHES.find(f => f.id === id)).filter(Boolean);
  }

  function renderCard(fiche) {
    return `
      <div class="eb-card" data-id="${fiche.id}">
        <div class="eb-thumb" style="background-image:url('${fiche.thumb}')">
          <span class="eb-commune">${fiche.commune}</span>
        </div>
        <div class="eb-body">
          <div class="eb-titre">${fiche.titre}</div>
          <div class="eb-archi">${fiche.archi}</div>
          <div class="eb-programme">${fiche.programme}</div>
          <div class="eb-resume">${fiche.resume}</div>
          <div class="eb-tags">${fiche.tags.map(t => `<span class="eb-tag">${t}</span>`).join('')}</div>
          <div class="eb-actions">
            <a href="${fiche.url && fiche.url !== 'https://www.envirobat-reunion.com' ? fiche.url : fiche.pdf}"
               target="_blank" rel="noopener" class="eb-btn eb-btn-web">↗ Source web</a>
          </div>
        </div>
      </div>`;
  }

  function render(containerId, phaseId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const fiches = getForPhase(phaseId);
    if (!fiches.length) { el.style.display = 'none'; return; }
    el.innerHTML = `
      <div class="eb-header">
        <span class="eb-logo">enviroBAT</span>
        <span class="eb-subtitle">Retours d'expérience</span>
      </div>
      <div class="eb-scroll">${fiches.map(renderCard).join('')}</div>`;
  }

  return { render, getForPhase, FICHES };
})();

window.EnvirobatCards = EnvirobatCards;

}
