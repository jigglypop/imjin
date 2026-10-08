import { useEffect, useRef, useState } from 'react';
import { net, useNet } from '../net/NetClient';
import { CONQUEST_MAPS, CONQUEST_ORDER, type ConquestMapId } from '../sim/maps';
import { FACTION_MARK, FACTION_NAME } from '../sim/balance';
import { FACTIONS, type Faction } from '../sim/types';
import { sound } from '../audio/Sound';

const SIDE: Record<string, string> = { joseon: '서군', japan: '동군' };

/** Multiplayer lobby: connect with a name, find or open a room, take a seat and a navy, and sail when all are ready. */
export function OnlinePanel() {
  const status = useNet((s) => s.status);
  const name = useNet((s) => s.name);
  const rooms = useNet((s) => s.rooms);
  const room = useNet((s) => s.room);
  const error = useNet((s) => s.error);
  const chat = useNet((s) => s.chat);
  const me = useNet((s) => s.id);
  const ping = useNet((s) => s.ping);
  const [nick, setNick] = useState(name);
  const [title, setTitle] = useState('');
  const [map, setMap] = useState<ConquestMapId>('hallyeo');
  const [size, setSize] = useState<2 | 4>(2);
  const [code, setCode] = useState('');
  const [line, setLine] = useState('');
  const log = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (status !== 'online' || room) return;
    const id = window.setInterval(() => net.send({ t: 'list' }), 4000);
    return () => window.clearInterval(id);
  }, [status, room]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [chat.length]);

  const click = () => sound.click();

  if (status !== 'online') {
    return (
      <div className="cs net paper">
        <div className="net-title">대전 · 여러 사람이 각 진영을 맡아 겨룬다</div>
        <p className="cs-summary">조선, 명, 일본 수군 가운데 하나를 맡아 다른 사람과 쟁탈전을 벌입니다. 빈 자리는 컴퓨터가 맡습니다.</p>
        <div className="cs-row">
          <span className="cs-label">이름</span>
          <input className="net-input" value={nick} maxLength={16} placeholder="장수 이름" onChange={(e) => setNick(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && net.connect(nick)} />
          <button
            className="ink-btn net-go"
            disabled={status === 'connecting'}
            onClick={() => {
              click();
              net.connect(nick);
            }}
          >
            {status === 'connecting' ? '접속 중' : '접속'}
          </button>
        </div>
        {error && <div className="net-error">{error}</div>}
      </div>
    );
  }

  if (!room) {
    return (
      <div className="cs net paper">
        <div className="net-title">
          대전 대기실 <small>{name} · {ping}ms</small>
        </div>
        {error && <div className="net-error">{error}</div>}
        <div className="net-rooms">
          {rooms.length === 0 && <div className="cq-hint">열린 방이 없습니다. 방을 만들어 상대를 기다리십시오.</div>}
          {rooms.map((r) => (
            <div key={r.id} className="net-room">
              <b>{r.name}</b>
              <span>
                {CONQUEST_MAPS[r.map]?.title ?? r.map} · {r.size === 4 ? '2:2' : '1:1'} · {r.humans}명 {r.state === 'lobby' ? `· 빈자리 ${r.open}` : '· 교전 중'}
              </span>
              <code>{r.id}</code>
              <button
                className="chip"
                disabled={r.state !== 'lobby'}
                onClick={() => {
                  click();
                  net.send({ t: 'join', room: r.id });
                }}
              >
                들어가기
              </button>
            </div>
          ))}
        </div>
        <div className="cs-row">
          <span className="cs-label">새 방</span>
          <input className="net-input" value={title} maxLength={24} placeholder={`${name}의 방`} onChange={(e) => setTitle(e.target.value)} />
          <div className="chips">
            {CONQUEST_ORDER.map((id) => (
              <button key={id} className={`chip ${map === id ? 'chip--on' : ''}`} onClick={() => setMap(id)}>
                {CONQUEST_MAPS[id].title}
              </button>
            ))}
            <button className={`chip ${size === 2 ? 'chip--on' : ''}`} onClick={() => setSize(2)}>
              1:1
            </button>
            <button className={`chip ${size === 4 ? 'chip--on' : ''}`} disabled={CONQUEST_MAPS[map].seats < 4} onClick={() => setSize(4)}>
              2:2
            </button>
          </div>
          <button
            className="chip chip--on"
            onClick={() => {
              click();
              net.send({ t: 'create', name: title, map, size });
            }}
          >
            열기
          </button>
        </div>
        <div className="cs-row">
          <span className="cs-label">암호</span>
          <input className="net-input net-input--code" value={code} maxLength={4} placeholder="ABCD" onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <button className="chip" disabled={code.length !== 4} onClick={() => net.send({ t: 'join', room: code })}>
            들어가기
          </button>
        </div>
      </div>
    );
  }

  const host = room.host === me;
  const mine = room.seats.findIndex((s) => s.client === me);
  const ready = mine >= 0 && room.seats[mine]!.ready;
  const others = room.seats.filter((s) => s.client && s.client !== room.host);
  const canStart = host && others.every((s) => s.ready);
  return (
    <div className="cs net paper">
      <div className="net-title">
        {room.name} <code>{room.id}</code>
        <small>
          {CONQUEST_MAPS[room.map].title} · {room.size === 4 ? '2:2' : '1:1'}
        </small>
      </div>
      {error && <div className="net-error">{error}</div>}
      <div className="net-seats">
        {room.seats.map((s, i) => {
          const editable = s.client === me || (host && !s.client);
          const label = s.client ? (s.client === me ? `${name} (나)` : '상대 장수') : s.human ? '빈 자리' : '컴퓨터';
          return (
            <div key={i} className={`net-seat net-seat--${s.team} ${s.client === me ? 'net-seat--me' : ''}`}>
              <span className="net-side">{SIDE[s.team]}</span>
              <b>{label}</b>
              <div className="cs-factions">
                {FACTIONS.map((f: Faction) => (
                  <button key={f} className={`cs-faction ${s.faction === f ? 'cs-faction--on' : ''}`} disabled={!editable} onClick={() => net.send({ t: 'seat', index: i, faction: f })} title={FACTION_NAME[f]}>
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
              {s.client && <span className={`net-ready ${s.ready || s.client === room.host ? 'net-ready--on' : ''}`}>{s.client === room.host ? '방장' : s.ready ? '준비' : '대기'}</span>}
            </div>
          );
        })}
      </div>
      <div className="net-chat" ref={log}>
        {chat.map((c, i) => (
          <div key={i}>
            <b>{c.from}</b> {c.text}
          </div>
        ))}
      </div>
      <div className="cs-row">
        <input
          className="net-input"
          value={line}
          maxLength={120}
          placeholder="말하기"
          onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && line.trim()) {
              net.send({ t: 'chat', text: line });
              setLine('');
            }
          }}
        />
        <button className="chip" onClick={() => net.send({ t: 'leave' })}>
          나가기
        </button>
        {!host && (
          <button className={`chip ${ready ? 'chip--on' : ''}`} onClick={() => net.send({ t: 'ready', ready: !ready })}>
            {ready ? '준비 완료' : '준비'}
          </button>
        )}
        {host && (
          <button
            className="ink-btn net-go"
            disabled={!canStart}
            onClick={() => {
              click();
              net.send({ t: 'start' });
            }}
          >
            출진
          </button>
        )}
      </div>
    </div>
  );
}
