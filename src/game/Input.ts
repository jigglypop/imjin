import { Ray, Vector2, Vector3 } from 'three/webgpu';
import type { Engine } from './Engine';
import type { AmmoMode, BattleEvent, Ship, Stance } from '../sim/types';
import { setSelectionBox, pushToast, useUi } from '../state/store';

const DRAG_THRESHOLD = 6;

export const FORMATION_NAMES = { crane: '학익진', line: '일자진', column: '장사진', wedge: '첨자진' } as const;
export const AMMO_NAMES: Record<AmmoMode, string> = { auto: '총통별 기본탄', hull: '대장군전 · 철환 (선체)', crew: '조란환 (병력 살상)', fire: '화전 (화공)' };
export const STANCE_NAMES: Record<Stance, string> = { auto: '자유 교전', standoff: '원거리 포격 — 거리 유지', close: '근접 포격', ram: '충파 — 들이받아라', board: '등선 — 적선에 올라라' };

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

  /** When on, a one-finger drag draws a selection box instead of panning the camera. */
  get touchBox() {
    return useUi.getState().touchBox;
  }

  // Touch pointers are routed to TouchControls. The handlers below only deal with mouse input.
  private onDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
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
    if (e.pointerType === 'touch') return;
    if (!this.leftDown) {
      if (this.dom && e.target === this.dom) {
        const s = this.pickShip(e.clientX, e.clientY);
        this.engine.views.hovered = s ? s.id : 0;
        this.dom.style.cursor = s ? (s.team === this.engine.enemyTeam && this.engine.views.selected.size ? 'crosshair' : 'pointer') : 'default';
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

  /** Select own ships whose screen position falls inside a rectangle given in client coordinates. */
  boxSelect(left: number, top: number, right: number, bottom: number, additive: boolean) {
    const rect = this.dom!.getBoundingClientRect();
    const x0 = left - rect.left;
    const x1 = right - rect.left;
    const y0 = top - rect.top;
    const y1 = bottom - rect.top;
    const views = this.engine.views;
    if (!additive) views.selected.clear();
    for (const s of this.engine.battle.ships) {
      if (!this.engine.isOwn(s)) continue;
      if (!this.engine.screenPosition(s.x, s.spec.deck, s.z, this.screen)) continue;
      if (this.screen.x >= x0 && this.screen.x <= x1 && this.screen.y >= y0 && this.screen.y <= y1) views.selected.add(s.id);
    }
    this.engine.publish(true);
  }

  /**
   * A tap on the battlefield (touch). Own ship: select it. Enemy ship or open water: command the selection.
   * Without a selection the tap only reminds the player to select a ship.
   */
  tap(clientX: number, clientY: number) {
    const ship = this.pickShip(clientX, clientY);
    if (this.engine.isOwn(ship)) {
      const now = performance.now();
      if (ship.id === this.lastClickId && now - this.lastClickTime < 350) {
        this.engine.rts.followId = ship.id;
        this.engine.rts.goal.distance = Math.min(this.engine.rts.goal.distance, 160);
      }
      this.lastClickTime = now;
      this.lastClickId = ship.id;
      this.engine.views.selected.clear();
      this.engine.views.selected.add(ship.id);
      this.engine.publish(true);
      return;
    }
    if (!this.selectedOwn().length) {
      this.need([]);
      return;
    }
    this.command(clientX, clientY, false);
  }

  clearSelection() {
    this.engine.views.selected.clear();
    this.engine.rts.followId = 0;
    this.engine.publish(true);
  }

  private onUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || e.button !== 0 || !this.leftDown) return;
    this.leftDown = false;
    const views = this.engine.views;
    if (this.dragging) {
      this.dragging = false;
      setSelectionBox(null);
      this.boxSelect(Math.min(this.downX, e.clientX), Math.min(this.downY, e.clientY), Math.max(this.downX, e.clientX), Math.max(this.downY, e.clientY), e.shiftKey);
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

  /** Selected ships the player may command. Enemy and allied ships can be selected to look at, not to order. */
  private selectedOwn() {
    return [...this.engine.views.selected].filter((id) => this.engine.isOwn(this.engine.battle.get(id)));
  }

  private ownShips() {
    return this.engine.battle.ships.filter((s) => this.engine.isOwn(s));
  }

  private command(clientX: number, clientY: number, queue: boolean) {
    const ids = this.selectedOwn();
    if (!ids.length) return;
    const b = this.engine.battle;
    const target = this.pickShip(clientX, clientY);
    if (target && target.team === this.engine.enemyTeam && b.isActive(target)) {
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
    const ids = this.selectedOwn();
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

  formation(kind: 'crane' | 'line' | 'column' | 'wedge') {
    const b = this.engine.battle;
    let ids = this.selectedOwn();
    if (!ids.length) ids = this.ownShips().filter((s) => s.spec.kind !== 'geobukseon').map((s) => s.id);
    let ex = 0;
    let ez = 0;
    let n = 0;
    for (const s of b.ships) {
      if (s.team !== this.engine.enemyTeam || !b.isActive(s)) continue;
      ex += s.x;
      ez += s.z;
      n += 1;
    }
    if (!n) return;
    b.formation(ids, kind, ex / n, ez / n);
    this.engine.sound.drums(kind === 'crane' ? 3 : 2);
    pushToast(FORMATION_NAMES[kind] + ' 전개');
  }

  private commandIds(all = false) {
    const ids = this.selectedOwn();
    if (ids.length || !all) return ids;
    return this.ownShips().map((s) => s.id);
  }

  private need(ids: number[]) {
    if (ids.length) return true;
    pushToast('먼저 배를 선택하십시오');
    return false;
  }

  volley(side: 0 | 1 | 2) {
    const ids = this.commandIds();
    if (!this.need(ids)) return;
    const n = this.engine.battle.volley(ids, side);
    this.engine.sound.drums(1);
    pushToast(`${n}척 ${side === 0 ? '좌현' : side === 1 ? '우현' : '함수'} 일제 사격`);
    this.engine.publish(true);
  }

  toggleFire() {
    const ids = this.commandIds(true);
    const b = this.engine.battle;
    const first = b.get(ids[0] ?? 0);
    const mode = first?.fireMode === 'hold' ? 'free' : 'hold';
    b.configure(ids, { fireMode: mode });
    pushToast(mode === 'hold' ? '사격 중지 — 장전 후 대기' : '자유 사격');
    this.engine.publish(true);
  }

  cycleAmmo() {
    const ids = this.commandIds(true);
    const b = this.engine.battle;
    const order: AmmoMode[] = ['auto', 'hull', 'crew', 'fire'];
    const first = b.get(ids[0] ?? 0);
    const next = order[(order.indexOf(first?.ammo ?? 'auto') + 1) % order.length]!;
    b.configure(ids, { ammo: next });
    pushToast(`탄종 — ${AMMO_NAMES[next]}`);
    this.engine.publish(true);
  }

  setSpeed(cap: number) {
    const ids = this.commandIds();
    if (!this.need(ids)) return;
    this.engine.battle.configure(ids, { speedCap: cap });
    if (cap === 0) this.engine.battle.setOrder(ids, { type: 'hold' });
    pushToast(cap >= 1 ? '전속 노 젓기' : cap >= 0.6 ? '반속' : cap > 0 ? '미속' : '정지');
    this.engine.publish(true);
  }

  setStance(stance: Stance) {
    const ids = this.commandIds();
    if (!this.need(ids)) return;
    const b = this.engine.battle;
    b.configure(ids, { stance, repel: false });
    for (const id of ids) {
      const s = b.get(id)!;
      if (s.order.type === 'hold' || s.order.type === 'slot' || s.order.type === 'move' || s.order.type === 'follow' || s.order.type === 'broadside') s.order = { type: 'auto' };
    }
    pushToast(STANCE_NAMES[stance]);
    this.engine.publish(true);
  }

  presentBroadside() {
    const ids = this.commandIds();
    if (!this.need(ids)) return;
    const b = this.engine.battle;
    for (const id of ids) {
      const s = b.get(id)!;
      const target = b.get(s.targetId);
      if (!b.isActive(target)) continue;
      const bearing = Math.atan2(target.z - s.z, target.x - s.x);
      const portDiff = Math.abs(Math.atan2(Math.sin(bearing + Math.PI / 2 - s.heading), Math.cos(bearing + Math.PI / 2 - s.heading)));
      const starDiff = Math.abs(Math.atan2(Math.sin(bearing - Math.PI / 2 - s.heading), Math.cos(bearing - Math.PI / 2 - s.heading)));
      b.setOrder([id], { type: 'broadside', targetId: target.id, side: portDiff < starDiff ? 0 : 1 });
    }
    pushToast('측면을 적에게 — 포문 정렬');
    this.engine.publish(true);
  }

  toggleLights() {
    const ids = this.commandIds(true);
    const b = this.engine.battle;
    const first = b.get(ids[0] ?? 0);
    const on = !(first?.lights ?? true);
    b.configure(ids, { lights: on });
    pushToast(on ? '등불을 밝힌다' : '등화관제 — 불을 끈다');
    this.engine.publish(true);
  }

  repel() {
    const ids = this.commandIds();
    if (!this.need(ids)) return;
    const b = this.engine.battle;
    b.configure(ids, { repel: true, stance: 'standoff' });
    const cut = b.cutGrapples(ids);
    pushToast(cut ? `갈고리를 끊고 이탈 — ${cut}척` : '등선 거부 — 적의 접현을 막는다');
    this.engine.publish(true);
  }

  auto() {
    let ids = this.selectedOwn();
    if (!ids.length) ids = this.ownShips().map((s) => s.id);
    this.engine.battle.setOrder(ids, { type: 'auto' });
    pushToast('자유 교전');
  }

  hold() {
    const ids = this.selectedOwn();
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
    const own = this.ownShips();
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
      case 'Digit3':
        this.formation('column');
        break;
      case 'Digit4':
        this.formation('wedge');
        break;
      case 'Digit5':
        this.setSpeed(1);
        break;
      case 'Digit6':
        this.setSpeed(0.6);
        break;
      case 'Digit7':
        this.setSpeed(0.3);
        break;
      case 'KeyZ':
        this.volley(0);
        break;
      case 'KeyX':
        this.volley(1);
        break;
      case 'KeyY':
        this.toggleFire();
        break;
      case 'KeyT':
        this.cycleAmmo();
        break;
      case 'KeyU':
        this.presentBroadside();
        break;
      case 'KeyK':
        this.setStance('standoff');
        break;
      case 'KeyJ':
        this.setStance('close');
        break;
      case 'KeyN':
        this.setStance('ram');
        break;
      case 'KeyB':
        this.setStance('board');
        break;
      case 'KeyP':
        this.repel();
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
        this.toggleLights();
        break;
      case 'KeyI':
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
    const team = this.engine.team;
    for (const e of events) {
      if (e.type === 'sinking') {
        const s = b.get(e.ship);
        if (s) pushToast(`${s.team === team ? '아군' : '적'} ${s.spec.label} 침몰 — ${s.name}`, s.team === team ? 'bad' : 'good');
      } else if (e.type === 'struck') {
        const s = b.get(e.ship);
        if (s) pushToast(`${s.team === team ? '아군' : '적'} ${s.spec.label} 전투 불능 — ${s.name}`, s.team === team ? 'bad' : 'good');
      } else if (e.type === 'explode') {
        const s = b.get(e.ship);
        if (s) pushToast(`화약고 폭발 — ${s.name}`, s.team === team ? 'bad' : 'good');
      }
    }
  }
}
