# 임진왜란 (imjin)

3D naval strategy game, live at https://imjin1592.com: three.js r186 `three/webgpu` + TSL, @react-three/fiber, React 19, zustand, Vite, and an authoritative Node multiplayer server. Player-facing text is Korean (the English edition lives under `/en`); code, comments and commits are English.

## Commands
- `npm run dev`: http://127.0.0.1:5291 (strictPort; a second one: `npx vite --port <n> --strictPort`)
- `npm run typecheck` and `npm test`: both must pass before a commit (CI runs them)
- `npm run server`: multiplayer server on :8787; localhost clients connect to it on their own
- `node scripts/shot.mjs --url=http://127.0.0.1:5291/?scenario=hansan --out=<png>`: a screenshot (Windows: Edge + D3D11)
- Probes, URL test hooks, balance and audio tools: [docs/dev.md](docs/dev.md). Code map: [docs/architecture.md](docs/architecture.md)

## Layout
- `src/game/Engine.ts` runs a battle: staging, the fixed-step sim, events to sound and effects, the UI snapshot every 0.15 s. `quality.ts` has the tiers (high PC, medium tablet, low phone).
- `src/sim/` the deterministic simulation, shared with `server/`; `src/sim/grand/` the faction campaign.
- `src/ships/`, `src/fx/`, `src/ocean/`, `src/render/`, `src/terrain/`, `src/audio/`, `src/cinema/`: ships, effects, sea, sky, land, sound, cutscenes.
- `src/ui/` screens and HUD; `src/routes.ts` + `src/router.ts` addresses; `src/net/` + `server/` multiplayer, wire format in `src/net/protocol.ts`.

## Rules
- `src/sim` stays deterministic: no `Date.now`, `Math.random`, DOM or three.js, only the battle's seeded RNG. A change there changes the server and ranked play; a Ship or BattleEvent field clients need goes into `src/net/protocol.ts` too.
- Phones (iOS Safari through the WebGL2 path, `?q=low`) kill a tab near 1.2-1.5 GB: keep textures under 300 MB and GPU memory under 400 MB (`scripts/probe-memory.mjs`), and free what a battle built (`Engine.disposeBattle`, checked by `probe-leak.mjs`).
- Uniforms that many materials read go in `renderGroup`. The engine owns the pixel ratio. Never read a geometry's arrays after its first frames (`freeAfterDraw`).
- Battle audio: nothing synthesised with a sustained or swept pitch above 250 Hz (`scripts/audio/analyze.py`).
- Match the surrounding code: comments explain why in plain sentences; no dead code.

## Assets
- Binaries under `public/` and `assets-src/` (models, textures, audio, fonts, terrain, generation sources) live in S3 by content hash, listed in the committed `assets.json`: `npm run assets -- pull` after a checkout; `npm run assets -- push` after adding or changing one, then commit `assets.json`.
- `npm run assets -- models` is the model vault: every .glb with its triangles, versions and provenance. More in [docs/dev.md](docs/dev.md#assets).

## Deploy
- A push to `main` deploys the site (S3 + CloudFront) and the multiplayer server (EC2 through SSM) after typecheck, tests and build. Never push unasked.
- The server by hand: `scripts/deploy-mp.sh deploy|status`. Its data lives in `/opt/imjin/data` on the host and is never overwritten by a deploy.
