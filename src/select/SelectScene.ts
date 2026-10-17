import {
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  NoToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type WebGPURenderer,
} from 'three/webgpu';
import { cos, float, positionLocal, sin, texture, uniform, uv, vec3 } from 'three/tsl';
import meta from './demMeta.json';
import { demHeightAtUV, MAP_H, MAP_W, MIST_HEX, V_SCALE } from './demFrame';
import { buildTerrain, loadDem } from './terrain';
import { SCENARIOS, type ScenarioId } from '../sim/scenarios';
import { playableFactions } from '../sim/balance';
import type { Faction } from '../sim/types';
import { disposeTree } from '../render/dispose';
import { FONT_HANJA } from '../ui/fonts';

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
  plymouth: { lon: -4.25, lat: 50.25 },
  portland: { lon: -2.45, lat: 50.5 },
  wight: { lon: -1.25, lat: 50.55 },
  calais: { lon: 1.8, lat: 50.98 },
  gravelines: { lon: 2.05, lat: 51.06 },
  preveza: { lon: 20.72, lat: 38.95 },
  djerba: { lon: 10.75, lat: 33.88 },
  'lepanto-north': { lon: 21.1, lat: 38.33 },
  'lepanto-centre': { lon: 21.15, lat: 38.27 },
  'lepanto-south': { lon: 21.2, lat: 38.2 },
  'st-vincent': { lon: -9.4, lat: 36.9 },
  nile: { lon: 30.1, lat: 31.35 },
  finisterre: { lon: -11.5, lat: 43.6 },
  'trafalgar-weather': { lon: -6.25, lat: 36.25 },
  'trafalgar-lee': { lon: -6.22, lat: 36.2 },
};

const lonToX = (lon: number) => ((lon + 180) / 360) * 2 ** meta.zoom;
const latToY = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** meta.zoom;
};

export function siteUV(id: ScenarioId) {
  const s = SITES[id];
  return { u: (lonToX(s.lon) - meta.x0) / (meta.x1 - meta.x0), v: (latToY(s.lat) - meta.y0) / (meta.y1 - meta.y0) };
}

// War-table flags for the sides of the selected battle, pinned into the map around the site: Joseon and Ming to the
// west, where their fleets sailed from, Japan to the east. The side the player leads stands taller. Sizes are in
// map units (one unit is about 3.3 km).
const FLAG_AT: Record<Faction, { dx: number; dz: number; size: number; lean: number }> = {
  joseon: { dx: -1.5, dz: 0.5, size: 1.15, lean: 0.3 },
  ming: { dx: -2.7, dz: -0.5, size: 1.08, lean: 0.25 },
  japan: { dx: 1.6, dz: -0.2, size: 0.76, lean: -0.3 },
  england: { dx: -1.5, dz: 0.5, size: 1.1, lean: 0.3 },
  spain: { dx: 1.6, dz: -0.2, size: 1.1, lean: -0.3 },
  holyleague: { dx: -1.5, dz: 0.5, size: 1.1, lean: 0.3 },
  ottoman: { dx: 1.6, dz: -0.2, size: 1.1, lean: -0.3 },
  britain: { dx: -1.5, dz: 0.5, size: 1.1, lean: 0.3 },
  france: { dx: 1.6, dz: -0.2, size: 1.1, lean: -0.3 },
  spain1805: { dx: 2.7, dz: 0.5, size: 1.05, lean: -0.25 },
};
const PLAYER_FLAG = 1.3;

/** Banner text: Yi's command flag reads 帥, other commanders fly their name. */
function flagText(id: ScenarioId, faction: Faction) {
  const s = SCENARIOS[id];
  if (faction === 'joseon') return s.joseon.figure === 'fig_yi' ? '帥' : s.joseon.banner;
  if (faction === 'ming') return s.ming?.banner ?? '明';
  return s.japan.banner;
}

/** A repeatable pseudo-random sequence, so a flag's weave and wear come out the same every time it is painted. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The banners' hanja in --font-hanja; waits for the characters they use before painting. */
let flagFont: Promise<unknown> | null = null;
function loadFlagFont() {
  if (!flagFont) {
    const chars = new Set([...'帥明']);
    for (const s of Object.values(SCENARIOS)) for (const ch of s.joseon.banner + s.japan.banner + (s.ming?.banner ?? '')) chars.add(ch);
    flagFont = document.fonts.load(`700 200px ${FONT_HANJA}`, [...chars].join('')).catch(() => undefined);
  }
  return flagFont;
}

const INK = '#1a1612';

/**
 * Aged hemp: the cloth's outline with a frayed fly edge, the weave, a few stains and a darker rim. Leaves the cloth as the
 * clip, so what is painted next stays on it.
 */
function paintCloth(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, ground: string, flyLeft: boolean, rnd: () => number) {
  const fray = (amp: number) => Math.max(0, (rnd() - 0.3) * amp);
  const step = 12;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  for (let x = x0 + step; x < x1; x += step) ctx.lineTo(x, y0 + fray(5));
  ctx.lineTo(x1, y0);
  for (let y = y0 + step; y < y1; y += step) ctx.lineTo(flyLeft ? x1 : x1 - fray(14), y);
  ctx.lineTo(x1, y1);
  for (let x = x1 - step; x > x0; x -= step) ctx.lineTo(x, y1 - fray(5));
  ctx.lineTo(x0, y1);
  for (let y = y1 - step; y > y0; y -= step) ctx.lineTo(flyLeft ? x0 + fray(14) : x0, y);
  ctx.closePath();
  ctx.fillStyle = ground;
  ctx.fill();
  ctx.clip();
  // the weave: warp and weft threads a shade lighter and darker than the ground
  for (let y = y0; y < y1; y += 3) {
    ctx.fillStyle = `rgba(70, 52, 34, ${0.03 + rnd() * 0.06})`;
    ctx.fillRect(x0, y, x1 - x0, 1);
  }
  for (let x = x0; x < x1; x += 3) {
    ctx.fillStyle = `rgba(255, 248, 230, ${0.02 + rnd() * 0.05})`;
    ctx.fillRect(x, y0, 1, y1 - y0);
  }
  // water and smoke stains
  for (let i = 0; i < 10; i += 1) {
    const x = x0 + rnd() * (x1 - x0);
    const y = y0 + rnd() * (y1 - y0);
    const r = 30 + rnd() * 150;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(96, 70, 44, ${0.05 + rnd() * 0.09})`);
    g.addColorStop(1, 'rgba(96, 70, 44, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // a darker rim where the cloth has been handled and weathered
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rim = ctx.createRadialGradient(cx, cy, Math.min(x1 - x0, y1 - y0) * 0.3, cx, cy, Math.max(x1 - x0, y1 - y0) * 0.72);
  rim.addColorStop(0, 'rgba(40, 28, 18, 0)');
  rim.addColorStop(1, 'rgba(40, 28, 18, 0.32)');
  ctx.fillStyle = rim;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

/** Flame tongues (화염각) along one edge, pointing outward: each a curved lick, no two alike. */
function paintFlames(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, nx: number, ny: number, color: string, rnd: () => number) {
  const len = Math.hypot(bx - ax, by - ay);
  const tx = (bx - ax) / len;
  const ty = (by - ay) / len;
  const width = 42;
  ctx.fillStyle = color;
  // the strip the tongues are sewn to
  ctx.beginPath();
  ctx.moveTo(ax - nx * 14, ay - ny * 14);
  ctx.lineTo(bx - nx * 14, by - ny * 14);
  ctx.lineTo(bx + nx * 2, by + ny * 2);
  ctx.lineTo(ax + nx * 2, ay + ny * 2);
  ctx.fill();
  for (let s = 0; s < len - 4; s += width) {
    const w = Math.min(width, len - s);
    const p0x = ax + tx * s;
    const p0y = ay + ty * s;
    const p1x = p0x + tx * w;
    const p1y = p0y + ty * w;
    const reach = 46 + rnd() * 22;
    const sway = (rnd() - 0.3) * 22;
    const tipX = (p0x + p1x) / 2 + nx * reach + tx * sway;
    const tipY = (p0y + p1y) / 2 + ny * reach + ty * sway;
    ctx.beginPath();
    ctx.moveTo(p0x, p0y);
    ctx.quadraticCurveTo(p0x + nx * reach * 0.6 + tx * (sway * 0.2 - 4), p0y + ny * reach * 0.6 + ty * (sway * 0.2 - 4), tipX, tipY);
    ctx.quadraticCurveTo(p1x + nx * reach * 0.35 + tx * (sway * 0.5 + 3), p1y + ny * reach * 0.35 + ty * (sway * 0.5 + 3), p1x, p1y);
    ctx.closePath();
    ctx.fill();
  }
}

/** Characters in ink: multiplied into the cloth so the weave shows through, with a slight bleed. */
function inkText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = INK;
  ctx.shadowColor = 'rgba(26, 22, 18, 0.45)';
  ctx.shadowBlur = size * 0.03;
  ctx.font = `700 ${size}px ${FONT_HANJA}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** A clan crest (mon) in ink: three tomoe whirling inside a ring. */
function paintMon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * 0.12;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  for (let k = 0; k < 3; k += 1) {
    const a = (k / 3) * Math.PI * 2 - Math.PI / 2;
    const hx = cx + Math.cos(a) * r * 0.38;
    const hy = cy + Math.sin(a) * r * 0.38;
    // the head of the comma, then its tail sweeping round the centre
    ctx.beginPath();
    ctx.arc(hx, hy, r * 0.27, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(hx + Math.cos(a - Math.PI / 2) * r * 0.27, hy + Math.sin(a - Math.PI / 2) * r * 0.27);
    ctx.quadraticCurveTo(cx + Math.cos(a + 1.1) * r * 0.95, cy + Math.sin(a + 1.1) * r * 0.95, cx + Math.cos(a + 2.0) * r * 0.66, cy + Math.sin(a + 2.0) * r * 0.66);
    ctx.quadraticCurveTo(cx + Math.cos(a + 1.0) * r * 0.55, cy + Math.sin(a + 1.0) * r * 0.55, hx + Math.cos(a + Math.PI / 2) * r * 0.27, hy + Math.sin(a + Math.PI / 2) * r * 0.27);
    ctx.fill();
  }
  ctx.restore();
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
  private readonly loading = new AbortController();
  private disposed = false;
  private demTexture: DataTexture | null = null;

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
    this.loading.signal.throwIfAborted();
    this.renderer.toneMapping = NoToneMapping;
    const { heights, tex } = await loadDem(this.loading.signal);
    this.loading.signal.throwIfAborted();
    this.demTexture = tex;
    this.heights = heights;
    this.scene.add(buildTerrain(tex, this.segments));
    for (const faction of ['joseon', 'ming', 'japan'] as Faction[]) {
      const flag = this.makeFlag(faction);
      this.flags.push(flag);
      this.scene.add(flag.group);
    }
    if (this.forces) this.setForces(this.forces.id, this.forces.player);
    // Attach first: focus() reads the canvas height to decide how far south to aim, and an unattached canvas reads as 1 px.
    this.attach(this.renderer.domElement);
    this.focus(initial, true);
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
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    this.loading.abort();
    const dom = this.dom;
    dom?.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    dom?.removeEventListener('wheel', this.onWheel);
    dom?.removeEventListener('contextmenu', this.onContext);
    this.dom = null;
    this.touches.clear();
    this.drag = null;
    disposeTree(this.scene);
    this.demTexture?.dispose();
    this.demTexture = null;
    for (const flag of this.flags) flag.tex.dispose();
    this.flags.length = 0;
    this.heights = null;
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
    this.goal.z = Math.max(-MAP_H / 2, Math.min(MAP_H / 2, this.goal.z - mx * s + mz * c));
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
    return (this.dom ?? this.renderer.domElement).clientHeight || window.innerHeight;
  }

  private groundAt(x: number, z: number) {
    return this.heights ? Math.max(0, demHeightAtUV(this.heights, x / MAP_W + 0.5, z / MAP_H + 0.5)) * V_SCALE : 0;
  }

  worldOf(id: ScenarioId, out = new Vector3()) {
    const { u, v } = siteUV(id);
    const x = (u - 0.5) * MAP_W;
    const z = (v - 0.5) * MAP_H;
    return out.set(x, this.groundAt(x, z), z);
  }

  focus(id: ScenarioId, instant = false) {
    this.worldOf(id, this.goal);
    this.goalYaw = 0;
    // Aim south of the site so it sits in the upper half of the screen, above the brief card. A shorter window leaves the
    // map less room above the card, so the aim moves further south.
    this.goal.z += 2.4 + Math.max(0, 900 - this.viewportHeight()) * 0.025;
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

  /**
   * The flags are cloth, not icons: aged hemp with the commander's mark written in ink. Joseon flies a command flag with
   * slate flame tongues (화염각), Ming an ochre flag with its seal, Japan a tall nobori with a crest and the name down it.
   * The faction's colour is in the trim, not the whole cloth.
   */
  private paintFlag(canvas: HTMLCanvasElement, faction: Faction, text: string) {
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width;
    const h = canvas.height;
    const rnd = seeded(faction === 'joseon' ? 11 : faction === 'japan' ? 23 : 37);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    if (faction === 'japan') {
      // Nobori: the pole runs down the left edge, with cloth loops along it.
      paintCloth(ctx, 18, 0, w, h, '#ddd4be', false, rnd);
      // the clan's colour: a broad band at the head and another at the foot
      ctx.fillStyle = '#5f4238';
      ctx.fillRect(0, 0, w, 64);
      ctx.fillRect(0, h - 40, w, 40);
      paintMon(ctx, w / 2 + 9, w * 0.58, w * 0.27);
      [...text].forEach((ch, i, all) => inkText(ctx, ch, w / 2 + 9, w * 1.2 + i * (all.length > 2 ? 190 : 230), all.length > 2 ? 190 : 230));
      ctx.restore();
      for (let y = 70; y < h - 40; y += 120) {
        ctx.fillStyle = '#5f4238';
        ctx.fillRect(0, y, 26, 34);
        ctx.fillStyle = 'rgba(40, 28, 18, 0.35)';
        ctx.fillRect(0, y + 30, 26, 4);
      }
      return;
    }
    // Square flags hang to the left of the pole: the right edge is the sleeve, the other three carry the trim.
    const ming = faction === 'ming';
    const trim = ming ? '#7d6337' : '#3d566b';
    const m = 72;
    paintCloth(ctx, m, m, w - 22, h - m, ming ? '#c4a66b' : '#d8cdb1', true, rnd);
    if (ming) {
      // a pale seal disc behind the character
      ctx.fillStyle = 'rgba(236, 226, 200, 0.92)';
      ctx.beginPath();
      ctx.arc((m + w - 22) / 2, h / 2, w * 0.25, 0, Math.PI * 2);
      ctx.fill();
      inkText(ctx, text, (m + w - 22) / 2, h / 2 + 6, 220);
    } else {
      inkText(ctx, text, (m + w - 22) / 2, h / 2 + 8, 300);
    }
    ctx.restore();
    paintFlames(ctx, m, m, w - 22, m, 0, -1, trim, rnd);
    paintFlames(ctx, w - 22, h - m, m, h - m, 0, 1, trim, rnd);
    paintFlames(ctx, m, h - m, m, m, -1, 0, trim, rnd);
    // the sleeve the pole runs through
    ctx.fillStyle = trim;
    ctx.fillRect(w - 24, m - 10, 24, h - 2 * m + 20);
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
    void loadFlagFont().then(() => {
      if (this.disposed) return;
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
    const cloth0 = texture(tex, uv());
    m.colorNode = cloth0.rgb.mul(slope.mul(d).mul(0.22).add(0.86));
    // the frayed edge and the flame tongues are cut out of the plane
    m.opacityNode = cloth0.a;
    m.alphaTest = 0.5;
    const cloth = new Mesh(geo, m);
    const wood = new MeshBasicNodeMaterial({ color: 0x8a8174 });
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
