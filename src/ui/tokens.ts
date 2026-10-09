import type { Faction } from '../sim/types';

// Canvas code cannot read CSS variables per draw, so the palette is read once from :root (styles.css).
const FALLBACK: Record<string, string> = { '--joseon': '#87a3ba', '--japan': '#b8968a', '--ming': '#c8a96c' };
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
  const out = value || FALLBACK[name] || '#f1f3f5';
  if (value) cache.set(name, out);
  return out;
}

export const factionColor = (f: Faction) => token(`--${f}`);

/** `rgba()` from a `#rrggbb` token. */
export function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

