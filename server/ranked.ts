// A single-writer journal on the multiplayer host. Each result is one durable record for both players.
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, truncateSync, writeSync, chmodSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RankProfile, RankReason, RankRecent, RankStanding, RankTier, ServerMsg } from '../src/net/protocol';
import type { Faction } from '../src/sim/types';

export const PLACEMENTS = 10;
export const PAIR_LIMIT = 3;
const HOUR = 3600000;
const factions = ['joseon', 'japan', 'ming'];
const reasons: RankReason[] = ['battle', 'forfeit', 'disconnect', 'load-timeout', 'restart', 'server-error'];
type Account = { id: string; hash: string; name: string; renamedAt: number; rating: number; wins: number; losses: number; draws: number; recent: RankRecent[] };
export type RankParticipant = { id: string; faction: Faction };
export type RankMatch = { id: string; players: [RankParticipant, RankParticipant]; map: 'hallyeo'; at: number; seed?: number; balanceProfile?: 'competitive-v1'; revision?: string; finished?: number; outcome?: Outcome };
type Outcome = 0 | 1 | 'draw' | 'void';
type Event =
  | { v: 1; t: 'account'; id: string; hash: string; name: string; at: number }
  | { v: 1; t: 'rename'; id: string; name: string; at: number }
  | { v: 1; t: 'begin'; id: string; players: [RankParticipant, RankParticipant]; map: 'hallyeo'; at: number; seed?: number; balanceProfile?: 'competitive-v1'; revision?: string }
  | { v: 1; t: 'finish'; id: string; outcome: Outcome; reason: RankReason; at: number };
type ResultMessage = Extract<ServerMsg, { t: 'rankedResult' }>;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const games = (a: Account) => a.wins + a.losses + a.draws;
const hex = (value: unknown, length: number) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const named = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 16;
export const rankRange = (waitMs: number) => Math.min(500, 100 + Math.floor(Math.max(0, waitMs) / 20000) * 50);
function tier(a: Account): RankTier {
  if (games(a) < PLACEMENTS) return 'provisional';
  return a.rating < 900 ? 'bronze' : a.rating < 1100 ? 'silver' : a.rating < 1300 ? 'gold' : a.rating < 1500 ? 'platinum' : a.rating < 1700 ? 'diamond' : 'admiral';
}

export class RankedStore {
  ready = false;
  error: string | null = null;
  private fd: number | null = null;
  private accounts = new Map<string, Account>();
  private credentials = new Map<string, string>();
  private matches = new Map<string, RankMatch>();
  private active = new Map<string, string>();
  private results = new Map<string, [RankRecent, RankRecent]>();
  private locked = false;

  constructor(readonly path: string) {
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      if (existsSync(`${path}.lock`)) {
        const pid = Number(readFileSync(`${path}.lock`, 'utf8'));
        if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('invalid ranked writer lock');
        let alive = true;
        try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
        if (alive) throw new Error('ranked journal already has a live writer');
        unlinkSync(`${path}.lock`);
      }
      const lock = openSync(`${path}.lock`, 'wx', 0o600);
      this.locked = true;
      try { writeSync(lock, String(process.pid)); fsyncSync(lock); } finally { closeSync(lock); }
      const data = existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
      const complete = data.length ? data.lastIndexOf(10) + 1 : 0;
      const lines = data.subarray(0, complete).toString('utf8').split('\n');
      for (const line of lines) {
        if (!line) continue;
        const event: unknown = JSON.parse(line);
        this.validate(event);
        this.apply(event as Event);
      }
      // Only an incomplete final append can be discarded. A malformed committed line disables ranked play.
      if (complete < data.length) {
        copyFileSync(path, `${path}.torn-${Date.now()}.bak`);
        truncateSync(path, complete);
      }
      this.fd = openSync(path, 'a', 0o600);
      chmodSync(path, 0o600);
      fsyncSync(this.fd);
      if (process.platform !== 'win32') {
        const directory = openSync(dirname(path), 'r');
        try { fsyncSync(directory); } finally { closeSync(directory); }
      }
      this.ready = true;
      // A process restart cannot reconstruct the live simulation. Preserve accounts and void unfinished matches.
      for (const match of this.matches.values()) if (match.finished === undefined) this.finish(match.id, 'void', 'restart');
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown): never {
    this.ready = false;
    this.error = error instanceof Error ? error.message : String(error);
    if (this.fd !== null) { closeSync(this.fd); this.fd = null; }
    if (this.locked) { unlinkSync(`${this.path}.lock`); this.locked = false; }
    throw new Error(`ranked store unavailable: ${this.error}`);
  }

  private validate(raw: unknown): asserts raw is Event {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid journal record');
    const e = raw as Record<string, unknown>;
    if (e.v !== 1 || !Number.isFinite(e.at) || (e.at as number) < 0) throw new Error('invalid journal version or time');
    if (e.t === 'account') {
      if (!hex(e.id, 24) || !hex(e.hash, 64) || !named(e.name) || this.accounts.has(e.id as string) || this.credentials.has(e.hash as string)) throw new Error('invalid account record');
    } else if (e.t === 'rename') {
      if (!this.accounts.has(e.id as string) || !named(e.name)) throw new Error('invalid rename record');
    } else if (e.t === 'begin') {
      const ps = e.players as RankParticipant[] | undefined;
      if (!hex(e.id, 32) || this.matches.has(e.id as string) || e.map !== 'hallyeo' || !Array.isArray(ps) || ps.length !== 2 || ps.some((p) => !p || !this.accounts.has(p.id) || !factions.includes(p.faction) || this.active.has(p.id)) || ps[0]!.id === ps[1]!.id) throw new Error('invalid match record');
      if ((e.seed !== undefined && (!Number.isSafeInteger(e.seed) || (e.seed as number) < 0)) || (e.balanceProfile !== undefined && e.balanceProfile !== 'competitive-v1') || (e.revision !== undefined && (typeof e.revision !== 'string' || e.revision.length > 64))) throw new Error('invalid match provenance');
    } else if (e.t === 'finish') {
      const m = this.matches.get(e.id as string);
      if (!m || m.finished !== undefined || ![0, 1, 'draw', 'void'].includes(e.outcome as Outcome) || !reasons.includes(e.reason as RankReason)) throw new Error('invalid result record');
      if ((['restart', 'load-timeout', 'server-error'].includes(e.reason as string)) !== (e.outcome === 'void')) throw new Error('invalid void reason');
      if (e.reason !== 'battle' && e.outcome === 'draw') throw new Error('invalid draw reason');
    } else throw new Error('unknown journal record');
  }

  private apply(e: Event) {
    if (e.t === 'account') {
      this.accounts.set(e.id, { id: e.id, hash: e.hash, name: e.name, renamedAt: 0, rating: 1000, wins: 0, losses: 0, draws: 0, recent: [] });
      this.credentials.set(e.hash, e.id);
    } else if (e.t === 'rename') { const a = this.accounts.get(e.id)!; a.name = e.name; a.renamedAt = e.at; }
    else if (e.t === 'begin') {
      this.matches.set(e.id, { id: e.id, players: e.players, map: e.map, at: e.at, seed: e.seed, balanceProfile: e.balanceProfile, revision: e.revision });
      for (const p of e.players) this.active.set(p.id, e.id);
    } else {
      const m = this.matches.get(e.id)!;
      const [a, b] = m.players.map((p) => this.accounts.get(p.id)!) as [Account, Account];
      const before = [a.rating, b.rating];
      let delta = 0;
      if (e.outcome !== 'void') {
        const score = e.outcome === 'draw' ? 0.5 : e.outcome === 0 ? 1 : 0;
        const k = games(a) < PLACEMENTS || games(b) < PLACEMENTS ? 40 : 24;
        delta = Math.round(k * (score - 1 / (1 + 10 ** ((b.rating - a.rating) / 400))));
        delta = Math.max(-a.rating, Math.min(b.rating, delta));
        a.rating += delta;
        b.rating -= delta;
        if (e.outcome === 'draw') { a.draws++; b.draws++; }
        else { [a, b][e.outcome]!.wins++; [a, b][1 - e.outcome]!.losses++; }
      }
      m.finished = e.at;
      m.outcome = e.outcome;
      for (const [index, account] of [a, b].entries()) {
        const opponent = [b, a][index]!;
        account.recent.unshift({ matchId: m.id, opponent: { id: opponent.id, name: opponent.name }, faction: m.players[index]!.faction, opponentFaction: m.players[1 - index]!.faction, map: m.map, result: e.outcome === 'void' ? 'void' : e.outcome === 'draw' ? 'draw' : e.outcome === index ? 'win' : 'loss', reason: e.reason, at: e.at, before: before[index]!, after: account.rating, delta: index === 0 ? delta : -delta });
        account.recent.length = Math.min(20, account.recent.length);
        this.active.delete(account.id);
      }
      this.results.set(m.id, [a.recent[0]!, b.recent[0]!]);
    }
  }

  private commit(e: Event) {
    if (!this.ready || this.fd === null) throw new Error('ranked storage is unavailable');
    this.validate(e);
    try {
      const bytes = Buffer.from(`${JSON.stringify(e)}\n`);
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(this.fd, bytes, offset, bytes.length - offset);
      fsyncSync(this.fd);
    } catch (error) { this.fail(error); }
    this.apply(e);
  }

  account(token: string | undefined, name: string): { id: string; token: string } {
    if (!this.ready) throw new Error('ranked storage is unavailable');
    if (token !== undefined) {
      if (!hex(token, 64)) throw new Error('invalid account credential');
      const id = this.credentials.get(hashToken(token));
      if (!id) throw new Error('unknown account credential');
      const account = this.accounts.get(id)!;
      if (account.name !== name && Date.now() - account.renamedAt >= 30000) this.commit({ v: 1, t: 'rename', id, name, at: Date.now() });
      return { id, token };
    }
    const credential = randomBytes(32).toString('hex');
    const id = randomBytes(12).toString('hex');
    this.commit({ v: 1, t: 'account', id, hash: hashToken(credential), name, at: Date.now() });
    return { id, token: credential };
  }

  profile(id: string): RankProfile | null {
    const a = this.accounts.get(id);
    if (!a || !this.ready) return null;
    return { id: a.id, name: a.name, rating: a.rating, wins: a.wins, losses: a.losses, draws: a.draws, games: games(a), placementLeft: Math.max(0, PLACEMENTS - games(a)), tier: tier(a), recent: a.recent.map((r) => ({ ...r, opponent: { ...r.opponent } })) };
  }
  leaderboard(): RankStanding[] {
    if (!this.ready) return [];
    return [...this.accounts.values()].filter((a) => games(a) > 0).sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.id.localeCompare(b.id)).slice(0, 50).map((a) => ({ id: a.id, name: a.name, rating: a.rating, wins: a.wins, losses: a.losses, draws: a.draws, games: games(a), tier: tier(a) }));
  }
  activeMatch(id: string) { return this.active.get(id); }
  canPair(a: string, b: string, now = Date.now()) {
    if (!this.ready || a === b || !this.accounts.has(a) || !this.accounts.has(b) || this.active.has(a) || this.active.has(b)) return false;
    let count = 0;
    for (const m of this.matches.values()) if (m.finished !== undefined && m.finished > now - HOUR && m.outcome !== 'void' && m.players.some((p) => p.id === a) && m.players.some((p) => p.id === b)) count++;
    return count < PAIR_LIMIT;
  }
  begin(players: [RankParticipant, RankParticipant], now = Date.now(), revision = 'unknown'): RankMatch {
    if (!this.canPair(players[0].id, players[1].id, now)) throw new Error('accounts cannot enter another ranked match');
    const id = randomBytes(16).toString('hex');
    this.commit({ v: 1, t: 'begin', id, players, map: 'hallyeo', at: now, seed: 1592 + randomBytes(4).readUInt32LE(), balanceProfile: 'competitive-v1', revision });
    return this.matches.get(id)!;
  }
  finish(id: string, outcome: Outcome, reason: RankReason, at = Date.now()): [ResultMessage, ResultMessage] | null {
    const m = this.matches.get(id);
    if (!m || m.finished !== undefined) return null;
    this.commit({ v: 1, t: 'finish', id, outcome, reason, at });
    return m.players.map((p) => this.result(id, p.id)!) as [ResultMessage, ResultMessage];
  }
  result(id: string, accountId: string): ResultMessage | null {
    const m = this.matches.get(id);
    const index = m?.players.findIndex((p) => p.id === accountId) ?? -1;
    const receipt = index >= 0 ? this.results.get(id)?.[index] : null;
    const profile = this.profile(accountId);
    if (!receipt || !profile) return null;
    return { t: 'rankedResult', matchId: id, result: receipt.result, reason: receipt.reason, before: receipt.before, after: receipt.after, delta: receipt.delta, profile };
  }
  close() {
    if (this.fd !== null) { closeSync(this.fd); this.fd = null; }
    if (this.locked) { unlinkSync(`${this.path}.lock`); this.locked = false; }
    this.ready = false;
  }
}
