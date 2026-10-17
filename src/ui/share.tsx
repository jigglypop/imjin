import { useEffect, useState } from 'react';
import { chapterOfBattle, routePath } from '../routes';
import { chapterDef } from '../chapters';
import { getLang, t, useT } from '../i18n';
import { SCENARIOS, type ScenarioId } from '../sim/scenarios';
import { sound } from '../audio/Sound';
import { Check, Share } from './icons';

/** A shared link names the site itself, never the address this page was opened at (a test server, launch hooks). */
const SITE = 'https://imjin1592.com';

/**
 * Shares a battle's page, which opens its briefing and previews with its own scene (vite.config.ts), through the
 * system's share sheet; where there is none, as on most desktop browsers and in KakaoTalk's own browser, the link is
 * copied instead, and where even that is refused it is shown to copy by hand. `line` goes with the link.
 */
async function shareBattle(id: ScenarioId, line: string): Promise<'shared' | 'copied' | 'other'> {
  const url = SITE + routePath('select', getLang(), id);
  // The chapter the battle belongs to names the share: 임진왜란, 아르마다.
  const site = t(chapterDef(chapterOfBattle(id)).title);
  if (navigator.share) {
    try {
      await navigator.share({ title: `${t(SCENARIOS[id].title)} · ${site}`, text: line, url });
      return 'shared';
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'other';
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    window.prompt(t('링크를 복사해 보낼 수 있습니다'), url);
    return 'other';
  }
}

/** The share button of a battle: it says so for a moment when the link went to the clipboard rather than a share sheet. */
export function ShareButton({ id, line, label }: { id: ScenarioId; line: string; label?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const done = window.setTimeout(() => setCopied(false), 2400);
    return () => window.clearTimeout(done);
  }, [copied]);
  return (
    <button
      type="button"
      className="chip share-btn"
      onClick={async () => {
        sound.click();
        if ((await shareBattle(id, line)) === 'copied') setCopied(true);
      }}
    >
      {copied ? <Check size={15} /> : <Share size={15} />}
      <span>{copied ? t('링크를 복사했습니다') : (label ?? t('공유'))}</span>
    </button>
  );
}
