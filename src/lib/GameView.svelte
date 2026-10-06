<script>
  import { onMount } from 'svelte';
  import { Game } from '../game/Game.js';

  let { place, demo = false, onexit } = $props();

  let canvas;
  let game;
  let hud = $state({ altitude: 0, speed: 0, bump: false, tiles: null });
  let status = $state({ state: 'loading', message: 'Preparing…' });
  let paused = $state(false);
  let showHelp = $state(true);
  let hideHelpTimer;

  $effect(() => {
    if (status.state === 'ready') hideHelpTimer = setTimeout(() => (showHelp = false), 12000);
    return () => clearTimeout(hideHelpTimer);
  });
  let bumpFlash = $state(false);
  let bumpTimer;

  onMount(() => {
    game = new Game(canvas, place, {
      demo,
      onStatus: (next) => (status = next),
      onHud(next) {
        hud = next;
        if (next.bump) {
          bumpFlash = true;
          clearTimeout(bumpTimer);
          bumpTimer = setTimeout(() => (bumpFlash = false), 600);
        }
      },
    });
    return () => {
      clearTimeout(bumpTimer);
      game.dispose();
    };
  });

  function setPaused(value) {
    paused = value;
    game.setPaused(value);
  }

  function onkeydown(e) {
    if (status.state !== 'ready') return;
    if (e.key === 'Escape') setPaused(!paused);
    else if (e.key === 'h' || e.key === 'H') showHelp = !showHelp;
  }
</script>

<svelte:window {onkeydown} />

<div class="game">
  <canvas bind:this={canvas}></canvas>

  <div class="hud top">
    <div class="place">{place.name}</div>
    <div class="stats">
      <span><b>{Math.round(hud.altitude)}</b> m</span>
      <span><b>{Math.round(hud.speed)}</b> km/h</span>
    </div>
  </div>

  {#if hud.tiles?.loading}
    <div class="tiles" title="Map tiles still loading around you">
      <span class="dot"></span> Loading {hud.tiles.loading} map {hud.tiles.loading === 1 ? 'tile' : 'tiles'}
    </div>
  {/if}
  {#if bumpFlash}<div class="bump"></div>{/if}

  {#if status.state !== 'ready'}
    <div class="loading">
      <h2>{place.name}</h2>
      {#if status.state === 'loading'}
        <div class="spinner" aria-hidden="true"></div>
        <p>{status.message}</p>
      {:else}
        <p class="error">{status.message}</p>
        <button onclick={onexit}>Choose another place</button>
      {/if}
    </div>
  {:else if showHelp && !paused}
    <div class="help">
      <div><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd> bank &amp; turn</div>
      <div><kbd>W</kbd><kbd>S</kbd> / <kbd>↑</kbd><kbd>↓</kbd> climb &amp; descend</div>
      <div><kbd>Space</kbd> flap &nbsp; <kbd>Shift</kbd> dive</div>
      <div>Scroll to zoom · <kbd>H</kbd> help · <kbd>Esc</kbd> pause</div>
    </div>
  {/if}

  {#if paused}
    <div class="pause">
      <h2>Paused</h2>
      <button onclick={() => setPaused(false)}>Resume</button>
      <button class="secondary" onclick={onexit}>Choose another place</button>
    </div>
  {/if}

  <button class="exit" onclick={onexit} title="Choose another place">New place</button>

  <div class="attribution">
    © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>
  </div>
</div>

<style>
  .game {
    position: fixed;
    inset: 0;
    background: #9cc0de;
    user-select: none;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  .hud,
  .help,
  .exit,
  .attribution {
    position: absolute;
    color: #fff;
    text-shadow: 0 1px 4px #0008;
  }

  .top {
    top: 16px;
    left: 16px;
  }

  .place {
    font-size: 1.4rem;
    font-weight: 700;
  }

  .stats {
    display: flex;
    gap: 1rem;
    margin-top: 0.2rem;
    font-variant-numeric: tabular-nums;
  }

  .stats b {
    font-size: 1.2rem;
  }

  .exit {
    top: 16px;
    right: 16px;
    padding: 0.45rem 0.9rem;
    border: 1px solid #ffffff88;
    border-radius: 999px;
    background: #0003;
    font: inherit;
    cursor: pointer;
    backdrop-filter: blur(6px);
  }

  .help {
    left: 16px;
    bottom: 40px;
    display: grid;
    gap: 0.35rem;
    padding: 0.8rem 1rem;
    border-radius: 12px;
    background: #0004;
    backdrop-filter: blur(6px);
    font-size: 0.9rem;
  }

  kbd {
    display: inline-block;
    min-width: 1.4em;
    margin-right: 0.15em;
    padding: 0.05em 0.35em;
    border: 1px solid #fff8;
    border-radius: 5px;
    font: inherit;
    font-size: 0.8rem;
    text-align: center;
  }

  .tiles {
    position: absolute;
    top: 64px;
    right: 16px;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.3rem 0.7rem;
    border-radius: 999px;
    background: #0003;
    backdrop-filter: blur(6px);
    color: #fff;
    font-size: 0.8rem;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #f0b429;
    animation: pulse 1s ease-in-out infinite alternate;
  }

  @keyframes pulse {
    to {
      opacity: 0.3;
    }
  }

  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 1rem;
    padding: 16px;
    text-align: center;
    color: #fff;
    background: linear-gradient(180deg, #4a7fb5e6 0%, #8fb8dce6 100%);
  }

  .loading h2 {
    margin: 0;
    font-size: 2rem;
  }

  .loading p {
    margin: 0;
    max-width: 480px;
  }

  .loading button {
    padding: 0.6rem 1.1rem;
    border: none;
    border-radius: 10px;
    background: #f0b429;
    color: #1d2a36;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
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

  .bump {
    position: absolute;
    inset: 0;
    pointer-events: none;
    box-shadow: inset 0 0 120px #ff3b3077;
    animation: fade 0.6s ease-out forwards;
  }

  @keyframes fade {
    to {
      opacity: 0;
    }
  }

  .pause {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    gap: 0.8rem;
    background: #0d1a2799;
    backdrop-filter: blur(4px);
    color: #fff;
    text-align: center;
  }

  .pause h2 {
    margin: 0 0 0.5rem;
    font-size: 2rem;
  }

  .pause button {
    min-width: 240px;
    padding: 0.7rem 1.2rem;
    border: none;
    border-radius: 12px;
    background: #f0b429;
    color: #1d2a36;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .pause button.secondary {
    background: #ffffff22;
    color: #fff;
  }

  .attribution {
    right: 12px;
    bottom: 8px;
    font-size: 0.75rem;
  }

  .attribution a {
    color: inherit;
  }
</style>
