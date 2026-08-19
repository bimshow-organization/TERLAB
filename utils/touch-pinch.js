/* ═══════════════════════════════════════════════════════════════
 * TERLAB · touch-pinch.js
 * Pinch-zoom tactile pour les editeurs SVG zoom-molette-only.
 * Convertit un pincement 2 doigts en WheelEvent synthetiques sur
 * l'element : les handlers `wheel` existants (esquisse-canvas,
 * metaforme-events, section-profile-viewer) fonctionnent tels quels
 * (deltaY < 0 = zoom in, clientX/Y = milieu du pincement).
 * ═══════════════════════════════════════════════════════════════ */

/**
 * @param {Element} el — element portant deja un listener `wheel`
 * @param {{step?: number, threshold?: number}} [opts]
 *   step      : |deltaY| emis par cran de pincement (defaut 60)
 *   threshold : variation d'ecartement (px) declenchant un cran (defaut 4)
 * @returns {() => void} detach
 */
export function attachPinchZoom(el, { step = 60, threshold = 4 } = {}) {
  let lastDist = 0;

  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid  = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

  const onStart = (e) => {
    if (e.touches.length === 2) {
      lastDist = dist(e.touches);
      e.preventDefault(); // pas de zoom page Safari
    }
  };

  const onMove = (e) => {
    if (e.touches.length !== 2 || !lastDist) return;
    e.preventDefault();
    const d = dist(e.touches);
    const delta = d - lastDist;
    if (Math.abs(delta) < threshold) return;
    lastDist = d;
    const m = mid(e.touches);
    el.dispatchEvent(new WheelEvent('wheel', {
      deltaY:  delta > 0 ? -step : step,
      clientX: m.x,
      clientY: m.y,
      bubbles: true,
      cancelable: true,
    }));
  };

  const onEnd = (e) => {
    if (e.touches.length < 2) lastDist = 0;
  };

  el.addEventListener('touchstart',  onStart, { passive: false });
  el.addEventListener('touchmove',   onMove,  { passive: false });
  el.addEventListener('touchend',    onEnd,   { passive: true });
  el.addEventListener('touchcancel', onEnd,   { passive: true });

  return () => {
    el.removeEventListener('touchstart',  onStart);
    el.removeEventListener('touchmove',   onMove);
    el.removeEventListener('touchend',    onEnd);
    el.removeEventListener('touchcancel', onEnd);
  };
}

export default { attachPinchZoom };
