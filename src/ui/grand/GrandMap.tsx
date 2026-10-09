import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MAP_ASPECT, MAP_IMAGE, project } from './projection';
import { ReplayLayer } from './Replay';
import { FACTION_INFO, ownerName } from './shared';
import type { FactionId, FleetView, RegionView, ReplayView } from './types';

export interface MapInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface GrandMapProps {
  regions: RegionView[];
  fleets: FleetView[];
  /** The faction the player leads: its fleets get the full token, others only a count. */
  me: FactionId;
  selectedRegionId?: string | null;
  selectedFleetId?: string | null;
  /** Regions the selected fleet may sail to: highlighted and pulsing. */
  moveTargets?: string[];
  /** Screen space covered by panels; a focused region is centred in the rest. */
  insets?: MapInsets;
  /** Pans to this region when `nonce` changes. */
  focus?: { id: string; nonce: number } | null;
  onSelectRegion?: (id: string) => void;
  onSelectFleet?: (id: string) => void;
  onBackground?: () => void;
  /** The turn that just closed, played over the map until it ends or is skipped. */
  replay?: ReplayView | null;
  reducedMotion?: boolean;
  onReplayPhase?: (phase: 'sail' | 'clash') => void;
  onReplayBeat?: (kind: 'clash' | 'capture') => void;
  onReplayDone?: () => void;
}

interface View {
  /** Displayed width of the whole map image in px; the height follows from the aspect. */
  s: number;
  x: number;
  y: number;
}

const NO_INSETS: MapInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const MAX_ZOOM = 4.5;
const TAP_SLOP = 8;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function nodeRadius(r: RegionView) {
  return r.offMap ? 20 : 12 + r.value * 3.4;
}

/** Strategic map: image backdrop, sea lanes, region nodes, fleet tokens. Pan with a drag, zoom with wheel or pinch. */
export function GrandMap({
  regions,
  fleets,
  me,
  selectedRegionId,
  selectedFleetId,
  moveTargets,
  insets = NO_INSETS,
  focus,
  onSelectRegion,
  onSelectFleet,
  onBackground,
  replay,
  reducedMotion = false,
  onReplayPhase,
  onReplayBeat,
  onReplayDone,
}: GrandMapProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const boxRef = useRef(box);
  boxRef.current = box;
  const insetsRef = useRef(insets);
  insetsRef.current = insets;
  const ready = useRef(false);
  const touched = useRef(false);
  const anim = useRef(0);

  const byId = useMemo(() => new Map(regions.map((r) => [r.id, r])), [regions]);
  const pos = useMemo(() => new Map(regions.map((r) => [r.id, project(r.lon, r.lat)])), [regions]);

  const limits = useCallback(() => {
    const { w, h } = boxRef.current;
    const cover = Math.max(w, h * MAP_ASPECT);
    const contain = Math.min(w, h * MAP_ASPECT);
    return { min: contain * 0.92, max: cover * MAX_ZOOM, cover };
  }, []);

  const constrain = useCallback(
    (v: View): View => {
      const { w, h } = boxRef.current;
      const { min, max } = limits();
      const s = clamp(v.s, min, max);
      const mh = s / MAP_ASPECT;
      // The map may slide as far as the panels cover, so a port at the map's edge can still be centred in what they leave free.
      const ins = insetsRef.current;
      const slackX = w * 0.06;
      const slackY = h * 0.06;
      const lx = Math.min(w - s, (w - s) / 2) - slackX - ins.right;
      const hx = Math.max(0, (w - s) / 2) + slackX + ins.left;
      const ly = Math.min(h - mh, (h - mh) / 2) - slackY - ins.bottom;
      const hy = Math.max(0, (h - mh) / 2) + slackY + ins.top;
      return { s, x: clamp(v.x, lx, hx), y: clamp(v.y, ly, hy) };
    },
    [limits],
  );

  /** View that puts map point (u, v) at the centre of the area the panels leave free. */
  const centred = useCallback(
    (u: number, v: number, s: number): View => {
      const { w, h } = boxRef.current;
      const ins = insetsRef.current;
      const cx = ins.left + (w - ins.left - ins.right) / 2;
      const cy = ins.top + (h - ins.top - ins.bottom) / 2;
      return constrain({ s, x: cx - u * s, y: cy - (v * s) / MAP_ASPECT });
    },
    [constrain],
  );

  const flyTo = useCallback((target: View) => {
    touched.current = true;
    cancelAnimationFrame(anim.current);
    const from = viewRef.current;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = clamp((now - t0) / 380, 0, 1);
      const e = 1 - (1 - t) ** 3;
      setView({ s: from.s + (target.s - from.s) * e, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e });
      if (t < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }, []);

  // Size of the container; the first measurement lays out the opening view on the player's own coast.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Until the player moves the map, a size change (rotation, late layout) lays out the opening view again.
  useLayoutEffect(() => {
    if (box.w < 100 || box.h < 100) return;
    if (!touched.current) {
      ready.current = true;
      // Ming starts with ports off the map only: open on those (the limits keep them at the edge) rather than on a coast that is not theirs.
      const owned = regions.filter((r) => r.owner === me);
      const mine = owned.some((r) => !r.offMap) ? owned.filter((r) => !r.offMap) : owned;
      const pts = mine.map((r) => pos.get(r.id)!);
      const u = pts.length ? pts.reduce((a, p) => a + p.u, 0) / pts.length : 0.45;
      const v = pts.length ? pts.reduce((a, p) => a + p.v, 0) / pts.length : 0.4;
      setView(centred(u, v, limits().cover));
    } else {
      setView((cur) => constrain(cur));
    }
    // The opening view depends on the size only; later region updates must not re-centre it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box]);

  useEffect(() => {
    if (!focus || !ready.current) return;
    const p = pos.get(focus.id);
    if (!p) return;
    flyTo(centred(p.u, p.v, Math.max(viewRef.current.s, limits().cover)));
    // Only a new nonce re-centres; layout changes alone must not yank the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  useEffect(() => () => cancelAnimationFrame(anim.current), []);

  // Closing or opening a panel changes how far the map may slide: keep it inside the new limits.
  useEffect(() => {
    if (ready.current) setView((cur) => constrain(cur));
  }, [insets.top, insets.right, insets.bottom, insets.left, constrain]);

  // The camera follows the action: when what the replay shows lies partly off screen, the map pans (and zooms out a little) to take it in.
  useEffect(() => {
    if (!replay || !ready.current) return;
    // Meetings and captures first, then the player's own fleets, then everything that moved.
    const spots = (list: ReplayView['moves']) => list.flatMap((m) => m.path.flatMap((spot) => [spot.at, spot.to ?? spot.at]));
    const ids = new Set<string>([...replay.clashes.map((c) => c.regionId), ...replay.changes.map((c) => c.regionId)]);
    if (!ids.size) for (const id of spots(replay.moves.filter((m) => m.faction === me))) ids.add(id);
    if (!ids.size) for (const id of spots(replay.moves)) ids.add(id);
    // A fleet that reaches one of them comes into frame from where it set out.
    for (const m of replay.moves) if (m.path.some((spot) => ids.has(spot.at))) for (const id of spots([m])) ids.add(id);
    const pts = [...ids].flatMap((id) => pos.get(id) ?? []);
    if (!pts.length) return;
    const { w, h } = boxRef.current;
    const ins = insetsRef.current;
    const cur = viewRef.current;
    const pad = 56;
    const seen = pts.every((p) => {
      const x = cur.x + p.u * cur.s;
      const y = cur.y + (p.v * cur.s) / MAP_ASPECT;
      return x >= ins.left + pad && x <= w - ins.right - pad && y >= ins.top + pad && y <= h - ins.bottom - pad;
    });
    if (seen) return;
    const us = pts.map((p) => p.u);
    const vs = pts.map((p) => p.v);
    const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
    const fit = Math.min((w - ins.left - ins.right - 2 * pad) / Math.max(u1 - u0, 0.02), ((h - ins.top - ins.bottom - 2 * pad) * MAP_ASPECT) / Math.max(v1 - v0, 0.02));
    flyTo(centred((u0 + u1) / 2, (v0 + v1) / 2, Math.min(cur.s, Math.max(fit, cur.s * 0.6))));
    // Only a new replay moves the camera; panning and zooming during it must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay]);

  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      touched.current = true;
      cancelAnimationFrame(anim.current);
      setView((cur) => {
        const { min, max } = limits();
        const s = clamp(cur.s * factor, min, max);
        const k = s / cur.s;
        return constrain({ s, x: px - (px - cur.x) * k, y: py - (py - cur.y) * k });
      });
    },
    [constrain, limits],
  );

  // Wheel and trackpad pinch (ctrlKey) zoom around the cursor; needs a non-passive listener to stop page zoom.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: false, startX: 0, startY: 0, pinch: 0, mx: 0, my: 0 });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    touched.current = true;
    cancelAnimationFrame(anim.current);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (pointers.current.size === 1) {
      g.moved = false;
      g.startX = e.clientX;
      g.startY = e.clientY;
    } else {
      g.moved = true;
      const [a, b] = [...pointers.current.values()];
      g.pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      g.mx = (a!.x + b!.x) / 2;
      g.my = (a!.y + b!.y) / 2;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    const g = gesture.current;
    const root = rootRef.current!;
    const rect = root.getBoundingClientRect();
    if (pointers.current.size >= 2) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const mx = (a!.x + b!.x) / 2;
      const my = (a!.y + b!.y) / 2;
      const factor = g.pinch > 0 ? dist / g.pinch : 1;
      setView((cur) => {
        const { min, max } = limits();
        const s = clamp(cur.s * factor, min, max);
        const k = s / cur.s;
        const px = g.mx - rect.left;
        const py = g.my - rect.top;
        return constrain({ s, x: px - (px - cur.x) * k + (mx - g.mx), y: py - (py - cur.y) * k + (my - g.my) });
      });
      g.pinch = dist;
      g.mx = mx;
      g.my = my;
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < TAP_SLOP) return;
    if (!g.moved) {
      g.moved = true;
      root.setPointerCapture(e.pointerId);
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setView((cur) => constrain({ ...cur, x: cur.x + dx, y: cur.y + dy }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 1) {
      const rest = [...pointers.current.values()][0]!;
      gesture.current.startX = rest.x;
      gesture.current.startY = rest.y;
    }
    if (rootRef.current?.hasPointerCapture(e.pointerId)) rootRef.current.releasePointerCapture(e.pointerId);
  };

  const tap = (fn?: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!gesture.current.moved) fn?.();
  };

  const { w, h } = box;
  const { s } = view;
  const mapH = s / MAP_ASPECT;
  const cover = box.w ? limits().cover : 1;
  const zoomRatio = s / cover;
  const px = (id: string) => view.x + pos.get(id)!.u * s;
  const py = (id: string) => view.y + pos.get(id)!.v * mapH;

  const targets = useMemo(() => new Set(moveTargets ?? []), [moveTargets]);
  const selectedFleet = fleets.find((f) => f.id === selectedFleetId);

  // Every adjacency once, as a lane.
  const lanes = useMemo(() => {
    const out: { a: RegionView; b: RegionView }[] = [];
    for (const a of regions) {
      for (const bid of a.adj) {
        const b = byId.get(bid);
        if (b && a.id < b.id) out.push({ a, b });
        else if (b && !b.adj.includes(a.id)) out.push({ a, b });
      }
    }
    return out;
  }, [regions, byId]);

  const fleetsAt = useMemo(() => {
    const m = new Map<string, FleetView[]>();
    for (const f of fleets) if (f.at) m.set(f.at, [...(m.get(f.at) ?? []), f]);
    return m;
  }, [fleets]);
  const sailing = useMemo(() => fleets.filter((f) => f.transit && byId.has(f.transit.from) && byId.has(f.transit.to)), [fleets, byId]);

  const showLabel = (r: RegionView) => r.id === selectedRegionId || r.offMap || r.value >= 3 || zoomRatio >= 1.1 || (zoomRatio >= 0.85 && r.value >= 2);

  return (
    <div
      ref={rootRef}
      className="gm"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={() => {
        if (!gesture.current.moved) onBackground?.();
      }}
      onDoubleClick={(e) => {
        const r = rootRef.current!.getBoundingClientRect();
        zoomAt(1.8, e.clientX - r.left, e.clientY - r.top);
      }}
    >
      <img
        className="gm__img"
        src={MAP_IMAGE}
        alt=""
        draggable={false}
        style={{ width: s, height: mapH, transform: `translate3d(${view.x}px, ${view.y}px, 0)` }}
      />
      {w > 0 && (
        <svg className="gm__svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
          <defs>
            {(Object.keys(FACTION_INFO) as FactionId[]).map((id) => (
              <marker key={id} id={`gm-head-${id}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M0 0 L10 5 L0 10 z" fill={FACTION_INFO[id].color} />
              </marker>
            ))}
          </defs>
          {lanes.map(({ a, b }) => {
            const hot = targets.has(a.id) || targets.has(b.id) ? (selectedFleet && (selectedFleet.at === a.id || selectedFleet.at === b.id) ? 'hot' : '') : '';
            const front = a.owner !== b.owner && a.owner && b.owner ? 'front' : '';
            const off = a.offMap || b.offMap ? 'off' : '';
            return <line key={`${a.id}-${b.id}`} className={`gm-lane ${hot} ${front} ${off}`} x1={px(a.id)} y1={py(a.id)} x2={px(b.id)} y2={py(b.id)} />;
          })}
          {lanes
            .filter(({ a, b }) => (a.laneTurns?.[b.id] ?? 1) > 1)
            .map(({ a, b }) => (
              <text key={`t-${a.id}-${b.id}`} className="gm-lane-turns" x={(px(a.id) + px(b.id)) / 2} y={(py(a.id) + py(b.id)) / 2 - 7} textAnchor="middle">
                {a.laneTurns?.[b.id]}턴
              </text>
            ))}
          {fleets
            .filter((f) => f.at && f.route.length)
            .flatMap((f) => {
              const stops = [f.at!, ...f.route].filter((id) => byId.has(id));
              return stops.slice(1).map((to, i) => {
                const from = stops[i]!;
                const last = i === stops.length - 2;
                const ax = px(from);
                const ay = py(from);
                const bx = px(to);
                const by = py(to);
                const dx = bx - ax;
                const dy = by - ay;
                const len = Math.hypot(dx, dy) || 1;
                const ra = nodeRadius(byId.get(from)!) + 4;
                const rb = nodeRadius(byId.get(to)!) + (last ? 8 : 4);
                const ux = dx / len;
                const uy = dy / len;
                const sx = ax + ux * ra;
                const sy = ay + uy * ra;
                const ex = bx - ux * rb;
                const ey = by - uy * rb;
                const bend = Math.min(40, len * 0.14);
                const cx = (sx + ex) / 2 - uy * bend;
                const cy = (sy + ey) / 2 + ux * bend;
                const d = `M${sx} ${sy} Q${cx} ${cy} ${ex} ${ey}`;
                const col = FACTION_INFO[f.faction].color;
                return (
                  <g key={`${f.id}-${i}`} className={f.id === selectedFleetId ? 'gm-arrow gm-arrow--sel' : 'gm-arrow'}>
                    <path d={d} className="gm-arrow__halo" />
                    <path d={d} className="gm-arrow__line" stroke={col} markerEnd={last ? `url(#gm-head-${f.faction})` : undefined} />
                  </g>
                );
              });
            })}
        </svg>
      )}
      {w > 0 &&
        regions.map((r) => {
          const x = px(r.id);
          const y = py(r.id);
          if (x < -80 || y < -80 || x > w + 80 || y > h + 80) return null;
          const rad = nodeRadius(r);
          const sel = r.id === selectedRegionId;
          const tgt = targets.has(r.id);
          const col = r.owner ? FACTION_INFO[r.owner].color : '#8b97a4';
          const side = r.labelSide ?? 'b';
          return (
            <button
              key={r.id}
              type="button"
              className={`gm-node${sel ? ' gm-node--sel' : ''}${tgt ? ' gm-node--target' : ''}${r.offMap ? ' gm-node--off' : ''}${r.owner ? '' : ' gm-node--neutral'}${r.visible ? '' : ' gm-node--fog'}`}
              style={{ transform: `translate3d(${x}px, ${y}px, 0)`, ['--r' as string]: `${rad}px`, ['--c' as string]: col }}
              aria-label={`${r.name}, ${ownerName(r.owner)}`}
              aria-pressed={sel}
              onClick={tap(() => onSelectRegion?.(r.id))}
            >
              <span className="gm-node__disc">{r.offMap ? '↗' : r.hanja.charAt(0)}</span>
              {showLabel(r) && <span className={`gm-node__label gm-node__label--${side}`}>{r.name}</span>}
              <span className="gm-tip">
                <b>
                  {r.name} <i>{r.hanja}</i>
                </b>
                <span>
                  {ownerName(r.owner)}
                  {r.offMap ? ' · 본토' : r.visible ? ` · 수비 ${r.garrison}` : ' · 시야 밖'}
                </span>
              </span>
            </button>
          );
        })}
      {w > 0 &&
        [...fleetsAt.entries()].flatMap(([rid, list]) => {
          const r = byId.get(rid);
          if (!r) return [];
          const x = px(rid);
          const y = py(rid);
          if (x < -80 || y < -120 || x > w + 80 || y > h + 80) return [];
          const rad = nodeRadius(r);
          return list.map((f, i) => {
            const sel = f.id === selectedFleetId;
            const col = FACTION_INFO[f.faction].color;
            const mine = f.faction === me;
            return (
              <button
                key={f.id}
                type="button"
                className={`gm-fleet${sel ? ' gm-fleet--sel' : ''}${mine ? '' : ' gm-fleet--foreign'}`}
                style={{ transform: `translate3d(${x + rad * 0.55}px, ${y - rad - 6 - i * 30}px, 0)`, ['--c' as string]: col }}
                aria-label={`${f.name}, 함선 ${f.ships.length}척`}
                aria-pressed={sel}
                onClick={tap(() => onSelectFleet?.(f.id))}
              >
                <span className="gm-fleet__pill">
                  <span className="gm-fleet__flag">{FACTION_INFO[f.faction].hanja}</span>
                  <b>{f.ships.length}</b>
                  {f.route.length > 0 && <i aria-hidden>▸</i>}
                </span>
              </button>
            );
          });
        })}
      {w > 0 &&
        sailing.map((f) => {
          const t = f.transit!;
          const x = (px(t.from) + px(t.to)) / 2;
          const y = (py(t.from) + py(t.to)) / 2;
          if (x < -80 || y < -80 || x > w + 80 || y > h + 80) return null;
          const sel = f.id === selectedFleetId;
          const mine = f.faction === me;
          return (
            <button
              key={f.id}
              type="button"
              className={`gm-fleet gm-fleet--sailing${sel ? ' gm-fleet--sel' : ''}${mine ? '' : ' gm-fleet--foreign'}`}
              style={{ transform: `translate3d(${x}px, ${y}px, 0)`, ['--c' as string]: FACTION_INFO[f.faction].color }}
              aria-label={`${f.name}, 항해 중, 함선 ${f.ships.length}척`}
              aria-pressed={sel}
              onClick={tap(() => onSelectFleet?.(f.id))}
            >
              <span className="gm-fleet__pill">
                <span className="gm-fleet__flag">{FACTION_INFO[f.faction].hanja}</span>
                <b>{f.ships.length}</b>
                <i aria-hidden>≈</i>
              </span>
            </button>
          );
        })}
      {w > 0 && replay && (
        <ReplayLayer
          replay={replay}
          at={(id) => (pos.has(id) ? { x: px(id), y: py(id) } : null)}
          top={insets.top + 6}
          reduced={reducedMotion}
          onPhase={(phase) => onReplayPhase?.(phase)}
          onBeat={(kind) => onReplayBeat?.(kind)}
          onDone={() => onReplayDone?.()}
        />
      )}
      <div
        className="gm__zoom"
        style={{ left: 12 + insets.left, bottom: 12 + insets.bottom }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="g-glass g-icon-btn" aria-label="확대" onClick={() => zoomAt(1.5, w / 2, h / 2)}>
          +
        </button>
        <button type="button" className="g-glass g-icon-btn" aria-label="축소" onClick={() => zoomAt(1 / 1.5, w / 2, h / 2)}>
          −
        </button>
      </div>
    </div>
  );
}
