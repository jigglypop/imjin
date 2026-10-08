import { useEffect, useState } from 'react';

// Compact layout for phones (portrait and landscape) and narrow windows. Desktop keeps the full HUD.
export const COMPACT_QUERY = '(max-width: 900px), (max-height: 540px)';

export function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(() => matchMedia(COMPACT_QUERY).matches);
  useEffect(() => {
    const mq = matchMedia(COMPACT_QUERY);
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return compact;
}
