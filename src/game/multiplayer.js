import * as THREE from 'three';
import { Net } from './net.js';
import { FLAG, Peers, STATES } from './peers.js';
import { WEATHER } from './weather.js';

const SEND_INTERVAL = 0.1; // seconds: ten states a second
const ENV_INTERVAL = 0.15; // dragging the sun sends at most this often
const RACE_COUNTDOWN = 15; // seconds before a race with friends starts
const MAX_RINGS = 40;

const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;
const ordinal = (n) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};
const formatTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Flying together: connects the game to a room on the relay, sends the bird's state ten times a second,
 * draws the other birds, keeps time of day and weather in step, places newcomers beside a friend and
 * runs races between everyone in the room.
 *
 * Every browser builds the world itself from the same place, so positions can be shared as they are.
 */
export class Multiplayer {
  constructor(game, { room, name, tagLayer }) {
    this.game = game;
    this.room = room;
    this.peers = new Peers(game.scene, game.prepareMaterial, tagLayer);
    this.sendTimer = 0;
    this.envTimer = 0;
    this.envDirty = false;
    this.finishes = new Map(); // race id → [{ name, seconds, me }]
    this.welcomed = new Promise((resolve) => (this.resolveWelcome = resolve));

    this.net = new Net({
      room,
      name,
      species: game.bird.species.id,
      handlers: {
        welcome: (m) => this.onWelcome(m),
        join: (m) => {
          this.peers.add(m);
          this.say(`${m.name} joined`);
        },
        leave: (m) => {
          const e = this.peers.entries.get(m.id);
          if (e) this.say(`${e.name} left`);
          this.peers.remove(m.id);
        },
        s: (m) => this.peers.onState(m.id, m),
        env: (m) => this.onEnv(m),
        name: (m) => {
          const e = this.peers.entries.get(m.id);
          if (e && e.name !== m.name) this.say(`${e.name} is now called ${m.name}`);
          this.peers.rename(m.id, m.name);
        },
        race: (m) => this.onRace(m),
        finish: (m) => this.onFinish(m),
        disconnect: () => this.peers.clear(),
      },
    });
  }

  say(text) {
    this.game.onNotify(text, 'friend');
  }

  nameOf(id) {
    return this.peers.entries.get(id)?.name ?? 'Someone';
  }

  onWelcome(m) {
    this.peers.clear();
    for (const p of m.peers) {
      this.peers.add(p);
      if (p.last) this.peers.onState(p.id, p.last);
    }
    // The room's time and weather win; the first bird in a room brings its own.
    if (m.env) this.game.applyEnv(m.env);
    else this.envDirty = true;
    if (m.peers.length) {
      const names = m.peers.map((p) => p.name);
      this.say(`Flying with ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}`);
    }
    this.resolveWelcome(true);
  }

  /** Waits for the relay to answer (or gives up after `ms`), so a newcomer can start beside a friend. */
  waitForWelcome(ms) {
    return Promise.race([this.welcomed, new Promise((resolve) => setTimeout(() => resolve(false), ms))]);
  }

  /** Just behind a friend's right wing, facing the same way. */
  spawnBeside() {
    // The newest received state: birds aren't posed (interpolated) until the game is running.
    const friend = [...this.peers.entries.values()].find((e) => e.states.length);
    if (!friend) return null;
    const latest = friend.states[friend.states.length - 1];
    const p = { x: latest.p[0], y: latest.p[1], z: latest.p[2] };
    const yaw = latest.r[1];
    const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const back = { x: Math.sin(yaw), z: Math.cos(yaw) };
    return {
      name: friend.name,
      position: new THREE.Vector3(p.x + right.x * 25 + back.x * 15, p.y + 4, p.z + right.z * 25 + back.z * 15),
      yaw,
    };
  }

  // ---- Time and weather ----

  /** Called when the player changes the time or weather; sent shortly after (dragging the sun sends a stream). */
  shareEnv() {
    this.envDirty = true;
  }

  onEnv(m) {
    const before = this.game.envState();
    this.game.applyEnv(m);
    const who = this.nameOf(m.id);
    if (m.wx !== before.wx) {
      this.say(`${who} changed the weather to ${m.wx === 'real' ? 'the real weather' : WEATHER[m.wx]?.label ?? m.wx}`);
    } else if (Math.abs(m.offset - before.offset) > 5 * 60000) {
      const h = this.game.solarHour;
      this.say(`${who} set the time to ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`);
    }
  }

  // ---- Races with friends ----

  /** Starts a race along a planned route for everyone in the room, after a countdown. */
  startRace(plan) {
    const rings = plan.rings.slice(0, MAX_RINGS);
    const race = {
      rid: `${this.net.id}-${Date.now() % 1e7}`,
      rings: rings.map((r) => [round(r.position.x, 1), round(r.position.y, 1), round(r.position.z, 1), round(r.yaw, 2)]),
      time: Math.round(plan.time * (rings.length / plan.rings.length) * 1.25),
      countdown: RACE_COUNTDOWN,
    };
    this.net.send({ t: 'race', ...race });
    this.finishes.set(race.rid, []);
    this.game.challenges.startShared({ ...race, rings }, this.game.bird, null);
  }

  onRace(m) {
    if (!Array.isArray(m.rings) || !m.rings.length) return;
    const who = this.nameOf(m.id);
    this.finishes.set(m.rid, []);
    const busy = this.game.challenges.active;
    if (busy) {
      this.say(`${who} started a race, but you're busy with ${busy.title}`);
      return;
    }
    const rings = m.rings.map(([x, y, z, yaw]) => ({ position: new THREE.Vector3(x, y, z), yaw }));
    this.game.challenges.startShared({ rid: m.rid, rings, time: m.time, countdown: m.countdown }, this.game.bird, who);
  }

  /** Our own finish, from Challenges. */
  finished(rid, seconds) {
    this.net.send({ t: 'finish', rid, seconds: round(seconds, 2) });
    const list = this.finishes.get(rid) ?? [];
    list.push({ name: this.net.name, seconds, me: true });
    this.finishes.set(rid, list);
    if (this.peers.entries.size) this.say(`You came ${ordinal(list.length)} in ${formatTime(seconds)}`);
  }

  onFinish(m) {
    const list = this.finishes.get(m.rid);
    if (!list) return;
    const name = this.nameOf(m.id);
    list.push({ name, seconds: m.seconds });
    this.say(`${name} finished the race ${ordinal(list.length)} in ${formatTime(m.seconds)}`);
  }

  // ---- Every frame ----

  update(dt, camera) {
    const net = this.net;
    this.envTimer -= dt;
    if (this.envDirty && net.online && this.envTimer <= 0) {
      this.envDirty = false;
      this.envTimer = ENV_INTERVAL;
      net.send({ t: 'env', ...this.game.envState() });
    }

    this.sendTimer -= dt;
    if (net.online && this.sendTimer <= 0) {
      this.sendTimer = SEND_INTERVAL;
      const b = this.game.bird;
      const flags = (b.flapping ? FLAG.flap : 0) | (b.anim.tuck > 0.5 ? FLAG.dive : 0) | (b.carrying ? FLAG.twig : 0)
        | (b.carryingFood ? FLAG.food : 0) | (this.game.paused ? FLAG.paused : 0);
      net.send({
        t: 's',
        p: [round(b.position.x, 2), round(b.position.y, 2), round(b.position.z, 2)],
        r: [round(b.pitch, 3), round(b.yaw, 3), round(b.roll, 3)],
        sp: round(b.speed, 1),
        st: Math.max(0, STATES.indexOf(b.state)),
        f: flags,
      });
    }
    this.peers.update(dt, camera);
  }

  /** Compass entries for the other birds. */
  compass() {
    return this.peers.list().map((p) => this.game.compassMark(p.position, { id: `peer-${p.id}`, name: p.name, kind: 'Friend', friend: true }));
  }

  /** For the HUD: connection state and who's here. */
  get status() {
    return {
      room: this.room,
      name: this.net.name,
      status: this.net.status,
      others: [...this.peers.entries.values()].map((e) => e.name),
    };
  }

  rename(name) {
    this.net.rename(name);
  }

  dispose() {
    this.net.close();
    this.peers.dispose();
  }
}
