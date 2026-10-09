import {
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  DataUtils,
  DoubleSide,
  Group,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  NoToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  RedFormat,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  type WebGPURenderer,
} from 'three/webgpu';
import { abs, clamp, cos, dot, float, fract, fwidth, max, mix, normalize, positionLocal, positionWorld, sin, smoothstep, texture, uniform, uv, vec2, vec3 } from 'three/tsl';
import meta from './demMeta.json';
import { SCENARIOS, type ScenarioId } from '../sim/scenarios';
import { playableFactions } from '../sim/balance';
import type { Faction } from '../sim/types';

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
/** The fog the map fades into at its edge; the screen's CSS veil (.hs-vignette) uses the same colour. */
const MIST_HEX = '#e9f0f6';
const EXAGGERATION = 4.2;

/** A colour written in sRGB, as the node graph works in linear light. */
const srgb = (r: number, g: number, b: number) => vec3(...[r, g, b].map((v) => (v / 255) ** 2.2) as [number, number, number]);
const MIST = srgb(233, 240, 246);

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

// War-table flags for the sides of the selected battle, pinned into the map around the site: Joseon and Ming to the
// west, where their fleets sailed from, Japan to the east. The side the player leads stands taller. Sizes are in
// map units (one unit is about 3.3 km).
const FLAG_AT: Record<Faction, { dx: number; dz: number; size: number; lean: number }> = {
  joseon: { dx: -1.4, dz: 0.5, size: 0.95, lean: 0.3 },
  ming: { dx: -2.4, dz: -0.5, size: 0.9, lean: 0.25 },
  japan: { dx: 1.5, dz: -0.2, size: 0.62, lean: -0.3 },
};
const PLAYER_FLAG = 1.3;

/** Banner text: Yi's command flag reads 帥, other commanders fly their name. */
function flagText(id: ScenarioId, faction: Faction) {
  const s = SCENARIOS[id];
  if (faction === 'joseon') return s.joseon.figure === 'fig_yi' ? '帥' : s.joseon.banner;
  if (faction === 'ming') return s.ming?.banner ?? '明';
  return s.japan.banner;
}

type Flag = {
  faction: Faction;
  group: Group;
  canvas: HTMLCanvasElement;
  tex: CanvasTexture;
  text: string;
  /** Height of the group origin above the foot of the pole, at scale 1. */
  base: number;
  pos: Vector3;
  goal: Vector3;
  scale: number;
  goalScale: number;
};

/** The menu is a 3D map with scenario markers. The camera drifts around the selected site. */
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
  private readonly clock = uniform(0);
  private readonly flags: Flag[] = [];
  private forces: { id: ScenarioId; player: Faction } | null = null;
  private flagsPlaced = false;
  private dom: HTMLElement | null = null;
  private drag: { button: number; x: number; y: number } | null = null;
  ready = false;

  constructor(
    private readonly renderer: WebGPURenderer,
    camera: PerspectiveCamera,
    private readonly segments = 900,
  ) {
    this.camera = camera;
    camera.fov = 34;
    camera.near = 0.05;
    camera.far = 600;
    camera.updateProjectionMatrix();
    this.scene.background = new Color(MIST_HEX);
  }

  async init(initial: ScenarioId) {
    this.renderer.toneMapping = NoToneMapping;
    const { heights, tex } = await loadHeights();
    this.heights = heights;
    this.scene.add(this.buildMap(tex));
    for (const faction of ['joseon', 'ming', 'japan'] as Faction[]) {
      const flag = this.makeFlag(faction);
      this.flags.push(flag);
      this.scene.add(flag.group);
    }
    if (this.forces) this.setForces(this.forces.id, this.forces.player);
    this.focus(initial, true);
    this.attach(this.renderer.domElement);
    this.ready = true;
  }

  private attach(dom: HTMLElement) {
    this.dom = dom;
    dom.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', this.onContext);
  }

  dispose() {
    const dom = this.dom;
    if (!dom) return;
    dom.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    dom.removeEventListener('wheel', this.onWheel);
    dom.removeEventListener('contextmenu', this.onContext);
  }

  private onContext = (e: Event) => e.preventDefault();

  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;

  private spread() {
    const [a, b] = [...this.touches.values()] as [{ x: number; y: number }, { x: number; y: number }];
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  private onDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.idle = 0;
      if (this.touches.size === 2) {
        // Two fingers: pinch to zoom instead of dragging.
        this.drag = null;
        this.pinchDist = this.spread();
      } else {
        this.drag = { button: 0, x: e.clientX, y: e.clientY };
      }
      return;
    }
    this.drag = { button: e.button === 2 || e.ctrlKey ? 2 : 0, x: e.clientX, y: e.clientY };
    this.idle = 0;
  };

  private onMove = (e: PointerEvent) => {
    const touch = this.touches.get(e.pointerId);
    if (touch) {
      touch.x = e.clientX;
      touch.y = e.clientY;
      if (this.touches.size >= 2) {
        const d = this.spread();
        if (this.pinchDist > 1 && d > 1) this.goalDist = Math.max(10, Math.min(110, this.goalDist * (this.pinchDist / d)));
        this.pinchDist = d;
        this.idle = 0;
        return;
      }
    }
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
    const k = (this.dist / this.viewportHeight()) * 0.9;
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const mx = -dx * k;
    const mz = (-dy * k) / Math.max(0.35, Math.sin(this.pitch));
    this.goal.x = Math.max(-MAP_W / 2, Math.min(MAP_W / 2, this.goal.x + mx * c + mz * s));
    this.goal.z = Math.max(-this.mapH / 2, Math.min(this.mapH / 2, this.goal.z - mx * s + mz * c));
    this.goal.y = this.groundAt(this.goal.x, this.goal.z);
  };

  private onUp = (e: PointerEvent) => {
    this.touches.delete(e.pointerId);
    // After a pinch, the remaining finger does not resume dragging until it lands again. That avoids a jump.
    this.drag = null;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.idle = 0;
    this.goalDist = Math.max(10, Math.min(110, this.goalDist * Math.exp(e.deltaY * 0.0012)));
  };

  private viewportHeight() {
    return this.dom?.clientHeight || 1;
  }

  private buildMap(demTex: DataTexture) {
    const segments = this.segments;
    const geo = new PlaneGeometry(MAP_W, this.mapH, segments, Math.round((segments * meta.height) / meta.width));
    geo.rotateX(-Math.PI / 2);
    const vScale = (EXAGGERATION * MAP_W) / (meta.width * meta.metersPerPixel);
    const m = new MeshBasicNodeMaterial();
    const fUV = vec2(uv().x, float(1).sub(uv().y));
    const hV = texture(demTex, fUV).level(float(0)).r;
    // The relief settles to flat sea at the map's border, so no land stands cut off against the mist there.
    const rim = smoothstep(0, 0.07, uv().x).mul(smoothstep(1, 0.93, uv().x)).mul(smoothstep(0, 0.09, uv().y)).mul(smoothstep(1, 0.91, uv().y));
    m.positionNode = positionLocal.add(vec3(0, max(hV, 0).mul(vScale).mul(rim), 0));
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
    // A pale misty map in the same palette as the campaign map (scripts/build-grand-map.mjs) and the phone map
    // (scripts/build-ui-map.mjs): stone-white land with soft relief, a pale blue-grey sea lighter on the shelf, a hairline coast.
    const land = h.greaterThan(0);
    const hi = smoothstep(0, 900, h).mul(0.6);
    const lum = clamp(float(0.86).add(lit.sub(0.62).mul(1.5)).sub(slope.mul(0.55)), 0.35, 1.04);
    const stone = mix(srgb(247, 245, 239), srgb(222, 226, 226), hi);
    const shadowTint = srgb(140, 158, 176);
    const band = abs(fract(h.div(250)).sub(0.5));
    const contour = smoothstep(0.47, 0.5, band.add(fwidth(h.div(250)).mul(0.6))).mul(smoothstep(80, 200, h)).mul(0.1);
    const landColor = mix(mix(shadowTint, stone, lum), srgb(170, 186, 201), contour);
    const depth = h.negate().max(0);
    const seaShelf = mix(srgb(204, 221, 236), srgb(172, 194, 214), smoothstep(0, 80, depth));
    const seaShadow = float(1).sub(smoothstep(0, 14, depth)).mul(0.1);
    const waves = sin(positionWorld.z.mul(5.2).add(sin(positionWorld.x.mul(0.9)).mul(1.4))).mul(0.5).add(0.5);
    const waveLines = smoothstep(0.94, 1, waves).mul(0.03).mul(smoothstep(30, 400, depth));
    const seaColor = seaShelf.mul(float(1).sub(seaShadow).sub(waveLines));
    const coastW = fwidth(h).mul(1.3).add(2);
    const coast = float(1).sub(smoothstep(0, coastW, abs(h)));
    const base = land.select(landColor, seaColor);
    const withCoast = mix(base, srgb(140, 160, 180), coast.mul(0.6));
    const edge = smoothstep(0, 0.08, uv().x).mul(smoothstep(1, 0.92, uv().x)).mul(smoothstep(0, 0.1, uv().y)).mul(smoothstep(1, 0.9, uv().y));
    m.colorNode = mix(MIST, withCoast, edge);
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
    this.goalYaw = 0;
    // Aim south of the site so it sits in the upper half of the screen, above the brief card.
    this.goal.z += 2.4;
    this.goalDist = Math.min(this.goalDist, 40);
    if (instant) {
      this.target.copy(this.goal);
      this.dist = this.goalDist;
    }
  }

  /** Plants the flags of the battle's sides around its site. The flags glide over when the battle changes. */
  setForces(id: ScenarioId, player: Faction) {
    this.forces = { id, player };
    if (!this.heights || !this.flags.length) return;
    const site = this.worldOf(id);
    const sides = playableFactions(id);
    for (const f of this.flags) {
      const at = FLAG_AT[f.faction];
      f.goal.set(site.x + at.dx, 0, site.z + at.dz);
      f.goalScale = sides.includes(f.faction) ? at.size * (f.faction === player ? PLAYER_FLAG : 1) : 0;
      if (!this.flagsPlaced) {
        f.pos.copy(f.goal);
        f.scale = f.goalScale;
      }
      const text = flagText(id, f.faction);
      if (text !== f.text) {
        f.text = text;
        this.paintFlag(f.canvas, f.faction, text);
        f.tex.needsUpdate = true;
      }
    }
    this.flagsPlaced = true;
  }

  private paintFlag(canvas: HTMLCanvasElement, faction: Faction, text: string) {
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (faction === 'japan') {
      // Nobori: a tall white banner with a crest and the commander's name down the middle.
      ctx.fillStyle = '#d2453d';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f5f8fc';
      ctx.fillRect(0, 0, w, 26);
      const cx = w / 2;
      const cy = w * 0.62;
      const r = w * 0.3;
      ctx.lineWidth = 16;
      ctx.strokeStyle = '#f5f8fc';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      for (let k = 0; k < 3; k += 1) {
        const a = (k / 3) * Math.PI * 2 - Math.PI / 2;
        const tx = cx + Math.cos(a) * r * 0.42;
        const ty = cy + Math.sin(a) * r * 0.42;
        ctx.beginPath();
        ctx.arc(tx, ty, r * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(tx + Math.cos(a + 1.6) * r * 0.3, ty + Math.sin(a + 1.6) * r * 0.3);
        ctx.quadraticCurveTo(cx + Math.cos(a + 1.2) * r * 0.85, cy + Math.sin(a + 1.2) * r * 0.85, cx + Math.cos(a + 2.1) * r * 0.62, cy + Math.sin(a + 2.1) * r * 0.62);
        ctx.lineTo(tx + Math.cos(a - 0.3) * r * 0.2, ty + Math.sin(a - 0.3) * r * 0.2);
        ctx.fill();
      }
      ctx.font = '700 190px "Noto Serif KR", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      [...text].forEach((ch, i) => ctx.fillText(ch, cx, w * 1.25 + i * 210));
      return;
    }
    // Joseon: a hemp-coloured command flag with a red flame border. Ming: a red flag with a gold border and seal.
    const ming = faction === 'ming';
    ctx.fillStyle = ming ? '#e2a53b' : '#3a86d6';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = ming ? '#fff1cf' : '#f5f8fc';
    const tooth = 34;
    for (let x = 0; x < w; x += tooth) {
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + tooth / 2, h - 40);
      ctx.lineTo(x + tooth, h);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + tooth / 2, 34);
      ctx.lineTo(x + tooth, 0);
      ctx.fill();
    }
    for (let y = 0; y < h; y += tooth) {
      ctx.beginPath();
      ctx.moveTo(w, y);
      ctx.lineTo(w - 40, y + tooth / 2);
      ctx.lineTo(w, y + tooth);
      ctx.fill();
    }
    if (ming) {
      ctx.fillStyle = '#fff1cf';
      ctx.beginPath();
      ctx.arc(w * 0.47, h * 0.5, w * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = ming ? '#2b1c00' : '#ffffff';
    ctx.font = `700 ${ming ? 230 : 300}px "Noto Serif KR", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w * 0.47, h * 0.5);
  }

  private makeFlag(faction: Faction): Flag {
    const tall = faction === 'japan';
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = tall ? 1300 : 600;
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 8;
    const flag: Flag = { faction, group: new Group(), canvas, tex, text: '', base: 0, pos: new Vector3(), goal: new Vector3(), scale: 0, goalScale: 0 };
    void document.fonts.load('700 200px "Noto Serif KR"').then(() => {
      if (!flag.text) return;
      this.paintFlag(canvas, faction, flag.text);
      tex.needsUpdate = true;
    });
    // The cloth hangs from the pole: to the left for the square flags, to the right for the nobori.
    const aspect = canvas.height / canvas.width;
    const geo = new PlaneGeometry(1, aspect, 40, Math.round(40 * aspect));
    geo.translate(tall ? 0.5 : -0.5, -aspect / 2, 0);
    const m = new MeshBasicNodeMaterial();
    m.side = DoubleSide;
    const d = tall ? uv().x : float(1).sub(uv().x);
    const v = uv().y;
    const t = this.clock;
    const phase = d.mul(7.5).sub(t.mul(2.6)).add(v.mul(1.8));
    const wave = sin(phase).mul(0.07).add(sin(d.mul(17).sub(t.mul(4.4)).add(v.mul(3))).mul(0.018)).mul(d);
    const slope = cos(phase).mul(0.5).add(cos(d.mul(17).sub(t.mul(4.4))).mul(0.25));
    m.positionNode = positionLocal.add(vec3(0, d.mul(d).mul(-0.04), wave));
    m.colorNode = texture(tex, uv()).rgb.mul(slope.mul(d).mul(0.22).add(0.86));
    const cloth = new Mesh(geo, m);
    const wood = new MeshBasicNodeMaterial({ color: 0x1a2430 });
    const pole = new Mesh(new CylinderGeometry(0.014, 0.018, aspect + 1.6, 10), wood);
    pole.position.set(0, -aspect / 2 - 0.2, 0);
    const finial = new Mesh(new CylinderGeometry(0, 0.04, 0.13, 8), new MeshBasicNodeMaterial({ color: 0xdfe8f2 }));
    finial.position.set(0, 0.665, 0);
    flag.group.add(cloth, pole, finial);
    if (tall) {
      const bar = new Mesh(new CylinderGeometry(0.011, 0.011, 1.05, 8), wood);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0.5, 0, 0);
      flag.group.add(bar);
    }
    // An ink shadow where the pole meets the map.
    flag.base = aspect + 1;
    const shadow = new Mesh(new CircleGeometry(0.32, 28), new MeshBasicNodeMaterial({ color: 0x1b1814, transparent: true, opacity: 0.28, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, -flag.base + 0.03, 0);
    flag.group.add(shadow);
    flag.group.visible = false;
    return flag;
  }

  private updateFlags(dt: number, yaw: number) {
    this.clock.value = this.time;
    const glide = 1 - Math.exp(-dt * 3);
    const grow = 1 - Math.exp(-dt * 6);
    for (const f of this.flags) {
      f.pos.lerp(f.goal, glide);
      f.scale += (f.goalScale - f.scale) * grow;
      f.group.visible = f.scale > 0.02;
      if (!f.group.visible) continue;
      f.group.scale.setScalar(f.scale);
      f.group.position.set(f.pos.x, this.groundAt(f.pos.x, f.pos.z) + f.base * f.scale, f.pos.z);
      // Turn with the camera, so the cloth always shows its face, at a slight angle for depth.
      f.group.rotation.y = yaw + FLAG_AT[f.faction].lean;
    }
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
    this.updateFlags(dt, yaw);
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
