import { DataTexture, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshBasicNodeMaterial, type Node, PlaneGeometry, RGFormat, UnsignedByteType } from 'three/webgpu';
import { cameraPosition, clamp, float, fwidth, log, max, mix, positionWorld, sin, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import meta from '../../select/demMeta.json';
import { V_SCALE } from '../../select/demFrame';
import { worldClock } from '../../select/terrain';
import { FAR_DEPTH } from './farLand';
import { DEM_RECT, MESH_SCALE } from './mapMath';
import { FAR, frameU, worldX, worldZ } from './worldCamera';

// The sea of the campaign's 3D world: one plane at sea level out past the far plane, drawn after the land so the depth
// test throws away whatever the land covers. Its colour is cheap: one fetch from a small texture baked once from the
// drawn land (the water's depth and the distance to the coast), pale shoals to deep blue, a thin line of surf along the
// coasts, the sky in it at grazing angles and a swell of a few sines moving with the world clock.
//
// The texture covers the whole world. Over the DEM its texels are even, one for every two of the DEM's; outside it they
// grow with the distance, slowly to the north, where the far land's coasts lie, and fast elsewhere, where there is only
// open sea, so the world's every coast has its shallows and surf and the water deepens smoothly away from the DEM's
// edges instead of stopping at a line.

/** Texels across the DEM's width and down its height: one for every two of the DEM's. */
const DEM_COLS = 1024, DEM_ROWS = 520;
/** Depth in metres at which the water is fully deep: the red channel holds depth over this. */
const DEEP = 160;
/** The green channel holds the signed distance to the drawn coast in the DEM's sea texels (sea positive), -LAND_SIDE to +SEA_SIDE. */
const LAND_SIDE = 1, SEA_SIDE = 12;
/** Metres per frame unit of height, the inverse of the land's lift. */
const METRES = 1 / (V_SCALE * MESH_SCALE);

/**
 * Outside the DEM a texel is `1 + grow * d` times as wide as the DEM's at `d` world units from it, out to `reach`; past
 * that the sampler carries the outermost texels on, which are open sea.
 */
interface Margin {
  grow: number;
  reach: number;
}
const WEST: Margin = { grow: 60, reach: 0.8 };
const EAST: Margin = { grow: 40, reach: 0.8 };
const NORTH: Margin = { grow: 14, reach: FAR_DEPTH };
const SOUTH: Margin = { grow: 60, reach: 0.8 };
/** World units from a coast of the far land over which the sea floor falls away to fully deep: wide on the west coast, narrow on the east. */
const SHELF_WEST = 0.06, SHELF_EAST = 0.02;
/** World units outside the DEM over which its own depths give way to that shelf. */
const SETTLE = 0.25;
/** Texels round a coast within which the distance to it is measured exactly; beyond, it is carried on texel by texel. */
const EXACT = 2.5;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** One axis of the texture: the DEM's span in `cells` even texels, with a margin before it and after it. */
function axis(lo: number, hi: number, cells: number, before: Margin, after: Margin) {
  const size = (hi - lo) / cells;
  const texels = (m: Margin) => Math.ceil(Math.log1p(m.grow * m.reach) / (size * m.grow));
  const head = texels(before);
  const count = head + cells + texels(after);
  return {
    lo, hi, size, head, cells, count, before, after,
    /** The texel coordinate (one per texel from the texture's start) of the world coordinate `w`. */
    at: (w: number) =>
      w < lo ? head - Math.log1p(before.grow * (lo - w)) / (size * before.grow)
      : w > hi ? head + cells + Math.log1p(after.grow * (w - hi)) / (size * after.grow)
      : head + (w - lo) / size,
    /** The world coordinate of the texel coordinate `t`. */
    world: (t: number) =>
      t < head ? lo - Math.expm1((head - t) * size * before.grow) / before.grow
      : t > head + cells ? hi + Math.expm1((t - head - cells) * size * after.grow) / after.grow
      : lo + (t - head) * size,
  };
}
type Axis = ReturnType<typeof axis>;

const AXIS_X = axis(worldX(DEM_RECT.u), worldX(DEM_RECT.u + DEM_RECT.w), DEM_COLS, WEST, EAST);
const AXIS_Z = axis(worldZ(DEM_RECT.v), worldZ(DEM_RECT.v + DEM_RECT.h), DEM_ROWS, NORTH, SOUTH);

/** The texture coordinate (0..1) along `a` of the world coordinate `w`, as `a.at` reckons it, for the shader. */
function warp(w: Node<'float'>, a: Axis) {
  const inside = clamp(w, a.lo, a.hi).sub(a.lo).mul(1 / a.size);
  const before = log(max(float(a.lo).sub(w), 0).mul(a.before.grow).add(1)).mul(1 / (a.size * a.before.grow));
  const after = log(max(w.sub(a.hi), 0).mul(a.after.grow).add(1)).mul(1 / (a.size * a.after.grow));
  return inside.add(a.head).sub(before).add(after).mul(1 / a.count);
}

/**
 * Distance in world units from every texel centre to the nearest drawn coast: exact within EXACT texels of it (to the
 * line where each facet crosses the sea plane), then carried on to the neighbours by two sweeps.
 */
function coastDistance(seeds: Float32Array, cx: Float64Array, cz: Float64Array) {
  const w = cx.length, h = cz.length;
  const d = seeds;
  // dx[i] is the step from column i - 1 to column i; diagonal[i] the step from column i - 1 of one row to column i of the next.
  const dx = new Float64Array(w + 1), diagonal = new Float64Array(w + 1);
  for (let i = 1; i < w; i += 1) dx[i] = cx[i]! - cx[i - 1]!;
  const diagonals = (sz: number) => {
    for (let i = 1; i < w; i += 1) diagonal[i] = Math.sqrt(dx[i]! * dx[i]! + sz * sz);
  };
  for (let j = 1; j < h; j += 1) {
    const sz = cz[j]! - cz[j - 1]!;
    diagonals(sz);
    const row = j * w;
    for (let i = 0; i < w; i += 1) {
      const k = row + i;
      let v = d[k]!, c: number;
      if ((c = d[k - w]! + sz) < v) v = c;
      if (i > 0) {
        if ((c = d[k - 1]! + dx[i]!) < v) v = c;
        if ((c = d[k - w - 1]! + diagonal[i]!) < v) v = c;
      }
      if (i < w - 1 && (c = d[k - w + 1]! + diagonal[i + 1]!) < v) v = c;
      d[k] = v;
    }
  }
  for (let j = h - 2; j >= 0; j -= 1) {
    const sz = cz[j + 1]! - cz[j]!;
    diagonals(sz);
    const row = j * w;
    for (let i = w - 1; i >= 0; i -= 1) {
      const k = row + i;
      let v = d[k]!, c: number;
      if ((c = d[k + w]! + sz) < v) v = c;
      if (i < w - 1) {
        if ((c = d[k + 1]! + dx[i + 1]!) < v) v = c;
        if ((c = d[k + w + 1]! + diagonal[i + 1]!) < v) v = c;
      }
      if (i > 0 && (c = d[k + w - 1]! + diagonal[i]!) < v) v = c;
      d[k] = v;
    }
  }
  return d;
}

/**
 * Lays the drawn facets (nine floats each: x, y in frame units, z of three corners) over the texel centres: the ground's
 * height in metres where a facet covers one (NaN elsewhere, which is open water), and, near every line where a facet
 * crosses the sea plane, the exact distance to that line.
 */
function layFacets(facets: Float32Array[], cx: Float64Array, cz: Float64Array, ground: Float32Array, near: Float32Array) {
  const w = cx.length, h = cz.length;
  const X = AXIS_X, Z = AXIS_Z;
  // The two points where a facet's edges cross the sea plane, as x, z, x, z.
  const cross = new Float64Array(4);
  for (const p of facets) {
    for (let o = 0; o < p.length; o += 9) {
      const ax = p[o]!, ah = p[o + 1]! * METRES, az = p[o + 2]!;
      const bx = p[o + 3]!, bh = p[o + 4]! * METRES, bz = p[o + 5]!;
      const qx = p[o + 6]!, qh = p[o + 7]! * METRES, qz = p[o + 8]!;
      const area = (bx - ax) * (qz - az) - (bz - az) * (qx - ax);
      if (area === 0) continue;
      // The texel centres inside the facet's bounds: centre i lies at texel coordinate i + 0.5.
      const i0 = Math.max(0, Math.ceil(X.at(Math.min(ax, bx, qx)) - 0.5)), i1 = Math.min(w - 1, Math.floor(X.at(Math.max(ax, bx, qx)) - 0.5));
      const j0 = Math.max(0, Math.ceil(Z.at(Math.min(az, bz, qz)) - 0.5)), j1 = Math.min(h - 1, Math.floor(Z.at(Math.max(az, bz, qz)) - 0.5));
      for (let j = j0; j <= j1; j += 1) {
        const z = cz[j]!;
        for (let i = i0; i <= i1; i += 1) {
          const x = cx[i]!;
          const wa = ((bx - x) * (qz - z) - (bz - z) * (qx - x)) / area;
          const wb = ((x - ax) * (qz - az) - (z - az) * (qx - ax)) / area;
          const wc = 1 - wa - wb;
          if (wa < -1e-7 || wb < -1e-7 || wc < -1e-7) continue;
          ground[j * w + i] = ah * wa + bh * wb + qh * wc;
        }
      }
      // A facet with corners on both sides of the sea plane draws a stretch of coast: the line where it crosses.
      const landA = ah > 0, landB = bh > 0, landQ = qh > 0;
      if (landA === landB && landB === landQ) continue;
      let found = 0;
      if (landA !== landB) {
        const t = ah / (ah - bh);
        cross[found++] = ax + (bx - ax) * t;
        cross[found++] = az + (bz - az) * t;
      }
      if (landB !== landQ) {
        const t = bh / (bh - qh);
        cross[found++] = bx + (qx - bx) * t;
        cross[found++] = bz + (qz - bz) * t;
      }
      if (landQ !== landA) {
        const t = qh / (qh - ah);
        cross[found++] = qx + (ax - qx) * t;
        cross[found++] = qz + (az - qz) * t;
      }
      const sx = cross[0]!, sz = cross[1]!, lx = cross[2]! - sx, lz = cross[3]! - sz, length2 = lx * lx + lz * lz || 1e-30;
      const ci0 = Math.max(0, Math.ceil(X.at(Math.min(sx, sx + lx)) - 0.5 - EXACT)), ci1 = Math.min(w - 1, Math.floor(X.at(Math.max(sx, sx + lx)) - 0.5 + EXACT));
      const cj0 = Math.max(0, Math.ceil(Z.at(Math.min(sz, sz + lz)) - 0.5 - EXACT)), cj1 = Math.min(h - 1, Math.floor(Z.at(Math.max(sz, sz + lz)) - 0.5 + EXACT));
      for (let j = cj0; j <= cj1; j += 1) {
        const pz = cz[j]! - sz;
        for (let i = ci0; i <= ci1; i += 1) {
          const px = cx[i]! - sx;
          const t = Math.max(0, Math.min(1, (px * lx + pz * lz) / length2));
          const ex = px - lx * t, ez = pz - lz * t;
          const d = Math.sqrt(ex * ex + ez * ez);
          const k = j * w + i;
          if (d < near[k]!) near[k] = d;
        }
      }
    }
  }
}

/** A box blur of `radius` samples along a line of them, three times over: about a Gaussian. */
function blurLine(values: Float64Array, radius: number) {
  const n = values.length, span = 2 * radius + 1;
  const out = new Float64Array(n);
  for (let k = 0; k < 3; k += 1) {
    let sum = 0;
    for (let p = -radius; p <= radius; p += 1) sum += values[Math.min(n - 1, Math.max(0, p))]!;
    for (let p = 0; p < n; p += 1) {
      out[p] = sum / span;
      sum += values[Math.min(n - 1, p + radius + 1)]! - values[Math.max(0, p - radius)]!;
    }
    values.set(out);
  }
  return values;
}

/** Texels inside each of the DEM's edges over which its depths give way to the edge's smoothed depth (`edgeDepths`). */
const EDGE_BAND = 24;

/**
 * The depth along each of the DEM's four edges, smoothed so the water outside settles from it without streaks: the mean
 * depth of the water among the outermost EDGE_BAND texels across the edge, blurred along it. Where `wet` is 0 is land.
 */
function edgeDepths(wet: Float32Array) {
  const ALONG = 32;
  const lines = { north: new Float64Array(DEM_COLS), south: new Float64Array(DEM_COLS), west: new Float64Array(DEM_ROWS), east: new Float64Array(DEM_ROWS) };
  const counts = { north: new Float64Array(DEM_COLS), south: new Float64Array(DEM_COLS), west: new Float64Array(DEM_ROWS), east: new Float64Array(DEM_ROWS) };
  const add = (side: keyof typeof lines, p: number, depth: number) => {
    if (depth <= 0) return;
    lines[side][p] += depth;
    counts[side][p] += 1;
  };
  for (let k = 0; k < EDGE_BAND; k += 1) {
    for (let c = 0; c < DEM_COLS; c += 1) {
      add('north', c, wet[k * DEM_COLS + c]!);
      add('south', c, wet[(DEM_ROWS - 1 - k) * DEM_COLS + c]!);
    }
    for (let r = 0; r < DEM_ROWS; r += 1) {
      add('west', r, wet[r * DEM_COLS + k]!);
      add('east', r, wet[r * DEM_COLS + DEM_COLS - 1 - k]!);
    }
  }
  for (const side of ['north', 'south', 'west', 'east'] as const) {
    const line = lines[side], count = counts[side];
    // A stretch of edge with no water across it is a shore: the water off it is as shallow as can be.
    for (let p = 0; p < line.length; p += 1) line[p] = count[p]! > 0 ? line[p]! / count[p]! : 0;
    blurLine(line, ALONG);
  }
  return lines;
}

/**
 * The sea's texture: red is the depth (the DEM's own seabed over the DEM, a shelf along the far land's coasts and
 * settling to the open sea away from both), green the signed distance to the drawn coast. `heights` are the DEM's
 * metres as the land's facets draw them; `facets` the drawn land and far land.
 */
function bake(heights: Float32Array, facets: Float32Array[]) {
  const X = AXIS_X, Z = AXIS_Z;
  const w = X.count, h = Z.count, n = w * h;
  const cx = Float64Array.from({ length: w }, (_, i) => X.world(i + 0.5));
  const cz = Float64Array.from({ length: h }, (_, j) => Z.world(j + 0.5));
  const ground = new Float32Array(n).fill(Number.NaN);
  const near = new Float32Array(n).fill(Number.POSITIVE_INFINITY);
  layFacets(facets, cx, cz, ground, near);
  const away = coastDistance(near, cx, cz);

  // Over the DEM the depth is the mean of the wet ones among the four DEM texels round a texel's centre (the drawn land
  // reads as dry).
  const W = meta.width, H = meta.height;
  const wet = new Float32Array(DEM_COLS * DEM_ROWS);
  for (let r = 0; r < DEM_ROWS; r += 1) {
    const y = Math.min(H - 1.001, ((r + 0.5) / DEM_ROWS) * (H - 1));
    const y0 = Math.floor(y), fy = y - y0;
    for (let c = 0; c < DEM_COLS; c += 1) {
      const x = Math.min(W - 1.001, ((c + 0.5) / DEM_COLS) * (W - 1));
      const x0 = Math.floor(x), fx = x - x0, k = y0 * W + x0;
      const a = heights[k]!, b = heights[k + 1]!, d = heights[k + W]!, e = heights[k + W + 1]!;
      const wa = a > 0 ? 0 : (1 - fx) * (1 - fy), wb = b > 0 ? 0 : fx * (1 - fy), wd = d > 0 ? 0 : (1 - fx) * fy, we = e > 0 ? 0 : fx * fy;
      const share = wa + wb + wd + we;
      wet[r * DEM_COLS + c] = share > 0 ? (wa * Math.min(DEEP, -a) + wb * Math.min(DEEP, -b) + wd * Math.min(DEEP, -d) + we * Math.min(DEEP, -e)) / share : 0;
    }
  }
  // Outside it, the depth of the nearest stretch of its edge settles over SETTLE to a shelf off the nearest coast.
  const edges = edgeDepths(wet);
  const corners = [
    (edges.north[0]! + edges.west[0]!) / 2, (edges.north[DEM_COLS - 1]! + edges.east[0]!) / 2,
    (edges.south[0]! + edges.west[DEM_ROWS - 1]!) / 2, (edges.south[DEM_COLS - 1]! + edges.east[DEM_ROWS - 1]!) / 2,
  ];
  const outX = Float64Array.from(cx, (x) => Math.max(0, X.lo - x, x - X.hi));
  const outZ = Float64Array.from(cz, (z) => Math.max(0, Z.lo - z, z - Z.hi));
  const shelfWidth = Float64Array.from(cx, (x) => SHELF_WEST + (SHELF_EAST - SHELF_WEST) * smooth(0.45, 0.65, frameU(x)));

  const byte = (t: number) => (t <= 0 ? 0 : t >= 1 ? 255 : (t * 255 + 0.5) | 0);
  const data = new Uint8Array(n * 2);
  for (let j = 0; j < h; j += 1) {
    const r = j - Z.head, oz = outZ[j]!, north = cz[j]! < Z.lo;
    for (let i = 0; i < w; i += 1) {
      const k = j * w + i;
      const c = i - X.head, ox = outX[i]!;
      const land = ground[k]! > 0;
      let metres = 0;
      if (land) metres = 0;
      else if (ox === 0 && oz === 0) {
        // Near an edge the DEM's depths give way to the edge's smoothed depth, which the water outside carries on.
        const dn = r, ds = DEM_ROWS - 1 - r, dw = c, de = DEM_COLS - 1 - c;
        const d = Math.min(dn, ds, dw, de);
        metres = wet[r * DEM_COLS + c]!;
        if (d < EDGE_BAND) {
          const edge = d === dn ? edges.north[c]! : d === ds ? edges.south[c]! : d === dw ? edges.west[r]! : edges.east[r]!;
          metres = edge + (metres - edge) * smooth(0, EDGE_BAND, d + 0.5);
        }
      } else {
        const edge = ox === 0 ? (north ? edges.north[c]! : edges.south[c]!) : oz === 0 ? (c < 0 ? edges.west[r]! : edges.east[r]!) : corners[(c < 0 ? 0 : 1) + (north ? 0 : 2)]!;
        const shelf = DEEP * smooth(0, shelfWidth[i]!, away[k]!);
        metres = edge + (shelf - edge) * smooth(0, SETTLE, Math.sqrt(ox * ox + oz * oz));
      }
      const signed = (land ? -away[k]! : away[k]!) / X.size;
      // The outermost texels, which the sampler carries on past the texture, are open sea.
      const rim = i === 0 || j === 0 || i === w - 1 || j === h - 1;
      data[k * 2] = rim ? 255 : byte(metres / DEEP);
      data[k * 2 + 1] = rim ? 255 : byte((Math.max(-LAND_SIDE, Math.min(SEA_SIDE, signed)) + LAND_SIDE) / (LAND_SIDE + SEA_SIDE));
    }
  }
  const tex = new DataTexture(data, w, h, RGFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/** A colour written in sRGB, as the node graph works in linear light. */
const srgb = (r: number, g: number, b: number) => vec3(...([r, g, b].map((c) => (c / 255) ** 2.2) as [number, number, number]));

/**
 * The sea for the whole world. `heights` are the DEM's metres as the land's facets draw them (groundLand.ts); `facets`
 * the drawn facets of the land and the far land, whose coasts the sea's shallows and surf follow.
 */
export function buildSea(heights: Float32Array, facets: Float32Array[]) {
  const tex = bake(heights, facets);
  const p = positionWorld;
  const sample = texture(tex, vec2(warp(p.x, AXIS_X), warp(p.z, AXIS_Z)));
  const deep = sample.r;
  const coast = sample.g.mul(LAND_SIDE + SEA_SIDE).sub(LAND_SIDE);

  // Pale shoals right at the shore, turquoise over the shallows, blue over the shelf, deep blue offshore. Only a shore
  // has the pale shoals: a bank far out stays turquoise, so it does not read as a hole in the sea.
  const shoal = float(1).sub(smoothstep(0, 0.035, deep)).mul(float(1).sub(smoothstep(1, 4, coast)));
  const shallows = mix(srgb(64, 168, 174), srgb(132, 206, 196), shoal);
  const water = mix(mix(shallows, srgb(30, 110, 150), smoothstep(0.02, 0.17, deep)), srgb(15, 58, 102), smoothstep(0.18, 1, deep));
  const toEye = cameraPosition.sub(p);
  const range = toEye.length();
  const view = toEye.div(range);
  // A slow swell of three crossing sines, a few waves across the screen up close and gone with distance, where it would
  // only shimmer. It moves with the world clock, so it stands still for a player who asks for reduced motion.
  const clock = worldClock;
  const swell = sin(p.x.mul(171).add(p.z.mul(64)).add(clock.mul(0.8)))
    .add(sin(p.z.mul(187).sub(p.x.mul(93)).sub(clock.mul(0.6))))
    .add(sin(p.x.mul(277).sub(p.z.mul(141)).add(clock.mul(1.1))).mul(0.6))
    .mul(float(1).sub(smoothstep(0.15, 0.9, range)));
  // The sky in the water at grazing angles.
  const grazing = float(1).sub(view.y.clamp(0, 1));
  const sky = grazing.mul(grazing).mul(grazing).mul(0.45);
  const lit = mix(water.mul(swell.mul(0.035).add(1)), srgb(150, 188, 214), sky);
  // A thin line of surf along every coast, under a fifth of a texel wide up close and never thinner than about a pixel
  // and a half far off; the land covers whatever of it falls inside the drawn coast.
  const blur = fwidth(coast);
  const width = max(0.18, blur.mul(1.4));
  const surf = float(1).sub(smoothstep(width, width.add(blur.max(0.04)), coast))
    .mul(sin(clock.mul(1.3).add(p.x.mul(900)).add(p.z.mul(600))).mul(0.1).add(0.72));
  const material = new MeshBasicNodeMaterial();
  material.colorNode = mix(lit, srgb(238, 246, 244), surf);

  // Wide enough to reach the far plane from anywhere the camera goes, so the fog, not an edge, ends it at the horizon.
  const geometry = new PlaneGeometry(2 * (FAR + 2), 2 * (FAR + 2)).rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  // After the land, whose facets stand at least 1.5 m above it at every coast.
  mesh.renderOrder = 1;
  return {
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
      tex.dispose();
      mesh.removeFromParent();
    },
  };
}
