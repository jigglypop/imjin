import { create } from 'zustand';
import { pushToast } from '../state/store';
import { GRACE_SECONDS, PROTOCOL, type BattleChoice, type ClientMsg, type RoomInfo, type RoomSummary, type ServerMsg } from './protocol';

/** Where the multiplayer server listens. A local dev server is used when the page itself is local. */
export const MP_URL: string =
  (import.meta.env.VITE_MP_URL as string | undefined) ?? (/^(127\.0\.0\.1|localhost)$/.test(location.hostname) ? 'ws://127.0.0.1:8787/ws' : 'wss://mp.imjin1592.com/ws');

/** idle: not connected; connecting: first attempt; online; reconnecting: the line dropped and we keep trying; error: gave up. */
type Status = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'error';
type ChatLine = { from: string; text: string; at: number };
/** none: no online battle; playing; ended: the result is out (rematch possible); lost: the seat could not be recovered. */
type BattlePhase = 'none' | 'playing' | 'ended' | 'lost';

type NetState = {
  status: Status;
  id: string;
  name: string;
  rooms: RoomSummary[];
  room: RoomInfo | null;
  chat: ChatLine[];
  error: string | null;
  ping: number;
  /** Quick match: when the search began (client clock) and how long it waits for a person. */
  quick: { since: number; seconds: number } | null;
  battle: BattlePhase;
  /** Server pace in the running battle: what it manages and what it asks for (the approach is skipped fast). */
  speed: { speed: number; target: number };
  /** Seconds until the next reconnect attempt, and which attempt it is. */
  retry: { in: number; attempt: number } | null;
  /** Set when the server closed the room or the seat was lost. */
  notice: string | null;
};

const NAME_KEY = 'imjin.name';
const TOKEN_KEY = 'imjin.session';
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

const NO_SPEED = { speed: 1, target: 1 };
export const useNet = create<NetState>(() => ({
  status: 'idle',
  id: '',
  name: stored(NAME_KEY, 'local'),
  rooms: [],
  room: null,
  chat: [],
  error: null,
  ping: 0,
  quick: null,
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

/**
 * The connection to the multiplayer server: lobby state lives in useNet, battle traffic goes to the listener.
 * The session token (kept per tab) lets a dropped line, or a reloaded page, take its seat back.
 */
class NetClient {
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
    const clean = name.trim().slice(0, 16) || '무명';
    store(NAME_KEY, clean, 'local');
    useNet.setState({ name: clean });
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
      this.send({ t: 'hello', name: clean, v: PROTOCOL });
      return;
    }
    this.stopped = false;
    this.attempt = 0;
    this.open(quiet);
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
      this.lastHeard = performance.now();
      this.send({ t: 'hello', name: useNet.getState().name, v: PROTOCOL, token: stored(TOKEN_KEY, 'session') || undefined });
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        // A line that has gone quiet without closing is cut so the reconnect can start.
        if (performance.now() - this.lastHeard > STALE_MS) ws.close();
        else this.send({ t: 'ping', at: performance.now() });
      }, 3000);
    };
    ws.onmessage = (e) => {
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
      window.clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      // Another window took this seat over (a duplicated tab shares the token); fighting back would never end.
      if (e.code === REPLACED) {
        this.stopped = true;
        this.everOnline = false;
        store(TOKEN_KEY, '', 'session');
        const playing = useNet.getState().battle === 'playing';
        useNet.setState({ status: 'error', error: '다른 창에서 같은 닉네임으로 접속해 이 창의 연결을 끊었습니다.', room: null, quick: null, retry: null, battle: playing ? 'lost' : 'none', notice: playing ? '다른 창에서 이 자리를 이어받았습니다.' : null });
        return;
      }
      this.failed(!this.everOnline, quiet);
    };
  }

  /** The line is down: give up (never reached the server, or told to stop) or schedule the next attempt. */
  private failed(first: boolean, quiet: boolean) {
    if (this.stopped) {
      useNet.setState({ status: 'idle', retry: null });
      return;
    }
    if (first) {
      this.stopped = true;
      useNet.setState({ status: quiet ? 'idle' : 'error', error: quiet ? null : '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.', retry: null });
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
      error: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      room: null,
      quick: null,
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
    store(TOKEN_KEY, '', 'session');
    this.ws?.close();
    this.ws = null;
    useNet.setState({ status: 'idle', room: null, quick: null, retry: null, battle: 'none', speed: NO_SPEED });
  }

  send(msg: ClientMsg) {
    // Leaving a room ends its battle for this player; the seat is not waiting for a return.
    if (msg.t === 'leave') useNet.setState({ battle: 'none', notice: null, speed: NO_SPEED });
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  createRoom(name: string, battle: BattleChoice) {
    this.send({ t: 'create', name, battle });
  }

  /** Back to the select screen after a battle is over or lost. */
  clearBattle() {
    useNet.setState({ battle: 'none', notice: null, speed: NO_SPEED });
  }

  private receive(msg: ServerMsg) {
    switch (msg.t) {
      case 'welcome': {
        this.everOnline = true;
        this.lostAt = 0;
        this.attempt = 0;
        window.clearInterval(this.countdown);
        store(TOKEN_KEY, msg.token, 'session');
        const lostSeat = !msg.resumed && useNet.getState().battle === 'playing';
        useNet.setState((s) => ({
          status: 'online',
          id: msg.id,
          error: null,
          retry: null,
          room: msg.resumed ? s.room : null,
          quick: msg.resumed ? s.quick : null,
          battle: lostSeat ? 'lost' : s.battle,
          notice: lostSeat ? '자리를 지키지 못해 전투에서 물러났습니다.' : s.notice,
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
        if (msg.code === 'version') {
          this.stopped = true;
          store(TOKEN_KEY, '', 'session');
        }
        useNet.setState({ error: msg.text, ...(msg.code === 'version' ? { status: 'error' as const } : {}) });
        return;
      case 'chat':
        useNet.setState((s) => ({ chat: [...s.chat.slice(-60), { from: msg.from, text: msg.text, at: Date.now() }] }));
        if (msg.from === '알림' && useNet.getState().battle === 'playing') pushToast(msg.text, 'info');
        return;
      case 'pong':
        useNet.setState({ ping: Math.round(performance.now() - msg.at) });
        return;
      case 'quick':
        useNet.setState({ quick: msg.state === 'searching' ? { since: Date.now(), seconds: msg.seconds } : null });
        return;
      case 'closed':
        useNet.setState({ room: null, quick: null, battle: useNet.getState().battle === 'playing' ? 'lost' : 'none', notice: msg.reason });
        return;
      case 'start':
        useNet.setState({ quick: null, notice: null });
        // A page still drawing this battle only needed its seat back. A different seed is a new battle (a rematch).
        if (msg.resume && this.listener?.seed === msg.seed) {
          useNet.setState({ battle: 'playing' });
          return;
        }
        this.listener = null;
        useNet.setState({ battle: 'playing', speed: NO_SPEED });
        if (this.starter) this.starter(msg);
        else this.pendingStart = msg;
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
