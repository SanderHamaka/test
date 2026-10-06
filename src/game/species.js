/**
 * Playable birds. Flight stats feed Bird.js, `diet` multiplies the reward for each food type,
 * and `look` drives the procedural model in birdModel.js.
 *
 * Flight stats: cruise / maxSpeed in m/s, flapThrust in m/s², climb lift while flapping in m/s,
 * sink while gliding in m/s, turn rate multiplier, stamina points and how fast flapping uses them.
 */
export const SPECIES = [
  {
    id: 'gull',
    name: 'Herring gull',
    latin: 'Larus argentatus',
    blurb: 'A tireless glider that rides the wind along coasts and canals. Loves fish and anyone’s fries.',
    unlockLevel: 1,
    flight: { cruise: 18, maxSpeed: 70, flapThrust: 10, lift: 3.0, sink: 1.1, turn: 1.25, stamina: 120, flapCost: 9 },
    diet: { fish: 1.6, scraps: 1.4, insects: 0.6, seeds: 0.4, mice: 0.5 },
    look: {
      scale: 1.0, bodyLength: 2.6, wingLength: 1.0, wingWidth: 1.0, tail: 'square',
      body: 0xf3f2ee, belly: 0xffffff, head: 0xf7f6f2, back: 0xa7b1ba, wing: 0xa7b1ba, wingTip: 0x1e1f22,
      tailColour: 0xf3f2ee, mirrors: true, beak: 0xf2c230, beakLength: 0.24, beakSpot: 0xd8402b, legs: 0xe6a59a, eye: 0xf1d36a,
    },
  },
  {
    id: 'pigeon',
    name: 'Rock pigeon',
    latin: 'Columba livia',
    blurb: 'Fast, agile and completely at home between buildings. Finds seeds and crumbs on every square.',
    unlockLevel: 1,
    flight: { cruise: 21, maxSpeed: 78, flapThrust: 14, lift: 3.6, sink: 1.8, turn: 1.7, stamina: 100, flapCost: 8 },
    diet: { seeds: 1.7, scraps: 1.3, insects: 0.7, fish: 0.3, mice: 0.2 },
    look: {
      scale: 0.78, bodyLength: 2.3, wingLength: 0.85, wingWidth: 1.05, tail: 'fan',
      body: 0x7f8794, belly: 0x8e96a3, head: 0x6c7480, back: 0x9aa2ad, wing: 0x9ea6b1, wingTip: 0x3b3f46,
      tailColour: 0x7a828e, tailBand: 0x2e3238, neck: 0x3f8f6e, beak: 0x3a3a3f, beakLength: 0.13, legs: 0xc8423b,
      eye: 0xe8792e, wingBars: 0x2f3338,
    },
  },
  {
    id: 'crow',
    name: 'Carrion crow',
    latin: 'Corvus corone',
    blurb: 'Clever and unfussy: eats almost anything and remembers every snack bar in town.',
    unlockLevel: 3,
    flight: { cruise: 18, maxSpeed: 74, flapThrust: 12, lift: 3.3, sink: 1.5, turn: 1.5, stamina: 115, flapCost: 7.5 },
    diet: { scraps: 1.3, insects: 1.2, seeds: 1.1, mice: 1.1, fish: 1.0 },
    look: {
      scale: 0.9, bodyLength: 2.5, wingLength: 0.95, wingWidth: 1.15, tail: 'round', glossy: true,
      body: 0x1b1d22, belly: 0x1f2127, head: 0x17191d, back: 0x1d2026, wing: 0x1c1f25, wingTip: 0x121317,
      tailColour: 0x1a1c21, beak: 0x111215, beakLength: 0.2, beakThick: 1.5, legs: 0x16171a, eye: 0x2a2219,
    },
  },
  {
    id: 'kestrel',
    name: 'Common kestrel',
    latin: 'Falco tinnunculus',
    blurb: 'A small falcon with the steepest, fastest dive. Hunts mice over fields and verges.',
    unlockLevel: 5,
    flight: { cruise: 17, maxSpeed: 95, flapThrust: 12, lift: 3.4, sink: 1.4, turn: 1.9, stamina: 95, flapCost: 8.5 },
    diet: { mice: 2.0, insects: 1.3, seeds: 0.3, fish: 0.3, scraps: 0.4 },
    look: {
      scale: 0.82, bodyLength: 2.4, wingLength: 1.05, wingWidth: 0.85, tail: 'long',
      body: 0xb8693a, belly: 0xe7d0a4, head: 0x8a96a3, back: 0xb8693a, wing: 0xb06a3c, wingTip: 0x2b2420,
      tailColour: 0x8f9aa6, tailBand: 0x1f1c1a, beak: 0x5d6168, beakLength: 0.12, beakHook: true, legs: 0xe8c53a,
      eye: 0x1a1612, spots: 0x3a2618,
    },
  },
];

export const speciesById = (id) => SPECIES.find((s) => s.id === id) ?? SPECIES[0];

export const FOOD_TYPES = ['fish', 'insects', 'seeds', 'scraps', 'mice'];
export const FOOD_LABELS = { fish: 'fish', insects: 'insects', seeds: 'seeds', scraps: 'scraps', mice: 'a mouse' };
