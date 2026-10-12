import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute, Shape } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PieceKind } from './mapWorld';

// The buildings of the Japanese and Ming camps: low-poly pieces merged into one geometry each, colours in the vertices, so
// a kind is one instanced draw. Joseon camps use the battle terrain's village models instead. Units are settlement radii
// before the piece's size is applied; a piece stands on y = 0, its front looks along +z, and a wall segment is one long on x.

const PLASTER = '#f1ebdc', STONE = '#8d8a83', TILE_DARK = '#2a2c32', NAVY = '#2f3a52', GOLD = '#d9b13a', WOOD = '#7a5a3a', WOOD_DARK = '#4f3c28';
const BRICK = '#ab9a86', BRICK_DARK = '#6f6558', BRICK_LIGHT = '#c0b09a', RED = '#b2392c', TILE_GREEN = '#628a78';

type Part = BufferGeometry;

/** Flat-shaded, uv-free, one colour: every part has the same attributes so they merge. */
function finish(source: BufferGeometry, hex: string): Part {
  const g = source.index ? source.toNonIndexed() : source;
  if (g !== source) source.dispose();
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const c = new Color(hex);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return g;
}

/** A box on the ground plane: width, height, depth, then the middle of its foot. */
function box(w: number, h: number, d: number, x: number, y: number, z: number, hex: string) {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return finish(g, hex);
}

/** A box whose top face is a different size from its foot: a sloped wall, a hipped roof, a tower. */
function tapered(wb: number, db: number, wt: number, dt: number, h: number, x: number, y: number, z: number, hex: string) {
  const g = new BoxGeometry(1, 1, 1).toNonIndexed();
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i += 1) {
    const top = p.getY(i) > 0;
    p.setXYZ(i, p.getX(i) * (top ? wt : wb) + x, (p.getY(i) + 0.5) * h + y, p.getZ(i) * (top ? dt : db) + z);
  }
  return finish(g, hex);
}

/** A gabled roof: `span` across, `length` along the ridge (x when `ridgeX`, otherwise z), `h` high. */
function gable(span: number, length: number, h: number, x: number, y: number, z: number, hex: string, ridgeX = true) {
  const shape = new Shape();
  shape.moveTo(-span / 2, 0);
  shape.lineTo(span / 2, 0);
  shape.lineTo(0, h);
  const g = new ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
  g.translate(0, 0, -length / 2);
  if (ridgeX) g.rotateY(Math.PI / 2);
  g.translate(x, y, z);
  return finish(g, hex);
}

/** A barrel lying along z. */
function barrel(r: number, length: number, x: number, y: number, z: number, hex: string) {
  const g = new CylinderGeometry(r, r, length, 6);
  g.rotateX(Math.PI / 2);
  g.translate(x, y + r, z);
  return finish(g, hex);
}

/** Merlons along a side of a wall top: `count` blocks spread over `width`. */
function crenels(count: number, width: number, w: number, h: number, d: number, x0: number, y: number, z: number, hex: string, alongZ = false): Part[] {
  const out: Part[] = [];
  for (let i = 0; i < count; i += 1) {
    const along = x0 + (i + 0.5) * (width / count) - width / 2;
    out.push(alongZ ? box(d, h, w, z, y, along, hex) : box(w, h, d, along, y, z, hex));
  }
  return out;
}

const merged = (parts: Part[]) => {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return g;
};

/** A tenshu: a stone base and `widths.length` tiers of white wall under dark hipped roofs, gold on the top ridge. */
function keep(widths: number[]) {
  const parts: Part[] = [tapered(1, 1, widths[0]! + 0.04, widths[0]! + 0.04, 0.2, 0, 0, 0, STONE)];
  let y = 0.2;
  widths.forEach((w, i) => {
    const last = i === widths.length - 1;
    const next = last ? w * 0.4 : widths[i + 1]!;
    parts.push(box(w, 0.2, w, 0, y, 0, PLASTER));
    // Dark window slits on the front and a gabled dormer on the lower tiers.
    parts.push(box(w * 0.5, 0.07, 0.02, 0, y + 0.08, w / 2, TILE_DARK));
    y += 0.2;
    const eave = w + 0.26;
    parts.push(tapered(eave, eave, next, next, last ? 0.12 : 0.09, 0, y, 0, TILE_DARK));
    if (i < 2) parts.push(gable(w * 0.5, 0.14, 0.1, 0, y + 0.02, eave / 2 - 0.05, TILE_DARK));
    y += last ? 0.12 : 0.09;
    if (last) {
      parts.push(gable(next * 1.5, next * 1.9, 0.16, 0, y, 0, TILE_DARK));
      parts.push(box(0.05, 0.07, 0.05, -next * 0.9, y + 0.15, 0, GOLD), box(0.05, 0.07, 0.05, next * 0.9, y + 0.15, 0, GOLD));
    }
  });
  return merged(parts);
}

/** A slipway with a shed; the hull on the ways looks along +z towards the water. */
function yard(wall: string, roof: string) {
  const parts: Part[] = [
    box(1, 0.3, 0.4, 0, 0, -0.3, wall),
    gable(0.56, 1.08, 0.2, 0, 0.3, -0.3, roof),
    box(0.46, 0.04, 0.7, 0, 0, 0.25, WOOD),
    box(0.14, 0.12, 0.3, 0.4, 0, 0.1, '#a0804e'),
    box(0.14, 0.1, 0.26, -0.4, 0, 0.12, '#a0804e'),
  ];
  for (let i = 0; i < 4; i += 1) parts.push(box(0.4 - i * 0.04, 0.05, 0.03, 0, 0.04, 0.02 + i * 0.16, WOOD_DARK));
  return merged(parts);
}

const BUILDERS: Partial<Record<PieceKind, () => BufferGeometry>> = {
  pier: () => merged([
    box(0.34, 0.05, 1, 0, 0.1, 0, WOOD),
    ...[-0.45, -0.15, 0.15, 0.45].flatMap((z) => [box(0.06, 0.16, 0.06, -0.15, 0, z, WOOD_DARK), box(0.06, 0.16, 0.06, 0.15, 0, z, WOOD_DARK)]),
  ]),

  // Japan: cloth curtains with crests, low tents and tall vertical banners, then white plaster over stone and dark tiles.
  wa_fence: () => merged([
    box(0.05, 0.46, 0.05, -0.48, 0, 0, WOOD_DARK), box(0.05, 0.46, 0.05, 0.48, 0, 0, WOOD_DARK),
    box(0.92, 0.3, 0.04, 0, 0.08, 0, '#ebe3cd'),
    box(0.92, 0.06, 0.05, 0, 0.32, 0, NAVY), box(0.92, 0.04, 0.05, 0, 0.08, 0, NAVY),
    box(0.15, 0.15, 0.06, 0, 0.155, 0, '#b6322a'),
  ]),
  wa_tent: () => merged([
    gable(0.8, 1, 0.5, 0, 0, 0, '#e8dfc7'),
    box(1.02, 0.05, 0.06, 0, 0.47, 0, NAVY),
    box(0.3, 0.3, 0.02, 0, 0, 0.405, '#3a4458'),
  ]),
  wa_banner: () => merged([
    box(0.05, 2.4, 0.05, 0, 0, 0, '#2b2118'),
    box(0.62, 0.05, 0.05, 0.28, 2.32, 0, '#2b2118'),
    box(0.44, 1.7, 0.02, 0.28, 0.62, 0, '#c2402c'),
    box(0.04, 1.7, 0.025, 0.06, 0.62, 0, '#f1ebdc'), box(0.04, 1.7, 0.025, 0.5, 0.62, 0, '#f1ebdc'),
    box(0.2, 0.2, 0.03, 0.28, 1.5, 0, '#f1ebdc'),
  ]),
  wa_wall: () => merged([
    tapered(1, 0.34, 1, 0.24, 0.2, 0, 0, 0, STONE),
    box(1, 0.2, 0.17, 0, 0.2, 0, PLASTER),
    box(1, 0.05, 0.23, 0, 0.4, 0, TILE_DARK),
  ]),
  wa_gate: () => merged([
    box(1, 0.14, 0.6, 0, 0, 0, STONE),
    box(0.28, 0.12, 0.64, 0, 0.01, 0, '#1d1a18'),
    box(1, 0.26, 0.52, 0, 0.14, 0, PLASTER),
    tapered(1.16, 0.78, 1.0, 0.56, 0.08, 0, 0.4, 0, TILE_DARK),
    gable(0.6, 1.08, 0.22, 0, 0.48, 0, TILE_DARK),
  ]),
  wa_tower: () => merged([
    tapered(0.8, 0.8, 0.64, 0.64, 0.16, 0, 0, 0, STONE),
    box(0.58, 0.34, 0.58, 0, 0.16, 0, PLASTER),
    box(0.16, 0.1, 0.02, 0, 0.3, 0.3, TILE_DARK),
    tapered(0.88, 0.88, 0.14, 0.14, 0.27, 0, 0.5, 0, TILE_DARK),
    box(0.05, 0.06, 0.05, 0, 0.77, 0, GOLD),
  ]),
  wa_keep3: () => keep([0.74, 0.54, 0.36]),
  wa_keep4: () => keep([0.76, 0.6, 0.46, 0.34]),
  wa_yard: () => yard(PLASTER, TILE_DARK),

  // Ming: a stake palisade and a wooden watch tower, then grey brick with merlons and grey-green tiles over red timber.
  mg_palisade: () => merged([
    ...[0, 1, 2, 3, 4, 5].map((i) => tapered(0.14, 0.14, 0.03, 0.03, 0.5, -0.42 + i * 0.168, 0, 0, i % 2 ? '#8c6b45' : '#7a5a3a')),
    box(1, 0.05, 0.07, 0, 0.14, 0, WOOD_DARK),
  ]),
  mg_watch: () => merged([
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.07, 0.8, 0.07, sx * 0.3, 0, sz * 0.3, WOOD))),
    box(0.8, 0.06, 0.8, 0, 0.8, 0, '#8a6a44'),
    box(0.56, 0.26, 0.56, 0, 0.86, 0, '#8a6a44'),
    tapered(0.8, 0.8, 0.04, 0.04, 0.24, 0, 1.12, 0, '#4d3b2d'),
    box(0.03, 0.4, 0.03, 0, 1.36, 0, '#3a2a20'),
    box(0.22, 0.15, 0.02, 0.12, 1.58, 0, '#c8372d'),
  ]),
  mg_flag: () => merged([
    box(0.04, 1.5, 0.04, 0, 0, 0, '#3a2a20'),
    box(0.5, 0.5, 0.015, 0.27, 0.95, 0, '#e0b32c'),
    box(0.38, 0.38, 0.025, 0.27, 1.01, 0, '#c8372d'),
  ]),
  mg_brick: () => merged([
    box(1, 0.36, 0.2, 0, 0, 0, BRICK),
    box(1, 0.1, 0.24, 0, 0, 0, BRICK_DARK),
    ...crenels(4, 1, 0.17, 0.11, 0.2, 0, 0.36, 0, BRICK_LIGHT),
  ]),
  mg_gate: () => merged([
    box(1, 0.4, 0.7, 0, 0, 0, BRICK),
    box(1, 0.1, 0.74, 0, 0, 0, BRICK_DARK),
    box(0.3, 0.3, 0.74, 0, 0, 0, '#1c1815'),
    box(0.76, 0.26, 0.5, 0, 0.4, 0, RED),
    tapered(1.02, 0.78, 0.2, 0.12, 0.2, 0, 0.66, 0, TILE_GREEN),
    box(0.06, 0.1, 0.06, 0, 0.86, 0, GOLD),
  ]),
  mg_corner: () => merged([
    box(0.8, 0.5, 0.8, 0, 0, 0, BRICK),
    box(0.8, 0.1, 0.8, 0, 0, 0, BRICK_DARK),
    ...[-1, 1].flatMap((s) => [
      ...crenels(3, 0.8, 0.15, 0.1, 0.12, 0, 0.5, s * 0.34, BRICK_LIGHT),
      ...crenels(3, 0.8, 0.15, 0.1, 0.12, 0, 0.5, s * 0.34, BRICK_LIGHT, true),
    ]),
    box(0.38, 0.2, 0.38, 0, 0.5, 0, RED),
    tapered(0.56, 0.56, 0.04, 0.04, 0.2, 0, 0.7, 0, TILE_GREEN),
  ]),
  mg_platform: () => merged([
    box(1, 0.18, 0.8, 0, 0, 0, BRICK),
    box(1, 0.06, 0.84, 0, 0, 0, BRICK_DARK),
    ...crenels(5, 1, 0.12, 0.08, 0.06, 0, 0.18, 0.37, BRICK_LIGHT),
    ...[-0.3, 0, 0.3].flatMap((x) => [box(0.14, 0.06, 0.2, x, 0.18, 0.12, WOOD), barrel(0.045, 0.34, x, 0.24, 0.2, '#2e2f33')]),
  ]),
  mg_beacon: () => merged([
    tapered(0.5, 0.5, 0.38, 0.38, 0.9, 0, 0, 0, BRICK),
    box(0.5, 0.08, 0.5, 0, 0, 0, BRICK_DARK),
    box(0.46, 0.06, 0.46, 0, 0.9, 0, '#8f8173'),
    tapered(0.28, 0.28, 0.05, 0.05, 0.34, 0, 0.96, 0, '#ff8a2a'),
    tapered(0.14, 0.14, 0.02, 0.02, 0.2, 0, 0.96, 0, '#ffd04a'),
  ]),
  mg_yard: () => yard(RED, TILE_GREEN),
};

/** The geometry of a procedural piece kind, or null for a kind the battle terrain's models draw. */
export function buildKit(kind: PieceKind): BufferGeometry | null {
  return BUILDERS[kind]?.() ?? null;
}
