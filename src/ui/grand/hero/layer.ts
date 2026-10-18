import { Group, Mesh, type MeshBasicNodeMaterial, type BufferGeometry, type InstancedMesh, type Material, type Texture } from 'three/webgpu';
import { attribute, normalLocal, positionLocal, sin, vec3 } from 'three/tsl';
import { worldClock } from '../../../select/terrain';
import { freeAfterDraw } from '../../../render/dispose';
import { SWAY_RANGE, toGeometry } from '../../../ships/build/pack';
import { campMaterial } from '../campMaterial';
import { MAP_ASPECT } from '../projection';
import type { MapWorld, SettlementSpec } from '../mapWorld';
import type { FactionId } from '../types';
import { buildHero, Merge } from './build';
import { tierCamp } from './tiers';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildHeroGround, heroGroundLook, type HeroGroundLook } from './ground';
import type { LandLook } from '../landLook';
import { joTier1, LAYOUTS, town, waFieldCamp } from './layouts';
import { Plan, type Moored } from './plan';
import { ELEVATION_MODEL, HERO_SITES, heroEnabled, MODEL_METRE, siteUV, siteXZ, type HeroSite } from './site';
import { heroGroundOf } from './terrain';
import { placeBoulders, plantTrees, treeMeshes, type Woods } from './trees';
import { rockMaterial, treeMaterial } from '../treeModels';

// The hero camps on the campaign map (see site.ts): for each hero site whose camp its own navy holds, the camp of the
// layouts, the villages of the towns round it, and the ground they stand on, built when the world first shows them and
// kept while what they are made of stays the same. The map's layer (mapLayer.ts) leaves those places to this and puts
// the ships at their quays and the smoke of their hearths with its own.

/** The camera distance under which the hero camps show their close models (frame units). */
const NEAR = 0.2;
/** The camera distance under which they show their woods: as far as the map's own trees are planted (worldTrees.ts). */
const WOODS = 0.3;
/** How far the hero camps' crowns sway in the wind, model metres. */
const SWAY = 0.12;

/** A hero site as the world shows it: which camp, which towns, and what the layer must leave out for it. */
export interface HeroUse {
  site: HeroSite;
  /** The ids of the settlements the hero site draws instead of the map's kits. */
  replaces: Set<string>;
  /** The towns drawn as villages: (x, z) in the site's frame, how many houses, a seed. */
  towns: { x: number; z: number; houses: number; seed: number }[];
  /** Other navies' small camps on the site's ground, built to the same rules (x, z, their navy, their level). */
  camps: { x: number; z: number; navy: FactionId; level: number }[];
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
    const towns: HeroUse['towns'] = [], avoid: HeroUse['avoid'] = [], camps: HeroUse['camps'] = [];
    for (const s of world.settlements) {
      if (s.region === site.id && s.kind === 'beacon') replaces.add(s.id);
      const { x, z } = siteXZ(site, s.u, s.v);
      if (Math.max(Math.abs(x), Math.abs(z)) > site.reach + 40) continue;
      // A small camp of another port on this ground is built to the hero camps' rules too.
      if (s.kind === 'camp' && s.owner && s.region !== site.id && s.level <= 2 && Math.max(Math.abs(x), Math.abs(z)) < site.reach - 28) {
        replaces.add(s.id);
        camps.push({ x, z, navy: s.owner, level: s.level });
        continue;
      }
      if (s.kind !== 'town' || Math.max(Math.abs(x), Math.abs(z)) > site.reach - 30) {
        if (!replaces.has(s.id)) avoid.push([x, z, s.radius * 40 + 6]);
        continue;
      }
      replaces.add(s.id);
      towns.push({ x, z, houses: houses(s), seed: [...s.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 1000 });
    }
    out.push({ site, replaces, towns, camps, avoid, key: JSON.stringify([site.id, towns, camps, avoid]) });
  }
  return out;
}

const houses = (s: SettlementSpec) => s.pieces.filter((p) => p.kind === 'choga' || p.kind === 'giwa' || p.kind === 'wa_house').length;

/** Another camp of the map, built to the hero camps' rules by its navy and level (tiers.ts). */
export interface TierUse { id: string; u: number; v: number; navy: FactionId; level: number; town?: { houses: number; seed: number; owner: FactionId | null } }

/** The camps a world shows that no hero site draws. */
export function tierUses(world: MapWorld, heroes: HeroUse[]): TierUse[] {
  const taken = new Set(heroes.flatMap((h) => [...h.replaces]));
  const camps = world.settlements.filter((s) => s.kind === 'camp' && s.owner && s.level >= 1 && !taken.has(s.id))
    .map((s): TierUse => ({ id: s.id, u: s.u, v: s.v, navy: s.owner!, level: Math.min(3, s.level) }));
  // Every town too, as a village of houses at their own size along its street.
  const towns = world.settlements.filter((s) => s.kind === 'town' && !taken.has(s.id))
    .map((s): TierUse => ({ id: s.id, u: s.u, v: s.v, navy: 'joseon', level: 0, town: { houses: houses(s), seed: [...s.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 1000, owner: s.owner } }));
  return [...camps, ...towns];
}

/** A hero site's plan: its camp's layout and its villages. */
export function heroPlan(use: HeroUse): Plan | null {
  const ground = heroGroundOf(use.site.id);
  if (!ground) return null;
  const plan = new Plan(ground, use.site.navy);
  LAYOUTS[use.site.id]!(plan);
  for (const c of use.camps) {
    if (plan.at(c.x, c.z) !== plan.natural(c.x, c.z)) continue;
    if (c.navy === 'japan') waFieldCamp(plan, c.x, c.z, 0);
    else joTier1(plan, c.x, c.z, 0);
  }
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
  /** The camp's own woods: hidden from afar, as the map's trees are (worldTrees.ts), where the ground draws them. */
  woods: Group;
  /** Its trees, dealt to the fine or the light shapes by the eye, and where the eye was when they last were. */
  trees: Woods | null;
  dealt: [number, number, number] | null;
  geometries: BufferGeometry[];
  ships: { kind: Moored['kind']; u: number; v: number; rot: number }[];
  smoke: { u: number; v: number; y: number }[];
}

/**
 * A navy's building material for the hero camps: the map's (campMaterial.ts) on the atlas the map's layer loaded, with its
 * banners moving in the wind, each cloth swinging about its pole along its own normal, out of step with the next by
 * where it stands.
 */
async function heroMaterial(navy: FactionId, atlas: Promise<Texture[]>) {
  const made = await campMaterial(navy, atlas);
  const shade: any = attribute('color', 'vec4');
  const p: any = positionLocal;
  const weight = shade.w.mul(SWAY_RANGE);
  const wave = sin(worldClock.mul(2.3).add(p.x.mul(0.8)).add(p.z.mul(0.55))).add(sin(worldClock.mul(3.7).add(p.x.mul(1.9))).mul(0.35));
  made.material.positionNode = p.add(normalLocal.mul(wave.mul(weight).mul(0.22))).add(vec3(0, weight.mul(-0.04), 0));
  return made.material;
}

/** A mesh of a built site, its CPU copy freed once it is on the GPU (nothing reads it back). */
function meshOf(g: BufferGeometry, m: Material, order: number) {
  const mesh = new Mesh(g, m);
  mesh.renderOrder = order;
  freeAfterDraw(mesh);
  return mesh;
}

export class HeroLayer {
  readonly group = new Group();
  private readonly built = new Map<string, Built>();
  /** Builds under way by key: a set() that wants one of them awaits it rather than building it twice. */
  private readonly building = new Map<string, Promise<void>>();
  /** The keys the last set() wants: a build that finishes after a newer set() stopped wanting it is freed at once. */
  private wanted = new Set<string>();
  /** The camera distance and eye setView was last given, for a site that is added after it. */
  private distance = Infinity;
  private eye: readonly [number, number, number] = [0, 100, 0];
  private readonly materials = new Map<FactionId, Promise<MeshBasicNodeMaterial | null>>();
  private readonly ready: Material[] = [];
  private lookReady: HeroGroundLook | null = null;
  private woodLook: { trees: MeshBasicNodeMaterial; rocks: MeshBasicNodeMaterial } | null = null;
  private disposed = false;

  /**
   * `drawn(u, v)` is the drawn land's height in metres at a frame point, negative under the sea; `land` the land's look;
   * `atlas(navy)` a navy's building atlas as the map's layer loaded it, which that layer frees.
   */
  constructor(private readonly drawn: (u: number, v: number) => number, private readonly land: LandLook, private readonly atlas: (navy: FactionId) => Promise<Texture[]>) {}

  private material(navy: FactionId) {
    let p = this.materials.get(navy);
    if (!p) {
      p = heroMaterial(navy, this.atlas(navy)).then((m) => {
        if (this.disposed) m.dispose(); else this.ready.push(m);
        return m;
      }, () => null);
      this.materials.set(navy, p);
    }
    return p;
  }

  private groundLook() {
    return (this.lookReady ??= heroGroundLook(this.land));
  }

  /**
   * Builds what the world's hero sites and its other camps need, then drops what it no longer shows: the old camps stand
   * until their replacements are in place, so a turn that takes a port does not blank every camp while the new ones
   * build. A build of the same thing already under way is awaited rather than started again (a replay's clash and its
   * end ask for the same world), and a build that finishes after a newer set() stopped wanting it is freed at once.
   * Resolves when every site shown is ready.
   */
  async set(uses: HeroUse[], tiers: TierUse[] = []) {
    const tierKey = `tiers:${JSON.stringify(tiers)}`;
    const wanted = (this.wanted = new Set([...uses.map((u) => u.key), tierKey]));
    try {
      for (const use of uses) await this.ensure(use.key, () => this.buildSite(use));
      await this.ensure(tierKey, () => this.buildTiers(tierKey, tiers));
    } catch (error) {
      // The map's layer shows its own kits instead (mapLayer.ts): nothing of these may stand over them.
      if (wanted === this.wanted) {
        this.wanted = new Set();
        for (const [key, b] of this.built) this.drop(key, b);
      }
      throw error;
    }
    // A newer set() under way does the dropping once its own builds stand.
    if (this.disposed || wanted !== this.wanted) return;
    for (const [key, b] of this.built) if (!wanted.has(key)) this.drop(key, b);
  }

  /** Builds `key` with `make` unless it stands already, or waits for the build of it under way. */
  private async ensure(key: string, make: () => Promise<Built | null>) {
    if (this.built.has(key)) return;
    let job = this.building.get(key);
    if (!job) {
      job = make().then((b) => {
        if (!b) return;
        if (this.disposed || !this.wanted.has(key)) {
          this.free(b);
          return;
        }
        this.built.set(key, b);
        this.group.add(b.group);
        this.show(b);
      }).finally(() => { this.building.delete(key); });
      this.building.set(key, job);
    }
    await job;
  }

  /** A hero site's camp, villages, woods and ground, in its own frame; null when its ground has not loaded. */
  private async buildSite(use: HeroUse): Promise<Built | null> {
    const plan = heroPlan(use);
    if (!plan) return null;
    const navies = new Set(plan.pieces.map((p) => p.navy));
    const [look, ...mats] = await Promise.all([this.groundLook(), ...[...navies].map((n) => this.material(n))]);
    if (this.disposed) return null;
    // Give the page a frame between the ground and the buildings.
    await new Promise((resolve) => setTimeout(resolve));
    if (this.disposed) return null;
    const meshes = buildHero(plan);
    const ground = buildHeroGround(use.site, plan, this.drawn);
    const group = new Group(), near = new Group(), far = new Group();
    group.position.set(use.site.u - 0.5, 0, (use.site.v - 0.5) / MAP_ASPECT);
    group.scale.setScalar(MODEL_METRE);
    group.add(near, far);
    const geometries: BufferGeometry[] = [];
    const add = (g: BufferGeometry | null, m: Material | null | undefined, parent: Group, order = 0) => {
      if (!g) return;
      geometries.push(g);
      if (m) parent.add(meshOf(g, m, order));
    };
    // After the land (-1) and the sea (0): the patch fades into both at its edge.
    add(ground.patch, look.ground, group, 1);
    add(ground.laid, look.laid, group, 2);
    add(ground.shade, look.shade, group, 3);
    add(ground.water, look.water, group, 2);
    const wood = (this.woodLook ??= { trees: treeMaterial(this.land.details[3]!, SWAY), rocks: rockMaterial(this.land.details[1]!) });
    const seed = Math.round(use.site.u * 1e6);
    const trees = treeMeshes([...plantTrees(plan, use.site.reach, ground.sample, seed, use.avoid), ...placeBoulders(plan, use.site.reach, ground.sample, seed)], wood.trees, wood.rocks);
    const woods = new Group();
    group.add(woods);
    for (const t of trees.meshes) {
      geometries.push(t.geometry);
      woods.add(t);
    }
    meshes.forEach((m) => {
      const mat = mats[[...navies].indexOf(m.navy)];
      if (!mat) return;
      add(toGeometry(m.near), mat, near);
      add(toGeometry(m.far), mat, far);
    });
    const at = (x: number, z: number) => siteUV(use.site, x, z);
    return {
      key: use.key, group, near, far, woods, trees, dealt: null, geometries,
      ships: plan.ships.map((s) => ({ kind: s.kind, ...at(s.x, s.z), rot: s.rot })),
      smoke: plan.smoke.map(([x, y, z]) => ({ ...at(x, z), y: y * MODEL_METRE })),
    };
  }

  /**
   * Every other camp in one set of meshes: each laid out and built in its own frame on the drawn land, then moved to
   * where it stands, so the whole map's camps are a few draws (one per navy and level, one for their ground).
   */
  private async buildTiers(key: string, tiers: TierUse[]): Promise<Built | null> {
    const navies = [...new Set(tiers.map((t) => t.navy))];
    const [look, ...mats] = await Promise.all([this.groundLook(), ...navies.map((n) => this.material(n))]);
    if (this.disposed) return null;
    const merges = new Map<FactionId, [Merge, Merge]>();
    const grounds: { patch: BufferGeometry[]; laid: BufferGeometry[]; shade: BufferGeometry[] } = { patch: [], laid: [], shade: [] };
    const smoke: Built['smoke'] = [];
    for (const t of tiers) {
      // One camp a task, so a world of camps does not hold the page up in one piece.
      await new Promise((resolve) => setTimeout(resolve));
      if (this.disposed) return null;
      const { site, plan } = tierPlan(t, this.drawn);
      const dx = (t.u - 0.5) / MODEL_METRE, dz = (t.v - 0.5) / (MODEL_METRE * MAP_ASPECT);
      for (const m of buildHero(plan)) {
        let pair = merges.get(m.navy);
        if (!pair) merges.set(m.navy, (pair = [new Merge(), new Merge()]));
        pair[0].stamp(m.near, dx, 0, dz, 0);
        pair[1].stamp(m.far, dx, 0, dz, 0);
      }
      const g = buildHeroGround(site, plan, this.drawn);
      // A village stands on the land as drawn: only a camp's pad needs the smooth ground round it.
      if (t.town) g.patch?.dispose();
      g.water?.dispose();
      for (const k of ['patch', 'laid', 'shade'] as const) {
        if (t.town && k === 'patch') continue;
        const geo = g[k];
        if (geo) grounds[k].push(geo.translate(dx, 0, dz));
      }
      for (const [x, y, z] of plan.smoke) smoke.push({ ...siteUV(site, x, z), y: y * MODEL_METRE });
    }
    const group = new Group(), near = new Group(), far = new Group();
    group.position.set(0, 0, 0);
    group.scale.setScalar(MODEL_METRE);
    group.add(near, far);
    const geometries: BufferGeometry[] = [];
    const add = (g: BufferGeometry | null, m: Material | null | undefined, parent: Group, order = 0) => {
      if (!g) return;
      geometries.push(g);
      if (m) parent.add(meshOf(g, m, order));
    };
    for (const [k, order] of [['patch', 1], ['laid', 2], ['shade', 3]] as const) {
      const list = grounds[k];
      const merged = list.length ? mergeGeometries(list) : null;
      for (const g of list) g.dispose();
      add(merged, k === 'patch' ? look.ground : k === 'laid' ? look.laid : look.shade, group, order);
    }
    for (const [navy, [n, f]] of merges) {
      const mat = mats[navies.indexOf(navy)];
      add(toGeometry(n.data()), mat, near);
      add(toGeometry(f.data()), mat, far);
    }
    return { key, group, near, far, woods: new Group(), trees: null, dealt: null, geometries, ships: [], smoke };
  }

  /** The ships and hearths of the sites built for `uses` and of the other camps. */
  extras(uses: HeroUse[]) {
    const list = [...uses.map((u) => this.built.get(u.key)), ...[...this.built.values()].filter((b) => b.key.startsWith('tiers:'))].filter((b): b is Built => !!b);
    return { ships: list.flatMap((b) => b.ships), smoke: list.flatMap((b) => b.smoke) };
  }

  /**
   * Shows the close or the far models by the camera's distance from what it looks at, and deals the woods to their
   * detail by how large each tree stands to the eye (a world point).
   */
  setView(distance: number, eye: readonly [number, number, number]) {
    this.distance = distance;
    this.eye = eye;
    for (const b of this.built.values()) this.show(b);
  }

  private show(b: Built) {
    b.near.visible = this.distance <= NEAR;
    b.far.visible = !b.near.visible;
    b.woods.visible = this.distance <= WOODS;
    const trees = b.trees;
    if (!trees || !b.woods.visible) return;
    // The eye in the site's frame: its group stands at the site's origin, a model metre to the world unit MODEL_METRE.
    const o = b.group.position, k = 1 / MODEL_METRE;
    const eye: [number, number, number] = [(this.eye[0] - o.x) * k, (this.eye[1] - o.y) * k, (this.eye[2] - o.z) * k];
    // Only when the eye has moved enough to change which trees stand large.
    if (b.dealt && Math.hypot(eye[0] - b.dealt[0], eye[1] - b.dealt[1], eye[2] - b.dealt[2]) < this.distance * k * 0.03) return;
    b.dealt = eye;
    trees.deal(eye);
  }

  /** Frees what a build made. */
  private free(b: Built) {
    b.group.removeFromParent();
    b.group.traverse((o) => { if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose(); });
    for (const g of b.geometries) g.dispose();
  }

  private drop(key: string, b: Built) {
    this.free(b);
    this.built.delete(key);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const [key, b] of this.built) this.drop(key, b);
    // The atlases are the map's layer's to free.
    for (const m of this.ready) m.dispose();
    this.ready.length = 0;
    const look = this.lookReady;
    if (look) for (const x of [look.ground, look.laid, look.shade, look.water]) x.dispose();
    this.lookReady = null;
    this.woodLook?.trees.dispose();
    this.woodLook?.rocks.dispose();
    this.woodLook = null;
    this.group.removeFromParent();
  }
}

/**
 * Another camp or town of the map laid out in its own frame on the drawn land: `drawn(u, v)` is the drawn land's height
 * in metres at a frame point.
 */
function tierPlan(t: TierUse, drawn: (u: number, v: number) => number) {
  const site: HeroSite = { id: t.id, navy: t.navy, u: t.u, v: t.v, reach: 56 };
  const natural = (x: number, z: number) => { const p = siteUV(site, x, z); return drawn(p.u, p.v) * ELEVATION_MODEL; };
  const plan = new Plan({ natural, water: (x, z) => natural(x, z) <= 0.02 }, t.navy);
  if (t.town) {
    town(plan, 0, 0, t.town.houses, t.town.seed, 'joseon');
    // Whose the town is, by the owner's banner at its end.
    if (t.town.owner) plan.banner(-6, -4, Math.max(0.3, natural(-6, -4)), 9, t.town.owner === 'japan' ? 'red' : t.town.owner === 'ming' ? 'yellow' : 'blue', 1.6, 2.4, 0, t.town.owner === 'japan' ? 'nobori' : 'flag');
  } else tierCamp(plan, t.navy, t.level, 0, 0);
  return { site, plan };
}

/** The clearings of a plan laid out at a site: every pad and every compound and village (frame units). */
function planClearings(site: HeroSite, plan: Plan, out: { u: number; v: number; r: number }[]) {
  const disc = (x: number, z: number, r: number) => out.push({ ...siteUV(site, x, z), r: r * MODEL_METRE });
  for (const [x, z, r] of plan.clear) disc(x, z, r);
  for (const pad of plan.pads) {
    const cx = pad.poly.reduce((s, p) => s + p[0], 0) / pad.poly.length, cz = pad.poly.reduce((s, p) => s + p[1], 0) / pad.poly.length;
    disc(cx, cz, Math.max(...pad.poly.map((p) => Math.hypot(p[0] - cx, p[1] - cz))) + 3);
  }
  // Houses stand on the land as drawn, off any pad: each keeps its own few metres.
  for (const { piece: p } of plan.pieces) if (p.kind === 'bldg') disc(p.x, p.z, Math.max(p.w, p.d) / 2 + 2);
}

/**
 * The ground the map's trees keep off where the hero camps' rules build (frame units): at the hero sites a world shows,
 * their whole patch (they plant their own woods, trees.ts); at every other camp and town (`drawn` as for HeroLayer), its
 * pads, compounds and houses, so the woods come up to them as the land's look draws them.
 */
export function heroClearings(world: MapWorld, drawn: (u: number, v: number) => number): { u: number; v: number; r: number }[] {
  if (!heroEnabled()) return [];
  const out: { u: number; v: number; r: number }[] = [];
  const heroes = heroUses(world);
  for (const use of heroes) {
    const plan = heroPlan(use);
    if (!plan) continue;
    out.push({ ...siteUV(use.site, 0, 0), r: (use.site.reach - 10) * MODEL_METRE });
    planClearings(use.site, plan, out);
  }
  for (const t of tierUses(world, heroes)) {
    const { site, plan } = tierPlan(t, drawn);
    planClearings(site, plan, out);
  }
  return out;
}
