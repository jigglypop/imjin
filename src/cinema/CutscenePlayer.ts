import { compose, ease, locate, type CameraPose, type Place, type RigHost } from './rig';
import type { Caption, Cue, Scene, Shot } from './types';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Seconds a black span takes to fall and to lift. */
const RAMP = 0.6;

/**
 * Plays one scene: advances its clock in real time, picks the shot, follows the shot's subject with a little lag (a
 * camera operator's, so a ship rolling on the swell does not shake the frame), and says which captions and cues are due.
 */
export class CutscenePlayer {
  /** Seconds into the scene. */
  t = 0;
  held = false;
  readonly length: number;
  private shotIndex = -1;
  private shotStart = 0;
  private place: Place | null = null;
  private lookPlace: Place | null = null;
  private firedCues = 0;
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
    }
    const due: Cue[] = [];
    while (this.firedCues < this.cues.length && this.cues[this.firedCues]!.at <= this.t) due.push(this.cues[this.firedCues++]!);
    return due;
  }

  /** The camera for this frame, or null when the subject has never been found. */
  camera(dt: number): CameraPose | null {
    const shot = this.shot;
    if (!shot) return null;
    this.place = this.follow(this.place, locate(shot.cam.at, this.host), dt);
    if (!this.place) return null;
    if (shot.cam.type === 'track' && shot.cam.lookAt) this.lookPlace = this.follow(this.lookPlace, locate(shot.cam.lookAt, this.host), dt);
    const k = ease(shot.ease, (this.t - this.shotStart) / shot.dur);
    return compose(shot, k, this.place, this.host, this.lookPlace);
  }

  private follow(was: Place | null, now: Place | null, dt: number): Place | null {
    if (!now) return was;
    if (!was) return { ...now };
    const k = 1 - Math.exp(-dt * 3);
    const kh = 1 - Math.exp(-dt * 1.5);
    return { x: was.x + (now.x - was.x) * k, y: was.y + (now.y - was.y) * k, z: was.z + (now.z - was.z) * k, heading: was.heading + wrap(now.heading - was.heading) * kh, size: now.size };
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
