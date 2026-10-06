<script>
  import Search from './lib/Search.svelte';
  import GameView from './lib/GameView.svelte';
  import { DEMO_PLACE } from './game/demoCity.js';

  let place = $state(null);
  let demo = $state(false);

  function fly(selected, isDemo = false) {
    demo = isDemo;
    place = selected;
  }
</script>

{#if place}
  {#key place}
    <GameView {place} {demo} onexit={() => (place = null)} />
  {/key}
{:else}
  <Search onselect={(p) => fly(p)} ondemo={() => fly(DEMO_PLACE, true)} />
{/if}
