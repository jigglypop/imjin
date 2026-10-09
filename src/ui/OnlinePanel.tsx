import { useEffect, useRef, useState } from 'react';
import { net, useNet } from '../net/NetClient';
import type { BattleChoice, RoomInfo, RoomSummary } from '../net/protocol';
import { CONQUEST_MAPS, CONQUEST_ORDER, type ConquestMapId } from '../sim/maps';
import { SCENARIOS, SCENARIO_ORDER, type ScenarioId } from '../sim/scenarios';
import { FACTION_MARK, FACTION_NAME } from '../sim/balance';
import { FACTIONS, type Faction } from '../sim/types';
import { sound } from '../audio/Sound';
import { mountOnlineOverlay } from './OnlineOverlay';
import './online.css';

mountOnlineOverlay();

const click = () => sound.click();

export const battleTitle = (c: BattleChoice) => (c.kind === 'scenario' ? SCENARIOS[c.id].title : CONQUEST_MAPS[c.map].title);
export const battleKind = (c: BattleChoice) => (c.kind === 'scenario' ? '역사 전투 · 1:1' : `쟁탈전 · ${c.size === 4 ? '2:2' : '1:1'}`);

/** Picks what is fought: a conquest map (with the seat count, when it applies) or one of the historical battles. */
function BattlePicker({ value, onChange, sizes }: { value: BattleChoice; onChange: (c: BattleChoice) => void; sizes: boolean }) {
  const pickConquest = (map: ConquestMapId) => onChange({ kind: 'conquest', map, size: value.kind === 'conquest' && CONQUEST_MAPS[map].seats >= value.size ? value.size : 2 });
  return (
    <div className="on-picker">
      <div className="on-seg" role="tablist">
        <button className={`on-seg-btn ${value.kind === 'conquest' ? 'on-seg-btn--on' : ''}`} onClick={() => value.kind !== 'conquest' && pickConquest('hallyeo')}>
          쟁탈전
        </button>
        <button className={`on-seg-btn ${value.kind === 'scenario' ? 'on-seg-btn--on' : ''}`} onClick={() => value.kind !== 'scenario' && onChange({ kind: 'scenario', id: 'hansan' })}>
          역사 전투 1:1
        </button>
      </div>
      {value.kind === 'conquest' ? (
        <div className="on-chips">
          {CONQUEST_ORDER.map((id) => (
            <button key={id} className={`chip ${value.map === id ? 'chip--on' : ''}`} onClick={() => pickConquest(id)}>
              {CONQUEST_MAPS[id].title}
            </button>
          ))}
          {sizes && (
            <>
              <button className={`chip ${value.size === 2 ? 'chip--on' : ''}`} onClick={() => onChange({ ...value, size: 2 })}>
                1:1
              </button>
              <button className={`chip ${value.size === 4 ? 'chip--on' : ''}`} disabled={CONQUEST_MAPS[value.map].seats < 4} onClick={() => onChange({ ...value, size: 4 })}>
                2:2
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="on-chips">
          <select className="on-select" value={value.id} onChange={(e) => onChange({ kind: 'scenario', id: e.target.value as ScenarioId })}>
            {SCENARIO_ORDER.map((id) => (
              <option key={id} value={id}>
                {SCENARIOS[id].title} · {SCENARIOS[id].date.slice(0, 5)}
              </option>
            ))}
          </select>
          <span className="on-hint">{SCENARIOS[value.id].place}</span>
        </div>
      )}
    </div>
  );
}

function NavyPicker({ value, onChange, ming }: { value: Faction; onChange: (f: Faction) => void; ming: boolean }) {
  return (
    <div className="on-navies">
      {FACTIONS.filter((f) => ming || f !== 'ming').map((f) => (
        <button key={f} className={`on-navy ${value === f ? 'on-navy--on' : ''}`} onClick={() => onChange(f)}>
          <i className={`emblem emblem--${f}`}>{FACTION_MARK[f]}</i>
          <span>{FACTION_NAME[f]}</span>
        </button>
      ))}
    </div>
  );
}

function Connect() {
  const status = useNet((s) => s.status);
  const name = useNet((s) => s.name);
  const error = useNet((s) => s.error);
  const retry = useNet((s) => s.retry);
  const [nick, setNick] = useState(name);
  const busy = status === 'connecting';
  const go = () => {
    click();
    net.connect(nick);
  };
  return (
    <div className="cs net paper on">
      <div className="on-title">대전 · 사람과 겨룬다</div>
      <p className="on-lead">조선, 명, 일본 수군을 맡아 다른 사람과 쟁탈전이나 역사 속 해전을 겨룹니다. 빈 자리는 컴퓨터가 맡습니다.</p>
      <div className="on-row">
        <span className="on-label">이름</span>
        <input className="on-input" value={nick} maxLength={16} placeholder="장수 이름" onChange={(e) => setNick(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
        <button className="ink-btn on-go on-connect" disabled={busy || status === 'reconnecting'} onClick={go}>
          {busy ? '접속 중' : '접속'}
        </button>
      </div>
      {status === 'reconnecting' && (
        <div className="on-alert">
          연결이 끊어졌습니다 — {retry ? `${retry.in}초 뒤 다시 시도합니다 (${retry.attempt}번째)` : '다시 연결하는 중'}
          <button className="chip" onClick={() => net.retryNow()}>
            지금 다시 시도
          </button>
        </div>
      )}
      {error && status !== 'reconnecting' && (
        <div className="on-alert">
          {error}
          {status === 'error' && (
            <button className="chip" onClick={go}>
              다시 시도
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RoomRow({ r }: { r: RoomSummary }) {
  return (
    <div className="on-room">
      <b>{r.name}</b>
      <span>
        {battleTitle(r.battle)} · {battleKind(r.battle)} · {r.humans}명 {r.state === 'lobby' ? `· 빈자리 ${r.open}` : '· 교전 중'}
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
        들어가기
      </button>
    </div>
  );
}

function Lobby() {
  const name = useNet((s) => s.name);
  const rooms = useNet((s) => s.rooms);
  const error = useNet((s) => s.error);
  const ping = useNet((s) => s.ping);
  const quick = useNet((s) => s.quick);
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

  const waited = quick ? Math.min(quick.seconds, Math.floor((now - quick.since) / 1000)) : 0;
  const safeNavy = quickChoice.kind === 'scenario' && navy === 'ming' ? 'joseon' : navy;
  return (
    <div className="cs net paper on">
      <div className="on-title">
        대전 대기실{' '}
        <small>
          {name} · {ping}ms
        </small>
      </div>
      {error && <div className="on-alert">{error}</div>}

      <section className="on-card">
        <div className="on-card-head">
          <b>빠른 대전</b>
          <span className="on-hint">상대를 찾아 바로 출진합니다. {quick ? '' : '찾지 못하면 컴퓨터가 상대합니다.'}</span>
        </div>
        {quick ? (
          <div className="on-searching">
            <span className="on-spinner" />
            <span>
              상대를 찾는 중 — {waited}초 / {quick.seconds}초 <small>(이후 컴퓨터가 상대합니다)</small>
            </span>
            <button className="chip" onClick={() => net.send({ t: 'quickCancel' })}>
              취소
            </button>
          </div>
        ) : (
          <>
            <BattlePicker value={quickChoice} onChange={setQuickChoice} sizes={false} />
            <div className="on-row">
              <span className="on-label">수군</span>
              <NavyPicker value={safeNavy} onChange={setNavy} ming={quickChoice.kind === 'conquest'} />
              <button
                className="ink-btn on-go on-quick-go"
                onClick={() => {
                  click();
                  net.send({ t: 'quick', battle: quickChoice.kind === 'conquest' ? { ...quickChoice, size: 2 } : quickChoice, faction: safeNavy });
                }}
              >
                빠른 대전
              </button>
            </div>
          </>
        )}
      </section>

      <section className="on-card">
        <div className="on-card-head">
          <b>열린 방</b>
          <span className="on-hint">{rooms.length ? `${rooms.length}개` : '열린 방이 없습니다. 방을 만들어 상대를 기다리십시오.'}</span>
        </div>
        <div className="on-rooms">
          {rooms.map((r) => (
            <RoomRow key={r.id} r={r} />
          ))}
        </div>
        <div className="on-row">
          <span className="on-label">암호</span>
          <input className="on-input on-input--code" value={code} maxLength={4} placeholder="ABCD" onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <button className="chip" disabled={code.length !== 4} onClick={() => net.send({ t: 'join', room: code })}>
            들어가기
          </button>
        </div>
      </section>

      <section className="on-card">
        <div className="on-card-head">
          <b>새 방</b>
          <span className="on-hint">전장을 고르고 방을 열어 친구를 부르거나 상대를 기다립니다.</span>
        </div>
        <BattlePicker value={choice} onChange={setChoice} sizes />
        <div className="on-row">
          <span className="on-label">방 이름</span>
          <input className="on-input" value={title} maxLength={24} placeholder={`${name}의 방`} onChange={(e) => setTitle(e.target.value)} />
          <button
            className="chip chip--on on-create"
            onClick={() => {
              click();
              net.createRoom(title, choice);
            }}
          >
            열기
          </button>
        </div>
      </section>
    </div>
  );
}

function Seats({ room, me }: { room: RoomInfo; me: string }) {
  const host = room.host === me;
  const duel = room.battle.kind === 'scenario';
  return (
    <div className="on-seats">
      {room.seats.map((s, i) => {
        const editable = !duel && (s.client === me || (host && !s.client));
        const label = s.client ? (s.client === me ? `${s.player} (나)` : s.player || '상대 장수') : s.human ? '빈 자리' : '컴퓨터';
        return (
          <div key={i} className={`on-seat on-seat--${s.team} ${s.client === me ? 'on-seat--me' : ''}`}>
            <span className="on-side">{duel ? FACTION_NAME[s.team].replace(' 수군', '') : s.name}</span>
            <b>{label}</b>
            {s.away && <span className="on-tag on-tag--warn">연결 끊김</span>}
            <div className="on-factions">
              {(duel ? [s.team] : FACTIONS.filter((f) => f !== 'ming' || s.team === 'joseon')).map((f) => (
                <button key={f} className={`on-faction ${s.faction === f ? 'on-faction--on' : ''}`} disabled={!editable} onClick={() => net.send({ t: 'seat', index: i, faction: f })} title={FACTION_NAME[f]}>
                  <i className={`emblem emblem--${f}`}>{FACTION_MARK[f]}</i>
                </button>
              ))}
            </div>
            {!s.client && s.human && (
              <button className="chip" onClick={() => net.send({ t: 'take', index: i })}>
                자리 잡기
              </button>
            )}
            {!s.client && host && (
              <button className="chip" onClick={() => net.send({ t: 'seat', index: i, human: !s.human })}>
                {s.human ? '컴퓨터로' : '사람 자리로'}
              </button>
            )}
            {s.client && <span className={`on-tag ${s.ready || s.client === room.host ? 'on-tag--on' : ''}`}>{room.state === 'ended' ? (s.rematch ? '재대결' : '') : s.client === room.host ? '방장' : s.ready ? '준비' : '대기'}</span>}
          </div>
        );
      })}
    </div>
  );
}

function Room({ room }: { room: RoomInfo }) {
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
        {room.name} <code>{room.id}</code>
        <small>
          {battleTitle(room.battle)} · {battleKind(room.battle)}
        </small>
      </div>
      {error && <div className="on-alert">{error}</div>}
      {room.battle.kind === 'scenario' && room.state === 'lobby' && <p className="on-lead">서군(조선)과 동군(일본) 가운데 한 자리를 맡습니다. 비어 있는 쪽은 컴퓨터가 지휘합니다.</p>}
      <Seats room={room} me={me} />
      <div className="on-chat" ref={log}>
        {chat.map((c, i) => (
          <div key={i}>
            <b>{c.from}</b> {c.text}
          </div>
        ))}
      </div>
      <div className="on-row">
        <input className="on-input" value={line} maxLength={120} placeholder="말하기" onChange={(e) => setLine(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && say()} />
        <button className="chip" onClick={() => net.send({ t: 'leave' })}>
          나가기
        </button>
        {room.state === 'lobby' && !host && (
          <button className={`chip on-ready ${mine?.ready ? 'chip--on' : ''}`} onClick={() => net.send({ t: 'ready', ready: !mine?.ready })}>
            {mine?.ready ? '준비 완료' : '준비'}
          </button>
        )}
        {room.state === 'lobby' && host && (
          <button
            className="ink-btn on-go on-start"
            disabled={!canStart}
            onClick={() => {
              click();
              net.send({ t: 'start' });
            }}
          >
            출진
          </button>
        )}
        {room.state === 'ended' && (
          <button className={`chip on-rematch ${mine?.rematch ? 'chip--on' : ''}`} disabled={!mine || mine.rematch} onClick={() => net.send({ t: 'rematch' })}>
            {mine?.rematch ? '상대를 기다리는 중' : '재대결'}
          </button>
        )}
        {room.state === 'battle' && <span className="on-hint">교전 중</span>}
      </div>
      {room.state === 'lobby' && host && !canStart && <div className="on-hint">준비하지 않은 사람이 있습니다.</div>}
    </div>
  );
}

/** Multiplayer lobby: connect with a name, find a battle (quick match, open rooms, or a room of your own), take a seat and sail. */
export function OnlinePanel() {
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
            {notice} ✕
          </button>
        )}
      </>
    );
  return <Room room={room} />;
}
