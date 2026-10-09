import { EN_BATTLE } from './battle';
import { EN_CAMPAIGN } from './campaign';
import { EN_COMMON } from './common';
import { EN_MENUS } from './menus';
import { EN_ONLINE } from './online';
import { EN_SIM } from './sim';

/** Every English string, keyed by its Korean source text. Areas are split so parallel work does not collide. */
export const EN: Record<string, string> = { ...EN_COMMON, ...EN_SIM, ...EN_MENUS, ...EN_BATTLE, ...EN_CAMPAIGN, ...EN_ONLINE };
