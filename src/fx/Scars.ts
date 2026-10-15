import { Group, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardNodeMaterial, PlaneGeometry, DynamicDrawUsage, Vector3 } from 'three/webgpu';
import { abs, float, floor, fract, Fn, If, instancedBufferAttribute, length, max, min, mix, select, sin, smoothstep, texture, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { Battle } from '../sim/battle';
import type { AmmoType, GunType, Ship } from '../sim/types';
import type { ShipViews } from '../ships/ShipViews';
import { boardAt, Part, sailPoint, strike, surfaceFor, type PartId, type ShipSurface, type Strike } from '../ships/surface';
import { equipment } from '../game/quality';
import { particleNoise } from './particleNoise';
import { outcome, payload, planking, type Outcome } from './ordnance';
import { arrowForm, ARROW_GIRTH, ARROW_LEN, EMBEDDED, type Munitions } from './Projectiles';
import type { ParticleLayer } from './ParticleLayer';

/**
 * What a fight leaves on the ships and keeps there until they sink: shot holes and splintered plank scars where the
 * shot met the planks, great arrows standing in the planking at the angle they struck, spent fire arrows smouldering
 * in hulls and sails, iron balls lodged in the wood, pocked and knocked-out shield boards, scorch marks, and torn sails.
 * Each mark is kept in its ship's frame, put on the model's surface (src/ships/surface.ts) where the shell's line meets
 * it, so it rides the hull through its roll, its list and its sinking. The decals are one instanced mesh; the arrows
 * and balls are drawn by the munition meshes (Projectiles.ts). Capped in all and per ship by device class, the oldest
 * and smallest mark of a ship giving way first.
 */

/** Decal kinds: the shader draws each from its kind and seed. */
export const Scar = { Hole: 0, Smash: 1, Gouge: 2, Pellets: 3, Chips: 4, Scorch: 5, BoardOut: 6 } as const;
export type ScarKind = (typeof Scar)[keyof typeof Scar];
/** Which mark gives way first when a ship is full: a pocked board before a shot hole, a hole before a breach. */
const PRIORITY: Record<ScarKind, number> = { 4: 0, 3: 1, 2: 1, 5: 2, 0: 3, 1: 4, 6: 5 };

/** Things left in the wood. */
export const Embed = { Heavy: 0, Hiya: 1, Rocket: 2, Ball: 3 } as const;
export type EmbedKind = (typeof Embed)[keyof typeof Embed];

const CAPS = {
  high: { decals: 512, perShip: 24 },
  medium: { decals: 256, perShip: 16 },
  // Phones: a few marks on the ships near the camera, no more.
  low: { decals: 64, perShip: 6 },
}[equipment.tier];
/** Past this the marks are under a pixel: not drawn. */
const DRAW_RANGE = 900;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** What a hit looked like, for the effects drawn with it. Reused: read it before the next hit. */
export type HitLook = {
  /** Whether the shell's line met the model: false leaves the effects at the sim's point and no mark. */
  ok: boolean;
  result: Outcome;
  part: PartId;
  /** The surface point and its outward normal, world. */
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  /** Across the hole or breach, metres; 0 for a mark that is not a hole. */
  size: number;
  /** Joules the shot carried. */
  energy: number;
};

/**
 * The decal material: a quad shaded by kind from the shared noise texture (src/fx/particleNoise.ts, sampled up front so
 * the branches hold no texture reads). The quad's x runs along the planks, so holes tear with the grain.
 */
function decalMaterial(data: InstancedBufferAttribute) {
  const m = new MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  m.transparent = true;
  m.depthWrite = false;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -4;
  const S: any = instancedBufferAttribute(data, 'vec4');
  const kind: any = floor(S.x);
  const amount: any = fract(S.x);
  const seed = S.y;
  const size: any = vec2(S.z, S.w);
  // Metres from the centre of the mark.
  const q: any = uv().sub(0.5).mul(size);
  const tex = particleNoise();
  const fine: any = texture(tex, q.mul(2.4).add(vec2(seed, seed.mul(1.7))));
  const grain: any = texture(tex, q.mul(vec2(1.1, 13)).add(vec2(seed.mul(0.37), seed)));
  const coarse: any = texture(tex, q.mul(0.8).add(vec2(seed.mul(2.3), seed.mul(0.61))));
  const hash = (a: any, b: any) => fract(sin(a.mul(12.9898).add(b.mul(78.233)).add(seed.mul(3.17))).mul(43758.5453));
  const dark = vec3(0.016, 0.013, 0.011);
  const torn = mix(vec3(0.3, 0.21, 0.13), vec3(0.6, 0.46, 0.3), grain.g);
  const soot = vec3(0.03, 0.027, 0.025);
  const shade = Fn(() => {
    const col = vec3(0).toVar();
    const a = float(0).toVar();
    If(kind.equal(Scar.Hole), () => {
      // A round hole a third of the quad across, longer along the grain, its edge torn ragged; pale splinters torn
      // out along the planks round it, and the powder's smudge (amount) on a shot hole.
      const D = min(size.x, size.y).div(3.2);
      const e = q.div(vec2(1.2, 0.85));
      const r = length(e).div(D.mul(0.5));
      const rr = r.add(fine.r.sub(0.5).mul(0.9));
      const core = float(1).sub(smoothstep(0.9, 1.0, rr));
      const reach = float(1).add(smoothstep(0.35, 0.75, grain.g).mul(1.1)).add(fine.g.mul(0.35));
      const splinter = float(1).sub(smoothstep(reach.sub(0.12), reach, rr));
      const smudge = float(1).sub(smoothstep(0.9, 2.7, r.add(coarse.b.sub(0.5).mul(0.9)))).mul(amount);
      col.assign(mix(mix(soot, torn, splinter), dark, core));
      a.assign(max(max(core, splinter), smudge.mul(0.7)));
    })
      .ElseIf(kind.equal(Scar.Smash), () => {
        // Planks broken out: each strake of the breach has its own gap, longest in the middle rows, with splintered
        // ends; the seams between the strakes cracked open round it.
        const ph = float(0.24);
        const row = floor(q.y.div(ph));
        const rel = q.y.div(size.y.mul(0.5));
        const lift = hash(row, float(1.3));
        const shift = hash(row, float(7.1)).sub(0.5).mul(0.22).mul(size.x);
        const gap = size.x.mul(0.42).mul(float(1).sub(rel.mul(rel)).max(0).pow(0.6)).mul(lift.mul(0.45).add(0.55));
        const end = abs(q.x.sub(shift)).sub(gap).sub(grain.r.sub(0.5).mul(0.2));
        const hole = float(1).sub(smoothstep(-0.02, 0.0, end)).mul(float(1).sub(smoothstep(0.86, 0.95, abs(rel))));
        const split = float(1).sub(smoothstep(0.0, fine.a.mul(0.12).add(0.06), end)).mul(smoothstep(0.35, 0.6, grain.g).add(0.25).min(1));
        const seamY = abs(fract(q.y.div(ph)).sub(0.5));
        const seam = smoothstep(0.44, 0.49, seamY).mul(float(1).sub(smoothstep(0.0, 0.5, end.div(size.x)))).mul(0.8);
        col.assign(mix(mix(soot, torn, split), dark, hole));
        a.assign(max(max(hole, split.mul(float(1).sub(smoothstep(0.86, 1.0, abs(rel))))), seam));
      })
      .ElseIf(kind.equal(Scar.Gouge), () => {
        // Torn grain where a shot glanced or an arrow split the face: pale, fibrous, a dark crease down the middle.
        const r = length(q.div(size.mul(0.5)));
        const body = float(1).sub(smoothstep(0.55, 1.0, r.add(grain.g.sub(0.5).mul(0.9))));
        const crease = float(1).sub(smoothstep(0.0, 0.22, abs(q.y).div(size.y.mul(0.5)))).mul(body);
        col.assign(mix(torn, dark, crease.mul(0.85)));
        a.assign(body);
      })
      .ElseIf(kind.lessThan(Scar.Scorch), () => {
        // A shield or plank wall peppered by a load of small shot: in cells of a hand's breadth, a hit in as many as
        // the density gives, each a dark hole through a thin board (Pellets) or a pale dent and a grey smear of lead
        // in a thick one (Chips); a faint scuff of splinters over the whole patch.
        const through = kind.equal(Scar.Pellets);
        const c = select3(through, 0.13, 0.17);
        const cell: any = floor(q.div(c));
        const f: any = fract(q.div(c)).sub(0.5);
        const on: any = select(hash(cell.x, cell.y).lessThan(amount), float(1), float(0));
        const o = vec2(hash(cell.x.add(3.1), cell.y), hash(cell.x, cell.y.add(5.7))).sub(0.5).mul(0.5);
        const d = length(f.sub(o)).mul(c);
        const hr = select3(through, 0.012, 0.008);
        const ragged = fine.r.sub(0.5).mul(0.006);
        const core = float(1).sub(smoothstep(hr.mul(0.85), hr, d.add(ragged))).mul(on);
        const ring = float(1).sub(smoothstep(hr.mul(1.6), hr.mul(2.6), d.add(ragged))).mul(on);
        const edge = length(q.div(size.mul(0.5)));
        const scuff = float(1).sub(smoothstep(0.5, 1.0, edge.add(coarse.r.sub(0.5).mul(0.8)))).mul(amount).mul(0.22);
        const lead = vec3(0.3, 0.3, 0.31);
        col.assign(mix(torn, select(through, dark, lead), core));
        a.assign(max(max(core, ring.mul(0.85)), scuff).mul(float(1).sub(smoothstep(0.92, 1.0, edge))));
      })
      .ElseIf(kind.equal(Scar.Scorch), () => {
        // Soot and char round a fire arrow or a burnt patch: black in the middle, brown at the fringe.
        const r = length(q.div(size.mul(0.5))).add(coarse.r.sub(0.5).mul(0.7)).add(fine.b.sub(0.5).mul(0.25));
        const s = float(1).sub(smoothstep(0.25, 1.0, r));
        col.assign(mix(vec3(0.09, 0.06, 0.04), vec3(0.018, 0.016, 0.015), smoothstep(0.3, 0.8, s)));
        a.assign(s.mul(0.9));
      })
      .Else(() => {
        // A shield board knocked out of the wall: a dark gap where it stood, the broken stumps of the board jagged
        // top and bottom, the torn ends pale.
        const rel = q.div(size.mul(0.5));
        const top = float(0.62).sub(fine.g.mul(0.38)).add(grain.r.sub(0.5).mul(0.14));
        const bottom = float(-0.7).add(fine.r.mul(0.32)).add(grain.b.sub(0.5).mul(0.14));
        const inY = smoothstep(bottom.sub(0.02), bottom, rel.y).mul(float(1).sub(smoothstep(top, top.add(0.02), rel.y)));
        const inX = float(1).sub(smoothstep(0.9, 0.95, abs(rel.x)));
        const hole = inY.mul(inX);
        const stump = float(1).sub(smoothstep(0.0, 0.1, min(abs(rel.y.sub(top)), abs(rel.y.sub(bottom))))).mul(inX).mul(smoothstep(0.3, 0.6, grain.g));
        col.assign(mix(torn, dark, hole));
        a.assign(max(hole, stump));
      });
    return vec4(col, a);
  })();
  m.colorNode = shade.xyz;
  m.opacityNode = shade.w;
  return m;
}

/** A float chosen by a boolean node (TSL's select on two constants). */
const select3 = (b: any, x: number, y: number): any => select(b, float(x), float(y));

export class Scars {
  readonly group = new Group();
  private readonly mesh: InstancedMesh;
  private readonly data: InstancedBufferAttribute;
  // Decals: the ship, the kind and its priority, when made, the quad in the ship's frame, and the shader's vec4.
  private nd = 0;
  private readonly dShip = new Int32Array(CAPS.decals);
  private readonly dKind = new Uint8Array(CAPS.decals);
  private readonly dSerial = new Float64Array(CAPS.decals);
  private readonly dLocal = new Float32Array(CAPS.decals * 16);
  private readonly dData = new Float32Array(CAPS.decals * 4);
  // Things in the wood: the ship, what it is, the point it entered (ship frame), the line it came in on, its length
  // and girth scales, the fraction standing out, how long it smoulders on.
  private ne = 0;
  private readonly eShip = new Int32Array(EMBEDDED.all);
  private readonly eKind = new Uint8Array(EMBEDDED.all);
  private readonly eSerial = new Float64Array(EMBEDDED.all);
  private readonly eP = new Float32Array(EMBEDDED.all * 3);
  private readonly eD = new Float32Array(EMBEDDED.all * 3);
  private readonly eLen = new Float32Array(EMBEDDED.all);
  private readonly eGirth = new Float32Array(EMBEDDED.all);
  private readonly eOut = new Float32Array(EMBEDDED.all);
  private readonly eBurn = new Float32Array(EMBEDDED.all);
  private readonly eAcc = new Float32Array(EMBEDDED.all);
  private serial = 0;
  /** How worn each wall board is, per ship: both sides, 1 and it is knocked out. */
  private readonly boards = new Map<number, Float32Array>();
  private readonly inv = new Matrix4();
  private readonly v = new Vector3();
  private readonly n = new Vector3();
  private readonly p = new Vector3();
  private readonly st: Strike = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, part: Part.Hull, board: -1 };
  private readonly look: HitLook = { ok: false, result: 'pierce', part: Part.Hull, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1, size: 0, energy: 0 };
  private k = 1;

  constructor(
    private readonly views: ShipViews,
    private readonly mun: Munitions,
    private readonly smoke: ParticleLayer,
    private readonly fire: ParticleLayer,
  ) {
    this.data = new InstancedBufferAttribute(this.dData, 4);
    this.data.setUsage(DynamicDrawUsage);
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), decalMaterial(this.data), CAPS.decals);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // Before the smoke and spray: a mark drawn after a puff in front of it would show through the puff.
    this.mesh.renderOrder = -2;
    this.group.add(this.mesh);
  }

  setKeep(k: number) {
    this.k = k;
  }

  /** A new battle: every mark goes with the old ships. */
  clear() {
    this.nd = 0;
    this.ne = 0;
    this.boards.clear();
    this.views.tears.clear();
  }

  /** A ship has gone under: its marks go with it. */
  removed(id: number) {
    for (let i = this.nd - 1; i >= 0; i -= 1) if (this.dShip[i] === id) this.dropDecal(i);
    for (let i = this.ne - 1; i >= 0; i -= 1) if (this.eShip[i] === id) this.dropEmbed(i);
    this.boards.delete(id);
    this.views.tears.delete(id);
  }

  stats() {
    return { decals: this.nd, embedded: this.ne, drawn: this.mesh.count };
  }

  // ---- The ship's frame ------------------------------------------------------------------------------------------

  private surfaceOf(ship: Ship): ShipSurface | null {
    const v = this.views.states.get(ship.id);
    return v ? surfaceFor(v.key, ship.spec.kind) : null;
  }

  /** World point and travel direction into the ship's plan frame (this.p, this.v). False without a view. */
  private toPlan(id: number, s: ShipSurface, x: number, y: number, z: number, dx: number, dy: number, dz: number) {
    const v = this.views.states.get(id);
    if (!v) return false;
    this.inv.copy(v.matrix).invert();
    this.p.set(x, y, z).applyMatrix4(this.inv).divideScalar(s.scale);
    this.v.set(dx, dy, dz).transformDirection(this.inv);
    return true;
  }

  /** The strike point and normal into the world, onto the look. */
  private lookAt(id: number, s: ShipSurface, st: Strike) {
    const v = this.views.states.get(id)!;
    this.p.set(st.x, st.y, st.z).multiplyScalar(s.scale).applyMatrix4(v.matrix);
    this.n.set(st.nx, st.ny, st.nz).transformDirection(v.matrix);
    const L = this.look;
    L.x = this.p.x;
    L.y = this.p.y;
    L.z = this.p.z;
    L.nx = this.n.x;
    L.ny = this.n.y;
    L.nz = this.n.z;
  }

  // ---- Decals ----------------------------------------------------------------------------------------------------

  private dropDecal(i: number) {
    const last = --this.nd;
    if (i === last) return;
    this.dShip[i] = this.dShip[last]!;
    this.dKind[i] = this.dKind[last]!;
    this.dSerial[i] = this.dSerial[last]!;
    this.dLocal.copyWithin(i * 16, last * 16, last * 16 + 16);
    this.dData.copyWithin(i * 4, last * 4, last * 4 + 4);
  }

  /** The slot for a new mark on a ship: a free one, else the least of that ship's when it is full, else the least of all. */
  private decalSlot(ship: number, kind: ScarKind) {
    let own = 0;
    let worst = -1;
    let worstAll = -1;
    const rank = (j: number) => PRIORITY[this.dKind[j]! as ScarKind] * 1e9 + this.dSerial[j]!;
    for (let j = 0; j < this.nd; j += 1) {
      if (worstAll < 0 || rank(j) < rank(worstAll)) worstAll = j;
      if (this.dShip[j] !== ship) continue;
      own += 1;
      if (worst < 0 || rank(j) < rank(worst)) worst = j;
    }
    const mine = PRIORITY[kind] * 1e9 + this.serial;
    if (own >= CAPS.perShip) return rank(worst) <= mine ? worst : -1;
    if (this.nd < CAPS.decals) return this.nd++;
    return rank(worstAll) <= mine ? worstAll : -1;
  }

  /**
   * A decal on the ship at a plan point with its normal: `w` along the planks (the surface's horizontal), `h` across.
   * `amount` is the kind's own dial (a shot hole's powder smudge, a cluster's density).
   */
  decal(ship: number, s: ShipSurface, kind: ScarKind, px: number, py: number, pz: number, nx: number, ny: number, nz: number, w: number, h: number, amount: number) {
    const i = this.decalSlot(ship, kind);
    if (i < 0) return -1;
    this.serial += 1;
    this.dShip[i] = ship;
    this.dKind[i] = kind;
    this.dSerial[i] = this.serial;
    // The quad's x along the ship where the face allows (the planks run fore and aft), else across.
    let tx = 1 - nx * nx;
    let ty = -nx * ny;
    let tz = -nx * nz;
    let tl = Math.hypot(tx, ty, tz);
    if (tl < 0.2) {
      tx = -nz * nx;
      ty = -nz * ny;
      tz = 1 - nz * nz;
      tl = Math.hypot(tx, ty, tz) || 1;
    }
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const bx = ny * tz - nz * ty;
    const by = nz * tx - nx * tz;
    const bz = nx * ty - ny * tx;
    const sc = s.scale;
    // A centimetre proud of the planks, and the polygon offset does the rest.
    const lift = 0.012;
    const o = i * 16;
    const L = this.dLocal;
    L[o] = tx * w * sc;
    L[o + 1] = ty * w * sc;
    L[o + 2] = tz * w * sc;
    L[o + 3] = 0;
    L[o + 4] = bx * h * sc;
    L[o + 5] = by * h * sc;
    L[o + 6] = bz * h * sc;
    L[o + 7] = 0;
    L[o + 8] = nx * sc;
    L[o + 9] = ny * sc;
    L[o + 10] = nz * sc;
    L[o + 11] = 0;
    L[o + 12] = (px + nx * lift) * sc;
    L[o + 13] = (py + ny * lift) * sc;
    L[o + 14] = (pz + nz * lift) * sc;
    L[o + 15] = 1;
    const d = i * 4;
    this.dData[d] = kind + clamp(amount, 0, 0.99);
    this.dData[d + 1] = rnd(0, 40);
    this.dData[d + 2] = w;
    this.dData[d + 3] = h;
    return i;
  }

  /** A cluster of the same kind already on this ship within `reach` metres of a plan point: it thickens instead of a new one. */
  private near(ship: number, kind: ScarKind, s: ShipSurface, px: number, py: number, pz: number, reach: number) {
    const sc = s.scale;
    for (let j = 0; j < this.nd; j += 1) {
      if (this.dShip[j] !== ship || this.dKind[j] !== kind) continue;
      const o = j * 16;
      const dx = this.dLocal[o + 12]! / sc - px;
      const dy = this.dLocal[o + 13]! / sc - py;
      const dz = this.dLocal[o + 14]! / sc - pz;
      if (dx * dx + dy * dy + dz * dz < reach * reach) return j;
    }
    return -1;
  }

  // ---- Things left in the wood -----------------------------------------------------------------------------------

  private dropEmbed(i: number) {
    const last = --this.ne;
    if (i === last) return;
    this.eShip[i] = this.eShip[last]!;
    this.eKind[i] = this.eKind[last]!;
    this.eSerial[i] = this.eSerial[last]!;
    this.eP.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.eD.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.eLen[i] = this.eLen[last]!;
    this.eGirth[i] = this.eGirth[last]!;
    this.eOut[i] = this.eOut[last]!;
    this.eBurn[i] = this.eBurn[last]!;
    this.eAcc[i] = this.eAcc[last]!;
  }

  /** Leaves a thing in the wood at a plan point, come in along (dx, dy, dz) (plan frame, unit). */
  embed(ship: number, s: ShipSurface, kind: EmbedKind, px: number, py: number, pz: number, dx: number, dy: number, dz: number, len: number, girth: number, out: number, burn: number) {
    let i = -1;
    let own = 0;
    let oldest = -1;
    let oldestAll = -1;
    for (let j = 0; j < this.ne; j += 1) {
      if (oldestAll < 0 || this.eSerial[j]! < this.eSerial[oldestAll]!) oldestAll = j;
      if (this.eShip[j] !== ship) continue;
      own += 1;
      if (oldest < 0 || this.eSerial[j]! < this.eSerial[oldest]!) oldest = j;
    }
    if (own >= EMBEDDED.ship) i = oldest;
    else if (this.ne < EMBEDDED.all) i = this.ne++;
    else i = oldestAll;
    if (i < 0) return;
    this.serial += 1;
    const sc = s.scale;
    this.eShip[i] = ship;
    this.eKind[i] = kind;
    this.eSerial[i] = this.serial;
    this.eP[i * 3] = px * sc;
    this.eP[i * 3 + 1] = py * sc;
    this.eP[i * 3 + 2] = pz * sc;
    this.eD[i * 3] = dx;
    this.eD[i * 3 + 1] = dy;
    this.eD[i * 3 + 2] = dz;
    this.eLen[i] = len;
    this.eGirth[i] = girth;
    this.eOut[i] = out;
    this.eBurn[i] = burn;
    this.eAcc[i] = 0;
  }

  // ---- Boards and sails ------------------------------------------------------------------------------------------

  /** Wears the wall boards round plan station x on one side by `amount`; a board worn through is knocked out. */
  private wear(ship: number, s: ShipSurface, x: number, side: number, reach: number, amount: number) {
    const n = s.boards.length;
    if (!n || !s.walls) return;
    let w = this.boards.get(ship);
    if (!w) this.boards.set(ship, (w = new Float32Array(n * 2)));
    const base = side > 0 ? n : 0;
    for (let i = 0; i < n; i += 1) {
      const bx = s.boards[i]!;
      const d = Math.abs(bx - x);
      if (d > reach + s.boardW / 2) continue;
      const before = w[base + i]!;
      if (before >= 1) continue;
      const after = before + amount * (d <= s.boardW / 2 ? 1 : 0.45);
      w[base + i] = after;
      if (after < 1) continue;
      const g = 0.05;
      const gx = -(s.walls.outer(bx + g) - s.walls.outer(bx - g)) / (2 * g);
      const l = Math.hypot(gx, 1);
      const [y0, y1] = s.boardY;
      this.decal(ship, s, Scar.BoardOut, bx, (y0 + y1) / 2, side * s.walls.outer(bx), gx / l, 0, side / l, s.boardW * 0.98, y1 - y0, 0);
    }
  }

  /** Tears the sails of a ship a little further (shot and arrows through the canvas, fire eating it). */
  private tear(ship: number, amount: number) {
    const t = this.views.tears.get(ship) ?? 0;
    this.views.tears.set(ship, Math.min(1, t + amount));
  }

  // ---- Hits ------------------------------------------------------------------------------------------------------

  /**
   * A shell the sim put into a ship at world (x, y, z), travelling along the unit (dx, dy, dz) at `speed`: finds where
   * it met the planks, works out from the records what it did there (src/fx/ordnance.ts) and leaves the marks.
   * `range` is how far it flew, for the spread of a load of small shot.
   */
  hit(ship: Ship, x: number, y: number, z: number, dx: number, dy: number, dz: number, speed: number, ammo: AmmoType, gun: GunType, range: number): HitLook {
    const L = this.look;
    L.ok = false;
    L.size = 0;
    L.energy = 0;
    L.result = ammo === 'arrow' ? 'stick' : 'embed';
    L.part = Part.Hull;
    const s = this.surfaceOf(ship);
    if (!s || !this.toPlan(ship.id, s, x, y, z, dx, dy, dz)) return L;
    const st = this.st;
    if (!strike(s, this.p.x, this.p.y, this.p.z, this.v.x, this.v.y, this.v.z, st)) return L;
    const ux = this.v.x;
    const uy = this.v.y;
    const uz = this.v.z;
    const id = ship.id;
    const faction = ship.spec.faction;
    const side = st.z >= 0 ? 1 : -1;
    const cos = Math.max(0, -(ux * st.nx + uy * st.ny + uz * st.nz));
    L.ok = true;
    L.part = st.part;
    if (ammo === 'fire') {
      this.lookAt(id, s, st);
      L.result = 'stick';
      this.fireArrow(ship, s, st, ux, uy, uz, gun === 'ozutsu' ? Embed.Hiya : Embed.Rocket);
      this.tear(id, 0.06);
      return L;
    }
    if (ammo === 'grape') {
      // Small shot spreads into a pattern a few metres across by the time it arrives; most of it is stopped by the
      // wall and the men behind it, and the hull planking only dents. The pattern lands on the wall where there is one.
      const w = s.walls;
      if (w && st.part !== Part.Wall && st.part !== Part.Castle && st.x >= w.x0 && st.x <= w.x1) {
        const g = 0.05;
        const gx = -(w.outer(st.x + g) - w.outer(st.x - g)) / (2 * g);
        const l = Math.hypot(gx, 1);
        st.y = (s.boardY[0] + s.boardY[1]) / 2;
        st.z = side * w.outer(st.x);
        st.nx = gx / l;
        st.ny = 0;
        st.nz = side / l;
        st.part = Part.Wall;
        L.part = Part.Wall;
      }
      this.lookAt(id, s, st);
      const pel = payload(gun, 'grape');
      const { T, k } = planking(faction, st.part === Part.Wall ? 'wall' : st.part === Part.Castle ? 'castle' : 'hull', s.plank);
      const per = outcome('ball', pel.mass, pel.diameter, pel.deform, speed, Math.max(cos, 0.6), T, k, faction === 'japan');
      const through = per.depth >= T;
      L.result = through ? 'pierce' : 'embed';
      L.energy = per.energy;
      const spread = clamp(range * 0.03 + 0.6, 0.8, 2.6);
      const kind = through ? Scar.Pellets : Scar.Chips;
      const j = this.near(id, kind, s, st.x, st.y, st.z, spread * 0.5);
      const density = gun === 'cheonja' || gun === 'jija' ? 0.34 : 0.22;
      if (j >= 0) this.dData[j * 4] = kind + Math.min(0.95, (this.dData[j * 4]! % 1) + density * 0.5);
      else {
        const wallH = st.part === Part.Wall ? s.boardY[1] - s.boardY[0] : spread * 0.6;
        this.decal(id, s, kind, st.x, st.y, st.z, st.nx, st.ny, st.nz, spread, Math.min(spread * 0.7, wallH + 0.15), density);
      }
      if (st.part === Part.Wall) this.wear(id, s, st.x, side, spread * 0.5, through ? 0.3 : 0.14);
      this.tear(id, 0.04);
      return L;
    }
    // A round shot or a gun arrow.
    const arrow = ammo === 'arrow';
    const load = payload(gun, ammo);
    const roof = st.part === Part.Roof;
    const zone = st.part === Part.Wall ? 'wall' : st.part === Part.Castle ? 'castle' : 'hull';
    const { T, k } = roof ? { T: 9, k: 30 } : planking(faction, zone, s.plank);
    // The turtle ship's roof is curved and spiked with iron: shot glances off it at angles a flat plank would take.
    const res = outcome(arrow ? 'arrow' : 'ball', load.mass, load.diameter, load.deform, speed, roof && cos < 0.57 ? 0 : cos, T, k, faction === 'japan');
    L.result = res.result;
    L.energy = res.energy;
    this.lookAt(id, s, st);
    const [len, girth] = arrowForm(gun);
    switch (res.result) {
      case 'smash': {
        // The planks broken out over half a metre to a metre, more for more energy; the arrow driven deep into the
        // breach, a quarter of it still showing.
        const w = clamp(0.4 + ((res.energy - 35000) / 150000) * 0.6, 0.4, 1.05);
        L.size = w;
        this.decal(id, s, Scar.Smash, st.x, st.y, st.z, st.nx, st.ny, st.nz, w * 1.3, w * 0.95, 0);
        if (arrow) this.embed(id, s, Embed.Heavy, st.x, st.y, st.z, ux, uy, uz, len / ARROW_LEN, girth / ARROW_GIRTH, 0.25, 0);
        if (st.part === Part.Wall) this.wear(id, s, st.x, side, w, 1);
        break;
      }
      case 'pierce': {
        // A clean hole a little wider than the shot (the arrow's iron sleeve, the ball); the arrow stays with half or
        // more of its length and its vanes out of the planks.
        const D = load.diameter * (arrow ? 1.35 : 1.3);
        L.size = D;
        this.decal(id, s, Scar.Hole, st.x, st.y, st.z, st.nx, st.ny, st.nz, Math.max(0.18, D * 3.4), Math.max(0.16, D * 3), arrow ? 0.1 : 0.55);
        if (arrow) this.embed(id, s, Embed.Heavy, st.x, st.y, st.z, ux, uy, uz, len / ARROW_LEN, girth / ARROW_GIRTH, rnd(0.4, 0.7), 0);
        if (st.part === Part.Wall) this.wear(id, s, st.x, side, 0.3, arrow ? 0.6 : 0.45);
        break;
      }
      case 'spall':
      case 'embed':
      case 'stick': {
        // Not through: a gun arrow stands in the planks by its head, a ball sits in a crater of torn grain, half of it
        // (or less, for a spall that burst the inner face) still showing.
        const deep = res.result === 'spall';
        if (arrow) {
          const head = 0.12 + (deep ? 0.15 : 0.05);
          this.embed(id, s, Embed.Heavy, st.x, st.y, st.z, ux, uy, uz, len / ARROW_LEN, girth / ARROW_GIRTH, 1 - head / len, 0);
          this.decal(id, s, Scar.Gouge, st.x, st.y, st.z, st.nx, st.ny, st.nz, load.diameter * 4, load.diameter * 1.8, 0);
        } else {
          const r = load.diameter / 2;
          this.embed(id, s, Embed.Ball, st.x, st.y, st.z, ux, uy, uz, r, r, deep ? 0.3 : 0.55, 0);
          this.decal(id, s, Scar.Gouge, st.x, st.y, st.z, st.nx, st.ny, st.nz, load.diameter * (deep ? 3.6 : 2.6), load.diameter * (deep ? 3 : 2.2), 0);
        }
        if (st.part === Part.Wall) this.wear(id, s, st.x, side, 0.2, arrow ? 0.35 : deep ? 0.3 : 0.18);
        break;
      }
      case 'glance': {
        // A long scar along the line the shot skidded off on.
        const w = clamp(0.25 + res.energy / 120000, 0.25, 1.4);
        this.decal(id, s, Scar.Gouge, st.x, st.y, st.z, st.nx, st.ny, st.nz, w, Math.max(0.08, load.diameter * 1.6), 0);
        break;
      }
    }
    this.tear(id, 0.015);
    return L;
  }

  /** A fire arrow (a rocket, a Japanese hiya) left burning in the planks: a scorch spreads round it while it smoulders. */
  private fireArrow(ship: Ship, s: ShipSurface, st: Strike, ux: number, uy: number, uz: number, kind: EmbedKind) {
    this.embed(ship.id, s, kind, st.x, st.y, st.z, ux, uy, uz, kind === Embed.Hiya ? 0.9 : 1.13, 1, 0.85, rnd(25, 45));
    this.decal(ship.id, s, Scar.Scorch, st.x, st.y, st.z, st.nx, st.ny, st.nz, rnd(0.55, 0.95), rnd(0.5, 0.8), 0);
  }

  /**
   * A cosmetic rocket of a salvo came down on a ship: the dispatches have fire arrows shot into the curtains and sails
   * (당포, "射中其紗帳與布帆"), so many of them hang burning in the canvas; the rest stick in the planks.
   */
  rocket(ship: Ship, x: number, y: number, z: number, dx: number, dy: number, dz: number) {
    const s = this.surfaceOf(ship);
    if (!s || !this.toPlan(ship.id, s, x, y, z, dx, dy, dz)) return;
    const st = this.st;
    if (s.sails.length && Math.random() < 0.45) {
      const sail = s.sails[Math.floor(Math.random() * s.sails.length)]!;
      // High in the sail more than low: the Ming manual's rule is that a sail lit high cannot be saved.
      sailPoint(sail, rnd(0.15, 0.85), Math.pow(Math.random(), 1.4) * 0.85 + 0.08, st);
      this.embed(ship.id, s, Embed.Rocket, st.x, st.y, st.z, this.v.x, this.v.y, this.v.z, 1.13, 1, 0.8, rnd(15, 30));
      this.tear(ship.id, 0.08);
      return;
    }
    if (!strike(s, this.p.x, this.p.y, this.p.z, this.v.x, this.v.y, this.v.z, st)) return;
    this.fireArrow(ship, s, st, this.v.x, this.v.y, this.v.z, Embed.Rocket);
  }

  /**
   * A matchlock ball from a shooter at world (sx, sz) into the wall or topsides facing him. Lead flattens on the
   * planks: a pale chip and a smear of lead, not a hole (the 2005 firing put a 9 mm ball 3.6 cm into hinoki).
   */
  musket(ship: Ship, sx: number, sz: number) {
    const s = this.surfaceOf(ship);
    if (!s) return;
    const c = Math.cos(ship.heading);
    const sn = Math.sin(ship.heading);
    const side = -(sx - ship.x) * sn + (sz - ship.z) * c >= 0 ? 1 : -1;
    const half = s.hull.length * 0.42;
    const px = rnd(-half, half);
    const w = s.walls;
    const py = w ? rnd(s.boardY[0], s.boardY[1]) : s.hull.deck - rnd(0.1, 0.8);
    const st = this.st;
    // Straight in from the shooter's side.
    if (!strike(s, px, py, side * 0.2, 0, 0, -side, st)) return;
    const j = this.near(ship.id, Scar.Chips, s, st.x, st.y, st.z, 1.2);
    if (j >= 0) this.dData[j * 4] = Scar.Chips + Math.min(0.9, (this.dData[j * 4]! % 1) + 0.04);
    else this.decal(ship.id, s, Scar.Chips, st.x, st.y, st.z, st.nx, st.ny, st.nz, 1.6, Math.min(1.1, w ? s.boardY[1] - s.boardY[0] + 0.1 : 0.9), 0.08);
    if (st.part === Part.Wall) this.wear(ship.id, s, st.x, side, 0.3, 0.015);
  }

  /** Marks for a ship laid straight in its plan frame (the damage gallery). */
  surface(ship: Ship) {
    return this.surfaceOf(ship);
  }

  /** The board at plan station x, for the gallery. */
  boardIndex(s: ShipSurface, x: number) {
    return boardAt(s, x);
  }

  // ---- Per frame -------------------------------------------------------------------------------------------------

  /**
   * Writes the decals of the ships in view into the mesh and hands the things in the wood to the munition meshes
   * (between their begin and end). Fire arrows smoulder on for half a minute or so. `focal` is pixels per metre at one
   * metre, as in Effects.
   */
  update(dt: number, battle: Battle, camX: number, camY: number, camZ: number, focal: number) {
    const out = this.mesh.instanceMatrix.array as Float32Array;
    const data = this.data.array as Float32Array;
    let n = 0;
    let lastId = -1;
    let vm: number[] | null = null;
    let near = false;
    for (let i = 0; i < this.nd; i += 1) {
      const id = this.dShip[i]!;
      if (id !== lastId) {
        lastId = id;
        const v = this.views.states.get(id);
        vm = v && v.visible ? v.matrix.elements : null;
        near = !!v && Math.hypot(v.origin.x - camX, v.origin.y - camY, v.origin.z - camZ) < DRAW_RANGE;
      }
      if (!vm || !near) continue;
      mul(vm, this.dLocal, i * 16, out, n * 16);
      data[n * 4] = this.dData[i * 4]!;
      data[n * 4 + 1] = this.dData[i * 4 + 1]!;
      data[n * 4 + 2] = this.dData[i * 4 + 2]!;
      data[n * 4 + 3] = this.dData[i * 4 + 3]!;
      n += 1;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.data.clearUpdateRanges();
      this.data.addUpdateRange(0, n * 4);
      this.data.needsUpdate = true;
    }
    for (let i = 0; i < this.ne; i += 1) {
      const id = this.eShip[i]!;
      const v = this.views.states.get(id);
      if (!v || !v.visible) continue;
      const ship = battle.get(id);
      if (!ship) continue;
      this.p.set(this.eP[i * 3]!, this.eP[i * 3 + 1]!, this.eP[i * 3 + 2]!).applyMatrix4(v.matrix);
      const d = Math.hypot(this.p.x - camX, this.p.y - camY, this.p.z - camZ);
      if (d > DRAW_RANGE) continue;
      this.v.set(this.eD[i * 3]!, this.eD[i * 3 + 1]!, this.eD[i * 3 + 2]!).transformDirection(v.matrix);
      const ppm = focal / Math.max(1, d);
      const kind = this.eKind[i]! as EmbedKind;
      const len = this.eLen[i]!;
      const outside = this.eOut[i]!;
      if (kind === Embed.Ball) {
        // The ball's centre this far into the wood: half showing, or less.
        const r = len;
        const sink = r * (1 - 2 * outside);
        this.mun.putLodged(this.p.x + this.v.x * sink, this.p.y + this.v.y * sink, this.p.z + this.v.z * sink, r);
        continue;
      }
      if (kind === Embed.Heavy) {
        const real = len * ARROW_LEN;
        const grow = Math.min(1.6, Math.max(1, 8 / (real * ppm)));
        // The model's head is at +0.96 of its scaled length from its origin; the origin sits back so that the part
        // not standing out is in the wood.
        const sl = len * grow;
        const inside = (1 - outside) * real;
        this.mun.putHeavy(this.p.x + this.v.x * (inside - 0.96 * sl), this.p.y + this.v.y * (inside - 0.96 * sl), this.p.z + this.v.z * (inside - 0.96 * sl), this.v.x, this.v.y, this.v.z, sl, this.eGirth[i]! * grow);
        continue;
      }
      const grow = Math.min(1.6, Math.max(1, 4 / (len * ppm)));
      const sc = len * grow;
      const tip = kind === Embed.Hiya ? 0.52 : 0.72;
      const inside = (1 - outside) * sc;
      const ox = this.p.x + this.v.x * (inside - tip * sc);
      const oy = this.p.y + this.v.y * (inside - tip * sc);
      const oz = this.p.z + this.v.z * (inside - tip * sc);
      if (kind === Embed.Hiya) this.mun.putHiya(ox, oy, oz, this.v.x, this.v.y, this.v.z, sc);
      else this.mun.putRocket(ox, oy, oz, this.v.x, this.v.y, this.v.z, sc);
      // The bundle of tow or the spent motor smoulders: a lick of flame and a thread of smoke, dying down.
      const burn = this.eBurn[i]!;
      if (burn > 0 && dt > 0 && ship.sinking < 0.5) {
        this.eBurn[i] = Math.max(0, burn - dt);
        if (d > 450) continue;
        const live = Math.min(1, burn / 8);
        this.eAcc[i] = Math.min(this.eAcc[i]! + (3 + 4 * live) * this.k * dt, 4);
        const hx = this.p.x - this.v.x * 0.15;
        const hy = this.p.y - this.v.y * 0.15;
        const hz = this.p.z - this.v.z * 0.15;
        while (this.eAcc[i]! >= 1) {
          this.eAcc[i] = this.eAcc[i]! - 1;
          this.fire.emit({ x: hx + rnd(-0.05, 0.05), y: hy, z: hz + rnd(-0.05, 0.05), vx: rnd(-0.2, 0.2), vy: rnd(0.6, 1.4), vz: rnd(-0.2, 0.2), life: rnd(0.25, 0.5), size0: 0.28 * live + 0.08, size1: 0.12, heat: 1, drag: 1.5, lift: 1.5, wind: 0.4, alpha: 0.8 });
          if (Math.random() < 0.5) this.smoke.emit({ x: hx, y: hy + 0.2, z: hz, vx: rnd(-0.2, 0.2), vy: rnd(0.8, 1.6), vz: rnd(-0.2, 0.2), life: rnd(3, 6), size0: 0.3, size1: rnd(1.6, 2.8), alpha: 0.28, r: 0.25, g: 0.23, b: 0.22, drag: 0.8, lift: 0.4, wind: 1 });
        }
      }
    }
  }
}

/** out[o..o+16] = a x b[bo..bo+16], column-major 4x4. */
function mul(a: ArrayLike<number>, b: Float32Array, bo: number, out: Float32Array, o: number) {
  for (let c = 0; c < 4; c += 1) {
    const b0 = b[bo + c * 4]!;
    const b1 = b[bo + c * 4 + 1]!;
    const b2 = b[bo + c * 4 + 2]!;
    const b3 = b[bo + c * 4 + 3]!;
    out[o + c * 4] = a[0]! * b0 + a[4]! * b1 + a[8]! * b2 + a[12]! * b3;
    out[o + c * 4 + 1] = a[1]! * b0 + a[5]! * b1 + a[9]! * b2 + a[13]! * b3;
    out[o + c * 4 + 2] = a[2]! * b0 + a[6]! * b1 + a[10]! * b2 + a[14]! * b3;
    out[o + c * 4 + 3] = a[3]! * b0 + a[7]! * b1 + a[11]! * b2 + a[15]! * b3;
  }
}
