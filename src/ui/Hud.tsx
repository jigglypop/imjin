import { useEffect, useRef, useState } from 'react';
import { SPEEDS, type Engine } from '../game/Engine';
import { AMMO_NAMES } from '../game/Input';
import { isTouchDevice } from '../game/device';
import { EQUIPMENT_LABEL, LEVELS, equipment, saveEquipmentSetting, type EquipmentSetting } from '../game/quality';
import { SKY_PRESETS, type SkyPresetName } from '../render/sky';
import type { SeaStateName } from '../ocean/waves';
import { setTouchBox, useUi, type BattleOrigin, type GameSnapshot, type PrimaryInfo, type SquadronInfo } from '../state/store';
import type { Team } from '../sim/types';
import { FACTION_MARK, FACTION_NAME } from '../sim/balance';
import { useCompactLayout } from './useCompactLayout';
import { ConquestBar, CrewPanel, PointPanel } from './ConquestPanels';
import { DirectorToggle } from './DirectorToggle';
import { KIND_HANJA } from './kinds';

const SEA_LABELS: Record<SeaStateName, string> = { calm: '잔잔', moderate: '보통', rough: '거침' };
const ACTIVITY: Record<string, string> = {
  idle: '대기',
  moving: '이동',
  engaging: '포격',
  boarding: '백병전',
  sinking: '침몰',
  struck: '전투 불능',
  charging: '돌격',
  evading: '거리 유지',
  anchored: '정박',
  fleeing: '도주',
  aground: '좌초',
};
const STANCE_SHORT = { auto: '자유', standoff: '원거리', close: '근접', ram: '충파', board: '등선' } as const;
const AMMO_SHORT = { auto: '기본탄', hull: '대장군전', crew: '조란환', fire: '화전' } as const;
const EQUIPMENT_CHOICES: EquipmentSetting[] = ['auto', 'high', 'medium', 'low'];

type Tab = 'form' | 'gun' | 'move' | 'tactic';

function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Counts are by team. The engine names the sides, the player's first. */
function teamName(snap: GameSnapshot, team: Team) {
  return team === snap.team ? snap.sides.own : snap.sides.enemy;
}

// The equipment class is resolved at page load, and its build-time resources are fixed for the session.
// Changing it means loading the page again, which restarts the battle.
function changeEquipment(next: EquipmentSetting) {
  if (next === equipment.setting) return;
  if (!confirm('설비 등급을 바꾸면 페이지를 다시 불러옵니다. 진행 중인 전투는 처음부터 다시 시작됩니다. 계속할까요?')) return;
  saveEquipmentSetting(next);
  const url = new URL(location.href);
  url.searchParams.delete('q');
  location.assign(url.toString());
}

function Stat({ label, value, tone, text }: { label: string; value: number; tone: 'hull' | 'crew' | 'fire'; text: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <div className={`stat-bar stat-bar--${tone}`}>
        <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      </div>
      <b>{text}</b>
    </div>
  );
}

function Card({ sq, onClick, onDouble }: { sq: SquadronInfo; onClick: (e: React.MouseEvent) => void; onDouble: () => void }) {
  return (
    <button className={`card f-${sq.faction} ${sq.selected ? 'card--selected' : ''} ${sq.alive === 0 ? 'card--dead' : ''}`} onClick={onClick} onDoubleClick={onDouble} title={`${sq.name} · ${sq.commander}`}>
      <img src={`/ui/portraits/${sq.portrait}.jpg`} alt="" />
      <div className="card-kind">{KIND_HANJA[sq.kind] ?? '船'}</div>
      <div className="card-flags">
        {sq.burning > 0 && <div className="card-flag card-flag--fire">火</div>}
        {sq.boarding > 0 && <div className="card-flag card-flag--melee">戰</div>}
      </div>
      <div className="card-foot">
        <div className="card-name">{sq.name}</div>
        <div className="card-count">
          {sq.alive}
          <small>/{sq.total}</small>
        </div>
        <div className="card-bar">
          <i style={{ width: `${sq.hull * 100}%` }} />
        </div>
      </div>
    </button>
  );
}

type OrderDef = { icon: string; label: string; key: string; run: () => void; on?: boolean; disabled?: boolean };

function Orders({ engine, p, night, selected, collapsed, onToggle }: { engine: Engine; p: PrimaryInfo | null; night: boolean; selected: number; collapsed: boolean; onToggle: () => void }) {
  const [tab, setTab] = useState<Tab>('form');
  const input = engine.input;
  const none = selected === 0;
  const tabs: Record<Tab, { title: string; items: OrderDef[] }> = {
    form: {
      title: '진형',
      items: [
        { icon: '鶴', label: '학익진', key: '1', run: () => input.formation('crane') },
        { icon: '一', label: '일자진', key: '2', run: () => input.formation('line') },
        { icon: '長', label: '장사진', key: '3', run: () => input.formation('column') },
        { icon: '尖', label: '첨자진', key: '4', run: () => input.formation('wedge') },
        { icon: '戰', label: '자유교전', key: 'G', run: () => input.auto() },
      ],
    },
    gun: {
      title: '포격',
      items: [
        { icon: '左', label: '좌현 일제', key: 'Z', run: () => input.volley(0), disabled: none },
        { icon: '右', label: '우현 일제', key: 'X', run: () => input.volley(1), disabled: none },
        { icon: p?.fireMode === 'hold' ? '停' : '射', label: p?.fireMode === 'hold' ? '사격 중지' : '자유 사격', key: 'Y', run: () => input.toggleFire(), on: p?.fireMode === 'hold' },
        { icon: '彈', label: p ? AMMO_SHORT[p.ammo] : '탄종', key: 'T', run: () => input.cycleAmmo(), on: !!p && p.ammo !== 'auto' },
        { icon: '舷', label: '측면 정렬', key: 'U', run: () => input.presentBroadside(), disabled: none },
      ],
    },
    move: {
      title: '기동',
      items: [
        { icon: '進', label: '전속', key: '5', run: () => input.setSpeed(1), on: !!p && p.speedCap >= 1, disabled: none },
        { icon: '緩', label: '반속', key: '6', run: () => input.setSpeed(0.6), on: !!p && p.speedCap >= 0.5 && p.speedCap < 1, disabled: none },
        { icon: '微', label: '미속', key: '7', run: () => input.setSpeed(0.3), on: !!p && p.speedCap > 0 && p.speedCap < 0.5, disabled: none },
        { icon: '止', label: '정지', key: 'H', run: () => input.hold(), disabled: none },
        { icon: '燈', label: p && !p.lights ? '등화관제' : '등불', key: 'L', run: () => input.toggleLights(), on: !!p && !p.lights, disabled: !night && none },
      ],
    },
    tactic: {
      title: '전술',
      items: [
        { icon: '遠', label: '원거리', key: 'K', run: () => input.setStance('standoff'), on: p?.stance === 'standoff', disabled: none },
        { icon: '近', label: '근접 포격', key: 'J', run: () => input.setStance('close'), on: p?.stance === 'close', disabled: none },
        { icon: '衝', label: '충파', key: 'N', run: () => input.setStance('ram'), on: p?.stance === 'ram', disabled: none },
        { icon: '登', label: '등선', key: 'B', run: () => input.setStance('board'), on: p?.stance === 'board', disabled: none },
        { icon: '拒', label: '이탈·거부', key: 'P', run: () => input.repel(), on: !!p && p.repel, disabled: none },
      ],
    },
  };
  const current = tabs[tab];
  return (
    <>
      <div className="orders-tabs">
        {(Object.keys(tabs) as Tab[]).map((k) => (
          <button key={k} className={`orders-tab ${k === tab ? 'orders-tab--on' : ''}`} onClick={() => setTab(k)}>
            {tabs[k].title}
          </button>
        ))}
        <button className="orders-fold" onClick={onToggle} aria-expanded={!collapsed} title={collapsed ? '명령 펼치기' : '명령 접기'}>
          {collapsed ? '▴' : '▾'}
        </button>
      </div>
      {!collapsed && (
        <div className="orders-grid">
          {current.items.map((o) => (
            <button key={o.label + o.key} className={`order ${o.on ? 'order--on' : ''}`} onClick={o.run} disabled={o.disabled} title={`${o.label} (${o.key})`}>
              <span className="order-icon">{o.icon}</span>
              {o.label}
              <kbd>{o.key}</kbd>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** Where the back button leads, named for the screen the battle was started from. */
const BACK_LABEL: Record<BattleOrigin, { long: string; short: string }> = {
  select: { long: '전투 선택', short: '선택' },
  skirmish: { long: '쟁탈전', short: '쟁탈전' },
  online: { long: '대전 대기실', short: '대기실' },
};

/** Pause and speed. Wide layouts show every multiplier; compact ones show one button that cycles through them. */
function SpeedControl({ engine, snap, compact }: { engine: Engine; snap: GameSnapshot; compact: boolean }) {
  const setSpeed = (s: number) => {
    engine.speed = s;
    engine.paused = false;
    engine.publish(true);
  };
  const next = SPEEDS[(SPEEDS.findIndex((s) => s === snap.speed) + 1) % SPEEDS.length]!;
  return (
    <>
      <button
        className={snap.paused ? 'on' : ''}
        aria-label={snap.paused ? '계속' : '일시정지'}
        onClick={() => {
          engine.paused = !engine.paused;
          engine.publish(true);
        }}
      >
        {snap.paused ? '▶' : '❚❚'}
      </button>
      {compact ? (
        <button aria-label="배속 바꾸기" onClick={() => setSpeed(next)}>
          {snap.speed}×
        </button>
      ) : (
        SPEEDS.map((s) => (
          <button key={s} className={!snap.paused && snap.speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>
            {s}×
          </button>
        ))
      )}
      {(snap.autoFast || snap.fastForward) && (
        <button
          className={`speed-skip ${snap.fastForward ? 'on' : ''}`}
          title="적과 마주칠 때까지 빠르게 진행"
          onClick={() => {
            engine.autoFast = false;
            engine.fastForward = false;
            engine.publish(true);
          }}
        >
          {snap.fastForward ? (compact ? '⏩ 접근' : '접근 중 ⏩') : '⏩'}
        </button>
      )}
    </>
  );
}

export function Hud({ engine, onBack }: { engine: Engine; onBack: () => void }) {
  const snap = useUi((s) => s.snapshot);
  const toasts = useUi((s) => s.toasts);
  const box = useUi((s) => s.box);
  const report = useUi((s) => s.report);
  const touchBox = useUi((s) => s.touchBox);
  const origin = useUi((s) => s.origin);
  const compact = useCompactLayout();
  const [showSettings, setShowSettings] = useState(false);
  // The minimap is always on in the wide layout. On phones it opens as a floating panel from the menu.
  const [mapOn, setMapOn] = useState(false);
  const [ordersCollapsed, setOrdersCollapsed] = useState(false);
  // Portrait phones fold the detail and orders away to leave the sea in view. Short phones start folded.
  const [sheetFolded, setSheetFolded] = useState(() => innerHeight < 760);
  const minimapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    engine.minimap.mount(minimapRef.current);
  }, [engine, snap?.scenario.id, compact, mapOn]);

  if (!snap) return null;
  const own = snap.squadrons.filter((s) => s.faction === snap.faction);
  const selectedSquad = own.find((s) => s.selected);
  const p = snap.primary;
  const enemyTeam: Team = snap.team === 'joseon' ? 'japan' : 'joseon';
  const enemyFaction = snap.squadrons.find((s) => s.team === enemyTeam)?.faction ?? enemyTeam;
  const won = snap.winner === snap.team;
  return (
    <div className="hud" style={{ '--own-fc': `var(--${snap.faction})`, '--enemy-fc': `var(--${enemyFaction})` } as React.CSSProperties}>
      <div className="hud-title">
        <div className="hud-title-main">{snap.scenario.title}</div>
        <div className="hud-title-sub">
          {snap.scenario.date} · {snap.scenario.place}
        </div>
        <div className="hud-menu">
          <button className="mini-btn" onClick={onBack}>
            <span className="long">{BACK_LABEL[origin].long}</span>
            <span className="short">{BACK_LABEL[origin].short}</span>
          </button>
          <button className={`mini-btn ${showSettings ? 'mini-btn--on' : ''}`} onClick={() => setShowSettings((v) => !v)}>
            설정
          </button>
          {compact && (
            <button className={`mini-btn ${mapOn ? 'mini-btn--on' : ''}`} onClick={() => setMapOn((v) => !v)}>
              지도
            </button>
          )}
          {engine.campaign && !snap.winner && (
            <button className="mini-btn" onClick={() => engine.endBattle()}>
              철수
            </button>
          )}
        </div>
      </div>

      <div className="balance">
        <div className={`emblem emblem--${snap.faction}`}>{FACTION_MARK[snap.faction]}</div>
        <div className="balance-center">
          <div className="balance-row">
            <span>
              {teamName(snap, snap.team)} <b>{snap.own}</b>
              <small>/{snap.ownTotal}</small>
            </span>
            <span className="balance-time">
              {formatTime(snap.time)}
              <span className="fps">
                {snap.fps}fps · {LEVELS[snap.level]?.label}
              </span>
            </span>
            <span>
              <b>{snap.enemy}</b>
              <small>/{snap.enemyTotal}</small> {teamName(snap, enemyTeam)}
            </span>
          </div>
          <div className="balance-bar">
            <div className="balance-fill" style={{ width: `${snap.balance * 100}%` }} />
          </div>
          {snap.conquest && <ConquestBar c={snap.conquest} />}
          {snap.tide && (
            <div className={`tide tide--${snap.tide.dir < 0 ? 'flood' : snap.tide.dir > 0 ? 'ebb' : 'slack'}`}>
              <span className="tide-arrow">{snap.tide.dir < 0 ? '⟵' : snap.tide.dir > 0 ? '⟶' : '·'}</span>
              물살 {snap.tide.knots}노트 · {snap.tide.label}
            </div>
          )}
        </div>
        <div className={`emblem emblem--${enemyFaction}`}>{FACTION_MARK[enemyFaction]}</div>
      </div>

      {snap.conquest?.selected && <PointPanel engine={engine} p={snap.conquest.selected} onClose={() => engine.selectPoint(snap.conquest!.selected!.id)} />}

      <DirectorToggle engine={engine} />

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast glass toast--${t.tone}`}>
            <span className="seal">{t.tone === 'good' ? '勝' : t.tone === 'bad' ? '敗' : '令'}</span>
            {t.text}
          </div>
        ))}
      </div>

      {showSettings && (
        <aside className="settings">
          <div className="settings-body glass">
            <div>
              <div className="settings-label">하늘</div>
              <div className="chips">
                {(Object.keys(SKY_PRESETS) as SkyPresetName[]).map((k) => (
                  <button key={k} className={`chip ${snap.sky === k ? 'chip--on' : ''}`} onClick={() => void engine.setSky(k)}>
                    {SKY_PRESETS[k].label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="settings-label">파도</div>
              <div className="chips">
                {(Object.keys(SEA_LABELS) as SeaStateName[]).map((k) => (
                  <button key={k} className={`chip ${snap.sea === k ? 'chip--on' : ''}`} onClick={() => engine.setSea(k)}>
                    {SEA_LABELS[k]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="settings-label">
                화질 <small>{snap.levelAuto ? `자동 · 지금 ${LEVELS[snap.level]?.label}` : LEVELS[snap.level]?.label}</small>
              </div>
              <div className="chips">
                <button className={`chip ${snap.levelAuto ? 'chip--on' : ''}`} onClick={() => engine.setQualityLevel('auto')}>
                  자동
                </button>
                {LEVELS.map((l, i) => (
                  <button key={l.label} className={`chip ${!snap.levelAuto && snap.level === i ? 'chip--on' : ''}`} onClick={() => engine.setQualityLevel(i)}>
                    {l.label}
                  </button>
                ))}
              </div>
              <div className="settings-hint">프레임이 좋으면 자동으로 올라가고, 끊기면 내려갑니다.</div>
            </div>
            <div>
              <div className="settings-label">
                설비 등급 <small>{EQUIPMENT_LABEL[equipment.setting]} · 적용하려면 재시작</small>
              </div>
              <div className="chips">
                {EQUIPMENT_CHOICES.map((k) => (
                  <button key={k} className={`chip ${equipment.setting === k ? 'chip--on' : ''}`} onClick={() => changeEquipment(k)}>
                    {EQUIPMENT_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="settings-label">소리 · 카메라</div>
              <div className="chips">
                <button
                  className={`chip ${!snap.muted ? 'chip--on' : ''}`}
                  onClick={() => {
                    engine.sound.setMuted(!engine.sound.muted);
                    engine.publish(true);
                  }}
                >
                  소리
                </button>
                <button
                  className={`chip ${snap.cinematic ? 'chip--on' : ''}`}
                  onClick={() => {
                    engine.rts.cinematic = !engine.rts.cinematic;
                    engine.publish(true);
                  }}
                >
                  관전 카메라
                </button>
                <button className="chip" onClick={() => engine.restart()}>
                  다시 시작
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}

      {box && <div className="select-box" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />}

      {compact && mapOn && <div className="minimap minimap--float" ref={minimapRef} />}

      {isTouchDevice && (
        <div className="touch-bar">
          <button className={`tool ${touchBox ? 'tool--on' : ''}`} onClick={() => setTouchBox(!touchBox)} title="한 손가락 끌기로 박스 선택">
            박스
          </button>
          <button className="tool" onClick={() => engine.input.clearSelection()} disabled={snap.selectedCount === 0}>
            해제
          </button>
          <button className={`tool ${snap.following ? 'tool--on' : ''}`} onClick={() => engine.input.followSelected()} disabled={snap.selectedCount === 0}>
            추적
          </button>
        </div>
      )}

      <div className={`bottom ${sheetFolded ? 'bottom--folded' : ''}`}>
        {!compact && <div className="minimap" ref={minimapRef} />}
        <div className={`detail glass interactive ${p ? '' : 'detail--empty'}`}>
          {p ? (
            <>
              <img className="detail-portrait" src={`/ui/portraits/${selectedSquad?.portrait ?? snap.squadrons.find((s) => s.selected)?.portrait ?? 'portrait_admiral'}.jpg`} alt="" />
              <div className="detail-body">
                <div className="detail-name">{p.name}</div>
                <div className="detail-sub">
                  {p.kind} · {ACTIVITY[p.activity] ?? p.activity}
                  {snap.selectedCount > 1 ? ` · ${snap.selectedCount}척` : ''} · {STANCE_SHORT[p.stance]} · {AMMO_SHORT[p.ammo]}
                  {p.fireMode === 'hold' ? ' · 사격중지' : ''}
                  {!p.lights && snap.night ? ' · 등화관제' : ''}
                </div>
                <Stat label="선체" value={p.hull} tone="hull" text={`${Math.round(p.hull * 100)}%`} />
                <Stat label="병력" value={p.crew / p.maxCrew} tone="crew" text={`${p.crew}`} />
                {p.fire > 0.02 && <Stat label="화재" value={p.fire} tone="fire" text={`${Math.round(p.fire * 100)}%`} />}
                <CrewPanel engine={engine} p={p} />
                {p.guns.length > 0 && (
                  <div className="guns">
                    {p.guns
                      .filter((g) => g.side !== 1)
                      .slice(0, 8)
                      .map((g, i) => (
                        <div key={i} className={`gun ${g.stage >= 4 ? 'gun--ready' : ''}`}>
                          <span>{g.label.replace('총통', '')}</span>
                          <div className="gun-track">
                            <i style={{ width: `${((g.stage + g.progress) / 6) * 100}%` }} />
                            <span>{g.stageName}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="detail-empty">
              <div className="detail-name">함대 지휘</div>
              {isTouchDevice ? (
                <>
                  <div>배를 탭해 고르고, 빈 바다를 탭하면 이동합니다.</div>
                  <div>적함을 탭하면 공격 · 한 손가락 끌기 시점 이동</div>
                  <div>두 손가락 벌려 확대 · 돌려 회전 · 위아래 기울임</div>
                </>
              ) : (
                <>
                  <div>아래 장수 패를 누르거나 배를 클릭해 선택하십시오.</div>
                  <div>우클릭 이동 · 적함 우클릭 공격 · Z/X 일제 사격</div>
                  <div>휠 확대 · WASD 이동 · Q/E 회전</div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="cards">
          {own.map((sq) => (
            <Card key={sq.id} sq={sq} onClick={(e) => engine.selectSquadron(sq.id, e.shiftKey)} onDouble={() => engine.focusSquadron(sq.id)} />
          ))}
        </div>
        <div className={`orders glass interactive ${ordersCollapsed ? 'orders--collapsed' : ''}`}>
          <Orders engine={engine} p={p} night={snap.night} selected={snap.selectedCount} collapsed={ordersCollapsed} onToggle={() => setOrdersCollapsed((v) => !v)} />
          {!compact && !engine.remote && (
            <div className="speed">
              <SpeedControl engine={engine} snap={snap} compact={false} />
            </div>
          )}
        </div>
        {compact && (
          <div className="dock interactive">
            <button className="dock-fold" aria-expanded={!sheetFolded} onClick={() => setSheetFolded((v) => !v)}>
              지휘 <span aria-hidden>{sheetFolded ? '▴' : '▾'}</span>
            </button>
            {!engine.remote && <SpeedControl engine={engine} snap={snap} compact />}
          </div>
        )}
      </div>

      {snap.winner && (
        <div className={`result glass result--${won ? 'win' : 'loss'}`}>
          <div className="result-title">{won ? '大捷' : '敗戰'}</div>
          <div className="result-sub">{won ? `${snap.scenario.title} — 승리` : `${FACTION_NAME[snap.faction]} 패전`}</div>
          <div className="result-stats">
            {snap.conquest
              ? `기세 ${snap.conquest.tickets.own} : ${snap.conquest.tickets.foe} · 거점 ${snap.conquest.held.own} : ${snap.conquest.held.foe}`
              : `적선 격파 ${snap.enemyTotal - snap.enemy - snap.escaped}척 · 도주 ${snap.escaped}척 · 아군 손실 ${snap.ownTotal - snap.own}척`}
          </div>
          {report && (
            <div className="result-camp">
              <p>
                전리품 — 군량 <b>+{report.loot.grain}</b> · 화약 <b>+{report.loot.powder}</b> · 목재 <b>+{report.loot.timber}</b>
              </p>
              <p>
                공훈 <b>+{report.loot.merit}</b> · 잃은 배 <b>{report.lost}</b>척
              </p>
              {report.xp.map((x) => (
                <p key={x.name}>
                  {x.name} 경험 <b>+{x.gained}</b> · Lv.{x.level}
                </p>
              ))}
              {report.levelUps.map((l) => (
                <p key={l}>
                  <b>승급</b> {l}
                </p>
              ))}
              {report.events.map((ev) => (
                <p key={ev} style={{ gridColumn: '1 / -1' }}>
                  {ev}
                </p>
              ))}
            </div>
          )}
          <button className="ink-btn" onClick={onBack}>
            {report ? '군영으로' : BACK_LABEL[origin].long}
          </button>
        </div>
      )}
    </div>
  );
}

export { AMMO_NAMES };
