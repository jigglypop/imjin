/**
 * Where each ship of a formation goes, worked out on the client so the very slots the player sees in the preview are
 * the ones sent to the battle (as `slot` orders, which the server accepts like any other).
 *
 * A formation is laid along a front: from (x0, z0) to (x1, z1) on the sea. The ships face across it, to the side a
 * left-to-right drag on screen points away from the camera: the front's direction turned a quarter to the right.
 */
export type DragFormation = 'crane' | 'line' | 'column' | 'wedge';
export type FormationSlot = { id: number; x: number; z: number; face: number };
type ShipPos = { id: number; x: number; z: number; flagship?: boolean };

export const DRAG_FORMATIONS: DragFormation[] = ['crane', 'line', 'column', 'wedge'];
/** Gaps between neighbouring ships, in metres: tighter than this they foul each other, wider and the line breaks. */
const MIN_GAP = 36;
const MAX_GAP = 140;
const LINE_GAP = 52;
const COLUMN_GAP = 60;
const WEDGE_BACK = 52;
const WEDGE_SIDE = 44;

/** The front's unit direction and the facing across it. */
export function frontAxes(x0: number, z0: number, x1: number, z1: number) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const lx = len > 1e-3 ? (x1 - x0) / len : 1;
  const lz = len > 1e-3 ? (z1 - z0) / len : 0;
  return { len, lx, lz, fx: lz, fz: -lx };
}

export function layoutFormation(kind: DragFormation, ships: ShipPos[], x0: number, z0: number, x1: number, z1: number): FormationSlot[] {
  const n = ships.length;
  if (!n) return [];
  const { len, lx, lz, fx, fz } = frontAxes(x0, z0, x1, z1);
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const facing = Math.atan2(fz, fx);
  const along = Math.atan2(lz, lx);
  if (n === 1) return [{ id: ships[0]!.id, x: cx, z: cz, face: kind === 'line' || kind === 'crane' ? along : facing }];
  const gap = Math.min(MAX_GAP, Math.max(MIN_GAP, len > 1 ? len / (n - 1) : LINE_GAP));
  const width = gap * (n - 1);
  const byLateral = [...ships].sort((a, b) => (a.x - cx) * lx + (a.z - cz) * lz - ((b.x - cx) * lx + (b.z - cz) * lz));
  const byDepth = [...ships].sort((a, b) => (b.x - cx) * fx + (b.z - cz) * fz - ((a.x - cx) * fx + (a.z - cz) * fz));
  switch (kind) {
    case 'line':
      // Bows along the front, so every broadside bears on what lies ahead of it.
      return byLateral.map((s, i) => {
        const u = i * gap - width / 2;
        return { id: s.id, x: cx + lx * u, z: cz + lz * u, face: along };
      });
    case 'crane': {
      // The crane's wings reach forward round the enemy; each ship lies along the curve, its broadside to the bowl.
      const depth = width * 0.38;
      const half = width / 2;
      return byLateral.map((s, i) => {
        const u = i * gap - half;
        const k = u / half;
        const fwd = depth * k * k;
        const slope = (2 * depth * k) / half;
        return { id: s.id, x: cx + lx * u + fx * fwd, z: cz + lz * u + fz * fwd, face: Math.atan2(lz + fz * slope, lx + fx * slope) };
      });
    }
    case 'column': {
      // One file behind the flagship, which takes the head at the front's middle.
      const order = withLeaderFirst(byDepth);
      return order.map((s, i) => ({ id: s.id, x: cx - fx * i * COLUMN_GAP, z: cz - fz * i * COLUMN_GAP, face: facing }));
    }
    case 'wedge': {
      // The point at the front's middle, the ranks falling back to either side, the flagship at the point.
      const order = withLeaderFirst(byDepth);
      const spread = Math.min(1.6, Math.max(0.7, len / Math.max(1, Math.ceil((n - 1) / 2) * WEDGE_SIDE * 2)));
      return order.map((s, rank) => {
        const row = Math.ceil(rank / 2);
        const side = rank === 0 ? 0 : rank % 2 === 1 ? -1 : 1;
        return { id: s.id, x: cx - fx * row * WEDGE_BACK + lx * side * row * WEDGE_SIDE * spread, z: cz - fz * row * WEDGE_BACK + lz * side * row * WEDGE_SIDE * spread, face: facing };
      });
    }
  }
}

function withLeaderFirst(ships: ShipPos[]) {
  const i = ships.findIndex((s) => s.flagship);
  if (i <= 0) return ships;
  return [ships[i]!, ...ships.slice(0, i), ...ships.slice(i + 1)];
}

/**
 * The front a formation button lays without a drag: across the line from the fleet to the enemy, near enough to fight.
 * `fleet` and `enemy` are the two centroids; `n` the number of ships.
 */
export function autoFront(kind: DragFormation, n: number, fleet: { x: number; z: number }, enemy: { x: number; z: number }) {
  const dx = enemy.x - fleet.x;
  const dz = enemy.z - fleet.z;
  const d = Math.hypot(dx, dz) || 1;
  const ux = dx / d;
  const uz = dz / d;
  // Where the front's middle lies, measured from the fleet toward the enemy.
  let at: number;
  let width: number;
  if (kind === 'crane') {
    const radius = Math.max(320, n * 32);
    at = Math.max(0, d - radius);
    width = Math.min(radius * 1.9, (n - 1) * MAX_GAP);
  } else if (kind === 'line') {
    at = Math.max(0, d - Math.min(380, d * 0.8));
    width = (n - 1) * LINE_GAP;
  } else {
    at = Math.min(600, d * 0.5);
    width = (n - 1) * WEDGE_SIDE;
  }
  const cx = fleet.x + ux * at;
  const cz = fleet.z + uz * at;
  // The front runs so its facing (the direction turned a quarter right) points at the enemy: direction = (-uz, ux).
  const lx = -uz;
  const lz = ux;
  const h = Math.max(1, width) / 2;
  return { x0: cx - lx * h, z0: cz - lz * h, x1: cx + lx * h, z1: cz + lz * h };
}

/** The front of a formation centred on (cx, cz), `width` wide, facing the angle `face`. */
export function frontAt(cx: number, cz: number, face: number, width: number) {
  // The facing is the front's direction turned a quarter right, so the front runs along (-sin, cos) of it.
  const lx = -Math.sin(face);
  const lz = Math.cos(face);
  const h = Math.max(1, width) / 2;
  return { x0: cx - lx * h, z0: cz - lz * h, x1: cx + lx * h, z1: cz + lz * h };
}
