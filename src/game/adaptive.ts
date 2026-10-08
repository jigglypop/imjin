import { LEVEL_MAX } from './quality';

// Frame-rate controller for the run-time quality level. It moves in both directions:
//   - Below 46 fps for two seconds, and the GPU is the bottleneck: one level down.
//   - At 57 fps or more for six seconds (twelve from level 2 up), or the GPU has spare time: one level up.
//   - A level that just failed is not climbed back to for a minute, so the level does not flip back and forth.
// A low frame rate alone is not a reason to drop. A display or battery-saver cap at 30 fps leaves the GPU idle,
// and then the level stays. GPU time comes from onSubmittedWorkDone. On WebGL2 it is unknown, and the frame rate
// decides alone. Frames longer than 0.25 s (loading, tab switches) are ignored, and so are the first seconds after
// the battle starts, while shaders are still compiling.

const DROP_FPS = 46;
const CLIMB_FPS = 57;
const WARMUP_SECONDS = 8;
const HITCH_SECONDS = 0.25;
const FAILED_HOLD_SECONDS = 60;
/** GPU completion time above this share of a frame means the GPU is what limits the frame rate. */
const GPU_BOUND_SHARE = 0.7;
/** Below this GPU time, the GPU has room for a heavier level even when the frame rate is capped. */
const GPU_HEADROOM_MS = 6;

export class AdaptiveQuality {
  private level: number;
  private enabled: boolean;
  private warmup = WARMUP_SECONDS;
  private windowTime = 0;
  private windowFrames = 0;
  private gpuSum = 0;
  private gpuCount = 0;
  private slow = 0;
  private fast = 0;
  private cooldown = 0;
  /** Levels that failed recently, with the seconds left before climbing back to them is allowed. */
  private readonly failed = new Map<number, number>();

  constructor(
    start: number,
    enabled: boolean,
    private readonly apply: (level: number) => void,
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
    this.resetWindow();
    this.resetCounters();
  }

  /** Pins a level and turns automatic control off. */
  pin(level: number) {
    this.enabled = false;
    this.set(level);
  }

  /** Call once per rendered frame: the frame time in seconds, and the GPU completion time when it is known. */
  update(dt: number, gpuMs: number | null = null) {
    if (dt > HITCH_SECONDS) return;
    this.cooldown = Math.max(0, this.cooldown - dt);
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
    if (gpuMs !== null) {
      this.gpuSum += gpuMs;
      this.gpuCount += 1;
    }
    if (this.windowTime < 1) return;
    const fps = this.windowFrames / this.windowTime;
    const gpu = this.gpuCount > 0 ? this.gpuSum / this.gpuCount : null;
    this.resetWindow();
    // Unknown GPU time (WebGL2) counts as busy, so the frame rate decides alone there.
    const gpuBound = gpu === null || gpu > GPU_BOUND_SHARE * (1000 / fps);
    const headroom = gpu !== null && gpu < GPU_HEADROOM_MS && fps >= 25;
    this.slow = fps < DROP_FPS && gpuBound ? this.slow + 1 : 0;
    this.fast = fps >= CLIMB_FPS || headroom ? this.fast + 1 : 0;
    if (this.cooldown > 0) return;
    if (this.slow >= 2 && this.level > 0) {
      this.failed.set(this.level, FAILED_HOLD_SECONDS);
      this.set(this.level - 1);
      this.cooldown = 4;
      return;
    }
    const needed = this.level < 2 ? 6 : 12;
    if (this.fast >= needed && this.level < LEVEL_MAX && !this.failed.has(this.level + 1)) {
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

  private resetWindow() {
    this.windowTime = 0;
    this.windowFrames = 0;
    this.gpuSum = 0;
    this.gpuCount = 0;
  }

  private resetCounters() {
    this.slow = 0;
    this.fast = 0;
  }
}
