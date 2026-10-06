/**
 * Sea mask for a tile. OSM doesn't map the sea as an area: it maps coastlines, drawn with the land on
 * the left and the sea on the right. So the coastlines are rasterised as barriers, seeds are placed just
 * to their right, and the sea is flood-filled from there. Tiles without any coastline are sea only when
 * the elevation data shows deep water across (nearly) the whole tile.
 */

export const SEA_MASK_SIZE = 256;

/**
 * @param coastlines  arrays of [x, z, x, z, …] in local metres
 * @param deepFraction  share of the tile's elevation samples that are well below sea level
 * @returns Uint8Array (1 = sea) of SEA_MASK_SIZE², or null when the tile has no sea
 */
export function computeSeaMask(coastlines, rect, deepFraction = 0) {
  const n = SEA_MASK_SIZE;
  const sx = n / (rect.maxX - rect.minX);
  const sz = n / (rect.maxZ - rect.minZ);
  const barrier = new Uint8Array(n * n);
  const seeds = [];
  let crosses = false;

  for (const line of coastlines) {
    for (let i = 0; i < line.length - 2; i += 2) {
      const ax = (line[i] - rect.minX) * sx, az = (line[i + 1] - rect.minZ) * sz;
      const bx = (line[i + 2] - rect.minX) * sx, bz = (line[i + 3] - rect.minZ) * sz;
      if (Math.max(ax, bx) < -2 || Math.min(ax, bx) > n + 2 || Math.max(az, bz) < -2 || Math.min(az, bz) > n + 2) continue;
      crosses = true;
      drawLine(barrier, n, ax, az, bx, bz);

      // Seeds on the sea side: the right of the direction of travel is (-dz, dx) in local x/z.
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      const rx = -(bz - az) / len, rz = (bx - ax) / len;
      const steps = Math.ceil(len / 4);
      for (let s = 0; s <= steps; s++) {
        const t = (s + 0.5) / (steps + 1);
        seeds.push(Math.floor(ax + (bx - ax) * t + rx * 1.8), Math.floor(az + (bz - az) * t + rz * 1.8));
      }
    }
  }

  if (!crosses) {
    if (deepFraction < 0.95) return null;
    return new Uint8Array(n * n).fill(1);
  }

  const sea = new Uint8Array(n * n);
  const stack = [];
  for (let i = 0; i < seeds.length; i += 2) {
    const x = seeds[i], z = seeds[i + 1];
    if (x < 0 || z < 0 || x >= n || z >= n) continue;
    const k = z * n + x;
    if (!barrier[k] && !sea[k]) {
      sea[k] = 1;
      stack.push(k);
    }
  }
  // 4-connected flood: it can't slip through the diagonal steps of an 8-connected barrier line.
  while (stack.length) {
    const k = stack.pop();
    const x = k % n, z = (k - x) / n;
    if (x > 0) visit(k - 1);
    if (x < n - 1) visit(k + 1);
    if (z > 0) visit(k - n);
    if (z < n - 1) visit(k + n);
  }
  function visit(k) {
    if (!barrier[k] && !sea[k]) {
      sea[k] = 1;
      stack.push(k);
    }
  }

  // The coastline pixels themselves go to whichever side most of their neighbours are on.
  for (let k = 0; k < n * n; k++) {
    if (!barrier[k]) continue;
    const x = k % n, z = (k - x) / n;
    let s = 0, c = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, zz = z + dz;
      if (xx < 0 || zz < 0 || xx >= n || zz >= n || barrier[zz * n + xx]) continue;
      s += sea[zz * n + xx];
      c++;
    }
    if (c && s * 2 > c) sea[k] = 1;
  }

  return sea.some((v) => v) ? sea : null;
}

/** Whether a local position falls on sea in a tile's mask. */
export function isSea(mask, rect, x, z) {
  const n = SEA_MASK_SIZE;
  const px = Math.min(n - 1, Math.max(0, Math.floor(((x - rect.minX) / (rect.maxX - rect.minX)) * n)));
  const pz = Math.min(n - 1, Math.max(0, Math.floor(((z - rect.minZ) / (rect.maxZ - rect.minZ)) * n)));
  return mask[pz * n + px] === 1;
}

/** 8-connected line rasterisation, clipped to the grid. */
function drawLine(grid, n, ax, az, bx, bz) {
  const steps = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(bz - az))) + 1;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = Math.floor(ax + (bx - ax) * t), z = Math.floor(az + (bz - az) * t);
    if (x >= 0 && z >= 0 && x < n && z < n) grid[z * n + x] = 1;
  }
}
