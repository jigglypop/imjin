import { useEffect, useState, type ReactNode } from 'react';
import type { BuildingKind, FactionId, Owner, Resources, ShipClass } from './types';

export const FACTION_INFO: Record<FactionId, { name: string; hanja: string; color: string }> = {
  joseon: { name: '조선', hanja: '朝', color: '#2f6db5' },
  japan: { name: '일본', hanja: '日', color: '#c9433b' },
  ming: { name: '명', hanja: '明', color: '#9c700f' },
};

export const ownerName = (o: Owner) => (o ? FACTION_INFO[o].name : '중립');

export const BUILDINGS: Record<BuildingKind, { name: string; glyph: string; desc: string }> = {
  camp: { name: '군영', glyph: '營', desc: '유지비 면제 · 빠른 수리 · 수비대 증원' },
  shipyard: { name: '선소', glyph: '船', desc: '전선을 건조한다. 등급이 오르면 한 번에 짓는 배가 늘고 값이 싸진다' },
  battery: { name: '포대', glyph: '砲', desc: '적이 쳐들어오면 먼저 포격한다. 전투에도 지어진 채 나타난다' },
  dock: { name: '수리소', glyph: '修', desc: '머문 배의 선체와 병력을 빨리 회복' },
  granary: { name: '창고', glyph: '倉', desc: '수입 +25% (등급마다) · 전투에서는 화약고' },
  beacon: { name: '봉수대', glyph: '烽', desc: '두 칸 앞까지 적 함대를 알아본다 · 수입 +5%' },
};

export const SHIP_NAME: Record<ShipClass, string> = {
  panokseon: '판옥선',
  geobukseon: '거북선',
  hyeopseon: '협선',
  atakebune: '아타케부네',
  sekibune: '세키부네',
  kobaya: '고바야',
  mingship: '명 복선',
  mingsmall: '명 사선',
};

export const goldText = (gold: number) => `${gold.toLocaleString('ko-KR')}냥`;

export function costText(cost: Partial<Resources>) {
  return cost.gold ? goldText(cost.gold) : '';
}

export const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export function Bar({ value, tone = 'accent', label }: { value: number; tone?: 'accent' | 'good' | 'warn' | 'bad'; label?: string }) {
  const v = Math.max(0, Math.min(1, value));
  const auto = tone === 'accent' ? (v < 0.3 ? 'bad' : v < 0.6 ? 'warn' : 'good') : tone;
  return (
    <span className="gk-bar" role="img" aria-label={label ?? `${Math.round(v * 100)}%`}>
      <span className={`gk-bar__fill gk-bar__fill--${auto}`} style={{ width: `${v * 100}%` }} />
    </span>
  );
}

export function FactionSeal({ faction, size = 'md' }: { faction: FactionId; size?: 'sm' | 'md' | 'lg' }) {
  const f = FACTION_INFO[faction];
  return (
    <span className={`gk-seal gk-seal--${size}`} style={{ background: f.color }} aria-hidden>
      {f.hanja}
    </span>
  );
}

export function Chip({ children, tone }: { children: ReactNode; tone?: 'accent' | 'warn' }) {
  return <span className={`gk-chip${tone ? ` gk-chip--${tone}` : ''}`}>{children}</span>;
}

export function Stat({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`gk-stat${wide ? ' gk-stat--wide' : ''}`}>
      <span className="gk-stat__label">{label}</span>
      <span className="gk-stat__value">{children}</span>
    </div>
  );
}

/**
 * Panel container: a bottom sheet in portrait, a side panel in landscape and on desktop (see grand.css). The handle
 * toggles between the default and the tall sheet; the panels never block the map's top bar.
 */
export function Sheet({
  title,
  eyebrow,
  onClose,
  children,
  footer,
  tone,
  className = '',
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  tone?: Owner;
  className?: string;
}) {
  const [tall, setTall] = useState(false);
  return (
    <section
      className={`g-glass g-sheet${tall ? ' g-sheet--tall' : ''} ${className}`}
      style={tone ? { ['--tone' as string]: FACTION_INFO[tone].color } : undefined}
    >
      <button type="button" className="g-sheet__handle" aria-label={tall ? '패널 줄이기' : '패널 늘리기'} onClick={() => setTall((t) => !t)} />
      <header className="g-sheet__head">
        <div className="g-sheet__titles">
          {eyebrow && <div className="g-sheet__eyebrow">{eyebrow}</div>}
          <h2 className="g-sheet__title">{title}</h2>
        </div>
        {onClose && (
          <button type="button" className="g-icon-btn" aria-label="닫기" onClick={onClose}>
            ×
          </button>
        )}
      </header>
      <div className="g-sheet__body">{children}</div>
      {footer && <footer className="g-sheet__foot">{footer}</footer>}
    </section>
  );
}

/** A centred dialog on desktop and landscape, a bottom sheet in portrait: the same frame as the battle preview. */
export function Modal({ title, eyebrow, label, onClose, children, footer, tone }: { title: ReactNode; eyebrow?: ReactNode; label: string; onClose?: () => void; children: ReactNode; footer?: ReactNode; tone?: Owner }) {
  return (
    <div className="g-scrim" role="presentation" onClick={onClose}>
      <section
        className="g-glass g-modal"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={tone ? { ['--tone' as string]: FACTION_INFO[tone].color } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="g-sheet__handle g-sheet__handle--static" aria-hidden />
        <header className="g-sheet__head">
          <div className="g-sheet__titles">
            {eyebrow && <div className="g-sheet__eyebrow">{eyebrow}</div>}
            <h2 className="g-sheet__title">{title}</h2>
          </div>
          {onClose && (
            <button type="button" className="g-icon-btn" aria-label="닫기" onClick={onClose}>
              ×
            </button>
          )}
        </header>
        <div className="g-sheet__body">{children}</div>
        {footer && <footer className="g-sheet__foot">{footer}</footer>}
      </section>
    </div>
  );
}

/** Portrait phone layout: panels are bottom sheets. Mirrors the media query in grand.css. */
export const PORTRAIT_QUERY = '(orientation: portrait) and (max-width: 820px)';

export function usePortraitSheets() {
  const [portrait, setPortrait] = useState(() => matchMedia(PORTRAIT_QUERY).matches);
  useEffect(() => {
    const mq = matchMedia(PORTRAIT_QUERY);
    const sync = () => setPortrait(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return portrait;
}

/**
 * Space the panels take on top of the map, so the map can centre a selection in what is left. Matches the CSS: a bottom
 * sheet of about half the screen in portrait, a side panel of clamp(300px, 34vw, 380px) otherwise.
 */
function safeAreaTop() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top)';
  document.body.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return px;
}

export function useMapInsets(panelOpen: boolean) {
  const portrait = usePortraitSheets();
  const [safeTop] = useState(safeAreaTop);
  const [size, setSize] = useState(() => ({ w: innerWidth, h: innerHeight }));
  useEffect(() => {
    const on = () => setSize({ w: innerWidth, h: innerHeight });
    addEventListener('resize', on);
    return () => removeEventListener('resize', on);
  }, []);
  const top = (portrait ? 112 : size.h <= 540 ? 56 : 68) + Math.max(0, safeTop - 12);
  if (!panelOpen) return { top, right: 0, bottom: 0, left: 0 };
  if (portrait) return { top, right: 0, bottom: Math.round(size.h * 0.5), left: 0 };
  return { top, right: Math.round(Math.min(380, Math.max(300, size.w * 0.34)) + 16), bottom: 0, left: 0 };
}
