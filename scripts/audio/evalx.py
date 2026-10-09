import numpy as np, dsp
from dsp import SR
def evaluate(x, name=''):
    pk = dsp.peak(x)
    e1 = dsp.env(x, 1.0)
    ip = int(np.argmax(e1)); m = e1[ip]
    pre = e1[:ip+1]
    try:
        t10 = np.where(pre >= 0.1*m)[0][0]; t90 = np.where(pre >= 0.9*m)[0][0]; att = (t90-t10)/SR*1000
    except Exception: att = float('nan')
    first = np.where(np.abs(x) > 0.02*pk)[0]
    lead = first[0]/SR*1000 if len(first) else float('nan')
    a = int(max(0, ip-0.01*SR)); w = x[a:a+int(0.4*SR)]
    lf = 10**(dsp.band_rms_db(w, 20, 120)/10); lf250 = 10**(dsp.band_rms_db(w, 20, 250)/10)
    hf = 10**(dsp.band_rms_db(w, 2000, 12000)/10)
    S = np.abs(np.fft.rfft(w*np.hanning(len(w))))**2; f = np.fft.rfftfreq(len(w), 1/SR)
    cen = (f*S).sum()/S.sum()
    e20 = dsp.env(x, 25)
    pk20 = e20.max()
    def tdrop(d):
        i = np.argmax(e20)
        idx = np.where(e20[i:] < pk20*10**(-d/20))[0]
        return round(idx[0]/SR, 2) if len(idx) else None
    L = dsp.loud(x)
    clip = int((np.abs(x) >= 0.999).sum())
    return dict(name=name, dur=round(len(x)/SR, 2), pk=round(dsp.db(pk), 1), tp=L['TP'], Mmax=L['Mmax'], I=L['I'], att_ms=round(att, 1), lead_ms=round(lead, 1),
                lf120=round(lf, 2), lf250=round(lf250, 2), hf2k=round(hf, 3), cen=int(cen), t20=tdrop(20), t40=tdrop(40), t60=tdrop(60), clip=clip)
def show(rs):
    for r in rs:
        print(f"{r['name']:16s} dur={r['dur']:5.2f} pk={r['pk']:5.1f} TP={r['tp']} M={r['Mmax']} I={r['I']} att={r['att_ms']:5.1f}ms lead={r['lead_ms']:5.1f}ms lf120={r['lf120']:.2f} lf250={r['lf250']:.2f} hf2k={r['hf2k']:.3f} cen={r['cen']:4d} t-20/40/60={r['t20']}/{r['t40']}/{r['t60']} clip={r['clip']}")
