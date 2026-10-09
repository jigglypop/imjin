import type { Battle } from '../sim/battle';
import type { Faction, Team } from '../sim/types';
import { factionColor, lighten, sealColor, withAlpha } from './tokens';
import type { Terrain } from '../terrain/Terrain';

const SIZE = 320;

export class Minimap {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base = document.createElement('canvas');
  private cx = 0;
  private cz = 0;
  private extent = 8000;
  onPick: ((x: number, z: number, button: number) => void) | null = null;

  constructor() {
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.base.width = SIZE;
    this.base.height = SIZE;
    this.ctx = this.canvas.getContext('2d')!;
    this.canvas.addEventListener('pointerdown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const u = (e.clientX - rect.left) / rect.width;
      const v = (e.clientY - rect.top) / rect.height;
      this.onPick?.(this.cx + (u - 0.5) * this.extent, this.cz + (v - 0.5) * this.extent, e.button);
      e.preventDefault();
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** False while no panel shows the map. The engine skips redrawing it then. */
  visible = false;
  /** The player's team. Ships and points use their navy's tone, with a white ring for friends and a muted brown one for foes. */
  team: Team = 'joseon';

  mount(el: HTMLElement | null) {
    this.visible = !!el;
    if (el && this.canvas.parentElement !== el) el.appendChild(this.canvas);
  }

  setTerrain(terrain: Terrain, cx: number, cz: number, extent: number) {
    this.cx = cx;
    this.cz = cz;
    this.extent = extent;
    const ctx = this.base.getContext('2d')!;
    const img = ctx.createImageData(SIZE, SIZE);
    const h = new Float32Array(SIZE * SIZE);
    for (let j = 0; j < SIZE; j += 1) {
      for (let i = 0; i < SIZE; i += 1) {
        const x = cx + ((i + 0.5) / SIZE - 0.5) * extent;
        const z = cz + ((j + 0.5) / SIZE - 0.5) * extent;
        h[j * SIZE + i] = terrain.heightAt(x, z);
      }
    }
    for (let j = 0; j < SIZE; j += 1) {
      for (let i = 0; i < SIZE; i += 1) {
        const k = j * SIZE + i;
        const v = h[k]!;
        let r: number;
        let g: number;
        let b: number;
        if (v <= 0) {
          const depth = Math.min(1, -v / 45);
          r = 44 - depth * 14;
          g = 60 - depth * 17;
          b = 74 - depth * 20;
        } else {
          const e = Math.min(1, v / 420);
          const right = h[j * SIZE + Math.min(SIZE - 1, i + 1)]!;
          const down = h[Math.min(SIZE - 1, j + 1) * SIZE + i]!;
          const shade = Math.max(-1, Math.min(1, (v - right + (v - down)) * 0.035));
          const lift = 150 + (1 - e) * 44 + shade * 30;
          r = lift;
          g = lift * 0.975;
          b = lift * 0.92;
        }
        const coast = (v > 0) !== (h[j * SIZE + Math.min(SIZE - 1, i + 1)]! > 0) || (v > 0) !== (h[Math.min(SIZE - 1, j + 1) * SIZE + i]! > 0);
        if (coast) {
          r = 226;
          g = 229;
          b = 230;
        }
        img.data[k * 4] = r;
        img.data[k * 4 + 1] = g;
        img.data[k * 4 + 2] = b;
        img.data[k * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  draw(battle: Battle, selected: Set<number>, camX: number, camZ: number, yaw: number, points?: { x: number; z: number; r: number; side: 'own' | 'foe' | 'none'; selected: boolean }[]) {
    const ctx = this.ctx;
    ctx.drawImage(this.base, 0, 0);
    let own: Faction = 'joseon';
    let foe: Faction = 'japan';
    const own0 = battle.ships.find((s) => s.team === this.team);
    const foe0 = battle.ships.find((s) => s.team !== this.team);
    if (own0) own = own0.spec.faction;
    if (foe0) foe = foe0.spec.faction;
    const foeRing = lighten(sealColor(), 0.35);
    // The sea is dark, so the faction tones are lifted to read on it.
    const tone = (f: Faction) => lighten(factionColor(f), 0.4);
    const toPx = (x: number, z: number) => [((x - this.cx) / this.extent + 0.5) * SIZE, ((z - this.cz) / this.extent + 0.5) * SIZE] as const;
    for (const p of points ?? []) {
      const [px, py] = toPx(p.x, p.z);
      ctx.beginPath();
      ctx.arc(px, py, Math.max(5, (p.r / this.extent) * SIZE), 0, Math.PI * 2);
      const pc = p.side === 'own' ? factionColor(own) : p.side === 'foe' ? factionColor(foe) : '';
      ctx.fillStyle = pc ? withAlpha(pc, 0.28) : 'rgba(255, 255, 255, 0.07)';
      ctx.fill();
      ctx.lineWidth = p.selected ? 2 : 1.1;
      ctx.strokeStyle = pc ? tone(p.side === 'own' ? own : foe) : 'rgba(255, 255, 255, 0.5)';
      ctx.stroke();
    }
    for (const s of battle.ships) {
      if (!s.alive || s.sinking > 0) continue;
      const [px, py] = toPx(s.x, s.z);
      if (px < 0 || py < 0 || px > SIZE || py > SIZE) continue;
      const sel = selected.has(s.id);
      const friend = s.team === this.team;
      ctx.fillStyle = sel ? '#ffffff' : tone(s.spec.faction);
      ctx.strokeStyle = friend ? 'rgba(255, 255, 255, 0.85)' : foeRing;
      ctx.lineWidth = friend ? 0.7 : 1.2;
      const r = s.spec.length > 30 ? 3.4 : s.spec.length > 20 ? 2.8 : 2.2;
      ctx.beginPath();
      ctx.arc(px, py, sel ? r + 1 : r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const [cx, cy] = toPx(camX, camZ);
    const dirX = -Math.cos(yaw);
    const dirZ = -Math.sin(yaw);
    const spread = 0.55;
    const len = 46;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const a = Math.atan2(dirZ, dirX);
    ctx.lineTo(cx + Math.cos(a - spread) * len, cy + Math.sin(a - spread) * len);
    ctx.lineTo(cx + Math.cos(a + spread) * len, cy + Math.sin(a + spread) * len);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
