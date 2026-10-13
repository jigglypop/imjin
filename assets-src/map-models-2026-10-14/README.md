# Campaign map camps and ships from Meshy Smart Topology (2026-10-14): not shipped

This package tried clean low-poly camps and map ships for the 3D faction campaign map (진영 전역) with Meshy Image-to-3D
Smart Topology (`meshy-t2`): the joseon, japan and ming camps at tiers 1–3, each a whole camp in one model, and one map
ship per navy. **The owner rejected all of them on 2026-10-14, so nothing from this package ships.**

- **Camps.** Each whole-camp model stands on its own square ground slab and reads as a toy diorama, mushy close up.
  The camps are built from separate procedural buildings standing on the terrain instead (`src/ui/grand/campBuildings.ts`);
  the earlier Meshy camps (`assets-src/camps-meshy-2026-10-13/`) left the map with them.
- **Ships.** Dropped for the battle's own ships: the campaign map now draws the procedural battle ships
  (`src/ships/build`) of the kinds each fleet has (`src/ui/grand/mapLayer.ts`). `public/models/ships-map/` was never
  shipped.

## What was spent

| | |
|---|---|
| Meshy | 12 tasks (9 camps, 3 ships) at 15 credits, 180 credits; the balance went from 673 to 493 |
| OpenAI Images | 3 requests (`gpt-image-2.5-sunburst`, one concept per ship) |

Every first attempt was accepted at review, so nothing was retried. The settings were `model_type: "smart-topology"`,
`ai_model: "meshy-t2"`, `topology: "triangle"`, `target_polycount` 1,200 / 1,600 / 2,000 for camp tiers 1 / 2 / 3 and
500 for a ship, `should_texture: true`, `texture_resolution: "2k"`, `enable_pbr: false`. The camps were made from the
nine concepts of `assets-src/camps-meshy-2026-10-13/concepts/`.

| model | Meshy task |
|---|---|
| joseon-1 | `01a135dc-e6e2-7349-941c-52c870c79468` |
| joseon-2 | `01a135dc-f0cc-7334-b726-07e45d391bde` |
| joseon-3 | `01a135da-b933-710b-ad07-be784da01c08` |
| japan-1 | `01a135dc-fe46-741c-9d2c-f3d17e3a531f` |
| japan-2 | `01a135dd-0a23-7067-8a28-799af47a9d19` |
| japan-3 | `01a135dd-1747-746c-a071-e2daa4ac83a3` |
| ming-1 | `01a135dd-20cb-73ab-9e01-8b1f497399ce` |
| ming-2 | `01a135dd-2bde-708d-a8fe-71accce700cf` |
| ming-3 | `01a135dd-3a2a-7236-b67c-4b6e81110c8a` |
| ship-joseon | `01a135da-c2f8-71a6-89de-f8a2b948a731` |
| ship-japan | `01a135dd-44e8-73a3-b7bc-e4995123b694` |
| ship-ming | `01a135dd-53b2-7189-bb9d-adbeac7abad1` |

## Folder

- `provenance.json` records every image request (prompt, model, hash, usage), every Meshy task (its exact request, task
  id, credits, status, the original's and the base colour's hashes), the balances, the outcome above (`outcome`), and
  what the local build made from the originals for the review (`reviewBuild`: 993–1,930 triangles near and 332–642 far
  per camp, 387–473 per ship, 1.36 MiB for the 21 files).
- `originals/` (Meshy GLBs and base colour PNGs) and `candidates/` (the generated ship concepts and Meshy's previews)
  stay local and are git-ignored. The scripts that made and reviewed them were not kept.
