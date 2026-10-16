# Development tools

Everything here runs from the repository root. The dev server is `npm run dev` on http://127.0.0.1:5291.

## Test hooks and addresses
- Addresses (`src/routes.ts`; `src/router.ts` keeps the address and the screen in step, back/forward included): `/` menu, `/campaign` 캠페인, `/conquest` 쟁탈전, `/battles` 역사 전투, `/online`, `/settings`; the English edition is the same under `/en`. `/ko/...`, a trailing slash, `index.html` and unknown paths are rewritten in place to the one form. The build writes one page per address with its own meta (`vite.config.ts`); the deploy uploads them under the keys `node scripts/route-pages.mjs` prints.
- URL hooks (`src/ui/launch.ts`, App.tsx): `?scenario=<id>&side=<faction>`, `?conquest=hallyeo&me=joseon&foe=japan&size=2`, `?gallery=1`, `?hud=0`, `?q=low|medium|high`, `?lv=0-4`, `?webgl=1`, `?sky=`, `?sea=`, `?paused=1`, `?lang=ko|en`. The battle-launch ones (`LAUNCH_PARAMS`) leave the address at the first move to another screen, so a reload does not start the battle again.
- Cutscenes: automated browsers see none unless `?cutscene=1`; `?doc=1` starts the documentary mode; `__engine.cinema.play('noryang-outro')` plays a scene.

## Screenshots and probes
macOS uses Chrome + Metal, Windows Edge + D3D11. The GPU is shared with whatever else runs, so compare runs back to back.
- `node scripts/shot.mjs --url=http://127.0.0.1:5291/?scenario=hansan --out=<png>` desktop WebGPU screenshot
- `node scripts/probe-mobile.mjs --url=... [--orient=portrait,landscape]` WebKit iPhone 15 Pro emulation (the WebGL2 path)
- `node scripts/probe-memory.mjs [url] [--then=myeongnyang,hansan]` WebKit process memory + `renderer.info.memory` across battles, PASS/FAIL against the phone budget (textures < 300 MB, GPU memory < 400 MB, ready < 10 s). Its `footprint` column is what iOS counts; RSS also holds freed pages and is not a leak signal.
- `probe-load.mjs [url] [--engine=chromium]` load timeline; `probe-calls.mjs` draw calls per frame (`renderer.info.render.calls` counts render() calls, not draws); `probe-programs.mjs` shader programs (near 90 on the phone tier); `probe-leak.mjs` textures that outlive a battle; `probe-heap.mjs` heap snapshots between battles (`--min`, `--label`, `--retainers`); `probe-ui-loop.mjs` battle -> back -> battle through the real buttons; `probe-warnings.mjs` console warnings (a clean battle prints none); `probe-cpu.mjs` main-thread profile of a load; `probe-geometry.mjs` real vertex memory (`renderer.info.memory` counts an interleaved attribute once per attribute)
- `probe-pace.mjs --url=... --seconds=40` battle time, fast-forward and closest-enemy distance over real time
- Big battles (desktop Chrome WebGPU): `probe-perf.mjs --url=...?scenario=busan [--speed=8] [--pre=10] [--close] [--uncapped] [--cpu [--callers=fn]] [--alloc]` fps, frame percentiles, per-stage ms, draw calls, triangles, heap churn and GC hitches over 30 s of fighting; `probe-draws.mjs` every draw of a frame; `probe-ablate.mjs` GPU cost of hiding one part at a time; `probe-series.mjs` fps and particles over time; `probe-phone.mjs` the same on WebKit with `?q=low`; `perf-shot.mjs` a screenshot from the thick of a fight

## Online locally
`npm run server:build && PORT=8791 node server/dist/server.cjs`, then `VITE_MP_URL=ws://127.0.0.1:8791/ws npx vite --port 5306 --strictPort`, then `node scripts/mp-smoke.mjs` (ws only) and `node scripts/mp-browser.mjs --url=http://127.0.0.1:5306/ --mode=all` (two pages). The same server answers the account API under `/api/`; give it `ACCOUNTS_DB=<scratch file>` and `RANKED_STORE=<scratch file>` to keep test accounts out of `server/dist/data`.

## Balance
- `node scripts/balance.mjs` historical scenarios (`--kpi` pacing, `--passive`, `--classic`, `--conquest`)
- `node scripts/balance-conquest.mjs --duel --seeds=3` faction duels; `node scripts/balance-grand.mjs` campaign wars (`--sweep`, `--fit=japan`, `--catalog`, `--no-events`); `node scripts/test-grand.mjs` its rules and save/load
- `node scripts/check-stalemate.mjs [--conquest] [--classic] [--seeds=4]` every battle must end with a passive player (`--trace` prints orders and crews every 2 sim minutes)
- `node scripts/test-depth.mjs`, `node scripts/test-maneuvers.mjs [--unit]`, `node scripts/maneuvers-harness.mjs hansan --rules=v1`

## Audio
- `node scripts/render-sounds.mjs --url=http://127.0.0.1:5291 [--out=<dir>] [--only=battle|inventory]` renders the synthesised voices, a scripted battle mix, or every voice one file each
- `node scripts/audio/capture.mjs --url=... --tag=<t>` records the real master bus of menu / battle / skirmish / campaign; `python3 scripts/audio/analyze.py <wav>... [--png <dir>]` loudness, clipping and narrow tones that read as beeps; `scripts/audio/build_page.py <dir>` a listening page

## Campaign maps
`node scripts/build-region-maps.mjs [--preview=<dir>] [--check]` rewrites `src/sim/grand/regionPoints.json` from the anchors in `coast.ts`: rerun it after changing an anchor or a terrain.
