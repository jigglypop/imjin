import type { ShipKind } from '../sim/types';

// Kept apart from Hud.tsx so the menu screens can use it without pulling in the battle chunk.
export const KIND_HANJA: Record<ShipKind, string> = {
  panokseon: '板',
  geobukseon: '龜',
  hyeopseon: '挾',
  atakebune: '安',
  sekibune: '關',
  kobaya: '小',
  mingship: '明',
  mingsmall: '沙',
};
