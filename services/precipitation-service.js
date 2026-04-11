// TERLAB · services/precipitation-service.js
// Pluviométrie mensuelle moyenne via Open-Meteo ERA5 (gratuit, sans auth)
// Renvoie 12 totaux mensuels (mm) + total annuel + helper renderBarChart SVG.
// Source : reanalysis ERA5, agrégation 5 dernières années par défaut.
// ════════════════════════════════════════════════════════════════════════

const ERA5_BASE = 'https://archive-api.open-meteo.com/v1/archive';
const DEFAULT_YEARS = 5;

const PrecipitationService = {

  _cache: new Map(), // key = `${lat},${lng},${years}` → result

  /**
   * Récupère la pluviométrie mensuelle moyenne sur N années (climatologie locale).
   * @param {number} lat
   * @param {number} lng
   * @param {number} [years=5]
   * @returns {Promise<{monthly:number[], annual:number, source:string, period:string, lat:number, lng:number}>}
   */
  async fetchMonthly(lat, lng, years = DEFAULT_YEARS) {
    const key = `${lat.toFixed(3)},${lng.toFixed(3)},${years}`;
    if (this._cache.has(key)) return this._cache.get(key);

    // Période : 5 dernières années complètes (mois en cours exclu)
    const endDate = new Date();
    endDate.setDate(1);
    endDate.setMonth(endDate.getMonth() - 1); // dernier mois complet
    const startDate = new Date(endDate.getFullYear() - years, 0, 1);
    const fmt = d => d.toISOString().slice(0, 10);

    const url = `${ERA5_BASE}?latitude=${lat}&longitude=${lng}`
      + `&start_date=${fmt(startDate)}&end_date=${fmt(endDate)}`
      + `&daily=precipitation_sum&timezone=Indian%2FReunion`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let json;
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
      json = await res.json();
    } finally {
      clearTimeout(timer);
    }

    const dates = json?.daily?.time ?? [];
    const sums  = json?.daily?.precipitation_sum ?? [];
    if (!dates.length) throw new Error('Open-Meteo : aucune donnée précipitation');

    // Agrégation : pour chaque (année,mois), totaliser. Puis moyenner par mois.
    const yearMonthSum = new Map(); // "YYYY-MM" → mm cumulé
    for (let i = 0; i < dates.length; i++) {
      const v = sums[i];
      if (v == null) continue;
      const ym = dates[i].slice(0, 7); // YYYY-MM
      yearMonthSum.set(ym, (yearMonthSum.get(ym) ?? 0) + v);
    }

    // Pour chaque mois (1-12), moyenne des totaux annuels
    const monthBuckets = Array.from({ length: 12 }, () => ({ sum: 0, n: 0 }));
    for (const [ym, total] of yearMonthSum) {
      const m = parseInt(ym.slice(5, 7), 10) - 1; // 0-11
      monthBuckets[m].sum += total;
      monthBuckets[m].n   += 1;
    }
    const monthly = monthBuckets.map(b => b.n > 0 ? Math.round(b.sum / b.n) : 0);
    const annual  = monthly.reduce((a, b) => a + b, 0);

    const result = {
      monthly,
      annual,
      source: 'ERA5 · Open-Meteo',
      period: `${startDate.getFullYear()}–${endDate.getFullYear()}`,
      lat, lng,
    };
    this._cache.set(key, result);
    return result;
  },

  /**
   * Rendu SVG histogramme 12 mois — palette TERLAB brique
   * @param {{monthly:number[], annual:number, source:string, period:string}} data
   * @param {{width?:number, height?:number, title?:string}} [opts]
   * @returns {string} SVG markup
   */
  renderBarChart(data, opts = {}) {
    const W = opts.width  ?? 600;
    const H = opts.height ?? 220;
    const margin = { top: 30, right: 14, bottom: 32, left: 42 };
    const cW = W - margin.left - margin.right;
    const cH = H - margin.top  - margin.bottom;

    const months = ['J','F','M','A','M','J','J','A','S','O','N','D'];
    const max = Math.max(...data.monthly, 50);
    // Échelle "ronde" : 100, 200, 500, 1000 mm
    const niceMax = max <= 100 ? 100 : max <= 200 ? 200 : max <= 500 ? 500 : Math.ceil(max / 100) * 100;

    const slotW = cW / 12;
    const barW  = slotW * 0.78;
    const gap   = slotW * 0.11;

    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="IBM Plex Mono, monospace">`);
    parts.push(`<rect width="${W}" height="${H}" fill="#fcf9f3"/>`);

    // Titre + source
    const title = opts.title ?? `Pluviométrie mensuelle · ${data.annual} mm/an`;
    parts.push(`<text x="${W/2}" y="14" text-anchor="middle" font-size="10" font-weight="700" fill="#1C1C1A">${title}</text>`);
    parts.push(`<text x="${W - margin.right}" y="14" text-anchor="end" font-size="7" fill="#A8A49C">${data.source} · ${data.period}</text>`);

    // Bande saison cyclonique (nov-avr = mois 0-3 + 10-11) — fond bleu pluie
    parts.push(`<rect x="${margin.left}" y="${margin.top}" width="${slotW * 4}" height="${cH}" fill="#1E40AF" fill-opacity="0.07"/>`);
    parts.push(`<rect x="${margin.left + slotW * 10}" y="${margin.top}" width="${slotW * 2}" height="${cH}" fill="#1E40AF" fill-opacity="0.07"/>`);
    parts.push(`<text x="${margin.left + slotW * 2}" y="${margin.top + 9}" text-anchor="middle" font-size="7" fill="#1E40AF" font-weight="600">SAISON CYCLONIQUE</text>`);

    // Axe Y : grille + ticks
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
      const v = niceMax * i / ySteps;
      const y = margin.top + cH - (v / niceMax) * cH;
      parts.push(`<line x1="${margin.left}" y1="${y}" x2="${margin.left + cW}" y2="${y}" stroke="#A8A49C" stroke-opacity="0.25" stroke-width="0.5"/>`);
      parts.push(`<text x="${margin.left - 5}" y="${y + 3}" text-anchor="end" font-size="8" fill="#6A6860">${Math.round(v)}</text>`);
    }
    parts.push(`<text x="12" y="${margin.top + cH/2}" text-anchor="middle" font-size="8" fill="#6A6860" transform="rotate(-90,12,${margin.top + cH/2})">mm / mois</text>`);

    // Barres + labels
    // Saison cyclonique nov-avr (i = 0..3, 10..11) → palette bleue pluie
    // Saison seche mai-oct (i = 4..9) → palette brique TERLAB
    for (let i = 0; i < 12; i++) {
      const v = data.monthly[i] ?? 0;
      const x = margin.left + i * slotW + gap;
      const h = (v / niceMax) * cH;
      const y = margin.top + cH - h;
      const t = niceMax > 0 ? v / niceMax : 0;
      const isCyclonique = i <= 3 || i >= 10;
      const fill = isCyclonique
        ? (t > 0.66 ? '#1E40AF' : t > 0.33 ? '#3B82F6' : '#93C5FD')
        : (t > 0.66 ? '#C1652B' : t > 0.33 ? '#D88550' : '#E8B49B');
      parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${fill}" stroke="#1C1C1A" stroke-width="0.3"/>`);
      if (h > 16) {
        parts.push(`<text x="${(x + barW/2).toFixed(1)}" y="${(y - 2).toFixed(1)}" text-anchor="middle" font-size="6.5" fill="#1C1C1A">${v}</text>`);
      }
      parts.push(`<text x="${(x + barW/2).toFixed(1)}" y="${margin.top + cH + 12}" text-anchor="middle" font-size="8" fill="#6A6860">${months[i]}</text>`);
    }

    // Axe X
    parts.push(`<line x1="${margin.left}" y1="${margin.top + cH}" x2="${margin.left + cW}" y2="${margin.top + cH}" stroke="#1C1C1A" stroke-width="0.6"/>`);

    parts.push('</svg>');
    return parts.join('');
  },
};

export default PrecipitationService;
