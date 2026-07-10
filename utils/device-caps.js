// TERLAB · device-caps.js — détection de terminal faible
// Heuristique conservatrice pour dégrader la charge GPU/mémoire sur les
// téléphones étudiants (LiDAR COPC + Three.js + Mapbox simultanés) :
// deviceMemory (Chrome/Android uniquement), cœurs CPU, taille max de
// texture WebGL. Résultat mémoïsé — la détection ne tourne qu'une fois.

let _caps = null;

export function getDeviceCaps() {
  if (_caps) return _caps;

  const memory = navigator.deviceMemory ?? null;        // Go — absent sur Safari/Firefox
  const cores  = navigator.hardwareConcurrency ?? null;
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  const small  = window.innerWidth <= 800;

  let maxTextureSize = null;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (gl) {
      maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* WebGL indisponible → lowSpec */ }

  const lowSpec =
    maxTextureSize === null ||                       // pas de WebGL exploitable
    (memory !== null && memory <= 4) ||              // ≤ 4 Go
    (cores !== null && cores <= 4) ||                // ≤ 4 cœurs
    maxTextureSize < 8192;                           // GPU d'entrée de gamme

  _caps = {
    memory, cores, coarse, small, maxTextureSize, lowSpec,
    // Budgets dérivés — consommés par lidar-service et les viewers 3D
    lidarMaxPoints: lowSpec ? 60_000 : (coarse || small ? 120_000 : 200_000),
    pixelRatioCap:  lowSpec ? 1 : (coarse || small ? 1.5 : 2),
  };
  if (_caps.lowSpec) {
    console.info('[DeviceCaps] Terminal faible détecté — budgets réduits', _caps);
  }
  return _caps;
}

export default { getDeviceCaps };
