import earcut from 'earcut';
import { buildingHeights, hash01, parseColour, pointInRing, ringArea } from './osmParse.js';
import { GRID, createGridSampler } from './terrain.js';

const MAX_TREES_PER_TILE = 12000;
const SKIRT_DEPTH = 12;

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

  /** Flat-shaded quad a-b-c-d, wound so it faces along `facing`. */
  quad(a, b, c, d, colour, facing) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    const flip = nx * facing[0] + ny * facing[1] + nz * facing[2] < 0;
    const s = (flip ? -1 : 1) / len;
    nx *= s; ny *= s; nz *= s;

    const base = this.vertexCount;
    for (const p of [a, b, c, d]) this.vertex(p[0], p[1], p[2], nx, ny, nz, colour);
    if (flip) this.index.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
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

const inRect = (x, z, r) => x >= r.minX && x < r.maxX && z >= r.minZ && z < r.maxZ;

/**
 * Builds everything for one map tile. Features may extend past the tile (Overpass returns whatever
 * intersects it); each building, tree and bridge is owned by exactly one tile so nothing is doubled.
 *
 * @param elevationAt (x, z) => metres relative to the world origin, in local coordinates
 */
export function buildTile(features, rect, elevationAt) {
  const cx = (rect.minX + rect.maxX) / 2;
  const cz = (rect.minZ + rect.maxZ) / 2;

  const heights = new Float32Array((GRID + 1) ** 2);
  for (let j = 0; j <= GRID; j++) {
    for (let i = 0; i <= GRID; i++) {
      const x = rect.minX + ((rect.maxX - rect.minX) * i) / GRID;
      const z = rect.minZ + ((rect.maxZ - rect.minZ) * j) / GRID;
      heights[j * (GRID + 1) + i] = elevationAt(x, z);
    }
  }
  const groundAt = createGridSampler(rect, heights);

  const buildings = new MeshData();
  const colliders = new ColliderData();
  let buildingCount = 0;
  for (const building of features.buildings) {
    if (addBuilding(building, rect, cx, cz, groundAt, buildings, colliders)) buildingCount++;
  }

  const bridges = new MeshData();
  for (const line of features.lines) {
    if (line.bridge && inRect(line.points[0], line.points[1], rect)) addBridge(line, cx, cz, groundAt, bridges);
  }

  const trees = placeTrees(features, rect, cx, cz, groundAt);

  return {
    rect: { minX: rect.minX, minZ: rect.minZ, maxX: rect.maxX, maxZ: rect.maxZ },
    center: [cx, cz],
    heights,
    terrain: buildTerrain(rect, cx, cz, heights),
    buildings: buildings.toTransferable(),
    bridges: bridges.toTransferable(),
    trees,
    colliders: colliders.toTransferable(),
    stats: { buildings: buildingCount, trees: trees.length / 5 },
  };
}

function addBuilding({ rings, tags }, rect, cx, cz, groundAt, mesh, colliders) {
  const outer = rings[0];
  if (outer.length < 6) return false;

  let sx = 0, sz = 0;
  for (let i = 0; i < outer.length; i += 2) {
    sx += outer[i];
    sz += outer[i + 1];
  }
  if (!inRect((sx * 2) / outer.length, (sz * 2) / outer.length, rect)) return false;

  const area = Math.abs(ringArea(outer));
  if (area < 4) return false;

  // Stand the building on the lowest ground under it, slightly sunk so no gap shows on slopes.
  let ground = Infinity;
  for (let i = 0; i < outer.length; i += 2) ground = Math.min(ground, groundAt(outer[i], outer[i + 1]));

  const rnd = hash01(outer[0], outer[1]);
  const { height, minHeight } = buildingHeights(tags, area, rnd);
  const bottom = minHeight > 0.5 ? ground + minHeight : ground - 0.6;
  const top = ground + height;
  const type = tags.building ?? tags['building:part'];
  const isHouse = /^(house|detached|semidetached_house|terrace|bungalow)$/.test(type);

  const wallBase = parseColour(tags['building:colour']) ?? WALL_PALETTE[Math.floor(rnd * WALL_PALETTE.length)];
  const wall = srgbToLinear(scaleColour(wallBase, 0.92 + hash01(outer[1], outer[0]) * 0.12));
  const roofBase = parseColour(tags['roof:colour']) ??
    (isHouse ? HOUSE_ROOFS[Math.floor(rnd * HOUSE_ROOFS.length)] : scaleColour(FLAT_ROOF, 0.85 + rnd * 0.3));
  const roof = srgbToLinear(roofBase);

  const levels = Math.max(1, Math.round((height - minHeight) / 3.2));
  const floorHeight = (height - minHeight) / levels;
  const windows = !NO_WINDOWS.has(type) && height - minHeight > 2.5;

  const local = rings.map((ring) => ring.map((v, i) => (i % 2 ? v - cz : v - cx)));
  for (let r = 0; r < local.length; r++) {
    addWalls(mesh, local[r], r > 0, bottom, top, wall, windows ? floorHeight : 0, ground + minHeight);
  }
  addFlatCap(mesh, local, top, 1, roof);
  if (minHeight > 0.5) addFlatCap(mesh, local, bottom, -1, wall);

  colliders.add(rings, bottom, top);
  return true;
}

/** Walls along one ring. `floorBase` is where the first floor starts, so window rows line up with floors. */
function addWalls(mesh, ring, isHole, bottom, top, colour, floorHeight, floorBase) {
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
    const v0 = floorHeight ? (bottom - floorBase) / floorHeight : 0;
    const v1 = floorHeight ? (top - floorBase) / floorHeight : 0;

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

const DECK_COLOURS = {
  road: srgbToLinear([0.3, 0.31, 0.33]),
  path: srgbToLinear([0.72, 0.66, 0.56]),
  rail: srgbToLinear([0.52, 0.49, 0.46]),
  waterway: srgbToLinear([0.18, 0.35, 0.44]),
};
const BRIDGE_SIDE = srgbToLinear([0.6, 0.58, 0.55]);
const DECK_THICKNESS = 0.9;

/** A bridge deck: a slab following the line, level with the higher of its two ends. */
function addBridge(line, cx, cz, groundAt, mesh) {
  const p = line.points;
  const n = p.length / 2;
  if (n < 2) return;
  const top = Math.max(groundAt(p[0], p[1]), groundAt(p[p.length - 2], p[p.length - 1])) + 0.8 + Math.max(0, line.layer - 1) * 5;
  const bottom = top - DECK_THICKNESS;
  const half = line.width / 2 + (line.kind === 'road' ? 1 : 0.3);
  const colour = DECK_COLOURS[line.kind];

  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const [ox, oz] = miterOffset(p, i, half);
    left.push([p[i * 2] + ox - cx, p[i * 2 + 1] + oz - cz]);
    right.push([p[i * 2] - ox - cx, p[i * 2 + 1] - oz - cz]);
  }

  for (let i = 0; i < n - 1; i++) {
    const [l0, l1, r0, r1] = [left[i], left[i + 1], right[i], right[i + 1]];
    mesh.quad([l0[0], top, l0[1]], [l1[0], top, l1[1]], [r1[0], top, r1[1]], [r0[0], top, r0[1]], colour, [0, 1, 0]);
    mesh.quad([l0[0], bottom, l0[1]], [l1[0], bottom, l1[1]], [r1[0], bottom, r1[1]], [r0[0], bottom, r0[1]], BRIDGE_SIDE, [0, -1, 0]);
    // Side faces point away from the centre line.
    const out = [l0[0] - r0[0], 0, l0[1] - r0[1]];
    mesh.quad([l0[0], bottom, l0[1]], [l1[0], bottom, l1[1]], [l1[0], top, l1[1]], [l0[0], top, l0[1]], BRIDGE_SIDE, out);
    mesh.quad([r0[0], bottom, r0[1]], [r1[0], bottom, r1[1]], [r1[0], top, r1[1]], [r0[0], top, r0[1]], BRIDGE_SIDE, [-out[0], 0, -out[2]]);
  }
}

/** Sideways offset at vertex i of a polyline, mitred at joints (capped so sharp corners don't spike). */
function miterOffset(p, i, half) {
  const n = p.length / 2;
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
    miter = 1 / Math.max((sx / sl) * tx + (sz / sl) * tz, 0.5);
  }
  return [-tz * half * miter, tx * half * miter];
}

/** Terrain grid for the tile in tile-local coordinates, with skirts that hide cracks between tiles. */
function buildTerrain(rect, cx, cz, heights) {
  const w = rect.maxX - rect.minX;
  const d = rect.maxZ - rect.minZ;
  const row = GRID + 1;
  const h = (i, j) => heights[Math.min(Math.max(j, 0), GRID) * row + Math.min(Math.max(i, 0), GRID)];

  const position = [];
  const normal = [];
  const uv = [];
  const index = [];

  for (let j = 0; j <= GRID; j++) {
    for (let i = 0; i <= GRID; i++) {
      position.push(rect.minX + (w * i) / GRID - cx, h(i, j), rect.minZ + (d * j) / GRID - cz);
      const dhdx = (h(i + 1, j) - h(i - 1, j)) / ((2 * w) / GRID);
      const dhdz = (h(i, j + 1) - h(i, j - 1)) / ((2 * d) / GRID);
      const len = Math.hypot(dhdx, 1, dhdz);
      normal.push(-dhdx / len, 1 / len, -dhdz / len);
      uv.push(i / GRID, j / GRID);
    }
  }
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const a = j * row + i;
      index.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }

  // Skirts: a strip hanging down from each edge, drawn from both sides.
  const edge = [];
  for (let i = 0; i < GRID; i++) edge.push([i, 0, i + 1, 0], [GRID, i, GRID, i + 1], [i + 1, GRID, i, GRID], [0, i + 1, 0, i]);
  for (const [i0, j0, i1, j1] of edge) {
    const base = position.length / 3;
    for (const [i, j] of [[i0, j0], [i1, j1]]) {
      const src = j * row + i;
      for (const drop of [0, SKIRT_DEPTH]) {
        position.push(position[src * 3], position[src * 3 + 1] - drop, position[src * 3 + 2]);
        normal.push(normal[src * 3], normal[src * 3 + 1], normal[src * 3 + 2]);
        uv.push(uv[src * 2], uv[src * 2 + 1]);
      }
    }
    index.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    index.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
  }

  return {
    position: new Float32Array(position),
    normal: new Float32Array(normal),
    uv: new Float32Array(uv),
    index: new Uint32Array(index),
  };
}

const TREE_DENSITY = { forest: 1 / 90, orchard: 1 / 70, park: 1 / 450, cemetery: 1 / 300, scrub: 1 / 600, golf: 1 / 1500 };

/** Tree instances owned by this tile: mapped trees plus trees scattered over wooded areas. */
function placeTrees(features, rect, cx, cz, groundAt) {
  const points = [];
  for (let i = 0; i < features.trees.length; i += 2) {
    if (inRect(features.trees[i], features.trees[i + 1], rect)) points.push(features.trees[i], features.trees[i + 1]);
  }

  const blockers = new LineGrid(features.lines);
  const water = features.areas.filter((a) => a.kind === 'water');

  for (const area of features.areas) {
    const density = TREE_DENSITY[area.kind];
    if (!density) continue;
    const outer = area.rings[0];
    let minX = rect.maxX, minZ = rect.maxZ, maxX = rect.minX, maxZ = rect.minZ;
    for (let i = 0; i < outer.length; i += 2) {
      minX = Math.min(minX, outer[i]); maxX = Math.max(maxX, outer[i]);
      minZ = Math.min(minZ, outer[i + 1]); maxZ = Math.max(maxZ, outer[i + 1]);
    }
    minX = Math.max(minX, rect.minX); maxX = Math.min(maxX, rect.maxX);
    minZ = Math.max(minZ, rect.minZ); maxZ = Math.min(maxZ, rect.maxZ);
    if (minX >= maxX || minZ >= maxZ) continue;

    const attempts = Math.min(Math.round((maxX - minX) * (maxZ - minZ) * density), 6000);
    let seed = Math.abs(Math.round(outer[0] * 997 + outer[1] * 31 + rect.minX * 7 + rect.minZ)) % 2147483646 + 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

    for (let k = 0; k < attempts; k++) {
      const x = minX + random() * (maxX - minX);
      const z = minZ + random() * (maxZ - minZ);
      if (!pointInRing(x, z, outer)) continue;
      if (area.rings.slice(1).some((hole) => pointInRing(x, z, hole))) continue;
      if (blockers.near(x, z)) continue;
      if (water.some((w) => pointInRing(x, z, w.rings[0]))) continue;
      points.push(x, z);
    }
  }

  const count = Math.min(points.length / 2, MAX_TREES_PER_TILE);
  const data = new Float32Array(count * 5);
  for (let i = 0; i < count; i++) {
    const x = points[i * 2], z = points[i * 2 + 1];
    data.set([x - cx, groundAt(x, z), z - cz, 0.75 + hash01(x, z) * 0.6, hash01(z, x)], i * 5);
  }
  return data;
}

/** Spatial grid over line segments (roads, rails, rivers) to keep scattered trees off them. */
class LineGrid {
  static CELL = 25;

  constructor(lines) {
    this.cells = new Map();
    for (const line of lines) {
      const p = line.points;
      const clearance = line.width / 2 + 1.5;
      for (let i = 0; i < p.length - 2; i += 2) {
        const seg = [p[i], p[i + 1], p[i + 2], p[i + 3], clearance];
        const x0 = Math.floor((Math.min(p[i], p[i + 2]) - clearance) / LineGrid.CELL);
        const x1 = Math.floor((Math.max(p[i], p[i + 2]) + clearance) / LineGrid.CELL);
        const z0 = Math.floor((Math.min(p[i + 1], p[i + 3]) - clearance) / LineGrid.CELL);
        const z1 = Math.floor((Math.max(p[i + 1], p[i + 3]) + clearance) / LineGrid.CELL);
        if ((x1 - x0) * (z1 - z0) > 400) continue; // absurdly long segment, skip rather than flood the grid
        for (let x = x0; x <= x1; x++) {
          for (let z = z0; z <= z1; z++) {
            const key = `${x},${z}`;
            if (!this.cells.has(key)) this.cells.set(key, []);
            this.cells.get(key).push(seg);
          }
        }
      }
    }
  }

  near(x, z) {
    const cell = this.cells.get(`${Math.floor(x / LineGrid.CELL)},${Math.floor(z / LineGrid.CELL)}`);
    if (!cell) return false;
    for (const [ax, az, bx, bz, clearance] of cell) {
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < clearance) return true;
    }
    return false;
  }
}

/** Flat arrays describing building footprints for collision tests on the main thread (world coordinates). */
class ColliderData {
  constructor() {
    this.coords = [];
    this.rings = []; // pairs: start (in coords), length
    this.buildings = []; // per building: firstRing, ringCount, bottom, top, minX, minZ, maxX, maxZ
  }

  add(rings, bottom, top) {
    const outer = rings[0];
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < outer.length; i += 2) {
      minX = Math.min(minX, outer[i]); maxX = Math.max(maxX, outer[i]);
      minZ = Math.min(minZ, outer[i + 1]); maxZ = Math.max(maxZ, outer[i + 1]);
    }
    this.buildings.push(this.rings.length / 2, rings.length, bottom, top, minX, minZ, maxX, maxZ);
    for (const ring of rings) {
      this.rings.push(this.coords.length, ring.length);
      for (let i = 0; i < ring.length; i++) this.coords.push(ring[i]);
    }
  }

  toTransferable() {
    return {
      // Float64: collision maths runs in world coordinates, which can get large far from the start.
      coords: new Float64Array(this.coords),
      rings: new Uint32Array(this.rings),
      buildings: new Float64Array(this.buildings),
    };
  }
}
