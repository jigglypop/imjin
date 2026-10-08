// Bakes the Meshy characters into the crew format the game streams: three simplified levels of detail with skin
// weights, hand weapons skinned to the hand bones, and every animation clip sampled into a table of bone matrices
// (rows of a 3x4 matrix per bone per frame, half floats) that the vertex shader reads as a texture.
//   node scripts/bake-crew.mjs [names]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { cloneDocument, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'assets-src', 'characters');
const OUT = join(ROOT, 'public', 'models', 'crew');
const FPS = 15;
const HEIGHT = 1.72;
const LODS = [
  { ratio: 0.5, error: 0.004 },
  { ratio: 0.17, error: 0.02 },
  { ratio: 0.06, error: 0.06 },
];
// Longest stretch of a clip worth keeping, in seconds. The cheer runs for nine.
const MAX_CLIP = { cheer: 4, idle: 4, haul: 4 };
const ONE_SHOT = new Set(['die', 'hit']);

/** Weapons each character carries, by weapon id. 1 spear, 2 bow, 3 matchlock, 4 sword. */
const ARMS = {
  joseon_soldier: [2, 1],
  joseon_marine: [1],
  joseon_officer: [4],
  japan_ashigaru: [3, 1],
  japan_samurai: [4],
  japan_officer: [4],
  ming_soldier: [2, 1],
  ming_officer: [4],
  rower: [],
};

// ---------------------------------------------------------------- matrices (column-major, as glTF)
const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c += 1)
    for (let r = 0; r < 4; r += 1) {
      let s = 0;
      for (let k = 0; k < 4; k += 1) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}
function compose(t, q, s) {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
function invert(m) {
  const inv = new Array(16);
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  inv[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  inv[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  inv[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  inv[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  inv[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  inv[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  inv[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  inv[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  inv[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  inv[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  inv[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  inv[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  inv[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  inv[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  inv[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  inv[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return inv;
}
const apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const applyDir = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2], m[1] * p[0] + m[5] * p[1] + m[9] * p[2], m[2] * p[0] + m[6] * p[1] + m[10] * p[2]];
const norm = (v) => {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb = d < 0 ? b.map((x) => -x) : b;
  d = Math.abs(d);
  if (d > 0.9995) return norm(a.map((x, i) => x + (bb[i] - x) * t));
  const th = Math.acos(d);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return a.map((x, i) => x * wa + bb[i] * wb);
}

function sample(channel, t) {
  const times = channel.times;
  const vals = channel.values;
  const n = channel.size;
  const get = (i) => Array.from(vals.subarray(i * n, i * n + n));
  if (t <= times[0]) return get(0);
  if (t >= times[times.length - 1]) return get(times.length - 1);
  let i = 1;
  while (times[i] < t) i += 1;
  const k = (t - times[i - 1]) / (times[i] - times[i - 1]);
  const a = get(i - 1);
  const b = get(i);
  if (channel.step) return a;
  return n === 4 ? slerp(a, b, k) : a.map((x, j) => x + (b[j] - x) * k);
}

// ---------------------------------------------------------------- half floats
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toHalf(v) {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 127 + 15;
  let m = x & 0x7fffff;
  if (e <= 0) {
    if (e < -10) return sign;
    m = (m | 0x800000) >> (1 - e);
    return sign | ((m + 0x1000) >> 13);
  }
  if (e >= 31) return sign | 0x7c00;
  const h = sign | (e << 10) | ((m + 0x1000) >> 13);
  return h;
}

// ---------------------------------------------------------------- weapons
/** A box between two points along an axis frame, as triangles. */
function box(out, frame, u0, u1, halfV, halfW, offV = 0, offW = 0, color = [0.3, 0.2, 0.1]) {
  const corners = [];
  for (const u of [u0, u1]) for (const v of [-halfV, halfV]) for (const w of [-halfW, halfW]) corners.push([u, v + offV, w + offW]);
  const faces = [
    [0, 1, 3, 2],
    [4, 6, 7, 5],
    [0, 4, 5, 1],
    [2, 3, 7, 6],
    [0, 2, 6, 4],
    [1, 5, 7, 3],
  ];
  const world = corners.map(([u, v, w]) => frame.at(u, v, w));
  const center = frame.at((u0 + u1) / 2, offV, offW);
  for (const f of faces) {
    const [a, b, c, d] = f.map((i) => world[i]);
    const n = norm(cross(b.map((x, i) => x - a[i]), c.map((x, i) => x - a[i])));
    const mid = a.map((x, i) => (x + c[i]) / 2 - center[i]);
    const flip = n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] < 0;
    const tri = flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
    const nn = flip ? n.map((x) => -x) : n;
    for (const p of tri) out.push({ p, n: nn, color });
  }
}

const WOOD = [0.32, 0.2, 0.11];
const STEEL = [0.55, 0.56, 0.58];
const IRON = [0.12, 0.12, 0.13];
const LACQUER = [0.12, 0.05, 0.04];

function weaponTris(id, frame) {
  const tris = [];
  if (id === 1) {
    box(tris, frame, -0.9, 1.55, 0.018, 0.018, 0, 0, WOOD);
    box(tris, frame, 1.55, 1.82, 0.012, 0.03, 0, 0, STEEL);
  } else if (id === 2) {
    // A short recurve bow, the limbs bending away from the archer.
    const seg = 6;
    for (let i = 0; i < seg; i += 1) {
      const u0 = -0.62 + (1.24 * i) / seg;
      const u1 = -0.62 + (1.24 * (i + 1)) / seg;
      const bend = (u) => 0.13 * (1 - (u / 0.62) ** 2) - 0.05 * Math.max(0, Math.abs(u) - 0.5) * 8;
      box(tris, frame, u0, u1, 0.016, 0.016, 0, (bend(u0) + bend(u1)) / 2, LACQUER);
    }
  } else if (id === 3) {
    box(tris, frame, -0.08, 1.05, 0.018, 0.018, 0.04, 0, IRON);
    box(tris, frame, -0.55, -0.02, 0.045, 0.03, 0.0, 0, WOOD);
  } else if (id === 4) {
    box(tris, frame, -0.2, 0.06, 0.018, 0.018, 0, 0, LACQUER);
    box(tris, frame, 0.06, 0.09, 0.05, 0.05, 0, 0, IRON);
    for (let i = 0; i < 4; i += 1) {
      const u0 = 0.09 + i * 0.2;
      box(tris, frame, u0, u0 + 0.2, 0.016, 0.004, 0.01 + i * i * 0.006, 0, STEEL);
    }
  }
  return tris;
}

// ---------------------------------------------------------------- bake
async function bake(name, state) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(join(SRC, 'models', `${name}_anim.glb`));
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const ibmArr = skin.getInverseBindMatrices().getArray();
  const ibm = joints.map((_, j) => Array.from(ibmArr.subarray(j * 16, j * 16 + 16)));
  const nodes = root.listNodes();
  const parent = new Map();
  for (const n of nodes) for (const c of n.listChildren()) parent.set(c, n);
  const rest = new Map(nodes.map((n) => [n, { t: n.getTranslation(), r: n.getRotation(), s: n.getScale() }]));

  const clipKeys = Object.keys(state.anim.clips);
  const anims = root.listAnimations();
  if (anims.length !== clipKeys.length) console.warn(name, 'clip count', anims.length, 'expected', clipKeys.length);

  // World matrix of every node for a pose (a map of node to local TRS overrides).
  const worldOf = (pose) => {
    const cache = new Map();
    const world = (n) => {
      if (cache.has(n)) return cache.get(n);
      const p = pose.get(n) ?? rest.get(n);
      const local = compose(p.t, p.r, p.s);
      const par = parent.get(n);
      const m = par ? mul(world(par), local) : local;
      cache.set(n, m);
      return m;
    };
    return world;
  };
  const skinAt = (pose) => {
    const world = worldOf(pose);
    return joints.map((j, k) => mul(world(j), ibm[k]));
  };

  // Clips: sampled channels per node.
  const clips = [];
  anims.forEach((anim, i) => {
    const key = clipKeys[i] ?? anim.getName();
    const channels = anim.listChannels().map((ch) => {
      const s = ch.getSampler();
      return { node: ch.getTargetNode(), path: ch.getTargetPath(), times: s.getInput().getArray(), values: s.getOutput().getArray(), size: s.getOutput().getElementSize(), step: s.getInterpolation() === 'STEP' };
    });
    let duration = 0;
    for (const c of channels) duration = Math.max(duration, c.times[c.times.length - 1]);
    duration = Math.min(duration, MAX_CLIP[key] ?? 6);
    const frames = Math.max(2, Math.round(duration * FPS) + (ONE_SHOT.has(key) ? 1 : 0));
    const poses = [];
    for (let f = 0; f < frames; f += 1) {
      const t = ONE_SHOT.has(key) ? (f / (frames - 1)) * duration : (f / frames) * duration;
      const pose = new Map();
      for (const c of channels) {
        const p = pose.get(c.node) ?? { ...rest.get(c.node) };
        const v = sample(c, t);
        if (c.path === 'translation') p.t = v;
        else if (c.path === 'rotation') p.r = v;
        else if (c.path === 'scale') p.s = v;
        pose.set(c.node, p);
      }
      poses.push(skinAt(pose));
    }
    clips.push({ key, frames, loop: !ONE_SHOT.has(key), poses });
  });

  // The rest pose of the mesh, skinned, gives the correction that stands the figure on y = 0 at full height.
  const mesh = root.listMeshes()[0];
  const prim = mesh.listPrimitives()[0];
  const idle = clips.find((c) => c.key === 'idle') ?? clips[0];
  const P = prim.getAttribute('POSITION');
  const J = prim.getAttribute('JOINTS_0');
  const W = prim.getAttribute('WEIGHTS_0');
  const skinPoint = (mats, p, j, w) => {
    const o = [0, 0, 0];
    for (let k = 0; k < 4; k += 1) {
      if (!w[k]) continue;
      const q = apply(mats[j[k]], p);
      o[0] += q[0] * w[k];
      o[1] += q[1] * w[k];
      o[2] += q[2] * w[k];
    }
    return o;
  };
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.getCount(); i += 1) {
    const q = skinPoint(idle.poses[0], P.getElement(i, []), J.getElement(i, []), W.getElement(i, []));
    min = min.map((v, k) => Math.min(v, q[k]));
    max = max.map((v, k) => Math.max(v, q[k]));
  }
  const scale = HEIGHT / (max[1] - min[1]);
  const fix = mul([scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2, 1]);
  for (const c of clips) c.poses = c.poses.map((pose) => pose.map((m) => mul(fix, m)));

  // Weapon frames from the hands' bind matrices: grip axis = the hand axis closest to forward (+Z) in the T pose.
  const bindWorld = joints.map((_, k) => invert(ibm[k]));
  const jointIndex = (n) => joints.findIndex((j) => j.getName() === n);
  const handFrame = (handName, armName) => {
    const hi = jointIndex(handName);
    const ai = jointIndex(armName);
    const m = bindWorld[hi];
    const origin = [m[12], m[13], m[14]];
    const forearm = [bindWorld[ai][12], bindWorld[ai][13], bindWorld[ai][14]];
    const along = norm(origin.map((x, i) => x - forearm[i]));
    const grip = origin.map((x, i) => x + along[i] * 0.085);
    const U = [0, 0, 1];
    const V = norm(cross(along, U)).map((x) => x * (cross(along, U)[1] < 0 ? -1 : 1));
    return { joint: hi, at: (u, v, w) => [grip[0] + U[0] * u + V[0] * v + along[0] * w, grip[1] + U[1] * u + V[1] * v + along[1] * w, grip[2] + U[2] * u + V[2] * v + along[2] * w] };
  };
  const right = handFrame('RightHand', 'RightForeArm');
  const left = handFrame('LeftHand', 'LeftForeArm');

  // Levels of detail. The simplifier may collapse across UV seams (Permissive), or a Meshy atlas would pin most edges.
  await MeshoptSimplifier.ready;
  const welded = cloneDocument(doc);
  await welded.transform(weld());
  const wp = welded.getRoot().listMeshes()[0].listPrimitives()[0];
  const base = {
    pos: wp.getAttribute('POSITION'),
    nor: wp.getAttribute('NORMAL'),
    uv: wp.getAttribute('TEXCOORD_0'),
    jo: wp.getAttribute('JOINTS_0'),
    we: wp.getAttribute('WEIGHTS_0'),
    idx: Uint32Array.from(wp.getIndices().getArray()),
  };
  const count = base.pos.getCount();
  const positions = new Float32Array(count * 3);
  const attrs = new Float32Array(count * 5);
  for (let i = 0; i < count; i += 1) {
    positions.set(base.pos.getElement(i, []), i * 3);
    attrs.set([...base.nor.getElement(i, []), ...base.uv.getElement(i, [])], i * 5);
  }
  const lods = [];
  for (const lod of LODS) {
    const target = Math.floor((base.idx.length / 3) * lod.ratio) * 3;
    const [simplified] = MeshoptSimplifier.simplifyWithAttributes(base.idx, positions, 3, attrs, 5, [0.25, 0.25, 0.25, 1, 1], null, target, lod.error * 4, ['Permissive']);
    const remap = new Map();
    const verts = [];
    const tris = [];
    for (const old of simplified) {
      let k = remap.get(old);
      if (k === undefined) {
        k = verts.length;
        remap.set(old, k);
        const w = base.we.getElement(old, []);
        const sum = w[0] + w[1] + w[2] + w[3] || 1;
        verts.push({ p: base.pos.getElement(old, []), n: base.nor.getElement(old, []), uv: base.uv.getElement(old, []), j: base.jo.getElement(old, []), w: w.map((x) => x / sum), weapon: 0, color: [1, 1, 1], tinted: 0 });
      }
      tris.push(k);
    }
    if (lods.length < 2) {
      for (const id of ARMS[name] ?? []) {
        const frame = id === 2 ? left : right;
        for (const t of weaponTris(id, frame)) {
          tris.push(verts.length);
          verts.push({ p: t.p, n: t.n, uv: [0, 0], j: [frame.joint, 0, 0, 0], w: [1, 0, 0, 0], weapon: id, color: t.color, tinted: 1 });
        }
      }
    }
    lods.push({ verts, tris });
    console.log(name, 'lod', lods.length - 1, 'verts', verts.length, 'tris', tris.length / 3);
  }

  // Output.
  const totalFrames = clips.reduce((a, c) => a + c.frames, 0);
  let start = 0;
  const clipTable = {};
  for (const c of clips) {
    clipTable[c.key] = { start, frames: c.frames, loop: c.loop };
    start += c.frames;
  }
  const header = { version: 1, fps: FPS, joints: joints.length, frames: totalFrames, clips: clipTable, height: HEIGHT, lods: lods.map((l) => ({ verts: l.verts.length, tris: l.tris.length / 3 })) };
  const parts = [];
  for (const l of lods) {
    const n = l.verts.length;
    const pos = new Float32Array(n * 3);
    const nor = new Int8Array(n * 4);
    const uv = new Float32Array(n * 2);
    const jw = new Uint8Array(n * 8);
    const tint = new Uint8Array(n * 4);
    l.verts.forEach((v, i) => {
      pos.set(v.p, i * 3);
      const nn = norm(v.n);
      nor.set([Math.round(nn[0] * 127), Math.round(nn[1] * 127), Math.round(nn[2] * 127), v.weapon], i * 4);
      uv.set(v.uv, i * 2);
      jw.set(v.j.map((x) => Math.min(255, x)), i * 8);
      const q = v.w.map((x) => Math.round(x * 255));
      q[0] += 255 - (q[0] + q[1] + q[2] + q[3]);
      jw.set(q, i * 8 + 4);
      tint.set([...v.color.map((x) => Math.round(x * 255)), v.tinted ? 255 : 0], i * 4);
    });
    const index = new Uint16Array(l.tris.length + (l.tris.length % 2));
    index.set(l.tris);
    parts.push(pos, nor, uv, jw, tint, index);
  }
  const anim = new Uint16Array(totalFrames * joints.length * 12);
  let f0 = 0;
  for (const c of clips) {
    for (let f = 0; f < c.frames; f += 1) {
      c.poses[f].forEach((m, j) => {
        const o = ((f0 + f) * joints.length + j) * 12;
        for (let r = 0; r < 3; r += 1) for (let col = 0; col < 4; col += 1) anim[o + r * 4 + col] = toHalf(m[col * 4 + r]);
      });
    }
    f0 += c.frames;
  }
  parts.push(anim);
  const json = Buffer.from(JSON.stringify(header));
  const pad = (4 - (json.length % 4)) % 4;
  const head = Buffer.alloc(12);
  head.write('CREW', 0, 'ascii');
  head.writeUInt32LE(1, 4);
  head.writeUInt32LE(json.length + pad, 8);
  const body = Buffer.concat([head, json, Buffer.alloc(pad, 0x20), ...parts.map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength))]);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, `${name}.bin`), body);
  const image = prim.getMaterial()?.getBaseColorTexture()?.getImage();
  if (image) await sharp(Buffer.from(image)).resize(512, 512).webp({ quality: 82 }).toFile(join(OUT, `${name}.webp`));
  console.log(name, 'frames', totalFrames, 'bytes', body.length, Object.keys(clipTable).join(','));
}

const state = JSON.parse(await readFile(join(SRC, 'state.json'), 'utf8'));
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(state).filter((n) => state[n].anim?.status === 'done');
for (const name of names) await bake(name, state[name]);
