# Rapport : Etude de capacite maximale — bugs et spec cible

## Contexte

Parcelle test : **Les Avirons, 990 m2, zone Uc PLU**
- PLU emprMax = 60% (emprise max au sol)
- PLU permMin = 70% (espace vert minimum)
- PLU heMax = 7m → R+1 max (2 niveaux)
- RTAA zone 1 → largeur ventilation max = 10m

## Calcul de capacite attendu (fait main)

```
Budget impermeable = 990 × (1 - 70%) = 297 m2
Emprise max batiment = 297 m2 (si parking sous-sol, 0 m2 en surface)
Emprise PLU max = 990 × 60% = 594 m2

→ Le facteur limitant est le budget impermeable (297 < 594)
→ Emprise max reelle = 297 m2

Surface plancher par niveau :
  - Emprise 297 m2 × eff 0.82 = ~243 m2 utile par niveau
  - SP_MOY par logement = 57 m2 (moyenne ponderee T1-T4)
  - Logements par niveau = floor(243 / 57) = 4

Total R+1 (2 niveaux) = 4 × 2 = 8 logements

Parking requis = 8 × 2 places = 16 places × 25 m2 = 400 m2
  - Ext : 297 + 400 = 697 > 297 budget → IMPOSSIBLE
  - RdC : emprise 297 × 80% / 25 = 9 places → 16-9 = 7 en SS → OK
  - SS pur : 16 places sous le batiment → OK (297 m2 > 400 m2 sur 2 niveaux SS)

→ Resultat : 8 logements, parking SS ou RdC+SS, emprise ~297 m2
```

## Bugs identifies dans le code actuel

### Bug 1 : empriseDispo reduit par parkExt (CORRIGE)

**Fichier** : `services/plan-masse-canvas.js`, `_applyScenarioGeometry()`

Le calcul `empriseDispo` deduisait `parkExt` (50 m2) meme quand le parking devait
etre en sous-sol. Resultat : empriseDispo = 248 au lieu de 297.

**Correction** : supprimer la deduction parkExt de empriseDispo.
La geometrie calcule toujours l'emprise max possible ; le parking est gere dans metrics().

### Bug 2 : parkExt variable supprimee mais encore referencee (CORRIGE)

**Fichier** : `services/plan-masse-canvas.js`, ligne 3120

`this.S._deductions = { vegMin, ancArea, parkExt, isANC }` → `parkExt` n'existait plus
apres la suppression. Causait `ReferenceError: parkExt is not defined` qui faisait
echouer `_reApplyIfClean` silencieusement.

### Bug 3 : multiRect rejete par blocsRespectGap (CORRIGE)

**Fichier** : `services/auto-plan-strategies.js`, `multiRect()`

`blocsRespectGap(blocs, gap * 0.9)` rejetait TOUS les blocs si le gap inter-blocs
etait legerement inferieur apres clipping par l'enveloppe. La fonction retournait `[]`
→ fallback mono-rect 10×12 = 120 m2 → 3 logements seulement.

**Correction** : le gap check avertit mais ne rejette plus.

### Bug 4 : le slider logements ecrasait sa propre valeur (CORRIGE)

**Fichier** : `phases/p07-esquisse.html`, `_p07SyncEmprPermFromMetrics()`

Apres chaque render, le sync ecrivait `slLgts.value = m.nbLgts` (valeur courante = 3)
au lieu de laisser le slider a la position cible. L'utilisateur poussait a 8, le
sync le ramenait instantanement a 3.

**Correction** : ne plus ecraser slLgts.value dans le sync.

### Bug 5 : l'auto-escalade parking mutait this.S.prog.parkMode (CORRIGE)

**Fichier** : `services/plan-masse-canvas.js`

L'auto-escalade ext→SS dans `_applyScenarioGeometry` et `metrics()` ecrasait
`this.S.prog.parkMode`, rendant les boutons Ext/RdC/SS inutilisables (le code
les remettait en SS a chaque render).

**Correction** : ne jamais muter parkMode. Utiliser `geomParkMode` ou `effectiveParkMode`
en interne. Le choix utilisateur est sacre.

### Bug 6 : _reApplyIfClean bloque par _manualEdit (CORRIGE)

**Fichier** : `services/plan-masse-canvas.js`, `setProg()`

Apres un drag manuel, `_manualEdit = true` bloquait TOUS les recalculs, y compris
les changements programmatiques (parking, slider logements). Le changement Ext→SS
ne produisait aucun effet.

**Correction** : `setProg('parkMode')` et `setProg('emprCiblePct')` suspendent
temporairement `_manualEdit` pour forcer le recalcul.

### Bug 7 : PLU zone N detectee au lieu de Uc (A VERIFIER)

Le PLU adapter detecte "zone N" (confiance 75%) au lieu de "Uc" pour Les Avirons.
Ca donne permMin=30% au lieu de 70%, ce qui fausse toute l'etude de capacite.
L'emprise disponible passe de 297 m2 (permMin 70%) a 693 m2 (permMin 30%).

→ Verifier `data/plu-rules-reunion.json` pour Les Avirons, clef "Uc".

## Architecture du calcul de capacite

### Flux complet : du slider au batiment

```
Slider logements (1-max)
  │
  ├─ Calcule emprCiblePct = lgtsVal / maxLgts × 100
  ├─ Auto-switch niveaux (R+0 si peu, R+1 si > lgtsParNiveau)
  ├─ Auto-switch parking (ext si possible, sinon RdC, sinon SS)
  │
  └─ PlanMasseCanvas.setProg('emprCiblePct', pct)
       │
       └─ _reApplyIfClean()
            │
            └─ _applyScenarioGeometry(curSc())
                 │
                 ├─ Calcule empriseDispo = min(cesMaxM2, parcelle - vegMin)
                 ├─ cibleM2 = empriseDispo × emprCibleFrac × emprFac
                 ├─ Cap permMin : cibleM2 = min(cibleM2, budgetPerm)
                 │
                 ├─ Escalade multi si cibleM2 > monoCapM2 × 0.70
                 │    monoCapM2 = rtaaW × min(profMax, obbL)
                 │
                 ├─ Dimensions : wTarget × lTarget dans l'OBB
                 ├─ AutoPlanStrategies.multiRect / rect / zone / ...
                 │
                 ├─ expandToMit (si mitoyen)
                 ├─ Guard RTAA (minDim ≤ rtaaW)
                 ├─ Guard emprise totale (≤ cibleM2 × 1.15)
                 │
                 └─ S.blocs = blocs normalisés
                      │
                      └─ render() → metrics() → updatePanel()
```

### Variables clefs

| Variable | Calcul | Exemple (990m2, Uc, R+1) |
|----------|--------|--------------------------|
| cesMaxM2 | parcelle × emprMax% | 990 × 60% = 594 |
| vegMin | parcelle × permMin% | 990 × 70% = 693 |
| empriseDispo | min(cesMaxM2, parcelle - vegMin) | min(594, 297) = **297** |
| budgetPerm | parcelle × (1 - permMin%) | 990 × 30% = **297** |
| monoCapM2 | rtaaW × profMax | 10 × 15 = 150 (ou 10 × 12 = 120) |
| cibleM2 | empriseDispo × emprCibleFrac | 297 × 1.0 = **297** (slider max) |
| lgtsParNiveau | floor(emprise × eff / SP_MOY) | floor(297 × 0.82 / 57) = **4** |
| maxLgts | lgtsParNiveau × nvEffMax | 4 × 2 = **8** |

### Contraintes qui capent le max

Par ordre de priorite (la plus restrictive gagne) :

1. **Budget impermeable** (permMin PLU) : emprise + parking_ext ≤ parcelle × (1 - permMin%)
   - C'est presque toujours le facteur limitant a La Reunion (permMin 70% courant)
   - Solution : parking SS ou RdC

2. **Emprise max PLU** (emprMax/CES) : emprise ≤ parcelle × emprMax%
   - Rarement limitant car emprMax (60%) > budgetPerm (30%)

3. **Hauteur PLU** (heMax) : niveaux ≤ floor(heMax / 3m)
   - R+1 max = 2 niveaux. Doubler les lgts par niveau n'est possible qu'en densifiant l'emprise.

4. **RTAA largeur ventilation** : dimension min du bloc ≤ 10m (zone 1) ou 12m (zone 2)
   - Empeche un mono-bloc large. Solution : multi-blocs (2-3 barres de 10m de large).
   - NOTE : c'est informatif, pas bloquant PLU. Le projet peut etre non-RTAA.

5. **Parking** : chaque logement = 2 places × 25 m2
   - Ext : consomme le budget impermeable (souvent bloquant)
   - RdC : ampute ~20% de SDP mais 0 impermeabilisation
   - SS : aucun impact surface, cout de construction plus eleve

### Logique du slider logements (cible)

```
Si lgtsVal ≤ lgtsParNiveau(R+0) → niveaux = 1, parking selon budget
Si lgtsVal > lgtsParNiveau(R+0) → niveaux = min(nvMaxPLU, ceil(lgts/lgtsParNiv))
Si parking ext ne passe pas    → auto-switch RdC puis SS
Si mono-bloc ne suffit pas     → escalade multi (2-3 barres)
```

Le slider va de 1 (maison individuelle) a maxLgts (collectif dense).
A max, le batiment DOIT remplir l'emprise max conforme.

### Ce qui doit se passer a slider MAX sur cette parcelle

1. emprCiblePct = 100
2. empriseDispo = 297 m2 (cap permMin 70%)
3. cibleM2 = 297 m2
4. monoCapM2 = 10 × 12 = 120 → escalade multi (297 > 120 × 0.70)
5. multiRect(env, 10, 12, 4.5, 4) → 2-3 blocs
6. Emprise totale ≈ 240-300 m2
7. SP = emprise × eff(0.82) × 2 niveaux = ~400-490 m2
8. Logements = floor(SP / 57) = 7-8
9. Parking = 16 places → SS (ext impossible)
10. Affichage : "8 lgts · R+1 · PK SS · emprise 30% · espace vert 70%"

## Prochaines etapes

1. **Corriger la detection PLU** Les Avirons → verifier que "Uc" est bien reconnu
2. **Tester le multiRect** avec les vrais parametres (env.poly, 10, 12, 4.5)
   — le console.log montre qu'il retourne 3 blocs, mais `_applyScenarioGeometry` n'en garde qu'un
3. **Nettoyer les console.info** de debug une fois le probleme resolu
4. **Tester d'autres strategies** (zone, lshape, biBarre) pour s'assurer qu'elles
   produisent aussi le max attendu
5. **Cas complexes a prevoir** :
   - Parcelle en pente (profMax reduit par topo)
   - Mitoyen (enveloppe plus grande, emprise augmente)
   - Zone AU (constructibilite conditionnelle)
   - PLU avec reculs asymetriques (voie large, fond etroit)
