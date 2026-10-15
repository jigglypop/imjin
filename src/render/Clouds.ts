import {
  BackSide,
  CustomBlending,
  AddEquation,
  HalfFloatType,
  LinearFilter,
  Matrix4,
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
  type DataTexture,
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
  fract,
  interleavedGradientNoise,
  max,
  min,
  mix,
  normalize,
  positionWorld,
  pow,
  screenCoordinate,
  screenUV,
  select,
  smoothstep,
  texture,
  texture3D,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { atmosphere } from './atmosphere';
import { cloudNoise, weatherMap, WEATHER_SPAN } from './cloudNoise';
import type { CloudSpec } from './sky';
import type { SkyView } from './skyDome';

/** Farthest a ray looks for cloud, and most of the layer one ray crosses, in metres. Beyond, the haze has the sky. */
const MAX_DISTANCE = 60000;
const MAX_SPAN = 16000;
/** Loop bounds are fixed when the shader compiles. Steps below the run-time count are used, the rest are skipped. */
const MAX_STEPS = 64;
const MAX_LIGHT_STEPS = 4;
/** Distance the light march covers toward the sun. */
const LIGHT_SPAN = 900;
/** Share of each new frame in the accumulated clouds: the rest is the reprojected history, so jittered steps average out. */
const BLEND = 0.18;

// Typed loosely: the TSL node types do not accept uniform nodes as operands of float arithmetic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

/** What the shader is built for when the levels that can run never need the most: a smaller program for the driver to build. */
export type CloudLimits = { steps: number; lightSteps: number };

export type CloudQuality = { steps: number; lightSteps: number; divisor: number; every: number };

const rotation = new Matrix4();

/** A rotation-only view-projection: clouds are far enough that only the camera's turning moves them on screen. */
function rotationProjection(camera: Camera, out: Matrix4) {
  rotation.copy(camera.matrixWorldInverse).setPosition(0, 0, 0);
  return out.multiplyMatrices(camera.projectionMatrix, rotation);
}

export class Clouds {
  readonly mesh: Mesh;
  private readonly marcher: Mesh;
  private readonly marchScene = new Scene();
  /** The newest accumulated clouds, and the copy of it the next frame reads as history. */
  private readonly current = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private readonly history = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private readonly copy: QuadMesh;
  private readonly size = new Vector2();
  private readonly stepsU: Node;
  private readonly lightStepsU: Node;
  /** Projection of the frame the history was made in, and of the last march, which the composite reprojects with. */
  private readonly previousVP = uniform(new Matrix4());
  private readonly marchedVP = uniform(new Matrix4());
  private readonly blend = uniform(1);
  private readonly frameU = uniform(0);
  private quality: CloudQuality;
  private frames = 0;
  private historyValid = false;
  readonly time = uniform(0);
  readonly coverage = uniform(0.5);
  readonly base = uniform(1300);
  readonly top = uniform(3500);
  readonly density = uniform(0.03);
  private readonly noise: Data3DTexture;
  private readonly weather: DataTexture;
  private readonly maxSteps: number;
  private readonly maxLightSteps: number;

  constructor(sky: SkyView, quality: CloudQuality, limits: CloudLimits = { steps: MAX_STEPS, lightSteps: MAX_LIGHT_STEPS }) {
    this.quality = quality;
    this.maxSteps = Math.min(MAX_STEPS, limits.steps);
    this.maxLightSteps = Math.min(MAX_LIGHT_STEPS, limits.lightSteps);
    const maxSteps = this.maxSteps;
    const maxLightSteps = this.maxLightSteps;
    this.stepsU = uniform(Math.min(maxSteps, quality.steps));
    this.lightStepsU = uniform(Math.min(maxLightSteps, quality.lightSteps));
    const stepsU = this.stepsU;
    const lightStepsU = this.lightStepsU;
    this.noise = cloudNoise();
    this.weather = weatherMap();
    const noise = this.noise;
    const weather = this.weather;
    for (const rt of [this.current, this.history]) {
      rt.texture.minFilter = LinearFilter;
      rt.texture.magFilter = LinearFilter;
      rt.texture.generateMipmaps = false;
    }

    const base = this.base;
    const top = this.top;
    const thick = top.sub(base);
    const t = this.time;
    const drift = vec3(atmosphere.cloudDrift.x, 0, atmosphere.cloudDrift.y);
    // Decks (high cover) keep their tops level; scattered clouds pile up into rounded heads over flat bases.
    const deck = smoothstep(0.6, 0.9, this.coverage);
    // As coverAt in cloudNoise.ts: scattered clouds swing between gaps and masses, a deck only thins.
    const spread = float(1.1).sub(deck.mul(0.6));
    const shape = (p: Node, detail: boolean, far: Node) => {
      const h = p.y.sub(base).div(thick);
      const w = texture(weather, p.xz.sub(drift.xz).div(WEATHER_SPAN)).level(float(0));
      const cover = clamp(this.coverage.add(w.r.sub(0.5).mul(spread)), 0, 1);
      const crown = mix(mix(0.5, 1, w.g), float(0.95), deck);
      const profile = smoothstep(0, 0.07, h).mul(smoothstep(crown, crown.mul(mix(0.35, 0.75, deck)), h));
      const q = p.sub(drift);
      const lump = texture3D(noise, q.div(8500)).r;
      const body = clamp(lump.mul(profile).sub(float(1).sub(cover)).div(max(cover, 0.08)), 0, 1);
      if (!detail) return body;
      const fine = texture3D(noise, q.mul(1 / 1400).add(vec3(0, t.mul(0.004), 0)));
      const erosion = fine.g.mul(0.625).add(fine.b.mul(0.375));
      // The edges fray into wisps; deep inside the body the detail barely matters.
      return clamp(body.sub(erosion.mul(mix(float(0.42), float(0.12), far)).mul(float(1).sub(body))), 0, 1);
    };

    const m = new MeshBasicNodeMaterial();
    m.side = BackSide;
    m.transparent = false;
    m.blending = NoBlending;
    m.depthWrite = false;
    m.depthTest = false;
    m.fog = false;
    const dir = normalize(positionWorld.sub(cameraPosition));
    const sun = atmosphere.sunDir;
    m.colorNode = Fn(() => {
      const up = dir.y;
      const marched = vec4(0, 0, 0, 0).toVar();
      If(up.greaterThan(0.003), () => {
        const camY = cameraPosition.y;
        // A camera inside the layer starts a kilometre out, and one above it sees none: the battle below stays clear.
        const t0 = max(base.sub(camY).div(up), 1000);
        const t1 = min(min(top.sub(camY).div(up), MAX_DISTANCE), t0.add(MAX_SPAN));
        const span = max(t1.sub(t0), 0);
        const stepLen = span.div(stepsU);
        // A different step offset every frame (golden-ratio sequence over interleaved gradient noise): the history
        // blend turns the banding of a few dozen steps into a smooth integral.
        const jitter = fract(interleavedGradientNoise(screenCoordinate).add(this.frameU.mul(0.618034)));
        const trans = float(1).toVar();
        const light = vec3(0).toVar();
        const depth = float(0).toVar();
        const cosA = dot(dir, sun);
        const hg = (g: number) => float(1 - g * g).div(pow(float(1 + g * g).sub(cosA.mul(2 * g)), 1.5)).mul(1 / (4 * Math.PI));
        // Forward glow of the silver lining with some light thrown back toward the sun.
        const phase = mix(hg(-0.2), hg(0.72), 0.72);
        const soft = mix(float(1 / (4 * Math.PI)), hg(0.45), 0.6);
        const sunLight = atmosphere.sunIrradiance;
        const zenith = vec3(sky.at(vec3(0, 1, 0))).mul(atmosphere.envIntensity);
        const ambientTop = max(zenith.mul(2.2), atmosphere.skyAmbient.mul(1.1));
        // Under a deck the underside is what the sky's average is made of; a lone cloud's base sees the darker sea.
        const ambientBase = atmosphere.skyAmbient.mul(mix(float(0.55), float(1), deck));
        const lightStep = float(LIGHT_SPAN).div(lightStepsU.mul(lightStepsU));
        Loop(maxSteps, ({ i }) => {
          If(trans.greaterThan(0.01).and(float(i).lessThan(stepsU)), () => {
            const tt = t0.add(float(i).add(jitter).mul(stepLen));
            const p = cameraPosition.add(dir.mul(tt));
            const far = smoothstep(8000, 30000, tt);
            const d = shape(p, true, far);
            If(d.greaterThan(0.002), () => {
              // Optical depth toward the sun over steps that lengthen with distance.
              const od = float(0).toVar();
              Loop(maxLightSteps, ({ i: k }) => {
                If(float(k).lessThan(lightStepsU), () => {
                  const a = float(k).add(0.5);
                  const lp = p.add(sun.mul(a.mul(a).mul(lightStep)));
                  od.addAssign(shape(lp, false, far).mul(a.mul(2).mul(lightStep)));
                });
              });
              const tau = od.mul(this.density);
              // Beer's law plus two weaker, wider octaves for the light scattered many times inside the cloud.
              const once = exp(tau.negate()).mul(phase);
              const many = exp(tau.mul(-0.25)).mul(0.55).add(exp(tau.mul(-0.07)).mul(0.3)).mul(soft);
              const powder = float(1).sub(exp(d.mul(this.density).mul(-260)));
              const h = clamp(p.y.sub(base).div(thick), 0, 1);
              const direct = sunLight.mul(once.add(many.mul(powder.mul(0.6).add(0.4)))).mul(3.2);
              const ambient = mix(ambientBase, ambientTop, h);
              const sigma = d.mul(this.density);
              const stepT = exp(sigma.mul(stepLen).negate());
              const weight = trans.mul(float(1).sub(stepT));
              light.addAssign(weight.mul(direct.add(ambient)));
              depth.addAssign(weight.mul(tt));
              trans.mulAssign(stepT);
            });
          });
        });
        const alpha = float(1).sub(trans);
        const distance = depth.div(max(alpha, 0.0001));
        // The air between the eye and the cloud: far clouds sink into the haze of the sky behind them.
        const air = exp(distance.mul(atmosphere.fogDensity).mul(-0.42));
        const behind = vec3(sky.at(dir)).mul(atmosphere.envIntensity);
        const seen = mix(behind.mul(alpha), light, air);
        // Fading in from the horizon hides the layer's flat edge, and from below its base when the camera climbs into it.
        const fade = smoothstep(0.003, 0.03, up).mul(float(1).sub(smoothstep(base.sub(200), top, camY)));
        marched.assign(vec4(seen.mul(fade), alpha.mul(fade)));
      });
      // Blend with the history where this direction was on screen last frame.
      const clip = this.previousVP.mul(vec4(dir, 0));
      const ndc = clip.xy.div(max(clip.w, 1e-5));
      const uv = vec2(ndc.x.mul(0.5).add(0.5), ndc.y.mul(-0.5).add(0.5));
      const inside = clip.w.greaterThan(0).and(uv.x.greaterThan(0)).and(uv.x.lessThan(1)).and(uv.y.greaterThan(0)).and(uv.y.lessThan(1));
      const past = texture(this.history.texture, uv);
      return mix(past, marched, select(inside, this.blend, float(1)));
    })();
    m.opacityNode = null;
    const marcher = new Mesh(new SphereGeometry(40000, 48, 24), m);
    marcher.frustumCulled = false;
    this.marcher = marcher;
    this.marchScene.add(marcher);

    const cm = new MeshBasicNodeMaterial();
    cm.blending = NoBlending;
    cm.depthTest = false;
    cm.depthWrite = false;
    cm.colorNode = texture(this.current.texture, screenUV);
    this.copy = new QuadMesh(cm);

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
    // Read where the direction was on screen at the last march: between marches the clouds stay on the sky, not on the glass.
    const view = normalize(positionWorld.sub(cameraPosition));
    const clip = this.marchedVP.mul(vec4(view, 0));
    const ndc = clip.xy.div(max(clip.w, 1e-5));
    const shown: Node = texture(this.history.texture, vec2(ndc.x.mul(0.5).add(0.5), ndc.y.mul(-0.5).add(0.5)));
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

  /** The layer of the battle's sky. A new layer starts its accumulation afresh. */
  setLayer(spec: CloudSpec) {
    this.coverage.value = spec.coverage;
    this.base.value = spec.base;
    this.top.value = spec.top;
    this.density.value = spec.density;
    this.historyValid = false;
  }

  render(renderer: WebGPURenderer, camera: Camera) {
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x / this.quality.divisor));
    const h = Math.max(1, Math.floor(this.size.y / this.quality.divisor));
    if (this.current.width !== w || this.current.height !== h) {
      this.current.setSize(w, h);
      this.history.setSize(w, h);
      this.historyValid = false;
    }
    this.marcher.position.copy(camera.position);
    this.marcher.updateMatrixWorld();
    this.blend.value = this.historyValid ? BLEND : 1;
    this.frameU.value = this.frames % 64;
    this.frames += 1;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.current);
    renderer.render(this.marchScene, camera);
    renderer.setRenderTarget(this.history);
    this.copy.render(renderer);
    renderer.setRenderTarget(prev);
    rotationProjection(camera, this.marchedVP.value as Matrix4);
    (this.previousVP.value as Matrix4).copy(this.marchedVP.value as Matrix4);
    this.historyValid = true;
  }

  /** Runs the march and the copy once, so their programs are built while the battle is still loading. */
  prewarm(renderer: WebGPURenderer, camera: Camera) {
    this.render(renderer, camera);
    this.historyValid = false;
  }

  dispose() {
    for (const rt of [this.current, this.history]) rt.dispose();
    this.marcher.geometry.dispose();
    (this.marcher.material as MeshBasicNodeMaterial).dispose();
    (this.copy.material as MeshBasicNodeMaterial).dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicNodeMaterial).dispose();
    this.mesh.removeFromParent();
  }

  /** `time` is battle time: the wind carries the layer (atmosphere.cloudDrift, set by the engine) and the wisps evolve with it. */
  update(camera: { x: number; y: number; z: number }, time: number) {
    this.mesh.position.set(camera.x, camera.y, camera.z);
    this.time.value = time;
  }
}
