// Multiplayer server. Runs the same simulation as the browser and is the only one that does: clients send commands
// and draw the snapshots, events and conquest state it sends back.
//   npm run server            (bundled to server/dist/server.cjs, PORT defaults to 8787)
// Rooms fight a conquest map or a historical scenario as a duel. Quick match pairs players or fills with the
// computer. A dropped player keeps their seat for GRACE_SECONDS (session token), and the approach to the first
// contact is skipped at FF_SPEED.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { isMainThread } from 'node:worker_threads';
import { WebSocketServer, type WebSocket } from 'ws';
import { SIM_DT, type Battle } from '../src/sim/battle';
import { applyCommand, type Command } from '../src/sim/commands';
import type { Conquest } from '../src/sim/conquest';
import { CONQUEST_MAPS, CONQUEST_ORDER, type Seat } from '../src/sim/maps';
import { SCENARIO_ORDER, SCENARIOS } from '../src/sim/scenarios';
import { FACTIONS, teamOf, type BattleEvent, type Faction, type Team } from '../src/sim/types';
import {
  encodeSnapshot,
  GRACE_SECONDS,
  PROTOCOL,
  QUICK_SECONDS,
  SENT_EVENTS,
  SNAPSHOT_HZ,
  type BattleChoice,
  type ClientMsg,
  type RoomInfo,
  type ServerMsg,
  type RankReason,
} from '../src/net/protocol';
import { buildBattle, choiceKey, inContact, openSeats, sanitizeChoice, terrainOf, titleOf } from './battles';
import { loadLand, terrainWorker } from './terrain';
import { clientMessage } from './messages';
import { RankedStore, rankRange, type RankMatch } from './ranked';
import { observedEvent, observedMetadata, observedShips, observedState } from './observation';

/** Set by build-server.mjs, so health identifies the bundle actually running. */
declare const IMJIN_BUILD_REVISION: string;
const BUILD_REVISION = IMJIN_BUILD_REVISION;

const PORT = Number(process.env.PORT ?? 8787);
const MAX_ROOMS = 40;
const MAX_CLIENTS = 400;
const STEPS_PER_SNAPSHOT = Math.round(1 / SIM_DT / SNAPSHOT_HZ);
/** The approach to the first contact is skipped at this multiple of real time. The sim stops short of it when a tick runs out of budget. */
const FF_SPEED = Number(process.env.FF_SPEED ?? 32);
/** CPU one fast-forwarding room may use in a 60 Hz tick (ms), and all of them together, so skipping ahead never starves the other rooms. */
const FF_SLICE_MS = Number(process.env.FF_SLICE_MS ?? 6);
const FF_TOTAL_MS = Number(process.env.FF_TOTAL_MS ?? 10);
/** Pace of a battle after the approach. Only tests change it. */
const BASE_SPEED = Number(process.env.BASE_SPEED ?? 1);
const ENDED_ROOM_SECONDS = 600;
/** Browsers send their page's origin with a WebSocket; only the game's own pages (and local or LAN ones) may connect. Other clients send none. */
const ORIGINS = ['https://imjin1592.com', 'https://www.imjin1592.com', ...(process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean)];
const originAllowed = (origin: string | undefined) => !origin || ORIGINS.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin);
/** Pages take a while to load a battle; the clock waits for them this long. */
const LOAD_SECONDS = 45;
// Tests can shorten lifecycle deadlines without changing the production protocol's 60-second grace.
const DISCONNECT_SECONDS = Number(process.env.GRACE_SECONDS ?? GRACE_SECONDS);
const PAGE_LOAD_SECONDS = Number(process.env.LOAD_SECONDS ?? LOAD_SECONDS);
const speedOf = (live: Live) => (live.ff ? FF_SPEED : BASE_SPEED);

type Client = {
  id: string;
  token: string;
  name: string;
  ws: WebSocket | null;
  room: Room | null;
  alive: boolean;
  grace: ReturnType<typeof setTimeout> | null;
  /** Message budget of the connection (leaky bucket). */
  budget: number;
  budgetAt: number;
  account: { id: string; token: string } | null;
};
type Live = {
  battle: Battle;
  conquest: Conquest | null;
  seats: Seat[];
  seed: number;
  /** Simulated seconds owed. */
  time: number;
  steps: number;
  flushes: number;
  lastFlush: number;
  events: BattleEvent[];
  observed: Map<string, { known: Map<number, string>; squads: string }>;
  endedAt: number;
  /** The approach is being skipped. */
  ff: boolean;
  contactTimer: number;
  /** Seats whose page is still loading the battle. The clock starts when it is empty, or at `deadline`. */
  waiting: Set<string>;
  deadline: number;
  /** The clock has not started yet; set until `waiting` empties. */
  held: boolean;
  /** Measured pace: simulated seconds and real seconds since the last report. */
  paceSim: number;
  paceReal: number;
};
type Room = { info: RoomInfo; clients: Set<Client>; live: Live | null; building: boolean; ranked?: { match: RankMatch; clients: [Client, Client]; settled: boolean } };
type Quick = { c: Client; choice: BattleChoice; faction: Faction; since: number };
type RankedEntry = { c: Client; faction: Faction; since: number };

const byToken = new Map<string, Client>();
const byId = new Map<string, Client>();
const rooms = new Map<string, Room>();
const queue: Quick[] = [];
const rankedQueue: RankedEntry[] = [];
let ranked: RankedStore | null = null;
const accountCreation = new Map<string, { since: number; count: number }>();
let tickMs = 0;

const send = (c: Client, msg: ServerMsg) => {
  if (c.ws && c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
};
const sendBinary = (c: Client, buf: ArrayBuffer) => {
  if (c.ws && c.ws.readyState === c.ws.OPEN) c.ws.send(buf, { binary: true });
};
const broadcast = (room: Room, msg: ServerMsg) => {
  const text = JSON.stringify(msg);
  for (const c of room.clients) if (c.ws && c.ws.readyState === c.ws.OPEN) c.ws.send(text);
};
/**
 * A system line in the room's chat. `text` is the finished Korean sentence (what an older client shows); `key` is the
 * template and `args` its values, so a client in another language can translate the template and fill it itself.
 */
const notice = (room: Room, key: string, args?: Record<string, string | number>) => {
  const text = args ? key.replace(/\{(\w+)\}/g, (whole, name: string) => String(args[name] ?? whole)) : key;
  broadcast(room, { t: 'chat', from: '알림', text, ...(args ? { key, args } : {}) });
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
    .filter((r) => r.info.state !== 'ended' && !r.info.quick && !r.info.ranked)
    .map((r) => ({
      id: r.info.id,
      name: r.info.name,
      battle: r.info.battle,
      size: r.info.seats.length,
      humans: r.info.seats.filter((s) => s.client).length,
      open: r.info.seats.filter((s) => s.human && !s.client).length,
      state: r.info.state,
    }));
}

/** The room as clients see it, with the names of whoever sits in each seat. */
function roomInfo(room: Room): RoomInfo {
  for (const s of room.info.seats) s.player = (s.client && byId.get(s.client)?.name) || '';
  return room.info;
}
const pushRoom = (room: Room) => broadcast(room, { t: 'room', room: roomInfo(room) });

function leave(c: Client) {
  const room = c.room;
  if (!room) return;
  if (room.ranked && !room.ranked.settled) {
    const index = room.ranked.clients.indexOf(c);
    if (index >= 0) finishRanked(room, (1 - index) as 0 | 1, 'forfeit');
  }
  c.room = null;
  room.clients.delete(c);
  const i = room.info.seats.findIndex((s) => s.client === c.id);
  if (i >= 0) {
    const s = room.info.seats[i]!;
    s.client = null;
    s.ready = false;
    s.away = false;
    s.rematch = false;
    // A player who drops out of a running battle hands the fleet to the computer.
    room.live?.waiting.delete(c.id);
    if (room.live && !room.live.endedAt) {
      room.live.conquest?.setHuman(i, false);
      room.live.battle.humans.delete(i);
      notice(room, '{name}님이 전투에서 이탈했습니다. 컴퓨터가 함대를 맡습니다.', { name: c.name });
    }
  }
  if (!room.clients.size) {
    rooms.delete(room.info.id);
    return;
  }
  if (room.info.host === c.id) room.info.host = [...room.clients].find((o) => o.ws)?.id ?? [...room.clients][0]!.id;
  pushRoom(room);
}

/** A client that is gone for good: seat released, session forgotten. */
function drop(c: Client) {
  if (c.grace) clearTimeout(c.grace);
  c.grace = null;
  dequeue(c);
  if (c.room?.ranked && !c.room.ranked.settled) {
    const index = c.room.ranked.clients.indexOf(c);
    if (index >= 0) finishRanked(c.room, (1 - index) as 0 | 1, 'disconnect');
  }
  leave(c);
  byToken.delete(c.token);
  byId.delete(c.id);
}

function dequeue(c: Client) {
  const i = queue.findIndex((q) => q.c === c);
  if (i >= 0) queue.splice(i, 1);
  const ri = rankedQueue.findIndex((q) => q.c === c);
  if (ri >= 0) {
    rankedQueue.splice(ri, 1);
    send(c, { t: 'ranked', state: 'idle', since: 0, range: 0 });
  }
}

function finishRanked(room: Room, outcome: 0 | 1 | 'draw' | 'void', reason: RankReason) {
  const context = room.ranked;
  if (!context || context.settled) return;
  try {
    const results = ranked?.finish(context.match.id, outcome, reason);
    if (!results) throw new Error('ranked result could not be committed');
    for (const [index, message] of results.entries()) {
      const accountId = context.match.players[index]!.id;
      for (const c of byId.values()) if (c.account?.id === accountId) send(c, message);
    }
  } catch (error) {
    console.error('ranked result storage failed', error instanceof Error ? error.message : 'unknown error');
    broadcast(room, { t: 'error', code: 'ranked', text: '랭크 기록을 저장하지 못했습니다. 잠시 후 전적을 다시 확인해 주세요.' });
    outcome = 'void';
  }
  context.settled = true;
  const live = room.live;
  const winner = outcome === 0 ? 'joseon' : outcome === 1 ? 'japan' : null;
  if (live) {
    live.endedAt = Date.now();
    live.battle.winner = winner;
    live.battle.draw = winner === null;
    live.ff = false;
  }
  room.info.state = 'ended';
  broadcast(room, { t: 'end', winner, draw: winner === null });
  pushRoom(room);
}

function rankJoin(c: Client, faction: Faction) {
  if (!ranked?.ready || !c.account) return send(c, { t: 'error', code: 'ranked', text: '랭크 대전을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.' });
  const id = c.account.id;
  if (ranked.activeMatch(id) || rankedQueue.some((q) => q.c.account?.id === id)) return send(c, { t: 'error', code: 'ranked', text: '이 계정은 이미 랭크 대전을 진행하거나 찾고 있습니다.' });
  if (c.room?.ranked && !c.room.ranked.settled) return;
  leave(c);
  dequeue(c);
  const since = Date.now();
  rankedQueue.push({ c, faction, since });
  send(c, { t: 'ranked', state: 'searching', since, range: rankRange(0) });
  matchRanked();
}

function matchRanked() {
  if (!ranked?.ready) {
    for (const q of [...rankedQueue]) {
      dequeue(q.c);
      send(q.c, { t: 'error', code: 'ranked', text: '랭크 대전을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.' });
    }
    return;
  }
  const now = Date.now();
  for (const q of [...rankedQueue]) {
    if (!rankedQueue.includes(q) || !q.c.ws || !q.c.account) continue;
    const rating = ranked.profile(q.c.account.id)?.rating;
    if (rating === undefined) continue;
    const range = rankRange(now - q.since);
    send(q.c, { t: 'ranked', state: 'searching', since: q.since, range });
    if (rooms.size >= MAX_ROOMS) continue;
    const candidates = rankedQueue.filter((r) => r !== q && r.c.ws && r.c.account && ranked!.canPair(q.c.account!.id, r.c.account.id, now) && Math.abs(ranked!.profile(r.c.account.id)!.rating - rating) <= Math.min(range, rankRange(now - r.since)));
    candidates.sort((a, b) => Math.abs(ranked!.profile(a.c.account!.id)!.rating - rating) - Math.abs(ranked!.profile(b.c.account!.id)!.rating - rating) || a.since - b.since);
    const mate = candidates[0];
    if (!mate) continue;
    const entries: [RankedEntry, RankedEntry] = randomBytes(1)[0]! & 1 ? [q, mate] : [mate, q];
    let match: RankMatch;
    try { match = ranked.begin(entries.map((e) => ({ id: e.c.account!.id, faction: e.faction })) as RankMatch['players'], now, BUILD_REVISION); }
    catch (error) { console.error('ranked match storage failed', error instanceof Error ? error.message : 'unknown error'); continue; }
    for (const entry of entries) dequeue(entry.c);
    const [a, b] = entries;
    const room = newRoom(a.c, '랭크 대전', { kind: 'conquest', map: 'hallyeo', size: 2 }, false);
    room.info.ranked = true;
    room.ranked = { match, clients: [a.c, b.c], settled: false };
    room.clients.add(b.c);
    b.c.room = room;
    for (const [i, entry] of entries.entries()) {
      const seat = room.info.seats[i]!;
      seat.client = entry.c.id;
      seat.faction = entry.faction;
      seat.human = true;
      seat.ready = true;
    }
    pushRoom(room);
    void start(room);
  }
}

function sendStart(c: Client, room: Room, resume: boolean) {
  const live = room.live;
  if (!live) return;
  const you = room.info.seats.findIndex((s) => s.client === c.id);
  send(c, { t: 'start', battle: room.info.battle, seats: live.seats, you: Math.max(0, you), seed: live.seed, resume, ...(room.ranked ? { ranked: true, matchId: room.ranked.match.id } : {}) });
}

async function start(room: Room) {
  const info = room.info;
  if (room.building || room.live) return;
  room.building = true;
  try {
    const land = await loadLand(terrainOf(info.battle));
    if (rooms.get(info.id) !== room || room.ranked?.settled) return;
    // Seats nobody took are played by the computer.
    for (const s of info.seats) if (!s.client) s.human = false;
    const names = info.seats.map((s, i) => (s.client ? (byId.get(s.client)?.name ?? s.name) : `컴퓨터 ${i + 1}`));
    const seed = room.ranked?.match.seed ?? 1592 + Math.floor(Math.random() * 1e6);
    const built = buildBattle(info.battle, land, info.seats, names, info.seats.map((s) => !!s.client), seed, !!room.ranked);
    const live: Live = {
      battle: built.battle,
      conquest: built.conquest,
      seats: built.seats,
      seed,
      time: 0,
      steps: 0,
      flushes: 0,
      lastFlush: 0,
      events: [],
      observed: new Map(),
      endedAt: 0,
      ff: FF_SPEED > 1,
      contactTimer: 0.5,
      waiting: new Set(info.seats.flatMap((x) => (x.client && byId.get(x.client)?.ws ? [x.client] : []))),
      deadline: Date.now() + PAGE_LOAD_SECONDS * 1000,
      held: true,
      paceSim: 0,
      paceReal: 0,
    };
    room.live = live;
    info.state = 'battle';
    for (const s of info.seats) {
      s.ready = false;
      s.rematch = false;
    }
    for (const c of room.clients) sendStart(c, room, false);
    pushRoom(room);
    sendSpeed(room, live);
  } catch (err) {
    console.error('start failed', err);
    if (room.ranked) finishRanked(room, 'void', 'server-error');
    broadcast(room, { t: 'error', text: '전장을 준비하지 못했습니다. 잠시 후 다시 시도해 주시기 바랍니다.' });
  } finally {
    room.building = false;
  }
}

function metaMsg(live: Live, all: boolean, client: Client, room: Room): ServerMsg | null {
  const seat = room.info.seats.findIndex((s) => s.client === client.id);
  const team = room.info.seats[seat]?.team;
  if (!team) return null;
  let view = live.observed.get(client.id);
  if (!view) { view = { known: new Map(), squads: '' }; live.observed.set(client.id, view); }
  const observed = observedShips(live.battle, team);
  const visibleIds = new Set(observed.map((s) => s.id));
  const ships = observedMetadata(live.battle, team, view.known, all);
  const squadrons = live.battle.squadrons.map((q) => ({ ...q, shipIds: q.shipIds.filter((id) => visibleIds.has(id)), leaderId: visibleIds.has(q.leaderId) ? q.leaderId : 0 })).filter((q) => q.shipIds.length > 0);
  const squads = JSON.stringify(squadrons.map((q) => [q.id, q.shipIds, q.leaderId]));
  if (!all && !ships.length && squads === view.squads) return null;
  view.squads = squads;
  return { t: 'meta', ships, squadrons };
}

/** Whether the battle clock is held back for pages still loading. */
function holding(live: Live) {
  if (live.waiting.size && Date.now() < live.deadline) return true;
  return false;
}

function sendSpeed(room: Room, live: Live) {
  if (holding(live)) {
    broadcast(room, { t: 'speed', speed: 0, target: 0 });
    return;
  }
  const target = speedOf(live);
  const eff = live.paceReal > 0 ? live.paceSim / live.paceReal : target;
  broadcast(room, { t: 'speed', speed: target > 1 ? Math.max(1, Math.round(eff)) : 1, target });
  live.paceSim = 0;
  live.paceReal = 0;
}

/** Brings a returning client back into the battle its seat is in. */
function resume(c: Client) {
  const room = c.room;
  if (!room) return;
  send(c, { t: 'room', room: roomInfo(room) });
  if (room.ranked?.settled && c.account) {
    const result = ranked?.result(room.ranked.match.id, c.account.id);
    if (result) send(c, result);
  }
  const live = room.live;
  if (!live) return;
  // A finished battle is not replayed: a page still on it learns the result, one in the lobby stays there.
  if (live.endedAt) {
    if (live.battle.ended) send(c, { t: 'end', winner: live.battle.winner as Team | null, draw: live.battle.draw });
    return;
  }
  sendStart(c, room, true);
  const meta = metaMsg(live, true, c, room);
  if (meta) send(c, meta);
  if (live.conquest) { const team = room.info.seats.find((s) => s.client === c.id)?.team; if (team) send(c, { t: 'state', conquest: observedState(live.conquest, live.battle, team) }); }
  send(c, holding(live) ? { t: 'speed', speed: 0, target: 0 } : { t: 'speed', speed: speedOf(live), target: speedOf(live) });
}

function stepOnce(room: Room, live: Live) {
  live.battle.step(SIM_DT);
  if (live.ff && live.battle.events.some((e) => e.type === 'gun' || e.type === 'shot')) {
    live.ff = false;
    live.time = Math.min(live.time, SIM_DT);
    sendSpeed(room, live);
  }
  for (const e of live.battle.events) if (SENT_EVENTS.has(e.type)) live.events.push(e);
  live.battle.events.length = 0;
  live.steps += 1;
  live.paceSim += SIM_DT;
  if (speedOf(live) === 1 && live.steps % STEPS_PER_SNAPSHOT === 0) flush(room, live);
  if (live.battle.ended) {
    flush(room, live);
    if (room.ranked) {
      finishRanked(room, live.battle.draw ? 'draw' : live.battle.winner === 'joseon' ? 0 : 1, 'battle');
      return;
    }
    live.endedAt = Date.now();
    room.info.state = 'ended';
    if (live.ff) {
      live.ff = false;
      sendSpeed(room, live);
    }
    broadcast(room, { t: 'end', winner: live.battle.winner as Team | null, draw: live.battle.draw });
    pushRoom(room);
  }
}

function tick(room: Room, dt: number, slice: number) {
  const live = room.live;
  if (!live || live.endedAt) return;
  if (live.held) {
    if (room.ranked && live.waiting.size && Date.now() >= live.deadline) {
      finishRanked(room, 'void', 'load-timeout');
      return;
    }
    if (holding(live)) return;
    live.held = false;
    sendSpeed(room, live);
  }
  const speed = speedOf(live);
  if (speed > 1) live.paceReal += dt;
  if (live.ff) {
    live.contactTimer -= dt;
    if (live.contactTimer <= 0) {
      live.contactTimer = 0.25;
      if (live.steps > 0 && inContact(live.battle)) {
        live.ff = false;
        sendSpeed(room, live);
      }
    }
  }
  if (speed > 1 && live.paceReal >= 1) sendSpeed(room, live);
  live.time += dt * speedOf(live);
  const t0 = performance.now();
  while (live.time >= SIM_DT && !live.endedAt) {
    live.time -= SIM_DT;
    stepOnce(room, live);
    if (speedOf(live) > 1 && performance.now() - t0 > slice) break;
  }
  // A room that cannot keep up with the asked pace runs slower instead of building a backlog.
  if (speedOf(live) > 1 && live.time > SIM_DT) live.time = SIM_DT;
  if (speedOf(live) > 1 && !live.endedAt && t0 - live.lastFlush >= 1000 / SNAPSHOT_HZ) flush(room, live);
}

function flush(room: Room, live: Live) {
  live.lastFlush = performance.now();
  live.flushes += 1;
  // Small-arms casualties alone can run to hundreds a second in a big melee; the client needs only some.
  let casualties = 0;
  const events = live.events.filter((e) => e.type !== 'casualty' || (!e.melee && (casualties += 1) <= 40));
  live.events = [];
  for (const c of room.clients) {
    const seat = room.info.seats.findIndex((s) => s.client === c.id);
    const team = room.info.seats[seat]?.team;
    if (!team) continue;
    const meta = metaMsg(live, false, c, room);
    if (meta) send(c, meta);
    const seenEvents = events.filter((e) => observedEvent(e, live.battle, live.conquest, team));
    if (seenEvents.length) send(c, { t: 'events', events: seenEvents });
    sendBinary(c, encodeSnapshot(live.battle.time, observedShips(live.battle, team), seat, (s) => live.battle.isActive(s)));
    if (live.conquest && live.flushes % 3 === 0) send(c, { t: 'state', conquest: observedState(live.conquest, live.battle, team) });
  }
}

function newRoom(c: Client, name: string, choice: BattleChoice, quick: boolean): Room {
  const info: RoomInfo = { id: code(), name, battle: choice, host: c.id, state: 'lobby', quick, seats: openSeats(choice) };
  const room: Room = { info, clients: new Set([c]), live: null, building: false };
  rooms.set(info.id, room);
  c.room = room;
  return room;
}

/** Puts two people (or one, with the computer opposite) into a room that starts at once. */
function matchRoom(entries: Quick[]) {
  const choice = entries[0]!.choice;
  const first = entries[0]!.c;
  const room = newRoom(first, `빠른 대전 · ${titleOf(choice)}`, choice, true);
  const seats = room.info.seats;
  const ordered = choice.kind === 'conquest' && entries.length === 2 && (randomBytes(1)[0]! & 1) ? [...entries].reverse() : entries;
  for (const [i, q] of ordered.entries()) {
    const index = choice.kind === 'conquest' && ordered.length === 2 ? i : teamOf(q.faction) === 'joseon' ? 0 : 1;
    const s = seats[index]!;
    s.client = q.c.id;
    s.faction = q.faction;
    q.c.room = room;
    room.clients.add(q.c);
    send(q.c, { t: 'quick', state: 'idle', seconds: 0 });
  }
  room.info.host = first.id;
  // The side without a person fights as the computer, under its usual navy.
  for (const s of seats) if (!s.client) s.human = false;
  void start(room);
}

function quickJoin(c: Client, msg: Extract<ClientMsg, { t: 'quick' }>) {
  leave(c);
  dequeue(c);
  let choice = sanitizeChoice(msg.battle);
  if (choice.kind === 'conquest') choice = { ...choice, size: 2 };
  let faction: Faction = FACTIONS.includes(msg.faction) ? msg.faction : 'joseon';
  // Only the Joseon and Japanese fleets sail a historical duel.
  if (choice.kind === 'scenario' && faction === 'ming') faction = 'joseon';
  const mate = queue.find((q) => q.c !== c && choiceKey(q.choice) === choiceKey(choice) && (choice.kind === 'conquest' || teamOf(q.faction) !== teamOf(faction)));
  if (mate) {
    queue.splice(queue.indexOf(mate), 1);
    matchRoom([mate, { c, choice, faction, since: Date.now() }]);
    return;
  }
  queue.push({ c, choice, faction, since: Date.now() });
  send(c, { t: 'quick', state: 'searching', seconds: QUICK_SECONDS });
}

function resetRoom(room: Room) {
  for (const c of [...room.clients]) if (!c.ws) drop(c);
  if (!rooms.has(room.info.id)) return;
  room.live = null;
  room.info.state = 'lobby';
  for (const s of room.info.seats) {
    s.ready = false;
    s.rematch = false;
    s.away = false;
  }
  pushRoom(room);
  if (room.info.quick) void start(room);
}

function handle(c: Client, msg: ClientMsg) {
  const room = c.room;
  switch (msg.t) {
    case 'rankedProfile':
      send(c, { t: 'rank', profile: c.account ? ranked?.profile(c.account.id) ?? null : null });
      return;
    case 'leaderboard':
      send(c, { t: 'leaderboard', players: ranked?.leaderboard() ?? [] });
      return;
    case 'ranked':
      rankJoin(c, msg.faction);
      return;
    case 'rankedCancel': {
      if (room?.ranked && !room.ranked.settled) {
        send(c, { t: 'error', code: 'ranked', text: '랭크 상대가 이미 정해졌습니다. 대기실에서 나가면 기권으로 처리됩니다.' });
        return;
      }
      const i = rankedQueue.findIndex((q) => q.c === c);
      if (i >= 0) rankedQueue.splice(i, 1);
      send(c, { t: 'ranked', state: 'idle', since: 0, range: 0 });
      return;
    }
    case 'list':
      send(c, { t: 'rooms', rooms: summary() });
      return;
    case 'ping':
      send(c, { t: 'pong', at: msg.at });
      return;
    case 'create': {
      if (rooms.size >= MAX_ROOMS) return send(c, { t: 'error', text: '방이 가득 찼습니다.' });
      leave(c);
      dequeue(c);
      send(c, { t: 'quick', state: 'idle', seconds: 0 });
      const choice = sanitizeChoice(msg.battle);
      const r = newRoom(c, clean(msg.name, 24) || `${c.name}의 방`, choice, false);
      r.info.seats[0]!.client = c.id;
      pushRoom(r);
      return;
    }
    case 'join': {
      const r = rooms.get(clean(msg.room, 8).toUpperCase());
      if (!r || r.info.state !== 'lobby' || r.info.quick || r.info.ranked) return send(c, { t: 'error', text: '그 방에 들어갈 수 없습니다.' });
      const open = r.info.seats.some((s) => s.human && !s.client);
      if (!open && !r.clients.has(c)) return send(c, { t: 'error', text: '방이 가득 찼습니다.' });
      leave(c);
      dequeue(c);
      send(c, { t: 'quick', state: 'idle', seconds: 0 });
      r.clients.add(c);
      c.room = r;
      const free = r.info.seats.find((s) => s.human && !s.client);
      if (free) free.client = c.id;
      pushRoom(r);
      return;
    }
    case 'leave':
      dequeue(c);
      leave(c);
      send(c, { t: 'room', room: null });
      send(c, { t: 'quick', state: 'idle', seconds: 0 });
      send(c, { t: 'rooms', rooms: summary() });
      return;
    case 'quick':
      quickJoin(c, msg);
      return;
    case 'quickCancel':
      dequeue(c);
      send(c, { t: 'quick', state: 'idle', seconds: 0 });
      return;
    case 'take': {
      if (!room || room.info.ranked || room.info.state !== 'lobby') return;
      if (!Number.isInteger(msg.index) || msg.index < 0 || msg.index >= room.info.seats.length) return;
      const seat = room.info.seats[msg.index];
      if (!seat || !seat.human || seat.client) return;
      for (const s of room.info.seats)
        if (s.client === c.id) {
          s.client = null;
          s.ready = false;
        }
      seat.client = c.id;
      pushRoom(room);
      return;
    }
    case 'seat': {
      if (!room || room.info.ranked || room.info.state !== 'lobby') return;
      if (!Number.isInteger(msg.index) || msg.index < 0 || msg.index >= room.info.seats.length) return;
      const seat = room.info.seats[msg.index];
      if (!seat) return;
      const mine = seat.client === c.id;
      const host = room.info.host === c.id;
      if (!mine && !(host && !seat.client)) return;
      // A duel's sides are fixed: Joseon on seat 0, Japan on seat 1.
      // The Ming fleet sailed only with the Joseon side.
      if (room.info.battle.kind === 'conquest' && msg.faction && FACTIONS.includes(msg.faction as Faction)) seat.faction = msg.faction as Faction;
      if (typeof msg.human === 'boolean' && host && !seat.client) seat.human = msg.human;
      for (const s of room.info.seats) s.ready = s.client === room.info.host ? s.ready : false;
      pushRoom(room);
      return;
    }
    case 'ready': {
      if (!room || room.info.ranked || room.info.state !== 'lobby') return;
      const seat = room.info.seats.find((s) => s.client === c.id);
      if (seat) seat.ready = !!msg.ready;
      pushRoom(room);
      return;
    }
    case 'start': {
      if (!room || room.info.host !== c.id || room.info.state !== 'lobby') return;
      const waiting = room.info.seats.filter((s) => s.client && s.client !== c.id && !s.ready);
      if (waiting.length) return send(c, { t: 'error', text: '아직 준비하지 않은 사람이 있습니다.' });
      void start(room);
      return;
    }
    case 'rematch': {
      if (!room || room.info.ranked || room.info.state !== 'ended') return;
      const seat = room.info.seats.find((s) => s.client === c.id);
      if (!seat) return;
      seat.rematch = true;
      pushRoom(room);
      if (room.info.seats.every((s) => !s.client || s.away || s.rematch)) resetRoom(room);
      return;
    }
    case 'loaded': {
      const live = room?.live;
      live?.waiting.delete(c.id);
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

/** A connection says who it is. A known token takes its old seat back. */
function attach(ws: WebSocket, msg: Extract<ClientMsg, { t: 'hello' }>, address: string): Client | null {
  if (msg.v !== PROTOCOL) {
    ws.send(JSON.stringify({ t: 'error', code: 'version', text: '게임 버전이 서버와 다릅니다. 새로고침이 필요합니다.' } satisfies ServerMsg));
    ws.close();
    return null;
  }
  let c = typeof msg.token === 'string' ? byToken.get(msg.token) : undefined;
  let account: Client['account'] = null;
  const name = clean(msg.name, 16) || '무명';
  if (ranked?.ready) {
    if (!msg.account) {
      let limit = accountCreation.get(address);
      if (!limit || Date.now() - limit.since > 3600000) limit = { since: Date.now(), count: 0 };
      if (limit.count >= 24) {
        ws.send(JSON.stringify({ t: 'error', code: 'identity', text: '새 계정을 너무 자주 만들었습니다. 저장된 복원 코드로 접속하거나 잠시 후 다시 시도해 주세요.' } satisfies ServerMsg));
        ws.close(4003, 'account creation limit');
        return null;
      }
      accountCreation.set(address, limit);
    }
    try { account = ranked.account(msg.account, name); }
    catch {
      ws.send(JSON.stringify({ t: 'error', code: ranked.ready ? 'identity' : 'ranked', text: ranked.ready ? '복원 코드를 확인할 수 없습니다. 저장된 코드를 다시 확인해 주세요.' : '계정 저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.' } satisfies ServerMsg));
      ws.close(ranked.ready ? 4003 : 1011, 'account unavailable');
      return null;
    }
    if (!msg.account) accountCreation.get(address)!.count++;
  }
  // Storage outages disable ranked play; an already authenticated tab can still recover its casual session.
  if (!ranked?.ready && c?.account && msg.account === c.account.token) account = c.account;
  if (c?.account && (account?.id !== c.account.id || msg.account !== c.account.token)) {
    ws.send(JSON.stringify({ t: 'error', code: 'identity', text: '이 자리의 계정과 복원 코드가 일치하지 않습니다.' } satisfies ServerMsg));
    ws.close(4003, 'account mismatch');
    return null;
  }
  // The permanent credential can recover a ranked seat after a tab was closed, without its session token.
  if (!c && account && ranked?.activeMatch(account.id)) c = [...byId.values()].find((other) => other.account?.id === account.id && other.room?.ranked && !other.room.ranked.settled);
  const resumed = !!c;
  if (c) {
    const old = c.ws;
    c.ws = null;
    old?.close(4001, 'replaced');
    if (c.grace) clearTimeout(c.grace);
    c.grace = null;
  } else {
    if (byId.size >= MAX_CLIENTS) {
      ws.send(JSON.stringify({ t: 'error', code: 'full', text: '서버가 가득 찼습니다. 잠시 후 다시 시도해 주시기 바랍니다.' } satisfies ServerMsg));
      ws.close();
      return null;
    }
    c = { id: randomBytes(6).toString('hex'), token: randomBytes(16).toString('hex'), name: '무명', ws: null, room: null, alive: true, grace: null, budget: 120, budgetAt: performance.now(), account };
    byToken.set(c.token, c);
    byId.set(c.id, c);
  }
  c.ws = ws;
  c.account = account;
  c.alive = true;
  c.name = clean(msg.name, 16) || c.name;
  send(c, { t: 'welcome', id: c.id, v: PROTOCOL, token: c.token, resumed, account: c.account, rank: c.account ? ranked?.profile(c.account.id) ?? null : null });
  const seat = c.room?.info.seats.find((s) => s.client === c!.id);
  if (c.room && seat) {
    if (seat.away) {
      seat.away = false;
      notice(c.room, '{name}님이 다시 접속했습니다.', { name: c.name });
    }
    resume(c);
    pushRoom(c.room);
  } else {
    if (c.room) leave(c);
    send(c, { t: 'room', room: null });
    send(c, { t: 'rooms', rooms: summary() });
  }
  return c;
}

/** The socket is gone. Lobbies let the seat go at once; a battle (or its result) holds it for GRACE_SECONDS. */
function detach(c: Client) {
  c.ws = null;
  dequeue(c);
  const room = c.room;
  const seat = room?.info.seats.find((s) => s.client === c.id);
  if (!room || !seat || (room.info.state === 'lobby' && !room.ranked)) {
    drop(c);
    return;
  }
  seat.away = true;
  if (!room.ranked) room.live?.waiting.delete(c.id);
  notice(room, '{name}님의 연결이 끊어졌습니다. {n}초 동안 기다립니다.', { name: c.name, n: DISCONNECT_SECONDS });
  pushRoom(room);
  c.grace = setTimeout(() => drop(c), DISCONNECT_SECONDS * 1000);
}

function main() {
  try { ranked = new RankedStore(process.env.RANKED_STORE ?? join(dirname(__filename), 'data', 'ranked.jsonl')); }
  catch (error) { console.error('ranked unavailable', error instanceof Error ? error.message : 'unknown error'); }
  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      res.end(
        JSON.stringify({
          ok: true,
          protocol: PROTOCOL,
          revision: BUILD_REVISION,
          rooms: rooms.size,
          battles: [...rooms.values()].filter((r) => r.live && !r.live.endedAt).length,
          clients: byId.size,
          queue: queue.length,
          rankedQueue: rankedQueue.length,
          rankedReady: ranked?.ready === true,
          tickMs: Math.round(tickMs * 100) / 100,
          ffSpeed: FF_SPEED,
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 64 * 1024, verifyClient: (info: { origin: string }) => originAllowed(info.origin || undefined) });
  wss.on('connection', (ws, request) => {
    // Only the local TLS proxy may supply the original address. A direct client cannot spoof this header.
    const remote = request.socket.remoteAddress ?? 'unknown';
    const forwarded = request.headers['x-forwarded-for'];
    const address = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) && typeof forwarded === 'string' ? forwarded.split(',').at(-1)!.trim() : remote;
    let c: Client | null = null;
    // Receiver errors (including maxPayload) belong to this connection, not the process.
    ws.on('error', () => ws.terminate());
    ws.on('pong', () => {
      if (c) c.alive = true;
    });
    ws.on('message', (data, binary) => {
      if (binary) return;
      let raw: unknown;
      try {
        raw = JSON.parse(String(data));
      } catch {
        return;
      }
      const msg = clientMessage(raw);
      if (!msg) return;
      try {
        // Introduced clients pay the same budget for hello/rename as for every other request.
        if (c && c.ws === ws) {
          const now = performance.now();
          c.budget = Math.min(120, c.budget + ((now - c.budgetAt) / 1000) * 60);
          c.budgetAt = now;
          if (c.budget < 1) return;
          c.budget -= 1;
        }
        if (msg.t === 'hello') {
          // A second hello on the same connection only renames the player.
          if (c && c.ws === ws && msg.v === PROTOCOL) {
            if (msg.account !== undefined && msg.account !== c.account?.token) {
              send(c, { t: 'error', code: 'identity', text: '다른 계정으로 접속하려면 현재 연결을 먼저 닫아 주세요.' });
              return;
            }
            c.name = clean(msg.name, 16) || c.name;
            if (ranked?.ready && c.account) {
              ranked.account(c.account.token, c.name);
              send(c, { t: 'rank', profile: ranked.profile(c.account.id) });
            }
            send(c, { t: 'rooms', rooms: summary() });
          } else c = attach(ws, msg, address) ?? c;
          return;
        }
        // Not yet introduced, or a connection that was replaced by a newer one.
        if (!c || c.ws !== ws) return;
        handle(c, msg);
      } catch (err) {
        console.warn('client request failed', err);
        ws.close(1011, 'request failed');
      }
    });
    ws.on('close', () => {
      if (c && c.ws === ws) detach(c);
    });
  });

  // Dead connections are dropped after a missed heartbeat.
  setInterval(() => {
    for (const c of byId.values()) {
      if (!c.ws) continue;
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, 15000);

  // Quick match waits QUICK_SECONDS for a person, then the computer takes the other side.
  setInterval(() => {
    matchRanked();
    const now = Date.now();
    for (const q of [...queue]) {
      if (now - q.since < QUICK_SECONDS * 1000) continue;
      queue.splice(queue.indexOf(q), 1);
      matchRoom([q]);
    }
  }, 500);

  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    const list = [...rooms.values()];
    const fast = list.filter((r) => r.live && !r.live.held && !r.live.endedAt && speedOf(r.live) > 1).length;
    const slice = Math.min(FF_SLICE_MS, FF_TOTAL_MS / Math.max(1, fast));
    for (const room of list) {
      tick(room, dt, slice);
      const ended = room.live?.endedAt;
      if (ended && Date.now() - ended > ENDED_ROOM_SECONDS * 1000) {
        broadcast(room, { t: 'closed', reason: '전투가 끝난 지 오래되어 방이 닫혔습니다.' });
        for (const c of [...room.clients]) {
          c.room = null;
          if (!c.ws) drop(c);
        }
        rooms.delete(room.info.id);
      }
    }
    tickMs += (performance.now() - now - tickMs) * 0.05;
  }, 1000 / 60);

  // Heightmaps are generated in the background, conquest maps first, so the first battle on each starts at once.
  void (async () => {
    const specs = [...CONQUEST_ORDER.map((id) => CONQUEST_MAPS[id].terrain), ...SCENARIO_ORDER.map((id) => SCENARIOS[id].terrain)];
    for (const spec of specs) {
      try {
        await loadLand(spec);
      } catch (e) {
        console.error('terrain preload failed', e);
      }
    }
  })();
  http.listen(PORT, () => {
    const address = http.address();
    console.log(`imjin server on :${typeof address === 'object' && address ? address.port : PORT}, protocol ${PROTOCOL}`);
  });
}

if (isMainThread) main();
else terrainWorker();
