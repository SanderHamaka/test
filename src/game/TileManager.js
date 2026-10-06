import { createProjection } from './geo.js';
import { BLOCK_ZOOM, TILE_ZOOM, lonLatToTile, tileKey, tileRect } from './tiles.js';
import { Tile, TileResources } from './Tile.js';

// Tiles closer than this to the bird are loaded; further than UNLOAD_DISTANCE they're dropped.
export const LOAD_DISTANCE = 1300;
const UNLOAD_DISTANCE = 2100;
const WORKERS = 2;
const MAX_IN_FLIGHT = 2; // the public Overpass servers allow about two parallel requests per user
const RETRY_DELAYS = [3000, 10000, 30000, 60000, 120000]; // the last one repeats for as long as needed

/**
 * Streams map tiles around the bird and answers ground height and building collision queries.
 *
 * Map data is downloaded per block of 2×2 tiles (one zoom level up): that keeps the number of Overpass
 * requests down, which matters because the public servers rate-limit. A block that fails still delivers
 * its tiles with terrain and ground only, and is retried until the buildings arrive.
 */
export class TileManager {
  /**
   * @param origin  { lat, lon, elevation } of the world origin
   * @param scene   group or scene that tile objects are added to
   * @param prepareMaterial  called on every material before use (sky fog)
   * @param uniforms  shared shader uniforms ({ night })
   */
  constructor({ origin, demo, renderer, scene, prepareMaterial, uniforms, onChange = () => {} }) {
    this.origin = origin;
    this.demo = demo;
    this.scene = scene;
    this.onChange = onChange;
    this.projection = createProjection(origin.lat, origin.lon);
    this.resources = new TileResources(renderer, prepareMaterial, uniforms);
    this.tiles = new Map(); // tile key → { x, y, rect, tile, partial }
    this.blocks = new Map(); // block key → { x, y, rect, state: queued|loading|done, retries, retryAt }
    this.wanted = new Set(); // tile keys within load distance
    this.requests = new Map(); // request id → { block, worker }
    this.nextId = 1;
    this.version = 0; // bumped whenever tiles are added or removed
    this.centre = null;
    this.lastGround = 0;
    this.error = null;

    this.workers = Array.from({ length: WORKERS }, () => {
      const worker = new Worker(new URL('./world.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => this.onWorkerMessage(data);
      worker.busy = 0;
      return worker;
    });
  }

  /** Call every frame with the bird position. Cheap when nothing changes. */
  update(position, dt) {
    this.resources.time.value += dt;
    if (!this.centre || Math.hypot(position.x - this.centre.x, position.z - this.centre.z) > 40) {
      this.centre = { x: position.x, z: position.z };
      this.refreshWanted();
    }
    this.pump();
  }

  refreshWanted() {
    const position = this.centre;
    const [lat, lon] = this.projection.toLatLon(position.x, position.z);
    const centre = lonLatToTile(lat, lon);
    this.wanted.clear();

    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const x = centre.x + dx, y = centre.y + dy;
        if (distanceToRect(position, tileRect(x, y, this.projection)) >= LOAD_DISTANCE) continue;
        const key = tileKey(x, y);
        this.wanted.add(key);
        const tile = this.tiles.get(key);
        if (tile && !tile.partial) continue;

        const bx = x >> 1, by = y >> 1;
        const blockKey = tileKey(bx, by);
        const block = this.blocks.get(blockKey);
        if (!block) {
          const rect = tileRect(bx, by, this.projection, BLOCK_ZOOM);
          this.blocks.set(blockKey, { key: blockKey, x: bx, y: by, rect, state: 'queued', retries: 0, retryAt: 0 });
        } else if (block.state === 'done' && !tile) {
          block.state = 'queued'; // its tiles were unloaded earlier; fetch them again (from the cache)
        }
      }
    }

    for (const [key, entry] of this.tiles) {
      if (distanceToRect(position, entry.rect) <= UNLOAD_DISTANCE) continue;
      entry.tile.dispose();
      this.tiles.delete(key);
      this.version++;
    }
    for (const [key, block] of this.blocks) {
      if (block.state !== 'loading' && distanceToRect(position, block.rect) > UNLOAD_DISTANCE) this.blocks.delete(key);
    }
    this.onChange();
  }

  /** Starts the nearest queued blocks while there is capacity. */
  pump() {
    if (this.requests.size >= MAX_IN_FLIGHT) return;
    const now = performance.now();
    const queued = [...this.blocks.values()]
      .filter((b) => b.state === 'queued' && b.retryAt <= now)
      .sort((a, b) => distanceToRect(this.centre, a.rect) - distanceToRect(this.centre, b.rect));

    for (const block of queued) {
      if (this.requests.size >= MAX_IN_FLIGHT) break;
      const id = this.nextId++;
      const worker = this.workers.reduce((a, b) => (a.busy <= b.busy ? a : b));
      worker.busy++;
      block.state = 'loading';
      this.requests.set(id, { block, worker });
      worker.postMessage({ type: 'block', id, x: block.x, y: block.y, origin: this.origin, demo: this.demo });
    }
  }

  onWorkerMessage(data) {
    const request = this.requests.get(data.id);
    if (!request) return;

    if (data.type === 'tile') {
      this.addTile(data);
      return;
    }

    // 'blockDone' or 'error': the request is finished.
    this.requests.delete(data.id);
    request.worker.busy--;
    const block = request.block;
    if (this.blocks.get(block.key) !== block) return; // unloaded meanwhile

    if (data.measured) {
      const m = data.measured;
      console.info(`[${m.source}] block ${block.key}: measured heights for ${m.matched} of ${m.buildings} buildings (${m.available} available)`);
      if (m.matched) this.heightSource = m.source;
    }
    if (data.type === 'blockDone' && !data.partial) {
      block.state = 'done';
      this.error = null;
    } else {
      this.error = data.error ?? data.message ?? 'Map data unavailable';
      block.retryAt = performance.now() + RETRY_DELAYS[Math.min(block.retries++, RETRY_DELAYS.length - 1)];
      block.state = 'queued';
    }
    this.onChange();
  }

  addTile({ x, y, tile: data, partial }) {
    const key = tileKey(x, y);
    const rect = data.rect;
    const existing = this.tiles.get(key);
    // Keep a complete tile rather than replacing it with a partial one, and skip tiles that are too far.
    if ((existing && !existing.partial && partial) || distanceToRect(this.centre, rect) > UNLOAD_DISTANCE) {
      data.ground?.close?.();
      return;
    }
    existing?.tile.dispose();
    const tile = new Tile(data, this.resources);
    this.scene.add(tile.group);
    this.tiles.set(key, { x, y, rect, tile, partial });
    this.version++;
    this.onChange();
  }

  /** Resolves once the tile under the given point is there (possibly without buildings yet). */
  whenReady(position) {
    return new Promise((resolve) => {
      const check = () => {
        const entry = this.entryAt(position.x, position.z);
        if (entry) resolve(entry.tile);
        else setTimeout(check, 100);
      };
      this.update(position, 0);
      check();
    });
  }

  entryAt(x, z) {
    const [lat, lon] = this.projection.toLatLon(x, z);
    const { x: tx, y: ty } = lonLatToTile(lat, lon, TILE_ZOOM);
    return this.tiles.get(tileKey(tx, ty));
  }

  /** Ground height at a world position; falls back to the last known height where no tile is loaded. */
  groundAt(x, z) {
    const tile = this.entryAt(x, z)?.tile;
    if (tile) this.lastGround = tile.groundAt(x, z);
    return this.lastGround;
  }

  /** Highest surface (ground or roof) under a point. */
  surfaceAt(x, z) {
    let top = this.groundAt(x, z);
    this.forEachBuildingAt(x, z, (bottom, height) => (top = Math.max(top, height)));
    return top;
  }

  /** The tree crown containing a point, or null. */
  treeAt(x, y, z) {
    return this.entryAt(x, z)?.tile.treeAt(x, y, z) ?? null;
  }

  /** Calls fn(bottom, top, colliders, index) for each building whose footprint contains (x, z). */
  forEachBuildingAt(x, z, fn) {
    for (const { tile } of this.tiles.values()) {
      // Buildings belong to the tile holding their centre but can stick out a little past its edge.
      if (tile.contains(x, z, 80)) {
        const colliders = tile.colliders;
        colliders.forEachAt(x, z, (bottom, top, index) => fn(bottom, top, colliders, index));
      }
    }
  }

  get status() {
    let loading = 0;
    for (const key of this.wanted) {
      const tile = this.tiles.get(key);
      if (!tile || tile.partial) loading++;
    }
    return { loading, ready: this.tiles.size, error: this.error, heightSource: this.heightSource };
  }

  dispose() {
    for (const worker of this.workers) worker.terminate();
    for (const { tile } of this.tiles.values()) tile.dispose();
    this.tiles.clear();
    this.blocks.clear();
    this.resources.dispose();
  }
}

/** Distance from a point to a rectangle in the xz plane (0 inside). */
function distanceToRect(p, r) {
  const dx = Math.max(r.minX - p.x, 0, p.x - r.maxX);
  const dz = Math.max(r.minZ - p.z, 0, p.z - r.maxZ);
  return Math.hypot(dx, dz);
}

/** Asks a worker for the ground elevation at the world origin. */
export function resolveOriginElevation(lat, lon, demo) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./world.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      worker.terminate();
      resolve(data.type === 'origin' ? data.elevation : 0);
    };
    worker.onerror = () => {
      worker.terminate();
      resolve(0);
    };
    worker.postMessage({ type: 'origin', lat, lon, demo });
  });
}
