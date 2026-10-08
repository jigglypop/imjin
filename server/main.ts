// Multiplayer server for conquest battles. Runs the same simulation as the browser and is the only one that does:
// clients send commands and draw the snapshots, events and conquest state it sends back.
//   npm run server            (bundled to server/dist/server.mjs, PORT defaults to 8787)
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { SIM_DT, type Battle } from '../src/sim/battle';
import { applyCommand, type Command } from '../src/sim/commands';
import type { Conquest } from '../src/sim/conquest';
import { autoFleet, buildConquest, CONQUEST_MAPS, type ConquestMapId, type Seat } from '../src/sim/maps';
import { FACTIONS, type BattleEvent, type Faction, type LandSampler, type Team } from '../src/sim/types';
import { generateHeightmap } from '../src/terrain/generate';
import { SEA_STATES, waveField } from '../src/ocean/waves';
import { encodeSnapshot, PROTOCOL, SENT_EVENTS, SNAPSHOT_HZ, type ClientMsg, type RoomInfo, type RoomSeat, type ServerMsg, type ShipMeta } from '../src/net/protocol';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_ROOMS = 40;
const STEPS_PER_SNAPSHOT = Math.round(1 / SIM_DT / SNAPSHOT_HZ);

type Client = { id: string; name: string; ws: WebSocket; room: Room | null; alive: boolean };
type Live = { battle: Battle; conquest: Conquest; time: number; steps: number; events: BattleEvent[]; known: Set<number>; squads: string; startedAt: number; endedAt: number };
type Room = { info: RoomInfo; clients: Set<Client>; live: Live | null };

const clients = new Map<string, Client>();
const rooms = new Map<string, Room>();
const lands = new Map<ConquestMapId, LandSampler>();

waveField.setState(SEA_STATES.moderate);

/** Heightmaps are generated once per map and kept. */
function landOf(map: ConquestMapId): LandSampler {
  let land = lands.get(map);
  if (land) return land;
  const spec = CONQUEST_MAPS[map].terrain;
  const h = generateHeightmap(spec);
  const { size, res } = spec;
  land = (sx, sz) => {
    const fx = ((sx + size / 2) / size) * res - 0.5;
    const fz = ((sz + size / 2) / size) * res - 0.5;
    const x0 = Math.max(0, Math.min(res - 2, Math.floor(fx)));
    const z0 = Math.max(0, Math.min(res - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - x0));
    const tz = Math.max(0, Math.min(1, fz - z0));
    const a = h[z0 * res + x0]!;
    const b = h[z0 * res + x0 + 1]!;
    const c = h[(z0 + 1) * res + x0]!;
    const d = h[(z0 + 1) * res + x0 + 1]!;
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  };
  lands.set(map, land);
  return land;
}

const send = (c: Client, msg: ServerMsg) => {
  if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
};
const sendBinary = (c: Client, buf: ArrayBuffer) => {
  if (c.ws.readyState === c.ws.OPEN) c.ws.send(buf, { binary: true });
};
const broadcast = (room: Room, msg: ServerMsg) => {
  const text = JSON.stringify(msg);
  for (const c of room.clients) if (c.ws.readyState === c.ws.OPEN) c.ws.send(text);
};

function code() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    const id = Array.from(randomBytes(4), (b) => letters[b % letters.length]).join('');
    if (!rooms.has(id)) return id;
  }
}

const clean = (text: unknown, max: number) => String(text ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

function summary() {
  return [...rooms.values()]
    .filter((r) => r.info.state !== 'ended')
    .map((r) => ({
      id: r.info.id,
      name: r.info.name,
      map: r.info.map,
      size: r.info.size,
      humans: r.info.seats.filter((s) => s.client).length,
      open: r.info.seats.filter((s) => s.human && !s.client).length,
      state: r.info.state,
    }));
}

function pushRoom(room: Room) {
  broadcast(room, { t: 'room', room: room.info });
}

function defaultSeats(size: 2 | 4): RoomSeat[] {
  const seats: RoomSeat[] = [
    { name: '서군', faction: 'joseon', team: 'joseon', human: true, client: null, ready: false },
    { name: '동군', faction: 'japan', team: 'japan', human: true, client: null, ready: false },
  ];
  if (size === 4) {
    seats.push({ name: '서군 우익', faction: 'ming', team: 'joseon', human: true, client: null, ready: false });
    seats.push({ name: '동군 우익', faction: 'japan', team: 'japan', human: true, client: null, ready: false });
  }
  return seats;
}

function leave(c: Client) {
  const room = c.room;
  if (!room) return;
  c.room = null;
  room.clients.delete(c);
  const seat = room.info.seats.findIndex((s) => s.client === c.id);
  if (seat >= 0) {
    const s = room.info.seats[seat]!;
    s.client = null;
    s.ready = false;
    // A player who drops out of a running battle hands the fleet to the computer.
    if (room.live) {
      room.live.conquest.setHuman(seat, false);
      room.live.battle.humans.delete(seat);
      broadcast(room, { t: 'chat', from: '알림', text: `${c.name} 이탈 — 컴퓨터가 함대를 맡는다` });
    }
  }
  if (!room.clients.size) {
    rooms.delete(room.info.id);
    return;
  }
  if (room.info.host === c.id) room.info.host = [...room.clients][0]!.id;
  pushRoom(room);
}

function start(room: Room) {
  const info = room.info;
  const seats: Seat[] = info.seats.map((s, i) => ({ name: s.client ? (clients.get(s.client)?.name ?? s.name) : s.human ? `빈 자리 ${i + 1}` : `컴퓨터 ${i + 1}`, faction: s.faction, team: s.team, human: !!s.client, fleet: autoFleet(s.faction) }));
  const seed = 1592 + Math.floor(Math.random() * 1e6);
  const { battle, conquest } = buildConquest(info.map, seats, landOf(info.map), seed);
  room.live = { battle, conquest, time: 0, steps: 0, events: [], known: new Set(), squads: '', startedAt: Date.now(), endedAt: 0 };
  info.state = 'battle';
  for (const c of room.clients) {
    const you = info.seats.findIndex((s) => s.client === c.id);
    send(c, { t: 'start', map: info.map, seats, you: Math.max(0, you), seed });
  }
  pushRoom(room);
}

function meta(room: Room, live: Live, all = false) {
  const ships: ShipMeta[] = [];
  for (const s of live.battle.ships) {
    if (!all && live.known.has(s.id)) continue;
    live.known.add(s.id);
    ships.push({ id: s.id, kind: s.spec.kind, name: s.name, squadron: s.squadronId, flagship: s.flagship, variant: s.variant, owner: s.owner, team: s.team });
  }
  const squads = JSON.stringify(live.battle.squadrons.map((q) => [q.id, q.shipIds.length, q.leaderId]));
  if (!ships.length && squads === live.squads) return;
  live.squads = squads;
  broadcast(room, { t: 'meta', ships, squadrons: live.battle.squadrons });
}

function tick(room: Room, dt: number) {
  const live = room.live;
  if (!live) return;
  live.time += dt;
  while (live.time >= SIM_DT && !live.endedAt) {
    live.time -= SIM_DT;
    live.battle.step(SIM_DT);
    waveField.time += SIM_DT;
    for (const e of live.battle.events) if (SENT_EVENTS.has(e.type)) live.events.push(e);
    live.battle.events.length = 0;
    live.steps += 1;
    if (live.steps % STEPS_PER_SNAPSHOT === 0) flush(room, live);
    if (live.battle.winner) {
      flush(room, live);
      live.endedAt = Date.now();
      room.info.state = 'ended';
      broadcast(room, { t: 'end', winner: live.battle.winner as Team });
      pushRoom(room);
    }
  }
}

function flush(room: Room, live: Live) {
  meta(room, live);
  // Small-arms casualties alone can run to hundreds a second in a big melee; the client needs only some.
  let casualties = 0;
  const events = live.events.filter((e) => e.type !== 'casualty' || (!e.melee && (casualties += 1) <= 40));
  live.events = [];
  if (events.length) broadcast(room, { t: 'events', events });
  for (const c of room.clients) {
    const seat = room.info.seats.findIndex((s) => s.client === c.id);
    sendBinary(c, encodeSnapshot(live.battle.time, live.battle.ships, seat, (s) => live.battle.isActive(s)));
  }
  if (live.steps % (STEPS_PER_SNAPSHOT * 3) === 0) broadcast(room, { t: 'state', conquest: live.conquest.state() });
}

function handle(c: Client, msg: ClientMsg) {
  const room = c.room;
  switch (msg.t) {
    case 'hello':
      c.name = clean(msg.name, 16) || '무명';
      if (msg.v !== PROTOCOL) send(c, { t: 'error', text: '게임 판이 서버와 다릅니다. 새로고침 해 주십시오.' });
      send(c, { t: 'rooms', rooms: summary() });
      return;
    case 'list':
      send(c, { t: 'rooms', rooms: summary() });
      return;
    case 'ping':
      send(c, { t: 'pong', at: msg.at });
      return;
    case 'create': {
      if (rooms.size >= MAX_ROOMS) return send(c, { t: 'error', text: '방이 가득 찼습니다.' });
      leave(c);
      const map = CONQUEST_MAPS[msg.map] ? msg.map : 'hallyeo';
      const size = msg.size === 4 && CONQUEST_MAPS[map].seats >= 4 ? 4 : 2;
      const info: RoomInfo = { id: code(), name: clean(msg.name, 24) || `${c.name}의 방`, map, size, host: c.id, state: 'lobby', seats: defaultSeats(size) };
      const r: Room = { info, clients: new Set([c]), live: null };
      info.seats[0]!.client = c.id;
      rooms.set(info.id, r);
      c.room = r;
      pushRoom(r);
      return;
    }
    case 'join': {
      const r = rooms.get(clean(msg.room, 8).toUpperCase());
      if (!r || r.info.state !== 'lobby') return send(c, { t: 'error', text: '그 방에 들어갈 수 없습니다.' });
      leave(c);
      r.clients.add(c);
      c.room = r;
      const free = r.info.seats.find((s) => s.human && !s.client);
      if (free) free.client = c.id;
      pushRoom(r);
      return;
    }
    case 'leave':
      leave(c);
      send(c, { t: 'room', room: null });
      send(c, { t: 'rooms', rooms: summary() });
      return;
    case 'take': {
      if (!room || room.info.state !== 'lobby') return;
      const seat = room.info.seats[msg.index];
      if (!seat || !seat.human || seat.client) return;
      for (const s of room.info.seats) if (s.client === c.id) {
        s.client = null;
        s.ready = false;
      }
      seat.client = c.id;
      pushRoom(room);
      return;
    }
    case 'seat': {
      if (!room || room.info.state !== 'lobby') return;
      const seat = room.info.seats[msg.index];
      if (!seat) return;
      const mine = seat.client === c.id;
      const host = room.info.host === c.id;
      if (!mine && !(host && !seat.client)) return;
      if (msg.faction && FACTIONS.includes(msg.faction as Faction)) seat.faction = msg.faction as Faction;
      if (typeof msg.human === 'boolean' && host && !seat.client) seat.human = msg.human;
      for (const s of room.info.seats) s.ready = s.client === room.info.host ? s.ready : false;
      pushRoom(room);
      return;
    }
    case 'ready': {
      if (!room) return;
      const seat = room.info.seats.find((s) => s.client === c.id);
      if (seat) seat.ready = !!msg.ready;
      pushRoom(room);
      return;
    }
    case 'start': {
      if (!room || room.info.host !== c.id || room.info.state !== 'lobby') return;
      const waiting = room.info.seats.filter((s) => s.client && s.client !== c.id && !s.ready);
      if (waiting.length) return send(c, { t: 'error', text: '아직 준비하지 않은 사람이 있습니다.' });
      if (!room.info.seats.some((s) => s.client && s.team === 'joseon') && !room.info.seats.some((s) => s.client && s.team === 'japan')) return;
      // Seats nobody took are played by the computer.
      for (const s of room.info.seats) if (!s.client) s.human = false;
      start(room);
      return;
    }
    case 'cmd': {
      const live = room?.live;
      if (!live || live.endedAt) return;
      const seat = room!.info.seats.findIndex((s) => s.client === c.id);
      if (seat < 0) return;
      try {
        applyCommand(live.battle, seat, msg.cmd as Command, live.conquest);
      } catch (err) {
        console.warn('bad command', err);
      }
      return;
    }
    case 'chat': {
      if (!room) return;
      const text = clean(msg.text, 120);
      if (text) broadcast(room, { t: 'chat', from: c.name, text });
      return;
    }
    default:
      return;
  }
}

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, protocol: PROTOCOL, rooms: rooms.size, clients: clients.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', (ws) => {
  const c: Client = { id: randomBytes(6).toString('hex'), name: '무명', ws, room: null, alive: true };
  clients.set(c.id, c);
  send(c, { t: 'welcome', id: c.id, v: PROTOCOL });
  ws.on('pong', () => {
    c.alive = true;
  });
  ws.on('message', (data, binary) => {
    if (binary) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data)) as ClientMsg;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    handle(c, msg);
  });
  ws.on('close', () => {
    leave(c);
    clients.delete(c.id);
  });
});

// Dead connections are dropped after a missed heartbeat.
setInterval(() => {
  for (const c of clients.values()) {
    if (!c.alive) {
      c.ws.terminate();
      continue;
    }
    c.alive = false;
    c.ws.ping();
  }
}, 15000);

let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  for (const room of rooms.values()) {
    tick(room, dt);
    if (room.live?.endedAt && Date.now() - room.live.endedAt > 60000) {
      for (const c of room.clients) c.room = null;
      rooms.delete(room.info.id);
    }
  }
}, 1000 / 60);

// Warm the heightmaps so the first battle on each map starts at once.
for (const id of Object.keys(CONQUEST_MAPS) as ConquestMapId[]) landOf(id);
http.listen(PORT, () => console.log(`imjin server on :${PORT}, protocol ${PROTOCOL}`));
