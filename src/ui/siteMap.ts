import korea from '../select/demMeta.json';
import channel from '../select/channelMeta.json';
import mediterranean from '../select/mediterraneanMeta.json';
import trafalgarSea from '../select/trafalgarSeaMeta.json';
import { chapterOfScenario, type ScenarioId } from '../sim/scenarios';
import type { ChapterId } from '../routes';
import { isPhone, isTouchOnly } from '../game/device';
import { params } from './launch';

// The same lon/lat -> map uv projection as src/select/SelectScene.ts, without importing three.js: phones draw the
// static map (/ui/map_south.webp, baked from the same DEM window) and place markers with this.
export const SITES: Record<ScenarioId, { lon: number; lat: number }> = {
  okpo: { lon: 128.69, lat: 34.89 },
  sacheon: { lon: 128.07, lat: 34.97 },
  dangpo: { lon: 128.39, lat: 34.79 },
  hansan: { lon: 128.48, lat: 34.79 },
  angolpo: { lon: 128.8, lat: 35.08 },
  busan: { lon: 129.05, lat: 35.1 },
  chilcheon: { lon: 128.62, lat: 34.98 },
  myeongnyang: { lon: 126.31, lat: 34.57 },
  noryang: { lon: 127.87, lat: 34.94 },
  plymouth: { lon: -4.25, lat: 50.25 },
  portland: { lon: -2.45, lat: 50.5 },
  wight: { lon: -1.25, lat: 50.55 },
  calais: { lon: 1.8, lat: 50.98 },
  gravelines: { lon: 2.05, lat: 51.06 },
  preveza: { lon: 20.72, lat: 38.95 },
  djerba: { lon: 10.86, lat: 33.92 },
  'lepanto-north': { lon: 21.1, lat: 38.33 },
  'lepanto-centre': { lon: 21.15, lat: 38.27 },
  'lepanto-south': { lon: 21.2, lat: 38.2 },
  'st-vincent': { lon: -9.4, lat: 36.9 },
  nile: { lon: 30.1, lat: 31.35 },
  finisterre: { lon: -11.5, lat: 43.6 },
  'trafalgar-weather': { lon: -6.25, lat: 36.25 },
  'trafalgar-lee': { lon: -6.22, lat: 36.2 },
};

type Meta = { zoom: number; x0: number; x1: number; y0: number; y1: number; width: number; height: number };
const lonToX = (meta: Meta, lon: number) => ((lon + 180) / 360) * 2 ** meta.zoom;
const latToY = (meta: Meta, lat: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** meta.zoom;
};

/**
 * The flat map each chapter's battles are pinned on (scripts/build-ui-map.mjs): the south coast of Korea, the English
 * Channel for the Armada, the central Mediterranean for Lepanto (Djerba to Preveza), and Iberia to the Nile for Trafalgar.
 */
const MAPS: Record<ChapterId, { image: string; meta: Meta }> = {
  imjin: { image: '/ui/map_south.webp', meta: korea },
  armada: { image: '/ui/map_channel.webp', meta: channel },
  lepanto: { image: '/ui/map_mediterranean.webp', meta: mediterranean },
  trafalgar: { image: '/ui/map_trafalgar.webp', meta: trafalgarSea },
};

export const mapOf = (id: ScenarioId) => MAPS[chapterOfScenario(id)];
export const mapImageOf = (id: ScenarioId) => mapOf(id).image;

export function siteUV(id: ScenarioId) {
  const s = SITES[id];
  const { meta } = mapOf(id);
  return { u: (lonToX(meta, s.lon) - meta.x0) / (meta.x1 - meta.x0), v: (latToY(meta, s.lat) - meta.y0) / (meta.y1 - meta.y0) };
}

/** Phones and touch-only tablets draw the flat map image instead of the 3D relief (`?map=static` forces it). */
export const flatMap = isPhone || isTouchOnly || params.get('map') === 'static';

/** Marker label: the battle's name without the generic suffix or prefix (Korean "옥포 해전", English "Battle of Okpo"). */
export const shortTitle = (title: string) =>
  title.replace(/ (해전|대첩|화공)$/, '').replace(/^Battle of (the )?/, '');
