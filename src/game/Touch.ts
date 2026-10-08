import type { Engine } from './Engine';
import { setSelectionBox } from '../state/store';

// Touch gestures for the battle view.
//   one finger drag   pan the camera (or draw a selection box when box mode is on)
//   one finger tap    select an own ship, or command the selection (move / attack)
//   two fingers       pinch zoom, twist rotate, slide sideways to pan, slide vertically to tilt
// Mouse input stays in Input. Pointers of type 'mouse' and 'pen' are ignored here.

type Pointer = { x: number; y: number; x0: number; y0: number; t0: number };

const TAP_SLOP = 12;
const TAP_MS = 350;
const TILT_PER_PX = 0.0035; // same scale as the mouse orbit drag

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class TouchControls {
  private readonly pointers = new Map<number, Pointer>();
  private dom: HTMLElement | null = null;
  private moved = false;
  private multi = false;
  private prev = { dist: 1, angle: 0, cx: 0, cy: 0 };

  constructor(private readonly engine: Engine) {}

  attach(dom: HTMLElement) {
    this.dom = dom;
    dom.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
  }

  detach() {
    const dom = this.dom;
    if (!dom) return;
    dom.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onCancel);
    this.pointers.clear();
    setSelectionBox(null);
  }

  private snapshot() {
    const [a, b] = [...this.pointers.values()] as [Pointer, Pointer];
    return { dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  private viewportHeight() {
    return this.dom?.clientHeight || 1;
  }

  private onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    // Event timestamps measure the finger, not how long the main thread took to get to the handler.
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: e.timeStamp });
    if (this.pointers.size === 1) {
      this.moved = false;
      this.multi = false;
    } else if (this.pointers.size === 2) {
      // A second finger turns the gesture into a camera gesture. It never produces a tap or a box.
      this.multi = true;
      this.moved = true;
      setSelectionBox(null);
      this.prev = this.snapshot();
    }
  };

  private onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    const rts = this.engine.rts;
    if (this.pointers.size >= 2) {
      const prev = this.prev;
      const cur = this.snapshot();
      this.prev = cur;
      rts.zoomBy(prev.dist / Math.max(1, cur.dist));
      // Clockwise finger rotation on screen should turn the scene clockwise too, which is a negative yaw step.
      rts.rotateBy(-wrapAngle(cur.angle - prev.angle));
      rts.panScreen(cur.cx - prev.cx, 0, this.viewportHeight());
      rts.tiltBy((cur.cy - prev.cy) * TILT_PER_PX);
      return;
    }
    let panX = dx;
    let panY = dy;
    if (!this.moved) {
      if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < TAP_SLOP) return;
      // Crossing the slop: pan by the full distance from the touch-down point so the map stays under the finger.
      this.moved = true;
      panX = e.clientX - p.x0;
      panY = e.clientY - p.y0;
    }
    if (this.engine.input.touchBox) {
      const rect = this.dom!.getBoundingClientRect();
      setSelectionBox({ x0: p.x0 - rect.left, y0: p.y0 - rect.top, x1: p.x - rect.left, y1: p.y - rect.top });
      return;
    }
    rts.panScreen(panX, panY, this.viewportHeight());
  };

  private onUp = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size > 0) return;
    setSelectionBox(null);
    if (this.multi) return;
    if (!this.moved) {
      if (e.timeStamp - p.t0 < TAP_MS) this.engine.input.tap(e.clientX, e.clientY);
      return;
    }
    if (this.engine.input.touchBox) {
      this.engine.input.boxSelect(Math.min(p.x0, e.clientX), Math.min(p.y0, e.clientY), Math.max(p.x0, e.clientX), Math.max(p.y0, e.clientY), false);
    }
  };

  private onCancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) setSelectionBox(null);
  };
}
