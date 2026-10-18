import {
  BufferGeometry,
  Float32BufferAttribute,
  FrontSide,
  Mesh,
  MeshBasicNodeMaterial,
  Uint32BufferAttribute,
  Vector2,
  Vector4,
  type Texture,
} from 'three/webgpu';
import {
  Fn,
  Loop,
  abs,
  atan,
  fract,
  log,
  sign,
  step,
  cameraFar,
  cameraNear,
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  fwidth,
  length,
  log2,
  max,
  min,
  mix,
  modelWorldMatrix,
  normalize,
  perspectiveDepthToViewZ,
  pmremTexture,
  positionGeometry,
  positionView,
  positionWorld,
  pow,
  reflect,
  saturate,
  screenUV,
  select,
  sin,
  cos,
  smoothstep,
  sqrt,
  texture,
  uniform,
  uniformArray,
  varying,
  vec2,
  vec3,
  vec4,
  viewportDepthTexture,
  viewportSharedTexture,
} from 'three/tsl';
import { atmosphere } from '../render/atmosphere';
import { seaFogAmount } from '../render/seaMist';
import { WAVE_COUNT, type WaveField } from './waves';
import { createDetailNormalTexture, createFoamTexture } from './detailNormals';
import type { WakeMap } from './WakeMap';
import type { Terrain } from '../terrain/Terrain';
import { pointLights } from '../render/lights';
import type { SkyView } from '../render/skyDome';
import { CASCADES, type FFTWaves } from './FFTWaves';
import { bakeCurrent } from './currentTexture';
import { SeaFields } from './seaFields';
import { weatherMap } from '../render/cloudNoise';
import { sunThroughClouds } from '../render/cloudShadow';
import type { CurrentField } from '../sim/current';

/** Mesh density and shading cost for the ocean. `lights` is how many point lights the surface shades. */
export type OceanRenderQuality = { segments: number; lights: number };

/** Mean square slope of the ripple texture as the Gerstner surface lays it on, for the far water it fades from. */
const DETAIL_SLOPE_VARIANCE = 0.025;

// The wave detail and foam textures depend only on the wind direction, and take a few hundred milliseconds to fill on
// the main thread. A second battle reuses them.
const detailCache = new Map<number, Texture>();
let foamCache: Texture | null = null;

function detailTexture(windAngle: number) {
  let tex = detailCache.get(windAngle);
  if (!tex) {
    tex = createDetailNormalTexture(windAngle);
    detailCache.set(windAngle, tex);
  }
  return tex;
}

function foamTexture() {
  foamCache ??= createFoamTexture();
  return foamCache;
}

function createOceanGeometry(segments = 400, r0 = 0.4, rMax = 46000, aspect = 1.05) {
  const growth = 1 + ((2 * Math.PI) / segments) * aspect;
  const radii: number[] = [];
  for (let r = r0; r < rMax; r *= growth) radii.push(r);
  radii.push(rMax);
  const positions = new Float32Array((1 + radii.length * segments) * 3);
  let p = 3;
  for (let j = 0; j < radii.length; j += 1) {
    const r = radii[j]!;
    const offset = (j % 2) * 0.5;
    for (let s = 0; s < segments; s += 1) {
      const a = ((s + offset) / segments) * Math.PI * 2;
      positions[p] = Math.cos(a) * r;
      positions[p + 1] = 0;
      positions[p + 2] = Math.sin(a) * r;
      p += 3;
    }
  }
  const indices: number[] = [];
  for (let s = 0; s < segments; s += 1) indices.push(0, 1 + ((s + 1) % segments), 1 + s);
  for (let j = 0; j < radii.length - 1; j += 1) {
    const a0 = 1 + j * segments;
    const b0 = 1 + (j + 1) * segments;
    const shifted = j % 2 === 1;
    for (let s = 0; s < segments; s += 1) {
      const s1 = (s + 1) % segments;
      const a = a0 + s;
      const a1 = a0 + s1;
      const b = b0 + s;
      const b1 = b0 + s1;
      if (shifted) {
        indices.push(a, a1, b1, a, b1, b);
      } else {
        indices.push(a, a1, b, a1, b1, b);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(new Uint32BufferAttribute(new Uint32Array(indices), 1));
  return { geometry, spacing: (2 * Math.PI) / segments };
}

export class Ocean {
  readonly mesh: Mesh;
  /** Made on first use when the tier cannot reach a level with refraction, so it never costs a compile at load. */
  private matRefract: MeshBasicNodeMaterial | null = null;
  private readonly makeRefract: () => MeshBasicNodeMaterial;
  private readonly matPlain: MeshBasicNodeMaterial;
  private envTexture: Texture;
  readonly time = uniform(0);
  readonly detailStrength = uniform(1);
  readonly whitecaps = uniform(0.6);
  readonly heightScale = uniform(0.5);
  readonly debugWake = uniform(0);
  readonly tide = uniform(0);
  /** cos and sin of twice the wind's angle: the mirror across the wind that makes the second copy of a wave tile. */
  readonly mirror = uniform(new Vector2(1, 0));
  private readonly waveA: Vector4[];
  private readonly waveB: Vector4[];
  private readonly pmremNodes: ReturnType<typeof pmremTexture>[] = [];
  /** Each refraction depth lookup clones a framebuffer-sized depth texture that three never frees. */
  private readonly depthNodes: ReturnType<typeof viewportDepthTexture>[] = [];
  /** The battle's current baked for this surface. */
  private readonly currentMap: Texture | null;
  private waveVersion = -1;

  constructor(
    private readonly waves: WaveField,
    envTexture: Texture,
    sky: SkyView,
    private readonly wake: WakeMap,
    terrain: Terrain,
    fft: FFTWaves | null,
    current: CurrentField | null,
    quality: OceanRenderQuality,
  ) {
    this.envTexture = envTexture;
    this.waveA = Array.from({ length: WAVE_COUNT }, () => new Vector4());
    this.waveB = Array.from({ length: WAVE_COUNT }, () => new Vector4());
    this.syncWaves();
    const waveA = uniformArray(this.waveA, 'vec4');
    const waveB = uniformArray(this.waveB, 'vec4');
    const detailTex = detailTexture(waves.state.windAngle);
    const foamTex = foamTexture();
    const uTime = this.time;
    const lightCount = quality.lights;
    const { geometry, spacing } = createOceanGeometry(quality.segments);

    const worldXZ = modelWorldMatrix.mul(vec4(positionGeometry, 1)).xz;
    const vertexDistance = length(worldXZ.sub(cameraPosition.xz));
    const tRot = terrain.rotation;
    const tSize = terrain.sizeU;
    const terrainUV = (xz: any) => vec2(xz.x.mul(tRot.x).add(xz.y.mul(tRot.y)), xz.x.mul(tRot.y).negate().add(xz.y.mul(tRot.x))).div(tSize).add(0.5);
    const seabedV = texture(terrain.heightTexture, terrainUV(worldXZ)).level(float(0)).r;
    const shoreV = smoothstep(0.5, 22.0, seabedV.negate());
    const fields = new SeaFields(weatherMap(), uTime, waves.state.windAngle);
    // How strongly each FFT cascade is drawn here: wave groups swell and ebb the longest, gusts roughen the shorter ones.
    const cascadeWeight = (c: number, gust: any, groups: any) => (c === 0 ? mix(float(0.72), float(1.22), groups) : mix(float(0.5), float(1.4), gust));
    const displacement = Fn(() => {
      const dx = float(0).toVar();
      const dy = float(0).toVar();
      const dz = float(0).toVar();
      Loop(WAVE_COUNT, ({ i }) => {
        const a: any = waveA.element(i);
        const b: any = waveB.element(i);
        const fade = float(1).sub(smoothstep(b.w.mul(20), b.w.mul(36), vertexDistance));
        const theta = a.z.mul(dot(a.xy, worldXZ)).sub(a.w.mul(uTime)).add(b.z);
        const c = cos(theta).mul(fade);
        dx.addAssign(b.y.mul(a.x).mul(c));
        dz.addAssign(b.y.mul(a.y).mul(c));
        dy.addAssign(b.x.mul(sin(theta)).mul(fade));
      });
      if (fft) {
        const vSpacing = vertexDistance.mul(spacing).add(0.03);
        const g = fields.gust(worldXZ, float(0));
        const groups = fields.groups(worldXZ, float(0));
        for (let c = 0; c < 2; c += 1) {
          const L = CASCADES[c]!.size;
          const texel = L / fft.n;
          const lod = max(log2(vSpacing.mul(2.2).div(texel)), 0);
          const d: any = texture(fft.displacement[c]!, worldXZ.div(L)).level(lod);
          const w = cascadeWeight(c, g, groups);
          dx.addAssign(d.x.mul(w));
          dy.addAssign(d.y.mul(w));
          dz.addAssign(d.z.mul(w));
        }
      }
      return vec3(dx, dy, dz).mul(shoreV);
    })();
    const vP0 = varying(worldXZ, 'vOceanP0');

    const material = new MeshBasicNodeMaterial();
    material.side = FrontSide;
    material.transparent = true;
    material.depthWrite = true;
    material.fog = false;
    material.positionNode = positionGeometry.add(displacement);

    const pmremNodes = this.pmremNodes;
    const depthNodes = this.depthNodes;

    const currentMap = current && bakeCurrent(current);
    this.currentMap = currentMap;
    const flowCenter = uniform(new Vector2(current?.centerWorld.x ?? 0, current?.centerWorld.z ?? 0));
    const flowExtent = uniform(current?.extent ?? 1);
    const vortexData = current?.vortexData() ?? [];
    const designedEddies = !!current?.spec.vortices?.length;
    const vortices = uniformArray(Array.from({ length: 8 }, (_, i) => new Vector4(vortexData[i * 4] ?? 0, vortexData[i * 4 + 1] ?? 0, vortexData[i * 4 + 2] ?? 1, vortexData[i * 4 + 3] ?? 0)), 'vec4');
    const tide = this.tide;

    // One colour graph per surface variant. The refracting variant reads the framebuffer, which costs a copy per frame.
    const colorFor = (refraction: boolean) => Fn(() => {
      const p0 = vP0;
      const flow = vec2(0, 0).toVar();
      if (currentMap) {
        const fuv = p0.sub(flowCenter).div(flowExtent).add(0.5);
        const inside = step(0, fuv.x).mul(step(fuv.x, 1)).mul(step(0, fuv.y)).mul(step(fuv.y, 1));
        const f: any = texture(currentMap, fuv);
        flow.assign(select(tide.lessThan(0), f.xy.mul(tide.negate()), f.zw.mul(tide)).mul(inside));
      }
      const FLOW_T = 5;
      const ph0 = fract(uTime.div(FLOW_T));
      const ph1 = fract(uTime.div(FLOW_T).add(0.5));
      const w0 = float(1).sub(abs(ph0.mul(2).sub(1)));
      const off0 = flow.mul(ph0.mul(FLOW_T));
      const off1 = flow.mul(ph1.mul(FLOW_T));
      const sampleFlow = (tex: any, L: number) => (current ? mix(texture(tex, p0.sub(off1).div(L)), texture(tex, p0.sub(off0).div(L)), w0) : texture(tex, p0.div(L)));
      const toCam = cameraPosition.sub(positionWorld);
      const dist = length(toCam);
      const V = toCam.div(dist);
      const fw = fwidth(p0);
      const footprint = max(max(fw.x, fw.y), 0.0001);
      const sxx = float(0).toVar();
      const szz = float(0).toVar();
      const sxz = float(0).toVar();
      const gx = float(0).toVar();
      const gz = float(0).toVar();
      const lostSlope = float(0).toVar();
      const g = fields.gust(p0);
      const groups = fields.groups(p0);
      // In the shading each third of the swell rises and falls in sets of its own (the surface itself stays the
      // battle's, which the hulls ride on), so the long crests break into the irregular sets of a real sea instead of
      // running as corrugations to the horizon.
      const setA = mix(float(0.45), float(1.45), groups);
      const setB = mix(float(0.5), float(1.4), g);
      const setC = mix(float(1.4), float(0.5), groups);
      Loop(WAVE_COUNT, ({ i }) => {
        const a: any = waveA.element(i);
        const b: any = waveB.element(i);
        const fade = float(1).sub(smoothstep(b.w.mul(0.12), b.w.mul(0.42), footprint));
        const third = i.mod(3);
        const sets = select(third.equal(0), setA, select(third.equal(1), setB, setC));
        const theta = a.z.mul(dot(a.xy, p0)).sub(a.w.mul(uTime)).add(b.z);
        const s = sin(theta);
        const c = cos(theta);
        const qk = b.y.mul(a.z).mul(fade).mul(s).mul(sets);
        const ka = a.z.mul(b.x).mul(fade).mul(c).mul(sets);
        sxx.addAssign(qk.mul(a.x).mul(a.x));
        szz.addAssign(qk.mul(a.y).mul(a.y));
        sxz.addAssign(qk.mul(a.x).mul(a.y));
        gx.addAssign(ka.mul(a.x));
        gz.addAssign(ka.mul(a.y));
        const slopeAmp = a.z.mul(b.x);
        lostSlope.addAssign(slopeAmp.mul(slopeAmp).mul(0.5).mul(float(1).sub(fade)));
      });
      const dyx = gx.toVar();
      const dyz = gz.toVar();
      const dxx = sxx.negate().toVar();
      const dzz = szz.negate().toVar();
      const dxz = sxz.negate().toVar();
      const t = uTime;
      // Mean square slope of the waves too small for this pixel. Filtering averages their slopes away; what is lost
      // widens the highlight instead, so far water is glossy and its sun path broad rather than glittering with aliasing.
      const lost = float(0).toVar();
      // Height of the ripple texture's waves (0 to 1), where the Gerstner surface draws them; the wind waves' crests.
      const ripple = float(0.5).toVar();
      // The finest cascade's compression, kept apart: ripples a hand long wrinkle the foam but do not break into it.
      const fineXX = float(0).toVar();
      const fineZZ = float(0).toVar();
      if (fft) {
        const spread = sqrt(max(fw.x.mul(fw.y), 1e-8)).mul(2);
        const variance = [fft.slopeVariance.x, fft.slopeVariance.y, fft.slopeVariance.z];
        for (let c = 0; c < CASCADES.length; c += 1) {
          const cascade = CASCADES[c]!;
          const L = cascade.size;
          let der: any = sampleFlow(fft.derivatives[c]!, L);
          if (c < 2) {
            // Seen from a few tile lengths away the cascade's tile repeats as a grid. There a second copy, mirrored
            // across the wind (so its waves still run downwind) and shifted, takes over in patches several tiles
            // across, so no two neighbouring tiles match. Close in, where the hulls ride on the displaced surface, the
            // shading keeps the one copy the geometry is built from.
            const m: any = this.mirror;
            const q = vec2(m.x.mul(p0.x).add(m.y.mul(p0.y)), m.y.mul(p0.x).sub(m.x.mul(p0.y))).add(c === 0 ? vec2(97.3, 41.9) : vec2(17.1, 29.6));
            const alt: any = texture(fft.derivatives[c]!, q.div(L));
            // The slope turns with the mirror; the compression's cross term is not stored, so its diagonal is mixed only.
            const c2 = m.x.mul(m.x);
            const s2 = m.y.mul(m.y);
            const altD = vec4(m.x.mul(alt.x).add(m.y.mul(alt.y)), m.y.mul(alt.x).sub(m.x.mul(alt.y)), c2.mul(alt.z).add(s2.mul(alt.w)), s2.mul(alt.z).add(c2.mul(alt.w)));
            const pick: any = fields.patch(p0, c === 0 ? 0.83 : -0.47, L * (c === 0 ? 4.1 : 5.3)).mul(smoothstep(L * 1.3, L * 3.2, dist));
            const norm = float(1).div(sqrt(pick.mul(pick).add(float(1).sub(pick).mul(float(1).sub(pick)))));
            der = mix(der, altD, pick).mul(norm);
          }
          const w: any = c === 2 ? cascadeWeight(c, g, groups).mul(this.detailStrength) : cascadeWeight(c, g, groups);
          dyx.addAssign(der.x.mul(w));
          dyz.addAssign(der.y.mul(w));
          dxx.addAssign(der.z.mul(w));
          dzz.addAssign(der.w.mul(w));
          if (c === 2) {
            fineXX.assign(der.z.mul(w));
            fineZZ.assign(der.w.mul(w));
          }
          // The shear of the short cascades is second order in the normal and the whitecaps; leaving their displacement
          // maps out keeps the surface within the sixteen textures a shader stage may sample, with a tidal current and
          // refraction both on.
          if (c === 0) dxz.addAssign(sampleFlow(fft.displacement[c]!, L).w.mul(w));
          // The cascade's waves span an octave range; the ones shorter than the pixel are lost.
          const longest = (2 * Math.PI) / cascade.kLow;
          const share = saturate(log2(spread.div(cascade.minWave)).div(Math.log2(longest / cascade.minWave)));
          lost.addAssign(variance[c]!.mul(w).mul(w).mul(share));
        }
      } else {
        // Two scales of ripple at unrelated angles, a third laid over the first where the wave groups run, so the
        // texture's tile never lines up into a pattern; gusts roughen it.
        const uv1 = p0.mul(1 / 21).add(vec2(t.mul(0.011), t.mul(0.006)));
        const uv1b = vec2(p0.x.mul(0.28).sub(p0.y.mul(0.96)), p0.x.mul(0.96).add(p0.y.mul(0.28))).mul(1 / 33).add(vec2(t.mul(0.004), t.mul(-0.009)));
        const uv2 = vec2(p0.x.mul(0.8).sub(p0.y.mul(0.6)), p0.x.mul(0.6).add(p0.y.mul(0.8))).mul(1 / 6.7).add(vec2(t.mul(-0.019), t.mul(0.014)));
        const blend = smoothstep(0.25, 0.75, groups);
        const keep = float(1).div(sqrt(blend.mul(blend).add(float(1).sub(blend).mul(float(1).sub(blend)))));
        const r1: any = mix(texture(detailTex, uv1), texture(detailTex, uv1b), blend);
        const d1 = r1.xy.mul(2).sub(1).mul(keep);
        const d2 = texture(detailTex, uv2).xy.mul(2).sub(1);
        // The ripples carry on far out, where their mip levels average them; without them the swell alone mirrors the
        // sky in long, regular bands.
        const near = float(1).sub(smoothstep(60, 4000, dist));
        ripple.assign(r1.z);
        const strength = this.detailStrength.mul(mix(float(0.55), float(1.35), g));
        const slope = d1.mul(0.2).add(d2.mul(0.13)).mul(near).mul(strength);
        dyx.addAssign(slope.x);
        dyz.addAssign(slope.y);
        lost.addAssign(float(1).sub(near).mul(strength).mul(strength).mul(DETAIL_SLOPE_VARIANCE));
      }
      const seabed = texture(terrain.heightTexture, terrainUV(p0)).r;
      const depthBelow = seabed.negate();
      const shore = smoothstep(0.5, 22.0, depthBelow);
      dyx.assign(dyx.mul(shore));
      dyz.assign(dyz.mul(shore));
      dxx.assign(dxx.mul(shore));
      dzz.assign(dzz.mul(shore));
      dxz.assign(dxz.mul(shore));
      const ix = float(1).add(dxx);
      const iz = float(1).add(dzz);
      const jacobian = ix.mul(iz).sub(dxz.mul(dxz));
      const nGeom = normalize(vec3(dyz.mul(dxz).sub(iz.mul(dyx)), max(jacobian, 0.05), dxz.mul(dyx).sub(dyz.mul(ix))));
      // Where the swell and the longer waves fold over: whitecaps crown their crests.
      const breaking = ix.sub(fineXX.mul(shore)).mul(iz.sub(fineZZ.mul(shore))).sub(dxz.mul(dxz));

      const wakeUV = vec2(p0.x.sub(wake.center.x).div(wake.extentU).add(0.5), p0.y.sub(wake.center.y).div(wake.extentU).add(0.5));
      const wakeEdge = smoothstep(0.0, 0.03, wakeUV.x).mul(smoothstep(1.0, 0.97, wakeUV.x)).mul(smoothstep(0.0, 0.03, wakeUV.y)).mul(smoothstep(1.0, 0.97, wakeUV.y));
      const wakeTex = wake.sample(wakeUV, this);
      const wakeFoam = saturate(wakeTex.r.mul(wakeEdge));
      const wakeTurb = saturate(wakeTex.g.mul(wakeEdge));
      // The hulls' shade (blue): under and beside a hull the water sees less sky and no sun.
      const hullShade = saturate(wakeTex.b.mul(wakeEdge));
      const uv3 = p0.mul(1 / 2.3).add(vec2(t.mul(0.031), t.mul(-0.024)));
      const d3 = texture(detailTex, uv3).xy.mul(2).sub(1);
      const nRaw = normalize(nGeom.add(vec3(d3.x.mul(wakeTurb).mul(-0.35), 0, d3.y.mul(wakeTurb).mul(-0.35))));
      const ndv0 = dot(nRaw, V);
      const N = select(ndv0.lessThan(0.03), normalize(nRaw.add(V.mul(float(0.03).sub(ndv0)))), nRaw);

      const NoV = saturate(dot(N, V));
      const fresnel = float(0.02).add(float(0.98).mul(pow(float(1).sub(NoV), 5)));
      const R = reflect(V.negate(), N);
      const Rc = normalize(vec3(R.x, max(R.y, 0.025), R.z));
      // The sky's reflection blurs with a share of the lost slope only: at grazing angles the far water keeps mirroring
      // the bright horizon, as the waves' backs hide the steepest slopes from a low eye.
      const envBase = mix(float(0.03), float(0.16), smoothstep(40, 5000, dist)).add(lostSlope.mul(0.6)).min(0.45);
      const roughEnv = pow(pow(envBase, 4).add(lost.mul(0.35)), 0.25).min(0.55);
      const reflNode = pmremTexture(this.envTexture, Rc, roughEnv);
      pmremNodes.push(reflNode);
      const skyReflection = vec3(reflNode).mul(atmosphere.envIntensity);
      // A hull's reflection lies between it and the eye: a point at the waterline's height h above a pixel d metres
      // away is mirrored from d·h/eyeHeight further on. So the hull's footprint, read that far beyond the pixel (and
      // rocked by the waves' slope), is where the water mirrors dark planking instead of the sky.
      const awayH = p0.sub(cameraPosition.xz);
      const dH = max(length(awayH), 0.01);
      const reach = min(dH.mul(4.5).div(max(cameraPosition.y, 1.5)), 70);
      const mirrorP = p0.add(awayH.div(dH).mul(reach)).add(N.xz.mul(reach.mul(0.35).add(2)));
      const mirrorUV = mirrorP.sub(wake.center).div(wake.extentU).add(0.5);
      const hullMirror = saturate(wake.sample(mirrorUV, this).b.mul(wakeEdge)).mul(float(1).sub(smoothstep(900, 2600, dist)));
      const hullColor = vec3(0.15, 0.1, 0.065).mul(atmosphere.skyAmbient.mul(4.2).add(atmosphere.sunIrradiance.mul(0.1)));
      const reflection = mix(skyReflection, hullColor, hullMirror.mul(0.9));

      const L = atmosphere.sunDir;
      const H = normalize(L.add(V));
      const NoH = saturate(dot(N, H));
      const NoL = saturate(dot(N, L));
      const VoH = saturate(dot(V, H));
      const roughSpec = mix(float(0.05), float(0.1), smoothstep(20, 3500, dist)).add(lostSlope.mul(0.8)).min(0.5);
      const a2 = roughSpec.mul(roughSpec).mul(roughSpec).mul(roughSpec).add(lost).min(0.5);
      const dDen = NoH.mul(NoH).mul(a2.sub(1)).add(1);
      const D = a2.div(dDen.mul(dDen).mul(Math.PI));
      const Fs = float(0.02).add(float(0.98).mul(pow(float(1).sub(VoH), 5)));
      // The sun is cut off under the clouds' shadows, which drift over the sea with the wind.
      const sunLit = atmosphere.sunIrradiance.mul(sunThroughClouds(p0)).toVar();
      const spec = sunLit.mul(float(1).sub(hullShade.mul(0.85))).mul(D.mul(Fs).mul(NoL).div(max(NoV, 0.12).mul(4)));
      const lightSpec = vec3(0).toVar();
      const lightDiffuse = vec3(0).toVar();
      const aL = float(0.09).mul(float(0.09)).mul(float(0.09)).mul(float(0.09));
      Loop(lightCount, ({ i }) => {
        const lp: any = pointLights.posNode.element(i);
        const lc: any = pointLights.colNode.element(i);
        const toL = lp.xyz.sub(positionWorld);
        const dl = length(toL);
        const Ld = toL.div(dl);
        const cutoff = saturate(float(1).sub(pow(dl.div(lc.w), 4)));
        const atten = lp.w.div(max(dl.mul(dl), 1)).mul(cutoff.mul(cutoff));
        const Hl = normalize(Ld.add(V));
        const nh = saturate(dot(N, Hl));
        const nl = saturate(dot(N, Ld));
        const dd = nh.mul(nh).mul(aL.sub(1)).add(1);
        const Dl = aL.div(dd.mul(dd).mul(Math.PI));
        const fl = float(0.02).add(float(0.98).mul(pow(float(1).sub(saturate(dot(V, Hl))), 5)));
        lightSpec.addAssign(lc.xyz.mul(atten).mul(Dl.mul(fl).mul(nl).div(max(NoV, 0.12).mul(4))));
        lightDiffuse.addAssign(lc.xyz.mul(atten).mul(nl.mul(0.5).add(0.5)));
      });

      const crest = saturate(positionWorld.y.mul(this.heightScale).add(0.15));
      const backLit = pow(saturate(dot(L.negate(), V).mul(0.65).add(0.35)), 4);
      const thin = pow(saturate(float(0.5).sub(dot(L, N).mul(0.5))), 2);
      const scatterAmount = crest.mul(backLit).mul(thin).mul(2.6).add(pow(NoV, 2).mul(0.25));
      const sunLuma = dot(atmosphere.sunIrradiance, vec3(0.2126, 0.7152, 0.0722));
      const scatter = atmosphere.waterScatter.mul(sunLit).mul(scatterAmount).mul(0.18);
      // Patches of greener or darker water a few kilometres across: the sea is not one dye.
      const deep = atmosphere.waterDeep.mul(mix(vec3(1.1, 0.9, 0.94), vec3(0.9, 1.08, 1.04), fields.tint(p0)));
      const bodyLit = deep.mul(atmosphere.skyAmbient.mul(4.2).add(sunLit.mul(NoL.mul(0.25).add(0.12)))).add(scatter).add(atmosphere.waterScatter.mul(atmosphere.skyAmbient).mul(crest.mul(0.35).add(wakeTurb.mul(1.6))));

      const body = bodyLit.mul(float(1).sub(hullShade.mul(0.55)));
      const shallowTint = float(1).sub(smoothstep(1.5, 14, depthBelow));
      // Refraction and contact foam read the scene colour and depth behind the surface. That costs a framebuffer
      // copy every frame, so the mobile tiers use the body colour alone and skip the foam at the shoreline contact.
      let underwater: any = body;
      let contact: any = float(0);
      if (refraction) {
        const distortion = N.xz.mul(0.035).div(max(dist.mul(0.02), 1));
        const uvR = screenUV.add(distortion);
        const surfaceZ = positionView.z;
        const depthR = viewportDepthTexture(uvR);
        depthNodes.push(depthR);
        const sceneZr = perspectiveDepthToViewZ(depthR, cameraNear, cameraFar);
        const useDistorted = sceneZr.lessThan(surfaceZ);
        const uvFinal = select(useDistorted, uvR, screenUV);
        // The same copy of the depth, read again: a lookup node of its own would copy the depth buffer a second time,
        // ending and restarting the scene's pass, into a framebuffer-sized texture of its own.
        const depthFinal = depthR.sample(uvFinal);
        const sceneZ = perspectiveDepthToViewZ(depthFinal, cameraNear, cameraFar);
        const thickness = max(surfaceZ.sub(sceneZ), 0);
        const absorb = mix(vec3(0.55, 0.16, 0.11), vec3(0.42, 0.11, 0.12), shallowTint);
        const trans = exp(absorb.mul(thickness).negate());
        const behind = viewportSharedTexture(uvFinal).rgb;
        underwater = mix(body, behind.mul(mix(vec3(0.55, 0.85, 0.8), vec3(0.62, 0.92, 0.82), shallowTint)), trans);
        contact = float(1).sub(smoothstep(0, 1.4, thickness)).mul(select(thickness.lessThan(30), float(1), float(0)));
      }

      const color = mix(underwater.add(atmosphere.waterScatter.mul(lightDiffuse).mul(0.05)), reflection, fresnel).add(spec).add(lightSpec).toVar();

      const foamUV = p0.mul(1 / 14).add(N.xz.mul(0.25)).add(vec2(t.mul(0.004), t.mul(-0.003)));
      const foamUV2 = p0.mul(1 / 4.3).add(N.xz.mul(0.12)).sub(vec2(t.mul(0.011), t.mul(0.004)));
      const pattern = texture(foamTex, foamUV).r.mul(0.62).add(texture(foamTex, foamUV2).r.mul(0.38));
      // Whitecaps break where the gusts blow: in clusters that come and go, not as an even sprinkling. The swell alone
      // never folds over far enough to break, so without the FFT cascades the wind waves of the ripple texture whiten
      // where they ride high on the swell.
      const folded = saturate(float(0.86).sub(breaking).mul(2.4));
      const caps = fft ? folded : max(folded, smoothstep(0.7, 0.9, ripple).mul(smoothstep(0.35, 0.8, crest)).mul(0.9));
      const whitecap = caps.mul(this.whitecaps).mul(mix(float(0.4), float(1.6), g));
      const surf = float(1).sub(smoothstep(0.0, 4.5, depthBelow)).mul(sin(depthBelow.mul(2.2).sub(t.mul(1.6))).mul(0.35).add(0.75));
      const speed = length(flow);
      const whirl = float(0).toVar();
      const core = float(0).toVar();
      const eddyFoam = float(0).toVar();
      if (current) {
        const dir = flow.div(max(speed, 0.001));
        const along = dot(p0, dir);
        const across = dot(p0, vec2(dir.y.negate(), dir.x));
        const streak = texture(foamTex, vec2(along.div(42).sub(t.mul(speed).div(42)), across.div(3.4))).r;
        whirl.addAssign(smoothstep(0.55, 0.95, streak).mul(smoothstep(1.2, 4.2, speed)).mul(0.75));
        const base = select(tide.lessThan(0), float(0), float(4));
        Loop(4, ({ i }) => {
          const v: any = vortices.element(base.add(i).toInt());
          const d = p0.sub(v.xy);
          const r = length(d);
          const a = atan(d.y, d.x);
          const spin = sign(v.w);
          const spiral = sin(a.mul(3).add(log(r.add(1)).mul(7).mul(spin)).sub(t.mul(2.4).mul(spin))).mul(0.5).add(0.5);
          const breakup = texture(foamTex, p0.div(11).add(vec2(t.mul(0.013), t.mul(-0.009)))).r;
          const ring = smoothstep(v.z.mul(1.6), v.z.mul(0.35), r).mul(smoothstep(v.z.mul(0.03), v.z.mul(0.2), r));
          const k = abs(v.w).mul(abs(tide));
          if (designedEddies) {
            // Explicit regional eddies need readable foam arms even in moderate seas. Keep their tide direction,
            // physical radius and slack-water disappearance, without adding this cue to historical presets.
            const eddyRing = float(1).sub(smoothstep(v.z.mul(0.35), v.z.mul(1.6), r)).mul(smoothstep(v.z.mul(0.03), v.z.mul(0.2), r));
            const patches = texture(foamTex, p0.div(150).add(vec2(t.mul(0.0015), t.mul(-0.0007)))).r;
            const arm = sin(a.mul(3).add(log(r.add(1)).mul(7).mul(spin)).add(patches.mul(2.2)).sub(t.mul(2.4).mul(spin))).mul(0.5).add(0.5);
            eddyFoam.addAssign(smoothstep(0.78, 0.98, arm).mul(smoothstep(0.38, 0.8, patches)).mul(eddyRing).mul(min(k, 1)).mul(0.68));
          }
          whirl.addAssign(smoothstep(0.45, 0.95, spiral).mul(smoothstep(0.3, 0.85, breakup)).mul(ring).mul(k).mul(1.15));
          whirl.addAssign(smoothstep(0.7, 1, breakup).mul(ring).mul(k).mul(0.35));
          core.addAssign(smoothstep(v.z.mul(0.45), float(0), r).mul(k));
        });
      }
      // A ring of broken water where the hull meets the sea.
      const waterline = hullShade.mul(float(1).sub(hullShade)).mul(4).mul(0.45);
      const coverage = whitecap.mul(1.35).mul(shore).add(contact.mul(1.2)).add(waterline).add(wakeFoam.mul(1.15)).add(whirl).add(surf.mul(select(depthBelow.greaterThan(-0.5), float(1), float(0))));
      // Foam is lace, not paint: a soft edge into the lattice of the pattern, and bubbles that let the water show through.
      const bubbles = texture(foamTex, p0.mul(1 / 1.1).add(N.xz.mul(0.05)).add(vec2(t.mul(0.02), t.mul(-0.013)))).r;
      const lace = saturate(coverage.sub(float(1).sub(pattern)).mul(1.9)).mul(mix(float(0.55), float(1), bubbles));
      const foam = max(lace, eddyFoam.clamp(0, 0.82));
      const foamLight = atmosphere.skyAmbient.mul(0.95).add(sunLit.mul(NoL.mul(0.6).add(0.25)).mul(1 / Math.PI)).add(lightDiffuse.mul(1 / Math.PI));
      // Under the moon the foam is grey-blue, not a lamp: the night grade lifts bright pixels, so the paint itself is dimmer.
      const foamPaint = mix(vec3(0.93, 0.95, 0.96), vec3(0.62, 0.68, 0.76), atmosphere.night);
      color.assign(mix(color, foamPaint.mul(foamLight), foam.mul(0.92)));
      color.assign(color.mul(float(1).sub(core.clamp(0, 1).mul(0.35))));

      const fogColor = vec3(sky.horizon(V.negate())).mul(atmosphere.envIntensity);
      const fogAmount = seaFogAmount(dist);
      color.assign(mix(color, fogColor, clamp(fogAmount, 0, 1)));
      const finalColor = min(color, vec3(sunLuma.mul(4).add(60)));
      return mix(finalColor, vec3(wakeFoam, wakeTurb, wakeEdge.mul(0.2)), this.debugWake);
    })();

    material.colorNode = colorFor(false);
    const matPlain = material;
    this.matPlain = matPlain;
    this.makeRefract = () => {
      const m = material.clone();
      m.colorNode = colorFor(true);
      return m;
    };

    const mesh = new Mesh(geometry, matPlain);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    this.mesh = mesh;
  }

  /** Switches between the refracting and the plain surface. The refracting one is built the first time it is asked for. */
  setRefraction(on: boolean) {
    if (on) this.matRefract ??= this.makeRefract();
    this.mesh.material = on ? this.matRefract! : this.matPlain;
  }

  setEnvironment(envTexture: Texture) {
    this.envTexture = envTexture;
    for (const node of this.pmremNodes) node.value = envTexture;
  }

  /** Frees the mesh, both surface materials and the baked current. The wave textures are cached for the next battle. */
  dispose() {
    this.mesh.geometry.dispose();
    this.matPlain.dispose();
    this.matRefract?.dispose();
    this.currentMap?.dispose();
    // Each reflection node owns a PMREM generator with its own render targets.
    for (const node of this.pmremNodes) node.dispose();
    this.pmremNodes.length = 0;
    // The node's value is the clone made for the canvas on its first render.
    for (const node of this.depthNodes) node.value.dispose();
    this.depthNodes.length = 0;
    this.wake.release(this);
    this.mesh.removeFromParent();
  }

  syncWaves() {
    if (this.waveVersion === this.waves.version) return;
    for (let i = 0; i < WAVE_COUNT; i += 1) {
      const o = i * 4;
      this.waveA[i]!.set(this.waves.dirK[o]!, this.waves.dirK[o + 1]!, this.waves.dirK[o + 2]!, this.waves.dirK[o + 3]!);
      this.waveB[i]!.set(this.waves.ampQ[o]!, this.waves.ampQ[o + 1]!, this.waves.ampQ[o + 2]!, this.waves.ampQ[o + 3]!);
    }
    this.heightScale.value = 1 / Math.max(0.2, this.waves.significantHeight() * 0.5);
    this.whitecaps.value = this.waves.state.whitecaps;
    this.detailStrength.value = this.waves.state.detail;
    this.mirror.value.set(Math.cos(2 * this.waves.state.windAngle), Math.sin(2 * this.waves.state.windAngle));
    this.waveVersion = this.waves.version;
  }

  setTide(tide: number) {
    this.tide.value = tide;
  }

  update(cameraX: number, cameraZ: number) {
    this.syncWaves();
    this.time.value = this.waves.time;
    this.mesh.position.set(cameraX, 0, cameraZ);
  }
}
