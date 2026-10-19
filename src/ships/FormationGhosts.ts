import { Euler, Group, InstancedMesh, Matrix4, MeshBasicNodeMaterial, Quaternion, Vector3, type BufferGeometry } from 'three/webgpu';
import { float, normalView, positionViewDirection, pow, vec3 } from 'three/tsl';
import type { Battle } from '../sim/battle';
import type { FormationSlot } from '../game/formationLayout';
import type { ShipViews } from './ShipViews';
import { modelScale } from './anchors';
import type { ModelAsset } from './ShipRenderer';

/** The --own blue of the HUD, in linear-ish terms for an unlit material. */
const GHOST = vec3(0.36, 0.62, 0.9);

/**
 * The formation being placed, drawn as the fleet's own ships in translucent blue on the very slots they will take,
 * each turned the way it will lie: the player checks where and how the formation stands before laying it.
 * Each model's coarsest level of detail is enough for a ghost.
 */
export class FormationGhosts {
  readonly group = new Group();
  private readonly material = new MeshBasicNodeMaterial();
  private readonly meshes = new Map<BufferGeometry, InstancedMesh>();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly p = new Vector3();
  private readonly s = new Vector3();

  constructor(
    private readonly views: ShipViews,
    private readonly assets: () => Record<string, ModelAsset>,
  ) {
    const m = this.material;
    // Brighter where the hull turns away from the eye, so a ghost reads as a ship and not as a flat blue cut-out.
    const facing = normalView.dot(positionViewDirection).abs();
    m.colorNode = GHOST;
    m.opacityNode = float(0.12).add(pow(float(1).sub(facing), float(2)).mul(0.38));
    m.transparent = true;
    m.depthWrite = false;
    m.fog = false;
    this.group.renderOrder = 4;
  }

  update(battle: Battle, slots: FormationSlot[] | null) {
    for (const mesh of this.meshes.values()) mesh.count = 0;
    if (slots?.length) {
      const assets = this.assets();
      for (const slot of slots) {
        const ship = battle.get(slot.id);
        const v = this.views.states.get(slot.id);
        const asset = v && assets?.[v.key];
        if (!ship || !asset?.lods.length) continue;
        const lod = asset.lods[asset.lods.length - 1]!;
        const y = battle.waves.heightAt(slot.x, slot.z, battle.waves.time, 8);
        this.e.set(0, -slot.face, 0, 'YZX');
        this.q.setFromEuler(this.e);
        const k = (ship.flagship ? 1.12 : 1) * modelScale(ship.spec.kind);
        this.m.compose(this.p.set(slot.x, y, slot.z), this.q, this.s.setScalar(k));
        for (const part of lod.parts?.length ? lod.parts : [lod]) {
          const mesh = this.mesh(part.geometry, slots.length);
          mesh.setMatrixAt(mesh.count++, this.m);
        }
      }
      for (const mesh of this.meshes.values()) if (mesh.count) mesh.instanceMatrix.needsUpdate = true;
    }
    for (const mesh of this.meshes.values()) mesh.visible = mesh.count > 0;
  }

  private mesh(geometry: BufferGeometry, need: number) {
    let mesh = this.meshes.get(geometry);
    if (mesh && mesh.instanceMatrix.count >= need) return mesh;
    if (mesh) {
      this.group.remove(mesh);
      mesh.dispose();
    }
    mesh = new InstancedMesh(geometry, this.material, Math.max(16, need));
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    this.meshes.set(geometry, mesh);
    this.group.add(mesh);
    return mesh;
  }

  /** A battle ends: its models go with it, so the meshes built on them do too. The models are the battle's to free. */
  clear() {
    for (const mesh of this.meshes.values()) mesh.dispose();
    this.meshes.clear();
    this.group.clear();
  }

  dispose() {
    this.clear();
    this.material.dispose();
  }
}
