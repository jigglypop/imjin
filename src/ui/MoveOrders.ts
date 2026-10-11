import { Vector2 } from 'three/webgpu';
import type { Engine } from '../game/Engine';

type Mark = { root: HTMLDivElement; x: number; z: number; at: number };

/** Screen-sized feedback stays readable above waves at any camera distance. */
export class MoveOrders {
  private readonly layer = document.createElement('div');
  private readonly screen = new Vector2();
  private marks: Mark[] = [];

  constructor(private readonly engine: Engine, parent: HTMLElement) {
    this.layer.className = 'move-orders';
    this.layer.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.layer);
  }

  show(x: number, z: number, queued: boolean) {
    if (!queued) this.clear();
    const root = document.createElement('div');
    root.className = `move-order${queued ? ' move-order--queued' : ''}`;
    root.innerHTML = '<i class="move-order__pulse"></i><svg viewBox="0 0 60 60"><circle class="move-order__rim" cx="30" cy="30" r="18"/><path class="move-order__ticks" d="M30 3v12M30 45v12M3 30h12M45 30h12"/><circle class="move-order__dot" cx="30" cy="30" r="4"/></svg>';
    this.layer.appendChild(root);
    this.marks.push({ root, x, z, at: performance.now() });
    if (this.marks.length > 16) this.marks.shift()!.root.remove();
    this.update();
  }

  update() {
    const now = performance.now();
    const hidden = this.engine.rts.cinematic || this.engine.battle.ended;
    this.marks = this.marks.filter((mark) => {
      const age = now - mark.at;
      if (age >= 8000) { mark.root.remove(); return false; }
      const waves = this.engine.battle.waves;
      const y = waves.heightAt(mark.x, mark.z, waves.time, 8) + 0.5;
      const visible = !hidden && this.engine.screenPosition(mark.x, y, mark.z, this.screen);
      mark.root.style.display = visible ? '' : 'none';
      if (visible) {
        mark.root.style.transform = `translate(${this.screen.x - 30}px, ${this.screen.y - 30}px)`;
        mark.root.style.opacity = String(Math.min(1, (8000 - age) / 1500));
      }
      return true;
    });
  }

  clear() {
    this.marks.forEach((mark) => mark.root.remove());
    this.marks = [];
  }

  dispose() { this.clear(); this.layer.remove(); }
}
