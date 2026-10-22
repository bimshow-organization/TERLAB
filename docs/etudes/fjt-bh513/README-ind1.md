# Rapport FJT Mille Roches — indice 1

Une commande (depuis `C:\GITHUB\TERLAB\docs\etudes\fjt-bh513`) :

```
python -I -X utf8 src/build_report_ind1.py
```

Produit `report-ind1/rapport.html` puis `report-ind1/rapport-ind1.pdf` (10 pages A3 paysage, via `node src/shot.cjs`, Puppeteer de TERLAB).

Tout est relu depuis la planche BVE `C:\GITHUB\code-runner\docs\bve-pro\planches\standre-bh513-fjt-final\`
(`sonde/result.json`, `pcmi.json`, `planche.json`, `maquette.json` GLB, `pieces/*.svg`, `img/`, `situation/`) ; autre planche : variable `FJT_PLANCHE`.
Après régénération de la planche, relancer la même commande.

Modules : `ind1_data.py` (lecture), `plan_couleur_ind1.py` (A.4, orthophoto IGN Géoplateforme téléchargée en WMS EPSG:2975, mise en cache), `sections_ind1.py` (A.6), `crop_bbox.cjs` (recadrage des plans A.5).
Pas d'image IA. Les clôtures sont lues dans une clé `fence`/`fences`/`clotures` de `result.json`, de la variante ou de `pcmi.json` ; à défaut, le plan A.4 et le tableau A.9 affichent un TODO visible.
