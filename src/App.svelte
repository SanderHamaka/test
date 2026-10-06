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

  function pickPlace(selected, isDemo = false) {
    demo = isDemo;
    place = selected;
    choice = null;
  }
</script>

{#if !place}
  <Search onselect={(p) => pickPlace(p)} ondemo={() => pickPlace(DEMO_PLACE, true)} />
{:else if !choice}
  <Album {place} {progress} onfly={(c) => (choice = c)} onback={() => (place = null)} />
{:else}
  {#key choice}
    <GameView
      {place}
      {demo}
      {progress}
      species={choice.species}
      mode={choice.mode}
      onexit={() => (place = null)}
      onalbum={() => (choice = null)}
    />
  {/key}
{/if}
