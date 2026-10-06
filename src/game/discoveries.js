import * as THREE from 'three';

const COMPASS_RANGE = 2000;
const DISCOVER_RADIUS = 80;
const DISCOVER_MAX_HEIGHT = 260;
const BEAM_RANGE = 1400;
const MAX_BEAMS = 24;
const BEAM_HEIGHT = 140;

/**
 * Named landmarks from the map, to be discovered by flying close. Undiscovered ones show on the
 * compass and get a faint beam of light so they can be found from the air.
 */
export class Discoveries {
  constructor(scene, progress) {
    this.progress = progress;
    this.landmarks = new Map();
    this.version = -1;
    this.timer = 0;
    this.compass = [];

    const geometry = new THREE.CylinderGeometry(2.2, 2.2, 1, 12, 1, true).translate(0, 0.5, 0);
    // Vertical fade: brightest at the bottom.
    const fade = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < geometry.attributes.position.count; i++) {
      const v = 1 - geometry.attributes.position.getY(i);
      fade.set([v, v * 0.85, v * 0.5], i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(fade, 3));
    this.beams = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: false,
    }), MAX_BEAMS);
    this.beams.count = 0;
    this.beams.frustumCulled = false;
    scene.add(this.beams);
  }

  sync(tileManager) {
    if (tileManager.version === this.version) return;
    this.version = tileManager.version;
    this.landmarks.clear();
    for (const { tile } of tileManager.tiles.values()) {
      for (const landmark of tile.landmarks) this.landmarks.set(landmark.id, landmark);
    }
  }

  /** @returns landmarks discovered this frame */
  update(dt, bird) {
    this.timer -= dt;
    if (this.timer > 0) return [];
    this.timer = 0.2;

    const p = bird.position;
    const found = [];
    const nearby = [];
    for (const landmark of this.landmarks.values()) {
      if (this.progress.discovered.has(landmark.id)) continue;
      const dx = landmark.x - p.x, dz = landmark.z - p.z;
      const distance = Math.hypot(dx, dz);
      if (distance < DISCOVER_RADIUS && p.y - landmark.y < DISCOVER_MAX_HEIGHT) {
        if (this.progress.discover(landmark.id)) found.push(landmark);
        continue;
      }
      if (distance < COMPASS_RANGE) {
        // Bearing relative to where the bird is heading: positive means to the right.
        const heading = Math.atan2(-dx, -dz);
        const relative = Math.atan2(Math.sin(bird.yaw - heading), Math.cos(bird.yaw - heading));
        nearby.push({ id: landmark.id, name: landmark.name, kind: landmark.kind, distance, relative, landmark });
      }
    }
    nearby.sort((a, b) => a.distance - b.distance);
    this.compass = nearby.slice(0, 8).map(({ landmark, ...rest }) => rest);

    const matrix = new THREE.Matrix4();
    let count = 0;
    for (const { landmark, distance } of nearby) {
      if (count >= MAX_BEAMS || distance > BEAM_RANGE) break;
      // Thinner and fainter with distance: scale the radius down a little as well.
      const width = 1 + distance / 600;
      matrix.makeScale(width, BEAM_HEIGHT, width).setPosition(landmark.x, landmark.y, landmark.z);
      this.beams.setMatrixAt(count++, matrix);
    }
    this.beams.count = count;
    this.beams.instanceMatrix.needsUpdate = true;
    return found;
  }

  dispose() {
    this.beams.geometry.dispose();
    this.beams.material.dispose();
    this.beams.removeFromParent();
  }
}
