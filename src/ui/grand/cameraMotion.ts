import { MAP_ASPECT } from './projection';
import { clampState, LIMITS, turn, zoomAt, type CameraState, type ScreenFrame } from './worldCamera';

// How the campaign's camera moves on its own between the player's inputs: a glide to a place, the coast after a drag, the
// keys held down and the wheel's eased zoom. Pure maths, no DOM and no three.js: the map hands it inputs with their times
// and asks once per drawn frame where the camera is (`step`). Times are milliseconds on the clock of performance.now(),
// which event time stamps and animation frame times share; speeds are per second, so how far the camera moves does not
// depend on how often it is drawn.

/** How long a glide takes (the rotate and tilt buttons, the compass, a focused port), ms. */
export const GLIDE_MS = 460;
/** The coast after a drag loses its speed with this time constant (s): most of it is over within about 0.3 s. */
export const COAST_TAU = 0.1;
/** Only the last stretch of a drag sets the coast's speed (ms), and a pointer that rested this long before it let go does not coast. */
const COAST_WINDOW = 90;
const COAST_REST = 45;
/** The fastest coast: over the ground in camera distances a second, and turning and tipping in radians a second. */
const COAST_MAX = { move: 4, yaw: 6, pitch: 3 };
/** Held keys: the turn and the tilt in radians a second, and the move over the ground in camera distances a second. */
export const KEY_RATES = { yaw: (100 * Math.PI) / 180, pitch: (45 * Math.PI) / 180, move: 0.8 };
/** Held keys come up to speed, and settle once let go, with this time constant (s). */
export const KEY_TAU = 0.06;
/** The wheel's zoom closes on the distance it aims for with this time constant (s): there in about 150 ms. */
export const ZOOM_TAU = 0.045;

export type KeyAction = 'forward' | 'back' | 'left' | 'right' | 'turnLeft' | 'turnRight' | 'tiltUp' | 'tiltDown';

/** The camera's keys: the arrows and WASD move over the ground, Q and E turn, R and F tip. */
export const KEY_ACTIONS: Readonly<Record<string, KeyAction>> = {
  ArrowUp: 'forward', KeyW: 'forward', ArrowDown: 'back', KeyS: 'back',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  KeyQ: 'turnLeft', KeyE: 'turnRight', KeyR: 'tiltUp', KeyF: 'tiltDown',
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** A glide from one camera to another, `duration` ms from `start`. */
export interface Glide {
  from: CameraState;
  to: CameraState;
  start: number;
  duration: number;
}

/** Where a glide is at `now`: place and pitch ease out, the distance eases by ratio and the turn takes the short way round. */
export function glideAt(g: Glide, now: number): CameraState {
  const t = g.duration > 0 ? clamp((now - g.start) / g.duration, 0, 1) : 1;
  if (t >= 1) return g.to;
  const e = easeOut(t);
  const { from, to } = g;
  return clampState({
    u: from.u + (to.u - from.u) * e,
    v: from.v + (to.v - from.v) * e,
    distance: from.distance * (to.distance / from.distance) ** e,
    yaw: from.yaw + wrap(to.yaw - from.yaw) * e,
    pitch: from.pitch + (to.pitch - from.pitch) * e,
  });
}

/** Speeds of a coasting camera: frame units a second over the ground, radians a second about its target. */
interface Coast {
  u: number;
  v: number;
  yaw: number;
  pitch: number;
}

/** Where a drag had brought the camera, and when. */
interface Sample {
  t: number;
  u: number;
  v: number;
  yaw: number;
  pitch: number;
}

type Axes = { ahead: number; right: number; yaw: number; pitch: number };
const AXES: (keyof Axes)[] = ['ahead', 'right', 'yaw', 'pitch'];

/**
 * The camera's own motion. A drag moves the camera directly (the ground follows the pointer) and reports where it went
 * with `track`; everything that goes on after an input (a glide, the coast after a drag, a held key, the wheel's zoom) is
 * advanced by `step`.
 */
export class CameraMotion {
  private glide: Glide | null = null;
  private coast: Coast | null = null;
  /** The distance the wheel aims for and the screen point it zooms about. */
  private zoom: { distance: number; x: number; y: number } | null = null;
  private readonly held = new Set<KeyAction>();
  /** The held keys' speeds, each -1..1: ahead and to the right over the ground, the turn and the tilt. */
  private axes: Axes = { ahead: 0, right: 0, yaw: 0, pitch: 0 };
  private samples: Sample[] = [];
  /** When `step` last ran, or when the current motion started if nothing moved before it. */
  private last = 0;

  /** True while the camera moves on its own: every display frame should be drawn. */
  get moving(): boolean {
    return !!(this.glide || this.coast || this.zoom || this.held.size || AXES.some((a) => this.axes[a] !== 0));
  }

  /** Where the camera is going: the end of a glide, or `cam` itself. A second press of a button adds to the first. */
  destination(cam: CameraState): CameraState {
    return this.glide?.to ?? cam;
  }

  /** A press or a gesture takes over: a glide, the coast and the wheel's zoom stop where they are. Held keys go on. */
  stop() {
    this.glide = null;
    this.coast = null;
    this.zoom = null;
    this.samples = [];
  }

  /** Everything stops, the held keys too: the window lost the focus, so their releases will not arrive. */
  halt() {
    this.stop();
    this.held.clear();
    this.axes = { ahead: 0, right: 0, yaw: 0, pitch: 0 };
  }

  /** Glides from `cam` to `target`, starting at `now`. */
  glideTo(cam: CameraState, target: CameraState, now: number, duration = GLIDE_MS) {
    this.begin(now);
    this.stop();
    this.glide = { from: cam, to: clampState(target), start: now, duration };
  }

  /** A drag moved the camera to `cam` at `now`; the last stretch of it sets the coast after release. */
  track(cam: CameraState, now: number) {
    this.samples.push({ t: now, u: cam.u, v: cam.v, yaw: cam.yaw, pitch: cam.pitch });
    while (this.samples.length > 2 && now - this.samples[0]!.t > COAST_WINDOW * 2) this.samples.shift();
  }

  /**
   * The drag let go at `now` with the camera at `cam`: it coasts on at the speed of the drag's last stretch, unless the
   * pointer had come to rest first or `coast` is false (the player asks for reduced motion).
   */
  release(cam: CameraState, now: number, coast = true) {
    const recent = this.samples.filter((s) => now - s.t <= COAST_WINDOW);
    this.samples = [];
    const a = recent[0], b = recent[recent.length - 1];
    if (!coast || !a || !b || a === b || now - b.t > COAST_REST) return;
    const seconds = Math.max(0.016, (b.t - a.t) / 1000);
    const speed: Coast = { u: (b.u - a.u) / seconds, v: (b.v - a.v) / seconds, yaw: wrap(b.yaw - a.yaw) / seconds, pitch: (b.pitch - a.pitch) / seconds };
    // Over the ground in world units: a frame point's v is its world z times the frame's aspect.
    const move = Math.hypot(speed.u, speed.v / MAP_ASPECT), most = COAST_MAX.move * cam.distance;
    if (move > most) {
      speed.u *= most / move;
      speed.v *= most / move;
    }
    speed.yaw = clamp(speed.yaw, -COAST_MAX.yaw, COAST_MAX.yaw);
    speed.pitch = clamp(speed.pitch, -COAST_MAX.pitch, COAST_MAX.pitch);
    if (this.settled(speed, cam.distance)) return;
    this.begin(now);
    this.coast = speed;
  }

  /** Zooms by `factor` (above 1 is closer) about the screen point (x, y), easing there; turns of the wheel in quick succession add up. */
  zoomBy(cam: CameraState, factor: number, x: number, y: number, now: number) {
    this.begin(now);
    this.glide = null;
    this.coast = null;
    const from = this.zoom?.distance ?? cam.distance;
    this.zoom = { distance: clamp(from / factor, LIMITS.minDistance, LIMITS.maxDistance), x, y };
  }

  /** A camera key went down or up at `now`. */
  key(action: KeyAction, down: boolean, now: number) {
    if (this.held.has(action) === down) return;
    this.begin(now);
    this.glide = null;
    if (down) this.held.add(action);
    else this.held.delete(action);
  }

  /** The camera at `now`, after whatever moves it on its own; `cam` is where it is, `screen` what it draws to. */
  step(cam: CameraState, screen: ScreenFrame, now: number): CameraState {
    const dt = clamp((now - this.last) / 1000, 0, 0.1);
    this.last = Math.max(this.last, now);
    let c = cam;
    if (this.glide) {
      c = glideAt(this.glide, now);
      if (now >= this.glide.start + this.glide.duration) this.glide = null;
    }
    if (dt <= 0) return c;
    if (this.coast) {
      // Exact for any frame length: the distance an exponentially slowing motion covers in dt, and its speed after.
      const decay = Math.exp(-dt / COAST_TAU), travel = COAST_TAU * (1 - decay), s = this.coast;
      c = turn({ ...c, u: c.u + s.u * travel, v: c.v + s.v * travel }, s.yaw * travel, s.pitch * travel);
      s.u *= decay;
      s.v *= decay;
      s.yaw *= decay;
      s.pitch *= decay;
      if (this.settled(s, c.distance)) this.coast = null;
    }
    c = this.keys(c, dt);
    if (this.zoom) {
      const z = this.zoom;
      const k = 1 - Math.exp(-dt / ZOOM_TAU);
      // By ratio, so zooming in and out feel alike; the last sliver is closed at once.
      let distance = c.distance * (z.distance / c.distance) ** k;
      if (Math.abs(Math.log(distance / z.distance)) < 0.002) distance = z.distance;
      const zoomed = zoomAt(c, screen, z.x, z.y, c.distance / distance);
      // There, or held at a limit it cannot pass.
      if (distance === z.distance || Math.abs(zoomed.distance - c.distance) < 1e-9) this.zoom = null;
      c = zoomed;
    }
    return c;
  }

  /** Held keys: their speeds ease towards what is held, and the camera moves, turns and tips by them. */
  private keys(c: CameraState, dt: number): CameraState {
    const on = (a: KeyAction) => (this.held.has(a) ? 1 : 0);
    const want: Axes = {
      ahead: on('forward') - on('back'),
      right: on('right') - on('left'),
      yaw: on('turnRight') - on('turnLeft'),
      pitch: on('tiltUp') - on('tiltDown'),
    };
    const k = 1 - Math.exp(-dt / KEY_TAU);
    let any = false;
    for (const a of AXES) {
      let value = this.axes[a] + (want[a] - this.axes[a]) * k;
      if (want[a] === 0 && Math.abs(value) < 0.002) value = 0;
      this.axes[a] = value;
      any ||= value !== 0;
    }
    if (!any) return c;
    const { ahead, right, yaw, pitch } = this.axes;
    // Ahead and to the right on the ground as the view faces; two keys at once do not move faster than one.
    const length = Math.max(1, Math.hypot(ahead, right));
    const step = (KEY_RATES.move * c.distance * dt) / length;
    const x = (-Math.sin(c.yaw) * ahead + Math.cos(c.yaw) * right) * step;
    const z = (-Math.cos(c.yaw) * ahead - Math.sin(c.yaw) * right) * step;
    return turn({ ...c, u: c.u + x, v: c.v + z * MAP_ASPECT }, yaw * KEY_RATES.yaw * dt, pitch * KEY_RATES.pitch * dt);
  }

  /** A coast this slow is over. */
  private settled(s: Coast, distance: number) {
    return Math.hypot(s.u, s.v / MAP_ASPECT) < distance * 0.02 && Math.abs(s.yaw) < 0.02 && Math.abs(s.pitch) < 0.02;
  }

  /** A motion starts at `now`: when nothing moved before it, its first step is measured from here, not from a frame long past. */
  private begin(now: number) {
    if (!this.moving) this.last = now;
  }
}
