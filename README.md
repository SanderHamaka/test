# Fly Like a Bird — anywhere

A browser game inspired by *Fly Like a Bird 3*: search for any city or town in the world, and the game
builds it in 3D from OpenStreetMap data so you can fly over and between its buildings.

Built with Svelte 5, Three.js and Vite.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

The game needs network access to the map services in the browser (see below). The **offline demo city**
button on the start screen runs the same pipeline on generated data, which is handy for development.

## Controls

| Key | Action |
| --- | --- |
| `A` `D` / `←` `→` | Bank and turn |
| `W` `S` / `↑` `↓` | Climb and descend |
| `Space` (hold) | Flap: thrust and lift |
| `Shift` (hold) | Dive: tuck wings, fast descent |
| Mouse wheel | Camera distance |
| `H` / `Esc` | Help / pause |

## How it works

1. **Search** (`src/lib/Search.svelte`, `src/lib/geocode.js`): search-as-you-type through
   [Photon](https://photon.komoot.io). [Nominatim](https://nominatim.org) is the fallback, used only when you
   press Enter, because its usage policy doesn't allow autocomplete.
2. **Download** (`src/game/overpass.js`): one [Overpass API](https://overpass-api.de) query for an
   area of about 1.8 × 1.8 km gets buildings, roads, water, green areas and trees. It tries a few public
   endpoints in turn.
3. **Build** (`src/game/world.worker.js`): runs in a Web Worker so the page stays responsive.
   - `osmParse.js` projects coordinates to local metres, stitches multipolygon relations, classifies
     features and estimates building heights from `height`, `building:levels` or the building type.
   - `meshBuilder.js` extrudes buildings (walls plus earcut-triangulated roofs, with courtyards), makes road
     and river ribbons and flat areas, scatters trees in parks and forests, and packs footprints for
     collision. Buildings are grouped into 250 m chunks so off-screen chunks are culled. All buffers are
     transferred to the main thread without copying.
4. **Render** (`src/game/Game.js`, `World.js`): Three.js with a physical sky, sky-based image lighting,
   shadows that follow the bird, procedural windows in the building shader, and instanced trees.
   `skyFog.js` fades the distance into the sky's own horizon colour in every direction, which hides the
   edge of the loaded area.
5. **Fly** (`src/game/Bird.js`, `Colliders.js`): an arcade flight model (banking turns, gravity along
   the flight path, flapping, diving) with collisions against building footprints from a spatial grid.
   You bounce off walls and can skim across rooftops.

## Data and attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the ODbL.
The attribution is shown on the search screen and in the game. The public Overpass, Photon and Nominatim
servers are shared community resources. For a public release, put a caching proxy in front of them or use
a commercial or self-hosted tile provider.

## Roadmap

- [x] **Phase 1: prototype.** Search, load an area, extruded city, flyable bird, collisions.
- [ ] **Phase 2: streaming world.** Vector tiles loaded around the bird, terrain elevation, bridges,
      floating origin for unlimited range.
- [ ] **Phase 3: visuals.** Roof shapes, richer facade materials, animated water, post-processing (SSAO,
      bloom), day/night cycle with lit windows, WebGPU renderer.
- [ ] **Phase 4: the game.** Rigged bird model, missions, food, predators, nest, upgrades, sound.
- [ ] **Phase 5: polish.** Touch and gamepad controls, settings, saving progress.
