import { MAP_ASPECT } from './projection';

// The free camera of the campaign's 3D world. Pure maths, no three.js: the scene sets its PerspectiveCamera from `eyeOf`
// and `FOV`, and the DOM overlay places every marker with `projectPoint`, so both always agree.
//
// World units are the campaign frame's: x to the east and z to the south, the frame is 1 wide and 1 / MAP_ASPECT deep,
// y is up in the unit `groundElevation` (mapMath.ts) reads. A frame point (u, v) is x = u - 0.5, z = (v - 0.5) / MAP_ASPECT.

/** The camera looks at a point of the ground `distance` away, from `pitch` above the horizon, turned `yaw` about it. */
export interface CameraState {
  /** The ground point in the middle of the free screen area, frame coordinates (u east, v south, both 0..1). */
  u: number;
  v: number;
  /** From that point to the eye, in frame units. */
  distance: number;
  /** Turn about the vertical: 0 looks north (the eye is south of the point), positive moves the eye towards the east. */
  yaw: number;
  /** Radians above the horizon: small is a low oblique view with a horizon, 1.4 is nearly straight down. */
  pitch: number;
}

/** The screen the camera draws to: its size and where the target appears (the middle of what the panels leave free). */
export interface ScreenFrame {
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export interface Projected {
  x: number;
  y: number;
  /** Distance along the view direction; points with depth <= 0 are behind the camera. */
  depth: number;
  /** Pixels per frame unit at this depth, the size of something one unit long facing the camera. */
  scale: number;
  /** In front of the camera and inside the screen. */
  visible: boolean;
}

/** Vertical field of view in radians. */
export const FOV = 0.56;
export const NEAR = 0.002;
export const FAR = 8;

export const LIMITS = {
  /** Close enough to fill the screen with one camp, far enough to hold the whole frame. */
  minDistance: 0.025,
  maxDistance: 1.35,
  minPitch: 0.2,
  maxPitch: 1.45,
  /** How far past the frame's edge the target may go, as a share of the frame. */
  slack: 0.06,
  /** The eye stays at least this high above sea level, above the highest peak. */
  minEyeHeight: 0.007,
};

type Vec3 = [number, number, number];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** World x and z of a frame point. */
export const worldX = (u: number) => u - 0.5;
export const worldZ = (v: number) => (v - 0.5) / MAP_ASPECT;

/** The frame point of a world position. */
export const frameU = (x: number) => x + 0.5;
export const frameV = (z: number) => z * MAP_ASPECT + 0.5;

/** Where the eye is, with the target on the ground at height `groundY`. */
export function eyeOf(c: CameraState, groundY = 0): Vec3 {
  const horizontal = Math.cos(c.pitch) * c.distance;
  return [worldX(c.u) + Math.sin(c.yaw) * horizontal, groundY + Math.sin(c.pitch) * c.distance, worldZ(c.v) + Math.cos(c.yaw) * horizontal];
}

interface Basis {
  eye: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  focal: number;
}

function basisOf(c: CameraState, screen: ScreenFrame, groundY: number): Basis {
  const eye = eyeOf(c, groundY);
  const target: Vec3 = [worldX(c.u), groundY, worldZ(c.v)];
  const forward = norm(sub(target, eye));
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  return { eye, right, up, forward, focal: screen.h / 2 / Math.tan(FOV / 2) };
}

/** A world point on the screen. The camera looks at a target on the plane y = `groundY`. */
export function projectPoint(c: CameraState, screen: ScreenFrame, x: number, y: number, z: number, groundY = 0): Projected {
  const b = basisOf(c, screen, groundY);
  const d = sub([x, y, z], b.eye);
  const depth = dot(d, b.forward);
  if (depth <= 1e-6) return { x: NaN, y: NaN, depth, scale: 0, visible: false };
  const sx = screen.cx + (dot(d, b.right) / depth) * b.focal;
  const sy = screen.cy - (dot(d, b.up) / depth) * b.focal;
  return { x: sx, y: sy, depth, scale: b.focal / depth, visible: sx > -60 && sx < screen.w + 60 && sy > -60 && sy < screen.h + 60 };
}

/** A frame point (u, v) with height `elevation` on the screen. */
export function projectFrame(c: CameraState, screen: ScreenFrame, u: number, v: number, elevation: number, groundY = 0) {
  return projectPoint(c, screen, worldX(u), elevation, worldZ(v), groundY);
}

/** The point of the plane y = `planeY` under a screen position, as a frame point, or null when the ray misses it (above the horizon). */
export function unproject(c: CameraState, screen: ScreenFrame, sx: number, sy: number, planeY = 0): { u: number; v: number } | null {
  const b = basisOf(c, screen, planeY);
  const ray: Vec3 = [
    b.forward[0] + ((sx - screen.cx) / b.focal) * b.right[0] - ((sy - screen.cy) / b.focal) * b.up[0],
    b.forward[1] + ((sx - screen.cx) / b.focal) * b.right[1] - ((sy - screen.cy) / b.focal) * b.up[1],
    b.forward[2] + ((sx - screen.cx) / b.focal) * b.right[2] - ((sy - screen.cy) / b.focal) * b.up[2],
  ];
  if (ray[1] >= -1e-6) return null;
  const t = (planeY - b.eye[1]) / ray[1];
  return { u: frameU(b.eye[0] + ray[0] * t), v: frameV(b.eye[2] + ray[2] * t) };
}

/** The state kept inside its limits: distance, pitch and the target's place on the map. */
export function clampState(c: CameraState): CameraState {
  const distance = clamp(c.distance, LIMITS.minDistance, LIMITS.maxDistance);
  // The eye must clear the highest ground: a low pitch is only allowed while the camera is far enough for it.
  const pitchFloor = Math.max(LIMITS.minPitch, Math.asin(Math.min(1, LIMITS.minEyeHeight / distance)));
  return {
    u: clamp(c.u, -LIMITS.slack, 1 + LIMITS.slack),
    v: clamp(c.v, -LIMITS.slack, 1 + LIMITS.slack),
    distance,
    yaw: Math.atan2(Math.sin(c.yaw), Math.cos(c.yaw)),
    pitch: clamp(c.pitch, pitchFloor, LIMITS.maxPitch),
  };
}

/** The camera after the ground point that was under `from` is dragged to `to`: the ground follows the pointer. */
export function panBy(c: CameraState, screen: ScreenFrame, from: { x: number; y: number }, to: { x: number; y: number }): CameraState {
  const a = unproject(c, screen, from.x, from.y);
  const b = unproject(c, screen, to.x, to.y);
  if (!a || !b) return c;
  return clampState({ ...c, u: c.u + (a.u - b.u), v: c.v + (a.v - b.v) });
}

/** The pitch the map opens with: a high oblique view of the coast. */
export const OPEN_PITCH = 0.62;
/** The pitch closest in: low enough that a camp shows its walls and roofs rather than its plan. */
const CLOSE_PITCH = 0.38;
/** From this distance out the view keeps the opening's pitch. */
const OPEN_FROM = 0.45;

/**
 * The view's pitch by its distance, as a Total War campaign map tilts while it zooms: the opening's high oblique view from
 * afar, coming down smoothly (by the distance's logarithm) to a low view over a single camp.
 */
export function zoomPitch(distance: number) {
  const t = Math.log(distance / LIMITS.minDistance) / Math.log(OPEN_FROM / LIMITS.minDistance);
  const s = clamp(t, 0, 1);
  return CLOSE_PITCH + (OPEN_PITCH - CLOSE_PITCH) * s * s * (3 - 2 * s);
}

/**
 * The camera after zooming by `factor` (above 1 closer): the ground under (sx, sy) stays under it, and the view tilts by
 * as much as zoomPitch changes over the zoom, so a pitch the player set by hand keeps its offset from the curve.
 */
export function zoomAt(c: CameraState, screen: ScreenFrame, sx: number, sy: number, factor: number): CameraState {
  const before = unproject(c, screen, sx, sy);
  const distance = clamp(c.distance / factor, LIMITS.minDistance, LIMITS.maxDistance);
  const next = clampState({ ...c, distance, pitch: c.pitch + zoomPitch(distance) - zoomPitch(c.distance) });
  if (!before) return next;
  const after = unproject(next, screen, sx, sy);
  if (!after) return next;
  return clampState({ ...next, u: next.u + (before.u - after.u), v: next.v + (before.v - after.v) });
}

/** Turns the view about the target and tilts it, within the limits. */
export function turn(c: CameraState, dyaw: number, dpitch: number): CameraState {
  return clampState({ ...c, yaw: c.yaw + dyaw, pitch: c.pitch + dpitch });
}

/**
 * The distance at which a ground rectangle `width` x `depth` (frame units, as seen along the view) fits a screen of this
 * size with `pad` pixels spare, from this pitch.
 */
export function distanceToFit(width: number, depth: number, pitch: number, screen: ScreenFrame, pad = 48): number {
  const aspect = screen.w / screen.h;
  const half = Math.tan(FOV / 2);
  const free = { w: Math.max(80, screen.w - 2 * pad), h: Math.max(80, screen.h - 2 * pad) };
  // The ground depth is foreshortened by sin(pitch); the nearer and farther edges also differ in distance, which this ignores.
  const needW = width / 2 / (half * aspect * (free.w / screen.w));
  const needH = (depth * Math.sin(pitch)) / 2 / (half * (free.h / screen.h));
  return Math.max(needW, needH);
}

/**
 * A camera that has all of these frame points in view, looking from the current yaw and pitch. The size estimate ignores
 * perspective, so the distance is then corrected by projecting the points until the farthest one sits just inside.
 */
export function frameAll(points: { u: number; v: number }[], c: CameraState, screen: ScreenFrame, pad = 56): CameraState {
  if (!points.length) return c;
  const cos = Math.cos(c.yaw), sin = Math.sin(c.yaw);
  // Rotate into the view's own axes (right and away) to measure the box the points fill.
  const along = points.map((p) => ({ r: worldX(p.u) * cos - worldZ(p.v) * sin, a: -(worldX(p.u) * sin + worldZ(p.v) * cos) }));
  const [r0, r1] = [Math.min(...along.map((p) => p.r)), Math.max(...along.map((p) => p.r))];
  const [a0, a1] = [Math.min(...along.map((p) => p.a)), Math.max(...along.map((p) => p.a))];
  const mid = { r: (r0 + r1) / 2, a: (a0 + a1) / 2 };
  // Back from the view's axes to the world's: the inverse of the rotation above.
  const u = frameU(mid.r * cos - mid.a * sin), v = frameV(-mid.r * sin - mid.a * cos);
  let next = clampState({ ...c, u, v, distance: distanceToFit(Math.max(r1 - r0, 0.03), Math.max(a1 - a0, 0.03), c.pitch, screen, pad) });
  const halfW = Math.max(40, Math.min(screen.cx, screen.w - screen.cx) - pad);
  const halfH = Math.max(40, Math.min(screen.cy, screen.h - screen.cy) - pad);
  for (let i = 0; i < 16; i += 1) {
    let worst = 0;
    for (const p of points) {
      const s = projectFrame(next, screen, p.u, p.v, 0);
      worst = Math.max(worst, s.depth <= 0 ? 4 : Math.max(Math.abs(s.x - screen.cx) / halfW, Math.abs(s.y - screen.cy) / halfH));
    }
    // Inside by a margin of a few percent, and not wastefully far: stop; otherwise scale the distance by how far out the worst point is.
    if (worst <= 1 && worst >= 0.9) break;
    const distance = clamp(next.distance * Math.max(0.6, Math.min(2.5, worst * 1.03)), LIMITS.minDistance, LIMITS.maxDistance);
    if (Math.abs(distance - next.distance) < 1e-6) break;
    next = clampState({ ...next, distance });
  }
  return next;
}

/** Shows the panels' inset: the target is drawn in the middle of the area they leave free. */
export function screenFrame(w: number, h: number, ins: { top: number; right: number; bottom: number; left: number }): ScreenFrame {
  return { w, h, cx: ins.left + (w - ins.left - ins.right) / 2, cy: ins.top + (h - ins.top - ins.bottom) / 2 };
}

/** Frame units of ground one pixel covers at the target: what a drag of that many pixels moves. */
export function groundPerPixel(c: CameraState, screen: ScreenFrame): number {
  return c.distance / (screen.h / 2 / Math.tan(FOV / 2));
}
