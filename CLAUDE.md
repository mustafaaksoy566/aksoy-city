# Aksoy City — notes for Claude

SimCity BuildIt-style grid city builder, played on iPhone 16 Pro Safari. Live: https://mustafaaksoy566.github.io/aksoy-city/ (repo mustafaaksoy566/aksoy-city, pushing to main deploys via .github/workflows).

## Working with the user
- Speak **Turkish**, simply, step by step. The user does not code. After every batch, list each request and what was done (they often say "hepsini yap, hiçbirini unutma").
- They usually ask "devam et daha fazlasını ekle": implement every listed item, then add something extra, test it, commit + push, and report in Turkish.
- Free/CC0 assets: download without asking ("daha fazla siteden yardım alman gerekiyosa al bana sorma"), report what you used afterwards. Ask before anything paid, any account, or any software install. Never create accounts, enter tokens/passwords, change system or security settings, or accept terms for them.
- Connection: kenney.nl / itch.io / opengameart only work with Cloudflare WARP on. github.com, poly.pizza (`https://static.poly.pizza/<uuid>.glb`), quaternius, polyhaven work. GitHub API gets rate-limited; verify deploys by fetching the live page and grepping for the new `index-*.js` bundle name.
- Raw downloaded packs live in `assets-raw/` (gitignored). The style is KayKit City Builder Bits (2x2 units, scale 0.5) + Kenney skyscrapers + procedural models.

## Dev and test
- Node: `"/c/Program Files/nodejs/node.exe"`. Dev server: `.claude/launch.json` (vite on port 5173, `--host`). Build check: `npx tsc --noEmit` then `npm run build`.
- The user may be playing in the browser pane. Test on a separate origin so their save (localStorage) is untouched: http://127.0.0.3:5173 (or 127.0.0.2).
- Dev helper `window.__aksoy` (DEV only): `{renderer, scene, camera, rig, city(), weather, view, sky, highway, traffic, walkers, open, pick, refresh}`. Set `rig.bounds` to look outside the city.
- Synthetic pointer tests: send `pointercancel` for ids 0..29 first (stale ids block drags).
- After changing `city.ts`, always round-trip a save (`serialize` → `load`).

## Architecture (src/)
- `config.ts`: all constants and catalog (BUILD_GROUPS, TOOL_INFO, COST, UNLOCK, FOOTPRINT, DECOR, INDUSTRY, SHOPS, MAKER_LEVELS, RES_LEVELS 8 levels, ROAD_GRADES, TRAFFIC).
- Map: `SIZE=48` cols × `ROWS=64` rows (`NORTH=16` sea rows on the north). `idx = z*SIZE + x`; world pos = `(x - SIZE/2 + 0.5, z - Z0 + 0.5)`, `Z0=40`. Plots 8×8. Sea for `z < COAST_ROW` except the `ISLAND` ellipse; roads over sea = suspension bridges (`SEA_BRIDGE`). River columns `RIVER`, rows `RIVER_ROWS`.
- `city.ts`: game state, rules, traffic BFS (`updateTraffic`, `congestion`), road grades (`Tile.grade` 1 = Bulvar, 2 = Cadde with 4 lanes), `streetOf`/`upgradeStreet`, maker upgrades, save/load. Save is v5 with `rows`, `rg:2`, `o`. Load migrates old saves (z shift, com → res, refunds for trade and buildings on sea). Roads and rails on water are kept.
- `view.ts`: builds meshes per tile (static chunks merged by `batcher.ts`), road decorations (`roadExtras`, `junctionExtras`, `culDeSac`, `signalPost`), bridges (`suspension`), construction sites, ghost road preview (`showRoadPreview`), traffic overlay.
- `traffic.ts`: cars and buses (lanes, queueing, traffic lights, cul-de-sac U-turns, spawn and fade at houses or the entrance) and walkers. `signals.ts`: traffic-light timing.
- `input.ts`: tile input; road and rail drawing follows the finger path (`follow`). `camera.ts`: custom rig (pan, pinch, twist, two-finger tilt, PC keys).
- `terrain.ts` (world outside and under the city, coast, island, river, highway tunnel), `water.ts`, `trees.ts` (procedural trees), `towers.ts` (procedural towers, villas, apartments: `proc/` paths), `historic.ts` (Eiffel, Liberty, Pisa, Galata, Colosseum, Pyramid, stadium), `landmarks.ts` (mosque, lighthouse, marina, zoo, clock tower, `makeDecor`), `highway.ts`, `rails.ts`/`trains.ts`, `sky.ts`/`planes.ts`, `daynight.ts`, `weather.ts`, `ui.ts`/`info.ts` (HUD, build catalog, info cards), `thumbs.ts` (menu pictures).
- Code comments are in Turkish. Match that.
