import { MeshBuilder, Paint, box, cloth, cylinder, grid, pennant, polygon, rotY, xlate, type V3 } from '../../ships/build/parts';
import type { FactionId } from './types';

// The ships of the campaign map when a battle ship cannot be built, and its fishing boats: one small model per navy from
// the battle ships' parts, colours in the vertices so all of a navy's hulls are one instanced draw. They are map pieces
// rather than scale models: a hull with its deckhouse, masts a little taller than life and sails set, so a squadron reads
// as ships from the strategic view. The navy shows in the sails (Joseon pale blue cloth, Japanese cream with a red band,
// Ming ochre battened junk sails) and in a long pennant of the navy's colour streaming aft from the mainmast. Pure TS,
// tested in node.
//
// A model is built in metres with its bow towards +z and its waterline at y = 0, then scaled so its length is one unit.

/** A kit's triangles: positions in units, normals and linear vertex colours, and the index. */
export interface KitMesh { position: Float32Array; normal: Float32Array; color: Float32Array; index: Uint32Array }

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** A flat vertex colour from an sRGB hex. */
function paint(hex: string): Paint {
  const n = parseInt(hex.slice(1), 16);
  return new Paint(0, 1, 0, [linear(((n >> 16) & 255) / 255), linear(((n >> 8) & 255) / 255), linear((n & 255) / 255)]);
}

/** The navy's colour, the same as the camps' banners and owner rings. */
const BANNER: Record<FactionId, string> = { joseon: '#3f8cff', japan: '#e8452c', ming: '#f0b72a', england: '#5fae78', spain: '#d8574a', holyleague: '#5f7fd0', ottoman: '#c8382f' };

const BOTTOM = 4;

/**
 * A hull of `length` by `beam`, `depth` from keel to gunwale, the keel `draft` under the waterline: a full stern and a
 * pointed bow, the ends rising by `sheer`. Its deck closes the top and the stern and bow have end plates.
 */
function hull(b: MeshBuilder, side: Paint, deck: Paint, o: { length: number; beam: number; depth: number; draft: number; sheer: number }) {
  const n = 7;
  const skin: V3[][] = [], top: V3[][] = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    // Full from the transom to amidships, then fining to the stem.
    const w = (o.beam / 2) * Math.min(1, 0.72 + t * 1.1) * (t > 0.58 ? 0.12 + 0.88 * Math.cos(((t - 0.58) / 0.42) * (Math.PI / 2)) : 1);
    const z = -o.length / 2 + o.length * t;
    const y = o.depth - o.draft + o.sheer * (2 * t - 1) ** 2;
    const keel = -o.draft;
    skin.push([[-w, y, z], [-w * 0.9, keel + (y - keel) * 0.45, z], [0, keel, z], [w * 0.9, keel + (y - keel) * 0.45, z], [w, y, z]]);
    top.push([[-w, y, z], [w, y, z]]);
  }
  grid(b, side, skin, { flip: true });
  grid(b, deck, top);
  polygon(b, side, skin[0]!, [0, 0, -1]);
  polygon(b, side, skin[n - 1]!, [0, 0, 1]);
}

/** A mast from the deck at (0, y0, z), `h` tall. */
function mast(b: MeshBuilder, wood: Paint, z: number, y0: number, h: number, r: number) {
  cylinder(b, wood, [0, y0, z], [0, y0 + h, z], r, r * 0.6, 5, false);
}

/**
 * A sail on the mast at `z`: its top edge at `yTop`, `w` wide and `h` deep, bellied towards the bow and braced round
 * by `yaw` (radians), so it shows as cloth from the side as well as from ahead rather than as a line.
 */
function sail(b: MeshBuilder, p: Paint, z: number, yTop: number, w: number, h: number, yaw: number, battens = 0, batten?: Paint) {
  b.with(xlate(0, 0, z), () => b.with(rotY(yaw), () => {
    // Laid from +x to -x so the cloth's front, the side its belly bulges to, faces the bow.
    cloth(b, p, [w / 2, yTop, 0.2], [-w, 0, 0], [0, -h, 0], { nu: 3, nv: 2, billow: w * 0.08 });
    // A junk's battens across the sail, a little proud of it on both faces.
    for (let k = 1; k <= battens; k += 1) {
      const y = yTop - (h * k) / (battens + 1);
      box(b, batten!, [-w / 2, y - 0.15, 0.05], [w / 2, y + 0.15, 0.75]);
    }
  }));
}

/** The navy's pennant flying aft from the masthead at `z`, `y`. */
function streamer(b: MeshBuilder, p: Paint, z: number, y: number, length: number) {
  pennant(b, p, [0, y, z], [0, 0, -1], [0, -1, 0], length, length * 0.4, length * 0.08, 3);
}

/** A panokseon: a broad hull under a full-length deckhouse with a command pavilion, two masts with pale blue sails. */
function joseon(b: MeshBuilder) {
  const L = 30;
  hull(b, paint('#5c3d29'), paint('#7d5d3f'), { length: L, beam: 9.5, depth: 3.4, draft: 1.2, sheer: 1.0 });
  // The upper deck: plank walls with a dark wale, a pavilion with a dark tiled roof on top.
  box(b, paint('#d6c9a8'), [-4.1, 2.0, -11], [4.1, 4.1, 10], { skip: BOTTOM });
  box(b, paint('#4a3324'), [-4.25, 3.7, -11.1], [4.25, 4.25, 10.1], { skip: BOTTOM });
  box(b, paint('#7a2f24'), [-1.7, 4.25, -7.5], [1.7, 6.0, -3.5], { skip: BOTTOM });
  box(b, paint('#33373d'), [-2.4, 6.0, -8.2], [2.4, 6.6, -2.8], { skip: BOTTOM });
  const wood = paint('#5a4630'), cloth_ = paint('#a9c6ef');
  mast(b, wood, 3, 4.2, 18, 0.32);
  mast(b, wood, -2, 4.2, 15, 0.28);
  sail(b, cloth_, 3, 21.6, 13, 13, 0.5);
  sail(b, cloth_, -2, 18.6, 11, 10.5, 0.5);
  streamer(b, paint(BANNER.joseon), 3, 22.2, 5.5);
}

/** A sekibune: a slim, low hull with a black-lacquered deckhouse hung with a white curtain, one cream sail with a red band. */
function japan(b: MeshBuilder) {
  const L = 28;
  hull(b, paint('#3d3029'), paint('#6b5440'), { length: L, beam: 6.6, depth: 2.9, draft: 1.0, sheer: 0.8 });
  box(b, paint('#2a2522'), [-2.9, 1.8, -9.5], [2.9, 3.6, 8], { skip: BOTTOM });
  box(b, paint('#efe9dc'), [-3.0, 2.4, -9.6], [3.0, 3.1, 8.1], { skip: BOTTOM });
  box(b, paint('#2a2522'), [-1.6, 3.6, -8.8], [1.6, 5.0, -5.4], { skip: BOTTOM });
  mast(b, paint('#4d3b2b'), 0.5, 3.6, 18, 0.3);
  // Cream cloth with a band of the navy's red across the middle.
  const cream = paint('#eee6d2');
  sail(b, cream, 0.5, 20.8, 12, 4.6, 0.5);
  sail(b, paint(BANNER.japan), 0.5, 16.2, 12, 4.6, 0.5);
  sail(b, cream, 0.5, 11.6, 12, 4.6, 0.5);
  streamer(b, paint(BANNER.japan), 0.5, 21.6, 5);
}

/** A Ming junk: a high stern castle with red rails, two masts with ochre sails stiffened by dark battens. */
function ming(b: MeshBuilder) {
  const L = 26;
  hull(b, paint('#4b3a2c'), paint('#7a6046'), { length: L, beam: 8, depth: 3.2, draft: 1.1, sheer: 1.3 });
  box(b, paint('#8f3529'), [-3.4, 2.2, -12.6], [3.4, 5.4, -6], { skip: BOTTOM });
  box(b, paint('#2f2a26'), [-3.7, 5.4, -13], [3.7, 5.9, -5.6], { skip: BOTTOM });
  box(b, paint('#8f3529'), [-3.3, 2.6, -6], [3.3, 3.1, 9], { skip: BOTTOM });
  const wood = paint('#4d3b2b'), ochre = paint('#c8903f'), batten = paint('#3a2c20');
  // A junk's lug sails stand nearly fore and aft.
  for (const [z, h, w] of [[2, 17, 10.5], [8, 12, 7.5]] as const) {
    mast(b, wood, z, 2.6, h + 1.5, 0.3);
    sail(b, ochre, z, 2.6 + h, w, h * 0.72, 1.05, 3, batten);
  }
  streamer(b, paint(BANNER.ming), 2, 20.6, 4.6);
}

/**
 * A race-built English galleon: a long low hull with a short quarterdeck aft and hardly any forecastle, painted in the
 * Tudor green and white chequers along the waist, three masts of square sails and a lateen on the mizzen.
 */
function england(b: MeshBuilder) {
  const L = 34;
  hull(b, paint('#3d2e22'), paint('#7a5f42'), { length: L, beam: 8.4, depth: 3.6, draft: 1.3, sheer: 1.2 });
  box(b, paint('#2f6a46'), [-4.0, 2.0, -12], [4.0, 2.7, 10], { skip: BOTTOM });
  box(b, paint('#e8e2d2'), [-4.05, 2.7, -12], [4.05, 3.1, 10], { skip: BOTTOM });
  box(b, paint('#4a3526'), [-3.6, 2.3, -16], [3.6, 5.0, -9.5], { skip: BOTTOM });
  box(b, paint('#4a3526'), [-2.6, 2.6, 10.5], [2.6, 4.0, 14], { skip: BOTTOM });
  const wood = paint('#4f3b29'), cloth_ = paint('#efe9d8');
  mast(b, wood, 7.5, 2.3, 19, 0.3);
  mast(b, wood, 0, 2.3, 23, 0.34);
  mast(b, wood, -9, 4.8, 14, 0.24);
  sail(b, cloth_, 7.5, 18.5, 11, 7.5, 0.45);
  sail(b, cloth_, 7.5, 10.4, 12, 6.5, 0.45);
  sail(b, cloth_, 0, 22.5, 13, 8.5, 0.45);
  sail(b, cloth_, 0, 13.4, 14, 7.5, 0.45);
  sail(b, cloth_, -9, 17.5, 7, 8, 0.2);
  streamer(b, paint(BANNER.england), 0, 25.2, 6);
}

/**
 * A Spanish galleon of the Armada: a deep hull with towering castles fore and aft painted in red and ochre, four masts,
 * the square sails marked with the red cross of Burgundy.
 */
function spain(b: MeshBuilder) {
  const L = 34;
  hull(b, paint('#4a3423'), paint('#80654a'), { length: L, beam: 9.6, depth: 4.0, draft: 1.5, sheer: 1.6 });
  box(b, paint('#8c3326'), [-4.5, 2.4, -16], [4.5, 7.6, -8.5], { skip: BOTTOM });
  box(b, paint('#c79a3e'), [-4.6, 6.9, -16.1], [4.6, 7.5, -8.4], { skip: BOTTOM });
  box(b, paint('#8c3326'), [-3.8, 2.6, 9], [3.8, 6.2, 14.5], { skip: BOTTOM });
  box(b, paint('#c79a3e'), [-3.9, 5.6, 8.9], [3.9, 6.1, 14.6], { skip: BOTTOM });
  const wood = paint('#4f3b29'), cloth_ = paint('#e9dfc8'), cross = paint('#b8322a');
  mast(b, wood, 8, 6.1, 15, 0.3);
  mast(b, wood, 0.5, 2.6, 22, 0.36);
  mast(b, wood, -7.5, 7.5, 12, 0.24);
  mast(b, wood, -12.5, 7.5, 10, 0.2);
  sail(b, cloth_, 8, 19.5, 11, 8, 0.45);
  sail(b, cloth_, 0.5, 23.2, 13, 9, 0.45);
  sail(b, cross, 0.5, 18.4, 2.2, 2.2, 0.45);
  sail(b, cloth_, 0.5, 14, 14, 7.5, 0.45);
  sail(b, cloth_, -7.5, 18, 6.5, 7, 0.2);
  sail(b, cloth_, -12.5, 16.5, 5, 6, 0.2);
  streamer(b, paint(BANNER.spain), 0.5, 25.6, 6);
}

/**
 * A Mediterranean war galley of 1571: a long, low, narrow hull with the outrigger (apostis) the oars work from and a
 * dark band of oars down each side, the spur at the bow, a raised poop under its awning at the stern, and two masts
 * with lateen yards and triangular sails. The League's and the Sultan's galleys differ in their paint and pennant.
 */
function galley(b: MeshBuilder, side: Paint, deck: Paint, awning: Paint, pennantColour: string) {
  const L = 40;
  hull(b, side, deck, { length: L, beam: 5.2, depth: 2.0, draft: 0.8, sheer: 0.7 });
  const wood = paint('#4a3726'), oars = paint('#3a2c20'), cloth_ = paint('#e8dfc9');
  // The apostis and the oar banks along both sides.
  box(b, wood, [-3.4, 1.1, -14], [3.4, 1.45, 13], { skip: BOTTOM });
  for (const sx of [-1, 1]) box(b, oars, sx < 0 ? [-7.6, 0.25, -12.5] : [3.4, 0.25, -12.5], sx < 0 ? [-3.4, 0.55, 12] : [7.6, 0.55, 12]);
  // The spur, the poop and its awning.
  cylinder(b, wood, [0, 1.4, L / 2 - 0.5], [0, 1.9, L / 2 + 5], 0.35, 0.12, 5, true);
  box(b, wood, [-2.2, 1.4, -L / 2 + 0.6], [2.2, 2.6, -L / 2 + 6.5], { skip: BOTTOM });
  box(b, awning, [-2.4, 3.9, -L / 2 + 0.4], [2.4, 4.3, -L / 2 + 6.8], { skip: BOTTOM });
  // Two masts with lateen yards and their triangular sails, the main forward of amidships.
  const lateen = (z: number, h: number, yard: number) => {
    mast(b, wood, z, 1.2, h, 0.26);
    const top: V3 = [0.3, 1.2 + h + yard * 0.32, z - yard * 0.45], low: V3 = [0.3, 1.2 + h * 0.35, z + yard * 0.55], foot: V3 = [0.3, 2.4, z - yard * 0.25];
    cylinder(b, wood, [top[0], top[1], top[2]], [low[0], low[1], low[2]], 0.16, 0.12, 4, false);
    polygon(b, cloth_, [top, low, foot], [1, 0, 0]);
    polygon(b, cloth_, [top, foot, low], [-1, 0, 0]);
  };
  lateen(5, 19, 24);
  lateen(-6, 12, 16);
  streamer(b, paint(pennantColour), 5, 1.2 + 19 + 24 * 0.32, 6);
}

const holyleague = (b: MeshBuilder) => galley(b, paint('#3b2f28'), paint('#86684a'), paint('#b8322a'), BANNER.holyleague);
const ottoman = (b: MeshBuilder) => galley(b, paint('#4a3423'), paint('#8a6c4c'), paint('#2f6b4a'), BANNER.ottoman);

const BUILD: Record<FactionId, { length: number; build: (b: MeshBuilder) => void }> = {
  joseon: { length: 30, build: joseon },
  japan: { length: 28, build: japan },
  ming: { length: 26, build: ming },
  england: { length: 34, build: england },
  spain: { length: 34, build: spain },
  holyleague: { length: 45, build: holyleague },
  ottoman: { length: 45, build: ottoman },
};

/**
 * A fishing boat, the map's decoration: a small open hull with one patched sail, no deckhouse, no pennant, in plain
 * timber and cloth so it never reads as a navy's ship. Scaled like the ships: one unit long, bow towards +z, waterline y = 0.
 */
export function buildBoatKit(): KitMesh {
  const b = new MeshBuilder();
  hull(b, paint('#6b5038'), paint('#8a6e4e'), { length: 8, beam: 2.8, depth: 1.1, draft: 0.4, sheer: 0.35 });
  mast(b, paint('#4d3b2b'), 0.8, 0.5, 4.6, 0.12);
  sail(b, paint('#d9cfb8'), 0.8, 4.9, 3, 3.4, 0.6);
  const data = b.data();
  const position = data.position;
  for (let i = 0; i < position.length; i += 1) position[i] = position[i]! / 8;
  return { position, normal: data.normal, color: data.color, index: data.index };
}

/** A navy's map ship, scaled so its length is one unit, its bow towards +z and its waterline at y = 0. */
export function buildShipKit(faction: FactionId): KitMesh {
  const { length, build } = BUILD[faction];
  const b = new MeshBuilder();
  build(b);
  const data = b.data();
  const position = data.position;
  for (let i = 0; i < position.length; i += 1) position[i] = position[i]! / length;
  return { position, normal: data.normal, color: data.color, index: data.index };
}
