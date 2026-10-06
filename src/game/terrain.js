/**
 * Elevation from Terrarium tiles (Mapzen / AWS Open Data): 256×256 PNGs where
 * metres = R * 256 + G + B / 256 - 32768.
 */

const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const SIZE = 256;

// Terrarium includes sea-floor depths. Without a sea surface that would show as deep trenches along
// coasts, so depths are clamped; -12 m still leaves room for polders below sea level.
const MIN_ELEVATION = -12;

/**
 * Elevation grid for one tile, or null when it can't be fetched (callers then use flat ground).
 * The array also gets a `deepFraction` property: the share of samples well below sea level, which
 * tells open sea apart from polders when a tile has no coastline in it.
 */
export async function fetchTerrarium(z, x, y) {
  try {
    const response = await fetch(`${TERRARIUM_URL}/${z}/${x}/${y}.png`);
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob(), {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
    const canvas = new OffscreenCanvas(SIZE, SIZE);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, SIZE, SIZE).data;

    const heights = new Float32Array(SIZE * SIZE);
    let deep = 0;
    for (let i = 0; i < heights.length; i++) {
      const e = pixels[i * 4] * 256 + pixels[i * 4 + 1] + pixels[i * 4 + 2] / 256 - 32768;
      if (e < -8) deep++;
      heights[i] = Math.max(e, MIN_ELEVATION);
    }
    heights.deepFraction = deep / heights.length;
    return heights;
  } catch {
    return null;
  }
}

/**
 * Bilinear elevation lookup at fractional tile coordinates (u, v in 0..1, v down = south).
 * Pixel centres sit at (i + 0.5) / SIZE, so edges are clamped to the outermost pixels.
 */
export function sampleTerrarium(heights, u, v) {
  const px = Math.min(Math.max(u * SIZE - 0.5, 0), SIZE - 1);
  const py = Math.min(Math.max(v * SIZE - 0.5, 0), SIZE - 1);
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, SIZE - 1), y1 = Math.min(y0 + 1, SIZE - 1);
  const fx = px - x0, fy = py - y0;
  const h = (x, y) => heights[y * SIZE + x];
  return (h(x0, y0) * (1 - fx) + h(x1, y0) * fx) * (1 - fy) + (h(x0, y1) * (1 - fx) + h(x1, y1) * fx) * fy;
}

/** Rolling hills for the offline demo, as a function of local metres. */
export function demoElevation(x, z) {
  const ridge = 28 * Math.sin(x / 520) * Math.cos(z / 610) + 12 * Math.sin((x + z) / 260);
  const flatCentre = Math.min(1, Math.hypot(x, z) / 700); // keep the demo city itself fairly flat
  return 6 + ridge * flatCentre * flatCentre;
}

/** Terrain grid resolution per tile (segments per side). */
export const GRID = 64;

/** Bilinear height lookup into a tile's (GRID+1)² height grid, clamped to the tile. */
export function createGridSampler(rect, heights, grid = GRID) {
  const w = rect.maxX - rect.minX;
  const d = rect.maxZ - rect.minZ;
  return (x, z) => {
    const gx = Math.min(Math.max(((x - rect.minX) / w) * grid, 0), grid);
    const gz = Math.min(Math.max(((z - rect.minZ) / d) * grid, 0), grid);
    const x0 = Math.min(Math.floor(gx), grid - 1), z0 = Math.min(Math.floor(gz), grid - 1);
    const fx = gx - x0, fz = gz - z0;
    const h = (i, j) => heights[j * (grid + 1) + i];
    return (h(x0, z0) * (1 - fx) + h(x0 + 1, z0) * fx) * (1 - fz) + (h(x0, z0 + 1) * (1 - fx) + h(x0 + 1, z0 + 1) * fx) * fz;
  };
}
