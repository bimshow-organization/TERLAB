// ═══════════════════════════════════════════════════════════════════════
// TERLAB · utils/geo-constants.js
// Constantes de projection locale plane — SOURCE CANONIQUE UNIQUE.
//
// @coords Contexte : deux conventions coexistent historiquement dans le repo
//   (a) M_PER_DEG_LNG = 103900 en dur   (terrain-mesh-builder, lidar-service)
//   (b) 111320 * cos(lat) calcule       (terrain-3d-viewer, buildings-3d-viewer)
// A la latitude de La Reunion (-20.9 a -21.4) l'ecart atteint ~0.5 %, deja
// compense par des hacks locaux (_autoAlignCadastre, M_LNG redefini en dur).
// NE PAS changer les call-sites existants sans re-valider l'alignement
// cadastre <-> LiDAR : les compensations empilées sont des guards (regle 2
// CLAUDE.md). Tout NOUVEAU code importe ces constantes ; le code metrique
// (tiles UTM40S) est immunise car il ne passe jamais par les degres.
// ═══════════════════════════════════════════════════════════════════════

/** Metres par degre de latitude (constant sur le globe a ~0.1% pres). */
export const M_PER_DEG_LAT = 111320;

/**
 * Metres par degre de longitude a la latitude donnee (degres).
 * Valeur exacte locale — a preferer pour tout nouveau code.
 */
export function mPerDegLng(latDeg) {
  return M_PER_DEG_LAT * Math.cos(latDeg * Math.PI / 180);
}

/**
 * Valeur historique figee utilisee par terrain-mesh-builder / lidar-service.
 * Correspond a cos(lat) ≈ 0.9333 soit lat ≈ -21.05 (milieu de l'ile).
 * Conservee pour compatibilite avec les caches et hacks d'alignement existants.
 */
export const M_PER_DEG_LNG_REUNION_LEGACY = 103900;

/** Bbox de garde La Reunion (WGS84) — coherente avec utils/copc-tile-index.js */
export const REUNION_BBOX = { west: 55.2, east: 55.9, south: -21.4, north: -20.85 };
