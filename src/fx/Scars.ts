import { Group, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardNodeMaterial, PlaneGeometry, Vector3 } from 'three/webgpu';
import { abs, float, floor, fract, instancedBufferAttribute, length, max, min, mix, select, sin, smoothstep, texture, uv, vec2, vec3 } from 'three/tsl';
import type { Battle } from '../sim/battle';
import type { AmmoType, GunType, Ship } from '../sim/types';
import type { ShipViews } from '../ships/ShipViews';
import { boardAt, Part, sailPoint, strike, surfaceFor, type PartId, type ShipSurface, type Strike } from '../ships/surface';
import { equipment } from '../game/quality';
import { particleNoise } from './particleNoise';
import { outcome, payload, planking, type Outcome } from './ordnance';
import { arrowForm, EMBEDDED, type Munitions } from './Projectiles';

/**
 * What a fight leaves on the ships and keeps there until they sink: shot holes and splintered plank scars where the
 * shot met the planks, great arrows standing in the planking at the angle they struck, spent fire arrows in hulls and
 * sails, iron balls lodged in the wood, pocked and knocked-out shield boards, scorch marks, and torn sails.
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
 * The decal material: a quad shaded by kind from the shared noise texture (src/fx/particleNoise.ts). Every kind's
 * shape is worked out and the instance's kind picks one, with no branches: the marks are few and small on screen, and
 * a branch per kind kept nodes built in one branch from reaching another. The quad's x runs along the planks, so
 * holes and splinters tear with the grain.
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
  const seed: any = S.y;
  const size: any = vec2(S.z, S.w);
  // Metres from the centre of the mark, and the same in halves of the quad (-1..1).
  const q: any = uv().sub(0.5).mul(size);
  const rel: any = uv().sub(0.5).mul(2);
  const tex = particleNoise();
  // Hand-sized lumps, foot-sized patches, and fibres: noise stretched four times along the grain.
  const fine: any = texture(tex, q.mul(2.4).add(vec2(seed, seed.mul(1.7))));
  const coarse: any = texture(tex, q.mul(0.8).add(vec2(seed.mul(2.3), seed.mul(0.61))));
  const fibre: any = texture(tex, q.mul(vec2(2, 8)).add(vec2(seed.mul(0.37), seed)));
  const hash = (a: any, b: any) => fract(sin(a.mul(12.9898).add(b.mul(78.233)).add(seed.mul(3.17))).mul(43758.5453));
  const one = float(1);
  // Into the hull's dark; fresh-torn pine or cedar, pale against the tarred and weathered face; powder soot.
  const dark = vec3(0.014, 0.011, 0.009);
  const torn: any = mix(vec3(0.34, 0.24, 0.14), vec3(0.62, 0.48, 0.32), fibre.g);
  const soot = vec3(0.035, 0.032, 0.03);
  // Splinters standing out of a torn edge in fingers along the grain.
  const fingers = smoothstep(0.38, 0.62, fibre.r);

  // Hole: a hole a third of the quad across, a little longer along the grain, its edge ragged; the face torn away in
  // pale splinters round it, further along the grain than across; the powder's smudge (amount) round a shot hole.
  const D = min(size.x, size.y).div(3.2);
  const hr0: any = length(q.div(vec2(1.15, 0.9))).div(D.mul(0.5));
  const hCore = one.sub(smoothstep(0.92, 1.0, hr0.add(fine.r.sub(0.5).mul(0.5))));
  const hFringe = one.sub(smoothstep(0.9, 1.0, length(q.div(vec2(2.1, 1.05).mul(D.mul(0.5)))).add(coarse.g.sub(0.5).mul(0.5)).sub(fingers.mul(0.35))));
  const hSmudge = one.sub(smoothstep(1.2, 3.0, hr0.add(coarse.b.sub(0.5).mul(0.9)))).mul(amount);
  const holeCol = mix(mix(soot, torn, hFringe), dark, hCore);
  const holeA = max(max(hCore, hFringe.mul(0.95)), hSmudge.mul(0.7));

  // Smash: planks broken out. Each strake of the breach has its own gap, longest in the middle rows, its ends
  // splintered; the seams between the strakes split open along the breach.
  const ph = float(0.22);
  const row = floor(q.y.div(ph));
  const sLen = hash(row, float(1.3));
  const sShift = hash(row, float(7.1)).sub(0.5).mul(0.2).mul(size.x);
  const sGap = size.x.mul(0.4).mul(one.sub(rel.y.mul(rel.y)).max(0).pow(0.5)).mul(sLen.mul(0.5).add(0.5));
  const sEnd = abs(q.x.sub(sShift)).sub(sGap).sub(fine.r.sub(0.5).mul(0.1));
  const sIn = one.sub(smoothstep(0.82, 0.9, abs(rel.y)));
  const sHole = one.sub(smoothstep(-0.015, 0.0, sEnd)).mul(sIn);
  const sSplit = one.sub(smoothstep(0.0, fine.a.mul(0.1).add(0.07), sEnd.sub(fingers.mul(0.06)))).mul(sIn);
  const sToSeam = min(fract(q.y.div(ph)), one.sub(fract(q.y.div(ph)))).mul(ph);
  const sSeam = one.sub(smoothstep(0.006, 0.016, sToSeam)).mul(one.sub(smoothstep(0.0, 0.35, sEnd))).mul(0.85);
  const smashCol = mix(mix(soot, torn, sSplit), dark, max(sHole, sSeam));
  const smashA = max(max(sHole, sSplit), sSeam);

  // Gouge: torn grain where a shot glanced off or lodged, or an arrow split the face: pale and fibrous, a dark crease
  // along the middle.
  const gBody = one.sub(smoothstep(0.7, 1.0, length(rel).add(coarse.r.sub(0.5).mul(0.5)).sub(fingers.mul(0.25))));
  const gCrease = one.sub(smoothstep(0.0, 0.25, abs(rel.y).add(fine.g.sub(0.5).mul(0.15)))).mul(one.sub(smoothstep(0.5, 0.8, abs(rel.x))));
  const gougeCol = mix(torn, dark, gCrease.mul(0.85));

  // Pellets and chips: a wall peppered by a load of small shot. In cells of a hand's breadth, a hit in as many as the
  // density gives: a dark hole through a thin board in its ring of splinters (Pellets), or a pale dent with a grey
  // smear of lead in a thick one (Chips); here and there a strip of the face torn off along the grain, and a scuff of
  // splinters over the patch that reads from afar.
  const through: any = kind.equal(Scar.Pellets);
  const c = select(through, float(0.12), float(0.16));
  const cell: any = floor(q.div(c));
  const f: any = fract(q.div(c)).sub(0.5);
  const pOn = select(hash(cell.x, cell.y).lessThan(amount.mul(1.3)), one, float(0));
  const pOff: any = vec2(hash(cell.x.add(3.1), cell.y), hash(cell.x, cell.y.add(5.7))).sub(0.5).mul(0.5);
  const pd = length(f.sub(pOff)).mul(c).add(fine.r.sub(0.5).mul(0.008));
  const pr = select(through, float(0.014), float(0.009));
  const pCore = one.sub(smoothstep(pr.mul(0.8), pr, pd)).mul(pOn);
  const pRing = one.sub(smoothstep(pr.mul(1.6), pr.mul(3), pd)).mul(pOn);
  const strip = smoothstep(0.66, 0.72, fibre.b).mul(select(hash(cell.x.add(9.2), cell.y).lessThan(amount.mul(0.5)), one, float(0)));
  const pEdge = length(rel);
  const pScuff = one.sub(smoothstep(0.45, 1.0, pEdge.add(coarse.r.sub(0.5).mul(0.8)))).mul(amount.mul(0.3).add(0.08));
  const pelletCol = mix(torn, select(through, dark, vec3(0.3, 0.3, 0.31)), pCore);
  const pelletA = max(max(pCore, pRing.mul(0.9)), max(strip.mul(0.85), pScuff)).mul(one.sub(smoothstep(0.92, 1.0, pEdge)));

  // Scorch: charred wood round a fire arrow, black in the middle with grey ash on it, brown where the heat only
  // browned the face.
  const sc = one.sub(smoothstep(0.2, 1.0, length(rel).add(coarse.r.sub(0.5).mul(0.6)).add(fine.b.sub(0.5).mul(0.25))));
  const ash = smoothstep(0.55, 0.7, coarse.g).mul(smoothstep(0.35, 0.6, sc));
  const scorchCol = mix(mix(vec3(0.13, 0.08, 0.045), vec3(0.016, 0.014, 0.013), smoothstep(0.25, 0.7, sc)), vec3(0.3, 0.29, 0.28), ash.mul(0.7));

  // Board out: a shield board knocked out of the wall, a dark gap where it stood, the broken stumps jagged top and
  // bottom with their torn ends pale.
  const bTop = float(0.6).sub(fine.g.mul(0.4)).add(fingers.mul(0.1));
  const bBottom = float(-0.72).add(fine.r.mul(0.34)).sub(fingers.mul(0.1));
  const bInX = one.sub(smoothstep(0.9, 0.94, abs(rel.x)));
  const bHole = smoothstep(bBottom.sub(0.015), bBottom, rel.y).mul(one.sub(smoothstep(bTop, bTop.add(0.015), rel.y))).mul(bInX);
  const bStump = one.sub(smoothstep(0.0, 0.09, min(abs(rel.y.sub(bTop)), abs(rel.y.sub(bBottom))))).mul(bInX);
  const boardCol = mix(torn, dark, bHole);
  const boardA = max(bHole, bStump.mul(0.95));

  const pick = (h: any, sm: any, g: any, p: any, s: any, b: any) =>
    select(kind.equal(Scar.Hole), h, select(kind.equal(Scar.Smash), sm, select(kind.equal(Scar.Gouge), g, select(kind.lessThan(Scar.Scorch), p, select(kind.equal(Scar.Scorch), s, b)))));
  m.colorNode = pick(holeCol, smashCol, gougeCol, pelletCol, scorchCol, boardCol);
  m.opacityNode = pick(holeA, smashA, gBody, pelletA, sc.mul(0.95), boardA);
  return m;
}

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
  // (metres for a gun arrow, the model's scale for the others, the radius for a ball) and the fraction standing out.
  private ne = 0;
  private readonly eShip = new Int32Array(EMBEDDED.all);
  private readonly eKind = new Uint8Array(EMBEDDED.all);
  private readonly eSerial = new Float64Array(EMBEDDED.all);
  private readonly eP = new Float32Array(EMBEDDED.all * 3);
  private readonly eD = new Float32Array(EMBEDDED.all * 3);
  private readonly eLen = new Float32Array(EMBEDDED.all);
  private readonly eOut = new Float32Array(EMBEDDED.all);
  private serial = 0;
  /** How worn each wall board is, per ship: both sides, 1 and it is knocked out. */
  private readonly boards = new Map<number, Float32Array>();
  private readonly inv = new Matrix4();
  private readonly v = new Vector3();
  private readonly n = new Vector3();
  private readonly p = new Vector3();
  private readonly st: Strike = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, part: Part.Hull, board: -1 };
  private readonly look: HitLook = { ok: false, result: 'pierce', part: Part.Hull, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1, size: 0, energy: 0 };
  constructor(
    private readonly views: ShipViews,
    private readonly mun: Munitions,
  ) {
    this.data = new InstancedBufferAttribute(new Float32Array(CAPS.decals * 4), 4);
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), decalMaterial(this.data), CAPS.decals);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // Before the smoke and spray: a mark drawn after a puff in front of it would show through the puff.
    this.mesh.renderOrder = -2;
    this.group.add(this.mesh);
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
    // Proud of the planks by enough to clear the painted shield boards nailed on them; the polygon offset does the rest.
    const lift = 0.04;
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
    this.eOut[i] = this.eOut[last]!;
  }

  /** Leaves a thing in the wood at a plan point, come in along (dx, dy, dz) (plan frame, unit). */
  embed(ship: number, s: ShipSurface, kind: EmbedKind, px: number, py: number, pz: number, dx: number, dy: number, dz: number, len: number, out: number) {
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
    this.eOut[i] = out;
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
      // The board struck takes it all, its neighbours within the blow less.
      const after = before + amount * (d <= s.boardW / 2 + reach * 0.5 ? 1 : 0.45);
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
    const [len] = arrowForm(gun);
    switch (res.result) {
      case 'smash': {
        // The planks broken out over half a metre to a metre, more for more energy; the arrow driven deep into the
        // breach, a quarter of it still showing.
        const w = clamp(0.4 + ((res.energy - 35000) / 150000) * 0.6, 0.4, 1.05);
        L.size = w;
        this.decal(id, s, Scar.Smash, st.x, st.y, st.z, st.nx, st.ny, st.nz, w * 1.3, w * 0.95, 0);
        if (arrow) this.embed(id, s, Embed.Heavy, st.x, st.y, st.z, ux, uy, uz, len, 0.25);
        if (st.part === Part.Wall) this.wear(id, s, st.x, side, w, 1);
        break;
      }
      case 'pierce': {
        // A clean hole a little wider than the shot (the arrow's iron sleeve, the ball); the arrow stays with half or
        // more of its length and its vanes out of the planks.
        const D = load.diameter * (arrow ? 1.35 : 1.3);
        L.size = D;
        this.decal(id, s, Scar.Hole, st.x, st.y, st.z, st.nx, st.ny, st.nz, Math.max(0.18, D * 3.4), Math.max(0.16, D * 3), arrow ? 0.1 : 0.55);
        if (arrow) this.embed(id, s, Embed.Heavy, st.x, st.y, st.z, ux, uy, uz, len, rnd(0.4, 0.7));
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
          this.embed(id, s, Embed.Heavy, st.x, st.y, st.z, ux, uy, uz, len, 1 - head / len);
          this.decal(id, s, Scar.Gouge, st.x, st.y, st.z, st.nx, st.ny, st.nz, load.diameter * 4, load.diameter * 1.8, 0);
        } else {
          const r = load.diameter / 2;
          this.embed(id, s, Embed.Ball, st.x, st.y, st.z, ux, uy, uz, r, deep ? 0.3 : 0.55);
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

  /** A fire arrow (a rocket, a Japanese hiya) left in the planks with the scorch of its burnt-out charge round it. */
  private fireArrow(ship: Ship, s: ShipSurface, st: Strike, ux: number, uy: number, uz: number, kind: EmbedKind) {
    this.embed(ship.id, s, kind, st.x, st.y, st.z, ux, uy, uz, kind === Embed.Hiya ? 0.9 : 1.13, 0.85);
    this.decal(ship.id, s, Scar.Scorch, st.x, st.y, st.z, st.nx, st.ny, st.nz, rnd(0.55, 0.95), rnd(0.5, 0.8), 0);
  }

  /**
   * A cosmetic rocket of a salvo came down on a ship: the dispatches have fire arrows shot into the curtains and sails
   * (당포, "射中其紗帳與布帆"), so many of them hang in the canvas; the rest stick in the planks.
   */
  rocket(ship: Ship, x: number, y: number, z: number, dx: number, dy: number, dz: number) {
    const s = this.surfaceOf(ship);
    if (!s || !this.toPlan(ship.id, s, x, y, z, dx, dy, dz)) return;
    const st = this.st;
    if (s.sails.length && Math.random() < 0.45) {
      const sail = s.sails[Math.floor(Math.random() * s.sails.length)]!;
      // High in the sail more than low: the Ming manual's rule is that a sail lit high cannot be saved.
      sailPoint(sail, rnd(0.15, 0.85), Math.pow(Math.random(), 1.4) * 0.85 + 0.08, st);
      this.embed(ship.id, s, Embed.Rocket, st.x, st.y, st.z, this.v.x, this.v.y, this.v.z, 1.13, 0.8);
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
    // Straight in from the shooter's side, from outside the hull.
    if (!strike(s, px, py, side * s.hull.beam, 0, 0, -side, st)) return;
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
   * (between their begin and end). `focal` is pixels per metre at one metre, as in Effects.
   */
  update(battle: Battle, camX: number, camY: number, camZ: number, focal: number) {
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
        // The head is driven into the wood by the part of the arrow not standing out; from afar it is drawn a little
        // longer so that it still reads.
        const grow = Math.min(1.6, Math.max(1, 8 / (len * ppm)));
        const inside = (1 - outside) * len;
        this.mun.putHeavy(this.p.x + this.v.x * inside, this.p.y + this.v.y * inside, this.p.z + this.v.z * inside, this.v.x, this.v.y, this.v.z, len * grow);
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
