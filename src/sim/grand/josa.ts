/**
 * Korean postpositions that agree with the last sound of the word before them: 이/가, 은/는, 을/를,
 * 와/과, 으로/로. Pure and deterministic, so the campaign core and the UI can both build log lines
 * from place and fleet names without leaving "(가)" placeholders in the text.
 */

/** Each pair is written the way Korean dictionaries list it: the form after a final consonant first. */
export type JosaPair = '이/가' | '은/는' | '을/를' | '과/와' | '으로/로';

/** Latin letters read the way Korean says them; only these end in a consonant (엘 엠 엔 알). */
const LATIN_FINAL = new Set(['l', 'm', 'n', 'r']);
/** Digits read as Sino-Korean numerals (영 일 이 삼 사 오 육 칠 팔 구): these end in a consonant. */
const DIGIT_CLOSED = new Set(['0', '3', '6']);
/** 일 칠 팔 end in ㄹ, which takes 로 like a vowel. */
const DIGIT_RIEUL = new Set(['1', '7', '8']);
/** Closing brackets, quotes and punctuation never decide the particle. */
const SKIP = /[\s)\]}）］」』”’"'.,·!?:;…~-]/;

type Final = 'none' | 'rieul' | 'consonant';

/** The kind of final sound of the last readable character of `word`. */
function finalSound(word: string): Final {
  const chars = Array.from(word);
  // A trailing note such as "(히젠)" is part of a map label, not of the name that is spoken.
  let end = chars.length;
  const trimmed = word.replace(/\s*[(（][^)）]*[)）]\s*$/, '');
  if (trimmed !== word) end = Array.from(trimmed).length;
  for (let i = end - 1; i >= 0; i--) {
    const ch = chars[i];
    if (SKIP.test(ch)) continue;
    const code = ch.codePointAt(0)!;
    if (code >= 0xac00 && code <= 0xd7a3) {
      const jong = (code - 0xac00) % 28;
      return jong === 0 ? 'none' : jong === 8 ? 'rieul' : 'consonant';
    }
    if (/[0-9]/.test(ch)) return DIGIT_RIEUL.has(ch) ? 'rieul' : DIGIT_CLOSED.has(ch) ? 'consonant' : 'none';
    if (/[a-z]/i.test(ch)) {
      const l = ch.toLowerCase();
      return l === 'l' || l === 'r' ? 'rieul' : LATIN_FINAL.has(l) ? 'consonant' : 'none';
    }
    // Kana: ん is the only one that closes a syllable; hanja has no readable sound here, so it reads as open.
    if (ch === 'ん' || ch === 'ン') return 'consonant';
    return 'none';
  }
  return 'none';
}

/** The particle alone, e.g. josa('옥포', '을/를') === '를'. */
export function particle(word: string, pair: JosaPair): string {
  const [closed, open] = pair.split('/');
  const f = finalSound(word);
  if (pair === '으로/로') return f === 'consonant' ? closed : open;
  return f === 'none' ? open : closed;
}

/** The word followed by its particle, e.g. josa('거제 · 옥포', '을/를') === '거제 · 옥포를'. */
export function josa(word: string, pair: JosaPair): string {
  return word + particle(word, pair);
}
