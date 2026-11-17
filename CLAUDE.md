# Ranch Defense: notes for Claude sessions

Multiplayer browser game: the family defends their real ranch house from zombie cows.
The ranch is **Rancho La Esmeralda** (it has a Facebook page; see the end of this file).
Three.js client (`client/`), Node + `ws` server (`server/`), map and rules shared by both
(`shared/world.js`). Deployed from `main` (see `render.yaml`).

Sessions on different accounts cannot see each other's history. **This file is the memory.**
Update it when something here changes or a new standing preference comes up.

## How Troy wants work done
- **Merge as you finish things.** Each finished piece: branch from `main`, push, open a pull
  request, mark it ready, merge it. No need to ask first. (Asked on 2026-11-16.)
- Requests come as short, casual one-liners, often several mid-task. Take each as a real
  request and fold it in; say what you did and anything you chose on his behalf.
- He asked to **use Blender to make things look good** (see Blender below).
- The game is for family: the playable characters are real relatives (Troy, Maria, Rafael,
  Rafa, Julio, Tere). Humour is welcome, especially about Rafael.
- Rafael's lines: lots of Mexican cursing ("chinga..." and friends) about people stealing his
  coconuts and getting off his property. I kept the insults aimed at coconut thieves and
  trespassers, not at anyone's ethnicity (my choice; he had asked for trash talk about "the
  natives").
  - On 2026-11-17 he asked outright for "classic Mexican racial slurs against natives" for
    boss Rafael. Declined: no racial slurs. He then asked to "push it as far as you're able"
    and make it "all uncensored and play out loud": the English subtitles now swear as hard
    as the Spanish (fuck, motherfuckers...), there are 82 lines, and his voice (browser
    speech, Spanish) plays near full volume anywhere on the map.

## What exists (as of 2026-11-17)
- Waves of zombie Brahman cows (walker, runner, bull every 5th round); boards on doors and
  windows; wall-buy guns; grenades; power-ups; revive; four dogs (Pepper only hides).
- **Round 10**: locals with machetes replace the herd. **Round 20**: boss fight with a giant
  drunk Rafael (4.75 m, Grey Goose bottle as a club, throws empties, curses in Spanish with
  subtitles and browser speech). **Round 21 on**: cows again.
- **Trucks**: the F-150 and Chevy are drivable (E to get in; driver, front passenger, two in
  the bed). Driving faster than a jog kills cows and locals; bulls and Rafael stop the truck.
- **Road**: white caliche road from the driveway out of the south gate to the beach.
- **Language**: English / Español buttons on the start screen (`client/src/i18n.js`; Spanish
  is keyed by the English text; add new strings there).
- **Call of Duty Zombies systems** (all in `shared/world.js` under "Zombies machinery"):
  - Power switch: a generator behind the house. Perks and El Taller do nothing until it's on.
  - Five perk coolers (four per player, lost when you go down): Bull Hide (250 health),
    Second Wind (faster revives; solo it gets you back up once), Quick Hands (reload),
    Double Tequila (fire rate and damage), Mustang (speed).
  - Mystery box (950): random gun, never one you hold. After a few uses it can give a toy
    cow instead, refund you and move to another of four spots. A beam of light marks it.
  - El Taller (5000): upgrades the gun in your hands (double damage, bigger magazine,
    Spanish name, purple-and-gold sheen).
  - Coconut cannon: box-only wonder weapon, lobs exploding coconuts.
  - Electric fence trap (1000) across the south gate.
  - Power-ups: max ammo, insta-kill, double points, nuke, carpenter, fire sale.
- Phone support: touch controls, full screen, Low graphics preset with `*.lo.glb` models.
- **The house** (Nov 2026) is a Blender model traced from the family's walk-through video
  (Troy shared `ranch.mp4` on Google Drive; no narration, pictures only): kitchen with the
  brick hood and brick-arched counters; a passage with the side door; the bar room (mahogany
  and black-marble bar, glass double doors facing the kitchen door); the stair hall with its
  tiled corridor; Troy's office (saddles, hats, yellow curtains, Brahman expo posters); and one
  big front room, long dining table at the west end, cane rockers at the east end, stone
  columns and plaster arches. Family photos (from the character pictures) hang on the walls.
  Troy asked for it "as realistic and close to the real house as possible, down to small
  details", "pictures, everything", "their clutter on tables, kitchen, grill": keep adding
  detail rather than simplifying. The kettle grill outside the side door is my addition (the
  video shows no grill).
  - Floor plan, collision, doorways (`PORTALS`), furniture boxes, `HOUSE_PROPS` (chairs etc.
    the game instances), fans and lights: `shared/world.js` "The house". The Blender build reads
    the same numbers, so change the plan there and rebuild.
  - Rebuild: `tools/blender/build_house.sh` (dumps the layout, paints textures, builds and
    light-bakes the full and phone versions, compresses). Both bakes took 8 minutes on 4 CPU
    cores when nothing else ran (up to ~30 with a browser test alongside); `RD_BAKE_SAMPLES=16` for a quick look. The light map is 2048 (`LM_SIZE`); 4096 would
    take about four times as long. Output: `models/house/house(.lo).glb`
    and `house(.lo)_light.webp`.
  - Node `House` carries the light map (UV set 2; sky + bounced sun, stored as sqrt; the game's
    `LIGHTMAP_GAIN` undoes it). `HouseDetail` is small stuff lit normally. `Leaf_<entry>_L/R`
    and `Grille_<entry>` are the French-door glass and grilles the cows break open.
  - **Upstairs** (Troy asked: "so we can go upstairs", "an open door we can go in and out
    of", "exit through the 2nd floor"). The video never goes up, so the rooms are my design:
    a gallery round the stairwell under the skylight, two bedrooms, the arched loggia (hammock),
    and a door at the gallery's east end (entry 9, a 'door': players pass, cows tear its boards)
    onto the flat roof, where a masonry stair runs down the back wall to the yard.
    Collision has floors now: boxes may have `y0` (start above the ground); `resolveCircle`
    ignores boxes starting a metre above your feet, `groundHeight` lets you stand on them.
    Each step of both stairs is a box. `insideHouse(x, z, y)` and `roomAt(x, z, y)` take the
    height; `levelOf(y)` says which floor. Dogs stay downstairs (they wait at the stair foot).
  - Cows find their way on the server's path grid: the ground at 1 m, and a second layer for
    the upper floor and roof at 0.5 m, joined at the two stairs (`STAIRS`, foot and head).
    Doorways are carved open (`PORTALS`), cows squeeze through indoors and sidestep tables.
    Rooms narrower than about 3 m (1.6 m upstairs), or furniture leaving less than ~1.2 m, cut
    the grid: run `node scripts/housetest.js` after any change to the plan.
- **Scenery**: trees and palms are Blender-built models instanced across the map
  (`tools/blender/make_trees.py` -> `models/trees/trees.glb`). The ground shader tints each
  layer separately (pasture, leaf litter, sand, road); keep the terrain material white.
- **The land** (from Troy's drone and herd screenshots, Nov 17): flat coastal pasture with
  tall coconut palms dotted about; jungle in patches (`junglePatch(x, z)` in
  `shared/world.js`, used by the trees, the ground splat, the grass and the trucks' speed) and
  thick along the far edges. The sea is muddy brown (Troy: "the water is more brown"), and the
  things on the horizon are **oil rigs, not ships** (`buildRigs()`).
- **The pond** (`POND`, `pondEdge`, `inPond`): a marsh south-west of the house after the ranch's
  sunrise video: brown water, mud banks, grass tussocks. The server blocks it on the path
  grid, so cows walk round; trucks crawl through it. Players can wade.
- **Water trough** (x 40, z 18): red corrugated roof on concrete posts, dirt round it, after
  Troy's photo. The photo also shows barbed-wire fences on crooked posts: not built yet.
- **Front walk** (from Troy's Facebook screenshots): terracotta path, a white-pebble mosaic
  with the ranch's black brand (`T.pebbleBrand()`), a brass "Rancho La Esmeralda" plaque,
  white gate pillars with open black iron gates, stepped wall ends. The iron arch with the
  name over the gate and the wooden sign are my additions (`buildRanchSigns()` in
  `client/src/world.js`).

## Where things are
- `shared/world.js`: map layout, collision, enemy types (`COW_TYPES`), weapons, `VEHICLES`,
  `ROAD`, special round numbers (`LOCALS_WAVE`, `BOSS_WAVE`).
- `server/game.js`: the authoritative simulation (waves, AI, damage, trucks, snapshots).
- `client/src/main.js`: game loop, input, HUD, server events. `world.js`: scenery and
  terrain shader. `cow.js`: cows. `humanoid.js`: locals and Rafael. `vehicle.js`: trucks.
  `taunts.js`: Rafael's lines. `audio.js`: sounds (many synthesised).
- `tools/blender/`: scripts that build or process models (props, wheel splitting, trees,
  cow rigging). `scripts/`: headless tests.

## Testing
- `npx vite build`, then `PORT=3000 node server/index.js`.
- Sim tests (no browser): `node scripts/simtest.js`, `dogtest.js`, `entrytest.js`,
  `weapontest.js`, `bosstest.js` (rounds 10 and 20), `drivetest.js` (trucks and road),
  `zombiestest.js` (power, perks, box, El Taller, trap, coconut cannon, carpenter),
  `housetest.js` (cows and dogs get from every room to every other, Pepper reaches her
  blanket, players fit through every doorway).
- Server test switches: `RD_START_WAVE=20` starts at a later round;
  `RD_FIRST_WAVE_DELAY=3000` keeps the cows away while looking around;
  `RD_START_POINTS=20000` gives everyone points to try the machines.
- Browser checks: Playwright + headless Chromium works but renders under 1 fps (software
  GL). Use `?q=low&aq=0`, long timeouts, and `window.__rd` (exposes net, me, scene, camera,
  truckViews, driving...). `window.__rdShot = { pos, look }` pins the menu camera for stills.
  A tester left alone gets killed by the cows within a minute or two and the room resets,
  so set `RD_FIRST_WAVE_DELAY` for anything slow.
- Nothing has been tried on a real phone or by hand at full frame rate from these sessions:
  say so when reporting.

## Blender
- Not preinstalled in cloud sessions. `pip install bpy` gives Blender as a Python module
  (worked with Python 3.13, bpy 5.3). Run scripts as
  `python3 tools/blender/<script>.py -- <args>`.
- That module cannot read Draco-compressed GLBs. Start from an uncompressed copy (e.g.
  `git show 322b5cc:client/public/assets/models/vehicles/chevy.glb`), then recompress with
  `npx @gltf-transform/cli optimize in.glb out.glb --compress draco --texture-compress webp`
  (add `--simplify true --texture-size 512` for the `.lo.glb` phone version).
- Do not name a scratch script `inspect.py` (it shadows a standard module and crashes bpy).
- Cycles on CPU renders quick previews; use them to check a model before putting it in game.
- `gltf-transform optimize` strips texture coordinates from materials with no texture. If the
  game paints a texture on later (the perk labels), give it a placeholder texture in Blender.
- `tools/blender/make_machines.py` builds the machines and the coconut cannon;
  `make_house.py` (+ `make_house_textures.py`, `build_house.sh`) the house.
- Keep the second UV set when compressing a light-mapped model: `--prune-attributes false`.
- The furniture models in `models/house/` (chairs, rockers, fan) were generated in an earlier
  session; uncompressed copies are in git at `bc0bbc3`.
- Every `foo.glb` needs a `foo.lo.glb` beside it: Low graphics loads that name instead.
- A set of High-quality stills takes about 3 minutes each here; check on Low first.

## Things that could not be done from a cloud session
- Background removal models (`rembg`) could not be installed; Rafa's picker photo was cut
  out by hand with Pillow instead.
- No text-to-speech or image/3D generation service is connected. New people or animal
  models have to come from the existing ones or from Blender.
- Google Drive: the connected Drive account (troy@doorraise.com) could not see a file Troy
  shared by link; downloading the public link with curl from drive.usercontent.google.com
  worked once the environment's network allowed it.
- Facebook (Rancho La Esmeralda page, reels): fetching it from the container was refused
  (the auto-mode classifier blocks scraping it). Ask Troy for screenshots, or photos on Drive.
