import { BufferAttribute, BufferGeometry, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { freeAfterDraw } from '../../render/dispose';
import { MAP, V_SCALE } from './mapTheatre';
import { heroEnabled } from './hero/site';
import { heroGroundReady, prepareHeroGround, shapeLand } from './hero/terrain';
import { DEM_RECT, MESH_SCALE } from './mapMath';
import { worldX, worldZ } from './worldCamera';

// The land of the campaign's 3D world: the DEM cut into facets at build time (scripts/build-grand-terrain.mjs, whose
// header describes the asset), drawn with the land's look (landLook.ts), which lights and colours them smooth from a bake
// of the DEM itself.

const ASSET = MAP.land;
const VERSION = 1;

interface Header {
  width: number;
  height: number;
  vertices: number;
  triangles: number;
  seam: number;
  heightScale: number;
}

/** Fetches the asset's bytes. */
export async function fetchLand(signal: AbortSignal) {
  const response = await fetch(ASSET, { signal });
  if (!response.ok) throw new Error(`${ASSET}: ${response.status}`);
  return response.arrayBuffer();
}

/** The land's mesh and its north edge, where the far land (farLand.ts) joins it. */
export interface GroundLand {
  readonly mesh: Mesh<BufferGeometry, MeshBasicNodeMaterial>;
  /** The drawn facets, nine floats each (x, y, z of three corners, y in frame units), for the sea to bake its coasts from before the first draw frees them (freeAfterDraw). */
  readonly facets: Float32Array;
  /** Every vertex of the DEM's north row, west to east: its frame u and its height in metres. */
  readonly seam: { u: Float32Array; metres: Float32Array };
  dispose(): void;
}

/**
 * Builds the land from the asset's bytes. It also writes the drawn ground into `heights` (the DEM's metres on its own
 * grid): land takes the facets' heights and a shore texel the facets sank under the sea plane reads as sea, so whatever
 * stands on `heights` (markers, camps, ships, trees) stands on the land as drawn, and no ship is set on drawn land.
 */
export async function buildLand(buffer: ArrayBuffer, heights: Float32Array): Promise<GroundLand> {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'IMJT' || view.getUint32(4, true) !== VERSION) throw new Error(`${ASSET}: not a terrain of version ${VERSION}`);
  const jsonLength = view.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, jsonLength))) as Header;
  const pad4 = (n: number) => (n + 3) & ~3;
  let offset = 12 + pad4(jsonLength);
  const stream = () => {
    const length = view.getUint32(offset, true);
    const bytes = new Uint8Array(buffer, offset + 4, length);
    offset += 4 + pad4(length);
    return bytes;
  };
  const vertexStream = stream(), indexStream = stream(), seamStream = stream();

  await MeshoptDecoder.ready;
  const vertexBytes = new Uint8Array(header.vertices * 8);
  MeshoptDecoder.decodeVertexBuffer(vertexBytes, header.vertices, 8, vertexStream);
  const indexBytes = new Uint8Array(header.triangles * 12);
  MeshoptDecoder.decodeIndexBuffer(indexBytes, header.triangles * 3, 4, indexStream);
  const grid = new Uint16Array(vertexBytes.buffer);
  const decimetres = new Int16Array(vertexBytes.buffer);
  const index = new Uint32Array(indexBytes.buffer);

  // Vertices on the DEM's texel grid, placed where groundElevation (mapMath.ts) reads the DEM: x = u * (width - 1).
  const W = header.width, H = header.height;
  const n = header.vertices;
  const metres = new Float32Array(n);
  const world = new Float32Array(n * 3);
  const lift = V_SCALE * MESH_SCALE;
  // The hero camps' terraces are cut into the land before it is drawn, from the DEM as loaded (hero/terrain.ts).
  if (heroEnabled()) prepareHeroGround(heights);
  const shaped = heroGroundReady();
  for (let i = 0; i < n; i += 1) {
    let h = decimetres[i * 4 + 2]! * header.heightScale, sink = 0;
    const u = DEM_RECT.u + (grid[i * 4]! / (W - 1)) * DEM_RECT.w, v = DEM_RECT.v + (grid[i * 4 + 1]! / (H - 1)) * DEM_RECT.h;
    if (shaped && h > 0) ({ metres: h, sink } = shapeLand(u, v, h));
    metres[i] = h;
    world[i * 3] = worldX(u);
    world[i * 3 + 1] = (h - sink) * lift;
    world[i * 3 + 2] = worldZ(v);
  }
  drawHeights(heights, W, H, grid, metres, index);

  // The facets share their vertices: the land's look (landLook.ts) shades them smooth from its bake of the DEM, so nothing
  // is kept per facet. The sea bakes its coasts from the facets laid out one by one, which it is given and then drops.
  const triangles = header.triangles;
  const facets = new Float32Array(triangles * 9);
  const order = new Uint32Array(triangles * 3);
  for (let t = 0; t < triangles; t += 1) {
    const a = index[t * 3]!;
    let b = index[t * 3 + 1]!, c = index[t * 3 + 2]!;
    const ux = world[b * 3]! - world[a * 3]!, uz = world[b * 3 + 2]! - world[a * 3 + 2]!;
    const vx = world[c * 3]! - world[a * 3]!, vz = world[c * 3 + 2]! - world[a * 3 + 2]!;
    // Front faces look up: three.js takes a counter-clockwise triangle as facing the viewer.
    if (uz * vx - ux * vz < 0) [b, c] = [c, b];
    order[t * 3] = a; order[t * 3 + 1] = b; order[t * 3 + 2] = c;
    const o = t * 9;
    for (const [k, v] of [[0, a], [3, b], [6, c]] as const) {
      facets[o + k] = world[v * 3]!;
      facets[o + k + 1] = world[v * 3 + 1]!;
      facets[o + k + 2] = world[v * 3 + 2]!;
    }
  }

  const seamGrid = new Uint16Array(seamStream.buffer, seamStream.byteOffset, header.seam * 2);
  const seamHeights = new Int16Array(seamStream.buffer, seamStream.byteOffset, header.seam * 2);
  const seam = { u: new Float32Array(header.seam), metres: new Float32Array(header.seam) };
  for (let i = 0; i < header.seam; i += 1) {
    seam.u[i] = DEM_RECT.u + (seamGrid[i * 2]! / (W - 1)) * DEM_RECT.w;
    seam.metres[i] = seamHeights[i * 2 + 1]! * header.heightScale;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(world, 3));
  geometry.setIndex(new BufferAttribute(order, 1));
  // Its colour is the land's look (landLook.ts), which the ground gives it once the light is baked.
  const material = new MeshBasicNodeMaterial();
  const mesh = new Mesh(geometry, material);
  // The DEM fills most of any view and its arrays are freed after the first draw, so there is no bounding volume to cull by.
  mesh.frustumCulled = false;
  freeAfterDraw(mesh);
  return {
    mesh,
    facets,
    seam,
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.removeFromParent();
    },
  };
}

/**
 * Writes the land as the facets draw it into `heights`: every texel under a facet that stands above the sea plane takes
 * the facet's height; land texels that no such facet covers were sunk under the sea plane and read as just below it.
 * The sea keeps the DEM's own depths, which the sea's colour reads.
 */
function drawHeights(heights: Float32Array, W: number, H: number, grid: Uint16Array, metres: Float32Array, index: Uint32Array) {
  for (let i = 0; i < W * H; i += 1) if (heights[i]! > 0) heights[i] = -1;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t]!, b = index[t + 1]!, c = index[t + 2]!;
    const ha = metres[a]!, hb = metres[b]!, hc = metres[c]!;
    if (ha <= 0 && hb <= 0 && hc <= 0) continue;
    const ax = grid[a * 4]!, ay = grid[a * 4 + 1]!, bx = grid[b * 4]!, by = grid[b * 4 + 1]!, cx = grid[c * 4]!, cy = grid[c * 4 + 1]!;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area === 0) continue;
    const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx), minY = Math.min(ay, by, cy), maxY = Math.max(ay, by, cy);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        // Barycentric weights from the edge functions, signed by the triangle's winding so inside is positive.
        const wa = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / area;
        const wb = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / area;
        const wc = 1 - wa - wb;
        if (wa < 0 || wb < 0 || wc < -1e-9) continue;
        const z = ha * wa + hb * wb + hc * wc;
        if (z > 0) heights[y * W + x] = z;
      }
    }
  }
}
