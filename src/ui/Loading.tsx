import { useState } from 'react';
import { commanderOf, FACTION_NAME, forcesOf, playableFactions } from '../sim/balance';
import type { Faction } from '../sim/types';
import { useT } from '../i18n';
import { useUi } from '../state/store';
import { Backdrop } from './Backdrop';

// Yi Sun-sin's words keep their traditional wording and register: they are quotations, not UI copy.
const QUOTES: [string, string][] = [
  ['必死則生 必生則死', '죽고자 하면 살 것이요, 살고자 하면 죽을 것이다'],
  ['勿令妄動 靜重如山', '가벼이 움직이지 말고, 태산같이 무겁게 행동하라'],
  ['今臣戰船 尙有十二', '신에게는 아직 열두 척의 배가 남아 있사옵니다'],
  ['若無湖南 是無國家', '호남이 없으면 나라도 없다'],
  ['戰方急 愼勿言我死', '싸움이 급하니 나의 죽음을 알리지 말라'],
  ['一夫當逕 足懼千夫', '한 사람이 길목을 지키면 천 명도 두렵게 할 수 있다'],
];

/** The allies first, the invader last, as on the history screen. */
const ORDER: Faction[] = ['joseon', 'ming', 'japan'];

/**
 * The battle loading screen: a still from the battle itself (or from the historical battle fought on the same coast)
 * drifting slowly closer, its name, date and place, the navies of a historical battle, the progress and a quotation.
 */
export function Loading() {
  const t = useT();
  const loading = useUi((s) => s.loading);
  const progress = useUi((s) => s.progress);
  const battle = useUi((s) => s.loadingBattle);
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]!);
  if (!loading) return null;
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const sid = battle?.scenario;
  const sides = sid ? [...playableFactions(sid)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)) : [];
  const where = [battle?.date, battle?.place].filter((x): x is string => !!x).map((x) => t(x)).join(' · ');
  return (
    <div className={`loading${battle?.night ? ' loading--night' : ''}`} role="status">
      {battle && <Backdrop key={battle.art} kind="loading" id={battle.art} />}
      <figure className="loading-quote">
        <blockquote>{t(quote[1])}</blockquote>
        <figcaption>{quote[0]}</figcaption>
      </figure>
      <div className="loading-body">
        {battle?.hanja && <div className="loading-hanja">{battle.hanja}</div>}
        <div className="loading-title">{t(battle?.title ?? '임진왜란')}</div>
        {where && <div className="loading-where">{where}</div>}
        {sid && (
          <div className="loading-forces">
            {sides.map((f) => (
              <div key={f} className={`loading-force loading-force--${f}`}>
                <b>{t(FACTION_NAME[f])}</b>
                <span>{t(commanderOf(sid, f).name)}</span>
                <small>{t(forcesOf(sid, f))}</small>
              </div>
            ))}
          </div>
        )}
        <div className="loading-progress">
          <div className="loading-bar">
            <div className="loading-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="loading-meta">
            <span>{t(loading)}</span>
            <b>{pct}%</b>
          </div>
        </div>
      </div>
    </div>
  );
}
