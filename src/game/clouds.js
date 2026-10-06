import * as THREE from 'three';

const CELL = 900; // the cloud field is laid out on a grid so banks stay put as you fly around
const RANGE = 3; // cells each way
const PUFFS_PER_BANK = 18;
const MAX_PUFFS = (RANGE * 2 + 1) ** 2 * PUFFS_PER_BANK;
const BASE_HEIGHT = 330; // cloud base above the ground at the start
const INSIDE_RADIUS = 0.8; // fraction of a puff's size that counts as "inside the cloud"

/**
 * Banks of soft cloud puffs at a few hundred metres, which you can fly into. They're camera-facing
 * quads drawn with a soft round texture; how many cells hold a bank depends on the cloud cover.
 * Inside a cloud, `insideAmount` rises so the game can fog the view white.
 */
export class Clouds {
  constructor(scene) {
    const geometry = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
    this.offsets = new Float32Array(MAX_PUFFS * 4); // x, y, z, size
    this.offsetAttribute = new THREE.InstancedBufferAttribute(this.offsets, 4);
    geometry.setAttribute('puff', this.offsetAttribute);
    geometry.instanceCount = 0;

    this.uniforms = {
      puffMap: { value: puffTexture() },
      lit: { value: new THREE.Color(1, 1, 1) },
      shade: { value: new THREE.Color(0.6, 0.65, 0.72) },
      opacity: { value: 0.9 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec4 puff;
        varying vec2 vUv;
        varying float vShade;
        varying float vFade;
        void main() {
          vUv = uv;
          vec4 centre = viewMatrix * vec4(puff.xyz, 1.0);
          // Billboard: offset the corner in view space so the quad always faces the camera.
          vec4 mv = centre + vec4(position.xy * puff.w, 0.0, 0.0);
          // Lighter on top, shaded underneath.
          vShade = clamp(position.y + 0.5, 0.0, 1.0);
          // Fade puffs that are very close, so flying through them doesn't flash.
          vFade = smoothstep(4.0, puff.w * 0.6, -centre.z) * (1.0 - smoothstep(1800.0, 2900.0, length(centre.xyz)));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D puffMap;
        uniform vec3 lit;
        uniform vec3 shade;
        uniform float opacity;
        varying vec2 vUv;
        varying float vShade;
        varying float vFade;
        void main() {
          float a = texture2D(puffMap, vUv).r * opacity * vFade;
          if (a < 0.01) discard;
          gl_FragColor = vec4(mix(shade, lit, vShade), a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.cellKey = null;
    this.coverage = -1;
    this.insideAmount = 0;
    this.base = BASE_HEIGHT;
  }

  /**
   * @param coverage 0..1 cloud cover
   * @param light    { lit, shade } THREE.Colors for the sunny top and shaded underside
   */
  update(dt, birdPosition, coverage, light) {
    const cx = Math.floor(birdPosition.x / CELL), cz = Math.floor(birdPosition.z / CELL);
    const key = `${cx},${cz}`;
    if (key !== this.cellKey || Math.abs(coverage - this.coverage) > 0.05) {
      this.cellKey = key;
      this.coverage = coverage;
      this.layout(cx, cz, coverage);
    }
    this.uniforms.lit.value.copy(light.lit);
    this.uniforms.shade.value.copy(light.shade);

    // How deep inside a puff the bird is (0 = outside), smoothed.
    let inside = 0;
    const n = this.mesh.geometry.instanceCount;
    for (let i = 0; i < n; i++) {
      const o = this.offsets;
      const d = Math.hypot(o[i * 4] - birdPosition.x, o[i * 4 + 1] - birdPosition.y, o[i * 4 + 2] - birdPosition.z);
      inside = Math.max(inside, 1 - d / (o[i * 4 + 3] * 0.5 * INSIDE_RADIUS));
    }
    this.insideAmount += (Math.max(0, inside) - this.insideAmount) * Math.min(1, dt * 3);
  }

  /** Deterministic banks per grid cell: whether a cell has a bank depends on the coverage. */
  layout(cx, cz, coverage) {
    let count = 0;
    for (let dx = -RANGE; dx <= RANGE; dx++) {
      for (let dz = -RANGE; dz <= RANGE; dz++) {
        const gx = cx + dx, gz = cz + dz;
        let seed = Math.abs((gx * 73856093) ^ (gz * 19349663)) % 2147483646 + 1;
        const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
        if (random() > coverage * 0.9) continue;
        const bx = (gx + 0.2 + random() * 0.6) * CELL, bz = (gz + 0.2 + random() * 0.6) * CELL;
        const by = this.base + random() * 180;
        const spread = 60 + random() * 90;
        for (let p = 0; p < PUFFS_PER_BANK; p++) {
          const size = 50 + random() * 70;
          this.offsets.set([
            bx + (random() - 0.5) * spread * 2.2,
            by + (random() - 0.3) * spread * 0.45,
            bz + (random() - 0.5) * spread * 1.4,
            size,
          ], count * 4);
          count++;
        }
      }
    }
    this.mesh.geometry.instanceCount = count;
    this.offsetAttribute.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.uniforms.puffMap.value.dispose();
  }
}

/** A soft, slightly lumpy round puff, drawn once on a canvas. */
function puffTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 9; i++) {
    const x = size / 2 + (Math.random() - 0.5) * size * 0.35;
    const y = size / 2 + (Math.random() - 0.5) * size * 0.25;
    const r = size * (0.22 + Math.random() * 0.18);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}
