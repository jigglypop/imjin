import { create } from 'zustand';
import { PROTOCOL, type ClientMsg, type RoomInfo, type RoomSummary, type ServerMsg } from './protocol';

/** Where the multiplayer server listens. A local dev server is used when the page itself is local. */
export const MP_URL: string =
  (import.meta.env.VITE_MP_URL as string | undefined) ?? (/^(127\.0\.0\.1|localhost)$/.test(location.hostname) ? 'ws://127.0.0.1:8787/ws' : 'wss://mp.imjin1592.com/ws');

type Status = 'idle' | 'connecting' | 'online' | 'error';
type ChatLine = { from: string; text: string; at: number };

type NetState = {
  status: Status;
  id: string;
  name: string;
  rooms: RoomSummary[];
  room: RoomInfo | null;
  chat: ChatLine[];
  error: string | null;
  ping: number;
};

const NAME_KEY = 'imjin.name';

function savedName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export const useNet = create<NetState>(() => ({ status: 'idle', id: '', name: savedName(), rooms: [], room: null, chat: [], error: null, ping: 0 }));

/** Battle traffic goes to whoever is listening: the networked battle of the running engine. */
export interface BattleListener {
  snapshot(buf: ArrayBuffer): void;
  message(msg: ServerMsg): void;
}

/** The connection to the multiplayer server: lobby state lives in useNet, battle traffic goes to the listener. */
class NetClient {
  private ws: WebSocket | null = null;
  private pingTimer = 0;
  listener: BattleListener | null = null;
  onStart: ((msg: Extract<ServerMsg, { t: 'start' }>) => void) | null = null;

  connect(name: string) {
    const clean = name.trim().slice(0, 16) || '무명';
    try {
      localStorage.setItem(NAME_KEY, clean);
    } catch {
      // the name lasts this session
    }
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
      this.send({ t: 'hello', name: clean, v: PROTOCOL });
      useNet.setState({ name: clean });
      return;
    }
    useNet.setState({ status: 'connecting', name: clean, error: null });
    const ws = new WebSocket(MP_URL);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.send({ t: 'hello', name: clean, v: PROTOCOL });
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping', at: performance.now() }), 3000);
    };
    ws.onmessage = (e) => {
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
    ws.onerror = () => useNet.setState({ status: 'error', error: '서버에 연결할 수 없습니다.' });
    ws.onclose = () => {
      window.clearInterval(this.pingTimer);
      if (this.ws === ws) this.ws = null;
      useNet.setState((s) => ({ status: s.status === 'error' ? 'error' : 'idle', room: null, error: s.error ?? (s.status === 'online' ? '서버와의 연결이 끊어졌습니다.' : null) }));
    };
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private receive(msg: ServerMsg) {
    switch (msg.t) {
      case 'welcome':
        useNet.setState({ status: 'online', id: msg.id, error: msg.v === PROTOCOL ? null : '게임 판이 서버와 다릅니다. 새로고침 해 주십시오.' });
        return;
      case 'rooms':
        useNet.setState({ rooms: msg.rooms });
        return;
      case 'room':
        useNet.setState({ room: msg.room });
        return;
      case 'error':
        useNet.setState({ error: msg.text });
        return;
      case 'chat':
        useNet.setState((s) => ({ chat: [...s.chat.slice(-60), { from: msg.from, text: msg.text, at: Date.now() }] }));
        return;
      case 'pong':
        useNet.setState({ ping: Math.round(performance.now() - msg.at) });
        return;
      case 'start':
        this.onStart?.(msg);
        return;
      default:
        this.listener?.message(msg);
    }
  }
}

export const net = new NetClient();
