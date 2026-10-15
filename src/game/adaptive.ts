import { CPU_STEP_MAX, LEVEL_MAX } from './quality';

// Frame-rate controller for the run-time quality level. It moves in both directions:
//   - Below 46 fps for two seconds, and the GPU is the bottleneck: one level down.
//   - Below 46 fps for two seconds, and the main thread is the bottleneck: one CPU step down (CPU_STEPS: fewer particles,
//     fewer shadow redraws) and the level stays, as a lower level only spares the GPU. When the engine's own update and
//     render fill most of each frame, the main thread is what holds it; that is only judged where the GPU time is known
//     too (WebGPU), since a WebGL2 frame can wait for the GPU inside render() and pass for main-thread time.
//   - At 57 fps or more for six seconds (twelve from level 2 up), or the GPU has spare time: one level up. A CPU step
//     that was given up comes back first, and only on the frame rate itself.
//   - A level or CPU step that just failed is not climbed back to for a minute, so it does not flip back and forth.
// A low frame rate alone is not a reason to drop. A display or battery-saver cap at 30 fps leaves the GPU idle,
// and then the level stays. GPU time comes from onSubmittedWorkDone. On WebGL2 it is unknown, and the frame rate
// decides alone, with one exception: a steady 30 fps is read as a refresh cap (iOS Low Power Mode, a 30 Hz display),
// not as a GPU limit, so it neither drops the level nor counts as headroom. A GPU-bound phone on a 60 Hz screen looks the
// same, so after eight such seconds one level is dropped as a probe: if the frame rate rises the drop stays, if it is still 30 fps the cap is real and the level is restored for good. The climb stops at the equipment tier's
// top level, so a phone never reaches the resolution and refraction levels. Frames longer than 0.25 s (loading, tab switches) are ignored, and so are the first seconds after
// the battle starts, while shaders are still compiling.

const DROP_FPS = 46;
const CLIMB_FPS = 57;
const WARMUP_SECONDS = 8;
const HITCH_SECONDS = 0.25;
/** A frame interval this close to 1/30 s counts as locked to a 30 Hz cap. */
const CAP30_MIN = 0.029;
const CAP30_MAX = 0.038;
const CAP30_SHARE = 0.85;
/** A steady 30 fps this many windows in a row is probed: one level down, to tell a refresh cap from a GPU limit. */
const CAP_PROBE_WINDOWS = 8;
/** Windows to watch after the probe drop before judging it. */
const CAP_PROBE_JUDGE = 5;
const FAILED_HOLD_SECONDS = 60;
/** GPU completion time above this share of a frame means the GPU is what limits the frame rate. */
const GPU_BOUND_SHARE = 0.7;
/** Main-thread time above this share of a frame means the main thread is what limits it (and the GPU time read is late). */
const CPU_BOUND_SHARE = 0.7;
/** Below this GPU time, the GPU has room for a heavier level even when the frame rate is capped. */
const GPU_HEADROOM_MS = 6;

export class AdaptiveQuality {
  private level: number;
  private enabled: boolean;
  private warmup = WARMUP_SECONDS;
  private windowTime = 0;
  private windowFrames = 0;
  private windowLocked = 0;
  private gpuSum = 0;
  private gpuCount = 0;
  private cpuSum = 0;
  private cpuCount = 0;
  private slow = 0;
  private fast = 0;
  /** Windows in a row at the climbing frame rate, which alone brings a CPU step back. */
  private brisk = 0;
  private cooldown = 0;
  private cpuStep = CPU_STEP_MAX;
  /** Seconds before a CPU step that just failed may be taken back. */
  private cpuHold = 0;
  private capWindows = 0;
  /** The level held before a cap probe dropped one, while the probe is running. */
  private probeFrom: number | null = null;
  private probeWindows = 0;
  /** A probe showed the 30 fps is a real cap: it is not probed again. */
  private capConfirmed = false;
  /** Levels that failed recently, with the seconds left before climbing back to them is allowed. */
  private readonly failed = new Map<number, number>();

  constructor(
    start: number,
    enabled: boolean,
    private readonly apply: (level: number) => void,
    /** The highest level the controller may climb to. */
    private readonly maxLevel = LEVEL_MAX,
    /** Applies a CPU step (CPU_STEPS); the top one gives up nothing. */
    private readonly applyCpu: (step: number) => void = () => undefined,
  ) {
    this.level = start;
    this.enabled = enabled;
  }

  get current() {
    return this.level;
  }

  get auto() {
    return this.enabled;
  }

  /** Hands control back to the frame-rate controller. The current level stays until the controller moves it. */
  setAuto(on: boolean) {
    this.enabled = on;
    this.probeFrom = null;
    this.resetWindow();
    this.resetCounters();
  }

  /** Pins a level and turns automatic control off, with nothing given up for the CPU. */
  pin(level: number) {
    this.enabled = false;
    this.probeFrom = null;
    this.setCpu(CPU_STEP_MAX);
    this.set(level);
  }

  /**
   * Call once per rendered frame: the frame time in seconds, the GPU completion time when it is known, and the time the
   * engine's update and render took on the main thread.
   */
  update(dt: number, gpuMs: number | null = null, cpuMs: number | null = null) {
    if (dt > HITCH_SECONDS) return;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.cpuHold = Math.max(0, this.cpuHold - dt);
    for (const [level, left] of this.failed) {
      if (left - dt <= 0) this.failed.delete(level);
      else this.failed.set(level, left - dt);
    }
    if (!this.enabled) return;
    if (this.warmup > 0) {
      this.warmup -= dt;
      return;
    }
    this.windowTime += dt;
    this.windowFrames += 1;
    if (dt >= CAP30_MIN && dt <= CAP30_MAX) this.windowLocked += 1;
    if (gpuMs !== null) {
      this.gpuSum += gpuMs;
      this.gpuCount += 1;
    }
    if (cpuMs !== null) {
      this.cpuSum += cpuMs;
      this.cpuCount += 1;
    }
    if (this.windowTime < 1) return;
    const fps = this.windowFrames / this.windowTime;
    const gpu = this.gpuCount > 0 ? this.gpuSum / this.gpuCount : null;
    const cpu = this.cpuCount > 0 ? this.cpuSum / this.cpuCount : null;
    const capped = gpu === null && this.windowLocked >= CAP30_SHARE * this.windowFrames;
    this.resetWindow();
    this.capWindows = capped ? this.capWindows + 1 : 0;
    if (this.probeFrom !== null && ++this.probeWindows >= CAP_PROBE_JUDGE) {
      // Still locked at 30 one level lower: the cap is real, so give the level back and stop probing.
      const from = this.probeFrom;
      this.probeFrom = null;
      if (capped) {
        this.capConfirmed = true;
        this.set(from);
        this.cooldown = 6;
        return;
      }
      this.failed.set(from, FAILED_HOLD_SECONDS);
    }
    // The GPU's completion is only noticed once the main thread is free, so a busy main thread reads as a busy GPU: the
    // main thread is asked first.
    const cpuBound = gpu !== null && cpu !== null && cpu > CPU_BOUND_SHARE * (1000 / fps);
    // Unknown GPU time (WebGL2) counts as busy, so the frame rate decides alone there, unless the frames are locked to 30 Hz.
    const gpuBound = !capped && !cpuBound && (gpu === null || gpu > GPU_BOUND_SHARE * (1000 / fps));
    const headroom = !cpuBound && gpu !== null && gpu < GPU_HEADROOM_MS && fps >= 25;
    this.slow = fps < DROP_FPS && (gpuBound || cpuBound) ? this.slow + 1 : 0;
    this.fast = fps >= CLIMB_FPS || headroom ? this.fast + 1 : 0;
    this.brisk = fps >= CLIMB_FPS ? this.brisk + 1 : 0;
    if (this.cooldown > 0) return;
    // A steady 30 fps on WebGL2 may be a GPU-bound phone on a 60 Hz screen, which looks the same as a cap.
    if (this.capWindows >= CAP_PROBE_WINDOWS && !this.capConfirmed && this.probeFrom === null && this.level > 0) {
      this.probeFrom = this.level;
      this.probeWindows = 0;
      this.set(this.level - 1);
      this.cooldown = 4;
      return;
    }
    if (this.slow >= 2 && cpuBound) {
      // With nothing left to give up for the CPU, the level still stays: it would not buy any speed.
      if (this.cpuStep > 0) {
        this.cpuHold = FAILED_HOLD_SECONDS;
        this.setCpu(this.cpuStep - 1);
        this.cooldown = 4;
      }
      return;
    }
    if (this.slow >= 2 && this.level > 0) {
      this.failed.set(this.level, FAILED_HOLD_SECONDS);
      this.set(this.level - 1);
      this.cooldown = 4;
      return;
    }
    const needed = this.level < 2 ? 6 : 12;
    if (this.cpuStep < CPU_STEP_MAX) {
      if (this.brisk >= needed && this.cpuHold === 0) {
        this.setCpu(this.cpuStep + 1);
        this.cooldown = 6;
      }
      return;
    }
    if (this.fast >= needed && this.level < this.maxLevel && !this.failed.has(this.level + 1)) {
      this.set(this.level + 1);
      this.cooldown = 6;
    }
  }

  private set(level: number) {
    this.level = Math.max(0, Math.min(LEVEL_MAX, level));
    this.resetWindow();
    this.resetCounters();
    this.apply(this.level);
  }

  private setCpu(step: number) {
    if (step === this.cpuStep) return;
    this.cpuStep = step;
    this.resetWindow();
    this.resetCounters();
    this.applyCpu(step);
  }

  private resetWindow() {
    this.windowTime = 0;
    this.windowFrames = 0;
    this.windowLocked = 0;
    this.gpuSum = 0;
    this.gpuCount = 0;
    this.cpuSum = 0;
    this.cpuCount = 0;
  }

  private resetCounters() {
    this.slow = 0;
    this.fast = 0;
    this.brisk = 0;
    this.capWindows = 0;
  }
}
