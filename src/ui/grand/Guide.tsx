import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';

/**
 * The first-turn guide of a new campaign: four short steps, each pointing at the real control it is about (a ring
 * around it, the card beside it). The screen decides which step is current and when the player's own action moves it
 * on; this draws it and measures where the control is. Dismissing it, or reaching its end, is stored as seen.
 */

export interface GuideStepView {
  title: string;
  text: string;
  /** CSS selector of the control the step is about; none leaves the card at the top of the screen. */
  target?: string;
}

export interface GuideProps {
  step: number;
  steps: GuideStepView[];
  /** The player does not want to do this step: go to the next one. */
  onNext: () => void;
  /** Closes the guide for good. */
  onClose: () => void;
}

type Box = { left: number; top: number; width: number; height: number };

/** What the guide points at: the box to ring, and the box the card must stay clear of. */
type Spot = { ring: Box; avoid: Box };

const GAP = 12;
const MARGIN = 12;
/** A map node keeps its label, its fleet badges and its neighbours' touch targets around it: the card stays this far off. */
const NODE_ROOM = 64;

const fromRect = (r: DOMRect): Box => ({ left: r.left, top: r.top, width: r.width, height: r.height });
const inflate = (b: Box, by: number): Box => ({ left: b.left - by, top: b.top - by, width: b.width + 2 * by, height: b.height + 2 * by });

function intersect(a: Box, b: Box): Box | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right - left < 2 || bottom - top < 2 ? null : { left, top, width: right - left, height: bottom - top };
}

const overlapArea = (a: Box, b: Box) => {
  const o = intersect(a, b);
  return o ? o.width * o.height : 0;
};

/**
 * Where the control is on screen now, or null when it is not drawn. The ring follows the control but never leaves what
 * is visible of it (a long list inside a scrolling sheet is ringed only where it shows). The card keeps clear of the
 * whole panel a control sits in, and of a map node's label and badges.
 */
function measure(selector?: string): Spot | null {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const view: Box = { left: 0, top: 0, width: innerWidth, height: innerHeight };
  let ring = intersect(fromRect(el.getBoundingClientRect()), view);
  const scroller = el.closest('.g-sheet__body');
  if (ring && scroller) ring = intersect(ring, fromRect(scroller.getBoundingClientRect()));
  if (!ring) return null;
  const panel = el.closest('.g-sheet, .g-modal');
  const avoid = panel ? (intersect(fromRect(panel.getBoundingClientRect()), view) ?? ring) : inflate(ring, el.closest('.gm-node') ? NODE_ROOM : GAP);
  return { ring, avoid };
}

/**
 * The spot for the card: beside the thing it points at, never on top of it. Spots around the avoided box come first;
 * then the corners of the screen; when nothing is clear the one that covers the least wins.
 */
function place(spot: Spot | null, card: { w: number; h: number }, top: number): { left: number; top: number; clear: boolean } {
  const vw = innerWidth;
  const vh = innerHeight;
  const centred = { left: Math.round((vw - card.w) / 2), top, clear: true };
  if (!spot) return centred;
  const { ring, avoid } = spot;
  const clampX = (x: number) => Math.max(MARGIN, Math.min(vw - card.w - MARGIN, x));
  const clampY = (y: number) => Math.max(top, Math.min(vh - card.h - MARGIN, y));
  const midX = clampX(ring.left + ring.width / 2 - card.w / 2);
  const midY = clampY(ring.top + ring.height / 2 - card.h / 2);
  const below = { left: midX, top: avoid.top + avoid.height + GAP };
  const above = { left: midX, top: avoid.top - card.h - GAP };
  const left = { left: avoid.left - card.w - GAP, top: midY };
  const right = { left: avoid.left + avoid.width + GAP, top: midY };
  const corners = [
    { left: MARGIN, top },
    { left: vw - card.w - MARGIN, top },
    { left: MARGIN, top: vh - card.h - MARGIN },
    { left: vw - card.w - MARGIN, top: vh - card.h - MARGIN },
  ];
  // A control on the right half is usually in the side panel: the map to its left is the free space.
  const around = ring.left > vw / 2 ? [left, above, below, right] : [below, above, right, left];
  const fits = (p: { left: number; top: number }) => p.left >= MARGIN && p.top >= top && p.left + card.w <= vw - MARGIN && p.top + card.h <= vh - MARGIN;
  const covers = (p: { left: number; top: number }) => overlapArea({ ...p, width: card.w, height: card.h }, avoid);
  const options = [...around, ...corners].filter(fits);
  const clear = options.find((p) => covers(p) === 0);
  if (clear) return { ...clear, clear: true };
  const least = options.sort((a, b) => covers(a) - covers(b))[0];
  return least ? { ...least, clear: false } : { ...centred, clear: false };
}

export function Guide({ step, steps, onNext, onClose }: GuideProps) {
  const t = useT();
  const current = steps[step];
  const cardRef = useRef<HTMLElement>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [size, setSize] = useState({ w: 300, h: 150 });
  // A narrower card when the wide one cannot stand clear of what it points at (a phone held sideways).
  const [narrow, setNarrow] = useState(false);

  // The control moves with the map and the panels, so it is measured a few times a second rather than once.
  useEffect(() => {
    const near = (a: Box, b: Box) => Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
    const read = () =>
      setSpot((old) => {
        const next = measure(current?.target);
        return old && next && near(old.ring, next.ring) && near(old.avoid, next.avoid) ? old : next;
      });
    read();
    const id = window.setInterval(read, 180);
    addEventListener('resize', read);
    return () => {
      window.clearInterval(id);
      removeEventListener('resize', read);
    };
  }, [current?.target]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (el) setSize((s) => (Math.abs(s.w - el.offsetWidth) < 1 && Math.abs(s.h - el.offsetHeight) < 1 ? s : { w: el.offsetWidth, h: el.offsetHeight }));
  });

  // Clear of the top bar, whatever height the screen gives it.
  const topSpace = Math.max(76, (document.querySelector('.g-top')?.getBoundingClientRect().bottom ?? 68) + 8);
  const at = place(spot, size, topSpace);
  useEffect(() => setNarrow(false), [current?.target]);
  useEffect(() => {
    if (!at.clear && !narrow) setNarrow(true);
  }, [at.clear, narrow]);
  if (!current) return null;
  return (
    <div className="g-guide" aria-live="polite">
      {spot && <span className="g-guide__ring" style={{ left: spot.ring.left - 6, top: spot.ring.top - 6, width: spot.ring.width + 12, height: spot.ring.height + 12 }} />}
      <section ref={cardRef} className="g-glass g-guide__card" role="dialog" aria-label={t('시작 안내')} style={{ left: at.left, top: at.top, ...(narrow ? { width: 236 } : null) }}>
        <div className="g-guide__dots" aria-label={t('{n} / {total}단계', { n: step + 1, total: steps.length })}>
          {steps.map((s, i) => (
            <i key={s.title} className={i === step ? 'on' : i < step ? 'done' : ''} />
          ))}
        </div>
        <h3 className="g-guide__title">{current.title}</h3>
        <p className="g-guide__text">{current.text}</p>
        <div className="g-guide__actions">
          <button type="button" className="g-btn g-btn--sm" onClick={onNext}>
            {step === steps.length - 1 ? t('마치기') : t('다음')}
          </button>
          <button type="button" className="g-btn g-btn--sm g-btn--ghost" onClick={onClose}>
            {t('건너뛰기')}
          </button>
        </div>
      </section>
    </div>
  );
}
