import {
  AdditiveBlending,
  ClampToEdgeWrapping,
  DoubleSide,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PlaneGeometry,
  QuadMesh,
  RenderTarget,
  Scene,
  Vector2,
  Vector3,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  cos,
  float,
  instancedBufferAttribute,
  length,
  positionGeometry,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec4,
} from 'three/tsl';
import type { Ship } from '../sim/types';

// One batched pass still serves the whole navy, including the uncapped fleets.
const MAX_STAMPS = 8192;

export class WakeMap {
  readonly resolution: number;
  extent = 3600;
  readonly center = uniform(new Vector2());
  readonly extentU = uniform(3600);
  private readonly targets: [RenderTarget, RenderTarget];
  private current = 0;
  private readonly fade = uniform(new Vector3(0.99, 0.995, 1));
  private readonly prevNode;
  private readonly quad: QuadMesh;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly a: InstancedBufferAttribute;
  private readonly b: InstancedBufferAttribute;
  private readonly mesh: Mesh;
  private count = 0;
  private readonly trails = new Map<number, { x: number; z: number; heading: number }>();
  private resetPending = true;
  private renderer: WebGPURenderer | null = null;
  /** The texture nodes that read the finished map, per ocean. A battle that is thrown away takes its own out. */
  private readonly sampleNodes = new Map<object, ReturnType<typeof texture>[]>();

  /** `resolution` is the square texture size. Smaller saves memory and fill rate, and makes wakes softer. */
  constructor(resolution = 2048) {
    this.resolution = resolution;
    const make = () => {
      const rt = new RenderTarget(this.resolution, this.resolution, { type: HalfFloatType, depthBuffer: false });
      rt.texture.minFilter = LinearFilter;
      rt.texture.magFilter = LinearFilter;
      rt.texture.wrapS = ClampToEdgeWrapping;
      rt.texture.wrapT = ClampToEdgeWrapping;
      rt.texture.generateMipmaps = false;
      return rt;
    };
    this.targets = [make(), make()];
    this.prevNode = texture(this.targets[0].texture, uv());
    const fadeMat = new MeshBasicNodeMaterial();
    fadeMat.colorNode = vec4(this.prevNode.rgb.mul(this.fade), 1);
    this.quad = new QuadMesh(fadeMat);

    const plane = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute('position', plane.getAttribute('position'));
    geo.setAttribute('uv', plane.getAttribute('uv'));
    this.a = new InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4), 4);
    this.b = new InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4), 4);
    geo.instanceCount = 0;
    const A: any = instancedBufferAttribute(this.a, 'vec4');
    const B: any = instancedBufferAttribute(this.b, 'vec4');
    const mat = new MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.blending = AdditiveBlending;
    mat.depthTest = false;
    mat.depthWrite = false;
    mat.side = DoubleSide;
    const local = positionGeometry.xy.mul(vec2(A.w.mul(B.y), A.w));
    const rot = A.z;
    const rotated = vec2(local.x.mul(cos(rot)).sub(local.y.mul(sin(rot))), local.x.mul(sin(rot)).add(local.y.mul(cos(rot))));
    const world = vec2(A.x, A.y).add(rotated);
    const clip = world.sub(this.center).div(this.extentU.mul(0.5));
    mat.vertexNode = vec4(clip.x, clip.y.negate(), 0, 1);
    const r = length(uv().mul(2).sub(1));
    const falloff = float(1).sub(smoothstep(0.15, 1.0, r));
    const foamOut: any = falloff.mul(B.x);
    const turbOut: any = falloff.mul(B.z);
    // Blue is the shade of the hulls over the water, stamped afresh every frame (the fade clears it).
    mat.colorNode = vec4(foamOut, turbOut, falloff.mul(B.w) as any, 1);
    this.mesh = new Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.extentU.value = this.extent;
  }

  sample(uvNode: Parameters<typeof texture>[1], owner: object) {
    const node = texture(this.targets[1].texture, uvNode);
    const list = this.sampleNodes.get(owner) ?? [];
    list.push(node);
    this.sampleNodes.set(owner, list);
    return node;
  }

  /**
   * Stops updating the nodes of an ocean that is gone. The nodes flip between the two targets every frame, and three only
   * unlinks a bind group from the target its node shows when the group dies. The other target keeps the dead group
   * (and with it the old battle's height texture), so the groups are taken out of both here.
   */
  release(owner: object) {
    const nodes = this.sampleNodes.get(owner);
    this.sampleNodes.delete(owner);
    const textures = (this.renderer as unknown as { _textures?: { get(t: unknown): { bindGroups?: Set<{ bindings: { textureNode?: unknown }[] }> } } } | null)?._textures;
    if (!nodes || !textures) return;
    for (const rt of this.targets) {
      const groups = textures.get(rt.texture).bindGroups;
      if (groups) for (const group of groups) if (group.bindings.some((b) => nodes.includes(b.textureNode as (typeof nodes)[number]))) groups.delete(group);
    }
  }

  /** Renders every pass once, so their programs are built before the first frame of the battle. */
  prewarm(renderer: WebGPURenderer) {
    this.stamp(this.center.value.x, this.center.value.y, 0, 1, 0, 1, 1);
    this.update(renderer, 1 / 60);
  }

  dispose() {
    this.trails.clear();
    for (const rt of this.targets) rt.dispose();
    (this.quad.material as MeshBasicNodeMaterial).dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicNodeMaterial).dispose();
  }

  setExtent(extent: number) {
    this.extent = extent;
    this.extentU.value = extent;
  }

  setCenter(x: number, z: number) {
    this.center.value.set(x, z);
    this.trails.clear();
    this.resetPending = true;
  }

  /** Losing sight of a hull must not join its last known position to an unseen journey. */
  forgetShip(id: number) {
    this.trails.delete(id);
  }

  /** Stamps along the travelled curve, so a turning fleet leaves distinct paths rather than isolated stern blobs. */
  shipWake(ship: Ship, dt: number) {
    const { id, x, z, spec } = ship;
    const fraction = Math.min(1.2, Math.abs(ship.speed) / spec.maxSpeed);
    if (dt <= 0) return;
    if (fraction <= 0.03) { this.forgetShip(id); return; }
    const heading = ship.heading + (ship.speed < 0 ? Math.PI : 0);
    const previous = this.trails.get(id);
    const travelled = previous ? Math.hypot(x - previous.x, z - previous.z) : 0;
    const continuous = previous && travelled <= Math.max(spec.beam * 6, Math.abs(ship.speed) * dt * 3 + 4);
    const steps = continuous ? Math.min(3, Math.max(1, Math.ceil(travelled / Math.max(2, spec.beam * 0.4)))) : 1;
    const deltaHeading = previous ? Math.atan2(Math.sin(heading - previous.heading), Math.cos(heading - previous.heading)) : 0;
    const intensity = fraction * dt * 60 / steps;
    for (let i = 1; i <= steps; i += 1) {
      const u = i / steps;
      const px = continuous ? previous.x + (x - previous.x) * u : x;
      const pz = continuous ? previous.z + (z - previous.z) * u : z;
      const h = continuous ? previous.heading + deltaHeading * u : heading;
      const c = Math.cos(h), n = Math.sin(h);
      const sternX = px - c * spec.length * 0.54, sternZ = pz - n * spec.length * 0.54;
      this.stamp(sternX, sternZ, h, spec.beam * 0.78, 0.014 * intensity, 2.8, 2.4);
      for (let side = -1; side <= 1; side += 2) {
        const aft = spec.length * 0.15, width = spec.beam * 0.8;
        this.stamp(sternX - c * aft - n * width * side, sternZ - n * aft + c * width * side, h - side * 0.36, spec.beam * 0.5, 0.008 * intensity, 3.4, 1.4);
      }
    }
    const c = Math.cos(heading), n = Math.sin(heading);
    const bowX = x + c * spec.length * 0.45, bowZ = z + n * spec.length * 0.45;
    const turn = Math.max(-0.3, Math.min(0.3, ship.turn * Math.abs(ship.speed) * 3));
    for (let side = -1; side <= 1; side += 2) {
      this.stamp(bowX - n * spec.beam * 0.43 * side, bowZ + c * spec.beam * 0.43 * side, heading - side * 0.58, spec.beam * 0.43, 0.014 * fraction * dt * 60 * (1 + side * turn), 2.5, 0.8);
    }
    // Every moving ship passes here every frame: its trail point is updated in place rather than made anew.
    if (previous) {
      previous.x = x;
      previous.z = z;
      previous.heading = heading;
    } else this.trails.set(id, { x, z, heading });
  }

  /**
   * The water a hull darkens this frame, in the blue channel: its footprint, which the sea shades as the hull's
   * reflection, ambient shadow and waterline, and a fainter copy pushed away from the sun for its shadow.
   * `sun` is the unit direction towards the sun.
   */
  shipShade(ship: Ship, sun: { x: number; y: number; z: number }) {
    const { x, z, heading, spec } = ship;
    const settle = ship.sinking > 0 ? Math.max(0, 1 - ship.sinking) : 1;
    if (settle <= 0) return;
    const width = spec.beam * 2;
    const stretch = (spec.length * 1.12) / width;
    this.stamp(x, z, heading, width, 0, stretch, 0, 1.6 * settle);
    const reach = Math.min(spec.beam * 0.9, (spec.beam * 0.3 * Math.hypot(sun.x, sun.z)) / Math.max(sun.y, 0.1));
    const h = Math.hypot(sun.x, sun.z) || 1;
    this.stamp(x - (sun.x / h) * reach, z - (sun.z / h) * reach, heading, width * 1.1, 0, stretch, 0, 0.5 * settle);
  }

  stamp(x: number, z: number, rot: number, size: number, intensity: number, stretch = 1, turbulence = 1, shade = 0) {
    if (this.count >= MAX_STAMPS) return;
    const o = this.count * 4;
    const A = this.a.array as Float32Array;
    const B = this.b.array as Float32Array;
    A[o] = x;
    A[o + 1] = z;
    A[o + 2] = rot;
    A[o + 3] = size;
    B[o] = intensity;
    B[o + 1] = stretch;
    B[o + 2] = turbulence * intensity;
    B[o + 3] = shade;
    this.count += 1;
  }

  update(renderer: WebGPURenderer, dt: number) {
    this.renderer = renderer;
    if (dt <= 0 && this.count === 0) return;
    const src = this.targets[this.current]!;
    const dst = this.targets[1 - this.current]!;
    if (this.resetPending) { this.fade.value.set(0, 0, 0); this.resetPending = false; }
    else this.fade.value.set(Math.exp(-dt / 8), Math.exp(-dt / 24), 0);
    this.prevNode.value = src.texture;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.setRenderTarget(dst);
    renderer.autoClear = true;
    this.quad.render(renderer);
    if (this.count > 0) {
      const geo = this.mesh.geometry as InstancedBufferGeometry;
      geo.instanceCount = this.count;
      for (const attr of [this.a, this.b]) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, this.count * 4);
        attr.needsUpdate = true;
      }
      renderer.autoClear = false;
      renderer.render(this.scene, this.camera);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    for (const list of this.sampleNodes.values()) for (const node of list) node.value = dst.texture;
    this.current = 1 - this.current;
    this.count = 0;
  }
}
