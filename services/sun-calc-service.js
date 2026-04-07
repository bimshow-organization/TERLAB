// TERLAB · services/sun-calc-service.js
// Source : bimshow-shadow-study.html SunCalc — La Réunion lat=-21.1°

const SunCalcService = {

  // La Réunion — latitude par défaut
  DEFAULT_LAT: -21.1,

  getPosition(hour, dayOfYear, lat = this.DEFAULT_LAT) {
    const latR  = lat * Math.PI / 180;
    const decl  = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * Math.PI / 180);
    const declR = decl * Math.PI / 180;
    const ha    = (hour - 12) * 15 * Math.PI / 180;

    const sinAlt = Math.sin(latR) * Math.sin(declR) +
                   Math.cos(latR) * Math.cos(declR) * Math.cos(ha);
    const altitude = Math.asin(sinAlt) * 180 / Math.PI;

    const cosAzi = (Math.sin(declR) - Math.sin(latR) * sinAlt) /
                   (Math.cos(latR) * Math.cos(altitude * Math.PI / 180));
    let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAzi))) * 180 / Math.PI;
    if (hour > 12) azimuth = 360 - azimuth;

    return {
      altitude: Math.max(0, altitude),
      azimuth,
      aboveHorizon: altitude > 0,
    };
  },

  getDaylight(dayOfYear, lat = this.DEFAULT_LAT) {
    const latR  = lat * Math.PI / 180;
    const decl  = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * Math.PI / 180);
    const declR = decl * Math.PI / 180;
    const cos   = -Math.tan(latR) * Math.tan(declR);
    if (cos < -1) return { sunrise: 0, sunset: 24, hours: 24 };
    if (cos >  1) return { sunrise: 12, sunset: 12, hours: 0 };
    const ha     = Math.acos(cos) * 180 / Math.PI / 15;
    return { sunrise: 12 - ha, sunset: 12 + ha, hours: ha * 2 };
  },

  // Dates clés pour La Réunion (journées de référence architecturale)
  DATES_CLES: {
    '21 juin (solstice été)':       172,
    '21 déc. (solstice hiver)':     355,
    '21 mars (équinoxe)':            80,
    '23 sept. (équinoxe)':          266,
    'Cyclone jan. (Bélal)':          21,
  },

  getDateLabel(dayOfYear) {
    const d = new Date(2024, 0, dayOfYear);
    const M = ['jan.','fév.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
    return `${d.getDate()} ${M[d.getMonth()]}`;
  },
};

export default SunCalcService;
