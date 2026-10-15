import { Group, Mesh, type MeshBasicNodeMaterial, type BufferGeometry, type InstancedMesh, type Material, type Texture } from 'three/webgpu';
import { attribute, normalLocal, positionLocal, sin, vec3 } from 'three/tsl';
import { worldClock } from '../../../select/terrain';
import { SWAY_RANGE, toGeometry } from '../../../ships/build/pack';
import { campMaterial } from '../campMaterial';
import { MAP_ASPECT } from '../projection';
import type { MapWorld, SettlementSpec } from '../mapWorld';
import type { FactionId } from '../types';
import { buildHero } from './build';
import { buildHeroGround, heroGroundLook, type HeroGroundLook } from './ground';
import { LAYOUTS, town } from './layouts';
import { Plan, type Moored } from './plan';
import { HERO_SITES, heroEnabled, MODEL_METRE, siteUV, siteXZ, type HeroSite } from './site';
import { heroGroundOf } from './terrain';
import { plantTrees, treeMaterial, treeMeshes } from './trees';

// The hero camps on the campaign map (see site.ts): for each hero site whose camp its own navy holds, the camp of the
// layouts, the villages of the towns round it, and the ground they stand on, built when the world first shows them and
// kept while what they are made of stays the same. The map's layer (mapLayer.ts) leaves those places to this and puts
// the ships at their quays and the smoke of their hearths with its own.

/** The camera distance under which the hero camps show their close models (frame units). */
const NEAR = 0.2;

/** A hero site as the world shows it: which camp, which towns, and what the layer must leave out for it. */
export interface HeroUse {
  site: HeroSite;
  /** The ids of the settlements the hero site draws instead of the map's kits. */
  replaces: Set<string>;
  /** The towns drawn as villages: (x, z) in the site's frame, how many houses, a seed. */
  towns: { x: number; z: number; houses: number; seed: number }[];
  /** The map's other places on the site's ground (x, z, radius in model metres): no tree grows over them. */
  avoid: [number, number, number][];
  key: string;
}

/** Which hero sites a world shows: those whose camp is held by the navy the layout is for, with the towns on their ground. */
export function heroUses(world: MapWorld): HeroUse[] {
  const out: HeroUse[] = [];
  for (const site of HERO_SITES) {
    const camp = world.settlements.find((s) => s.kind === 'camp' && s.region === site.id);
    if (!camp || camp.owner !== site.navy || !heroGroundOf(site.id)) continue;
    const replaces = new Set<string>([camp.id]);
    const towns: HeroUse['towns'] = [], avoid: HeroUse['avoid'] = [];
    for (const s of world.settlements) {
      if (s.region === site.id && s.kind === 'beacon') replaces.add(s.id);
      const { x, z } = siteXZ(site, s.u, s.v);
      if (Math.max(Math.abs(x), Math.abs(z)) > site.reach + 40) continue;
      if (s.kind !== 'town' || Math.max(Math.abs(x), Math.abs(z)) > site.reach - 30) {
        if (!replaces.has(s.id)) avoid.push([x, z, s.radius * 40 + 6]);
        continue;
      }
      replaces.add(s.id);
      towns.push({ x, z, houses: houses(s), seed: [...s.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 1000 });
    }
    out.push({ site, replaces, towns, avoid, key: JSON.stringify([site.id, towns, avoid]) });
  }
  return out;
}

const houses = (s: SettlementSpec) => s.pieces.filter((p) => p.kind === 'choga' || p.kind === 'giwa' || p.kind === 'wa_house').length;

/** A hero site's plan: its camp's layout and its villages. */
export function heroPlan(use: HeroUse): Plan | null {
  const ground = heroGroundOf(use.site.id);
  if (!ground) return null;
  const plan = new Plan(ground, use.site.navy);
  LAYOUTS[use.site.id]!(plan);
  for (const t of use.towns) {
    // Off the camp's pads and clear of its works.
    if (plan.at(t.x, t.z) !== plan.natural(t.x, t.z)) continue;
    town(plan, t.x, t.z, t.houses, t.seed, 'joseon');
  }
  return plan;
}

/** What one built hero site holds. */
interface Built {
  key: string;
  group: Group;
  near: Group;
  far: Group;
  geometries: BufferGeometry[];
  ships: { kind: Moored['kind']; u: number; v: number; rot: number }[];
  smoke: { u: number; v: number; y: number }[];
}

/**
 * A navy's building material for the hero camps: the map's (campMaterial.ts) with its banners moving in the wind, each
 * cloth swinging about its pole along its own normal, out of step with the next by where it stands.
 */
async function heroMaterial(navy: FactionId) {
  const made = await campMaterial(navy);
  const shade: any = attribute('color', 'vec4');
  const p: any = positionLocal;
  const weight = shade.w.mul(SWAY_RANGE);
  const wave = sin(worldClock.mul(2.3).add(p.x.mul(0.8)).add(p.z.mul(0.55))).add(sin(worldClock.mul(3.7).add(p.x.mul(1.9))).mul(0.35));
  made.material.positionNode = p.add(normalLocal.mul(wave.mul(weight).mul(0.22))).add(vec3(0, weight.mul(-0.04), 0));
  return made;
}

export class HeroLayer {
  readonly group = new Group();
  private readonly built = new Map<string, Built>();
  private readonly materials = new Map<FactionId, Promise<{ material: MeshBasicNodeMaterial; textures: Texture[] } | null>>();
  private readonly ready: { material: Material; textures: Texture[] }[] = [];
  private look: Promise<HeroGroundLook | null> | null = null;
  private lookReady: HeroGroundLook | null = null;
  private trees: Promise<{ material: MeshBasicNodeMaterial; texture: Texture }> | null = null;
  private treeLook: { material: MeshBasicNodeMaterial; texture: Texture } | null = null;
  private disposed = false;

  /** `drawn(u, v)` is the drawn land's height in metres at a frame point, negative under the sea. */
  constructor(private readonly drawn: (u: number, v: number) => number) {}

  private material(navy: FactionId) {
    let p = this.materials.get(navy);
    if (!p) {
      p = heroMaterial(navy).then((m) => {
        if (this.disposed) { m.material.dispose(); for (const t of m.textures) t.dispose(); } else this.ready.push(m);
        return m;
      }, () => null);
      this.materials.set(navy, p);
    }
    return p;
  }

  private groundLook() {
    this.look ??= heroGroundLook().then((m) => {
      if (this.disposed) { for (const x of [m.ground, m.laid, m.shade]) x.dispose(); for (const t of m.textures) t.dispose(); } else this.lookReady = m;
      return m;
    }, () => null);
    return this.look;
  }

  /**
   * Builds what the world's hero sites need and drops the rest; resolves when every site shown is ready. Returns the
   * ships at their quays and the hearths, in frame units, for the map's layer to draw with its own.
   */
  async set(uses: HeroUse[]) {
    const wanted = new Set(uses.map((u) => u.key));
    for (const [key, b] of this.built) if (!wanted.has(key)) this.drop(key, b);
    for (const use of uses) {
      if (this.built.has(use.key)) continue;
      const plan = heroPlan(use);
      if (!plan) continue;
      const navies = new Set(plan.pieces.map((p) => p.navy));
      const [look, ...mats] = await Promise.all([this.groundLook(), ...[...navies].map((n) => this.material(n))]);
      if (this.disposed) return;
      // Give the page a frame between the ground and the buildings.
      await new Promise((resolve) => setTimeout(resolve));
      const meshes = buildHero(plan);
      const ground = buildHeroGround(use.site, plan, this.drawn);
      const group = new Group(), near = new Group(), far = new Group();
      group.position.set(use.site.u - 0.5, 0, (use.site.v - 0.5) / MAP_ASPECT);
      group.scale.setScalar(MODEL_METRE);
      group.add(near, far);
      const geometries: BufferGeometry[] = [];
      const add = (g: BufferGeometry | null, m: Material | undefined, parent: Group, order = 0) => {
        if (!g || !m) return;
        geometries.push(g);
        const mesh = new Mesh(g, m);
        mesh.renderOrder = order;
        parent.add(mesh);
      };
      if (look) {
        // After the land (-1) and the sea (0): the patch fades into both at its edge.
        add(ground.patch, look.ground, group, 1);
        add(ground.laid, look.laid, group, 2);
        add(ground.shade, look.shade, group, 3);
      }
      const leaves = await (this.trees ??= treeMaterial().then((m) => {
        if (this.disposed) { m.material.dispose(); m.texture.dispose(); } else this.treeLook = m;
        return m;
      }));
      if (this.disposed) return;
      const trees = treeMeshes(plantTrees(plan, use.site.reach, ground.sample, use.site.u * 1e6, use.avoid), leaves.material);
      for (const t of trees) {
        geometries.push(t.geometry);
        group.add(t);
      }
      meshes.forEach((m) => {
        const mat = mats[[...navies].indexOf(m.navy)]?.material;
        if (!mat) return;
        add(toGeometry(m.near), mat, near);
        add(toGeometry(m.far), mat, far);
      });
      const at = (x: number, z: number) => siteUV(use.site, x, z);
      const b: Built = {
        key: use.key, group, near, far, geometries,
        ships: plan.ships.map((s) => ({ kind: s.kind, ...at(s.x, s.z), rot: s.rot })),
        smoke: plan.smoke.map(([x, y, z]) => ({ ...at(x, z), y: y * MODEL_METRE })),
      };
      this.built.set(use.key, b);
      this.group.add(group);
    }
  }

  /** The ships and hearths of the sites built for `uses`. */
  extras(uses: HeroUse[]) {
    const list = uses.map((u) => this.built.get(u.key)).filter((b): b is Built => !!b);
    return { ships: list.flatMap((b) => b.ships), smoke: list.flatMap((b) => b.smoke) };
  }

  /** Shows the close or the far models by the camera's distance from what it looks at. */
  setView(distance: number) {
    for (const b of this.built.values()) {
      b.near.visible = distance <= NEAR;
      b.far.visible = !b.near.visible;
    }
  }

  private drop(key: string, b: Built) {
    b.group.removeFromParent();
    b.group.traverse((o) => { if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose(); });
    for (const g of b.geometries) g.dispose();
    this.built.delete(key);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const [key, b] of this.built) this.drop(key, b);
    for (const m of this.ready) { m.material.dispose(); for (const t of m.textures) t.dispose(); }
    this.ready.length = 0;
    const look = this.lookReady;
    if (look) { for (const x of [look.ground, look.laid, look.shade]) x.dispose(); for (const t of look.textures) t.dispose(); }
    this.lookReady = null;
    if (this.treeLook) { this.treeLook.material.dispose(); this.treeLook.texture.dispose(); }
    this.treeLook = null;
    this.group.removeFromParent();
  }
}

/** The ground the map's trees keep off at the hero sites a world shows: every pad, every compound and village (frame units). */
export function heroClearings(world: MapWorld): { u: number; v: number; r: number }[] {
  if (!heroEnabled()) return [];
  const out: { u: number; v: number; r: number }[] = [];
  for (const use of heroUses(world)) {
    const plan = heroPlan(use);
    if (!plan) continue;
    const disc = (x: number, z: number, r: number) => out.push({ ...siteUV(use.site, x, z), r: r * MODEL_METRE });
    // The camp plants its own woods over its patch (trees.ts): the map's keep off it.
    disc(0, 0, use.site.reach - 10);
    for (const [x, z, r] of plan.clear) disc(x, z, r);
    for (const pad of plan.pads) {
      const cx = pad.poly.reduce((s, p) => s + p[0], 0) / pad.poly.length, cz = pad.poly.reduce((s, p) => s + p[1], 0) / pad.poly.length;
      disc(cx, cz, Math.max(...pad.poly.map((p) => Math.hypot(p[0] - cx, p[1] - cz))) + 3);
    }
  }
  return out;
}
