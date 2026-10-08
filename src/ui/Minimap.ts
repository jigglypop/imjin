import type { Battle } from '../sim/battle';
import type { Team } from '../sim/types';
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
  /** The player's team, drawn blue. The other team is red. */
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
          r = 232 - depth * 18;
          g = 224 - depth * 14;
          b = 205 - depth * 6;
        } else {
          const e = Math.min(1, v / 420);
          const right = h[j * SIZE + Math.min(SIZE - 1, i + 1)]!;
          const down = h[Math.min(SIZE - 1, j + 1) * SIZE + i]!;
          const shade = Math.max(-1, Math.min(1, (v - right + (v - down)) * 0.035));
          const ink = 150 - e * 85 - shade * 28;
          r = ink + 12;
          g = ink + 8;
          b = ink;
        }
        const coast = (v > 0) !== (h[j * SIZE + Math.min(SIZE - 1, i + 1)]! > 0) || (v > 0) !== (h[Math.min(SIZE - 1, j + 1) * SIZE + i]! > 0);
        if (coast) {
          r = 40;
          g = 34;
          b = 28;
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
    const toPx = (x: number, z: number) => [((x - this.cx) / this.extent + 0.5) * SIZE, ((z - this.cz) / this.extent + 0.5) * SIZE] as const;
    for (const p of points ?? []) {
      const [px, py] = toPx(p.x, p.z);
      ctx.beginPath();
      ctx.arc(px, py, Math.max(5, (p.r / this.extent) * SIZE), 0, Math.PI * 2);
      ctx.fillStyle = p.side === 'own' ? 'rgba(31, 78, 122, 0.28)' : p.side === 'foe' ? 'rgba(154, 42, 32, 0.28)' : 'rgba(23, 19, 15, 0.08)';
      ctx.fill();
      ctx.lineWidth = p.selected ? 2.5 : 1.4;
      ctx.strokeStyle = p.side === 'own' ? '#1f4e7a' : p.side === 'foe' ? '#9a2a20' : 'rgba(23, 19, 15, 0.55)';
      ctx.stroke();
    }
    for (const s of battle.ships) {
      if (!s.alive || s.sinking > 0) continue;
      const [px, py] = toPx(s.x, s.z);
      if (px < 0 || py < 0 || px > SIZE || py > SIZE) continue;
      const sel = selected.has(s.id);
      ctx.fillStyle = sel ? '#e2a93c' : s.team === this.team ? '#1f4e7a' : '#9a2a20';
      const r = s.spec.length > 30 ? 3.2 : s.spec.length > 20 ? 2.6 : 2;
      ctx.beginPath();
      ctx.arc(px, py, sel ? r + 1 : r, 0, Math.PI * 2);
      ctx.fill();
    }
    const [cx, cy] = toPx(camX, camZ);
    const dirX = -Math.cos(yaw);
    const dirZ = -Math.sin(yaw);
    const spread = 0.55;
    const len = 46;
    ctx.fillStyle = 'rgba(23, 19, 15, 0.18)';
    ctx.strokeStyle = 'rgba(23, 19, 15, 0.7)';
    ctx.lineWidth = 1.5;
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
