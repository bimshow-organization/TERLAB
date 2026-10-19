import re
r = open('build_report.py', encoding='utf-8').read()
def R(a, b, n=1):
    global r
    assert a in r, a[:80]
    r = r.replace(a, b, n)

# ── cartouche : filets fins homogènes (0,25 mm), cellules alignées, logo sans cadre ──
css_new = """footer{position:absolute;left:10mm;right:10mm;bottom:5mm;height:14mm;display:grid;grid-template-columns:52mm 30mm 62mm 1fr 26mm;border:0.35mm solid #000;background:#fff;color:#000}
footer>div,footer>img{border-right:0.25mm solid #000}footer>:last-child{border-right:0}
footer .mga{display:flex;align-items:flex-end;padding:0 0 1.6mm 3mm}
.mga span{font-family:'Times New Roman',serif;font-size:6.5pt;margin-right:1mm}.mga b{font-family:'Times New Roman',serif;font-weight:400;font-size:22pt;line-height:.8;border-right:0.25mm solid #000;padding-right:1mm}
footer .sm{width:100%;height:14mm;object-fit:contain;padding:1.5mm 2.5mm;box-sizing:border-box;filter:grayscale(1) contrast(1.2)}
footer .ef{font-size:7.5pt;line-height:1.35;display:flex;flex-direction:column;justify-content:center;padding:0 3mm;letter-spacing:.02em;text-transform:uppercase}.ef b{text-transform:none;font-size:9pt;letter-spacing:0}
footer .pt{font-size:12pt;font-weight:700;display:flex;align-items:center;padding:0 5mm}
footer .no{display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:7pt}.no b{font-size:15pt;line-height:1}"""
lines = r.split('\n')
i0 = next(i for i, l in enumerate(lines) if l.startswith('footer{position:absolute'))
i1 = next(i for i, l in enumerate(lines) if l.startswith('footer .no{'))
lines[i0:i1 + 1] = css_new.split('\n')
r = '\n'.join(lines)
R('.body{position:absolute;left:12mm;right:12mm;top:10mm;bottom:22mm}', '.body{position:absolute;left:10mm;right:10mm;top:9mm;bottom:22mm}')
R("'<div class=\"ef\">Etude de faisabilité<br><b>FJT · BH 513 à Saint-André</b></div>", "'<div class=\"ef\">Étude de faisabilité<b>FJT · BH 513 · Saint-André</b></div>")

# ── programme : locaux associés en RDC du bâtiment B ──
R("('Bât. B', 'RDC', '3 logements PMR, salle d\\'étude / atelier, local poubelles, local technique', 2, 1, None),",
  "('Bât. B', 'RDC', '3 logements PMR · <b>locaux associés</b> ouverts sur le chemin (salle d\\'activités / accueil associatif, atelier, local vélos) · local poubelles, local technique', 2, 1, None),")
R("<tr><td>Stationnement</td><td class=n>20 pl.</td><td>1 / 3 lgts · dont 1 PMR · + 60 places vélos</td></tr>",
  "<tr><td>Stationnement</td><td class=n>27 pl.</td><td>dont 1 PMR (besoin programme 20 pl. = 1 / 3 lgts) · + 60 places vélos</td></tr>\n<tr><td>Locaux associés RDC</td><td class=n>≈ 90 m²</td><td>bât. B, vitrine sur le chemin Mille Roches</td></tr>")
r = r.replace("20 pl. (1 pour 3 lgts) dont 1 PMR", "%d pl. dont %d PMR (besoin 20 = 1 / 3 lgts)")
r = r.replace("""lot, shab, sdp, empr, round(100*empr/lot), v['gap'], pk, v['perm_pct'])""",
              """lot, shab, sdp, empr, round(100*empr/lot), v['gap'], PARK[v['key']][0], PARK[v['key']][1], v['perm_pct'])""")
R("V1 = next(v for v in VARS if v['key'] == 'V1')", "PRJC = json.load(open('fjt_project_city.json')); PARK = {v['key']: (v['parkingLayout']['stalls'], v['parkingLayout']['pmr']) for v in PRJC['variants']}\nV1 = next(v for v in VARS if v['key'] == 'V1')")
r = r.replace("toiture tôle deux pans 12°", "toiture monopente tôle peinte 10° (point haut côté logements, égout sur la noue du jardin)")
r = r.replace("toitures tôle peinte gris", "toitures monopentes en tôle peinte grise, égout vers le jardin")
r = r.replace("Le parking de 20 places, à l'ouest sur la servitude, est desservi directement depuis le chemin.",
              "Le parking, à l'ouest sur la servitude, est tracé aux normes (bataille, allée 5,50 m, NF P 91-100) : 27 places dont 1 PMR pour 20 requises, la réserve pouvant devenir jardin ou places visiteurs.")
R("<li>Parking inchangé à l'ouest.</li>", "<li>Parking à l'ouest réduit à 19 places (1 de moins que le besoin) : à compenser par une place sur le chemin ou en réduisant le décalage.</li>")

# ── coupes : légendes affinées ──
R("<div class=\"sec\"><div class=\"cap\">Coupe AA — transversale nord-sud au droit des deux lames (regard vers l'ouest) · chemin Mille Roches à gauche (sud), lot SIDR à droite (nord)</div>%s</div>",
  "<div class=\"sec\"><div class=\"cap\"><b>Coupe AA</b> — transversale nord-sud au droit des deux lames, regard vers l'ouest · 1/500 · <i>sud (chemin Mille Roches) à gauche, nord (lot SIDR) à droite</i></div>%s</div>")
R("<div class=\"sec\"><div class=\"cap\">Façade urbaine sud — depuis le chemin Mille Roches (regard vers le nord)</div>%s</div>",
  "<div class=\"sec\"><div class=\"cap\"><b>Façade urbaine sud</b> — depuis le chemin Mille Roches, regard vers le nord · 1/500 · bâtiment B au premier plan, bâtiment A en arrière-plan</div>%s</div>")
R("<div class=\"sec\"><div class=\"cap\">Façade urbaine ouest — depuis le chemin Mille Roches ouest (regard vers l'est)</div>%s</div>",
  "<div class=\"sec\"><div class=\"cap\"><b>Façade urbaine ouest</b> — depuis le chemin Mille Roches (côté parking), regard vers l'est · 1/500 · pignons bardés, monopentes</div>%s</div>")
r = re.sub(r"<p class=note>Terrain naturel : IGN RGE ALTI / LiDAR HD \(trait fort\).*?</p>",
  "<p class=note><b>Légende</b> — terrain naturel (IGN RGE ALTI / LiDAR HD) en trait fort, sol hachuré · bâti existant (IGN BD TOPO, hauteurs mesurées) en gris, dégradé selon la profondeur ; sa partie sous le terrain naturel est masquée · arbres (LiDAR HD + semis de la maquette) au trait, ceux devant le projet en simple contour · <b>projet en couleur</b> : coupe des planchers en brique, logements en sable, varangues, bardage bois, vitrages bleus · RDC calé 0,60 m au-dessus du TN (PPR B3), niveaux de 3,00 m, varangue 1,20 m, coursive 1,50 m, toiture monopente 10° · cotes en m NGR (IGN69 / NGR Réunion).</p>", r, flags=re.S)

# ── vues : trois images IA (trois points de vue distincts) ──
i = r.index("P.append(page('A.8', 'Vues — variante 1'")
j = r.index("P.append(page('A.9'")
r = r[:i] + '''P.append(page('A.9', 'Vues — variante 1', \'\'\'
<div class="persp"><figure class="big"><img src="ia_V1_so_nano.png"><figcaption>Vue aérienne depuis le sud-ouest — parking, lames R+3 à monopente, jardin central</figcaption></figure>
<figure><img src="ia_V1_rue_nano.png"><figcaption>Depuis le chemin Mille Roches — bâtiment B, locaux associés vitrés en RDC</figcaption></figure>
<figure><img src="ia_V1_jardin_nano.png"><figcaption>Le jardin central entre les lames — coursives, noue paysagère</figcaption></figure></div>
<p class=note>Images d'ambiance générées par IA (Leonardo / nano-banana) à partir des vues de la maquette 3D (IGN BD TOPO V3, RGE ALTI, LiDAR HD, orthophoto) — volumétrie calée sur la maquette, matériaux et ambiance non contractuels.</p>\'\'\'))
''' + r[j:]
R("P.append(page('A.9', 'Tableau de surfaces", "P.append(page('A.10', 'Tableau de surfaces")

# ── plan masse coloré 1/500 (planche pleine, après la variante 2) ──
pc = '''
P.append(page('A.6', 'Plan masse coloré — variante 1 · 1/500', svg('report/plan_couleur_V1.svg').replace('href="plan_couleur_V1.jpg"', 'href="plan_couleur_V1.jpg"'), 'planmasse'))
'''
anchor = "P.append(page('A.6', 'Coupes et façades urbaines"
R(anchor, pc.strip() + "\n" + anchor.replace("'A.6'", "'A.7'"))
R("P.append(page('A.7', 'Coupe paysagère'", "P.append(page('A.8', 'Coupe paysagère'")
R(".persp{", ".planmasse .body{display:flex;justify-content:center;align-items:flex-start}\n.persp{")
open('build_report.py', 'w', encoding='utf-8').write(r)
print('ok')
