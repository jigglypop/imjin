# 임진 해전 (imjin)

WebGPU 3D naval strategy game about the Imjin War: three.js r186 `three/webgpu` + TSL, @react-three/fiber, React 19, zustand.
Live at https://imjin1592.com. Player-facing text is Korean; code and comments are English.

## Commands
- `npm run dev` — Vite on http://127.0.0.1:5291 (strictPort; use `npx vite --port <n> --strictPort` for a second server)
- `npm run typecheck` — client + server; must pass before any commit (CI runs it)
- `npx vite build`, `npm run server` (multiplayer server on :8787, localhost clients connect to it automatically)
- Online locally: `npm run server:build && PORT=8791 node server/dist/server.cjs`, `VITE_MP_URL=ws://127.0.0.1:8791/ws npx vite --port 5306 --strictPort`, then `node scripts/mp-smoke.mjs` (ws only) and `node scripts/mp-browser.mjs --url=http://127.0.0.1:5306/ --mode=all` (two pages)
- Screenshots (macOS uses Chrome + Metal, Windows Edge + D3D11):
  - `node scripts/shot.mjs --url=http://127.0.0.1:5291/?scenario=hansan --out=<png>` desktop WebGPU
  - `node scripts/probe-mobile.mjs --url=... [--orient=portrait,landscape]` WebKit iPhone 15 Pro emulation (iOS Safari engine, WebGL2 path)
  - `node scripts/probe-memory.mjs [url] [--then=myeongnyang,hansan]` WebKit process RSS + `renderer.info.memory` during a battle load and after further battles in the same page; PASS/FAIL against the phone budget (textures < 300 MB, GPU memory < 400 MB, ready < 10 s)
  - `node scripts/probe-load.mjs [url] [--engine=chromium]` load timeline (step, bar, GPU counters); `probe-calls.mjs` draw calls per frame; `probe-programs.mjs` shader programs; `probe-leak.mjs` textures that outlive a battle; `probe-cpu.mjs` main-thread profile of a load
  - `node scripts/probe-pace.mjs --url=... --seconds=40` battle time / fast-forward / closest-enemy distance over real time
- `node scripts/render-sounds.mjs --url=http://127.0.0.1:5291 [--out=<dir>]` renders the synthesised voices (`src/audio/voices.ts`) offline to cannon_near/cannon_far/broadside/explosion/sinking .wav files, and `--only=battle` a scripted battle through the game's own `battlefield.ts` with the sample bank to `audio2_battle.wav`
- Balance: `node scripts/balance.mjs` (historical scenarios), `node scripts/balance-conquest.mjs --duel --seeds=3` (faction duels), `node scripts/balance-grand.mjs` (faction campaign, all-computer wars; `--sweep`, `--fit=japan`, `--catalog`), `node scripts/test-grand.mjs` (its rules and save/load)
- URL test hooks (App.tsx): `?scenario=<id>&side=<faction>`, `?conquest=hallyeo&me=joseon&foe=japan&size=2`, `?gallery=1`, `?hud=0`, `?q=low|medium|high`, `?lv=0-4`, `?webgl=1`, `?sky=`, `?sea=`, `?paused=1`

## Architecture map
- `src/App.tsx` screens (store `screen`), URL hooks, battle `<Canvas>`; `src/state/store.ts` UI snapshot published by the engine every 0.15 s
- `src/game/Engine.ts` owns a battle: init/stage (sky, terrain, ships, ocean, clouds, crew), fixed-step sim loop with speed + auto fast-forward, event dispatch to sound/fx/crew, snapshot publish. `quality.ts` equipment tiers (high PC / medium tablet / low phone) and run-time levels; `adaptive.ts` fps controller; `device.ts` touch/phone detection
- `src/sim/*` deterministic simulation shared with `server/main.ts`: `battle.ts` (ships, AI think, guns, projectiles, boarding), `catalog.ts` (SHIP_SPECS, GUN_SPECS), `scenarios.ts` (9 historical battles), `conquest.ts` + `maps.ts` + `strategy.ts` (capture-point skirmish + computer strategist), `balance.ts`, `types.ts` (Ship, BattleEvent)
- `src/ships/` ShipRenderer (instanced ships, 3 LODs, atlas material), ShipViews (LOD pick, wave motion, sinking pose), decks.ts (deck heights/crew stations), `build/` (procedural ships from modular parts and per-faction gpt-image atlases, `scripts/ship-textures.mjs patch` swaps single cells; `bake.ts` bakes occlusion and gun soot into the vertices), `weather.ts` (film-prop weathering: worn lacquer, rust, tar waterline, stained sails, ember glow), `anchors.ts` (three-free gun ports, decks, flags per model; the sim's `Battle.muzzle` and `variantFor` read it too)
- `src/fx/` Effects (muzzle, projectiles, hits, debris), ParticleLayer (CPU particles, TSL sprites), Crew (GPU-skinned baked crews), Lanterns
- `src/audio/` Sound.ts (context, music, ambience), battlefield.ts (sim events to voices: range model, broadsides, far rolling boom, ducking), samples.ts (the decoded `public/audio/*.mp3` bank, built by `scripts/audio`, credits in `public/audio/CREDITS.md`), voices.ts (synthesised voices: the fallback until the bank has decoded)
- `src/ocean/` FFT (WebGPU compute only) or Gerstner fallback; `src/render/` sky (HDRI), clouds (raymarched); `src/terrain/` worker heightmap, vegetation, structures
- `src/sim/grand/*` faction campaign (진영 전역), pure TS like the rest of `src/sim`: regions, economy, orders, turn, ai, autoresolve, bridge (the typed hand-off to a 3D region battle), spawn (builds that battle as a conquest battle with the campaign's own ships and the defender's works), report (battle summaries); `src/campaign/grand.ts` is its store (`imjin.grand.v1`). All its numbers derive from SHIP_SPECS through `TUNING` in `economy.ts`. UI: `src/ui/GrandScreen.tsx` (hub, faction pick, map, dialogs, orders) over the prop-driven kit in `src/ui/grand/*` (`adapt.ts` maps the store onto its view models); a meeting played in 3D is a `grand` launch kind (`launch.ts`) and `Engine` hands the per-ship outcome back through `finishGrandBattle`
- `src/campaign/campaign.ts` linear 1592 campaign (Joseon); `src/select/SelectScene.ts` 3D ink map of the south coast for the select screen
- `src/net/` + `server/` multiplayer: authoritative Node server (`main.ts` rooms/sessions/quick match/tick, `battles.ts` conquest + historical-duel builders, `terrain.ts` heightmaps in worker threads), binary snapshots, protocol v2 (`protocol.ts`). Lobby for conquest maps and historical duels, quick match (computer fills after 20 s), reconnect with a per-tab session token (seat kept 60 s), the approach skipped at up to 32x until first contact. UI in `src/ui/OnlinePanel.tsx`, `OnlineOverlay.tsx`, `online.css`
- `src/ui/` React HUD/menus; `styles.css` + `conquest.css`; compact layout via `useCompactLayout` (`.app--compact`, `.app--touch`)

## Rules
- `src/sim` must stay deterministic: no `Date.now`, `Math.random`, DOM or three.js; use the battle's seeded RNG. Changes there also change the multiplayer server.
- Adding a field to a BattleEvent or Ship that clients need means updating `src/net/protocol.ts` too.
- Phones: iOS Safari kills a tab at roughly 1.2–1.5 GB. Keep the low tier's GPU memory (`renderer.info.memory.total`) far below that and check with `probe-memory.mjs`.
  - `renderer.info.render.calls` counts `render()` calls since page start, not draw calls: use `probe-calls.mjs`.
  - What the low tier loads is decided in `quality.ts` equipment: no 2048 px ship models or normal/roughness maps, 2k sky (`scripts/build-hdri.mjs`), 1k ground textures (`scripts/build-terrain-tex.mjs`), only the ship kinds the battle uses. A battle must free what it built (`Engine.disposeBattle`) and must not make the renderer create new sky textures (`loadSky` reuses them): check with `probe-leak.mjs`.
  - The engine owns the pixel ratio (it wraps `renderer.setPixelRatio`); do not set it elsewhere.
- Match surrounding code: comments explain why in plain sentences; no dead code.

## Deploy
- Site: push to `main` → GitHub Actions (typecheck, build, S3 `imjin1592.com`, CloudFront invalidation).
- Multiplayer server: `scripts/deploy-mp.sh setup|deploy|ci|status` (EC2 t4g.small behind Caddy at mp.imjin1592.com, via SSM). Needs local AWS credentials (`aws login` / `aws configure`).

## Agents
`.claude/agents/`: `scout` (Haiku, read-only lookup), `builder` (Sonnet, implementation), `checker` (Haiku, runs checks/probes), `reviewer` (Sonnet, diff review). Subagents default to Sonnet (`.claude/settings.json`).
