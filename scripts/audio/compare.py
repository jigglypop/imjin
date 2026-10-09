#!/usr/bin/env python3
"""Before/after table of the gameplay captures: python3 compare.py <dir> [scene ...]"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import analyze  # noqa: E402

root = Path(sys.argv[1])
scenes = sys.argv[2:] or ['menu', 'battle1x', 'battle8x', 'battle32x', 'skirmish', 'campaign']
print(f'{"scene":10s} {"":6s} {"rms":>6s} {"I LUFS":>7s} {"Mmax":>6s} {"TP":>6s} {"peak":>5s} {"clip":>5s} {"tone s/min":>10s} {"onsets/s":>8s}')
for s in scenes:
    for tag in ('before', 'after'):
        f = root / f'{tag}_{s}.wav'
        if not f.exists():
            continue
        r = analyze.analyze(str(f), root / 'png')
        print(f'{s:10s} {tag:6s} {r["rms_db"]:6.1f} {r["lufs_integrated"]:7} {r["lufs_max_momentary"]:6} {r["lufs_true_peak"]:6} {r["peak"]:5.2f} {r["clipped_samples"]:5d} {r["tone_seconds_per_min"]:10.1f} {r["onsets_per_s_1_6k"]:8.2f}')
