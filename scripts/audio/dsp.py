#!/usr/bin/env python3
"""Small DSP toolkit: numpy for the maths, ffmpeg for decoding, causal filters, loudness and encoding."""
import subprocess, re, os, numpy as np, wave, hashlib
SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
_cache = {}

def load(src, sr=SR):
    """Decode a raw/<id>.mp3 (or path) to mono float64 at sr."""
    path = src if os.path.exists(str(src)) else f"{HERE}/raw/{src}.mp3"
    key = (path, sr)
    if key not in _cache:
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"], capture_output=True).stdout
        _cache[key] = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    return _cache[key].copy()

def seg(x, t0, t1=None, sr=SR):
    a = max(0, int(round(t0*sr))); b = len(x) if t1 is None else min(len(x), int(round(t1*sr)))
    return x[a:b].copy()

def ff(x, af, sr=SR):
    """Run a mono float signal through an ffmpeg audio filter chain."""
    inp = x.astype(np.float32).tobytes()
    cmd = ["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "-", "-af", af, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"]
    out = subprocess.run(cmd, input=inp, capture_output=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.decode()[:500])
    return np.frombuffer(out.stdout, dtype=np.float32).astype(np.float64)

def rate(x, r):
    """Playback-rate change (pitch and duration together)."""
    if abs(r-1) < 1e-4: return x
    return ff(x, f"asetrate={SR*r:.3f},aresample={SR}:resampler=soxr:precision=28") if _soxr() else ff(x, f"asetrate={SR*r:.3f},aresample={SR}")
_soxr_ok = None
def _soxr():
    global _soxr_ok
    if _soxr_ok is None:
        _soxr_ok = b"soxr" in subprocess.run(["ffmpeg", "-hide_banner", "-buildconf"], capture_output=True).stdout
    return _soxr_ok

def lp(x, f, poles=2): return ff(x, f"lowpass=f={f}:p={poles}")
def hp(x, f, poles=2): return ff(x, f"highpass=f={f}:p={poles}")
def lp_n(x, f, n=2):
    for _ in range(n): x = lp(x, f, 2)
    return x
def hp_n(x, f, n=2):
    for _ in range(n): x = hp(x, f, 2)
    return x
def eq(x, f, g, q=1.0): return ff(x, f"equalizer=f={f}:t=q:w={q}:g={g}")
def lowshelf(x, f, g): return ff(x, f"bass=g={g}:f={f}:t=s:w=0.7")
def highshelf(x, f, g): return ff(x, f"treble=g={g}:f={f}:t=s:w=0.7")

def peak(x): return float(np.abs(x).max()) if len(x) else 0.0
def rms(x): return float(np.sqrt((x**2).mean())) if len(x) else 0.0
def db(v): return 20*np.log10(max(v, 1e-12))
def fromdb(d): return 10**(d/20)

def env(x, ms=5, sr=SR):
    n = max(1, int(sr*ms/1000))
    return np.sqrt(np.convolve(x*x, np.ones(n)/n, mode="same"))

def onset_index(x, rel_db=-24, search=None, sr=SR):
    """First sample where the 1 ms envelope rises above rel_db below the file (or search-window) peak."""
    e = env(x, 1.0, sr)
    w = e if search is None else e[:int(search*sr)]
    thr = w.max()*fromdb(rel_db)
    idx = np.where(w > thr)[0]
    return int(idx[0]) if len(idx) else 0

def align(x, pre_ms=2.0, rel_db=-24, search=None, sr=SR):
    """Trim so that the blast starts pre_ms after the first sample, with a 0.5 ms fade-in."""
    i = onset_index(x, rel_db, search, sr)
    a = max(0, i - int(pre_ms*sr/1000))
    y = x[a:].copy()
    n = int(0.0005*sr)
    y[:n] *= np.linspace(0, 1, n)
    return y

def fade_out(x, ms, curve=2.0, sr=SR):
    n = min(len(x), int(ms*sr/1000))
    if n <= 0: return x
    y = x.copy()
    y[-n:] *= (np.linspace(1, 0, n)**curve)
    return y

def fade_in(x, ms, sr=SR):
    n = min(len(x), int(ms*sr/1000))
    y = x.copy()
    if n > 0: y[:n] *= np.linspace(0, 1, n)
    return y

def trim_tail(x, floor_db=-62, sr=SR, min_len=0.3):
    """Cut where the 20 ms envelope stays below floor_db re the peak envelope."""
    e = env(x, 20, sr)
    thr = e.max()*fromdb(floor_db)
    idx = np.where(e > thr)[0]
    end = int(idx[-1]) if len(idx) else len(x)
    return x[:max(end, int(min_len*sr))]

def pad_to(x, n):
    return np.concatenate([x, np.zeros(max(0, n-len(x)))]) if len(x) < n else x[:n]

def mix_at(dst, src, t, gain=1.0, sr=SR):
    a = int(round(t*sr))
    n = len(src)
    if a + n > len(dst):
        dst = np.concatenate([dst, np.zeros(a+n-len(dst))])
    dst[a:a+n] += src*gain
    return dst

def delay(x, t, sr=SR):
    return np.concatenate([np.zeros(int(round(t*sr))), x])

def sub_thump(dur=1.4, f0=78.0, f1=33.0, sweep_tau=0.10, amp_tau=0.30, attack=0.004, h2=0.22, sr=SR):
    """Synthetic chest thump: sine that falls from f0 to f1 with a fast attack and exponential decay."""
    n = int(dur*sr); t = np.arange(n)/sr
    f = f1 + (f0-f1)*np.exp(-t/sweep_tau)
    ph = 2*np.pi*np.cumsum(f)/sr
    a = (1-np.exp(-t/attack))*np.exp(-t/amp_tau)
    y = np.sin(ph) + h2*np.sin(2*ph + 0.4)
    y = y*a
    return y/np.abs(y).max()

def make_ir(rt_low=2.4, rt_mid=1.4, rt_high=0.5, lp_hz=6000, predelay=0.012, length=None, seed=1, taps=(), sr=SR):
    """Synthetic outdoor-ish impulse response: three bands of exponentially decaying noise (low rings longest), optional discrete echoes (t, gain, lowpass_hz)."""
    rng = np.random.default_rng(seed)
    L = int((length or max(rt_low, rt_mid)*1.15)*sr)
    t = np.arange(L)/sr
    def band(rt, lo, hi, g):
        n = rng.standard_normal(L)
        n = ff(n, f"highpass=f={lo}:p=2,lowpass=f={hi}:p=2") if lo > 0 else ff(n, f"lowpass=f={hi}:p=2")
        return g*n*np.exp(-6.9*t/rt)
    ir = band(rt_low, 0, 220, 1.0) + band(rt_mid, 220, 1500, 0.55) + band(rt_high, 1500, lp_hz, 0.22)
    ir[:int(predelay*sr)] = 0
    for (tt, g, f) in taps:
        i = int(tt*sr)
        if i < L:
            k = int(0.03*sr)
            burst = rng.standard_normal(k)*np.exp(-np.arange(k)/(0.008*sr))
            burst = lp_n(burst, f, 1)
            ir[i:i+k] += g*burst[:max(0, min(k, L-i))]
    ir /= np.sqrt((ir**2).sum())
    return ir

def conv(x, ir):
    n = len(x)+len(ir)
    N = 1 << (n-1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, N)*np.fft.rfft(ir, N), N)[:n]
    return y

def reverb(x, ir, wet_db=-8, tail_only_after=None, sr=SR):
    """Dry + convolved wet. wet level is relative to the dry RMS over the first second."""
    w = conv(x, ir)
    ref = rms(x[:sr]) + 1e-9
    wr = rms(w[:sr]) + 1e-9
    w *= fromdb(wet_db)*ref/wr
    y = np.zeros(max(len(x), len(w)))
    y[:len(x)] += x
    y[:len(w)] += w
    return y

def sat(x, drive=2.0):
    s = peak(x) + 1e-12
    return np.tanh(drive*x/s)*s/np.tanh(drive)

def bass_enhance(x, f=95, drive=3.0, mix=0.35, hp_f=70):
    """Generate harmonics of the low band so it is audible on speakers that cannot reproduce it."""
    lf = lp_n(x, f, 1)
    s = peak(lf) + 1e-12
    h = np.tanh(drive*lf/s)*s - lf
    h = hp(h, hp_f, 2)
    return x + mix*h

def softclip(x, ceiling_db=-1.0, knee=0.85):
    """Gentle limiter: linear below knee*ceiling, tanh-shaped above."""
    c = fromdb(ceiling_db)
    k = knee*c
    y = x.copy()
    a = np.abs(y)
    m = a > k
    y[m] = np.sign(y[m])*(k + (c-k)*np.tanh((a[m]-k)/(c-k)))
    return y

def write_wav(path, x, sr=SR):
    x = np.clip(x, -1, 1)
    pcm = (x*32767).astype('<i2')
    ch = 1 if x.ndim == 1 else x.shape[1]
    with wave.open(path, "wb") as w:
        w.setnchannels(ch); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(pcm.tobytes())

def encode_mp3(x, path, kbps=96, sr=SR):
    ch = 1 if x.ndim == 1 else x.shape[1]
    raw = np.clip(x, -1, 1).astype(np.float32).tobytes()
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(sr), "-ac", str(ch), "-i", "-", "-c:a", "libmp3lame", "-b:a", f"{kbps}k", "-ar", str(sr), "-ac", str(ch), "-map_metadata", "-1", "-id3v2_version", "0", "-write_xing", "1", path]
    subprocess.run(cmd, input=raw, check=True)

def loud(x, sr=SR):
    """EBU R128 numbers via ffmpeg: integrated, max momentary (400 ms), max short-term, true peak (dBTP)."""
    cmd = ["ffmpeg", "-nostats", "-hide_banner", "-v", "verbose", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "-", "-af", "ebur128=peak=true:framelog=verbose", "-f", "null", "-"]
    r = subprocess.run(cmd, input=x.astype(np.float32).tobytes(), capture_output=True)
    txt = r.stderr.decode()
    ms = [float(v) for v in re.findall(r"\bM:\s*(-?\d+\.?\d*)", txt)]
    ss = [float(v) for v in re.findall(r"\bS:\s*(-?\d+\.?\d*)", txt)]
    m = re.search(r"Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS", txt)
    tp = re.search(r"True peak:\s*\n\s*Peak:\s*(-?[\d.]+) dBFS", txt)
    return dict(I=float(m.group(1)) if m else None, Mmax=max(ms) if ms else None, Smax=max(ss) if ss else None, TP=float(tp.group(1)) if tp else None)

def band_rms_db(x, lo, hi, sr=SR):
    X = np.abs(np.fft.rfft(x*np.hanning(len(x))))**2
    f = np.fft.rfftfreq(len(x), 1/sr)
    return 10*np.log10(X[(f >= lo) & (f < hi)].sum()/X.sum() + 1e-18)

def limiter(x, ceiling_db=-1.0, lookahead_ms=2.0, release_ms=70.0, sr=SR):
    """Look-ahead brickwall limiter: gain falls to the required value just before a peak and recovers with a one-pole release."""
    c = fromdb(ceiling_db)
    g = np.minimum(1.0, c/(np.abs(x) + 1e-12))
    n = max(2, int(lookahead_ms*sr/1000))
    gm = np.lib.stride_tricks.sliding_window_view(np.concatenate([g, np.ones(n)]), n).min(axis=1)[:len(g)]
    cs = np.concatenate([[0.0], np.cumsum(gm)])
    idx = np.arange(len(gm))
    lo = np.maximum(0, idx - n + 1)
    ma = (cs[idx+1] - cs[lo])/(idx + 1 - lo)
    rel = np.exp(-1.0/(release_ms*sr/1000))
    out = np.empty_like(ma)
    cur = 1.0
    for i in range(len(ma)):
        t = ma[i]
        cur = t if t < cur else cur + (t - cur)*(1 - rel)
        out[i] = cur
    return np.clip(x*out, -c, c)

def master(x, target_M, ceiling_db=-1.5, lookahead_ms=2.0, release_ms=80.0, tol=0.15, lo=-30.0, hi=30.0, iters=14):
    """Scale and limit so the max momentary loudness lands on target_M (LUFS) with peaks below ceiling_db.
    Returns (y, info). If the limiter would have to work too hard the target is not reached and info says so."""
    x0 = x/(peak(x) + 1e-12)
    best = None
    for _ in range(iters):
        mid = (lo + hi)/2
        y = limiter(x0*fromdb(mid), ceiling_db, lookahead_ms, release_ms)
        m = loud(y)['Mmax']
        if m is None: m = -99
        best = (mid, y, m)
        if abs(m - target_M) <= tol: break
        if m < target_M: lo = mid
        else: hi = mid
    mid, y, m = best
    pin = db(peak(x0*fromdb(mid)))
    return y, dict(gain_db=mid, M=m, limiter_peak_cut_db=pin - ceiling_db, hit=abs(m-target_M) <= tol)

def compressor(x, thr_db=-20.0, ratio=3.0, attack_ms=6.0, release_ms=150.0, knee_db=6.0, sr=SR):
    """Feed-forward peak compressor (numpy). thr_db is relative to full scale of the input as given."""
    a = np.abs(x) + 1e-9
    atk = np.exp(-1.0/(attack_ms*sr/1000)); rel = np.exp(-1.0/(release_ms*sr/1000))
    env_ = np.empty_like(a)
    e = 0.0
    for i in range(len(a)):
        c = a[i]
        e = c + atk*(e - c) if c > e else c + rel*(e - c)
        env_[i] = e
    lvl = 20*np.log10(env_)
    over = lvl - thr_db
    k = knee_db
    gr = np.where(over <= -k/2, 0.0, np.where(over >= k/2, over*(1 - 1/ratio), ((over + k/2)**2)/(2*k)*(1 - 1/ratio)))
    return x*10**(-gr/20)


def notch(x, f, w=80, n=1):
    """Narrow band-reject (width w Hz), applied n times; used to remove tonal ringing that came with a recording."""
    for _ in range(n):
        x = ff(x, f"bandreject=f={f}:width_type=h:w={w}")
    return x
