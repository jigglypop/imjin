#!/usr/bin/env python3
"""Forensics for game audio: loudness, clipping and the narrow-band tones that read as beeps.

    python3 analyze.py a.wav b.wav ...  [--json out.json] [--png dir]

A beep is a sustained or repeated narrow spectral peak. For each file this finds spectral lines (a bin that stands
out from the median of its neighbourhood by LINE_DB) between 500 Hz and 5 kHz, links them across frames into tracks,
and reports the tracks that last at least MIN_MS, with their frequency, duration and how many start per minute.
Noise-like sounds (guns, sea, splashes) produce almost none; flutes, sine blips and Q>4 band-passed noise do.
Needs numpy and ffmpeg on the PATH (the spectrogram PNGs are drawn by ffmpeg).
"""
import json
import re
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

import os

WIN = int(os.environ.get('WIN', 4096))
HOP = WIN // 4
LINE_DB = float(os.environ.get('LINE_DB', 20))
MIN_MS = float(os.environ.get('MIN_MS', 70))
BAND = (float(os.environ.get('BAND_LO', 500)), 6000)


def read(path):
    with wave.open(str(path)) as w:
        n, ch, rate = w.getnframes(), w.getnchannels(), w.getframerate()
        raw = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768
    return raw.reshape(-1, ch).mean(axis=1), rate, raw.reshape(-1, ch)


def lines(mono, rate):
    """Tracks of spectral lines: list of (start_s, dur_s, mean_hz, peak_db_above_median)."""
    win = np.hanning(WIN).astype(np.float32)
    if len(mono) < WIN:
        return [], 0
    nfr = 1 + (len(mono) - WIN) // HOP
    freqs = np.fft.rfftfreq(WIN, 1 / rate)
    lo, hi = np.searchsorted(freqs, BAND)
    frames = np.lib.stride_tricks.sliding_window_view(mono, WIN)[::HOP][:nfr]
    spec = 20 * np.log10(np.abs(np.fft.rfft(frames * win, axis=1)) + 1e-9)
    k = max(12, 40 * WIN // 4096 * 2)  # a neighbourhood of about +-900 Hz
    active = []  # tracks that were extended in the previous frame
    done = []
    for f in range(nfr):
        row = spec[f]
        if row[lo:hi].max() < -75:  # silence
            peaks = []
        else:
            seg = row[lo - k : hi + k]
            # rolling median is slow; the mean of the 25th..75th percentile of a window is close and cheap enough
            idx = np.arange(lo, hi)
            win_idx = idx[:, None] + np.arange(-k, k + 1)[None, :]
            med = np.median(row[win_idx], axis=1)
            over = row[lo:hi] - med
            cand = np.where((over > LINE_DB) & (row[lo:hi] >= np.maximum(np.roll(row[lo:hi], 1), np.roll(row[lo:hi], -1))))[0]
            peaks = [(int(lo + c), float(over[c])) for c in cand]
        nxt = []
        for track in active:
            m = next((p for p in peaks if abs(p[0] - track['bin']) <= 2), None)
            if m:
                track['bin'] = m[0]
                track['bins'].append(m[0])
                track['db'] = max(track['db'], m[1])
                track['last'] = f
                peaks.remove(m)
                nxt.append(track)
            elif f - track['last'] <= 1:  # one frame of grace
                nxt.append(track)
            else:
                done.append(track)
        for p in peaks:
            nxt.append({'start': f, 'last': f, 'bin': p[0], 'bins': [p[0]], 'db': p[1]})
        active = nxt
    done += active
    out = []
    for t in done:
        dur = (t['last'] - t['start'] + 1) * HOP / rate + (WIN - HOP) / rate
        if dur * 1000 >= MIN_MS:
            out.append((t['start'] * HOP / rate, dur, float(np.mean(freqs[t['bins']])), t['db']))
    return out, nfr * HOP / rate


def onsets_per_second(mono, rate):
    """Sound starts per second in 1-6 kHz: frames whose energy jumps 6 dB over the previous 150 ms and clears -55 dB.

    A repeating tick or blip train shows as a high, steady rate; so does a battle at 32x with every event voiced."""
    hop = int(rate * 0.01)
    n = len(mono) // hop
    if n < 30:
        return 0.0
    frames = mono[: n * hop].reshape(n, hop)
    spec = np.abs(np.fft.rfft(frames * np.hanning(hop), axis=1)) ** 2
    freqs = np.fft.rfftfreq(hop, 1 / rate)
    band = (freqs >= 1000) & (freqs <= 6000)
    db = 10 * np.log10(spec[:, band].sum(axis=1) + 1e-12) - 10 * np.log10(hop)
    count = 0
    armed = True
    for i in range(15, n):
        base = db[i - 15 : i].max()
        if armed and db[i] > base + 6 and db[i] > -55:
            count += 1
            armed = False
        elif db[i] < base:
            armed = True
    return count / (n * 0.01)


def momentary_lufs(path):
    """Max momentary (400 ms) and integrated loudness through ffmpeg's ebur128."""
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(path), '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True)
    err = r.stderr
    summary = err[err.rfind('Summary:') :]
    get = lambda key: next((float(l.split(key)[1].split()[0]) for l in summary.splitlines() if key in l), None)
    mom = [float(m) for m in re.findall(r'\sM:\s*(-?[\d.]+)', err) if float(m) > -100]
    return {'integrated': get('I:'), 'range': get('LRA:'), 'true_peak': get('Peak:'), 'max_momentary': max(mom) if mom else None}


def analyze(path, png_dir=None):
    mono, rate, stereo = read(path)
    secs = len(mono) / rate
    tracks, covered = lines(mono, rate)
    peak = float(np.abs(stereo).max())
    clip = int((np.abs(stereo) >= 0.999).sum())
    rms = float(np.sqrt((mono**2).mean()))
    # flatness of the whole file in the beep band: close to 1 for noise, close to 0 for tones
    seg = mono[: len(mono) // WIN * WIN].reshape(-1, WIN)
    p = np.abs(np.fft.rfft(seg * np.hanning(WIN), axis=1)) ** 2 + 1e-12
    freqs = np.fft.rfftfreq(WIN, 1 / rate)
    band = (freqs >= BAND[0]) & (freqs <= BAND[1])
    flat = float(np.mean(np.exp(np.log(p[:, band]).mean(axis=1)) / p[:, band].mean(axis=1))) if len(seg) else 0
    byfreq = {}
    for _, dur, hz, db in tracks:
        byfreq.setdefault(int(round(hz / 100)) * 100, []).append(dur)
    res = {
        'file': Path(path).name,
        'seconds': round(secs, 1),
        'peak': round(peak, 3),
        'clipped_samples': clip,
        'rms_db': round(20 * np.log10(rms + 1e-9), 1),
        'flatness_500_5k': round(flat, 3),
        'tone_tracks': len(tracks),
        'tone_tracks_per_min': round(len(tracks) / max(secs, 1) * 60, 1),
        'tone_seconds_per_min': round(sum(t[1] for t in tracks) / max(secs, 1) * 60, 1),
        'onsets_per_s_1_6k': round(onsets_per_second(mono, rate), 2),
        'tone_hz_histogram': {str(k): [len(v), round(sum(v), 2)] for k, v in sorted(byfreq.items())},
        'tracks': [{'at': round(a, 2), 'dur': round(b, 2), 'hz': round(c), 'db': round(d)} for a, b, c, d in tracks[:400]],
    }
    res.update({'lufs_' + k: v for k, v in momentary_lufs(path).items()})
    if png_dir:
        Path(png_dir).mkdir(parents=True, exist_ok=True)
        out = Path(png_dir) / (Path(path).stem + '.png')
        w = 1600 if secs > 20 else 1000
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(path), '-lavfi', f'showspectrumpic=s={w}x512:legend=1:scale=log:fscale=log:drange=90:limit=0', str(out)])
        res['spectrogram'] = out.name
    return res


if __name__ == '__main__':
    argv = sys.argv[1:]
    out_json = png = None
    files = []
    i = 0
    while i < len(argv):
        if argv[i] == '--json':
            out_json = argv[i + 1]
            i += 2
        elif argv[i] == '--png':
            png = argv[i + 1]
            i += 2
        else:
            files.append(argv[i])
            i += 1
    results = []
    for f in files:
        r = analyze(f, png)
        results.append(r)
        short = {k: v for k, v in r.items() if k not in ('tracks', 'tone_hz_histogram')}
        print(json.dumps(short, ensure_ascii=False))
        top = sorted(r['tone_hz_histogram'].items(), key=lambda kv: -kv[1][1])[:6]
        print('   tones (Hz: count, seconds):', ', '.join(f'{k}: {v[0]}, {v[1]}s' for k, v in top))
    if out_json:
        Path(out_json).write_text(json.dumps(results, ensure_ascii=False, indent=1))
