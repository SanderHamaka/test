import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Bird, LAND_RANGE } from './Bird.js';
import { FoodManager } from './food.js';
import { Discoveries } from './discoveries.js';
import { Gameplay } from './gameplay.js';
import { Nests } from './nests.js';
import { Hawk } from './hawk.js';
import { Challenges } from './challenges.js';
import { Sound } from './sound.js';
import { FarTerrain } from './farTerrain.js';
import { Clouds } from './clouds.js';
import { Rain } from './rain.js';
import { WEATHER, WeatherState, fetchRealWeather } from './weather.js';
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
   * @param species   entry from SPECIES
   * @param mode      'relaxed' or 'challenge'
   * @param progress  Progress (XP, discoveries), saved in the browser
   * @param onHud     called ~10x per second with flight, progress and compass data
   * @param onStatus  called with { state: 'loading' | 'ready' | 'error', message }
   * @param onNotify  called with (text, kind) for messages to the player
   */
  constructor(canvas, place, {
    demo = false, quality = 'high', weather = 'real', species, mode = 'relaxed', progress,
    onHud = () => {}, onStatus = () => {}, onNotify = () => {},
  } = {}) {
    this.canvas = canvas;
    this.place = place;
    this.onHud = onHud;
    this.onStatus = onStatus;
    // Messages to the player, each with a matching sound.
    this.onNotify = (text, kind) => {
      onNotify(text, kind);
      const sound = { food: 'eat', discovery: 'discover', level: 'level', danger: 'warning' }[kind];
      if (sound) this.sound.play(sound);
    };
    this.sound = new Sound();
    this.sound.unlock(); // allowed: the game starts right after a click
    this.surroundings = null;
    this.surroundingsTimer = 0;
    this.lastBeat = 0;
    this.progress = progress;
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
    this.weather = new WeatherState('clear');
    this.weatherRefresh = 0;
    this.lighting.setWeather(this.weather.current, true);
    this.lighting.setTime(this.date);
    this.clouds = new Clouds(this.scene);
    this.rain = new Rain(this.scene);
    this.setWeatherMode(weather);

    this.prepareMaterial = (material) => {
      this.lighting.skyFog.apply(material);
      return material;
    };

    this.bird = new Bird(species);
    this.food = new FoodManager(this.scene, this.prepareMaterial);
    this.discoveries = new Discoveries(this.scene, progress);
    this.gameplay = new Gameplay({ species, mode, progress, bird: this.bird, notify: this.onNotify });
    this.hawk = this.gameplay.challenge ? new Hawk(this.scene, this.prepareMaterial) : null;
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

    this.far = new FarTerrain(this.scene, this.prepareMaterial, {
      origin: { lat: place.lat, lon: place.lon, elevation }, demo, holeRadius: LOAD_DISTANCE - 100,
    });
    this.nests = new Nests(this.scene, this.prepareMaterial, this.progress, this.tiles.projection, elevation);
    this.challenges = new Challenges(this.scene, this.prepareMaterial, {
      tiles: this.tiles, nests: this.nests, discoveries: this.discoveries, species: this.bird.species,
      notify: this.onNotify, reward: (xp) => this.gameplay.reward(xp), sound: this.sound,
    });

    // Start at your nest if you have one near this place, otherwise above the place itself.
    this.spawnPoint = new THREE.Vector3(0, 0, 60);
    const home = this.nests.homeNear(this.spawnPoint);
    await this.tiles.whenReady(home?.position ?? this.spawnPoint);
    if (this.disposed) return;
    this.respawn();
    if (home) this.onNotify(`Welcome home to your nest (${home.nest.branches} branches).`, 'discovery');
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

  /** Back to your home nest (perched on it) if there is one nearby, else above the starting point. */
  respawn() {
    this.bird.carrying = false;
    const home = this.nests.homeNear(this.bird.model.visible ? this.bird.position : this.spawnPoint);
    if (!home) {
      this.spawn(this.spawnPoint);
      return;
    }
    const p = home.position;
    this.bird.spawn(p.x, p.y + this.bird.rig.standHeight + 0.3, p.z, 0);
    this.bird.state = 'perched';
    this.bird.model.visible = true;
    this.placeCamera(true);
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
    this.sound.setPaused(paused);
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
    const focus = this.ready ? this.bird.position : this.spawnPoint ?? new THREE.Vector3(0, 0, 60);

    if (this.tiles) this.tiles.update(focus, this.paused ? 0 : dt);
    this.far?.update(focus);

    if (this.ready && !this.paused) {
      this.date = new Date(this.date.getTime() + dt * 1000);
      this.updateWeather(dt);
      this.lighting.setTime(this.date);
      this.simulate(dt, this.input.state);
      this.placeCamera(false, dt);
      this.reportHud(dt);
    }
    this.lighting.follow(this.bird.position, this.camera.position);
    this.updateAtmosphere(this.paused ? 0 : dt);
    if (this.ready) this.updateSound(this.paused ? 0 : dt);

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

  // ---- Weather ----

  /** 'real' fetches the current weather at the place; otherwise a preset name from WEATHER. */
  setWeatherMode(mode) {
    this.weatherMode = mode;
    if (mode !== 'real') {
      this.weather.set(WEATHER[mode] ? mode : 'clear');
      return;
    }
    fetchRealWeather(this.place.lat, this.place.lon).then((real) => {
      if (this.disposed || this.weatherMode !== 'real') return;
      if (real) {
        this.weather.set(real.preset, real.wind);
        this.realWeather = real;
      } else {
        this.weather.set('clear');
      }
    });
  }

  updateWeather(dt) {
    const changing = this.weather.update(dt);
    // Re-render reflections and the horizon fog colour every couple of seconds while the weather changes.
    this.weatherRefresh -= dt;
    const refresh = changing && this.weatherRefresh <= 0;
    if (refresh) this.weatherRefresh = 2;
    this.lighting.setWeather(this.weather.current, refresh);
    this.lighting.tick(dt, this.weather.wind.speed);
    const wind = this.weather.windVector();
    this.bird.wind = wind;
  }

  /** Fog (weather, height fog, inside clouds), clouds, rain and street lights; runs every frame. */
  updateAtmosphere(dt) {
    const w = this.weather.current;
    const night = this.lighting.uniforms.night.value;
    const lerp = THREE.MathUtils.lerp;

    if (this.ready) {
      const key = this.lighting.key, sky = this.lighting.hemisphere;
      const lit = key.color.clone().multiplyScalar(key.intensity * 0.6).add(sky.color.clone().multiplyScalar(sky.intensity * 1.4));
      const shade = sky.color.clone().multiplyScalar(sky.intensity * 1.1 + 0.02).lerp(new THREE.Color(0.3, 0.32, 0.36), w.overcast * 0.4 * (1 - night));
      this.clouds.update(dt, this.bird.position, w.cloud, { lit, shade });
    }

    // Inside a cloud bank the world turns white.
    const inside = this.clouds.insideAmount;
    const near = lerp(lerp(FOG_NEAR, 70, w.fog), 4, inside);
    const far = lerp(lerp(FOG_FAR, 520, w.fog), 55, inside);
    this.lighting.setFogDistances(near, far);
    const fog = this.lighting.skyFog.uniforms;
    fog.fogHeightScale.value = lerp(160, 700, Math.max(w.fog, inside));
    fog.fogHazeMax.value = lerp(0.85, 1, Math.max(w.fog, inside));
    fog.fogHazeFar.value = lerp(16000, 2500, Math.max(w.fog * 0.8, inside));
    if (this.tiles) fog.fogBaseY.value = this.tiles.groundAt(this.camera.position.x, this.camera.position.z);

    this.rain.update(dt, this.camera, w.rain, this.weather.windVector(), lerp(1, 0.25, night));
    this.tiles?.resources.setNight(night);
  }

  updateSound(dt) {
    const bird = this.bird;
    const p = bird.position;
    this.surroundingsTimer -= dt;
    if (this.surroundingsTimer <= 0) {
      this.surroundingsTimer = 0.5;
      this.surroundings = this.tiles.surroundings(p.x, p.z);
    }
    // A wing beat starts each time the flap cycle wraps round.
    const beat = Math.floor(bird.anim.phase / (Math.PI * 2));
    const flapped = beat !== this.lastBeat && (bird.flapping || bird.state === 'landing');
    this.lastBeat = beat;
    this.sound.update(dt, {
      speed: bird.speed,
      flapping: bird.flapping,
      beat: flapped,
      diving: bird.anim.tuck > 0.5,
      perched: bird.state === 'perched',
      height: p.y - this.tiles.groundAt(p.x, p.z),
      surroundings: this.surroundings,
      night: this.lighting.uniforms.night.value,
      rain: this.weather.current.rain,
    });
  }

  /** One step of game logic: flight, food, discoveries, nests, the hawk, challenges and rules. */
  simulate(dt, input) {
    this.elapsed = (this.elapsed ?? 0) + dt;
    const bird = this.bird;
    const events = bird.update(dt, input, this.tiles);
    this.buildNest(events);
    this.food.sync(this.tiles);
    this.discoveries.sync(this.tiles);

    // While feeding the chicks, the first food flown through is carried home instead of eaten.
    let eaten = this.food.update(this.elapsed, bird);
    if (eaten.length && this.challenges.wantsFood(bird)) {
      bird.carryingFood = true;
      this.onNotify(`Carrying ${eaten[0] === 'mice' ? 'a mouse' : eaten[0]}: land on your nest to feed the chicks`, 'hint');
      eaten = eaten.slice(1);
    }
    const found = this.discoveries.update(dt, bird);
    if (this.gameplay.update(dt, events, eaten, found).faint) this.respawn();
    this.challenges.update(dt, bird, events);
    this.updateHawk(dt);

    if (events.bump) {
      this.shake = 1;
      this.sound.play('bump');
    }
    if (events.hardLanding) this.shake = 0.5;
    if (events.landed) this.sound.play('land');
    Object.assign(this.hudFlags, events);
  }

  updateHawk(dt) {
    if (!this.hawk) return;
    const h = this.hawk.update(dt, this.bird, this.tiles);
    if (h.appeared) {
      this.onNotify('A hawk is circling overhead. Stay low, or near trees and roofs!', 'danger');
      this.sound.play('hawk');
    }
    if (h.dive) {
      this.onNotify('The hawk is diving! Get low or into a tree!', 'danger');
      this.sound.play('hawk');
    }
    if (h.hit) {
      this.gameplay.hawkHit();
      this.sound.play('hit');
      this.shake = 1.2;
    }
    if (h.escaped) this.gameplay.hawkEscaped();
  }

  // ---- Challenges (started from the challenge board) ----

  challengeOffers() {
    return this.challenges.offers(this.bird);
  }

  startChallenge(offer) {
    this.challenges.start(offer, this.bird);
  }

  cancelChallenge() {
    this.challenges.cancel();
  }

  /** Flying through a tree snaps off a branch; landing with one drops it into (or starts) a nest. */
  buildNest(events) {
    const bird = this.bird;
    const p = bird.position;
    if (bird.state === 'flying' && !bird.carrying && !bird.carryingFood && this.tiles.treeAt(p.x, p.y, p.z)) {
      bird.carrying = true;
      this.gameplay.pickedBranch();
      this.sound.play('branch');
    }
    if (events.landed && bird.carrying) {
      bird.carrying = false;
      this.gameplay.placedBranch(this.nests.addBranch(p.x, p.y - bird.rig.standHeight, p.z));
    }
  }

  /** A compass entry for a world position: distance and bearing relative to the bird's heading. */
  compassMark(position, fields) {
    const dx = position.x - this.bird.position.x, dz = position.z - this.bird.position.z;
    const heading = Math.atan2(-dx, -dz);
    return {
      ...fields,
      distance: Math.hypot(dx, dz),
      relative: Math.atan2(Math.sin(this.bird.yaw - heading), Math.cos(this.bird.yaw - heading)),
    };
  }

  /** Compass entry for the home nest, if there is one within range. */
  homeMark() {
    const home = this.nests.homeNear(this.bird.position, 5000);
    return home ? this.compassMark(home.position, { id: 'home', name: 'Your nest', kind: 'Home', home: true }) : null;
  }

  /** Compass entry for the active challenge's target. */
  targetMark() {
    const target = this.challenges.target(this.bird);
    return target ? this.compassMark(target.position, { id: 'target', name: target.name, kind: 'Challenge', target: true }) : null;
  }

  placeCamera(snap, dt = 0) {
    const bird = this.bird;
    const yawForward = new THREE.Vector3(-Math.sin(bird.yaw), 0, -Math.cos(bird.yaw));
    // Mostly level behind the bird, following its pitch a little, so dives feel steep without making you seasick.
    const back = yawForward.clone().multiplyScalar(-0.7).addScaledVector(bird.forward, -0.3).normalize();
    const target = bird.position.clone()
      .addScaledVector(back, this.cameraDistance)
      .add(new THREE.Vector3(0, this.cameraDistance * 0.28, 0));
    // Keep the camera out of roofs and hills: stay above whatever surface is below it.
    target.y = Math.max(target.y, this.tiles.surfaceAt(target.x, target.z) + 1.5);

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
      weather: WEATHER[this.weather.preset]?.label,
      stamina: this.bird.stamina / this.bird.maxStamina,
      hunger: this.gameplay.challenge ? this.gameplay.hunger / 100 : null,
      state: this.bird.state,
      canLand: this.bird.state === 'flying' && p.y - this.tiles.surfaceAt(p.x, p.z) < LAND_RANGE,
      level: this.progress.level,
      levelProgress: this.progress.levelProgress,
      compass: [this.targetMark(), this.homeMark(), ...this.discoveries.compass].filter(Boolean),
      challenge: this.challenges.status,
      hawk: this.hawk?.alarm ?? null,
      carryingFood: this.bird.carryingFood,
      carrying: this.bird.carrying,
      yaw: this.bird.yaw,
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
    this.food.dispose();
    this.discoveries.dispose();
    this.nests?.dispose();
    this.challenges?.dispose();
    this.hawk?.dispose();
    this.far?.dispose();
    this.clouds.dispose();
    this.rain.dispose();
    this.sound.dispose();
    this.progress.flush();
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
