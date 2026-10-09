import {
  AddEquation,
  BackSide,
  CustomBlending,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  NoBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  QuadMesh,
  RenderTarget,
  Scene,
  SphereGeometry,
  Vector2,
  type Camera,
  type Data3DTexture,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  hash,
  max,
  min,
  mix,
  normalize,
  pmremTexture,
  positionWorld,
  pow,
  screenCoordinate,
  smoothstep,
  texture,
  texture3D,
  screenUV,
  vec2,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { uv as uv0 } from 'three/tsl';
import { atmosphere } from './atmosphere';
import { createCloudNoise } from './cloudNoise';

const BOTTOM = 1500;
const TOP = 3900;
/** Total distance the light march covers, split across its steps. */
const LIGHT_SPAN = 760;
/** Loop bounds are fixed when the shader compiles. Steps below the run-time count are used, the rest are skipped. */
const MAX_STEPS = 64;
const MAX_LIGHT_STEPS = 4;
/** What the shader is built for when the levels that can run never need the most: a smaller program for the driver to build. */
export type CloudLimits = { steps: number; lightSteps: number };

export type CloudQuality = { steps: number; lightSteps: number; divisor: number; every: number };

export class Clouds {
  readonly mesh: Mesh;
  private readonly marcher: Mesh;
  private readonly marchScene = new Scene();
  private readonly rtA = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private readonly rtB = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private readonly texel = uniform(new Vector2(1, 1));
  private readonly blurH: QuadMesh;
  private readonly blurV: QuadMesh;
  private readonly size = new Vector2();
  // Typed loosely: the TSL node types do not accept uniform nodes as operands of float arithmetic.
  private readonly stepsU: any;
  private readonly lightStepsU: any;
  private quality: CloudQuality;
  readonly time = uniform(0);
  readonly coverage = uniform(0.5);
  readonly density = uniform(0.032);
  readonly decloud = uniform(0.72);
  private readonly noise: Data3DTexture;
  private readonly envNode: ReturnType<typeof pmremTexture>;

  private readonly maxSteps: number;
  private readonly maxLightSteps: number;

  constructor(env: Texture, quality: CloudQuality, limits: CloudLimits = { steps: MAX_STEPS, lightSteps: MAX_LIGHT_STEPS }) {
    this.quality = quality;
    this.maxSteps = Math.min(MAX_STEPS, limits.steps);
    this.maxLightSteps = Math.min(MAX_LIGHT_STEPS, limits.lightSteps);
    const maxSteps = this.maxSteps;
    const maxLightSteps = this.maxLightSteps;
    this.stepsU = uniform(Math.min(maxSteps, quality.steps));
    this.lightStepsU = uniform(Math.min(maxLightSteps, quality.lightSteps));
    const stepsU = this.stepsU;
    const lightStepsU = this.lightStepsU;
    const lightStep = float(LIGHT_SPAN).div(lightStepsU);
    this.noise = createCloudNoise(64);
    const noise = this.noise;
    const m = new MeshBasicNodeMaterial();
    m.side = BackSide;
    m.transparent = false;
    m.blending = NoBlending;
    m.depthWrite = false;
    m.depthTest = false;
    m.fog = false;
    const dir = normalize(positionWorld.sub(cameraPosition));
    this.envNode = pmremTexture(env, dir, float(0.42));
    const haze = vec3(this.envNode).mul(atmosphere.envIntensity);
    const t = this.time;
    const wind = vec3(t.mul(9), 0, t.mul(4));
    const sun = atmosphere.sunDir;
    const sample = (p: any, far: any = float(0)) => {
      const h = p.y.sub(BOTTOM).div(TOP - BOTTOM);
      const shape = smoothstep(0, 0.1, h).mul(smoothstep(1, 0.45, h));
      const q = p.add(wind);
      const weather = texture3D(noise, vec3(q.x.div(46000), 0.37, q.z.div(46000))).r;
      const base = texture3D(noise, vec3(q.x.div(10500), p.y.div(7000), q.z.div(10500))).r;
      const cover = clamp(this.coverage.add(weather.sub(0.45).mul(0.9)), 0.05, 0.95);
      const d0 = base.mul(shape).sub(float(1).sub(cover)).div(cover).max(0);
      const detail = texture3D(noise, q.div(1900).add(vec3(0, t.mul(0.004), 0))).g;
      return d0.sub(detail.mul(mix(float(0.32), float(0.08), far)).mul(float(1).sub(d0))).max(0);
    };
    m.colorNode = Fn(() => {
      const up = dir.y;
      const out = vec4(0, 0, 0, 0).toVar();
      If(up.greaterThan(0.004), () => {
        const camY = cameraPosition.y;
        const t0 = max(float(BOTTOM).sub(camY).div(up), 0);
        const t1 = min(min(float(TOP).sub(camY).div(up), 52000), t0.add(9000));
        const span = max(t1.sub(t0), 0);
        const stepLen = span.div(stepsU);
        const jitter = hash(screenCoordinate.x.add(screenCoordinate.y.mul(4096)).toUint());
        const trans = float(1).toVar();
        const light = vec3(0).toVar();
        const cosA = dot(dir, sun);
        const g1 = 0.6;
        const g2 = -0.25;
        const hg1 = float(1 - g1 * g1).div(pow(float(1 + g1 * g1).sub(cosA.mul(2 * g1)), 1.5));
        const hg2 = float(1 - g2 * g2).div(pow(float(1 + g2 * g2).sub(cosA.mul(2 * g2)), 1.5));
        const phase = mix(hg2, hg1, 0.7).mul(1 / (4 * Math.PI));
        Loop(maxSteps, ({ i }) => {
          If(trans.greaterThan(0.02).and(float(i).lessThan(stepsU)), () => {
            const tt = t0.add(float(i).add(jitter).mul(stepLen));
            const p = cameraPosition.add(dir.mul(tt));
            const far = smoothstep(9000, 30000, tt);
            const d = sample(p, far);
            If(d.greaterThan(0.001), () => {
              const od = float(0).toVar();
              Loop(maxLightSteps, ({ i: k }) => {
                If(float(k).lessThan(lightStepsU), () => {
                  const lp = p.add(sun.mul(float(k).add(0.5).mul(lightStep)));
                  od.addAssign(sample(lp, far));
                });
              });
              const sigma = d.mul(this.density);
              const lightT = exp(od.mul(this.density).mul(lightStep).negate());
              const powder = float(1).sub(exp(d.mul(-2.4)));
              const hfrac = p.y.sub(BOTTOM).div(TOP - BOTTOM);
              const ambient = atmosphere.skyAmbient.mul(float(0.55).add(hfrac.mul(0.6))).mul(1.6);
              const direct = atmosphere.sunIrradiance.mul(lightT).mul(phase.mul(14).add(0.25)).mul(powder.mul(0.75).add(0.25));
              const fogK = exp(tt.mul(-0.000026));
              const scattered = mix(haze, direct.add(ambient), fogK);
              const stepT = exp(sigma.mul(stepLen).negate());
              light.addAssign(trans.mul(float(1).sub(stepT)).mul(scattered));
              trans.mulAssign(stepT);
            });
          });
        });
        const cloudA = float(1).sub(trans);
        const horizon = smoothstep(0.004, 0.09, up);
        const k = this.decloud.mul(mix(float(0.4), float(1), horizon));
        const alpha = max(cloudA.mul(horizon), k);
        const color = mix(haze, light.div(max(cloudA, 0.0001)), cloudA.mul(horizon).div(max(alpha, 0.0001)));
        out.assign(vec4(color.mul(alpha), alpha));
      });
      return out;
    })();
    m.opacityNode = null;
    const marcher = new Mesh(new SphereGeometry(40000, 48, 24), m);
    marcher.frustumCulled = false;
    this.marcher = marcher;
    this.marchScene.add(marcher);
    for (const rt of [this.rtA, this.rtB]) {
      rt.texture.minFilter = LinearFilter;
      rt.texture.magFilter = LinearFilter;
      rt.texture.generateMipmaps = false;
    }
    const blur = (src: Texture, dir: Vector2) => {
      const bm = new MeshBasicNodeMaterial();
      bm.blending = NoBlending;
      bm.depthTest = false;
      bm.depthWrite = false;
      const w = [0.2270270270, 0.1945945946, 0.1216216216, 0.0540540541, 0.0162162162];
      const step = this.texel.mul(vec2(dir.x, dir.y)).mul(1.0);
      let acc: any = texture(src, uv0()).mul(w[0]!);
      for (let k = 1; k < 5; k += 1) {
        acc = acc.add(texture(src, uv0().add(step.mul(k))).mul(w[k]!)).add(texture(src, uv0().sub(step.mul(k))).mul(w[k]!));
      }
      bm.colorNode = acc;
      return new QuadMesh(bm);
    };
    this.blurH = blur(this.rtA.texture, new Vector2(1, 0));
    this.blurV = blur(this.rtB.texture, new Vector2(0, 1));
    const dm = new MeshBasicNodeMaterial();
    dm.side = BackSide;
    dm.transparent = true;
    dm.depthWrite = false;
    dm.fog = false;
    dm.blending = CustomBlending;
    dm.blendEquation = AddEquation;
    dm.blendSrc = OneFactor;
    dm.blendDst = OneMinusSrcAlphaFactor;
    dm.blendSrcAlpha = OneFactor;
    dm.blendDstAlpha = OneMinusSrcAlphaFactor;
    const shown: any = texture(this.rtA.texture, screenUV);
    dm.colorNode = shown.rgb;
    dm.opacityNode = shown.a;
    const mesh = new Mesh(new SphereGeometry(40000, 32, 16), dm);
    mesh.frustumCulled = false;
    mesh.renderOrder = -20;
    this.mesh = mesh;
  }

  /** Changes steps and resolution while the battle runs. The shader is not recompiled. */
  setQuality(quality: CloudQuality) {
    this.quality = quality;
    this.stepsU.value = Math.min(this.maxSteps, quality.steps);
    this.lightStepsU.value = Math.min(this.maxLightSteps, quality.lightSteps);
  }

  render(renderer: WebGPURenderer, camera: Camera) {
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x / this.quality.divisor));
    const h = Math.max(1, Math.floor(this.size.y / this.quality.divisor));
    if (this.rtA.width !== w || this.rtA.height !== h) {
      this.rtA.setSize(w, h);
      this.rtB.setSize(w, h);
      (this.texel.value as Vector2).set(1 / w, 1 / h);
    }
    this.marcher.position.copy(camera.position);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rtA);
    renderer.render(this.marchScene, camera);
    renderer.setRenderTarget(this.rtB);
    this.blurH.render(renderer);
    renderer.setRenderTarget(this.rtA);
    this.blurV.render(renderer);
    renderer.setRenderTarget(prev);
  }

  setEnvironment(env: Texture) {
    this.envNode.value = env;
  }

  /** Runs the march and both blur passes once, so their programs are built while the battle is still loading. */
  prewarm(renderer: WebGPURenderer, camera: Camera) {
    this.render(renderer, camera);
  }

  dispose() {
    for (const rt of [this.rtA, this.rtB]) rt.dispose();
    this.noise.dispose();
    this.marcher.geometry.dispose();
    (this.marcher.material as MeshBasicNodeMaterial).dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicNodeMaterial).dispose();
    for (const quad of [this.blurH, this.blurV]) (quad.material as MeshBasicNodeMaterial).dispose();
    this.mesh.removeFromParent();
  }

  update(camera: { x: number; y: number; z: number }, time: number) {
    this.mesh.position.set(camera.x, camera.y, camera.z);
    this.time.value = time;
  }
}
