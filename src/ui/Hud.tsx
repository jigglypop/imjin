import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { SPEEDS, type Engine } from '../game/Engine';
import { AMMO_NAMES } from '../game/Input';
import { isTouchDevice } from '../game/device';
import { EQUIPMENT_LABEL, equipment, saveEquipmentSetting, type EquipmentSetting } from '../game/quality';
import { SKY_PRESETS, type SkyPresetName } from '../render/sky';
import type { SeaStateName } from '../ocean/waves';
import { setLang, t as tr, useLang, useT } from '../i18n';
import { pushToast, setTouchBox, useUi, type BattleOrigin, type GameSnapshot, type GunInfo, type PrimaryInfo, type SquadronInfo } from '../state/store';
import type { Team } from '../sim/types';
import { useCompactLayout } from './useCompactLayout';
import { ConquestBar, CrewPanel, PointPanel } from './ConquestPanels';
import { DirectorSettings, ShotLabel } from './DirectorToggle';
import { Icon } from './battleIcons';
import { tCommander, tName, tShips } from './battleNames';
import { params } from './launch';
import './hud.css';
import { ControlsHelp, Tooltips, Tutorial, useTour } from './Tutorial';
import { useNet } from '../net/NetClient';
import { RankActions, RankResult } from './RankResult';

const SEA_LABELS: Record<SeaStateName, string> = { calm: '잔잔', moderate: '보통', rough: '거침' };
const ACTIVITY: Record<string, string> = {
  idle: '대기',
  moving: '이동',
  engaging: '교전',
  boarding: '백병전',
  sinking: '침몰',
  struck: '전투 불능',
  charging: '돌격',
  evading: '거리 유지',
  anchored: '정박',
  fleeing: '도주 중',
  aground: '좌초',
};
const AMMO_SHORT = { auto: '기본탄', hull: '대장군전', crew: '조란환', fire: '화전' } as const;
const EQUIPMENT_CHOICES: EquipmentSetting[] = ['auto', 'high', 'medium', 'low'];
/** The run-time quality levels, lowest first, in the words the settings screen uses. */
const LEVEL_LABEL = ['가장 낮음', '낮음', '보통', '높음', '가장 높음'];
const DECK_LABEL = ['', '상갑판', '포갑판', '노갑판'];

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

const PERF_KEY = 'imjin.hud.perf';

function readPerf(): boolean {
  if (params.has('debug')) return true;
  try {
    return localStorage.getItem(PERF_KEY) === 'on';
  } catch {
    return false;
  }
}

// The equipment class is resolved at page load, and its build-time resources are fixed for the session.
// Changing it means loading the page again, which restarts the battle.
function changeEquipment(next: EquipmentSetting) {
  if (next === equipment.setting) return;
  if (!confirm(tr('기기 등급을 바꾸면 페이지를 다시 불러옵니다. 진행 중인 전투는 처음부터 다시 시작됩니다. 계속하시겠습니까?'))) return;
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

/** A phone's card is 62 px wide: the long Korean fleet names drop their region prefix so two lines say all of it. */
function shortFleetName(name: string) {
  return name.replace(/^전라좌수영/, '좌수영').replace(/^전라우수영/, '우수영').replace(/^경상우수영/, '경상 우수영');
}

function Card({ sq, compact, onClick, onDouble }: { sq: SquadronInfo; compact: boolean; onClick: (e: React.MouseEvent) => void; onDouble: () => void }) {
  const t = useT();
  const lang = useLang();
  return (
    <button className={`card f-${sq.faction} ${sq.selected ? 'card--selected' : ''} ${sq.alive === 0 ? 'card--dead' : ''}`} onClick={onClick} onDoubleClick={onDouble} aria-label={`${tName(sq.name)} · ${tCommander(sq.commander)}`} data-tip="card">
      <img src={`/ui/portraits/${sq.portrait}.jpg`} alt="" />
      <div className="card-flags">
        {sq.burning > 0 && (
          <div className="card-flag card-flag--fire" title={t('불이 났습니다')}>
            <Icon name="flame" size={13} />
          </div>
        )}
        {sq.boarding > 0 && (
          <div className="card-flag" title={t('백병전 중입니다')}>
            <Icon name="melee" size={13} />
          </div>
        )}
      </div>
      <div className="card-foot">
        <div className="card-name">{compact && lang === 'ko' ? shortFleetName(sq.name) : tName(sq.name)}</div>
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

type OrderDef = { icon: string; label: string; key: string; tip: string; run: () => void; on?: boolean; disabled?: boolean };

/** Always available, including when a phone folds the larger command sheet. */
function FleetGroups({ engine, compact }: { engine: Engine; compact: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(!compact);
  const [assigning, setAssigning] = useState(false);
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState('');
  const input = engine.input;
  const groups = input.getGroups();
  const current = groups.find((g) => g.selected)?.index ?? active;
  const ownSelected = [...engine.views.selected].some((id) => engine.isOwn(engine.battle.get(id)));
  const queued = input.queuedWaypoints();
  useEffect(() => { setAssigning(false); setEditing(null); setActive(0); }, [engine.battle]);
  const saveName = () => {
    if (editing !== null) input.renameGroup(editing, name);
    setEditing(null);
  };
  return <div className="fleet-groups glass interactive" aria-label={t('지정 부대')}>
    <div className="fleet-group-head">
      <button className="fleet-group-toggle" aria-expanded={open} aria-controls="fleet-group-body" onClick={() => setOpen((v) => !v)}>
        {t('지정 부대')} <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
      </button>
      <button onClick={() => input.selectAll()} title="Ctrl+A">{t('전체 선택')}</button>
    </div>
    {open && <div className="fleet-group-body" id="fleet-group-body">
    <div className="fleet-group-tools">
      <button className={assigning ? 'fleet-tool--on' : ''} disabled={!ownSelected} onClick={() => setAssigning((v) => !v)} title={t('함선을 고른 뒤 지정할 부대를 누르세요')} aria-pressed={assigning}>{t(assigning ? '지정할 부대' : '부대 지정')}</button>
      <button onClick={() => { setEditing(current); setName(groups[current]!.name); }}>{t('이름')}</button>
      <button className={`fleet-route ${input.queueMoves ? 'fleet-tool--on' : ''}`} disabled={!ownSelected} onClick={() => input.toggleQueueMode()} aria-pressed={input.queueMoves} title={t('켜면 바다를 누를 때 이동 경로를 예약합니다 · Shift+우클릭도 가능')}>
        {t('경로 예약')}{queued > 0 && <b>{queued}/16</b>}
      </button>
    </div>
    <div className="fleet-group-grid">
      {groups.map((g) => <button key={g.index} className={`fleet-group ${g.selected ? 'fleet-group--selected' : ''} ${assigning ? 'fleet-group--assign' : ''}`} data-group={g.index + 1} title={t('{name} · {n}척 · 두 번 누르면 시점 이동', { name: g.name, n: g.count })} aria-label={t('{name} · {n}척', { name: g.name, n: g.count })} onClick={(e) => {
        setActive(g.index);
        if (assigning || e.ctrlKey || e.metaKey || (g.count === 0 && ownSelected)) { input.assignGroup(g.index, e.shiftKey); setAssigning(false); }
        else if (e.shiftKey) input.assignGroup(g.index, true);
        else input.selectGroup(g.index);
      }}>
        <span><kbd>{g.index + 1}</kbd><b>{g.count}</b></span><small>{g.name}</small>
      </button>)}
    </div>
    {editing !== null && <form className="fleet-group-name" onSubmit={(e) => { e.preventDefault(); saveName(); }}>
      <label htmlFor="fleet-name">{t('부대 {n}', { n: editing + 1 })}</label>
      <input id="fleet-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={16} autoFocus aria-label={t('부대 이름')} />
      <button type="submit">{t('저장')}</button><button type="button" onClick={() => setEditing(null)}>{t('취소')}</button>
    </form>}
    </div>}
  </div>;
}

function Orders({ engine, p, night, selected, collapsed, onToggle }: { engine: Engine; p: PrimaryInfo | null; night: boolean; selected: number; collapsed: boolean; onToggle: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('form');
  const input = engine.input;
  const none = selected === 0;
  const tabs: Record<Tab, { title: string; items: OrderDef[] }> = {
    form: {
      title: '진형',
      items: [
        { icon: 'crane', label: '학익진', key: 'Alt+1', tip: 'crane', run: () => input.formation('crane') },
        { icon: 'line', label: '일자진', key: 'Alt+2', tip: 'line', run: () => input.formation('line') },
        { icon: 'column', label: '장사진', key: 'Alt+3', tip: 'column', run: () => input.formation('column') },
        { icon: 'wedge', label: '첨자진', key: 'Alt+4', tip: 'wedge', run: () => input.formation('wedge') },
        ...(engine.battle.coastalTactic ? [{ icon: 'crane' as const, label: engine.battle.coastalTactic === 'yeosu-wings' ? '여수 분산익진' : '목포 수로종심진', key: '', tip: engine.battle.coastalTactic, run: () => input.formation(engine.battle.coastalTactic!) }] : []),
        { icon: 'scatter', label: '자유교전', key: 'G', tip: 'auto', run: () => input.auto() },
      ],
    },
    gun: {
      title: '포격',
      items: [
        { icon: 'portVolley', label: '좌현 일제', key: 'Z', tip: 'volley.port', run: () => input.volley(0), disabled: none },
        { icon: 'starboardVolley', label: '우현 일제', key: 'X', tip: 'volley.starboard', run: () => input.volley(1), disabled: none },
        { icon: p?.fireMode === 'hold' ? 'hold' : 'aim', label: p?.fireMode === 'hold' ? '사격 중지' : '자유 사격', key: 'Y', tip: 'fire', run: () => input.toggleFire(), on: p?.fireMode === 'hold' },
        { icon: 'shot', label: p ? AMMO_SHORT[p.ammo] : '탄종', key: 'T', tip: 'ammo', run: () => input.cycleAmmo(), on: !!p && p.ammo !== 'auto' },
        { icon: 'broadside', label: '측면 정렬', key: 'U', tip: 'broadside', run: () => input.presentBroadside(), disabled: none },
      ],
    },
    move: {
      title: '기동',
      items: [
        { icon: 'fast', label: '전속', key: 'Alt+5', tip: 'speed.full', run: () => input.setSpeed(1), on: !!p && p.speedCap >= 1, disabled: none },
        { icon: 'half', label: '반속', key: 'Alt+6', tip: 'speed.half', run: () => input.setSpeed(0.6), on: !!p && p.speedCap >= 0.5 && p.speedCap < 1, disabled: none },
        { icon: 'slow', label: '저속', key: 'Alt+7', tip: 'speed.slow', run: () => input.setSpeed(0.3), on: !!p && p.speedCap > 0 && p.speedCap < 0.5, disabled: none },
        { icon: 'stop', label: '정지', key: 'H', tip: 'hold', run: () => input.hold(), disabled: none },
        // A toggle named for what the press does; it is lit while the ship runs dark.
        { icon: 'lantern', label: p && !p.lights ? '등불 켜기' : '등불 끄기', key: 'L', tip: 'lights', run: () => input.toggleLights(), on: !!p && !p.lights, disabled: !night },
      ],
    },
    tactic: {
      title: '전술',
      items: [
        { icon: 'standoff', label: '원거리', key: 'K', tip: 'standoff', run: () => input.setStance('standoff'), on: p?.stance === 'standoff', disabled: none },
        { icon: 'close', label: '근접 포격', key: 'J', tip: 'close', run: () => input.setStance('close'), on: p?.stance === 'close', disabled: none },
        { icon: 'ram', label: '들이받기', key: 'N', tip: 'ram', run: () => input.setStance('ram'), on: p?.stance === 'ram', disabled: none },
        { icon: 'board', label: '백병전 돌입', key: 'B', tip: 'board', run: () => input.setStance('board'), on: p?.stance === 'board', disabled: none },
        { icon: 'repel', label: '백병전 방어', key: 'P', tip: 'repel', run: () => input.repel(), on: !!p && p.repel, disabled: none },
      ],
    },
  };
  const current = tabs[tab];
  return (
    <>
      <div className="orders-tabs">
        {(Object.keys(tabs) as Tab[]).map((k) => (
          <button key={k} className={`orders-tab ${k === tab ? 'orders-tab--on' : ''}`} onClick={() => setTab(k)} data-tip={`tab.${k}`}>
            {t(tabs[k].title)}
          </button>
        ))}
        <button className="orders-fold" onClick={onToggle} aria-expanded={!collapsed} title={t(collapsed ? '명령 펼치기' : '명령 접기')}>
          <Icon name={collapsed ? 'chevronUp' : 'chevronDown'} size={16} />
        </button>
      </div>
      {!collapsed && (
        <div className="orders-grid">
          {current.items.map((o) => (
            <button key={o.tip} className={`order ${o.on ? 'order--on' : ''}`} onClick={o.disabled ? undefined : o.run} aria-disabled={o.disabled || undefined} aria-label={`${t(o.label)} (${o.key})`} data-tip={o.tip}>
              <span className="order-icon">
                <Icon name={o.icon} size={22} />
              </span>
              <span className="order-label">{t(o.label)}</span>
              <kbd>{o.key}</kbd>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Publishes where the top bars really end as CSS variables on the page root: the bottom edge of the score panel
 * (--bal-bottom, for toasts, the point panel and the online pills), the right edge of the menu buttons and the left edge
 * of the speed pills (--tl-right / --tr-left, which the landscape phone's score panel sits between).
 */
function useHudInsets() {
  useEffect(() => {
    const root = document.documentElement.style;
    const last: Record<string, string> = {};
    const put = (name: string, v: number | null) => {
      const next = v === null ? '' : `${Math.round(v)}px`;
      if (last[name] === next) return;
      last[name] = next;
      if (next) root.setProperty(name, next);
      else root.removeProperty(name);
    };
    const measure = () => {
      const box = (sel: string) => {
        const r = document.querySelector(sel)?.getBoundingClientRect();
        return r && r.width > 0 && r.height > 0 ? r : null;
      };
      put('--bal-bottom', box('.hud .balance')?.bottom ?? null);
      put('--tl-right', box('.hud .hud-menu')?.right ?? null);
      put('--tr-left', box('.hud .dock')?.left ?? null);
      put('--tl-bottom', box('.hud .hud-menu')?.bottom ?? null);
      const bottom = box('.hud .bottom')?.top ?? null;
      put('--bottom-top', bottom);
      // Conquest sheets use the former toolbar edge as their lower limit; it now follows the bottom cards.
      put('--fleet-top', bottom);
    };
    measure();
    const timer = window.setInterval(measure, 200);
    window.addEventListener('resize', measure);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', measure);
      for (const n of ['--bal-bottom', '--tl-right', '--tr-left', '--tl-bottom', '--bottom-top', '--fleet-top']) root.removeProperty(n);
    };
  }, []);
}

/** Where the back button leads, named for the screen the battle was started from. */
const BACK_LABEL: Record<BattleOrigin, { long: string; short: string }> = {
  select: { long: '전투 선택', short: '전투 선택' },
  skirmish: { long: '쟁탈전', short: '쟁탈전' },
  online: { long: '대전 대기실', short: '대기실' },
  faction: { long: '전역 지도', short: '전역' },
};

/** Pause and speed. Wide layouts show every multiplier; compact ones show one button that cycles through them. */
function SpeedControl({ engine, snap, compact }: { engine: Engine; snap: GameSnapshot; compact: boolean }) {
  const t = useT();
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
        aria-label={t(snap.paused ? '계속' : '일시정지')}
        data-tip="pause"
        onClick={() => {
          engine.paused = !engine.paused;
          engine.publish(true);
        }}
      >
        <Icon name={snap.paused ? 'play' : 'pause'} size={16} />
      </button>
      {compact ? (
        <button aria-label={t('배속 바꾸기')} data-tip="speed" onClick={() => setSpeed(next)}>
          {snap.speed}×
        </button>
      ) : (
        SPEEDS.map((s) => (
          <button key={s} className={!snap.paused && snap.speed === s ? 'on' : ''} data-tip="speed" onClick={() => setSpeed(s)}>
            {s}×
          </button>
        ))
      )}
      {snap.approach && (
        <button
          className={`speed-skip ${snap.autoFast || snap.fastForward ? 'on' : ''}`}
          aria-label={t(snap.autoFast ? '빠른 접근 끄기' : '적과 마주칠 때까지 빠르게 진행')}
          data-tip="skip"
          onClick={() => {
            // Toggles: a capture-point battle starts with it off, a historical one with it on.
            const on = !(snap.autoFast || snap.fastForward);
            engine.autoFast = on;
            if (!on) engine.fastForward = false;
            engine.publish(true);
          }}
        >
          {snap.fastForward ? <span>{t('접근 중')}</span> : null}
          <Icon name="skip" size={16} />
        </button>
      )}
    </>
  );
}

const GUN_SIDES: [number, string][] = [
  [0, '좌현'],
  [2, '함수'],
  [1, '우현'],
];

/**
 * The ship's guns as lights, one per gun, grouped by side: green when it can fire, filling amber while it loads, an empty
 * ring when it is out of shot. Each light names its gun and stage on hover.
 */
function GunLights({ guns }: { guns: GunInfo[] }) {
  const t = useT();
  return (
    <div className="gun-lights">
      {GUN_SIDES.map(([side, label]) => {
        const list = guns.filter((g) => g.side === side);
        if (!list.length) return null;
        return (
          <div key={side} className="gun-side">
            <span>{t(label)}</span>
            <div className="gun-dots">
              {list.map((g, i) => (
                <i
                  key={i}
                  className={`gun-dot ${g.empty ? 'gun-dot--empty' : g.stage >= 4 ? 'gun-dot--ready' : ''}`}
                  style={{ '--p': Math.min(1, (g.stage + g.progress) / 4) } as CSSProperties}
                  title={`${t(g.label)} · ${g.stageName}`}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Detail({ engine, snap, p, portrait }: { engine: Engine; snap: GameSnapshot; p: PrimaryInfo; portrait: string }) {
  const t = useT();
  return (
    <div className="detail glass interactive">
        <div className="detail-head">
          <img className="detail-portrait" src={`/ui/portraits/${portrait}.jpg`} alt="" />
          <div className="detail-title">
            <div className="detail-name">{tName(p.name)}</div>
            <div className="detail-sub">
              {t(p.kind)} · {t(ACTIVITY[p.activity] ?? p.activity)}
              {p.fireMode === 'hold' ? ' · ' + t('사격 중지') : ''}
              {!p.lights && snap.night ? ' · ' + t('등불 꺼짐') : ''}
            </div>
          </div>
        </div>
        <div className="detail-body">
          <Stat label={t('선체')} value={p.hull} tone="hull" text={`${Math.round(p.hull * 100)}%`} />
          <Stat label={t('승조원')} value={p.crew / p.maxCrew} tone="crew" text={`${p.crew}`} />
          {p.fire > 0.02 && <Stat label={t('화재')} value={p.fire} tone="fire" text={`${Math.round(p.fire * 100)}%`} />}
          {p.damageState && Object.entries(p.damageState).map(([kind, damage]) => damage > 0.015 && <Stat key={kind} label={t(kind === 'flooding' ? '침수' : kind === 'propulsion' ? '추진 손상' : '조타 손상')} value={damage} tone="fire" text={`${Math.round(damage * 100)}%`} />)}
          {p.guns.length > 0 && <GunLights guns={p.guns} />}
          <CrewPanel engine={engine} p={p} />
        </div>
    </div>
  );
}

const HINT_KEY = 'imjin.hud.hint';

function readHint(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** The short reminder shown while nothing is selected. The player can close it for good. */
function Hint({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <div className="hint glass interactive">
      <div className="hint-head">
        <b>{t('함대 지휘')}</b>
        <button className="hint-x" onClick={onClose} aria-label={t('안내 닫기')}>
          <Icon name="x" size={14} />
        </button>
      </div>
      {isTouchDevice ? (
        <p>
          {t('함선을 탭해 고르고, 빈 바다를 탭하면 이동합니다.')}
          <br />
          {t('적 함선을 탭하면 공격합니다.')}
        </p>
      ) : (
        <p>
          {t('장수 패나 함선을 눌러 고릅니다.')}
          <br />
          {t('우클릭으로 이동과 공격, Z·X로 일제 사격을 합니다.')}
        </p>
      )}
    </div>
  );
}

export function Hud({ engine, onBack }: { engine: Engine; onBack: () => void }) {
  const t = useT();
  const lang = useLang();
  const snap = useUi((s) => s.snapshot);
  const toasts = useUi((s) => s.toasts);
  const box = useUi((s) => s.box);
  const report = useUi((s) => s.report);
  const touchBox = useUi((s) => s.touchBox);
  const origin = useUi((s) => s.origin);
  const rankedMatch = useNet((s) => s.rankedMatch);
  const tourActive = useTour((s) => s.active);
  const compact = useCompactLayout();
  const [showSettings, setShowSettings] = useState(false);
  // The minimap is always on in the wide layout. On phones it opens as a floating panel from the menu.
  const [mapOn, setMapOn] = useState(false);
  const [ordersCollapsed, setOrdersCollapsed] = useState(false);
  // Portrait phones fold the detail and orders away to leave the sea in view. Short phones start folded.
  const [sheetFolded, setSheetFolded] = useState(() => innerHeight < 760);
  const [hintOpen, setHintOpen] = useState(readHint);
  const [perf, setPerf] = useState(readPerf);
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const wasTour = useRef(false);
  useHudInsets();
  const closeHint = () => {
    setHintOpen(false);
    try {
      localStorage.setItem(HINT_KEY, 'off');
    } catch {
      // Private windows may refuse storage: the hint then comes back next time.
    }
  };
  const togglePerf = () => {
    const next = !perf;
    setPerf(next);
    try {
      localStorage.setItem(PERF_KEY, next ? 'on' : 'off');
    } catch {
      // The choice then lasts for this battle only.
    }
  };

  useEffect(() => {
    engine.minimap.mount(minimapRef.current);
  }, [engine, snap?.scenario.id, compact, mapOn]);

  // The tour says what the bottom-left hint says, so the hint is retired once the tour has been read.
  useEffect(() => {
    if (wasTour.current && !tourActive) closeHint();
    wasTour.current = tourActive;
  }, [tourActive]);

  if (!snap) return null;
  const own = snap.squadrons.filter((s) => s.faction === snap.faction);
  const p = snap.primary;
  const primaryShip = p ? engine.battle.get(p.id) : undefined;
  const primaryFaction = primaryShip?.spec.faction ?? snap.faction;
  const primaryPortrait = snap.squadrons.find((s) => s.id === primaryShip?.squadronId)?.portrait
    ?? (primaryFaction === 'japan' ? 'portrait_japan' : primaryFaction === 'ming' ? 'portrait_chenlin' : 'portrait_admiral');
  const enemyTeam: Team = snap.team === 'joseon' ? 'japan' : 'joseon';
  const enemyFaction = snap.squadrons.find((s) => s.team === enemyTeam)?.faction ?? enemyTeam;
  const won = snap.winner === snap.team;
  const ended = !!snap.winner || snap.draw;
  // A phone's score panel has room for the navy's name only.
  const sideName = (team: Team) => {
    const name = teamName(snap, team);
    return compact ? name.replace(/ (수군|연합|Navy|Allies)$/, '') : name;
  };
  const stats: { label: string; value: string }[] = snap.conquest
    ? [
        { label: '기세', value: `${snap.conquest.tickets.own} : ${snap.conquest.tickets.foe}` },
        { label: '거점', value: `${snap.conquest.held.own} : ${snap.conquest.held.foe}` },
        { label: '소요 시간', value: formatTime(snap.time) },
      ]
    : [
        { label: '격파', value: tShips(snap.enemyTotal - snap.enemy - snap.escaped) },
        { label: '도주', value: tShips(snap.escaped) },
        { label: '손실', value: tShips(snap.ownTotal - snap.own) },
        { label: '소요 시간', value: formatTime(snap.time) },
      ];
  return (
    <div className="hud" style={{ '--own-fc': `var(--${snap.faction})`, '--enemy-fc': `var(--${enemyFaction})` } as React.CSSProperties}>
      <div className="hud-title">
        <div className="hud-title-main">{t(snap.scenario.title)}</div>
        <div className="hud-title-sub">
          {t(snap.scenario.date)} · {t(snap.scenario.place)}
        </div>
        <div className="hud-menu">
          <button className="mini-btn" onClick={onBack} title={rankedMatch && !ended ? t('기권하면 랭크 점수에 반영됩니다') : undefined}>
            <span className="long">{t(rankedMatch && !ended ? '기권하고 대기실로' : BACK_LABEL[origin].long)}</span>
            <span className="short">{t(rankedMatch && !ended ? '기권' : BACK_LABEL[origin].short)}</span>
          </button>
          <button className={`mini-btn ${showSettings ? 'mini-btn--on' : ''}`} onClick={() => setShowSettings((v) => !v)}>
            <Icon name="settings" size={16} />
            {t('설정')}
          </button>
          {compact && (
            <button className={`mini-btn ${mapOn ? 'mini-btn--on' : ''}`} onClick={() => setMapOn((v) => !v)}>
              <Icon name="map" size={16} />
              {t('지도')}
            </button>
          )}
          {engine.campaign && !ended && (
            <button className="mini-btn" onClick={() => engine.endBattle()}>
              {t('철수')}
            </button>
          )}
        </div>
      </div>

      <div className={`balance glass${snap.conquest ? ' balance--cq' : ''}`}>
        <div className="bal-row">
          <span className="bal-side bal-side--own">
            <i className="bal-mark" />
            <span className="bal-name">{sideName(snap.team)}</span>
            <b>{snap.own}</b>
            <small>/{snap.ownTotal}</small>
          </span>
          <span className="bal-time">
            {formatTime(snap.time)}
            {perf && (
              <span className="fps">
                {snap.fps}fps · {t(LEVEL_LABEL[snap.level] ?? '')}
              </span>
            )}
          </span>
          <span className="bal-side bal-side--foe">
            <b>{snap.enemy}</b>
            <small>{snap.observedEnemy ? t('관측') : `/${snap.enemyTotal}`}</small>
            <span className="bal-name">{sideName(enemyTeam)}</span>
            <i className="bal-mark" />
          </span>
        </div>
        <div className="bal-bar" role="img" aria-label={t(snap.conquest ? '기세 {side} {n}%' : '전세 {side} {n}%', { side: snap.sides.own, n: Math.round(snap.balance * 100) })}>
          <i style={{ flexBasis: `${snap.balance * 100}%` }} />
          <i />
        </div>
        {snap.conquest && <ConquestBar c={snap.conquest} />}
        {snap.tide && (
          <div className={`tide tide--${snap.tide.dir < 0 ? 'flood' : snap.tide.dir > 0 ? 'ebb' : 'slack'}`}>
            <span className="tide-arrow">{snap.tide.dir < 0 ? <Icon name="chevronLeft" size={12} /> : snap.tide.dir > 0 ? <Icon name="chevronRight" size={12} /> : '·'}</span>
            {t('물살 {knots}노트 · {label}', { knots: snap.tide.knots, label: snap.tide.label })}
          </div>
        )}
      </div>

      {snap.conquest?.selected && <PointPanel engine={engine} p={snap.conquest.selected} onClose={() => engine.selectPoint(snap.conquest!.selected!.id)} />}

      <ShotLabel engine={engine} />

      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast glass toast--${toast.tone}`}>
            <i className="toast-dot" />
            {toast.text}
          </div>
        ))}
      </div>

      {showSettings && (
        <aside className="settings">
          <div className="settings-body glass" style={{ maxHeight: compact ? 'calc(100dvh - 120px)' : 'calc(100dvh - 250px)', overflowY: 'auto' }}>
            <DirectorSettings engine={engine} />
            <section className="settings-sec">
              <div className="settings-label">{t('하늘')}</div>
              <div className="chips">
                {(Object.keys(SKY_PRESETS) as SkyPresetName[]).map((k) => (
                  <button key={k} className={`chip ${snap.sky === k ? 'chip--on' : ''}`} onClick={() => void engine.setSky(k).catch(() => pushToast(t('하늘을 불러오지 못했습니다'), 'bad'))}>
                    {t(SKY_PRESETS[k].label)}
                  </button>
                ))}
              </div>
            </section>
            <section className="settings-sec">
              <div className="settings-label">{t('파도')}</div>
              <div className="chips">
                {(Object.keys(SEA_LABELS) as SeaStateName[]).map((k) => (
                  <button key={k} className={`chip ${snap.sea === k ? 'chip--on' : ''}`} onClick={() => engine.setSea(k)}>
                    {t(SEA_LABELS[k])}
                  </button>
                ))}
              </div>
            </section>
            <section className="settings-sec">
              <div className="settings-label">
                {t('화질')} <small>{snap.levelAuto ? t('자동 · 지금 {level}', { level: t(LEVEL_LABEL[snap.level] ?? '') }) : t(LEVEL_LABEL[snap.level] ?? '')}</small>
              </div>
              <div className="chips">
                <button className={`chip ${snap.levelAuto ? 'chip--on' : ''}`} onClick={() => engine.setQualityLevel('auto')}>
                  {t('자동')}
                </button>
                {LEVEL_LABEL.map((label, i) => (
                  <button key={label} className={`chip ${!snap.levelAuto && snap.level === i ? 'chip--on' : ''}`} onClick={() => engine.setQualityLevel(i)}>
                    {t(label)}
                  </button>
                ))}
              </div>
              <div className="settings-hint">{t('자동은 프레임에 맞춰 화질을 올리고 내립니다.')}</div>
            </section>
            <section className="settings-sec">
              <div className="settings-label">
                {t('기기 등급')} <small>{t(EQUIPMENT_LABEL[equipment.setting])}</small>
              </div>
              <div className="chips">
                {EQUIPMENT_CHOICES.map((k) => (
                  <button key={k} className={`chip ${equipment.setting === k ? 'chip--on' : ''}`} onClick={() => changeEquipment(k)}>
                    {t(EQUIPMENT_LABEL[k])}
                  </button>
                ))}
              </div>
              <div className="settings-hint">{t('바꾸면 페이지를 다시 불러오며 전투가 처음부터 시작됩니다.')}</div>
            </section>
            <section className="settings-sec">
              <div className="settings-label">{t('소리')}</div>
              <div className="chips">
                <button
                  className={`chip ${!snap.muted ? 'chip--on' : ''}`}
                  aria-pressed={!snap.muted}
                  onClick={() => {
                    engine.sound.setMuted(!engine.sound.muted);
                    engine.publish(true);
                  }}
                >
                  {t(snap.muted ? '소리 꺼짐' : '소리 켜짐')}
                </button>
                <button
                  className={`chip ${engine.sound.musicOn ? 'chip--on' : ''}`}
                  aria-pressed={engine.sound.musicOn}
                  onClick={() => {
                    engine.sound.setMusic(!engine.sound.musicOn);
                    engine.publish(true);
                  }}
                >
                  {t(engine.sound.musicOn ? '배경음악 켜짐' : '배경음악 꺼짐')}
                </button>
              </div>
            </section>
            <section className="settings-sec">
              <div className="settings-label">{t('화면 표시')}</div>
              <div className="chips">
                <button className={`chip ${perf ? 'chip--on' : ''}`} aria-pressed={perf} onClick={togglePerf}>
                  {t('성능 표시')}
                </button>
              </div>
            </section>
            <section className="settings-sec">
              <div className="settings-label">{t('언어')}</div>
              <div className="chips">
                {(['ko', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    className={`chip ${lang === l ? 'chip--on' : ''}`}
                    aria-pressed={lang === l}
                    onClick={() => {
                      setLang(l);
                      // The engine words some of what the HUD shows (side names, gun stages) when it publishes.
                      engine.publish(true);
                    }}
                  >
                    {l === 'ko' ? '한국어' : 'English'}
                  </button>
                ))}
              </div>
            </section>
            {origin !== 'faction' && !engine.remote && !engine.campaign && (
              <section className="settings-sec">
                <div className="settings-label">{t('전투')}</div>
                <div className="chips">
                  <button className="chip" onClick={() => engine.restart()}>
                    {t('다시 시작')}
                  </button>
                </div>
              </section>
            )}
            <ControlsHelp onReplay={() => setShowSettings(false)} />
          </div>
        </aside>
      )}

      {box && <div className="select-box" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />}

      {compact && mapOn && <div className="minimap minimap--float" ref={minimapRef} />}

      {!ended && (
        <div className="selection-dock touch-bar">
          <FleetGroups engine={engine} compact={compact} />
          {isTouchDevice && <div className="selection-tools">
          <button className={`tool ${touchBox ? 'tool--on' : ''}`} onClick={() => setTouchBox(!touchBox)} data-tip="tool.box">
            <Icon name="box" size={19} />
            {t('박스')}
          </button>
          <button className="tool" onClick={() => engine.input.clearSelection()} aria-disabled={snap.selectedCount === 0 || undefined} data-tip="tool.clear">
            <Icon name="clear" size={19} />
            {t('해제')}
          </button>
          <button className={`tool ${snap.following ? 'tool--on' : ''}`} onClick={() => snap.selectedCount > 0 && engine.input.followSelected()} aria-disabled={snap.selectedCount === 0 || undefined} data-tip="tool.follow">
            <Icon name="follow" size={19} />
            {t('추적')}
          </button>
          {/* The crew panel with the cutaway chip is hidden on phones, so the deck view needs its own button. */}
          <button className={`tool ${engine.cutaway ? 'tool--on' : ''}`} onClick={() => (snap.selectedCount > 0 || engine.cutaway) && engine.toggleCutaway()} aria-disabled={(snap.selectedCount === 0 && !engine.cutaway) || undefined} data-tip="tool.deck">
            <Icon name="deck" size={19} />
            {t(engine.cutaway ? DECK_LABEL[engine.cutaway]! : '선내')}
          </button>
          </div>}
        </div>
      )}

      <div className={`bottom ${sheetFolded ? 'bottom--folded' : ''}`}>
        {!compact && <div className="minimap" ref={minimapRef} />}
        {/* Once the battle is decided the result card is the only thing to act on: no orders or cards behind it. */}
        {!ended && (
          <>
            {p ? <Detail engine={engine} snap={snap} p={p} portrait={primaryPortrait} /> : hintOpen && !tourActive && <Hint onClose={closeHint} />}
            <div className="cards">
              {own.map((sq) => (
                <Card key={sq.id} sq={sq} compact={compact} onClick={(e) => engine.selectSquadron(sq.id, e.shiftKey)} onDouble={() => engine.focusSquadron(sq.id)} />
              ))}
            </div>
            {/* A landscape phone's settings sheet reaches down over the orders. */}
            <div className={`orders glass interactive ${ordersCollapsed ? 'orders--collapsed' : ''}`} style={showSettings && compact ? { visibility: 'hidden' } : undefined}>
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
                  {t('지휘')} <Icon name={sheetFolded ? 'chevronUp' : 'chevronDown'} size={14} />
                </button>
                {!engine.remote && <SpeedControl engine={engine} snap={snap} compact />}
              </div>
            )}
          </>
        )}
      </div>

      {!ended && <Tutorial engine={engine} compact={compact} />}
      <Tooltips />

      {ended && (
        <div className={`result glass result--${snap.draw ? 'draw' : won ? 'win' : 'loss'}`}>
          <div className="result-title">{t(snap.draw ? '무승부' : won ? '승리' : '패배')}</div>
          <div className="result-sub">{t(snap.scenario.title)}</div>
          <div className="result-stats">
            {stats.map((s, i) => (
              <span key={s.label}>
                {i > 0 && ' · '}
                {t(s.label)} <b>{s.value}</b>
              </span>
            ))}
          </div>
          {engine.remote && rankedMatch && <RankResult />}
          {report && (
            <div className="result-camp">
              <p>
                {t('전리품')} <b>{t('군량')} +{report.loot.grain}</b> · <b>{t('화약')} +{report.loot.powder}</b> · <b>{t('목재')} +{report.loot.timber}</b>
              </p>
              <p>
                {t('공훈')} <b>+{report.loot.merit}</b> · {t('잃은 함선')} <b>{tShips(report.lost)}</b>
              </p>
              {report.xp.map((x) => (
                <p key={x.name}>
                  {t('{name} 경험', { name: tCommander(x.name) })} <b>+{x.gained}</b> · Lv.{x.level}
                </p>
              ))}
              {report.levelUps.map((l) => (
                <p key={l}>
                  <b>{t('승급')}</b> {tCommander(l)}
                </p>
              ))}
              {report.events.map((ev) => (
                <p key={ev} style={{ gridColumn: '1 / -1' }}>
                  {t(ev)}
                </p>
              ))}
            </div>
          )}
          <div className="result-actions">
            {origin !== 'faction' && !engine.remote && !engine.campaign && (
              <button className="chip" onClick={() => engine.restart()}>
                {t('다시 시작')}
              </button>
            )}
            {engine.remote && rankedMatch ? <RankActions /> : <button className="ink-btn" onClick={onBack}>
              {report ? t('군영으로') : t(BACK_LABEL[origin].long)}
            </button>}
          </div>
        </div>
      )}
    </div>
  );
}

export { AMMO_NAMES };
