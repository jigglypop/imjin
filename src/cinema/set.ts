import { Group, InstancedBufferAttribute, InstancedMesh, type BufferGeometry, type Material } from 'three/webgpu';
import { SHIP_SPECS } from '../sim/catalog';
import type { ShipKind } from '../sim/types';
import type { Faction } from '../ships/build/atlas';
import { atlasMaterial } from '../ships/build/atlasMaterial';
import { flag, lantern, mulberry32, post, type Ctx, type Lod } from '../ships/build/common';
import { box, cloth, cylinder, MeshBuilder, paints, rectSection, sweep, type V3 } from '../ships/build/parts';
import { toGeometry } from '../ships/build/pack';
import { createMaterial } from '../ships/ShipRenderer';

/**
 * The close-up set (owner 2026-10-18): the commanders are filmed on a small deck piece of their own, not on the real
 * ships (a real deck pitches, clips his feet and crowds the frame). One piece per ship family, built with the ships' own
 * parts and painted from the flagship's own atlas (the same textures the battle already holds, so it costs no memory but
 * its few thousand triangles), lit by the battle's sun, sky, fog and exposure. It stands still where his flagship is,
 * the real flagship hidden while it shows, so behind him is the battle's own sea, coast and fleet.
 *
 * Frame: metres, x forward (the way he faces, toward the camera), y up from the deck at his feet, z to his right.
 */
export type SetFamily = 'joseon' | 'japan' | 'ming' | 'galleon' | 'galley' | 'line';

const FAMILY: Record<Faction, SetFamily> = {
  joseon: 'joseon', japan: 'japan', ming: 'ming', england: 'galleon', spain: 'galleon',
  holyleague: 'galley', ottoman: 'galley', britain: 'line', france: 'line', spain1805: 'line',
};

/** Height of the set's deck over the sea: about where each family's commander stood. */
const DECK: Record<SetFamily, number> = { joseon: 5.2, japan: 7.4, ming: 5.6, galleon: 6.4, galley: 2.6, line: 7 };

/** Each navy's own command flag (flags_a sheet). */
const FLAG: Record<Faction, string> = {
  joseon: 'su', japan: 'white', ming: 'commander', england: 'stgeorge', spain: 'burgundy',
  holyleague: 'holyleague', ottoman: 'kapudan', britain: 'white', france: 'tricolore', spain1805: 'rojigualda',
};

export const factionOf = (kind: ShipKind) => SHIP_SPECS[kind].faction as Faction;
export const familyOf = (kind: ShipKind) => FAMILY[factionOf(kind)];
export const deckHeight = (kind: ShipKind) => DECK[familyOf(kind)];

const X0 = -8;
const X1 = 5;
const HZ = 4.2;

/** The set's geometry in its own frame (see above); `lod` 1 on phones. */
export function buildSet(faction: Faction, lod: Lod) {
  const family = FAMILY[faction];
  const b = new MeshBuilder();
  const ctx: Ctx = { b, lod, faction, P: paints(faction), rnd: mulberry32(4242) };
  const { P } = ctx;
  const cell = (names: string[], opts = {}) => {
    for (const n of names) {
      try {
        return P(n, opts);
      } catch {
        // Not in this navy's atlas: the next name.
      }
    }
    return P('hull_plank', opts);
  };
  const deck = P('deck_plank');
  const hull = P('hull_plank');
  const rope = P('rope');
  const dark = cell(['dark_timber', 'black_lacquer', 'black_paint', 'cabin_wood'], { tint: [0.6, 0.58, 0.55] });
  const mastWood = cell(['pine_mast', 'mast_wood', 'hull_plank']);
  const iron = cell(['iron', 'iron_hex']);
  const H = DECK[family];
  const seg = lod === 0 ? 12 : 7;

  // The deck: planks running fore and aft, and the hull's side down into the sea under it.
  box(b, deck, [X0, -0.22, -HZ], [X1, 0, HZ], { grain: 0 });
  box(b, hull, [X0 + 0.05, -H - 0.8, -HZ + 0.05], [X1 - 0.05, -0.22, HZ - 0.05], { grain: 0 });

  const rail = (paint: typeof deck, cap: typeof deck, height: number, step: number, w = 0.13) => {
    for (const s of [-1, 1]) {
      for (let x = X0 + 0.2; x <= X1 - 0.2; x += step) post(ctx, paint, x, 0, height, s * (HZ - 0.12), w);
      box(b, cap, [X0, height, s * (HZ - 0.12) - 0.11], [X1, height + 0.1, s * (HZ - 0.12) + 0.11], { grain: 0 });
      box(b, cap, [X0, height * 0.45, s * (HZ - 0.12) - 0.05], [X1, height * 0.45 + 0.07, s * (HZ - 0.12) + 0.05], { grain: 0 });
    }
    for (let z = -HZ + 0.2; z <= HZ - 0.2; z += step) post(ctx, paint, X0 + 0.12, 0, height, z, w);
    box(b, cap, [X0 + 0.01, height, -HZ], [X0 + 0.23, height + 0.1, HZ], { grain: 2 });
    box(b, cap, [X0 + 0.05, height * 0.45, -HZ], [X0 + 0.19, height * 0.45 + 0.07, HZ], { grain: 2 });
  };
  /** A solid bulwark along both sides and the after end, `height` tall, its cap `cap`. */
  const bulwark = (paint: typeof deck, cap: typeof deck, height: number) => {
    for (const s of [-1, 1]) {
      box(b, paint, [X0, 0, s * HZ - (s > 0 ? 0.18 : 0)], [X1, height, s * HZ + (s < 0 ? 0.18 : 0)], { grain: 0 });
      box(b, cap, [X0, height, s * HZ - 0.24], [X1, height + 0.08, s * HZ + 0.24], { grain: 0 });
    }
    box(b, paint, [X0, 0, -HZ], [X0 + 0.18, height, HZ], { grain: 2 });
    box(b, cap, [X0 - 0.06, height, -HZ], [X0 + 0.24, height + 0.08, HZ], { grain: 2 });
    // Knees inside the bulwark.
    for (const s of [-1, 1]) for (let x = X0 + 1; x < X1; x += 1.6) box(b, cap, [x - 0.07, 0, s * (HZ - 0.34)], [x + 0.07, height, s * (HZ - 0.18)], { grain: 1 });
  };
  /** The mast behind his left shoulder, its foot and a few shrouds down to the side. */
  const mast = (x: number, z: number, r: number) => {
    cylinder(b, mastWood, [x, -0.2, z], [x, 18, z], r, r * 0.8, seg, true, 4);
    cylinder(b, iron, [x, 1.6, z], [x, 1.75, z], r * 1.06, r * 1.06, seg, false);
    cylinder(b, iron, [x, 3.4, z], [x, 3.55, z], r * 1.04, r * 1.04, seg, false);
    box(b, dark, [x - r * 1.6, 0, z - r * 1.6], [x + r * 1.6, 0.32, z + r * 1.6], { grain: 0 });
    // Belaying pins round the foot, with coils hung on them.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) cylinder(b, dark, [x + dx * r * 1.4, 0.32, z + dz * r * 1.4], [x + dx * r * 1.4, 0.75, z + dz * r * 1.4], 0.03, 0.03, 4, true);
  };
  const line = (from: V3, to: V3, r = 0.022) => sweep(b, rope, [from, to], rectSection(r * 2, r * 2));

  switch (family) {
    case 'joseon': {
      // The panokseon's command deck (장대): a dancheong-painted railing and the pavilion's two after pillars.
      const posts = cell(['stained_wood', 'dark_timber']);
      const paintW = cell(['dancheong', 'stained_wood']);
      rail(posts, dark, 1.0, 1.1);
      for (const s of [-1, 1]) post(ctx, posts, X0 + 0.5, 0, 3.4, s * 3.7, 0.2);
      box(b, paintW, [X0 + 0.35, 3.0, -3.9], [X0 + 0.65, 3.36, 3.9], { grain: 2 });
      mast(-3.6, 2.4, 0.34);
      line([-3.6, 13, 2.4], [X0 + 1.4, 1.1, HZ - 0.1]);
      line([-3.6, 13, 2.4], [0.6, 1.1, HZ - 0.1]);
      line([-3.6, 12.5, 2.4], [X0 + 1.4, 1.1, -HZ + 0.1]);
      flag(ctx, { pole: [X0 + 1.2, 1.0, -2.6], poleH: 5.2, w: 2.4, h: 2.2, sheet: 'flags_a', flag: FLAG[faction], phase: 0.4, wood: dark, nu: lod ? 4 : 10, nv: lod ? 3 : 7, flutter: 1.1 });
      flag(ctx, { pole: [X0 + 0.4, 1.0, 3.4], poleH: 3.4, w: 1.2, h: 1.0, sheet: 'flags_b', flag: 'blue', phase: 1.7, wood: dark });
      break;
    }
    case 'japan': {
      // The atakebune's castle deck: plastered walls with lacquered posts, the clan's curtain (maku) along the after rail.
      const plaster = P('plaster');
      const lacquer = P('black_lacquer');
      bulwark(plaster, lacquer, 0.9);
      for (const s of [-1, 1]) for (let x = X0 + 0.6; x < X1; x += 1.8) post(ctx, lacquer, x, 0, 1.1, s * (HZ - 0.1), 0.16);
      const maku = P('maku');
      // Along his left side only, so the sea and the fleet show behind him.
      for (const x of [X0 + 0.5, -4.5, -1]) post(ctx, lacquer, x, 1.0, 2.7, -HZ + 0.3, 0.1);
      cloth(b, maku, [-1, 2.6, -HZ + 0.32], [X0 + 0.5 + 1, 0, 0], [0, -1.35, 0], { nu: lod ? 4 : 12, nv: lod ? 1 : 3, billow: 0.12, flutter: 0.25, phase: 0.6 });
      mast(-3.4, 2.6, 0.36);
      line([-3.4, 13, 2.6], [X0 + 1.2, 1.1, HZ - 0.1]);
      line([-3.4, 13, 2.6], [0.8, 1.1, HZ - 0.1]);
      flag(ctx, { pole: [X0 + 1.4, 1.1, -3.0], poleH: 4.6, w: 0.95, h: 3.0, sheet: 'nobori_a', flag: 'white', phase: 0.3, wood: P('bamboo'), nu: lod ? 2 : 4, nv: lod ? 3 : 8, flutter: 0.8 });
      flag(ctx, { pole: [X0 + 1.4, 1.1, 1.2], poleH: 4.2, w: 0.85, h: 2.7, sheet: 'nobori_b', flag: 'black', phase: 1.3, wood: P('bamboo'), nu: lod ? 2 : 4, nv: lod ? 3 : 8, flutter: 0.8 });
      break;
    }
    case 'ming': {
      const red = P('red_lacquer');
      rail(red, cell(['cabin_wood', 'hull_plank']), 1.05, 1.0);
      mast(-3.6, 2.5, 0.38);
      line([-3.6, 13, 2.5], [X0 + 1.2, 1.1, HZ - 0.1]);
      line([-3.6, 13, 2.5], [0.6, 1.1, HZ - 0.1]);
      flag(ctx, { pole: [X0 + 1.2, 1.05, -2.8], poleH: 5.2, w: 2.6, h: 2.2, sheet: 'flags_a', flag: FLAG[faction], phase: 0.4, wood: dark, nu: lod ? 4 : 10, nv: lod ? 3 : 7, flutter: 1.2 });
      break;
    }
    case 'galleon': {
      // A galleon's quarterdeck: a painted bulwark, the navy's shields (pavesses) on the English rail.
      const paint = faction === 'england' ? P('tudor_paint') : P('red_paint');
      bulwark(paint, cell(['cabin_wood', 'hull_plank']), 0.7);
      if (faction === 'england' && lod === 0) for (const s of [-1, 1]) for (let x = X0 + 0.9; x < X1; x += 1.25) box(b, P('pavesse'), [x - 0.38, 0.25, s * (HZ + 0.19) - 0.02], [x + 0.38, 0.95, s * (HZ + 0.19) + 0.02], { grain: 1 });
      mast(-3.8, 2.6, 0.3);
      for (const x of [X0 + 1, X0 + 2.2, -1.6, 0.2]) line([-3.8, 14, 2.6], [x, 1.2, HZ + 0.1]);
      line([-3.8, 14, 2.6], [X0 + 1.2, 1.2, -HZ - 0.1]);
      flag(ctx, { pole: [X0 + 0.5, 1.1, -0.4], poleH: 5.6, w: 2.8, h: 1.9, sheet: 'flags_a', flag: FLAG[faction], phase: 0.3, wood: dark, nu: lod ? 4 : 10, nv: lod ? 3 : 6 });
      break;
    }
    case 'galley': {
      // A galley's stern platform: a low gilt-capped rail and the stern lantern (no canopy frames: they cut across the frame).
      const paint = P('red_paint');
      const gilt = P('gilt');
      rail(paint, gilt, 0.9, 0.9, 0.1);
      lantern(ctx, gilt, gilt, [X0 - 0.3, 3.1, 0], 0.42);
      cylinder(b, gilt, [X0 + 0.1, 0.9, 0], [X0 - 0.3, 3.1, 0], 0.06, 0.05, 6, true);
      flag(ctx, { pole: [X0 + 0.4, 0.9, -2.2], poleH: 5.4, w: 2.8, h: 2.0, sheet: 'flags_a', flag: FLAG[faction], phase: 0.3, wood: dark, nu: lod ? 4 : 10, nv: lod ? 3 : 6 });
      line([X0 + 0.4, 6.2, -2.2], [X0 + 0.2, 0.9, HZ - 0.2]);
      break;
    }
    case 'line': {
      // An 1805 quarterdeck: a black bulwark with the hammocks stowed in their netting along its top, the mizzen, the wheel.
      bulwark(P('black_paint'), P('black_paint'), 0.85);
      const hammocks = P('sail_canvas', { tint: [0.82, 0.8, 0.74] });
      for (const s of [-1, 1]) box(b, hammocks, [X0, 0.93, s * HZ - 0.26], [X1, 1.25, s * HZ + 0.26], { grain: 0 });
      box(b, hammocks, [X0 - 0.1, 0.93, -HZ], [X0 + 0.32, 1.25, HZ], { grain: 2 });
      for (const s of [-1, 1]) for (let x = X0 + 0.4; x < X1; x += 1.5) cylinder(b, iron, [x, 0.85, s * HZ], [x, 1.45, s * HZ], 0.025, 0.025, 4, true);
      mast(-4.4, -2.3, 0.36);
      for (const x of [X0 + 0.8, X0 + 1.9, -2.8, -1.6]) line([-4.4, 15, -2.3], [x, 1.25, -HZ - 0.2]);
      line([-4.4, 15, -2.3], [X0 + 1.2, 1.25, HZ + 0.2]);
      // The wheel, well behind him to his right.
      const wx = -5.6;
      const wz = 2.7;
      const ring: V3[] = [];
      for (let i = 0; i <= 18; i += 1) {
        const a = (i / 18) * Math.PI * 2;
        ring.push([wx, 1.25 + Math.sin(a) * 0.72, wz + Math.cos(a) * 0.72]);
      }
      const wood = P('cabin_wood');
      if (lod === 0) sweep(b, wood, ring, rectSection(0.07, 0.09), { up: [1, 0, 0] });
      for (let i = 0; i < 5; i += 1) {
        const a = (i / 5) * Math.PI;
        cylinder(b, wood, [wx, 1.25 - Math.sin(a) * 0.9, wz - Math.cos(a) * 0.9], [wx, 1.25 + Math.sin(a) * 0.9, wz + Math.cos(a) * 0.9], 0.03, 0.03, 4, true);
      }
      box(b, wood, [wx - 0.35, 0, wz - 0.12], [wx - 0.12, 1.3, wz + 0.12], { grain: 1 });
      box(b, wood, [wx - 0.4, 0.85, wz - 0.3], [wx - 0.05, 1.05, wz + 0.3], { grain: 2 });
      flag(ctx, { pole: [X0 + 0.3, 1.2, 0.8], poleH: 6.2, w: 3.2, h: 1.6, sheet: 'flags_a', flag: FLAG[faction], phase: 0.3, wood: dark, nu: lod ? 4 : 10, nv: lod ? 3 : 6 });
      break;
    }
  }
  return { data: b.data(), height: H };
}

/** One built set: its mesh (hidden until his close-up), placed in the world by `place`. */
export class DeckSet {
  readonly group = new Group();
  readonly height: number;
  private mesh: InstancedMesh | null = null;
  private geometry: BufferGeometry | null = null;
  private material: Material | null = null;
  private readonly a = new InstancedBufferAttribute(new Float32Array(4), 4);
  private readonly b = new InstancedBufferAttribute(new Float32Array([0, 1, 0, 0]), 4);
  /** Resolves once the mesh is built and its atlas is in (the battle's own, from the cache). */
  readonly ready: Promise<void>;

  constructor(kind: ShipKind, lod: Lod) {
    const faction = factionOf(kind);
    const built = buildSet(faction, lod);
    this.height = built.height;
    this.group.name = 'cinema_set';
    this.group.visible = false;
    this.ready = atlasMaterial(faction, kind).then((src) => {
      if (this.disposed) return;
      this.geometry = toGeometry(built.data);
      this.material = createMaterial(src, this.a, this.b);
      const mesh = new InstancedMesh(this.geometry, this.material, 1);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.mesh = mesh;
      this.group.add(mesh);
    });
  }

  private disposed = false;

  get loaded() {
    return !!this.mesh;
  }

  /** Stands the set with his feet at (x, height over the sea, z), facing `facing` (radians from +x toward +z). */
  place(x: number, z: number, facing: number, scale: number) {
    this.group.position.set(x, this.height * scale, z);
    this.group.rotation.set(0, -facing, 0);
    this.group.scale.setScalar(scale);
    this.group.updateMatrixWorld(true);
    // The ships' shader darkens the hull below the waterline from the instance's origin at the sea.
    const a = this.a.array as Float32Array;
    a[0] = x;
    a[1] = 0;
    a[2] = z;
    a[3] = 0;
    this.a.needsUpdate = true;
  }

  dispose() {
    this.disposed = true;
    this.group.removeFromParent();
    this.mesh?.dispose();
    this.geometry?.dispose();
    // The atlas textures are the battle's (atlasMaterial's cache): only the node material is ours.
    this.material?.dispose();
    this.mesh = null;
  }
}
