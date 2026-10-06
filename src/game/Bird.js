import * as THREE from 'three';

const damp = (current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * dt));

const MIN_SPEED = 7;
const MAX_SPEED = 75;
const CRUISE_SPEED = 20;
const MAX_HEIGHT_ABOVE_GROUND = 700;
const BODY_RADIUS = 0.7;

/**
 * Arcade flight: the bird always moves forward, steering banks it into turns,
 * diving trades height for speed and flapping adds thrust and lift.
 */
export class Bird {
  constructor() {
    this.model = buildModel();
    this.position = new THREE.Vector3();
    this.yaw = 0; // 0 = facing north (-z)
    this.pitch = 0;
    this.roll = 0;
    this.speed = CRUISE_SPEED;
    this.flapPhase = 0;
    this.flapStrength = 0;
    this.tuck = 0;
    this.forward = new THREE.Vector3(0, 0, -1);
  }

  spawn(x, y, z, yaw = 0) {
    this.position.set(x, y, z);
    this.yaw = yaw;
    this.pitch = 0;
    this.roll = 0;
    this.speed = CRUISE_SPEED;
    this.updateForward();
  }

  updateForward() {
    const cp = Math.cos(this.pitch);
    this.forward.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /**
   * @param input { turn: -1..1 (right +), climb: -1..1, flap: bool, dive: bool }
   * @param world { groundAt(x, z), forEachBuildingAt(x, z, fn) }, e.g. the TileManager
   * @returns events that happened this frame, e.g. { bump: true }
   */
  update(dt, input, world) {
    const events = {};
    const previous = this.position.clone();

    // Banking drives turning, like a real bird; the bank itself eases in and out.
    this.roll = damp(this.roll, -input.turn * 0.95, 4, dt);
    this.yaw += this.roll * 1.5 * dt;

    let targetPitch = input.climb * 0.8;
    if (input.dive) targetPitch = -0.95;
    if (this.speed < MIN_SPEED + 3) targetPitch = Math.min(targetPitch, -0.35); // stall: nose drops
    this.pitch = damp(this.pitch, targetPitch, 2.2, dt);

    // Speed: gravity along the flight path, thrust from flapping, drag towards a cruise speed.
    this.speed -= 9.81 * Math.sin(this.pitch) * dt;
    if (input.flap) this.speed += (this.speed < 30 ? 11 : 3) * dt;
    const dragTarget = input.dive ? MAX_SPEED : CRUISE_SPEED;
    this.speed += (dragTarget - this.speed) * (input.dive ? 0.08 : 0.22) * dt;
    this.speed = THREE.MathUtils.clamp(this.speed, MIN_SPEED, MAX_SPEED);

    this.updateForward();
    this.position.addScaledVector(this.forward, this.speed * dt);

    // Gliding slowly loses height; flapping gains it.
    const sink = input.flap ? -3.2 : 1.6 * (1 - Math.min(this.speed / 35, 0.8));
    this.position.y -= sink * dt;

    this.keepAboveGround(dt, world.groundAt(this.position.x, this.position.z));
    this.collide(previous, world, events);
    this.animate(dt, input);
    return events;
  }

  keepAboveGround(dt, ground) {
    const p = this.position;
    if (p.y > ground + MAX_HEIGHT_ABOVE_GROUND) p.y = ground + MAX_HEIGHT_ABOVE_GROUND;
    if (p.y < ground + BODY_RADIUS) {
      p.y = ground + BODY_RADIUS;
      if (this.pitch < 0) this.pitch = 0;
      this.speed = Math.max(MIN_SPEED, this.speed - 10 * dt);
    }
  }

  collide(previous, world, events) {
    const p = this.position;
    world.forEachBuildingAt(p.x, p.z, (minHeight, height, colliders, index) => {
      if (p.y < minHeight - BODY_RADIUS || p.y > height + BODY_RADIUS) return;

      if (previous.y >= height) {
        // Came from above: skim along the roof.
        p.y = height + BODY_RADIUS;
        if (this.pitch < 0) this.pitch = 0;
        return;
      }

      // Hit a wall: push out past the nearest edge and bounce the heading off it.
      const edge = colliders.nearestEdge(index, p.x, p.z);
      let nx = edge.x - p.x;
      let nz = edge.z - p.z;
      const len = Math.hypot(nx, nz) || 1;
      nx /= len;
      nz /= len;
      p.x = edge.x + nx * (BODY_RADIUS + 0.5);
      p.z = edge.z + nz * (BODY_RADIUS + 0.5);

      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const dot = fx * nx + fz * nz;
      if (dot < 0) this.yaw = Math.atan2(-(fx - 2 * dot * nx), -(fz - 2 * dot * nz));
      this.speed = Math.max(MIN_SPEED, this.speed * 0.45);
      events.bump = true;
    });
  }

  animate(dt, input) {
    const m = this.model;
    m.position.copy(this.position);
    m.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');

    this.tuck = damp(this.tuck, input.dive ? 1 : 0, 6, dt);
    this.flapStrength = damp(this.flapStrength, input.flap ? 1 : 0.08, 5, dt);
    this.flapPhase += dt * (input.flap ? 15 : 4);

    const s = Math.sin(this.flapPhase) * this.flapStrength * (1 - this.tuck);
    const glideDihedral = 0.12 * (1 - this.flapStrength);
    for (const side of [-1, 1]) {
      const wing = m.userData.wings[side];
      wing.inner.rotation.z = side * (s * 0.75 + glideDihedral);
      wing.inner.rotation.y = side * -this.tuck * 0.9;
      // The outer section sits inside the mirrored inner group, so it needs no side sign.
      wing.outer.rotation.z = Math.sin(this.flapPhase - 0.7) * 0.5 * this.flapStrength * (1 - this.tuck);
      wing.outer.rotation.y = -this.tuck * 1.2;
    }
  }
}

/** A stylised gull built from primitives. Faces -z, about 2 m wingspan (game scale). */
function buildModel() {
  const root = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.7 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.7, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.6, side: THREE.DoubleSide });
  const beakMaterial = new THREE.MeshStandardMaterial({ color: 0xf0b429, roughness: 0.5 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), white);
  body.scale.set(1, 0.95, 2.6);
  root.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), white);
  head.position.set(0, 0.1, -0.5);
  root.add(head);

  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.22, 8).rotateX(-Math.PI / 2), beakMaterial);
  beak.position.set(0, 0.07, -0.72);
  root.add(beak);

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), dark);
    eye.position.set(side * 0.1, 0.15, -0.58);
    root.add(eye);
  }

  const tailShape = new THREE.Shape([
    new THREE.Vector2(-0.08, 0), new THREE.Vector2(0.08, 0), new THREE.Vector2(0.2, 0.32), new THREE.Vector2(-0.2, 0.32),
  ]);
  const tail = new THREE.Mesh(new THREE.ShapeGeometry(tailShape).rotateX(Math.PI / 2), grey);
  tail.position.set(0, 0.02, 0.4);
  root.add(tail);

  // Wings: an inner and outer section per side, each on its own pivot so the flap can bend at the "elbow".
  const innerShape = new THREE.Shape([
    new THREE.Vector2(0, -0.14), new THREE.Vector2(0.5, -0.12), new THREE.Vector2(0.5, 0.2), new THREE.Vector2(0, 0.24),
  ]);
  const outerShape = new THREE.Shape([
    new THREE.Vector2(0, -0.12), new THREE.Vector2(0.48, -0.02), new THREE.Vector2(0.52, 0.06), new THREE.Vector2(0, 0.2),
  ]);
  const innerGeometry = new THREE.ShapeGeometry(innerShape).rotateX(Math.PI / 2);
  const outerGeometry = new THREE.ShapeGeometry(outerShape).rotateX(Math.PI / 2);

  root.userData.wings = {};
  for (const side of [-1, 1]) {
    const inner = new THREE.Group();
    inner.position.set(side * 0.14, 0.06, -0.08);
    inner.scale.x = side;
    inner.add(new THREE.Mesh(innerGeometry, grey));

    const outer = new THREE.Group();
    outer.position.set(0.5, 0, 0);
    outer.add(new THREE.Mesh(outerGeometry, dark));
    inner.add(outer);

    root.add(inner);
    root.userData.wings[side] = { inner, outer };
  }

  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return root;
}
