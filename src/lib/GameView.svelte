<script>
  import { onMount } from 'svelte';
  import { Game, QUALITY } from '../game/Game.js';
  import { WEATHER } from '../game/weather.js';
  import TouchControls from './TouchControls.svelte';
  import Journal from './Journal.svelte';

  let { place, demo = false, species, mode, progress, onexit, onalbum } = $props();

  let canvas;
  let game;
  let hud = $state({ altitude: 0, speed: 0, bump: false, tiles: null, time: null, stamina: 1, hunger: null, compass: [] });
  let quality = $state(loadSetting('quality', 'high'));
  let weather = $state(loadSetting('weather', 'real'));
  let hour = $state(12);
  let status = $state({ state: 'loading', message: 'Preparing…' });
  let paused = $state(false);
  let showHelp = $state(true);
  let notes = $state([]);
  let board = $state(null); // challenge offers while the board is open
  let volume = $state(+loadSetting('volume', '0.7'));
  let invertClimb = $state(loadSetting('invertClimb', 'no') === 'yes');
  let cameraDistance = $state(+loadSetting('cameraDistance', '9'));
  let journalOpen = $state(false);
  // Touch controls on phones and tablets (or as soon as someone touches the screen).
  let touch = $state(typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches);
  let muted = $state(false);
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
      weather,
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
    game.sound.setVolume(volume);
    game.input.invertClimb = invertClimb;
    game.cameraDistance = cameraDistance;
    game.input.onButton = (button) => {
      if (status.state !== 'ready' || journalOpen) return;
      if (button === 'pause') {
        if (board) closeBoard();
        else setPaused(!paused);
      } else if (button === 'challenges' && !paused && !board) openBoard();
    };
    const touched = () => (touch = true);
    window.addEventListener('touchstart', touched, { once: true });
    // Browsers only start audio after a gesture; any key or click will do.
    const unlock = () => game.sound.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('touchstart', touched);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      clearTimeout(bumpTimer);
      game.dispose();
    };
  });

  /** Short messages stacked at the side; repeated hints are not stacked twice. */
  function notify(text, kind) {
    if (notes.some((n) => n.text === text)) return;
    const id = ++noteId;
    notes = [...notes.slice(-3), { id, text, kind }];
    setTimeout(() => (notes = notes.filter((n) => n.id !== id)), { hint: 2000, 'hint-long': 7000 }[kind] ?? 4500);
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

  function setInvert(value) {
    invertClimb = value;
    game.input.invertClimb = value;
    saveSetting('invertClimb', value ? 'yes' : 'no');
  }

  function setCameraDistance(value) {
    cameraDistance = value;
    game.cameraDistance = value;
    saveSetting('cameraDistance', String(value));
  }

  function openJournal() {
    journalOpen = true;
    game.setPaused(true);
  }

  function closeJournal() {
    journalOpen = false;
    game.setPaused(paused || !!board);
  }

  function setWeather(value) {
    weather = value;
    game.setWeatherMode(value);
    saveSetting('weather', value);
  }

  // Weather button: cycles through the real weather and every preset.
  const WEATHER_CYCLE = ['real', ...Object.keys(WEATHER)];
  function cycleWeather() {
    setWeather(WEATHER_CYCLE[(WEATHER_CYCLE.indexOf(weather) + 1) % WEATHER_CYCLE.length]);
  }

  // Sun arc: a half circle where the left end is midnight, the top noon and the right end midnight again.
  const ARC = { cx: 120, cy: 112, r: 96 };
  const arcPoint = (h) => {
    const th = (1 - h / 24) * Math.PI;
    return { x: ARC.cx + ARC.r * Math.cos(th), y: ARC.cy - ARC.r * Math.sin(th) };
  };
  let dragging = false;
  function hourFromPointer(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 240, y = ((e.clientY - r.top) / r.height) * 130;
    let th = Math.atan2(ARC.cy - y, x - ARC.cx);
    if (th < 0) th = x < ARC.cx ? Math.PI : 0;
    return (1 - Math.min(Math.PI, Math.max(0, th)) / Math.PI) * 23.99;
  }
  function arcDown(e) {
    dragging = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setHour(hourFromPointer(e));
    e.preventDefault();
  }
  function arcMove(e) {
    if (dragging) setHour(hourFromPointer(e));
  }
  function arcKey(e) {
    const steps = { ArrowLeft: -0.25, ArrowRight: 0.25, ArrowDown: -1, ArrowUp: 1 };
    if (!(e.key in steps)) return;
    e.preventDefault();
    e.stopPropagation();
    setHour((((hud.time ?? 12) + steps[e.key]) % 24 + 24) % 24);
  }
  // Accent: warm amber by day, cool moonlight blue at night.
  const accent = (night) => `rgb(${Math.round(255 - 86 * night)} ${Math.round(179 + 20 * night)} ${Math.round(71 + 184 * night)})`;

  function setVolume(value) {
    volume = value;
    game.sound.setVolume(value);
    saveSetting('volume', String(value));
  }

  function openBoard() {
    board = game.challengeOffers();
    game.setPaused(true);
  }

  function closeBoard() {
    board = null;
    game.setPaused(false);
  }

  function startChallenge(offer) {
    game.startChallenge(offer);
    closeBoard();
  }

  function abandonChallenge() {
    game.cancelChallenge();
    closeBoard();
  }

  const formatSeconds = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

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
    if (status.state !== 'ready' || journalOpen) return;
    if (e.key === 'j' || e.key === 'J') {
      openJournal();
      return;
    }
    if (board) {
      if (e.key === 'Escape' || e.key === 'c' || e.key === 'C') closeBoard();
      return;
    }
    if (e.key === 'c' || e.key === 'C') {
      if (!paused) openBoard();
      return;
    }
    if (e.key === 'm' || e.key === 'M') {
      muted = game.sound.toggleMute();
      notify(muted ? 'Sound off (M)' : 'Sound on (M)', 'hint');
      return;
    }
    if (e.key === 'Escape') setPaused(!paused);
    else if (e.key === 'h' || e.key === 'H') showHelp = !showHelp;
    else if (e.key === '[' || e.key === ']') {
      game.nudgeTime(e.key === ']' ? 30 : -30);
      hour = game.solarHour;
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="game" class:touch={touch && status.state === 'ready'}>
  <canvas bind:this={canvas}></canvas>

  <div class="hud top">
    <div class="place">{place.name}</div>
    <div class="stats">
      <span><b>{Math.round(hud.altitude)}</b> m</span>
      <span><b>{Math.round(hud.speed)}</b> km/h</span>
      {#if hud.time != null}<span title="Local solar time">{formatHour(hud.time)}</span>{/if}
      {#if hud.weather}<span class="weather">{hud.weather}</span>{/if}
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
        <span class="mark" class:home={mark.home} class:target={mark.target} class:nearest={i === 0 || mark.home || mark.target} class:edge={Math.abs(mark.relative) > Math.PI / 2} style="left: {compassX(mark.relative)}%">
          <i></i>
          <small>{mark.name}<br />{formatDistance(mark.distance)}</small>
        </span>
      {/each}
    </div>
  {/if}

  {#if hud.challenge}
    <div class="challenge" class:urgent={hud.challenge.timeLeft < 15}>
      <b>{hud.challenge.title}</b>
      <span>{hud.challenge.detail}</span>
      <span class="clock">{formatSeconds(hud.challenge.timeLeft)}</span>
    </div>
  {/if}

  {#if hud.hawk}
    <div class="hawk" class:diving={hud.hawk === 'diving'}>
      {hud.hawk === 'diving' ? 'Hawk diving! Get low!' : 'Hawk overhead'}
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
      {#if hud.carryingFood}
        <div class="prompt">Carrying food for the chicks · land on your nest</div>
      {/if}
      {#if hud.carrying}
        <div class="prompt">Carrying a branch · land to drop it (within 2 m of a nest to add to it)</div>
      {/if}
      {#if hud.state === 'perched'}
        {#if touch}
          <div class="prompt">Resting · Flap or push the stick up to take off</div>
        {:else}
          <div class="prompt">Resting · <kbd>Space</kbd> or <kbd>W</kbd> to take off · <kbd>A</kbd><kbd>D</kbd> to turn</div>
        {/if}
      {:else if hud.canLand}
        <div class="prompt">{#if touch}Tap Land to land{:else}<kbd>E</kbd> to land{/if}</div>
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
  {:else if showHelp && !paused && !touch}
    <div class="help">
      <div><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd> bank &amp; turn</div>
      <div><kbd>W</kbd><kbd>S</kbd> / <kbd>↑</kbd><kbd>↓</kbd> climb &amp; descend</div>
      <div><kbd>Space</kbd> flap &nbsp; <kbd>Shift</kbd> dive &nbsp; <kbd>E</kbd> land</div>
      <div>Come down onto a roof (or press <kbd>E</kbd>) to land</div>
      <div>Fly through food to eat · follow the compass to discover places</div>
      <div>Fly through a tree for a branch, then land to build a nest</div>
      <div><kbd>C</kbd> challenges · <kbd>M</kbd> sound on/off</div>
      <div><kbd>[</kbd><kbd>]</kbd> time of day · scroll to zoom</div>
      <div><kbd>J</kbd> journal · <kbd>H</kbd> help · <kbd>Esc</kbd> pause &amp; settings</div>
      <div class="muted-help">Gamepads work too: left stick, A flap, right trigger dive, B land</div>
    </div>
  {/if}

  {#if board}
    <div class="pause board">
      <h2>Challenges</h2>
      {#if hud.challenge}
        <p>Busy with <b>{hud.challenge.title}</b> ({hud.challenge.detail}).</p>
        <button onclick={abandonChallenge}>Abandon it</button>
        <button class="secondary" onclick={closeBoard}>Keep going</button>
      {:else}
        <div class="offers">
          {#each board as offer (offer.type)}
            <button class="offer" disabled={!offer.available} onclick={() => startChallenge(offer)}>
              <b>{offer.title}</b>
              <span>{offer.text}</span>
            </button>
          {/each}
        </div>
        <button class="secondary" onclick={closeBoard}>Back to flying</button>
      {/if}
    </div>
  {:else if paused}
    <div class="pause">
      <h2>Paused</h2>
      <div class="settings">
        <label>
          <span>Time of day <b>{formatHour(hour)}</b></span>
          <input type="range" min="0" max="23.99" step="0.25" value={hour} oninput={(e) => setHour(+e.currentTarget.value)} />
        </label>
        <button class="link" onclick={resetTime}>Use the real time there now</button>
        <label>
          <span>Weather</span>
          <select value={weather} onchange={(e) => setWeather(e.currentTarget.value)}>
            <option value="real">Real weather there now</option>
            {#each Object.entries(WEATHER) as [key, w] (key)}
              <option value={key}>{w.label}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Volume <b>{muted ? 'muted' : `${Math.round(volume * 100)}%`}</b></span>
          <input type="range" min="0" max="1" step="0.05" value={volume} oninput={(e) => setVolume(+e.currentTarget.value)} />
        </label>
        <label class="check">
          <input type="checkbox" checked={invertClimb} onchange={(e) => setInvert(e.currentTarget.checked)} />
          <span>Invert up/down (push forward to climb)</span>
        </label>
        <label>
          <span>Camera distance <b>{Math.round(cameraDistance)} m</b></span>
          <input type="range" min="4" max="30" step="1" value={cameraDistance} oninput={(e) => setCameraDistance(+e.currentTarget.value)} />
        </label>
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
      <button class="secondary" onclick={openJournal}>Journal</button>
      <button class="secondary" onclick={onalbum}>Change bird</button>
      <button class="secondary" onclick={onexit}>Choose another place</button>
    </div>
  {/if}

  <button class="exit" onclick={onexit} title="Choose another place">New place</button>

  {#if touch && status.state === 'ready' && !paused && !board && !journalOpen}
    <TouchControls input={game.input} onpause={() => setPaused(true)} onchallenges={openBoard} />
  {/if}

  {#if journalOpen}
    <Journal {progress} onclose={closeJournal} />
  {/if}

  {#if status.state === 'ready' && hud.time != null}
    {@const sun = arcPoint(hud.time)}
    <div class="sky-controls" style="--accent: {accent(hud.night ?? 0)}">
      <svg
        viewBox="0 0 240 130"
        class="arc"
        role="slider"
        tabindex="0"
        aria-label="Time of day (drag the sun)"
        aria-valuemin="0"
        aria-valuemax="24"
        aria-valuenow={hud.time.toFixed(2)}
        aria-valuetext={formatHour(hud.time)}
        onpointerdown={arcDown}
        onpointermove={arcMove}
        onpointerup={(e) => { dragging = false; e.currentTarget.blur(); }}
        onpointercancel={() => (dragging = false)}
        onkeydown={arcKey}
      >
        <path d="M 24 112 A 96 96 0 0 1 216 112" class="track" />
        <line x1="10" y1="112" x2="230" y2="112" class="horizon" />
        <circle cx={sun.x} cy={sun.y} r="16" class="glow" />
        <circle cx={sun.x} cy={sun.y} r="8" class="sun" />
      </svg>
      <div class="sky-row">
        {#if touch && hud.tiles?.loading}<span class="dot" title="Map tiles still loading around you"></span>{/if}
        <span class="clock">{formatHour(hud.time)}</span>
        <!-- Blur after a click so Space (flap) and the arrow keys go back to flying. -->
        <button class="chip" onclick={(e) => { resetTime(); e.currentTarget.blur(); }} title="Back to the real time at this place">Now</button>
        <button class="chip" onclick={(e) => { cycleWeather(); e.currentTarget.blur(); }} title="Change the weather">
          {weather === 'real' ? `${hud.weather ?? 'Clear'} · real` : hud.weather}
        </button>
      </div>
    </div>
  {/if}

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

  .mark.home i {
    border-radius: 2px;
    background: #8fd16a;
    box-shadow: 0 0 8px #8fd16a;
    transform: rotate(45deg);
  }

  .mark.target i {
    background: #ff8a3d;
    box-shadow: 0 0 10px #ff8a3d;
    width: 12px;
    height: 12px;
  }

  .mark.edge i {
    opacity: 0.5;
  }

  .challenge {
    position: absolute;
    top: 112px;
    left: 16px;
    display: grid;
    gap: 0.1rem;
    padding: 0.55rem 0.8rem;
    border-left: 3px solid #ff8a3d;
    border-radius: 10px;
    background: #0d1a27b3;
    backdrop-filter: blur(6px);
    color: #fff;
    font-size: 0.9rem;
  }

  .challenge .clock {
    font-size: 1.3rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .challenge.urgent .clock {
    color: #ff6b5b;
  }

  .hawk {
    position: absolute;
    top: 76px;
    left: 50%;
    transform: translateX(-50%);
    padding: 0.35rem 0.9rem;
    border-radius: 999px;
    background: #7a2a1fcc;
    color: #fff;
    font-weight: 600;
    pointer-events: none;
  }

  .hawk.diving {
    background: #d63a2b;
    animation: pulse-bg 0.5s ease-in-out infinite alternate;
  }

  @keyframes pulse-bg {
    to {
      transform: translateX(-50%) scale(1.08);
    }
  }

  .board p {
    margin: 0 0 0.6rem;
  }

  .offers {
    display: grid;
    gap: 0.6rem;
    width: min(520px, calc(100vw - 32px));
    margin-bottom: 0.4rem;
  }

  .pause .offer {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
    padding: 0.8rem 1rem;
    border-radius: 12px;
    background: #fffdf8;
    color: #1d2a36;
    font-weight: 400;
    text-align: left;
  }

  .pause .offer b {
    font-size: 1.05rem;
  }

  .pause .offer:disabled {
    opacity: 0.55;
    cursor: not-allowed;
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

  .sky-controls {
    position: absolute;
    right: 16px;
    bottom: 34px;
    display: grid;
    justify-items: center;
    gap: 2px;
    width: 170px;
    color: #fff;
    text-shadow: 0 1px 3px #000a;
  }

  .arc {
    width: 100%;
    cursor: grab;
    touch-action: none;
    outline: none;
  }

  .arc:focus-visible .track {
    stroke: var(--accent);
  }

  .arc .track {
    fill: none;
    stroke: #ffffff66;
    stroke-width: 2;
    stroke-dasharray: 3 5;
  }

  .arc .horizon {
    stroke: #ffffff40;
    stroke-width: 1;
  }

  .arc .sun {
    fill: var(--accent);
  }

  .arc .glow {
    fill: var(--accent);
    opacity: 0.3;
  }

  .sky-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .sky-row .clock {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .chip {
    padding: 0.15rem 0.55rem;
    border: 1px solid #ffffff66;
    border-radius: 999px;
    background: #0003;
    color: #fff;
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
    backdrop-filter: blur(6px);
  }

  .chip:hover {
    border-color: var(--accent);
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

  .settings label.check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .settings label.check span {
    display: inline;
  }

  .muted-help {
    opacity: 0.75;
    font-size: 0.8rem;
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
  /* Phones and narrow windows: the top bar stacks, so the compass and panels move down below it. */
  @media (max-width: 720px) {
    .place {
      font-size: 1.1rem;
    }

    .stats {
      gap: 0.6rem;
      font-size: 0.85rem;
    }

    .stats b {
      font-size: 1rem;
    }

    .stats .weather {
      display: none;
    }

    .compass {
      top: 104px;
      width: min(460px, calc(100vw - 48px));
    }

    .mark small {
      font-size: 0.62rem;
    }

    .hawk {
      top: 166px;
    }

    .challenge {
      top: 190px;
    }

    .notes {
      top: 190px;
    }

    .note {
      max-width: min(320px, 60vw);
      font-size: 0.8rem;
    }
  }

  /* Touch screens: Menu holds "Choose another place", the sky controls shrink to their chips at the
     top right, and the meters sit low between the joystick and the buttons. */
  .touch .exit {
    display: none;
  }

  .touch .tiles {
    display: none; /* a dot in the sky row instead */
  }

  .touch .sky-controls {
    top: 56px;
    bottom: auto;
    width: auto;
  }

  .touch .arc,
  .touch .sky-controls .clock {
    display: none;
  }

  .touch .meters {
    bottom: 28px;
    max-width: calc(100vw - 32px);
  }

  .touch .meter {
    grid-template-columns: 44px min(140px, 32vw);
  }

  .touch .prompt {
    max-width: 52vw;
    text-align: center;
  }

  .touch .notes {
    top: 136px;
  }

  @media (max-width: 720px) {
    .touch .notes {
      top: 190px;
    }
  }

</style>
