import { BackSide, Color, Group, Mesh, MeshBasicNodeMaterial, SphereGeometry } from 'three/webgpu';
import { mix, positionLocal, smoothstep, vec3 } from 'three/tsl';
import demMeta from '../../select/demMeta.json';
import { V_SCALE } from '../../select/demFrame';
import { loadDem } from '../../select/terrain';
import { buildFarLandMesh } from './farLand';
import { buildLand, fetchLand } from './groundLand';
import { buildSea } from './groundSea';
import { DEM_RECT, MESH_SCALE } from './mapMath';
import { FAR, type CameraState } from './worldCamera';
import { SKY_HORIZON, SKY_MIDDLE, SKY_ZENITH, WORLD_HAZE } from './worldLook';

/** The ground of the campaign's 3D world: the land, the sea, the land north of the DEM, the sky and the haze. */
export interface WorldGround {
  /** Everything the ground draws; added to the scene once. */
  readonly group: Group;
  /**
   * The DEM's metre heights (row-major, demMeta.width x demMeta.height), which groundElevation (mapMath.ts) reads to set
   * markers, camps and ships on the ground. Land reads as the facets draw it (groundLand.ts), so all of them stand on it.
   */
  readonly heights: Float32Array;
  /** The haze colour as a CSS hex string: the scene background and the fog colour. */
  readonly haze: string;
  /** Ground height in frame units at a frame point anywhere in the world, the far land north of the DEM included; 0 on water. Trees stand on it. */
  heightAt(u: number, v: number): number;
  /** Fog distances in frame units for a camera standing `distance` from the point it looks at. */
  fog(distance: number): { near: number; far: number };
  /** Every drawn frame, after the camera is placed: `eye` is the camera's world position (the sky dome follows it), `clock` the world clock in seconds (it stands still under reduced motion). */
  update(eye: { x: number; y: number; z: number }, cam: CameraState, clock: number): void;
  /** Frees every geometry, material and texture the ground made. */
  dispose(): void;
}

/** A dome that follows the eye: the haze at the horizon, deepening to blue overhead, with the sun's warm glow low in the north-west. */
function buildSky() {
  const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false });
  const rgb = (hex: string) => { const c = new Color(hex); return vec3(c.r, c.g, c.b); };
  const up = positionLocal.y.max(0);
  const dome = mix(mix(rgb(SKY_HORIZON), rgb(SKY_MIDDLE), smoothstep(0, 0.28, up)), rgb(SKY_ZENITH), smoothstep(0.22, 0.85, up));
  const toSun = positionLocal.normalize().dot(vec3(-0.55, 0.62, -0.55).normalize());
  material.colorNode = dome.add(vec3(1, 0.86, 0.62).mul(toSun.max(0).pow(14).mul(0.5)));
  const sky = new Mesh(new SphereGeometry(1, 24, 12), material);
  sky.scale.setScalar(FAR * 0.9);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return sky;
}

/** Loads the DEM and builds the ground; rejects with the signal's AbortError when aborted, having freed what it made. */
export async function loadGround(signal: AbortSignal): Promise<WorldGround> {
  // Only the heights: the half-float texture is the select screen's relief, and this world draws its facets instead.
  const [dem, bytes] = await Promise.all([loadDem(signal, { texture: false }), fetchLand(signal)]);
  signal.throwIfAborted();
  const { heights } = dem;
  const made: { dispose(): void }[] = [];
  try {
    const land = await buildLand(bytes, heights);
    made.push(land);
    signal.throwIfAborted();
    const far = buildFarLandMesh(heights, land.seam);
    made.push(far);
    // The sea's shallows and surf follow the coasts the facets of both draw.
    const sea = buildSea(heights, [land.facets, far.facets]);
    made.push(sea);
    const sky = buildSky();
    made.push({ dispose: () => { sky.geometry.dispose(); sky.material.dispose(); } });
    // The land is drawn before the sea plane, so the depth test discards the water wherever land stands above it.
    land.mesh.renderOrder = -1;
    far.mesh.renderOrder = -1;
    sea.mesh.renderOrder = 0;
    const group = new Group();
    group.add(sky, land.mesh, far.mesh, sea.mesh);
    const W = demMeta.width, H = demMeta.height;
    const lift = V_SCALE * MESH_SCALE;
    return {
      group,
      heights,
      haze: WORLD_HAZE,
      heightAt(u, v) {
        if (v < DEM_RECT.v) return far.heightAt(u, v);
        const x = ((u - DEM_RECT.u) / DEM_RECT.w) * (W - 1), y = ((v - DEM_RECT.v) / DEM_RECT.h) * (H - 1);
        if (x < 0 || y < 0 || x > W - 1 || y > H - 1) return 0;
        // Bilinear between the four texels round the point: on a facet that is the facet's own plane.
        const x0 = Math.min(W - 2, Math.floor(x)), y0 = Math.min(H - 2, Math.floor(y));
        const fx = x - x0, fy = y - y0, i = y0 * W + x0;
        const top = heights[i]! + (heights[i + 1]! - heights[i]!) * fx;
        const bottom = heights[i + W]! + (heights[i + W + 1]! - heights[i + W]!) * fx;
        return Math.max(0, top + (bottom - top) * fy) * lift;
      },
      // It starts a little beyond the target and is solid well past the whole frame, so distant ridges and coasts stay readable in a soft haze.
      fog: (distance) => ({ near: distance * 1.1 + 0.05, far: distance * 3.4 + 1.1 }),
      update(eye) {
        sky.position.set(eye.x, eye.y, eye.z);
      },
      dispose() {
        for (const part of made) part.dispose();
        made.length = 0;
        group.removeFromParent();
      },
    };
  } catch (error) {
    for (const part of made) part.dispose();
    throw error;
  }
}
