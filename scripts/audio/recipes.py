"""Recipes for every game sample. Each returns the pre-master mono signal at 44.1 kHz.
Sources are Freesound CC0 previews in raw/<id>.mp3 (see CREDITS)."""
import numpy as np, dsp, cannons
from dsp import SR

def src(name, a, b, pre=2.0, rel=-24, search=None):
    return dsp.align(dsp.seg(dsp.load(name), a, b), pre_ms=pre, rel_db=rel, search=search)

def raw(name, a, b):
    return dsp.seg(dsp.load(name), a, b)

def layer(base, x, t, db, ref_win=(0.0, 0.5)):
    """Add x at time t, with RMS level db relative to the base RMS over ref_win (seconds)."""
    a, b = int(ref_win[0]*SR), int(ref_win[1]*SR)
    r = dsp.rms(base[a:b]) + 1e-9
    nz = np.where(np.abs(x) > 1e-5)[0]
    i0 = int(nz[0]) if len(nz) else 0
    xr = dsp.rms(x[i0:i0 + int(0.5*SR)]) + 1e-9
    return dsp.mix_at(base, x*r*dsp.fromdb(db)/xr, t)

def norm1(x): return x/(dsp.peak(x) + 1e-12)

# ---------------------------------------------------------------- cannons
def _crack():
    return {
     'k55a': cannons.crack_layer('184365', 5.99, tau=0.028),
     'k55b': cannons.crack_layer('184365', 14.0, tau=0.03),
     'a182': cannons.crack_layer('182822', 2.66, tau=0.03, hp_hz=1000),
     'f702': cannons.crack_layer('702245', 0.0, tau=0.03, hp_hz=1000),
     'k55c': cannons.crack_layer('184365', 16.0, tau=0.03),
    }

def build_cannons():
    CR = _crack()
    BG = {t: cannons.bang_layer(t) for t in (8.377, 35.281, 39.660, 90.662, 95.890, 156.630)}
    BG['s1'] = cannons.bang_layer(39.660, rate=1.10)
    BG['s2'] = cannons.bang_layer(90.662, rate=1.10)
    R = {}
    h1 = dsp.notch(src('187767', 0.0, 5.9), 8392, 120)
    R['cannon_heavy_1'] = cannons.cannon(h1, rate=0.80, lp_hz=8000, mid_cut=-1.5, bass_db=4, bass_f=80, sub_db=-2, sub_f0=70, sub_f1=32, sub_amp_tau=0.34, enh_mix=0.35, rt=(2.6,1.5,0.5), wet_db=-9, ir_seed=11, crack=CR['k55a'], crack_db=-12, bang=BG[39.660], bang_db=-4, length=4.0, fade_ms=1200)
    R['cannon_heavy_2'] = cannons.cannon(src('187767', 6.3, 11.8), rate=0.86, lp_hz=8000, mid_cut=-1.5, bass_db=2, bass_f=85, sub_db=-4, sub_f0=82, sub_f1=35, sub_amp_tau=0.30, enh_mix=0.35, rt=(2.4,1.4,0.5), wet_db=-10, ir_seed=12, crack=CR['k55b'], crack_db=-12, bang=BG[35.281], bang_db=-4, length=4.0, fade_ms=1200)
    h3 = dsp.notch(src('239137', 3.0, 5.0), 1546, 70, 2)
    R['cannon_heavy_3'] = cannons.cannon(h3, rate=0.76, lp_hz=6500, mid_cut=-3, bass_db=0, bass_f=80, sub_db=-8, sub_f0=66, sub_f1=31, sub_amp_tau=0.30, enh_mix=0.25, rt=(2.6,1.6,0.5), wet_db=-7, ir_seed=13, crack=CR['k55c'], crack_db=-12, bang=BG[90.662], bang_db=-4, length=4.0, fade_ms=900, src_fade_ms=250)
    s = src('125348', 0.0, 2.5)
    s = dsp.softclip(norm1(s), -10.0, 0.35)
    # the reenactment gun is all crack and little body, so a recorded boom is blended in underneath it
    b = src('186952', 0.0, 1.7, pre=2, rel=-22)
    b = dsp.lp_n(dsp.hp(dsp.rate(norm1(b), 0.92), 25, 2), 650, 2)
    y = np.zeros(max(len(s), len(b)))
    y[:len(s)] += s
    y[:len(b)] += b*dsp.rms(s[:int(0.3*SR)])*dsp.fromdb(-1.5)/(dsp.rms(b[:int(0.3*SR)]) + 1e-9)
    R['cannon_medium_1'] = cannons.cannon(y, rate=1.0, lp_hz=9000, mid_cut=-1, bass_db=2, bass_f=90, sub_db=-3, sub_f0=82, sub_f1=38, sub_amp_tau=0.26, enh_mix=0.35, rt=(2.3,1.4,0.5), wet_db=-5, ir_seed=21, crack=CR['a182'], crack_db=-12, length=3.4, fade_ms=900, src_fade_ms=150)
    m2 = dsp.notch(src('239137', 5.0, 6.9), 1553, 70, 2)
    R['cannon_medium_2'] = cannons.cannon(m2, rate=0.96, lp_hz=8000, mid_cut=-3, bass_db=0, bass_f=90, sub_db=-8, sub_f0=85, sub_f1=40, sub_amp_tau=0.22, enh_mix=0.25, rt=(2.0,1.2,0.45), wet_db=-7, ir_seed=22, crack=CR['k55b'], crack_db=-13, bang=BG[95.890], bang_db=-4, length=3.3, fade_ms=800, src_fade_ms=200)
    m3 = src('529239', 0.0, 4.7)
    m3 = dsp.notch(m3, 1780, 70, 2)
    R['cannon_medium_3'] = cannons.cannon(m3, rate=1.0, lp_hz=8000, mid_cut=-2, bass_db=0, bass_f=90, sub_db=-8, sub_f0=88, sub_f1=40, sub_amp_tau=0.22, enh_mix=0.25, rt=(1.8,1.1,0.4), wet_db=-12, ir_seed=23, crack=CR['f702'], crack_db=-13, bang=BG[156.630], bang_db=-4, length=3.4, fade_ms=900)
    R['cannon_small_1'] = cannons.cannon(src('182822', 20.14, 22.2), rate=1.12, lp_hz=10000, mid_cut=0, bass_db=3, bass_f=100, sub_db=-3, sub_f0=95, sub_f1=45, sub_amp_tau=0.15, enh_mix=0.3, rt=(1.5,1.0,0.4), wet_db=-8, ir_seed=31, crack=None, bang=BG['s1'], bang_db=-6, length=2.6, fade_ms=700, src_fade_ms=150)
    R['cannon_small_2'] = cannons.cannon(src('702245', 0.0, 2.1), rate=1.15, lp_hz=10000, mid_cut=0, bass_db=3, bass_f=100, sub_db=0, sub_f0=95, sub_f1=45, sub_amp_tau=0.15, enh_mix=0.3, rt=(1.5,1.0,0.4), wet_db=-8, ir_seed=32, crack=None, bang=BG['s2'], bang_db=-6, length=2.6, fade_ms=700, src_fade_ms=250)
    return R

# ---------------------------------------------------------------- far booms
def echo_taps(x, taps, sr=SR):
    """Add delayed, progressively low-passed copies: taps = [(delay_s, gain_db, lp_hz), ...]"""
    y = x.copy()
    for (d, g, f) in taps:
        c = dsp.lp_n(x, f, 1)
        y = dsp.mix_at(y, c*dsp.fromdb(g), d)
    return y

def build_far(R):
    F = {}
    x = src('634629', 7.40, 13.68, pre=3, rel=-26)
    x = dsp.hp_n(x, 26, 2)
    x = dsp.lp_n(x, 1000, 1)
    x = echo_taps(x, [(1.05, -9, 600), (1.9, -13, 450)])
    ir = dsp.make_ir(5.0, 3.0, 1.0, lp_hz=3000, length=5.5, seed=41, taps=[(0.35, 0.5, 500), (0.8, 0.35, 400), (1.4, 0.22, 350)])
    x = dsp.reverb(x, ir, wet_db=-8)
    x = x[:int(6.0*SR)]
    F['cannon_far_1'] = dsp.fade_in(dsp.fade_out(x, 2300, 2.0), 3)
    # second: a heavy gun heard over the hills, thickened with a slowed explosion rumble
    h = src('187767', 0.0, 5.9, pre=3)
    h = dsp.rate(norm1(h), 0.85)
    h = dsp.hp_n(h, 28, 2)
    h = dsp.lp_n(h, 420, 2)
    h = dsp.fade_in(h, 10)
    h = echo_taps(h, [(0.42, -6, 350), (1.0, -10, 300), (1.8, -14, 260)])
    rum = src('476225', 0.0, 8.0, pre=3, rel=-30)
    rum = dsp.hp_n(rum, 28, 1)
    rum = dsp.lp_n(rum, 260, 1)
    h = layer(h, rum, 0.12, -9)
    ir = dsp.make_ir(5.5, 3.2, 0.8, lp_hz=2500, length=6.0, seed=42, taps=[(0.5, 0.45, 400), (1.2, 0.3, 320)])
    h = dsp.reverb(h, ir, wet_db=-7)
    h = h[:int(6.0*SR)]
    F['cannon_far_2'] = dsp.fade_in(dsp.fade_out(h, 2400, 2.0), 3)
    return F

# ---------------------------------------------------------------- broadside
def _broadside(R, names, offs, gdb, rates, seed, length=6.0):
    out = np.zeros(int(6.8*SR))
    for n, t, g, r in zip(names, offs, gdb, rates):
        s = R[n]
        s = s/(dsp.peak(s) + 1e-12)
        s = dsp.rate(s, r)[:int(3.4*SR)]
        s = dsp.fade_out(s, 700, 2.0)
        out = dsp.mix_at(out, s, t, dsp.fromdb(g))
    out /= np.sqrt(len(names))
    ir = dsp.make_ir(3.4, 2.0, 0.7, lp_hz=3500, length=3.8, seed=seed, taps=[(0.3, 0.4, 600), (0.7, 0.28, 450)])
    out = dsp.reverb(out, ir, wet_db=-7)
    out = dsp.trim_tail(out, -60)[:int(length*SR)]
    return dsp.fade_out(out, 1600, 2.0)

def build_broadside(R):
    b1 = _broadside(R, ['cannon_medium_2', 'cannon_heavy_2', 'cannon_small_1', 'cannon_medium_3', 'cannon_heavy_1', 'cannon_medium_1', 'cannon_small_2', 'cannon_heavy_3'],
                    [0.00, 0.09, 0.16, 0.31, 0.47, 0.66, 0.84, 1.02], [0.0, -1.0, -3.0, -2.0, -1.0, -3.0, -3.0, -2.0], [1.00, 0.97, 1.05, 0.95, 1.04, 0.93, 1.02, 0.98], 51)
    b2 = _broadside(R, ['cannon_heavy_3', 'cannon_medium_1', 'cannon_small_2', 'cannon_heavy_1', 'cannon_medium_3', 'cannon_small_1', 'cannon_medium_2'],
                    [0.00, 0.12, 0.20, 0.36, 0.52, 0.74, 0.93], [0.0, -2.0, -3.0, -1.0, -2.0, -4.0, -2.0], [0.96, 1.03, 1.08, 0.92, 1.02, 0.97, 1.06], 52)
    return {'broadside_1': b1, 'broadside_2': b2}

# ---------------------------------------------------------------- explosions
def debris(length=6.0, seed=0, start=0.6):
    """Falling timber and rubble: low-passed wreckage rumble plus sparse wood cracks, laid out for the tail of a big blast."""
    d = raw('705629', 0.0, 7.0)
    d = dsp.hp_n(d, 140, 1)
    d = dsp.lp_n(d, 4500, 1)
    d = dsp.fade_in(d, 300)
    out = np.zeros(int(length*SR))
    out = dsp.mix_at(out, d, start, 1.0)
    return out

def build_explosions(R):
    E = {}
    x = src('259300', 0.0, 9.5, pre=2, rel=-30)
    x = dsp.rate(x, 0.93)
    x = dsp.hp(x, 24, 2)
    x = dsp.lp(x, 9000, 2)
    x = dsp.lowshelf(x, 90, 2)
    s = dsp.sub_thump(dur=3.0, f0=58, f1=26, sweep_tau=0.22, amp_tau=0.65)
    ref = cannons.lf_ref(x, 0.4)
    s *= ref*dsp.fromdb(-3)/(dsp.rms(s[:int(0.4*SR)]) + 1e-9)
    x = dsp.mix_at(x, s, 0.002, 1.0)
    x = dsp.bass_enhance(x, 95, 3.0, 0.3)
    x = dsp.sat(x, 1.5)
    db_ = debris(9.0, start=0.7)
    x = layer(x, db_, 0.0, -17, ref_win=(0.5, 1.5))
    for t, f, g in [(0.28, '183452', -20), (1.1, '183453', -22), (2.0, '183450', -24)]:
        c = dsp.hp_n(raw(f, 0.0, 2.2), 1500, 1)
        x = layer(x, c, t, g, ref_win=(0.5, 1.5))
    ir = dsp.make_ir(4.2, 2.4, 0.9, lp_hz=5000, length=4.6, seed=61, taps=[(0.4, 0.35, 700), (1.0, 0.25, 500)])
    x = dsp.reverb(x, ir, wet_db=-9)
    x = x[:int(6.0*SR)]
    E['explosion_1'] = dsp.fade_in(dsp.fade_out(x, 3000, 2.0), 0.5)
    y = src('235968', 0.38, 7.8, pre=2, rel=-26)
    y = dsp.rate(y, 0.95)
    y = dsp.hp(y, 24, 2)
    y = dsp.lp(y, 11000, 2)
    y = dsp.lowshelf(y, 90, 3)
    s = dsp.sub_thump(dur=3.0, f0=62, f1=28, sweep_tau=0.2, amp_tau=0.55)
    ref = cannons.lf_ref(y, 0.4)
    s *= ref*dsp.fromdb(-4)/(dsp.rms(s[:int(0.4*SR)]) + 1e-9)
    y = dsp.mix_at(y, s, 0.002, 1.0)
    y = dsp.bass_enhance(y, 95, 3.0, 0.3)
    d2 = debris(7.0, start=0.45)
    d2 = dsp.rate(d2, 1.06)
    y = layer(y, d2, 0.0, -18, ref_win=(0.5, 1.5))
    for t, f, g in [(0.2, '183453', -19), (0.9, '183452', -21)]:
        c = dsp.hp_n(raw(f, 0.0, 2.2), 1500, 1)
        y = layer(y, c, t, g, ref_win=(0.5, 1.5))
    ir = dsp.make_ir(3.6, 2.2, 0.8, lp_hz=5500, length=4.0, seed=62, taps=[(0.35, 0.3, 700)])
    y = dsp.reverb(y, ir, wet_db=-10)
    y = y[:int(6.0*SR)]
    E['explosion_2'] = dsp.fade_in(dsp.fade_out(y, 2600, 2.0), 0.5)
    return E

# ---------------------------------------------------------------- impacts on timber
def thump(dur, f0, f1, sweep_tau, amp_tau, attack=0.003, h2=0.2):
    return dsp.sub_thump(dur=dur, f0=f0, f1=f1, sweep_tau=sweep_tau, amp_tau=amp_tau, attack=attack, h2=h2)

def add_thump(x, db_vs_lf, dur=1.2, f0=95, f1=42, sweep_tau=0.07, amp_tau=0.2, delay=0.002, attack=0.003):
    ref = cannons.lf_ref(x, 0.25)
    s = thump(dur, f0, f1, sweep_tau, amp_tau, attack)
    s *= ref*dsp.fromdb(db_vs_lf)/(dsp.rms(s[:int(0.25*SR)]) + 1e-9)
    return dsp.mix_at(x, s, delay, 1.0)

def build_impacts():
    W = {}
    # 1: heavy ship-timber collapse (simulated wooden ship collision), thickened
    x = src('257752', 0.0, 2.9, pre=1.5, rel=-20)
    x = dsp.rate(norm1(x), 0.92)
    x *= np.exp(-np.arange(len(x))/SR/0.95)
    x = dsp.hp(x, 30, 2); x = dsp.lp(x, 9500, 2)
    x = dsp.eq(x, 2500, -2, 0.8)
    x = add_thump(x, -3, 1.4, 92, 40, 0.07, 0.24)
    c = dsp.hp_n(raw('183450', 0.0, 2.3), 1800, 1)
    x = layer(x, c, 0.05, -13, ref_win=(0.0, 0.6))
    x = dsp.bass_enhance(x, 100, 2.5, 0.25)
    ir = dsp.make_ir(0.9, 0.6, 0.3, lp_hz=5000, length=1.0, seed=71)
    x = dsp.reverb(x, ir, wet_db=-11)
    x = x[:int(2.6*SR)]
    W['impact_wood_1'] = dsp.fade_in(dsp.fade_out(x, 700, 2.0), 0.5)
    # 2: one big hit, plank smash with a crack
    a = src('553886', 0.0, 2.4, pre=1.5, rel=-22)
    b = src('536777', 0.0, 1.05, pre=1.0, rel=-22)
    x = norm1(a)
    x = layer(x, norm1(b), 0.01, -5, ref_win=(0.0, 0.5))
    x = dsp.rate(x, 0.90)
    x = dsp.hp(x, 28, 2); x = dsp.lp(x, 9500, 2)
    x = dsp.lowshelf(x, 110, 3)
    x = add_thump(x, -2, 1.2, 100, 44, 0.06, 0.2)
    c = dsp.hp_n(raw('183453', 0.0, 1.6), 1800, 1)
    x = layer(x, c, 0.08, -12, ref_win=(0.0, 0.5))
    x = dsp.bass_enhance(x, 100, 2.5, 0.25)
    ir = dsp.make_ir(0.8, 0.5, 0.25, lp_hz=5000, length=0.9, seed=72)
    x = dsp.reverb(x, ir, wet_db=-11)
    x = x[:int(1.0*SR)]
    W['impact_wood_2'] = dsp.fade_in(dsp.fade_out(x, 500, 2.0), 0.5)
    # 3: door/bulwark breaking with a falling-wreckage tail
    a = src('723974', 0.0, 1.32, pre=1.0, rel=-22)
    b = src('487146', 0.0, 3.2, pre=1.0, rel=-24)
    x = norm1(a)
    x = layer(x, norm1(b), 0.12, -7, ref_win=(0.0, 0.5))
    x = dsp.rate(x, 0.88)
    x = dsp.hp(x, 28, 2); x = dsp.lp(x, 9500, 2)
    x = dsp.lowshelf(x, 110, 3)
    x = add_thump(x, -2, 1.2, 88, 40, 0.07, 0.22)
    c = dsp.hp_n(raw('183452', 0.0, 2.5), 1800, 1)
    x = layer(x, c, 0.18, -13, ref_win=(0.0, 0.5))
    x = dsp.bass_enhance(x, 100, 2.5, 0.25)
    ir = dsp.make_ir(0.9, 0.55, 0.3, lp_hz=5000, length=1.0, seed=73)
    x = dsp.reverb(x, ir, wet_db=-11)
    x = x[:int(2.4*SR)]
    W['impact_wood_3'] = dsp.fade_in(dsp.fade_out(x, 700, 2.0), 0.5)
    return W

# ---------------------------------------------------------------- water
def bloop(dur=0.8, f0=170, f1=58, sweep_tau=0.09, amp_tau=0.2):
    return dsp.sub_thump(dur=dur, f0=f0, f1=f1, sweep_tau=sweep_tau, amp_tau=amp_tau, attack=0.006, h2=0.1)

def build_splash():
    S = {}
    x = src('442773', 0.0, 2.3, pre=2.0, rel=-26)
    x = dsp.rate(norm1(x), 0.90)
    x = dsp.hp(x, 40, 2); x = dsp.lp(x, 11000, 2)
    x = dsp.lowshelf(x, 120, 3)
    ref = cannons.lf_ref(x, 0.3)
    s = bloop(0.9, 150, 52, 0.08, 0.22); s *= ref*dsp.fromdb(-4)/(dsp.rms(s[:int(.3*SR)]) + 1e-9)
    x = dsp.mix_at(x, s, 0.01, 1.0)
    x = dsp.bass_enhance(x, 100, 2.0, 0.2)
    ir = dsp.make_ir(1.0, 0.7, 0.4, lp_hz=6000, length=1.1, seed=81)
    x = dsp.reverb(x, ir, wet_db=-13)
    x = x[:int(2.6*SR)]
    S['splash_1'] = dsp.fade_in(dsp.fade_out(x, 800, 2.0), 0.5)
    y = src('583348', 0.0, 3.2, pre=2.0, rel=-26)
    y = dsp.rate(norm1(y), 0.86)
    y = dsp.hp(y, 40, 2); y = dsp.lp(y, 11000, 2)
    y = dsp.lowshelf(y, 120, 3)
    ref = cannons.lf_ref(y, 0.3)
    s = bloop(1.0, 135, 48, 0.1, 0.26); s *= ref*dsp.fromdb(-3)/(dsp.rms(s[:int(.3*SR)]) + 1e-9)
    y = dsp.mix_at(y, s, 0.012, 1.0)
    y = dsp.bass_enhance(y, 100, 2.0, 0.2)
    ir = dsp.make_ir(1.1, 0.8, 0.4, lp_hz=6000, length=1.2, seed=82)
    y = dsp.reverb(y, ir, wet_db=-13)
    y = y[:int(3.0*SR)]
    S['splash_2'] = dsp.fade_in(dsp.fade_out(y, 1000, 2.0), 0.5)
    return S

# ---------------------------------------------------------------- shell passing overhead
def svf_bandpass(x, fc, q=1.4, sr=SR):
    """State-variable band-pass with a per-sample centre frequency (fc is an array)."""
    f = 2*np.sin(np.pi*np.minimum(fc, sr*0.45)/sr)
    qd = 1.0/q
    low = band = 0.0
    out = np.empty_like(x)
    for i in range(len(x)):
        low += f[i]*band
        high = x[i] - low - qd*band
        band += f[i]*high
        out[i] = band
    return out

def flyby(dur=1.25, peak_t=0.55, f_hi=2300, f_lo=620, width=0.20, seed=3, q=1.2):
    """Synthetic round shot passing close overhead: noise through a band-pass that glides down (Doppler) under a rise-peak-fall envelope, plus a low swish."""
    rng = np.random.default_rng(seed)
    n = int(dur*SR); t = np.arange(n)/SR
    noise = rng.standard_normal(n)
    glide = 0.5*(1 - np.tanh((t - peak_t)/0.16))
    fc = f_lo + (f_hi - f_lo)*glide
    bp = svf_bandpass(noise, fc, q)
    air = dsp.hp_n(rng.standard_normal(n), 2800, 1)*0.5
    env = 1.0/(1.0 + ((t - peak_t)/width)**2)**1.5
    env *= np.minimum(1.0, t/0.05)
    x = (bp*1.0 + air*glide**2)*env
    low = dsp.lp_n(rng.standard_normal(n), 220, 2)
    low *= env**2
    x = x/(dsp.peak(x) + 1e-12) + 0.55*low/(dsp.peak(low) + 1e-12)
    return x

def build_whoosh():
    H = {}
    a = raw('241840', 0.0, 1.68)
    a = dsp.hp_n(a, 110, 1); a = dsp.lp_n(a, 6500, 1)
    a = dsp.rate(norm1(a), 1.12)
    a = dsp.fade_in(a, 40)
    n = len(a); t = np.arange(n)/SR; pk = 0.52*n/SR
    a *= (1.0/(1.0 + ((t - pk)/0.26)**2)**1.2)
    f1 = flyby(1.3, 0.52, 3400, 900, 0.22, seed=11)
    f1 = np.concatenate([f1, np.zeros(max(0, len(a) - len(f1)))])[:len(a)]
    a = norm1(a) + 0.45*norm1(f1)
    H['whoosh_1'] = dsp.fade_out(a, 300, 2.0)
    f = flyby(1.25, 0.55, 2300, 620, 0.20, seed=5)
    b = raw('241837', 0.0, 1.6)
    b = dsp.hp_n(b, 160, 1); b = dsp.lp_n(b, 5000, 1)
    b = dsp.rate(norm1(b), 1.1)
    n2 = len(b); t2 = np.arange(n2)/SR
    b *= (1.0/(1.0 + ((t2 - 0.55)/0.24)**2)**1.2)
    y = np.zeros(max(len(f), len(b)))
    y[:len(f)] += norm1(f)
    y[:len(b)] += 0.6*norm1(b)
    y = dsp.hp(y, 90, 2)
    H['whoosh_2'] = dsp.fade_in(dsp.fade_out(y, 350, 2.0), 25)
    return H

# ---------------------------------------------------------------- musket volleys
def musket_pool():
    """Single black-powder musket shots from real recordings, thinned out (no boom) so they read as small arms."""
    raw_shots = [
        src('538795', 0.0, 3.4, pre=2, rel=-18),
        src('234869', 0.55, 2.4, pre=2, rel=-18),
        src('662875', 0.0, 1.15, pre=2, rel=-18),
        src('662875', 1.12, 3.2, pre=2, rel=-18),
    ]
    pool = []
    for s in raw_shots:
        s = dsp.hp_n(s, 170, 1)
        s = dsp.hp(s, 170, 2)
        s = dsp.lp(s, 11000, 1)
        s = dsp.fade_out(s[:int(2.2*SR)], 500, 2.0)
        r = dsp.rms(s[:int(0.12*SR)]) + 1e-9
        pool.append(s/r)
    return pool

def volley(pool, seed, first_n, first_spread, ragged_n, span, bed=None, bed_db=-14, length=4.2, tail_scale=1.0):
    rng = np.random.default_rng(seed)
    out = np.zeros(int(length*SR))
    def put(t, g):
        s = pool[rng.integers(len(pool))]
        s = dsp.rate(s, float(rng.uniform(0.88, 1.14)))
        s = s[:int(rng.uniform(1.0, 2.0)*tail_scale*SR)]
        s = dsp.fade_out(s, 300, 2.0)
        return dsp.mix_at(out, s, t, g)
    for i in range(first_n):
        out = put(0.004 if i == 0 else float(rng.uniform(0, first_spread)), float(rng.uniform(0.6, 1.0)))
    for _ in range(ragged_n):
        t = first_spread + span*float(rng.random())**1.6
        out = put(t, float(rng.uniform(0.25, 0.8)))
    if bed is not None:
        out = layer(out, bed, 0.0, bed_db, ref_win=(0.0, 1.5))
    return out[:int(length*SR)]

def build_musket():
    pool = musket_pool()
    bed = raw('675624', 6.2, 9.0)
    bed = dsp.hp_n(bed, 400, 1); bed = dsp.lp_n(bed, 9000, 1)
    bed = dsp.fade_in(bed, 200); bed = dsp.fade_out(bed, 1200, 1.5)
    M = {}
    v1 = volley(pool, seed=7, first_n=7, first_spread=0.06, ragged_n=11, span=1.7, bed=bed, bed_db=-16, length=4.2)
    ir = dsp.make_ir(1.3, 0.9, 0.5, lp_hz=8000, length=1.5, seed=91)
    v1 = dsp.reverb(v1, ir, wet_db=-12)
    v1 = dsp.hp(v1, 150, 2)
    M['musket_volley_1'] = dsp.fade_out(v1[:int(4.0*SR)], 900, 2.0)
    rap = raw('854206', 0.0, 3.3)
    rap = dsp.hp_n(rap, 220, 1); rap = dsp.hp(rap, 220, 2); rap = dsp.lp(rap, 9500, 1)
    rap = dsp.fade_out(rap, 500, 2.0)
    v2 = volley(pool, seed=21, first_n=3, first_spread=0.12, ragged_n=14, span=2.4, bed=None, length=4.2)
    v2 = layer(v2, rap, 0.05, -7, ref_win=(0.0, 1.5))
    ir = dsp.make_ir(1.4, 1.0, 0.5, lp_hz=8000, length=1.6, seed=92)
    v2 = dsp.reverb(v2, ir, wet_db=-12)
    v2 = dsp.hp(v2, 150, 2)
    M['musket_volley_2'] = dsp.fade_out(v2[:int(4.0*SR)], 900, 2.0)
    return M

# ---------------------------------------------------------------- hull groan and sinking
def build_creak():
    x = raw('31574', 125.3, 130.4)
    x = dsp.hp_n(x, 50, 1)
    x = dsp.lp_n(x, 9000, 1)
    x = dsp.eq(x, 240, 2.5, 0.9)
    x = dsp.fade_in(x, 250)
    x = dsp.fade_out(x, 900, 2.0)
    return {'creak_1': x}

def build_sink():
    n = int(5.6*SR)
    out = np.zeros(n)
    def prep(name, a, b, r=1.0, lpf=2800):
        s = raw(name, a, b)
        s = dsp.hp(s, 60, 2)
        s = dsp.lp(s, lpf, 2)
        s = dsp.rate(s, r)
        return s/(dsp.rms(s) + 1e-9)
    g3 = prep('529383', 0.15, 1.0, 0.9)
    g1 = prep('529383', 2.35, 4.0, 0.9)
    g2 = prep('529383', 5.55, 7.3, 0.85)
    b1 = prep('539823', 0.2, 4.6, 0.92)
    b2 = prep('423959', 0.0, 7.7, 0.85, 1800)
    out = dsp.mix_at(out, g3, 0.0, 1.0)
    out = dsp.mix_at(out, g1, 0.55, 0.9)
    out = dsp.mix_at(out, g2, 2.0, 0.7)
    out = dsp.mix_at(out, b1, 0.9, 0.5)
    out = dsp.mix_at(out, b2, 0.2, 0.28)
    out = out[:n]
    # the hull going under: a deep swell and a rush of water
    t = np.arange(n)/SR
    rng = np.random.default_rng(5)
    rush = dsp.lp_n(rng.standard_normal(n), 700, 2)*np.exp(-t/0.9)*np.minimum(1, t/0.03)
    rush /= (dsp.rms(rush[:int(0.8*SR)]) + 1e-9)
    s = dsp.sub_thump(dur=2.5, f0=62, f1=34, sweep_tau=0.5, amp_tau=0.9, attack=0.04, h2=0.15)
    ref = dsp.rms(out[:int(1.0*SR)]) + 1e-9
    out[:len(s)] += s*ref*dsp.fromdb(-3)/(dsp.rms(s[:int(1.0*SR)]) + 1e-9)
    out += rush*ref*dsp.fromdb(-8)
    out = dsp.lp(out, 3200, 2)
    ir = dsp.make_ir(1.4, 1.0, 0.4, lp_hz=2500, length=1.6, seed=95)
    out = dsp.reverb(out, ir, wet_db=-8)
    out = out[:n]
    out *= np.exp(-t[:len(out)]/3.6)
    out = dsp.fade_in(dsp.fade_out(out, 1800, 2.0), 20)
    return {'sink_1': out}

# ---------------------------------------------------------------- battle drums (optional extras)
def build_drums():
    """Two single strikes of a big ceremonial drum, pitched down a little for weight."""
    D = {}
    for name, t0, r in [('drum_1', 8.49, 0.90), ('drum_2', 3.88, 0.95)]:
        x = src('858466', t0 - 0.02, t0 + 3.2, pre=2, rel=-24)
        x = dsp.hp(x, 26, 2)
        x = dsp.rate(x, r)
        x = dsp.bass_enhance(x, 110, 3.0, 0.3)
        x = x[:int(2.2*SR)]
        D[name] = dsp.fade_in(dsp.fade_out(x, 1000, 2.0), 0.5)
    return D
