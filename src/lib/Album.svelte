<script>
  import { onMount } from 'svelte';
  import { SPECIES, FOOD_LABELS } from '../game/species.js';
  import { renderPortraits } from '../game/portraits.js';

  let { place, progress, onfly, onback } = $props();

  let portraits = $state({});
  let selected = $state(SPECIES.find((s) => s.id === progress.lastSpecies && progress.isUnlocked(s))?.id ?? 'gull');
  let mode = $state(progress.lastMode);

  onMount(() => {
    // Rendering the portraits takes a moment; let the page paint first.
    requestAnimationFrame(() => (portraits = renderPortraits(SPECIES)));
  });

  const level = progress.level;
  const bars = (s) => [
    ['Speed', s.flight.maxSpeed / 95],
    ['Agility', s.flight.turn / 1.9],
    ['Gliding', 1.15 - s.flight.sink / 2.2],
    ['Stamina', s.flight.stamina / 120],
  ];
  const favourites = (s) => Object.entries(s.diet).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => FOOD_LABELS[t]);

  function fly() {
    const species = SPECIES.find((s) => s.id === selected);
    progress.setChoice(species.id, mode);
    onfly({ species, mode });
  }
</script>

<main class="album">
  <header>
    <button class="back" onclick={onback}>← {place.name}</button>
    <div class="level">
      <span>Level {level}</span>
      <div class="xp"><div style="width: {progress.levelProgress * 100}%"></div></div>
      <small>{progress.discovered.size} places discovered</small>
    </div>
  </header>

  <h1><span class="brand">Birb</span> Choose your bird</h1>

  <div class="cards">
    {#each SPECIES as species (species.id)}
      {@const locked = !progress.isUnlocked(species)}
      <button
        class="card"
        class:selected={selected === species.id}
        class:locked
        disabled={locked}
        onclick={() => (selected = species.id)}
        aria-pressed={selected === species.id}
      >
        <div class="photo">
          {#if portraits[species.id]}
            <img src={portraits[species.id]} alt={species.name} />
          {:else}
            <span class="placeholder">{species.name[0]}</span>
          {/if}
          {#if locked}<div class="lock">Reach level {species.unlockLevel}</div>{/if}
        </div>
        <h2>{species.name}</h2>
        <p class="latin">{species.latin}</p>
        <p class="blurb">{species.blurb}</p>
        <dl>
          {#each bars(species) as [label, value] (label)}
            <dt>{label}</dt>
            <dd><span style="width: {Math.min(1, Math.max(0.1, value)) * 100}%"></span></dd>
          {/each}
        </dl>
        <p class="diet">Favourite food: {favourites(species).join(', ')}</p>
      </button>
    {/each}
  </div>

  <div class="footer">
    <div class="modes" role="radiogroup" aria-label="Game mode">
      <button role="radio" aria-checked={mode === 'relaxed'} class:active={mode === 'relaxed'} onclick={() => (mode = 'relaxed')}>
        <b>Free roam</b>
        <span>Fly, explore and snack at your own pace.</span>
      </button>
      <button role="radio" aria-checked={mode === 'challenge'} class:active={mode === 'challenge'} onclick={() => (mode = 'challenge')}>
        <b>Challenge</b>
        <span>Hunger keeps dropping. Starve and you can't flap; land starving and you faint.</span>
      </button>
    </div>
    <button class="fly" onclick={fly}>Fly!</button>
  </div>
</main>

<style>
  .album {
    position: fixed;
    inset: 0;
    overflow-y: auto;
    padding: 16px 16px 32px;
    box-sizing: border-box;
    color: #1d2a36;
    background: linear-gradient(180deg, #e9e1cf 0%, #f6f1e6 100%);
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    max-width: 1100px;
    margin: 0 auto;
  }

  .back {
    padding: 0.4rem 0.8rem;
    border: 1px solid #1d2a3633;
    border-radius: 999px;
    background: none;
    font: inherit;
    cursor: pointer;
  }

  .level {
    display: grid;
    justify-items: end;
    gap: 0.2rem;
    font-weight: 600;
  }

  .xp {
    width: 160px;
    height: 6px;
    border-radius: 3px;
    background: #1d2a361f;
    overflow: hidden;
  }

  .xp div {
    height: 100%;
    background: #d99a1c;
  }

  .level small {
    font-weight: 400;
    color: #5b6b7a;
  }

  h1 {
    margin: 1rem auto 1.2rem;
    max-width: 1100px;
    font-size: clamp(1.8rem, 5vw, 2.6rem);
    letter-spacing: -0.02em;
  }

  h1 .brand {
    display: block;
    font-size: 0.9rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #b7791f;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 16px;
    max-width: 1100px;
    margin: 0 auto;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 10px 10px 14px;
    border: 2px solid transparent;
    border-radius: 6px;
    background: #fffdf8;
    box-shadow: 0 2px 0 #00000010, 0 8px 24px #3b2f1a1a;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    transform: rotate(-0.6deg);
    transition: transform 0.15s, border-color 0.15s;
  }

  .card:nth-child(even) {
    transform: rotate(0.7deg);
  }

  .card:hover:not(:disabled),
  .card.selected {
    transform: rotate(0) translateY(-3px);
  }

  .card.selected {
    border-color: #d99a1c;
  }

  .card.locked {
    cursor: not-allowed;
  }

  .photo {
    position: relative;
    aspect-ratio: 1;
    border-radius: 3px;
    background: radial-gradient(circle at 50% 40%, #cfe3f2, #8fb8dc);
    overflow: hidden;
  }

  .photo img {
    width: 100%;
    height: 100%;
    display: block;
  }

  .locked .photo img {
    filter: grayscale(1) brightness(0.35);
  }

  .placeholder {
    display: grid;
    place-items: center;
    height: 100%;
    font-size: 4rem;
    color: #ffffffaa;
  }

  .lock {
    position: absolute;
    inset: auto 0 0;
    padding: 0.4rem;
    background: #000a;
    color: #fff;
    text-align: center;
    font-size: 0.85rem;
  }

  .card h2 {
    margin: 0.4rem 0 0;
    font-size: 1.15rem;
  }

  .latin {
    margin: 0;
    font-style: italic;
    color: #6b7785;
    font-size: 0.85rem;
  }

  .blurb {
    margin: 0.3rem 0;
    font-size: 0.88rem;
    line-height: 1.35;
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 0.2rem 0.6rem;
    margin: 0.2rem 0;
    font-size: 0.78rem;
  }

  dt {
    color: #5b6b7a;
  }

  dd {
    margin: 0;
    height: 6px;
    border-radius: 3px;
    background: #1d2a3614;
  }

  dd span {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: #4a7fb5;
  }

  .diet {
    margin: 0.2rem 0 0;
    font-size: 0.8rem;
    color: #5b6b7a;
  }

  .footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: stretch;
    gap: 16px;
    max-width: 1100px;
    margin: 20px auto 0;
  }

  .modes {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    flex: 1;
  }

  .modes button {
    display: grid;
    gap: 0.15rem;
    flex: 1;
    min-width: 220px;
    padding: 0.7rem 0.9rem;
    border: 2px solid #1d2a3622;
    border-radius: 10px;
    background: #fffdf8;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .modes button.active {
    border-color: #d99a1c;
  }

  .modes span {
    font-size: 0.85rem;
    color: #5b6b7a;
  }

  .fly {
    min-width: 160px;
    padding: 0.8rem 1.6rem;
    border: none;
    border-radius: 12px;
    background: #d99a1c;
    color: #1d2a36;
    font: inherit;
    font-size: 1.2rem;
    font-weight: 700;
    cursor: pointer;
  }
</style>
