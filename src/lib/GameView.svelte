<script>
  import { onMount } from 'svelte';
  import { Game } from '../game/Game.js';

  let { world, place, onexit } = $props();

  let canvas;
  let game;
  let hud = $state({ altitude: 0, speed: 0, edge: false, bump: false });
  let paused = $state(false);
  let showHelp = $state(true);
  let bumpFlash = $state(false);
  let bumpTimer;

  onMount(() => {
    game = new Game(canvas, world, {
      onHud(next) {
        hud = next;
        if (next.bump) {
          bumpFlash = true;
          clearTimeout(bumpTimer);
          bumpTimer = setTimeout(() => (bumpFlash = false), 600);
        }
      },
    });
    const hideHelp = setTimeout(() => (showHelp = false), 12000);
    return () => {
      clearTimeout(hideHelp);
      clearTimeout(bumpTimer);
      game.dispose();
    };
  });

  function setPaused(value) {
    paused = value;
    game.setPaused(value);
  }

  function onkeydown(e) {
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

  {#if hud.edge}<div class="notice">Edge of the map — turning back</div>{/if}
  {#if bumpFlash}<div class="bump"></div>{/if}

  {#if showHelp && !paused}
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
  .notice,
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

  .notice {
    top: 30%;
    left: 50%;
    transform: translateX(-50%);
    padding: 0.5rem 1rem;
    border-radius: 999px;
    background: #0005;
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
