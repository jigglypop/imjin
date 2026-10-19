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
import { isTouchDevice } from './device';
import { autoFront, DRAG_FORMATIONS, frontAt, layoutFormation, type DragFormation, type FormationSlot } from './formationLayout';
import type { ManeuverKind, ManeuverPhase, SignalKind } from '../sim/maneuvers';

const DRAG_THRESHOLD = 6;
/** A right-button drag longer than this (pixels) lays a formation along it instead of giving a move order. */
const FORM_DRAG_THRESHOLD = 14;

export const FORMATION_NAMES = { crane: '학익진', line: '일자진', column: '장사진', wedge: '첨자진', 'yeosu-wings': COASTAL_TACTICS['yeosu-wings'].label, 'mokpo-depth': COASTAL_TACTICS['mokpo-depth'].label } as const;
export const AMMO_NAMES: Record<AmmoMode, string> = { auto: '기본탄', hull: '대장군전·철환 (선체 파괴)', crew: '조란환 (승조원 공격)', fire: '화전 (불화살)' };
/** Milliseconds between two morale callouts of one kind; what happens between them is counted into the next. */
const CALLOUT_GAP = 3500;
const CALLOUTS: Record<string, { ko: string; tone: 'info' | 'good' | 'bad' }> = {
  'rout-foe': { ko: '적 함선 {n}척 패주', tone: 'good' },
  'rout-own': { ko: '아군 함선 {n}척 패주 · 북을 울려 재집결하세요', tone: 'bad' },
  'rally-own': { ko: '아군 함선 {n}척 재집결', tone: 'good' },
  'rally-foe': { ko: '적 함선 {n}척 재집결', tone: 'info' },
  'drum-foe': { ko: '적이 북을 울려 전열을 다잡습니다', tone: 'info' },
  'cut-foe': { ko: '적 함선 {n}척이 지휘선과 끊겼습니다', tone: 'good' },
  'cut-own': { ko: '아군 함선 {n}척이 지휘선과 끊겼습니다 · 명령이 늦게 닿습니다', tone: 'bad' },
};
export const MANEUVER_NAMES: Record<ManeuverKind, string> = { ambush: '매복', pincer: '협공', breach: '돌파', encircle: '포위', crane: '학익진', blockade: '봉쇄', lure: '유인', pursue: '추격' };
/** What to draw on the sea once a maneuver is chosen. */
const MANEUVER_HINTS: Record<ManeuverKind, string> = {
  ambush: '매복할 구역을 바다에 그리세요 · 구역 한가운데에서 끌어 반경을 정합니다',
  pincer: '적을 가로지르는 선을 그리세요 · 두 끝에서 양쪽 날개가 조여 듭니다',
  breach: '적진을 뚫고 지나갈 길을 그리세요 · 시작점에서 빠져나갈 곳까지 끕니다',
  encircle: '포위할 적의 한가운데에서 끌어 반경을 정하세요 · 한쪽 열기를 켜면 끈 쪽을 열어 둡니다',
  crane: '학익진의 한가운데에서 적 쪽으로 끌어 그리세요',
  blockade: '막을 물목을 가로지르는 선을 그리세요',
  lure: '미끼가 나설 곳에서 물러날 곳까지 그리세요 · 물러날 곳에 본대를 매복시켜 두세요',
  pursue: '',
};
/** A plan's phase as the player reads it, by kind where it differs. */
export function phaseName(kind: ManeuverKind, phase: ManeuverPhase) {
  if (phase === 'forming') return kind === 'lure' ? '미끼가 나섭니다' : kind === 'breach' ? '돌격' : '자리 잡는 중';
  if (phase === 'waiting') return kind === 'ambush' ? '숨죽여 기다림' : kind === 'blockade' ? '물목을 막음' : '대기';
  if (phase === 'striking') return kind === 'ambush' ? '기습' : kind === 'lure' ? '물러나며 끌어들임' : kind === 'pincer' ? '조여 듦' : kind === 'breach' ? '돌파 중' : kind === 'pursue' ? '추격 중' : '포위망을 좁힘';
  return '끝';
}
const SIGNAL_NAMES: Record<SignalKind, string> = { advance: '진군 북', withdraw: '퇴각 징' };
/** A maneuver being drawn on the sea: from where the drag started to where it is now. */
/** A formation being laid with the right button: the front from where the drag began to where it is now. */
export type FormDrag = { x0: number; z0: number; x1: number; z1: number; downX: number; downY: number; active: boolean; queue: boolean };
export type Placing = { kind: ManeuverKind; open: boolean; x0: number; z0: number; x1: number; z1: number; drawn: boolean; downX: number; downY: number };

export type Posture = 'attack' | 'defend' | 'lure';
/** A suggested order: its text (with `n` filled in), and what pressing it does. */
export type Advice = { key: string; text: string; n?: number; run: () => void };
export const POSTURE_NAMES: Record<Posture, string> = { attack: '공격', defend: '방어', lure: '유인' };
const POSTURE_TOASTS: Record<Posture, string> = { attack: '공격 · 적에게 바짝 붙어 싸웁니다', defend: '방어 · 거리를 두고 쏩니다', lure: '유인 · 쏘면서 본대 쪽으로 물러납니다' };

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
  private battleSeen: Engine['battle'] | null = null;
  queueMoves = false;
  private pendingRally = -1;
  /** The maneuver waiting to be drawn on the sea, once its button was pressed. */
  placing: Placing | null = null;
  /** The formation a right-button drag lays, picked with 1-4 or the formation buttons. */
  formKind: DragFormation = 'line';
  formDrag: FormDrag | null = null;
  /** The formation a button under the pointer would lay, shown on the sea before it is pressed. */
  formHover: DragFormation | null = null;
  /**
   * A formation waiting to be placed, after 1-4 or a formation button: its ghost follows the pointer, facing the enemy;
   * pressing the left button on the sea pins its centre and dragging turns it to face the pointer; release lays it.
   * The right button or Esc gives it up.
   */
  formPlace: { kind: DragFormation; ids: number[]; cx: number; cz: number; face: number; width: number; pinned: boolean; downX: number; downY: number; turned: boolean } | null = null;
  private pointerX = -1;
  private pointerY = -1;
  private readonly postures = new Map<number, Posture>();
  private adviceAt = 0;
  private lastAdvice: Advice | null = null;
  private readonly adviceRest = new Map<string, number>();
  /** Morale callouts gathered while the last one of their kind is still on screen, by kind. */
  private readonly callouts = new Map<string, { at: number; n: number }>();

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
    const fp = this.formPlace;
    if (fp) {
      if (e.button === 2) this.cancelFormation();
      else if (e.button === 0) {
        const p = this.waterPoint(e.clientX, e.clientY);
        if (p) {
          fp.cx = p.x;
          fp.cz = p.z;
        }
        fp.pinned = true;
        fp.turned = false;
        fp.downX = e.clientX;
        fp.downY = e.clientY;
      }
      return;
    }
    if (this.placing) {
      // Drawing a maneuver: the left button draws it, the right one gives it up.
      if (e.button === 0) this.placeStart(e.clientX, e.clientY);
      else if (e.button === 2) this.cancelManeuver();
      return;
    }
    if (e.button === 0 && !e.altKey) {
      this.leftDown = true;
      this.dragging = false;
      this.downX = e.clientX;
      this.downY = e.clientY;
    } else if (e.button === 2) {
      const queue = e.shiftKey || this.queueMoves;
      // A rally point, no ships to lay out, or an enemy or the shore under the press: the click commands at once.
      // Only a press on open water with ships selected may grow into a formation drag, decided on release.
      const p = this.pendingRally < 0 && this.selectedOwn().length ? this.waterPoint(e.clientX, e.clientY) : null;
      if (!p || this.pickShip(e.clientX, e.clientY) || this.pickWorks(e.clientX, e.clientY)) {
        this.formDrag = null;
        this.command(e.clientX, e.clientY, queue);
        return;
      }
      this.formDrag = { x0: p.x, z0: p.z, x1: p.x, z1: p.z, downX: e.clientX, downY: e.clientY, active: false, queue };
    }
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
    const fp = this.formPlace;
    if (fp) {
      const p = this.waterPoint(e.clientX, e.clientY);
      if (!p) return;
      if (!fp.pinned) {
        // Unpinned the ghost rides the pointer and keeps facing the enemy from wherever it is.
        fp.cx = p.x;
        fp.cz = p.z;
        const enemy = this.enemyCentre(fp.ids);
        if (enemy?.seen) fp.face = Math.atan2(enemy.z - p.z, enemy.x - p.x);
      } else if (Math.hypot(e.clientX - fp.downX, e.clientY - fp.downY) > FORM_DRAG_THRESHOLD || fp.turned) {
        fp.turned = true;
        fp.face = Math.atan2(p.z - fp.cz, p.x - fp.cx);
      }
      return;
    }
    if (this.placing) {
      this.placeMove(e.clientX, e.clientY);
      return;
    }
    const f = this.formDrag;
    if (f) {
      if (!f.active && Math.hypot(e.clientX - f.downX, e.clientY - f.downY) > FORM_DRAG_THRESHOLD) f.active = true;
      const p = f.active ? this.waterPoint(e.clientX, e.clientY) : null;
      if (p) {
        f.x1 = p.x;
        f.z1 = p.z;
      }
      return;
    }
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
    const fp = this.formPlace;
    if (fp) {
      const p = this.waterPoint(clientX, clientY);
      if (p) {
        fp.cx = p.x;
        fp.cz = p.z;
        const enemy = this.enemyCentre(fp.ids);
        if (enemy?.seen) fp.face = Math.atan2(enemy.z - p.z, enemy.x - p.x);
        this.confirmFormation();
      }
      return;
    }
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

  /** Per-battle input state resets when the battle changes, so a new scenario never inherits a queued route. */
  syncBattle() {
    if (this.battleSeen === this.engine.battle) return;
    this.battleSeen = this.engine.battle;
    this.queueMoves = false;
    this.pendingRally = -1;
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
    this.syncBattle();
    const p = this.engine.conquest?.points[point];
    if (!Number.isInteger(point) || !p || p.owner !== this.engine.owner) return false;
    this.pendingRally = point;
    pushToast(t('바다를 우클릭하거나 탭해 집결 지점을 지정하세요'));
    this.engine.publish(true);
    return true;
  }

  private resolveRally(clientX: number, clientY: number) {
    this.syncBattle();
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
    if (e.pointerType !== 'touch' && e.button === 0 && this.formPlace?.pinned) {
      this.confirmFormation();
      return;
    }
    if (e.pointerType !== 'touch' && e.button === 2 && this.formDrag) {
      const f = this.formDrag;
      this.formDrag = null;
      if (f.active && Math.hypot(f.x1 - f.x0, f.z1 - f.z0) > 8) this.layFormation(this.formKind, f.x0, f.z0, f.x1, f.z1);
      else this.command(f.downX, f.downY, f.queue);
      return;
    }
    if (e.pointerType !== 'touch' && e.button === 0 && this.placing?.drawn) {
      this.placeEnd(e.clientX, e.clientY);
      return;
    }
    if (e.pointerType === 'touch' || e.button !== 0 || !this.leftDown) return;
    this.leftDown = false;
    const views = this.engine.views;
    if (this.dragging) {
      this.dragging = false;
      setSelectionBox(null);
      this.boxSelect(Math.min(this.downX, e.clientX), Math.min(this.downY, e.clientY), Math.max(this.downX, e.clientX), Math.max(this.downY, e.clientY), e.shiftKey);
      return;
    }
    // One click attacks: with ships of ours selected, a plain click on an enemy ship or shore work orders the strike.
    // Shift and Ctrl keep their selecting meaning, and without a selection the click only inspects the enemy.
    const own = this.selectedOwn();
    if (own.length && !e.shiftKey && !e.ctrlKey && !e.metaKey && this.strikeAt(e.clientX, e.clientY, own)) return;
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

  /** Attack the hostile ship or bombard the enemy shore work under the cursor with the given ships. False when there is neither. */
  private strikeAt(clientX: number, clientY: number, ids: number[]) {
    const target = this.pickShip(clientX, clientY);
    if (target && target.team === this.engine.enemyTeam && this.engine.battle.isActive(target)) {
      this.engine.issue({ type: 'order', ids, order: { type: 'attack', targetId: target.id } });
      pushToast(t('공격 명령 · {name} · {ships}', { name: tName(target.name), ships: tShips(ids.length) }));
      return true;
    }
    const works = this.pickWorks(clientX, clientY);
    if (works) {
      this.engine.issue({ type: 'order', ids, order: { type: 'bombard', x: works.x, y: works.y, z: works.z } });
      pushToast(t('포격 명령 · {name} · {ships}', { name: t(works.name), ships: tShips(ids.length) }));
      return true;
    }
    return false;
  }

  private command(clientX: number, clientY: number, queue: boolean) {
    if (this.resolveRally(clientX, clientY)) return;
    const ids = this.selectedOwn();
    if (!ids.length) return;
    if (this.strikeAt(clientX, clientY, ids)) return;
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

  /** The ships a formation order moves: the selection, or with none the whole fleet but the turtle ships, which roam. */
  private formationIds() {
    const ids = this.selectedOwn();
    return ids.length ? ids : this.ownShips().filter((s) => s.spec.kind !== 'geobukseon' && this.engine.battle.isActive(s)).map((s) => s.id);
  }

  /** Centroid of the observed enemy, or a point a kilometre ahead of these ships when none is in sight. */
  private enemyCentre(ids: number[]) {
    const b = this.engine.battle;
    let ex = 0;
    let ez = 0;
    let n = 0;
    for (const s of b.ships) {
      if (s.team !== this.engine.enemyTeam || !b.isActive(s) || !shipObserved(b, this.engine.team, s)) continue;
      ex += s.x;
      ez += s.z;
      n += 1;
    }
    if (n) return { x: ex / n, z: ez / n, seen: true };
    const ships = ids.map((id) => b.get(id)).filter((s): s is Ship => !!s);
    if (!ships.length) return null;
    ex = ships.reduce((v, s) => v + s.x + Math.cos(s.heading) * 1000, 0);
    ez = ships.reduce((v, s) => v + s.z + Math.sin(s.heading) * 1000, 0);
    return { x: ex / ships.length, z: ez / ships.length, seen: false };
  }

  private shipPositions(ids: number[]) {
    const b = this.engine.battle;
    return ids.map((id) => b.get(id)).filter((s): s is Ship => !!s && b.isActive(s)).map((s) => ({ id: s.id, x: s.x, z: s.z, flagship: s.flagship }));
  }

  /**
   * The slots a formation would take now, for the preview on the sea: along the right-button drag while one lasts,
   * else facing the enemy as a button press would lay it. Null when there is nothing to show.
   */
  formationPreview(): { kind: DragFormation; slots: FormationSlot[]; front: { x0: number; z0: number; x1: number; z1: number } } | null {
    const fp = this.formPlace;
    if (fp) {
      const ships = this.shipPositions(fp.ids);
      if (!ships.length) return null;
      const front = frontAt(fp.cx, fp.cz, fp.face, fp.width);
      return { kind: fp.kind, slots: layoutFormation(fp.kind, ships, front.x0, front.z0, front.x1, front.z1), front };
    }
    const f = this.formDrag;
    const kind = f?.active ? this.formKind : this.formHover;
    if (!kind) return null;
    const ids = f?.active ? this.selectedOwn() : this.formationIds();
    const ships = this.shipPositions(ids);
    if (!ships.length) return null;
    let front: { x0: number; z0: number; x1: number; z1: number };
    if (f?.active) front = { x0: f.x0, z0: f.z0, x1: f.x1, z1: f.z1 };
    else {
      const enemy = this.enemyCentre(ids);
      if (!enemy) return null;
      const fleet = { x: ships.reduce((v, s) => v + s.x, 0) / ships.length, z: ships.reduce((v, s) => v + s.z, 0) / ships.length };
      front = autoFront(kind, ships.length, fleet, enemy);
    }
    return { kind, slots: layoutFormation(kind, ships, front.x0, front.z0, front.x1, front.z1), front };
  }

  /** Lays a formation along a front drawn on the sea: every ship is sent to its own slot, the one the preview showed. */
  layFormation(kind: DragFormation, x0: number, z0: number, x1: number, z1: number, ids = this.selectedOwn()) {
    const slots = layoutFormation(kind, this.shipPositions(ids), x0, z0, x1, z1);
    if (!slots.length) return;
    this.engine.issue({ type: 'orders', list: slots.map((s) => ({ id: s.id, order: { type: 'slot' as const, x: s.x, z: s.z, face: s.face } })) });
    this.engine.sound.drums(kind === 'crane' ? 3 : 2);
    this.engine.moveOrders?.show((x0 + x1) / 2, (z0 + z1) / 2, false, slots.map((s) => s.id));
    pushToast(t('{name|을/를} 펼칩니다', { name: t(FORMATION_NAMES[kind]) }));
    this.engine.publish(true);
  }

  /**
   * Picks a formation. During a right-button drag or a placement it only changes the ghost; otherwise it starts a
   * placement, the ghost shown where the button would have laid it, so its place and facing are checked first.
   */
  pickFormation(kind: DragFormation) {
    this.formKind = kind;
    if (this.formDrag?.active) return;
    if (this.formPlace) {
      this.formPlace.kind = kind;
      this.formPlace.width = this.defaultWidth(kind, this.formPlace.ids.length);
      this.engine.publish(true);
      return;
    }
    const ids = this.formationIds();
    const ships = this.shipPositions(ids);
    const enemy = this.enemyCentre(ids);
    if (!ships.length || !enemy) return;
    const fleet = { x: ships.reduce((v, s) => v + s.x, 0) / ships.length, z: ships.reduce((v, s) => v + s.z, 0) / ships.length };
    const f = autoFront(kind, ships.length, fleet, enemy);
    const cx = (f.x0 + f.x1) / 2;
    const cz = (f.z0 + f.z1) / 2;
    this.formPlace = { kind, ids, cx, cz, face: Math.atan2(enemy.z - cz, enemy.x - cx), width: this.defaultWidth(kind, ships.length), pinned: false, downX: 0, downY: 0, turned: false };
    // With the pointer already on the sea the ghost starts under it.
    if (this.pointerX >= 0 && this.dom) this.onMove({ pointerType: 'mouse', clientX: this.pointerX, clientY: this.pointerY } as PointerEvent);
    pushToast(t(isTouchDevice ? '{name} · 바다를 누르면 그곳에 펼칩니다' : '{name} · 바다를 눌러 끌면 방향이 돌아갑니다 · 놓으면 펼칩니다 · 우클릭 취소', { name: t(FORMATION_NAMES[kind]) }));
    this.engine.publish(true);
  }

  private defaultWidth(kind: DragFormation, n: number) {
    const f = autoFront(kind, n, { x: 0, z: 0 }, { x: 0, z: 1000 });
    return Math.hypot(f.x1 - f.x0, f.z1 - f.z0);
  }

  /** Lays the formation being placed exactly as its ghost shows it. */
  confirmFormation() {
    const fp = this.formPlace;
    if (!fp) return;
    this.formPlace = null;
    const f = frontAt(fp.cx, fp.cz, fp.face, fp.width);
    this.layFormation(fp.kind, f.x0, f.z0, f.x1, f.z1, fp.ids);
  }

  cancelFormation() {
    if (!this.formPlace) return;
    this.formPlace = null;
    this.engine.publish(true);
  }

  formation(kind: FormationKind) {
    const b = this.engine.battle;
    const ids = this.formationIds();
    const enemy = this.enemyCentre(ids);
    if (!enemy) return;
    if (kind === 'crane' && b.maneuvers) {
      // Under the maneuver rules the crane is a maneuver: its bowl where the squadron lies, its wings reaching for the
      // enemy, and it closes round whatever comes into it.
      const ships = ids.map((id) => b.get(id)).filter((s): s is Ship => !!s);
      const fx = ships.reduce((v, s) => v + s.x, 0) / Math.max(1, ships.length);
      const fz = ships.reduce((v, s) => v + s.z, 0) / Math.max(1, ships.length);
      const d = Math.hypot(enemy.x - fx, enemy.z - fz) || 1;
      const ux = (enemy.x - fx) / d;
      const uz = (enemy.z - fz) / d;
      const r = Math.min(420, Math.max(250, d * 0.45));
      this.engine.issue({ type: 'maneuver', ids, kind: 'crane', x0: fx + ux * r, z0: fz + uz * r, x1: fx + ux * r * 2, z1: fz + uz * r * 2 });
    } else if (kind === 'crane' || kind === 'line' || kind === 'column' || kind === 'wedge') {
      // The same slots the preview drew while the button was under the pointer.
      this.formKind = kind;
      const ships = this.shipPositions(ids);
      if (!ships.length) return;
      const fleet = { x: ships.reduce((v, s) => v + s.x, 0) / ships.length, z: ships.reduce((v, s) => v + s.z, 0) / ships.length };
      const f = autoFront(kind, ships.length, fleet, enemy);
      this.layFormation(kind, f.x0, f.z0, f.x1, f.z1, ids);
      return;
    } else this.engine.issue({ type: 'formation', ids, kind, cx: enemy.x, cz: enemy.z });
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

  /**
   * A maneuver button: the selection will carry it out once it is drawn on the sea (pursuit needs no drawing). Pressing
   * the same button again gives it up.
   */
  beginManeuver(kind: ManeuverKind) {
    const ids = this.selectedOwn();
    if (!this.need(ids) || !this.engine.battle?.maneuvers) return;
    if (kind === 'pursue') {
      const s = this.engine.battle.get(ids[0]!)!;
      const n = this.engine.issue({ type: 'maneuver', ids, kind, x0: s.x, z0: s.z, x1: s.x, z1: s.z });
      pushToast(n ? t('{name} 명령 · {ships}', { name: t(MANEUVER_NAMES[kind]), ships: tShips(n) }) : t('달아나는 적이 없습니다'));
      this.engine.publish(true);
      return;
    }
    if (this.placing?.kind === kind) {
      this.cancelManeuver();
      return;
    }
    this.placing = { kind, open: false, x0: 0, z0: 0, x1: 0, z1: 0, drawn: false, downX: 0, downY: 0 };
    pushToast(t(MANEUVER_HINTS[kind]));
    this.engine.publish(true);
  }

  /** Leaves one side of the ring being drawn open, toward the end of the drag. */
  toggleOpenSide() {
    if (!this.placing) return;
    this.placing.open = !this.placing.open;
    pushToast(t(this.placing.open ? '한쪽을 열어 둡니다 · 끈 쪽으로 적이 빠져나갑니다' : '사방을 막습니다'));
    this.engine.publish(true);
  }

  cancelManeuver() {
    if (!this.placing) return;
    this.placing = null;
    pushToast(t('기동 명령을 취소했습니다'));
    this.engine.publish(true);
  }

  /** The drag that draws a maneuver starts here (mouse or one finger). */
  placeStart(clientX: number, clientY: number) {
    const p = this.placing;
    const w = this.waterPoint(clientX, clientY);
    if (!p || !w) return;
    p.x0 = p.x1 = w.x;
    p.z0 = p.z1 = w.z;
    p.downX = clientX;
    p.downY = clientY;
    p.drawn = true;
  }

  placeMove(clientX: number, clientY: number) {
    const p = this.placing;
    if (!p?.drawn) return;
    const w = this.waterPoint(clientX, clientY);
    if (!w) return;
    p.x1 = w.x;
    p.z1 = w.z;
  }

  /** The drag ends: the maneuver is ordered with what was drawn, or a sensible shape round the point for a short tap. */
  placeEnd(clientX: number, clientY: number) {
    const p = this.placing;
    if (!p?.drawn) return;
    this.placeMove(clientX, clientY);
    const ids = this.selectedOwn();
    this.placing = null;
    if (!this.need(ids)) return;
    const b = this.engine.battle;
    const tapped = Math.hypot(clientX - p.downX, clientY - p.downY) < DRAG_THRESHOLD * 2 || Math.hypot(p.x1 - p.x0, p.z1 - p.z0) < 40;
    if (tapped) {
      // A tap: the shape is laid out from the squadron toward the point.
      let fx = 0;
      let fz = 0;
      for (const id of ids) {
        fx += b.get(id)!.x;
        fz += b.get(id)!.z;
      }
      fx /= ids.length;
      fz /= ids.length;
      const d = Math.hypot(p.x0 - fx, p.z0 - fz) || 1;
      const ux = (p.x0 - fx) / d;
      const uz = (p.z0 - fz) / d;
      const half = Math.max(250, ids.length * 35);
      if (p.kind === 'pincer' || p.kind === 'blockade') {
        p.x1 = p.x0 + uz * half;
        p.z1 = p.z0 - ux * half;
        p.x0 -= uz * half;
        p.z0 += ux * half;
      } else if (p.kind === 'breach') {
        p.x1 = p.x0 + ux * 400;
        p.z1 = p.z0 + uz * 400;
        p.x0 -= ux * 400;
        p.z0 -= uz * 400;
      } else if (p.kind === 'lure') {
        p.x1 = fx;
        p.z1 = fz;
      } else {
        p.x1 = p.x0 + ux * 320;
        p.z1 = p.z0 + uz * 320;
      }
    }
    const n = this.engine.issue({ type: 'maneuver', ids, kind: p.kind, x0: p.x0, z0: p.z0, x1: p.x1, z1: p.z1, ...(p.kind === 'encircle' ? { open: p.open } : {}) });
    if (n) {
      this.engine.sound.drums(2);
      pushToast(t('{name} 명령 · {ships}', { name: t(MANEUVER_NAMES[p.kind]), ships: tShips(n) }), 'good');
    } else pushToast(t('그곳에는 {name|을/를} 펼칠 수 없습니다', { name: t(MANEUVER_NAMES[p.kind]) }));
    this.engine.publish(true);
  }

  /** A flagship's signal to the whole fleet: the drum springs the waiting maneuvers and opens fire, the gong falls back. */
  signal(kind: SignalKind) {
    const ids = this.commandIds(true);
    if (!this.need(ids) || !this.engine.battle?.maneuvers) return;
    const n = this.engine.issue({ type: 'signal', ids, signal: kind });
    if (kind === 'advance') this.engine.sound.drums(3);
    pushToast(n ? t(kind === 'advance' ? '{name} · 매복과 대기 중인 기동이 일제히 나섭니다' : '{name} · 함선들이 물러납니다', { name: t(SIGNAL_NAMES[kind]) }) : t('신호를 받을 함선이 없습니다'), n ? 'good' : 'info');
    this.engine.publish(true);
  }

  volley(side: 0 | 1 | 2 | 3) {
    const ids = this.commandIds();
    if (!this.need(ids)) return;
    const n = this.engine.issue({ type: 'volley', ids, side });
    this.engine.sound.drums(1);
    pushToast(t('{side} 일제 사격 · {ships}', { side: t(side === 0 ? '좌현' : side === 1 ? '우현' : side === 3 ? '양현' : '함수'), ships: tShips(n) }));
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

  /**
   * The selection's squadron leaders beat the drum (the battle depth rules): wavering ships near them steady and running
   * ones rally. A squadron's drum needs its leader afloat and rests between beats.
   */
  drum() {
    const ids = this.commandIds();
    if (!this.need(ids)) return;
    const b = this.engine.battle;
    const morale = b.morale;
    if (!morale) return;
    const squadrons = new Set<number>();
    for (const id of ids) {
      const sq = b.squadron(b.get(id)?.squadronId ?? 0);
      const leader = sq ? b.get(sq.leaderId) : undefined;
      if (sq && b.isActive(leader) && leader.moraleState !== 'routing' && morale.drumWait(sq.id) <= 0) squadrons.add(sq.id);
    }
    if (!squadrons.size) {
      pushToast(t('지금은 북을 울릴 수 없습니다 · 부대장선이 없거나 북이 쉬는 중입니다'));
      return;
    }
    this.engine.issue({ type: 'drum', ids });
    pushToast(t('북을 울려 {n}개 부대를 재집결합니다', { n: squadrons.size }), 'good');
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

  /**
   * One word for what a squadron should do, the battle's own AI doing the rest: attack closes in and fights, defend
   * keeps its distance and shoots, lure falls back toward the rest of the fleet drawing the enemy after it.
   * Applies to the selection, or with none to the whole fleet.
   */
  posture(kind: Posture) {
    const ids = this.commandIds(true);
    if (!ids.length) return;
    const b = this.engine.battle;
    this.engine.issue({ type: 'configure', ids, patch: { stance: kind === 'attack' ? 'close' : 'standoff', repel: false } });
    if (kind === 'lure') {
      const enemy = this.enemyCentre(ids);
      const picked = new Set(ids);
      const rest = this.ownShips().filter((s) => !picked.has(s.id) && b.isActive(s));
      const ships = this.shipPositions(ids);
      if (enemy?.seen && ships.length) {
        const fx = ships.reduce((v, s) => v + s.x, 0) / ships.length;
        const fz = ships.reduce((v, s) => v + s.z, 0) / ships.length;
        // Back toward the main body when there is one, else straight away from the enemy.
        let dx = rest.length ? rest.reduce((v, s) => v + s.x, 0) / rest.length - fx : fx - enemy.x;
        let dz = rest.length ? rest.reduce((v, s) => v + s.z, 0) / rest.length - fz : fz - enemy.z;
        const d = Math.hypot(dx, dz) || 1;
        dx /= d;
        dz /= d;
        const back = Math.min(700, Math.max(350, d * 0.8));
        this.engine.issue({ type: 'orders', list: ships.map((s) => ({ id: s.id, order: { type: 'move' as const, x: s.x + dx * back, z: s.z + dz * back } })) });
      }
    } else this.engine.issue({ type: 'order', ids, order: { type: 'auto' } });
    for (const id of ids) this.postures.set(id, kind);
    pushToast(t(POSTURE_TOASTS[kind]));
    this.engine.publish(true);
  }

  /**
   * One suggested order for the moment, worked out from what the player can see; the HUD shows it as a single button.
   * A suggestion acted on rests for a while so the same one does not come straight back.
   */
  advice(): Advice | null {
    const engine = this.engine;
    const b = engine.battle;
    if (!b || b.ended) return null;
    const now = performance.now();
    if (now - this.adviceAt < 1000) return this.lastAdvice;
    this.adviceAt = now;
    const own = this.ownShips().filter((s) => b.isActive(s));
    const foe = b.ships.filter((s) => s.team === engine.enemyTeam && b.isActive(s) && shipObserved(b, engine.team, s));
    const resting = (key: string) => now < (this.adviceRest.get(key) ?? 0);
    const pick = (a: Advice | null) => (this.lastAdvice = a && !resting(a.key) ? a : null);
    if (!own.length || !foe.length) return pick(null);
    const ox = own.reduce((v, s) => v + s.x, 0) / own.length;
    const oz = own.reduce((v, s) => v + s.z, 0) / own.length;
    const routing = own.filter((s) => s.moraleState === 'routing').length;
    if (b.morale && routing >= 2 && !resting('drum')) return pick({ key: 'drum', text: '아군 {n}척이 달아납니다 · 북을 울려 재집결', n: routing, run: () => this.drumAll() });
    const flag = foe.find((s) => s.flagship);
    if (flag && Math.hypot(flag.x - ox, flag.z - oz) < 900 && !resting('flag')) {
      return pick({ key: 'flag', text: '적 대장선이 가깝습니다 · 집중 공격', run: () => this.focusFire(flag) });
    }
    const contact = foe.some((f) => own.some((s) => Math.hypot(f.x - s.x, f.z - s.z) < 700));
    const formed = own.filter((s) => s.order.type === 'slot' || s.order.type === 'follow').length >= own.length * 0.6;
    if (!contact && !formed && own.length >= 3) {
      const kind: DragFormation = own.length >= 6 && foe.length >= 3 ? 'crane' : 'line';
      return pick({ key: 'form', text: kind === 'crane' ? '적이 다가옵니다 · 학익진으로 감싸기' : '적이 다가옵니다 · 일자진으로 맞서기', run: () => this.pickFormation(kind) });
    }
    const foeRouting = foe.filter((s) => s.moraleState === 'routing').length;
    if (contact && (foe.length <= own.length * 0.5 || foeRouting >= Math.max(2, foe.length * 0.3))) {
      return pick({ key: 'attack', text: '적이 무너집니다 · 공격', run: () => this.posture('attack') });
    }
    const idle = own.filter((s) => s.order.type === 'hold').length;
    if (contact && idle >= own.length * 0.5) return pick({ key: 'auto', text: '멈춰 선 함선이 많습니다 · 자유교전', run: () => this.auto() });
    return pick(null);
  }

  /** Carries out the suggestion on screen, then lets it rest. */
  takeAdvice(a: Advice) {
    this.adviceRest.set(a.key, performance.now() + 40000);
    this.lastAdvice = null;
    a.run();
  }

  private drumAll() {
    const ids = this.ownShips().map((s) => s.id);
    this.engine.issue({ type: 'drum', ids });
    pushToast(t('북을 울려 재집결합니다'), 'good');
  }

  private focusFire(target: Ship) {
    const ids = this.commandIds(true);
    this.engine.issue({ type: 'order', ids, order: { type: 'attack', targetId: target.id } });
    pushToast(t('공격 명령 · {name} · {ships}', { name: tName(target.name), ships: tShips(ids.length) }));
  }

  /** The posture last given to a ship, for lighting its button. */
  postureOf(id: number) {
    return this.postures.get(id);
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
      // 1-4 lay a formation (and pick the one a right-button drag lays); Alt+5-7 set the sailing speed.
      if (index < 4 && !e.ctrlKey && !e.metaKey && !e.shiftKey) this.pickFormation(DRAG_FORMATIONS[index]!);
      else if (e.altKey && index < 7) this.setSpeed([1, 0.6, 0.3][index - 4]!);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') {
      e.preventDefault();
      this.selectAll();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // The two orders a new player needs, where a MOBA player's hand already rests: A to attack, S to stop.
    if (!e.shiftKey && (e.code === 'KeyA' || e.code === 'KeyS')) {
      if (e.code === 'KeyA') this.posture('attack');
      else this.hold();
      return;
    }
    if (this.maneuverKey(e)) return;
    switch (e.code) {
      case 'KeyZ':
        this.volley(e.shiftKey ? 3 : 0);
        break;
      case 'KeyX':
        this.volley(e.shiftKey ? 3 : 1);
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
        // Shift+H hides the HUD (Hud.tsx), so it must not also stop the ships.
        if (!e.shiftKey) this.hold();
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
        if (this.formDrag || this.formPlace) {
          this.formDrag = null;
          this.cancelFormation();
          break;
        }
        if (this.placing) {
          this.cancelManeuver();
          break;
        }
        this.pendingRally = -1;
        this.engine.views.selected.clear();
        this.engine.rts.followId = 0;
        this.engine.selectedPoint = -1;
        this.engine.publish(true);
        break;
      case 'KeyF':
        if (e.shiftKey && !e.repeat) this.engine.toggleCutaway();
        break;
      case 'KeyR':
        // R alone tilts the camera; Shift+R beats the rally drum.
        if (e.shiftKey) this.drum();
        break;
      default:
        break;
    }
  };

  /** The maneuver keys, under the maneuver rules: Q ambush, W pincer, E ring, D breach, Shift+D blockade, Shift+A lure, F pursuit, Shift+E the drum, Shift+S the gong. */
  private maneuverKey(e: KeyboardEvent) {
    if (!this.engine.battle?.maneuvers) return false;
    const plain: Record<string, ManeuverKind> = { KeyQ: 'ambush', KeyW: 'pincer', KeyE: 'encircle', KeyD: 'breach', KeyF: 'pursue' };
    if (e.shiftKey && e.code === 'KeyA') this.beginManeuver('lure');
    else if (e.shiftKey && e.code === 'KeyD') this.beginManeuver('blockade');
    else if (e.shiftKey && e.code === 'KeyE') this.signal('advance');
    else if (e.shiftKey && e.code === 'KeyS') this.signal('withdraw');
    else if (e.shiftKey && e.code === 'KeyO' && this.placing) this.toggleOpenSide();
    else if (!e.shiftKey && plain[e.code]) this.beginManeuver(plain[e.code]!);
    else return false;
    e.preventDefault();
    return true;
  }

  onEvents(events: BattleEvent[]) {
    const b = this.engine.battle;
    const team = this.engine.team;
    // A leader's loss is called out on its own, so its sinking or capture is not announced twice.
    const leaders = new Set<number>();
    for (const e of events) if (e.type === 'leader') leaders.add(e.ship);
    for (const e of events) {
      if (e.type === 'sinking') {
        const s = b.get(e.ship);
        if (s && !leaders.has(s.id)) pushToast(t(s.team === team ? '아군 함선 침몰 · {name}' : '적 함선 침몰 · {name}', { name: tName(s.name) }), s.team === team ? 'bad' : 'good');
      } else if (e.type === 'struck') {
        const s = b.get(e.ship);
        if (s && !leaders.has(s.id)) pushToast(t(s.team === team ? '아군 함선 전투 불능 · {name}' : '적 함선 전투 불능 · {name}', { name: tName(s.name) }), s.team === team ? 'bad' : 'good');
      } else if (e.type === 'leader') {
        const s = b.get(e.ship);
        if (s) this.leaderLost(s, e.flagship);
      } else if (e.type === 'morale') {
        const s = b.get(e.ship);
        if (!s || !shipObserved(b, team, s)) continue;
        const own = s.team === team;
        if (e.state === 'routing') this.callout(own ? 'rout-own' : 'rout-foe');
        else if (e.state === 'rallying') this.callout(own ? 'rally-own' : 'rally-foe');
      } else if (e.type === 'drum') {
        const s = b.get(e.ship);
        if (s && s.team !== team && shipObserved(b, team, s)) this.callout('drum-foe');
      } else if (e.type === 'maneuver') {
        this.maneuverCallout(e.kind, e.phase, e.team === team, e.ship);
      } else if (e.type === 'signal') {
        const s = b.get(e.ship);
        if (s && s.team !== team && shipObserved(b, team, s)) pushToast(t(e.signal === 'advance' ? '적진에서 진군 북이 울립니다' : '적진에서 퇴각 징이 울립니다'), 'info');
      } else if (e.type === 'cutoff') {
        const s = b.get(e.ship);
        if (s && shipObserved(b, team, s)) this.callout(s.team === team ? 'cut-own' : 'cut-foe');
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
    this.flushCallouts();
  }

  /** The moments of a maneuver worth a word: an ambush springing, a pincer closing, the bait home, the enemy's own. */
  private maneuverCallout(kind: ManeuverKind, phase: ManeuverPhase, own: boolean, ship: number) {
    const b = this.engine.battle;
    const s = b.get(ship);
    if (!own) {
      if (!s || !shipObserved(b, this.engine.team, s) || phase !== 'striking') return;
      const foe: Partial<Record<ManeuverKind, string>> = { ambush: '적의 매복 · 어둠 속에서 포문이 열립니다', pincer: '적이 양쪽에서 조여 옵니다', breach: '적이 대열을 뚫고 들어옵니다', crane: '적이 학익진을 펼쳐 감싸 옵니다', encircle: '적이 포위망을 좁혀 옵니다' };
      if (foe[kind]) pushToast(t(foe[kind]!), 'bad');
      return;
    }
    const lines: Partial<Record<ManeuverKind, Partial<Record<ManeuverPhase, string>>>> = {
      ambush: { waiting: '매복 완료 · 등불을 끄고 숨죽여 기다립니다', striking: '매복 개시 · 일제히 포문을 엽니다' },
      pincer: { striking: '협공 개시 · 양쪽 날개가 조여 듭니다' },
      breach: { striking: '돌파 · 적진을 가르며 양현으로 쏩니다', done: '돌파 완료' },
      crane: { striking: '학익진이 적을 감싸며 좁혀 듭니다' },
      encircle: { striking: '포위망을 좁힙니다' },
      blockade: { waiting: '봉쇄선 완성 · 물목을 지나는 적을 칩니다' },
      lure: { striking: '미끼가 물러납니다 · 적을 끌어들입니다', done: '미끼 귀환 · 북을 울려 일제히 돌아섭니다' },
    };
    const text = lines[kind]?.[phase];
    if (text) pushToast(t(text), phase === 'striking' || phase === 'done' ? 'good' : 'info');
  }

  /** A squadron's leader or a navy's admiral is out of the fight: its ships lose heart (the battle depth rules). */
  private leaderLost(s: Ship, admiral: boolean) {
    const own = s.team === this.engine.team;
    const name = tName(s.name);
    if (admiral) {
      const text = own ? '아군 대장선 상실 · {name} · 함대의 사기가 크게 꺾입니다' : s.sinking > 0 ? '적 대장선 격침 · {name}' : s.fled ? '적 대장선 도주 · {name}' : '적 대장선 전투 불능 · {name}';
      pushToast(t(text, { name }), own ? 'bad' : 'good');
      return;
    }
    const sq = this.engine.battle.squadron(s.squadronId);
    const squadron = sq ? tName(sq.name) : name;
    pushToast(t(own ? '아군 {squadron} 지휘선 상실 · 부대가 흔들립니다' : '적 {squadron} 지휘선 상실', { squadron }), own ? 'bad' : 'good');
  }

  /** Counts a morale callout; ships that break or rally together are told as one line, at most every few seconds. */
  private callout(kind: string) {
    const c = this.callouts.get(kind) ?? { at: 0, n: 0 };
    c.n += 1;
    this.callouts.set(kind, c);
  }

  private flushCallouts() {
    const now = performance.now();
    for (const [kind, c] of this.callouts) {
      if (!c.n || now - c.at < CALLOUT_GAP) continue;
      const text = CALLOUTS[kind]!;
      pushToast(t(text.ko, { n: c.n }), text.tone);
      c.at = now;
      c.n = 0;
    }
  }
}
