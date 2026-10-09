import { t, type Params } from '../../i18n';
import type { LogEntry, MsgParams } from '../../sim/grand/types';

/**
 * Words and sentences of the faction campaign in the language the player has set. The campaign keeps names and log
 * lines as Korean source text (they are saved with the war); these functions turn them into the current language at the
 * moment they are drawn.
 */

/**
 * Names the campaign builds from data: "여수 신규 함대" is a new fleet at a port, "판옥선 12호" the twelfth ship made.
 * Each template is a translation key; the part after {base} is what the name ends with. The last one is a detachment
 * of a save from before the rename.
 */
const FLEET_TEMPLATES = ['{base} 신규 함대', '{base} 분견 함대', '{base} 분견대'];

/** A name from the campaign's data (place, fleet, ship, officer, work) in the current language. */
export function tName(name: string): string {
  const numbered = /^(.+) (\d+)호$/.exec(name);
  if (numbered) return t('{kind} {n}호', { kind: tName(numbered[1]!), n: numbered[2]! });
  for (const template of FLEET_TEMPLATES) {
    const ending = template.slice('{base}'.length);
    if (name.endsWith(ending) && name.length > ending.length) return t(template, { base: tName(name.slice(0, -ending.length)) });
  }
  return t(name);
}

/** A Korean template with its parameters, the names among them translated first. */
export function tt(text: string, params?: MsgParams): string {
  if (!params) return t(text);
  const out: Params = {};
  for (const [key, value] of Object.entries(params)) out[key] = typeof value === 'string' ? tName(value) : value;
  return t(text, out);
}

/** A line of the war's log. A save from before the templates holds finished Korean and no params. */
export const logText = (entry: Pick<LogEntry, 'text' | 'params'>) => tt(entry.text, entry.params);

/** Counts with their unit; English needs the singular for one. */
export const shipsText = (n: number) => (n === 1 ? t('1척') : t('{n}척', { n }));
export const turnsText = (n: number) => (n === 1 ? t('1턴') : t('{n}턴', { n }));
export const portsText = (n: number) => (n === 1 ? t('1곳') : t('{n}곳', { n }));
export const fleetsText = (n: number) => (n === 1 ? t('1개') : t('{n}개', { n }));
