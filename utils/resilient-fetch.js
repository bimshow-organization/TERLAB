// TERLAB · utils/resilient-fetch.js
// Fetch wrapper avec retry exponentiel, timeout, et fallback
// Inspiré des patterns GIEP terrain-extractor.js + IGN elevation service
// ENSA La Réunion · MGA Architecture
// ════════════════════════════════════════════════════════════════════

const DEFAULTS = {
  retries:       2,          // tentatives supplémentaires (total = 1 + retries)
  backoffMs:     500,        // délai initial entre retries
  timeoutMs:     10000,      // abort après 10s
  retryOn:       [429, 500, 502, 503, 504],  // HTTP status codes retriables
  retryOnError:  true,       // retry sur erreurs réseau (fetch throw)
  fallback:      undefined,  // valeur retournée si tout échoue (sinon throw)
  onRetry:       null,       // callback(attempt, error, delayMs)
};

/**
 * Fetch résilient avec retry exponentiel et timeout.
 *
 * @param {string|Request} input - URL ou Request
 * @param {RequestInit & typeof DEFAULTS} opts - options fetch + resilient-fetch
 * @returns {Promise<Response>}
 *
 * @example
 *   // Simple — timeout + 2 retries
 *   const resp = await resilientFetch('https://api.example.com/data');
 *   const json = await resp.json();
 *
 * @example
 *   // Avec fallback — ne throw jamais
 *   const resp = await resilientFetch(url, { fallback: null, retries: 3 });
 *   if (!resp) return cachedData;
 *
 * @example
 *   // POST avec options custom
 *   const resp = await resilientFetch(url, {
 *     method: 'POST',
 *     body: JSON.stringify(payload),
 *     headers: { 'Content-Type': 'application/json' },
 *     timeoutMs: 15000,
 *     retries: 1,
 *   });
 */
export default async function resilientFetch(input, opts = {}) {
  const {
    retries, backoffMs, timeoutMs, retryOn, retryOnError, fallback, onRetry,
    // Séparer les options resilient-fetch des options fetch natives
    ...fetchOpts
  } = { ...DEFAULTS, ...opts };

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Timeout via AbortSignal (composé avec un éventuel signal externe)
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      // Si l'appelant a passé son propre signal, le chaîner
      if (fetchOpts.signal) {
        fetchOpts.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      const resp = await fetch(input, { ...fetchOpts, signal: controller.signal });
      clearTimeout(timer);

      // Succès HTTP
      if (resp.ok) return resp;

      // HTTP error retriable ?
      if (retryOn.includes(resp.status) && attempt < retries) {
        lastError = new Error(`HTTP ${resp.status}`);
        const delay = backoffMs * Math.pow(2, attempt);
        onRetry?.(attempt + 1, lastError, delay);
        await _sleep(delay);
        continue;
      }

      // HTTP error non retriable — throw ou fallback
      lastError = new Error(`HTTP ${resp.status} ${resp.statusText}`);
      if (fallback !== undefined) return fallback;
      throw lastError;

    } catch (err) {
      clearTimeout?.(undefined); // safety
      lastError = err;

      // AbortError (timeout) ou erreur réseau
      if (retryOnError && attempt < retries && !_isAbortedByUser(err, fetchOpts.signal)) {
        const delay = backoffMs * Math.pow(2, attempt);
        onRetry?.(attempt + 1, err, delay);
        await _sleep(delay);
        continue;
      }

      if (fallback !== undefined) return fallback;
      throw err;
    }
  }

  // Normalement inatteignable, mais safety
  if (fallback !== undefined) return fallback;
  throw lastError;
}

// ── Helpers ──────────────────────────────────────────────────────

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Distinguer un abort par timeout interne vs abort par le caller */
function _isAbortedByUser(err, callerSignal) {
  return err.name === 'AbortError' && callerSignal?.aborted;
}

// ── Raccourcis pour les patterns TERLAB courants ──────────────────

/**
 * Fetch JSON résilient — parse la réponse en JSON automatiquement.
 * @returns {Promise<any>} parsed JSON, ou fallback si configuré
 */
export async function resilientJSON(input, opts = {}) {
  const resp = await resilientFetch(input, opts);
  if (resp === null || resp === undefined) return resp; // fallback null/undefined
  return resp.json();
}

/**
 * Fetch avec fallback endpoints — essaie chaque URL dans l'ordre.
 * Pattern utilisé par BuildingsService (Overpass mirrors).
 *
 * @param {string[]} urls - URLs à essayer dans l'ordre
 * @param {RequestInit & typeof DEFAULTS} opts - options partagées
 * @returns {Promise<Response>}
 */
export async function resilientFetchFirst(urls, opts = {}) {
  let lastError;
  for (const url of urls) {
    try {
      return await resilientFetch(url, { ...opts, retries: 0 });
    } catch (err) {
      lastError = err;
      console.warn(`[resilientFetch] ${url} failed:`, err.message);
      continue;
    }
  }
  if (opts.fallback !== undefined) return opts.fallback;
  throw lastError;
}
