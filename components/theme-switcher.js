/* ════════════════════════════════════════════════════════════════
   TERLAB · ThemeSwitcher
   components/theme-switcher.js
   3 thèmes canoniques : dark · ivory · earth
   - Persistance localStorage
   - Event `terlab-theme-change` pour SVG canvas / Three.js
   ════════════════════════════════════════════════════════════════ */

export class ThemeSwitcher {
  static THEMES = ['dark', 'ivory', 'earth'];
  static LABELS = { dark: 'Nuit', ivory: 'Jour', earth: 'Terrain' };
  static STORAGE_KEY = 'terlab-theme';

  static init_from_storage() {
    let saved = null;
    try { saved = localStorage.getItem(this.STORAGE_KEY); } catch(_) {}
    const theme = this.THEMES.includes(saved) ? saved : 'dark';
    document.documentElement.dataset.theme = theme;
    return theme;
  }

  static init(containerId = 'theme-switcher') {
    const el = typeof containerId === 'string'
      ? document.getElementById(containerId)
      : containerId;
    if (!el) return;
    el.classList.add('theme-switcher');
    el.innerHTML = this.THEMES.map(t => `
      <button class="theme-dot" data-theme="${t}" title="${this.LABELS[t]}" type="button"></button>
    `).join('');
    el.addEventListener('click', e => {
      const btn = e.target.closest('[data-theme]');
      if (btn) this.set(btn.dataset.theme);
    });
    this.sync();
  }

  static set(theme) {
    if (!this.THEMES.includes(theme)) return;
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(this.STORAGE_KEY, theme); } catch(_) {}
    this.sync();
    window.dispatchEvent(new CustomEvent('terlab-theme-change', { detail: { theme } }));
  }

  static current() {
    return document.documentElement.dataset.theme || 'dark';
  }

  static sync() {
    const current = this.current();
    document.querySelectorAll('.theme-dot[data-theme]').forEach(d => {
      d.classList.toggle('active', d.dataset.theme === current);
    });
  }

  /**
   * Lit une custom property CSS depuis :root.
   * Utile pour canvas 2D / Three.js qui ne peuvent pas utiliser var() directement.
   */
  static cssVar(name) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name).trim();
  }

  /**
   * Retourne un objet { key: valeurCSS } pour toutes les propriétés demandées.
   * Ex : ThemeSwitcher.readVars(['--gold','--svg-bat-fill']) → {gold, 'svg-bat-fill'}
   */
  static readVars(names) {
    const s = getComputedStyle(document.documentElement);
    const out = {};
    for (const n of names) {
      const key = n.replace(/^--/, '');
      out[key] = s.getPropertyValue(n).trim();
    }
    return out;
  }
}

if (typeof window !== 'undefined') {
  window.ThemeSwitcher = ThemeSwitcher;
}
