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
4. Campaign: the generalized grand campaign (`src/sim/grand`) on the chapter's own region set and map; the 1592 grand campaign must stay identical (its tests and digests).
5. Ship models: procedural builders in `src/ships/build/<chapter>.ts` + gpt-image atlas; crew models of the chapter's own people (never borrowed Ming/Japan crews).
6. Crews (병력): made exactly the way the 1592 crews are (same model/texture/LOD/animation/instancing pipeline in src/fx/Crew.ts, crewModels.ts, crewTypes.ts and their assets-src provenance), era-correct per faction - Armada: English and Spanish sailors/soldiers; Lepanto: Venetian/Spanish arquebusiers, galley rowers, Ottoman janissaries/azaps/archers; Trafalgar: British/French/Spanish sailors and marines in period uniform. Never borrow Joseon/Japan/Ming crews.
7. Menu hero, share cards, ship cards, HUD faction names, terrain dressing of the region (villages, trees).
8. Balance (below), server acceptance, memory probes, tests, screenshots you actually looked at.

## Cross-chapter balance
- Stats stay historical; fairness is set by **price** (`COMPETITIVE_UNITS[kind].spec.cost` in `src/sim/competitive.ts`). 1592 prices are fixed (ranked).
- Benchmark = AI vs AI conquest, navy fleet vs navy fleet:
  `node scripts/balance-competitive.mjs --mode=conquest --seeds=16 --match=a:b[,..] [--set=unit.<kind>.cost=<n>]`
  Use at least 12-16 seeds: 6 seeds swing 30 points between neighbouring prices.
- Target: the two navies of one chapter 50% +-10; each new navy vs each 1592 navy within the band 1592's own pairs show (currently 83-100%, i.e. the benchmark is lopsided for 1592 itself; do not change 1592 prices or digests, report to the lead instead), aim for 25-75% vs every other navy.
- Record results in `docs/balance-cross.md`.

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
