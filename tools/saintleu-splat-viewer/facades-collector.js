/**
 * TERLAB . facades-collector.js
 * Collecteur de facades depuis Google Street View pour calibration
 * de la palette typologique creole. Workflow :
 *   1. User navigue Google Maps Street View dans une fenetre a part
 *   2. Quand il voit une facade interessante : copie l'URL Maps
 *   3. Paste dans le viewer -> parse panoid/heading/pitch/lat/lng
 *   4. Fetch via /api/streetview-thumb (proxy serve_coop.py)
 *   5. Display thumb + bouton "Save" qui POST vers /api/save-facade
 *
 * Le thumb est stocke dans sota/facades_collection/{zone}/{ts}_{panoid}.jpg
 * + manifest.json. Plus tard : DINOv2 sur la collection -> palette.
 */


/**
 * Parse une URL Google Maps Street View et extrait panoid/pitch/yaw/lat/lng.
 * Format attendu :
 *   .../@LAT,LNG,Zy,YAWh,PITCHt/data=!3m7!1e1!3m5!1sPANOID!2e0!6shttps...
 */
export function parseMapsUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const result = {};
  // @lat,lng,zoom_or_y,yawh,pitcht
  const at = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+),[^/]+/);
  if (at) {
    result.lat = parseFloat(at[1]);
    result.lng = parseFloat(at[2]);
  }
  // yaw : "260.81h"
  const yaw = url.match(/,(\-?\d+(?:\.\d+)?)h[,/]/);
  if (yaw) result.yaw = parseFloat(yaw[1]);
  // pitch : "87.88t"  (Google = inclinaison camera depuis horizontale + 90, donc 87.88t = -2.12 deg pitch reel)
  const pitch = url.match(/,(\-?\d+(?:\.\d+)?)t[,/]/);
  if (pitch) {
    // Convert : Maps t = 90 - pitch_real_deg (90 = horizontal, 0 = nadir)
    // donc pitch_thumbnail = (90 - t_value)
    result.pitch_t_value = parseFloat(pitch[1]);
    result.pitch = 90 - parseFloat(pitch[1]);
  }
  // panoid : "1sXXXXXXXX!" (1s avant, ! apres)
  const panoid = url.match(/!1s([^!]+)!/);
  if (panoid) result.panoid = decodeURIComponent(panoid[1]);
  // Si panoid pas dans data= mais en query ?panoid=...
  if (!result.panoid) {
    const m2 = url.match(/[?&]panoid=([^&]+)/);
    if (m2) result.panoid = decodeURIComponent(m2[1]);
  }
  return result;
}


/**
 * Fetch un thumbnail Street View via proxy local (CORS bypass).
 */
export async function fetchStreetViewThumb({ panoid, w = 900, h = 600, pitch = 0, yaw = 0 }) {
  const qs = new URLSearchParams({
    panoid, w: String(w), h: String(h),
    pitch: String(pitch), yaw: String(yaw),
  });
  const url = `/api/streetview-thumb?${qs.toString()}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`thumb fetch ${r.status}`);
  const blob = await r.blob();
  return blob;
}


/**
 * POST une facade capturee vers /api/save-facade. Le serveur la sauve
 * dans sota/facades_collection/{zone}/{ts}_{panoid}.jpg + manifest.
 */
export async function saveFacade({ zone, panoid, blob, meta }) {
  // Convert blob to base64
  const b64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  const r = await fetch('/api/save-facade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      zone, panoid,
      image_b64: b64,
      meta: meta || {},
    }),
  });
  if (!r.ok) throw new Error(`save ${r.status}`);
  return await r.json();
}


/**
 * Liste les entries du manifest pour 1 zone.
 */
export async function listFacades(zone) {
  const r = await fetch(`/api/list-facades?zone=${encodeURIComponent(zone)}`);
  if (!r.ok) return { entries: [] };
  return await r.json();
}


/**
 * Cree le panneau UI dans un parent donne. Retourne {refresh()} pour
 * rafraichir la galerie quand la zone change.
 */
export function mountFacadesPanel({ parentEl, getCurrentZone }) {
  parentEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'facades-panel';
  wrap.style.cssText = 'box-sizing:border-box;width:100%;max-width:100%;overflow:hidden;';
  wrap.innerHTML = `
    <div class="fc-row" style="display:flex;gap:4px;width:100%;box-sizing:border-box;">
      <input type="text" class="fc-url" placeholder="Coller URL Google Street View..."
             style="flex:1;min-width:0;background:#0e0e10;color:#e6e3da;border:1px solid #2a2a2e;
                    border-radius:4px;padding:5px 7px;font-size:11px;font-family:monospace;
                    box-sizing:border-box;">
      <button class="fc-capture" style="background:var(--accent);color:#1a1411;border:0;
                                          border-radius:4px;padding:5px 10px;font-size:11px;
                                          font-weight:600;cursor:pointer;flex-shrink:0;">Capture</button>
    </div>
    <div class="fc-status" style="font-size:10px;color:#888;margin:6px 0;min-height:14px;
                                   word-break:break-word;"></div>
    <div class="fc-preview" style="display:none;margin:8px 0;width:100%;box-sizing:border-box;">
      <img class="fc-preview-img" style="display:block;width:100%;max-width:100%;height:auto;
                                          border-radius:4px;border:1px solid #2a2a2e;">
      <div style="display:flex;gap:6px;margin-top:6px;width:100%;box-sizing:border-box;">
        <input type="text" class="fc-label" placeholder="Tag (ex: bois_bleu, beton_R1...)"
               style="flex:1;min-width:0;background:#0e0e10;color:#e6e3da;border:1px solid #2a2a2e;
                      border-radius:4px;padding:4px 6px;font-size:11px;box-sizing:border-box;">
        <button class="fc-save" style="background:#3F7A4D;color:#fff;border:0;
                                         border-radius:4px;padding:4px 10px;font-size:11px;
                                         font-weight:600;cursor:pointer;flex-shrink:0;">Save</button>
      </div>
    </div>
    <h2 style="font-size:10px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;
               color:var(--muted);margin:12px 0 6px;">Collection zone</h2>
    <div class="fc-gallery" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
                                    gap:4px;max-height:200px;overflow-y:auto;overflow-x:hidden;
                                    width:100%;box-sizing:border-box;"></div>
  `;
  parentEl.appendChild(wrap);

  const $ = (sel) => wrap.querySelector(sel);
  const urlInp   = $('.fc-url');
  const captureBtn = $('.fc-capture');
  const statusEl = $('.fc-status');
  const previewEl = $('.fc-preview');
  const previewImg = $('.fc-preview-img');
  const labelInp = $('.fc-label');
  const saveBtn  = $('.fc-save');
  const galleryEl = $('.fc-gallery');

  let pendingBlob = null;
  let pendingMeta = null;

  function setStatus(t, isError = false) {
    statusEl.textContent = t;
    statusEl.style.color = isError ? '#d34e2d' : '#888';
  }

  captureBtn.onclick = async () => {
    const url = urlInp.value.trim();
    const parsed = parseMapsUrl(url);
    if (!parsed?.panoid) {
      setStatus('URL invalide : pas de panoid trouve', true);
      return;
    }
    setStatus(`Fetch panoid ${parsed.panoid.slice(0, 12)}... yaw=${parsed.yaw?.toFixed(0)} pitch=${parsed.pitch?.toFixed(1)}`);
    try {
      const blob = await fetchStreetViewThumb({
        panoid: parsed.panoid,
        w: 900, h: 600,
        pitch: parsed.pitch ?? 0,
        yaw: parsed.yaw ?? 0,
      });
      const objUrl = URL.createObjectURL(blob);
      previewImg.src = objUrl;
      previewEl.style.display = 'block';
      pendingBlob = blob;
      pendingMeta = parsed;
      setStatus(`Capture OK (${(blob.size/1024).toFixed(0)} KB) - tag puis Save`);
    } catch (e) {
      setStatus(`Erreur : ${e.message}`, true);
    }
  };

  saveBtn.onclick = async () => {
    if (!pendingBlob || !pendingMeta) {
      setStatus('rien a sauver', true);
      return;
    }
    const zone = getCurrentZone() || 'unknown';
    try {
      const res = await saveFacade({
        zone,
        panoid: pendingMeta.panoid,
        blob: pendingBlob,
        meta: {
          lat: pendingMeta.lat, lng: pendingMeta.lng,
          yaw: pendingMeta.yaw, pitch: pendingMeta.pitch,
          label: labelInp.value.trim() || null,
        },
      });
      setStatus(`Sauve (${res.n_entries} entries dans ${zone})`);
      pendingBlob = null;
      pendingMeta = null;
      previewEl.style.display = 'none';
      labelInp.value = '';
      urlInp.value = '';
      await refresh();
    } catch (e) {
      setStatus(`Save FAIL : ${e.message}`, true);
    }
  };

  async function refresh() {
    const zone = getCurrentZone();
    if (!zone) return;
    galleryEl.innerHTML = '';
    try {
      const data = await listFacades(zone);
      for (const e of data.entries.slice().reverse()) {
        const cell = document.createElement('div');
        cell.style.cssText = 'position:relative;aspect-ratio:3/2;border-radius:3px;'
          + 'overflow:hidden;border:1px solid #2a2a2e;background:#0e0e10;'
          + 'min-width:0;width:100%;box-sizing:border-box;';
        cell.innerHTML = `
          <img src="../../sota/facades_collection/${zone}/${e.file}"
               style="width:100%;height:100%;max-width:100%;object-fit:cover;display:block;"
               title="${e.label ?? ''} ${e.ts}">
          ${e.label ? `<div style="position:absolute;bottom:0;left:0;right:0;
                                    background:rgba(0,0,0,0.6);color:#fff;
                                    font-size:9px;padding:1px 4px;text-align:center;">
                       ${e.label}</div>` : ''}
        `;
        galleryEl.appendChild(cell);
      }
    } catch {}
  }

  return { refresh };
}
