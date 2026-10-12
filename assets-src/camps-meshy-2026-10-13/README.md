# Campaign camps from Meshy (2026-10-13)

Nine camp models for the 3D faction campaign map (진영 전역): the joseon, japan and ming navies at camp tiers 1–3, each
with a near and a far level of detail, in `public/models/camps/`. Every camp was made with Meshy Image-to-3D from one
concept image. This folder holds what you need to check and rebuild them. Nothing in `src/` uses them yet.

## Shipped files

| camp | near `camp_<faction>_<tier>.glb` | far `camp_<faction>_<tier>_far.glb` | x × y × z (units) |
|---|---|---|---|
| joseon-1 | 3,004 tris · 1024² WebP · 236,036 B | 681 tris · 256² WebP · 35,860 B | 0.814 × 0.448 × 1 |
| joseon-2 | 3,413 tris · 1024² · 237,048 B | 790 tris · 256² · 39,196 B | 0.851 × 0.347 × 1 |
| joseon-3 | 3,963 tris · 1024² · 277,348 B | 894 tris · 256² · 44,180 B | 0.910 × 0.326 × 1 |
| japan-1 | 3,046 tris · 1024² · 269,900 B | 698 tris · 256² · 40,284 B | 0.689 × 0.360 × 1 |
| japan-2 | 3,503 tris · 1024² · 242,344 B | 804 tris · 256² · 40,044 B | 0.756 × 0.389 × 1 |
| japan-3 | 3,914 tris · 1024² · 248,012 B | 880 tris · 256² · 42,984 B | 0.933 × 0.515 × 1 |
| ming-1 | 3,057 tris · 1024² · 224,644 B | 706 tris · 256² · 36,120 B | 0.833 × 0.438 × 1 |
| ming-2 | 3,413 tris · 1024² · 198,192 B | 803 tris · 256² · 36,400 B | 0.729 × 0.344 × 1 |
| ming-3 | 3,912 tris · 1024² · 225,868 B | 860 tris · 256² · 38,128 B | 1 × 0.369 × 0.893 |

18 files, 2,512,588 bytes (2.40 MiB). `provenance.json` → `shipped` has every file's hash, vertex count, bounds,
simplification error and bake coverage.

## Conventions

- glTF, y up. One unit is the camp's longer horizontal side: the larger of the bounding box's x and z extents is
  exactly 1.
- The lowest point is at y = 0, and the bounding box is centred on x = 0, z = 0.
- **The waterfront faces −z.** That means the jetty, pier or quay, which usually sets the −z bound. The land side is +z.
- Near and far share exactly the same frame, because the extreme vertices are locked while simplifying. They swap in
  place.
- Each file has one node, one mesh, one primitive and one material. The material has a base-colour WebP texture,
  metallic 0 and roughness 0.9. It is double-sided because of the thin banners. There are no normal or roughness maps.
- Required extensions: `EXT_meshopt_compression`, `KHR_mesh_quantization` and `EXT_texture_webp`. three's GLTFLoader
  handles them with the MeshoptDecoder the runtime already registers.
- Positions are quantised, so the node carries a dequantising translation and scale. Read positions through the node's
  world matrix, as `loadModel` in `src/ui/grand/mapLayer.ts` does with `matrixWorld`.
- The base's underside was removed (the map never shows it), so the base is open from below. Heights run from 0.33 to
  0.52.

Notes for integrating them on the map:

- `loadModel` in `mapLayer.ts` also turns a model so its longer side runs along z. ming-3 is wider (x 1.0) than deep
  (z 0.893), so skip that turn for camps. Otherwise ming-3's waterfront ends up on ±x.
- The procedural camps put their dock at `SEA_SIDE = π` (−x), and then `faceSea` turns the whole layout by `turn`. To
  face a GLB camp the same way, set `rotation.y = π/2 − turn`. The π/2 brings −z round to −x. The layout's turn, which
  rotates x toward z, is −turn about +y.

## How they were made

1. **Concept images.** These came from the OpenAI Images API (`gpt-image-2.5-sunburst`, 1024², quality high,
   transparent background). Tier 1 was generated from text. Tiers 2 and 3 are edits of the chosen tier below, so each
   navy's three tiers share one look.
   - 14 requests were sent, and 12 count against the 20-request budget. Two connections dropped during the upload and
     were retried. Two earlier drops are counted even though they were probably not billed.
   - Before going to Meshy, each chosen image had the faint glow the model paints round banners removed (alpha below
     32). Its transparent area also got a white background. These are the `concepts/<id>.png` files, and each has its
     exact prompts beside it in `concepts/<id>.txt`.
2. **Meshy Image-to-3D.** Settings: `meshy-7.1` with texture (2K base colour, no PBR maps), remeshed to triangles at
   12,000 for tiers 1–2 and 15,000 for tier 3, image enhancement off, moderation on.
   - Each task cost 30 credits. 10 tasks used 300 credits, and the balance went from 1,242 to 942.
   - japan-3's first result was rejected: its keep came out as a squat hall no taller than the corner turrets, so at map
     size the fortress read as tier 2. Its concept was redrawn with the keep as a tall, free-standing centrepiece, and
     the second task shipped (`conceptHistory` and the attempt records keep both).
3. **Local build** (`scripts/build-camp-models.mjs`, which never calls a provider).
   - Meshy's atlas gives nearly every triangle its own UV island (about 5,000 islands for 12,000 triangles), so no
     simplified level can keep those UVs.
   - Each original is turned so the waterfront faces −z, normalised and welded by position, and the base's underside is
     dropped.
   - Each level is simplified with meshoptimizer: 3,000 / 3,500 / 3,900 near and 700 / 800 / 880 far, by tier. The
     extreme vertices and their fans are locked. `Regularize` avoids slivers, which show as dark lines, and coincident
     cloth triangles are merged.
   - Blender (`scripts/blender/camp-lods.py`) unwraps each level afresh (Smart UV Project at 70°, packed with a margin)
     and bakes the original's colour onto it with Cycles, selected to active.
   - Texels no ray reached are then filled push-pull, downscaled 2048→1024 and 512→256 (Lanczos) to WebP at quality
     86 and 90, and the file is meshopt-compressed.
   - The rebuild is byte-identical.
4. **Review** (`scripts/review-camp-models.mjs`).
   - It runs its own Vite server on port 5303 and drives Edge (WebGPU).
   - Each near and far file is rendered from four sides and from above, under the map's sun, sky light and haze, on
     green-brown ground with the sea at −z.
   - Each is also rendered at the 150, 80 and 40 px it has on the map.
   - The sheets are in `shots/s1013/camps-meshy/`, which is git-ignored. `originals/` there has the raw Meshy results
     and the rejected japan-3 attempt.

## Rebuilding

- `node scripts/build-camp-models.mjs [--only=joseon-1,ming-3] [--keep]` rebuilds `public/models/camps/` and the
  `shipped` record.
  - It needs the originals in `originals/`. They are git-ignored at about 5 MB each, and their hashes and Meshy task
    ids are in `provenance.json`. Meshy's download links expire, so keep a copy elsewhere.
  - It needs Blender 5.x. Set `CAMPS_BLENDER` if Blender is not at the default path.
- `node scripts/review-camp-models.mjs [--originals]` renders the review sheets.
- `node scripts/generate-camp-models.mjs balance|concept|choose|submit|poll|reject|status` runs the paid steps.
  - It needs `OPENAI_API_KEY` and `MESHY_API_KEY` in `.env`.
  - It is guarded: at most 20 image requests, a 400-credit ceiling, two charged attempts per camp, a recorded rejection
    before a retry, and `--confirm-spend` on every submission.

## Known limitations

- **Far levels lose thin parts.** Banners become single slanted triangles, ming-1's watchtower loses its legs, and the
  piers become slabs. They read correctly at the 40–80 px they are meant for, but up close use the near level.
- **Japanese banners.** Meshy painted the red Japanese banners with white blotches. At map size they look plain.
- **Atlas coverage.** The bakes cover 31–49% of their atlas, so the effective texture detail is about that share of
  1024² (near) or 256² (far).

## Folder

- `provenance.json` records everything:
  - every image request: prompt, model, hash, and whether it counts against the budget
  - every Meshy task: parameters, task id, credits, and the original's hash
  - the balances before and after
  - the shipped files
- `concepts/` holds the nine images sent to Meshy and their prompts.
- `originals/` (Meshy GLBs) and `candidates/` (all generated images and Meshy's previews) stay local.
