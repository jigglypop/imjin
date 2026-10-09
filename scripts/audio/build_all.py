#!/usr/bin/env python3
"""Build every game sample: recipes -> master (class loudness target, -1.5 dBFS ceiling) -> WAV + 96 kbps mono MP3 -> decode check."""
import numpy as np, dsp, recipes, evalx, os, sys, json, subprocess
from dsp import SR
OUT = 'out'
os.makedirs(OUT, exist_ok=True); os.makedirs('proto/raw', exist_ok=True)

TARGET = {   # max momentary loudness (LUFS) per class
 'cannon_heavy': -13.5, 'cannon_medium': -15.0, 'cannon_small': -17.0, 'cannon_far': -19.0,
 'broadside': -12.0, 'explosion': -11.5, 'impact_wood': -15.0, 'splash': -18.0,
 'whoosh': -17.0, 'drum': -16.0, 'musket_volley': -20.0, 'creak': -24.0, 'sink': -20.0,
}

def cls(name): return name.rsplit('_', 1)[0]

def build_raw(only=None):
    R = {}
    C = recipes.build_cannons(); R.update(C)
    R.update(recipes.build_far(C))
    R.update(recipes.build_broadside(C))
    R.update(recipes.build_explosions(C))
    R.update(recipes.build_impacts())
    R.update(recipes.build_splash())
    R.update(recipes.build_whoosh())
    R.update(recipes.build_musket())
    R.update(recipes.build_creak())
    R.update(recipes.build_sink())
    R.update(recipes.build_drums())
    for k, v in R.items(): np.save(f'proto/raw/{k}.npy', v)
    return R

def finish(name, x, ceiling=-1.5):
    t = TARGET[cls(name)]
    y, info = dsp.master(x, t, ceiling_db=ceiling)
    # trim digital silence at the end and re-apply a short safety fade
    y = dsp.trim_tail(y, -70, min_len=0.3)
    y = dsp.fade_out(y, 60, 1.5)
    y = dsp.fade_in(y, 1.0)
    return y, info

if __name__ == "__main__":
    use_cache = '--cache' in sys.argv
    if use_cache:
        R = {os.path.basename(p)[:-4]: np.load(p) for p in sorted(os.popen('ls proto/raw/*.npy').read().split())}
    else:
        R = build_raw()
    names = [a for a in sys.argv[1:] if not a.startswith('--')] or sorted(R)
    rows = []
    for n in names:
        y, info = finish(n, R[n])
        wav = f'{OUT}/{n}.wav'; mp3 = f'{OUT}/{n}.mp3'
        dsp.write_wav(wav, y)
        dsp.encode_mp3(y, mp3, 96)
        d = dsp.load(mp3)           # what a browser will decode (ffmpeg's mp3 decoder)
        ev = evalx.evaluate(y, n)
        evd = evalx.evaluate(d, n)
        rows.append((n, info, ev, evd, os.path.getsize(mp3)))
        print(f"{n:16s} {len(y)/SR:5.2f}s mp3={os.path.getsize(mp3)/1024:6.1f}KB  M={ev['Mmax']} (target {TARGET[cls(n)]}) cut={info['limiter_peak_cut_db']:.1f}dB  pk={ev['pk']} TP={ev['tp']} | decoded: pk={evd['pk']} TP={evd['tp']} M={evd['Mmax']} clip={evd['clip']}", flush=True)
    tot = sum(r[4] for r in rows)
    print('total mp3 KB', round(tot/1024, 1))
