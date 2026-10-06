import * as THREE from 'three';
import { animateBird, buildBirdModel } from './birdModel.js';

const damp = (current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * dt));
const ease = (t) => t * t * (3 - 2 * t);

const MIN_SPEED = 7;
const MAX_HEIGHT_ABOVE_GROUND = 700;
export const LAND_RANGE = 12; // how close above a surface the bird must be to land
const LAND_TIME = 0.7;
const STAMINA_REGEN = { gliding: 3, perched: 22 };
// Touching a surface counts as landing when coming down nose-first or slowly; level flight skims.
const TOUCH_LAND_PITCH = -0.08;
const TOUCH_LAND_SPEED = 12;
// Hitting a wall this close below the roof edge hops the bird up onto the roof.
const LEDGE_HOP = 2.5;

/**
 * Arcade flight: the bird always moves forward, steering banks it into turns, diving trades height
 * for speed and flapping adds thrust and lift but uses stamina. The bird can land on roofs and the
 * ground to rest (state: flying → landing → perched → flying).
 */
export class Bird {
  constructor(species) {
    this.species = species;
    this.stats = species.flight;
    const { root, rig } = buildBirdModel(species.look);
    this.model = root;
    this.rig = rig;
    this.radius = 0.7 * species.look.scale;

    this.position = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.state = 'flying';
    this.yaw = 0; // 0 = facing north (-z)
    this.pitch = 0;
    this.roll = 0;
    this.speed = this.stats.cruise;
    this.stamina = this.stats.stamina;
    this.staminaRegenFactor = 1; // lowered by hunger in challenge mode
    this.canFlap = true; // false when starving in challenge mode
    this.flapping = false;
    this.touchGrace = 0; // seconds after take-off during which touching a surface doesn't land
    this.anim = { phase: 0, flap: 0, tuck: 0, perch: 0, headTurn: 0, tailSpread: 0 };
  }

  get maxStamina() {
    return this.stats.stamina;
  }

  spawn(x, y, z, yaw = 0) {
    this.position.set(x, y, z);
    this.yaw = yaw;
    this.pitch = this.roll = 0;
    this.speed = this.stats.cruise;
    this.state = 'flying';
    this.stamina = this.maxStamina;
    this.updateForward();
  }

  updateForward() {
    const cp = Math.cos(this.pitch);
    this.forward.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /**
   * @param input { turn: -1..1 (right +), climb: -1..1, flap, dive, land (pressed this frame) }
   * @param world { groundAt(x, z), surfaceAt(x, z), forEachBuildingAt(x, z, fn) }, e.g. the TileManager
   * @returns events that happened this frame: bump, landed, tookOff, tooHighToLand
   */
  update(dt, input, world) {
    const events = {};
    if (this.state === 'perched') this.updatePerched(dt, input, world, events);
    else if (this.state === 'landing') this.updateLanding(dt, world, events);
    else this.updateFlying(dt, input, world, events);
    this.animate(dt, input);
    return events;
  }

  updateFlying(dt, input, world, events) {
    const s = this.stats;
    const previous = this.position.clone();
    this.touchGrace = Math.max(0, this.touchGrace - dt);

    if (input.land) {
      const surface = world.surfaceAt(this.position.x, this.position.z);
      if (this.position.y - surface < LAND_RANGE) {
        this.startLanding(this.speed);
        return;
      }
      events.tooHighToLand = true;
    }

    this.flapping = input.flap && this.canFlap && this.stamina > 0;
    if (this.flapping) this.stamina = Math.max(0, this.stamina - s.flapCost * dt);
    else this.stamina = Math.min(this.maxStamina, this.stamina + STAMINA_REGEN.gliding * this.staminaRegenFactor * dt);

    // Banking drives turning, like a real bird; the bank itself eases in and out.
    this.roll = damp(this.roll, -input.turn * 0.95, 4, dt);
    this.yaw += this.roll * 1.5 * s.turn * dt;

    let targetPitch = input.climb * 0.8;
    if (input.dive) targetPitch = -0.95;
    if (this.speed < MIN_SPEED + 3) targetPitch = Math.min(targetPitch, -0.35); // stall: nose drops
    this.pitch = damp(this.pitch, targetPitch, 2.2, dt);

    // Speed: gravity along the flight path, thrust from flapping, drag towards cruise speed.
    this.speed -= 9.81 * Math.sin(this.pitch) * dt;
    if (this.flapping) this.speed += (this.speed < s.cruise * 1.6 ? s.flapThrust : 3) * dt;
    const dragTarget = input.dive ? s.maxSpeed : s.cruise;
    this.speed += (dragTarget - this.speed) * (input.dive ? 0.08 : 0.22) * dt;
    this.speed = THREE.MathUtils.clamp(this.speed, MIN_SPEED, s.maxSpeed);

    this.updateForward();
    this.position.addScaledVector(this.forward, this.speed * dt);

    // Gliding slowly loses height (less when fast); flapping gains it.
    const sink = this.flapping ? -s.lift : s.sink * 1.4 * (1 - Math.min(this.speed / 35, 0.7));
    this.position.y -= sink * dt;

    this.keepAboveGround(dt, world.groundAt(this.position.x, this.position.z), events);
    if (this.state === 'flying') this.collide(previous, world, events);
  }

  /** Begins the landing animation; `speed` is how fast the bird drifts forward while settling. */
  startLanding(speed) {
    this.state = 'landing';
    this.landing = { t: 0, fromY: this.position.y, speed };
  }

  /** Whether touching a surface right now should count as landing rather than skimming. */
  get wantsToLand() {
    if (this.touchGrace > 0) return false;
    return this.pitch < TOUCH_LAND_PITCH || this.speed < TOUCH_LAND_SPEED;
  }

  /** Lands after touching a surface; a fast touchdown is reported so the camera can shake. */
  touchDown(events, drift) {
    if (this.speed > 25) events.hardLanding = true;
    this.startLanding(Math.min(this.speed, drift));
  }

  updateLanding(dt, world, events) {
    const l = this.landing;
    l.t = Math.min(1, l.t + dt / LAND_TIME);
    // Drift forward while braking, then settle onto whatever is below.
    this.speed = l.speed * (1 - ease(l.t));
    this.pitch = damp(this.pitch, 0.25 * (1 - l.t), 6, dt);
    this.roll = damp(this.roll, 0, 6, dt);
    this.updateForward();
    this.position.x += this.forward.x * this.speed * dt;
    this.position.z += this.forward.z * this.speed * dt;
    const target = world.surfaceAt(this.position.x, this.position.z) + this.rig.standHeight;
    this.position.y = THREE.MathUtils.lerp(l.fromY, target, ease(l.t));
    if (l.t >= 1) {
      this.state = 'perched';
      this.speed = 0;
      this.pitch = 0;
      events.landed = true;
    }
  }

  updatePerched(dt, input, world, events) {
    this.stamina = Math.min(this.maxStamina, this.stamina + STAMINA_REGEN.perched * this.staminaRegenFactor * dt);
    this.yaw -= input.turn * 1.6 * dt;
    this.updateForward();
    this.position.y = world.surfaceAt(this.position.x, this.position.z) + this.rig.standHeight;

    if ((input.flap && this.canFlap) || input.climb > 0 || input.land) {
      this.state = 'flying';
      this.speed = Math.max(this.stats.cruise * 0.7, TOUCH_LAND_SPEED + 1);
      this.pitch = 0.55;
      this.position.y += 0.5;
      this.touchGrace = 0.8;
      events.tookOff = true;
    }
  }

  keepAboveGround(dt, ground, events) {
    const p = this.position;
    if (p.y > ground + MAX_HEIGHT_ABOVE_GROUND) p.y = ground + MAX_HEIGHT_ABOVE_GROUND;
    if (p.y < ground + this.radius) {
      p.y = ground + this.radius;
      if (this.wantsToLand) {
        this.touchDown(events, 6);
        return;
      }
      if (this.pitch < 0) this.pitch = 0;
      this.speed = Math.max(MIN_SPEED, this.speed - 10 * dt);
    }
  }

  collide(previous, world, events) {
    const p = this.position;
    const r = this.radius;
    world.forEachBuildingAt(p.x, p.z, (bottom, top, colliders, index) => {
      if (this.state !== 'flying' || p.y < bottom - r || p.y > top + r) return;

      if (previous.y >= top) {
        // Came from above: land if heading down, otherwise skim along the roof.
        p.y = top + r;
        if (this.wantsToLand) this.touchDown(events, 6);
        else if (this.pitch < 0) this.pitch = 0;
        return;
      }

      if (top - p.y < LEDGE_HOP && p.y > bottom) {
        // Clipped the top of a wall: hop up onto the roof instead of bouncing off.
        this.touchDown(events, 4);
        return;
      }

      // Hit a wall: push out past the nearest edge and bounce the heading off it.
      const edge = colliders.nearestEdge(index, p.x, p.z);
      let nx = edge.x - p.x;
      let nz = edge.z - p.z;
      const len = Math.hypot(nx, nz) || 1;
      nx /= len;
      nz /= len;
      p.x = edge.x + nx * (r + 0.5);
      p.z = edge.z + nz * (r + 0.5);

      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const dot = fx * nx + fz * nz;
      if (dot < 0) this.yaw = Math.atan2(-(fx - 2 * dot * nx), -(fz - 2 * dot * nz));
      this.speed = Math.max(MIN_SPEED, this.speed * 0.45);
      events.bump = true;
    });
  }

  animate(dt, input) {
    const a = this.anim;
    const perched = this.state === 'perched' ? 1 : this.state === 'landing' ? ease(this.landing.t) : 0;
    a.perch = damp(a.perch, perched, 8, dt);
    a.tuck = damp(a.tuck, input.dive && this.state === 'flying' ? 1 : 0, 6, dt);
    const flapping = this.flapping && this.state === 'flying';
    // While landing the wings beat to brake.
    a.flap = damp(a.flap, flapping ? 1 : this.state === 'landing' ? 0.7 : 0.08, 5, dt);
    a.phase += dt * (flapping ? 15 : this.state === 'landing' ? 18 : 4);
    a.tailSpread = damp(a.tailSpread, this.state === 'landing' ? 1 : Math.abs(this.roll), 4, dt);
    a.headTurn = damp(a.headTurn, this.state === 'perched' ? Math.sin(performance.now() / 1300) * 0.6 : this.roll * 0.4, 3, dt);
    animateBird(this.rig, a);

    this.model.position.copy(this.position);
    this.model.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
  }
}
