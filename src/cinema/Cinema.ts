import type { Ship } from '../sim/types';
import { CHAPTER_INTROS } from './scenes/chapters';
import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { CameraPose as RtsPose, RtsCamera } from '../camera/RtsCamera';
import { atmosphere } from '../render/atmosphere';
import type { SkyPresetName } from '../render/sky';
import { waveField } from '../ocean/waves';
import type { Battle } from '../sim/battle';
import type { Command } from '../sim/commands';
import type { ScenarioId } from '../sim/scenarios';
import type { BattleEvent, Team } from '../sim/types';
import { beatFor, formationBeat, type Beat, type BeatMemory } from './beats';
import { Cast, type CastHost } from './cast';
import { setLook } from './grade';
import { CutscenePlayer } from './CutscenePlayer';
import { locate, type CameraPose, type RigHost } from './rig';
import { HANSAN_INTRO, MYEONGNYANG_INTRO } from './scenes/intros';
import { NORYANG_INTRO, NORYANG_OUTRO } from './scenes/noryang';
import type { Caption, Cue, Scene, Target } from './types';

/** What the cinema reads from and drives in the engine. */
export interface CinemaHost {
  readonly battle: Battle;
  readonly team: Team;
  readonly remote: unknown;
  readonly rts: RtsCamera;
  readonly camera: PerspectiveCamera;
  readonly views: { heaveOf(id: number): number; pose(s: Ship): { x: number; z: number; heading: number } };
  /** The historical battle being played, null in a capture-point battle. */
  scenarioKey(): ScenarioId | null;
  setSky(name: SkyPresetName): unknown;
  homePose(): RtsPose;
  /** The sound side: the bed up and the battle down by `hush` while a scene runs, null when it ends; drum strokes. */
  sound: { cinema(hush: number | null): void; drums(count: number): void };
  /** Where the commanders' figures are put for the close-ups; absent where there are none (a gallery, a test). */
  readonly cast?: CastHost;
}

const INTROS: Partial<Record<ScenarioId, Scene>> = { noryang: NORYANG_INTRO, hansan: HANSAN_INTRO, myeongnyang: MYEONGNYANG_INTRO, ...CHAPTER_INTROS };
const OUTROS: Partial<Record<ScenarioId, Scene>> = { noryang: NORYANG_OUTRO };
const INTRO_KEY = 'imjin.cutscenes';
const DOC_KEY = 'imjin.documentary';
const BASE_FOV = 42;
/** Real seconds between the end of a battle and its closing scene, so the last ship can go down first. */
const OUTRO_DELAY = 2.5;
/** Seconds of quiet after one beat before the next may start. */
const BEAT_GAP = 6;
/** The whole frame opened up in a commander's close-up, per light: his face must read even under cloud or the moon. */
const EXPOSURE = { day: 1.3, overcast: 1.6, dusk: 1.55, night: 2.1 } as const;
const SKY_FILL = { day: 1.3, overcast: 1.6, dusk: 1.5, night: 1.7 } as const;

function stored(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function store(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Private mode: the choice lasts for this page.
  }
}

/** Automated runs (the probes, the screenshot scripts) see the battle as before unless they ask for a scene. */
function automated() {
  return typeof navigator !== 'undefined' && navigator.webdriver && new URLSearchParams(location.search).get('cutscene') !== '1';
}

type Running = { player: CutscenePlayer; kind: 'cutscene' | 'beat'; camera: boolean };

/**
 * Cutscenes and the documentary mode, rendered in the engine from the running battle.
 *  - A cutscene (a battle's opening, its closing) takes the camera, letterboxes the frame, grades it like film and
 *    plays its captions; the battle runs at real speed under it. Space holds it, Esc skips it.
 *  - The documentary mode runs the director's cinematic camera and, at the turning points of the fight, short beats:
 *    a shot of the event and a caption naming the maneuver. Any camera input hands the camera back; captions go on.
 *  - Online nothing takes the camera and nothing holds the battle: captions only.
 */
export class Cinema implements RigHost {
  /** Openings and closings of the historical battles (영상 연출). */
  intros = stored(INTRO_KEY, true);
  /** The documentary mode (다큐멘터리 모드). */
  documentary = typeof location !== 'undefined' && new URLSearchParams(location.search).get('doc') === '1' ? true : stored(DOC_KEY, false);
  private running: Running | null = null;
  private cast: Cast | null = null;
  private queue: Beat | null = null;
  private memory: BeatMemory = { fired: new Set(), routing: [] };
  private cooled = new Map<string, number>();
  private clock = 0;
  private quietUntil = 0;
  private endedAt = -1;
  private outroDone = false;
  /** Openings already shown on this page: a restart goes straight to the battle. */
  private readonly opened = new Set<string>();
  private letter = 0;
  private gradeLevel = 0;
  private exposureLevel = 1;
  private pose: CameraPose | null = null;
  /** Bumped when what the overlay shows changes, so it re-renders only then. */
  version = 0;
  private readonly tmp = new Vector3();

  constructor(private readonly host: CinemaHost) {}

  get ctx() {
    return { battle: this.host.battle, team: this.host.team, event: this.eventShip };
  }

  private eventShip = 0;

  /** A ship as drawn (interpolated between sim steps), so the camera follows what is on screen. */
  poseOf(s: Ship) {
    return this.host.views.pose(s);
  }

  heaveOf(id: number) {
    return this.host.views.heaveOf(id);
  }

  ground(x: number, z: number) {
    return this.host.rts.ground(x, z);
  }

  water(x: number, z: number) {
    return waveField.heightAt(x, z);
  }

  private seenCuts = 0;

  figure(who: string) {
    return this.cast?.place(who) ?? null;
  }

  homeEye() {
    const e = this.host.rts.eyeOf(this.host.homePose());
    return { ...e, fov: BASE_FOV, roll: 0, focus: Math.hypot(e.px - e.lx, e.py - e.ly, e.pz - e.lz) };
  }

  /** The portrait to inset with a commander's line: none while his figure is on deck in a close-up. */
  lightBearing() {
    const d = atmosphere.sunDir.value as Vector3;
    return Math.atan2(d.z, d.x);
  }

  /** A full scene is on screen: the HUD steps aside and input waits. */
  get covering() {
    return this.running?.kind === 'cutscene';
  }

  /** The camera is the cinema's this frame. */
  get ownsCamera() {
    return !!this.running?.camera;
  }

  /** The documentary camera is filming the battle: the HUD steps aside until the player takes the camera back. */
  get filming() {
    return this.documentary && !this.host.remote && this.host.rts.cinematic && !this.covering && !this.host.battle.ended;
  }

  /** The player takes command: the documentary camera stops; its captions go on. */
  takeCommand() {
    this.host.rts.cinematic = false;
    this.version += 1;
  }

  get held() {
    return !!this.running?.player.held;
  }

  /** Letterbox bars, 0..1. */
  get letterbox() {
    return this.letter;
  }

  /** How much of the film grade to lay over the picture, 0..1. */
  get grade() {
    return this.gradeLevel;
  }

  /** Exposure multiplier: raised for the whole frame in a commander's close-up (owner 2026-10-18), 1 otherwise. */
  get exposure() {
    return this.exposureLevel;
  }

  /** The sky's share of the light, raised with the exposure in a close-up (a soft fill from the battle's own sky). */
  get skyFill() {
    return this.exposureLevel === 1 ? 1 : SKY_FILL[this.running?.player.scene.castLight ?? 'day'];
  }

  /** How black the frame is, 0..1. */
  get black() {
    return this.running?.camera || this.running?.kind === 'cutscene' ? this.running.player.black() : 0;
  }

  /** Lens opening of the current shot (0: no depth of field) and the distance it focuses at. */
  get depthOfField() {
    const shot = this.running?.camera ? this.running.player.shot : undefined;
    return { aperture: shot?.aperture ?? 0, focus: this.pose?.focus ?? 100 };
  }

  get progress() {
    const r = this.running;
    return r && r.kind === 'cutscene' ? { t: r.player.t, length: r.player.length, id: r.player.scene.id } : null;
  }

  captions(): { caption: Caption; age: number }[] {
    return this.running ? this.running.player.captions() : [];
  }

  /** Where a label's subject is on screen, in CSS pixels, or null when it is behind the camera or gone. */
  screenOf(target: Target, width: number, height: number) {
    const p = locate(target, this);
    if (!p) return null;
    const v = this.tmp.set(p.x, p.y + 30, p.z).project(this.host.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height };
  }

  setIntros(on: boolean) {
    this.intros = on;
    store(INTRO_KEY, on);
    this.version += 1;
  }

  setDocumentary(on: boolean) {
    this.documentary = on;
    store(DOC_KEY, on);
    if (!this.host.remote) this.host.rts.cinematic = on;
    if (!on && this.running?.kind === 'beat') this.finish(false);
    this.version += 1;
  }

  /** A new battle is on screen: forget the last one and open with its scene, if it has one. */
  begin() {
    this.finish(false);
    this.queue = null;
    this.memory = { fired: new Set(), routing: [] };
    this.cooled.clear();
    this.endedAt = -1;
    this.outroDone = false;
    this.quietUntil = this.clock + 4;
    if (this.documentary && !this.host.remote) this.host.rts.cinematic = true;
    const key = this.host.scenarioKey();
    const intro = key ? INTROS[key] : undefined;
    if (intro && this.intros && !automated() && !this.opened.has(intro.id)) {
      this.opened.add(intro.id);
      this.play(intro);
    }
  }

  /** Plays a scene now (also the hook the screenshot scripts use: `__engine.cinema.play('noryang-outro')`). */
  play(scene: Scene | string) {
    const found = typeof scene === 'string' ? [...Object.values(INTROS), ...Object.values(OUTROS)].find((s) => s?.id === scene) : scene;
    if (!found) return false;
    this.start(found, 'cutscene', 0);
    return true;
  }

  private start(scene: Scene, kind: Running['kind'], event: number) {
    if (this.running) this.finish(false);
    // Online a scene is its captions over the player's own view: it neither covers the battle nor waits for anyone.
    if (this.host.remote) kind = 'beat';
    this.eventShip = event;
    // Online the cinema never takes the camera or holds the battle; a beat takes it only while the documentary camera runs.
    const camera = !this.host.remote && (kind === 'cutscene' || this.host.rts.cinematic);
    this.running = { player: new CutscenePlayer(scene, this), kind, camera };
    this.seenCuts = 0;
    this.pose = null;
    if (kind === 'cutscene') setLook(scene.castLight ?? 'day');
    if (camera && kind === 'cutscene' && scene.cast && this.host.cast) this.cast = new Cast(this.host.cast, scene.cast, scene.castLight ?? 'day', this.ctx);
    if (kind === 'cutscene') {
      this.host.sound.cinema(0);
    }
    this.version += 1;
  }

  /** Ends the running scene; a skipped or finished cutscene hands the camera back. */
  private finish(resetView: boolean) {
    const r = this.running;
    if (!r) return;
    this.running = null;
    this.cast?.dispose();
    this.cast = null;
    if (r.kind === 'cutscene') {
      this.host.sound.cinema(null);
    }
    if (r.camera) {
      const { camera, rts } = this.host;
      camera.fov = BASE_FOV;
      camera.updateProjectionMatrix();
      if (r.kind === 'cutscene' && resetView && r.player.scene.id.endsWith('intro')) rts.setPose(this.host.homePose(), true);
      else if (this.pose) {
        // Carry on from where the scene left the camera, a little higher, so the player is not dropped into the water.
        const p = this.pose;
        const dist = Math.max(160, Math.hypot(p.px - p.lx, p.py - p.ly, p.pz - p.lz));
        const pitch = Math.min(1.2, Math.max(0.2, Math.asin(Math.min(1, Math.max(-1, (p.py - p.ly) / dist)))));
        rts.setPose({ tx: p.lx, tz: p.lz, yaw: Math.atan2(p.pz - p.lz, p.px - p.lx), pitch, distance: dist }, true);
      }
    }
    this.quietUntil = this.clock + BEAT_GAP;
    this.version += 1;
  }

  skip() {
    if (this.running?.kind === 'cutscene') this.finish(true);
  }

  togglePause() {
    const r = this.running;
    if (r?.kind === 'cutscene' && !this.host.remote) {
      r.player.held = !r.player.held;
      this.version += 1;
    }
  }

  /** The player gave an order: a formation is a maneuver worth naming. */
  onCommand(cmd: Command) {
    if (cmd.type !== 'formation' || !this.documentary) return;
    const b = formationBeat(cmd.kind, { ...this.ctx, event: cmd.ids[0] ?? 0 });
    if (b) this.offer(b);
  }

  /** Each frame's observed sim events. */
  feed(events: BattleEvent[]) {
    if (!this.documentary || this.covering) return;
    const scenario = this.host.scenarioKey();
    for (const e of events) {
      const ship = 'ship' in e ? e.ship : 0;
      const b = beatFor(e, { ...this.ctx, event: ship }, scenario, this.memory);
      if (b) this.offer(b);
    }
  }

  private offer(b: Beat) {
    if (b.once && this.memory.fired.has(b.key)) return;
    if (this.clock < (this.cooled.get(b.key) ?? -Infinity)) return;
    if (!this.queue || b.priority > this.queue.priority) this.queue = b;
  }

  /** Battle speed this frame: a cutscene plays at real time (its own slow motion, 0 while held); a beat may slow it. */
  speed(base: number) {
    const r = this.running;
    if (!r || this.host.remote) return base;
    const shot = r.player.shot;
    if (r.kind === 'cutscene') return r.player.held ? 0 : shot?.slow ?? 1;
    return r.camera && shot?.slow ? Math.min(base, shot.slow) : base;
  }

  /** Per frame, in real time. Returns true when the cinema placed the camera this frame. */
  update(dt: number): boolean {
    this.clock += dt;
    const b = this.host.battle;
    // The closing scene follows a won battle that has one.
    if (b.ended && this.endedAt < 0) this.endedAt = this.clock;
    const key = this.host.scenarioKey();
    const outro = key ? OUTROS[key] : undefined;
    if (outro && !this.outroDone && this.endedAt >= 0 && this.clock - this.endedAt > OUTRO_DELAY && b.winner === 'joseon' && this.intros && !automated() && !this.host.remote) {
      this.outroDone = true;
      this.start(outro, 'cutscene', 0);
    }
    if (!this.running && this.queue && this.clock >= this.quietUntil && !b.ended) {
      const beat = this.queue;
      this.queue = null;
      this.memory.fired.add(beat.key);
      this.cooled.set(beat.key, this.clock + beat.cooldown);
      this.start(beat.scene, 'beat', beat.ship);
    }
    const r = this.running;
    let placed = false;
    if (r) {
      for (const cue of r.player.advance(dt)) this.cue(cue);
      for (const a of r.player.acts()) this.cast?.act(a.who, a.move);
      const cut = r.player.cuts !== this.seenCuts;
      if (cut) {
        this.seenCuts = r.player.cuts;
        this.cast?.reveal();
      }
      const shot = r.player.shot;
      this.cast?.update(dt, this.ctx, shot?.cam.type === 'figure' ? shot.cam.who : null);
      // Any camera input during a beat (it turns the director's camera off) hands the camera back at once.
      if (r.kind === 'beat' && r.camera && !this.host.rts.cinematic) {
        r.camera = false;
        this.version += 1;
      }
      if (r.camera) {
        const pose = r.player.camera(dt);
        if (pose) {
          this.apply(pose);
          this.pose = pose;
          placed = true;
        }
      }
      // The close-up's exposure is set at the cut (a change within a shot reads as the light pumping).
      if (cut || !r.camera) this.exposureLevel = r.camera && r.player.onFigure ? EXPOSURE[r.player.scene.castLight ?? 'day'] * (r.player.shot?.expose ?? 1) : 1;
      if (r.player.done) this.finish(r.kind === 'cutscene');
    }
    if (!this.running) this.exposureLevel = 1;
    const wantLetter = this.covering || this.filming ? 1 : 0;
    this.letter += (wantLetter - this.letter) * (1 - Math.exp(-dt * 3));
    // The film grade is the openings' alone: play (and the documentary camera) keeps the battle's own picture.
    const wantGrade = this.covering ? 1 : 0;
    this.gradeLevel += (wantGrade - this.gradeLevel) * (1 - Math.exp(-dt * 2));
    return placed;
  }

  private cue(cue: Cue) {
    switch (cue.kind) {
      case 'drums':
        this.host.sound.drums(cue.count);
        break;
      case 'hush':
        this.host.sound.cinema(cue.depth);
        break;
      case 'sky':
        this.host.setSky(cue.name);
        break;
    }
  }

  private apply(p: CameraPose) {
    const cam = this.host.camera;
    cam.position.set(p.px, p.py, p.pz);
    cam.up.set(0, 1, 0);
    cam.lookAt(p.lx, p.ly, p.lz);
    if (p.roll) cam.rotateZ(p.roll);
    if (Math.abs(cam.fov - p.fov) > 0.01) {
      cam.fov = p.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }
}
