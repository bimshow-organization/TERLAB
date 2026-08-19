/* ═══════════════════════════════════════════════════════════════
 * TERLAB · touch-titles.js
 * Revele les attributs `title` au doigt (appui long ~450 ms).
 * Sur ecran tactile l'infobulle native ne s'affiche jamais : des
 * barres d'outils reduites a des symboles (P01 ✕ ⊙ ≈, P07 vues,
 * boutons de coupe) perdent tout leur sens. Ce module affiche une
 * bulle transitoire et neutralise le clic qui suivrait l'appui long.
 * Actif uniquement sur pointeur grossier.
 * ═══════════════════════════════════════════════════════════════ */

const HOLD_MS = 450;

const CSS = `
.tt-touch-tip {
  position: fixed;
  z-index: var(--z-toast, 60);
  max-width: 70vw;
  padding: 7px 11px;
  border-radius: var(--r, 7px);
  background: var(--surface, #1a1814);
  border: 1px solid var(--border2, rgba(255,255,255,.18));
  color: var(--text, #e8dfc8);
  font-family: var(--font-body, system-ui, sans-serif);
  font-size: 12px;
  line-height: 1.4;
  box-shadow: 0 6px 24px rgba(0,0,0,.45);
  pointer-events: none;
  opacity: 0;
  transition: opacity .12s var(--ease, ease);
}
.tt-touch-tip.tt-show { opacity: 1; }
`;

const TouchTitles = {
  _tip:      null,
  _timer:    null,
  _shown:    false,
  _started:  false,

  init() {
    if (this._started) return;
    if (!window.matchMedia?.('(pointer: coarse)').matches) return;
    this._started = true;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    document.addEventListener('touchstart', this._onStart, { passive: true });
    document.addEventListener('touchend',    this._onEnd,  { passive: true });
    document.addEventListener('touchmove',   this._onEnd,  { passive: true });
    document.addEventListener('touchcancel', this._onEnd,  { passive: true });
    document.addEventListener('scroll',      this._onEnd,  { passive: true, capture: true });
    // Neutraliser le clic issu d'un appui long (capture = avant les
    // handlers de l'app, sinon l'action se declencherait quand meme)
    document.addEventListener('click', this._onClick, true);
  },

  _onStart: (e) => {
    const t = e.target?.closest?.('[title]');
    const text = t?.getAttribute('title')?.trim();
    if (!text) return;
    clearTimeout(TouchTitles._timer);
    TouchTitles._timer = setTimeout(() => TouchTitles._show(t, text), HOLD_MS);
  },

  _onEnd: () => {
    clearTimeout(TouchTitles._timer);
    TouchTitles._hide();
  },

  _onClick: (e) => {
    if (!TouchTitles._shown) return;
    TouchTitles._shown = false;
    e.preventDefault();
    e.stopPropagation();
  },

  _show(el, text) {
    let tip = this._tip;
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'tt-touch-tip';
      tip.setAttribute('role', 'tooltip');
      document.body.appendChild(tip);
      this._tip = tip;
    }
    tip.textContent = text;
    tip.style.visibility = 'hidden';
    tip.classList.add('tt-show');

    // Positionner apres mesure : au-dessus si la place manque en bas
    const r = el.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let left = r.left + r.width / 2 - tr.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
    let top = r.bottom + 8;
    if (top + tr.height > window.innerHeight - 8) top = r.top - tr.height - 8;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top  = `${Math.max(8, top)}px`;
    tip.style.visibility = '';

    this._shown = true;
  },

  _hide() {
    this._tip?.classList.remove('tt-show');
    // _shown reste vrai jusqu'au clic suivant, qu'il faut neutraliser
  },

  destroy() {
    this._tip?.remove();
    this._tip = null;
  },
};

export default TouchTitles;
