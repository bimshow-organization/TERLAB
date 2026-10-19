# TODO — TERLAB

## Outillage de test — adopter Vitest (ajouté le 29-09-2026)

TERLAB n'a aujourd'hui **aucun test automatisé** (pas de framework, 0 fichier `*.test.*` / `*.spec.*`). Web-app est passé de Karma à Vitest le 29-09-2026 (commit `58da636c`) : suite 2× plus rapide, sans navigateur, mode watch, un seul outil commun avec bimshow-vision. Vitest convient bien à un projet JS vanilla en modules ES comme TERLAB : aucune configuration Angular, `npx vitest` suffit.

- [ ] Installer `vitest` (+ `jsdom` seulement si besoin) en dépendance de dev, script `"test": "vitest run"`.
- [ ] **Commencer par le pur**, là où une erreur coûte cher et se teste sans DOM :
  - `services/` (119 fichiers) — calculs réglementaires et de capacité : `capacity-model.js`, `capacite-polygone.js`, `cbs-calculator-service.js`, `anc-service.js`, `auto-plan-engine.js` / `auto-plan-strategies.js` ;
  - `utils/` (22 fichiers) — géométrie, conversions, formats ;
  - `plu-schemas/` — lecture et validation des règles PLU.
  Objectif réaliste pour démarrer : 15-20 tests sur ces fonctions, avec des cas réels (parcelles déjà étudiées) comme références.
- [ ] Les services qui appellent des API externes (BD TOPO, BRGM, cadastre…) : tester le **traitement** de la réponse avec des fixtures enregistrées (`vi.mock` / fichiers JSON dans `tests/fixtures/`), jamais l'appel réseau réel.
- [ ] `components/` et le rendu carte / 3D restent hors périmètre unitaire (navigateur réel) — Vitest a un « mode navigateur » si un jour c'est utile.
- [ ] Une fois une première suite verte : la lancer avant chaque déploiement.

⚠ Leçon web-app : ne jamais lancer un codemod / outil de réécriture sur tout le dépôt — le limiter à ses dossiers (`services/`, `utils/`…), sinon il réécrit aussi les worktrees d'agents sous `.claude/worktrees/` et `node_modules/`.
