import { BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, Group, InstancedMesh, MeshStandardMaterial } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { frameU, frameV, worldX, worldZ, type CameraState } from './worldCamera';

// Trees for the close views of the campaign world: one instanced mesh of low pines, laid on the wooded hills round the point
// the camera looks at. The map is drawn at a stylised scale (its camps are kilometres across), so the trees are too: big
// enough to read as a forest from a low camera, in three size levels so that a nearer camera sees more and smaller ones.
// Nothing is planted farther out than the camera can use, and the terrain's own colour carries the forest from afar.

/** Trees at most; a level fills the square round the target that this many cells make. */
const CAPACITY = 30000;
/** Cell size and tree height for each level, in frame units, and the camera distance each serves up to. */
const LEVELS = [
  { cell: 0.0006, height: 0.00048, until: 0.055 },
  { cell: 0.0012, height: 0.00095, until: 0.13 },
  { cell: 0.0024, height: 0.0019, until: 0.26 },
] as const;
/** Hysteresis, so a camera resting on a boundary does not flip between two levels. */
const HOLD = 1.12;

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

/** A pine of two stacked cones on a trunk, one unit tall, coloured by vertex: darker below, lighter at the tips. */
function pine(): BufferGeometry {
  const parts = [
    { g: new CylinderGeometry(0.05, 0.07, 0.22, 5).translate(0, 0.11, 0), low: '#4a3826', high: '#5a4630' },
    { g: new ConeGeometry(0.34, 0.55, 6).translate(0, 0.42, 0), low: '#244d30', high: '#2f6039' },
    { g: new ConeGeometry(0.24, 0.5, 6).translate(0, 0.72, 0), low: '#2b5a36', high: '#3b7443' },
  ];
  const geometries = parts.map(({ g, low, high }) => {
    const lo = new Color(low), hi = new Color(high);
    g.computeBoundingBox();
    const box = g.boundingBox!;
    const position = g.getAttribute('position');
    const colors: number[] = [];
    for (let i = 0; i < position.count; i += 1) {
      const t = (position.getY(i) - box.min.y) / Math.max(1e-6, box.max.y - box.min.y);
      const c = lo.clone().lerp(hi, t);
      colors.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return g.toNonIndexed();
  });
  return mergeGeometries(geometries)!;
}

/** Trees round the camera's target. `ground` is the terrain height in frame units at a frame point, `perMetre` its frame units per metre. */
export class TreeLayer {
  readonly group = new Group();
  private readonly mesh: InstancedMesh;
  private readonly material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  private readonly geometry = pine();
  private clearings: { u: number; v: number }[] = [];
  private level = -1;
  private anchor = { u: -9, v: -9 };
  private builtAt = 0;
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
    this.level = -1;
  }

  /** Re-plants when the camera has moved far enough or crossed to another level. Returns whether the trees changed. */
  update(cam: CameraState): boolean {
    if (this.disposed) return false;
    const want = this.levelFor(cam.distance);
    if (want < 0) {
      const changed = this.mesh.visible;
      this.mesh.visible = false;
      this.level = -1;
      return changed;
    }
    const { cell } = LEVELS[want]!;
    const reach = (Math.sqrt(CAPACITY) * cell) / 2;
    const moved = Math.hypot(cam.u - this.anchor.u, (cam.v - this.anchor.v) * 0.5);
    const now = performance.now();
    if (want === this.level && (moved < reach * 0.22 || now - this.builtAt < 140)) return false;
    this.level = want;
    this.anchor = { u: cam.u, v: cam.v };
    this.builtAt = now;
    this.plant(want, cam.u, cam.v);
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

  private plant(level: number, cu: number, cv: number) {
    const { cell, height } = LEVELS[level]!;
    const reach = (Math.sqrt(CAPACITY) * cell) / 2;
    const array = this.mesh.instanceMatrix.array as Float32Array;
    const colors = this.mesh.instanceColor!.array as Float32Array;
    const cx = worldX(cu), cz = worldZ(cv);
    const i0 = Math.floor((cx - reach) / cell), i1 = Math.floor((cx + reach) / cell);
    const j0 = Math.floor((cz - reach) / cell), j1 = Math.floor((cz + reach) / cell);
    const clear = this.clearings.map((p) => ({ x: worldX(p.u), z: worldZ(p.v) }));
    const clearRadius = 0.0175;
    let n = 0;
    for (let j = j0; j <= j1 && n < CAPACITY; j += 1) {
      for (let i = i0; i <= i1 && n < CAPACITY; i += 1) {
        // Where in the cell the tree stands, and whether this cell has one at all: a density that thins towards the open ground.
        const jx = hash(i, j, level * 7 + 1), jz = hash(i, j, level * 7 + 2);
        const x = (i + 0.15 + 0.7 * jx) * cell, z = (j + 0.15 + 0.7 * jz) * cell;
        const dist = Math.hypot(x - cx, z - cz);
        if (dist > reach) continue;
        const u = frameU(x), v = frameV(z);
        const e = this.ground(u, v);
        if (e <= 0) continue;
        const metres = e / this.perMetre;
        if (metres < 8 || metres > 950) continue;
        const slope = Math.abs(this.ground(u + cell * 0.5, v) - this.ground(u - cell * 0.5, v)) / (cell * 0.5 * 2) + Math.abs(this.ground(u, v + cell * 0.5) - this.ground(u, v - cell * 0.5)) / (cell * 0.5 * 2);
        if (slope > 0.9) continue;
        // Woods on the high and rough ground, open fields on the low and flat; patches by two scales of noise.
        const patch = noise(x * 90, z * 90, 3) * 0.6 + noise(x * 380, z * 380, 5) * 0.4;
        const want = Math.min(1, Math.max(0, (patch - 0.34) * 2.2)) * Math.min(1, 0.35 + metres / 90);
        if (hash(i, j, level * 7 + 3) > want) continue;
        if (clear.some((p) => Math.hypot(x - p.x, z - p.z) < clearRadius)) continue;
        // Trees thin out to nothing at the edge of the planted square, so it does not end in a line.
        const fade = Math.min(1, (reach - dist) / (reach * 0.3));
        const size = height * (0.75 + 0.55 * hash(i, j, level * 7 + 4)) * fade;
        const angle = hash(i, j, level * 7 + 5) * Math.PI * 2;
        const c = Math.cos(angle) * size, s = Math.sin(angle) * size;
        const o = n * 16;
        array[o] = c; array[o + 1] = 0; array[o + 2] = -s; array[o + 3] = 0;
        array[o + 4] = 0; array[o + 5] = size; array[o + 6] = 0; array[o + 7] = 0;
        array[o + 8] = s; array[o + 9] = 0; array[o + 10] = c; array[o + 11] = 0;
        array[o + 12] = x; array[o + 13] = e - size * 0.04; array[o + 14] = z; array[o + 15] = 1;
        const tint = 0.78 + 0.4 * hash(i, j, level * 7 + 6);
        colors[n * 3] = tint * (0.95 + 0.1 * jx); colors[n * 3 + 1] = tint; colors[n * 3 + 2] = tint * (0.95 + 0.1 * jz);
        n += 1;
      }
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
