const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const GREEN_LANDUSE = 'grass|forest|meadow|recreation_ground|village_green|cemetery|allotments|orchard';
const GREEN_LEISURE = 'park|garden|pitch|playground|golf_course|nature_reserve|dog_park';
const NATURAL_AREAS = 'wood|grassland|scrub|heath|beach|sand|wetland';

export function buildQuery({ south, west, north, east }) {
  const bbox = `${south},${west},${north},${east}`;
  return `[out:json][timeout:90][bbox:${bbox}];
(
  way["building"];
  relation["building"]["type"="multipolygon"];
  way["highway"]["area"!="yes"];
  way["natural"="water"];
  relation["natural"="water"];
  way["waterway"~"^(river|canal|stream|riverbank|dock)$"];
  way["landuse"~"^(${GREEN_LANDUSE})$"];
  relation["landuse"~"^(${GREEN_LANDUSE})$"];
  way["leisure"~"^(${GREEN_LEISURE})$"];
  relation["leisure"~"^(${GREEN_LEISURE})$"];
  way["natural"~"^(${NATURAL_AREAS})$"];
  relation["natural"~"^(${NATURAL_AREAS})$"];
  node["natural"="tree"];
);
out geom qt;`;
}

/**
 * Fetches OSM data from the first Overpass endpoint that answers.
 * Reports downloaded bytes through onProgress so the loading screen can show activity.
 */
export async function fetchOverpass(bbox, onProgress = () => {}) {
  const body = 'data=' + encodeURIComponent(buildQuery(bbox));
  let lastError;

  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!response.ok) throw new Error(`${endpoint} answered ${response.status}`);
      return JSON.parse(await readWithProgress(response, onProgress));
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not load map data (${lastError?.message ?? 'unknown error'})`);
}

async function readWithProgress(response, onProgress) {
  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
    onProgress(bytes);
  }
  return text + decoder.decode();
}
