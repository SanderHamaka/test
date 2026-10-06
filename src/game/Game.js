import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { createWorld } from './World.js';
import { Bird } from './Bird.js';
import { Input } from './Input.js';
import { SkyFog } from './skyFog.js';

const SUN_ELEVATION = 38;
const SUN_AZIMUTH = 30; // degrees from south (+z) towards east (+x)
const SHADOW_EXTENT = 170;
const SHADOW_MAP_SIZE = 2048;
// The sky box must enclose the base ground plane, and its corners must stay inside the camera's far plane.
const SKY_SIZE = 18000;

export class Game {
  /**
   * @param canvas  canvas element to render into
   * @param data    world buffers produced by the worker
   * @param onHud   called ~10x per second with { altitude, speed, edge, bump }
   */
  constructor(canvas, data, { onHud = () => {} } = {}) {
    this.canvas = canvas;
    this.onHud = onHud;
    this.paused = false;
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
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.8, 18000);

    this.sunDirection = new THREE.Vector3().setFromSphericalCoords(
      1, THREE.MathUtils.degToRad(90 - SUN_ELEVATION), THREE.MathUtils.degToRad(SUN_AZIMUTH),
    );
    this.setupSky(data.radius);
    this.setupLights();

    this.world = createWorld(data);
    this.scene.add(this.world.group);

    this.bird = new Bird();
    this.scene.add(this.bird.model);
    this.spawn();
    this.scene.traverse((o) => o.material && this.skyFog.apply(o.material));

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
  }

  setupSky(radius) {
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

    // Fog that fades into the sky's horizon colour hides the edge of the loaded area.
    // Its colour comes from SkyFog; THREE.Fog only provides the near/far distances.
    this.scene.fog = new THREE.Fog(0xffffff, radius * 0.45, radius * 1.35);
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

  spawn() {
    // Start above the tallest building near the centre, facing north.
    let tallest = 0;
    for (let x = -150; x <= 150; x += 10) {
      for (let z = -150; z <= 150; z += 10) tallest = Math.max(tallest, this.world.colliders.heightAt(x, z));
    }
    this.bird.spawn(0, Math.max(60, tallest + 30), 60, 0);
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

    if (!this.paused) {
      const events = this.bird.update(dt, this.input.state, this.world);
      if (events.bump) this.shake = 1;
      Object.assign(this.hudFlags, events);
      this.placeCamera(false, dt);
      this.updateShadowCamera();
      this.reportHud(dt);
    }
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
    target.y = Math.max(target.y, 1.5);

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
      altitude: p.y - this.world.colliders.heightAt(p.x, p.z),
      speed: this.bird.speed * 3.6,
      edge: !!this.hudFlags.edge,
      bump: !!this.hudFlags.bump,
    });
    this.hudFlags = {};
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.input.dispose();
    this.world.dispose();
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
