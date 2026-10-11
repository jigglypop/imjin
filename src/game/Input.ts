import { Ray, Vector2, Vector3 } from 'three/webgpu';
import type { Engine } from './Engine';
import type { AmmoMode, BattleEvent, CrewPlan, Ship, Stance } from '../sim/types';
import { BUILDINGS } from '../sim/conquest';
import { setSelectionBox, pushToast, useUi } from '../state/store';
import { t } from '../i18n';
import { tName, tShips } from '../ui/battleNames';
import { shipObserved } from '../sim/observation';
import { pointVisible } from '../sim/visibility';
import type { FormationKind } from '../sim/commands';
import { COASTAL_TACTICS } from '../sim/coastal-tactics';

const DRAG_THRESHOLD = 6;

export const FORMATION_NAMES = { crane: '학익진', line: '일자진', column: '장사진', wedge: '첨자진', 'yeosu-wings': COASTAL_TACTICS['yeosu-wings'].label, 'mokpo-depth': COASTAL_TACTICS['mokpo-depth'].label } as const;
export const AMMO_NAMES: Record<AmmoMode, string> = { auto: '기본탄', hull: '대장군전·철환 (선체 파괴)', crew: '조란환 (승조원 공격)', fire: '화전 (불화살)' };
export const STANCE_NAMES: Record<Stance, string> = { auto: '자유교전', standoff: '원거리 포격 · 거리를 유지합니다', close: '근접 포격 · 바짝 붙어 쏩니다', ram: '들이받기 · 적 함선에 부딪칩니다', board: '백병전 돌입 · 적 함선에 올라탑니다' };

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
  private groupBattle: Engine['battle'] | null = null;
  private readonly groups = Array.from({ length: 8 }, () => ({ name: '', ids: [] as number[] }));
  private lastGroup = -1;
  private lastGroupTime = 0;
  queueMoves = false;
  private pendingRally = -1;

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
    this.pendingRally = -1;
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
      if (!s.alive || s.sinking > 0.5 || !shipObserved(this.engine.battle, this.engine.team, s)) continue;
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
    const o = this.ray.origin;
    const waves = this.engine.battle.waves;
    // Aim at the water surface the player sees, not the flat plane under it: the marker is drawn on the waves,
    // so a plane hit would sit a crest's height away from the cursor.
    let t = -o.y / d.y;
    for (let i = 0; i < 3; i += 1) {
      const h = waves.heightAt(o.x + d.x * t, o.z + d.z * t, waves.time, 8);
      t = (h - o.y) / d.y;
    }
    return this.tmp.copy(o).addScaledVector(d, t);
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
      this.command(e.clientX, e.clientY, e.shiftKey || this.queueMoves);
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
    if (this.resolveRally(clientX, clientY)) return;
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
    this.command(clientX, clientY, this.queueMoves);
  }

  clearSelection() {
    this.engine.views.selected.clear();
    this.engine.rts.followId = 0;
    this.engine.publish(true);
  }

  /** Groups belong to this battle; changing scenarios must never reuse another fleet's ship ids. */
  getGroups() {
    if (this.groupBattle !== this.engine.battle) {
      this.groupBattle = this.engine.battle;
      for (const group of this.groups) { group.name = ''; group.ids = []; }
      this.lastGroup = -1;
      this.queueMoves = false;
      this.pendingRally = -1;
    }
    const selected = this.selectedOwn();
    return this.groups.map((group, index) => {
      group.ids = group.ids.filter((id) => this.engine.isOwn(this.engine.battle.get(id)));
      return { index, name: group.name || t('부대 {n}', { n: index + 1 }), count: group.ids.length, selected: group.ids.length > 0 && selected.length === group.ids.length && group.ids.every((id) => selected.includes(id)) };
    });
  }

  assignGroup(index: number, additive = false) {
    this.getGroups();
    const group = this.groups[index];
    const ids = this.selectedOwn();
    if (!group || !this.need(ids)) return;
    group.ids = additive ? [...new Set([...group.ids, ...ids])] : ids;
    pushToast(t('부대 {n} 지정 · {ships}', { n: index + 1, ships: tShips(group.ids.length) }));
    this.engine.publish(true);
  }

  renameGroup(index: number, name: string) {
    this.getGroups();
    const group = this.groups[index];
    if (!group) return;
    group.name = name.replace(/\s+/g, ' ').trim().slice(0, 16);
    this.engine.publish(true);
  }

  selectGroup(index: number, focus = false) {
    this.getGroups();
    const group = this.groups[index];
    if (!group?.ids.length) return;
    const now = performance.now();
    focus ||= this.lastGroup === index && now - this.lastGroupTime < 350;
    this.lastGroup = index;
    this.lastGroupTime = now;
    this.engine.views.selected.clear();
    for (const id of group.ids) this.engine.views.selected.add(id);
    this.engine.rts.followId = 0;
    if (focus) {
      const ships = group.ids.map((id) => this.engine.battle.get(id)!);
      const x = ships.reduce((sum, s) => sum + s.x, 0) / ships.length;
      const z = ships.reduce((sum, s) => sum + s.z, 0) / ships.length;
      const spread = Math.max(...ships.map((s) => Math.hypot(s.x - x, s.z - z)));
      this.engine.rts.goal.tx = x;
      this.engine.rts.goal.tz = z;
      this.engine.rts.goal.distance = Math.min(this.engine.rts.goal.distance, Math.max(240, spread * 2.4));
      this.engine.rts.cinematic = false;
    }
    this.engine.publish(true);
  }

  selectAll() {
    this.engine.views.selected.clear();
    for (const s of this.ownShips()) this.engine.views.selected.add(s.id);
    this.engine.publish(true);
  }

  queuedWaypoints() {
    return Math.max(0, ...this.selectedOwn().map((id) => {
      const s = this.engine.battle.get(id)!;
      return this.engine.remote ? s.remoteQueueCount ?? 0 : s.orderQueue?.length ?? 0;
    }));
  }

  toggleQueueMode() {
    this.queueMoves = !this.queueMoves;
    this.engine.publish(true);
  }

  beginRally(point: number) {
    this.getGroups();
    const p = this.engine.conquest?.points[point];
    if (!Number.isInteger(point) || !p || p.owner !== this.engine.owner) return false;
    this.pendingRally = point;
    pushToast(t('바다를 우클릭하거나 탭해 집결 지점을 지정하세요'));
    this.engine.publish(true);
    return true;
  }

  private resolveRally(clientX: number, clientY: number) {
    this.getGroups();
    if (this.pendingRally < 0) return false;
    const point = this.pendingRally;
    const owned = this.engine.conquest?.points[point]?.owner === this.engine.owner;
    if (!owned) { this.pendingRally = -1; return true; }
    const p = this.waterPoint(clientX, clientY);
    if (!p) return true;
    if (this.engine.battle.land(p.x, p.z) >= -2) {
      pushToast(t('집결 지점은 바다에 지정하세요'));
      return true;
    }
    this.engine.issue({ type: 'rally', point, x: p.x, z: p.z });
    this.pendingRally = -1;
    pushToast(t('집결 지점을 지정했습니다'));
    this.engine.publish(true);
    return true;
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
    if (this.resolveRally(clientX, clientY)) return;
    const ids = this.selectedOwn();
    if (!ids.length) return;
    const b = this.engine.battle;
    const target = this.pickShip(clientX, clientY);
    if (target && target.team === this.engine.enemyTeam && b.isActive(target)) {
      this.engine.issue({ type: 'order', ids, order: { type: 'attack', targetId: target.id } });
      pushToast(t('공격 명령 · {name} · {ships}', { name: tName(target.name), ships: tShips(ids.length) }));
      return;
    }
    const works = this.pickWorks(clientX, clientY);
    if (works) {
      this.engine.issue({ type: 'order', ids, order: { type: 'bombard', x: works.x, y: works.y, z: works.z } });
      pushToast(t('포격 명령 · {name} · {ships}', { name: t(works.name), ships: tShips(ids.length) }));
      return;
    }
    const p = this.waterPoint(clientX, clientY);
    if (!p) return;
    this.moveSelected(p.x, p.z, queue);
  }

  /** An enemy shore work under the cursor, picked on screen within a few dozen pixels. */
  private pickWorks(clientX: number, clientY: number) {
    const c = this.engine.conquest;
    if (!c || !this.dom) return null;
    const rect = this.dom.getBoundingClientRect();
    let best: { x: number; y: number; z: number; name: string } | null = null;
    let bestD = 34;
    for (const p of c.points) {
      const team = c.teamOfPoint(p);
      if (!team || team === this.engine.team || !pointVisible(this.engine.battle, this.engine.team, p.x, p.z)) continue;
      p.buildings.forEach((bd, i) => {
        if (!bd) return;
        const spot = p.slots[i]!;
        const y = this.engine.terrain.heightAt(spot.x, spot.z) + 5;
        if (!this.engine.screenPosition(spot.x, y, spot.z, this.screen)) return;
        const d = Math.hypot(this.screen.x - (clientX - rect.left), this.screen.y - (clientY - rect.top));
        if (d < bestD) {
          bestD = d;
          best = { x: spot.x, y, z: spot.z, name: `${p.name} ${BUILDINGS[bd.kind].label}` };
        }
      });
    }
    return best as { x: number; y: number; z: number; name: string } | null;
  }

  moveSelected(tx: number, tz: number, queue = this.queueMoves) {
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
    const list = sorted.map((id, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const inRow = Math.min(perRow, sorted.length - row * perRow);
      const off = (col - (inRow - 1) / 2) * 48;
      return { id, order: { type: 'move' as const, x: tx + px * off - fx * row * 60, z: tz + pz * off - fz * row * 60 } };
    });
    this.engine.issue({ type: 'orders', list, queue });
    if (queue) pushToast(t('이동 경로 예약 · 최대 16곳'));
    this.engine.publish(true);
    this.engine.moveOrders?.show(tx, tz, queue, ids);
  }

  formation(kind: FormationKind) {
    const b = this.engine.battle;
    let ids = this.selectedOwn();
    if (!ids.length) ids = this.ownShips().filter((s) => s.spec.kind !== 'geobukseon').map((s) => s.id);
    let ex = 0;
    let ez = 0;
    let n = 0;
    for (const s of b.ships) {
      if (s.team !== this.engine.enemyTeam || !b.isActive(s) || !shipObserved(b, this.engine.team, s)) continue;
      ex += s.x;
      ez += s.z;
      n += 1;
    }
    if (!n) {
      const ships = ids.map((id) => b.get(id)).filter((s): s is Ship => !!s);
      if (!ships.length) return;
      ex = ships.reduce((v, s) => v + s.x + Math.cos(s.heading) * 1000, 0);
      ez = ships.reduce((v, s) => v + s.z + Math.sin(s.heading) * 1000, 0);
      n = ships.length;
    }
    this.engine.issue({ type: 'formation', ids, kind, cx: ex / n, cz: ez / n });
    this.engine.sound.drums(kind === 'crane' ? 3 : 2);
    pushToast(t('{name|을/를} 펼칩니다', { name: t(FORMATION_NAMES[kind]) }));
  }

  private commandIds(all = false) {
    const ids = this.selectedOwn();
    if (ids.length || !all) return ids;
    return this.ownShips().map((s) => s.id);
  }

  private need(ids: number[]) {
    if (ids.length) return true;
    pushToast(t('먼저 함선을 선택해야 합니다'));
    return false;
  }

  volley(side: 0 | 1 | 2) {
    const ids = this.commandIds();
    if (!this.need(ids)) return;
    const n = this.engine.issue({ type: 'volley', ids, side });
    this.engine.sound.drums(1);
    pushToast(t('{side} 일제 사격 · {ships}', { side: t(side === 0 ? '좌현' : side === 1 ? '우현' : '함수'), ships: tShips(n) }));
    this.engine.publish(true);
  }

  toggleFire() {
    const ids = this.commandIds(true);
    const b = this.engine.battle;
    const first = b.get(ids[0] ?? 0);
    const mode = first?.fireMode === 'hold' ? 'free' : 'hold';
    this.engine.issue({ type: 'configure', ids, patch: { fireMode: mode } });
    pushToast(t(mode === 'hold' ? '사격을 멈추고 장전만 합니다' : '자유 사격으로 바꿉니다'));
    this.engine.publish(true);
  }

  cycleAmmo() {
    const ids = this.commandIds(true);
    const b = this.engine.battle;
    const order: AmmoMode[] = ['auto', 'hull', 'crew', 'fire'];
    const first = b.get(ids[0] ?? 0);
    const next = order[(order.indexOf(first?.ammo ?? 'auto') + 1) % order.length]!;
    this.engine.issue({ type: 'configure', ids, patch: { ammo: next } });
    pushToast(t('탄종 변경 · {name}', { name: t(AMMO_NAMES[next]) }));
    this.engine.publish(true);
  }

  setSpeed(cap: number) {
    const ids = this.commandIds();
    if (!this.need(ids)) return;
    this.engine.issue({ type: 'configure', ids, patch: { speedCap: cap } });
    if (cap === 0) this.engine.issue({ type: 'order', ids, order: { type: 'hold' } });
    pushToast(t(cap >= 1 ? '전속으로 이동합니다' : cap >= 0.6 ? '반속으로 이동합니다' : cap > 0 ? '저속으로 이동합니다' : '정지합니다'));
    this.engine.publish(true);
  }

  setStance(stance: Stance) {
    const ids = this.commandIds();
    if (!this.need(ids)) return;
    this.engine.issue({ type: 'configure', ids, patch: { stance, repel: false } });
    pushToast(t(STANCE_NAMES[stance]));
    this.engine.publish(true);
  }

  presentBroadside() {
    const ids = this.commandIds();
    if (!this.need(ids)) return;
    const b = this.engine.battle;
    const list = [];
    for (const id of ids) {
      const s = b.get(id)!;
      const target = b.get(s.targetId);
      if (!b.isActive(target) || !shipObserved(b, this.engine.team, target)) continue;
      list.push({ id, order: { type: 'broadside' as const, targetId: target.id, side: b.sideToward(s, target.x, target.z) } });
    }
    this.engine.issue({ type: 'orders', list });
    pushToast(t('측면을 적에게 돌립니다'));
    this.engine.publish(true);
  }

  toggleLights() {
    const b = this.engine.battle;
    if (!b.night) {
      pushToast(t('낮에는 등불을 끌 필요가 없습니다'));
      return;
    }
    const ids = this.commandIds(true);
    const first = b.get(ids[0] ?? 0);
    const on = !(first?.lights ?? true);
    this.engine.issue({ type: 'configure', ids, patch: { lights: on } });
    pushToast(t(on ? '등불을 켰습니다' : '등불을 껐습니다 · 적이 가까이 와야 알아봅니다'));
    this.engine.publish(true);
  }

  repel() {
    const ids = this.commandIds();
    if (!this.need(ids)) return;
    this.engine.issue({ type: 'configure', ids, patch: { repel: true, stance: 'standoff' } });
    const cut = this.engine.issue({ type: 'cut', ids });
    pushToast(cut ? t('갈고리를 끊고 {n}척이 이탈합니다', { n: cut }) : t('적의 백병전을 막습니다'));
    this.engine.publish(true);
  }

  auto() {
    let ids = this.selectedOwn();
    if (!ids.length) ids = this.ownShips().map((s) => s.id);
    this.engine.issue({ type: 'order', ids, order: { type: 'auto' } });
    pushToast(t('자유교전으로 바꿉니다'));
  }

  hold() {
    const ids = this.selectedOwn();
    if (!ids.length) return;
    this.engine.issue({ type: 'order', ids, order: { type: 'hold' } });
    pushToast(t('정지합니다'));
  }

  /** Station plan for the selection: more hands at the oars, the guns, the bows or on deck. */
  setPlan(plan: CrewPlan, label: string) {
    const ids = this.commandIds(true);
    if (!this.need(ids)) return;
    this.engine.issue({ type: 'plan', ids, plan });
    pushToast(t('승조원 배치 · {label}', { label }));
    this.engine.publish(true);
  }

  followSelected() {
    const id = [...this.engine.views.selected][0];
    if (id) {
      this.engine.rts.followId = this.engine.rts.followId === id ? 0 : id;
      if (this.engine.rts.followId) this.engine.rts.cinematic = false;
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
    const target = e.target as HTMLElement | null;
    if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '') || e.repeat) return;
    const digit = /^Digit([1-8])$/.exec(e.code);
    if (digit) {
      e.preventDefault();
      const index = Number(digit[1]) - 1;
      if (e.ctrlKey || e.metaKey) this.assignGroup(index);
      else if (e.altKey) {
        if (index < 4) this.formation((['crane', 'line', 'column', 'wedge'] as const)[index]!);
        else if (index < 7) this.setSpeed([1, 0.6, 0.3][index - 4]!);
      } else if (e.shiftKey) this.assignGroup(index, true);
      else this.selectGroup(index);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') {
      e.preventDefault();
      this.selectAll();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.code) {
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
      case 'KeyO':
        this.followSelected();
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
        this.engine.director.toggleCinematic();
        pushToast(t(this.engine.rts.cinematic ? '연출 카메라를 켰습니다 · C로 끕니다' : '연출 카메라를 껐습니다'));
        this.engine.publish(true);
        break;
      case 'KeyV':
        this.engine.director.toggleSlowMo();
        pushToast(t(this.engine.director.slowMo ? '슬로모션을 켰습니다' : '슬로모션을 껐습니다'));
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
        this.pendingRally = -1;
        this.engine.views.selected.clear();
        this.engine.rts.followId = 0;
        this.engine.selectedPoint = -1;
        this.engine.publish(true);
        break;
      case 'KeyF':
        if (e.shiftKey && !e.repeat) this.engine.toggleCutaway();
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
        if (s) pushToast(t(s.team === team ? '아군 함선 침몰 · {name}' : '적 함선 침몰 · {name}', { name: tName(s.name) }), s.team === team ? 'bad' : 'good');
      } else if (e.type === 'struck') {
        const s = b.get(e.ship);
        if (s) pushToast(t(s.team === team ? '아군 함선 전투 불능 · {name}' : '적 함선 전투 불능 · {name}', { name: tName(s.name) }), s.team === team ? 'bad' : 'good');
      } else if (e.type === 'explode') {
        const s = b.get(e.ship);
        if (s) pushToast(t('탄약고 폭발 · {name}', { name: tName(s.name) }), s.team === team ? 'bad' : 'good');
      } else if (e.type === 'captured') {
        const c = this.engine.conquest;
        const p = c?.points[e.point];
        if (!c || !p) continue;
        if (e.owner < 0) {
          const lost = e.from >= 0 && c.player(e.from)?.team === team;
          pushToast(t(lost ? '거점 상실 · {name}' : '적 수비대를 무너뜨렸습니다 · {name}', { name: t(p.name) }), lost ? 'bad' : 'good');
        } else {
          const ours = c.player(e.owner)?.team === team;
          pushToast(t(ours ? '거점 점령 · {name}' : '적이 거점을 점령했습니다 · {name}', { name: t(p.name) }), ours ? 'good' : 'bad');
        }
      } else if (e.type === 'built') {
        const p = this.engine.conquest?.points[e.point];
        if (p && e.owner === this.engine.owner) pushToast(t('{building} 완공 · {name}', { building: t(BUILDINGS[e.building as keyof typeof BUILDINGS].label), name: t(p.name) }), 'good');
      } else if (e.type === 'razed') {
        const c = this.engine.conquest;
        const p = c?.points[e.point];
        if (c && p) pushToast(t('{building} 파괴 · {name}', { building: t(BUILDINGS[e.building as keyof typeof BUILDINGS].label), name: t(p.name) }), c.teamOfPoint(p) === team ? 'bad' : 'good');
      } else if (e.type === 'spawned') {
        const s = b.get(e.ship);
        if (s && s.owner === this.engine.owner) pushToast(t('함선 완공 · {name}', { name: tName(s.name) }));
      }
    }
  }
}
