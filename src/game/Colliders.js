const CELL = 40;
const STRIDE = 8; // firstRing, ringCount, minHeight, height, minX, minZ, maxX, maxZ

/** Spatial grid over building footprints for fast "am I inside a building?" tests. */
export class Colliders {
  constructor({ coords, rings, buildings }) {
    this.coords = coords;
    this.rings = rings;
    this.buildings = buildings;
    this.grid = new Map();

    for (let b = 0; b < buildings.length / STRIDE; b++) {
      const o = b * STRIDE;
      for (let cx = Math.floor(buildings[o + 4] / CELL); cx <= Math.floor(buildings[o + 6] / CELL); cx++) {
        for (let cz = Math.floor(buildings[o + 5] / CELL); cz <= Math.floor(buildings[o + 7] / CELL); cz++) {
          const key = cx * 65536 + cz;
          let cell = this.grid.get(key);
          if (!cell) this.grid.set(key, (cell = []));
          cell.push(b);
        }
      }
    }
  }

  /** Buildings whose footprint contains (x, z). Calls fn(minHeight, height, index) for each. */
  forEachAt(x, z, fn) {
    const cell = this.grid.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL));
    if (!cell) return;
    const b = this.buildings;
    for (const i of cell) {
      const o = i * STRIDE;
      if (x < b[o + 4] || x > b[o + 6] || z < b[o + 5] || z > b[o + 7]) continue;
      if (this.contains(i, x, z)) fn(b[o + 2], b[o + 3], i);
    }
  }

  /** Highest roof under (x, z), or 0 for open ground. */
  heightAt(x, z) {
    let top = 0;
    this.forEachAt(x, z, (_, height) => (top = Math.max(top, height)));
    return top;
  }

  /** Even-odd test over all rings, so courtyards (holes) count as outside. */
  contains(index, x, z) {
    const o = index * STRIDE;
    let inside = false;
    for (let r = this.buildings[o]; r < this.buildings[o] + this.buildings[o + 1]; r++) {
      const start = this.rings[r * 2];
      const end = start + this.rings[r * 2 + 1];
      const c = this.coords;
      for (let i = start, j = end - 2; i < end; j = i, i += 2) {
        if (c[i + 1] > z !== c[j + 1] > z && x < ((c[j] - c[i]) * (z - c[i + 1])) / (c[j + 1] - c[i + 1]) + c[i]) {
          inside = !inside;
        }
      }
    }
    return inside;
  }

  /** Closest point on the building's outline to (x, z): { x, z, distance }. */
  nearestEdge(index, x, z) {
    const o = index * STRIDE;
    const c = this.coords;
    let best = { x, z, distance: Infinity };
    for (let r = this.buildings[o]; r < this.buildings[o] + this.buildings[o + 1]; r++) {
      const start = this.rings[r * 2];
      const end = start + this.rings[r * 2 + 1];
      for (let i = start, j = end - 2; i < end; j = i, i += 2) {
        const ax = c[j], az = c[j + 1], dx = c[i] - ax, dz = c[i + 1] - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        const px = ax + dx * t, pz = az + dz * t;
        const d = Math.hypot(x - px, z - pz);
        if (d < best.distance) best = { x: px, z: pz, distance: d };
      }
    }
    return best;
  }
}
