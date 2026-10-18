import { create } from 'zustand';
import { onSessionChange, savedSession } from '../account/session';
import { GENERALS } from './catalog';
import { buy, equip, equipItem, equipWeapon, learn, reforge, respec, salvage, newProfile, normalizeProfile, reroll, rewardFor, RuleError, type BattleReport, type Profile, type Reward } from './rules';
import type { GearSlot } from './loot';
import { META_PATHS, START_COINS, START_XP, type MetaBattleStart, type MetaBattleTicket, type MetaReply, type MetaRewardReply } from './wire';

/**
 * The profile the 장수 screen shows and battles draw on. It lives in the player's account on the server
 * (server/meta.ts): when the server can be reached this store is a cache of the server's copy, every change goes to the
 * server (shown at once through the same rules, src/meta/rules.ts; the server's answer then replaces it) and a guest
 * account is made for a browser that has none. Without a server it falls back to a profile kept in this browser
 * (LOCAL_KEY), which is carried over to the account once, through the server's rules, the first time one is reachable.
 */
// The account client is loaded when first needed: it reaches for the page's address, which a battle or a test in Node
// without a page never has.
const api = () => import('../account/api');
async function accountCall<T>(method: 'GET' | 'POST', path: string, body?: object, token?: string): Promise<T> {
  return (await api()).accountCall<T>(method, path, body, token);
}

const LOCAL_KEY = 'imjin.meta.local.v1';
/** The server profile last seen, per user, so a reload shows it before the server answers. Only a cache. */
const CACHE_KEY = 'imjin.meta.cache.v1';

function seed(): Profile {
  const p = newProfile();
  // The salt every armor roll of this browser's profile mixes in (the server uses the account id).
  try { p.salt = crypto.randomUUID(); } catch { p.salt = `local-${Date.now().toString(36)}`; }
  p.coins = START_COINS;
  for (const g of GENERALS) if (g.famous) p.generals[g.id] = { xp: START_XP, talents: {} };
  return p;
}

function load(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Storage can be missing or refuse in an in-app browser: the screen still works for this visit.
    return null;
  }
}

function store(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // As above: nothing to do but keep the profile in memory.
  }
}

const readLocal = (): Profile | null => {
  const raw = load(LOCAL_KEY);
  return raw ? normalizeProfile(raw) : null;
};

function cached(userId: string | undefined): Profile | null {
  const raw = load(CACHE_KEY) as { user?: string; profile?: unknown } | null;
  return userId && raw?.user === userId && raw.profile ? normalizeProfile(raw.profile, userId) : null;
}

type LocalProfile = {
  profile: Profile;
  /** Where `profile` comes from: the account on the server, or this browser while no server answers. */
  source: 'server' | 'local';
  /** The rule's reason the last action was refused, shown once. */
  refused: string | null;
  buy: (armorId: string) => boolean;
  reroll: (armorId: string) => boolean;
  equip: (generalId: string, armorId: string | null) => boolean;
  equipWeapon: (generalId: string, weaponId: string | null) => boolean;
  learn: (generalId: string, skillId: string) => boolean;
  respec: (generalId: string) => boolean;
  equipItem: (generalId: string, slot: GearSlot, uid: string | null) => boolean;
  salvage: (uid: string) => boolean;
  reforge: (uid: string) => boolean;
  dismiss: () => void;
};

const initialUser = savedSession()?.user.id;
const initialCache = cached(initialUser);

export const useLocalProfile = create<LocalProfile>((set, get) => {
  /** Applies a change now through the shared rules; on the server's copy it is also sent, and the answer wins. */
  const apply = (change: (p: Profile) => Profile, path: string, body: object) => {
    let profile: Profile;
    try {
      profile = change(get().profile);
    } catch (error) {
      if (error instanceof RuleError) set({ refused: error.message });
      else throw error;
      return false;
    }
    set({ profile, refused: null });
    if (get().source === 'local') store(LOCAL_KEY, profile);
    else void send(path, body);
    return true;
  };
  return {
    profile: initialCache ?? readLocal() ?? seed(),
    source: initialCache ? 'server' : 'local',
    refused: null,
    buy: (armorId) => apply((p) => buy(p, armorId).profile, META_PATHS.buy, { armor: armorId }),
    reroll: (armorId) => apply((p) => reroll(p, armorId), META_PATHS.reroll, { armor: armorId }),
    equip: (generalId, armorId) => apply((p) => equip(p, generalId, armorId), META_PATHS.equip, { general: generalId, armor: armorId }),
    equipWeapon: (generalId, weaponId) => apply((p) => equipWeapon(p, generalId, weaponId), META_PATHS.weapon, { general: generalId, weapon: weaponId }),
    learn: (generalId, skillId) => apply((p) => learn(p, generalId, skillId), META_PATHS.learn, { general: generalId, skill: skillId }),
    respec: (generalId) => apply((p) => respec(p, generalId), META_PATHS.respec, { general: generalId }),
    equipItem: (generalId, slot, uid) => apply((p) => equipItem(p, generalId, slot, uid), META_PATHS.itemEquip, { general: generalId, slot, item: uid }),
    salvage: (uid) => apply((p) => salvage(p, uid), META_PATHS.itemSalvage, { item: uid }),
    reforge: (uid) => apply((p) => reforge(p, uid), META_PATHS.itemReforge, { item: uid }),
    dismiss: () => set({ refused: null }),
  };
});

/** The server's copy replaces what is shown, and is cached for the next visit. */
function accept(userId: string, reply: MetaReply) {
  const profile = normalizeProfile(reply.profile, userId);
  store(CACHE_KEY, { user: userId, profile });
  useLocalProfile.setState({ profile, source: 'server' });
}

// Changes go to the server one after another, in the order the buttons were pressed.
let queue: Promise<unknown> = Promise.resolve();

function send(path: string, body: object) {
  const held = savedSession();
  if (!held) return Promise.resolve();
  const work = queue.then(async () => {
    try {
      accept(held.user.id, await accountCall<MetaReply>('POST', path, body, held.token));
    } catch (error) {
      // Refused or unreachable: the server's copy is what holds, so it is shown again with the reason.
      const text = error instanceof (await api()).AccountApiError ? (error as { text: string }).text : null;
      useLocalProfile.setState({ refused: text });
      await refresh(held.user.id, held.token);
    }
  });
  queue = work.catch(() => undefined);
  return work;
}

async function refresh(userId: string, token: string) {
  try {
    accept(userId, await accountCall<MetaReply>('GET', META_PATHS.profile, undefined, token));
  } catch {
    // Unreachable: the cached copy stays on screen.
  }
}

let syncing: Promise<void> | null = null;

/**
 * Loads the account's profile (making a guest account for a browser without one), after carrying over a profile this
 * browser kept on its own, once. Without a server the browser's own profile stays in use. Called by the 장수 screen
 * and before a battle; safe to call often.
 */
export function syncProfile(): Promise<void> {
  syncing ??= (async () => {
    const user = await (await import('../account/store')).ensureAccount();
    const held = savedSession();
    if (!user || !held) return;
    const local = readLocal();
    try {
      if (local) {
        // The server takes only the choices, through its own rules; coins, experience and rolls stay behind.
        accept(held.user.id, await accountCall<MetaReply>('POST', META_PATHS.import, { profile: local }, held.token));
        store(LOCAL_KEY, null);
      } else {
        accept(held.user.id, await accountCall<MetaReply>('GET', META_PATHS.profile, undefined, held.token));
      }
    } catch {
      // The server cannot be reached now: keep what is shown.
    }
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

// Signing in or out elsewhere: show that account's profile, or this browser's own.
onSessionChange(() => {
  const held = savedSession();
  if (!held) {
    useLocalProfile.setState({ profile: readLocal() ?? seed(), source: 'local' });
    return;
  }
  const c = cached(held.user.id);
  if (c) useLocalProfile.setState({ profile: c, source: 'server' });
  void syncProfile();
});

/** A battle against the computer the server will pay for: its ticket, or null when it is paid locally. */
export async function beginRewardedBattle(start: MetaBattleStart): Promise<string | null> {
  await syncProfile().catch(() => undefined);
  const held = savedSession();
  if (!held || useLocalProfile.getState().source !== 'server') return null;
  try {
    return (await accountCall<MetaBattleTicket>('POST', META_PATHS.battleStart, start, held.token)).ticket;
  } catch {
    return null;
  }
}

/** Day string in Korean time, as the server counts the daily cap. */
const koreanDay = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * Reports a finished battle against the computer: to the server with its ticket (the server judges it and pays), or,
 * on a browser without a server, through the same rules into its own profile. Resolves with what it paid.
 */
export async function finishRewardedBattle(ticket: string | null, report: BattleReport): Promise<Reward | null> {
  const held = savedSession();
  if (ticket && held) {
    try {
      const reply = await accountCall<MetaRewardReply>('POST', META_PATHS.battleFinish, { ticket, report }, held.token);
      accept(held.user.id, reply);
      return reply.reward;
    } catch {
      return null;
    }
  }
  if (useLocalProfile.getState().source !== 'local') return null;
  const paid = rewardFor(useLocalProfile.getState().profile, report, koreanDay(), false);
  store(LOCAL_KEY, paid.profile);
  useLocalProfile.setState({ profile: paid.profile });
  return paid.reward;
}
