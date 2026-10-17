// Deformation metric for a skinned figure: plays a clip on the CPU at 30 fps and scores EVERY frame against the bind
// pose, so the worst frame of a clip is measured instead of a few fixed samples.
//   stretch   per-edge length ratio vs bind, |ln ratio|: max and 99th percentile, over the arm region (shoulder..hand)
//   collapse  fraction of arm triangles whose area fell below 25% of bind (a crumpled forearm / candy-wrapper wrist)
//   pierce    forearm/hand vertices inside the torso hull (torso = Spine/Spine01/Spine02-dominant vertices): the
//             deepest penetration in metres and the vertex count
// score = max(stretchP99 / 0.35, collapse / 0.03, pierceDepth / 0.04): 1.0 is the threshold (calibrated 2026-10-17
// on the live cast: idle 252 / command 29 score well under it, the crumpled 241 frames over it).
import { Matrix4, Quaternion, Vector3 } from 'three';
import { io } from './figure.mjs';

export const LIMIT = { crush: 0.05, collapse: 0.03, pierce: 0.04 };
const ARM = /^(Left|Right)(Arm|ForeArm|Hand)$/;
const FORE = /^(Left|Right)(ForeArm|Hand)$/;
const TORSO = /^(Spine(01|02)?|Hips|LeftShoulder|RightShoulder)$/;

function read(acc) {
  const n = acc.getCount(), k = acc.getElementSize(), out = new Float32Array(n * k), e = [];
  for (let i = 0; i < n; i++) { acc.getElement(i, e); for (let j = 0; j < k; j++) out[i * k + j] = e[j]; }
  return { a: out, k, n };
}

/** Loads the skinned mesh once: bind data, joints, the clips. */
export async function loadFigure(file) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const skinNode = root.listNodes().find((n) => n.getSkin() && n.getMesh());
  const skin = skinNode.getSkin();
  const joints = skin.listJoints();
  const ibm = read(skin.getInverseBindMatrices()).a;
  const nodes = root.listNodes();
  const index = new Map(nodes.map((n, i) => [n, i]));
  const parent = nodes.map(() => -1);
  nodes.forEach((n, i) => n.listChildren().forEach((c) => { parent[index.get(c)] = i; }));
  const rest = nodes.map((n) => ({ t: n.getTranslation(), r: n.getRotation(), s: n.getScale() }));
  const prims = skinNode.getMesh().listPrimitives().map((p) => ({
    pos: read(p.getAttribute('POSITION')).a, j: read(p.getAttribute('JOINTS_0')).a, w: read(p.getAttribute('WEIGHTS_0')).a,
    idx: p.getIndices().getArray(),
  }));
  const jointNames = joints.map((j) => j.getName());
  const clips = Object.fromEntries(root.listAnimations().map((a) => [a.getName(), a.listChannels().map((ch) => {
    const s = ch.getSampler();
    return { node: index.get(ch.getTargetNode()), path: ch.getTargetPath(), t: read(s.getInput()).a, v: read(s.getOutput()), interp: s.getInterpolation() };
  })]));
  return { nodes, parent, rest, joints: joints.map((j) => index.get(j)), jointNames, ibm, prims, clips };
}

const q0 = new Quaternion(), q1 = new Quaternion();
function sample(ch, time, out) {
  const { t, v } = ch, k = v.k, n = t.length;
  const cubic = ch.interp === 'CUBICSPLINE';
  const at = (i) => (cubic ? i * 3 + 1 : i) * k;
  if (time <= t[0] || n === 1) { for (let j = 0; j < k; j++) out[j] = v.a[at(0) + j]; return; }
  if (time >= t[n - 1]) { for (let j = 0; j < k; j++) out[j] = v.a[at(n - 1) + j]; return; }
  let i = 0; while (t[i + 1] < time) i++;
  const f = ch.interp === 'STEP' ? 0 : (time - t[i]) / (t[i + 1] - t[i]);
  if (k === 4) {
    q0.fromArray(v.a, at(i)); q1.fromArray(v.a, at(i + 1)); q0.slerp(q1, f);
    out[0] = q0.x; out[1] = q0.y; out[2] = q0.z; out[3] = q0.w;
  } else for (let j = 0; j < k; j++) out[j] = v.a[at(i) + j] * (1 - f) + v.a[at(i + 1) + j] * f;
}

/** Skinned vertex positions of every primitive at `time` of `clip` (null clip = bind pose). */
export function pose(F, clip, time) {
  const trs = F.rest.map((r) => ({ t: [...r.t], r: [...r.r], s: [...r.s] }));
  if (clip) for (const ch of F.clips[clip]) {
    const o = ch.path === 'translation' ? trs[ch.node].t : ch.path === 'rotation' ? trs[ch.node].r : ch.path === 'scale' ? trs[ch.node].s : null;
    if (o) sample(ch, time, o);
  }
  const world = [];
  const local = new Matrix4(), tv = new Vector3(), sv = new Vector3(), qv = new Quaternion();
  const done = F.nodes.map(() => false);
  const W = (i) => {
    if (done[i]) return world[i];
    // the parent first: W() recursion reuses tv/qv/sv/local, so composing before it read the parent's TRS (fixed 2026-10-17)
    const up = F.parent[i] >= 0 ? W(F.parent[i]) : null;
    local.compose(tv.fromArray(trs[i].t), qv.fromArray(trs[i].r), sv.fromArray(trs[i].s));
    world[i] = up ? new Matrix4().multiplyMatrices(up, local) : local.clone();
    done[i] = true; return world[i];
  };
  const skinM = F.joints.map((n, j) => new Matrix4().multiplyMatrices(W(n), new Matrix4().fromArray(F.ibm, j * 16)));
  const out = F.prims.map((p) => {
    const o = new Float32Array(p.pos.length);
    for (let v = 0; v < p.pos.length / 3; v++) {
      const x = p.pos[v * 3], y = p.pos[v * 3 + 1], z = p.pos[v * 3 + 2];
      let ox = 0, oy = 0, oz = 0;
      for (let q = 0; q < 4; q++) {
        const w = p.w[v * 4 + q]; if (!w) continue;
        const e = skinM[p.j[v * 4 + q]].elements;
        ox += w * (e[0] * x + e[4] * y + e[8] * z + e[12]);
        oy += w * (e[1] * x + e[5] * y + e[9] * z + e[13]);
        oz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
      }
      o[v * 3] = ox; o[v * 3 + 1] = oy; o[v * 3 + 2] = oz;
    }
    return o;
  });
  return { verts: out, world, skinM, jointWorld: F.joints.map((n) => W(n)) };
}

function dominant(p, names) {
  const n = p.pos.length / 3, d = new Array(n);
  for (let v = 0; v < n; v++) { let b = 0; for (let q = 1; q < 4; q++) if (p.w[v * 4 + q] > p.w[v * 4 + b]) b = q; d[v] = names[p.j[v * 4 + b]]; }
  return d;
}

/** Precomputes regions and bind measures; returns a scorer for (clip, time). */
export function prepare(F) {
  const bind = pose(F, null, 0);
  const regions = F.prims.map((p, pi) => {
    const dom = dominant(p, F.jointNames);
    const B = bind.verts[pi];
    const arm = dom.map((n) => ARM.test(n)), fore = dom.map((n) => FORE.test(n)), torso = dom.map((n) => TORSO.test(n));
    const edges = new Map(), tris = [];
    for (let i = 0; i < p.idx.length; i += 3) {
      const a = p.idx[i], b = p.idx[i + 1], c = p.idx[i + 2];
      if (!(fore[a] && fore[b] && fore[c])) continue;
      tris.push(a, b, c);
      for (const [u, v] of [[a, b], [b, c], [c, a]]) { const key = u < v ? u * 1e7 + v : v * 1e7 + u; if (!edges.has(key)) edges.set(key, [Math.min(u, v), Math.max(u, v)]); }
    }
    const E = [...edges.values()].filter(([u, v]) => len(B, u, v) > 1e-4);
    const bindLen = E.map(([u, v]) => len(B, u, v));
    const bindArea = []; for (let i = 0; i < tris.length; i += 3) bindArea.push(area(B, tris[i], tris[i + 1], tris[i + 2]));
    const foreIdx = [], torsoIdx = [];
    fore.forEach((f, v) => f && foreIdx.push(v)); torso.forEach((t, v) => t && torsoIdx.push(v));
    // arm vertices with their dominant joint: the rigid reference for the blend deviation
    const armIdx = [], armDom = [];
    dom.forEach((n, v) => { if (ARM.test(n) || /Shoulder$/.test(n)) { armIdx.push(v); armDom.push(F.jointNames.indexOf(n)); } });
    // limb cross-section: each upper-arm / forearm vertex's distance from its bone segment (shoulder-elbow,
    // elbow-wrist); a crushed or candy-wrapped limb loses radius, a ballooned one gains it
    const SEG = { LeftArm: ['LeftArm', 'LeftForeArm'], LeftForeArm: ['LeftForeArm', 'LeftHand'], RightArm: ['RightArm', 'RightForeArm'], RightForeArm: ['RightForeArm', 'RightHand'] };
    const limb = [];
    dom.forEach((n, v) => { if (SEG[n]) limb.push([v, F.jointNames.indexOf(SEG[n][0]), F.jointNames.indexOf(SEG[n][1])]); });
    const limbR = limb.map(([v, a, b]) => radius(B, v, bind.jointWorld[a], bind.jointWorld[b]));
    return { E, bindLen, tris, bindArea, foreIdx, torsoIdx, armIdx, armDom, limb, limbR };
  });
  const jn = (n) => F.jointNames.indexOf(n);
  // figure height, so depths read in metres of a 1.8 m man whatever the file's units
  let lo = Infinity, hi = -Infinity; for (const V of bind.verts) for (let i = 1; i < V.length; i += 3) { lo = Math.min(lo, V[i]); hi = Math.max(hi, V[i]); }
  const toM = 1.8 / (hi - lo);
  return (clip, time) => {
    const P = pose(F, clip, time);
    const st = [], col = [0, 0];
    let pierce = 0, pierceN = 0; const dev = []; let crushN = 0, limbN = 0;
    regions.forEach((R, pi) => {
      const V = P.verts[pi], X = F.prims[pi].pos;
      // blend deviation: how far each arm vertex sits from where its dominant bone alone would carry it (candy-wrapper
      // wrists, a fist sunk into the bracer, a crumpled forearm all read as large deviation; a rigid limb reads 0)
      R.limb.forEach(([v, a, b], i) => {
        if (R.limbR[i] < 0.012 / toM) return; // vertices on the bone axis say nothing
        limbN++; const k = radius(V, v, P.jointWorld[a], P.jointWorld[b]) / R.limbR[i];
        if (k < 0.55 || k > 1.8) crushN++;
      });
      R.armIdx.forEach((v, i) => {
        const e = P.skinM[R.armDom[i]].elements, x = X[v * 3], y = X[v * 3 + 1], z = X[v * 3 + 2];
        dev.push(toM * Math.hypot(e[0] * x + e[4] * y + e[8] * z + e[12] - V[v * 3], e[1] * x + e[5] * y + e[9] * z + e[13] - V[v * 3 + 1], e[2] * x + e[6] * y + e[10] * z + e[14] - V[v * 3 + 2]));
      });
      R.E.forEach(([u, v], i) => st.push(Math.abs(Math.log(Math.max(len(V, u, v), 1e-6) / R.bindLen[i]))));
      for (let i = 0, t = 0; i < R.tris.length; i += 3, t++) {
        if (R.bindArea[t] < 1e-8) continue;
        col[1]++; if (area(V, R.tris[i], R.tris[i + 1], R.tris[i + 2]) < 0.25 * R.bindArea[t]) col[0]++;
      }
      // torso hull: a star-shaped radial profile around the spine axis, in 6 height slabs x 24 angle bins
      const base = new Vector3().setFromMatrixPosition(P.jointWorld[jn('Hips')]);
      const top = new Vector3().setFromMatrixPosition(P.jointWorld[jn('neck')]);
      const up = top.clone().sub(base); const H = up.length(); up.normalize();
      const side = new Vector3().setFromMatrixColumn(P.jointWorld[jn('Spine')], 0);
      side.addScaledVector(up, -side.dot(up)).normalize();
      const fwd = new Vector3().crossVectors(side, up);
      const SL = 6, AB = 24, prof = new Float32Array(SL * AB);
      const loc = (v) => {
        const x = V[v * 3] - base.x, y = V[v * 3 + 1] - base.y, z = V[v * 3 + 2] - base.z;
        const h = (x * up.x + y * up.y + z * up.z) / H, a = x * side.x + y * side.y + z * side.z, b = x * fwd.x + y * fwd.y + z * fwd.z;
        return [h, Math.hypot(a, b), ((Math.atan2(b, a) / (2 * Math.PI)) + 1) % 1];
      };
      for (const v of R.torsoIdx) {
        const [h, r, ang] = loc(v); if (h < 0 || h >= 1) continue;
        const k = Math.floor(h * SL) * AB + Math.floor(ang * AB) % AB; if (r > prof[k]) prof[k] = r;
      }
      for (const v of R.foreIdx) {
        const [h, r, ang] = loc(v); if (h < 0.05 || h >= 0.95) continue;
        const k = Math.floor(h * SL) * AB + Math.floor(ang * AB) % AB;
        const d = prof[k] * 0.85 - r; // 15% margin: armour flaps lie on the hull
        if (prof[k] > 0 && d > 0) { pierceN++; if (d * toM > pierce) pierce = d * toM; }
      }
    });
    st.sort((a, b) => a - b);
    const p99 = st[Math.floor(st.length * 0.99)] ?? 0, max = st[st.length - 1] ?? 0;
    const collapse = col[1] ? col[0] / col[1] : 0;
    dev.sort((a, b) => a - b);
    const devP99 = dev[Math.floor(dev.length * 0.99)] ?? 0, devMax = dev[dev.length - 1] ?? 0;
    const crush = limbN ? crushN / limbN : 0;
    const score = Math.max(crush / LIMIT.crush, collapse / LIMIT.collapse, pierce / LIMIT.pierce);
    return { time, score, crush, devP99, devMax, stretchP99: p99, stretchMax: max, collapse, pierce, pierceN };
  };
}

/** Every frame of a clip at `fps`; frames sorted worst first. */
export function scoreClip(F, score, clip, fps = 30) {
  const dur = Math.max(...F.clips[clip].map((c) => c.t[c.t.length - 1]));
  const frames = [];
  for (let f = 0; f * (1 / fps) <= dur + 1e-6; f++) frames.push(score(clip, f / fps));
  const worst = [...frames].sort((a, b) => b.score - a.score);
  return { clip, duration: dur, frames: frames.length, worst, score: worst[0].score };
}

function len(V, u, v) { return Math.hypot(V[u * 3] - V[v * 3], V[u * 3 + 1] - V[v * 3 + 1], V[u * 3 + 2] - V[v * 3 + 2]); }
function area(V, a, b, c) {
  const ux = V[b * 3] - V[a * 3], uy = V[b * 3 + 1] - V[a * 3 + 1], uz = V[b * 3 + 2] - V[a * 3 + 2];
  const vx = V[c * 3] - V[a * 3], vy = V[c * 3 + 1] - V[a * 3 + 1], vz = V[c * 3 + 2] - V[a * 3 + 2];
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

/**
 * Stance of a standing clip, every frame: pelvis tilt (deg, the hip-joint line vs horizontal), weight shift (the
 * pelvis centre's sideways offset from the feet midpoint, as a fraction of the foot spacing: 0 even, 0.5 over one
 * foot), knee bend (deg, worst knee) and feet spacing over shoulder width. A planted commander: tilt < 3, shift < 0.15.
 */
export const STANCE_LIMIT = { tilt: 3, shift: 0.15 };
export function stance(F, clip, fps = 30) {
  const at = (P, n) => new Vector3().setFromMatrixPosition(P.jointWorld[F.jointNames.indexOf(n)]);
  const dur = Math.max(...F.clips[clip].map((c) => c.t[c.t.length - 1]));
  let tilt = 0, shift = 0, knee = 0, spacing = 0, n = 0;
  for (let f = 0; f / fps <= dur + 1e-6; f++) {
    const P = pose(F, clip, f / fps);
    const L = at(P, 'LeftUpLeg'), R = at(P, 'RightUpLeg'), lf = at(P, 'LeftFoot'), rf = at(P, 'RightFoot');
    const d = L.clone().sub(R);
    tilt = Math.max(tilt, Math.abs(Math.atan2(d.y, Math.hypot(d.x, d.z))) * 180 / Math.PI);
    const pel = L.clone().add(R).multiplyScalar(0.5), mid = lf.clone().add(rf).multiplyScalar(0.5);
    const feet = rf.clone().sub(lf); feet.y = 0; const w = feet.length(); feet.normalize();
    const off = pel.clone().sub(mid); off.y = 0;
    shift = Math.max(shift, Math.abs(off.dot(feet)) / Math.max(w, 1e-9));
    for (const s of ['Left', 'Right']) {
      const a = at(P, `${s}UpLeg`), b = at(P, `${s}Leg`), c = at(P, `${s}Foot`);
      knee = Math.max(knee, 180 - a.clone().sub(b).angleTo(c.clone().sub(b)) * 180 / Math.PI);
    }
    const sh = at(P, 'LeftArm').distanceTo(at(P, 'RightArm'));
    spacing += w / sh; n++;
  }
  return { clip, tilt, shift, knee, spacing: spacing / n, ok: tilt < STANCE_LIMIT.tilt && shift < STANCE_LIMIT.shift };
}

function radius(V, v, A, Bm) {
  const ax = A.elements[12], ay = A.elements[13], az = A.elements[14];
  const dx = Bm.elements[12] - ax, dy = Bm.elements[13] - ay, dz = Bm.elements[14] - az;
  const px = V[v * 3] - ax, py = V[v * 3 + 1] - ay, pz = V[v * 3 + 2] - az;
  const L2 = dx * dx + dy * dy + dz * dz; const t = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / L2));
  return Math.hypot(px - t * dx, py - t * dy, pz - t * dz);
}

// ---------------------------------------------------------------- rigid pieces (pilot 2026-10-17)
// An armour piece hung rigidly on one bone (helmet on Head, cuirass on a spine bone, lower armour on Hips) against the
// skinned body under it. The piece is voxelised once into a solid (ray parity per grid column) with distances to its
// surface; per frame every body vertex is carried into the piece's frame and looked up:
//   pokeOut  body vertices the piece covered at bind that now stand OUTSIDE it (a thigh through the tassets): metres
//   intrude  body vertices outside the piece at bind that now sink INTO it (an arm into the cuirass): metres inside
// Vertices of the piece's own bone and the chain above it (which carry the piece) are skipped for intrude. Depth = the
// 10th deepest vertex (single strays are noise). pieceScore = depth / LIMIT.pierce, the same 0.3 promotion threshold.

/** Solid occupancy + signed distance to the surface of a closed triangle mesh (positions in piece space). */
export function voxelize(pos, idx, N = 128, enclose = 0) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[i + k]); hi[k] = Math.max(hi[k], pos[i + k]); }
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const pad = span * 0.08; for (let k = 0; k < 3; k++) { lo[k] -= pad; hi[k] += pad; }
  const h = (span + 2 * pad) / N;
  const n = [0, 1, 2].map((k) => Math.max(2, Math.ceil((hi[k] - lo[k]) / h)));
  const solid = new Uint8Array(n[0] * n[1] * n[2]);
  const at = (x, y, z) => (z * n[1] + y) * n[0] + x;
  const cols = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const A = idx[t] * 3, B = idx[t + 1] * 3, C = idx[t + 2] * 3;
    const ay = pos[A + 1], az = pos[A + 2], by = pos[B + 1], bz = pos[B + 2], cy = pos[C + 1], cz = pos[C + 2];
    const y0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - lo[1]) / h - 0.5)), y1 = Math.min(n[1] - 1, Math.floor((Math.max(ay, by, cy) - lo[1]) / h - 0.5));
    const z0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - lo[2]) / h - 0.5)), z1 = Math.min(n[2] - 1, Math.floor((Math.max(az, bz, cz) - lo[2]) / h - 0.5));
    const d = (by - ay) * (cz - az) - (bz - az) * (cy - ay); if (Math.abs(d) < 1e-14) continue;
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const py = lo[1] + (y + 0.5013) * h, pz = lo[2] + (z + 0.4987) * h; // off-centre: never exactly on a shared edge
      const u = ((py - ay) * (cz - az) - (pz - az) * (cy - ay)) / d, v = ((by - ay) * (pz - az) - (bz - az) * (py - ay)) / d;
      if (u < 0 || v < 0 || u + v > 1) continue;
      const x = pos[A] + u * (pos[B] - pos[A]) + v * (pos[C] - pos[A]);
      const key = z * n[1] + y; if (!cols.has(key)) cols.set(key, []); cols.get(key).push(x);
    }
  }
  for (const [key, xs] of cols) {
    xs.sort((a, b) => a - b);
    const y = key % n[1], z = Math.floor(key / n[1]);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = Math.max(0, Math.ceil((xs[i] - lo[0]) / h - 0.5)), x1 = Math.min(n[0] - 1, Math.floor((xs[i + 1] - lo[0]) / h - 0.5));
      for (let x = x0; x <= x1; x++) solid[at(x, y, z)] = 1;
    }
  }
  // Generated pieces are thin shells open at the face, neck, waist or hem, not closed solids: the shell's cells (every
  // vertex, edge midpoint and centroid) count as solid, and so does every empty cell the shell ENCLOSES: blocked by the
  // shell in at least `enclose` of the 26 grid directions (a head inside a helmet, a chest inside a cuirass, hips in a skirt).
  for (let t = 0; t < idx.length; t += 3) {
    const A = idx[t] * 3, B = idx[t + 1] * 3, C = idx[t + 2] * 3;
    for (const [a, b, c] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [1 / 3, 1 / 3, 1 / 3]]) {
      const x = Math.floor((a * pos[A] + b * pos[B] + c * pos[C] - lo[0]) / h), y = Math.floor((a * pos[A + 1] + b * pos[B + 1] + c * pos[C + 1] - lo[1]) / h), z = Math.floor((a * pos[A + 2] + b * pos[B + 2] + c * pos[C + 2] - lo[2]) / h);
      if (x >= 0 && y >= 0 && z >= 0 && x < n[0] && y < n[1] && z < n[2]) solid[at(x, y, z)] = 1;
    }
  }
  const wall = solid.slice();
  if (enclose) {
    const dirs = []; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) if (a || b || c) dirs.push([a, b, c]);
    for (let z = 0; z < n[2]; z++) for (let y = 0; y < n[1]; y++) for (let x = 0; x < n[0]; x++) {
      if (wall[at(x, y, z)]) continue;
      let blocked = 0;
      for (let d = 0; d < 26 && blocked + (26 - d) >= enclose; d++) {
        const [a, b, c] = dirs[d];
        for (let i = x + a, j = y + b, k = z + c; i >= 0 && j >= 0 && k >= 0 && i < n[0] && j < n[1] && k < n[2]; i += a, j += b, k += c) if (wall[at(i, j, k)]) { blocked++; break; }
      }
      if (blocked >= enclose) solid[at(x, y, z)] = 1;
    }
  }
  // squared distance (cells) to the nearest cell of the other kind, separable EDT (Felzenszwalb)
  const edt = (target) => {
    const INF = 1e12, D = new Float64Array(solid.length);
    for (let i = 0; i < solid.length; i++) D[i] = solid[i] === target ? 0 : INF;
    const L = Math.max(...n), f = new Float64Array(L), out = new Float64Array(L), vv = new Int32Array(L), zz = new Float64Array(L + 1);
    const line = (base, stride, len) => {
      for (let i = 0; i < len; i++) f[i] = D[base + i * stride];
      let k = 0; vv[0] = 0; zz[0] = -Infinity; zz[1] = Infinity;
      for (let q = 1; q < len; q++) {
        let s;
        for (;;) { s = ((f[q] + q * q) - (f[vv[k]] + vv[k] * vv[k])) / (2 * q - 2 * vv[k]); if (s <= zz[k] && k > 0) k--; else break; }
        if (s <= zz[k]) { vv[k] = q; zz[k] = -Infinity; zz[k + 1] = Infinity; continue; }
        k++; vv[k] = q; zz[k] = s; zz[k + 1] = Infinity;
      }
      k = 0; for (let q = 0; q < len; q++) { while (zz[k + 1] < q) k++; out[q] = (q - vv[k]) ** 2 + f[vv[k]]; }
      for (let i = 0; i < len; i++) D[base + i * stride] = out[i];
    };
    for (let z = 0; z < n[2]; z++) for (let y = 0; y < n[1]; y++) line(at(0, y, z), 1, n[0]);
    for (let z = 0; z < n[2]; z++) for (let x = 0; x < n[0]; x++) line(at(x, 0, z), n[0], n[1]);
    for (let y = 0; y < n[1]; y++) for (let x = 0; x < n[0]; x++) line(at(x, y, 0), n[0] * n[1], n[2]);
    return D;
  };
  const toSolid = edt(1), toEmpty = edt(0);
  /** signed distance in piece units: > 0 outside, < 0 inside (cell-accurate) */
  const sdf = (x, y, z) => {
    const i = Math.floor((x - lo[0]) / h), j = Math.floor((y - lo[1]) / h), k = Math.floor((z - lo[2]) / h);
    if (i < 0 || j < 0 || k < 0 || i >= n[0] || j >= n[1] || k >= n[2]) {
      const cx = Math.min(Math.max(x, lo[0]), hi[0]), cy = Math.min(Math.max(y, lo[1]), hi[1]), cz = Math.min(Math.max(z, lo[2]), hi[2]);
      return Math.hypot(x - cx, y - cy, z - cz) + pad;
    }
    const c = at(i, j, k);
    return solid[c] ? -Math.sqrt(toEmpty[c]) * h : Math.sqrt(toSolid[c]) * h;
  };
  let filled = 0; for (const s of solid) filled += s;
  /** does the straight path a -> b (piece space) pass through the shell itself (not an opening)? */
  const crossesWall = (ax, ay, az, bx, by, bz) => {
    const L = Math.hypot(bx - ax, by - ay, bz - az), steps = Math.max(1, Math.ceil(L / (h * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, x = Math.floor((ax + (bx - ax) * t - lo[0]) / h), y = Math.floor((ay + (by - ay) * t - lo[1]) / h), z = Math.floor((az + (bz - az) * t - lo[2]) / h);
      if (x >= 0 && y >= 0 && z >= 0 && x < n[0] && y < n[1] && z < n[2] && wall[at(x, y, z)]) return true;
    }
    return false;
  };
  return { lo, hi, h, n, solid, wall, sdf, crossesWall, filled: filled / solid.length };
}

/**
 * Scorer for one rigid piece on the body: piece = { vox (voxelize of the piece in its own space), bone (joint name),
 * place (Matrix4: piece space -> body world at bind) }. Returns (clip, time) -> { pokeOut, intrude, score }.
 */
export function preparePiece(F, piece) {
  const bind = pose(F, null, 0);
  const bj = F.jointNames.indexOf(piece.bone);
  if (bj < 0) throw new Error(`no joint ${piece.bone}`);
  const carried = new Set(); for (let n = F.joints[bj]; n >= 0; n = F.parent[n]) carried.add(F.nodes[n].getName());
  const inv = piece.place.clone().invert();
  let lo = Infinity, hi = -Infinity; for (const V of bind.verts) for (let i = 1; i < V.length; i += 3) { lo = Math.min(lo, V[i]); hi = Math.max(hi, V[i]); }
  const toM = 1.8 / (hi - lo);
  const unit = new Vector3().setFromMatrixColumn(piece.place, 0).length();
  const v = new Vector3();
  const state = F.prims.map((p, pi) => {
    const dom = dominant(p, F.jointNames), B = bind.verts[pi];
    const covered = new Uint8Array(p.pos.length / 3), own = new Uint8Array(p.pos.length / 3), P0 = new Float32Array(p.pos.length);
    for (let i = 0; i < covered.length; i++) {
      v.set(B[i * 3], B[i * 3 + 1], B[i * 3 + 2]).applyMatrix4(inv);
      P0[i * 3] = v.x; P0[i * 3 + 1] = v.y; P0[i * 3 + 2] = v.z;
      covered[i] = piece.vox.sdf(v.x, v.y, v.z) < 0 ? 1 : 0;
      own[i] = carried.has(dom[i]) ? 1 : 0;
    }
    return { covered, own, P0 };
  });
  const bindBoneInv = bind.jointWorld[bj].clone().invert();
  return (clip, time) => {
    const P = pose(F, clip, time);
    const M = new Matrix4().multiplyMatrices(P.jointWorld[bj], bindBoneInv).multiply(piece.place).invert();
    const outs = [], ins = [];
    state.forEach((S, pi) => {
      const V = P.verts[pi];
      for (let i = 0; i < S.covered.length; i++) {
        v.set(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]).applyMatrix4(M);
        const d = piece.vox.sdf(v.x, v.y, v.z) * unit * toM;
        // only a vertex that got there THROUGH the shell counts: leaving by an opening (a leg under the hem, an arm out
        // of the armhole) or entering by one is free movement, not a poke-through
        const through = () => piece.vox.crossesWall(S.P0[i * 3], S.P0[i * 3 + 1], S.P0[i * 3 + 2], v.x, v.y, v.z);
        if (S.covered[i] && d > 0.004 && through()) outs.push(d);
        else if (!S.covered[i] && !S.own[i] && d < -0.004 && through()) ins.push(-d);
      }
    });
    const tenth = (a) => (a.length >= 10 ? a.sort((x, y) => y - x)[9] : 0);
    const pokeOut = tenth(outs), intrude = tenth(ins);
    return { time, pokeOut, pokeN: outs.length, intrude, intrudeN: ins.length, score: Math.max(pokeOut, intrude) / LIMIT.pierce };
  };
}
