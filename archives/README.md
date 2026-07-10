# Archives — code retiré du runtime

Fichiers sortis de l'app (plus aucune référence dans le code vivant), déplacés
ici plutôt que supprimés pour référence. Ne pas importer depuis `archives/`.
(Les prototypes historiques, eux, vivent dans `proto-archive/`.)

| Fichier | Origine | Pourquoi archivé (2026-07-10) |
|---|---|---|
| `qr-code.js` | components/ | Jamais importé nulle part ; P12 a sa propre implémentation `P12.generateQR()`. Le flux QR `#session/{id}` reste à réparer côté routeur (audit D3) — ce composant n'y participait pas. |
| `cyclones-service.js` | services/ | Aucune référence dans le code vivant. |
| `user-scenario.js` | services/ | Aucune référence ; s'auto-enregistrait sur `window` mais n'était jamais importé, donc jamais exécuté. |
| `p11-fin-de-vie.html` | phases/ (`.html.archived`) | Phase P11 fin-de-vie retirée du parcours (remplacée par p11-esquisse). Suffixe `.archived` normalisé. |
| `export_terlab.py` | racine | Script d'export v1, remplacé par le pipeline print.css + Puppeteer (`scripts/random-terrain-pdf.js`). Référencé uniquement par la doc v1. |
| `test_p01.mjs` | racine | Test isolé jamais intégré ni exécuté en CI (seul `npm run test:random` vit). |

`archives/local/` (non versionné, patterns .gitignore par nom de fichier) :
vieux logs `TERLAB_export_audit_*.txt`, scratch, modèles YOLO `.pt` (~220 Mo)
— jamais référencés par le code ni les scripts.
