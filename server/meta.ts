// The growth routes: the account's commander and armor profile (coins, owned armor and its rolls, what each general
// wears and carries, his experience and the steps he learned). The profile is kept under `meta` in the user's progress
// (accounts.ts profiles), and every coin moves through the account's coin ledger, whose balance is the purse: the
// stored `coins` is only its copy. Every change applies src/meta/rules.ts on the server; armor rolls come from the
// account id as the salt, so no page can send a roll, a purse or experience of its own.
import { randomBytes } from 'node:crypto';
import { generalById, GENERALS } from '../src/meta/catalog';
import { buy, equip, equipWeapon, learn, newProfile, normalizeProfile, reportProblem, reroll, rewardFor, RuleError, type BattleReport, type Profile } from '../src/meta/rules';
import { START_COINS, START_XP, type MetaBattleStart, type MetaBattleTicket, type MetaReply, type MetaRewardReply } from '../src/meta/wire';
import { battleReport, teamGenerals } from '../src/meta/battle';
import type { Battle } from '../src/sim/battle';
import { buildScenario, SCENARIOS, type ScenarioId } from '../src/sim/scenarios';
import { teamOf, type Faction, type Team } from '../src/sim/types';
import type { AccountStore, ProfileData, ProfileTx } from './accounts';
import { ApiError, Limiter, type ApiRouter } from './api';

const HOUR = 3600 * 1000;
/** The fastest the page's clock runs a battle against the computer (Engine SPEEDS). */
const MAX_SPEED = 128;
/** A ticket for a battle against the computer lasts this long; one never finished is forgotten. */
const TICKET_MS = 8 * HOUR;
const MAX_SHIPS = 400;

/** The day `rewardFor` counts the capped coins for, in Korean time. */
export const koreanDay = (now: number) => new Date(now + 9 * HOUR).toISOString().slice(0, 10);

const text = (value: unknown, max = 64) => (typeof value === 'string' && value.length > 0 && value.length <= max ? value : null);
const need = (value: unknown, max = 64) => {
  const s = text(value, max);
  if (s === null) throw new ApiError('json');
  return s;
};
/** An id or an explicit null (taking the basic armor or the default weapon back). */
const idOrNull = (value: unknown) => (value === null ? null : need(value));

/** The profile kept for `userId`, with its purse from the ledger. A profile made now gets the starting grant once. */
async function load(data: ProfileData, userId: string, tx: ProfileTx): Promise<Profile> {
  let p: Profile;
  if (data.meta && typeof data.meta === 'object') {
    // The salt is always the account id, whatever the stored copy says; rolls are recomputed from it.
    p = normalizeProfile({ ...(data.meta as object), salt: userId }, userId);
  } else {
    p = newProfile();
    p.salt = userId;
    if (await tx.claimOnce(`meta-start:${userId}`)) {
      await tx.ledger({ kind: 'coin', amount: START_COINS, reason: 'meta-start' });
      for (const g of GENERALS) if (g.famous) p.generals[g.id] = { xp: START_XP, skills: [] };
    }
  }
  p.coins = await tx.balance('coin');
  return p;
}

/**
 * Applies `change` to the user's profile in one transaction: the purse difference goes into the ledger (refused below
 * zero), and the profile is stored with the purse the ledger left. A RuleError is answered with its Korean reason.
 */
export async function changeMeta(accounts: AccountStore, userId: string, reason: string, change: (p: Profile, tx: ProfileTx) => Profile | Promise<Profile>, item: string | null = null): Promise<MetaReply> {
  let out: Profile | null = null;
  try {
    const stored = await accounts.updateProfile(userId, null, async (data, tx) => {
      const before = await load(data, userId, tx);
      const after = await change(before, tx);
      const delta = after.coins - before.coins;
      if (delta !== 0) await tx.ledger({ kind: 'coin', amount: delta, item, reason });
      after.coins = await tx.balance('coin');
      after.salt = userId;
      out = after;
      data.meta = after;
    });
    return { profile: out!, rev: stored.rev };
  } catch (error) {
    if (error instanceof RuleError) throw new ApiError('rule', 409, error.message);
    throw error;
  }
}

/** A battle against the computer the server agreed to pay for, kept in this process until it is reported. */
type Ticket = { userId: string; started: number; known: { ownShips: number; enemyShips: number; generals: string[] }; mode: MetaBattleStart['mode']; scenario: string; side: string };

/**
 * What the server knows of a historical battle on its own: the enemy's ships, and the account's generals who lead on
 * the player's side. The player's own fleet may be a campaign's, so its size comes from the page, capped.
 */
function knownHistory(id: ScenarioId, faction: Faction) {
  const b = buildScenario(id, 0, 1592);
  const team = teamOf(faction);
  const enemy = team === 'joseon' ? 'japan' : 'joseon';
  return { enemyShips: b.ships.filter((s) => s.team === enemy).length, ownShips: b.ships.filter((s) => s.team === team).length, generals: teamGenerals(b, team) };
}

const FACTIONS: Faction[] = ['joseon', 'japan', 'ming'];

export function metaRoutes(api: ApiRouter) {
  const tickets = new Map<string, Ticket>();
  // Battles against the computer a user may start in an hour, and imports (one counts; the rest are refused anyway).
  const starts = new Limiter(30, HOUR);

  const sweep = (now: number) => {
    for (const [id, t] of tickets) if (now - t.started > TICKET_MS) tickets.delete(id);
  };

  api.user('GET', '/api/meta', async ({ accounts, user }) => {
    const { profile, rev } = await changeMeta(accounts, user.id, 'meta-open', (p) => p);
    return { profile, rev } satisfies MetaReply;
  });

  api.user('POST', '/api/meta/buy', async ({ accounts, user, body }) => {
    const armor = need(body.armor);
    const { profile, rev } = await changeMeta(accounts, user.id, 'buy', (p) => buy(p, armor).profile, `armor:${armor}`);
    return { profile, rev } satisfies MetaReply;
  });

  api.user('POST', '/api/meta/reroll', async ({ accounts, user, body }) => {
    const armor = need(body.armor);
    const { profile, rev } = await changeMeta(accounts, user.id, 'reroll', (p) => reroll(p, armor), `armor:${armor}`);
    return { profile, rev } satisfies MetaReply;
  });

  api.user('POST', '/api/meta/equip', async ({ accounts, user, body }) => {
    const general = need(body.general);
    const armor = idOrNull(body.armor);
    const { profile, rev } = await changeMeta(accounts, user.id, 'equip', (p) => equip(p, general, armor));
    return { profile, rev } satisfies MetaReply;
  });

  api.user('POST', '/api/meta/weapon', async ({ accounts, user, body }) => {
    const general = need(body.general);
    const weapon = idOrNull(body.weapon);
    const { profile, rev } = await changeMeta(accounts, user.id, 'weapon', (p) => equipWeapon(p, general, weapon));
    return { profile, rev } satisfies MetaReply;
  });

  api.user('POST', '/api/meta/learn', async ({ accounts, user, body }) => {
    const general = need(body.general);
    const skill = need(body.skill);
    const { profile, rev } = await changeMeta(accounts, user.id, 'learn', (p) => learn(p, general, skill));
    return { profile, rev } satisfies MetaReply;
  });

  // A profile this browser kept before it had an account, carried over once per account. Only choices are taken, each
  // through the server's rules: the armor it owned is bought again from the server's purse (rolled afresh from the
  // account id), the steps learned are learned again where the server's experience allows, and what was worn is put on.
  // Its coins, experience, rolls and rewards are the browser's own word and are never taken.
  api.user('POST', '/api/meta/import', async ({ accounts, user, body }) => {
    const local = normalizeProfile(body.profile);
    let imported = false;
    const { profile, rev } = await changeMeta(accounts, user.id, 'meta-import', async (p, tx) => {
      if (!(await tx.claimOnce(`meta-import:${user.id}`))) return p;
      imported = true;
      const attempt = (step: (q: Profile) => Profile) => {
        try {
          p = step(p);
        } catch (error) {
          if (!(error instanceof RuleError)) throw error;
        }
      };
      for (const id of local.owned) attempt((q) => buy(q, id).profile);
      for (const [id, g] of Object.entries(local.generals)) {
        for (const skill of g.skills) attempt((q) => learn(q, id, skill));
        if (g.armor) attempt((q) => equip(q, id, g.armor!));
        if (g.weapon) attempt((q) => equipWeapon(q, id, g.weapon!));
      }
      return p;
    });
    return { profile, rev, imported };
  });

  // A battle against the computer: the page says what it fights, the server keeps what it can know of it, and pays
  // the result once (reportProblem, the daily cap of untrusted coins) when the page reports it.
  api.user('POST', '/api/meta/battle/start', async ({ user, body, now }): Promise<MetaBattleTicket> => {
    const mode = body.mode === 'history' || body.mode === 'conquest' ? body.mode : null;
    const scenario = need(body.scenario, 32);
    const side = need(body.side, 16) as Faction;
    if (!mode || !FACTIONS.includes(side)) throw new ApiError('json');
    if (!starts.take(user.id, now)) throw new ApiError('rate');
    const cap = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) && n >= 0 ? Math.min(n, MAX_SHIPS) : 0);
    const asked = Array.isArray(body.generals) ? body.generals.filter((g): g is string => typeof g === 'string' && generalById(g)?.faction === side).slice(0, 24) : [];
    let known: Ticket['known'];
    if (mode === 'history') {
      if (!Object.hasOwn(SCENARIOS, scenario)) throw new ApiError('json');
      const k = knownHistory(scenario as ScenarioId, side);
      // A campaign fleet may be larger than the written one, never larger than the cap.
      known = { enemyShips: k.enemyShips, ownShips: Math.max(k.ownShips, cap(body.ownShips)), generals: [...new Set([...k.generals, ...asked])] };
    } else {
      known = { enemyShips: cap(body.enemyShips), ownShips: cap(body.ownShips), generals: asked };
    }
    sweep(now);
    const ticket = randomBytes(16).toString('hex');
    tickets.set(ticket, { userId: user.id, started: now, known, mode, scenario, side });
    return { ticket };
  });

  api.user('POST', '/api/meta/battle/finish', async ({ accounts, user, body, now }): Promise<MetaRewardReply> => {
    const id = need(body.ticket, 32);
    const t = tickets.get(id);
    if (!t || t.userId !== user.id) throw new ApiError('rule', 409, '보상을 받을 수 없는 전투입니다');
    const raw = (body.report && typeof body.report === 'object' ? body.report : {}) as Record<string, unknown>;
    const generals = Array.isArray(raw.generals) ? raw.generals.filter((g): g is { id: string; sunk: number } => !!g && typeof g === 'object' && typeof (g as { id?: unknown }).id === 'string' && typeof (g as { sunk?: unknown }).sunk === 'number') : [];
    const report: BattleReport = {
      mode: t.mode,
      scenario: t.scenario,
      side: t.side,
      result: raw.result as BattleReport['result'],
      stars: raw.stars as number,
      sunk: raw.sunk as number,
      lost: raw.lost as number,
      simSeconds: raw.simSeconds as number,
      generals: generals.map((g) => ({ id: g.id, sunk: g.sunk })),
    };
    const problem = reportProblem(report, t.known, (now - t.started) / 1000, MAX_SPEED);
    if (problem) throw new ApiError('rule', 409, '보상을 받을 수 없는 전투입니다');
    tickets.delete(id);
    let reward: MetaRewardReply['reward'] | null = null;
    const { profile, rev } = await changeMeta(accounts, user.id, 'battle', async (p, tx) => {
      if (!(await tx.claimOnce(`meta-battle:${id}`))) throw new RuleError('보상을 받을 수 없는 전투입니다');
      const paid = rewardFor(p, report, koreanDay(now), false);
      reward = paid.reward;
      return paid.profile;
    }, `battle:${t.mode}:${t.scenario}`.slice(0, 64));
    return { profile, rev, reward: reward! };
  });
}

/** Pays one seat of a battle the server ran to its end: trusted, so its coins are not capped. */
export async function payServerBattle(accounts: AccountStore, userId: string, b: Battle, seat: number, faction: Faction, team: Team, mode: 'online' | 'ranked', scenario: string) {
  const report = battleReport(b, team, seat, mode, scenario.slice(0, 40), faction);
  const now = Date.now();
  await changeMeta(accounts, userId, `battle-${mode}`, (p) => rewardFor(p, report, koreanDay(now), true).profile, `battle:${mode}:${scenario}`.slice(0, 64));
}
