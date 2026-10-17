---
name: cinematics
description: Battle-opening cinematics and cutscenes — ships on camera, commanders speaking through comms thumbnails, camera language, timing, subtitles. Use for any work in src/cinema or battle intros/outros.
---

# Battle cinematics (owner decision 2026-10-17)

Every battle opens with a film-like cinematic that shows the battle and its ships; each commander speaks through a framed thumbnail of himself aboard his ship (RTS-style comms) while the camera holds on his flagship. No full-screen 3D close-ups, no card films. It must feel like 명량/한산/노량, not a slideshow.

## Shot grammar (default intro, 20–35 s, skippable)
1. **Establishing:** wide shot of the sea, weather and fleets (existing battle scene), with the title card in `--font-title`.
2. **Commander speaks (comms):** the camera on his flagship (`aboard(ship, dur, side)`, a slow push along her quarter) while his **comms box** carries the line: framed portrait thumbnail (a feed from his deck, blinking side-colour dot), name + title, the line typed in word by word over ~55 % of its time, hanja and record under it.
3. **Reply:** cut to the other flagship (`aboard(…, +1)`, mirrored angle) with his comms box on the other side. Allies (joseon/ming and every chapter's first side) left, the enemy (`japan` key) right, so exchanges read as dialogue. Cut on every line change (a second line from the same man = `aboard(…, alt=true)`).
4. **Order:** a camera beat, not a gesture (figures only stand since 2026-10-17): `order(ship, enemy)` — low off his flagship's quarter, pushing in as she leads — with the order as his subtitle, then the fleet moving.
5. **Hand-off:** the camera eases into the gameplay camera with no jump.

## Rules
- Camera moves slowly with eased dollies and push-ins. No snapping. Use 24–35 mm equivalent for wides and ~40–50 mm on a flagship. Use letterbox bars (2.39:1) during the cinematic.
- Lighting matches the battle's time of day and weather. - **Dialogue:** short, period-appropriate lines grounded in history:
  - Yi Sun-sin: "必死則生 必生則死", "勿令妄動 靜重如山".
  - Every quote must be real or clearly in-character. Never anachronisms.
  - Korean text plus `/en` translations.
  - Subtitles only: **no recorded or synthesized human voices** (owner rule). Use music and sound effects only.
- Thumbnail = his portrait (`public/ui/portraits`). Where a live figure looks better, a pre-rendered still of it on deck may replace it (render once, webp under `public/ui/comms/`, `npm run assets -- push`); never a placeholder model and never a live 3D render in the opening.
- Never blocks input: skippable with click/tap/Esc, and remembers "skip intros" in settings.
- Deterministic sim untouched: cinematics are presentation only. The sim starts when the hand-off ends (or immediately when skipped).
- Phones: the comms box shrinks (`.app--compact`), the ships keep their tier LOD. Free everything the cinematic loaded when it ends (see `Engine.disposeBattle`, `probe-leak.mjs`).
- Verify with screenshots or a short frame sequence of each shot, and look at them. Check fonts against the `typography` skill.

## Historical accuracy (all chapters)
Who commanded which battle, where they stood, flags, ship types, dates, weather and quotes follow sources. When uncertain, choose the documented version and note the source in the battle's data or docs. No invented heroics presented as fact.

## How it is built (settled 2026-10-17)
- Scenes live in `src/cinema/scenes/` (`intros.ts` Hansan + Myeongnyang, `noryang.ts`). A scene lists its `cast` (figure file, weapon id, ship pick, the side he faces, portrait) and `castLight`. Records for every line go in `src/cinema/SOURCES.md`.
- `src/cinema/cast.ts` loads the cast with the generals screen's own code (`listModels`, `modelUrl`/`weaponUrl` per tier, `createFigure`, `holdWeapon`, `playFigure` exported from `GeneralModel.tsx`), only for live files in `index.json`. It is created when an intro starts (the establishing shot covers the load) and disposed with the scene (`Cinema.finish`); a skipped or finished scene leaves nothing behind (checked with a probe-leak variant: the figure textures go, `cinema_cast` leaves the scene).
- Film light: the figures' materials are swapped to `MeshStandardNodeMaterial` with their own `lightsNode` (key from camera-left above, rim from behind the other side, ambient fill; colours per `castLight`). No light is added to the scene, so no battle shader recompiles.
- Where he stands: `Crew.commandPost` — a step forward of the captain's mark on a **panokseon or atakebune** command platform; on every other ship (sekibune, Ming ships) at the head of the main deck (`x1 - 1.4`). The ship's own captain figure is hidden while he stands there (`Crew.standIns`). He faces the enemy but within ±0.55 rad of his bow.
- Camera presets (`scenes/shots.ts`, metres in his frame: forward to the enemy, up from his feet, right):
  - `aboard(ship, dur, side, alt?)` while a commander speaks: orbit at his flagship, yaw ±1.05→±0.8 (alt ±0.35→±0.2), dist 90→66 (alt 58→46), fov 30→27.
  - `order(ship, toward)`: orbit at the flagship framed toward the enemy, yaw π−0.62→π−0.4, pitch 0.07→0.045, dist 130→82 m, lift 9→6, fov 32→27. Replaces the old `command` shot.
  - `home(target, 4.5)`: eases position, aim and fov from the last shot into `RtsCamera.eyeOf(homePose)`, so the hand-off has no jump.
- Timing that reads well: establishing 8.5–9.5 s with stamp + title card together, speaker on his flagship 6–6.6 s per line (a second line = a new set-up of ~4.2 s), reply 7–8.3 s, a name-only cut 4.5 s, command 4.5 s, fleet 7–7.5 s with labels, hand-off 4.5 s. Totals: Hansan 43.5 s, Myeongnyang 40 s, Noryang 51 s.
- Subtitle: caption kind `say` renders the comms box (below). Empty `text` gives a name-only box. A click/tap on the frame skips, as do Esc/Enter; the `전투 영상` chip in the director toggle turns intros off.
- Frame grabbing: load `?scenario=<id>&cutscene=1`, wait for `cinema.progress.t`, `cinema.togglePause()`, screenshot, unpause.

## Comms dialogue (owner 2026-10-17: "the commander speaks through a thumbnail of himself aboard his ship")
- Built in `CinemaOverlay.tsx` `SayView` (`.cine-comms` in `cinema.css`); the image is the scene cast's `portrait` (`Cinema.insertFor`). Typing reveals whole words only (a split word wraps differently under keep-all and jumps).
- Openings no longer frame 3D figures: `Cinema.start` loads the cast only for scenes that still have a `figure` shot (none of the openings). The cast entries stay for the portraits. A still render of a live figure on his deck may later replace the portrait as the thumbnail.
- Applies to every 1592, Armada, Lepanto and Trafalgar opening (`intros.ts`, `noryang.ts`, `chapters.ts`).
- Name plate: a battle opening shows his name plate (`.cine-plate`, --font-title) over his first line the first time it features him (data in `commanderIntros.ts`, records in SOURCES.md).

## Campaign openings (owner 2026-10-17: concise documentary openings like strategy games)
- Data: `src/cinema/campaignOpenings.ts` (imjin 61.5 s, armada 62 s, lepanto 54.5 s). Shots over the campaign's own 3D map: `from`/`to` eyes in lon/lat + distance (frame units) + yaw (0 looks north) + pitch (0.22–0.36 reads cinematic); 7–8 s each, one stamp (date in --font-title small brass, place in --font-title large) top-left, one line (--font-cine) bottom-centre with its source, closing title 8.5 s pulling back to the whole theatre (`MOONWAKE · years`, title --font-title, hanja, sub, source).
- Player: `src/ui/grand/CampaignOpening.tsx` drives `GrandMap`'s `film` ref (the map's frame callback uses it instead of its motion; panels and markers hidden by `body.g-filming`). Waits in black for `window.__map` (6 s max; phones' flat map plays captions over the dimmed image). Plays once per theatre (`imjin.campaignOpening`) on turn 1, `?opening=1` forces it; Esc/Enter/click/skip button. Sound: campaign cues only (`event`, `endTurn` per place, `battle` under the title) — no voices.
- Frame grabbing: start a campaign at `/<chapter>/campaign?opening=1`, click `.g-pick__go`, wait for `window.__map`, screenshot at shot mid-points.

## Rejected (do not retry)
- Static full-screen portrait cards and card intro films anywhere (openings, /generals, campaign roster).
- The waist-up `command` shot with the command clip: the figures only stand (owner 2026-10-17); every opening uses `order()` instead.
- A battle opening growing a full per-commander film inside it: the opening's length and audio cues are fixed; the name plate is the in-battle intro.
- Commander card films (owner 2026-10-17): no intro film on /generals (no auto-play, no 소개 영상 button) nor in the campaign 장수 roster. `CommanderFilm.tsx`/`PortraitFilm`/`FigureStage.setFilm` are deleted.
- Full-screen 3D talking close-ups of a commander, and static 3D close-up "cards" of a commander while his line plays (reads as a card, not a film), and the follow-up plan of 3D close-ups with Meshy talking clips (56 Stand and Chat, 310, 311 were tried 2026-10-17, 39 credits; stripped again): owner chose the comms thumbnail over the ship instead. Do not fetch talk clips.
- Opening stamps in --font-cine over bright land: unreadable; stamps are --font-title with a dark top gradient.
- Standing the commander at an atakebune's bow (enclosed: the frame is black).
- Standing the commander on a sekibune/Ming captain's mark: the camera lands inside the cabin or the castle (the deck plans' obstacles do not match the drawn models), or outside the hull when he turns abeam.
- Letting him turn up to 80° off the bow: the front camera ends up outside the shield wall.
- The old top-down "plan of the strait" shot at night (black, no ships) and the top-down crane wing in daylight (sun glare fills half the frame): use a high oblique (pitch ~0.3, 1.5 km) by day and a low shot behind the flagship at night.
- Weapons without `frustumCulled = false`: the posed sword is culled and the command clip reads as a man scratching his helmet.
- Subtitle centred with `transform: translateX(-50%)`: the rise animation overrides the transform and the line drifts right; centre with `left: 0; right: 0; margin: auto`.
