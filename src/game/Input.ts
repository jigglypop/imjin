import { Ray, Vector2, Vector3 } from 'three/webgpu';
import type { Engine } from './Engine';
import type { BattleEvent, Ship } from '../sim/types';
import { setSelectionBox, pushToast } from '../state/store';

const DRAG_THRESHOLD = 6;

export class Input {
  private dom: HTMLElement | null = null;
  private downX = 0;
  private downY = 0;
  private dragging = false;
  private leftDown = false;
  private readonly ray = new Ray();
  private readonly ndc = new Vector2();
  private readonly tmp = new Vector3();
  private readonly screen = new Vector2();
  private lastClickTime = 0;
  private lastClickId = 0;

  constructor(private readonly engine: Engine) {}

  attach(dom: HTMLElement) {
    this.dom = dom;
    dom.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    dom.addEventListener('contextmenu', this.onContext);
    window.addEventListener('keydown', this.onKey);
  }

  detach() {
    const dom = this.dom;
    if (!dom) return;
    dom.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    dom.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('keydown', this.onKey);
  }

  private onContext = (e: MouseEvent) => {
    e.preventDefault();
  };

  private setRay(clientX: number, clientY: number) {
    const rect = this.dom!.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const cam = this.engine.camera;
    this.ray.origin.setFromMatrixPosition(cam.matrixWorld);
    this.ray.direction.set(this.ndc.x, this.ndc.y, 0.5).unproject(cam).sub(this.ray.origin).normalize();
  }

  pickShip(clientX: number, clientY: number): Ship | undefined {
    this.setRay(clientX, clientY);
    const o = this.ray.origin;
    const d = this.ray.direction;
    let best: Ship | undefined;
    let bestT = Infinity;
    for (const s of this.engine.battle.ships) {
      if (!s.alive || s.sinking > 0.5) continue;
      const c = Math.cos(s.heading);
      const n = Math.sin(s.heading);
      const ox = o.x - s.x;
      const oz = o.z - s.z;
      const lox = ox * c + oz * n;
      const loz = -ox * n + oz * c;
      const ldx = d.x * c + d.z * n;
      const ldz = -d.x * n + d.z * c;
      const half = [s.spec.length * 0.5 + 2, s.spec.beam * 0.5 + 2];
      const lo = [lox, o.y, loz];
      const ld = [ldx, d.y, ldz];
      const min = [-half[0]!, -2, -half[1]!];
      const max = [half[0]!, s.spec.height, half[1]!];
      let t0 = 0;
      let t1 = Infinity;
      let hit = true;
      for (let a = 0; a < 3; a += 1) {
        const dir = ld[a]!;
        const org = lo[a]!;
        if (Math.abs(dir) < 1e-8) {
          if (org < min[a]! || org > max[a]!) {
            hit = false;
            break;
          }
          continue;
        }
        let ta = (min[a]! - org) / dir;
        let tb = (max[a]! - org) / dir;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) {
          hit = false;
          break;
        }
      }
      if (hit && t0 < bestT) {
        bestT = t0;
        best = s;
      }
    }
    return best;
  }

  waterPoint(clientX: number, clientY: number) {
    this.setRay(clientX, clientY);
    const d = this.ray.direction;
    if (d.y > -0.0005) return null;
    const t = -this.ray.origin.y / d.y;
    return this.tmp.copy(this.ray.origin).addScaledVector(d, t);
  }

  private onDown = (e: PointerEvent) => {
    if (e.button === 0 && !e.altKey) {
      this.leftDown = true;
      this.dragging = false;
      this.downX = e.clientX;
      this.downY = e.clientY;
    } else if (e.button === 2) {
      this.command(e.clientX, e.clientY, e.shiftKey);
    }
  };

  private onMove = (e: PointerEvent) => {
    if (!this.leftDown) {
      if (this.dom && e.target === this.dom) {
        const s = this.pickShip(e.clientX, e.clientY);
        this.engine.views.hovered = s ? s.id : 0;
        this.dom.style.cursor = s ? (s.team === 'japan' && this.engine.views.selected.size ? 'crosshair' : 'pointer') : 'default';
      }
      return;
    }
    const dx = e.clientX - this.downX;
    const dy = e.clientY - this.downY;
    if (!this.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) this.dragging = true;
    if (this.dragging) {
      const rect = this.dom!.getBoundingClientRect();
      setSelectionBox({ x0: this.downX - rect.left, y0: this.downY - rect.top, x1: e.clientX - rect.left, y1: e.clientY - rect.top });
    }
  };

  private onUp = (e: PointerEvent) => {
    if (e.button !== 0 || !this.leftDown) return;
    this.leftDown = false;
    const views = this.engine.views;
    if (this.dragging) {
      this.dragging = false;
      setSelectionBox(null);
      const rect = this.dom!.getBoundingClientRect();
      const x0 = Math.min(this.downX, e.clientX) - rect.left;
      const x1 = Math.max(this.downX, e.clientX) - rect.left;
      const y0 = Math.min(this.downY, e.clientY) - rect.top;
      const y1 = Math.max(this.downY, e.clientY) - rect.top;
      if (!e.shiftKey) views.selected.clear();
      for (const s of this.engine.battle.ships) {
        if (!this.engine.battle.isActive(s) || s.team !== 'joseon') continue;
        if (!this.engine.screenPosition(s.x, s.spec.deck, s.z, this.screen)) continue;
        if (this.screen.x >= x0 && this.screen.x <= x1 && this.screen.y >= y0 && this.screen.y <= y1) views.selected.add(s.id);
      }
      this.engine.publish(true);
      return;
    }
    const ship = this.pickShip(e.clientX, e.clientY);
    const now = performance.now();
    if (ship && ship.id === this.lastClickId && now - this.lastClickTime < 350) {
      this.engine.rts.followId = ship.id;
      this.engine.rts.goal.distance = Math.min(this.engine.rts.goal.distance, 160);
    }
    this.lastClickTime = now;
    this.lastClickId = ship?.id ?? 0;
    if (!e.shiftKey) views.selected.clear();
    if (ship) {
      if (e.shiftKey && views.selected.has(ship.id)) views.selected.delete(ship.id);
      else views.selected.add(ship.id);
    }
    this.engine.publish(true);
  };

  private selectedJoseon() {
    return [...this.engine.views.selected].filter((id) => {
      const s = this.engine.battle.get(id);
      return this.engine.battle.isActive(s) && s.team === 'joseon';
    });
  }

  private command(clientX: number, clientY: number, queue: boolean) {
    const ids = this.selectedJoseon();
    if (!ids.length) return;
    const b = this.engine.battle;
    const target = this.pickShip(clientX, clientY);
    if (target && target.team === 'japan' && b.isActive(target)) {
      b.setOrder(ids, { type: 'attack', targetId: target.id });
      pushToast(`${ids.length}척, ${target.name} 공격`);
      return;
    }
    const p = this.waterPoint(clientX, clientY);
    if (!p) return;
    void queue;
    this.moveSelected(p.x, p.z);
  }

  moveSelected(tx: number, tz: number) {
    const ids = this.selectedJoseon();
    if (!ids.length) return;
    const b = this.engine.battle;
    let cx = 0;
    let cz = 0;
    for (const id of ids) {
      const s = b.get(id)!;
      cx += s.x;
      cz += s.z;
    }
    cx /= ids.length;
    cz /= ids.length;
    const dir = Math.atan2(tz - cz, tx - cx);
    const px = -Math.sin(dir);
    const pz = Math.cos(dir);
    const fx = Math.cos(dir);
    const fz = Math.sin(dir);
    const perRow = Math.min(12, ids.length);
    const sorted = [...ids].sort((a, c) => {
      const sa = b.get(a)!;
      const sc = b.get(c)!;
      return (sa.x - cx) * px + (sa.z - cz) * pz - ((sc.x - cx) * px + (sc.z - cz) * pz);
    });
    sorted.forEach((id, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const inRow = Math.min(perRow, sorted.length - row * perRow);
      const off = (col - (inRow - 1) / 2) * 48;
      b.setOrder([id], { type: 'move', x: tx + px * off - fx * row * 60, z: tz + pz * off - fz * row * 60 });
    });
    this.engine.fx.spray.emit({ x: tx, y: 0.5, z: tz, vy: 2, life: 0.6, size0: 3, size1: 9, alpha: 0.5, r: 1, g: 0.85, b: 0.4, lift: -3 });
  }

  formation(kind: 'crane' | 'line') {
    const b = this.engine.battle;
    let ids = this.selectedJoseon();
    if (!ids.length) ids = b.ships.filter((s) => s.team === 'joseon' && b.isActive(s) && s.spec.kind !== 'geobukseon').map((s) => s.id);
    let ex = 0;
    let ez = 0;
    let n = 0;
    for (const s of b.ships) {
      if (s.team !== 'japan' || !b.isActive(s)) continue;
      ex += s.x;
      ez += s.z;
      n += 1;
    }
    if (!n) return;
    b.formation(ids, kind, ex / n, ez / n);
    this.engine.sound.drums(kind === 'crane' ? 3 : 2);
    pushToast(kind === 'crane' ? '학익진 전개' : '일자진 전개');
  }

  auto() {
    const b = this.engine.battle;
    let ids = this.selectedJoseon();
    if (!ids.length) ids = b.ships.filter((s) => s.team === 'joseon' && b.isActive(s)).map((s) => s.id);
    b.setOrder(ids, { type: 'auto' });
    pushToast('자유 교전');
  }

  hold() {
    const ids = this.selectedJoseon();
    if (!ids.length) return;
    this.engine.battle.setOrder(ids, { type: 'hold' });
    pushToast('정지');
  }

  followSelected() {
    const id = [...this.engine.views.selected][0];
    if (id) {
      this.engine.rts.followId = this.engine.rts.followId === id ? 0 : id;
      this.engine.publish(true);
    }
  }

  cycle() {
    const b = this.engine.battle;
    const own = b.ships.filter((s) => s.team === 'joseon' && b.isActive(s));
    if (!own.length) return;
    const current = [...this.engine.views.selected][0] ?? 0;
    const idx = own.findIndex((s) => s.id === current);
    const next = own[(idx + 1) % own.length]!;
    this.engine.views.selected.clear();
    this.engine.views.selected.add(next.id);
    this.engine.rts.goal.tx = next.x;
    this.engine.rts.goal.tz = next.z;
    this.engine.publish(true);
  }

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    switch (e.code) {
      case 'Digit1':
        this.formation('crane');
        break;
      case 'Digit2':
        this.formation('line');
        break;
      case 'KeyG':
        this.auto();
        break;
      case 'KeyH':
        this.hold();
        break;
      case 'KeyC':
        this.followSelected();
        break;
      case 'KeyM':
        this.engine.sound.setMuted(!this.engine.sound.muted);
        this.engine.publish(true);
        break;
      case 'KeyL':
        this.engine.showLabels = !this.engine.showLabels;
        break;
      case 'KeyV':
        this.engine.rts.cinematic = !this.engine.rts.cinematic;
        break;
      case 'Tab':
        e.preventDefault();
        this.cycle();
        break;
      case 'Space':
        e.preventDefault();
        this.engine.paused = !this.engine.paused;
        this.engine.publish(true);
        break;
      case 'Escape':
        this.engine.views.selected.clear();
        this.engine.rts.followId = 0;
        this.engine.publish(true);
        break;
      default:
        break;
    }
  };

  onEvents(events: BattleEvent[]) {
    const b = this.engine.battle;
    for (const e of events) {
      if (e.type === 'sinking') {
        const s = b.get(e.ship);
        if (s) pushToast(`${s.team === 'joseon' ? '아군' : '적'} ${s.spec.label} 침몰 — ${s.name}`, s.team === 'joseon' ? 'bad' : 'good');
      } else if (e.type === 'struck') {
        const s = b.get(e.ship);
        if (s) pushToast(`${s.team === 'joseon' ? '아군' : '적'} ${s.spec.label} 전투 불능 — ${s.name}`, s.team === 'joseon' ? 'bad' : 'good');
      } else if (e.type === 'explode') {
        const s = b.get(e.ship);
        if (s) pushToast(`화약고 폭발 — ${s.name}`, s.team === 'joseon' ? 'bad' : 'good');
      }
    }
  }
}
