# Rapport de faisabilité FJT Mille Roches — A3 paysage, trame MGA (cartouche vert)
import json, math, os, shutil
from shapely.geometry import Polygon

HERE = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(HERE, 'report')
PRJ = json.load(open('fjt_project_city.json')); VARS = json.load(open('fjt_variants.json'))
BOUNDS = [-346.86, -353.59, 347.37, 353.24]
DATE = '24/09/2026'; IND = 'ind 0 — document de travail'

def svg(f): return open(f, encoding='utf-8').read()
for f in os.listdir(HERE):
    if f.startswith('3d_') and f.endswith('.png'): shutil.copy(os.path.join(HERE, f), os.path.join(R, f))

# ── figure situation : orthophoto + parcelle + lots (repère maquette) ──
def situation(half=150):
    fjt = Polygon(PRJ['fjt']); c = fjt.centroid; x0, z0 = c.x - half*1.4, c.y - half
    P = lambda p: ' '.join('%.1f,%.1f' % (x, z) for x, z in p)
    return ('<svg viewBox="%.1f %.1f %.1f %.1f" preserveAspectRatio="xMidYMid slice" style="width:100%%;height:100%%">'
            '<image href="satellite.jpg" x="%.2f" y="%.2f" width="%.2f" height="%.2f" preserveAspectRatio="none"/>'
            '<polygon points="%s" fill="rgba(107,127,168,.25)" stroke="#dfe7ff" stroke-width="1" stroke-dasharray="4 2"/>'
            '<polygon points="%s" fill="rgba(255,200,0,.28)" stroke="#ffcc00" stroke-width="1.6"/>'
            '<polygon points="%s" fill="none" stroke="#fff" stroke-width="1.2"/>'
            '<text x="%.1f" y="%.1f" font-size="9" fill="#fff" font-weight="700" text-anchor="middle" style="paint-order:stroke;stroke:#000;stroke-width:2px">FJT</text>'
            '<text x="%.1f" y="%.1f" font-size="8" fill="#fff" text-anchor="middle" style="paint-order:stroke;stroke:#000;stroke-width:2px">SIDR</text></svg>') % (
        x0, z0, half*2.8, half*2, BOUNDS[0], BOUNDS[1], BOUNDS[2]-BOUNDS[0], BOUNDS[3]-BOUNDS[1],
        P(PRJ['sidr']), P(PRJ['fjt']), P(PRJ['parcel']), c.x, c.y + 3, Polygon(PRJ['sidr']).centroid.x, Polygon(PRJ['sidr']).centroid.y + 3)

# ── programme & surfaces (identiques V1 / V2 : même programme, implantation différente) ──
T1, T2 = 20.0, 46.0
A_len, B_len, DEPTH, DU = 50.2, 35.6, 8.6, 5.9
prog = [
  ('Bât. A', 'RDC', 'Accueil, bureau gestionnaire, permanence MLE, salle collective + cuisine partagée, laverie, local vélos', 0, 0, None),
  ('Bât. A', 'R+1', 'Logements', 9, 2, None), ('Bât. A', 'R+2', 'Logements', 9, 2, None), ('Bât. A', 'R+3', 'Logements', 9, 2, None),
  ('Bât. B', 'RDC', '3 logements PMR, salle d\'étude / atelier, local poubelles, local technique', 2, 1, None),
  ('Bât. B', 'R+1', 'Logements', 7, 1, None), ('Bât. B', 'R+2', 'Logements', 7, 1, None), ('Bât. B', 'R+3', 'Logements', 7, 1, None),
]
nT1 = sum(r[3] for r in prog); nT2 = sum(r[4] for r in prog); shab = nT1*T1 + nT2*T2
sdp_brut = 4*A_len*DU + 4*B_len*DU; sdp = round(sdp_brut - 90, -1)
communs = round((A_len - 4)*DU + 60)
empr = round(A_len*DEPTH + B_len*DEPTH); lot = 2962
assert nT1 == 50 and nT2 == 10, (nT1, nT2)

def rows_prog():
    h = ''
    for b, niv, dest, a, c, _ in prog:
        s = a*T1 + c*T2
        h += '<tr><td>%s</td><td>%s</td><td>%s</td><td class=n>%s</td><td class=n>%s</td><td class=n>%s</td></tr>' % (b, niv, dest, a or '—', c or '—', '%.0f' % s if s else '—')
    h += '<tr class=tot><td colspan=3>Total</td><td class=n>%d</td><td class=n>%d</td><td class=n>%.0f</td></tr>' % (nT1, nT2, shab)
    return h

def metrics(v):
    pk = 20
    return ('<table class=kv>'
      '<tr><td>Assiette FJT (hypothèse)</td><td>%d m²</td></tr><tr><td>Enveloppe constructible</td><td>2 242 m²</td></tr>'
      '<tr><td>Logements</td><td>60 (50 T1 · 10 T2)</td></tr><tr><td>Surface habitable</td><td>%.0f m²</td></tr>'
      '<tr><td>Surface de plancher (≈)</td><td>%d m²</td></tr><tr><td>Emprise bâtie</td><td>%d m² (%d %%)</td></tr>'
      '<tr><td>Hauteur</td><td>R+3 · ≈ 12,6 m à l\'égout</td></tr><tr><td>Écart entre lames</td><td>%.1f m</td></tr>'
      '<tr><td>Stationnement</td><td>%d pl. (1 pour 3 lgts) dont 1 PMR</td></tr><tr><td>Espaces libres / perméables</td><td>≈ %d %%</td></tr></table>') % (
        lot, shab, sdp, empr, round(100*empr/lot), v['gap'], pk, v['perm_pct'])

def page(num, title, body, cls=''):
    return ('<section class="page %s"><div class="body">%s</div>'
            '<footer><div class="mga"><span>Mathias Giraud Architecture</span><b>mgA.</b></div><img class="sm" src="semac.jpg">'
            '<div class="ef">Etude de faisabilité<br><b>FJT · BH 513 à Saint-André</b></div><div class="pt">%s</div>'
            '<div class="no"><b>%s</b><span>%s</span></div></footer></section>') % (cls, body, title, num, DATE)

V1 = next(v for v in VARS if v['key'] == 'V1'); V2 = next(v for v in VARS if v['key'] == 'V3')

P = []
# 1 — couverture
P.append('''<section class="page cover"><div class="hero" style="background-image:url(ia_V1_so_nano.png)"></div><div class="herocap">Image d'ambiance générée par IA à partir de la maquette 3D — non contractuelle</div>
<div class="ct"><img src="semac.jpg" class="lg"><div class="k">Etude de faisabilité · capacité</div>
<h1>Foyer de Jeunes Travailleurs<br><span>Mille Roches, Saint-André</span></h1><div class="ind">%s<br>SEPTEMBRE 2026</div>
<dl><dt>Adresse</dt><dd>573 chemin Mille Roches, 97440 Saint-André</dd><dt>Cadastre</dt><dd>BH 513 pour partie (4 951 m²)</dd>
<dt>Assiette FJT</dt><dd>≈ 2 960 m² — hypothèse de découpage, à valider</dd><dt>Programme</dt><dd>FJT 60 logements LLTS · exploitant MLE</dd>
<dt>Zone PLU</dt><dd><b>Ue</b> — équipements (PLU approuvé le 02/07/2025) · hébergement interdit : évolution du PLU requise</dd><dt>PPRN</dt><dd>B3 inondation (≈ 95 %%) · B2u en limite est</dd></dl></div>
<div class="mga big"><span>Mathias Giraud Architecture</span><b>mgA.</b></div></section>''' % IND)

# 2 — situation & cadre
P.append(page('A.1', 'Situation et cadre règlementaire', '''
<div class="g2"><div><div class="fig tall">%s<div class="cap">Situation — orthophoto IGN · parcelle BH 513, lot SIDR (bleu), assiette FJT (jaune)</div></div>
<div class="g3 mt"><figure><img src="terlab_coupeA.png"><figcaption>Profil longitudinal LiDAR (Δ 5 m · 5,7 %%)</figcaption></figure>
<figure><img src="terlab_coupeB.png"><figcaption>Profil transversal LiDAR (Δ 2 m · 2,7 %%)</figcaption></figure>
<figure><img src="terlab_topo.png"><figcaption>Courbes 1 m — IGN RGE ALTI</figcaption></figure></div></div>
<div class="txt">
<h3>Le site</h3><p>Friche arborée de 4 951 m² au cœur du quartier Mille Roches (NPNRU), bordée au sud, à l'ouest et à l'est par le chemin Mille Roches (chaussée 4 m), au nord par un tissu de cases et de petits collectifs. Plateau quasi plan entre <b>114,8 et 117,7 m NGR</b> ; la limite est surplombe une ravine (talus, courbes serrées). Climat de la côte au vent : <b>alizés d'est</b>, pluviométrie ≈ <b>2 365 mm/an</b>.</p>
<h3>Risques — PPRN Saint-André (BRGM 2026)</h3><ul><li><b>B3 — inondation, prescriptions</b> : ≈ 4 716 m² de la parcelle. Constructible sous réserve de caler les planchers au-dessus de la cote de référence ; <b>pas de sous-sol</b> ; clôtures transparentes hydrauliquement.</li>
<li><b>B2u — inondation + mouvement de terrain</b> : couloir de la ravine à l'est, ≈ 246 m² sur la parcelle dont ≈ 100 m² sur le lot FJT, laissés libres de construction.</li><li>Zone rouge <b>R1</b> (interdiction) au sud-est, hors parcelle.</li><li>Servitude PM1 (PPR) reportée au GPU.</li></ul>
<h3>PLU approuvé le 02/07/2025 — zone Ue</h3><p>BH 513 est intégralement classée en <b>zone Ue</b> (« zones d'équipements » : stades, gymnases, services techniques…), au sein de la zone Ub. Aucune OAP, aucun emplacement réservé ni EBC sur la parcelle (planche n°2 Centre-ville / Cressonnière).</p>
<p class=warn><b>Point bloquant</b> — en Ue, la sous-destination <b>« hébergement » est interdite</b> et le logement n'est admis que pour le gardiennage (70 m² de SDP). Un FJT relève de l'hébergement (« foyers de travailleurs », art. R151-28). Le projet — comme les 20 LLS de la SIDR — suppose une <b>évolution du PLU</b> (modification ou déclaration de projet emportant mise en compatibilité, reclassement en Ub), ou une qualification en équipement d'intérêt collectif à faire valider par le service instructeur.</p>
<p>Règles Ue retenues pour l'étude : hauteur <b>16 m</b> (R+3 ≈ 12,6 m à l'égout : conforme) ; recul <b>3 m</b> sur voie ; <b>4 m</b> sur limites séparatives et de fond ; pas de ratio de stationnement imposé (le programme retient 1 place / 3 lgts) ; <b>pas de blanc en paroi</b> ni de tôle non peinte ; sol protégé du soleil sur 3 m au droit de 50 %% des façades.</p>
<h3>Programme (CR Ville / MLE / SEMAC du 26/06/2026)</h3><ul><li>P1 — FJT : <b>60 logements</b> — 50 T1 de 20 m² et 10 T2 d'≈ 46 m², produit LLTS</li><li>Deux bâtiments privilégiés, <b>R+3 maximum</b></li><li>Stationnement en surface : <b>1 place pour 3 logements</b></li><li>Bureaux MLE et crèche : hors de cette assiette (programme recentré sur le FJT)</li></ul>
</div></div>''' % situation()))

# 3 — hypothèse de découpage
P.append(page('A.2', 'Assiette foncière — hypothèse de découpage', '''
<div class="g2 w60"><div><div class="fig">%s<div class="cap">Hypothèse de découpage BH 513 — lot SIDR au nord (≈ 2 000 m²), assiette FJT au sud (≈ 2 960 m²), enveloppe constructible (tirets orange), B2u (hachures rouges), servitude réseaux (tirets bleus)</div></div><figure class="ppr mt">%s<figcaption>PPRN approuvé (BRGM 2026, PEIGEO) — lot FJT : B3 ≈ 2 870 m², B2u ≈ 100 m² ; R1 hors parcelle (sud-est)</figcaption></figure></div>
<div class="txt"><h3>Lecture du courriel SEMAC du 16/09</h3><ul>
<li>≈ 2 000 m² cédés à la SIDR pour 20 LLS (programmation 2027, PC fin 09/2026, MOE NKN) — la partie déjà levée par le géomètre.</li>
<li>≈ 3 000 m² pour le FJT (programmation 2028) — la partie <b>sans relevé topographique</b>.</li>
<li>La SEMAC doit une <b>servitude de réseaux</b> au lot SIDR : le lot SIDR n'a donc pas d'exutoire direct vers le point bas.</li></ul>
<h3>Hypothèse retenue</h3><p>Le lot SIDR occupe la bande nord, parallèle à la limite nord-est (profondeur ≈ 22 m), au contact des cases existantes ; le FJT occupe la partie sud, avec façade sur le chemin Mille Roches sur trois côtés. La servitude (4 m) longe la limite ouest du lot FJT vers le point bas sud-ouest, sous le parking.</p>
<p class=warn><b>À valider avant toute suite</b> avec la SEMAC et la MOE SIDR (E. Naiken, NKN) sur la base du plan topographique et de division <i>2026-004-409BH513-SIDR-Client.dwg</i> : tracé exact de la limite, position de la servitude, accès.</p>
<h3>Enveloppe constructible FJT</h3><table class=kv><tr><td>Assiette FJT</td><td>2 962 m²</td></tr><tr><td>Reculs Ue : voie 3 m · limites 4 m</td><td>—</td></tr><tr><td>Hors B2u (+1 m) et servitude</td><td>—</td></tr><tr><td><b>Enveloppe constructible</b></td><td><b>2 242 m²</b></td></tr></table>
<div class="g2 mt"><figure><img src="plu_zonage_bh513.png"><figcaption>PLU 2025 — zonage Ue de BH 513 (contour cadastral en rouge) · planche n°2</figcaption></figure></div>
</div></div>''' % (svg('plan_base.svg'), svg('ppr_map.svg'))))

# 4/5 — variantes
def var_page(num, v, key, title, desc, img1, img2):
    return page(num, title, '''
<div class="g2 w60"><div class="fig">%s<div class="cap">%s — plan masse</div></div>
<div class="txt"><h3>Principe</h3>%s<h3>Chiffres clés</h3>%s
<div class="g2 mt"><figure><img src="%s"></figure><figure><img src="%s"></figure></div></div></div>''' % (svg('plan_%s.svg' % key), title, desc, metrics(v), img1, img2))


# 3bis — hypothèses d'implantation et typologies
OPT = json.load(open('options.json', encoding='utf-8')); OSV = json.load(open('options_svg.json', encoding='utf-8'))
def card(o):
    th = OSV['thumbs'][o['key']]
    if o.get('ok'):
        kv = '<table class=kv><tr><td>Bâtiments</td><td>%d</td></tr><tr><td>Emprise</td><td>%d m² (%d %%)</td></tr><tr><td>Prospect mini</td><td>%s</td></tr><tr><td>Espaces libres</td><td>≈ %d %%</td></tr></table>' % (
            o['nb'], o['emprise'], o['emprise_pct'], ('%.1f m' % o['gap']) if o.get('gap') else '—', o['perm'])
    else:
        kv = '<p class=warn>Non faisable dans l\'enveloppe</p>'
    tag = '<span class=tag>retenu</span>' if o.get('retenu') else ''
    return '<div class="card%s"><div class=ct>%s · %s %s</div>%s%s<ul>%s</ul></div>' % (' on' if o.get('retenu') else '', o['key'], o['titre'], tag, th, kv, ''.join('<li>%s</li>' % n for n in o['notes']))
def tcard(t):
    k, titre, ret, notes, sv = t
    return '<div class="card%s"><div class=ct>%s %s</div><div class=ty>%s</div><ul>%s</ul></div>' % (' on' if ret else '', titre, '<span class=tag>retenu</span>' if ret else '', sv, ''.join('<li>%s</li>' % n for n in notes if n != 'retenu'))
P.append(page('A.3', 'Hypothèses d\'implantation et typologies', """
<p class=lead>Même programme (60 logements, R+3), même enveloppe Ue (2 242 m²) et même parking : cinq familles d'implantation testées géométriquement, puis quatre modes de distribution du T1. La profondeur constructible (≈ 36 m entre la limite SIDR et le chemin) ne laisse passer que des <b>lames</b> ; les plots sont écartés.</p>
<div class=cards5>%s</div>
<h3 class=mt>Distribution des logements — T1 de 20 m²</h3>
<div class=cards4>%s</div>""" % (''.join(card(o) for o in OPT), ''.join(tcard(t) for t in OSV['typos']))))
P.append(var_page('A.4', V1, 'V1', 'Variante 1 — deux lames parallèles, jardin central', '''<p>Deux lames R+3 parallèles à l'axe de la parcelle (orientation NNE / SSO), à coursives <b>tournées vers un jardin central</b> de ≈ 10 m de large qui porte la noue GIEP. Le bâtiment A (au nord, 50 m) accueille au RDC les espaces communs du foyer — accueil, bureau du gestionnaire, permanence MLE, salle collective, laverie — et tient la limite avec le lot SIDR ; le bâtiment B (au sud, 36 m) tient le chemin Mille Roches. Le parking de 20 places, à l'ouest sur la servitude, est desservi directement depuis le chemin.</p>
<ul><li>Logements mono-orientés côté extérieur, portes et impostes hautes sur coursive : <b>ventilation traversante</b> par les alizés d'est.</li><li><b>Varangues intégrées</b> jumelées deux à deux entre des trumeaux en <b>bardage bois</b> à lames verticales : écriture rythmée A-B-B-A, baies verticales ≈ 1,05 × 1,55 m (composition houseg-speech).</li><li>Façades principales nord / sud, faciles à protéger ; enduit teinte sable (PLU : pas de blanc en paroi), toitures tôle peinte gris.</li><li>RDC surélevé de ≈ 0,60 m (cote de référence B3), sans sous-sol.</li></ul>''', '3d_V1_top.png', '3d_V1_so.png'))

P.append(var_page('A.5', V2, 'V3', 'Variante 2 — lames décalées en redents', '''<p>Même programme ; le bâtiment B pivote pour <b>suivre le chemin Mille Roches</b> (≈ 5°) et se décale vers l'est : le jardin s'ouvre en biais vers la ravine et les vues lointaines, et le bâtiment A se rapproche de l'ouest. L'écart minimal entre lames passe à ≈ 9 m.</p>
<ul><li>Front bâti plus continu sur la rue, meilleure lecture de l'adresse du foyer.</li><li>Jardin en entonnoir, plus généreux côté est, où le talus est préservé.</li><li>Parking inchangé à l'ouest.</li></ul>''', '3d_V3_so.png', '3d_V3_ne.png'))

# 6 — coupes et façades urbaines
P.append(page('A.6', 'Coupes et façades urbaines — variante 1', '''
<div class="sec"><div class="cap">Coupe AA — transversale nord-sud au droit des deux lames (regard vers l'ouest) · chemin Mille Roches à gauche (sud), lot SIDR à droite (nord)</div>%s</div>
<div class="sec"><div class="cap">Façade urbaine sud — depuis le chemin Mille Roches (regard vers le nord)</div>%s</div>
<div class="sec"><div class="cap">Façade urbaine ouest — depuis le chemin Mille Roches ouest (regard vers l'est)</div>%s</div>
<p class=note>Terrain naturel : IGN RGE ALTI / LiDAR HD (trait fort) · bâti existant : IGN BD TOPO (hauteurs mesurées), trait gris selon la profondeur · arbres : LiDAR HD + semis maquette · projet : RDC surélevé de 0,60 m, niveaux de 3,00 m, varangues intégrées 1,20 m, coursives 1,50 m, toiture tôle deux pans 12°.</p>''' % (svg('coupe_AA_V1.svg'), svg('facade_BB_V1.svg'), svg('facade_CC_V1.svg')), 'sections'))


P.append(page('A.7', 'Coupe paysagère', """
<div class="sec wide"><div class=cap>Coupe territoriale des Hauts à l'océan (≈ 10 km, axe OSO → ENE) — échelle ≈ 1/25 000, hauteurs ×3</div>%s</div>
<div class="sec wide"><div class=cap>Coupe paysagère ouest → est au droit du site, 1,2 km — échelle horizontale ≈ 1/2000, hauteurs ×2</div>%s</div>
<div class="g2 mt"><div class=txt><h3>Lecture</h3><p>À l'échelle du territoire, Mille Roches est posé à mi-pente (116 m NGR) entre les Hauts de Saint-André (≈ 370 m à 5 km) et le littoral à 4,5 km, sur le glacis qui descend vers la côte au vent. Le site occupe le rebord d'un <b>plateau à ≈ 115-118 m NGR</b>, tenu à l'ouest par le tissu de cases et de collectifs du quartier Mille Roches. À l'est, un <b>talus d'une dizaine de mètres</b> (ravine, bande B2u) descend vers la plaine basse de la Rivière du Mât et de la côte.</p>
<p>Les deux lames R+3 (≈ 13,5 m au faîtage) restent dans l'épannelage des collectifs voisins et <b>ne dépassent pas la ligne des grands arbres</b> du talus : depuis la plaine, le projet se lit derrière le couvert végétal conservé en limite est.</p></div>
<div class=txt><h3>Conséquences pour le projet</h3><ul><li>Conserver et renforcer la <b>lisière arborée du talus</b> (bande B2u non bâtie) : filtre visuel et hydraulique.</li><li>Orienter l'<b>entrée piétonne et le jardin</b> vers l'est : vues lointaines au-dessus de la plaine.</li><li>Gestion des eaux pluviales à la parcelle avant le talus (noue, infiltration) — pas de rejet direct dans la pente.</li></ul></div></div>""" % (svg('coupe_territoire.svg'), svg('coupe_paysage_V1.svg'))))
# 7 — perspectives
P.append(page('A.8', 'Vues — variante 1', '''
<div class="persp"><figure class="big"><img src="ia_V1_so_nano.png"><figcaption>Vue aérienne depuis le sud-ouest — image d'ambiance (IA, Leonardo / nano-banana) calée sur la maquette 3D, non contractuelle</figcaption></figure>
<figure><img src="3d_V1_proche.png"><figcaption>Bâtiment B depuis le chemin Mille Roches — varangues intégrées, bardage</figcaption></figure>
<figure><img src="3d_V1_so.png"><figcaption>Maquette 3D — assiette FJT (limite orange), parcelle BH 513 (blanc)</figcaption></figure></div>
<p class=note>Maquette : IGN BD TOPO V3, RGE ALTI, LiDAR HD (végétation), orthophoto IGN — outil ville tropicale MGA / TERLAB. Volumétries indicatives, matériaux non contractuels.</p>'''))

# 8 — surfaces & vigilance
P.append(page('A.9', 'Tableau de surfaces et points de vigilance', '''
<div class="g2"><div><h3>Programme par niveau (variantes 1 et 2)</h3><table class=grid><tr><th>Bât.</th><th>Niveau</th><th>Destination</th><th>T1 20 m²</th><th>T2 46 m²</th><th>SHAB m²</th></tr>%s</table>
<h3 class=mt>Synthèse</h3><table class=grid>
<tr><td>Logements</td><td class=n>60</td><td>50 T1 + 10 T2</td></tr>
<tr><td>Surface habitable (SHAB)</td><td class=n>%.0f m²</td><td>moyenne %.1f m² / logement</td></tr>
<tr><td>Espaces communs (SU)</td><td class=n>≈ %d m²</td><td>RDC A + atelier RDC B</td></tr>
<tr><td>Surface de plancher</td><td class=n>≈ %d m²</td><td>pré-dimensionnement ±10 %%</td></tr>
<tr><td>Ratio SHAB / SDP</td><td class=n>%.2f</td><td>coursives extérieures hors SDP</td></tr>
<tr><td>Emprise bâtie</td><td class=n>%d m²</td><td>%d %% de l'assiette</td></tr>
<tr><td>Stationnement</td><td class=n>20 pl.</td><td>1 / 3 lgts · dont 1 PMR · + 60 places vélos</td></tr>
<tr><td>Espaces libres</td><td class=n>≈ 54 %%</td><td>jardin central + noue GIEP + haies</td></tr></table>
<p class=note>Trames : T1 3,40 × 5,90 m + varangue intégrée 1,90 × 1,20 m (≈ 2,3 m²) ; T2 7,80 × 5,90 m + varangue 3,00 × 1,20 m ; noyau escalier + ascenseur 4,00 m ; lame 8,60 m (logement 5,90 + varangue 1,20 + coursive 1,50).</p></div>
<div class="txt"><h3>Points de vigilance</h3><ol>
<li><b>Assiette foncière</b> : découpage SIDR / FJT et servitude réseaux à arrêter avec la SEMAC et NKN (plan de division DWG du 17/09).</li>
<li><b>PLU 2025 — zone Ue</b> : l'hébergement (FJT) y est <b>interdit</b>. Évolution du PLU à engager avec la Ville (reclassement en Ub par modification ou déclaration de projet), en commun avec l'opération SIDR. Hauteur (16 m) et reculs (3 / 4 m) compatibles.</li>
<li><b>PPRN B3</b> : cote de référence à obtenir (DEAL / BRGM) — calage des RDC, transparence des clôtures, pas de sous-sol. Bande B2u inconstructible en pratique.</li>
<li><b>Topographie</b> : relevé géomètre de l'assiette FJT à commander ; l'étude repose sur le LiDAR HD IGN (précision ≈ 10 cm).</li>
<li><b>Programme d'exploitation</b> : surfaces des communs, bureau MLE, veille de nuit — à caler avec la MLE (via E. Hamel).</li>
<li><b>GIEP</b> : 2 365 mm/an, zone inondable — gestion à la parcelle (noue centrale, stationnement perméable), éligible au bonus GIEP.</li></ol>
<h3>Suite proposée</h3><ul><li>Réunion Ville / SEMAC / SIDR sur la <b>procédure d'évolution du PLU</b> (zone Ue).</li><li>Réunion de calage SEMAC / MLE / NKN sur l'assiette et le programme.</li><li>Choix d'une variante, plans types T1 / T2 et RDC communs.</li><li>Estimation des travaux et montage (LLTS, FSE, bonus EPFR) — à produire sur la variante retenue.</li><li>Perspectives d'ambiance pour la présentation aux élus.</li></ul></div></div>''' % (
    rows_prog(), shab, shab/60, communs, sdp, shab/sdp, empr, round(100*empr/lot))))

CSS = '''
@page{size:420mm 297mm;margin:0}
*{box-sizing:border-box}body{margin:0;font-family:Helvetica,Arial,sans-serif;color:#222;font-size:10.5pt}
.page{width:420mm;height:297mm;position:relative;overflow:hidden;page-break-after:always;background:#fff}
.body{position:absolute;left:12mm;right:12mm;top:10mm;bottom:22mm}
footer{position:absolute;left:0;right:0;bottom:0;height:16mm;display:flex;align-items:stretch;border-top:1.2px solid #000;border-bottom:1.2px solid #000}
footer>div,footer>img{border-right:1px solid #000}
footer .mga{width:62mm;display:flex;align-items:flex-end;padding:0 0 2mm 4mm;background:#fff}
.mga span{font-family:'Times New Roman',serif;font-size:7pt;margin-right:1mm}.mga b{font-family:'Times New Roman',serif;font-weight:400;font-size:26pt;line-height:.8;border-right:1px solid #222;padding-right:1mm}
footer .sm{height:12mm;margin:2mm 3mm;border:1px solid #000;filter:grayscale(1) contrast(1.2)}
footer .ef{background:#fff;color:#000;width:70mm;text-align:center;font-size:8.5pt;padding-top:3mm}
footer .pt{flex:1;background:#fff;color:#000;font-size:13pt;font-weight:700;display:flex;align-items:flex-end;padding:0 0 2mm 8mm}
footer .no{width:30mm;background:#fff;color:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:8pt}.no b{font-size:14pt}
h3{font-size:11pt;margin:3mm 0 1.5mm;color:#3e6f2c;text-transform:uppercase;letter-spacing:.04em}
p,li{line-height:1.38;margin:0 0 1.5mm}ul,ol{margin:0 0 2mm;padding-left:5mm}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:8mm;align-items:start}.g2.w60{grid-template-columns:1.45fr 1fr}.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4mm}
.g2.mt,.g3.mt{height:auto}.mt{margin-top:4mm}
.fig{position:relative;border:1px solid #ccc;background:#fbfaf7}.fig svg{display:block;width:100%;height:auto}.fig.tall{height:170mm;overflow:hidden}
.cap,figcaption{font-size:8pt;color:#555;padding:1mm 0}.fig .cap{position:absolute;left:0;right:0;bottom:0;background:rgba(255,255,255,.88);padding:1.5mm 2mm}
figure{margin:0}figure img{width:100%;display:block;border:1px solid #ddd}
.warn{background:#fdf3e6;border-left:3px solid #e08a2c;padding:2mm 3mm}.note{font-size:8pt;color:#666}
table{border-collapse:collapse;width:100%;font-size:9.5pt}.kv td{border-bottom:1px solid #e3e3e3;padding:1.2mm 1mm}.kv td+td{text-align:right;font-weight:600}
.grid th{background:#7cb85f;color:#fff;font-weight:600;padding:1.5mm;text-align:left}.grid td{border-bottom:1px solid #ddd;padding:1.3mm 1.5mm}.grid .n{text-align:right;font-variant-numeric:tabular-nums}.grid tr.tot td{font-weight:700;border-top:2px solid #7cb85f}
.sections .sec{margin-bottom:3mm}.sections .sec svg{width:100%;height:auto;max-height:78mm;display:block;border:1px solid #e6e6e6}
.lead{font-size:10.5pt;margin:0 0 3mm}.cards5{display:grid;grid-template-columns:repeat(5,1fr);gap:4mm}.cards4{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm}
.card{border:1px solid #ddd;padding:2.5mm;background:#fff;font-size:8.5pt}.card.on{border:2px solid #7cb85f;background:#f6fbf2}.card .ct{font-weight:700;font-size:9pt;margin-bottom:1.5mm}.card ul{padding-left:4mm;margin:1.5mm 0 0}.card li{margin:0 0 .8mm;line-height:1.3}
.card .kv td{padding:.6mm 0;font-size:8pt}.tag{background:#7cb85f;color:#fff;font-size:7pt;padding:.3mm 1.5mm;border-radius:2mm;margin-left:1mm}.ty{display:flex;justify-content:center;padding:1mm 0}
.sec.wide svg{width:100%;height:auto;display:block;border:1px solid #e6e6e6}
.ppr svg{height:86mm;width:auto;max-width:100%;display:block;border:1px solid #ddd}
.persp{display:grid;grid-template-columns:1.6fr 1fr;grid-template-rows:1fr 1fr;gap:4mm;height:245mm}.persp .big{grid-row:span 2}.persp figure{overflow:hidden}.persp img{height:calc(100% - 6mm);object-fit:cover}
.cover .hero{position:absolute;inset:0 150mm 0 0;background-size:cover;background-position:center}
.cover .herocap{position:absolute;left:4mm;bottom:3mm;font-size:7pt;color:#fff;text-shadow:0 0 3px #000}
.cover .ct{position:absolute;right:12mm;top:30mm;width:130mm}.cover .lg{width:60mm;border:1px solid #222}.cover .k{font-size:14pt;margin-top:6mm}
.cover h1{font-size:25pt;margin:2mm 0 0;line-height:1.1}.cover h1 span{font-size:19pt;font-weight:400}.cover .ind{color:#777;font-size:10pt;margin:3mm 0 8mm}
.cover dl{display:grid;grid-template-columns:30mm 1fr;gap:2mm 3mm;font-size:10pt}.cover dt{font-weight:700}.cover dd{margin:0}
.cover .mga.big{position:absolute;right:12mm;bottom:12mm;display:flex;align-items:flex-end}.cover .mga.big b{font-size:44pt}
'''
html = '<!doctype html><html lang=fr><head><meta charset=utf-8><title>Faisabilité FJT BH 513</title><style>%s</style></head><body>%s</body></html>' % (CSS, ''.join(P))
open(os.path.join(R, 'rapport.html'), 'w', encoding='utf-8').write(html)
print('pages', len(P), '| SHAB', shab, '| SDP', sdp, '| communs', communs, '| emprise', empr, '| lot', lot)
