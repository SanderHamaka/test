import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Procedural nest models: a woven rim of twigs around a lined bowl with eggs. Every size is built from
 * the same recipe with different numbers, and is deterministic, so all nests of a size look alike
 * (each nest is turned to its own angle).
 *
 * The bowl floor sits just above the roof, so a bird perched on the spot sits down in the nest.
 */
export const NEST_SIZES = {
  small: { outer: 0.75, inner: 0.42, rim: 0.26, twigs: 90, poking: 10, eggs: 2, feathers: 0, moss: 3 },
  large: { outer: 1.15, inner: 0.6, rim: 0.4, twigs: 180, poking: 22, eggs: 3, feathers: 3, moss: 6 },
  huge: { outer: 1.75, inner: 0.85, rim: 0.58, twigs: 320, poking: 46, eggs: 4, feathers: 6, moss: 10, platform: true },
  legendary: { outer: 1.75, inner: 0.85, rim: 0.58, twigs: 320, poking: 46, eggs: 4, feathers: 10, moss: 14, platform: true, trinkets: true },
};

const FLOOR = 0.1;

const BARK = [0x4a3322, 0x5e4330, 0x76583b, 0x8a6a45, 0x6f6658];
const colour = new THREE.Color();

/** A tiny seeded random generator, so every build of a size is identical. */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gives a geometry vertex colours from fn(index) → hex/Color, non-indexed so parts can be merged. */
function painted(geometry, fn) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const n = g.attributes.position.count;
  const colours = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colour.set(fn(i)).toArray(colours, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  g.deleteAttribute('uv');
  return g;
}

const tint = (hex, rnd, spread = 0.18) => colour.set(hex).multiplyScalar(1 - spread / 2 + rnd() * spread).getHex();

/** One twig along +x, centred, with a little side shoot now and then. */
function twig(length, thickness, rnd) {
  const bark = tint(BARK[Math.floor(rnd() * BARK.length)], rnd);
  const parts = [painted(new THREE.CylinderGeometry(thickness * 0.7, thickness, length, 5, 1).rotateZ(Math.PI / 2), () => bark)];
  if (rnd() < 0.35) {
    const shoot = length * (0.25 + rnd() * 0.2);
    parts.push(painted(
      new THREE.CylinderGeometry(thickness * 0.4, thickness * 0.6, shoot, 4, 1).rotateZ(Math.PI / 2)
        .translate(shoot / 2, 0, 0).rotateY((rnd() - 0.5) * 1.6).translate((rnd() - 0.5) * length * 0.6, 0, 0),
      () => bark,
    ));
  }
  return parts.length > 1 ? mergeGeometries(parts) : parts[0];
}

/** Places a geometry with a rotation (Euler XYZ order 'YZX') and a position. */
function place(geometry, x, y, z, yaw, tilt, roll = 0) {
  return geometry.rotateX(roll).rotateZ(tilt).rotateY(yaw).translate(x, y, z);
}

export function buildNestGeometry(sizeKey) {
  const s = NEST_SIZES[sizeKey];
  const rnd = random(sizeKey.length * 7919 + Math.round(s.outer * 100));
  const parts = [];
  const mid = (s.outer + s.inner) / 2;
  const thick = (s.outer - s.inner) / 2;
  // Big nests stand on a low platform; the bowl floor sits on top of it.
  const base = s.platform ? 0.16 : 0;
  const floor = base + FLOOR;

  // Platform: a squat cone of packed twigs and mud.
  if (s.platform) {
    parts.push(painted(new THREE.CylinderGeometry(s.outer * 0.9, s.outer * 0.72, base + 0.02, 18, 1), () => tint(0x3e3024, rnd, 0.3))
      .translate(0, (base + 0.02) / 2, 0));
  }

  // Core of the rim: a dark, flattened ring behind the twigs, so no gaps show through.
  parts.push(painted(new THREE.TorusGeometry(mid, thick * 0.6, 6, 28).rotateX(Math.PI / 2).scale(1, s.rim / (thick * 1.5), 1)
    .translate(0, base + s.rim * 0.45, 0), () => tint(0x3a2c20, rnd, 0.3)));

  // Lining: a shallow bowl of grass and down inside the rim.
  const profile = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    profile.push(new THREE.Vector2(0.001 + s.inner * 1.05 * t, floor + s.rim * 0.75 * t * t));
  }
  profile.reverse(); // rim to centre, so the faces (and normals) point up into the bowl
  parts.push(painted(new THREE.LatheGeometry(profile, 24), () => tint(rnd() < 0.5 ? 0xb39a6a : 0x9c8458, rnd, 0.25)));

  // Woven twigs: layered rings around the rim, lying roughly along it with a random tilt.
  for (let i = 0; i < s.twigs; i++) {
    const angle = rnd() * Math.PI * 2;
    const r = mid + (rnd() - 0.5) * thick * 1.9;
    const y = base + s.rim * (0.08 + 0.92 * Math.pow(rnd(), 0.8));
    const length = (0.35 + rnd() * 0.45) * (0.7 + s.outer * 0.4);
    const yaw = -angle + Math.PI / 2 + (rnd() - 0.5) * 0.9; // tangent to the ring
    parts.push(place(twig(length, 0.012 + 0.01 * s.outer, rnd), Math.cos(angle) * r, y, Math.sin(angle) * r, yaw, (rnd() - 0.5) * 0.6, rnd() * 3));
  }

  // Twigs poking out of the rim for an untidy, real-nest outline.
  for (let i = 0; i < s.poking; i++) {
    const angle = rnd() * Math.PI * 2;
    const length = (0.4 + rnd() * 0.5) * (0.7 + s.outer * 0.4);
    const r = s.outer * 0.95;
    const y = base + s.rim * (0.2 + rnd() * 0.75);
    // Pointing outwards (radially), slightly up or down.
    parts.push(place(twig(length, 0.011 + 0.008 * s.outer, rnd).translate(length * 0.35, 0, 0),
      Math.cos(angle) * r * 0.8, y, Math.sin(angle) * r * 0.8, -angle, (rnd() - 0.4) * 0.7, rnd() * 3));
  }

  // Moss tufts on the rim.
  for (let i = 0; i < s.moss; i++) {
    const angle = rnd() * Math.PI * 2;
    const size = 0.05 + rnd() * 0.035 * s.outer;
    parts.push(painted(new THREE.IcosahedronGeometry(size, 0).scale(1.4, 0.6, 1.1), () => tint(0x5f7f3a, rnd, 0.3))
      .rotateY(rnd() * 3).translate(Math.cos(angle) * mid, base + s.rim * 0.95, Math.sin(angle) * mid));
  }

  // Down feathers caught in the twigs.
  for (let i = 0; i < s.feathers; i++) {
    const angle = rnd() * Math.PI * 2;
    const feather = painted(new THREE.SphereGeometry(0.06, 6, 4).scale(0.5, 0.12, 1.6), () => (rnd() < 0.8 ? 0xf2efe6 : 0xd9d2c4));
    parts.push(place(feather, Math.cos(angle) * (s.inner + 0.05), base + s.rim * 0.9, Math.sin(angle) * (s.inner + 0.05), rnd() * 6, (rnd() - 0.5) * 0.8));
  }

  // Eggs in the bowl.
  const eggColour = sizeKey === 'small' ? 0xbfe0e0 : 0xe6dccb;
  for (let i = 0; i < s.eggs; i++) {
    const angle = (i / s.eggs) * Math.PI * 2 + rnd() * 0.5;
    const r = s.eggs > 1 ? 0.08 + s.inner * 0.12 : 0;
    const egg = painted(new THREE.SphereGeometry(0.06, 10, 8).scale(1, 1, 1.35), () =>
      rnd() < 0.12 ? 0x6b5640 : tint(eggColour, rnd, 0.08)); // a few speckles
    parts.push(place(egg, Math.cos(angle) * r, floor + 0.06 + r * r * 0.6, Math.sin(angle) * r, rnd() * 6, 0.25, 0));
  }

  // The legendary nest: a crow's hoard of shiny things woven into the rim.
  if (s.trinkets) {
    const shiny = [0xd8b04a, 0xc0c4c8, 0xc23b2f, 0x3f7fd0];
    for (let i = 0; i < 7; i++) {
      const angle = rnd() * Math.PI * 2;
      const hex = shiny[i % shiny.length];
      const shape = i % 3 === 0
        ? new THREE.CylinderGeometry(0.07, 0.07, 0.02, 12) // bottle cap / coin
        : i % 3 === 1 ? new THREE.TorusGeometry(0.06, 0.012, 6, 14) // ring
          : new THREE.BoxGeometry(0.4, 0.008, 0.05); // ribbon
      parts.push(place(painted(shape, () => hex), Math.cos(angle) * mid, base + s.rim * (0.75 + rnd() * 0.3), Math.sin(angle) * mid, rnd() * 6, (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 0.8));
    }
  }

  const geometry = mergeGeometries(parts);
  geometry.computeBoundingSphere();
  return geometry;
}
