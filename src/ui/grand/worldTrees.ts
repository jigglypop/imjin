import { Color, Group, InstancedMesh, MeshBasicNodeMaterial, type BufferGeometry, type Material, type Texture } from 'three/webgpu';
import { MODEL_METRE } from './hero/site';
import type { Cover } from './landCover';
import { FINE_SIZE, rockMaterial, treeMaterial, treeShapes } from './treeModels';
import { eyeOf, frameU, frameV, worldX, worldZ, type CameraState } from './worldCamera';

// Trees and rocks for the close views of the campaign world, laid on the wooded hills round the point the camera looks
// at: broadleaf trees, firs on the high ground and the red pines of the coasts, and outcrops of rock on the crags
// (treeModels.ts), one instanced mesh a kind at each of two details. They stand where the land's look draws woods and
// crags (landLook.ts `coverAt`), so the forest and the ground under it agree, at about the size of the hero camps' trees.
// In three levels by the camera's distance: a nearer camera sees smaller cells; at every level the trees that stand
// large to the eye are drawn with the finely built shapes, the rest with the light ones. Nothing is planted farther out than the
// camera can use; there the ground's own canopy carries the forest, and the planted disc thins out into it tree by tree
// rather than shrinking, so its edge reads as the wood's own. Where trees stand is worked out a tile of cells at a time
// and kept, within a few milliseconds a frame, so panning only plants the tiles that come into reach.

/** Trees (and rocks) at most of each kind, broadleaf, fir, rock, red pine: of the light shapes, and of the fine ones. */
const CAPACITY = [7000, 5000, 1500, 5000] as const;
const CAPACITY_NEAR = [1500, 600, 300, 900] as const;
/** Cell size and tree height for each level, in frame units, and the camera distance each serves up to. */
const LEVELS = [
  { cell: 0.0011, height: 0.0022, until: 0.055 },
  { cell: 0.0019, height: 0.003, until: 0.13 },
  { cell: 0.0038, height: 0.0048, until: 0.26 },
] as const;
/** Hysteresis, so a camera resting on a boundary does not flip between two levels. */
const HOLD = 1.12;
/** The planted disc's radius in cells of its level, and the outer share of it over which the trees thin out. */
const REACH = 72;
const THIN = 0.35;
/** Cells along a tile's side. */
const TILE = 16;
/** Milliseconds a frame may spend on the trees: working out new tiles and laying the trees of the ready ones. */
const BUDGET_MS = 3;
/** Tiles kept for reuse; the ones used longest ago go first. */
const KEEP = 900;
/** Floats kept per tree: x, ground height, z, height, width, the tint's red, green and blue, its kind and its thinning rank. */
const STRIDE = 10;
const ROCK = 2;
/** How far the crowns sway in the wind, frame units (a tenth of a metre of the model). */
const SWAY = 0.12 * MODEL_METRE;

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

interface Tile {
  /** STRIDE floats per tree. */
  trees: Float32Array;
  /** The assembly that last used it. */
  used: number;
}

/**
 * Trees round the camera's target. `ground` is the terrain height in frame units at a frame point, `perMetre` its frame
 * units per metre; `cover` the land's country at a point (without it, woods come from noise on the hills); `details` the
 * land's ground textures (grass, rock, sand, woodland), whose woodland works the crowns and whose rock the boulders
 * (without them they are plain).
 */
export class TreeLayer {
  readonly group = new Group();
  /** One instanced mesh a kind (broadleaf, fir, rock, red pine) of the fine shapes, and one of the light shapes. */
  readonly near: InstancedMesh[];
  readonly far: InstancedMesh[];
  private readonly materials: Material[];
  private readonly shapes: BufferGeometry[];
  private clearings: { u: number; v: number; r: number }[] = [];
  private readonly tiles = new Map<number, Tile>();
  private level = -1;
  /** Where the trees on show were laid round, in world x and z, the eye they were sorted by, and whether every tile they need was ready. */
  private anchor = { x: Number.NaN, z: Number.NaN };
  private eye: [number, number, number] = [Number.NaN, 0, 0];
  private complete = false;
  private assemblies = 0;
  /** How long laying the trees took the last time (ms): the planting leaves it room within the budget. */
  private layMs = 0;
  private disposed = false;

  constructor(
    private readonly ground: (u: number, v: number) => number,
    private readonly perMetre: number,
    private readonly cover?: (u: number, v: number) => Cover,
    details?: readonly Texture[],
  ) {
    const trees = details ? treeMaterial(details[3]!, SWAY) : new MeshBasicNodeMaterial({ vertexColors: true });
    const rocks = details ? rockMaterial(details[1]!) : trees;
    this.materials = [...new Set([trees, rocks])];
    const make = (shapes: BufferGeometry[], capacity: readonly number[]) => shapes.map((shape, kind) => {
      const mesh = new InstancedMesh(shape, kind === ROCK ? rocks : trees, capacity[kind]!);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.visible = false;
      // The colours of the instances are a tint on the shapes' own; allocate them once.
      mesh.setColorAt(0, new Color(1, 1, 1));
      this.group.add(mesh);
      return mesh;
    });
    const near = treeShapes('near'), far = treeShapes('far');
    this.shapes = [...near, ...far];
    this.near = make(near, CAPACITY_NEAR);
    this.far = make(far, CAPACITY);
  }

  /** Every mesh, the fine ones first. */
  get meshes() {
    return [...this.near, ...this.far];
  }

  /** All the trees laid, of every kind. */
  get count() {
    return this.meshes.reduce((n, m) => n + m.count, 0);
  }

  /**
   * Where the settlements stand: no tree within `r` (world units) of a frame point (u, v), so a camp or a town reads and
   * a small one is not left in a wide clearing.
   */
  setClearings(points: { u: number; v: number; r: number }[]) {
    this.clearings = points;
    this.complete = false;
    this.anchor = { x: Number.NaN, z: Number.NaN };
  }

  /**
   * Lays the trees round the camera's target: works out the tiles that have come into reach within a few milliseconds and
   * re-lays the trees when the target has moved, a level changed or, at the nearest level, the eye has moved enough to
   * change which trees are near it. Returns whether the trees changed or still have work to do, so the caller draws
   * another frame while it is true.
   */
  update(cam: CameraState): boolean {
    if (this.disposed) return false;
    const want = this.levelFor(cam.distance);
    if (want < 0) {
      const changed = this.meshes.some((m) => m.visible);
      for (const m of this.meshes) m.visible = false;
      this.level = -1;
      this.anchor = { x: Number.NaN, z: Number.NaN };
      return changed;
    }
    const { cell } = LEVELS[want]!;
    const reach = REACH * cell;
    const x = worldX(cam.u), z = worldZ(cam.v);
    const moved = Math.hypot(x - this.anchor.x, z - this.anchor.z);
    const eye = eyeOf(cam);
    const turned = !(Math.hypot(eye[0] - this.eye[0], eye[1] - this.eye[1], eye[2] - this.eye[2]) < reach * 0.06);
    if (want === this.level && this.complete && moved < reach * 0.08 && !turned) return false;
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
    this.eye = eye;
    const laying = performance.now();
    this.assemble(needed.slice(0, ready), reach, x, z, eye);
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

  /** How wooded a frame point is (0..1) and how much of a crag, by the land's cover or, without it, by noise on the hills. */
  private woodAt(x: number, z: number, u: number, v: number, metres: number) {
    if (this.cover) {
      const c = this.cover(u, v);
      // Woods where the land draws them, a few groves on the open ground, none on fields, sand or bare rock.
      const open = Math.max(0, 1 - c.wood - c.rock - c.sand) * (1 - c.farm);
      const grove = noise(x * 700, z * 700, 9);
      return { wood: Math.min(1, c.wood * 1.05 + open * Math.max(0, grove - 0.55) * 0.9), crag: c.crag, metres: c.metres, wander: c.wander };
    }
    // Woods on the high and rough ground, open fields on the low and flat; patches by two scales of noise.
    const patch = noise(x * 90, z * 90, 3) * 0.6 + noise(x * 380, z * 380, 5) * 0.4;
    const wood = Math.min(1, Math.max(0, (patch - 0.34) * 2.2)) * (metres < 8 || metres > 950 ? 0 : Math.min(1, 0.35 + metres / 90));
    return { wood, crag: 0, metres, wander: 0 };
  }

  /** Where the trees and rocks of one tile stand: on dry, not too steep ground, where the land is wooded or a crag. */
  private plant(level: number, ti: number, tj: number) {
    const { cell, height } = LEVELS[level]!;
    const out: number[] = [];
    for (let j = tj * TILE; j < (tj + 1) * TILE; j += 1) {
      for (let i = ti * TILE; i < (ti + 1) * TILE; i += 1) {
        // Where in the cell the tree stands, and whether this cell has one at all.
        const jx = hash(i, j, level * 7 + 1), jz = hash(i, j, level * 7 + 2);
        const x = (i + 0.15 + 0.7 * jx) * cell, z = (j + 0.15 + 0.7 * jz) * cell;
        const roll = hash(i, j, level * 7 + 3);
        // Most cells are ruled out by the roll before the ground is read: no wood is denser than one tree a cell.
        if (!this.cover && noise(x * 90, z * 90, 3) * 0.6 + noise(x * 380, z * 380, 5) * 0.4 < 0.34) continue;
        const u = frameU(x), v = frameV(z);
        const e = this.ground(u, v);
        if (e <= 0) continue;
        const metres = e / this.perMetre;
        const { wood, crag, wander, metres: high } = this.woodAt(x, z, u, v, metres);
        const rank = hash(i, j, level * 7 + 7);
        if (crag > 0.45 && roll < crag * 0.22) {
          // An outcrop: two or three rocks' worth in one, low and wide.
          const size = height * (0.55 + 0.6 * hash(i, j, level * 7 + 4));
          const grey = 0.85 + 0.25 * hash(i, j, level * 7 + 6);
          out.push(x, e, z, size * 0.7, size * 1.3, grey, grey, grey * 0.97, ROCK, rank);
          continue;
        }
        if (roll > wood) continue;
        const slope = (Math.abs(this.ground(u + cell, v) - e) + Math.abs(this.ground(u, v + cell) - e)) / cell;
        if (slope > 1.2) continue;
        // Firs on the high ground, the coasts' red pines low down among the broadleaf woods.
        const pick = hash(i, j, level * 7 + 8);
        const fir = smooth(250, 700, high + wander * 300);
        const kind = pick < fir * 0.85 ? 1 : pick < fir * 0.85 + (1 - fir) * 0.38 ? 3 : 0;
        const size = height * (0.75 + 0.55 * hash(i, j, level * 7 + 4));
        // Each tree its own shade and a little warmer or cooler, so a wood is not one green.
        const tint = 0.84 + 0.3 * hash(i, j, level * 7 + 6), warm = hash(i, j, level * 7 + 9) - 0.5;
        out.push(x, e, z, size, size * (0.85 + 0.3 * hash(i, j, level * 7 + 5)), tint * (1 + warm * 0.16), tint * (1 + warm * 0.04), tint * (1 - warm * 0.14), kind, rank);
      }
    }
    return Float32Array.from(out);
  }

  /**
   * Lays the trees of the ready tiles, nearest tile first, thinning out tree by tree towards the disc's edge, those that
   * stand large to the `eye` in the fine shapes.
   */
  private assemble(tiles: { key: number }[], reach: number, cx: number, cz: number, eye: [number, number, number]) {
    const sets = [this.near, this.far].map((meshes) => ({ meshes, counts: meshes.map(() => 0), matrices: meshes.map((m) => m.instanceMatrix.array as Float32Array), colours: meshes.map((m) => m.instanceColor!.array as Float32Array) }));
    const clear = this.clearings.map((p) => ({ x: worldX(p.u), z: worldZ(p.v), r: p.r })).filter((p) => Math.hypot(p.x - cx, p.z - cz) < reach + p.r);
    const stamp = (this.assemblies += 1);
    for (const { key } of tiles) {
      const tile = this.tiles.get(key)!;
      tile.used = stamp;
      const trees = tile.trees;
      for (let t = 0; t < trees.length; t += STRIDE) {
        const kind = trees[t + 8]!;
        const x = trees[t]!, y = trees[t + 1]!, z = trees[t + 2]!;
        const dist = Math.hypot(x - cx, z - cz);
        // Fewer and fewer trees towards the edge of the planted disc, so it ends as a wood thins out, not in a line.
        if (dist > reach || trees[t + 9]! > (reach - dist) / (reach * THIN)) continue;
        if (clear.some((p) => Math.hypot(x - p.x, z - p.z) < p.r)) continue;
        const tall = trees[t + 3]!, wide = trees[t + 4]!;
        // Large to the eye in the fine shapes while they have room, else in the light ones.
        let set = sets[1]!;
        if (tall > FINE_SIZE * Math.hypot(x - eye[0], y - eye[1], z - eye[2]) && sets[0]!.counts[kind]! < CAPACITY_NEAR[kind]!) set = sets[0]!;
        const n = set.counts[kind]!;
        if (n >= set.meshes[kind]!.instanceMatrix.count) continue;
        const array = set.matrices[kind]!, o = n * 16;
        // Turned about its trunk by where it stands, so neighbours do not show the same side.
        const turn = (x * 9187.3 + z * 7331.1) % (Math.PI * 2), c = Math.cos(turn) * wide, s = Math.sin(turn) * wide;
        array[o] = c; array[o + 1] = 0; array[o + 2] = -s; array[o + 3] = 0;
        array[o + 4] = 0; array[o + 5] = tall; array[o + 6] = 0; array[o + 7] = 0;
        array[o + 8] = s; array[o + 9] = 0; array[o + 10] = c; array[o + 11] = 0;
        array[o + 12] = x; array[o + 13] = y - tall * 0.04; array[o + 14] = z; array[o + 15] = 1;
        const colour = set.colours[kind]!;
        colour[n * 3] = trees[t + 5]!; colour[n * 3 + 1] = trees[t + 6]!; colour[n * 3 + 2] = trees[t + 7]!;
        set.counts[kind] = n + 1;
      }
    }
    for (const { meshes, counts } of sets) meshes.forEach((mesh, kind) => {
      const n = counts[kind]!;
      mesh.count = n;
      mesh.visible = n > 0;
      // Only the trees laid are sent to the GPU.
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, Math.max(1, n) * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.clearUpdateRanges();
      mesh.instanceColor!.addUpdateRange(0, Math.max(1, n) * 3);
      mesh.instanceColor!.needsUpdate = true;
    });
    if (this.tiles.size > KEEP) {
      const old = [...this.tiles].sort((a, b) => a[1].used - b[1].used);
      for (let k = 0; k < old.length - KEEP * 0.75; k += 1) this.tiles.delete(old[k]![0]);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.tiles.clear();
    for (const m of this.meshes) m.dispose();
    for (const g of this.shapes) g.dispose();
    for (const m of this.materials) m.dispose();
    this.group.removeFromParent();
  }
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
