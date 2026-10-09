import { getLang, t } from '../i18n';

/**
 * Ship, squadron and commander names are Korean data in the sim. The ones in the scenarios have English entries; the
 * generated ones ("판옥선 3호", "전라좌수영 대장선", "부산포 정박 2진") are built here from the translated stem and a
 * numbered pattern.
 */
export function tName(name: string): string {
  if (getLang() === 'ko') return name;
  const direct = t(name);
  if (direct !== name) return direct;
  let m = /^(.+) (\d+)호$/.exec(name);
  if (m) return t('{name} {n}호', { name: tName(m[1]!), n: Number(m[2]) });
  m = /^(.+) 대장선$/.exec(name);
  if (m) return t('{name} 대장선', { name: tName(m[1]!) });
  m = /^(.+) (\d+)대$/.exec(name);
  if (m) return t('{name} {n}대', { name: tName(m[1]!), n: Number(m[2]) });
  m = /^(.+) (\d+)진$/.exec(name);
  if (m) return t('{name} {n}진', { name: tName(m[1]!), n: Number(m[2]) });
  return name;
}

/** "3척" in Korean; English needs the singular for one ship. */
export function tShips(n: number): string {
  return n === 1 ? t('1척') : t('{n}척', { n });
}

/** A commander line may hold several people ("거제현령 안위 · 중군장 김응함"): each part is translated on its own. */
export function tCommander(commander: string): string {
  if (getLang() === 'ko') return commander;
  const whole = t(commander);
  if (whole !== commander) return whole;
  return commander
    .split(' · ')
    .map((part) => t(part))
    .join(' · ');
}
