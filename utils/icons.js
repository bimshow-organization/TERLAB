/* ════════════════════════════════════════════════════════════════
   TERLAB · Icons (SVG monochromes, currentColor)
   utils/icons.js
   Usage : el.innerHTML = ICONS.check;  ou  `<span class="icon">${ICONS.alert}</span>`
   ════════════════════════════════════════════════════════════════ */

export const ICONS = {
  // Navigation
  check:    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,8 6,12 14,4"/></svg>`,
  lock:     `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="8" width="10" height="7" rx="1.5"/><path d="M5 8V5.5a3 3 0 0 1 6 0V8"/></svg>`,
  arrow_r:  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 8h8M9 5l3 3-3 3"/></svg>`,
  arrow_l:  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 8H4M7 5L4 8l3 3"/></svg>`,
  close:    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>`,
  menu:     `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 4h12M2 8h12M2 12h12"/></svg>`,
  chevron_d:`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,6 8,10 12,6"/></svg>`,
  chevron_r:`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6,4 10,8 6,12"/></svg>`,

  // Statut
  alert:    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 2L14 13H2L8 2z"/><path d="M8 7v3M8 11.5v.5"/></svg>`,
  info:     `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 7v4M8 5.5v.5" stroke-linecap="round"/></svg>`,
  success:  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><polyline points="5,8 7,10 11,6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  block:    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><line x1="5" y1="5" x2="11" y2="11"/></svg>`,

  // Actions
  refresh:  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M13 8A5 5 0 0 0 3 5"/><path d="M3 8a5 5 0 0 0 10 3"/><polyline points="13,2 13,5 10,5"/><polyline points="3,11 3,14 6,14"/></svg>`,
  download: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 2v8M5 8l3 3 3-3"/><path d="M3 13h10"/></svg>`,
  upload:   `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 12V4M5 6l3-3 3 3"/><path d="M3 13h10"/></svg>`,
  settings: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M3.5 12.5l1.3-1.3M11.2 4.8l1.3-1.3"/></svg>`,
  edit:     `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2 2-8 8H4v-2l8-8z"/></svg>`,
  trash:    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 4h10M5 4V2h6v2M6 4v9M10 4v9M4 4l1 11h6l1-11"/></svg>`,
  plus:     `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>`,
  search:   `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="5"/><path d="M11 11l3 3"/></svg>`,

  // Cartographie / Architecture
  map:      `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="1,3 5,1 11,3 15,1 15,13 11,15 5,13 1,15"/><line x1="5" y1="1" x2="5" y2="13"/><line x1="11" y1="3" x2="11" y2="15"/></svg>`,
  building: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="12" height="10"/><path d="M2 8h12M8 4V2M5 8v6M11 8v6"/></svg>`,
  layers:   `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="8,1 15,5 8,9 1,5 8,1"/><polyline points="1,9 8,13 15,9"/><polyline points="1,12 8,16 15,12"/></svg>`,
  ruler:    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="1" y="5" width="14" height="6" rx="1"/><line x1="4" y1="5" x2="4" y2="8"/><line x1="7" y1="5" x2="7" y2="7"/><line x1="10" y1="5" x2="10" y2="8"/><line x1="13" y1="5" x2="13" y2="7"/></svg>`,
  sun:      `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><line x1="8" y1="1" x2="8" y2="3"/><line x1="8" y1="13" x2="8" y2="15"/><line x1="1" y1="8" x2="3" y2="8"/><line x1="13" y1="8" x2="15" y2="8"/><line x1="3" y1="3" x2="4.5" y2="4.5"/><line x1="11.5" y1="11.5" x2="13" y2="13"/><line x1="13" y1="3" x2="11.5" y2="4.5"/><line x1="4.5" y1="11.5" x2="3" y2="13"/></svg>`,
  wind:     `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 5h9a2.5 2.5 0 0 0 0-5"/><path d="M1 9h11a2.5 2.5 0 0 1 0 5H11"/><line x1="1" y1="12" x2="7" y2="12"/></svg>`,
  document: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 1H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6L9 1z"/><polyline points="9,1 9,6 14,6"/><line x1="5" y1="9" x2="11" y2="9"/><line x1="5" y1="12" x2="9" y2="12"/></svg>`,
  link:     `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M7 9a3 3 0 0 0 4.24.06l2-2A3 3 0 0 0 9 2.76L7.5 4.24"/><path d="M9 7a3 3 0 0 0-4.24-.06l-2 2A3 3 0 0 0 7 13.24L8.5 11.76"/></svg>`,
  robot:    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="5" width="12" height="8" rx="2"/><path d="M5 5V4a3 3 0 0 1 6 0v1"/><circle cx="6" cy="9" r="1" fill="currentColor"/><circle cx="10" cy="9" r="1" fill="currentColor"/><path d="M6 12h4"/></svg>`,
  user:     `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="5" r="3"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg>`,
  globe:    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6.5"/><path d="M1.5 8h13M8 1.5c2 2 3 4 3 6.5s-1 4.5-3 6.5c-2-2-3-4-3-6.5s1-4.5 3-6.5z"/></svg>`,
  eye:      `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>`,
};

export function icon(name, extraClass = '') {
  const svg = ICONS[name];
  if (!svg) return '';
  return extraClass ? `<span class="icon ${extraClass}">${svg}</span>` : svg;
}

if (typeof window !== 'undefined') {
  window.ICONS = ICONS;
  window.TERLAB_ICON = icon;
}
