import type { Ship } from './types';

const OFFSET = 4096;

export class ShipGrid {
  private readonly cells = new Map<number, Ship[]>();
  private readonly used: Ship[][] = [];

  constructor(readonly cell = 120) {}

  private key(cx: number, cz: number) {
    return (cx + OFFSET) * 8192 + (cz + OFFSET);
  }

  rebuild(ships: Ship[]) {
    for (const list of this.used) list.length = 0;
    this.used.length = 0;
    for (const s of ships) {
      if (!s.alive) continue;
      const k = this.key(Math.floor(s.x / this.cell), Math.floor(s.z / this.cell));
      let list = this.cells.get(k);
      if (!list) {
        list = [];
        this.cells.set(k, list);
      }
      if (list.length === 0) this.used.push(list);
      list.push(s);
    }
  }

  query(x: number, z: number, r: number, fn: (s: Ship) => void) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c);
    const x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c);
    const z1 = Math.floor((z + r) / c);
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cz = z0; cz <= z1; cz += 1) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i += 1) fn(list[i]!);
      }
    }
  }
}
