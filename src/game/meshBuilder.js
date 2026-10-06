import earcut from 'earcut';
import { buildingHeights, hash01, parseColour, pointInRing, ringArea } from './osmParse.js';

const CHUNK_SIZE = 250;
const MAX_TREES = 25000;

/** Growable vertex buffer for non-textured meshes: position, normal, colour and a free "facade" attribute. */
class MeshData {
  constructor() {
    this.position = [];
    this.normal = [];
    this.color = [];
    this.facade = [];
    this.index = [];
  }

  get vertexCount() {
    return this.position.length / 3;
  }

  vertex(x, y, z, nx, ny, nz, c, fu = 0, fv = 0, fw = 0) {
    this.position.push(x, y, z);
    this.normal.push(nx, ny, nz);
    this.color.push(c[0], c[1], c[2]);
    this.facade.push(fu, fv, fw);
  }

  toTransferable() {
    return {
      position: new Float32Array(this.position),
      normal: new Float32Array(this.normal),
      color: new Float32Array(this.color),
      facade: new Float32Array(this.facade),
      index: new Uint32Array(this.index),
    };
  }
}

const srgbToLinear = (c) => c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
const scaleColour = (c, f) => [c[0] * f, c[1] * f, c[2] * f];

const WALL_PALETTE = [
  [0.86, 0.83, 0.77], [0.78, 0.72, 0.63], [0.66, 0.42, 0.33], [0.58, 0.36, 0.29],
  [0.82, 0.8, 0.76], [0.62, 0.63, 0.66], [0.9, 0.88, 0.83], [0.74, 0.6, 0.48],
];
const HOUSE_ROOFS = [[0.55, 0.27, 0.19], [0.32, 0.31, 0.33], [0.45, 0.24, 0.18]];
const FLAT_ROOF = [0.42, 0.42, 0.43];
const NO_WINDOWS = new Set(['garage', 'garages', 'shed', 'carport', 'roof', 'hut', 'greenhouse', 'storage_tank', 'silo']);

/**
 * Builds all world geometry from parsed features. Everything is returned as typed arrays
 * so it can be transferred from the worker to the main thread without copying.
 */
export function buildWorld(features, radius) {
  const chunks = new Map();
  const colliders = new ColliderData();

  for (const building of features.buildings) {
    addBuilding(building, chunks, colliders);
  }

  const ground = new MeshData();
  const water = new MeshData();
  const treePoints = [...features.trees];

  const areas = features.areas
    .map((a) => ({ ...a, area: Math.abs(ringArea(a.rings[0])) }))
    .sort((a, b) => b.area - a.area);

  for (const area of areas) {
    addArea(area, area.kind === 'water' ? water : ground);
    scatterTrees(area, treePoints);
  }
  for (const line of features.lines) {
    addLine(line, line.kind === 'waterway' ? water : ground);
  }

  return {
    radius,
    buildingChunks: [...chunks.values()].map((m) => m.toTransferable()),
    ground: ground.toTransferable(),
    water: water.toTransferable(),
    trees: buildTrees(treePoints, radius),
    colliders: colliders.toTransferable(),
    stats: {
      buildings: features.buildings.length,
      areas: features.areas.length,
      lines: features.lines.length,
      trees: Math.min(treePoints.length / 2, MAX_TREES),
    },
  };
}

function chunkFor(chunks, x, z) {
  const key = `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
  let chunk = chunks.get(key);
  if (!chunk) chunks.set(key, (chunk = new MeshData()));
  return chunk;
}

function addBuilding({ rings, tags }, chunks, colliders) {
  const outer = rings[0];
  if (outer.length < 6) return;
  const area = Math.abs(ringArea(outer));
  if (area < 4) return;

  const cx = outer[0];
  const cz = outer[1];
  const rnd = hash01(cx, cz);
  const { height, minHeight } = buildingHeights(tags, area, rnd);
  const type = tags.building ?? tags['building:part'];
  const isHouse = /^(house|detached|semidetached_house|terrace|bungalow)$/.test(type);

  const wallBase = parseColour(tags['building:colour']) ?? WALL_PALETTE[Math.floor(rnd * WALL_PALETTE.length)];
  const wall = srgbToLinear(scaleColour(wallBase, 0.92 + hash01(cz, cx) * 0.12));
  const roofBase = parseColour(tags['roof:colour']) ??
    (isHouse ? HOUSE_ROOFS[Math.floor(rnd * HOUSE_ROOFS.length)] : scaleColour(FLAT_ROOF, 0.85 + rnd * 0.3));
  const roof = srgbToLinear(roofBase);

  const levels = Math.max(1, Math.round((height - minHeight) / 3.2));
  const floorHeight = (height - minHeight) / levels;
  const windows = !NO_WINDOWS.has(type) && height - minHeight > 2.5;

  const mesh = chunkFor(chunks, cx, cz);
  for (let r = 0; r < rings.length; r++) {
    addWalls(mesh, rings[r], r > 0, minHeight, height, wall, windows ? floorHeight : 0);
  }
  addFlatCap(mesh, rings, height, 1, roof);
  if (minHeight > 0.5) addFlatCap(mesh, rings, minHeight, -1, wall);

  colliders.add(rings, minHeight, height);
}

function addWalls(mesh, ring, isHole, bottom, top, colour, floorHeight) {
  const n = ring.length / 2;
  const orientation = (ringArea(ring) > 0 ? 1 : -1) * (isHole ? -1 : 1);

  for (let i = 0; i < n; i++) {
    const ax = ring[i * 2], az = ring[i * 2 + 1];
    const j = (i + 1) % n;
    const bx = ring[j * 2], bz = ring[j * 2 + 1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;

    const nx = (orientation * dz) / len;
    const nz = (orientation * -dx) / len;

    // Facade coordinates are in "window cells": u counts window bays along the wall, v counts floors.
    const bays = floorHeight && len > 2 ? Math.max(1, Math.round(len / 3.4)) : 0;
    const flag = bays ? 1 : 0.5;
    const v0 = 0;
    const v1 = floorHeight ? (top - bottom) / floorHeight : 0;

    const base = mesh.vertexCount;
    mesh.vertex(ax, bottom, az, nx, 0, nz, colour, 0, v0, flag);
    mesh.vertex(bx, bottom, bz, nx, 0, nz, colour, bays, v0, flag);
    mesh.vertex(bx, top, bz, nx, 0, nz, colour, bays, v1, flag);
    mesh.vertex(ax, top, az, nx, 0, nz, colour, 0, v1, flag);

    if (orientation > 0) mesh.index.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else mesh.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/** Flat horizontal polygon (with holes) at height y, facing up (dir 1) or down (dir -1). */
function addFlatCap(mesh, rings, y, dir, colour) {
  const flat = [];
  const holes = [];
  for (let r = 0; r < rings.length; r++) {
    if (r > 0) holes.push(flat.length / 2);
    for (let i = 0; i < rings[r].length; i++) flat.push(rings[r][i]);
  }
  const triangles = earcut(flat, holes, 2);
  if (!triangles.length) return;

  const base = mesh.vertexCount;
  for (let i = 0; i < flat.length; i += 2) mesh.vertex(flat[i], y, flat[i + 1], 0, dir, 0, colour);

  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
    // Cross product y component decides whether the triangle faces up; flip to match dir.
    const cross = (flat[c * 2] - flat[a * 2]) * (flat[b * 2 + 1] - flat[a * 2 + 1]) -
      (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]);
    if (cross * dir > 0) mesh.index.push(base + a, base + b, base + c);
    else mesh.index.push(base + a, base + c, base + b);
  }
}

const AREA_STYLE = {
  grass: { colour: [0.42, 0.58, 0.3], y: 0.06 },
  park: { colour: [0.38, 0.56, 0.28], y: 0.08 },
  forest: { colour: [0.24, 0.4, 0.2], y: 0.07 },
  pitch: { colour: [0.45, 0.65, 0.35], y: 0.1 },
  sand: { colour: [0.86, 0.79, 0.6], y: 0.09 },
  water: { colour: [0.16, 0.32, 0.42], y: 0.14 },
};

function addArea(area, mesh) {
  const style = AREA_STYLE[area.kind];
  // Smaller areas sit a few millimetres higher so they draw on top of the larger areas around them.
  const y = style.y + 0.03 / (1 + area.area / 2000);
  const tint = 0.94 + hash01(area.rings[0][0], area.rings[0][1]) * 0.1;
  addFlatCap(mesh, area.rings, y, 1, srgbToLinear(scaleColour(style.colour, tint)));
}

const LINE_STYLE = {
  road: { colour: srgbToLinear([0.25, 0.25, 0.27]), y: 0.26 },
  path: { colour: srgbToLinear([0.7, 0.64, 0.54]), y: 0.22 },
  waterway: { colour: srgbToLinear(AREA_STYLE.water.colour), y: 0.15 },
};

/** Ribbon along a polyline with mitred joints (miter length capped so sharp corners don't spike). */
function addLine(line, mesh) {
  const { colour, y } = LINE_STYLE[line.kind];
  const p = line.points;
  const n = p.length / 2;
  if (n < 2) return;
  const half = line.width / 2;

  const base = mesh.vertexCount;
  for (let i = 0; i < n; i++) {
    const prev = Math.max(0, i - 1);
    const next = Math.min(n - 1, i + 1);
    let tx = p[next * 2] - p[prev * 2];
    let tz = p[next * 2 + 1] - p[prev * 2 + 1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;

    let miter = 1;
    if (i > 0 && i < n - 1) {
      const sx = p[i * 2] - p[prev * 2], sz = p[i * 2 + 1] - p[prev * 2 + 1];
      const sl = Math.hypot(sx, sz) || 1;
      const dot = (sx / sl) * tx + (sz / sl) * tz;
      miter = 1 / Math.max(dot, 0.5);
    }
    const ox = -tz * half * miter;
    const oz = tx * half * miter;
    mesh.vertex(p[i * 2] + ox, y, p[i * 2 + 1] + oz, 0, 1, 0, colour);
    mesh.vertex(p[i * 2] - ox, y, p[i * 2 + 1] - oz, 0, 1, 0, colour);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2;
    mesh.index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
}

function scatterTrees(area, out) {
  const density = area.kind === 'forest' ? 1 / 90 : area.kind === 'park' ? 1 / 450 : 0;
  if (!density) return;

  const outer = area.rings[0];
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < outer.length; i += 2) {
    minX = Math.min(minX, outer[i]); maxX = Math.max(maxX, outer[i]);
    minZ = Math.min(minZ, outer[i + 1]); maxZ = Math.max(maxZ, outer[i + 1]);
  }
  const count = Math.min(Math.round(area.area * density), 4000);
  let seed = Math.abs(Math.round(outer[0] * 1000 + outer[1])) + 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  for (let i = 0, attempts = 0; i < count && attempts < count * 4; attempts++) {
    const x = minX + random() * (maxX - minX);
    const z = minZ + random() * (maxZ - minZ);
    if (!pointInRing(x, z, outer)) continue;
    if (area.rings.slice(1).some((hole) => pointInRing(x, z, hole))) continue;
    out.push(x, z);
    i++;
  }
}

/** Per-tree instance data: x, z, scale, colour variation. Trees nearest the centre win when capped. */
function buildTrees(points, radius) {
  const trees = [];
  const limit = radius * 1.4;
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i], z = points[i + 1];
    const d = Math.hypot(x, z);
    if (d < limit) trees.push([x, z, d]);
  }
  trees.sort((a, b) => a[2] - b[2]);
  trees.length = Math.min(trees.length, MAX_TREES);

  const data = new Float32Array(trees.length * 4);
  trees.forEach(([x, z], i) => {
    const r = hash01(x, z);
    data.set([x, z, 0.75 + r * 0.6, hash01(z, x)], i * 4);
  });
  return data;
}

/** Flat arrays describing building footprints for collision tests on the main thread. */
class ColliderData {
  constructor() {
    this.coords = [];
    this.rings = []; // pairs: start (in coords), length
    this.buildings = []; // per building: firstRing, ringCount, minHeight, height, minX, minZ, maxX, maxZ
  }

  add(rings, minHeight, height) {
    const outer = rings[0];
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < outer.length; i += 2) {
      minX = Math.min(minX, outer[i]); maxX = Math.max(maxX, outer[i]);
      minZ = Math.min(minZ, outer[i + 1]); maxZ = Math.max(maxZ, outer[i + 1]);
    }
    this.buildings.push(this.rings.length / 2, rings.length, minHeight, height, minX, minZ, maxX, maxZ);
    for (const ring of rings) {
      this.rings.push(this.coords.length, ring.length);
      for (let i = 0; i < ring.length; i++) this.coords.push(ring[i]);
    }
  }

  toTransferable() {
    return {
      coords: new Float32Array(this.coords),
      rings: new Uint32Array(this.rings),
      buildings: new Float32Array(this.buildings),
    };
  }
}
