import * as THREE from 'three';
import { animateBird, buildBirdModel } from './birdModel.js';
import { SPECIES } from './species.js';

// Other players are drawn slightly in the past, between two received states, so they move smoothly
// although states only arrive ten times a second. Past the newest state they glide on for a moment.
const DELAY_MS = 150;
const EXTRAPOLATE_MS = 600;
const KEEP = 20; // states kept per player
const TAG_RANGE = 3000;

export const STATES = ['flying', 'landing', 'perched'];
// Bits in a state's `f` field.
export const FLAG = { flap: 1, dive: 2, twig: 4, food: 8, paused: 16 };

const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;

/** The other birds in the room: models, smooth movement, wing animation and name tags. */
export class Peers {
  /**
   * @param tagLayer  element to put name tags in (absolutely positioned over the canvas), or null
   */
  constructor(scene, prepareMaterial, tagLayer) {
    this.scene = scene;
    this.prepareMaterial = prepareMaterial;
    this.tagLayer = tagLayer;
    this.entries = new Map();
    this.projected = new THREE.Vector3();
  }

  add({ id, name, species }) {
    this.remove(id);
    const kind = SPECIES.find((s) => s.id === species) ?? SPECIES[0];
    const { root, rig } = buildBirdModel(kind.look);
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      this.prepareMaterial(o.material);
    });
    root.visible = false;
    rig.twig.visible = rig.morsel.visible = false;
    this.scene.add(root);

    let tag = null;
    if (this.tagLayer) {
      tag = document.createElement('div');
      tag.className = 'peer-tag';
      tag.innerHTML = '<b></b><small></small>';
      tag.firstChild.textContent = name;
      this.tagLayer.append(tag);
    }
    const entry = {
      id, name, species: kind, model: root, rig, tag, states: [],
      position: new THREE.Vector3(), pitch: 0, yaw: 0, roll: 0, state: 'flying', flags: 0,
      anim: { phase: Math.random() * 6, flap: 0, tuck: 0, perch: 0, headTurn: 0, tailSpread: 0 },
    };
    this.entries.set(id, entry);
    return entry;
  }

  rename(id, name) {
    const e = this.entries.get(id);
    if (!e) return;
    e.name = name;
    if (e.tag) e.tag.firstChild.textContent = name;
  }

  remove(id) {
    const e = this.entries.get(id);
    if (!e) return;
    e.model.removeFromParent();
    e.model.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      o.material.dispose();
    });
    e.tag?.remove();
    this.entries.delete(id);
  }

  clear() {
    for (const id of [...this.entries.keys()]) this.remove(id);
  }

  /** A state message { p, r, sp, st, f } from player `id`. */
  onState(id, s, now = performance.now()) {
    const e = this.entries.get(id);
    if (!e || !Array.isArray(s.p) || !Array.isArray(s.r)) return;
    e.states.push({ t: now, p: s.p, r: s.r, sp: s.sp ?? 0, st: s.st ?? 0, f: s.f ?? 0 });
    if (e.states.length > KEEP) e.states.shift();
  }

  /** Moves, animates and labels every bird for this frame. */
  update(dt, camera, now = performance.now()) {
    const width = this.tagLayer?.clientWidth ?? 0, height = this.tagLayer?.clientHeight ?? 0;
    for (const e of this.entries.values()) {
      if (!e.states.length) continue;
      this.pose(e, now - DELAY_MS);
      this.animate(e, dt);
      e.model.visible = true;
      if (e.tag) this.placeTag(e, camera, width, height);
    }
  }

  /** Interpolates between the two states around time t, or glides on from the newest. */
  pose(e, t) {
    const states = e.states;
    let a = states[0], b = null;
    for (let i = states.length - 1; i >= 0; i--) {
      if (states[i].t <= t) {
        a = states[i];
        b = states[i + 1] ?? null;
        break;
      }
    }
    if (b) {
      const k = (t - a.t) / Math.max(1, b.t - a.t);
      e.position.set(
        THREE.MathUtils.lerp(a.p[0], b.p[0], k),
        THREE.MathUtils.lerp(a.p[1], b.p[1], k),
        THREE.MathUtils.lerp(a.p[2], b.p[2], k),
      );
      e.pitch = THREE.MathUtils.lerp(a.r[0], b.r[0], k);
      e.yaw = lerpAngle(a.r[1], b.r[1], k);
      e.roll = THREE.MathUtils.lerp(a.r[2], b.r[2], k);
    } else {
      // Newest state (or before the first one): continue along the heading for a little while.
      const ahead = STATES[a.st] === 'flying' ? Math.min(Math.max(0, t - a.t), EXTRAPOLATE_MS) / 1000 : 0;
      const [pitch, yaw, roll] = a.r;
      const cp = Math.cos(pitch);
      e.position.set(
        a.p[0] - Math.sin(yaw) * cp * a.sp * ahead,
        a.p[1] + Math.sin(pitch) * a.sp * ahead,
        a.p[2] - Math.cos(yaw) * cp * a.sp * ahead,
      );
      e.pitch = pitch;
      e.yaw = yaw;
      e.roll = roll;
    }
    const latest = states[states.length - 1];
    e.state = STATES[latest.st] ?? 'flying';
    e.flags = latest.f;
  }

  animate(e, dt) {
    const a = e.anim;
    const flapping = !!(e.flags & FLAG.flap) && e.state === 'flying';
    a.perch = damp(a.perch, e.state === 'perched' ? 1 : e.state === 'landing' ? 0.6 : 0, 8, dt);
    a.tuck = damp(a.tuck, e.flags & FLAG.dive && e.state === 'flying' ? 1 : 0, 6, dt);
    a.flap = damp(a.flap, flapping ? 1 : e.state === 'landing' ? 0.7 : 0.08, 5, dt);
    a.phase += dt * (flapping ? 15 : e.state === 'landing' ? 18 : 4);
    a.tailSpread = damp(a.tailSpread, e.state === 'landing' ? 1 : Math.abs(e.roll), 4, dt);
    a.headTurn = damp(a.headTurn, e.state === 'perched' ? Math.sin(performance.now() / 1300 + e.id) * 0.6 : e.roll * 0.4, 3, dt);
    animateBird(e.rig, a);
    e.rig.twig.visible = !!(e.flags & FLAG.twig);
    e.rig.morsel.visible = !!(e.flags & FLAG.food);
    e.model.position.copy(e.position);
    e.model.rotation.set(e.pitch, e.yaw, e.roll, 'YXZ');
  }

  placeTag(e, camera, width, height) {
    const distance = camera.position.distanceTo(e.position);
    const p = this.projected.copy(e.position);
    p.y += 1.6 * e.species.look.scale;
    p.project(camera);
    const visible = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1 && distance < TAG_RANGE;
    e.tag.style.display = visible ? '' : 'none';
    if (!visible) return;
    e.tag.style.transform = `translate(${((p.x + 1) / 2) * width}px, ${((1 - p.y) / 2) * height}px) translate(-50%, -100%)`;
    const label = (e.flags & FLAG.paused ? 'paused · ' : '') + (distance < 40 ? '' : distance < 1000 ? `${Math.round(distance / 10) * 10} m` : `${(distance / 1000).toFixed(1)} km`);
    if (e.tag.lastChild.textContent !== label) e.tag.lastChild.textContent = label;
  }

  /** Positions of the other birds, for the compass and for placing a newcomer. */
  list() {
    return [...this.entries.values()].filter((e) => e.states.length).map((e) => ({ id: e.id, name: e.name, position: e.position, yaw: e.yaw }));
  }

  dispose() {
    this.clear();
  }
}
