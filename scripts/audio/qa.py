import numpy as np, dsp, glob, os, sys, json
from dsp import SR
def ring_peaks(x, lo=300, hi=9000):
    """Largest narrow-band peak (re local median) in the long-term spectrum - flags tonal ringing."""
    n = len(x)
    if n < SR//2: return (0, 0)
    S = np.abs(np.fft.rfft(x*np.hanning(n)))
    f = np.fft.rfftfreq(n, 1/SR)
    m = (f >= lo) & (f <= hi)
    Sm = S[m]; fm = f[m]
    k = max(5, int(len(Sm)*0.004)) | 1
    med = np.convolve(Sm, np.ones(k)/k, mode='same') + 1e-12
    r = Sm/med
    j = int(np.argmax(r))
    return float(fm[j]), float(r[j])
def octave_bands(x):
    edges = [20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20000]
    w = x[:int(0.5*SR)]
    S = np.abs(np.fft.rfft(w*np.hanning(len(w))))**2
    f = np.fft.rfftfreq(len(w), 1/SR)
    tot = S.sum() + 1e-18
    return [round(10*np.log10(S[(f >= a) & (f < b)].sum()/tot + 1e-12), 1) for a, b in zip(edges[:-1], edges[1:])]
def qa(path):
    x = dsp.load(path)
    pk = dsp.peak(x)
    first = np.where(np.abs(x) > 0.01*pk)[0]
    lead = first[0]/SR*1000
    d = np.abs(np.diff(x))
    a = x[:int(0.05*SR)]; b = x[-int(0.05*SR):]
    jump_start = float(np.abs(x[:3]).max()/pk)
    jump_end = float(np.abs(x[-3:]).max()/pk)
    tail = dsp.db(dsp.rms(x[-int(0.15*SR):])/pk)
    L = dsp.loud(x)
    f, r = ring_peaks(x)
    return dict(file=os.path.basename(path), dur=round(len(x)/SR, 2), lead_ms=round(lead, 1), pk=round(dsp.db(pk), 1), TP=L['TP'], M=L['Mmax'], I=L['I'], dc=round(float(x.mean()), 5),
                start_amp=round(jump_start, 4), end_amp=round(jump_end, 5), tail_db=round(tail, 1), clip=int((np.abs(x) >= 0.999).sum()), ring_hz=int(f), ring_ratio=round(r, 1), bands=octave_bands(x))
if __name__ == "__main__":
    files = sys.argv[1:] or sorted(glob.glob('out/*.mp3'))
    print("bands: 20-40,40-80,80-160,160-320,320-640,640-1.3k,1.3-2.6k,2.6-5k,5-10k,10-20k (dB rel total, first 500 ms)")
    for p in files:
        r = qa(p)
        print(f"{r['file']:20s} dur={r['dur']:5.2f} lead={r['lead_ms']:5.1f}ms pk={r['pk']:5.1f} TP={r['TP']} M={r['M']} I={r['I']} dc={r['dc']} start={r['start_amp']} end={r['end_amp']} tail={r['tail_db']} clip={r['clip']} ring={r['ring_hz']}Hz x{r['ring_ratio']}\n      bands={r['bands']}")
