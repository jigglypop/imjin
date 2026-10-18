import { SCENARIOS, type ScenarioId } from '../sim/scenarios';
import { FACTION_SHORT, forcesOf, playableFactions } from '../sim/balance';
import { useLang, useT } from '../i18n';
import { useUi } from '../state/store';
import { Backdrop } from './Backdrop';
import './loading.css';

// The loading page is the battle's briefing while it is built, ten to thirty seconds: its scene from the game, the
// poster title, when and where, and both sides' forces, centred on the screen.

// Yi Sun-sin's words keep their traditional wording and register: they are quotations, not UI copy. Each stands with
// the battle it was spoken or written at.
const QUOTES: Partial<Record<ScenarioId, [string, string]>> = {
  okpo: ['勿令妄動 靜重如山', '가벼이 움직이지 말고, 태산같이 무겁게 행동하라'],
  chilcheon: ['今臣戰船 尙有十二', '신에게는 아직 열두 척의 배가 남아 있사옵니다'],
  myeongnyang: ['必死則生 必生則死', '죽고자 하면 살 것이요, 살고자 하면 죽을 것이다'],
  noryang: ['戰方急 愼勿言我死', '싸움이 급하니 나의 죽음을 알리지 말라'],
};

export function Loading() {
  const t = useT();
  const lang = useLang();
  const loading = useUi((s) => s.loading);
  const progress = useUi((s) => s.progress);
  const info = useUi((s) => s.loadingBattle);
  if (!loading) return null;
  const scenario = info?.mode === 'scenario' ? (info.id as ScenarioId) : null;
  const s = scenario ? SCENARIOS[scenario] : null;
  const quote = scenario ? QUOTES[scenario] : undefined;
  const sides = scenario ? playableFactions(scenario) : [];
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
