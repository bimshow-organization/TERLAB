// TERLAB · components/qr-code.js · QR Code session · ENSA La Réunion v1.0
// Génère un QR code pointant vers la session TERLAB dans BIMSHOW
// Utilise qrcode-generator (CDN) — zéro dépendance npm

const QRCode = {
  _loaded: false,

  // ── CHARGEMENT LIBRAIRIE QR ───────────────────────────────────
  async ensureLoaded() {
    if (this._loaded || window.qrcode) { this._loaded = true; return; }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src   = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      script.onload = () => { this._loaded = true; resolve(); };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  },

  // ── GÉNÉRATION QR CODE ────────────────────────────────────────
  // @param sessionId  UUID session TERLAB
  // @param canvasId   ID du canvas DOM où dessiner
  // @param size       Taille en pixels (défaut : 120)
  //
  async generate(sessionId, canvasId, size = 120) {
    await this.ensureLoaded();

    const canvas = document.getElementById(canvasId);
    if (!canvas) { console.warn(`[QR] Canvas #${canvasId} introuvable`); return null; }

    // URL de rappel session
    const url = `https://bimshow.io/terlab/#session/${sessionId}`;

    // Utiliser qrcode-generator (lib légère)
    if (window.qrcode) {
      try {
        // Méthode 1 : qrcode-generator
        const qr = window.qrcode(0, 'M');
        qr.addData(url);
        qr.make();

        const ctx      = canvas.getContext('2d');
        const modules  = qr.getModuleCount();
        const cellSize = Math.floor(size / modules);
        const totalSize = cellSize * modules;

        canvas.width  = totalSize;
        canvas.height = totalSize;

        // Fond blanc
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, totalSize, totalSize);

        // Modules noirs
        ctx.fillStyle = '#000000';
        for (let row = 0; row < modules; row++) {
          for (let col = 0; col < modules; col++) {
            if (qr.isDark(row, col)) {
              ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
            }
          }
        }

        canvas.style.display = 'block';
        document.getElementById('qr-placeholder')?.remove();

        console.info(`[QR] Généré: ${url}`);
        return { url, canvas };

      } catch (e) {
        console.warn('[QR] qrcode-generator failed:', e.message);
      }
    }

    // Méthode 2 : Fallback QR via API externe
    try {
      const apiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}`;
      const img    = document.createElement('img');
      img.src      = apiUrl;
      img.width    = size;
      img.height   = size;
      img.alt      = 'QR code session TERLAB';

      const parent = canvas.parentNode;
      parent.replaceChild(img, canvas);

      return { url, img };
    } catch (e) {
      console.warn('[QR] API fallback failed:', e.message);
    }

    // Méthode 3 : Afficher l'URL texte
    const ctx = canvas.getContext('2d');
    canvas.width = size; canvas.height = size;
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#666';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('QR indisponible', size/2, size/2 - 5);
    ctx.fillText('Voir URL ci-dessous', size/2, size/2 + 8);

    return { url };
  },

  // ── TÉLÉCHARGEMENT QR ─────────────────────────────────────────
  downloadQR(canvasId, filename = 'terlab_session_qr.png') {
    const canvas = document.getElementById(canvasId);
    if (!canvas || canvas.tagName !== 'CANVAS') return;
    const url = canvas.toDataURL('image/png');
    const a   = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  }
};

export default QRCode;


// ════════════════════════════════════════════════════════════════
// TERLAB · FIREBASE CONFIG DOCUMENTATION
// Remplacer le stub dans index.html
// ════════════════════════════════════════════════════════════════

/*
Dans index.html, remplacer le bloc Firebase stub par :

<script type="module">
  import { initializeApp }  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
  import { getDatabase, ref, set, get } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

  // ── Config RÉELLE TERLAB ────────────────────────────────────────
  // Obtenir depuis Firebase Console → Project Settings → Your apps
  // Projet : terlab-reunion (à créer dans la console Firebase de BIMSHOW
  //           ou un nouveau projet dédié TERLAB)
  //
  // Structure RTDB recommandée :
  //   /sessions/{sessionId}/
  //     sessionId: string
  //     createdAt: ISO string
  //     lastUpdated: ISO string
  //     terrain: { commune, lat, lng, ... }
  //     phases: { 0: {...}, 1: {...}, ... }
  //     demo: null | 'ville' | 'village' | 'isole'
  //
  // Règles de sécurité RTDB à appliquer :
  // {
  //   "rules": {
  //     "sessions": {
  //       "$sessionId": {
  //         ".read":  true,
  //         ".write": true,
  //         ".validate": "newData.hasChildren(['sessionId', 'createdAt'])"
  //       }
  //     }
  //   }
  // }
  //
  // Note RGPD : aucune donnée nominative. UUID côté client uniquement.
  //             Sessions purgées automatiquement après 30 jours (retention règle RTDB).

  const firebaseConfig = {
    apiKey:            "VOTRE_API_KEY",           // Récupérer depuis Firebase Console
    authDomain:        "terlab-reunion.firebaseapp.com",
    databaseURL:       "https://terlab-reunion-default-rtdb.europe-west1.firebasedatabase.app",
    projectId:         "terlab-reunion",
    storageBucket:     "terlab-reunion.appspot.com",
    messagingSenderId: "VOTRE_SENDER_ID",
    appId:             "VOTRE_APP_ID"
  };

  try {
    const app = initializeApp(firebaseConfig);
    window.TERLAB_DB     = getDatabase(app);
    window.TERLAB_FB_REF = ref;
    window.TERLAB_FB_SET = set;
    window.TERLAB_FB_GET = get;
    console.info('[TERLAB] Firebase RTDB connecté');
  } catch(e) {
    console.warn('[TERLAB] Firebase init failed:', e.message);
    window.TERLAB_DB = null;
  }
</script>

// ── TOKEN MAPBOX ────────────────────────────────────────────────
// Option 1 : Token BIMSHOW existant (scope étendu à terlab.bimshow.io)
//   → Ajouter 'https://bimshow.io/terlab/*' dans les URLs autorisées
//     du token Mapbox dans le dashboard Mapbox
//
// Option 2 : Nouveau token dédié TERLAB
//   → Créer un token lecture seule sur account.mapbox.com
//   → URLs autorisées : https://bimshow.io, http://localhost
//   → Scopes : styles:read, tiles:read, fonts:read
//
// Le token est stocké côté client dans localStorage ('terlab_mapbox_token')
// Il n'est jamais transmis à un serveur TERLAB.
// La UI de saisie est déjà implémentée dans index.html (modal-token).
*/
