import { BoxGeometry, Color, Group, Mesh, MeshStandardNodeMaterial, Vector3, type Object3D, type Texture } from 'three/webgpu';
import { abs, mix, normalWorld, positionWorld, step, texture, vec2, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Battle } from '../sim/battle';
import { SHIP_SPECS } from '../sim/catalog';
import { teamOf, type Faction, type ShipKind } from '../sim/types';
import { disposeTree } from '../render/dispose';
import { equipment } from '../game/quality';
import { BUILDING_IDS, type BuildingId } from '../meta/portDefs';
import { buildingModelUrlFor, type BuildingModelKind } from '../conquest/buildingModels';
import { QUAY_HALF, shoreLine, type PortView } from './harbourTerrain';

/** At most this many hulls are drawn at the quay; the shop lists the rest. */
export const MOORED_MAX = 14;
type PortModel = BuildingId | 'dock';
/** Where each building stands along the quay (x, metres) and how far behind the quay wall (metres). */
const SITE: Record<BuildingId, { x: number; back: number }> = { shipyard: { x: -105, back: 36 }, arsenal: { x: 0, back: 42 }, fortress: { x: 105, back: 48 } };
/** Footprint width of each model, metres. */
const WIDTH: Record<PortModel, number> = { shipyard: 36, arsenal: 22, fortress: 32, dock: 26 };
const QUAY_TOP = 2.4;

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

/** The owned hulls at rest in two rows along the quay, largest first beside the arsenal's dock, each on deep enough water. */
export function portBattle(view: PortView, land: (x: number, z: number) => number, shore: number): Battle {
  const b = new Battle(1592, 'historical');
  b.humans.clear();
  const squad = b.addSquadron(teamOf(view.nation), 'Home port', '', '', '', 0);
  const hulls = (Object.entries(view.ships) as [ShipKind, number][]).flatMap(([k, n]) => Array.from({ length: n }, () => k));
  hulls.sort((a, z) => SHIP_SPECS[z].length - SHIP_SPECS[a].length);
  let left = -18;
  let right = 18;
  hulls.slice(0, MOORED_MAX).forEach((kind, i) => {
    const L = SHIP_SPECS[kind].length;
    const row = i % 4 < 2 ? 0 : 1;
    let x: number;
    if (i % 2 === 0) { x = right + L / 2; right += L + 8; } else { x = left - L / 2; left -= L + 8; }
    let z = shore + 14 + row * 34 + SHIP_SPECS[kind].beam * 0.5;
    while (land(x, z) > -4 && z < shore + 400) z += 6;
    const ship = b.addShip(kind, x, z, 0, '', squad, i === 0, i % 3);
    ship.order = { type: 'hold' };
  });
  b.initial[teamOf(view.nation)] = b.ships.length;
  return b;
}

/**
 * The 본진's shore works on the battle terrain, drawn by the Engine like a conquest map's works: a stone quay wall on the
 * shore, a timber pier, and the navy's 조선소, 병기창 and 요새 (src/conquest/buildingModels.ts), each on a levelled stone
 * terrace, with the dock at the pier. Every building always stands; each level past the first adds an annex.
 */
export class PortWorks {
  readonly group = new Group();
  /** The quay wall's seaward face (z, metres); the bay opens toward +z. */
  readonly shore: number;
  private works = new Group();
  private shown = '';
  private disposed = false;
  private stone: MeshStandardNodeMaterial;
  private timber: MeshStandardNodeMaterial;

  /** `ground`: the terrain's page-shared textures (Terrain.groundTextures): the cliff rock dresses the stone, never freed here. */
  constructor(private view: PortView, private land: (x: number, z: number) => number, ground: { rock: Texture; bark: Texture }) {
    this.stone = worldMapped(ground.rock, new Color('#8f8d88'), 0.25, 1);
    // Timber: the same rock texture stretched along the planks and stained brown reads as weathered grain.
    this.timber = worldMapped(ground.bark, new Color('#7a5638'), 0.6, 0.08);
    this.shore = shoreLine(land);
    this.buildQuay();
    this.group.add(this.works);
  }

  load() {
    return this.set(this.view);
  }

  private buildQuay() {
    const depth = 70;
    const bottom = -14;
    const quay = new Mesh(new BoxGeometry(QUAY_HALF * 2 + 20, QUAY_TOP - bottom, depth), this.stone);
    quay.position.set(0, (QUAY_TOP + bottom) / 2, this.shore - depth / 2);
    const pier = new Mesh(new BoxGeometry(9, 1, 44), this.timber);
    pier.position.set(0, QUAY_TOP - 0.6, this.shore + 22);
    this.group.add(quay, pier);
    for (let i = -1; i <= 1; i += 2) for (let k = 0; k < 5; k++) {
      const post = new Mesh(new BoxGeometry(0.7, 8, 0.7), this.timber);
      post.position.set(i * 4.2, QUAY_TOP - 4.5, this.shore + 3 + k * 10);
      this.group.add(post);
    }
    for (const o of this.group.children) { o.castShadow = true; o.receiveShadow = true; }
  }

  private async model(kind: PortModel, nation: Faction): Promise<Object3D | null> {
    const lod = equipment.tier === 'low' ? 1 : 0;
    const urls = [...new Set([buildingModelUrlFor(nation, kind as BuildingModelKind, lod), buildingModelUrlFor(null, kind as BuildingModelKind, lod)])];
    for (const url of urls) {
      try {
        const gltf = await loader.loadAsync(url);
        if (this.disposed) { disposeTree(gltf.scene, true); return null; }
        return fit(gltf.scene, WIDTH[kind]);
      } catch {
        // Try the shared model, or show none.
      }
    }
    return null;
  }

  /** A flat terrace: its top at the highest ground under the footprint (at least the quay's), its sides below the lowest. */
  private terrace(x: number, z: number, w: number, d: number) {
    let hi = QUAY_TOP;
    let lo = QUAY_TOP;
    for (let i = -2; i <= 2; i++) for (let k = -2; k <= 2; k++) {
      const h = this.land(x + (i / 4) * w, z + (k / 4) * d);
      hi = Math.max(hi, h);
      lo = Math.min(lo, h);
    }
    const top = hi + 0.4;
    const base = lo - 6;
    const pad = new Mesh(new BoxGeometry(w, top - base, d), this.stone);
    pad.position.set(x, (top + base) / 2, z);
    return { pad, top };
  }

  /** Rebuilds the buildings for the levels shown. */
  async set(view: PortView) {
    const key = `${view.nation}:${BUILDING_IDS.map((id) => view.port[id]).join(',')}`;
    if (key === this.shown || this.disposed) return;
    this.shown = key;
    this.view = view;
    const next: Object3D[] = [];
    for (const id of BUILDING_IDS) {
      const level = view.port[id] ?? 0;
      const { x, back } = SITE[id];
      const z = this.shore - back;
      const w = WIDTH[id];
      const { pad, top } = this.terrace(x, z, w * 2.4, w * 1.5);
      next.push(pad);
      const main = await this.model(id, view.nation);
      if (main) {
        main.scale.multiplyScalar(level === 0 ? 0.8 : 1 + 0.1 * (level - 1));
        main.position.set(x, top, z);
        main.rotation.y = Math.PI;
        next.push(main);
      }
      for (let i = 1; i < level; i++) {
        const annex = await this.model(id, view.nation);
        if (!annex) break;
        annex.scale.multiplyScalar(0.55);
        annex.position.set(x + (i % 2 ? -1 : 1) * w * 0.85, top, z + w * 0.15);
        annex.rotation.y = Math.PI;
        next.push(annex);
      }
    }
    const dock = await this.model('dock', view.nation);
    if (dock) {
      dock.position.set(0, QUAY_TOP - 1, this.shore + 4);
      next.push(dock);
    }
    if (this.disposed || key !== this.shown) {
      for (const o of next) if (o.parent === null) disposeTree(o, true);
      return;
    }
    for (const o of next) o.traverse((m) => { m.castShadow = true; m.receiveShadow = true; });
    const old = this.works.children.slice();
    this.works.clear();
    for (const o of old) disposeTree(o, true);
    this.works.add(...next);
  }

  /** The opening view: from the bay over the moored fleet toward the works. */
  pose() {
    return { tx: 0, tz: this.shore - 10, yaw: Math.PI / 2 + 0.3, pitch: 0.3, distance: 340 };
  }

  dispose() {
    this.disposed = true;
    // The building models are this port's own, textures included; the quay's textures are the terrain's.
    disposeTree(this.works, true);
    this.group.remove(this.works);
    disposeTree(this.group);
    this.stone.dispose();
    this.timber.dispose();
  }
}

/**
 * A material that maps `map` in world space (metres * scale), on the face each box side looks along, so long walls and
 * terraces tile the texture at one size instead of stretching it. `grain` squeezes it across one axis (timber).
 */
function worldMapped(map: Texture, tint: Color, scale: number, grain: number) {
  const m = new MeshStandardNodeMaterial({ roughness: 0.92 });
  const p = positionWorld.mul(scale);
  const n = abs(normalWorld);
  const side = mix(vec2(p.z.mul(grain), p.y), vec2(p.x.mul(grain), p.y), step(n.x, n.z));
  const uv = mix(side, vec2(p.x.mul(grain), p.z), step(0.7, n.y));
  m.colorNode = texture(map, uv).rgb.mul(vec3(tint.r, tint.g, tint.b).mul(1.25));
  return m;
}

/** A loaded model scaled so its footprint is `width` metres wide, standing on y = 0. */
function fit(root: Object3D, width: number): Object3D {
  root.updateMatrixWorld(true);
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
    min.min(b.min);
    max.max(b.max);
  });
  const size = max.clone().sub(min);
  const s = width / Math.max(size.x, size.z, 0.001);
  const holder = new Group();
  root.position.set(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
  holder.add(root);
  holder.scale.setScalar(s);
  return holder;
}
