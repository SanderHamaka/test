<script>
  import { searchPlaces } from './geocode.js';

  let { onselect, ondemo } = $props();

  let query = $state('');
  let results = $state([]);
  let active = $state(-1);
  let status = $state('');

  let timer;
  let controller;

  async function search(text, allowNominatim) {
    controller?.abort();
    controller = new AbortController();
    status = 'Searching…';
    try {
      results = await searchPlaces(text, { signal: controller.signal, allowNominatim });
      active = results.length ? 0 : -1;
      status = results.length ? '' : 'No places found.';
    } catch (error) {
      if (error.name === 'AbortError') return;
      results = [];
      status = allowNominatim ? 'Search is unavailable right now. Try again in a moment.' : 'Press Enter to search.';
    }
  }

  function oninput() {
    clearTimeout(timer);
    const text = query.trim();
    if (text.length < 3) {
      controller?.abort();
      results = [];
      status = '';
      return;
    }
    timer = setTimeout(() => search(text, false), 300);
  }

  function onkeydown(e) {
    if (e.key === 'ArrowDown' && results.length) {
      active = (active + 1) % results.length;
      e.preventDefault();
    } else if (e.key === 'ArrowUp' && results.length) {
      active = (active - 1 + results.length) % results.length;
      e.preventDefault();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[active]) onselect(results[active]);
      else if (query.trim()) {
        clearTimeout(timer);
        search(query.trim(), true);
      }
    }
  }
</script>

<main class="search">
  <div class="panel">
    <h1>Fly like a bird</h1>
    <p class="tagline">Pick any city or town in the world and fly over it.</p>

    <div class="field">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="search"
        placeholder="Search a city, town or landmark…"
        autocomplete="off"
        spellcheck="false"
        autofocus
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls="place-results"
        aria-activedescendant={active >= 0 ? `place-${active}` : undefined}
        bind:value={query}
        {oninput}
        {onkeydown}
      />

      {#if results.length}
        <ul id="place-results" role="listbox">
          {#each results as place, i (place.id)}
            <li id="place-{i}" role="option" aria-selected={i === active}>
              <button class:active={i === active} onclick={() => onselect(place)} onmouseenter={() => (active = i)}>
                <span class="name">{place.name}</span>
                <span class="detail">{place.detail}</span>
                {#if place.type}<span class="type">{place.type}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if status}<p class="status">{status}</p>{/if}

    <button class="demo" onclick={ondemo}>Or try the offline demo city</button>
  </div>

  <footer>
    Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>
    · Search by <a href="https://photon.komoot.io" target="_blank" rel="noreferrer">Photon</a>
  </footer>
</main>

<style>
  .search {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 16px;
    background:
      radial-gradient(ellipse at 50% 120%, #f4c27a55, transparent 60%),
      linear-gradient(180deg, #4a7fb5 0%, #8fb8dc 55%, #dfe9f0 100%);
  }

  .panel {
    width: min(560px, 100%);
    text-align: center;
  }

  h1 {
    margin: 0;
    font-size: clamp(2.4rem, 7vw, 4rem);
    font-weight: 800;
    letter-spacing: -0.03em;
    color: #fff;
    text-shadow: 0 4px 24px #1d3c5c66;
  }

  .tagline {
    margin: 0.4rem 0 1.6rem;
    color: #f2f7fb;
    font-size: 1.1rem;
  }

  .field {
    position: relative;
    text-align: left;
  }

  input {
    width: 100%;
    box-sizing: border-box;
    padding: 1rem 1.2rem;
    border: none;
    border-radius: 14px;
    font: inherit;
    font-size: 1.1rem;
    color: #1d2a36;
    background: #fff;
    box-shadow: 0 10px 40px #1d3c5c40;
    outline: none;
  }

  input:focus-visible {
    box-shadow: 0 10px 40px #1d3c5c40, 0 0 0 3px #f0b429;
  }

  ul {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    right: 0;
    margin: 0;
    padding: 6px;
    list-style: none;
    background: #fff;
    border-radius: 14px;
    box-shadow: 0 10px 40px #1d3c5c40;
    z-index: 1;
  }

  li button {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0 0.8rem;
    width: 100%;
    padding: 0.6rem 0.8rem;
    border: none;
    border-radius: 10px;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
    color: #1d2a36;
  }

  li button.active {
    background: #eef4fa;
  }

  .name {
    font-weight: 600;
  }

  .detail {
    grid-column: 1;
    font-size: 0.85rem;
    color: #5b6b7a;
  }

  .type {
    grid-row: 1 / span 2;
    grid-column: 2;
    align-self: center;
    font-size: 0.75rem;
    color: #7d8b98;
    text-transform: capitalize;
  }

  .status {
    color: #fff;
    margin: 1rem 0 0;
  }

  .demo {
    margin-top: 1.4rem;
    padding: 0.5rem 1rem;
    border: 1px solid #ffffff99;
    border-radius: 999px;
    background: #ffffff22;
    color: #fff;
    font: inherit;
    cursor: pointer;
  }

  .demo:hover {
    background: #ffffff40;
  }

  footer {
    position: fixed;
    bottom: 12px;
    left: 16px;
    right: 16px;
    text-align: center;
    font-size: 0.8rem;
    color: #334a5e;
  }

  footer a {
    color: inherit;
  }
</style>
