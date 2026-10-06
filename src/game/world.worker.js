import { createProjection } from './geo.js';
import { fetchOverpass } from './overpass.js';
import { parseOsm } from './osmParse.js';
import { buildTile } from './meshBuilder.js';
import { coverGrid, paintGround } from './groundPainter.js';
import { createGridSampler, demoElevation, fetchTerrarium, sampleTerrarium } from './terrain.js';
import { ownedLandmarks, ownedRoutes, placeFood, placeLamps } from './worldItems.js';
import { generateDemoCity } from './demoCity.js';
import { bagId, fetchBagHeights, inNetherlands } from './bag3d.js';
import { computeSeaMask, isSea } from './sea.js';
import { BLOCK_ZOOM, FAR_ZOOM, TILE_ZOOM, lonLatToTile, tileBounds, tileRect } from './tiles.js';

/**
 * Builds map tiles off the main thread.
 *
 * In:  { type: 'origin', lat, lon, demo }        → { type: 'origin', elevation }
 *      { type: 'far', id, x, y, origin, demo }   → { type: 'far', id, far }: low-detail distant terrain
 *      { type: 'block', id, x, y, origin, demo } → four × { type: 'tile', id, x, y, tile, partial }
 *                                                   then { type: 'blockDone', id, partial, error, measured }
 * A block is one BLOCK_ZOOM tile: its map data is downloaded once and split into 2×2 TILE_ZOOM tiles.
 * If the map data can't be fetched the tiles still come back, with terrain only, marked partial.
 * origin = { lat, lon, elevation }: the world's (0, 0, 0) point. Elevations are returned relative to it.
 */

let demoElements = null;

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'origin') {
      self.postMessage({ type: 'origin', elevation: await originElevation(data) });
    } else if (data.type === 'block') {
      await loadBlock(data);
    } else if (data.type === 'far') {
      const far = await loadFarTile(data);
      self.postMessage({ type: 'far', id: data.id, far }, collectTransferables(far));
    }
  } catch (error) {
    self.postMessage({ type: 'error', id: data.id, message: error.message ?? String(error) });
  }
};

async function originElevation({ lat, lon, demo }) {
  if (demo) return demoElevation(0, 0);
  const { x, y } = lonLatToTile(lat, lon);
  const heights = await fetchTerrarium(TILE_ZOOM, x, y);
  if (!heights) return 0;
  const b = tileBounds(x, y);
  return sampleTerrarium(heights, (lon - b.west) / (b.east - b.west), (b.north - lat) / (b.north - b.south));
}

async function loadBlock({ id, x, y, origin, demo }) {
  const projection = createProjection(origin.lat, origin.lon);
  const bounds = tileBounds(x, y, BLOCK_ZOOM);
  let osm;
  let error = null;
  const bag = !demo && inNetherlands(bounds) ? fetchBagHeights(bounds).catch(() => null) : null;
  try {
    osm = demo ? (demoElements ??= generateDemoCity()) : await fetchOverpass(bounds);
  } catch (e) {
    error = e.message;
    osm = { elements: [] };
  }
  const features = parseOsm(osm.elements, projection);
  const partial = !!error;
  const measured = applyMeasuredHeights(features, await bag);

  // Terrain for the four tiles downloads in parallel; each tile is posted as soon as it is built.
  await Promise.all([0, 1, 2, 3].map(async (i) => {
    const tx = x * 2 + (i % 2), ty = y * 2 + (i >> 1);
    const tile = await buildOne(tx, ty, features, projection, origin, demo);
    self.postMessage({ type: 'tile', id, x: tx, y: ty, tile, partial }, collectTransferables(tile));
  }));
  self.postMessage({ type: 'blockDone', id, partial, error, measured });
}

/** Attaches measured heights to buildings by BAG id. Returns match statistics, or null when unavailable. */
function applyMeasuredHeights(features, heights) {
  if (!heights) return null;
  let matched = 0;
  for (const building of features.buildings) {
    const measured = heights.get(bagId(building.tags['ref:bag']));
    if (measured) {
      building.measured = measured;
      matched++;
    }
  }
  return { source: '3D BAG', matched, buildings: features.buildings.length, available: heights.size };
}

async function buildOne(x, y, features, projection, origin, demo) {
  const rect = tileRect(x, y, projection);
  const terrain = demo ? null : await fetchTerrarium(TILE_ZOOM, x, y);

  const landAt = demo
    ? (px, pz) => demoElevation(px, pz) - origin.elevation
    : terrain
      ? (px, pz) => sampleTerrarium(terrain, (px - rect.minX) / (rect.maxX - rect.minX), (pz - rect.minZ) / (rect.maxZ - rect.minZ)) - origin.elevation
      : () => 0;

  // The sea is flat at sea level, whatever the elevation data says about the sea floor.
  const deepFraction = demo ? (rect.minZ > 1900 ? 1 : 0) : (terrain?.deepFraction ?? 0);
  const sea = computeSeaMask(features.coastlines, rect, deepFraction);
  const seaLevel = -origin.elevation - 0.3;
  const elevationAt = sea ? (px, pz) => (isSea(sea, rect, px, pz) ? seaLevel : landAt(px, pz)) : landAt;

  const tile = buildTile(features, rect, elevationAt);
  tile.ground = paintGround(features, rect, sea);
  tile.cover = coverGrid(tile.ground);
  const groundAt = createGridSampler(tile.rect, tile.heights);
  tile.food = placeFood(features, rect, groundAt, sea ? (px, pz) => isSea(sea, rect, px, pz) : null);
  tile.landmarks = ownedLandmarks(features, rect, groundAt);
  tile.routes = ownedRoutes(features, rect);
  tile.lamps = placeLamps(features, rect, groundAt);
  return tile;
}

const FAR_GRID = 48;

/** Terrain-only tile for the distance: heights relative to the origin, coloured by height and slope. */
async function loadFarTile({ x, y, origin, demo }) {
  const projection = createProjection(origin.lat, origin.lon);
  const rect = tileRect(x, y, projection, FAR_ZOOM);
  const terrain = demo ? null : await fetchTerrarium(FAR_ZOOM, x, y);
  const n = FAR_GRID + 1;
  const absolute = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const px = rect.minX + ((rect.maxX - rect.minX) * i) / FAR_GRID;
      const pz = rect.minZ + ((rect.maxZ - rect.minZ) * j) / FAR_GRID;
      absolute[j * n + i] = demo ? demoElevation(px, pz) : terrain ? sampleTerrarium(terrain, i / FAR_GRID, j / FAR_GRID) : origin.elevation;
    }
  }

  const heights = new Float32Array(n * n);
  const colours = new Float32Array(n * n * 3);
  const spacing = (rect.maxX - rect.minX) / FAR_GRID;
  const at = (i, j) => absolute[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const e = at(i, j);
      const slope = Math.hypot(at(i + 1, j) - at(i - 1, j), at(i, j + 1) - at(i, j - 1)) / (2 * spacing);
      // Deep water in the elevation data is sea (shallow negatives are polders); keep it flat at sea level.
      const sea = e < -8;
      heights[j * n + i] = (sea ? 0 : e) - origin.elevation;
      const c = sea ? [0.03, 0.1, 0.16]
        : e > 2600 ? [0.85, 0.87, 0.9]
          : slope > 0.65 || e > 1900 ? [0.25, 0.23, 0.2]
            : e > 400 ? [0.16, 0.2, 0.1]
              : [0.2, 0.27, 0.12];
      colours.set(c, (j * n + i) * 3);
    }
  }
  return { rect: { minX: rect.minX, minZ: rect.minZ, maxX: rect.maxX, maxZ: rect.maxZ }, grid: FAR_GRID, heights, colours };
}

function collectTransferables(value, out = []) {
  if (ArrayBuffer.isView(value)) out.push(value.buffer);
  else if (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) out.push(value);
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectTransferables(v, out));
  return out;
}
