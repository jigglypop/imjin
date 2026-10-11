import { AmbientLight, BufferGeometry, Color, DirectionalLight, Float32BufferAttribute, Mesh, MeshStandardNodeMaterial, OrthographicCamera, Scene, WebGPURenderer } from 'three/webgpu';
import { equipment, forceWebGL } from '../../game/quality';
import { tuneWebGLBackend } from '../../render/webglBackend';
import { disposeTree } from '../../render/dispose';
import { MAP_ASPECT } from './projection';
import { decodeRelief, reliefFrustum, RELIEF_EXAGGERATION, RELIEF_META, type ReliefPose, type ReliefView } from './reliefMath';

/** One small, demand-rendered scene. Its geometry, material and renderer all belong to this map mount. */
export class ReliefScene {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 8);
  readonly renderer: WebGPURenderer;
  heights: Float32Array | null = null;
  ready = false;
  private readonly abort = new AbortController();
  private disposed = false;
  private initialized = false;
  private rendererReleased = false;
  private frame = 0;
  private mesh: Mesh | null = null;
  private width = 0;
  private height = 0;
  private view: ReliefView = { s: 1, x: 0, y: 0 };
  private pose: ReliefPose = { tilt: 0, yaw: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGPURenderer({ canvas, antialias: equipment.select.antialias, powerPreference: 'low-power', forceWebGL });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, equipment.tier === 'low' ? 1.25 : 1.5));
    // Match the lit, horizontal sea so the finite elevation frame has no distracting rectangular border.
    this.scene.background = new Color('#233742');
    this.scene.add(new AmbientLight('#dce7ec', 0.95));
    const sun = new DirectionalLight('#fff1d7', 2.3);
    sun.position.set(-0.7, 1.6, -0.6);
    this.scene.add(sun);
    this.camera.up.set(0, 0, -1);
  }

  async init() {
    const signal = this.abort.signal;
    await this.renderer.init();
    this.initialized = true;
    if (this.disposed) this.releaseRenderer();
    signal.throwIfAborted();
    tuneWebGLBackend(this.renderer);
    const response = await fetch('/ui/grand_relief.bin', { signal });
    if (!response.ok) throw new Error(`Relief elevation HTTP ${response.status}`);
    const heights = decodeRelief(await response.arrayBuffer());
    signal.throwIfAborted();
    this.heights = heights;
    const { width, height } = RELIEF_META;
    const vertices = new Float32Array(width * height * 3);
    const colors = new Float32Array(vertices.length);
    const sea = new Color('#17394e'), shore = new Color('#497986'), low = new Color('#738879'), high = new Color('#abb19c');
    const color = new Color();
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
      const k = j * width + i, h = heights[k]!;
      vertices[k * 3] = i / (width - 1) - 0.5;
      vertices[k * 3 + 1] = h * RELIEF_EXAGGERATION / RELIEF_META.metersAcross;
      vertices[k * 3 + 2] = (j / (height - 1) - 0.5) / MAP_ASPECT;
      if (h < 3) color.copy(sea);
      else if (h < 40) color.copy(shore).lerp(low, h / 40);
      else color.copy(low).lerp(high, Math.min(1, (h - 40) / 1400));
      color.toArray(colors, k * 3);
    }
    const indices = [];
    for (let j = 0; j < height - 1; j++) for (let i = 0; i < width - 1; i++) {
      const a = j * width + i, b = a + 1, c = a + width, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    this.mesh = new Mesh(geometry, new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 }));
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.ready = true;
    this.invalidate();
    return heights;
  }

  update(view: ReliefView, pose: ReliefPose, width: number, height: number) {
    if (this.disposed) return;
    this.view = view;
    this.pose = pose;
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    }
    this.invalidate();
  }

  private invalidate() {
    if (!this.ready || this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.disposed || !this.mesh || this.width < 1 || this.height < 1) return;
      const bounds = reliefFrustum(this.view, this.width, this.height);
      Object.assign(this.camera, bounds);
      this.camera.position.set(0, Math.cos(this.pose.tilt) * 2, Math.sin(this.pose.tilt) * 2);
      this.camera.lookAt(0, 0, 0);
      this.camera.updateProjectionMatrix();
      this.mesh.rotation.y = this.pose.yaw;
      this.renderer.render(this.scene, this.camera);
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    this.abort.abort();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    disposeTree(this.scene);
    this.heights = null;
    if (this.initialized) this.releaseRenderer();
  }

  private releaseRenderer() {
    if (this.rendererReleased) return;
    this.rendererReleased = true;
    void this.renderer.dispose();
  }
}
