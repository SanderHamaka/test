import { FOOD_LABELS } from './species.js';
import { NEST_MILESTONES } from './nests.js';

const DISCOVERY_XP = 60;
const HUNGER_DRAIN = 100 / (8 * 60); // a full stomach lasts about eight minutes of gliding
const FAINT_PENALTY = 0.25;
const BRANCH_XP = 4;

/**
 * Game rules on top of flying: rewards for eating and discovering, and in challenge mode hunger.
 * Hungry birds recover stamina slowly, starving birds can't flap, and landing while starving faints.
 * Messages for the player go out through `notify(text, kind)`.
 */
export class Gameplay {
  constructor({ species, mode, progress, bird, notify }) {
    this.species = species;
    this.challenge = mode === 'challenge';
    this.progress = progress;
    this.bird = bird;
    this.notify = notify;
    this.hunger = 100;
    this.warned = null;
  }

  /** @returns { faint: true } when the bird faints and must be respawned */
  update(dt, birdEvents, eaten, discovered) {
    for (const type of eaten) this.eat(type);
    for (const landmark of discovered) {
      this.notify(`Discovered ${landmark.name} · ${landmark.kind}`, 'discovery');
      this.reward(DISCOVERY_XP);
    }
    if (birdEvents.tooHighToLand) this.notify('Fly lower to land', 'hint');

    if (!this.challenge) return {};

    this.hunger = Math.max(0, this.hunger - HUNGER_DRAIN * (this.bird.flapping ? 1.8 : 1) * dt);
    const bird = this.bird;
    bird.staminaRegenFactor = this.hunger < 25 ? 0.35 : 1;
    bird.canFlap = this.hunger > 0;
    this.warn(this.hunger <= 0 ? 'starving' : this.hunger < 25 ? 'hungry' : null);

    if (this.hunger <= 0 && birdEvents.landed) {
      const lost = this.progress.penalise(FAINT_PENALTY);
      this.hunger = 50;
      this.warned = null;
      this.notify(`You fainted from hunger and lost ${lost} XP. Rest up and find food!`, 'danger');
      return { faint: true };
    }
    return {};
  }

  eat(type) {
    const value = this.species.diet[type] ?? 1;
    this.bird.stamina = Math.min(this.bird.maxStamina, this.bird.stamina + 25 * value);
    if (this.challenge) this.hunger = Math.min(100, this.hunger + 16 * value);
    this.progress.countMeal(type);
    const xp = Math.round(8 * value) + 2;
    const taste = value >= 1.5 ? 'Delicious ' : value < 0.6 ? 'Meh, ' : '';
    this.notify(`${taste}${FOOD_LABELS[type]} +${xp} XP`, 'food');
    this.reward(xp);
  }

  /** The hawk struck: lose stamina and food, and drop whatever was in the beak. */
  hawkHit() {
    const bird = this.bird;
    bird.stamina = Math.max(0, bird.stamina - bird.maxStamina * 0.4);
    bird.speed *= 0.5;
    bird.pitch = -0.5;
    if (this.challenge) this.hunger = Math.max(0, this.hunger - 15);
    const dropped = bird.carrying ? ' You dropped your branch.' : bird.carryingFood ? ' You dropped your food.' : '';
    bird.carrying = bird.carryingFood = false;
    this.notify(`The hawk got you!${dropped}`, 'danger');
  }

  hawkEscaped() {
    this.notify('You shook off the hawk! +15 XP', 'discovery');
    this.reward(15);
  }

  pickedBranch() {
    if (this.progress.firstTime('branch')) {
      this.notify('You snapped off a branch! Land anywhere to drop it and start a nest.', 'hint-long');
    } else {
      this.notify('Picked up a branch', 'hint');
    }
  }

  placedBranch({ nest, created, milestone }) {
    if (milestone) {
      this.notify(`${milestone.name}: ${milestone.text} +${milestone.xp} XP`, 'level');
      this.reward(milestone.xp + BRANCH_XP);
      return;
    }
    if (created) {
      this.notify('You started a nest! Bring 4 more branches to make it your home.', 'discovery');
    } else {
      const next = NEST_MILESTONES.map((m) => m.branches).find((n) => n > nest.branches);
      this.notify(`Nest: ${nest.branches} branches${next ? ` · ${next - nest.branches} to the next size` : ''} +${BRANCH_XP} XP`, 'food');
    }
    this.reward(BRANCH_XP);
  }

  reward(xp) {
    const levelUp = this.progress.addXp(xp);
    if (!levelUp) return;
    const unlocked = levelUp.unlocked.map((s) => s.name).join(' and ');
    this.notify(`Level ${levelUp.level}!${unlocked ? ` ${unlocked} unlocked in the album.` : ''}`, 'level');
  }

  warn(state) {
    if (state === this.warned) return;
    this.warned = state;
    if (state === 'hungry') this.notify('You’re getting hungry: stamina recovers slowly.', 'danger');
    if (state === 'starving') this.notify('Starving! You can’t flap any more. Glide to some food.', 'danger');
  }
}
