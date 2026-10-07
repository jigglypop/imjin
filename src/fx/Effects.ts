import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
  PointLight,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Camera,
} from 'three/webgpu';
import type { Battle } from '../sim/battle';
import type { BattleEvent } from '../sim/types';
import type { ShipViews } from '../ships/ShipViews';
import { waveField } from '../ocean/waves';
import { ParticleLayer } from './ParticleLayer';
import type { WakeMap } from '../ocean/WakeMap';
import { pointLights } from '../render/lights';

const MAX_DEBRIS = 400;
const MAX_BALLS = 600;
export const LIGHTS = 8;
const OARS: Record<string, number> = { panokseon: 8, geobukseon: 8, atakebune: 13, sekibune: 11 };

type Debris = { x: number; y: number; z: number; vx: number; vy: number; vz: number; rx: number; ry: number; rz: number; wx: number; wy: number; wz: number; s: number; age: number; life: number; floating: boolean };
type LightSource = { x: number; y: number; z: number; intensity: number; decay: number; r: number; g: number; b: number; age: number; life: number; dist: number };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Effects {
  readonly group = new Group();
  readonly smoke = new ParticleLayer('smoke', 9000);
  readonly fire = new ParticleLayer('fire', 6000);
  readonly spray = new ParticleLayer('spray', 5000);
  private readonly debrisMesh: InstancedMesh;
  private readonly debris: Debris[] = [];
  private readonly balls: InstancedMesh;
  private readonly lights: PointLight[] = [];
  private readonly sources: LightSource[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private readonly p = new Vector3();
  private emitAccum = new Map<number, number>();
  private strokes = new Map<number, number>();
  wake: WakeMap | null = null;
  readonly lightPos = pointLights.pos;
  readonly lightCol = pointLights.col;
  windX = 2.4;
  windZ = 1.6;
  night = 0;

  constructor(private readonly views: ShipViews) {
    const wood = new MeshStandardNodeMaterial({ color: new Color(0.23, 0.15, 0.09), roughness: 0.9, metalness: 0 });
    this.debrisMesh = new InstancedMesh(new BoxGeometry(1, 0.25, 0.35), wood, MAX_DEBRIS);
    this.debrisMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.debrisMesh.count = 0;
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.castShadow = false;
    const iron = new MeshStandardNodeMaterial({ color: new Color(0.03, 0.03, 0.03), roughness: 0.4, metalness: 0.8 });
    this.balls = new InstancedMesh(new SphereGeometry(0.22, 10, 8), iron, MAX_BALLS);
    this.balls.instanceMatrix.setUsage(DynamicDrawUsage);
    this.balls.count = 0;
    this.balls.frustumCulled = false;
    for (let i = 0; i < LIGHTS; i += 1) {
      const l = new PointLight(0xffaa55, 0, 160, 1.6);
      l.castShadow = false;
      this.lights.push(l);
      this.group.add(l);
    }
    this.group.add(this.smoke.sprite, this.fire.sprite, this.spray.sprite, this.debrisMesh, this.balls);
  }

  private light(x: number, y: number, z: number, intensity: number, life: number, r = 1, g = 0.62, b = 0.3, dist = 140) {
    this.sources.push({ x, y, z, intensity, decay: 1, r, g, b, age: 0, life, dist });
  }

  handle(events: BattleEvent[], battle: Battle) {
    for (const e of events) {
      switch (e.type) {
        case 'gun':
          this.gun(e.x, e.y, e.z, e.dx, e.dy, e.dz, e.big);
          break;
        case 'musket':
          this.musket(e.ship, e.dx, e.dz, e.count, battle);
          break;
        case 'hit':
          this.hit(e.x, e.y, e.z, e.damage);
          this.views.flash(e.ship);
          break;
        case 'splash':
          this.splash(e.x, e.z, e.size);
          break;
        case 'explode':
          this.explode(e.ship, battle);
          break;
        case 'ram':
          this.ram(e.x, e.z, e.power);
          break;
        case 'sinking':
          this.sinkingBurst(e.ship, battle);
          break;
        default:
          break;
      }
    }
  }

  gun(x: number, y: number, z: number, dx: number, dy: number, dz: number, big: boolean) {
    const scale = big ? 1 : 0.6;
    this.fire.emit({ x: x + dx * 1.2, y: y + dy, z: z + dz * 1.2, vx: dx * 30, vy: dy * 30, vz: dz * 30, life: 0.09, size0: 3.5 * scale, size1: 6 * scale, alpha: 1, heat: 1, drag: 8, wind: 0 });
    for (let i = 0; i < 5; i += 1) {
      const sp = rnd(10, 50);
      this.fire.emit({ x, y, z, vx: dx * sp + rnd(-4, 4), vy: dy * sp + rnd(-2, 4), vz: dz * sp + rnd(-4, 4), life: rnd(0.06, 0.16), size0: 1.6 * scale, size1: 2.6 * scale, heat: 0.8, drag: 6, wind: 0 });
    }
    const puffs = big ? 14 : 8;
    for (let i = 0; i < puffs; i += 1) {
      const sp = rnd(4, 26) * scale;
      const gray = rnd(0.78, 0.92);
      this.smoke.emit({
        x: x + dx * rnd(0.5, 3),
        y: y + rnd(-0.3, 0.6),
        z: z + dz * rnd(0.5, 3),
        vx: dx * sp + rnd(-1.5, 1.5),
        vy: dy * sp + rnd(0, 1.5),
        vz: dz * sp + rnd(-1.5, 1.5),
        life: rnd(9, 18),
        size0: rnd(1.5, 3) * scale,
        size1: rnd(11, 19) * scale,
        alpha: rnd(0.55, 0.8),
        r: gray,
        g: gray,
        b: gray * 0.98,
        drag: 1.1,
        lift: 0.22,
        wind: 1,
        heat: i < 3 ? 0.6 : 0,
      });
    }
    this.light(x + dx * 3, y + 1, z + dz * 3, big ? 9000 : 4000, 0.16, 1, 0.7, 0.4, 120);
  }

  musket(id: number, dx: number, dz: number, count: number, battle: Battle) {
    const ship = battle.get(id);
    if (!ship) return;
    const L = ship.spec.length;
    const side = (-dx * Math.sin(ship.heading) + dz * Math.cos(ship.heading)) > 0 ? 1 : -1;
    for (let i = 0; i < count; i += 1) {
      const along = rnd(-0.4, 0.4) * L;
      this.views.localToWorld(id, along, ship.spec.deck + rnd(0.6, 1.6), side * ship.spec.beam * 0.5, this.p);
      const delay = rnd(0, 0.5);
      this.fire.emit({ x: this.p.x, y: this.p.y, z: this.p.z, vx: dx * 12, vy: 0, vz: dz * 12, life: 0.05 + delay * 0.1, size0: 0.9, size1: 1.4, heat: 1, drag: 10, wind: 0 });
      this.smoke.emit({ x: this.p.x, y: this.p.y, z: this.p.z, vx: dx * rnd(3, 9), vy: rnd(0, 1), vz: dz * rnd(3, 9), life: rnd(4, 8), size0: 0.5, size1: rnd(3.5, 6), alpha: 0.55, r: 0.86, g: 0.86, b: 0.84, drag: 1.4, lift: 0.18 });
    }
  }

  hit(x: number, y: number, z: number, damage: number) {
    const n = Math.round(5 + damage * 1.2);
    for (let i = 0; i < n; i += 1) {
      this.spawnDebris(x, y, z, rnd(-9, 9), rnd(3, 13), rnd(-9, 9), rnd(0.35, 1.3));
    }
    for (let i = 0; i < 5; i += 1) {
      this.smoke.emit({ x, y, z, vx: rnd(-4, 4), vy: rnd(1, 5), vz: rnd(-4, 4), life: rnd(3, 6), size0: 1, size1: rnd(5, 8), alpha: 0.5, r: 0.45, g: 0.38, b: 0.3, drag: 1.5, lift: 0.3 });
    }
    this.fire.emit({ x, y, z, life: 0.1, size0: 2.5, size1: 4, heat: 1, drag: 4, wind: 0 });
    this.light(x, y + 1, z, 2500, 0.12);
  }

  splash(x: number, z: number, size: number) {
    const h = waveField.heightAt(x, z);
    const n = Math.round(26 * size);
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      this.spray.emit({
        x: x + Math.cos(a) * r * 1.2,
        y: h + 0.2,
        z: z + Math.sin(a) * r * 1.2,
        vx: Math.cos(a) * rnd(0.5, 4) * size,
        vy: rnd(7, 19) * size * (1 - r * 0.5),
        vz: Math.sin(a) * rnd(0.5, 4) * size,
        life: rnd(1.1, 2.4),
        size0: rnd(0.8, 1.6) * size,
        size1: rnd(2.5, 5) * size,
        alpha: rnd(0.55, 0.85),
        r: 0.94,
        g: 0.97,
        b: 1,
        drag: 0.35,
        lift: -9.8,
        wind: 0.3,
      });
    }
    for (let i = 0; i < 6; i += 1) {
      this.spray.emit({ x: x + rnd(-1, 1), y: h + 0.3, z: z + rnd(-1, 1), vx: rnd(-1, 1), vy: rnd(0.2, 1.2), vz: rnd(-1, 1), life: rnd(2, 3.5), size0: 2, size1: rnd(5, 8) * size, alpha: 0.4, r: 0.9, g: 0.95, b: 0.97, drag: 1.2, lift: 0, wind: 0.4 });
    }
  }

  ram(x: number, z: number, power: number) {
    for (let i = 0; i < 24; i += 1) this.spawnDebris(x, 3, z, rnd(-8, 8), rnd(3, 11), rnd(-8, 8), rnd(0.5, 1.8));
    this.splash(x, z, 0.9 + Math.min(1, power * 0.15));
  }

  explode(id: number, battle: Battle) {
    const ship = battle.get(id);
    if (!ship) return;
    this.views.localToWorld(id, rnd(-0.2, 0.2) * ship.spec.length, ship.spec.deck, 0, this.p);
    const { x, y, z } = this.p;
    for (let i = 0; i < 90; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * 1.2;
      const sp = rnd(6, 30);
      this.fire.emit({ x, y, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 4, vz: Math.sin(a) * Math.cos(e) * sp, life: rnd(0.5, 1.4), size0: rnd(4, 8), size1: rnd(9, 16), heat: rnd(0.6, 1), drag: 2.5, lift: 3, wind: 0.2 });
    }
    for (let i = 0; i < 50; i += 1) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.emit({ x, y: y + rnd(0, 6), z, vx: Math.cos(a) * rnd(3, 14), vy: rnd(3, 16), vz: Math.sin(a) * rnd(3, 14), life: rnd(14, 28), size0: rnd(5, 9), size1: rnd(22, 38), alpha: 0.85, r: 0.16, g: 0.14, b: 0.13, drag: 0.9, lift: 0.5, heat: 0.8 });
    }
    for (let i = 0; i < 70; i += 1) this.spawnDebris(x, y + 2, z, rnd(-22, 22), rnd(8, 32), rnd(-22, 22), rnd(0.6, 2.6));
    this.light(x, y + 6, z, 220000, 1.4, 1, 0.55, 0.25, 600);
    this.splash(x + rnd(-10, 10), z + rnd(-10, 10), 1.6);
  }

  sinkingBurst(id: number, battle: Battle) {
    const ship = battle.get(id);
    if (!ship) return;
    for (let i = 0; i < 4; i += 1) {
      this.views.localToWorld(id, rnd(-0.4, 0.4) * ship.spec.length, 0, rnd(-0.5, 0.5) * ship.spec.beam, this.p);
      this.splash(this.p.x, this.p.z, 0.8);
    }
  }

  private spawnDebris(x: number, y: number, z: number, vx: number, vy: number, vz: number, s: number) {
    if (this.debris.length >= MAX_DEBRIS) this.debris.shift();
    this.debris.push({ x, y, z, vx, vy, vz, rx: rnd(0, 6), ry: rnd(0, 6), rz: rnd(0, 6), wx: rnd(-9, 9), wy: rnd(-9, 9), wz: rnd(-9, 9), s, age: 0, life: rnd(14, 26), floating: false });
  }

  private rowing(battle: Battle, dt: number) {
    for (const ship of battle.ships) {
      if (!ship.alive || ship.sinking > 0 || ship.struck) continue;
      const speed = Math.abs(ship.speed);
      const L = ship.spec.length;
      const B = ship.spec.beam;
      const c = Math.cos(ship.heading);
      const n = Math.sin(ship.heading);
      const f = speed / ship.spec.maxSpeed;
      if (f > 0.55 && Math.random() < dt * 5 * f) {
        const side = Math.random() < 0.5 ? 1 : -1;
        const bx = ship.x + c * L * 0.47 + n * B * 0.3 * side;
        const bz = ship.z + n * L * 0.47 - c * B * 0.3 * side;
        const h = waveField.heightAt(bx, bz);
        for (let i = 0; i < 5; i += 1) this.spray.emit({ x: bx, y: h + 0.3, z: bz, vx: c * speed * 0.6 + n * side * rnd(1.5, 4), vy: rnd(1.5, 4.5) * f, vz: n * speed * 0.6 - c * side * rnd(1.5, 4), life: rnd(0.6, 1.2), size0: 0.6, size1: rnd(1.6, 2.6), alpha: 0.6, r: 0.95, g: 0.97, b: 1, drag: 0.6, lift: -9.8, wind: 0.2 });
      }
      if (speed < 0.6 || ship.crew < ship.spec.crew * 0.2) continue;
      const period = L > 30 ? 2.8 : 2.2;
      let phase = (this.strokes.get(ship.id) ?? Math.random()) + dt / period;
      if (phase >= 1) {
        phase -= 1;
        const oars = OARS[ship.spec.kind] ?? 8;
        for (let i = 0; i < oars; i += 1) {
          const along = (-0.36 + (0.58 * i) / Math.max(1, oars - 1)) * L;
          for (const side of [1, -1]) {
            const out = B * 0.5 + 3.2;
            const ox = ship.x + c * along + n * out * side;
            const oz = ship.z + n * along - c * out * side;
            const h = waveField.heightAt(ox, oz, waveField.time, 6);
            this.spray.emit({ x: ox, y: h + 0.15, z: oz, vx: -c * rnd(0.5, 1.5), vy: rnd(1, 2.6), vz: -n * rnd(0.5, 1.5), life: rnd(0.45, 0.8), size0: 0.35, size1: rnd(0.9, 1.4), alpha: 0.55, r: 0.95, g: 0.97, b: 1, drag: 1, lift: -9.8, wind: 0.1 });
            this.wake?.stamp(ox, oz, ship.heading, 2.2, 0.35, 1.4, 0.4);
          }
        }
      }
      this.strokes.set(ship.id, phase);
    }
  }

  private continuous(battle: Battle, dt: number) {
    if (dt > 0) this.rowing(battle, dt);
    for (const ship of battle.ships) {
      if (!ship.alive) continue;
      const burning = ship.fire > 0.02 || (ship.sinking > 0 && ship.sinking < 0.85);
      if (!burning) continue;
      const level = Math.max(ship.fire, ship.sinking > 0 ? 0.35 : 0);
      const rate = 40 * level + 6;
      let acc = (this.emitAccum.get(ship.id) ?? 0) + rate * dt;
      const L = ship.spec.length;
      while (acc >= 1) {
        acc -= 1;
        const lx = rnd(-0.38, 0.38) * L;
        const lz = rnd(-0.4, 0.4) * ship.spec.beam;
        this.views.localToWorld(ship.id, lx, ship.spec.deck * rnd(0.7, 1.2), lz, this.p);
        const big = rnd(0.6, 1.4) * (0.6 + level);
        this.fire.emit({ x: this.p.x, y: this.p.y, z: this.p.z, vx: rnd(-0.6, 0.6), vy: rnd(1.5, 4), vz: rnd(-0.6, 0.6), life: rnd(0.7, 1.4), size0: 2.6 * big, size1: 4.2 * big, heat: rnd(0.5, 1), drag: 1.5, lift: 2.5, wind: 0.5, alpha: 0.8, rot: rnd(-0.15, 0.15), spin: 0.05 });
        if (Math.random() < 0.55) {
          this.smoke.emit({ x: this.p.x, y: this.p.y + 2, z: this.p.z, vx: rnd(-1, 1), vy: rnd(3, 6), vz: rnd(-1, 1), life: rnd(14, 26), size0: rnd(3, 5), size1: rnd(18, 30) * (0.6 + level * 0.6), alpha: 0.75, r: 0.12, g: 0.11, b: 0.1, drag: 0.6, lift: 0.6, wind: 1, heat: 0.35 });
        }
        if (Math.random() < 0.3) {
          this.fire.emit({ x: this.p.x, y: this.p.y + 1, z: this.p.z, vx: rnd(-2, 2), vy: rnd(5, 12), vz: rnd(-2, 2), life: rnd(1.2, 2.6), size0: 0.25, size1: 0.12, heat: 1, drag: 0.8, lift: 1, wind: 1.2 });
        }
      }
      this.emitAccum.set(ship.id, acc);
      if (level > 0.15) {
        this.views.localToWorld(ship.id, 0, ship.spec.deck + 3, 0, this.p);
        this.sources.push({ x: this.p.x, y: this.p.y, z: this.p.z, intensity: 5000 * level * (0.85 + Math.random() * 0.3), decay: 1, r: 1, g: 0.5, b: 0.2, age: 0, life: dt * 1.01, dist: 180 });
      }
      if (ship.sinking > 0 && Math.random() < dt * 6) {
        this.views.localToWorld(ship.id, rnd(-0.45, 0.45) * L, 0, rnd(-0.5, 0.5) * ship.spec.beam, this.p);
        const h = waveField.heightAt(this.p.x, this.p.z);
        for (let i = 0; i < 4; i += 1) this.spray.emit({ x: this.p.x + rnd(-1, 1), y: h + 0.2, z: this.p.z + rnd(-1, 1), vx: rnd(-0.6, 0.6), vy: rnd(0.5, 2.5), vz: rnd(-0.6, 0.6), life: rnd(1.5, 3), size0: 1.2, size1: 3.5, alpha: 0.45, r: 0.92, g: 0.96, b: 0.98, drag: 1, lift: -2 });
      }
    }
  }

  update(battle: Battle, dt: number, camera: Camera) {
    this.continuous(battle, dt);
    for (const p of battle.projectiles) {
      if (Math.random() < dt * 14) this.smoke.emit({ x: p.x, y: p.y, z: p.z, vx: 0, vy: 0.2, vz: 0, life: rnd(0.6, 1.4), size0: 0.35, size1: 1.6, alpha: 0.28, r: 0.88, g: 0.88, b: 0.88, drag: 2 });
    }
    this.smoke.update(dt, this.windX, this.windZ, camera);
    this.fire.update(dt, this.windX, this.windZ, camera);
    this.spray.update(dt, this.windX * 0.3, this.windZ * 0.3, camera);
    let n = 0;
    for (const p of battle.projectiles) {
      if (n >= MAX_BALLS) break;
      this.m.makeTranslation(p.x, p.y, p.z);
      this.balls.setMatrixAt(n++, this.m);
    }
    this.balls.count = n;
    this.balls.instanceMatrix.needsUpdate = true;
    const t = waveField.time;
    let k = 0;
    for (let i = this.debris.length - 1; i >= 0; i -= 1) {
      const d = this.debris[i]!;
      d.age += dt;
      if (d.age > d.life) {
        this.debris.splice(i, 1);
        continue;
      }
      if (!d.floating) {
        d.vy -= 9.81 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.z += d.vz * dt;
        d.rx += d.wx * dt;
        d.ry += d.wy * dt;
        d.rz += d.wz * dt;
        const h = waveField.heightAt(d.x, d.z, t, 6);
        if (d.y < h) {
          d.floating = true;
          if (d.s > 1) this.spray.emit({ x: d.x, y: h, z: d.z, vy: 3, life: 0.8, size0: 0.6, size1: 1.6, alpha: 0.5, r: 0.95, g: 0.97, b: 1, lift: -9.8 });
        }
      } else {
        d.x += this.windX * 0.05 * dt;
        d.z += this.windZ * 0.05 * dt;
        const h = waveField.heightAt(d.x, d.z, t, 6);
        const sink = Math.max(0, d.age - d.life * 0.6) * 0.15;
        d.y = h - 0.05 - sink;
        d.rx *= 0.98;
        d.rz *= 0.98;
      }
      this.q.setFromEuler(this.euler.set(d.rx, d.ry, d.rz));
      this.s.set(d.s, d.s, d.s);
      this.v.set(d.x, d.y, d.z);
      this.m.compose(this.v, this.q, this.s);
      this.debrisMesh.setMatrixAt(k++, this.m);
    }
    this.debrisMesh.count = k;
    this.debrisMesh.instanceMatrix.needsUpdate = true;
    this.updateLights(dt, camera);
  }

  private readonly euler = new Euler();

  private updateLights(dt: number, camera: Camera) {
    const cam = camera.position;
    for (let i = this.sources.length - 1; i >= 0; i -= 1) {
      const s = this.sources[i]!;
      s.age += dt;
      if (s.age > s.life) this.sources.splice(i, 1);
    }
    const ranked = this.sources
      .map((s) => ({ s, score: (s.intensity * (1 - s.age / s.life)) / (1 + (cam.distanceTo(this.v.set(s.x, s.y, s.z)) / 300) ** 2) }))
      .sort((a, b) => b.score - a.score);
    for (let i = 0; i < LIGHTS; i += 1) {
      const l = this.lights[i]!;
      const entry = ranked[i];
      if (!entry) {
        l.intensity = 0;
        this.lightPos[i]!.w = 0;
        continue;
      }
      const s = entry.s;
      const fade = 1 - s.age / s.life;
      l.position.set(s.x, s.y, s.z);
      l.color.setRGB(s.r, s.g, s.b);
      l.intensity = s.intensity * fade * (1 + this.night * 0.5);
      l.distance = s.dist;
      this.lightPos[i]!.set(s.x, s.y, s.z, l.intensity);
      this.lightCol[i]!.set(s.r, s.g, s.b, s.dist);
    }
  }
}
