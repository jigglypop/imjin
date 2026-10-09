import { useEffect, useMemo, useRef, useState } from 'react';
import { FACTION_INFO, FactionSeal } from './shared';
import type { FactionId, ReplayView, SpotView } from './types';

/**
 * The turn that just closed, played back on the strategic map: fleet tokens slide along their sea lanes with a trailing
 * arrow, a clash icon pops where fleets met, and a port that changed hands pulses in its new owner's colour. It lasts
 * one to three seconds, a tap or Space/Enter/Esc skips it, and with reduced motion the tokens do not slide: the arrows
 * and icons simply show for a moment.
 */

export interface ReplayLayerProps {
  replay: ReplayView;
  /** Screen position of a region's node (the map's current pan and zoom). */
  at: (regionId: string) => { x: number; y: number } | null;
  /** Top of the free map area, so the caption stays clear of the top bar. */
  top: number;
  reduced: boolean;
  /** Fired once when the clashes appear and the ports change hands, so the map can recolour them. */
  onPhase: (phase: 'sail' | 'clash') => void;
  /** A clash or capture shows: the screen plays its sound. */
  onBeat: (kind: 'clash' | 'capture') => void;
  onDone: () => void;
}

/** Where the sailing ends and the clashes begin, as shares of the whole. */
const SAIL_END = 0.62;
const CLASH_AT = 0.6;
const CHANGE_AT = 0.72;
const HOLD = 0.3;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Seconds the replay runs: a second and a bit, a little more for every fleet that moves, never over three. */
export function replayLength(replay: ReplayView, reduced: boolean) {
  if (reduced) return 1.4;
  return Math.min(3, Math.max(1.5, 1.2 + 0.28 * replay.moves.length));
}

type Pt = { x: number; y: number };

function resolve(spot: SpotView, at: (id: string) => Pt | null): Pt | null {
  const a = at(spot.at);
  if (!a) return null;
  if (!spot.to || !spot.t) return a;
  const b = at(spot.to);
  return b ? { x: a.x + (b.x - a.x) * spot.t, y: a.y + (b.y - a.y) * spot.t } : a;
}

/** The part of a polyline up to share `u` of its length, and the point where it ends. */
function along(points: Pt[], u: number): { upTo: Pt[]; head: Pt; angle: number } {
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const d = Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
    lens.push(d);
    total += d;
  }
  let left = total * u;
  const upTo: Pt[] = [points[0]!];
  let head = points[0]!;
  let angle = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = lens[i - 1]!;
    angle = Math.atan2(b.y - a.y, b.x - a.x);
    if (left >= d || d === 0) {
      upTo.push(b);
      head = b;
      left -= d;
    } else {
      head = { x: a.x + ((b.x - a.x) * left) / d, y: a.y + ((b.y - a.y) * left) / d };
      upTo.push(head);
      break;
    }
  }
  return { upTo, head, angle };
}

export function ReplayLayer({ replay, at, top, reduced, onPhase, onBeat, onDone }: ReplayLayerProps) {
  const [p, setP] = useState(0);
  const length = replayLength(replay, reduced);
  const fired = useRef({ clash: false, change: false, done: false });
  const cb = useRef({ onPhase, onBeat, onDone });
  cb.current = { onPhase, onBeat, onDone };

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = (now - t0) / 1000 / length;
      setP(Math.min(1.2, t));
      if (t >= 1 + HOLD / length) {
        if (!fired.current.done) {
          fired.current.done = true;
          cb.current.onDone();
        }
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [length]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        if (!fired.current.done) {
          fired.current.done = true;
          cb.current.onDone();
        }
      }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);

  // The beats fire once each as the clock passes them.
  useEffect(() => {
    const f = fired.current;
    if (!f.clash && p >= CLASH_AT) {
      f.clash = true;
      cb.current.onPhase('clash');
      if (replay.clashes.length) cb.current.onBeat('clash');
    }
    if (!f.change && p >= CHANGE_AT) {
      f.change = true;
      if (replay.changes.length) cb.current.onBeat('capture');
    }
  }, [p, replay]);

  const sail = reduced ? 1 : ease(clamp01(p / SAIL_END));
  const routes = useMemo(
    () =>
      replay.moves.flatMap((m) => {
        const pts = m.path.map((s) => resolve(s, at)).filter((x): x is Pt => !!x);
        return pts.length >= 2 ? [{ move: m, pts }] : [];
      }),
    [replay, at],
  );

  return (
    <div
      className="gm-replay"
      role="presentation"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (!fired.current.done) {
          fired.current.done = true;
          cb.current.onDone();
        }
      }}
    >
      <svg className="gm-replay__svg" aria-hidden>
        <defs>
          {(Object.keys(FACTION_INFO) as FactionId[]).map((id) => (
            <marker key={id} id={`gr-head-${id}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto">
              <path d="M0 0 L10 5 L0 10 z" fill={FACTION_INFO[id].color} />
            </marker>
          ))}
        </defs>
        {routes.map(({ move, pts }) => {
          const { upTo } = along(pts, sail);
          if (upTo.length < 2) return null;
          const d = upTo.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' ');
          return (
            <g key={move.id} style={{ opacity: move.lost ? 1 - clamp01((p - 0.85) / 0.15) : 1 }}>
              <path d={d} className="gm-replay__halo" />
              <path d={d} className="gm-replay__line" stroke={FACTION_INFO[move.faction].color} markerEnd={`url(#gr-head-${move.faction})`} />
            </g>
          );
        })}
        {p >= CHANGE_AT &&
          replay.changes.map((c) => {
            const pos = at(c.regionId);
            return pos ? <circle key={c.regionId} className="gm-replay__ring" cx={pos.x} cy={pos.y} r={26} style={{ stroke: FACTION_INFO[c.to].color }} /> : null;
          })}
      </svg>
      {routes.map(({ move, pts }) => {
        const { head } = along(pts, sail);
        const fade = move.lost ? 1 - clamp01((p - 0.85) / 0.15) : 1;
        return (
          <div key={move.id} className="gm-rtoken" style={{ transform: `translate3d(${head.x}px, ${head.y}px, 0)`, opacity: fade, ['--c' as string]: FACTION_INFO[move.faction].color }}>
            <span className="gm-fleet__pill">
              <span className="gm-fleet__flag">{FACTION_INFO[move.faction].hanja}</span>
              <b>{move.ships}</b>
            </span>
          </div>
        );
      })}
      {p >= CLASH_AT &&
        replay.clashes.map((c) => {
          const pos = at(c.regionId);
          return pos ? (
            <div key={c.regionId} className="gm-clash" style={{ transform: `translate3d(${pos.x}px, ${pos.y - 4}px, 0)` }}>
              <span className="gm-clash__icon" title="해전">
                ⚔
              </span>
            </div>
          ) : null;
        })}
      {p >= CHANGE_AT &&
        replay.changes.map((c) => {
          const pos = at(c.regionId);
          return pos ? (
            <div key={c.regionId} className="gm-flip" style={{ transform: `translate3d(${pos.x}px, ${pos.y + 30}px, 0)` }}>
              <span className="gm-flip__chip">
                <FactionSeal faction={c.to} size="sm" />
                {c.from ? `${FACTION_INFO[c.from].name} → ${FACTION_INFO[c.to].name}` : `${FACTION_INFO[c.to].name} 차지`}
              </span>
            </div>
          ) : null;
        })}
      <div className="g-glass gm-replay__caption" style={{ top }}>
        <b>지난 석 달의 움직임</b>
        <span>탭하거나 Space를 눌러 건너뛰기</span>
      </div>
    </div>
  );
}
