import {
  BufferAttribute,
  DataTexture,
  DynamicDrawUsage,
  HalfFloatType,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshStandardNodeMaterial,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
  TextureLoader,
  type Texture,
} from 'three/webgpu';
import { abs, attribute, cross, float, floor, Fn, If, int, ivec2, max, min, mix, mod, select, texture, transformNormalToView, uniform, varyingProperty, vec3, vec4 } from 'three/tsl';

export type CrewKey = 'joseon_soldier' | 'joseon_marine' | 'joseon_officer' | 'japan_ashigaru' | 'japan_samurai' | 'japan_officer' | 'ming_soldier' | 'ming_officer' | 'rower';
export const CREW_KEYS: CrewKey[] = ['joseon_soldier', 'joseon_marine', 'joseon_officer', 'japan_ashigaru', 'japan_samurai', 'japan_officer', 'ming_soldier', 'ming_officer', 'rower'];

export type Clip = { start: number; frames: number; loop: boolean };
export type ClipName = 'idle' | 'ready' | 'shoot' | 'reload' | 'melee' | 'thrust' | 'hit' | 'die' | 'run' | 'cheer' | 'command' | 'row' | 'haul' | 'carry';

type Header = { version: number; fps: number; joints: number; frames: number; clips: Record<string, Clip>; height: number; lods: { verts: number; tris: number }[] };

/** One character, ready to draw: geometry per level of detail and the clip table its bone texture follows. */
export type CrewAsset = { key: CrewKey; fps: number; clips: Partial<Record<ClipName, Clip>>; lods: CrewLod[] };

/** One level of detail: an instanced mesh with its own per-instance buffers. */
export type CrewLod = {
  mesh: Mesh<InstancedBufferGeometry, MeshStandardNodeMaterial>;
  /** Per figure: position and scale, rotation quaternion, clip start, frames, start time and rate, then weapon and shade. */
  buffer: InstancedInterleavedBuffer;
  capacity: number;
  count: number;
};

/** Seconds of battle time that drive every crew animation, so a paused battle freezes its crews. */
export const crewTime = uniform(0);

const textures = new TextureLoader();

function parse(buf: ArrayBuffer) {
  const head = new DataView(buf, 0, 12);
  const magic = String.fromCharCode(head.getUint8(0), head.getUint8(1), head.getUint8(2), head.getUint8(3));
  if (magic !== 'CREW') throw new Error('not a crew file');
  const jsonLen = head.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jsonLen))) as Header;
  let off = 12 + jsonLen;
  const take = <T extends ArrayBufferView>(ctor: new (b: ArrayBuffer, o: number, n: number) => T, count: number, bytes: number) => {
    const out = new ctor(buf, off, count);
    off += count * bytes;
    off = (off + 3) & ~3;
    return out;
  };
  const lods = header.lods.map((l) => ({
    pos: take(Float32Array, l.verts * 3, 4),
    nor: take(Int8Array, l.verts * 4, 1),
    uv: take(Float32Array, l.verts * 2, 4),
    jw: take(Uint8Array, l.verts * 8, 1),
    tint: take(Uint8Array, l.verts * 4, 1),
    index: take(Uint16Array, l.tris * 3 + ((l.tris * 3) % 2), 2),
    tris: l.tris,
  }));
  const anim = new Uint16Array(buf, off, header.frames * header.joints * 12);
  return { header, lods, anim };
}

function makeMaterial(map: Texture, anim: DataTexture, influences: number) {
  const m = new MeshStandardNodeMaterial({ roughness: 0.82, metalness: 0.05 });
  const bones = texture(anim);
  const iPos = attribute('iPos', 'vec4');
  const iQuat = attribute('iQuat', 'vec4');
  const iAnim = attribute('iAnim', 'vec4');
  const iMisc = attribute('iMisc', 'vec4');
  const skinIndex = attribute('skinIndexF', 'vec4');
  const skinWeight = attribute('skinWeight', 'vec4');
  const nor4 = attribute('nor4', 'vec4');
  const tint = attribute('tint', 'vec4');
  const fps = float(15);
  const skinned = varyingProperty('vec3', 'crewNormal');
  m.positionNode = Fn(() => {
    // Frame: looping clips wrap, a negative rate holds the last frame (the dead stay down).
    const local = floor(max(crewTime.sub(iAnim.z), 0).mul(fps).mul(abs(iAnim.w)));
    const f = select(iAnim.w.greaterThanEqual(0), mod(local, iAnim.y), min(local, iAnim.y.sub(1)));
    const frame = int(iAnim.x.add(f));
    const p = vec4(attribute('position', 'vec3'), 1);
    const n = vec4(nor4.xyz, 0);
    const pos = vec3(0).toVar();
    const nrm = vec3(0).toVar();
    const comps = ['x', 'y', 'z', 'w'] as const;
    // The far levels read two bones per vertex; their weights are renormalised so the figure keeps its size.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let total: any = float(0);
    for (let k = 0; k < influences; k += 1) {
      const c = comps[k]!;
      const j = int(skinIndex[c].add(0.5)).mul(3);
      const r0 = bones.load(ivec2(j, frame));
      const r1 = bones.load(ivec2(j.add(1), frame));
      const r2 = bones.load(ivec2(j.add(2), frame));
      const w = skinWeight[c];
      total = total.add(w);
      pos.addAssign(vec3(r0.dot(p), r1.dot(p), r2.dot(p)).mul(w));
      nrm.addAssign(vec3(r0.dot(n), r1.dot(n), r2.dot(n)).mul(w));
    }
    pos.divAssign(max(total, 0.001));
    // A weapon this figure is not carrying folds away to a point.
    const weapon = floor(nor4.w.mul(127).add(0.5));
    If(weapon.greaterThan(0.5).and(abs(weapon.sub(iMisc.x)).greaterThan(0.5)), () => {
      pos.assign(vec3(0, -500, 0));
    });
    // Rotate by the instance quaternion, scale, move.
    const q = iQuat;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rot = (v: any) => v.add(cross(q.xyz, cross(q.xyz, v).add(v.mul(q.w))).mul(2));
    // The skinned normal goes to the fragment stage as a varying: the geometry has no 'normal' attribute (nor4 holds it).
    skinned.assign(rot(nrm).normalize());
    return rot(pos.mul(iPos.w)).add(iPos.xyz);
  })();
  m.normalNode = transformNormalToView(skinned);
  // The painted robes are saturated; muting them (and sinking pink-reds toward oxblood) keeps a crew from reading as red
  // specks on a weathered deck.
  const raw = texture(map).rgb;
  const grey = raw.dot(vec3(0.299, 0.587, 0.114));
  const redness = max(raw.r.sub(max(raw.g, raw.b)).mul(3), 0).min(1);
  const base = mix(vec3(grey), raw, 0.5).mul(float(1).sub(redness.mul(0.3)));
  // Fallen and drowning figures darken with iMisc.z; iMisc.y tints the cloth a little toward the side's colour.
  m.colorNode = mix(base, tint.rgb, tint.a).mul(float(1).sub(iMisc.z.mul(0.5)));
  return m;
}

/** Loads the characters, building one instanced mesh per level of detail with room for capacity figures each. */
export async function loadCrew(capacities: Record<CrewKey, number[]>): Promise<Map<CrewKey, CrewAsset>> {
  const out = new Map<CrewKey, CrewAsset>();
  await Promise.all(
    CREW_KEYS.map(async (key) => {
      try {
        const [buf, map] = await Promise.all([fetch(`/models/crew/${key}.bin`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))))), textures.loadAsync(`/models/crew/${key}.webp`)]);
        map.colorSpace = SRGBColorSpace;
        map.flipY = false;
        const { header, lods, anim } = parse(buf);
        const animTex = new DataTexture(anim, header.joints * 3, header.frames, RGBAFormat, HalfFloatType);
        animTex.magFilter = NearestFilter;
        animTex.minFilter = NearestFilter;
        animTex.generateMipmaps = false;
        animTex.needsUpdate = true;
        const caps = capacities[key] ?? [64, 256, 512];
        const built: CrewLod[] = lods.map((l, level) => {
          // Two vertex buffers in all: WebGPU allows eight, and the figures need eleven attributes.
          const n = l.pos.length / 3;
          const v = new Float32Array(n * 21);
          for (let i = 0; i < n; i += 1) {
            const o = i * 21;
            v[o] = l.pos[i * 3]!;
            v[o + 1] = l.pos[i * 3 + 1]!;
            v[o + 2] = l.pos[i * 3 + 2]!;
            v[o + 3] = l.uv[i * 2]!;
            v[o + 4] = l.uv[i * 2 + 1]!;
            for (let k = 0; k < 4; k += 1) {
              v[o + 5 + k] = l.nor[i * 4 + k]! / 127;
              v[o + 9 + k] = l.tint[i * 4 + k]! / 255;
              v[o + 13 + k] = l.jw[i * 8 + 4 + k]! / 255;
              v[o + 17 + k] = l.jw[i * 8 + k]!;
            }
          }
          const vb = new InterleavedBuffer(v, 21);
          const geo = new InstancedBufferGeometry();
          geo.setAttribute('position', new InterleavedBufferAttribute(vb, 3, 0));
          geo.setAttribute('uv', new InterleavedBufferAttribute(vb, 2, 3));
          geo.setAttribute('nor4', new InterleavedBufferAttribute(vb, 4, 5));
          geo.setAttribute('tint', new InterleavedBufferAttribute(vb, 4, 9));
          geo.setAttribute('skinWeight', new InterleavedBufferAttribute(vb, 4, 13));
          geo.setAttribute('skinIndexF', new InterleavedBufferAttribute(vb, 4, 17));
          geo.setIndex(new BufferAttribute(l.index.subarray(0, l.tris * 3), 1));
          const capacity = caps[level] ?? 64;
          const ib = new InstancedInterleavedBuffer(new Float32Array(capacity * 16), 16);
          ib.setUsage(DynamicDrawUsage);
          geo.setAttribute('iPos', new InterleavedBufferAttribute(ib, 4, 0));
          geo.setAttribute('iQuat', new InterleavedBufferAttribute(ib, 4, 4));
          geo.setAttribute('iAnim', new InterleavedBufferAttribute(ib, 4, 8));
          geo.setAttribute('iMisc', new InterleavedBufferAttribute(ib, 4, 12));
          geo.instanceCount = 0;
          const mesh = new Mesh(geo, makeMaterial(map, animTex, level === 0 ? 4 : 2));
          mesh.frustumCulled = false;
          mesh.castShadow = level === 0;
          mesh.receiveShadow = level < 2;
          return { mesh, buffer: ib, capacity, count: 0 };
        });
        out.set(key, { key, fps: header.fps, clips: header.clips as Partial<Record<ClipName, Clip>>, lods: built });
      } catch (err) {
        console.warn('crew model missing', key, err);
      }
    }),
  );
  return out;
}

export function beginCrew(assets: Map<CrewKey, CrewAsset>) {
  for (const a of assets.values()) for (const l of a.lods) l.count = 0;
}

/** Adds one figure. Rotation is a yaw about the vertical plus the ship's tilt, packed as a quaternion. */
export function pushCrew(l: CrewLod, x: number, y: number, z: number, scale: number, qx: number, qy: number, qz: number, qw: number, clip: Clip, t0: number, rate: number, weapon: number, dark: number) {
  if (l.count >= l.capacity) return;
  const o = l.count++ * 16;
  const a = l.buffer.array as Float32Array;
  a[o] = x;
  a[o + 1] = y;
  a[o + 2] = z;
  a[o + 3] = scale;
  a[o + 4] = qx;
  a[o + 5] = qy;
  a[o + 6] = qz;
  a[o + 7] = qw;
  a[o + 8] = clip.start;
  a[o + 9] = clip.frames;
  a[o + 10] = t0;
  a[o + 11] = clip.loop ? rate : -Math.abs(rate);
  a[o + 12] = weapon;
  a[o + 13] = 0;
  a[o + 14] = dark;
  a[o + 15] = 0;
}

export function endCrew(assets: Map<CrewKey, CrewAsset>) {
  for (const a of assets.values()) {
    for (const l of a.lods) {
      l.mesh.geometry.instanceCount = l.count;
      if (!l.count) continue;
      l.buffer.clearUpdateRanges();
      l.buffer.addUpdateRange(0, l.count * 16);
      l.buffer.needsUpdate = true;
    }
  }
}
