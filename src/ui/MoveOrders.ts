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
    const number = queued ? this.marks.length + 1 : null;
    root.innerHTML = `<i class="move-order__pulse"></i><svg viewBox="0 0 64 76"><ellipse class="move-order__base" cx="18" cy="68" rx="13" ry="4"/><path class="move-order__mast-shadow" d="M18 9v59"/><path class="move-order__mast" d="M18 9v59"/><circle class="move-order__finial" cx="18" cy="8" r="3"/><g class="move-order__cloth"><path class="move-order__pennant" d="M20 13C32 5 40 18 56 11L49 23L56 34C40 42 33 27 20 33Z"/>${number === null ? '<path class="move-order__emblem" d="m29 16 9 7-9 6"/>' : `<text class="move-order__number" x="35" y="28">${number}</text>`}</g></svg>`;
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
        // The mast's foot, rather than the centre of the icon, marks the clicked water coordinate.
        mark.root.style.transform = `translate(${this.screen.x - 18}px, ${this.screen.y - 68}px)`;
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
