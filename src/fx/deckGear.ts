import { BoxGeometry, BufferAttribute, CylinderGeometry, Group, InstancedMesh, Matrix4, MeshStandardNodeMaterial, Quaternion, Vector3, type BufferGeometry } from 'three/webgpu';
import { attribute } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Drums drawn at once: one per ship whose crew is on screen; and lengths of firing step. */
const MAX = 24;
const STEPS = 160;

type Part = { geo: BufferGeometry; color: [number, number, number] };

function painted(parts: Part[]) {
  return mergeGeometries(
    parts.map(({ geo, color }) => {
      const g = geo.index ? geo.toNonIndexed() : geo;
      const n = g.getAttribute('position').count;
      const c = new Float32Array(n * 3);
      for (let i = 0; i < n; i += 1) c.set(color, i * 3);
      g.setAttribute('color', new BufferAttribute(c, 3));
      return g;
    }),
  )!;
}

/**
 * The war drum on its stand, modelled with its heads facing along -z and +z: a lacquered barrel with pale hide heads,
 * set on a wooden frame. Its origin is on the deck under the drum's centre.
 */
function drumGeometry() {
  const R = 0.42;
  const C = 1.2;
  const body = new CylinderGeometry(R, R, 0.56, 14, 1, true);
  body.rotateX(Math.PI / 2);
  body.translate(0, C, 0);
  const heads = [-0.29, 0.29].map((z) => {
    const g = new CylinderGeometry(R + 0.03, R + 0.03, 0.03, 14);
    g.rotateX(Math.PI / 2);
    g.translate(0, C, z);
    return g;
  });
  const legs = [-1, 1].map((s) => {
    const g = new BoxGeometry(0.07, C, 0.07);
    g.translate(s * (R + 0.06), C / 2, 0);
    return g;
  });
  const bar = new BoxGeometry(2 * R + 0.2, 0.06, 0.07);
  bar.translate(0, C + R * 0.2, 0);
  const feet = [-1, 1].map((s) => {
    const g = new BoxGeometry(0.1, 0.06, 0.7);
    g.translate(s * (R + 0.06), 0.03, 0);
    return g;
  });
  return painted([
    { geo: body, color: [0.33, 0.08, 0.06] },
    ...heads.map((geo) => ({ geo, color: [0.72, 0.62, 0.46] as [number, number, number] })),
    ...[...legs, bar, ...feet].map((geo) => ({ geo, color: [0.2, 0.13, 0.08] as [number, number, number] })),
  ]);
}

/** A plank box with its origin at the middle of its underside, for the firing steps. */
function stepGeometry() {
  const g = new BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return painted([{ geo: g, color: [0.15, 0.1, 0.065] }]);
}

/**
 * What the crews use that the ship models do not have: the war drum on its stand and the firing steps along a wall
 * too high to shoot over. Two instanced draws, filled each frame between begin and end.
 */
export class DeckGear {
  readonly group = new Group();
  private readonly mesh: InstancedMesh;
  private readonly steps: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly s = new Vector3();

  constructor() {
    const mat = new MeshStandardNodeMaterial({ roughness: 0.7 });
    mat.colorNode = attribute('color', 'vec3');
    this.mesh = new InstancedMesh(drumGeometry(), mat, MAX);
    this.steps = new InstancedMesh(stepGeometry(), mat, STEPS);
    for (const m of [this.mesh, this.steps]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  begin() {
    this.mesh.count = 0;
    this.steps.count = 0;
  }

  /** A length of firing step standing on the deck at p, turned by q (its length along the local x). */
  step(p: Vector3, q: Quaternion, length: number, height: number, width: number) {
    if (this.steps.count >= STEPS) return;
    this.m.compose(p, q, this.s.set(length, height, width));
    this.steps.setMatrixAt(this.steps.count, this.m);
    this.steps.count += 1;
  }

  /** A drum standing at p, turned by q (its heads along the local z), scaled with the men around it. */
  put(p: Vector3, q: Quaternion, scale: number) {
    if (this.mesh.count >= MAX) return;
    this.m.compose(p, q, this.s.setScalar(scale));
    this.mesh.setMatrixAt(this.mesh.count, this.m);
    this.mesh.count += 1;
  }

  end() {
    for (const m of [this.mesh, this.steps]) {
      m.instanceMatrix.needsUpdate = m.count > 0;
      m.visible = m.count > 0;
    }
  }
}
