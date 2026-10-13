import { BackSide, BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshBasicNodeMaterial, SphereGeometry, type DataTexture } from 'three/webgpu';
import { mix, positionLocal, smoothstep, vec3 } from 'three/tsl';
import { equipment } from '../../game/quality';
import { disposeTree } from '../../render/dispose';
import { MAP_H } from '../../select/demFrame';
import { buildFarLandMaterial, buildSea, buildTerrain, loadDem } from '../../select/terrain';
import { MAP_ASPECT } from './projection';
import { DEM_RECT, MESH_SCALE, groundElevation } from './mapMath';
import { buildFarLand, MIRROR_SHEAR, type FarLand } from './farLand';
import { FAR, type CameraState } from './worldCamera';
import { SKY_HORIZON, SKY_MIDDLE, SKY_ZENITH, WORLD_HAZE } from './worldLook';

/** The ground of the campaign's 3D world: the land, the sea, the land north of the DEM, the sky and the haze. */
export interface WorldGround {
  /** Everything the ground draws; added to the scene once. */
  readonly group: Group;
  /** The DEM's metre heights (row-major, demMeta.width x demMeta.height), which groundElevation (mapMath.ts) reads to set markers, camps and ships on the ground. */
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

/** The mainland north of the DEM, on to the horizon (farLand.ts). */
function farLandMesh(far: FarLand, demTex: DataTexture) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(far.position, 3));
  geometry.setAttribute('local', new BufferAttribute(far.local, 2));
  geometry.setAttribute('hills', new BufferAttribute(far.hills, 1));
  geometry.setAttribute('hillNormal', new BufferAttribute(far.hillNormal, 3));
  geometry.setAttribute('blend', new BufferAttribute(far.blend, 1));
  geometry.setIndex(new BufferAttribute(far.index, 1));
  // Coloured by the terrain's own shader, so the join with the DEM does not show.
  const mesh = new Mesh(geometry, buildFarLandMaterial(demTex, MIRROR_SHEAR));
  mesh.frustumCulled = false;
  return mesh;
}

/** A dome that follows the eye: the haze at the horizon, deepening to blue overhead, with the sun's warm glow low in the north-west. */
function skyDome() {
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
  const { heights, tex } = await loadDem(signal);
  if (signal.aborted) {
    tex.dispose();
    signal.throwIfAborted();
  }
  const group = new Group();
  // The mesh is built in the select screen's units; the group fits it to its rectangle of the campaign frame.
  const terrain = new Group();
  terrain.add(buildTerrain(tex, equipment.select.mapSegments, true));
  terrain.scale.set(MESH_SCALE, MESH_SCALE, DEM_RECT.h / MAP_ASPECT / MAP_H);
  terrain.position.set(DEM_RECT.u + DEM_RECT.w / 2 - 0.5, 0, (DEM_RECT.v + DEM_RECT.h / 2 - 0.5) / MAP_ASPECT);
  group.add(terrain);
  // The ocean round the DEM, wide enough to reach the far plane from anywhere the camera goes, so the fog, not an edge,
  // ends it at the horizon. It lies far enough under the terrain's own sea (about 60 m of the relief's scale) that the
  // depth buffer still tells the two apart from the widest view; seen from above, the step at the DEM's edge is not.
  const sea = buildSea(2 * (FAR + 2));
  sea.position.set(0, -0.0005, 0);
  group.add(sea);
  const far = buildFarLand(heights);
  group.add(farLandMesh(far, tex));
  const sky = skyDome();
  group.add(sky);
  let disposed = false;
  return {
    group,
    heights,
    haze: WORLD_HAZE,
    // Trees stand on the far land north of the DEM too, so the woods run on across the join.
    heightAt: (u, v) => (v < DEM_RECT.v ? far.heightAt(u, v) : groundElevation(heights, u, v)),
    // The fog starts a little beyond the target and is solid well past the whole frame, so distant ridges and coasts stay
    // readable in a soft haze.
    fog: (distance) => ({ near: distance * 1.1 + 0.05, far: distance * 3.4 + 1.1 }),
    update(eye) {
      sky.position.set(eye.x, eye.y, eye.z);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeTree(group);
      tex.dispose();
    },
  };
}
