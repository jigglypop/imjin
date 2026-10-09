#!/usr/bin/env python3
"""20 s 'artillery battle' demo mix: the shipped samples placed with the same distance model the game uses (gain, speed-of-sound delay, low-pass, pan, shared reverb) plus +-8 % playback-rate jitter."""
import numpy as np, dsp, os, sys
from dsp import SR

LEAD = 1.6          # event times below are arrival times; the first LEAD seconds are cut after mixing
LEN = 20.0 + LEAD
rng = np.random.default_rng(1592)
cache = {}
def sample(n):
    if n not in cache: cache[n] = dsp.load(f'out/{n}.mp3')
    return cache[n]

def spatial(dist):
    gain = 1.0/(1.0 + (dist/380.0)**1.25)
    delay = min(1.6, dist/343.0)
    muffle = max(420.0, 9000.0/(1.0 + dist/420.0))
    return gain, delay, muffle

L = np.zeros(int(LEN*SR)); R = np.zeros(int(LEN*SR))
def place(t, name, dist, pan, trim_db=0.0, rate=None, gain_mult=1.0):
    global L, R
    x = sample(name)
    r = rate if rate is not None else float(rng.uniform(0.92, 1.08))
    x = dsp.rate(x, r)
    g, d, m = spatial(dist)
    if m < 8500:
        x = dsp.lp_n(x, m, 2 if dist > 300 else 1)
    x = x*g*gain_mult*dsp.fromdb(trim_db + float(rng.uniform(-1.2, 1.2)))
    th = (pan + 1.0)*np.pi/4.0
    gl, gr = np.cos(th), np.sin(th)
    a = int(round((t + LEAD)*SR))
    n = min(len(x), len(L) - a)
    if n > 0:
        L[a:a+n] += x[:n]*gl
        R[a:a+n] += x[:n]*gr

# (time, sample, distance m, pan, trim dB)  -- gun ranges follow the game's gun sizes
T = [
 (0.00, 'cannon_far_2', 1400, -0.6, 4), (0.35, 'drum_2', 500, 0.0, -3),
 (1.20, 'musket_volley_1', 900, 0.7, 6), (2.30, 'cannon_far_1', 1200, 0.5, 4),
 (3.30, 'cannon_medium_3', 480, -0.7, 0), (3.80, 'whoosh_1', 70, 0.3, 0),
 (4.45, 'splash_1', 140, 0.5, 0), (5.20, 'cannon_heavy_2', 110, 0.2, 0),
 (5.62, 'cannon_medium_1', 190, -0.3, 0), (6.05, 'whoosh_2', 90, -0.4, 0),
 (6.75, 'impact_wood_3', 150, 0.6, 0), (7.50, 'broadside_1', 260, -0.8, 0),
 (8.40, 'whoosh_1', 60, 0.2, 0), (8.62, 'whoosh_2', 85, -0.5, 0),
 (9.15, 'splash_2', 100, 0.6, 0), (9.40, 'splash_1', 210, -0.3, 0),
 (9.90, 'broadside_2', 95, 0.1, 0), (10.60, 'cannon_heavy_1', 140, -0.2, 0),
 (11.00, 'impact_wood_1', 120, 0.4, 0), (11.55, 'musket_volley_2', 230, 0.6, 3),
 (12.15, 'cannon_medium_2', 310, -0.5, 0), (12.40, 'cannon_small_1', 170, 0.3, 0),
 (12.65, 'cannon_small_2', 215, -0.1, 0), (12.95, 'whoosh_1', 50, 0.0, 0),
 (13.40, 'impact_wood_2', 90, -0.2, 0), (13.62, 'impact_wood_3', 130, 0.3, 0),
 (14.20, 'cannon_heavy_3', 170, 0.5, 0), (14.55, 'drum_1', 300, 0.0, -2),
 (14.90, 'cannon_far_1', 900, -0.7, 4), (15.10, 'musket_volley_1', 320, -0.6, 3),
 (15.60, 'explosion_1', 360, 0.7, 0), (16.30, 'impact_wood_1', 160, 0.1, 0),
 (16.80, 'creak_1', 60, -0.2, 0), (17.50, 'cannon_far_2', 1000, 0.4, 4),
 (17.90, 'splash_2', 180, 0.3, 0), (18.20, 'sink_1', 210, 0.5, 0),
]
# a little extra grouped fire during the climax
for k in range(5):
    T.append((9.0 + 0.18*k + float(rng.uniform(0, 0.06)), ['cannon_medium_2','cannon_small_1','cannon_medium_3','cannon_small_2','cannon_medium_1'][k], float(rng.uniform(200, 420)), float(rng.uniform(-0.8, 0.8)), -2))
for (t, n, d, p, tr) in T:
    place(t, n, d, p, tr)

# shared reverb bus (as in the game's convolver send)
irL = dsp.make_ir(2.6, 1.6, 0.5, lp_hz=5000, length=3.0, seed=201)
irR = dsp.make_ir(2.6, 1.6, 0.5, lp_hz=5000, length=3.0, seed=202)
wl = dsp.conv(L, irL)[:len(L)]; wr = dsp.conv(R, irR)[:len(R)]
ref = dsp.rms(np.concatenate([L, R])) + 1e-9
wet = dsp.fromdb(-13)*ref/(dsp.rms(np.concatenate([wl, wr])) + 1e-9)
L = L + wl*wet; R = R + wr*wet

# faint sea bed so the gaps between guns are not dead air
n = len(L); t = np.arange(n)/SR
sea = dsp.lp_n(rng.standard_normal(n), 420, 2)*(0.6 + 0.4*np.sin(2*np.pi*0.11*t))
sea *= dsp.rms(L)*dsp.fromdb(-30)/(dsp.rms(sea) + 1e-9)
L = L + sea; R = R + sea*0.9

# master: loudness ~ -16 LUFS integrated, limiter at -1 dBFS, fade the last 1.5 s
st = np.stack([L, R], axis=1)
mono = st.mean(axis=1)
def lim(st, g):
    y = st*dsp.fromdb(g)
    peak = np.abs(y).max(axis=1)
    out = dsp.limiter(np.where(np.abs(y[:, 0]) >= np.abs(y[:, 1]), y[:, 0], y[:, 1]), -1.0, 2.0, 120.0)
    k = np.where(np.abs(np.where(np.abs(y[:, 0]) >= np.abs(y[:, 1]), y[:, 0], y[:, 1])) > 1e-9, out/np.where(np.abs(np.where(np.abs(y[:, 0]) >= np.abs(y[:, 1]), y[:, 0], y[:, 1])) > 1e-9, np.where(np.abs(y[:, 0]) >= np.abs(y[:, 1]), y[:, 0], y[:, 1]), 1.0), 1.0)
    return y*k[:, None]
lo, hi = -24.0, 24.0
for _ in range(14):
    mid = (lo + hi)/2
    y = lim(st, mid)
    I = dsp.loud(y.mean(axis=1))['I']
    if I is None or I < -16.0: lo = mid
    else: hi = mid
y = lim(st, (lo + hi)/2)
y = y[int(LEAD*SR):]
fade = int(1.5*SR)
y[-fade:] *= np.linspace(1, 0, fade)[:, None]**2
os.makedirs('demo', exist_ok=True)
dsp.write_wav('demo/demo_artillery_battle.wav', y)
dsp.encode_mp3(y, 'demo/demo_artillery_battle.mp3', 160)
print('seconds', round(len(y)/SR, 2), 'peak dBFS', round(dsp.db(np.abs(y).max()), 2), 'I', dsp.loud(y.mean(axis=1)), 'events', len(T))
