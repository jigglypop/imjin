import { useMemo, useState } from 'react';
import { CONQUEST_MAPS, CONQUEST_ORDER, MUSTER_BUDGET, autoFleet, fleetCost, type ConquestMapId, type Seat } from '../sim/maps';
import { ROSTER, SHORT_NAME } from '../sim/conquest';
import { SHIP_SPECS } from '../sim/catalog';
import { FACTION_MARK, FACTION_NAME } from '../sim/balance';
import { FACTIONS, type Faction, type ShipKind } from '../sim/types';
import type { ConquestSetup } from '../game/Engine';
import { sound } from '../audio/Sound';

const KEY = 'imjin.conquest';

type Saved = { map: ConquestMapId; me: Faction; foe: Faction; ally: Faction; size: 2 | 4 };

function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null;
    if (v && CONQUEST_MAPS[v.map] && FACTIONS.includes(v.me) && FACTIONS.includes(v.foe)) return { ...v, ally: FACTIONS.includes(v.ally) ? v.ally : 'ming', size: v.size === 4 ? 4 : 2 };
  } catch {
    // storage unavailable or old: defaults below
  }
  return { map: 'hallyeo', me: 'joseon', foe: 'japan', ally: 'ming', size: 2 };
}

function save(v: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // the choice lasts until reload
  }
}

const ROLE_NOTE: Record<ShipKind, string> = {
  panokseon: '천·지자총통 · 두꺼운 판옥',
  geobukseon: '충파 · 등선 불가',
  hyeopseon: '빠른 척후 · 점령',
  atakebune: '조총 누각 · 등선',
  sekibune: '빠른 등선 돌격',
  kobaya: '값싼 소선 · 점령',
  mingship: '불랑기 속사 · 큰 배',
  mingsmall: '불랑기 · 빠른 사선',
};

const TRAIT: Record<Faction, string> = {
  joseon: '총통의 화력과 단단한 판옥선. 비싸지만 함대전에서 강하다.',
  japan: '조총과 등선. 배가 싸고 빨라 포구를 먼저 차지한다.',
  ming: '불랑기포의 빠른 장전과 큰 전선. 수가 적고 느리다.',
};

function FactionPick({ value, onChange, label }: { value: Faction; onChange: (f: Faction) => void; label: string }) {
  return (
    <div className="cs-row">
      <span className="cs-label">{label}</span>
      <div className="cs-factions">
        {FACTIONS.map((f) => (
          <button key={f} className={`cs-faction ${value === f ? 'cs-faction--on' : ''}`} onClick={() => onChange(f)} title={TRAIT[f]}>
            <i className={`emblem emblem--${f}`}>{FACTION_MARK[f]}</i>
            {FACTION_NAME[f].replace(' 수군', '')}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Conquest battle setup: map, sides and the opening fleet bought from the muster budget. */
export function ConquestSetupPanel({ onStart }: { onStart: (setup: ConquestSetup) => void }) {
  const [cfg, setCfgRaw] = useState<Saved>(load);
  const [fleet, setFleet] = useState<ShipKind[]>(() => autoFleet(cfg.me));
  const setCfg = (patch: Partial<Saved>) => {
    sound.click();
    const next = { ...cfg, ...patch };
    if (patch.me && patch.me !== cfg.me) setFleet(autoFleet(patch.me));
    setCfgRaw(next);
    save(next);
  };
  const map = CONQUEST_MAPS[cfg.map];
  const size = map.seats >= 4 ? cfg.size : 2;
  const cost = fleetCost(fleet);
  const counts = useMemo(() => {
    const m = new Map<ShipKind, number>();
    for (const k of fleet) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  }, [fleet]);
  const add = (k: ShipKind) => {
    if (cost + SHIP_SPECS[k].cost > MUSTER_BUDGET) return;
    sound.click();
    setFleet([...fleet, k]);
  };
  const remove = (k: ShipKind) => {
    const i = fleet.lastIndexOf(k);
    if (i < 0) return;
    sound.click();
    setFleet(fleet.filter((_, j) => j !== i));
  };
  const start = () => {
    const seats: Seat[] = [
      { name: '아군 본대', faction: cfg.me, team: 'joseon', human: true, fleet },
      { name: '적 본대', faction: cfg.foe, team: 'japan', human: false, fleet: autoFleet(cfg.foe) },
    ];
    if (size === 4) {
      seats.push({ name: '우군', faction: cfg.ally, team: 'joseon', human: false, fleet: autoFleet(cfg.ally) });
      seats.push({ name: '적 별동대', faction: cfg.foe, team: 'japan', human: false, fleet: autoFleet(cfg.foe) });
    }
    onStart({ map: cfg.map, seats, you: 0, seed: 1592 + Math.floor(Math.random() * 100000) });
  };
  return (
    <div className="cs paper">
      <div className="cs-maps">
        {CONQUEST_ORDER.map((id) => (
          <button key={id} className={`cs-map ${cfg.map === id ? 'cs-map--on' : ''}`} onClick={() => setCfg({ map: id })}>
            <b>{CONQUEST_MAPS[id].title}</b>
            <small>
              {CONQUEST_MAPS[id].place} · {CONQUEST_MAPS[id].seats >= 4 ? '1:1 · 2:2' : '1:1'}
            </small>
          </button>
        ))}
      </div>
      <p className="cs-summary">{map.summary}</p>
      <FactionPick label="아군" value={cfg.me} onChange={(me) => setCfg({ me })} />
      <FactionPick label="적군" value={cfg.foe} onChange={(foe) => setCfg({ foe })} />
      {map.seats >= 4 && (
        <div className="cs-row">
          <span className="cs-label">규모</span>
          <div className="chips">
            <button className={`chip ${size === 2 ? 'chip--on' : ''}`} onClick={() => setCfg({ size: 2 })}>
              1 : 1
            </button>
            <button className={`chip ${size === 4 ? 'chip--on' : ''}`} onClick={() => setCfg({ size: 4 })}>
              2 : 2 (컴퓨터 우군)
            </button>
          </div>
        </div>
      )}
      {size === 4 && <FactionPick label="우군" value={cfg.ally} onChange={(ally) => setCfg({ ally })} />}
      <div className="cs-row cs-row--top">
        <span className="cs-label">편성</span>
        <div className="cs-muster">
          <div className="cs-budget">
            <div className="cs-budget-bar">
              <i style={{ width: `${(cost / MUSTER_BUDGET) * 100}%` }} />
            </div>
            <span>
              {cost.toLocaleString('ko-KR')} / {MUSTER_BUDGET.toLocaleString('ko-KR')} <small>남는 돈은 군자금으로</small>
            </span>
          </div>
          <div className="cs-ships">
            {ROSTER[cfg.me].map((k) => (
              <div key={k} className="cs-ship">
                <div className="cs-ship-name">
                  <b>{SHORT_NAME[k]}</b>
                  <small>{SHIP_SPECS[k].cost}</small>
                </div>
                <div className="cs-ship-note">{ROLE_NOTE[k]}</div>
                <div className="cs-ship-count">
                  <button onClick={() => remove(k)} disabled={!counts.get(k)}>
                    −
                  </button>
                  <b>{counts.get(k) ?? 0}</b>
                  <button onClick={() => add(k)} disabled={cost + SHIP_SPECS[k].cost > MUSTER_BUDGET}>
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="chips">
            <button className="chip" onClick={() => setFleet(autoFleet(cfg.me))}>
              기본 편성
            </button>
            <button className="chip" onClick={() => setFleet([])}>
              비우기
            </button>
          </div>
        </div>
      </div>
      <div className="cs-trait">{TRAIT[cfg.me]}</div>
      <div className="select-foot">
        <span className="select-result">포구를 차지해 적의 기세를 꺾어라 · 30분</span>
        <button className="ink-btn" disabled={!fleet.length} onClick={start}>
          출진
        </button>
      </div>
    </div>
  );
}
