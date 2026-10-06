const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Bump when the query changes so stale cached tiles aren't reused.
const CACHE_NAME = 'osm-tiles-v2';

const LEISURE_AREAS = 'park|garden|pitch|playground|golf_course|nature_reserve|dog_park|track|common';
const NATURAL_AREAS = 'water|wood|grassland|scrub|heath|beach|sand|wetland|bare_rock|scree';

export function buildQuery({ south, west, north, east }) {
  const bbox = [south, west, north, east].map((v) => v.toFixed(7)).join(',');
  return `[out:json][timeout:90][bbox:${bbox}];
(
  way["building"];
  relation["building"]["type"="multipolygon"];
  way["highway"];
  way["railway"~"^(rail|tram|light_rail|narrow_gauge|subway)$"];
  way["waterway"~"^(river|canal|stream|riverbank|dock|ditch|drain)$"];
  way["landuse"];
  relation["landuse"];
  way["leisure"~"^(${LEISURE_AREAS})$"];
  relation["leisure"~"^(${LEISURE_AREAS})$"];
  way["natural"~"^(${NATURAL_AREAS})$"];
  relation["natural"~"^(${NATURAL_AREAS})$"];
  way["amenity"="parking"];
  way["area:highway"];
  node["natural"="tree"];
);
out geom qt;`;
}

/**
 * Fetches OSM data for a bounding box. Requests are GETs so they can be stored with the Cache API:
 * flying back over a place never asks the shared Overpass servers for the same tile again.
 */
export async function fetchOverpass(bbox) {
  const query = encodeURIComponent(buildQuery(bbox));
  const cache = await openCache();
  const urls = ENDPOINTS.map((endpoint) => `${endpoint}?data=${query}`);
  for (const url of urls) {
    const cached = await cache?.match(url);
    if (cached) return cached.json();
  }

  let lastError;
  for (const [i, url] of urls.entries()) {
    const endpoint = ENDPOINTS[i];
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${endpoint} answered ${response.status}`);
      const text = await response.text();
      const data = JSON.parse(text);
      // Overpass reports timeouts and overload inside a 200 response.
      if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark)) throw new Error(data.remark);
      cache?.put(url, new Response(text, { headers: { 'Content-Type': 'application/json' } })).catch(() => {});
      return data;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not load map data (${lastError?.message ?? 'unknown error'})`);
}

async function openCache() {
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null; // Cache API unavailable (e.g. insecure context): just don't cache.
  }
}
