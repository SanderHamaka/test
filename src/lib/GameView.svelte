<script>
  import { onMount } from 'svelte';
  import { Game, QUALITY } from '../game/Game.js';

  let { place, demo = false, species, mode, progress, onexit, onalbum } = $props();

  let canvas;
  let game;
  let hud = $state({ altitude: 0, speed: 0, bump: false, tiles: null, time: null, stamina: 1, hunger: null, compass: [] });
  let quality = $state(loadSetting('quality', 'high'));
  let hour = $state(12);
  let status = $state({ state: 'loading', message: 'Preparing…' });
  let paused = $state(false);
  let showHelp = $state(true);
  let notes = $state([]);
  let hideHelpTimer;
  let noteId = 0;

  $effect(() => {
    if (status.state === 'ready') hideHelpTimer = setTimeout(() => (showHelp = false), 15000);
    return () => clearTimeout(hideHelpTimer);
  });
  let bumpFlash = $state(false);
  let bumpTimer;

  onMount(() => {
    game = new Game(canvas, place, {
      demo,
      quality,
      species,
      mode,
      progress,
      onStatus: (next) => (status = next),
      onNotify: notify,
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

  /** Short messages stacked at the side; repeated hints are not stacked twice. */
  function notify(text, kind) {
    if (notes.some((n) => n.text === text)) return;
    const id = ++noteId;
    notes = [...notes.slice(-3), { id, text, kind }];
    setTimeout(() => (notes = notes.filter((n) => n.id !== id)), kind === 'hint' ? 2000 : 4500);
  }

  function loadSetting(key, fallback) {
    try {
      return localStorage.getItem(`fly.${key}`) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function saveSetting(key, value) {
    try {
      localStorage.setItem(`fly.${key}`, value);
    } catch {
      // Storage unavailable (private mode): the setting just won't be remembered.
    }
  }

  function setPaused(value) {
    paused = value;
    game.setPaused(value);
    if (value) hour = game.solarHour;
  }

  function setQuality(value) {
    quality = value;
    game.setQuality(value);
    saveSetting('quality', value);
  }

  function setHour(value) {
    hour = value;
    game.setSolarHour(value);
  }

  function resetTime() {
    game.resetTime();
    hour = game.solarHour;
  }

  const formatHour = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
  const formatDistance = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

  // Compass: ±90° around the heading maps onto the bar's width.
  const compassX = (relative) => 50 + (Math.max(-1, Math.min(1, relative / (Math.PI / 2))) * 50);
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const CARDINALS = [['N', 0], ['E', -Math.PI / 2], ['S', Math.PI], ['W', Math.PI / 2]];

  function onkeydown(e) {
    if (status.state !== 'ready') return;
    if (e.key === 'Escape') setPaused(!paused);
    else if (e.key === 'h' || e.key === 'H') showHelp = !showHelp;
    else if (e.key === '[' || e.key === ']') {
      game.nudgeTime(e.key === ']' ? 30 : -30);
      hour = game.solarHour;
    }
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
      {#if hud.time != null}<span title="Local solar time">{formatHour(hud.time)}</span>{/if}
    </div>
    {#if hud.level}
      <div class="level" title="Experience">
        <span>{species.name} · level {hud.level}</span>
        <div class="xp"><div style="width: {hud.levelProgress * 100}%"></div></div>
      </div>
    {/if}
  </div>

  {#if status.state === 'ready' && hud.yaw != null}
    <div class="compass" aria-label="Compass">
      {#each CARDINALS as [label, heading] (label)}
        {@const rel = wrap(hud.yaw - heading)}
        {#if Math.abs(rel) < Math.PI / 2}
          <span class="cardinal" style="left: {compassX(rel)}%">{label}</span>
        {/if}
      {/each}
      {#each hud.compass as mark, i (mark.id)}
        <span class="mark" class:nearest={i === 0} class:edge={Math.abs(mark.relative) > Math.PI / 2} style="left: {compassX(mark.relative)}%">
          <i></i>
          <small>{mark.name}<br />{formatDistance(mark.distance)}</small>
        </span>
      {/each}
    </div>
  {/if}

  {#if hud.tiles?.loading}
    <div class="tiles" title="Map tiles still loading around you">
      <span class="dot"></span> Loading {hud.tiles.loading} map {hud.tiles.loading === 1 ? 'tile' : 'tiles'}
    </div>
  {/if}

  <div class="notes" aria-live="polite">
    {#each notes as note (note.id)}
      <div class="note {note.kind}">{note.text}</div>
    {/each}
  </div>

  {#if bumpFlash}<div class="bump"></div>{/if}

  {#if status.state === 'ready'}
    <div class="meters">
      {#if hud.state === 'perched'}
        <div class="prompt">Resting · <kbd>Space</kbd> or <kbd>W</kbd> to take off · <kbd>A</kbd><kbd>D</kbd> to turn</div>
      {:else if hud.canLand}
        <div class="prompt"><kbd>E</kbd> to land</div>
      {/if}
      <div class="meter stamina" class:low={hud.stamina < 0.2} title="Stamina: flapping uses it, gliding and resting restore it">
        <span>Stamina</span><div><i style="width: {hud.stamina * 100}%"></i></div>
      </div>
      {#if hud.hunger != null}
        <div class="meter hunger" class:low={hud.hunger < 0.25} title="Hunger: eat to keep it up">
          <span>Food</span><div><i style="width: {hud.hunger * 100}%"></i></div>
        </div>
      {/if}
    </div>
  {/if}

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
      <div><kbd>Space</kbd> flap &nbsp; <kbd>Shift</kbd> dive &nbsp; <kbd>E</kbd> land</div>
      <div>Come down onto a roof (or press <kbd>E</kbd>) to land</div>
      <div>Fly through food to eat · follow the compass to discover places</div>
      <div><kbd>[</kbd><kbd>]</kbd> time of day · scroll to zoom</div>
      <div><kbd>H</kbd> help · <kbd>Esc</kbd> pause &amp; settings</div>
    </div>
  {/if}

  {#if paused}
    <div class="pause">
      <h2>Paused</h2>
      <div class="settings">
        <label>
          <span>Time of day <b>{formatHour(hour)}</b></span>
          <input type="range" min="0" max="23.99" step="0.25" value={hour} oninput={(e) => setHour(+e.currentTarget.value)} />
        </label>
        <button class="link" onclick={resetTime}>Use the real time there now</button>
        <label>
          <span>Graphics</span>
          <select value={quality} onchange={(e) => setQuality(e.currentTarget.value)}>
            {#each Object.entries(QUALITY) as [key, q] (key)}
              <option value={key}>{q.label}</option>
            {/each}
          </select>
        </label>
      </div>
      <button onclick={() => setPaused(false)}>Resume</button>
      <button class="secondary" onclick={onalbum}>Change bird</button>
      <button class="secondary" onclick={onexit}>Choose another place</button>
    </div>
  {/if}

  <button class="exit" onclick={onexit} title="Choose another place">New place</button>

  <div class="attribution">
    © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>
    {#if hud.tiles?.heightSource === '3D BAG'}
      · Heights © <a href="https://3dbag.nl" target="_blank" rel="noreferrer">3DBAG</a> by tudelft3d and 3DGI
    {/if}
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

  .level {
    display: grid;
    gap: 0.2rem;
    margin-top: 0.35rem;
    font-size: 0.85rem;
  }

  .xp {
    width: 180px;
    height: 5px;
    border-radius: 3px;
    background: #ffffff40;
    overflow: hidden;
  }

  .xp div {
    height: 100%;
    background: #f0b429;
  }

  .compass {
    position: absolute;
    top: 14px;
    left: 50%;
    width: min(460px, 50vw);
    height: 30px;
    transform: translateX(-50%);
    border-bottom: 2px solid #ffffffaa;
    background: linear-gradient(90deg, transparent, #00000026 20%, #00000026 80%, transparent);
    color: #fff;
    text-shadow: 0 1px 3px #000a;
    pointer-events: none;
  }

  .cardinal {
    position: absolute;
    bottom: 4px;
    transform: translateX(-50%);
    font-weight: 700;
    font-size: 0.85rem;
  }

  .mark {
    position: absolute;
    top: 100%;
    display: grid;
    justify-items: center;
    transform: translateX(-50%);
    text-align: center;
  }

  .mark i {
    width: 10px;
    height: 10px;
    margin-top: -6px;
    border-radius: 50%;
    background: #f0b429;
    box-shadow: 0 0 8px #f0b429;
  }

  .mark small {
    margin-top: 2px;
    font-size: 0.7rem;
    line-height: 1.15;
    white-space: nowrap;
    opacity: 0;
  }

  .mark.nearest small {
    opacity: 1;
  }

  .mark.edge i {
    opacity: 0.5;
  }

  .notes {
    position: absolute;
    top: 110px;
    right: 16px;
    display: grid;
    gap: 6px;
    justify-items: end;
    pointer-events: none;
  }

  .note {
    max-width: 320px;
    padding: 0.45rem 0.8rem;
    border-radius: 10px;
    background: #0d1a27b3;
    backdrop-filter: blur(6px);
    color: #fff;
    font-size: 0.9rem;
    animation: slide-in 0.25s ease-out;
  }

  .note.discovery {
    border-left: 3px solid #f0b429;
  }

  .note.level {
    background: #b7791fe6;
    font-weight: 700;
  }

  .note.danger {
    border-left: 3px solid #ff6b5b;
  }

  .note.food {
    border-left: 3px solid #8fd16a;
  }

  @keyframes slide-in {
    from {
      transform: translateX(20px);
      opacity: 0;
    }
  }

  .meters {
    position: absolute;
    left: 50%;
    bottom: 34px;
    display: grid;
    justify-items: center;
    gap: 6px;
    transform: translateX(-50%);
    color: #fff;
    text-shadow: 0 1px 3px #000a;
    font-size: 0.8rem;
    pointer-events: none;
  }

  .prompt {
    padding: 0.3rem 0.7rem;
    border-radius: 999px;
    background: #0005;
  }

  .meter {
    display: grid;
    grid-template-columns: 56px 220px;
    align-items: center;
    gap: 8px;
  }

  .meter div {
    height: 7px;
    border-radius: 4px;
    background: #ffffff33;
    overflow: hidden;
  }

  .meter i {
    display: block;
    height: 100%;
    border-radius: 4px;
    background: #7fd0ff;
    transition: width 0.1s linear;
  }

  .meter.hunger i {
    background: #8fd16a;
  }

  .meter.low i {
    background: #ff6b5b;
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

  .settings {
    display: grid;
    gap: 0.6rem;
    min-width: 280px;
    margin-bottom: 0.6rem;
    padding: 0.9rem 1rem;
    border-radius: 12px;
    background: #ffffff14;
    text-align: left;
  }

  .settings label {
    display: grid;
    gap: 0.3rem;
  }

  .settings label span {
    display: flex;
    justify-content: space-between;
    font-size: 0.9rem;
  }

  .settings input[type='range'] {
    width: 100%;
    accent-color: #f0b429;
  }

  .settings select {
    padding: 0.4rem 0.5rem;
    border: none;
    border-radius: 8px;
    font: inherit;
  }

  .pause .settings button.link {
    min-width: 0;
    padding: 0;
    background: none;
    color: #f0b429;
    font-weight: 400;
    text-align: left;
    text-decoration: underline;
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
