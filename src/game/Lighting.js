import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { SkyFog } from './skyFog.js';
import { sunPosition } from './sun.js';

// The sky box follows the camera; its corners must stay inside the camera's far plane.
export const SKY_SIZE = 18000;
const SHADOW_EXTENT = 170;

const DAY_SUN = new THREE.Color(0xfff0dd);
const LOW_SUN = new THREE.Color(0xffa060);
const MOON = new THREE.Color(0x9fb6ff);
const smoothstep = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);

/**
 * Sky, sun, moon, sky reflections and horizon fog for a place and time. The key light is the sun by
 * day and the moon by night, and keeps one shadow map centred on the bird.
 */
export class Lighting {
  constructor(renderer, scene, { lat, lon, shadowMapSize = 2048 }) {
    this.renderer = renderer;
    this.scene = scene;
    this.lat = lat;
    this.lon = lon;
    this.uniforms = { night: { value: 0 } };
    this.direction = new THREE.Vector3(0, 1, 0);
    this.applied = null;

    this.sky = new Sky();
    this.sky.scale.setScalar(SKY_SIZE);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.0025;
    u.mieDirectionalG.value = 0.8;
    scene.add(this.sky);

    // A copy of the sky in its own scene, rendered into the environment map for reflections.
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(SKY_SIZE);
    this.envSky.material.uniforms = THREE.UniformsUtils.clone(u);
    this.envScene.add(this.envSky);

    this.hemisphere = new THREE.HemisphereLight(0xcfe0f5, 0x6b6450, 0.3);
    scene.add(this.hemisphere);

    this.key = new THREE.DirectionalLight(0xffffff, 3.4);
    this.key.castShadow = true;
    this.setShadowMapSize(shadowMapSize);
    Object.assign(this.key.shadow.camera, {
      left: -SHADOW_EXTENT, right: SHADOW_EXTENT, top: SHADOW_EXTENT, bottom: -SHADOW_EXTENT, near: 1, far: 2000,
    });
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.6;
    scene.add(this.key, this.key.target);

    this.stars = createStars();
    scene.add(this.stars);

    scene.fog = new THREE.Fog(0xffffff, 450, 1400); // colour comes from SkyFog
    this.skyFog = null;
  }

  setShadowMapSize(size) {
    this.shadowMapSize = size;
    this.key.shadow.mapSize.set(size, size);
    this.key.shadow.map?.dispose();
    this.key.shadow.map = null;
  }

  setFogDistances(near, far) {
    this.scene.fog.near = near;
    this.scene.fog.far = far;
  }

  /** Updates everything for a moment in time. Expensive parts only re-run when the sun has moved. */
  setTime(date) {
    const sun = sunPosition(date, this.lat, this.lon);
    const el = THREE.MathUtils.degToRad(sun.elevation);
    const az = THREE.MathUtils.degToRad(sun.azimuth);
    const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    this.sky.material.uniforms.sunPosition.value.copy(sunDir);

    const day = smoothstep(-0.04, 0.12, sunDir.y); // 0 at night, 1 by day
    const night = 1 - smoothstep(-0.14, 0.04, sunDir.y);
    this.uniforms.night.value = night;
    this.stars.material.opacity = night * 0.9;
    this.stars.visible = night > 0.02;
    this.sunElevation = sun.elevation;

    // Key light: the sun while it's up, then the moon (opposite side of the sky, fixed height).
    if (sunDir.y > -0.03) {
      this.direction.copy(sunDir).setY(Math.max(sunDir.y, 0.02)).normalize();
      this.key.color.copy(LOW_SUN).lerp(DAY_SUN, smoothstep(0.02, 0.35, sunDir.y));
      this.key.intensity = 3.4 * day;
    } else {
      this.direction.set(-sunDir.x, 0, -sunDir.z).normalize().multiplyScalar(0.8).setY(0.6).normalize();
      this.key.color.copy(MOON);
      this.key.intensity = 0.55 * night;
    }

    this.hemisphere.intensity = THREE.MathUtils.lerp(0.06, 0.3, day);
    this.hemisphere.color.set(day > 0.5 ? 0xcfe0f5 : 0x6d7fa8);
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(0.5, 0.9, night);

    // Re-render reflections and the horizon fog when the sun has moved noticeably.
    const moved = !this.applied || this.applied.angleTo(sunDir) > THREE.MathUtils.degToRad(0.75);
    if (moved) {
      this.applied = sunDir.clone();
      this.envSky.material.uniforms.sunPosition.value.copy(sunDir);
      const previous = this.envTarget;
      this.envTarget = this.pmrem.fromScene(this.envScene);
      this.scene.environment = this.envTarget.texture;
      this.scene.environmentIntensity = THREE.MathUtils.lerp(0.25, 0.45, day);
      previous?.dispose();

      this.sky.position.set(0, 0, 0);
      if (this.skyFog) this.skyFog.update(this.renderer, this.sky);
      else this.skyFog = new SkyFog(this.renderer, this.sky);
    }
  }

  /** Keeps the shadow map centred on a point, snapped to whole texels so shadows don't shimmer. */
  follow(point, cameraPosition) {
    this.sky.position.copy(cameraPosition);
    this.stars.position.copy(cameraPosition);
    const lz = this.direction;
    const lx = new THREE.Vector3(0, 1, 0).cross(lz).normalize();
    const ly = lz.clone().cross(lx);
    const texel = (SHADOW_EXTENT * 2) / this.shadowMapSize;
    const u = Math.round(point.dot(lx) / texel) * texel;
    const v = Math.round(point.dot(ly) / texel) * texel;
    const centre = lx.multiplyScalar(u).addScaledVector(ly, v).addScaledVector(lz, point.dot(lz));
    this.key.target.position.copy(centre);
    this.key.position.copy(centre).addScaledVector(lz, 800);
  }

  dispose() {
    this.envTarget?.dispose();
    this.pmrem.dispose();
    this.skyFog?.dispose();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    for (const sky of [this.sky, this.envSky]) {
      sky.geometry.dispose();
      sky.material.dispose();
    }
  }
}

/** A fixed starfield on the upper half of a large sphere around the camera, faded in at night. */
function createStars() {
  const count = 2500;
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  let seed = 42;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < count; i++) {
    const y = 0.03 + random() * 0.97; // above the horizon only
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    positions.set([Math.cos(a) * r * 8000, y * 8000, Math.sin(a) * r * 8000], i * 3);
    const b = 0.4 + random() ** 3 * 0.6; // mostly faint, a few bright
    colours.set([b, b, b * (0.9 + random() * 0.2)], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const material = new THREE.PointsMaterial({
    size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, fog: false, depthWrite: false,
  });
  const stars = new THREE.Points(geometry, material);
  stars.frustumCulled = false;
  stars.renderOrder = -1;
  return stars;
}
