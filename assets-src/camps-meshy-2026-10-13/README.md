# Campaign camps from Meshy (2026-10-13)

Nine camp models for the 3D faction campaign map (진영 전역): the joseon, japan and ming navies at camp tiers 1–3, each
with a near and a far level of detail, in `public/models/camps/`. Each camp started as one Meshy Image-to-3D model made
from one concept image. The shipped files are not decimated scans. They are low-poly architecture rebuilt from those
models, with the originals' colour baked on.

## Shipped files

| camp | near `camp_<faction>_<tier>.glb` | far `camp_<faction>_<tier>_far.glb` |
|---|---|---|
| joseon-1 | 1,179 tris · 512² WebP · 72,736 B | 324 tris · 256² WebP · 23,728 B |
| joseon-2 | 1,023 tris · 512² · 70,328 B | 345 tris · 256² · 26,308 B |
| joseon-3 | 1,160 tris · 512² · 85,180 B | 331 tris · 256² · 26,668 B |
| japan-1 | 1,162 tris · 512² · 84,592 B | 314 tris · 256² · 27,368 B |
| japan-2 | 943 tris · 512² · 73,184 B | 334 tris · 256² · 25,748 B |
| japan-3 | 1,120 tris · 512² · 81,700 B | 307 tris · 256² · 25,484 B |
| ming-1 | 1,069 tris · 512² · 70,184 B | 349 tris · 256² · 24,144 B |
| ming-2 | 1,196 tris · 512² · 60,828 B | 340 tris · 256² · 19,848 B |
| ming-3 | 1,191 tris · 512² · 67,048 B | 343 tris · 256² · 21,888 B |

The budgets are at most 1,200 triangles near and 350 far, and `scripts/test-camp-kits.mjs` checks them. The 18 files
total 886,964 bytes (0.85 MiB). `provenance.json` → `shipped` has every file's hash, bounds, vertex count, the
heightmap size it was cut from, its settings and its bake coverage.

## Conventions

- glTF, y up. One unit is the camp's longer horizontal side: the larger of the bounding box's x and z extents is
  exactly 1.
- The lowest point is at y = 0, and the bounding box is centred on x = 0, z = 0.
- **The waterfront faces −z.** That means the jetty, pier or quay, which usually sets the −z bound. The land side is +z.
- Near and far share exactly the same frame: the far level is fitted onto the near level's box. They swap in place.
- Each file has one node, one mesh, one primitive and one material. The material has a base-colour WebP texture,
  metallic 0 and roughness 0.9. It is double-sided because of the banner cards. The normals are flat (hard edges
  everywhere), and there are no normal or roughness maps.
- Required extensions: `EXT_meshopt_compression`, `KHR_mesh_quantization` and `EXT_texture_webp`. Positions are
  quantised, so read them through the node's world matrix.
- The model has no underside: it is open from below. Heights run from 0.32 to 0.51.
- ming-3 is wider than it is deep (x 1.0, z 0.885). Do not turn a camp so its longer side runs along z, or its
  waterfront ends up on ±x.

## How they were made

1. **Concept images.** These came from the OpenAI Images API (`gpt-image-2.5-sunburst`, 1024², quality high,
   transparent background). Tier 1 was generated from text. Tiers 2 and 3 are edits of the chosen tier below, so each
   navy's three tiers share one look.
   - 14 requests were sent, and 12 count against the 20-request budget.
   - The images sent to Meshy and their exact prompts are `concepts/<id>.png` and `.txt`.
2. **Meshy Image-to-3D.** Settings: `meshy-7.1` with texture (2K base colour, no PBR maps), remeshed to triangles at
   12,000–15,000, image enhancement off.
   - 10 tasks used 300 credits, and the balance went from 1,242 to 942.
   - japan-3's first result was rejected (its keep came out no taller than the turrets) and redone from a redrawn
     concept.
   - The angular rebuild below used no Meshy tasks. The balance was still 942 afterwards.
3. **Angular low-poly rebuild** (`scripts/build-camp-models.mjs` with `scripts/camp-shape.mjs`, local only).
   - The first shipped version was the Meshy meshes simplified to 3,000–3,900 triangles. The owner found them wasteful
     and soft (“각지게 … 정제”), so the shapes were rebuilt.
   - Seen from the map, a camp is 2.5D, so its top-down heightmap (256 px) carries the whole form. Banners stand
     taller than anything round them, so they are taken out first and come back as flat cloth and pole cards.
   - A 3×3 opening and a median take off thin junk and Meshy's surface noise.
   - The heightmap is cut into planar facets by region growing on plane fits. Lengths here are in model units, the
     camp being 1 across, and the plane tolerance is 0.005. Specks join their best
     neighbour. Compact bumps lying on a surface that faces the same way are flattened into it: merlons, cannons and
     bollards. Long strips such as wall tops are kept. Coplanar neighbours merge.
   - The facets' shared boundaries are traced and straightened (Douglas–Peucker, with no crossings).
   - Each facet is triangulated at its own plane's heights. Where two facets meet at a step, a vertical wall joins
     them. Where they meet at a crease (a ridge or hip, within 0.02), they share the edge.
   - A budget loop coarsens the edge tolerance and bump merging until the level fits. It falls back to a coarser
     heightmap if needed:
     - near: 256 px, else 192 px (joseon-3, japan-3 and ming-3 used 192)
     - far: 128 px, then 96, then 64
   - The far level keeps only the cloth cards.
   - Blender (`scripts/blender/camp-lods.py`) unwraps each level. Each facet is one connected UV island, and the edges
     between facets stay hard. Blender then bakes the original's colour onto it with Cycles, selected to active, with
     a 0.04 cage so eaves and flattened merlons are reached.
   - Texels no ray reached are filled push-pull. The bake is downscaled 1024→512 (near) and 512→256 (far), Lanczos, to
     WebP at quality 88 and 90, and the file is meshopt-compressed.
   - The build is deterministic.
4. **Review** (`scripts/review-camp-models.mjs`, its own Vite server on port 5303, Edge with WebGPU).
   - Renders use the map's sun, sky light and haze, on green-brown ground with the sea at −z.
   - Sheets are in `shots/s1013/camps-angular/` (git-ignored):
     - `compare-<id>.png`: the previous files beside the new ones, close up and at 150, 80 and 40 px, both levels
     - `compare-overview-150px.png`: the same comparison for all nine at once
     - `views/`: every new file from four sides and from above, at each size
   - `node scripts/review-camp-models.mjs --compare=<dir of older files> --out=<dir>` makes such a comparison.

## Rebuilding

- `node scripts/build-camp-models.mjs [--only=joseon-1,ming-3] [--keep]` rebuilds `public/models/camps/` and the
  `shipped` record. It takes about 5 minutes for all nine.
  - It needs the originals in `originals/`. They are git-ignored at about 5 MB each, and their hashes and Meshy task
    ids are in `provenance.json`. Meshy's download links expire, so keep a copy elsewhere.
  - It needs Blender 5.x. Set `CAMPS_BLENDER` if Blender is not at the default path.
- `node scripts/generate-camp-models.mjs balance|concept|choose|submit|poll|reject|status` runs the paid steps.
  - It needs `OPENAI_API_KEY` and `MESHY_API_KEY` in `.env`.
  - It is guarded: at most 20 image requests, a 400-credit ceiling, two charged attempts per camp, a recorded rejection
    before a retry, and `--confirm-spend` on every submission.

## Known limitations

- **2.5D shapes.** Anything under an overhang is filled solid: gateway passages, the space under a pier and the
  stilts of ming-1's watchtower. Walls drop straight from the eaves. From the map's 40–60° pitch this does not show.
  From a low angle the piers read as solid blocks.
- **Curved surfaces become a few planes.** Thatch, tents and the japan-1 curtain screens are faceted. The baked colour
  still carries their look.
- **Banners.** There are 27 cloth cards and 80 poles. joseon-3 and ming-3 got only poles: their tower banners read
  through the colour baked onto the towers, which holds at map size. The red Japanese banners carry some of Meshy's
  white blotches.
- **Atlas coverage.** The bakes cover 31–45% of their atlas.

## Folder

- `provenance.json` records everything:
  - every image request: prompt, model, hash, and whether it counts against the budget
  - every Meshy task: parameters, task id, credits, and the original's hash
  - the balances
  - the shipped files and how they were built
- `concepts/` holds the nine images sent to Meshy and their prompts.
- `originals/` (Meshy GLBs) and `candidates/` (all generated images and Meshy's previews) stay local.
