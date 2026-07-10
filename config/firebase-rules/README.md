# Règles Firebase TERLAB — source de vérité : repo `cloud-functions`

Les règles de sécurité RTDB + Storage du projet Firebase partagé BIMSHOW sont
versionnées dans **`C:\GITHUB\cloud-functions`** (`database.rules.json`,
`storage.rules`, déployées via son `firebase.json`). Ne pas dupliquer de
règles ici — ce dossier ne contient que cette documentation.

## État (2026-07-10)

Couverture déjà en place côté rules :

- `terlab/projects/{id}` : lecture ET écriture réservées au propriétaire
  (`ownerUid === auth.uid`), transfert d'ownership interdit.
- `terlab/users/{uid}` et `users/{uid}` (index `terlabProjects`) : self-only.
- `sessions/{uuid}` : lecture publique par UUID (design QR, UUID non
  devinable), écriture auth. `.validate` exige `sessionId`.
- Storage `terlab/{uid}/**` : lecture publique (thumbnails/QR), écriture
  propriétaire, plafond 25 Mo.
- Default deny à la racine RTDB.

Ajouté le 2026-07-10 dans `cloud-functions/database.rules.json` (à déployer —
coordonner avec Amaury, le deploy écrase les rules globales) :

- `terlab/beta-errors/{sessionId}/{errorId}` : append-only clients, lecture
  interdite — requis par `components/error-monitor.js` (télémétrie bêta).
- `terlab/projects` : écriture refusée aux comptes **anonymes**
  (`auth.provider !== 'anonymous'`) — l'auto `signInAnonymously` ne doit pas
  permettre de créer des projets user-scoped.

## Invariants côté code TERLAB (ne pas casser)

- `session-manager.js` écrit `ownerUid = uid` sur chaque SET de
  `terlab/projects/{sid}` — la règle `.write` en dépend.
- `error-monitor.js` écrit `{message: string ≤ 500, …}` sous
  `terlab/beta-errors/{sessionId}/{id}`, sans jamais relire.
- Les sessions anonymes `/sessions/{uuid}` embarquent `sessionId`.

## Reste à faire (post-bêta)

- **App Check** (reCAPTCHA v3) imposé côté rules.
- Purge TTL des `/sessions/*` anciennes — une fonction `onSchedule` existe
  déjà dans cloud-functions (`updateTrialActive`) comme modèle.
- Purge `terlab/users/{uid}` à la suppression de compte (RGPD).
- Éventuel remplacement du feedback mailto par le système de tickets
  cloud-functions (`openNewTicket`).
