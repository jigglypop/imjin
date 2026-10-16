import type { Ship, Team } from './types';

/** Above this many cells in the occupied box (a fleet scattered over a whole sea) the cells are not laid out densely. */
const MAX_DENSE = 1 << 20;

/**
 * Live ships by square cell. The cells of the box the fleets occupy are laid out densely: each cell's ships sit in one
 * array in the order of the battle's ship list (a counting sort), so a look-up reads a slice instead of hashing a key,
 * and a query never visits cells outside the box. Queries call fn in the same order a hash of cells did: cell columns
 * west to east, each column north to south, the ships of a cell in list order.
 */
export class ShipGrid {
  private ships: Ship[] = [];
  /** Start of each cell's run in `ships`; one entry more than there are cells. */
  private starts = new Int32Array(1);
  private cellOf = new Int32Array(0);
  private x0 = 0;
  private z0 = 0;
  private w = 0;
  private h = 0;
  /** For a box too large to lay out: the cells by key, as before. */
  private sparse: Map<number, Ship[]> | null = null;

  constructor(readonly cell = 120) {}

  /** `team`: only that side's ships, kept in the same order as in the grid of both. */
  rebuild(ships: Ship[], team?: Team) {
    const c = this.cell;
    // A ship off the map's numbers (NaN) sat in a cell of its own that no query reached; it is simply left out.
    const take = (s: Ship) => s.alive && (!team || s.team === team) && Number.isFinite(s.x) && Number.isFinite(s.z);
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    let n = 0;
    for (const s of ships) {
      if (!take(s)) continue;
      const cx = Math.floor(s.x / c);
      const cz = Math.floor(s.z / c);
      if (cx < x0) x0 = cx;
      if (cx > x1) x1 = cx;
      if (cz < z0) z0 = cz;
      if (cz > z1) z1 = cz;
      n += 1;
    }
    if (n === 0) {
      this.w = 0;
      this.h = 0;
      this.sparse = null;
      this.ships.length = 0;
      return;
    }
    const w = x1 - x0 + 1;
    const h = z1 - z0 + 1;
    this.x0 = x0;
    this.z0 = z0;
    this.w = w;
    this.h = h;
    if (w * h > MAX_DENSE) {
      const cells = new Map<number, Ship[]>();
      for (const s of ships) {
        if (!take(s)) continue;
        const k = (Math.floor(s.x / c) - x0) * h + (Math.floor(s.z / c) - z0);
        let list = cells.get(k);
        if (!list) cells.set(k, (list = []));
        list.push(s);
      }
      this.sparse = cells;
      return;
    }
    this.sparse = null;
    const cellsN = w * h;
    if (this.starts.length < cellsN + 1) this.starts = new Int32Array(Math.max(cellsN + 1, this.starts.length * 2));
    if (this.cellOf.length < n) this.cellOf = new Int32Array(Math.max(n, this.cellOf.length * 2));
    const starts = this.starts;
    starts.fill(0, 0, cellsN + 1);
    const cellOf = this.cellOf;
    let i = 0;
    for (const s of ships) {
      if (!take(s)) continue;
      // Column-major (x outer, z inner), the order the queries walk the cells in.
      const k = (Math.floor(s.x / c) - x0) * h + (Math.floor(s.z / c) - z0);
      cellOf[i++] = k;
      starts[k + 1]! += 1;
    }
    for (let k = 0; k < cellsN; k += 1) starts[k + 1]! += starts[k]!;
    const out = this.ships;
    out.length = n;
    // Fills each run in list order; `starts[k]` walks forward as it fills and is put back below.
    i = 0;
    for (const s of ships) {
      if (!take(s)) continue;
      out[starts[cellOf[i++]!]!++] = s;
    }
    for (let k = cellsN; k > 0; k -= 1) starts[k] = starts[k - 1]!;
    starts[0] = 0;
  }

  query(x: number, z: number, r: number, fn: (s: Ship) => void) {
    if (this.w === 0) return;
    const c = this.cell;
    const h = this.h;
    const ax = Math.max(Math.floor((x - r) / c), this.x0) - this.x0;
    const bx = Math.min(Math.floor((x + r) / c), this.x0 + this.w - 1) - this.x0;
    const az = Math.max(Math.floor((z - r) / c), this.z0) - this.z0;
    const bz = Math.min(Math.floor((z + r) / c), this.z0 + h - 1) - this.z0;
    if (ax > bx || az > bz) return;
    const sparse = this.sparse;
    if (sparse) {
      for (let cx = ax; cx <= bx; cx += 1) {
        for (let cz = az; cz <= bz; cz += 1) {
          const list = sparse.get(cx * h + cz);
          if (!list) continue;
          for (let i = 0; i < list.length; i += 1) fn(list[i]!);
        }
      }
      return;
    }
    const starts = this.starts;
    const ships = this.ships;
    for (let cx = ax; cx <= bx; cx += 1) {
      // The cells of one column are consecutive, so their ships are one run.
      const end = starts[cx * h + bz + 1]!;
      for (let i = starts[cx * h + az]!; i < end; i += 1) fn(ships[i]!);
    }
  }
}
