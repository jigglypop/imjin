import {
  AdditiveBlending,
  ClampToEdgeWrapping,
  DoubleSide,
  DynamicDrawUsage,
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
  instancedDynamicBufferAttribute,
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

const MAX_STAMPS = 2048;

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
    this.a.setUsage(DynamicDrawUsage);
    this.b.setUsage(DynamicDrawUsage);
    geo.instanceCount = 0;
    const A: any = instancedDynamicBufferAttribute(this.a, 'vec4');
    const B: any = instancedDynamicBufferAttribute(this.b, 'vec4');
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
    mat.colorNode = vec4(foamOut, turbOut, 0, 1);
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

  /** Stops updating the nodes of an ocean that is gone. */
  release(owner: object) {
    this.sampleNodes.delete(owner);
  }

  /** Renders every pass once, so their programs are built before the first frame of the battle. */
  prewarm(renderer: WebGPURenderer) {
    this.stamp(this.center.value.x, this.center.value.y, 0, 1, 0, 1, 1);
    this.update(renderer, 1 / 60);
  }

  dispose() {
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
  }

  stamp(x: number, z: number, rot: number, size: number, intensity: number, stretch = 1, turbulence = 1) {
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
    B[o + 3] = 0;
    this.count += 1;
  }

  update(renderer: WebGPURenderer, dt: number) {
    if (dt <= 0 && this.count === 0) return;
    const src = this.targets[this.current]!;
    const dst = this.targets[1 - this.current]!;
    this.fade.value.set(Math.exp(-dt / 7), Math.exp(-dt / 22), 1);
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
