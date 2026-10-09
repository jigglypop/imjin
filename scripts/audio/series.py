#!/usr/bin/env python3
"""Momentary loudness (LUFS, 400 ms) of a file, one number per second: the loudest moment of each second.

    python3 series.py file.wav [file2.wav ...]

Shows how far a gun stands above the sea and the bed: a mix where the guns dominate has a floor near -30 LUFS and peaks
near -12."""
import re
import subprocess
import sys

for path in sys.argv[1:]:
    err = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
    rows = [(float(t), float(m)) for t, m in re.findall(r't:\s*([\d.]+)\s+TARGET:\S+ LUFS\s+M:\s*(-?[\d.]+)', err)]
    per = {}
    for t, m in rows:
        per[int(t)] = max(per.get(int(t), -120), m)
    vals = [per[k] for k in sorted(per)]
    print(path.split('/')[-1], ' '.join(f'{v:.0f}' for v in vals))
    loud = sorted(vals)
    print(f'   floor (10th percentile) {loud[len(loud) // 10]:.1f}, median {loud[len(loud) // 2]:.1f}, peak {loud[-1]:.1f}, guns over floor {loud[-1] - loud[len(loud) // 10]:.1f} dB')
