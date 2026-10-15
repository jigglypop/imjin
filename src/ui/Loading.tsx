import { useEffect, useState } from 'react';
import { SCENARIOS, type ScenarioId } from '../sim/scenarios';
import { FACTION_SHORT, forcesOf } from '../sim/balance';
import type { Faction } from '../sim/types';
import { useLang, useT } from '../i18n';
import { useUi } from '../state/store';
import { Backdrop } from './Backdrop';
import { TIPS, type Tip } from './tips';
import './loading.css';

// The loading page is the battle's briefing while it is built, ten to thirty seconds: its scene from the game, the
// poster title, when and where, one line on what happened, both sides' forces and a tip that changes as it waits.

// Yi Sun-sin's words keep their traditional wording and register: they are quotations, not UI copy. Each stands with
// the battle it was spoken or written at.
const QUOTES: Partial<Record<ScenarioId, [string, string]>> = {
  okpo: ['勿令妄動 靜重如山', '가벼이 움직이지 말고, 태산같이 무겁게 행동하라'],
  chilcheon: ['今臣戰船 尙有十二', '신에게는 아직 열두 척의 배가 남아 있사옵니다'],
  myeongnyang: ['必死則生 必生則死', '죽고자 하면 살 것이요, 살고자 하면 죽을 것이다'],
  noryang: ['戰方急 愼勿言我死', '싸움이 급하니 나의 죽음을 알리지 말라'],
};

/** Uldolmok's current decides Myeongnyang, and no control has a tip for it. */
const TIDE: Tip = { title: '울돌목의 물살', what: '물살은 때에 따라 방향이 바뀝니다. 물살이 일본 함대를 거슬러 흐르기 시작하면 형세가 뒤집힙니다.', when: '' };

/** Each battle's own tip comes first, then the ones every battle needs. */
const BATTLE_TIP: Record<ScenarioId, Tip> = {
  okpo: TIPS['volley.port']!,
  sacheon: TIPS.ram!,
  dangpo: TIPS.ram!,
  hansan: TIPS.crane!,
  angolpo: TIPS.standoff!,
  busan: TIPS.column!,
  chilcheon: TIPS.repel!,
  myeongnyang: TIDE,
  noryang: TIPS.lights!,
};
const GENERAL_TIPS: Tip[] = ['skip', 'speed', 'broadside', 'ammo', 'card', 'hold'].map((id) => TIPS[id]!);
const TIP_MS = 7000;

export function Loading() {
  const t = useT();
  const lang = useLang();
  const loading = useUi((s) => s.loading);
  const progress = useUi((s) => s.progress);
  const info = useUi((s) => s.loadingBattle);
  const [turn, setTurn] = useState(0);
  const active = loading !== null;
  useEffect(() => setTurn(0), [info]);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTurn((n) => n + 1), TIP_MS);
    return () => window.clearInterval(id);
  }, [active]);
  if (!loading) return null;
  const scenario = info?.mode === 'scenario' ? (info.id as ScenarioId) : null;
  const s = scenario ? SCENARIOS[scenario] : null;
  const tips = scenario ? [BATTLE_TIP[scenario], ...GENERAL_TIPS] : GENERAL_TIPS;
  const tip = tips[turn % tips.length]!;
  const quote = scenario ? QUOTES[scenario] : undefined;
  const sides: Faction[] = s?.forces.ming ? ['joseon', 'ming', 'japan'] : ['joseon', 'japan'];
  const title = t(info?.title ?? '임진왜란');
  // The English edition sets the name in the poster's Roman capitals, "Battle of" small above it as on the cards.
  const roman = lang === 'en' ? (/^Battle of (.+)$/.exec(title)?.[1] ?? title) : null;
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div className={`loading${info?.night ? ' loading--night' : ''}`} role="status">
      <Backdrop kind="loading" id={info?.art} />
      <div className="loading-brief">
        {info && (
          <div className="loading-kicker">
            {t(info.date)}
            <span>{info.hanja}</span>
          </div>
        )}
        {roman ? (
          <h1 className="loading-title loading-title--roman">
            {roman !== title && <small>Battle of</small>}
            {roman}
          </h1>
        ) : (
          <h1 className="loading-title">{title}</h1>
        )}
        {info && <div className="loading-place">{t(info.place)}</div>}
        {s && <p className="loading-hook">{t(s.hook)}</p>}
        {s && (
          <div className="loading-forces">
            {sides.map((f) => (
              <span key={f} className={`loading-force loading-force--${f}`}>
                <b>{t(FACTION_SHORT[f])}</b>
                {t(forcesOf(scenario!, f))}
              </span>
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
        <p className="loading-tip" key={turn % tips.length}>
          <b>{t(tip.title)}</b>
          {t(tip.what)}
        </p>
        {quote && (
          <blockquote className="loading-quote">
            <span>{t(quote[1])}</span>
            <strong>{quote[0]}</strong>
          </blockquote>
        )}
      </div>
    </div>
  );
}
