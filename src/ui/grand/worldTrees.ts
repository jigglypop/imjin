import { BufferGeometry, Color, Float32BufferAttribute, Group, InstancedMesh, MeshBasicNodeMaterial } from 'three/webgpu';
import { frameU, frameV, worldX, worldZ, type CameraState } from './worldCamera';

// Trees for the close views of the campaign world: one instanced mesh of low-poly pines, laid on the wooded hills round
// the point the camera looks at. The map is drawn at a stylised scale (its camps are kilometres across), so the trees are
// too: big enough to read as a forest from a low camera, in three size levels so that a nearer camera sees more and
// smaller ones. Nothing is planted farther out than the camera can use, and the land's own colour carries the forest from
// afar. Where trees stand is worked out a tile of cells at a time and kept, within a few milliseconds a frame, so panning
// only plants the tiles that come into reach.

/** Trees at most. */
const CAPACITY = 8000;
/** Cell size and tree height for each level, in frame units, and the camera distance each serves up to. */
const LEVELS = [
  { cell: 0.0006, height: 0.00048, until: 0.055 },
  { cell: 0.0012, height: 0.00095, until: 0.13 },
  { cell: 0.0024, height: 0.0019, until: 0.26 },
] as const;
/** Hysteresis, so a camera resting on a boundary does not flip between two levels. */
const HOLD = 1.12;
/** The planted disc's radius in cells of its level. */
const REACH = 72;
/** Cells along a tile's side. */
const TILE = 16;
/** Milliseconds a frame may spend on the trees: working out new tiles and laying the trees of the ready ones. */
const BUDGET_MS = 3;
/** Tiles kept for reuse; the ones used longest ago go first. */
const KEEP = 900;
/** No tree within this of a camp (frame units), so the camp reads. */
const CLEARING = 0.0175;
/** Floats kept per tree: x, ground height, z, height, width and the tint's red, green and blue. */
const STRIDE = 8;

/** A cheap deterministic hash of two integers into 0..1. */
function hash(a: number, b: number, salt = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(salt | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise on a grid of the given scale. */
function noise(x: number, y: number, salt: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, salt), b = hash(ix + 1, iy, salt), c = hash(ix, iy + 1, salt), d = hash(ix + 1, iy + 1, salt);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * A pine one unit tall, eleven triangles: a five-sided cone on a three-sided stub, each face one flat colour with the map's
 * sun (-0.55, 0.62, -0.55) baked in. Trees are never turned, so every tree is lit from the same side.
 */
function pine(): BufferGeometry {
  const sun = [-0.55, 0.62, -0.55].map((c) => c / Math.hypot(-0.55, 0.62, -0.55));
  const position: number[] = [];
  const color: number[] = [];
  const face = (corners: number[][], hex: string) => {
    const [a, b, c] = corners as [number[], number[], number[]];
    const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const length = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    const light = 0.55 + 0.7 * Math.max(0, (n[0]! * sun[0]! + n[1]! * sun[1]! + n[2]! * sun[2]!) / length);
    const tint = new Color(hex).multiplyScalar(light);
    for (const p of corners) {
      position.push(p[0]!, p[1]!, p[2]!);
      color.push(tint.r, tint.g, tint.b);
    }
  };
  const ring = (sides: number, radius: number, y: number, k: number) => {
    const a = (k / sides) * Math.PI * 2;
    return [Math.sin(a) * radius, y, Math.cos(a) * radius];
  };
  // Counter-clockwise seen from outside, so the faces look out.
  for (let k = 0; k < 5; k += 1) face([ring(5, 0.36, 0.2, k), ring(5, 0.36, 0.2, k + 1), [0, 1, 0]], '#2c5b36');
  for (let k = 0; k < 3; k += 1) {
    const a0 = ring(3, 0.07, 0, k), a1 = ring(3, 0.07, 0, k + 1), b0 = ring(3, 0.07, 0.24, k), b1 = ring(3, 0.07, 0.24, k + 1);
    face([a0, a1, b1], '#4a3826');
    face([a0, b1, b0], '#4a3826');
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(color, 3));
  return geometry;
}

interface Tile {
  /** STRIDE floats per tree. */
  trees: Float32Array;
  /** The assembly that last used it. */
  used: number;
}

/** Trees round the camera's target. `ground` is the terrain height in frame units at a frame point, `perMetre` its frame units per metre. */
export class TreeLayer {
  readonly group = new Group();
  private readonly mesh: InstancedMesh;
  private readonly material = new MeshBasicNodeMaterial({ vertexColors: true });
  private readonly geometry = pine();
  private clearings: { u: number; v: number }[] = [];
  private readonly tiles = new Map<number, Tile>();
  private level = -1;
  /** Where the trees on show were laid round, in world x and z, and whether every tile they need was ready. */
  private anchor = { x: Number.NaN, z: Number.NaN };
  private complete = false;
  private assemblies = 0;
  /** How long laying the trees took the last time (ms): the planting leaves it room within the budget. */
  private layMs = 0;
  private disposed = false;

  constructor(private readonly ground: (u: number, v: number) => number, private readonly perMetre: number) {
    this.mesh = new InstancedMesh(this.geometry, this.material, CAPACITY);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // The colours of the instances are a tint on the vertex colours; allocate them once.
    this.mesh.setColorAt(0, new Color(1, 1, 1));
    this.group.add(this.mesh);
  }

  /** Where camps stand: no trees round them, so the camp reads. Frame coordinates. */
  setClearings(points: { u: number; v: number }[]) {
    this.clearings = points;
    this.complete = false;
    this.anchor = { x: Number.NaN, z: Number.NaN };
  }

  /**
   * Lays the trees round the camera's target: works out the tiles that have come into reach within a few milliseconds and
   * re-lays the trees when the target has moved or a level changed. Returns whether the trees changed or still have work
   * to do, so the caller draws another frame while it is true.
   */
  update(cam: CameraState): boolean {
    if (this.disposed) return false;
    const want = this.levelFor(cam.distance);
    if (want < 0) {
      const changed = this.mesh.visible;
      this.mesh.visible = false;
      this.level = -1;
      this.anchor = { x: Number.NaN, z: Number.NaN };
      return changed;
    }
    const { cell } = LEVELS[want]!;
    const reach = REACH * cell;
    const x = worldX(cam.u), z = worldZ(cam.v);
    const moved = Math.hypot(x - this.anchor.x, z - this.anchor.z);
    if (want === this.level && this.complete && moved < reach * 0.08) return false;
    // The tiles that reach into the disc round the target, nearest first.
    const size = TILE * cell;
    const needed: { key: number; i: number; j: number; distance: number }[] = [];
    const i0 = Math.floor((x - reach) / size), i1 = Math.floor((x + reach) / size);
    const j0 = Math.floor((z - reach) / size), j1 = Math.floor((z + reach) / size);
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const nx = Math.max(i * size, Math.min(x, (i + 1) * size)), nz = Math.max(j * size, Math.min(z, (j + 1) * size));
        if (Math.hypot(nx - x, nz - z) > reach) continue;
        needed.push({ key: (want * 65536 + (j + 32768)) * 65536 + (i + 32768), i, j, distance: Math.hypot((i + 0.5) * size - x, (j + 0.5) * size - z) });
      }
    }
    needed.sort((a, b) => a.distance - b.distance || a.key - b.key);
    // At least one new tile a frame, so the planting always gets on, however long laying the trees takes.
    const start = performance.now(), budget = BUDGET_MS - this.layMs;
    let ready = 0, planted = 0;
    for (const tile of needed) {
      if (!this.tiles.has(tile.key)) {
        if (planted > 0 && performance.now() - start > budget) break;
        this.tiles.set(tile.key, { trees: this.plant(want, tile.i, tile.j), used: 0 });
        planted += 1;
      }
      ready += 1;
    }
    const complete = ready === needed.length;
    // A new level shows once its nearer half is ready, so the old trees stay until they can be replaced.
    if (want !== this.level && this.level >= 0 && !complete && needed[ready] && needed[ready]!.distance < reach * 0.5) return true;
    this.level = want;
    this.complete = complete;
    this.anchor = { x, z };
    const laying = performance.now();
    this.assemble(needed.slice(0, ready), reach, x, z);
    this.layMs = performance.now() - laying;
    return true;
  }

  private levelFor(distance: number) {
    const current = this.level;
    for (let i = 0; i < LEVELS.length; i += 1) {
      const limit = LEVELS[i]!.until * (current === i ? HOLD : 1);
      if (distance <= limit) return i;
    }
    return -1;
  }

  /** Where the trees of one tile stand: on dry, not too steep ground below the bare heights, in patches of wood. */
  private plant(level: number, ti: number, tj: number) {
    const { cell, height } = LEVELS[level]!;
    const out: number[] = [];
    for (let j = tj * TILE; j < (tj + 1) * TILE; j += 1) {
      for (let i = ti * TILE; i < (ti + 1) * TILE; i += 1) {
        // Where in the cell the tree stands, and whether this cell has one at all: a density that thins towards the open ground.
        const jx = hash(i, j, level * 7 + 1), jz = hash(i, j, level * 7 + 2);
        const x = (i + 0.15 + 0.7 * jx) * cell, z = (j + 0.15 + 0.7 * jz) * cell;
        // Woods on the high and rough ground, open fields on the low and flat; patches by two scales of noise. The noise
        // alone already rules most cells out, before the ground is read.
        const patch = noise(x * 90, z * 90, 3) * 0.6 + noise(x * 380, z * 380, 5) * 0.4;
        const wood = Math.min(1, Math.max(0, (patch - 0.34) * 2.2));
        const roll = hash(i, j, level * 7 + 3);
        if (roll > wood) continue;
        const u = frameU(x), v = frameV(z);
        const e = this.ground(u, v);
        if (e <= 0) continue;
        const metres = e / this.perMetre;
        if (metres < 8 || metres > 950 || roll > wood * Math.min(1, 0.35 + metres / 90)) continue;
        const slope = (Math.abs(this.ground(u + cell, v) - e) + Math.abs(this.ground(u, v + cell) - e)) / cell;
        if (slope > 0.9) continue;
        const size = height * (0.75 + 0.55 * hash(i, j, level * 7 + 4));
        const tint = 0.78 + 0.4 * hash(i, j, level * 7 + 6);
        out.push(x, e, z, size, size * (0.85 + 0.3 * hash(i, j, level * 7 + 5)), tint * (0.95 + 0.1 * jx), tint, tint * (0.95 + 0.1 * jz));
      }
    }
    return Float32Array.from(out);
  }

  /** Lays the trees of the ready tiles, nearest tile first, thinning out to nothing at the disc's edge. */
  private assemble(tiles: { key: number }[], reach: number, cx: number, cz: number) {
    const array = this.mesh.instanceMatrix.array as Float32Array;
    const colors = this.mesh.instanceColor!.array as Float32Array;
    const clear = this.clearings.map((p) => ({ x: worldX(p.u), z: worldZ(p.v) })).filter((p) => Math.hypot(p.x - cx, p.z - cz) < reach + CLEARING);
    const stamp = (this.assemblies += 1);
    let n = 0;
    for (const { key } of tiles) {
      const tile = this.tiles.get(key)!;
      tile.used = stamp;
      const trees = tile.trees;
      for (let t = 0; t < trees.length && n < CAPACITY; t += STRIDE) {
        const x = trees[t]!, z = trees[t + 2]!;
        const dist = Math.hypot(x - cx, z - cz);
        if (dist > reach) continue;
        if (clear.some((p) => Math.hypot(x - p.x, z - p.z) < CLEARING)) continue;
        // Trees thin out to nothing at the edge of the planted disc, so it does not end in a line.
        const fade = Math.min(1, (reach - dist) / (reach * 0.3));
        const tall = trees[t + 3]! * fade, wide = trees[t + 4]! * fade;
        const o = n * 16;
        array[o] = wide; array[o + 1] = 0; array[o + 2] = 0; array[o + 3] = 0;
        array[o + 4] = 0; array[o + 5] = tall; array[o + 6] = 0; array[o + 7] = 0;
        array[o + 8] = 0; array[o + 9] = 0; array[o + 10] = wide; array[o + 11] = 0;
        array[o + 12] = x; array[o + 13] = trees[t + 1]! - tall * 0.04; array[o + 14] = z; array[o + 15] = 1;
        colors[n * 3] = trees[t + 5]!; colors[n * 3 + 1] = trees[t + 6]!; colors[n * 3 + 2] = trees[t + 7]!;
        n += 1;
      }
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    // Only the trees laid are sent to the GPU.
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, Math.max(1, n) * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.clearUpdateRanges();
    this.mesh.instanceColor!.addUpdateRange(0, Math.max(1, n) * 3);
    this.mesh.instanceColor!.needsUpdate = true;
    if (this.tiles.size > KEEP) {
      const old = [...this.tiles].sort((a, b) => a[1].used - b[1].used);
      for (let k = 0; k < old.length - KEEP * 0.75; k += 1) this.tiles.delete(old[k]![0]);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.tiles.clear();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
