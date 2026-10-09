import type { Faction } from '../sim/types';

// Canvas code cannot read CSS variables per draw, so the faction colours are read once from :root (styles.css).
const FALLBACK: Record<Faction, string> = { joseon: '#3a86d6', japan: '#d2453d', ming: '#e2a53b' };
const cache = new Map<string, string>();

function token(name: string, fallback: string): string {
  const hit = cache.get(name);
  if (hit) return hit;
  let value = '';
  try {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  } catch {
    // no DOM yet: the fallback matches the stylesheet
  }
  const out = value || fallback;
  if (value) cache.set(name, out);
  return out;
}

export const factionColor = (f: Faction) => token(`--${f}`, FALLBACK[f]);
export const sealColor = () => token('--seal', '#c2372e');

/** `rgba()` from a `#rrggbb` token. */
export function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
