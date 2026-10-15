import { getLang, t } from '../i18n';
import { routeLine, routeName, routeSlug, type RouteScreen } from '../routes';

// The loading screen of a page (#boot in index.html): it shows the page's art, name and line before the app's code has
// run, and the app reuses it while a screen's own code downloads (App's Chunk). It is one element, hidden rather than
// removed, so its style lives in index.html with it. It only appears 150 ms after it is shown (its CSS animation), so a
// screen whose code is already cached never flashes it.

/** How long the screen must have been up to have become visible; a shorter one goes at once. */
const SHOW_AFTER_MS = 150;
const FADE_MS = 400;

let holders = 0;
let fading = 0;

const boot = () => document.getElementById('boot');

/** Sets the screen's art, name and line in the current language, and starts it from invisible again. */
function show(el: HTMLElement, screen: RouteScreen) {
  const slug = routeSlug(screen) || 'menu';
  const art = `/ui/art/route_${slug}`;
  el.style.setProperty('--art', `url(${art}.webp)`);
  el.style.setProperty('--art-sm', `url(${art}_sm.webp)`);
  el.dataset.route = slug;
  el.dataset.lang = getLang();
  el.querySelector('.rload__name')!.textContent = t(routeName(screen));
  el.querySelector('.rload__line')!.textContent = t(routeLine(screen));
  el.dataset.since = String(performance.now());
  el.classList.remove('rload--out');
  // Hiding and showing again restarts the delayed fade-in.
  el.hidden = true;
  void el.offsetWidth;
  el.hidden = false;
}

/** Fades the screen into the one under it, or hides it at once if it never became visible. */
function hide(el: HTMLElement) {
  window.clearTimeout(fading);
  if (el.hidden) return;
  if (performance.now() - Number(el.dataset.since ?? 0) < SHOW_AFTER_MS) {
    el.hidden = true;
    return;
  }
  el.classList.add('rload--out');
  fading = window.setTimeout(() => {
    el.hidden = true;
    el.classList.remove('rload--out');
  }, FADE_MS);
}

/**
 * Shows `screen`'s loading screen until the returned release is called. The page's own boot screen carries on if it
 * already shows that screen, so opening /campaign goes from the boot screen straight into the campaign.
 */
export function holdRouteLoading(screen: RouteScreen): () => void {
  const el = boot();
  if (!el) return () => {};
  holders += 1;
  window.clearTimeout(fading);
  const same = !el.hidden && !el.classList.contains('rload--out') && el.dataset.route === (routeSlug(screen) || 'menu') && el.dataset.lang === getLang();
  if (!same) show(el, screen);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holders -= 1;
    if (holders === 0) hide(el);
  };
}

/** The app has drawn a screen: the boot screen goes unless a screen still waiting for its code holds it. */
export function releaseBoot() {
  const el = boot();
  if (el && holders === 0) hide(el);
}
