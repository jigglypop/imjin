---
name: chapters
description: Rules for adding or changing a MOONWAKE chapter (Armada 1588, Lepanto 1571, Trafalgar 1805 (Red Cliffs was dropped by the owner), or a new one) - registry, factions, ships, battles, campaign, cross-chapter balance, visuals, assets and checks. Load before touching src/chapters, a chapter's ships, battles, campaign or balance.
---

# MOONWAKE chapters

A chapter is a whole war at sea, built to the bar of 임진왜란: historical battles, a faction campaign with commander growth,
its representative flagship on the menu, ships balanced within and across chapters, and PvP waves (docs/design-pvp.md).

## Registry layout
- `src/routes.ts`: `CHAPTER_IDS` and `CHAPTER_BATTLES[chapter]` (slugs only; no imports). Pages: `/<chapter>`, `/<chapter>/battles/<slug>`, `/en/<chapter>...`.
- `src/chapters/index.ts`: `CHAPTERS` (`ready`, `navies`, `hero` flagship + escorts, poster billing, campaign/history lines) and `chapterOfFaction` (must name every new faction).
- English text: `src/i18n/en/chapters.ts` (+ battle/commanders files). Korean is the source string in code; every new player string needs its /en twin.

## Adding a chapter, in order (one commit per step)
1. Sim: factions in `src/sim/types.ts`, ship kinds + guns from period sources in `src/sim/catalog.ts` (length, beam, crew, guns, speed), codex entries. Guns are scaled to the 1592 ladder (천자총통 520 m is the reference).
2. Commanders: portraits via gpt-image (same film-still set as 1588), prompts + estimated cost in `assets-src/<set>/provenance.json`.
3. Battles: slugs in routes, scenarios with real coasts (Terrarium DEM bake like the Channel map), fleets, commanders, guides.
4. Campaign: the generalized grand campaign (`src/sim/grand`) on the chapter's own region set and map; the 1592 grand campaign must stay identical (its tests and digests). How (the Armada is the pattern): factions in `GrandFaction` and every faction-keyed table (`TUNING`, `GARRISON_KIND`, `AI`, `OPTION_TEXT`, `FACTION_INFO`); regions/lanes/commanders/start in a `regions<Chapter>.ts` merged into `REGIONS`/`LANES`/`COMMANDERS`; trees and techs in `growthData.ts`; an entry in `THEATRES` (`theatre.ts`, saved as `Grand.theatre`); battle sites in `coast.ts` + `node scripts/build-region-maps.mjs <ids>`; the map's DEM (`fetch-dem.mjs`), land (`build-grand-terrain.mjs --theatre=`) and frame in `src/ui/grand/mapTheatre.ts`; `theatreOfChapter` in `theatreChoice.ts`; camp kits (`campEurope.ts` style) and camp art. Check with `scripts/test-grand-armada.mjs`-style tests and the 1592 digests.
5. Ship models: procedural builders in `src/ships/build/<chapter>.ts` + gpt-image atlas; crew models of the chapter's own people (never borrowed Ming/Japan crews).
6. Crews (병력): made exactly the way the 1592 crews are (same model/texture/LOD/animation/instancing pipeline in src/fx/Crew.ts, crewModels.ts, crewTypes.ts and their assets-src provenance), era-correct per faction - Armada: English and Spanish sailors/soldiers; Lepanto: Venetian/Spanish arquebusiers, galley rowers, Ottoman janissaries/azaps/archers; Trafalgar: British/French/Spanish sailors and marines in period uniform. Never borrow Joseon/Japan/Ming crews.
7. Menu hero, share cards, ship cards, HUD faction names, terrain dressing of the region (villages, trees).
8. Balance (below), server acceptance, memory probes, tests, screenshots you actually looked at.

## Owner requirements (2026-10-17)
- Preview images: every chapter battle gets the same preview set as the 1592 battles (battle preview pictures, cards, share images, menu previews), same pipeline and quality.
- Choosing a chapter switches the whole UI to that chapter (tabs): battles, campaign, codex, generals. /generals lists the chapter's commanders by faction tab (England/Spain, Holy League/Ottoman, Britain/France-Spain); portraits stand in until their 3D figures come from the generals-cast pipeline (the lead schedules those).
- Strict historical accuracy (고증): commanders per battle, ship names and types, flags/ensigns, uniforms/armour, dates, weather/wind, tactics, place names - each sourced, sources recorded in the data (`sources` fields) or docs; no invented facts.
- Fleet sizes are historical, one for one like 1592's (명량 13 vs 133, 부산포 636 ships, 노량 623): every ship of the squadrons engaged in that action, with the source in the scenario file's header and the counts in `forces`. 1592 proves the engine and the phone budget at ~640 ships, so no chapter battle needs scaling; a future battle over that would scale both sides by one factor and say "실제 n척" in `forces`. Check `probe-memory.mjs ?q=low` on the chapter's biggest battle (Calais 272 ships: 182 MB textures, 267 MB GPU).
- Battle data must drive the battle-opening cinematics (.claude/skills/cinematics in the main checkout): per battle the commanders present and quotes with sources.

## Cross-chapter balance
- Stats stay historical; fairness is set by **price** (`COMPETITIVE_UNITS[kind].spec.cost` in `src/sim/competitive.ts`). 1592 prices are fixed (ranked).
- Benchmark = AI vs AI conquest, navy fleet vs navy fleet:
  `node scripts/balance-competitive.mjs --mode=conquest --seeds=16 --match=a:b[,..] [--set=unit.<kind>.cost=<n>]`
  Use at least 12-16 seeds: 6 seeds swing 30 points between neighbouring prices.
- Target: the two navies of one chapter 50% +-10; each new navy vs each 1592 navy within the band 1592's own pairs show (currently 83-100%, i.e. the benchmark is lopsided for 1592 itself; do not change 1592 prices or digests, report to the lead instead), aim for 25-75% vs every other navy.
- Record results in `docs/balance-cross.md`.
- Cross-era (settled 2026-10-18): base prices balance a chapter's own navies; a mixed-era room scales every seat's budget by `ERA_BUDGET_SCALE` (1805: 4) and multiplies the later navy's prices by `CROSS_ERA_PRICE` (`eraOptions`, `Conquest.shipSpec`, `autoFleet(..., priceScale)`). Judge by each navy's average over the three 1592 navies x two maps (cells swing 6-100% by map); 1805 now 54-56%. Rooms of one era are untouched (1592 digests identical); ranked stays 1592-only.

## Determinism
- `src/sim` deterministic: no Date.now/Math.random/DOM/three; seeded RNG only. Client-needed fields go in `src/net/protocol.ts`.
- 1592 digests: `node scripts/sim-digest.mjs --out=before.json` on main code, again after, `--compare=before.json,after.json`. Must be identical. If they differ: find the first differing step, fix it; if deliberate, stop and tell the lead before committing.

## Ship visual bar ("1592 quality", concretely)
- Match the panokseon/atakebune builders: curved sheer and tumblehome hulls (no box castles - castles taper, have rails, overhang, carved/paint bands), planking and wale lines in the atlas, gunports as recessed geometry or atlas, rigging lines, flags.
- Sails: lit from the front as well as behind - two-sided material with the 1592 sail shading, cloth colour bright enough that a backlit sail is not a black silhouette at the menu/battle sun.
- LOD triangle budgets: far LOD (lods[2]) <= 900 triangles for every kind, every chapter (tested in scripts/test-camp-kits.mjs; never narrow the test, reduce the mesh). Near LOD in the range of the 1592 ships.
- Check with `node scripts/shot.mjs` beside a 1592 ship at the same moment and camera.

## Menu flagship hero shot
- `CHAPTERS[].hero.kind` is the flagship (거북선 for 1592; Ark Royal-class race galleon for 1588; galleass / Real for Lepanto; HMS Victory for Trafalgar). Tall-masted ships are framed from further off and higher. Do not alter the turtle ship's look.

## Assets, provenance, audio, text, memory
- Disk: keep >= 3 GB free on C:. Archive bulky generation sources to S3 with `npm run assets -- archive` (when it exists); otherwise delete your own intermediates.
- Binaries (models, textures, audio, fonts, terrain, raw generations) go through `npm run assets -- push` and the committed `assets.json`; never commit binaries directly. Record every generated asset with prompt, tool and cost in provenance.json. Paid gen allowed (gpt-image, Tripo); Meshy is reserved for commander rigs - don't use it.
- No human voices in battle audio (no cheers, shouts, war cries).
- Phone: `?q=low` battle of the chapter through `scripts/probe-memory.mjs` (textures < 300 MB, GPU < 400 MB) and `scripts/probe-leak.mjs` (battle disposal frees everything).
- Online: new factions accepted server-side for casual rooms; ranked stays on `RANKED_ROSTER` (1592) until the cross-chapter harness passes 50+-5 (docs/design-pvp.md).

## Automated checks (scripts/test-chapters.mjs)
Every ready chapter: >= 4 battles with scenarios, flagship kind exists in SHIP_SPECS and builds, every chapter faction mapped by chapterOfFaction, every ship far LOD <= 900, English text present. Balance smoke stays in the doc (too slow for npm test).

## Rejected (don't repeat)
- Open-sea equal-points duel (`scripts/balance-cross.mjs`) as the benchmark: gives 0%/100% even for 1592 pairs. Reference only.
- Pricing by 6-seed runs: noise dominates (race galleon 1100 -> 40%, 1130 -> 62%, 1160 -> 59%).
- Narrowing a budget test to the 1592 navies instead of fixing the mesh.
- Aliasing a new chapter's ships or crews to Ming/Japan models as placeholders.
- Boxy stacked castles and dark single-sided sails on the Armada galleons.
- Parallel git worktrees per chapter, each with a full `npm run assets -- pull`: filled C: (each copy is GBs). Work chapters one at a time in the single chapters worktree; keep >= 3 GB free and delete your own intermediates.
- Running `build-battle-art.mjs --capture` while other GPU work (shot.mjs, probes, other agents' captures) runs: the headless page loses its device or never reaches `__ready`. Capture one battle at a time on a quiet GPU; the long Channel battles use two moments, not three.

## Settled (2026-10-17)
- Later chapters' openings come from `src/cinema/scenes/chapters.ts` (one generic intro per battle from its ScenarioInfo + `<CHAPTER>_QUOTES`); lines without a record are labelled "(인물 대사 아님)" in their source. Add a new chapter's battles there.
- Link cards of later chapters carry the chapter name (MOONWAKE · <war>) instead of the Imjin seal; add the battle to `CARD_VERSION` in routes.ts once its stills exist.
- Image generation falls back to Gemini (`--provider=gemini`, scripts/gemini-image.mjs) when OpenAI is out of credit; Tripo image-to-model costs about 40 credits per crew figure (check `GET /v2/openapi/user/balance` first).
