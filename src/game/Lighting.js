import * as THREE from 'three';
import { SkyFog } from './skyFog.js';
import { SkyDome, createPalette, skyPalette } from './skyDome.js';
import { sunPosition } from './sun.js';

// The sky dome follows the camera and must stay inside the camera's far plane (18 km).
export const SKY_SIZE = 18000;
const SKY_RADIUS = 8000;
const SHADOW_EXTENT = 170;

// Light strengths relative to the palette (calibrated for ACES tone mapping at the palette's exposure).
const SUN_STRENGTH = 1.1;
const AMBIENT_STRENGTH = 0.32;
const ENVIRONMENT_STRENGTH = 1.0;

const smoothstep = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);

/**
 * Sky, sun, moon, sky reflections and horizon fog for a place and time. Colours come from the
 * art-directed palette in skyDome.js, keyed by the real sun height; the key light is the sun by day
 * and the moon by night, and keeps one shadow map centred on the bird.
 */
export class Lighting {
  constructor(renderer, scene, { lat, lon, shadowMapSize = 2048 }) {
    this.renderer = renderer;
    this.scene = scene;
    this.lat = lat;
    this.lon = lon;
    this.uniforms = { night: { value: 0 }, wet: { value: 0 } };
    this.weather = { cloud: 0.12, overcast: 0, rain: 0, fog: 0 };
    this.palette = createPalette();
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.direction = new THREE.Vector3(0, 1, 0);
    this.applied = null;

    this.dome = new SkyDome(SKY_RADIUS);
    this.sky = this.dome.mesh;
    scene.add(this.sky);

    // The same dome (shared uniforms) in its own scene, rendered into the environment map for reflections.
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envScene.add(this.dome.clone());

    this.hemisphere = new THREE.HemisphereLight(0xcfe0f5, 0x6b6450, 0.3);
    scene.add(this.hemisphere);

    this.key = new THREE.DirectionalLight(0xffffff, 3);
    this.key.castShadow = true;
    this.setShadowMapSize(shadowMapSize);
    Object.assign(this.key.shadow.camera, {
      left: -SHADOW_EXTENT, right: SHADOW_EXTENT, top: SHADOW_EXTENT, bottom: -SHADOW_EXTENT, near: 1, far: 2000,
    });
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.6;
    scene.add(this.key, this.key.target);

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

  /**
   * Applies weather (see weather.js). Call setTime afterwards; pass refresh to re-render reflections and
   * the horizon fog colour even if the sun hasn't moved.
   */
  setWeather(w, refresh) {
    this.weather = { ...w };
    this.uniforms.wet.value = w.rain;
    if (refresh) this.applied = null;
  }

  /** A flash of lightning, 0..1; fades on its own in tick(). */
  flash(strength) {
    this.dome.uniforms.uFlash.value = Math.max(this.dome.uniforms.uFlash.value, strength);
  }

  /** Updates everything for a moment in time. Expensive parts only re-run when the sun has moved. */
  setTime(date) {
    const sun = sunPosition(date, this.lat, this.lon);
    const el = THREE.MathUtils.degToRad(sun.elevation);
    const az = THREE.MathUtils.degToRad(sun.azimuth);
    const sunDir = this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    this.sunElevation = sun.elevation;

    // The moon: roughly opposite the sun, swung round 30° so it isn't always exactly behind you.
    const m = this.moonDir.copy(sunDir).multiplyScalar(-1);
    const c = Math.cos(0.52), s = Math.sin(0.52);
    m.set(m.x * c - m.z * s, m.y, m.x * s + m.z * c).normalize();

    const w = this.weather;
    const p = skyPalette(sunDir.y, w.overcast, this.palette);
    const night = 1 - smoothstep(-0.14, 0.04, sunDir.y);
    this.uniforms.night.value = night;
    this.dome.apply(p, { sunDir, moonDir: m, night, cloud: w.cloud, overcast: w.overcast });

    // Key light: the sun while it's up, then the moon (kept reasonably high so it lights the city).
    if (sunDir.y > -0.03) this.direction.copy(sunDir).setY(Math.max(sunDir.y, 0.02)).normalize();
    else this.direction.copy(m).setY(Math.max(m.y, 0.45)).normalize();
    this.key.color.copy(p.sun);
    this.key.intensity = p.sunI * SUN_STRENGTH; // the palette already dims the sun for overcast skies
    // Overcast: soft, shadowless light from the whole sky.
    this.key.shadow.intensity = 1 - 0.85 * w.overcast;

    this.hemisphere.color.copy(p.zenith).lerp(p.horizon, 0.5);
    this.hemisphere.groundColor.copy(p.ground).multiplyScalar(0.6);
    // Lightning lights up everything for a moment.
    this.hemisphere.intensity = p.amb * AMBIENT_STRENGTH * (1 + 1.8 * w.overcast) + this.dome.uniforms.uFlash.value * 2.5;
    this.renderer.toneMappingExposure = p.exp;

    // Re-render reflections and the horizon fog when the sun has moved noticeably.
    const moved = !this.applied || this.applied.angleTo(sunDir) > THREE.MathUtils.degToRad(0.75);
    if (moved) {
      this.applied = sunDir.clone();
      const previous = this.envTarget;
      this.envTarget = this.pmrem.fromScene(this.envScene);
      this.scene.environment = this.envTarget.texture;
      this.scene.environmentIntensity = ENVIRONMENT_STRENGTH;
      previous?.dispose();

      this.sky.position.set(0, 0, 0);
      if (this.skyFog) this.skyFog.update(this.renderer, this.sky);
      else this.skyFog = new SkyFog(this.renderer, this.sky);
    }
  }

  /** Twinkling stars, drifting clouds (with the wind) and fading lightning. */
  tick(dt, wind) {
    const u = this.dome.uniforms;
    u.uTime.value += dt;
    u.uCloudWind.value.x += (wind.x * 0.0006 + 0.0015) * dt;
    u.uCloudWind.value.y += wind.z * 0.0006 * dt;
    u.uFlash.value *= Math.exp(-dt * 9);
  }

  /** Keeps the shadow map centred on a point, snapped to whole texels so shadows don't shimmer. */
  follow(point, cameraPosition) {
    this.sky.position.copy(cameraPosition);
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
    this.dome.dispose();
  }
}
