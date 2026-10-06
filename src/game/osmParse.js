/**
 * Turns raw Overpass elements into simple features in local metres:
 * buildings (polygons with holes + height), flat areas, lines and tree points.
 */

const ROAD_WIDTHS = {
  motorway: 14, trunk: 12, primary: 10, secondary: 9, tertiary: 8,
  motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 7, tertiary_link: 6,
  residential: 6.5, unclassified: 6, living_street: 5, service: 4, road: 6, busway: 6,
  pedestrian: 5, track: 3, footway: 2, path: 1.6, cycleway: 2.2, bridleway: 2, steps: 2,
};
const SKIP_HIGHWAYS = new Set(['proposed', 'construction', 'abandoned', 'platform', 'bus_stop', 'elevator', 'raceway', 'corridor']);
const PATH_HIGHWAYS = new Set(['footway', 'path', 'cycleway', 'bridleway', 'steps', 'track', 'pedestrian']);
const WATERWAY_WIDTHS = { river: 18, canal: 10, stream: 3, ditch: 1.5, drain: 1.5 };
const RAIL_WIDTHS = { rail: 4, narrow_gauge: 3, light_rail: 3.5, tram: 3, subway: 4 };

export function parseOsm(elements, projection) {
  const result = { buildings: [], areas: [], lines: [], trees: [] };

  for (const el of elements) {
    const tags = el.tags ?? {};

    if (el.type === 'node') {
      if (tags.natural === 'tree') result.trees.push(...projection.toLocal(el.lat, el.lon));
      continue;
    }

    const polygons = el.type === 'way' ? wayPolygons(el, projection) : relationPolygons(el, projection);

    if (tags.building || tags['building:part']) {
      for (const rings of polygons) result.buildings.push({ rings, tags });
      continue;
    }

    const areaKind = classifyArea(tags, polygons.length > 0);
    if (areaKind) {
      for (const rings of polygons) result.areas.push({ kind: areaKind, rings, tags });
      continue;
    }

    if (el.type !== 'way' || !el.geometry) continue;
    const line = classifyLine(tags);
    if (line) result.lines.push({ ...line, points: projectFlat(el.geometry, projection) });
  }
  return result;
}

const isOn = (value) => value != null && value !== 'no';

function classifyLine(tags) {
  const common = { bridge: isOn(tags.bridge), layer: parseInt(tags.layer, 10) || 0 };
  const tunnel = isOn(tags.tunnel) || tags.covered === 'yes' || tags.location === 'underground';

  if (tags.highway && !SKIP_HIGHWAYS.has(tags.highway)) {
    if (tunnel) return null;
    return {
      kind: PATH_HIGHWAYS.has(tags.highway) ? 'path' : 'road',
      type: tags.highway,
      width: Math.min(parseFloat(tags.width) || ROAD_WIDTHS[tags.highway] || 4, 30),
      ...common,
    };
  }
  if (RAIL_WIDTHS[tags.railway] && !tunnel) {
    return { kind: 'rail', type: tags.railway, width: RAIL_WIDTHS[tags.railway], ...common };
  }
  if (WATERWAY_WIDTHS[tags.waterway] && tags.tunnel !== 'culvert' && !tunnel) {
    return { kind: 'waterway', type: tags.waterway, width: parseFloat(tags.width) || WATERWAY_WIDTHS[tags.waterway], ...common };
  }
  return null;
}

const LANDUSE_KINDS = {
  forest: 'forest', grass: 'grass', meadow: 'grass', village_green: 'grass', recreation_ground: 'grass',
  greenfield: 'grass', flowerbed: 'park', cemetery: 'cemetery', allotments: 'allotments', orchard: 'orchard',
  vineyard: 'orchard', farmland: 'farmland', farmyard: 'farmyard', residential: 'residential',
  commercial: 'commercial', retail: 'commercial', industrial: 'industrial', railway: 'industrial', port: 'industrial',
  construction: 'construction', brownfield: 'construction', landfill: 'construction', quarry: 'construction',
  basin: 'water', reservoir: 'water', military: 'industrial', education: 'residential', religious: 'residential',
};
const NATURAL_KINDS = {
  water: 'water', wood: 'forest', grassland: 'grass', heath: 'scrub', scrub: 'scrub', wetland: 'wetland',
  beach: 'sand', sand: 'sand', bare_rock: 'rock', scree: 'rock',
};
const LEISURE_KINDS = {
  park: 'park', garden: 'park', dog_park: 'park', common: 'grass', nature_reserve: 'grass', golf_course: 'golf',
  pitch: 'pitch', playground: 'playground', track: 'track',
};

function classifyArea(tags, closed) {
  if (!closed) return null;
  const { waterway } = tags;
  if (waterway === 'riverbank' || waterway === 'dock') return 'water';
  if (tags['area:highway'] || (tags.highway && tags.area === 'yes')) return 'paved';
  if (tags.amenity === 'parking') return 'parking';
  return NATURAL_KINDS[tags.natural] ?? LEISURE_KINDS[tags.leisure] ?? LANDUSE_KINDS[tags.landuse] ?? null;
}

function projectFlat(geometry, projection) {
  const out = new Array(geometry.length * 2);
  geometry.forEach((p, i) => {
    const [x, z] = projection.toLocal(p.lat, p.lon);
    out[i * 2] = x;
    out[i * 2 + 1] = z;
  });
  return out;
}

function isClosed(geometry) {
  const a = geometry[0];
  const b = geometry[geometry.length - 1];
  return geometry.length >= 4 && a.lat === b.lat && a.lon === b.lon;
}

/** A closed way is one polygon without holes. Returns [] for open ways. */
function wayPolygons(way, projection) {
  if (!way.geometry || !isClosed(way.geometry)) return [];
  const ring = projectFlat(way.geometry.slice(0, -1), projection);
  return [[ring]];
}

/** Multipolygon relation: stitch member ways into rings, then put each inner ring in its outer. */
function relationPolygons(relation, projection) {
  if (!relation.members) return [];
  const outers = stitchRings(relation.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry));
  const inners = stitchRings(relation.members.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry));

  const polygons = outers.map((outer) => [projectFlat(outer, projection)]);
  for (const inner of inners) {
    const ring = projectFlat(inner, projection);
    const owner = polygons.find((rings) => pointInRing(ring[0], ring[1], rings[0]));
    if (owner) owner.push(ring);
  }
  return polygons;
}

function stitchRings(members) {
  const pieces = members.map((m) => m.geometry.slice());
  const rings = [];
  const same = (a, b) => a.lat === b.lat && a.lon === b.lon;

  while (pieces.length) {
    let ring = pieces.shift();
    let extended = true;
    while (!same(ring[0], ring[ring.length - 1]) && extended) {
      extended = false;
      const end = ring[ring.length - 1];
      for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i];
        if (same(piece[0], end)) {
          ring = ring.concat(piece.slice(1));
        } else if (same(piece[piece.length - 1], end)) {
          ring = ring.concat(piece.slice(0, -1).reverse());
        } else {
          continue;
        }
        pieces.splice(i, 1);
        extended = true;
        break;
      }
    }
    if (ring.length >= 4 && same(ring[0], ring[ring.length - 1])) rings.push(ring.slice(0, -1));
  }
  return rings;
}

export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    sum += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
  }
  return sum / 2;
}

/** Deterministic 0..1 value from a position, so a building always gets the same random height/colour. */
export function hash01(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

const LEVEL_HEIGHT = 3.2;

function parseMetres(value) {
  if (value == null) return NaN;
  const n = parseFloat(String(value).replace(',', '.'));
  if (Number.isNaN(n)) return NaN;
  return /ft|'/.test(value) ? n * 0.3048 : n;
}

/** Height and base height of a building in metres, estimated from tags, type and footprint size. */
export function buildingHeights(tags, area, rnd) {
  let height = parseMetres(tags.height);
  if (Number.isNaN(height) && tags['building:levels']) {
    const levels = parseFloat(tags['building:levels']) + (parseFloat(tags['roof:levels']) || 0) * 0.6;
    if (!Number.isNaN(levels)) height = levels * LEVEL_HEIGHT + 1;
  }
  if (Number.isNaN(height) || height <= 0) height = estimateHeight(tags.building ?? tags['building:part'], area, rnd);

  let minHeight = parseMetres(tags.min_height);
  if (Number.isNaN(minHeight)) minHeight = (parseFloat(tags['building:min_level']) || 0) * LEVEL_HEIGHT;

  return { height: Math.min(height, 900), minHeight: Math.min(minHeight, height - 0.5) };
}

function estimateHeight(type, area, rnd) {
  switch (type) {
    case 'garage': case 'garages': case 'shed': case 'carport': case 'hut': case 'kiosk':
      return 2.6 + rnd;
    case 'roof':
      return 4;
    case 'house': case 'detached': case 'semidetached_house': case 'terrace': case 'bungalow':
      return 6 + rnd * 4;
    case 'apartments':
      return 12 + rnd * 15;
    case 'office': case 'commercial': case 'hotel':
      return 14 + rnd * 25;
    case 'industrial': case 'warehouse': case 'retail': case 'supermarket':
      return 7 + rnd * 5;
    case 'church': case 'cathedral':
      return 18 + rnd * 10;
  }
  if (area < 60) return 3 + rnd * 2;
  if (area < 200) return 7 + rnd * 5;
  if (area < 1000) return 10 + rnd * 10;
  return 12 + rnd * 12;
}

const NAMED_COLOURS = {
  white: [0.92, 0.91, 0.88], black: [0.15, 0.15, 0.15], grey: [0.55, 0.55, 0.55], gray: [0.55, 0.55, 0.55],
  red: [0.62, 0.25, 0.2], brown: [0.48, 0.33, 0.24], yellow: [0.85, 0.75, 0.45], beige: [0.85, 0.78, 0.64],
  orange: [0.8, 0.5, 0.3], blue: [0.35, 0.45, 0.6], green: [0.4, 0.55, 0.4], tan: [0.82, 0.7, 0.55],
  silver: [0.75, 0.75, 0.75], maroon: [0.5, 0.2, 0.2], darkgray: [0.35, 0.35, 0.35], lightgrey: [0.8, 0.8, 0.8],
};

/** Parses an OSM colour tag (#rgb, #rrggbb or a common name) into linear-ish 0..1 RGB, or null. */
export function parseColour(value) {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (NAMED_COLOURS[v]) return NAMED_COLOURS[v];
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}
