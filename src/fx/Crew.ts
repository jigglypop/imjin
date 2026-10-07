import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Camera,
} from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Battle } from '../sim/battle';
import type { BattleEvent, Ship, ShipKind } from '../sim/types';
import type { ShipViews } from '../ships/ShipViews';
import { waveField } from '../ocean/waves';

const CAPACITY = 5000;
const RANGE = 520;

const DECK: Record<ShipKind, { y: number; l: number; b: number; max: number }> = {
  panokseon: { y: 4.4, l: 0.66, b: 0.66, max: 46 },
  geobukseon: { y: 0, l: 0, b: 0, max: 0 },
  hyeopseon: { y: 0.9, l: 0.6, b: 0.5, max: 8 },
  atakebune: { y: 3.1, l: 0.6, b: 0.6, max: 42 },
  sekibune: { y: 1.5, l: 0.66, b: 0.55, max: 16 },
  kobaya: { y: 0.75, l: 0.62, b: 0.5, max: 8 },
  mingship: { y: 2.8, l: 0.6, b: 0.6, max: 28 },
  mingsmall: { y: 2.1, l: 0.6, b: 0.55, max: 10 },
};

const DECK_Y: Record<string, number> = { 'panokseon#0': 6.0, 'panokseon#1': 4.7, 'panokseon#2': 4.4, 'atakebune#0': 3.5, 'sekibune#0': 2.1, 'hyeopseon#0': 0.95, 'kobaya#0': 0.8, 'mingship#0': 4.2, 'mingsmall#0': 2.4 };

function part(geo: BufferGeometry, color: Color) {
  const g = geo.toNonIndexed();
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    c[i * 3] = color.r;
    c[i * 3 + 1] = color.g;
    c[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(c, 3));
  g.deleteAttribute('uv');
  return g;
}

function soldierGeometry(faction: 'joseon' | 'japan') {
  const skin = new Color(0.55, 0.38, 0.27);
  const cloth = faction === 'joseon' ? new Color(0.62, 0.6, 0.54) : new Color(0.2, 0.18, 0.22);
  const armor = faction === 'joseon' ? new Color(0.08, 0.1, 0.18) : new Color(0.1, 0.08, 0.07);
  const hatColor = faction === 'joseon' ? new Color(0.03, 0.03, 0.03) : new Color(0.42, 0.33, 0.18);
  const wood = new Color(0.25, 0.17, 0.1);
  const legs = new BoxGeometry(0.34, 0.82, 0.22);
  legs.translate(0, 0.41, 0);
  const torso = new BoxGeometry(0.46, 0.62, 0.3);
  torso.translate(0, 1.13, 0);
  const arms = new BoxGeometry(0.66, 0.16, 0.18);
  arms.translate(0, 1.32, 0.04);
  const head = new SphereGeometry(0.12, 7, 5);
  head.translate(0, 1.57, 0);
  const parts = [part(legs, cloth), part(torso, armor), part(arms, cloth), part(head, skin)];
  if (faction === 'joseon') {
    const brim = new CylinderGeometry(0.27, 0.27, 0.03, 10);
    brim.translate(0, 1.66, 0);
    const crown = new CylinderGeometry(0.09, 0.11, 0.14, 8);
    crown.translate(0, 1.74, 0);
    parts.push(part(brim, hatColor), part(crown, hatColor));
  } else {
    const jingasa = new ConeGeometry(0.3, 0.16, 10);
    jingasa.translate(0, 1.72, 0);
    parts.push(part(jingasa, hatColor));
  }
  const spear = new BoxGeometry(0.04, 2.4, 0.04);
  spear.translate(0.34, 1.25, 0.1);
  parts.push(part(spear, wood));
  return mergeGeometries(parts)!;
}

type Boarder = { from: number; to: number; t: number; dur: number; x0: number; y0: number; z0: number; team: 'joseon' | 'japan'; seed: number };
type Fallen = { x: number; y: number; z: number; vx: number; vy: number; vz: number; rx: number; rz: number; team: 'joseon' | 'japan'; age: number };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Crew {
  readonly group = new Group();
  private readonly meshes: Record<'joseon' | 'japan', InstancedMesh>;
  private readonly counts = { joseon: 0, japan: 0 };
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3(1.18, 1.18, 1.18);
  private readonly p = new Vector3();
  private readonly e = new Vector3();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly slots = new Map<number, Float32Array>();
  private readonly boarders: Boarder[] = [];
  private readonly fallen: Fallen[] = [];
  private time = 0;
  private boardTimer = new Map<string, number>();

  constructor(private readonly views: ShipViews) {
    const mat = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    this.meshes = {
      joseon: new InstancedMesh(soldierGeometry('joseon'), mat, CAPACITY),
      japan: new InstancedMesh(soldierGeometry('japan'), mat, CAPACITY),
    };
    for (const mesh of Object.values(this.meshes)) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      this.group.add(mesh);
    }
  }

  private deckY(ship: Ship) {
    const key = this.views.states.get(ship.id)?.key ?? '';
    return DECK_Y[key] ?? DECK[ship.spec.kind].y;
  }

  private slotsFor(ship: Ship) {
    let s = this.slots.get(ship.id);
    if (s) return s;
    const deck = DECK[ship.spec.kind];
    s = new Float32Array(deck.max * 3);
    let seed = ship.id * 9301 + 49297;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < deck.max; i += 1) {
      const rim = rand() < 0.65;
      const lx = (rand() - 0.5) * ship.spec.length * deck.l;
      const side = rand() < 0.5 ? -1 : 1;
      const lz = rim ? side * ship.spec.beam * deck.b * 0.5 * rnd(0.8, 1) : (rand() - 0.5) * ship.spec.beam * deck.b;
      s[i * 3] = lx;
      s[i * 3 + 1] = lz;
      s[i * 3 + 2] = rand() * Math.PI * 2;
    }
    this.slots.set(ship.id, s);
    return s;
  }

  private put(team: 'joseon' | 'japan', x: number, y: number, z: number, yaw: number, lean: number, roll = 0) {
    const mesh = this.meshes[team];
    const i = this.counts[team];
    if (i >= CAPACITY) return;
    this.euler.set(lean, yaw, roll, 'YXZ');
    this.q.setFromEuler(this.euler);
    this.p.set(x, y, z);
    this.m.compose(this.p, this.q, this.s);
    mesh.setMatrixAt(i, this.m);
    this.counts[team] = i + 1;
  }

  handle(events: BattleEvent[], battle: Battle) {
    for (const e of events) {
      if (e.type !== 'casualty') continue;
      const ship = battle.get(e.ship);
      if (!ship || !this.views.states.get(ship.id)?.visible) continue;
      const deck = DECK[ship.spec.kind];
      if (!deck.max) continue;
      const n = Math.min(4, e.count);
      for (let k = 0; k < n; k += 1) {
        const lx = rnd(-0.4, 0.4) * ship.spec.length * deck.l;
        const side = Math.random() < 0.5 ? -1 : 1;
        this.views.localToWorld(ship.id, lx, this.deckY(ship), side * ship.spec.beam * 0.45, this.p);
        const c = Math.cos(ship.heading);
        const sn = Math.sin(ship.heading);
        const ox = sn * side;
        const oz = -c * side;
        this.fallen.push({ x: this.p.x, y: this.p.y, z: this.p.z, vx: ox * rnd(1, 3.5), vy: rnd(1.5, 4), vz: oz * rnd(1, 3.5), rx: 0, rz: 0, team: ship.team, age: 0 });
      }
    }
    if (this.fallen.length > 400) this.fallen.splice(0, this.fallen.length - 400);
  }

  update(battle: Battle, dt: number, camera: Camera) {
    this.time += dt;
    this.counts.joseon = 0;
    this.counts.japan = 0;
    const cam = camera.position;
    const grappling = new Map<number, Ship>();
    for (const s of battle.ships) if (s.alive && s.grappledWith) grappling.set(s.id, battle.get(s.grappledWith)!);
    for (const ship of battle.ships) {
      if (!ship.alive || ship.sinking > 0.4) continue;
      const v = this.views.states.get(ship.id);
      if (!v || !v.visible) continue;
      const deck = DECK[ship.spec.kind];
      if (!deck.max) continue;
      const dist = Math.hypot(ship.x - cam.x, ship.z - cam.z);
      if (dist > RANGE) continue;
      const alive = Math.min(deck.max, Math.ceil((ship.crew / ship.spec.crew) * deck.max));
      const slots = this.slotsFor(ship);
      const foe = grappling.get(ship.id) ?? battle.ships.find((o) => o.grappledWith === ship.id);
      let fx = 0;
      let fz = 0;
      if (foe) {
        const c = Math.cos(ship.heading);
        const sn = Math.sin(ship.heading);
        const dx = foe.x - ship.x;
        const dz = foe.z - ship.z;
        fx = dx * c + dz * sn;
        fz = -dx * sn + dz * c;
        const len = Math.hypot(fx, fz) || 1;
        fx /= len;
        fz /= len;
      }
      for (let i = 0; i < alive; i += 1) {
        let lx = slots[i * 3]!;
        let lz = slots[i * 3 + 1]!;
        let yaw = slots[i * 3 + 2]!;
        let lean = Math.sin(this.time * 1.3 + i) * 0.03;
        if (foe && i % 3 !== 2) {
          const pull = 0.55;
          lx = lx * (1 - pull) + fx * ship.spec.length * 0.12 * pull;
          lz = lz * (1 - pull) + Math.sign(fz || 1) * ship.spec.beam * 0.4 * pull;
          yaw = Math.atan2(fx, fz);
          lean = Math.sin(this.time * 9 + i * 1.7) * 0.35;
        } else if (ship.targetId && battle.isActive(battle.get(ship.targetId))) {
          yaw = Math.atan2(lz >= 0 ? 0.2 : -0.2, lz >= 0 ? 1 : -1);
        }
        this.views.localToWorld(ship.id, lx, this.deckY(ship), lz, this.p);
        this.put(ship.team, this.p.x, this.p.y, this.p.z, -ship.heading + yaw, lean);
      }
      if (foe && ship.grappledWith === foe.id && dist < RANGE) {
        const key = `${ship.id}-${foe.id}`;
        const timer = (this.boardTimer.get(key) ?? 0) - dt;
        if (timer <= 0 && this.boarders.length < 300) {
          this.views.localToWorld(ship.id, fx * ship.spec.length * 0.15, this.deckY(ship), Math.sign(fz || 1) * ship.spec.beam * 0.45, this.p);
          this.boarders.push({ from: ship.id, to: foe.id, t: 0, dur: rnd(0.9, 1.5), x0: this.p.x, y0: this.p.y, z0: this.p.z, team: ship.team, seed: Math.random() });
          this.boardTimer.set(key, rnd(0.25, 0.6));
        } else this.boardTimer.set(key, timer);
      }
    }
    for (let i = this.boarders.length - 1; i >= 0; i -= 1) {
      const b = this.boarders[i]!;
      b.t += dt;
      const to = battle.get(b.to);
      if (!to || !to.alive || b.t > b.dur) {
        this.boarders.splice(i, 1);
        continue;
      }
      this.views.localToWorld(to.id, (b.seed - 0.5) * to.spec.length * 0.3, this.deckY(to), 0, this.e);
      const k = b.t / b.dur;
      const x = b.x0 + (this.e.x - b.x0) * k;
      const z = b.z0 + (this.e.z - b.z0) * k;
      const y = b.y0 + (this.e.y - b.y0) * k + Math.sin(k * Math.PI) * 2.2;
      this.put(b.team, x, y, z, Math.atan2(this.e.x - b.x0, this.e.z - b.z0), -0.4);
    }
    const t = waveField.time;
    for (let i = this.fallen.length - 1; i >= 0; i -= 1) {
      const f = this.fallen[i]!;
      f.age += dt;
      const h = waveField.heightAt(f.x, f.z, t, 8);
      if (f.y > h - 0.2) {
        f.vy -= 9.81 * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.z += f.vz * dt;
        f.rx += dt * 3.2;
      } else {
        f.y = h - 0.9 - Math.max(0, f.age - 4) * 0.3;
        f.rx = 1.45;
      }
      if (f.age > 12) {
        this.fallen.splice(i, 1);
        continue;
      }
      this.put(f.team, f.x, f.y, f.z, 0, f.rx, 0.3);
    }
    for (const team of ['joseon', 'japan'] as const) {
      const mesh = this.meshes[team];
      mesh.count = this.counts[team];
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
