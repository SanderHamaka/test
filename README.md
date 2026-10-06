# Birb

An open-world bird game for the browser: search for any city or town in the world, and the game
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
| `E` | Land on the roof or ground below you; `Space` or `W` takes off again |
| Mouse wheel | Camera distance |
| `C` | Challenge board: start or abandon a challenge |
| `M` | Sound on/off (volume is in the pause menu) |
| `[` `]` | Time of day −/+ 30 minutes |
| `H` / `Esc` | Help / pause and settings (time of day, graphics quality) |

You also land by simply coming down onto a roof or the ground nose-first (or slowly), or by clipping the
top of a wall. Flying level over a roof skims it instead.

## Playing

After picking a place you choose a bird from the **album**: the herring gull and rock pigeon are there
from the start, the carrion crow unlocks at level 3 and the common kestrel at level 5. Each flies
differently (speed, agility, gliding, stamina) and prefers different food.

- **Free roam** is relaxed: fly, explore and snack. Flapping uses stamina; gliding and resting restore it.
- **Challenge** adds hunger. Hungry birds recover stamina slowly, starving birds can't flap, and landing
  while starving makes you faint (you lose a quarter of the XP earned within your current level).

Food comes from the real map: fish over water, insects over parks, seeds on fields and squares, scraps
by snack bars, cafés and markets, mice in grassland. Fly through it to eat. Named landmarks (churches,
towers, museums, stations, windmills…) show on the compass and under a faint beam of light; fly close to
discover them. XP from food and discoveries raises your level. Progress is saved in the browser.

**Challenges** are optional; press `C` to pick one:

- *Street race*: fly through rings that follow real streets and canals before the clock runs out.
- *Landmark sprint*: reach a named landmark in time.
- *Feed the chicks*: with a home nest nearby, carry three meals home (food you fly through is carried
  instead of eaten; land on the nest to deliver).

**The hawk** (challenge mode) turns up every few minutes, circles high above you and dives when you're
exposed in open sky. Get low between buildings, into a tree, or land, and it gives up; if it hits you,
you lose stamina and food and drop whatever you were carrying.

**Sound** is generated in the browser (no audio files): wind that rises with speed, wing beats, city hum,
waves near water, birdsong near trees by day, crickets at night, and effects for everything you do.

**Nests.** Fly through a tree to snap off a branch, then land anywhere to drop it. Branches dropped within
2 m of each other grow into one nest, spiralling outwards and upwards. At 5 branches the nest becomes your
**home**: you start perched on it whenever you play nearby, it's on the compass, and in challenge mode you
wake up there after fainting. Bigger nests (15, 30, 60 branches) earn bonus XP. Nests are saved by their
real coordinates, so they stay where you built them.

## How it works

1. **Search** (`src/lib/Search.svelte`, `src/lib/geocode.js`): search-as-you-type through
   [Photon](https://photon.komoot.io). [Nominatim](https://nominatim.org) is the fallback, used only when you
   press Enter, because its usage policy doesn't allow autocomplete.
2. **Streaming tiles** (`src/game/TileManager.js`): the world is split into standard zoom-15 map tiles
   (about 750 m across in the Netherlands, 1.2 km at the equator). Tiles within 1.3 km of the bird load
   nearest-first, and tiles more than 2.1 km away are unloaded. Map data is downloaded per block of 2×2
   tiles to keep the number of Overpass requests down; a block that fails still shows terrain and ground
   and is retried until its buildings arrive. The place you picked becomes the world origin
   (0, 0, 0). Each tile's geometry is stored relative to the tile's own centre, so precision holds far from
   the start.
3. **Building a tile** (`src/game/world.worker.js`, two Web Workers):
   - `overpass.js` downloads the tile's OSM data from the [Overpass API](https://overpass-api.de) with GET
     requests stored in the browser's Cache API, so a tile is only ever downloaded once.
   - `terrain.js` decodes [Terrarium](https://registry.opendata.aws/terrain-tiles/) elevation tiles from AWS
     Open Data (same tile grid, so they line up exactly).
   - `osmParse.js` projects coordinates to local metres, stitches multipolygon relations, classifies land
     use, roads, railways, waterways and coastlines, and works out building heights: measured heights first,
     then `height` and `building:levels` tags, then a deliberately modest estimate from type and size.
   - `bag3d.js` (Netherlands only): measured roof heights for every building from the
     [3D BAG](https://3dbag.nl), joined on the `ref:bag` id that Dutch OSM buildings carry. Check the browser
     console for "measured heights for N of M buildings" to see that it works.
   - `roofs.js` fits gabled and pyramidal roofs to each footprint's oriented bounding box. Houses get gabled
     roofs by default; narrow terraced houses get the ridge parallel to the street.
   - `sea.js` builds the sea from OSM coastlines (land on the left, sea on the right) with a flood fill, and
     uses the elevation data to recognise open sea in tiles without a coastline.
   - `meshBuilder.js` builds the terrain mesh (with skirts that hide cracks between tiles), extrudes
     buildings onto the lowest ground under them, makes 3D bridge decks, scatters trees in woods and parks
     (kept off roads and water), and packs footprints for collision. Each building, tree and bridge is owned
     by exactly one tile, so nothing appears twice.
   - `groundPainter.js` paints the ground into a 1024 × 1024 texture on an OffscreenCanvas: land use, water,
     roads with sidewalks and centre lines, red cycle paths, railways, and soft contact shadows around
     buildings. Painting instead of layering flat meshes drapes perfectly over hills and never z-fights.
4. **Rendering** (`src/game/Game.js`, `Lighting.js`, `Tile.js`): Three.js with a physical sky whose sun follows the
   real time at the place (`sun.js`, NOAA formulas), sky-based image lighting, moonlight and stars at night,
   shadows that follow the bird, and instanced trees. Windows are procedural with three styles per building,
   and at night a random share of them is lit. Post-processing (GTAO ambient occlusion, bloom at night) depends
   on the graphics setting: Low, Medium or High. The terrain shader recognises the
   painted water colour and turns it into glossy, rippling water that reflects the sky. `skyFog.js` fades
   the distance into the sky's horizon colour in every direction, which hides the edge of the loaded tiles.
5. **Flight** (`src/game/Bird.js`, `Colliders.js`): an arcade flight model (banking turns, gravity along
   the flight path, flapping, diving) tuned per species, with stamina, landing and perching. It follows
   the terrain, with collisions against building footprints across tile borders. You bounce off walls
   and can skim across rooftops.
6. **Birds** (`species.js`, `birdModel.js`, `portraits.js`): species definitions and procedural models with
   jointed wings, tail, head and legs, painted per species; the album portraits are rendered from them.
7. **Game** (`gameplay.js`, `food.js`, `discoveries.js`, `nests.js`, `challenges.js`, `hawk.js`, `progress.js`):
   food placed per tile from the map (`worldItems.js`), landmark discovery with compass and beams, nest
   building from tree branches, races planned along the street and canal network, the hawk, rewards,
   hunger, levels and saving.
8. **Sound** (`sound.js`): Web Audio synthesis, with ambience driven by a coarse land-cover grid each tile
   reads back from its painted ground.

In development (`npm run dev`) the game is exposed as `window.__game` for poking at it from the console.

## Data and attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the ODbL.
Building heights in the Netherlands © [3DBAG](https://3dbag.nl) by tudelft3d and 3DGI (CC BY 4.0).
Elevation from [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) on AWS Open Data.
The attributions are shown on the search screen and in the game. The public Overpass, Photon and Nominatim
servers are shared community resources. For a public release, put a caching proxy in front of them or use
a commercial or self-hosted tile provider.

## Roadmap

- [x] **Phase 1: prototype.** Search, load an area, extruded city, flyable bird, collisions.
- [x] **Phase 2: streaming world.** Map tiles loaded around the bird, terrain elevation, painted ground
      with glossy water, bridges, tile-relative geometry for range.
- [x] **Phase 3: visuals.** Block downloads, sea and coastlines, roof shapes, measured heights in the
      Netherlands, window styles, ambient occlusion and bloom, day/night cycle with lit windows and stars.
- [ ] **Later visuals.** Distant low-detail terrain, street lights, weather and clouds, WebGPU renderer.
- [x] **Phase 4a: the game.** Species album, procedural birds, stamina and landing, food from the map,
      landmark discovery, XP and levels, challenge mode, touchdown landings, nest building and a home.
- [x] **Phase 4b.** Hawk, optional challenges (street races, landmark sprints, feeding the chicks), sound.
- [ ] **Phase 5: polish.** Touch and gamepad controls, settings, saving progress.
