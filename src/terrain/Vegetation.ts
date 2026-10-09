import {
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Box3,
  DynamicDrawUsage,
  Frustum,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  Vector2,
  Vector3,
  type Camera,
} from 'three/webgpu';
import { Fn, abs, cos, float, hash, max, mix, normalGeometry, normalLocal, positionGeometry, sin, smoothstep, texture, uniform, uint, varying, vec2, vec3, attribute, time } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Terrain } from './Terrain';
import type { VegetationQuality } from '../game/quality';

function tag(geo: BufferGeometry, part: number, ao: (y: number) => number) {
  const g = geo.toNonIndexed();
  const pos = g.getAttribute('position');
  const n = pos.count;
  const parts = new Float32Array(n);
  const aos = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    parts[i] = part;
    aos[i] = ao(pos.getY(i));
  }
  g.setAttribute('part', new Float32BufferAttribute(parts, 1));
  g.setAttribute('ao', new Float32BufferAttribute(aos, 1));
  g.deleteAttribute('uv');
  return g;
}

function clump(r: number, x: number, y: number, z: number, flat: number, detail: number) {
  const g = new IcosahedronGeometry(r, detail);
  g.scale(1, flat, 1);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i += 1) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const n = 1 + Math.sin(px * 3.1 + pz * 2.3) * 0.12 + Math.cos(py * 4.7) * 0.08;
    pos.setXYZ(i, px * n, py * n, pz * n);
  }
  g.computeVertexNormals();
  const nrm = g.getAttribute('normal');
  for (let i = 0; i < pos.count; i += 1) {
    const v = new Vector3(pos.getX(i), pos.getY(i) / flat, pos.getZ(i)).normalize();
    nrm.setXYZ(i, v.x, v.y * 0.8 + 0.2, v.z);
  }
  g.translate(x, y, z);
  return tag(g, 1, (py) => Math.max(0.35, Math.min(1, (py - (y - r * flat)) / (2 * r * flat))));
}

function farTree() {
  return mergeGeometries([clump(4.4, 0, 8.5, 0, 0.7, 0)])!;
}

function pine(detail: 0 | 1, lite = false) {
  // Lite variants trade crown detail for vertices. A lite tree is about half the cost of a full one at distance.
  const trunk = tag(new CylinderGeometry(0.16, 0.3, 10, lite ? 4 : detail ? 3 : 5, 1, true).translate(0, 5, 0), 0, () => 0.8);
  const clumps = lite
    ? detail
      ? [clump(2.8, 0, 11.3, 0, 0.55, 0)]
      : [clump(3.1, 0, 12.6, 0, 0.5, 0), clump(2.5, 1.7, 10.6, 0.7, 0.55, 0), clump(2.2, -1.6, 10.1, -0.9, 0.55, 0)]
    : detail
      ? [clump(3.4, 0, 11.8, 0, 0.55, 0), clump(2.6, 0.6, 9.6, -0.5, 0.6, 0)]
      : [clump(3.1, 0, 12.6, 0, 0.5, 1), clump(2.5, 1.7, 10.6, 0.7, 0.55, 0), clump(2.4, -1.6, 10.1, -0.9, 0.55, 0), clump(2.1, 0.7, 8.7, -1.7, 0.6, 0), clump(2.0, -0.6, 14.2, 0.8, 0.5, 0)];
  return mergeGeometries([trunk, ...clumps])!;
}

/** An instanced draw of `base`. The vertices are shared with the base geometry, so every ring variant costs no extra copy. */
function instancedGeometry(base: BufferGeometry, cells: InstancedBufferAttribute) {
  const geo = new InstancedBufferGeometry();
  geo.index = base.index;
  for (const [name, attr] of Object.entries(base.attributes)) geo.setAttribute(name, attr);
  geo.setAttribute('treeCell', cells);
  geo.instanceCount = 1;
  return geo;
}

/** Cells per side of a block. A block is tested against the terrain once and against the camera every frame. */
const BLOCK = 16;
/** A tree throws its shadow this far (m) from where it stands, and a crown leans out a little: blocks that near the view still draw. */
const SHADOW_REACH = 60;
const TREE_TOP = 36;
const MAX_BLOCKS = 3000;

type Block = { cells: Int16Array; top: number };

type Ring = {
  cell: number;
  grid: number;
  inner: number;
  center: ReturnType<typeof uniform>;
  mesh: Mesh;
  full: InstancedBufferGeometry;
  lite: InstancedBufferGeometry;
  /** The (x, z) cell of every tree slot to draw, a prefix of this array. */
  cells: InstancedBufferAttribute;
  blocks: Map<number, Block>;
  /** Camera and centre the instance list was built for. */
  built: { cx: number; cz: number; view: Float32Array } | null;
};

export class Vegetation {
  readonly group = new Group();
  private readonly rings: Ring[] = [];
  private readonly tmp = new Vector3();
  private readonly frustum = new Frustum();
  private readonly viewProj = new Matrix4();
  private readonly toTerrain = new Matrix4();
  private readonly box = new Box3();

  constructor(
    private readonly terrain: Terrain,
    quality: VegetationQuality,
  ) {
    // Each ring covers a square of `grid` cells. Its inner edge is the outer edge of the ring before it, so the rings
    // tile outward without gaps. Fewer cells on mobile shrink the forest radius, and fog hides most of the difference.
    const [g0, g1, g2] = quality.grids;
    const c0 = 7.5;
    const c1 = 13;
    const c2 = 19;
    const edge0 = (c0 * g0) / 2;
    const edge1 = (c1 * g1) / 2;
    this.rings.push(this.ring({ full: pine(0), lite: pine(0, true) }, c0, g0, 0, quality.shadows));
    this.rings.push(this.ring({ full: pine(1), lite: pine(1, true) }, c1, g1, edge0, false));
    this.rings.push(this.ring({ full: farTree(), lite: farTree() }, c2, g2, edge1, false));
  }

  /** Frees both crown geometries and the material of every ring. */
  dispose() {
    for (const r of this.rings) {
      r.full.dispose();
      r.lite.dispose();
      (r.mesh.material as MeshStandardNodeMaterial).dispose();
    }
    this.group.removeFromParent();
  }

  /** Full and lite crown geometry for the level, switched at run time. */
  setLite(lite: boolean) {
    for (const r of this.rings) r.mesh.geometry = lite ? r.lite : r.full;
  }

  private ring(variants: { full: BufferGeometry; lite: BufferGeometry }, cell: number, grid: number, inner: number, shadows: boolean): Ring {
    // Only cells that can hold a tree are drawn. The cells come from the CPU, so the GPU does not run the vertex
    // shader of a whole crown for every cell of the grid, most of which lie in the sea or outside the screen.
    const cells = new InstancedBufferAttribute(new Float32Array(grid * grid * 2), 2);
    cells.setUsage(DynamicDrawUsage);
    const full = instancedGeometry(variants.full, cells);
    const lite = instancedGeometry(variants.lite, cells);
    const center = uniform(new Vector2());
    const t = this.terrain;
    const size = t.spec.size;
    const m = new MeshStandardNodeMaterial();
    m.roughness = 0.88;
    m.metalness = 0;
    const treeCell: any = attribute('treeCell', 'vec2');
    const cellX = treeCell.x;
    const cellZ = treeCell.y;
    const seed = uint(cellX.add(65536)).mul(uint(73856093)).bitXor(uint(cellZ.add(65536)).mul(uint(19349663)));
    const h1 = hash(seed);
    const h2 = hash(seed.add(uint(1)));
    const h3 = hash(seed.add(uint(2)));
    const h4 = hash(seed.add(uint(3)));
    const px: any = cellX.add(h1).mul(cell);
    const pz: any = cellZ.add(h2).mul(cell);
    const uvT = vec2(px, pz).div(size).add(0.5);
    const maskV: any = texture(t.maskTexture, uvT).level(float(0));
    const ground: any = texture(t.heightTexture, uvT).level(float(0)).r;
    const camX = (center as any).x.mul(cell);
    const camZ = (center as any).y.mul(cell);
    const d = max(abs(px.sub(camX)), abs(pz.sub(camZ)));
    const outer = (grid * cell) / 2;
    const density = maskV.r.mul(inner > 0 ? 0.82 : 1);
    const keepDensity = density.greaterThan(h3.mul(0.95).add(0.03));
    const keepOuter = d.lessThan(h4.mul(0.18).add(0.82).mul(outer));
    const keepInner = inner > 0 ? d.greaterThan(h4.mul(0.2).add(0.88).mul(inner)) : float(1).greaterThan(0);
    const keep = keepDensity.and(keepOuter).and(keepInner).and(ground.greaterThan(2.5));
    const s: any = keep.select(mix(float(0.75), float(1.3), h4).mul(inner > 0 ? (cell > 15 ? 2.1 : 1.45) : 1), float(0));
    const rot = h1.mul(6.2831);
    const c = cos(rot);
    const sn = sin(rot);
    const part = attribute('part', 'float');
    const ao = attribute('ao', 'float');
    const pg: any = positionGeometry;
    const sway: any = sin(time.mul(1.3).add(px.mul(0.05)).add(h2.mul(6.28))).mul(0.18).mul(pg.y.div(14).pow(2)).mul(part);
    m.positionNode = Fn(() => {
      normalLocal.assign(vec3(normalGeometry.x.mul(c).sub(normalGeometry.z.mul(sn)), normalGeometry.y, normalGeometry.x.mul(sn).add(normalGeometry.z.mul(c))));
      const lx = pg.x.mul(c).sub(pg.z.mul(sn)).mul(s);
      const lz = pg.x.mul(sn).add(pg.z.mul(c)).mul(s);
      return vec3(px.add(lx).add(sway), ground.sub(0.5).add(pg.y.mul(s)), pz.add(lz).add(sway.mul(0.6)));
    })();
    const tint = varying(h3.mul(0.6).add(h2.mul(0.4)));
    const autumnPick = varying(smoothstep(0.62, 0.7, h1));
    const vPart = varying(part);
    const vAo = varying(ao);
    const pineCol = mix(vec3(0.022, 0.05, 0.02), vec3(0.045, 0.075, 0.026), tint);
    const broadAutumn = mix(vec3(0.28, 0.1, 0.02), vec3(0.32, 0.22, 0.03), tint);
    const winterBare = mix(vec3(0.07, 0.055, 0.04), vec3(0.09, 0.075, 0.05), tint);
    const seasonal = mix(mix(pineCol, broadAutumn, smoothstep(0.2, 0.7, t.season).mul(autumnPick)), winterBare, smoothstep(0.8, 1.0, t.season).mul(autumnPick));
    const trunk = vec3(0.11, 0.055, 0.032);
    m.colorNode = mix(trunk, seasonal, vPart).mul(vAo.mul(0.7).add(0.3));
    const mesh = new Mesh(full, m);
    mesh.frustumCulled = false;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    this.group.add(mesh);
    return { cell, grid, inner, center, mesh, full, lite, cells, blocks: new Map(), built: null };
  }

  update(camera: Camera) {
    // The renderer refreshes the camera's matrices at draw time, a frame behind the pose set this frame.
    camera.updateMatrixWorld();
    const cam = camera.position;
    camera.getWorldDirection(this.tmp);
    const fx = this.tmp.x;
    const fz = this.tmp.z;
    const len = Math.hypot(fx, fz) || 1;
    const lead = Math.min(700, Math.max(0, cam.y * 1.4));
    const wx = cam.x + (fx / len) * lead;
    const wz = cam.z + (fz / len) * lead;
    const s = this.terrain.toScenario(wx, wz);
    let view: Frustum | null = null;
    for (const r of this.rings) {
      const cx = Math.floor(s.x / r.cell);
      const cz = Math.floor(s.z / r.cell);
      (r.center.value as Vector2).set(cx, cz);
      if (r.built && r.built.cx === cx && r.built.cz === cz && this.sameView(r.built.view, camera)) continue;
      view ??= this.viewFrustum(camera);
      this.gather(r, cx, cz, view, camera);
    }
  }

  private sameView(view: Float32Array, camera: Camera) {
    const m = camera.matrixWorld.elements;
    const p = camera.projectionMatrix.elements;
    for (let i = 0; i < 16; i += 1) if (view[i] !== m[i] || view[16 + i] !== p[i]) return false;
    return true;
  }

  /** The camera frustum in the terrain's own space, where the trees' cells are laid out. */
  private viewFrustum(camera: Camera) {
    this.toTerrain.copy(camera.matrixWorld).invert().multiply(this.terrain.group.matrixWorld);
    this.viewProj.multiplyMatrices(camera.projectionMatrix, this.toTerrain);
    return this.frustum.setFromProjectionMatrix(this.viewProj);
  }

  /**
   * Lists the cells of a ring that can hold a tree and are near the screen. The shader still decides, cell by cell,
   * whether a tree stands there and how big it is, so the picture is that of drawing the whole grid.
   */
  private gather(r: Ring, cx: number, cz: number, view: Frustum, camera: Camera) {
    const half = r.grid / 2;
    const x0 = cx - half;
    const z0 = cz - half;
    const out = r.cells.array as Float32Array;
    // A cell nearer than the previous ring's edge is that ring's.
    const skip = r.inner > 0 ? (0.88 * r.inner) / r.cell : 0;
    let n = 0;
    for (let bz = Math.floor(z0 / BLOCK); bz <= Math.floor((z0 + r.grid - 1) / BLOCK); bz += 1) {
      for (let bx = Math.floor(x0 / BLOCK); bx <= Math.floor((x0 + r.grid - 1) / BLOCK); bx += 1) {
        const block = this.block(r, bx, bz);
        if (block.cells.length === 0) continue;
        this.box.min.set((bx * BLOCK) * r.cell - SHADOW_REACH, -4, (bz * BLOCK) * r.cell - SHADOW_REACH);
        this.box.max.set(((bx + 1) * BLOCK) * r.cell + SHADOW_REACH, block.top + TREE_TOP, ((bz + 1) * BLOCK) * r.cell + SHADOW_REACH);
        if (!view.intersectsBox(this.box)) continue;
        const list = block.cells;
        for (let k = 0; k < list.length; k += 2) {
          const x = list[k]!;
          const z = list[k + 1]!;
          if (x < x0 || x >= x0 + r.grid || z < z0 || z >= z0 + r.grid) continue;
          if (skip > 0 && Math.max(Math.abs(x - cx), Math.abs(x + 1 - cx), Math.abs(z - cz), Math.abs(z + 1 - cz)) < skip) continue;
          out[n * 2] = x;
          out[n * 2 + 1] = z;
          n += 1;
        }
      }
    }
    // An empty list still draws one slot, a cell that holds no tree, so the pipeline exists before the first tree does.
    if (n === 0) {
      out[0] = 0;
      out[1] = 0;
      n = 1;
    }
    r.full.instanceCount = n;
    r.lite.instanceCount = n;
    r.cells.clearUpdateRanges();
    r.cells.addUpdateRange(0, n * 2);
    r.cells.needsUpdate = true;
    const view16 = r.built?.view ?? new Float32Array(32);
    view16.set(camera.matrixWorld.elements, 0);
    view16.set(camera.projectionMatrix.elements, 16);
    r.built = { cx, cz, view: view16 };
  }

  /** The cells of a block where the ground is land and the forest mask is not empty: the only places a tree can stand. */
  private block(r: Ring, bx: number, bz: number) {
    const key = (bx + 4096) * 8192 + (bz + 4096);
    let block = r.blocks.get(key);
    if (block) return block;
    if (r.blocks.size >= MAX_BLOCKS) r.blocks.clear();
    const { size, res } = this.terrain.spec;
    const heights = this.terrain.heights;
    const mask = this.terrain.mask;
    const density = r.inner > 0 ? 0.82 : 1;
    const toTexel = (v: number) => ((v + size / 2) / size) * res - 0.5;
    const clamp = (i: number) => Math.max(0, Math.min(res - 1, i));
    const found: number[] = [];
    let top = 0;
    for (let z = bz * BLOCK; z < (bz + 1) * BLOCK; z += 1) {
      const j0 = clamp(Math.floor(toTexel(z * r.cell)));
      const j1 = clamp(Math.floor(toTexel((z + 1) * r.cell)) + 1);
      for (let x = bx * BLOCK; x < (bx + 1) * BLOCK; x += 1) {
        const i0 = clamp(Math.floor(toTexel(x * r.cell)));
        const i1 = clamp(Math.floor(toTexel((x + 1) * r.cell)) + 1);
        let forest = 0;
        let ground = -Infinity;
        for (let j = j0; j <= j1; j += 1) {
          for (let i = i0; i <= i1; i += 1) {
            const f = mask[(j * res + i) * 4]!;
            if (f > forest) forest = f;
            const h = heights[j * res + i]!;
            if (h > ground) ground = h;
          }
        }
        // The shader keeps a cell when density > 0.03 + 0.95 * hash and the ground is above 2.5 m.
        if ((forest / 255) * density <= 0.03 || ground <= 2.5) continue;
        found.push(x, z);
        if (ground > top) top = ground;
      }
    }
    block = { cells: Int16Array.from(found), top };
    r.blocks.set(key, block);
    return block;
  }
}
