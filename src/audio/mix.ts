// Where the bed and the sea sit for each screen. Kept apart from Sound.ts (which touches the page) so the offline
// renderer mixes a battle with the same numbers the game uses.

export type Mode = 'select' | 'battle';

/** Gain of the music bed and of the sea per screen: the guns are what a battle is for. */
export const LEVELS: Record<Mode, { music: number; ambience: number }> = {
  select: { music: 0.55, ambience: 0.9 },
  battle: { music: 0.25, ambience: 1.5 },
};
