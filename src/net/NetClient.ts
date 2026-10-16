import { create } from 'zustand';
import { onSessionChange, saveSession, savedSession } from '../account/session';
import { t } from '../i18n';
import { pushToast } from '../state/store';
import { MP_URL } from './address';
import { GRACE_SECONDS, PROTOCOL, type BattleChoice, type ClientMsg, type RankProfile, type RankStanding, type RoomInfo, type RoomSummary, type ServerMsg } from './protocol';
import type { Faction } from '../sim/types';

/** idle: not connected; connecting: first attempt; online; reconnecting: the line dropped and we keep trying; error: gave up. */
type Status = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'error';
/** A system line keeps its Korean template and values, so it is translated when drawn (the language can change meanwhile). */
type ChatLine = { from: string; text: string; args?: Record<string, string | number>; system: boolean; at: number };
/** none: no online battle; playing; ended: the result is out (rematch possible); lost: the seat could not be recovered. */
type BattlePhase = 'none' | 'playing' | 'ended' | 'lost';

type NetState = {
  status: Status;
  id: string;
  name: string;
  rooms: RoomSummary[];
  room: RoomInfo | null;
  chat: ChatLine[];
  /** Korean source text, translated where it is drawn (a language switch updates it). */
  error: string | null;
  identityRejected: boolean;
  /** The line speaks for a signed-in account, whose ranked record goes with the account rather than a recovery code. */
  signedIn: boolean;
  ping: number;
  /** Quick match: when the search began (client clock) and how long it waits for a person. */
  quick: { since: number; seconds: number } | null;
  rankProfile: RankProfile | null;
  rankedQueue: { since: number; range: number } | null;
  leaderboard: RankStanding[];
  rankResult: Extract<ServerMsg, { t: 'rankedResult' }> | null;
  rankedMatch: boolean;
  rankedMatchId: string | null;
  battle: BattlePhase;
  /** Server pace in the running battle: what it manages and what it asks for (the approach is skipped fast). */
  speed: { speed: number; target: number };
  /** Seconds until the next reconnect attempt, and which attempt it is. */
  retry: { in: number; attempt: number } | null;
  /** Set when the server closed the room or the seat was lost (Korean source text, like `error`). */
  notice: string | null;
};

const NAME_KEY = 'imjin.name';
const TOKEN_KEY = 'imjin.session';
const ACCOUNT_KEY = 'imjin.ranked-account';
const RECOVERY_PREFIX = 'imjin-rank-v1:';
const STALE_MS = 9000;
/** Close code the server uses when a newer connection takes over a session. */
const REPLACED = 4001;
/** Retry delays (s); the last one repeats. The line is kept for the seat's grace period and a little more. */
const BACKOFF = [1, 2, 3, 5, 8];
const GIVE_UP_MS = (GRACE_SECONDS + 15) * 1000;

function stored(key: string, area: 'local' | 'session') {
  try {
    return (area === 'local' ? localStorage : sessionStorage).getItem(key) ?? '';
  } catch {
    return '';
  }
}
function store(key: string, value: string, area: 'local' | 'session') {
  try {
    const s = area === 'local' ? localStorage : sessionStorage;
    if (value) s.setItem(key, value);
    else s.removeItem(key);
  } catch {
    // the value lasts this session only
  }
}

/** The server names the computer's seats and the sides in Korean; the player sees them in the current language. */
const SIDE_NAMES = new Set(['서군', '동군', '서군 우익', '동군 우익']);
function seatName(name: string) {
  const computer = name.match(/^컴퓨터 (\d+)$/);
  if (computer) return t('컴퓨터 {n}', { n: computer[1]! });
  return SIDE_NAMES.has(name) ? t(name) : name;
}

const NO_SPEED = { speed: 1, target: 1 };
export const useNet = create<NetState>(() => ({
  status: 'idle',
  id: '',
  name: stored(NAME_KEY, 'local'),
  rooms: [],
  room: null,
  chat: [],
  error: null,
  identityRejected: false,
  signedIn: false,
  ping: 0,
  quick: null,
  rankProfile: null,
  rankedQueue: null,
  leaderboard: [],
  rankResult: null,
  rankedMatch: false,
  rankedMatchId: null,
  battle: 'none',
  speed: NO_SPEED,
  retry: null,
  notice: null,
}));

/** Battle traffic goes to whoever is listening: the networked battle of the running engine. */
export interface BattleListener {
  /** What the battle was built from: a resume only counts for the battle with the same seed. */
  readonly seed: number;
  snapshot(buf: ArrayBuffer): void;
  message(msg: ServerMsg): void;
}

type StartMsg = Extract<ServerMsg, { t: 'start' }>;

/** A timed-out seat may have been removed; its exact durable result still comes with the account profile. */
function recoveredResult(profile: RankProfile | null, matchId: string | null) {
  const receipt = matchId && profile?.recent.find((r) => r.matchId === matchId);
  return receipt && profile ? { t: 'rankedResult' as const, matchId: receipt.matchId, result: receipt.result, reason: receipt.reason, before: receipt.before, after: receipt.after, delta: receipt.delta, profile } : null;
}

/**
 * The connection to the multiplayer server: lobby state lives in useNet, battle traffic goes to the listener.
 * The session token (kept per tab) lets a dropped line, or a reloaded page, take its seat back.
 */
class NetClient {
  /** A bearer credential stays in this browser; unlike the tab session it survives disconnects. */
  private account = stored(ACCOUNT_KEY, 'local');
  /**
   * The account session (src/account) this line said hello with. Retries present the same one, so a seat is never
   * taken back as someone else; a sign-in or sign-out reaches the line when it is idle (reidentify).
   */
  private session = '';
  private ws: WebSocket | null = null;
  private pingTimer = 0;
  private retryTimer = 0;
  private countdown = 0;
  private lastHeard = 0;
  private lostAt = 0;
  private attempt = 0;
  /** Set once the server has welcomed this page; a drop after that is retried. */
  private everOnline = false;
  /** The player closed the line or the server turned it away for good: no retries. */
  private stopped = true;
  private pendingStart: StartMsg | null = null;
  private starter: ((msg: StartMsg) => void) | null = null;
  listener: BattleListener | null = null;

  /** Who starts the battle on the screen. A start that arrived before anyone listened is delivered when one does. */
  get onStart() {
    return this.starter;
  }
  set onStart(fn: ((msg: StartMsg) => void) | null) {
    this.starter = fn;
    if (fn && this.pendingStart) {
      const msg = this.pendingStart;
      this.pendingStart = null;
      fn(msg);
    }
  }

  /** A reloaded tab that was online (it still has its token) returns to the server by itself. */
  resumeIfKnown() {
    const name = useNet.getState().name;
    if (stored(TOKEN_KEY, 'session') && name && this.stopped) this.connect(name, true);
  }

  connect(name: string, quiet = false) {
    const clean = name.trim().slice(0, 16) || t('무명');
    store(NAME_KEY, clean, 'local');
    useNet.setState({ name: clean });
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
      this.send({ t: 'hello', name: clean, v: PROTOCOL, account: this.account || undefined, session: this.session || undefined });
      return;
    }
    this.session = savedSession()?.token ?? '';
    this.stopped = false;
    this.attempt = 0;
    this.open(quiet);
  }

  /** The recovery code of this browser's own ranked record, which a sign-up carries over into the account. */
  get rankedToken() {
    return this.account;
  }

  constructor() {
    onSessionChange(() => this.sessionChanged());
  }

  /**
   * The account of this browser changed, here or in another tab. The online name follows a signed-up account's
   * nickname, and an idle line says hello again as the new account; a line with a room, a queue or a battle keeps the
   * account its seat was taken with until it closes.
   */
  private sessionChanged() {
    const saved = savedSession();
    const nickname = saved && !saved.user.guest ? saved.user.nickname : '';
    if (nickname && nickname !== useNet.getState().name) {
      store(NAME_KEY, nickname, 'local');
      useNet.setState({ name: nickname });
      if (this.ws?.readyState === WebSocket.OPEN && saved!.token === this.session) this.send({ t: 'hello', name: nickname, v: PROTOCOL, account: this.account || undefined, session: this.session || undefined });
    }
    const state = useNet.getState();
    if (this.stopped || (saved?.token ?? '') === this.session || state.room || state.quick || state.rankedQueue || state.battle === 'playing') return;
    this.disconnect();
    this.connect(state.name, true);
  }

  private open(quiet = false) {
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.countdown);
    const first = !this.everOnline;
    useNet.setState((s) => ({ status: first ? 'connecting' : 'reconnecting', error: quiet ? s.error : null, retry: null }));
    let ws: WebSocket;
    try {
      ws = new WebSocket(MP_URL);
    } catch {
      this.failed(first, quiet);
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.lastHeard = performance.now();
      this.send({ t: 'hello', name: useNet.getState().name, v: PROTOCOL, token: stored(TOKEN_KEY, 'session') || undefined, account: this.account || undefined, session: this.session || undefined });
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        // A line that has gone quiet without closing is cut so the reconnect can start.
        if (performance.now() - this.lastHeard > STALE_MS) ws.close();
        else this.send({ t: 'ping', at: performance.now() });
      }, 3000);
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      this.lastHeard = performance.now();
      if (e.data instanceof ArrayBuffer) {
        this.listener?.snapshot(e.data);
        return;
      }
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return;
      }
      this.receive(msg);
    };
    ws.onerror = () => undefined;
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      window.clearInterval(this.pingTimer);
      this.ws = null;
      // Another window took this seat over (a duplicated tab shares the token); fighting back would never end.
      if (e.code === REPLACED) {
        this.stopped = true;
        this.everOnline = false;
        store(TOKEN_KEY, '', 'session');
        const playing = useNet.getState().battle === 'playing';
        useNet.setState({ status: 'error', error: '다른 창에서 같은 닉네임으로 접속하여 이 창의 연결이 끊어졌습니다.', room: null, quick: null, retry: null, battle: playing ? 'lost' : 'none', notice: playing ? '다른 창에서 이 자리를 이어받았습니다.' : null });
        return;
      }
      this.failed(!this.everOnline, quiet);
    };
  }

  /** The line is down: give up (never reached the server, or told to stop) or schedule the next attempt. */
  private failed(first: boolean, quiet: boolean) {
    if (this.stopped) {
      useNet.setState((s) => ({ status: s.status === 'error' ? 'error' : 'idle', retry: null }));
      return;
    }
    if (first) {
      this.stopped = true;
      useNet.setState({ status: quiet ? 'idle' : 'error', error: quiet ? null : '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주시기 바랍니다.', retry: null });
      return;
    }
    if (!this.lostAt) this.lostAt = performance.now();
    if (performance.now() - this.lostAt > GIVE_UP_MS) {
      this.giveUp();
      return;
    }
    const wait = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)]!;
    this.attempt += 1;
    const at = performance.now() + wait * 1000;
    useNet.setState({ status: 'reconnecting', retry: { in: wait, attempt: this.attempt } });
    window.clearInterval(this.countdown);
    this.countdown = window.setInterval(() => useNet.setState({ retry: { in: Math.max(0, Math.ceil((at - performance.now()) / 1000)), attempt: this.attempt } }), 250);
    this.retryTimer = window.setTimeout(() => this.open(), wait * 1000);
  }

  private giveUp() {
    this.stopped = true;
    this.everOnline = false;
    this.lostAt = 0;
    window.clearInterval(this.countdown);
    store(TOKEN_KEY, '', 'session');
    const playing = useNet.getState().battle === 'playing';
    useNet.setState({
      status: 'error',
      error: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주시기 바랍니다.',
      room: null,
      quick: null,
      rankedQueue: null,
      retry: null,
      battle: playing ? 'lost' : 'none',
      notice: playing ? '서버와의 연결이 끊어져 전투에서 물러났습니다.' : null,
    });
  }

  /** Tries again at once, from the retry button. */
  retryNow() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.stopped = false;
    this.attempt = 0;
    this.lostAt = 0;
    this.open();
  }

  disconnect() {
    this.stopped = true;
    this.everOnline = false;
    this.lostAt = 0;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.countdown);
    window.clearInterval(this.pingTimer);
    this.pingTimer = 0;
    store(TOKEN_KEY, '', 'session');
    this.ws?.close();
    this.ws = null;
    this.pendingStart = null;
    useNet.setState({ status: 'idle', room: null, quick: null, rankedQueue: null, retry: null, battle: 'none', rankedMatch: false, rankedMatchId: null, speed: NO_SPEED });
  }

  send(msg: ClientMsg) {
    // Leaving a room ends its battle for this player; the seat is not waiting for a return.
    if (msg.t === 'leave') {
      this.pendingStart = null;
      useNet.setState({ battle: 'none', rankedMatch: false, rankedMatchId: null, notice: null, speed: NO_SPEED });
    }
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    // Per-ship destinations grow with an uncapped fleet. Keep each command below the server's 64 KiB frame gate.
    if (msg.t === 'cmd' && msg.cmd.type === 'orders' && msg.cmd.list.length > 512) {
      for (let i = 0; i < msg.cmd.list.length; i += 512) this.ws.send(JSON.stringify({ t: 'cmd', cmd: { ...msg.cmd, list: msg.cmd.list.slice(i, i + 512) } }));
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }

  createRoom(name: string, battle: BattleChoice) {
    this.send({ t: 'create', name, battle });
  }

  ranked(faction: Faction) {
    if (useNet.getState().status !== 'online') return;
    useNet.setState({ error: null, rankResult: null });
    this.send({ t: 'ranked', faction });
  }

  rankedCancel() { this.send({ t: 'rankedCancel' }); }
  refreshRank() { this.send({ t: 'rankedProfile' }); }
  fetchLeaderboard() { this.send({ t: 'leaderboard' }); }

  /** Keep this private: whoever has the recovery code can use this ranked account. */
  exportAccount() { return this.account ? RECOVERY_PREFIX + this.account : ''; }

  restoreAccount(code: string): boolean {
    const value = code.trim().replace(/^imjin-rank-v1:/, '');
    if (!/^[a-f0-9]{64}$/i.test(value) || useNet.getState().battle === 'playing' || useNet.getState().rankedQueue) return false;
    this.send({ t: 'leave' });
    this.disconnect();
    this.account = value.toLowerCase();
    store(ACCOUNT_KEY, this.account, 'local');
    useNet.setState({ rankProfile: null, rankResult: null, leaderboard: [] });
    this.connect(useNet.getState().name);
    return true;
  }

  /** Only a rejected saved credential needs this escape hatch; ordinary disconnects keep the same account. */
  newAccount(): boolean {
    const state = useNet.getState();
    if (!state.identityRejected || state.battle === 'playing' || state.rankedQueue) return false;
    this.disconnect();
    this.account = '';
    store(ACCOUNT_KEY, '', 'local');
    useNet.setState({ identityRejected: false, rankProfile: null, rankResult: null, leaderboard: [] });
    this.connect(state.name);
    return true;
  }

  /** Back to the select screen after a battle is over or lost. */
  clearBattle() {
    this.pendingStart = null;
    useNet.setState({ battle: 'none', rankedMatch: false, rankedMatchId: null, notice: null, speed: NO_SPEED });
  }

  private receive(msg: ServerMsg) {
    switch (msg.t) {
      case 'welcome': {
        this.everOnline = true;
        this.lostAt = 0;
        this.attempt = 0;
        window.clearInterval(this.countdown);
        store(TOKEN_KEY, msg.token, 'session');
        // A storage outage on the server must never erase a valid saved account.
        if (msg.account) {
          this.account = msg.account.token;
          store(ACCOUNT_KEY, this.account, 'local');
        }
        const lostSeat = !msg.resumed && useNet.getState().battle === 'playing';
        useNet.setState((s) => ({
          status: 'online',
          id: msg.id,
          error: null,
          identityRejected: false,
          signedIn: !!msg.user,
          retry: null,
          room: msg.resumed ? s.room : null,
          quick: msg.resumed ? s.quick : null,
          rankedQueue: msg.resumed ? s.rankedQueue : null,
          rankProfile: msg.rank,
          rankResult: recoveredResult(msg.rank, s.rankedMatchId) ?? s.rankResult,
          battle: lostSeat ? 'lost' : s.battle,
          notice: lostSeat ? '연결이 오래 끊겨 자리를 잃고 전투에서 물러났습니다.' : s.notice,
        }));
        return;
      }
      case 'rooms':
        useNet.setState({ rooms: msg.rooms });
        return;
      case 'room':
        useNet.setState({ room: msg.room });
        return;
      case 'error':
        if (msg.code === 'version' || msg.code === 'identity') {
          this.stopped = true;
          store(TOKEN_KEY, '', 'session');
        }
        // The server no longer knows the session this line said hello with: the browser is signed out, and the line
        // already goes on without it.
        if (msg.code === 'session') {
          const ended = this.session;
          this.session = '';
          if (ended && savedSession()?.token === ended) saveSession(null);
        }
        useNet.setState({ error: msg.text, identityRejected: msg.code === 'identity', ...(['version', 'identity'].includes(msg.code ?? '') ? { status: 'error' as const, rankedQueue: null } : {}) });
        return;
      case 'rank':
        useNet.setState((s) => ({ rankProfile: msg.profile, rankResult: recoveredResult(msg.profile, s.rankedMatchId) ?? s.rankResult }));
        return;
      case 'leaderboard':
        useNet.setState({ leaderboard: msg.players });
        return;
      case 'ranked':
        useNet.setState({ rankedQueue: msg.state === 'searching' ? { since: msg.since, range: msg.range } : null });
        return;
      case 'rankedResult':
        useNet.setState({ rankProfile: msg.profile, rankResult: msg });
        return;
      case 'chat':
        {
          const system = msg.from === '알림';
          const text = msg.key ?? msg.text;
          useNet.setState((s) => ({ chat: [...s.chat.slice(-60), { from: msg.from, text, args: msg.args, system, at: Date.now() }] }));
          if (system && useNet.getState().battle === 'playing') pushToast(t(text, msg.args), 'info');
        }
        return;
      case 'pong':
        useNet.setState({ ping: Math.round(performance.now() - msg.at) });
        return;
      case 'quick':
        useNet.setState({ quick: msg.state === 'searching' ? { since: Date.now(), seconds: msg.seconds } : null });
        return;
      case 'closed':
        useNet.setState({ room: null, quick: null, rankedQueue: null, battle: useNet.getState().battle === 'playing' ? 'lost' : 'none', notice: msg.reason });
        return;
      case 'start':
        useNet.setState((s) => ({ quick: null, rankedQueue: null, rankedMatch: !!msg.ranked, rankedMatchId: msg.matchId ?? null, rankResult: msg.resume ? s.rankResult : null, notice: null }));
        // A page still drawing this battle only needed its seat back. A different seed is a new battle (a rematch).
        if (msg.resume && this.listener?.seed === msg.seed) {
          useNet.setState({ battle: 'playing' });
          return;
        }
        this.listener = null;
        useNet.setState({ battle: 'playing', speed: NO_SPEED });
        {
          const start: StartMsg = { ...msg, seats: msg.seats.map((seat) => ({ ...seat, name: seatName(seat.name) })) };
          if (this.starter) this.starter(start);
          else this.pendingStart = start;
        }
        return;
      case 'speed':
        useNet.setState({ speed: { speed: msg.speed, target: msg.target } });
        this.listener?.message(msg);
        return;
      case 'end':
        // A page that already left the battle (back to the lobby) has nothing to end.
        if (this.listener || useNet.getState().battle === 'playing') useNet.setState({ battle: 'ended' });
        this.listener?.message(msg);
        return;
      default:
        this.listener?.message(msg);
    }
  }
}

export const net = new NetClient();
net.resumeIfKnown();

// Test hook, like window.__engine: scripts/mp-browser.mjs closes the socket to rehearse a dropped line.
(window as unknown as { __net?: NetClient }).__net = net;
