// What a battle sounds like: turns the sim's events into voices. The recorded samples (samples.ts) are the main sound;
// the synthesised voices (voices.ts) cover until the bank has decoded and any kind that failed to load. Everything
// here runs against any BaseAudioContext, so scripts/render-sounds.mjs renders the same code offline.

import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { BattleEvent, GunType } from '../sim/types';
import type { Battle } from '../sim/battle';
import { GUN_CLASS, gunClass, type GunClass } from '../fx/gunClass';
import type { CueKind } from '../fx/sinkPlan';
import { isPhone, isTouchDevice } from '../game/device';
import { COST, ranged, SPEED_OF_SOUND, Voices, type Tier } from './voices';
import { BANK, Samples, SAMPLE_NODES, type Kind, type PlayOptions } from './samples';

type GunBank = 'cannon_heavy' | 'cannon_medium' | 'cannon_small';
const GUN_BANK: Record<GunType, GunBank> = {
  cheonja: 'cannon_heavy',
  jija: 'cannon_heavy',
  hyeonja: 'cannon_medium',
  folangji: 'cannon_medium',
  ozutsu: 'cannon_medium',
  hwangja: 'cannon_small',
  seungja: 'cannon_small',
  hudun: 'cannon_small',
};

/**
 * Past this range a shot is not given a voice of its own; the far shots of a moment share one rolling boom. The RTS
 * camera sits 800 m or more from most of a fleet fight, so the line is drawn there: closer than this the report is a
 * real gun, muffled by range, and only what is really on the horizon is the rolling distance.
 */
const FAR_RANGE = 900;
/** A ship that fires this many guns within BROADSIDE_WINDOW seconds is a broadside, not a string of single shots. */
const BROADSIDE_GUNS = 4;
const BROADSIDE_WINDOW = 0.5;
/** Seconds a sample voice is counted as alive in the node ledger. */
const SAMPLE_SECS = 4;

type Gunfire = { s: ReturnType<typeof ranged>; gun: GunType; cls: GunClass; bank: GunBank; key: number; score: number };
/** A level that falls off with range more slowly than the synth's, so a battle further away still carries. */
const loud = (gain: number) => Math.pow(gain, 0.75);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** A node that dips for a moment under a big salvo, by `depth` (0..1) at full strength. */
export type Duck = { node: GainNode; depth: number };

export class Battlefield {
  private readonly samples: Samples;
  readonly voices: Voices;
  /** Musket volleys go through their own gain so a heavy salvo can push them down. */
  private readonly musketBus: GainNode;
  private readonly ducks: Duck[];
  private duckedUntil = 0;
  /** Voice allowance, refilled in real time so a fast-forwarded battle cannot spend a minute of voices in one frame. */
  private budget = 24;
  private lastCtxTime = 0;
  private lastWall = 0;
  /** How many times faster than real time the battle runs (smoothed). */
  private timeScale = 1;
  /** Voices still sounding, so the WebAudio graph stays under a node cap (lower on phones). */
  private readonly live: { end: number; nodes: number }[] = [];
  private readonly nodeCap = isPhone ? 260 : isTouchDevice ? 420 : 900;
  private readonly volleys = new Map<number, Gunfire[]>();
  private readonly ships = new Map<number, { times: number[]; muteUntil: number; nextBroadside: number }>();
  private readonly musketLast = new Map<number, number>();
  private musketEnds: number[] = [];
  private farCount = 0;
  private farPan = 0;
  private nextFlush = 0;
  private nextBarrage = 0;
  /** Context time of the last voice the player could hear from the near field or the far flush. */
  private lastAudible = -99;
  private camera: Pick<PerspectiveCamera, 'position' | 'quaternion'> | null = null;
  /** Guns fired recently, decaying with a ~4 s memory. */
  private recent = 0;
  /** 0..1 how hot the battle is. */
  intensity = 0;
  private readonly tmp = new Vector3();
  private readonly right = new Vector3();
  private readonly rel = new Vector3();

  constructor(
    private readonly ctx: BaseAudioContext,
    sfx: AudioNode,
    reverb: AudioNode,
    ducks: Duck[] = [],
  ) {
    this.voices = new Voices(ctx, sfx, reverb);
    this.samples = new Samples(ctx, sfx, reverb);
    this.musketBus = ctx.createGain();
    this.musketBus.connect(sfx);
    this.ducks = [...ducks, { node: this.musketBus, depth: 0.55 }];
  }

  /** A new battle starts: forget the old one's ships (ids restart from 1, so stale state would silence new ships) and volleys. */
  newBattle() {
    this.volleys.clear();
    this.ships.clear();
    this.musketLast.clear();
    this.musketEnds = [];
    this.farCount = 0;
    this.nextFlush = 0;
    this.nextBarrage = 0;
    this.recent = 0;
    this.intensity = 0;
  }

  load(base: string) {
    return this.samples.load(base, isPhone);
  }

  private spatial(camera: Pick<PerspectiveCamera, 'position' | 'quaternion'>, x: number, y: number, z: number) {
    const dist = this.tmp.set(x, y, z).distanceTo(camera.position);
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this.tmp.sub(camera.position).normalize();
    const s = ranged(dist, this.tmp.dot(this.right));
    // At high speed the shot and its report would drift apart by seconds; compress the lag with the time scale.
    s.delay /= Math.pow(Math.max(1, this.timeScale), 0.6);
    return s;
  }

  /** Reserve nodes for a voice that sounds from `at` for `secs`. False when the graph is full. */
  private reserve(nodes: number, secs: number, at: number) {
    const now = this.ctx.currentTime;
    let total = nodes;
    for (let i = this.live.length - 1; i >= 0; i -= 1) {
      const v = this.live[i]!;
      if (v.end < now) this.live.splice(i, 1);
      else total += v.nodes;
    }
    if (total > this.nodeCap) return false;
    this.live.push({ end: at + secs, nodes });
    return true;
  }

  /** Full detail close up, thinner with range, and one step thinner again on a phone or when the graph is busy. */
  private tierFor(dist: number): Tier {
    let rank = dist > 900 ? 2 : dist > 350 ? 1 : 0;
    if (isPhone) rank += 1;
    if (this.live.length > 40) rank += 1;
    return rank >= 2 ? 'lite' : rank === 1 ? 'mid' : 'full';
  }

  /** Chance that a small sound is voiced at all: all of them at normal speed, fewer as the battle runs faster. */
  private keep() {
    return this.timeScale > 2.5 ? Math.max(0.15, 2.5 / this.timeScale) : 1;
  }

  /** Plays a sample if it is loaded and loud enough to matter. Returns its length in seconds, 0 if it did not play. */
  private sample(kind: Kind, t: number, o: PlayOptions, cost = 1) {
    if (o.gain * BANK[kind].gain < 0.02 || this.budget < cost || !this.samples.has(kind) || !this.reserve(SAMPLE_NODES, SAMPLE_SECS, t)) return 0;
    this.budget -= cost;
    return this.samples.play(kind, t, o);
  }

  /** The music-free mix gives way to the guns: ambience and musketry dip for a moment under a heavy report. */
  private duck(t: number, strength: number) {
    if (t < this.duckedUntil || strength < 0.2) return;
    this.duckedUntil = t + 0.6;
    for (const { node, depth } of this.ducks) {
      node.gain.setTargetAtTime(1 - depth * Math.min(1, strength), t, 0.03);
      node.gain.setTargetAtTime(1, t + 0.35, 0.5);
    }
  }

  private fire(e: Extract<BattleEvent, { type: 'gun' | 'battery' }>, camera: Pick<PerspectiveCamera, 'position' | 'quaternion'>): Gunfire {
    const s = this.spatial(camera, e.x, e.y, e.z);
    const gun: GunType = e.type === 'gun' ? e.gun : 'jija';
    const cls = e.type === 'gun' ? gunClass(e.gun, e.big) : GUN_CLASS.jija;
    return { s, gun, cls, bank: GUN_BANK[gun], key: e.type === 'gun' ? e.ship : -1 - e.point, score: s.gain * (0.5 + cls.weight) };
  }

  /** Called every frame: the speed of the battle, the voice allowance, the far boom and how hot the battle is. */
  tick(camera: Pick<PerspectiveCamera, 'position' | 'quaternion'>, scaled: number, wall = performance.now()) {
    const ctx = this.ctx;
    this.camera = camera;
    const real = Math.min(0.25, Math.max(0, (wall - this.lastWall) / 1000));
    this.lastWall = wall;
    if (real > 0) this.timeScale += (Math.max(1, scaled / real) - this.timeScale) * 0.15;
    const now = ctx.currentTime;
    this.budget = Math.min(24, this.budget + (now - this.lastCtxTime) * 36);
    this.lastCtxTime = now;
    this.recent *= Math.exp(-real / 4);
    this.intensity += (Math.min(1, this.recent / 12) - this.intensity) * Math.min(1, real * 0.8);

    if (this.farCount && now >= this.nextFlush) {
      const gain = Math.min(1, 0.35 + 0.15 * Math.sqrt(this.farCount));
      if (this.sample('cannon_far', now + 0.05, { gain, pan: this.farPan / this.farCount, rate: rnd(0.95, 1.05), wet: 0.15 }, 0.3)) this.lastAudible = now;
      this.farCount = 0;
      this.farPan = 0;
      this.nextFlush = now + 0.3;
    }
    // A hot battle with nothing near enough to hear still rolls on the horizon.
    if (this.intensity > 0.4 && now - this.lastAudible > 2 && now >= this.nextBarrage) {
      const gain = Math.min(0.95, (0.55 + 0.4 * this.intensity) * rnd(0.8, 1));
      this.sample('cannon_far', now + 0.05, { gain, pan: rnd(-0.8, 0.8), rate: rnd(0.93, 1.07), wet: 0.15 }, 0.3);
      this.nextBarrage = now + rnd(1.5, 4);
    }
  }

  /** One gun's report from the bank: any file of the class, a little detuned, filtered by range. */
  private single(f: Gunfire, t: number, mult = 1) {
    const gain = loud(f.s.gain) * mult;
    const rate = rnd(0.92, 1.08) * (f.gun === 'cheonja' ? 0.94 : 1);
    const len = this.sample(f.bank, t, { gain, pan: f.s.pan, rate, cutoff: Math.max(900, f.s.muffle) });
    if (len && gain > 0.15) this.lastAudible = this.ctx.currentTime;
    if (len && f.bank === 'cannon_heavy') this.duck(t, gain * 1.2);
    return len;
  }

  private broadside(f: Gunfire, t: number) {
    const gain = loud(f.s.gain);
    const len = this.sample('broadside', t, { gain, pan: f.s.pan, rate: rnd(0.95, 1.05), cutoff: Math.max(900, f.s.muffle) }, 1.5);
    if (len && gain > 0.15) this.lastAudible = this.ctx.currentTime;
    if (len) this.duck(t, gain * 1.4);
    return len > 0;
  }

  /** The synthesised report, for a gun class whose files are not loaded. */
  private synthGroup(group: Gunfire[], now: number) {
    const { s, cls } = group[0]!;
    const tier = this.tierFor(s.dist);
    const cost = COST[tier];
    const t0 = now + s.delay + Math.random() * 0.02;
    if (this.budget < 1 || !this.reserve(cost.nodes, cost.secs, t0)) return;
    this.budget -= 1;
    const swell = Math.min(1.8, 1 + 0.4 * Math.log(group.length));
    this.voices.cannon(t0, { ...s, gain: s.gain * swell }, cls, tier);
    // The other guns of the broadside follow within a fraction of a second, a lighter voice each.
    const extra = Math.min(group.length - 1, isPhone ? 2 : 4);
    for (let i = 1; i <= extra; i += 1) {
      const r = group[i]!;
      const t1 = now + r.s.delay + Math.random() * 0.15;
      const lite = this.tierFor(r.s.dist) === 'full' ? 'mid' : 'lite';
      if (this.budget < 0.4 || !this.reserve(COST[lite].nodes, COST[lite].secs, t1)) break;
      this.budget -= 0.4;
      this.voices.cannon(t1, { ...r.s, gain: r.s.gain * 0.75 }, r.cls, lite);
    }
  }

  /** The reports of one ship in one frame. */
  private ship(group: Gunfire[], now: number) {
    const best = group[0]!;
    if (!this.samples.has(best.bank)) {
      this.synthGroup(group, now);
      return;
    }
    const key = best.key;
    let state = this.ships.get(key);
    if (!state) this.ships.set(key, (state = { times: [], muteUntil: 0, nextBroadside: 0 }));
    for (let i = 0; i < group.length; i += 1) state.times.push(now);
    while (state.times.length && state.times[0]! < now - BROADSIDE_WINDOW) state.times.shift();
    if (state.times.length >= BROADSIDE_GUNS && now >= state.nextBroadside && this.samples.has('broadside')) {
      if (this.broadside(best, now + best.s.delay + Math.random() * 0.02)) {
        state.nextBroadside = now + 2;
        state.muteUntil = now + 1;
      }
    }
    // Under a broadside the medium and small guns of the ship are already in it; the heavy ones still speak.
    const muted = now < state.muteUntil;
    let played = 0;
    for (const f of group) {
      if (muted && f.bank !== 'cannon_heavy') continue;
      if (played >= (isPhone ? 3 : 6)) break;
      if (this.single(f, now + f.s.delay + (played ? rnd(0, 0.12) : rnd(0, 0.02)), played ? 0.85 : 1)) played += 1;
    }
  }

  /** A round that will pass close to the camera: a whoosh at the moment of closest approach. */
  private whoosh(e: Extract<BattleEvent, { type: 'shot' }>, camera: Pick<PerspectiveCamera, 'position' | 'quaternion'>, now: number) {
    const rel = this.rel.set(e.x - camera.position.x, e.y - camera.position.y, e.z - camera.position.z);
    const v2 = e.vx * e.vx + e.vy * e.vy + e.vz * e.vz;
    if (v2 < 1) return;
    const ts = -(rel.x * e.vx + rel.y * e.vy + rel.z * e.vz) / v2;
    if (ts <= 0 || ts >= 3) return;
    rel.set(rel.x + e.vx * ts, rel.y + e.vy * ts, rel.z + e.vz * ts);
    const dist = rel.length();
    if (dist > 90) return;
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const side = Math.max(-0.85, Math.min(0.85, (rel.dot(this.right) / Math.max(dist, 12)) * 0.9));
    const at = now + ts / this.timeScale + dist / SPEED_OF_SOUND;
    const gain = 0.55 + 0.45 * (1 - dist / 90);
    if (this.samples.has('whoosh')) this.sample('whoosh', at, { gain, pan: side, rate: rnd(0.9, 1.1), wet: 0.1 }, 0.5);
    else if (this.budget >= 1 && this.reserve(COST.whiz.nodes, COST.whiz.secs, at)) {
      this.budget -= 0.5;
      this.voices.whiz(at, { gain: 0.5, pan: side, muffle: 9000, dist: 0 }, side);
    }
  }

  /** The script of a sinking ship (see sinkPlan.ts) and the last moment of it, as the effects reach each cue. */
  cue(kind: CueKind, x: number, y: number, z: number, size: number) {
    const camera = this.camera;
    if (!camera) return;
    const s = this.spatial(camera, x, y, z);
    if (s.gain < 0.03 || this.budget < 1) return;
    const at = this.ctx.currentTime + s.delay + Math.random() * 0.02;
    const voices = this.voices;
    if (kind === 'groan' && this.samples.has('creak')) {
      this.sample('creak', at, { gain: loud(s.gain) * (0.5 + 0.5 * size), pan: s.pan, rate: rnd(0.85, 1.1), cutoff: Math.max(900, s.muffle) });
      return;
    }
    if (kind === 'blast' && this.samples.has('explosion')) {
      this.sample('explosion', at, { gain: loud(s.gain) * (0.5 + 0.4 * size), pan: s.pan, rate: rnd(0.95, 1.1), cutoff: Math.max(900, s.muffle) }, 1.5);
      return;
    }
    const cost = kind === 'groan' ? COST.groan : kind === 'crack' || kind === 'wreck' ? COST.crack : kind === 'mast' ? COST.mast : kind === 'blast' ? COST.explosion : kind === 'bubbles' ? COST.bubbles : COST.gurgle;
    if (!this.reserve(cost.nodes, cost.secs, at)) return;
    this.budget -= 0.8;
    if (kind === 'groan') voices.groan(at, s, size);
    else if (kind === 'crack') voices.planks(at, s, size);
    else if (kind === 'wreck') voices.planks(at, s, size * 0.6);
    else if (kind === 'mast') voices.mast(at, s);
    else if (kind === 'blast') voices.explosion(at, s, 0.5 + size * 0.5);
    else if (kind === 'bubbles') voices.bubbles(at, s, 1.6 + size * 1.6, size);
    else if (kind === 'plunge') {
      voices.bubbles(at, s, 2.8, 1);
      if (!this.sample('splash', at, { gain: loud(s.gain), pan: s.pan, rate: 0.85, cutoff: Math.max(900, s.muffle) })) voices.splash(at, s, 1.6);
    } else voices.gurgle(at, s, size);
  }

  drums(count = 3) {
    const now = this.ctx.currentTime + 0.05;
    for (let i = 0; i < count; i += 1) {
      const t = now + i * 0.42;
      if (!this.sample('drum', t, { gain: 1, wet: 0.2 }, 0)) this.voices.drum(t);
    }
  }

  update(events: BattleEvent[], battle: Pick<Battle, 'get'>, camera: Pick<PerspectiveCamera, 'position' | 'quaternion'>) {
    const voices = this.voices;
    const samples = this.samples;
    this.camera = camera;
    const now = this.ctx.currentTime;
    const keep = this.keep();
    // Gun reports are gathered per ship first: a broadside is one rolling volley, and when the voice allowance is
    // short the big, near guns get it ahead of the small, far ones.
    const volleys = this.volleys;
    volleys.clear();
    for (const e of events) {
      if (e.type === 'musket') this.recent += 0.3;
      if (e.type !== 'gun' && e.type !== 'battery') continue;
      this.recent += 1;
      const f = this.fire(e, camera);
      if (f.s.dist > FAR_RANGE) {
        this.farCount += 1;
        this.farPan += f.s.pan;
        continue;
      }
      if (f.bank !== 'cannon_heavy' && Math.random() > keep) continue;
      const v = volleys.get(f.key);
      if (v) v.push(f);
      else volleys.set(f.key, [f]);
    }
    if (volleys.size) {
      for (const group of volleys.values()) group.sort((a, b) => b.score - a.score);
      const order = [...volleys.values()].sort((a, b) => b[0]!.score - a[0]!.score);
      for (const group of order) this.ship(group, now);
    }
    if (this.ships.size > 80) for (const [key, st] of this.ships) if (st.times.length === 0 && st.muteUntil < now) this.ships.delete(key);

    for (const e of events) {
      if (e.type === 'shot') {
        this.whoosh(e, camera, now);
        continue;
      }
      if (this.budget < 0.5) break;
      if (e.type === 'musket') {
        const s = this.spatial(camera, e.x, e.y, e.z);
        if (s.gain < 0.03 || Math.random() > keep) continue;
        if (samples.has('musket_volley')) {
          this.musketEnds = this.musketEnds.filter((end) => end > now);
          // One volley per ship at a time, and no more than three at once: the muskets stay a texture under the guns.
          if (this.musketEnds.length >= 3 || now - (this.musketLast.get(e.ship) ?? -9) < 1.5) continue;
          this.musketLast.set(e.ship, now);
          const len = this.sample('musket_volley', now + s.delay, { gain: Math.min(1, 0.4 + e.count / 12) * s.gain, pan: s.pan, rate: rnd(0.95, 1.05), cutoff: Math.max(1500, s.muffle), dest: this.musketBus }, 1);
          if (len) this.musketEnds.push(now + s.delay + len);
          continue;
        }
        this.budget -= 1;
        for (let i = 0; i < Math.min(6, e.count); i += 1) voices.burst(now + s.delay + Math.random() * 0.45, s.gain * 0.4, s.pan, 'bandpass', Math.min(s.muffle, 2400), 0.9, 0.09);
      } else if (e.type === 'hit') {
        const s = this.spatial(camera, e.x, e.y, e.z);
        if (s.gain < 0.03 || (Math.random() > keep && e.damage < 10)) continue;
        const at = now + s.delay;
        const grape = e.ammo === 'grape';
        const k = Math.min(1, 0.5 + e.damage * 0.04);
        if (samples.has('impact_wood')) {
          this.sample('impact_wood', at, { gain: loud(s.gain) * k, pan: s.pan, rate: grape ? rnd(1.1, 1.2) : rnd(0.92, 1.08), cutoff: Math.max(900, s.muffle), index: grape ? 1 : undefined });
        } else if (this.reserve(COST.hit.nodes, COST.hit.secs, at)) {
          this.budget -= 1;
          voices.hit(at, s, e.damage);
        }
      } else if (e.type === 'splash') {
        const s = this.spatial(camera, e.x, 0, e.z);
        if (s.gain < 0.04 || Math.random() > keep) continue;
        const at = now + s.delay;
        if (samples.has('splash')) {
          this.sample('splash', at, { gain: loud(s.gain), pan: s.pan, rate: Math.max(0.85, Math.min(1.15, 1.15 - (e.size - 0.6) * 0.5)), cutoff: Math.max(900, s.muffle) }, 0.6);
        } else if (this.reserve(COST.splash.nodes, COST.splash.secs, at)) {
          this.budget -= 0.5;
          voices.splash(at, s, e.size);
        }
      } else if (e.type === 'ground') {
        const s = this.spatial(camera, e.x, e.y, e.z);
        if (s.gain < 0.04 || !this.reserve(COST.ground.nodes, COST.ground.secs, now + s.delay)) continue;
        this.budget -= 0.5;
        voices.ground(now + s.delay, s);
      } else if (e.type === 'ignite') {
        const ship = battle.get(e.ship);
        if (!ship) continue;
        const s = this.spatial(camera, ship.x, ship.spec.deck, ship.z);
        if (s.gain < 0.05 || !this.reserve(COST.ignite.nodes, COST.ignite.secs, now + s.delay)) continue;
        this.budget -= 0.8;
        voices.ignite(now + s.delay, s);
      } else if (e.type === 'explode') {
        const s = this.spatial(camera, e.x, e.y, e.z);
        const at = now + s.delay;
        if (samples.has('explosion')) {
          const gain = loud(s.gain);
          if (this.sample('explosion', at, { gain, pan: s.pan, rate: rnd(0.95, 1.05), cutoff: Math.max(900, s.muffle) }, 2)) this.duck(at, gain * 1.5);
        } else if (this.reserve(COST.explosion.nodes, COST.explosion.secs, at)) {
          this.budget -= 2;
          voices.explosion(at, s, 1.3);
        }
      } else if (e.type === 'ram') {
        const s = this.spatial(camera, e.x, 2, e.z);
        const at = now + s.delay;
        if (samples.has('impact_wood')) {
          const gain = loud(s.gain);
          this.sample('impact_wood', at, { gain: 0.7 * gain, pan: s.pan, rate: rnd(0.85, 0.95), cutoff: Math.max(900, s.muffle), index: 0 });
          this.sample('creak', at + 0.1, { gain, pan: s.pan, rate: rnd(0.9, 1.05), cutoff: Math.max(900, s.muffle) });
        } else {
          voices.burst(at, s.gain * 1.2, s.pan, 'lowpass', 700, 0.8, 0.8);
          voices.burst(at, s.gain * 0.6, s.pan, 'bandpass', 1600, 2, 0.4);
          voices.planks(at, s, 1);
        }
      } else if (e.type === 'sinking') {
        const ship = battle.get(e.ship);
        if (!ship) continue;
        const s = this.spatial(camera, ship.x, 2, ship.z);
        const gain = loud(s.gain);
        this.sample('sink', now + s.delay, { gain, pan: s.pan, cutoff: Math.max(900, s.muffle) }, 1);
        this.sample('creak', now + s.delay + 0.6, { gain, pan: s.pan, rate: rnd(0.85, 1), cutoff: Math.max(900, s.muffle) });
      } else if (e.type === 'board' || e.type === 'casualty') {
        if (e.type === 'casualty' && !e.melee) continue;
        const ship = battle.get(e.type === 'board' ? e.b : e.ship);
        if (!ship) continue;
        const s = this.spatial(camera, ship.x, 3, ship.z);
        if (s.gain < 0.05) continue;
        this.budget -= 0.5;
        for (let i = 0; i < 3; i += 1) voices.burst(now + s.delay + Math.random() * 0.3, s.gain * 0.3, s.pan, 'bandpass', 3200 + Math.random() * 1800, 8, 0.05);
      } else if (e.type === 'volley') {
        this.drums(1);
      }
    }
  }
}
