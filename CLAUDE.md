# 임진 해전 (imjin)

WebGPU 3D naval strategy game about the Imjin War: three.js r186 `three/webgpu` + TSL, @react-three/fiber, React 19, zustand.
Live at https://imjin1592.com. Player-facing text is Korean; code and comments are English.

## Commands
- `npm run dev` — Vite on http://127.0.0.1:5291 (strictPort; use `npx vite --port <n> --strictPort` for a second server)
- `npm run typecheck` — client + server; must pass before any commit (CI runs it)
- `npx vite build`, `npm run server` (multiplayer server on :8787, localhost clients connect to it automatically)
- Screenshots (macOS uses Chrome + Metal, Windows Edge + D3D11):
  - `node scripts/shot.mjs --url=http://127.0.0.1:5291/?scenario=hansan --out=<png>` desktop WebGPU
  - `node scripts/probe-mobile.mjs --url=... [--orient=portrait,landscape]` WebKit iPhone 15 Pro emulation (iOS Safari engine, WebGL2 path)
  - `node scripts/probe-memory.mjs [url] [--then=myeongnyang,hansan]` WebKit process RSS + `renderer.info.memory` during a battle load and after further battles in the same page; PASS/FAIL against the phone budget (textures < 300 MB, GPU memory < 400 MB, ready < 10 s)
  - `node scripts/probe-load.mjs [url] [--engine=chromium]` load timeline (step, bar, GPU counters); `probe-calls.mjs` draw calls per frame; `probe-programs.mjs` shader programs; `probe-leak.mjs` textures that outlive a battle; `probe-cpu.mjs` main-thread profile of a load
  - `node scripts/probe-pace.mjs --url=... --seconds=40` battle time / fast-forward / closest-enemy distance over real time
- Balance: `node scripts/balance.mjs` (historical scenarios), `node scripts/balance-conquest.mjs --duel --seeds=3` (faction duels), `node scripts/balance-grand.mjs` (faction campaign, all-computer wars; `--sweep`, `--fit=japan`, `--catalog`), `node scripts/test-grand.mjs` (its rules and save/load)
- URL test hooks (App.tsx): `?scenario=<id>&side=<faction>`, `?conquest=hallyeo&me=joseon&foe=japan&size=2`, `?gallery=1`, `?hud=0`, `?q=low|medium|high`, `?lv=0-4`, `?webgl=1`, `?sky=`, `?sea=`, `?paused=1`

## Architecture map
- `src/App.tsx` screens (store `screen`), URL hooks, battle `<Canvas>`; `src/state/store.ts` UI snapshot published by the engine every 0.15 s
- `src/game/Engine.ts` owns a battle: init/stage (sky, terrain, ships, ocean, clouds, crew), fixed-step sim loop with speed + auto fast-forward, event dispatch to sound/fx/crew, snapshot publish. `quality.ts` equipment tiers (high PC / medium tablet / low phone) and run-time levels; `adaptive.ts` fps controller; `device.ts` touch/phone detection
- `src/sim/*` deterministic simulation shared with `server/main.ts`: `battle.ts` (ships, AI think, guns, projectiles, boarding), `catalog.ts` (SHIP_SPECS, GUN_SPECS), `scenarios.ts` (9 historical battles), `conquest.ts` + `maps.ts` + `strategy.ts` (capture-point skirmish + computer strategist), `balance.ts`, `types.ts` (Ship, BattleEvent)
- `src/ships/` ShipRenderer (instanced GLB ships, 3 LODs), ShipViews (LOD pick, wave motion, sinking pose), decks.ts (deck heights/crew stations)
- `src/fx/` Effects (muzzle, projectiles, hits, debris), ParticleLayer (CPU particles, TSL sprites), Crew (GPU-skinned baked crews), Lanterns
- `src/audio/Sound.ts` WebAudio synthesis only (no samples)
- `src/ocean/` FFT (WebGPU compute only) or Gerstner fallback; `src/render/` sky (HDRI), clouds (raymarched); `src/terrain/` worker heightmap, vegetation, structures
- `src/sim/grand/*` faction campaign (진영 전역), pure TS like the rest of `src/sim`: regions, economy, orders, turn, ai, autoresolve, bridge (the typed hand-off to a 3D region battle); `src/campaign/grand.ts` is its store (`imjin.grand.v1`). All its numbers derive from SHIP_SPECS through `TUNING` in `economy.ts`
- `src/campaign/campaign.ts` linear 1592 campaign (Joseon); `src/select/SelectScene.ts` 3D ink map of the south coast for the select screen
- `src/net/` + `server/main.ts` multiplayer: authoritative Node server, binary snapshots, lobby (conquest maps only so far)
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
