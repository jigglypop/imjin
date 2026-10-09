import {
  AdditiveBlending,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
  type Camera,
} from 'three/webgpu';
import { cameraPosition, float, instanceIndex, instancedDynamicBufferAttribute, length, mx_noise_float, pow, smoothstep, time, uv, vec3, vec4 } from 'three/tsl';
import type { Battle } from '../sim/battle';
import type { ShipKind } from '../sim/types';
import type { ShipViews } from '../ships/ShipViews';

const CAPACITY = 4000;
/** How far below its hook the lit paper of a hanging lantern sits (the models hang their body under the hook). */
const BODY_DROP = 0.22;
/** Seconds for a lantern to come up or die down when the order changes. */
const FADE_ON = 0.9;
const FADE_OFF = 0.6;
/** A ship is only lit by its lanterns this close to the camera, and only this many lanterns light the sea at once. */
const LIGHT_RANGE = 700;
const LIGHT_BUDGET = 24;

const POINTS: Record<ShipKind, [number, number, number][]> = {
  panokseon: [
    [0.42, 1.6, 0.42],
    [0.42, 1.6, -0.42],
    [-0.42, 1.6, 0.42],
    [-0.42, 1.6, -0.42],
    [-0.12, 6.5, 0],
    [0.2, 12, 0],
  ],
  geobukseon: [
    [0.45, 2.9, 0],
    [-0.45, 2.9, 0],
  ],
  hyeopseon: [[-0.4, 1.4, 0]],
  atakebune: [
    [0.4, 1.8, 0.4],
    [0.4, 1.8, -0.4],
    [-0.4, 1.8, 0.4],
    [-0.4, 1.8, -0.4],
    [-0.1, 11, 0],
  ],
  sekibune: [
    [0.42, 1.4, 0],
    [-0.42, 1.4, 0.3],
    [-0.42, 1.4, -0.3],
  ],
  kobaya: [
    [0.4, 1.2, 0],
    [-0.4, 1.2, 0],
  ],
  mingship: [
    [0.42, 1.8, 0.35],
    [0.42, 1.8, -0.35],
    [-0.45, 3.5, 0],
    [0.1, 10, 0],
  ],
  mingsmall: [
    [0.4, 1.4, 0],
    [-0.4, 1.4, 0],
  ],
};

const DECK: Record<string, number> = { 'panokseon#0': 6.0, 'panokseon#1': 4.7, 'panokseon#2': 4.4, 'atakebune#0': 3.5, 'sekibune#0': 2.1, 'hyeopseon#0': 0.95, 'kobaya#0': 0.8, 'mingship#0': 4.2, 'mingsmall#0': 2.4, 'geobukseon#0': 4.7 };

type Level = { k: number; seen: number };

/**
 * The glow of the paper lanterns at night and their streaks on the sea. A ship shows them only while its lights are
 * on (the blackout order dims them out) and it is afloat; each lantern is a soft amber halo around a small warm core,
 * and the streak lies flat on the water, pointing at the camera.
 */
export class Lanterns {
  readonly group = new Group();
  private readonly glowPos = new InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
  private readonly glowK = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  private readonly reflK = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  private readonly glow: Sprite;
  private readonly refl: InstancedMesh;
  private readonly p = new Vector3();
  private readonly levels = new Map<number, Level>();
  private frame = 0;
  private clock = 0;
  onLight: ((x: number, y: number, z: number, intensity: number) => void) | null = null;

  constructor(private readonly views: ShipViews) {
    for (const a of [this.glowPos, this.glowK, this.reflK]) a.setUsage(DynamicDrawUsage);
    const g = new SpriteNodeMaterial();
    const G: any = instancedDynamicBufferAttribute(this.glowPos, 'vec4');
    const GK: any = instancedDynamicBufferAttribute(this.glowK, 'float');
    // The glow floats a little toward the camera so that a lantern's own paper body does not hide its light.
    g.positionNode = G.xyz.add(cameraPosition.sub(G.xyz).normalize().mul(0.35));
    g.scaleNode = G.w;
    g.blending = AdditiveBlending;
    g.transparent = true;
    g.depthWrite = false;
    g.fog = false;
    const r = length(uv().sub(0.5).mul(2));
    const core = smoothstep(0.16, 0.0, r);
    const halo = pow(smoothstep(1.0, 0.0, r), float(2.4));
    const rgb = vec3(1.0, 0.44, 0.13).mul(halo.mul(1.9)).add(vec3(1.0, 0.68, 0.32).mul(core.mul(3.0)));
    g.colorNode = vec4(rgb.mul(GK), 1);
    g.opacityNode = halo.mul(0.8).add(core).mul(GK);
    this.glow = new Sprite(g);
    this.glow.count = 0;
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 6;

    // The streak is a flat strip on the water: the plane's local z runs from the lantern toward the camera.
    const geo = new PlaneGeometry(1, 1);
    geo.rotateX(Math.PI / 2);
    const m = new MeshBasicNodeMaterial();
    const RK: any = instancedDynamicBufferAttribute(this.reflK, 'float');
    m.blending = AdditiveBlending;
    m.transparent = true;
    m.depthWrite = false;
    m.side = DoubleSide;
    m.fog = false;
    const u = uv();
    const ripple = mx_noise_float(vec3(u.x.mul(5), u.y.mul(34).add(time.mul(1.4)), instanceIndex.mul(0.37)));
    const lengthFade = smoothstep(0.0, 0.06, u.y).mul(smoothstep(1.0, 0.15, u.y));
    const widthFade = smoothstep(0.5, 0.0, u.x.sub(0.5).abs());
    const shimmer = smoothstep(-0.5, 0.7, ripple);
    m.colorNode = vec4(vec3(1.0, 0.48, 0.16).mul(1.1), 1);
    m.opacityNode = lengthFade.mul(widthFade).mul(shimmer).mul(0.8).mul(RK);
    this.refl = new InstancedMesh(geo, m, CAPACITY);
    this.refl.instanceMatrix.setUsage(DynamicDrawUsage);
    this.refl.count = 0;
    this.refl.frustumCulled = false;
    this.refl.renderOrder = -5;
    this.group.add(this.refl, this.glow);
  }

  /** Eases a ship's lantern level toward its order (1 lit, 0 out) and returns it. */
  private level(id: number, target: number, dt: number) {
    let l = this.levels.get(id);
    if (!l) {
      // A ship first seen already lit or dark starts there: no fade-in on a freshly loaded battle.
      l = { k: target, seen: this.frame };
      this.levels.set(id, l);
    }
    l.seen = this.frame;
    l.k += Math.sign(target - l.k) * Math.min(Math.abs(target - l.k), dt / (target > l.k ? FADE_ON : FADE_OFF));
    return l.k;
  }

  /** `night` is the battle's own, or a night sky chosen by the ?sky= test hook. */
  update(battle: Battle, camera: Camera, night = battle.night) {
    let n = 0;
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, Math.max(0, now - this.clock));
    this.clock = now;
    this.frame += 1;
    if (night) {
      const G = this.glowPos.array as Float32Array;
      const GK = this.glowK.array as Float32Array;
      const RK = this.reflK.array as Float32Array;
      const M = this.refl.instanceMatrix.array as Float32Array;
      const cam = camera.position;
      let lights = 0;
      for (const ship of battle.ships) {
        if (!ship.alive) continue;
        // A ship going down loses its lights with its way: they are out by the time the deck is awash.
        const afloat = 1 - Math.min(1, ship.sinking * 4);
        const k = this.level(ship.id, ship.lights ? 1 : 0, dt) * afloat;
        if (k < 0.01) continue;
        const v = this.views.states.get(ship.id);
        if (!v || !v.visible) continue;
        // Modelled ships carry their lantern hooks in ship space; the legacy ones use fractions of their size.
        const anchors = this.views.assets?.[v.key]?.anchors;
        const legacy = POINTS[ship.spec.kind];
        const deck = DECK[v.key] ?? ship.spec.deck;
        const ddx = ship.x - cam.x;
        const ddz = ship.z - cam.z;
        const dist = Math.sqrt(ddx * ddx + ddz * ddz);
        // Near, a lantern is a small bright thing with a halo; far, it grows so that it stays a visible point.
        const size = 1.6 + dist * 0.0075;
        const count = anchors ? anchors.lanterns.length : legacy.length;
        const first = n;
        let cx = 0;
        let cy = 0;
        let cz = 0;
        for (let i = 0; i < count; i += 1) {
          if (n >= CAPACITY) break;
          const l = anchors ? anchors.lanterns[i]! : legacy[i]!;
          const fl = anchors ? l[0] : l[0] * ship.spec.length;
          const y = anchors ? l[1] - BODY_DROP : deck + l[1];
          this.views.localToWorld(ship.id, fl, y, anchors ? l[2] : l[2] * ship.spec.beam, this.p);
          const flicker = 0.9 + Math.sin(battle.time * 11 + ship.id * 3.1 + fl * 0.7 + i * 1.9) * 0.05 + Math.sin(battle.time * 23 + i * 5.3 + ship.id) * 0.03;
          const o = n * 4;
          G[o] = this.p.x;
          G[o + 1] = this.p.y;
          G[o + 2] = this.p.z;
          G[o + 3] = size * flicker;
          GK[n] = k * (0.82 + 0.18 * flicker);
          RK[n] = k * flicker;
          const dx = cam.x - this.p.x;
          const dz = cam.z - this.p.z;
          const dl = Math.sqrt(dx * dx + dz * dz) || 1;
          // Only a streak's reach grows with the lantern's height and the viewing distance.
          const len = Math.min(24, 5 + this.p.y * 1.1) * (1 + dist / 700);
          const wid = 0.5 + len * 0.07;
          const ux = dx / dl;
          const uz = dz / dl;
          const mo = n * 16;
          // Columns of a Y rotation toward the camera, scaled by width and length, then the streak's centre on the sea.
          M[mo] = uz * wid;
          M[mo + 1] = 0;
          M[mo + 2] = -ux * wid;
          M[mo + 3] = 0;
          M[mo + 4] = 0;
          M[mo + 5] = 1;
          M[mo + 6] = 0;
          M[mo + 7] = 0;
          M[mo + 8] = ux * len;
          M[mo + 9] = 0;
          M[mo + 10] = uz * len;
          M[mo + 11] = 0;
          // The streak lies on the sea under the ship, which the ship's own wave sample already gives.
          M[mo + 12] = this.p.x + ux * len * 0.5;
          M[mo + 13] = v.heave + 0.5;
          M[mo + 14] = this.p.z + uz * len * 0.5;
          M[mo + 15] = 1;
          cx += this.p.x;
          cy += this.p.y;
          cz += this.p.z;
          n += 1;
        }
        // One light for the whole ship, at the middle of its lanterns: the few light slots go to different ships.
        const made = n - first;
        if (made > 0 && dist < LIGHT_RANGE && lights < LIGHT_BUDGET) {
          this.onLight?.(cx / made, cy / made + 1.6, cz / made, (60 + 20 * Math.min(made, 4)) * k);
          lights += 1;
        }
      }
      for (const [a, stride] of [[this.glowPos, 4], [this.glowK, 1], [this.reflK, 1], [this.refl.instanceMatrix, 16]] as const) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, Math.max(stride, n * stride));
        a.needsUpdate = true;
      }
      if (this.frame % 120 === 0) for (const [id, l] of this.levels) if (l.seen !== this.frame) this.levels.delete(id);
    }
    this.glow.count = n;
    this.refl.count = n;
  }
}
