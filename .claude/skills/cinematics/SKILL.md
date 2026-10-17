---
name: cinematics
description: Battle-opening cinematics and cutscenes — commander close-ups with dialogue, camera language, timing, subtitles. Use for any work in src/cinema or battle intros/outros.
---

# Battle cinematics (owner decision 2026-10-17)

Every battle opens with a film-like cinematic: the battle's commanders, using their live 3D figures from `public/models/generals/index.json`, are shown in close-ups and speak their lines. It must feel like 명량/한산/노량, not a slideshow.

## Shot grammar (default intro, 20–35 s, skippable)
1. **Establishing:** wide shot of the sea, weather and fleets (existing battle scene), with the title card in `--font-title`.
2. **Commander close-up:** the side's commander in close-up on his ship's deck (head and shoulders, shallow depth of field, rim light), using his idle or command clip. Dialogue appears as a subtitle (`--font-cine`) with his name and title.
3. **Reverse shot:** the enemy commander, the same way.
4. **Order:** the commander plays the command clip (sword thrust forward), the camera pushes in, and a cut to the fleet moving.
5. **Hand-off:** the camera eases into the gameplay camera with no jump.

## Rules
- Camera moves slowly with eased dollies and push-ins. No snapping. Use 24–35 mm equivalent for wides and 50–85 mm for close-ups. Use letterbox bars (2.39:1) during the cinematic.
- Lighting matches the battle's time of day and weather. Close-ups get a key light, a rim light and fog/sea haze behind.
- **Dialogue:** short, period-appropriate lines grounded in history:
  - Yi Sun-sin: "必死則生 必生則死", "勿令妄動 靜重如山".
  - Every quote must be real or clearly in-character. Never anachronisms.
  - Korean text plus `/en` translations.
  - Subtitles only: **no recorded or synthesized human voices** (owner rule). Use music and sound effects only.
- Uses only live, approved general figures. If a figure is missing, use his portrait as a painted insert, never a placeholder model.
- Never blocks input: skippable with click/tap/Esc, and remembers "skip intros" in settings.
- Deterministic sim untouched: cinematics are presentation only. The sim starts when the hand-off ends (or immediately when skipped).
- Phones: close-ups use the LOD for the device tier. Free everything the cinematic loaded when it ends (see `Engine.disposeBattle`, `probe-leak.mjs`).
- Verify with screenshots or a short frame sequence of each shot, and look at them. Check fonts against the `typography` skill.

## Historical accuracy (all chapters)
Who commanded which battle, where they stood, flags, ship types, dates, weather and quotes follow sources. When uncertain, choose the documented version and note the source in the battle's data or docs. No invented heroics presented as fact.

## How it is built (settled 2026-10-17)
- Scenes live in `src/cinema/scenes/` (`intros.ts` Hansan + Myeongnyang, `noryang.ts`). A scene lists its `cast` (figure file, weapon id, ship pick, the side he faces, portrait) and `castLight`. Records for every line go in `src/cinema/SOURCES.md`.
- `src/cinema/cast.ts` loads the cast with the generals screen's own code (`listModels`, `modelUrl`/`weaponUrl` per tier, `createFigure`, `holdWeapon`, `playFigure` exported from `GeneralModel.tsx`), only for live files in `index.json`. It is created when an intro starts (the establishing shot covers the load) and disposed with the scene (`Cinema.finish`); a skipped or finished scene leaves nothing behind (checked with a probe-leak variant: the figure textures go, `cinema_cast` leaves the scene).
- Film light: the figures' materials are swapped to `MeshStandardNodeMaterial` with their own `lightsNode` (key from camera-left above, rim from behind the other side, ambient fill; colours per `castLight`). No light is added to the scene, so no battle shader recompiles.
- Where he stands: `Crew.commandPost` — a step forward of the captain's mark on a **panokseon or atakebune** command platform; on every other ship (sekibune, Ming ships) at the head of the main deck (`x1 - 1.4`). The ship's own captain figure is hidden while he stands there (`Crew.standIns`). He faces the enemy but within ±0.55 rad of his bow.
- Camera presets (`scenes/shots.ts`, metres in his frame: forward to the enemy, up from his feet, right):
  - `closeUp` head and shoulders: from [3.3, 1.86, ±0.7] to [2.7, 1.88, ±0.58], look [0, 1.7, 0], fov 20, aperture 1.6. Side -1 for the side's own commander, +1 for the reverse shot (screen direction flips).
  - `command` waist up: from [3.7, 2.0, 0.9] to [2.7, 1.95, 0.6], look [0, 1.55, 0], fov 30, ease out, command clip at 0.4 s (sword raised overhead).
  - `overShoulder`: from [-1.7, 2.02, 0.8], look 40 m ahead and low, fov 28 — usable but weak (the enemy is small at 1 km); one per film at most.
  - `home(target, 4.5)`: eases position, aim and fov from the last shot into `RtsCamera.eyeOf(homePose)`, so the hand-off has no jump.
  - Close-ups have a fallback orbit around the ship until the figure is on deck; `film.depth` drops to 1.2 m when the focus is under 8 m so the close-ups get a shallow field.
- Timing that reads well: establishing 8.5–9.5 s with stamp + title card together, close-ups 7–8.5 s (one line of ≤ 6 s, or two of ~4 s), reverse 7 s, a name-only cut 4.5 s, command 4.5 s, fleet 7–7.5 s with labels, hand-off 4.5 s. Totals: Hansan 43.5 s, Myeongnyang 40 s, Noryang 51 s.
- Subtitle: caption kind `say` (centred, `--font-cine` 600, name in the side colour + title above, hanja + source/note under). Empty `text` gives a name-only card. If the figure is not on screen the portrait comes in as a painted insert above the line. A click/tap on the frame skips, as do Esc/Enter; the `전투 영상` chip in the director toggle turns intros off.
- Frame grabbing: load `?scenario=<id>&cutscene=1`, wait for `cinema.progress.t`, `cinema.togglePause()`, screenshot, unpause.

## Rejected (do not retry)
- Standing the commander at an atakebune's bow (enclosed: the frame is black).
- Standing the commander on a sekibune/Ming captain's mark: the camera lands inside the cabin or the castle (the deck plans' obstacles do not match the drawn models), or outside the hull when he turns abeam.
- Letting him turn up to 80° off the bow: the front camera ends up outside the shield wall.
- The old top-down "plan of the strait" shot at night (black, no ships) and the top-down crane wing in daylight (sun glare fills half the frame): use a high oblique (pitch ~0.3, 1.5 km) by day and a low shot behind the flagship at night.
- Weapons without `frustumCulled = false`: the posed sword is culled and the command clip reads as a man scratching his helmet.
- Subtitle centred with `transform: translateX(-50%)`: the rise animation overrides the transform and the line drifts right; centre with `left: 0; right: 0; margin: auto`.
