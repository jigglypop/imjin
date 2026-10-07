import {
  BufferGeometry,
  Float32BufferAttribute,
  FrontSide,
  Mesh,
  MeshBasicNodeMaterial,
  Uint32BufferAttribute,
  Vector4,
  type Texture,
} from 'three/webgpu';
import {
  Fn,
  Loop,
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
import { WAVE_COUNT, type WaveField } from './waves';
import { createDetailNormalTexture, createFoamTexture } from './detailNormals';
import type { WakeMap } from './WakeMap';
import type { Terrain } from '../terrain/Terrain';
import { LIGHT_COUNT, pointLights } from '../render/lights';
import { CASCADES, FFT_N, type FFTWaves } from './FFTWaves';

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
  readonly time = uniform(0);
  readonly detailStrength = uniform(1);
  readonly whitecaps = uniform(0.6);
  readonly heightScale = uniform(0.5);
  readonly debugWake = uniform(0);
  private readonly waveA: Vector4[];
  private readonly waveB: Vector4[];
  private readonly pmremNodes: ReturnType<typeof pmremTexture>[] = [];
  private waveVersion = -1;

  constructor(private readonly waves: WaveField, envTexture: Texture, wake: WakeMap, terrain: Terrain, fft: FFTWaves | null) {
    this.waveA = Array.from({ length: WAVE_COUNT }, () => new Vector4());
    this.waveB = Array.from({ length: WAVE_COUNT }, () => new Vector4());
    this.syncWaves();
    const waveA = uniformArray(this.waveA, 'vec4');
    const waveB = uniformArray(this.waveB, 'vec4');
    const detailTex = createDetailNormalTexture(waves.state.windAngle);
    const foamTex = createFoamTexture();
    const uTime = this.time;
    const { geometry, spacing } = createOceanGeometry();

    const worldXZ = modelWorldMatrix.mul(vec4(positionGeometry, 1)).xz;
    const vertexDistance = length(worldXZ.sub(cameraPosition.xz));
    const tRot = terrain.rotation;
    const tSize = terrain.sizeU;
    const terrainUV = (xz: any) => vec2(xz.x.mul(tRot.x).add(xz.y.mul(tRot.y)), xz.x.mul(tRot.y).negate().add(xz.y.mul(tRot.x))).div(tSize).add(0.5);
    const seabedV = texture(terrain.heightTexture, terrainUV(worldXZ)).level(float(0)).r;
    const shoreV = smoothstep(0.5, 22.0, seabedV.negate());
    const gust = (xz: any, level: any) => texture(detailTex, xz.mul(1 / 530).add(vec2(uTime.mul(0.0021), uTime.mul(-0.0013)))).level(level).z.mul(1.25).sub(0.05).clamp(0.45, 1.3);
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
        const g = gust(worldXZ, float(0));
        for (let c = 0; c < 2; c += 1) {
          const L = CASCADES[c]!.size;
          const texel = L / FFT_N;
          const lod = max(log2(vSpacing.mul(2.2).div(texel)), 0);
          const d: any = texture(fft.displacement[c]!, worldXZ.div(L)).level(lod);
          const w = c === 0 ? float(1) : g;
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

    material.colorNode = Fn(() => {
      const p0 = vP0;
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
      Loop(WAVE_COUNT, ({ i }) => {
        const a: any = waveA.element(i);
        const b: any = waveB.element(i);
        const fade = float(1).sub(smoothstep(b.w.mul(0.12), b.w.mul(0.42), footprint));
        const theta = a.z.mul(dot(a.xy, p0)).sub(a.w.mul(uTime)).add(b.z);
        const s = sin(theta);
        const c = cos(theta);
        const qk = b.y.mul(a.z).mul(fade).mul(s);
        const ka = a.z.mul(b.x).mul(fade).mul(c);
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
      if (fft) {
        const g = gust(p0, float(0));
        for (let c = 0; c < CASCADES.length; c += 1) {
          const L = CASCADES[c]!.size;
          const uvc = p0.div(L);
          const der: any = texture(fft.derivatives[c]!, uvc);
          const disp: any = texture(fft.displacement[c]!, uvc);
          const w: any = c === 0 ? float(1) : c === 1 ? g : g.mul(this.detailStrength);
          dyx.addAssign(der.x.mul(w));
          dyz.addAssign(der.y.mul(w));
          dxx.addAssign(der.z.mul(w));
          dzz.addAssign(der.w.mul(w));
          dxz.addAssign(disp.w.mul(w));
        }
      } else {
        const uv1 = p0.mul(1 / 21).add(vec2(t.mul(0.011), t.mul(0.006)));
        const uv2 = vec2(p0.x.mul(0.8).sub(p0.y.mul(0.6)), p0.x.mul(0.6).add(p0.y.mul(0.8))).mul(1 / 6.7).add(vec2(t.mul(-0.019), t.mul(0.014)));
        const d1 = texture(detailTex, uv1).xy.mul(2).sub(1);
        const d2 = texture(detailTex, uv2).xy.mul(2).sub(1);
        const near = float(1).sub(smoothstep(30, 1400, dist));
        const slope = d1.mul(0.2).add(d2.mul(0.13)).mul(near).mul(this.detailStrength);
        dyx.addAssign(slope.x);
        dyz.addAssign(slope.y);
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

      const wakeUV = vec2(p0.x.sub(wake.center.x).div(wake.extentU).add(0.5), p0.y.sub(wake.center.y).div(wake.extentU).add(0.5));
      const wakeEdge = smoothstep(0.0, 0.03, wakeUV.x).mul(smoothstep(1.0, 0.97, wakeUV.x)).mul(smoothstep(0.0, 0.03, wakeUV.y)).mul(smoothstep(1.0, 0.97, wakeUV.y));
      const wakeTex = wake.sample(wakeUV);
      const wakeFoam = saturate(wakeTex.r.mul(wakeEdge));
      const wakeTurb = saturate(wakeTex.g.mul(wakeEdge));
      const uv3 = p0.mul(1 / 2.3).add(vec2(t.mul(0.031), t.mul(-0.024)));
      const d3 = texture(detailTex, uv3).xy.mul(2).sub(1);
      const nRaw = normalize(nGeom.add(vec3(d3.x.mul(wakeTurb).mul(-0.35), 0, d3.y.mul(wakeTurb).mul(-0.35))));
      const ndv0 = dot(nRaw, V);
      const N = select(ndv0.lessThan(0.03), normalize(nRaw.add(V.mul(float(0.03).sub(ndv0)))), nRaw);

      const NoV = saturate(dot(N, V));
      const fresnel = float(0.02).add(float(0.98).mul(pow(float(1).sub(NoV), 5)));
      const R = reflect(V.negate(), N);
      const Rc = normalize(vec3(R.x, max(R.y, 0.025), R.z));
      const roughEnv = mix(float(0.03), float(0.2), smoothstep(40, 5000, dist)).add(lostSlope.mul(0.6)).min(0.45);
      const reflNode = pmremTexture(envTexture, Rc, roughEnv);
      pmremNodes.push(reflNode);
      const reflection = vec3(reflNode).mul(atmosphere.envIntensity);

      const L = atmosphere.sunDir;
      const H = normalize(L.add(V));
      const NoH = saturate(dot(N, H));
      const NoL = saturate(dot(N, L));
      const VoH = saturate(dot(V, H));
      const roughSpec = mix(float(0.05), float(0.16), smoothstep(20, 3500, dist)).add(lostSlope.mul(0.8)).min(0.5);
      const a2 = roughSpec.mul(roughSpec).mul(roughSpec).mul(roughSpec);
      const dDen = NoH.mul(NoH).mul(a2.sub(1)).add(1);
      const D = a2.div(dDen.mul(dDen).mul(Math.PI));
      const Fs = float(0.02).add(float(0.98).mul(pow(float(1).sub(VoH), 5)));
      const spec = atmosphere.sunIrradiance.mul(D.mul(Fs).mul(NoL).div(max(NoV, 0.12).mul(4)));
      const lightSpec = vec3(0).toVar();
      const lightDiffuse = vec3(0).toVar();
      const aL = float(0.09).mul(float(0.09)).mul(float(0.09)).mul(float(0.09));
      Loop(LIGHT_COUNT, ({ i }) => {
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
      const scatter = atmosphere.waterScatter.mul(atmosphere.sunIrradiance).mul(scatterAmount).mul(0.18);
      const body = atmosphere.waterDeep.mul(atmosphere.skyAmbient.mul(4.2).add(atmosphere.sunIrradiance.mul(NoL.mul(0.25).add(0.12)))).add(scatter).add(atmosphere.waterScatter.mul(atmosphere.skyAmbient).mul(crest.mul(0.35).add(wakeTurb.mul(1.6))));

      const distortion = N.xz.mul(0.035).div(max(dist.mul(0.02), 1));
      const uvR = screenUV.add(distortion);
      const surfaceZ = positionView.z;
      const sceneZr = perspectiveDepthToViewZ(viewportDepthTexture(uvR), cameraNear, cameraFar);
      const useDistorted = sceneZr.lessThan(surfaceZ);
      const uvFinal = select(useDistorted, uvR, screenUV);
      const sceneZ = perspectiveDepthToViewZ(viewportDepthTexture(uvFinal), cameraNear, cameraFar);
      const thickness = max(surfaceZ.sub(sceneZ), 0);
      const shallowTint = float(1).sub(smoothstep(1.5, 14, depthBelow));
      const absorb = mix(vec3(0.55, 0.16, 0.11), vec3(0.42, 0.11, 0.12), shallowTint);
      const trans = exp(absorb.mul(thickness).negate());
      const behind = viewportSharedTexture(uvFinal).rgb;
      const underwater = mix(body, behind.mul(mix(vec3(0.55, 0.85, 0.8), vec3(0.62, 0.92, 0.82), shallowTint)), trans);

      const color = mix(underwater.add(atmosphere.waterScatter.mul(lightDiffuse).mul(0.05)), reflection, fresnel).add(spec).add(lightSpec).toVar();

      const foamUV = p0.mul(1 / 14).add(N.xz.mul(0.25)).add(vec2(t.mul(0.004), t.mul(-0.003)));
      const foamUV2 = p0.mul(1 / 4.3).add(N.xz.mul(0.12)).sub(vec2(t.mul(0.011), t.mul(0.004)));
      const pattern = texture(foamTex, foamUV).r.mul(0.62).add(texture(foamTex, foamUV2).r.mul(0.38));
      const whitecap = saturate(float(0.82).sub(jacobian).mul(2.4)).mul(this.whitecaps);
      const contact = float(1).sub(smoothstep(0, 1.4, thickness)).mul(select(thickness.lessThan(30), float(1), float(0)));
      const surf = float(1).sub(smoothstep(0.0, 4.5, depthBelow)).mul(sin(depthBelow.mul(2.2).sub(t.mul(1.6))).mul(0.35).add(0.75));
      const coverage = whitecap.mul(1.35).mul(shore).add(contact.mul(1.2)).add(wakeFoam.mul(1.15)).add(surf.mul(select(depthBelow.greaterThan(-0.5), float(1), float(0))));
      const foam = saturate(coverage.sub(float(1).sub(pattern)).mul(3.2));
      const foamLight = atmosphere.skyAmbient.mul(0.95).add(atmosphere.sunIrradiance.mul(NoL.mul(0.6).add(0.25)).mul(1 / Math.PI)).add(lightDiffuse.mul(1 / Math.PI));
      color.assign(mix(color, vec3(0.93, 0.95, 0.96).mul(foamLight), foam.mul(0.92)));

      const horizonDir = normalize(vec3(V.x.negate(), 0.035, V.z.negate()));
      const fogNode = pmremTexture(envTexture, horizonDir, float(0.45));
      pmremNodes.push(fogNode);
      const fogColor = vec3(fogNode).mul(atmosphere.envIntensity);
      const fogAmount = float(1).sub(exp(dist.mul(atmosphere.fogDensity).negate()));
      color.assign(mix(color, fogColor, clamp(fogAmount, 0, 1)));
      const finalColor = min(color, vec3(sunLuma.mul(4).add(60)));
      return mix(finalColor, vec3(wakeFoam, wakeTurb, wakeEdge.mul(0.2)), this.debugWake);
    })();

    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    this.mesh = mesh;
  }

  setEnvironment(envTexture: Texture) {
    for (const node of this.pmremNodes) node.value = envTexture;
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
    this.waveVersion = this.waves.version;
  }

  update(cameraX: number, cameraZ: number) {
    this.syncWaves();
    this.time.value = this.waves.time;
    this.mesh.position.set(cameraX, 0, cameraZ);
  }
}
