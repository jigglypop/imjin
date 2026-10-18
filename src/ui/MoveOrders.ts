import { Vector2 } from 'three/webgpu';
import type { Engine } from '../game/Engine';
import { isTouchDevice } from '../game/device';
import type { Faction } from '../sim/types';

type Point = { x: number; y: number };
type Shape = { foot: Point; cloth: Point };

/** Where the pole stands and where the cloth hangs in each flag's viewBox: a flag is pinned by its foot and steps back behind a panel that covers its cloth. */
const SHAPE: Record<'move' | 'rally', Shape> = {
  move: { foot: { x: 9, y: 53 }, cloth: { x: 19, y: 18 } },
  rally: { foot: { x: 10, y: 79 }, cloth: { x: 24, y: 29 } },
};
const LIFETIME = 8000;
/** A move flag goes once every ship it was issued to is this close; the flag only marks where they are heading. */
const ARRIVED = 150;

/** `probedAt` and `covered`: the last HUD-cover probe and its answer, re-asked every PROBE_EVERY ms. */
type Mark = { root: HTMLDivElement; x: number; z: number; at: number; shape: Shape; ids: number[]; probedAt?: number; covered?: boolean };
/** Hit-testing the page forces a layout, so whether a panel covers a flag is asked about this often, not every frame. */
const PROBE_EVERY = 150;

/** A small triangular pennant: a destination needs a mark on the water, not a banner over the ships. */
const PENNANT = 'M9.8 9C17.8 7.6 27 13.2 37 19.6C27.2 20.8 18.2 25.2 9.8 28Z';
/** The rally banner: a square-cut standard whose free edges ripple a little in the wind. */
const BANNER = 'M11 12.5C19.5 11.4 29 13.6 38.5 12.2C37.6 23 39.2 35 38 45.6C29 47 19.5 44.6 11 46Z';
/** Spear-head finials, the leaf-shaped tip of a Korean flagpole, and the tassel tied under the banner's. */
const SPEAR = { move: 'M9 .6C9.96 2.28 10.32 4.08 10.02 5.4L9 6.6 7.98 5.4C7.68 4.08 8.04 2.28 9 .6Z', rally: 'M10 .4C11.28 2.64 11.76 5.04 11.36 6.8L10 8.4 8.64 6.8C8.24 5.04 8.72 2.64 10 .4Z' };
const TASSEL = 'M10 8.6C8.5 9.6 7.9 11.5 8.3 13.6C8.9 12.8 9.6 13 10 14.2C10.4 13 11.1 12.8 11.7 13.6C12.1 11.5 11.5 9.6 10 8.6Z';

/**
 * Cloth folds and the border clips are shared: SVG paint servers and clip paths are looked up by id, so a flag that
 * carried its own copy would lose them the moment an older flag holding the same id left the page. The border is the
 * outline stroked twice as wide as it shows and clipped to the cloth, so it lies inside the edge like a sewn band.
 */
const DEFS = `<svg class="move-orders__defs" width="0" height="0" aria-hidden="true"><defs>
<linearGradient id="mo-folds" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".3" stop-color="#fff" stop-opacity="0"/><stop offset=".52" stop-color="#000" stop-opacity=".24"/><stop offset=".7" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>
<clipPath id="mo-pennant"><path d="${PENNANT}"/></clipPath>
<clipPath id="mo-banner"><path d="${BANNER}"/></clipPath>
</defs></svg>`;

/** 令, the character on a Joseon or Ming command flag, drawn as strokes on a 20-unit square so no font has to carry it. */
const REI = 'M10 1.2C7.9 4.4 4.9 7 1.2 8.6M10 1.2C12.1 4.4 15.1 7 18.8 8.6M7.4 9.9H12.6M7 12.9H14.4V17.2L12.9 16.5M7 12.9V19.8';
/** Kato Kiyomasa's snake's-eye crest: a Japanese mark as plain as 令 is for the others. */
const JANOME = 'M24.65 24.45a4.65 4.65 0 1 1 0 9.3a4.65 4.65 0 1 1 0-9.3Z';

/** St George's cross on England's white standard and the ragged Burgundy saltire on Spain's, across the whole banner. */
const ST_GEORGE = 'M24.8 10V48M10 29H40';
const BURGUNDY = 'M13 14.5L37 44.5M37 14.5L13 44.5';

/** The dyed field, its border, then what is painted on it, all under the shading of the folds. */
function cloth(path: string, clip: string, inner = '') {
  return `<path class="move-order__field" d="${path}"/><path class="move-order__border" d="${path}" clip-path="url(#${clip})"/>${inner}<path d="${path}" fill="url(#mo-folds)"/>`;
}

function moveFlag(queuedNumber: number | null) {
  const number = queuedNumber === null ? '' : `<text class="move-order__number" x="18" y="22.6">${queuedNumber}</text>`;
  return `<svg viewBox="0 0 42 58"><ellipse class="move-order__ring" cx="9" cy="53" rx="9" ry="2.8"/><path class="move-order__pole" d="M9 6.4V53"/><path class="move-order__gloss" d="M8.45 8.5V52"/><path class="move-order__finial" d="${SPEAR.move}"/><g class="move-order__cloth">${cloth(PENNANT, 'mo-pennant', number)}</g></svg>`;
}

/** Taller than a move flag and square-cut, with a tassel under the spear head and the navy's mark on the cloth. */
function rallyFlag(faction: Faction) {
  const mark =
    faction === 'japan'
      ? `<path class="move-order__mark move-order__mark--ring" d="${JANOME}"/>`
      : faction === 'england'
        ? `<path class="move-order__mark move-order__mark--cross" d="${ST_GEORGE}" clip-path="url(#mo-banner)"/>`
        : faction === 'spain'
          ? `<path class="move-order__mark move-order__mark--saltire" d="${BURGUNDY}" clip-path="url(#mo-banner)"/>`
          : `<path class="move-order__mark" d="${REI}" transform="translate(15.85 19.86) scale(.88)"/>`;
  return `<svg viewBox="0 0 52 84"><ellipse class="move-order__ring move-order__ring--rally" cx="10" cy="79" rx="12" ry="3.6"/><ellipse class="move-order__ring move-order__ring--rally move-order__ring--outer" cx="10" cy="79" rx="12" ry="3.6"/><path class="move-order__pole move-order__pole--rally" d="M10 8.4V79"/><path class="move-order__gloss" d="M9.3 11V78"/><path class="move-order__tassel" d="${TASSEL}"/><path class="move-order__finial" d="${SPEAR.rally}"/><g class="move-order__cloth move-order__cloth--rally">${cloth(BANNER, 'mo-banner', mark)}</g></svg>`;
}

/** Screen-sized feedback stays readable above waves at any camera distance. */
export class MoveOrders {
  private readonly layer = document.createElement('div');
  private readonly screen = new Vector2();
  private marks: Mark[] = [];
  /** One standing banner per own port that has a rally point, keyed by point id. */
  private rallies = new Map<number, Mark & { key: string }>();
  /** The canvas's page rect, measured once per update. */
  private rect: DOMRect | null = null;

  constructor(private readonly engine: Engine, parent: HTMLElement) {
    this.layer.className = 'move-orders';
    this.layer.setAttribute('aria-hidden', 'true');
    this.layer.innerHTML = DEFS;
    parent.appendChild(this.layer);
  }

  show(x: number, z: number, queued: boolean, ids: number[] = []) {
    if (!queued) this.clear();
    const root = document.createElement('div');
    root.className = `move-order move-order--${this.engine.faction}${queued ? ' move-order--queued' : ''}`;
    root.innerHTML = moveFlag(queued ? this.marks.length + 1 : null);
    this.layer.appendChild(root);
    this.marks.push({ root, x, z, at: performance.now(), shape: SHAPE.move, ids });
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
    const { foot } = mark.shape;
    mark.root.style.transformOrigin = `${foot.x}px ${foot.y}px`;
    mark.root.style.transform = `translate(${this.screen.x - foot.x}px, ${this.screen.y - foot.y}px) scale(${scale.toFixed(3)})`;
    return this.underHud(this.screen.x, this.screen.y, scale, mark) ? 0.15 : 1;
  }

  /** True when a HUD panel covers the flag cloth or its foot, so the flag steps back instead of fighting the panel. */
  private underHud(x: number, y: number, scale: number, mark: Mark) {
    const now = performance.now();
    if (mark.probedAt !== undefined && now - mark.probedAt < PROBE_EVERY) return !!mark.covered;
    mark.probedAt = now;
    const canvas = this.engine.renderer.domElement;
    const rect = (this.rect ??= canvas.getBoundingClientRect());
    const probe = (px: number, py: number) => {
      const top = document.elementsFromPoint(rect.left + px, rect.top + py).find((el) => !this.layer.contains(el) && !el.closest('.cpoints, .banners'));
      return !!top && top !== canvas;
    };
    const { foot, cloth } = mark.shape;
    mark.covered = probe(x, y) || probe(x + (cloth.x - foot.x) * scale, y + (cloth.y - foot.y) * scale);
    return mark.covered;
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
    this.rect = null;
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
        root.className = `move-order move-order--rally move-order--${this.engine.faction}`;
        root.innerHTML = rallyFlag(this.engine.faction);
        this.layer.appendChild(root);
        mark = { root, x: p.rally.x, z: p.rally.z, at: performance.now(), shape: SHAPE.rally, ids: [], key };
        this.rallies.set(p.id, mark);
      }
      const shown = this.place(mark, hidden);
      if (shown) mark.root.style.opacity = String(shown);
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
