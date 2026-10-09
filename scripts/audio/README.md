# Battle sample build

Builds the 27 game samples in `public/audio/*.mp3` from CC0 Freesound recordings (ids and credits in `public/audio/CREDITS.md`).
Needs Python 3 with numpy, plus `ffmpeg` and `ffprobe` on the PATH.

- `dsp.py` loading, filters, pitch/time stretch, reverb, loudness (EBU R128) and limiter, MP3 encode
- `cannons.py`, `recipes.py` how each class (cannons, far booms, broadsides, explosions, impacts, splashes, whooshes, musket volleys, creak, sinking, drums) is cut and layered from the sources
- `build_all.py` runs every recipe, masters each class to its loudness target and writes `out/<name>.wav|mp3`; `--cache` reuses `proto/raw`
- `evalx.py` loudness and peak report used by `build_all.py`; `qa.py` checks lead-in, peak, true peak and DC of finished files; `demo.py` strings samples from `out/` into a listening demo

The source recordings are not in the repo. Download each Freesound preview listed in CREDITS.md to `scripts/audio/raw/<id>.mp3`, then run from this directory `python3 build_all.py` and copy `out/*.mp3` to `public/audio/`.
Loudness per class (max momentary LUFS): heavy -13.5, broadside -12, explosion -11.5, medium -15, wood -15, small -17, splash -18, far -19, whoosh -17, drum -16, musket -20, sink -20, creak -24.
