import { useLayoutEffect, useState, type CSSProperties } from 'react';
import { SCENARIOS, type ScenarioId } from '../sim/scenarios';
import { useT } from '../i18n';
import { mapOf, shortTitle, siteUV } from './siteMap';

// Pins close enough that their labels would collide: these put the label on the pin's left.
const LABEL_LEFT = new Set<ScenarioId>(['dangpo', 'lepanto-north', 'trafalgar-weather']);
// A third pin on the same spot: its label hangs below.
const LABEL_DOWN = new Set<ScenarioId>(['lepanto-south']);
/** Narrowest map (px) whose labels still read apart; a chapter that only fits smaller pans to the chosen battle instead. */
const MIN_FIT = 700;
/** Widest the map is drawn when it fits: past this its relief turns to blur. */
const MAX_FIT = 2600;
/** Room kept round the pins: a pin's label runs about 90 px to its right. */
const PAD = { left: 40, right: 120, top: 16, bottom: 16 };

/** How the plane is laid: its width, the screen point (px) the focus lands on, and which pins' box is the focus. */
type Frame = { mw: number | null; fx: number; fy: number; u: 'all' | 'one'; v: 'all' | 'one' };

/**
 * Where the map can show: the screen less the tab row and the brief card. The card sits along the bottom on wide and
 * portrait screens and down the right on landscape phones (menu.css), so the open part is above it or left of it.
 */
function openArea() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const top = (document.querySelector('.hs-top')?.getBoundingClientRect().bottom ?? 120) + 8;
  const brief = document.querySelector('.hs-brief')?.getBoundingClientRect();
  if (brief && brief.left > w * 0.4) return { left: 0, top, right: brief.left - 8, bottom: h };
  return { left: 0, top, right: w, bottom: Math.max(top + 40, brief ? brief.top - 8 : h) };
}

/**
 * Every battle of the chapter in the open part of the screen when they fit; else every one across and the chosen one's
 * latitude (a short screen such as 1366x768 under its brief); else, on a phone, the plane pans to the chosen site.
 * The map is never drawn narrower than MIN_FIT, so the labels keep apart.
 */
function frameOf(order: readonly ScenarioId[], aspect: number): Frame {
  const uv = order.map(siteUV);
  const du = Math.max(...uv.map((p) => p.u)) - Math.min(...uv.map((p) => p.u));
  const dv = Math.max(...uv.map((p) => p.v)) - Math.min(...uv.map((p) => p.v));
  const a = openArea();
  const aw = a.right - a.left - PAD.left - PAD.right;
  const ah = a.bottom - a.top - PAD.top - PAD.bottom;
  const fx = a.left + PAD.left + aw / 2;
  const fy = a.top + PAD.top + Math.max(0, ah) / 2;
  const across = Math.min(MAX_FIT, aw / Math.max(du, 0.02));
  const both = Math.min(across, ah / Math.max(dv * aspect, 0.02));
  if (both >= MIN_FIT) return { mw: both, fx, fy, u: 'all', v: 'all' };
  if (across >= MIN_FIT) return { mw: across, fx, fy, u: 'all', v: 'one' };
  return { mw: null, fx, fy, u: 'one', v: 'one' };
}

/** The select map for phones and the later chapters: one flat image, no 3D renderer, framed on the chapter's battles. */
export function StaticMap({ id, order, onSelect }: { id: ScenarioId; order: readonly ScenarioId[]; onSelect: (id: ScenarioId) => void }) {
  const t = useT();
  const { image, meta } = mapOf(id);
  const aspect = meta.height / meta.width;
  const [frame, setFrame] = useState<Frame | null>(null);
  useLayoutEffect(() => {
    const measure = () => setFrame(frameOf(order, aspect));
    measure();
    const watch = new ResizeObserver(measure);
    const brief = document.querySelector('.hs-brief');
    if (brief) watch.observe(brief);
    window.addEventListener('resize', measure);
    return () => {
      watch.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [order, aspect, id]);
  const uv = order.map(siteUV);
  const mid = (k: 'u' | 'v') => (Math.min(...uv.map((p) => p[k])) + Math.max(...uv.map((p) => p[k]))) / 2;
  const one = siteUV(id);
  const style = {
    '--u': frame?.u === 'all' ? mid('u') : one.u,
    '--v': frame?.v === 'all' ? mid('v') : one.v,
    '--ma': aspect,
    ...(frame ? { '--fx': `${frame.fx}px`, '--fy': `${frame.fy}px` } : {}),
    ...(frame?.mw ? { '--mw': `${frame.mw}px` } : {}),
  } as CSSProperties;
  return (
    <div className="smap" style={style}>
      <div className="smap-plane">
        <img src={image} alt="" decoding="async" />
        {order.map((sid) => {
          const { u, v } = siteUV(sid);
          return (
            <button
              key={sid}
              className={`marker ${sid === id ? 'marker--on' : ''} ${SCENARIOS[sid].night ? 'marker--night' : ''} ${LABEL_LEFT.has(sid) ? 'marker--left' : ''} ${LABEL_DOWN.has(sid) ? 'marker--down' : ''}`}
              style={{ '--mu': u, '--mv': v } as CSSProperties}
              onClick={() => onSelect(sid)}
            >
              <i />
              <span>{shortTitle(t(SCENARIOS[sid].title))}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
