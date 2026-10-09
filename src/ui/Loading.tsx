import { useState } from 'react';
import { SCENARIOS } from '../sim/scenarios';
import { useT } from '../i18n';
import { useUi } from '../state/store';
import { Backdrop } from './Backdrop';

const QUOTES: [string, string][] = [
  ['必死則生 必生則死', '죽기를 각오하면 살고, 살기를 바라면 죽습니다'],
  ['勿令妄動 靜重如山', '함부로 움직이지 말고, 산처럼 침착하고 무겁게 행동해야 합니다'],
  ['今臣戰船 尙有十二', '신에게는 아직 열두 척의 배가 있습니다'],
  ['若無湖南 是無國家', '호남이 없으면 나라도 없습니다'],
  ['戰方急 愼勿言我死', '싸움이 급하니 내 죽음을 알려서는 안 됩니다'],
  ['一夫當逕 足懼千夫', '한 사람이 길목을 지키면 천 명도 두렵게 할 수 있습니다'],
];

export function Loading() {
  const t = useT();
  const loading = useUi((s) => s.loading);
  const progress = useUi((s) => s.progress);
  const sid = useUi((s) => s.loadingScenario);
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]!);
  if (!loading) return null;
  const info = sid ? SCENARIOS[sid] : null;
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div className={`loading${info?.night ? ' loading--night' : ''}`} role="status">
      <Backdrop kind="loading" id={sid ?? undefined} />
      <div className="loading-card glass">
        <div className="loading-title">{t(info?.title ?? '임진 해전')}</div>
        <div className="loading-bar">
          <div className="loading-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="loading-meta">
          <span>{t(loading)}</span>
          <b>{pct}%</b>
        </div>
        <div className="loading-quote">
          <span>{t(quote[1])}</span>
          <strong>{quote[0]}</strong>
        </div>
      </div>
    </div>
  );
}
