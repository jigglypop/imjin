import { useEffect, useRef, type CSSProperties } from 'react';
import type { Engine } from '../game/Engine';
import type { TheatreSetup } from '../game/theatre';
import { useT } from '../i18n';

// The faction campaign's theatre in the battle's 3D: a name on every port, which picks it on the campaign map, and the
// way back. The names follow the engine's camera every frame.

const OWN = 'rgba(70, 120, 200, 0.85)';
const FOE = 'rgba(190, 70, 60, 0.85)';
const NONE = 'rgba(120, 120, 120, 0.7)';

const LAYER: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' };
const LABEL: CSSProperties = {
  position: 'absolute', left: 0, top: 0, pointerEvents: 'auto', cursor: 'pointer', whiteSpace: 'nowrap',
  padding: '3px 9px', borderRadius: 999, fontSize: 13, color: '#f4f1ea', background: 'rgba(16, 20, 28, 0.55)',
  backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.18)', willChange: 'transform',
};
const BACK: CSSProperties = {
  position: 'absolute', top: 16, left: 16, pointerEvents: 'auto', padding: '8px 16px', borderRadius: 12, fontSize: 14,
  color: '#f4f1ea', background: 'rgba(16, 20, 28, 0.6)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer',
};

export function TheatreOverlay({ engine, setup, onBack }: { engine: Engine; setup: TheatreSetup; onBack: () => void }) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const el = root.current;
      if (!el) return;
      const on = engine.ready && engine.theatre === setup;
      el.style.display = on ? '' : 'none';
      if (!on) return;
      const w = el.clientWidth, h = el.clientHeight;
      setup.ports.forEach((p, i) => {
        const label = el.children[i + 1] as HTMLElement | undefined;
        if (!label) return;
        const s = engine.theatreScreen(p.lon, p.lat, w, h);
        if (!s || s.x < -100 || s.y < -40 || s.x > w + 100 || s.y > h + 40) {
          label.style.display = 'none';
          return;
        }
        label.style.display = '';
        label.style.transform = `translate(${(s.x - label.offsetWidth / 2).toFixed(1)}px, ${(s.y - label.offsetHeight).toFixed(1)}px)`;
      });
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [engine, setup]);
  return (
    <div ref={root} style={LAYER} className="theatre-overlay">
      <button type="button" style={BACK} onClick={onBack}>{t('전략 지도로')}</button>
      {setup.ports.map((p) => (
        <button
          type="button"
          key={p.id}
          data-region={p.id}
          style={{ ...LABEL, borderColor: !p.owner ? NONE : p.owner === setup.me ? OWN : setup.foes.includes(p.owner) ? FOE : NONE }}
          onClick={() => {
            setup.onPick?.(p.id);
            onBack();
          }}
        >
          {t(p.name)}
        </button>
      ))}
      {/* After the labels: they are found by index (children[i + 1]). */}
      {setup.onEndTurn && (
        <button
          type="button"
          style={{ ...BACK, left: 'auto', right: 16 }}
          onClick={() => {
            setup.onEndTurn!();
            onBack();
          }}
        >
          {t('턴 종료')}
        </button>
      )}
    </div>
  );
}
