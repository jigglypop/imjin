import { create } from 'zustand';
import { josa, type JosaPair } from '../sim/grand/josa';
import { EN } from './en';

/**
 * Korean and English. Korean is the source language: every player-facing string is written in Korean in the code and
 * looked up by that exact text, so a missing translation falls back to readable Korean instead of a key.
 *
 *   t('전투 시작')                                  -> 'Start battle'
 *   t('{n}척', { n: 12 })                           -> '12 ships'
 *   t('{who|이/가} {place|을/를} 차지했습니다', ...)  -> Korean picks 이/가 and 을/를 from the word; English uses
 *                                                     its own template ('{who} took {place}') and ignores the pair.
 *
 * Components call useT() so they re-render when the language changes; code outside React calls t() and reads the
 * language at that moment. scripts/i18n-check.mjs lists strings without a translation and Korean text not passed
 * through t().
 */

export type Lang = 'ko' | 'en';
const STORAGE_KEY = 'imjin.lang';

function stored(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'ko' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

function initialLang(): Lang {
  if (typeof location !== 'undefined') {
    const p = new URLSearchParams(location.search).get('lang');
    if (p === 'ko' || p === 'en') return p;
  }
  const s = typeof localStorage !== 'undefined' ? stored() : null;
  if (s) return s;
  // First visit: Korean for Korean browsers, English for everyone else.
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : 'ko';
  return nav.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export const useLangStore = create<{ lang: Lang }>(() => ({ lang: initialLang() }));

if (typeof document !== 'undefined') document.documentElement.lang = useLangStore.getState().lang;

export function getLang(): Lang {
  return useLangStore.getState().lang;
}

export function setLang(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Not persisted; the choice still applies to this page.
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  useLangStore.setState({ lang });
}

export type Params = Record<string, string | number>;

const PLACEHOLDER = /\{(\w+)(?:\|([^}]+))?\}/g;

function format(template: string, params: Params | undefined, korean: boolean): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER, (whole, key: string, pair?: string) => {
    const value = params[key];
    if (value === undefined) return whole;
    const text = typeof value === 'number' ? value.toLocaleString(korean ? 'ko-KR' : 'en-US') : value;
    return korean && pair ? josa(text, pair as JosaPair) : text;
  });
}

/** The player-facing text for `ko` (the Korean source string) in the current language. */
export function t(ko: string, params?: Params): string {
  const lang = useLangStore.getState().lang;
  if (lang === 'ko') return format(ko, params, true);
  return format(EN[ko] ?? ko, params, false);
}

/** t() for React components: re-renders the component when the language changes. */
export function useT(): typeof t {
  useLangStore((s) => s.lang);
  return t;
}

/** The current language for React components. */
export function useLang(): Lang {
  return useLangStore((s) => s.lang);
}
