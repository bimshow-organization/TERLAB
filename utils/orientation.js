// terlab/utils/orientation.js
// Fonctions pures d'orientation — RTAA DOM 2016 + HOUSEG-SPEECH spatial.master.json
// Source : Hémisphère sud — La Réunion 21°S, 55°E
// Convention azimut : 0° = Nord géographique, 90° = Est, sens horaire

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

const Orientation = {

  /**
   * Azimut géographique d'une façade
   * Compose trois angles : angle local du mur + rotation du bâtiment + correction nord parcelle
   * @param {number} wallAngleLocalDeg - angle du mur dans le repère local (0° = axe X)
   * @param {number} buildingRotationDeg - rotation de l'enveloppe / nord géographique
   * @param {number} northAngleDeg - angle du nord géographique depuis l'axe horizontal du canvas
   * @returns {number} azimut 0-360 (0° = nord, 90° = est)
   */
  facadeAzimuth(wallAngleLocalDeg, buildingRotationDeg = 0, northAngleDeg = 0) {
    return ((wallAngleLocalDeg + buildingRotationDeg + northAngleDeg) % 360 + 360) % 360;
  },

  /**
   * Convertir un azimut en direction cardinale (8 directions)
   * @param {number} az - azimut 0-360
   * @returns {string} 'N'|'NE'|'E'|'SE'|'S'|'SO'|'O'|'NO'
   */
  azimuthToCardinal(az) {
    return CARDINALS[Math.round(((az % 360) + 360) % 360 / 45) % 8];
  },

  /**
   * Convertir direction cardinale TERLAB (français) vers clé RTAA (W au lieu de O)
   * Les tables RTAA utilisent N/S/E/W, TERLAB utilise N/S/E/O
   * @param {string} cardinal - direction cardinale (ex: 'O', 'NO', 'SO')
   * @returns {string} clé RTAA (ex: 'W', 'NO', 'SO')
   */
  cardinalToRtaaKey(cardinal) {
    if (cardinal === 'O') return 'W';
    return cardinal;
  },

  /**
   * Angle local d'un segment de mur (deux sommets du polygone)
   * Retourne l'azimut de la normale sortante (perpendiculaire extérieure)
   * Convention : polygone CW → normale sortante = +90°
   * @param {Object} p1 - {x, y} premier point
   * @param {Object} p2 - {x, y} second point
   * @returns {number} angle en degrés 0-360
   */
  wallAngleFromSegment(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    // Azimut du segment (math convention : 0° = Est, +CCW)
    const segAngle = Math.atan2(dy, dx) * 180 / Math.PI;
    // Normale sortante = segment + 90° (pour polygone CW en SVG y-down)
    // Convertir en azimut géographique (0° = Nord = up, CW)
    const normalAz = (90 - segAngle + 90 + 360) % 360;
    return normalAz;
  },

  /**
   * Longueur d'un segment entre deux points
   * @param {Object} p1 - {x, y}
   * @param {Object} p2 - {x, y}
   * @returns {number} longueur en mètres
   */
  segmentLength(p1, p2) {
    return Math.hypot(p2.x - p1.x, p2.y - p1.y);
  },

  /**
   * Extraire toutes les façades d'un polygone avec leur azimut et longueur
   * @param {Array<{x:number,y:number}>} polygon - sommets du polygone
   * @param {number} buildingRotationDeg
   * @param {number} northAngleDeg
   * @returns {Array<{p1, p2, length, azimuth, cardinal}>}
   */
  extractFacades(polygon, buildingRotationDeg = 0, northAngleDeg = 0) {
    const facades = [];
    for (let i = 0; i < polygon.length; i++) {
      const j = (i + 1) % polygon.length;
      const p1 = polygon[i], p2 = polygon[j];
      const length = this.segmentLength(p1, p2);
      if (length < 0.1) continue; // ignorer segments dégénérés
      const wallAngle = this.wallAngleFromSegment(p1, p2);
      const azimuth = this.facadeAzimuth(wallAngle, buildingRotationDeg, northAngleDeg);
      facades.push({
        idx: i, p1, p2, length,
        azimuth: Math.round(azimuth * 10) / 10,
        cardinal: this.azimuthToCardinal(azimuth),
      });
    }
    return facades;
  },

  CARDINALS,
};

export default Orientation;
