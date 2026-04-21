/**
 * TERLAB · parking.js
 * Resolution parking + placement geometrique.
 * Aucune mutation d'etat — fonctions pures.
 */

const PK_M2 = 25; // m2 par place de parking (2.5 × 5m + circ)

/**
 * Resout le mode parking optimal selon le budget et le choix utilisateur.
 * @param {Object} params
 * @param {number} params.nbLgts - nombre de logements
 * @param {number} params.emprise - emprise au sol du batiment (m2)
 * @param {number} params.budgetPerm - budget impermeable total (m2)
 * @param {string} params.userChoice - 'auto' | 'ext' | 'rdc' | 'ss'
 * @returns {Object} { mode, pkExt, pkRdc, pkSS, pkTotal, empPark, warning? }
 */
export function resolveParking({ nbLgts, emprise, budgetPerm, userChoice = 'auto' }) {
  const pkTotal = nbLgts * 2; // 2 places par logement
  const pkExtM2 = pkTotal * PK_M2;

  if (userChoice === 'ss') {
    return { mode: 'ss', pkExt: 0, pkRdc: 0, pkSS: pkTotal, pkTotal, empPark: 0 };
  }

  if (userChoice === 'rdc') {
    const rdcCap = Math.floor(emprise * 0.80 / PK_M2);
    const surplus = Math.max(0, pkTotal - rdcCap);
    return { mode: 'rdc', pkExt: 0, pkRdc: Math.min(rdcCap, pkTotal), pkSS: surplus, pkTotal, empPark: 0 };
  }

  if (userChoice === 'ext') {
    if (emprise + pkExtM2 <= budgetPerm) {
      return { mode: 'ext', pkExt: pkTotal, pkRdc: 0, pkSS: 0, pkTotal, empPark: pkExtM2 };
    }
    // Ext ne passe pas → warning
    const maxPkExt = Math.max(0, Math.floor((budgetPerm - emprise) / PK_M2));
    const surplus = pkTotal - maxPkExt;
    return {
      mode: 'ext', pkExt: maxPkExt, pkRdc: 0, pkSS: surplus, pkTotal,
      empPark: maxPkExt * PK_M2,
      warning: `PK ext partiel : ${maxPkExt}/${pkTotal} places (budget perm. depasse) — ${surplus} en SS`,
    };
  }

  // Auto : ext si possible, sinon rdc, sinon ss
  if (emprise + pkExtM2 <= budgetPerm) {
    return { mode: 'ext', pkExt: pkTotal, pkRdc: 0, pkSS: 0, pkTotal, empPark: pkExtM2 };
  }
  const rdcCap = Math.floor(emprise * 0.80 / PK_M2);
  if (rdcCap >= pkTotal) {
    return { mode: 'rdc', pkExt: 0, pkRdc: pkTotal, pkSS: 0, pkTotal, empPark: 0 };
  }
  return { mode: 'ss', pkExt: 0, pkRdc: 0, pkSS: pkTotal, pkTotal, empPark: 0 };
}

/**
 * Place le parking exterieur geometriquement cote voie.
 * Retourne un polygone [[x,y],...] representant la zone parking.
 *
 * @param {Array} parcelPoly - polygone parcelle [[x,y],...]
 * @param {Array<string>} edgeTypes - type par arete ['voie','lat','fond',...]
 * @param {number} pkExtM2 - surface parking ext requise (m2)
 * @param {Array} blocPolys - polygones des batiments [{polygon:[{x,y}]},...]
 * @returns {{ polygon: Array<[number,number]>, label: string } | null}
 */
export function placeParkingExt(parcelPoly, edgeTypes, pkExtM2, blocPolys = []) {
  if (pkExtM2 <= 0 || !parcelPoly?.length) return null;

  // Trouver l'arete voie la plus longue
  const n = parcelPoly.length;
  let bestIdx = -1, bestLen = 0;
  for (let i = 0; i < n; i++) {
    if (edgeTypes[i] !== 'voie') continue;
    const [x1, y1] = parcelPoly[i], [x2, y2] = parcelPoly[(i + 1) % n];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len > bestLen) { bestLen = len; bestIdx = i; }
  }

  if (bestIdx < 0) return null;

  const [ax, ay] = parcelPoly[bestIdx];
  const [bx, by] = parcelPoly[(bestIdx + 1) % n];
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;

  // Normale inward
  const nx = -dy / len, ny = dx / len;

  // Dimensions parking : profondeur 5m standard, longueur = pkExtM2 / 5
  const profondeur = 5;
  const longueur = Math.min(len * 0.9, pkExtM2 / profondeur);

  // Centrer sur l'arete voie, offset inward par le recul voie (~1m marge)
  const margin = 1;
  const cx = (ax + bx) / 2, cy = (ay + by) / 2;
  const ux = dx / len, uy = dy / len;

  const p1 = [cx - ux * longueur / 2 + nx * margin,       cy - uy * longueur / 2 + ny * margin];
  const p2 = [cx + ux * longueur / 2 + nx * margin,       cy + uy * longueur / 2 + ny * margin];
  const p3 = [cx + ux * longueur / 2 + nx * (margin + profondeur), cy + uy * longueur / 2 + ny * (margin + profondeur)];
  const p4 = [cx - ux * longueur / 2 + nx * (margin + profondeur), cy - uy * longueur / 2 + ny * (margin + profondeur)];

  const places = Math.floor(pkExtM2 / PK_M2);
  return {
    polygon: [p1, p2, p3, p4],
    label: `${places} PK ext`,
    profondeur,
    longueur,
  };
}

const Parking = { resolveParking, placeParkingExt, PK_M2 };
if (typeof window !== 'undefined') window.Parking = Parking;
export default Parking;
