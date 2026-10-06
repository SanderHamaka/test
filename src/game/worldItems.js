import { pointInRing, ringArea } from './osmParse.js';
import { FOOD_TYPES } from './species.js';

const MAX_FOOD_PER_TILE = 160;
const TYPE = Object.fromEntries(FOOD_TYPES.map((t, i) => [t, i]));

// Which areas offer which food, and roughly how much (items per m², capped per area).
const AREA_FOOD = {
  water: [['fish', 1 / 5000, 10]],
  park: [['insects', 1 / 5000, 8], ['seeds', 1 / 12000, 3]],
  grass: [['insects', 1 / 9000, 6], ['mice', 1 / 12000, 4]],
  forest: [['insects', 1 / 9000, 6]],
  farmland: [['mice', 1 / 9000, 6], ['seeds', 1 / 12000, 4]],
  scrub: [['mice', 1 / 9000, 4]],
  wetland: [['insects', 1 / 7000, 6], ['fish', 1 / 20000, 2]],
  paved: [['seeds', 1 / 2500, 4]],
  allotments: [['seeds', 1 / 4000, 4], ['insects', 1 / 6000, 3]],
};

/**
 * Food spots owned by a tile, as a Float32Array of [x, y, z, type] in world coordinates.
 * Deterministic: the same tile always gets the same spots, so food doesn't jump around on reload.
 */
export function placeFood(features, rect, groundAt, isSeaAt) {
  let seed = (Math.abs(Math.round(rect.minX * 13 + rect.minZ * 7)) % 2147483646) + 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const inRect = (x, z) => x >= rect.minX && x < rect.maxX && z >= rect.minZ && z < rect.maxZ;
  const out = [];
  const add = (type, x, z, hover = 1.3) => {
    if (out.length / 4 < MAX_FOOD_PER_TILE) out.push(x, groundAt(x, z) + hover, z, TYPE[type]);
  };

  for (const spot of features.foodSpots) {
    if (inRect(spot.x, spot.z) && (spot.type !== 'seeds' || random() < 0.35)) add(spot.type, spot.x, spot.z, 1.6);
  }

  for (const area of features.areas) {
    const recipes = AREA_FOOD[area.kind];
    if (!recipes) continue;
    const outer = area.rings[0];
    const box = clippedBounds(outer, rect);
    if (!box) continue;
    const size = Math.min(Math.abs(ringArea(outer)), (box.maxX - box.minX) * (box.maxZ - box.minZ));
    for (const [type, density, cap] of recipes) {
      const count = Math.min(cap, Math.floor(size * density + random()));
      for (let k = 0, tries = 0; k < count && tries < count * 6; tries++) {
        const x = box.minX + random() * (box.maxX - box.minX);
        const z = box.minZ + random() * (box.maxZ - box.minZ);
        if (!pointInRing(x, z, outer)) continue;
        add(type, x, z, type === 'fish' ? 0.7 : 1.3);
        k++;
      }
    }
  }

  // Fish along rivers and canals, about every 150 m.
  for (const line of features.lines) {
    if (line.kind !== 'waterway' || line.width < 5) continue;
    const p = line.points;
    let carry = random() * 150;
    for (let i = 0; i < p.length - 2; i += 2) {
      const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
      for (let d = carry; d < len; d += 150) {
        const x = p[i] + ((p[i + 2] - p[i]) * d) / len, z = p[i + 1] + ((p[i + 3] - p[i + 1]) * d) / len;
        if (inRect(x, z)) add('fish', x, z, 0.7);
      }
      carry = (carry - len) % 150;
      if (carry < 0) carry += 150;
    }
  }

  // Fish at sea.
  if (isSeaAt) {
    for (let k = 0; k < 14; k++) {
      const x = rect.minX + random() * (rect.maxX - rect.minX);
      const z = rect.minZ + random() * (rect.maxZ - rect.minZ);
      if (isSeaAt(x, z)) add('fish', x, z, 0.7);
    }
  }
  return new Float32Array(out);
}

/** Named landmarks whose centre lies in this tile: [{ id, name, kind, x, y, z }] in world coordinates. */
export function ownedLandmarks(features, rect, groundAt) {
  const seen = new Set();
  return features.landmarks
    .filter((l) => l.x >= rect.minX && l.x < rect.maxX && l.z >= rect.minZ && l.z < rect.maxZ)
    .filter((l) => !seen.has(l.id) && seen.add(l.id))
    .map((l) => ({ ...l, y: groundAt(l.x, l.z) }));
}

function clippedBounds(ring, rect) {
  let minX = rect.maxX, minZ = rect.maxZ, maxX = rect.minX, maxZ = rect.minZ;
  for (let i = 0; i < ring.length; i += 2) {
    minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
    minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
  }
  minX = Math.max(minX, rect.minX); maxX = Math.min(maxX, rect.maxX);
  minZ = Math.max(minZ, rect.minZ); maxZ = Math.min(maxZ, rect.maxZ);
  return minX < maxX && minZ < maxZ ? { minX, minZ, maxX, maxZ } : null;
}

const RACE_ROADS = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'pedestrian']);
const RACE_WATER = new Set(['canal', 'river']);

/**
 * Streets and waterways that races can follow: [{ id, kind, points }] in world coordinates. Each way
 * belongs to the tile holding its first point, so it is sent once.
 */
export function ownedRoutes(features, rect) {
  return features.lines
    .filter((l) => (l.kind === 'road' && RACE_ROADS.has(l.type)) || (l.kind === 'waterway' && RACE_WATER.has(l.type)))
    .filter((l) => l.points[0] >= rect.minX && l.points[0] < rect.maxX && l.points[1] >= rect.minZ && l.points[1] < rect.maxZ)
    .map((l) => ({ id: l.id, kind: l.kind, points: new Float32Array(l.points) }));
}

const LIT_ROADS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'pedestrian', 'trunk']);
const LAMP_SPACING = 34;
const MAX_LAMPS_PER_TILE = 1500;

/**
 * Street lamps owned by a tile, as a Float32Array of [x, groundY, z]. Mapped lamps (highway=street_lamp)
 * are used where a tile has a reasonable number of them; otherwise lamps are placed along both sides of
 * lit roads, staggered, a little off the carriageway.
 */
export function placeLamps(features, rect, groundAt) {
  const inRect = (x, z) => x >= rect.minX && x < rect.maxX && z >= rect.minZ && z < rect.maxZ;
  const out = [];
  const add = (x, z) => {
    if (out.length / 3 < MAX_LAMPS_PER_TILE && inRect(x, z)) out.push(x, groundAt(x, z), z);
  };
  for (let i = 0; i < features.lamps.length; i += 2) add(features.lamps[i], features.lamps[i + 1]);
  if (out.length / 3 >= 10) return new Float32Array(out);

  out.length = 0;
  for (const line of features.lines) {
    if (line.kind !== 'road' || line.bridge || !LIT_ROADS.has(line.type)) continue;
    const p = line.points;
    const offset = line.width / 2 + 1.6;
    let carry = LAMP_SPACING / 2, side = 1;
    for (let i = 0; i < p.length - 2; i += 2) {
      const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1];
      const len = Math.hypot(dx, dz);
      if (len < 0.1) continue;
      const nx = -dz / len, nz = dx / len;
      for (let d = carry; d < len; d += LAMP_SPACING) {
        add(p[i] + (dx * d) / len + nx * offset * side, p[i + 1] + (dz * d) / len + nz * offset * side);
        side = -side;
      }
      carry = ((carry - len) % LAMP_SPACING + LAMP_SPACING) % LAMP_SPACING;
    }
  }
  return new Float32Array(out);
}
