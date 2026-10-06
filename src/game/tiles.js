/** Slippy-map tile maths (Web Mercator, the scheme used by OSM and terrain tile servers). */

export const TILE_ZOOM = 15;
/** Map data is downloaded per block: one tile at this zoom covers 2×2 tiles at TILE_ZOOM. */
export const BLOCK_ZOOM = TILE_ZOOM - 1;
/** Low-detail terrain for the distance uses big tiles (about 6 km across in the Netherlands). */
export const FAR_ZOOM = 12;

export function lonLatToTile(lat, lon, z = TILE_ZOOM) {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n),
  };
}

const tileLat = (y, n) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;

/** Geographic bounds of a tile. */
export function tileBounds(x, y, z = TILE_ZOOM) {
  const n = 2 ** z;
  return {
    west: (x / n) * 360 - 180,
    east: ((x + 1) / n) * 360 - 180,
    north: tileLat(y, n),
    south: tileLat(y + 1, n),
  };
}

/**
 * A tile as an axis-aligned rectangle in local metres. The local projection is separable in
 * lat and lon, so tile edges stay straight lines along x and z.
 */
export function tileRect(x, y, projection, z = TILE_ZOOM) {
  const b = tileBounds(x, y, z);
  const [minX, minZ] = projection.toLocal(b.north, b.west);
  const [maxX, maxZ] = projection.toLocal(b.south, b.east);
  return { minX, minZ, maxX, maxZ, ...b };
}

export const tileKey = (x, y) => `${x}/${y}`;
