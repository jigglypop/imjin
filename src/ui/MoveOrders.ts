import { Vector2 } from 'three/webgpu';
import type { Engine } from '../game/Engine';
import { isTouchDevice } from '../game/device';

/** Where the mast stands in the flag's viewBox: the marker is pinned by its foot, not by its centre. */
const FOOT = { x: 18, y: 68 };
const LIFETIME = 8000;
/** A move flag goes once every ship it was issued to is this close; the flag only marks where they are heading. */
const ARRIVED = 150;

type Mark = { root: HTMLDivElement; x: number; z: number; at: number; ids: number[] };

/**
 * The cloth hangs from two shared gradients: SVG paint servers are looked up by id, so a marker that carries its own
 * copy would lose its paint the moment an older marker holding the same id left the page.
 */
const DEFS = `<svg class="move-orders__defs" width="0" height="0" aria-hidden="true"><defs>
<linearGradient id="mo-gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff0b0"/><stop offset=".45" stop-color="#f2c04c"/><stop offset="1" stop-color="#b8821f"/></linearGradient>
<linearGradient id="mo-sky" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e3fbff"/><stop offset=".45" stop-color="#8ee4f6"/><stop offset="1" stop-color="#3b97b4"/></linearGradient>
</defs></svg>`;

/** Swallow-tailed cloth with its hoist at x = 20; the lines are the folds that give it a wind-blown surface. */
const PENNANT = 'M20 12C30 8 44 16 58 11L47 22L58 33C44 29 31 36 20 32Z';
const FOLDS = '<path class="move-order__fold" d="M30 11.5C31 18 30 26 31 33M42 15C43 20 42 26 43 30"/>';

function moveFlag(queuedNumber: number | null) {
  const paint = queuedNumber === null ? 'mo-gold' : 'mo-sky';
  return `<svg viewBox="0 0 64 76"><ellipse class="move-order__ring" cx="18" cy="68" rx="13" ry="4"/><path class="move-order__mast-shadow" d="M18 9v59"/><path class="move-order__mast" d="M18 9v59"/><circle class="move-order__finial" cx="18" cy="8" r="3"/><g class="move-order__cloth"><path class="move-order__pennant" fill="url(#${paint})" d="${PENNANT}"/>${FOLDS}${queuedNumber === null ? '<path class="move-order__emblem" d="m27 17 9 6-9 6"/>' : `<text class="move-order__number" x="35" y="27">${queuedNumber}</text>`}</g></svg>`;
}

/** Screen-sized feedback stays readable above waves at any camera distance. */
export class MoveOrders {
  private readonly layer = document.createElement('div');
  private readonly screen = new Vector2();
  private marks: Mark[] = [];

  constructor(private readonly engine: Engine, parent: HTMLElement) {
    this.layer.className = 'move-orders';
    this.layer.setAttribute('aria-hidden', 'true');
    this.layer.innerHTML = DEFS;
    parent.appendChild(this.layer);
  }

  show(x: number, z: number, queued: boolean, ids: number[] = []) {
    if (!queued) this.clear();
    const root = document.createElement('div');
    root.className = `move-order${queued ? ' move-order--queued' : ''}`;
    root.innerHTML = moveFlag(queued ? this.marks.length + 1 : null);
    this.layer.appendChild(root);
    this.marks.push({ root, x, z, at: performance.now(), ids });
    if (this.marks.length > 16) this.marks.shift()!.root.remove();
    this.update();
  }

  /** Pins a mark by its foot on the water; farther marks shrink so a flag never outgrows the ships it commands. */
  private place(mark: Mark, hidden: boolean) {
    const waves = this.engine.battle.waves;
    const y = waves.heightAt(mark.x, mark.z, waves.time, 8);
    const visible = !hidden && this.engine.screenPosition(mark.x, y, mark.z, this.screen);
    mark.root.style.display = visible ? '' : 'none';
    if (!visible) return 0;
    const cam = this.engine.camera.position;
    const distance = Math.hypot(cam.x - mark.x, cam.y - y, cam.z - mark.z);
    // Phones keep a larger floor: a finger-sized screen cannot read a 40 px flag.
    const scale = Math.max(isTouchDevice ? 0.95 : 0.8, Math.min(1.3, 1000 / distance));
    mark.root.style.transformOrigin = `${FOOT.x}px ${FOOT.y}px`;
    mark.root.style.transform = `translate(${this.screen.x - FOOT.x}px, ${this.screen.y - FOOT.y}px) scale(${scale.toFixed(3)})`;
    return this.underHud(this.screen.x, this.screen.y, scale) ? 0.15 : 1;
  }

  /** True when a HUD panel covers the flag cloth or its foot, so the flag steps back instead of fighting the panel. */
  private underHud(x: number, y: number, scale: number) {
    const canvas = this.engine.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const probe = (px: number, py: number) => {
      const top = document.elementsFromPoint(rect.left + px, rect.top + py).find((el) => !this.layer.contains(el) && !el.closest('.cpoints, .banners'));
      return !!top && top !== canvas;
    };
    return probe(x, y) || probe(x + 20 * scale, y - (FOOT.y - 26) * scale);
  }

  private arrived(mark: Mark) {
    if (!mark.ids.length) return false;
    const b = this.engine.battle;
    return mark.ids.every((id) => {
      const s = b.get(id);
      return !s || !s.alive || Math.hypot(s.x - mark.x, s.z - mark.z) < ARRIVED;
    });
  }

  update() {
    const now = performance.now();
    const hidden = this.engine.rts.cinematic || this.engine.battle.ended;
    this.marks = this.marks.filter((mark) => {
      const age = now - mark.at;
      if (age >= LIFETIME) { mark.root.remove(); return false; }
      // Arrival shortens what is left of the flag's life to a quick fade instead of cutting it off.
      if (age > 1200 && this.arrived(mark)) mark.at = Math.min(mark.at, now - (LIFETIME - 700));
      const shown = this.place(mark, hidden);
      if (shown) mark.root.style.opacity = String(Math.min(1, (LIFETIME - age) / 1500) * shown);
      return true;
    });
  }

  clear() {
    this.marks.forEach((mark) => mark.root.remove());
    this.marks = [];
  }

  dispose() {
    this.clear();
    this.layer.remove();
  }
}
