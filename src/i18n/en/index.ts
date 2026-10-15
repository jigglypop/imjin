import { EN_BATTLE } from './battle';
import { EN_CAMPAIGN } from './campaign';
import { EN_COMMON } from './common';
import { EN_MENUS } from './menus';
import { EN_ONLINE } from './online';
import { EN_SIM } from './sim';
import { EN_EXPANSION } from './expansion';
import { EN_CONQUEST_DEPTH } from './conquest-depth';
import { EN_CONTROLS } from './controls';
import { EN_PORTS } from './ports';
import { EN_DISPATCH } from './dispatch';
import { EN_MARCH } from './march';
import { EN_OFFICERS } from './officers';

/** Every English string, keyed by its Korean source text. Areas are split so parallel work does not collide. */
export const EN: Record<string, string> = { ...EN_COMMON, ...EN_SIM, ...EN_MENUS, ...EN_BATTLE, ...EN_CAMPAIGN, ...EN_ONLINE, ...EN_EXPANSION, ...EN_CONQUEST_DEPTH, ...EN_CONTROLS, ...EN_PORTS, ...EN_DISPATCH, ...EN_MARCH, ...EN_OFFICERS };
