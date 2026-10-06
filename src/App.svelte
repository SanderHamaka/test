<script>
  import Search from './lib/Search.svelte';
  import Album from './lib/Album.svelte';
  import GameView from './lib/GameView.svelte';
  import { DEMO_PLACE } from './game/demoCity.js';
  import { Progress } from './game/progress.js';

  const progress = new Progress();

  // search → album → flying
  let place = $state(null);
  let demo = $state(false);
  let choice = $state(null); // { species, mode }
  let room = $state(null); // invite code when flying together

  // An invite link (?room=…&lat=…&lon=…&place=…) skips the search and goes straight to the album.
  const params = new URLSearchParams(location.search);
  const lat = parseFloat(params.get('lat')), lon = parseFloat(params.get('lon'));
  if (/^[a-z0-9]{4,12}$/.test(params.get('room') ?? '') && Number.isFinite(lat) && Number.isFinite(lon)) {
    room = params.get('room');
    demo = params.get('demo') === '1';
    place = demo ? DEMO_PLACE : { name: params.get('place') || 'Somewhere', lat, lon };
  }

  function pickPlace(selected, isDemo = false) {
    demo = isDemo;
    place = selected;
    choice = null;
    setRoom(null); // a room belongs to one place
  }

  /** Keeps the room in the address bar, so reloading rejoins it (and the link can be copied from there). */
  function setRoom(code) {
    room = code;
    const url = new URL(location.href);
    url.search = '';
    if (code && place) {
      url.searchParams.set('room', code);
      url.searchParams.set('lat', place.lat.toFixed(5));
      url.searchParams.set('lon', place.lon.toFixed(5));
      url.searchParams.set('place', place.name);
      if (demo) url.searchParams.set('demo', '1');
    }
    history.replaceState(null, '', url);
  }
</script>

{#if !place}
  <Search onselect={(p) => pickPlace(p)} ondemo={() => pickPlace(DEMO_PLACE, true)} />
{:else if !choice}
  <Album {place} {progress} {room} onfly={(c) => (choice = c)} onback={() => { place = null; setRoom(null); }} />
{:else}
  {#key choice}
    <GameView
      {place}
      {demo}
      {progress}
      species={choice.species}
      mode={choice.mode}
      {room}
      onroom={setRoom}
      onexit={() => { place = null; setRoom(null); }}
      onalbum={() => (choice = null)}
    />
  {/key}
{/if}
