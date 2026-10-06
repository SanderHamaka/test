import * as THREE from 'three';

/**
 * Procedural bird built from a species' `look`. Faces -z, about 2 m wingspan at scale 1 (game scale:
 * real birds would be invisible from the chase camera). Wings and tail are subdivided grids so colour
 * patterns (tips, bars, bands, speckles) can be painted per vertex.
 *
 * Returns { root, rig } where rig holds the joints that animateBird() moves.
 */
export function buildBirdModel(look) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(look.scale);
  root.add(body);

  const feathers = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: look.glossy ? 0.38 : 0.75, metalness: look.glossy ? 0.18 : 0, side: THREE.DoubleSide,
  });
  const beakMaterial = new THREE.MeshStandardMaterial({ color: look.beak, roughness: 0.45 });
  const legMaterial = new THREE.MeshStandardMaterial({ color: look.legs, roughness: 0.6 });
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: look.eye, roughness: 0.2 });
  const pupilMaterial = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.1 });

  const length = 0.4 * look.bodyLength;
  body.add(new THREE.Mesh(torsoGeometry(look, length), feathers));

  // Head and neck.
  const head = new THREE.Group();
  head.position.set(0, 0.11, -length * 0.46);
  body.add(head);
  head.add(new THREE.Mesh(paint(new THREE.SphereGeometry(0.135, 18, 14), () => look.head), feathers));
  if (look.neck) {
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.05, 8, 20), new THREE.MeshStandardMaterial({
      color: look.neck, roughness: 0.3, metalness: 0.5,
    }));
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, -0.06, 0.07);
    head.add(collar);
  }

  const beakLength = look.beakLength;
  const beak = new THREE.Mesh(
    new THREE.ConeGeometry(0.038 * (look.beakThick ?? 1), beakLength, 10).rotateX(-Math.PI / 2),
    beakMaterial,
  );
  beak.position.set(0, -0.025, -0.12 - beakLength / 2);
  if (look.beakHook) beak.rotation.x = 0.35;
  head.add(beak);
  if (look.beakSpot) {
    const spot = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshStandardMaterial({ color: look.beakSpot }));
    spot.position.set(0, -0.045, -0.1 - beakLength * 0.85);
    head.add(spot);
  }
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), eyeMaterial);
    eye.position.set(side * 0.095, 0.035, -0.07);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), pupilMaterial);
    pupil.position.set(side * 0.018, 0, -0.012);
    eye.add(pupil);
    head.add(eye);
  }

  // Tail on its own joint so it can fan out and tilt.
  const tail = new THREE.Group();
  tail.position.set(0, 0.02, length * 0.42);
  tail.add(new THREE.Mesh(tailGeometry(look), feathers));
  body.add(tail);

  // Wings: inner and outer section per side, each on its own pivot so the flap can bend at the "wrist".
  const wings = {};
  const innerGeometry = wingGeometry(look, 'inner');
  const outerGeometry = wingGeometry(look, 'outer');
  const innerSpan = 0.5 * look.wingLength;
  for (const side of [-1, 1]) {
    const inner = new THREE.Group();
    inner.position.set(side * 0.13, 0.07, -length * 0.12);
    inner.scale.x = side;
    inner.add(new THREE.Mesh(innerGeometry, feathers));
    const outer = new THREE.Group();
    outer.position.set(innerSpan, 0, 0);
    outer.add(new THREE.Mesh(outerGeometry, feathers));
    inner.add(outer);
    body.add(inner);
    wings[side] = { inner, outer };
  }

  // Legs: tucked back in flight, straight down when perched.
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.07, -0.13, length * 0.06);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.011, 0.16, 6).translate(0, -0.08, 0), legMaterial);
    hip.add(shin);
    for (const toe of [-0.5, 0, 0.5]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.01, 0.07).translate(0, 0, -0.03), legMaterial);
      t.position.set(0, -0.16, 0);
      t.rotation.y = toe;
      hip.add(t);
    }
    body.add(hip);
    legs.push(hip);
  }

  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  // Distance from the body's centre to the feet when standing, for perching on surfaces.
  const standHeight = (0.13 + 0.17) * look.scale;
  return { root, rig: { wings, tail, head, legs, standHeight } };
}

/**
 * Poses the rig. state: { phase, flap (0..1 flapping strength), tuck (0..1 dive), perch (0..1),
 * headTurn (radians), tailSpread (0..1) }.
 */
export function animateBird(rig, state) {
  const { phase, flap, tuck, perch } = state;
  const open = 1 - perch;
  const s = Math.sin(phase) * flap * (1 - tuck) * open;
  const dihedral = 0.12 * (1 - flap) * open;

  for (const side of [-1, 1]) {
    const w = rig.wings[side];
    // Fold: perched wings lie swept back along the body; dive tucks them half-way.
    w.inner.rotation.z = side * (s * 0.8 + dihedral - perch * 0.15);
    w.inner.rotation.y = side * -(tuck * 0.9 * open + perch * 1.45);
    w.inner.rotation.x = perch * 0.1;
    // The outer section sits inside the mirrored inner group, so it needs no side sign.
    w.outer.rotation.z = Math.sin(phase - 0.7) * 0.55 * flap * (1 - tuck) * open - perch * 0.1;
    w.outer.rotation.y = -(tuck * 1.2 * open + perch * 1.9);
  }

  rig.tail.rotation.x = -0.08 * open + 0.2 * perch + Math.sin(phase * 0.5) * 0.04 * flap;
  rig.tail.scale.x = 1 + (state.tailSpread ?? 0) * 0.5;
  rig.head.rotation.y = state.headTurn ?? 0;
  rig.head.rotation.x = -0.1 * perch;
  for (const leg of rig.legs) leg.rotation.x = THREE.MathUtils.lerp(1.45, 0, perch);
}

const colour = new THREE.Color();
const mixed = new THREE.Color();

/** Sets per-vertex colours from fn(x, y, z, nx, ny, nz) → hex or THREE.Color. */
function paint(geometry, fn) {
  const p = geometry.attributes.position;
  const n = geometry.attributes.normal;
  const colours = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = fn(p.getX(i), p.getY(i), p.getZ(i), n?.getX(i) ?? 0, n?.getY(i) ?? 0, n?.getZ(i) ?? 0);
    colour.set(c).toArray(colours, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geometry;
}

const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
const blend = (a, b, t) => mixed.set(a).lerp(colour.set(b), t).getHex();
const speckle = (u, v) => {
  const s = Math.sin(u * 127.1 + v * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Teardrop body: back colour on top, belly below, slightly flattened. */
function torsoGeometry(look, length) {
  const points = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24; // 0 = tail end, 1 = chest/front
    const r = 0.19 * Math.sin(Math.PI * t) ** 0.62 * (0.72 + 0.28 * t);
    points.push(new THREE.Vector2(Math.max(r, 0.001), (t - 0.5) * length));
  }
  const geometry = new THREE.LatheGeometry(points, 20).rotateX(-Math.PI / 2); // +y (front) → -z
  geometry.scale(1, 0.92, 1);
  return paint(geometry, (x, y, z, nx, ny) => {
    let c = blend(look.belly, look.back, smooth(-0.25, 0.35, ny));
    if (look.spots && ny > 0.2 && speckle(x * 9, z * 9) > 0.86) c = look.spots;
    return c;
  });
}

/**
 * A wing section as a grid: u runs along the span (0 at the joint), v across the chord (0 = leading edge).
 * The outer section tapers to the tip and has a feathered trailing edge.
 */
function wingGeometry(look, part) {
  const outer = part === 'outer';
  const span = (outer ? 0.55 : 0.5) * look.wingLength;
  const segmentsU = outer ? 14 : 8, segmentsV = 6;
  const positions = [], colours = [], indices = [];

  for (let i = 0; i <= segmentsU; i++) {
    const u = i / segmentsU;
    const x = u * span;
    // Chord: broad at the body, tapering towards a fairly pointed tip.
    const chord = outer
      ? 0.34 * look.wingWidth * (1 - 0.72 * u ** 1.3)
      : 0.38 * look.wingWidth * (1 - 0.12 * u);
    const lead = outer ? -0.13 + 0.07 * u * u : -0.15 + 0.02 * u;
    // Primary feathers: a saw-tooth trailing edge on the outer wing.
    const serration = outer ? 0.035 * Math.abs(Math.sin(u * Math.PI * 4.5)) * (1 - u * 0.4) : 0;

    for (let j = 0; j <= segmentsV; j++) {
      const v = j / segmentsV;
      const z = lead + v * (chord + serration * v);
      const y = 0.025 * Math.sin(Math.PI * v) * (1 - u * 0.6); // a little camber
      positions.push(x, y, z);

      const along = outer ? 0.5 + 0.5 * u : 0.5 * u; // 0 at the body, 1 at the tip
      let c = blend(look.wing, look.back, outer ? 0 : (1 - u) * 0.5);
      if (look.wingBars && !outer && (Math.abs(v - 0.45) < 0.06 || Math.abs(v - 0.7) < 0.06)) c = look.wingBars;
      if (look.spots && !outer && speckle(u * 7, v * 7) > 0.8) c = look.spots;
      c = blend(c, look.wingTip, smooth(0.62, 0.9, along) * (0.6 + 0.4 * v));
      if (look.mirrors && outer && u > 0.8 && Math.abs(v - 0.5) < 0.12) c = 0xf3f3f3; // white spots in black wing tips
      colour.set(c).toArray(colours, positions.length - 3);
    }
  }
  for (let i = 0; i < segmentsU; i++) {
    for (let j = 0; j < segmentsV; j++) {
      const a = i * (segmentsV + 1) + j;
      const b = a + segmentsV + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Tail fan as a grid; the shape and the band near the end depend on the species. */
function tailGeometry(look) {
  const long = look.tail === 'long';
  const length = long ? 0.42 : 0.3;
  const positions = [], colours = [], indices = [];
  const nu = 6, nv = 6;
  for (let i = 0; i <= nv; i++) {
    const v = i / nv; // 0 at the body, 1 at the tip
    const rootHalf = 0.07, endHalf = { square: 0.14, fan: 0.17, round: 0.15, long: 0.1 }[look.tail] ?? 0.14;
    const half = rootHalf + (endHalf - rootHalf) * v;
    for (let j = 0; j <= nu; j++) {
      const u = j / nu - 0.5; // -0.5..0.5 across
      let z = v * length;
      if (look.tail === 'round' || look.tail === 'fan') z -= (u * u) * 0.12 * v; // rounded end
      positions.push(u * 2 * half, -0.01 * v, z);
      let c = look.tailColour;
      if (look.tailBand && v > 0.75) c = look.tailBand;
      colour.set(c).toArray(colours, positions.length - 3);
    }
  }
  for (let i = 0; i < nv; i++) {
    for (let j = 0; j < nu; j++) {
      const a = i * (nu + 1) + j;
      indices.push(a, a + nu + 1, a + 1, a + 1, a + nu + 1, a + nu + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
