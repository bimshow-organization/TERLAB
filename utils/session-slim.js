// TERLAB · utils/session-slim.js
// Allegement d'une session avant ecriture localStorage (quota ~5 Mo).
// ════════════════════════════════════════════════════════════════════
// Deux familles de blobs saturent le quota :
//   - terrain.snap_*        : snapshots carte JPEG base64 (~60-100 Ko piece)
//   - phases[7].data.*      : bimshowSnapshot / snapshot_3d (PNG base64)
//                             et glb_base64 (modele 3D, plusieurs Mo)
// Ils restent en memoire dans _data (exports PDF) et partent vers Firebase ;
// seul l'ecrit localStorage les exclut. Regeneres au idle carte / re-export.
//
// Sans cette purge, setItem lance QuotaExceededError et TOUTE la session
// cesse d'etre persistee — l'etudiant perd son travail sans le savoir.
// ════════════════════════════════════════════════════════════════════

// Cles lourdes stockees dans phases[N].data
export const HEAVY_PHASE_KEYS = [
  'bimshowSnapshot',
  'snapshot_3d',
  'glb_snapshot',
  'glb_base64',
];

/** true si l'erreur est un depassement de quota localStorage (cross-navigateur) */
export function isQuotaError(err) {
  if (!err) return false;
  return err.name === 'QuotaExceededError'
    || err.name === 'NS_ERROR_DOM_QUOTA_REACHED'   // Firefox
    || err.code === 22 || err.code === 1014
    || /quota/i.test(err.message ?? '');
}

/**
 * Copie allegee d'une session (non destructif : l'objet source est intact).
 * @param {object} sess
 * @param {{ stripPhaseBlobs?: boolean }} [opts]
 *   stripPhaseBlobs : purger aussi les blobs de phase (defaut true).
 *   Passer false pour un premier essai « complet » avant repli.
 */
export function slimSession(sess, { stripPhaseBlobs = true } = {}) {
  if (!sess || typeof sess !== 'object') return sess;
  const out = { ...sess };

  // 1. Snapshots carte
  if (out.terrain && typeof out.terrain === 'object') {
    out.terrain = { ...out.terrain };
    for (const k of Object.keys(out.terrain)) {
      if (k.startsWith('snap_')) delete out.terrain[k];
    }
  }

  // 2. Blobs de phase (images base64 + GLB)
  if (stripPhaseBlobs && out.phases && typeof out.phases === 'object') {
    let phasesCopied = false;
    for (const [pid, phase] of Object.entries(out.phases)) {
      const data = phase?.data;
      if (!data || typeof data !== 'object') continue;
      const present = HEAVY_PHASE_KEYS.filter(k => data[k] != null);
      if (!present.length) continue;
      if (!phasesCopied) { out.phases = { ...out.phases }; phasesCopied = true; }
      const slimData = { ...data };
      for (const k of present) delete slimData[k];
      out.phases[pid] = { ...phase, data: slimData };
    }
  }

  return out;
}
