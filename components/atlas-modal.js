/**
 * atlas-modal.js
 *
 * Composant partagé — modale iframe pour consulter les atlas de paysage.
 * Utilisé par P05 (composition urbaine), P06 (jardins/parcs), P07 (psychédélique).
 *
 * API :
 *   AtlasModal.open(atlasId)   → ouvre la modale avec l'atlas correspondant
 *   AtlasModal.close()         → ferme la modale
 *   AtlasModal.injectPreview(containerId, atlasId) → injecte une carte preview random
 */

const ATLAS_REGISTRY = {
  'jardins-parcs': {
    title: 'Atlas des Jardins, Parcs & Places',
    url: '../data/atlas/atlas-jardins-parcs-places.html',
    color: '#2a6035',
    cards: [
      'Chahâr Bâgh', 'Versailles · Grand Axe', 'Taj Mahal · Bagh', 'Villa Lante · Viterbe',
      'Boboli · Florence', 'Generalife · Alhambra', 'Villa d\'Este · Tivoli', 'Vaux-le-Vicomte',
      'Stourhead · Wiltshire', 'Central Park · New York', 'High Line · New York',
      'Kew Gardens · Londres', 'Giverny · Claude Monet', 'Ryōanji · Karesansui',
      'Jardin Mandala', 'Saihoji · Kokedera', 'Jardin Créole · Réunion',
      'Jardim · Burle Marx', 'Eden Project · Cornwall', 'Terrasses des Hauts · Réunion',
      'Gardens by the Bay', 'Terra Preta · Amazonie', 'Forêt-Ville · Stefano Boeri',
      'Landschaftspark · Duisbourg', 'Jardin Fractal · Quantique',
    ],
  },
  'composition-urbaine': {
    title: 'Atlas de Composition Urbaine',
    url: '../data/atlas/atlas-composition-urbaine.html',
    color: '#7a3025',
    cards: [
      'Axe Simple', 'Double Axe · Croix Cardinale', 'Symétrie Bilatérale',
      'Asymétrie Équilibrée', 'Perspective Forcée', 'Grille Orthogonale',
      'Organisation Radiale', 'Forme Organique · Libre', 'Compression · Dilatation',
      'Vide Actif · Espace Structurant', 'Cour Fermée · Patio', 'Limite Douce · Haie Vivante',
      'Lisière Épaisse · Zone Tampon', 'Terrasses · Gradins de Sol',
      'Vue Empruntée · Shakkei', 'Belvédère · Point de Vue Haut',
      'Miroir d\'Eau · Réflexion', 'Canal · Eau Linéaire', 'Cascade · Eau Verticale',
      'Bassin Central · Pôle Aquatique',
    ],
  },
  'psychedelique': {
    title: 'Atlas de Composition Psychédélique',
    url: '../data/atlas/atlas-composition-psychedelique.html',
    color: '#4a3880',
    cards: [
      'Disque de Vogel', 'Rosette d\'Agave', 'Champ Décussé', 'Mandala d\'Écailles',
      'Double Spirale Bijuguée', 'Rivière Catmull-Rom', 'Forêt de Bézier',
      'Topographie de Perlin', 'Jardin Vectoriel FBM', 'Mosaïque Cellulaire',
      'Haies Fractales', 'Champ de Nénuphars', 'Forêt Logistique',
      'Vague de Feuilles', 'Radiculaires en Coupe',
    ],
  },
};

// ── SVG mini-illustrations for preview cards ─────────────────────
function miniSvg(atlasId) {
  const svgs = {
    'jardins-parcs': `<svg viewBox="0 0 80 60" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="35" width="60" height="20" rx="2" fill="rgba(42,96,53,.12)" stroke="rgba(42,96,53,.4)" stroke-width=".7"/>
      <circle cx="25" cy="25" r="10" fill="rgba(42,96,53,.18)"/>
      <circle cx="55" cy="22" r="12" fill="rgba(42,96,53,.14)"/>
      <line x1="40" y1="10" x2="40" y2="55" stroke="rgba(42,96,53,.3)" stroke-width=".5" stroke-dasharray="2 2"/>
      <circle cx="40" cy="32" r="3" fill="rgba(42,96,53,.35)"/>
    </svg>`,
    'composition-urbaine': `<svg viewBox="0 0 80 60" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="10" y1="30" x2="70" y2="30" stroke="rgba(122,48,37,.4)" stroke-width=".7"/>
      <line x1="40" y1="5" x2="40" y2="55" stroke="rgba(122,48,37,.4)" stroke-width=".7"/>
      <rect x="18" y="14" width="18" height="14" rx="1" fill="rgba(122,48,37,.1)" stroke="rgba(122,48,37,.3)" stroke-width=".5"/>
      <rect x="44" y="14" width="18" height="14" rx="1" fill="rgba(122,48,37,.1)" stroke="rgba(122,48,37,.3)" stroke-width=".5"/>
      <rect x="18" y="34" width="18" height="14" rx="1" fill="rgba(122,48,37,.1)" stroke="rgba(122,48,37,.3)" stroke-width=".5"/>
      <rect x="44" y="34" width="18" height="14" rx="1" fill="rgba(122,48,37,.1)" stroke="rgba(122,48,37,.3)" stroke-width=".5"/>
      <circle cx="40" cy="30" r="4" fill="rgba(122,48,37,.2)" stroke="rgba(122,48,37,.5)" stroke-width=".5"/>
    </svg>`,
    'psychedelique': `<svg viewBox="0 0 80 60" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M40 5 C55 15, 65 30, 40 55 C15 30, 25 15, 40 5Z" fill="rgba(74,56,128,.08)" stroke="rgba(74,56,128,.35)" stroke-width=".7"/>
      <circle cx="40" cy="28" r="8" fill="none" stroke="rgba(74,56,128,.25)" stroke-width=".5"/>
      <circle cx="40" cy="28" r="14" fill="none" stroke="rgba(74,56,128,.15)" stroke-width=".5"/>
      <circle cx="40" cy="28" r="20" fill="none" stroke="rgba(74,56,128,.1)" stroke-width=".5"/>
      <circle cx="35" cy="24" r="2" fill="rgba(74,56,128,.3)"/>
      <circle cx="45" cy="32" r="2" fill="rgba(74,56,128,.3)"/>
    </svg>`,
  };
  return svgs[atlasId] || '';
}

// ── Overlay (created once, reused) ───────────────────────────────
let overlayEl = null;

function ensureOverlay() {
  if (overlayEl) return overlayEl;

  overlayEl = document.createElement('div');
  overlayEl.id = 'atlas-modal-overlay';
  overlayEl.innerHTML = `
    <div class="atlas-modal">
      <div class="atlas-modal-header">
        <span class="atlas-modal-title"></span>
        <button class="atlas-modal-close" onclick="AtlasModal.close()" title="Fermer">&times;</button>
      </div>
      <iframe class="atlas-modal-iframe" sandbox="allow-same-origin allow-scripts"></iframe>
    </div>
  `;
  document.body.appendChild(overlayEl);

  // Close on backdrop click
  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) AtlasModal.close();
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open')) AtlasModal.close();
  });

  // Inject styles once
  if (!document.getElementById('atlas-modal-css')) {
    const style = document.createElement('style');
    style.id = 'atlas-modal-css';
    style.textContent = `
      #atlas-modal-overlay {
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(24,19,10,.6);
        backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        opacity: 0; pointer-events: none;
        transition: opacity .25s ease-out;
      }
      #atlas-modal-overlay.open { opacity: 1; pointer-events: auto; }
      .atlas-modal {
        width: min(94vw, 1200px); height: min(90vh, 900px);
        background: var(--card, #fcf9f3);
        border: 1px solid var(--border2, rgba(154,120,32,.3));
        border-radius: var(--r-lg, 11px);
        box-shadow: var(--sh-lg, 0 4px 20px rgba(90,70,30,.16));
        display: flex; flex-direction: column;
        overflow: hidden;
        transform: translateY(12px) scale(.98);
        transition: transform .25s ease-out;
      }
      #atlas-modal-overlay.open .atlas-modal { transform: translateY(0) scale(1); }
      .atlas-modal-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 16px;
        border-bottom: 1px solid var(--border, rgba(154,120,32,.18));
        background: var(--surface, #f5f1e8);
      }
      .atlas-modal-title {
        font-family: var(--font-serif, 'Playfair Display', serif);
        font-size: .95rem; font-weight: 600;
        color: var(--text, #18130a);
      }
      .atlas-modal-close {
        background: none; border: none; font-size: 1.4rem;
        color: var(--muted, #6b5c3e); cursor: pointer;
        padding: 0 4px; line-height: 1;
        transition: color .15s;
      }
      .atlas-modal-close:hover { color: var(--text, #18130a); }
      .atlas-modal-iframe {
        flex: 1; border: none; width: 100%; background: var(--bg, #ede8dc);
      }

      /* ── Preview card (inline dans la phase) ─────────────── */
      .atlas-preview {
        display: flex; align-items: center; gap: 12px;
        background: var(--card, #fcf9f3);
        border: 1px solid var(--border, rgba(154,120,32,.18));
        border-radius: var(--r-sm, 4px);
        padding: 10px 12px; margin-top: 8px;
        cursor: pointer;
        transition: border-color .2s, box-shadow .2s, transform .15s;
      }
      .atlas-preview:hover {
        border-color: var(--accent, #9a7820);
        box-shadow: 0 2px 10px rgba(90,70,30,.12);
        transform: translateY(-1px);
      }
      .atlas-preview-svg { width: 56px; height: 42px; flex-shrink: 0; }
      .atlas-preview-body { flex: 1; min-width: 0; }
      .atlas-preview-label {
        font-family: var(--font-mono, 'Inconsolata', monospace);
        font-size: .6rem; letter-spacing: .1em; text-transform: uppercase;
        color: var(--faint, #c4b396); margin-bottom: 2px;
      }
      .atlas-preview-name {
        font-family: var(--font-serif, 'Playfair Display', serif);
        font-size: .82rem; font-weight: 600;
        color: var(--text, #18130a);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .atlas-preview-hint {
        font-family: var(--font-body, 'Source Serif 4', serif);
        font-size: .68rem; font-style: italic;
        color: var(--muted, #6b5c3e); margin-top: 1px;
      }
      .atlas-preview-badge {
        font-family: var(--font-mono, 'Inconsolata', monospace);
        font-size: .55rem; letter-spacing: .08em; text-transform: uppercase;
        color: #fff; padding: 2px 6px; border-radius: 2px;
        flex-shrink: 0;
      }
    `;
    document.head.appendChild(style);
  }

  return overlayEl;
}

// ── Public API ───────────────────────────────────────────────────

const AtlasModal = {

  /**
   * Open the modal with a given atlas.
   * @param {string} atlasId — key from ATLAS_REGISTRY
   */
  open(atlasId) {
    const atlas = ATLAS_REGISTRY[atlasId];
    if (!atlas) { console.warn('[AtlasModal] Unknown atlas:', atlasId); return; }

    const overlay = ensureOverlay();
    overlay.querySelector('.atlas-modal-title').textContent = atlas.title;
    const iframe = overlay.querySelector('.atlas-modal-iframe');
    iframe.src = atlas.url;
    requestAnimationFrame(() => overlay.classList.add('open'));
  },

  /** Close the modal. */
  close() {
    if (!overlayEl) return;
    overlayEl.classList.remove('open');
    // Clear iframe after transition
    setTimeout(() => {
      const iframe = overlayEl.querySelector('.atlas-modal-iframe');
      if (iframe) iframe.src = 'about:blank';
    }, 300);
  },

  /**
   * Inject a random preview card into a container.
   * @param {string} containerId — DOM id of the target div
   * @param {string} atlasId    — key from ATLAS_REGISTRY
   */
  injectPreview(containerId, atlasId) {
    const container = document.getElementById(containerId);
    const atlas = ATLAS_REGISTRY[atlasId];
    if (!container || !atlas) return;

    // Pick random card
    const card = atlas.cards[Math.floor(Math.random() * atlas.cards.length)];

    container.innerHTML = `
      <div class="atlas-preview" onclick="AtlasModal.open('${atlasId}')" title="Cliquer pour consulter l'atlas complet">
        <div class="atlas-preview-svg">${miniSvg(atlasId)}</div>
        <div class="atlas-preview-body">
          <div class="atlas-preview-label">Atlas · extrait aléatoire</div>
          <div class="atlas-preview-name">${card}</div>
          <div class="atlas-preview-hint">Cliquer pour ouvrir l'atlas complet</div>
        </div>
        <span class="atlas-preview-badge" style="background:${atlas.color}">${atlas.cards.length} fiches</span>
      </div>
    `;
  },
};

export default AtlasModal;
