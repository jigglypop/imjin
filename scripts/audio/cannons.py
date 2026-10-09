import numpy as np, dsp
from dsp import SR

def lf_ref(x, t=0.3):
    y = dsp.lp_n(dsp.hp(x, 20, 1), 120, 2)
    return dsp.rms(y[:int(t*SR)]) + 1e-9

def crack_layer(name, t0, dur=0.14, hp_hz=1200, tau=0.03, lp_hz=11000, rate=1.0):
    """Bright blast transient lifted from a real recording: first `dur` seconds after the onset, high-passed, with a fast exponential fade."""
    x = dsp.align(dsp.seg(dsp.load(name), t0, t0 + 0.6), pre_ms=0.5)
    x = dsp.rate(x, rate)
    x = x[:int(dur*SR)]
    x = dsp.hp(x, hp_hz, 2)
    x = dsp.lp(x, lp_hz, 1)
    t = np.arange(len(x))/SR
    x *= np.exp(-t/tau)
    return x/(dsp.peak(x)+1e-12)

def bang_layer(t0, dur=0.18, hp_hz=70, lp_hz=9000, tau=0.07, rate=1.0, name='125932'):
    """Muzzle blast of a genuine black-powder cannon (battle reenactment recording): the first `dur` seconds after the onset at t0."""
    x = dsp.seg(dsp.load(name), t0 - 0.02, t0 + 0.7)
    x = dsp.align(x, pre_ms=0.5, rel_db=-24)
    x = dsp.rate(x, rate)
    x = x[:int(dur*SR)]
    x = dsp.hp(x, hp_hz, 2)
    x = dsp.lp(x, lp_hz, 1)
    t = np.arange(len(x))/SR
    x = x*np.exp(-np.maximum(0, t - 0.04)/tau)
    return x/(dsp.peak(x) + 1e-12)

def cannon(x, *, rate=1.0, lp_hz=8500, mid_cut=-1.5, bass_db=2.0, bass_f=90,
           sub_db=-4.0, sub_f0=78, sub_f1=33, sub_amp_tau=0.30, sub_delay=0.002,
           enh_mix=0.35, rt=(2.2, 1.3, 0.45), wet_db=-9, ir_seed=1, taps=(),
           crack=None, crack_db=-8.0, bang=None, bang_db=-4.0, tail_boost_db=0.0,
           length=4.0, fade_ms=500, src_fade_ms=0):
    """Turn a recorded shot into a heavier, longer-ringing 'black powder gun'.
    x is a shot segment aligned so the blast starts ~2 ms in. crack = a crack_layer() array added on top."""
    x = x/(dsp.peak(x) + 1e-12)
    if src_fade_ms:
        x = dsp.fade_out(x, src_fade_ms, 1.5)
    x = dsp.rate(x, rate)
    x = dsp.hp(x, 22, 2)
    x = dsp.lp(x, lp_hz, 2)
    if mid_cut:
        x = dsp.eq(x, 2800, mid_cut, 0.7)
    if bass_db:
        x = dsp.lowshelf(x, bass_f, bass_db)
    if sub_db is not None:
        ref = lf_ref(x)
        s = dsp.sub_thump(dur=min(length, 2.2), f0=sub_f0, f1=sub_f1, amp_tau=sub_amp_tau)
        s *= ref*dsp.fromdb(sub_db)/(dsp.rms(s[:int(0.3*SR)]) + 1e-9)
        y = np.zeros(max(len(x), len(s) + int(sub_delay*SR)))
        y[:len(x)] += x
        y[int(sub_delay*SR):int(sub_delay*SR) + len(s)] += s
        x = y
    if enh_mix:
        x = dsp.bass_enhance(x, f=95, drive=3.0, mix=enh_mix)
    if crack is not None:
        r30 = dsp.rms(x[:int(0.03*SR)]) + 1e-9
        c = crack*r30*dsp.fromdb(crack_db)/(dsp.rms(crack[:int(0.03*SR)]) + 1e-9)
        y = x.copy()
        y[:len(c)] += c
        x = y
    if bang is not None:
        r40 = dsp.rms(x[:int(0.04*SR)]) + 1e-9
        c = bang*r40*dsp.fromdb(bang_db)/(dsp.rms(bang[:int(0.04*SR)]) + 1e-9)
        y = x.copy()
        y[:len(c)] += c
        x = y
    if rt:
        ir = dsp.make_ir(rt[0], rt[1], rt[2], seed=ir_seed, taps=taps, length=max(rt[0], rt[1])*1.1)
        x = dsp.reverb(x, ir, wet_db=wet_db)
    x = x[:int(length*SR)]
    x = dsp.fade_out(x, fade_ms, 2.0)
    x = dsp.fade_in(x, 0.5)
    return x
