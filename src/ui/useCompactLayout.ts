import { useEffect, useState } from 'react';

// Compact layout for phones (portrait and landscape) and narrow windows. Desktop keeps the full HUD.
export const COMPACT_QUERY = '(max-width: 900px), (max-height: 540px)';

export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);
  return on;
}

export function useCompactLayout(): boolean {
  return useMedia(COMPACT_QUERY);
}

export function usePortrait(): boolean {
  return useMedia('(orientation: portrait)');
}
