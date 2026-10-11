/** Terrain-adapted game tactics. These names do not assert documented historical formations at these ports. */
export type CoastalFormationKind = 'yeosu-wings' | 'mokpo-depth';
export type CoastalTactic = {
  id: CoastalFormationKind;
  region: 'yeosu' | 'mokpo';
  label: string;
  description: string;
  lateralSpacing: number;
  depthSpacing: number;
  facing: 'broadside' | 'forward';
};
export type CoastalFormationSlot = { x: number; z: number; face: number };

export const COASTAL_TACTICS: Record<CoastalFormationKind, CoastalTactic> = {
  'yeosu-wings': {
    id: 'yeosu-wings', region: 'yeosu', label: '여수 분산익진',
    description: '세 익을 나누어 섬 사이 수로에 분산하고 현측 화포를 펼칩니다.',
    lateralSpacing: 64, depthSpacing: 76, facing: 'broadside',
  },
  'mokpo-depth': {
    id: 'mokpo-depth', region: 'mokpo', label: '목포 수로종심진',
    description: '좁은 복열로 깊게 배치해 수로의 정면과 후속 함대를 잇습니다.',
    lateralSpacing: 56, depthSpacing: 72, facing: 'forward',
  },
};

export function coastalTacticFor(region: string): CoastalFormationKind | undefined {
  return region === 'yeosu' ? 'yeosu-wings' : region === 'mokpo' ? 'mokpo-depth' : undefined;
}

/**
 * One slot per selected hull, with no fleet-size gate. `heading` points toward the order's target; the caller rotates
 * it with the map and resolves each slot against its actual water sampler before issuing ship orders. Turning the
 * origin and heading by pi gives the other side an exactly mirrored layout. No global RNG or ship state is touched.
 */
export function coastalFormationSlots(kind: CoastalFormationKind, count: number, origin: { x: number; z: number }, heading: number): CoastalFormationSlot[] {
  const tactic = COASTAL_TACTICS[kind];
  if (!tactic || !Number.isSafeInteger(count) || count <= 0 || ![origin.x, origin.z, heading].every(Number.isFinite)) return [];
  const fx = Math.cos(heading), fz = Math.sin(heading), face = heading + (tactic.facing === 'broadside' ? Math.PI / 2 : 0);
  const slot = (forward: number, side: number): CoastalFormationSlot => ({ x: origin.x + fx * forward - fz * side, z: origin.z + fz * forward + fx * side, face });
  if (count === 1) return [slot(0, 0)];
  if (kind === 'mokpo-depth') {
    // Grow the number of columns for very large fleets so no column needs more than sixty ranks.
    const columns = Math.max(2, Math.ceil(count / 60));
    const rows = Math.ceil(count / columns);
    return Array.from({ length: count }, (_, i) => slot(((rows - 1) / 2 - Math.floor(i / columns)) * tactic.depthSpacing, (i % columns - (columns - 1) / 2) * tactic.lateralSpacing));
  }
  const wings = count === 2 ? [-1, 1] : [-1, 0, 1];
  const sizes = wings.map((_, i) => Math.floor((count + wings.length - 1 - i) / wings.length));
  const columns = sizes.map((n) => Math.min(8, Math.max(1, Math.ceil(Math.sqrt(n * 0.75)))));
  const wingGap = Math.max(...columns) * tactic.lateralSpacing + 180;
  return Array.from({ length: count }, (_, i) => {
    const wingIndex = i % wings.length, wing = wings[wingIndex]!, rank = Math.floor(i / wings.length);
    const cols = columns[wingIndex]!, rows = Math.ceil(sizes[wingIndex]! / cols);
    const forward = ((rows - 1) / 2 - Math.floor(rank / cols)) * tactic.depthSpacing + (wing === 0 ? -90 : 90);
    const side = wing * wingGap + (rank % cols - (cols - 1) / 2) * tactic.lateralSpacing;
    return slot(forward, side);
  });
}
