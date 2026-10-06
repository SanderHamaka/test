/**
 * Paints a tile's ground (land use, water, roads, rails, soft shadows around buildings) into a
 * texture. Painting instead of layering flat meshes means the ground drapes perfectly over terrain,
 * never z-fights, and roads can have sidewalks, rounded joins and markings for free.
 */

import { ringArea } from './osmParse.js';
import { SEA_MASK_SIZE } from './sea.js';

export const GROUND_TEXTURE_SIZE = 1024;

// Water must be painted in exactly this colour: the terrain shader recognises it to make water glossy.
export const WATER_COLOUR = '#2e5a70';

const BASE_COLOUR = '#9eab79'; // land without a land-use tag: mostly countryside

const AREA_STYLES = {
  // [fill colour, draw order]; later orders paint over earlier ones.
  farmland: ['#c4c98d', 0], farmyard: ['#c9bfa5', 0], residential: ['#cbc6bb', 0], commercial: ['#cfc4bf', 0],
  industrial: ['#bfbcc2', 0], construction: ['#c3b393', 0],
  grass: ['#9fbe78', 1], scrub: ['#8fa86a', 1], wetland: ['#93ad86', 1], forest: ['#55804a', 1],
  park: ['#8cba6a', 2], cemetery: ['#9bb787', 2], allotments: ['#a9c283', 2], orchard: ['#a2c27a', 2], golf: ['#94c477', 2],
  sand: ['#e3d5a7', 3], rock: ['#b2aca3', 3], pitch: ['#79b062', 3], playground: ['#c7b48f', 3], track: ['#b4614f', 3],
  parking: ['#a9a8a6', 4], paved: ['#d1cbc0', 4],
  water: [WATER_COLOUR, 5],
};

const ROAD_STYLES = {
  // [asphalt, has centre line]
  motorway: ['#45474c', true], trunk: ['#45474c', true], primary: ['#4a4c51', true], secondary: ['#4d4f54', true],
  tertiary: ['#515357', true], residential: ['#57595e', false], unclassified: ['#57595e', false],
  living_street: ['#8c8780', false], service: ['#5d5f63', false], busway: ['#7a3f3c', false],
};
const PATH_COLOURS = {
  cycleway: '#b45b52', footway: '#cdbfa6', path: '#b9a888', bridleway: '#a99572', track: '#a69172',
  steps: '#bdb8b0', pedestrian: '#d3cbbd',
};

export function paintGround(features, rect, seaMask = null, size = GROUND_TEXTURE_SIZE) {
  if (typeof OffscreenCanvas === 'undefined') return null;

  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const sx = size / (rect.maxX - rect.minX);
  const sz = size / (rect.maxZ - rect.minZ);
  const metre = (sx + sz) / 2;
  ctx.setTransform(sx, 0, 0, sz, -rect.minX * sx, -rect.minZ * sz); // draw in local metres

  ctx.fillStyle = BASE_COLOUR;
  ctx.fillRect(rect.minX, rect.minZ, rect.maxX - rect.minX, rect.maxZ - rect.minZ);

  const areas = features.areas
    .filter((a) => AREA_STYLES[a.kind])
    .map((a) => ({ ...a, order: AREA_STYLES[a.kind][1], size: Math.abs(ringArea(a.rings[0])) }))
    .sort((a, b) => a.order - b.order || b.size - a.size);

  for (const area of areas) {
    if (area.kind === 'water') continue;
    fillPolygon(ctx, area.rings, AREA_STYLES[area.kind][0]);
    if (area.kind === 'pitch') strokePolygon(ctx, area.rings, '#e8eee2', 0.25);
  }

  addGrain(ctx, rect, size);

  // Water goes on top of the grain so it keeps its exact colour.
  if (seaMask) paintSea(ctx, seaMask, size);
  for (const area of areas) if (area.kind === 'water') fillPolygon(ctx, area.rings, WATER_COLOUR);
  const lines = features.lines.filter((l) => !l.bridge);
  for (const line of lines) if (line.kind === 'waterway') strokeLine(ctx, line.points, WATER_COLOUR, line.width);

  // Soft contact shadow where buildings meet the ground: a cheap stand-in for ambient occlusion.
  ctx.save();
  ctx.shadowColor = 'rgba(20, 22, 18, 0.55)';
  ctx.shadowBlur = 2.5 * metre;
  for (const building of features.buildings) fillPolygon(ctx, building.rings, '#6f6e68');
  ctx.restore();

  for (const line of lines) {
    if (line.kind !== 'rail') continue;
    strokeLine(ctx, line.points, '#8f877e', line.width);
  }
  for (const line of lines) {
    if (line.kind !== 'rail') continue;
    strokeLine(ctx, line.points, '#55504b', 1.9);
    strokeLine(ctx, line.points, '#8f877e', 1.1);
  }

  const paths = lines.filter((l) => l.kind === 'path').sort((a, b) => a.layer - b.layer);
  for (const path of paths) strokeLine(ctx, path.points, PATH_COLOURS[path.type] ?? PATH_COLOURS.path, path.width);

  const roads = lines.filter((l) => l.kind === 'road').sort((a, b) => a.layer - b.layer || a.width - b.width);
  for (const road of roads) strokeLine(ctx, road.points, '#d4d0c8', road.width + 3.2); // sidewalks / verges
  for (const road of roads) strokeLine(ctx, road.points, (ROAD_STYLES[road.type] ?? ROAD_STYLES.service)[0], road.width);
  ctx.setLineDash([3, 6]);
  for (const road of roads) {
    if (ROAD_STYLES[road.type]?.[1]) strokeLine(ctx, road.points, 'rgba(240, 238, 228, 0.85)', 0.2, 'butt');
  }
  ctx.setLineDash([]);

  return canvas.transferToImageBitmap();
}

/** Scales the sea mask up onto the ground; smoothing gives the shoreline soft edges. */
function paintSea(ctx, mask, size) {
  const n = SEA_MASK_SIZE;
  const canvas = new OffscreenCanvas(n, n);
  const g = canvas.getContext('2d');
  const image = g.createImageData(n, n);
  const [r, gr, b] = [1, 3, 5].map((i) => parseInt(WATER_COLOUR.slice(i, i + 2), 16));
  for (let k = 0; k < mask.length; k++) {
    if (!mask[k]) continue;
    image.data.set([r, gr, b, 255], k * 4);
  }
  g.putImageData(image, 0, 0);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, 0, 0, size, size);
  ctx.restore();
}

function tracePolygon(ctx, rings) {
  ctx.beginPath();
  for (const ring of rings) {
    ctx.moveTo(ring[0], ring[1]);
    for (let i = 2; i < ring.length; i += 2) ctx.lineTo(ring[i], ring[i + 1]);
    ctx.closePath();
  }
}

function fillPolygon(ctx, rings, colour) {
  tracePolygon(ctx, rings);
  ctx.fillStyle = colour;
  ctx.fill('evenodd');
}

function strokePolygon(ctx, rings, colour, width) {
  tracePolygon(ctx, rings);
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.stroke();
}

function strokeLine(ctx, points, colour, width, cap = 'round') {
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = cap;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** Fine speckle so large flat areas don't look like plastic up close. */
function addGrain(ctx, rect, size) {
  const grain = new OffscreenCanvas(128, 128);
  const g = grain.getContext('2d');
  const image = g.createImageData(128, 128);
  let seed = 1234567;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const v = seed % 256;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  g.putImageData(image, 0, 0);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = ctx.createPattern(grain, 'repeat');
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
}

export const COVER_SIZE = 32;
export const COVER = { built: 0, water: 1, green: 2 };

/**
 * A coarse land-cover grid (COVER_SIZE², row 0 = north edge) read back from the painted ground:
 * water, green or built-up. Used for ambient sound. Returns null where canvases aren't available.
 */
export function coverGrid(bitmap) {
  if (!bitmap || typeof OffscreenCanvas === 'undefined') return null;
  const canvas = new OffscreenCanvas(COVER_SIZE, COVER_SIZE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, COVER_SIZE, COVER_SIZE);
  const pixels = ctx.getImageData(0, 0, COVER_SIZE, COVER_SIZE).data;
  const [wr, wg, wb] = [1, 3, 5].map((i) => parseInt(WATER_COLOUR.slice(i, i + 2), 16));
  const cover = new Uint8Array(COVER_SIZE * COVER_SIZE);
  for (let i = 0; i < cover.length; i++) {
    const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
    if (Math.abs(r - wr) + Math.abs(g - wg) + Math.abs(b - wb) < 70) cover[i] = COVER.water;
    else if (g > r + 6 && g > b + 6) cover[i] = COVER.green;
  }
  return cover;
}
