import * as THREE from 'three';

const DROPS = 5000;
const BOX = new THREE.Vector3(80, 50, 80); // volume around the camera that is filled with rain
const FALL_SPEED = 11;

/**
 * Rain streaks animated entirely on the GPU. Drops live in world space and wrap around the camera,
 * so flying through rain looks right; the wind slants them.
 */
export class Rain {
  constructor(scene) {
    const base = new Float32Array(DROPS * 2 * 3);
    const end = new Float32Array(DROPS * 2);
    for (let i = 0; i < DROPS; i++) {
      const x = Math.random() * BOX.x, y = Math.random() * BOX.y, z = Math.random() * BOX.z;
      base.set([x, y, z, x, y, z], i * 6);
      end[i * 2 + 1] = 1; // second vertex: the tail of the streak
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(base, 3));
    geometry.setAttribute('tail', new THREE.BufferAttribute(end, 1));

    this.uniforms = {
      time: { value: 0 },
      cameraPos: { value: new THREE.Vector3() },
      wind: { value: new THREE.Vector2() },
      box: { value: BOX },
      intensity: { value: 0 },
      brightness: { value: 1 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float tail;
        uniform float time;
        uniform vec3 cameraPos;
        uniform vec2 wind;
        uniform vec3 box;
        uniform float intensity;
        varying float vAlpha;
        void main() {
          vec3 velocity = vec3(wind.x, -${FALL_SPEED.toFixed(1)}, wind.y);
          vec3 p = position + velocity * time;
          // Wrap into a box centred on the camera.
          p = mod(p - cameraPos + box * 0.5, box) + cameraPos - box * 0.5;
          p -= velocity * 0.045 * tail;
          // Thin the rain out by hiding a share of the drops when it's light.
          vAlpha = step(fract(position.x * 7.13 + position.z * 3.71), intensity) * (1.0 - tail * 0.7);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float brightness;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.0) discard;
          gl_FragColor = vec4(vec3(0.75, 0.8, 0.86) * brightness, 0.35 * vAlpha);
        }`,
    });
    this.lines = new THREE.LineSegments(geometry, material);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    scene.add(this.lines);
  }

  update(dt, camera, intensity, wind, brightness) {
    this.lines.visible = intensity > 0.01;
    if (!this.lines.visible) return;
    const u = this.uniforms;
    u.time.value += dt;
    u.cameraPos.value.copy(camera.position);
    u.wind.value.set(wind.x, wind.z);
    u.intensity.value = intensity;
    u.brightness.value = brightness;
  }

  dispose() {
    this.lines.removeFromParent();
    this.lines.geometry.dispose();
    this.lines.material.dispose();
  }
}
