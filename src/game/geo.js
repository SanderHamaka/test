const EARTH_RADIUS = 6378137;
const DEG = Math.PI / 180;

/**
 * Local tangent-plane projection around a fixed origin. Accurate to well under
 * a metre within a few kilometres, which is all the playable area needs.
 * Three.js axes: +x = east, +z = south, so -z points north.
 */
export function createProjection(lat0, lon0) {
  const metresPerDegLat = EARTH_RADIUS * DEG;
  const metresPerDegLon = EARTH_RADIUS * DEG * Math.cos(lat0 * DEG);

  return {
    lat0,
    lon0,
    toLocal(lat, lon) {
      return [(lon - lon0) * metresPerDegLon, -(lat - lat0) * metresPerDegLat];
    },
    toLatLon(x, z) {
      return [lat0 - z / metresPerDegLat, lon0 + x / metresPerDegLon];
    },
  };
}

/** Bounding box (south, west, north, east) of a square with the given half-size in metres. */
export function bboxAround(lat, lon, radius) {
  const dLat = radius / (EARTH_RADIUS * DEG);
  const dLon = radius / (EARTH_RADIUS * DEG * Math.cos(lat * DEG));
  return { south: lat - dLat, west: lon - dLon, north: lat + dLat, east: lon + dLon };
}
