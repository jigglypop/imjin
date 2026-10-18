import {
  AmbientLight, DirectionalLight, Group, MeshStandardNodeMaterial, Quaternion, Vector3,
  type Material, type Mesh, type Object3D, type PerspectiveCamera, type Scene as ThreeScene,
} from 'three/webgpu';
import { lights } from 'three/tsl';
import { createFigure, holdWeapon, listModels, loader, modelUrl, playFigure, releaseFigure, standFigure, weaponUrl, type Figure } from '../ui/generals/GeneralModel';
import { WEAPONS } from '../meta/catalog';
import type { Ship } from '../sim/types';
import type { Place } from './rig';
import type { CastLight, CastMember, SceneContext } from './types';

/** What the cast reads from the engine: the ships' transforms and where each one's captain stands. */
export interface CastHost {
  readonly scene: ThreeScene;
  readonly camera: PerspectiveCamera;
  localToWorld(id: number, x: number, y: number, z: number, out: Vector3): Vector3;
  shipScale(id: number): number;
  commandPost(ship: Ship): { x: number; y: number; z: number } | null;
  /** Ships whose own captain figure steps aside while the commander stands there. */
  readonly standIns: Set<number>;
}

/**
 * Film light on the figures only (their materials get their own lights node; the battle's lights and shaders are not
 * touched, so nothing in the scene recompiles): a key from the camera's left front, a rim from behind on the other
 * side, and a soft fill. Colours and strengths follow the battle's light.
 */
const LIGHT: Record<CastLight, { key: [number, number]; rim: [number, number]; fill: [number, number] }> = {
  day: { key: [0xfff1dc, 2.6], rim: [0xd8e6ff, 3.2], fill: [0x8a9bb0, 0.55] },
  overcast: { key: [0xe9ecf0, 2.1], rim: [0xcfdcec, 2.6], fill: [0x8796a6, 0.6] },
  dusk: { key: [0xffc58a, 2.4], rim: [0xffa766, 3.4], fill: [0x6f6a80, 0.5] },
  // Moonlight from behind, a warm lantern key in front.
  night: { key: [0xffb36b, 1.9], rim: [0x9fb8ff, 3.6], fill: [0x2c3550, 0.5] },
};

type Member = { def: CastMember; figure: Figure | null; holder: Group; ship: number; facing: number; failed: boolean; post?: { x: number; y: number; z: number } | null };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const shipOf = (got: Ship | Ship[] | undefined) => (Array.isArray(got) ? got[0] : got);
function centre(got: Ship | Ship[] | undefined) {
  const ships = got ? (Array.isArray(got) ? got : [got]) : [];
  if (!ships.length) return null;
  let x = 0;
  let z = 0;
  for (const s of ships) {
    x += s.x;
    z += s.z;
  }
  return { x: x / ships.length, z: z / ships.length };
}

/**
 * The commanders of one scene, loaded from their live figures (the same files, LODs, weapon grip and clips as the
 * generals screen) and stood at the captain's post of their flagships for the close-ups. Everything it loads is freed
 * when the scene ends.
 */
export class Cast {
  private readonly members = new Map<string, Member>();
  private readonly group = new Group();
  private readonly key = new DirectionalLight();
  private readonly rim = new DirectionalLight();
  private readonly fill = new AmbientLight();
  private readonly lightsNode = lights([this.key, this.rim, this.fill]);
  private readonly tmp = new Vector3();
  private readonly q = new Quaternion();
  private disposed = false;

  constructor(private readonly host: CastHost, cast: Record<string, CastMember>, light: CastLight, ctx: SceneContext) {
    this.group.name = 'cinema_cast';
    const l = LIGHT[light];
    this.key.color.set(l.key[0]);
    this.key.intensity = l.key[1];
    this.rim.color.set(l.rim[0]);
    this.rim.intensity = l.rim[1];
    this.fill.color.set(l.fill[0]);
    this.fill.intensity = l.fill[1];
    host.scene.add(this.group);
    for (const [name, def] of Object.entries(cast)) {
      const holder = new Group();
      holder.visible = false;
      this.group.add(holder);
      const member: Member = { def, figure: null, holder, ship: 0, facing: 0, failed: false };
      this.members.set(name, member);
      this.aim(member, ctx);
      void this.load(member);
    }
  }

  private async load(m: Member) {
    try {
      const live = await listModels();
      if (!live.has(m.def.file)) throw new Error(`${m.def.file} is not live`);
      const weaponDef = WEAPONS.find((w) => w.id === m.def.weapon);
      const [gltf, weapon] = await Promise.all([loader.loadAsync(modelUrl(m.def.file)), weaponDef ? loader.loadAsync(weaponUrl(weaponDef.id)) : null]);
      const asset = gltf.scene;
      const figure = createFigure(asset, gltf.animations, weaponDef?.kind ?? 'sword');
      if (weapon && weaponDef) {
        // Posed weapons leave their bind-pose bounds (as on the generals screen): never culled.
        weapon.scene.traverse((o) => (o.frustumCulled = false));
        figure.weapon = holdWeapon(figure.root, weapon.scene, weaponDef);
      }
      if (this.disposed) {
        releaseFigure(figure);
        return;
      }
      this.relight(figure.root);
      m.figure = figure;
      m.holder.add(figure.root);
    } catch (e) {
      // No figure: the close-up falls back to his ship and his line comes with his portrait.
      m.failed = true;
      if (import.meta.env.DEV) console.warn('[cinema] cast figure', m.def.file, e);
    }
  }

  /** The figures' materials as node materials with the film lights of their own; the textures stay shared. */
  private relight(root: Object3D) {
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const swap = (m: Material) => {
        const n = new MeshStandardNodeMaterial();
        for (const k in m) if (k !== 'uuid' && k !== 'id' && k !== 'type') (n as unknown as Record<string, unknown>)[k] = (m as unknown as Record<string, unknown>)[k];
        n.lightsNode = this.lightsNode;
        n.needsUpdate = true;
        m.dispose();
        return n;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });
  }

  /** His ship and the bearing he faces (toward the enemy he names), looked up again while he is not on screen. */
  private aim(m: Member, ctx: SceneContext) {
    const ship = shipOf(m.def.ship(ctx));
    if (!ship) return;
    m.ship = ship.id;
    const to = centre(m.def.facing(ctx));
    if (to) m.facing = Math.atan2(to.z - ship.z, to.x - ship.x);
  }

  /** Whether `name`'s figure is standing on his deck. */
  ready(name: string) {
    const m = this.members.get(name);
    return !!m?.figure && m.holder.visible;
  }

  failed(name: string) {
    return !!this.members.get(name)?.failed;
  }

  /** His feet on deck and the way he faces, in the rig's terms (heading 0 along +x). */
  place(name: string): Place | null {
    const m = this.members.get(name);
    if (!m?.figure || !m.holder.visible) return null;
    const p = m.holder.position;
    return { x: p.x, y: p.y, z: p.z, heading: m.facing, size: 2 };
  }

  act(name: string, move: 'command' | 'stand') {
    const f = this.members.get(name)?.figure;
    if (!f) return;
    if (move === 'command') playFigure(f, 'command');
    else standFigure(f);
  }

  /** Per frame: each figure at his post, turned toward the enemy, his clip advanced; the lights placed for this camera. */
  update(dt: number, ctx: SceneContext, on: string | null) {
    for (const [name, m] of this.members) {
      if (!m.figure) continue;
      const ship = ctx.battle.get(m.ship);
      if (!ship || !ship.alive) {
        m.holder.visible = false;
        this.host.standIns.delete(m.ship);
        continue;
      }
      if (name !== on) this.aim(m, ctx);
      // He turns on his deck toward the enemy, but keeps within a third of a right angle of the bow: further round, the
      // camera a few metres in front of him would stand outside the hull, looking at its shield wall.
      const off = Math.max(-0.55, Math.min(0.55, wrap(m.facing - ship.heading)));
      m.facing = ship.heading + off;
      // His mark is chosen once, so he never steps about the deck between shots.
      m.post ??= this.host.commandPost(ship);
      const post = m.post;
      if (!post) {
        m.holder.visible = false;
        continue;
      }
      this.host.localToWorld(ship.id, post.x, post.y, post.z, this.tmp);
      m.holder.position.copy(this.tmp);
      // The rig's heading 0 is +x; the figure's front is +z after normalising.
      m.holder.quaternion.setFromAxisAngle(this.tmp.set(0, 1, 0), Math.PI / 2 - m.facing);
      m.holder.scale.setScalar(this.host.shipScale(ship.id));
      m.holder.visible = true;
      this.host.standIns.add(ship.id);
      m.figure.mixer.update(dt);
    }
    // Key from the camera's left, above; rim from behind the subject, opposite; both aim at the subject on screen.
    const cam = this.host.camera;
    const subject = on ? this.members.get(on) : undefined;
    const at = subject?.holder.visible ? subject.holder.position : cam.position;
    const right = this.tmp.set(1, 0, 0).applyQuaternion(cam.getWorldQuaternion(this.q));
    const rx = right.x;
    const rz = right.z;
    const fx = at.x - cam.position.x;
    const fz = at.z - cam.position.z;
    const fl = Math.hypot(fx, fz) || 1;
    this.key.position.set(at.x - rx * 6 - (fx / fl) * 6, at.y + 6, at.z - rz * 6 - (fz / fl) * 6);
    this.rim.position.set(at.x + rx * 4 + (fx / fl) * 8, at.y + 4, at.z + rz * 4 + (fz / fl) * 8);
    for (const l of [this.key, this.rim]) {
      l.target.position.set(at.x, at.y + 1.5, at.z);
      l.updateMatrixWorld();
      l.target.updateMatrixWorld();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const m of this.members.values()) {
      this.host.standIns.delete(m.ship);
      if (m.figure) releaseFigure(m.figure);
      m.figure = null;
    }
    this.members.clear();
    this.group.removeFromParent();
    this.group.clear();
  }
}
