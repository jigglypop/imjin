import type { TheatreId } from '../../sim/grand/types';

// Which theatre's world the campaign map draws. The map's modules size their terrain, sea and projection from the
// theatre's DEM when they are first evaluated (mapTheatre.ts), so the page draws one theatre's world: the first campaign
// screen opened decides it, read from the address (/armada/campaign is the Armada's). Opening another theatre's campaign
// later on the same page reloads it (App.tsx asks `needsReload`). No imports beyond types: anything may read this.

/** The theatre a chapter's campaign is fought in. A chapter without a campaign of its own has none. */
export const theatreOfChapter = (chapter: string): TheatreId | null =>
  chapter === 'armada' ? 'armada' : chapter === 'lepanto' ? 'lepanto' : chapter === 'imjin' ? 'imjin' : null;

/** The theatre the address names, without fixing anything: /armada/campaign is the Armada's, /lepanto/campaign Lepanto's, the rest 1592's. */
export const theatreOfAddress = (): TheatreId => fromAddress();

const fromAddress = (): TheatreId => {
  const path = typeof location === 'undefined' ? '/' : location.pathname;
  const m = /^\/(?:en\/|ko\/)?(armada|lepanto)(?:\/|$)/.exec(path);
  return m ? (m[1] as 'armada' | 'lepanto') : 'imjin';
};

let locked: TheatreId | null = null;

/** The theatre the map's modules were (or are about to be) built for. The first call fixes it for the page. */
export function mapTheatreId(): TheatreId {
  locked ??= fromAddress();
  return locked;
}

/** Fixes the theatre before the map's modules are loaded, when nothing has fixed it yet. Returns whether it holds now. */
export function chooseMapTheatre(id: TheatreId): boolean {
  locked ??= id;
  return locked === id;
}

/** True when the map was built for another theatre than `id`: the page must load again to draw `id`'s world. */
export const needsReload = (id: TheatreId) => locked !== null && locked !== id;
