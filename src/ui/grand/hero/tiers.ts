import type { FactionId } from '../types';
import { joTier1, waFieldCamp } from './layouts';
import { rect, type BodyLook, type Colour, type P2, type Piece, type Plan, type RoofStyle, type WallLook } from './plan';

// Every other camp on the map built to the hero camps' rules (layouts.ts), by navy and level: a compound on one levelled
// pad with its retaining skirt, buildings at their true sizes in ordered rows, walls along the pad, gates and towers,
// banners. Level 1 is a palisade, a curtain or a stockade round a few huts; level 2 an earth-and-stone or plastered wall
// round rows of barracks and a hall; level 3 a stone, ishigaki or brick fortress with a landmark. Each is laid out in its
// own frame turned so its main gate and landing face the water, and stands on a pad levelled at the highest ground under
// it (the land is not cut here, so a pad on a slope stands as a terrace on its skirt).

const PI = Math.PI;
const OBANG: Colour[] = ['blue', 'red', 'white', 'black', 'yellow'];
const NOBORI: Colour[] = ['white', 'black', 'white', 'red'];
const MING: Colour[] = ['red', 'yellow'];

/** A camp's frame: (a, b) of its own (b towards its gate and the water) to the plan's (x, z). */
class Frame {
  readonly c: number;
  readonly s: number;
  constructor(readonly m: Plan, readonly cx: number, readonly cz: number, readonly rot: number) {
    this.c = Math.cos(rot);
    this.s = Math.sin(rot);
  }
  P(a: number, b: number): P2 {
    return [this.cx + a * this.c + b * this.s, this.cz - a * this.s + b * this.c];
  }
  poly(pts: readonly P2[]) {
    return pts.map(([a, b]) => this.P(a, b));
  }
  /** The level a pad over `pts` stands at: the highest ground under it, a little above the sea at least. */
  level(pts: readonly P2[]) {
    let hi = 0.8;
    const [x0, x1] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
    const [z0, z1] = [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
    for (let a = x0; a <= x1; a += 3) for (let b = z0; b <= z1; b += 3) {
      const [x, z] = this.P(a, b);
      hi = Math.max(hi, this.m.natural(x, z));
    }
    return hi + 0.25;
  }
  bldg(a: number, b: number, turn: number, y: number, w: number, d: number, look: BodyLook, o: { wallH?: number; rise?: number; overhang?: number; style?: RoofStyle; base?: number } = {}) {
    const [x, z] = this.P(a, b);
    this.m.add({ kind: 'bldg', x, z, rot: this.rot + turn, y, w, d, wallH: o.wallH ?? 2.2, rise: o.rise ?? 1.9, overhang: o.overhang ?? 0.55, style: o.style ?? 'hipgable', base: o.base ?? 0.35, look });
  }
  piece(p: Piece) {
    if ('x' in p && 'z' in p) {
      const [x, z] = this.P(p.x, p.z);
      this.m.add({ ...p, x, z, ...('rot' in p ? { rot: this.rot + p.rot } : {}) } as Piece);
    } else this.m.add(p);
  }
  wall(pts: readonly P2[], y: number, h: number, thick: number, look: WallLook, o: { closed?: boolean; crenel?: number; gaps?: [number, number, number][] } = {}) {
    this.m.wallLine(this.poly(pts), y, h, thick, look, { ...o, gaps: o.gaps?.map(([a, b, w]) => [...this.P(a, b), w]) });
  }
  banners(pts: readonly P2[], y: number, every: number, colours: Colour[], o: { flag?: 'flag' | 'nobori'; h?: number; skip?: [number, number, number][] } = {}) {
    this.m.bannersOn(this.poly(pts), y, every, colours, { ...o, skip: o.skip?.map(([a, b, r]) => [...this.P(a, b), r]) });
  }
  banner(a: number, b: number, y: number, h: number, colour: Colour, w = 1.2, fh = 2.4, flag: 'flag' | 'nobori' = 'flag') {
    const [x, z] = this.P(a, b);
    this.m.banner(x, z, y, h, colour, w, fh, 0, flag);
  }
  smoke(a: number, b: number, y: number) {
    const [x, z] = this.P(a, b);
    this.m.smoke.push([x, y, z]);
  }
  /** A landing pier from the pad's edge at b out over the water, when there is water there. */
  pier(a: number, b: number, length: number) {
    const [x, z] = this.P(a, b + length / 2);
    if (!this.m.water(x, z)) return;
    this.m.add({ kind: 'box', x, z, rot: this.rot, y: 0, w: 2.8, d: length, h: 0.85, look: 'pier' });
  }
}

function joseon(f: Frame, level: number) {
  const L3 = level >= 3;
  const hx = L3 ? 32 : 24, hz = L3 ? 26 : 19, ch = L3 ? 6 : 5;
  const pad = rect(-hx, hx, -hz, hz, ch);
  const y = f.level(pad);
  f.m.pad(f.poly(pad), y, 'earth', 'granite');
  const wx = hx - 2.5, wz = hz - 2.5, wh = L3 ? 3.4 : 2.6, wt = L3 ? 2.4 : 1.8;
  const wall = rect(-wx, wx, -wz, wz, ch - 1);
  f.wall(wall, y, wh, wt, 'jo_granite', { crenel: 1.6, gaps: [[0, wz, 5.5], ...(L3 ? [[-wx, 0, 4.5] as [number, number, number]] : [])] });
  f.piece({ kind: 'pass', x: 0, z: wz, rot: 0, y, w: 5.9, thick: L3 ? 3.6 : 3, h: wh, look: 'jo_granite' });
  f.piece({ kind: 'pavilion', x: 0, z: wz, rot: 0, y: y + wh, w: L3 ? 9 : 7, d: L3 ? 5.2 : 4.4, storeys: L3 ? 2 : 1, look: 'jo' });
  if (L3) {
    f.piece({ kind: 'pass', x: -wx, z: 0, rot: PI / 2, y, w: 4.9, thick: 3, h: wh, look: 'jo_granite' });
    f.piece({ kind: 'pavilion', x: -wx, z: 0, rot: PI / 2, y: y + wh, w: 6, d: 4, storeys: 1, look: 'jo' });
  }
  const corners: [number, number][] = L3 ? [[-wx + 1, -wz + 1], [wx - 1, -wz + 1], [wx - 1, wz - 1], [-wx + 1, wz - 1]] : [[wx - 1, wz - 1], [-wx + 1, wz - 1]];
  for (const [a, b] of corners) {
    f.piece({ kind: 'box', x: a, z: b, rot: PI / 4, y, w: 5.5, d: 5.5, h: wh + 0.2, look: 'bastion' });
    f.piece({ kind: 'turret', x: a, z: b, rot: 0, y: y + wh + 0.2, s: 3.8, look: 'jo' });
  }
  // The hall on the axis at the back, the drill yard before it, barrack rows either side.
  const hb = L3 ? -15 : -10;
  if (L3) {
    f.wall([[-11, -wz + 1.5], [-11, hb + 6]], y, 1.6, 0.6, 'jo_court', { closed: false });
    f.wall([[11, hb + 6], [11, -wz + 1.5]], y, 1.6, 0.6, 'jo_court', { closed: false });
    f.wall([[-11, hb + 6], [11, hb + 6]], y, 1.6, 0.6, 'jo_court', { closed: false, gaps: [[0, hb + 6, 4.5]] });
  }
  f.bldg(0, hb, 0, y, L3 ? 13 : 10.5, L3 ? 7 : 6, 'jo_lime', { wallH: 3, rise: 3, overhang: 1.1, base: 0.9 });
  f.m.flat(f.poly(rect(-8, 8, hb + 7, wz - 6)), y, 'yard');
  f.m.strip([f.P(0, wz + 2), f.P(0, hb + 4)], 4.5, 'lane', y);
  const xs = L3 ? [-24, -18, 18, 24] : [-16, -10.5, 10.5, 16];
  const zs = L3 ? [-2, 11] : [4];
  for (const a of xs) for (const b of zs) f.bldg(a, b, PI / 2, y, L3 ? 10 : 9, 3.9, 'jo_lime');
  if (L3) for (const b of [-16, -8]) f.bldg(-22, b, 0, y, 7, 4.6, 'jo_store', { wallH: 2.6 });
  f.piece({ kind: 'soldiers', x: -6, z: hb + 10, y, rows: 2, cols: 8, dx: 1.6, dz: 1.6, navy: 'joseon' });
  f.banner(4, hb + 9, y, 11, 'yellow', 2, 3);
  f.banners(rect(-wx + 0.4, wx - 0.4, -wz + 0.4, wz - 0.4, ch - 1), y + wh, L3 ? 7.5 : 9, OBANG, { h: 6, skip: [[0, wz, 5]] });
  f.smoke(xs[0]!, zs[0]!, y + 4.4);
  f.smoke(0, hb, y + 7);
  f.pier(6, hz, L3 ? 12 : 9);
  f.m.clear.push([f.cx, f.cz, Math.hypot(hx, hz) + 6]);
}

function japan(f: Frame, level: number) {
  const L3 = level >= 3;
  const hx = L3 ? 30 : 22, hz = L3 ? 24 : 17;
  const pad = rect(-hx, hx, -hz, hz);
  const y = f.level(pad);
  f.m.pad(f.poly(pad), y, 'earth', 'ishigaki');
  const wall = rect(-hx + 0.6, hx - 0.6, -hz + 0.6, hz - 0.6);
  f.wall(wall, y, 1.7, 0.7, 'wa_dobei', { gaps: [[0, hz - 0.6, 5]] });
  f.piece({ kind: 'yagura', x: 0, z: hz - 0.6, rot: 0, y, w: 7.5, d: 4.4, storeys: 1 });
  for (const [a, b] of [[-hx + 3, -hz + 3], [hx - 3, -hz + 3], ...(L3 ? [[-hx + 3, hz - 3], [hx - 3, hz - 3]] : [])] as [number, number][]) f.piece({ kind: 'yagura', x: a, z: b, rot: 0, y, w: 4.6, d: 4.6, storeys: 2 });
  if (L3) {
    // The inner bailey stepped up behind its own stone face at the back, the keep on it.
    const inner = rect(-13, 13, -hz + 3, -4);
    const yi = y + 3.5;
    f.m.pad(f.poly(inner), yi, 'yard', 'ishigaki', y);
    f.wall(inner, yi, 1.6, 0.7, 'wa_dobei', { gaps: [[0, -4, 4]] });
    f.piece({ kind: 'box', x: 0, z: -2.6, rot: 0, y, w: 3.2, d: 2.8, h: 3.5, look: 'step' });
    f.piece({ kind: 'yagura', x: 0, z: -4, rot: 0, y: yi, w: 5.5, d: 3.6, storeys: 1 });
    f.piece({ kind: 'tenshu', x: -3, z: -hz + 11.5, y: yi });
    f.bldg(8, -hz + 9, 0, yi, 7, 5, 'wa_lime', { wallH: 2.4, rise: 1.8, overhang: 0.6 });
    for (const a of [-22, -16, 16, 22]) for (const b of [-6, 8]) f.bldg(a, b, PI / 2, y, 11, 4.2, 'wa_lime', { rise: 1.7, overhang: 0.5, style: 'gable', base: 0.3 });
    f.smoke(-16, 8, y + 4);
  } else {
    for (const a of [-15, -9, 9, 15]) f.bldg(a, 4, PI / 2, y, 10, 4.2, 'wa_lime', { rise: 1.7, overhang: 0.5, style: 'gable', base: 0.3 });
    f.bldg(0, -9, 0, y, 11, 6, 'wa_lime', { wallH: 2.4, rise: 1.9, overhang: 0.6 });
    f.bldg(-14, -10, PI / 2, y, 6.5, 4.4, 'wa_lime', { wallH: 3.2, rise: 1.6, overhang: 0.4, style: 'gable' });
    f.smoke(-9, 4, y + 4);
  }
  f.m.flat(f.poly(rect(-6, 6, L3 ? 0 : -4, hz - 4)), y, 'yard');
  f.banners(wall, y, 6.5, NOBORI, { flag: 'nobori', h: 6, skip: [[0, hz - 0.6, 5]] });
  f.pier(6, hz, L3 ? 12 : 9);
  f.m.clear.push([f.cx, f.cz, Math.hypot(hx, hz) + 6]);
}

function ming(f: Frame, level: number) {
  const L3 = level >= 3, L1 = level <= 1;
  const hx = L3 ? 32 : L1 ? 17 : 24, hz = L3 ? 22 : L1 ? 13 : 18;
  const pad = rect(-hx, hx, -hz, hz, L1 ? 3 : 0);
  const y = f.level(pad);
  f.m.pad(f.poly(pad), y, 'earth', L1 ? 'earth' : 'brick');
  const wx = hx - 2.5, wz = hz - 2.5;
  if (L1) {
    const line = rect(-wx, wx, -wz, wz, 3);
    f.wall(line, y, 2.6, 0.5, 'jo_stockade', { gaps: [[0, wz, 3.5]] });
    f.piece({ kind: 'pavilion', x: 0, z: wz, rot: 0, y: y + 2.6, w: 4.6, d: 2.8, storeys: 1, look: 'mg' });
    for (const a of [-8, 0, 8]) f.bldg(a, -4, 0, y, 5, 3.8, 'wa_tent', { wallH: 1.5, rise: 1.4, overhang: 0.2, style: 'hip', base: 0 });
    f.banners(line, y + 0.2, 7, MING, { h: 6, skip: [[0, wz, 4]] });
    f.smoke(-4, 4, y + 1);
    f.m.clear.push([f.cx, f.cz, 22]);
    return;
  }
  const wh = L3 ? 3.8 : 3, wt = L3 ? 3 : 2.4;
  const wall = rect(-wx, wx, -wz, wz);
  f.wall(wall, y, wh, wt, 'mg_brick', { crenel: 1.5, gaps: [[0, wz, 6]] });
  f.piece({ kind: 'pass', x: 0, z: wz, rot: 0, y, w: 6.4, thick: wt + 0.8, h: wh, look: 'mg_brick' });
  f.piece({ kind: 'pavilion', x: 0, z: wz, rot: 0, y: y + wh, w: L3 ? 11 : 9, d: L3 ? 6.5 : 5.5, storeys: L3 ? 2 : 1, look: 'mg' });
  for (const [a, b] of (L3 ? [[-wx, -wz], [wx, -wz], [wx, wz], [-wx, wz]] : [[wx, wz], [-wx, wz]]) as [number, number][]) {
    f.piece({ kind: 'box', x: a, z: b, rot: 0, y, w: 6.5, d: 6.5, h: wh + 0.4, look: 'mg_bastion' });
    f.piece({ kind: 'pavilion', x: a, z: b, rot: 0, y: y + wh + 0.4, w: 4.4, d: 4.4, storeys: 1, look: 'mg_plain' });
  }
  if (L3) f.piece({ kind: 'yamen', x: 0, z: -wz + 7, y });
  else f.bldg(0, -wz + 6, 0, y, 12, 6, 'mg_red', { wallH: 3, rise: 2.4, overhang: 1.1, base: 0.8 });
  const xs = L3 ? [-24, -18, 18, 24] : [-16, -10.5, 10.5, 16];
  const zs = L3 ? [-4, 9] : [3];
  for (const a of xs) for (const b of zs) f.bldg(a, b, PI / 2, y, 10, 4.2, 'mg_barracks', { wallH: 2.4, rise: 1.8, overhang: 0.5, style: 'gable' });
  f.m.flat(f.poly(rect(-9, 9, -wz + 12, wz - 4)), y, 'yard');
  f.banner(-4, 0, y, 11, 'yellow', 2, 3);
  f.banner(4, 0, y, 11, 'red', 2, 3);
  f.banners(rect(-wx + 0.4, wx - 0.4, -wz + 0.4, wz - 0.4), y + wh, 7, MING, { h: 6, skip: [[0, wz, 6]] });
  f.smoke(xs[0]!, zs[0]!, y + 4.4);
  f.pier(6, hz, L3 ? 12 : 9);
  f.m.clear.push([f.cx, f.cz, Math.hypot(hx, hz) + 6]);
}

/**
 * The camp of `navy` at `level` (1 to 3) centred at (cx, cz) of the plan's frame, its gate and landing turned towards
 * the lowest ground round it: the water, where there is any.
 */
export function tierCamp(m: Plan, navy: FactionId, level: number, cx: number, cz: number) {
  let best = { rot: 0, h: Infinity };
  for (let k = 0; k < 16; k += 1) {
    const rot = (k / 16) * PI * 2;
    let h = 0;
    for (const r of [30, 45, 60]) h += m.natural(cx + Math.sin(rot) * r, cz + Math.cos(rot) * r);
    if (h < best.h) best = { rot, h };
  }
  const was = m.navy;
  m.navy = navy;
  const f = new Frame(m, cx, cz, best.rot);
  if (navy === 'japan') {
    if (level <= 1) waFieldCamp(m, cx, cz, best.rot);
    else japan(f, level);
  } else if (navy === 'ming') ming(f, level);
  else if (level <= 1) joTier1(m, cx, cz, best.rot);
  else joseon(f, level);
  m.navy = was;
}
