import type { PerspectiveCamera } from 'three/webgpu';
import type { BattleEvent } from '../sim/types';
import type { Battle } from '../sim/battle';
import type { CueKind } from '../fx/sinkPlan';
import { Battlefield, type CampaignCue } from './battlefield';
import { buildBus, MASTER_GAIN } from './voices';
import { Ambience, makeNoise } from './ambience';
import { Bed } from './music';
import { woodTap } from './ui';
import { LEVELS, type Mode } from './mix';
import { isIOS } from '../game/device';

const MUSIC_KEY = 'imjin.music';

/** The music bed is on unless the player turned it off (`?music=0` does it for a session, `setMusic` for good). */
function storedMusic() {
  try {
    if (new URLSearchParams(location.search).get('music') === '0') return false;
    return localStorage.getItem(MUSIC_KEY) !== '0';
  } catch {
    return true;
  }
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ambience: GainNode | null = null;
  private music: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private noise: AudioBuffer | null = null;
  private field: Battlefield | null = null;
  private bed: Bed | null = null;
  private weather: Ambience | null = null;
  private mode: Mode = 'select';
  muted = false;
  /** The drone and far drums under the menus and battles; off for players who want only the sea and the guns. */
  musicOn = storedMusic();
  /** The page went to the background and the context was suspended on purpose, so the retry loop leaves it alone. */
  private suspendedByPage = false;
  private lastWake = 0;
  private lastClick = -1;
  /** iOS decodes the sample bank only once the first battle is up, so the decode does not add to the load's memory peak. */
  private samplesAllowed = !isIOS;
  private samplesRequested = false;

  constructor() {
    // iOS only lets a context start from touchend or click, not from touchstart, and an interruption (a call, another
    // app taking the audio) leaves it suspended until the next gesture. The listeners therefore stay for good: each one
    // creates the context on first use and resumes it whenever it is not running.
    const start = () => {
      this.init();
      this.wake();
    };
    for (const type of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'keydown'] as const) {
      window.addEventListener(type, start, { passive: true, capture: true });
    }
    document.addEventListener('visibilitychange', () => {
      const ctx = this.ctx;
      if (!ctx) return;
      if (document.hidden) {
        this.suspendedByPage = true;
        void ctx.suspend().catch(() => undefined);
      } else {
        this.suspendedByPage = false;
        this.wake();
      }
    });
  }

  /** Resumes a context that is not running. Safe to call as often as a gesture arrives. */
  private wake() {
    const ctx = this.ctx;
    if (!ctx || this.suspendedByPage || ctx.state === 'running') return;
    this.lastWake = performance.now();
    void ctx.resume().catch(() => undefined);
  }

  /** The first battle is ready: on iOS this is when the sample bank starts to decode. */
  allowSamples() {
    this.samplesAllowed = true;
    if (this.ctx) this.loadSamples();
  }

  private loadSamples() {
    if (!this.samplesAllowed || this.samplesRequested || !this.field) return;
    this.samplesRequested = true;
    void this.field.load(import.meta.env.BASE_URL);
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  private init() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    const bus = buildBus(ctx, this.muted ? 0 : MASTER_GAIN);
    const master = bus.master;
    this.master = master;
    this.reverb = bus.reverb;
    this.sfx = bus.sfx;
    this.ambience = ctx.createGain();
    this.ambience.gain.value = LEVELS.select.ambience;
    // Heavy salvos push the sea and wind down for a moment so the guns stay in front.
    const ambienceDuck = ctx.createGain();
    this.ambience.connect(ambienceDuck).connect(master);
    this.field = new Battlefield(ctx, bus.sfx, bus.reverb, [{ node: ambienceDuck, depth: 0.35 }]);
    this.loadSamples();
    this.music = ctx.createGain();
    this.music.gain.value = 0;
    this.music.connect(master);
    this.music.connect(this.reverb);
    this.noise = makeNoise(ctx);
    this.weather = new Ambience(ctx, this.noise, this.ambience, this.sfx);
    this.bed = new Bed(ctx, this.music, this.reverb, this.noise);
    this.bed.start();
    this.applyMode(true);
    window.setInterval(() => {
      if (ctx.state === 'running' && this.musicOn) this.bed?.schedule(ctx.currentTime + 0.5, this.mode);
      // After a phone call or another app's audio the context can come back 'interrupted' with no gesture to resume it.
      if (ctx.state !== 'running' && !document.hidden && performance.now() - this.lastWake > 2000) this.wake();
    }, 250);
  }

  setMode(mode: Mode) {
    this.mode = mode;
    this.applyMode(false);
  }

  private applyMode(instant: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.music || !this.ambience) return;
    const t = ctx.currentTime;
    const tc = instant ? 0.01 : 1.2;
    const level = LEVELS[this.mode];
    this.music.gain.setTargetAtTime(this.musicOn ? level.music : 0, t, tc);
    this.ambience.gain.setTargetAtTime(level.ambience, t, tc);
  }

  setRoar(level: number) {
    this.weather?.setRoar(level);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.1);
  }

  /** Turns the music bed on or off and remembers the choice. */
  setMusic(on: boolean) {
    this.musicOn = on;
    try {
      localStorage.setItem(MUSIC_KEY, on ? '1' : '0');
    } catch {
      // Private mode: the choice lasts for the session.
    }
    this.applyMode(false);
  }

  /** A tap of wood. Held to one per 60 ms, so a burst of clicks (a drag across a list) is not a buzz. */
  click() {
    const ctx = this.ctx;
    if (!ctx || this.muted || !this.noise || !this.sfx) return;
    const t = ctx.currentTime + 0.005;
    if (t - this.lastClick < 0.06) return;
    this.lastClick = t;
    woodTap(ctx, this.sfx, this.noise, t);
  }

  /** Called every frame: near-field housekeeping, the speed of the battle and how hot the battle is. */
  tick(_battle: Battle, camera: PerspectiveCamera, scaled: number) {
    const field = this.field;
    if (!this.ctx || !field || this.muted) return;
    field.tick(camera, scaled);
    this.weather?.setRumble(field.intensity);
  }

  /** The script of a sinking ship (see sinkPlan.ts) and the last moment of it, as the effects reach each cue. */
  cue(kind: CueKind, x: number, y: number, z: number, size: number) {
    if (!this.muted) this.field?.cue(kind, x, y, z, size);
  }

  /** Called when a battle is set up on the running engine. */
  newBattle() {
    this.field?.newBattle();
  }

  drums(count = 3) {
    this.field?.drums(count);
  }

  /** A cue of the faction campaign's map and dialogs. Silent when muted. */
  campaign(cue: CampaignCue) {
    if (this.muted || !this.ctx || !this.field) return;
    this.field.campaignCue(cue);
    if (cue === 'move') this.click();
  }

  update(events: BattleEvent[], battle: Battle, camera: PerspectiveCamera, _dt: number) {
    if (!this.muted) this.field?.update(events, battle, camera);
  }
}

export const sound = new Sound();
