// Bump when request formats change so stale cached responses aren't reused.
const CACHE_NAME = 'fly-data-v3';

/**
 * GETs JSON through the browser's Cache API: each URL is downloaded once, then served locally.
 * `validate` may throw to reject a response (it is then neither returned nor cached).
 */
export async function fetchJsonCached(url, validate = () => {}) {
  const cache = await openCache();
  const cached = await cache?.match(url);
  if (cached) return cached.json();

  const response = await fetch(url);
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  const text = await response.text();
  const data = JSON.parse(text);
  validate(data);
  cache?.put(url, new Response(text, { headers: { 'Content-Type': 'application/json' } })).catch(() => {});
  return data;
}

const OLD_CACHES = ['osm-tiles-v1', 'osm-tiles-v2'];
let cleanedUp = false;

async function openCache() {
  try {
    if (!cleanedUp) {
      cleanedUp = true;
      OLD_CACHES.forEach((name) => caches.delete(name).catch(() => {}));
    }
    return await caches.open(CACHE_NAME);
  } catch {
    return null; // Cache API unavailable (e.g. insecure context): just don't cache.
  }
}
