import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FOOD_TYPES } from './species.js';

const CAPACITY = 2500; // per food type
const EAT_RADIUS = 3.4;
const RESPAWN_MS = 3 * 60 * 1000;
const SPARKLE_COLOURS = [0x9fd8ff, 0xd6ff8a, 0xffe08a, 0xffb36b, 0xe0c8b0];

/**
 * Food floating above the places it comes from (fish over water, scraps by snack bars…). Each item
 * is a small bobbing model plus a sparkle that stays visible from the air. Flying through one eats it;
 * it comes back a few minutes later.
 */
export class FoodManager {
  constructor(scene, prepareMaterial) {
    this.scene = scene;
    this.items = [];
    this.eatenAt = new Map(); // item key → time eaten
    this.version = -1;

    const material = prepareMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }));
    this.material = material;
    this.meshes = FOOD_MODELS.map((build) => {
      const mesh = new THREE.InstancedMesh(build(), material, CAPACITY);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return mesh;
    });

    const sparkleGeometry = new THREE.BufferGeometry();
    sparkleGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAPACITY * 3 * 2), 3));
    sparkleGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(CAPACITY * 3 * 2), 3));
    this.sparkles = new THREE.Points(sparkleGeometry, new THREE.PointsMaterial({
      size: 5, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.sparkles.frustumCulled = false;
    scene.add(this.sparkles);
    this.matrix = new THREE.Matrix4();
    this.quaternion = new THREE.Quaternion();
    this.scale = new THREE.Vector3(2.2, 2.2, 2.2);
    this.up = new THREE.Vector3(0, 1, 0);
    this.position = new THREE.Vector3();
  }

  /** Re-reads food from the loaded tiles when the set of tiles has changed. */
  sync(tileManager) {
    if (tileManager.version === this.version) return;
    this.version = tileManager.version;
    this.items = [];
    for (const [key, entry] of tileManager.tiles) {
      const food = entry.tile.food;
      for (let i = 0; i < food.length; i += 4) {
        this.items.push({ key: `${key}:${i}`, x: food[i], y: food[i + 1], z: food[i + 2], type: food[i + 3] });
      }
    }
  }

  /**
   * Animates the food and eats whatever the bird flies through.
   * @returns array of eaten food type names
   */
  update(time, bird) {
    const now = performance.now();
    const eaten = [];
    const counts = this.meshes.map(() => 0);
    const positions = this.sparkles.geometry.attributes.position;
    const colours = this.sparkles.geometry.attributes.color;
    const sparkleColour = new THREE.Color();
    let sparkles = 0;
    const p = bird.position;

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const at = this.eatenAt.get(item.key);
      if (at && now - at < RESPAWN_MS) continue;

      const dx = item.x - p.x, dy = item.y - p.y, dz = item.z - p.z;
      if (bird.state === 'flying' && dx * dx + dy * dy + dz * dz < EAT_RADIUS * EAT_RADIUS) {
        this.eatenAt.set(item.key, now);
        eaten.push(FOOD_TYPES[item.type]);
        continue;
      }

      const t = counts[item.type];
      if (t >= CAPACITY) continue;
      const bob = Math.sin(time * 2 + i) * 0.25;
      this.quaternion.setFromAxisAngle(this.up, time * 0.8 + i);
      this.matrix.compose(this.position.set(item.x, item.y + bob, item.z), this.quaternion, this.scale);
      this.meshes[item.type].setMatrixAt(t, this.matrix);
      counts[item.type]++;

      if (sparkles < CAPACITY * 2) {
        positions.setXYZ(sparkles, item.x, item.y + bob + 1.4, item.z);
        // Twinkle: brightness varies per item over time.
        sparkleColour.set(SPARKLE_COLOURS[item.type]).multiplyScalar(0.55 + 0.45 * Math.sin(time * 3.1 + i * 1.7));
        colours.setXYZ(sparkles, sparkleColour.r, sparkleColour.g, sparkleColour.b);
        sparkles++;
      }
    }

    this.meshes.forEach((mesh, type) => {
      mesh.count = counts[type];
      mesh.instanceMatrix.needsUpdate = true;
    });
    this.sparkles.geometry.setDrawRange(0, sparkles);
    positions.needsUpdate = colours.needsUpdate = true;
    return eaten;
  }

  dispose() {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.removeFromParent();
    }
    this.material.dispose();
    this.sparkles.geometry.dispose();
    this.sparkles.material.dispose();
    this.sparkles.removeFromParent();
  }
}

/** Gives a geometry a uniform vertex colour, so differently coloured parts can be merged. */
function tinted(geometry, hex) {
  const colour = new THREE.Color(hex);
  const colours = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < colours.length; i += 3) colour.toArray(colours, i);
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geometry.index ? geometry.toNonIndexed() : geometry;
}

const sphere = (r, hex, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) =>
  tinted(new THREE.SphereGeometry(r, 10, 8).scale(sx, sy, sz).translate(x, y, z), hex);

// One builder per food type, in FOOD_TYPES order: fish, insects, seeds, scraps, mice.
const FOOD_MODELS = [
  () => mergeGeometries([
    sphere(0.12, 0xaebfcc, 0, 0, 0, 0.7, 1, 2.2),
    tinted(new THREE.ConeGeometry(0.1, 0.16, 4).rotateX(Math.PI / 2).scale(0.3, 1, 1).translate(0, 0, 0.32), 0x7d93a3),
    sphere(0.025, 0x111111, 0.07, 0.03, -0.18),
  ]),
  () => mergeGeometries([[0, 0, 0], [0.18, 0.1, 0.05], [-0.15, 0.16, -0.08], [0.06, 0.28, 0.12], [-0.08, -0.1, 0.14]]
    .map(([x, y, z]) => sphere(0.05, 0x2a2d22, x, y, z))),
  () => mergeGeometries([[0, 0, 0], [0.09, 0.02, 0.05], [-0.08, 0.01, 0.06], [0.03, 0.05, -0.08], [-0.05, 0.08, -0.02], [0.07, 0.07, -0.03]]
    .map(([x, y, z]) => sphere(0.05, 0xd8b247, x, y, z, 0.7, 0.7, 1.2))),
  () => mergeGeometries([
    tinted(new THREE.CylinderGeometry(0.13, 0.09, 0.2, 10), 0xc8322c),
    ...[[-0.05, 0], [0.04, 0.03], [0, -0.05], [0.06, -0.04], [-0.03, 0.05]].map(([x, z], i) =>
      tinted(new THREE.BoxGeometry(0.03, 0.22, 0.03).rotateZ((i - 2) * 0.12).translate(x, 0.16, z), 0xf2c94c)),
  ]),
  () => mergeGeometries([
    sphere(0.12, 0x8a7f74, 0, 0, 0, 0.9, 0.8, 1.6),
    sphere(0.04, 0xd9a0a0, 0.06, 0.09, -0.12),
    sphere(0.04, 0xd9a0a0, -0.06, 0.09, -0.12),
    tinted(new THREE.CylinderGeometry(0.01, 0.006, 0.3, 4).rotateX(Math.PI / 2.4).translate(0, 0.02, 0.3), 0xd9a0a0),
  ]),
];
