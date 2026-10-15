import { BufferAttribute, BufferGeometry, DoubleSide, MeshBasicNodeMaterial, ShapeUtils, Vector2, type Texture } from 'three/webgpu';
import { attribute, float, floor, fract, fwidth, mix, mx_noise_float, positionLocal, smoothstep, texture, vec2, vec3, vec4 } from 'three/tsl';
import { SHADE_SLOPE, SKY_LIGHT, SUN_DIRECTION, SUN_LIGHT } from '../groundPalette';
import type { LandLook } from '../landLook';
import type { P2, Plan, Surface } from './plan';
import { ELEVATION_MODEL, siteUV, type HeroSite } from './site';
import { cutAt, sinkAt } from './terrain';

// The ground of a hero camp: the land round it drawn at its own finer heights (a patch of the drawn land on a 2 m grid,
// the terraces and banks cut into it), with the land's own look (landLook.ts) lit by the patch's smooth normals and its
// own grass, woodland floor, rock and beach sand, giving way to the land's bake towards its edge, where the two are the
// same colour and the patch fades into the facets), the pads, yards, lanes,
// quays and fields laid on it, and the soft shade every building leaves on the ground beside it. All in the site's frame
// (model metres); the layer places the meshes. The land's facets sink a little under the patch (terrain.ts), so nothing
// of them shows through it.

/** The patch's grid step and how far it floats over the drawn land, model metres. */
const STEP = 2;
const LIFT = 0.04;
/** Over what border the patch fades into the land's facets, model metres. */
const FADE = 22;

/** A colour written in sRGB as linear light. */
const lin = (r: number, g: number, b: number): [number, number, number] => [(r / 255) ** 2.2, (g / 255) ** 2.2, (b / 255) ** 2.2];
/** The light on ground facing straight up, as the land's palette lights it. */
const FLAT_LIGHT = (() => {
  const sun = Math.max(0, SUN_DIRECTION[1]);
  return [0, 1, 2].map((k) => SUN_LIGHT[k]! * sun + SKY_LIGHT[k]!) as [number, number, number];
})();

/** Each surface's colour (sRGB before light) and which textures it is worked from: grass, rock, sand, woodland floor, paving. */
const SURFACES: Record<Surface, { rgb: [number, number, number]; w: [number, number, number, number]; pave: number }> = {
  earth: { rgb: lin(176, 152, 112), w: [0, 0.1, 0.9, 0], pave: 0 },
  yard: { rgb: lin(198, 176, 134), w: [0, 0, 1, 0], pave: 0 },
  lane: { rgb: lin(160, 136, 100), w: [0, 0.15, 0.85, 0], pave: 0 },
  gravel: { rgb: lin(158, 148, 122), w: [0, 0.4, 0.6, 0], pave: 0 },
  quay: { rgb: lin(176, 170, 156), w: [0, 0.5, 0.5, 0], pave: 1 },
  slip: { rgb: lin(150, 124, 92), w: [0, 0, 0.7, 0.3], pave: 0 },
  paddy: { rgb: lin(118, 150, 82), w: [1, 0, 0, 0], pave: 0 },
  field: { rgb: lin(160, 160, 92), w: [0.7, 0, 0.3, 0], pave: 0 },
};

/** Vertex streams of a ground mesh: position, colour with alpha, the texture weights, the paving share and the patch's light. */
class Streams {
  p: number[] = []; c: number[] = []; w: number[] = []; k: number[] = []; l: number[] = []; idx: number[] = [];
  /**
   * `pave` the share of paving joints, `inner` how far inside the patch (0 at its fading edge, 1 well in), `land` the
   * patch's sun, sky, slope and metres for the land's look.
   */
  vert(x: number, y: number, z: number, rgb: ArrayLike<number>, a: number, w: ArrayLike<number>, pave: number, inner = 1, land: ArrayLike<number> = NO_LAND) {
    this.p.push(x, y, z);
    this.c.push(rgb[0]!, rgb[1]!, rgb[2]!, a);
    this.w.push(w[0]!, w[1]!, w[2]!, w[3]!);
    this.k.push(pave, inner);
    this.l.push(land[0]!, land[1]!, land[2]!, land[3]!);
    return this.p.length / 3 - 1;
  }
  geometry() {
    if (!this.idx.length) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.c), 4));
    g.setAttribute('w', new BufferAttribute(new Float32Array(this.w), 4));
    g.setAttribute('pave', new BufferAttribute(new Float32Array(this.k), 2));
    if (this.l.some((v) => v !== 0)) g.setAttribute('land', new BufferAttribute(new Float32Array(this.l), 4));
    g.setIndex(this.p.length / 3 < 65536 ? new BufferAttribute(Uint16Array.from(this.idx), 1) : new BufferAttribute(Uint32Array.from(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

const NO_LAND = [0, 0, 0, 0] as const;

/** Smooth value noise in -1..1 for the patch's ragged edge. */
function wobble(x: number, z: number) {
  return Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2.1) * 0.6 + Math.sin(z * 0.13 + x * 0.05) * 0.4;
}

export interface HeroGroundMeshes {
  patch: BufferGeometry | null; laid: BufferGeometry | null; shade: BufferGeometry | null; water: BufferGeometry | null;
  /** The patch's ground at a point of the site's frame: its height, how wooded it is, how open. */
  sample(x: number, z: number): { h: number; wood: number; open: number };
}

/**
 * Builds a camp's ground. `drawn(u, v)` is the drawn land's height in metres at a frame point (negative under the sea),
 * `plan` the camp with its pads, flats and lanes.
 */
export function buildHeroGround(site: HeroSite, plan: Plan, drawn: (u: number, v: number) => number): HeroGroundMeshes {
  const R = site.reach;
  // The land as the patch draws it: the drawn heights with the sink under the patch given back (the sea floor never sank).
  const height = (x: number, z: number) => {
    const { u, v } = siteUV(site, x, z);
    const h = drawn(u, v) * ELEVATION_MODEL;
    return h > 0 ? h + sinkAt(site, x, z) : h;
  };
  const n = Math.round((2 * R) / STEP) + 1;
  let H = new Float32Array(n * n);
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) H[j * n + i] = height(-R + i * STEP, -R + j * STEP);
  // Puddles: a hollow of the DEM a few metres across dips under the sea plane where the land's facets bridge it; filled,
  // so the patch draws land there as the map does. Only water joined to a wide sheet stays water.
  {
    const seen = new Int32Array(n * n).fill(-1);
    for (let start = 0; start < n * n; start += 1) {
      if (seen[start]! >= 0 || H[start]! > 0) continue;
      const stack = [start], cells: number[] = [];
      seen[start] = start;
      while (stack.length) {
        const c = stack.pop()!;
        cells.push(c);
        const i = c % n, j = (c - i) / n;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
          const k = jj * n + ii;
          if (seen[k]! < 0 && H[k]! <= 0) { seen[k] = start; stack.push(k); }
        }
      }
      if (cells.length < 90) for (const c of cells) H[c] = 0.3;
    }
  }
  // Smoothed twice over its neighbours: the DEM's metre texels draw a coast in steps, the patch draws it as a line.
  for (let pass = 0; pass < 2; pass += 1) {
    const next = new Float32Array(n * n);
    for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) {
      let sum = 0, weight = 0;
      for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const k = di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1;
        sum += H[jj * n + ii]! * k;
        weight += k;
      }
      next[j * n + i] = sum / weight;
    }
    H = next;
  }
  // Never over a pad or a bank: the land was cut to them and the pads lie on top.
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) H[j * n + i] = Math.min(H[j * n + i]!, cutAt(plan.pads, -R + i * STEP, -R + j * STEP) - 0.15);
  const at = (i: number, j: number) => H[Math.max(0, Math.min(n - 1, j)) * n + Math.max(0, Math.min(n - 1, i))]!;

  // Whether open water lies within three cells: only there is low flat ground a beach.
  const shore = new Uint8Array(n * n);
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) {
    if (H[j * n + i]! > 0) continue;
    for (let dj = -3; dj <= 3; dj += 1) for (let di = -3; di <= 3; di += 1) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < n && jj < n) shore[jj * n + ii] = 1;
    }
  }
  const patch = new Streams();
  const w: number[] = [0, 0, 0, 0];
  const land: number[] = [0, 0, 0, 0];
  const white = [1, 1, 1];
  const woods = new Float32Array(n * n), open = new Float32Array(n * n);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const x = -R + i * STEP, z = -R + j * STEP, h = at(i, j);
      // A normal smoothed over two cells, so the light rolls over the hills instead of breaking at each facet.
      const gx = (at(i + 2, j) + at(i + 1, j) - at(i - 1, j) - at(i - 2, j)) / (6 * STEP);
      const gz = (at(i, j + 2) + at(i, j + 1) - at(i, j - 1) - at(i, j - 2)) / (6 * STEP);
      const slope = Math.hypot(gx, gz);
      const metres = h / ELEVATION_MODEL;
      // Lit as the land's bake lights it: the normal flattened to the share of the slope the light reads.
      const fx = -gx * SHADE_SLOPE, fz = -gz * SHADE_SLOPE, fl = Math.hypot(fx, 1, fz);
      land[0] = Math.max(0, (fx * SUN_DIRECTION[0] + SUN_DIRECTION[1] + fz * SUN_DIRECTION[2]) / fl);
      land[1] = 0.75 + 0.25 / fl;
      land[2] = slope;
      land[3] = Math.max(0, metres);
      // Which ground textures show: rock on the steep cuts and crags, sand on the flat shore, woodland floor on the wooded slopes, grass elsewhere.
      const rock = smooth(0.85, 1.6, slope);
      const sand = shore[j * n + i] ? (1 - smooth(0.02, 0.16, h)) * (1 - smooth(0.45, 0.9, slope)) : 0;
      const wood = Math.max(smooth(0.3, 0.6, slope), smooth(70, 190, metres)) * (1 - rock) * (1 - sand);
      w[0] = Math.max(0, 1 - rock - sand - wood); w[1] = rock; w[2] = sand; w[3] = wood;
      woods[j * n + i] = wood;
      open[j * n + i] = w[0];
      const edge = R - Math.max(Math.abs(x), Math.abs(z)) + wobble(x, z) * 6;
      // Its own ground takes over from the land's bake inside the fading border, so at the border the two are one colour.
      const inner = smooth(FADE * 0.5, FADE + 30, edge);
      patch.vert(x, h + LIFT, z, white, smooth(2, FADE, edge), w, 0, inner, land);
    }
  }
  for (let j = 0; j + 1 < n; j += 1) for (let i = 0; i + 1 < n; i += 1) {
    const a = j * n + i, b = a + 1, c = a + n + 1, d = a + n;
    // Open water far from any shore has nothing to show; the sea draws it.
    if (Math.max(H[a]!, H[b]!, H[c]!, H[d]!) < -0.25) continue;
    if (Math.max(patch.c[a * 4 + 3]!, patch.c[b * 4 + 3]!, patch.c[c * 4 + 3]!, patch.c[d * 4 + 3]!) <= 0) continue;
    patch.idx.push(a, d, c, a, c, b);
  }

  // The water round the camp deepened to the sea of the painted coasts: a veil of deep blue over the map's bright sea,
  // thin over the shallows so the surf still shows, gone at the patch's edge.
  const water = new Streams();
  const deep = lin(28, 70, 104);
  const wi = new Int32Array(n * n).fill(-1);
  const wetVert = (k: number) => {
    if (wi[k]! < 0) {
      const i = k % n, j = (k - i) / n;
      const x = -R + i * STEP, z = -R + j * STEP;
      const edge = R - Math.max(Math.abs(x), Math.abs(z)) + wobble(x, z) * 6;
      wi[k] = water.vert(x, 0.12, z, deep, (H[k]! < 0 ? 0.3 + 0.38 * smooth(0, -0.7, H[k]!) : 0) * smooth(4, FADE + 10, edge), [0, 0, 0, 0], 0);
    }
    return wi[k]!;
  };
  for (let j = 0; j + 1 < n; j += 1) for (let i = 0; i + 1 < n; i += 1) {
    const a = j * n + i, b = a + 1, c = a + n + 1, d = a + n;
    if (Math.min(H[a]!, H[b]!, H[c]!, H[d]!) > 0.05) continue;
    water.idx.push(wetVert(a), wetVert(d), wetVert(c), wetVert(a), wetVert(c), wetVert(b));
  }

  // What is laid on the ground: the pads' tops, then yards and fields, then lanes over them.
  const laid = new Streams();
  const ground = (x: number, z: number) => {
    const fi = (x + R) / STEP, fj = (z + R) / STEP, i = Math.floor(fi), j = Math.floor(fj), a = fi - i, b = fj - j;
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * a, bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * a;
    return top + (bottom - top) * b + LIFT;
  };
  const lit = (s: Surface) => {
    const S = SURFACES[s];
    return [S.rgb[0] * FLAT_LIGHT[0], S.rgb[1] * FLAT_LIGHT[1], S.rgb[2] * FLAT_LIGHT[2]];
  };
  /** A polygon laid flat at y, or on the ground when y is null (cut into small triangles that follow it). */
  const lay = (poly: readonly P2[], y: number | null, s: Surface, alpha = 1) => {
    const contour = poly.map(([x, z]) => new Vector2(x, z));
    if (ShapeUtils.isClockWise(contour)) contour.reverse();
    const tris = ShapeUtils.triangulateShape(contour, []);
    const S = SURFACES[s], c = lit(s);
    for (const t of tris) {
      const pts = t.map((q) => [contour[q]!.x, contour[q]!.y] as [number, number]);
      const split = y === null ? Math.max(1, Math.ceil(Math.max(...pts.map((p, k) => Math.hypot(p[0] - pts[(k + 1) % 3]![0], p[1] - pts[(k + 1) % 3]![1]))) / STEP)) : 1;
      // Barycentric subdivision of the triangle into split^2 small ones.
      const id = new Map<string, number>();
      const vert = (a: number, b: number) => {
        const key = `${a},${b}`;
        let v = id.get(key);
        if (v === undefined) {
          const wa = a / split, wb = b / split, wc = 1 - wa - wb;
          const x = pts[0]![0] * wc + pts[1]![0] * wa + pts[2]![0] * wb, z = pts[0]![1] * wc + pts[1]![1] * wa + pts[2]![1] * wb;
          v = laid.vert(x, y === null ? ground(x, z) + 0.06 : y + 0.03, z, c, alpha, S.w, S.pave);
          id.set(key, v);
        }
        return v;
      };
      for (let a = 0; a < split; a += 1) for (let b = 0; a + b < split; b += 1) {
        laid.idx.push(vert(a, b), vert(a, b + 1), vert(a + 1, b));
        if (a + b + 1 < split) laid.idx.push(vert(a + 1, b), vert(a, b + 1), vert(a + 1, b + 1));
      }
    }
  };
  for (const pad of plan.pads) lay(pad.poly, pad.h0, pad.top);
  for (const f of plan.flats) lay(f.poly, f.y === null ? null : f.y + 0.02, f.surface, f.y === null ? 0.92 : 1);
  // Lanes: soft-edged ribbons, cut every couple of metres so they follow the ground.
  for (const s of plan.strips) {
    const S = SURFACES[s.surface], c = lit(s.surface);
    for (let q = 0; q + 1 < s.line.length; q += 1) {
      const a = s.line[q]!, b = s.line[q + 1]!, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-6) continue;
      const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L, steps = Math.max(1, Math.ceil(L / STEP));
      let last: number[] | null = null;
      for (let k = 0; k <= steps; k += 1) {
        const px = a[0] + ((b[0] - a[0]) * k) / steps, pz = a[1] + ((b[1] - a[1]) * k) / steps;
        const row = ([[-0.62, 0], [-0.4, 0.95], [0.4, 0.95], [0.62, 0]] as const).map(([o, al]) => {
          const x = px + nx * s.width * o, z = pz + nz * s.width * o;
          return laid.vert(x, s.y === null ? ground(x, z) + 0.1 : s.y + 0.06, z, c, al, S.w, S.pave);
        });
        if (last) for (let m = 0; m < 3; m += 1) laid.idx.push(last[m]!, row[m]!, row[m + 1]!, last[m]!, row[m + 1]!, last[m + 1]!);
        last = row;
      }
    }
  }

  // The shade each building leaves on the ground: soft, deepest at its foot, reaching away from the sun.
  const shade = new Streams();
  const dark = [0, 0, 0], none = [0, 0, 0, 0];
  for (const { piece: p } of plan.pieces) {
    let w = 0, d = 0, h = 0, rot = 0;
    if (p.kind === 'bldg') { w = p.w + 2 * p.overhang; d = p.d + 2 * p.overhang; h = p.base + p.wallH + p.rise; rot = p.rot; }
    else if (p.kind === 'yagura') { w = p.w + 1.6; d = p.d + 1.6; h = p.storeys > 1 ? 7.4 : 4; rot = p.rot; }
    else if (p.kind === 'tenshu') { w = 13; d = 11; h = 16; }
    else if (p.kind === 'yamen') { w = 18; d = 10; h = 9; }
    else if (p.kind === 'tree') { w = d = p.r * 2.2; h = p.r * 2.3; }
    else continue;
    shadeBox(p.x, p.z, p.y, w, d, h, rot);
  }
  for (const { piece: p } of plan.pieces) {
    // Only the great walls standing back from their pad's edge: a shade must lie on the pad, not hang over its skirt.
    if (p.kind === 'wall' && (p.look === 'jo_granite' || p.look === 'mg_brick')) {
      const L = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
      shadeBox((p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, p.y, L, p.thick, 2.2, Math.atan2(-(p.b[1] - p.a[1]), p.b[0] - p.a[0]));
    } else if (p.kind === 'box' && p.h >= 1.5) shadeBox(p.x, p.z, p.y, p.w, p.d, p.h, p.rot);
  }
  function shadeBox(px: number, pz: number, py: number, w: number, d: number, h: number, rot: number) {
    // The sun stands high in the north-west: the shade falls south-east, towards the camera.
    const off = Math.min(7, h * 0.6);
    const cx = px + off * 0.5, cz = pz + off * 0.5;
    const c = Math.cos(rot), s = Math.sin(rot);
    const hw = w / 2 + off * 0.3 + 0.5, hd = d / 2 + off * 0.3 + 0.5, soft = 2;
    const y = py + 0.12;
    const ring = (gw: number, gd: number, a: number) => ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([u, q]) => {
      const lx = u * gw, lz = q * gd;
      return shade.vert(cx + lx * c + lz * s, y, cz - lx * s + lz * c, dark, a, none, 0);
    });
    const inner = ring(Math.max(0.3, hw - soft), Math.max(0.3, hd - soft), 0.5), outer = ring(hw + soft * 0.5, hd + soft * 0.5, 0);
    shade.idx.push(inner[0]!, inner[2]!, inner[1]!, inner[0]!, inner[3]!, inner[2]!);
    for (let k = 0; k < 4; k += 1) {
      const a = inner[k]!, b = inner[(k + 1) % 4]!, A = outer[k]!, B = outer[(k + 1) % 4]!;
      shade.idx.push(a, b, B, a, B, A);
    }
  }
  const sample = (x: number, z: number) => {
    const i = Math.max(0, Math.min(n - 1, Math.round((x + R) / STEP))), j = Math.max(0, Math.min(n - 1, Math.round((z + R) / STEP)));
    return { h: ground(x, z) - LIFT, wood: woods[j * n + i]!, open: open[j * n + i]! };
  };
  return { patch: patch.geometry(), laid: laid.geometry(), shade: shade.geometry(), water: water.geometry(), sample };
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export interface HeroGroundLook { ground: MeshBasicNodeMaterial; laid: MeshBasicNodeMaterial; shade: MeshBasicNodeMaterial; water: MeshBasicNodeMaterial }

/**
 * The ground's materials. The patch is the land's own look (landLook.ts) with the patch's light and ground faded in over
 * the bake's. What is laid on it is its vertex colour carrying the detail of the land's ground textures, each divided by
 * its own mean so it changes the grain and not the colour, at two scales so no tiling shows; paved surfaces get slab
 * joints. Unlit like the land, with its fog. The textures are the land's, which frees them.
 */
export function heroGroundLook(land: LandLook): HeroGroundLook {
  const textures = land.details;
  const p: any = positionLocal.xz;
  const detail = (t: Texture, size: number) => {
    const mean = texture(t, vec2(0.5, 0.5)).level(float(12)).rgb.max(vec3(0.02));
    const a = texture(t, p.div(size)).rgb.div(mean), b = texture(t, p.div(size * 3.7).add(vec2(0.37, 0.71))).rgb.div(mean);
    // The fine grain with a little of the broad one, so no tiling shows; half colour, half grain, as a texture's own hue
    // would fight the palette.
    const grain = a.mul(b.pow(vec3(0.35)));
    return mix(vec3(grain.dot(vec3(0.3, 0.55, 0.15))), grain, 0.3);
  };
  const w: any = attribute('w', 'vec4');
  const k2: any = attribute('pave', 'vec2');
  const pave: any = k2.x, inner: any = k2.y;
  const col: any = attribute('color', 'vec4');
  const mixed = detail(textures[0]!, 7).mul(w.x).add(detail(textures[1]!, 6).mul(w.y)).add(detail(textures[2]!, 4.5).mul(w.z)).add(detail(textures[3]!, 5).mul(w.w));
  const total = w.x.add(w.y).add(w.z).add(w.w).max(0.001);
  // The grain shows fully inside the patch and fades with it, so the patch's edge meets the land's plain facets; and it
  // fades as the camera draws back, before a pixel covers so much ground that the textures' repeats show as a quilt.
  const footprint = fwidth(p).length();
  const near = float(1).sub(smoothstep(0.17, 0.38, footprint));
  const grain: any = mix(vec3(1), mixed.div(total), inner.mul(0.5).add(0.35).mul(near));
  // Paving: slabs in running courses, each its own shade, joints dark.
  const slab = vec2(1.3, 0.75);
  const row = floor(p.y.div(slab.y));
  const q = vec2(p.x.div(slab.x).add(row.mul(0.5)), p.y.div(slab.y));
  const f = fract(q);
  const joint = smoothstep(0, 0.07, f.x).mul(smoothstep(1, 0.93, f.x)).mul(smoothstep(0, 0.1, f.y)).mul(smoothstep(1, 0.9, f.y));
  const tone = mx_noise_float(floor(q).mul(1.7)).mul(0.08).add(1);
  const paved: any = mix(vec3(1), vec3(mix(float(0.62), float(1), joint).mul(tone)), pave);
  const make = (o: { transparent: boolean; depthWrite: boolean; offset: number }) => {
    const m = new MeshBasicNodeMaterial({ transparent: o.transparent, depthWrite: o.depthWrite });
    // What is laid on the ground is wound either way; it is seen from above only.
    if (o.offset) m.side = DoubleSide;
    m.colorNode = vec4(col.rgb.mul(grain).mul(paved), 1);
    m.opacityNode = col.a;
    if (o.offset) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = -o.offset;
      m.polygonOffsetUnits = -o.offset * 2;
    }
    return m;
  };
  const shade = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
  shade.colorNode = vec4(vec3(0.05, 0.06, 0.08), 1);
  shade.opacityNode = col.a;
  shade.polygonOffset = true;
  shade.polygonOffsetFactor = -3;
  shade.polygonOffsetUnits = -6;
  const water = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  water.colorNode = vec4(col.rgb, 1);
  water.opacityNode = col.a;
  water.polygonOffset = true;
  water.polygonOffsetFactor = -2;
  water.polygonOffsetUnits = -4;
  const ground = new MeshBasicNodeMaterial({ transparent: true, depthWrite: true });
  const own: any = attribute('land', 'vec4');
  ground.colorNode = vec4(land.color({ inner, sun: own.x, sky: own.y, slope: own.z, metres: own.w, w }), 1);
  ground.opacityNode = col.a;
  return { ground, laid: make({ transparent: true, depthWrite: false, offset: 2 }), shade, water };
}
