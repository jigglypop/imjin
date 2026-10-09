import type { Faction } from '../sim/types';

// Canvas code cannot read CSS variables per draw, so the palette is read once from :root (styles.css).
const FALLBACK: Record<string, string> = { '--joseon': '#46637a', '--japan': '#6b4a40', '--ming': '#8c7040', '--bad': '#8c4b3f', '--ink': '#1b1e22' };
const cache = new Map<string, string>();

function token(name: string): string {
  const hit = cache.get(name);
  if (hit) return hit;
  let value = '';
  try {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  } catch {
    // no DOM yet: the fallback matches the stylesheet
  }
  const out = value || FALLBACK[name] || '#1b1e22';
  if (value) cache.set(name, out);
  return out;
}

export const factionColor = (f: Faction) => token(`--${f}`);
export const sealColor = () => token('--bad');
export const inkColor = () => token('--ink');

/** `rgba()` from a `#rrggbb` token. */
export function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** A `#rrggbb` token mixed toward white, for marks that sit on the dark sea of the minimap. */
export function lighten(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}
