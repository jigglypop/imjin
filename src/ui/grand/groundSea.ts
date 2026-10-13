import { DataTexture, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshBasicNodeMaterial, PlaneGeometry, RGFormat, UnsignedByteType } from 'three/webgpu';
import { cameraPosition, float, fwidth, max, mix, positionWorld, sin, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import meta from '../../select/demMeta.json';
import { worldClock } from '../../select/terrain';
import { farCell, farRelief } from './farLand';
import { DEM_RECT } from './mapMath';
import { MAP_ASPECT } from './projection';
import { FAR, worldZ } from './worldCamera';

// The sea of the campaign's 3D world: one plane at sea level out past the far plane, drawn after the land so the depth
// test throws away whatever the land covers. Its colour is cheap: one fetch from a small texture baked once from the
// DEM's heights (the water's depth and the signed distance to the coast), turquoise shallows to deep blue, a thin foam
// line along the coasts, the sky in it at grazing angles and a swell of a few sines moving with the world clock.

/** Texels across the DEM's width: one for every two of the DEM's. */
const TEX_W = 1024;
/** Rows over the DEM's height, and over a band of the far land north of it (farLand.ts) so its coasts get shallows too. */
const DEM_ROWS = 520, NORTH_ROWS = 256;
const TEX_H = DEM_ROWS + NORTH_ROWS;
/** The texture's rectangle in frame coordinates; outside it the sea reads deep. */
const RECT = { u: DEM_RECT.u, w: DEM_RECT.w, v: DEM_RECT.v - (DEM_RECT.h * NORTH_ROWS) / DEM_ROWS, h: (DEM_RECT.h * TEX_H) / DEM_ROWS };
/** Depth in metres at which the water is fully deep: the red channel holds depth over this. */
const DEEP = 160;
/** The green channel holds the signed distance to the coast in texels (sea positive) from -LAND_SIDE to +SEA_SIDE. */
const LAND_SIDE = 1, SEA_SIDE = 15;
/** Texels at the rectangle's sides (and at the far land band's north end) over which the water fades to the deep sea round it. */
const EDGE_X = 48, EDGE_SOUTH = 40, EDGE_NORTH = 64;
/** Metres of depth per texel from the coast at most, along the far land's coasts, which have no surveyed seabed. */
const SHELF = 5;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Distance in texels from every texel to the nearest land texel (0 on land), by two chamfer passes with steps of 3 and 4
 * thirds of a texel straight and diagonally: within a few per cent of the true distance, enough for a foam line and
 * shallows a few texels wide.
 */
function distanceToLand(land: Uint8Array, w: number, h: number) {
  const d = new Uint16Array(w * h);
  const far = 65535;
  for (let i = 0; i < d.length; i += 1) d[i] = land[i] ? 0 : far;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      let v = d[i]!, c: number;
      if (v === 0) continue;
      if (x > 0 && (c = d[i - 1]! + 3) < v) v = c;
      if (y > 0) {
        if ((c = d[i - w]! + 3) < v) v = c;
        if (x > 0 && (c = d[i - w - 1]! + 4) < v) v = c;
        if (x < w - 1 && (c = d[i - w + 1]! + 4) < v) v = c;
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y -= 1) {
    for (let x = w - 1; x >= 0; x -= 1) {
      const i = y * w + x;
      let v = d[i]!, c: number;
      if (v === 0) continue;
      if (x < w - 1 && (c = d[i + 1]! + 3) < v) v = c;
      if (y < h - 1) {
        if ((c = d[i + w]! + 3) < v) v = c;
        if (x < w - 1 && (c = d[i + w + 1]! + 4) < v) v = c;
        if (x > 0 && (c = d[i + w - 1]! + 4) < v) v = c;
      }
      d[i] = v;
    }
  }
  return d;
}

/**
 * The sea's texture: red is the depth (the DEM's own seabed, a shelf along the far land's coasts), green the signed
 * distance to the coast. Both fade to the open sea at the rectangle's edges, which the sampler carries on outside it.
 */
function bake(heights: Float32Array) {
  const W = meta.width, H = meta.height;
  const n = TEX_W * TEX_H;
  const land = new Uint8Array(n);
  const depth = new Float32Array(n);
  // Over the DEM: land where most of the four DEM texels round a texel's centre are, which is the coast as the land's
  // facets draw it (groundLand.ts writes them into the heights); the depth is the mean of the wet ones.
  const column = new Int32Array(TEX_W), across = new Float32Array(TEX_W);
  for (let i = 0; i < TEX_W; i += 1) {
    const x = Math.min(W - 1.001, ((i + 0.5) / TEX_W) * (W - 1));
    column[i] = Math.floor(x);
    across[i] = x - column[i]!;
  }
  for (let r = NORTH_ROWS; r < TEX_H; r += 1) {
    const v = RECT.v + ((r + 0.5) / TEX_H) * RECT.h;
    const y = Math.min(H - 1.001, ((v - DEM_RECT.v) / DEM_RECT.h) * (H - 1));
    const y0 = Math.floor(y), fy = y - y0;
    for (let i = 0; i < TEX_W; i += 1) {
      const fx = across[i]!, k = y0 * W + column[i]!;
      const a = heights[k]!, b = heights[k + 1]!, c = heights[k + W]!, d = heights[k + W + 1]!;
      const wa = (1 - fx) * (1 - fy), wb = fx * (1 - fy), wc = (1 - fx) * fy, wd = fx * fy;
      const share = (a > 0 ? wa : 0) + (b > 0 ? wb : 0) + (c > 0 ? wc : 0) + (d > 0 ? wd : 0);
      const deep = (a > 0 ? 0 : wa * Math.min(DEEP, -a)) + (b > 0 ? 0 : wb * Math.min(DEEP, -b)) + (c > 0 ? 0 : wc * Math.min(DEEP, -c)) + (d > 0 ? 0 : wd * Math.min(DEEP, -d));
      land[r * TEX_W + i] = share > 0.5 ? 1 : 0;
      depth[r * TEX_W + i] = share < 1 ? deep / (1 - share) : 0;
    }
  }
  // North of it, the far land's relief at every fourth texel each way (its own facets are about as coarse there), in
  // between linear.
  const relief = farRelief(heights);
  const STEP = 4;
  const CW = TEX_W / STEP + 1, CH = NORTH_ROWS / STEP + 1;
  const coarse = new Float32Array(CW * CH);
  const north = (r: number) => worldZ(DEM_RECT.v) - worldZ(RECT.v + ((r + 0.5) / TEX_H) * RECT.h);
  for (let b = 0; b < CH; b += 1) {
    const z = worldZ(DEM_RECT.v) - north(b * STEP);
    const cell = farCell(north(b * STEP));
    for (let a = 0; a < CW; a += 1) coarse[b * CW + a] = relief(RECT.u + ((a * STEP + 0.5) / TEX_W) * RECT.w, z, cell);
  }
  /** How much the far land's shelf rule applies to a row: none on the DEM, fully where the far land's own hills are. */
  const shelf = new Float32Array(TEX_H);
  for (let r = 0; r < NORTH_ROWS; r += 1) {
    shelf[r] = smooth(0.015, 0.1, north(r));
    const b = Math.floor(r / STEP), ty = (r % STEP) / STEP;
    for (let i = 0; i < TEX_W; i += 1) {
      const a = Math.floor(i / STEP), tx = (i % STEP) / STEP, k = b * CW + a;
      const top = coarse[k]! + (coarse[k + 1]! - coarse[k]!) * tx;
      const bottom = coarse[k + CW]! + (coarse[k + CW + 1]! - coarse[k + CW]!) * tx;
      const m = top + (bottom - top) * ty;
      land[r * TEX_W + i] = m > 0 ? 1 : 0;
      depth[r * TEX_W + i] = Math.min(DEEP, Math.max(0, -m));
    }
  }
  const toLand = distanceToLand(land, TEX_W, TEX_H);
  const edgeX = new Float32Array(TEX_W);
  for (let i = 0; i < TEX_W; i += 1) edgeX[i] = Math.min(smooth(0, EDGE_X, i + 0.5), smooth(0, EDGE_X, TEX_W - i - 0.5));
  const byte = (t: number) => (t <= 0 ? 0 : t >= 1 ? 255 : (t * 255 + 0.5) | 0);
  const data = new Uint8Array(n * 2);
  for (let r = 0; r < TEX_H; r += 1) {
    const edgeY = Math.min(smooth(0, EDGE_NORTH, r + 0.5), smooth(0, EDGE_SOUTH, TEX_H - r - 0.5));
    const rule = shelf[r]!;
    for (let i = 0; i < TEX_W; i += 1) {
      const k = r * TEX_W + i;
      const edge = edgeY < edgeX[i]! ? edgeY : edgeX[i]!;
      const away = toLand[k]! / 3;
      // The coast lies halfway between a land texel and its wet neighbour.
      const signed = land[k] ? -0.5 : away - 0.5;
      const wet = depth[k]!;
      const metres = rule > 0 ? wet + (Math.min(wet, away * SHELF) - wet) * rule : wet;
      data[k * 2] = byte(1 + (metres / DEEP - 1) * edge);
      data[k * 2 + 1] = byte((SEA_SIDE + (signed - SEA_SIDE) * edge + LAND_SIDE) / (LAND_SIDE + SEA_SIDE));
    }
  }
  const tex = new DataTexture(data, TEX_W, TEX_H, RGFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/** A colour written in sRGB, as the node graph works in linear light. */
const srgb = (r: number, g: number, b: number) => vec3(...([r, g, b].map((c) => (c / 255) ** 2.2) as [number, number, number]));

/** The sea for the whole world. `heights` are the DEM's metres as the land's facets draw them (groundLand.ts). */
export function buildSea(heights: Float32Array) {
  const tex = bake(heights);
  const p = positionWorld;
  // Frame point to texture: u = x + 0.5 and v = z * MAP_ASPECT + 0.5, placed by the texture's rectangle.
  const at = vec2(p.x.mul(1 / RECT.w).add((0.5 - RECT.u) / RECT.w), p.z.mul(MAP_ASPECT / RECT.h).add((0.5 - RECT.v) / RECT.h));
  const sample = texture(tex, at);
  const deep = sample.r;
  const coast = sample.g.mul(LAND_SIDE + SEA_SIDE).sub(LAND_SIDE);

  // Turquoise over the shallows, blue over the shelf, deep blue offshore: the old relief shader's water.
  const water = mix(mix(srgb(78, 172, 172), srgb(32, 112, 152), smoothstep(0, 28 / DEEP, deep)), srgb(14, 56, 98), smoothstep(0, 1, deep));
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
  // A thin line of surf along every coast, half a texel wide up close and never thinner than about two pixels far off;
  // the land covers whatever of it falls inside the drawn coast.
  const blur = fwidth(coast);
  const width = max(0.45, blur.mul(1.5));
  const surf = float(1).sub(smoothstep(width, width.add(blur.max(0.05)), coast))
    .mul(sin(clock.mul(1.3).add(p.x.mul(900)).add(p.z.mul(600))).mul(0.12).add(0.5));
  const material = new MeshBasicNodeMaterial();
  material.colorNode = mix(lit, srgb(236, 244, 244), surf);

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
