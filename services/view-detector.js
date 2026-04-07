// terlab/services/view-detector.js
// Détecte si un point (sol + 2m) a une vue mer ou montagne
// Méthode : raycast vers secteurs mer/montagne + analyse altimétrique

const ViewDetector = {

  // La Réunion : secteurs mer = côtes (altitude < 100m au bout du rayon)
  // Montagne = Piton des Neiges / Fournaise direction + altitude > 800m
  REUNION_SEA_BEARINGS:      [0, 45, 90, 135, 180, 225, 270, 315], // tous les 45°
  REUNION_MOUNTAIN_CENTER:   { lat: -21.09, lng: 55.48 },          // Piton des Neiges
  REUNION_FOURNAISE_CENTER:  { lat: -21.24, lng: 55.71 },          // Piton de la Fournaise
  VIEW_HORIZON_M:            500,   // distance max de "vue proche" (500m)
  EYE_HEIGHT_M:              2,     // hauteur d'œil (sol + 2m)

  /**
   * Détecter la vue depuis un point GPS + altitude
   * @param {number} lat - Latitude du point d'observation
   * @param {number} lng - Longitude du point d'observation
   * @param {number} altNGR - Altitude NGR du terrain
   * @param {number} buildingH - Hauteur du bâtiment (égout)
   * @returns {{ hasSeaView, hasMountainView, vueScore, viewDirection, viewType }}
   */
  detect(lat, lng, altNGR, buildingH = 0) {
    const eyeAlt = altNGR + this.EYE_HEIGHT_M;  // sol + 2m

    // ── Vue mer ──────────────────────────────────────────────────
    const distToCoast_km = this._estimateDistanceToCoast(lat, lng);
    const hasSeaView = altNGR < 200 && distToCoast_km < 5;

    // Direction de la mer (azimut vers la côte la plus proche)
    const seaDirection = this._azimuthToCoast(lat, lng);

    // ── Vue montagne ──────────────────────────────────────────────
    const distToPiton_km = this._distanceKm(lat, lng,
      this.REUNION_MOUNTAIN_CENTER.lat,
      this.REUNION_MOUNTAIN_CENTER.lng);
    const hasMountainView = altNGR < 800 && distToPiton_km < 20 &&
      !this._isObstructedByRelief(lat, lng,
        this.REUNION_MOUNTAIN_CENTER.lat,
        this.REUNION_MOUNTAIN_CENTER.lng, altNGR);

    const mountainDirection = this._bearing(lat, lng,
      this.REUNION_MOUNTAIN_CENTER.lat,
      this.REUNION_MOUNTAIN_CENTER.lng);

    // ── Score composite ──────────────────────────────────────────
    let vueScore = 0;
    let viewDirection = 0;
    let viewType = null;

    if (hasSeaView) {
      vueScore = Math.max(vueScore, this._seaViewScore(distToCoast_km, altNGR));
      viewDirection = seaDirection;
      viewType = 'mer';
    }
    if (hasMountainView) {
      const mScore = this._mountainViewScore(distToPiton_km, altNGR);
      if (mScore > vueScore) {
        vueScore = mScore;
        viewDirection = mountainDirection;
        viewType = 'montagne';
      }
    }

    return { hasSeaView, hasMountainView, vueScore, viewDirection, viewType };
  },

  // ── Helpers ──────────────────────────────────────────────────
  _distanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) *
              Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  },

  _bearing(lat1, lng1, lat2, lng2) {
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1*Math.PI/180)*Math.sin(lat2*Math.PI/180) -
               Math.sin(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.cos(dLng);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
  },

  // Estimation distance côte — version simplifiée avec points de référence Réunion
  _estimateDistanceToCoast(lat, lng) {
    const COTES = [
      { lat: -20.882, lng: 55.450, nom: 'Saint-Denis Nord' },
      { lat: -21.340, lng: 55.479, nom: 'Saint-Pierre Sud' },
      { lat: -21.053, lng: 55.222, nom: 'Saint-Gilles Ouest' },
      { lat: -21.035, lng: 55.712, nom: 'Saint-Benoît Est' },
      { lat: -20.946, lng: 55.290, nom: 'Le Port Nord-Ouest' },
      { lat: -21.196, lng: 55.600, nom: 'Saint-Philippe Sud-Est' },
    ];
    return Math.min(...COTES.map(c => this._distanceKm(lat, lng, c.lat, c.lng)));
  },

  _azimuthToCoast(lat, lng) {
    const COTES = [
      { lat: -20.882, lng: 55.450 }, { lat: -21.340, lng: 55.479 },
      { lat: -21.053, lng: 55.222 }, { lat: -21.035, lng: 55.712 },
    ];
    let minDist = Infinity, azimuth = 0;
    COTES.forEach(c => {
      const d = this._distanceKm(lat, lng, c.lat, c.lng);
      if (d < minDist) { minDist = d; azimuth = this._bearing(lat, lng, c.lat, c.lng); }
    });
    return azimuth;
  },

  // Vérifier si relief obstrue la vue (simplification par altitude interpolée)
  _isObstructedByRelief(lat1, lng1, lat2, lng2, eyeAlt) {
    const midLat = (lat1 + lat2) / 2, midLng = (lng1 + lng2) / 2;
    const midAlt = this._estimateAlt(midLat, midLng);
    const targetAlt = 2632;
    const lineOfSight = eyeAlt + (targetAlt - eyeAlt) * 0.5;
    return midAlt > lineOfSight;
  },

  _estimateAlt(lat, lng) {
    const refs = [
      { lat: -21.09, lng: 55.48, alt: 2632 },
      { lat: -21.24, lng: 55.71, alt: 2631 },
      { lat: -20.88, lng: 55.45, alt: 30 },
      { lat: -21.34, lng: 55.48, alt: 25 },
    ];
    let wSum = 0, altW = 0;
    refs.forEach(r => {
      const d = this._distanceKm(lat, lng, r.lat, r.lng);
      const w = 1 / (d + 0.01);
      altW += r.alt * w; wSum += w;
    });
    return altW / wSum;
  },

  _seaViewScore(distKm, altNGR) {
    if (distKm > 10) return 0;
    const distScore = Math.max(0, 1 - distKm / 5);
    const altScore  = altNGR < 50 ? 1 : altNGR < 150 ? 0.7 : 0.4;
    return distScore * altScore;
  },

  _mountainViewScore(distKm, altNGR) {
    if (distKm > 25 || altNGR > 1200) return 0;
    const distScore = Math.max(0, 1 - distKm / 15);
    const altScore  = altNGR > 600 ? 1 : altNGR > 300 ? 0.7 : 0.5;
    return distScore * altScore;
  },
};

export default ViewDetector;
