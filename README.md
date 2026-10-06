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

`npm run dev` and `npm run preview` also run the multiplayer relay (on `/relay`), so flying together works
out of the box on your machine and your local network.

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
| `J` | Journal: level, birds, badges, records, meals, nests and discovered places |
| `M` | Sound on/off (volume is in the pause menu) |
| `[` `]` | Time of day −/+ 30 minutes (or drag the sun along the arc, bottom right) |
| `H` / `Esc` | Help / pause and settings (time of day, graphics quality) |

**Gamepads** work as well (standard layout): left stick to steer and climb, `A` flap, right trigger dive,
`B` land, `Y` challenges, `Start` pause. **On phones and tablets** on-screen controls appear: a joystick on
the left, Flap, Dive and Land on the right, and Challenges and Menu at the top. The time and weather chips
stay at the top right; the pause menu has the rest.

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

**Sky and weather.** The sun stands where it really is at that place and time; drag it along the arc at
the bottom right to choose another time, or press *Now* to go back. The weather starts as the real current
weather there (from [Open-Meteo](https://open-meteo.com)); the weather button cycles through clear, cloudy,
overcast, rain, storm and fog. Wind drifts the clouds and the rain and gently carries you. Cloud banks float
at a few hundred metres and you can fly into them. At night the street lights come on: mapped lamps from
OSM where there are any, otherwise lamps along the roads.

**Journal and badges.** The journal (`J`, or from the album and the pause menu) keeps everything you've done:
your level, which birds are unlocked, records (top speed, highest flight, fastest street race, hawks shaken
off), meals per food type, your nests and every place you discovered. Badges reward milestones such as
discovering 5 and 25 places, tasting every kind of food, building a 30-branch nest, a minute of flying
at night or in a storm, diving at 200 km/h
and climbing 400 m above the ground; each is worth bonus XP. *Start over…* at the bottom of the journal
wipes your progress after a confirmation.

**Settings** (pause menu, saved in the browser): time of day, weather, volume, invert up/down, camera
distance and graphics quality. If the game runs slowly at a higher setting, it suggests a lower one.

**Flying together.** Press *Fly together* (top right, or in the pause menu) to get an invite link and send it
to friends. They pick a bird and start just behind your right wing, with your time of day and weather. Everyone
sees the others as their own species with a name tag, and on the compass. Changing the time or the weather
changes it for the whole room. *Race your friends* on the challenge board (`C`) gives everyone in the room the
same rings, with a 15-second countdown to gather at the first one, and announces who finished in which place.
The room code stays in the address bar, so reloading the page rejoins. You can change your name in the
invite panel.

**Sound** is generated in the browser (no audio files): wind that rises with speed, wing beats, city hum,
waves near water, birdsong near trees by day, crickets at night, and effects for everything you do.

**Nests.** Fly through a tree to snap off a branch, then land anywhere to drop it. Branches dropped within
2 m of each other grow into one nest. The first few lie as loose twigs; at 5 branches they become a small woven
nest with a straw lining and two eggs, at 15 a large one, at 30 a huge one on a platform of packed twigs, and at
60 a legendary nest with a crow's hoard of shiny things (`nestModel.js`). Each new size pops into place. At 5
branches the nest becomes your
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
4. **Rendering** (`src/game/Game.js`, `Lighting.js`, `skyDome.js`, `Tile.js`): Three.js with an art-directed sky:
   colour keyframes by sun height (gradient, sun glow, moon, twinkling stars, Milky Way, fbm clouds) with the
   sun at its real position (`sun.js`, NOAA formulas). Light, ambient and exposure come from the same
   palette; the sky is also rendered into the environment map for reflections,
   shadows that follow the bird, and instanced trees. Windows are procedural with three styles per building,
   and at night a random share of them is lit. Post-processing (GTAO ambient occlusion, bloom at night) depends
   on the graphics setting: Low, Medium or High. The terrain shader recognises the
   painted water colour and turns it into glossy, rippling water that reflects the sky. `skyFog.js` fades
   the distance into the sky's horizon colour in every direction, with height fog: low ground fades out at
   the edge of the loaded tiles while hills and mountains (`farTerrain.js`, low-detail zoom-12 terrain out to
   about 15 km) rise out of the haze. Weather (`weather.js`), rain (`rain.js`, GPU-animated streaks), cloud
   banks (`clouds.js`) and street lamps with light pools are layered on top.
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
8. **Multiplayer** (`server/relay.js`, `net.js`, `peers.js`, `multiplayer.js`): a small Node relay (using the
   `ws` package) groups players into rooms by invite code and forwards their messages. It stores only each
   player's latest state and the room's time and weather, which a newcomer needs. The map is never sent:
   everyone builds the same place from the same coordinates, so positions can be shared as they are. Each
   bird sends its position, heading, speed, state and a few flags ten times a second. Other birds are shown
   150 ms in the past, blended between received states, which keeps their turns smooth.
9. **Sound** (`sound.js`): Web Audio synthesis, with ambience driven by a coarse land-cover grid each tile
   reads back from its painted ground.

In development (`npm run dev`) the game is exposed as `window.__game` for poking at it from the console.

## Hosting the relay

For a public site, run the relay next to the static build and let the web server pass `/relay` to it:

```bash
npm run build          # static files in dist/
PORT=8787 npm run relay
```

Apache (with `mod_proxy` and `mod_proxy_wstunnel`):

```apache
ProxyPass        /relay ws://localhost:8787/relay
ProxyPassReverse /relay ws://localhost:8787/relay
```

nginx:

```nginx
location /relay {
    proxy_pass http://localhost:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

The page connects to `wss://<its own host>/relay` (or `ws://` over plain HTTP), so HTTPS works without
mixed-content problems. To use a relay somewhere else, build with `VITE_RELAY_URL=wss://example.org/relay`.
The relay has no accounts: anyone with an invite link can join that room (up to 16 birds).

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
- [x] **Later visuals.** Art-directed day/night sky, real weather (clouds, overcast, rain, storm, fog,
      wind), cloud banks to fly through, distant terrain with height fog, street lights, HUD time and
      weather controls. (The WebGPU renderer was left out: a full shader rewrite for little visible gain.)
- [x] **Phase 4a: the game.** Species album, procedural birds, stamina and landing, food from the map,
      landmark discovery, XP and levels, challenge mode, touchdown landings, nest building and a home.
- [x] **Phase 4b.** Hawk, optional challenges (street races, landmark sprints, feeding the chicks), sound.
- [x] **Multiplayer.** Invite links, other birds with name tags, shared time and weather, races between friends.
- [x] **Phase 5: polish.** Touch and gamepad controls, journal, badges and records, settings, phone layout.
