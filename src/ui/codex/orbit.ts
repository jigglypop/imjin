import { MathUtils, Vector3, type PerspectiveCamera } from 'three/webgpu';

/** Where the camera looks from: around a target point, or standing on deck at an eye that rides the ship. */
export type OrbitPose = { x: number; y: number; z: number; yaw: number; pitch: number; distance: number };

const ROTATE = 0.0055;
const PITCH_MIN = -0.04;
const PITCH_MAX = 1.35;
/** Seconds after the last touch before an orbit the player switched on starts turning again. */
const RESUME = 6;
/** Radians a second of the slow turntable. */
const TURN = 0.11;

/**
 * The codex camera: drag to turn around the ship, wheel or pinch to come closer, right-drag or two fingers to slide
 * along it, and a slow turntable when left alone. On deck it stands at an eye point and the drag turns the head
 * instead. Smoothed toward its goal every frame, so keys, buttons and the hotspots can just set the goal.
 */
export class Orbit {
  readonly goal: OrbitPose = { x: 0, y: 4, z: 0, yaw: 1, pitch: 0.15, distance: 80 };
  private readonly pose: OrbitPose = { ...this.goal };
  /** The slow turn around the ship the player can switch off. */
  autoRotate = true;
  minDistance = 8;
  maxDistance = 400;
  /** The target stays within this distance of `home`, so sliding never loses the ship. */
  reach = 60;
  readonly home = new Vector3();
  /** On deck: the eye in world space, set by the scene every frame before update(). */
  deck: Vector3 | null = null;
  /** Field of view on deck: a wheel or a pinch narrows it instead of moving the eye. */
  deckFov = 60;
  /** Field of view around the ship. The size comparison narrows it, so the ships keep their proportions side by side. */
  orbitFov = 32;
  /** Called whenever the player moves the camera, so the scene can stop flying it somewhere. */
  onInput: (() => void) | null = null;
  private fov = 32;
  private idle = 0;
  private dom: HTMLElement | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private panning = false;
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly look = new Vector3();

  constructor(private readonly camera: PerspectiveCamera) {}

  attach(dom: HTMLElement) {
    this.dom = dom;
    dom.addEventListener('pointerdown', this.onDown);
    dom.addEventListener('pointermove', this.onMove);
    dom.addEventListener('pointerup', this.onUp);
    dom.addEventListener('pointercancel', this.onUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', this.onMenu);
  }

  detach() {
    const dom = this.dom;
    if (!dom) return;
    dom.removeEventListener('pointerdown', this.onDown);
    dom.removeEventListener('pointermove', this.onMove);
    dom.removeEventListener('pointerup', this.onUp);
    dom.removeEventListener('pointercancel', this.onUp);
    dom.removeEventListener('wheel', this.onWheel);
    dom.removeEventListener('contextmenu', this.onMenu);
    this.dom = null;
  }

  /** Jumps (immediate) or glides to a pose. */
  set(p: Partial<OrbitPose>, immediate = false) {
    Object.assign(this.goal, p);
    this.goal.pitch = MathUtils.clamp(this.goal.pitch, PITCH_MIN, PITCH_MAX);
    if (immediate) Object.assign(this.pose, this.goal);
  }

  rotate(dyaw: number, dpitch: number) {
    this.touched();
    this.goal.yaw += dyaw;
    this.goal.pitch = MathUtils.clamp(this.goal.pitch + dpitch, this.deck ? -1.2 : PITCH_MIN, this.deck ? 1.2 : PITCH_MAX);
  }

  zoom(factor: number) {
    this.touched();
    if (this.deck) this.deckFov = MathUtils.clamp(this.deckFov * factor, 22, 78);
    else this.goal.distance = MathUtils.clamp(this.goal.distance * factor, this.minDistance, this.maxDistance);
  }

  /** Slides the target across the screen by a pixel offset, at the scale of the current distance. */
  pan(dx: number, dy: number) {
    if (this.deck) return;
    this.touched();
    const k = (this.pose.distance * 2 * Math.tan(MathUtils.degToRad(this.fov / 2))) / Math.max(1, this.dom?.clientHeight ?? 800);
    this.right.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this.up.setFromMatrixColumn(this.camera.matrixWorld, 1);
    const g = this.goal;
    const x = g.x - (this.right.x * dx - this.up.x * dy) * k;
    const y = g.y - (this.right.y * dx - this.up.y * dy) * k;
    const z = g.z - (this.right.z * dx - this.up.z * dy) * k;
    // Kept within reach of the ship and above the water.
    const ox = x - this.home.x;
    const oz = z - this.home.z;
    const d = Math.hypot(ox, oz);
    const s = d > this.reach ? this.reach / d : 1;
    g.x = this.home.x + ox * s;
    g.z = this.home.z + oz * s;
    g.y = MathUtils.clamp(y, 0.5, this.home.y + this.reach * 0.5);
  }

  private touched() {
    this.idle = RESUME;
    this.onInput?.();
  }

  private onMenu = (e: Event) => e.preventDefault();

  private onDown = (e: PointerEvent) => {
    this.dom?.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.panning = e.pointerType === 'mouse' && (e.button === 2 || e.button === 1 || e.shiftKey);
    this.pinch = 0;
    this.touched();
  };

  private onMove = (e: PointerEvent) => {
    const last = this.pointers.get(e.pointerId);
    if (!last) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    last.x = e.clientX;
    last.y = e.clientY;
    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const span = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (this.pinch > 0 && span > 0) this.zoom(this.pinch / span);
      this.pinch = span;
      // Each finger moves the midpoint by half its own step.
      this.pan(dx / 2, dy / 2);
      return;
    }
    if (this.panning) this.pan(dx, dy);
    // On deck the view follows the finger, as when dragging a panorama: the head turns against the drag.
    else if (this.deck) this.rotate(-dx * ROTATE * 0.6, dy * ROTATE * 0.6);
    else this.rotate(dx * ROTATE, dy * ROTATE * 0.7);
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.pinch = 0;
    if (!this.pointers.size) this.panning = false;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoom(Math.exp(e.deltaY * 0.0012));
  };

  update(dt: number) {
    const g = this.goal;
    const p = this.pose;
    this.idle = Math.max(0, this.idle - dt);
    if (this.autoRotate && !this.deck && this.idle <= 0 && !this.pointers.size) g.yaw += dt * TURN;
    const k = 1 - Math.exp(-dt * 6);
    const kr = 1 - Math.exp(-dt * 9);
    p.x += (g.x - p.x) * k;
    p.y += (g.y - p.y) * k;
    p.z += (g.z - p.z) * k;
    p.distance += (g.distance - p.distance) * k;
    p.yaw += (g.yaw - p.yaw) * kr;
    p.pitch += (g.pitch - p.pitch) * kr;
    const cam = this.camera;
    const fov = this.deck ? this.deckFov : this.orbitFov;
    if (Math.abs(fov - this.fov) > 0.01) {
      this.fov += (fov - this.fov) * k;
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    const cp = Math.cos(p.pitch);
    if (this.deck) {
      // The eye rides the ship's heave and roll; the view stays level, so the horizon does not swing.
      cam.position.copy(this.deck);
      this.look.set(Math.cos(p.yaw) * cp, Math.sin(p.pitch), Math.sin(p.yaw) * cp).add(this.deck);
    } else {
      cam.position.set(p.x + Math.cos(p.yaw) * cp * p.distance, p.y + Math.sin(p.pitch) * p.distance, p.z + Math.sin(p.yaw) * cp * p.distance);
      // Never under the swell: a camera at the waterline looks up at the hull instead.
      cam.position.y = Math.max(cam.position.y, 1.6);
      this.look.set(p.x, p.y, p.z);
    }
    cam.lookAt(this.look);
    cam.updateMatrixWorld();
  }
}
