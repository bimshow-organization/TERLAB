// terlab/services/space-producer.js
// Génération de pièces fictives depuis une enveloppe Phase 11
// Adapté de HOUSEG-SPEECH engine/space-producer.js (391L)
// Utilitaires géométriques portés fidèlement, logique de subdivision TERLAB-spécifique
// Vanilla JS ES2022+ — La Réunion

import Orientation from '../utils/orientation.js';

// ── Programmes types par nombre de chambres ──────────────────────────────────
const PROGRAMMES = {
  1: { sejour: 0.35, chambre: [0.25], cuisine: 0.15, sdb: 0.10, circulation: 0.15 },
  2: { sejour: 0.30, chambre: [0.20, 0.18], cuisine: 0.12, sdb: 0.10, circulation: 0.10 },
  3: { sejour: 0.28, chambre: [0.18, 0.16, 0.14], cuisine: 0.10, sdb: 0.08, circulation: 0.06 },
  4: { sejour: 0.25, chambre: [0.15, 0.14, 0.13, 0.12], cuisine: 0.09, sdb: 0.07, circulation: 0.05 },
};

// ── Baies par type de pièce (dimensions en mètres) ──────────────────────────
const BAIES_TYPES = {
  sejour: [
    { width: 1.40, height: 2.10, menuiserie_type: 'pf_coulissante_2v', menuiserie: 'coulissant_2v' },
    { width: 0.90, height: 1.20, menuiserie_type: 'fen_battante', menuiserie: 'battant' },
  ],
  chambre: [
    { width: 0.90, height: 1.20, menuiserie_type: 'fen_battante', menuiserie: 'battant' },
  ],
  chambre_parentale: [
    { width: 1.20, height: 1.20, menuiserie_type: 'fen_battante', menuiserie: 'battant' },
  ],
  cuisine: [
    { width: 0.90, height: 1.20, menuiserie_type: 'fen_battante', menuiserie: 'battant' },
  ],
  sdb: [
    { width: 0.60, height: 0.80, menuiserie_type: 'jalousie_opaque', menuiserie: 'jalousie' },
  ],
};

const SpaceProducer = {

  /**
   * Générer des pièces depuis une enveloppe et un programme
   * @param {Array<{x,y}>} polygon - enveloppe en coordonnées locales (mètres)
   * @param {Object} session - données session TERLAB
   * @returns {Array} rooms compatibles RTAAChecker et RTAAVentilation
   */
  fromEnvelope(polygon, session) {
    if (!polygon || polygon.length < 3) return [];

    const terrain = session?.terrain ?? {};
    const p7 = session?.phases?.[7]?.data ?? {};
    const nb_chambres = parseInt(p7.nb_chambres ?? terrain.nb_chambres ?? 2);
    const programme = PROGRAMMES[Math.min(Math.max(nb_chambres, 1), 4)];
    const buildingRotation = parseFloat(terrain.building_rotation_deg ?? 0);
    const northAngle = parseFloat(terrain.north_angle_deg ?? 0);

    // Bounding box de l'enveloppe
    const bbox = _polyBBox(polygon);
    const totalArea = Math.abs(_shoelace(polygon));

    // Subdiviser en pièces rectangulaires
    const rooms = [];
    let cursor_y = bbox.minY;
    let roomIdx = 0;

    // Distribution verticale simple (empilement N→S)
    const pieces = this._buildPieceList(programme, nb_chambres, totalArea);

    for (const piece of pieces) {
      const height_m = Math.max(piece.area / bbox.width, 2.0); // profondeur minimale 2m
      const room = {
        id: `room_${roomIdx++}`,
        type: piece.type,
        label: piece.label,
        x: bbox.minX,
        y: cursor_y,
        w: bbox.width,
        h: Math.min(height_m, bbox.height - (cursor_y - bbox.minY)),
        areaSqm: piece.area,
        openings: [],
        by_facade: {},
      };

      // Déterminer les façades exposées
      const exposedSides = this._findExposedSides(room, bbox);

      // Placer des baies sur les façades exposées
      const baies = BAIES_TYPES[piece.type] ?? [];
      for (const side of exposedSides) {
        for (const baie of baies) {
          const cardinal = Orientation.azimuthToCardinal(
            Orientation.facadeAzimuth(
              this._sideToAngle(side), buildingRotation, northAngle
            )
          );
          room.openings.push({
            id: `op_${room.id}_${cardinal}`,
            side: cardinal,
            direction: cardinal,
            width: baie.width,
            height: baie.height,
            menuiserie_type: baie.menuiserie_type,
            menuiserie: baie.menuiserie,
          });
          room.by_facade[cardinal] = (room.by_facade[cardinal] ?? 0) + baie.width;
        }
      }

      rooms.push(room);
      cursor_y += room.h;
    }

    return rooms;
  },

  /**
   * Construire la liste ordonnée des pièces depuis le programme
   */
  _buildPieceList(programme, nb_chambres, totalArea) {
    const pieces = [];

    // Séjour
    pieces.push({
      type: 'sejour', label: 'Séjour',
      area: totalArea * programme.sejour,
    });

    // Chambres
    for (let i = 0; i < programme.chambre.length; i++) {
      pieces.push({
        type: i === 0 ? 'chambre_parentale' : 'chambre',
        label: i === 0 ? 'Chambre parentale' : `Chambre ${i + 1}`,
        area: totalArea * programme.chambre[i],
      });
    }

    // Cuisine
    pieces.push({
      type: 'cuisine', label: 'Cuisine',
      area: totalArea * programme.cuisine,
    });

    // SdB
    pieces.push({
      type: 'sdb', label: 'Salle de bain',
      area: totalArea * programme.sdb,
    });

    return pieces;
  },

  /**
   * Déterminer quelles façades d'une room sont exposées (touchent le bord de l'enveloppe)
   */
  _findExposedSides(room, bbox) {
    const sides = [];
    const TOL = 0.1;
    if (Math.abs(room.y - bbox.minY) < TOL) sides.push('N'); // haut = nord
    if (Math.abs((room.y + room.h) - bbox.maxY) < TOL) sides.push('S'); // bas = sud
    if (Math.abs(room.x - bbox.minX) < TOL) sides.push('W');
    if (Math.abs((room.x + room.w) - bbox.maxX) < TOL) sides.push('E');
    return sides.length > 0 ? sides : ['S']; // fallback
  },

  /**
   * Convertir un côté géométrique en angle local
   */
  _sideToAngle(side) {
    switch (side) {
      case 'N': return 0;
      case 'E': return 90;
      case 'S': return 180;
      case 'W': return 270;
      default: return 0;
    }
  },
};

// ── Utilitaires géométriques (portés de HOUSEG-SPEECH) ──────────────────────

/** Shoelace formula — surface signée */
function _shoelace(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
}

/** Supprimer les points colinéaires */
function _simplifyPolygon(pts, tol = 0.05) {
  if (pts.length <= 4) return pts;
  const result = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const cross = (curr.x - prev.x) * (next.y - prev.y) - (curr.y - prev.y) * (next.x - prev.x);
    if (Math.abs(cross) > tol) result.push(curr);
  }
  return result.length >= 3 ? result : pts;
}

/** Centroïde d'un polygone */
function _centroid(pts) {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  return { x: Math.round(cx / pts.length * 100) / 100, y: Math.round(cy / pts.length * 100) / 100 };
}

/** Bounding box */
function _polyBBox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Orientation dominante (angle du plus long segment) */
function _dominantOrientation(pts) {
  if (pts.length < 2) return 0;
  let maxLen = 0, angle = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
    const len = Math.hypot(dx, dy);
    if (len > maxLen) { maxLen = len; angle = Math.atan2(dy, dx); }
  }
  return Math.round(angle * 180 / Math.PI * 10) / 10;
}

// Exporter aussi les utilitaires pour tests
SpaceProducer._shoelace = _shoelace;
SpaceProducer._simplifyPolygon = _simplifyPolygon;
SpaceProducer._centroid = _centroid;
SpaceProducer._polyBBox = _polyBBox;
SpaceProducer._dominantOrientation = _dominantOrientation;

export default SpaceProducer;
