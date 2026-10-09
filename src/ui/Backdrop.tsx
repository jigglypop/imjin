import { useEffect, useRef, useState } from 'react';

const ART = '/ui/art/';

/**
 * A full-bleed key-art picture behind a screen. It is mounted a moment after the first paint and fades in once
 * decoded, so the page itself never waits on it: until then the CSS mist gradient stands in.
 * Phones get the small file (tall art in portrait, a 1200 px wide cut in landscape).
 */
export function Backdrop({ kind, id, calm = false }: { kind: 'menu' | 'loading'; id?: string; calm?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [on, setOn] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 60);
    return () => window.clearTimeout(t);
  }, []);
  // A cached image can finish decoding before React attaches onLoad.
  useEffect(() => {
    if (mounted && img.current?.complete && img.current.naturalWidth > 0) setOn(true);
  }, [mounted, id]);
  const menu = kind === 'menu' || !id;
  const full = menu ? `${ART}menu_hero_wide.webp` : `${ART}loading_${id}.webp`;
  const small = menu ? `${ART}menu_hero_wide_sm.webp` : `${ART}loading_${id}_sm.webp`;
  return (
    <div className={`art-bg ${calm ? 'art-bg--calm' : ''} ${on ? 'art-bg--on' : ''}`} aria-hidden>
      {mounted && (
        <picture key={full}>
          {menu && <source media="(max-aspect-ratio: 9/10)" srcSet={`${ART}menu_hero_tall.webp`} />}
          <source media="(max-width: 1100px), (max-height: 540px)" srcSet={small} />
          <img ref={img} src={full} alt="" decoding="async" fetchPriority="low" onLoad={() => setOn(true)} />
        </picture>
      )}
    </div>
  );
}
