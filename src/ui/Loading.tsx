import { useState } from 'react';
import { SCENARIOS } from '../sim/scenarios';
import { useUi } from '../state/store';
import { Backdrop } from './Backdrop';

const QUOTES: [string, string][] = [
  ['必死則生 必生則死', '죽고자 하면 살 것이요, 살고자 하면 죽을 것이다'],
  ['勿令妄動 靜重如山', '가벼이 움직이지 말라, 산처럼 무겁고 고요하게 하라'],
  ['今臣戰船 尙有十二', '지금 신에게는 아직 열두 척의 배가 남아 있사옵니다'],
  ['若無湖南 是無國家', '호남이 없으면 나라도 없다'],
  ['戰方急 愼勿言我死', '싸움이 급하니 나의 죽음을 알리지 말라'],
  ['一夫當逕 足懼千夫', '한 사람이 길목을 지키면 천 사람도 두렵게 할 수 있다'],
];

export function Loading() {
  const loading = useUi((s) => s.loading);
  const progress = useUi((s) => s.progress);
  const sid = useUi((s) => s.loadingScenario);
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]!);
  if (!loading) return null;
  const info = sid ? SCENARIOS[sid] : null;
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div className="loading" role="status">
      <Backdrop kind="loading" id={sid ?? undefined} />
      <div className="loading-card glass">
        <div className="loading-title">{info?.hanja ?? '壬辰海戰'}</div>
        <div className="loading-sub">{info?.title ?? '임진 해전'}</div>
        <div className="loading-bar">
          <div className="loading-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="loading-meta">
          <span>{loading}</span>
          <b>{pct}%</b>
        </div>
        <div className="loading-quote">
          <strong>{quote[0]}</strong>
          <span>{quote[1]}</span>
        </div>
      </div>
    </div>
  );
}
