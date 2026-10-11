import { Vector2 } from 'three/webgpu';
import type { Engine } from '../game/Engine';
import { isTouchDevice } from '../game/device';

/** Where the mast stands in each flag's viewBox: the marker is pinned by its foot, not by its centre. */
const FOOT = { move: { x: 18, y: 68 }, rally: { x: 20, y: 90 } };
const LIFETIME = 8000;
/** A move flag goes once every ship it was issued to is this close; the flag only marks where they are heading. */
const ARRIVED = 150;

type Mark = { root: HTMLDivElement; x: number; z: number; at: number; foot: { x: number; y: number }; ids: number[] };

/**
 * The cloth hangs from two shared gradients: SVG paint servers are looked up by id, so a marker that carries its own
 * copy would lose its paint the moment an older marker holding the same id left the page.
 */
const DEFS = `<svg class="move-orders__defs" width="0" height="0" aria-hidden="true"><defs>
<linearGradient id="mo-gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff0b0"/><stop offset=".45" stop-color="#f2c04c"/><stop offset="1" stop-color="#b8821f"/></linearGradient>
<linearGradient id="mo-sky" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e3fbff"/><stop offset=".45" stop-color="#8ee4f6"/><stop offset="1" stop-color="#3b97b4"/></linearGradient>
<linearGradient id="mo-red" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d9503f"/><stop offset=".5" stop-color="#a62a20"/><stop offset="1" stop-color="#6a1712"/></linearGradient>
</defs></svg>`;

/** Swallow-tailed cloth with its hoist at x = 20; the lines are the folds that give it a wind-blown surface. */
const PENNANT = 'M20 12C30 8 44 16 58 11L47 22L58 33C44 29 31 36 20 32Z';
const FOLDS = '<path class="move-order__fold" d="M30 11.5C31 18 30 26 31 33M42 15C43 20 42 26 43 30"/>';

function moveFlag(queuedNumber: number | null) {
  const paint = queuedNumber === null ? 'mo-gold' : 'mo-sky';
  return `<svg viewBox="0 0 64 76"><ellipse class="move-order__ring" cx="18" cy="68" rx="13" ry="4"/><path class="move-order__mast-shadow" d="M18 9v59"/><path class="move-order__mast" d="M18 9v59"/><circle class="move-order__finial" cx="18" cy="8" r="3"/><g class="move-order__cloth"><path class="move-order__pennant" fill="url(#${paint})" d="${PENNANT}"/>${FOLDS}${queuedNumber === null ? '<path class="move-order__emblem" d="m27 17 9 6-9 6"/>' : `<text class="move-order__number" x="35" y="27">${queuedNumber}</text>`}</g></svg>`;
}

/** A taller crimson banner with a gold hem and a drum-and-ring crest, so a rally point never reads as a move order. */
function rallyFlag() {
  return `<svg viewBox="0 0 76 98"><ellipse class="move-order__ring move-order__ring--rally" cx="20" cy="90" rx="17" ry="5.5"/><ellipse class="move-order__ring move-order__ring--rally move-order__ring--outer" cx="20" cy="90" rx="17" ry="5.5"/><path class="move-order__mast-shadow" d="M20 12v78"/><path class="move-order__mast" d="M20 12v78"/><path class="move-order__crossbar" d="M20 17h8"/><circle class="move-order__finial" cx="20" cy="10" r="3.6"/><g class="move-order__cloth move-order__cloth--rally"><path class="move-order__banner" fill="url(#mo-red)" d="M22 19C34 14 48 22 70 17L58 34L70 52C48 57 34 48 22 54Z"/><path class="move-order__hem" d="M24.5 22C35 18 47 25 65 21.5M24.5 51C35 47 47 54 65 49"/><path class="move-order__fold" d="M33 17C35 28 33 42 35 52M50 22C52 31 50 42 52 55"/><circle class="move-order__crest" cx="40" cy="36" r="8"/><path class="move-order__crest-inner" d="M40 31.5a4.5 4.5 0 1 1 0 9a2.25 2.25 0 1 1 0-4.5a2.25 2.25 0 1 0 0-4.5Z"/></g></svg>`;
}

/** Screen-sized feedback stays readable above waves at any camera distance. */
export class MoveOrders {
  private readonly layer = document.createElement('div');
  private readonly screen = new Vector2();
  private marks: Mark[] = [];
  /** One standing banner per own port that has a rally point, keyed by point id. */
  private rallies = new Map<number, Mark & { key: string }>();

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
    this.marks.push({ root, x, z, at: performance.now(), foot: FOOT.move, ids });
    if (this.marks.length > 16) this.marks.shift()!.root.remove();
    this.update();
  }

  /** Pins a mark by its foot on the water; farther marks shrink so a flag never outgrows the ships it commands. */
  private place(mark: Mark, hidden: boolean) {
    const waves = this.engine.battle.waves;
    const y = waves.heightAt(mark.x, mark.z, waves.time, 8);
    const visible = !hidden && this.engine.screenPosition(mark.x, y, mark.z, this.screen);
    mark.root.style.display = visible ? '' : 'none';
    if (!visible) return false;
    const cam = this.engine.camera.position;
    const distance = Math.hypot(cam.x - mark.x, cam.y - y, cam.z - mark.z);
    // Phones keep a larger floor: a finger-sized screen cannot read a 40 px flag.
    const scale = Math.max(isTouchDevice ? 0.95 : 0.8, Math.min(1.3, 1000 / distance));
    mark.root.style.transformOrigin = `${mark.foot.x}px ${mark.foot.y}px`;
    mark.root.style.transform = `translate(${this.screen.x - mark.foot.x}px, ${this.screen.y - mark.foot.y}px) scale(${scale.toFixed(3)})`;
    return true;
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
      if (this.place(mark, hidden)) mark.root.style.opacity = String(Math.min(1, (LIFETIME - age) / 1500));
      return true;
    });
    this.updateRallies(hidden);
  }

  private updateRallies(hidden: boolean) {
    const c = this.engine.conquest;
    const live = new Set<number>();
    for (const p of c?.points ?? []) {
      if (!p.rally || p.owner !== this.engine.owner) continue;
      live.add(p.id);
      const key = `${p.rally.x.toFixed(1)},${p.rally.z.toFixed(1)}`;
      let mark = this.rallies.get(p.id);
      if (mark && mark.key !== key) { mark.root.remove(); this.rallies.delete(p.id); mark = undefined; }
      if (!mark) {
        const root = document.createElement('div');
        root.className = 'move-order move-order--rally';
        root.innerHTML = rallyFlag();
        this.layer.appendChild(root);
        mark = { root, x: p.rally.x, z: p.rally.z, at: performance.now(), foot: FOOT.rally, ids: [], key };
        this.rallies.set(p.id, mark);
      }
      this.place(mark, hidden);
    }
    for (const [id, mark] of this.rallies) {
      if (live.has(id)) continue;
      mark.root.remove();
      this.rallies.delete(id);
    }
  }

  clear() {
    this.marks.forEach((mark) => mark.root.remove());
    this.marks = [];
  }

  dispose() {
    this.clear();
    this.rallies.forEach((mark) => mark.root.remove());
    this.rallies.clear();
    this.layer.remove();
  }
}
