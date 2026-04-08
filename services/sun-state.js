// TERLAB · services/sun-state.js
// Singleton état solaire partagé entre phases (P01, P04, P07)
// Dispatch 'terlab:sun-changed' pour synchronisation cross-phase

const SunState = {

  _hour: 12,
  _dayOfYear: 172,   // 21 juin par défaut
  _lat: -21.1,
  _broadcasting: false,

  init() {
    const terrain = window.SessionManager?.getTerrain?.() ?? {};
    if (terrain.lat)      this._lat       = parseFloat(terrain.lat);
    if (terrain.sun_hour) this._hour      = parseFloat(terrain.sun_hour);
    if (terrain.sun_day)  this._dayOfYear = parseInt(terrain.sun_day);
  },

  getHour()      { return this._hour; },
  getDayOfYear() { return this._dayOfYear; },
  getLat()       { return this._lat; },

  setHour(h, source = 'unknown') {
    const dl = this.getDaylight();
    this._hour = Math.max(dl.sunrise, Math.min(dl.sunset, parseFloat(h)));
    this._persist();
    this._dispatch(source);
  },

  setDayOfYear(d, source = 'unknown') {
    this._dayOfYear = Math.max(1, Math.min(365, parseInt(d)));
    // clamp hour to new daylight range
    const dl = this.getDaylight();
    this._hour = Math.max(dl.sunrise, Math.min(dl.sunset, this._hour));
    this._persist();
    this._dispatch(source);
  },

  /** progress 0→1 normalised within sunrise→sunset for current day */
  getProgress() {
    const dl = this.getDaylight();
    const range = dl.sunset - dl.sunrise;
    if (range <= 0) return 0.5;
    return Math.max(0, Math.min(1, (this._hour - dl.sunrise) / range));
  },

  setProgress(p, source = 'unknown') {
    const dl = this.getDaylight();
    this._hour = dl.sunrise + (dl.sunset - dl.sunrise) * Math.max(0, Math.min(1, parseFloat(p)));
    this._persist();
    this._dispatch(source);
  },

  /** Delegate to SunCalcService */
  getDaylight() {
    return window.SunCalcService?.getDaylight(this._dayOfYear, this._lat)
      ?? { sunrise: 6, sunset: 18, hours: 12 };
  },

  getPosition() {
    return window.SunCalcService?.getPosition(this._hour, this._dayOfYear, this._lat)
      ?? { altitude: 45, azimuth: 180, aboveHorizon: true };
  },

  // ── Format helpers ──────────────────────────────────
  formatHour(h) {
    const hour = h ?? this._hour;
    const hh = String(Math.floor(hour)).padStart(2, '0');
    const mm = String(Math.floor((hour % 1) * 60)).padStart(2, '0');
    return `${hh}:${mm}`;
  },

  formatDayLabel(d) {
    return window.SunCalcService?.getDateLabel(d ?? this._dayOfYear) ?? `J${d}`;
  },

  // ── Internal ────────────────────────────────────────
  _persist() {
    const sm = window.SessionManager;
    if (!sm) return;
    const terrain = sm.getTerrain?.() ?? {};
    terrain.sun_hour = this._hour;
    terrain.sun_day  = this._dayOfYear;
    sm.setTerrain?.(terrain);
  },

  _dispatch(source) {
    if (this._broadcasting) return;
    this._broadcasting = true;
    window.dispatchEvent(new CustomEvent('terlab:sun-changed', {
      detail: { hour: this._hour, dayOfYear: this._dayOfYear, source }
    }));
    this._broadcasting = false;
  },
};

export default SunState;
