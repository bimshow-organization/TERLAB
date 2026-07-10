# AUDIT PRODUCTION-READY — Phase bêta-test (2026-07-10)

Audit mené sur 4 axes en parallèle : mobile, sécurité/config, robustesse/complétude, données de session/déploiement. Chaque constat pointe un `fichier:ligne` vérifié. P13 exclue (masquée volontairement).

**Verdict global** : les fondations sont saines (tolérance `TERLAB_DB === null` partout, résilience réseau avec bannières de dégradation, 24 communes couvertes, URLs relatives, CDN épinglés). Les manques bêta sont surtout **opérationnels** : sécurité Firebase non auditable, perte silencieuse de travail, éditeur d'esquisse inutilisable au doigt, zéro observabilité.

---

## 🔴 BLOQUANTS BÊTA (à traiter avant d'inviter des étudiants)

### S1 — Règles Firebase absentes du repo (RTDB + Storage)
Aucun `database.rules.json` / `storage.rules` versionné. `ownerUid` est écrit dans les données (`session-manager.js:159`) mais rien ne prouve qu'il est vérifié par les rules déployées. Comme `signInAnonymously` s'exécute automatiquement (`index.html:152`), des rules de type `auth != null` donneraient à **n'importe quel visiteur** lecture/écriture sur `/terlab/projects/*` et `/sessions/*` → un étudiant peut écraser le projet d'un autre.
**Action** : rapatrier et committer les rules ; en écriture sur `/terlab/projects/{id}` exiger `newData.ownerUid === auth.uid` ; `/users/{uid}/**` restreint à `auth.uid === $uid` ; Storage avec plafond de taille. ⚠ `firebase deploy --only database` touche les rules globales BIMSHOW — coordonner avec Amaury.

### S2 — Pas de Firebase App Check
API key publique + auth anonyme auto = RTDB/Storage utilisables hors de l'app (quota abuse, écriture massive). Activer App Check (reCAPTCHA v3) et l'imposer côté rules.

### D1 — Perte totale et silencieuse du travail sur quota localStorage
`session-manager.js:128-136` : sur `QuotaExceededError`, `setItem` jette **avant** `this._dirty = true` → ni sauvegarde locale, ni sync cloud au tick suivant (`syncFirebase` sort si `!_dirty`, `:144`). Cause aggravante : les 7 snapshots `snap_*` (JPEG base64, ~60-100 Ko chacun, `map-viewer.js:130-133`) sont purgés avant le push cloud (`:150`) mais **pas** avant le localStorage.
**Action** : `_dirty = true` avant `setItem` ; ne pas persister les `snap_*` en localStorage (mémoire ou IndexedDB) ; toast bloquant + proposition d'export `.terlab` en cas de quota.

### D2 — Sync last-write-wins sans garde : conflits téléphone/desktop
`syncFirebase()` fait un `SET` complet toutes les 60 s + `beforeunload`, sans comparaison de `lastUpdated`, sans verrou, sans écoute `storage`/`BroadcastChannel` entre onglets. Un onglet desktop oublié écrase le travail fait sur téléphone.
**Action minimum bêta** : lire `lastUpdated` distant avant `SET` et avertir en cas de conflit ; écouter l'event `storage` pour synchroniser les onglets d'un même navigateur.

### M1 — Éditeur d'esquisse P07/P11 inutilisable au doigt
`components/esquisse-canvas.js` : uniquement `mousedown`/`mousemove` (`:3617`, `:3629-3671`), aucun pointer/touch event — et c'est le moteur **par défaut** (`TERLAB_USE_METAFORME` undefined → legacy, `p07-esquisse.html:2364`). Le moteur Métaforme utilise des pointer events mais exige Shift+hover pour insérer/supprimer un sommet (`metaforme-events.js:51-68`) et le SVG n'a pas de `touch-action:none` → conflit drag/scroll.
**Action** : faire de Métaforme le défaut sur mobile + `touch-action:none` + remplacer Shift/hover par des interactions tactiles (boutons « + / − sommet », appui long). Sans ça, le cœur pédagogique des phases esquisse est mort sur téléphone.

### R1 — Zéro télémétrie ni handler d'erreur global
Aucun `window.onerror` / `unhandledrejection` dans le repo. L'objectif du bêta est de récolter les bugs : aujourd'hui une exception → phase blanche, et personne ne le saura.
**Action** : handler global qui pousse dans `terlab/beta-errors/{uid}` (RTDB) + bouton « Signaler un problème » (mailto ou formulaire) visible dans la topbar.

### R2 — Navigateur ancien = page blanche muette
importmap (Safari 16.4+), top-level await, `AbortSignal.timeout()` dans 22 fichiers (Safari 16+). Un iPad iOS 15 affiche un écran blanc sans message.
**Action** : script de détection ES5 en tête d'index.html + accueil.html → message « navigateur non supporté, utilisez Chrome/Safari récent ».

---

## 🟠 IMPORTANTS (pendant la bêta, ordre conseillé)

| # | Constat | Preuve | Action |
|---|---|---|---|
| S3 | Token Mapbox dev « ashkenazior » sans restriction URL, compte tiers | `index.js:222`, `corpus-viewer.html:635` | Token bimshow + Allowed URLs (cf. `config/MAPBOX_SETUP.md`) |
| S4 | XSS stocké dans accueil.html (nom projet, commune, thumbnailUrl injectés en innerHTML non échappés) | `accueil.html:956-1001` | Helper `escapeHtml()` sur toutes les interpolations de la grille |
| S5 | RGPD : email étudiant en RTDB (`/terlab/users/{uid}`) + localStorage, aucune mention d'information, pas de flux d'effacement complet | `index.html:710-714` | Mention d'information + purge `/terlab/users/{uid}` à la suppression |
| D3 | Flux QR `#session/{id}` cassé : le routeur ne matche que `#phase/N`, redirige vers accueil sur appareil neuf | `index.js:500-503`, `:195-202` vs `session-manager.js:368` | Gérer `#session/{id}` → `restoreFromFirebase` avant la redirection accueil |
| D4 | CDN mono-source sans SRI ni fallback (jsdelivr, unpkg, gstatic, mapbox) — Wi-Fi école filtrant = phases 3D mortes | `index.html:17-88` | Copie locale des libs critiques (three, laz-perf) ou SRI + message d'erreur clair |
| D5 | Domaine de déploiement vs Authorized Domains Firebase + URLs QR en dur `bimshow.io/terlab/` | `pages.yml`, `firebase-config.public.js:22`, `qr-code.js:32` | Vérifier dev1.bimshow.io dans Authorized Domains + Allowed URLs Mapbox ; URL QR dérivée de `location` |
| M2 | Popup mesh 3D : panneau fixe 220px → ~110px de viewport 3D sur 360px | `p01-topographie.html:1784-1793` | Drawer empilé < 800px ; généraliser le pattern `.modal-box` mobile aux popups `m3-*` |
| M3 | Aucun garde-fou perf mobile (pas de `deviceMemory`/`maxTextureSize`, LiDAR+Three+Mapbox simultanés) | grep négatif repo | Détection terminal faible + plafond densité points + mode léger |
| M4 | accueil.html sans adaptation mobile ; inputs 15px → zoom auto iOS | `accueil.html:125`, aucun media query | Inputs ≥16px, test portrait, charger le comportement mobile |
| M5 | Clavier virtuel masque les inputs du bottom sheet (aucune gestion `visualViewport`) | `mobile.css:369` | Remonter le sheet sur focus input |
| M6 | `user-scalable=no` + libellés 8-9px = illisible en plein soleil (WCAG) | `index.html:5`, `mobile.css:139-584` | Retirer `user-scalable=no`, remonter les tailles mini |
| R3 | Cache IndexedDB LiDAR sans éviction ni `storage.persist()` | `lidar-cache.js:110` | LRU/TTL + plafond + `navigator.storage.persist()` |
| D6 | Migration schéma : registre inexistant, `terlab-storage.js` crée en `1.0` alors que session-manager est en `1.1` | `terlab-storage.js:34` vs `session-manager.js:4` | Aligner les constantes + registre de migrations cumulatives (la règle CLAUDE.md `_migrateIfNeeded` ne correspond pas au code réel) |
| D7 | Aucun onboarding / aide / canal feedback in-app | grep négatif | Tutoriel 1er lancement minimal + bouton feedback (cf. R1) |

---

## 🟡 MINEURS (après la bêta)

- Éviction silencieuse à 15 sessions + suppression sans corbeille (`terlab-storage.js:184`) — avertir avant éviction, rappeler l'export `.terlab`.
- Pas de cache-busting `?v=` sur les modules → mix de versions possible pendant un redéploiement (`index.html:777-787`).
- Pas de `.nojekyll` ; l'artefact Pages embarque tout le repo (data/ 14 Mo, prompts/, tests).
- OCR PDF P00 = stub annoncé (`p00-identification.html:281`) ; export IFC = stub (`p12-synthese.html:146`) ; `edf-service.js` mort (API 410).
- P13 inaccessible via nav mobile (voulu ?) ; thème ivory masqué en mobile (`mobile.css:824`) alors que c'est le bon thème plein soleil ; tap carte ferme le sheet ; tooltips `title=` hover-only.
- Sessions anonymes `/sessions/{uuid}` sans TTL ; `TERLAB_ACCESS_CODE` défini mais jamais appliqué (garde-fou mort).
- Timeouts durs export PDF (8 s / iframe supprimée à 2 s) fragiles sur mobile lent (`export-engine.js:263-276`).
- Stepper mobile : P01 empile LiDAR/sections/bioclim hors `.form-section` → étapes surchargées (`mobile-stepper.js:71-98`).

---

## Plan d'action suggéré (2 sprints avant bêta)

**Sprint 1 — sécurité & données (rien d'autre ne compte si un étudiant perd son travail ou celui d'un autre)**
1. Rules RTDB/Storage committées + ownership vérifié (S1) — avec Amaury
2. Fix `_saveLocal` quota + snapshots hors localStorage (D1)
3. Garde de conflit sync + event `storage` (D2)
4. Handler d'erreurs global + bouton feedback (R1/D7)
5. escapeHtml accueil (S4) + token Mapbox bimshow (S3)

**Sprint 2 — mobile & terrain**
6. Esquisse tactile : Métaforme par défaut mobile + touch-action + interactions doigt (M1)
7. Écran navigateur non supporté (R2)
8. Popup mesh 3D + accueil mobile + clavier virtuel (M2/M4/M5)
9. Garde-fous perf mobile (M3)
10. Fix flux QR `#session/{id}` (D3) + App Check (S2)

**Jour J bêta** : vérifier Authorized Domains + quota Mapbox, tester sur le Wi-Fi réel de l'ENSA (CDN accessibles ?), prévoir un iPad récent de secours, rappeler l'export `.terlab` comme backup en fin de séance.
