import { AdditiveBlending, DynamicDrawUsage, Group, InstancedBufferAttribute, Sprite, SpriteNodeMaterial, Vector3, type Camera } from 'three/webgpu';
import { float, instancedDynamicBufferAttribute, length, mx_noise_float, pow, smoothstep, time, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { Battle } from '../sim/battle';
import type { ShipKind } from '../sim/types';
import type { ShipViews } from '../ships/ShipViews';
import { waveField } from '../ocean/waves';

const CAPACITY = 4000;

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

export class Lanterns {
  readonly group = new Group();
  private readonly glowPos = new InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
  private readonly reflPos = new InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
  private readonly glow: Sprite;
  private readonly refl: Sprite;
  private readonly p = new Vector3();
  onLight: ((x: number, y: number, z: number, intensity: number) => void) | null = null;

  constructor(private readonly views: ShipViews) {
    for (const a of [this.glowPos, this.reflPos]) a.setUsage(DynamicDrawUsage);
    const g = new SpriteNodeMaterial();
    const G: any = instancedDynamicBufferAttribute(this.glowPos, 'vec4');
    g.positionNode = G.xyz;
    g.scaleNode = G.w;
    g.blending = AdditiveBlending;
    g.transparent = true;
    g.depthWrite = false;
    g.fog = false;
    const r = length(uv().sub(0.5).mul(2));
    const core = smoothstep(0.18, 0.0, r);
    const halo = pow(smoothstep(1.0, 0.0, r), float(2.4));
    g.colorNode = vec4(vec3(1.0, 0.5, 0.15).mul(halo.mul(2.6)).add(vec3(1.0, 0.78, 0.45).mul(core.mul(4))), 1);
    g.opacityNode = halo.add(core);
    this.glow = new Sprite(g);
    this.glow.count = 0;
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 6;

    const m = new SpriteNodeMaterial();
    const R: any = instancedDynamicBufferAttribute(this.reflPos, 'vec4');
    m.positionNode = R.xyz;
    m.scaleNode = vec2(R.w.mul(0.24), R.w.mul(2.6));
    m.blending = AdditiveBlending;
    m.transparent = true;
    m.depthWrite = false;
    m.fog = false;
    const u = uv();
    const ripple = mx_noise_float(vec3(u.x.mul(5), u.y.mul(42).add(time.mul(1.7)), R.x.mul(0.07)));
    const lengthFade = smoothstep(0.0, 0.25, u.y).mul(smoothstep(1.0, 0.55, u.y));
    const widthFade = smoothstep(0.5, 0.0, u.x.sub(0.5).abs());
    const shimmer = smoothstep(-0.55, 0.65, ripple);
    m.colorNode = vec4(vec3(1.0, 0.5, 0.17).mul(1.4), 1);
    m.opacityNode = lengthFade.mul(widthFade).mul(shimmer).mul(0.85);
    this.refl = new Sprite(m);
    this.refl.count = 0;
    this.refl.frustumCulled = false;
    this.refl.renderOrder = -5;
    this.group.add(this.refl, this.glow);
  }

  update(battle: Battle, camera: Camera) {
    let n = 0;
    if (battle.night) {
      const G = this.glowPos.array as Float32Array;
      const R = this.reflPos.array as Float32Array;
      const cam = camera.position;
      const t = waveField.time;
      let lights = 0;
      for (const ship of battle.ships) {
        if (!ship.alive || !ship.lights || ship.sinking > 0.3) continue;
        const v = this.views.states.get(ship.id);
        if (!v || !v.visible) continue;
        const pts = POINTS[ship.spec.kind];
        const deck = DECK[v.key] ?? ship.spec.deck;
        const dist = Math.hypot(ship.x - cam.x, ship.z - cam.z);
        const size = 1.5 + dist * 0.0075;
        for (const [fl, dy, fb] of pts) {
          if (n >= CAPACITY) break;
          this.views.localToWorld(ship.id, fl * ship.spec.length, deck + dy, fb * ship.spec.beam, this.p);
          const flicker = 0.88 + Math.sin(battle.time * 13 + ship.id * 3.1 + fl * 7) * 0.06 + Math.random() * 0.06;
          const o = n * 4;
          G[o] = this.p.x;
          G[o + 1] = this.p.y;
          G[o + 2] = this.p.z;
          G[o + 3] = size * flicker;
          const dx = cam.x - this.p.x;
          const dz = cam.z - this.p.z;
          const dl = Math.hypot(dx, dz) || 1;
          const water = waveField.heightAt(this.p.x, this.p.z, t, 10);
          const len = Math.min(26, 6 + this.p.y * 1.2) * (1 + dist / 700);
          R[o] = this.p.x + (dx / dl) * len * 0.5;
          R[o + 1] = water + 0.2;
          R[o + 2] = this.p.z + (dz / dl) * len * 0.5;
          R[o + 3] = len * 0.38;
          n += 1;
          if (dist < 700 && lights < 40 && dy < 3) {
            this.onLight?.(this.p.x, this.p.y, this.p.z, 700 * flicker);
            lights += 1;
          }
        }
      }
      for (const a of [this.glowPos, this.reflPos]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, Math.max(4, n * 4));
        a.needsUpdate = true;
      }
    }
    this.glow.count = n;
    this.refl.count = n;
  }
}
