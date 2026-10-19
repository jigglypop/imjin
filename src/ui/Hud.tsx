import { memo, useCallback, useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { SPEEDS, type Engine } from '../game/Engine';
import { AMMO_NAMES, MANEUVER_NAMES } from '../game/Input';
import type { ManeuverKind } from '../sim/maneuvers';
import type { DragFormation } from '../game/formationLayout';
import { isTouchDevice, isTouchOnly } from '../game/device';
import { EQUIPMENT_LABEL, equipment, saveEquipmentSetting, type EquipmentSetting } from '../game/quality';
import { SKY_PRESETS, type SkyPresetName } from '../render/sky';
import type { SeaStateName } from '../ocean/waves';
import { setLang, t as tr, useLang, useT } from '../i18n';
import { pushToast, setTouchBox, useUi, type BattleOrigin, type FleetMorale, type GameSnapshot, type GunInfo, type PrimaryInfo, type SquadronInfo } from '../state/store';
import type { Faction, Team } from '../sim/types';
import { useCompactLayout } from './useCompactLayout';
import { ConquestBar, CrewPanel, PointPanel } from './ConquestPanels';
import { DirectorSettings, ShotLabel } from './DirectorToggle';
import { Icon } from './battleIcons';
import { CodexIcon } from './codex/icons';
import { routePath } from '../routes';
import { tCommander, tName, tShips } from './battleNames';
import { params } from './launch';
import './hud.css';
import { ControlsHelp, Tooltips, Tutorial, useTour } from './Tutorial';
import { useNet } from '../net/NetClient';
import { RankActions, RankResult } from './RankResult';
import { portraitUrl } from './portrait';
import { BattleGuide } from './BattleGuide';
import { MusicVolume } from './MusicVolume';
import { BattleResult } from './BattleResult';
import { GUIDES, guidedFaction } from './guideText';

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
/** The portrait for a ship whose squadron names none: its navy's commander-in-chief. */
const FALLBACK_PORTRAIT: Record<Faction, string> = { joseon: 'portrait_admiral', japan: 'portrait_japan', ming: 'portrait_chenlin', england: 'portrait_howard', spain: 'portrait_medina', holyleague: 'portrait_donjuan', ottoman: 'portrait_alipasha', britain: 'portrait_nelson', france: 'portrait_villeneuve', spain1805: 'portrait_gravina' };

/** The battle clock, the only part of the score panel that changes every publish. */
function Clock() {
  const time = useUi((s) => s.live.time);
  return <>{formatTime(time)}</>;
}

function Fps() {
  const fps = useUi((s) => s.live.fps);
  return <>{fps}</>;
}

/**
 * Re-renders a component that reads the engine's own state (groups, the selection, a maneuver being placed) at the
 * rate the snapshot is published, now that its parent no longer re-renders on every publish.
 */
function useEngineTick(ms = 150) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const timer = window.setInterval(tick, ms);
    return () => window.clearInterval(timer);
  }, [ms]);
}

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

/** How a crew's or a fleet's nerve is named on the HUD when it is not steady (the battle depth rules). */
const NERVE_WORD: Record<string, string> = { wavering: '동요', routing: '패주', rallying: '재집결', shaken: '동요', broken: '붕괴' };

const Stat = memo(function Stat({ label, value, tone, text }: { label: string; value: number; tone: 'hull' | 'crew' | 'fire' | 'morale'; text: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <div className={`stat-bar stat-bar--${tone}`}>
        <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      </div>
      <b>{text}</b>
    </div>
  );
});

/** A phone's card is 62 px wide: the long Korean fleet names drop their region prefix so two lines say all of it. */
function shortFleetName(name: string) {
  return name.replace(/^전라좌수영/, '좌수영').replace(/^전라우수영/, '우수영').replace(/^경상우수영/, '경상 우수영');
}

/**
 * Each fleet's nerve under its strength bar (the battle depth rules): two meters filling outward from the middle, the
 * player's to the left and the foe's to the right, amber while a fleet wavers and red once it breaks.
 */
const NerveRow = memo(function NerveRow({ m }: { m: { own: FleetMorale; foe: FleetMorale } }) {
  const t = useT();
  const side = (f: FleetMorale, which: 'own' | 'foe') => {
    const word = NERVE_WORD[f.state];
    return (
      <span className={`bal-nerve-side bal-nerve-side--${which} is-${f.state}`}>
        {word && which === 'own' && <b>{t(word)}</b>}
        <span className="bal-nerve-meter">
          <i style={{ width: `${Math.round(f.level * 100)}%` }} />
        </span>
        {word && which === 'foe' && <b>{t(word)}</b>}
      </span>
    );
  };
  return (
    <div className="bal-nerve" role="img" aria-label={t('사기 · 아군 {own}% · 적 {foe}%', { own: Math.round(m.own.level * 100), foe: Math.round(m.foe.level * 100) })} data-tip="morale">
      {side(m.own, 'own')}
      <span className="bal-nerve-label">{t('사기')}</span>
      {side(m.foe, 'foe')}
    </div>
  );
});

/** The one order the moment calls for, as a single quiet button over the cards: pressing it carries it out. */
function AdviceButton({ engine }: { engine: Engine }) {
  const t = useT();
  useEngineTick(500);
  const a = engine.remote ? null : engine.input.advice();
  if (!a) return null;
  return (
    <button key={a.key} className="advice glass interactive" onClick={() => engine.input.takeAdvice(a)} data-tip="advice">
      <span className="advice-tag">{t('추천')}</span>
      <span className="advice-text">{t(a.text, { n: a.n ?? 0 })}</span>
    </button>
  );
}

const Card = memo(function Card({ sq, compact, depth, onSelect, onFocus }: { sq: SquadronInfo; compact: boolean; depth: boolean; onSelect: (id: number, add: boolean) => void; onFocus: (id: number) => void }) {
  const t = useT();
  const lang = useLang();
  return (
    // The simplified layout shows only the portrait and the count: the explanation is headed by the fleet's name.
    <button className={`card f-${sq.faction} ${sq.selected ? 'card--selected' : ''} ${sq.alive === 0 ? 'card--dead' : ''}`} onClick={(e) => onSelect(sq.id, e.shiftKey)} onDoubleClick={() => onFocus(sq.id)} aria-label={`${tName(sq.name)} · ${tCommander(sq.commander)}`} data-tip="card" data-tip-title={`${tName(sq.name)} · ${tCommander(sq.commander)}`}>
      <img src={portraitUrl(sq.portrait, true)} alt="" />
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
        {sq.routing > 0 ? (
          <div className="card-flag card-flag--rout" title={t('{n}척이 달아나고 있습니다', { n: sq.routing })}>
            <Icon name="rout" size={13} />
          </div>
        ) : sq.wavering > 0 ? (
          <div className="card-flag card-flag--waver" title={t('{n}척이 동요하고 있습니다', { n: sq.wavering })}>
            <Icon name="waver" size={13} />
          </div>
        ) : null}
        {sq.drum?.beating && (
          <div className="card-flag card-flag--drum" title={t('북을 울리고 있습니다')}>
            <Icon name="drum" size={13} />
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
        {depth && sq.alive > 0 && (
          <div className={`card-bar card-bar--nerve${sq.morale < 0.35 ? ' card-bar--low' : ''}`}>
            <i style={{ width: `${sq.morale * 100}%` }} />
          </div>
        )}
      </div>
    </button>
  );
});

/** `wait` is a cooldown in seconds shown over the icon. */
type OrderDef = { icon: string; label: string; key: string; tip: string; run: () => void; on?: boolean; disabled?: boolean; wait?: number; form?: DragFormation };

/** Select-all and the route toggle: always within reach, including when a phone folds the command sheet. */
function SelectionBar({ engine }: { engine: Engine }) {
  const t = useT();
  // Groups, the selection and the route queue are the engine's, not the snapshot's.
  useEngineTick();
  const input = engine.input;
  input.syncBattle();
  const ownSelected = [...engine.views.selected].some((id) => engine.isOwn(engine.battle.get(id)));
  const queued = input.queuedWaypoints();
  return <div className="fleet-bar glass interactive">
    <button onClick={() => input.selectAll()} title="Ctrl+A">{t('전체 선택')}</button>
    <button className={input.queueMoves ? 'fleet-tool--on' : ''} disabled={!ownSelected} onClick={() => input.toggleQueueMode()} aria-pressed={input.queueMoves} title={t('켜면 바다를 누를 때 이동 경로를 예약합니다 · Shift+우클릭도 가능')}>
      {t('경로 예약')}{queued > 0 && <b>{queued}/16</b>}
    </button>
  </div>;
}

/**
 * The order tabs. The open tab is kept by the HUD, so folding the panel away and back does not lose it. `onToggle` folds
 * the grid on a phone and the whole panel on a wide screen.
 */
function Orders({ engine, p, night, selected, drum, tab, setTab, collapsed, onToggle }: { engine: Engine; p: PrimaryInfo | null; night: boolean; selected: number; drum: SquadronInfo['drum'] | undefined; tab: Tab; setTab: (tab: Tab) => void; collapsed: boolean; onToggle: () => void }) {
  const t = useT();
  // The maneuver being placed is the input's, not the snapshot's.
  useEngineTick();
  const input = engine.input;
  const none = selected === 0;
  // Squadron maneuvers under the maneuver rules: a button arms one, and the selection carries it out once drawn on the sea.
  const maneuvers = !!engine.battle.maneuvers && !engine.remote;
  const placing = input.placing?.kind;
  const posture = p ? input.postureOf(p.id) : undefined;
  const maneuver = (kind: ManeuverKind, icon: string, key: string): OrderDef => ({ icon, label: MANEUVER_NAMES[kind], key, tip: `maneuver.${kind}`, run: () => input.beginManeuver(kind), on: placing === kind, disabled: none });
  const tabs: Record<Tab, { title: string; items: OrderDef[] }> = {
    form: {
      title: '진형',
      items: [
        { icon: 'crane', label: '학익진', key: '1', tip: 'crane', run: () => input.pickFormation('crane'), on: input.formPlace?.kind === 'crane', form: 'crane' },
        { icon: 'line', label: '일자진', key: '2', tip: 'line', run: () => input.pickFormation('line'), on: input.formPlace?.kind === 'line', form: 'line' },
        { icon: 'column', label: '장사진', key: '3', tip: 'column', run: () => input.pickFormation('column'), on: input.formPlace?.kind === 'column', form: 'column' },
        { icon: 'wedge', label: '첨자진', key: '4', tip: 'wedge', run: () => input.pickFormation('wedge'), on: input.formPlace?.kind === 'wedge', form: 'wedge' },
        ...(engine.battle.coastalTactic ? [{ icon: 'crane' as const, label: engine.battle.coastalTactic === 'yeosu-wings' ? '여수 분산익진' : '목포 수로종심진', key: '', tip: engine.battle.coastalTactic, run: () => input.formation(engine.battle.coastalTactic!) }] : []),
        { icon: 'close', label: '공격', key: 'A', tip: 'posture.attack', run: () => input.posture('attack'), on: posture === 'attack' },
        { icon: 'standoff', label: '방어', key: '', tip: 'posture.defend', run: () => input.posture('defend'), on: posture === 'defend' },
        { icon: 'lure', label: '유인', key: '', tip: 'posture.lure', run: () => input.posture('lure'), on: posture === 'lure' },
        { icon: 'scatter', label: '자유교전', key: 'G', tip: 'auto', run: () => input.auto() },
      ],
    },
    gun: {
      title: '포격',
      items: [
        { icon: 'portVolley', label: '좌현 일제', key: 'Z', tip: 'volley.port', run: () => input.volley(0), disabled: none },
        { icon: 'starboardVolley', label: '우현 일제', key: 'X', tip: 'volley.starboard', run: () => input.volley(1), disabled: none },
        { icon: 'volleyBoth', label: '양현 일제', key: 'Shift+Z', tip: 'volley.both', run: () => input.volley(3), disabled: none },
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
        { icon: 'stop', label: '정지', key: 'S', tip: 'hold', run: () => input.hold(), disabled: none },
        // A toggle named for what the press does; it is lit while the ship runs dark.
        { icon: 'lantern', label: p && !p.lights ? '등불 켜기' : '등불 끄기', key: 'L', tip: 'lights', run: () => input.toggleLights(), on: !!p && !p.lights, disabled: !night },
        ...(maneuvers ? [maneuver('breach', 'breach', 'D'), maneuver('pincer', 'pincer', 'W'), maneuver('lure', 'lure', 'Shift+A'), maneuver('pursue', 'pursue', 'F')] : []),
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
        // Under the battle depth rules the selection's squadron leader beats the rally drum; it rests between beats.
        ...(drum !== undefined ? [{ icon: 'drum', label: '재집결', key: 'Shift+R', tip: 'drum', run: () => input.drum(), on: !!drum?.beating, disabled: none || !drum || drum.wait > 0, wait: drum && drum.wait > 0 ? drum.wait : undefined }] : []),
        ...(maneuvers
          ? [
              maneuver('ambush', 'ambush', 'Q'),
              maneuver('encircle', 'encircle', 'E'),
              ...(placing === 'encircle' ? [{ icon: 'scatter', label: input.placing?.open ? '한쪽 열림' : '한쪽 열기', key: 'Shift+O', tip: 'maneuver.open', run: () => input.toggleOpenSide(), on: !!input.placing?.open }] : []),
              maneuver('blockade', 'blockade', 'Shift+D'),
              { icon: 'advance', label: '진군 북', key: 'Shift+E', tip: 'signal.advance', run: () => input.signal('advance') },
              { icon: 'withdraw', label: '퇴각 징', key: 'Shift+S', tip: 'signal.withdraw', run: () => input.signal('withdraw'), disabled: none },
            ]
          : []),
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
            <button
              key={o.tip}
              className={`order ${o.on ? 'order--on' : ''}`}
              onClick={o.disabled ? undefined : o.run}
              onPointerEnter={o.form ? () => (input.formHover = o.form!) : undefined}
              onPointerLeave={o.form ? () => (input.formHover = null) : undefined} aria-disabled={o.disabled || undefined} aria-label={o.key ? `${t(o.label)} (${o.key})` : t(o.label)} data-tip={o.tip}>
              <span className="order-icon">
                <Icon name={o.icon} size={22} />
                {o.wait !== undefined && <span className="order-wait">{o.wait}</span>}
              </span>
              <span className="order-label">{t(o.label)}</span>
              {o.key && <kbd>{o.key}</kbd>}
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
      // The score panel's fold pull hangs below its edge: what sits under the panel stays clear of it too.
      const balance = box('.hud .balance');
      put('--bal-bottom', balance ? Math.max(balance.bottom, box('.hud .balance-fold')?.bottom ?? 0) : null);
      put('--tl-right', box('.hud .hud-menu')?.right ?? null);
      put('--tr-left', box('.hud .dock')?.left ?? null);
      put('--tl-bottom', box('.hud .hud-menu')?.bottom ?? null);
      const bottom = box('.hud .bottom')?.top ?? null;
      put('--bottom-top', bottom);
      // The commanders' card row: the in-battle subtitle sits just above it.
      put('--cards-top', box('.hud .cards-wrap')?.top ?? bottom);
      // Conquest sheets use the former toolbar edge as their lower limit; it now follows the bottom cards.
      put('--fleet-top', bottom);
    };
    measure();
    const timer = window.setInterval(measure, 200);
    window.addEventListener('resize', measure);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', measure);
      for (const n of ['--bal-bottom', '--tl-right', '--tr-left', '--tl-bottom', '--bottom-top', '--fleet-top', '--cards-top']) root.removeProperty(n);
    };
  }, []);
}

/** Where the back button leads, named for the screen the battle was started from. */
const BACK_LABEL: Record<BattleOrigin, { long: string; short: string }> = {
  select: { long: '전투 선택', short: '전투 선택' },
  skirmish: { long: '쟁탈전', short: '쟁탈전' },
  online: { long: '대전 대기실', short: '대기실' },
  faction: { long: '캠페인 지도', short: '캠페인' },
};

/**
 * Pause and speed. The full layout shows every multiplier; the simplified one steps down and up beside the speed it is
 * at; a phone shows one button that cycles through them.
 */
type SpeedState = Pick<GameSnapshot, 'speed' | 'actualSpeed' | 'paused' | 'approach' | 'autoFast' | 'fastForward'>;

const SpeedControl = memo(function SpeedControl({ engine, variant, ...snap }: SpeedState & { engine: Engine; variant: 'all' | 'step' | 'cycle' }) {
  const t = useT();
  // A speed the player picks is the speed the battle runs at: it also ends the fast approach, which otherwise kept
  // running at its own 128x while the button the player had just pressed lit up.
  const setSpeed = (s: number) => {
    engine.speed = s;
    engine.paused = false;
    engine.autoFast = false;
    engine.fastForward = false;
    engine.publish(true);
  };
  const at = SPEEDS.findIndex((s) => s === snap.speed);
  // What the readout says: the real pace while the approach is skipped or a slow device cannot keep up, else the pick.
  const real = Math.round(snap.actualSpeed);
  const lagging = !snap.paused && (snap.fastForward || (snap.speed >= 8 && real < snap.speed * 0.75));
  const shown = lagging ? `${real}×` : `${snap.speed}×`;
  const next = SPEEDS[(at + 1) % SPEEDS.length]!;
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
      {variant === 'cycle' ? (
        <button aria-label={t('배속 바꾸기')} data-tip="speed" onClick={() => setSpeed(next)}>
          {shown}
        </button>
      ) : variant === 'step' ? (
        <>
          <button className="speed-step" aria-label={t('느리게')} data-tip="speed" disabled={at <= 0} onClick={() => setSpeed(SPEEDS[at - 1]!)}>
            <Icon name="chevronLeft" size={14} />
          </button>
          <span className={`speed-now ${snap.paused ? '' : 'on'}`} data-tip="speed">
            {shown}
          </span>
          <button className="speed-step" aria-label={t('빠르게')} data-tip="speed" disabled={at >= SPEEDS.length - 1} onClick={() => setSpeed(SPEEDS[at + 1]!)}>
            <Icon name="chevronRight" size={14} />
          </button>
        </>
      ) : (
        SPEEDS.map((s) => (
          <button key={s} className={!snap.paused && !snap.fastForward && snap.speed === s ? 'on' : ''} data-tip="speed" onClick={() => setSpeed(s)}>
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
          {snap.fastForward ? <span>{t('접근 중 · {n}×', { n: Math.round(snap.actualSpeed) })}</span> : null}
          <Icon name="skip" size={16} />
        </button>
      )}
    </>
  );
});

const GUN_SIDES: [number, string][] = [
  [0, '좌현'],
  [2, '함수'],
  [1, '우현'],
];

/**
 * The ship's guns as lights, one per gun, grouped by side: green when it can fire, filling amber while it loads, an empty
 * ring when it is out of shot. Each light names its gun and stage on hover.
 */
const GunLights = memo(function GunLights({ guns }: { guns: GunInfo[] }) {
  const t = useT();
  // The loading fill comes from the live slice, in the order of `guns`.
  const progress = useUi((s) => s.live.guns);
  return (
    <div className="gun-lights">
      {GUN_SIDES.map(([side, label]) => {
        const list = guns.map((g, i) => ({ g, p: progress[i] ?? g.progress })).filter(({ g }) => g.side === side);
        if (!list.length) return null;
        return (
          <div key={side} className="gun-side">
            <span>{t(label)}</span>
            <div className="gun-dots">
              {list.map(({ g, p }, i) => (
                <i
                  key={i}
                  className={`gun-dot ${g.empty ? 'gun-dot--empty' : g.stage >= 4 ? 'gun-dot--ready' : ''}`}
                  style={{ '--p': Math.min(1, (g.stage + p) / 4) } as CSSProperties}
                  title={`${t(g.label)} · ${g.stageName}`}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
});

// `cutaway` is only compared: the crew panel inside reads the engine's deck view, which a forced publish announces.
const Detail = memo(function Detail({ engine, night, depth, p, portrait }: { engine: Engine; night: boolean; depth: boolean; p: PrimaryInfo; portrait: string; cutaway: number }) {
  const t = useT();
  const lang = useLang();
  return (
    <div className="detail glass interactive">
        <div className="detail-head">
          <img className="detail-portrait" src={portraitUrl(portrait)} alt="" />
          <div className="detail-title">
            <div className="detail-name">{tName(p.name)}</div>
            <div className="detail-sub">
              {t(p.kind)} · {t(ACTIVITY[p.activity] ?? p.activity)}
              {p.fireMode === 'hold' ? ' · ' + t('사격 중지') : ''}
              {!p.lights && night ? ' · ' + t('등불 꺼짐') : ''}
            </div>
          </div>
          {/* A new tab: the codex is its own page, and leaving this one would end the battle. */}
          <button className="detail-codex" title={t('도감에서 자세히 보기')} aria-label={t('도감에서 자세히 보기')} onClick={() => window.open(`${routePath('codex', lang)}#${p.shipKind}`, '_blank', 'noopener')}>
            <CodexIcon name="look" size={18} />
          </button>
        </div>
        <div className="detail-body">
          <Stat label={t('선체')} value={p.hull} tone="hull" text={`${Math.round(p.hull * 100)}%`} />
          <Stat label={t('승조원')} value={p.crew / p.maxCrew} tone="crew" text={`${p.crew}`} />
          {depth && <Stat label={t('사기')} value={p.morale} tone="morale" text={NERVE_WORD[p.moraleState] ? t(NERVE_WORD[p.moraleState]!) : `${Math.round(p.morale * 100)}%`} />}
          {p.fire > 0.02 && <Stat label={t('화재')} value={p.fire} tone="fire" text={`${Math.round(p.fire * 100)}%`} />}
          {p.damageState && Object.entries(p.damageState).map(([kind, damage]) => damage > 0.015 && <Stat key={kind} label={t(kind === 'flooding' ? '침수' : kind === 'propulsion' ? '추진 손상' : '조타 손상')} value={damage} tone="fire" text={`${Math.round(damage * 100)}%`} />)}
          {p.guns.length > 0 && <GunLights guns={p.guns} />}
          <CrewPanel engine={engine} p={p} />
        </div>
    </div>
  );
});

const HINT_KEY = 'imjin.hud.hint';

function readHint(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) !== 'off';
  } catch {
    return true;
  }
}

/**
 * How much of the HUD stands over the sea. Simplified is the default, so the battle shows between slim side panels; full
 * is the HUD with every label; folded leaves only edge tabs, each of which brings its panel back.
 */
type Layout = 'full' | 'simple' | 'fold';
const LAYOUTS: Layout[] = ['full', 'simple', 'fold'];
const LAYOUT_LABEL: Record<Layout, string> = { full: '전체', simple: '간소화', fold: '접기' };
const LAYOUT_ICON: Record<Layout, string> = { full: 'hudFull', simple: 'hudSimple', fold: 'hudFold' };
const LAYOUT_KEY = 'imjin.hud.layout';

/**
 * The parts a player folds on their own: the score panel, the title with its menu, the group panel, the minimap with the
 * ship panel, the commander cards, the orders.
 */
type Part = 'score' | 'title' | 'groups' | 'map' | 'cards' | 'orders';
type Folds = Record<Part, boolean>;

/** The two top parts keep their fold from battle to battle, as the layout does; the others start from the layout each time. */
const TOP_KEYS = { score: 'imjin.hud.score', title: 'imjin.hud.title' } as const;
type TopPart = keyof typeof TOP_KEYS;

function readTopFold(part: TopPart, layout: Layout): boolean {
  try {
    const stored = localStorage.getItem(TOP_KEYS[part]);
    if (stored === 'fold' || stored === 'open') return stored === 'fold';
  } catch {
    // Without storage the layout decides, as on a first visit.
  }
  return layout === 'fold';
}

function saveTopFold(part: TopPart, fold: boolean) {
  try {
    localStorage.setItem(TOP_KEYS[part], fold ? 'fold' : 'open');
  } catch {
    // The fold then lasts for this battle only.
  }
}

function readLayout(): Layout {
  try {
    const stored = localStorage.getItem(LAYOUT_KEY);
    return LAYOUTS.find((l) => l === stored) ?? 'simple';
  } catch {
    return 'simple';
  }
}

const foldsOf = (layout: Layout): Folds => {
  const all = layout === 'fold';
  return { score: all, title: all, groups: all, map: all, cards: all, orders: all };
};

/** A folded part's tab along the bottom edge, where the part stood. */
function FoldTab({ label, title, onOpen, children }: { label: string; title: string; onOpen: () => void; children?: React.ReactNode }) {
  return (
    <button className="fold-tab" onClick={onOpen} aria-expanded={false} aria-label={title} title={title}>
      <Icon name="chevronUp" size={14} />
      {label}
      {children}
    </button>
  );
}

/** The small button on an open part that folds it to its tab, its chevron pointing to the edge the part folds into. */
function FoldButton({ title, className, onFold, edge = 'bottom' }: { title: string; className: string; onFold: () => void; edge?: 'top' | 'bottom' }) {
  return (
    <button className={`fold-btn ${className}`} onClick={onFold} aria-expanded={true} aria-label={title} title={title}>
      <Icon name={edge === 'top' ? 'chevronUp' : 'chevronDown'} size={14} />
    </button>
  );
}

/**
 * All that stands over the battle while the HUD is hidden to watch it: one faint button in the corner that brings the HUD
 * back, and the first time a short reminder beside it that fades.
 */
function HudReveal({ hint, onShow }: { hint: boolean; onShow: () => void }) {
  const t = useT();
  const label = t(isTouchOnly ? 'UI 다시 표시' : 'UI 다시 표시 · Shift+H');
  return (
    <div className="hud-reveal">
      {hint && (
        <div className="hud-reveal-hint glass" role="status">
          {t(isTouchOnly ? '버튼을 누르면 다시 표시합니다' : 'Shift+H 키 또는 버튼으로 다시 표시')}
        </div>
      )}
      <button className="hud-reveal-btn" onClick={onShow} aria-label={label} title={label}>
        <Icon name="eye" size={18} />
      </button>
    </div>
  );
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
          {t('적을 클릭하면 공격, 바다를 우클릭하면 이동, Z·X는 일제 사격입니다.')}
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
  // The clock as the result card shows it: followed only once the battle is decided.
  const endTime = useUi((s) => (s.snapshot && (s.snapshot.winner || s.snapshot.draw) ? s.live.time : 0));
  const rankedMatch = useNet((s) => s.rankedMatch);
  const tourActive = useTour((s) => s.active);
  const compact = useCompactLayout();
  const [showSettings, setShowSettings] = useState(false);
  // The minimap is always on in the wide layout. On phones it opens as a floating panel from the menu.
  const [mapOn, setMapOn] = useState(false);
  const [ordersCollapsed, setOrdersCollapsed] = useState(false);
  const [ordersTab, setOrdersTab] = useState<Tab>('form');
  // The chosen layout and the parts folded under it. Choosing a layout resets every fold to it; a tab or a fold button
  // changes one part and the layout stays as chosen.
  const [view, setView] = useState(() => {
    const layout = readLayout();
    // A phone starts with its group panel shut, as it always has.
    return { layout, folds: { ...foldsOf(layout), groups: compact || layout === 'fold', score: readTopFold('score', layout), title: readTopFold('title', layout) } };
  });
  // Hidden to watch the fight. It is not stored: every battle starts with the HUD in view.
  const [hidden, setHidden] = useState(false);
  const [revealHint, setRevealHint] = useState(false);
  const revealHinted = useRef(false);
  // Portrait phones fold the detail and orders away to leave the sea in view. Short phones start folded, and so does
  // every phone under the folded layout.
  const [sheetFolded, setSheetFolded] = useState(() => innerHeight < 760 || view.layout === 'fold');
  const [hintOpen, setHintOpen] = useState(readHint);
  const [perf, setPerf] = useState(readPerf);
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const wasTour = useRef(false);
  useHudInsets();
  const wide = !compact;
  // The tour points at the cards, the orders and the speed control: every part stays open while it runs.
  const folded = (part: Part) => wide && !tourActive && view.folds[part];
  const slim = wide && view.layout !== 'full';
  const mapFolded = folded('map');
  // The score panel and the title fold on a phone too, where they cover the most sea. The title stays open while the
  // settings sheet it opened is up, so the button that closes the sheet stays where it was.
  const scoreFolded = !tourActive && view.folds.score;
  const titleFolded = !tourActive && view.folds.title && !showSettings;
  const ended = !!snap && (!!snap.winner || snap.draw);
  // A decided battle shows its result card, and the tour points at the panels: neither waits behind a hidden HUD.
  const hiddenNow = hidden && !ended && !tourActive;
  const setFold = (part: Part, fold: boolean) => {
    setView((v) => ({ ...v, folds: { ...v.folds, [part]: fold } }));
    if (part === 'score' || part === 'title') saveTopFold(part, fold);
  };
  const hideHud = () => {
    setHidden(true);
    setShowSettings(false);
    if (!revealHinted.current) {
      revealHinted.current = true;
      setRevealHint(true);
    }
  };
  const showHud = () => {
    setHidden(false);
    setRevealHint(false);
  };
  const changeLayout = (layout: Layout) => {
    setView((v) => ({ layout, folds: { ...foldsOf(layout), groups: compact ? v.folds.groups : layout === 'fold' } }));
    saveTopFold('score', layout === 'fold');
    saveTopFold('title', layout === 'fold');
    // A phone has one fold of its own, the command sheet: the folded layout folds it and the others open it.
    if (compact) setSheetFolded(layout === 'fold');
    try {
      localStorage.setItem(LAYOUT_KEY, layout);
    } catch {
      // The choice then lasts for this battle only.
    }
  };
  const cycleLayout = () => {
    const next = LAYOUTS[(LAYOUTS.indexOf(view.layout) + 1) % LAYOUTS.length]!;
    changeLayout(next);
    return next;
  };
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

  // A folded or hidden minimap is unmounted, and the engine stops drawing it.
  useEffect(() => {
    engine.minimap.mount(minimapRef.current);
  }, [engine, snap?.scenario.id, compact, mapOn, mapFolded, hiddenNow]);

  // The name tags over the water hide with the HUD; the engine then skips them each frame.
  useEffect(() => {
    engine.hudHidden = hiddenNow;
    return () => {
      engine.hudHidden = false;
    };
  }, [engine, hiddenNow]);

  // A battle that ends while hidden, a restart or a new battle, and the tour bring the HUD back for good.
  useEffect(() => {
    if (ended || tourActive) showHud();
  }, [ended, tourActive]);
  useEffect(showHud, [engine.battle]);

  // The reminder of how to bring the HUD back is read once and fades.
  useEffect(() => {
    if (!revealHint) return;
    const timer = window.setTimeout(() => setRevealHint(false), 4000);
    return () => window.clearTimeout(timer);
  }, [revealHint]);

  // Shift+H hides the HUD and brings it back (H alone stops the ships). Esc also brings it back; it is caught before the
  // input sees it, so the selection survives.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
      if (e.code === 'KeyH' && e.shiftKey) {
        e.preventDefault();
        if (hiddenNow) showHud();
        else if (!ended && !tourActive) hideHud();
      } else if (e.code === 'Escape' && hiddenNow) {
        e.stopPropagation();
        showHud();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [hiddenNow, ended, tourActive]);

  // ` (left of 1) cycles the layout: every letter is already an order or a camera key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.code !== 'Backquote' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
      e.preventDefault();
      pushToast(tr('지휘 패널 · {layout}', { layout: tr(LAYOUT_LABEL[cycleLayout()]) }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view.layout, compact]);

  // The tour says what the bottom-left hint says, so the hint is retired once the tour has been read.
  useEffect(() => {
    if (wasTour.current && !tourActive) closeHint();
    wasTour.current = tourActive;
  }, [tourActive]);

  const selectSquadron = useCallback((id: number, add: boolean) => engine.selectSquadron(id, add), [engine]);
  const focusSquadron = useCallback((id: number) => engine.focusSquadron(id), [engine]);
  if (!snap) return null;
  const speedState: SpeedState = { speed: snap.speed, actualSpeed: Math.round(snap.actualSpeed), paused: snap.paused, approach: snap.approach, autoFast: snap.autoFast, fastForward: snap.fastForward };
  const own = snap.squadrons.filter((s) => s.faction === snap.faction);
  const p = snap.primary;
  const primaryShip = p ? engine.battle.get(p.id) : undefined;
  const primaryFaction = primaryShip?.spec.faction ?? snap.faction;
  const primarySquadron = snap.squadrons.find((s) => s.id === primaryShip?.squadronId);
  const primaryPortrait = primarySquadron?.portrait
    ?? FALLBACK_PORTRAIT[primaryFaction];
  const enemyTeam: Team = snap.team === 'joseon' ? 'japan' : 'joseon';
  const enemyFaction = snap.squadrons.find((s) => s.team === enemyTeam)?.faction ?? enemyTeam;
  const won = snap.winner === snap.team;
  // A phone's score panel has room for the navy's name only.
  const sideName = (team: Team) => {
    const name = teamName(snap, team);
    return compact ? name.replace(/ (수군|연합|Navy|Allies)$/, '') : name;
  };
  const stats: { label: string; value: string }[] = snap.conquest
    ? [
        { label: '기세', value: `${snap.conquest.tickets.own} : ${snap.conquest.tickets.foe}` },
        { label: '거점', value: `${snap.conquest.held.own} : ${snap.conquest.held.foe}` },
        { label: '소요 시간', value: formatTime(endTime) },
      ]
    : [
        { label: '격파', value: tShips(snap.enemyTotal - snap.enemy - snap.escaped) },
        { label: '도주', value: tShips(snap.escaped) },
        { label: '손실', value: tShips(snap.ownTotal - snap.own) },
        { label: '소요 시간', value: formatTime(endTime) },
      ];
  // The score and the comparison with history belong to a historical battle the player fought for the side it was written for (Joseon, England), not to online or conquest games.
  const scored = ended && snap.mode === 'scenario' && snap.scenario.id in GUIDES && guidedFaction(snap.faction) && !engine.remote;
  const hideLabel = t(isTouchOnly ? '촬영 모드 · 표시를 모두 숨깁니다' : '촬영 모드 · 표시를 모두 숨깁니다 · Shift+H');
  const selectBox = box && <div className="select-box" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />;
  // The tour stays as it is: the HUD cannot be hidden while it points at the panels.
  const hideButton = !ended && !tourActive && (
    <button className={`mini-btn hud-hide-btn${titleFolded ? ' mini-btn--icon' : ''}`} onClick={hideHud} aria-label={hideLabel} title={hideLabel}>
      <Icon name="eyeOff" size={16} />
      {!titleFolded && <span>{t('촬영 모드')}</span>}
    </button>
  );
  return (
    <div className={`hud${slim ? ' hud--slim' : ''}${titleFolded ? ' hud--title-folded' : ''}`} style={{ '--own-fc': `var(--${snap.faction})`, '--enemy-fc': `var(--${enemyFaction})` } as React.CSSProperties}>
      {hiddenNow ? (
        <>
          {selectBox}
          <HudReveal hint={revealHint} onShow={showHud} />
        </>
      ) : (
        <>
          {titleFolded ? (
            <div className="hud-title hud-title--folded">
              <div className="hud-menu">
                <button className="mini-btn mini-btn--icon" onClick={() => setFold('title', false)} aria-expanded={false} aria-label={t('메뉴 펼치기')} title={t('메뉴 펼치기')}>
                  <Icon name="menu" size={16} />
                </button>
                {hideButton}
              </div>
            </div>
          ) : (
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
                {/* A phone folds its command sheet from the dock instead. */}
                {wide && (
                  <button className="mini-btn hud-layout-btn" onClick={cycleLayout} aria-label={t('지휘 패널 · {layout} · ` 키로 바꿉니다', { layout: t(LAYOUT_LABEL[view.layout]) })} title={t('지휘 패널 · {layout} · ` 키로 바꿉니다', { layout: t(LAYOUT_LABEL[view.layout]) })}>
                    <Icon name={LAYOUT_ICON[view.layout]} size={16} />
                    <span>{t(LAYOUT_LABEL[view.layout])}</span>
                  </button>
                )}
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
                {hideButton}
                <FoldButton className="title-fold" edge="top" title={t('메뉴 접기')} onFold={() => setFold('title', true)} />
              </div>
            </div>
          )}

          {scoreFolded ? (
            <button className="balance balance--pill glass" onClick={() => setFold('score', false)} aria-expanded={false} aria-label={t('전황 펼치기')} title={t('전황 펼치기')}>
              <i className="bal-mark bal-mark--own" />
              <b>{snap.own}</b>
              <span className="bal-pill-time"><Clock /></span>
              <b>{snap.enemy}</b>
              <i className="bal-mark bal-mark--foe" />
              <Icon name="chevronDown" size={14} />
            </button>
          ) : (
            <div className={`balance glass${snap.conquest ? ' balance--cq' : ''}${snap.morale ? ' balance--nerve' : ''}`}>
              <div className="bal-row">
                <span className="bal-side bal-side--own">
                  <i className="bal-mark" />
                  <span className="bal-name">{sideName(snap.team)}</span>
                  <b>{snap.own}</b>
                  <small>/{snap.ownTotal}</small>
                </span>
                <span className="bal-time">
                  <Clock />
                  {perf && (
                    <span className="fps">
                      <Fps />fps · {t(LEVEL_LABEL[snap.level] ?? '')}
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
              {snap.morale && <NerveRow m={snap.morale} />}
              {snap.conquest && <ConquestBar c={snap.conquest} />}
              {snap.tide && (
                <div className={`tide tide--${snap.tide.dir < 0 ? 'flood' : snap.tide.dir > 0 ? 'ebb' : 'slack'}`}>
                  <span className="tide-arrow">{snap.tide.dir < 0 ? <Icon name="chevronLeft" size={12} /> : snap.tide.dir > 0 ? <Icon name="chevronRight" size={12} /> : '·'}</span>
                  {t('물살 {knots}노트 · {label}', { knots: snap.tide.knots, label: snap.tide.label })}
                </div>
              )}
              <FoldButton className="balance-fold" edge="top" title={t('전황 접기')} onFold={() => setFold('score', true)} />
            </div>
          )}

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
                  <MusicVolume />
                </section>
                <section className="settings-sec">
                  <div className="settings-label">{t('화면 표시')}</div>
                  <div className="chips" role="group" aria-label={t('지휘 패널')}>
                    {LAYOUTS.map((k) => (
                      <button key={k} className={`chip ${view.layout === k ? 'chip--on' : ''}`} aria-pressed={view.layout === k} onClick={() => changeLayout(k)}>
                        {t(LAYOUT_LABEL[k])}
                      </button>
                    ))}
                  </div>
                  <div className="settings-hint">
                    {t(compact ? '좁은 화면에서는 접기를 고르면 아래 지휘 시트를 접습니다.' : isTouchOnly ? '전투 장면을 가리는 지휘 패널을 줄이거나 접습니다.' : '전투 장면을 가리는 지휘 패널을 줄이거나 접습니다. ` 키로도 바꿉니다.')}
                  </div>
                  <div className="chips settings-row">
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

          {selectBox}

          {compact && mapOn && <div className="minimap minimap--float" ref={minimapRef} />}

          {!ended && (
            <div className="selection-dock touch-bar">
              <SelectionBar engine={engine} />
              {isTouchDevice && <div className="selection-tools">
              <button className={`tool ${touchBox ? 'tool--on' : ''}`} onClick={() => setTouchBox(!touchBox)} aria-label={t('박스')} data-tip="tool.box">
                <Icon name="box" size={19} />
                <span>{t('박스')}</span>
              </button>
              <button className="tool" onClick={() => engine.input.clearSelection()} aria-disabled={snap.selectedCount === 0 || undefined} aria-label={t('해제')} data-tip="tool.clear">
                <Icon name="clear" size={19} />
                <span>{t('해제')}</span>
              </button>
              <button className={`tool ${snap.following ? 'tool--on' : ''}`} onClick={() => snap.selectedCount > 0 && engine.input.followSelected()} aria-disabled={snap.selectedCount === 0 || undefined} aria-label={t('추적')} data-tip="tool.follow">
                <Icon name="follow" size={19} />
                <span>{t('추적')}</span>
              </button>
              {/* The crew panel with the cutaway chip is hidden on phones, so the deck view needs its own button. */}
              <button className={`tool ${engine.cutaway ? 'tool--on' : ''}`} onClick={() => (snap.selectedCount > 0 || engine.cutaway) && engine.toggleCutaway()} aria-disabled={(snap.selectedCount === 0 && !engine.cutaway) || undefined} aria-label={t(engine.cutaway ? DECK_LABEL[engine.cutaway]! : '선내')} data-tip="tool.deck">
                <Icon name="deck" size={19} />
                <span>{t(engine.cutaway ? DECK_LABEL[engine.cutaway]! : '선내')}</span>
              </button>
              </div>}
            </div>
          )}

          <div className={`bottom ${sheetFolded ? 'bottom--folded' : ''}`}>
            {wide && (mapFolded ? (
              <FoldTab label={t('지도')} title={t('지도와 함선 정보 펼치기')} onOpen={() => setFold('map', false)} />
            ) : (
              <div className="map-wrap">
                <div className="minimap" ref={minimapRef} />
                <FoldButton className="map-fold" title={t('지도와 함선 정보 접기')} onFold={() => setFold('map', true)} />
              </div>
            ))}
            {/* Once the battle is decided the result card is the only thing to act on: no orders or cards behind it. */}
            {!ended && (
              <>
                {!mapFolded && (p ? <Detail engine={engine} cutaway={engine.cutaway} night={snap.night} depth={!!snap.morale} p={p} portrait={primaryPortrait} /> : hintOpen && !tourActive && !slim && <Hint onClose={closeHint} />)}
                {!tourActive && <AdviceButton engine={engine} />}
                <div className="cards-wrap">
                  {folded('cards') ? (
                    <FoldTab label={t('장수 패 {n}', { n: own.length })} title={t('장수 패 펼치기')} onOpen={() => setFold('cards', false)} />
                  ) : (
                    <>
                      <div className="cards">
                        {own.map((sq) => (
                          <Card key={sq.id} sq={sq} compact={compact} depth={!!snap.morale} onSelect={selectSquadron} onFocus={focusSquadron} />
                        ))}
                      </div>
                      {wide && <FoldButton className="cards-fold" title={t('장수 패 접기')} onFold={() => setFold('cards', true)} />}
                    </>
                  )}
                </div>
                {folded('orders') ? (
                  <FoldTab label={t('명령')} title={t('명령 펼치기')} onOpen={() => setFold('orders', false)}>
                    {/* The speed control folds away with the orders: the tab keeps saying how fast the battle runs. */}
                    {!engine.remote && <b className="fold-tab-speed">{snap.paused ? <Icon name="pause" size={12} /> : `${snap.speed}×`}</b>}
                  </FoldTab>
                ) : (
                  // A landscape phone's settings sheet reaches down over the orders.
                  <div className={`orders glass interactive ${compact && ordersCollapsed ? 'orders--collapsed' : ''}`} style={showSettings && compact ? { visibility: 'hidden' } : undefined}>
                    <Orders
                      engine={engine}
                      p={p}
                      night={snap.night}
                      selected={snap.selectedCount}
                      drum={snap.morale ? primarySquadron?.drum ?? null : undefined}
                      tab={ordersTab}
                      setTab={setOrdersTab}
                      collapsed={compact && ordersCollapsed}
                      onToggle={compact ? () => setOrdersCollapsed((v) => !v) : () => setFold('orders', true)}
                    />
                    {wide && !engine.remote && (
                      <div className={`speed${slim ? ' speed--step' : ''}`}>
                        <SpeedControl engine={engine} {...speedState} variant={slim ? 'step' : 'all'} />
                      </div>
                    )}
                  </div>
                )}
                {compact && (
                  <div className="dock interactive">
                    <button className="dock-fold" aria-expanded={!sheetFolded} onClick={() => setSheetFolded((v) => !v)}>
                      {t('지휘')} <Icon name={sheetFolded ? 'chevronUp' : 'chevronDown'} size={14} />
                    </button>
                    {!engine.remote && <SpeedControl engine={engine} {...speedState} variant="cycle" />}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {!ended && <Tutorial engine={engine} compact={compact} />}
      {!ended && <BattleGuide engine={engine} />}
      {!hiddenNow && <Tooltips />}

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
          {scored && <BattleResult snap={snap} time={formatTime(endTime)} />}
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
