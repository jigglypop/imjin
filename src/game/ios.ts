// iOS Safari behaviours that CSS alone cannot stop.

function scrollsInside(el: Element): boolean {
  const style = getComputedStyle(el);
  const y = (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
  const x = (style.overflowX === 'auto' || style.overflowX === 'scroll') && el.scrollWidth > el.clientWidth;
  return y || x;
}

/**
 * Safari drags the whole page (the rubber band) and pinch-zooms it on touchmove unless the event is cancelled. The page
 * is a fixed app, so a move is cancelled unless it starts inside something that really scrolls (a menu panel, a list).
 * Pointer events are not affected: the game's own touch controls still get every move.
 */
export function installTouchGuard() {
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) {
        e.preventDefault();
        return;
      }
      for (let el = e.target instanceof Element ? e.target : null; el && el !== document.body; el = el.parentElement) {
        if (scrollsInside(el)) return;
      }
      e.preventDefault();
    },
    { passive: false },
  );
}
