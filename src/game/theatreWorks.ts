import { Box3, BoxGeometry, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Quaternion, Vector3, type Material, type Object3D } from 'three/webgpu';
import { CanvasTexture, DoubleSide, SRGBColorSpace } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildingModelUrlFor, type BuildingModelKind } from '../conquest/buildingModels';
import { equipment } from './quality';
import type { Faction } from '../sim/types';
import { lonLatToWorld, type TheatreSetup } from './theatre';

// The ports on the theatre's shore as settlements, Civilization-style: a held port is a walled camp (진채) on a levelled
// flat behind its harbour, with a palisade ring, gate towers, rows of small barracks round a command hall and drill
// ground, its armoury and magazine, a shipyard and quay on the water, a beacon on the nearest height and many banners;
// a village of small houses stands outside. Everything is small beside the ship tokens and drawn in a few batches.

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

/** Footprint in world metres of each piece (the theatre is a battle-sized map, ships are drawn about 9x). */
const SIZE = { hall: 44, fortress: 80, barracks: 24, arsenal: 34, magazine: 22, shipyard: 60, dock: 46, battery: 30, beacon: 22, house: 14 } as const;
type Piece = keyof typeof SIZE;
const MODEL_OF: Record<Piece, BuildingModelKind> = { hall: 'camp', fortress: 'fortress', barracks: 'camp', arsenal: 'arsenal', magazine: 'magazine', shipyard: 'shipyard', dock: 'dock', battery: 'battery', beacon: 'beacon', house: 'camp' };

const OWN = new Color(0.06, 0.2, 0.62);
const FOE = new Color(0.62, 0.06, 0.05);
const NEUTRAL = new Color(0.62, 0.6, 0.55);

type Model = { geometry: BufferGeometry; material: Material; box: Box3 };
/** `model` names a battle village model (public/models/env) for a house instead of the navy's building. */
type Spot = { piece: Piece; owner: Faction; x: number; z: number; rot: number; model?: 'giwa' | 'choga' };

async function fetchModel(url: string): Promise<Model | null> {
  try {
    const gltf = await loader.loadAsync(url);
    gltf.scene.updateMatrixWorld(true);
    let mesh: Mesh | null = null;
    gltf.scene.traverse((o: Object3D) => {
      if (!mesh && (o as Mesh).isMesh) mesh = o as Mesh;
    });
    if (!mesh) return null;
    const m = mesh as Mesh;
    const geometry = m.geometry.clone().applyMatrix4(m.matrixWorld);
    geometry.computeBoundingBox();
    return { geometry, material: m.material as Material, box: geometry.boundingBox!.clone() };
  } catch {
    return null;
  }
}

/** The war banners (기치) a navy flies: drawn once each on a canvas, the cloth's field, trim and device. */
type Design = 'joseon' | 'japan' | 'ming' | 'europe';
const DESIGNS: readonly Design[] = ['joseon', 'japan', 'ming', 'europe'];
const designOf = (f: Faction): Design => (f === 'joseon' || f === 'japan' || f === 'ming' ? f : 'europe');
const bannerTextures = new Map<Design, CanvasTexture>();
function bannerTexture(design: Design) {
  let tex = bannerTextures.get(design);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  const [field, trim, ink] = design === 'joseon' ? ['#1d3f8f', '#d8b04a', '#f4ead2'] : design === 'japan' ? ['#efe9dc', '#20201e', '#1a1a1a'] : design === 'ming' ? ['#c9a227', '#9b1d16', '#7a1410'] : ['#f2efe6', '#a3241c', '#a3241c'];
  g.fillStyle = field;
  g.fillRect(0, 0, 128, 256);
  // A flame-tongued trim down the fly edge and along the foot, as the period's banners have.
  g.fillStyle = trim;
  g.fillRect(0, 0, 128, 14);
  for (let y = 14; y < 256; y += 24) {
    g.beginPath();
    g.moveTo(104, y);
    g.lineTo(128, y + 12);
    g.lineTo(104, y + 24);
    g.closePath();
    g.fill();
  }
  g.fillRect(96, 0, 10, 256);
  g.fillStyle = ink;
  g.strokeStyle = ink;
  if (design === 'japan') {
    g.lineWidth = 9;
    g.beginPath();
    g.arc(48, 92, 30, 0, Math.PI * 2);
    g.stroke();
    g.fillRect(44, 62, 8, 60);
  } else if (design === 'europe') {
    g.fillRect(40, 40, 16, 150);
    g.fillRect(8, 100, 80, 16);
  } else {
    g.font = 'bold 78px serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(design === 'joseon' ? '帥' : '明', 48, 90);
    g.font = 'bold 54px serif';
    g.fillText(design === 'joseon' ? '令' : '軍', 48, 175);
  }
  tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  bannerTextures.set(design, tex);
  return tex;
}

/** A small deterministic random per port, so a port's layout is the same every visit. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export class TheatreWorks {
  readonly group = new Group();
  private readonly meshes: InstancedMesh[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private disposed = false;

  constructor(
    private readonly setup: TheatreSetup,
    private readonly heightAt: (x: number, z: number) => number,
    /** Keeps the forest off these discs (world x, z, radius): the camps and villages stand in clearings. */
    private readonly clearTrees: (discs: { x: number; z: number; r: number }[]) => void = () => {},
  ) {}

  private land(x: number, z: number) {
    return this.heightAt(x, z) > 2;
  }

  /** The flattest dry spot near a port, a little inland from its harbour: where its camp is laid out. */
  private site(x: number, z: number) {
    let best = { x, z, score: -Infinity };
    for (let r = 0; r <= 600; r += 100) {
      for (let k = 0; k < (r ? 12 : 1); k += 1) {
        const a = (k / 12) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!this.land(px, pz)) continue;
        let lo = Infinity, hi = -Infinity, dry = 0;
        for (let j = 0; j < 8; j += 1) {
          const b = (j / 8) * Math.PI * 2, h = this.heightAt(px + Math.cos(b) * 160, pz + Math.sin(b) * 160);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
          if (h > 2) dry += 1;
        }
        const score = dry * 10 - (hi - lo) - r * 0.02;
        if (score > best.score) best = { x: px, z: pz, score };
      }
    }
    return best;
  }

  /** The direction from a site to its nearest open water, and the shore point there. */
  private shore(x: number, z: number) {
    for (let r = 60; r <= 1500; r += 40) {
      for (let k = 0; k < 24; k += 1) {
        const a = (k / 24) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (this.heightAt(px, pz) < -1) return { a, x: x + Math.cos(a) * (r - 30), z: z + Math.sin(a) * (r - 30) };
      }
    }
    return { a: 0, x, z };
  }

  /** Lays out every port and loads the few models it uses, one batch per model. */
  async load() {
    const spots: Spot[] = [];
    const posts: { x: number; z: number; owner: Faction }[] = [];
    const banners: { x: number; z: number; color: Color; design: Design }[] = [];
    const yards: { x: number; z: number; rot: number; w: number; d: number }[] = [];
    const clearings: { x: number; z: number; r: number }[] = [];
    this.setup.ports.forEach((p, n) => {
      if (!p.owner) return;
      const owner = p.owner;
      const color = owner === this.setup.me ? OWN : this.setup.foes.includes(owner) ? FOE : NEUTRAL;
      const rand = rng(n * 7919 + 17);
      const at = lonLatToWorld(p.lon, p.lat);
      const c = this.site(at.x, at.z);
      const sea = this.shore(c.x, c.z);
      const face = sea.a; // the camp's front (its gate) looks to the harbour
      const fx = Math.cos(face), fz = Math.sin(face), sx = -fz, sz = fx;
      const put = (piece: Piece, u: number, v: number, rot = face) => {
        const x = c.x + fx * u + sx * v, z = c.z + fz * u + sz * v;
        if (this.land(x, z)) spots.push({ piece, owner, x, z, rot });
      };
      const level = Math.max(1, p.camp);
      const R = 120 + level * 30;
      clearings.push({ x: c.x, z: c.z, r: R + 40 }, { x: sea.x, z: sea.z, r: 140 });
      // Palisade ring of posts, a gap for the gate on the harbour side.
      const count = Math.round((Math.PI * 2 * R) / 1.3);
      for (let i = 0; i < count; i += 1) {
        const a = face + (i / count) * Math.PI * 2;
        const da = Math.abs(Math.atan2(Math.sin(a - face), Math.cos(a - face)));
        if (da < 0.12) continue;
        const x = c.x + Math.cos(a) * R, z = c.z + Math.sin(a) * R;
        if (this.land(x, z)) posts.push({ x, z, owner });
      }
      // Gate towers either side of the gap and corner towers round the ring.
      put('battery', R, -26, face);
      put('battery', R, 26, face);
      for (const a of [Math.PI * 0.5, Math.PI, Math.PI * 1.5]) put('beacon', Math.cos(a) * R, Math.sin(a) * R, face + a);
      // Command hall at the back, the drill ground before it, barracks in ordered rows either side.
      put(p.camp >= 3 ? 'fortress' : 'hall', -R * 0.45, 0);
      yards.push({ x: c.x + fx * R * 0.12, z: c.z + fz * R * 0.12, rot: face, w: R * 0.5, d: R * 0.4 });
      const rows = 1 + Math.min(2, level);
      for (const side of [-1, 1]) {
        for (let row = 0; row < rows; row += 1) {
          for (let col = 0; col < 4; col += 1) put('barracks', R * 0.4 - col * 34, side * (R * 0.5 + row * 30), face + (side > 0 ? Math.PI : 0));
        }
      }
      put('arsenal', -R * 0.2, -R * 0.78 + 20);
      put('magazine', -R * 0.2, R * 0.78 - 20);
      // Banners along the ring and at the hall.
      for (let i = 0; i < 14 + level * 4; i += 1) {
        const a = face + ((i + 0.5) / (14 + level * 4)) * Math.PI * 2;
        const x = c.x + Math.cos(a) * (R + 6), z = c.z + Math.sin(a) * (R + 6);
        if (this.land(x, z)) banners.push({ x, z, color, design: designOf(owner) });
      }
      for (const v of [-24, 0, 24]) banners.push({ x: c.x - fx * R * 0.7 + sx * v, z: c.z - fz * R * 0.7 + sz * v, color, design: designOf(owner) });
      // On the water: the shipyard and quay where the works stand.
      const works = new Set(p.works);
      const onShore = (piece: Piece, along: number) => {
        const x = sea.x + sx * along, z = sea.z + sz * along;
        spots.push({ piece, owner, x, z, rot: face });
      };
      if (works.has('shipyard')) onShore('shipyard', -60);
      onShore('dock', works.has('shipyard') ? 50 : 0);
      if (works.has('battery')) onShore('battery', 120);
      // The beacon on the highest ground within a kilometre.
      if (works.has('beacon')) {
        let hi = { x: c.x, z: c.z, h: -Infinity };
        for (let k = 0; k < 40; k += 1) {
          const a = rand() * Math.PI * 2, r = 300 + rand() * 700, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r, h = this.heightAt(x, z);
          if (h > hi.h) hi = { x, z, h };
        }
        if (hi.h > 2) spots.push({ piece: 'beacon', owner, x: hi.x, z: hi.z, rot: 0 });
      }
      // A village outside the wall, beside it along the shore: a cleared hamlet of houses facing the water, as the
      // battles' villages stand. The side with more dry ground takes it.
      const side = [1, -1].map((k) => ({ k, dry: [0.6, 1, 1.4].filter((t) => this.land(c.x + sx * k * (R + 110) * t, c.z + sz * k * (R + 110) * t)).length })).sort((p, q) => q.dry - p.dry)[0]!.k;
      const vx = c.x + sx * side * (R + 110) - fx * 30, vz = c.z + sz * side * (R + 110) - fz * 30;
      clearings.push({ x: vx, z: vz, r: 120 });
      for (let i = 0; i < 22 + level * 6; i += 1) {
        const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 95;
        const x = vx + Math.cos(a) * r, z = vz + Math.sin(a) * r;
        if (!this.land(x, z) || spots.some((o) => o.piece === 'house' && Math.hypot(o.x - x, o.z - z) < 17)) continue;
        const rot = Math.round((face + (rand() - 0.5) * 0.5) / (Math.PI / 2)) * (Math.PI / 2) + (rand() - 0.5) * 0.25;
        spots.push({ piece: 'house', owner, x, z, rot, model: rand() < 0.35 ? 'giwa' : 'choga' });
      }
    });
    this.clearTrees(clearings);

    const m = new Matrix4(), q = new Quaternion(), s = new Vector3(), pos = new Vector3(), up = new Vector3(0, 1, 0);
    const ground = (x: number, z: number) => Math.max(0, this.heightAt(x, z));

    // The palisade, the drill grounds and the banners: plain batched shapes.
    const wood = new MeshStandardMaterial({ color: 0x5b4330, roughness: 0.9 });
    const earth = new MeshStandardMaterial({ color: 0x8a7a5e, roughness: 1 });
    this.materials.push(wood, earth);
    const post = new CylinderGeometry(0.42, 0.5, 1, 5).translate(0, 0.5, 0);
    const pad = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const pole = new CylinderGeometry(0.35, 0.45, 1, 6).translate(0, 0.5, 0);
    // A tall war banner (기치) hung from a cross-arm at the pole's top: a long cloth, wider than deep, in soft folds,
    // edged in a darker trim by its vertex colours.
    const flag = new PlaneGeometry(1, 1, 6, 10).translate(0.5, -0.5, 0);
    {
      const at = flag.attributes.position!, colors = new Float32Array(at.count * 3);
      for (let i = 0; i < at.count; i += 1) {
        const u = at.getX(i), v = -at.getY(i);
        at.setZ(i, Math.sin(u * 5.2 + v * 1.3) * 0.07 * u + Math.sin(v * 7) * 0.02);
        const edge = u > 0.86 || v > 0.9 || v < 0.06 ? 0.45 : 1;
        colors.set([edge, edge, edge], i * 3);
      }
      flag.setAttribute('color', new Float32BufferAttribute(colors, 3));
      flag.computeVertexNormals();
    }
    this.geometries.push(post, pad, pole, flag);
    const batch = (geometry: BufferGeometry, material: Material, n: number, set: (i: number) => void, shadow = true) => {
      if (!n) return null;
      const mesh = new InstancedMesh(geometry, material, n);
      for (let i = 0; i < n; i += 1) {
        set(i);
        mesh.setMatrixAt(i, m);
      }
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.group.add(mesh);
      return mesh;
    };
    batch(post, wood, posts.length, (i) => {
      const o = posts[i]!;
      m.compose(pos.set(o.x, ground(o.x, o.z) - 1, o.z), q.identity(), s.set(1, 5.5 + ((i * 7) % 5) * 0.12, 1));
    });
    batch(pole, wood, banners.length, (i) => {
      const o = banners[i]!;
      m.compose(pos.set(o.x, ground(o.x, o.z), o.z), q.identity(), s.set(1, 20, 1));
    });
    // The cloths, one batch per design, each tinted by its side (blue the player's, red a foe's).
    for (const design of DESIGNS) {
      const list = banners.filter((o) => o.design === design);
      if (!list.length) continue;
      const mat = new MeshStandardMaterial({ map: bannerTexture(design), roughness: 0.85, side: DoubleSide, vertexColors: true });
      this.materials.push(mat);
      const mesh = batch(flag, mat, list.length, (i) => {
        const o = list[i]!;
        m.compose(pos.set(o.x, ground(o.x, o.z) + 19.5, o.z), q.setFromAxisAngle(up, 0.6 + Math.sin(i * 1.7) * 0.35), s.set(5, 10.5, 1));
      }, false);
      if (mesh) list.forEach((o, i) => mesh.setColorAt(i, new Color(1, 1, 1).lerp(o.color, 0.35)));
    }

    // The buildings: each port's navy's own models where they exist, one batch per model.
    const byUrl = new Map<string, Spot[]>();
    for (const o of spots) {
      // The near models (1024 px) on a computer: the map is seen close enough for them. Phones keep the light ones.
      const lod = equipment.ships.skipLod0 ? 1 : 0;
      const url = o.model ? `/models/env/${o.model}${lod ? '_lod1' : ''}.glb` : buildingModelUrlFor(o.owner, MODEL_OF[o.piece], lod);
      const list = byUrl.get(url) ?? [];
      list.push(o);
      byUrl.set(url, list);
    }
    await Promise.all([...byUrl].map(async ([url, list]) => {
      const model = await fetchModel(url);
      if (!model || this.disposed) {
        model?.geometry.dispose();
        return;
      }
      this.geometries.push(model.geometry);
      const size = model.box.getSize(new Vector3()), center = model.box.getCenter(new Vector3());
      const base = new Matrix4().makeTranslation(-center.x, -model.box.min.y, -center.z);
      const span = Math.max(size.x, size.z);
      batch(model.geometry, model.material, list.length, (i) => {
        const o = list[i]!, k = SIZE[o.piece] / span;
        m.compose(pos.set(o.x, ground(o.x, o.z) - 0.5, o.z), q.setFromAxisAngle(up, -o.rot + Math.PI / 2), s.setScalar(k)).multiply(base);
      });
    }));
  }

  /** Frees the batches, their shapes and the models' geometry and materials. */
  dispose() {
    this.disposed = true;
    for (const mesh of this.meshes) {
      mesh.dispose();
      const mat = mesh.material as Material;
      if (!this.materials.includes(mat)) mat.dispose();
    }
    for (const g of this.geometries) g.dispose();
    for (const mat of this.materials) mat.dispose();
    this.meshes.length = 0;
    this.group.removeFromParent();
  }
}
