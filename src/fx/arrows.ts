import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Group, InstancedMesh, Matrix4, MeshStandardNodeMaterial, Quaternion, Vector3 } from 'three/webgpu';
import { attribute } from 'three/tsl';
import type { ShipViews } from '../ships/ShipViews';
import { waveField } from '../ocean/waves';
import { equipment } from '../game/quality';
import { PUFF, type PuffField } from './puffs';

/** Arrows in the air and arrows standing in decks and hulls, by device tier. */
const FLYING = { high: 72, medium: 44, low: 22 }[equipment.tier];
const STUCK = { high: 240, medium: 120, low: 56 }[equipment.tier];
/** Seconds a stuck arrow stays before it is gone (the last second shrinks it away). */
const STAY = { high: 16, medium: 12, low: 8 }[equipment.tier];
const G = 9.81;
/** Arrows in the game are longer than a real arrow so they read from the battle camera: metres in flight and in the wood. */
const LEN_FLY = 2.1;
const LEN_STUCK = 1.45;
const THICK = 2.4;

type Arrow = {
  used: boolean;
  stuck: boolean;
  x0: number;
  y0: number;
  z0: number;
  /** Endpoint in the world for an arrow that falls in the sea; for a hit the point in the target's frame. */
  tx: number;
  ty: number;
  tz: number;
  tid: number;
  t: number;
  T: number;
  px: number;
  py: number;
  pz: number;
  dx: number;
  dy: number;
  dz: number;
  born: number;
  /** Rise of the arc over a straight line to the end, metres. */
  lift: number;
};

const Z_AXIS = new Vector3(0, 0, 1);

/**
 * One arrow in unit length along -z from its tip at the origin: a square shaft, an iron head and three feathers.
 * The instance matrix scales it, so the same mesh serves flight and rest.
 */
function arrowGeometry() {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], rgb: [number, number, number]) => {
    const base = pos.length / 3;
    for (const v of [a, b, c, d]) {
      pos.push(v[0]!, v[1]!, v[2]!);
      col.push(rgb[0], rgb[1], rgb[2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const tri = (a: number[], b: number[], c: number[], rgb: [number, number, number]) => {
    const base = pos.length / 3;
    for (const v of [a, b, c]) {
      pos.push(v[0]!, v[1]!, v[2]!);
      col.push(rgb[0], rgb[1], rgb[2]);
    }
    idx.push(base, base + 1, base + 2);
  };
  const wood: [number, number, number] = [0.3, 0.22, 0.14];
  const iron: [number, number, number] = [0.14, 0.14, 0.15];
  const feather: [number, number, number] = [0.6, 0.57, 0.5];
  const h = 0.018;
  // Shaft: four sides from just behind the head to the nock.
  const z0 = -0.07;
  const z1 = -1;
  const c: [number, number][] = [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ];
  for (let i = 0; i < 4; i += 1) {
    const a = c[i]!;
    const b = c[(i + 1) % 4]!;
    quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], wood);
  }
  // Head: a four-sided point.
  const hw = 0.04;
  const hc: [number, number][] = [
    [-hw, 0],
    [0, -hw],
    [hw, 0],
    [0, hw],
  ];
  for (let i = 0; i < 4; i += 1) {
    const a = hc[i]!;
    const b = hc[(i + 1) % 4]!;
    tri([a[0], a[1], z0 - 0.02], [b[0], b[1], z0 - 0.02], [0, 0, 0], iron);
  }
  // Feathers: three trapezoids at the tail, a hand's breadth long and swept forward.
  for (let k = 0; k < 3; k += 1) {
    const ang = (k / 3) * Math.PI * 2 + 0.5;
    const rx = Math.cos(ang);
    const ry = Math.sin(ang);
    quad([0, 0, -0.76], [0, 0, -0.99], [rx * 0.085, ry * 0.085, -1], [rx * 0.085, ry * 0.085, -0.82], feather);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Pooled arrows: bowmen's arrows fly in a high arc, then stand in the deck or hull they hit and ride with the ship
 * for a while, or fall into the sea with a splash. The end of the flight follows the target ship, so a hit lands where
 * the planks really are.
 */
export class ArrowField {
  readonly group = new Group();
  private readonly pool: Arrow[] = [];
  private readonly mesh: InstancedMesh;
  private time = 0;
  private flying = 0;
  private stuckCount = 0;
  private cursor = 0;
  private readonly p = new Vector3();
  private readonly d = new Vector3();
  private readonly sd = new Vector3();
  private readonly q = new Quaternion();
  private readonly inv = new Matrix4();

  constructor(
    private readonly views: ShipViews,
    private readonly puffs: PuffField,
  ) {
    for (let i = 0; i < FLYING + STUCK; i += 1) {
      this.pool.push({ used: false, stuck: false, x0: 0, y0: 0, z0: 0, tx: 0, ty: 0, tz: 0, tid: 0, t: 0, T: 1, px: 0, py: 0, pz: 0, dx: 0, dy: 0, dz: 1, born: 0, lift: 0 });
    }
    const mat = new MeshStandardNodeMaterial({ roughness: 0.85, side: DoubleSide });
    mat.colorNode = attribute('color', 'vec3');
    this.mesh = new InstancedMesh(arrowGeometry(), mat, FLYING + STUCK);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.group.add(this.mesh);
  }

  /**
   * Looses an arrow. `tid` names the ship it will strike, with the hit point (lx, ly, lz) in that ship's frame; with
   * no ship it falls into the sea at the world point (lx, ly, lz) instead.
   */
  launch(x: number, y: number, z: number, tid: number, lx: number, ly: number, lz: number, T: number) {
    if (this.flying >= FLYING) return;
    const n = this.pool.length;
    let a: Arrow | null = null;
    for (let i = 0; i < n; i += 1) {
      const o = this.pool[(this.cursor + i) % n]!;
      if (!o.used) {
        a = o;
        this.cursor = (this.cursor + i + 1) % n;
        break;
      }
    }
    // A full pool takes the oldest stuck arrow back.
    if (!a) {
      let old = Infinity;
      for (const o of this.pool) {
        if (o.stuck && o.born < old) {
          old = o.born;
          a = o;
        }
      }
      if (!a) return;
      this.stuckCount -= 1;
    }
    a.used = true;
    a.stuck = false;
    a.x0 = x;
    a.y0 = y;
    a.z0 = z;
    a.tid = tid;
    a.tx = lx;
    a.ty = ly;
    a.tz = lz;
    a.T = T;
    a.t = 0;
    a.px = x;
    a.py = y;
    a.pz = z;
    a.dx = 0;
    a.dy = 0;
    a.dz = 0;
    a.lift = 0.125 * G * T * T;
    this.flying += 1;
  }

  /** Where the end of the flight is in the world this frame. False when the ship it was aimed at is gone. */
  private endpoint(a: Arrow, out: Vector3) {
    if (!a.tid) {
      out.set(a.tx, a.ty, a.tz);
      return true;
    }
    if (!this.views.states.get(a.tid)) return false;
    this.views.localToWorld(a.tid, a.tx, a.ty, a.tz, out);
    return true;
  }

  /** Moves every arrow on and writes the instances. `cam` is the camera position, for the size an arrow needs to read. */
  update(dt: number, cam: Vector3) {
    this.time += dt;
    const m = this.mesh.instanceMatrix.array as Float32Array;
    let n = 0;
    for (const a of this.pool) {
      if (!a.used) continue;
      let sx: number;
      let sy: number;
      let sz: number;
      let len: number;
      if (!a.stuck) {
        a.t += dt;
        const s = Math.min(1, a.t / a.T);
        if (!this.endpoint(a, this.p)) {
          a.used = false;
          this.flying -= 1;
          continue;
        }
        const x = a.x0 + (this.p.x - a.x0) * s;
        const y = a.y0 + (this.p.y - a.y0) * s + a.lift * 4 * s * (1 - s);
        const z = a.z0 + (this.p.z - a.z0) * s;
        const mx = x - a.px;
        const my = y - a.py;
        const mz = z - a.pz;
        const ml = Math.hypot(mx, my, mz);
        if (ml > 1e-4) {
          a.dx = mx / ml;
          a.dy = my / ml;
          a.dz = mz / ml;
        } else if (a.dx === 0 && a.dy === 0 && a.dz === 0) {
          // First frame: along the chord, tilted up as a loosed arrow is.
          const cx = this.p.x - a.x0;
          const cz = this.p.z - a.z0;
          const ch = Math.hypot(cx, cz) || 1;
          a.dx = cx / ch;
          a.dy = 0.5;
          a.dz = cz / ch;
        }
        a.px = x;
        a.py = y;
        a.pz = z;
        if (s >= 1 && !a.tid) {
          this.flying -= 1;
          a.used = false;
          this.puffs.splash(x, waveField.heightAt(x, z, waveField.time, 8), z, 0.5);
          continue;
        }
        this.p.set(x, y, z);
        const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
        const grow = 1 + Math.min(1.4, Math.max(0, (d - 50) / 110));
        len = LEN_FLY * grow;
        sx = THICK * grow;
        sy = sx;
        sz = len;
        this.d.set(a.dx, a.dy, a.dz);
        // The last frame of the flight is drawn in the air; from the next the arrow stands in the wood.
        if (s >= 1) {
          this.flying -= 1;
          this.stick(a);
        }
      } else {
        const age = this.time - a.born;
        if (age > STAY || !this.endpoint(a, this.p)) {
          a.used = false;
          this.stuckCount -= 1;
          continue;
        }
        // The shaft stands out of the wood at the angle it arrived, which rides with the ship.
        const st = this.views.states.get(a.tid)!;
        this.d.set(a.dx, a.dy, a.dz).transformDirection(st.matrix);
        const d = Math.hypot(this.p.x - cam.x, this.p.y - cam.y, this.p.z - cam.z);
        const grow = 1 + Math.min(1.1, Math.max(0, (d - 50) / 130));
        const fade = Math.min(1, (STAY - age) / 1.2);
        len = LEN_STUCK * grow * fade;
        sx = THICK * grow * fade;
        sy = sx;
        sz = len;
        // The head is sunk in a little.
        this.p.addScaledVector(this.d, LEN_STUCK * 0.22);
      }
      this.q.setFromUnitVectors(Z_AXIS, this.d);
      const qx = this.q.x;
      const qy = this.q.y;
      const qz = this.q.z;
      const qw = this.q.w;
      const x2 = qx + qx;
      const y2 = qy + qy;
      const z2 = qz + qz;
      const xx = qx * x2;
      const xy = qx * y2;
      const xz = qx * z2;
      const yy = qy * y2;
      const yz = qy * z2;
      const zz = qz * z2;
      const wx = qw * x2;
      const wy = qw * y2;
      const wz = qw * z2;
      const o = n * 16;
      m[o] = (1 - (yy + zz)) * sx;
      m[o + 1] = (xy + wz) * sx;
      m[o + 2] = (xz - wy) * sx;
      m[o + 3] = 0;
      m[o + 4] = (xy - wz) * sy;
      m[o + 5] = (1 - (xx + zz)) * sy;
      m[o + 6] = (yz + wx) * sy;
      m[o + 7] = 0;
      m[o + 8] = (xz + wy) * sz;
      m[o + 9] = (yz - wx) * sz;
      m[o + 10] = (1 - (xx + yy)) * sz;
      m[o + 11] = 0;
      m[o + 12] = this.p.x;
      m[o + 13] = this.p.y;
      m[o + 14] = this.p.z;
      m[o + 15] = 1;
      n += 1;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** The arrow lands: it keeps the direction it came in with, in the ship's frame, and a little dust jumps from the wood. */
  private stick(a: Arrow) {
    const st = this.views.states.get(a.tid)!;
    this.inv.copy(st.matrix).invert();
    this.sd.set(a.dx, a.dy, a.dz).transformDirection(this.inv);
    a.dx = this.sd.x;
    a.dy = this.sd.y;
    a.dz = this.sd.z;
    a.stuck = true;
    a.born = this.time;
    this.stuckCount += 1;
    this.views.localToWorld(a.tid, a.tx, a.ty, a.tz, this.sd);
    if (this.puffs.room > 24) this.puffs.spawn(PUFF.dust, this.sd.x, this.sd.y + 0.1, this.sd.z, 0, 0.9, 0, 0.18, 0.7, 0.55, 0.78, 0.7, 0.55, 0.5, -0.1, 2);
  }

  get stuckArrows() {
    return this.stuckCount;
  }
}
