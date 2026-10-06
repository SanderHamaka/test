import { createProjection } from './geo.js';
import { fetchOverpass } from './overpass.js';
import { parseOsm } from './osmParse.js';
import { buildTile } from './meshBuilder.js';
import { paintGround } from './groundPainter.js';
import { demoElevation, fetchTerrarium, sampleTerrarium } from './terrain.js';
import { generateDemoCity } from './demoCity.js';
import { TILE_ZOOM, lonLatToTile, tileBounds, tileRect } from './tiles.js';

/**
 * Builds map tiles off the main thread.
 *
 * In:  { type: 'origin', lat, lon, demo }            → { type: 'origin', elevation }
 *      { type: 'tile', id, x, y, origin, demo }      → { type: 'tile', id, tile } | { type: 'error', id, message }
 * origin = { lat, lon, elevation }: the world's (0, 0, 0) point. Elevations are returned relative to it.
 */

let demoElements = null;

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'origin') {
      self.postMessage({ type: 'origin', elevation: await originElevation(data) });
    } else if (data.type === 'tile') {
      const tile = await loadTile(data);
      self.postMessage({ type: 'tile', id: data.id, tile }, collectTransferables(tile));
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

async function loadTile({ x, y, origin, demo }) {
  const projection = createProjection(origin.lat, origin.lon);
  const rect = tileRect(x, y, projection);

  const [osm, terrain] = await Promise.all([
    demo ? (demoElements ??= generateDemoCity()) : fetchOverpass(rect),
    demo ? null : fetchTerrarium(TILE_ZOOM, x, y),
  ]);

  const elevationAt = demo
    ? (px, pz) => demoElevation(px, pz) - origin.elevation
    : terrain
      ? (px, pz) => sampleTerrarium(terrain, (px - rect.minX) / (rect.maxX - rect.minX), (pz - rect.minZ) / (rect.maxZ - rect.minZ)) - origin.elevation
      : () => 0;

  const features = parseOsm(osm.elements, projection);
  const tile = buildTile(features, rect, elevationAt);
  tile.ground = paintGround(features, rect);
  tile.flatTerrain = !demo && !terrain;
  return tile;
}

function collectTransferables(value, out = []) {
  if (ArrayBuffer.isView(value)) out.push(value.buffer);
  else if (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) out.push(value);
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectTransferables(v, out));
  return out;
}
