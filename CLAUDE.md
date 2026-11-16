# Ranch Defense: notes for Claude sessions

Multiplayer browser game: the family defends their real ranch house from zombie cows.
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

## What exists (as of 2026-11-16)
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
- Phone support: touch controls, full screen, Low graphics preset with `*.lo.glb` models.
- **Scenery**: trees and palms are Blender-built models instanced across the map
  (`tools/blender/make_trees.py` -> `models/trees/trees.glb`). The ground shader tints each
  layer separately (pasture, leaf litter, sand, road); keep the terrain material white.

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
  `weapontest.js`, `bosstest.js` (rounds 10 and 20), `drivetest.js` (trucks and road).
- Server test switches: `RD_START_WAVE=20` starts at a later round;
  `RD_FIRST_WAVE_DELAY=3000` keeps the cows away while looking around.
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
- Every `foo.glb` needs a `foo.lo.glb` beside it: Low graphics loads that name instead.
- A set of High-quality stills takes about 3 minutes each here; check on Low first.

## Things that could not be done from a cloud session
- Background removal models (`rembg`) could not be installed; Rafa's picker photo was cut
  out by hand with Pillow instead.
- No text-to-speech or image/3D generation service is connected. New people or animal
  models have to come from the existing ones or from Blender.
