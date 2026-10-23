# Rapport de faisabilité FJT Mille Roches — INDICE 1 : scénario retenu, calqué sur la forme de l'ind 0 (A3 paysage, 10 pages, cartouche mgA / SEMAC)
# Une commande : python -I -X utf8 src/build_report_ind1.py   → report-ind1/rapport.html puis report-ind1/rapport-ind1.pdf
# Tout est relu depuis la planche BVE (result.json, pcmi.json, pièces SVG, GLB) : aucun chiffre du projet n'est écrit en dur dans ce script.
import json, os, re, shutil, subprocess, sys, datetime, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ind1_data as D
import plan_couleur_ind1 as PC
import sections_ind1 as SC
from shapely.geometry import Polygon, LineString

HERE, OUT, OLD, PL = D.HERE, D.OUT, D.OLD, D.PL
R, V, T, F, LG, Q = D.R, D.V, D.T, D.F, D.LG, D.Q
sep, f1, f2 = D.sep, D.f1, D.f2
os.makedirs(os.path.join(OUT, 'pieces'), exist_ok=True)
TODAY = datetime.date.today(); DATE = TODAY.strftime('%d/%m/%Y')
MOIS = ['JANVIER', 'FÉVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET', 'AOÛT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DÉCEMBRE'][TODAY.month - 1]
IND = 'ind 1 — scénario retenu · document de travail'
NODE = 'node'; SHOT = os.path.join(HERE, 'shot.cjs')

# ── données dérivées de la planche ──
lot = R['site']['area']; env = Q['env']['envArea']
nT1, nT1b, nT2 = (T['logements'].get(k, 0) for k in ('T1', 'T1bis', 'T2')); N = T['nLogts']
shab, su, sdp, empr = T['shab'], T['suAnnexes'], T['sdp'], T['emprise']
cib = LG.get('cibles', {}); c1, c1b, c2 = cib.get('T1s', 20), cib.get('T1bis', 30), cib.get('T2', 46)
m = re.search(r'SDP cible[^\d]*(\d[\d\s]*)', D.PJ['cartouche'].get('projet', '')); sdp_cible = int(m.group(1).replace(' ', '')) if m else None
hmin, hmax = R['site']['hmin'], R['site']['hmax']; felled, planted = V['felled'], V['planted']
need = R['parkingNeed']; par_use = ', '.join('%s %d' % (u['usage'], u['places']) for u in need['parUsage'])
BA = next(b for b in D.BLOCKS if b['name'] == 'Bât. A'); BB = next(b for b in D.BLOCKS if b['name'] == 'Bât. B')
fa_min = min(b['faitage'] for b in D.BLOCKS); fa_max = max(b['faitage'] for b in D.BLOCKS)
rdc_min = min(b['rdc'] for b in D.BLOCKS); h_tot = max(b['faitage'] - b['rdc'] for b in D.BLOCKS)
sidr_part = next((p for p in R['division']['parts'] if p['id'] != R['site']['id']), None)
sidr_area = sidr_part['area'] if sidr_part else None
def annexe_su(group): return sum(a['su'] for b in F['batiments'] for n in b['niveaux'] for a in n['annexes'] if a['group'] == group)
def annexe_ext(group): return sum((a.get('ext') or 0) for b in F['batiments'] for n in b['niveaux'] for a in n['annexes'] if a['group'] == group)
mle_su, creche_su, creche_ext = annexe_su('Pôle admin MLE'), annexe_su('Micro-crèche'), annexe_ext('Micro-crèche')
salle = next((a['su'] for b in F['batiments'] for n in b['niveaux'] for a in n['annexes'] if a['short'] == 'Salle collective'), None)
parks = V.get('parks', []); p_haut = parks[0]['places'] if parks else 0
p_allee = R.get('allee', {}).get('places', 0); p_poche = R.get('pocheRue', {}).get('places', 0); p_autre = V['parkTotal'] - p_haut - p_allee - p_poche
FEN, FESP, FSRC = D.scenario_fences(); fences = FEN; studio_ecarts = D.studios_status()

# ── copies de ressources ──
for f in ['semac.jpg', 'terlab_coupeA.png', 'terlab_coupeB.png', 'terlab_topo.png', 'plu_zonage_bh513.png']: shutil.copy(os.path.join(OLD, f), os.path.join(OUT, f))
for f in ['situation-quartier.jpg', 'situation-commune.jpg', 'situation.jpg']: shutil.copy(os.path.join(PL, 'situation', f), os.path.join(OUT, f))
shutil.copy(os.path.join(PL, 'img', '07-heliodon.png'), os.path.join(OUT, 'heliodon.png'))
import clean_views
for f in ['aerienne-nano-2', 'rue-nano-1', 'cour-nano-1', 'parking-nano-1']: shutil.copy(os.path.join(PL, 'pers', f + '.png'), os.path.join(OUT, f + '.png'))   # perspectives Nano Banana retenues par Mathias (22/10), depuis les vues de base validées
for f in ['08-v1-iso', '09-best-ensemble', '10-best-rue']: clean_views.clean(os.path.join(PL, 'img', f + '.png'), os.path.join(OUT, f + '.png'))   # retire les pastilles « arbre abattu » de l'éditeur
for p in ['plan-masse', 'plan-masse-v1', 'appartement-T1s', 'appartement-T2', 'appartement-T1bis']:
    if os.path.exists(os.path.join(D.PIECES, p + '.svg')): shutil.copy(os.path.join(D.PIECES, p + '.svg'), os.path.join(OUT, 'pieces', p + '.svg'))
old = open(os.path.join(OLD, 'rapport.html'), encoding='utf-8').read()
TERR = re.findall(r'<svg.*?</svg>', [s for s in old.split('<section') if 'Coupe paysagère' in s][0], re.S)[0]   # coupe territoriale de l'ind 0

# ── pièces générées ──
print('plan masse coloré…'); pc_info = PC.build(os.path.join(OUT, 'plan_couleur.svg'))
print('coupes et façades…'); SC.build(OUT)
print('plans RDC / R+1 recadrés…')
crop_json = os.path.join(OUT, '_crop.json'); srcs = [os.path.join(D.PIECES, 'dessin-v1-niveau-%s.svg' % n) for n in ('RDC', 'R1')]
subprocess.run([NODE, os.path.join(HERE, 'crop_bbox.cjs'), crop_json] + srcs, check=True, timeout=120)
CR = json.load(open(crop_json))
def cropped(src, name, margin=55):
    c = CR[src]; x0, y0, x1, y1 = c['x0'] - margin, c['y0'] - margin, c['x1'] + margin, c['y1'] + margin; s = open(src, encoding='utf-8').read()
    s = re.sub(r'viewBox="[^"]*" width="[^"]*" height="[^"]*"', 'viewBox="%.1f %.1f %.1f %.1f"' % (x0, y0, x1 - x0, y1 - y0), s, 1)
    open(os.path.join(OUT, 'pieces', name), 'w', encoding='utf-8').write(s); return (x1 - x0) / (y1 - y0)
ar_rdc = cropped(srcs[0], 'plan-RDC.svg', 125); ar_r1 = cropped(srcs[1], 'plan-R1.svg')

# ── HTML ──
def page(num, title, body, cls=''):
    return ('<section class="page %s"><div class="body">%s</div>'
            '<footer><div class="mga"><span>Mathias Giraud Architecture</span><b>mgA.</b></div><img class="sm" src="semac.jpg">'
            '<div class="ef">Étude de faisabilité<br><b>FJT · BH 513 · Saint-André</b></div><div class="pt">%s</div>'
            '<div class="no"><b>%s</b><span>%s</span></div></footer></section>') % (cls, body, title, num, DATE)
def img(p, cap, cls=''): return '<figure class="%s"><img src="%s"><figcaption>%s</figcaption></figure>' % (cls, p, cap)
def inline(path): return open(path, encoding='utf-8').read()

prog_txt = '%d T1 de %s m², %d T1 bis de %s m², %d T2 de %s m²' % (nT1, '%.0f' % c1, nT1b, '%.0f' % c1b, nT2, '%.0f' % c2)
KV = ('<table class=kv>'
  '<tr><td>Assiette FJT (après division SIDR)</td><td>%s m²</td></tr><tr><td>Enveloppe constructible (reculs 3 / 4 / 4 m, hors B2u)</td><td>%s m²</td></tr>'
  '<tr><td>Logements</td><td>%d (%d T1 · %d T1 bis · %d T2)</td></tr><tr><td>Surface habitable (SHAB)</td><td>%s m²</td></tr>'
  '<tr><td>Locaux annexes (SU) : communs FJT, micro-crèche, pôle MLE</td><td>%s m²</td></tr><tr><td>Surface de plancher</td><td>%s m²%s</td></tr>'
  '<tr><td>Emprise bâtie</td><td>%s m² (%d %%)</td></tr><tr><td>Hauteur</td><td>R+%d · faîtage %s à %s m NGR (≈ %s m)</td></tr>'
  '<tr><td>Stationnement</td><td>%d pl. pour %d (%s)</td></tr><tr><td>Arbres</td><td>%d abattus · %d replantés</td></tr></table>') % (
  sep(lot), sep(env), N, nT1, nT1b, nT2, sep(shab), sep(su), sep(sdp), (' (cible %s)' % sep(sdp_cible)) if sdp_cible else '', sep(empr), round(100 * empr / lot),
  BA['nlev'] - 1, f2(fa_min), f2(fa_max), f1(h_tot), V['parkTotal'], need['total'], par_use, felled, planted)

P = []
# ── couverture : emplacement de perspective ; en attendant, meilleure vue 3D de la planche, légendée « vue provisoire »
P.append('''<section class="page cover"><div class="hero" style="background-image:url(aerienne-nano-2.png)"></div><div class="herocap">Image d'ambiance générée par IA à partir de la maquette 3D — non contractuelle</div>
<div class="ct"><img src="semac.jpg" class="lg"><div class="k">Étude de faisabilité · capacité</div>
<h1>Foyer de Jeunes Travailleurs<br><span>Mille Roches, Saint-André</span></h1><div class="ind">%s<br>%s %d</div>
<dl><dt>Adresse</dt><dd>573 chemin Mille Roches, 97440 Saint-André</dd><dt>Cadastre</dt><dd>BH 513 pour partie — partie est, ≈ %s m²</dd>
<dt>Programme</dt><dd>FJT %d logements LLTS · communs · pôle administratif MLE · micro-crèche 12 places — exploitant MLE</dd>
<dt>Zone PLU</dt><dd><b>Ue</b> — équipements (PLU approuvé le 02/07/2025) · hébergement interdit : évolution du PLU requise</dd><dt>PPRN</dt><dd>B3 inondation · B2u en limite est</dd>
<dt>Dossier</dt><dd>%s</dd></dl></div>
<div class="mga big"><span>Mathias Giraud Architecture</span><b>mgA.</b></div></section>''' % (IND, MOIS, TODAY.year, sep(lot), N, D.PJ['cartouche'].get('dossier', 'MGA-26-04')))

# ── A.1 situation et cadre
P.append(page('A.1', 'Situation et cadre règlementaire', '''
<div class="g2"><div><div class="fig tall"><img class=cover-img src="situation-commune.jpg"><div class="cap">Situation — commune de Saint-André, orthophoto IGN (Géoplateforme) · parcelle BH 513 (étoile)</div></div>
<div class="g3 mt"><figure><img src="terlab_coupeA.png"><figcaption>Profil longitudinal LiDAR (Δ 5 m · 5,7 %%)</figcaption></figure>
<figure><img src="terlab_coupeB.png"><figcaption>Profil transversal LiDAR (Δ 2 m · 2,7 %%)</figcaption></figure>
<figure><img src="terlab_topo.png"><figcaption>Courbes 1 m — IGN RGE ALTI</figcaption></figure></div></div>
<div class="txt">
<h3>Le site</h3><p>Friche arborée au cœur du quartier Mille Roches (NPNRU), bordée au sud et à l'est par le chemin Mille Roches, au nord par un tissu de cases et de petits collectifs, à l'ouest par le lot A cédé à la SIDR. Plateau quasi plan entre <b>%s et %s m NGR</b> ; la limite est surplombe une ravine (talus, bande B2u). Climat de la côte au vent : <b>alizés d'est</b>, pluviométrie ≈ <b>2 365 mm/an</b>.</p>
<h3>Risques — PPRN Saint-André (BRGM 2026)</h3><ul><li><b>B3 — inondation, prescriptions</b> : planchers calés au-dessus de la cote de référence ; <b>pas de sous-sol</b> ; clôtures transparentes hydrauliquement.</li>
<li><b>B2u — inondation + mouvement de terrain</b> : couloir de la ravine en limite est, laissé libre de construction (+ 1 m).</li><li>Zone rouge <b>R1</b> au sud-est, hors parcelle.</li></ul>
<h3>PLU approuvé le 02/07/2025 — zone Ue</h3>
<p class=warn><b>Point bloquant</b> — en Ue, la sous-destination <b>« hébergement » est interdite</b>. Un FJT relève de l'hébergement (« foyers de travailleurs », art. R151-28). Le projet — comme l'opération SIDR voisine — suppose une <b>évolution du PLU</b> (modification ou déclaration de projet, reclassement en Ub), ou une qualification en équipement d'intérêt collectif à faire valider par le service instructeur.</p>
<p>Règles Ue retenues : hauteur <b>%d m</b> (R+%d conforme : faîtage ≈ %s m au-dessus du RDC) ; recul <b>%s m</b> sur voie ; <b>%s m</b> sur limites séparatives et de fond ; pas de blanc en paroi ni de tôle non peinte.</p>
<h3>Programme (note Konseyali du 06/10, validée MLE le 07/10)</h3><ul><li>FJT : <b>%d logements</b> — %s, produit LLTS</li><li>Communs FJT : salle d'activités et cuisine, buanderie, sanitaires, bureaux de coordination, hall, locaux vélos et poubelles</li><li><b>Pôle administratif MLE</b> %s m² et <b>micro-crèche</b> 12 places %s m² + %s m² extérieurs — réintégrés dans l'assiette</li><li>R+3 maximum ; stationnement 1 place / 3 logements + besoins MLE et crèche</li></ul>
</div></div>''' % (f1(hmin), f1(hmax), R['site']['zonage']['hMax'], BA['nlev'] - 1, f1(h_tot), R['site']['zonage']['retraits']['avant'], R['site']['zonage']['retraits']['cote'], N, prog_txt, sep(mle_su), sep(creche_su), sep(creche_ext))))

# ── A.2 assiette
P.append(page('A.2', 'Assiette foncière — division SIDR / FJT', '''
<div class="g2 w60"><div><div class="fig"><img src="situation-quartier.jpg" style="width:100%%;display:block"><div class="cap">Assiette FJT (orange) — partie est de BH 513, après cession du lot A à la SIDR (à l'ouest)</div></div></div>
<div class="txt"><h3>Ce qui a changé depuis l'ind 0</h3><p>L'ind 0 supposait le lot SIDR en bande nord. Le permis de construire de la SIDR (« Opération Sirandane », NKN architecture, déposé le 30/09/2026 — 25 LLS R+3, 935 m² d'emprise) fixe le <b>lot A à l'ouest</b> : limite nord 33,86 m, ouest 46,70 m, est 62,50 m (nouvelle limite), sud 24,87 + 16,05 m sur le chemin.</p>
<h3>Assiette retenue</h3><ul><li>Lot A SIDR ≈ %s m² (reconstitué depuis les cotes du PC).</li><li><b>Assiette FJT ≈ %s m²</b> : façade sud sur le chemin Mille Roches, est sur le chemin et la ravine (B2u), nord sur les cases.</li>
<li>Bâtiments SIDR C et D (R+3, ≈ 12,5 m) à 3 m de la limite commune : vis-à-vis pris en compte dans l'implantation.</li><li>Les eaux usées de la SIDR sortent à l'angle nord-est du lot A : <b>servitude de réseaux</b> le long de la limite nord de l'assiette FJT.</li></ul>
<p class=warn><b>À confirmer</b> avec la SEMAC, NKN et le géomètre : plan de division (non transmis), tracé de la servitude, cote de référence PPRN.</p>
<h3>Enveloppe constructible FJT</h3><table class=kv><tr><td>Assiette FJT</td><td>%s m²</td></tr><tr><td>Reculs Ue : voie 3 m · limites 4 m</td><td>—</td></tr><tr><td>Hors B2u (+1 m)</td><td>—</td></tr><tr><td><b>Enveloppe constructible</b></td><td><b>%s m²</b></td></tr></table>
<div class="g2 mt"><figure><img src="plu_zonage_bh513.png"><figcaption>PLU 2025 — zonage Ue de BH 513 · planche n°2</figcaption></figure><figure><img src="heliodon.png"><figcaption>Héliodon TERLAB — ensoleillement de l'assiette</figcaption></figure></div>
</div></div>''' % (sep(sidr_area) if sidr_area else '2 005', sep(lot), sep(lot), sep(env))))

# ── A.3 scénario retenu (mise en page « Variante 1 » de l'ind 0 : plan à gauche, principe, chiffres clés, petites vues)
P.append(page('A.3', 'Scénario retenu — deux lames et parking en haut de parcelle', '''
<div class="g2 w60"><div class="fig white"><img src="pieces/plan-masse.svg"><div class="cap">Scénario retenu — plan masse coté (BVE)</div></div>
<div class="txt"><h3>Principe</h3><p>Deux lames R+%d à coursives, orientées nord-nord-est / sud-sud-ouest, tenues à distance du lot SIDR, autour d'une <b>cour plantée</b> réservée aux résidents. Le <b>stationnement</b> est regroupé en haut de parcelle, à 1,5 m des limites, desservi depuis le chemin à l'est ; les deux lames se prolongent au-dessus de ce parking (A' et B', sur poteaux) jusqu'à leurs escaliers et ascenseurs, reliés par une passerelle.</p>
<ul><li><b>Bât. A</b> (est) : micro-crèche au RDC (entrée à l'est, jardin de %s m²), services FJT et salle collective au sud ; logements aux étages.</li>
<li><b>Bât. B</b> (ouest) : bureaux FJT au nord et <b>pôle administratif MLE</b> au sud (accueil du public sur le chemin) ; logements aux étages.</li>
<li>Entrées séparées : résidence à l'est près de l'accès véhicules, crèche à l'est, public MLE au sud-ouest ; partie clôturée MLE + services FJT au RDC.</li>
<li>RDC calé au-dessus du terrain naturel (B3), sans sous-sol ; toitures 4 pans à 22°, débords 0,80 m.</li></ul>
<h3>Chiffres clés</h3>%s
<div class="g2 mt"><figure><img src="parking-nano-1.png"><figcaption>Depuis l'accès véhicules — stationnement sous A' et B' (IA, non contractuelle)</figcaption></figure><figure><img src="cour-nano-1.png"><figcaption>La cour entre les lames (IA, non contractuelle)</figcaption></figure></div></div></div>''' % (BA['nlev'] - 1, sep(creche_ext), KV)))

# ── A.4 plan masse coloré (même gabarit pour la variante R+2, A.10)
def plan_page(num, title, svg_path, pc, fsrc, note_scen):
    src_txt = {'sonde-clotures': "clôtures d'après la sonde des clôtures du FJT final (cloture-fjt-resultat.json), en attendant leur export dans result.json", 'planche': "clôtures d'après le projet BVE"}.get(fsrc, 'clôtures indicatives')
    return page(num, title, '''
<div class="planrow"><div class="plancol">%s</div>%s</div>
<p class=note>Orthophoto IGN (Géoplateforme, 2026) · repère maquette, RGR92 UTM 40S · échelle 1/500 sur A3 (barre graphique : 20 m) · %s d'après la sonde BVE · voisins SIDR d'après le PC (NKN, sept. 2026) · %s · fonctions et teintes des espaces : catalogue USAGES de BVE.</p>''' % (inline(svg_path), pc['legend'], note_scen, src_txt), 'planpage')
P.append(plan_page('A.4', 'Plan masse coloré — 1/500', os.path.join(OUT, 'plan_couleur.svg'), pc_info, FSRC, 'lames et prolongements sur poteaux'))

# ── A.5 plans RDC et étage courant (+ logements types)
todo5 = ''
if studio_ecarts:
    todo5 = '<p class=warn><b>TODO — plans de cellules à régénérer</b> : %s. Les plans ci-dessus ne sont pas encore conformes au programme du tableau de surfaces.</p>' % ' ; '.join(studio_ecarts)
t1b_fig = img('pieces/appartement-T1bis.svg', 'T1 bis') if os.path.exists(os.path.join(OUT, 'pieces', 'appartement-T1bis.svg')) else '<div class="todo">TODO — plan type du T1 bis (%d au programme) : pièce absente de la planche</div>' % nT1b
P.append(page('A.5', 'Rez-de-chaussée et étage courant', '''
<div class="g2 eq"><figure class="pl"><img src="pieces/plan-RDC.svg"><figcaption>Rez-de-chaussée (± 0,00 : %s à %s m NGR) — communs FJT, micro-crèche, pôle MLE, salle collective ; parking sous A' et B'</figcaption></figure>
<figure class="pl"><img src="pieces/plan-R1.svg"><figcaption>Étage courant, R+1 (+ 3,00) — logements en travées, coursives sur la cour</figcaption></figure></div>
<div class="types3 mt"><figure><img src="pieces/appartement-T1s.svg"><figcaption>T1 (cible %s m²)</figcaption></figure>%s<figure><img src="pieces/appartement-T2.svg"><figcaption>T2 (cible %s m²)</figcaption></figure></div>%s
<p class=note>Plans de la planche BVE, recadrés sur les bâtiments (échelle ≈ 1/250) ; trame 0,30 m ; profondeur utile 5,70 m ; varangue 1,20 m sur l'extérieur pour chaque logement.</p>''' % (f2(rdc_min), f2(max(b['rdc'] for b in D.BLOCKS)), '%.0f' % c1, t1b_fig, '%.0f' % c2, todo5), 'plans'))

# ── A.6 coupes et façades urbaines
P.append(page('A.6', 'Coupes et façades urbaines', '''
<div class="sec"><div class="cap">Coupe AA — transversale au droit des deux lames (regard vers le nord-nord-est) · lot SIDR à gauche (ouest), chemin Mille Roches à droite (est)</div>%s</div>
<div class="sec"><div class="cap">Façade urbaine est — depuis le chemin Mille Roches (regard vers l'ouest-nord-ouest) · lames A et B en premier plan, A' et B' sur poteaux au fond</div>%s</div>
<div class="sec"><div class="cap">Façade urbaine sud — depuis le chemin Mille Roches (regard vers le nord)</div>%s</div>
<p class=note>Terrain naturel : maillage de la maquette (IGN RGE ALTI / LiDAR HD), trait fort · bâti existant : IGN BD TOPO (hauteurs mesurées), voisins SIDR d'après le PC, trait gris selon la profondeur · arbres : LiDAR HD, %d abattus ôtés · projet : RDC %s à %s m NGR, niveaux de %s m, toitures 4 pans 22°, débord 0,80 m · cotes en m NGR · %s.</p>''' % (
    inline(os.path.join(OUT, 'coupe_AA.svg')), inline(os.path.join(OUT, 'facade_est.svg')), inline(os.path.join(OUT, 'facade_sud.svg')), felled, f2(rdc_min), f2(max(b['rdc'] for b in D.BLOCKS)), f2(BA['hEtage']), ('façades en élévation au trait noir et blanc, projetées depuis le GLB détaillé de la maquette (arêtes vives seulement ; vitrages en gris, toitures hachurées dans le sens de la pente)' if SC.GL.has_detail() else 'baies indicatives (travée 3,60 m)')), 'sections'))

# ── A.7 coupe paysagère
P.append(page('A.7', 'Coupe paysagère', """
<div class="sec wide"><div class=cap>Coupe territoriale des Hauts à l'océan (≈ 10 km, axe OSO → ENE) — échelle ≈ 1/25 000, hauteurs ×3</div>%s</div>
<div class="g2 mt"><div class=txt><h3>Lecture</h3><p>Mille Roches est posé à mi-pente (≈ 116 m NGR) entre les Hauts de Saint-André et le littoral, sur le rebord d'un plateau ; à l'est un talus d'une dizaine de mètres (ravine, B2u) descend vers la plaine de la Rivière du Mât.</p>
<p>Les deux lames R+%d (faîtage %s à %s m NGR) restent dans l'épannelage des collectifs voisins, dont les bâtiments SIDR R+3, et sous la ligne des grands arbres du talus.</p></div>
<div class=txt><h3>Conséquences pour le projet</h3><ul><li>Conserver la <b>lisière arborée du talus</b> (B2u non bâtie) : filtre visuel et hydraulique.</li><li>%d arbres abattus, %d replantés (cour, abords du parking).</li><li>Eaux pluviales gérées à la parcelle avant le talus — pas de rejet direct dans la pente.</li></ul></div></div>""" % (TERR, BA['nlev'] - 1, f2(fa_min), f2(fa_max), felled, planted)))

# ── A.8 vues (emplacements réservés)
def vue(src, cap, cls='', pos='center'):
    return '<figure class="%s"><div class="vimg"><img src="%s" style="object-position:%s"></div><figcaption>%s</figcaption></figure>' % (cls, src, pos, cap)
P.append(page('A.8', 'Vues', '''
<div class="persp">%s%s%s</div>
<p class=note>Vues de la maquette 3D BVE (IGN BD TOPO, RGE ALTI, LiDAR HD, orthophoto IGN), volumétries indicatives. Perspectives d'ambiance générées par IA (Leonardo, Nano Banana) à partir des vues de base de la maquette détaillée, contrôlées avant génération (baies, varangues, coursives, toitures 4 pans, RDC réel, clôtures) : images <b>non contractuelles</b>, matériaux et ambiance indicatifs.</p>''' % (
    vue('aerienne-nano-2.png', 'Vue aérienne depuis le sud-ouest — les deux lames, le stationnement en haut de parcelle, la cour plantée', 'big'),
    vue('rue-nano-1.png', 'Depuis le chemin Mille Roches — clôture sur voie, entrée piétonne'),
    vue('cour-nano-1.png', 'La cour entre les lames — coursives, passerelles, clôture ajourée de la cour')), 'vues'))

# ── A.9 surfaces et vigilance
def niveau_dest(n):
    parts = (['Logements'] if n['logements'] else []) + sorted({a['group'] for a in n['annexes']}, key=lambda g: g)
    if n.get('parking'): parts = ['Rez-de-chaussée sur poteaux — stationnement']
    return ' · '.join(parts) if parts else '—'
def surf_rows(Fb, N, nT1, nT1b, nT2, shab, su, sdp):
    rows = ''
    for b in Fb['batiments']:
        for n in sorted(b['niveaux'], key=lambda n: ['RDC', 'R+1', 'R+2', 'R+3', 'R+4'].index(n['level']) if n['level'] in ['RDC', 'R+1', 'R+2', 'R+3', 'R+4'] else 9):
            lg = n['logements']; a1, a1b, a2 = lg.get('T1', 0), lg.get('T1bis', 0), lg.get('T2', 0)
            cell = lambda v: v if v else '—'
            rows += '<tr><td>%s</td><td>%s</td><td>%s</td><td class=n>%s</td><td class=n>%s</td><td class=n>%s</td><td class=n>%s</td><td class=n>%s</td><td class=n>%s</td></tr>' % (
                b['name'], n['level'], niveau_dest(n), cell(a1), cell(a1b), cell(a2), f1(n['shab']) if n['shab'] else '—', f1(n['su'] - n['shab']) if n['su'] - n['shab'] > 0.05 else '—', f1(n['sdp']) if n['sdp'] else '—')
        bt = b['totaux']; lg = bt['logements']
        rows += '<tr class=sub><td colspan=3>Total %s</td><td class=n>%d</td><td class=n>%d</td><td class=n>%d</td><td class=n>%s</td><td class=n>%s</td><td class=n>%s</td></tr>' % (b['name'], lg.get('T1', 0), lg.get('T1bis', 0), lg.get('T2', 0), f1(bt['shab']), (f1(bt['suAnnexes']) if bt['suAnnexes'] else '—'), f1(bt['sdp']))
    rows += '<tr class=tot><td colspan=3>TOTAL — %d logements</td><td class=n>%d</td><td class=n>%d</td><td class=n>%d</td><td class=n>%s</td><td class=n>%s</td><td class=n>%s</td></tr>' % (N, nT1, nT1b, nT2, f1(shab), f1(su), f1(sdp))
    return rows
rows = surf_rows(F, N, nT1, nT1b, nT2, shab, su, sdp)
synth = ('<table class=grid><tr><th>Type</th><th>Nombre</th><th>Surface cible</th><th>SHAB cible cumulée</th></tr>'
         '<tr><td>T1</td><td class=n>%d</td><td class=n>%s m²</td><td class=n>%s m²</td></tr><tr><td>T1 bis</td><td class=n>%d</td><td class=n>%s m²</td><td class=n>%s m²</td></tr><tr><td>T2</td><td class=n>%d</td><td class=n>%s m²</td><td class=n>%s m²</td></tr></table>') % (
    nT1, '%.0f' % c1, sep(nT1 * c1), nT1b, '%.0f' % c1b, sep(nT1b * c1b), nT2, '%.0f' % c2, sep(nT2 * c2))
def fence_metre():
    if not fences: return '<tr><td>Clôtures</td><td class=n>—</td><td><b>TODO</b> : métré non fourni (pas de données « fence »)</td></tr>'
    L = {}; nb = {}; og = {}
    for f in fences:
        L[f['modele']] = L.get(f['modele'], 0) + D.poly_len(f['pts']); nb[f['modele']] = nb.get(f['modele'], 0) + 1
        for g in f['gates']: og[g['kind']] = og.get(g['kind'], 0) + 1
    nm = {'grillage-haie': 'grillage doublé d\'une haie', 'grille-bahut-haie': 'grille sur bahut doublée d\'une haie'}
    r = ''.join('<tr><td>Clôture — %s</td><td class=n>%s ml</td><td>%d tronçon(s)</td></tr>' % (nm.get(k, k), sep(v), nb[k]) for k, v in L.items())
    r += '<tr><td>Ouvertures</td><td class=n>%d</td><td>%s</td></tr>' % (sum(og.values()), ' · '.join('%d %s' % (v, k) for k, v in og.items()))
    if FSRC == 'sonde-clotures': r += '<tr><td colspan=3><b>TODO</b> : métré issu de la sonde des clôtures ; à relire dans result.json après régénération.</td></tr>'
    return r
synt2 = ('<table class=grid>'
  '<tr><td>Logements</td><td class=n>%d</td><td>%d T1 + %d T1 bis + %d T2</td></tr>'
  '<tr><td>Surface habitable (SHAB)</td><td class=n>%s m²</td><td>moyenne %s m² / logement</td></tr>'
  '<tr><td>Locaux annexes (SU)</td><td class=n>%s m²</td><td>communs FJT, micro-crèche %s m², pôle MLE %s m²</td></tr>'
  '<tr><td>Surface de plancher</td><td class=n>%s m²</td><td>%s</td></tr>'
  '<tr><td>Ratio SHAB / SDP</td><td class=n>%s</td><td>coursives extérieures hors SDP</td></tr>'
  '<tr><td>Emprise bâtie</td><td class=n>%s m²</td><td>%d %% de l\'assiette (CES maximal %s)</td></tr>'
  '<tr><td>Stationnement</td><td class=n>%d pl.</td><td>besoin %d (%s) · haut de parcelle %d · allée %d · chemin %d · autres %d</td></tr>'
  '<tr><td>Arbres</td><td class=n>%d / %d</td><td>abattus / replantés</td></tr>%s</table>') % (
  N, nT1, nT1b, nT2, f1(shab), f1(shab / N), f1(su), sep(creche_su), sep(mle_su), f1(sdp), ('cible %s m² (%+d %%)' % (sep(sdp_cible), round(100 * (sdp / sdp_cible - 1)))) if sdp_cible else '', f2(shab / sdp),
  sep(empr), round(100 * empr / lot), R['site']['zonage'].get('ces', '—'), V['parkTotal'], need['total'], par_use, p_haut, p_allee, p_poche, p_autre, felled, planted, fence_metre())
# points de vigilance : fixes + alertes lues dans la planche
alertes = [a['msg'] for a in (Q.get('alertes') or [])] + [a['msg'] for a in (R.get('reserve', {}).get('alertes') or [])] + [v['msg'] for v in F['verdicts'] if v['level'] not in ('ok', 'info')]
alertes = list(dict.fromkeys(alertes))
vig = ['<li><b>PLU 2025 — zone Ue</b> : l\'hébergement (FJT) y est <b>interdit</b>. Évolution du PLU à engager avec la Ville, en commun avec l\'opération SIDR.</li>',
       '<li><b>Assiette</b> : plan de division et servitude de réseaux à obtenir (SEMAC, NKN, géomètre).</li>',
       '<li><b>PPRN</b> : cote de référence B3 à obtenir ; l\'accès véhicules traverse la bande B2u : à faire valider.</li>',
       '<li><b>Stationnement</b> : %d places pour un besoin estimé de %d (MLE et crèche à confirmer avec l\'exploitant).</li>' % (V['parkTotal'], need['total']),
       '<li><b>Programme</b> : salle collective de %s m² à confirmer ; place du pôle MLE et de la micro-crèche validée sur le principe.</li>' % (sep(salle) if salle else '—'),
       '<li><b>Topographie</b> : relevé géomètre à commander ; l\'étude repose sur le LiDAR HD IGN (≈ 10 cm).</li>']
if alertes: vig.append('<li><b>Alertes de la sonde BVE</b> : %s.</li>' % ' ; '.join(alertes))
if studio_ecarts: vig.append('<li><b>Plans de cellules</b> (TODO) : %s.</li>' % ' ; '.join(studio_ecarts))
if (R.get('circulationsOperation') or {}).get('rampes'): vig.append('<li><b>Rampes à 5 %%</b> (entrée est : %s m, 1 palier ; crèche : %s m) : à confirmer avec le terrassement.</li>' % tuple(f1(r['longueur']) for r in ([next(x for x in R['circulationsOperation']['rampes'] if 'logements' in x['allee']), next((x for x in R['circulationsOperation']['rampes'] if 'cr' in x['allee'] and 'pieton-cr' in x['allee']), R['circulationsOperation']['rampes'][-1])])))
_lg = next((v for v in ((R.get('circulationsOperation') or {}).get('verdicts') or []) if v['code'] == 'CIRC_OP_LARGEUR'), None)
if _lg:
    _n = re.search(r'(\d+) passage', _lg['msg']); _v = [float(x) for x in re.findall(r'([\d.]+) m < [\d.]+ m', _lg['msg'])]; _s = re.search(r'< ([\d.]+) m', _lg['msg'])
    vig.append('<li><b>Circulations</b> : %s passage(s) de raccord coursive / palier sous la largeur libre de %s m (minimum %s m) : à élargir ou à valider avec le bureau de contrôle.</li>' % (_n.group(1) if _n else '?', f2(float(_s.group(1))) if _s else '1,20', f2(min(_v)) if _v else '?'))
if FSRC == 'sonde-clotures': vig.append('<li><b>Clôtures</b> : %s ml au total (grillage-haie sur les limites et dans la cour, grille sur bahut sur la voie). Zone B3 : transparence hydraulique à vérifier sur la grille à bahut ; tracé issu de la sonde des clôtures, à relire dans result.json (TODO).</li>' % sep(sum(D.poly_len(f['pts']) for f in fences)))
elif not fences: vig.append('<li><b>Clôtures et espaces extérieurs</b> (TODO) : tracé et métré à reprendre depuis le projet BVE.</li>')
P.append(page('A.9', 'Tableau de surfaces et points de vigilance', '''
<div class="g2 w60"><div><h3>Programme par bâtiment et par niveau</h3><table class=grid><tr><th>Bât.</th><th>Niveau</th><th>Destination</th><th>T1</th><th>T1 bis</th><th>T2</th><th>SHAB m²</th><th>Annexes SU m²</th><th>SDP m²</th></tr>%s</table>
<h3 class=mt>Synthèse</h3>%s<div class=mt>%s</div>
<p class=note>SHAB : surface habitable ; SU annexes : communs FJT, micro-crèche, pôle MLE ; SDP : pré-dimensionnement ±10 %% (coursives hors SDP). Source : sonde BVE « opération collective », projet %s.</p></div>
<div class="txt"><h3>Points de vigilance</h3><ol>%s</ol>
<h3>Suite proposée</h3><ul><li>Réunion Ville / SEMAC / SIDR sur l'évolution du PLU.</li><li>Plans types T1, T1 bis et T2 calés sur le programme.</li><li>Estimation des travaux et montage (LLTS, FSE, bonus EPFR).</li><li>Perspectives d'ambiance contrôlées pour la présentation aux élus.</li></ul></div></div>''' % (
    rows, synt2, synth, D.PJ.get('cartouche', {}).get('dossier', ''), ''.join(vig)), 'surf'))

# ── Variante R+2 (appel client du 22/10) : A.10 plan masse coloré, A.11 tableau de surfaces et comparaison avec le scénario retenu ──
# Même chaîne que le scénario retenu : D.Scen(planche) → plan_couleur_ind1.build(…, S) ; les chiffres viennent des result.json / pcmi.json des deux planches.
PL_R2 = os.environ.get('FJT_PLANCHE_R2', 'C:/GITHUB/code-runner/docs/bve-pro/planches/standre-bh513-fjt-r2')
S2 = D.Scen(PL_R2)
print('plan masse coloré variante R+2…'); pc2 = PC.build(os.path.join(OUT, 'plan_couleur_r2.svg'), 'plan_ortho_r2.jpg', S2)

def facts(S):
    """Chiffres comparables d'une planche (scénario ou variante)."""
    T_, V_, R_, F_, Q_ = S.T, S.V, S.R, S.F, S.Q
    grp = {}
    for b in F_['batiments']:
        for n in b['niveaux']:
            for a in n['annexes']: grp[a['group']] = grp.get(a['group'], 0) + a['su']
    fa = [b['faitage'] for b in S.BLOCKS]; ht = max(b['faitage'] - b['rdc'] for b in S.BLOCKS)
    esp = ((R_.get('clotures') or {}).get('espaces') or {})
    rdc_logts = sum(sum(n['logements'].values()) for b in F_['batiments'] for n in b['niveaux'] if n['level'] == 'RDC')
    return dict(nlev=S.BLOCKS[0]['nlev'], N=T_['nLogts'], t1=T_['logements'].get('T1', 0), t1b=T_['logements'].get('T1bis', 0), t2=T_['logements'].get('T2', 0),
                shab=T_['shab'], sdp=T_['sdp'], su=T_['suAnnexes'], emprise=T_['emprise'], places=V_['parkTotal'], need=R_['parkingNeed']['total'],
                grp=grp, fa_min=min(fa), fa_max=max(fa), ht=ht, esp=esp.get('liste') or [], esp_aire=esp.get('aireExterieure') or 0, env=Q_['env']['envArea'], lot=R_['site']['area'],
                rdc_logts=rdc_logts, lens={b['name']: b['len'] for b in S.BLOCKS}, ces=R_['site']['zonage'].get('ces'))
f_ret, f_var = facts(D), facts(S2)
sg = lambda v, fmt: ('%+d' % round(v)) if fmt == 'i' else (('%+.1f' % v).replace('.', ',') if abs(v) >= 0.05 else '0')
def cmp_row(lab, a, b, unit='', fmt='i', bold=False):
    if a is None and b is None: return ''
    fa_, fb_ = (sep(a) if fmt == 'i' else f1(a)), (sep(b) if fmt == 'i' else f1(b))
    d = sg(b - a, fmt).replace('-', '−') if (fmt in ('i', 'f')) else ''
    if fmt == 'i' and round(b - a) == 0: d = '='
    u = (' ' + unit) if unit else ''
    return '<tr><td>%s</td><td class=n>%s%s</td><td class=n>%s%s</td><td class="n e">%s%s</td></tr>' % (lab, fa_, u, fb_, u, d, (u if d not in ('=', '') else ''))
def cmp_sec(lab): return '<tr class=sec><td colspan=4>%s</td></tr>' % lab
def cmp_ngr(lab, a0, a1, b0, b1):
    return '<tr><td>%s</td><td class=n>%s à %s</td><td class=n>%s à %s</td><td class="n e">%s m</td></tr>' % (lab, f2(a0), f2(a1), f2(b0), f2(b1), sg(((b0 + b1) - (a0 + a1)) / 2, 'f').replace('-', '−'))
GRP_LAB = {'Communs FJT': 'Communs FJT', 'Pôle admin MLE': 'Pôle administratif MLE', 'Micro-crèche': 'Micro-crèche', 'Extérieurs': 'Locaux vélos et poubelles'}
usage_aire = lambda f, u: sum(e['aire'] for e in f['esp'] if e['usage'] == u)
cmp_rows = ''.join([
    cmp_sec('Niveaux et logements'),
    cmp_row('Hauteur des lames (R+n)', f_ret['nlev'] - 1, f_var['nlev'] - 1, '', 'i'),
    cmp_row('Logements', f_ret['N'], f_var['N'], '', 'i', True), cmp_row('dont T1', f_ret['t1'], f_var['t1']), cmp_row('dont T1 bis', f_ret['t1b'], f_var['t1b']), cmp_row('dont T2', f_ret['t2'], f_var['t2']),
    cmp_row('Logements au RDC', f_ret['rdc_logts'], f_var['rdc_logts']),
    cmp_sec('Surfaces'),
    cmp_row('Surface habitable (SHAB)', f_ret['shab'], f_var['shab'], 'm²'), cmp_row('Surface de plancher (SDP)', f_ret['sdp'], f_var['sdp'], 'm²'),
    cmp_row('Emprise bâtie', f_ret['emprise'], f_var['emprise'], 'm²'),
    cmp_row('Locaux annexes (SU)', f_ret['su'], f_var['su'], 'm²', 'i', True)] +
    [cmp_row('— ' + GRP_LAB.get(g, g), f_ret['grp'].get(g, 0), f_var['grp'].get(g, 0), 'm²') for g in GRP_LAB if f_ret['grp'].get(g, 0) or f_var['grp'].get(g, 0)] + [
    cmp_sec('Stationnement'),
    cmp_row('Places', f_ret['places'], f_var['places']), cmp_row('Besoin estimé', f_ret['need'], f_var['need']), cmp_row('Places en excédent', f_ret['places'] - f_ret['need'], f_var['places'] - f_var['need']),
    cmp_sec('Hauteurs (m NGR)'),
    cmp_ngr('Faîtage des lames', f_ret['fa_min'], f_ret['fa_max'], f_var['fa_min'], f_var['fa_max']),
    cmp_row('Hauteur du faîtage au-dessus du RDC', f_ret['ht'], f_var['ht'], 'm', 'f'),
    cmp_sec('Espaces extérieurs (clôtures BVE)'),
    cmp_row('Espaces extérieurs de l\'assiette', f_ret['esp_aire'], f_var['esp_aire'], 'm²', 'i', True),
    cmp_row('— cour, jardin commun', usage_aire(f_ret, 'cour-residents'), usage_aire(f_var, 'cour-residents'), 'm²'),
    cmp_row('— équipement (MLE, services)', usage_aire(f_ret, 'equipement'), usage_aire(f_var, 'equipement'), 'm²'),
    cmp_row('— cour de la crèche', usage_aire(f_ret, 'cour-enfants'), usage_aire(f_var, 'cour-enfants'), 'm²'),
    cmp_row('Nombre d\'espaces', len(f_ret['esp']), len(f_var['esp']))])
cmp_html = '<table class=cmp><tr><th>Critère</th><th>Scénario retenu R+%d</th><th>Variante R+%d</th><th>Écart</th></tr>%s</table>' % (f_ret['nlev'] - 1, f_var['nlev'] - 1, cmp_rows)

# A.10 : plan masse coloré de la variante
P.append(plan_page('A.10', 'Variante R+%d — plan masse coloré 1/500' % (f_var['nlev'] - 1), os.path.join(OUT, 'plan_couleur_r2.svg'), pc2, 'planche', 'lames R+%d, parking du haut seul' % (f_var['nlev'] - 1)))

# A.11 : tableau de surfaces de la variante, comparaison, commentaire
V2, T2_, F2_ = S2.V, S2.T, S2.F
v_t1, v_t1b, v_t2 = (T2_['logements'].get(k, 0) for k in ('T1', 'T1bis', 'T2'))
rows2 = surf_rows(F2_, T2_['nLogts'], v_t1, v_t1b, v_t2, T2_['shab'], T2_['suAnnexes'], T2_['sdp'])
mle_r, cre_r = f_ret['grp'].get('Pôle admin MLE', 0), f_ret['grp'].get('Micro-crèche', 0)
bas = f_ret['places'] - f_var['places']
lm = f_var['lens']; a_len, b_len = lm.get('Bât. A'), lm.get('Bât. B')
txt_change = ('<h3>Ce qui change</h3><ul>'
    '<li><b>Un niveau de moins</b> : R+%d au lieu de R+%d, faîtage à %s–%s m NGR contre %s–%s (%s m au-dessus du RDC contre %s).</li>'
    '<li><b>Pôle MLE et micro-crèche retirés</b> : %s m² de locaux annexes en moins (MLE %s m², crèche %s m²) et la cour de la crèche (%s m²) ; les annexes ne sont plus que les communs FJT et les locaux techniques (%s m²).</li>'
    '<li><b>Logements au RDC</b> : %d logements au rez-de-chaussée, à côté des communs FJT.</li>'
    '<li><b>Parking du bas supprimé</b> : %d places en moins (%d contre %d), toutes en haut de parcelle (%s) ; une seule cour des résidents de %s m².</li>'
    '<li>Résultat : <b>%d logements</b> (%d T1, %d T1 bis, %d T2) au lieu de %d, SHAB %s m² (%s m²), SDP %s m² (%s m²).</li></ul>') % (
    f_var['nlev'] - 1, f_ret['nlev'] - 1, f2(f_var['fa_min']), f2(f_var['fa_max']), f2(f_ret['fa_min']), f2(f_ret['fa_max']), f1(f_var['ht']), f1(f_ret['ht']),
    sep(f_ret['su'] - f_var['su']), sep(mle_r), sep(cre_r), sep(usage_aire(f_ret, 'cour-enfants')), sep(f_var['su']),
    f_var['rdc_logts'], bas, f_var['places'], f_ret['places'], ' + '.join('%d %s' % (p['places'], {'reserve': 'sur la réserve', 'allee': "le long de l'allée"}.get(p.get('kind'), p.get('kind', ''))) for p in V2['parks']), sep(usage_aire(f_var, 'cour-residents')),
    f_var['N'], f_var['t1'], f_var['t1b'], f_var['t2'], f_ret['N'], sep(f_var['shab']), sep(f_ret['shab']), sep(f_var['sdp']), sep(f_ret['sdp']))
txt_plafond = ('<h3>Ce qui plafonne</h3><p>Le <b>stationnement n\'est pas limitant</b> : %d places pour un besoin de %d (%d en excédent). Ce sont <b>l\'enveloppe constructible</b> (%s m² pour une assiette de %s m², emprise bâtie %s m², soit %d %% de l\'enveloppe) et <b>la longueur des lames</b> (Bât. A %s m, Bât. B %s m, profondeur %s m) qui bornent le nombre de logements (reculs 3 / 4 / 4 m, hors B2u).</p>') % (
    f_var['places'], f_var['need'], f_var['places'] - f_var['need'], sep(f_var['env']), sep(f_var['lot']), sep(f_var['emprise']), round(100 * f_var['emprise'] / f_var['env']),
    f1(a_len), f1(b_len), f1(S2.BLOCKS[0]['depth']))
P.append(page('A.11', 'Variante R+%d — tableau de surfaces et comparaison' % (f_var['nlev'] - 1), '''
<div class="g2 w60"><div><h3>Variante R+%d : programme par bâtiment et par niveau</h3><table class=grid><tr><th>Bât.</th><th>Niveau</th><th>Destination</th><th>T1</th><th>T1 bis</th><th>T2</th><th>SHAB m²</th><th>Annexes SU m²</th><th>SDP m²</th></tr>%s</table>
<p class=note>SHAB : surface habitable ; SU annexes : communs FJT et locaux techniques ; SDP : pré-dimensionnement ±10 %% (coursives hors SDP). Source : sonde BVE « opération collective », projet %s.</p></div>
<div><h3>Scénario retenu et variante : comparaison</h3>%s</div></div>
<div class="g2 mt cmpTxt"><div class=txt>%s</div><div class=txt>%s</div></div>''' % (
    f_var['nlev'] - 1, rows2, S2.PJ.get('cartouche', {}).get('dossier', ''), cmp_html, txt_change, txt_plafond), 'surf'))

# ── A.12 Circulations : cartes de chaleur (plan de masse, R+1) lues dans la planche (pieces/circulations-{chaleur,pmr}-*.svg, result.json → circulationsOperation) ──
# 3 colonnes : scénario retenu (chemin le plus court), scénario retenu (parcours PMR, ascenseur seul), variante R+2 (chemin le plus court ; sans ascenseur, pas de carte PMR)
import circ_crop as CC
def circ_files(S, tag, kind='chaleur'):
    out = {}
    for n in ('masse', 'R1'):
        src = os.path.join(S.PIECES, 'circulations-%s-%s.svg' % (kind, n))
        if os.path.exists(src): CC.crop(src, os.path.join(OUT, 'pieces', 'circ-%s-%s-%s.svg' % (tag, kind, n))); out[n] = 'pieces/circ-%s-%s-%s.svg' % (tag, kind, n)
    return out
def mmss(t): return '%d min %02d' % (t // 60, t % 60) if t >= 60 else '%d s' % t
def circ_ver(C): return {v['code']: v for v in C['verdicts']}
def circ_largeur(C):
    lg = circ_ver(C).get('CIRC_OP_LARGEUR')
    if not lg: return ''
    mm = re.search(r'(\d+) passage', lg['msg']); vals = [float(x) for x in re.findall(r'([\d.]+) m < [\d.]+ m', lg['msg'])]; seuil = re.search(r'< ([\d.]+) m', lg['msg'])
    return '<tr><td>Largeur de raccord coursive / palier</td><td colspan=3><b>avertissement</b> : %s passage(s) sous %s m (minimum %s m)</td></tr>' % (mm.group(1) if mm else '?', f2(float(seuil.group(1))) if seuil else '1,20', f2(min(vals)) if vals else '?')
def asc_txt(C):
    A = C['ascenseur']; ou = ', '.join(b['bloc'] for b in A['blocs'] if b['ascenseurs'])
    return ('ascenseur <b>requis</b> au-delà de R+%d, %d présent%s' % (A['seuil'], A['present'], (' en ' + ou) if ou else '')) if A['requis'] else ('ascenseur <b>facultatif</b> jusqu\'à R+%d inclus, %d présent' % (A['seuil'], A['present']))
def circ_table(S, titre):
    """Chemin le plus court : répartition par entrée, distance maximale, tronçon le plus chargé, ascenseur, continuité, largeur."""
    C = S.R.get('circulationsOperation')
    if not C: return '<div class="todo">TODO — circulationsOperation absent du result.json</div>'
    ch = C['chaleur']; ver = circ_ver(C); us = {'logements': 'résidents'}
    rows = ''.join('<tr><td>%s</td><td>%d logements</td><td>%s m</td><td>%s</td></tr>' % ('portillon ' + ', '.join(us.get(u, u) for u in e['usages']), e['logements'], f1(e['distMax']), mmss(e['tMax'])) for e in ch['parEntree'])
    pl = ch['plusLoin']; pc = ch['plusChargee']; pb = ch.get('plusChargeeBatiment') or pc
    return ('<table class=cmp><tr><th colspan=4 style="text-align:left">%s</th></tr><tr class=sec><td colspan=4>Répartition par entrée (distance et temps maximaux portillon → porte)</td></tr>%s'
            '<tr><td>Distance maximale</td><td colspan=3>%s m, %s (%s)</td></tr><tr><td>Tronçon le plus chargé</td><td colspan=3>%s : %d logements%s</td></tr>'
            '<tr><td>Ascenseur</td><td colspan=3>%s</td></tr><tr><td>Continuité</td><td colspan=3>%s</td></tr>%s</table>') % (
        titre, rows, f1(ch['distMax']), pl['logement'].replace('’', "'"), mmss(pl['t']), pc['libelle'], pc['n'],
        ('' if pb['libelle'] == pc['libelle'] else ' ; dans les bâtiments : %s, %d' % (pb['libelle'], pb['n'])), asc_txt(C),
        ('<b>conforme</b> : %s' % ver['CIRC_OP_LOGEMENTS_ATTEINTS']['msg']) if C['conforme'] and 'CIRC_OP_LOGEMENTS_ATTEINTS' in ver else ('<b>non conforme</b>' if not C['conforme'] else 'conforme'), circ_largeur(C))
def rampes_groupes(C):
    """Une ligne par allée de rampe (les allées de même usage et de même géométrie sont regroupées)."""
    g = {}
    for r in C.get('rampes') or []:
        u = re.match(r'pieton-([^>]+)>', r['allee']); u = u.group(1) if u else '?'
        k = (u, round(r['longueur'], 1), r['paliers'], r['pente_pct'])
        g.setdefault(k, r)
    return list(g.items())
def pmr_table(S, titre):
    """Parcours PMR : entrée, distance maximale, flux de l'ascenseur, rampes, compromis du portillon."""
    C = S.R.get('circulationsOperation'); P_ = (C or {}).get('pmr')
    if not P_: return ''
    ver = circ_ver(C); pe = P_['parEntree'][0]; pl = P_['plusLoin']; fx = P_['fluxAscenseur']['parNiveau']
    ru = {'logements': 'entrée est (résidents)', 'crèche': 'crèche'}
    rr = ''.join('<tr><td>Rampe, %s</td><td colspan=3>%s m, pente %d %%, dénivelé +%s m, %d palier(s) de repos de %s m, largeur %s m (pente du terrain %s %%)</td></tr>' % (
        ru.get(u, u), f1(r['longueur']), r['pente_pct'], f2(r['denivele']), r['paliers'], f1(r['palierL']), f1(r['largeur']), f1(r['pentesTerrain'])) for (u, _, _, _), r in rampes_groupes(C))
    cp = C.get('compromisPortillon') or {}; ac, me = cp.get('actuel'), cp.get('meilleure')
    cps = ('<tr><td>Compromis portillon</td><td colspan=3>portillon est inchangé : dénivelé net %s m, rampe de %s m, %d palier(s)%s</td></tr>' % (
        f2(ac['denivele_m']), f1(ac['longueurRampe']), ac['paliers'], (' ; la meilleure position, déplacée de %s m, ramènerait le dénivelé à %s m (rampe de %s m)' % (f1(me['deplacement_m']), f2(me['denivele_m']), f1(me['longueurRampe']))) if me and me.get('deplacement_m') else '')) if ac else ''
    pp = ver.get('PMR_PENTES')
    return ('<table class=cmp><tr><th colspan=4 style="text-align:left">%s</th></tr><tr class=sec><td colspan=4>Parcours PMR : ascenseur seul pour les étages</td></tr>'
            '<tr><td>Entrée de référence</td><td colspan=3>portillon %s : %d logements, %s m au plus loin, %s</td></tr>'
            '<tr><td>Distance maximale</td><td colspan=3>%s m, %s (%s)</td></tr><tr><td>Flux de l\'ascenseur</td><td colspan=3>%d logements au départ du RDC, puis %s (R+1, R+2, R+3)</td></tr>%s%s'
            '<tr><td>Rampes (PMR_PENTES)</td><td colspan=3>%s</td></tr></table>') % (
        titre, 'FJT (sud)' if 'FJT' in pe['usages'] else pe['portillon'], pe['logements'], f1(pe['distMax']), mmss(pe['tMax']),
        f1(P_['distMax']), pl['logement'].replace('’', "'"), mmss(pl['t']), fx[0], ', '.join(str(x) for x in fx[1:]), rr, cps,
        ('<b>%s</b> : %s' % ('conforme' if pp['level'] == 'ok' else 'avertissement', pp['msg'])) if pp else '—')
cf_ret, cf_pmr, cf_var = circ_files(D, 'ret'), circ_files(D, 'ret', 'pmr'), circ_files(S2, 'r2')
def circ_fig(f, cap): return '<figure class="cf">%s<figcaption>%s</figcaption></figure>' % (('<img src="%s">' % f) if f else '<div class="todo">carte absente</div>', cap)
Cr, Cv = D.R.get('circulationsOperation') or {}, S2.R.get('circulationsOperation') or {}
def entree(Cx, i):
    e = (Cx.get('chaleur') or {}).get('parEntree') or []
    return e[i] if len(e) > i else None
e1, e2, ev1, ev2 = entree(Cr, 0), entree(Cr, 1), entree(Cv, 0), entree(Cv, 1)
asc_r, asc_v = Cr.get('ascenseur') or {}, Cv.get('ascenseur') or {}
# distance du portillon FJT au noyau d'ascenseur : longueur de l'allée FJT → escalier/noyau du Bât. A (pcmi.json)
al_asc = next((a for a in (D.Q.get('allees') or []) if a['usage'] == 'FJT' and a['id'].startswith('pieton-FJT>Bât. A/escalier')), None)
rp = [r for _, r in rampes_groupes(Cr)]; rp_est = next((r for (u, _, _, _), r in rampes_groupes(Cr) if u == 'logements'), None)
txt12 = ('<p><b>Lecture.</b> L\'entrée PMR de référence est l\'entrée FJT, au sud%s ; elle dessert les %d logements par l\'ascenseur seul (distance maximale %s m, contre %s m au plus court). %s'
         'Deux entrées desservent les logements au plus court, le portillon FJT, au sud, et le portillon résidents, à l\'est ; le scénario retenu les répartit en %d et %d logements, la variante R+2 en %d et %d. '
         'L\'entrée est est rendue accessible par une rampe%s. Le chemin de la crèche%s et celui du public MLE restent à part des chemins des résidents. '
         'Ascenseur : %s en R+%d (%d présent), %s en R+%d (%d présent). Les raccords palier / coursive sous 1,20 m de large sont signalés dans les tableaux.</p>') % (
    (', à %s m du portillon pour l\'ascenseur' % f1(al_asc['longueur'])) if al_asc else '', (Cr.get('pmr') or {}).get('logements', 0), f1((Cr.get('pmr') or {}).get('distMax', 0)), f1((Cr.get('chaleur') or {}).get('distMax', 0)),
    ('L\'ascenseur est dans le noyau du Bât. A, en saillie sur la cour. ' if asc_r.get('present') else ''),
    e1['logements'], e2['logements'], ev1['logements'], ev2['logements'],
    (' à %d %% de %s m, avec %d palier de repos' % (rp_est['pente_pct'], f1(rp_est['longueur']), rp_est['paliers'])) if rp_est else '',
    (' (rampe de %s m)' % f1(next(r for (u, _, _, _), r in rampes_groupes(Cr) if u == 'crèche')['longueur'])) if any(u == 'crèche' for (u, _, _, _), _ in rampes_groupes(Cr)) else '',
    'requis' if asc_r.get('requis') else 'facultatif', max(b['niveauHaut'] for b in asc_r['blocs']), asc_r.get('present', 0),
    'requis' if asc_v.get('requis') else 'facultatif', max(b['niveauHaut'] for b in asc_v['blocs']), asc_v.get('present', 0))
P.append(page('A.12', 'Circulations — cartes de chaleur', '''
<div class="circ"><div class="cgrid3">%s%s%s%s%s%s</div>
<div class="g3t mt">%s%s%s</div><div class="txt mt">%s</div></div>''' % (
    circ_fig(cf_ret.get('masse'), 'Plan de masse — scénario retenu R+3, chemin le plus court'), circ_fig(cf_pmr.get('masse'), 'Plan de masse — scénario retenu R+3, parcours PMR (ascenseur seul)'), circ_fig(cf_var.get('masse'), 'Plan de masse — variante R+2, chemin le plus court'),
    circ_fig(cf_ret.get('R1'), 'Étage R+1 — retenu, chemin le plus court'), circ_fig(cf_pmr.get('R1'), 'Étage R+1 — retenu, parcours PMR'), circ_fig(cf_var.get('R1'), 'Étage R+1 — variante R+2'),
    circ_table(D, 'Retenu R+3 — %d logements, chemin le plus court' % D.T['nLogts']), pmr_table(D, 'Retenu R+3 — parcours PMR') or '<div></div>', circ_table(S2, 'Variante R+2 — %d logements (sans ascenseur : pas de parcours PMR)' % S2.T['nLogts']), txt12), 'circp'))

CSS = open(os.path.join(HERE, 'build_report_v2.py'), encoding='utf-8').read().split("CSS = '''")[1].split("'''")[0] + '''
.fig.white{background:#fff}.fig img{width:100%;display:block}.fig.tall{height:170mm}.fig.tall img.cover-img{width:100%;height:100%;object-fit:cover}
.sections .sec{margin-bottom:2.5mm}.sections .sec svg.sx{width:100%;height:auto;max-height:78mm;display:block;border:1px solid #e6e6e6}
.planpage .body{left:6mm;right:6mm}.planrow{display:flex;gap:5mm;align-items:flex-start}.plancol{width:300mm;height:249.6mm;border:1px solid #999;flex:none}.plancol svg{display:block}\n.leg{flex:1;font-size:8.6pt}.leg h4{margin:0 0 2mm;font-size:11pt;color:#3e6f2c;text-transform:uppercase;letter-spacing:.04em}.leg h5{margin:3mm 0 1mm;font-size:8.5pt;border-bottom:1px solid #ccc;padding-bottom:.6mm}.leg .li{display:flex;align-items:center;gap:2mm;line-height:1.15;margin:.3mm 0}.leg .li svg{flex:none}
.plans .g2.eq{grid-template-columns:1fr 1fr;gap:6mm}.plans figure.pl img{width:100%;height:178mm;object-fit:contain;border:1px solid #ddd;background:#fff}
.types3{display:grid;grid-template-columns:1fr 1.2fr 1fr;gap:5mm;align-items:end}.types3 img{border:none;max-height:44mm;object-fit:contain}.todo{border:2px dashed #e08a2c;color:#8a4a00;padding:6mm;font-size:9pt;text-align:center}
.vimg{position:relative;height:100%}.vues .persp{height:238mm}.vues .persp figure{display:flex;flex-direction:column}.vues .persp .vimg{flex:1;overflow:hidden;border:1px solid #ddd}.vues .persp img{width:100%;height:100%;object-fit:cover;border:none}
.prov{position:absolute;left:3mm;top:3mm;background:rgba(224,138,44,.92);color:#fff;font-size:8pt;font-weight:700;padding:.8mm 2.5mm;letter-spacing:.06em}
.cmp{width:100%;border-collapse:collapse;font-size:9.5pt}.cmp th{background:#3e6f2c;color:#fff;padding:1.2mm 1.6mm;text-align:right}.cmp th:first-child{text-align:left}.cmp td{padding:1mm 1.6mm;border-bottom:1px solid #ddd}.cmp td.n{text-align:right;white-space:nowrap}.cmp tr.sec td{background:#eef6e8;font-weight:700}.cmp td.e{font-weight:700}
.circp .body{left:8mm;right:8mm}.cgrid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:3mm 4mm}.g3t{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4mm;align-items:start}.cf{margin:0;text-align:center}.cf img{height:75mm;width:100%;object-fit:contain;display:block}.cf figcaption{font-size:9pt;margin-top:.5mm}.circp .cmp{font-size:8.6pt}.circp .cmp td,.circp .cmp th{padding:.5mm 1.3mm;text-align:left}.circp .cmp tr.sec td{font-weight:700}.circp .txt p{font-size:10pt;margin:0}
.surf .grid{font-size:9pt}.surf .grid td,.surf .grid th{padding:1.1mm 1.4mm}.surf .grid th{font-size:9pt}.grid tr.sub td{background:#eef6e8;font-weight:600}.surf .txt{font-size:10pt}
'''
html = '<!doctype html><html lang=fr><head><meta charset=utf-8><title>Faisabilité FJT BH 513 — ind 1</title><style>%s</style></head><body>%s</body></html>' % (CSS, ''.join(P))
html_path = os.path.join(OUT, 'rapport.html'); open(html_path, 'w', encoding='utf-8').write(html)
print('pages', len(P), '| logts', N, T['logements'], '| SHAB', shab, '| SDP', sdp, '| emprise', empr, '| places', V['parkTotal'], '| clôtures', len(fences), '| écarts studios', studio_ecarts)
pdf = os.path.join(OUT, 'rapport-ind1.pdf')
try: open(pdf, 'ab').close()
except OSError:   # PDF ouvert dans un lecteur (Windows verrouille le fichier) : on écrit à côté plutôt que d'échouer
    pdf = os.path.join(OUT, 'rapport-ind1-%s.pdf' % datetime.datetime.now().strftime('%H%M')); print('rapport-ind1.pdf verrouillé : écriture dans', pdf)
subprocess.run([NODE, SHOT, html_path, pdf], check=True, timeout=280)
print('PDF', pdf, os.path.getsize(pdf))
