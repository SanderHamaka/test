<script>
  import { SPECIES, FOOD_TYPES, FOOD_LABELS } from '../game/species.js';
  import { BADGES } from '../game/badges.js';
  import { xpForLevel } from '../game/progress.js';

  /** The player's journal: level, birds, badges, records, meals, nests and discovered places. */
  let { progress, onclose } = $props();

  let confirmReset = $state(false);
  let version = $state(0); // bumped after a reset to refresh everything

  const data = $derived.by(() => {
    version;
    const places = Object.entries(progress.places)
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => b.at - a.at);
    return {
      level: progress.level,
      xp: progress.xp,
      next: xpForLevel(progress.level + 1),
      share: progress.levelProgress,
      places,
      unnamed: progress.discovered.size - places.length,
      discovered: progress.discovered.size,
      nests: [...progress.nests].sort((a, b) => b.branches - a.branches),
      records: progress.records,
      eaten: progress.eaten,
      badges: progress.badges,
    };
  });

  const formatSeconds = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const formatDate = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  function reset() {
    if (!confirmReset) {
      confirmReset = true;
      return;
    }
    progress.reset();
    confirmReset = false;
    version++;
  }

  function onkeydown(e) {
    if (e.key === 'Escape' || e.key === 'j' || e.key === 'J') {
      e.stopPropagation();
      onclose();
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="journal" role="dialog" aria-modal="true" aria-label="Journal">
  <div class="page">
    <header>
      <div>
        <h2>Journal</h2>
        <p>Level {data.level} · {data.xp} XP <span class="muted">({data.next - data.xp} to level {data.level + 1})</span></p>
        <div class="xp"><div style="width: {data.share * 100}%"></div></div>
      </div>
      <button class="close" onclick={onclose} aria-label="Close journal">Close</button>
    </header>

    <section>
      <h3>Birds</h3>
      <ul class="birds">
        {#each SPECIES as s (s.id)}
          <li class:locked={s.unlockLevel > data.level}>
            <b>{s.name}</b>
            <span>{s.unlockLevel <= data.level ? 'In your album' : `Unlocks at level ${s.unlockLevel}`}</span>
          </li>
        {/each}
      </ul>
    </section>

    <section>
      <h3>Badges <span class="muted">{Object.keys(data.badges).length} of {BADGES.length}</span></h3>
      <ul class="badges">
        {#each BADGES as b (b.id)}
          <li class:earned={data.badges[b.id]}>
            <b>{b.name}</b>
            <span>{data.badges[b.id] ? `Earned ${formatDate(data.badges[b.id])}` : b.text}</span>
          </li>
        {/each}
      </ul>
    </section>

    <div class="columns">
      <section>
        <h3>Records</h3>
        <dl>
          <dt>Top speed</dt><dd>{data.records.topSpeed} km/h</dd>
          <dt>Highest above ground</dt><dd>{data.records.topHeight} m</dd>
          <dt>Fastest street race</dt><dd>{data.records.bestRace != null ? formatSeconds(data.records.bestRace) : '–'}</dd>
          <dt>Street races</dt><dd>{data.records.challenges.race ?? 0}</dd>
          <dt>Landmark sprints</dt><dd>{data.records.challenges.sprint ?? 0}</dd>
          <dt>Chicks fed</dt><dd>{data.records.challenges.feed ?? 0} times</dd>
          <dt>Hawks shaken off</dt><dd>{data.records.hawkEscapes}</dd>
        </dl>
      </section>

      <section>
        <h3>Meals</h3>
        <dl>
          {#each FOOD_TYPES as t (t)}
            <dt>{FOOD_LABELS[t] === 'a mouse' ? 'mice' : FOOD_LABELS[t]}</dt><dd>{data.eaten[t] ?? 0}</dd>
          {/each}
        </dl>
      </section>

      <section>
        <h3>Nests</h3>
        {#if data.nests.length}
          <ul class="plain">
            {#each data.nests.slice(0, 8) as n (n.id)}
              <li>{n.branches} branches <span class="muted">· {n.lat.toFixed(3)}, {n.lon.toFixed(3)}{n.branches >= 5 ? ' · home' : ''}</span></li>
            {/each}
          </ul>
        {:else}
          <p class="muted">No nests yet. Fly through a tree for a branch, then land to drop it.</p>
        {/if}
      </section>
    </div>

    <section>
      <h3>Places discovered <span class="muted">{data.discovered}</span></h3>
      {#if data.places.length}
        <ul class="places">
          {#each data.places as p (p.id)}
            <li><b>{p.name}</b> <span class="muted">{p.kind} · {formatDate(p.at)}</span></li>
          {/each}
        </ul>
      {/if}
      {#if data.unnamed > 0}<p class="muted">…and {data.unnamed} discovered before the journal kept names.</p>{/if}
      {#if !data.discovered}<p class="muted">Follow the gold markers on the compass to discover places.</p>{/if}
    </section>

    <footer>
      <button class="reset" onclick={reset}>{confirmReset ? 'Really start over? Click again' : 'Start over…'}</button>
      {#if confirmReset}<button class="cancel" onclick={() => (confirmReset = false)}>Keep my progress</button>{/if}
    </footer>
  </div>
</div>

<style>
  .journal {
    position: fixed;
    inset: 0;
    z-index: 10;
    overflow-y: auto;
    padding: 24px 16px;
    box-sizing: border-box;
    background: #0d1a27cc;
    backdrop-filter: blur(6px);
  }

  .page {
    max-width: 860px;
    margin: 0 auto;
    padding: 20px 22px;
    border-radius: 8px;
    background: #f6f1e6;
    color: #1d2a36;
    box-shadow: 0 20px 60px #0008;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 1rem;
  }

  h2 {
    margin: 0;
    font-size: 1.8rem;
  }

  h3 {
    margin: 1.2rem 0 0.5rem;
    font-size: 1.05rem;
  }

  header p {
    margin: 0.2rem 0 0.4rem;
  }

  .muted {
    color: #6b7785;
    font-weight: 400;
  }

  .xp {
    width: 240px;
    height: 6px;
    border-radius: 3px;
    background: #1d2a361f;
    overflow: hidden;
  }

  .xp div {
    height: 100%;
    background: #d99a1c;
  }

  .close,
  .reset,
  .cancel {
    padding: 0.4rem 0.9rem;
    border: 1px solid #1d2a3633;
    border-radius: 999px;
    background: none;
    font: inherit;
    cursor: pointer;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .birds,
  .badges {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 8px;
  }

  .birds li,
  .badges li {
    display: grid;
    gap: 0.1rem;
    padding: 0.55rem 0.7rem;
    border-radius: 8px;
    background: #fffdf8;
    border: 1px solid #1d2a3614;
    font-size: 0.85rem;
  }

  .birds li.locked,
  .badges li:not(.earned) {
    opacity: 0.6;
  }

  .badges li.earned {
    border-color: #d99a1c;
    background: #fff6df;
  }

  .columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0 24px;
  }

  dl {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.25rem 1rem;
    margin: 0;
    font-size: 0.9rem;
  }

  dt {
    text-transform: capitalize;
    color: #4b5866;
  }

  dd {
    margin: 0;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .plain li {
    padding: 0.2rem 0;
    font-size: 0.9rem;
  }

  .places {
    columns: 2 260px;
    font-size: 0.9rem;
  }

  .places li {
    break-inside: avoid;
    padding: 0.2rem 0;
  }

  footer {
    display: flex;
    gap: 0.6rem;
    margin-top: 1.6rem;
    padding-top: 1rem;
    border-top: 1px solid #1d2a361f;
  }

  .reset {
    color: #a23b2c;
    border-color: #a23b2c55;
  }
</style>
