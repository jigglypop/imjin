import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { MAP_ASPECT, project } from './projection';
import { flatMap } from '../siteMap';
import { ErrorBoundary } from '../ErrorBoundary';
import { ReplayLayer } from './Replay';
import { useT } from '../../i18n';
import { FACTION_INFO, FactionCrest, Icon, navyName } from './shared';
import { campArt, campImage, campLevel } from './campArt';
import { shipsText, turnsText } from './text';
import type { FactionId, FleetView, MarchRouteView, RegionView, ReplayView, SpotView } from './types';
import type { WorldControls, WorldView } from './WorldCanvas';
import { DEM_RECT, groundElevation } from './mapMath';
import { clampState, frameAll, panBy, projectFrame, screenFrame, turn, zoomAt as zoomCameraAt, type CameraState } from './worldCamera';
import { CameraMotion, KEY_ACTIONS } from './cameraMotion';
import { boxBetween, markersInBox, type Marker } from './boxSelect';
import { buildWorld, HULL_LENGTH, laneSpot, SETTLEMENT_RADIUS, type IsSea } from './mapWorld';
import { cardRect, pickCards } from './cardLayout';

// The 3D world needs three.js and r3f: it is loaded on demand, and phones and touch-only tablets (flatMap), which keep the
// flat image, never load it.
const WorldCanvas = lazy(() => import('./WorldCanvas'));

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
  /** March rules: the turns the selected fleet needs to reach each port, drawn as a ring coloured by them. */
  reach?: Record<string, number>;
  /** March rules: the way the selected fleet is ordered to sail, turn by turn. */
  route?: MarchRouteView | null;
  /** March rules: the way the selected fleet would sail to a port, shown while the pointer is over that port. */
  routeFor?: (portId: string) => MarchRouteView | null;
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
/** The free camera: how far it stands at the opening, how close a focused port is shown, and the opening pitch (radians above the horizon). */
const OPEN_DISTANCE = 0.55;
const FOCUS_DISTANCE = 0.3;
const OPEN_PITCH = 0.78;

/** Where a place on the map is on the screen, whichever view draws it. `scale` is pixels per frame unit there, `ok` that it is in front of the camera. */
interface Spot {
  x: number;
  y: number;
  scale: number;
  depth: number;
  ok: boolean;
}
const HINT_KEY = 'imjin.grand.boxhint';

function boxHintSeen() {
  try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return false; }
}

/** Where a fleet badge sits on its port in the flat map: stacked on the side away from the label, clear of the disc and its ring. */
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

/** The movement range's colours, as on a campaign map: this turn green, the next yellow, later orange. */
const TURN_TONES = ['#86d97a', '#efd25c', '#f0954a'];
const turnTone = (turn: number) => TURN_TONES[Math.min(TURN_TONES.length, Math.max(1, turn)) - 1]!;

/** Strategic map: elevation mesh, sea lanes, region nodes and fleets share the same projection. */
export function GrandMap({
  regions,
  fleets,
  me,
  selectedRegionId,
  selectedFleetId,
  selectedFleetIds,
  moveTargets,
  reach,
  route,
  routeFor,
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
  const world = useRef<WorldControls | null>(null);
  const [heights, setHeights] = useState<Float32Array | null>(null);
  const [worldFailed, setWorldFailed] = useState(false);
  // With the DEM loaded (desktop and tablet) the map is a 3D world seen by a free camera; before that, and on phones, a flat image with a pan and zoom.
  const inWorld = !!heights;
  // The world camera lives in `camRef`: input moves it at once, and once per display frame the 3D view's frame callback
  // steps what moves on its own (`motion`), draws it and hands it to the overlay (`cam`) in the same frame, so the markers
  // never trail the ground and the map renders at most once a frame however many events arrive.
  const [cam, setCam] = useState<CameraState>({ u: 0.5, v: 0.5, distance: OPEN_DISTANCE, yaw: 0, pitch: OPEN_PITCH });
  const camRef = useRef(cam);
  const shownCam = useRef(cam);
  const [motion] = useState(() => new CameraMotion());
  /** The opening view has been laid out on the world: until then the 3D view draws nothing. */
  const opened = useRef(false);
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
  /** Each port in frame coordinates with the height of its ground. */
  const frames = useMemo(() => new Map(regions.map((r) => {
    const p = project(r.lon, r.lat);
    return [r.id, { u: p.u, v: p.v, e: heights && !r.offMap ? groundElevation(heights, p.u, p.v) : 0 }];
  })), [regions, heights]);
  const screen = useMemo(() => screenFrame(box.w, box.h, insets), [box.w, box.h, insets.top, insets.right, insets.bottom, insets.left]);
  const screenRef = useRef(screen);
  screenRef.current = screen;

  /** The world camera moves to `next`; the overlay and the 3D view show it at the next display frame. */
  const moveCam = useCallback((next: CameraState) => {
    camRef.current = next;
    world.current?.redraw();
  }, []);

  // The panels' insets or the window's size changed: the target is drawn in the middle of the new free area.
  useEffect(() => {
    world.current?.redraw();
  }, [screen]);

  // Camps and ships stand in the 3D scene under the overlay; only what they are made of is handed over, never a pointer target.
  const isSea = useMemo<IsSea | undefined>(() => (heights ? (u, v) => groundElevation(heights, u, v) <= 0 : undefined), [heights]);
  const mapWorld = useMemo(() => buildWorld(regions, fleets, replay ?? null, isSea), [regions, fleets, replay, isSea]);
  const onWorldReady = useCallback((data: Float32Array) => {
    // The world opens on the player's own coast even if the flat image was moved while it loaded.
    touched.current = false;
    setHeights(data);
  }, []);
  const onWorldError = useCallback(() => setWorldFailed(true), []);
  const onWorldControls = useCallback((controls: WorldControls | null) => {
    world.current = controls;
  }, []);

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

  /** The world camera glides to `target`: its place, distance and pitch ease out, its turn takes the short way round. */
  const flyCam = useCallback((target: CameraState) => {
    touched.current = true;
    motion.glideTo(camRef.current, target, performance.now());
    world.current?.redraw();
  }, [motion]);
  /** A button's glide, measured from where the camera is going: a second press before the first glide ends adds to it. */
  const glideOn = (change: (to: CameraState) => Partial<CameraState>) => {
    const to = motion.destination(camRef.current);
    flyCam({ ...to, ...change(to) });
  };

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
      const pts = mine.map((r) => frames.get(r.id)!);
      const u = pts.length ? pts.reduce((a, p) => a + p.u, 0) / pts.length : 0.45;
      const v = pts.length ? pts.reduce((a, p) => a + p.v, 0) / pts.length : 0.4;
      if (inWorld) {
        // The player's coast fills the opening view from a high oblique angle; never closer than a regional view.
        const framed = frameAll(pts, { u, v, distance: OPEN_DISTANCE, yaw: 0, pitch: OPEN_PITCH }, screenRef.current, 130);
        opened.current = true;
        moveCam(clampState({ ...framed, distance: clamp(framed.distance, 0.34, 0.9) }));
      } else setView(centred(u, v, limits().open));
    } else if (inWorld) {
      opened.current = true;
      moveCam(clampState(camRef.current));
    } else {
      setView((cur) => constrain(cur));
    }
    // Initial elevation and size changes lay out the opening view; later region updates must not re-centre it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, heights]);

  useEffect(() => {
    if (!focus || !ready.current) return;
    const p = frames.get(focus.id);
    if (!p) return;
    if (inWorld) flyCam(clampState({ ...camRef.current, u: p.u, v: p.v, distance: Math.min(camRef.current.distance, FOCUS_DISTANCE) }));
    else flyTo(centred(p.u, p.v, Math.max(viewRef.current.s, limits().cover)));
    // Only a new nonce re-centres; layout changes alone must not yank the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  useEffect(() => () => cancelAnimationFrame(anim.current), []);

  // Closing or opening a panel changes how far the map may slide: keep it inside the new limits.
  useEffect(() => {
    if (ready.current && !inWorld) setView((cur) => constrain(cur));
  }, [insets.top, insets.right, insets.bottom, insets.left, constrain, inWorld]);

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
    const pts = [...ids].flatMap((id) => frames.get(id) ?? []);
    if (!pts.length) return;
    const { w, h } = boxRef.current;
    const ins = insetsRef.current;
    const pad = 56;
    if (inWorld) {
      const here = camRef.current, sf = screenRef.current;
      const inside = pts.every((p) => {
        const at = projectFrame(here, sf, p.u, p.v, p.e);
        return at.depth > 0 && at.x >= ins.left + pad && at.x <= w - ins.right - pad && at.y >= ins.top + pad && at.y <= h - ins.bottom - pad;
      });
      if (!inside) flyCam(frameAll(pts, here, sf, pad + 24));
      return;
    }
    const cur = viewRef.current;
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
      if (inWorld) {
        // The world eases to the new distance, the ground under (px, py) staying under it.
        motion.zoomBy(camRef.current, factor, px, py, performance.now());
        world.current?.redraw();
        return;
      }
      setView((cur) => {
        const { min, max } = limits();
        const s = clamp(cur.s * factor, min, max);
        const k = s / cur.s;
        return constrain({ s, x: px - (px - cur.x) * k, y: py - (py - cur.y) * k });
      });
    },
    [constrain, limits, inWorld, motion],
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
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: false, rotating: false, boxing: false, startX: 0, startY: 0, pinch: 0, angle: 0, mx: 0, my: 0 });

  // The keyboard flies the world camera while a key is held: arrows or WASD glide over the ground in the direction the view
  // faces, Q and E turn it, R and F tip it. Keys typed into a field, and shortcuts with Ctrl, Cmd or Alt, are not the camera's.
  useEffect(() => {
    if (!inWorld) return;
    const onDown = (e: KeyboardEvent) => {
      const action = KEY_ACTIONS[e.code];
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (!action || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      touched.current = true;
      motion.key(action, true, e.timeStamp);
      world.current?.redraw();
    };
    const onUp = (e: KeyboardEvent) => {
      const action = KEY_ACTIONS[e.code];
      if (!action) return;
      motion.key(action, false, e.timeStamp);
      world.current?.redraw();
    };
    // A window that loses the focus never hears the keys or the button let go: everything stops where it is.
    const onBlur = () => {
      motion.halt();
      pointers.current.clear();
      gesture.current.boxing = false;
      if (marqueeRef.current) marqueeRef.current.style.display = 'none';
      world.current?.redraw();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      motion.halt();
    };
  }, [inWorld, motion]);
  useEffect(() => {
    if (!hint) return;
    const id = window.setTimeout(() => setHint(false), 7000);
    return () => window.clearTimeout(id);
  }, [hint]);

  /**
   * One frame of the 3D view: whatever moves the camera on its own takes its step, the overlay is rendered with the camera
   * at once (inside this animation frame), and the view draws the same camera. Further frames are wanted while it moves or
   * a drag is under way.
   */
  const frameView = useCallback((now: number): WorldView | null => {
    if (!opened.current) return null;
    const screen = screenRef.current;
    const next = motion.step(camRef.current, screen, now);
    camRef.current = next;
    if (next !== shownCam.current) {
      shownCam.current = next;
      flushSync(() => setCam(next));
    }
    const g = gesture.current;
    return { cam: next, screen, more: motion.moving || (g.moved && !g.boxing && pointers.current.size > 0) };
  }, [motion]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    touched.current = true;
    cancelAnimationFrame(anim.current);
    // A press stops a glide, the coast after a drag and the wheel's zoom at once.
    motion.stop();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (pointers.current.size === 1) {
      g.moved = false;
      // Ctrl/Cmd (or the box switch, unless Space is held) draws a box; Shift then only means "add to the batch".
      g.boxing = e.button === 0 && !!onBoxSelect && (e.ctrlKey || e.metaKey || (boxMode && !spaceDown.current));
      // The right or the middle button, or Shift or Alt with the left, turns the view sideways and tips it up and down.
      g.rotating = !g.boxing && !!heights && (e.shiftKey || e.altKey || e.button === 1 || e.button === 2);
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
      const mx = (a!.x + b!.x) / 2;
      const my = (a!.y + b!.y) / 2;
      const factor = g.pinch > 0 ? dist / g.pinch : 1;
      if (inWorld) {
        // Two fingers: the ground between them follows them, the pinch zooms about them, a twist turns the view.
        const change = Math.atan2(Math.sin(angle - g.angle), Math.cos(angle - g.angle));
        const from = { x: g.mx - rect.left, y: g.my - rect.top };
        const to = { x: mx - rect.left, y: my - rect.top };
        const sf = screenRef.current;
        moveCam(turn(zoomCameraAt(panBy(camRef.current, sf, from, to), sf, to.x, to.y, factor), change, 0));
      } else {
        setView((cur) => {
          const { min, max } = limits();
          const s = clamp(cur.s * factor, min, max);
          const k = s / cur.s;
          const px = g.mx - rect.left;
          const py = g.my - rect.top;
          return constrain({ s, x: px - (px - cur.x) * k + (mx - g.mx), y: py - (py - cur.y) * k + (my - g.my) });
        });
      }
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
      // Dragging the near side of the map to the right turns it about the point in the middle; dragging down tips the view over.
      moveCam(turn(camRef.current, -dx * 0.006, dy * 0.005));
      motion.track(camRef.current, e.timeStamp);
    } else if (inWorld) {
      // The ground under the pointer follows it exactly.
      const from = { x: e.clientX - dx - rect.left, y: e.clientY - dy - rect.top }, to = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      moveCam(panBy(camRef.current, screenRef.current, from, to));
      motion.track(camRef.current, e.timeStamp);
    } else setView((cur) => constrain({ ...cur, x: cur.x + dx, y: cur.y + dy }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    // The last finger or button off a drag over the world: the view coasts on a little, unless the player asks for reduced motion.
    if (inWorld && e.type === 'pointerup' && g.moved && !g.boxing && pointers.current.size === 1 && pointers.current.has(e.pointerId)) {
      motion.release(camRef.current, e.timeStamp, !reducedMotion);
      world.current?.redraw();
    }
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
        const point = spots.get(region.id);
        if (!point?.ok) continue;
        const distance = Math.hypot(x - point.x, y - point.y);
        if (distance <= nodeRadius(region) + 12 && distance < closest) { closest = distance; picked = region.id; }
      }
    }
    onSelectRegion?.(picked, e.shiftKey || e.ctrlKey || e.metaKey);
  };

  const { w, h } = box;
  const { s } = view;
  const mapH = s / MAP_ASPECT;
  const openZoom = box.w ? limits().open : 1;
  // How close the view is compared with its opening: labels and city cards appear as it passes thresholds.
  const zoomRatio = inWorld ? OPEN_DISTANCE / cam.distance : s / openZoom;
  /** A map point on the screen: through the free camera in the world, through the flat image's offset and scale otherwise. */
  const place = (u: number, v: number, e: number): Spot => {
    if (inWorld) {
      const p = projectFrame(cam, screen, u, v, e);
      return { x: p.x, y: p.y, scale: p.scale, depth: p.depth, ok: p.depth > 0 };
    }
    return { x: view.x + u * s, y: view.y + v * mapH, scale: s, depth: 1, ok: true };
  };
  const spots = new Map<string, Spot>();
  if (w > 0) for (const r of regions) { const f = frames.get(r.id)!; spots.set(r.id, place(f.u, f.v, f.e)); }
  const px = (id: string) => spots.get(id)!.x;
  const py = (id: string) => spots.get(id)!.y;
  /** Nearer things draw over farther ones, from 0 to 800; the hovered and the selected port come in front of them all. */
  const layer = (id: string) => {
    if (id === hovered) return 802;
    if (id === selectedRegionId) return 801;
    return inWorld ? Math.round((2 - Math.min(2, spots.get(id)?.depth ?? 1)) * 400) : undefined;
  };

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
  /**
   * Where a fleet on a lane stands, in the map's pixels: the middle of its 3D ships, on the ground they ride on; its pill
   * floats just over their mastheads (`pill`), and `depth` orders it among the other marks.
   */
  const lanePoint = (f: FleetView) => {
    // The world's spot, which keeps squadrons meeting on a lane apart; the lane's own before the world has the sea.
    const spot = groups.get(f.id) ?? laneSpot(f, byId, isSea)!;
    const at = place(spot.u, spot.v, heights ? groundElevation(heights, spot.u, spot.v) : 0);
    // A squadron under way is about two hulls deep: the mastheads of its rear rank stand this far over its middle.
    const lift = inWorld ? at.y - place(spot.u, spot.v, SETTLEMENT_RADIUS * HULL_LENGTH * 1.6).y : 0;
    return { x: at.x, y: at.y, pill: at.y - lift - (inWorld ? 16 : 0), depth: at.depth };
  };
  /** The 3D squadrons by key: a port's navy (`port/faction`) at anchor, a fleet's id under way. */
  const groups = new Map(mapWorld.fleets.map((g) => [g.key, g]));
  // The port discs and labels on screen, which a fleet's pill must not cover.
  const marks: { x0: number; y0: number; x1: number; y1: number }[] = [];
  if (w > 0) for (const r of regions) {
    const sp = spots.get(r.id);
    if (!sp?.ok || sp.x < -80 || sp.y < -80 || sp.x > w + 80 || sp.y > h + 80) continue;
    const rad = nodeRadius(r) + 3;
    marks.push({ x0: sp.x - rad, y0: sp.y - rad, x1: sp.x + rad, y1: sp.y + rad });
    // A label is about 6 px a character wide, a line tall, on its side of the disc.
    const side = r.labelSide ?? 'b', half = r.name.length * 6.5 + 4;
    if (side === 'b') marks.push({ x0: sp.x - half, y0: sp.y + rad, x1: sp.x + half, y1: sp.y + rad + 18 });
    else if (side === 't') marks.push({ x0: sp.x - half, y0: sp.y - rad - 18, x1: sp.x + half, y1: sp.y - rad });
    else if (side === 'l') marks.push({ x0: sp.x - rad - 2 * half, y0: sp.y - 9, x1: sp.x - rad, y1: sp.y + 9 });
    else marks.push({ x0: sp.x + rad, y0: sp.y - 9, x1: sp.x + rad + 2 * half, y1: sp.y + 9 });
  }
  /**
   * Where a fleet's pill sits at its port: over the 3D ships that stand for it (or under them when that covers a port's
   * disc or label), the fleets of one navy stacked; in the flat map, or with no ships drawn, beside the port's disc.
   */
  const portBadge = (r: RegionView, list: FleetView[], f: FleetView) => {
    const group = inWorld ? groups.get(`${r.id}/${f.faction}`) : undefined;
    if (!group?.berths.length) return badgeSpot(px(r.id), py(r.id), nodeRadius(r), r.labelSide, list.indexOf(f));
    const k = list.filter((o) => o.faction === f.faction).indexOf(f);
    // The squadron's outline on screen, from its waterlines to its mastheads.
    let x0 = Infinity, x1 = -Infinity, top = Infinity, bottom = -Infinity;
    for (const b of group.berths) {
      const u = group.u + b.x * SETTLEMENT_RADIUS, v = group.v + b.z * SETTLEMENT_RADIUS * MAP_ASPECT;
      const low = place(u, v, 0), high = place(u, v, SETTLEMENT_RADIUS * HULL_LENGTH * 0.75);
      x0 = Math.min(x0, low.x); x1 = Math.max(x1, low.x);
      top = Math.min(top, high.y); bottom = Math.max(bottom, low.y);
    }
    const x = (x0 + x1) / 2;
    const covers = (y: number) => marks.some((m) => x + 34 > m.x0 && x - 34 < m.x1 && y + 14 > m.y0 && y - 14 < m.y1);
    // The whole stack goes under the ships when over them it would cover a mark and under them it would not.
    const n = list.filter((o) => o.faction === f.faction).length;
    const stack = (y0: number, dir: number) => Array.from({ length: n }, (_, i) => y0 + dir * i * 30);
    const under = stack(top - 18, -1).some(covers) && !stack(bottom + 18, 1).some(covers);
    return { x, y: under ? bottom + 18 + k * 30 : top - 18 - k * 30 };
  };

  const showLabel = (r: RegionView) => r.id === selectedRegionId || r.offMap || r.value >= 3 || zoomRatio >= 1.1 || (zoomRatio >= 0.85 && r.value >= 2);

  // Camp pictures only close up, never over one another nor over another port's disc: the selected port first, then the
  // hovered, then the player's own, then the rest, each by camp level. A port whose card does not fit keeps its label and
  // level badge.
  const cards = new Set<string>();
  if (w > 0 && zoomRatio >= CARD_ZOOM) {
    const candidates = regions
      .filter((r) => r.owner && !r.offMap && spots.get(r.id)?.ok && campLevel(r) > 0 && px(r.id) > 0 && px(r.id) < w && py(r.id) > 0 && py(r.id) < h)
      .map((r) => ({
        id: r.id,
        own: r.owner === me,
        level: campLevel(r),
        distance: Math.hypot(px(r.id) - w / 2, py(r.id) - h / 2),
        rect: cardRect(px(r.id), py(r.id), nodeRadius(r), r.labelSide ?? 'b', CARD_W, CARD_H),
      }));
    const discs = regions
      .filter((r) => spots.get(r.id)?.ok && px(r.id) > -40 && px(r.id) < w + 40 && py(r.id) > -40 && py(r.id) < h + 40)
      .map((r) => {
        const rad = nodeRadius(r);
        return { id: r.id, rect: { x0: px(r.id) - rad, y0: py(r.id) - rad, x1: px(r.id) + rad, y1: py(r.id) + rad } };
      });
    for (const id of pickCards(candidates, selectedRegionId, hovered, MAX_CARDS, discs)) cards.add(id);
  }
  // A pill keeps off the cards shown as well.
  for (const id of cards) { const r = byId.get(id)!; marks.push(cardRect(px(id), py(id), nodeRadius(r), r.labelSide ?? 'b', CARD_W, CARD_H)); }

  // The centres of what a box can take, in the same pixels the markers are placed with. Only the player's own forces count.
  const ownBadges: Marker[] = [];
  const ownPorts: Marker[] = [];
  if (w > 0) {
    for (const [rid, list] of fleetsAt) {
      const r = byId.get(rid);
      if (!r) continue;
      for (const f of list) if (f.faction === me) ownBadges.push({ id: f.id, ...portBadge(r, list, f) });
    }
    for (const f of sailing) {
      if (f.faction === me) { const at = lanePoint(f); ownBadges.push({ id: f.id, x: at.x, y: at.pill }); }
    }
    for (const r of regions) if (r.owner === me && r.garrison > 0 && spots.get(r.id)?.ok) ownPorts.push({ id: r.id, x: px(r.id), y: py(r.id) });
  }

  // The movement line: the way to the port under the pointer when the selected fleet can go there, else the way it is ordered.
  const hoverRoute = useMemo(() => (hovered && routeFor && reach?.[hovered] !== undefined ? routeFor(hovered) : null), [hovered, routeFor, reach]);
  const shownRoute = hoverRoute ?? route ?? null;
  /** A spot of a route on the screen: a port, or a share of the way along a lane; where the fleet lies at sea, its own pill. */
  const spotAt = (sp: SpotView, first: boolean): { x: number; y: number; port?: RegionView } | null => {
    if (first && sp.to && selectedFleet?.transit) {
      const at = lanePoint(selectedFleet);
      return { x: at.x, y: at.y };
    }
    const a = frames.get(sp.at);
    if (!a) return null;
    if (!sp.to) {
      const p = spots.get(sp.at);
      return p?.ok ? { x: p.x, y: p.y, port: byId.get(sp.at) } : null;
    }
    const b = frames.get(sp.to);
    if (!b) return null;
    const k = sp.t ?? 0.5;
    const p = place(a.u + (b.u - a.u) * k, a.v + (b.v - a.v) * k, 0);
    return p.ok ? { x: p.x, y: p.y } : null;
  };
  const routeLegs = w > 0 && shownRoute ? shownRoute.legs.map((leg, k) => leg.map((sp, i) => spotAt(sp, k === 0 && i === 0)).filter((p) => !!p)) : [];

  return (
    <div
      ref={rootRef}
      className="gm"
      data-relief={heights ? 'ready' : 'image'}
      data-tilt={inWorld ? cam.pitch : 0}
      data-yaw={inWorld ? cam.yaw : 0}
      data-box={boxMode ? 'on' : 'off'}
      onContextMenu={(e) => e.preventDefault()}
      // A middle-button press would start the browser's auto-scroll instead of turning the map.
      onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
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
      {/* A world that cannot start (no WebGPU or WebGL2, a failed download) leaves the flat image, which shows until the world is ready. */}
      {!flatMap && !worldFailed && (
        <ErrorBoundary fallback={<></>}>
          <Suspense fallback={null}>
            <WorldCanvas className="gm__relief" view={frameView} world={heights ? mapWorld : null} onReady={onWorldReady} onError={onWorldError} onControls={onWorldControls} />
          </Suspense>
        </ErrorBoundary>
      )}
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
          {regions.filter((r) => r.owner && !r.offMap && spots.get(r.id)?.ok).map((r) => {
            const sp = spots.get(r.id)!;
            const rad = sp.scale * (0.028 + 0.011 * campLevel(r));
            // On the ground a disc is seen flattened by the view's pitch.
            return <ellipse key={`land-${r.id}`} className="gm-land" cx={sp.x} cy={sp.y} rx={rad} ry={inWorld ? rad * Math.max(0.4, Math.sin(cam.pitch)) : rad} fill={`url(#gm-land-${r.owner})`} />;
          })}
          {lanes.map(({ a, b }) => {
            if (!spots.get(a.id)?.ok || !spots.get(b.id)?.ok) return null;
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
            .filter(({ a, b }) => (a.laneTurns?.[b.id] ?? 1) > 1 && spots.get(a.id)?.ok && spots.get(b.id)?.ok)
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
            .filter((f) => f.at && f.route.length && !(shownRoute && f.id === selectedFleetId))
            .flatMap((f) => {
              const stops = [f.at!, ...f.route].filter((id) => byId.has(id) && spots.get(id)?.ok);
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
          {routeLegs.map((pts, k) => {
            if (pts.length < 2) return null;
            const points = pts.map((p) => `${p.x},${p.y}`).join(' ');
            return (
              <g key={`route-${k}`} className="gm-route">
                <polyline className="gm-route__halo" points={points} />
                <polyline className="gm-route__line" points={points} stroke={turnTone(k + 1)} />
              </g>
            );
          })}
        </svg>
      )}
      <div className="gm__marks">
      {w > 0 &&
        regions.map((r) => {
          const x = px(r.id);
          const y = py(r.id);
          if (!spots.get(r.id)?.ok || x < -80 || y < -80 || x > w + 80 || y > h + 80) return null;
          const rad = nodeRadius(r);
          const sel = r.id === selectedRegionId;
          const tgt = targets.has(r.id);
          const col = r.owner ? FACTION_INFO[r.owner].color : '#8a939c';
          const side = r.labelSide ?? 'b';
          const level = campLevel(r);
          const own = r.owner === me;
          const card = r.owner && cards.has(r.id) ? campArt(r.id, r.owner) : null;
          const garrisoned = fleetsAt.get(r.id);
          const turns = reach?.[r.id];
          return (
            <button
              key={r.id}
              type="button"
              className={`gm-node${sel ? ' gm-node--sel' : ''}${tgt ? ' gm-node--target' : ''}${r.offMap ? ' gm-node--off' : ''}${r.seat ? ' gm-node--seat' : ''}${r.owner ? '' : ' gm-node--neutral'}${own ? ' gm-node--own' : ''}${card ? ' gm-node--card' : ''}${r.visible ? '' : ' gm-node--fog'}`}
              style={{ transform: `translate3d(${x}px, ${y}px, 0)`, zIndex: layer(r.id), ['--r' as string]: `${rad}px`, ['--c' as string]: col }}
              data-region={r.id}
              aria-label={`${r.name}, ${navyName(r.owner)}`}
              aria-pressed={sel}
              onClick={tapRegion(r.id)}
              onPointerEnter={() => setHovered(r.id)}
              onPointerLeave={() => setHovered((cur) => (cur === r.id ? null : cur))}
            >
              {turns !== undefined && <span className="gm-node__reach" style={{ ['--t' as string]: turnTone(turns) }} data-turns={Math.min(3, turns)} aria-hidden />}
              {r.siege && <span className="gm-node__siege" style={{ ['--s' as string]: FACTION_INFO[r.siege.by].color }} aria-hidden />}
              <span className="gm-node__disc">
                {r.offMap ? <Icon name="portal" size="sm" /> : r.owner && <FactionCrest faction={r.owner} size={Math.round(rad * 1.5)} />}
              </span>
              {r.siege && (
                <span className={`gm-node__siegetag gm-node__siegetag--${side === 't' ? 'b' : 't'}`} style={{ ['--s' as string]: FACTION_INFO[r.siege.by].color }}>
                  {t('봉쇄 {n}/{m}', { n: r.siege.turns, m: r.siege.hold })}
                </span>
              )}
              {level > 0 && <span className="gm-node__lv" aria-hidden>{ROMAN[level] ?? level}</span>}
              {garrisoned && <span className="gm-node__banner" style={{ ['--b' as string]: FACTION_INFO[garrisoned[0]!.faction].color }} aria-hidden />}
              {!card && showLabel(r) && <span className={`gm-node__label gm-node__label--${side}`}>{r.name}</span>}
            </button>
          );
        })}
      </div>
      {/* The city cards stand over every disc and label: a card is placed where it hides no other port's disc. */}
      <div className="gm__cards">
        {w > 0 &&
          [...cards].map((id) => {
            const r = byId.get(id);
            if (!r?.owner || !spots.get(id)?.ok) return null;
            const card = campArt(r.id, r.owner);
            return (
              <span key={id} className="gm-pin" style={{ transform: `translate3d(${px(id)}px, ${py(id)}px, 0)`, zIndex: layer(id), ['--r' as string]: `${nodeRadius(r)}px`, ['--c' as string]: FACTION_INFO[r.owner].color }}>
                <span className={`gm-node__label gm-node__card gm-node__label--${r.labelSide ?? 'b'}`}>
                  <img src={campImage(card, campLevel(r))} width={104} height={69} alt="" loading="lazy" decoding="async" draggable={false} />
                  <span>{r.name}</span>
                </span>
              </span>
            );
          })}
      </div>
      {/* The fleets' pills over the cards: they are placed clear of the discs and labels, and a card must not hide one. */}
      <div className="gm__fleets">
      {w > 0 &&
        [...fleetsAt.entries()].flatMap(([rid, list]) => {
          const r = byId.get(rid);
          if (!r) return [];
          const x = px(rid);
          const y = py(rid);
          if (!spots.get(rid)?.ok || x < -80 || y < -120 || x > w + 80 || y > h + 80) return [];
          return list.map((f) => {
            const sel = f.id === selectedFleetId || !!selectedFleetIds?.has(f.id);
            const col = FACTION_INFO[f.faction].color;
            const mine = f.faction === me;
            const spot = portBadge(r, list, f);
            return (
              <button
                key={f.id}
                type="button"
                className={`gm-fleet${sel ? ' gm-fleet--sel' : ''}${mine ? '' : ' gm-fleet--foreign'}`}
                style={{ transform: `translate3d(${spot.x}px, ${spot.y}px, 0)`, zIndex: sel ? 803 : layer(rid), ['--c' as string]: col }}
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
          const { x, pill: y, depth } = lanePoint(f);
          if (x < -80 || y < -80 || x > w + 80 || y > h + 80) return null;
          const sel = f.id === selectedFleetId || !!selectedFleetIds?.has(f.id);
          const mine = f.faction === me;
          return (
            <button
              key={f.id}
              type="button"
              className={`gm-fleet gm-fleet--sailing${sel ? ' gm-fleet--sel' : ''}${mine ? '' : ' gm-fleet--foreign'}`}
              style={{ transform: `translate3d(${x}px, ${y}px, 0)`, zIndex: sel ? 803 : inWorld ? Math.round((2 - Math.min(2, depth)) * 400) : undefined, ['--c' as string]: FACTION_INFO[f.faction].color }}
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
      </div>
      {/* Where each turn of the movement line ends: a numbered mark at sea, or beside the port's disc; the last one says how long and what for. */}
      <div className="gm__route">
        {shownRoute &&
          routeLegs.map((pts, k) => {
            const end = pts[pts.length - 1];
            if (!end || pts.length < 2) return null;
            const last = k === routeLegs.length - 1;
            const off = end.port ? nodeRadius(end.port) * 0.78 : 0;
            const goal = shownRoute.siege ? t('봉쇄') : shownRoute.hostile ? t('공격') : '';
            return (
              <span key={k} className={`gm-step${end.port ? ' gm-step--port' : ''}${last ? ' gm-step--end' : ''}`} style={{ transform: `translate3d(${end.x + off}px, ${end.y + off}px, 0)`, ['--t' as string]: turnTone(k + 1) }}>
                <b>{k + 1}</b>
                {last && <span className="gm-step__tag">{goal ? `${turnsText(shownRoute.turns)} · ${goal}` : turnsText(shownRoute.turns)}</span>}
              </span>
            );
          })}
      </div>
      {/* One tip, for the port under the pointer, over everything else on the map. */}
      <div className="gm__tips">
        {(() => {
          const r = hovered ? byId.get(hovered) : undefined;
          if (!r || !spots.get(r.id)?.ok) return null;
          return (
            <span className="gm-pin" style={{ transform: `translate3d(${px(r.id)}px, ${py(r.id)}px, 0)`, ['--r' as string]: `${nodeRadius(r)}px` }}>
              <span className="gm-tip">
                <b>
                  {r.name} <i>{r.hanja}</i>
                </b>
                <span>
                  {navyName(r.owner)}
                  {' · ' + (r.offMap ? t('본토 기지') : r.visible ? t('수비대 {ships}', { ships: shipsText(r.garrison) }) : t('시야 밖'))}
                </span>
                {hoverRoute && hoverRoute.dest === r.id && (
                  <span className="gm-tip__route" style={{ ['--t' as string]: turnTone(hoverRoute.turns) }}>
                    {t('{turns} · {km}km', { turns: turnsText(hoverRoute.turns), km: hoverRoute.km })}
                  </span>
                )}
              </span>
            </span>
          );
        })()}
      </div>
      {w > 0 && replay && (
        <ReplayLayer
          replay={replay}
          at={(id) => (spots.get(id)?.ok ? { x: px(id), y: py(id) } : null)}
          top={insets.top + 6}
          reduced={reducedMotion}
          onPhase={(phase) => onReplayPhase?.(phase)}
          onBeat={(kind) => onReplayBeat?.(kind)}
          onDone={() => onReplayDone?.()}
          onSail={(share, time) => world.current?.setSail(share, time)}
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
        {inWorld && (
          <>
            <button type="button" className="g-glass g-icon-btn" aria-label={t('왼쪽으로 돌리기')} title={t('왼쪽으로 돌리기 (Q)')} onClick={() => glideOn((d) => ({ yaw: d.yaw - Math.PI / 4 }))}>
              ⟲
            </button>
            <button type="button" className="g-glass g-icon-btn" aria-label={t('오른쪽으로 돌리기')} title={t('오른쪽으로 돌리기 (E)')} onClick={() => glideOn((d) => ({ yaw: d.yaw + Math.PI / 4 }))}>
              ⟳
            </button>
            <button type="button" className="g-glass g-icon-btn" aria-label={t('시점 기울이기')} title={t('눕혔다 세우기 (오른쪽 버튼으로 끌기)')} onClick={() => glideOn((d) => ({ pitch: d.pitch > 0.7 ? 0.36 : 1.05 }))}>
              ⇕
            </button>
            {/* The compass shows where north lies as the view turns; a press brings north back up. */}
            <button type="button" className="g-glass g-icon-btn gm__compass" aria-label={t('북쪽으로 되돌리기')} title={t('북쪽으로 되돌리기 · 오른쪽이나 가운데 버튼, 또는 Shift를 누르고 끌면 가로·세로로 돌아갑니다')} onClick={() => glideOn(() => ({ yaw: 0, pitch: OPEN_PITCH }))}>
              <svg viewBox="0 0 24 24" width="20" height="20" style={{ transform: `rotate(${(cam.yaw * 180) / Math.PI}deg)` }} aria-hidden>
                <path d="M12 2.5 15.2 12 12 10.4 8.8 12Z" fill="#e8452c" />
                <path d="M12 21.5 8.8 12 12 13.6 15.2 12Z" fill="currentColor" opacity="0.55" />
              </svg>
            </button>
          </>
        )}
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
