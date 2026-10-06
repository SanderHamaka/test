import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Bird } from './Bird.js';
import { Input } from './Input.js';
import { SkyFog } from './skyFog.js';
import { LOAD_DISTANCE, TileManager, resolveOriginElevation } from './TileManager.js';

const SUN_ELEVATION = 38;
const SUN_AZIMUTH = 30; // degrees from south (+z) towards east (+x)
const SHADOW_EXTENT = 170;
const SHADOW_MAP_SIZE = 2048;
// The sky box follows the camera; its corners must stay inside the camera's far plane.
const SKY_SIZE = 18000;
// Fully fogged just before the edge of the loaded tiles, so they never show a hard border.
const FOG_NEAR = 450;
const FOG_FAR = LOAD_DISTANCE + 100;

export class Game {
  /**
   * @param canvas    canvas element to render into
   * @param place     { lat, lon } to fly over
   * @param demo      use the generated offline demo city instead of OSM
   * @param onHud     called ~10x per second with { altitude, speed, bump, tiles }
   * @param onStatus  called with { state: 'loading' | 'ready' | 'error', message }
   */
  constructor(canvas, place, { demo = false, onHud = () => {}, onStatus = () => {} } = {}) {
    this.canvas = canvas;
    this.onHud = onHud;
    this.onStatus = onStatus;
    this.paused = false;
    this.ready = false;
    this.disposed = false;
    this.cameraDistance = 9;
    this.shake = 0;
    this.hudTimer = 0;
    this.hudFlags = {};

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.5;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.8, SKY_SIZE);
    this.camera.position.set(0, 80, 80);
    this.camera.lookAt(0, 60, 0);

    this.sunDirection = new THREE.Vector3().setFromSphericalCoords(
      1, THREE.MathUtils.degToRad(90 - SUN_ELEVATION), THREE.MathUtils.degToRad(SUN_AZIMUTH),
    );
    this.setupSky();
    this.setupLights();

    this.bird = new Bird();
    this.bird.model.visible = false;
    this.scene.add(this.bird.model);
    this.prepareMaterial = (material) => {
      this.skyFog.apply(material);
      return material;
    };
    this.bird.model.traverse((o) => o.material && this.prepareMaterial(o.material));

    this.input = new Input();
    this.onWheel = (e) => {
      e.preventDefault();
      this.cameraDistance = THREE.MathUtils.clamp(this.cameraDistance * (1 + Math.sign(e.deltaY) * 0.1), 4, 45);
    };
    canvas.addEventListener('wheel', this.onWheel, { passive: false });

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
      onChange: () => this.reportTileStatus(),
    });

    try {
      const spawnPoint = new THREE.Vector3(0, 0, 60);
      await this.tiles.whenReady(spawnPoint);
      if (this.disposed) return;
      this.spawn(spawnPoint);
      this.ready = true;
      this.onStatus({ state: 'ready' });
    } catch (error) {
      if (!this.disposed) this.onStatus({ state: 'error', message: error.message });
    }
  }

  reportTileStatus() {
    if (this.ready || !this.tiles) return;
    const { error } = this.tiles.status;
    this.onStatus({
      state: 'loading',
      message: error ? `Map server busy, retrying… (${error})` : 'Downloading map data from OpenStreetMap…',
    });
  }

  setupSky() {
    const sky = new Sky();
    sky.scale.setScalar(SKY_SIZE);
    const u = sky.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.0025;
    u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.copy(this.sunDirection);
    this.scene.add(sky);
    this.sky = sky;

    // Image-based lighting from the same sky, so reflections and ambient light match it.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const skyScene = new THREE.Scene();
    const skyCopy = new Sky();
    skyCopy.scale.setScalar(SKY_SIZE);
    skyCopy.material.uniforms = THREE.UniformsUtils.clone(u);
    skyScene.add(skyCopy);
    this.envTarget = pmrem.fromScene(skyScene);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();
    skyCopy.geometry.dispose();
    skyCopy.material.dispose();

    // Fog fades into the sky's horizon colour (from SkyFog); THREE.Fog only provides the distances.
    this.scene.fog = new THREE.Fog(0xffffff, FOG_NEAR, FOG_FAR);
    this.skyFog = new SkyFog(this.renderer, sky);
  }

  setupLights() {
    this.scene.add(new THREE.HemisphereLight(0xcfe0f5, 0x6b6450, 0.3));

    const sun = new THREE.DirectionalLight(0xfff0dd, 3.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    Object.assign(sun.shadow.camera, {
      left: -SHADOW_EXTENT, right: SHADOW_EXTENT, top: SHADOW_EXTENT, bottom: -SHADOW_EXTENT, near: 1, far: 2000,
    });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    this.scene.add(sun, sun.target);
    this.sun = sun;
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

  resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  frame(time) {
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), 1 / 20);

    if (this.tiles) this.tiles.update(this.ready ? this.bird.position : { x: 0, z: 60 }, this.paused ? 0 : dt);

    if (this.ready && !this.paused) {
      const events = this.bird.update(dt, this.input.state, this.tiles);
      if (events.bump) this.shake = 1;
      Object.assign(this.hudFlags, events);
      this.placeCamera(false, dt);
      this.updateShadowCamera();
      this.reportHud(dt);
    }
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
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

  /** Keeps the shadow map centred on the bird, snapped to whole texels so shadows don't shimmer. */
  updateShadowCamera() {
    const lz = this.sunDirection;
    const lx = new THREE.Vector3(0, 1, 0).cross(lz).normalize();
    const ly = lz.clone().cross(lx);
    const texel = (SHADOW_EXTENT * 2) / SHADOW_MAP_SIZE;
    const p = this.bird.position;
    const u = Math.round(p.dot(lx) / texel) * texel;
    const v = Math.round(p.dot(ly) / texel) * texel;
    const center = lx.multiplyScalar(u).addScaledVector(ly, v).addScaledVector(lz, p.dot(lz));
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(lz, 800);
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
    this.envTarget.dispose();
    this.skyFog.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.bird.model.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
    this.renderer.dispose();
  }
}
