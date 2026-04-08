// TERLAB · utils/sun-diagram-svg.js
// Diagramme solaire polaire stéréographique — SVG
// Latitude par défaut : -21.1° (La Réunion, hémisphère sud)

const DEG = Math.PI / 180;
const R   = 100;   // rayon SVG du cercle horizon (altitude = 0°)

const ARC_DEFS = [
  { key: 'summer',  day: 172, cls: 'sg-arc-summer',  label: '21 juin',  color: '#e74c3c' },
  { key: 'equinox', day: 80,  cls: 'sg-arc-equinox', label: 'Équinoxe', color: '#2ecc71' },
  { key: 'winter',  day: 355, cls: 'sg-arc-winter',  label: '21 déc.',  color: '#3498db' },
];

const CARDINALS = [
  { label: 'N', angle: 0 },
  { label: 'E', angle: 90 },
  { label: 'S', angle: 180 },
  { label: 'O', angle: 270 },
];

// ── Projection stéréographique ─────────────────────────
// Point à altitude alt° et azimut az° → (x, y) SVG
// Azimut : 0° = Nord (haut), sens horaire
// r = R × cos(alt) → altitude 0° = bord, 90° = centre
function project(azDeg, altDeg) {
  const r = R * Math.cos(altDeg * DEG);
  // SVG : Y vers le bas, Nord = haut (-Y)
  const azRad = azDeg * DEG;
  return {
    x:  r * Math.sin(azRad),
    y: -r * Math.cos(azRad),
  };
}

// ── Build SVG markup ───────────────────────────────────
const SunDiagramSVG = {

  _containerId: null,
  _dotEl: null,

  build(containerId) {
    this._containerId = containerId;
    const wrap = document.getElementById(containerId);
    if (!wrap) return;

    const svc = window.SunCalcService;
    if (!svc) { wrap.innerHTML = '<p style="color:var(--muted);font-size:10px">SunCalcService non disponible</p>'; return; }

    const lat = window.SunState?.getLat?.() ?? svc.DEFAULT_LAT;
    let svg = `<svg class="sg-solar-svg" viewBox="-125 -125 250 250" xmlns="http://www.w3.org/2000/svg">`;

    // ── Grid: altitude circles ──
    for (let alt = 10; alt <= 80; alt += 10) {
      const cr = R * Math.cos(alt * DEG);
      svg += `<circle class="sg-grid-circle" cx="0" cy="0" r="${cr.toFixed(1)}"/>`;
      // label every 20°
      if (alt % 20 === 0) {
        svg += `<text class="sg-grid-label" x="2" y="${(-cr + 1.5).toFixed(1)}">${alt}°</text>`;
      }
    }

    // ── Grid: azimuth radials ──
    for (let az = 0; az < 360; az += 30) {
      const end = project(az, 0);
      svg += `<line class="sg-grid-line" x1="0" y1="0" x2="${end.x.toFixed(1)}" y2="${end.y.toFixed(1)}"/>`;
    }

    // ── Cardinals ──
    for (const c of CARDINALS) {
      const p = project(c.angle, -6); // slightly outside horizon
      svg += `<text class="sg-cardinal" x="${p.x.toFixed(1)}" y="${(p.y + 2).toFixed(1)}">${c.label}</text>`;
    }

    // ── Horizon circle ──
    svg += `<circle cx="0" cy="0" r="${R}" fill="none" stroke="var(--text2,#5a4e3a)" stroke-width="0.8"/>`;

    // ── Sun arcs ──
    for (const arc of ARC_DEFS) {
      svg += this._buildArcPath(svc, arc, lat);
    }

    // ── Current sun position dot ──
    svg += `<circle class="sg-sun-dot" id="${containerId}-sun-dot" cx="0" cy="0"/>`;

    svg += `</svg>`;

    // ── Legend ──
    svg += `<div class="sg-legend">`;
    for (const arc of ARC_DEFS) {
      svg += `<div class="sg-legend-item"><div class="sg-legend-dot" style="background:${arc.color}"></div>${arc.label}</div>`;
    }
    svg += `</div>`;

    wrap.innerHTML = svg;
    this._dotEl = document.getElementById(`${containerId}-sun-dot`);

    // Initial dot position
    this.updateDot();
  },

  _buildArcPath(svc, arc, lat) {
    const points = [];
    const hourMarkers = [];

    for (let h = 4; h <= 20; h += 0.25) {
      const sun = svc.getPosition(h, arc.day, lat);
      if (!sun.aboveHorizon || sun.altitude < 0.5) continue;
      const p = project(sun.azimuth, sun.altitude);
      points.push(p);

      // Mark integer hours
      if (h === Math.floor(h) && h >= 6 && h <= 18) {
        hourMarkers.push({ ...p, hour: h });
      }
    }

    if (points.length < 2) return '';

    // Build path
    let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L${points[i].x.toFixed(1)},${points[i].y.toFixed(1)}`;
    }

    let out = `<path class="sg-arc ${arc.cls}" d="${d}"/>`;

    // Hour markers
    for (const m of hourMarkers) {
      out += `<circle class="sg-hour-dot" cx="${m.x.toFixed(1)}" cy="${m.y.toFixed(1)}"/>`;
      out += `<text class="sg-hour-label" x="${m.x.toFixed(1)}" y="${(m.y - 3).toFixed(1)}">${m.hour}h</text>`;
    }

    return out;
  },

  updateDot(hour, dayOfYear) {
    if (!this._dotEl) return;
    const svc = window.SunCalcService;
    const ss  = window.SunState;
    if (!svc) return;

    const h = hour     ?? ss?.getHour()      ?? 12;
    const d = dayOfYear ?? ss?.getDayOfYear() ?? 172;
    const lat = ss?.getLat?.() ?? svc.DEFAULT_LAT;
    const sun = svc.getPosition(h, d, lat);

    if (!sun.aboveHorizon || sun.altitude < 0.5) {
      this._dotEl.setAttribute('cx', '0');
      this._dotEl.setAttribute('cy', '0');
      this._dotEl.style.opacity = '0.2';
      return;
    }

    const p = project(sun.azimuth, sun.altitude);
    this._dotEl.setAttribute('cx', p.x.toFixed(1));
    this._dotEl.setAttribute('cy', p.y.toFixed(1));
    this._dotEl.style.opacity = '1';
  },

  /** Compute min overhang angle for facade orientation on hottest day */
  computeOverhang(facadeAzDeg) {
    const svc = window.SunCalcService;
    const lat = window.SunState?.getLat?.() ?? svc?.DEFAULT_LAT ?? -21.1;
    if (!svc) return null;

    // La Réunion : soleil le plus haut au solstice d'été austral = 21 déc (jour 355)
    const hotDay = 355;
    let maxAlt = 0;
    let criticalHour = 12;

    // Sweep hours, find max altitude when sun faces the facade
    for (let h = 5; h <= 19; h += 0.25) {
      const sun = svc.getPosition(h, hotDay, lat);
      if (!sun.aboveHorizon) continue;

      // Sun faces facade when sun azimuth ≈ facade azimuth (±60°)
      let diff = Math.abs(sun.azimuth - facadeAzDeg);
      if (diff > 180) diff = 360 - diff;
      if (diff > 60) continue;

      if (sun.altitude > maxAlt) {
        maxAlt = sun.altitude;
        criticalHour = h;
      }
    }

    if (maxAlt < 1) return { angle: 0, altitude: 0, hour: 12, message: 'Facade non exposée au solstice' };

    // Overhang angle = complementary of solar altitude
    // angle from horizontal = 90 - altitude → for horizontal brise-soleil
    const overhangAngle = 90 - maxAlt;

    return {
      angle: Math.round(overhangAngle),
      altitude: Math.round(maxAlt),
      hour: criticalHour,
      message: `Alt. solaire max ${Math.round(maxAlt)}° à ${svc.getDateLabel?.(hotDay) ?? '21 déc.'} · Angle brise-soleil min : ${Math.round(overhangAngle)}°`
    };
  },
};

export default SunDiagramSVG;
