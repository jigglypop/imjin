import { useEffect, useState, type ReactNode } from 'react';
import type { BuildingKind, FactionId, Owner, Resources, ShipClass } from './types';

/** The three navies as small tonal accents: the muted tones the CSS tokens carry, and the crest of each. */
export const FACTION_INFO: Record<FactionId, { name: string; navy: string; color: string; soft: string; crest: string }> = {
  joseon: { name: '조선', navy: '조선 수군', color: '#46637a', soft: '#e4eaef', crest: 'joseon' },
  japan: { name: '일본', navy: '일본 수군', color: '#6b4a40', soft: '#ede6e3', crest: 'japan' },
  ming: { name: '명', navy: '명 수군', color: '#8c7040', soft: '#efe9dd', crest: 'ming' },
};

export const ownerName = (o: Owner) => (o ? FACTION_INFO[o].name : '중립');
export const navyName = (o: Owner) => (o ? FACTION_INFO[o].navy : '중립');

const ICONS = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M15 6l-6 6 6 6',
  chev: 'M9 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  coin: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM9.5 9.5h5v5h-5z',
  ship: 'M12 3.5v11M12 5l5.5 8H12M3.5 15h17l-2.5 4.5H6z',
  sail: 'M5 12h13M13 6.5l5.5 5.5-5.5 5.5',
  swords: 'M5 5l9 9M5 5v4.5M5 5h4.5M19 5l-9 9M19 5v4.5M19 5h-4.5M8.5 15.5L6 18M15.5 15.5L18 18',
  camp: 'M6.5 21V4M6.5 5h11l-3 3.5 3 3.5h-11',
  shipyard: 'M3 20h18M5 15.5h14l-2 4H7zM12 15.5V6M12 7l5 6',
  battery: 'M5 20V9h3V6.5h2V9h4V6.5h2V9h3v11zM10 20v-5h4v5',
  dock: 'M14.5 6.5a4 4 0 0 0 5 5L9.5 21.5a2.1 2.1 0 0 1-3-3l10-10.5-2-2 3.3-3.3a4 4 0 0 0-3.3 3.3',
  granary: 'M3.5 10L12 4l8.5 6M5.5 9.5V20h13V9.5M9.5 20v-6h5v6',
  beacon: 'M12 3c1.6 2.6 4.2 4.4 4.2 8a4.2 4.2 0 0 1-8.4 0c0-2 .9-3.1 1.8-4.3M7.5 21h9M9.5 15.5L8.5 21M14.5 15.5l1 5.5',
  flag: 'M6.5 21V4M6.5 5h11l-3 3.5 3 3.5h-11',
  portal: 'M7 17L17 7M9 7h8v8',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
} as const;

export type IconName = keyof typeof ICONS;

/** A monoline icon: 1.75 px stroke, round caps, drawn in the colour of the text around it (see .g-ico). */
export function Icon({ name, size }: { name: IconName; size?: 'sm' | 'lg' }) {
  return (
    <svg className={`g-ico${size ? ` g-ico--${size}` : ''}`} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d={ICONS[name]} />
    </svg>
  );
}

export const BUILDINGS: Record<BuildingKind, { name: string; icon: IconName; desc: string }> = {
  camp: { name: '군영', icon: 'camp', desc: '유지비가 들지 않고 수리가 빠릅니다. 수비대가 늘어납니다.' },
  shipyard: { name: '선소', icon: 'shipyard', desc: '함선을 건조합니다. 단계가 오르면 동시에 지을 수 있는 수가 늘고 값이 내려갑니다.' },
  battery: { name: '포대', icon: 'battery', desc: '적이 공격해 오면 먼저 포격합니다. 전투에도 그대로 배치됩니다.' },
  dock: { name: '수리소', icon: 'dock', desc: '머무는 함선의 선체와 승조원을 빠르게 회복합니다.' },
  granary: { name: '창고', icon: 'granary', desc: '단계마다 수입이 25% 늘고, 전투에서는 화약고가 됩니다.' },
  beacon: { name: '봉수대', icon: 'beacon', desc: '두 칸 앞까지 적 함대를 볼 수 있고 수입이 5% 늘어납니다.' },
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

export function Bar({ value, tone = 'accent', label }: { value: number; tone?: 'accent' | 'good' | 'warn' | 'bad' | 'tone'; label?: string }) {
  const v = Math.max(0, Math.min(1, value));
  const auto = tone === 'accent' ? (v < 0.3 ? 'bad' : v < 0.6 ? 'warn' : 'good') : tone;
  return (
    <span className="gk-bar" role="img" aria-label={label ?? `${Math.round(v * 100)}%`}>
      <span className={`gk-bar__fill gk-bar__fill--${auto}`} style={{ width: `${v * 100}%` }} />
    </span>
  );
}

/** A faction's identity in a row or a header: a 3 px bar in its tone. */
export function FactionMark({ faction, size = 'sm' }: { faction: FactionId | null; size?: 'sm' | 'md' }) {
  return <span className={`gk-mark gk-mark--${size}${faction ? '' : ' gk-mark--none'}`} style={faction ? { ['--c' as string]: FACTION_INFO[faction].color } : undefined} aria-hidden />;
}

/** The faction's crest, for the few places that are big enough to show it. */
export function FactionCrest({ faction, size, className = '' }: { faction: FactionId; size: number; className?: string }) {
  const f = FACTION_INFO[faction];
  return <img className={`gk-crest ${className}`} src={`/ui/art/emblem_${f.crest}_sm.webp`} width={size} height={size} alt="" draggable={false} />;
}

/** The inline style that gives a subtree its faction's tone. */
export const toneStyle = (o: Owner) => (o ? { ['--tone' as string]: FACTION_INFO[o].color, ['--tone-soft' as string]: FACTION_INFO[o].soft } : undefined);

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
      style={toneStyle(tone ?? null)}
    >
      <button type="button" className="g-sheet__handle" aria-label={tall ? '패널 줄이기' : '패널 늘리기'} onClick={() => setTall((t) => !t)} />
      <header className="g-sheet__head">
        <div className="g-sheet__titles">
          {eyebrow && <div className="g-sheet__eyebrow">{eyebrow}</div>}
          <h2 className="g-sheet__title">{title}</h2>
        </div>
        {onClose && (
          <button type="button" className="g-icon-btn" aria-label="닫기" onClick={onClose}>
            <Icon name="close" />
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
        style={toneStyle(tone ?? null)}
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
              <Icon name="close" />
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
