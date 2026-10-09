import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  MeshStandardNodeMaterial,
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
import { LOD_COUNT, modelKey, ShipRenderer, type ModelAsset } from './ShipRenderer';
import type { ShipLodQuality } from '../game/quality';
import { cutHeight, DECKS, mainDeck } from './decks';

const MAX_PROPS = 600;

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

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
  /** The distances of the nearest ships to the camera, ascending. */
  private readonly nearest: Float64Array;
  private readonly sFlag = new Vector3(1.12, 1.12, 1.12);
  private readonly need = new Map<string, number>();
  /** Ships drawn in cutaway, by level (1 roofs off, 2 walls off, 3 down to the rowers' deck). */
  cutaway = new Map<number, number>();
  /** Timber of the decks a cutaway opens up: the rowers' floor, oar looms and posts. */
  private readonly props: InstancedMesh;
  private readonly propMatrix = new Matrix4();
  private readonly propPos = new Vector3();
  private readonly propScale = new Vector3();
  private readonly propQ = new Quaternion();
  private readonly shipQ = new Quaternion();
  private readonly partQ = new Quaternion();
  private readonly partE = new Euler();

  constructor(
    assets: Record<string, ModelAsset>,
    battle: Battle,
    private readonly lod: ShipLodQuality,
    hint: Map<ShipKind, number> = new Map(),
  ) {
    this.nearest = new Float64Array(Math.max(1, lod.maxLod0));
    this.renderer = new ShipRenderer(assets, this.capacities(battle, assets, hint));
    this.group.add(this.renderer.group);
    const ringGeo = new RingGeometry(0.92, 1, 96, 1);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringsOwn = new InstancedMesh(ringGeo, this.makeRingMaterial(new Color(1.0, 0.72, 0.22)), MAX_RINGS);
    this.ringsEnemy = new InstancedMesh(ringGeo, this.makeRingMaterial(new Color(1.0, 0.25, 0.18)), MAX_RINGS);
    const wood = new MeshStandardNodeMaterial({ color: new Color(0.34, 0.24, 0.15), roughness: 0.9 });
    this.props = new InstancedMesh(new BoxGeometry(1, 1, 1), wood, MAX_PROPS);
    this.props.instanceMatrix.setUsage(DynamicDrawUsage);
    this.props.count = 0;
    this.props.frustumCulled = false;
    this.props.castShadow = true;
    this.props.receiveShadow = true;
    this.group.add(this.props);
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
    this.renderer.dispose();
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
    for (const ship of battle.ships) {
      if (!ship.alive) continue;
      const key = this.states.get(ship.id)?.key ?? this.keyFor(ship, assets);
      this.need.set(key, (this.need.get(key) ?? 0) + 1);
    }
    for (const [key, n] of this.need) this.renderer.ensure(key, n);
    this.renderer.begin();
    let props = 0;
    let own = 0;
    let enemy = 0;
    const cam = camera.position;
    // Only so many ships get the full model: the near limit is pulled in to the distance of the last one that may have it.
    const keep = this.lod.maxLod0;
    const nearest = this.nearest;
    let found = 0;
    let alive = 0;
    for (const ship of battle.ships) {
      if (!ship.alive) continue;
      alive += 1;
      const dx = ship.x - cam.x;
      const dz = ship.z - cam.z;
      const d = Math.sqrt(dx * dx + dz * dz + cam.y * cam.y);
      if (found === keep && d >= nearest[keep - 1]!) continue;
      let k = found < keep ? found++ : keep - 1;
      while (k > 0 && nearest[k - 1]! > d) {
        nearest[k] = nearest[k - 1]!;
        k -= 1;
      }
      nearest[k] = d;
    }
    let near = this.lod.near;
    if (alive > keep) near = Math.min(near, nearest[keep - 1]! + 1);
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
      const ddx = ship.x - cam.x;
      const ddz = ship.z - cam.z;
      const dist = Math.sqrt(ddx * ddx + ddz * ddz + cam.y * cam.y);
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
      const level = this.cutaway.get(ship.id) ?? 0;
      const main = level ? mainDeck(v.key, ship.spec.kind, ship.spec.deck) : 0;
      const cut = level ? cutHeight(level, main, DECKS[ship.spec.kind]) : undefined;
      // A model loaded without its near level has fewer levels: the nearest one it has serves the closer ranges.
      const have = assets[v.key]?.lods.length ?? LOD_COUNT;
      if (v.visible) this.renderer.add(v.key, cut === undefined ? Math.max(0, v.lod - (LOD_COUNT - have)) : 0, v.matrix, v.origin, v.up, Math.max(ship.burn, (1 - ship.hull / ship.spec.hull) * 0.45), v.flash, cut);
      if (level === 3 && v.visible) props = this.interior(ship, v, main, props);
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
    this.props.count = props;
    this.props.instanceMatrix.needsUpdate = true;
    this.ringsOwn.count = Math.min(own, MAX_RINGS);
    this.ringsEnemy.count = Math.min(enemy, MAX_RINGS);
    this.ringsOwn.instanceMatrix.needsUpdate = true;
    this.ringsEnemy.instanceMatrix.needsUpdate = true;
  }

  /** One timber piece in ship space: centre, size, and an optional roll about the ship's length. */
  private prop(v: ViewState, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, roll = 0) {
    if (i >= MAX_PROPS) return i;
    this.propPos.set(x, y, z).applyMatrix4(v.matrix);
    this.partE.set(roll, 0, 0);
    this.partQ.setFromEuler(this.partE);
    this.propQ.multiplyQuaternions(this.shipQ, this.partQ);
    this.propScale.set(sx, sy, sz);
    this.propMatrix.compose(this.propPos, this.propQ, this.propScale);
    this.props.setMatrixAt(i, this.propMatrix);
    return i + 1;
  }

  /** The rowers' deck under a cut-away main deck: floor, posts holding up the deck above, and the oar looms. */
  private interior(s: Ship, v: ViewState, main: number, i: number) {
    const plan = DECKS[s.spec.kind];
    if (plan.oarDrop <= 0) return i;
    const L = s.spec.length;
    const B = s.spec.beam;
    const floor = main - plan.oarDrop;
    this.tmp.setFromMatrixPosition(v.matrix);
    v.matrix.decompose(this.tmp, this.shipQ, this.propScale);
    i = this.prop(v, i, -0.02 * L, floor - 0.15, 0, L * 0.8, 0.3, B * 0.74);
    for (const x of [-0.3, -0.1, 0.1, 0.3]) for (const z of [-0.18, 0.18]) i = this.prop(v, i, x * L, floor + plan.oarDrop * 0.45 - 0.2, z * B, 0.35, plan.oarDrop * 0.9 - 0.4, 0.35);
    const per = plan.oars;
    for (let k = 0; k < per; k += 1) {
      const x = (-0.36 + (0.7 * (k + 0.5)) / per) * L;
      for (const side of [1, -1]) {
        // A loom from the rower out through the oar port, dipping toward the water.
        const len = B * 0.34 + 3;
        i = this.prop(v, i, x, floor + 1.05, side * (B * 0.31 + len * 0.42), 0.14, 0.14, len, side * 0.22);
      }
    }
    return i;
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
    let yaw = 0;
    if (s.sinking > 0) {
      // Driven only by the progress 0..1, so it plays the same whatever the sinking lasts. The hull lists over to
      // 50-70 degrees with a settling wobble, then the bow or the stern lifts and it slides under, turning a little.
      const p = s.sinking;
      const heelDir = Math.sign(s.sinkRoll) || 1;
      const heel = heelDir * Math.min(1.22, 0.85 + Math.abs(s.sinkRoll) * 0.45);
      const lean = (s.sinkPitch >= 0 ? 1 : -1) * Math.min(0.95, 0.55 + Math.abs(s.sinkPitch) * 1.6);
      const shudder = Math.sin(t * 8.3 + s.id * 1.7) * 0.012 * smooth(0, 0.06, p) * (1 - smooth(0.4, 0.9, p));
      roll += heel * smooth(0, 0.3, p) + Math.sin(p * 38) * 0.05 * Math.exp(-p * 9) * heelDir + shudder;
      pitch += lean * smooth(0.22, 0.8, p) + shudder * 0.6;
      yaw = (s.id % 2 === 0 ? 1 : -1) * 0.4 * Math.pow(p, 1.2);
      // Deep enough that the highest point of the tilted hull is under water when the progress reaches 1.
      const depth = 0.5 * L * Math.abs(Math.sin(lean)) + s.spec.height * 0.6 + B * 0.5 * Math.abs(Math.sin(heel)) + 4;
      heave -= depth * (0.08 * smooth(0, 0.3, p) + 0.27 * smooth(0.2, 0.72, p) + 0.65 * Math.pow(smooth(0.62, 1, p), 1.4));
    } else if (s.struck) {
      roll += 0.06;
    }
    this.e.set(roll, -s.heading + yaw, pitch, 'YZX');
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
