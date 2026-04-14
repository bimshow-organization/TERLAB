# Mode d'emploi — Déployer TERLAB sur `dev1.bimshow.io/terlab/`

> Audience : Asmahani (ops + déploiement)
> Durée estimée : 30–45 min la première fois
> Droits nécessaires : SSH runner, SSH gateway, Firebase console admin sur `bimshow-dev1`

> ℹ️ **État actuel** : le lien TERLAB dans la nav du site marketing pointe **temporairement** sur `bimshow-organization.github.io/TERLAB/` (github.io, déploiement historique via `pages.yml` sur `main`). Le but de ce guide est de basculer sur `dev1.bimshow.io/terlab/` pour gagner le SSO avec les autres apps. **Étape 6 ci-dessous** bascule le lien côté website une fois le dev1 validé.

---

## Pourquoi cette migration ?

TERLAB tourne aujourd'hui sur `bimshow-organization.github.io/TERLAB/` (GitHub Pages). On le **migre** vers `https://dev1.bimshow.io/terlab/` pour une seule raison : **mettre TERLAB sur la même origine que le site vitrine et la web-app BIMSHOW**.

Conséquence directe : les 3 apps partagent **automatiquement** la même session Firebase Auth (stockée dans IndexedDB, scope = origine + projectId). Donc un user connecté une fois sur `dev1.bimshow.io` est connecté partout (landing, `/app/`, `/terlab/`, `/houseg-speech`, `/plant-factory-ng/`).

Pour que ça fonctionne, **TERLAB doit utiliser le projet Firebase `bimshow-dev1`** (au lieu de `bimshow-preprod1` aujourd'hui). La partie délicate : garder le code TERLAB agnostique du projet, et **injecter la bonne config au moment du déploiement**.

---

## Architecture cible

```
Utilisateur (navigateur)
        │
        ▼
gateway.dev1.bimshow.io (nginx)
  /             → /opt/nginx/website/       (landing marketing)
  /app/         → /opt/nginx/web-app/       (app BIMSHOW Angular)
  /terlab/      → /opt/nginx/terlab/        ← nouveau
  /houseg-speech → ...
  /plant-factory-ng/ → ...

GitHub (TERLAB, branche `development`)
        │  push
        ▼
GitHub Actions (self-hosted runner, workflow .github/workflows/dev1.yml)
  1. checkout
  2. copie vers /opt/node/terlab sur le runner
  3. cp /opt/node_app_conf_file/terlab/firebase-config.js → /opt/node/terlab/config/firebase-config.js
  4. scp vers gateway.dev1.bimshow.io:/opt/nginx/terlab

Firebase project `bimshow-dev1` (shared avec site + app)
  - Authentication → dev1.bimshow.io dans Authorized Domains
  - RTDB, Storage, etc.
```

---

## Pré-requis à vérifier AVANT de commencer

- [ ] SSH au runner self-hosted fonctionnel (celui qui exécute les workflows `Development-CD`)
- [ ] SSH `gateway.dev1.bimshow.io` fonctionnel depuis le runner (le CI l'utilise déjà pour le website)
- [ ] Accès admin à la Firebase console sur le projet **`bimshow-dev1`**
- [ ] Repo TERLAB cloné, à jour sur la branche `development`
- [ ] Le workflow `.github/workflows/dev1.yml` existe sur la branche `development` (commit `61b598f` ou plus récent — vérifier avec `git log --oneline development`)

---

## Étape 1 — Créer le fichier config Firebase sur le runner

Sur le runner self-hosted (où tournent les jobs Actions) :

```bash
ssh <runner>

sudo mkdir -p /opt/node_app_conf_file/terlab
sudo tee /opt/node_app_conf_file/terlab/firebase-config.js > /dev/null <<'EOF'
// Config Firebase TERLAB pour dev1.bimshow.io — projet bimshow-dev1
// Ce fichier est injecté par le workflow CI dev1.yml à chaque déploiement.
// Même projet que website + web-app → SSO automatique via IndexedDB partagée.
export const firebaseConfig = {
  apiKey:            "AIzaSyBVzudmKVGnE3Lmgyuttx2NF7zhG0Q0ShA",
  authDomain:        "bimshow-dev1.firebaseapp.com",
  databaseURL:       "https://bimshow-dev1.firebaseio.com",
  projectId:         "bimshow-dev1",
  storageBucket:     "bimshow-dev1.appspot.com",
  messagingSenderId: "337558794368",
  appId:             "1:337558794368:web:9829c299c9c46af1f8b665"
};

// Code d'accès TERLAB (à distribuer aux étudiants si toujours en usage)
export const TERLAB_ACCESS_CODE = 'TERLAB2026';
EOF

# Vérifier les droits : le user sous lequel tourne le runner doit pouvoir lire
sudo chmod 644 /opt/node_app_conf_file/terlab/firebase-config.js

# Vérification
cat /opt/node_app_conf_file/terlab/firebase-config.js | head
```

**Pourquoi ici et pas dans le repo ?**
La clé API Firebase web n'est pas un secret (elle est destinée au navigateur, cf. le commentaire dans `config/firebase-config.public.js`). On l'injecte quand même au build pour deux raisons :
1. Garder `bimshow-preprod1` comme config par défaut dans le repo (usage github.io historique + étudiants ENSA)
2. Permettre plus tard d'utiliser `bimshow-prod` en prod sans modifier le code

---

## Étape 2 — Ajouter la location nginx sur la gateway

```bash
ssh gateway.dev1.bimshow.io

sudo nano /etc/nginx/sites-available/dev1.bimshow.io
```

Ajouter, **dans le server block qui sert `dev1.bimshow.io`**, avant la directive catch-all `/` :

```nginx
location /terlab/ {
    alias /opt/nginx/terlab/;
    try_files $uri $uri/ /terlab/index.html;
}
```

Tester + recharger :

```bash
sudo nginx -t
# syntax is ok ? configuration file test is successful ? → OK
sudo systemctl reload nginx
```

**Piège classique** : ne pas oublier le `/` final dans `alias /opt/nginx/terlab/;`. Avec nginx, `alias` vs `root` est source d'erreurs — utiliser `alias` ici (remplace le préfixe) plutôt que `root` (concatène).

---

## Étape 3 — Autoriser `dev1.bimshow.io` dans Firebase Auth

Sans ça, Firebase refusera de signer l'utilisateur depuis ce domaine (erreur `auth/unauthorized-domain`).

1. Ouvrir https://console.firebase.google.com
2. Sélectionner le projet **`bimshow-dev1`**
3. Menu latéral → **Authentication** → onglet **Settings** → bloc **Authorized domains**
4. Cliquer **Add domain**, saisir `dev1.bimshow.io`, valider
5. Vérifier que la liste contient au minimum :
   - `localhost`
   - `bimshow-dev1.firebaseapp.com`
   - `bimshow-dev1.web.app`
   - `dev1.bimshow.io` ← celui qu'on vient d'ajouter

---

## Étape 4 — Déclencher le premier déploiement

Deux options :

### Option A — Déclenchement manuel (recommandé pour la première fois)

```bash
cd c:/GITHUB/TERLAB
git checkout development
gh workflow run "Development-CD (dev1.bimshow.io/terlab)" -r development
gh run watch   # suit l'exécution en temps réel
```

### Option B — Push d'un changement sur `development`

```bash
cd c:/GITHUB/TERLAB
git checkout development
# faire un petit changement (ex: bump version dans README)
git commit -am "chore: trigger dev1 deploy"
git push origin development
```

Le workflow devrait prendre < 1 min. S'il échoue, voir la section **Dépannage**.

---

## Étape 5 — Validation en navigateur

Ouvrir **une session de navigation privée** (important pour partir d'un cache propre).

1. Aller sur `https://dev1.bimshow.io/` — vérifier que la landing s'affiche (page marketing BIMSHOW).
2. Cliquer sur **Connexion** dans la nav, se connecter avec un compte de test.
3. Une fois connecté, ouvrir un nouvel onglet et aller sur `https://dev1.bimshow.io/terlab/accueil.html`.
   - **Attendu** : la session est détectée automatiquement, le user n'a pas à se reconnecter.
   - `accueil.html` est la seule page TERLAB qui a le wiring Firebase pour l'instant (cf. limite connue ci-dessous).
4. Vérifier dans la console DevTools :
   - Pas d'erreur `auth/unauthorized-domain`
   - `window.TERLAB_AUTH.currentUser` doit retourner l'objet user (email, uid, etc.)
   - Application → IndexedDB → `firebaseLocalStorageDb` → contient bien une entrée pour `bimshow-dev1`

Si tout est OK → la migration **côté TERLAB** est fonctionnelle. Passer à l'Étape 6 pour que les users soient redirigés depuis le site marketing.

---

## Étape 6 — Basculer le lien TERLAB dans la nav du site marketing

Le site (`https://dev1.bimshow.io/`) a dans son menu utilisateur un lien "TerLab" qui pointe aujourd'hui sur `bimshow-organization.github.io/TERLAB/index.html` (fallback historique). Une fois TERLAB validé sur dev1 (Étape 5 ✓), on bascule ce lien sur `/terlab/` pour activer le SSO.

```bash
cd c:/GITHUB/website
git checkout development
git pull
```

Dans `template.html`, repérer le bloc :

```html
<!-- TERLAB: temporary fallback to github.io until dev1 deploy is live.
     Once /opt/nginx/terlab is in place and location /terlab/ is
     configured (see TERLAB/docs/DEPLOY-DEV1.md), flip back to "/terlab/"
     for same-origin SSO. -->
<a href="https://bimshow-organization.github.io/TERLAB/index.html" target="_blank" rel="noopener" role="menuitem">{{userMenu.terlab}} <span class="user-menu-ext">↗</span></a>
```

Le remplacer intégralement par :

```html
<a href="/terlab/" target="_blank" rel="noopener" role="menuitem">{{userMenu.terlab}} <span class="user-menu-ext">↗</span></a>
```

Puis :

```bash
node i18n/build.mjs
git add -A
git commit -m "fix(nav): flip TERLAB link to /terlab/ (dev1 deploy is live)"
git push origin development
```

Le CI website `Development-CD` se déclenche (~30 sec). Après hard-refresh sur `https://dev1.bimshow.io/`, cliquer sur **TerLab** dans le menu user doit ouvrir un nouvel onglet sur `https://dev1.bimshow.io/terlab/` au lieu de github.io, avec la session user préservée.

---

## Dépannage

| Symptôme | Cause probable | Action |
|---|---|---|
| `404 Not Found` sur `/terlab/` | Location nginx absente ou mal écrite | Re-vérifier Étape 2, vérifier `sudo nginx -T | grep terlab` |
| `403 Forbidden` sur `/terlab/` | Droits fichiers `/opt/nginx/terlab/` incorrects | `ssh gateway 'ls -la /opt/nginx/terlab/ \| head'` ; le user `www-data` doit pouvoir lire |
| Firebase console log : `auth/unauthorized-domain` | Oubli Étape 3 | Ajouter `dev1.bimshow.io` aux Authorized domains |
| Connecté sur landing mais pas sur `/terlab/accueil.html` | TERLAB charge toujours `firebase-config.public.js` (bimshow-preprod1) au lieu du dev1 | Vérifier que `/opt/nginx/terlab/config/firebase-config.js` existe sur la gateway et pointe sur `bimshow-dev1` |
| CI Actions : `cp: No such file: /opt/node_app_conf_file/terlab/firebase-config.js` | Étape 1 manquante | Refaire Étape 1 |
| Connexion OK sur `/terlab/accueil.html` mais perdue sur `/terlab/index.html` | **Limite connue**, voir section suivante | Pour l'instant, rediriger les users depuis `accueil.html` |

Commandes utiles pour diagnostiquer :

```bash
# Vérifier que le fichier est bien sur la gateway
ssh gateway.dev1.bimshow.io 'cat /opt/nginx/terlab/config/firebase-config.js | head -5'
# Doit afficher: // Config Firebase TERLAB pour dev1.bimshow.io — projet bimshow-dev1

# Vérifier la route nginx
ssh gateway.dev1.bimshow.io 'nginx -T | grep -A3 "location /terlab"'

# Récupérer un index.html et voir le <title>
curl -s https://dev1.bimshow.io/terlab/ | head -20
```

---

## Limite connue : Firebase init uniquement dans `accueil.html`

Aujourd'hui, seul `accueil.html` fait le wiring Firebase (`initializeApp`, `onAuthStateChanged`, `window.TERLAB_AUTH`, lignes 626-700 environ). Les autres entry points (`index.html`, phases `p01-*.html` → `p12-*.html`) n'initialisent pas Firebase.

**Conséquence** : le SSO ne "s'active" qu'après passage par `accueil.html`. Un user qui tape directement `dev1.bimshow.io/terlab/index.html` sans passer par l'accueil ne sera pas reconnu.

**Fix définitif à planifier (P2)** : extraire le bloc `<script type="module">` Firebase de `accueil.html` dans un module dédié `components/firebase-auth.js`, l'importer depuis toutes les pages qui ont besoin de l'auth (a minima `index.html`).

Ticket à créer : *"TERLAB: extraire l'init Firebase en module partagé pour couvrir toutes les phases"*.

---

## Rollback d'urgence

Si tout casse et qu'on doit revenir au fonctionnement github.io :

1. **Retirer le lien `/terlab/` sur la landing** (pour ne pas envoyer les users sur une version cassée) :
   ```bash
   cd c:/GITHUB/website
   # Dans template.html, remettre href="https://bimshow-organization.github.io/TERLAB/index.html"
   # sur la ligne <a ... role="menuitem">{{userMenu.terlab}}
   git commit -am "rollback: TERLAB link back to github.io"
   git push origin development   # redeploie la landing sans le lien /terlab/
   ```
2. **Désactiver le workflow dev1** (optionnel) :
   ```bash
   cd c:/GITHUB/TERLAB
   gh workflow disable "Development-CD (dev1.bimshow.io/terlab)"
   ```
3. Le workflow github.io (`pages.yml` sur `main`) reste actif et continue de servir `bimshow-organization.github.io/TERLAB/` comme avant.

---

## Checklist finale

- [ ] Étape 1 : `/opt/node_app_conf_file/terlab/firebase-config.js` créé sur le runner
- [ ] Étape 2 : location nginx ajoutée, `nginx -t` OK, reload fait
- [ ] Étape 3 : `dev1.bimshow.io` ajouté dans Firebase Authorized domains du projet `bimshow-dev1`
- [ ] Étape 4 : workflow `Development-CD (dev1.bimshow.io/terlab)` exécuté avec succès
- [ ] Étape 5 : test navigation privée, SSO fonctionnel depuis la landing vers `/terlab/accueil.html`
- [ ] Étape 6 : lien TERLAB dans `template.html` du repo `website` basculé vers `/terlab/`, commit + push sur `development`, CI website OK
- [ ] (Optionnel) Ticket créé pour P2 (extraction init Firebase en module partagé)

Quand tout est coché : la migration est terminée. Prévenir le reste de l'équipe pour qu'ils utilisent désormais l'URL `https://dev1.bimshow.io/terlab/` et non plus github.io.

---

## Contacts & références

- Workflow : [`.github/workflows/dev1.yml`](../.github/workflows/dev1.yml) (branche `development`)
- Loader Firebase côté client : [`accueil.html`](../accueil.html) lignes 626-700
- Config publique fallback : [`config/firebase-config.public.js`](../config/firebase-config.public.js)
- Projet Firebase : `bimshow-dev1` — console https://console.firebase.google.com/project/bimshow-dev1
- Repo website (consomme le lien `/terlab/`) : https://github.com/bimshow-organization/website
