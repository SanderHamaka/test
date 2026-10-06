<script>
  import Search from './lib/Search.svelte';
  import GameView from './lib/GameView.svelte';
  import { DEMO_PLACE } from './game/demoCity.js';

  // Half-size of the loaded square in metres. Bigger means more city but a longer download.
  const WORLD_RADIUS = 900;

  let screen = $state('search'); // search | loading | playing | error
  let place = $state(null);
  let world = $state.raw(null);
  let message = $state('');
  let worker;

  function load(selected, demo = false) {
    place = selected;
    screen = 'loading';
    message = 'Preparing…';
    worker?.terminate();
    worker = new Worker(new URL('./game/world.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') message = data.message;
      else if (data.type === 'error') {
        message = data.message;
        screen = 'error';
      } else if (data.type === 'done') {
        world = data.world;
        screen = 'playing';
        worker.terminate();
        worker = null;
      }
    };
    worker.onerror = (e) => {
      message = e.message || 'Something went wrong while building the world.';
      screen = 'error';
    };
    worker.postMessage({ lat: selected.lat, lon: selected.lon, radius: WORLD_RADIUS, demo });
  }

  function exit() {
    worker?.terminate();
    worker = null;
    world = null;
    screen = 'search';
  }
</script>

{#if screen === 'search'}
  <Search onselect={(p) => load(p)} ondemo={() => load(DEMO_PLACE, true)} />
{:else if screen === 'playing'}
  <GameView {world} {place} onexit={exit} />
{:else}
  <main class="loading">
    <h2>{place.name}</h2>
    {#if screen === 'loading'}
      <div class="spinner" aria-hidden="true"></div>
      <p>{message}</p>
    {:else}
      <p class="error">{message}</p>
      <div class="actions">
        <button onclick={() => load(place)}>Try again</button>
        <button class="secondary" onclick={exit}>Choose another place</button>
      </div>
    {/if}
  </main>
{/if}

<style>
  .loading {
    position: fixed;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 1rem;
    padding: 16px;
    text-align: center;
    color: #fff;
    background: linear-gradient(180deg, #4a7fb5 0%, #8fb8dc 100%);
  }

  h2 {
    margin: 0;
    font-size: 2rem;
  }

  p {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .error {
    max-width: 480px;
  }

  .spinner {
    width: 42px;
    height: 42px;
    border: 4px solid #ffffff55;
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.6rem;
  }

  button {
    padding: 0.6rem 1.1rem;
    border: none;
    border-radius: 10px;
    background: #f0b429;
    color: #1d2a36;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  button.secondary {
    background: #ffffff33;
    color: #fff;
  }
</style>
