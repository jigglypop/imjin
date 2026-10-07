import {
  AmbientLight,
  Box3,
  Color,
  DataTexture,
  DataUtils,
  DoubleSide,
  Group,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardMaterial,
  NoToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  RedFormat,
  RepeatWrapping,
  Scene,
  SpotLight,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  type Object3D,
  type WebGPURenderer,
} from 'three/webgpu';
import { abs, clamp, dot, float, fract, fwidth, length, max, mix, normalize, positionLocal, positionWorld, pow, sin, smoothstep, texture, uniform, uv, vec2, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import meta from './demMeta.json';
import type { ScenarioId } from '../sim/scenarios';

export const SITES: Record<ScenarioId, { lon: number; lat: number }> = {
  okpo: { lon: 128.69, lat: 34.89 },
  sacheon: { lon: 128.07, lat: 34.97 },
  dangpo: { lon: 128.39, lat: 34.79 },
  hansan: { lon: 128.48, lat: 34.79 },
  angolpo: { lon: 128.8, lat: 35.08 },
  busan: { lon: 129.05, lat: 35.1 },
  chilcheon: { lon: 128.62, lat: 34.98 },
  myeongnyang: { lon: 126.31, lat: 34.57 },
  noryang: { lon: 127.87, lat: 34.94 },
};

const MAP_W = 100;
const EXAGGERATION = 4.2;
const BUST_DEPTH = 2.4;

const lonToX = (lon: number) => ((lon + 180) / 360) * 2 ** meta.zoom;
const latToY = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** meta.zoom;
};

export function siteUV(id: ScenarioId) {
  const s = SITES[id];
  return { u: (lonToX(s.lon) - meta.x0) / (meta.x1 - meta.x0), v: (latToY(s.lat) - meta.y0) / (meta.y1 - meta.y0) };
}

async function loadHeights() {
  const img = await new TextureLoader().loadAsync('/ui/korea_dem.webp');
  const source = img.image as HTMLImageElement | ImageBitmap;
  const w = meta.width;
  const h = meta.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source as CanvasImageSource, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  const heights = new Float32Array(w * h);
  const half = new Uint16Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const v = px[i * 4]! * 256 + px[i * 4 + 1]! + px[i * 4 + 2]! / 256 - 32768;
    heights[i] = v;
    half[i] = DataUtils.toHalfFloat(v);
  }
  img.dispose();
  const tex = new DataTexture(half, w, h, RedFormat, HalfFloatType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  return { heights, tex };
}

type Side = 'left' | 'right';
type Bust = { side: Side; group: Group; height: number; yaw: number; phase: number; backdrop: Mesh; key: SpotLight; rim: SpotLight };
type CardRect = { left: number; top: number; width: number; height: number };

export class SelectScene {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  private heights: Float32Array | null = null;
  private readonly mapH = (MAP_W * meta.height) / meta.width;
  private readonly target = new Vector3();
  private readonly goal = new Vector3();
  private dist = 40;
  private goalDist = 40;
  private yaw = 0;
  private goalYaw = 0;
  private pitch = 0.86;
  private goalPitch = 0.86;
  private time = 0;
  private idle = 0;
  private readonly busts: Record<Side, Bust | null> = { left: null, right: null };
  private readonly visible: Record<Side, boolean> = { left: true, right: true };
  private readonly cards: Record<Side, CardRect | null> = { left: null, right: null };
  private viewport = { w: 1, h: 1 };
  private readonly rig = new Group();
  private readonly paperTone = uniform(new Vector3(0.904, 0.863, 0.776));
  private dom: HTMLElement | null = null;
  private drag: { button: number; x: number; y: number } | null = null;
  ready = false;

  constructor(private readonly renderer: WebGPURenderer, camera: PerspectiveCamera) {
    this.camera = camera;
    camera.fov = 34;
    camera.near = 0.05;
    camera.far = 600;
    camera.updateProjectionMatrix();
    this.scene.background = new Color('#efe9dc');
  }

  async init(initial: ScenarioId) {
    this.renderer.toneMapping = NoToneMapping;
    const { heights, tex } = await loadHeights();
    this.heights = heights;
    this.scene.add(this.buildMap(tex));
    this.scene.add(new AmbientLight(0xfff6ea, 0.16));
    this.camera.add(this.rig);
    this.scene.add(this.camera);
    this.focus(initial, true);
    this.attach(this.renderer.domElement);
    void this.loadBusts();
    this.ready = true;
  }

  private attach(dom: HTMLElement) {
    this.dom = dom;
    dom.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', this.onContext);
  }

  dispose() {
    const dom = this.dom;
    if (!dom) return;
    dom.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    dom.removeEventListener('wheel', this.onWheel);
    dom.removeEventListener('contextmenu', this.onContext);
  }

  private onContext = (e: Event) => e.preventDefault();

  private onDown = (e: PointerEvent) => {
    this.drag = { button: e.button === 2 || e.ctrlKey ? 2 : 0, x: e.clientX, y: e.clientY };
    this.idle = 0;
  };

  private onMove = (e: PointerEvent) => {
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    this.idle = 0;
    if (this.drag.button === 2) {
      this.goalYaw -= dx * 0.005;
      this.goalPitch = Math.max(0.32, Math.min(1.35, this.goalPitch + dy * 0.004));
      return;
    }
    const k = (this.dist / this.viewport.h) * 0.9;
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const mx = -dx * k;
    const mz = -dy * k / Math.max(0.35, Math.sin(this.pitch));
    this.goal.x = Math.max(-MAP_W / 2, Math.min(MAP_W / 2, this.goal.x + mx * c + mz * s));
    this.goal.z = Math.max(-this.mapH / 2, Math.min(this.mapH / 2, this.goal.z - mx * s + mz * c));
    this.goal.y = this.groundAt(this.goal.x, this.goal.z);
  };

  private onUp = () => {
    this.drag = null;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.idle = 0;
    this.goalDist = Math.max(10, Math.min(110, this.goalDist * Math.exp(e.deltaY * 0.0012)));
  };

  private buildMap(demTex: DataTexture) {
    const geo = new PlaneGeometry(MAP_W, this.mapH, 900, Math.round((900 * meta.height) / meta.width));
    geo.rotateX(-Math.PI / 2);
    const hanji = new TextureLoader().load('/ui/hanji_fiber.jpg');
    hanji.wrapS = RepeatWrapping;
    hanji.wrapT = RepeatWrapping;
    hanji.colorSpace = SRGBColorSpace;
    const vScale = (EXAGGERATION * MAP_W) / (meta.width * meta.metersPerPixel);
    const m = new MeshBasicNodeMaterial();
    const fUV = vec2(uv().x, float(1).sub(uv().y));
    const hV = texture(demTex, fUV).level(float(0)).r;
    m.positionNode = positionLocal.add(vec3(0, max(hV, 0).mul(vScale), 0));
    const texel = vec2(1 / meta.width, 1 / meta.height);
    const h = texture(demTex, fUV).r;
    const hx = texture(demTex, fUV.add(vec2(texel.x, 0))).r.sub(texture(demTex, fUV.sub(vec2(texel.x, 0))).r);
    const hz = texture(demTex, fUV.add(vec2(0, texel.y))).r.sub(texture(demTex, fUV.sub(vec2(0, texel.y))).r);
    const metersPerTexel = meta.metersPerPixel;
    const shadeK = float(EXAGGERATION * 0.55);
    const n = normalize(vec3(hx.mul(shadeK).negate().div(metersPerTexel * 2), 1, hz.mul(shadeK).negate().div(metersPerTexel * 2)));
    const L = normalize(vec3(-0.55, 0.62, -0.55));
    const lit = clamp(dot(n, L), 0, 1);
    const slope = float(1).sub(n.y);
    const paper = vec3(this.paperTone).mul(texture(hanji, positionWorld.xz.mul(0.045)).rgb.mul(0.16).add(0.86));
    const ink = vec3(0.13, 0.115, 0.1);
    const land = h.greaterThan(0);
    const heightWash = smoothstep(50, 1600, h).mul(0.3);
    const shade = pow(float(1).sub(lit), 1.4).mul(0.6).add(slope.mul(0.85)).add(heightWash).clamp(0, 0.82);
    const band = abs(fract(h.div(250)).sub(0.5));
    const contour = smoothstep(0.47, 0.5, band.add(fwidth(h.div(250)).mul(0.6))).mul(smoothstep(80, 200, h));
    const landColor = mix(paper, ink, shade.add(contour.mul(0.1)));
    const depth = h.negate().max(0);
    const seaWash = mix(vec3(0.94, 0.93, 0.89), vec3(0.76, 0.79, 0.8), smoothstep(0, 900, depth));
    const waves = sin(positionWorld.z.mul(5.2).add(sin(positionWorld.x.mul(0.9)).mul(1.4))).mul(0.5).add(0.5);
    const waveLines = smoothstep(0.94, 1, waves).mul(0.035).mul(float(1).sub(smoothstep(0, 400, depth)).add(0.35));
    const seaColor = paper.mul(seaWash.mul(1.02)).sub(waveLines);
    const coastW = fwidth(h).mul(1.3).add(2);
    const coast = float(1).sub(smoothstep(0, coastW, abs(h)));
    const surf = float(1).sub(smoothstep(0, 45, depth)).mul(land.select(float(0), float(1)));
    const base = land.select(landColor, mix(seaColor, ink, surf.mul(0.16)));
    const withCoast = mix(base, ink, coast.mul(0.85));
    const edge = smoothstep(0, 0.08, uv().x).mul(smoothstep(1, 0.92, uv().x)).mul(smoothstep(0, 0.1, uv().y)).mul(smoothstep(1, 0.9, uv().y));
    m.colorNode = mix(vec3(this.paperTone), withCoast, edge);
    const mesh = new Mesh(geo, m);
    mesh.frustumCulled = false;
    return mesh;
  }

  heightAtUV(u: number, v: number) {
    if (!this.heights) return 0;
    const x = Math.max(0, Math.min(meta.width - 1, Math.round(u * (meta.width - 1))));
    const y = Math.max(0, Math.min(meta.height - 1, Math.round(v * (meta.height - 1))));
    return this.heights[y * meta.width + x]!;
  }

  private groundAt(x: number, z: number) {
    const vScale = (EXAGGERATION * MAP_W) / (meta.width * meta.metersPerPixel);
    return Math.max(0, this.heightAtUV(x / MAP_W + 0.5, z / this.mapH + 0.5)) * vScale;
  }

  worldOf(id: ScenarioId, out = new Vector3()) {
    const { u, v } = siteUV(id);
    const x = (u - 0.5) * MAP_W;
    const z = (v - 0.5) * this.mapH;
    return out.set(x, this.groundAt(x, z), z);
  }

  focus(id: ScenarioId, instant = false) {
    this.worldOf(id, this.goal);
    this.goal.z -= 3.2;
    this.goalDist = Math.min(this.goalDist, 40);
    if (instant) {
      this.target.copy(this.goal);
      this.dist = this.goalDist;
    }
  }

  setCards(left: CardRect | null, right: CardRect | null, w: number, h: number) {
    this.cards.left = left;
    this.cards.right = right;
    this.viewport = { w, h };
  }

  setVisible(side: Side, visible: boolean) {
    this.visible[side] = visible;
    const b = this.busts[side];
    if (b) {
      b.group.visible = visible;
      b.backdrop.visible = visible;
    }
  }

  private makeBackdrop(side: Side) {
    const tex = new TextureLoader().load('/ui/ink_cloud.jpg');
    tex.colorSpace = SRGBColorSpace;
    const m = new MeshBasicNodeMaterial();
    m.transparent = true;
    m.depthWrite = false;
    m.side = DoubleSide;
    const p = uv().sub(0.5);
    const lum = texture(tex, uv().mul(vec2(0.9, 1)).add(side === 'left' ? vec2(0.05, 0) : vec2(0.02, 0.05))).r;
    const radial = float(1).sub(smoothstep(0.18, 0.5, length(p.mul(vec2(1.1, 0.85)))));
    m.colorNode = vec3(0.09, 0.08, 0.07);
    m.opacityNode = pow(float(1).sub(lum), 1.6).mul(radial).mul(0.92).clamp(0, 0.9);
    const mesh = new Mesh(new PlaneGeometry(1, 1), m);
    mesh.renderOrder = 5;
    return mesh;
  }

  private async loadBusts() {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const load = async (url: string, side: Side, yaw: number) => {
      try {
        const gltf = await loader.loadAsync(url);
        const root = gltf.scene as Object3D;
        root.rotation.y = yaw;
        root.updateMatrixWorld(true);
        const box = new Box3().setFromObject(root);
        const size = box.getSize(new Vector3());
        const center = box.getCenter(new Vector3());
        const inner = new Group();
        root.position.sub(center);
        inner.add(root);
        inner.scale.setScalar(1 / size.y);
        root.traverse((o) => {
          const mesh = o as Mesh;
          if (!mesh.isMesh) return;
          const mat = mesh.material as MeshStandardMaterial;
          if (mat && 'roughness' in mat) {
            mat.roughness = Math.min(1, mat.roughness * 0.92);
            mat.envMapIntensity = 0.5;
          }
          mesh.renderOrder = 6;
        });
        const group = new Group();
        group.add(inner);
        const backdrop = this.makeBackdrop(side);
        const warm = side === 'left' ? 0xffe3c0 : 0xf2ead8;
        const key = new SpotLight(warm, 16, 9, 0.62, 0.55, 1.4);
        const rim = new SpotLight(side === 'left' ? 0xc9d8ff : 0xffd2a8, 38, 9, 0.55, 0.7, 1.4);
        key.target = group;
        rim.target = group;
        this.rig.add(backdrop, group, key, rim);
        const bust: Bust = { side, group, height: 1, yaw: side === 'left' ? 0.32 : -0.32, phase: side === 'left' ? 0 : 1.7, backdrop, key, rim };
        group.visible = this.visible[side];
        backdrop.visible = this.visible[side];
        this.busts[side] = bust;
      } catch {
        this.busts[side] = null;
      }
    };
    await Promise.all([load('/models/busts/yi.glb', 'left', 0), load('/models/busts/daimyo.glb', 'right', -Math.PI / 2)]);
  }

  private layoutBust(b: Bust) {
    const rect = this.cards[b.side];
    if (!rect) return;
    const { w, h } = this.viewport;
    const hh = Math.tan((this.camera.fov * Math.PI) / 360) * BUST_DEPTH;
    const hw = hh * this.camera.aspect;
    const toX = (px: number) => ((px / w) * 2 - 1) * hw;
    const toY = (py: number) => (1 - (py / h) * 2) * hh;
    const cx = toX(rect.left + rect.width / 2);
    const top = toY(rect.top);
    const bottom = toY(rect.top + rect.height);
    const cardH = top - bottom;
    const scale = cardH * 1.02;
    const breathe = Math.sin(this.time * 1.2 + b.phase) * 0.004 * scale;
    b.group.scale.setScalar(scale);
    b.group.position.set(cx + (b.side === 'left' ? 0.03 : -0.03) * scale, top - scale * 0.5 - cardH * 0.04 + breathe, -BUST_DEPTH);
    b.group.rotation.y = b.yaw + Math.sin(this.time * 0.3 + b.phase) * 0.04;
    b.backdrop.scale.set(cardH * 1.35, cardH * 1.25, 1);
    b.backdrop.position.set(cx, top - cardH * 0.42, -BUST_DEPTH - 0.6);
    const sign = b.side === 'left' ? 1 : -1;
    b.key.position.set(cx + sign * cardH * 0.9, top + cardH * 0.25, -BUST_DEPTH + cardH * 1.4);
    b.rim.position.set(cx - sign * cardH * 0.85, top + cardH * 0.1, -BUST_DEPTH - cardH * 1.1);
  }

  update(dt: number) {
    this.time += dt;
    this.idle += dt;
    const k = 1 - Math.exp(-dt * 2.4);
    this.target.lerp(this.goal, k);
    this.dist += (this.goalDist - this.dist) * k;
    this.yaw += (this.goalYaw - this.yaw) * k;
    this.pitch += (this.goalPitch - this.pitch) * k;
    const drift = this.idle > 6 ? Math.sin(this.time * 0.05) * 0.04 : 0;
    const yaw = this.yaw + drift;
    const cx = this.target.x + Math.sin(yaw) * Math.cos(this.pitch) * this.dist;
    const cz = this.target.z + Math.cos(yaw) * Math.cos(this.pitch) * this.dist;
    const cy = this.target.y + Math.sin(this.pitch) * this.dist;
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.target);
    for (const b of [this.busts.left, this.busts.right]) if (b) this.layoutBust(b);
  }

  project(id: ScenarioId, width: number, height: number, out: Vector2) {
    const p = this.worldOf(id).project(this.camera);
    out.set((p.x * 0.5 + 0.5) * width, (-p.y * 0.5 + 0.5) * height);
    return p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
