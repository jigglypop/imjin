# Battle sample build

Builds the 27 game samples in `public/audio/*.mp3` from CC0 Freesound recordings (ids and credits in `public/audio/CREDITS.md`).
Needs Python 3 with numpy, plus `ffmpeg` and `ffprobe` on the PATH.

- `dsp.py` loading, filters, pitch/time stretch, reverb, loudness (EBU R128) and limiter, MP3 encode
- `cannons.py`, `recipes.py` how each class (cannons, far booms, broadsides, explosions, impacts, splashes, whooshes, musket volleys, creak, sinking, drums) is cut and layered from the sources
- `build_all.py` runs every recipe, masters each class to its loudness target and writes `out/<name>.wav|mp3`; `--cache` reuses `proto/raw`
- `evalx.py` loudness and peak report used by `build_all.py`; `qa.py` checks lead-in, peak, true peak and DC of finished files; `demo.py` strings samples from `out/` into a listening demo

The source recordings are not in the repo. Download each Freesound preview listed in CREDITS.md to `scripts/audio/raw/<id>.mp3`, then run from this directory `python3 build_all.py` and copy `out/*.mp3` to `public/audio/`.
Loudness per class (max momentary LUFS): heavy -13.5, broadside -12, explosion -11.5, medium -15, wood -15, small -17, splash -18, far -19, whoosh -17, drum -16, musket -20, sink -20, creak -24.

## Forensics and mix checks

The synthesised voices, the bed, the sea and the click are measured, not guessed:

- `node ../render-sounds.mjs --only=inventory --prefix=after_ --out=<dir>` renders every voice alone through an OfflineAudioContext; `--only=battle` renders a scripted battle with the sample bank, the sea and the bed mixed as `Sound.ts` wires them.
- `node capture.mjs --url=<dev server> --tag=after --out=<dir>` records the master bus of the running game (menu, battle at 1x, 8x, 32x, a skirmish, the campaign map), 60 s each.
- `python3 analyze.py <wav>... [--png <dir>] [--json <file>]` prints peak, clipping, loudness (EBU R128, max momentary) and the beep measure: the seconds per minute taken by spectral lines (a bin 20 dB over its neighbourhood, 500 Hz-6 kHz, at least 70 ms). Guns, sea and splashes score near 0; flutes, sine blips and Q>4 band-passed noise score in the hundreds. `BAND_LO=900 WIN=1024 MIN_MS=25` looks for very short chirps. `lufs.py` gives the loudness of a stretch.
- `python3 build_page.py <dir>` builds the listening page.

Levels, as measured at the output (integrated LUFS): the sea sits at -30 in the menu and -26 in a battle, the bed at -29 (drum strokes peak at -22 momentary) and -36; guns peak between -13 (a fight seen from the RTS camera) and -7 (broadsides at 32x), 12 to 19 dB over the floor of sea and bed, and the true peak stays under -1 dBFS.
