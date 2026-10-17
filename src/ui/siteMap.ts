import korea from '../select/demMeta.json';
import channel from '../select/channelMeta.json';
import { isArmadaBattle } from '../sim/armada';
import type { ScenarioId } from '../sim/scenarios';
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
};

type Meta = typeof korea;
const lonToX = (meta: Meta, lon: number) => ((lon + 180) / 360) * 2 ** meta.zoom;
const latToY = (meta: Meta, lat: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** meta.zoom;
};

/** The flat map a battle is pinned on: the south coast of Korea, or the English Channel for the Armada (scripts/build-ui-map.mjs). */
export const mapImageOf = (id: ScenarioId) => (isArmadaBattle(id) ? '/ui/map_channel.webp' : '/ui/map_south.webp');

export function siteUV(id: ScenarioId) {
  const s = SITES[id];
  const meta: Meta = isArmadaBattle(id) ? channel : korea;
  return { u: (lonToX(meta, s.lon) - meta.x0) / (meta.x1 - meta.x0), v: (latToY(meta, s.lat) - meta.y0) / (meta.y1 - meta.y0) };
}

/** Phones and touch-only tablets draw the flat map image instead of the 3D relief (`?map=static` forces it). */
export const flatMap = isPhone || isTouchOnly || params.get('map') === 'static';

/** Marker label: the battle's name without the generic suffix or prefix (Korean "옥포 해전", English "Battle of Okpo"). */
export const shortTitle = (title: string) =>
  title.replace(/ (해전|대첩|화공)$/, '').replace(/^Battle of (the )?/, '');
