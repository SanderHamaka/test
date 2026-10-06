import * as THREE from 'three';
import { createProjection } from './geo.js';
import { FAR_ZOOM, lonLatToTile, tileKey } from './tiles.js';

const RANGE = 2; // tiles each way: a 5×5 patch, about 30 km across
const SINK = 4; // metres below the detailed tiles, so those always win where both exist

/**
 * Low-detail terrain out to the horizon, so hills and mountains show beyond the detailed tiles.
 * Inside a circle around the bird (covered by detailed tiles) it is cut away in the shader.
 */
export class FarTerrain {
  constructor(scene, prepareMaterial, { origin, demo, holeRadius }) {
    this.scene = scene;
    this.origin = origin;
    this.demo = demo;
    this.projection = createProjection(origin.lat, origin.lon);
    this.tiles = new Map(); // key → mesh | 'loading'
    this.nextId = 1;
    this.requests = new Map();
    this.centreKey = null;

    this.hole = { centre: { value: new THREE.Vector2() }, radius: { value: holeRadius } };
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.holeCentre = this.hole.centre;
      shader.uniforms.holeRadius = this.hole.radius;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFarXZ;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvFarXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFarXZ;\nuniform vec2 holeCentre;\nuniform float holeRadius;')
        .replace('void main() {', 'void main() {\n  if (distance(vFarXZ, holeCentre) < holeRadius) discard;');
    };
    this.material = prepareMaterial(material);

    this.worker = new Worker(new URL('./world.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => this.onMessage(data);
  }

  update(position) {
    this.hole.centre.value.set(position.x, position.z);
    const [lat, lon] = this.projection.toLatLon(position.x, position.z);
    const centre = lonLatToTile(lat, lon, FAR_ZOOM);
    const key = tileKey(centre.x, centre.y);
    if (key === this.centreKey) return;
    this.centreKey = key;

    const wanted = new Set();
    for (let dy = -RANGE; dy <= RANGE; dy++) {
      for (let dx = -RANGE; dx <= RANGE; dx++) {
        const x = centre.x + dx, y = centre.y + dy;
        const k = tileKey(x, y);
        wanted.add(k);
        if (this.tiles.has(k)) continue;
        const id = this.nextId++;
        this.tiles.set(k, 'loading');
        this.requests.set(id, k);
        this.worker.postMessage({ type: 'far', id, x, y, origin: this.origin, demo: this.demo });
      }
    }
    for (const [k, mesh] of this.tiles) {
      if (wanted.has(k)) continue;
      if (mesh !== 'loading') {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
      this.tiles.delete(k);
    }
  }

  onMessage({ id, far }) {
    const key = this.requests.get(id);
    this.requests.delete(id);
    if (!far || this.tiles.get(key) !== 'loading') return;
    const mesh = new THREE.Mesh(buildGeometry(far), this.material);
    mesh.position.set((far.rect.minX + far.rect.maxX) / 2, -SINK, (far.rect.minZ + far.rect.maxZ) / 2);
    this.scene.add(mesh);
    this.tiles.set(key, mesh);
  }

  dispose() {
    this.worker.terminate();
    for (const mesh of this.tiles.values()) {
      if (mesh === 'loading') continue;
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.material.dispose();
  }
}

function buildGeometry({ rect, grid, heights, colours }) {
  const n = grid + 1;
  const w = rect.maxX - rect.minX, d = rect.maxZ - rect.minZ;
  const positions = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      positions.set([(i / grid - 0.5) * w, heights[j * n + i], (j / grid - 0.5) * d], (j * n + i) * 3);
    }
  }
  const index = [];
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const a = j * n + i;
      index.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
