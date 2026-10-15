import { useEffect, useRef, useState } from 'react';

const ART = '/ui/art/';

/**
 * A battle's loading picture in its three cuts (scripts/build-battle-art.mjs): the tall one for phones held upright,
 * else the 960 or the 1920 px wide one, whichever the screen's width in device pixels asks for.
 */
function loadingArt(id: string) {
  return { tall: `${ART}loading_${id}_tall.webp`, wide: `${ART}loading_${id}.webp`, set: `${ART}loading_${id}_sm.webp 960w, ${ART}loading_${id}.webp 1920w` };
}
const PORTRAIT = '(max-aspect-ratio: 9/10)';

/**
 * Starts downloading what a battle's loading page shows before the battle is started, so the page has it from its
 * first frame: its picture (an Image picks from the same srcset the page's picture does, so it fills the same cache
 * entry) and the title face. Skipped when the browser asks to save data.
 */
export function prefetchLoading(id: string) {
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
  void document.fonts?.load("1em 'Imjin Battle'");
  const art = loadingArt(id);
  const img = new Image();
  if (matchMedia(PORTRAIT).matches) img.src = art.tall;
  else {
    img.sizes = '100vw';
    img.srcset = art.set;
    img.src = art.wide;
  }
}

/**
 * A full-bleed key-art picture behind a screen. It fades in once decoded, so the page never waits on it: until then
 * the CSS gradient stands in. The menu's picture mounts a moment after the first paint and downloads at low priority;
 * a battle's loading picture is the page itself, so it starts at once and first.
 * Phones get the small file (tall art in portrait, a 1200 px wide cut in landscape).
 */
export function Backdrop({ kind, id, calm = false, cinematic = false }: { kind: 'menu' | 'loading'; id?: string | null; calm?: boolean; cinematic?: boolean }) {
  const battle = kind === 'loading' && !!id;
  const [mounted, setMounted] = useState(battle);
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
  const art = battle ? loadingArt(id!) : null;
  const full = art ? art.wide : `${ART}${cinematic ? 'menu_battle_wide' : 'menu_hero_wide'}.webp`;
  const small = cinematic ? full : `${ART}menu_hero_wide_sm.webp`;
  return (
    <div className={`art-bg ${calm ? 'art-bg--calm' : ''} ${on ? 'art-bg--on' : ''}`} aria-hidden>
      {mounted && (
        <picture key={full}>
          <source media={PORTRAIT} srcSet={art ? art.tall : `${ART}${cinematic ? 'menu_battle_tall' : 'menu_hero_tall'}.webp`} />
          {!art && <source media="(max-width: 1100px), (max-height: 540px)" srcSet={small} />}
          <img ref={img} src={full} srcSet={art?.set} sizes={art ? '100vw' : undefined} alt="" decoding="async" fetchPriority={art ? 'high' : 'low'} onLoad={() => setOn(true)} />
        </picture>
      )}
    </div>
  );
}
