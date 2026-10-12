import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  Mesh,
  MeshStandardNodeMaterial,
} from 'three/webgpu';
import { attribute, clamp, float, fract, mx_noise_float, positionWorld, pow, smoothstep, time, uniform, uv, vec3 } from 'three/tsl';
import type { Faction } from '../sim/types';

/** Mast height above the water and how far it reaches below, so a trough never shows its cut end. */
export const MAST_HEIGHT = 16;
const MAST_BELOW = 1.4;
const MAST_SIDES = 8;
/** The banner hangs from the mast between these heights and flies this far at its corners. */
const HOIST_TOP = 15.3;
const HOIST_BOTTOM = 9.9;
export const CLOTH_LENGTH = 8.6;
/** Depth of the swallow-tail notch at the middle of the fly. */
const NOTCH = 2.7;
export const CLOTH_COLUMNS = 15;
/** Rows across the hoist: the extra rows near the edges keep the gold hem a narrow band instead of a gradient. */
const ROWS = [0, 0.08, 0.27, 0.5, 0.73, 0.92, 1];
export const CLOTH_ROWS = ROWS.length;
const FOAM_RADII = [0.3, 1.1, 2.6, 4.6, 7, 9.5];
const FOAM_SEGMENTS = 32;
/** Wave samples for the foot, its tilt and the foam: a 3 x 3 grid this far apart, fitted by a quadratic surface. */
const SAMPLE = 5;
/** Waves shorter than this are left out of the tilt, so chop makes the mast sway and not shiver. */
const TILT_LAMBDA = 8;
/** The most standards drawn at once: one per own port, and a conquest map has fewer ports than this. */
const CAP = 12;

const MAST_VERTS = MAST_SIDES * 2 + MAST_SIDES + 1;
const MAST_INDICES = MAST_SIDES * 6 + MAST_SIDES * 3;
export const CLOTH_VERTS = CLOTH_COLUMNS * CLOTH_ROWS;
const CLOTH_INDICES = (CLOTH_COLUMNS - 1) * (CLOTH_ROWS - 1) * 6;
/** Vertices of one standard in the shared buffer: the mast first, then the cloth. */
export const STANDARD_VERTS = MAST_VERTS + CLOTH_VERTS;
const STANDARD_INDICES = MAST_INDICES + CLOTH_INDICES;
const FOAM_VERTS = FOAM_RADII.length * FOAM_SEGMENTS;
const FOAM_INDICES = (FOAM_RADII.length - 1) * FOAM_SEGMENTS * 6;

/** Cloth by navy: the HUD faction tones (styles.css) deepened and saturated, so the banner stays crisp on the sea. */
const CLOTH: Record<Faction, Color> = { joseon: new Color('#3367a6'), japan: new Color('#b0412f'), ming: new Color('#d29a2a') };
const HEM = new Color('#e9d38f');
const MAST = new Color('#3e2c1f');
const FINIAL = new Color('#c9a24e');

type Waves = { time: number; heightAt(x: number, z: number, t?: number, minLambda?: number): number };
type RallyPoint = { id: number; owner: number; rally?: { x: number; z: number } };
type Eye = { x: number; y: number; z: number };

/** Length of the cloth along one row: full at the top and bottom edges, shortest in the notch of the swallow tail. */
function rowLength(v: number) {
  return CLOTH_LENGTH - NOTCH * (1 - Math.abs(2 * v - 1));
}

/**
 * The rally point of each own port, shown as a standard planted on the sea: a dark mast with a swallow-tailed banner in
 * the navy's colour, foam and slow ripples around its foot. It is drawn in metres like the ships, rides the swell
 * and grows a little only far away, so it stays findable without turning into a screen overlay. All standards share
 * one mesh for mast and cloth and one for the foam; their vertices are rewritten in place every frame.
 */
export class RallyStandards {
  readonly group = new Group();
  /** Point id, then the foot (x, y, z) of each standard drawn this frame. */
  readonly ids = new Int32Array(CAP);
  readonly feet = new Float32Array(CAP * 3);
  count = 0;
  private readonly body: Mesh;
  private readonly foam: Mesh;
  private readonly position: BufferAttribute;
  private readonly normal: BufferAttribute;
  private readonly color: BufferAttribute;
  private readonly foamPosition: BufferAttribute;
  private readonly painted: (Faction | null)[] = new Array(CAP).fill(null);
  /** The mast in its own frame (foot at the origin, y up), turned onto the water each frame. */
  private readonly mastLocal = new Float32Array(MAST_VERTS * 6);
  /** The cloth in the mast's frame: x flies downwind, y is up, z is across the wind. */
  private readonly cloth = new Float32Array(CLOTH_VERTS * 3);
  private readonly clothNormal = new Float32Array(CLOTH_VERTS * 3);
  private readonly heights = new Float32Array(9);
  private readonly glow = uniform(0);
  private clock = 0;

  constructor() {
    const geometry = new BufferGeometry();
    this.position = new BufferAttribute(new Float32Array(CAP * STANDARD_VERTS * 3), 3);
    this.normal = new BufferAttribute(new Float32Array(CAP * STANDARD_VERTS * 3), 3);
    this.color = new BufferAttribute(new Float32Array(CAP * STANDARD_VERTS * 3), 3);
    for (const a of [this.position, this.normal, this.color]) a.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('normal', this.normal);
    geometry.setAttribute('color', this.color);
    geometry.setIndex(this.standardIndex());
    geometry.setDrawRange(0, 0);
    const material = new MeshStandardNodeMaterial({ side: DoubleSide, roughness: 0.82, metalness: 0 });
    material.vertexColors = true;
    // Some of its own colour keeps the cloth readable under a moon, when lit cloth goes nearly black; by day it is
    // kept low so the folds still shade.
    material.emissiveNode = attribute('color', 'vec3').mul(this.glow);
    this.body = new Mesh(geometry, material);

    const foamGeometry = new BufferGeometry();
    this.foamPosition = new BufferAttribute(new Float32Array(CAP * FOAM_VERTS * 3), 3);
    this.foamPosition.setUsage(DynamicDrawUsage);
    foamGeometry.setAttribute('position', this.foamPosition);
    foamGeometry.setAttribute('normal', this.foamNormals());
    foamGeometry.setAttribute('uv', this.foamUv());
    foamGeometry.setIndex(this.foamIndex());
    foamGeometry.setDrawRange(0, 0);
    this.foam = new Mesh(foamGeometry, this.foamMaterial());
    this.foam.renderOrder = 2;
    for (const mesh of [this.body, this.foam]) {
      // Vertices are written in world space, so the geometry's bounds never describe where the standards are.
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.group.visible = false;
    this.buildMast();
  }

  /**
   * Foam hugs the foot of the mast, broken up by noise, and thin rings run outward from it and fade, like the water
   * stirred round a pole that the swell keeps lifting. Everything outside those marks is fully transparent.
   */
  private foamMaterial() {
    const material = new MeshStandardNodeMaterial({ transparent: true, depthWrite: false, roughness: 0.9, metalness: 0 });
    const r = uv().x;
    const fine = mx_noise_float(vec3(positionWorld.x.mul(1.3), positionWorld.z.mul(1.3), time.mul(0.6))).mul(0.5).add(0.5);
    const broad = mx_noise_float(vec3(positionWorld.x.mul(0.35), positionWorld.z.mul(0.35), time.mul(0.2))).mul(0.5).add(0.5);
    // Torn patches that thin out away from the mast, never a solid disc.
    const collar = smoothstep(0.5, 0.78, fine.add(smoothstep(0.3, 0.0, r).mul(0.45))).mul(smoothstep(0.34, 0.08, r));
    const phase = fract(r.mul(2.2).sub(time.mul(0.12)));
    const ring = smoothstep(0.0, 0.04, phase).mul(smoothstep(0.16, 0.05, phase));
    const ripple = ring.mul(pow(float(1).sub(r), float(1.4))).mul(smoothstep(0.3, 0.8, broad)).mul(0.3);
    material.colorNode = vec3(0.86, 0.9, 0.9);
    // The same lift as the cloth: under a moon the foam is what shows where the mast meets the water.
    material.emissiveNode = vec3(0.5, 0.55, 0.58).mul(this.glow);
    material.opacityNode = clamp(collar.mul(0.85).add(ripple), 0, 1).mul(smoothstep(1.0, 0.8, r));
    return material;
  }

  private buildMast() {
    const m = this.mastLocal;
    let o = 0;
    const put = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
      m[o++] = x; m[o++] = y; m[o++] = z; m[o++] = nx; m[o++] = ny; m[o++] = nz;
    };
    for (let i = 0; i < MAST_SIDES; i += 1) {
      const a = (i / MAST_SIDES) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      put(c * 0.22, -MAST_BELOW, s * 0.22, c, 0, s);
      put(c * 0.12, MAST_HEIGHT, s * 0.12, c, 0, s);
    }
    // A gilt cone finial caps the mast, the one bright point that catches the eye from far off.
    for (let i = 0; i < MAST_SIDES; i += 1) {
      const a = (i / MAST_SIDES) * Math.PI * 2;
      put(Math.cos(a) * 0.3, MAST_HEIGHT, Math.sin(a) * 0.3, Math.cos(a) * 0.8, 0.6, Math.sin(a) * 0.8);
    }
    put(0, MAST_HEIGHT + 1.1, 0, 0, 1, 0);
  }

  private standardIndex() {
    const index = new Uint16Array(CAP * STANDARD_INDICES);
    let o = 0;
    for (let k = 0; k < CAP; k += 1) {
      const base = k * STANDARD_VERTS;
      for (let i = 0; i < MAST_SIDES; i += 1) {
        const a = base + i * 2, b = base + ((i + 1) % MAST_SIDES) * 2;
        index.set([a, a + 1, b, b, a + 1, b + 1], o);
        o += 6;
      }
      const tip = base + MAST_SIDES * 3;
      for (let i = 0; i < MAST_SIDES; i += 1) {
        index.set([base + MAST_SIDES * 2 + i, tip, base + MAST_SIDES * 2 + ((i + 1) % MAST_SIDES)], o);
        o += 3;
      }
      const c0 = base + MAST_VERTS;
      for (let i = 0; i < CLOTH_COLUMNS - 1; i += 1) {
        for (let j = 0; j < CLOTH_ROWS - 1; j += 1) {
          const a = c0 + i * CLOTH_ROWS + j, b = a + CLOTH_ROWS;
          index.set([a, b, a + 1, a + 1, b, b + 1], o);
          o += 6;
        }
      }
    }
    return new BufferAttribute(index, 1);
  }

  private foamIndex() {
    const index = new Uint16Array(CAP * FOAM_INDICES);
    let o = 0;
    for (let k = 0; k < CAP; k += 1) {
      const base = k * FOAM_VERTS;
      for (let r = 0; r < FOAM_RADII.length - 1; r += 1) {
        for (let i = 0; i < FOAM_SEGMENTS; i += 1) {
          const a = base + r * FOAM_SEGMENTS + i, b = base + r * FOAM_SEGMENTS + ((i + 1) % FOAM_SEGMENTS);
          index.set([a, b, a + FOAM_SEGMENTS, b, b + FOAM_SEGMENTS, a + FOAM_SEGMENTS], o);
          o += 6;
        }
      }
    }
    return new BufferAttribute(index, 1);
  }

  private foamUv() {
    const uvs = new Float32Array(CAP * FOAM_VERTS * 2);
    const outer = FOAM_RADII[FOAM_RADII.length - 1]!;
    for (let k = 0; k < CAP; k += 1) {
      for (let r = 0; r < FOAM_RADII.length; r += 1) {
        for (let i = 0; i < FOAM_SEGMENTS; i += 1) {
          const o = (k * FOAM_VERTS + r * FOAM_SEGMENTS + i) * 2;
          uvs[o] = FOAM_RADII[r]! / outer;
          uvs[o + 1] = i / FOAM_SEGMENTS;
        }
      }
    }
    return new BufferAttribute(uvs, 2);
  }

  private foamNormals() {
    const normals = new Float32Array(CAP * FOAM_VERTS * 3);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    return new BufferAttribute(normals, 3);
  }

  /**
   * The banner at time t: a wave runs from the hoist to the fly and grows toward the free end, gusts make it stream
   * out or sag, and each column is laid out from the last with its own share of the row's length, so the cloth folds
   * instead of stretching and never reaches past its length.
   */
  private shapeCloth(t: number, seed: number) {
    const gust = 0.72 + 0.18 * Math.sin(t * 0.37 + seed) + 0.1 * Math.sin(t * 1.13 + seed * 2.1);
    const sag = 2.2 * (1 - gust);
    const c = this.cloth;
    for (let j = 0; j < CLOTH_ROWS; j += 1) {
      const v = ROWS[j]!;
      const y0 = HOIST_BOTTOM + (HOIST_TOP - HOIST_BOTTOM) * v;
      const seg = rowLength(v) / (CLOTH_COLUMNS - 1);
      let x = 0, py = y0, pz = 0;
      for (let i = 0; i < CLOTH_COLUMNS; i += 1) {
        const u = i / (CLOTH_COLUMNS - 1);
        // The folds run a little diagonally (the phase shifts down the hoist), as on a real flag in a quartering wind.
        const phase = u * 6.8 - t * 4.1 + seed + v * 1.3;
        const amp = Math.pow(u, 1.1) * (1.0 + 0.6 * gust);
        const z = amp * (Math.sin(phase) * 0.8 + Math.sin(phase * 2.2 + 1.7 - v * 1.1) * 0.25);
        const y = y0 - sag * u * u + amp * 0.22 * Math.sin(phase * 0.8 + 0.4);
        if (i > 0) {
          const dz = z - pz, dy = y - py;
          x += Math.sqrt(Math.max(seg * seg - dz * dz - dy * dy, seg * seg * 0.1));
        }
        const o = (i * CLOTH_ROWS + j) * 3;
        c[o] = x; c[o + 1] = y; c[o + 2] = z;
        py = y; pz = z;
      }
    }
    const n = this.clothNormal;
    for (let i = 0; i < CLOTH_COLUMNS; i += 1) {
      for (let j = 0; j < CLOTH_ROWS; j += 1) {
        const a = ((Math.max(0, i - 1)) * CLOTH_ROWS + j) * 3, b = ((Math.min(CLOTH_COLUMNS - 1, i + 1)) * CLOTH_ROWS + j) * 3;
        const d = (i * CLOTH_ROWS + Math.max(0, j - 1)) * 3, e = (i * CLOTH_ROWS + Math.min(CLOTH_ROWS - 1, j + 1)) * 3;
        const ux = c[b]! - c[a]!, uy = c[b + 1]! - c[a + 1]!, uz = c[b + 2]! - c[a + 2]!;
        const vx = c[e]! - c[d]!, vy = c[e + 1]! - c[d + 1]!, vz = c[e + 2]! - c[d + 2]!;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        const o = (i * CLOTH_ROWS + j) * 3;
        n[o] = nx / l; n[o + 1] = ny / l; n[o + 2] = nz / l;
      }
    }
  }

  /**
   * Places the standard of every own port that has a rally point, or none once the battle has ended. `dt` is real
   * time: the cloth keeps a natural pace while the battle runs fast or stands paused, and the foot follows the sea.
   * `night` is the sky's darkness from 0 (day) to 1 (moonlight).
   */
  update(points: readonly RallyPoint[], owner: number, faction: Faction, waves: Waves, windAngle: number, eye: Eye, ended: boolean, dt: number, night: number) {
    this.clock += Math.min(dt, 0.1);
    this.glow.value = 0.06 + night * 0.4;
    let n = 0;
    if (!ended) {
      for (const p of points) {
        if (!p.rally || p.owner !== owner || n >= CAP) continue;
        this.place(n, p.id, p.rally.x, p.rally.z, faction, waves, windAngle, eye);
        n += 1;
      }
    }
    this.count = n;
    this.group.visible = n > 0;
    this.body.geometry.setDrawRange(0, n * STANDARD_INDICES);
    this.foam.geometry.setDrawRange(0, n * FOAM_INDICES);
    if (!n) return;
    this.position.needsUpdate = true;
    this.normal.needsUpdate = true;
    this.foamPosition.needsUpdate = true;
  }

  private place(k: number, id: number, x: number, z: number, faction: Faction, waves: Waves, windAngle: number, eye: Eye) {
    const t = waves.time;
    const h = this.heights;
    for (let a = 0; a < 3; a += 1) for (let b = 0; b < 3; b += 1) h[a * 3 + b] = waves.heightAt(x + (a - 1) * SAMPLE, z + (b - 1) * SAMPLE, t, TILT_LAMBDA);
    const y = waves.heightAt(x, z, t);
    this.ids[k] = id;
    this.feet[k * 3] = x; this.feet[k * 3 + 1] = y; this.feet[k * 3 + 2] = z;
    // The surface around the foot as a quadratic in (dx, dz): its slope tilts the mast and its curve lays the foam.
    const gx = (h[7]! - h[1]!) / (2 * SAMPLE), gz = (h[5]! - h[3]!) / (2 * SAMPLE);
    const cxx = (h[7]! - 2 * h[4]! + h[1]!) / (SAMPLE * SAMPLE), czz = (h[5]! - 2 * h[4]! + h[3]!) / (SAMPLE * SAMPLE);
    const cxz = (h[8]! - h[6]! - h[2]! + h[0]!) / (4 * SAMPLE * SAMPLE);
    // Far away the standard grows a little, so it can still be found against a whole fleet; up close it is life size.
    const distance = Math.hypot(eye.x - x, eye.y - y, eye.z - z);
    const s = 1 + Math.min(1, Math.max(0, (distance - 400) / 1400)) * 1.6;

    // Frame: up leans with the swell, x points downwind (with a slow veer), z completes it.
    let ux = -gx * 0.6, uy = 1, uz = -gz * 0.6;
    const ul = Math.hypot(ux, uy, uz);
    ux /= ul; uy /= ul; uz /= ul;
    const veer = windAngle + 0.14 * Math.sin(this.clock * 0.09 + id * 1.7);
    let fx = Math.cos(veer), fy = 0, fz = Math.sin(veer);
    const d = fx * ux + fz * uz;
    fx -= ux * d; fy -= uy * d; fz -= uz * d;
    const fl = Math.hypot(fx, fy, fz);
    fx /= fl; fy /= fl; fz /= fl;
    const sx = fy * uz - fz * uy, sy = fz * ux - fx * uz, sz = fx * uy - fy * ux;

    const pos = this.position.array as Float32Array, nor = this.normal.array as Float32Array;
    const m = this.mastLocal;
    this.shapeCloth(this.clock, id * 2.39);
    const c = this.cloth, cn = this.clothNormal;
    for (let i = 0; i < STANDARD_VERTS; i += 1) {
      const mast = i < MAST_VERTS;
      const q = mast ? i * 6 : (i - MAST_VERTS) * 3;
      const r = mast ? q + 3 : q;
      const src = mast ? m : c, nsrc = mast ? m : cn;
      // The cloth is hung from the mast's surface, not its axis.
      const lx = src[q]! + (mast ? 0 : 0.12), ly = src[q + 1]!, lz = src[q + 2]!;
      const nx = nsrc[r]!, ny = nsrc[r + 1]!, nz = nsrc[r + 2]!;
      const o = (k * STANDARD_VERTS + i) * 3;
      pos[o] = x + (fx * lx + ux * ly + sx * lz) * s;
      pos[o + 1] = y + (fy * lx + uy * ly + sy * lz) * s;
      pos[o + 2] = z + (fz * lx + uz * ly + sz * lz) * s;
      nor[o] = fx * nx + ux * ny + sx * nz;
      nor[o + 1] = fy * nx + uy * ny + sy * nz;
      nor[o + 2] = fz * nx + uz * ny + sz * nz;
    }
    if (this.painted[k] !== faction) this.paint(k, faction);

    const foam = this.foamPosition.array as Float32Array;
    let f = k * FOAM_VERTS * 3;
    for (let r = 0; r < FOAM_RADII.length; r += 1) {
      const radius = FOAM_RADII[r]! * s;
      for (let i = 0; i < FOAM_SEGMENTS; i += 1) {
        const a = (i / FOAM_SEGMENTS) * Math.PI * 2;
        const dx = Math.cos(a) * radius, dz = Math.sin(a) * radius;
        foam[f] = x + dx;
        // Lifted a hand's breadth so the water does not cut through the foam between the samples of the fit.
        foam[f + 1] = y + gx * dx + gz * dz + 0.5 * cxx * dx * dx + 0.5 * czz * dz * dz + cxz * dx * dz + 0.12;
        foam[f + 2] = z + dz;
        f += 3;
      }
    }
  }

  /** Colours a slot for its navy; only when the slot changes hands, so most frames upload no colour at all. */
  private paint(k: number, faction: Faction) {
    this.painted[k] = faction;
    const col = this.color.array as Float32Array;
    const base = k * STANDARD_VERTS * 3;
    const cloth = CLOTH[faction];
    for (let i = 0; i < STANDARD_VERTS; i += 1) {
      let tone = cloth;
      if (i < MAST_VERTS) tone = i >= MAST_SIDES * 2 ? FINIAL : MAST;
      else {
        // A gold hem runs along the top, the bottom and the swallow-tailed fly.
        const column = Math.floor((i - MAST_VERTS) / CLOTH_ROWS), row = (i - MAST_VERTS) % CLOTH_ROWS;
        if (row === 0 || row === CLOTH_ROWS - 1 || column === CLOTH_COLUMNS - 1) tone = HEM;
      }
      col[base + i * 3] = tone.r;
      col[base + i * 3 + 1] = tone.g;
      col[base + i * 3 + 2] = tone.b;
    }
    this.color.needsUpdate = true;
  }

  dispose() {
    for (const mesh of [this.body, this.foam]) {
      mesh.geometry.dispose();
      (mesh.material as MeshStandardNodeMaterial).dispose();
    }
    this.group.removeFromParent();
    this.group.clear();
    this.count = 0;
  }
}
