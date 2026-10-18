// The growth API between the multiplayer host (server/meta.ts) and the page (src/meta/localProfile.ts): the account's
// profile of coins, armor, weapons and generals lives on the server, and every change goes through these routes.
import type { BattleMode, Profile, Reward } from './rules';

/** The profile as the server keeps it (coins are the account's coin ledger balance), and the revision it is at. */
export type MetaReply = { profile: Profile; rev: number };
export type MetaRewardReply = MetaReply & { reward: Reward };
/** A battle the server will pay for when it ends: what the page fights, so the result can be judged against it. */
export type MetaBattleStart = { mode: Extract<BattleMode, 'history' | 'conquest'>; scenario: string; side: string; ownShips: number; enemyShips: number; generals: string[] };
export type MetaBattleTicket = { ticket: string };

export const META_PATHS = {
  profile: '/meta',
  buy: '/meta/buy',
  reroll: '/meta/reroll',
  equip: '/meta/equip',
  weapon: '/meta/weapon',
  learn: '/meta/learn',
  respec: '/meta/respec',
  itemEquip: '/meta/item/equip',
  itemSalvage: '/meta/item/salvage',
  itemReforge: '/meta/item/reforge',
  import: '/meta/import',
  nation: '/meta/nation',
  recruit: '/meta/recruit',
  ship: '/meta/ship',
  battleStart: '/meta/battle/start',
  battleFinish: '/meta/battle/finish',
} as const;

/** Coins and experience a new account profile starts with, so the armory and the trees can be tried at once. */
export const START_COINS = 12000;
export const START_XP = 600;
