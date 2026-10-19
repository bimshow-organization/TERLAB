r = open('build_report.py', encoding='utf-8').read()
# renumérotation
for a, b in (("var_page('A.3', V1", "var_page('A.4', V1"), ("var_page('A.4', V2", "var_page('A.5', V2"),
             ("page('A.5', 'Coupes et façades urbaines", "page('A.6', 'Coupes et façades urbaines"),
             ("page('A.6', 'Vues — variante 1'", "page('A.8', 'Vues — variante 1'"),
             ("page('A.7', 'Tableau de surfaces", "page('A.9', 'Tableau de surfaces")):
    assert a in r, a; r = r.replace(a, b)

# A.3 — planche intermédiaire (inserée avant la variante 1)
a3 = r'''
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
'''
anchor = "P.append(var_page('A.4', V1"
assert anchor in r
r = r.replace(anchor, a3 + anchor, 1)

# A.7 — coupe paysagère (après les coupes)
a7 = r'''
P.append(page('A.7', 'Coupe paysagère', """
<div class="sec wide"><div class=cap>Coupe paysagère ouest → est au droit du site, 1,2 km — échelle horizontale ≈ 1/2000, hauteurs ×2</div>%s</div>
<div class="g2 mt"><div class=txt><h3>Lecture</h3><p>Le site occupe le rebord d'un <b>plateau à ≈ 115-118 m NGR</b>, tenu à l'ouest par le tissu de cases et de collectifs du quartier Mille Roches. À l'est, un <b>talus d'une dizaine de mètres</b> (ravine, bande B2u) descend vers la plaine basse de la Rivière du Mât et de la côte.</p>
<p>Les deux lames R+3 (≈ 13,5 m au faîtage) restent dans l'épannelage des collectifs voisins et <b>ne dépassent pas la ligne des grands arbres</b> du talus : depuis la plaine, le projet se lit derrière le couvert végétal conservé en limite est.</p></div>
<div class=txt><h3>Conséquences pour le projet</h3><ul><li>Conserver et renforcer la <b>lisière arborée du talus</b> (bande B2u non bâtie) : filtre visuel et hydraulique.</li><li>Orienter l'<b>entrée piétonne et le jardin</b> vers l'est : vues lointaines au-dessus de la plaine.</li><li>Gestion des eaux pluviales à la parcelle avant le talus (noue, infiltration) — pas de rejet direct dans la pente.</li></ul></div></div>""" % svg('coupe_paysage_V1.svg')))
'''
anchor2 = "# 7 — perspectives"
assert anchor2 in r
r = r.replace(anchor2, a7 + anchor2, 1)

# styles
r = r.replace(".persp{", """.lead{font-size:10.5pt;margin:0 0 3mm}.cards5{display:grid;grid-template-columns:repeat(5,1fr);gap:4mm}.cards4{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm}
.card{border:1px solid #ddd;padding:2.5mm;background:#fff;font-size:8.5pt}.card.on{border:2px solid #7cb85f;background:#f6fbf2}.card .ct{font-weight:700;font-size:9pt;margin-bottom:1.5mm}.card ul{padding-left:4mm;margin:1.5mm 0 0}.card li{margin:0 0 .8mm;line-height:1.3}
.card .kv td{padding:.6mm 0;font-size:8pt}.tag{background:#7cb85f;color:#fff;font-size:7pt;padding:.3mm 1.5mm;border-radius:2mm;margin-left:1mm}.ty{display:flex;justify-content:center;padding:1mm 0}
.sec.wide svg{width:100%;height:auto;display:block;border:1px solid #e6e6e6}
.persp{""", 1)
open('build_report.py', 'w', encoding='utf-8').write(r)
print('ok')
