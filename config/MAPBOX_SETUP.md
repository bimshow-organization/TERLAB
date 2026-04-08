# Configuration token Mapbox — TERLAB

## Token utilise

Le token par defaut est embarque dans `index.js` (pk.eyJ1IjoiYmltc2hvdyIs...).
L'utilisateur peut le remplacer via le modal au lancement (stocke dans localStorage).

## URLs a autoriser dans le dashboard Mapbox

https://console.mapbox.com → Tokens → bimshow → Allowed URLs

Ajouter :
- `https://bimshow.io`
- `https://bimshow.io/*`
- `http://localhost:*` (dev)
- `http://127.0.0.1:*` (dev)
- `https://*.github.io` (si deploiement GitHub Pages)

## Creation d'un nouveau token

1. Se connecter sur https://account.mapbox.com
2. Tokens → Create a token
3. Scopes : cocher au minimum `styles:read`, `fonts:read`, `datasets:read`, `tilesets:read`
4. Allowed URLs : ajouter les URLs ci-dessus
5. Copier le token (commence par `pk.`)
