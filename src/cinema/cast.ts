import {
  CanvasTexture, CircleGeometry, Group, Mesh, MeshBasicMaterial, Vector3,
  type Material, type PerspectiveCamera, type Scene as ThreeScene,
} from 'three/webgpu';
import { createFigure, hangSword, holdWeapon, listModels, loader, modelUrl, releaseFigure, standFigure, weaponUrl, type Figure } from '../ui/generals/GeneralModel';
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
  /** A ship's drawn heading (interpolated between sim steps), so he turns with the hull and not in steps. */
  drawnHeading?(ship: Ship): number;
  /** A ship's drawn position (interpolated between sim steps), without the waves' roll and heave. */
  drawnAt?(ship: Ship): { x: number; z: number };
  /** Ships whose own captain figure steps aside while the commander stands there. */
  readonly standIns: Set<number>;
}


type Member = { def: CastMember; figure: Figure | null; holder: Group; ship: number; facing: number; failed: boolean; shown?: boolean; off?: number; steady?: { x: number; y: number; z: number }; steadyFacing?: number; fade?: number; mats?: Material[]; post?: { x: number; y: number; z: number } | null };

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
  private readonly tmp = new Vector3();
  private disposed = false;
  private readonly shadowTex = contactTexture();
  private readonly shadowMat = new MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, color: 0x000000 });
  private readonly shadowGeo = new CircleGeometry(0.75, 24);

  constructor(private readonly host: CastHost, cast: Record<string, CastMember>, _light: CastLight, ctx: SceneContext) {
    this.group.name = 'cinema_cast';
    host.scene.add(this.group);
    for (const [name, def] of Object.entries(cast)) {
      const holder = new Group();
      holder.visible = false;
      // A soft contact shadow under his feet grounds him on the deck.
      const shadow = new Mesh(this.shadowGeo, this.shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.03;
      shadow.renderOrder = 1;
      holder.add(shadow);
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
      // A chapter names its man (`fig_howard`); his figure counts from the day any `<id>__<armor>` file goes live.
      const id = m.def.file.replace(/^fig_/, '');
      const file = live.has(m.def.file) ? m.def.file : [...live].find((k) => k.startsWith(`${id}__`));
      if (!file) throw new Error(`${m.def.file} is not live`);
      const weaponDef = WEAPONS.find((w) => w.id === m.def.weapon);
      const [gltf, weapon] = await Promise.all([loader.loadAsync(modelUrl(file)), weaponDef ? loader.loadAsync(weaponUrl(weaponDef.id)) : null]);
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
      // No film lights of his own (owner 2026-10-18): he takes the scene's sun, sky, fog and exposure like the ships.
      // He fades in over his first half second on deck (opacity only; transparent from the start, so nothing recompiles).
      const mats: Material[] = [];
      figure.root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          mat.transparent = true;
          mat.opacity = 0;
          mats.push(mat);
        }
      });
      m.mats = mats;
      m.fade = 0;
      m.figure = figure;
      m.holder.add(figure.root);
    } catch (e) {
      // No figure: the close-up falls back to a wide shot of his ship; his line stands alone (no portrait card).
      m.failed = true;
      if (import.meta.env.DEV) console.warn('[cinema] cast figure', m.def.file, e);
    }
  }

  /** His ship and the bearing he faces (toward the enemy he names), looked up again while he is not on screen. */
  private aim(m: Member, ctx: SceneContext) {
    const ship = shipOf(m.def.ship(ctx));
    if (!ship) return;
    m.ship = ship.id;
    const to = centre(m.def.facing(ctx));
    if (to) m.facing = Math.atan2(to.z - ship.z, to.x - ship.x);
  }

  /** A cut: every loaded figure may now stand on his deck. */
  reveal() {
    for (const m of this.members.values()) if (m.figure) m.shown = true;
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

  act(name: string, _move: 'stand') {
    const f = this.members.get(name)?.figure;
    if (f) standFigure(f);
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
      // He turns on his deck toward the enemy, but keeps within a third of a right angle of the bow: further round, the
      // camera a few metres in front of him would stand outside the hull, looking at its shield wall. While he speaks
      // his turn on the deck holds, and he swings with the drawn hull (the sim's heading steps would jolt the lens).
      if (name !== on || m.off === undefined) {
        this.aim(m, ctx);
        m.off = Math.max(-0.55, Math.min(0.55, wrap(m.facing - ship.heading)));
      }
      // His turn follows the hull's heavily smoothed, so a yawing hull does not swing the close-up.
      const want = (this.host.drawnHeading?.(ship) ?? ship.heading) + m.off;
      m.facing = m.steadyFacing === undefined || dt <= 0 ? want : m.steadyFacing + wrap(want - m.steadyFacing) * (1 - Math.exp(-dt / 1.6));
      m.steadyFacing = m.facing;
      // His mark is chosen once, so he never steps about the deck between shots.
      m.post ??= this.host.commandPost(ship);
      const post = m.post;
      if (!post) {
        m.holder.visible = false;
        continue;
      }
      this.host.localToWorld(ship.id, post.x, post.y, post.z, this.tmp);
      // Steady on his deck (owner 2026-10-18): he travels with the drawn hull exactly, but the waves' roll, pitch and
      // heave reach him only heavily smoothed, so his face holds still in the close-up (his feet are out of frame).
      const hull = this.host.drawnAt?.(ship);
      if (hull && m.steady && dt > 0) {
        const k = 1 - Math.exp(-dt / 1.6);
        const ky = 1 - Math.exp(-dt / 3);
        m.steady.x += (this.tmp.x - hull.x - m.steady.x) * k;
        m.steady.z += (this.tmp.z - hull.z - m.steady.z) * k;
        m.steady.y += (this.tmp.y - m.steady.y) * ky;
        this.tmp.set(hull.x + m.steady.x, m.steady.y, hull.z + m.steady.z);
      } else if (hull) m.steady = { x: this.tmp.x - hull.x, y: this.tmp.y, z: this.tmp.z - hull.z };
      m.holder.position.copy(this.tmp);
      // The rig's heading 0 is +x; the figure's front is +z after normalising.
      m.holder.quaternion.setFromAxisAngle(this.tmp.set(0, 1, 0), Math.PI / 2 - m.facing);
      m.holder.scale.setScalar(this.host.shipScale(ship.id));
      // He only comes on deck at a cut (reveal), never in front of the camera.
      m.holder.visible = !!m.shown;
      this.host.standIns.add(ship.id);
      m.figure.mixer.update(dt);
      if (m.shown && m.mats && (m.fade ?? 0) < 1) {
        m.fade = Math.min(1, (m.fade ?? 0) + dt / 0.5);
        const o = m.fade * m.fade * (3 - 2 * m.fade);
        for (const mat of m.mats) mat.opacity = o;
      }
      // The held sword hangs outside the body as on the generals screen (idleBlade.ts).
      hangSword(m.figure);
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
    this.shadowGeo.dispose();
    this.shadowMat.dispose();
    this.shadowTex.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}

/** A radial falloff for the contact shadow (black centre to clear edge). */
function contactTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(0,0,0,0.55)');
  r.addColorStop(0.55, 'rgba(0,0,0,0.25)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}
