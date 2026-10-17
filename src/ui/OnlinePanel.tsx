import { useEffect, useRef, useState } from 'react';
import { net, useNet } from '../net/NetClient';
import type { BattleChoice, RoomInfo, RoomSummary } from '../net/protocol';
import { CONQUEST_MAPS, CONQUEST_ORDER, type ConquestMapId } from '../sim/maps';
import { SCENARIOS, SCENARIO_ORDER, isArmadaBattle, type ScenarioId } from '../sim/scenarios';
import { FACTION_NAME, FACTION_SHORT } from '../sim/balance';
import { FACTIONS, type Faction } from '../sim/types';
import { COMPETITIVE_TRAITS } from '../sim/competitive';
import { sound } from '../audio/Sound';
import { t, useT } from '../i18n';
import { Cross } from './icons';
import { mountOnlineOverlay } from './OnlineOverlay';
import { RankActions, RankResult, RANK_TIER } from './RankResult';
import './online.css';

mountOnlineOverlay();

const click = () => sound.click();

// Plain functions: the components that call them use useT(), so they re-render when the language changes.
export const battleTitle = (c: BattleChoice) => t(c.kind === 'scenario' ? SCENARIOS[c.id].title : CONQUEST_MAPS[c.map].title);
export const battleKind = (c: BattleChoice) => (c.kind === 'scenario' ? t('역사 전투 1:1') : t(c.size === 4 ? '쟁탈전 2:2' : '쟁탈전 1:1'));
/** The year of a scenario's date ('1592년 5월 7일'), the same digits in both languages. */
const yearOf = (date: string) => date.match(/^\d+/)?.[0] ?? date;

/** Picks what is fought: a conquest map (with the seat count, when it applies) or one of the historical battles. */
function BattlePicker({ value, onChange, sizes }: { value: BattleChoice; onChange: (c: BattleChoice) => void; sizes: boolean }) {
  const t = useT();
  const pickConquest = (map: ConquestMapId) => onChange({ kind: 'conquest', map, size: value.kind === 'conquest' && CONQUEST_MAPS[map].seats >= value.size ? value.size : 2 });
  return (
    <div className="on-picker">
      <div className="on-seg" role="tablist">
        <button className={`on-seg-btn ${value.kind === 'conquest' ? 'on-seg-btn--on' : ''}`} onClick={() => value.kind !== 'conquest' && pickConquest('hallyeo')}>
          {t('쟁탈전')}
        </button>
        <button className={`on-seg-btn ${value.kind === 'scenario' ? 'on-seg-btn--on' : ''}`} onClick={() => value.kind !== 'scenario' && onChange({ kind: 'scenario', id: 'hansan' })}>
          {t('역사 전투')}
        </button>
      </div>
      {value.kind === 'conquest' ? (
        <div className="on-chips">
          {CONQUEST_ORDER.map((id) => (
            <button key={id} className={`chip ${value.map === id ? 'chip--on' : ''}`} onClick={() => pickConquest(id)}>
              {t(CONQUEST_MAPS[id].title)}
            </button>
          ))}
          {sizes && (
            <>
              <button className={`chip ${value.size === 2 ? 'chip--on' : ''}`} onClick={() => onChange({ ...value, size: 2 })}>
                {t('1:1')}
              </button>
              <button className={`chip ${value.size === 4 ? 'chip--on' : ''}`} disabled={CONQUEST_MAPS[value.map].seats < 4} onClick={() => onChange({ ...value, size: 4 })}>
                {t('2:2')}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="on-chips">
          <select className="on-select" value={value.id} onChange={(e) => onChange({ kind: 'scenario', id: e.target.value as ScenarioId })}>
            {SCENARIO_ORDER.map((id) => (
              <option key={id} value={id}>
                {t(SCENARIOS[id].title)} · {yearOf(SCENARIOS[id].date)}
              </option>
            ))}
          </select>
          <span className="on-hint">{t(SCENARIOS[value.id].place)}</span>
        </div>
      )}
    </div>
  );
}

function NavyPicker({ value, onChange, ming }: { value: Faction; onChange: (f: Faction) => void; ming: boolean }) {
  const t = useT();
  return (
    <div className="on-navies">
      {FACTIONS.filter((f) => ming || f !== 'ming').map((f) => (
        <button key={f} data-faction={f} aria-pressed={value === f} className={`on-navy ${value === f ? 'on-navy--on' : ''}`} onClick={() => onChange(f)}>
          <i className={`emblem emblem--${f}`} />
          <span>{t(FACTION_NAME[f])}</span>
        </button>
      ))}
    </div>
  );
}

function Connect() {
  const t = useT();
  const status = useNet((s) => s.status);
  const name = useNet((s) => s.name);
  const error = useNet((s) => s.error);
  const retry = useNet((s) => s.retry);
  const identityRejected = useNet((s) => s.identityRejected);
  const [nick, setNick] = useState(name);
  const busy = status === 'connecting';
  const go = () => {
    click();
    net.connect(nick);
  };
  return (
    <div className="cs net paper on">
      <div className="on-title">{t('접속')}</div>
      <p className="on-lead">{t('다른 플레이어와 랭크전·쟁탈전·역사 속 해전을 겨룹니다.')}</p>
      <div className="on-row">
        <span className="on-label">{t('닉네임')}</span>
        <input className="on-input" value={nick} maxLength={16} placeholder={t('닉네임을 입력하세요')} onChange={(e) => setNick(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
        <button className="ink-btn on-go on-connect" disabled={busy || status === 'reconnecting'} onClick={go}>
          {busy ? t('접속 중') : t('접속')}
        </button>
      </div>
      {status === 'reconnecting' && (
        <div className="on-alert">
          {retry ? t('연결이 끊어졌습니다. {sec}초 뒤 다시 시도합니다 ({n}번째)', { sec: retry.in, n: retry.attempt }) : t('연결이 끊어졌습니다. 다시 연결하는 중입니다.')}
          <button className="chip" onClick={() => net.retryNow()}>
            {t('지금 다시 시도')}
          </button>
        </div>
      )}
      {error && status !== 'reconnecting' && (
        <div className="on-alert">
          {t(error)}
          {status === 'error' && (
            <button className="chip" onClick={go}>
              {t('다시 시도')}
            </button>
          )}
        </div>
      )}
      {identityRejected && <>
        <span className="on-hint">{t('기존 점수를 이어가려면 복구코드를 복원하세요.')}</span>
        <Recovery busy={busy} rejected />
        <button className="chip on-new-account" disabled={busy} onClick={() => net.newAccount()}>{t('새 계정으로 시작')}</button>
      </>}
    </div>
  );
}

function RoomRow({ r }: { r: RoomSummary }) {
  const t = useT();
  return (
    <div className="on-room">
      <b>{r.name}</b>
      <span>
        {battleTitle(r.battle)} · {battleKind(r.battle)} · {t('{n}명', { n: r.humans })} · {r.state === 'lobby' ? t('빈 자리 {n}', { n: r.open }) : t('진행 중')}
      </span>
      <code>{r.id}</code>
      <button
        className="chip"
        disabled={r.state !== 'lobby' || r.open === 0}
        onClick={() => {
          click();
          net.send({ t: 'join', room: r.id });
        }}
      >
        {t('입장')}
      </button>
    </div>
  );
}

function Recovery({ busy, rejected = false }: { busy: boolean; rejected?: boolean }) {
  const t = useT();
  const [revealed, setRevealed] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  return (
    <details className="on-recovery" open={rejected || undefined} onToggle={(e) => { if (!e.currentTarget.open) setRevealed(''); }}>
      <summary>{t('전적 복구')}</summary>
      <div className="on-recovery-body">
        {!rejected && <span className="on-hint">{t('전적은 이 브라우저에 저장된 계정에 연결됩니다. 복구코드로 다른 기기에서도 이어갈 수 있습니다.')}</span>}
        {!rejected && <div className="on-row">
          <button className="chip on-recovery-export" disabled={busy} onClick={() => setRevealed(net.exportAccount())}>{t(revealed ? '복구코드 다시 보기' : '복구코드 보기')}</button>
          {revealed && <button className="chip" onClick={() => setRevealed('')}>{t('숨기기')}</button>}
        </div>}
        {revealed && <>
          <span className="on-hint">{t('복구코드를 가진 사람은 이 전적을 사용할 수 있습니다. 안전하게 보관하세요.')}</span>
          <textarea className="on-input on-recovery-code" readOnly value={revealed} aria-label={t('복구코드')} onFocus={(e) => e.currentTarget.select()} />
        </>}
        <div className="on-row">
          <input className="on-input on-recovery-input" type="password" autoComplete="off" value={code} placeholder={t('복구코드')} aria-label={t('복구코드')} onChange={(e) => { setCode(e.target.value); setError(false); }} />
          <button className="chip on-recovery-restore" disabled={busy || !code.trim()} onClick={() => {
            if (!net.restoreAccount(code.trim())) setError(true);
            else { setCode(''); setRevealed(''); setError(false); }
          }}>{t('전적 복구')}</button>
        </div>
        {error && <span className="on-alert" role="alert">{t('복구코드를 확인하거나 대전을 마친 뒤 다시 시도하세요.')}</span>}
      </div>
    </details>
  );
}

function RankedLobby({ navy, setNavy }: { navy: Faction; setNavy: (f: Faction) => void }) {
  const t = useT();
  const profile = useNet((s) => s.rankProfile);
  const queue = useNet((s) => s.rankedQueue);
  const board = useNet((s) => s.leaderboard);
  const result = useNet((s) => s.rankResult);
  const signedIn = useNet((s) => s.signedIn);
  const [now, setNow] = useState(Date.now());
  const refresh = () => { net.refreshRank(); net.fetchLeaderboard(); };
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (!queue) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [queue?.since]);
  const waited = queue ? Math.max(0, Math.floor((now - queue.since) / 1000)) : 0;
  return <>
    <section className="on-card on-rank">
      <div className="on-card-head"><b>{t('랭크전')}</b><span className="on-hint">{t('1:1 한려 쟁탈전 · 플레이어만')}</span></div>
      {profile ? <div className="on-rank-profile">
        <div className="on-rank-score"><strong>{profile.rating}</strong><span>{t(RANK_TIER[profile.tier])}</span></div>
        <div className="on-rank-record"><span>{t('{win}승 {draw}무 {loss}패', { win: profile.wins, draw: profile.draws, loss: profile.losses })}</span>{profile.placementLeft > 0 && <span>{t('배치 {n}판 남음', { n: profile.placementLeft })}</span>}</div>
      </div> : <div className="on-hint">{t('랭크 정보를 불러올 수 없습니다.')} <button className="chip" onClick={refresh}>{t('새로고침')}</button></div>}
      {result && !queue && <RankResult />}
      {queue ? <div className="on-searching on-rank-searching">
        <span className="on-spinner" />
        <span>{t('상대를 찾는 중 · {n}초', { n: waited })}<small>{t('검색 범위 ±{n}점', { n: queue.range })}</small></span>
        <button className="chip on-rank-cancel" onClick={() => net.rankedCancel()}>{t('취소')}</button>
      </div> : <>
        <div className="on-row"><span className="on-label">{t('진영')}</span><NavyPicker value={navy} onChange={setNavy} ming /></div>
        <span className="on-rank-trait">{t(COMPETITIVE_TRAITS[navy])}</span>
        <div className="on-row"><span className="on-hint">{t('상대를 찾을 때까지 기다립니다. 컴퓨터로 대체하지 않습니다.')}</span><button className="ink-btn on-go on-rank-start" disabled={!profile} onClick={() => { click(); net.ranked(navy); }}>{t('랭크전 찾기')}</button></div>
      </>}
      <span className="on-hint">{t('같은 상대와는 1시간에 3판까지 대전합니다.')}</span>
    </section>
    <section className="on-card on-rank-board">
      <div className="on-card-head"><b>{t('순위표')}</b><button className="chip" onClick={refresh}>{t('새로고침')}</button></div>
      {board.length ? <div className="on-rank-table-wrap"><table className="on-rank-table">
        <thead><tr><th>{t('순위')}</th><th>{t('장수')}</th><th>{t('등급')}</th><th>{t('점수')}</th><th className="on-rank-table-record">{t('전적')}</th></tr></thead>
        <tbody>{board.map((p, i) => <tr key={p.id} className={p.id === profile?.id ? 'on-rank-table-me' : ''}><td>{i + 1}</td><td className="on-rank-player">{p.name}</td><td>{t(RANK_TIER[p.tier])}</td><td>{p.rating}</td><td className="on-rank-table-record">{t('{win}승 {draw}무 {loss}패', { win: p.wins, draw: p.draws, loss: p.losses })}</td></tr>)}</tbody>
      </table></div> : <span className="on-hint">{t('아직 순위표에 등록된 장수가 없습니다.')}</span>}
    </section>
    {/* A signed-in player's record goes with the account: there is no code to keep. */}
    {!signedIn && <Recovery busy={!!queue} />}
  </>;
}

function Lobby() {
  const t = useT();
  const name = useNet((s) => s.name);
  const rooms = useNet((s) => s.rooms);
  const error = useNet((s) => s.error);
  const ping = useNet((s) => s.ping);
  const quick = useNet((s) => s.quick);
  const rankedQueue = useNet((s) => s.rankedQueue);
  const [tab, setTab] = useState<'ranked' | 'casual'>(() => useNet.getState().quick ? 'casual' : 'ranked');
  const [title, setTitle] = useState('');
  const [choice, setChoice] = useState<BattleChoice>({ kind: 'conquest', map: 'hallyeo', size: 2 });
  const [quickChoice, setQuickChoice] = useState<BattleChoice>({ kind: 'scenario', id: 'hansan' });
  const [navy, setNavy] = useState<Faction>('joseon');
  const [code, setCode] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => net.send({ t: 'list' }), 4000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (!quick) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [quick]);
  useEffect(() => { if (rankedQueue) setTab('ranked'); else if (quick) setTab('casual'); }, [!!rankedQueue, !!quick]);

  const waited = quick ? Math.min(quick.seconds, Math.floor((now - quick.since) / 1000)) : 0;
  const safeNavy = quickChoice.kind === 'scenario' && navy === 'ming' ? 'joseon' : navy;
  return (
    <div className="cs net paper on">
      <div className="on-title">
        {t('대기실')}{' '}
        <small>
          {name} · {ping}ms
        </small>
      </div>
      {error && <div className="on-alert">{t(error)}</div>}
      <div className="on-seg on-tabs" role="tablist" aria-label={t('대전 모드')}>
        <button className={`on-seg-btn on-tab-ranked ${tab === 'ranked' ? 'on-seg-btn--on' : ''}`} role="tab" aria-selected={tab === 'ranked'} disabled={!!quick} onClick={() => setTab('ranked')}>{t('랭크전')}</button>
        <button className={`on-seg-btn on-tab-casual ${tab === 'casual' ? 'on-seg-btn--on' : ''}`} role="tab" aria-selected={tab === 'casual'} disabled={!!rankedQueue} onClick={() => setTab('casual')}>{t('일반 대전')}</button>
      </div>
      {tab === 'ranked' ? <RankedLobby navy={navy} setNavy={setNavy} /> : <>
      <section className="on-card">
        <div className="on-card-head">
          <b>{t('빠른 대전')}</b>
          <span className="on-hint">{t('상대를 찾아 바로 시작합니다.')} {quick ? '' : t('찾지 못하면 컴퓨터가 상대합니다.')}</span>
        </div>
        {quick ? (
          <div className="on-searching">
            <span className="on-spinner" />
            <span>
              {t('상대를 찾는 중 · {waited}초 / {total}초', { waited, total: quick.seconds })} <small>{t('시간이 지나면 컴퓨터가 상대합니다')}</small>
            </span>
            <button className="chip" onClick={() => net.send({ t: 'quickCancel' })}>
              {t('취소')}
            </button>
          </div>
        ) : (
          <>
            <BattlePicker value={quickChoice} onChange={setQuickChoice} sizes={false} />
            <div className="on-row">
              <span className="on-label">{t('진영')}</span>
              <NavyPicker value={safeNavy} onChange={setNavy} ming={quickChoice.kind === 'conquest'} />
              <button
                className="ink-btn on-go on-quick-go"
                onClick={() => {
                  click();
                  net.send({ t: 'quick', battle: quickChoice.kind === 'conquest' ? { ...quickChoice, size: 2 } : quickChoice, faction: safeNavy });
                }}
              >
                {t('빠른 대전 시작')}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="on-card">
        <div className="on-card-head">
          <b>{t('열린 방')}</b>
          <span className="on-hint">{rooms.length ? t('방 {n}개', { n: rooms.length }) : t('열린 방이 없습니다. 새 방을 만들어 상대를 기다릴 수 있습니다.')}</span>
        </div>
        <div className="on-rooms">
          {rooms.map((r) => (
            <RoomRow key={r.id} r={r} />
          ))}
        </div>
        <div className="on-row">
          <span className="on-label">{t('방 코드')}</span>
          <input className="on-input on-input--code" value={code} maxLength={4} placeholder="ABCD" onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <button className="chip" disabled={code.length !== 4} onClick={() => net.send({ t: 'join', room: code })}>
            {t('입장')}
          </button>
        </div>
      </section>

      <section className="on-card">
        <div className="on-card-head">
          <b>{t('새 방')}</b>
          <span className="on-hint">{t('전장을 고르고 방을 만들어 친구를 초대하거나 상대를 기다립니다.')}</span>
        </div>
        <BattlePicker value={choice} onChange={setChoice} sizes />
        <div className="on-row">
          <span className="on-label">{t('방 이름')}</span>
          <input className="on-input" value={title} maxLength={24} placeholder={t('{name}의 방', { name })} onChange={(e) => setTitle(e.target.value)} />
          <button
            className="ink-btn on-go on-create"
            onClick={() => {
              click();
              net.createRoom(title || t('{name}의 방', { name }), choice);
            }}
          >
            {t('방 만들기')}
          </button>
        </div>
      </section>
      </>}
    </div>
  );
}

function Seats({ room, me }: { room: RoomInfo; me: string }) {
  const t = useT();
  const host = room.host === me;
  const duel = room.battle.kind === 'scenario';
  // A duel's seats are its two slots; a 1588 battle fills them with England and Spain.
  const armada = room.battle.kind === 'scenario' && isArmadaBattle(room.battle.id);
  const navyOf = (team: RoomInfo['seats'][number]['team']): Faction => (armada ? (team === 'joseon' ? 'england' : 'spain') : team);
  return (
    <div className="on-seats">
      {room.seats.map((s, i) => {
        const editable = !room.ranked && !duel && (s.client === me || (host && !s.client));
        const label = s.client ? (s.client === me ? t('{name} (나)', { name: s.player }) : s.player || t('상대 장수')) : s.human ? t('빈 자리') : t('컴퓨터');
        return (
          <div key={i} className={`on-seat on-seat--${s.team} ${s.client === me ? 'on-seat--me' : ''}`}>
            <span className="on-side">{t(duel ? FACTION_SHORT[navyOf(s.team)] : s.name)}</span>
            <b>{label}</b>
            {s.away && <span className="on-tag on-tag--warn">{t('연결 끊김')}</span>}
            <div className="on-factions">
              {(duel ? [navyOf(s.team)] : FACTIONS).map((f) => (
                <button key={f} className={`on-faction ${duel || s.faction === f ? 'on-faction--on' : ''}`} disabled={!editable} onClick={() => net.send({ t: 'seat', index: i, faction: f })} title={t(FACTION_NAME[f])}>
                  <i className={`emblem emblem--${f}`} />
                </button>
              ))}
            </div>
            {!room.ranked && !s.client && s.human && (
              <button className="chip" onClick={() => net.send({ t: 'take', index: i })}>
                {t('자리 잡기')}
              </button>
            )}
            {!room.ranked && !s.client && host && (
              <button className="chip" onClick={() => net.send({ t: 'seat', index: i, human: !s.human })}>
                {s.human ? t('컴퓨터로 전환') : t('플레이어 자리로 전환')}
              </button>
            )}
            {s.client && <span className={`on-tag ${s.ready || s.client === room.host ? 'on-tag--on' : ''}`}>{room.ranked ? t('랭크전') : room.state === 'ended' ? (s.rematch ? t('재대결') : '') : s.client === room.host ? t('방장') : s.ready ? t('준비') : t('대기')}</span>}
          </div>
        );
      })}
    </div>
  );
}

function Room({ room }: { room: RoomInfo }) {
  const t = useT();
  const me = useNet((s) => s.id);
  const error = useNet((s) => s.error);
  const chat = useNet((s) => s.chat);
  const [line, setLine] = useState('');
  const log = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [chat.length]);

  const host = room.host === me;
  const mine = room.seats.find((s) => s.client === me);
  const others = room.seats.filter((s) => s.client && s.client !== room.host);
  const canStart = host && room.state === 'lobby' && others.every((s) => s.ready);
  const say = () => {
    if (!line.trim()) return;
    net.send({ t: 'chat', text: line });
    setLine('');
  };
  return (
    <div className="cs net paper on">
      <div className="on-title">
        {room.ranked ? t('랭크전') : room.quick ? t('{mode} · {title}', { mode: t('빠른 대전'), title: battleTitle(room.battle) }) : room.name} <code>{room.id}</code>
        <small>
          {battleTitle(room.battle)} · {battleKind(room.battle)}
        </small>
      </div>
      {error && <div className="on-alert">{t(error)}</div>}
      {room.battle.kind === 'scenario' && room.state === 'lobby' && (
        <p className="on-lead">{t(isArmadaBattle(room.battle.id) ? '잉글랜드와 에스파냐 중 한 자리를 맡습니다. 비어 있는 자리는 컴퓨터가 맡습니다.' : '조선과 일본 중 한 자리를 맡습니다. 비어 있는 자리는 컴퓨터가 맡습니다.')}</p>
      )}
      <Seats room={room} me={me} />
      {room.ranked && room.state === 'ended' && <RankResult showOutcome />}
      <div className="on-chat" ref={log}>
        {chat.map((c, i) => (
          <div key={i}>
            <b>{c.system ? t(c.from) : c.from}</b> {c.system ? t(c.text, c.args) : c.text}
          </div>
        ))}
      </div>
      <div className="on-row">
        <input className="on-input" value={line} maxLength={120} placeholder={t('메시지 입력')} onChange={(e) => setLine(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && say()} />
        <button className="chip" title={room.ranked && room.state !== 'ended' ? t('기권하면 랭크 점수에 반영됩니다') : undefined} onClick={() => net.send({ t: 'leave' })}>
          {t(room.ranked && room.state !== 'ended' ? '기권하고 대기실로' : '나가기')}
        </button>
        {!room.ranked && room.state === 'lobby' && !host && (
          <button className={`chip on-ready ${mine?.ready ? 'chip--on' : ''}`} onClick={() => net.send({ t: 'ready', ready: !mine?.ready })}>
            {mine?.ready ? t('준비 완료') : t('준비')}
          </button>
        )}
        {!room.ranked && room.state === 'lobby' && host && (
          <button
            className="ink-btn on-go on-start"
            disabled={!canStart}
            onClick={() => {
              click();
              net.send({ t: 'start' });
            }}
          >
            {t('전투 시작')}
          </button>
        )}
        {room.ranked && room.state === 'ended' && <RankActions />}
        {!room.ranked && room.state === 'ended' && (
          <button className={`chip on-rematch ${mine?.rematch ? 'chip--on' : ''}`} disabled={!mine || mine.rematch} onClick={() => net.send({ t: 'rematch' })}>
            {mine?.rematch ? t('상대를 기다리는 중') : t('재대결')}
          </button>
        )}
        {room.state === 'battle' && <span className="on-hint">{t('전투 진행 중')}</span>}
      </div>
      {room.state === 'lobby' && host && !canStart && <div className="on-hint">{t('아직 준비하지 않은 참가자가 있습니다.')}</div>}
    </div>
  );
}

/** Multiplayer lobby: connect with a name, find a battle (quick match, open rooms, or a room of your own), take a seat and sail. */
export function OnlinePanel() {
  const t = useT();
  const status = useNet((s) => s.status);
  const room = useNet((s) => s.room);
  const notice = useNet((s) => s.notice);
  if (status !== 'online') return <Connect />;
  if (!room)
    return (
      <>
        <Lobby />
        {notice && (
          <button className="on-toast" onClick={() => net.clearBattle()}>
            {t(notice)} <Cross size={14} />
          </button>
        )}
      </>
    );
  return <Room room={room} />;
}
