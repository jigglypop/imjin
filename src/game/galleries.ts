import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
} from 'three/webgpu';
import { Battle } from '../sim/battle';
import type { AmmoType, GunType, Ship, ShipKind } from '../sim/types';
import type { ShipViews } from '../ships/ShipViews';
import type { Effects } from '../fx/Effects';
import { heavyGeometry, hiyaGeometry, rocketGeometry, ARROW_GIRTH, ARROW_LEN, arrowForm } from '../fx/Projectiles';
import { arrowGeometry } from '../fx/arrows';
import { ORDNANCE, type Ordnance } from '../fx/ordnance';
import { hullTop } from '../ships/anchors';
import { t } from '../i18n';
import { disposeTree } from '../render/dispose';

/**
 * The inspection galleries behind `?gallery=`: `munitions` lays every projectile the battles fire on a jetty at its
 * true size beside a metre rule, each with its name, measures, weight and source; `damage` shows each ship model at the
 * stages of a fight (pristine, shield wall broken, holed, burning, listing), its marks made by the same code a battle
 * uses, for checking them by eye. `1` is the plain line of models.
 */
export type GalleryKind = 'ships' | 'munitions' | 'damage';

/** The stages of the damage gallery, a column each: pristine, shield wall broken, holed, burning, listing. */
export const DAMAGE_STAGES = ['pristine', 'shields', 'holed', 'burning', 'listing'];

/** Where the damage gallery's ships stand: a column per stage, a row per kind. */
const COL = 64;
const ROW = 38;

export function damageBattle(kinds: ShipKind[]) {
  const b = new Battle(7);
  kinds.forEach((kind, row) => {
    DAMAGE_STAGES.forEach((_, col) => {
      const s = b.addShip(kind, (col - (DAMAGE_STAGES.length - 1) / 2) * COL, (row - (kinds.length - 1) / 2) * ROW, 0, `${kind}:${col}`, null, false, 0);
      s.speed = 0;
      s.team = 'joseon';
      s.order = { type: 'hold' };
    });
  });
  b.land = () => -50;
  return b;
}

/** The camera on one row of the damage gallery, from the side its marks are on. */
export function damagePose(kinds: ShipKind[], row: number) {
  return { tx: 0, tz: (row - (kinds.length - 1) / 2) * ROW, yaw: Math.PI / 2, pitch: 0.16, distance: 190 };
}

/**
 * Lays the marks of each stage on the damage gallery's ships once their views exist, then holds the fire, the char and
 * the flooding of the stages that have them (the sim would put the fires out and pump the hulls dry).
 */
export class DamageGallery {
  private applied = false;
  private readonly p = new Vector3();

  constructor(
    private readonly battle: Battle,
    private readonly views: ShipViews,
    private readonly fx: Effects,
  ) {}

  /** The ship of a stage: its index in the row is its stage. */
  private stageOf(s: Ship) {
    return Number(s.name.split(':')[1] ?? 0);
  }

  tick() {
    for (const s of this.battle.ships) {
      const stage = this.stageOf(s);
      s.hull = s.spec.hull;
      s.fire = stage === 3 ? 0.42 : stage === 4 ? 0.12 : 0;
      s.burn = stage === 3 ? 0.2 : stage === 4 ? 0.5 : 0;
      if (stage === 4) s.damageState = { flooding: 0.85, propulsion: 0, steering: 0 };
      else s.damageState = undefined;
      s.speed = 0;
    }
    if (this.applied || !this.battle.ships.every((s) => this.views.states.has(s.id))) return;
    this.applied = true;
    for (const s of this.battle.ships) this.mark(s, this.stageOf(s));
  }

  /**
   * One shot at the ship's +z side: plan station `fx` (fraction of the length), height `y` above the waterline, coming
   * in level (or along `dx`, `dz` in the ship's frame), at `speed`.
   */
  private shot(s: Ship, fx: number, y: number, ammo: AmmoType, gun: GunType, speed: number, dx = 0, dz = -1, range = 140) {
    const surface = this.fx.scars.surface(s);
    if (!surface) return;
    const x = fx * surface.hull.length * surface.scale;
    const p = this.views.localToWorld(s.id, x, y * surface.scale, 1, this.p);
    const c = Math.cos(s.heading);
    const n = Math.sin(s.heading);
    const l = Math.hypot(dx, dz) || 1;
    // Ship frame to world: x along the heading, z across.
    const wx = (dx * c - dz * n) / l;
    const wz = (dx * n + dz * c) / l;
    this.fx.scars.hit(s, p.x, p.y, p.z, wx, -0.04, wz, speed, ammo, gun, range);
  }

  private mark(s: Ship, stage: number) {
    if (stage < 1) return;
    const surface = this.fx.scars.surface(s);
    if (!surface) return;
    const deck = hullTop(surface.hull, 0);
    const wall = surface.walls ? (surface.boardY[0] + surface.boardY[1]) / 2 : deck - 0.4;
    // Stage 1: the wall shot up by small shot and a great arrow, matchlock balls flattened on it.
    this.shot(s, 0.24, wall, 'grape', 'cheonja', 140, 0, -1, 90);
    this.shot(s, -0.08, wall, 'grape', 'hwangja', 130, 0, -1, 160);
    this.shot(s, 0.05, wall, 'grape', 'jija', 135, 0, -1, 120);
    this.shot(s, -0.3, wall, 'arrow', 'jija', 110);
    for (let i = 0; i < 6; i += 1) this.fx.scars.musket(s, s.x - Math.sin(s.heading) * 80, s.z + Math.cos(s.heading) * 80);
    if (stage < 2) return;
    // Stage 2: great arrows and round shot in the hull.
    this.shot(s, 0.15, deck - 1.2, 'arrow', 'cheonja', 120);
    this.shot(s, -0.2, deck - 2, 'arrow', 'jija', 110);
    this.shot(s, 0.32, deck - 0.8, 'ball', 'hyeonja', 135);
    this.shot(s, -0.38, deck - 1.5, 'ball', 'cheonja', 150);
    this.shot(s, 0.02, deck - 1, 'ball', 'ozutsu', 120);
    this.shot(s, 0.42, deck - 0.6, 'ball', 'hyeonja', 135, -0.95, -0.3);
    if (stage < 3) return;
    // Stage 3: fire arrows in the planks and the sails.
    this.shot(s, -0.05, deck - 0.5, 'fire', 'ozutsu', 90);
    this.shot(s, 0.2, deck - 0.3, 'fire', 'cheonja', 90);
    for (let i = 0; i < 3; i += 1) {
      const p = this.views.localToWorld(s.id, (i - 1) * 6, deck + 6, 0, this.p);
      this.fx.scars.rocket(s, p.x, p.y, p.z, -Math.sin(s.heading) * 0.3, -0.5, -Math.cos(s.heading) * 0.8);
    }
    this.views.tears.set(s.id, stage === 3 ? 0.45 : 0.7);
    if (stage < 4) return;
    // Stage 4: holed at the waterline and settling.
    this.shot(s, 0.1, 0.5, 'arrow', 'cheonja', 120);
    this.shot(s, -0.32, 0.7, 'arrow', 'jija', 110);
  }
}

// ---- The munitions jetty -------------------------------------------------------------------------------------------

/** The jetty's top, metres above the sea. */
const TOP = 1.7;
/** Width of a projectile's place on the rack. */
const SLOT = 0.52;
const LABEL_W = 0.48;
const LABEL_H = 0.6;
const CELL_W = 256;
const CELL_H = 320;
const COLS = 8;

const material = (color: [number, number, number], rough = 0.8, metal = 0) => new MeshStandardNodeMaterial({ color: new Color(color[0], color[1], color[2]), roughness: rough, metalness: metal });

/** The things that go on the rack, in the order of the table. */
function model(o: Ordnance): { geo: BufferGeometry; mat: MeshStandardNodeMaterial; scale: [number, number, number]; lie: 'x' | 'z' | 'ball'; up: number } {
  const wood = () => new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05 });
  switch (o.model) {
    case 'heavyArrow': {
      const [len, girth] = arrowForm(o.gun!);
      return { geo: heavyGeometry(), mat: wood(), scale: [len / ARROW_LEN, girth / ARROW_GIRTH, girth / ARROW_GIRTH], lie: 'x', up: girth / 2 + 0.006 };
    }
    case 'rocket':
      return { geo: rocketGeometry(), mat: wood(), scale: [o.length / 1.22, o.length / 1.22, o.length / 1.22], lie: 'x', up: 0.06 * (o.length / 1.22) };
    case 'hiya':
      return { geo: hiyaGeometry(), mat: wood(), scale: [o.length / 1.02, o.length / 1.02, o.length / 1.02], lie: 'x', up: 0.04 };
    case 'bowArrow':
    case 'fireArrow': {
      // The bow arrow model is one unit long along -z from its tip, its shaft 3.6 hundredths of the length across.
      const across = 0.009 / 0.036;
      return { geo: arrowGeometry(), mat: wood(), scale: [across, across, o.length], lie: 'z', up: 0.012 };
    }
    default: {
      const r = o.diameter / 2;
      const stuff = o.stuff ?? 'iron';
      const color: [number, number, number] = stuff === 'lead' ? [0.24, 0.24, 0.25] : stuff === 'stone' ? [0.42, 0.4, 0.37] : [0.07, 0.068, 0.066];
      return { geo: new SphereGeometry(1, 24, 16), mat: material(color, stuff === 'iron' ? 0.5 : 0.85, stuff === 'stone' ? 0 : 0.6), scale: [r, r, r], lie: 'ball', up: r };
    }
  }
}

/** Writes one label into its cell of the atlas: the name, its characters, the weapon, measures, weight and source. */
function paintLabel(ctx: CanvasRenderingContext2D, o: Ordnance, cx: number, cy: number) {
  const font = "'Pretendard Variable', Pretendard, 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(cx + 4, cy + 4, CELL_W - 8, CELL_H - 8);
  ctx.strokeStyle = '#5b4630';
  ctx.lineWidth = 3;
  ctx.strokeRect(cx + 6, cy + 6, CELL_W - 12, CELL_H - 12);
  ctx.fillStyle = '#2a1d12';
  ctx.textBaseline = 'top';
  let y = cy + 18;
  const line = (text: string, size: number, weight = 400, color = '#2a1d12') => {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = color;
    // Wrap on spaces to the cell's width.
    const words = text.split(' ');
    let row = '';
    for (const w of words) {
      const next = row ? `${row} ${w}` : w;
      if (ctx.measureText(next).width > CELL_W - 30 && row) {
        ctx.fillText(row, cx + 15, y);
        y += size * 1.25;
        row = w;
      } else row = next;
    }
    if (row) {
      ctx.fillText(row, cx + 15, y);
      y += size * 1.25;
    }
  };
  line(t(o.name), 30, 700);
  line(o.hanja, 22, 500, '#6b4a2c');
  y += 4;
  line(t(o.by), 17, 600, '#4a3826');
  const cm = (m: number) => String(Math.round(m * 1000) / 10);
  line(o.length > 0 ? t('길이 {l} m · 지름 {d} cm', { l: o.length.toFixed(2), d: cm(o.diameter) }) : t('지름 {d} cm', { d: cm(o.diameter) }), 17);
  line(o.mass >= 1 ? t('무게 {w} kg', { w: o.mass.toFixed(1) }) : t('무게 {w} g', { w: Math.round(o.mass * 1000) }), 17);
  line(t(o.record), 15, 400, '#4a3826');
  y += 4;
  line(t(o.source), 13, 400, '#6b5a48');
}

/** The munitions jetty: the rack, its posts, the projectiles at true size, their labels and a metre rule. */
export class MunitionsGallery {
  readonly group = new Group();
  /** Where the rack's middle is, for the camera. */
  readonly center = { x: 0, z: 0 };

  constructor() {
    const n = ORDNANCE.length;
    const width = n * SLOT + 0.6;
    const timber = material([0.13, 0.09, 0.055], 0.9);
    const dark = material([0.16, 0.11, 0.07], 0.95);
    const deck = new Mesh(new BoxGeometry(width, 0.1, 2.7), timber);
    deck.position.set(0, TOP - 0.05, 0);
    this.group.add(deck);
    for (const x of [-width / 2 + 0.2, 0, width / 2 - 0.2]) {
      for (const z of [-1.2, 1.2]) {
        const post = new Mesh(new CylinderGeometry(0.12, 0.14, TOP + 3, 8), dark);
        post.position.set(x, TOP / 2 - 1.5, z);
        this.group.add(post);
      }
    }
    // The metre rule along the front edge: ten white and black decimetres.
    for (let i = 0; i < 10; i += 1) {
      const seg = new Mesh(new BoxGeometry(0.1, 0.012, 0.05), material(i % 2 ? [0.05, 0.05, 0.05] : [0.85, 0.83, 0.78], 0.7));
      seg.position.set(-width / 2 + 0.35 + i * 0.1, TOP + 0.006, 1.25);
      this.group.add(seg);
    }
    const canvas = document.createElement('canvas');
    canvas.width = CELL_W * COLS;
    canvas.height = CELL_H * Math.ceil(n / COLS);
    const ctx = canvas.getContext('2d')!;
    ORDNANCE.forEach((o, i) => paintLabel(ctx, o, (i % COLS) * CELL_W, Math.floor(i / COLS) * CELL_H));
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 8;
    const labelMat = new MeshStandardNodeMaterial({ map: tex, roughness: 0.95 });
    ORDNANCE.forEach((o, i) => {
      const x = -width / 2 + 0.3 + SLOT * (i + 0.5);
      const m = model(o);
      const mesh = new Mesh(m.geo, m.mat);
      mesh.scale.set(...m.scale);
      // Arrows lie across the rack pointing away from the viewer; balls sit at its front.
      if (m.lie === 'x') {
        mesh.rotation.y = Math.PI / 2;
        mesh.position.set(x, TOP + m.up, 0.1);
      } else if (m.lie === 'z') {
        // The bow arrow model runs back along -z from its tip: turned round, its head points away like the others'.
        mesh.rotation.y = Math.PI;
        mesh.position.set(x, TOP + m.up, -0.85);
      } else mesh.position.set(x, TOP + m.up, 0.9);
      this.group.add(mesh);
      // A fire arrow carries its charge of powder in paper bound behind the head.
      if (o.model === 'fireArrow') {
        const charge = new Mesh(new CylinderGeometry(0.014, 0.014, 0.09, 10), material([0.42, 0.33, 0.2], 0.9));
        charge.rotation.x = Math.PI / 2;
        charge.position.set(x, TOP + m.up, -0.85 + 0.1);
        this.group.add(charge);
      }
      // The label stands at the back of the rack, a little tilted back.
      const geo = new PlaneGeometry(LABEL_W, LABEL_H);
      const u0 = ((i % COLS) * CELL_W) / canvas.width;
      const v1 = 1 - (Math.floor(i / COLS) * CELL_H) / canvas.height;
      const u1 = u0 + CELL_W / canvas.width;
      const v0 = v1 - CELL_H / canvas.height;
      const uv = geo.getAttribute('uv');
      for (let k = 0; k < uv.count; k += 1) uv.setXY(k, uv.getX(k) ? u1 : u0, uv.getY(k) ? v1 : v0);
      const label = new Mesh(geo, labelMat);
      label.position.set(x, TOP + LABEL_H / 2 + 0.05, -1.25);
      label.rotation.x = -0.25;
      this.group.add(label);
    });
  }

  dispose() {
    disposeTree(this.group);
  }
}
