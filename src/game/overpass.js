import { fetchJsonCached } from './cache.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

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
  way["natural"="coastline"];
  nw["amenity"~"^(restaurant|fast_food|cafe|marketplace|ice_cream|pub|bar|bench)$"];
  nwr["name"]["tourism"~"^(attraction|museum|viewpoint|zoo|theme_park|gallery|aquarium)$"];
  nwr["name"]["historic"~"^(castle|monument|fort|city_gate|ruins|windmill|church|tower|manor)$"];
  nwr["name"]["amenity"="place_of_worship"];
  nwr["name"]["man_made"~"^(tower|lighthouse|windmill|watermill)$"];
  nwr["name"]["railway"="station"];
  nwr["name"]["leisure"="stadium"];
  node["natural"="tree"];
);
out geom qt;`;
}

/**
 * Fetches OSM data for a bounding box from the first Overpass server that answers. Requests are GETs
 * stored in the Cache API, so flying back over a place never asks the shared servers for it again.
 */
export async function fetchOverpass(bbox) {
  const query = encodeURIComponent(buildQuery(bbox));
  let lastError;
  for (const endpoint of ENDPOINTS) {
    try {
      return await fetchJsonCached(`${endpoint}?data=${query}`, (data) => {
        // Overpass reports timeouts and overload inside a 200 response.
        if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark)) throw new Error(data.remark);
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not load map data (${lastError?.message ?? 'unknown error'})`);
}
