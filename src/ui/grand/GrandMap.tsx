import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MAP_ASPECT, project } from './projection';
import { flatMap } from '../siteMap';
import { ReplayLayer } from './Replay';
import { useT } from '../../i18n';
import { FACTION_INFO, FactionCrest, Icon, navyName } from './shared';
import { campArt, campImage, campLevel } from './campArt';
import { shipsText, turnsText } from './text';
import type { FactionId, FleetView, RegionView, ReplayView } from './types';
import type { MapScene } from './MapScene';
import { DEM_RECT, groundElevation, MAP_TILT, mapProject } from './mapMath';
import { boxBetween, markersInBox, type Marker } from './boxSelect';
import { buildWorld, transitSpot, type IsSea } from './mapWorld';
import { cardRect, pickCards } from './cardLayout';

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
  selectedFleetIds?: ReadonlySet<string>;
  /** Regions the selected fleet may sail to: highlighted and pulsing. */
  moveTargets?: string[];
  /** Screen space covered by panels; a focused region is centred in the rest. */
  insets?: MapInsets;
  /** Pans to this region when `nonce` changes. */
  focus?: { id: string; nonce: number } | null;
  onSelectRegion?: (id: string, additive?: boolean) => void;
  onSelectFleet?: (id: string, additive?: boolean) => void;
  /** A box dragged over the map: the own fleets and port garrisons inside it; `additive` keeps what is already picked. */
  onBoxSelect?: (fleetIds: string[], portIds: string[], additive: boolean) => void;
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
const HINT_KEY = 'imjin.grand.boxhint';

function boxHintSeen() {
  try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return false; }
}

/** Where a fleet badge sits on its port: stacked on the side away from the label, clear of the disc and its ring. */
function badgeSpot(x: number, y: number, rad: number, labelSide: string | undefined, i: number) {
  return { x: x + rad * 0.6, y: y + (labelSide === 't' ? 1 : -1) * (rad + 22 + i * 30) };
}

const ROMAN = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ'];
/** Phones show camp pictures only this far in; desktops from a closer-than-open view. */
const CARD_ZOOM = coarsePointer() ? 2.6 : 1.5;
/** At most this many pictures are mounted at once, nearest the centre first: each decodes to about 2.8 MB (4 on phones). */
const MAX_CARDS = coarsePointer() ? 4 : 8;
/** What a card takes on screen, picture and name with their padding: the cards that would overlap are not all shown. */
const CARD_W = coarsePointer() ? 88 : 116;
const CARD_H = coarsePointer() ? 80 : 98;

function coarsePointer() {
  try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function nodeRadius(r: RegionView) {
  return r.offMap ? 16 : 11 + r.value * 3;
}

/** Strategic map: elevation mesh, sea lanes, region nodes and fleets share the same projection. */
export function GrandMap({
  regions,
  fleets,
  me,
  selectedRegionId,
  selectedFleetId,
  selectedFleetIds,
  moveTargets,
  insets = NO_INSETS,
  focus,
  onSelectRegion,
  onSelectFleet,
  onBoxSelect,
  onBackground,
  replay,
  reducedMotion = false,
  onReplayPhase,
  onReplayBeat,
  onReplayDone,
}: GrandMapProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<MapScene | null>(null);
  const [heights, setHeights] = useState<Float32Array | null>(null);
  const [pose, setPose] = useState({ tilt: MAP_TILT, yaw: 0 });
  const activePose = heights ? pose : { tilt: 0, yaw: 0 };
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
  // Box select: a switch for plain drags, Ctrl/Cmd for a single drag. The rectangle is a DOM node moved by hand, so a drag never re-renders the map.
  const [boxMode, setBoxMode] = useState(false);
  const [hint, setHint] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const spaceDown = useRef(false);

  const byId = useMemo(() => new Map(regions.map((r) => [r.id, r])), [regions]);
  const pos = useMemo(() => new Map(regions.map((r) => {
    const p = project(r.lon, r.lat);
    return [r.id, heights ? mapProject(p.u, p.v, r.offMap ? 0 : groundElevation(heights, p.u, p.v), pose) : p];
  })), [regions, heights, pose.tilt, pose.yaw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    // Phones keep the flat image, as the select screen does, and never load the renderer.
    if (!canvas || flatMap) return;
    let cancelled = false;
    let scene: MapScene | null = null;
    void import('./MapScene')
      .then(({ MapScene: Scene }) => {
        if (cancelled) return;
        scene = new Scene(canvas);
        sceneRef.current = scene;
        return scene.init().then((data) => { if (!cancelled) setHeights(data); });
      })
      .catch(() => {
        if (!cancelled) { scene?.dispose(); sceneRef.current = null; }
      });
    return () => { cancelled = true; scene?.dispose(); sceneRef.current = null; };
  }, []);

  useEffect(() => { sceneRef.current?.update(view, activePose, box.w, box.h); }, [view, box.w, box.h, activePose.tilt, activePose.yaw]);

  // Camps and ships stand in the 3D scene under the overlay; only what they are made of is handed over, never a pointer target.
  const isSea = useMemo<IsSea | undefined>(() => (heights ? (u, v) => groundElevation(heights, u, v) <= 0 : undefined), [heights]);
  const world = useMemo(() => buildWorld(regions, fleets, replay ?? null, isSea), [regions, fleets, replay, isSea]);
  useEffect(() => { if (heights) sceneRef.current?.setWorld(world); }, [heights, world]);

  const limits = useCallback(() => {
    const { w, h } = boxRef.current;
    const cover = Math.max(w, h * MAP_ASPECT);
    const contain = Math.min(w, h * MAP_ASPECT);
    // The terrain covers only part of the frame (the rest is mist for the off-map ports): open wide enough to fill the screen with it.
    return { min: contain * 0.92, max: cover * MAX_ZOOM, cover, open: Math.max(cover, w / DEM_RECT.w) };
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
      setView(centred(u, v, limits().open));
    } else {
      setView((cur) => constrain(cur));
    }
    // Initial elevation and size changes lay out the opening view; later region updates must not re-centre it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, heights]);

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
      const pixels = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1);
      const change = clamp(-pixels * (e.ctrlKey ? 0.01 : 0.0016), -1, 1);
      zoomAt(Math.exp(change), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // Space held turns a box-select drag back into a pan.
  useEffect(() => {
    const key = (down: boolean) => (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      spaceDown.current = down;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (down && tag !== 'BUTTON' && tag !== 'INPUT' && tag !== 'TEXTAREA') e.preventDefault();
    };
    const [onDown, onUp] = [key(true), key(false)];
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  }, []);
  useEffect(() => {
    if (!hint) return;
    const id = window.setTimeout(() => setHint(false), 7000);
    return () => window.clearTimeout(id);
  }, [hint]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: false, rotating: false, boxing: false, startX: 0, startY: 0, pinch: 0, angle: 0, mx: 0, my: 0 });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    touched.current = true;
    cancelAnimationFrame(anim.current);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (pointers.current.size === 1) {
      g.moved = false;
      // Ctrl/Cmd (or the box switch, unless Space is held) draws a box; Shift then only means "add to the batch".
      g.boxing = e.button === 0 && !!onBoxSelect && (e.ctrlKey || e.metaKey || (boxMode && !spaceDown.current));
      g.rotating = !g.boxing && !!heights && (e.shiftKey || e.button === 2);
      g.startX = e.clientX;
      g.startY = e.clientY;
    } else {
      g.moved = true;
      g.boxing = false;
      if (marqueeRef.current) marqueeRef.current.style.display = 'none';
      const [a, b] = [...pointers.current.values()];
      g.pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      g.angle = Math.atan2(b!.y - a!.y, b!.x - a!.x);
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
      const angle = Math.atan2(b!.y - a!.y, b!.x - a!.x);
      if (heights) {
        const change = Math.atan2(Math.sin(angle - g.angle), Math.cos(angle - g.angle));
        setPose((cur) => ({ ...cur, yaw: cur.yaw - change }));
      }
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
      g.angle = angle;
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
    if (g.boxing) {
      const m = marqueeRef.current;
      if (m) {
        const r = boxBetween(g.startX - rect.left, g.startY - rect.top, e.clientX - rect.left, e.clientY - rect.top);
        m.style.display = 'block';
        m.style.transform = `translate3d(${r.x0}px, ${r.y0}px, 0)`;
        m.style.width = `${r.x1 - r.x0}px`;
        m.style.height = `${r.y1 - r.y0}px`;
      }
      return;
    }
    if (g.rotating) {
      setPose((cur) => ({ tilt: clamp(cur.tilt + dy * 0.006, 0.3, 1.1), yaw: cur.yaw + dx * 0.006 }));
    } else setView((cur) => constrain({ ...cur, x: cur.x + dx, y: cur.y + dy }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (g.boxing) {
      g.boxing = false;
      if (marqueeRef.current) marqueeRef.current.style.display = 'none';
      // A cancelled gesture (the system took the pointer) selects nothing.
      if (g.moved && e.type === 'pointerup') {
        const rect = rootRef.current!.getBoundingClientRect();
        const box = boxBetween(g.startX - rect.left, g.startY - rect.top, e.clientX - rect.left, e.clientY - rect.top);
        const fleetIds = markersInBox(box, ownBadges);
        const portIds = markersInBox(box, ownPorts);
        try { localStorage.setItem(HINT_KEY, '1'); } catch { /* private mode */ }
        setHint(false);
        onBoxSelect?.(fleetIds, portIds, e.shiftKey);
      }
    }
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 1) {
      const rest = [...pointers.current.values()][0]!;
      gesture.current.startX = rest.x;
      gesture.current.startY = rest.y;
    }
    if (rootRef.current?.hasPointerCapture(e.pointerId)) rootRef.current.releasePointerCapture(e.pointerId);
  };

  const tap = (fn?: (additive: boolean) => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!gesture.current.moved) fn?.(e.shiftKey || e.ctrlKey || e.metaKey);
  };

  const tapRegion = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (gesture.current.moved) return;
    let picked = id;
    // Dense ports have overlapping touch padding. Resolve the nearest visible disc, rather than the last DOM node.
    // Keyboard activation has no pointer coordinate and keeps the focused port.
    if (e.detail !== 0 && rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      let closest = Infinity;
      for (const region of regions) {
        const point = pos.get(region.id)!;
        const distance = Math.hypot(x - (view.x + point.u * view.s), y - (view.y + point.v * view.s / MAP_ASPECT));
        if (distance <= nodeRadius(region) + 12 && distance < closest) { closest = distance; picked = region.id; }
      }
    }
    onSelectRegion?.(picked, e.shiftKey || e.ctrlKey || e.metaKey);
  };

  const { w, h } = box;
  const { s } = view;
  const mapH = s / MAP_ASPECT;
  const openZoom = box.w ? limits().open : 1;
  const zoomRatio = s / openZoom;
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
  /** Where a fleet on a lane stands, in the map's pixels: the middle of its 3D ships, on the ground they ride on. */
  const lanePoint = (f: FleetView) => {
    const lane = f.transit!;
    const spot = transitSpot(byId.get(lane.from)!, byId.get(lane.to)!, lane.left, isSea);
    const p = heights ? mapProject(spot.u, spot.v, groundElevation(heights, spot.u, spot.v), pose) : spot;
    return { x: view.x + p.u * s, y: view.y + p.v * mapH };
  };

  // The centres of what a box can take, in the same pixels the markers are placed with. Only the player's own forces count.
  const ownBadges: Marker[] = [];
  const ownPorts: Marker[] = [];
  if (w > 0) {
    for (const [rid, list] of fleetsAt) {
      const r = byId.get(rid);
      if (!r) continue;
      list.forEach((f, i) => {
        if (f.faction === me) ownBadges.push({ id: f.id, ...badgeSpot(px(rid), py(rid), nodeRadius(r), r.labelSide, i) });
      });
    }
    for (const f of sailing) {
      if (f.faction === me) ownBadges.push({ id: f.id, ...lanePoint(f) });
    }
    for (const r of regions) if (r.owner === me && r.garrison > 0 && pos.has(r.id)) ownPorts.push({ id: r.id, x: px(r.id), y: py(r.id) });
  }

  const showLabel = (r: RegionView) => r.id === selectedRegionId || r.offMap || r.value >= 3 || zoomRatio >= 1.1 || (zoomRatio >= 0.85 && r.value >= 2);

  // Camp pictures only close up, never over one another nor over another port's disc: the selected port first, then the
  // hovered, then the player's own, then the rest, each by camp level. A port whose card does not fit keeps its label and
  // level badge.
  const cards = new Set<string>();
  if (w > 0 && zoomRatio >= CARD_ZOOM) {
    const candidates = regions
      .filter((r) => r.owner && !r.offMap && pos.has(r.id) && campLevel(r) > 0 && px(r.id) > 0 && px(r.id) < w && py(r.id) > 0 && py(r.id) < h)
      .map((r) => ({
        id: r.id,
        own: r.owner === me,
        level: campLevel(r),
        distance: Math.hypot(px(r.id) - w / 2, py(r.id) - h / 2),
        rect: cardRect(px(r.id), py(r.id), nodeRadius(r), r.labelSide ?? 'b', CARD_W, CARD_H),
      }));
    const discs = regions
      .filter((r) => pos.has(r.id) && px(r.id) > -40 && px(r.id) < w + 40 && py(r.id) > -40 && py(r.id) < h + 40)
      .map((r) => {
        const rad = nodeRadius(r);
        return { id: r.id, rect: { x0: px(r.id) - rad, y0: py(r.id) - rad, x1: px(r.id) + rad, y1: py(r.id) + rad } };
      });
    for (const id of pickCards(candidates, selectedRegionId, hovered, MAX_CARDS, discs)) cards.add(id);
  }

  return (
    <div
      ref={rootRef}
      className="gm"
      data-relief={heights ? 'ready' : 'image'}
      data-tilt={activePose.tilt}
      data-yaw={activePose.yaw}
      data-box={boxMode ? 'on' : 'off'}
      onContextMenu={(e) => e.preventDefault()}
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
      <canvas ref={canvasRef} className="gm__relief" style={{ opacity: heights ? 1 : 0 }} aria-hidden />
      {!heights && <img
        className="gm__img"
        src="/ui/map_south.webp"
        alt=""
        draggable={false}
        style={{ width: s * DEM_RECT.w, height: mapH * DEM_RECT.h, transform: `translate3d(${view.x + DEM_RECT.u * s}px, ${view.y + DEM_RECT.v * mapH}px, 0)` }}
      />}
      {w > 0 && (
        <svg className="gm__svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
          <defs>
            {(Object.keys(FACTION_INFO) as FactionId[]).map((id) => (
              <radialGradient key={`land-${id}`} id={`gm-land-${id}`}>
                {/* Over the relief the camp in the middle carries the owner's ring and flag: a lighter centre leaves it its contrast. */}
                <stop offset="0" style={{ stopColor: FACTION_INFO[id].color }} stopOpacity={heights ? 0.12 : 0.42} />
                <stop offset="0.55" style={{ stopColor: FACTION_INFO[id].color }} stopOpacity={heights ? 0.17 : 0.2} />
                <stop offset="1" style={{ stopColor: FACTION_INFO[id].color }} stopOpacity="0" />
              </radialGradient>
            ))}
            {(Object.keys(FACTION_INFO) as FactionId[]).map((id) => (
              <marker key={id} id={`gm-head-${id}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M0 0 L10 5 L0 10 z" fill={FACTION_INFO[id].color} />
              </marker>
            ))}
          </defs>
          {regions.filter((r) => r.owner && !r.offMap && pos.has(r.id)).map((r) => {
            const rad = view.s * (0.028 + 0.011 * campLevel(r));
            return <circle key={`land-${r.id}`} className="gm-land" cx={px(r.id)} cy={py(r.id)} r={rad} fill={`url(#gm-land-${r.owner})`} />;
          })}
          {lanes.map(({ a, b }) => {
            const from = selectedFleet && selectedFleet.at === a.id ? a : selectedFleet && selectedFleet.at === b.id ? b : null;
            const hot = from && (targets.has(a.id) || targets.has(b.id));
            const front = a.owner !== b.owner && a.owner && b.owner ? 'front' : '';
            const off = a.offMap || b.offMap ? 'off' : '';
            const [ax, ay, bx, by] = [px(a.id), py(a.id), px(b.id), py(b.id)];
            const len = Math.hypot(bx - ax, by - ay) || 1;
            const bend = Math.min(28, len * 0.09);
            const cx = (ax + bx) / 2 - ((by - ay) / len) * bend;
            const cy = (ay + by) / 2 + ((bx - ax) / len) * bend;
            const d = `M${ax} ${ay} Q${cx} ${cy} ${bx} ${by}`;
            // The curve's midpoint and its heading there; the mark points away from the port the selected force is in.
            const mx = (ax + bx) / 4 + cx / 2;
            const my = (ay + by) / 4 + cy / 2;
            const turn = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI + (from === b ? 180 : 0);
            return (
              <g key={`${a.id}-${b.id}`}>
                {hot && <path className="gm-lane__glow" d={d} />}
                <path className={`gm-lane ${hot ? 'hot' : ''} ${front} ${off}`} d={d} />
                {hot && <path className="gm-lane__dir" d="M-5 -5 L3 0 L-5 5" transform={`translate(${mx} ${my}) rotate(${turn})`} />}
              </g>
            );
          })}
          {lanes
            .filter(({ a, b }) => (a.laneTurns?.[b.id] ?? 1) > 1)
            .map(({ a, b }) => {
              const len = Math.hypot(px(b.id) - px(a.id), py(b.id) - py(a.id)) || 1;
              const bend = Math.min(28, len * 0.09) / 2;
              return (
                <text key={`t-${a.id}-${b.id}`} className="gm-lane-turns" x={(px(a.id) + px(b.id)) / 2 - ((py(b.id) - py(a.id)) / len) * bend} y={(py(a.id) + py(b.id)) / 2 + ((px(b.id) - px(a.id)) / len) * bend - 7} textAnchor="middle">
                  {turnsText(a.laneTurns?.[b.id] ?? 1)}
                </text>
              );
            })}
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
                  <g key={`${f.id}-${i}`} className={f.id === selectedFleetId || selectedFleetIds?.has(f.id) ? 'gm-arrow gm-arrow--sel' : 'gm-arrow'}>
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
          const col = r.owner ? FACTION_INFO[r.owner].color : '#8a939c';
          const side = r.labelSide ?? 'b';
          const level = campLevel(r);
          const own = r.owner === me;
          const card = r.owner && cards.has(r.id) ? campArt(r.id, r.owner) : null;
          const garrisoned = fleetsAt.get(r.id);
          return (
            <button
              key={r.id}
              type="button"
              className={`gm-node${sel ? ' gm-node--sel' : ''}${tgt ? ' gm-node--target' : ''}${r.offMap ? ' gm-node--off' : ''}${r.seat ? ' gm-node--seat' : ''}${r.owner ? '' : ' gm-node--neutral'}${own ? ' gm-node--own' : ''}${card ? ' gm-node--card' : ''}${r.visible ? '' : ' gm-node--fog'}`}
              style={{ transform: `translate3d(${x}px, ${y}px, 0)`, ['--r' as string]: `${rad}px`, ['--c' as string]: col }}
              data-region={r.id}
              aria-label={`${r.name}, ${navyName(r.owner)}`}
              aria-pressed={sel}
              onClick={tapRegion(r.id)}
              onPointerEnter={() => setHovered(r.id)}
              onPointerLeave={() => setHovered((cur) => (cur === r.id ? null : cur))}
            >
              <span className="gm-node__disc">
                {r.offMap ? <Icon name="portal" size="sm" /> : r.owner && <FactionCrest faction={r.owner} size={Math.round(rad * 1.5)} />}
              </span>
              {level > 0 && <span className="gm-node__lv" aria-hidden>{ROMAN[level] ?? level}</span>}
              {garrisoned && <span className="gm-node__banner" style={{ ['--b' as string]: FACTION_INFO[garrisoned[0]!.faction].color }} aria-hidden />}
              {card ? (
                <span className={`gm-node__label gm-node__card gm-node__label--${side}`}>
                  <img src={campImage(card, level)} width={104} height={69} alt="" loading="lazy" decoding="async" draggable={false} />
                  <span>{r.name}</span>
                </span>
              ) : showLabel(r) && <span className={`gm-node__label gm-node__label--${side}`}>{r.name}</span>}
              <span className="gm-tip">
                <b>
                  {r.name} <i>{r.hanja}</i>
                </b>
                <span>
                  {navyName(r.owner)}
                  {' · ' + (r.offMap ? t('본토 기지') : r.visible ? t('수비대 {ships}', { ships: shipsText(r.garrison) }) : t('시야 밖'))}
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
            const sel = f.id === selectedFleetId || !!selectedFleetIds?.has(f.id);
            const col = FACTION_INFO[f.faction].color;
            const mine = f.faction === me;
            const spot = badgeSpot(x, y, rad, r.labelSide, i);
            return (
              <button
                key={f.id}
                type="button"
                className={`gm-fleet${sel ? ' gm-fleet--sel' : ''}${mine ? '' : ' gm-fleet--foreign'}`}
                style={{ transform: `translate3d(${spot.x}px, ${spot.y}px, 0)`, ['--c' as string]: col }}
                aria-label={t('{name}, 함선 {ships}', { name: f.name, ships: shipsText(f.ships.length) })}
                aria-pressed={sel}
                data-fleet={f.id}
                onClick={tap((additive) => onSelectFleet?.(f.id, additive))}
              >
                <span className="gm-fleet__pill">
                  <Icon name="ship" size="sm" />
                  <b>{f.ships.length}</b>
                  {f.route.length > 0 && <Icon name="sail" size="sm" />}
                </span>
              </button>
            );
          });
        })}
      {w > 0 &&
        sailing.map((f) => {
          const { x, y } = lanePoint(f);
          if (x < -80 || y < -80 || x > w + 80 || y > h + 80) return null;
          const sel = f.id === selectedFleetId || !!selectedFleetIds?.has(f.id);
          const mine = f.faction === me;
          return (
            <button
              key={f.id}
              type="button"
              className={`gm-fleet gm-fleet--sailing${sel ? ' gm-fleet--sel' : ''}${mine ? '' : ' gm-fleet--foreign'}`}
              style={{ transform: `translate3d(${x}px, ${y}px, 0)`, ['--c' as string]: FACTION_INFO[f.faction].color }}
              aria-label={t('{name}, 항해 중, 함선 {ships}', { name: f.name, ships: shipsText(f.ships.length) })}
              aria-pressed={sel}
              data-fleet={f.id}
              onClick={tap((additive) => onSelectFleet?.(f.id, additive))}
            >
              <span className="gm-fleet__pill">
                <Icon name="ship" size="sm" />
                <b>{f.ships.length}</b>
                <i aria-hidden>···</i>
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
          onSail={(share, time) => sceneRef.current?.setSail(share, time)}
        />
      )}
      <div ref={marqueeRef} className="gm__marquee" aria-hidden />
      {hint && boxMode && <div className="gm__hint" role="status" style={{ left: 12 + insets.left, bottom: 68 + insets.bottom }}>{t('박스 선택 켜짐: 끌어서 병력을 한꺼번에 고릅니다. 지도 이동은 두 손가락·휠·오른쪽 버튼·Space')}</div>}
      <div
        className="gm__zoom"
        style={{ left: 12 + insets.left, bottom: 12 + insets.bottom }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="g-glass gm__box"
          aria-pressed={boxMode}
          onClick={() => {
            setBoxMode(!boxMode);
            setHint(!boxMode && !boxHintSeen());
          }}
        >
          <Icon name="select" />
          {t('박스 선택')}
        </button>
        <button type="button" className="g-glass g-icon-btn" aria-label={t('확대')} onClick={() => zoomAt(1.5, w / 2, h / 2)}>
          <Icon name="plus" />
        </button>
        <button type="button" className="g-glass g-icon-btn" aria-label={t('축소')} onClick={() => zoomAt(1 / 1.5, w / 2, h / 2)}>
          <Icon name="minus" />
        </button>
      </div>
      <a className="gm__credits" href="/ui/TERRAIN-CREDITS.txt" target="_blank" rel="noreferrer" style={{ right: 12 + insets.right, bottom: 12 + insets.bottom }} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>DEM: Mapzen · USGS · NOAA</a>
    </div>
  );
}
