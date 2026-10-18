import {
  CanvasTexture, CircleGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3, type Object3D,
  type Material, type PerspectiveCamera, type Scene as ThreeScene,
} from 'three/webgpu';
import { createFigure, hangSword, holdWeapon, listModels, loader, modelUrl, releaseFigure, standFigure, weaponUrl, type Figure } from '../ui/generals/GeneralModel';
import { WEAPONS } from '../meta/catalog';
import type { Ship } from '../sim/types';
import type { Place } from './rig';
import { DeckSet } from './set';
import type { CastLight, CastMember, SceneContext } from './types';

/** What the cast reads from the engine: where the ships are drawn, and which ones to leave out of the picture. */
export interface CastHost {
  readonly scene: ThreeScene;
  readonly camera: PerspectiveCamera;
  shipScale(id: number): number;
  /** A ship's drawn position and heading (interpolated between sim steps). */
  drawnAt(ship: Ship): { x: number; z: number; heading: number };
  /** Ships not drawn this frame (hull, crew and lanterns): his flagship while he stands on its set in her place. */
  readonly hidden: Set<number>;
  /** Detail of the sets: 1 on phones. */
  readonly setLod: 0 | 1;
}

type Member = { def: CastMember; figure: Figure | null; holder: Group; ship: number; facing: number; failed: boolean; shown?: boolean; fade?: number; mats?: Material[]; set: DeckSet | null; placed?: boolean; life?: number };

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
 * generals screen), each filmed on his own deck set (set.ts) where his flagship is, the flagship hidden while he is on
 * screen. Only the man speaking is out: the set and the figure show for his close-up alone. Everything it loads is
 * freed when the scene ends.
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
      const member: Member = { def, figure: null, holder, ship: 0, facing: 0, failed: false, set: null };
      this.members.set(name, member);
      this.aim(member, ctx);
      const ship = ctx.battle.get(member.ship);
      if (ship) {
        member.set = new DeckSet(ship.spec.kind, host.setLod, ctx.battle.night);
        this.group.add(member.set.group);
      }
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
      const [gltf, weapon] = await Promise.all([loader.loadAsync(modelUrl(file)), weaponDef ? loader.loadAsync(weaponUrl(weaponDef.id)) : null, m.set?.ready]);
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
    // The lens looks back past him: turned away from his own fleet's centre, his ships stand behind him. Alone or in
    // the middle of them, he faces the enemy.
    const own = centre(ctx.battle.ships.filter((s) => s.alive && s.team === ship.team && s.id !== ship.id));
    if (own && Math.hypot(own.x - ship.x, own.z - ship.z) > 40) m.facing = Math.atan2(ship.z - own.z, ship.x - own.x);
  }

  /** A cut: every loaded figure (with his set) may now come on screen. */
  reveal() {
    for (const m of this.members.values()) if (m.figure && m.set?.loaded) m.shown = true;
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
    const k = m.holder.scale.x;
    const f = m.set?.flag;
    return { x: p.x, y: p.y, z: p.z, heading: m.facing, size: 2, flag: f ? [f[0] * k, f[1] * k, f[2] * k] : undefined };
  }

  act(name: string, _move: 'stand') {
    const f = this.members.get(name)?.figure;
    if (f) standFigure(f);
  }

  /**
   * Per frame: the man speaking (`on`) on his set, which stands still where his flagship was at the cut, facing the
   * enemy he names; his flagship is hidden meanwhile. Everyone else, and every set, is out of the picture.
   */
  update(dt: number, ctx: SceneContext, on: string | null) {
    for (const [name, m] of this.members) {
      const ship = ctx.battle.get(m.ship);
      const live = !!m.figure && !!m.shown && !!m.set?.loaded && !!ship?.alive && name === on;
      if (!live || !ship || !m.figure || !m.set) {
        if (m.placed) this.host.hidden.delete(m.ship);
        m.placed = false;
        m.holder.visible = false;
        if (m.set) m.set.group.visible = false;
        continue;
      }
      if (!m.placed) {
        // Placed once at the cut and never moved: no roll, no heave, no swing, nothing for the lens to tremble with.
        m.placed = true;
        this.aim(m, ctx);
        const at = this.host.drawnAt(ship);
        const scale = this.host.shipScale(ship.id);
        m.set.place(at.x, at.z, m.facing, scale);
        m.holder.position.set(at.x, m.set.height * scale, at.z);
        // The rig's heading 0 is +x; the figure's front is +z after normalising.
        m.holder.quaternion.setFromAxisAngle(this.tmp.set(0, 1, 0), Math.PI / 2 - m.facing);
        m.holder.scale.setScalar(scale);
        this.host.hidden.add(ship.id);
      }
      m.holder.visible = true;
      m.set.group.visible = true;
      m.figure.mixer.update(dt);
      m.set.update(dt);
      // Small life over the pure idle, in films only (owner 2026-10-18): breathing, and slow glances out to sea.
      m.life = (m.life ?? 0) + dt;
      alive(m.figure, m.life, m.def.file.length);
      // He is there from the cut's first frame (a fade on screen reads as a ghost).
      if (m.mats && m.fade !== 1) {
        m.fade = 1;
        for (const mat of m.mats) mat.opacity = 1;
      }
      // The held sword hangs outside the body as on the generals screen (idleBlade.ts).
      hangSword(m.figure);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const m of this.members.values()) {
      if (m.placed) this.host.hidden.delete(m.ship);
      m.set?.dispose();
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

const LIFE_Q = new Quaternion();
const LIFE_P = new Quaternion();
const LIFE_AXIS = new Vector3();
const UP = new Vector3(0, 1, 0);
const SIDE = new Vector3(1, 0, 0);

/** A smooth 0..1..0 bump between `a` and `b` (seconds), eased in and out over `e`. */
function bump(t: number, a: number, b: number, e: number) {
  const s = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  return s((t - a) / e) * (1 - s((t - b) / e));
}

/** Turns `bone` by `angle` about `axis` (in the figure's own frame), on top of what the clip gave it this frame. */
function turn(bone: Object3D | undefined, root: Object3D, axis: Vector3, angle: number) {
  if (!bone?.parent || Math.abs(angle) < 1e-5) return;
  LIFE_AXIS.copy(axis).applyQuaternion(root.getWorldQuaternion(LIFE_Q));
  LIFE_Q.setFromAxisAngle(LIFE_AXIS, angle);
  bone.parent.getWorldQuaternion(LIFE_P);
  // local' = P^-1 * D * P * local
  bone.quaternion.premultiply(LIFE_P.clone().invert().multiply(LIFE_Q).multiply(LIFE_P));
}

/**
 * Additive bone turns over the idle clip (cinematics only; /generals stays pure idle): a slow breath in the chest, and
 * every ~9 s an eased glance off to one side toward the enemy and back, the eyes leading with the head. Small angles,
 * eased with smoothstep, nothing faster than a second: no snapping, no jitter.
 */
function alive(figure: Figure, t: number, seed: number) {
  const root = figure.root;
  root.updateMatrixWorld(true);
  const bones = (figure.root.userData.lifeBones ??= {
    spine: root.getObjectByName('Spine02') ?? root.getObjectByName('Spine01'),
    neck: root.getObjectByName('neck'),
    head: root.getObjectByName('Head'),
  }) as Record<'spine' | 'neck' | 'head', Object3D | undefined>;
  const breath = Math.sin((t / 4.4) * Math.PI * 2);
  turn(bones.spine, root, SIDE, -0.012 * breath);
  const phase = (t + (seed % 5) * 1.3) % 9;
  const dir = Math.floor((t + (seed % 5) * 1.3) / 9) % 2 ? 1 : -1;
  const look = bump(phase, 2.2, 5.0, 1.3) * dir;
  const drift = Math.sin(t * 0.37 + seed) * 0.025;
  turn(bones.neck, root, UP, look * 0.09 + drift * 0.5);
  turn(bones.head, root, UP, look * 0.13 + drift);
  turn(bones.head, root, SIDE, 0.012 * breath - 0.03 * Math.abs(look));
}
