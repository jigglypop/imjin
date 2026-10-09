import { useEffect, useState, type ReactNode } from 'react';
import type { BuildingKind, FactionId, Owner, ResourceKind, Resources, ShipClass } from './types';

export const FACTION_INFO: Record<FactionId, { name: string; hanja: string; color: string }> = {
  joseon: { name: '조선', hanja: '朝', color: '#2f6db5' },
  japan: { name: '일본', hanja: '日', color: '#c9433b' },
  ming: { name: '명', hanja: '明', color: '#c4952a' },
};

export const ownerName = (o: Owner) => (o ? FACTION_INFO[o].name : '중립');

export const RESOURCES: { kind: ResourceKind; name: string; glyph: string }[] = [
  { kind: 'gold', name: '금', glyph: '金' },
  { kind: 'wood', name: '목재', glyph: '木' },
  { kind: 'powder', name: '화약', glyph: '火' },
  { kind: 'food', name: '군량', glyph: '糧' },
];

export const BUILDINGS: Record<BuildingKind, { name: string; glyph: string; desc: string }> = {
  barracks: { name: '군영', glyph: '營', desc: '수비병 증원, 병사 모집' },
  shipyard: { name: '선소', glyph: '船', desc: '함선 건조, 상위 함선 해금' },
  battery: { name: '포대', glyph: '砲', desc: '방어전 화력 보너스' },
  repair: { name: '수리소', glyph: '修', desc: '주둔 함대 선체 회복' },
  storehouse: { name: '창고', glyph: '倉', desc: '수입 증가, 군량 보관' },
  beacon: { name: '봉수대', glyph: '烽', desc: '인접 해역 시야, 기습 경보' },
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

export function costText(cost: Partial<Resources>) {
  return RESOURCES.filter((r) => cost[r.kind])
    .map((r) => `${r.name} ${cost[r.kind]}`)
    .join(' · ');
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
