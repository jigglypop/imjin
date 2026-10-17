import { useMemo, useState } from 'react';
import { CONQUEST_MAPS, CONQUEST_ORDER, MUSTER_BUDGET, autoFleet, fleetCost, type ConquestMapId, type Seat } from '../sim/maps';
import { ROSTER, SHORT_NAME } from '../sim/conquest';
import { COMPETITIVE_TRAITS, shipSpec } from '../sim/competitive';
import { FACTION_SHORT } from '../sim/balance';
import { ALL_FACTIONS as FACTIONS, type Faction, type ShipKind } from '../sim/types';
import type { ConquestSetup } from '../game/Engine';
import { sound } from '../audio/Sound';
import { useT } from '../i18n';
import { Minus, Plus } from './icons';

const KEY = 'imjin.conquest';

type Saved = { map: ConquestMapId; me: Faction; foe: Faction; ally: Faction; size: 2 | 4 };

function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null;
    if (v && CONQUEST_MAPS[v.map] && FACTIONS.includes(v.me) && FACTIONS.includes(v.foe)) return { map: v.map, me: v.me, foe: v.foe, ally: FACTIONS.includes(v.ally) ? v.ally : 'ming', size: v.size === 4 ? 4 : 2 };
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
  panokseon: '천·지자총통, 튼튼한 선체',
  geobukseon: '충돌 돌격, 적의 도선 불가',
  hyeopseon: '정찰·보급: 가까운 아군 3척의 승조원·탄약·선체를 회복합니다',
  atakebune: '조총 누각, 적 함선 도선',
  sekibune: '빠른 돌격선, 적 함선 도선',
  kobaya: '값싼 소형선, 거점 점령',
  mingship: '장거리 불랑기포, 집중 사격',
  mingsmall: '원거리 지원포, 가벼운 선체',
  sahuseon: '무장 없는 척후선: 가장 멀리 보고 적을 피합니다',
  pojakseon: '징발한 어선: 아주 싸고 거점을 지킬 수 있습니다',
  daeantaek: '누각 대장선: 큰 선체·조총, 불에 강합니다',
  sogantaek: '중형 누각선: 대통과 조총, 아타케부네보다 쌉니다',
  daegwanseon: '빠른 대형 돌격선, 적 함선 도선',
  byeongnyangseon: '무장 없는 수송선: 가까운 아군 4척의 병력·탄약을 보급합니다',
  gwangseon: '철력목 대형선: 단단한 선체, 충돌에 강합니다 (조선 파견 기록 없음)',
  haechangseon: '중형 전선: 불랑기포 4문 (조선 파견 기록 없음)',
  hoseon: '빠른 소형선: 불랑기포, 거점 습격',
  racegalleon: '긴 사거리 컬버린, 빠른 선체: 거리를 두고 포격',
  pinnace: '빠른 소형선: 정찰과 추격, 거점 점령',
  fireship: '무장 없는 화공선: 적 함선에 닿으면 불을 옮기고 스스로 타 버립니다',
  spgalleon: '높은 선루와 많은 병사: 대포와 석포, 적 함선 도선',
  galleass: '노와 돛: 이물의 대포 3문, 바람 없이도 기동',
  urca: '수송선: 가까운 아군 4척의 병력·탄약을 보급합니다',
};

const TRAIT = COMPETITIVE_TRAITS;

function FactionPick({ value, onChange, label }: { value: Faction; onChange: (f: Faction) => void; label: string }) {
  const t = useT();
  return (
    <div className="cs-row">
      <span className="cs-label">{label}</span>
      <div className="cs-factions">
        {FACTIONS.map((f) => (
          <button key={f} className={`cs-faction ${value === f ? 'cs-faction--on' : ''}`} onClick={() => onChange(f)} title={t(TRAIT[f])}>
            <i className={`emblem emblem--${f}`} />
            {t(FACTION_SHORT[f])}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Conquest battle setup: map, sides and the opening fleet bought from the muster budget. */
export function ConquestSetupPanel({ onStart }: { onStart: (setup: ConquestSetup) => void }) {
  const t = useT();
  const [cfg, setCfgRaw] = useState<Saved>(load);
  const [fleet, setFleet] = useState<ShipKind[]>(() => autoFleet(cfg.me));
  const setCfg = (patch: Partial<Saved>) => {
    sound.click();
    const next = { ...cfg, ...patch };
    if (patch.me && patch.me !== cfg.me) setFleet(autoFleet(next.me));
    setCfgRaw(next);
    save(next);
  };
  const map = CONQUEST_MAPS[cfg.map];
  const budget = MUSTER_BUDGET;
  const size = map.seats >= 4 ? cfg.size : 2;
  const cost = fleetCost(fleet);
  const counts = useMemo(() => {
    const m = new Map<ShipKind, number>();
    for (const k of fleet) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  }, [fleet]);
  const add = (k: ShipKind, count = 1) => {
    const n = Math.min(count, Math.floor((budget - cost) / shipSpec(k).cost));
    if (n <= 0) return;
    sound.click();
    setFleet([...fleet, ...Array.from({ length: n }, () => k)]);
  };
  const remove = (k: ShipKind) => {
    const i = fleet.lastIndexOf(k);
    if (i < 0) return;
    sound.click();
    setFleet(fleet.filter((_, j) => j !== i));
  };
  const start = () => {
    const seats: Seat[] = [
      { name: t('아군 본대'), faction: cfg.me, team: 'joseon', human: true, fleet },
      { name: t('적 본대'), faction: cfg.foe, team: 'japan', human: false, fleet: autoFleet(cfg.foe) },
    ];
    if (size === 4) {
      seats.push({ name: t('동맹군'), faction: cfg.ally, team: 'joseon', human: false, fleet: autoFleet(cfg.ally) });
      seats.push({ name: t('적 별동대'), faction: cfg.foe, team: 'japan', human: false, fleet: autoFleet(cfg.foe) });
    }
    onStart({ map: cfg.map, seats, you: 0, seed: 1592 + Math.floor(Math.random() * 100000) });
  };
  return (
    <div className="cs glass">
      <div className="cs-cols">
        <div className="cs-col">
          <div className="cs-maps">
            {CONQUEST_ORDER.map((id) => (
              <button key={id} className={`cs-map ${cfg.map === id ? 'cs-map--on' : ''}`} onClick={() => setCfg({ map: id })}>
                <b>{t(CONQUEST_MAPS[id].title)}</b>
                <small>{t(CONQUEST_MAPS[id].place)}</small>
                <small>{CONQUEST_MAPS[id].seats >= 4 ? '1:1 · 2:2' : '1:1'}</small>
              </button>
            ))}
          </div>
          <p className="cs-summary">{t(map.summary)}</p>
          <p className="cs-summary cs-unlimited">{t('함선 수와 전력 제한 없음 · 군영과 선소를 증설해 함대를 운용합니다')}</p>
          <FactionPick label={t('내 진영')} value={cfg.me} onChange={(me) => setCfg({ me })} />
          <FactionPick label={t('상대')} value={cfg.foe} onChange={(foe) => setCfg({ foe })} />
          {map.seats >= 4 && (
            <div className="cs-row">
              <span className="cs-label">{t('규모')}</span>
              <div className="chips">
                <button className={`chip ${size === 2 ? 'chip--on' : ''}`} onClick={() => setCfg({ size: 2 })}>
                  1 : 1
                </button>
                <button className={`chip ${size === 4 ? 'chip--on' : ''}`} onClick={() => setCfg({ size: 4 })}>
                  {t('2 : 2 (컴퓨터 동맹군)')}
                </button>
              </div>
            </div>
          )}
          {size === 4 && <FactionPick label={t('동맹')} value={cfg.ally} onChange={(ally) => setCfg({ ally })} />}
        </div>
        <div className="cs-col">
          <div className="cs-row cs-row--top">
            <span className="cs-label">{t('함대')}</span>
            <div className="cs-muster">
              <div className="cs-budget">
                <div className="cs-budget-bar">
                  <i style={{ width: `${(cost / budget) * 100}%` }} />
                </div>
                <span>
                  {cost.toLocaleString('ko-KR')} / {budget.toLocaleString('ko-KR')} <small>{t('남은 금액은 군자금이 됩니다')}</small>
                  <small>{t('출전 {n}척 · 건조로 계속 증원할 수 있습니다', { n: fleet.length })}</small>
                </span>
              </div>
              <div className="cs-ships">
                {ROSTER[cfg.me].map((k) => (
                  <div key={k} className="cs-ship">
                    <div className="cs-ship-name">
                      <b>{t(SHORT_NAME[k])}</b>
                      <small>{shipSpec(k).cost.toLocaleString('ko-KR')}</small>
                    </div>
                    <div className="cs-ship-note">{t(ROLE_NOTE[k])}</div>
                    <div className="cs-ship-count">
                      <button onClick={() => remove(k)} disabled={!counts.get(k)} aria-label={t('{name} 줄이기', { name: t(SHORT_NAME[k]) })}>
                        <Minus size={16} />
                      </button>
                      <b>{counts.get(k) ?? 0}</b>
                      <button onClick={(e) => add(k, e.shiftKey ? 10 : 1)} disabled={cost + shipSpec(k).cost > budget} title={t('Shift 클릭: 10척 추가')} aria-label={t('{name} 늘리기', { name: t(SHORT_NAME[k]) })}>
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="chips">
                <button className="chip" onClick={() => setFleet(autoFleet(cfg.me))}>
                  {t('기본 구성')}
                </button>
                <button className="chip" onClick={() => setFleet([])}>
                  {t('비우기')}
                </button>
              </div>
            </div>
          </div>
          <div className="cs-trait">{t(TRAIT[cfg.me])}</div>
        </div>
      </div>
      <div className="select-foot">
        <span className="select-result">{t('거점과 보급망을 장악해 승리합니다 · 제한 시간 {n}분', { n: 30 })}</span>
        <button className="ink-btn" disabled={!fleet.length} onClick={start}>
          {t('전투 시작')}
        </button>
      </div>
    </div>
  );
}
