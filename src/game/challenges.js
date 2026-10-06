import * as THREE from 'three';

const RING_RADIUS = 6;
const RING_SPACING = 150;
const RACE_LENGTH = 1300;
const SPRINT_RANGE = [600, 2000];
const SPRINT_REACH = 70;
const FEED_RANGE = 1500;
const FEED_GOAL = 3;
const FEED_TIME = 6 * 60;
const VISIBLE_RINGS = 3;

/**
 * Optional challenges the player starts themselves:
 *  - race:   fly through rings that follow real streets and canals before the clock runs out
 *  - sprint: reach a named landmark in time
 *  - feed:   bring food to your home nest; flying through food carries it instead of eating it
 */
export class Challenges {
  constructor(scene, prepareMaterial, { tiles, nests, discoveries, species, notify, reward, sound, progress }) {
    Object.assign(this, { scene, tiles, nests, discoveries, species, notify, reward, sound, progress });
    this.active = null;
    this.rings = new THREE.Group();
    scene.add(this.rings);
    this.ringGeometry = new THREE.TorusGeometry(RING_RADIUS, 0.45, 10, 48);
    this.nextMaterial = prepareMaterial(new THREE.MeshStandardMaterial({
      color: 0xf0b429, emissive: 0xf0b429, emissiveIntensity: 0.6, roughness: 0.4,
    }));
    this.laterMaterial = prepareMaterial(new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.15, transparent: true, opacity: 0.45, roughness: 0.4,
    }));
  }

  /** What can be started right now, with a reason when something isn't available. */
  offers(bird) {
    const route = this.planRace(bird);
    const sprint = this.pickSprint(bird);
    const home = this.nests.homeNear(bird.position, FEED_RANGE);
    return [
      {
        type: 'race', title: 'Street race', available: !!route,
        text: route
          ? `${route.rings.length} rings along ${route.water ? 'the water and ' : ''}the streets, ${Math.round(route.time)} seconds.`
          : 'No streets or canals nearby to race along. Try it over town.',
        plan: route,
      },
      {
        type: 'sprint', title: 'Landmark sprint', available: !!sprint,
        text: sprint ? `Reach ${sprint.landmark.name} in ${Math.round(sprint.time)} seconds.` : 'No landmarks at the right distance. Fly around a bit first.',
        plan: sprint,
      },
      {
        type: 'feed', title: 'Feed the chicks', available: !!home,
        text: home
          ? `Bring ${FEED_GOAL} meals to your nest within ${FEED_TIME / 60} minutes. Fly through food to carry it, then land on the nest.`
          : 'You need a home nest nearby (5 branches) for this one.',
      },
    ];
  }

  start(offer, bird) {
    if (!offer.available) return;
    this.cancel(false);
    const base = { type: offer.type, title: offer.title, elapsed: 0 };
    if (offer.type === 'race') {
      this.active = { ...base, rings: offer.plan.rings, next: 0, timeLimit: offer.plan.time };
      this.buildRings();
    } else if (offer.type === 'sprint') {
      this.active = { ...base, landmark: offer.plan.landmark, timeLimit: offer.plan.time };
    } else if (offer.type === 'feed') {
      this.active = { ...base, delivered: 0, timeLimit: FEED_TIME };
    }
    bird.carryingFood = false;
    this.notify(`${offer.title}: go!`, 'discovery');
    this.sound.play('warning');
  }

  cancel(say = true) {
    if (!this.active) return;
    if (say) this.notify(`${this.active.title} abandoned`, 'hint');
    this.active = null;
    this.clearRings();
  }

  /** While feeding the chicks, the next food flown through is carried rather than eaten. */
  wantsFood(bird) {
    return this.active?.type === 'feed' && !bird.carryingFood && !bird.carrying;
  }

  update(dt, bird, events) {
    const a = this.active;
    if (!a) return;
    a.elapsed += dt;
    const p = bird.position;

    if (a.type === 'race') {
      const ring = a.rings[a.next];
      if (ring && p.distanceTo(ring.position) < RING_RADIUS + 1.5) {
        a.next++;
        this.sound.play('ring');
        if (a.next >= a.rings.length) return this.succeed(80 + Math.max(0, Math.round(a.timeLimit - a.elapsed)) * 2);
        this.buildRings();
      }
    } else if (a.type === 'sprint') {
      const l = a.landmark;
      if (Math.hypot(l.x - p.x, l.z - p.z) < SPRINT_REACH && p.y - l.y < 200) {
        return this.succeed(60 + Math.max(0, Math.round(a.timeLimit - a.elapsed)));
      }
    } else if (a.type === 'feed') {
      const home = this.nests.homeNear(p, FEED_RANGE);
      if (events.landed && bird.carryingFood && home && home.position.distanceTo(p) < 4) {
        bird.carryingFood = false;
        a.delivered++;
        this.reward(25);
        this.sound.play('eat');
        if (a.delivered >= FEED_GOAL) return this.succeed(100);
        this.notify(`The chicks are fed (${a.delivered}/${FEED_GOAL}) +25 XP`, 'food');
      }
    }

    if (a.elapsed > a.timeLimit) {
      this.notify(`Out of time: ${a.title} failed. Try again with C.`, 'danger');
      this.sound.play('fail');
      this.cancel(false);
    }
  }

  succeed(xp) {
    this.progress?.recordChallenge(this.active.type, this.active.elapsed);
    this.notify(`${this.active.title} complete! +${xp} XP`, 'level');
    this.sound.play('success');
    this.reward(xp);
    this.active = null;
    this.clearRings();
  }

  /** Status line for the HUD. */
  get status() {
    const a = this.active;
    if (!a) return null;
    const detail = a.type === 'race' ? `Ring ${a.next + 1} of ${a.rings.length}`
      : a.type === 'sprint' ? `Reach ${a.landmark.name}`
        : `Meals delivered ${a.delivered}/${FEED_GOAL}`;
    return { title: a.title, detail, timeLeft: Math.max(0, a.timeLimit - a.elapsed) };
  }

  /** Compass target for the active challenge, as a world position with a name. */
  target(bird) {
    const a = this.active;
    if (!a) return null;
    if (a.type === 'race') return { name: `Ring ${a.next + 1}`, position: a.rings[a.next].position };
    if (a.type === 'sprint') return { name: a.landmark.name, position: new THREE.Vector3(a.landmark.x, a.landmark.y, a.landmark.z) };
    if (bird.carryingFood) {
      const home = this.nests.homeNear(bird.position, FEED_RANGE);
      return home ? { name: 'Your nest', position: home.position } : null;
    }
    return null;
  }

  // ---- Race planning ----

  /**
   * Follows connected streets/waterways from near the bird, roughly in its flying direction, turning at
   * junctions now and then, and drops a ring every RING_SPACING metres.
   */
  planRace(bird) {
    const graph = this.routeGraph();
    const p = bird.position;
    let start = null;
    for (const [key, list] of graph.vertices) {
      const [x, z] = key.split(',').map(Number);
      const d = Math.hypot(x * 2 - p.x, z * 2 - p.z);
      if (d < 300 && (!start || d < start.d)) start = { d, ...list[0] };
    }
    if (!start) return null;

    // Walk the network.
    const path = [];
    let { route, index } = start;
    let dir = 1;
    const pts = (r) => r.points;
    const at = (r, i) => [pts(r)[i * 2], pts(r)[i * 2 + 1]];
    const count = (r) => pts(r).length / 2;
    // Start in the direction closest to where the bird is heading.
    if (index + 1 < count(route) && index > 0) {
      const [ax, az] = at(route, index), [bx, bz] = at(route, index + 1);
      if ((bx - ax) * bird.forward.x + (bz - az) * bird.forward.z < 0) dir = -1;
    } else if (index > 0) dir = -1;

    let length = 0;
    let water = route.kind === 'waterway';
    const visited = new Set();
    path.push(at(route, index));
    for (let steps = 0; steps < 2000 && length < RACE_LENGTH; steps++) {
      const nextIndex = index + dir;
      if (nextIndex < 0 || nextIndex >= count(route)) {
        // End of this way: continue on a connected one if there is any.
        const options = (graph.vertices.get(keyOf(...at(route, index))) ?? []).filter((o) => o.route !== route);
        if (!options.length) break;
        ({ route, index } = options[Math.floor(Math.random() * options.length)]);
        dir = index === 0 ? 1 : index === count(route) - 1 ? -1 : Math.random() < 0.5 ? 1 : -1;
        continue;
      }
      const [x0, z0] = at(route, index), [x1, z1] = at(route, nextIndex);
      length += Math.hypot(x1 - x0, z1 - z0);
      index = nextIndex;
      path.push([x1, z1]);
      const key = keyOf(x1, z1);
      if (visited.has(key)) break;
      visited.add(key);

      // At a junction, sometimes turn onto the other way (if the turn isn't too sharp).
      const others = (graph.vertices.get(key) ?? []).filter((o) => o.route !== route);
      if (others.length && Math.random() < 0.35) {
        const o = others[Math.floor(Math.random() * others.length)];
        const choices = [1, -1].filter((d) => o.index + d >= 0 && o.index + d < count(o.route));
        const heading = [x1 - x0, z1 - z0];
        const best = choices.map((d) => {
          const [nx, nz] = at(o.route, o.index + d);
          return { d, turn: angleBetween(heading, [nx - x1, nz - z1]) };
        }).filter((c) => c.turn < 1.8).sort(() => Math.random() - 0.5)[0];
        if (best) {
          route = o.route;
          index = o.index;
          dir = best.d;
          water ||= route.kind === 'waterway';
        }
      }
    }
    if (length < 600) return null;

    const rings = this.ringsAlong(path);
    if (rings.length < 4) return null;
    const time = (length / (this.species.flight.cruise * 1.05)) + 20;
    return { rings, time, water };
  }

  ringsAlong(path) {
    const rings = [];
    let carry = 80; // first ring a little way in
    for (let i = 0; i < path.length - 1; i++) {
      const [x0, z0] = path[i], [x1, z1] = path[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      for (let d = carry; d < len; d += RING_SPACING) {
        const x = x0 + ((x1 - x0) * d) / len, z = z0 + ((z1 - z0) * d) / len;
        const ground = this.tiles.groundAt(x, z);
        let y = ground + 12;
        const surface = this.tiles.surfaceAt(x, z);
        if (surface > y - RING_RADIUS) y = surface + RING_RADIUS + 3; // not inside a building
        rings.push({ position: new THREE.Vector3(x, y, z), yaw: Math.atan2(x1 - x0, z1 - z0) });
      }
      carry = ((carry - len) % RING_SPACING + RING_SPACING) % RING_SPACING;
    }
    return rings;
  }

  /** All loaded routes, indexed by vertex position so connected ways can be found. */
  routeGraph() {
    const routes = new Map();
    for (const { tile } of this.tiles.tiles.values()) for (const r of tile.routes) routes.set(r.id, r);
    const vertices = new Map();
    for (const route of routes.values()) {
      for (let i = 0; i < route.points.length / 2; i++) {
        const key = keyOf(route.points[i * 2], route.points[i * 2 + 1]);
        if (!vertices.has(key)) vertices.set(key, []);
        vertices.get(key).push({ route, index: i });
      }
    }
    return { routes, vertices };
  }

  pickSprint(bird) {
    const p = bird.position;
    const candidates = [...this.discoveries.landmarks.values()].filter((l) => {
      const d = Math.hypot(l.x - p.x, l.z - p.z);
      return d > SPRINT_RANGE[0] && d < SPRINT_RANGE[1];
    });
    if (!candidates.length) return null;
    // Keep the offer stable while the board is open: pick by a slowly changing seed.
    const landmark = candidates[Math.floor((Date.now() / 60000) % candidates.length)];
    const distance = Math.hypot(landmark.x - p.x, landmark.z - p.z);
    return { landmark, time: distance / this.species.flight.cruise + 25 };
  }

  // ---- Ring visuals ----

  buildRings() {
    this.clearRings();
    const a = this.active;
    for (let i = a.next; i < Math.min(a.rings.length, a.next + VISIBLE_RINGS); i++) {
      const ring = a.rings[i];
      const mesh = new THREE.Mesh(this.ringGeometry, i === a.next ? this.nextMaterial : this.laterMaterial);
      mesh.position.copy(ring.position);
      mesh.rotation.y = ring.yaw;
      this.rings.add(mesh);
    }
  }

  clearRings() {
    this.rings.clear();
  }

  dispose() {
    this.clearRings();
    this.rings.removeFromParent();
    this.ringGeometry.dispose();
    this.nextMaterial.dispose();
    this.laterMaterial.dispose();
  }
}

// Vertices are matched on a 2 m grid: OSM ways share nodes exactly, so this only absorbs float rounding.
const keyOf = (x, z) => `${Math.round(x / 2)},${Math.round(z / 2)}`;

function angleBetween([ax, az], [bx, bz]) {
  const dot = (ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}
