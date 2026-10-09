import { MathUtils, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { waveField } from '../ocean/waves';

export type CameraPose = { tx: number; tz: number; yaw: number; pitch: number; distance: number };

export class RtsCamera {
  target = new Vector3(0, 0, 0);
  yaw = 0;
  pitch = 0.35;
  distance = 300;
  goal = { tx: 0, tz: 0, yaw: 0, pitch: 0.35, distance: 300 };
  followId = 0;
  cinematic = false;
  /** Scales how fast the camera chases its goal. The battle director raises it to hold a moving subject, e.g. a shell. */
  rate = 1;
  /** Height above the usual look-at point; follows a shell through the air or a mast top. */
  lookLift = 0;
  private keys = new Set<string>();
  private dragging: 'orbit' | null = null;
  private lastX = 0;
  private lastY = 0;
  private dom: HTMLElement | null = null;
  readonly minDistance = 14;
  readonly maxDistance = 6500;
  ground: (x: number, z: number) => number = () => -50;

  constructor(private readonly camera: PerspectiveCamera) {}

  setPose(p: CameraPose, immediate = true) {
    this.goal = { ...p };
    if (immediate) {
      this.target.set(p.tx, 0, p.tz);
      this.yaw = p.yaw;
      this.pitch = p.pitch;
      this.distance = p.distance;
    }
  }

  attach(dom: HTMLElement) {
    this.dom = dom;
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach() {
    const dom = this.dom;
    if (!dom) return;
    dom.removeEventListener('wheel', this.onWheel);
    dom.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private onBlur = () => this.keys.clear();

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.0011);
    this.goal.distance = MathUtils.clamp(this.goal.distance * factor, this.minDistance, this.maxDistance);
    this.cinematic = false;
  };

  private onDown = (e: PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      this.dragging = 'orbit';
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.cinematic = false;
      e.preventDefault();
    }
  };

  private onMove = (e: PointerEvent) => {
    if (this.dragging !== 'orbit') return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.goal.yaw -= dx * 0.0045;
    this.goal.pitch = MathUtils.clamp(this.goal.pitch + dy * 0.0035, 0.02, 1.45);
  };

  private onUp = () => {
    this.dragging = null;
  };

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  /**
   * Drag the map by a screen-space offset in CSS pixels, so the ground under the finger stays under the finger.
   * Used by touch input. `viewportHeight` converts pixels to world units at the current zoom.
   */
  panScreen(dx: number, dy: number, viewportHeight: number) {
    // Visible world height at the target distance (vertical FOV 42°), spread over the viewport height.
    const k = (0.77 * this.goal.distance) / Math.max(1, viewportHeight);
    const fwdX = -Math.cos(this.goal.yaw);
    const fwdZ = -Math.sin(this.goal.yaw);
    const rightX = -fwdZ;
    const rightZ = fwdX;
    // Vertical pixels cover more ground when the camera looks down at a shallow angle.
    const depth = 1 / Math.max(0.35, Math.sin(this.goal.pitch));
    this.goal.tx += (-dx * rightX + dy * fwdX * depth) * k;
    this.goal.tz += (-dx * rightZ + dy * fwdZ * depth) * k;
    this.followId = 0;
    this.cinematic = false;
  }

  zoomBy(factor: number) {
    this.goal.distance = MathUtils.clamp(this.goal.distance * factor, this.minDistance, this.maxDistance);
    this.cinematic = false;
  }

  /** Positive turns the scene counter-clockwise when seen from above. */
  rotateBy(dyaw: number) {
    this.goal.yaw += dyaw;
    this.cinematic = false;
  }

  tiltBy(dpitch: number) {
    this.goal.pitch = MathUtils.clamp(this.goal.pitch + dpitch, 0.02, 1.45);
    this.cinematic = false;
  }

  private shakeAmount = 0;
  private shakeClock = 0;

  /**
   * Adds trauma. The offset grows with its square, so a pile of small shots stays a tremor while one big gun or a
   * magazine going up really throws the camera. The caller has already attenuated `amount` by distance.
   */
  shake(amount: number) {
    this.shakeAmount = Math.min(1.6, this.shakeAmount + amount);
  }

  update(dt: number, followTarget: Vector3 | null) {
    const k = this.keys;
    const pan = this.goal.distance * 0.9 * dt;
    let fx = 0;
    let fz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) fz += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fz -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
    if (fx || fz) {
      this.followId = 0;
      this.cinematic = false;
      const fwdX = -Math.cos(this.goal.yaw);
      const fwdZ = -Math.sin(this.goal.yaw);
      const rightX = -fwdZ;
      const rightZ = fwdX;
      this.goal.tx += (fwdX * fz + rightX * fx) * pan;
      this.goal.tz += (fwdZ * fz + rightZ * fx) * pan;
    }
    if (k.has('KeyQ')) this.goal.yaw += dt * 1.2;
    if (k.has('KeyE')) this.goal.yaw -= dt * 1.2;
    if (k.has('KeyR')) this.goal.pitch = Math.min(1.45, this.goal.pitch + dt * 0.8);
    if (k.has('KeyF')) this.goal.pitch = Math.max(0.02, this.goal.pitch - dt * 0.8);
    if (followTarget) {
      this.goal.tx = followTarget.x;
      this.goal.tz = followTarget.z;
    }
    const s = 1 - Math.exp(-dt * 6 * this.rate);
    const sr = 1 - Math.exp(-dt * 8 * this.rate);
    this.target.x += (this.goal.tx - this.target.x) * s;
    this.target.z += (this.goal.tz - this.target.z) * s;
    this.yaw += (this.goal.yaw - this.yaw) * sr;
    this.pitch += (this.goal.pitch - this.pitch) * sr;
    this.distance += (this.goal.distance - this.distance) * s;
    const groundY = Math.max(waveField.heightAt(this.target.x, this.target.z) * 0.4, this.ground(this.target.x, this.target.z));
    const lookY = groundY + Math.min(8, 2 + this.distance * 0.02) + this.lookLift;
    const cp = Math.cos(this.pitch);
    const px = this.target.x + Math.cos(this.yaw) * cp * this.distance;
    const pz = this.target.z + Math.sin(this.yaw) * cp * this.distance;
    let py = lookY + Math.sin(this.pitch) * this.distance;
    const water = waveField.heightAt(px, pz);
    const land = this.ground(px, pz);
    py = Math.max(py, water + 2.2, land + 12);
    this.camera.position.set(px, py, pz);
    this.camera.lookAt(this.target.x, lookY, this.target.z);
    if (this.shakeAmount > 0.002) {
      this.shakeClock += dt;
      const a = this.shakeAmount * this.shakeAmount;
      const t = this.shakeClock;
      // Angular jitter reads the same at any zoom; the positional part is scaled by distance so a far camera still moves.
      const reach = 0.25 + Math.min(1, this.distance / 120) * 0.75;
      this.camera.position.x += (Math.sin(t * 41) + Math.sin(t * 23.7)) * a * 0.22 * reach;
      this.camera.position.y += (Math.sin(t * 37.3) + Math.sin(t * 19.1)) * a * 0.18 * reach;
      this.camera.rotateX((Math.sin(t * 33.1) + Math.sin(t * 17.3)) * a * 0.009);
      this.camera.rotateY((Math.sin(t * 27.9) + Math.sin(t * 15.1)) * a * 0.009);
      this.camera.rotateZ(Math.sin(t * 29.5) * a * 0.016);
      this.shakeAmount *= Math.exp(-dt * 6);
    }
    this.camera.updateMatrixWorld();
  }
}
