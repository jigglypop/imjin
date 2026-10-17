import type { GunType } from '../sim/types';

/**
 * How a gun looks and sounds. weight: 0..1, the heavy mortar-like guns are 1 (deep thump, long rolling tail, big blast);
 * sharp: 0..1, how bright the crack is (the small guns bark, the heavy ones boom).
 */
export type GunClass = { weight: number; sharp: number };

export const GUN_CLASS: Record<GunType, GunClass> = {
  cheonja: { weight: 1, sharp: 0.3 },
  jija: { weight: 0.9, sharp: 0.38 },
  hyeonja: { weight: 0.72, sharp: 0.5 },
  hwangja: { weight: 0.5, sharp: 0.75 },
  seungja: { weight: 0.3, sharp: 0.88 },
  ozutsu: { weight: 0.62, sharp: 0.62 },
  folangji: { weight: 0.38, sharp: 0.92 },
  hudun: { weight: 0.34, sharp: 0.85 },
  culverin: { weight: 0.8, sharp: 0.45 },
  demiculverin: { weight: 0.62, sharp: 0.58 },
  cannon: { weight: 1, sharp: 0.28 },
  perrier: { weight: 0.7, sharp: 0.5 },
  saker: { weight: 0.42, sharp: 0.78 },
  base: { weight: 0.28, sharp: 0.9 },
};

export const gunClass = (type: GunType | undefined, big: boolean): GunClass => (type ? GUN_CLASS[type] : big ? GUN_CLASS.hyeonja : GUN_CLASS.seungja);
