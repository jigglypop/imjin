# Settlements of the campaign map

The camps, towns and works of 캠페인's map, rebuilt as one miniature per region: a Total War style settlement that grows in
three tiers, its works on reserved lots the way a Civilization city's districts are, drawn bold enough to read at 75 to
350 pixels. `types.ts` is the contract, `fixtures.ts` three sample sites to build against. No hex grid, no generated meshes.

Why: today a camp is 5 to 11 buildings scattered on a disc (`mapWorld.ts` rings and polar offsets), standing on unlevelled
ground (59 % of buildings over more height than their footing, up to 7.8 m buried), lit unlike the land, laid out again on
the main thread at every change (270 to 530 ms), and things vanish or jump when a camp is upgraded.

## How it fits together

```
offline   regions + drawn terrain --solver.ts--> public/ui/grand_sites.json   (one SiteRecord per on-map region)
          SiteRecord.pads --build-grand-terrain.mjs--> grand_terrain.bin       (pads flattened into the TIN)
run time  RegionView --> SiteState (owner, tier, works)                        (a site rebuilds only when this changes)
          worker: buildCamp / buildTown / buildWork / buildWall / buildGroundworks --> MeshData x LOD0, LOD1, LOD2
          main:   pack.toGeometry, one merged mesh per site and level, every site's LOD2 merged into one draw, one material
```

Positions come from the site and never move; a tier, a level or an owner only chooses what is drawn there. Nothing is
laid out at run time.

Order of work: this contract; then two streams side by side, SITES (solver, lots, pads in the terrain, ground works, a
plan per region) and MODULES (palette and material, walls, each navy's three camp tiers, the town, the works, review
sheets against the art), both building on `fixtures.ts` until the real records exist; then the integration into the map
behind `?settle=1`; then life and state (scaffolds while a work goes up, hulls on the slips, garrisons at the berths,
beacon smoke, siege and unrest) and the same kits on the battle coast.

## Coordinates (types.ts)

- A site's frame: model metres, x east, z south, y up, origin in the middle of the core pad at frame point `(u, v)`, the
  sea plane at y = 0. `MODEL_METRE` = 3.25e-4 frame units across and up; a site mesh takes
  `translate(u - 0.5, 0, (v - 0.5) / MAP_ASPECT) x scale(MODEL_METRE)` (`siteToWorld`).
- The kits' 160x scale against the terrain's 4.2x relief: a DEM texel is 0.98 model m across, a metre of elevation
  `ELEVATION_METRE` = 0.026 model m up (a 100 m hill stands 2.6 m, a hall's roof 10 m). Land at the coast stands 0.04 above
  the sea, hence `PAD_MIN` 1.2 and `QUAY_TOP` 0.9.
- `rot` is three's rotation.y: a thing's front (+z) faces `facing(rot)` = (sin rot, cos rot). Outlines run counter-clockwise
  seen from above on a north-up map (`kitParts.rect` order, `outlineArea` > 0); the outward normal of edge a to b is
  (a.z - b.z, b.x - a.x). `seaward` points from the core pad through the harbour gate to open water.
- `Ground.height` is the drawn land with pads flat, 0 on water; `Ground.water` the drawn waterline. At run time it is the
  TIN as drawn (bilinear like `MapLayer.surface`), in node a fixture's grid.
- Screen sizes at a 1600 px window: 0.92, 1.7, 4.2, 8.5, 20 px per model metre at camera distance 0.55 (opening), 0.3,
  0.12, 0.06, 0.025. An 84 m camp is 77, 143, 353, 714 px; a 13 m house 12, 22, 55, 110 px.

## The site record

- `pads`: the core pad (a superellipse of 84 x 65 m, exponent 4.5, clipped by the shore and by neighbours, never under
  about 60 % of that across) and small pads under the battery, granary and beacon. Flat at `h0` inside, eased outside;
  land within two texels of the water is left alone so no coastline moves.
- `camp.walls[1..3]`: each tier's wall line on the core pad, nested (tier 1 inside 2 inside 3; the wall upgrades in
  place, so lines may touch). Gates sit exactly on the line: `sea` (the main gate, under the camera's usual view),
  `land` (to the roads), `side`. Corner towers are the wall builder's, where the line turns more than about 25 degrees.
- `camp.lots`: roles, not models (`hall`, `office`, `barracks`, `store`, `yard`, `well`, `pavilion`, `tower`), each with
  its tier `from`. A tier-1 hall lot is sized for the tier-3 hall; the tier-1 builder draws a small office on it.
- `harbour`: the quay on the real shoreline, the stretch each tier builds (`span`) as an apron back to the core pad's edge
  (1 to 15 m of land between them), the gate where markers and cards anchor, piers by tier with their berths, anchorage
  spots beyond (twelve or so), an optional tier-3 breakwater.
- `town`: Korean or Japanese houses whoever holds the port; streets and lots stand from a town value `from` (the hamlet is
  the seven houses nearest the camp, the market town the twenty nearest); a value-3 wall and a value-2 stub.
- `works`: every work's slot, sized for its third level (`SLOT_SIZE`); shipyard and dock straddle the waterline at local
  z = `shore`, the beacon's is the summit.
- `fields` as strips along `dir`, `roads` as this site's half of the way to a neighbour.

## Builders

| contract | file (stream) | draws |
| --- | --- | --- |
| `BuildCamp(navy, tier, site, ground)` | `modules/camp.ts` (MODULES) | walls and gates (through `buildWall`), the lots of tiers up to `tier`, the yard floor inside the wall, the quay's stretch and the piers of the tier, banners |
| `BuildTown(value, owner, site, ground)` | `modules/town.ts` (MODULES) | lots and walls up to `value` (and the seat's lots), owner pennants and ridge tint, none while unowned |
| `BuildWork(kind, level, navy, slot, ground)` | `modules/works.ts` (MODULES) | one work of a level inside its slot, Korea's style while nobody holds the port |
| `BuildWall(line, style, ground)` | `walls.ts` (MODULES) | a mitred ribbon every 2 m (6 m at LOD1): level crown on a pad, stepping off one, battered face with a skirt to the ground, coping and merlons at LOD0, gates, towers at corners |
| `BuildGroundworks(site, ground)` | `groundworks.ts` (SITES) | what lies on the ground whatever stands: pad skirts and retaining walls, streets up to the site's value, roads, fields. Built once per site |

Every builder is pure and deterministic (no `Math.random`, no DOM, no three.js; seed from the site id and lot index), runs
in a worker and in node, and returns `Built { lods, marks }`: three `MeshData` in the site's frame with absolute heights,
LOD0 above about 450 px, LOD1 above 130, LOD2 below (merged map-wide, silhouettes only: pad, wall ribbon, one to three
landmarks, houses as blocks, banner poles three times thick). `options.lods` asks for some levels only; the others come
back empty. Nothing leaves its lot or slot, eaves included, except banners and piers. A footing reaches at least
`lot.drop` + 0.3 below `lot.y`. `marks` carries smoke points and slipways for the life added later.

## Colour and light

- Vertex colour = palette (linear RGB, at most 1) x `bakedLight(normal)` x the occlusion `bakeGrime` folds in. No lights
  at run time, no normal map; one unlit material for every navy and site, with fog. Packed by `pack.toGeometry` as today.
- `bakedLight` is the land's light (same sun, sky and colours as `groundPalette.ts`, identical for anything facing up) plus
  ground bounce on walls. The sun stands high in the north-west and the camera usually looks north, so the faces it sees
  are in shade: a lime wall facing it gets 0.48 against 0.9 on the flat. Choose palettes for that face.
- Value contrast and navy identity come from the palette: Joseon slate-blue roofs, white lime walls, red dancheong; Japan
  near-black roofs, white plaster, black boarding, gilt; Ming ochre glaze, red walls and columns, grey brick.
- The optional detail atlas (`DETAIL_ATLAS`, 512 px, 16 cells) is sampled at LOD0 only, from the cell in `mat` (0 none) with
  uv in metres per tile, fading with distance. Every cell averages mid grey and is applied as 2 x detail, so it never moves
  a surface's mean colour and the levels match when they swap. `SURF` classes: cloth and banners sway (the `sway`
  attribute on `worldClock`) and take no detail, embers glow, the rest is plain.

## The art target

The 54 illustrations in `public/ui/camps/<art>-L1..L3.webp` are the target, chosen by `campArt.ts` (Joseon `yi` and
`admiral`, Japan `wakisaka` and `japan`, Ming `deng` and `chenlin`). They are night scenes seen from the land; the map is
day, seen from the sea (its camera looks north at a south-facing coast), so the harbour, the sea gate and the hall's front
face the camera. Take their composition, density and silhouettes, not their lighting.

**Joseon**
- L1, jin: a stockade of sharpened logs on a low earth bank, a rounded rectangle about 45 x 35 m, one small tiled gate;
  a packed-earth yard with a fire, a tiled hall and two or three thatched barracks and sheds; six to eight tall blue and
  white banners on the stockade; a path down to one timber jetty with a boat or two. No quay.
- L2, poyeong: a plank-faced timber rampart on a rubble footing, a two-storey gate tower, two corner watch platforms; the
  hall with its own courtyard, a row of five to seven long tiled barracks along one side, a drill yard; a 20 m quay and two
  piers with one or two panokseon moored; banners every 10 m.
- L3, suyeong: dressed granite with the white crenellated parapet (yeojang) and lanterns on the wall walk, corner
  turrets, three gates under pavilions, the sea gate grandest with steps; a dense grid of tiled barrack rows on lanes, the
  five-bay dongheon with red columns on its terrace, a pavilion, a magazine, a well; a stone quay along the whole front,
  three finger piers, up to three ships moored and more at anchor; smoke from several chimneys.

**Japan**
- L1: a rectangular field camp of plank fence and curtains (jinmaku), six to eight white nobori, two to four low plank huts
  and a command tent round a fire; a short beach jetty with kobaya.
- L2: a polygonal enclosure on a fitted-stone footing, plastered and boarded walls, a turret gate (yagura-mon) with steps,
  corner turrets; five to eight long houses (nagaya) round a yard; nobori along the walls; a jetty with two or three
  sekibune and atakebune.
- L3: tall stepped ishigaki, white plaster over black boarding, turret gates, corner yagura, inner terraces, dense blocks
  of halls; the keep (three-tier tenshu, gilt shachihoko) on the top terrace as the landmark (the art puts it on the hill
  behind; the map needs it inside); a long stone landing with many ships, the walls running down to the water.

**Ming**
- L1: a square stockade with cut corners, a small red gate pavilion under yellow glaze, three or four timber halls or
  tents, red and yellow flags at the corners; a jetty with two small junks, or a quay along a canal.
- L2: grey brick with crenels on a stone base, square with chamfered corners; a big gate tower, ochre glaze over red
  columns; long barracks along the inside of the walls round a parade yard, a hall; a pier with two large junks.
- L3: a large rectangular brick fortress, corner bastions, several glazed gate towers; a dense grid of barrack rows, the
  double-eaved yamen hall at the far side; a long T-headed pier or a canal quay with six to eight junks.

**Towns** (no illustration; owner shown only by pennants and ridge tint): value 1, a hamlet of five to eight houses on a
shore street, fish racks, two beached boats, the village tree; value 2, a market town of 14 to 22 houses on two streets
with a market square, a well and an earth wall stub; value 3 (Busan), a walled town of 30 to 45 houses with a market,
a temple and gates; a seat adds the yamen.

**Works** by level: battery, a three-embrasure earth bastion, then stone with five guns and a magazine hut, then two tiers
and eight guns; shipyard, one slip and a shed, then two slips, a hull on the stocks and a timber yard, then three slips, a
dry dock and a sawpit; dock, a pier, then two piers and a warehouse, then a stone basin, a breakwater and two warehouses;
granary, one raised store, then three, then six in a fenced compound; beacon, one smoke stack, then three, then the
five-stack bongsudae with its watch hut and flag.

**What each tier adds**

| | wall | inside | harbour | area |
| --- | --- | --- | --- | --- |
| 1 | logs, curtains, stockade | a yard, the hall lot as an office, two or three barracks | one jetty | 1 |
| 2 | earth and timber, a gate tower, corner towers | the real hall, office and store, rows filling the flanks | 20 m quay, two piers, ships moored | about 1.6 |
| 3 | granite, ishigaki or brick, gate pavilions, turrets | a dense grid, landmark, pavilion, magazine, well | stone quay, three piers, a fleet | about 1.5 more |

## Budgets

Triangles per site at LOD0 / LOD1 / LOD2 (`TRIANGLES`): camp tier 1 2.5k / 0.8k / 150, tier 2 6k / 1.8k / 250, tier 3
14k / 3.5k / 400 (a seat 20k / 5k / 500), walls and harbour included; town value 1 2.5k / 0.7k / 100, value 2 6k / 1.6k /
200, value 3 12k / 3k / 350; a work 0.8k, 1.6k, 2.5k at LOD0 by level (LOD1 about 30 %, LOD2 40 to 80); ground works
4k / 1.5k / 150. The layer (`LAYER`, desktop only; phones keep the flat map): about 90k settlement triangles on screen at
mid zoom, 200k at worst; 40 draws aimed for, 80 at most; LOD2 of every site 25k in one draw; 12 MB of GPU memory at full
build-out (so LOD0 is built for the few sites near the camera only); 25 ms to build a site in the worker; 0.2 ms a frame
to choose levels (hysteresis 1.12). The medium tier swaps to LOD0 at 1 / 0.75 of the width and draws fields at LOD0 only.

## Acceptance gates

SITES (`node scripts/build-grand-sites.mjs --check`, failing the build):
- a record for each of the 37 on-map regions, every slot placed at full build-out (camp tier 3, every work level 3, the
  town at its value), every lot inside `LOT_SIZE` and its tier's wall (1.5 m clear of it), nothing overlapping anything
  else of its own or a neighbouring site;
- with the pads in the TIN: ground within `PAD_TOLERANCE` of h0 inside every pad, under every pad lot within `PAD_RANGE`,
  town lots' `drop` up to `TERRAIN_DROP` and true (no buried or hanging corner over 0.1 m);
- the drawn coast unchanged by the pads (`build-grand-terrain.mjs --preview` counts equal before and after), the TIN still
  byte-identical on a rebuild;
- quay points on land within 2 m of water and, over the tier-3 stretch, within 15 m of the core pad with only land
  between; piers over water along their length, berths and anchorage hulls (`BERTH`) on
  open water clear of piers, slips and each other, at least twelve hull spots a port; streets and roads never over water;
- a plan per region over its terrain (`--preview`), like the fixtures' (see below), looked at.

MODULES (`node scripts/test-settle-modules.mjs`, node; `scripts/review-settle-modules.mjs`, browser):
- triangles within `TRIANGLES` for every navy, tier and level on every fixture (and every record once they exist);
  nothing outside its lot or slot; footing as deep as `drop` + 0.3; wall crowns level within 0.05 on a pad;
  deterministic bytes; 25 ms a site with every level;
- contact sheets per navy and tier on each fixture at distances 0.55, 0.3, 0.12, 0.06 and pitches 0.78 and 0.4, beside the
  matching illustration; level swap invisible (mean colour difference under 6/255 over the site at the switch distance);
  silhouette area at 0.55 at least 1.4 times the tier below; each navy's tier within 15 % of the others'; a lime wall
  facing the camera at least 0.55 sRGB luma, roofs at least 0.2 darker than the walls under them;
- the owner's eye: nothing is integrated before the sheets are shown and accepted.

Integration (a later stream): the layer within `LAYER`, markers and cards at `harbour.gate`, hulls at berths and anchorage,
no main-thread layout, the old kits kept behind `?settle=1` until the new ones match them everywhere, then removed.

## Who owns what

- This stream (settle-arch): `types.ts`, `fixtures.ts`, this README. A change to `types.ts` is a contract change: its own
  commit, `Settle contract: ...`, which both streams take before going on.
- SITES: `solver.ts`, `lots.ts`, `groundworks.ts`, `scripts/build-grand-sites.mjs`, `public/ui/grand_sites.json`,
  `scripts/build-grand-terrain.mjs` (pads), `public/ui/grand_terrain.bin`, `../groundLand.ts`, `../groundPalette.ts`
  (pads painted as their own ground, not paddy; reads `LIGHT` from `types.ts`).
- MODULES: `modules/*`, `walls.ts`, `palette.ts`, `material.ts`, `scripts/review-settle-modules.mjs`,
  `scripts/test-settle-modules.mjs`. Builds against `fixtures.ts` until the records exist.
- Later: `../mapWorld.ts`, `../mapLayer.ts`, `../campaignWorld.ts`, `../WorldCanvas.tsx`, `../GrandMap.tsx`,
  `../cardLayout.ts`, `../worldTrees.ts`, `../adapt.ts`; then `campBuildings.ts`, `campPieces.ts`, `campMaterial.ts`,
  `kitParts.ts` and the building atlases retire.
- Shared, change only in a small commit both streams hear of: `src/ships/build/parts.ts`, `bake.ts`, `pack.ts`.

## Known traps

- Crowding: twelve of the 37 ports have a neighbour within 60 m (Yeongdeungpo and Jangmunpo 18 m apart) and the nominal
  core pad rarely fits whole by its port, so sites are placed greedily by value, clipped, and may stand a couple of
  radii from their marker. Every builder must take irregular, clipped outlines; the fixtures have them.
- `kitParts.walls` winds its faces inward for a `rect` outline (normals point at the middle, so from outside the front wall
  is culled and the back wall's inside shows through); new walls must face out.
- The rules stop at level 3 (`MAX_LEVEL`): no fourth tier, the old level-4 plans are dead.
- `mapWorld.ts` may take only types from `settle/`, since `types.ts` reads `SETTLEMENT_RADIUS` from it.
- Per-instance colour (`instanceColor`) is not needed: sites are merged meshes rebuilt on an owner change. Should
  instancing come back, `worldTrees.ts` shows the r186 node materials read it.

## The fixtures

`fixtures.ts`: Yeosu (value 2, a seat), Busan (value 3) and Noryang (value 1), laid out by hand-written rules over the
drawn terrain round the real ports, every lot, slot, pier, hull spot and street checked against the gates above on the
fixture's own ground (`fixtureGround`, a 3 m grid with the pads flat). Their camps are sparse next to the art: the
SITES stream's `lots.ts` is what makes a tier-3 interior dense.
