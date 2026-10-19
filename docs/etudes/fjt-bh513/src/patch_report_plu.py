import shutil
shutil.copy(r'C:\Users\mathi\AppData\Local\Temp\claude\c--GITHUB-TERLAB\2dc08a07-66b3-4adc-8ad6-1862baf59853\scratchpad\zoning\bh513_zoning_tight.png', 'report/plu_zonage_bh513.png')
r = open('build_report.py', encoding='utf-8').read()
rep = [
 ("<dt>Zone PLU</dt><dd>à confirmer (PLU approuvé 07/2025)</dd>",
  "<dt>Zone PLU</dt><dd><b>Ue</b> — équipements (PLU approuvé le 02/07/2025) · hébergement interdit : évolution du PLU requise</dd>"),
 # A.1 : bloc PLU
 ("""<h3>PLU</h3><p class=warn>Le PLU approuvé en 07/2025 n'est pas encore publié sur le Géoportail de l'urbanisme : zonage et règles <b>à confirmer</b> avec la Ville. Hypothèses de travail (règles UC du PLU 2019) : recul 4 m sur voie, 3 m sur limites séparatives, hauteur 9 m à l'égout portée à 12 m sur 40 %% de l'emprise pour les opérations > 2 000 m² de SDP ; 30 %% d'espaces perméables. <b>Le R+3 demandé (≈ 12,6 m à l'égout) est à valider au regard du nouveau règlement.</b></p>""",
  """<h3>PLU approuvé le 02/07/2025 — zone Ue</h3><p>BH 513 est intégralement classée en <b>zone Ue</b> (« zones d'équipements » : stades, gymnases, services techniques…), au sein de la zone Ub. Aucune OAP, aucun emplacement réservé ni EBC sur la parcelle (planche n°2 Centre-ville / Cressonnière).</p>
<p class=warn><b>Point bloquant</b> — en Ue, la sous-destination <b>« hébergement » est interdite</b> et le logement n'est admis que pour le gardiennage (70 m² de SDP). Un FJT relève de l'hébergement (« foyers de travailleurs », art. R151-28). Le projet — comme les 20 LLS de la SIDR — suppose une <b>évolution du PLU</b> (modification ou déclaration de projet emportant mise en compatibilité, reclassement en Ub), ou une qualification en équipement d'intérêt collectif à faire valider par le service instructeur.</p>
<p>Règles Ue retenues pour l'étude : hauteur <b>16 m</b> (R+3 ≈ 12,6 m à l'égout : conforme) ; recul <b>3 m</b> sur voie ; <b>4 m</b> sur limites séparatives et de fond ; pas de ratio de stationnement imposé (le programme retient 1 place / 3 lgts) ; <b>pas de blanc en paroi</b> ni de tôle non peinte ; sol protégé du soleil sur 3 m au droit de 50 %% des façades.</p>"""),
 # A.2 : enveloppe
 ("<tr><td>Reculs voie 4 m · limite SIDR 3 m</td><td>—</td></tr>", "<tr><td>Reculs Ue : voie 3 m · limites 4 m</td><td>—</td></tr>"),
 ("<tr><td><b>Enveloppe constructible</b></td><td><b>2 180 m²</b></td></tr>", "<tr><td><b>Enveloppe constructible</b></td><td><b>2 242 m²</b></td></tr>"),
 ("<tr><td>Enveloppe constructible</td><td>2 180 m²</td></tr>", "<tr><td>Enveloppe constructible</td><td>2 242 m²</td></tr>"),
 ("<figure><img src=\"terlab_ppr.png\"><figcaption>PPRN approuvé — PEIGEO</figcaption></figure>",
  "<figure><img src=\"plu_zonage_bh513.png\"><figcaption>PLU 2025 — zonage Ue de BH 513 (contour cadastral en rouge) · planche n°2</figcaption></figure>"),
 # vigilance
 ("<li><b>PLU 07/2025</b> : zonage, hauteur (R+3 ≈ 12,6 m à l'égout), prospects, stationnement et espaces perméables à vérifier.</li>",
  "<li><b>PLU 2025 — zone Ue</b> : l'hébergement (FJT) y est <b>interdit</b>. Évolution du PLU à engager avec la Ville (reclassement en Ub par modification ou déclaration de projet), en commun avec l'opération SIDR. Hauteur (16 m) et reculs (3 / 4 m) compatibles.</li>"),
 ("<li>Réunion de calage SEMAC / MLE / NKN sur l'assiette et le programme.</li>",
  "<li>Réunion Ville / SEMAC / SIDR sur la <b>procédure d'évolution du PLU</b> (zone Ue).</li><li>Réunion de calage SEMAC / MLE / NKN sur l'assiette et le programme.</li>"),
 ("<li>Façades principales nord / sud, faciles à protéger.</li>",
  "<li>Façades principales nord / sud, faciles à protéger ; enduit teinte sable (PLU : pas de blanc en paroi), toitures tôle peinte gris.</li>"),
]
for a, b in rep:
    assert a in r, a[:70]
    r = r.replace(a, b)
open('build_report.py', 'w', encoding='utf-8').write(r)
print('ok', len(rep))
