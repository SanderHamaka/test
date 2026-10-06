import * as THREE from 'three';
import { animateBird, buildBirdModel } from './birdModel.js';

/** A common buzzard: big, brown, streaky belly. Uses the same procedural model as the playable birds. */
const HAWK_LOOK = {
  scale: 1.35, bodyLength: 2.5, wingLength: 1.3, wingWidth: 1.25, tail: 'square',
  body: 0x6b4a32, belly: 0xdccbaa, head: 0x5e432f, back: 0x5a3e2a, wing: 0x6a4a33, wingTip: 0x231a14,
  tailColour: 0x8a6a4c, tailBand: 0x3a2a1e, beak: 0x2c2a28, beakLength: 0.14, beakHook: true, legs: 0xe5c23a,
  eye: 0x6b3a14, spots: 0x3b281b,
};

const EXPOSED_HEIGHT = 25; // above roofs and ground: higher than this in the open, the hawk can strike
const SAFE_HEIGHT = 14; // dropping below this makes a diving hawk give up
const CIRCLE_RADIUS = 70;
const DIVE_SPEED = 46;
const HIT_DISTANCE = 3;

/**
 * Challenge-mode predator. It turns up now and then, circles high above the bird and, if the bird is
 * exposed in open sky, dives at it. Getting low, into the trees, or landing makes it give up.
 * States: away → circling → diving → leaving → away.
 */
export class Hawk {
  constructor(scene, prepareMaterial) {
    const { root, rig } = buildBirdModel(HAWK_LOOK);
    root.traverse((o) => o.material && prepareMaterial(o.material));
    root.visible = false;
    scene.add(root);
    this.model = root;
    this.rig = rig;
    this.state = 'away';
    this.timer = 70 + Math.random() * 40; // first visit after a minute or two
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.angle = 0;
    this.anim = { phase: 0, flap: 0.1, tuck: 0, perch: 0, headTurn: 0, tailSpread: 0.3 };
  }

  /** Whether the bird can be attacked: flying, well above whatever is below, and not inside a tree. */
  exposed(bird, world) {
    if (bird.state !== 'flying') return false;
    const p = bird.position;
    return p.y - world.surfaceAt(p.x, p.z) > EXPOSED_HEIGHT && !world.treeAt(p.x, p.y, p.z);
  }

  /** @returns events this frame: appeared, dive, hit, escaped */
  update(dt, bird, world) {
    const events = {};
    const target = bird.position;
    this.timer -= dt;

    switch (this.state) {
      case 'away':
        if (this.timer <= 0) {
          this.state = 'circling';
          this.timer = 8 + Math.random() * 6;
          this.angle = Math.random() * Math.PI * 2;
          this.position.set(target.x + Math.cos(this.angle) * 400, target.y + 120, target.z + Math.sin(this.angle) * 400);
          this.model.visible = true;
          events.appeared = true;
        }
        break;

      case 'circling': {
        // Drift towards a circle high over the bird.
        this.angle += dt * 0.45;
        const height = Math.max(target.y + 75, world.groundAt(target.x, target.z) + 90);
        const goal = new THREE.Vector3(target.x + Math.cos(this.angle) * CIRCLE_RADIUS, height, target.z + Math.sin(this.angle) * CIRCLE_RADIUS);
        this.steer(goal, 24, dt, 1.2);
        if (this.timer <= 0) {
          if (this.exposed(bird, world)) {
            this.state = 'diving';
            this.timer = 8;
            events.dive = true;
          } else if (this.timer < -30) {
            this.leave();
          }
        }
        break;
      }

      case 'diving': {
        // Aim a little ahead of the bird.
        const lead = bird.forward.clone().multiplyScalar(bird.speed * 0.4);
        this.steer(target.clone().add(lead), DIVE_SPEED, dt, 4);
        const distance = this.position.distanceTo(target);
        if (distance < HIT_DISTANCE) {
          events.hit = true;
          this.leave();
        } else if ((target.y - world.surfaceAt(target.x, target.z) < SAFE_HEIGHT || bird.state !== 'flying' ||
          world.treeAt(target.x, target.y, target.z)) && distance > 12) {
          events.escaped = true;
          this.leave();
        } else if (this.timer <= 0) {
          this.leave();
        }
        break;
      }

      case 'leaving': {
        const away = this.velocity.clone().setY(0).normalize().multiplyScalar(200).add(this.position).setY(this.position.y + 60);
        this.steer(away, 30, dt, 1);
        if (this.timer <= 0) {
          this.state = 'away';
          this.timer = 120 + Math.random() * 90;
          this.model.visible = false;
        }
        break;
      }
    }

    if (this.model.visible) this.pose(dt);
    return events;
  }

  leave() {
    this.state = 'leaving';
    this.timer = 7;
  }

  /** Turns the velocity towards a goal at a given speed; `agility` is how quickly it can turn. */
  steer(goal, speed, dt, agility) {
    const desired = goal.clone().sub(this.position);
    if (desired.lengthSq() > 0.01) desired.setLength(speed);
    this.velocity.lerp(desired, 1 - Math.exp(-agility * dt));
    this.position.addScaledVector(this.velocity, dt);
  }

  pose(dt) {
    const v = this.velocity;
    const horizontal = Math.hypot(v.x, v.z);
    const diving = this.state === 'diving';
    this.anim.tuck += ((diving ? 1 : 0) - this.anim.tuck) * Math.min(1, dt * 5);
    this.anim.flap = this.state === 'leaving' ? 0.8 : 0.1;
    this.anim.phase += dt * (this.state === 'leaving' ? 9 : 2.5);
    animateBird(this.rig, this.anim);

    this.model.position.copy(this.position);
    const yaw = Math.atan2(-v.x, -v.z);
    const pitch = Math.atan2(v.y, horizontal);
    // Bank into the circle.
    const roll = this.state === 'circling' ? 0.45 : 0;
    this.model.rotation.set(pitch, yaw, roll, 'YXZ');
  }

  get alarm() {
    return this.state === 'diving' ? 'diving' : this.state === 'circling' ? 'circling' : null;
  }

  dispose() {
    this.model.removeFromParent();
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
  }
}
