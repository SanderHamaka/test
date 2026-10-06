import { createProjection } from './geo.js';
import { lonLatToTile, tileKey, tileRect } from './tiles.js';
import { Tile, TileResources } from './Tile.js';

// Tiles closer than this to the bird are loaded; further than UNLOAD_DISTANCE they're dropped.
export const LOAD_DISTANCE = 1300;
const UNLOAD_DISTANCE = 2100;
const WORKERS = 2;
const MAX_IN_FLIGHT = 2; // the public Overpass servers allow about two parallel requests per user
const RETRY_DELAYS = [3000, 10000, 30000];

/**
 * Streams map tiles around the bird: loads the nearest missing tiles first, unloads far ones,
 * and answers ground height and building collision queries in world coordinates.
 */
export class TileManager {
  /**
   * @param origin  { lat, lon, elevation } of the world origin
   * @param scene   group or scene that tile objects are added to
   * @param prepareMaterial  called on every material before use (sky fog)
   */
  constructor({ origin, demo, renderer, scene, prepareMaterial, onChange = () => {} }) {
    this.origin = origin;
    this.demo = demo;
    this.scene = scene;
    this.onChange = onChange;
    this.projection = createProjection(origin.lat, origin.lon);
    this.resources = new TileResources(renderer, prepareMaterial);
    this.tiles = new Map(); // key → { x, y, rect, state: queued|loading|ready|failed, tile?, retries, retryAt }
    this.requests = new Map(); // request id → { key, worker }
    this.nextId = 1;
    this.lastCentre = null;
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

    const moved = !this.lastCentre || Math.hypot(position.x - this.lastCentre.x, position.z - this.lastCentre.z) > 40;
    if (moved) {
      this.lastCentre = { x: position.x, z: position.z };
      this.refreshWanted(position);
    }
    this.pump(position);
  }

  refreshWanted(position) {
    const [lat, lon] = this.projection.toLatLon(position.x, position.z);
    const centre = lonLatToTile(lat, lon);

    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const x = centre.x + dx, y = centre.y + dy;
        const key = tileKey(x, y);
        if (this.tiles.has(key)) continue;
        const rect = tileRect(x, y, this.projection);
        if (distanceToRect(position, rect) < LOAD_DISTANCE) {
          this.tiles.set(key, { key, x, y, rect, state: 'queued', retries: 0, retryAt: 0 });
        }
      }
    }

    let changed = false;
    for (const [key, entry] of this.tiles) {
      if (distanceToRect(position, entry.rect) <= UNLOAD_DISTANCE) continue;
      entry.tile?.dispose();
      this.tiles.delete(key); // a request still in flight is ignored when it comes back
      changed = true;
    }
    if (changed) this.onChange();
  }

  /** Starts the nearest queued tiles while there is capacity. */
  pump(position) {
    const now = performance.now();
    let inFlight = this.requests.size;
    if (inFlight >= MAX_IN_FLIGHT) return;

    const queued = [...this.tiles.values()]
      .filter((t) => t.state === 'queued' && t.retryAt <= now)
      .sort((a, b) => distanceToRect(position, a.rect) - distanceToRect(position, b.rect));

    for (const entry of queued) {
      if (inFlight >= MAX_IN_FLIGHT) break;
      const id = this.nextId++;
      const worker = this.workers.reduce((a, b) => (a.busy <= b.busy ? a : b));
      worker.busy++;
      entry.state = 'loading';
      this.requests.set(id, { key: entry.key, worker });
      worker.postMessage({ type: 'tile', id, x: entry.x, y: entry.y, origin: this.origin, demo: this.demo });
      inFlight++;
    }
    this.onChange();
  }

  onWorkerMessage(data) {
    const request = this.requests.get(data.id);
    if (!request) return;
    this.requests.delete(data.id);
    request.worker.busy--;

    const entry = this.tiles.get(request.key);
    if (!entry || entry.state !== 'loading') {
      // Unloaded while it was being built: drop it, but release the bitmap it carried.
      data.tile?.ground?.close?.();
      return;
    }

    if (data.type === 'tile') {
      entry.tile = new Tile(data.tile, this.resources);
      entry.state = 'ready';
      this.scene.add(entry.tile.group);
      this.error = null;
    } else {
      this.error = data.message;
      if (entry.retries < RETRY_DELAYS.length) {
        entry.retryAt = performance.now() + RETRY_DELAYS[entry.retries++];
        entry.state = 'queued';
      } else {
        entry.state = 'failed';
      }
    }
    this.onChange();
  }

  /** Resolves once the tile under the given point has loaded, or rejects when it can't be. */
  whenReady(position) {
    return new Promise((resolve, reject) => {
      const check = () => {
        const entry = this.entryAt(position.x, position.z);
        if (entry?.state === 'ready') resolve(entry.tile);
        else if (entry?.state === 'failed') reject(new Error(this.error ?? 'Could not load this area.'));
        else setTimeout(check, 100);
      };
      this.update(position, 0);
      check();
    });
  }

  entryAt(x, z) {
    const [lat, lon] = this.projection.toLatLon(x, z);
    const { x: tx, y: ty } = lonLatToTile(lat, lon);
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

  /** Calls fn(bottom, top, colliders, index) for each building whose footprint contains (x, z). */
  forEachBuildingAt(x, z, fn) {
    for (const entry of this.tiles.values()) {
      // Buildings belong to the tile holding their centre but can stick out a little past its edge.
      if (entry.tile?.contains(x, z, 80)) {
        const colliders = entry.tile.colliders;
        colliders.forEachAt(x, z, (bottom, top, index) => fn(bottom, top, colliders, index));
      }
    }
  }

  get status() {
    let loading = 0, ready = 0, failed = 0;
    for (const t of this.tiles.values()) {
      if (t.state === 'ready') ready++;
      else if (t.state === 'failed') failed++;
      else loading++;
    }
    return { loading, ready, failed, error: this.error };
  }

  dispose() {
    for (const worker of this.workers) worker.terminate();
    for (const entry of this.tiles.values()) entry.tile?.dispose();
    this.tiles.clear();
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
