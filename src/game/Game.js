import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Bird } from './Bird.js';
import { Input } from './Input.js';
import { Lighting, SKY_SIZE } from './Lighting.js';
import { LOAD_DISTANCE, TileManager, resolveOriginElevation } from './TileManager.js';
import { atSolarHours, solarHours } from './sun.js';

// Fully fogged just before the edge of the loaded tiles, so they never show a hard border.
const FOG_NEAR = 450;
const FOG_FAR = LOAD_DISTANCE + 100;

/** Graphics presets: render resolution, shadow detail and post-processing. */
export const QUALITY = {
  low: { label: 'Low', pixelRatio: 1, shadowMapSize: 1024, post: false, ao: false, bloom: false },
  medium: { label: 'Medium', pixelRatio: 1.5, shadowMapSize: 2048, post: true, ao: false, bloom: true },
  high: { label: 'High', pixelRatio: 2, shadowMapSize: 4096, post: true, ao: true, bloom: true },
};

export class Game {
  /**
   * @param canvas    canvas element to render into
   * @param place     { lat, lon } to fly over
   * @param demo      use the generated offline demo city instead of OSM
   * @param quality   key of QUALITY
   * @param onHud     called ~10x per second with { altitude, speed, bump, tiles, time }
   * @param onStatus  called with { state: 'loading' | 'ready' | 'error', message }
   */
  constructor(canvas, place, { demo = false, quality = 'high', onHud = () => {}, onStatus = () => {} } = {}) {
    this.canvas = canvas;
    this.place = place;
    this.onHud = onHud;
    this.onStatus = onStatus;
    this.paused = false;
    this.ready = false;
    this.disposed = false;
    this.cameraDistance = 9;
    this.shake = 0;
    this.hudTimer = 0;
    this.hudFlags = {};
    this.date = new Date(); // the real time at the place, until the player changes it

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.8, SKY_SIZE);
    this.camera.position.set(0, 80, 80);
    this.camera.lookAt(0, 60, 0);

    this.lighting = new Lighting(this.renderer, this.scene, { lat: place.lat, lon: place.lon });
    this.lighting.setFogDistances(FOG_NEAR, FOG_FAR);
    this.lighting.setTime(this.date);

    this.prepareMaterial = (material) => {
      this.lighting.skyFog.apply(material);
      return material;
    };

    this.bird = new Bird();
    this.bird.model.visible = false;
    this.scene.add(this.bird.model);
    this.bird.model.traverse((o) => o.material && this.prepareMaterial(o.material));

    this.input = new Input();
    this.onWheel = (e) => {
      e.preventDefault();
      this.cameraDistance = THREE.MathUtils.clamp(this.cameraDistance * (1 + Math.sign(e.deltaY) * 0.1), 4, 45);
    };
    canvas.addEventListener('wheel', this.onWheel, { passive: false });

    this.setQuality(quality);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();

    this.timer = new THREE.Timer();
    this.renderer.setAnimationLoop((time) => this.frame(time));
    this.start(place, demo);
    if (import.meta.env.DEV) window.__game = this; // handy for poking at the scene from the console
  }

  async start(place, demo) {
    this.onStatus({ state: 'loading', message: 'Finding the ground…' });
    const elevation = await resolveOriginElevation(place.lat, place.lon, demo);
    if (this.disposed) return;

    this.tiles = new TileManager({
      origin: { lat: place.lat, lon: place.lon, elevation },
      demo,
      renderer: this.renderer,
      scene: this.scene,
      prepareMaterial: this.prepareMaterial,
      uniforms: this.lighting.uniforms,
      onChange: () => this.reportTileStatus(),
    });

    const spawnPoint = new THREE.Vector3(0, 0, 60);
    await this.tiles.whenReady(spawnPoint);
    if (this.disposed) return;
    this.spawn(spawnPoint);
    this.ready = true;
    this.onStatus({ state: 'ready' });
  }

  reportTileStatus() {
    if (this.ready || !this.tiles) return;
    const { error } = this.tiles.status;
    this.onStatus({
      state: 'loading',
      message: error ? `Map server busy, retrying… (${error})` : 'Downloading map data from OpenStreetMap…',
    });
  }

  /** Start above the tallest building near the spawn point, facing north. */
  spawn(point) {
    let top = -Infinity;
    for (let x = -150; x <= 150; x += 10) {
      for (let z = -150; z <= 150; z += 10) top = Math.max(top, this.tiles.surfaceAt(point.x + x, point.z + z));
    }
    const ground = this.tiles.groundAt(point.x, point.z);
    this.bird.spawn(point.x, Math.max(ground + 60, top + 30), point.z, 0);
    this.bird.model.visible = true;
    this.placeCamera(true);
  }

  setPaused(paused) {
    this.paused = paused;
  }

  // ---- Time of day ----

  /** Local solar time at the place, in hours. */
  get solarHour() {
    return solarHours(this.date, this.place.lon);
  }

  setSolarHour(hours) {
    this.date = atSolarHours(this.date, this.place.lon, hours);
    this.lighting.setTime(this.date);
  }

  nudgeTime(minutes) {
    this.date = new Date(this.date.getTime() + minutes * 60000);
    this.lighting.setTime(this.date);
  }

  resetTime() {
    this.date = new Date();
    this.lighting.setTime(this.date);
  }

  // ---- Graphics quality ----

  setQuality(key) {
    const q = QUALITY[key] ?? QUALITY.high;
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    this.lighting.setShadowMapSize(q.shadowMapSize);

    this.disposeComposer();
    this.gtao = this.bloom = null;
    if (q.post) {
      // Multisampled half-float target: keeps antialiasing and HDR values until the final output pass.
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, target);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      if (q.ao) {
        this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
        this.gtao.updateGtaoMaterial({ radius: 3, distanceExponent: 1.5, thickness: 2, scale: 1 });
        this.gtao.blendIntensity = 0.85;
        this.composer.addPass(this.gtao);
      }
      if (q.bloom) {
        this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.35, 0.9);
        this.composer.addPass(this.bloom);
      }
      this.composer.addPass(new OutputPass());
    }
    this.resize();
  }

  disposeComposer() {
    this.composer?.passes.forEach((pass) => pass.dispose?.());
    this.composer?.dispose();
    this.composer = null;
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  frame(time) {
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), 1 / 20);

    if (this.tiles) this.tiles.update(this.ready ? this.bird.position : { x: 0, z: 60 }, this.paused ? 0 : dt);

    if (this.ready && !this.paused) {
      this.date = new Date(this.date.getTime() + dt * 1000);
      this.lighting.setTime(this.date);

      const events = this.bird.update(dt, this.input.state, this.tiles);
      if (events.bump) this.shake = 1;
      Object.assign(this.hudFlags, events);
      this.placeCamera(false, dt);
      this.reportHud(dt);
    }
    this.lighting.follow(this.bird.position, this.camera.position);

    if (this.composer) {
      const night = this.lighting.uniforms.night.value;
      if (this.bloom) {
        // Bloom is for lights at night; by day the bright sky would just haze everything.
        this.bloom.enabled = night > 0.05;
        this.bloom.strength = 0.4 * night;
      }
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  placeCamera(snap, dt = 0) {
    const bird = this.bird;
    const yawForward = new THREE.Vector3(-Math.sin(bird.yaw), 0, -Math.cos(bird.yaw));
    // Mostly level behind the bird, following its pitch a little, so dives feel steep without making you seasick.
    const back = yawForward.clone().multiplyScalar(-0.7).addScaledVector(bird.forward, -0.3).normalize();
    const target = bird.position.clone()
      .addScaledVector(back, this.cameraDistance)
      .add(new THREE.Vector3(0, this.cameraDistance * 0.28, 0));
    target.y = Math.max(target.y, this.tiles.groundAt(target.x, target.z) + 1.5);

    if (snap) this.camera.position.copy(target);
    else this.camera.position.lerp(target, 1 - Math.exp(-6 * dt));

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * 0.35;
      this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    }
    this.camera.lookAt(bird.position.clone().addScaledVector(bird.forward, 5));

    const fov = THREE.MathUtils.clamp(58 + (bird.speed - 20) * 0.45, 56, 82);
    if (Math.abs(fov - this.camera.fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 3 || 1);
      this.camera.updateProjectionMatrix();
    }
  }

  reportHud(dt) {
    this.hudTimer += dt;
    if (this.hudTimer < 0.1) return;
    this.hudTimer = 0;
    const p = this.bird.position;
    this.onHud({
      altitude: p.y - this.tiles.surfaceAt(p.x, p.z),
      speed: this.bird.speed * 3.6,
      bump: !!this.hudFlags.bump,
      tiles: this.tiles.status,
      time: this.solarHour,
    });
    this.hudFlags = {};
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.input.dispose();
    this.tiles?.dispose();
    this.disposeComposer();
    this.lighting.dispose();
    this.bird.model.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
    this.renderer.dispose();
  }
}
