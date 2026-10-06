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
2. **Streaming tiles** (`src/game/TileManager.js`): the world is split into standard zoom-15 map tiles
   (about 750 m across in the Netherlands, 1.2 km at the equator). Tiles within 1.3 km of the bird load
   nearest-first, and tiles more than 2.1 km away are unloaded. The place you picked becomes the world origin
   (0, 0, 0). Each tile's geometry is stored relative to the tile's own centre, so precision holds far from
   the start.
3. **Building a tile** (`src/game/world.worker.js`, two Web Workers):
   - `overpass.js` downloads the tile's OSM data from the [Overpass API](https://overpass-api.de) with GET
     requests stored in the browser's Cache API, so a tile is only ever downloaded once.
   - `terrain.js` decodes [Terrarium](https://registry.opendata.aws/terrain-tiles/) elevation tiles from AWS
     Open Data (same tile grid, so they line up exactly).
   - `osmParse.js` projects coordinates to local metres, stitches multipolygon relations, classifies land
     use, roads, railways and waterways, and estimates building heights.
   - `meshBuilder.js` builds the terrain mesh (with skirts that hide cracks between tiles), extrudes
     buildings onto the lowest ground under them, makes 3D bridge decks, scatters trees in woods and parks
     (kept off roads and water), and packs footprints for collision. Each building, tree and bridge is owned
     by exactly one tile, so nothing appears twice.
   - `groundPainter.js` paints the ground into a 1024 × 1024 texture on an OffscreenCanvas: land use, water,
     roads with sidewalks and centre lines, red cycle paths, railways, and soft contact shadows around
     buildings. Painting instead of layering flat meshes drapes perfectly over hills and never z-fights.
4. **Rendering** (`src/game/Game.js`, `Tile.js`): Three.js with a physical sky, sky-based image lighting,
   shadows that follow the bird, procedural windows, and instanced trees. The terrain shader recognises the
   painted water colour and turns it into glossy, rippling water that reflects the sky. `skyFog.js` fades
   the distance into the sky's horizon colour in every direction, which hides the edge of the loaded tiles.
5. **Flight** (`src/game/Bird.js`, `Colliders.js`): an arcade flight model (banking turns, gravity along
   the flight path, flapping, diving) that follows the terrain, with collisions against building
   footprints across tile borders. You bounce off walls and can skim across rooftops.

In development (`npm run dev`) the game is exposed as `window.__game` for poking at it from the console.

## Data and attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the ODbL.
The attribution is shown on the search screen and in the game. The public Overpass, Photon and Nominatim
servers are shared community resources. For a public release, put a caching proxy in front of them or use
a commercial or self-hosted tile provider.

## Roadmap

- [x] **Phase 1: prototype.** Search, load an area, extruded city, flyable bird, collisions.
- [x] **Phase 2: streaming world.** Map tiles loaded around the bird, terrain elevation, painted ground
      with glossy water, bridges, tile-relative geometry for range.
- [ ] **Phase 3: visuals.** Sea and coastlines, roof shapes, richer facade materials, post-processing
      (SSAO, bloom), day/night cycle with lit windows, distant low-detail terrain, WebGPU renderer.
- [ ] **Phase 4: the game.** Rigged bird model, missions, food, predators, nest, upgrades, sound.
- [ ] **Phase 5: polish.** Touch and gamepad controls, settings, saving progress.
