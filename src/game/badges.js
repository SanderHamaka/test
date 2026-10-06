import { FOOD_TYPES } from './species.js';

/**
 * Badges for the journal. Each test gets the saved progress and a snapshot of the current flight:
 * { night (0..1), storm (bool), nightSeconds, stormSeconds }.
 */
export const BADGES = [
  { id: 'explorer', name: 'Explorer', text: 'Discover 5 places.', test: (p) => p.discovered.size >= 5 },
  { id: 'cartographer', name: 'Cartographer', text: 'Discover 25 places.', test: (p) => p.discovered.size >= 25 },
  { id: 'gourmet', name: 'Gourmet', text: 'Taste all five kinds of food.', test: (p) => FOOD_TYPES.every((t) => p.eaten[t] > 0) },
  { id: 'builder', name: 'Home builder', text: 'Finish a nest of 5 branches.', test: (p) => p.nests.some((n) => n.branches >= 5) },
  { id: 'architect', name: 'Architect', text: 'Build a grand nest of 30 branches.', test: (p) => p.nests.some((n) => n.branches >= 30) },
  { id: 'night-owl', name: 'Night owl', text: 'Fly for a minute at night.', test: (p, f) => f.nightSeconds >= 60 },
  { id: 'storm-chaser', name: 'Storm chaser', text: 'Fly for a minute through a storm.', test: (p, f) => f.stormSeconds >= 60 },
  { id: 'speed-demon', name: 'Speed demon', text: 'Dive at 200 km/h.', test: (p) => p.records.topSpeed >= 200 },
  { id: 'high-flyer', name: 'High flyer', text: 'Climb 400 m above the ground.', test: (p) => p.records.topHeight >= 400 },
  { id: 'hawk-dodger', name: 'Hawk dodger', text: 'Shake off the hawk 3 times.', test: (p) => p.records.hawkEscapes >= 3 },
  { id: 'racer', name: 'Street racer', text: 'Finish a street race.', test: (p) => p.records.challenges.race > 0 },
  { id: 'parent', name: 'Good parent', text: 'Feed the chicks.', test: (p) => p.records.challenges.feed > 0 },
];

export const BADGE_XP = 30;
