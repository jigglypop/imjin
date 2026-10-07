import { useState } from 'react';
import { SCENARIO_ORDER, SCENARIOS, type ScenarioId } from '../sim/scenarios';

const UPCOMING = ['옥포', '사천', '당포', '안골포', '칠천량', '노량'];

function Arrow({ from, to, team }: { from: [number, number]; to: [number, number]; team: 'joseon' | 'japan' }) {
  const [x1, y1] = [from[0] * 1600, from[1] * 900];
  const [x2, y2] = [to[0] * 1600, to[1] * 900];
  const mx = (x1 + x2) / 2 + (y2 - y1) * 0.18;
  const my = (y1 + y2) / 2 - (x2 - x1) * 0.18;
  const color = team === 'joseon' ? '#f4ede0' : '#f4ede0';
  const stroke = team === 'joseon' ? '#1d3f63' : '#7a1f18';
  const angle = Math.atan2(y2 - my, x2 - mx);
  const head = 26;
  const hx1 = x2 - Math.cos(angle - 0.45) * head;
  const hy1 = y2 - Math.sin(angle - 0.45) * head;
  const hx2 = x2 - Math.cos(angle + 0.45) * head;
  const hy2 = y2 - Math.sin(angle + 0.45) * head;
  return (
    <g>
      <path d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`} fill="none" stroke={stroke} strokeWidth="16" strokeLinecap="round" opacity="0.9" />
      <path d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" />
      <path d={`M${hx1},${hy1} L${x2},${y2} L${hx2},${hy2}`} fill="none" stroke={stroke} strokeWidth="14" strokeLinejoin="round" strokeLinecap="round" />
      <path d={`M${hx1},${hy1} L${x2},${y2} L${hx2},${hy2}`} fill="none" stroke={color} strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" />
    </g>
  );
}

export function BattleSelect({ initial, onStart }: { initial: ScenarioId; onStart: (id: ScenarioId) => void }) {
  const [id, setId] = useState<ScenarioId>(initial);
  const s = SCENARIOS[id];
  return (
    <div className="select">
      <div className="select-map" />
      <div className="select-overlay">
        <svg viewBox="0 0 1600 900" preserveAspectRatio="none">
          {s.arrows.map((a, i) => (
            <Arrow key={i} from={a.from} to={a.to} team={a.team} />
          ))}
          <g transform={`translate(${s.map.x * 1600}, ${s.map.y * 900})`}>
            <circle r="30" fill="rgba(163,39,29,0.18)" />
            <circle r="15" fill="#a3271d" stroke="#f4ede0" strokeWidth="4" />
            <path d="M-8,-8 L8,8 M8,-8 L-8,8" stroke="#f4ede0" strokeWidth="3.5" strokeLinecap="round" />
          </g>
        </svg>
      </div>
      <div className="select-vignette" />
      <div className="select-flag select-flag--joseon">{s.joseon.banner}</div>
      <div className="select-flag select-flag--japan">{s.japan.banner}</div>
      <img className="select-figure select-figure--left" src={`/ui/figures/${s.joseon.figure}.webp`} alt={s.joseon.name} />
      <img className="select-figure select-figure--right" src={`/ui/figures/${s.japan.figure}.webp`} alt={s.japan.name} />
      <div className="select-top">
        <div className="select-heading brush">역사적 해전</div>
        {SCENARIO_ORDER.map((sid) => (
          <button key={sid} className={`select-tab ${sid === id ? 'select-tab--on' : ''}`} onClick={() => setId(sid)}>
            {SCENARIOS[sid].title}
          </button>
        ))}
        {UPCOMING.map((name) => (
          <button key={name} className="select-tab select-tab--locked" disabled title="준비 중">
            {name}
          </button>
        ))}
      </div>
      <div className="select-head">
        <div className="select-title brush">{s.title}</div>
        <div className="select-date">
          {s.date} · {s.place}
        </div>
        <button className="ink-btn" onClick={() => onStart(id)}>
          전투 개시
        </button>
      </div>
      <div className="select-name select-name--left">
        <b>{s.joseon.name}</b>
        <span>{s.joseon.title}</span>
      </div>
      <div className="select-name select-name--right">
        <b>{s.japan.name}</b>
        <span>{s.japan.title}</span>
      </div>
      <div className="select-brief paper">
        <div className="select-brief-head">
          <span>
            난이도 <b>{s.difficulty}</b>
          </span>
          <span>{s.season}</span>
          <span className="seal" style={{ marginLeft: 'auto' }}>
            {s.hanja.slice(0, 1)}
          </span>
        </div>
        <p>{s.summary}</p>
        <div className="select-forces">
          <div className="select-force">
            <i style={{ background: 'var(--joseon)' }} />
            조선 수군 — {s.forces.joseon}
          </div>
          <div className="select-force">
            <i style={{ background: 'var(--japan)' }} />
            일본 수군 — {s.forces.japan}
          </div>
        </div>
        <div className="select-result">역사 기록: {s.result}</div>
      </div>
    </div>
  );
}
