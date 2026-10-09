#!/usr/bin/env python3
"""Loudness of a stretch of a file: python3 lufs.py file.wav [start end] ... prints integrated LUFS and the maximum momentary."""
import re
import subprocess
import sys


def lufs(path, start=None, end=None):
    cmd = ['ffmpeg', '-hide_banner', '-nostats']
    if start is not None:
        cmd += ['-ss', str(start)]
    if end is not None:
        cmd += ['-to', str(end)]
    cmd += ['-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-']
    err = subprocess.run(cmd, capture_output=True, text=True).stderr
    summary = err[err.rfind('Summary:'):]
    integrated = re.search(r'I:\s*(-?[\d.]+) LUFS', summary)
    moments = [float(m) for m in re.findall(r'\sM:\s*(-?[\d.]+)', err) if float(m) > -100]
    return (float(integrated.group(1)) if integrated else None, max(moments) if moments else None)


if __name__ == '__main__':
    path = sys.argv[1]
    spans = [(float(a), float(b)) for a, b in zip(sys.argv[2::2], sys.argv[3::2])] or [(None, None)]
    for a, b in spans:
        i, m = lufs(path, a, b)
        print(f'{path.split("/")[-1]} {a}-{b}: integrated {i} LUFS, max momentary {m}')
