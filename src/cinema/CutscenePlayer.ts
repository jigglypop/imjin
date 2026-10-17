import { compose, ease, locate, type CameraPose, type Place, type RigHost } from './rig';
import type { Act, Caption, Cue, Scene, Shot } from './types';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Seconds a black span takes to fall and to lift. */
const RAMP = 0.6;

/**
 * Plays one scene: advances its clock in real time, picks the shot, follows the shot's subject through a critically
 * damped spring (position and heading only, never the deck's roll or pitch; the sim's fixed steps and the swell are
 * filtered out, so the frame never trembles), and says which captions and cues are due. No procedural shake anywhere;
 * the focus distance is fixed for each shot (no focus hunting).
 */
export class CutscenePlayer {
  /** Seconds into the scene. */
  t = 0;
  held = false;
  readonly length: number;
  private shotIndex = -1;
  private shotStart = 0;
  private place: Place | null = null;
  /** The spring's velocity for `place`. */
  private vel = { x: 0, y: 0, z: 0, h: 0 };
  /** Cuts so far (the cast reveals loaded figures only on a cut). */
  cuts = 0;
  /** This shot's focus distance, fixed at its first frame. */
  private focus = 0;
  /** Whether this figure shot frames the figure (decided at its first frame, never switched mid-shot). */
  private decided = false;
  private lookPlace: Place | null = null;
  private firedCues = 0;
  private firedActs = 0;
  /** The last camera pose and, in a hand-off shot, the one it started from. */
  private last: CameraPose | null = null;
  private from: CameraPose | null = null;
  private closeOn = false;
  private readonly cues: Cue[];

  constructor(readonly scene: Scene, private readonly host: RigHost) {
    this.length = scene.shots.reduce((sum, s) => sum + s.dur, 0);
    this.cues = [...(scene.cues ?? [])].sort((a, b) => a.at - b.at);
  }

  get done() {
    return this.t >= this.length;
  }

  get shot(): Shot | undefined {
    return this.scene.shots[this.shotIndex];
  }

  /** Advances by `dt` real seconds and returns the cues that fell due. */
  advance(dt: number): Cue[] {
    if (!this.held) this.t = Math.min(this.length, this.t + dt);
    let start = 0;
    let index = this.scene.shots.length - 1;
    for (let i = 0; i < this.scene.shots.length; i += 1) {
      if (this.t < start + this.scene.shots[i]!.dur) {
        index = i;
        break;
      }
      start += this.scene.shots[i]!.dur;
    }
    if (index !== this.shotIndex) {
      this.shotIndex = index;
      this.shotStart = start;
      // A cut: the new subject is framed at once, not swung to.
      this.place = null;
      this.lookPlace = null;
      this.cuts += 1;
      this.focus = 0;
      this.decided = false;
      this.from = null;
      this.closeOn = false;
      this.firedActs = 0;
    }
    const due: Cue[] = [];
    while (this.firedCues < this.cues.length && this.cues[this.firedCues]!.at <= this.t) due.push(this.cues[this.firedCues++]!);
    return due;
  }

  /** The camera for this frame, or null when the subject has never been found. */
  camera(dt: number): CameraPose | null {
    const pose = this.frame(dt);
    if (pose) {
      if (!this.focus) this.focus = pose.focus;
      pose.focus = this.focus;
      this.last = pose;
    }
    return pose;
  }

  private frame(dt: number): CameraPose | null {
    const shot = this.shot;
    if (!shot) return null;
    const k = ease(shot.ease, (this.t - this.shotStart) / shot.dur);
    const cam = shot.cam;
    if (cam.type === 'home') {
      // From where the last shot left the camera into the battle camera: position, aim and lens all ease together.
      const to = this.host.homeEye?.();
      this.from ??= this.last;
      const a = this.from;
      if (!to || !a) return a;
      const m = (x: number, y: number) => x + (y - x) * k;
      return { px: m(a.px, to.px), py: m(a.py, to.py), pz: m(a.pz, to.pz), lx: m(a.lx, to.lx), ly: m(a.ly, to.ly), lz: m(a.lz, to.lz), fov: m(a.fov, to.fov), roll: a.roll * (1 - k), focus: m(a.focus, to.focus) };
    }
    if (cam.type === 'figure') {
      const figure = this.host.figure?.(cam.who) ?? null;
      // Close or wide is decided at the cut: a figure that loads mid-shot never swings the camera onto him.
      if (!this.decided) {
        this.decided = true;
        this.closeOn = !!figure;
      }
      if (this.closeOn) {
        this.place = this.follow(this.place, figure, dt, 2.2);
        if (!this.place) return null;
        return compose({ ...shot, cam: { type: 'track', at: cam.at, from: cam.from, to: cam.to, look: cam.look } }, k, this.place, this.host);
      }
      this.place = this.follow(this.place, locate(cam.at, this.host), dt);
      return this.place ? compose({ ...shot, cam: cam.fallback }, k, this.place, this.host) : null;
    }
    this.place = this.follow(this.place, locate(cam.at, this.host), dt);
    if (!this.place) return null;
    if (cam.type === 'track' && cam.lookAt) this.lookPlace = this.follow(this.lookPlace, locate(cam.lookAt, this.host), dt);
    return compose({ ...shot, cam }, k, this.place, this.host, this.lookPlace);
  }

  /** Whether the running shot is a close-up on a figure that is on screen. */
  get onFigure() {
    return this.closeOn;
  }

  /** The figure acts due by now in the running shot, each once. */
  acts(): Act[] {
    const shot = this.shot;
    if (!shot?.acts) return [];
    const local = this.t - this.shotStart;
    const due: Act[] = [];
    while (this.firedActs < shot.acts.length && shot.acts[this.firedActs]!.at <= local) due.push(shot.acts[this.firedActs++]!);
    return due;
  }

  /**
   * A critically damped spring toward the subject (angular rate `rate`, heading at half). Height follows faster: the
   * deck's heave is already smooth (the wave field is sampled per frame) and a lagging lens would lose his face on a
   * rough sea. Second order: the sim's fixed steps in x/z come out as a smooth glide.
   */
  private follow(was: Place | null, now: Place | null, dt: number, rate = 2): Place | null {
    if (!now) return was;
    if (!was) {
      this.vel = { x: 0, y: 0, z: 0, h: 0 };
      return { ...now };
    }
    const v = this.vel;
    const step = (x: number, target: number, vel: number, w: number): [number, number] => {
      // Exact critically damped step (Game Programming Gems 4, 'smooth damp').
      const e = Math.exp(-w * dt);
      const d = x - target;
      const temp = (vel + w * d) * dt;
      return [target + (d + temp) * e, (vel - w * temp) * e];
    };
    const h = was.heading + wrap(now.heading - was.heading);
    let x, y, z, hd;
    [x, v.x] = step(was.x, now.x, v.x, rate);
    [z, v.z] = step(was.z, now.z, v.z, rate);
    [y, v.y] = step(was.y, now.y, v.y, Math.max(6, rate * 3));
    [hd, v.h] = step(was.heading, h, v.h, rate / 2);
    return { x, y, z, heading: hd, size: now.size };
  }

  /** Captions showing now with how far each is through its time (0..1). */
  captions(): { caption: Caption; age: number }[] {
    const out: { caption: Caption; age: number }[] = [];
    for (const c of this.scene.captions) if (this.t >= c.at && this.t < c.at + c.dur) out.push({ caption: c, age: this.t - c.at });
    return out;
  }

  /** How black the frame is: the scene's fade in and out and its black spans. */
  black() {
    const s = this.scene;
    let b = 0;
    if (s.fadeIn) b = Math.max(b, 1 - this.t / s.fadeIn);
    if (s.fadeOut) b = Math.max(b, 1 - (this.length - this.t) / s.fadeOut);
    for (const [from, to] of s.black ?? []) {
      if (this.t < from - RAMP || this.t > to + RAMP) continue;
      b = Math.max(b, Math.min(1, (this.t - (from - RAMP)) / RAMP, (to + RAMP - this.t) / RAMP));
    }
    return Math.min(1, Math.max(0, b));
  }
}
