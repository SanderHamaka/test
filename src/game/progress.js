import { SPECIES } from './species.js';

const KEY = 'fly.progress.v1';

/** Total XP needed to reach a level: 100 for level 2, then growing quadratically. */
export const xpForLevel = (level) => 60 * (level - 1) ** 2 + 40 * (level - 1);

export function levelForXp(xp) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  return level;
}

/**
 * The player's progress, kept in localStorage: XP, discovered landmarks (by OSM id, so they count
 * wherever you start from) and some counters. Writes are batched.
 */
export class Progress {
  constructor() {
    const saved = read();
    this.xp = saved.xp ?? 0;
    this.discovered = new Set(saved.discovered ?? []);
    this.eaten = saved.eaten ?? {};
    this.nests = saved.nests ?? []; // [{ id, lat, lon, elevation, branches }]
    this.hints = new Set(saved.hints ?? []); // one-time tips already shown
    this.places = saved.places ?? {}; // landmark id → { name, kind, at } for the journal
    this.records = { challenges: {}, bestRace: null, hawkEscapes: 0, topSpeed: 0, topHeight: 0, ...saved.records };
    this.badges = saved.badges ?? {}; // badge id → time earned
    this.lastSpecies = saved.lastSpecies ?? 'gull';
    this.lastMode = saved.lastMode ?? 'relaxed';
    this.saveTimer = null;
  }

  get level() {
    return levelForXp(this.xp);
  }

  /** XP progress within the current level, 0..1. */
  get levelProgress() {
    const level = this.level;
    const from = xpForLevel(level), to = xpForLevel(level + 1);
    return (this.xp - from) / (to - from);
  }

  isUnlocked(species) {
    return this.level >= species.unlockLevel;
  }

  /** Adds XP; returns the species unlocked by a level-up, if any, and the new level. */
  addXp(amount) {
    const before = this.level;
    this.xp = Math.max(0, this.xp + amount);
    const after = this.level;
    this.save();
    if (after <= before) return null;
    return { level: after, unlocked: SPECIES.filter((s) => s.unlockLevel > before && s.unlockLevel <= after) };
  }

  /** Takes away part of the XP earned within the current level (never drops a level). */
  penalise(fraction) {
    const floor = xpForLevel(this.level);
    const lost = Math.round((this.xp - floor) * fraction);
    this.xp -= lost;
    this.save();
    return lost;
  }

  /** Records a discovered landmark; returns false if it was already known. */
  discover(id, info) {
    if (this.discovered.has(id)) return false;
    this.discovered.add(id);
    if (info) this.places[id] = { name: info.name, kind: info.kind, at: Date.now() };
    this.save();
    return true;
  }

  recordChallenge(type, seconds) {
    const r = this.records;
    r.challenges[type] = (r.challenges[type] ?? 0) + 1;
    if (type === 'race' && (r.bestRace == null || seconds < r.bestRace)) r.bestRace = Math.round(seconds);
    this.save();
  }

  recordHawkEscape() {
    this.records.hawkEscapes++;
    this.save();
  }

  /** Keeps personal bests for speed (km/h) and height above ground (m); saves only on a real improvement. */
  recordFlight(speed, height) {
    const r = this.records;
    if (speed > r.topSpeed + 1 || height > r.topHeight + 5) {
      r.topSpeed = Math.max(r.topSpeed, Math.round(speed));
      r.topHeight = Math.max(r.topHeight, Math.round(height));
      this.save();
    }
  }

  earn(badge) {
    if (this.badges[badge]) return false;
    this.badges[badge] = Date.now();
    this.save();
    return true;
  }

  /** Starts over: XP, discoveries, nests, records and badges. Settings are kept. */
  reset() {
    this.xp = 0;
    this.discovered.clear();
    this.eaten = {};
    this.nests.length = 0;
    this.hints.clear();
    this.places = {};
    this.records = { challenges: {}, bestRace: null, hawkEscapes: 0, topSpeed: 0, topHeight: 0 };
    this.badges = {};
    this.flush();
  }

  countMeal(type) {
    this.eaten[type] = (this.eaten[type] ?? 0) + 1;
    this.save();
  }

  /** True the first time a tip is asked for, so it's only ever shown once. */
  firstTime(hint) {
    if (this.hints.has(hint)) return false;
    this.hints.add(hint);
    this.save();
    return true;
  }

  setChoice(speciesId, mode) {
    this.lastSpecies = speciesId;
    this.lastMode = mode;
    this.save();
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 500);
  }

  flush() {
    clearTimeout(this.saveTimer);
    try {
      localStorage.setItem(KEY, JSON.stringify({
        xp: this.xp,
        discovered: [...this.discovered],
        eaten: this.eaten,
        nests: this.nests,
        hints: [...this.hints],
        places: this.places,
        records: this.records,
        badges: this.badges,
        lastSpecies: this.lastSpecies,
        lastMode: this.lastMode,
      }));
    } catch {
      // Storage full or unavailable: progress lasts for this session only.
    }
  }
}

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    return {};
  }
}
