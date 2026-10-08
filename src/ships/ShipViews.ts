import {
  Color,
  DynamicDrawUsage,
  Euler,
  Frustum,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  Quaternion,
  RingGeometry,
  Sphere,
  Vector3,
  type PerspectiveCamera,
} from 'three/webgpu';
import { float, length, sin, smoothstep, time, uniform, uv, vec4 } from 'three/tsl';
import type { Battle } from '../sim/battle';
import type { Ship, ShipKind, Team } from '../sim/types';
import { waveField } from '../ocean/waves';
import { modelKey, ShipRenderer, type ModelAsset } from './ShipRenderer';
import type { ShipLodQuality } from '../game/quality';

export type ViewState = {
  id: number;
  heave: number;
  pitch: number;
  roll: number;
  matrix: Matrix4;
  origin: Vector3;
  up: Vector3;
  flash: number;
  lod: number;
  visible: boolean;
  sampleTimer: number;
  key: string;
};

const MAX_RINGS = 256;

export class ShipViews {
  readonly group = new Group();
  readonly states = new Map<number, ViewState>();
  selected = new Set<number>();
  hovered = 0;
  /** The player's team. Its ships get the gold selection ring, the other team the red one. */
  team: Team = 'joseon';
  renderer: ShipRenderer;
  private readonly frustum = new Frustum();
  private readonly projScreen = new Matrix4();
  private readonly sphere = new Sphere();
  private readonly q = new Quaternion();
  private readonly e = new Euler(0, 0, 0, 'YZX');
  private readonly s1 = new Vector3(1, 1, 1);
  private readonly tmp = new Vector3();
  private readonly ringsOwn: InstancedMesh;
  private readonly ringsEnemy: InstancedMesh;
  private readonly ringMatrix = new Matrix4();
  private readonly dists: number[] = [];
  private readonly sFlag = new Vector3(1.12, 1.12, 1.12);
  private readonly need = new Map<string, number>();

  constructor(
    assets: Record<string, ModelAsset>,
    battle: Battle,
    private readonly lod: ShipLodQuality,
    hint: Map<ShipKind, number> = new Map(),
  ) {
    this.renderer = new ShipRenderer(assets, this.capacities(battle, assets, hint));
    this.group.add(this.renderer.group);
    const ringGeo = new RingGeometry(0.92, 1, 96, 1);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringsOwn = new InstancedMesh(ringGeo, this.makeRingMaterial(new Color(1.0, 0.72, 0.22)), MAX_RINGS);
    this.ringsEnemy = new InstancedMesh(ringGeo, this.makeRingMaterial(new Color(1.0, 0.25, 0.18)), MAX_RINGS);
    for (const r of [this.ringsOwn, this.ringsEnemy]) {
      r.instanceMatrix.setUsage(DynamicDrawUsage);
      r.count = 0;
      r.frustumCulled = false;
      r.renderOrder = 4;
      this.group.add(r);
    }
  }

  private capacities(battle: Battle, assets: Record<string, ModelAsset>, hint: Map<ShipKind, number>) {
    const caps = new Map<string, number>();
    for (const s of battle.ships) {
      const key = this.keyFor(s, assets);
      caps.set(key, (caps.get(key) ?? 0) + 1);
    }
    for (const [kind, n] of hint) {
      for (const key of Object.keys(assets)) if (assets[key]!.kind === kind) caps.set(key, Math.max(caps.get(key) ?? 0, n));
    }
    return caps;
  }

  private keyFor(s: Ship, assets: Record<string, ModelAsset>) {
    const key = modelKey(s.spec.kind, s.variant);
    return assets[key] ? key : modelKey(s.spec.kind, 0);
  }

  reset(assets: Record<string, ModelAsset>, battle: Battle, hint: Map<ShipKind, number> = new Map()) {
    this.group.remove(this.renderer.group);
    this.renderer = new ShipRenderer(assets, this.capacities(battle, assets, hint));
    this.group.add(this.renderer.group);
    this.states.clear();
    this.selected.clear();
    this.assets = assets;
  }

  assets: Record<string, ModelAsset> | null = null;

  private makeRingMaterial(color: Color) {
    const m = new MeshBasicNodeMaterial();
    const c = uniform(color);
    const r = length(uv().sub(0.5));
    const pulse = sin(time.mul(4)).mul(0.15).add(0.85);
    m.colorNode = vec4(c.mul(1.25), 1);
    m.opacityNode = float(0.85).mul(pulse).mul(smoothstep(0.0, 0.5, r).add(0.3));
    m.transparent = true;
    m.depthWrite = false;
    m.fog = false;
    return m;
  }

  sync(battle: Battle, dt: number, camera: PerspectiveCamera, assets: Record<string, ModelAsset>) {
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    this.need.clear();
    for (const ship of battle.ships) if (ship.alive) this.need.set(this.keyFor(ship, assets), (this.need.get(this.keyFor(ship, assets)) ?? 0) + 1);
    for (const [key, n] of this.need) this.renderer.ensure(key, n);
    this.renderer.begin();
    let own = 0;
    let enemy = 0;
    const cam = camera.position;
    const dists = this.dists;
    dists.length = 0;
    for (const ship of battle.ships) if (ship.alive) dists.push(Math.hypot(ship.x - cam.x, ship.z - cam.z, cam.y));
    let near = this.lod.near;
    if (dists.length > this.lod.maxLod0) {
      dists.sort((a, b) => a - b);
      near = Math.min(this.lod.near, dists[this.lod.maxLod0 - 1]! + 1);
    }
    for (const ship of battle.ships) {
      let v = this.states.get(ship.id);
      if (!ship.alive) {
        if (v) {
          this.states.delete(ship.id);
          this.selected.delete(ship.id);
        }
        continue;
      }
      if (!v) {
        v = {
          id: ship.id,
          heave: waveField.heightAt(ship.x, ship.z),
          pitch: 0,
          roll: 0,
          matrix: new Matrix4(),
          origin: new Vector3(),
          up: new Vector3(0, 1, 0),
          flash: 0,
          lod: 2,
          visible: true,
          sampleTimer: 0,
          key: this.keyFor(ship, assets),
        };
        this.states.set(ship.id, v);
      }
      const L = ship.spec.length;
      const dist = Math.hypot(ship.x - cam.x, ship.z - cam.z, cam.y);
      this.sphere.center.set(ship.x, ship.spec.height * 0.4, ship.z);
      this.sphere.radius = L * 0.6 + ship.spec.height * 0.5;
      v.visible = this.frustum.intersectsSphere(this.sphere);
      const mid = this.lod.mid;
      const lodTarget = dist < near ? 0 : dist < mid ? 1 : 2;
      if (lodTarget !== v.lod) {
        const edge = v.lod === 0 ? near * 1.04 : v.lod === 1 ? (lodTarget === 0 ? near * 0.96 : mid * 1.08) : mid * 0.92;
        if ((lodTarget > v.lod && dist > edge) || (lodTarget < v.lod && dist < edge)) v.lod = lodTarget;
      }
      this.updateTransform(ship, v, dt, dist);
      if (v.visible) this.renderer.add(v.key, v.lod, v.matrix, v.origin, v.up, Math.max(ship.burn, (1 - ship.hull / ship.spec.hull) * 0.45), v.flash);
      const show = (this.selected.has(ship.id) || this.hovered === ship.id) && ship.sinking === 0;
      if (show) {
        const ring = ship.team === this.team ? this.ringsOwn : this.ringsEnemy;
        const index = ship.team === this.team ? own++ : enemy++;
        if (index < MAX_RINGS) {
          const scale = L * 0.62;
          this.ringMatrix.makeScale(scale, scale, scale).setPosition(ship.x, v.heave + 0.35, ship.z);
          ring.setMatrixAt(index, this.ringMatrix);
        }
      }
    }
    this.renderer.end();
    this.ringsOwn.count = Math.min(own, MAX_RINGS);
    this.ringsEnemy.count = Math.min(enemy, MAX_RINGS);
    this.ringsOwn.instanceMatrix.needsUpdate = true;
    this.ringsEnemy.instanceMatrix.needsUpdate = true;
  }

  private updateTransform(s: Ship, v: ViewState, dt: number, dist: number) {
    const L = s.spec.length;
    const B = s.spec.beam;
    const c = Math.cos(s.heading);
    const n = Math.sin(s.heading);
    const t = waveField.time;
    v.sampleTimer -= dt;
    const near = dist < 700 && v.visible;
    if (near || v.sampleTimer <= 0) {
      v.sampleTimer = near ? 0 : dist < 1800 ? 0.1 : 0.25;
      const minLambda = dist < 400 ? 0 : dist < 1500 ? 10 : 25;
      if (dist < 1500) {
        const hb = waveField.heightAt(s.x + c * L * 0.38, s.z + n * L * 0.38, t, minLambda);
        const hs = waveField.heightAt(s.x - c * L * 0.38, s.z - n * L * 0.38, t, minLambda);
        const hp = waveField.heightAt(s.x + n * B * 0.45, s.z - c * B * 0.45, t, minLambda);
        const hq = waveField.heightAt(s.x - n * B * 0.45, s.z + c * B * 0.45, t, minLambda);
        const targetHeave = (hb + hs + hp + hq) / 4;
        const targetPitch = Math.atan2(hb - hs, L * 0.76);
        const targetRoll = Math.atan2(hp - hq, B * 0.9) * 0.9 - s.turn * s.speed * 0.06;
        const inertia = 0.18 + L * 0.012;
        const k = 1 - Math.exp(-Math.max(dt, 0.016) / inertia);
        v.heave += (targetHeave - v.heave) * k;
        v.pitch += (targetPitch - v.pitch) * k;
        v.roll += (targetRoll - v.roll) * k * 0.8;
      } else {
        v.heave += (waveField.heightAt(s.x, s.z, t, minLambda) - v.heave) * 0.3;
      }
    }
    let heave = v.heave;
    let pitch = v.pitch - s.speed * 0.004;
    let roll = v.roll;
    if (s.sinking > 0) {
      const p = s.sinking;
      const e = p * p * (3 - 2 * p);
      heave -= Math.pow(p, 1.6) * (s.spec.height + 8);
      roll += s.sinkRoll * e;
      pitch += s.sinkPitch * e;
    } else if (s.struck) {
      roll += 0.06;
    }
    this.e.set(roll, -s.heading, pitch, 'YZX');
    this.q.setFromEuler(this.e);
    this.tmp.set(s.x, heave, s.z);
    v.matrix.compose(this.tmp, this.q, s.flagship ? this.sFlag : this.s1);
    v.origin.copy(this.tmp);
    v.up.set(0, 1, 0).applyQuaternion(this.q);
    v.flash = Math.max(0, v.flash - dt * 4);
  }

  localToWorld(id: number, x: number, y: number, z: number, out: Vector3) {
    const v = this.states.get(id);
    if (!v) return out.set(x, y, z);
    return out.set(x, y, z).applyMatrix4(v.matrix);
  }

  flash(id: number) {
    const v = this.states.get(id);
    if (v) v.flash = 0.6;
  }

  worldOf(id: number) {
    const v = this.states.get(id);
    return v ? this.tmp.setFromMatrixPosition(v.matrix) : null;
  }

  heaveOf(id: number) {
    return this.states.get(id)?.heave ?? 0;
  }
}
